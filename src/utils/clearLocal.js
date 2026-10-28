import { getDbConnection, getData } from '../database/db';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function clearAllLocalData() {
  const db = await getDbConnection();
  try {
    // Solo borrar tablas operativas/transaccionales de datos locales
    const toClear = ['pagos', 'detallesCaja', 'movimientos', 'facturas', 'copiaFacturas', 'deleteInvoice', 'cajas', 'ventas_pendientes'];
    for (const tbl of toClear) {
      try { await db.executeSql(`DELETE FROM ${tbl}`); } catch {}
    }

    // Reset de contadores sin borrar las filas requeridas
    try {
      await db.executeSql(`CREATE TABLE IF NOT EXISTS consecutivoTramitado (id INTEGER PRIMARY KEY, valor INTEGER)`);
      await db.executeSql(`INSERT OR REPLACE INTO consecutivoTramitado (id, valor) VALUES (1, 0)`);
    } catch {}

    try {
      // Limpiar solo tokens y perfil de sesión en parametrizacion, nunca borrar la tabla
      await db.executeSql(`UPDATE parametrizacion SET valor = NULL WHERE id IN (2, 3, 4, 5, 6, 7, 8)`);
    } catch {}

    try { await db.executeSql(`UPDATE writeDate SET valor = NULL`); } catch {}

    // AsyncStorage
    await AsyncStorage.multiRemove(['cached_profile', 'sincronizar']);
    return true;
  } catch (e) {
    console.log('clearAllLocalData error', e);
    return false;
  }
}

export async function clearOnlyPendingSync() {
  const db = await getDbConnection();
  try {
    await db.executeSql(`DELETE FROM pagos WHERE id < 0 OR estadoMovil = 'actualizado'`);
    await db.executeSql(`DELETE FROM detallesCaja WHERE estado = 'guardado' OR estadoMovil = 'actualizado'`);
    await db.executeSql(`DELETE FROM movimientos WHERE id < 0`);
    await db.executeSql(`DELETE FROM ventas_pendientes`);
    // Marcar facturas como sincronizadas para no reintentar
    await db.executeSql(`UPDATE facturas SET estadoMovil = 'sincronizado' WHERE estadoMovil = 'actualizado'`);
    return true;
  } catch (e) { console.log(e); return false; }
}
