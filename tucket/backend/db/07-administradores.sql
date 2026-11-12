-- TUCKET · Módulo 7: Administradores
--
-- Tercer rol del sistema, junto a agentes y clientes. Su trabajo es
-- revisar quién pide una cuenta de agente y decidir si se le otorga.
--
-- Igual que los agentes, estas cuentas NO se crean desde ningún formulario
-- público: se aprovisionan con `npm run admin:create`. Si el panel de
-- administración pudiera auto-registrarse, no serviría de nada.

CREATE TABLE IF NOT EXISTS administradores (
  id BIGSERIAL PRIMARY KEY,
  nombre_completo VARCHAR(160) NOT NULL,
  correo VARCHAR(254) NOT NULL UNIQUE,
  clave_hash VARCHAR(100) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración idempotente para bases ya creadas: CREATE TABLE IF NOT EXISTS
-- no modifica una tabla existente.
ALTER TABLE administradores ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Reutiliza la función del módulo 6: la fecha de última edición se actualiza
-- sola, venga el cambio de donde venga.
DROP TRIGGER IF EXISTS administradores_touch_updated ON administradores;
CREATE TRIGGER administradores_touch_updated
  BEFORE UPDATE ON administradores
  FOR EACH ROW EXECUTE FUNCTION perfil_marca_actualizacion();
