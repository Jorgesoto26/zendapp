import { updateData, insertOrReplaceData, getDbConnection, getData, insertTables } from "../database/db";
import { supabase } from "../lib/supabase";

export const AuthService = async (db, email, password) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { success: false, message: error.message || 'Usuario o contraseña incorrectos' };
    }
    console.log('Hay Session,', data);
    

    const { access_token } = data.session;
    const userId = data.user.id;

    await Promise.all([
      updateData(db, 'parametrizacion', { id: 2, valor: access_token }),
      updateData(db, 'parametrizacion', { id: 5, valor: userId })
    ]);

    const response = await fetch(
      'https://gwpwntdwogxzmtegaaom.supabase.co/functions/v1/get-user-profile',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`
        },
        body: JSON.stringify({ id: userId })
      }
    );

    if (!response.ok) {
      const errorResult = await response.json();
      return { success: false, message: errorResult.error || 'Error al obtener el perfil' };
    }

    const result = await response.json();
    const { profile, concepts, caja, movimientos } = result;

    await Promise.all([
      updateData(db, 'parametrizacion', { id: 6, valor: profile.rol }),
      updateData(db, 'parametrizacion', { id: 7, valor: profile.nombre }),
      updateData(db, 'parametrizacion', { id: 8, valor: profile.superior_id })
    ]);

    await Promise.all([
      insertOrReplaceData(db, 'concepts', concepts),
      insertOrReplaceData(db, 'cajas', [caja]),
      insertOrReplaceData(db, 'movimientos', movimientos)
    ]);

    const invoices = await getInvoice(userId, access_token);

    console.log('Invoiceee', invoices);


    return { success: true, user: data.user };

  } catch (error) {
    console.error('Error en login:', error);
    return { success: false, message: error.message || 'Error desconocido' };
  }
};

export const getInvoice = async (userId, access_token) => {
  console.log('argumentos', userId, access_token);

  const response = await fetch(
    'https://gwpwntdwogxzmtegaaom.supabase.co/functions/v1/RequestInvoce',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`
      },
      body: JSON.stringify({ vendedorId: userId })
    }
  );

  console.log('Estado:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error al obtener facturas: ${response.status} - ${errorText}`);
  }

  // 👇 Aquí realmente lees los datos del cuerpo
  const result = await response.json();

  console.log('📦 Datos recibidos:', result);

  // result.data contiene las facturas enviadas desde tu función Edge
  const saveSuccess = await saveInvoice(result.data);
  return saveSuccess;
};


const saveInvoice = async (invoices) => {
  const db = await getDbConnection();

  // 🔹 Obtener facturas ya tramitadas
  const facturasTramitadas = await getData(db, `
    SELECT pago_factura_venta_id, nopago_factura_venta_id 
    FROM detallescaja
  `);

  const facturasIds = facturasTramitadas
    .flatMap(f => [f.pago_factura_venta_id, f.nopago_factura_venta_id])
    .filter(id => id !== null)
    .map(id => String(id));

  console.log("Facturas procesadas anteriormente:", facturasIds);

  let tableContent = [];
  let date = '2000-01-01';

  // 🔹 Recorremos las facturas recibidas
  invoices.forEach(element => {
    let status = 'pendiente';
    if (facturasIds.includes(String(element.id))) {
      status = 'actualizado';
    }

    if (date < element.fecha) {
      date = element.fecha;
    }

    // 🔸 Adaptar a la estructura local
    let infoInvoice = {
      id: element.id,
      apellidoUno: element.apellidoCliente || null,
      apellidoDos: null,
      celular: element.telefonocliente || null,
      cuotasPagas: element.cuotasPagas || 0,
      cuotasVencidas: element.cuotasVencidas || 0,
      detalles: element.detalles ? [element.detalles] : [],
      direccion: element.direccion || null,
      barrio: null,
      estado: element.estado || "pendiente",
      estadoUsuario: element.estadoUsuario || null,
      facturaWriteDate: element.facturaWriteDate || null,
      latitud: element.latitud || null,
      longitud: element.longitud || null,
      nombreUno: element.nombreCliente || null,
      renovado: "false",
      nombreUsuario: element.nombreUsuario || null,
      pagos: element.pagos ? JSON.parse(element.pagos) : [],
      partnerId: element.partnerId || null,
      paymentTermId: element.paymentTermId || null,
      saldo: element.saldo || 0,
      saldoVencido: element.saldoVencido || 0,
      usuarioId: element.usuarioId || null,
      valorCuota: element.valorCuota || 0,
      valorInicial: element.valorInicial || 0,
      estadoMovil: status,
      fecha_vencimiento: element.fecha_vencimiento || null,
      fecha: element.fecha || null,
      alias: element.aliasCliente || null,
      documento: element.documentoCliente || null,
      num_cuotas: element.num_cuotas || null,
      ultimo_pago: element.pagos?.length ? element.pagos[element.pagos.length - 1]?.payment_date : null,
      consecutivoTramitado: 0 // 🔹 Se llenará luego
    };

    tableContent.push(infoInvoice);
  });

  try {
    // 🔹 Obtener facturas existentes en la base local
    const existingFacturas = await getData(db, `SELECT id FROM facturas`);
    const existingFacturasMap = new Map(existingFacturas.map(f => [f.id, true]));

    let facturasToInsert = [];
    let facturasToUpdate = [];

    // 🔸 Dividir en insert y update
    for (const invoice of tableContent) {
      if (existingFacturasMap.has(invoice.id)) {
        facturasToUpdate.push(invoice);
      } else {
        facturasToInsert.push(invoice);
      }
    }

    // 🔹 Insertar nuevas
    if (facturasToInsert.length > 0) {
      await insertTables(db, "facturas", facturasToInsert);
      console.log(`✅ Se insertaron ${facturasToInsert.length} facturas nuevas.`);
    }

    // 🔹 Actualizar existentes
    if (facturasToUpdate.length > 0) {
      for (const factura of facturasToUpdate) {
        await updateData(db, "facturas", factura);
      }
      console.log(`♻️ Se actualizaron ${facturasToUpdate.length} facturas existentes.`);
    }

    // 🔹 Actualizar consecutivos
    const secuenciaTramitado = await getData(db, `SELECT * FROM consecutivoTramitado`);
    const maxSecuenciaPago = Math.max(...tableContent.map(item => item.consecutivoTramitado));
    const valorTramitado = secuenciaTramitado[0]?.valor ?? 0;
    const secuencia = valorTramitado > maxSecuenciaPago ? valorTramitado : maxSecuenciaPago;

    await updateData(db, 'consecutivoTramitado', { valor: secuencia, id: 1 });
    await updateData(db, 'writeDate', { valor: date, id: "1" });

    return true;

  } catch (error) {
    console.error("❌ Error en saveInvoice:", error);
    return false;
  }
};


export const registerMovement = async ({ cajaId, tipo, descripcion, monto }) => {
  try {
    const { data, error } = await supabase
      .from('cash_movements')
      .insert([
        {
          caja_id: cajaId,
          tipo, // 'ingreso' o 'egreso'
          descripcion,
          monto,
        }
      ]);

    if (error) {
      console.error('Error al registrar movimiento:', error.message);
      throw error;
    }

    return data;
  } catch (error) {
    console.error("Error inesperado:", error);
    return null;
  }
}


export const openBox = async ({ usuarioId, montoInicial }) => {
  const { data, error } = await supabase
    .from('cajas')
    .insert([
      {
        usuario_id: usuarioId,
        monto_inicial: montoInicial,
        estado: 'abierta',
      }
    ])
    .select()
    .single(); // para devolver solo un objeto, no un array

  if (error) {
    console.error('Error al abrir caja:', error.message);
    throw error;
  }

  return data; // contiene el registro recién creado, incluido el ID de la caja
};

export const closeBox = async (cajaId) => {
  // 1. Sumar todos los movimientos para calcular el monto final
  const { data: movimientos, error: movimientosError } = await supabase
    .from('cash_movements')
    .select('monto')
    .eq('caja_id', cajaId);

  if (movimientosError) {
    console.error('Error al obtener movimientos:', movimientosError.message);
    throw movimientosError;
  }

  const montoFinal = movimientos.reduce((total, mov) => total + mov.monto, 0);

  // 2. Actualizar caja
  const { data, error } = await supabase
    .from('cajas')
    .update({
      estado: 'cerrada',
      fecha_cierre: new Date().toISOString(),
      monto_final: montoFinal,
    })
    .eq('id', cajaId)
    .select()
    .single();

  if (error) {
    console.error('Error al cerrar caja:', error.message);
    throw error;
  }

  return data;
};


/* export const createClientInvoice = async ({ name, email, monto }) => {
  try {
    // Paso 1: Crear cliente
    const { data: cliente, error: errorCliente } = await supabase
      .from('clients')
      .insert([{ name, email }])
      .select()
      .single();

    if (errorCliente) throw errorCliente;

    // Paso 2: Crear factura relacionada
    const { error: errorFactura } = await supabase
      .from('invoice')
      .insert([{
        client_id: cliente.id,
        amount: monto
      }]);

    if (errorFactura) throw errorFactura;

    console.log('Cliente y factura creados con éxito');
  } catch (error) {
    console.error('Error:', error.message);
  }
}; */

export const createClientInvoice = async () => {

};


export const createPay = async ({ name, email, monto }) => {
  try {
    // 1. Crear cliente
    const { data: cliente, error: errorCliente } = await supabase
      .from('clients')
      .insert([{ name, email }])
      .select()
      .single();
    if (errorCliente) throw errorCliente;

    // 2. Crear factura
    const { data: factura, error: errorFactura } = await supabase
      .from('invoice')
      .insert([{ client_id: cliente.id, amount: parseFloat(monto) }])
      .select()
      .single();
    if (errorFactura) throw errorFactura;

    // 3. Obtener caja abierta
    const { data: cajaAbierta, error: errorCaja } = await supabase
      .from('cash_register')
      .select('*')
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .single();
    if (errorCaja || !cajaAbierta) throw new Error('No hay caja abierta');

    // 4. Obtener último movimiento de caja
    const { data: movimiento, error: errorMov } = await supabase
      .from('cash_movements')
      .select('*')
      .eq('cash_register_id', cajaAbierta.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (errorMov || !movimiento) throw new Error('No hay movimiento de caja activo');

    // 5. Crear pago
    const { error: errorPago } = await supabase
      .from('payments')
      .insert([{
        client_id: cliente.id,
        invoice_id: factura.id,
        cash_register_id: cajaAbierta.id,
        cash_movement_id: movimiento.id,
        amount: parseFloat(monto)
      }]);
    if (errorPago) throw errorPago;

    return { success: true };
  } catch (error) {
    console.error('Error creando cliente, factura y pago:', error.message);
    return { success: false, error: error.message };
  }
};
