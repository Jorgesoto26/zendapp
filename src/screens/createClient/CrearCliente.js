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
  Image,
  Switch,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { getData, getDbConnection } from '../../database/db';
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
import {
  capturePhotoFromCamera,
  pickPhotoFromGallery,
  uploadEvidence,
} from '../../services/multimediaService';
import EvidencePreviewModal from '../../components/EvidencePreviewModal';

/**
 * Agrega meses a una fecha respetando la cantidad de días de cada mes (ej. 31 de enero -> 28/29 feb)
 */
function addMonths(date, months) {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  const targetYear = d.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const originalDay = d.getDate();
  const daysInTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const day = Math.min(originalDay, daysInTargetMonth);
  return new Date(targetYear, normalizedMonth, day);
}

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
  const { userId, profile } = useAuth();
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
    numCuotas: '30',
    tasaInteres: '20',
  });

  const [periodicidad, setPeriodicidad] = useState('diario'); // 'diario' | 'semanal' | 'mensual'
  const [pagoAdelantado, setPagoAdelantado] = useState(false);
  const [fotoDocumento, setFotoDocumento] = useState(null);
  const [previewDocModal, setPreviewDocModal] = useState(false);

  const [isFormValid, setIsFormValid] = useState(false);
  const [conceptosInteres, setConceptosInteres] = useState([]);
  const [conceptosPlazo, setConceptosPlazo] = useState([]);
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

  const cuotasError = useMemo(() => {
    if (!formData.numCuotas) return 'Ingresa la cantidad de cuotas';
    const n = parseInt(formData.numCuotas, 10);
    if (isNaN(n) || n < 1 || n > 90) return 'La cantidad debe ser entre 1 y 90';
    return null;
  }, [formData.numCuotas]);

  const interesError = useMemo(() => {
    if (!formData.tasaInteres) return 'Ingresa el porcentaje de interés';
    const n = parseFloat(formData.tasaInteres);
    if (isNaN(n) || n < 0 || n > 100) return 'El interés debe ser entre 0% y 100%';
    return null;
  }, [formData.tasaInteres]);

  useEffect(() => {
    const isTelValid = cleanTel.length >= 10 && cleanTel.length <= 12;
    const isDocValid = cleanDoc.length >= 6 && cleanDoc.length <= 12;
    const isValorValid = parseMoneyToNumeric(formData.valor) > 0;
    const isNombreValid = (formData.nombre || '').trim() !== '';
    const isDireccionValid = (formData.direccion || '').trim() !== '';
    const isCuotasValid = !cuotasError;
    const isInteresValid = !interesError;

    setIsFormValid(
      isTelValid &&
      isDocValid &&
      isValorValid &&
      isNombreValid &&
      isDireccionValid &&
      isCuotasValid &&
      isInteresValid
    );
  }, [formData, cleanTel, cleanDoc, cuotasError, interesError]);

  // Calculo de la Cuota Estimada
  const quoteSummary = useMemo(() => {
    const montoNum = parseMoneyToNumeric(formData.valor);
    if (!montoNum || montoNum <= 0) return null;

    const cuotasNum = parseInt(formData.numCuotas, 10);
    if (isNaN(cuotasNum) || cuotasNum < 1 || cuotasNum > 90) return null;

    const tasaNum = parseFloat(formData.tasaInteres);
    if (isNaN(tasaNum) || tasaNum < 0) return null;

    const tasaFrac = tasaNum > 1 ? tasaNum / 100.0 : tasaNum;
    const montoInteres = Math.round(montoNum * tasaFrac);
    const totalFactura = montoNum + montoInteres;
    const valorCuota = Math.round(totalFactura / cuotasNum);

    // Calcular fecha del próximo día de recaudo
    const now = new Date();
    let proximoRecaudoDate = new Date();
    if (periodicidad === 'semanal') {
      proximoRecaudoDate.setDate(now.getDate() + 7);
    } else if (periodicidad === 'mensual') {
      proximoRecaudoDate = addMonths(now, 1);
    } else {
      proximoRecaudoDate.setDate(now.getDate() + 1);
    }
    const proximoRecaudoStr = proximoRecaudoDate.toISOString().slice(0, 10);

    return {
      capital: montoNum,
      tasaPorcentaje: tasaNum,
      montoInteres,
      totalFactura,
      numCuotas: cuotasNum,
      valorCuota,
      periodicidad,
      proximoRecaudoStr,
      pagoAdelantado,
      saldoInicial: pagoAdelantado ? totalFactura - valorCuota : totalFactura,
    };
  }, [formData.valor, formData.numCuotas, formData.tasaInteres, periodicidad, pagoAdelantado]);

  const handleChange = useCallback((name, value) => {
    if (name === 'valor') {
      const formatted = formatMoneyInput(value);
      setFormData(p => ({ ...p, [name]: formatted }));
      return;
    }
    if (name === 'telefono') {
      const digitsOnly = (value || '').replace(/\D/g, '').slice(0, 12);
      setFormData(p => ({ ...p, [name]: digitsOnly }));
      return;
    }
    if (name === 'documento') {
      setFormData(p => ({ ...p, [name]: (value || '').slice(0, 12) }));
      return;
    }
    if (name === 'numCuotas') {
      const cleanInt = (value || '').replace(/\D/g, '').slice(0, 2);
      setFormData(p => ({ ...p, numCuotas: cleanInt }));
      return;
    }
    if (name === 'tasaInteres') {
      const cleanRate = (value || '').replace(/[^0-9.]/g, '').slice(0, 5);
      setFormData(p => ({ ...p, tasaInteres: cleanRate }));
      return;
    }
    setFormData(p => ({ ...p, [name]: value }));
  }, []);

  const handleSelectQuickCuotas = (cuotas) => {
    setFormData(p => ({ ...p, numCuotas: String(cuotas) }));
  };

  const handleSelectQuickInteres = (tasa) => {
    setFormData(p => ({ ...p, tasaInteres: String(tasa) }));
  };

  const handleGeneroChange = g => setFormData(p => ({ ...p, genero: g }));

  // Capturar o seleccionar foto del documento
  const handleTakeDocPhoto = async () => {
    try {
      const photo = await capturePhotoFromCamera('DOCUMENT');
      if (!photo.cancelled && photo.uri) {
        setFotoDocumento(photo);
      }
    } catch (e) {
      appAlert('Cámara', e.message);
    }
  };

  const handlePickDocGallery = async () => {
    try {
      const photo = await pickPhotoFromGallery('DOCUMENT');
      if (!photo.cancelled && photo.uri) {
        setFotoDocumento(photo);
      }
    } catch (e) {
      appAlert('Galería', e.message);
    }
  };

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
      numCuotas: '30',
      tasaInteres: '20',
    });
    setFotoDocumento(null);
    setPagoAdelantado(false);
  };

  const handleSubmit = async () => {
    if (!userId) {
      appAlert('Error', 'Sesión no válida. Por favor inicia sesión nuevamente.');
      return;
    }

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
      appAlert('Faltan datos', 'Por favor verifica la cantidad de cuotas y el interés del crédito.');
      return;
    }

    // Validacion de limite maximo de venta por usuario
    const maxVenta = parseFloat(profile?.dinero_max_venta) || 0;
    if (maxVenta > 0 && montoNum > maxVenta) {
      appAlert(
        'Límite de venta excedido',
        `El monto ($${montoNum.toLocaleString('es-CO')}) excede tu límite máximo permitido por venta ($${maxVenta.toLocaleString('es-CO')}).`
      );
      return;
    }

    // Validacion de limite maximo de cuotas por usuario
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
      const cajaAbierta = await getCajaActual();
      if (!cajaAbierta) {
        appAlert('Sin caja abierta', 'No tienes una caja abierta. Ve a la sección Caja y abre una antes de registrar ventas.');
        setSaving(false);
        return;
      }

      const database = await getDbConnection();
      const { nombre, apellido, alias, direccion, genero } = formData;
      const { numCuotas, totalFactura, valorCuota, tasaPorcentaje, proximoRecaudoStr } = quoteSummary;

      // 1. Subir fotografía del documento a Storage si se adjuntó
      let uploadedDocPath = null;
      if (fotoDocumento?.uri) {
        try {
          const upDoc = await uploadEvidence({
            uri: fotoDocumento.uri,
            base64: fotoDocumento.base64,
            tipoEvidencia: 'documento_identidad',
            tablaRelacionada: 'clients',
            registroId: cleanDoc,
            originalName: fotoDocumento.fileName || `documento_${cleanDoc}.jpg`,
            mimeType: fotoDocumento.type || 'image/jpeg',
            originalSize: fotoDocumento.fileSize || 0,
            compressedSize: fotoDocumento.fileSize || 0,
          });
          uploadedDocPath = upDoc?.filePath || fotoDocumento.uri;
        } catch (errUpDoc) {
          console.log('Error subiendo foto de documento a Storage:', errUpDoc);
          uploadedDocPath = fotoDocumento.uri;
        }
      }

      // 2. Mapear conceptos para compatibilidad con foreign keys
      let matchingInteresId = 9; // 10% por defecto
      if (conceptosInteres.length > 0) {
        const foundInt = conceptosInteres.find(c =>
          c.valor === `${Math.round(tasaPorcentaje)}%` ||
          c.valor.startsWith(String(Math.round(tasaPorcentaje)))
        );
        if (foundInt) matchingInteresId = foundInt.id;
      }

      let matchingPlazoId = 103; // 30 días por defecto
      if (conceptosPlazo.length > 0) {
        const foundPlazo = conceptosPlazo.find(c => c.valor.startsWith(String(numCuotas)));
        if (foundPlazo) matchingPlazoId = foundPlazo.id;
      }

      // 3. Captura segura de ubicacion
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
        plazo_id: matchingPlazoId,
        interes_id: matchingInteresId,
        latitud: latitudStr,
        longitud: longitudStr,
        previous_invoice_id: previousInvoiceId || null,
        fecha: nowIso,
        periodicidad,
        num_cuotas: numCuotas,
        tasa_interes: tasaPorcentaje,
        pago_adelantado: pagoAdelantado,
        foto_documento: uploadedDocPath,
      };

      // 4. Guardar en ventas_pendientes
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

      // 5. Generar cuotas locales según la periodicidad
      const cMonto = Math.floor(totalFactura / numCuotas);
      const cResto = totalFactura - (cMonto * (numCuotas - 1));

      for (let i = 1; i <= numCuotas; i++) {
        const valCuota = (i === numCuotas) ? cResto : cMonto;
        let dVenc = new Date();
        if (periodicidad === 'semanal') {
          dVenc.setDate(dVenc.getDate() + (i * 7));
        } else if (periodicidad === 'mensual') {
          dVenc = addMonths(new Date(), i);
        } else {
          dVenc.setDate(dVenc.getDate() + i);
        }
        const fechaVenc = dVenc.toISOString().slice(0, 10);
        const isPagadaAdelantada = (i === 1 && pagoAdelantado);

        await database.executeSql(
          `INSERT OR REPLACE INTO cuotas (id, invoice_id, numero, fecha_vencimiento, monto, estado, monto_pagado)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            `local_cuota_${tempId}_${i}`,
            String(tempId),
            i,
            fechaVenc,
            valCuota,
            isPagadaAdelantada ? 'pagada' : 'pendiente',
            isPagadaAdelantada ? valCuota : 0,
          ]
        );
      }

      // 6. Obtener consecutivo tramitado
      const consecutivo = await getAndIncrementConsecutivo(database);
      const saldoInicialFactura = pagoAdelantado ? Math.max(0, totalFactura - valorCuota) : totalFactura;

      // 7. Guardar en SQLite facturas
      await database.executeSql(
        `INSERT OR REPLACE INTO facturas (
          id, nombreUno, apellidoUno, alias, documento, celular, direccion,
          saldo, valorInicial, valorCuota, num_cuotas, cuotasPagas, cuotasVencidas,
          estado, estadoMovil, fecha, idVendedor, usuarioId, paymentTermId, detalles,
          consecutivoTramitado, latitud, longitud, previous_invoice_id,
          periodicidad, tasa_interes, pago_adelantado, foto_documento_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pendiente', 'actualizado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(tempId),
          nombre.trim(),
          (apellido || '').trim(),
          (alias || '').trim(),
          cleanDoc,
          cleanTel,
          (direccion || '').trim(),
          saldoInicialFactura,
          totalFactura,
          valorCuota,
          String(numCuotas),
          pagoAdelantado ? 1 : 0,
          todayDate,
          userId,
          userId,
          matchingPlazoId,
          JSON.stringify(salePayload),
          consecutivo,
          latitudStr,
          longitudStr,
          previousInvoiceId || null,
          periodicidad,
          tasaPorcentaje,
          pagoAdelantado ? 1 : 0,
          uploadedDocPath,
        ]
      );

      // 8. Registrar movimiento de venta (egreso de capital prestado)
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

      // Descontar capital prestado de la caja
      try {
        await database.executeSql(
          `UPDATE cajas SET saldo_final = COALESCE(saldo_final, 0) - ? WHERE id = ?`,
          [montoNum, cajaAbierta.id]
        );
      } catch (err) {
        console.log('Error actualizando saldo de caja:', err);
      }

      // 9. Si hay Pago Adelantado: asociar movimiento y pago al próximo día de recaudo
      if (pagoAdelantado && valorCuota > 0) {
        const advPagoId = tempId - 2;
        const advDateIso = `${proximoRecaudoStr}T08:00:00.000Z`;

        // Registrar pago imputado al próximo día de recaudo
        await database.executeSql(
          `INSERT OR REPLACE INTO pagos (
            id, tipo, valor, horaDispositivo, idFactura, valorFactura, estadoMovil, nombre, secuencia_pago, idCaja
          ) VALUES (?, 'pago', ?, ?, ?, ?, 'actualizado', ?, ?, ?)`,
          [
            advPagoId,
            valorCuota,
            advDateIso,
            String(tempId),
            valorCuota,
            clienteDesc,
            consecutivo,
            cajaAbierta.id,
          ]
        );

        // Movimiento informativo con fecha del próximo día de recaudo
        await database.executeSql(
          `INSERT INTO movimientos (id, descripcion, monto, horaDispositivo, tipo, estadoMovil, idCaja, fecha, idFactura, cliente_nombre)
           VALUES (?, ?, ?, ?, 'pago', 'actualizado', ?, ?, ?, ?)`,
          [
            advPagoId,
            `Pago adelantado cuota 1: ${clienteDesc}`,
            valorCuota,
            advDateIso,
            cajaAbierta.id,
            advDateIso,
            String(tempId),
            clienteDesc,
          ]
        );
      }

      // 10. Notificar a las demás vistas
      eventBus.emit(EVENTS.CLIENT_CREATED, {
        id: tempId,
        nombre: clienteDesc,
        monto: totalFactura,
      });

      // 11. Sincronizar en segundo plano si hay red
      try {
        SyncWithSupabase(false, () => {});
      } catch (err) {
        console.log('Error disparando sync:', err);
      }

      const mensajeConfirmacion = pagoAdelantado
        ? `El crédito para ${clienteDesc} quedó registrado con la 1ª cuota abonada para el próximo día de recaudo (${proximoRecaudoStr}). Saldo a cobrar: ${FormatMoneyDecimales(saldoInicialFactura)}.`
        : previousInvoiceId
        ? `La renovación de crédito para ${clienteDesc} quedó registrada exitosamente.`
        : `El crédito para ${clienteDesc} quedó registrado exitosamente.`;

      appAlert('¡Venta registrada exitosamente!', mensajeConfirmacion);

      setFormData({
        nombre: '',
        apellido: '',
        alias: '',
        direccion: '',
        telefono: '',
        genero: 'masculino',
        documento: '',
        valor: '',
        numCuotas: '30',
        tasaInteres: '20',
      });
      setFotoDocumento(null);
      setPagoAdelantado(false);
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
      (c.nombreUno?.toLowerCase() || '').includes(q) ||
      (c.apellidoUno?.toLowerCase() || '').includes(q) ||
      (c.documento?.toLowerCase() || '').includes(q)
    );
  }, [paidClientsList, searchRenewText]);

  // Cuota label según periodicidad
  const cuotasLabel = useMemo(() => {
    if (periodicidad === 'semanal') return 'Cantidad de cuotas (Semanas) *';
    if (periodicidad === 'mensual') return 'Cantidad de cuotas (Meses) *';
    return 'Cantidad de cuotas (Días) *';
  }, [periodicidad]);

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: fade }}>
            {/* Header / Boton Renovacion */}
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.renewBtn}
                onPress={() => setShowRenewModal(true)}
              >
                <Icon name="history" size={13} color={apple.colors.blue} />
                <Text style={styles.renewBtnText}>Renovar crédito saldado</Text>
              </TouchableOpacity>
            </View>

            {/* Banner si esta renovando */}
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

            {/* Seccion 2: Contacto, Documento y Fotografía */}
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

              {/* Fotografía del Documento de Identidad (Requisito 7) */}
              <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Fotografía del documento de identidad</Text>
              <View style={styles.photoContainer}>
                {fotoDocumento?.uri ? (
                  <View style={styles.photoPreviewRow}>
                    <TouchableOpacity
                      onPress={() => setPreviewDocModal(true)}
                      style={styles.photoThumbnailWrap}
                    >
                      <Image source={{ uri: fotoDocumento.uri }} style={styles.photoThumbnail} />
                      <View style={styles.zoomBadge}>
                        <Icon name="search-plus" size={12} color="#fff" />
                      </View>
                    </TouchableOpacity>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={styles.photoFileName} numberOfLines={1}>
                        {fotoDocumento.fileName || 'Foto documento adjunta'}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          style={styles.photoActionBtn}
                          onPress={handleTakeDocPhoto}
                        >
                          <Icon name="camera" size={12} color={apple.colors.blue} />
                          <Text style={styles.photoActionText}>Cambiar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.photoActionBtn, { borderColor: apple.colors.danger }]}
                          onPress={() => setFotoDocumento(null)}
                        >
                          <Icon name="trash" size={12} color={apple.colors.danger} />
                          <Text style={[styles.photoActionText, { color: apple.colors.danger }]}>Quitar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={styles.photoEmptyRow}>
                    <TouchableOpacity
                      style={styles.photoPickerBtn}
                      onPress={handleTakeDocPhoto}
                    >
                      <Icon name="camera" size={18} color={apple.colors.blue} />
                      <Text style={styles.photoPickerBtnText}>Tomar foto</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.photoPickerBtn, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
                      onPress={handlePickDocGallery}
                    >
                      <Icon name="image" size={18} color="#16A34A" />
                      <Text style={[styles.photoPickerBtnText, { color: '#16A34A' }]}>Galería</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
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

              {/* Selector de Periodicidad (Requisito 5.1: Diario por defecto) */}
              <Text style={styles.fieldLabel}>Periodicidad del cobro *</Text>
              <View style={styles.segment}>
                {[
                  { key: 'diario', label: 'Diario' },
                  { key: 'semanal', label: 'Semanal' },
                  { key: 'mensual', label: 'Mensual' },
                ].map(p => (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPeriodicidad(p.key)}
                    style={[styles.segmentOpt, periodicidad === p.key && styles.segmentOptActive]}
                  >
                    <Text style={[styles.segmentText, periodicidad === p.key && styles.segmentTextActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Accesos rápidos para Plazo (Requisito 4.1: 24, 30, 45) */}
              <View style={styles.quickLabelRow}>
                <Text style={styles.fieldLabel}>{cuotasLabel}</Text>
                <View style={styles.quickButtonsRow}>
                  {[24, 30, 45].map(q => {
                    const isSelected = String(formData.numCuotas) === String(q);
                    return (
                      <TouchableOpacity
                        key={q}
                        style={[styles.quickBtn, isSelected && styles.quickBtnActive]}
                        onPress={() => handleSelectQuickCuotas(q)}
                      >
                        <Text style={[styles.quickBtnText, isSelected && styles.quickBtnTextActive]}>
                          {q}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Campo numérico editable para cantidad de pagos (1 a 90) */}
              <View style={[styles.inputWrap, cuotasError ? styles.inputWrapError : null]}>
                <Icon name="calendar" size={14} color={apple.colors.tertiaryLabel} style={{ marginRight: 8 }} />
                <TextInput
                  value={formData.numCuotas}
                  onChangeText={t => handleChange('numCuotas', t)}
                  placeholder="1 a 90 cuotas"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                  style={styles.input}
                  keyboardType="numeric"
                  maxLength={2}
                />
              </View>
              {cuotasError ? <Text style={styles.errorText}>{cuotasError}</Text> : null}

              {/* Accesos rápidos para Interés (Requisito 4.1 y 6: 10%, 15%, 20%) */}
              <View style={[styles.quickLabelRow, { marginTop: 14 }]}>
                <Text style={styles.fieldLabel}>Tasa de interés (%) *</Text>
                <View style={styles.quickButtonsRow}>
                  {[10, 15, 20].map(intVal => {
                    const isSelected = String(formData.tasaInteres) === String(intVal);
                    return (
                      <TouchableOpacity
                        key={intVal}
                        style={[styles.quickBtn, isSelected && styles.quickBtnActive]}
                        onPress={() => handleSelectQuickInteres(intVal)}
                      >
                        <Text style={[styles.quickBtnText, isSelected && styles.quickBtnTextActive]}>
                          {intVal}%
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Campo numérico editable para tasa de interés */}
              <View style={[styles.inputWrap, interesError ? styles.inputWrapError : null]}>
                <Icon name="percent" size={14} color={apple.colors.tertiaryLabel} style={{ marginRight: 8 }} />
                <TextInput
                  value={formData.tasaInteres}
                  onChangeText={t => handleChange('tasaInteres', t)}
                  placeholder="Ej. 20"
                  placeholderTextColor={apple.colors.tertiaryLabel}
                  style={styles.input}
                  keyboardType="numeric"
                  maxLength={5}
                />
              </View>
              {interesError ? <Text style={styles.errorText}>{interesError}</Text> : null}

              {/* Switch de Pago Adelantado (Requisito 8: Off por defecto) */}
              <View style={styles.advanceRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="check-square-o" size={15} color={pagoAdelantado ? apple.colors.blue : apple.colors.secondaryLabel} />
                    <Text style={styles.advanceTitle}>Pago adelantado (Primera cuota)</Text>
                  </View>
                  <Text style={styles.advanceSub}>
                    Abona inmediatamente la 1ª cuota y la asocia al próximo día de recaudo.
                  </Text>
                </View>
                <Switch
                  value={pagoAdelantado}
                  onValueChange={setPagoAdelantado}
                  trackColor={{ false: apple.colors.separator, true: apple.colors.blue }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>

            {/* Resumen de la Cuota Estimada */}
            {quoteSummary ? (
              <View style={styles.quoteCard}>
                <View style={styles.quoteHeader}>
                  <View style={styles.quoteTitleRow}>
                    <Icon name="calculator" size={15} color={apple.colors.blue} />
                    <Text style={styles.quoteTitle}>Vista previa de la cuota</Text>
                  </View>
                  <View style={styles.estimateBadge}>
                    <Text style={styles.estimateBadgeText}>{periodicidad.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.quoteDivider} />

                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Capital solicitado:</Text>
                  <Text style={styles.quoteValue}>{FormatMoneyDecimales(quoteSummary.capital)}</Text>
                </View>
                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Interés estimado ({quoteSummary.tasaPorcentaje}%):</Text>
                  <Text style={styles.quoteValue}>+ {FormatMoneyDecimales(quoteSummary.montoInteres)}</Text>
                </View>
                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Total del crédito:</Text>
                  <Text style={[styles.quoteValue, { fontWeight: '700' }]}>{FormatMoneyDecimales(quoteSummary.totalFactura)}</Text>
                </View>
                <View style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>Plazo y periodicidad:</Text>
                  <Text style={styles.quoteValue}>{quoteSummary.numCuotas} cuotas ({periodicidad})</Text>
                </View>

                {pagoAdelantado && (
                  <View style={styles.quoteAdvanceBox}>
                    <Icon name="info-circle" size={13} color="#B45309" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.quoteAdvanceTitle}>Pago adelantado activo</Text>
                      <Text style={styles.quoteAdvanceSub}>
                        Se cobrará la 1ª cuota de {FormatMoneyDecimales(quoteSummary.valorCuota)} asignada al próximo día de recaudo ({quoteSummary.proximoRecaudoStr}). Saldo a deber: {FormatMoneyDecimales(quoteSummary.saldoInicial)}.
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.quoteResultBox}>
                  <Text style={styles.quoteResultLabel}>Cuota {periodicidad} a pagar:</Text>
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
                  ? 'Ingresa un teléfono válido de 10 a 12 dígitos'
                  : !cleanDoc || cleanDoc.length < 6
                  ? 'Ingresa un documento válido de 6 a 12 caracteres'
                  : !parseMoneyToNumeric(formData.valor)
                  ? 'Ingresa el capital a prestar'
                  : cuotasError
                  ? cuotasError
                  : interesError
                  ? interesError
                  : 'Completa todos los campos obligatorios (*) para continuar'}
              </Text>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal Preview Documento */}
      <EvidencePreviewModal
        visible={previewDocModal}
        onClose={() => setPreviewDocModal(false)}
        title="Documento de Identidad"
        imageUri={fotoDocumento?.uri}
        onTakePhoto={handleTakeDocPhoto}
        onPickGallery={handlePickDocGallery}
        onRemovePhoto={() => {
          setFotoDocumento(null);
          setPreviewDocModal(false);
        }}
      />

      {/* Modal Clientes para Renovacion */}
      <Modal visible={showRenewModal} animationType="slide" transparent onRequestClose={() => setShowRenewModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Seleccionar cliente para renovación</Text>
              <TouchableOpacity onPress={() => setShowRenewModal(false)} style={styles.modalCloseBtn}>
                <Icon name="times" size={16} color={apple.colors.secondaryLabel} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchWrapModal}>
              <Icon name="search" size={13} color={apple.colors.tertiaryLabel} />
              <TextInput
                style={styles.searchInputModal}
                placeholder="Buscar por nombre o documento..."
                placeholderTextColor={apple.colors.tertiaryLabel}
                value={searchRenewText}
                onChangeText={setSearchRenewText}
              />
            </View>

            <FlatList
              data={filteredPaidClients}
              keyExtractor={item => String(item.id)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.paidClientItem}
                  onPress={() => handleSelectRenewalClient(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paidClientName}>{item.nombreUno} {item.apellidoUno}</Text>
                    <Text style={styles.paidClientSub}>Doc: {item.documento} · Tel: {item.celular || 'Sin teléfono'}</Text>
                    {item.direccion ? <Text style={styles.paidClientDir}>{item.direccion}</Text> : null}
                  </View>
                  <View style={styles.paidClientAction}>
                    <Text style={styles.paidClientActionText}>Renovar</Text>
                    <Icon name="chevron-right" size={11} color={apple.colors.blue} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyRenewWrap}>
                  <Icon name="check-circle" size={32} color={apple.colors.tertiaryLabel} />
                  <Text style={styles.emptyRenewTitle}>Sin clientes saldados</Text>
                  <Text style={styles.emptyRenewSub}>No hay clientes con saldo en cero disponibles para renovación.</Text>
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
  scroll: { padding: 16, paddingBottom: 40 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 },
  renewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: apple.radius.m,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  renewBtnText: { fontSize: 13, fontWeight: '600', color: apple.colors.blue },
  renewalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    padding: 12,
    borderRadius: apple.radius.m,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#93C5FD',
    gap: 10,
  },
  renewalBannerIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  renewalBannerTitle: { fontSize: 13, fontWeight: '700', color: apple.colors.blue },
  renewalBannerSub: { fontSize: 12, color: apple.colors.secondaryLabel, marginTop: 1 },
  renewalClearBtn: { padding: 6 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: apple.colors.label, letterSpacing: 0.3 },
  pageSub: { fontSize: 13, color: apple.colors.secondaryLabel, marginTop: 4, marginBottom: 16 },
  section: {
    backgroundColor: apple.colors.card,
    borderRadius: apple.radius.l,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
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
    marginBottom: 12,
  },
  segmentOpt: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: apple.radius.s },
  segmentOptActive: { backgroundColor: apple.colors.card, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  segmentText: { fontSize: 13, fontWeight: '500', color: apple.colors.secondaryLabel },
  segmentTextActive: { color: apple.colors.label, fontWeight: '600' },
  hint: { fontSize: 12, color: apple.colors.secondaryLabel, textAlign: 'center', marginTop: 10 },

  // Quick access buttons (Requisito 4)
  quickLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  quickButtonsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  quickBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: apple.colors.blue,
  },
  quickBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: apple.colors.secondaryLabel,
  },
  quickBtnTextActive: {
    color: apple.colors.blue,
    fontWeight: '700',
  },

  // Document photo styles (Requisito 7)
  photoContainer: {
    marginTop: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: apple.colors.separator,
    borderRadius: apple.radius.m,
    padding: 12,
    backgroundColor: '#FAFAFA',
  },
  photoEmptyRow: {
    flexDirection: 'row',
    gap: 10,
  },
  photoPickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: apple.radius.s,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  photoPickerBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: apple.colors.blue,
  },
  photoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoThumbnailWrap: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: apple.colors.separator,
  },
  photoThumbnail: {
    width: '100%',
    height: '100%',
  },
  zoomBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    padding: 2,
  },
  photoFileName: {
    fontSize: 13,
    fontWeight: '600',
    color: apple.colors.label,
  },
  photoActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: apple.colors.blue,
  },
  photoActionText: {
    fontSize: 11,
    fontWeight: '600',
    color: apple.colors.blue,
  },

  // Advance Payment Switch (Requisito 8)
  advanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  advanceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: apple.colors.label,
  },
  advanceSub: {
    fontSize: 12,
    color: apple.colors.secondaryLabel,
    marginTop: 2,
    lineHeight: 16,
  },

  // Quote preview card
  quoteCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: apple.radius.l,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
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
  quoteAdvanceBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 10,
    borderRadius: apple.radius.s,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  quoteAdvanceTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
  quoteAdvanceSub: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
    lineHeight: 15,
  },
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
