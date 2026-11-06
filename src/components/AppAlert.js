import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Modal from 'react-native-modal';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../theme/appleTheme';

const AlertContext = createContext(null);

export function AppAlertProvider({ children }) {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState({ title: '', message: '', buttons: [], icon: null, type: 'info' });

  const hide = useCallback(() => setVisible(false), []);

  const showAlert = useCallback(({ title = '', message = '', buttons = [{ text: 'OK', style: 'default' }], icon, type = 'info' }) => {
    const normalized = buttons.map(b => ({
      text: b.text,
      style: b.style || 'default',
      onPress: b.onPress,
    }));
    setConfig({ title, message, buttons: normalized, icon, type });
    setVisible(true);
  }, []);

  const onPressButton = (btn) => {
    setVisible(false);
    setTimeout(() => btn.onPress && btn.onPress(), 100);
  };

    const iconMap = {
    info: { name: 'info', color: '#1E1E1F', bg: '#F1F3F7', border: '#EAECF0' },
    warning: { name: 'exclamation-triangle', color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
    error: { name: 'times', color: '#EE272D', bg: '#FEF2F2', border: '#FECACA' },
    success: { name: 'check', color: '#10B981', bg: '#ECFDF5', border: '#A7F3D0' },
  };
  const iconCfg = config.icon || iconMap[config.type] || iconMap.info;

  return (
    <AlertContext.Provider value={{ showAlert, hideAlert: hide }}>
      {children}
      <Modal isVisible={visible} onBackdropPress={hide} backdropOpacity={0.45} animationIn="zoomIn" animationOut="zoomOut" useNativeDriver backdropTransitionOutTiming={0} style={styles.modal}>
        <View style={styles.sheet}>
          <View style={[styles.iconWrap, { backgroundColor: iconCfg.bg, borderColor: iconCfg.border }]}>
            <Icon name={iconCfg.name} size={20} color={iconCfg.color} />
          </View>
          {!!config.title && <Text style={styles.title}>{config.title}</Text>}
          {!!config.message && <Text style={styles.message}>{config.message}</Text>}
          <View style={styles.actions}>
            {config.buttons.map((btn, idx) => {
              const isDestructive = btn.style === 'destructive';
              const isCancel = btn.style === 'cancel';
              const btnStyle = isDestructive ? styles.btnDestructive : isCancel ? styles.btnCancel : styles.btnDefault;
              const textStyle = isDestructive ? styles.btnDestructiveText : isCancel ? styles.btnCancelText : styles.btnDefaultText;
              return (
                <TouchableOpacity key={idx} style={[styles.btn, btnStyle, config.buttons.length === 1 && { flex: 1 }]} onPress={() => onPressButton(btn)} activeOpacity={0.8}>
                  <Text style={textStyle}>{btn.text}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

export function useAppAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAppAlert must be inside AppAlertProvider');
  return ctx;
}

// Helper para reemplazar Alert.alert sin migrar todo de golpe
let globalShow = null;
export function setGlobalAlertFn(fn) { globalShow = fn; }
export function appAlert(title, message, buttons) {
  if (globalShow) globalShow({ title, message, buttons: buttons?.map(b => ({ text: b.text, style: b.style, onPress: b.onPress })) });
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center' },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, width: '86%', maxWidth: 360, alignSelf: 'center', borderWidth: 1, borderColor: '#EAECF0' },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12, borderWidth: 1 },
  title: { fontSize: 16, fontWeight: '800', color: '#1E1E1F', textAlign: 'center', letterSpacing: -0.2 },
  message: { fontSize: 13, color: '#667085', textAlign: 'center', marginTop: 6, lineHeight: 18, paddingHorizontal: 4, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnDefault: { backgroundColor: '#EE272D', borderColor: '#EE272D' },
  btnDefaultText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  btnCancel: { backgroundColor: '#FFFFFF', borderColor: '#EAECF0' },
  btnCancelText: { color: '#1E1E1F', fontWeight: '700', fontSize: 13 },
  btnDestructive: { backgroundColor: '#EE272D', borderColor: '#EE272D' },
  btnDestructiveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
