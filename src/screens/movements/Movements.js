import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BackHandler,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Modal,
  ScrollView,
  RefreshControl,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getCajaActual } from '../../services/cajaService';
import {
  createCashMovement,
  updateCashMovement,
  listMovimientos,
  getCurrentLocationOrNull,
} from '../../services/movementsService';
import { FormatMoneyDecimales, formatMoneyInput, parseMoneyToNumeric, Capitalize } from '../../utils/utilities';
import { apple } from '../../theme/appleTheme';
import { appAlert } from '../../components/AppAlert';
import { useAuth } from '../../context/AuthContext';
import { eventBus, EVENTS } from '../../utils/eventBus';
import { getDbConnection, getData } from '../../database/db';
import { supabase } from '../../lib/supabase';
import Toast from 'react-native-toast-message';

export default function MovementsScreen() {
  const navigation = useNavigation();
  const { profile, userId } = useAuth();

  const [caja, setCaja] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState('todos');

  // Modal Nuevo Movimiento
  const [modalVisible, setModalVisible] = useState(false);
  const [formTipo, setFormTipo] = useState('ingreso');
  const [formDesc, setFormDesc] = useState('');
  const [formMonto, setFormMonto] = useState('');
  const [saving, setSaving] = useState(false);

  // Modal Edición Movimiento
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [editDesc, setEditDesc] = useState('');
  const [editMonto, setEditMonto] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Permisos de administrador asignados al perfil del usuario
  const permiteBorrarVenta = !!profile?.permite_borrar_venta;
  const permiteModificarPagos = !!profile?.permite_modificar_pagos;

  const hasLoadedOnce = useRef(false);

  const load = useCallback(async (isRefresh = false) => {
    // Si ya cargó al menos una vez, no bloquear la UI con spinner grande
    if (!isRefresh && !hasLoadedOnce.current) {
      setLoading(true);
    }
    try {
      const actual = await getCajaActual();
      setCaja(actual);
      const movs = await listMovimientos({ cajaId: actual?.id || null, limit: 50, offset: 0, search: search.trim() });
      setItems(movs || []);
      hasLoadedOnce.current = true;
    } catch (e) {
      console.log('Movements load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  useFocusEffect(
    useCallback(() => {
      load(hasLoadedOnce.current);
    }, [load])
  );

  // Escuchar eventos en tiempo real
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
        navigation.navigate('Payments');
        return true;
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

  const handleSearch = async () => {
    try {
      setLoading(true);
      const data = await listMovimientos({ cajaId: caja?.id || null, limit: 50, offset: 0, search });
      setItems(data || []);
    } catch (e) {
      console.log('Movements search error:', e);
    } finally {
      setLoading(false);
    }
  };

  // Creación limpia: coordenadas en latitud/longitud sin ensuciar la descripción
  const handleCreate = async () => {
    const monto = parseMoneyToNumeric(formMonto);
    if (!monto || monto <= 0) return appAlert('Error', 'Monto inválido');
    if (!formDesc.trim()) return appAlert('Error', 'Descripción requerida');
    if (!caja) return appAlert('Error', 'Debes tener una caja abierta');

    // Validar límite de gasto / retiro
    const maxGasto = parseFloat(profile?.dinero_max_gasto) || 0;
    if (formTipo === 'retiro' && maxGasto > 0 && monto > maxGasto) {
      return appAlert(
        'Límite de gasto excedido',
        `El monto ($${monto.toLocaleString('es-CO')}) excede tu límite máximo permitido por gasto ($${maxGasto.toLocaleString('es-CO')}).`
      );
    }
    setSaving(true);
    try {
      const loc = await getCurrentLocationOrNull();
      await createCashMovement({
        cajaId: caja.id,
        tipo: formTipo,
        descripcion: formDesc.trim(),
        monto,
        latitud: loc?.lat ?? null,
        longitud: loc?.lng ?? null,
      });

      setModalVisible(false);
      setFormDesc('');
      setFormMonto('');
      setFormTipo('ingreso');

      eventBus.emit(EVENTS.MOVEMENT_CHANGED);
      await load(true);
      Toast.show({
        text1: 'Movimiento registrado',
        text2: `${Capitalize(formTipo)} guardado exitosamente.`,
      });
    } catch (e) {
      appAlert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  // Abrir modal de edición
  const handleOpenEdit = (item) => {
    let cleanDesc = item.descripcion || '';
    cleanDesc = cleanDesc.replace(/\s*\[-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\]\s*$/, '').trim();
    setEditingItem(item);
    setEditDesc(cleanDesc);
    const currMonto = item.monto != null ? item.monto : item.valor;
    setEditMonto(formatMoneyInput(String(currMonto || '')));
    setEditModalVisible(true);
  };

  // Guardar edición offline/online respetando permisos y límites
  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const monto = parseMoneyToNumeric(editMonto);
    if (!monto || monto <= 0) return appAlert('Error', 'Monto inválido');
    if (!editDesc.trim()) return appAlert('Error', 'Descripción requerida');

    setSavingEdit(true);
    try {
      await updateCashMovement({
        id: editingItem.id,
        tipo: editingItem.tipo,
        descripcion: editDesc.trim(),
        monto,
        cajaId: caja?.id,
        profile,
      });

      setEditModalVisible(false);
      setEditingItem(null);
      setEditDesc('');
      setEditMonto('');

      eventBus.emit(EVENTS.MOVEMENT_CHANGED);
      await load(true);
      Toast.show({
        text1: 'Movimiento actualizado',
        text2: 'Cambios guardados correctamente.',
      });
    } catch (e) {
      appAlert('No se pudo actualizar', e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // Reversión / Anulación de Venta según permisos
  const handleDeleteVenta = async (item) => {
    if (!permiteBorrarVenta) {
      return appAlert('Permiso denegado', 'No tienes autorización para eliminar o anular ventas.');
    }

    Alert.alert(
      'Anular Venta',
      `¿Estás seguro de anular esta venta de ${FormatMoneyDecimales(item.monto)}?\n\nSe cancelará el crédito asociado y se reintegrará el dinero a la caja.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Anular Venta',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDbConnection();
              const monto = Number(item.monto || 0);

              let idFactura = item.idFactura || null;
              if (!idFactura && item.descripcion) {
                const match = item.descripcion.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                if (match) idFactura = match[0];
              }

              if (idFactura) {
                const pagos = await getData(db, `SELECT COUNT(*) as c FROM pagos WHERE idFactura = ?`, [idFactura]);
                if (pagos?.[0]?.c > 0) {
                  return appAlert('Operación rechazada', 'Esta venta ya tiene pagos o abonos registrados. No puede ser anulada.');
                }
              }

              if (caja?.id && monto > 0) {
                await db.executeSql(
                  `UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) + ? WHERE id = ?`,
                  [monto, caja.id]
                );
              }

              if (idFactura) {
                await db.executeSql(`UPDATE facturas SET estado = 'cancel', saldo = 0 WHERE id = ?`, [idFactura]);
              }

              await db.executeSql(`DELETE FROM movimientos WHERE id = ?`, [item.id]);

              if (idFactura) {
                await db.executeSql(`DELETE FROM ventas_pendientes WHERE temp_id = ?`, [idFactura]);
              }

              if (idFactura && !String(idFactura).startsWith('-')) {
                try {
                  await supabase.from('invoice').update({ status: 'cancel', saldo: 0 }).eq('id', idFactura);
                  if (caja?.id) {
                    await supabase.rpc('rpc_create_cash_movement', {
                      p_caja_id: caja.id,
                      p_tipo: 'ingreso',
                      p_descripcion: `Reversión anulación venta #${idFactura.slice(0, 8)}`,
                      p_monto: monto,
                    });
                  }
                } catch (eRemote) {
                  console.log('Error sincronizando anulación venta con Supabase:', eRemote);
                }
              }

              eventBus.emit(EVENTS.MOVEMENT_CHANGED);
              await load(true);
              Toast.show({
                text1: 'Venta anulada',
                text2: `Se reversaron ${FormatMoneyDecimales(monto)} a tu caja.`,
              });
            } catch (err) {
              console.log('Error anulando venta:', err);
              appAlert('Error', 'No se pudo anular la venta.');
            }
          },
        },
      ]
    );
  };

  // Reversión de Pago según permisos
  const handleRevertPago = async (item) => {
    if (!permiteModificarPagos) {
      return appAlert('Permiso denegado', 'No tienes autorización para modificar o revertir pagos.');
    }

    Alert.alert(
      'Revertir Pago',
      `¿Deseas revertir este pago de ${FormatMoneyDecimales(item.monto)}?\n\nEl valor se volverá a sumar a la deuda del cliente y se restará del saldo de tu caja.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Revertir Pago',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDbConnection();
              const monto = Number(item.monto || 0);

              let idFactura = item.idFactura || null;
              if (!idFactura && item.descripcion) {
                const match = item.descripcion.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                if (match) idFactura = match[0];
              }

              if (caja?.id && monto > 0) {
                await db.executeSql(
                  `UPDATE cajas SET saldo_final = COALESCE(saldo_final, saldo_inicial, 0) - ? WHERE id = ?`,
                  [monto, caja.id]
                );
              }

              if (idFactura) {
                await db.executeSql(
                  `UPDATE facturas SET saldo = saldo + ?, cuotasPagas = MAX(0, cuotasPagas - 1) WHERE id = ?`,
                  [monto, idFactura]
                );
              }

              await db.executeSql(`DELETE FROM pagos WHERE id = ?`, [item.id]);
              await db.executeSql(`DELETE FROM movimientos WHERE id = ?`, [item.id]);

              eventBus.emit(EVENTS.MOVEMENT_CHANGED);
              await load(true);
              Toast.show({
                text1: 'Pago revertido',
                text2: `Se actualizó el saldo del cliente y se ajustó la caja.`,
              });
            } catch (err) {
              console.log('Error revirtiendo pago:', err);
              appAlert('Error', 'No se pudo revertir el pago.');
            }
          },
        },
      ]
    );
  };

  const filtered = items.filter(i => filterTipo === 'todos' || i.tipo === filterTipo);

  // Renderizador de cada movimiento
  const Row = ({ item }) => {
    const isIngreso = item.tipo === 'ingreso' || item.tipo === 'pago';
    const isVenta = item.tipo === 'venta';
    const isPago = item.tipo === 'pago';
    const color = isIngreso ? apple.colors.success : isVenta ? apple.colors.warning : apple.colors.danger;

    // Estado de sincronización
    const isPendingSync =
      item.estadoMovil === 'actualizado' ||
      item.estadoMovil === 'enviando' ||
      (typeof item.id === 'number' && item.id < 0) ||
      (typeof item.id === 'string' && (item.id.startsWith('-') || item.id.startsWith('temp-')));

    // Formatear descripción amigable sin coordenadas ni UUID sueltos
    let displayDesc = item.descripcion || 'Sin descripción';
    // Limpiar coordenadas históricas entre corchetes
    displayDesc = displayDesc.replace(/\s*\[-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\]\s*$/, '').trim();

    if (item.cliente_nombre) {
      if (isPago) displayDesc = `Pago: ${item.cliente_nombre}`;
      else if (isVenta) displayDesc = `Venta: ${item.cliente_nombre}`;
      else if (item.tipo === 'nopago') displayDesc = `No pago: ${item.cliente_nombre}`;
    } else {
      displayDesc = displayDesc.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig, 'Crédito');
      if (displayDesc.toLowerCase().startsWith('pago factura')) displayDesc = 'Pago de crédito';
      if (displayDesc.toLowerCase().startsWith('venta factura')) displayDesc = 'Venta de crédito';
    }

    const canEditManual = item.tipo === 'ingreso' || item.tipo === 'retiro' || item.tipo === 'gasto';
    const canEditPago = isPago && permiteModificarPagos;
    const canEdit = canEditManual || canEditPago;

    return (
      <View style={styles.row}>
        {/* Badge tipo */}
        <View style={[styles.badge, { backgroundColor: color + '15' }]}>
          <Icon name={isIngreso ? 'arrow-down' : 'arrow-up'} size={12} color={color} />
        </View>

        {/* Informacion central */}
        <View style={{ flex: 1 }}>
          <View style={styles.rowTopLine}>
            <Text style={styles.rowTitle}>
              {item.tipo.toUpperCase()} • {FormatMoneyDecimales(item.monto != null ? item.monto : item.valor)}
            </Text>
            {/* Pill indicador de sincronizacion */}
            <View style={[styles.syncPill, isPendingSync ? styles.syncPillPending : styles.syncPillOk]}>
              <Icon
                name={isPendingSync ? 'cloud-upload' : 'check'}
                size={9}
                color={isPendingSync ? '#B45309' : '#047857'}
              />
              <Text style={[styles.syncPillText, isPendingSync ? styles.syncPillTextPending : styles.syncPillTextOk]}>
                {isPendingSync ? 'Pendiente' : 'Sincronizado'}
              </Text>
            </View>
          </View>

          <Text style={styles.rowSub} numberOfLines={2}>{displayDesc}</Text>
          <Text style={styles.rowDate}>{new Date(item.fecha || Date.now()).toLocaleString()}</Text>
        </View>

        {/* Acciones */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {canEdit && (
            <TouchableOpacity
              style={styles.actionBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => handleOpenEdit(item)}
            >
              <Icon name="pencil" size={14} color={apple.colors.blue} />
            </TouchableOpacity>
          )}

          {isVenta && permiteBorrarVenta && (
            <TouchableOpacity
              style={styles.actionBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => handleDeleteVenta(item)}
            >
              <Icon name="trash-o" size={16} color={apple.colors.danger} />
            </TouchableOpacity>
          )}

          {isPago && permiteModificarPagos && (
            <TouchableOpacity
              style={styles.actionBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => handleRevertPago(item)}
            >
              <Icon name="undo" size={15} color={apple.colors.warning} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={apple.colors.blue} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Movimientos</Text>
        <Text style={styles.headerSub}>
          {caja ? `Caja activa: ${String(caja.id || '').slice(0, 8)}...` : 'Sin caja abierta'}
        </Text>
      </View>

      {/* Controles y Filtros */}
      <View style={styles.controls}>
        <View style={styles.searchRow}>
          <View style={styles.searchWrap}>
            <Icon name="search" size={13} color={apple.colors.tertiaryLabel} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar movimiento o cliente..."
              placeholderTextColor={apple.colors.tertiaryLabel}
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={handleSearch}
            />
          </View>
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
            <Icon name="arrow-right" size={14} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 10 }}>
          {['todos', 'ingreso', 'retiro', 'gasto', 'venta', 'pago'].map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setFilterTipo(t)}
              style={[styles.chip, filterTipo === t && styles.chipActive]}
            >
              <Text style={[styles.chipText, filterTipo === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Lista de Movimientos */}
      <FlatList
        data={filtered}
        keyExtractor={i => String(i.id)}
        renderItem={Row}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="inbox" size={32} color={apple.colors.tertiaryLabel} />
            <Text style={styles.emptyTitle}>Sin movimientos</Text>
            <Text style={styles.emptySub}>No se encontraron registros para este filtro.</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 90 }}
      />

      {/* FAB para registrar nuevo movimiento manual */}
      <TouchableOpacity
        style={[styles.fab, !caja && { backgroundColor: apple.colors.tertiaryLabel }]}
        onPress={() =>
          caja?.estado === 'abierta'
            ? setModalVisible(true)
            : appAlert('Caja requerida', 'Debes tener una caja abierta para registrar ingresos, retiros o gastos.')
        }
      >
        <Icon name="plus" size={18} color="#fff" />
      </TouchableOpacity>

      {/* Modal de Nuevo Movimiento */}
      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation?.()}
            style={styles.modalCard}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuevo movimiento</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.modalCloseBtn}
              >
                <Icon name="times" size={18} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            {/* Selector de Tipo */}
            <Text style={styles.label}>Tipo de movimiento</Text>
            <View style={styles.tipoRow}>
              <TouchableOpacity
                style={[styles.tipoBtn, formTipo === 'ingreso' && { backgroundColor: apple.colors.success, borderColor: apple.colors.success }]}
                onPress={() => setFormTipo('ingreso')}
              >
                <Text style={[styles.tipoText, formTipo === 'ingreso' && { color: '#fff' }]}>Ingreso</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tipoBtn, formTipo === 'retiro' && { backgroundColor: apple.colors.danger, borderColor: apple.colors.danger }]}
                onPress={() => setFormTipo('retiro')}
              >
                <Text style={[styles.tipoText, formTipo === 'retiro' && { color: '#fff' }]}>Retiro</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tipoBtn, formTipo === 'gasto' && { backgroundColor: apple.colors.warning, borderColor: apple.colors.warning }]}
                onPress={() => setFormTipo('gasto')}
              >
                <Text style={[styles.tipoText, formTipo === 'gasto' && { color: '#fff' }]}>Gasto</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>Ventas y pagos se registran automáticamente en sus secciones.</Text>

            {/* Inputs */}
            <Text style={styles.label}>Descripción *</Text>
            <TextInput
              style={styles.input}
              value={formDesc}
              onChangeText={setFormDesc}
              placeholder="Ej. Transporte, consignación, almuerzo"
              placeholderTextColor={apple.colors.tertiaryLabel}
            />

            <Text style={styles.label}>Monto *</Text>
            <TextInput
              style={styles.input}
              value={formMonto}
              onChangeText={t => setFormMonto(formatMoneyInput(t))}
              keyboardType="numeric"
              placeholder="$ 0"
              placeholderTextColor={apple.colors.tertiaryLabel}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreate} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal de Edición de Movimiento */}
      <Modal
        visible={editModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setEditModalVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setEditModalVisible(false)}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation?.()}
            style={styles.modalCard}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Editar {editingItem ? Capitalize(editingItem.tipo) : 'Movimiento'}
              </Text>
              <TouchableOpacity
                onPress={() => setEditModalVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.modalCloseBtn}
              >
                <Icon name="times" size={18} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Descripción *</Text>
            <TextInput
              style={styles.input}
              value={editDesc}
              onChangeText={setEditDesc}
              placeholder="Descripción del movimiento"
              placeholderTextColor={apple.colors.tertiaryLabel}
            />

            <Text style={styles.label}>Monto *</Text>
            <TextInput
              style={styles.input}
              value={editMonto}
              onChangeText={t => setEditMonto(formatMoneyInput(t))}
              keyboardType="numeric"
              placeholder="$ 0"
              placeholderTextColor={apple.colors.tertiaryLabel}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Actualizar</Text>}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: apple.colors.bgGrouped },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: apple.colors.card,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: apple.colors.label },
  headerSub: { fontSize: 13, color: apple.colors.secondaryLabel, marginTop: 2 },
  controls: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: apple.radius.l,
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.s,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 14, color: apple.colors.label },
  searchBtn: {
    backgroundColor: apple.colors.blue,
    width: 40,
    height: 40,
    borderRadius: apple.radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: apple.colors.card,
    borderWidth: 1,
    borderColor: apple.colors.separator,
  },
  chipActive: { backgroundColor: apple.colors.blue, borderColor: apple.colors.blue },
  chipText: { fontSize: 12, fontWeight: '600', color: apple.colors.secondaryLabel, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },

  row: {
    flexDirection: 'row',
    backgroundColor: apple.colors.card,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
    borderRadius: apple.radius.m,
    gap: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { fontSize: 13, fontWeight: '700', color: apple.colors.label },
  rowSub: { fontSize: 13, color: apple.colors.secondaryLabel, marginTop: 3, fontWeight: '500' },
  rowDate: { fontSize: 11, color: apple.colors.tertiaryLabel, marginTop: 4 },

  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  syncPillOk: { backgroundColor: '#ECFDF5' },
  syncPillPending: { backgroundColor: '#FEF3C7' },
  syncPillText: { fontSize: 10, fontWeight: '700' },
  syncPillTextOk: { color: '#047857' },
  syncPillTextPending: { color: '#B45309' },

  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: apple.colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: apple.colors.label, marginTop: 10 },
  emptySub: { fontSize: 13, color: apple.colors.tertiaryLabel, marginTop: 4 },

  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: apple.colors.blue,
    width: 56,
    height: 56,
    borderRadius: apple.radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.xl,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: apple.colors.label },
  modalCloseBtn: { padding: 4 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 6,
  },
  tipoRow: { flexDirection: 'row', gap: 8 },
  tipoBtn: {
    flex: 1,
    height: 42,
    borderRadius: apple.radius.s,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: apple.colors.bgGrouped,
  },
  tipoText: { fontWeight: '700', fontSize: 13, color: apple.colors.secondaryLabel },
  hint: { fontSize: 11, color: apple.colors.tertiaryLabel, marginTop: 6, marginBottom: 4 },
  input: {
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.s,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    paddingHorizontal: 14,
    height: 44,
    fontSize: 15,
    color: apple.colors.label,
    marginBottom: 6,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: apple.radius.m,
    backgroundColor: apple.colors.bgGrouped,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontWeight: '600', color: apple.colors.label, fontSize: 14 },
  saveBtn: {
    flex: 1,
    height: 46,
    borderRadius: apple.radius.m,
    backgroundColor: apple.colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontWeight: '700', color: '#fff', fontSize: 14 },
});
