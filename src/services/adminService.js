// src/services/adminService.js
import { supabase, ensureAuthenticatedSession } from '../lib/supabase';
import { getDbConnection } from '../database/db';

/**
 * Obtiene la lista de usuarios subordinados (vendedores y administradores)
 */
export const getSubordinates = async () => {
  await ensureAuthenticatedSession();
  const { data, error } = await supabase.rpc('admin_get_subordinates');
  if (error) throw new Error(error.message || 'Error al obtener usuarios');
  return data || [];
};

/**
 * Crea un nuevo usuario en auth + profile
 */
export const createAdminUser = async (userData) => {
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
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
    console.warn('admin_update_user: la función desplegada no tiene p_password. Reintentando sin contraseña...');
    delete rpcParams.p_password;
    const retry = await supabase.rpc('admin_update_user', rpcParams);
    if (!retry.error) {
      throw new Error('Los datos se actualizaron correctamente, pero cambiar la contraseña requiere aplicar la migración SQL en Supabase.');
    }
    error = retry.error;
  }

  // Fallback si la función RPC remota falla por la columna updated_at inexistente en profiles
  if (error && error.message && error.message.includes('updated_at')) {
    console.warn('admin_update_user: RPC falló por updated_at inexistente en profiles. Aplicando actualización directa con RLS...');
    const directPayload = {
      nombre,
      apellido,
    };
    if (dinero_max_caja !== undefined && dinero_max_caja !== null) directPayload.dinero_max_caja = parseFloat(dinero_max_caja);
    if (dinero_max_venta !== undefined && dinero_max_venta !== null) directPayload.dinero_max_venta = parseFloat(dinero_max_venta);
    if (dinero_max_gasto !== undefined && dinero_max_gasto !== null) directPayload.dinero_max_gasto = parseFloat(dinero_max_gasto);
    if (max_cuotas !== undefined && max_cuotas !== null) directPayload.max_cuotas = parseInt(max_cuotas, 10);
    if (permite_borrar_venta !== undefined && permite_borrar_venta !== null) directPayload.permite_borrar_venta = !!permite_borrar_venta;
    if (permite_modificar_pagos !== undefined && permite_modificar_pagos !== null) directPayload.permite_modificar_pagos = !!permite_modificar_pagos;

    const { error: directErr } = await supabase
      .from('profiles')
      .update(directPayload)
      .eq('id', userId);

    if (!directErr) {
      return { success: true, user_id: userId };
    }
    error = directErr;
  }

  if (error) throw new Error(error.message || 'Error al actualizar usuario');
  return data;
};

/**
 * Habilita o inhabilita un usuario subordinado
 */
export const toggleAdminUser = async (userId) => {
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
  const { data, error } = await supabase.rpc('admin_get_cartera_summary');
  if (error) throw new Error(error.message || 'Error al obtener cartera');
  return data || [];
};

/**
 * Obtiene el detalle de créditos y clientes de un vendedor específico
 */
export const getCarteraDetail = async (userId) => {
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
  const { data, error } = await supabase.rpc('admin_abrir_cajas_masivo');
  if (error) throw new Error(error.message || 'Error al abrir cajas');
  return data;
};

/**
 * Obtiene los top clientes morosos
 */
export const getAdminMorosos = async (limit = 50) => {
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
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
  await ensureAuthenticatedSession();
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
/**
 * Obtiene la configuración de la organización (logo, nombre, nit, modo de apertura)
 */
export const getAdminOrganizacion = async () => {
  await ensureAuthenticatedSession();
  try {
    const { data, error } = await supabase.rpc('admin_get_organizacion');
    if (!error && data) return data;
  } catch (e) {
    console.log('admin_get_organizacion RPC fallback:', e);
  }

  // Fallback directo a tabla organizaciones
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { data: org } = await supabase
        .from('organizaciones')
        .select('*')
        .eq('admin_id', user.id)
        .maybeSingle();
      if (org) return org;
    }
  } catch {}

  return {
    nombre: 'ZENDA',
    nit: '',
    telefono: '',
    direccion: '',
    logo_path: null,
    modo_apertura_caja: 'admin_masivo',
  };
};

/**
 * Actualiza los datos de la organización, logo y modo de apertura de caja
 */
export const updateAdminOrganizacion = async ({
  nombre,
  nit = '',
  telefono = '',
  direccion = '',
  logoPath = null,
  modoApertura = 'admin_masivo',
}) => {
  await ensureAuthenticatedSession();
  const { data, error } = await supabase.rpc('admin_update_organizacion', {
    p_nombre: nombre,
    p_nit: nit,
    p_telefono: telefono,
    p_direccion: direccion,
    p_logo_path: logoPath,
    p_modo_apertura: modoApertura,
  });

  if (error) throw new Error(error.message || 'Error al actualizar organización');
  return data;
};

export const trasladarCartera = async (vendedorOrigenId, vendedorDestinoId) => {
  await ensureAuthenticatedSession();
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

/**
 * Obtiene la lista de cajas de vendedores subordinados que están actualmente abiertas
 */
export const getSubordinateOpenCajas = async (adminId) => {
  await ensureAuthenticatedSession();
  try {
    let targetAdminId = adminId;
    if (!targetAdminId) {
      const { data: { user } } = await supabase.auth.getUser();
      targetAdminId = user?.id;
    }
    if (!targetAdminId) return [];

    const { data, error } = await supabase
      .from('cajas')
      .select(`
        id,
        usuario_id,
        estado,
        saldo_inicial,
        saldo_final,
        fecha_apertura,
        profiles:usuario_id (
          id,
          nombre,
          apellido,
          rol,
          superior_id
        )
      `)
      .eq('estado', 'abierta');

    if (error) {
      console.log('Error consultando cajas abiertas de subordinados:', error);
      return [];
    }

    const openSubordinates = (data || []).filter(c => {
      const prof = c.profiles;
      return prof && prof.superior_id === targetAdminId && prof.rol === 'vendedor';
    });

    return openSubordinates.map(c => ({
      caja_id: c.id,
      id: c.id,
      usuario_id: c.usuario_id,
      nombre_usuario: `${c.profiles?.nombre || ''} ${c.profiles?.apellido || ''}`.trim() || 'Vendedor',
      rol_usuario: c.profiles?.rol || 'vendedor',
      saldo_inicial: c.saldo_inicial || 0,
      saldo_final: c.saldo_final || 0,
      fecha_apertura: c.fecha_apertura,
      estado: c.estado,
    }));
  } catch (e) {
    console.log('Error en getSubordinateOpenCajas:', e);
    return [];
  }
};


/**
 * Reabre una caja cerrada (Solo Administrador)
 */
export const reabrirCajaAdmin = async (cajaId) => {
  const session = await ensureAuthenticatedSession();
  const currentAdminId = session?.user?.id;

  // 1. Obtener la caja y verificar existencia y estado
  const { data: currentBox, error: boxErr } = await supabase
    .from('cajas')
    .select('id, usuario_id, estado, fecha_apertura')
    .eq('id', cajaId)
    .maybeSingle();

  if (boxErr || !currentBox) throw new Error('La caja especificada no existe');
  if (currentBox.estado === 'abierta') throw new Error('Esta caja ya se encuentra abierta');

  // 2. Si la caja pertenece a un vendedor, validar que la CAJA PADRE del administrador esté ABIERTA
  if (currentBox.usuario_id && currentBox.usuario_id !== currentAdminId) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('superior_id, rol, nombre')
      .eq('id', currentBox.usuario_id)
      .maybeSingle();

    const padreId = prof?.superior_id || currentAdminId;
    const { data: padreOpen } = await supabase
      .from('cajas')
      .select('id')
      .eq('usuario_id', padreId)
      .eq('estado', 'abierta')
      .limit(1)
      .maybeSingle();

    if (!padreOpen) {
      throw new Error(
        'No se puede reabrir la caja del vendedor porque la caja principal (caja padre del administrador) se encuentra cerrada. Debes abrir primero la caja del administrador.'
      );
    }
  }

  // 3. Validar que el usuario no tenga ya otra caja abierta actualmente
  const { data: openOther } = await supabase
    .from('cajas')
    .select('id')
    .eq('usuario_id', currentBox.usuario_id)
    .eq('estado', 'abierta')
    .neq('id', cajaId)
    .limit(1)
    .maybeSingle();

  if (openOther) {
    throw new Error('El usuario ya tiene otra caja abierta actualmente. Debe cerrarla antes de reabrir esta.');
  }

  // 4. Invocar RPC en Supabase
  let { data, error } = await supabase.rpc('admin_reabrir_caja', {
    p_caja_id: cajaId,
  });

  // Fallback si la función RPC aún no está en cache o migración
  if (error && (error.code === 'PGRST202' || (error.message && error.message.includes('schema cache')))) {
    console.warn('admin_reabrir_caja RPC no encontrada, aplicando reapertura directa con RLS...');
    const { error: updErr } = await supabase
      .from('cajas')
      .update({ estado: 'abierta', fecha_cierre: null, saldo_final: null })
      .eq('id', cajaId);

    if (updErr) throw new Error(updErr.message || 'Error al reabrir la caja');
    data = { success: true, caja_id: cajaId, estado: 'abierta' };
    error = null;
  }

  if (error) throw new Error(error.message || 'Error al reabrir la caja');

  // Actualizar SQLite local si la caja existe localmente
  try {
    const db = await getDbConnection();
    await db.executeSql(
      `UPDATE cajas SET estado = 'abierta', fecha_cierre = NULL, saldo_final = NULL WHERE id = ?`,
      [String(cajaId)]
    );
  } catch (eSql) {
    console.log('Error actualizando reapertura en SQLite:', eSql);
  }

  return data;
};
