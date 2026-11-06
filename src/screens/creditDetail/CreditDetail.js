import AppBackground from '../../components/AppBackground';
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
    pagada: { bg: '#ECFDF5', border: '#A7F3D0', color: '#059669', label: 'PAGADA' },
    pagado: { bg: '#ECFDF5', border: '#A7F3D0', color: '#059669', label: 'PAGADA' },
    abonada: { bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', label: 'ABONADA' },
    parcial: { bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', label: 'ABONADA' },
    pendiente: { bg: '#F1F3F7', border: '#EAECF0', color: '#667085', label: 'PENDIENTE' },
    vencida: { bg: '#FEF2F2', border: '#FECACA', color: '#EE272D', label: 'VENCIDA' },
  };
  const s = map[(estado || '').toLowerCase()] || map.pendiente;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg, borderColor: s.border, borderWidth: 1 }]}>
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
            `SELECT id, valor AS amount, horaDispositivo AS payment_date, tipo AS method, estadoMovil
             FROM pagos WHERE idFactura = ? AND (tipo IS NULL OR tipo != 'nopago') ORDER BY horaDispositivo DESC, id DESC`,
            [invoiceId]
          );

          var initialPagos = (localPagos || []).map(p => ({
            id: p.id,
            amount: Number(p.amount || 0),
            payment_date: p.payment_date,
            method: p.method,
            estadoMovil: p.estadoMovil,
          }));

          if (initialPagos.length === 0 && row.pagos) {
            try {
              const parsed = typeof row.pagos === 'string' ? JSON.parse(row.pagos) : row.pagos;
              if (Array.isArray(parsed) && parsed.length > 0) {
                initialPagos = parsed
                  .filter(p => (p.tipo || p.method) !== 'nopago' && Number(p.amount || p.valor || 0) > 0)
                  .map((p, idx) => ({
                    id: p.id || `remote-${idx}`,
                    amount: Number(p.amount || p.valor || 0),
                    payment_date: p.payment_date || p.horaDispositivo || p.created_at,
                    method: p.method || p.tipo || 'efectivo',
                    estadoMovil: 'sincronizado',
                  }));
              }
            } catch {}
          }
          setPagos(initialPagos);

          let localCuotas = await getData(
            db,
            `SELECT id, numero, fecha_vencimiento, monto, estado, monto_pagado
             FROM cuotas WHERE invoice_id = ? ORDER BY numero ASC`,
            [invoiceId]
          );
          if ((!localCuotas || localCuotas.length === 0) && row.num_cuotas && Number(row.num_cuotas) > 0) {
            try {
              const total = Number(row.valorInicial || row.saldo || 0);
              const vCuota = Number(row.valorCuota || 0);
              const nCuotas = Number(row.num_cuotas);
              const pagas = Number(row.cuotasPagas || 0);
              if (nCuotas > 0 && total > 0) {
                const cMonto = Math.floor(total / nCuotas);
                const cResto = total - (cMonto * (nCuotas - 1));
                for (let i = 1; i <= nCuotas; i++) {
                  const val = (i === nCuotas) ? cResto : cMonto;
                  const isYaPaga = i <= pagas;
                  await db.executeSql(
                    `INSERT OR IGNORE INTO cuotas (id, invoice_id, numero, fecha_vencimiento, monto, estado, monto_pagado)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [`cuota_${invoiceId}_${i}`, String(invoiceId), i, row.fecha || new Date().toISOString().slice(0, 10), val, isYaPaga ? 'pagada' : 'pendiente', isYaPaga ? val : 0]
                  );
                }
                localCuotas = await getData(db, `SELECT id, numero, fecha_vencimiento, monto, estado, monto_pagado FROM cuotas WHERE invoice_id = ? ORDER BY numero ASC`, [invoiceId]);
              }
            } catch (errSyn) {
              console.log('Error sintetizando cuotas en CreditDetail:', errSyn);
            }
          }
          if (localCuotas && localCuotas.length > 0) {
            if (Number(row.saldo) <= 0 || (row.estado || '').toLowerCase() === 'pagado' || (row.estado || '').toLowerCase() === 'pagada') {
              setCuotas(localCuotas.map(c => ({ ...c, estado: 'pagada', monto_pagado: c.monto })));
            } else {
              setCuotas(localCuotas);
            }
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

            // Verificar si hay pagos pendientes locales antes de sobreescribir cuotas
            const pendCheck = await getData(
              db,
              `SELECT COUNT(*) as c FROM pagos WHERE idFactura = ? AND estadoMovil != 'sincronizado'`,
              [invoiceId]
            );
            const hasPendingOffline = Number(pendCheck?.[0]?.c || 0) > 0;

            if (cs && cs.length > 0 && !hasPendingOffline) {
              const isPaidInFull = (inv.saldo != null && Number(inv.saldo) <= 0) || (inv.status || '').toLowerCase() === 'pagado';
              if (isPaidInFull) {
                const pagadas = cs.map(c => ({ ...c, estado: 'pagada', monto_pagado: c.monto }));
                setCuotas(pagadas);
                for (const itemC of pagadas) {
                  try {
                    await db.executeSql(
                      `INSERT OR REPLACE INTO cuotas (id, invoice_id, numero, fecha_vencimiento, monto, estado, monto_pagado)
                       VALUES (?, ?, ?, ?, ?, ?, ?)`,
                      [String(itemC.id), String(invoiceId), itemC.numero, itemC.fecha_vencimiento, Number(itemC.monto), 'pagada', Number(itemC.monto)]
                    );
                  } catch {}
                }
              } else {
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
            }

            const { data: ps } = await supabase
              .from('payments')
              .select('id, amount, payment_date, method, created_at')
              .eq('invoice_id', invoiceId)
              .gt('amount', 0)
              .order('payment_date', { ascending: false });
            if (ps) {
              const remotePagos = ps.map(p => ({
                id: p.id,
                amount: Number(p.amount || 0),
                payment_date: p.payment_date || p.created_at,
                method: p.method,
              }));
              const pendingLocal = (typeof initialPagos !== 'undefined' ? initialPagos : []).filter(lp => lp.estadoMovil !== 'sincronizado' && Number(lp.amount) > 0);
              const remoteIds = new Set(remotePagos.map(p => String(p.id)));
              const unSynced = pendingLocal.filter(lp => !remoteIds.has(String(lp.id)) && (!lp.sync_id || !remoteIds.has(String(lp.sync_id))));
              setPagos([...unSynced, ...remotePagos]);
            }
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
  const isCreditCompleted = saldoActual <= 0 || (invoice?.status || '').toLowerCase() === 'pagado' || (invoice?.status || '').toLowerCase() === 'pagada';

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
      <AppBackground />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={apple.colors.blue} />
          <Text style={styles.loadingText}>Cargando detalle...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="chevron-left" size={16} color="#EE272D" />
          <Text style={styles.backText}>Cartera</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Detalle de Crédito</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Vista dividida en 2 bloques con scroll vertical independiente */}
      <View style={styles.twoBlockContainer}>
        {/* BLOQUE 1: Información del cliente y detalles del crédito */}
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
                    <Icon name="check-circle" size={18} color="#059669" />
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
            <View style={styles.cardContainer}>
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
                    hasCoords ? styles.gpsBtnActive : styles.gpsBtnInactive,
                  ]}
                >
                  <Icon name="map-marker" size={16} color={hasCoords ? '#EE272D' : '#98A2B3'} />
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
                      { color: saldoActual > 0 ? '#EE272D' : '#10B981' },
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
                        color: isCreditCompleted ? '#10B981' : '#F59E0B',
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
                  <Icon name="check-circle" size={12} color="#059669" />
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
                    <Icon name="id-card-o" size={14} color="#EE272D" />
                    <Text style={styles.docEvidenceText}>Ver fotografía del documento</Text>
                  </View>
                  <Icon name="external-link" size={12} color="#667085" />
                </TouchableOpacity>
              )}

              {/* Banner de previsualizacion de mapa si hay coordenadas */}
              {hasCoords ? (
                <TouchableOpacity onPress={openMap} style={styles.mapPreview}>
                  <Icon name="map-marker" size={14} color="#EE272D" />
                  <Text style={styles.mapText}>
                    Ver ubicación GPS ({Number(coords.lat).toFixed(4)}, {Number(coords.lng).toFixed(4)})
                  </Text>
                  <Icon name="external-link" size={12} color="#EE272D" />
                </TouchableOpacity>
              ) : (
                <View style={styles.mapEmptyPreview}>
                  <Icon name="map-marker" size={13} color="#98A2B3" />
                  <Text style={styles.mapEmptyText}>Sin coordenadas GPS registradas</Text>
                </View>
              )}

              <View style={styles.clientMeta}>
                <Text style={styles.metaText}>
                  Doc: {client?.documento || '—'} • Alias: {client?.alias || '—'} • Total cuotas: {cuotas.length}
                </Text>
              </View>
            </View>

            {/* Tabla cuotas */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>TABLA DE CUOTAS</Text>
              <View style={styles.countPill}>
                <Text style={styles.sectionCountText}>{cuotas.length}</Text>
              </View>
            </View>
            <View style={styles.tableCardContainer}>
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
                      <Text style={[styles.td, { flex: 1.2, textAlign: 'right', fontWeight: '700', color: '#1E1E1F' }]}>
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
            </View>
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
              <Icon name="history" size={14} color="#EE272D" />
              <Text style={styles.sectionTitle}>HISTORIAL DE PAGOS</Text>
            </View>
            <View style={styles.totalPagosBadge}>
              <Text style={styles.totalPagosText}>
                {pagos.length} • {FormatMoneyDecimales(totalPagado)}
              </Text>
            </View>
          </View>
          <View style={[styles.tableCardContainer, { flex: 1 }]}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 1 }]}>FECHA</Text>
              <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>MONTO</Text>
              <Text style={[styles.th, { flex: 0.8, textAlign: 'center' }]}>MÉTODO</Text>
              <Text style={[styles.th, { width: 36, textAlign: 'center' }]}></Text>
            </View>
            {pagos.length === 0 ? (
              <View style={{ padding: 24, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="money" size={24} color="#98A2B3" />
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
                    <Text style={[styles.td, { flex: 1, color: '#1E1E1F' }]}>
                      {item.payment_date ? new Date(item.payment_date).toLocaleDateString() : new Date(item.created_at || Date.now()).toLocaleDateString()}
                    </Text>
                    <Text style={[styles.td, { flex: 1, textAlign: 'right', fontWeight: '700', color: '#10B981' }]}>
                      {FormatMoneyDecimales(item.amount)}
                    </Text>
                    <Text style={[styles.td, { flex: 0.8, textAlign: 'center', color: '#667085', fontSize: 12 }]}>
                      {(item.method || '—').toUpperCase()}
                    </Text>
                    <TouchableOpacity
                      style={styles.paymentReceiptIconBtn}
                      onPress={() => handleOpenPaymentReceipt(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="file-text-o" size={13} color="#EE272D" />
                    </TouchableOpacity>
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                contentContainerStyle={{ paddingBottom: 16 }}
              />
            )}
          </View>
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
  root: { flex: 1, backgroundColor: 'transparent' },
  twoBlockContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  blockOneWrapper: {
    flex: 1.15,
    backgroundColor: 'transparent',
  },
  blockOneScroll: {
    flex: 1,
  },
  blockOneContent: {
    padding: 16,
    paddingBottom: 20,
  },
  blockDivider: {
    height: 10,
    backgroundColor: '#F2F4F8',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#EAECF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockDividerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D0D5DD',
  },
  blockTwoWrapper: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  blockTwoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 8, color: '#667085', fontSize: 13 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.90)',
    borderBottomWidth: 1,
    borderColor: 'rgba(234, 236, 240, 0.8)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  backText: { color: '#EE272D', fontSize: 15, fontWeight: '700' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#1E1E1F', flex: 1, textAlign: 'center' },
  cardContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(216, 220, 228, 0.85)',
    padding: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 0,
      },
    }),
  },
  clientHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EE272D', alignItems: 'center', justifyContent: 'center' },
  clientName: { fontSize: 16, fontWeight: '800', color: '#1E1E1F' },
  clientSub: { fontSize: 12, color: '#667085', marginTop: 1 },
  gpsBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsBtnActive: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  gpsBtnInactive: {
    backgroundColor: '#F1F3F7',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  summaryBox: {
    flex: 1,
    backgroundColor: 'rgba(248, 249, 250, 0.75)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(234, 236, 240, 0.8)',
    overflow: 'hidden',
    padding: 10,
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 10, fontWeight: '700', color: '#667085', letterSpacing: 0.5 },
  summaryVal: { fontSize: 13, fontWeight: '800', color: '#1E1E1F', marginTop: 3 },
  mapPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  mapText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#EE272D' },
  mapEmptyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EAECF0',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  mapEmptyText: { fontSize: 11, color: '#98A2B3', fontStyle: 'italic' },
  clientMeta: { marginTop: 8 },
  metaText: { fontSize: 11, color: '#8E8E93' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#667085', letterSpacing: 0.5 },
  countPill: { backgroundColor: '#F1F3F7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  sectionCountText: { fontSize: 11, fontWeight: '700', color: '#667085' },
  totalPagosBadge: { backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  totalPagosText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  tableCardContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(216, 220, 228, 0.85)',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#101828',
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 0,
      },
    }),
  },
  tableHead: { flexDirection: 'row', backgroundColor: 'rgba(248, 249, 250, 0.75)', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderColor: 'rgba(234, 236, 240, 0.8)' },
  th: { fontSize: 10, fontWeight: '700', color: '#667085', letterSpacing: 0.5 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  td: { fontSize: 13, color: '#1E1E1F' },
  sep: { height: 1, backgroundColor: '#EAECF0', marginLeft: 12 },
  emptyTable: { textAlign: 'center', padding: 16, color: '#98A2B3', fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  // Tarjeta de Renovacion
  renewalCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 14,
    overflow: 'hidden',
    padding: 14,
    marginBottom: 12,
    ...Platform.select({
      android: { elevation: 0 },
    }),
  },
  renewalCardHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  renewalCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renewalCardTitle: { fontSize: 14, fontWeight: '800', color: '#065F46' },
  renewalCardSub: { fontSize: 12, color: '#047857', marginTop: 2, lineHeight: 16 },
  renewalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    borderRadius: 10,
    overflow: 'hidden',
    paddingVertical: 10,
    marginTop: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#10B981',
        shadowOpacity: 0.2,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        elevation: 0,
      },
    }),
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
    borderColor: '#EAECF0',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  paramLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#667085',
    letterSpacing: 0.3,
  },
  paramVal: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E1E1F',
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
    borderRadius: 10,
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
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#EAECF0',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
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
    color: '#1E1E1F',
  },
  paymentReceiptIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
