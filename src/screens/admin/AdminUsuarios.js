import AppBackground from '../../components/AppBackground';
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
import { zendapp } from '../../theme/zendappTheme';
import { appAlert } from '../../components/AppAlert';
import LogoutConfirmModal from '../../components/LogoutConfirmModal';
import AnimatedSegmentedControl from '../../components/AnimatedSegmentedControl';
import { SkeletonList, SkeletonUserCard } from '../../components/Skeleton';
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
import { HierarchyBreadcrumb } from './components/HierarchyBreadcrumb';

export default function AdminUsuarios() {
  const { userId, signOut } = useAuth();
  const [hierarchyStack, setHierarchyStack] = useState([{ id: userId, name: 'Mi Equipo' }]);
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

  useEffect(() => {
    if (userId) {
      setHierarchyStack((prev) => (prev.length === 0 ? [{ id: userId, name: 'Mi Equipo' }] : prev));
    }
  }, [userId]);

  const currentParent = hierarchyStack[hierarchyStack.length - 1];

  const handleLogout = useCallback(() => {
    setShowLogout(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (hierarchyStack.length > 1) {
          setHierarchyStack((prev) => prev.slice(0, -1));
          return true;
        }
        handleLogout();
        return true;
      });
      return () => sub.remove();
    }, [handleLogout, hierarchyStack.length])
  );

  const loadUsers = useCallback(async () => {
    try {
      const targetParentId = hierarchyStack.length > 1 ? hierarchyStack[hierarchyStack.length - 1].id : null;
      const data = await getSubordinates(targetParentId);
      setUsers(data || []);
    } catch (err) {
      appAlert('Error', err.message || 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hierarchyStack]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleNavigateHierarchy = (subAdmin) => {
    setLoading(true);
    setHierarchyStack((prev) => [
      ...prev,
      {
        id: subAdmin.id,
        name: `${subAdmin.nombre || ''} ${subAdmin.apellido || ''}`.trim() || 'Administrador',
      },
    ]);
  };

  const handlePopHierarchy = (targetIndex) => {
    setLoading(true);
    setHierarchyStack((prev) => prev.slice(0, targetIndex + 1));
  };

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
        const payload = {
          ...formData,
          superior_id: hierarchyStack.length > 1 ? hierarchyStack[hierarchyStack.length - 1].id : null,
        };
        await createAdminUser(payload);
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
      <AppBackground />
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Usuarios</Text>
          <Text style={styles.headerSubtitle}>
            {hierarchyStack.length > 1 ? `Equipo: ${currentParent?.name || ''} · ` : ''}
            {activosCount} activos · {inactivosCount} inactivos
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={handleLogout}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="sign-out" size={16} color={zendapp.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerOrgBtn}
            onPress={() => setOrgModalVisible(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="building-o" size={15} color={zendapp.colors.carbon} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Breadcrumb de Navegación Jerárquica */}
      <HierarchyBreadcrumb
        stack={hierarchyStack}
        onPop={handlePopHierarchy}
        rootTitle="Mi Equipo"
      />

      {/* Segmented Filter Activos / Inactivos (Requisito 2) */}
        <View style={{ marginHorizontal: 16, marginTop: 6, marginBottom: 4 }}>
          <AnimatedSegmentedControl
            options={[
              {
                key: 'activos',
                label: 'Activos',
                badge: activosCount,
              },
              {
                key: 'inactivos',
                label: 'Inactivos',
                badge: inactivosCount,
              },
            ]}
            selectedKey={statusFilter}
            onChange={(key) => setStatusFilter(key)}
          />
        </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={14} color={zendapp.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre o correo..."
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

      {/* Lista */}
        {loading ? (
          <View style={{ flex: 1, paddingTop: 10 }}>
            <SkeletonList count={5} Component={SkeletonUserCard} />
          </View>
        ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <UserCard
              user={item}
              onEdit={handleEdit}
              onToggle={handleToggle}
              onNavigateHierarchy={handleNavigateHierarchy}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={zendapp.colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="users" size={44} color={zendapp.colors.border} />
              <Text style={styles.emptyTitle}>
                {statusFilter === 'activos' ? 'No hay usuarios activos' : 'No hay usuarios inactivos'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search
                  ? 'No se encontraron coincidencias para la búsqueda'
                  : statusFilter === 'activos'
                  ? 'Crea un nuevo usuario usando el botón +'
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

      {/* FAB Flotante para crear nuevo usuario con máxima visibilidad */}
      <TouchableOpacity
        style={styles.fab}
        onPress={handleCreate}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="plus" size={20} color="#FFFFFF" />
      </TouchableOpacity>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: zendapp.colors.carbon,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
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
    backgroundColor: '#F1F3F7',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLogoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: zendapp.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#F1F3F7',
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  segOpt: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D0D5DD',
  },
  segText: {
    fontSize: 13,
    fontWeight: '500',
    color: zendapp.colors.textSecondary,
  },
  segTextActive: {
    color: zendapp.colors.carbon,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EAECF0',
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: zendapp.colors.carbon,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 96,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: zendapp.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#B91C1C',
    ...Platform.select({
      ios: {
        shadowColor: '#EE272D',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
      },
      android: {
        elevation: 0,
      },
      default: {
        elevation: 0,
      },
    }),
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
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 13,
    color: zendapp.colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
});
