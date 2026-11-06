import React, { useState, useCallback, memo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Animated, Platform, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/FontAwesome';
import Toast from 'react-native-toast-message';
import Geolocation from 'react-native-geolocation-service';
import { getDbConnection, updateData, insertTables, getData } from '../../../database/db';
import { IdInsertion, getDateOdooMilisec, getDate, Capitalize, FormatMoneyDecimales, formatMoneyInput, parseMoneyToNumeric, generateUUID } from '../../../utils/utilities';
import { getCajaActual } from '../../../services/cajaService';
import { apple } from '../../../theme/appleTheme';
import { zendapp } from '../../../theme/zendappTheme';
import { appAlert } from '../../../components/AppAlert';
import { eventBus, EVENTS } from '../../../utils/eventBus';
import { SyncWithSupabase } from '../../../utils/sync';
import { useAuth } from '../../../context/AuthContext';
import PaymentReceiptModal from '../../../components/PaymentReceiptModal';

const getStatusColor = (tipo) => ({ pago: zendapp.colors.success, 'no pago': zendapp.colors.primary, parcial: zendapp.colors.warning, pendiente: '#D0D5DD' }[ (tipo||'').toLowerCase().trim()] || '#D0D5DD');
const getStatusBg = (tipo) => ({ pago: '#ECFDF5', 'no pago': '#FEF2F2', parcial: '#FFFBEB', pendiente: '#F8F9FA' }[ (tipo||'').toLowerCase().trim()] || '#F8F9FA');

const getCurrentLocationSafe = () =>
  new Promise((res) => {
    try {
      Geolocation.getCurrentPosition(
        (pos) => res({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => {
          console.log('Location error / fallback:', err);
          res({ latitude: null, longitude: null });
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
      );
    } catch {
      res({ latitude: null, longitude: null });
    }
  });


const ensureLocalCuotas = async (db, invoiceId, saldoTotal, valorCuota, cuotasPagasCount) => {
  try {
    let rows = await getData(
      db,
      `SELECT id, numero, monto, COALESCE(monto_pagado, 0) AS monto_pagado, estado
       FROM cuotas WHERE invoice_id = ? ORDER BY numero ASC`,
      [String(invoiceId)]
    );
    if (rows && rows.length > 0) return rows;

    const fRows = await getData(
      db,
      `SELECT valorInicial, valorCuota, num_cuotas, saldo, cuotasPagas, fecha, periodicidad FROM facturas WHERE id = ?`,
      [String(invoiceId)]
    );
    if (!fRows || fRows.length === 0) return [];
    const f = fRows[0];
    const total = Number(f.valorInicial || f.saldo || saldoTotal || 0);
    const vCuota = Number(f.valorCuota || valorCuota || 0);
    const nCuotas = Number(f.num_cuotas) || (vCuota > 0 ? Math.round(total / vCuota) : 0);
    if (nCuotas <= 0 || vCuota <= 0) return [];

    const cMonto = Math.floor(total / nCuotas);
    const cResto = total - (cMonto * (nCuotas - 1));
    const pagas = Number(f.cuotasPagas || cuotasPagasCount || 0);

    for (let i = 1; i <= nCuotas; i++) {
      const val = (i === nCuotas) ? cResto : cMonto;
      const isYaPaga = i <= pagas;
      await db.executeSql(
        `INSERT OR IGNORE INTO cuotas (id, invoice_id, numero, fecha_vencimiento, monto, estado, monto_pagado)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `cuota_${invoiceId}_${i}`,
          String(invoiceId),
          i,
          new Date().toISOString().slice(0, 10),
          val,
          isYaPaga ? 'pagada' : 'pendiente',
          isYaPaga ? val : 0,
        ]
      );
    }

    return await getData(
      db,
      `SELECT id, numero, monto, COALESCE(monto_pagado, 0) AS monto_pagado, estado
       FROM cuotas WHERE invoice_id = ? ORDER BY numero ASC`,
      [String(invoiceId)]
    );
  } catch (e) {
    console.log('Error ensureLocalCuotas:', e);
    return [];
  }
};

const buildPaymentData = async ({ tipo, valor, idFactura, nombre, secuencia }) => {
  const pos = await getCurrentLocationSafe();
  const idInsert = await IdInsertion();
  const currentDate = getDateOdooMilisec();
  const caja = await getCajaActual();
  const currentCajaId = caja?.id || '1';
  const clientUuid = generateUUID();
  return {
    pago: {
      id: idInsert,
      latitud: pos.latitude,
      longitud: pos.longitude,
      tipo,
      valor,
      horaDispositivo: currentDate,
      idFactura,
      valorFactura: valor,
      descripcion: '',
      estadoMovil: 'actualizado',
      nombre: Capitalize(nombre),
      secuencia_pago: secuencia,
      idCaja: currentCajaId,
      client_uuid: clientUuid,
    },
    detalle: {
      id: idInsert,
      facturaId: idFactura,
      valor,
      fecha: getDate(),
      descripcion: '',
      tipo,
      hora_dispositivo: currentDate,
      nombre: Capitalize(nombre),
      [`${tipo === 'nopago' ? 'nopago' : 'pago'}_factura_venta_id`]: `${idFactura}_${idInsert}`,
      editable: 'true',
    },
  };
};
const getAndIncrementConsecutivo = async (db) => {
  let next = 1;
  try {
    const r = await getData(db, 'SELECT valor FROM consecutivoTramitado WHERE id = 1');
    if (r && r.length > 0) {
      next = parseInt(r[0].valor || 0) + 1;
    }
    await db.executeSql('INSERT OR REPLACE INTO consecutivoTramitado (id, valor) VALUES (1, ?)', [next]);
  } catch {
    next = 1;
  }
  return next;
};
const updateFacturaWithConsecutivo = async (db, id, updates, c) => updateData(db, 'facturas', { ...updates, id, consecutivoTramitado: c });
const getUltimoTramite = async (db, idFactura) => {
  const r = await getData(
    db,
    `SELECT id, tipo, valor, estadoMovil FROM pagos WHERE idFactura = ? ORDER BY horaDispositivo DESC, rowid DESC LIMIT 1`,
    [idFactura]
  );
  if (!r || !r.length) return { tipo: null, valorPagado: 0, syncId: null, pendiente: false };
  const v = Number(r[0].valor) || 0;
  const syncId = r[0].id;
  const pendiente = r[0].estadoMovil !== 'sincronizado';
  if (r[0].tipo === 'nopago' || (r[0].tipo === 'pago' && v === 0)) return { tipo: 'NO PAGO', valorPagado: v, syncId, pendiente };
  if (r[0].tipo === 'parcial') return { tipo: 'PARCIAL', valorPagado: v, syncId, pendiente };
  return { tipo: 'PAGO', valorPagado: v, syncId, pendiente };
};

const ItemPayments = memo(({
  id, name, address, amount, status, paymentType, estadoPago, saldo, cuotasPagas,
  saldoVencido, nombreUno, valorCuota, onPaymentSuccess, estadoMovil, telefono,
  latitud, longitud, valorCredito, documento,
  tipoTramitado: propTipoTramitado,
  valorPagado: propValorPagado,
  pendienteSync: propPendienteSync,
  onShowReceipt,
}) => {
  const navigation = useNavigation();
  const { profile } = useAuth() || {};
  const [modalParcial, setModalParcial] = useState(false);
  const [modalNoPago, setModalNoPago] = useState(false);
  const [valorParcial, setValorParcial] = useState('');
  const [loading, setLoading] = useState(false);
  const [tipoTramitado, setTipoTramitado] = useState(propTipoTramitado || null);
  const [valorPagado, setValorPagado] = useState(propValorPagado || 0);
  const [pendienteSync, setPendienteSync] = useState(propPendienteSync !== undefined ? propPendienteSync : false);
  const [receiptData, setReceiptData] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (propTipoTramitado !== undefined) setTipoTramitado(propTipoTramitado);
    if (propValorPagado !== undefined) setValorPagado(propValorPagado);
    if (propPendienteSync !== undefined) {
      setPendienteSync(propPendienteSync);
    } else if (estadoMovil === 'actualizado') {
      (async () => {
        try {
          const db = await getDbConnection();
          const { tipo, valorPagado: vp, pendiente } = await getUltimoTramite(db, id);
          setTipoTramitado(tipo);
          setValorPagado(vp);
          setPendienteSync(!!pendiente);
        } catch {}
      })();
    }
  }, [propTipoTramitado, propValorPagado, propPendienteSync, estadoMovil, id]);

  // Actualización inmediata al completarse la sincronización (Problema 2)
  useEffect(() => {
    const unsub = eventBus.on(EVENTS.SYNC_COMPLETED, async () => {
      try {
        const db = await getDbConnection();
        const { tipo, valorPagado: vp, pendiente } = await getUltimoTramite(db, id);
        if (tipo) setTipoTramitado(tipo);
        if (vp !== undefined) setValorPagado(vp);
        setPendienteSync(!!pendiente);
      } catch {}
    });
    return () => unsub();
  }, [id]);

  const pressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 30 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  const executePaymentAction = useCallback(async (tipo, valorPago) => {
    setLoading(true);
    const db = await getDbConnection();
    try {
      const c = await getAndIncrementConsecutivo(db);
      const { pago, detalle } = await buildPaymentData({ tipo, valor: valorPago, idFactura: id, nombre: nombreUno, secuencia: c });
      const ns = tipo === 'nopago' ? saldo : Math.max(saldo - valorPago, 0);
      const nsv = tipo === 'nopago' ? (saldoVencido || 0) : Math.max((saldoVencido || 0) - valorPago, 0);

      // Amortización progresiva de cuotas en SQLite
      let ncp = cuotasPagas;
      if (tipo !== 'nopago' && valorPago > 0) {
        try {
          const cuotasRows = await ensureLocalCuotas(db, id, saldo, valorCuota, cuotasPagas);

          if (cuotasRows && cuotasRows.length > 0) {
            if (ns <= 0) {
              // PAGO TOTAL: todas las cuotas quedan en estado pagada
              await db.executeSql(
                `UPDATE cuotas SET estado = 'pagada', monto_pagado = monto, payment_id = ? WHERE invoice_id = ?`,
                [pago.id, String(id)]
              );
              ncp = cuotasRows.length;
            } else {
              // PAGO PARCIAL O MAYOR A UNA CUOTA: distribución progresiva
              let montoRestante = valorPago;
              for (const cuota of cuotasRows) {
                if (montoRestante <= 0) break;
                const saldoCuota = Number(cuota.monto) - Number(cuota.monto_pagado || 0);
                if (saldoCuota <= 0) continue;

                if (montoRestante >= saldoCuota) {
                  // Cubre la totalidad de la cuota
                  await db.executeSql(
                    `UPDATE cuotas SET estado = 'pagada', monto_pagado = ?, payment_id = ? WHERE id = ?`,
                    [Number(cuota.monto), pago.id, cuota.id]
                  );
                  montoRestante -= saldoCuota;
                } else {
                  // Abono parcial a la cuota
                  await db.executeSql(
                    `UPDATE cuotas SET estado = 'abonada', monto_pagado = ?, payment_id = ? WHERE id = ?`,
                    [Number(cuota.monto_pagado || 0) + montoRestante, pago.id, cuota.id]
                  );
                  montoRestante = 0;
                  break;
                }
              }

              const countRes = await getData(
                db,
                `SELECT COUNT(*) AS count FROM cuotas WHERE invoice_id = ? AND estado = 'pagada'`,
                [String(id)]
              );
              ncp = countRes?.[0]?.count ?? (cuotasPagas + 1);
            }
          } else {
            ncp = cuotasPagas + 1;
          }
        } catch (errCuotas) {
          console.log('Error actualizando cuotas en executePaymentAction:', errCuotas);
          ncp = cuotasPagas + 1;
        }
      }

      const nuevoEstadoFactura = ns <= 0 ? 'pagada' : 'pendiente';
      await updateFacturaWithConsecutivo(db, id, {
        estadoMovil: 'actualizado',
        saldo: ns,
        cuotasPagas: ncp,
        saldoVencido: nsv,
        estado: nuevoEstadoFactura,
      }, c);
      await Promise.all([insertTables(db, 'pagos', [pago]), insertTables(db, 'detallesCaja', [detalle])]);

      // Requisito 5: Guardar movimiento local para que se refleje inmediatamente en Movimientos y Caja
      const nowIso = new Date().toISOString();
      const clienteDesc = name || nombreUno || 'Cliente';
      const descMov = tipo === 'nopago'
        ? `No pago: ${clienteDesc}`
        : `Pago: ${clienteDesc} (${FormatMoneyDecimales(valorPago)})`;

      try {
        await db.executeSql(
          `INSERT INTO movimientos (id, descripcion, monto, horaDispositivo, tipo, estadoMovil, idCaja, fecha, idFactura, cliente_nombre, client_uuid)
           VALUES (?, ?, ?, ?, ?, 'actualizado', ?, ?, ?, ?, ?)`,
          [
            pago.id,
            descMov,
            tipo === 'nopago' ? 0 : valorPago,
            pago.horaDispositivo || nowIso,
            tipo === 'nopago' ? 'nopago' : 'pago',
            pago.idCaja,
            nowIso,
            String(id),
            clienteDesc,
            pago.client_uuid,
          ]
        );
      } catch (errMov) {
        console.log('Error insertando movimiento local:', errMov);
      }

      // Actualizar saldo_final de la caja localmente
      if (valorPago > 0 && pago.idCaja) {
        try {
          await db.executeSql(
            `UPDATE cajas SET saldo_final = COALESCE(saldo_final, 0) + ? WHERE id = ?`,
            [valorPago, pago.idCaja]
          );
        } catch (errCaja) {
          console.log('Error actualizando saldo_final de caja local:', errCaja);
        }
      }

      // Requisito 4: Notificar a todas las vistas mediante EventBus
      eventBus.emit(EVENTS.PAYMENT_REGISTERED, {
        idFactura: id,
        tipo,
        valorPago,
        pagoId: pago.id,
      });

      // Disparar sincronizacion en background si hay red
      try {
        SyncWithSupabase(false, () => {});
      } catch {}

      setTipoTramitado(tipo === 'nopago' ? 'NO PAGO' : (ns <= 0 ? 'PAGO' : (tipo === 'parcial' ? 'PARCIAL' : 'PAGO')));
      setValorPagado(tipo === 'nopago' ? 0 : valorPago);
      setPendienteSync(true);

      Toast.show({
        text1: ns <= 0
          ? 'Crédito pagado en su totalidad'
          : tipo === 'pago'
          ? 'Pago realizado'
          : tipo === 'nopago'
          ? 'No pago registrado'
          : 'Pago parcial realizado',
      });

      // Generar comprobante automático si fue un pago o abono válido
      if (tipo !== 'nopago' && valorPago > 0) {
        let orgData = { nombre: 'ZENDA', nit: '', logo: null };
        try {
          const orgRows = await getData(db, 'SELECT * FROM organizaciones LIMIT 1');
          if (orgRows && orgRows.length > 0) {
            orgData = {
              nombre: orgRows[0].nombre || 'ZENDA',
              nit: orgRows[0].nit || '',
              logo: orgRows[0].logo_path || null,
            };
          }
        } catch (eOrg) {}

        const vendedorName = profile?.nombre
          ? `${profile.nombre} ${profile.apellidos || profile.apellido || ''}`.trim()
          : 'Vendedor';

        const receiptPayload = {
          id: pago.id,
          idFactura: id,
          clienteNombre: name || nombreUno || 'Cliente',
          clienteDoc: documento || '',
          fecha: pago.horaDispositivo || nowIso,
          valor: valorPago,
          saldoRestante: ns,
          vendedorNombre: vendedorName,
          orgNombre: orgData.nombre,
          orgNit: orgData.nit,
          orgLogo: orgData.logo,
          metodo: 'Efectivo',
          isPendingSync: true,
        };

        if (onShowReceipt) {
          onShowReceipt(receiptPayload);
        } else {
          setReceiptData(receiptPayload);
          setShowReceiptModal(true);
        }
      }

      onPaymentSuccess?.();
      if (tipo === 'parcial') { setModalParcial(false); setValorParcial(''); } else if (tipo === 'nopago') setModalNoPago(false);
    } catch (e) {
      console.log('Error executePaymentAction:', e);
      Toast.show({ text1: 'Error al procesar', text2: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  }, [id, saldo, cuotasPagas, saldoVencido, nombreUno, name, documento, profile, onPaymentSuccess, onShowReceipt]);

  const handleOpenReceiptForTramitado = useCallback(async () => {
    try {
      const db = await getDbConnection();
      const pRows = await getData(
        db,
        `SELECT id, valor, horaDispositivo, tipo FROM pagos WHERE idFactura = ? AND tipo != 'nopago' ORDER BY horaDispositivo DESC, rowid DESC LIMIT 1`,
        [id]
      );
      const lastP = pRows?.[0];
      const val = lastP ? Number(lastP.valor) : valorPagado;
      const pId = lastP ? lastP.id : `REC-${id}`;
      const fDate = lastP?.horaDispositivo || new Date().toISOString();

      let orgData = { nombre: 'ZENDA', nit: '', logo: null };
      try {
        const orgRows = await getData(db, 'SELECT * FROM organizaciones LIMIT 1');
        if (orgRows && orgRows.length > 0) {
          orgData = {
            nombre: orgRows[0].nombre || 'ZENDA',
            nit: orgRows[0].nit || '',
            logo: orgRows[0].logo_path || null,
          };
        }
      } catch (eOrg) {}

      const vendedorName = profile?.nombre
        ? `${profile.nombre} ${profile.apellidos || profile.apellido || ''}`.trim()
        : 'Vendedor';

      const receiptPayload = {
        id: pId,
        idFactura: id,
        clienteNombre: name || nombreUno || 'Cliente',
        clienteDoc: documento || '',
        fecha: fDate,
        valor: val,
        saldoRestante: saldo,
        vendedorNombre: vendedorName,
        orgNombre: orgData.nombre,
        orgNit: orgData.nit,
        orgLogo: orgData.logo,
        metodo: 'Efectivo',
        isPendingSync: (propPendienteSync !== undefined ? propPendienteSync : pendienteSync),
      };

      if (onShowReceipt) {
        onShowReceipt(receiptPayload);
      } else {
        setReceiptData(receiptPayload);
        setShowReceiptModal(true);
      }
    } catch (e) {
      console.log('Error opening receipt for tramitado:', e);
    }
  }, [id, name, nombreUno, documento, valorPagado, saldo, profile, propPendienteSync, pendienteSync, onShowReceipt]);

  const textoChip = estadoMovil === 'actualizado' && tipoTramitado ? tipoTramitado : paymentType;
  const valorAMostrar = estadoMovil === 'actualizado' ? valorPagado : amount;
  const isPending = status === 'PENDIENTE';
  const amountColor = !isPending && tipoTramitado
    ? (tipoTramitado === 'NO PAGO' ? zendapp.colors.primary : tipoTramitado === 'PARCIAL' ? zendapp.colors.warning : zendapp.colors.success)
    : zendapp.colors.success;

  const handlePressCard = () => {
    navigation.navigate('CreditDetail', { invoiceId: id, clientName: name, address, telefono, latitud, longitud, saldo });
  };

  return (
    <Animated.View style={{ transform: [{ scale }], marginHorizontal: 16, marginBottom: 10 }}>
      <TouchableOpacity activeOpacity={0.9} onPress={handlePressCard} onPressIn={pressIn} onPressOut={pressOut} style={styles.card}>
        <View style={styles.content}>
          {/* Fila 1: Nombre + Teléfono al lado | GPS */}
          <View style={styles.topRow}>
            <View style={styles.nameContainer}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{name}</Text>
                <TouchableOpacity
                  onPress={() => {
                    const num = (telefono || '').replace(/[^0-9+]/g, '');
                    if (!num) return appAlert('Sin teléfono', 'Este cliente no tiene número registrado');
                    Linking.openURL(`tel:${num}`).catch(() => appAlert('Error', 'No se pudo iniciar la llamada'));
                  }}
                  style={styles.phonePill}
                  activeOpacity={0.7}
                >
                  <Icon name="phone" size={10} color={zendapp.colors.success} />
                  <Text style={styles.phoneText} numberOfLines={1}>{telefono || '—'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.addr} numberOfLines={1}>{address}</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (latitud != null && longitud != null && Number(latitud) !== 0 && Number(longitud) !== 0) {
                  const url = Platform.select({ ios: `http://maps.apple.com/?q=${latitud},${longitud}`, android: `geo:${latitud},${longitud}?q=${latitud},${longitud}` });
                  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitud},${longitud}`));
                } else {
                  appAlert('Sin ubicación', 'Este cliente no tiene coordenadas GPS registradas.');
                }
              }}
              style={[styles.gpsPillTop, !(latitud != null && longitud != null && Number(latitud) !== 0 && Number(longitud) !== 0) && { opacity: 0.5, borderColor: '#D0D5DD' }]}
              activeOpacity={0.7}
            >
              <Icon name="map-marker" size={13} color={latitud != null && longitud != null && Number(latitud) !== 0 && Number(longitud) !== 0 ? zendapp.colors.carbon : zendapp.colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Fila 2: Cuota / Valor + Saldo */}
          <View style={styles.infoRow}>
            <View style={styles.amountBox}>
              <Text style={styles.amountLabel}>{!isPending && tipoTramitado ? 'VALOR PAGO' : 'CUOTA'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[styles.amount, { color: amountColor }]}>{FormatMoneyDecimales(valorAMostrar)}</Text>
                {!isPending && tipoTramitado && (
                  <View style={styles.syncBadge}>
                    {(propPendienteSync !== undefined ? propPendienteSync : pendienteSync) ? (
                      <Icon name="check" size={11} color={zendapp.colors.textMuted} />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="check" size={11} color={zendapp.colors.primary} />
                        <Icon name="check" size={11} color={zendapp.colors.primary} style={{ marginLeft: -4 }} />
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
            <View style={styles.saldoBox}>
              <Text style={styles.saldoLabel}>SALDO PENDIENTE</Text>
              <Text style={[styles.saldo, saldo === 0 && { color: zendapp.colors.success }]}>{FormatMoneyDecimales(saldo)}</Text>
            </View>
          </View>

          {/* Fila 3: Botones o Info tramitado */}
          {isPending ? (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionOutlineSuccess]} onPress={() => executePaymentAction('pago', Math.min(valorCuota, saldo))} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color={zendapp.colors.success} /> : <><Icon name="check" size={13} color={zendapp.colors.success} /><Text style={styles.actionTextSuccess}> Pagar</Text></>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionOutlineDanger]} onPress={() => setModalNoPago(true)}>
                <Icon name="times" size={13} color={zendapp.colors.primary} /><Text style={styles.actionTextDanger}> No pago</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionOutlineWarning]} onPress={() => setModalParcial(true)}>
                <Icon name="adjust" size={13} color="#D97706" /><Text style={styles.actionTextWarning}> Abono / Total</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <View style={styles.tramitadoInfo}>
                <View style={styles.tramitadoCol}>
                  <Text style={styles.tramitadoLabel}>VALOR CUOTA</Text>
                  <Text style={styles.tramitadoVal}>{FormatMoneyDecimales(valorCuota)}</Text>
                </View>
                <View style={styles.tramitadoSep} />
                <View style={styles.tramitadoCol}>
                  <Text style={styles.tramitadoLabel}>VALOR CRÉDITO</Text>
                  <Text style={styles.tramitadoVal}>{FormatMoneyDecimales(valorCredito || amount)}</Text>
                </View>
                <View style={styles.tramitadoSep} />
                <View style={styles.tramitadoCol}>
                  <Text style={styles.tramitadoLabel}>SALDO VENCIDO</Text>
                  <Text style={[styles.tramitadoVal, { color: Number(saldoVencido) > 0 ? zendapp.colors.danger : zendapp.colors.success }]}>{FormatMoneyDecimales(saldoVencido)}</Text>
                </View>
              </View>
              {tipoTramitado !== 'NO PAGO' && (
                <TouchableOpacity
                  style={styles.receiptShareBtn}
                  onPress={handleOpenReceiptForTramitado}
                  activeOpacity={0.8}
                >
                  <Icon name="file-text-o" size={13} color={zendapp.colors.primary} />
                  <Text style={styles.receiptShareBtnText}>Ver y compartir comprobante de pago</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Modal isVisible={modalParcial} onBackdropPress={() => setModalParcial(false)} animationIn="slideInUp" animationOut="slideOutDown" backdropOpacity={0.4}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Abonar o Pagar Total</Text>
          <Text style={styles.sheetSub}>{name} · Saldo {FormatMoneyDecimales(saldo)}</Text>
          <TextInput placeholder="$ 0" keyboardType="numeric" style={styles.sheetInput} value={valorParcial} onChangeText={t => setValorParcial(formatMoneyInput(t))} placeholderTextColor={zendapp.colors.textMuted} />
          {saldo > 0 && (
            <TouchableOpacity
              style={styles.sheetTotalQuickBtn}
              onPress={() => setValorParcial(formatMoneyInput(String(saldo)))}
              activeOpacity={0.7}
            >
              <Icon name="check-circle" size={13} color={zendapp.colors.carbon} />
              <Text style={styles.sheetTotalQuickBtnText}>Pagar saldo total: {FormatMoneyDecimales(saldo)}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.sheetPrimary}
            onPress={() => {
              const v = parseMoneyToNumeric(valorParcial);
              if (isNaN(v) || v <= 0) return Toast.show({ text1: 'Monto inválido', text2: 'Ingresa un valor mayor a 0' });
              if (v > saldo) return Toast.show({ text1: 'Monto inválido', text2: 'No puede superar el saldo pendiente' });
              executePaymentAction('parcial', v);
            }}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>Confirmar pago</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal isVisible={modalNoPago} onBackdropPress={() => setModalNoPago(false)} backdropOpacity={0.4}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>¿Confirmar no pago?</Text>
          <Text style={styles.sheetSub}>Se registrará visita sin recaudo.</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: '#F2F4F7' }]} onPress={() => setModalNoPago(false)}><Text style={{ fontWeight: '600', color: zendapp.colors.carbon }}>Cancelar</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: zendapp.colors.primary }]} onPress={() => executePaymentAction('nopago', 0)}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={{ fontWeight: '700', color: '#fff' }}>Confirmar</Text>}</TouchableOpacity>
          </View>
        </View>
      </Modal>
      {!onShowReceipt && (
        <PaymentReceiptModal
          visible={showReceiptModal}
          onClose={() => setShowReceiptModal(false)}
          receiptData={receiptData}
        />
      )}
    </Animated.View>
  );
}, (a, b) =>
  a.id === b.id &&
  a.status === b.status &&
  a.saldo === b.saldo &&
  a.estadoMovil === b.estadoMovil &&
  a.pendienteSync === b.pendienteSync &&
  a.tipoTramitado === b.tipoTramitado &&
  a.valorPagado === b.valorPagado &&
  a.documento === b.documento &&
  a.onShowReceipt === b.onShowReceipt
);

export default ItemPayments;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#D8DCE4',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
  },
  content: { padding: 14 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  nameContainer: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 16, fontWeight: '700', color: zendapp.colors.carbon, letterSpacing: -0.3, flexShrink: 1 },
  addr: { fontSize: 12, color: zendapp.colors.textSecondary, marginTop: 1 },
  phonePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#D0D5DD', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  phoneText: { fontSize: 11, fontWeight: '600', color: zendapp.colors.carbon, maxWidth: 110 },
  gpsPillTop: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: '#D0D5DD', marginLeft: 8, flexShrink: 0 },
  gpsText: { fontSize: 11, fontWeight: '600' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8F9FA', borderRadius: 10, borderWidth: 1, borderColor: '#EAECF0', paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 },
  amountBox: { flexDirection: 'column' },
  amountLabel: { fontSize: 9, fontWeight: '700', color: zendapp.colors.textSecondary, letterSpacing: 0.3 },
  amount: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  syncBadge: { flexDirection: 'row', alignItems: 'center' },
  saldoBox: { flexDirection: 'column', alignItems: 'flex-end' },
  saldoLabel: { fontSize: 9, fontWeight: '700', color: zendapp.colors.textMuted, letterSpacing: 0.3 },
  saldo: { fontSize: 13, fontWeight: '800', color: zendapp.colors.carbon },
  actions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: '#FFFFFF' },
  actionOutlineSuccess: { borderColor: zendapp.colors.success, backgroundColor: '#ECFDF5' },
  actionOutlineDanger: { borderColor: zendapp.colors.primary, backgroundColor: '#FEF2F2' },
  actionOutlineWarning: { borderColor: zendapp.colors.warning, backgroundColor: '#FFFBEB' },
  actionTextSuccess: { color: zendapp.colors.success, fontWeight: '700', fontSize: 11 },
  actionTextDanger: { color: zendapp.colors.primary, fontWeight: '700', fontSize: 11 },
  actionTextWarning: { color: '#D97706', fontWeight: '700', fontSize: 11 },
  tramitadoInfo: { flexDirection: 'row', backgroundColor: '#F8F9FA', borderRadius: 10, borderWidth: 1, borderColor: '#EAECF0', paddingVertical: 8, paddingHorizontal: 6, marginTop: 8, alignItems: 'center' },
  tramitadoCol: { flex: 1, alignItems: 'center' },
  tramitadoLabel: { fontSize: 9, fontWeight: '700', color: zendapp.colors.textSecondary, letterSpacing: 0.3 },
  tramitadoVal: { fontSize: 12, fontWeight: '700', color: zendapp.colors.carbon, marginTop: 2 },
  tramitadoSep: { width: 1, height: 24, backgroundColor: '#EAECF0' },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#EAECF0' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D0D5DD', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: zendapp.colors.carbon, textAlign: 'center' },
  sheetSub: { fontSize: 13, color: zendapp.colors.textSecondary, textAlign: 'center', marginTop: 4 },
  sheetInput: { backgroundColor: '#F8F9FA', borderRadius: 8, borderWidth: 1, borderColor: '#D0D5DD', padding: 12, marginTop: 14, fontSize: 17, color: zendapp.colors.carbon, textAlign: 'center' },
  sheetPrimary: { backgroundColor: zendapp.colors.primary, borderRadius: 10, height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  sheetPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  sheetBtn: { flex: 1, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  receiptShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEECEC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  receiptShareBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.primary,
  },
  sheetTotalQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 10,
  },
  sheetTotalQuickBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
});
