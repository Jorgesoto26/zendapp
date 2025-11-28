import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Switch,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import ItemPayments from './components/itemPayments';
import { getData, getDbConnection } from '../../database/db';
import { FormatMoneyDecimales } from '../../utils/utilities';

// === COMPONENTE: Tarjeta de Estadísticas ===
const StatsCard = ({ pending, processed, pendingAmount, collected, progress }) => (
  <View style={styles.statsContainer}>
    <View style={styles.statsRow}>
      <View style={[styles.statBox,{width:'30%'}]}>
        <Text style={styles.statLabel}>Visitas</Text>
        <Text style={styles.statNumber}>
          {processed} <Text style={styles.statNumberDivider}>/</Text> {pending}
        </Text>
      </View>
      <View style={[styles.statBox,{width:'70%'}]}>
        <Text style={styles.statLabel}>Recaudos</Text>
        <Text style={styles.statNumber}>
          {FormatMoneyDecimales(collected)} <Text style={styles.statNumberDivider}>/</Text> {FormatMoneyDecimales(pendingAmount)}
        </Text>
      </View>
    </View>

    <View style={styles.progressContainer}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <Text style={styles.progressText}>{progress}% completado</Text>
    </View>
  </View>
);

// === FUNCIÓN PURA: Mapeo de tipo de pago ===
const mapPaymentType = (id) => {
  const types = { 1: 'MENSUAL', 2: 'SEMANAL', 3: 'QUINCENAL' };
  return types[id] || 'DESCONOCIDO';
};

// === FUNCIÓN PURA: Normalizar datos de factura ===
const normalizeClient = (item) => ({
  id: item.id,
  name: (item.name?.trim() || 'Sin nombre'),
  address: (item.address?.trim() || 'Sin dirección'),
  amount: Number(item.amount) || 0,
  status: (item.status || '').toUpperCase().trim(),
  estadoPago: (item.estadoPago || '').toLowerCase().trim(),
  estadoMovil: (item.status || '').toLowerCase().trim(),
  paymentType: mapPaymentType(item.paymentType),
  time: item.time || 'Sin hora',
  saldo: Number(item.saldo) || 0,
  cuotasPagas: Number(item.cuotasPagas) || 0,
  saldoVencido: Number(item.saldoVencido) || 0,
  nombreUno: item.nombreUno?.trim() || '',
  apellidoUno: item.apellidoUno?.trim() || '',
});

// === FUNCIÓN: Cargar clientes desde DB ===
const loadClientsFromDB = async () => {
  const db = await getDbConnection();
  const data = await getData(
    db,
    `SELECT
         id,
         nombreUno || ' ' || COALESCE(apellidoUno, '') AS name,
         direccion AS address,
         valorCuota AS amount,
         estadoMovil AS status,
         estado AS estadoPago,
         paymentTermId AS paymentType,
         strftime('%H:%M', fecha) AS time,
         saldo,
         cuotasPagas,
         saldoVencido,
         nombreUno,
         apellidoUno
       FROM facturas
       WHERE estadoMovil IS NOT NULL`
  );

  return data.map(normalizeClient);
};

// === FUNCIÓN: Calcular estadísticas reales desde detallesCaja ===
const calculateStats = async (clients) => {
  const db = await getDbConnection();
  const pagos = await getData(db, `
    SELECT SUM(valor) as total 
    FROM detallesCaja 
    WHERE tipo = 'pago'
  `);
  const collected = Number(pagos[0]?.total || 0);

  const processed = clients.filter(c => c.estadoMovil === 'actualizado');
  const pendingAmount = clients.reduce((s, c) => s + c.amount, 0);
  const totalVisits = clients.length;
  const progress = totalVisits > 0
    ? Math.round((processed.length / totalVisits) * 100)
    : 0;

  return {
    pending: totalVisits,
    processed: processed.length,
    pendingAmount,
    collected,
    progress,
  };
};

// === COMPONENTE PRINCIPAL ===
const Payments = () => {
  const [showPending, setShowPending] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({
    pending: 0,
    processed: 0,
    pendingAmount: 0,
    collected: 0,
    progress: 0,
  });
  const [loading, setLoading] = useState(true);

  // === CARGAR CLIENTES + ESTADÍSTICAS ===
  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const normalizedClients = await loadClientsFromDB();
      setClients(normalizedClients);
      const newStats = await calculateStats(normalizedClients);
      setStats(newStats);
    } catch (error) {
      console.error('Error cargando facturas:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Cargar al montar
  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // === RECARGAR TRAS CUALQUIER PAGO ===
  const handlePaymentSuccess = useCallback(() => {
    loadClients(); // ← Recarga todo: clientes + estadísticas reales
  }, [loadClients]);

  // === FILTRAR CLIENTES ===
  const filteredClients = useMemo(() => {
    return clients.filter(client =>
      (showPending
        ? (client.estadoMovil === 'pendiente' && client.saldo > 0 && client.estadoPago !== 'cancel')
        : client.estadoMovil === 'actualizado'
      ) &&
      client.name.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [clients, showPending, searchText]);

  return (
    <SafeAreaView style={styles.container}>
      <StatsCard {...stats} />

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>
          {showPending ? 'Clientes por Visitar' : 'Clientes Tramitados'}
        </Text>
        <Switch
          value={!showPending}
          onValueChange={() => setShowPending(prev => !prev)}
          thumbColor="#2196F3"
          trackColor={{ false: '#ccc', true: '#2196F3' }}
        />
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Buscar cliente..."
        placeholderTextColor="#999"
        value={searchText}
        onChangeText={setSearchText}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Cargando clientes...</Text>
        </View>
      ) : (
        <FlatList
          style={styles.content}
          data={filteredClients}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <ItemPayments
              id={item.id}
              name={item.name}
              address={item.address}
              amount={item.amount}
              status={item.status}
              time={item.time}
              paymentType={item.paymentType}
              estadoPago={item.estadoPago}
              saldo={item.saldo}
              cuotasPagas={item.cuotasPagas}
              saldoVencido={item.saldoVencido}
              nombreUno={item.nombreUno}
              apellidoUno={item.apellidoUno}
              valorCuota={item.amount} 
              estadoMovil={item.estadoMovil}
              onPaymentSuccess={handlePaymentSuccess}
            />
          )}
          getItemLayout={(data, index) => ({
            length: 120,
            offset: 120 * index,
            index,
          })}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={21}
          removeClippedSubviews={true}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {searchText
                  ? 'No se encontraron resultados'
                  : showPending
                    ? 'No hay clientes pendientes'
                    : 'No hay clientes tramitados'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

export default Payments;

// === ESTILOS ===
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { flex: 1 },
  statsContainer: {
    padding: 12,
    backgroundColor: '#fff',
    margin: 10,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#E0E0E0',
  },
  statsRow: { flexDirection: 'row', marginBottom: 8 },
  statBox: {  alignItems: 'center' },
  statLabel: { fontSize: 14, color: '#666', marginBottom: 4 },
  statNumber: { fontSize: 18, fontWeight: '600', color: '#333' },
  statNumberDivider: { color: '#999' },
  progressContainer: { marginTop: 8, alignItems: 'center' },
  progressBar: { width: '100%', height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#4CAF50', borderRadius: 3 },
  progressText: { fontSize: 12, color: '#666', marginTop: 4 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  listTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  searchInput: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
    color: '#333',
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  emptyContainer: { padding: 30, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999', textAlign: 'center' },
});