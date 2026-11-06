import AppBackground from '../../components/AppBackground';
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
  BackHandler,
  ScrollView,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../../theme/zendappTheme';
import { appAlert } from '../../components/AppAlert';
import { useAuth } from '../../context/AuthContext';
import {
  getAdminCajas,
  abrirCajasMasivo,
  getAdminOpenCajasCount,
  getAdminOpenCajas,
  getSubordinates,
} from '../../services/adminService';
import { getDeviceTimezone } from '../../services/cajaService';
import { FormatMoneyDecimales } from '../../utils/utilities';
import { CajaCard } from './components/CajaCard';
import { HierarchyBreadcrumb } from './components/HierarchyBreadcrumb';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import { SkeletonList, SkeletonCarteraCard } from '../../components/Skeleton';
import { eventBus, EVENTS } from '../../utils/eventBus';

const getTodayIso = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
};

const getYesterdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
};

const formatReadableDateTime = (isoStr) => {
  if (!isoStr) return 'Fecha no disponible';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).slice(0, 16);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
  } catch {
    return String(isoStr).slice(0, 16);
  }
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
  const [hierarchyStack, setHierarchyStack] = useState([{ id: userId, name: 'Mis Cajas' }]);
  const [subAdmins, setSubAdmins] = useState([]);

  const [cajas, setCajas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [adminOpenCount, setAdminOpenCount] = useState(0);
  const [adminOpenCajas, setAdminOpenCajas] = useState([]);

  useEffect(() => {
    if (userId) {
      setHierarchyStack((prev) => (prev.length === 0 ? [{ id: userId, name: 'Mis Cajas' }] : prev));
    }
  }, [userId]);

  const currentParent = hierarchyStack[hierarchyStack.length - 1];
  const currentParentId = currentParent?.id || userId;

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

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (hierarchyStack.length > 1) {
          setHierarchyStack((prev) => prev.slice(0, -1));
          return true;
        }
        setShowLogout(true);
        return true;
      });
      return () => sub.remove();
    }, [hierarchyStack.length])
  );

  const loadData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const targetParentId = hierarchyStack.length > 1 ? hierarchyStack[hierarchyStack.length - 1].id : null;
      const data = await getAdminCajas(selectedDate, selectedDate, targetParentId);
      setCajas(data || []);
      const openCount = await getAdminOpenCajasCount(targetParentId || userId);
      setAdminOpenCount(openCount);

      // Obtener subordinados directos que son administradores o tienen equipo a cargo
      try {
        const subs = await getSubordinates(targetParentId);
        setSubAdmins((subs || []).filter((s) => s.rol === 'admin' || s.tiene_subordinados));
      } catch {
        setSubAdmins([]);
      }
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar las cajas');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDate, userId, hierarchyStack]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleNavigateHierarchy = (subAdmin) => {
    setLoading(true);
    setHierarchyStack((prev) => [
      ...prev,
      {
        id: subAdmin.usuario_id || subAdmin.id,
        name: subAdmin.nombre_usuario || subAdmin.nombre || 'Administrador',
      },
    ]);
  };

  const handlePopHierarchy = (targetIndex) => {
    setLoading(true);
    setHierarchyStack((prev) => prev.slice(0, targetIndex + 1));
  };

  const subAdminsWithoutCaja = useMemo(() => {
    const cajaUserIds = new Set((cajas || []).map((c) => c.usuario_id));
    return (subAdmins || []).filter((s) => !cajaUserIds.has(s.id));
  }, [subAdmins, cajas]);

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

  const handlePressAbrirMasivo = async () => {
    setOpening(true);
    let openCajasList = [];
    try {
      openCajasList = await getAdminOpenCajas(userId);
      setAdminOpenCajas(openCajasList || []);
      setAdminOpenCount(openCajasList ? openCajasList.length : 0);
    } catch {} finally {
      setOpening(false);
    }

    const currentOpen = openCajasList && openCajasList.length > 0 ? openCajasList[0] : null;
    const todayStr = getTodayIso();
    const cajaDateStr = currentOpen?.fecha_corta || (currentOpen?.fecha_apertura ? currentOpen.fecha_apertura.slice(0, 10) : '');

    let mensaje = '';
    if (currentOpen && cajaDateStr === todayStr) {
      mensaje = 'Ya tienes tu caja activa abierta para el día de hoy.\n\n' +
        'Al ejecutar la apertura masiva, se verificarán y abrirán las cajas de hoy para todos tus vendedores subordinados que no tengan caja abierta.\n\n' +
        '¿Deseas continuar?';
    } else if (currentOpen && cajaDateStr !== todayStr) {
      const dStr = currentOpen.fecha_formateada || formatReadableDateTime(currentOpen.fecha_apertura);
      mensaje = `Tienes una caja abierta de una fecha anterior (${dStr}).\n\n` +
        'El sistema cerrará automáticamente esa caja anterior y creará tu caja de hoy, además de abrir las cajas para todos tus vendedores subordinados activos.\n\n' +
        '¿Deseas realizar la apertura masiva?';
    } else {
      mensaje = 'Al ejecutar la apertura masiva:\n' +
        '• Se creará tu caja abierta para el día de hoy.\n' +
        '• Se abrirán las cajas de hoy para todos tus vendedores subordinados activos.\n\n' +
        '¿Deseas continuar?';
    }

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
              const targetParentId = hierarchyStack.length > 1 ? hierarchyStack[hierarchyStack.length - 1].id : null;
              const res = await abrirCajasMasivo(targetParentId);
              let detalle = '';
              if (res.admin_caja_reutilizada) {
                detalle = `Tu caja de hoy ya estaba activa. Se abrieron ${res.vendedores_cajas_abiertas || 0} caja(s) de vendedores.`;
              } else {
                detalle = `Se crearon ${res.cajas_abiertas} caja(s) correctamente (Tu caja de hoy + ${res.vendedores_cajas_abiertas || 0} de vendedores).`;
              }
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
    } catch { }
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
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Gestión de Cajas</Text>
          <Text style={styles.headerSubtitle}>
            {hierarchyStack.length > 1 ? `Equipo: ${currentParent?.name || ''} · ` : ''}
            Supervisión diaria · {adminOpenCount > 0 ? 'Caja activa' : 'Sin caja activa'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={() => setShowLogout(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="sign-out" size={16} color={zendapp.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={handlePressAbrirMasivo} disabled={opening}>
            <Icon name="archive" size={14} color="#FFFFFF" />
            <Text style={styles.headerBtnText}>{opening ? 'Abriendo...' : 'Abrir Masivo'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Breadcrumb de Navegación Jerárquica */}
      <HierarchyBreadcrumb
        stack={hierarchyStack}
        onPop={handlePopHierarchy}
        rootTitle="Mis Cajas"
      />

      {/* Sub-administradores con equipo a cargo sin caja registrada en esta fecha */}
      {subAdminsWithoutCaja && subAdminsWithoutCaja.length > 0 && (
        <View style={styles.subTeamsBar}>
          <View style={styles.subTeamsTitleRow}>
            <Icon name="sitemap" size={12} color={zendapp.colors.primary} style={{ marginRight: 6 }} />
            <Text style={styles.subTeamsLabel}>Otros equipos a cargo:</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subTeamsScroll}
          >
            {subAdminsWithoutCaja.map((adm) => (
              <TouchableOpacity
                key={adm.id}
                style={styles.subTeamChip}
                onPress={() =>
                  handleNavigateHierarchy({
                    usuario_id: adm.id,
                    nombre_usuario: `${adm.nombre} ${adm.apellido || ''}`.trim(),
                  })
                }
                activeOpacity={0.7}
              >
                <Icon name="shield" size={10} color={zendapp.colors.primary} style={{ marginRight: 4 }} />
                <Text style={styles.subTeamChipText}>
                  {adm.nombre} ({adm.cantidad_subordinados || 0}) ➔
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Banner informativo de cajas abiertas con acceso directo a fechas */}
      {adminOpenCajas && adminOpenCajas.length > 0 && (
        <View style={styles.openCajasBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Icon
              name={adminOpenCount >= 3 ? 'exclamation-circle' : 'info-circle'}
              size={13}
              color={adminOpenCount >= 3 ? zendapp.colors.danger : zendapp.colors.primary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.openCajasBannerTitle, adminOpenCount >= 3 && { color: zendapp.colors.danger }]}>
              Tu caja activa actual (toca para ver):
            </Text>
          </View>
          <View style={styles.openCajasPillsRow}>
            {adminOpenCajas.map((c, idx) => {
              const fCorta = c.fecha_corta || (c.fecha_apertura ? c.fecha_apertura.slice(0, 10) : '');
              const isCurrent = selectedDate === fCorta;
              return (
                <TouchableOpacity
                  key={c.id || idx}
                  style={[styles.openCajaPill, isCurrent && styles.openCajaPillActive]}
                  onPress={() => {
                    if (fCorta) setSelectedDate(fCorta);
                  }}
                >
                  <Icon
                    name="folder-open-o"
                    size={11}
                    color={isCurrent ? '#fff' : (adminOpenCount >= 3 ? zendapp.colors.danger : zendapp.colors.primary)}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.openCajaPillText, isCurrent && styles.openCajaPillTextActive]}>
                    {c.fecha_formateada || formatReadableDateTime(c.fecha_apertura)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

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
              color={isCustom ? '#fff' : zendapp.colors.primary}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.filterChipText, isCustom && styles.filterChipTextActive]}>
              {isCustom ? formatReadableDate(selectedDate) : 'Fecha específica'}
            </Text>
          </TouchableOpacity>
        </View>

        {isCustom && (
          <View style={styles.activeFilterBadge}>
            <Icon name="calendar-check-o" size={11} color={zendapp.colors.primary} style={{ marginRight: 5 }} />
            <Text style={styles.activeFilterText}>
              Consultando fecha: <Text style={{ fontWeight: '700', color: zendapp.colors.primary }}>{formatReadableDate(selectedDate)}</Text>
            </Text>
            <TouchableOpacity onPress={() => setSelectedDate(getTodayIso())} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="times-circle" size={14} color={zendapp.colors.textMuted} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Lista de Cajas */}
        {loading ? (
          <View style={{ flex: 1, paddingTop: 10 }}>
            <SkeletonList count={5} Component={SkeletonCarteraCard} />
          </View>
        ) : (
        <FlatList
          data={cajas}
          keyExtractor={(item) => String(item.caja_id || item.id)}
          renderItem={({ item }) => (
            <CajaCard
              caja={item}
              isMyCaja={item.usuario_id === currentParentId}
              onPress={handleSelectCaja}
              onNavigateHierarchy={handleNavigateHierarchy}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={zendapp.colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="archive" size={44} color={zendapp.colors.border} />
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
                <Icon name="chevron-left" size={14} color={zendapp.colors.primary} />
              </TouchableOpacity>
              <Text style={styles.calMonthTitle}>
                {MONTH_NAMES[calMonth]} {calYear}
              </Text>
              <TouchableOpacity onPress={handleNextMonth} style={styles.calNavBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="chevron-right" size={14} color={zendapp.colors.primary} />
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
                placeholderTextColor={zendapp.colors.textMuted}
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
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: zendapp.colors.carbon,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  headerLogoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: zendapp.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  headerBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  filterSection: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: zendapp.colors.bg,
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
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  filterChipActive: {
    backgroundColor: zendapp.colors.primary,
    borderColor: zendapp.colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  activeFilterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEECEC',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
  },
  activeFilterText: {
    fontSize: 12,
    color: zendapp.colors.textSecondary,
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
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
    color: zendapp.colors.carbon,
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EAECF0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
      },
      android: {
        elevation: 0,
      },
    }),
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
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EAECF0',
    paddingBottom: 6,
  },
  weekText: {
    width: 38,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: zendapp.colors.textSecondary,
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
    backgroundColor: zendapp.colors.primary,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: zendapp.colors.primary,
  },
  dayText: {
    fontSize: 13,
    fontWeight: '500',
    color: zendapp.colors.carbon,
  },
  dayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dayTextToday: {
    color: zendapp.colors.primary,
    fontWeight: '700',
  },
  manualInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#EAECF0',
  },
  manualInput: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingHorizontal: 12,
    height: 40,
    fontSize: 13,
    color: zendapp.colors.carbon,
  },
  manualApplyBtn: {
    backgroundColor: zendapp.colors.primary,
    paddingHorizontal: 14,
    borderRadius: 8,
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
  openCajasBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    padding: 10,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  openCajasBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  openCajasPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  openCajaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  openCajaPillActive: {
    backgroundColor: zendapp.colors.primary,
    borderColor: zendapp.colors.primary,
  },
  openCajaPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  openCajaPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  cancelModalText: {
    color: zendapp.colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  subTeamsBar: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    padding: 8,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  subTeamsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  subTeamsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  subTeamsScroll: {
    alignItems: 'center',
    gap: 6,
  },
  subTeamChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 6,
  },
  subTeamChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.primary,
  },
});
