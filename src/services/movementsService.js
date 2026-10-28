import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import NetInfo from '@react-native-community/netinfo';
import { getDbConnection, getData } from '../database/db';
import { SyncWithSupabase } from '../utils/sync';
import { supabase } from '../lib/supabase';
import { saveMovimientoLocal } from './cajaService';

async function ensureLocationPermission() {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } else {
    const res = await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
    return res === RESULTS.GRANTED;
  }
}

export async function getCurrentLocationOrNull() {
  const ok = await ensureLocationPermission();
  if (!ok) return { lat: null, lng: null, denied: true };
  try {
    const pos = await new Promise((resolve, reject) =>
      Geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 10000,
      }),
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, denied: false };
  } catch {
    return { lat: null, lng: null, denied: false };
  }
}

export async function createCashMovement({ cajaId, tipo, descripcion, monto, latitud, longitud }) {
  if (!['ingreso', 'retiro', 'gasto'].includes(tipo)) throw new Error('Tipo debe ser ingreso, retiro o gasto');
  const val = Number(monto);
  if (!val || val <= 0) throw new Error('Monto debe ser > 0');
  if (!cajaId) throw new Error('No hay caja abierta');

  const db = await getDbConnection();
  const tempId = -Date.now();
  const nowIso = new Date().toISOString();
  const cleanDesc = descripcion?.trim() || '';
  const latStr = latitud != null ? String(latitud) : null;
  const lngStr = longitud != null ? String(longitud) : null;

  // Guardar en SQLite local inmediatamente (Offline-First)
  await db.executeSql(
    `INSERT INTO movimientos (id, descripcion, monto, horaDispositivo, tipo, estadoMovil, idCaja, caja_id, fecha, latitud, longitud)
     VALUES (?, ?, ?, ?, ?, 'actualizado', ?, ?, ?, ?, ?)`,
    [tempId, cleanDesc, val, nowIso, tipo, cajaId, cajaId, nowIso, latStr, lngStr]
  );

  // Actualizar saldo_final local de la caja
  try {
    if (tipo === 'ingreso') {
      await db.executeSql(`UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ? WHERE id = ?`, [val, cajaId]);
    } else if (tipo === 'retiro' || tipo === 'gasto') {
      await db.executeSql(`UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ? WHERE id = ?`, [val, cajaId]);
    }
  } catch {}

  // Intentar sincronización en segundo plano sin bloquear si no hay conexión
  try {
    SyncWithSupabase(false, () => {});
  } catch {}

  return { id: tempId, caja_id: cajaId, tipo, descripcion: cleanDesc, monto: val, fecha: nowIso, estadoMovil: 'actualizado', latitud: latStr, longitud: lngStr };
}

export async function updateCashMovement({ id, tipo, descripcion, monto, cajaId, profile }) {
  const val = Number(monto);
  if (!val || val <= 0) throw new Error('Monto debe ser mayor que 0');

  const db = await getDbConnection();
  const rows = await getData(db, `SELECT * FROM movimientos WHERE id = ?`, [id]);
  if (!rows || rows.length === 0) throw new Error('Movimiento no encontrado');
  const current = rows[0];
  const oldVal = Number(current.monto != null ? current.monto : current.valor) || 0;
  const delta = val - oldVal;
  const targetTipo = tipo || current.tipo;

  // Validaciones de negocio según tipo y perfil
  if (targetTipo === 'retiro' || targetTipo === 'gasto') {
    const maxGasto = parseFloat(profile?.dinero_max_gasto) || 0;
    if (maxGasto > 0 && val > maxGasto) {
      throw new Error(`El monto ($${val.toLocaleString('es-CO')}) excede tu límite máximo permitido por gasto ($${maxGasto.toLocaleString('es-CO')}).`);
    }
  } else if (targetTipo === 'pago') {
    if (!profile?.permite_modificar_pagos) {
      throw new Error('No tienes autorización para modificar pagos.');
    }
  } else if (targetTipo === 'venta') {
    throw new Error('El monto de una venta no puede modificarse directamente. Debe anularse si tiene autorización.');
  }

  const cleanDesc = descripcion?.trim() || current.descripcion || '';

  // Actualizar en SQLite
  await db.executeSql(
    `UPDATE movimientos
     SET descripcion = ?, monto = ?, estadoMovil = 'actualizado'
     WHERE id = ?`,
    [cleanDesc, val, id]
  );

  // Si es un pago, actualizar también tabla pagos y saldo de factura
  if (targetTipo === 'pago' && current.idFactura) {
    try {
      await db.executeSql(`UPDATE pagos SET valor = ?, estadoMovil = 'actualizado' WHERE id = ?`, [val, id]);
      await db.executeSql(
        `UPDATE facturas SET saldo = MAX(0, saldo - ?) WHERE id = ?`,
        [delta, current.idFactura]
      );
    } catch (ePay) {
      console.log('Error actualizando pago asociado:', ePay);
    }
  }

  // Actualizar saldo de caja según tipo
  const cid = cajaId || current.caja_id || current.idCaja;
  if (cid && delta !== 0) {
    try {
      if (targetTipo === 'ingreso' || targetTipo === 'pago') {
        await db.executeSql(`UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ? WHERE id = ?`, [delta, cid]);
      } else if (targetTipo === 'retiro' || targetTipo === 'gasto') {
        await db.executeSql(`UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ? WHERE id = ?`, [delta, cid]);
      }
    } catch {}
  }

  // Sincronizar en segundo plano
  try {
    SyncWithSupabase(false, () => {});
  } catch {}

  return { id, tipo: targetTipo, descripcion: cleanDesc, monto: val, estadoMovil: 'actualizado' };
}

/**
 * Consulta y reconciliación optimizada de movimientos (Offline-First, ultra rápida)
 */
export async function listMovimientos({ cajaId, limit = 50, offset = 0, search = '', forceRemote = false }) {
  let targetCajaId = cajaId;
  const db = await getDbConnection();

  // Helper para enriquecer movimientos con nombres de clientes
  const enrichMovements = async (rawList) => {
    try {
      const facturas = await getData(db, `SELECT id, nombreUno, apellidoUno, alias FROM facturas`);
      const mapFacturas = new Map();
      if (facturas) {
        for (const f of facturas) {
          mapFacturas.set(String(f.id), f);
        }
      }
      return rawList.map(m => {
        let clienteNombre = m.cliente_nombre || null;
        if (!clienteNombre && m.descripcion) {
          const match = m.descripcion.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          if (match && mapFacturas.has(match[0])) {
            const f = mapFacturas.get(match[0]);
            clienteNombre = `${f.nombreUno || ''} ${f.apellidoUno || ''}`.trim() + (f.alias ? ` (${f.alias})` : '');
          }
        }
        return {
          ...m,
          cliente_nombre: clienteNombre,
        };
      });
    } catch {
      return rawList;
    }
  };

  // 1. OFFLINE-FIRST: Leer inmediatamente desde SQLite local (latencia < 15ms)
  let localRows = [];
  try {
    let sql = `SELECT id, tipo, descripcion, monto, COALESCE(horaDispositivo, fecha) AS fecha, COALESCE(caja_id, idCaja) AS caja_id, estadoMovil, latitud, longitud, idFactura, cliente_nombre FROM movimientos WHERE 1=1`;
    const params = [];
    if (targetCajaId) {
      sql += ` AND (idCaja = ? OR caja_id = ?)`;
      params.push(String(targetCajaId), String(targetCajaId));
    }
    if (search && search.trim()) {
      sql += ` AND (descripcion LIKE ? OR cliente_nombre LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }
    sql += ` ORDER BY COALESCE(horaDispositivo, fecha) DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    localRows = await getData(db, sql, params);
  } catch (err) {
    console.log('listMovimientos local query error:', err);
  }

  // Si encontramos registros locales y no se forzó consulta remota síncrona, devolverlos de inmediato
  if (localRows && localRows.length > 0 && !forceRemote) {
    return await enrichMovements(localRows);
  }

  // 2. Si no hay datos locales o se forzó refresco, consultar Supabase
  try {
    const net = await NetInfo.fetch();
    if (net.isConnected) {
      let q = supabase
        .from('cash_movements')
        .select('id, tipo, descripcion, monto, fecha, caja_id')
        .order('fecha', { ascending: false })
        .range(offset, offset + limit - 1);

      if (targetCajaId) {
        q = q.eq('caja_id', targetCajaId);
      }
      if (search && search.trim()) {
        q = q.ilike('descripcion', `%${search.trim()}%`);
      }

      const { data: serverMovements, error } = await q;

      if (!error && serverMovements) {
        // Envolver guardado en SQLite en transacción atómica de alto rendimiento
        try {
          await db.executeSql('BEGIN TRANSACTION');
          for (const sm of serverMovements) {
            await saveMovimientoLocal(db, sm, sm.caja_id || targetCajaId, 'sincronizado');
          }
          for (const sm of serverMovements) {
            await db.executeSql(
              `DELETE FROM movimientos WHERE id < 0 AND tipo = ? AND monto = ? AND descripcion = ?`,
              [sm.tipo, Number(sm.monto), sm.descripcion || '']
            );
          }
          await db.executeSql('COMMIT');
        } catch (txErr) {
          try { await db.executeSql('ROLLBACK'); } catch {}
        }

        // Consultar de nuevo SQLite local tras reconciliación
        let refreshedSql = `SELECT id, tipo, descripcion, monto, COALESCE(horaDispositivo, fecha) AS fecha, COALESCE(caja_id, idCaja) AS caja_id, estadoMovil, latitud, longitud, idFactura, cliente_nombre FROM movimientos WHERE 1=1`;
        const rParams = [];
        if (targetCajaId) {
          refreshedSql += ` AND (idCaja = ? OR caja_id = ?)`;
          rParams.push(String(targetCajaId), String(targetCajaId));
        }
        if (search && search.trim()) {
          refreshedSql += ` AND (descripcion LIKE ? OR cliente_nombre LIKE ?)`;
          rParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }
        refreshedSql += ` ORDER BY COALESCE(horaDispositivo, fecha) DESC LIMIT ? OFFSET ?`;
        rParams.push(limit, offset);

        const refreshed = await getData(db, refreshedSql, rParams);
        return await enrichMovements(refreshed || []);
      }
    }
  } catch (netErr) {
    console.log('listMovimientos: red no disponible o error servidor, usando SQLite local:', netErr);
  }

  return await enrichMovements(localRows || []);
}

/**
 * Transferencia espejo atomica entre dos cajas (Retiro en origen + Ingreso en destino)
 */
export async function transferBetweenBoxes({ sourceCajaId, destCajaId, monto, descripcion }) {
  const val = Number(monto);
  if (!val || val <= 0) throw new Error('El monto debe ser mayor a 0');
  if (!sourceCajaId || !destCajaId) throw new Error('Debe especificar caja origen y caja destino');

  const { data, error } = await supabase.rpc('rpc_cash_transfer', {
    p_source_caja_id: sourceCajaId,
    p_dest_caja_id: destCajaId,
    p_monto: val,
    p_descripcion: descripcion?.trim() || 'Transferencia entre cajas',
  });

  if (error) throw new Error(error.message || 'Error en la transferencia');

  try {
    const db = await getDbConnection();
    await db.executeSql(`UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ? WHERE id = ?`, [val, sourceCajaId]);
  } catch {}

  return data;
}

/**
 * Anulacion estricta de venta / credito (solo si no tiene abonos registrados)
 */
export async function cancelInvoiceSale(invoiceId, motivo = '') {
  if (!invoiceId) throw new Error('ID de factura requerido');
  const { data, error } = await supabase.rpc('rpc_cancel_sale', {
    p_invoice_id: invoiceId,
    p_motivo: motivo,
  });
  if (error) throw new Error(error.message || 'Error al cancelar la venta');
  return data;
}
