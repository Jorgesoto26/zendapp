import { enablePromise, openDatabase } from 'react-native-sqlite-storage';

enablePromise(true);

export async function getDbConnection() {
  const db = openDatabase({
    name: 'Zendapp.db',
    createFromLocation: 1,
  });
  return db;
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

export async function getData(db, query) {
  //console.log("Elquery+++++++", query);

  if (query.toLowerCase().indexOf('select') != -1) {
    const resultData = [];
    const results = await db.executeSql(query);
    results.forEach(function (result) {
      for (let i = 0; i < result.rows.length; i++) {
        //var item = result.rows.item(i);
        resultData.push(result.rows.item(i));
      }
    });
    return resultData;
  }
  return null;
}

export async function insertOrReplaceDataCaja(db, table, data) {
  const campos = Object.keys(data[0]);
  const strcampos = campos.toString();
  let scriptInsert = `INSERT OR REPLACE INTO ${table} (${strcampos})`;
  let scriptValues = " VALUES ";
  
  for (let index = 0; index < data.length; index++) {
  const element = data[index];
  const _item = Object.values(element);
  scriptValues += "(";
  for (let index_value = 0; index_value < _item.length; index_value++) {
  scriptValues += _item[index_value] === null || _item[index_value] === undefined ? "NULL" : `'${_item[index_value]}'`;
  if (index_value != _item.length - 1) {
  scriptValues += ",";
  }
  }
  scriptValues += ")";
  if (index != data.length - 1) {
  scriptValues += ",";
  }
  }
  /* if(table == 'invoice_box'){
  console.log('insert invoice_box', scriptInsert + scriptValues);
  } */
  return db.executeSql(scriptInsert + scriptValues);
  }

  export async function insertOrReplaceData(db, table, data) {
    // Validar que los datos sean un arreglo no vacío
    if (!Array.isArray(data) || data.length === 0) {
      console.error('Datos no válidos para insertar/reemplazar:', data);
      throw new Error('Datos no válidos para insertar/reemplazar');
    }
  
    // Obtener las columnas del primer objeto
    const columns = Object.keys(data[0]);
    if (columns.length === 0) {
      console.error('No se encontraron columnas en los datos:', data[0]);
      throw new Error('No se encontraron columnas en los datos');
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
  let scriptInsert = `INSERT INTO ${table} (${strcampos})`;
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