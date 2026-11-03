-- ============================================================
-- TUCKET · Módulo 6: Datos de perfil editables
-- HU: "Como usuario autenticado quiero modificar mis datos personales
--      (nombre completo, dirección, ciudad y teléfonos de contacto)".
--
-- Los clientes ya tenían teléfono y dirección; les falta el segundo
-- número. Los agentes no tenían ninguno de esos campos, así que se
-- agregan aquí para que ambos roles editen el mismo formulario.
-- ============================================================

-- ---------- Clientes ----------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_alt VARCHAR(32);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Un segundo número solo tiene sentido si hay un primero.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_phone_alt_needs_phone;
ALTER TABLE clients ADD CONSTRAINT clients_phone_alt_needs_phone
  CHECK (phone_alt IS NULL OR phone IS NOT NULL);

-- ---------- Agentes ----------
ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone VARCHAR(32);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS phone_alt VARCHAR(32);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS address VARCHAR(180);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS country_code VARCHAR(3);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS department_code VARCHAR(8);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS city_id BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_phone_alt_needs_phone;
ALTER TABLE agents ADD CONSTRAINT agents_phone_alt_needs_phone
  CHECK (phone_alt IS NULL OR phone IS NOT NULL);

-- Misma regla que en events y clients: la ciudad debe pertenecer de verdad
-- al departamento y país indicados. Con columnas nulas la FK no se exige
-- (MATCH SIMPLE), así que la ubicación sigue siendo opcional.
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_city_matches_location;
ALTER TABLE agents ADD CONSTRAINT agents_city_matches_location
  FOREIGN KEY (city_id, department_code, country_code)
  REFERENCES cities(id, department_code, country_code) ON UPDATE CASCADE;

-- ============================================================
-- Marca de tiempo de la última edición. Se hace con trigger y no desde
-- la API para que quede registrada venga el cambio de donde venga.
-- ============================================================
CREATE OR REPLACE FUNCTION perfil_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clients_touch_updated ON clients;
CREATE TRIGGER clients_touch_updated
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION perfil_touch_updated_at();

DROP TRIGGER IF EXISTS agents_touch_updated ON agents;
CREATE TRIGGER agents_touch_updated
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION perfil_touch_updated_at();
