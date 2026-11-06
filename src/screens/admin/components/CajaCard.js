// src/screens/admin/components/CajaCard.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../../../theme/zendappTheme';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

const formatFechaApertura = (dateStr) => {
  if (!dateStr) return 'Sin fecha registrada';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Fecha inválida';
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
  } catch {
    return dateStr;
  }
};

export const CajaCard = ({ caja, isMyCaja = false, onPress, onNavigateHierarchy }) => {
  const isOpen = caja.estado === 'abierta';
  const isAdmin = caja.rol_usuario === 'admin' || caja.rol_usuario === 'superadmin';
  const hasTeam = !isMyCaja && Boolean(isAdmin || caja.tiene_subordinados);
  const progreso = parseFloat(caja.progreso_visitas) || 0;
  const retirosGastos = (parseFloat(caja.valor_retiros) || 0) + (parseFloat(caja.valor_gastos) || 0);

  return (
    <TouchableOpacity
      style={[styles.card, isMyCaja && styles.myCajaCard]}
      activeOpacity={0.8}
      onPress={() => onPress(caja)}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleCol}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.avatarBadge, isAdmin ? styles.avatarAdmin : styles.avatarVendedor]}>
              <Icon name={isAdmin ? 'shield' : 'user'} size={14} color={isAdmin ? '#5856D6' : zendapp.colors.primary} />
            </View>
            <View style={{ marginLeft: 8, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.userName} numberOfLines={1}>
                  {caja.nombre_usuario} {isMyCaja ? '(Mi Caja)' : ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                <Text style={styles.roleText}>{caja.rol_usuario?.toUpperCase()}</Text>
                {hasTeam ? (
                  <View style={styles.teamBadge}>
                    <Icon name="users" size={10} color={zendapp.colors.carbon} style={{ marginRight: 3 }} />
                    <Text style={styles.teamBadgeText}>
                      {caja.cantidad_subordinados || 0} a cargo
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        {/* Estado badge */}
        <View style={[styles.statusBadge, isOpen ? styles.statusBadgeOpen : styles.statusBadgeClosed]}>
          <View style={[styles.statusDot, { backgroundColor: isOpen ? zendapp.colors.success : zendapp.colors.danger }]} />
          <Text style={[styles.statusText, { color: isOpen ? zendapp.colors.success : zendapp.colors.danger }]}>
            {isOpen ? 'ABIERTA' : 'CERRADA'}
          </Text>
        </View>
      </View>

      {/* Botón Explorar Cajas del Equipo Subordinado */}
      {hasTeam && (
        <TouchableOpacity
          style={styles.btnHierarchy}
          onPress={() => onNavigateHierarchy && onNavigateHierarchy(caja)}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <View style={styles.hierarchyIconCircle}>
              <Icon name="sitemap" size={12} color={zendapp.colors.primary} />
            </View>
            <View style={{ marginLeft: 8, flex: 1 }}>
              <Text style={styles.hierarchyTitle}>Ver cajas del equipo</Text>
              <Text style={styles.hierarchySubtitle}>
                {caja.cantidad_subordinados > 0
                  ? `${caja.cantidad_subordinados} usuario${caja.cantidad_subordinados > 1 ? 's' : ''} a cargo`
                  : 'Equipo subordinado'}
              </Text>
            </View>
          </View>
          <View style={styles.hierarchyArrow}>
            <Text style={styles.hierarchyActionText}>Explorar</Text>
            <Icon name="chevron-right" size={10} color={zendapp.colors.primary} style={{ marginLeft: 4 }} />
          </View>
        </TouchableOpacity>
      )}

      {/* Fecha de apertura */}
      <View style={styles.fechaRow}>
        <Icon name="calendar-check-o" size={11} color={zendapp.colors.textSecondary} style={{ marginRight: 5 }} />
        <Text style={styles.fechaText}>
          Apertura: <Text style={styles.fechaBold}>{formatFechaApertura(caja.fecha_apertura)}</Text>
        </Text>
      </View>

      {/* Para vendedores: Barra de progreso de visitas */}
      {!isAdmin && (
        <View style={styles.progressContainer}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Progreso de cobro</Text>
            <Text style={styles.progressVal}>{progreso}%</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${Math.min(progreso, 100)}%` }]} />
          </View>
        </View>
      )}

      <View style={styles.divider} />

      {/* Grid de saldos */}
      <View style={styles.grid}>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Saldo Inicial</Text>
          <Text style={styles.gridVal}>{formatMoney(caja.saldo_inicial)}</Text>
        </View>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>{isOpen ? 'Saldo Actual' : 'Saldo Final'}</Text>
          <Text style={[styles.gridVal, { color: zendapp.colors.carbon }]}>
            {formatMoney(caja.saldo_final)}
          </Text>
        </View>
      </View>

      {/* Métricas específicas según Rol (Requisito 6) */}
      {isAdmin ? (
        /* Tarjeta Administrador: Solo conceptos financieros pertinentes */
        <View style={[styles.grid, { marginTop: 6 }]}>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Ingresos</Text>
            <Text style={[styles.gridVal, { color: zendapp.colors.success }]}>
              {formatMoney(caja.valor_ingresos)}
            </Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Retiros / Gastos</Text>
            <Text style={[styles.gridVal, { color: zendapp.colors.danger }]}>
              {formatMoney(retirosGastos)}
            </Text>
          </View>
        </View>
      ) : (
        /* Tarjeta Vendedor: Métricas operativas de cobranza y ruta */
        <>
          <View style={[styles.grid, { marginTop: 6 }]}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Debido Cobrar</Text>
              <Text style={styles.gridVal}>{formatMoney(caja.valor_debido_cobrar)}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Recaudado</Text>
              <Text style={[styles.gridVal, { color: zendapp.colors.success }]}>
                {formatMoney(caja.valor_recaudado)}
              </Text>
            </View>
          </View>

          <View style={[styles.grid, { marginTop: 6 }]}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Ventas</Text>
              <Text style={styles.gridVal}>{formatMoney(caja.valor_ventas)}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>Gastos</Text>
              <Text style={[styles.gridVal, { color: zendapp.colors.danger }]}>
                {formatMoney(caja.valor_gastos)}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Footer stats */}
      <View style={styles.footerRow}>
        {isAdmin ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="shield" size={12} color="#5856D6" />
            <Text style={[styles.footerStat, { color: '#5856D6', fontWeight: '700' }]}>
              Caja Administrativa
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.footerStat}>
              Clientes: <Text style={{ fontWeight: '700', color: zendapp.colors.carbon }}>{caja.total_clientes || 0}</Text>
            </Text>
            <Text style={styles.footerStat}>
              No Pagos: <Text style={{ fontWeight: '700', color: zendapp.colors.danger }}>{caja.cantidad_nopagos || 0}</Text>
            </Text>
          </>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.verMovText}>Movimientos{caja.total_movimientos != null ? ` (${caja.total_movimientos})` : ''}</Text>
          <Icon name="chevron-right" size={11} color={zendapp.colors.primary} style={{ marginLeft: 5 }} />
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
    overflow: 'hidden',
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
  myCajaCard: {
    borderWidth: 1.5,
    borderColor: zendapp.colors.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleCol: {
    flex: 1,
  },
  avatarBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarVendedor: {
    backgroundColor: '#FEECEC',
  },
  avatarAdmin: {
    backgroundColor: '#F0EFFF',
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    color: zendapp.colors.textSecondary,
    letterSpacing: 0.5,
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeOpen: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statusBadgeClosed: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  fechaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  fechaText: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
  },
  fechaBold: {
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  progressContainer: {
    marginTop: 2,
    marginBottom: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: zendapp.colors.textSecondary,
  },
  progressVal: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#F1F3F7',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: zendapp.colors.success,
    borderRadius: 3,
  },
  divider: {
    height: 1,
    backgroundColor: '#EAECF0',
    marginVertical: 10,
  },
  grid: {
    flexDirection: 'row',
    gap: 8,
  },
  gridItem: {
    flex: 1,
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
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  gridVal: {
    fontSize: 13,
    fontWeight: '700',
    color: zendapp.colors.carbon,
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EAECF0',
  },
  footerStat: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
  },
  verMovText: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.primary,
  },
  teamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F3F7',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  teamBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  btnHierarchy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 8,
    marginBottom: 2,
  },
  hierarchyIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FEECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hierarchyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  hierarchySubtitle: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
    marginTop: 1,
  },
  hierarchyArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  hierarchyActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.primary,
  },
});
