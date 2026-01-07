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
import CustomPicker from '../createClient/CustomPicker';
//import CustomPicker from './CustomPicker';


const Movements = (props) => {
    const navigation = useNavigation();
    const [showMovement, setShowMovement] = useState(false);
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
    const movementsList = [
        {id: 'Ingreso', valor:'Ingreso'},
        {id: "Gasto", valor:'Gasto'},
        {id: "Retiro", valor:'Retiro'},
    ]
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Icon name="arrow-left" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Movimientos</Text>
                <TouchableOpacity>
                    <Icon name="save" size={24} color={"#fff"} />
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardView}
            >
                <ScrollView style={styles.scrollView}>
                    <View style={styles.formContainer}>
                        <View style={styles.card}>
                            <Text style={styles.sectionTitle}>Tipo de Movimiento</Text>
                        </View>
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Movimiento:</Text>
                        <TouchableOpacity
                            style={styles.pickerButton}
                            onPress={() => setShowMovement(true)}
                        >
                            <Text style={[
                                styles.pickerButtonText,
                                !formDataLabels.plazo && styles.pickerButtonPlaceholder
                            ]}>
                                {formDataLabels.plazo || 'Seleccione tipo de movimiento'}
                            </Text>
                            <Icon name="chevron-down" size={16} color="#666" />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Descripcion:</Text>
                        <TextInput
                        style={styles.input}
                        placeholder='Ingrese la descripcion del movimiento...'
                        placeholderTextColor="#999"
                        />
                    </View>
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Valor:</Text>
                        <TextInput
                        style={styles.input}
                        placeholder='Ingrese el valor del movimiento...'
                        placeholderTextColor="#999"
                        />
                    </View>
                    <TouchableOpacity style={{marginTop:"15%", justifyContent:"space-between", flexDirection:"row", width:"50%", alignSelf:"center"}}>
                        <Icon name="camera" size={60} color='#007bff' />
                        <Icon name="save" size={60} color='#007bff' />
                    </TouchableOpacity>
                </ScrollView>

            </KeyboardAvoidingView>

            <CustomPicker
                data={movementsList}
                /* selectedValue={formData.plazo} */
                onSelect={(value, label) => handlePickerSelect('movimiento', value, label)}
                placeholder="Seleccionar movimiento"
                visible={showMovement}
                onClose={() => setShowMovement(false)}
            />
        </SafeAreaView>
    )
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
        marginTop: "5%"
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
})
export default Movements;