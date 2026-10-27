import React, { useState, useCallback, useEffect } from 'react';
import { BackHandler, View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, TextInput, Alert, RefreshControl, SafeAreaView } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getCajaActual, abrirCaja, cerrarCaja, getMovimientosCaja, getHistorialCajas, getPendingSyncCount } from '../../services/cajaService';
import { useAuth } from '../../context/AuthContext';
import { FormatMoneyDecimales, formatMoneyInput, parseMoneyToNumeric } from '../../utils/utilities';
import { apple } from '../../theme/appleTheme';
import { AppleButton } from '../../components/AppleButton';
import { appAlert } from '../../components/AppAlert';
import { eventBus, EVENTS } from '../../utils/eventBus';
import { clearOnlyPendingSync, clearAllLocalData } from '../../utils/clearLocal';

export default function CajaScreen() {
  const { profile } = useAuth();
  const [caja, setCaja] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saldoInicial, setSaldoInicial] = useState('');
  const [tab, setTab] = useState('actual');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const actual = await getCajaActual();
      setCaja(actual);
      setMovimientos(actual ? await getMovimientosCaja(actual.id, 50, 0) : []);
      setHistorial((await getHistorialCajas(20, 0)) || []);
    } catch (e) {
      console.log('Caja load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const unsub1 = eventBus.on(EVENTS.CLIENT_CREATED, () => load());
    const unsub2 = eventBus.on(EVENTS.PAYMENT_REGISTERED, () => load());
    const unsub3 = eventBus.on(EVENTS.MOVEMENT_CHANGED, () => load());
    const unsub4 = eventBus.on(EVENTS.SYNC_COMPLETED, () => load());
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [load]);
  const navigation = useNavigation();
  useFocusEffect(
    React.useCallback(() => {
      const onBack = () => {
        if (navigation.canGoBack()) {
          navigation.navigate('Payments');
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      const beforeRemove = navigation.addListener('beforeRemove', (e) => {
        if (e.data.action.type === 'GO_BACK') {
          e.preventDefault();
          navigation.navigate('Payments');
        }
      });
      return () => {
        sub.remove();
        beforeRemove();
      };
    }, [navigation])
  );
  const onRefresh = () => { setRefreshing(true); load(); };
  const handleClearPending = () =>
    appAlert('Reiniciar', '¿Borrar solo pendientes que ya están arriba? Usa reinicio total si necesitas borrar todo.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar pendientes', onPress: async () => { await clearOnlyPendingSync(); appAlert('Hecho', 'Pendientes borrados'); load(); } },
      { text: 'Borrar TODO', style: 'destructive', onPress: async () => { await clearAllLocalData(); appAlert('Hecho', 'Base reiniciada. Cierra y abre la app.'); } },
    ]);

  const isAdmin = profile?.rol === 'admin' || profile?.rol === 'superadmin';

  const handleAbrir = async () => {
    if (!isAdmin) {
      return appAlert('Acceso restringido', 'Solo el administrador puede realizar la apertura de cajas.');
    }
    const val = parseMoneyToNumeric(saldoInicial);
    if (val < 0) return appAlert('Error', 'Saldo inicial no puede ser negativo');
    try { setLoading(true); await abrirCaja(val); await load(); appAlert('Éxito', 'Caja abierta'); } catch (e) { appAlert('Error', e.message); } finally { setLoading(false); }
  };
  const handleCerrar = async () => {
    try {
      const pendingCount = await getPendingSyncCount();
      if (pendingCount > 0) {
        appAlert(
          'Movimientos sin enviar',
          `Tienes ${pendingCount} movimiento(s) guardado(s) en tu teléfono que aún no se han enviado al sistema. Conéctate a internet y presiona 'Sincronizar' antes de cerrar la caja para que tus cuentas cuadren.`
        );
        return;
      }
    } catch { }

    appAlert('Cerrar caja del día', '¿Estás seguro de cerrar tu caja? Se calculará tu saldo final definitivo y se enviará el balance del día al sistema.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar',
        style: 'destructive',
        onPress: async () => {
          try {
            setLoading(true);
            await cerrarCaja(caja.id);
            await load();
            appAlert('Éxito', 'Caja cerrada exitosamente');
          } catch (e) {
            appAlert('No se pudo cerrar', e.message);
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const Row = ({ item }) => {
    const isIngreso = item.tipo === 'ingreso' || item.tipo === 'pago';
    const color = isIngreso ? apple.colors.success : '#FF3B30';
    return (
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: color + '18' }]}><Icon name={isIngreso ? 'arrow-down' : 'arrow-up'} size={13} color={color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.tipo.toUpperCase()} · {isIngreso ? '+' : '-'}{FormatMoneyDecimales(item.monto)}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{item.descripcion || 'Sin descripción'} · {new Date(item.fecha).toLocaleString()}</Text>
        </View>
      </View>
    );
  };

  if (loading && !caja && movimientos.length === 0 && historial.length === 0) return <View style={styles.center}><ActivityIndicator size="large" color={apple.colors.blue} /></View>;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Caja</Text>
        <Text style={styles.headerSub}>{profile?.nombre || 'Usuario'} · {profile?.rol || ''}</Text>
      </View>

      <View style={styles.segment}>
        {['actual', 'historial'].map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.segOpt, tab === t && styles.segActive]}>
            <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t === 'actual' ? 'Actual' : 'Historial'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={handleClearPending} style={{ marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: '#FF3B30', borderRadius: apple.radius.m, padding: 10, alignItems: 'center' }}>
        <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 12 }}><Icon name="trash" size={12} color="#FF3B30" /> Reiniciar / Borrar pendientes</Text>
      </TouchableOpacity>

      {tab === 'actual' ? (
        !caja ? (
          <View style={{ padding: 16 }}>
            <View style={{ padding: 16 }}>
              <View style={[styles.card, { alignItems: 'center', padding: 28 }]}>
                <View style={[styles.iconCircle, { backgroundColor: apple.colors.fill, width: 64, height: 64, borderRadius: 32 }]}>
                  <Icon name="lock" size={26} color={apple.colors.tertiaryLabel} />
                </View>
                <Text style={[styles.emptyTitle, { fontSize: 18, marginTop: 10 }]}>Caja cerrada</Text>
                {isAdmin ? (
                  <>
                    <Text style={[styles.emptySub, { marginBottom: 16 }]}>Ingresa el saldo inicial para iniciar jornada</Text>
                    <View style={styles.inputRow}>
                      <TextInput style={styles.input} value={saldoInicial} onChangeText={t => setSaldoInicial(formatMoneyInput(t))} keyboardType="numeric" placeholder="$ 0" placeholderTextColor={apple.colors.tertiaryLabel} />
                      <AppleButton title="Abrir caja" onPress={handleAbrir} style={{ flex: 1 }} />
                    </View>
                  </>
                ) : (
                  <Text style={[styles.emptySub, { marginTop: 8, lineHeight: 20, maxWidth: 290, textAlign: 'center' }]}>
                    Tu caja del día se encuentra cerrada. Solo tu administrador puede realizar la apertura de cajas para que puedas operar.
                  </Text>
                )}
              </View>
            </View>
          </View>
        ) : (
          <>
            <View style={{ padding: 16, paddingBottom: 8 }}>
              <View style={[styles.card, { padding: 16 }]}>
                <View style={styles.cajaTop}>
                  <View style={styles.badgeLive}><View style={styles.dot} /><Text style={styles.liveText}>ABIERTA</Text></View>
                  <Text style={styles.cajaDate}>{caja.fecha_apertura || caja.fecha ? new Date(caja.fecha_apertura || caja.fecha).toLocaleString() : ''}</Text>
                </View>
                <View style={styles.saldoRow}>
                  <View style={styles.saldoBox}><Text style={styles.saldoLabel}>Inicial</Text><Text style={styles.saldoVal}>{FormatMoneyDecimales(caja.saldo_inicial)}</Text></View>
                  <View style={styles.saldoBox}><Text style={styles.saldoLabel}>Final (calc)</Text><Text style={[styles.saldoVal, { color: apple.colors.blue }]}>{FormatMoneyDecimales(caja.saldo_final || 0)}</Text></View>
                </View>
                <Text style={styles.cajaId}>ID {String(caja.id || '').slice(0, 8)}…</Text>
                <TouchableOpacity style={styles.closeBtn} onPress={handleCerrar}><Icon name="power-off" size={14} color="#fff" /><Text style={styles.closeText}>  Cerrar caja</Text></TouchableOpacity>
              </View>
            </View>
            <View style={styles.listHeader}><Text style={styles.listTitle}>Movimientos · {movimientos.length}</Text><TouchableOpacity onPress={load}><Icon name="refresh" size={14} color={apple.colors.blue} /></TouchableOpacity></View>
            <FlatList data={movimientos} keyExtractor={i => String(i.id)} renderItem={Row} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />} ListEmptyComponent={<Text style={styles.emptySub}>Sin movimientos. Crea uno en Movimientos.</Text>} contentContainerStyle={{ paddingBottom: 20 }} />
          </>
        )
      ) : (
        <FlatList
          data={historial} keyExtractor={i => String(i.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: item.estado === 'abierta' ? apple.colors.success + '18' : apple.colors.fill }]}><Icon name={item.estado === 'abierta' ? 'unlock' : 'lock'} size={13} color={item.estado === 'abierta' ? apple.colors.success : apple.colors.tertiaryLabel} /></View>
              <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.estado.toUpperCase()} · {FormatMoneyDecimales(item.saldo_inicial)} → {FormatMoneyDecimales(item.saldo_final)}</Text><Text style={styles.rowSub}>{new Date(item.fecha_apertura || item.fecha || Date.now()).toLocaleDateString()}{item.fecha_cierre ? ' · ' + new Date(item.fecha_cierre).toLocaleDateString() : ''}</Text></View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptySub}>Sin historial</Text>}
          contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: apple.colors.bgGrouped },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: apple.radius.l,
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: apple.colors.card, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 0.5, borderColor: apple.colors.separator },
  headerTitle: { fontSize: 28, fontWeight: '700', color: apple.colors.label, letterSpacing: 0.36 },
  headerSub: { fontSize: 13, color: apple.colors.secondaryLabel, marginTop: 2, textTransform: 'capitalize' },
  segment: { flexDirection: 'row', backgroundColor: apple.colors.fill, margin: 16, borderRadius: apple.radius.s, padding: 3, gap: 4 },
  segOpt: { flex: 1, paddingVertical: 8, borderRadius: apple.radius.s, alignItems: 'center' },
  segActive: { backgroundColor: apple.colors.card },
  segText: { fontSize: 13, fontWeight: '500', color: apple.colors.secondaryLabel },
  segTextActive: { color: apple.colors.label, fontWeight: '600' },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: apple.colors.label, marginTop: 4 },
  emptySub: { fontSize: 13, color: apple.colors.secondaryLabel, textAlign: 'center', marginTop: 6 },
  inputRow: { flexDirection: 'row', gap: 10, marginTop: 16, alignItems: 'center', width: '100%' },
  input: { flex: 1, backgroundColor: apple.colors.fill, borderRadius: apple.radius.s, borderWidth: 1, borderColor: apple.colors.separator, paddingHorizontal: 14, height: 48, fontSize: 16, color: apple.colors.label },
  cajaTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badgeLive: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: apple.colors.success + '14', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: apple.colors.success },
  liveText: { fontSize: 11, fontWeight: '700', color: apple.colors.success, letterSpacing: 0.5 },
  cajaDate: { fontSize: 11, color: apple.colors.tertiaryLabel },
  saldoRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  saldoBox: { flex: 1, backgroundColor: apple.colors.fill, borderRadius: apple.radius.s, padding: 12, alignItems: 'center' },
  saldoLabel: { fontSize: 11, fontWeight: '600', color: apple.colors.secondaryLabel, letterSpacing: 0.5, textTransform: 'uppercase' },
  saldoVal: { fontSize: 16, fontWeight: '700', color: apple.colors.label, marginTop: 4 },
  cajaId: { fontSize: 10, color: apple.colors.tertiaryLabel, marginTop: 8, textAlign: 'center' },
  closeBtn: { flexDirection: 'row', backgroundColor: apple.colors.danger, borderRadius: apple.radius.s, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  closeText: { color: '#fff', fontWeight: '700' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center' },
  listTitle: { fontSize: 13, fontWeight: '600', color: apple.colors.secondaryLabel, letterSpacing: 0.3, textTransform: 'uppercase' },
  row: { flexDirection: 'row', backgroundColor: apple.colors.card, marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: apple.radius.m, alignItems: 'center', gap: 12 },
  badge: { width: 32, height: 32, borderRadius: apple.radius.l, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, fontWeight: '600', color: apple.colors.label },
  rowSub: { fontSize: 11, color: apple.colors.tertiaryLabel, marginTop: 2 },
});
