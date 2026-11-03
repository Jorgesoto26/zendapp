-- =====================================================================
-- ZENDA - MIGRACIÓN: CORRECCIONES EN GESTIÓN DE CAJAS ADMIN
-- 1. Filtrado de cajas por fecha exacta en zona horaria America/Bogota (admin_get_cajas)
-- 2. Alerta con fecha de caja abierta existente al intentar reabrir (admin_reabrir_caja)
-- 3. Máximo 1 caja por usuario en el día: reapertura de cajas cerradas del día
--    en apertura masiva (admin_abrir_cajas_masivo) y auto-apertura (rpc_check_or_open_vendedor_caja)
-- =====================================================================

-- 1. RPC admin_get_cajas CON FILTRADO EN ZONA HORARIA LOCAL (America/Bogota)
CREATE OR REPLACE FUNCTION public.admin_get_cajas(
  p_fecha_ini date DEFAULT NULL,
  p_fecha_fin date DEFAULT NULL
)
RETURNS TABLE (
  caja_id uuid,
  usuario_id uuid,
  nombre_usuario text,
  rol_usuario text,
  estado text,
  fecha_apertura timestamptz,
  fecha_cierre timestamptz,
  saldo_inicial numeric,
  saldo_final numeric,
  valor_debido_cobrar numeric,
  valor_recaudado numeric,
  valor_ventas numeric,
  valor_gastos numeric,
  valor_ingresos numeric,
  valor_retiros numeric,
  total_clientes bigint,
  cantidad_nopagos bigint,
  progreso_visitas numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  RETURN QUERY
  WITH RECURSIVE subordinates AS (
    SELECT p.id FROM public.profiles p WHERE p.superior_id = auth.uid()
    UNION ALL
    SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id
  ),
  all_users AS (
    SELECT id FROM subordinates UNION SELECT auth.uid()
  )
  SELECT
    c.id::uuid AS caja_id,
    c.usuario_id::uuid,
    COALESCE(p.nombre, '')::text AS nombre_usuario,
    COALESCE(p.rol, '')::text AS rol_usuario,
    COALESCE(c.estado, '')::text,
    c.fecha_apertura::timestamptz,
    c.fecha_cierre::timestamptz,
    COALESCE(c.saldo_inicial, 0)::numeric,
    COALESCE(c.saldo_final, 0)::numeric,
    COALESCE((
      SELECT SUM(cu.monto) FROM public.cuotas cu
      JOIN public.invoice inv ON inv.id = cu.invoice_id
      WHERE inv.usuario_id = c.usuario_id AND cu.estado IN ('pendiente','parcial')
        AND inv.saldo > 0 AND inv.castigado = false
    ), 0)::numeric AS valor_debido_cobrar,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'pago'), 0)::numeric AS valor_recaudado,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'venta'), 0)::numeric AS valor_ventas,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'retiro' AND m.descripcion ILIKE '%gasto%'), 0)::numeric AS valor_gastos,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'ingreso'), 0)::numeric AS valor_ingresos,
    COALESCE((SELECT SUM(m.monto) FROM public.cash_movements m WHERE m.caja_id = c.id AND m.tipo = 'retiro'), 0)::numeric AS valor_retiros,
    (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false)::bigint AS total_clientes,
    COALESCE((SELECT COUNT(*) FROM public.payments pay
      JOIN public.invoice inv ON inv.id = pay.invoice_id
      WHERE inv.usuario_id = c.usuario_id AND pay.method = 'nopago'
        AND pay.payment_date = (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date), 0)::bigint AS cantidad_nopagos,
    CASE WHEN (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false) > 0
    THEN ROUND(
      (SELECT COUNT(DISTINCT pay.invoice_id)::numeric FROM public.payments pay
       JOIN public.invoice inv ON inv.id = pay.invoice_id
       WHERE inv.usuario_id = c.usuario_id AND pay.payment_date = (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date) * 100.0 /
      (SELECT COUNT(DISTINCT inv.client_id) FROM public.invoice inv WHERE inv.usuario_id = c.usuario_id AND inv.saldo > 0 AND inv.castigado = false)
    , 1)::numeric
    ELSE 0::numeric END AS progreso_visitas
  FROM public.cajas c
  JOIN public.profiles p ON p.id = c.usuario_id
  WHERE c.usuario_id IN (SELECT id FROM all_users)
    AND (p_fecha_ini IS NULL OR (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date >= p_fecha_ini)
    AND (p_fecha_fin IS NULL OR (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date <= p_fecha_fin)
  ORDER BY
    CASE WHEN c.usuario_id = auth.uid() THEN 0 ELSE 1 END,
    c.estado ASC,
    c.fecha_apertura DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_cajas(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_cajas(date, date) TO service_role;


-- 2. RPC admin_reabrir_caja CON INCLUSIÓN DE FECHA DE LA OTRA CAJA ABIERTA
CREATE OR REPLACE FUNCTION public.admin_reabrir_caja(
  p_caja_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_caja          record;
  v_otra_caja     record;
  v_user_rol      text;
  v_superior_id   uuid;
  v_padre_id      uuid;
  v_padre_abierto boolean := false;
  v_fecha_txt     text;
BEGIN
  -- Validar que quien invoca sea administrador
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo los administradores pueden reabrir cajas';
  END IF;

  -- Obtener datos de la caja
  SELECT id, usuario_id, estado, saldo_inicial, fecha_apertura
  INTO v_caja
  FROM public.cajas
  WHERE id = p_caja_id;

  IF v_caja.id IS NULL THEN
    RAISE EXCEPTION 'CAJA_NO_ENCONTRADA: La caja especificada no existe';
  END IF;

  -- Validar jerarquía: la caja debe pertenecer a su equipo
  IF NOT public.is_same_hierarchy(v_caja.usuario_id) AND v_caja.usuario_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: La caja no pertenece a un usuario de tu equipo';
  END IF;

  -- Verificar que la caja esté cerrada
  IF v_caja.estado = 'abierta' THEN
    RAISE EXCEPTION 'CAJA_YA_ABIERTA: Esta caja ya se encuentra abierta';
  END IF;

  -- Validar si la caja pertenece a un vendedor: la caja padre (del administrador) DEBE estar ABIERTA
  SELECT rol, superior_id INTO v_user_rol, v_superior_id
  FROM public.profiles
  WHERE id = v_caja.usuario_id;

  IF v_user_rol = 'vendedor' OR (v_caja.usuario_id <> auth.uid()) THEN
    v_padre_id := COALESCE(v_superior_id, auth.uid());
    SELECT EXISTS(
      SELECT 1 FROM public.cajas
      WHERE usuario_id = v_padre_id
        AND estado = 'abierta'
    ) INTO v_padre_abierto;

    IF NOT v_padre_abierto THEN
      RAISE EXCEPTION 'CAJA_PADRE_CERRADA: No se puede reabrir la caja del vendedor porque la caja padre del administrador se encuentra cerrada. Debes abrir primero la caja del administrador.';
    END IF;
  END IF;

  -- Verificar si el usuario ya tiene OTRA caja abierta actualmente y capturar su fecha
  SELECT id, fecha_apertura INTO v_otra_caja
  FROM public.cajas
  WHERE usuario_id = v_caja.usuario_id
    AND estado = 'abierta'
    AND id <> p_caja_id
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_otra_caja.id IS NOT NULL THEN
    v_fecha_txt := to_char(v_otra_caja.fecha_apertura AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH12:MI AM');
    RAISE EXCEPTION 'El usuario ya tiene otra caja abierta actualmente con fecha de apertura: %. Debe cerrarla antes de poder reabrir esta caja.', v_fecha_txt;
  END IF;

  -- Reabrir la caja
  UPDATE public.cajas
  SET estado = 'abierta',
      fecha_cierre = NULL,
      saldo_final = NULL
  WHERE id = p_caja_id;

  RETURN json_build_object(
    'success', true,
    'caja_id', p_caja_id,
    'usuario_id', v_caja.usuario_id,
    'estado', 'abierta'
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_reabrir_caja(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reabrir_caja(uuid) TO service_role;


-- 3. RPC admin_abrir_cajas_masivo: 1 CAJA POR USUARIO EN EL DÍA (REAPERTURA SI YA EXISTE CERRADA HOY)
CREATE OR REPLACE FUNCTION public.admin_abrir_cajas_masivo()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id                  uuid := auth.uid();
  v_count                     integer := 0;
  v_vendedores_abiertas       integer := 0;
  v_vendedores_reabiertas     integer := 0;
  v_user_id                   uuid;
  v_last_saldo                numeric;
  v_admin_cajas_abiertas      integer := 0;
  v_admin_caja_id             uuid := NULL;
  v_admin_reutilizada         boolean := false;
  v_admin_reabierta           boolean := false;
  v_hoy_local                 date;
  v_admin_caja_hoy            RECORD;
  v_user_caja_hoy             RECORD;
BEGIN
  -- Validar que el usuario sea administrador
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden ejecutar la apertura masiva.';
  END IF;

  v_hoy_local := (now() AT TIME ZONE 'America/Bogota')::date;

  -- 1. Buscar si el administrador tiene una caja para hoy (abierta o cerrada)
  SELECT c.id, c.estado INTO v_admin_caja_hoy
  FROM public.cajas c
  WHERE c.usuario_id = v_admin_id
    AND (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date = v_hoy_local
  ORDER BY c.fecha_apertura DESC
  LIMIT 1;

  IF v_admin_caja_hoy.id IS NOT NULL THEN
    IF v_admin_caja_hoy.estado = 'abierta' THEN
      v_admin_caja_id := v_admin_caja_hoy.id;
      v_admin_reutilizada := true;
    ELSE
      -- REABRIR la caja cerrada de hoy del admin (garantiza máximo 1 caja por día)
      UPDATE public.cajas
      SET estado = 'abierta',
          fecha_cierre = NULL,
          saldo_final = NULL
      WHERE id = v_admin_caja_hoy.id;

      v_admin_caja_id := v_admin_caja_hoy.id;
      v_admin_reabierta := true;
      v_count := v_count + 1;
    END IF;
  ELSE
    -- Validar límite de hasta 3 cajas abiertas para el admin
    SELECT COUNT(*)
    INTO v_admin_cajas_abiertas
    FROM public.cajas
    WHERE usuario_id = v_admin_id AND estado = 'abierta';

    IF v_admin_cajas_abiertas >= 3 THEN
      RAISE EXCEPTION 'Tienes 3 cajas abiertas al mismo tiempo. Debes cerrar al menos una de tus cajas anteriores antes de realizar una nueva apertura.';
    END IF;

    -- Obtener saldo anterior del admin (arrastre de saldo)
    SELECT COALESCE(c.saldo_final, c.saldo_inicial, 0)
    INTO v_last_saldo
    FROM public.cajas c
    WHERE c.usuario_id = v_admin_id
    ORDER BY c.fecha_apertura DESC
    LIMIT 1;

    v_last_saldo := COALESCE(v_last_saldo, 0);

    -- Crear la nueva caja del administrador para el día de hoy
    INSERT INTO public.cajas (usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura)
    VALUES (v_admin_id, 'abierta', ROUND(v_last_saldo, 2), ROUND(v_last_saldo, 2), now())
    RETURNING id INTO v_admin_caja_id;

    v_count := v_count + 1;
  END IF;

  -- 2. Vincular cajas abiertas de subordinados a esta caja de administrador
  UPDATE public.cajas c
  SET admin_caja_id = v_admin_caja_id
  WHERE c.estado = 'abierta'
    AND (c.admin_caja_id IS NULL OR c.admin_caja_id <> v_admin_caja_id)
    AND c.usuario_id IN (
      WITH RECURSIVE subordinates AS (
        SELECT p.id FROM public.profiles p WHERE p.superior_id = v_admin_id AND p.activo = true
        UNION ALL
        SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id WHERE p.activo = true
      )
      SELECT id FROM subordinates
    );

  -- 3. Para cada vendedor subordinado activo: solo 1 caja en el día
  FOR v_user_id IN
    WITH RECURSIVE subordinates AS (
      SELECT p.id FROM public.profiles p WHERE p.superior_id = v_admin_id AND p.activo = true
      UNION ALL
      SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id WHERE p.activo = true
    )
    SELECT id FROM subordinates
  LOOP
    -- Buscar si el vendedor ya tiene una caja para hoy (abierta o cerrada)
    SELECT c.id, c.estado INTO v_user_caja_hoy
    FROM public.cajas c
    WHERE c.usuario_id = v_user_id
      AND (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date = v_hoy_local
    ORDER BY c.fecha_apertura DESC
    LIMIT 1;

    IF v_user_caja_hoy.id IS NOT NULL THEN
      IF v_user_caja_hoy.estado = 'cerrada' THEN
        -- Si hoy tiene una caja cerrada, REABRIR la caja cerrada de ese día en vez de crear nueva
        UPDATE public.cajas
        SET estado = 'abierta',
            fecha_cierre = NULL,
            saldo_final = NULL,
            admin_caja_id = v_admin_caja_id
        WHERE id = v_user_caja_hoy.id;

        v_count := v_count + 1;
        v_vendedores_reabiertas := v_vendedores_reabiertas + 1;
      ELSE
        -- Ya está abierta hoy, asegurar vinculación
        UPDATE public.cajas
        SET admin_caja_id = v_admin_caja_id
        WHERE id = v_user_caja_hoy.id AND (admin_caja_id IS NULL OR admin_caja_id <> v_admin_caja_id);
      END IF;
    ELSE
      -- No tiene caja hoy. Validar que no tenga otra caja abierta de otro día antes de crear nueva
      IF NOT EXISTS (SELECT 1 FROM public.cajas WHERE usuario_id = v_user_id AND estado = 'abierta') THEN
        -- Arrastre de saldo de la última caja
        SELECT COALESCE(c.saldo_final, c.saldo_inicial, 0)
        INTO v_last_saldo
        FROM public.cajas c
        WHERE c.usuario_id = v_user_id
        ORDER BY c.fecha_apertura DESC
        LIMIT 1;

        v_last_saldo := COALESCE(v_last_saldo, 0);

        INSERT INTO public.cajas (usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, admin_caja_id)
        VALUES (v_user_id, 'abierta', ROUND(v_last_saldo, 2), ROUND(v_last_saldo, 2), now(), v_admin_caja_id);

        v_count := v_count + 1;
        v_vendedores_abiertas := v_vendedores_abiertas + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'cajas_abiertas', v_count,
    'vendedores_cajas_abiertas', v_vendedores_abiertas,
    'vendedores_cajas_reabiertas', v_vendedores_reabiertas,
    'admin_caja_reutilizada', v_admin_reutilizada,
    'admin_caja_reabierta', v_admin_reabierta,
    'admin_caja_id', v_admin_caja_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo() TO service_role;


-- 4. RPC rpc_check_or_open_vendedor_caja: 1 CAJA POR VENDEDOR EN EL DÍA
CREATE OR REPLACE FUNCTION public.rpc_check_or_open_vendedor_caja(
  p_vendedor_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_modo             text;
  v_caja_abierta     RECORD;
  v_caja_hoy         RECORD;
  v_ultima_caja      RECORD;
  v_nueva_caja_id    uuid;
  v_saldo_inicial    numeric := 0;
  v_max_caja         numeric;
  v_hoy_local        date;
BEGIN
  -- Calcular fecha de hoy en zona horaria de negocio (America/Bogota)
  v_hoy_local := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;

  -- Obtener modo de apertura del perfil
  SELECT COALESCE(p.modo_apertura_caja, 'admin_masivo'), p.dinero_max_caja
  INTO v_modo, v_max_caja
  FROM public.profiles p
  WHERE p.id = p_vendedor_id;

  -- 1. Buscar si ya existe una caja de hoy (abierta o cerrada) para el vendedor
  SELECT * INTO v_caja_hoy
  FROM public.cajas
  WHERE usuario_id = p_vendedor_id
    AND (fecha_apertura AT TIME ZONE 'America/Bogota')::date = v_hoy_local
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_caja_hoy.id IS NOT NULL THEN
    IF v_caja_hoy.estado = 'abierta' THEN
      RETURN json_build_object(
        'success', true,
        'caja', row_to_json(v_caja_hoy),
        'ya_abierta', true,
        'modo', v_modo
      );
    ELSE
      -- Si hoy ya tenía una caja pero fue cerrada, reabrirla para garantizar que solo tenga una caja en el día
      UPDATE public.cajas
      SET estado = 'abierta',
          fecha_cierre = NULL,
          saldo_final = NULL
      WHERE id = v_caja_hoy.id;

      SELECT * INTO v_caja_abierta FROM public.cajas WHERE id = v_caja_hoy.id;

      RETURN json_build_object(
        'success', true,
        'caja', row_to_json(v_caja_abierta),
        'reabierta_dia', true,
        'saldo_inicial', v_caja_abierta.saldo_inicial,
        'modo', v_modo
      );
    END IF;
  END IF;

  -- 2. Si no tiene caja hoy pero tiene una caja abierta de días anteriores
  SELECT * INTO v_caja_abierta
  FROM public.cajas
  WHERE usuario_id = p_vendedor_id AND estado = 'abierta'
  ORDER BY fecha_apertura DESC
  LIMIT 1;

  IF v_caja_abierta.id IS NOT NULL THEN
    RETURN json_build_object(
      'success', true,
      'caja', row_to_json(v_caja_abierta),
      'ya_abierta', true,
      'modo', v_modo
    );
  END IF;

  -- Si el modo es apertura masiva por admin, no permitir auto-apertura
  IF v_modo <> 'vendedor_dia' THEN
    RETURN json_build_object(
      'success', false,
      'requiere_admin', true,
      'message', 'El administrador debe abrir tu caja para iniciar la jornada.'
    );
  END IF;

  -- Modo B activo: obtener saldo final de la última caja cerrada para continuidad contable
  SELECT saldo_final INTO v_ultima_caja
  FROM public.cajas
  WHERE usuario_id = p_vendedor_id AND estado = 'cerrada'
  ORDER BY fecha_cierre DESC NULLS LAST, fecha_apertura DESC
  LIMIT 1;

  IF v_ultima_caja.saldo_final IS NOT NULL AND v_ultima_caja.saldo_final > 0 THEN
    v_saldo_inicial := v_ultima_caja.saldo_final;
  ELSE
    v_saldo_inicial := 0;
  END IF;

  IF v_max_caja IS NOT NULL AND v_max_caja > 0 AND v_saldo_inicial > v_max_caja THEN
    v_saldo_inicial := v_max_caja;
  END IF;

  INSERT INTO public.cajas (
    usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha
  ) VALUES (
    p_vendedor_id, 'abierta', v_saldo_inicial, v_saldo_inicial, now(), now()::date::text
  )
  RETURNING id INTO v_nueva_caja_id;

  SELECT * INTO v_caja_abierta FROM public.cajas WHERE id = v_nueva_caja_id;

  RETURN json_build_object(
    'success', true,
    'caja', row_to_json(v_caja_abierta),
    'auto_abierta', true,
    'saldo_inicial', v_saldo_inicial,
    'modo', v_modo
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.rpc_check_or_open_vendedor_caja(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_check_or_open_vendedor_caja(uuid) TO service_role;

