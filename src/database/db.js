import { enablePromise, openDatabase } from 'react-native-sqlite-storage';

enablePromise(true);

async function ensureColumnExists(db, table, column, colType = 'TEXT') {
  try {
    const results = await db.executeSql(`PRAGMA table_info(${table})`);
    let exists = false;
    if (results && results.length) {
      results.forEach(res => {
        for (let i = 0; i < res.rows.length; i++) {
          const item = res.rows.item(i);
          if (item?.name && item.name.toLowerCase() === column.toLowerCase()) {
            exists = true;
            break;
          }
        }
      });
    }
    if (!exists) {
      await db.executeSql(`ALTER TABLE ${table} ADD COLUMN ${column} ${colType}`);
    }
  } catch {}
}

export async function ensureDatabaseIntegrity(db) {
  try {
    await db.executeSql(`CREATE TABLE IF NOT EXISTS consecutivoTramitado (id INTEGER PRIMARY KEY, valor INTEGER)`);
    await db.executeSql(`INSERT OR IGNORE INTO consecutivoTramitado (id, valor) VALUES (1, 0)`);
    await db.executeSql(`CREATE TABLE IF NOT EXISTS ventas_pendientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_id TEXT UNIQUE,
      payload TEXT,
      estado TEXT DEFAULT 'pendiente',
      created_at TEXT
    )`);

    // Asegurar estructura de tablas cuotas, cajas y movimientos
    await db.executeSql(`CREATE TABLE IF NOT EXISTS cuotas (
      id TEXT PRIMARY KEY,
      invoice_id TEXT,
      numero INTEGER,
      fecha_vencimiento TEXT,
      monto REAL,
      estado TEXT,
      monto_pagado REAL
    )`);
    try { await db.executeSql(`CREATE INDEX IF NOT EXISTS idx_cuotas_invoice_id ON cuotas(invoice_id)`); } catch {}

    await db.executeSql(`CREATE TABLE IF NOT EXISTS cajas (
      id TEXT PRIMARY KEY,
      estado TEXT,
      saldo_inicial REAL,
      saldo_final REAL,
      fecha_apertura TEXT,
      fecha_cierre TEXT,
      usuario_id TEXT,
      fecha TEXT
    )`);

    await db.executeSql(`CREATE TABLE IF NOT EXISTS movimientos (
      id TEXT PRIMARY KEY,
      tipo TEXT,
      descripcion TEXT,
      monto REAL,
      fecha TEXT,
      horaDispositivo TEXT,
      idCaja TEXT,
      caja_id TEXT,
      estadoMovil TEXT
    )`);

    // Asegurar columnas en cajas
    await ensureColumnExists(db, 'cajas', 'usuario_id', 'TEXT');
    await ensureColumnExists(db, 'cajas', 'fecha_cierre', 'TEXT');
    await ensureColumnExists(db, 'cajas', 'fecha_apertura', 'TEXT');
    await ensureColumnExists(db, 'cajas', 'saldo_inicial', 'REAL');
    await ensureColumnExists(db, 'cajas', 'saldo_final', 'REAL');
    await ensureColumnExists(db, 'cajas', 'estado', 'TEXT');
    await ensureColumnExists(db, 'cajas', 'fecha', 'TEXT');
    await ensureColumnExists(db, 'cajas', 'admin_caja_id', 'TEXT');

    // Asegurar columnas en movimientos
    await ensureColumnExists(db, 'movimientos', 'caja_id', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'idCaja', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'estadoMovil', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'fecha', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'horaDispositivo', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'tipo', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'monto', 'REAL');
    await ensureColumnExists(db, 'movimientos', 'descripcion', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'idFactura', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'cliente_nombre', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'latitud', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'longitud', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'concepto_id', 'INTEGER');
    await ensureColumnExists(db, 'movimientos', 'concepto_nombre', 'TEXT');
    await ensureColumnExists(db, 'movimientos', 'evidencia_path', 'TEXT');

    // Asegurar columnas en facturas
    await ensureColumnExists(db, 'facturas', 'latitud', 'TEXT');
    await ensureColumnExists(db, 'facturas', 'longitud', 'TEXT');
    await ensureColumnExists(db, 'facturas', 'previous_invoice_id', 'TEXT');
    await ensureColumnExists(db, 'facturas', 'periodicidad', 'TEXT');
    await ensureColumnExists(db, 'facturas', 'num_cuotas', 'TEXT');
    await ensureColumnExists(db, 'facturas', 'tasa_interes', 'REAL');
    await ensureColumnExists(db, 'facturas', 'pago_adelantado', 'INTEGER');
    await ensureColumnExists(db, 'facturas', 'foto_documento_path', 'TEXT');

    // Asegurar columnas en clients
    await ensureColumnExists(db, 'clients', 'foto_documento_path', 'TEXT');

    // Asegurar columnas en pagos
    await ensureColumnExists(db, 'pagos', 'latitud', 'TEXT');
    await ensureColumnExists(db, 'pagos', 'longitud', 'TEXT');

    // Tablas de multimedia y organizaciones locales
    await db.executeSql(`CREATE TABLE IF NOT EXISTS evidencias_locales (
      id TEXT PRIMARY KEY,
      tipo_evidencia TEXT,
      tabla_relacionada TEXT,
      registro_id TEXT,
      local_path TEXT,
      file_path TEXT,
      mime_type TEXT,
      size_original REAL,
      size_compressed REAL,
      estado TEXT DEFAULT 'pendiente',
      usuario_id TEXT,
      created_at TEXT
    )`);

    await db.executeSql(`CREATE TABLE IF NOT EXISTS organizaciones (
      id TEXT PRIMARY KEY,
      nombre TEXT,
      nit TEXT,
      telefono TEXT,
      direccion TEXT,
      logo_path TEXT,
      admin_id TEXT,
      modo_apertura_caja TEXT DEFAULT 'admin_masivo'
    )`);

    // Tabla de conceptos parametrizados desde la BD (offline-first)
    await db.executeSql(`CREATE TABLE IF NOT EXISTS concepts (
      id INTEGER PRIMARY KEY,
      tipo TEXT,
      valor TEXT,
      nombre TEXT,
      tipo_movimiento TEXT,
      activo INTEGER DEFAULT 1,
      orden INTEGER DEFAULT 0,
      organizacion_id TEXT
    )`);
    await ensureColumnExists(db, 'concepts', 'nombre', 'TEXT');
    await ensureColumnExists(db, 'concepts', 'tipo_movimiento', 'TEXT');
    await ensureColumnExists(db, 'concepts', 'activo', 'INTEGER');
    await ensureColumnExists(db, 'concepts', 'orden', 'INTEGER');
    await ensureColumnExists(db, 'concepts', 'organizacion_id', 'TEXT');

    // Tabla de auditoría local de movimientos (Trazabilidad offline-first)
    await db.executeSql(`CREATE TABLE IF NOT EXISTS movimientos_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_uuid TEXT UNIQUE,
      movement_id TEXT,
      user_id TEXT,
      tipo_anterior TEXT,
      tipo_nuevo TEXT,
      monto_anterior REAL,
      monto_nuevo REAL,
      motivo TEXT,
      origen TEXT DEFAULT 'app_movil',
      fecha TEXT,
      estadoMovil TEXT DEFAULT 'pendiente'
    )`);
    await ensureColumnExists(db, 'movimientos_audit', 'audit_uuid', 'TEXT');
    try { await db.executeSql(`CREATE INDEX IF NOT EXISTS idx_mov_audit_movement ON movimientos_audit(movement_id)`); } catch {}
    try { await db.executeSql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_audit_uuid ON movimientos_audit(audit_uuid)`); } catch {}

    // Eliminar índices únicos restrictivos que impiden pagos parciales o múltiples pagos por factura
    try { await db.executeSql(`DROP INDEX IF EXISTS index_pago`); } catch {}
    try { await db.executeSql(`DROP INDEX IF EXISTS index_detalles`); } catch {}
    try { await db.executeSql(`CREATE INDEX IF NOT EXISTS idx_pagos_idFactura ON pagos(idFactura)`); } catch {}
    try { await db.executeSql(`CREATE INDEX IF NOT EXISTS idx_detalles_facturaId ON detallesCaja(facturaId)`); } catch {}

    const paramRows = await getData(db, `SELECT COUNT(*) as c FROM parametrizacion`);
    if (!paramRows || !paramRows[0] || paramRows[0].c === 0) {
      await db.executeSql(`INSERT OR IGNORE INTO parametrizacion (id, nombre, valor) VALUES
        (1, 'URL', '192.168.1.36:8073'),
        (2, 'reactiva.bdxmlrpc', ''),
        (3, 'login', NULL),
        (4, 'password', NULL),
        (5, 'uid', NULL),
        (6, 'permiso', 'cliente'),
        (7, 'name', NULL),
        (8, 'partner_id', NULL),
        (9, 'version', '2.6.3'),
        (10, 'modo_apertura_caja', 'admin_masivo')`);
    } else {
      await db.executeSql(`INSERT OR IGNORE INTO parametrizacion (id, nombre, valor) VALUES (10, 'modo_apertura_caja', 'admin_masivo')`);
    }
  } catch (err) {
    console.log('ensureDatabaseIntegrity warning:', err);
  }
}

let dbInstance = null;
let isIntegrityEnsured = false;

export async function getDbConnection() {
  if (!dbInstance) {
    dbInstance = await openDatabase({
      name: 'Zendapp.db',
      createFromLocation: 1,
    });
  }
  if (!isIntegrityEnsured) {
    try {
      await ensureDatabaseIntegrity(dbInstance);
      isIntegrityEnsured = true;
    } catch (e) {
      console.log('ensureDatabaseIntegrity error:', e);
    }
  }
  return dbInstance;
}

export async function createTables(db) {
  /*const query =
    'CREATE TABLE ordenTrabajoPDA ( id INTEGER primary key autoincrement UNIQUE,estado TEXT,consecutivoTransmision INTEGER,idOrden INTEGER,cuenta TEXT,propietario TEXT,departamento TEXT,municipio TEXT,ubicacion TEXT,direccion TEXT,claseServicio TEXT,estrato TEXT,idNodo TEXT,ruta TEXT,estadoCuenta TEXT,fechaAtencion TEXT,horaIni TEXT,horaFin TEXT,pda TEXT,estadoOrdenTrabajo TEXT,observacionTrabajo TEXT,observacionPad TEXT,usuario TEXT,fechaHoraEstado TEXT,fechaVencimiento TEXT,tipo TEXT,registrado INTEGER,codigoApertura TEXT,solicitud TEXT,bodega TEXT,horaInicialAtiende TEXT,horaFinalAtiende TEXT,personaAtiende TEXT,telefonoPersonaAtiende TEXT,codigoPrograma TEXT,industria TEXT,procedencia TEXT,grupoTrabajo TEXT,contratista TEXT,tipoOrden INTEGER,validacion TEXT,ciclo TEXT,meses_deuda TEXT,claseSolicitud TEXT,tipoSolicitud TEXT,dependencia TEXT,tipoAccion TEXT,dependenciaAsignada TEXT,consecutivoAccion TEXT,cargaInstalada TEXT,cargaContratada TEXT,campana TEXT,cobroMo TEXT,cobroMat TEXT,capacidad TEXT,actividadCiiu TEXT,nivelTension TEXT,propiedad TEXT,barrioVereda TEXT,antiguedad TEXT,codigoDescarga TEXT,fechaDescarga TEXT,pqr TEXT,causa TEXT,usuarioGenero TEXT,telefono TEXT,circuito TEXT,sector TEXT,saldo TEXT,mesDeuda TEXT,observacionLectura TEXT,ultimaLectura TEXT,fechaLectura TEXT,ultimoConsumo TEXT,x TEXT,y TEXT,z TEXT,pintadoApoyo TEXT,usoPredio TEXT,reglaOro TEXT,serieMedidor TEXT,tipoRed TEXT,planeador TEXT,programa TEXT,nombrePrograma TEXT,serie TEXT,tipoUsuario TEXT,subestacion TEXT,nodoTransformador TEXT,nodoAcometida TEXT)';
  return db.executeSql(query);*/
}

export async function initDatabase() {
  const db = await getDbConnection();
  await createTables(db);
  db.close();
}

export async function getData(db, query, params = []) {
  if (query.toLowerCase().indexOf('select') === -1) return null;
  const resultData = [];
  const results = params.length ? await db.executeSql(query, params) : await db.executeSql(query);
  results.forEach(function (result) {
    for (let i = 0; i < result.rows.length; i++) {
      resultData.push(result.rows.item(i));
    }
  });
  return resultData;
}

// Helpers seguros con placeholders - usar estos para nuevo código
export async function querySafe(db, sql, params = []) {
  return getData(db, sql, params);
}

export async function executeSafe(db, sql, params = []) {
  return db.executeSql(sql, params);
}

export async function insertSafe(db, table, data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  return db.executeSql(sql, Object.values(data));
}

export async function updateSafe(db, table, data, whereClause, whereParams = []) {
  const { id, ...rest } = data;
  // si data trae id, usar where id = ?
  const cols = Object.keys(rest);
  const setClause = cols.map(c => `${c} = ?`).join(', ');
  let sql = `UPDATE ${table} SET ${setClause}`;
  let params = Object.values(rest);
  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
    params = [...params, ...whereParams];
  } else if (id !== undefined) {
    sql += ` WHERE id = ?`;
    params.push(id);
  }
  return db.executeSql(sql, params);
}

export async function paginatedQuery(db, baseSql, { limit = 20, offset = 0, params = [] } = {}) {
  const sql = `${baseSql} LIMIT ? OFFSET ?`;
  return getData(db, sql, [...params, limit, offset]);
}

export async function insertOrReplaceDataCaja(db, table, data) {
  if (!Array.isArray(data) || data.length === 0 || !data[0]) {
    console.warn(`insertOrReplaceDataCaja ${table}: vacío, skip`);
    return null;
  }
  const campos = Object.keys(data[0]);
  const strcampos = campos.toString();
  let scriptInsert = `INSERT OR REPLACE INTO ${table} (${strcampos})`;
  let scriptValues = " VALUES ";
  for (let index = 0; index < data.length; index++) {
    const element = data[index];
    if (!element) continue;
    const _item = Object.values(element);
    scriptValues += "(";
    for (let index_value = 0; index_value < _item.length; index_value++) {
      scriptValues += _item[index_value] === null || _item[index_value] === undefined ? "NULL" : `'${_item[index_value]}'`;
      if (index_value != _item.length - 1) scriptValues += ",";
    }
    scriptValues += ")";
    if (index != data.length - 1) scriptValues += ",";
  }
  return db.executeSql(scriptInsert + scriptValues);
}

  export async function insertOrReplaceData(db, table, data) {
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`insertOrReplaceData ${table}: array vacío, skip`);
      return null;
    }
    if (!data[0] || typeof data[0] !== 'object') {
      console.warn(`insertOrReplaceData ${table}: primer elemento nulo, skip`, data[0]);
      return null;
    }
    const columns = Object.keys(data[0]);
    if (columns.length === 0) {
      console.warn(`insertOrReplaceData ${table}: sin columnas, skip`);
      return null;
    }
  
    // Validar que todos los objetos tengan las mismas columnas
    for (const item of data) {
      const itemColumns = Object.keys(item);
      if (itemColumns.length !== columns.length || !columns.every(col => itemColumns.includes(col))) {
        console.error('Inconsistencia en las columnas de los datos:', item);
        throw new Error('Los objetos deben tener las mismas columnas');
      }
    }
  
    // Generar la parte inicial de la consulta
    const scriptInsert = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES `;
    let scriptValues = [];
  
    // Preparar los valores para cada fila
    for (const item of data) {
      const values = columns.map((col) => {
        const value = item[col];
        if (value === undefined || value === null) {
          return 'NULL';
        }
        // Escapar comillas simples en cadenas
        return typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : value;
      });
      scriptValues.push(`(${values.join(', ')})`);
    }
  
    // Unir la consulta final
    const finalQuery = scriptInsert + scriptValues.join(', ');
    // console.log('Consulta SQL generada:', finalQuery);
  
    try {
      return await db.executeSql(finalQuery);
    } catch (error) {
      console.error(`Error ejecutando la consulta: ${finalQuery}`, error);
      throw error;
    }
  }

export async function insertOrReplaceAllDocuments(db, documents) {
  if (documents.length === 0) return; // Si no hay documentos, no hacer nada

  // Preparar la consulta SQL
  let values = documents.map(doc => {
    return `(
          '${doc.idVehiculo || ''}',
          '${doc.numero || ''}',
          '${doc.tipo || ''}',
          '${doc.imagen || ''}',
          '${doc.estado || ''}'
      )`;
  }).join(',');

  let query = `
      INSERT OR REPLACE INTO imageDocuments (
          idVehiculo, numero, tipo, imagen, estado
      ) VALUES ${values};
  `;

  // Ejecutar la consulta
  try {
    await db.executeSql(query);
    //console.log('Todos los documentos han sido insertados o reemplazados correctamente.');
  } catch (error) {
    console.error(`Un error ocurrió insertando o reemplazando documentos: ${error.message}`);
    throw error;
  }
}

export async function insertOrReplaceAllInventories(db, inventories) {
  if (inventories.length === 0) return; // Si no hay inventarios, no hacer nada

  // Preparar la consulta SQL
  let values = inventories.map(inv => {
    return `(
          '${inv.idVehiculo || ''}',
          '${inv.categoria || ''}',
          '${inv.item || ''}',
          '${inv.imagen || ''}',
          '${inv.estado || ''}'
      )`;
  }).join(',');

  let query = `
      INSERT OR REPLACE INTO imageInventory (
          idVehiculo, categoria, item, imagen, estado
      ) VALUES ${values};
  `;

  // Ejecutar la consulta
  try {
    await db.executeSql(query);
    //console.log('Todos los inventarios han sido insertados o reemplazados correctamente.');
  } catch (error) {
    console.error(`Un error ocurrió insertando o reemplazando inventarios: ${error.message}`);
    throw error;
  }
}


export async function insertData(db, table, data) {
  const dataArray = Object.entries(data);
  let scriptInsert = `INSERT INTO ${table} (`;
  let scriptValues = ' VALUES (';
  for (let index = 0; index < dataArray.length; index++) {
    const element = dataArray[index];
    scriptInsert += element[0];
    scriptValues += "'" + element[1] + "'";
    if (index != dataArray.length - 1) {
      scriptInsert += ',';
      scriptValues += ',';
    }
  }
  scriptInsert += ')';
  scriptValues += ')';
  return db.executeSql(scriptInsert + scriptValues);
}

export async function deleteData(db, table, id) {
  const insertQuery = `DELETE FROM ${table} WHERE id = '${id}'`;
  return db.executeSql(insertQuery);
}

export async function clearValueByName(db, table, name) {
  //console.log("table: ", table, "name: ", `'${name.trim()}'`); 
  const updateQuery = `UPDATE ${table} SET valor = NULL WHERE nombre = '${name.trim()}'`;
  try {
    const result = await db.executeSql(updateQuery);
    //console.log("updateQuery ejecutado:", updateQuery);
    return true;
  } catch (error) {
    console.error("Error al actualizar el registro:", error);
    return false;
  }
}




export async function deleteAllDataTable(db, table) {
  const insertQuery = `DELETE FROM ${table}`;
  return db.executeSql(insertQuery);
}

export async function upsertData(db, table, data) {
  try {
    const updateResult = await updateData(db, table, data);
    if (updateResult.rowsAffected === 0) {
      await insertData(db, table, data);
    }
  } catch (error) {
    console.log("Error en upsertData:", error);
    throw error;
  }
}

export async function insertTables(db, table, data) {
  /* console.log("insertTables ", data); */
  const campos = Object.keys(data[0])
  const strcampos = campos.toString()
  let scriptInsert = `INSERT OR REPLACE INTO ${table} (${strcampos})`;
  let scriptValues = ' VALUES ';
  for (let index = 0; index < data.length; index++) {
    const element = data[index];
    const _item = Object.values(element)
    scriptValues += "("
    //
    for (let index_value = 0; index_value < _item.length; index_value++) {

      if (typeof _item[index_value] === 'object') {
        //console.log("ingreso al objeto",_item[index_value])
        scriptValues += `'${JSON.stringify(_item[index_value])}'`;
      } else {
        scriptValues += "'" + _item[index_value] + "'";
      }

      if (index_value != _item.length - 1) {
        scriptValues += ',';
      }
    }

    scriptValues += ")"
    if (index != data.length - 1) {
      scriptValues += ',';
    }
  }
  if (table == 'detallesCaja') {
    //console.log("scriptInsert + scriptValues----------",scriptInsert + scriptValues)

  }
  //notifyDbChange();
  return db.executeSql(scriptInsert + scriptValues);
}


export async function updateData(db, table, data) {
  //console.log('updateData fue llamada con:', { table, data });

  if (data.id != undefined) {
    let { id, ...all } = data;
    const dataArray = Object.entries(all);
    let scriptUpdate = `UPDATE ${table} SET `;
    for (let index = 0; index < dataArray.length; index++) {
      const element = dataArray[index];
      scriptUpdate += element[0] + ' = ' + "'" + element[1] + "'";
      if (index != dataArray.length - 1) {
        scriptUpdate += ',';
      }
    }
    scriptUpdate += ` WHERE id='${id}'`;
    //console.log('scriptUpdate', scriptUpdate); // <-- Este debería verse

    return db.executeSql(scriptUpdate);
  } else {
    console.log('❌ data.id es undefined, no se ejecutará el update');
  }
  return null;
}

export async function updateDataServices(db, table, data) {
  //console.log('updateData fue llamada con:', { table, data });

  if (data.id != undefined) {
    let { id, ...all } = data;
    const dataArray = Object.entries(all);
    let scriptUpdate = `UPDATE ${table} SET `;
    for (let index = 0; index < dataArray.length; index++) {
      const element = dataArray[index];
      scriptUpdate += element[0] + ' = ' + "'" + element[1] + "'";
      if (index != dataArray.length - 1) {
        scriptUpdate += ',';
      }
    }
    scriptUpdate += ` WHERE id= ${id} AND tipo = 'INICIAL'`;
    //console.log('scriptUpdate', scriptUpdate); // <-- Este debería verse

    return db.executeSql(scriptUpdate);
  } else {
    console.log('❌ data.id es undefined, no se ejecutará el update');
  }
  return null;
}


//DEPRECATED
export async function insertData2(db, table, values) {
  const insertQuery = `INSERT INTO ${table} values (${values})`;
  console.log('insertQuery  ', insertQuery);
  return db.executeSql(insertQuery);
}

export async function obtenerParametro(db, name) {
  const parametrizacion = await getData(
    db,
    "select parametrizacion.* from parametrizacion where nombre='" +
    name +
    "'",
  );

  return parametrizacion[0] == undefined ? null : parametrizacion[0].valor;
};

export async function setParametro(db, name, value) {
  const parametrizacion = await getData(
    db,
    "select parametrizacion.* from parametrizacion where nombre='" +
    name +
    "'",
  );
  if (parametrizacion.length > 0) {
    parametrizacion[0].valor = value;
    try {
      const resultado = await updateData(
        db,
        'parametrizacion',
        parametrizacion[0],
      );
      //console.log('result Update ', resultado);
    } catch (error) {
      alert(`Un error ocurrio modificando parametrizacion: ${error.message}`);
    }
  } else {
    try {
      const resultado = await insertData(db, 'parametrizacion', {
        nombre: name,
        valor: value,
      });
      //console.log(resultado);
    } catch (error) {
      alert(`Un error ocurrio grabando parametrizacion: ${error.message}`);
    }
  }
};

/* const dbEventEmitter = new EventEmitter();

export function addDbChangeListener(callback) {
  dbEventEmitter.on('db-change', callback);
  return () => dbEventEmitter.off('db-change', callback);
}

function notifyDbChange() {
  dbEventEmitter.emit('db-change');
} */