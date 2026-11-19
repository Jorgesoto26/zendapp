-- ============================================================================
-- RPC: manager_get_usuarios
-- Archivo: 20261118000002_manager_get_usuarios.sql
-- Descripción:
--   1. Asegura columnas email y telefono en public.profiles y sincroniza
--      los correos y teléfonos históricos desde auth.users y organizaciones.
--   2. Bloque defensivo para trigger opcional en auth.users.
--   3. RPC manager_get_usuarios con SECURITY DEFINER para consultar
--      directamente auth.users.email en tiempo real.
-- ============================================================================

-- 1. ASEGURAR COLUMNAS EN PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telefono text;

-- 2. BACKFILL DE EMAILS DESDE AUTH.USERS
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id
  AND au.email IS NOT NULL
  AND (p.email IS NULL OR p.email = '');

-- 3. BACKFILL DE TELÉFONOS DESDE AUTH.USERS
UPDATE public.profiles p
SET telefono = au.phone
FROM auth.users au
WHERE p.id = au.id
  AND au.phone IS NOT NULL
  AND au.phone <> ''
  AND (p.telefono IS NULL OR p.telefono = '');

-- 4. BACKFILL DE TELÉFONOS DESDE ORGANIZACIONES
UPDATE public.profiles p
SET telefono = o.telefono
FROM public.organizaciones o
WHERE (o.id = p.organizacion_id OR o.admin_id = p.id)
  AND o.telefono IS NOT NULL
  AND o.telefono <> ''
  AND (p.telefono IS NULL OR p.telefono = '');

-- 5. TRIGGER OPCIONAL DE SINCRONIZACIÓN (auth.users -> profiles)
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION public.sync_profile_from_auth_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, auth, pg_temp
  AS $f$
  BEGIN
    UPDATE public.profiles
    SET 
      email = COALESCE(NEW.email, email),
      telefono = COALESCE(NEW.phone, telefono),
      updated_at = now()
    WHERE id = NEW.id;
    RETURN NEW;
  END;
  $f$;

  DROP TRIGGER IF EXISTS trg_sync_profile_from_auth_user ON auth.users;
  CREATE TRIGGER trg_sync_profile_from_auth_user
    AFTER INSERT OR UPDATE OF email, phone ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_profile_from_auth_user();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Trigger en auth.users no aplicado (los correos se consultan vía RPC): %', SQLERRM;
END $$;

-- 6. DROPEAR SOBRECARGAS PREVIAS DE LA FUNCIÓN PARA EVITAR ERROR 42P13
DROP FUNCTION IF EXISTS public.manager_get_usuarios();
DROP FUNCTION IF EXISTS public.manager_get_usuarios(uuid);
DROP FUNCTION IF EXISTS public.manager_get_usuarios(uuid, text);
DROP FUNCTION IF EXISTS public.manager_get_usuarios(uuid, text, text);
DROP FUNCTION IF EXISTS public.manager_get_usuarios(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.manager_get_usuarios(uuid, text, text, text, integer);

-- 7. CREACIÓN DE LA FUNCIÓN manager_get_usuarios
CREATE OR REPLACE FUNCTION public.manager_get_usuarios(
  p_organizacion_id uuid DEFAULT NULL,
  p_rol text DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS TABLE (
  id                      uuid,
  nombre                  text,
  apellido                text,
  email                   text,
  telefono                text,
  rol                     text,
  activo                  boolean,
  superior_id             uuid,
  superior_nombre         text,
  superior_rol            text,
  organizacion_id         uuid,
  organizacion_nombre     text,
  organizacion_estado     text,
  modo_apertura_caja      text,
  dinero_max_caja         numeric,
  dinero_max_venta        numeric,
  dinero_max_gasto        numeric,
  max_cuotas              integer,
  permite_borrar_venta    boolean,
  permite_modificar_pagos boolean,
  created_at              timestamptz,
  updated_at              timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Sesión no autenticada';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nombre,
    p.apellido,
    COALESCE(
      NULLIF(au.email, ''),
      NULLIF(p.email, ''),
      NULLIF(au.raw_user_meta_data->>'email', ''),
      NULLIF(o.email_contacto, ''),
      ''
    )::text AS email,
    COALESCE(
      NULLIF(p.telefono, ''),
      NULLIF(au.phone, ''),
      NULLIF(o.telefono, ''),
      ''
    )::text AS telefono,
    p.rol,
    COALESCE(p.activo, true) AS activo,
    p.superior_id,
    TRIM(COALESCE(sup.nombre, '') || ' ' || COALESCE(sup.apellido, ''))::text AS superior_nombre,
    sup.rol::text AS superior_rol,
    COALESCE(p.organizacion_id, o.id) AS organizacion_id,
    COALESCE(o.nombre, 'Sin Organización')::text AS organizacion_nombre,
    COALESCE(o.estado, 'activa')::text AS organizacion_estado,
    COALESCE(p.modo_apertura_caja, o.modo_apertura_caja, 'admin_masivo')::text AS modo_apertura_caja,
    p.dinero_max_caja,
    p.dinero_max_venta,
    p.dinero_max_gasto,
    p.max_cuotas,
    p.permite_borrar_venta,
    p.permite_modificar_pagos,
    p.created_at,
    p.updated_at
  FROM public.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN public.profiles sup ON sup.id = p.superior_id
  LEFT JOIN public.organizaciones o ON (o.id = p.organizacion_id OR o.admin_id = p.id)
  WHERE (p_organizacion_id IS NULL OR COALESCE(p.organizacion_id, o.id) = p_organizacion_id)
    AND (p_rol IS NULL OR p_rol = 'todos' OR p.rol = p_rol)
    AND (
      p_estado IS NULL OR p_estado = 'todos'
      OR (p_estado = 'activos' AND COALESCE(p.activo, true) = true)
      OR (p_estado = 'inactivos' AND p.activo = false)
    )
    AND (
      p_search IS NULL OR p_search = ''
      OR p.nombre ILIKE '%' || p_search || '%'
      OR p.apellido ILIKE '%' || p_search || '%'
      OR COALESCE(au.email, p.email, '') ILIKE '%' || p_search || '%'
      OR COALESCE(p.telefono, au.phone, o.telefono, '') ILIKE '%' || p_search || '%'
      OR COALESCE(o.nombre, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY 
    COALESCE(o.nombre, 'ZZZ') ASC,
    CASE 
      WHEN p.rol = 'admin' THEN 1 
      WHEN p.rol = 'supervisor' THEN 2 
      WHEN p.rol = 'cobrador' THEN 3
      ELSE 4 
    END ASC,
    p.created_at DESC
  LIMIT COALESCE(p_limit, 300);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_get_usuarios(uuid, text, text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.manager_get_usuarios(uuid, text, text, text, integer) TO authenticated, service_role;
