// src/screens/admin/components/OrganizationModal.js
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../../theme/appleTheme';
import { zendapp } from '../../../theme/zendappTheme';
import { appAlert } from '../../../components/AppAlert';
import { getAdminOrganizacion, updateAdminOrganizacion } from '../../../services/adminService';
import { pickImage, getSignedUrl } from '../../../services/multimediaService';
import { getDbConnection } from '../../../database/db';

export default function OrganizationModal({ visible, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nombre, setNombre] = useState('');
  const [nit, setNit] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [logoPath, setLogoPath] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [modoApertura, setModoApertura] = useState('admin_masivo'); // 'admin_masivo' | 'vendedor_dia'

  useEffect(() => {
    if (visible) {
      loadOrg();
    }
  }, [visible]);

  const loadOrg = async () => {
    setLoading(true);
    try {
      const data = await getAdminOrganizacion();
      if (data) {
        setNombre(data.nombre || 'ZENDA');
        setNit(data.nit || '');
        setTelefono(data.telefono || '');
        setDireccion(data.direccion || '');
        setModoApertura(data.modo_apertura_caja || 'admin_masivo');
        setLogoPath(data.logo_path || null);

        if (data.logo_path) {
          try {
            const url = await getSignedUrl(data.logo_path);
            setLogoPreviewUrl(url);
          } catch {
            setLogoPreviewUrl(data.logo_path);
          }
        } else {
          setLogoPreviewUrl(null);
        }
      }
    } catch (e) {
      console.log('Error loading organization:', e);
    } finally {
      setLoading(false);
    }
  };

  const handlePickLogo = async (sourceType) => {
    try {
      const res = await pickImage(sourceType, 'ORGANIZATION_LOGO');
      if (res?.localUri) {
        setLogoPath(res.remotePath || res.localUri);
        setLogoPreviewUrl(res.localUri);
      }
    } catch (err) {
      appAlert('Error', 'No se pudo seleccionar el logo');
    }
  };

  const handleSave = async () => {
    if (!nombre.trim()) {
      return appAlert('Campo requerido', 'El nombre de la empresa no puede estar vacío.');
    }

    setSaving(true);
    try {
      await updateAdminOrganizacion({
        nombre: nombre.trim(),
        nit: nit.trim(),
        telefono: telefono.trim(),
        direccion: direccion.trim(),
        logoPath: logoPath,
        modoApertura: modoApertura,
      });

      // Actualizar también en SQLite local para consistencia offline
      try {
        const db = await getDbConnection();
        await db.executeSql(
          `INSERT OR REPLACE INTO organizaciones (id, nombre, nit, telefono, direccion, logo_path, modo_apertura_caja)
           VALUES (1, ?, ?, ?, ?, ?, ?)`,
          [nombre.trim(), nit.trim(), telefono.trim(), direccion.trim(), logoPath, modoApertura]
        );
      } catch (errDb) {
        console.log('Error guardando organización local:', errDb);
      }

      appAlert('Éxito', 'Configuración de la organización guardada correctamente.');
      onSaved?.();
      onClose();
    } catch (e) {
      appAlert('Error al guardar', e.message || 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Personalización de Empresa</Text>
              <Text style={styles.sub}>Logo, datos de comprobante y apertura de caja</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="times" size={18} color={zendapp.colors.textMuted} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={zendapp.colors.primary} />
              <Text style={{ marginTop: 12, color: zendapp.colors.textSecondary }}>Cargando datos...</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
              {/* Sección Logo */}
              <Text style={styles.sectionLabel}>LOGO DE LA EMPRESA</Text>
              <View style={styles.logoSection}>
                <View style={styles.logoPreviewBox}>
                  {logoPreviewUrl ? (
                    <Image source={{ uri: logoPreviewUrl }} style={styles.logoImage} resizeMode="contain" />
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Icon name="building-o" size={30} color={zendapp.colors.textMuted} />
                      <Text style={styles.logoPlaceholderText}>Sin logo</Text>
                    </View>
                  )}
                </View>
                <View style={styles.logoBtnCol}>
                  <TouchableOpacity
                    style={styles.logoBtn}
                    onPress={() => handlePickLogo('camera')}
                    activeOpacity={0.8}
                  >
                    <Icon name="camera" size={13} color={zendapp.colors.carbon} />
                    <Text style={styles.logoBtnText}>Tomar foto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.logoBtn}
                    onPress={() => handlePickLogo('gallery')}
                    activeOpacity={0.8}
                  >
                    <Icon name="image" size={13} color={zendapp.colors.carbon} />
                    <Text style={styles.logoBtnText}>Galería</Text>
                  </TouchableOpacity>
                  {logoPath && (
                    <TouchableOpacity
                      style={[styles.logoBtn, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}
                      onPress={() => { setLogoPath(null); setLogoPreviewUrl(null); }}
                      activeOpacity={0.8}
                    >
                      <Icon name="trash-o" size={13} color={zendapp.colors.primary} />
                      <Text style={[styles.logoBtnText, { color: zendapp.colors.primary }]}>Quitar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Datos de la Organización */}
              <Text style={styles.sectionLabel}>DATOS COMERCIALES</Text>
              <Text style={styles.inputLabel}>Nombre de la Empresa *</Text>
              <TextInput
                style={styles.input}
                value={nombre}
                onChangeText={setNombre}
                placeholder="Ej. Inversiones Zenda S.A.S."
                placeholderTextColor={zendapp.colors.textMuted}
              />

              <Text style={styles.inputLabel}>NIT / Identificación Fiscal</Text>
              <TextInput
                style={styles.input}
                value={nit}
                onChangeText={setNit}
                placeholder="Ej. 900.123.456-7"
                placeholderTextColor={zendapp.colors.textMuted}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Teléfono de Contacto</Text>
                  <TextInput
                    style={styles.input}
                    value={telefono}
                    onChangeText={setTelefono}
                    placeholder="300 123 4567"
                    keyboardType="phone-pad"
                    placeholderTextColor={zendapp.colors.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Dirección</Text>
                  <TextInput
                    style={styles.input}
                    value={direccion}
                    onChangeText={setDireccion}
                    placeholder="Calle 10 # 20-30"
                    placeholderTextColor={zendapp.colors.textMuted}
                  />
                </View>
              </View>

              {/* Modalidad de Apertura de Caja */}
              <Text style={styles.sectionLabel}>MODALIDAD DE APERTURA DE CAJA</Text>
              <TouchableOpacity
                style={[
                  styles.modoCard,
                  modoApertura === 'admin_masivo' && styles.modoCardSelected,
                ]}
                onPress={() => setModoApertura('admin_masivo')}
                activeOpacity={0.8}
              >
                <View style={[styles.modoRadio, modoApertura === 'admin_masivo' && { borderColor: zendapp.colors.primary }]}>
                  {modoApertura === 'admin_masivo' && <View style={styles.modoRadioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modoTitle}>Modalidad A: Administrador centralizado</Text>
                  <Text style={styles.modoSub}>
                    El administrador abre las cajas de forma masiva o individual. Los vendedores no pueden abrir caja por sí mismos.
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modoCard,
                  modoApertura === 'vendedor_dia' && styles.modoCardSelected,
                ]}
                onPress={() => setModoApertura('vendedor_dia')}
                activeOpacity={0.8}
              >
                <View style={[styles.modoRadio, modoApertura === 'vendedor_dia' && { borderColor: zendapp.colors.primary }]}>
                  {modoApertura === 'vendedor_dia' && <View style={styles.modoRadioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modoTitle}>Modalidad B: Vendedor al iniciar jornada</Text>
                  <Text style={styles.modoSub}>
                    Cada vendedor ingresa su saldo inicial y abre su propia caja al iniciar un nuevo día comercial.
                  </Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          )}

          <View style={styles.footerActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving || loading}>
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Guardar Cambios</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#EAECF0',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: zendapp.colors.carbon,
  },
  sub: {
    fontSize: 12,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: zendapp.colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 8,
  },
  logoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
  },
  logoPreviewBox: {
    width: 80,
    height: 80,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPlaceholderText: {
    fontSize: 10,
    color: zendapp.colors.textMuted,
    marginTop: 4,
  },
  logoBtnCol: {
    flex: 1,
    gap: 6,
  },
  logoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  logoBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: zendapp.colors.carbon,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: zendapp.colors.carbon,
  },
  modoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
    padding: 12,
    marginBottom: 8,
  },
  modoCardSelected: {
    borderColor: zendapp.colors.primary,
    backgroundColor: '#FEECEC',
  },
  modoRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D0D5DD',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  modoRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: zendapp.colors.primary,
  },
  modoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: zendapp.colors.carbon,
  },
  modoSub: {
    fontSize: 11,
    color: zendapp.colors.textSecondary,
    marginTop: 2,
    lineHeight: 15,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#EAECF0',
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#F2F4F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: zendapp.colors.carbon,
  },
  saveBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    backgroundColor: zendapp.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

