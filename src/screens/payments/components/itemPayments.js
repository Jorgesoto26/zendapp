import React, { useState, useCallback, memo, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
} from 'react-native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/FontAwesome';
import Toast from 'react-native-toast-message';
import Geolocation from 'react-native-geolocation-service';
import { getDbConnection, updateData, insertTables, getData } from '../../../database/db';
import { IdInsertion, getDateOdooMilisec, getDate, Capitalize, FormatMoneyDecimales } from '../../../utils/utilities';

// === Color según estado ===
const getStatusColor = (tipo) => {
    const normalized = (tipo || '').toLowerCase().trim();
    const colors = {
        pago: '#4CAF50',
        'no pago': '#F44336',
        parcial: '#FFC107',
        pendiente: '#fff',
    };
    return colors[normalized] || '#fff';
};

// === Obtener ubicación ===
const getCurrentLocation = () =>
    new Promise((resolve, reject) => {
        Geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 10000,
        });
    });

// === Generar datos de pago ===
const buildPaymentData = async ({ tipo, valor, idFactura, nombre, secuencia }) => {
    const pos = await getCurrentLocation();
    const idInsert = await IdInsertion();
    const currentDate = getDateOdooMilisec();

    return {
        pago: {
            id: idInsert,
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            tipo,
            valor,
            horaDispositivo: currentDate,
            idFactura,
            valorFactura: valor,
            descripcion: '',
            estadoMovil: 'actualizado',
            nombre: Capitalize(nombre),
            secuencia_pago: secuencia,
            idCaja: 1,
        },
        detalle: {
            id: idInsert,
            facturaId: idFactura,
            valor,
            fecha: getDate(),
            descripcion: '',
            tipo,
            hora_dispositivo: currentDate,
            nombre: Capitalize(nombre),
            [`${tipo === 'nopago' ? 'nopago' : 'pago'}_factura_venta_id`]: idFactura,
            editable: 'true',
        },
    };
};

// === OBTENER Y INCREMENTAR CONSECUTIVO ===
const getAndIncrementConsecutivo = async (db) => {
    const result = await getData(db, `SELECT valor FROM consecutivoTramitado WHERE id = 1`);
    if (!result.length) throw new Error('No existe consecutivoTramitado');
    const current = parseInt(result[0].valor || 0);
    const next = current + 1;
    await updateData(db, 'consecutivoTramitado', { id: 1, valor: next });
    return next;
};

// === ACTUALIZAR FACTURA CON CONSECUTIVO ===
const updateFacturaWithConsecutivo = async (db, idFactura, updates, nuevoConsecutivo) => {
    await updateData(db, 'facturas', { ...updates, id: idFactura, consecutivoTramitado: nuevoConsecutivo });
};

// === OBTENER ÚLTIMO TRÁMITE Y VALOR PAGADO ===
const getUltimoTramite = async (db, idFactura) => {
    const result = await getData(db, `  
  SELECT tipo, valor 
  FROM pagos 
  WHERE idFactura = '${idFactura}'
  ORDER BY id DESC 
  LIMIT 1
`);

    console.log("Resultado:", result);

    if (!result.length) return { tipo: null, valorPagado: 0 };

    const { tipo, valor } = result[0];
    const valorPagado = Number(valor) || 0;

    // === LÓGICA SEGÚN TU TABLA ===
    if (tipo === 'nopago') return { tipo: 'NO PAGO', valorPagado };
    if (tipo === 'parcial') return { tipo: 'PARCIAL', valorPagado };
    if (tipo === 'pago') {
        // Si es pago pero valor es 0 → NO PAGO
        if (valorPagado === 0) return { tipo: 'NO PAGO', valorPagado };
        return { tipo: 'PAGO', valorPagado };
    }

    return { tipo: 'DESCONOCIDO', valorPagado };
};

// === COMPONENTE PRINCIPAL ===
const ItemPayments = memo(
    ({
        id,
        name,
        address,
        amount,
        status,
        time,
        paymentType,
        estadoPago,
        saldo,
        cu = 0,
        cuotasPagas,
        saldoVencido,
        nombreUno,
        apellidoUno,
        valorCuota,
        onPaymentSuccess,
        estadoMovil,
    }) => {
        const [modalParcial, setModalParcial] = useState(false);
        const [modalNoPago, setModalNoPago] = useState(false);
        const [valorParcial, setValorParcial] = useState('');
        const [loading, setLoading] = useState(false);
        const [tipoTramitado, setTipoTramitado] = useState(null);
        const [valorPagado, setValorPagado] = useState(0);

        // === CARGAR ÚLTIMO TRÁMITE SI ESTÁ ACTUALIZADO ===
        useEffect(() => {
            if (estadoMovil === 'actualizado') {
                (async () => {
                    try {
                        const db = await getDbConnection();
                        const { tipo, valorPagado } = await getUltimoTramite(db, id);
                        setTipoTramitado(tipo);
                        setValorPagado(valorPagado);
                    } catch (error) {
                        console.error('Error consultando trámite:', error);
                    }
                })();
            } else {
                setTipoTramitado(null);
                setValorPagado(0);
            }
        }, [estadoMovil, id]);

        // === FUNCIÓN COMÚN PARA MOVIMIENTOS ===
        const executePaymentAction = useCallback(async (tipo, valorPago) => {
            setLoading(true);
            const db = await getDbConnection();

            try {
                const nuevoConsecutivo = await getAndIncrementConsecutivo(db);
                const { pago, detalle } = await buildPaymentData({
                    tipo,
                    valor: valorPago,
                    idFactura: id,
                    nombre: nombreUno,
                    secuencia: nuevoConsecutivo,
                });

                const nuevoSaldo = tipo === 'nopago' ? saldo : Math.max(saldo - valorPago, 0);
                const nuevoSaldoVencido = tipo === 'nopago' ? (saldoVencido || 0) : Math.max((saldoVencido || 0) - valorPago, 0);
                const nuevasCuotasPagas = tipo === 'nopago' ? cuotasPagas : cuotasPagas + 1;

                await updateFacturaWithConsecutivo(db, id, {
                    estadoMovil: 'actualizado',
                    saldo: nuevoSaldo,
                    cuotasPagas: nuevasCuotasPagas,
                    saldoVencido: nuevoSaldoVencido,
                }, nuevoConsecutivo);

                await Promise.all([
                    insertTables(db, 'pagos', [pago]),
                    insertTables(db, 'detallesCaja', [detalle]),
                ]);

                const mensaje = tipo === 'pago' ? 'Pago realizado.' :
                    tipo === 'nopago' ? 'No pago registrado.' :
                        'Pago parcial realizado.';
                Toast.show({ text1: mensaje });
                onPaymentSuccess?.();

                if (tipo === 'parcial') {
                    setModalParcial(false);
                    setValorParcial('');
                } else if (tipo === 'nopago') {
                    setModalNoPago(false);
                }
            } catch (error) {
                console.error(`Error en ${tipo}:`, error);
                Toast.show({ text1: `Error al procesar ${tipo === 'nopago' ? 'no pago' : tipo}.` });
            } finally {
                setLoading(false);
            }
        }, [id, saldo, valorCuota, cuotasPagas, saldoVencido, nombreUno, onPaymentSuccess]);

        const handleFullPayment = useCallback(() => {
            const valor = Math.min(valorCuota, saldo);
            executePaymentAction('pago', valor);
        }, [executePaymentAction, valorCuota, saldo]);

        const handleNoPayment = useCallback(() => {
            executePaymentAction('nopago', 0);
        }, [executePaymentAction]);

        const handlePartialPayment = useCallback(() => {
            const valor = parseFloat(valorParcial);
            if (isNaN(valor) || valor <= 0 || valor > saldo) {
                Toast.show({ text1: 'Valor inválido o mayor al saldo.' });
                return;
            }
            executePaymentAction('parcial', valor); // ← Usa 'parcial'
        }, [valorParcial, saldo, executePaymentAction]);

        const saldoPendiente = saldo > 0 ? saldo : 0;

        // === TEXTO DEL CHIP AZUL ===
        const textoChip = estadoMovil === 'actualizado' && tipoTramitado
            ? tipoTramitado
            : paymentType;

        // === VALOR A MOSTRAR ===
        const valorAMostrar = estadoMovil === 'actualizado'
            ? valorPagado
            : amount;

        return (
            <View style={styles.clientItem}>
                <View style={[styles.clientBar, {
                    backgroundColor: estadoMovil === 'actualizado'
                        ? getStatusColor(tipoTramitado)
                        : getStatusColor(estadoPago)
                }]} />
                <View style={styles.clientContent}>
                    <View style={styles.clientHeader}>
                        {status === 'ACTUALIZADO' && <View style={styles.paymentType}>
                            <Text style={styles.typeText}>{textoChip}</Text>
                        </View>}
                        <Text style={styles.statusText}>{status}</Text>
                    </View>
                    <Text style={styles.clientName}>{name}</Text>
                    <Text style={styles.addressText}>{address}</Text>
                    <View style={styles.clientFooter}>
                        <Text style={styles.amountText}>
                            {FormatMoneyDecimales(valorAMostrar)}
                        </Text>
                        {/* <Text style={styles.timeText}>{time}</Text> */}
                    </View>

                    {status === 'PENDIENTE' && (
                        <View style={styles.buttonRow}>
                            <TouchableOpacity style={styles.iconButton} onPress={handleFullPayment} disabled={loading}>
                                {loading ? <ActivityIndicator size="small" color="#4CAF50" /> : <Icon name="check-circle" size={24} color="#4CAF50" />}
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.iconButton} onPress={() => setModalNoPago(true)} disabled={loading}>
                                <Icon name="times-circle" size={24} color="#F44336" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.iconButton} onPress={() => setModalParcial(true)} disabled={loading}>
                                <Icon name="adjust" size={24} color="#FFC107" />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* === MODAL PAGO PARCIAL === */}
                <Modal isVisible={modalParcial} onBackdropPress={() => setModalParcial(false)} animationIn="slideInUp" animationOut="slideOutDown">
                    <View style={styles.modalContainer}>
                        <TouchableOpacity style={styles.closeButton} onPress={() => setModalParcial(false)}>
                            <Icon name="close" size={22} color="#3333" />
                        </TouchableOpacity>

                        <Text style={styles.modalTitle}>Pago Parcial</Text>
                        <Text style={styles.modalLabel}>Cliente:</Text>
                        <Text style={styles.modalText}>{name}</Text>

                        <Text style={styles.modalLabel}>Crédito total:</Text>
                        <Text style={styles.modalText}>{FormatMoneyDecimales(amount)}</Text>

                        <Text style={styles.modalLabel}>Saldo pendiente:</Text>
                        <Text style={styles.modalText}>{FormatMoneyDecimales(saldoPendiente)}</Text>

                        <Text style={styles.modalLabel}>Valor a pagar:</Text>
                        <TextInput
                            placeholder="0.00"
                            keyboardType="numeric"
                            style={styles.input}
                            value={valorParcial}
                            onChangeText={setValorParcial}
                        />

                        <TouchableOpacity style={styles.payButton} onPress={handlePartialPayment} disabled={loading}>
                            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.payButtonText}>Pagar</Text>}
                        </TouchableOpacity>
                    </View>
                </Modal>

                {/* === MODAL NO PAGO === */}
                <Modal isVisible={modalNoPago} onBackdropPress={() => setModalNoPago(false)} animationIn="slideInUp" animationOut="slideOutDown">
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>¿Confirmar no pago?</Text>
                        <View style={styles.confirmRow}>
                            <TouchableOpacity style={[styles.confirmButton, { backgroundColor: '#F44336' }]} onPress={handleNoPayment} disabled={loading}>
                                {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmButtonText}>Sí</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.confirmButton, { backgroundColor: '#4CAF50' }]} onPress={() => setModalNoPago(false)} disabled={loading}>
                                <Text style={styles.confirmButtonText}>No</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
            </View>
        );
    },
    (prev, next) => {
        return (
            prev.id === next.id &&
            prev.status === next.status &&
            prev.estadoPago === next.estadoPago &&
            prev.saldo === next.saldo &&
            prev.estadoMovil === next.estadoMovil &&
            prev.onPaymentSuccess === next.onPaymentSuccess
        );
    }
);

export default ItemPayments;

// === ESTILOS ===
const styles = StyleSheet.create({
    clientItem: { flexDirection: 'row', backgroundColor: '#fff', marginBottom: 8, marginHorizontal: 16, borderRadius: 8, overflow: 'hidden' },
    clientBar: { width: 4 },
    clientContent: { flex: 1, padding: 12 },
    clientHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    paymentType: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
    typeText: { fontSize: 12, color: '#2196F3', fontWeight: '600' },
    statusText: { fontSize: 12, color: '#666' },
    clientName: { fontSize: 16, fontWeight: '500', color: '#333', marginBottom: 4 },
    addressText: { fontSize: 14, color: '#666', marginBottom: 8 },
    clientFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    amountText: { fontSize: 16, fontWeight: '600', color: '#4CAF50' },
    timeText: { fontSize: 12, color: '#666' },
    buttonRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
    iconButton: { backgroundColor: '#eee', padding: 10, borderRadius: 20 },
    modalContainer: { backgroundColor: '#fff', padding: 20, borderRadius: 12, elevation: 5, position: 'relative' },
    modalContent: { backgroundColor: '#fff', padding: 20, borderRadius: 12, elevation: 5 },
    closeButton: { position: 'absolute', right: 12, top: 12 },
    modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
    modalLabel: { fontSize: 14, color: '#444', marginBottom: 8 },
    modalText: { fontSize: 14, color: '#444', marginBottom: 12 },
    input: { height: 40, borderColor: '#ddd', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, marginBottom: 16 },
    payButton: { backgroundColor: '#2196F3', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 12 },
    payButtonText: { color: '#fff', fontWeight: '600' },
    confirmRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 },
    confirmButton: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
    confirmButtonText: { color: '#fff', fontWeight: '600' },
});