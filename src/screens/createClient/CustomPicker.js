import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Modal,
    FlatList,
    StyleSheet,
    TextInput
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../theme/appleTheme';

const CustomPicker = ({ data, selectedValue, onSelect, placeholder, visible, onClose }) => {
    const [searchText, setSearchText] = useState("")
  
    // Filtrar datos basado en la búsqueda
    const filteredData = data.filter((item) => item.valor.toLowerCase().includes(searchText.toLowerCase()))
  
    // Limpiar búsqueda cuando se cierre el modal
    const handleClose = () => {
      setSearchText("")
      onClose()
    }
  
    return (
      <Modal visible={visible} transparent={true} animationType="slide" onRequestClose={handleClose}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{placeholder}</Text>
              <TouchableOpacity onPress={handleClose}>
                <Icon name="times" size={24} color="#666" />
              </TouchableOpacity>
            </View>
  
            {/* Agregar buscador */}
            <View style={styles.searchContainer}>
              <Icon name="search" size={16} color="#666" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar..."
                placeholderTextColor="#999"
                value={searchText}
                onChangeText={setSearchText}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText("")} style={styles.clearButton}>
                  <Icon name="times-circle" size={16} color="#666" />
                </TouchableOpacity>
              )}
            </View>
  
            <FlatList
              data={filteredData}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, selectedValue === item.id.toString() && styles.modalItemSelected]}
                  onPress={() => {
                    onSelect(item.id.toString(), item.valor)
                    handleClose()
                  }}
                >
                  <Text
                    style={[styles.modalItemText, selectedValue === item.id.toString() && styles.modalItemTextSelected]}
                  >
                    {item.valor}
                  </Text>
                  {selectedValue === item.id.toString() && <Icon name="check" size={16} color="#EE272D" />}
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => (
                <View style={styles.emptyContainer}>
                  <Icon name="search" size={40} color="#D0D5DD" />
                  <Text style={styles.emptyText}>No se encontraron resultados</Text>
                  <Text style={styles.emptySubText}>Intenta con otro término de búsqueda</Text>
                </View>
              )}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>
    )
  }

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: "72%",
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: "#EAECF0",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderColor: "#EAECF0" },
  modalTitle: { fontSize: 17, fontWeight: "800", color: "#1E1E1F" },
  modalItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, marginHorizontal: 8, marginVertical: 2, borderRadius: 10 },
  modalItemSelected: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  modalItemText: { fontSize: 15, color: "#1E1E1F", fontWeight: "500" },
  modalItemTextSelected: { color: "#EE272D", fontWeight: "700" },
  searchContainer: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8F9FA", margin: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "#EAECF0" },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 42, fontSize: 14, color: "#1E1E1F" },
  clearButton: { padding: 4, marginLeft: 8 },
  emptyContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 40, paddingHorizontal: 20 },
  emptyText: { fontSize: 15, color: "#667085", marginTop: 12, fontWeight: "700" },
  emptySubText: { fontSize: 13, color: "#98A2B3", marginTop: 4, textAlign: "center" },
});

export default CustomPicker;