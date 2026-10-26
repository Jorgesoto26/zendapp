import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  BackHandler,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Animated,
  Modal,
  FlatList,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { getData, getDbConnection } from '../../database/db';
import CustomPicker from './CustomPicker';
import { apple } from '../../theme/appleTheme';
import { AppleButton } from '../../components/AppleButton';
import { appAlert } from '../../components/AppAlert';
import { useAuth } from '../../context/AuthContext';
import { getCajaActual } from '../../services/cajaService';
import { getCurrentLocationOrNull } from '../../services/movementsService';
import { SyncWithSupabase } from '../../utils/sync';
import {
  formatMoneyInput,
  parseMoneyToNumeric,
  FormatMoneyDecimales,
  getAndIncrementConsecutivo,
} from '../../utils/utilities';
import { eventBus, EVENTS } from '../../utils/eventBus';

const FormField = React.memo(({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  icon,
  maxLength,
  hint,
  error,
  editable = true,
}) => (
  <View style={styles.field}>
    <View style={styles.fieldLabelRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldCounter}>{hint}</Text> : null}
    </View>
    <View style={[styles.inputWrap, error ? styles.inputWrapError : null, !editable && styles.inputWrapDisabled]}>
      {icon && <Icon name={icon} size={14} color={error ? apple.colors.danger : apple.colors.tertiaryLabel} style={{ marginRight: 8 }} />}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={apple.colors.tertiaryLabel}
        style={[styles.input, !editable && { color: apple.colors.secondaryLabel }]}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={editable}
      />
    </View>
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>
));

const CrearCliente = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { userId } = useAuth();
  const fade = useRef(new Animated.Value(0)).current;

  const [formData, setFormData] = useState({
    nombre: '',
    apellido: '',
    alias: '',
    direccion: '',
    telefono: '',
    genero: 'masculino',
    documento: '',
    valor: '',
    plazo: '',
    interes: '',
  });
  const [formDataLabels, setFormDataLabels] = useState({ plazo: '', interes: '' });
  const [isFormValid, setIsFormValid] = useState(false);
  const [conceptosInteres, setConceptosInteres] = useState([]);
  const [conceptosPlazo, setConceptosPlazo] = useState([]);
  const [showPlazoModal, setShowPlazoModal] = useState(false);
  const [showInteresModal, setShowInteresModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Renovacion de credito
  const [previousInvoiceId, setPreviousInvoiceId] = useState(null);
  const [renewalClientName, setRenewalClientName] = useState(null);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [paidClientsList, setPaidClientsList] = useState([]);
  const [searchRenewText, setSearchRenewText] = useState('');

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    LoadData();
  }, []);

  // Recibir renovacion desde rutas externas (ej. CreditDetail)
  useEffect(() => {
    if (route.params?.renewClient) {
      const rc = route.params.renewClient;
      setPreviousInvoiceId(rc.id || null);
      setRenewalClientName(`${rc.nombre || ''} ${rc.apellido || ''}`.trim());
      setFormData(p => ({
        ...p,
        nombre: rc.nombre || '',
        apellido: rc.apellido || '',
        alias: rc.alias || '',
        direccion: rc.direccion || '',
        telefono: (rc.telefono || '').replace(/\D/g, '').slice(0, 12),
        documento: (rc.documento || '').trim().slice(0, 12),
        genero: rc.genero || p.genero || 'masculino',
      }));
    }
  }, [route.params?.renewClient]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.navigate('Payments');
        return true;
      });
      const beforeRemove = navigation.addListener('beforeRemove', (e) => {
        if (e.data.action.type === 'GO_BACK') {
          e.preventDefault();
          navigation.navigate('Payments');
        }
      });
      return () => {
        sub.remove();
        beforeRemove();
      };
    }, [navigation])
  );

  const LoadData = async () => {
    try {
      const db = await getDbConnection();
      const conceptosData = await getData(db, 'SELECT * FROM concepts');
      if (conceptosData) {
        setConceptosInteres(conceptosData.filter(c => c.tipo === 'interes'));
        setConceptosPlazo(conceptosData.filter(c => c.tipo === 'plazo'));
      }
      // Cargar clientes con creditos saldados para renovacion
      const paid = await getData(
        db,
        `SELECT id, nombreUno, apellidoUno, alias, celular, documento, direccion, saldo
         FROM facturas
         WHERE saldo <= 0 OR estado = 'cancel'
         GROUP BY documento
         ORDER BY fecha DESC LIMIT 50`
      );
      setPaidClientsList(paid || []);
    } catch (e) {
      console.error('Error cargando conceptos en CrearCliente:', e);
    }
  };

  // Validaciones en tiempo real
  const cleanTel = useMemo(() => (formData.telefono || '').replace(/\D/g, ''), [formData.telefono]);
  const cleanDoc = useMemo(() => (formData.documento || '').trim(), [formData.documento]);

  const telError = useMemo(() => {
    if (!formData.telefono) return null;
    if (cleanTel.length < 10) return `Mínimo 10 dígitos (actual: ${cleanTel.length})`;
    if (cleanTel.length > 12) return `Máximo 12 dígitos (actual: ${cleanTel.length})`;
    return null;
  }, [formData.telefono, cleanTel]);

  const docError = useMemo(() => {
    if (!formData.documento) return null;
    if (cleanDoc.length < 6) return `Mínimo 6 caracteres (actual: ${cleanDoc.length})`;
    if (cleanDoc.length > 12) return `Máximo 12 caracteres (actual: ${cleanDoc.length})`;
    return null;
  }, [formData.documento, cleanDoc]);

  useEffect(() => {
    const isTelValid = cleanTel.length >= 10 && cleanTel.length <= 12;
    const isDocValid = cleanDoc.length >= 6 && cleanDoc.length <= 12;
    const isValorValid = parseMoneyToNumeric(formData.valor) > 0;
    const isNombreValid = (formData.nombre || '').trim() !== '';
    const isDireccionValid = (formData.direccion || '').trim() !== '';
    const isPlazoValid = !!formData.plazo;
    const isInteresValid = !!formData.interes;

    setIsFormValid(
      isTelValid &&
      isDocValid &&
      isValorValid &&
      isNombreValid &&
      isDireccionValid &&
      isPlazoValid &&
      isInteresValid
    );
  }, [formData, cleanTel, cleanDoc]);

  // Calculo de la Cuota Estimada (Requisito 3)
  const quoteSummary = useMemo(() => {
    const montoNum = parseMoneyToNumeric(formData.valor);
    if (!montoNum || montoNum <= 0) return null;

    const plazoObj = conceptosPlazo.find(c => String(c.id) === String(formData.plazo));
    let numCuotas = 1;
    if (plazoObj?.valor) {
      const match = plazoObj.valor.match(/\d+/);
      if (match) numCuotas = parseInt(match[0], 10) || 1;
    }

    const interesObj = conceptosInteres.find(c => String(c.id) === String(formData.interes));
    let tasaNum = 0;
    let tasaPorcentaje = 0;
    if (interesObj?.valor) {
      const matchInt = interesObj.valor.match(/([0-9]+(?:\.[0-9]+)?)/);
      if (matchInt) {
        const rawVal = parseFloat(matchInt[0]);
        tasaNum = rawVal < 1 ? rawVal : rawVal / 100.0;
        tasaPorcentaje = rawVal < 1 ? Math.round(rawVal * 100) : rawVal;
      }
    }

    const montoInteres = Math.round(montoNum * tasaNum);
    const totalFactura = montoNum + montoInteres;
    const valorCuota = Math.round(totalFactura / numCuotas);

    return {
      capital: montoNum,
      tasaPorcentaje,
      montoInteres,
      totalFactura,
      numCuotas,
      valorCuota,
      plazoLabel: formDataLabels.plazo || `${numCuotas} cuotas`,
      interesLabel: formDataLabels.interes || `${tasaPorcentaje}%`,
    };
  }, [formData.valor, formData.plazo, formData.interes, conceptosPlazo, conceptosInteres, formDataLabels]);

  const handleChange = useCallback((name, value) => {
    if (name === 'valor') {
      const formatted = formatMoneyInput(value);
      setFormData(p => ({ ...p, [name]: formatted }));
      return;
    }
    if (name === 'telefono') {
      // Filtrar solo digitos y recortar a maximo 12
      const digitsOnly = (value || '').replace(/\D/g, '').slice(0, 12);
      setFormData(p => ({ ...p, [name]: digitsOnly }));
      return;
    }
    if (name === 'documento') {
      // Limitar a 12 caracteres maximo
      setFormData(p => ({ ...p, [name]: (value || '').slice(0, 12) }));
      return;
    }
    setFormData(p => ({ ...p, [name]: value }));
  }, []);

  const handlePickerSelect = (name, value, label) => {
    setFormData(p => ({ ...p, [name]: value }));
    setFormDataLabels(p => ({ ...p, [name]: label }));
  };

  const handleGeneroChange = g => setFormData(p => ({ ...p, genero: g }));

  // Seleccionar cliente para renovacion
  const handleSelectRenewalClient = (client) => {
    setPreviousInvoiceId(client.id);
    setRenewalClientName(`${client.nombreUno || ''} ${client.apellidoUno || ''}`.trim());
    setFormData(p => ({
      ...p,
      nombre: client.nombreUno || '',
      apellido: client.apellidoUno || '',
      alias: client.alias || '',
      direccion: client.direccion || '',
      telefono: (client.celular || '').replace(/\D/g, '').slice(0, 12),
      documento: (client.documento || '').trim().slice(0, 12),
    }));
    setShowRenewModal(false);
  };

  const handleClearRenewal = () => {
    setPreviousInvoiceId(null);
    setRenewalClientName(null);
    setFormData({
      nombre: '',
      apellido: '',
      alias: '',
      direccion: '',
      telefono: '',
      genero: 'masculino',
      documento: '',
      valor: '',
      plazo: '',
      interes: '',
    });
    setFormDataLabels({ plazo: '', interes: '' });
  };

  const handleSubmit = async () => {
    if (!userId) {
      appAlert('Error', 'Sesión no válida. Por favor inicia sesión nuevamente.');
      return;
    }

    // Validaciones estrictas con mensajes claros
    if (cleanTel.length < 10 || cleanTel.length > 12) {
      appAlert('Teléfono inválido', `El teléfono debe tener entre 10 y 12 dígitos. Actualmente tiene ${cleanTel.length}.`);
      return;
    }
    if (cleanDoc.length < 6 || cleanDoc.length > 12) {
      appAlert('Documento inválido', `El documento debe tener entre 6 y 12 caracteres. Actualmente tiene ${cleanDoc.length}.`);
      return;
    }

    const montoNum = parseMoneyToNumeric(formData.valor);
    if (!montoNum || montoNum <= 0) {
      appAlert('Valor inválido', 'El monto del crédito debe ser mayor a 0');
      return;
    }

    if (!quoteSummary) {
      appAlert('Faltan datos', 'Por favor selecciona el plazo y el interés del crédito.');
      return;
    }

    // Validacion de limite maximo de venta por usuario (Requisito 1)
    const maxVenta = parseFloat(profile?.dinero_max_venta) || 0;
    if (maxVenta > 0 && montoNum > maxVenta) {
      appAlert(
        'Límite de venta excedido',
        `El monto ($${montoNum.toLocaleString('es-CO')}) excede tu límite máximo permitido por venta ($${maxVenta.toLocaleString('es-CO')}).`
      );
      return;
    }

    // Validacion de limite maximo de cuotas por usuario (Requisito 1)
    const maxCuotas = parseInt(profile?.max_cuotas, 10) || 0;
    if (maxCuotas > 0 && quoteSummary && quoteSummary.numCuotas > maxCuotas) {
      appAlert(
        'Límite de cuotas excedido',
        `La cantidad de cuotas (${quoteSummary.numCuotas}) supera el máximo permitido para tu usuario (${maxCuotas} cuotas).`
      );
      return;
    }

    setSaving(true);
    try {
      // 1. Obtener caja abierta
      const cajaAbierta = await getCajaActual();
      if (!cajaAbierta) {
        appAlert('Sin caja abierta', 'No tienes una caja abierta. Ve a la sección Caja y abre una antes de registrar ventas.');
        setSaving(false);
        return;
      }

      const database = await getDbConnection();
      const { nombre, apellido, alias, direccion, genero, plazo, interes } = formData;
      const { numCuotas, totalFactura, valorCuota } = quoteSummary;

      // 2. Captura segura de ubicacion (Requisito 2)
      let latitudStr = null;
      let longitudStr = null;
      try {
        const loc = await getCurrentLocationOrNull();
        if (loc && loc.lat != null && loc.lng != null) {
          latitudStr = String(loc.lat);
          longitudStr = String(loc.lng);
        }
      } catch (locErr) {
        console.log('Advertencia obteniendo geolocalizacion:', locErr);
      }

      const tempId = -Date.now();
      const nowIso = new Date().toISOString();
      const todayDate = nowIso.slice(0, 10);

      const salePayload = {
        nombre: nombre.trim(),
        apellido: (apellido || '').trim(),
        alias: (alias || '').trim(),
        email: '',
        telefono: cleanTel,
        direccion: (direccion || '').trim(),
        documento: cleanDoc,
        genero: genero || 'masculino',
        monto: montoNum,
        vendedor_id: userId,
        caja_id: cajaAbierta.id,
        plazo_id: parseInt(plazo, 10),
        interes_id: parseInt(interes, 10),
        latitud: latitudStr,
        longitud: longitudStr,
        previous_invoice_id: previousInvoiceId || null,
      };

      // 3. Guardar en ventas_pendientes
      await database.executeSql(`CREATE TABLE IF NOT EXISTS ventas_pendientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        temp_id TEXT UNIQUE,
        payload TEXT,
        estado TEXT DEFAULT 'pendiente',
        created_at TEXT
      )`);
      await database.executeSql(
        `INSERT INTO ventas_pendientes (temp_id, payload, estado, created_at) VALUES (?, ?, 'pendiente', ?)`,
        [String(tempId), JSON.stringify(salePayload), nowIso]
      );

      // 4. Obtener consecutivo tramitado para que nazca en Tramitados (Requisito 6)
      const consecutivo = await getAndIncrementConsecutivo(database);

      // 5. Guardar en SQLite facturas con estadoMovil = 'actualizado' (Tramitado de hoy)
      await database.executeSql(
        `INSERT OR REPLACE INTO facturas (
          id, nombreUno, apellidoUno, alias, documento, celular, direccion,
          saldo, valorInicial, valorCuota, num_cuotas, cuotasPagas, cuotasVencidas,
          estado, estadoMovil, fecha, idVendedor, usuarioId, paymentTermId, detalles,
          consecutivoTramitado, latitud, longitud, previous_invoice_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pendiente', 'actualizado', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(tempId),
          nombre.trim(),
          (apellido || '').trim(),
          (alias || '').trim(),
          cleanDoc,
          cleanTel,
          (direccion || '').trim(),
          totalFactura,
          totalFactura,
          valorCuota,
          String(numCuotas),
          todayDate,
          userId,
          userId,
          plazo,
          JSON.stringify(salePayload),
          consecutivo,
          latitudStr,
          longitudStr,
          previousInvoiceId || null,
        ]
      );

      // 6. Registrar movimiento local de venta con id negativo para coherencia contable inmediata
      const clienteDesc = `${nombre.trim()} ${apellido.trim()}`.trim();
      await database.executeSql(
        `INSERT INTO movimientos (id, descripcion, monto, horaDispositivo, tipo, estadoMovil, idCaja, fecha, idFactura, cliente_nombre)
         VALUES (?, ?, ?, ?, 'venta', 'sincronizado', ?, ?, ?, ?)`,
        [
          tempId - 1,
          `Venta: ${clienteDesc} (${cleanDoc})`,
          montoNum,
          nowIso,
          cajaAbierta.id,
          nowIso,
          String(tempId),
          clienteDesc,
        ]
      );

      // 7. Descontar saldo_final de la caja localmente
      try {
        await database.executeSql(
          `UPDATE cajas SET saldo_final = COALESCE(saldo_final, 0) - ? WHERE id = ?`,
          [montoNum, cajaAbierta.id]
        );
      } catch {}

      // 8. Notificar a las demas vistas via EventBus (Requisito 4)
      eventBus.emit(EVENTS.CLIENT_CREATED, {
        id: tempId,
        nombre: clienteDesc,
        monto: totalFactura,
      });

      // 9. Sincronizar en background si hay red
      try {
        SyncWithSupabase(false, () => {});
      } catch {}

      appAlert(
        '¡Venta registrada exitosamente!',
        previousInvoiceId
          ? `La renovación de crédito para ${clienteDesc} quedó registrada y lista en tu lista de tramitados.`
          : `El crédito para ${clienteDesc} quedó registrado y visible en tu lista de tramitados.`
      );

      setFormData({
        nombre: '',
        apellido: '',
        alias: '',
        direccion: '',
        telefono: '',
        genero: 'masculino',
        documento: '',
        valor: '',
        plazo: '',
        interes: '',
      });
      setFormDataLabels({ plazo: '', interes: '' });
      setPreviousInvoiceId(null);
      setRenewalClientName(null);

      navigation.navigate('Payments');
    } catch (err) {
      console.log('Error guardando venta:', err.message);
      appAlert('Error', err.message || 'No se pudo guardar la venta');
    } finally {
      setSaving(false);
    }
  };

  const filteredPaidClients = useMemo(() => {
    if (!searchRenewText.trim()) return paidClientsList;
    const q = searchRenewText.toLowerCase();
    return paidClientsList.filter(c =>
      (c.nombreUno || '').toLowerCase().includes(q) ||
      (c.apellidoUno || '').toLowerCase().includes(q) ||
      (c.documento || '').includes(q) ||
      (c.alias || '').toLowerCase().includes(q)
    );
  }, [paidClientsList, searchRenewText]);

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.headerBtn}
        >
          <Icon name="chevron-left" size={16} color={apple.colors.blue} />
          <Text style={styles.headerBack}>Atrás</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{previousInvoiceId ? 'Renovar Crédito' : 'Nueva Venta'}</Text>
        <TouchableOpacity
          onPress={() => setShowRenewModal(true)}
          style={styles.headerRenewBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="history" size={14} color={apple.colors.blue} />
          <Text style={styles.headerRenewText}>Renovar</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={{ opacity: fade }}>
            {/* Banner de Renovacion si aplica */}
            {previousInvoiceId && (
              <View style={styles.renewalBanner}>
                <View style={styles.renewalBannerIcon}>
                  <Icon name="refresh" size={14} color={apple.colors.blue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.renewalBannerTitle}>Renovando crédito existente</Text>
                  <Text style={styles.renewalBannerSub}>{renewalClientName} (Doc: {formData.documento})</Text>
                </View>
                <TouchableOpacity onPress={handleClearRenewal} style={styles.renewalClearBtn}>
                  <Icon name="times" size={14} color={apple.colors.secondaryLabel} />
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.pageTitle}>{previousInvoiceId ? 'Renovación de Crédito' : 'Crear cliente y crédito'}</Text>
            <Text style={styles.pageSub}>
              {previousInvoiceId
                ? 'Los datos personales fueron precargados del crédito anterior. Define el nuevo monto, plazo e interés.'
                : 'Completa los datos. El cliente y la factura se crean transaccionalmente.'}
            </Text>

            {/* Seccion 1: Informacion Personal */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: '#E8F0FE' }]}>
                  <Icon name="user" size={14} color={apple.colors.blue} />
                </View>
                <Text style={styles.sectionTitle}>Información personal</Text>
              </View>

              <FormField
                label="Nombre *"
                value={formData.nombre}
                onChangeText={t => handleChange('nombre', t)}
                placeholder="Ej. Carlos"
                icon="user"
                editable={!previousInvoiceId}
              />
              <FormField
                label="Apellido *"
                value={formData.apellido}
                onChangeText={t => handleChange('apellido', t)}
                placeholder="Ej. Ramírez"
                icon="user-o"
                editable={!previousInvoiceId}
              />
              <FormField
                label="Alias"
                value={formData.alias}
                onChangeText={t => handleChange('alias', t)}
                placeholder="Ej. carlosr"
                icon="star-o"
              />

              <Text style={styles.fieldLabel}>Género *</Text>
              <View style={styles.segment}>
                {['masculino', 'femenino'].map(g => (
                  <TouchableOpacity
                    key={g}
                    onPress={() => handleGeneroChange(g)}
                    style={[styles.segmentOpt, formData.genero === g && styles.segmentOptActive]}
                  >
                    <Text style={[styles.segmentText, formData.genero === g && styles.segmentTextActive]}>
                      {g === 'masculino' ? 'Masculino' : 'Femenino'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Seccion 2: Contacto y Documento */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: '#E8F5E9' }]}>
                  <Icon name="map-marker" size={14} color={apple.colors.success} />
                </View>
                <Text style={styles.sectionTitle}>Contacto y Documento</Text>
              </View>

              <FormField
                label="Dirección *"
                value={formData.direccion}
                onChangeText={t => handleChange('direccion', t)}
                placeholder="Calle 123 #45-67"
                icon="home"
              />
              <FormField
                label="Teléfono * (10 a 12 dígitos)"
                value={formData.telefono}
                onChangeText={t => handleChange('telefono', t)}
                placeholder="Ej. 3112345678"
                keyboardType="phone-pad"
                icon="phone"
                maxLength={12}
                hint={`${cleanTel.length}/12`}
                error={telError}
              />
              <FormField
                label="Documento * (6 a 12 caracteres)"
                value={formData.documento}
                onChangeText={t => handleChange('documento', t)}
                placeholder="CC / NIT"
                keyboardType="numeric"
                icon="id-card"
                maxLength={12}
                hint={`${cleanDoc.length}/12`}
                error={docError}
                editable={!previousInvoiceId}
              />
            </View>

            {/* Seccion 3: Condiciones del Credito */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: '#FFF3E0' }]}>
                  <Icon name="money" size={14} color={apple.colors.warning} />
                </View>
                <Text style={styles.sectionTitle}>Condiciones de la Venta</Text>
              </View>

              <FormField
                label="Capital a prestar *"
                value={formData.valor}
                onChangeText={t => handleChange('valor', t)}
                placeholder="$ 0"
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>Plazo *</Text>
              <TouchableOpacity style={styles.picker} onPress={() => setShowPlazoModal(true)}>
                <Text style={[styles.pickerText, !formDataLabels.plazo && { color: apple.colors.tertiaryLabel }]}>
                  {formDataLabels.plazo || 'Selecciona plazo'}
                </Text>
                <Icon name="chevron-down" size={12} color={apple.colors.tertiaryLabel} />
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Interés *</Text>
              <TouchableOpacity style={styles.picker} onPress={() => setShowInteresModal(true)}>
                <Text style={[styles.pickerText, !formDataLabels.interes && { color: apple.colors.tertiaryLabel }]}>
                  {formDataLabels.interes || 'Selecciona interés'}
                </Text>
                <Icon name="chevron-down" size={12} color={apple.colors.tertiaryLabel} />
              </TouchableOpacity>
            </View>

            {/* Resumen de la Cuota Estimada (Requisito 3) */}
            {quoteSummary ? (
              <View style={styles.quoteCard}>
                <View style={styles.quoteHeader}>
                  <View style={styles.quoteTitleRow}>
                    <Icon name="calculator" size={15} color={apple.colors.blue} />
                    <Text style={styles.quoteTitle}>Vista previa de la cuota</Text>
                  </View>
                  <View style={styles.estimateBadge}>
                    <Text style={styles.estimateBadgeText}>Estimación</Text>
                  </View>
                </View>

                <View style={styles.quoteDivider} />

                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Capital solicitado:</Text>
                  <Text style={styles.quoteValue}>{FormatMoneyDecimales(quoteSummary.capital)}</Text>
                </View>
                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Interés estimado ({quoteSummary.interesLabel}):</Text>
                  <Text style={styles.quoteValue}>+ {FormatMoneyDecimales(quoteSummary.montoInteres)}</Text>
                </View>
                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Total del crédito:</Text>
                  <Text style={[styles.quoteValue, { fontWeight: '700' }]}>{FormatMoneyDecimales(quoteSummary.totalFactura)}</Text>
                </View>
                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Plazo seleccionado:</Text>
                  <Text style={styles.quoteValue}>{quoteSummary.plazoLabel}</Text>
                </View>

                <View style={styles.quoteResultBox}>
                  <Text style={styles.quoteResultLabel}>Cuota aproximada a pagar:</Text>
                  <Text style={styles.quoteResultAmount}>{FormatMoneyDecimales(quoteSummary.valorCuota)}</Text>
                  <Text style={styles.quoteResultSub}>{quoteSummary.numCuotas} cuota(s) calculada(s)</Text>
                </View>

                <Text style={styles.quoteFootnote}>
                  * Cálculo informativo. Se guardará con las mismas reglas contables oficiales.
                </Text>
              </View>
            ) : null}

            {/* Boton Guardar */}
            <AppleButton
              title={saving ? 'Guardando...' : previousInvoiceId ? 'Guardar renovación' : 'Guardar venta'}
              onPress={handleSubmit}
              loading={saving}
              disabled={!isFormValid || saving}
              style={{ marginTop: 12 }}
            />

            {!isFormValid && (
              <Text style={styles.hint}>
                {!cleanTel || cleanTel.length < 10
                  ? 'Ingresa un teléfono válido de 10 a 12 dígitos.'
                  : !cleanDoc || cleanDoc.length < 6
                  ? 'Ingresa un documento válido de 6 a 12 caracteres.'
                  : 'Completa todos los campos obligatorios para habilitar el guardado.'}
              </Text>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Selector de Plazo */}
      <CustomPicker
        data={conceptosPlazo}
        selectedValue={formData.plazo}
        onSelect={(v, l) => handlePickerSelect('plazo', v, l)}
        placeholder="Seleccionar Plazo"
        visible={showPlazoModal}
        onClose={() => setShowPlazoModal(false)}
      />

      {/* Selector de Interes */}
      <CustomPicker
        data={conceptosInteres}
        selectedValue={formData.interes}
        onSelect={(v, l) => handlePickerSelect('interes', v, l)}
        placeholder="Seleccionar Interés"
        visible={showInteresModal}
        onClose={() => setShowInteresModal(false)}
      />

      {/* Modal de Renovacion de Clientes (Requisito 10) */}
      <Modal visible={showRenewModal} animationType="slide" transparent onRequestClose={() => setShowRenewModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Renovar cliente pagado</Text>
              <TouchableOpacity onPress={() => setShowRenewModal(false)} style={styles.modalCloseBtn}>
                <Icon name="times" size={16} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchWrapModal}>
              <Icon name="search" size={13} color={apple.colors.tertiaryLabel} />
              <TextInput
                value={searchRenewText}
                onChangeText={setSearchRenewText}
                placeholder="Buscar por nombre o cédula..."
                placeholderTextColor={apple.colors.tertiaryLabel}
                style={styles.searchInputModal}
              />
            </View>

            <FlatList
              data={filteredPaidClients}
              keyExtractor={item => String(item.id)}
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.paidClientItem}
                  onPress={() => handleSelectRenewalClient(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paidClientName}>{item.nombreUno} {item.apellidoUno || ''}</Text>
                    <Text style={styles.paidClientSub}>Doc: {item.documento || 'S/D'} • Tel: {item.celular || 'S/T'}</Text>
                    {item.direccion ? <Text style={styles.paidClientDir}>{item.direccion}</Text> : null}
                  </View>
                  <View style={styles.paidClientAction}>
                    <Text style={styles.paidClientActionText}>Seleccionar</Text>
                    <Icon name="chevron-right" size={12} color={apple.colors.blue} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyRenewWrap}>
                  <Icon name="users" size={32} color={apple.colors.tertiaryLabel} />
                  <Text style={styles.emptyRenewTitle}>No se encontraron clientes pagados</Text>
                  <Text style={styles.emptyRenewSub}>Solo los clientes con saldo $0 o finalizados pueden renovarse.</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: apple.colors.bgGrouped },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: apple.colors.card,
    borderBottomWidth: 0.5,
    borderColor: apple.colors.separator,
  },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBack: { fontSize: 16, color: apple.colors.blue },
  headerTitle: { fontSize: 17, fontWeight: '600', color: apple.colors.label },
  headerRenewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: apple.radius.s,
    backgroundColor: '#EFF6FF',
  },
  headerRenewText: { fontSize: 13, fontWeight: '600', color: apple.colors.blue },
  renewalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: apple.radius.m,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  renewalBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renewalBannerTitle: { fontSize: 13, fontWeight: '700', color: apple.colors.blue },
  renewalBannerSub: { fontSize: 12, color: apple.colors.secondaryLabel, marginTop: 1 },
  renewalClearBtn: { padding: 6 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: apple.colors.label, marginBottom: 4 },
  pageSub: { fontSize: 14, color: apple.colors.secondaryLabel, marginBottom: 20 },
  section: {
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.l,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: apple.colors.label },
  field: { marginBottom: 14 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '500', color: apple.colors.label },
  fieldCounter: { fontSize: 11, color: apple.colors.tertiaryLabel },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.m,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    paddingHorizontal: 12,
    height: 44,
  },
  inputWrapError: { borderColor: apple.colors.danger },
  inputWrapDisabled: { backgroundColor: '#F1F5F9', opacity: 0.8 },
  input: { flex: 1, fontSize: 15, color: apple.colors.label },
  errorText: { fontSize: 11, color: apple.colors.danger, marginTop: 4, fontWeight: '500' },
  segment: {
    flexDirection: 'row',
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.m,
    padding: 3,
    gap: 4,
  },
  segmentOpt: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: apple.radius.s },
  segmentOptActive: { backgroundColor: apple.colors.card, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  segmentText: { fontSize: 13, fontWeight: '500', color: apple.colors.secondaryLabel },
  segmentTextActive: { color: apple.colors.label, fontWeight: '600' },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.m,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 14,
  },
  pickerText: { fontSize: 15, color: apple.colors.label },
  hint: { fontSize: 12, color: apple.colors.secondaryLabel, textAlign: 'center', marginTop: 10 },

  // Tarjeta Resumen de Cuota (Requisito 3)
  quoteCard: {
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.l,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    backgroundColor: '#F8FAFC',
  },
  quoteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quoteTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quoteTitle: { fontSize: 15, fontWeight: '700', color: apple.colors.blue },
  estimateBadge: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  estimateBadgeText: { fontSize: 11, fontWeight: '700', color: apple.colors.blue },
  quoteDivider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 12 },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  quoteLabel: { fontSize: 13, color: apple.colors.secondaryLabel },
  quoteValue: { fontSize: 13, fontWeight: '600', color: apple.colors.label },
  quoteResultBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: apple.radius.m,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 6,
  },
  quoteResultLabel: { fontSize: 12, fontWeight: '600', color: '#065F46', textTransform: 'uppercase', letterSpacing: 0.5 },
  quoteResultAmount: { fontSize: 24, fontWeight: '800', color: '#047857', marginVertical: 2 },
  quoteResultSub: { fontSize: 12, color: '#059669', fontWeight: '500' },
  quoteFootnote: { fontSize: 11, color: apple.colors.tertiaryLabel, textAlign: 'center', marginTop: 4, fontStyle: 'italic' },

  // Modal Renovacion
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: apple.colors.card,
    borderTopLeftRadius: apple.radius.xl,
    borderTopRightRadius: apple.radius.xl,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: apple.colors.label },
  modalCloseBtn: { padding: 4 },
  searchWrapModal: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: apple.colors.bgGrouped,
    borderRadius: apple.radius.m,
    paddingHorizontal: 12,
    height: 40,
    marginBottom: 10,
    gap: 8,
  },
  searchInputModal: { flex: 1, fontSize: 14, color: apple.colors.label },
  paidClientItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderColor: apple.colors.separator,
    gap: 12,
  },
  paidClientName: { fontSize: 14, fontWeight: '600', color: apple.colors.label },
  paidClientSub: { fontSize: 12, color: apple.colors.secondaryLabel, marginTop: 2 },
  paidClientDir: { fontSize: 11, color: apple.colors.tertiaryLabel, marginTop: 1 },
  paidClientAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  paidClientActionText: { fontSize: 13, fontWeight: '600', color: apple.colors.blue },
  emptyRenewWrap: { alignItems: 'center', paddingVertical: 40 },
  emptyRenewTitle: { fontSize: 14, fontWeight: '600', color: apple.colors.secondaryLabel, marginTop: 10 },
  emptyRenewSub: { fontSize: 12, color: apple.colors.tertiaryLabel, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
});

export default CrearCliente;
