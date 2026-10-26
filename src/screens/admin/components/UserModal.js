// src/screens/admin/components/UserModal.js
import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../../theme/appleTheme';
import { formatMoneyInput, parseMoneyToNumeric, cleanMoneyValue } from '../../../utils/utilities';
import { appAlert } from '../../../components/AppAlert';

export const UserModal = ({ visible, onClose, onSave, editingUser = null }) => {
  const isEditing = !!editingUser;

  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('vendedor');
  const [dineroMaxCaja, setDineroMaxCaja] = useState('0');
  const [dineroMaxVenta, setDineroMaxVenta] = useState('0');
  const [dineroMaxGasto, setDineroMaxGasto] = useState('0');
  const [maxCuotas, setMaxCuotas] = useState('30');
  const [permiteBorrarVenta, setPermiteBorrarVenta] = useState(false);
  const [permiteModificarPagos, setPermiteModificarPagos] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editingUser) {
      setNombre(editingUser.nombre || '');
      setApellido(editingUser.apellido || '');
      setEmail(editingUser.email || '');
      setPassword('');
      setRol(editingUser.rol || 'vendedor');
      setDineroMaxCaja(editingUser.dinero_max_caja ? formatMoneyInput(editingUser.dinero_max_caja) : '');
      setDineroMaxVenta(editingUser.dinero_max_venta ? formatMoneyInput(editingUser.dinero_max_venta) : '');
      setDineroMaxGasto(editingUser.dinero_max_gasto ? formatMoneyInput(editingUser.dinero_max_gasto) : '');
      setMaxCuotas(editingUser.max_cuotas ? cleanMoneyValue(editingUser.max_cuotas) : '30');
      setPermiteBorrarVenta(!!editingUser.permite_borrar_venta);
      setPermiteModificarPagos(!!editingUser.permite_modificar_pagos);
    } else {
      setNombre('');
      setApellido('');
      setEmail('');
      setPassword('');
      setRol('vendedor');
      setDineroMaxCaja(formatMoneyInput('500000'));
      setDineroMaxVenta(formatMoneyInput('200000'));
      setDineroMaxGasto(formatMoneyInput('50000'));
      setMaxCuotas('30');
      setPermiteBorrarVenta(false);
      setPermiteModificarPagos(false);
    }
  }, [editingUser, visible]);

  const handleSave = async () => {
    if (!nombre.trim()) {
      appAlert('Dato requerido', 'El nombre es obligatorio');
      return;
    }
    if (!isEditing && (!email.trim() || !password.trim())) {
      appAlert('Datos requeridos', 'El correo y la contrasea son obligatorios para crear un usuario');
      return;
    }
    if (!isEditing && password.trim().length < 6) {
      appAlert('Contrasea corta', 'La contrasea debe tener al menos 6 caracteres');
      return;
    }
    if (isEditing && password.trim().length > 0 && password.trim().length < 6) {
      appAlert('Contrasea corta', 'La nueva contrasea debe tener al menos 6 caracteres');
      return;
    }

    setLoading(true);
    try {
      await onSave({
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        email: email.trim(),
        password: password.trim(),
        rol,
        dinero_max_caja: parseMoneyToNumeric(dineroMaxCaja),
        dinero_max_venta: parseMoneyToNumeric(dineroMaxVenta),
        dinero_max_gasto: parseMoneyToNumeric(dineroMaxGasto),
        max_cuotas: parseInt(cleanMoneyValue(maxCuotas) || '30', 10),
        permite_borrar_venta: permiteBorrarVenta,
        permite_modificar_pagos: permiteModificarPagos,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {isEditing ? 'Editar Usuario' : 'Nuevo Usuario'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="times" size={18} color={apple.colors.secondaryLabel} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {/* Rol Selector */}
            <Text style={styles.sectionTitle}>Rol del Usuario</Text>
            <View style={styles.roleContainer}>
              <TouchableOpacity
                style={[styles.roleBtn, rol === 'vendedor' && styles.roleBtnActive]}
                onPress={() => setRol('vendedor')}
              >
                <Icon
                  name="user"
                  size={14}
                  color={rol === 'vendedor' ? '#FFFFFF' : apple.colors.secondaryLabel}
                />
                <Text style={[styles.roleText, rol === 'vendedor' && styles.roleTextActive]}>
                  Vendedor
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleBtn, rol === 'admin' && styles.roleBtnActiveAdmin]}
                onPress={() => setRol('admin')}
              >
                <Icon
                  name="shield"
                  size={14}
                  color={rol === 'admin' ? '#FFFFFF' : apple.colors.secondaryLabel}
                />
                <Text style={[styles.roleText, rol === 'admin' && styles.roleTextActive]}>
                  Administrador
                </Text>
              </TouchableOpacity>
            </View>

            {/* Datos Personales */}
            <Text style={styles.sectionTitle}>Datos Generales</Text>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Nombre *</Text>
              <TextInput
                style={styles.input}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej. Juan"
                placeholderTextColor={apple.colors.tertiaryLabel}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Apellido</Text>
              <TextInput
                style={styles.input}
                value={apellido}
                onChangeText={setApellido}
                placeholder="Ej. Pérez"
                placeholderTextColor={apple.colors.tertiaryLabel}
              />
            </View>

            {!isEditing ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Correo Electrnico *</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholder="juan@ejemplo.com"
                    placeholderTextColor={apple.colors.tertiaryLabel}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Contrasea *</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    placeholder="Mnimo 6 caracteres"
                    placeholderTextColor={apple.colors.tertiaryLabel}
                  />
                </View>
              </>
            ) : (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Nueva Contrasea (opcional)</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Dejar vaco para conservar la actual (mn. 6)"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
            )}

            {/* Límites Financieros */}
            <Text style={styles.sectionTitle}>Límites y Topes</Text>
            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Dinero Máx Caja</Text>
                <TextInput
                  style={styles.input}
                  value={dineroMaxCaja}
                  onChangeText={t => setDineroMaxCaja(formatMoneyInput(t))}
                  keyboardType="numeric"
                  placeholder="$ 0"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.label}>Dinero Máx Venta</Text>
                <TextInput
                  style={styles.input}
                  value={dineroMaxVenta}
                  onChangeText={t => setDineroMaxVenta(formatMoneyInput(t))}
                  keyboardType="numeric"
                  placeholder="$ 0"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Dinero Máx Gasto</Text>
                <TextInput
                  style={styles.input}
                  value={dineroMaxGasto}
                  onChangeText={t => setDineroMaxGasto(formatMoneyInput(t))}
                  keyboardType="numeric"
                  placeholder="$ 0"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.label}>Máx Cuotas</Text>
                <TextInput
                  style={styles.input}
                  value={maxCuotas}
                  onChangeText={t => setMaxCuotas(cleanMoneyValue(t))}
                  keyboardType="numeric"
                  placeholder="30"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
            </View>

            {/* Permisos Especiales */}
            <Text style={styles.sectionTitle}>Permisos Especiales</Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Permite borrar venta</Text>
              <Switch
                value={permiteBorrarVenta}
                onValueChange={setPermiteBorrarVenta}
                trackColor={{ false: apple.colors.separator, true: apple.colors.blue }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Permite modificar pagos</Text>
              <Switch
                value={permiteModificarPagos}
                onValueChange={setPermiteModificarPagos}
                trackColor={{ false: apple.colors.separator, true: apple.colors.blue }}
                thumbColor="#FFFFFF"
              />
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose}>
              <Text style={styles.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnSubmit, loading && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={loading}
            >
              <Text style={styles.btnSubmitText}>
                {loading ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Usuario'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: apple.colors.card,
    borderTopLeftRadius: apple.radius.xl,
    borderTopRightRadius: apple.radius.xl,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: apple.spacing.l,
    borderBottomWidth: 0.5,
    borderBottomColor: apple.colors.separator,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: apple.colors.label,
  },
  closeBtn: {
    padding: 6,
  },
  content: {
    padding: apple.spacing.l,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: apple.colors.secondaryLabel,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: apple.radius.s,
    backgroundColor: apple.colors.bgGrouped,
    borderWidth: 1,
    borderColor: apple.colors.separator,
  },
  roleBtnActive: {
    backgroundColor: apple.colors.blue,
    borderColor: apple.colors.blue,
  },
  roleBtnActiveAdmin: {
    backgroundColor: '#5856D6',
    borderColor: '#5856D6',
  },
  roleText: {
    fontSize: 14,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  roleTextActive: {
    color: '#FFFFFF',
  },
  fieldGroup: {
    marginBottom: 12,
  },
  fieldRow: {
    flexDirection: 'row',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: apple.colors.label,
    marginBottom: 6,
  },
  input: {
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.s,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: apple.colors.label,
    borderWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: apple.colors.separator,
  },
  switchLabel: {
    fontSize: 15,
    color: apple.colors.label,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: apple.spacing.l,
    paddingTop: apple.spacing.m,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: apple.radius.m,
    backgroundColor: apple.colors.bgGrouped,
    alignItems: 'center',
  },
  btnCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  btnSubmit: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: apple.radius.m,
    backgroundColor: apple.colors.blue,
    alignItems: 'center',
  },
  btnSubmitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
