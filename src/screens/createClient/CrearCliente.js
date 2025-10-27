import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { supabase } from '../../lib/supabase';
import { getData } from '../../database/db';
import { getDbConnection } from '../../database/db';
import CustomPicker from './CustomPicker';

const CrearCliente = (props) => {
    const navigation = useNavigation();
    let db;
    const [formData, setFormData] = useState({
        nombre: '',
        apellido: '',
        alias: '',
        direccion: '',
        telefono: '',
        genero: '',
        documento: '',
        valor: '',
        plazo: '',
        interes: '',
    });
    const [formDataLabels, setFormDataLabels] = useState({
        plazo: '',
        interes: '',
    });
    const [isFormValid, setIsFormValid] = useState(false);
    const [conceptos, setConceptos] = useState([]);
    const [conceptosInteres, setConceptosInteres] = useState([]);
    const [conceptosPlazo, setConceptosPlazo] = useState([]);
    const [showPlazoModal, setShowPlazoModal] = useState(false);
    const [showInteresModal, setShowInteresModal] = useState(false);

    useEffect(() => {
        const isValid = Object.values(formData).every(value => {
            return value.trim() !== '';
        });
        setIsFormValid(isValid);
        LoadData();
    }, [formData]);

    const LoadData = async () => {
        try {
            db = await getDbConnection();

            const conceptosData = await getData(
                db,
                "select * from concepts",
            );

            console.log('conceptos', conceptosData);
            
            // Filtrar conceptos por tipo
            const interes = conceptosData.filter(concepto => concepto.tipo === 'interes');
            const plazo = conceptosData.filter(concepto => concepto.tipo === 'plazo');
            
            setConceptos(conceptosData);
            setConceptosInteres(interes);
            setConceptosPlazo(plazo);

        } catch (error) {
            console.error('Error al cargar datos de parametrización:', error);
        }
    };

    const handleChange = (name, value) => {
        setFormData({
            ...formData,
            [name]: value,
        });
    };

    const handlePickerSelect = (name, value, label) => {
        setFormData({
            ...formData,
            [name]: value,
        });
        setFormDataLabels({
            ...formDataLabels,
            [name]: label,
        });
    };

    const handleGeneroChange = (genero) => {
        setFormData({
            ...formData,
            genero: genero,
        });
    };

    const handleSubmit = async () => {
        const parametrizacion = await getData(
            db,
            "select valor from parametrizacion",
        );

        console.log('parametrizacion', parametrizacion);

        if (isFormValid) {
            const {
                nombre,
                apellido,
                alias,
                telefono,
                direccion,
                documento,
                valor,
                plazo,
                interes
            } = formData;

            try {
                const response = await fetch('https://gwpwntdwogxzmtegaaom.supabase.co/functions/v1/create_sale', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${parametrizacion[1].valor}`
                    },
                    body: JSON.stringify({
                        nombre,
                        apellido,
                        alias,
                        email: '',
                        telefono,
                        direccion,
                        documento,
                        monto: parseFloat(valor),
                        vendedor_id: parametrizacion[4].valor, 
                        caja_id: 'fb752968-9a6a-46cb-bcd6-83c3d4f82e1c',
                        plazo_id: parseInt(plazo),
                        interes_id: parseInt(interes)
                    })
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.error || 'Error desconocido');
                }

                console.log('Venta creada, ID factura:', result.id_factura);
                Alert.alert('Éxito', `Factura creada con ID: ${result.id_factura}`);
            } catch (err) {
                console.error('Error al crear la venta:', err);
                Alert.alert('Error', err.message || 'Hubo un problema al crear la venta');
            }
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Icon name="arrow-left" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Nueva Venta</Text>
                <TouchableOpacity onPress={handleSubmit} disabled={!isFormValid}>
                    <Icon name="save" size={24} color={isFormValid ? "#fff" : "#ffffff80"} />
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardView}
            >
                <ScrollView style={styles.scrollView}>
                    <View style={styles.formContainer}>
                        {/* Información Personal */}
                        <View style={styles.card}>
                            <Text style={styles.sectionTitle}>Información Personal</Text>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Nombre</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.nombre}
                                    onChangeText={(text) => handleChange('nombre', text)}
                                    placeholder="Ingrese el nombre"
                                    placeholderTextColor="#999"
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Apellido</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.apellido}
                                    onChangeText={(text) => handleChange('apellido', text)}
                                    placeholder="Ingrese el apellido"
                                    placeholderTextColor="#999"
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Alias</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.alias}
                                    onChangeText={(text) => handleChange('alias', text)}
                                    placeholder="Ingrese el alias"
                                    placeholderTextColor="#999"
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Género</Text>
                                <View style={styles.generoContainer}>
                                    <TouchableOpacity
                                        style={[
                                            styles.generoOption,
                                            formData.genero === 'masculino' && styles.generoOptionSelected
                                        ]}
                                        onPress={() => handleGeneroChange('masculino')}
                                    >
                                        <Icon
                                            name={formData.genero === 'masculino' ? 'check-square' : 'square'}
                                            size={20}
                                            color={formData.genero === 'masculino' ? '#2196F3' : '#666'}
                                        />
                                        <Text style={[
                                            styles.generoText,
                                            formData.genero === 'masculino' && styles.generoTextSelected
                                        ]}>
                                            Masculino
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.generoOption,
                                            formData.genero === 'femenino' && styles.generoOptionSelected
                                        ]}
                                        onPress={() => handleGeneroChange('femenino')}
                                    >
                                        <Icon
                                            name={formData.genero === 'femenino' ? 'check-square' : 'square'}
                                            size={20}
                                            color={formData.genero === 'femenino' ? '#2196F3' : '#666'}
                                        />
                                        <Text style={[
                                            styles.generoText,
                                            formData.genero === 'femenino' && styles.generoTextSelected
                                        ]}>
                                            Femenino
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                        {/* Información de Contacto */}
                        <View style={styles.card}>
                            <Text style={styles.sectionTitle}>Información de Contacto</Text>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Dirección</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.direccion}
                                    onChangeText={(text) => handleChange('direccion', text)}
                                    placeholder="Ingrese la dirección"
                                    placeholderTextColor="#999"
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Teléfono</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.telefono}
                                    onChangeText={(text) => handleChange('telefono', text)}
                                    placeholder="Ingrese el teléfono"
                                    keyboardType="phone-pad"
                                    placeholderTextColor="#999"
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Documento</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.documento}
                                    onChangeText={(text) => handleChange('documento', text)}
                                    placeholder="Ingrese el documento"
                                    keyboardType="numeric"
                                    placeholderTextColor="#999"
                                />
                            </View>
                        </View>

                        {/* Información de la Venta */}
                        <View style={styles.card}>
                            <Text style={styles.sectionTitle}>Información de la Venta</Text>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Valor</Text>
                                <TextInput
                                    style={styles.input}
                                    value={formData.valor}
                                    onChangeText={(text) => handleChange('valor', text)}
                                    placeholder="Ingrese el valor"
                                    keyboardType="numeric"
                                    placeholderTextColor="#999"
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Plazo</Text>
                                <TouchableOpacity
                                    style={styles.pickerButton}
                                    onPress={() => setShowPlazoModal(true)}
                                >
                                    <Text style={[
                                        styles.pickerButtonText,
                                        !formDataLabels.plazo && styles.pickerButtonPlaceholder
                                    ]}>
                                        {formDataLabels.plazo || 'Seleccione un plazo'}
                                    </Text>
                                    <Icon name="chevron-down" size={16} color="#666" />
                                </TouchableOpacity>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Interés</Text>
                                <TouchableOpacity
                                    style={styles.pickerButton}
                                    onPress={() => setShowInteresModal(true)}
                                >
                                    <Text style={[
                                        styles.pickerButtonText,
                                        !formDataLabels.interes && styles.pickerButtonPlaceholder
                                    ]}>
                                        {formDataLabels.interes || 'Seleccione un interés'}
                                    </Text>
                                    <Icon name="chevron-down" size={16} color="#666" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={[styles.saveButton, !isFormValid && styles.saveButtonDisabled]}
                            onPress={handleSubmit}
                            disabled={!isFormValid}
                        >
                            <Text style={styles.saveButtonText}>Guardar Venta</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Modales de Picker */}
            <CustomPicker
                data={conceptosPlazo}
                selectedValue={formData.plazo}
                onSelect={(value, label) => handlePickerSelect('plazo', value, label)}
                placeholder="Seleccionar Plazo"
                visible={showPlazoModal}
                onClose={() => setShowPlazoModal(false)}
            />

            <CustomPicker
                data={conceptosInteres}
                selectedValue={formData.interes}
                onSelect={(value, label) => handlePickerSelect('interes', value, label)}
                placeholder="Seleccionar Interés"
                visible={showInteresModal}
                onClose={() => setShowInteresModal(false)}
            />
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#2196F3',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#fff',
    },
    keyboardView: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    formContainer: {
        padding: 16,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginBottom: 16,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        marginBottom: 8,
        color: '#666',
    },
    input: {
        backgroundColor: '#f9f9f9',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
        fontSize: 16,
        color: '#333',
    },
    pickerButton: {
        backgroundColor: '#f9f9f9',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pickerButtonText: {
        fontSize: 16,
        color: '#333',
    },
    pickerButtonPlaceholder: {
        color: '#999',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
    },
    modalItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    modalItemSelected: {
        backgroundColor: '#e3f2fd',
    },
    modalItemText: {
        fontSize: 16,
        color: '#333',
    },
    modalItemTextSelected: {
        color: '#2196F3',
        fontWeight: '500',
    },
    generoContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#f9f9f9',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    generoOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
        borderRadius: 4,
    },
    generoOptionSelected: {
        backgroundColor: '#e3f2fd',
    },
    generoText: {
        marginLeft: 8,
        fontSize: 16,
        color: '#666',
    },
    generoTextSelected: {
        color: '#2196F3',
        fontWeight: '500',
    },
    saveButton: {
        backgroundColor: '#2196F3',
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 16,
    },
    saveButtonDisabled: {
        backgroundColor: '#cccccc',
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default CrearCliente;
