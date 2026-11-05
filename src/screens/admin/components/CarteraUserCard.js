// src/screens/admin/components/CarteraUserCard.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../../theme/appleTheme';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

export const CarteraUserCard = ({ item, onPress, onNavigateHierarchy }) => {
  const isAdmin = item.rol === 'admin';
  const isActive = item.activo !== false;
  const hasTeam = Boolean(isAdmin || item.tiene_subordinados);

  const handleCardPress = () => {
    // Si es admin con subordinados y no tiene créditos propios directos, navegar directo a la jerarquía
    if (hasTeam && (!item.total_creditos || parseInt(item.total_creditos, 10) === 0)) {
      if (onNavigateHierarchy) {
        onNavigateHierarchy(item);
        return;
      }
    }
    if (onPress) {
      onPress(item);
    }
  };

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={handleCardPress}>
      {/* Cabecera */}
      <View style={styles.header}>
        <View style={styles.userTitleRow}>
          <View style={[styles.avatarBadge, isAdmin ? styles.avatarAdmin : styles.avatarVendedor]}>
            <Icon name={isAdmin ? 'shield' : 'user'} size={15} color={isAdmin ? '#5856D6' : apple.colors.blue} />
          </View>
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {item.nombre} {item.apellido || ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
              <View style={[styles.badge, isAdmin ? styles.badgeAdmin : styles.badgeVendedor]}>
                <Text style={[styles.badgeText, isAdmin ? styles.badgeTextAdmin : styles.badgeTextVendedor]}>
                  {item.rol?.toUpperCase()}
                </Text>
              </View>
              {hasTeam ? (
                <View style={styles.teamBadge}>
                  <Icon name="users" size={10} color="#5856D6" style={{ marginRight: 3 }} />
                  <Text style={styles.teamBadgeText}>
                    {item.cantidad_subordinados || 0} a cargo
                  </Text>
                </View>
              ) : null}
              <Text style={styles.creditsCount}>
                {item.total_creditos || 0} créditos
              </Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.statusDot, { backgroundColor: isActive ? apple.colors.success : apple.colors.danger }]} />
          <Icon name="chevron-right" size={13} color={apple.colors.tertiaryLabel} style={{ marginLeft: 10 }} />
        </View>
      </View>

      {/* Botón Explorar Cartera del Equipo Subordinado */}
      {hasTeam && (
        <TouchableOpacity
          style={styles.btnHierarchy}
          onPress={() => onNavigateHierarchy && onNavigateHierarchy(item)}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <View style={styles.hierarchyIconCircle}>
              <Icon name="sitemap" size={12} color="#5856D6" />
            </View>
            <View style={{ marginLeft: 8, flex: 1 }}>
              <Text style={styles.hierarchyTitle}>Ver cartera del equipo</Text>
              <Text style={styles.hierarchySubtitle}>
                {item.cantidad_subordinados > 0
                  ? `${item.cantidad_subordinados} usuario${item.cantidad_subordinados > 1 ? 's' : ''} a cargo`
                  : 'Sin usuarios asignados'}
              </Text>
            </View>
          </View>
          <View style={styles.hierarchyArrow}>
            <Text style={styles.hierarchyActionText}>Explorar</Text>
            <Icon name="chevron-right" size={11} color="#5856D6" style={{ marginLeft: 4 }} />
          </View>
        </TouchableOpacity>
      )}

      <View style={styles.divider} />

      {/* Métricas de Cartera */}
      <View style={styles.metricRow}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Clientes con Saldo</Text>
          <Text style={styles.metricVal}>{item.clientes_con_saldo || 0}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Cuota Periódica</Text>
          <Text style={[styles.metricVal, { color: apple.colors.blue }]}>
            {formatMoney(item.valor_cuota_periodica)}
          </Text>
        </View>
      </View>

      <View style={[styles.metricRow, { marginTop: 8 }]}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Saldo Vencido</Text>
          <Text style={[styles.metricVal, { color: apple.colors.danger }]}>
            {formatMoney(item.saldo_vencido)}
          </Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Total Cartera</Text>
          <Text style={styles.metricVal}>{formatMoney(item.valor_total_cartera)}</Text>
        </View>
      </View>

      <View style={styles.totalBanner}>
        <Text style={styles.totalBannerLabel}>Saldo Total por Cobrar:</Text>
        <Text style={styles.totalBannerVal}>{formatMoney(item.saldo_total)}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.m,
    padding: apple.spacing.m,
    marginBottom: apple.spacing.m,
    ...apple.shadow.card,
    ...apple.border.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarAdmin: {
    backgroundColor: '#F0EFFF',
  },
  avatarVendedor: {
    backgroundColor: apple.colors.blueLight,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: apple.colors.label,
  },
  creditsCount: {
    fontSize: 12,
    color: apple.colors.secondaryLabel,
    marginLeft: 8,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeAdmin: {
    backgroundColor: '#F0EFFF',
  },
  badgeVendedor: {
    backgroundColor: apple.colors.blueLight,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  badgeTextAdmin: {
    color: '#5856D6',
  },
  badgeTextVendedor: {
    color: apple.colors.blue,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  divider: {
    height: 0.5,
    backgroundColor: apple.colors.separator,
    marginVertical: 10,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricItem: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    color: apple.colors.secondaryLabel,
    marginBottom: 2,
  },
  metricVal: {
    fontSize: 13,
    fontWeight: '700',
    color: apple.colors.label,
  },
  totalBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.s,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  totalBannerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  totalBannerVal: {
    fontSize: 14,
    fontWeight: '800',
    color: apple.colors.label,
  },
  teamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0EFFF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  teamBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5856D6',
  },
  btnHierarchy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8F8FD',
    borderWidth: 1,
    borderColor: '#E4E2F8',
    borderRadius: apple.radius.s,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  hierarchyIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EAE8FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hierarchyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3B3988',
  },
  hierarchySubtitle: {
    fontSize: 11,
    color: apple.colors.secondaryLabel,
    marginTop: 1,
  },
  hierarchyArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D4D2F2',
  },
  hierarchyActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5856D6',
  },
});
