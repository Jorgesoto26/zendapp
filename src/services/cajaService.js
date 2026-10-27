import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import { getDbConnection, getData } from '../database/db';

export async function saveCajaLocal(db, caja, userId = null) {
  if (!caja || !caja.id) return;
  const uid = userId || caja.usuario_id || null;
  const fecha = caja.fecha_apertura || caja.fecha || new Date().toISOString();
  const estado = caja.estado || 'abierta';
  const saldoIni = Number(caja.saldo_inicial) || 0;
  const saldoFin = caja.saldo_final != null ? Number(caja.saldo_final) : null;
  const fechaCierre = caja.fecha_cierre || null;
  const adminCajaId = caja.admin_caja_id || null;

  try {
    await db.executeSql(
      `INSERT OR REPLACE INTO cajas (
        id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha_cierre, usuario_id, fecha, admin_caja_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(caja.id), estado, saldoIni, saldoFin, fecha, fechaCierre, uid, fecha, adminCajaId]
    );
  } catch (err) {
    try {
      await db.executeSql(
        `INSERT OR REPLACE INTO cajas (
          id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [String(caja.id), estado, saldoIni, saldoFin, fecha, fecha]
      );
    } catch (e2) {
      console.log('saveCajaLocal fallback error:', e2);
    }
  }
}

export async function saveMovimientoLocal(db, m, cajaId = null, estadoMovil = 'sincronizado') {
  if (!m || !m.id) return;
  const targetCajaId = cajaId || m.caja_id || m.idCaja || null;
  const fecha = m.fecha || m.horaDispositivo || new Date().toISOString();
  const cid = targetCajaId ? String(targetCajaId) : null;
  const tipo = m.tipo || 'ingreso';
  const desc = m.descripcion || '';
  const monto = Number(m.monto != null ? m.monto : m.valor) || 0;

  try {
    await db.executeSql(
      `INSERT OR REPLACE INTO movimientos (
        id, tipo, descripcion, monto, fecha, horaDispositivo, idCaja, caja_id, estadoMovil
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(m.id), tipo, desc, monto, fecha, fecha, cid, cid, estadoMovil]
    );
  } catch (err) {
    try {
      await db.executeSql(
        `INSERT OR REPLACE INTO movimientos (
          id, tipo, descripcion, monto, horaDispositivo, idCaja, estadoMovil
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [String(m.id), tipo, desc, monto, fecha, cid, estadoMovil]
      );
    } catch (e2) {
      console.log('saveMovimientoLocal fallback error:', e2);
    }
  }
}

async function getCajaActualLocal(db) {
  try {
    let userId = null;
    try {
      const p = await getData(db, `SELECT valor FROM parametrizacion WHERE id = 5 LIMIT 1`);
      userId = p?.[0]?.valor || null;
    } catch { }

    let rows = [];
    if (userId) {
      try {
        rows = await getData(
          db,
          `SELECT * FROM cajas WHERE estado = 'abierta' AND (usuario_id = ? OR usuario_id IS NULL OR usuario_id = '') ORDER BY COALESCE(fecha_apertura, fecha) DESC LIMIT 1`,
          [userId]
        );
      } catch { }
    }
    if (!rows || rows.length === 0) {
      try {
        rows = await getData(
          db,
          `SELECT * FROM cajas WHERE estado = 'abierta' ORDER BY COALESCE(fecha_apertura, fecha) DESC LIMIT 1`
        );
      } catch { }
    }
    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.log('getCajaActualLocal error:', err);
  }
  return null;
}

export async function getCajaActual() {
  const db = await getDbConnection();

  // 1. Si no hay conexión (Offline-First), consultar SQLite de inmediato sin tocar Supabase
  try {
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      return await getCajaActualLocal(db);
    }
  } catch { }

  // 2. Si hay conexión, consultar Supabase
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (userId) {
      const { data, error } = await supabase
        .from('cajas')
        .select('*')
        .eq('usuario_id', userId)
        .eq('estado', 'abierta')
        .order('fecha_apertura', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error) {
        if (data) {
          await saveCajaLocal(db, data, userId);
          return data;
        } else {
          // Servidor confirma que no hay caja abierta
          try {
            await db.executeSql(`UPDATE cajas SET estado = 'cerrada' WHERE usuario_id = ?`, [userId]);
          } catch { }
          return null;
        }
      }
    }
  } catch (err) {
    console.log('getCajaActual: red o servidor error, usando fallback SQLite local:', err);
  }

  // 3. Fallback a SQLite local si la consulta a red falló
  return await getCajaActualLocal(db);
}

export async function getHistorialCajas(limit = 20, offset = 0) {
  const db = await getDbConnection();

  try {
    const net = await NetInfo.fetch();
    if (net.isConnected) {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (userId) {
        const { data, error } = await supabase
          .from('cajas')
          .select('id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha_cierre')
          .eq('usuario_id', userId)
          .order('fecha_apertura', { ascending: false })
          .range(offset, offset + limit - 1);

        if (!error && data) {
          for (const c of data) {
            await saveCajaLocal(db, c, userId);
          }
          return data;
        }
      }
    }
  } catch (err) {
    console.log('getHistorialCajas: error servidor, usando fallback SQLite:', err);
  }

  // Fallback offline desde SQLite local
  try {
    const rows = await getData(
      db,
      `SELECT id, estado, saldo_inicial, saldo_final, COALESCE(fecha_apertura, fecha) AS fecha_apertura, fecha_cierre FROM cajas ORDER BY COALESCE(fecha_apertura, fecha) DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows || [];
  } catch {
    try {
      return (await getData(
        db,
        `SELECT id, estado, saldo_inicial, saldo_final, fecha_apertura FROM cajas ORDER BY fecha_apertura DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      )) || [];
    } catch {
      return [];
    }
  }
}

export async function abrirCaja(saldoInicial = 0) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('No autenticado');
  const userId = session.user.id;

  // Solo el administrador tiene permiso de abrir cajas
  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.rol !== 'admin' && profile?.rol !== 'superadmin') {
    throw new Error('Solo el administrador puede realizar la apertura de cajas.');
  }

  // El admin puede tener hasta 3 cajas abiertas simultáneamente
  const { data: abiertas, error: countErr } = await supabase
    .from('cajas')
    .select('id')
    .eq('usuario_id', userId)
    .eq('estado', 'abierta');

  if (abiertas && abiertas.length >= 3) {
    throw new Error('Tienes 3 cajas abiertas al mismo tiempo. Debes cerrar al menos una de tus cajas antes de poder abrir una nueva.');
  }

  const { data, error } = await supabase
    .from('cajas')
    .insert([{ usuario_id: userId, estado: 'abierta', saldo_inicial: Number(saldoInicial) || 0 }])
    .select()
    .single();
  if (error) throw error;

  // Guardar inmediatamente en SQLite local con estado 'abierta'
  if (data) {
    const db = await getDbConnection();
    await saveCajaLocal(db, data, userId);
  }

  return data;
}

/**
 * Cuenta cuantos registros pendientes de sincronizar existen en SQLite local
 */
export async function getPendingSyncCount() {
  const db = await getDbConnection();
  let count = 0;

  // Requisito 11: Solo contar registros que verdaderamente estan pendientes y NO sincronizados
  try {
    const movs = await getData(
      db,
      `SELECT COUNT(*) as c FROM movimientos
       WHERE (((id < 0 OR id LIKE '-%' OR id LIKE 'temp-%') AND estadoMovil != 'sincronizado')
          OR estadoMovil IN ('actualizado', 'enviando'))`
    );
    count += Number(movs?.[0]?.c || 0);
  } catch {}

  try {
    const ventas = await getData(
      db,
      `SELECT COUNT(*) as c FROM ventas_pendientes WHERE estado IN ('pendiente', 'enviando')`
    );
    count += Number(ventas?.[0]?.c || 0);
  } catch {}

  try {
    const pagos = await getData(
      db,
      `SELECT COUNT(*) as c FROM pagos
       WHERE (((id < 0 OR id LIKE '-%' OR id LIKE 'temp-%') AND estadoMovil != 'sincronizado')
          OR estadoMovil IN ('actualizado', 'enviando'))`
    );
    count += Number(pagos?.[0]?.c || 0);
  } catch {}

  return count;
}

export async function cerrarCaja(cajaId, { validateRoute = false } = {}) {
  // 1. Validar que no haya registros pendientes por sincronizar
  const pendingCount = await getPendingSyncCount();
  if (pendingCount > 0) {
    throw new Error(
      `Tienes ${pendingCount} movimiento(s) guardado(s) en tu teléfono pendientes por enviar. Activa tu internet y presiona 'Sincronizar' para asegurar tu dinero antes de cerrar la caja.`
    );
  }

  // 1.1 Si se solicita validación de ruta (cierre de vendedor), validar clientes pendientes
  if (validateRoute) {
    try {
      const db = await getDbConnection();
      const pend = await getData(db, `SELECT COUNT(*) as c FROM facturas WHERE estadoMovil = 'pendiente' AND saldo > 0`);
      const pendCount = Number(pend?.[0]?.c || 0);
      if (pendCount > 0) {
        throw new Error(
          `Aún tienes ${pendCount} cliente(s) por visitar hoy. Termina tu recorrido o registra los cobros antes de cerrar la caja.`
        );
      }
    } catch (e) {
      if (e.message && e.message.includes('cliente(s) por visitar')) {
        throw e;
      }
    }
  }

  // 2. Exigir conexión a internet para cerrar y cuadrar con el servidor
  let isConnected = false;
  try {
    const net = await NetInfo.fetch();
    isConnected = !!net.isConnected;
  } catch {}

  if (!isConnected) {
    throw new Error(
      'Necesitas conexión a internet para poder cerrar tu caja y cuadrar las cuentas del día. Activa tus datos móviles o conéctate a una red Wi-Fi e inténtalo de nuevo.'
    );
  }

  // 3. Invocar RPC rpc_close_box (valida que ningún subordinado tenga caja abierta y calcula saldo atómicamente)
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('rpc_close_box', {
    p_caja_id: cajaId,
  });

  if (rpcErr) {
    throw new Error(rpcErr.message || 'Error cerrando la caja en el servidor');
  }

  const saldoFinal = rpcRes?.saldo_final || 0;
  const fechaCierre = new Date().toISOString();

  // 4. Actualizar inmediatamente en SQLite local con estado 'cerrada'
  try {
    const db = await getDbConnection();
    await db.executeSql(
      `UPDATE cajas SET estado = 'cerrada', fecha_cierre = ?, saldo_final = ? WHERE id = ?`,
      [fechaCierre, saldoFinal, String(cajaId)]
    );
  } catch (e) {
    console.log('Error actualizando cierre de caja local:', e);
  }

  return { id: cajaId, estado: 'cerrada', saldo_final: saldoFinal, fecha_cierre: fechaCierre };
}

export async function getMovimientosCaja(cajaId, limit = 50, offset = 0) {
  if (!cajaId) return [];
  const db = await getDbConnection();

  // 1. Si hay red, consultar movimientos desde Supabase y cachear en SQLite
  try {
    const net = await NetInfo.fetch();
    if (net.isConnected) {
      const { data, error } = await supabase
        .from('cash_movements')
        .select('id, tipo, descripcion, monto, fecha')
        .eq('caja_id', cajaId)
        .order('fecha', { ascending: false })
        .range(offset, offset + limit - 1);

      if (!error && data) {
        for (const m of data) {
          await saveMovimientoLocal(db, m, cajaId, 'sincronizado');
        }
        return data;
      }
    }
  } catch (err) {
    console.log('getMovimientosCaja: error servidor, usando fallback SQLite:', err);
  }

  // 2. Fallback offline a SQLite local
  try {
    const rows = await getData(
      db,
      `SELECT id, tipo, descripcion, monto, COALESCE(horaDispositivo, fecha) AS fecha, estadoMovil FROM movimientos WHERE (idCaja = ? OR caja_id = ?) ORDER BY COALESCE(horaDispositivo, fecha) DESC LIMIT ? OFFSET ?`,
      [String(cajaId), String(cajaId), limit, offset]
    );
    if (rows && rows.length > 0) return rows;
  } catch { }

  try {
    return (await getData(
      db,
      `SELECT id, tipo, descripcion, monto, COALESCE(horaDispositivo, fecha) AS fecha, estadoMovil FROM movimientos WHERE idCaja = ? ORDER BY COALESCE(horaDispositivo, fecha) DESC LIMIT ? OFFSET ?`,
      [String(cajaId), limit, offset]
    )) || [];
  } catch {
    return [];
  }
}
