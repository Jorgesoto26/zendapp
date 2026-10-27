-- =====================================================================
-- ZENDA - MIGRACIÓN: Reglas de Cajas de Administrador y Edición de Usuarios
-- 1. Límite independiente de hasta 3 cajas abiertas por administrador.
-- 2. Apertura masiva: si el admin ya tiene caja abierta para hoy, se reutiliza
--    sin crear una caja duplicada ni consumir el límite de 3.
--    Si no tiene caja hoy y ya tiene 3 abiertas, bloquea con excepción clara.
-- 3. Edición de usuarios (admin_update_user): unificación de función y eliminación
--    de sobrecargas conflictivas en schema cache de PostgREST.
-- =====================================================================

-- =====================================================================
-- 1. APERTURA MASIVA DE CAJAS (RPC admin_abrir_cajas_masivo)
-- =====================================================================
DROP FUNCTION IF EXISTS public.admin_abrir_cajas_masivo(numeric);
DROP FUNCTION IF EXISTS public.admin_abrir_cajas_masivo();

CREATE OR REPLACE FUNCTION public.admin_abrir_cajas_masivo()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id              uuid := auth.uid();
  v_count                 integer := 0;
  v_vendedores_abiertas   integer := 0;
  v_user_id               uuid;
  v_last_saldo            numeric;
  v_admin_cajas_abiertas  integer := 0;
  v_admin_caja_id         uuid := NULL;
  v_admin_reutilizada     boolean := false;
BEGIN
  -- Validar que el usuario sea administrador
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Solo administradores pueden ejecutar la apertura masiva.';
  END IF;

  -- 1. Buscar si el administrador autenticado YA tiene una caja abierta para hoy
  -- Se valida tanto fecha local (Bogotá UTC-5) como fecha UTC para máxima robustez
  SELECT c.id INTO v_admin_caja_id
  FROM public.cajas c
  WHERE c.usuario_id = v_admin_id
    AND c.estado = 'abierta'
    AND (
      c.fecha_apertura::date = CURRENT_DATE 
      OR (c.fecha_apertura AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date
    )
  ORDER BY c.fecha_apertura DESC
  LIMIT 1;

  IF v_admin_caja_id IS NOT NULL THEN
    -- Regla 4 y 9: Reutilizar la caja de hoy sin crear otra ni consumir el cupo de 3
    v_admin_reutilizada := true;
  ELSE
    -- 2. Si NO tiene caja abierta para hoy, validar límite individual de 3 cajas abiertas
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

    IF v_last_saldo IS NULL THEN
      v_last_saldo := 0;
    END IF;

    -- Crear la nueva caja del administrador para el día de hoy
    INSERT INTO public.cajas (usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura)
    VALUES (v_admin_id, 'abierta', ROUND(v_last_saldo, 2), ROUND(v_last_saldo, 2), now())
    RETURNING id INTO v_admin_caja_id;

    v_count := v_count + 1;
  END IF;

  -- 3. Abrir cajas para los vendedores subordinados activos que NO tengan caja abierta
  FOR v_user_id IN
    WITH RECURSIVE subordinates AS (
      SELECT p.id FROM public.profiles p WHERE p.superior_id = v_admin_id AND p.activo = true
      UNION ALL
      SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id WHERE p.activo = true
    )
    SELECT id FROM subordinates
    WHERE id NOT IN (SELECT usuario_id FROM public.cajas WHERE estado = 'abierta')
  LOOP
    SELECT COALESCE(c.saldo_final, c.saldo_inicial, 0)
    INTO v_last_saldo
    FROM public.cajas c
    WHERE c.usuario_id = v_user_id
    ORDER BY c.fecha_apertura DESC
    LIMIT 1;

    IF v_last_saldo IS NULL THEN
      v_last_saldo := 0;
    END IF;

    INSERT INTO public.cajas (usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura)
    VALUES (v_user_id, 'abierta', ROUND(v_last_saldo, 2), ROUND(v_last_saldo, 2), now());

    v_count := v_count + 1;
    v_vendedores_abiertas := v_vendedores_abiertas + 1;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'cajas_abiertas', v_count,
    'vendedores_cajas_abiertas', v_vendedores_abiertas,
    'admin_caja_reutilizada', v_admin_reutilizada,
    'admin_caja_id', v_admin_caja_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo() TO service_role;

-- =====================================================================
-- 2. FUNCIÓN RPC PARA CONTEO DE CAJAS ABIERTAS DEL ADMINISTRADOR AUTENTICADO
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_get_open_cajas_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.cajas
  WHERE usuario_id = auth.uid() AND estado = 'abierta';
  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_open_cajas_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_open_cajas_count() TO service_role;

-- =====================================================================
-- 3. EDICIÓN DE USUARIOS UNIFICADA (RPC admin_update_user)
-- =====================================================================
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean);
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id                 uuid,
  p_nombre                  text,
  p_apellido                text,
  p_dinero_max_caja         numeric DEFAULT NULL,
  p_dinero_max_venta        numeric DEFAULT NULL,
  p_dinero_max_gasto        numeric DEFAULT NULL,
  p_max_cuotas              integer DEFAULT NULL,
  p_permite_borrar_venta    boolean DEFAULT NULL,
  p_permite_modificar_pagos boolean DEFAULT NULL,
  p_password                text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden editar usuarios';
  END IF;

  IF NOT public.is_same_hierarchy(p_user_id) AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuario no pertenece a tu jerarquía';
  END IF;

  UPDATE public.profiles
  SET
    nombre                  = p_nombre,
    apellido                = p_apellido,
    dinero_max_caja         = COALESCE(p_dinero_max_caja, dinero_max_caja),
    dinero_max_venta        = COALESCE(p_dinero_max_venta, dinero_max_venta),
    dinero_max_gasto        = COALESCE(p_dinero_max_gasto, dinero_max_gasto),
    max_cuotas              = COALESCE(p_max_cuotas, max_cuotas),
    permite_borrar_venta    = COALESCE(p_permite_borrar_venta, permite_borrar_venta),
    permite_modificar_pagos = COALESCE(p_permite_modificar_pagos, permite_modificar_pagos),
    updated_at              = now()
  WHERE id = p_user_id;

  -- Actualizar contraseña en auth.users si se proporcionó una nueva válida
  IF p_password IS NOT NULL AND length(trim(p_password)) >= 6 THEN
    UPDATE auth.users
    SET encrypted_password = crypt(trim(p_password), gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN json_build_object('success', true, 'user_id', p_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO service_role;

-- Recargar la caché de esquemas de PostgREST
NOTIFY pgrst, 'reload schema';
