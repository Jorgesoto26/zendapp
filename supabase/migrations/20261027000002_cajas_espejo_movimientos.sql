-- =====================================================================
-- ZENDA - MIGRACIÓN: Asociación Caja Vendedor a Caja Admin y Movimiento Espejo
-- Fecha: 2026-10-27
-- 1. Agregar columna admin_caja_id a la tabla cajas
-- 2. Actualizar admin_abrir_cajas_masivo para vincular vendedores a la caja del admin
-- 3. Actualizar rpc_create_cash_movement para generar movimientos espejo automáticos
--    (Retiro en vendedor -> Ingreso en admin, Ingreso en vendedor -> Retiro en admin)
-- =====================================================================

-- 1. COLUMNA admin_caja_id EN CAJAS
ALTER TABLE public.cajas 
ADD COLUMN IF NOT EXISTS admin_caja_id UUID REFERENCES public.cajas(id);

CREATE INDEX IF NOT EXISTS idx_cajas_admin_caja_id 
ON public.cajas(admin_caja_id);

-- 2. APERTURA MASIVA: ASOCIAR CAJAS DE VENDEDORES A LA CAJA DEL ADMIN
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
    v_admin_reutilizada := true;
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

    IF v_last_saldo IS NULL THEN
      v_last_saldo := 0;
    END IF;

    -- Crear la nueva caja del administrador para el día de hoy
    INSERT INTO public.cajas (usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura)
    VALUES (v_admin_id, 'abierta', ROUND(v_last_saldo, 2), ROUND(v_last_saldo, 2), now())
    RETURNING id INTO v_admin_caja_id;

    v_count := v_count + 1;
  END IF;

  -- 2. Vincular cajas abiertas de subordinados que estuvieran sin admin_caja_id a esta caja
  UPDATE public.cajas c
  SET admin_caja_id = v_admin_caja_id
  WHERE c.estado = 'abierta'
    AND c.admin_caja_id IS NULL
    AND c.usuario_id IN (
      WITH RECURSIVE subordinates AS (
        SELECT p.id FROM public.profiles p WHERE p.superior_id = v_admin_id AND p.activo = true
        UNION ALL
        SELECT p.id FROM public.profiles p JOIN subordinates s ON p.superior_id = s.id WHERE p.activo = true
      )
      SELECT id FROM subordinates
    );

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

    -- Caja del vendedor vinculada directamente a la caja del administrador
    INSERT INTO public.cajas (usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, admin_caja_id)
    VALUES (v_user_id, 'abierta', ROUND(v_last_saldo, 2), ROUND(v_last_saldo, 2), now(), v_admin_caja_id);

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

-- 3. MOVIMIENTO ATÓMICO CON ESPEJO ENTRE CAJA DE VENDEDOR Y CAJA DE ADMIN
DROP FUNCTION IF EXISTS public.rpc_create_cash_movement(uuid, text, text, numeric, uuid);
CREATE OR REPLACE FUNCTION public.rpc_create_cash_movement(
  p_caja_id     uuid,
  p_tipo        text,
  p_descripcion text,
  p_monto       numeric,
  p_client_uuid uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_mov_id              uuid;
  v_mirror_mov_id       uuid;
  v_caja_estado         text;
  v_caja_usuario_id     uuid;
  v_admin_caja_id       uuid;
  v_admin_caja_estado   text;
  v_max_gasto           numeric;
  v_activo              boolean;
  v_user_nombre         text;
  v_mirror_desc         text;
BEGIN
  -- 1. Idempotencia por client_uuid
  IF p_client_uuid IS NOT NULL THEN
    SELECT id INTO v_mov_id
    FROM public.cash_movements
    WHERE client_uuid = p_client_uuid
    LIMIT 1;

    IF v_mov_id IS NOT NULL THEN
      RETURN v_mov_id;
    END IF;
  END IF;

  -- 2. Validar usuario activo
  SELECT activo, dinero_max_gasto, TRIM(COALESCE(nombre, '') || ' ' || COALESCE(apellido, ''))
  INTO v_activo, v_max_gasto, v_user_nombre
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_activo IS FALSE THEN
    RAISE EXCEPTION 'USUARIO_INHABILITADO: Tu cuenta se encuentra inhabilitada';
  END IF;

  -- 3. Validar limite de gasto si tipo es retiro o gasto
  IF (p_tipo = 'retiro' OR p_tipo = 'gasto') AND v_max_gasto IS NOT NULL AND v_max_gasto > 0 AND p_monto > v_max_gasto THEN
    RAISE EXCEPTION 'MONTO_EXCEDE_MAX_GASTO: El monto (%) excede tu límite permitido por gasto (%)', p_monto, v_max_gasto;
  END IF;

  -- 4. Validar caja abierta
  SELECT estado, usuario_id, admin_caja_id
  INTO v_caja_estado, v_caja_usuario_id, v_admin_caja_id
  FROM public.cajas WHERE id = p_caja_id FOR UPDATE;

  IF v_caja_estado IS NULL THEN
    RAISE EXCEPTION 'CAJA_NOT_FOUND';
  END IF;

  IF v_caja_estado <> 'abierta' THEN
    RAISE EXCEPTION 'CAJA_CERRADA: La caja debe estar abierta para registrar movimientos';
  END IF;

  -- Si no tiene admin_caja_id explícito en la fila, buscar la caja abierta del superior
  IF v_admin_caja_id IS NULL THEN
    SELECT c.id INTO v_admin_caja_id
    FROM public.cajas c
    JOIN public.profiles p ON p.superior_id = c.usuario_id
    WHERE p.id = v_caja_usuario_id
      AND c.estado = 'abierta'
    ORDER BY c.fecha_apertura DESC
    LIMIT 1;

    IF v_admin_caja_id IS NOT NULL THEN
      UPDATE public.cajas SET admin_caja_id = v_admin_caja_id WHERE id = p_caja_id;
    END IF;
  END IF;

  -- Si existe admin_caja_id, validar que siga abierta
  IF v_admin_caja_id IS NOT NULL AND v_admin_caja_id <> p_caja_id THEN
    SELECT estado INTO v_admin_caja_estado FROM public.cajas WHERE id = v_admin_caja_id FOR UPDATE;
  END IF;

  -- 5. Insertar movimiento en la caja principal
  INSERT INTO public.cash_movements (
    caja_id, tipo, descripcion, monto, client_uuid, external_caja_id
  ) VALUES (
    p_caja_id, p_tipo, p_descripcion, ROUND(p_monto, 2), p_client_uuid, v_admin_caja_id
  )
  RETURNING id INTO v_mov_id;

  -- 6. Actualizar saldo_final de la caja principal
  IF p_tipo = 'ingreso' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, 0) + ROUND(p_monto, 2) WHERE id = p_caja_id;
  ELSIF p_tipo = 'retiro' OR p_tipo = 'gasto' THEN
    UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, 0) - ROUND(p_monto, 2) WHERE id = p_caja_id;
  END IF;

  -- 7. Movimiento Espejo con la Caja del Admin (si aplica)
  -- Solo se hace espejo si existe caja admin asociada, está abierta, y es 'retiro' o 'ingreso' (NO 'gasto')
  IF v_admin_caja_id IS NOT NULL AND v_admin_caja_estado = 'abierta' AND v_admin_caja_id <> p_caja_id THEN
    
    IF p_tipo = 'retiro' THEN
      -- Retiro del vendedor -> Ingreso en la caja del admin
      v_mirror_desc := 'Entrega vendedor: ' || COALESCE(NULLIF(v_user_nombre, ''), 'Vendedor') || 
                       CASE WHEN p_descripcion IS NOT NULL AND TRIM(p_descripcion) <> '' THEN ' - ' || TRIM(p_descripcion) ELSE '' END;

      INSERT INTO public.cash_movements (
        caja_id, tipo, descripcion, monto, external_caja_id, paired_movement_id
      ) VALUES (
        v_admin_caja_id, 'ingreso', v_mirror_desc, ROUND(p_monto, 2), p_caja_id, v_mov_id
      )
      RETURNING id INTO v_mirror_mov_id;

      -- Enlazar par en el retiro del vendedor
      UPDATE public.cash_movements SET paired_movement_id = v_mirror_mov_id WHERE id = v_mov_id;

      -- Sumar saldo a la caja del administrador
      UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, 0) + ROUND(p_monto, 2) WHERE id = v_admin_caja_id;

    ELSIF p_tipo = 'ingreso' THEN
      -- Ingreso del vendedor -> Retiro en la caja del admin (base entregada)
      v_mirror_desc := 'Base a vendedor: ' || COALESCE(NULLIF(v_user_nombre, ''), 'Vendedor') || 
                       CASE WHEN p_descripcion IS NOT NULL AND TRIM(p_descripcion) <> '' THEN ' - ' || TRIM(p_descripcion) ELSE '' END;

      INSERT INTO public.cash_movements (
        caja_id, tipo, descripcion, monto, external_caja_id, paired_movement_id
      ) VALUES (
        v_admin_caja_id, 'retiro', v_mirror_desc, ROUND(p_monto, 2), p_caja_id, v_mov_id
      )
      RETURNING id INTO v_mirror_mov_id;

      -- Enlazar par en el ingreso del vendedor
      UPDATE public.cash_movements SET paired_movement_id = v_mirror_mov_id WHERE id = v_mov_id;

      -- Restar saldo a la caja del administrador
      UPDATE public.cajas SET saldo_final = COALESCE(saldo_final, 0) - ROUND(p_monto, 2) WHERE id = v_admin_caja_id;

    END IF;
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', v_mov_id,
    'paired_movement_id', v_mirror_mov_id,
    'tipo', p_tipo,
    'monto', p_monto
  );
END;
$func$;

-- Asegurar permisos de ejecución
GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_abrir_cajas_masivo() TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_cash_movement(uuid, text, text, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_cash_movement(uuid, text, text, numeric, uuid) TO service_role;
