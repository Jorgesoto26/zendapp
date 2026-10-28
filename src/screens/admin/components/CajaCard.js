// src/screens/admin/components/CajaCard.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../../theme/appleTheme';

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

export const CajaCard = ({ caja, isMyCaja = false, onPress }) => {
  const isOpen = caja.estado === 'abierta';
  const isAdmin = caja.rol_usuario === 'admin' || caja.rol_usuario === 'superadmin';
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
              <Icon name={isAdmin ? 'shield' : 'user'} size={14} color={isAdmin ? '#5856D6' : apple.colors.blue} />
            </View>
            <View style={{ marginLeft: 8, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.userName} numberOfLines={1}>
                  {caja.nombre_usuario} {isMyCaja ? '(Mi Caja)' : ''}
                </Text>
              </View>
              <Text style={styles.roleText}>{caja.rol_usuario?.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Estado badge */}
        <View style={[styles.statusBadge, isOpen ? styles.statusBadgeOpen : styles.statusBadgeClosed]}>
          <View style={[styles.statusDot, { backgroundColor: isOpen ? apple.colors.success : apple.colors.danger }]} />
          <Text style={[styles.statusText, { color: isOpen ? apple.colors.success : apple.colors.danger }]}>
            {isOpen ? 'ABIERTA' : 'CERRADA'}
          </Text>
        </View>
      </View>

      {/* Fecha de apertura */}
      <View style={styles.fechaRow}>
        <Icon name="calendar-check-o" size={11} color={apple.colors.secondaryLabel} style={{ marginRight: 5 }} />
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
          <Text style={[styles.gridVal, { color: apple.colors.blue }]}>
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
            <Text style={[styles.gridVal, { color: apple.colors.success }]}>
              {formatMoney(caja.valor_ingresos)}
            </Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Retiros / Gastos</Text>
            <Text style={[styles.gridVal, { color: apple.colors.danger }]}>
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
              <Text style={[styles.gridVal, { color: apple.colors.success }]}>
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
              <Text style={[styles.gridVal, { color: apple.colors.danger }]}>
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
              Clientes: <Text style={{ fontWeight: '700', color: apple.colors.label }}>{caja.total_clientes || 0}</Text>
            </Text>
            <Text style={styles.footerStat}>
              No Pagos: <Text style={{ fontWeight: '700', color: apple.colors.danger }}>{caja.cantidad_nopagos || 0}</Text>
            </Text>
          </>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.verMovText}>Movimientos</Text>
          <Icon name="chevron-right" size={11} color={apple.colors.blue} style={{ marginLeft: 4 }} />
        </View>
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
  myCajaCard: {
    borderWidth: 1.5,
    borderColor: apple.colors.blue,
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
    backgroundColor: '#EBF5FF',
  },
  avatarAdmin: {
    backgroundColor: '#F3EEFD',
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: apple.colors.label,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    color: apple.colors.tertiaryLabel,
    letterSpacing: 0.5,
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: apple.radius.pill,
  },
  statusBadgeOpen: {
    backgroundColor: '#ECFDF5',
  },
  statusBadgeClosed: {
    backgroundColor: '#FEF2F2',
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
    color: apple.colors.secondaryLabel,
  },
  fechaBold: {
    fontWeight: '600',
    color: apple.colors.label,
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
    color: apple.colors.secondaryLabel,
  },
  progressVal: {
    fontSize: 11,
    fontWeight: '700',
    color: apple.colors.blue,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: apple.colors.fill,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: apple.colors.blue,
    borderRadius: 3,
  },
  divider: {
    height: 0.5,
    backgroundColor: apple.colors.separator,
    marginVertical: 10,
  },
  grid: {
    flexDirection: 'row',
    gap: 8,
  },
  gridItem: {
    flex: 1,
    backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.s,
    padding: 8,
  },
  gridLabel: {
    fontSize: 10,
    color: apple.colors.secondaryLabel,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  gridVal: {
    fontSize: 13,
    fontWeight: '700',
    color: apple.colors.label,
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: apple.colors.separator,
  },
  footerStat: {
    fontSize: 11,
    color: apple.colors.secondaryLabel,
  },
  verMovText: {
    fontSize: 11,
    fontWeight: '700',
    color: apple.colors.blue,
  },
});
