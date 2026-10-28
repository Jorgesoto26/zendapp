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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../theme/appleTheme';
import { appAlert } from '../../components/AppAlert';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import { useAuth } from '../../context/AuthContext';
import { getCarteraSummary } from '../../services/adminService';
import { CarteraUserCard } from './components/CarteraUserCard';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

export default function AdminCartera() {
  const navigation = useNavigation();
  const { signOut } = useAuth();
  const [summary, setSummary] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await getCarteraSummary();
      setSummary(data || []);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudo cargar la cartera');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cartera</Text>
          <Text style={styles.headerSubtitle}>
            Saldos consolidados al corte
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerLogoutBtn}
          onPress={() => setShowLogout(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="sign-out" size={17} color={apple.colors.danger} />
        </TouchableOpacity>
      </View>

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
          <Text style={[styles.globalSubVal, { color: apple.colors.danger }]}>
            {formatMoney(totalVencido)}
          </Text>
        </View>
      </View>

      {/* Buscador de Vendedor (Requisito 3) */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={apple.colors.tertiaryLabel} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre de vendedor..."
          placeholderTextColor={apple.colors.tertiaryLabel}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Icon name="times-circle" size={14} color={apple.colors.tertiaryLabel} />
          </TouchableOpacity>
        )}
      </View>

      {/* Lista por Vendedores */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={apple.colors.blue} />
        </View>
      ) : (
        <FlatList
          data={filteredSummary}
          keyExtractor={(item) => String(item.usuario_id || item.id)}
          renderItem={({ item }) => (
            <CarteraUserCard item={item} onPress={handleSelectUser} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="briefcase" size={48} color={apple.colors.tertiaryLabel} />
              <Text style={styles.emptyTitle}>
                {search ? 'Sin coincidencias' : 'Sin créditos registrados'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search
                  ? `No se encontraron vendedores que coincidan con "${search}"`
                  : 'No hay cartera registrada en tus subordinados'}
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
    backgroundColor: apple.colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.m,
    paddingBottom: apple.spacing.xs,
  },
  headerLogoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFEBEA',
    justifyContent: 'center',
    alignItems: 'center',
    ...apple.shadow.subtle,
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
  globalCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: apple.radius.m,
    marginHorizontal: apple.spacing.l,
    marginTop: apple.spacing.m,
    marginBottom: apple.spacing.s,
    padding: apple.spacing.l,
    ...apple.shadow.elevated,
  },
  globalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  globalLabel: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  globalTotal: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
  },
  globalBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: apple.radius.pill,
  },
  globalBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  globalDivider: {
    height: 0.5,
    backgroundColor: '#38383A',
    marginVertical: 12,
  },
  globalSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  globalSubLabel: {
    fontSize: 13,
    color: '#AEAEC2',
  },
  globalSubVal: {
    fontSize: 14,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.s,
    marginHorizontal: apple.spacing.l,
    marginVertical: apple.spacing.s,
    paddingHorizontal: 12,
    height: 40,
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
  listContent: {
    paddingHorizontal: apple.spacing.l,
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
  },
});
