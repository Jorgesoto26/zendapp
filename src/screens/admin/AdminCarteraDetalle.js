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
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../theme/appleTheme';
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={16} color={apple.colors.blue} />
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
          <Icon name="exchange" size={13} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.btnTrasladarHeaderText}>Trasladar cartera</Text>
        </TouchableOpacity>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={apple.colors.tertiaryLabel} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar cliente o documento..."
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

      {/* Lista de Crditos */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={apple.colors.blue} />
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
                      Doc: {item.documento || 'S/D'}  Tel: {item.telefono || 'S/T'}
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
                    <Text style={[styles.gridVal, hasVencido && { color: apple.colors.danger }]}>
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
                      <Icon name="ban" size={12} color={apple.colors.danger} />
                      <Text style={styles.btnCastigarText}>Castigar Cartera</Text>
                    </TouchableOpacity>
                  ) : <View />}

                  <TouchableOpacity
                    style={styles.btnVer}
                    onPress={() => handleOpenCredit(item)}
                  >
                    <Text style={styles.btnVerText}>Ver Detalle</Text>
                    <Icon name="arrow-right" size={12} color={apple.colors.blue} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="inbox" size={48} color={apple.colors.tertiaryLabel} />
              <Text style={styles.emptyTitle}>Sin crditos</Text>
              <Text style={styles.emptySubtitle}>Este vendedor no tiene crditos con saldo pendiente</Text>
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
              <Icon name="ban" size={24} color={apple.colors.danger} />
            </View>
            <Text style={styles.modalTitle}>Castigar Cartera</Text>
            <Text style={styles.modalDesc}>
              Estás seguro de castigar el crédito de{' '}
              <Text style={{ fontWeight: '700', color: apple.colors.label }}>
                {selectedCastigoInvoice?.nombre_cliente} {selectedCastigoInvoice?.apellido_cliente || ''}
              </Text>
              Esta acción bloqueará futuros créditos a este cliente y saldrá de la ruta de cobro activa.
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
              <Icon name="exchange" size={24} color={apple.colors.blue} />
            </View>
            <Text style={styles.modalTitle}>Trasladar Cartera</Text>
            <Text style={styles.modalDesc}>
              Trasladar cartera permite asignar los clientes de este vendedor a otro vendedor para que contine gestionando su cartera.
            </Text>

            {/* Vendedor Origen */}
            <Text style={styles.fieldLabel}>Vendedor de origen:</Text>
            <View style={styles.readOnlyField}>
              <Icon name="user" size={14} color={apple.colors.secondaryLabel} style={{ marginRight: 8 }} />
              <Text style={styles.readOnlyText}>
                {user?.nombre} {user?.apellido || ''} (Seleccionado)
              </Text>
            </View>

            {/* Vendedor Destino */}
            <Text style={styles.fieldLabel}>Vendedor de destino:</Text>
            {loadingDestinatarios ? (
              <ActivityIndicator size="small" color={apple.colors.blue} style={{ marginVertical: 12 }} />
            ) : destinatarios.length === 0 ? (
              <View style={styles.emptyDestinoBox}>
                <Text style={styles.emptyDestinoText}>
                  No hay otros vendedores activos disponibles en tu jerarqua.
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
                        <Text style={styles.destinoRole}>{v.rol?.toUpperCase()}  ACTIVO</Text>
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
    backgroundColor: apple.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.m,
    paddingBottom: apple.spacing.s,
    backgroundColor: apple.colors.bg,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: apple.spacing.xs,
    paddingRight: apple.spacing.s,
  },
  backText: {
    ...apple.typography.body,
    color: apple.colors.blue,
    marginLeft: 4,
  },
  headerTitle: {
    ...apple.typography.headline,
    color: apple.colors.label,
  },
  headerSubtitle: {
    ...apple.typography.caption1,
    color: apple.colors.secondaryLabel,
  },
  btnTrasladarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.blue,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: apple.radius.m,
  },
  btnTrasladarHeaderText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.card,
    marginHorizontal: apple.spacing.l,
    marginVertical: apple.spacing.s,
    paddingHorizontal: apple.spacing.m,
    borderRadius: apple.radius.m,
    height: 38,
    borderWidth: 1,
    borderColor: apple.colors.separator,
  },
  searchIcon: {
    marginRight: apple.spacing.s,
  },
  searchInput: {
    flex: 1,
    ...apple.typography.body,
    paddingVertical: 0,
    color: apple.colors.label,
  },
  listContent: {
    padding: apple.spacing.l,
    paddingBottom: apple.spacing.xl * 2,
  },
  card: {
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.l,
    padding: apple.spacing.m,
    marginBottom: apple.spacing.m,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    ...apple.shadow.small,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  clientName: {
    ...apple.typography.headline,
    color: apple.colors.label,
  },
  clientDoc: {
    ...apple.typography.caption1,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  saldoWrap: {
    alignItems: 'flex-end',
  },
  saldoVal: {
    ...apple.typography.headline,
    color: apple.colors.blue,
  },
  saldoLabel: {
    ...apple.typography.caption2,
    color: apple.colors.secondaryLabel,
  },
  divider: {
    height: 1,
    backgroundColor: apple.colors.separator,
    marginVertical: apple.spacing.m,
  },
  detailGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridCol: {
    flex: 1,
  },
  gridLabel: {
    ...apple.typography.caption2,
    color: apple.colors.secondaryLabel,
    marginBottom: 2,
  },
  gridVal: {
    ...apple.typography.subheadline,
    fontWeight: '600',
    color: apple.colors.label,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: apple.spacing.m,
    paddingTop: apple.spacing.s,
    borderTopWidth: 1,
    borderColor: apple.colors.separator,
  },
  btnCastigar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: apple.radius.s,
    backgroundColor: '#FFE5E5',
  },
  btnCastigarText: {
    ...apple.typography.caption1,
    color: apple.colors.danger,
    fontWeight: '600',
    marginLeft: 4,
  },
  btnVer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  btnVerText: {
    ...apple.typography.subheadline,
    color: apple.colors.blue,
    fontWeight: '500',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: apple.spacing.xl * 2,
  },
  emptyTitle: {
    ...apple.typography.headline,
    color: apple.colors.secondaryLabel,
    marginTop: apple.spacing.m,
  },
  emptySubtitle: {
    ...apple.typography.subheadline,
    color: apple.colors.tertiaryLabel,
    textAlign: 'center',
    marginTop: apple.spacing.xs,
    paddingHorizontal: apple.spacing.xl,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: apple.spacing.l,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.xl,
    padding: apple.spacing.l,
    alignItems: 'center',
    ...apple.shadow.large,
  },
  trasladoCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.xl,
    padding: apple.spacing.l,
    maxHeight: '85%',
    ...apple.shadow.large,
  },
  modalIconWrapDanger: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFE5E5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: apple.spacing.m,
  },
  modalIconWrapPrimary: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EBF3FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: apple.spacing.m,
    alignSelf: 'center',
  },
  modalTitle: {
    ...apple.typography.title3,
    fontWeight: '700',
    color: apple.colors.label,
    textAlign: 'center',
    marginBottom: apple.spacing.s,
  },
  modalDesc: {
    ...apple.typography.subheadline,
    color: apple.colors.secondaryLabel,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: apple.spacing.l,
  },
  fieldLabel: {
    ...apple.typography.caption1,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  readOnlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.fill,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: apple.radius.m,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    marginBottom: apple.spacing.m,
  },
  readOnlyText: {
    ...apple.typography.body,
    color: apple.colors.label,
    fontWeight: '600',
  },
  destinosList: {
    maxHeight: 180,
    marginBottom: apple.spacing.m,
  },
  destinoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.m,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: apple.colors.separator,
  },
  destinoItemSelected: {
    borderColor: apple.colors.blue,
    backgroundColor: '#F0F6FF',
  },
  destinoName: {
    ...apple.typography.body,
    fontWeight: '600',
    color: apple.colors.label,
  },
  destinoNameSelected: {
    color: apple.colors.blue,
  },
  destinoRole: {
    ...apple.typography.caption2,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: apple.colors.tertiaryLabel,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: apple.colors.blue,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: apple.colors.blue,
  },
  emptyDestinoBox: {
    padding: 16,
    backgroundColor: apple.colors.fill,
    borderRadius: apple.radius.m,
    marginBottom: apple.spacing.m,
  },
  emptyDestinoText: {
    ...apple.typography.subheadline,
    color: apple.colors.secondaryLabel,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: apple.spacing.s,
  },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: apple.radius.m,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnCancel: {
    backgroundColor: apple.colors.fill,
  },
  modalBtnCancelText: {
    ...apple.typography.body,
    fontWeight: '600',
    color: apple.colors.label,
  },
  modalBtnDanger: {
    backgroundColor: apple.colors.danger,
  },
  modalBtnDangerText: {
    ...apple.typography.body,
    fontWeight: '600',
    color: '#fff',
  },
  modalBtnPrimary: {
    backgroundColor: apple.colors.blue,
  },
  modalBtnPrimaryText: {
    ...apple.typography.body,
    fontWeight: '600',
    color: '#fff',
  },
});
