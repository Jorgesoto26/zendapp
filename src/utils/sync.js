import NetInfo from '@react-native-community/netinfo';
import { getDbConnection, getData, updateData } from '../database/db';
import { supabase, ensureAuthenticatedSession } from '../lib/supabase';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { appAlert } from '../components/AppAlert';
import { saveCajaLocal, saveMovimientoLocal } from '../services/cajaService';
import { eventBus, EVENTS } from './eventBus';
import { EvaluationDataSend } from './utilities';

// Colecciones en memoria para el lote actual
let globalSyncCollection = [];
let idCounter = -1;
let idMapping = new Map();

// =====================================================================
// COORDINADOR DE CONCURRENCIA EN MEMORIA (Requisitos 1 y 2)
// Evita ejecuciones simultaneas sin colisiones asincronas de AsyncStorage
// Agende pasadas pendientes cuando llegan solicitudes durante una sync activa
// =====================================================================
let isSyncing = false;
let hasPendingSync = false;
let activeSyncPromise = null;

export const isSyncingActive = async () => {
  return isSyncing;
};

export const resetSyncLock = async () => {
  isSyncing = false;
  hasPendingSync = false;
  activeSyncPromise = null;
};

/**
 * Funcion principal de sincronizacion con Supabase.
 * Todas las llamadas dentro del proceso comparten el mismo coordinador.
 */
export const SyncWithSupabase = async (toas = true, callLoading = () => { }) => {
  if (isSyncing) {
    console.log('SyncWithSupabase: sincronizacion en curso. Se agenda pasada pendiente.');
    hasPendingSync = true;
    if (activeSyncPromise) {
      try {
        const res = await activeSyncPromise;
        callLoading(res);
        return res;
      } catch {
        callLoading(false);
        return false;
      }
    }
    callLoading(false);
    return false;
  }

  isSyncing = true;
  hasPendingSync = false;

  const runCoordination = async () => {
    let finalResult = false;
    try {
      finalResult = await executeSyncRun(toas);
      while (hasPendingSync && (await EvaluationDataSend())) {
        hasPendingSync = false;
        finalResult = await executeSyncRun(false);
      }
      return finalResult;
    } finally {
      isSyncing = false;
      hasPendingSync = false;
      activeSyncPromise = null;
      eventBus.emit(EVENTS.SYNC_COMPLETED);
    }
  };

  activeSyncPromise = runCoordination();

  try {
    const res = await activeSyncPromise;
    callLoading(res);
    return res;
  } catch (err) {
    console.log('SyncWithSupabase error:', err);
    callLoading(false);
    return false;
  }
};

/**
 * Ejecuta un ciclo de sincronizacion (Ventas -> Pagos -> Movimientos -> Caja)
 */
const executeSyncRun = async (toas) => {
  try {
    const state = await NetInfo.fetch();
    console.log('Se ejecuta ciclo de sincronizacion');

    if (!state.isConnected) {
      toas && Toast.show({
        text1: 'Sin senal de internet',
        text2: 'Tus datos siguen guardados seguros en el telefono'
      });
      return false;
    }

    // 1. Obtener y renovar sesión de forma segura y transparente
    const session = await ensureAuthenticatedSession();
    if (!session?.user?.id) {
      console.warn('SyncWithSupabase: Sesión expirada o no autenticado.');
      toas && Toast.show({
        type: 'error',
        text1: 'Sesión expirada',
        text2: 'No fue posible autenticar con el servidor. Inicia sesión nuevamente.',
      });
      return false;
    }

    // Validar si la cuenta del usuario esta inhabilitada
    const { data: profCheck } = await supabase
      .from('profiles')
      .select('activo')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profCheck && profCheck.activo === false) {
      console.warn('SyncWithSupabase: Usuario inhabilitado. No puede sincronizar.');
      toas && Toast.show({
        text1: 'Cuenta inhabilitada',
        text2: 'Tu cuenta ha sido inhabilitada por el administrador',
        type: 'error'
      });
      return false;
    }

    // Reiniciar colecciones del lote
    globalSyncCollection = [];
    idCounter = -1;
    idMapping.clear();

    // 1. Enviar ventas pendientes
    const ventasResult = await SendVentas();

    // 2. Enviar pagos locales pendientes
    await SendPay();

    // 3. Enviar movimientos locales de caja
    await SendMovimientos();

    // 4. Enviar lote recolectado
    const collectedResult = await sendCollectedItems(session);

    // 5. Sincronizar caja activa y movimientos
    try {
      await SyncCajaAndMovimientos();
    } catch (eCaja) {
      console.log('SyncCajaAndMovimientos error en SyncWithSupabase:', eCaja);
    }

    // Evaluación veraz de resultados para Toast (Requisito 3)
    const totalSynced = (ventasResult.syncedCount || 0) + (collectedResult.syncedCount || 0);
    const allErrors = [...(ventasResult.errors || []), ...(collectedResult.errors || [])];

    if (allErrors.length === 0) {
      if (totalSynced > 0) {
        toas && Toast.show({
          text1: '¡Sincronización exitosa!',
          text2: `Se enviaron ${totalSynced} registro(s) al sistema`,
        });
      } else {
        toas && Toast.show({
          text1: 'Todo al día',
          text2: 'No tienes operaciones pendientes por enviar',
        });
      }
      return true;
    } else {
      if (totalSynced > 0) {
        toas && Toast.show({
          type: 'info',
          text1: 'Sincronización parcial',
          text2: `Se enviaron ${totalSynced} registro(s), pero ${allErrors.length} operación(es) fallaron.`,
        });
      } else {
        const firstErr = allErrors[0]?.message || allErrors[0] || 'Error al sincronizar con el servidor';
        toas && Toast.show({
          type: 'error',
          text1: 'Error de sincronización',
          text2: String(firstErr).slice(0, 100),
        });
      }
      return false;
    }
  } catch (e) {
    console.log('executeSyncRun error:', e);
    toas && Toast.show({
      type: 'error',
      text1: 'Error de sincronización',
      text2: e.message || String(e),
    });
    return false;
  }
};

/**
 * Sincroniza ventas guardadas offline (ventas_pendientes)
 */
const SendVentas = async () => {
  const db = await getDbConnection();
  const resultSummary = { syncedCount: 0, errors: [] };

  try {
    await db.executeSql(`CREATE TABLE IF NOT EXISTS ventas_pendientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_id TEXT UNIQUE,
      payload TEXT,
      estado TEXT DEFAULT 'pendiente',
      created_at TEXT
    )`);
    await db.executeSql(`UPDATE ventas_pendientes SET estado = 'pendiente' WHERE estado = 'enviando'`);

    const pending = await getData(db, `SELECT * FROM ventas_pendientes WHERE estado = 'pendiente' ORDER BY id ASC`);
    if (!pending || pending.length === 0) return resultSummary;

    for (const item of pending) {
      let payload;
      try {
        payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
      } catch (e) {
        console.log('Error parseando payload de venta pendiente:', e);
        continue;
      }

      await db.executeSql(`UPDATE ventas_pendientes SET estado = 'enviando' WHERE id = ?`, [item.id]);

      // UUID determinista para idempotencia matemática contra reintentos (Requisito 3)
      const localSaleUuid = `00000000-0000-4000-7000-${Math.abs(Number(item.temp_id) || item.id || 1).toString(16).padStart(12, '0')}`;

      try {
        const { data: result, error: rpcError } = await supabase.rpc('create_sale', {
          nombre: payload.nombre,
          apellido: payload.apellido || '',
          alias: payload.alias || '',
          email: payload.email || '',
          telefono: payload.telefono || '',
          direccion: payload.direccion || '',
          documento: payload.documento || '',
          monto: parseFloat(payload.monto),
          vendedor_id: payload.vendedor_id,
          caja_id: payload.caja_id,
          plazo_id: parseInt(payload.plazo_id, 10),
          interes_id: parseInt(payload.interes_id, 10),
          client_uuid: localSaleUuid,
          latitud: payload.latitud != null ? parseFloat(payload.latitud) : null,
          longitud: payload.longitud != null ? parseFloat(payload.longitud) : null,
          previous_invoice_id: payload.previous_invoice_id || null,
          fecha: payload.fecha || payload.created_at || null,
        });

        if (rpcError) throw rpcError;

        const remoteInvoiceId = result.id_factura;
        console.log("Venta offline sincronizada con éxito. Factura remota:", remoteInvoiceId);

        // Marcar venta_pendiente como sincronizada
        await db.executeSql(`UPDATE ventas_pendientes SET estado = 'sincronizado' WHERE id = ?`, [item.id]);

        // Actualizar factura local preservando su estado comercial tramitado ('actualizado')
        await db.executeSql(`UPDATE facturas SET id = ? WHERE id = ?`, [String(remoteInvoiceId), String(item.temp_id)]);

        // Si se realizaron pagos o detalles locales para esa factura mientras estaba offline:
        await db.executeSql(`UPDATE pagos SET idFactura = ? WHERE idFactura = ?`, [String(remoteInvoiceId), String(item.temp_id)]);
        await db.executeSql(`UPDATE detallesCaja SET facturaId = ? WHERE facturaId = ?`, [String(remoteInvoiceId), String(item.temp_id)]);

        // Actualizar el movimiento de venta local (temp_id - 1) para reemplazar el id negativo con el id remoto/sincronizado
        const localSaleMovId = Number(item.temp_id) - 1;
        const newMovId = result && result.id_movimiento ? String(result.id_movimiento) : `sync_sale_${remoteInvoiceId}`;
        try {
          await db.executeSql(
            `UPDATE movimientos SET id = ?, estadoMovil = 'sincronizado', idFactura = ? WHERE id = ? OR id = ?`,
            [newMovId, String(remoteInvoiceId), localSaleMovId, String(localSaleMovId)]
          );
        } catch (errMovSync) {
          console.log('Error actualizando id de movimiento venta tras sync:', errMovSync);
        }

        // Reconciliar e incorporar cuotas remotas a SQLite (Requisito 11)
        try {
          const { data: serverCuotas, error: eCuotas } = await supabase
            .from('cuotas')
            .select('id, numero, fecha_vencimiento, monto, estado, monto_pagado')
            .eq('invoice_id', remoteInvoiceId)
            .order('numero', { ascending: true });

          if (!eCuotas && serverCuotas && serverCuotas.length > 0) {
            await db.executeSql(`DELETE FROM cuotas WHERE invoice_id = ? OR invoice_id = ?`, [String(item.temp_id), String(remoteInvoiceId)]);
            for (const sc of serverCuotas) {
              await db.executeSql(
                `INSERT OR REPLACE INTO cuotas (id, invoice_id, numero, fecha_vencimiento, monto, estado, monto_pagado)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [String(sc.id), String(remoteInvoiceId), sc.numero, sc.fecha_vencimiento, Number(sc.monto), sc.estado || 'pendiente', Number(sc.monto_pagado || 0)]
              );
            }
          } else {
            await db.executeSql(`UPDATE cuotas SET invoice_id = ? WHERE invoice_id = ?`, [String(remoteInvoiceId), String(item.temp_id)]);
          }
        } catch (errCuotas) {
          console.log('Error reconciliando cuotas en SendVentas:', errCuotas);
          await db.executeSql(`UPDATE cuotas SET invoice_id = ? WHERE invoice_id = ?`, [String(remoteInvoiceId), String(item.temp_id)]);
        }

        resultSummary.syncedCount++;
      } catch (saleErr) {
        console.log(`Error enviando venta pendiente ${item.id}:`, saleErr);
        await db.executeSql(`UPDATE ventas_pendientes SET estado = 'pendiente' WHERE id = ?`, [item.id]);
        resultSummary.errors.push(saleErr);
      }
    }
  } catch (err) {
    console.log('SendVentas error:', err);
    resultSummary.errors.push(err);
  }
  return resultSummary;
};

/**
 * Prepara pagos pendientes locales
 */
const SendPay = async () => {
  const db = await getDbConnection();
  await db.executeSql(`UPDATE pagos SET estadoMovil = 'actualizado' WHERE estadoMovil = 'enviando'`);

  const pagos = await getData(db, `SELECT * FROM pagos WHERE estadoMovil = 'actualizado' ORDER BY horaDispositivo ASC`);
  if (!pagos || pagos.length === 0) return true;

  for (const p of pagos) {
    await db.executeSql(`UPDATE pagos SET estadoMovil = 'enviando' WHERE id = ?`, [p.id]);
    const payload = {
      id: p.id,
      detalle: {
        tipo: p.tipo,
        valor: parseFloat(p.valor),
        hora_dispositivo: p.horaDispositivo,
        latitud: p.latitud,
        longitud: p.longitud,
        idFactura: p.idFactura,
        descripcion: p.descripcion || '',
        secuencia_pago: p.secuencia_pago,
      },
    };
    addToSyncCollection(payload, p.id, 'payment');
  }
  return true;
};

/**
 * Prepara movimientos de caja pendientes locales (creaciones y modificaciones)
 */
const SendMovimientos = async () => {
  const db = await getDbConnection();
  await db.executeSql(`UPDATE movimientos SET estadoMovil = 'actualizado' WHERE estadoMovil = 'enviando'`);

  const movs = await getData(db, `SELECT * FROM movimientos WHERE estadoMovil = 'actualizado' ORDER BY COALESCE(horaDispositivo, fecha) ASC`);
  if (!movs || movs.length === 0) return true;

  for (const m of movs) {
    await db.executeSql(`UPDATE movimientos SET estadoMovil = 'enviando' WHERE id = ?`, [m.id]);
    const valNum = parseFloat(m.monto != null ? m.monto : m.valor) || 0;
    const payload = {
      id: m.id,
      detalle: {
        tipo: m.tipo,
        valor: valNum,
        hora_dispositivo: m.horaDispositivo || m.fecha,
        latitud: m.latitud,
        longitud: m.longitud,
        descripcion: m.descripcion || '',
        idCaja: m.idCaja || m.caja_id,
      },
    };
    addToSyncCollection(payload, m.id, 'movimiento');
  }
  return true;
};

const addToSyncCollection = (item, originalId, type) => {
  const tempId = idCounter--;
  const info = { originalId, type, idFactura: item.detalle?.idFactura };
  idMapping.set(originalId, info);
  idMapping.set(String(originalId), info);
  if (typeof originalId === 'string' && !isNaN(Number(originalId))) {
    idMapping.set(Number(originalId), info);
  }
  globalSyncCollection.push(item);
  return tempId;
};

/**
 * Envia la coleccion de pagos y movimientos a Supabase
 */
const sendCollectedItems = async (sessionParam = null) => {
  const resultSummary = { syncedCount: 0, errors: [] };
  if (globalSyncCollection.length === 0) {
    return resultSummary;
  }

  try {
    const session = sessionParam || (await ensureAuthenticatedSession());
    if (!session?.user?.id) throw new Error('No autenticado');
    const db = await getDbConnection();

    const results = [];
    for (const item of globalSyncCollection) {
      const mapping = idMapping.get(item.id);
      try {
        if (mapping.type === 'payment') {
          let clientId = null;
          let cajaId = null;
          try {
            const { data: inv } = await supabase.from('invoice').select('client_id').eq('id', item.detalle.idFactura).single();
            clientId = inv?.client_id || null;
          } catch { }
          if (!clientId) {
            try {
              const f = await getData(db, `SELECT partnerId FROM facturas WHERE id = ?`, [item.detalle.idFactura]);
              clientId = f?.[0]?.partnerId || null;
            } catch {}
          }
          try {
            const { data: caja } = await supabase.from('cajas').select('id').eq('usuario_id', session.user.id).eq('estado', 'abierta').order('fecha_apertura', { ascending: false }).limit(1).maybeSingle();
            cajaId = caja?.id || null;
          } catch { }
          if (!cajaId) {
            try {
              const { getCajaActual } = require('../services/cajaService');
              const c = await getCajaActual();
              cajaId = c?.id || null;
            } catch {}
          }

          if (!clientId) throw new Error('No se pudo obtener client_id de la factura');
          if (!cajaId) throw new Error('No hay caja abierta para el usuario');

          const localPaymentUuid = `00000000-0000-4000-8000-${Math.abs(Number(item.id) || 1).toString(16).padStart(12, '0')}`;
          const pDate = new Date().toISOString().slice(0, 10);

          if (item.detalle.tipo === 'nopago' || Number(item.detalle.valor) === 0) {
            const { data: rpcId, error: rpcErr } = await supabase.rpc('create_payment', {
              p_invoice_id: item.detalle.idFactura,
              p_client_id: clientId,
              p_amount: 0,
              p_payment_date: pDate,
              p_method: 'nopago',
              p_caja_id: cajaId,
              p_client_uuid: localPaymentUuid,
            });
            if (rpcErr) throw rpcErr;
            results.push({ idv: item.id, idn: rpcId, ok: true });
            continue;
          }

          const valNum = parseFloat(item.detalle.valor) || 0;
          const pMethod = item.detalle.tipo === 'parcial' ? 'parcial' : 'cash';

          const { data, error } = await supabase.rpc('create_payment', {
            p_invoice_id: item.detalle.idFactura,
            p_client_id: clientId,
            p_amount: valNum,
            p_payment_date: pDate,
            p_method: pMethod,
            p_caja_id: cajaId,
            p_client_uuid: localPaymentUuid,
          });

          if (error) throw error;
          results.push({ idv: item.id, idn: data, ok: true });
        } else if (mapping.type === 'movimiento') {
          let targetCajaId = item.detalle.idCaja || null;
          if (!targetCajaId) {
            const { data: caja } = await supabase.from('cajas').select('id').eq('usuario_id', session.user.id).eq('estado', 'abierta').order('fecha_apertura', { ascending: false }).limit(1).maybeSingle();
            targetCajaId = caja?.id || null;
          }
          if (!targetCajaId) throw new Error('No hay caja abierta para registrar el movimiento');
          const valNum = parseFloat(item.detalle.valor) || 0;

          // Distinguir creación nueva (id negativo local) vs edición de movimiento remoto existente
          const isNegativeTemp = typeof item.id === 'number' ? item.id < 0 : (String(item.id).startsWith('-') || String(item.id).startsWith('temp-'));

          if (isNegativeTemp) {
            const localMovUuid = `00000000-0000-4000-9000-${Math.abs(Number(item.id) || 1).toString(16).padStart(12, '0')}`;
            const { data: mv, error } = await supabase.rpc('rpc_create_cash_movement', {
              p_caja_id: targetCajaId,
              p_tipo: item.detalle.tipo,
              p_descripcion: item.detalle.descripcion || 'Movimiento de caja',
              p_monto: valNum,
              p_client_uuid: localMovUuid,
              p_fecha: item.detalle.hora_dispositivo || null,
            });
            if (error) throw error;
            results.push({ idv: item.id, idn: mv?.id || item.id, ok: true });
          } else {
            // Edición de movimiento existente sin crear duplicados (Requisito 9)
            const { data: mv, error } = await supabase.rpc('rpc_update_cash_movement', {
              p_movement_id: item.id,
              p_descripcion: item.detalle.descripcion || 'Movimiento de caja',
              p_monto: valNum,
            });
            if (error) throw error;
            results.push({ idv: item.id, idn: item.id, ok: true });
          }
        }
      } catch (err) {
        const msg = err.message || String(err);
        const details = err.details ? ` ${err.details}` : '';
        const hint = err.hint ? ` (${err.hint})` : '';
        const fullMsg = `${msg}${details}${hint}`;
        console.log('sync item error', item.id, fullMsg, err);
        results.push({ idv: item.id, error: fullMsg, raw: err, factura: item.detalle.idFactura, monto: item.detalle.valor });
      }
    }

    const okItems = results.filter(r => r.ok);
    const errItems = results.filter(r => r.error);

    if (okItems.length > 0) {
      await processResponseAndUpdateTables(okItems);
      resultSummary.syncedCount = okItems.length;
    }

    if (errItems.length > 0) {
      resultSummary.errors = errItems;
      for (const er of errItems) {
        if (er.error.includes('excede el saldo') || er.error.includes('FACTURA_PAGADA') || er.error.includes('completamente pagada')) {
          try {
            await db.executeSql(`UPDATE pagos SET estadoMovil = 'error_sync' WHERE id = ?`, [er.idv]);
            try {
              const { data: inv } = await supabase.from('invoice').select('saldo').eq('id', er.factura).single();
              if (inv) await db.executeSql(`UPDATE facturas SET saldo = ? WHERE id = ?`, [inv.saldo, er.factura]);
            } catch {}
          } catch {}
        } else {
          try {
            await db.executeSql(`UPDATE pagos SET estadoMovil = 'actualizado' WHERE id = ? AND estadoMovil = 'enviando'`, [er.idv]);
            await db.executeSql(`UPDATE movimientos SET estadoMovil = 'actualizado' WHERE id = ? AND estadoMovil = 'enviando'`, [er.idv]);
          } catch {}
        }
      }
      globalSyncCollection = errItems.map(e => ({ id: e.idv, detalle: { idFactura: e.factura, valor: e.monto }, _error: e.error }));
      const newMap = new Map();
      for (const er of errItems) {
        const old = idMapping.get(er.idv);
        if (old) newMap.set(er.idv, old);
      }
      idMapping = newMap;
    } else {
      globalSyncCollection = [];
      idMapping.clear();
      idCounter = -1;
    }
  } catch (e) {
    console.log('sendCollectedItems fatal error', e);
    resultSummary.errors.push(e);
  }
  return resultSummary;
};

/**
 * Actualiza los registros locales de SQLite a 'sincronizado'
 */
const processResponseAndUpdateTables = async (response) => {
  const db = await getDbConnection();
  for (const item of response) {
    const mapping = idMapping.get(item.idv)
      || idMapping.get(String(item.idv))
      || (typeof item.idv === 'string' && !isNaN(Number(item.idv)) ? idMapping.get(Number(item.idv)) : null);
    if (!mapping) continue;
    if (mapping.type === 'payment') {
      const facturaId = mapping.idFactura || item.factura;
      try {
        await db.executeSql(
          `UPDATE pagos SET estadoMovil = 'sincronizado' WHERE id = ? OR id = '' || ? OR (idFactura = ? AND estadoMovil IN ('enviando', 'actualizado'))`,
          [item.idv, item.idv, facturaId || '']
        );
      } catch (err) {
        console.log('Error updating pagos sincronizado:', err);
        try { await updateData(db, 'pagos', { id: item.idv, estadoMovil: 'sincronizado' }); } catch { }
      }
      try {
        await db.executeSql(
          `UPDATE detallesCaja SET estado = 'sincronizado' WHERE id = ? OR id = '' || ? OR (facturaId = ? AND estado != 'sincronizado')`,
          [item.idv, item.idv, facturaId || '']
        );
      } catch { }

      try {
        await db.executeSql(
          `UPDATE movimientos SET estadoMovil = 'sincronizado' WHERE id = ? OR id = '' || ? OR (idFactura = ? AND tipo = 'pago')`,
          [item.idv, item.idv, facturaId || '']
        );
      } catch {}

      try { await db.executeSql(`UPDATE pagos SET sync_id = ? WHERE id = ? OR id = '' || ?`, [item.idn, item.idv, item.idv]); } catch { }
    } else if (mapping.type === 'movimiento') {
      try {
        if (item.idn && String(item.idn) !== String(item.idv)) {
          await db.executeSql(
            `UPDATE movimientos SET id = ?, estadoMovil = 'sincronizado' WHERE id = ? OR id = '' || ?`,
            [String(item.idn), item.idv, item.idv]
          );
        } else {
          await db.executeSql(
            `UPDATE movimientos SET estadoMovil = 'sincronizado' WHERE id = ? OR id = '' || ?`,
            [item.idv, item.idv]
          );
        }
      } catch (errMov) {
        console.log('Error updating movimiento local sincronizado:', errMov);
        try {
          await db.executeSql(
            `UPDATE movimientos SET estadoMovil = 'sincronizado' WHERE id = ? OR id = '' || ?`,
            [item.idv, item.idv]
          );
        } catch { }
      }
    }
  }
};

/**
 * Descarga y sincroniza la caja activa del usuario y su historial
 */
export const SyncCajaAndMovimientos = async () => {
  try {
    const session = await ensureAuthenticatedSession();
    if (!session?.user?.id) return;
    const userId = session.user.id;
    const db = await getDbConnection();

    // 1. Obtener la caja activa del usuario en Supabase
    const { data: caja, error: cajaErr } = await supabase
      .from('cajas')
      .select('*')
      .eq('usuario_id', userId)
      .eq('estado', 'abierta')
      .order('fecha_apertura', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!cajaErr && caja) {
      await saveCajaLocal(db, caja, userId);

      // 2. Descargar todos los movimientos de esta caja desde Supabase
      const { data: movements, error: movErr } = await supabase
        .from('cash_movements')
        .select('*')
        .eq('caja_id', caja.id)
        .order('fecha', { ascending: false });

      if (!movErr && movements && movements.length > 0) {
        for (const m of movements) {
          await saveMovimientoLocal(db, m, caja.id, 'sincronizado');
        }

        // Limpiar cualquier movimiento local temporal ya sincronizado
        for (const m of movements) {
          try {
            await db.executeSql(
              `DELETE FROM movimientos WHERE id < 0 AND (idCaja = ? OR caja_id = ?) AND tipo = ? AND monto = ? AND descripcion = ?`,
              [String(caja.id), String(caja.id), m.tipo, Number(m.monto), m.descripcion || '']
            );
          } catch { }
        }
      }
    } else if (!cajaErr && !caja) {
      try {
        await db.executeSql(`UPDATE cajas SET estado = 'cerrada' WHERE usuario_id = ?`, [userId]);
      } catch { }
    }

    // 3. Cachear historial de las ultimas 20 cajas para uso offline
    try {
      const { data: historialCajas } = await supabase
        .from('cajas')
        .select('id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha_cierre, usuario_id')
        .eq('usuario_id', userId)
        .order('fecha_apertura', { ascending: false })
        .limit(20);

      if (historialCajas && historialCajas.length > 0) {
        for (const hc of historialCajas) {
          await saveCajaLocal(db, hc, userId);
        }
      }
    } catch (eHist) {
      console.log('Error cacheando historial de cajas:', eHist);
    }
  } catch (err) {
    console.log('SyncCajaAndMovimientos error:', err);
  }
};
