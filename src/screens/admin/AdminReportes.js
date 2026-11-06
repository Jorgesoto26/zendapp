import AppBackground from '../../components/AppBackground';
// src/screens/admin/AdminReportes.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Share,
  Alert,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../../theme/zendappTheme';
import { appAlert } from '../../components/AppAlert';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import AnimatedSegmentedControl from '../../components/AnimatedSegmentedControl';
import { SkeletonList, SkeletonCarteraCard } from '../../components/Skeleton';
import { useAuth } from '../../context/AuthContext';
import { getReporteConsolidado } from '../../services/adminService';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

const getTodayIso = () => {
  const d = new Date();
  return d.toISOString().split('T')[0];
};

const getFirstDayOfMonthIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
};

export default function AdminReportes() {
  const { signOut } = useAuth();
  const [fechaIni, setFechaIni] = useState(getFirstDayOfMonthIso());
  const [fechaFin, setFechaFin] = useState(getTodayIso());
  const [tipo, setTipo] = useState('consolidado'); // 'consolidado', 'gasto', 'movimiento'
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await getReporteConsolidado(fechaIni, fechaFin);
      setData(res);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudo generar el reporte');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fechaIni, fechaFin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleExport = async (user) => {
    const reportText = `
📊 REPORTE DE GESTIÓN ZENDA
=================================
Vendedor: ${user.nombre} ${user.apellido || ''} (${user.rol?.toUpperCase()})
Periodo: ${fechaIni} hasta ${fechaFin}
Tipo: ${tipo.toUpperCase()}
---------------------------------
💰 Recaudado:  ${formatMoney(user.total_recaudado)}
🛒 Ventas:      ${formatMoney(user.total_ventas)}
🏷️ Gastos:      ${formatMoney(user.total_gastos)}
📥 Ingresos:    ${formatMoney(user.total_ingresos)}
📤 Retiros:     ${formatMoney(user.total_retiros)}
🚫 No Pagos:    ${user.total_nopagos} clientes
💼 Cartera Hoy: ${formatMoney(user.saldo_cartera_actual)}
=================================
Generado el: ${new Date().toLocaleString('es-CO')}
`;

    try {
      await Share.share({
        title: `Reporte ${user.nombre} (${fechaIni} - ${fechaFin})`,
        message: reportText,
      });
    } catch (err) {
      appAlert('Error', err.message);
    }
  };

  // Totales generales
  const totalRecaudado = data.reduce((acc, curr) => acc + (parseFloat(curr.total_recaudado) || 0), 0);
  const totalVentas = data.reduce((acc, curr) => acc + (parseFloat(curr.total_ventas) || 0), 0);
  const totalGastos = data.reduce((acc, curr) => acc + (parseFloat(curr.total_gastos) || 0), 0);

  return (
    <SafeAreaView style={styles.root}>
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Reportes</Text>
          <Text style={styles.headerSubtitle}>
            Consolidado por periodo y vendedor
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerLogoutBtn}
          onPress={() => setShowLogout(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="sign-out" size={16} color={zendapp.colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Selector de Tipo */}
        <View style={{ marginHorizontal: 16, marginVertical: 6 }}>
          <AnimatedSegmentedControl
            options={[
              { key: 'consolidado', label: 'Consolidado' },
              { key: 'gasto', label: 'Gastos' },
              { key: 'movimiento', label: 'Movimientos' },
            ]}
            selectedKey={tipo}
            onChange={(key) => setTipo(key)}
          />
        </View>

      {/* Rango de Fechas */}
      <View style={styles.dateBar}>
        <Icon name="calendar" size={14} color={zendapp.colors.primary} />
        <Text style={styles.dateText}>
          {fechaIni} al {fechaFin}
        </Text>
      </View>

      {/* Resumen Global */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Recaudado</Text>
          <Text style={[styles.summaryVal, { color: zendapp.colors.success }]}>
            {formatMoney(totalRecaudado)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Ventas</Text>
          <Text style={[styles.summaryVal, { color: zendapp.colors.carbon }]}>
            {formatMoney(totalVentas)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Gastos</Text>
          <Text style={[styles.summaryVal, { color: zendapp.colors.danger }]}>
            {formatMoney(totalGastos)}
          </Text>
        </View>
      </View>

      {/* Lista de Vendedores */}
        {loading ? (
          <View style={{ flex: 1, paddingTop: 10 }}>
            <SkeletonList count={4} Component={SkeletonCarteraCard} />
          </View>
        ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.usuario_id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.userName}>
                    {item.nombre} {item.apellido || ''}
                  </Text>
                  <Text style={styles.userRole}>{item.rol?.toUpperCase()}</Text>
                </View>
                <TouchableOpacity
                  style={styles.btnExport}
                  onPress={() => handleExport(item)}
                >
                  <Icon name="file-pdf-o" size={12} color={zendapp.colors.primary} />
                  <Text style={styles.btnExportText}>Exportar</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.divider} />

              <View style={styles.grid}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Recaudado</Text>
                  <Text style={[styles.gridVal, { color: zendapp.colors.success }]}>
                    {formatMoney(item.total_recaudado)}
                  </Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Ventas</Text>
                  <Text style={styles.gridVal}>{formatMoney(item.total_ventas)}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Gastos</Text>
                  <Text style={[styles.gridVal, { color: zendapp.colors.danger }]}>
                    {formatMoney(item.total_gastos)}
                  </Text>
                </View>
              </View>

              <View style={[styles.grid, { marginTop: 6 }]}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Ingresos</Text>
                  <Text style={styles.gridVal}>{formatMoney(item.total_ingresos)}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Retiros</Text>
                  <Text style={styles.gridVal}>{formatMoney(item.total_retiros)}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>No Pagos</Text>
                  <Text style={styles.gridVal}>{item.total_nopagos}</Text>
                </View>
              </View>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={zendapp.colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="bar-chart" size={44} color={zendapp.colors.border} />
              <Text style={styles.emptyTitle}>Sin datos</Text>
              <Text style={styles.emptySubtitle}>No hay información para el rango de fechas seleccionado</Text>
            </View>
          }
        />
      )}
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
  typeSelector: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 6,
    backgroundColor: '#F1F3F7',
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  typeBtnActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  typeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: zendapp.colors.textSecondary,
  },
  typeBtnTextActive: {
    color: zendapp.colors.carbon,
    fontWeight: '700',
  },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  dateText: {
    fontSize: 13,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EAECF0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#EAECF0',
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: zendapp.colors.textSecondary,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  summaryVal: {
    fontSize: 14,
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  userRole: {
    fontSize: 10,
    fontWeight: '700',
    color: zendapp.colors.textSecondary,
    marginTop: 1,
  },
  btnExport: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEECEC',
    borderWidth: 1,
    borderColor: '#FECACA',
    gap: 5,
  },
  btnExportText: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: '#EAECF0',
    marginVertical: 10,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  gridItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EAECF0',
    padding: 8,
  },
  gridLabel: {
    fontSize: 10,
    color: zendapp.colors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  gridVal: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.carbon,
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
  },
});
