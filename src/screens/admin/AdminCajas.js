// src/screens/admin/AdminCajas.js
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../theme/appleTheme';
import { appAlert } from '../../components/AppAlert';
import { useAuth } from '../../context/AuthContext';
import { getAdminCajas, abrirCajasMasivo } from '../../services/adminService';
import { CajaCard } from './components/CajaCard';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';

const getTodayIso = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getYesterdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatReadableDate = (isoStr) => {
  if (!isoStr) return 'Todas las fechas';
  try {
    const parts = isoStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      return `${day} ${months[d.getMonth()]} ${year}`;
    }
    return isoStr;
  } catch {
    return isoStr;
  }
};

export default function AdminCajas() {
  const navigation = useNavigation();
  const { userId, signOut } = useAuth();

  const [cajas, setCajas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  // Filtro de fecha (Requisito 9)
  const [selectedDate, setSelectedDate] = useState(null); // null = todas
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');

  // Requisito 8: Carga y actualizacion de datos
  const loadData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await getAdminCajas(selectedDate, selectedDate);
      setCajas(data || []);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar las cajas');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDate]);

  // Requisito 8: useFocusEffect para recarga automatica al entrar o volver
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData(true);
  };

  const adminAbiertas = cajas.filter(
    (c) => (c.usuario_id === userId || c.rol_usuario === 'admin') && c.estado === 'abierta'
  ).length;

  const handlePressAbrirMasivo = () => {
    if (adminAbiertas >= 3) {
      appAlert(
        'Tienes 3 cajas abiertas',
        'Ya alcanzaste el lmite de 3 cajas abiertas al mismo tiempo. Debes cerrar al menos una de tus cajas antes de poder realizar una nueva apertura.'
      );
      return;
    }

    appAlert(
      'Apertura Masiva de Cajas',
      `Deseas abrir las cajas de todos los vendedores activos y una nueva caja para ti con la fecha de hoy?

Actualmente tienes ${adminAbiertas} de 3 cajas permitidas abiertas.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Abrir Cajas',
          onPress: async () => {
            setOpening(true);
            try {
              const res = await abrirCajasMasivo();
              appAlert(
                'Apertura exitosa!',
                `Se abrieron ${res.cajas_abiertas} caja(s) correctamente, incluyendo tu nueva caja del da.`
              );
              loadData(true);
            } catch (err) {
              console.log('Error abrir masivo', err.message);
              appAlert('Atencin', err.message || 'No se pudieron abrir las cajas');
            } finally {
              setOpening(false);
            }
          },
        },
      ]
    );
  };

  const handleSelectCaja = (caja) => {
    navigation.navigate('AdminCajaDetalle', { caja });
  };

  const handleApplyCustomDate = () => {
    const trimmed = customDateInput.trim();
    if (!trimmed) {
      setSelectedDate(null);
      setDateModalVisible(false);
      return;
    }
    // Validar formato YYYY-MM-DD
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(trimmed)) {
      appAlert('Formato invlido', 'Por favor ingresa la fecha en formato AAAA-MM-DD (ejemplo: 2026-10-26)');
      return;
    }
    setSelectedDate(trimmed);
    setDateModalVisible(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Gestin de Cajas</Text>
          <Text style={styles.headerSubtitle}>
            Supervisin diaria  {adminAbiertas}/3 cajas admin abiertas
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={() => setShowLogout(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="sign-out" size={16} color={apple.colors.danger} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={handlePressAbrirMasivo} disabled={opening}>
            <Icon name="archive" size={14} color="#FFFFFF" />
            <Text style={styles.headerBtnText}>{opening ? 'Abriendo...' : 'Abrir Masivo'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Selector / Filtro de Fecha (Requisito 9) */}
      <View style={styles.filterSection}>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, selectedDate === null && styles.filterChipActive]}
            onPress={() => setSelectedDate(null)}
          >
            <Text style={[styles.filterChipText, selectedDate === null && styles.filterChipTextActive]}>
              Todas
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, selectedDate === getTodayIso() && styles.filterChipActive]}
            onPress={() => setSelectedDate(getTodayIso())}
          >
            <Text style={[styles.filterChipText, selectedDate === getTodayIso() && styles.filterChipTextActive]}>
              Hoy
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, selectedDate === getYesterdayIso() && styles.filterChipActive]}
            onPress={() => setSelectedDate(getYesterdayIso())}
          >
            <Text style={[styles.filterChipText, selectedDate === getYesterdayIso() && styles.filterChipTextActive]}>
              Ayer
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              selectedDate !== null &&
                selectedDate !== getTodayIso() &&
                selectedDate !== getYesterdayIso() &&
                styles.filterChipActive,
            ]}
            onPress={() => {
              setCustomDateInput(selectedDate || getTodayIso());
              setDateModalVisible(true);
            }}
          >
            <Icon
              name="calendar"
              size={12}
              color={
                selectedDate !== null &&
                selectedDate !== getTodayIso() &&
                selectedDate !== getYesterdayIso()
                  ? '#fff'
                  : apple.colors.blue
              }
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.filterChipText,
                selectedDate !== null &&
                  selectedDate !== getTodayIso() &&
                  selectedDate !== getYesterdayIso() &&
                  styles.filterChipTextActive,
              ]}
            >
              Fecha...
            </Text>
          </TouchableOpacity>
        </View>

        {selectedDate !== null && (
          <View style={styles.activeFilterBadge}>
            <Icon name="filter" size={11} color={apple.colors.blue} style={{ marginRight: 5 }} />
            <Text style={styles.activeFilterText}>
              Filtrado por apertura:{' '}
              <Text style={{ fontWeight: '700', color: apple.colors.blue }}>
                {formatReadableDate(selectedDate)}
              </Text>
            </Text>
            <TouchableOpacity onPress={() => setSelectedDate(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="times-circle" size={14} color={apple.colors.secondaryLabel} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Lista de Cajas */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={apple.colors.blue} />
        </View>
      ) : (
        <FlatList
          data={cajas}
          keyExtractor={(item) => item.caja_id}
          renderItem={({ item }) => (
            <CajaCard
              caja={item}
              isMyCaja={item.usuario_id === userId}
              onPress={handleSelectCaja}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="archive" size={48} color={apple.colors.tertiaryLabel} />
              <Text style={styles.emptyTitle}>No hay cajas registradas</Text>
              <Text style={styles.emptySubtitle}>
                {selectedDate
                  ? `No se encontraron cajas con apertura en la fecha ${formatReadableDate(selectedDate)}`
                  : 'Usa el botn "Abrir Masivo" para iniciar el da'}
              </Text>
            </View>
          }
        />
      )}

      {/* MODAL SELECCIONAR FECHA ESPECIFICA (Requisito 9) */}
      <Modal visible={dateModalVisible} transparent animationType="fade" onRequestClose={() => setDateModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Icon name="calendar" size={22} color={apple.colors.blue} />
            </View>
            <Text style={styles.modalTitle}>Filtrar por fecha de apertura</Text>
            <Text style={styles.modalSubtitle}>
              Ingresa la fecha que deseas consultar en formato AAAA-MM-DD
            </Text>

            <TextInput
              style={styles.modalInput}
              value={customDateInput}
              onChangeText={setCustomDateInput}
              placeholder="AAAA-MM-DD (ej: 2026-10-26)"
              placeholderTextColor={apple.colors.tertiaryLabel}
              keyboardType="numbers-and-punctuation"
              autoFocus
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setDateModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={handleApplyCustomDate}
              >
                <Text style={styles.modalBtnPrimaryText}>Aplicar filtro</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <LogoutConfirmModal
        visible={showLogout}
        onClose={() => setShowLogout(false)}
        onConfirm={signOut}
      />
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.m,
    paddingBottom: apple.spacing.s,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: apple.colors.label,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  headerLogoutBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFEBEA',
    justifyContent: 'center',
    alignItems: 'center',
    ...apple.shadow.subtle,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.blue,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: apple.radius.m,
    gap: 6,
    ...apple.shadow.subtle,
  },
  headerBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  filterSection: {
    paddingHorizontal: apple.spacing.l,
    paddingVertical: 8,
    backgroundColor: apple.colors.bg,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: apple.radius.m,
    backgroundColor: apple.colors.card,
    borderWidth: 1,
    borderColor: apple.colors.separator,
  },
  filterChipActive: {
    backgroundColor: apple.colors.blue,
    borderColor: apple.colors.blue,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: apple.colors.label,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  activeFilterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF3FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: apple.radius.s,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  activeFilterText: {
    fontSize: 11,
    color: apple.colors.secondaryLabel,
  },
  listContent: {
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.s,
    paddingBottom: apple.spacing.xl,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: apple.colors.secondaryLabel,
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 13,
    color: apple.colors.tertiaryLabel,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: apple.spacing.l,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.xl,
    padding: apple.spacing.l,
    alignItems: 'center',
    ...apple.shadow.large,
  },
  modalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EBF3FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: apple.spacing.s,
  },
  modalTitle: {
    ...apple.typography.headline,
    fontWeight: '700',
    color: apple.colors.label,
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    ...apple.typography.caption1,
    color: apple.colors.secondaryLabel,
    textAlign: 'center',
    marginBottom: apple.spacing.m,
  },
  modalInput: {
    width: '100%',
    height: 44,
    backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.m,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    ...apple.typography.body,
    color: apple.colors.label,
    textAlign: 'center',
    marginBottom: apple.spacing.m,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    height: 42,
    borderRadius: apple.radius.m,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnCancel: {
    backgroundColor: apple.colors.fill,
  },
  modalBtnCancelText: {
    ...apple.typography.subheadline,
    fontWeight: '600',
    color: apple.colors.label,
  },
  modalBtnPrimary: {
    backgroundColor: apple.colors.blue,
  },
  modalBtnPrimaryText: {
    ...apple.typography.subheadline,
    fontWeight: '600',
    color: '#fff',
  },
});
