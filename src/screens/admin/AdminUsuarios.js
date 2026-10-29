// src/screens/admin/AdminUsuarios.js
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
  Alert,
  BackHandler,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../theme/appleTheme';
import { appAlert } from '../../components/AppAlert';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import { useAuth } from '../../context/AuthContext';
import {
  getSubordinates,
  createAdminUser,
  updateAdminUser,
  toggleAdminUser,
} from '../../services/adminService';
import { UserCard } from './components/UserCard';
import { UserModal } from './components/UserModal';
import OrganizationModal from './components/OrganizationModal';

export default function AdminUsuarios() {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('activos'); // 'activos' | 'inactivos'
  const [showLogout, setShowLogout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [orgModalVisible, setOrgModalVisible] = useState(false);
  const { signOut } = useAuth();

  const handleLogout = useCallback(() => {
    setShowLogout(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handleLogout();
        return true;
      });
      return () => sub.remove();
    }, [handleLogout])
  );

  const loadUsers = useCallback(async () => {
    try {
      const data = await getSubordinates();
      setUsers(data || []);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    let list = users.filter((u) => {
      const isActivo = u.activo !== false;
      return statusFilter === 'activos' ? isActivo : !isActivo;
    });

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.nombre?.toLowerCase().includes(q) ||
          u.apellido?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q)
      );
    }
    setFilteredUsers(list);
  }, [search, users, statusFilter]);

  const onRefresh = () => {
    setRefreshing(true);
    loadUsers();
  };

  const handleCreate = () => {
    setEditingUser(null);
    setModalVisible(true);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setModalVisible(true);
  };

  const handleToggle = async (user) => {
    try {
      const res = await toggleAdminUser(user.id);
      appAlert(
        'Actualizado',
        `Usuario ${res.activo ? 'habilitado' : 'inhabilitado'} correctamente`
      );
      loadUsers();
    } catch (err) {
      appAlert('Error', err.message);
    }
  };

  const handleSaveUser = async (formData) => {
    try {
      if (editingUser) {
        await updateAdminUser(editingUser.id, formData);
        appAlert('Éxito', 'Usuario actualizado correctamente');
      } else {
        await createAdminUser(formData);
        appAlert('Éxito', 'Usuario creado exitosamente');
      }
      loadUsers();
    } catch (err) {
      console.log('Error guardando usuario:', err);
      appAlert('Error', err.message);
    }
  };

  const activosCount = users.filter((u) => u.activo !== false).length;
  const inactivosCount = users.filter((u) => u.activo === false).length;

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Usuarios</Text>
          <Text style={styles.headerSubtitle}>
            {activosCount} activos · {inactivosCount} inactivos
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={handleLogout}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="sign-out" size={17} color={apple.colors.danger} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerOrgBtn}
            onPress={() => setOrgModalVisible(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="building-o" size={16} color={apple.colors.blue} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={handleCreate}>
            <Icon name="plus" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Segmented Filter Activos / Inactivos (Requisito 2) */}
      <View style={styles.segment}>
        <TouchableOpacity
          onPress={() => setStatusFilter('activos')}
          style={[styles.segOpt, statusFilter === 'activos' && styles.segActive]}
          activeOpacity={0.8}
        >
          <Text style={[styles.segText, statusFilter === 'activos' && styles.segTextActive]}>
            Activos ({activosCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setStatusFilter('inactivos')}
          style={[styles.segOpt, statusFilter === 'inactivos' && styles.segActive]}
          activeOpacity={0.8}
        >
          <Text style={[styles.segText, statusFilter === 'inactivos' && styles.segTextActive]}>
            Inactivos ({inactivosCount})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={apple.colors.tertiaryLabel} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre o correo..."
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

      {/* Lista */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={apple.colors.blue} />
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <UserCard user={item} onEdit={handleEdit} onToggle={handleToggle} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={apple.colors.blue} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="users" size={48} color={apple.colors.tertiaryLabel} />
              <Text style={styles.emptyTitle}>
                {statusFilter === 'activos' ? 'No hay usuarios activos' : 'No hay usuarios inactivos'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search
                  ? 'No se encontraron coincidencias para la búsqueda'
                  : statusFilter === 'activos'
                  ? 'Crea un nuevo vendedor usando el botón +'
                  : 'Los usuarios inhabilitados aparecerán en esta sección'}
              </Text>
            </View>
          }
        />
      )}

      {/* Modal Crear / Editar */}
      <UserModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveUser}
        editingUser={editingUser}
      />
      <OrganizationModal
        visible={orgModalVisible}
        onClose={() => setOrgModalVisible(false)}
        onSaved={loadUsers}
      />
      <LogoutConfirmModal
        visible={showLogout}
        onClose={() => setShowLogout(false)}
        onConfirm={signOut}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: apple.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.m,
    paddingBottom: apple.spacing.s,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: apple.colors.label,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerOrgBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    justifyContent: 'center',
    alignItems: 'center',
    ...apple.shadow.subtle,
  },
  headerLogoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFEBEA',
    justifyContent: 'center',
    alignItems: 'center',
    ...apple.shadow.subtle,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: apple.colors.blue,
    justifyContent: 'center',
    alignItems: 'center',
    ...apple.shadow.subtle,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: apple.colors.fill,
    marginHorizontal: apple.spacing.l,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: apple.radius.s,
    padding: 3,
    gap: 4,
  },
  segOpt: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: apple.radius.s - 2,
    alignItems: 'center',
  },
  segActive: {
    backgroundColor: apple.colors.card,
    ...apple.shadow.subtle,
  },
  segText: {
    fontSize: 13,
    fontWeight: '500',
    color: apple.colors.secondaryLabel,
  },
  segTextActive: {
    color: apple.colors.label,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.s,
    marginHorizontal: apple.spacing.l,
    marginVertical: apple.spacing.s,
    paddingHorizontal: 12,
    height: 40,
    ...apple.shadow.subtle,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: apple.colors.label,
  },
  listContent: {
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.s,
    paddingBottom: apple.spacing.xl,
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
    color: apple.colors.secondaryLabel,
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 13,
    color: apple.colors.tertiaryLabel,
    marginTop: 4,
    textAlign: 'center',
  },
});
