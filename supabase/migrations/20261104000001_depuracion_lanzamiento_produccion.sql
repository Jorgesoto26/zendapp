-- =====================================================================
-- SCRIPT DE DEPURACIÓN PARA LANZAMIENTO A PRODUCCIÓN (OPCIÓN A)
-- Fecha: 2026-11-04
-- Preserva estrictamente:
-- 1. Super Usuario: 7bb442ae-5e6f-4bcb-a868-8d2c97384ab4 (Jeorge Gonzalez)
-- 2. Usuario Soporte Web: 4a4d4922-476f-432b-a476-d5433eb61548
-- 3. Organización Principal: a621747a-69ef-4d4d-b0fd-686739e4b408
-- 4. Catálogo Maestro de Conceptos: public.concepts (121 registros)
-- 5. Estructura, Tablas, RLS, Triggers y RPCs
-- =====================================================================

BEGIN;

-- 1. Eliminar pagos y cuotas de prueba
DELETE FROM public.payments;
DELETE FROM public.cuotas;

-- 2. Eliminar auditorías y evidencias multimedia de prueba
DELETE FROM public.cash_movement_audit;
DELETE FROM public.multimedia_evidencias;

-- 3. Eliminar movimientos de caja de prueba
DELETE FROM public.cash_movements;

-- 4. Eliminar ventas y créditos de prueba
DELETE FROM public.invoice;

-- 5. Eliminar clientes de prueba
DELETE FROM public.clients;

-- 6. Romper auto-referencias de cajas y eliminar todas las cajas de prueba
UPDATE public.cajas SET admin_caja_id = NULL;
DELETE FROM public.cajas;

-- 7. Romper dependencias circulares entre profiles y organizaciones de prueba
UPDATE public.profiles SET superior_id = NULL;

UPDATE public.organizaciones 
SET admin_id = NULL 
WHERE admin_id IS NOT NULL 
  AND admin_id NOT IN ('7bb442ae-5e6f-4bcb-a868-8d2c97384ab4', '4a4d4922-476f-432b-a476-d5433eb61548');

UPDATE public.profiles 
SET organizacion_id = NULL 
WHERE id NOT IN ('7bb442ae-5e6f-4bcb-a868-8d2c97384ab4', '4a4d4922-476f-432b-a476-d5433eb61548');

-- 8. Eliminar organizaciones de prueba que no correspondan a la oficial
DELETE FROM public.organizaciones 
WHERE id <> 'a621747a-69ef-4d4d-b0fd-686739e4b408'
  AND (admin_id IS NULL OR admin_id NOT IN ('7bb442ae-5e6f-4bcb-a868-8d2c97384ab4', '4a4d4922-476f-432b-a476-d5433eb61548'));

-- 9. Eliminar perfiles de prueba de profiles
DELETE FROM public.profiles 
WHERE id NOT IN ('7bb442ae-5e6f-4bcb-a868-8d2c97384ab4', '4a4d4922-476f-432b-a476-d5433eb61548');

-- 10. Eliminar operadores de soporte técnico de prueba (si hubiese otros distintos a 4a4d4922...)
DELETE FROM public.soporte_usuarios 
WHERE id NOT IN ('4a4d4922-476f-432b-a476-d5433eb61548');

-- 11. Eliminar usuarios de autenticación en auth.users (excepto Superadmin y Soporte)
DELETE FROM auth.users 
WHERE id NOT IN ('7bb442ae-5e6f-4bcb-a868-8d2c97384ab4', '4a4d4922-476f-432b-a476-d5433eb61548');

-- 12. Re-asegurar vinculación y estado del Super Usuario
UPDATE public.profiles
SET activo = true,
    superior_id = NULL,
    organizacion_id = 'a621747a-69ef-4d4d-b0fd-686739e4b408'
WHERE id = '7bb442ae-5e6f-4bcb-a868-8d2c97384ab4';

UPDATE public.organizaciones
SET admin_id = '7bb442ae-5e6f-4bcb-a868-8d2c97384ab4'
WHERE id = 'a621747a-69ef-4d4d-b0fd-686739e4b408';

COMMIT;

-- 13. Reporte de verificación post-depuración
SELECT 'profiles' as tabla, count(*) as registros_restantes FROM public.profiles
UNION ALL
SELECT 'soporte_usuarios', count(*) FROM public.soporte_usuarios
UNION ALL
SELECT 'auth.users', count(*) FROM auth.users
UNION ALL
SELECT 'organizaciones', count(*) FROM public.organizaciones
UNION ALL
SELECT 'clients', count(*) FROM public.clients
UNION ALL
SELECT 'invoice', count(*) FROM public.invoice
UNION ALL
SELECT 'payments', count(*) FROM public.payments
UNION ALL
SELECT 'cajas', count(*) FROM public.cajas
UNION ALL
SELECT 'cash_movements', count(*) FROM public.cash_movements
UNION ALL
SELECT 'concepts (maestro)', count(*) FROM public.concepts;
