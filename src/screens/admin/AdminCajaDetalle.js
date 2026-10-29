// src/screens/admin/AdminCajaDetalle.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../theme/appleTheme';
import { appAlert } from '../../components/AppAlert';
import {
  getCajaMovements,
  createAdminCajaMovement,
  getSubordinateOpenCajas,
  reabrirCajaAdmin,
} from '../../services/adminService';
import { formatMoneyInput, parseMoneyToNumeric } from '../../utils/utilities';
import { eventBus, EVENTS } from '../../utils/eventBus';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

const formatDate = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function AdminCajaDetalle() {
  const route = useRoute();
  const navigation = useNavigation();
  const { caja } = route.params || {};
  const [cajaState, setCajaState] = useState(caja || {});
  const [reopening, setReopening] = useState(false);

  const [movements, setMovements] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal nuevo movimiento
  const [modalVisible, setModalVisible] = useState(false);
  const [movTipo, setMovTipo] = useState('gasto');
  const [movDesc, setMovDesc] = useState('');
  const [movMonto, setMovMonto] = useState('');
  const [savingMov, setSavingMov] = useState(false);
  const [closing, setClosing] = useState(false);

  // Subordinados abiertos (Requisito 7)
  const [subModalVisible, setSubModalVisible] = useState(false);
  const [openSubordinates, setOpenSubordinates] = useState([]);
  const [checkingSubs, setCheckingSubs] = useState(false);

  const isOpen = cajaState?.estado === 'abierta';
  const isAdmin = cajaState?.rol_usuario === 'admin' || cajaState?.rol_usuario === 'superadmin';

  // Tipos de movimiento según rol de la caja (Requisito 6)
  const types = useMemo(() => {
    if (isAdmin) {
      return [
        { key: 'todos', label: 'Todos' },
        { key: 'ingreso', label: 'Ingresos' },
        { key: 'retiro', label: 'Retiros' },
        { key: 'gasto', label: 'Gastos' },
      ];
    }
    return [
      { key: 'todos', label: 'Todos' },
      { key: 'pago', label: 'Pagos' },
      { key: 'venta', label: 'Ventas' },
      { key: 'gasto', label: 'Gastos' },
      { key: 'ingreso', label: 'Ingresos' },
      { key: 'retiro', label: 'Retiros' },
    ];
  }, [isAdmin]);

  const loadData = useCallback(async () => {
    if (!caja?.caja_id && !caja?.id) return;
    const cajaId = caja.caja_id || caja.id;
    try {
      const data = await getCajaMovements(cajaId);
      setMovements(data || []);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar los movimientos');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [caja]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let list = movements;
    if (selectedType !== 'todos') {
      if (selectedType === 'gasto') {
        list = list.filter((m) => m.tipo === 'retiro' && m.descripcion?.toLowerCase().includes('gasto'));
      } else {
        list = list.filter((m) => m.tipo === selectedType);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.descripcion?.toLowerCase().includes(q));
    }
    setFiltered(list);
  }, [search, selectedType, movements]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Requisito 7: Comprobar cajas de subordinados antes de cerrar caja de admin
  const handleCerrarCaja = async () => {
    const cajaId = caja.caja_id || caja.id;
    const targetUserId = caja.usuario_id;

    if (isAdmin) {
      setCheckingSubs(true);
      try {
        const subs = await getSubordinateOpenCajas(targetUserId);
        if (subs && subs.length > 0) {
          setOpenSubordinates(subs);
          setSubModalVisible(true);
          return;
        }
      } catch (e) {
        console.log('Error comprobando subordinados:', e);
      } finally {
        setCheckingSubs(false);
      }
    }

    promptConfirmClose(cajaId);
  };

  const promptConfirmClose = (cajaId) => {
    appAlert(
      'Cerrar caja',
      `¿Deseas cerrar la caja de ${caja.nombre_usuario || 'este usuario'}? Se validará en el servidor y se calculará el saldo final definitivo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar caja',
          style: 'destructive',
          onPress: () => executeClose(cajaId),
        },
      ]
    );
  };

  const executeClose = async (cajaId) => {
    setClosing(true);
    try {
      const { cerrarCaja } = require('../../services/cajaService');
      const res = await cerrarCaja(cajaId);
      setCajaState(prev => ({
        ...prev,
        estado: 'cerrada',
        fecha_cierre: res?.fecha_cierre || new Date().toISOString(),
        saldo_final: res?.saldo_final != null ? res.saldo_final : prev.saldo_final,
      }));
      setSubModalVisible(false);
      try {
        eventBus.emit(EVENTS.MOVEMENT_CHANGED);
      } catch {}
      route.params?.onRefreshParent?.();
      appAlert('¡Caja cerrada!', 'La caja se cerró exitosamente en el sistema.');
    } catch (err) {
      appAlert('No se pudo cerrar', err.message);
    } finally {
      setClosing(false);
    }
  };

  const handleReabrirCaja = () => {
    const cajaId = cajaState?.caja_id || cajaState?.id;
    if (!cajaId) return;

    appAlert(
      'Reabrir caja',
      `¿Deseas reabrir la caja de ${cajaState?.nombre_usuario || 'este vendedor'}?\n\nLa caja volverá al estado 'abierta', permitiendo registrar cobros y movimientos pendientes.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reabrir Caja',
          onPress: async () => {
            setReopening(true);
            try {
              await reabrirCajaAdmin(cajaId);
              setCajaState(prev => ({
                ...prev,
                estado: 'abierta',
                fecha_cierre: null,
                saldo_final: null,
              }));
              try {
                eventBus.emit(EVENTS.MOVEMENT_CHANGED);
              } catch {}
              route.params?.onRefreshParent?.();
              appAlert('¡Caja reabierta!', 'La caja se encuentra abierta nuevamente en el sistema.');
              loadData();
            } catch (err) {
              appAlert('No se pudo reabrir', err.message);
            } finally {
              setReopening(false);
            }
          },
        },
      ]
    );
  };

  const handleCreateMovement = async () => {
    const montoNum = parseMoneyToNumeric(movMonto);
    if (!movDesc.trim() || !montoNum || montoNum <= 0) {
      appAlert('Campos requeridos', 'Por favor ingresa descripción y un monto válido');
      return;
    }
    const cajaId = caja.caja_id || caja.id;
    setSavingMov(true);
    try {
      await createAdminCajaMovement({
        cajaId,
        tipo: movTipo === 'gasto' ? 'retiro' : movTipo,
        descripcion: movTipo === 'gasto' ? `[Gasto] ${movDesc.trim()}` : movDesc.trim(),
        monto: montoNum,
      });
      setModalVisible(false);
      setMovDesc('');
      setMovMonto('');
      appAlert('Éxito', 'Movimiento registrado');
      loadData();
    } catch (err) {
      appAlert('Error', err.message);
    } finally {
      setSavingMov(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={16} color={apple.colors.blue} />
          <Text style={styles.backText}>Cajas</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {cajaState?.nombre_usuario}
          </Text>
          <Text style={styles.headerSubtitle}>
            {isOpen ? '🟢 Caja Abierta' : '🔴 Caja Cerrada'} · {cajaState?.rol_usuario?.toUpperCase()}
          </Text>
        </View>

        {isOpen && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              style={styles.btnCloseCaja}
              onPress={handleCerrarCaja}
              disabled={closing || checkingSubs}
            >
              <Icon name="power-off" size={12} color="#FFFFFF" />
              <Text style={styles.btnCloseCajaText}>
                {closing ? '...' : checkingSubs ? 'Verificando...' : 'Cerrar'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnNewMov} onPress={() => setModalVisible(true)}>
              <Icon name="plus" size={12} color="#FFFFFF" />
              <Text style={styles.btnNewMovText}>Movimiento</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Resumen Superior Adaptado al Rol (Requisito 6) */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Saldo Inicial</Text>
          <Text style={styles.summaryVal}>{formatMoney(cajaState?.saldo_inicial)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>{isOpen ? 'Saldo Actual' : 'Saldo Final'}</Text>
          <Text style={[styles.summaryVal, { color: apple.colors.blue }]}>
            {formatMoney(cajaState?.saldo_final)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>{isAdmin ? 'Ingresos' : 'Recaudado'}</Text>
          <Text style={[styles.summaryVal, { color: apple.colors.success }]}>
            {formatMoney(isAdmin ? cajaState?.valor_ingresos : cajaState?.valor_recaudado)}
          </Text>
        </View>
      </View>

      {/* Banner Informativo Caja Cerrada / Opción de Reapertura */}
      {!isOpen && (
        <View style={styles.reopenBanner}>
          <View style={styles.reopenBannerLeft}>
            <View style={styles.reopenIconCircle}>
              <Icon name="lock" size={14} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reopenBannerTitle}>Caja Cerrada / Finalizada</Text>
              <Text style={styles.reopenBannerSub}>
                Como administrador puedes reabrir esta caja si el vendedor necesita registrar pagos o cobros pendientes del día.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.reopenBannerBtn}
            onPress={handleReabrirCaja}
            disabled={reopening}
          >
            {reopening ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Icon name="unlock" size={13} color="#FFFFFF" />
                <Text style={styles.reopenBannerBtnText}>Reabrir esta Caja</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={apple.colors.tertiaryLabel} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar movimiento..."
          placeholderTextColor={apple.colors.tertiaryLabel}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Icon name="times-circle" size={14} color={apple.colors.tertiaryLabel} />
          </TouchableOpacity>
        )}
      </View>

      {/* Pills de Tipos */}
      <View style={styles.pillsScroll}>
        {types.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.pill, selectedType === t.key && styles.pillActive]}
            onPress={() => setSelectedType(t.key)}
          >
            <Text style={[styles.pillText, selectedType === t.key && styles.pillTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Lista de Movimientos */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={apple.colors.blue} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            const isPositive = item.tipo === 'ingreso' || item.tipo === 'pago';
            const isGasto = item.tipo === 'retiro' && item.descripcion?.toLowerCase().includes('gasto');
            return (
              <View style={styles.movCard}>
                <View style={styles.movIconWrap}>
                  <Icon
                    name={
                      item.tipo === 'pago'
                        ? 'money'
                        : item.tipo === 'venta'
                        ? 'shopping-bag'
                        : isGasto
                        ? 'tag'
                        : item.tipo === 'ingreso'
                        ? 'arrow-down'
                        : 'arrow-up'
                    }
                    size={15}
                    color={isPositive ? apple.colors.success : apple.colors.danger}
                  />
                </View>
                <View style={{ flex: 1, marginHorizontal: 10 }}>
                  <Text style={styles.movDesc} numberOfLines={2}>
                    {item.descripcion || item.tipo?.toUpperCase()}
                  </Text>
                  <Text style={styles.movTime}>{formatDate(item.fecha || item.created_at)}</Text>
                </View>
                <Text style={[styles.movAmount, { color: isPositive ? apple.colors.success : apple.colors.danger }]}>
                  {isPositive ? '+' : '-'}{formatMoney(item.monto)}
                </Text>
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="list" size={40} color={apple.colors.tertiaryLabel} />
              <Text style={styles.emptyTitle}>Sin movimientos</Text>
              <Text style={styles.emptySubtitle}>No se encontraron registros para este filtro</Text>
            </View>
          }
        />
      )}

      {/* MODAL NUEVO MOVIMIENTO */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuevo Movimiento</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Icon name="times" size={18} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            <View style={styles.movTypeSelector}>
              <TouchableOpacity
                style={[styles.movTypeBtn, movTipo === 'ingreso' && styles.movTypeBtnActive]}
                onPress={() => setMovTipo('ingreso')}
              >
                <Text style={[styles.movTypeText, movTipo === 'ingreso' && styles.movTypeTextActive]}>Ingreso</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.movTypeBtn, movTipo === 'retiro' && styles.movTypeBtnActive]}
                onPress={() => setMovTipo('retiro')}
              >
                <Text style={[styles.movTypeText, movTipo === 'retiro' && styles.movTypeTextActive]}>Retiro</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.movTypeBtn, movTipo === 'gasto' && styles.movTypeBtnActive]}
                onPress={() => setMovTipo('gasto')}
              >
                <Text style={[styles.movTypeText, movTipo === 'gasto' && styles.movTypeTextActive]}>Gasto</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Descripción *</Text>
              <TextInput
                style={styles.input}
                value={movDesc}
                onChangeText={setMovDesc}
                placeholder="Ej. Consignación, transporte, combustible"
                placeholderTextColor={apple.colors.tertiaryLabel}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Monto *</Text>
              <TextInput
                style={styles.input}
                value={movMonto}
                onChangeText={(t) => setMovMonto(formatMoneyInput(t))}
                placeholder="$ 0"
                placeholderTextColor={apple.colors.tertiaryLabel}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnConfirm} onPress={handleCreateMovement} disabled={savingMov}>
                <Text style={styles.modalBtnConfirmText}>{savingMov ? 'Guardando...' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL ADVERTENCIA SUBORDINADOS CON CAJA ABIERTA (Requisito 7) */}
      <Modal visible={subModalVisible} transparent animationType="fade" onRequestClose={() => setSubModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <View style={styles.subModalHeader}>
              <View style={styles.subWarnIconWrap}>
                <Icon name="exclamation-triangle" size={24} color="#D97706" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.subModalTitle}>Vendedores con caja abierta</Text>
                <Text style={styles.subModalBadge}>{openSubordinates.length} caja(s) pendientes</Text>
              </View>
              <TouchableOpacity onPress={() => setSubModalVisible(false)}>
                <Icon name="times" size={18} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            <Text style={styles.subModalExplain}>
              Tienes vendedores subordinados que aún tienen su caja del día abierta. Para garantizar que los recaudos y gastos de la ruta se consoliden correctamente en el balance contable, tus vendedores deben cerrar primero sus cajas antes de finalizar la caja de administración.
            </Text>

            <Text style={styles.subListHeader}>Cajas de subordinados aún abiertas:</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              {openSubordinates.map((sub, idx) => (
                <View key={idx} style={styles.subCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subVendorName}>{sub.nombre_usuario}</Text>
                    <Text style={styles.subDetails}>
                      Apertura: {new Date(sub.fecha_apertura).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={styles.subSaldo}>
                      Saldo actual: <Text style={{ color: apple.colors.blue, fontWeight: '700' }}>{formatMoney(sub.saldo_final)}</Text>
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.subInspectBtn}
                    onPress={() => {
                      setSubModalVisible(false);
                      navigation.push('AdminCajaDetalle', { caja: sub });
                    }}
                  >
                    <Text style={styles.subInspectBtnText}>Ver caja</Text>
                    <Icon name="chevron-right" size={10} color={apple.colors.blue} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setSubModalVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnConfirm, { backgroundColor: apple.colors.danger }]}
                onPress={() => executeClose(caja.caja_id || caja.id)}
                disabled={closing}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {closing ? 'Cerrando...' : 'Intentar cierre'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: apple.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.m,
    paddingBottom: apple.spacing.s,
    backgroundColor: apple.colors.card,
    borderBottomWidth: 0.5,
    borderBottomColor: apple.colors.separator,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 8,
  },
  backText: {
    fontSize: 15,
    color: apple.colors.blue,
    marginLeft: 4,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: apple.colors.label,
  },
  headerSubtitle: {
    fontSize: 11,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  btnCloseCaja: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.danger,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: apple.radius.s,
    gap: 5,
  },
  btnCloseCajaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnNewMov: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.blue,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: apple.radius.s,
    gap: 5,
  },
  btnNewMovText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: apple.colors.card,
    paddingHorizontal: apple.spacing.l,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: apple.colors.separator,
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 0.5,
    backgroundColor: apple.colors.separator,
    marginVertical: 4,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  summaryVal: {
    fontSize: 14,
    fontWeight: '800',
    color: apple.colors.label,
    marginTop: 3,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.s,
    marginHorizontal: apple.spacing.l,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: apple.colors.label,
  },
  pillsScroll: {
    flexDirection: 'row',
    paddingHorizontal: apple.spacing.l,
    paddingVertical: 6,
    gap: 6,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: apple.radius.m,
    backgroundColor: apple.colors.card,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  pillActive: {
    backgroundColor: apple.colors.blue,
    borderColor: apple.colors.blue,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: apple.spacing.l,
    paddingTop: 8,
    paddingBottom: apple.spacing.xl,
  },
  movCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.s,
    padding: 12,
    marginBottom: 8,
    ...apple.shadow.subtle,
    ...apple.border.card,
  },
  movIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: apple.colors.bgGrouped,
    justifyContent: 'center',
    alignItems: 'center',
  },
  movDesc: {
    fontSize: 13,
    fontWeight: '600',
    color: apple.colors.label,
  },
  movTime: {
    fontSize: 11,
    color: apple.colors.tertiaryLabel,
    marginTop: 2,
  },
  movAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: apple.colors.secondaryLabel,
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: 12,
    color: apple.colors.tertiaryLabel,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: apple.spacing.l,
  },
  modalCard: {
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.m,
    padding: apple.spacing.l,
    ...apple.shadow.elevated,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: apple.colors.label,
  },
  movTypeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  movTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: apple.radius.s,
    backgroundColor: apple.colors.bgGrouped,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  movTypeBtnActive: {
    backgroundColor: apple.colors.blue,
    borderColor: apple.colors.blue,
  },
  movTypeText: {
    fontSize: 12,
    fontWeight: '700',
    color: apple.colors.secondaryLabel,
  },
  movTypeTextActive: {
    color: '#FFFFFF',
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: apple.colors.label,
    marginBottom: 4,
  },
  input: {
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.s,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: apple.colors.label,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: apple.radius.s,
    backgroundColor: apple.colors.bgGrouped,
    alignItems: 'center',
  },
  modalBtnCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  modalBtnConfirm: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: apple.radius.s,
    backgroundColor: apple.colors.blue,
    alignItems: 'center',
  },
  modalBtnConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Estilos modal subordinados
  subModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  subWarnIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: apple.colors.label,
  },
  subModalBadge: {
    fontSize: 12,
    color: '#D97706',
    fontWeight: '600',
  },
  subModalExplain: {
    fontSize: 13,
    color: apple.colors.secondaryLabel,
    lineHeight: 18,
    marginBottom: 12,
  },
  subListHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: apple.colors.label,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.s,
    padding: 10,
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  subVendorName: {
    fontSize: 14,
    fontWeight: '700',
    color: apple.colors.label,
  },
  subDetails: {
    fontSize: 11,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  subSaldo: {
    fontSize: 12,
    color: apple.colors.label,
    marginTop: 2,
  },
  subInspectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EBF3FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: apple.radius.s,
  },
  subInspectBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: apple.colors.blue,
  },
  btnReopenCaja: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: apple.radius.s,
    gap: 5,
  },
  btnReopenCajaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reopenBanner: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: apple.radius.m,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    padding: 12,
  },
  reopenBannerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  reopenIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  reopenBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  reopenBannerSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 15,
  },
  reopenBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D97706',
    borderRadius: apple.radius.s,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 10,
    gap: 6,
    alignSelf: 'flex-end',
  },
  reopenBannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});