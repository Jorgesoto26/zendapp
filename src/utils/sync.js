import NetInfo from '@react-native-community/netinfo';
import { getDbConnection, getData, updateData } from '../database/db';
import { supabase } from '../lib/supabase';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { appAlert } from '../components/AppAlert';
import { saveCajaLocal, saveMovimientoLocal } from '../services/cajaService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { eventBus, EVENTS } from './eventBus';

let globalSyncCollection = [];
let idCounter = -1;
let idMapping = new Map();

const SYNC_LOCK_KEY = '@zendapp_is_syncing';
const SYNC_TIMEOUT_MS = 60000; // 60 segundos timeout de seguridad para evitar bloqueos por crash inesperado

export const isSyncingActive = async () => {
  try {
    const val = await AsyncStorage.getItem(SYNC_LOCK_KEY);
    if (!val) return false;
    const data = JSON.parse(val);
    if (!data?.active) return false;
    if (Date.now() - (data.timestamp || 0) > SYNC_TIMEOUT_MS) {
      console.log('isSyncingActive: bloqueo previo expirado tras 60s, liberando lock.');
      await AsyncStorage.removeItem(SYNC_LOCK_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const resetSyncLock = async () => {
  try {
    await AsyncStorage.removeItem(SYNC_LOCK_KEY);
  } catch {}
};

export const SyncWithSupabase = async (toas = true, callLoading = () => { }) => {
  if (isSyncing) {
    console.log('SyncWithSupabase: ya hay una sincronización en curso. Se omite ejecución duplicada.');
    return callLoading(false);
  }
  isSyncing = true;

  try {
    const state = await NetInfo.fetch();
    console.log('Se ejecuta sincronizacion');

    if (!state.isConnected) {
      toas && Toast.show({ text1: 'Sin señal de internet', text2: 'Tus datos siguen guardados seguros en el teléfono' });
      return callLoading(false);
    }

    // Validar si la cuenta del usuario est inhabilitada
    const { data: authData } = await supabase.auth.getSession();
    if (authData?.session?.user) {
      const { data: profCheck } = await supabase
        .from('profiles')
        .select('activo')
        .eq('id', authData.session.user.id)
        .maybeSingle();

      if (profCheck && profCheck.activo === false) {
        console.warn('SyncWithSupabase: Usuario inhabilitado. No puede sincronizar.');
        toas && Toast.show({
          text1: 'Cuenta inhabilitada',
          text2: 'Tu cuenta ha sido inhabilitada por el administrador',
          type: 'error'
        });
        return callLoading(false);
      }
    }

    globalSyncCollection = [];
    idCounter = -1;
    idMapping.clear();

    await SendVentas(toas);
    await SendPay(toas);
    await SendMovimientos(toas);
    const res = await sendCollectedItems(toas);

    // Sincronizar y almacenar en local la caja y los movimientos con su estado correspondiente
    try {
      await SyncCajaAndMovimientos();
    } catch (eCaja) {
      console.log('SyncCajaAndMovimientos error en SyncWithSupabase:', eCaja);
    }

    return callLoading(res);
  } catch (e) {
    console.log('Sync error', e);
    return callLoading(false);
  } finally {
    globalSyncCollection = [];
    idCounter = -1;
    idMapping.clear();
    // Limpiar lock en AsyncStorage
    try {
      await AsyncStorage.setItem(
        SYNC_LOCK_KEY,
        JSON.stringify({ active: false, timestamp: Date.now() })
      );
      await AsyncStorage.removeItem(SYNC_LOCK_KEY);
    } catch (errUnlock) {
      console.log('Error liberando lock de sync en AsyncStorage:', errUnlock);
    }
    // Requisito 4: Notificar finalización de sincronización
    eventBus.emit(EVENTS.SYNC_COMPLETED);
  }
};

const SendVentas = async (toas) => {
  const db = await getDbConnection();
  try {
    await db.executeSql(`CREATE TABLE IF NOT EXISTS ventas_pendientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_id TEXT UNIQUE,
      payload TEXT,
      estado TEXT DEFAULT 'pendiente',
      created_at TEXT
    )`);
    // Recuperar cualquier venta que haya quedado en 'enviando' por crash previo
    await db.executeSql(`UPDATE ventas_pendientes SET estado = 'pendiente' WHERE estado = 'enviando'`);

    const pending = await getData(db, `SELECT * FROM ventas_pendientes WHERE estado = 'pendiente' ORDER BY id ASC`);
    if (!pending || pending.length === 0) return true;

    for (const item of pending) {
      let payload;
      try {
        payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
      } catch (e) {
        console.log('Error parseando payload de venta pendiente:', e);
        continue;
      }

      await db.executeSql(`UPDATE ventas_pendientes SET estado = 'enviando' WHERE id = ?`, [item.id]);

      try {
        const { data: result, error: rpcError } = await supabase.rpc('create_sale', {
          nombre: payload.nombre,
          apellido: payload.apellido || '',
          alias: payload.alias || '',
          email: '',
          telefono: payload.telefono || '',
          direccion: payload.direccion || '',
          documento: payload.documento || '',
          monto: parseFloat(payload.monto),
          vendedor_id: payload.vendedor_id,
          caja_id: payload.caja_id,
          plazo_id: parseInt(payload.plazo_id, 10),
          interes_id: parseInt(payload.interes_id, 10),
        });

        if (rpcError) throw rpcError;

        const remoteInvoiceId = result.id_factura;
        console.log("Venta offline sincronizada con exito. Factura remota:", remoteInvoiceId);

        // Marcar venta_pendiente como sincronizada
        await db.executeSql(`UPDATE ventas_pendientes SET estado = 'sincronizado' WHERE id = ?`, [item.id]);

        // Requisito 6: Actualizar factura local preservando su estado comercial tramitado ('actualizado')
        await db.executeSql(`UPDATE facturas SET id = ? WHERE id = ?`, [String(remoteInvoiceId), String(item.temp_id)]);

        // Si se realizaron pagos o detalles locales para esa factura mientras estaba offline:
        await db.executeSql(`UPDATE pagos SET idFactura = ? WHERE idFactura = ?`, [String(remoteInvoiceId), String(item.temp_id)]);
        await db.executeSql(`UPDATE detallesCaja SET facturaId = ? WHERE facturaId = ?`, [String(remoteInvoiceId), String(item.temp_id)]);

        // Requisito 11 (Causa Raiz de ID negativo residual):
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
      } catch (saleErr) {
        console.log(`Error enviando venta pendiente ${item.id}:`, saleErr);
        await db.executeSql(`UPDATE ventas_pendientes SET estado = 'pendiente' WHERE id = ?`, [item.id]);
      }
    }
    return true;
  } catch (err) {
    console.log('SendVentas error:', err);
    return true;
  }
};

const SendPay = async (toas) => {
  const db = await getDbConnection();
  // Recuperar cualquier pago que haya quedado trabado en 'enviando' por crash previo
  await db.executeSql(`UPDATE pagos SET estadoMovil = 'actualizado' WHERE id < 0 AND estadoMovil = 'enviando'`);

  // Solo pagos pendientes que NO han sido sincronizados
  const pagos = await getData(db, `SELECT * FROM pagos WHERE id < 0 AND estadoMovil = 'actualizado' ORDER BY id ASC`);
  if (!pagos || pagos.length === 0) return true;

  // Marcar inmediatamente como 'enviando' para evitar que otra llamada concurrente los tome
  for (const p of pagos) {
    await db.executeSql(`UPDATE pagos SET estadoMovil = 'enviando' WHERE id = ?`, [p.id]);
    const payload = {
      id: p.id, // temporal negativo
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
    const originalId = p.id;
    addToSyncCollection(payload, originalId, 'payment');
  }
  return true;
};

const SendMovimientos = async (toas) => {
  const db = await getDbConnection();
  await db.executeSql(`UPDATE movimientos SET estadoMovil = 'actualizado' WHERE id < 0 AND estadoMovil = 'enviando'`);

  // Solo movimientos pendientes que NO han sido sincronizados
  const movs = await getData(db, `SELECT * FROM movimientos WHERE id < 0 AND estadoMovil = 'actualizado' ORDER BY horaDispositivo ASC`);
  if (!movs || movs.length === 0) return true;

  for (const m of movs) {
    await db.executeSql(`UPDATE movimientos SET estadoMovil = 'enviando' WHERE id = ?`, [m.id]);
    const valNum = parseFloat(m.monto != null ? m.monto : m.valor) || 0;
    const payload = {
      id: m.id,
      detalle: {
        tipo: m.tipo,
        valor: valNum,
        hora_dispositivo: m.horaDispositivo,
        latitud: m.latitud,
        longitud: m.longitud,
        descripcion: m.descripcion || '',
        idCaja: m.idCaja,
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

// Envía todo en batch a Supabase Edge Function / RPC
const sendCollectedItems = async (toas) => {
  if (globalSyncCollection.length === 0) {
    toas && Toast.show({ text1: 'Todo al día', text2: 'No tienes movimientos pendientes por enviar' });
    return true;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No autenticado');
    const db = await getDbConnection();

    // 1 intento: Edge Function bulk_sync (si existe) sino loop por item
    // Fallback loop
    const results = [];
    for (const item of globalSyncCollection) {
      const mapping = idMapping.get(item.id);
      try {
        if (mapping.type === 'payment') {
          // RPC real: create_payment(p_invoice_id uuid, p_client_id uuid, p_amount numeric, p_payment_date date, p_method text, p_caja_id uuid)
          //  - actualiza invoice.saldo, crea cash_movements + payments + cuotas, todo transaccional
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

          // nopago: registrar visita sin recaudo (monto 0)
          if (item.detalle.tipo === 'nopago' || Number(item.detalle.valor) === 0) {
            try {
              const { data: pay, error: ePay } = await supabase
                .from('payments')
                .insert([{
                  invoice_id: item.detalle.idFactura,
                  client_id: clientId,
                  amount: 0,
                  payment_date: new Date().toISOString().slice(0, 10),
                  method: 'nopago',
                  cash_movement_id: null,
                }])
                .select('id')
                .maybeSingle();

              if (!ePay && pay) {
                results.push({ idv: item.id, idn: pay.id, ok: true });
                continue;
              }
            } catch (nopagoErr) {
              console.log('Error insertando nopago directo:', nopagoErr);
            }

            // Fallback RPC create_payment con amount 0
            const { data: rpcId, error: rpcErr } = await supabase.rpc('create_payment', {
              p_invoice_id: item.detalle.idFactura,
              p_client_id: clientId,
              p_amount: 0,
              p_payment_date: new Date().toISOString().slice(0, 10),
              p_method: 'nopago',
              p_caja_id: cajaId,
            });
            if (rpcErr) throw rpcErr;
            results.push({ idv: item.id, idn: rpcId, ok: true });
            continue;
          }

          const valNum = parseFloat(item.detalle.valor) || 0;
          const pMethod = item.detalle.tipo === 'parcial' ? 'parcial' : 'cash';
          const pDate = new Date().toISOString().slice(0, 10);

          const { data, error } = await supabase.rpc('create_payment', {
            p_invoice_id: item.detalle.idFactura,
            p_client_id: clientId,
            p_amount: valNum,
            p_payment_date: pDate,
            p_method: pMethod,
            p_caja_id: cajaId,
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
          const { data: mv, error } = await supabase.rpc('rpc_create_cash_movement', {
            p_caja_id: targetCajaId,
            p_tipo: item.detalle.tipo, // soporte nativo para 'gasto', 'ingreso', 'retiro'
            p_descripcion: item.detalle.descripcion || 'Movimiento de caja',
            p_monto: valNum
          });
          if (error) throw error;
          results.push({ idv: item.id, idn: mv?.id || item.id, ok: true });
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
      toas && Toast.show({ text1: '¡Sincronización exitosa!', text2: `Se enviaron ${okItems.length} registro(s) al sistema` });
    }

    if (errItems.length > 0) {
      for (const er of errItems) {
        const msg = `Factura ${String(er.factura).slice(0, 8)}: ${er.error}`;
        // Reporte visible + log
        Toast.show({ text1: 'Error sync', text2: msg });
        console.log('Sync error detail', er);
        // Caso saldo 0 o factura pagada: marcar como error_sync para no reintentar infinito
        if (er.error.includes('excede el saldo') || er.error.includes('FACTURA_PAGADA') || er.error.includes('completamente pagada')) {
          try {
            const db = await getDbConnection();
            // marcar como error_sync para revisión, no reintentar automático
            await db.executeSql(`UPDATE pagos SET estadoMovil = 'error_sync' WHERE id = ?`, [er.idv]);
            // sincronizar saldo local con servidor para evitar desfase futuro
            try {
              const { data: inv } = await supabase.from('invoice').select('saldo').eq('id', er.factura).single();
              if (inv) await db.executeSql(`UPDATE facturas SET saldo = ? WHERE id = ?`, [inv.saldo, er.factura]);
            } catch {}
          } catch {}
        } else {
          // Error temporal (red, etc.): revertir de 'enviando' a 'actualizado' para reintento en el próximo ciclo
          try {
            const db = await getDbConnection();
            await db.executeSql(`UPDATE pagos SET estadoMovil = 'actualizado' WHERE id = ? AND estadoMovil = 'enviando'`, [er.idv]);
            await db.executeSql(`UPDATE movimientos SET estadoMovil = 'actualizado' WHERE id = ? AND estadoMovil = 'enviando'`, [er.idv]);
          } catch {}
        }
      }
      // No limpiar global si hubo errores, pero liberar mapeos de los ok para siguiente ciclo solo reintente errores
      globalSyncCollection = errItems.map(e => ({ id: e.idv, detalle: { idFactura: e.factura, valor: e.monto }, _error: e.error }));
      // reconstruir idMapping solo para errores
      const newMap = new Map();
      for (const er of errItems) {
        const old = idMapping.get(er.idv);
        if (old) newMap.set(er.idv, old);
      }
      idMapping = newMap;
      if (okItems.length === 0) return false;
    } else {
      globalSyncCollection = [];
      idMapping.clear();
      idCounter = -1;
    }

    return errItems.length === 0;
  } catch (e) {
    console.log('sendCollectedItems error', e);
    Toast.show({ text1: 'Sync error', text2: e.message || String(e) });
    return false;
  }
};

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
        try { await updateData(db, 'pagos', { id: item.idv, estadoMovil: 'sincronizado' }); } catch {}
      }
      try {
        await db.executeSql(
          `UPDATE detallesCaja SET estado = 'sincronizado' WHERE id = ? OR id = '' || ? OR (facturaId = ? AND estado != 'sincronizado')`,
          [item.idv, item.idv, facturaId || '']
        );
      } catch {}

      // Requisito 5 & 11: Marcar movimiento local de este pago como sincronizado
      try {
        await db.executeSql(
          `UPDATE movimientos SET estadoMovil = 'sincronizado' WHERE id = ? OR id = '' || ? OR (idFactura = ? AND tipo = 'pago')`,
          [item.idv, item.idv, facturaId || '']
        );
      } catch {}

      // guardar id remoto para referencia si existe columna sync_id
      try { await db.executeSql(`UPDATE pagos SET sync_id = ? WHERE id = ? OR id = '' || ?`, [item.idn, item.idv, item.idv]); } catch {}
    } else if (mapping.type === 'movimiento') {
      try {
        if (item.idn) {
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
        } catch {}
      }
    }
  }
};

export const SyncCajaAndMovimientos = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
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
      // Guardar / Actualizar caja activa en SQLite local con su estado 'abierta'
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
          } catch {}
        }
      }
    } else if (!cajaErr && !caja) {
      // Si el servidor confirma que NO hay caja abierta, marcar como cerrada en SQLite
      try {
        await db.executeSql(`UPDATE cajas SET estado = 'cerrada' WHERE usuario_id = ?`, [userId]);
      } catch {}
    }

    // 3. Cachear historial de las últimas 20 cajas para uso offline
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
