import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  BackHandler,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { supabase } from '../../lib/supabase';
import { getDbConnection, getData } from '../../database/db';
import { FormatMoneyDecimales } from '../../utils/utilities';
import { apple } from '../../theme/appleTheme';
import { AppleCard } from '../../components/AppleCard';
import { appAlert } from '../../components/AppAlert';
import { eventBus, EVENTS } from '../../utils/eventBus';
import EvidencePreviewModal from '../../components/EvidencePreviewModal';
import PaymentReceiptModal from '../../components/PaymentReceiptModal';

function StatusBadge({ estado }) {
  const map = {
    pagada: { bg: '#E8F5E9', color: apple.colors.success, label: 'PAGADA' },
    abonada: { bg: '#FFF8E1', color: apple.colors.warning, label: 'ABONADA' },
    pendiente: { bg: '#F2F2F7', color: apple.colors.secondaryLabel, label: 'PENDIENTE' },
  };
  const s = map[(estado || '').toLowerCase()] || map.pendiente;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

export default function CreditDetail({ route, navigation }) {
  const { invoiceId, clientName, address, telefono, latitud, longitud, saldo: saldoInicial } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState(null);
  const [client, setClient] = useState(null);
  const [cuotas, setCuotas] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [docEvidenceModalVisible, setDocEvidenceModalVisible] = useState(false);
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState(null);

  // Estado unificado de coordenadas (Requisito 2)
  const [coords, setCoords] = useState({
    lat: latitud != null && Number(latitud) !== 0 ? latitud : null,
    lng: longitud != null && Number(longitud) !== 0 ? longitud : null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Cargar primero de SQLite local
      const db = await getDbConnection();
      try {
        const localRows = await getData(db, `SELECT * FROM facturas WHERE id = ?`, [invoiceId]);
        if (localRows && localRows.length > 0) {
          const row = localRows[0];
          setInvoice({
            id: row.id,
            amount: Number(row.valorInicial || row.saldo),
            saldo: Number(row.saldo),
            status: row.estado || 'pendiente',
            created_at: row.fecha,
            latitud: row.latitud,
            longitud: row.longitud,
            periodicidad: row.periodicidad || 'Diario',
            num_cuotas: row.num_cuotas,
            tasa_interes: row.tasa_interes,
            pago_adelantado: Number(row.pago_adelantado) === 1,
            foto_documento_path: row.foto_documento_path || null,
          });
          setClient({
            nombre: row.nombreUno,
            apellido: row.apellidoUno,
            alias: row.alias,
            telefono: row.celular,
            direccion: row.direccion,
            documento: row.documento,
            foto_documento_path: row.foto_documento_path || null,
          });
          if (row.latitud != null && row.longitud != null && Number(row.latitud) !== 0) {
            setCoords({ lat: row.latitud, lng: row.longitud });
          }
          const localPagos = await getData(
            db,
            `SELECT id, valor AS amount, horaDispositivo AS payment_date, tipo AS method
             FROM pagos WHERE idFactura = ? ORDER BY horaDispositivo DESC`,
            [invoiceId]
          );
          setPagos(localPagos || []);

          const localCuotas = await getData(
            db,
            `SELECT id, numero, fecha_vencimiento, monto, estado, monto_pagado
             FROM cuotas WHERE invoice_id = ? ORDER BY numero ASC`,
            [invoiceId]
          );
          if (localCuotas && localCuotas.length > 0) {
            setCuotas(localCuotas);
          }
        }
      } catch (err) {
        console.log('Error leyendo factura local:', err);
      }

      // 2. Si no es un id temporal offline, consultar Supabase para detalles remotos si hay red
      if (!String(invoiceId).startsWith('-') && !String(invoiceId).startsWith('temp-')) {
        try {
          const { data: inv } = await supabase
            .from('invoice')
            .select('id, amount, saldo, status, created_at, plazo_id, interes_id, client_id, usuario_id, latitud, longitud, periodicidad, num_cuotas, tasa_interes, pago_adelantado')
            .eq('id', invoiceId)
            .single();

          if (inv) {
            setInvoice(prev => ({
              ...prev,
              ...inv,
              amount: Number(inv.amount),
              saldo: Number(inv.saldo),
              pago_adelantado: inv.pago_adelantado === true || Number(inv.pago_adelantado) === 1,
            }));
            if (inv.latitud != null && inv.longitud != null && Number(inv.latitud) !== 0) {
              setCoords({ lat: inv.latitud, lng: inv.longitud });
            }
            if (inv.client_id) {
              const { data: cli } = await supabase
                .from('clients')
                .select('nombre, apellido, alias, telefono, direccion, documento, latitud, longitud, foto_documento_path')
                .eq('id', inv.client_id)
                .single();
              if (cli) {
                setClient(prev => ({ ...prev, ...cli }));
                if ((!inv.latitud || Number(inv.latitud) === 0) && cli.latitud != null) {
                  setCoords({ lat: cli.latitud, lng: cli.longitud });
                }
              }
            }
            const { data: cs } = await supabase
              .from('cuotas')
              .select('id, numero, fecha_vencimiento, monto, estado, monto_pagado')
              .eq('invoice_id', invoiceId)
              .order('numero', { ascending: true });
            if (cs && cs.length > 0) {
              setCuotas(cs);
              for (const itemC of cs) {
                try {
                  await db.executeSql(
                    `INSERT OR REPLACE INTO cuotas (id, invoice_id, numero, fecha_vencimiento, monto, estado, monto_pagado)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [String(itemC.id), String(invoiceId), itemC.numero, itemC.fecha_vencimiento, Number(itemC.monto), itemC.estado || 'pendiente', Number(itemC.monto_pagado || 0)]
                  );
                } catch {}
              }
            }

            const { data: ps } = await supabase
              .from('payments')
              .select('id, amount, payment_date, method, created_at')
              .eq('invoice_id', invoiceId)
              .order('payment_date', { ascending: false });
            if (ps) setPagos(ps);
          }
        } catch {
          // Fallback silencioso a datos locales si no hay red
        }
      }
    } catch (e) {
      console.error('CreditDetail load error:', e);
      appAlert('Error', 'No se pudo cargar el detalle');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Recargar si ocurre un pago o movimiento (Requisito 4)
  useEffect(() => {
    const unsubPay = eventBus.on(EVENTS.PAYMENT_REGISTERED, () => load());
    const unsubMov = eventBus.on(EVENTS.MOVEMENT_CHANGED, () => load());
    return () => {
      unsubPay();
      unsubMov();
    };
  }, [load]);

  // Manejador del botón físico de retroceso para volver directamente a Pagos (Requisito 2)
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        navigation.goBack();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => {
        sub.remove();
      };
    }, [navigation])
  );

  // Comprobar si hay coordenadas validas (Requisito 2)
  const hasCoords = coords.lat != null && coords.lng != null &&
    !isNaN(Number(coords.lat)) && !isNaN(Number(coords.lng)) &&
    Number(coords.lat) !== 0 && Number(coords.lng) !== 0;

  const openMap = () => {
    if (!hasCoords) {
      return appAlert(
        'Sin ubicación registrada',
        'Esta venta o crédito no tiene coordenadas GPS guardadas en el sistema.'
      );
    }
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    const url = Platform.select({
      ios: `http://maps.apple.com/?q=${lat},${lng}`,
      android: `geo:${lat},${lng}?q=${lat},${lng}`,
    });
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)
    );
  };

  const totalPagado = pagos.reduce((a, p) => a + Number(p.amount || 0), 0);
  const saldoActual = Number(invoice?.saldo ?? saldoInicial ?? 0);
  const isCreditCompleted = saldoActual <= 0 || (invoice?.status || '').toLowerCase() === 'pagado';

  const handleRenewPress = () => {
    navigation.navigate('CrearCliente', {
      renewClient: {
        id: invoice?.id || invoiceId,
        nombre: client?.nombre || '',
        apellido: client?.apellido || '',
        alias: client?.alias || '',
        direccion: client?.direccion || address || '',
        telefono: client?.telefono || telefono || '',
        documento: client?.documento || '',
      },
    });
  };

  const handleOpenPaymentReceipt = async (paymentItem) => {
    let orgData = { nombre: 'ZENDA', nit: '', logo: null };
    try {
      const db = await getDbConnection();
      const orgRows = await getData(db, 'SELECT * FROM organizaciones LIMIT 1');
      if (orgRows && orgRows.length > 0) {
        orgData = {
          nombre: orgRows[0].nombre || 'ZENDA',
          nit: orgRows[0].nit || '',
          logo: orgRows[0].logo_path || null,
        };
      }
    } catch {}

    const cliName = client ? `${client.nombre || ''} ${client.apellido || ''}`.trim() : clientName || 'Cliente';
    const cliDoc = client?.documento || '';
    const dateStr = paymentItem.payment_date || paymentItem.created_at || new Date().toISOString();

    setActiveReceipt({
      id: paymentItem.id,
      idFactura: invoiceId,
      clienteNombre: cliName,
      clienteDoc: cliDoc,
      fecha: dateStr,
      valor: paymentItem.amount,
      saldoRestante: invoice?.saldo ?? saldoActual,
      vendedorNombre: 'Vendedor',
      orgNombre: orgData.nombre,
      orgNit: orgData.nit,
      orgLogo: orgData.logo,
      metodo: (paymentItem.method || 'Efectivo'),
      isPendingSync: false,
    });
    setReceiptModalVisible(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={apple.colors.blue} />
          <Text style={styles.loadingText}>Cargando detalle...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="chevron-left" size={16} color={apple.colors.blue} />
          <Text style={styles.backText}>Cartera</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Detalle crédito</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Vista dividida en 2 bloques con scroll vertical independiente (Requisito 7) */}
      <View style={styles.twoBlockContainer}>
        {/* BLOQUE 1: Información del cliente y detalles del crédito (Scroll independiente) */}
        <View style={styles.blockOneWrapper}>
          <ScrollView
            style={styles.blockOneScroll}
            contentContainerStyle={styles.blockOneContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {/* Banner de Renovacion si el credito esta pagado */}
            {isCreditCompleted && (
              <View style={styles.renewalCard}>
                <View style={styles.renewalCardHeader}>
                  <View style={styles.renewalCardIcon}>
                    <Icon name="check-circle" size={18} color={apple.colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.renewalCardTitle}>Crédito Completado</Text>
                    <Text style={styles.renewalCardSub}>
                      El cliente terminó de pagar este crédito. Puedes otorgarle una renovación conservando su historial.
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.renewalBtn} onPress={handleRenewPress} activeOpacity={0.8}>
                  <Icon name="refresh" size={14} color="#fff" />
                  <Text style={styles.renewalBtnText}>Renovar crédito a este cliente</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Resumen cliente */}
            <AppleCard bordered={false} shadow={false} style={{ padding: 14, borderWidth: 0 }}>
              <View style={styles.clientHeader}>
                <View style={styles.avatar}>
                  <Icon name="user" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>
                    {client ? `${client.nombre || ''} ${client.apellido || ''}`.trim() : clientName || 'Cliente'}
                  </Text>
                  <Text style={styles.clientSub} numberOfLines={1}>
                    {client?.direccion || address || 'Sin dirección'} {client?.telefono ? `• ${client.telefono}` : telefono ? `• ${telefono}` : ''}
                  </Text>
                </View>
                {/* Boton GPS */}
                <TouchableOpacity
                  onPress={openMap}
                  style={[
                    styles.gpsBtn,
                    !hasCoords && { borderColor: apple.colors.tertiaryLabel, opacity: 0.5 },
                  ]}
                >
                  <Icon name="map-marker" size={14} color={hasCoords ? apple.colors.blue : apple.colors.tertiaryLabel} />
                </TouchableOpacity>
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>PRÉSTAMO</Text>
                  <Text style={styles.summaryVal}>
                    {invoice ? FormatMoneyDecimales(invoice.amount) : '—'}
                  </Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>SALDO</Text>
                  <Text
                    style={[
                      styles.summaryVal,
                      { color: saldoActual > 0 ? apple.colors.danger : apple.colors.success },
                    ]}
                  >
                    {FormatMoneyDecimales(saldoActual)}
                  </Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>ESTADO</Text>
                  <Text
                    style={[
                      styles.summaryVal,
                      {
                        fontSize: 12,
                        color: isCreditCompleted ? apple.colors.success : apple.colors.warning,
                      },
                    ]}
                  >
                    {(invoice?.status || (isCreditCompleted ? 'pagado' : 'pendiente')).toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Parámetros financieros: Periodicidad, Cuotas, Interés */}
              <View style={styles.financialParamRow}>
                <View style={styles.paramPill}>
                  <Text style={styles.paramLabel}>PERIODICIDAD</Text>
                  <Text style={styles.paramVal}>{invoice?.periodicidad || 'Diario'}</Text>
                </View>
                <View style={styles.paramPill}>
                  <Text style={styles.paramLabel}>CUOTAS</Text>
                  <Text style={styles.paramVal}>{invoice?.num_cuotas || cuotas.length || '—'}</Text>
                </View>
                <View style={styles.paramPill}>
                  <Text style={styles.paramLabel}>INTERÉS</Text>
                  <Text style={styles.paramVal}>{invoice?.tasa_interes ? `${invoice.tasa_interes}%` : '—'}</Text>
                </View>
              </View>

              {invoice?.pago_adelantado && (
                <View style={styles.advancePaymentNotice}>
                  <Icon name="check-circle" size={12} color={apple.colors.success} />
                  <Text style={styles.advancePaymentText}>1ª cuota cubierta con pago adelantado</Text>
                </View>
              )}

              {/* Botón de documento de identidad con foto */}
              {(client?.foto_documento_path || invoice?.foto_documento_path) && (
                <TouchableOpacity
                  style={styles.docEvidenceBtn}
                  onPress={() => setDocEvidenceModalVisible(true)}
                  activeOpacity={0.8}
                >
                  <View style={styles.docEvidenceLeft}>
                    <Icon name="id-card-o" size={14} color={apple.colors.blue} />
                    <Text style={styles.docEvidenceText}>Ver fotografía del documento</Text>
                  </View>
                  <Icon name="external-link" size={12} color={apple.colors.blue} />
                </TouchableOpacity>
              )}

              {/* Banner de previsualizacion de mapa si hay coordenadas */}
              {hasCoords ? (
                <TouchableOpacity onPress={openMap} style={styles.mapPreview}>
                  <Icon name="map" size={14} color={apple.colors.blue} />
                  <Text style={styles.mapText}>
                    Ver ubicación de venta ({Number(coords.lat).toFixed(4)}, {Number(coords.lng).toFixed(4)})
                  </Text>
                  <Icon name="external-link" size={12} color={apple.colors.blue} />
                </TouchableOpacity>
              ) : (
                <View style={styles.mapEmptyPreview}>
                  <Icon name="map-marker" size={13} color={apple.colors.tertiaryLabel} />
                  <Text style={styles.mapEmptyText}>Sin coordenadas GPS registradas</Text>
                </View>
              )}

              <View style={styles.clientMeta}>
                <Text style={styles.metaText}>
                  Doc: {client?.documento || '—'} • Alias: {client?.alias || '—'} • Cuotas: {cuotas.length}
                </Text>
              </View>
            </AppleCard>

            {/* Tabla cuotas */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>CUOTAS</Text>
              <Text style={styles.sectionCount}>{cuotas.length}</Text>
            </View>
            <AppleCard bordered={false} shadow={false} style={{ padding: 0, overflow: 'hidden', borderWidth: 0 }}>
              <View style={styles.tableHead}>
                <Text style={[styles.th, { flex: 0.6 }]}>#</Text>
                <Text style={[styles.th, { flex: 1.4 }]}>VENCIMIENTO</Text>
                <Text style={[styles.th, { flex: 1.2, textAlign: 'right' }]}>MONTO</Text>
                <Text style={[styles.th, { flex: 1.2, textAlign: 'center' }]}>ESTADO</Text>
              </View>
              {cuotas.length === 0 ? (
                <Text style={styles.emptyTable}>Sin cuotas registradas</Text>
              ) : (
                <FlatList
                  data={cuotas}
                  scrollEnabled={false}
                  keyExtractor={i => String(i.id)}
                  renderItem={({ item }) => (
                    <View style={styles.tr}>
                      <Text style={[styles.td, { flex: 0.6, fontWeight: '700' }]}>{item.numero ?? '—'}</Text>
                      <Text style={[styles.td, { flex: 1.4 }]}>
                        {item.fecha_vencimiento ? new Date(item.fecha_vencimiento).toLocaleDateString() : '—'}
                      </Text>
                      <Text style={[styles.td, { flex: 1.2, textAlign: 'right', fontWeight: '600' }]}>
                        {FormatMoneyDecimales(item.monto)}
                      </Text>
                      <View style={{ flex: 1.2, alignItems: 'center' }}>
                        <StatusBadge estado={item.estado} />
                      </View>
                    </View>
                  )}
                  ItemSeparatorComponent={() => <View style={styles.sep} />}
                />
              )}
            </AppleCard>
          </ScrollView>
        </View>

        {/* Separador entre bloques con barra visual */}
        <View style={styles.blockDivider}>
          <View style={styles.blockDividerHandle} />
        </View>

        {/* BLOQUE 2: Historial de pagos asociados (Scroll independiente) */}
        <View style={styles.blockTwoWrapper}>
          <View style={styles.blockTwoHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="history" size={13} color={apple.colors.blue} />
              <Text style={styles.sectionTitle}>HISTORIAL DE PAGOS</Text>
            </View>
            <Text style={styles.sectionCount}>
              {pagos.length} • {FormatMoneyDecimales(totalPagado)}
            </Text>
          </View>
          <AppleCard bordered={false} shadow={false} style={{ flex: 1, padding: 0, overflow: 'hidden', borderWidth: 0 }}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 1 }]}>FECHA</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>MONTO</Text>
              <Text style={[styles.th, { flex: 0.8, textAlign: 'center' }]}>MÉTODO</Text>
              <Text style={[styles.th, { width: 36, textAlign: 'center' }]}></Text>
            </View>
            {pagos.length === 0 ? (
              <View style={{ padding: 24, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="money" size={24} color={apple.colors.tertiaryLabel} />
                <Text style={styles.emptyTable}>Sin pagos registrados aún</Text>
              </View>
            ) : (
              <FlatList
                data={pagos}
                scrollEnabled={true}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
                keyExtractor={i => String(i.id)}
                renderItem={({ item }) => (
                  <View style={styles.tr}>
                    <Text style={[styles.td, { flex: 1 }]}>
                      {item.payment_date ? new Date(item.payment_date).toLocaleDateString() : new Date(item.created_at || Date.now()).toLocaleDateString()}
                    </Text>
                    <Text style={[styles.td, { flex: 1, textAlign: 'right', fontWeight: '700', color: apple.colors.success }]}>
                      {FormatMoneyDecimales(item.amount)}
                    </Text>
                    <Text style={[styles.td, { flex: 0.8, textAlign: 'center' }]}>
                      {(item.method || '—').toUpperCase()}
                    </Text>
                    <TouchableOpacity
                      style={styles.paymentReceiptIconBtn}
                      onPress={() => handleOpenPaymentReceipt(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="file-text-o" size={14} color={apple.colors.blue} />
                    </TouchableOpacity>
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                contentContainerStyle={{ paddingBottom: 16 }}
              />
            )}
          </AppleCard>
        </View>
      </View>

      <EvidencePreviewModal
        visible={docEvidenceModalVisible}
        onClose={() => setDocEvidenceModalVisible(false)}
        readOnly={true}
        initialUri={client?.foto_documento_path || invoice?.foto_documento_path}
        title="Documento de Identidad"
      />
      <PaymentReceiptModal
        visible={receiptModalVisible}
        onClose={() => setReceiptModalVisible(false)}
        receiptData={activeReceipt}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: apple.colors.bgGrouped },
  twoBlockContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  blockOneWrapper: {
    flex: 1.15,
    backgroundColor: apple.colors.bgGrouped,
  },
  blockOneScroll: {
    flex: 1,
  },
  blockOneContent: {
    padding: 16,
    paddingBottom: 20,
  },
  blockDivider: {
    height: 12,
    backgroundColor: '#E5E5EA',
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: apple.colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockDividerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C7C7CC',
  },
  blockTwoWrapper: {
    flex: 1,
    backgroundColor: apple.colors.bgGrouped,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  blockTwoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 8, color: apple.colors.secondaryLabel },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: apple.colors.card,
    borderBottomWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: apple.colors.blue, fontSize: 15 },
  headerTitle: { fontSize: 15, fontWeight: '600', color: apple.colors.label, flex: 1, textAlign: 'center' },
  clientHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: apple.radius.l, backgroundColor: apple.colors.blue, alignItems: 'center', justifyContent: 'center' },
  clientName: { fontSize: 16, fontWeight: '700', color: apple.colors.label },
  clientSub: { fontSize: 12, color: apple.colors.secondaryLabel, marginTop: 1 },
  gpsBtn: {
    width: 32,
    height: 32,
    borderRadius: apple.radius.l,
    borderWidth: 1.2,
    borderColor: apple.colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
  },
  summaryRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  summaryBox: { flex: 1, backgroundColor: apple.colors.fill, borderRadius: apple.radius.m, padding: 10, alignItems: 'center' },
  summaryLabel: { fontSize: 10, fontWeight: '700', color: apple.colors.secondaryLabel, letterSpacing: 0.5 },
  summaryVal: { fontSize: 13, fontWeight: '800', color: apple.colors.label, marginTop: 3 },
  mapPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: apple.radius.m,
  },
  mapText: { flex: 1, fontSize: 12, fontWeight: '600', color: apple.colors.blue },
  mapEmptyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: apple.colors.fill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: apple.radius.m,
  },
  mapEmptyText: { fontSize: 11, color: apple.colors.tertiaryLabel, fontStyle: 'italic' },
  clientMeta: { marginTop: 8 },
  metaText: { fontSize: 11, color: apple.colors.tertiaryLabel },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 6, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: apple.colors.secondaryLabel, letterSpacing: 0.5 },
  sectionCount: { fontSize: 11, color: apple.colors.tertiaryLabel, backgroundColor: apple.colors.fill, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  tableHead: { flexDirection: 'row', backgroundColor: apple.colors.fill, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.5, borderColor: apple.colors.separator },
  th: { fontSize: 10, fontWeight: '700', color: apple.colors.secondaryLabel, letterSpacing: 0.5 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  td: { fontSize: 13, color: apple.colors.label },
  sep: { height: 0.5, backgroundColor: apple.colors.separator, marginLeft: 12 },
  emptyTable: { textAlign: 'center', padding: 16, color: apple.colors.tertiaryLabel, fontSize: 13 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },

  // Tarjeta de Renovacion (Requisito 10)
  renewalCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
    borderRadius: apple.radius.l,
    padding: 14,
    marginBottom: 12,
  },
  renewalCardHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  renewalCardIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renewalCardTitle: { fontSize: 14, fontWeight: '700', color: '#065F46' },
  renewalCardSub: { fontSize: 12, color: '#047857', marginTop: 2, lineHeight: 16 },
  renewalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    borderRadius: apple.radius.m,
    paddingVertical: 10,
    marginTop: 12,
    shadowColor: '#059669',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  renewalBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  financialParamRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  paramPill: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E8EAED',
    borderRadius: apple.radius.m,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  paramLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: apple.colors.secondaryLabel,
    letterSpacing: 0.3,
  },
  paramVal: {
    fontSize: 12,
    fontWeight: '800',
    color: apple.colors.label,
    marginTop: 2,
  },
  advancePaymentNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: apple.radius.m,
    marginTop: 8,
  },
  advancePaymentText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },
  docEvidenceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: apple.radius.m,
    marginTop: 8,
  },
  docEvidenceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docEvidenceText: {
    fontSize: 12,
    fontWeight: '700',
    color: apple.colors.blue,
  },
  paymentReceiptIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F7FF',
    borderWidth: 1,
    borderColor: '#D0E4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
