import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, SafeAreaView, FlatList, TextInput, ActivityIndicator, TouchableOpacity, Animated, BackHandler, Alert, RefreshControl, Dimensions, Platform } from 'react-native';
import { useFocusEffect, useNavigation, useNavigationState } from '@react-navigation/native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/FontAwesome';
import Toast from 'react-native-toast-message';
import ItemPayments from './components/itemPayments';
import { getData, getDbConnection } from '../../database/db';
import { eventBus, EVENTS } from '../../utils/eventBus';
import { FormatMoneyDecimales } from '../../utils/utilities';
import { apple } from '../../theme/appleTheme';
import { appAlert } from '../../components/AppAlert';
import { useAuth } from '../../context/AuthContext';
import { getCajaActual, cerrarCaja } from '../../services/cajaService';
import { SyncWithSupabase, SyncCajaAndMovimientos } from '../../utils/sync';
import { clearAllLocalData } from '../../utils/clearLocal';
import { getInvoice } from '../../services/services';
import { supabase } from '../../lib/supabase';

const mapPaymentType = (id) => ({ 1: 'MENSUAL', 2: 'SEMANAL', 3: 'QUINCENAL' }[id] || '—');
const normalizeClient = (item, clientsByDoc = {}, latestPagoByFactura = {}) => {
  const telFromRow = (item.telefono || item.celular || '').trim();
  const telFromClients = item.documento ? (clientsByDoc[item.documento] || '') : '';
  const isActualizado = (item.status || '').toLowerCase().trim() === 'actualizado';
  const p = latestPagoByFactura[String(item.id)];

  let tipoTramitado = null;
  let valorPagado = 0;
  let pendienteSync = false;

  if (p) {
    const v = Number(p.valor) || 0;
    valorPagado = v;
    if (p.tipo === 'nopago' || (p.tipo === 'pago' && v === 0)) {
      tipoTramitado = 'NO PAGO';
    } else if (p.tipo === 'parcial') {
      tipoTramitado = 'PARCIAL';
    } else {
      tipoTramitado = 'PAGO';
    }
    // Si estadoMovil es 'sincronizado', pendienteSync es false (2 chulitos).
    // Si estadoMovil !== 'sincronizado' y tiene id negativo local, pendienteSync es true (1 chulito).
    pendienteSync = (p.estadoMovil !== 'sincronizado' && Number(p.id) < 0);
  } else if (isActualizado) {
    tipoTramitado = 'PAGO';
    pendienteSync = false;
  }

  return {
    id: item.id,
    name: (item.name?.trim() || 'Sin nombre'),
    address: (item.address?.trim() || 'Sin dirección'),
    amount: Number(item.amount) || 0,
    status: (item.status || '').toUpperCase().trim(),
    estadoPago: (item.estadoPago || '').toLowerCase().trim(),
    estadoMovil: (item.status || '').toLowerCase().trim(),
    paymentType: mapPaymentType(item.paymentType),
    time: item.time || '—',
    saldo: Number(item.saldo) || 0,
    cuotasPagas: Number(item.cuotasPagas) || 0,
    saldoVencido: Number(item.saldoVencido) || 0,
    nombreUno: item.nombreUno?.trim() || '',
    apellidoUno: item.apellidoUno?.trim() || '',
    telefono: (telFromRow || telFromClients).trim(),
    latitud: item.latitud != null && item.latitud !== '' ? Number(item.latitud) : null,
    longitud: item.longitud != null && item.longitud !== '' ? Number(item.longitud) : null,
    documento: (item.documento || '').trim(),
    valorCredito: Number(item.valorInicial || item.valorCredito || 0) || 0,
    tipoTramitado,
    valorPagado,
    pendienteSync,
  };
};

const loadClientsFromDB = async () => {
  const db = await getDbConnection();
  const caja = await getCajaActual();
  const cajaId = caja?.id || null;
  const data = await getData(
    db,
    `SELECT id, nombreUno || ' ' || COALESCE(apellidoUno, '') AS name, direccion AS address, valorCuota AS amount, estadoMovil AS status, estado AS estadoPago, paymentTermId AS paymentType, strftime('%H:%M', fecha) AS time, saldo, cuotasPagas, saldoVencido, nombreUno, apellidoUno, celular, documento, latitud, longitud, valorInicial FROM facturas WHERE estadoMovil IS NOT NULL AND ((estadoMovil = 'pendiente' AND saldo > 0) OR estadoMovil = 'actualizado' OR id IN (SELECT idFactura FROM pagos WHERE (idCaja = ? OR date(substr(horaDispositivo,1,10)) = date('now','localtime'))))`,
    [cajaId || '']
  );
  let clientsByDoc = {};
  try {
    const clientsRows = await getData(db, `SELECT documento, telefono FROM clients`);
    if (clientsRows) for (const c of clientsRows) if (c.documento) clientsByDoc[c.documento] = c.telefono || '';
  } catch { }

  // Cargar pagos locales para mapear trámite y sincronización en 1 sola consulta
  let latestPagoByFactura = {};
  try {
    const pagosRows = await getData(
      db,
      `SELECT idFactura, tipo, valor, estadoMovil, id, horaDispositivo FROM pagos ORDER BY horaDispositivo ASC, rowid ASC`
    );
    if (pagosRows) {
      for (const p of pagosRows) {
        if (p.idFactura) {
          latestPagoByFactura[String(p.idFactura)] = p;
        }
      }
    }
  } catch (errPagos) {
    console.log('Error loading pagos in loadClientsFromDB:', errPagos);
  }

  return data.map(i => normalizeClient(i, clientsByDoc, latestPagoByFactura));
};

const calculateStats = async (clients) => {
  const db = await getDbConnection();
  const caja = await getCajaActual();
  const cajaId = caja?.id || null;
  let collected = 0;
  try {
    let q = `SELECT SUM(CAST(valor AS REAL)) as total FROM pagos WHERE tipo != 'nopago'`;
    let p = [];
    if (cajaId) {
      q += ` AND (idCaja = ? OR date(substr(horaDispositivo,1,10)) = date('now','localtime'))`;
      p.push(cajaId);
    } else {
      q += ` AND date(substr(horaDispositivo,1,10)) = date('now','localtime')`;
    }
    const pagos = await getData(db, q, p);
    collected = Number(pagos[0]?.total || 0);
  } catch { collected = 0; }
  const processed = clients.filter(c => c.estadoMovil === 'actualizado');
  const pendingClients = clients.filter(c => c.estadoMovil === 'pendiente');
  const pendingAmount = pendingClients.reduce((s, c) => s + c.amount, 0);
  const totalVisits = clients.length;
  const progress = totalVisits > 0 ? Math.round((processed.length / totalVisits) * 100) : 0;
  return { pending: totalVisits, processed: processed.length, pendingAmount, collected, progress };
};

export default function Payments() {
  const navigation = useNavigation();
  const { signOut } = useAuth();
  const [showPending, setShowPending] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({ pending: 0, processed: 0, pendingAmount: 0, collected: 0, progress: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [segmentWidth, setSegmentWidth] = useState(0);

  // Animaciones 100% nativas en GPU (0 lag, 0 consumo innecesario)
  const slideAnim = useRef(new Animated.Value(0)).current; // 0 = pendiente, 1 = tramitados
  const listOpacity = useRef(new Animated.Value(1)).current;

  const handleTabChange = (pending) => {
    if (showPending === pending) return;

    // 1. Mover indicador con resorte nativo en GPU (100% fluido)
    Animated.spring(slideAnim, {
      toValue: pending ? 0 : 1,
      useNativeDriver: true,
      friction: 9,
      tension: 65,
    }).start();

    // 2. Transición suave y estable de la lista sin parpadeos ni tirones
    listOpacity.setValue(0.75);
    Animated.timing(listOpacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();

    setShowPending(pending);
  };

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      let n = await loadClientsFromDB();
      // Si la base local de facturas está vacía (ej: recién logueado o recién borrado datos),
      // descargar inmediatamente desde Supabase
      if (n.length === 0) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          try {
            await getInvoice(session.user.id, session.access_token);
            n = await loadClientsFromDB();
          } catch (e) { console.log('Auto fetch invoice error:', e); }
        }
      }
      setClients(n);
      setStats(await calculateStats(n));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    loadClients();
    const unsubClient = eventBus.on(EVENTS.CLIENT_CREATED, () => loadClients());
    const unsubPay = eventBus.on(EVENTS.PAYMENT_REGISTERED, () => loadClients());
    const unsubMov = eventBus.on(EVENTS.MOVEMENT_CHANGED, () => loadClients());
    const unsubSync = eventBus.on(EVENTS.SYNC_COMPLETED, () => loadClients());
    return () => {
      unsubClient();
      unsubPay();
      unsubMov();
      unsubSync();
    };
  }, [loadClients]);

  useFocusEffect(
    useCallback(() => {
      loadClients();
    }, [loadClients])
  );

  const handleSyncAndRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      Toast.show({ text1: 'Sincronizando con servidor...' });
      await SyncWithSupabase(false);

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await getInvoice(session.user.id, session.access_token);
      }

      const n = await loadClientsFromDB();
      setClients(n);
      setStats(await calculateStats(n));
      Toast.show({ text1: 'Cartera actualizada' });
    } catch (e) {
      console.log('Error refreshing payments:', e);
      Toast.show({ text1: 'Error de sincronización', text2: e.message || String(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const filteredClients = useMemo(() => clients.filter(c => (showPending ? (c.estadoMovil === 'pendiente' && c.saldo > 0 && c.estadoPago !== 'cancel') : c.estadoMovil === 'actualizado') && c.name.toLowerCase().includes(searchText.toLowerCase())), [clients, showPending, searchText]);

  // Interpolación de posición para el fondo animado del segment (acelerado por GPU)
  const screenWidth = Dimensions.get('window').width;
  const tabWidth = segmentWidth > 0 ? (segmentWidth - 6) / 2 : (screenWidth - 32 - 6) / 2;
  const segTranslateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tabWidth],
  });

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const ok = await signOut();
      if (ok) {
        setShowLogout(false);
      }
    } catch (err) {
      console.log('handleLogout error:', err);
    } finally {
      setLoggingOut(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        // Si hay pantallas secundarias apiladas en el stack, permitir navegación natural
        if (navigation.canGoBack()) {
          navigation.goBack();
          return true;
        }
        // Solo abrir diálogo de confirmación de salida si estamos en la raíz de Pagos
        if (showLogout) {
          setShowLogout(false);
          return true;
        }
        setShowLogout(true);
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => {
        sub.remove();
      };
    }, [navigation, showLogout])
  );

  return (
    <SafeAreaView style={styles.root}>
      {/* Header integrado estilo compacto con Visitas y Recaudo al lado derecho */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.titleSection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.largeTitle}>Cartera</Text>
              <TouchableOpacity
                onPress={handleSyncAndRefresh}
                style={styles.syncBtn}
                disabled={refreshing}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color={apple.colors.blue} />
                ) : (
                  <Icon name="refresh" size={14} color={apple.colors.blue} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowLogout(true)}
                style={styles.syncBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="sign-out" size={14} color={apple.colors.danger} />
              </TouchableOpacity>
            </View>
            <Text style={styles.headerSub}>{filteredClients.length} clientes · {showPending ? 'Por visitar' : 'Tramitados'}</Text>
          </View>

          {/* Mini Stats a la derecha del título: Visitas con barra + Recaudo */}
          <View style={styles.headerStats}>
            <View style={styles.statMiniItem}>
              <Text style={styles.statMiniLabel}>VISITAS</Text>
              <Text style={styles.statMiniVal}>{stats.processed}<Text style={styles.statMiniMuted}>/{stats.pending}</Text></Text>
              <View style={styles.visitasBarBg}>
                <View style={[styles.visitasBarFill, { width: `${stats.progress}%` }]} />
              </View>
            </View>
            <View style={styles.statMiniSep} />
            <View style={styles.statMiniItem}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.statMiniLabel}>RECAUDO</Text>
                <View style={styles.percentBadge}>
                  <Text style={styles.percentText}>{stats.progress}%</Text>
                </View>
              </View>
              <Text style={styles.statMiniVal}>
                {FormatMoneyDecimales(stats.collected)}
                <Text style={styles.statMiniMuted}> / {FormatMoneyDecimales(stats.pendingAmount)}</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* Search bar compacta */}
        <View style={styles.searchBar}>
          <Icon name="search" size={13} color={apple.colors.tertiaryLabel} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar cliente"
            placeholderTextColor={apple.colors.tertiaryLabel}
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="times-circle" size={14} color={apple.colors.tertiaryLabel} />
            </TouchableOpacity>
          )}
        </View>

        {/* Segmented control con traslación fluida y nativa */}
        <View
          style={styles.segment}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - segmentWidth) > 1) setSegmentWidth(w);
          }}
        >
          <Animated.View style={[styles.segActiveBg, { width: tabWidth, transform: [{ translateX: segTranslateX }] }]} />
          <TouchableOpacity activeOpacity={0.7} onPress={() => handleTabChange(true)} style={styles.segOpt}>
            <Icon name="clock-o" size={12} color={showPending ? apple.colors.label : apple.colors.secondaryLabel} />
            <Text style={[styles.segText, showPending && styles.segTextActive]}> Por visitar</Text>
            <View style={[styles.countBadge, showPending && styles.countBadgeActive]}>
              <Text style={[styles.countText, showPending && styles.countTextActive]}>{clients.filter(c => c.estadoMovil === 'pendiente' && c.saldo > 0).length}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={() => handleTabChange(false)} style={styles.segOpt}>
            <Icon name="check-circle" size={12} color={!showPending ? apple.colors.label : apple.colors.secondaryLabel} />
            <Text style={[styles.segText, !showPending && styles.segTextActive]}> Tramitados</Text>
            <View style={[styles.countBadge, !showPending && styles.countBadgeActive]}>
              <Text style={[styles.countText, !showPending && styles.countTextActive]}>{clients.filter(c => c.estadoMovil === 'actualizado').length}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {loading && clients.length === 0 ? (
        <View style={styles.center}><ActivityIndicator size="large" color={apple.colors.blue} /><Text style={styles.loadingText}>Cargando cartera…</Text></View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: listOpacity }}>
          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16, paddingTop: 6 }}
            data={filteredClients}
            keyExtractor={i => i.id.toString()}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleSyncAndRefresh}
                tintColor={apple.colors.blue}
                colors={[apple.colors.blue]}
              />
            }
            renderItem={({ item }) => (
              <ItemPayments
                id={item.id}
                name={item.name}
                address={item.address}
                amount={item.amount}
                status={item.status}
                time={item.time}
                paymentType={item.paymentType}
                estadoPago={item.estadoPago}
                saldo={item.saldo}
                cuotasPagas={item.cuotasPagas}
                saldoVencido={item.saldoVencido}
                nombreUno={item.nombreUno}
                apellidoUno={item.apellidoUno}
                valorCuota={item.amount}
                estadoMovil={item.estadoMovil}
                telefono={item.telefono}
                latitud={item.latitud}
                longitud={item.longitud}
                valorCredito={item.valorCredito}
                tipoTramitado={item.tipoTramitado}
                valorPagado={item.valorPagado}
                pendienteSync={item.pendienteSync}
                onPaymentSuccess={loadClients}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}><Icon name="search" size={22} color={apple.colors.tertiaryLabel} /></View>
                <Text style={styles.emptyTitle}>Sin resultados</Text>
                <Text style={styles.emptySub}>{searchText ? 'Prueba otro término' : showPending ? 'No hay clientes por visitar' : 'No hay tramitados'}</Text>
              </View>
            }
          />
        </Animated.View>
      )}

      <Modal isVisible={showLogout} onBackdropPress={() => setShowLogout(false)} backdropOpacity={0.4} animationIn="slideInUp" animationOut="slideOutDown">
        <View style={styles.logoutSheet}>
          <View style={styles.logoutHandle} />
          <View style={styles.logoutIcon}><Icon name="sign-out" size={22} color={apple.colors.danger} /></View>
          <Text style={styles.logoutTitle}>¿Cerrar sesión?</Text>
          <Text style={styles.logoutSub}>Saldrás de tu cuenta y volverás al inicio de sesión.</Text>
          <View style={styles.logoutActions}>
            <TouchableOpacity style={styles.logoutCancel} onPress={() => setShowLogout(false)}><Text style={styles.logoutCancelText}>Cancelar</Text></TouchableOpacity>
            <TouchableOpacity style={styles.logoutConfirm} onPress={handleLogout} disabled={loggingOut}>{loggingOut ? <ActivityIndicator color="#fff" /> : <Text style={styles.logoutConfirmText}>Cerrar sesión</Text>}</TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F5F7' },
  header: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderColor: '#E8EAED' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleSection: { flex: 1 },
  largeTitle: { fontSize: 26, fontWeight: '800', color: apple.colors.label, letterSpacing: -0.6 },
  syncBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F0F2F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSub: { fontSize: 12, color: apple.colors.secondaryLabel, marginTop: 1, fontWeight: '500' },
  headerStats: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F2F5', borderRadius: apple.radius.m, paddingVertical: 6, paddingHorizontal: 10, gap: 10 },
  statMiniItem: { alignItems: 'flex-start' },
  statMiniLabel: { fontSize: 9, fontWeight: '700', color: apple.colors.secondaryLabel, letterSpacing: 0.3 },
  statMiniVal: { fontSize: 12, fontWeight: '700', color: apple.colors.label },
  statMiniMuted: { fontSize: 10, fontWeight: '500', color: apple.colors.tertiaryLabel },
  visitasBarBg: { width: 50, height: 3, backgroundColor: '#E2E5EB', borderRadius: 2, overflow: 'hidden', marginTop: 3 },
  visitasBarFill: { height: '100%', backgroundColor: apple.colors.success, borderRadius: 2 },
  percentBadge: { backgroundColor: '#E2E5EB', paddingHorizontal: 4, paddingVertical: 0.5, borderRadius: 4 },
  percentText: { fontSize: 9, fontWeight: '700', color: apple.colors.secondaryLabel },
  statMiniSep: { width: 1, height: 26, backgroundColor: '#D8DCE3' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F0F2F5', borderRadius: apple.radius.m, paddingHorizontal: 12, height: 36, marginTop: 10 },
  searchInput: { flex: 1, fontSize: 14, color: apple.colors.label, paddingVertical: 0 },
  segment: { flexDirection: 'row', backgroundColor: '#F0F2F5', borderRadius: apple.radius.m, padding: 3, marginTop: 10, position: 'relative' },
  segActiveBg: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segOpt: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6, zIndex: 1 },
  segText: { fontSize: 12, fontWeight: '600', color: apple.colors.secondaryLabel },
  segTextActive: { color: apple.colors.label },
  countBadge: { backgroundColor: '#E2E5EB', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, minWidth: 20, alignItems: 'center' },
  countBadgeActive: { backgroundColor: apple.colors.label },
  countText: { fontSize: 10, fontWeight: '700', color: apple.colors.secondaryLabel },
  countTextActive: { color: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 10, color: apple.colors.secondaryLabel, fontSize: 13 },
  empty: { alignItems: 'center', padding: 40, marginTop: 12 },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: apple.colors.fill, borderWidth: 0.5, borderColor: apple.colors.separator, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 15, fontWeight: '600', color: apple.colors.label },
  emptySub: { marginTop: 4, fontSize: 13, color: apple.colors.tertiaryLabel, textAlign: 'center' },
  logoutSheet: { backgroundColor: '#fff', borderRadius: apple.radius.xl, padding: 20, paddingBottom: 24 },
  logoutHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: '#E5E5EA', alignSelf: 'center', marginBottom: 16 },
  logoutIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFEBEE', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#FFD4D4' },
  logoutTitle: { fontSize: 17, fontWeight: '700', color: '#1D1D1F', textAlign: 'center' },
  logoutSub: { fontSize: 13, color: '#8E8E93', textAlign: 'center', marginTop: 6, paddingHorizontal: 12 },
  logoutActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  logoutCancel: { flex: 1, height: 46, borderRadius: apple.radius.m, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: '#E5E5EA' },
  logoutCancelText: { fontWeight: '600', color: '#1D1D1F' },
  logoutConfirm: { flex: 1, height: 46, borderRadius: apple.radius.m, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' },
  logoutConfirmText: { fontWeight: '700', color: '#fff' },
});
