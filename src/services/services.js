/**
 * services.js - Capa de servicios de Supabase para Zendapp
 *
 * Auditoria Fase 2:
 * - Eliminado codigo muerto (createPay, createClientInvoice stub)
 * - Corregidos nombres de columnas: monto_inicial->saldo_inicial, monto_final->saldo_final
 * - Eliminada referencia a tabla Odoo legacy 'cash_register'
 * - saveInvoice: eliminada referencia a tabla legacy 'detallescaja'
 */
import { updateData, insertOrReplaceData, getDbConnection, getData, insertTables } from '../database/db';
import { supabase } from '../lib/supabase';
import { getCajaActual, saveCajaLocal, saveMovimientoLocal } from './cajaService';

const SUPABASE_URL = 'https://gwpwntdwogxzmtegaaom.supabase.co';

export const AuthService = async (db, email, password) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { success: false, message: error.message || 'Usuario o contrasena incorrectos' };
    }
    const { access_token } = data.session;
    const userId = data.user.id;
    await Promise.all([
      updateData(db, 'parametrizacion', { id: 2, valor: access_token }),
      updateData(db, 'parametrizacion', { id: 5, valor: userId }),
    ]);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-user-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
      body: JSON.stringify({ id: userId }),
    });
    if (!response.ok) {
      const errorResult = await response.json().catch(() => ({}));
      return { success: false, message: errorResult.error || 'Error al obtener el perfil' };
    }
    const result = await response.json();
    let { profile, concepts, caja, movimientos } = result;

    const isAdmin = profile?.rol === 'admin' || profile?.rol === 'superadmin';
    let tieneCajaAbierta = caja && caja.id && caja.estado === 'abierta';

    // Doble verificación directa contra Supabase si no es admin y caja no vino abierta
    if (!isAdmin && !tieneCajaAbierta) {
      try {
        const { data: dbCaja } = await supabase
          .from('cajas')
          .select('*')
          .eq('usuario_id', userId)
          .eq('estado', 'abierta')
          .order('fecha_apertura', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (dbCaja) {
          tieneCajaAbierta = true;
          caja = dbCaja;
        }
      } catch (e) {
        console.log('Error verificando caja abierta en Supabase:', e);
      }
    }

    // Regla estricta: El vendedor NO puede iniciar sesión si no tiene caja abierta
    if (!isAdmin && !tieneCajaAbierta) {
      await supabase.auth.signOut();
      return {
        success: false,
        message: 'No puedes iniciar sesión porque no tienes una caja abierta. Tu administrador debe realizar la apertura de tu caja antes de que puedas comenzar a trabajar.',
      };
    }

    if (profile) {
      await Promise.all([
        updateData(db, 'parametrizacion', { id: 6, valor: profile.rol }),
        updateData(db, 'parametrizacion', { id: 7, valor: profile.nombre }),
        updateData(db, 'parametrizacion', { id: 8, valor: profile.superior_id }),
      ]);
    }
    if (caja && caja.id) {
      await saveCajaLocal(db, caja, userId);
    }

    if (Array.isArray(movimientos) && movimientos.length > 0) {
      for (const m of movimientos) {
        if (!m || !m.id) continue;
        await saveMovimientoLocal(db, m, caja?.id, 'sincronizado');
      }
    }

    if (concepts?.length) {
      try { await insertOrReplaceData(db, 'concepts', concepts); } catch {}
    }
    const invoicesOk = await getInvoice(userId, access_token);
    console.log('Facturas cargadas:', invoicesOk);
    return { success: true, user: data.user };
  } catch (err) {
    console.error('Error en AuthService:', err);
    return { success: false, message: err.message || 'Error desconocido' };
  }
};

export const getInvoice = async (userId, access_token) => {
  // 1. Intentar primero con la Database Function (RPC) nativa (ultra rápida, sin cold starts)
  try {
    const { data, error } = await supabase.rpc('get_invoices_vendedor', {
      p_vendedor_id: userId,
    });
    if (!error && Array.isArray(data)) {
      return saveInvoice(data);
    }
    if (error) {
      console.log('RPC get_invoices_vendedor error, usando fallback:', error.message || error);
    }
  } catch (rpcErr) {
    console.log('RPC get_invoices_vendedor catch, usando fallback:', rpcErr);
  }

  // 2. Fallback a la Edge Function de respaldo
  const response = await fetch(`${SUPABASE_URL}/functions/v1/RequestInvoce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ vendedorId: userId }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error al obtener facturas: ${response.status} - ${errorText}`);
  }
  const result = await response.json();
  return saveInvoice(result.data || []);
};

export const saveInvoice = async (invoices) => {
  if (!invoices || invoices.length === 0) return true;
  const db = await getDbConnection();

  // Determinar facturas tramitadas en la caja actual para NO revertirlas a pendiente
  let tramitadasEnEstaCaja = new Set();
  let localConsecutivos = {};
  try {
    const cajaActual = await getCajaActual();
    const currentCajaId = cajaActual?.id || null;

    let queryPagos = `SELECT DISTINCT idFactura FROM pagos WHERE 1=1`;
    let params = [];
    if (currentCajaId) {
      queryPagos += ` AND (idCaja = ? OR date(substr(horaDispositivo,1,10)) = date('now','localtime'))`;
      params.push(currentCajaId);
    } else {
      queryPagos += ` AND date(substr(horaDispositivo,1,10)) = date('now','localtime')`;
    }
    const pagosRows = await getData(db, queryPagos, params);
    if (pagosRows) {
      for (const p of pagosRows) {
        if (p.idFactura) tramitadasEnEstaCaja.add(String(p.idFactura));
      }
    }

    // Preservar estado 'actualizado' y consecutivo de las facturas que ya están tramitadas localmente
    const localActualizadas = await getData(db, `SELECT id, consecutivoTramitado FROM facturas WHERE estadoMovil = 'actualizado'`);
    if (localActualizadas) {
      for (const a of localActualizadas) {
        if (a.id) {
          tramitadasEnEstaCaja.add(String(a.id));
          if (a.consecutivoTramitado) localConsecutivos[String(a.id)] = a.consecutivoTramitado;
        }
      }

    // Preservar coordenadas existentes localmente para no sobreescribirlas si el servidor devuelve null
    let localCoords = {};
    try {
      const rowsCoords = await getData(db, `SELECT id, latitud, longitud FROM facturas WHERE latitud IS NOT NULL AND latitud != ''`);
      if (rowsCoords) {
        for (const rc of rowsCoords) {
          if (rc.id) localCoords[String(rc.id)] = { latitud: rc.latitud, longitud: rc.longitud };
        }
      }
    } catch {}
    }

    // Si estamos online y hay caja abierta, consultar también movimientos del servidor para esta caja
    if (currentCajaId) {
      try {
        const { data: serverMovements } = await supabase
          .from('cash_movements')
          .select('id, descripcion')
          .eq('caja_id', currentCajaId);
        if (serverMovements) {
          for (const sm of serverMovements) {
            const match = (sm.descripcion || '').match(/factura\s+([a-f0-9\-]+)/i);
            if (match && match[1]) {
              tramitadasEnEstaCaja.add(String(match[1]));
            }
          }
        }
      } catch (errSup) {
        console.log('saveInvoice: error consultando cash_movements remotos:', errSup);
      }
    }
  } catch (err) {
    console.log('saveInvoice: error recopilando tramitadas:', err);
  }

  const tableContent = invoices.map(element => {
    let pagosStr = '[]';
    let ultimoPago = null;
    if (Array.isArray(element.pagos)) {
      pagosStr = JSON.stringify(element.pagos);
      ultimoPago = element.pagos[element.pagos.length - 1]?.payment_date || null;
    } else if (typeof element.pagos === 'string') {
      pagosStr = element.pagos;
      try {
        const parsed = JSON.parse(element.pagos);
        if (Array.isArray(parsed) && parsed.length > 0) {
          ultimoPago = parsed[parsed.length - 1]?.payment_date || null;
        }
      } catch {}
    }

    const invoiceIdStr = String(element.id);
    const isTramitada = tramitadasEnEstaCaja.has(invoiceIdStr);

    return {
      id: invoiceIdStr,
      apellidoUno: element.apellidoCliente || null,
      apellidoDos: null,
      celular: element.telefonocliente || null,
      cuotasPagas: Number(element.cuotasPagas) || 0,
      cuotasVencidas: Number(element.cuotasVencidas) || 0,
      detalles: element.detalles ? (typeof element.detalles === 'string' ? element.detalles : JSON.stringify([element.detalles])) : '[]',
      direccion: element.direccion || null,
      barrio: null,
      estado: element.estado || 'pendiente',
      estadoUsuario: element.estadoUsuario || null,
      facturaWriteDate: element.facturaWriteDate || null,
      latitud: element.latitud || localCoords[invoiceIdStr]?.latitud || null,
      longitud: element.longitud || localCoords[invoiceIdStr]?.longitud || null,
      nombreUno: element.nombreCliente || null,
      renovado: 'false',
      nombreUsuario: element.nombreUsuario || null,
      pagos: pagosStr,
      partnerId: element.partnerId || null,
      paymentTermId: element.paymentTermId || null,
      saldo: Number(element.saldo) || 0,
      saldoVencido: Number(element.saldoVencido) || 0,
      usuarioId: element.usuarioId || null,
      valorCuota: Number(element.valorCuota) || 0,
      valorInicial: Number(element.valorInicial) || 0,
      estadoMovil: isTramitada ? 'actualizado' : 'pendiente',
      fecha_vencimiento: element.fecha_vencimiento || null,
      fecha: element.fecha || null,
      alias: element.aliasCliente || null,
      documento: element.documentoCliente || null,
      num_cuotas: element.num_cuotas != null ? String(element.num_cuotas) : null,
      ultimo_pago: ultimoPago,
      consecutivoTramitado: isTramitada ? (localConsecutivos[invoiceIdStr] || 1) : 0,
    };
  });

  try {
    const cols = Object.keys(tableContent[0]);
    const placeholders = cols.map(() => '?').join(',');
    const sql = `INSERT OR REPLACE INTO facturas (${cols.join(',')}) VALUES (${placeholders})`;

    // Envolver en transacción atómica de SQLite para máximo rendimiento (de 10s a 50ms)
    await db.executeSql('BEGIN TRANSACTION');
    try {
      for (const item of tableContent) {
        await db.executeSql(sql, Object.values(item));
        if (item.estadoMovil === 'actualizado') {
          try {
            await db.executeSql(
              `UPDATE pagos SET estadoMovil = 'sincronizado' WHERE idFactura = ? AND estadoMovil = 'enviando'`,
              [item.id]
            );
          } catch {}
        }
      }
      await db.executeSql('COMMIT');
    } catch (txErr) {
      try { await db.executeSql('ROLLBACK'); } catch {}
      throw txErr;
    }

    console.log(`Guardadas ${tableContent.length} facturas en SQLite (transacción completada)`);
    return true;
  } catch (err) {
    console.error('Error en saveInvoice:', err);
    return false;
  }
};

