import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { getCajaActual, saveCajaLocal, saveMovimientoLocal, getPendingSyncCount } from './cajaService';
import { clearAllLocalData } from '../utils/clearLocal';
import { EvaluationDataSend } from '../utils/utilities';
import { setAuthServiceRunning } from '../context/AuthContext';

const SUPABASE_URL = 'https://gwpwntdwogxzmtegaaom.supabase.co';

export function hashOfflinePassword(pwd) {
  if (!pwd) return '';
  let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
  const str = 'zenda_auth_salt_v1_' + pwd;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
}

export const AuthService = async (db, email, password) => {
  setAuthServiceRunning(true);
  try {
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanPassword = (password || '').trim();

    // 1. Verificar conectividad a internet
    let isConnected = true;
    try {
      const net = await NetInfo.fetch();
      isConnected = !!net.isConnected && (net.isInternetReachable !== false);
    } catch (e) {
      console.log('Error verificando NetInfo:', e);
    }

    let onlineAuthResult = null;
    let isOfflineLogin = false;

    if (isConnected) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword });
        if (error) {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('connection')) {
            isOfflineLogin = true;
          } else {
            return { success: false, message: error.message || 'Usuario o contrasena incorrectos' };
          }
        } else if (data?.session) {
          onlineAuthResult = data;
        }
      } catch (errAuth) {
        console.log('Error de red durante signInWithPassword:', errAuth);
        isOfflineLogin = true;
      }
    } else {
      isOfflineLogin = true;
    }

    // =========================================================================
    // CASO A: INICIO DE SESION OFFLINE (Sin internet o falla de red)
    // =========================================================================
    if (isOfflineLogin) {
      console.log('Iniciando sesion en modo OFFLINE para:', cleanEmail);

      const params = await getData(db, `SELECT id, valor FROM parametrizacion WHERE id IN (2, 3, 4, 5, 6, 7, 8)`);
      const pMap = {};
      params?.forEach(p => { pMap[p.id] = p.valor; });

      const cachedToken = pMap[2];
      const cachedEmail = (pMap[3] || '').toLowerCase().trim();
      const cachedHash = pMap[4];
      const cachedUserId = pMap[5];
      const cachedRol = pMap[6] || 'vendedor';
      const cachedNombre = pMap[7] || 'Usuario';
      const cachedSuperiorId = pMap[8];

      if (!cachedUserId || !cachedEmail) {
        return {
          success: false,
          message: 'No hay datos de sesion guardados en este dispositivo. Debes conectarte a internet al menos una vez para iniciar sesion.',
        };
      }

      if (cleanEmail !== cachedEmail) {
        return {
          success: false,
          message: 'No tienes conexion a internet. Para iniciar sesion con una cuenta diferente debes conectarte a internet.',
        };
      }

      const inputHash = hashOfflinePassword(cleanPassword);
      if (cachedHash && inputHash !== cachedHash) {
        return {
          success: false,
          message: 'Contrasena incorrecta (modo sin conexion).',
        };
      }

      const isAdmin = cachedRol === 'admin' || cachedRol === 'superadmin';
      let tieneCajaAbierta = false;
      let localCaja = null;
      try {
        const cajas = await getData(
          db,
          `SELECT * FROM cajas WHERE estado = 'abierta' ORDER BY fecha_apertura DESC LIMIT 1`
        );
        if (cajas && cajas.length > 0) {
          tieneCajaAbierta = true;
          localCaja = cajas[0];
        }
      } catch (e) {
        console.log('Error verificando caja local offline:', e);
      }

      if (!isAdmin && !tieneCajaAbierta) {
        return {
          success: false,
          message: 'No tienes una caja abierta en este telefono para trabajar sin conexion. Conectate a internet para que tu administrador realice la apertura de tu caja.',
        };
      }

      let cachedProfile = null;
      try {
        const pStr = await AsyncStorage.getItem('cached_profile');
        if (pStr) cachedProfile = JSON.parse(pStr);
      } catch {}

      const offlineProfile = cachedProfile || {
        id: cachedUserId,
        nombre: cachedNombre,
        rol: cachedRol,
        superior_id: cachedSuperiorId,
        activo: true,
      };

      const offlineSession = {
        access_token: cachedToken || `offline_token_${cachedUserId}`,
        user: {
          id: cachedUserId,
          email: cachedEmail,
        },
        isOffline: true,
      };

      return {
        success: true,
        user: offlineSession.user,
        session: offlineSession,
        profile: offlineProfile,
        isOffline: true,
      };
    }

    // =========================================================================
    // CASO B: INICIO DE SESION ONLINE (Conexion exitosa con Supabase)
    // =========================================================================
    const { access_token } = onlineAuthResult.session;
    const userId = onlineAuthResult.user.id;

    // 1. Deteccion y proteccion de cambio de usuario
    let prevUserId = null;
    try {
      const pUser = await getData(db, `SELECT valor FROM parametrizacion WHERE id = 5 LIMIT 1`);
      prevUserId = pUser?.[0]?.valor;
    } catch (e) {
      console.log('Error leyendo usuario previo de parametrizacion:', e);
    }

    if (prevUserId && prevUserId !== userId) {
      const hasPendingData = await EvaluationDataSend();
      const pendingCount = await getPendingSyncCount();
      if (hasPendingData || pendingCount > 0) {
        await supabase.auth.signOut();
        return {
          success: false,
          message: 'Hay datos del usuario anterior sin sincronizar en este dispositivo. Para evitar perdida de informacion contable o mezcla de dinero, inicia sesion con la cuenta anterior y realiza la sincronizacion antes de cambiar de usuario.',
        };
      }
      await clearAllLocalData();
    }

    // Guardar credenciales de sesion en parametrizacion (incluyendo login y hash para offline login)
    await Promise.all([
      updateData(db, 'parametrizacion', { id: 2, valor: access_token }),
      updateData(db, 'parametrizacion', { id: 3, valor: cleanEmail }),
      updateData(db, 'parametrizacion', { id: 4, valor: hashOfflinePassword(cleanPassword) }),
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

    if (profile && profile.activo === false) {
      await supabase.auth.signOut();
      return {
        success: false,
        message: 'Tu cuenta ha sido inhabilitada por el administrador. Contacta a tu administrador para mas informacion.',
      };
    }

    const isAdmin = profile?.rol === 'admin' || profile?.rol === 'superadmin';
    let tieneCajaAbierta = caja && caja.id && caja.estado === 'abierta';

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

    if (!isAdmin && !tieneCajaAbierta) {
      await supabase.auth.signOut();
      return {
        success: false,
        message: 'No puedes iniciar sesion porque no tienes una caja abierta. Tu administrador debe realizar la apertura de tu caja antes de que puedas comenzar a trabajar.',
      };
    }

    if (profile) {
      await Promise.all([
        updateData(db, 'parametrizacion', { id: 6, valor: profile.rol }),
        updateData(db, 'parametrizacion', { id: 7, valor: profile.nombre }),
        updateData(db, 'parametrizacion', { id: 8, valor: profile.superior_id }),
      ]);
      try {
        await AsyncStorage.setItem('cached_profile', JSON.stringify(profile));
      } catch {}
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
    return { success: true, user: onlineAuthResult.user, session: onlineAuthResult.session, profile, isOffline: false };
  } catch (err) {
    console.error('Error en AuthService:', err);
    return { success: false, message: err.message || 'Error desconocido' };
  } finally {
    setAuthServiceRunning(false);
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
  let localCoords = {};
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
    }

    // Preservar coordenadas existentes localmente para no sobreescribirlas si el servidor devuelve null
    try {
      const rowsCoords = await getData(db, `SELECT id, latitud, longitud FROM facturas WHERE latitud IS NOT NULL AND latitud != ''`);
      if (rowsCoords) {
        for (const rc of rowsCoords) {
          if (rc.id) localCoords[String(rc.id)] = { latitud: rc.latitud, longitud: rc.longitud };
        }
      }
    } catch {}

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

