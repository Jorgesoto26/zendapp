// src/screens/admin/AdminCajaDetalle.js
import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../theme/appleTheme';
import { appAlert } from '../../components/AppAlert';
import { getCajaMovements, createAdminCajaMovement } from '../../services/adminService';
import { formatMoneyInput, parseMoneyToNumeric } from '../../utils/utilities';

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

  const handleCerrarCaja = () => {
    const cajaId = caja.caja_id || caja.id;
    appAlert(
      'Cerrar caja',
      `¿Deseas cerrar la caja de ${caja.nombre_usuario || 'este usuario'}? Se validará en el servidor y se calculará el saldo final definitivo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar caja',
          style: 'destructive',
          onPress: async () => {
            setClosing(true);
            try {
              const { cerrarCaja } = require('../../services/cajaService');
              await cerrarCaja(cajaId);
              appAlert('¡Caja cerrada!', 'La caja se cerró exitosamente en el sistema.', [
                {
                  text: 'OK',
                  onPress: () => navigation.goBack(),
                },
              ]);
            } catch (err) {
              appAlert('No se pudo cerrar', err.message);
            } finally {
              setClosing(false);
            }
          },
        },
      ]
    );
  };

  const isOpen = caja?.estado === 'abierta';

  const loadData = useCallback(async () => {
    if (!caja?.caja_id && !caja?.id) return;
    const cajaId = caja.caja_id || caja.id;
    try {
      const data = await getCajaMovements(cajaId);
      setMovements(data);
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

  const types = [
    { key: 'todos', label: 'Todos' },
    { key: 'pago', label: 'Pagos' },
    { key: 'venta', label: 'Ventas' },
    { key: 'gasto', label: 'Gastos' },
    { key: 'ingreso', label: 'Ingresos' },
    { key: 'retiro', label: 'Retiros' },
  ];

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
            {caja?.nombre_usuario}
          </Text>
          <Text style={styles.headerSubtitle}>
            {isOpen ? '🟢 Caja Abierta' : '🔴 Caja Cerrada'}
          </Text>
        </View>

        {isOpen && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              style={styles.btnCloseCaja}
              onPress={handleCerrarCaja}
              disabled={closing}
            >
              <Icon name="power-off" size={12} color="#FFFFFF" />
              <Text style={styles.btnCloseCajaText}>{closing ? '...' : 'Cerrar'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnNewMov} onPress={() => setModalVisible(true)}>
              <Icon name="plus" size={12} color="#FFFFFF" />
              <Text style={styles.btnNewMovText}>Movimiento</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Resumen Superior */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Saldo Inicial</Text>
          <Text style={styles.summaryVal}>{formatMoney(caja?.saldo_inicial)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Saldo Actual</Text>
          <Text style={[styles.summaryVal, { color: apple.colors.blue }]}>
            {formatMoney(caja?.saldo_final)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Recaudado</Text>
          <Text style={[styles.summaryVal, { color: apple.colors.success }]}>
            {formatMoney(caja?.valor_recaudado)}
          </Text>
        </View>
      </View>

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
          keyExtractor={(item) => item.id}
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
              <Text style={styles.emptySubtitle}>No hay registros para este filtro</Text>
            </View>
          }
        />
      )}

      {/* Modal Nuevo Movimiento */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Registrar Movimiento</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Icon name="times" size={16} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            {/* Selector Tipo */}
            <View style={styles.movTypeSelector}>
              {['gasto', 'ingreso', 'retiro'].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.movTypeBtn, movTipo === t && styles.movTypeBtnActive]}
                  onPress={() => setMovTipo(t)}
                >
                  <Text style={[styles.movTypeText, movTipo === t && styles.movTypeTextActive]}>
                    {t.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Descripción</Text>
              <TextInput
                style={styles.input}
                value={movDesc}
                onChangeText={setMovDesc}
                placeholder="Ej. Gasolina ruta norte"
                placeholderTextColor={apple.colors.tertiaryLabel}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Monto ($)</Text>
              <TextInput
                style={styles.input}
                value={movMonto}
                onChangeText={t => setMovMonto(formatMoneyInput(t))}
                keyboardType="numeric"
                placeholder="$ 0"
                placeholderTextColor={apple.colors.tertiaryLabel}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnConfirm, savingMov && { opacity: 0.6 }]}
                onPress={handleCreateMovement}
                disabled={savingMov}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {savingMov ? 'Guardando...' : 'Guardar'}
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
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 6,
  },
  backText: {
    fontSize: 16,
    color: apple.colors.blue,
    marginLeft: 4,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: apple.colors.label,
  },
  headerSubtitle: {
    fontSize: 12,
    color: apple.colors.secondaryLabel,
  },
  btnCloseCaja: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.danger,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: apple.radius.s,
    gap: 4,
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
    paddingVertical: 6,
    borderRadius: apple.radius.s,
    gap: 4,
  },
  btnNewMovText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.m,
    marginHorizontal: apple.spacing.l,
    marginVertical: apple.spacing.s,
    padding: apple.spacing.m,
    ...apple.shadow.subtle,
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 0.5,
    backgroundColor: apple.colors.separator,
  },
  summaryLabel: {
    fontSize: 10,
    color: apple.colors.secondaryLabel,
    marginBottom: 2,
  },
  summaryVal: {
    fontSize: 13,
    fontWeight: '800',
    color: apple.colors.label,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.s,
    marginHorizontal: apple.spacing.l,
    marginVertical: 6,
    paddingHorizontal: 12,
    height: 38,
    ...apple.shadow.subtle,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: apple.colors.label,
  },
  pillsScroll: {
    flexDirection: 'row',
    paddingHorizontal: apple.spacing.l,
    marginVertical: 6,
    gap: 6,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: apple.radius.pill,
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
    marginTop: 8,
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
});
