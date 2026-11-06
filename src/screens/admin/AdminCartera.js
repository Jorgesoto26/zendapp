import AppBackground from '../../components/AppBackground';
// src/screens/admin/AdminCartera.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
  BackHandler,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../../theme/zendappTheme';
import { appAlert } from '../../components/AppAlert';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import { SkeletonList, SkeletonCarteraCard } from '../../components/Skeleton';
import { useAuth } from '../../context/AuthContext';
import { getCarteraSummary } from '../../services/adminService';
import { CarteraUserCard } from './components/CarteraUserCard';
import { HierarchyBreadcrumb } from './components/HierarchyBreadcrumb';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

export default function AdminCartera() {
  const navigation = useNavigation();
  const { userId, signOut } = useAuth();
  const [hierarchyStack, setHierarchyStack] = useState([{ id: userId, name: 'Mi Cartera' }]);
  const [summary, setSummary] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  useEffect(() => {
    if (userId) {
      setHierarchyStack((prev) => (prev.length === 0 ? [{ id: userId, name: 'Mi Cartera' }] : prev));
    }
  }, [userId]);

  const currentParent = hierarchyStack[hierarchyStack.length - 1];

  const handleLogout = useCallback(() => {
    setShowLogout(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (hierarchyStack.length > 1) {
          setHierarchyStack((prev) => prev.slice(0, -1));
          return true;
        }
        handleLogout();
        return true;
      });
      return () => sub.remove();
    }, [handleLogout, hierarchyStack.length])
  );

  const loadData = useCallback(async () => {
    try {
      const targetParentId = hierarchyStack.length > 1 ? hierarchyStack[hierarchyStack.length - 1].id : null;
      const data = await getCarteraSummary(targetParentId);
      setSummary(data || []);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudo cargar la cartera');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hierarchyStack]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleNavigateHierarchy = (subAdmin) => {
    setLoading(true);
    setHierarchyStack((prev) => [
      ...prev,
      {
        id: subAdmin.usuario_id || subAdmin.id,
        name: `${subAdmin.nombre || ''} ${subAdmin.apellido || ''}`.trim() || 'Administrador',
      },
    ]);
  };

  const handlePopHierarchy = (targetIndex) => {
    setLoading(true);
    setHierarchyStack((prev) => prev.slice(0, targetIndex + 1));
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const totalCreditos = summary.reduce((acc, curr) => acc + (parseInt(curr.total_creditos, 10) || 0), 0);
  const totalSaldo = summary.reduce((acc, curr) => acc + (parseFloat(curr.saldo_total) || 0), 0);
  const totalVencido = summary.reduce((acc, curr) => acc + (parseFloat(curr.saldo_vencido) || 0), 0);

  const filteredSummary = useMemo(() => {
    if (!search.trim()) return summary;
    const q = search.toLowerCase();
    return summary.filter(
      (item) =>
        item.nombre?.toLowerCase().includes(q) ||
        item.apellido?.toLowerCase().includes(q) ||
        `${item.nombre || ''} ${item.apellido || ''}`.toLowerCase().includes(q)
    );
  }, [search, summary]);

  const handleSelectUser = (user) => {
    navigation.navigate('AdminCarteraDetalle', { user });
  };

  return (
    <SafeAreaView style={styles.root}>
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cartera</Text>
          <Text style={styles.headerSubtitle}>
            {hierarchyStack.length > 1 ? `Equipo: ${currentParent?.name || ''} · ` : ''}
            Saldos consolidados al corte
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

      {/* Breadcrumb de Navegación Jerárquica */}
      <HierarchyBreadcrumb
        stack={hierarchyStack}
        onPop={handlePopHierarchy}
        rootTitle="Mi Cartera"
      />

      {/* Global Summary Card */}
      <View style={styles.globalCard}>
        <View style={styles.globalRow}>
          <View>
            <Text style={styles.globalLabel}>Saldo Total Cartera</Text>
            <Text style={styles.globalTotal}>{formatMoney(totalSaldo)}</Text>
          </View>
          <View style={styles.globalBadge}>
            <Text style={styles.globalBadgeText}>{totalCreditos} créditos</Text>
          </View>
        </View>

        <View style={styles.globalDivider} />

        <View style={styles.globalSubRow}>
          <Text style={styles.globalSubLabel}>Total Vencido en Mora:</Text>
          <Text style={[styles.globalSubVal, { color: '#F87171' }]}>
            {formatMoney(totalVencido)}
          </Text>
        </View>
      </View>

      {/* Buscador de Vendedor (Requisito 3) */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={zendapp.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre de usuario..."
          placeholderTextColor={zendapp.colors.textMuted}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Icon name="times-circle" size={14} color={zendapp.colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Lista por Vendedores */}
        {loading ? (
          <View style={{ flex: 1, paddingTop: 10 }}>
            <SkeletonList count={5} Component={SkeletonCarteraCard} />
          </View>
        ) : (
        <FlatList
          data={filteredSummary}
          keyExtractor={(item) => String(item.usuario_id || item.id)}
          renderItem={({ item }) => (
            <CarteraUserCard
              item={item}
              onPress={handleSelectUser}
              onNavigateHierarchy={handleNavigateHierarchy}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={zendapp.colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="briefcase" size={44} color={zendapp.colors.border} />
              <Text style={styles.emptyTitle}>
                {search ? 'Sin coincidencias' : 'Sin créditos registrados'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search
                  ? `No se encontraron usuarios que coincidan con "${search}"`
                  : 'No hay cartera registrada en este nivel jerárquico'}
              </Text>
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
  globalCard: {
    backgroundColor: zendapp.colors.carbon,
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2D2D2E',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  globalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  globalLabel: {
    fontSize: 11,
    color: '#98A2B3',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  globalTotal: {
    fontSize: 25,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
  },
  globalBadge: {
    backgroundColor: 'rgba(238, 39, 45, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(238, 39, 45, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  globalBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  globalDivider: {
    height: 1,
    backgroundColor: '#2D2D2E',
    marginVertical: 12,
  },
  globalSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  globalSubLabel: {
    fontSize: 13,
    color: '#98A2B3',
  },
  globalSubVal: {
    fontSize: 14,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    marginHorizontal: 16,
    marginVertical: 8,
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
