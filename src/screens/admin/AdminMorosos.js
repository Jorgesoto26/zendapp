import AppBackground from '../../components/AppBackground';
// src/screens/admin/AdminMorosos.js
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
  Alert,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../../theme/zendappTheme';
import { SkeletonList, SkeletonCarteraCard } from '../../components/Skeleton';
import { appAlert } from '../../components/AppAlert';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import { useAuth } from '../../context/AuthContext';
import { getAdminMorosos, castigarCartera } from '../../services/adminService';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

const formatDate = (isoStr) => {
  if (!isoStr) return 'Sin pagos';
  const parts = isoStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return isoStr;
};

export default function AdminMorosos() {
  const navigation = useNavigation();
  const { signOut } = useAuth();
  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await getAdminMorosos(50);
      setItems(data);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar los morosos');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(items);
    } else {
      const q = search.toLowerCase();
      setFiltered(
        items.filter(
          (i) =>
            i.nombre_cliente?.toLowerCase().includes(q) ||
            i.apellido_cliente?.toLowerCase().includes(q) ||
            i.nombre_vendedor?.toLowerCase().includes(q)
        )
      );
    }
  }, [search, items]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleCastigar = (item) => {
    Alert.alert(
      'Castigar Cartera',
      `¿Deseas castigar el crédito de ${item.nombre_cliente}? Se suspenderán visitas y se bloquearán futuros créditos.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Castigar',
          style: 'destructive',
          onPress: async () => {
            try {
              await castigarCartera(item.invoice_id);
              appAlert('Éxito', 'Crédito castigado');
              loadData();
            } catch (err) {
              appAlert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  const handleOpenCredit = (item) => {
    navigation.navigate('CreditDetail', { invoiceId: item.invoice_id });
  };

  const totalVencido = items.reduce((acc, curr) => acc + (parseFloat(curr.saldo_vencido) || 0), 0);

  return (
    <SafeAreaView style={styles.root}>
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cartera Morosa</Text>
          <Text style={styles.headerSubtitle}>
            Top 50 clientes con mayor mora
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.badgeTop}>
            <Text style={styles.badgeTopText}>{items.length} en mora</Text>
          </View>
          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={() => setShowLogout(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="sign-out" size={16} color={zendapp.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Banner Total Vencido */}
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <Icon name="exclamation-triangle" size={18} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.bannerLabel}>Total Vencido en Mora</Text>
          <Text style={styles.bannerVal}>{formatMoney(totalVencido)}</Text>
        </View>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={zendapp.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por cliente o vendedor..."
          placeholderTextColor={zendapp.colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Icon name="times-circle" size={14} color={zendapp.colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Lista de Morosos */}
        {loading ? (
          <View style={{ flex: 1, paddingTop: 10 }}>
            <SkeletonList count={5} Component={SkeletonCarteraCard} />
          </View>
        ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.invoice_id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName} numberOfLines={1}>
                    {item.nombre_cliente} {item.apellido_cliente || ''}
                  </Text>
                  <Text style={styles.vendedorText}>
                    Vendedor: <Text style={{ fontWeight: '600', color: zendapp.colors.carbon }}>{item.nombre_vendedor}</Text>
                  </Text>
                </View>
                <View style={styles.moraWrap}>
                  <Text style={styles.moraVal}>{formatMoney(item.saldo_vencido)}</Text>
                  <Text style={styles.moraLabel}>Mora Vencida</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.grid}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Saldo Total</Text>
                  <Text style={styles.gridVal}>{formatMoney(item.saldo)}</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Cuotas Vencidas</Text>
                  <Text style={[styles.gridVal, { color: zendapp.colors.danger }]}>
                    {item.cuotas_vencidas} de {item.cuotas_totales}
                  </Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Último Pago</Text>
                  <Text style={styles.gridVal}>{formatDate(item.fecha_ultimo_pago)}</Text>
                </View>
              </View>

              {/* Botones */}
              <View style={styles.cardFooter}>
                <TouchableOpacity
                  style={styles.btnCastigar}
                  onPress={() => handleCastigar(item)}
                >
                  <Icon name="ban" size={12} color={zendapp.colors.primary} />
                  <Text style={styles.btnCastigarText}>Castigar Cartera</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.btnVer}
                  onPress={() => handleOpenCredit(item)}
                >
                  <Text style={styles.btnVerText}>Ver Crédito</Text>
                  <Icon name="arrow-right" size={12} color={zendapp.colors.primary} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              </View>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={zendapp.colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="check-circle" size={48} color={zendapp.colors.success} />
              <Text style={styles.emptyTitle}>Excelente: sin cartera morosa</Text>
              <Text style={styles.emptySubtitle}>No se registran créditos con cuotas vencidas</Text>
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
  badgeTop: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  badgeTopText: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.primary,
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: zendapp.colors.primary,
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 10,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: zendapp.colors.primary,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  bannerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bannerVal: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
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
    alignItems: 'flex-start',
  },
  clientName: {
    fontSize: 15,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  vendedorText: {
    fontSize: 12,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  moraWrap: {
    alignItems: 'flex-end',
  },
  moraVal: {
    fontSize: 16,
    fontWeight: '800',
    color: zendapp.colors.primary,
  },
  moraLabel: {
    fontSize: 10,
    color: zendapp.colors.textSecondary,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#EAECF0',
    marginVertical: 10,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    padding: 10,
  },
  gridItem: {
    flex: 1,
    alignItems: 'center',
  },
  gridLabel: {
    fontSize: 10,
    color: zendapp.colors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
  },
  gridVal: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EAECF0',
  },
  btnCastigar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  btnCastigarText: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.primary,
    marginLeft: 5,
  },
  btnVer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  btnVerText: {
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
    textAlign: 'center',
  },
});
