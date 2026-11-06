import AppBackground from '../../components/AppBackground';
// src/screens/admin/AdminCajaDetalle.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Modal,
  ScrollView,
  Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../../theme/zendappTheme';
import { appAlert } from '../../components/AppAlert';
import {
  getCajaMovements,
  createAdminCajaMovement,
  getSubordinateOpenCajas,
  reabrirCajaAdmin,
} from '../../services/adminService';
import { formatMoneyInput, parseMoneyToNumeric } from '../../utils/utilities';
import { eventBus, EVENTS } from '../../utils/eventBus';
import { supabase } from '../../lib/supabase';
import EvidencePreviewModal from '../../components/EvidencePreviewModal';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

const formatDate = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function AdminCajaDetalle() {
  const route = useRoute();
  const navigation = useNavigation();
  const { caja } = route.params || {};
  const [cajaState, setCajaState] = useState(caja || {});
  const [reopening, setReopening] = useState(false);

  const [movements, setMovements] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal nuevo movimiento
  const [modalVisible, setModalVisible] = useState(false);
  const [movTipo, setMovTipo] = useState('gasto');
  const [movDesc, setMovDesc] = useState('');
  const [movMonto, setMovMonto] = useState('');
  const [savingMov, setSavingMov] = useState(false);
  const [closing, setClosing] = useState(false);

  // Visor de evidencias multimedia
  const [evidenceModalVisible, setEvidenceModalVisible] = useState(false);
  const [evidenceUri, setEvidenceUri] = useState(null);
  const [evidenceTitle, setEvidenceTitle] = useState('Evidencia');

  // Subordinados abiertos (Requisito 7)
  const [subModalVisible, setSubModalVisible] = useState(false);
  const [openSubordinates, setOpenSubordinates] = useState([]);
  const [checkingSubs, setCheckingSubs] = useState(false);

  const isOpen = cajaState?.estado === 'abierta';
  const isAdmin = cajaState?.rol_usuario === 'admin' || cajaState?.rol_usuario === 'superadmin';

  // Tipos de movimiento según rol de la caja (Requisito 6)
  const types = useMemo(() => {
    if (isAdmin) {
      return [
        { key: 'todos', label: 'Todos' },
        { key: 'ingreso', label: 'Ingresos' },
        { key: 'retiro', label: 'Retiros' },
        { key: 'gasto', label: 'Gastos' },
      ];
    }
    return [
      { key: 'todos', label: 'Todos' },
      { key: 'pago', label: 'Pagos' },
      { key: 'venta', label: 'Ventas' },
      { key: 'gasto', label: 'Gastos' },
      { key: 'ingreso', label: 'Ingresos' },
      { key: 'retiro', label: 'Retiros' },
    ];
  }, [isAdmin]);

  // Conteo en vivo por cada tipo para enriquecer los chips
  const countsByType = useMemo(() => {
    const counts = { todos: movements.length };
    for (const m of movements) {
      const t = m.tipo;
      counts[t] = (counts[t] || 0) + 1;
      if (t === 'retiro' && m.descripcion?.toLowerCase().includes('gasto')) {
        counts.gasto = (counts.gasto || 0) + 1;
      }
    }
    return counts;
  }, [movements]);

  const loadData = useCallback(async () => {
    if (!caja?.caja_id && !caja?.id) return;
    const cajaId = caja.caja_id || caja.id;
    try {
      const data = await getCajaMovements(cajaId);
      const rawMovements = data || [];

      // Identificar ventas para enriquecer con cliente, interés, plazo y cuotas pagadas
      const invoiceIds = Array.from(
        new Set(
          rawMovements
            .filter((m) => m.tipo === 'venta')
            .map((m) => {
              const match = (m.descripcion || '').match(
                /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
              );
              return match ? match[0] : null;
            })
            .filter(Boolean)
        )
      );

      let invoicesMap = {};
      let cuotasMap = {};

      if (invoiceIds.length > 0) {
        try {
          const { data: invList } = await supabase
            .from('invoice')
            .select(`
              id,
              amount,
              saldo,
              capital_amount,
              periodicidad,
              num_cuotas,
              tasa_interes,
              client_id,
              clients (
                id,
                nombre,
                apellido,
                alias,
                documento,
                foto_documento_path
              )
            `)
            .in('id', invoiceIds);

          if (invList) {
            for (const inv of invList) {
              invoicesMap[inv.id] = inv;
            }
          }
        } catch (eInv) {
          console.log('Error obteniendo facturas enriquecidas:', eInv);
        }

        try {
          const { data: cuotasList } = await supabase
            .from('cuotas')
            .select('invoice_id, estado')
            .in('invoice_id', invoiceIds);

          if (cuotasList) {
            for (const c of cuotasList) {
              if (!cuotasMap[c.invoice_id]) {
                cuotasMap[c.invoice_id] = { total: 0, pagadas: 0 };
              }
              cuotasMap[c.invoice_id].total++;
              if (c.estado === 'pagada') {
                cuotasMap[c.invoice_id].pagadas++;
              }
            }
          }
        } catch (eCuotas) {
          console.log('Error obteniendo cuotas enriquecidas:', eCuotas);
        }
      }

      // Enriquecer cada movimiento de tipo venta
      const enriched = rawMovements.map((m) => {
        if (m.tipo !== 'venta') return m;

        const match = (m.descripcion || '').match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
        );
        const invId = match ? match[0] : null;
        if (!invId || !invoicesMap[invId]) {
          return {
            ...m,
            cleanTitle: 'Venta de Crédito',
            invoiceData: null,
          };
        }

        const inv = invoicesMap[invId];
        const cli = inv.clients;
        const clientName = [cli?.nombre, cli?.apellido].filter(Boolean).join(' ') || cli?.alias || 'Cliente';
        const clientAlias = cli?.alias ? ` (${cli.alias})` : '';
        const totalCuotas = Number(inv.num_cuotas) || cuotasMap[invId]?.total || 0;
        let pagadas = cuotasMap[invId]?.pagadas;
        if (pagadas == null) {
          const amt = Number(inv.amount) || 0;
          const sld = Number(inv.saldo) || 0;
          pagadas = amt > 0 && totalCuotas > 0 ? Math.max(0, Math.round(((amt - sld) / amt) * totalCuotas)) : 0;
        }

        return {
          ...m,
          cleanTitle: `Venta: ${clientName}${clientAlias}`,
          invoiceData: {
            id: inv.id,
            clientName: `${clientName}${clientAlias}`,
            documento: cli?.documento,
            tasa_interes: inv.tasa_interes != null ? `${inv.tasa_interes}%` : '20%',
            periodicidad: inv.periodicidad || 'diario',
            num_cuotas: totalCuotas,
            cuotasPagadas: pagadas,
            foto_documento_path: cli?.foto_documento_path || null,
          },
        };
      });

      setMovements(enriched);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar los movimientos');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [caja]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let list = movements;
    if (selectedType !== 'todos') {
      if (selectedType === 'gasto') {
        list = list.filter((m) => m.tipo === 'gasto' || (m.tipo === 'retiro' && m.descripcion?.toLowerCase().includes('gasto')));
      } else {
        list = list.filter((m) => m.tipo === selectedType);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.descripcion?.toLowerCase().includes(q) ||
          m.cleanTitle?.toLowerCase().includes(q) ||
          m.invoiceData?.clientName?.toLowerCase().includes(q) ||
          m.invoiceData?.documento?.includes(q)
      );
    }
    setFiltered(list);
  }, [search, selectedType, movements]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Requisito 7: Comprobar cajas de subordinados antes de cerrar caja de admin
  const handleCerrarCaja = async () => {
    const cajaId = caja.caja_id || caja.id;
    const targetUserId = caja.usuario_id;

    if (isAdmin) {
      setCheckingSubs(true);
      try {
        const subs = await getSubordinateOpenCajas(targetUserId);
        if (subs && subs.length > 0) {
          setOpenSubordinates(subs);
          setSubModalVisible(true);
          return;
        }
      } catch (e) {
        console.log('Error comprobando subordinados:', e);
      } finally {
        setCheckingSubs(false);
      }
    }

    promptConfirmClose(cajaId);
  };

  const promptConfirmClose = (cajaId) => {
    appAlert(
      'Cerrar caja',
      `¿Deseas cerrar la caja de ${caja.nombre_usuario || 'este usuario'}? Se validará en el servidor y se calculará el saldo final definitivo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar caja',
          style: 'destructive',
          onPress: () => executeClose(cajaId),
        },
      ]
    );
  };

  const executeClose = async (cajaId) => {
    setClosing(true);
    try {
      const { cerrarCaja } = require('../../services/cajaService');
      const res = await cerrarCaja(cajaId);
      setCajaState(prev => ({
        ...prev,
        estado: 'cerrada',
        fecha_cierre: res?.fecha_cierre || new Date().toISOString(),
        saldo_final: res?.saldo_final != null ? res.saldo_final : prev.saldo_final,
      }));
      setSubModalVisible(false);
      try {
        eventBus.emit(EVENTS.MOVEMENT_CHANGED);
      } catch {}
      route.params?.onRefreshParent?.();
      appAlert('¡Caja cerrada!', 'La caja se cerró exitosamente en el sistema.');
    } catch (err) {
      appAlert('No se pudo cerrar', err.message);
    } finally {
      setClosing(false);
    }
  };

  const handleReabrirCaja = () => {
    const cajaId = cajaState?.caja_id || cajaState?.id;
    if (!cajaId) return;

    appAlert(
      'Reabrir caja',
      `¿Deseas reabrir la caja de ${cajaState?.nombre_usuario || 'este vendedor'}?\n\nLa caja volverá al estado 'abierta', permitiendo registrar cobros y movimientos pendientes.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reabrir Caja',
          onPress: async () => {
            setReopening(true);
            try {
              await reabrirCajaAdmin(cajaId);
              setCajaState(prev => ({
                ...prev,
                estado: 'abierta',
                fecha_cierre: null,
                saldo_final: null,
              }));
              try {
                eventBus.emit(EVENTS.MOVEMENT_CHANGED);
              } catch {}
              route.params?.onRefreshParent?.();
              appAlert('¡Caja reabierta!', 'La caja se encuentra abierta nuevamente en el sistema.');
              loadData();
            } catch (err) {
              appAlert('No se pudo reabrir', err.message);
            } finally {
              setReopening(false);
            }
          },
        },
      ]
    );
  };

  const handleCreateMovement = async () => {
    const montoNum = parseMoneyToNumeric(movMonto);
    if (!movDesc.trim() || !montoNum || montoNum <= 0) {
      appAlert('Campos requeridos', 'Por favor ingresa descripción y un monto válido');
      return;
    }
    const cajaId = caja.caja_id || caja.id;
    setSavingMov(true);
    try {
      await createAdminCajaMovement({
        cajaId,
        tipo: movTipo,
        descripcion: movDesc.trim(),
        monto: montoNum,
      });
      setModalVisible(false);
      setMovDesc('');
      setMovMonto('');
      appAlert('Éxito', 'Movimiento registrado');
      loadData();
    } catch (err) {
      appAlert('Error', err.message);
    } finally {
      setSavingMov(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={15} color={zendapp.colors.primary} />
          <Text style={styles.backText}>Cajas</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {cajaState?.nombre_usuario}
          </Text>
          <Text style={styles.headerSubtitle}>
            {isOpen ? '🟢 Caja Abierta' : '🔴 Caja Cerrada'} · {cajaState?.rol_usuario?.toUpperCase()}
          </Text>
        </View>

        {isOpen && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              style={styles.btnCloseCaja}
              onPress={handleCerrarCaja}
              disabled={closing || checkingSubs}
            >
              <Icon name="power-off" size={12} color="#FFFFFF" />
              <Text style={styles.btnCloseCajaText}>
                {closing ? '...' : checkingSubs ? 'Verificando...' : 'Cerrar'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnNewMov} onPress={() => setModalVisible(true)}>
              <Icon name="plus" size={12} color="#FFFFFF" />
              <Text style={styles.btnNewMovText}>Movimiento</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Resumen Superior Adaptado al Rol (Requisito 6) */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>Saldo Inicial</Text>
          <Text style={styles.summaryVal}>{formatMoney(cajaState?.saldo_inicial)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>{isOpen ? 'Saldo Actual' : 'Saldo Final'}</Text>
          <Text style={[styles.summaryVal, { color: zendapp.colors.carbon }]}>
            {formatMoney(cajaState?.saldo_final)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCol}>
          <Text style={styles.summaryLabel}>{isAdmin ? 'Ingresos' : 'Recaudado'}</Text>
          <Text style={[styles.summaryVal, { color: zendapp.colors.success }]}>
            {formatMoney(isAdmin ? cajaState?.valor_ingresos : cajaState?.valor_recaudado)}
          </Text>
        </View>
      </View>

      {/* Banner Informativo Caja Cerrada / Opción de Reapertura */}
      {!isOpen && (
        <View style={styles.reopenBanner}>
          <View style={styles.reopenBannerLeft}>
            <View style={styles.reopenIconCircle}>
              <Icon name="lock" size={14} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reopenBannerTitle}>Caja Cerrada / Finalizada</Text>
              <Text style={styles.reopenBannerSub}>
                Como administrador puedes reabrir esta caja si el vendedor necesita registrar pagos o cobros pendientes del día.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.reopenBannerBtn}
            onPress={handleReabrirCaja}
            disabled={reopening}
          >
            {reopening ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Icon name="unlock" size={13} color="#FFFFFF" />
                <Text style={styles.reopenBannerBtnText}>Reabrir esta Caja</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={zendapp.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar movimiento..."
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

      {/* Pills de Tipos con Scroll Horizontal fluido */}
      <View style={styles.pillsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsScrollContent}
        >
          {types.map((t) => {
            const count = countsByType[t.key] || 0;
            const isSelected = selectedType === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.pill, isSelected && styles.pillActive]}
                onPress={() => setSelectedType(t.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, isSelected && styles.pillTextActive]}>
                  {t.label}
                </Text>
                <View style={[styles.pillBadge, isSelected && styles.pillBadgeActive]}>
                  <Text style={[styles.pillBadgeText, isSelected && styles.pillBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Lista de Movimientos */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={zendapp.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            if (item.tipo === 'venta') {
              const inv = item.invoiceData;
              const hasPhoto = !!inv?.foto_documento_path;
              return (
                <TouchableOpacity
                  style={styles.movCardVenta}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (inv?.id) {
                      navigation.navigate('CreditDetail', { invoiceId: inv.id });
                    }
                  }}
                >
                  <View style={[styles.movIconWrap, { backgroundColor: '#FEF3C7' }]}>
                    <Icon name="shopping-bag" size={14} color="#D97706" />
                  </View>

                  <View style={{ flex: 1, marginHorizontal: 10 }}>
                    <Text style={styles.movDescVenta} numberOfLines={1}>
                      {item.cleanTitle || 'Venta de Crédito'}
                    </Text>

                    {/* Fila de Parámetros: Interés, Plazo, Cuotas Pagadas */}
                    <View style={styles.ventaMetricsRow}>
                      <View style={styles.ventaBadge}>
                        <Icon name="percent" size={9} color={zendapp.colors.textSecondary} style={{ marginRight: 3 }} />
                        <Text style={styles.ventaBadgeText}>
                          {inv?.tasa_interes || '20%'}
                        </Text>
                      </View>

                      <View style={styles.ventaBadge}>
                        <Icon name="calendar-o" size={9} color={zendapp.colors.textSecondary} style={{ marginRight: 3 }} />
                        <Text style={styles.ventaBadgeText}>
                          {inv?.num_cuotas || 0} {inv?.periodicidad || 'diarias'}
                        </Text>
                      </View>

                      <View style={[styles.ventaBadge, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
                        <Icon name="check-circle-o" size={9} color={zendapp.colors.success} style={{ marginRight: 3 }} />
                        <Text style={[styles.ventaBadgeText, { color: zendapp.colors.success }]}>
                          {inv?.cuotasPagadas ?? 0}/{inv?.num_cuotas || 0} pagadas
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.movTime}>{formatDate(item.fecha || item.created_at)}</Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                    <Text style={[styles.movAmount, { color: zendapp.colors.danger }]}>
                      -{formatMoney(item.monto)}
                    </Text>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      {hasPhoto && (
                        <TouchableOpacity
                          style={styles.btnMiniPhoto}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() => {
                            setEvidenceUri(inv.foto_documento_path);
                            setEvidenceTitle(`Documento: ${inv.clientName}`);
                            setEvidenceModalVisible(true);
                          }}
                        >
                          <Icon name="camera" size={11} color={zendapp.colors.primary} />
                          <Text style={styles.btnMiniPhotoText}>Doc</Text>
                        </TouchableOpacity>
                      )}
                      <Icon name="chevron-right" size={11} color={zendapp.colors.textMuted} />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }

            const isPositive = item.tipo === 'ingreso' || item.tipo === 'pago';
            const isGasto = item.tipo === 'gasto' || (item.tipo === 'retiro' && item.descripcion?.toLowerCase().includes('gasto'));
            const hasEvidencia = !!item.evidencia_path;

            return (
              <View style={styles.movCard}>
                <View style={[styles.movIconWrap, isPositive ? { backgroundColor: '#ECFDF5' } : isGasto ? { backgroundColor: '#FFF7ED' } : { backgroundColor: '#FEF2F2' }]}>
                  <Icon
                    name={
                      item.tipo === 'pago'
                        ? 'money'
                        : isGasto
                        ? 'tag'
                        : item.tipo === 'ingreso'
                        ? 'arrow-down'
                        : 'arrow-up'
                    }
                    size={14}
                    color={isPositive ? zendapp.colors.success : isGasto ? '#EA580C' : zendapp.colors.danger}
                  />
                </View>
                <View style={{ flex: 1, marginHorizontal: 10 }}>
                  <Text style={styles.movDesc} numberOfLines={2}>
                    {item.descripcion || item.tipo?.toUpperCase()}
                  </Text>
                  <Text style={styles.movTime}>{formatDate(item.fecha || item.created_at)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                  <Text style={[styles.movAmount, { color: isPositive ? zendapp.colors.success : zendapp.colors.danger }]}>
                    {isPositive ? '+' : '-'}{formatMoney(item.monto)}
                  </Text>
                  {hasEvidencia && (
                    <TouchableOpacity
                      style={[styles.btnMiniPhoto, { marginTop: 4 }]}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => {
                        setEvidenceUri(item.evidencia_path);
                        setEvidenceTitle('Evidencia de Movimiento');
                        setEvidenceModalVisible(true);
                      }}
                    >
                      <Icon name="camera" size={11} color={zendapp.colors.primary} />
                      <Text style={styles.btnMiniPhotoText}>Foto</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={zendapp.colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="list" size={40} color={zendapp.colors.border} />
              <Text style={styles.emptyTitle}>Sin movimientos</Text>
              <Text style={styles.emptySubtitle}>No se encontraron registros para este filtro</Text>
            </View>
          }
        />
      )}

      {/* MODAL NUEVO MOVIMIENTO */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuevo Movimiento</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Icon name="times" size={18} color={zendapp.colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.movTypeSelector}>
              <TouchableOpacity
                style={[styles.movTypeBtn, movTipo === 'ingreso' && styles.movTypeBtnActive]}
                onPress={() => setMovTipo('ingreso')}
              >
                <Text style={[styles.movTypeText, movTipo === 'ingreso' && styles.movTypeTextActive]}>Ingreso</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.movTypeBtn, movTipo === 'retiro' && styles.movTypeBtnActive]}
                onPress={() => setMovTipo('retiro')}
              >
                <Text style={[styles.movTypeText, movTipo === 'retiro' && styles.movTypeTextActive]}>Retiro</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.movTypeBtn, movTipo === 'gasto' && styles.movTypeBtnActive]}
                onPress={() => setMovTipo('gasto')}
              >
                <Text style={[styles.movTypeText, movTipo === 'gasto' && styles.movTypeTextActive]}>Gasto</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Descripción *</Text>
              <TextInput
                style={styles.input}
                value={movDesc}
                onChangeText={setMovDesc}
                placeholder="Ej. Consignación, transporte, combustible"
                placeholderTextColor={zendapp.colors.textMuted}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Monto *</Text>
              <TextInput
                style={styles.input}
                value={movMonto}
                onChangeText={(t) => setMovMonto(formatMoneyInput(t))}
                placeholder="$ 0"
                placeholderTextColor={zendapp.colors.textMuted}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnConfirm} onPress={handleCreateMovement} disabled={savingMov}>
                <Text style={styles.modalBtnConfirmText}>{savingMov ? 'Guardando...' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL ADVERTENCIA SUBORDINADOS CON CAJA ABIERTA (Requisito 7) */}
      <Modal visible={subModalVisible} transparent animationType="fade" onRequestClose={() => setSubModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <View style={styles.subModalHeader}>
              <View style={styles.subWarnIconWrap}>
                <Icon name="exclamation-triangle" size={22} color="#D97706" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.subModalTitle}>Vendedores con caja abierta</Text>
                <Text style={styles.subModalBadge}>{openSubordinates.length} caja(s) pendientes</Text>
              </View>
              <TouchableOpacity onPress={() => setSubModalVisible(false)}>
                <Icon name="times" size={18} color={zendapp.colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.subModalExplain}>
              Tienes vendedores subordinados que aún tienen su caja del día abierta. Para garantizar que los recaudos y gastos de la ruta se consoliden correctamente en el balance contable, tus vendedores deben cerrar primero sus cajas antes de finalizar la caja de administración.
            </Text>

            <Text style={styles.subListHeader}>Cajas de subordinados aún abiertas:</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              {openSubordinates.map((sub, idx) => (
                <View key={idx} style={styles.subCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subVendorName}>{sub.nombre_usuario}</Text>
                    <Text style={styles.subDetails}>
                      Apertura: {new Date(sub.fecha_apertura).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={styles.subSaldo}>
                      Saldo actual: <Text style={{ color: zendapp.colors.carbon, fontWeight: '700' }}>{formatMoney(sub.saldo_final)}</Text>
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.subInspectBtn}
                    onPress={() => {
                      setSubModalVisible(false);
                      navigation.push('AdminCajaDetalle', { caja: sub });
                    }}
                  >
                    <Text style={styles.subInspectBtnText}>Ver caja</Text>
                    <Icon name="chevron-right" size={10} color={zendapp.colors.primary} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setSubModalVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnConfirm, { backgroundColor: zendapp.colors.primary }]}
                onPress={() => executeClose(caja.caja_id || caja.id)}
                disabled={closing}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {closing ? 'Cerrando...' : 'Intentar cierre'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Visor de Evidencia Multimedia */}
      <EvidencePreviewModal
        visible={evidenceModalVisible}
        onClose={() => {
          setEvidenceModalVisible(false);
          setEvidenceUri(null);
        }}
        readOnly={true}
        initialUri={evidenceUri}
        title={evidenceTitle}
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
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EAECF0',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 8,
  },
  backText: {
    fontSize: 15,
    color: zendapp.colors.primary,
    marginLeft: 4,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  headerSubtitle: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  btnCloseCaja: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: zendapp.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
  },
  btnCloseCajaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnNewMov: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: zendapp.colors.carbon,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
  },
  btnNewMovText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(234, 236, 240, 0.8)',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#EAECF0',
    marginVertical: 4,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: zendapp.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  summaryVal: {
    fontSize: 15,
    fontWeight: '800',
    color: zendapp.colors.carbon,
    marginTop: 3,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 10,
    overflow: 'hidden',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1.2,
    borderColor: 'rgba(216, 220, 228, 0.85)',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: zendapp.colors.carbon,
  },
  pillsContainer: {
    marginVertical: 4,
  },
  pillsScrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#D8DCE4',
  },
  pillActive: {
    backgroundColor: zendapp.colors.primary,
    borderColor: '#B91C1C',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555E6D',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  pillBadge: {
    backgroundColor: '#EAEFF5',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  pillBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#555E6D',
  },
  pillBadgeTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  movCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(216, 220, 228, 0.85)',
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  movCardVenta: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1.2,
    borderColor: 'rgba(216, 220, 228, 0.85)',
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  movDescVenta: {
    fontSize: 14,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  ventaMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    marginBottom: 2,
  },
  ventaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EAECF0',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  ventaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  btnMiniPhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEECEC',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  btnMiniPhotoText: {
    fontSize: 10,
    fontWeight: '700',
    color: zendapp.colors.primary,
  },
  movIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  movDesc: {
    fontSize: 13,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  movTime: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  movAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: zendapp.colors.carbon,
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: 12,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
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
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  movTypeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  movTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  movTypeBtnActive: {
    backgroundColor: zendapp.colors.primary,
    borderColor: zendapp.colors.primary,
  },
  movTypeText: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.textSecondary,
  },
  movTypeTextActive: {
    color: '#FFFFFF',
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.carbon,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: zendapp.colors.carbon,
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F2F4F7',
    alignItems: 'center',
  },
  modalBtnCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  modalBtnConfirm: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: zendapp.colors.primary,
    alignItems: 'center',
  },
  modalBtnConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Estilos modal subordinados
  subModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  subWarnIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  subModalBadge: {
    fontSize: 12,
    color: '#D97706',
    fontWeight: '600',
  },
  subModalExplain: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  subListHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.carbon,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    overflow: 'hidden',
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  subVendorName: {
    fontSize: 14,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  subDetails: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  subSaldo: {
    fontSize: 12,
    color: zendapp.colors.carbon,
    marginTop: 2,
  },
  subInspectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEECEC',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  subInspectBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.primary,
  },
  btnReopenCaja: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
  },
  btnReopenCajaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reopenBanner: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    padding: 12,
  },
  reopenBannerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  reopenIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  reopenBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  reopenBannerSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 15,
  },
  reopenBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D97706',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 10,
    gap: 6,
    alignSelf: 'flex-end',
  },
  reopenBannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});