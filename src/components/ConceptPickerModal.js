// src/components/ConceptPickerModal.js
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../theme/appleTheme';
import { getDbConnection, getData } from '../database/db';
import { supabase } from '../lib/supabase';

export default function ConceptPickerModal({
  visible,
  onClose,
  tipoMovimiento = 'gasto',
  selectedId,
  selectedConceptId,
  onSelect,
  onSelectConcept,
}) {
  const [concepts, setConcepts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const activeSelectedId = selectedId !== undefined ? selectedId : selectedConceptId;
  const handleSelect = onSelect || onSelectConcept;

  useEffect(() => {
    async function loadConcepts() {
      setLoading(true);
      try {
        const db = await getDbConnection();

        // 1. Consultar conceptos parametrizados desde la base de datos local SQLite
        let rows = [];
        try {
          await db.executeSql(`CREATE TABLE IF NOT EXISTS concepts (
            id INTEGER PRIMARY KEY,
            tipo TEXT,
            valor TEXT,
            nombre TEXT,
            tipo_movimiento TEXT,
            activo INTEGER DEFAULT 1,
            orden INTEGER DEFAULT 0,
            organizacion_id TEXT
          )`);
          rows = await getData(
            db,
            `SELECT id, COALESCE(nombre, valor) AS nombre, tipo_movimiento, activo
             FROM concepts
             WHERE (tipo_movimiento = ? OR tipo = ?) AND (activo = 1 OR activo IS NULL OR activo = 'true')
             ORDER BY COALESCE(orden, id) ASC`,
            [tipoMovimiento, tipoMovimiento]
          );
        } catch (eSqlite) {
          console.log('ConceptPickerModal SQLite query warning:', eSqlite);
          rows = [];
        }

        // 2. Si no hay conceptos locales, consultar la tabla parametrizada de Supabase
        if (!rows || rows.length === 0) {
          try {
            const { data: remoteConcepts, error: remErr } = await supabase
              .from('concepts')
              .select('id, tipo, valor, nombre, tipo_movimiento, activo, orden')
              .or(`tipo_movimiento.eq.${tipoMovimiento},tipo.eq.${tipoMovimiento}`)
              .order('orden', { ascending: true });

            if (!remErr && remoteConcepts && remoteConcepts.length > 0) {
              rows = remoteConcepts.map(c => ({
                id: c.id,
                nombre: c.nombre || c.valor,
                tipo_movimiento: c.tipo_movimiento || c.tipo,
                activo: c.activo,
              }));

              // Cachear en SQLite para funcionamiento offline
              for (const rc of remoteConcepts) {
                try {
                  await db.executeSql(
                    `INSERT OR REPLACE INTO concepts (id, tipo, valor, nombre, tipo_movimiento, activo, orden)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [rc.id, rc.tipo, rc.valor, rc.nombre || rc.valor, rc.tipo_movimiento || rc.tipo, rc.activo ? 1 : 0, rc.orden || 0]
                  );
                } catch {}
              }
            }
          } catch (eRemote) {
            console.log('Error consultando conceptos desde Supabase:', eRemote);
          }
        }

        setConcepts(rows || []);
      } catch (err) {
        console.log('Error cargando conceptos parametrizados:', err);
        setConcepts([]);
      } finally {
        setLoading(false);
      }
    }

    if (visible) {
      loadConcepts();
      setSearch('');
    }
  }, [visible, tipoMovimiento]);

  const filtered = concepts.filter(c =>
    (c.nombre || '').toLowerCase().includes(search.toLowerCase().trim())
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Seleccionar Concepto</Text>
              <Text style={styles.subTitle}>Parametrizado desde la base de datos ({tipoMovimiento})</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="times" size={16} color={apple.colors.secondaryLabel} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <Icon name="search" size={13} color={apple.colors.tertiaryLabel} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar concepto..."
              placeholderTextColor={apple.colors.tertiaryLabel}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          {/* List */}
          {loading && concepts.length === 0 ? (
            <View style={{ padding: 30, alignItems: 'center' }}>
              <ActivityIndicator color={apple.colors.blue} size="small" />
              <Text style={{ marginTop: 8, fontSize: 13, color: apple.colors.secondaryLabel }}>
                Cargando conceptos de la base de datos...
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={item => String(item.id)}
              renderItem={({ item }) => {
                const isSelected = String(item.id) === String(activeSelectedId);
                return (
                  <TouchableOpacity
                    style={[styles.itemRow, isSelected && styles.itemRowSelected]}
                    onPress={() => {
                      handleSelect?.(item);
                      onClose();
                    }}
                  >
                    <View style={[styles.itemDot, isSelected && styles.itemDotSelected]} />
                    <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>
                      {item.nombre}
                    </Text>
                    {isSelected && <Icon name="check" size={14} color={apple.colors.blue} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Icon name="tags" size={24} color={apple.colors.tertiaryLabel} />
                  <Text style={[styles.emptyText, { marginTop: 8 }]}>
                    No hay conceptos parametrizados en la base de datos.
                  </Text>
                </View>
              }
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: apple.colors.label,
  },
  subTitle: {
    fontSize: 12,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 14,
    backgroundColor: apple.colors.fill,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.fill,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: apple.colors.label,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: apple.colors.separator,
    gap: 12,
  },
  itemRowSelected: {
    backgroundColor: '#F0F8FF',
  },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: apple.colors.tertiaryLabel,
  },
  itemDotSelected: {
    backgroundColor: apple.colors.blue,
  },
  itemText: {
    flex: 1,
    fontSize: 15,
    color: apple.colors.label,
  },
  itemTextSelected: {
    color: apple.colors.blue,
    fontWeight: '600',
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: apple.colors.secondaryLabel,
    fontSize: 14,
    textAlign: 'center',
  },
});
