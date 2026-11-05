-- =====================================================================
-- MIGRACIÓN: 20261104000002_fix_profiles_update_at_and_admin_create_user.sql
-- 1. Agregar columnas update_at y updated_at a public.profiles
-- 2. Corregir admin_create_user (heredar organizacion_id y remover columna fecha inexistente de cajas)
-- 3. Sincronizar timestamps en profiles ante actualizaciones
-- =====================================================================

-- 1. Asegurar columnas de timestamp en profiles (evita error column "update_at" of relation "profiles" does not exist)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS update_at timestamptz DEFAULT now();

-- 2. Trigger para mantener sincronizados ambos campos de timestamp
CREATE OR REPLACE FUNCTION public.sync_profiles_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  NEW.update_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_sync_timestamps ON public.profiles;
CREATE TRIGGER trg_profiles_sync_timestamps
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profiles_timestamps();

-- 3. Actualizar función canónica admin_create_user
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_nombre text,
  p_apellido text DEFAULT '',
  p_rol text DEFAULT 'vendedor',
  p_dinero_max_caja numeric DEFAULT 0,
  p_dinero_max_venta numeric DEFAULT 0,
  p_dinero_max_gasto numeric DEFAULT 0,
  p_max_cuotas integer DEFAULT 30,
  p_permite_borrar_venta boolean DEFAULT false,
  p_permite_modificar_pagos boolean DEFAULT false,
  p_saldo_inicial numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_id uuid;
  v_encrypted_pw text;
  v_now timestamptz;
  v_admin_org_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: solo administradores pueden crear usuarios';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS: ya existe un usuario con este correo';
  END IF;

  -- Obtener la organización del administrador creador para heredarla
  SELECT organizacion_id INTO v_admin_org_id 
  FROM public.profiles 
  WHERE id = auth.uid();

  v_new_id := gen_random_uuid();
  v_encrypted_pw := crypt(trim(p_password), gen_salt('bf', 10));
  v_now := now();

  -- Insertar en auth.users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    p_email, v_encrypted_pw, v_now,
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('sub', v_new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false, 'nombre', p_nombre, 'apellido', COALESCE(p_apellido, ''))::jsonb,
    v_now, v_now, '', '', '', '', '', '', '', '', false, false
  );

  -- Insertar en auth.identities
  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_new_id::text, v_new_id,
    json_build_object('sub', v_new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false)::jsonb,
    'email', v_now, v_now, v_now
  );

  -- Insertar o actualizar en public.profiles
  INSERT INTO public.profiles (
    id, nombre, apellido, rol, superior_id, activo, dinero_max_caja, dinero_max_venta,
    dinero_max_gasto, max_cuotas, permite_borrar_venta, permite_modificar_pagos,
    organizacion_id, updated_at, update_at
  ) VALUES (
    v_new_id, p_nombre, COALESCE(p_apellido, ''), COALESCE(p_rol, 'vendedor'), auth.uid(), true,
    COALESCE(p_dinero_max_caja, 0), COALESCE(p_dinero_max_venta, 0), COALESCE(p_dinero_max_gasto, 0),
    COALESCE(p_max_cuotas, 30), COALESCE(p_permite_borrar_venta, false), COALESCE(p_permite_modificar_pagos, false),
    v_admin_org_id, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    apellido = EXCLUDED.apellido,
    rol = EXCLUDED.rol,
    superior_id = EXCLUDED.superior_id,
    activo = true,
    dinero_max_caja = EXCLUDED.dinero_max_caja,
    dinero_max_venta = EXCLUDED.dinero_max_venta,
    dinero_max_gasto = EXCLUDED.dinero_max_gasto,
    max_cuotas = EXCLUDED.max_cuotas,
    permite_borrar_venta = EXCLUDED.permite_borrar_venta,
    permite_modificar_pagos = EXCLUDED.permite_modificar_pagos,
    organizacion_id = COALESCE(EXCLUDED.organizacion_id, profiles.organizacion_id),
    updated_at = v_now,
    update_at = v_now;

  -- Crear caja inicial cerrada con la base establecida si es vendedor (sin columna 'fecha' inexistente)
  IF COALESCE(p_rol, 'vendedor') = 'vendedor' THEN
    INSERT INTO public.cajas (
      usuario_id, estado, saldo_inicial, saldo_final, fecha_apertura, fecha_cierre
    ) VALUES (
      v_new_id, 'cerrada', COALESCE(p_saldo_inicial, 0), COALESCE(p_saldo_inicial, 0), v_now, v_now
    );
  END IF;

  RETURN json_build_object('success', true, 'user_id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text, text, numeric, numeric, numeric, integer, boolean, boolean, numeric) TO service_role;

-- 4. Actualizar también admin_update_user para asegurar timestamps
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
AS $func$
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
    updated_at              = now(),
    update_at               = now()
  WHERE id = p_user_id;

  IF p_password IS NOT NULL AND length(trim(p_password)) >= 6 THEN
    UPDATE auth.users
    SET encrypted_password = crypt(trim(p_password), gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN json_build_object('success', true, 'user_id', p_user_id);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, numeric, numeric, numeric, integer, boolean, boolean, text) TO service_role;

