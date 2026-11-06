import AppBackground from '../../components/AppBackground';
// src/screens/admin/AdminCarteraDetalle.js
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
  Modal,
  ScrollView,
  Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../../theme/zendappTheme';
import { SkeletonList, SkeletonCarteraCard } from '../../components/Skeleton';
import { appAlert } from '../../components/AppAlert';
import {
  getCarteraDetail,
  castigarCartera,
  getSubordinates,
  trasladarCartera,
} from '../../services/adminService';

const formatMoney = (val) => {
  const num = parseFloat(val) || 0;
  return '$' + num.toLocaleString('es-CO');
};

export default function AdminCarteraDetalle() {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = route.params || {};
  const currentUserId = user?.usuario_id || user?.id;

  const [items, setItems] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Estados para Modal de Castigo de Cartera (Requisito 5)
  const [castigoModalVisible, setCastigoModalVisible] = useState(false);
  const [selectedCastigoInvoice, setSelectedCastigoInvoice] = useState(null);
  const [castigando, setCastigando] = useState(false);

  // Estados para Modal de Traslado de Cartera (Requisito 6)
  const [trasladoModalVisible, setTrasladoModalVisible] = useState(false);
  const [destinatarios, setDestinatarios] = useState([]);
  const [selectedDestinoId, setSelectedDestinoId] = useState(null);
  const [loadingDestinatarios, setLoadingDestinatarios] = useState(false);
  const [trasladando, setTrasladando] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const data = await getCarteraDetail(currentUserId);
      setItems(data);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudo cargar el detalle');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

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
            i.documento?.toLowerCase().includes(q)
        )
      );
    }
  }, [search, items]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Requisito 5: Modal personalizado de confirmacion al castigar cartera
  const openCastigarModal = (invoice) => {
    setSelectedCastigoInvoice(invoice);
    setCastigoModalVisible(true);
  };

  const confirmCastigar = async () => {
    if (!selectedCastigoInvoice) return;
    setCastigando(true);
    try {
      await castigarCartera(selectedCastigoInvoice.invoice_id);
      setCastigoModalVisible(false);
      setSelectedCastigoInvoice(null);
      appAlert('xito', 'El crdito fue castigado correctamente.');
      loadData();
    } catch (err) {
      appAlert('Error', err.message || 'No se pudo castigar la cartera');
    } finally {
      setCastigando(false);
    }
  };

  // Requisito 6: Abrir modal y cargar vendedores activos autorizados
  const handleOpenTraslado = async () => {
    setTrasladoModalVisible(true);
    setLoadingDestinatarios(true);
    setSelectedDestinoId(null);
    try {
      const subs = await getSubordinates();
      // Filtrar vendedores activos dentro de la misma jerarquia distintos al vendedor origen
      const validos = (subs || []).filter(
        (s) => s.id !== currentUserId && s.activo !== false && s.rol !== 'superadmin'
      );
      setDestinatarios(validos);
      if (validos.length > 0) {
        setSelectedDestinoId(validos[0].id);
      }
    } catch (err) {
      appAlert('Error', err.message || 'No se pudo cargar la lista de vendedores destino');
    } finally {
      setLoadingDestinatarios(false);
    }
  };

  const confirmTraslado = async () => {
    if (!selectedDestinoId) {
      appAlert('Atencin', 'Por favor selecciona el vendedor de destino');
      return;
    }
    setTrasladando(true);
    try {
      const res = await trasladarCartera(currentUserId, selectedDestinoId);
      setTrasladoModalVisible(false);
      const totalClientes = res?.clientes_trasladados ?? items.length;
      appAlert(
        'Traslado exitoso',
        `Se han trasladado ${totalClientes} clientes al nuevo vendedor correctamente.`
      );
      loadData();
    } catch (err) {
      appAlert('Error al trasladar', err.message || 'No se pudo completar el traslado');
    } finally {
      setTrasladando(false);
    }
  };

  const handleOpenCredit = (invoice) => {
    navigation.navigate('CreditDetail', { invoiceId: invoice.invoice_id });
  };

  return (
    <SafeAreaView style={styles.root}>
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={15} color={zendapp.colors.primary} />
          <Text style={styles.backText}>Cartera</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {user?.nombre} {user?.apellido || ''}
          </Text>
          <Text style={styles.headerSubtitle}>
            {items.length} clientes activos
          </Text>
        </View>

        {/* Boton Trasladar Cartera (Requisito 6) */}
        <TouchableOpacity
          style={styles.btnTrasladarHeader}
          onPress={handleOpenTraslado}
          activeOpacity={0.8}
        >
          <Icon name="exchange" size={12} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.btnTrasladarHeaderText}>Trasladar cartera</Text>
        </TouchableOpacity>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={zendapp.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar cliente o documento..."
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

      {/* Lista de Créditos */}
        {loading ? (
          <View style={{ flex: 1, paddingTop: 10 }}>
            <SkeletonList count={5} Component={SkeletonCarteraCard} />
          </View>
        ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.invoice_id}
          renderItem={({ item }) => {
            const hasVencido = parseFloat(item.saldo_vencido) > 0;
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.8}
                onPress={() => handleOpenCredit(item)}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientName} numberOfLines={1}>
                      {item.nombre_cliente} {item.apellido_cliente || ''}
                    </Text>
                    <Text style={styles.clientDoc}>
                      Doc: {item.documento || 'S/D'} · Tel: {item.telefono || 'S/T'}
                    </Text>
                  </View>
                  <View style={styles.saldoWrap}>
                    <Text style={styles.saldoVal}>{formatMoney(item.saldo)}</Text>
                    <Text style={styles.saldoLabel}>Saldo Actual</Text>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.detailGrid}>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Monto Inicial</Text>
                    <Text style={styles.gridVal}>{formatMoney(item.saldo_inicial)}</Text>
                  </View>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Saldo Vencido</Text>
                    <Text style={[styles.gridVal, hasVencido && { color: zendapp.colors.danger }]}>
                      {formatMoney(item.saldo_vencido)}
                    </Text>
                  </View>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Cuotas</Text>
                    <Text style={styles.gridVal}>
                      {item.cuota_actual}/{item.cuotas_totales} ({item.cuotas_restantes} rest.)
                    </Text>
                  </View>
                </View>

                {/* Acciones */}
                <View style={styles.cardFooter}>
                  {hasVencido ? (
                    <TouchableOpacity
                      style={styles.btnCastigar}
                      onPress={() => openCastigarModal(item)}
                    >
                      <Icon name="ban" size={12} color={zendapp.colors.primary} />
                      <Text style={styles.btnCastigarText}>Castigar Cartera</Text>
                    </TouchableOpacity>
                  ) : <View />}

                  <TouchableOpacity
                    style={styles.btnVer}
                    onPress={() => handleOpenCredit(item)}
                  >
                    <Text style={styles.btnVerText}>Ver Detalle</Text>
                    <Icon name="arrow-right" size={12} color={zendapp.colors.primary} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={zendapp.colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="inbox" size={44} color={zendapp.colors.border} />
              <Text style={styles.emptyTitle}>Sin créditos</Text>
              <Text style={styles.emptySubtitle}>Este usuario no tiene créditos con saldo pendiente</Text>
            </View>
          }
        />
      )}

      {/* MODAL CASTIGAR CARTERA (Requisito 5) */}
      <Modal
        visible={castigoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !castigando && setCastigoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrapDanger}>
              <Icon name="ban" size={22} color={zendapp.colors.primary} />
            </View>
            <Text style={styles.modalTitle}>Castigar Cartera</Text>
            <Text style={styles.modalDesc}>
              ¿Estás seguro de castigar el crédito de{' '}
              <Text style={{ fontWeight: '700', color: zendapp.colors.carbon }}>
                {selectedCastigoInvoice?.nombre_cliente} {selectedCastigoInvoice?.apellido_cliente || ''}
              </Text>
              ? Esta acción bloqueará futuros créditos a este cliente y saldrá de la ruta de cobro activa.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setCastigoModalVisible(false)}
                disabled={castigando}
              >
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={confirmCastigar}
                disabled={castigando}
              >
                {castigando ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnDangerText}>Castigar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL TRASLADAR CARTERA (Requisito 6) */}
      <Modal
        visible={trasladoModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !trasladando && setTrasladoModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.trasladoCard}>
            <View style={styles.modalIconWrapPrimary}>
              <Icon name="exchange" size={22} color={zendapp.colors.primary} />
            </View>
            <Text style={styles.modalTitle}>Trasladar Cartera</Text>
            <Text style={styles.modalDesc}>
              Permite transferir los clientes de este vendedor a otro usuario para continuar con su cobro y gestión.
            </Text>

            {/* Vendedor Origen */}
            <Text style={styles.fieldLabel}>Vendedor de origen:</Text>
            <View style={styles.readOnlyField}>
              <Icon name="user" size={14} color={zendapp.colors.textSecondary} style={{ marginRight: 8 }} />
              <Text style={styles.readOnlyText}>
                {user?.nombre} {user?.apellido || ''} (Seleccionado)
              </Text>
            </View>

            {/* Vendedor Destino */}
            <Text style={styles.fieldLabel}>Vendedor de destino:</Text>
            {loadingDestinatarios ? (
              <ActivityIndicator size="small" color={zendapp.colors.primary} style={{ marginVertical: 12 }} />
            ) : destinatarios.length === 0 ? (
              <View style={styles.emptyDestinoBox}>
                <Text style={styles.emptyDestinoText}>
                  No hay otros usuarios activos disponibles en tu jerarquía.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.destinosList} showsVerticalScrollIndicator={false}>
                {destinatarios.map((v) => {
                  const isSelected = selectedDestinoId === v.id;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[styles.destinoItem, isSelected && styles.destinoItemSelected]}
                      onPress={() => setSelectedDestinoId(v.id)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.destinoName, isSelected && styles.destinoNameSelected]}>
                          {v.nombre} {v.apellido || ''}
                        </Text>
                        <Text style={styles.destinoRole}>{v.rol?.toUpperCase()} · ACTIVO</Text>
                      </View>
                      <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setTrasladoModalVisible(false)}
                disabled={trasladando}
              >
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  (!selectedDestinoId || destinatarios.length === 0) && { opacity: 0.5 },
                ]}
                onPress={confirmTraslado}
                disabled={trasladando || !selectedDestinoId || destinatarios.length === 0}
              >
                {trasladando ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Confirmar traslado</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 8,
    backgroundColor: zendapp.colors.bg,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 8,
  },
  backText: {
    fontSize: 15,
    fontWeight: '700',
    color: zendapp.colors.primary,
    marginLeft: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  headerSubtitle: {
    fontSize: 12,
    color: zendapp.colors.textSecondary,
    marginTop: 1,
  },
  btnTrasladarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: zendapp.colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnTrasladarHeaderText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    height: 42,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
    color: zendapp.colors.carbon,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
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
    fontSize: 16,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  clientDoc: {
    fontSize: 12,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  saldoWrap: {
    alignItems: 'flex-end',
  },
  saldoVal: {
    fontSize: 16,
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  saldoLabel: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#EAECF0',
    marginVertical: 12,
  },
  detailGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridCol: {
    flex: 1,
  },
  gridLabel: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
    marginBottom: 2,
  },
  gridVal: {
    fontSize: 13,
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
    borderColor: '#EAECF0',
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
    color: zendapp.colors.primary,
    fontWeight: '700',
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
    color: zendapp.colors.carbon,
    fontWeight: '700',
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
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  trasladoCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  modalIconWrapDanger: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalIconWrapPrimary: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEECEC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    alignSelf: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: zendapp.colors.carbon,
    textAlign: 'center',
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  readOnlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EAECF0',
    marginBottom: 14,
  },
  readOnlyText: {
    fontSize: 13,
    color: zendapp.colors.carbon,
    fontWeight: '600',
  },
  destinosList: {
    maxHeight: 180,
    marginBottom: 14,
  },
  destinoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  destinoItemSelected: {
    borderColor: zendapp.colors.primary,
    backgroundColor: '#FEECEC',
  },
  destinoName: {
    fontSize: 13,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  destinoNameSelected: {
    color: zendapp.colors.primary,
  },
  destinoRole: {
    fontSize: 10,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#D0D5DD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: zendapp.colors.primary,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: zendapp.colors.primary,
  },
  emptyDestinoBox: {
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    marginBottom: 14,
  },
  emptyDestinoText: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 10,
  },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnCancel: {
    backgroundColor: '#F2F4F7',
  },
  modalBtnCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  modalBtnDanger: {
    backgroundColor: zendapp.colors.primary,
  },
  modalBtnDangerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBtnPrimary: {
    backgroundColor: zendapp.colors.primary,
  },
  modalBtnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
