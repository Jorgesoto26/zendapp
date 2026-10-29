// src/screens/admin/AdminCajas.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { getAdminCajas, abrirCajasMasivo, getAdminOpenCajasCount } from '../../services/adminService';
import { CajaCard } from './components/CajaCard';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import { eventBus, EVENTS } from '../../utils/eventBus';

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
  if (!isoStr) return 'Hoy';
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

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export default function AdminCajas() {
  const navigation = useNavigation();
  const { userId, signOut } = useAuth();

  const [cajas, setCajas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [adminOpenCount, setAdminOpenCount] = useState(0);

  // Filtros de fecha exclusivos: 'hoy' (defecto), 'ayer', 'custom' (Requisito 5)
  const [selectedDate, setSelectedDate] = useState(getTodayIso());
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');

  // Estados para el calendario interactivo
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());

  const isHoy = selectedDate === getTodayIso();
  const isAyer = selectedDate === getYesterdayIso();
  const isCustom = !isHoy && !isAyer;

  const loadData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await getAdminCajas(selectedDate, selectedDate);
      setCajas(data || []);
      const openCount = await getAdminOpenCajasCount(userId);
      setAdminOpenCount(openCount);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar las cajas');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDate, userId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    const unsub = eventBus.on(EVENTS.MOVEMENT_CHANGED, () => {
      loadData(true);
    });
    return () => unsub();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData(true);
  };

  const handlePressAbrirMasivo = () => {
    const todayIso = getTodayIso();
    const cajaHoyAdmin = cajas.find(
      (c) => c.usuario_id === userId && c.estado === 'abierta' && (
        c.fecha_apertura && c.fecha_apertura.slice(0, 10) === todayIso
      )
    );

    if (!cajaHoyAdmin && adminOpenCount >= 3) {
      appAlert(
        'Tienes 3 cajas abiertas',
        'Ya alcanzaste el límite de 3 cajas abiertas al mismo tiempo. Debes cerrar al menos una de tus cajas anteriores antes de poder realizar una nueva apertura.'
      );
      return;
    }

    const mensaje = cajaHoyAdmin
      ? `Ya tienes una caja abierta para hoy. Se reutilizará como referencia y se abrirán las cajas de tus vendedores subordinados activos que aún no tengan caja abierta.\n\nActualmente tienes ${adminOpenCount} de 3 cajas permitidas abiertas.`
      : `¿Deseas abrir las cajas de todos los vendedores activos y una nueva caja para ti con la fecha de hoy?\n\nActualmente tienes ${adminOpenCount} de 3 cajas permitidas abiertas.`;

    appAlert(
      'Apertura Masiva de Cajas',
      mensaje,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Abrir Cajas',
          onPress: async () => {
            setOpening(true);
            try {
              const res = await abrirCajasMasivo();
              const detalle = res.admin_caja_reutilizada
                ? `Se reutilizó tu caja de hoy y se abrieron ${res.vendedores_cajas_abiertas ?? (res.cajas_abiertas || 0)} caja(s) de vendedores.`
                : `Se abrieron ${res.cajas_abiertas} caja(s) correctamente, incluyendo tu nueva caja del día.`;
              appAlert('¡Apertura exitosa!', detalle);
              loadData(true);
            } catch (err) {
              console.log('Error abrir masivo', err.message);
              appAlert('Atención', err.message || 'No se pudieron abrir las cajas');
            } finally {
              setOpening(false);
            }
          },
        },
      ]
    );
  };

  const handleSelectCaja = (caja) => {
    navigation.navigate('AdminCajaDetalle', {
      caja,
      onRefreshParent: () => loadData(true),
    });
  };

  const openCalendarModal = () => {
    try {
      const parts = selectedDate.split('-');
      if (parts.length === 3) {
        setCalYear(parseInt(parts[0], 10));
        setCalMonth(parseInt(parts[1], 10) - 1);
      }
    } catch {}
    setCustomDateInput(selectedDate);
    setDateModalVisible(true);
  };

  const handlePrevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear(y => y - 1);
    } else {
      setCalMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear(y => y + 1);
    } else {
      setCalMonth(m => m + 1);
    }
  };

  const handleSelectDay = (day) => {
    const mStr = String(calMonth + 1).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const iso = `${calYear}-${mStr}-${dStr}`;
    setSelectedDate(iso);
    setDateModalVisible(false);
  };

  const handleApplyCustomInput = () => {
    const trimmed = customDateInput.trim();
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(trimmed)) {
      appAlert('Formato inválido', 'Por favor ingresa la fecha en formato AAAA-MM-DD (ej: 2026-10-26)');
      return;
    }
    setSelectedDate(trimmed);
    setDateModalVisible(false);
  };

  // Generar cuadrícula de días para el calendario
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(calYear, calMonth, 1).getDay(); // 0 domingo, 1 lunes...
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const blanks = Array.from({ length: firstDayIndex }, (_, i) => null);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    return [...blanks, ...days];
  }, [calYear, calMonth]);

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Gestión de Cajas</Text>
          <Text style={styles.headerSubtitle}>
            Supervisión diaria · {adminOpenCount}/3 cajas admin abiertas
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

      {/* Selector de Filtros Exclusivos: Hoy, Ayer, Fecha específica (Requisito 5) */}
      <View style={styles.filterSection}>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, isHoy && styles.filterChipActive]}
            onPress={() => setSelectedDate(getTodayIso())}
          >
            <Text style={[styles.filterChipText, isHoy && styles.filterChipTextActive]}>
              Hoy
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, isAyer && styles.filterChipActive]}
            onPress={() => setSelectedDate(getYesterdayIso())}
          >
            <Text style={[styles.filterChipText, isAyer && styles.filterChipTextActive]}>
              Ayer
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, isCustom && styles.filterChipActive]}
            onPress={openCalendarModal}
          >
            <Icon
              name="calendar"
              size={12}
              color={isCustom ? '#fff' : apple.colors.blue}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.filterChipText, isCustom && styles.filterChipTextActive]}>
              {isCustom ? formatReadableDate(selectedDate) : 'Fecha específica'}
            </Text>
          </TouchableOpacity>
        </View>

        {isCustom && (
          <View style={styles.activeFilterBadge}>
            <Icon name="calendar-check-o" size={11} color={apple.colors.blue} style={{ marginRight: 5 }} />
            <Text style={styles.activeFilterText}>
              Consultando fecha: <Text style={{ fontWeight: '700', color: apple.colors.blue }}>{formatReadableDate(selectedDate)}</Text>
            </Text>
            <TouchableOpacity onPress={() => setSelectedDate(getTodayIso())} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
          keyExtractor={(item) => String(item.caja_id || item.id)}
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
                {isHoy
                  ? 'No hay cajas abiertas para hoy. Usa el botón "Abrir Masivo" para iniciar jornada.'
                  : `No se encontraron registros de cajas para el día ${formatReadableDate(selectedDate)}.`}
              </Text>
            </View>
          }
        />
      )}

      {/* MODAL SELECTOR DE FECHA INTERACTIVO (Requisito 5) */}
      <Modal visible={dateModalVisible} transparent animationType="fade" onRequestClose={() => setDateModalVisible(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setDateModalVisible(false)}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation?.()}
            style={styles.modalCard}
          >
            {/* Header del Calendario */}
            <View style={styles.calendarNav}>
              <TouchableOpacity onPress={handlePrevMonth} style={styles.calNavBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="chevron-left" size={14} color={apple.colors.blue} />
              </TouchableOpacity>
              <Text style={styles.calMonthTitle}>
                {MONTH_NAMES[calMonth]} {calYear}
              </Text>
              <TouchableOpacity onPress={handleNextMonth} style={styles.calNavBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="chevron-right" size={14} color={apple.colors.blue} />
              </TouchableOpacity>
            </View>

            {/* Días de la semana */}
            <View style={styles.weekRow}>
              {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d, idx) => (
                <Text key={idx} style={styles.weekText}>{d}</Text>
              ))}
            </View>

            {/* Cuadrícula de Días */}
            <View style={styles.daysGrid}>
              {calendarDays.map((day, idx) => {
                if (day === null) {
                  return <View key={idx} style={styles.dayCellBlank} />;
                }
                const mStr = String(calMonth + 1).padStart(2, '0');
                const dStr = String(day).padStart(2, '0');
                const thisIso = `${calYear}-${mStr}-${dStr}`;
                const isSelected = selectedDate === thisIso;
                const isToday = thisIso === getTodayIso();

                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => handleSelectDay(day)}
                    style={[
                      styles.dayCell,
                      isSelected && styles.dayCellSelected,
                      isToday && !isSelected && styles.dayCellToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        isSelected && styles.dayTextSelected,
                        isToday && !isSelected && styles.dayTextToday,
                      ]}
                    >
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Input manual alternativo */}
            <View style={styles.manualInputRow}>
              <TextInput
                style={styles.manualInput}
                value={customDateInput}
                onChangeText={setCustomDateInput}
                placeholder="AAAA-MM-DD"
                placeholderTextColor={apple.colors.tertiaryLabel}
                keyboardType="numbers-and-punctuation"
              />
              <TouchableOpacity style={styles.manualApplyBtn} onPress={handleApplyCustomInput}>
                <Text style={styles.manualApplyText}>Aplicar</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setDateModalVisible(false)}>
              <Text style={styles.cancelModalText}>Cerrar</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
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
    paddingHorizontal: 14,
    paddingVertical: 8,
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
    fontWeight: '700',
  },
  activeFilterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF3FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: apple.radius.s,
    marginTop: 8,
  },
  activeFilterText: {
    fontSize: 12,
    color: apple.colors.secondaryLabel,
    flex: 1,
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
    maxWidth: 280,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.l,
    padding: 20,
    ...apple.shadow.elevated,
  },
  calendarNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  calNavBtn: {
    padding: 8,
  },
  calMonthTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: apple.colors.label,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: apple.colors.separator,
    paddingBottom: 6,
  },
  weekText: {
    width: 38,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  dayCellBlank: {
    width: `${100 / 7}%`,
    height: 38,
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 19,
    marginVertical: 2,
  },
  dayCellSelected: {
    backgroundColor: apple.colors.blue,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: apple.colors.blue,
  },
  dayText: {
    fontSize: 13,
    fontWeight: '500',
    color: apple.colors.label,
  },
  dayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dayTextToday: {
    color: apple.colors.blue,
    fontWeight: '700',
  },
  manualInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: apple.colors.separator,
  },
  manualInput: {
    flex: 1,
    backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.s,
    paddingHorizontal: 12,
    height: 38,
    fontSize: 13,
    color: apple.colors.label,
  },
  manualApplyBtn: {
    backgroundColor: apple.colors.blue,
    paddingHorizontal: 14,
    borderRadius: apple.radius.s,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualApplyText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  cancelModalBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelModalText: {
    color: apple.colors.secondaryLabel,
    fontWeight: '600',
    fontSize: 13,
  },
});
