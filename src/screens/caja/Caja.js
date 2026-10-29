import { getDbConnection, getData } from '../../database/db';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  BackHandler,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
  Alert,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import Modal from 'react-native-modal';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  getCajaActual,
  abrirCaja,
  cerrarCaja,
  getMovimientosCaja,
  getHistorialCajas,
  getPendingSyncCount,
  registrarNoPagosMasivos,
} from '../../services/cajaService';
import { useAuth } from '../../context/AuthContext';
import { FormatMoneyDecimales, formatMoneyInput, parseMoneyToNumeric } from '../../utils/utilities';
import { apple } from '../../theme/appleTheme';
import { AppleButton } from '../../components/AppleButton';
import { appAlert } from '../../components/AppAlert';
import { eventBus, EVENTS } from '../../utils/eventBus';
import { clearOnlyPendingSync } from '../../utils/clearLocal';
import { SyncWithSupabase } from '../../utils/sync';

export default function CajaScreen() {
  const { profile, signOut } = useAuth();
  const navigation = useNavigation();
  const [caja, setCaja] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saldoInicial, setSaldoInicial] = useState('');
  const [tab, setTab] = useState('actual');
  const [modalNoPagos, setModalNoPagos] = useState(false);
  const [pendingClients, setPendingClients] = useState([]);
  const [selectedPendingIds, setSelectedPendingIds] = useState([]);
  const [processingNoPagos, setProcessingNoPagos] = useState(false);

  const hasLoadedOnce = useRef(false);

  const loadPendingClients = useCallback(async () => {
    try {
      const db = await getDbConnection();
      const rows = await getData(
        db,
        `SELECT id,
                CASE 
                  WHEN alias IS NOT NULL AND TRIM(alias) != '' THEN alias
                  ELSE TRIM(COALESCE(nombreUno, '') || ' ' || COALESCE(apellidoUno, ''))
                END AS name,
                nombreUno,
                apellidoUno,
                alias,
                direccion,
                COALESCE(valorCuota, valorInicial, 0) AS amount,
                saldo
         FROM facturas
         WHERE estadoMovil = 'pendiente' AND saldo > 0`
      );
      setPendingClients(rows || []);
      setSelectedPendingIds((rows || []).map(r => String(r.id)));
    } catch (e) {
      console.log('Error cargando clientes pendientes para Caja:', e);
    }
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh && !hasLoadedOnce.current) setLoading(true);
    try {
      const actual = await getCajaActual();
      setCaja(actual);
      const movs = actual ? await getMovimientosCaja(actual.id, 50, 0) : [];
      setMovimientos(movs || []);
      const hist = (await getHistorialCajas(20, 0)) || [];
      setHistorial(hist);
      await loadPendingClients();
      hasLoadedOnce.current = true;
    } catch (e) {
      console.log('Caja load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(hasLoadedOnce.current); }, [load]));

  useEffect(() => {
    const unsub1 = eventBus.on(EVENTS.CLIENT_CREATED, () => load(true));
    const unsub2 = eventBus.on(EVENTS.PAYMENT_REGISTERED, () => load(true));
    const unsub3 = eventBus.on(EVENTS.MOVEMENT_CHANGED, () => load(true));
    const unsub4 = eventBus.on(EVENTS.SYNC_COMPLETED, () => load(true));
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [load]);

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

  const onRefresh = () => { setRefreshing(true); load(true); };

  // Auditoría y protección del botón contra pérdidas destructivas de datos
  const handleClearPending = async () => {
    try {
      const pendingCount = await getPendingSyncCount();
      if (pendingCount > 0) {
        Alert.alert(
          'Atención: Operaciones pendientes',
          `Tienes ${pendingCount} registro(s) pendiente(s) de sincronizar con el servidor.\n\nSi se borran datos locales ahora, estas ventas o cobros se perderán de manera irreversible. Te recomendamos sincronizar primero.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Sincronizar ahora',
              onPress: () => {
                SyncWithSupabase(true, () => load(true));
              },
            },
            {
              text: 'Depurar sincronizados',
              style: 'destructive',
              onPress: async () => {
                await clearOnlyPendingSync();
                appAlert('Completado', 'Registros sincronizados depurados.');
                load(true);
              },
            },
          ]
        );
        return;
      }
    } catch (e) {
      console.log('Error evaluando pendientes para limpieza:', e);
    }

    Alert.alert(
      'Mantenimiento de base local',
      'No tienes operaciones financieras pendientes por subir. ¿Deseas depurar la memoria temporal de registros ya sincronizados?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Depurar memoria',
          onPress: async () => {
            await clearOnlyPendingSync();
            appAlert('Completado', 'Memoria local depurada con éxito.');
            load(true);
          },
        },
      ]
    );
  };

  const isAdmin = profile?.rol === 'admin' || profile?.rol === 'superadmin';
  const modoApertura = profile?.modo_apertura_caja || 'admin_masivo';
  const canOpenCaja = isAdmin || modoApertura === 'vendedor_dia';

  const handleAbrir = async () => {
    if (!canOpenCaja) {
      return appAlert('Acceso restringido', 'Tu organización opera bajo Modalidad A: Solo el administrador puede realizar la apertura de cajas.');
    }
    const val = parseMoneyToNumeric(saldoInicial);
    if (val < 0) return appAlert('Error', 'Saldo inicial no puede ser negativo');
    const maxCaja = Number(profile?.dinero_max_caja || 0);
    if (!isAdmin && maxCaja > 0 && val > maxCaja) {
      return appAlert(
        'Límite de caja excedido',
        `El saldo inicial ($${val.toLocaleString('es-CO')}) excede el límite asignado a tu perfil ($${maxCaja.toLocaleString('es-CO')}).`
      );
    }
    try {
      setLoading(true);
      await abrirCaja(val);
      await load(true);
      appAlert('Éxito', 'Caja abierta exitosamente.');
    } catch (e) {
      appAlert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmNoPagosMasivos = async () => {
    if (selectedPendingIds.length === 0) {
      return appAlert('Selección requerida', 'Debes seleccionar al menos un cliente para registrar no pago.');
    }

    Alert.alert(
      'Confirmar no pagos masivos',
      `¿Deseas registrar ${selectedPendingIds.length} cliente(s) como 'No pago'?\n\n• Monto registrado: $0 por cliente.\n• No altera el saldo de caja ni crea ingresos ficticios.\n• La ruta quedará completada para poder cerrar caja.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar No Pagos',
          style: 'destructive',
          onPress: async () => {
            setProcessingNoPagos(true);
            try {
              const res = await registrarNoPagosMasivos(selectedPendingIds);
              eventBus.emit(EVENTS.MOVEMENT_CHANGED);
              eventBus.emit(EVENTS.PAYMENT_REGISTERED);
              setModalNoPagos(false);
              await load(true);
              appAlert(
                'Operación exitosa',
                `Se registraron ${res.count} clientes como 'No pago'. Ya puedes cerrar la caja del día.`
              );
            } catch (err) {
              appAlert('Error', err.message || 'No se pudieron registrar los no pagos');
            } finally {
              setProcessingNoPagos(false);
            }
          },
        },
      ]
    );
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

    // Validar clientes pendientes en la ruta antes de cerrar caja
    try {
      const db = await getDbConnection();
      const pend = await getData(db, `SELECT COUNT(*) as c FROM facturas WHERE estadoMovil = 'pendiente' AND saldo > 0`);
      const pendCount = Number(pend?.[0]?.c || 0);
      if (pendCount > 0) {
        Alert.alert(
          'Ruta con clientes pendientes',
          `Aún tienes ${pendCount} cliente(s) por visitar hoy.\n\nPara cerrar la caja debes completar la ruta o registrar los no pagos masivos.`,
          [
            { text: 'Volver', style: 'cancel' },
            {
              text: 'Gestionar no pagos',
              onPress: () => {
                loadPendingClients();
                setModalNoPagos(true);
              },
            },
          ]
        );
        return;
      }
      if (false && pendCount > 0) {
        appAlert(
          'Ruta pendiente',
          `Aún tienes ${pendCount} cliente(s) por visitar hoy. Termina tu recorrido o registra los cobros antes de cerrar la caja.`
        );
        return;
      }
    } catch (e) {
      console.log('Error verificando clientes pendientes en Caja:', e);
    }

    appAlert('Cerrar caja del día', '¿Estás seguro de cerrar tu caja? Se calculará tu saldo final definitivo, se enviará el balance del día al sistema y finalizará tu jornada.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar caja',
        style: 'destructive',
        onPress: async () => {
          try {
            setLoading(true);
            await cerrarCaja(caja.id, { validateRoute: true });
            appAlert('¡Jornada finalizada!', 'Tu caja ha sido cerrada exitosamente.', [
              {
                text: 'Aceptar',
                onPress: async () => {
                  await signOut();
                },
              },
            ]);
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
    let cleanDesc = item.descripcion || 'Sin descripción';
    cleanDesc = cleanDesc.replace(/\s*\[-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\]\s*$/, '').trim();

    return (
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: color + '18' }]}>
          <Icon name={isIngreso ? 'arrow-down' : 'arrow-up'} size={13} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>
            {item.tipo.toUpperCase()} · {isIngreso ? '+' : '-'}{FormatMoneyDecimales(item.monto != null ? item.monto : item.valor)}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {cleanDesc} · {new Date(item.fecha || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  if (loading && !caja && movimientos.length === 0 && historial.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={apple.colors.blue} />
      </View>
    );
  }

  // Mostrar solo los últimos 5 movimientos
  const displayedMovs = (movimientos || []).slice(0, 5);
  const totalMovsCount = (movimientos || []).length;
  const hasMoreThan5 = totalMovsCount > 5;

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

      <TouchableOpacity
        onPress={handleClearPending}
        style={{
          marginHorizontal: 16,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: '#FF3B30',
          borderRadius: apple.radius.m,
          padding: 10,
          alignItems: 'center',
          backgroundColor: '#FFF5F5',
        }}
      >
        <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 12 }}>
          <Icon name="shield" size={12} color="#FF3B30" />  Verificar / Depurar memoria local
        </Text>
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
                {canOpenCaja ? (
                  <>
                    <Text style={[styles.emptySub, { marginBottom: 16 }]}>Ingresa el saldo inicial para iniciar jornada</Text>
                    <View style={styles.inputRow}>
                      <TextInput
                        style={styles.input}
                        value={saldoInicial}
                        onChangeText={t => setSaldoInicial(formatMoneyInput(t))}
                        keyboardType="numeric"
                        placeholder="$ 0"
                        placeholderTextColor={apple.colors.tertiaryLabel}
                      />
                      <AppleButton title="Abrir caja" onPress={handleAbrir} style={{ flex: 1 }} />
                    </View>
                  </>
                ) : (
                  <Text style={[styles.emptySub, { marginTop: 8, lineHeight: 20, maxWidth: 290, textAlign: 'center' }]}>
                    Tu caja del día se encuentra cerrada. Tu organización opera bajo Modalidad A: Solo tu administrador puede realizar la apertura de cajas.
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
                  <View style={styles.saldoBox}>
                    <Text style={styles.saldoLabel}>Inicial</Text>
                    <Text style={styles.saldoVal}>{FormatMoneyDecimales(caja.saldo_inicial)}</Text>
                  </View>
                  <View style={styles.saldoBox}>
                    <Text style={styles.saldoLabel}>Final (calc)</Text>
                    <Text style={[styles.saldoVal, { color: apple.colors.blue }]}>{FormatMoneyDecimales(caja.saldo_final || 0)}</Text>
                  </View>
                </View>
                <Text style={styles.cajaId}>ID {String(caja.id || '').slice(0, 8)}…</Text>
                {pendingClients.length > 0 && (
                  <TouchableOpacity
                    style={styles.noPagosActionBtn}
                    onPress={() => {
                      loadPendingClients();
                      setModalNoPagos(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <Icon name="users" size={13} color="#D97706" />
                    <Text style={styles.noPagosActionText}>
                      No pagos masivos ({pendingClients.length} pendientes)
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.closeBtn} onPress={handleCerrar}>
                  <Icon name="power-off" size={14} color="#fff" />
                  <Text style={styles.closeText}>  Cerrar caja</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>
                Últimos movimientos · {displayedMovs.length} de {totalMovsCount}
              </Text>
              <TouchableOpacity onPress={() => load(true)}>
                <Icon name="refresh" size={14} color={apple.colors.blue} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={displayedMovs}
              keyExtractor={i => String(i.id)}
              renderItem={Row}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={styles.emptySub}>Sin movimientos. Crea uno en Movimientos.</Text>
                </View>
              }
              ListFooterComponent={
                hasMoreThan5 ? (
                  <TouchableOpacity
                    style={styles.verTodosBtn}
                    onPress={() => navigation.navigate('Movements')}
                  >
                    <Text style={styles.verTodosText}>
                      Ver todos los movimientos ({totalMovsCount})
                    </Text>
                    <Icon name="chevron-right" size={12} color={apple.colors.blue} />
                  </TouchableOpacity>
                ) : null
              }
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          </>
        )
      ) : (
        <FlatList
          data={historial}
          keyExtractor={i => String(i.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: item.estado === 'abierta' ? apple.colors.success + '18' : apple.colors.fill }]}>
                <Icon name={item.estado === 'abierta' ? 'unlock' : 'lock'} size={13} color={item.estado === 'abierta' ? apple.colors.success : apple.colors.tertiaryLabel} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {item.estado.toUpperCase()} · {FormatMoneyDecimales(item.saldo_inicial)} → {FormatMoneyDecimales(item.saldo_final)}
                </Text>
                <Text style={styles.rowSub}>
                  {new Date(item.fecha_apertura || item.fecha || Date.now()).toLocaleDateString()}{item.fecha_cierre ? ' · ' + new Date(item.fecha_cierre).toLocaleDateString() : ''}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptySub}>Sin historial</Text>}
          contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        />
      )}
      {/* Modal No Pagos Masivos */}
      <Modal
        isVisible={modalNoPagos}
        onBackdropPress={() => !processingNoPagos && setModalNoPagos(false)}
        animationIn="slideInUp"
        animationOut="slideOutDown"
        backdropOpacity={0.4}
        style={{ margin: 0, justifyContent: 'flex-end' }}
      >
        <View style={styles.sheetNoPagos}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <View>
              <Text style={styles.sheetTitle}>No Pagos Masivos</Text>
              <Text style={styles.sheetSub}>
                Ruta pendiente ({pendingClients.length} clientes sin visitar)
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (selectedPendingIds.length === pendingClients.length) {
                  setSelectedPendingIds([]);
                } else {
                  setSelectedPendingIds(pendingClients.map(c => String(c.id)));
                }
              }}
              style={styles.toggleAllBtn}
            >
              <Text style={styles.toggleAllText}>
                {selectedPendingIds.length === pendingClients.length ? 'Desmarcar todos' : 'Marcar todos'}
              </Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={pendingClients}
            keyExtractor={item => String(item.id)}
            style={{ maxHeight: 300, marginVertical: 12 }}
            renderItem={({ item }) => {
              const isSelected = selectedPendingIds.includes(String(item.id));
              const clientLabel = item.name || `${item.nombreUno || ''} ${item.apellidoUno || ''}`.trim() || 'Cliente';
              return (
                <TouchableOpacity
                  style={[styles.clientCheckRow, isSelected && styles.clientCheckRowSelected]}
                  onPress={() => {
                    const sid = String(item.id);
                    if (isSelected) {
                      setSelectedPendingIds(prev => prev.filter(x => x !== sid));
                    } else {
                      setSelectedPendingIds(prev => [...prev, sid]);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
                    {isSelected && <Icon name="check" size={12} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientCheckName} numberOfLines={1}>{clientLabel}</Text>
                    <Text style={styles.clientCheckSub} numberOfLines={1}>
                      Saldo: {FormatMoneyDecimales(item.saldo)} • Cuota: {FormatMoneyDecimales(item.amount)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptySub}>No hay clientes pendientes en la ruta.</Text>
            }
          />

          <View style={styles.noPagosNoticeBox}>
            <Icon name="info-circle" size={13} color={apple.colors.secondaryLabel} />
            <Text style={styles.noPagosNoticeText}>
              Se registrarán {selectedPendingIds.length} cliente(s) como 'No pago' ($0). No afecta el saldo de caja ni genera ingresos ficticios.
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <TouchableOpacity
              style={[styles.modalSheetBtn, { backgroundColor: apple.colors.fill }]}
              onPress={() => setModalNoPagos(false)}
              disabled={processingNoPagos}
            >
              <Text style={{ fontWeight: '600', color: apple.colors.label }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSheetBtn, { backgroundColor: '#D97706' }]}
              onPress={handleConfirmNoPagosMasivos}
              disabled={processingNoPagos || selectedPendingIds.length === 0}
            >
              {processingNoPagos ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontWeight: '700', color: '#fff' }}>
                  Confirmar ({selectedPendingIds.length})
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  verTodosBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: apple.radius.m,
    borderWidth: 1,
    borderColor: '#E8EAED',
    gap: 6,
  },
  verTodosText: {
    fontSize: 13,
    fontWeight: '700',
    color: apple.colors.blue,
  },
  noPagosActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: apple.radius.s,
    height: 42,
    marginTop: 10,
  },
  noPagosActionText: {
    color: '#92400E',
    fontWeight: '700',
    fontSize: 13,
  },
  sheetNoPagos: {
    backgroundColor: apple.colors.card,
    borderTopLeftRadius: apple.radius.xl,
    borderTopRightRadius: apple.radius.xl,
    padding: 20,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: apple.colors.separator,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: apple.colors.label,
  },
  sheetSub: {
    fontSize: 12,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  toggleAllBtn: {
    backgroundColor: apple.colors.fill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: apple.radius.m,
  },
  toggleAllText: {
    fontSize: 11,
    fontWeight: '600',
    color: apple.colors.blue,
  },
  clientCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: apple.radius.m,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    marginBottom: 6,
    backgroundColor: apple.colors.card,
  },
  clientCheckRowSelected: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: apple.colors.tertiaryLabel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    borderColor: '#D97706',
    backgroundColor: '#D97706',
  },
  clientCheckName: {
    fontSize: 14,
    fontWeight: '700',
    color: apple.colors.label,
  },
  clientCheckSub: {
    fontSize: 11,
    color: apple.colors.secondaryLabel,
    marginTop: 1,
  },
  noPagosNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: apple.colors.fill,
    padding: 10,
    borderRadius: apple.radius.m,
    marginTop: 4,
  },
  noPagosNoticeText: {
    flex: 1,
    fontSize: 11,
    color: apple.colors.secondaryLabel,
    lineHeight: 15,
  },
  modalSheetBtn: {
    flex: 1,
    height: 46,
    borderRadius: apple.radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
