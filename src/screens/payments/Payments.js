import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import ItemPayments from './components/itemPayments';
import { getData, getDbConnection } from '../../database/db';

const StatsCard = ({ pending, processed, pendingAmount, collected, progress }) => (
  <View style={styles.statsContainer}>
    <View style={styles.statsRow}>
      <View style={styles.statBox}>
        <Text style={styles.statLabel}>Visitas</Text>
        <Text style={styles.statNumber}>
          {processed} <Text style={styles.statNumberDivider}>/</Text> {pending}
        </Text>
      </View>
      <View style={styles.statBox}>
        <Text style={styles.statLabel}>Recaudos</Text>
        <Text style={styles.statNumber}>
          ${collected} <Text style={styles.statNumberDivider}>/</Text> ${pendingAmount}
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

const Payments = () => {
  const [showPending, setShowPending] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  // Cargar datos desde la base de datos
  useEffect(() => {
    const loadClients = async () => {
      try {
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
            strftime('%H:%M', fecha) AS time
          FROM facturas
          WHERE estadoMovil IS NOT NULL`
        );

        // Normalizar datos
        const normalized = data.map(item => ({
          ...item,
          id: item.id,
          name: item.name?.trim() || 'Sin nombre',
          address: item.address?.trim() || 'Sin dirección',
          amount: Number(item.amount) || 0,
          status: (item.status || '').toUpperCase().trim(),
          estadoPago: (item.estadoPago || '').toLowerCase().trim(),
          paymentType: mapPaymentType(item.paymentType),
          time: item.time || 'Sin hora',
        }));

        console.log('Facturas cargadas:', normalized);
        setClients(normalized);
      } catch (error) {
        console.error('Error cargando facturas:', error);
      } finally {
        setLoading(false);
      }
    };

    loadClients();
  }, []);

  // Mapeo de paymentTermId a texto legible
  const mapPaymentType = (id) => {
    const types = { 1: 'MENSUAL', 2: 'SEMANAL', 3: 'QUINCENAL' };
    return types[id] || 'DESCONOCIDO';
  };

  // Calcular estadísticas dinámicamente
  const stats = useMemo(() => {
    const pendingVisits = clients.filter(c => c.status === 'PENDIENTE');
    const processedVisits = clients.filter(c => c.status === 'VISITADO');

    const pendingAmount = pendingVisits.reduce((sum, c) => sum + c.amount, 0);
    const collected = processedVisits
      .filter(c => c.estadoPago === 'pago' || c.estadoPago === 'parcial')
      .reduce((sum, c) => sum + c.amount, 0);

    const totalVisits = clients.length;
    const progress = totalVisits > 0
      ? Math.round((processedVisits.length / totalVisits) * 100)
      : 0;

    return {
      pending: pendingVisits.length,
      processed: processedVisits.length,
      pendingAmount,
      collected,
      progress,
    };
  }, [clients]);

  // Filtrar clientes
  const filteredClients = useMemo(() => {
    return clients.filter(c =>
      (showPending
        ? c.status === 'PENDIENTE'
        : c.status === 'VISITADO') &&
      c.name.toLowerCase().includes(searchText.toLowerCase())
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
          onValueChange={() => setShowPending(!showPending)}
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
        <ScrollView style={styles.content}>
          {filteredClients.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {searchText
                  ? 'No se encontraron resultados'
                  : showPending
                    ? 'No hay clientes pendientes'
                    : 'No hay clientes tramitados'}
              </Text>
            </View>
          ) : (
            filteredClients.map((client) => (
              <ItemPayments key={client.id} {...client} />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

export default Payments;

// ESTILOS ORIGINALES (exactamente como los tenías)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
  },
  statsContainer: {
    padding: 12,
    backgroundColor: '#fff',
    margin: 10,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#E0E0E0',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  statNumberDivider: {
    color: '#999',
  },
  progressContainer: {
    marginTop: 8,
    alignItems: 'center',
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
});