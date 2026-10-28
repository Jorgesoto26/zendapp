/**
 * npm install intl -f
 */
import 'intl';
import 'intl/locale-data/jsonp/en';
import { getDbConnection, getData } from '../database/db'
export const versionGesper = 'Comercial';
import NetInfo from "@react-native-community/netinfo";
import _BackgroundTimer from "react-native-background-timer";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { Alert, Linking } from 'react-native'; // Agregado para usar Alert
import { appAlert } from '../components/AppAlert';
/* export const clienConect=async()=>{
  try{
  const db = await getDbConnection();
  const data = await getData(db,`select * from parametrizacion`);
  //console.log("get data del clenteconect",data)
  let sendToOdoo=`{` 
  for(let i=0;i<data.length;i++){
      if(data[i].nombre=="reactiva.bdxmlrpc"&&data[i].valor!==""){
          sendToOdoo+=`"database":"${data[i].valor}",`
          sendToOdoo+=`"host":"https://${data[i].valor}.bcan.info",`
          sendToOdoo+=`"port":"",`
      }else if(data[i].nombre=="login"&&data[i].valor!==""){
          
          sendToOdoo+=`"username":"${data[i].valor}",`
      }else if(data[i].nombre=="password"&&data[i].valor!==""){
         
          sendToOdoo+=`"password":"${data[i].valor}",`
      }
  }
  
  sendToOdoo+=`}`
  sendToOdoo = sendToOdoo.replace(',}', '}');
  //console.log("clietne conet",sendToOdoo)
  const obj=JSON.parse(sendToOdoo);
  return obj
  }catch(error){
      console.log("error en la consulta del cliente",error)
  }
}
 */

export const closeSession = async (session, comeMenu) => {
    const db = await getDbConnection();
    const iscloseSecion = await deleteDataAplication(db, comeMenu)

    if (iscloseSecion) {
        if (session) {
            const sessionString = JSON.stringify(session);
            AsyncStorage.removeItem(sessionString);
        }
        return true;
    } else {
        return false;
    }
};

export const clienConect = async () => {
    const db = await getDbConnection();
    try {
        const data = await getData(db, `select * from parametrizacion`);
        let sendToOdoo = `{`
        for (let i = 0; i < data.length; i++) {
            if (data[i].nombre == "reactiva.bdxmlrpc" && data[i].valor !== "") {
                sendToOdoo += `"database":"${data[i].valor}",`
            } else if (data[i].nombre == "login" && data[i].valor !== "") {

                sendToOdoo += `"username":"${data[i].valor}",`
            } else if (data[i].nombre == "password" && data[i].valor !== "") {

                sendToOdoo += `"password":"${data[i].valor}",`
            } else if (data[i].nombre == "URL" && data[i].valor !== "") {

                sendToOdoo += `"host":"${data[i].valor.substr(0, data[i].valor.length - 5)}",`
                sendToOdoo += `"port":"${data[i].valor.substr(data[i].valor.length - 4, data[i].valor.length)}",`
            }
        }

        sendToOdoo += `}`
        sendToOdoo = sendToOdoo.replace(',}', '}');
        const obj = JSON.parse(sendToOdoo);

        return obj

    } catch (error) {
        console.log("error en la consulta del cliente", error)
    }
}
export const getDateOdoo = () => {
    const d = new Date();
    let month = (d.getMonth() + 1)
    let day = d.getDate()
    let horas = d.getHours()
    let min = d.getMinutes()
    let seg = d.getSeconds()
    if (month < 10) {
        month = "0" + (d.getMonth() + 1)
    }
    if (day < 10) {
        day = "0" + d.getDate()
    }
    if (horas < 10) {
        horas = "0" + d.getHours()
    }
    if (min < 10) {
        min = "0" + d.getMinutes()
    }
    if (seg < 10) {
        seg = "0" + d.getSeconds()
    }
    let fecha = d.getFullYear() + "-" + month + "-" + day
    let hora = horas + ':' + min + ':' + seg;
    let date = fecha + " " + hora
    //console.log("date odoo", date)
    return date
}

export const getDateOdooMilisec = () => {
    return new Date().toISOString();
};

export const getDate = () => {
    const d = new Date();
    let month = (d.getMonth() + 1)
    let day = d.getDate()
    if (month < 10) {
        month = "0" + (d.getMonth() + 1)
    }
    if (day < 10) {
        day = "0" + d.getDate()
    }
    let fecha = d.getFullYear() + "-" + month + "-" + day
    return fecha
}

export const NumberWithCommas = (value) => {
    const numericValue = value.toString().replace(/[^0-9]/g, "");
    return parseInt(numericValue).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const FormatMoney = (value) => {
    if (value < 0) {
        return '$ -' + NumberWithCommas(value);
    } else {
        return '$ ' + NumberWithCommas(value);
    }
};

export const NumberWithCommasDecimales = (value) => {
    const numericValue = parseFloat(String(value).replace(/[$,]/g, '').trim());

    if (isNaN(numericValue)) {
        return 'Invalid value';
    }

    if (numericValue % 1 === 0) {
        return numericValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    } else {
        const formattedValue = numericValue.toFixed(2);
        return formattedValue.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
};

export const FormatMoneyDecimales = (value) => {
    const numericValue = parseFloat(String(value).replace(/[$,]/g, '').trim());

    if (isNaN(numericValue)) {
        return 'Invalid value';
    }

    return '$ ' + NumberWithCommasDecimales(value);
};

/**
 * Extrae solo dígitos y remueve ceros a la izquierda.
 * No permite puntos, comas, espacios ni ningún caracter no numérico.
 * Si el usuario intenta escribir 0 al inicio, retorna '' (no permite iniciar con $0 ni 0).
 */
export const cleanMoneyValue = (value) => {
    if (value === null || value === undefined) return '';
    const digits = String(value).replace(/\D/g, '');
    return digits.replace(/^0+/, '');
};

/**
 * Formatea un valor monetario en tiempo real para inputs con formato moneda de pesos:
 * - Filtra caracteres no numéricos
 * - No permite que inicie con $0 ni 0
 * - Aplica puntos separadores de miles de pesos (ej. $ 50.000)
 */
export const formatMoneyInput = (value, withSymbol = true) => {
    const clean = cleanMoneyValue(value);
    if (!clean) return '';
    const formatted = clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return withSymbol ? `$ ${formatted}` : formatted;
};

/**
 * Convierte cualquier texto formateado (ej. '$ 50.000' o '50.000') en un número puro
 * listo para guardarse en la base de datos (ej. 50000).
 */
export const parseMoneyToNumeric = (value) => {
    const clean = cleanMoneyValue(value);
    return clean ? parseFloat(clean) : 0;
};

export const FormatNumber = (value) => {
    if (value % 1 === 0) {
        // Si no tiene decimales, retornar el número sin .00
        return parseInt(value, 10);
    } else {
        // Si tiene decimales, redondearlo a dos decimales y retornar como cadena
        return parseFloat(value?.toFixed(1));
    }
}

export const validConexion = async () => {
    let isOk = false
    await NetInfo.fetch().then(async state => {
        if (state.isConnected) {
            //console.log("state.isConnected jejeje", state.isConnected)
            isOk = true
        } else {
            isOk = false
        }
    }).catch((err) => {
        isOk = false


    });
    return isOk
}

export const _getDates = async () => {
    try {
        const db = await getDbConnection();
        const writeDate = await getData(db, `select * from writeDate`);

        let sendToOdoo = `{`
        if (writeDate[0].valor == null) {
            for (let i = 0; i < writeDate.length; i++) {
                sendToOdoo += `"${[writeDate[i].name]}":${writeDate[i].valor}`
                if (i != writeDate.length - 1) {
                    sendToOdoo += ',';
                }
            }
        } else {
            for (let i = 0; i < writeDate.length; i++) {
                if (writeDate[i].valor == null) {
                    sendToOdoo += `"${[writeDate[i].name]}":${writeDate[i].valor}`
                } else {
                    sendToOdoo += `"${[writeDate[i].name]}":"${writeDate[i].valor}"`
                }
                //sendToOdoo+=`"${[writeDate[i].name]}":"${writeDate[i].valor}"`
                if (i != writeDate.length - 1) {
                    sendToOdoo += ',';
                }
            }
        }
        sendToOdoo += `}`
        const data = JSON.parse(sendToOdoo);
        return data
    } catch (error) {
        //console.log("error del get WriteDate",error)
    }
};



export const EvaluationDataSend = async () => {
    const db = await getDbConnection();

    // Ejecutar todas las consultas en paralelo
    let countVentas = 0;
    try {
      const v = await getData(db, `SELECT COUNT(*) as count FROM ventas_pendientes WHERE estado = 'pendiente'`);
      countVentas = v?.[0]?.count || 0;
    } catch {}

    const [
        movimientos,
        pagos,
        usersCliente,
    ] = await Promise.all([
        getData(db, `SELECT COUNT(*) as count FROM movimientos WHERE estadoMovil IN ('actualizado', 'enviando')`),
        getData(db, `SELECT COUNT(*) as count FROM pagos WHERE estadoMovil IN ('actualizado', 'enviando')`),
        getData(db, `SELECT COUNT(*) as count FROM users WHERE estadoMovil IN ('actualizado', 'enviando')`),
    ]);

    // Convertir a booleano los resultados
    const hasData = [
        countVentas,
        movimientos?.[0]?.count || 0,
        pagos?.[0]?.count || 0,
        usersCliente?.[0]?.count || 0,
    ].some(count => count > 0);

    return hasData;
};


export const Capitalize = (value) => {
    return (value.charAt(0).toUpperCase() + value.slice(1));
}


export const verifyData = (type, valor, call) => {
    if (type == "text" || type == "number") {
        if (valor.trim() == "") {
            call("este campo es obligatorio")
        } else {
            call("")
        }
    } else {
        if (valor.trim() == "") {
            call("este campo es obligatorio")
        } else if (!valor.match(/^([\w.%+-]+)@([\w-]+\.)+([\w]{2,})$/i)) {
            call("el formato es incorrecto")
        } else {
            call("")
        }
    }

    //setErrores(objeto)


}
export const deleteReloadData = async (db, comeMenu) => {
    return true;
};

export const deleteDataAplication = async (db, comeMenu) => {
    console.log("esto ingreso al deleteDataAplication", comeMenu)
    const cajasDay = await getData(db, `select * from cajaDay`)

    try {
        if (!comeMenu) {

            await db.executeSql("update writeDate set valor=NULL where id=1")
            await db.executeSql("update writeDate set valor=NULL where id=2")
            await db.executeSql("update writeDate set valor=NULL where id=3")
            await db.executeSql("update consecutivoTramitado set valor=NULL where id=1")

            const tables = await getData(db, `SELECT group_concat(name) as f FROM sqlite_master
            WHERE type='table' and name not in('writeDate','consecutivoTramitado', 'sqlite_sequence','parametrizacion','dataBases','cajaDay')
            ORDER BY name`);

            var arrayString = tables[0]["f"].split(",");
            for (var i = 0; i < arrayString.length; i++) {
                //console.log("query deleted", "DELETE FROM  " + arrayString[i] + ";")
                db.executeSql("DELETE FROM  " + arrayString[i] + ";")
            }
            for (var i = 0; i < cajasDay.length; i++) {
                await db.executeSql(`update cajaDay set valor=NULL where id='${cajasDay[i].id}'`)
            }
            await db.executeSql(`update parametrizacion set valor = NULL where id in (5, 4)`);
            await AsyncStorage.removeItem("session");
            return true
        } else {
            await db.executeSql(`update parametrizacion set valor = NULL where id in (5, 4)`);
            await AsyncStorage.removeItem("session");
            return true
        }


    } catch (error) {
        console.log("error deleteReloadData", error)
        return false
    }
}

export const FormatDateComplete = function (una_fecha) {
    const fecha = una_fecha ? new Date(una_fecha) : new Date(Date.now());
    const miFecha = fecha.getFullYear() + "-" + (((fecha.getMonth() + 1).toString().length == 1) ? "0" + (fecha.getMonth() + 1) : (fecha.getMonth() + 1)) + "-" + (((fecha.getDate()).toString().length == 1) ? "0" + (fecha.getDate()) : (fecha.getDate()));
    return miFecha;
};

export const FormatDateSinHora = function (fecha) {
    //console.log("fecha que entra", fecha);

    // Separar la parte de la fecha de la hora (asumiendo que la fecha está en formato 'YYYY-MM-DD HH:mm:ss')
    const fechaSinHoraString = fecha.split(' ')[0];
    const fechaConHora = new Date(fechaSinHoraString);

    // Devolver la fecha formateada sin la hora
    //console.log("fecha que sale", fechaSinHoraString);
    return fechaSinHoraString;
};


export const FormatDateConHora = function (fecha) {
    if (!fecha) return '';
    let s = String(fecha);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
        s = s.replace(" ", "T") + "Z";
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(fecha);
    try {
        return d.toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        });
    } catch {
        return d.toLocaleString();
    }
};



export const EvaluationResponseOdoo = (res, call) => {
    console.log("EvaluationResponseOdoo ", res)
    if (res?.errores) {
        console.log("res?.errores", res?.errores)
        if (res?.errores?.error) {
            console.log("ingreso al res?.errores?.error")
            if (res?.errores?.error) {
                return call(true, res?.errores?.error)
            }

        } else if (res?.errores?.mensaje) {
            console.log("ingreso al res?.errores?.mensaje", res?.errores?.mensaje)
            return call(true, res?.errores?.mensaje)
        }

        return call(true, "Se presento un error subir los datos")


    } else if (res[0]?.error) {
        console.log("res[0]?.error", res[0]?.error)
        return call(true, res[0]?.error)
    } else if (res[0]?.errores) {
        console.log("res[0]?.errores", res[0]?.errores)
        if (res[0]?.errores?.error) {
            return call(true, res[0]?.errores?.error)
        } else if (res[0]?.errores?.mensaje) {
            return call(true, res[0]?.errores?.mensaje)
        }
        return call(true, "Se presento un error subir los datos")
    } else if (res.idn) {

        if (res.idn?.errores) {
            console.log("res.idn?.errores", res.idn?.errores)
            return call(true, res.idn?.errores)

        }
        //return call(true,"Se presento un error subir los datos")

    } else if (res[0]?.idn) {
        console.log("ingreso al response de id222", res[0].idn)
        console.log("ingreso al response de id", JSON.stringify(res[0].idn)?.includes("error" || "errores"))
        if (JSON.stringify(res[0].idn)?.includes("error" || "errores")) {
            return call(true, JSON.stringify(res[0].idn))

        }


    }

    return call(false)


}

export const IdInsertion = async () => {
    const db = await getDbConnection();
    let id = 0;
    try {
        const personal = await getData(db, `SELECT MIN(id) AS id FROM users`);
        const pagos = await getData(db, `SELECT MIN(id) AS id FROM pagos`);
        const conceptos = await getData(db, `SELECT MIN(id) AS id FROM concepto_ids`);
        const detallesCaja = await getData(db, `SELECT MIN(id) AS id FROM detallesCaja`);

        var z = Math.min(
            personal[0].id == null ? 0 : parseInt(personal[0].id),
            pagos[0].id == null ? 0 : parseInt(pagos[0].id),
            conceptos[0].id == null ? 0 : parseInt(conceptos[0].id),
            detallesCaja[0].id == null ? 0 : parseInt(detallesCaja[0].id)
        );

        id = z > 0 ? 0 : z;

        return id - 1;
    } catch (err) {
        console.log("Error al obtener el id negativo", err);
    }
};




export const GetPermission = async () => {
    console.log("entro a getPermision");

    if (Platform.OS === 'android') {
        console.log("entro a android");
        // Solicitar permisos Android
        try {
            const writePermission = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
            );
            const readPermission = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
            );

            if (writePermission === PermissionsAndroid.RESULTS.GRANTED && readPermission === PermissionsAndroid.RESULTS.GRANTED) {
                console.log('Permisos de lectura y escritura concedidos en Android');
            } else {
                console.log('Sin permisos de lectura y escritura en Android');
                showPermissionAlert(); // Mostrar alerta si los permisos no están concedidos
            }
        } catch (err) {
            console.warn(err);
        }
    } else if (Platform.OS === 'ios') {
        console.log("entro a IOS");
        // Solicitar permisos iOS
        try {
            const cameraStatus = await check(PERMISSIONS.IOS.CAMERA);
            const photosStatus = await check(PERMISSIONS.IOS.PHOTO_LIBRARY);

            console.log("Permisos de camera", cameraStatus);
            console.log("Permisos de librería", photosStatus);

            if (cameraStatus === 'granted' && photosStatus === 'granted') {
                console.log('Permisos de cámara y fotos concedidos en iOS');
            } else {
                console.log('Sin permisos de cámara y fotos en iOS');
                showPermissionAlert(); // Mostrar alerta si los permisos no están concedidos
            }

        } catch (err) {
            console.warn(err);
        }
    } else {
        console.log('Plataforma no soportada');
    }
};

// Función para mostrar una alerta indicando la necesidad de permisos
const showPermissionAlert = () => {
    appAlert(
        'Permisos necesarios',
        'Esta aplicación requiere permisos de almacenamiento para funcionar correctamente.',
        [
            {
                text: 'OK',
                onPress: () => requestPermissions(), // Llamada a la función para solicitar permisos
            },
        ],
        { cancelable: false }
    );
};

// Función para solicitar permisos después de que el usuario presiona "OK"
const requestPermissions = async () => {
    if (Platform.OS === 'android') {
        try {
            const writePermission = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
            );
            const readPermission = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
            );

            if (writePermission === PermissionsAndroid.RESULTS.GRANTED && readPermission === PermissionsAndroid.RESULTS.GRANTED) {
                console.log('Permisos de lectura y escritura concedidos en Android');
            } else {
                console.log('Permisos de lectura y escritura no concedidos en Android');
            }
        } catch (err) {
            console.warn(err);
        }
    } else if (Platform.OS === 'ios') {
        try {
            const cameraStatus = await request(PERMISSIONS.IOS.CAMERA);
            const photosStatus = await request(PERMISSIONS.IOS.PHOTO_LIBRARY);

            if (cameraStatus === 'granted' && photosStatus === 'granted') {
                console.log('Permisos de cámara y fotos concedidos en iOS');
            } else {
                console.log('Permisos de cámara y fotos no concedidos en iOS');
            }
        } catch (err) {
            console.warn(err);
        }
    }
};

export const getAndIncrementConsecutivo = async (db) => {
  let next = 1;
  try {
    const { getData } = require('../database/db');
    const r = await getData(db, 'SELECT valor FROM consecutivoTramitado WHERE id = 1');
    if (r && r.length > 0) {
      next = parseInt(r[0].valor || 0, 10) + 1;
    }
    await db.executeSql('INSERT OR REPLACE INTO consecutivoTramitado (id, valor) VALUES (1, ?)', [next]);
  } catch {
    next = 1;
  }
  return next;
};
