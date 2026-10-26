import React, { useState, useCallback, memo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Animated, Platform, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/FontAwesome';
import Toast from 'react-native-toast-message';
import Geolocation from 'react-native-geolocation-service';
import { getDbConnection, updateData, insertTables, getData } from '../../../database/db';
import { IdInsertion, getDateOdooMilisec, getDate, Capitalize, FormatMoneyDecimales, formatMoneyInput, parseMoneyToNumeric } from '../../../utils/utilities';
import { getCajaActual } from '../../../services/cajaService';
import { apple } from '../../../theme/appleTheme';
import { appAlert } from '../../../components/AppAlert';
import { eventBus, EVENTS } from '../../../utils/eventBus';
import { SyncWithSupabase } from '../../../utils/sync';

const getStatusColor = (tipo) => ({ pago: apple.colors.success, 'no pago': apple.colors.danger, parcial: apple.colors.warning, pendiente: apple.colors.separator }[ (tipo||'').toLowerCase().trim()] || apple.colors.separator);
const getStatusBg = (tipo) => ({ pago: '#E8F5E9', 'no pago': '#FFEBEE', parcial: '#FFF8E1', pendiente: apple.colors.fill }[ (tipo||'').toLowerCase().trim()] || apple.colors.fill);

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

const buildPaymentData = async ({ tipo, valor, idFactura, nombre, secuencia }) => {
  const pos = await getCurrentLocationSafe();
  const idInsert = await IdInsertion();
  const currentDate = getDateOdooMilisec();
  const caja = await getCajaActual();
  const currentCajaId = caja?.id || '1';
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
  const pendiente = r[0].estadoMovil !== 'sincronizado' && Number(syncId) < 0;
  if (r[0].tipo === 'nopago' || (r[0].tipo === 'pago' && v === 0)) return { tipo: 'NO PAGO', valorPagado: v, syncId, pendiente };
  if (r[0].tipo === 'parcial') return { tipo: 'PARCIAL', valorPagado: v, syncId, pendiente };
  return { tipo: 'PAGO', valorPagado: v, syncId, pendiente };
};

const ItemPayments = memo(({
  id, name, address, amount, status, paymentType, estadoPago, saldo, cuotasPagas,
  saldoVencido, nombreUno, valorCuota, onPaymentSuccess, estadoMovil, telefono,
  latitud, longitud, valorCredito,
  tipoTramitado: propTipoTramitado,
  valorPagado: propValorPagado,
  pendienteSync: propPendienteSync,
}) => {
  const navigation = useNavigation();
  const [modalParcial, setModalParcial] = useState(false);
  const [modalNoPago, setModalNoPago] = useState(false);
  const [valorParcial, setValorParcial] = useState('');
  const [loading, setLoading] = useState(false);
  const [tipoTramitado, setTipoTramitado] = useState(propTipoTramitado || null);
  const [valorPagado, setValorPagado] = useState(propValorPagado || 0);
  const [pendienteSync, setPendienteSync] = useState(propPendienteSync !== undefined ? propPendienteSync : false);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (propTipoTramitado !== undefined) setTipoTramitado(propTipoTramitado);
    if (propValorPagado !== undefined) setValorPagado(propValorPagado);
    if (propPendienteSync !== undefined) setPendienteSync(propPendienteSync);
    else if (estadoMovil === 'actualizado') {
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
      const ncp = tipo === 'nopago' ? cuotasPagas : cuotasPagas + 1;
      await updateFacturaWithConsecutivo(db, id, { estadoMovil: 'actualizado', saldo: ns, cuotasPagas: ncp, saldoVencido: nsv }, c);
      await Promise.all([insertTables(db, 'pagos', [pago]), insertTables(db, 'detallesCaja', [detalle])]);

      // Requisito 5: Guardar movimiento local para que se refleje inmediatamente en Movimientos y Caja
      const nowIso = new Date().toISOString();
      const clienteDesc = name || nombreUno || 'Cliente';
      const descMov = tipo === 'nopago'
        ? `No pago: ${clienteDesc}`
        : `Pago: ${clienteDesc} (${FormatMoneyDecimales(valorPago)})`;

      try {
        await db.executeSql(
          `INSERT INTO movimientos (id, descripcion, monto, horaDispositivo, tipo, estadoMovil, idCaja, fecha, idFactura, cliente_nombre)
           VALUES (?, ?, ?, ?, ?, 'actualizado', ?, ?, ?, ?)`,
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

      setTipoTramitado(tipo === 'nopago' ? 'NO PAGO' : tipo === 'parcial' ? 'PARCIAL' : 'PAGO');
      setValorPagado(tipo === 'nopago' ? 0 : valorPago);
      setPendienteSync(true);

      Toast.show({ text1: tipo === 'pago' ? 'Pago realizado' : tipo === 'nopago' ? 'No pago registrado' : 'Pago parcial realizado' });
      onPaymentSuccess?.();
      if (tipo === 'parcial') { setModalParcial(false); setValorParcial(''); } else if (tipo === 'nopago') setModalNoPago(false);
    } catch (e) {
      console.log('Error executePaymentAction:', e);
      Toast.show({ text1: 'Error al procesar', text2: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  }, [id, saldo, cuotasPagas, saldoVencido, nombreUno, onPaymentSuccess]);

  const textoChip = estadoMovil === 'actualizado' && tipoTramitado ? tipoTramitado : paymentType;
  const valorAMostrar = estadoMovil === 'actualizado' ? valorPagado : amount;
  const isPending = status === 'PENDIENTE';
  const amountColor = !isPending && tipoTramitado ? (tipoTramitado === 'NO PAGO' ? apple.colors.danger : tipoTramitado === 'PARCIAL' ? apple.colors.warning : apple.colors.success) : apple.colors.success;
  const handlePressCard = () => {
    navigation.navigate('CreditDetail', { invoiceId: id, clientName: name, address, telefono, latitud, longitud, saldo });
  };

  return (
    <Animated.View style={{ transform: [{ scale }], marginHorizontal: 14, marginBottom: 8 }}>
      <TouchableOpacity activeOpacity={0.9} onPress={handlePressCard} onPressIn={pressIn} onPressOut={pressOut} style={styles.card}>
        <View style={styles.content}>
          {/* Fila 1: Nombre + Teléfono al lado | GPS reemplaza estado arriba */}
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
                  <Icon name="phone" size={10} color={apple.colors.success} />
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
              style={[styles.gpsPillTop, !(latitud != null && longitud != null && Number(latitud) !== 0 && Number(longitud) !== 0) && { opacity: 0.5, borderColor: apple.colors.tertiaryLabel }]}
              activeOpacity={0.7}
            >
              <Icon name="map-marker" size={13} color={latitud != null && longitud != null && Number(latitud) !== 0 && Number(longitud) !== 0 ? apple.colors.blue : apple.colors.tertiaryLabel} />
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
                    {pendienteSync ? (
                      <Icon name="check" size={11} color={apple.colors.tertiaryLabel} />
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="check" size={11} color="#007AFF" />
                        <Icon name="check" size={11} color="#007AFF" style={{ marginLeft: -4 }} />
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
            <View style={styles.saldoBox}>
              <Text style={styles.saldoLabel}>SALDO PENDIENTE</Text>
              <Text style={[styles.saldo, saldo === 0 && { color: apple.colors.success }]}>{FormatMoneyDecimales(saldo)}</Text>
            </View>
          </View>



          {/* Fila 3: Botones o Info tramitado */}
          {isPending ? (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionOutlineSuccess]} onPress={() => executePaymentAction('pago', Math.min(valorCuota, saldo))} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color={apple.colors.success} /> : <><Icon name="check" size={13} color={apple.colors.success} /><Text style={styles.actionTextSuccess}> Pagar</Text></>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionOutlineDanger]} onPress={() => setModalNoPago(true)}>
                <Icon name="times" size={13} color={apple.colors.danger} /><Text style={styles.actionTextDanger}> No pago</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionOutlineWarning]} onPress={() => setModalParcial(true)}>
                <Icon name="adjust" size={13} color={apple.colors.warning} /><Text style={styles.actionTextWarning}> Parcial</Text>
              </TouchableOpacity>
            </View>
          ) : (
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
                <Text style={[styles.tramitadoVal, { color: Number(saldoVencido) > 0 ? apple.colors.danger : apple.colors.success }]}>{FormatMoneyDecimales(saldoVencido)}</Text>
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Modal isVisible={modalParcial} onBackdropPress={() => setModalParcial(false)} animationIn="slideInUp" animationOut="slideOutDown" backdropOpacity={0.4}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Pago parcial</Text>
          <Text style={styles.sheetSub}>{name} · Saldo {FormatMoneyDecimales(saldo)}</Text>
          <TextInput placeholder="$ 0" keyboardType="numeric" style={styles.sheetInput} value={valorParcial} onChangeText={t => setValorParcial(formatMoneyInput(t))} placeholderTextColor={apple.colors.tertiaryLabel} />
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
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: apple.colors.fill }]} onPress={() => setModalNoPago(false)}><Text style={{ fontWeight: '600', color: apple.colors.label }}>Cancelar</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: apple.colors.danger }]} onPress={() => executePaymentAction('nopago', 0)}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={{ fontWeight: '600', color: '#fff' }}>Confirmar</Text>}</TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Animated.View>
  );
}, (a,b)=> a.id===b.id && a.status===b.status && a.saldo===b.saldo && a.estadoMovil===b.estadoMovil);

export default ItemPayments;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: apple.radius.l,
    borderWidth: 1,
    borderColor: '#E8EAED',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.11,
        shadowRadius: 12,
      },
      android: { elevation: 12 },
      default: { elevation: 12 },
    }),
  },
  content: { padding: 12 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  nameContainer: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 16, fontWeight: '700', color: apple.colors.label, letterSpacing: -0.3, flexShrink: 1 },
  addr: { fontSize: 12, color: apple.colors.secondaryLabel, marginTop: 1 },
  phonePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'transparent', borderWidth: 1, borderColor: apple.colors.success, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  phoneText: { fontSize: 11, fontWeight: '600', color: '#000', maxWidth: 110 },
  gpsPillTop: { width: 28, height: 28, borderRadius: apple.radius.m, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: '#000', marginLeft: 8, flexShrink: 0 },
  gpsText: { fontSize: 11, fontWeight: '600' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8F9FB', borderRadius: apple.radius.m, paddingHorizontal: 10, paddingVertical: 6, marginTop: 8 },
  amountBox: { flexDirection: 'column' },
  amountLabel: { fontSize: 9, fontWeight: '700', color: apple.colors.secondaryLabel, letterSpacing: 0.3 },
  amount: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  syncBadge: { flexDirection: 'row', alignItems: 'center' },
  saldoBox: { flexDirection: 'column', alignItems: 'flex-end' },
  saldoLabel: { fontSize: 9, fontWeight: '700', color: apple.colors.tertiaryLabel, letterSpacing: 0.3 },
  saldo: { fontSize: 13, fontWeight: '700', color: apple.colors.label },
  actions: { flexDirection: 'row', gap: 4, marginTop: 8 },
  actionBtn: { flex: 1, flexDirection: 'row', height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: '#FFFFFF' },
  actionOutlineSuccess: { borderColor: apple.colors.success },
  actionOutlineDanger: { borderColor: apple.colors.danger },
  actionOutlineWarning: { borderColor: apple.colors.warning },
  actionCall: { borderColor: apple.colors.blue, backgroundColor: '#FFFFFF' },
  actionTextSuccess: { color: apple.colors.success, fontWeight: '700', fontSize: 11 },
  actionTextDanger: { color: apple.colors.danger, fontWeight: '700', fontSize: 11 },
  actionTextWarning: { color: apple.colors.warning, fontWeight: '700', fontSize: 11 },
  actionTextCall: { color: apple.colors.blue, fontWeight: '700', fontSize: 11 },
  tramitadoInfo: { flexDirection: 'row', backgroundColor: '#F8F9FB', borderRadius: apple.radius.m, paddingVertical: 8, paddingHorizontal: 6, marginTop: 8, alignItems: 'center' },
  tramitadoCol: { flex: 1, alignItems: 'center' },
  tramitadoLabel: { fontSize: 9, fontWeight: '700', color: apple.colors.secondaryLabel, letterSpacing: 0.3 },
  tramitadoVal: { fontSize: 12, fontWeight: '700', color: apple.colors.label, marginTop: 2 },
  tramitadoSep: { width: 1, height: 24, backgroundColor: '#E8EAED' },
  sheet: { backgroundColor: apple.colors.card, borderRadius: apple.radius.xl, padding: 20 },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: apple.colors.separator, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: apple.colors.label, textAlign: 'center' },
  sheetSub: { fontSize: 13, color: apple.colors.secondaryLabel, textAlign: 'center', marginTop: 4 },
  sheetInput: { backgroundColor: apple.colors.fill, borderRadius: apple.radius.s, borderWidth: 1, borderColor: apple.colors.separator, padding: 14, marginTop: 16, fontSize: 17, color: apple.colors.label, textAlign: 'center' },
  sheetPrimary: { backgroundColor: apple.colors.blue, borderRadius: apple.radius.s, height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  sheetPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  sheetBtn: { flex: 1, height: 46, borderRadius: apple.radius.s, alignItems: 'center', justifyContent: 'center' },
});
