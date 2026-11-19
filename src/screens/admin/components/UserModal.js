// src/screens/admin/components/UserModal.js
import React, { useState, useEffect, useMemo } from 'react';
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
  FlatList,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../../theme/appleTheme';
import { zendapp } from '../../../theme/zendappTheme';
import {
  formatMoneyInput,
  parseMoneyToNumeric,
  cleanMoneyValue,
} from '../../../utils/utilities';
import {
  getCountries,
  getAdministrativeDivisions,
  getCities,
  getRegionalConfig,
  searchLocationsOnDemand,
  registerLocationOnDemand,
} from '../../../services/geoService';
import { getDbConnection } from '../../../database/db';
import { appAlert } from '../../../components/AppAlert';
import { useTranslation } from '../../../i18n';

export const UserModal = ({ visible, onClose, onSave, editingUser = null }) => {
  const { t } = useTranslation();
  const isEditing = !!editingUser;

  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('vendedor');

  // Configuración territorial progresiva
  const [countryId, setCountryId] = useState('CO');
  const [divisionId, setDivisionId] = useState('');
  const [cityId, setCityId] = useState('');

  // Modales de selección
  const [pickerModal, setPickerModal] = useState({ visible: false, type: '', title: '', items: [] });
  const [pickerSearch, setPickerSearch] = useState('');

  // Búsqueda bajo demanda y registro dinámico
  const [searchingExternal, setSearchingExternal] = useState(false);
  const [externalCities, setExternalCities] = useState([]);
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualCityName, setManualCityName] = useState('');
  const [registeringCity, setRegisteringCity] = useState(false);

  // Límites
  const [dineroMaxCaja, setDineroMaxCaja] = useState('');
  const [dineroMaxVenta, setDineroMaxVenta] = useState('');
  const [dineroMaxGasto, setDineroMaxGasto] = useState('');
  const [maxCuotas, setMaxCuotas] = useState('30');
  const [permiteBorrarVenta, setPermiteBorrarVenta] = useState(false);
  const [permiteModificarPagos, setPermiteModificarPagos] = useState(false);
  const [saldoInicialCaja, setSaldoInicialCaja] = useState('');
  const [loading, setLoading] = useState(false);

  // Configuración regional calculada reactivamente
  const regionalConfig = useMemo(() => {
    return getRegionalConfig(countryId, cityId);
  }, [countryId, cityId]);

  const activeCurrencyCode = regionalConfig.currency_code;

  // Catálogos reactivos
  const availableCountries = useMemo(() => getCountries(), []);
  const availableDivisions = useMemo(() => getAdministrativeDivisions(countryId), [countryId]);
  const availableCities = useMemo(() => getCities(divisionId), [divisionId]);

  // Asignar valores por defecto según la divisa seleccionada
  const getDefaultLimits = (currCode) => {
    switch (currCode) {
      case 'BRL':
        return { caja: '10000', venta: '5000', gasto: '1000', saldo: '0' };
      case 'ARS':
        return { caja: '500000', venta: '250000', gasto: '50000', saldo: '0' };
      case 'MXN':
        return { caja: '10000', venta: '5000', gasto: '1000', saldo: '0' };
      case 'PEN':
        return { caja: '2000', venta: '1000', gasto: '200', saldo: '0' };
      case 'CLP':
        return { caja: '200000', venta: '100000', gasto: '20000', saldo: '0' };
      case 'USD':
        return { caja: '1000', venta: '500', gasto: '100', saldo: '0' };
      case 'COP':
      default:
        return { caja: '500000', venta: '200000', gasto: '50000', saldo: '0' };
    }
  };

  const currentDefaults = useMemo(() => getDefaultLimits(activeCurrencyCode), [activeCurrencyCode]);

  useEffect(() => {
    if (editingUser) {
      setNombre(editingUser.nombre || '');
      setApellido(editingUser.apellido || '');
      setEmail(editingUser.email || '');
      setPassword('');
      setRol(editingUser.rol || 'vendedor');

      const initialCountry = editingUser.country_id || 'CO';
      const initialDivision = editingUser.administrative_division_id || '';
      const initialCity = editingUser.city_id || '';

      setCountryId(initialCountry);
      setDivisionId(initialDivision);
      setCityId(initialCity);

      const curr = editingUser.currency_code || 'COP';
      setDineroMaxCaja(editingUser.dinero_max_caja ? formatMoneyInput(editingUser.dinero_max_caja, true, curr, { forceDecimals: true }) : '');
      setDineroMaxVenta(editingUser.dinero_max_venta ? formatMoneyInput(editingUser.dinero_max_venta, true, curr, { forceDecimals: true }) : '');
      setDineroMaxGasto(editingUser.dinero_max_gasto ? formatMoneyInput(editingUser.dinero_max_gasto, true, curr, { forceDecimals: true }) : '');
      setMaxCuotas(editingUser.max_cuotas ? cleanMoneyValue(editingUser.max_cuotas, curr) : '30');
      setPermiteBorrarVenta(!!editingUser.permite_borrar_venta);
      setPermiteModificarPagos(!!editingUser.permite_modificar_pagos);
      setSaldoInicialCaja('');
    } else {
      setNombre('');
      setApellido('');
      setEmail('');
      setPassword('');
      setRol('vendedor');

      // Default Colombia
      setCountryId('CO');
      setDivisionId('CO-CAL');
      setCityId('CO-CAL-MNZ');

      setDineroMaxCaja('');
      setDineroMaxVenta('');
      setDineroMaxGasto('');
      setMaxCuotas('30');
      setPermiteBorrarVenta(false);
      setPermiteModificarPagos(false);
      setSaldoInicialCaja('');
    }
  }, [editingUser, visible]);

  // Manejo de cambio de país (limpieza progresiva obligatoria)
  const handleSelectCountry = (newCountryId) => {
    if (newCountryId === countryId) return;
    setCountryId(newCountryId);
    setDivisionId('');
    setCityId('');

    setDineroMaxCaja('');
    setDineroMaxVenta('');
    setDineroMaxGasto('');
    setSaldoInicialCaja('');
  };

  // Manejo de cambio de división (limpieza progresiva de ciudad)
  const handleSelectDivision = (newDivId) => {
    if (newDivId === divisionId) return;
    setDivisionId(newDivId);
    setCityId('');
  };

  // Manejo de cambio de ciudad
  const handleSelectCity = (newCityId) => {
    setCityId(newCityId);
  };

  // Abrir modal selector genérico
  const openPicker = (type) => {
    setPickerSearch('');
    if (type === 'country') {
      setPickerModal({
        visible: true,
        type: 'country',
        title: 'Seleccionar País',
        items: availableCountries.map(c => ({ id: c.id, label: c.nombre, sub: `${c.currency_code} · ${c.locale}` })),
      });
    } else if (type === 'division') {
      const typeLabel = countryId === 'CL' ? 'Región' : countryId === 'MX' ? 'Estado' : 'Departamento';
      setPickerModal({
        visible: true,
        type: 'division',
        title: `Seleccionar ${typeLabel}`,
        items: availableDivisions.map(d => ({ id: d.id, label: d.nombre, sub: d.division_type })),
      });
    } else if (type === 'city') {
      setPickerModal({
        visible: true,
        type: 'city',
        title: 'Seleccionar Ciudad / Localidad',
        items: availableCities.map(c => ({ id: c.id, label: c.nombre, sub: c.timezone })),
      });
    }
  };

  // Búsqueda bajo demanda en GeoNames cuando el usuario consulta ciudades
  useEffect(() => {
    if (pickerModal.type !== 'city') {
      setExternalCities([]);
      setSearchingExternal(false);
      return;
    }

    const cleanQ = pickerSearch.trim();
    if (cleanQ.length < 3) {
      setExternalCities([]);
      setSearchingExternal(false);
      return;
    }

    setSearchingExternal(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchLocationsOnDemand({
          query: cleanQ,
          countryId,
          divisionId,
          allowExternal: true,
        });
        if (res && Array.isArray(res.externalResults)) {
          setExternalCities(
            res.externalResults.map(it => ({
              id: it.id || `ext-${it.geoname_id}`,
              label: it.nombre,
              sub: it.division_name ? `${it.division_name} · En línea (GeoNames)` : 'En línea (GeoNames)',
              is_external: true,
              raw: it,
            }))
          );
        }
      } catch (e) {
        console.warn('[UserModal] Error buscando ciudades en GeoNames:', e);
      } finally {
        setSearchingExternal(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [pickerSearch, pickerModal.type, countryId, divisionId]);

  const handlePickerSelect = async (item) => {
    if (pickerModal.type === 'country') {
      handleSelectCountry(item.id);
      setPickerModal({ visible: false, type: '', title: '', items: [] });
    } else if (pickerModal.type === 'division') {
      handleSelectDivision(item.id);
      setPickerModal({ visible: false, type: '', title: '', items: [] });
    } else if (pickerModal.type === 'city') {
      if (item.is_external && item.raw) {
        setRegisteringCity(true);
        try {
          const db = await getDbConnection();
          const res = await registerLocationOnDemand(item.raw, { db });
          if (res.success && res.city) {
            if (res.division && res.division.id) {
              handleSelectDivision(res.division.id);
            }
            handleSelectCity(res.city.id);
            setPickerModal({ visible: false, type: '', title: '', items: [] });
          } else {
            appAlert('Error al registrar', res.error || 'No se pudo guardar la ubicación externa');
          }
        } catch (e) {
          appAlert('Error', e.message || 'Error registrando ubicación');
        } finally {
          setRegisteringCity(false);
        }
      } else {
        handleSelectCity(item.id);
        setPickerModal({ visible: false, type: '', title: '', items: [] });
      }
    }
  };

  const handleSaveManualCity = async () => {
    const cleanName = manualCityName.trim();
    if (!cleanName) {
      appAlert('Dato requerido', 'Por favor ingresa el nombre de la ciudad o localidad');
      return;
    }
    setRegisteringCity(true);
    try {
      const db = await getDbConnection();
      const res = await registerLocationOnDemand({
        country_id: countryId,
        administrative_division_id: divisionId || null,
        division_nombre: selectedDivisionObj ? selectedDivisionObj.nombre : null,
        division_type: selectedDivisionObj ? selectedDivisionObj.division_type : null,
        nombre: cleanName,
        source: 'manual',
        type: 'localidad_manual',
      }, { db });

      if (res.success && res.city) {
        if (res.division && res.division.id) {
          handleSelectDivision(res.division.id);
        }
        handleSelectCity(res.city.id);
        setManualModalVisible(false);
        setManualCityName('');
        setPickerModal({ visible: false, type: '', title: '', items: [] });
      } else {
        appAlert('Error al registrar', res.error || 'No se pudo guardar la ubicación manual');
      }
    } catch (e) {
      appAlert('Error', e.message || 'Error registrando ubicación manual');
    } finally {
      setRegisteringCity(false);
    }
  };

  const selectedCountryObj = availableCountries.find(c => c.id === countryId);
  const selectedDivisionObj = availableDivisions.find(d => d.id === divisionId);
  const selectedCityObj = availableCities.find(c => c.id === cityId);

  const divisionLabelName = countryId === 'CL' ? 'Región' : countryId === 'MX' ? 'Estado' : 'Departamento';

  const handleSave = async () => {
    if (!nombre.trim()) {
      appAlert('Dato requerido', 'El nombre es obligatorio');
      return;
    }
    if (!isEditing && (!email.trim() || !password.trim())) {
      appAlert('Datos requeridos', 'El correo y la contraseña son obligatorios para crear un usuario');
      return;
    }
    if (!isEditing && password.trim().length < 6) {
      appAlert('Contraseña corta', 'La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (isEditing && password.trim().length > 0 && password.trim().length < 6) {
      appAlert('Contraseña corta', 'La nueva contraseña debe tener al menos 6 caracteres');
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
        country_id: countryId,
        administrative_division_id: divisionId || null,
        city_id: cityId || null,
        currency_code: regionalConfig.currency_code,
        locale: regionalConfig.locale,
        timezone: regionalConfig.timezone,
        dinero_max_caja: dineroMaxCaja
          ? parseMoneyToNumeric(dineroMaxCaja, activeCurrencyCode)
          : parseMoneyToNumeric(currentDefaults.caja, activeCurrencyCode),
        dinero_max_venta: dineroMaxVenta
          ? parseMoneyToNumeric(dineroMaxVenta, activeCurrencyCode)
          : parseMoneyToNumeric(currentDefaults.venta, activeCurrencyCode),
        dinero_max_gasto: dineroMaxGasto
          ? parseMoneyToNumeric(dineroMaxGasto, activeCurrencyCode)
          : parseMoneyToNumeric(currentDefaults.gasto, activeCurrencyCode),
        max_cuotas: parseInt(cleanMoneyValue(maxCuotas, activeCurrencyCode) || '30', 10),
        permite_borrar_venta: permiteBorrarVenta,
        permite_modificar_pagos: permiteModificarPagos,
        saldo_inicial_caja: parseMoneyToNumeric(saldoInicialCaja, activeCurrencyCode),
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const filteredPickerItems = useMemo(() => {
    const cleanSearch = pickerSearch.toLowerCase().trim();
    const local = pickerModal.items.filter(it =>
      !cleanSearch ||
      it.label.toLowerCase().includes(cleanSearch) ||
      (it.sub && it.sub.toLowerCase().includes(cleanSearch))
    );
    if (pickerModal.type === 'city' && externalCities.length > 0) {
      return [...local, ...externalCities];
    }
    return local;
  }, [pickerModal.items, pickerModal.type, pickerSearch, externalCities]);

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
              {isEditing ? t('users.edit_user') : t('users.new_user')}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="times" size={18} color={apple.colors.secondaryLabel} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {/* 1. Rol Selector */}
            <Text style={styles.sectionTitle}>1. Rol del Usuario</Text>
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

            {/* 2. Ubicación Operativa Progresiva */}
            <Text style={styles.sectionTitle}>2. Ubicación Operativa</Text>

            {/* País */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>País *</Text>
              <TouchableOpacity style={styles.pickerTrigger} onPress={() => openPicker('country')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Icon name="globe" size={14} color={zendapp.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={styles.pickerTriggerText}>
                    {selectedCountryObj ? selectedCountryObj.nombre : 'Seleccionar país'}
                  </Text>
                </View>
                <Icon name="chevron-down" size={12} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            {/* Departamento / Estado / Región */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{divisionLabelName} *</Text>
              <TouchableOpacity
                style={[styles.pickerTrigger, availableDivisions.length === 0 && styles.pickerTriggerDisabled]}
                onPress={() => openPicker('division')}
                disabled={availableDivisions.length === 0}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Icon name="map-marker" size={14} color={zendapp.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={[styles.pickerTriggerText, !selectedDivisionObj && { color: apple.colors.tertiaryLabel }]}>
                    {selectedDivisionObj ? selectedDivisionObj.nombre : `Seleccionar ${divisionLabelName.toLowerCase()}`}
                  </Text>
                </View>
                <Icon name="chevron-down" size={12} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            {/* Ciudad / Localidad */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Ciudad / Localidad</Text>
              <TouchableOpacity
                style={[styles.pickerTrigger, (!divisionId || availableCities.length === 0) && styles.pickerTriggerDisabled]}
                onPress={() => openPicker('city')}
                disabled={!divisionId || availableCities.length === 0}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Icon name="building-o" size={14} color={zendapp.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={[styles.pickerTriggerText, !selectedCityObj && { color: apple.colors.tertiaryLabel }]}>
                    {selectedCityObj ? selectedCityObj.nombre : divisionId ? 'Seleccionar ciudad' : 'Selecciona primero departamento'}
                  </Text>
                </View>
                <Icon name="chevron-down" size={12} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            {/* 3. Panel Informativo de Configuración Regional Detectada */}
            <View style={styles.geoSummaryCard}>
              <View style={styles.geoSummaryHeader}>
                <Icon name="check-circle" size={15} color="#059669" style={{ marginRight: 6 }} />
                <Text style={styles.geoSummaryTitle}>Configuración Regional Detectada</Text>
              </View>
              <View style={styles.geoSummaryGrid}>
                <View style={styles.geoSummaryItem}>
                  <Text style={styles.geoSummaryLabel}>Moneda</Text>
                  <Text style={styles.geoSummaryValue}>
                    {regionalConfig.currency_code} ({regionalConfig.currency.symbol})
                  </Text>
                  <Text style={styles.geoSummarySub}>{regionalConfig.currency.nombre}</Text>
                </View>
                <View style={styles.geoSummaryItem}>
                  <Text style={styles.geoSummaryLabel}>Locale</Text>
                  <Text style={styles.geoSummaryValue}>{regionalConfig.locale}</Text>
                  <Text style={styles.geoSummarySub}>
                    {regionalConfig.currency.decimalDigits > 0 ? `${regionalConfig.currency.decimalDigits} decimales` : 'Sin decimales'}
                  </Text>
                </View>
                <View style={styles.geoSummaryItemFull}>
                  <Text style={styles.geoSummaryLabel}>Zona Horaria</Text>
                  <Text style={styles.geoSummaryValue}>{regionalConfig.timezone}</Text>
                </View>
              </View>
            </View>

            {/* 4. Datos Personales */}
            <Text style={styles.sectionTitle}>3. Datos Generales</Text>
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
                  <Text style={styles.label}>Correo Electrónico o Usuario *</Text>
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
                  <Text style={styles.label}>Contraseña *</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    placeholder="Mínimo 6 caracteres"
                    placeholderTextColor={apple.colors.tertiaryLabel}
                  />
                </View>
              </>
            ) : (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Nueva Contraseña (opcional)</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Dejar vacío para conservar actual"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
            )}

            {!isEditing && rol === 'vendedor' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Saldo Inicial de Caja ({regionalConfig.currency.symbol})</Text>
                <TextInput
                  style={styles.input}
                  value={saldoInicialCaja}
                  onChangeText={t => setSaldoInicialCaja(formatMoneyInput(t, true, activeCurrencyCode))}
                  onBlur={() => {
                    if (saldoInicialCaja) {
                      setSaldoInicialCaja(formatMoneyInput(saldoInicialCaja, true, activeCurrencyCode, { forceDecimals: true }));
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={`${regionalConfig.currency.symbol} ${regionalConfig.currency.decimalDigits > 0 ? '0.00' : '0'}`}
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
            )}

            {/* 5. Límites Financieros */}
            <Text style={styles.sectionTitle}>4. Límites y Topes ({regionalConfig.currency_code})</Text>
            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Dinero Máx Caja</Text>
                <TextInput
                  style={styles.input}
                  value={dineroMaxCaja}
                  onChangeText={t => setDineroMaxCaja(formatMoneyInput(t, true, activeCurrencyCode))}
                  onBlur={() => {
                    if (dineroMaxCaja) {
                      setDineroMaxCaja(formatMoneyInput(dineroMaxCaja, true, activeCurrencyCode, { forceDecimals: true }));
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={`${regionalConfig.currency.symbol} ${formatMoneyInput(currentDefaults.caja, false, activeCurrencyCode, { forceDecimals: regionalConfig.currency.decimalDigits > 0 })}`}
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.label}>Dinero Máx Venta</Text>
                <TextInput
                  style={styles.input}
                  value={dineroMaxVenta}
                  onChangeText={t => setDineroMaxVenta(formatMoneyInput(t, true, activeCurrencyCode))}
                  onBlur={() => {
                    if (dineroMaxVenta) {
                      setDineroMaxVenta(formatMoneyInput(dineroMaxVenta, true, activeCurrencyCode, { forceDecimals: true }));
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={`${regionalConfig.currency.symbol} ${formatMoneyInput(currentDefaults.venta, false, activeCurrencyCode, { forceDecimals: regionalConfig.currency.decimalDigits > 0 })}`}
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
                  onChangeText={t => setDineroMaxGasto(formatMoneyInput(t, true, activeCurrencyCode))}
                  onBlur={() => {
                    if (dineroMaxGasto) {
                      setDineroMaxGasto(formatMoneyInput(dineroMaxGasto, true, activeCurrencyCode, { forceDecimals: true }));
                    }
                  }}
                  keyboardType="numeric"
                  placeholder={`${regionalConfig.currency.symbol} ${formatMoneyInput(currentDefaults.gasto, false, activeCurrencyCode, { forceDecimals: regionalConfig.currency.decimalDigits > 0 })}`}
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.label}>Máx Cuotas</Text>
                <TextInput
                  style={styles.input}
                  value={maxCuotas}
                  onChangeText={t => setMaxCuotas((t || '').replace(/\D/g, '').slice(0, 3))}
                  keyboardType="numeric"
                  placeholder="30"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                />
              </View>
            </View>

            {/* 6. Permisos Especiales */}
            <Text style={styles.sectionTitle}>5. Permisos Especiales</Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t('users.allow_delete_sale')}</Text>
              <Switch
                value={permiteBorrarVenta}
                onValueChange={setPermiteBorrarVenta}
                trackColor={{ false: '#D0D5DD', true: zendapp.colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t('users.allow_modify_payments')}</Text>
              <Switch
                value={permiteModificarPagos}
                onValueChange={setPermiteModificarPagos}
                trackColor={{ false: '#D0D5DD', true: zendapp.colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose}>
              <Text style={styles.btnCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnSubmit, loading && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={loading}
            >
              <Text style={styles.btnSubmitText}>
                {loading ? t('common.saving') : isEditing ? t('users.save_changes') : t('users.create_user')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Modal Genérico de Búsqueda y Selección de Territorio */}
      <Modal visible={pickerModal.visible} transparent animationType="slide" onRequestClose={() => setPickerModal(p => ({ ...p, visible: false }))}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{pickerModal.title}</Text>
              <TouchableOpacity onPress={() => setPickerModal(p => ({ ...p, visible: false }))}>
                <Icon name="times" size={18} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerSearchWrap}>
              <Icon name="search" size={14} color={apple.colors.secondaryLabel} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.pickerSearchInput}
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Buscar..."
                placeholderTextColor={apple.colors.tertiaryLabel}
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={filteredPickerItems}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerItem} onPress={() => handlePickerSelect(item)}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.pickerItemLabel}>{item.label}</Text>
                      {item.is_external ? (
                        <View style={styles.externalBadge}>
                          <Icon name="globe" size={10} color="#2563EB" style={{ marginRight: 4 }} />
                          <Text style={styles.externalBadgeText}>En línea</Text>
                        </View>
                      ) : null}
                    </View>
                    {item.sub ? <Text style={styles.pickerItemSub}>{item.sub}</Text> : null}
                  </View>
                  <Icon name="chevron-right" size={12} color={apple.colors.tertiaryLabel} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => (
                <View style={styles.pickerEmpty}>
                  <Text style={styles.pickerEmptyText}>No se encontraron resultados locales</Text>
                </View>
              )}
              ListFooterComponent={() => {
                if (pickerModal.type !== 'city') return null;
                return (
                  <View style={styles.pickerFooterWrap}>
                    {searchingExternal ? (
                      <View style={styles.searchingRow}>
                        <ActivityIndicator size="small" color="#2563EB" style={{ marginRight: 8 }} />
                        <Text style={styles.searchingText}>Consultando catálogo internacional (GeoNames)...</Text>
                      </View>
                    ) : null}
                    <TouchableOpacity
                      style={styles.manualLocationBtn}
                      onPress={() => {
                        setManualCityName(pickerSearch.trim());
                        setManualModalVisible(true);
                      }}
                    >
                      <Icon name="plus-circle" size={13} color="#2563EB" style={{ marginRight: 6 }} />
                      <Text style={styles.manualLocationBtnText}>
                        ¿No encuentras tu ciudad? Registrar nueva ubicación
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />

            {registeringCity && (
              <View style={styles.registeringOverlay}>
                <ActivityIndicator size="large" color="#2563EB" />
                <Text style={styles.registeringText}>Registrando ubicación en Zenda...</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal para Registro Manual de Ubicación */}
      <Modal visible={manualModalVisible} transparent animationType="fade" onRequestClose={() => setManualModalVisible(false)}>
        <View style={styles.manualOverlay}>
          <View style={styles.manualCard}>
            <Text style={styles.manualTitle}>Registrar Nueva Ubicación</Text>
            <Text style={styles.manualSub}>
              Se registrará en {selectedDivisionObj ? selectedDivisionObj.nombre : 'la división seleccionada'}, {selectedCountryObj ? selectedCountryObj.nombre : 'país seleccionado'}.
            </Text>
            <TextInput
              style={styles.manualInput}
              value={manualCityName}
              onChangeText={setManualCityName}
              placeholder="Nombre de la ciudad o localidad"
              placeholderTextColor="#9CA3AF"
              autoFocus
            />
            <View style={styles.manualButtonsRow}>
              <TouchableOpacity
                style={styles.manualBtnCancel}
                onPress={() => setManualModalVisible(false)}
                disabled={registeringCity}
              >
                <Text style={styles.manualBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.manualBtnSave, registeringCity && { opacity: 0.6 }]}
                onPress={handleSaveManualCity}
                disabled={registeringCity}
              >
                {registeringCity ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.manualBtnSaveText}>Guardar y Seleccionar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: apple.spacing.l,
    borderBottomWidth: 1,
    borderBottomColor: zendapp.colors.border,
  },
  title: {
    fontSize: apple.typography.title3.fontSize,
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
    fontSize: apple.typography.subheadline.fontSize,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  roleContainer: {
    flexDirection: 'row',
    marginBottom: 10,
    gap: 10,
  },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: apple.radius.m,
    borderWidth: 1,
    borderColor: zendapp.colors.border,
    backgroundColor: apple.colors.background,
    gap: 8,
  },
  roleBtnActive: {
    backgroundColor: zendapp.colors.primary,
    borderColor: zendapp.colors.primary,
  },
  roleBtnActiveAdmin: {
    backgroundColor: '#5856D6',
    borderColor: '#5856D6',
  },
  roleText: {
    fontSize: apple.typography.body.fontSize,
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
    fontSize: apple.typography.subheadline.fontSize,
    fontWeight: '500',
    color: apple.colors.label,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: zendapp.colors.border,
    borderRadius: apple.radius.m,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: apple.typography.body.fontSize,
    color: apple.colors.label,
    backgroundColor: apple.colors.background,
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: zendapp.colors.border,
    borderRadius: apple.radius.m,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: apple.colors.background,
  },
  pickerTriggerDisabled: {
    opacity: 0.5,
    backgroundColor: '#F3F4F6',
  },
  pickerTriggerText: {
    fontSize: apple.typography.body.fontSize,
    color: apple.colors.label,
    fontWeight: '500',
  },
  geoSummaryCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: apple.radius.m,
    padding: 12,
    marginVertical: 10,
  },
  geoSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  geoSummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },
  geoSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  geoSummaryItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  geoSummaryItemFull: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  geoSummaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#047857',
  },
  geoSummaryValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#064E3B',
    marginTop: 2,
  },
  geoSummarySub: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: zendapp.colors.border,
  },
  switchLabel: {
    fontSize: apple.typography.body.fontSize,
    color: apple.colors.label,
  },
  footer: {
    flexDirection: 'row',
    padding: apple.spacing.l,
    borderTopWidth: 1,
    borderTopColor: zendapp.colors.border,
    gap: 10,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: apple.radius.m,
    borderWidth: 1,
    borderColor: zendapp.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: {
    fontSize: apple.typography.body.fontSize,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  btnSubmit: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: apple.radius.m,
    backgroundColor: zendapp.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSubmitText: {
    fontSize: apple.typography.body.fontSize,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '65%',
    padding: 16,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  pickerSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 12,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    padding: 0,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  pickerItemLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  pickerItemSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  pickerEmpty: {
    padding: 24,
    alignItems: 'center',
  },
  pickerEmptyText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  externalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  externalBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#2563EB',
  },
  pickerFooterWrap: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  searchingText: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  manualLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginTop: 8,
  },
  manualLocationBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0284C7',
  },
  registeringOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  registeringText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  manualOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  manualCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  manualTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  manualSub: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 18,
  },
  manualInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0F172A',
    marginBottom: 18,
    backgroundColor: '#F8FAFC',
  },
  manualButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  manualBtnCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  manualBtnCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  manualBtnSave: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  manualBtnSaveText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
