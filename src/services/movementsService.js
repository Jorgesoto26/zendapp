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

export async function updateCashMovement({ id, monto, cajaId, profile, motivo }) {
  const val = Number(monto);
  if (isNaN(val)) throw new Error('Monto inválido');

  const db = await getDbConnection();
  const rows = await getData(db, `SELECT * FROM movimientos WHERE id = ?`, [id]);
  if (!rows || rows.length === 0) throw new Error('Movimiento no encontrado');
  const current = rows[0];

  // REGLA 3.1: Solo movimientos ya sincronizados con id positivo / persistido en el servidor
  const isPending =
    current.estadoMovil !== 'sincronizado' ||
    (typeof current.id === 'number' && current.id < 0) ||
    (typeof current.id === 'string' && (current.id.startsWith('-') || current.id.startsWith('temp-')));

  if (isPending) {
    throw new Error('Solo se pueden editar movimientos que ya hayan sido sincronizados con el servidor. Sincroniza antes de editar.');
  }

  // REGLA 3.2: PROHIBIDO EDITAR INGRESO O RETIRO
  if (current.tipo === 'ingreso' || current.tipo === 'retiro') {
    throw new Error('Los movimientos de ingreso y retiro no pueden ser modificados.');
  }

  // REGLA VENTA: Inmutable directamente
  if (current.tipo === 'venta') {
    throw new Error('El monto de una venta no puede modificarse directamente. Debe anularse la venta si cuenta con autorización.');
  }

  const oldVal = Number(current.monto != null ? current.monto : current.valor) || 0;
  let targetTipo = current.tipo;
  let cleanDesc = current.descripcion || '';
  let delta = 0;
  const cid = cajaId || current.caja_id || current.idCaja;

  // REGLA 3.3: Límite máximo para gastos (dinero_max_gasto)
  if (current.tipo === 'gasto') {
    if (val <= 0) throw new Error('El monto del gasto debe ser mayor que 0');
    const maxGasto = parseFloat(profile?.dinero_max_gasto) || 0;
    if (maxGasto > 0 && val > maxGasto) {
      throw new Error(`El monto ($${val.toLocaleString('es-CO')}) excede tu límite máximo permitido por gasto ($${maxGasto.toLocaleString('es-CO')}).`);
    }

    targetTipo = 'gasto';
    delta = val - oldVal;

    // Actualizar en SQLite
    await db.executeSql(
      `UPDATE movimientos SET monto = ?, estadoMovil = 'actualizado' WHERE id = ?`,
      [val, id]
    );

    // Ajustar caja (gastos restan de la caja)
    if (cid && delta !== 0) {
      try {
        await db.executeSql(
          `UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ? WHERE id = ?`,
          [delta, cid]
        );
      } catch {}
    }
  }

  // REGLA 3.4: Edición de pagos y no pagos con validación de saldo y conversión automática
  else if (current.tipo === 'pago' || current.tipo === 'nopago') {
    if (!profile?.permite_modificar_pagos) {
      throw new Error('No tienes autorización para modificar pagos.');
    }
    if (val < 0) {
      throw new Error('El monto no puede ser negativo.');
    }

    // Localizar idFactura
    let idFactura = current.idFactura || null;
    if (!idFactura && current.descripcion) {
      const match = current.descripcion.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (match) idFactura = match[0];
    }

    let facturaRow = null;
    if (idFactura) {
      try {
        const fRows = await getData(db, `SELECT * FROM facturas WHERE id = ?`, [idFactura]);
        if (fRows && fRows.length > 0) facturaRow = fRows[0];
      } catch {}
    }

    const saldoPendiente = facturaRow ? Number(facturaRow.saldo || 0) : 0;
    const maxPermitido = saldoPendiente + oldVal;

    if (facturaRow && val > maxPermitido) {
      throw new Error(`El monto ($${val.toLocaleString('es-CO')}) supera el saldo pendiente del crédito ($${maxPermitido.toLocaleString('es-CO')}).`);
    }

    // Caso A: Pago editado a monto 0 -> Se convierte automáticamente a 'nopago'
    if (current.tipo === 'pago' && val === 0) {
      targetTipo = 'nopago';
      delta = -oldVal;
      cleanDesc = (current.descripcion || 'No pago').replace(/pago/i, 'No pago');

      await db.executeSql(
        `UPDATE movimientos SET tipo = 'nopago', monto = 0, descripcion = ?, estadoMovil = 'actualizado' WHERE id = ?`,
        [cleanDesc, id]
      );
      try {
        await db.executeSql(`DELETE FROM pagos WHERE id = ?`, [id]);
      } catch {}

      if (idFactura) {
        try {
          await db.executeSql(
            `UPDATE facturas SET saldo = saldo + ?, cuotasPagas = MAX(0, cuotasPagas - 1), estado = 'pendiente' WHERE id = ?`,
            [oldVal, idFactura]
          );
        } catch {}
      }

      if (cid && delta !== 0) {
        try {
          await db.executeSql(
            `UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ? WHERE id = ?`,
            [delta, cid]
          );
        } catch {}
      }
    }

    // Caso B: No pago editado a monto > 0 -> Se convierte automáticamente a 'pago'
    else if (current.tipo === 'nopago' && val > 0) {
      targetTipo = 'pago';
      delta = val;
      cleanDesc = (current.descripcion || 'Pago').replace(/no\s*pago/i, 'Pago');

      await db.executeSql(
        `UPDATE movimientos SET tipo = 'pago', monto = ?, descripcion = ?, estadoMovil = 'actualizado' WHERE id = ?`,
        [val, cleanDesc, id]
      );

      try {
        await db.executeSql(
          `INSERT OR REPLACE INTO pagos (id, idFactura, valor, horaDispositivo, tipo, estadoMovil) VALUES (?, ?, ?, ?, 'efectivo', 'actualizado')`,
          [id, idFactura, val, new Date().toISOString()]
        );
      } catch {}

      if (idFactura) {
        try {
          const nuevoSaldo = Math.max(0, saldoPendiente - val);
          const nuevoEstado = nuevoSaldo <= 0 ? 'pagada' : 'abonada';
          await db.executeSql(
            `UPDATE facturas SET saldo = ?, cuotasPagas = cuotasPagas + 1, estado = ? WHERE id = ?`,
            [nuevoSaldo, nuevoEstado, idFactura]
          );
        } catch {}
      }

      if (cid && delta !== 0) {
        try {
          await db.executeSql(
            `UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ? WHERE id = ?`,
            [delta, cid]
          );
        } catch {}
      }
    }

    // Caso C: Pago editado a otro monto > 0
    else {
      targetTipo = 'pago';
      delta = val - oldVal;

      await db.executeSql(
        `UPDATE movimientos SET monto = ?, estadoMovil = 'actualizado' WHERE id = ?`,
        [val, id]
      );

      try {
        await db.executeSql(
          `UPDATE pagos SET valor = ?, estadoMovil = 'actualizado' WHERE id = ?`,
          [val, id]
        );
      } catch {}

      if (idFactura) {
        try {
          const nuevoSaldo = Math.max(0, saldoPendiente - delta);
          const nuevoEstado = nuevoSaldo <= 0 ? 'pagada' : 'abonada';
          await db.executeSql(
            `UPDATE facturas SET saldo = ?, estado = ? WHERE id = ?`,
            [nuevoSaldo, nuevoEstado, idFactura]
          );
        } catch {}
      }

      if (cid && delta !== 0) {
        try {
          await db.executeSql(
            `UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ? WHERE id = ?`,
            [delta, cid]
          );
        } catch {}
      }
    }
  }

  // REGLA 6: Registro de trazabilidad y auditoría local
  try {
    const nowIso = new Date().toISOString();
    await db.executeSql(
      `INSERT INTO movimientos_audit (movement_id, user_id, tipo_anterior, tipo_nuevo, monto_anterior, monto_nuevo, motivo, origen, fecha, estadoMovil)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'app_movil', ?, 'pendiente')`,
      [String(id), profile?.id || null, current.tipo, targetTipo, oldVal, val, motivo || 'Edición de movimiento', nowIso]
    );
  } catch (errAudit) {
    console.log('Error registrando auditoria local:', errAudit);
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
  let result = null;
  // Llamar rpc_delete_sale con verificación estricta de permisos y sin pagos (Requisito 4)
  const { data, error } = await supabase.rpc('rpc_delete_sale', {
    p_invoice_id: invoiceId,
    p_motivo: motivo,
  });
  if (error) {
    const { data: dataFallback, error: errFallback } = await supabase.rpc('rpc_cancel_sale', {
      p_invoice_id: invoiceId,
      p_motivo: motivo,
    });
    if (errFallback) throw new Error(errFallback.message || 'Error al anular la venta');
    result = dataFallback;
  } else {
    result = data;
  }
  return result;
}

/**
 * Consulta la trazabilidad / historial de cambios de un movimiento (Requisito 6)
 */
export async function getMovementAudits(movementId) {
  if (!movementId) return [];
  const db = await getDbConnection();
  let localAudits = [];
  try {
    localAudits = await getData(
      db,
      `SELECT id, movement_id, user_id, tipo_anterior, tipo_nuevo, monto_anterior, monto_nuevo, motivo, origen, fecha AS created_at, estadoMovil
       FROM movimientos_audit WHERE movement_id = ? ORDER BY fecha DESC`,
      [String(movementId)]
    );
  } catch (err) {
    console.log('Error consultando auditoría local:', err);
  }

  // Si hay red y el ID está en Supabase, consultar auditoría remota
  try {
    const net = await NetInfo.fetch();
    if (net.isConnected && !String(movementId).startsWith('-')) {
      const { data: serverAudits, error } = await supabase.rpc('rpc_get_movement_audit', {
        p_movement_id: movementId,
      });
      if (!error && Array.isArray(serverAudits) && serverAudits.length > 0) {
        return serverAudits;
      }
    }
  } catch (errNet) {
    console.log('Error consultando auditoría remota:', errNet);
  }

  return localAudits || [];
}
