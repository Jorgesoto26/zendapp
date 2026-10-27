// src/services/adminService.js
import { supabase } from '../lib/supabase';

/**
 * Obtiene la lista de usuarios subordinados (vendedores y administradores)
 */
export const getSubordinates = async () => {
  const { data, error } = await supabase.rpc('admin_get_subordinates');
  if (error) throw new Error(error.message || 'Error al obtener usuarios');
  return data || [];
};

/**
 * Crea un nuevo usuario en auth + profile
 */
export const createAdminUser = async (userData) => {
  const {
    email,
    password,
    nombre,
    apellido,
    rol = 'vendedor',
    dinero_max_caja = 0,
    dinero_max_venta = 0,
    dinero_max_gasto = 0,
    max_cuotas = 30,
    permite_borrar_venta = false,
    permite_modificar_pagos = false,
  } = userData;

  const { data, error } = await supabase.rpc('admin_create_user', {
    p_email: email,
    p_password: password,
    p_nombre: nombre,
    p_apellido: apellido,
    p_rol: rol,
    p_dinero_max_caja: parseFloat(dinero_max_caja) || 0,
    p_dinero_max_venta: parseFloat(dinero_max_venta) || 0,
    p_dinero_max_gasto: parseFloat(dinero_max_gasto) || 0,
    p_max_cuotas: parseInt(max_cuotas, 10) || 30,
    p_permite_borrar_venta: !!permite_borrar_venta,
    p_permite_modificar_pagos: !!permite_modificar_pagos,
  });

  if (error) throw new Error(error.message || 'Error al crear usuario');
  return data;
};

/**
 * Actualiza permisos y datos de un subordinado
 */
export const updateAdminUser = async (userId, userData) => {
  const {
    nombre,
    apellido,
    dinero_max_caja,
    dinero_max_venta,
    dinero_max_gasto,
    max_cuotas,
    permite_borrar_venta,
    permite_modificar_pagos,
    password,
  } = userData;

  const hasNewPassword = Boolean(password && password.trim().length >= 6);

  // Construir parmetros base (9 parmetros estndar)
  const rpcParams = {
    p_user_id: userId,
    p_nombre: nombre,
    p_apellido: apellido,
    p_dinero_max_caja: dinero_max_caja !== undefined ? parseFloat(dinero_max_caja) : null,
    p_dinero_max_venta: dinero_max_venta !== undefined ? parseFloat(dinero_max_venta) : null,
    p_dinero_max_gasto: dinero_max_gasto !== undefined ? parseFloat(dinero_max_gasto) : null,
    p_max_cuotas: max_cuotas !== undefined ? parseInt(max_cuotas, 10) : null,
    p_permite_borrar_venta: permite_borrar_venta !== undefined ? !!permite_borrar_venta : null,
    p_permite_modificar_pagos: permite_modificar_pagos !== undefined ? !!permite_modificar_pagos : null,
  };

  // Solo incluir p_password si se ingres una nueva contrasea vlida
  if (hasNewPassword) {
    rpcParams.p_password = password.trim();
  }

  let { data, error } = await supabase.rpc('admin_update_user', rpcParams);

  // Si fall con p_password por incompatibilidad con cach de PostgREST:
  if (error && error.message && error.message.includes('schema cache') && hasNewPassword) {
    console.warn('admin_update_user: la funcin desplegada no tiene p_password. Reintentando sin contrasea...');
    delete rpcParams.p_password;
    const retry = await supabase.rpc('admin_update_user', rpcParams);
    if (!retry.error) {
      throw new Error('Los datos se actualizaron correctamente, pero cambiar la contrasea requiere aplicar la migracin SQL en Supabase.');
    }
    error = retry.error;
  }

  if (error) throw new Error(error.message || 'Error al actualizar usuario');
  return data;
};

/**
 * Habilita o inhabilita un usuario subordinado
 */
export const toggleAdminUser = async (userId) => {
  const { data, error } = await supabase.rpc('admin_toggle_user', {
    p_user_id: userId,
  });
  if (error) throw new Error(error.message || 'Error al cambiar estado de usuario');
  return data;
};

/**
 * Obtiene el resumen de cartera agrupado por vendedores
 */
export const getCarteraSummary = async () => {
  const { data, error } = await supabase.rpc('admin_get_cartera_summary');
  if (error) throw new Error(error.message || 'Error al obtener cartera');
  return data || [];
};

/**
 * Obtiene el detalle de créditos y clientes de un vendedor específico
 */
export const getCarteraDetail = async (userId) => {
  const { data, error } = await supabase.rpc('admin_get_cartera_detail', {
    p_usuario_id: userId,
  });
  if (error) throw new Error(error.message || 'Error al obtener detalle de cartera');
  return data || [];
};

/**
 * Bloquea (castiga) un crédito moroso
 */
export const castigarCartera = async (invoiceId) => {
  const { data, error } = await supabase.rpc('admin_castigar_cartera', {
    p_invoice_id: invoiceId,
  });
  if (error) throw new Error(error.message || 'Error al castigar crédito');
  return data;
};

/**
 * Obtiene la lista de cajas (con métricas calculadas)
 */
export const getAdminCajas = async (fechaIni = null, fechaFin = null) => {
  const { data, error } = await supabase.rpc('admin_get_cajas', {
    p_fecha_ini: fechaIni,
    p_fecha_fin: fechaFin,
  });
  if (error) throw new Error(error.message || 'Error al obtener cajas');
  return data || [];
};

/**
 * Apertura masiva de cajas para todos los subordinados que no tengan caja abierta.
 * El saldo inicial se calcula automáticamente del saldo final anterior o 0 si es la primera caja.
 */
export const abrirCajasMasivo = async () => {
  const { data, error } = await supabase.rpc('admin_abrir_cajas_masivo');
  if (error) throw new Error(error.message || 'Error al abrir cajas');
  return data;
};

/**
 * Obtiene los top clientes morosos
 */
export const getAdminMorosos = async (limit = 50) => {
  const { data, error } = await supabase.rpc('admin_get_morosos', {
    p_limit: limit,
  });
  if (error) throw new Error(error.message || 'Error al obtener morosos');
  return data || [];
};

/**
 * Obtiene el reporte consolidado por rango de fechas
 */
export const getReporteConsolidado = async (fechaIni, fechaFin) => {
  const { data, error } = await supabase.rpc('admin_reporte_consolidado', {
    p_fecha_ini: fechaIni,
    p_fecha_fin: fechaFin,
  });
  if (error) throw new Error(error.message || 'Error al generar reporte consolidado');
  return data || [];
};

/**
 * Obtiene los movimientos detallados de una caja
 */
export const getCajaMovements = async (cajaId) => {
  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('caja_id', cajaId)
    .order('fecha', { ascending: false });

  if (error) throw new Error(error.message || 'Error al obtener movimientos de caja');
  return data || [];
};

/**
 * Registra un movimiento en la caja del admin o subordinado (gasto, ingreso, retiro)
 */
export const createAdminCajaMovement = async ({ cajaId, tipo, descripcion, monto }) => {
  const numericMonto = parseFloat(monto) || 0;
  if (numericMonto <= 0) throw new Error('El monto debe ser mayor a cero');

  const { data, error } = await supabase.rpc('rpc_create_cash_movement', {
    p_caja_id: cajaId,
    p_tipo: tipo,
    p_descripcion: descripcion?.trim() || 'Movimiento de caja admin',
    p_monto: numericMonto,
  });

  if (error) throw new Error(error.message || 'Error al registrar movimiento');
  return data;
};

/**
 * Traslada la cartera completa de un vendedor a otro de forma atomica
 */
export const trasladarCartera = async (vendedorOrigenId, vendedorDestinoId) => {
  const { data, error } = await supabase.rpc('admin_trasladar_cartera', {
    p_vendedor_origen: vendedorOrigenId,
    p_vendedor_destino: vendedorDestinoId,
  });
  if (error) throw new Error(error.message || 'Error al trasladar la cartera');
  return data;
};


/**
 * Obtiene el conteo exacto de cajas abiertas del administrador autenticado (mximo 3 permitidas)
 */
export const getAdminOpenCajasCount = async (targetUserId = null) => {
  try {
    // 1. Intentar RPC optimizada si est disponible en Supabase
    const { data: rpcCount, error: rpcErr } = await supabase.rpc('admin_get_open_cajas_count');
    if (!rpcErr && typeof rpcCount === 'number') {
      return rpcCount;
    }
  } catch {}

  // 2. Consulta directa a tabla cajas filtrando estrictamente por el usuario administrador
  try {
    let uid = targetUserId;
    if (!uid) {
      const { data: authData } = await supabase.auth.getUser();
      uid = authData?.user?.id;
    }
    if (!uid) return 0;

    const { count, error } = await supabase
      .from('cajas')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', uid)
      .eq('estado', 'abierta');

    if (!error && count !== null) {
      return count;
    }
  } catch (e) {
    console.log('Error obteniendo conteo de cajas abiertas admin:', e);
  }
  return 0;
};
