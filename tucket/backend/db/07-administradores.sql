-- ============================================================
-- TUCKET · Módulo 7: Administradores
--
-- Tercer rol del sistema, junto a agentes y clientes. Su trabajo es
-- revisar quién pide una cuenta de agente y decidir si se le otorga.
--
-- Igual que los agentes, estas cuentas NO se crean desde ningún formulario
-- público: se aprovisionan con `npm run admin:create`. Si el panel de
-- administración pudiera auto-registrarse, no serviría de nada.
-- ============================================================

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración idempotente para bases ya creadas: CREATE TABLE IF NOT EXISTS
-- no modifica una tabla existente.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Reutiliza la función del módulo 6: la fecha de última edición se actualiza
-- sola, venga el cambio de donde venga.
DROP TRIGGER IF EXISTS admins_touch_updated ON admins;
CREATE TRIGGER admins_touch_updated
  BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION perfil_touch_updated_at();
