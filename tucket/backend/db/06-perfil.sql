-- TUCKET · Módulo 6: Datos de perfil editables
-- HU: "Como usuario autenticado quiero modificar mis datos personales
--      (nombre completo, dirección, ciudad y teléfonos de contacto)".
--
-- Los clientes ya tenían teléfono y dirección; les falta el segundo
-- número. Los agentes no tenían ninguno de esos campos, así que se
-- agregan aquí para que ambos roles editen el mismo formulario.

-- ---------- Clientes ----------
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefono_alterno VARCHAR(32);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Un segundo número solo tiene sentido si hay un primero.
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_telefono_alt_needs_telefono;
ALTER TABLE clientes ADD CONSTRAINT clientes_telefono_alt_needs_telefono
  CHECK (telefono_alterno IS NULL OR telefono IS NOT NULL);

-- ---------- Agentes ----------
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS telefono VARCHAR(32);
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS telefono_alterno VARCHAR(32);
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS direccion VARCHAR(180);
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS codigo_pais VARCHAR(3);
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS codigo_departamento VARCHAR(8);
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS id_ciudad BIGINT;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE agentes DROP CONSTRAINT IF EXISTS agentes_telefono_alt_needs_telefono;
ALTER TABLE agentes ADD CONSTRAINT agentes_telefono_alt_needs_telefono
  CHECK (telefono_alterno IS NULL OR telefono IS NOT NULL);

-- Misma regla que en eventos y clientes: la ciudad debe pertenecer de verdad
-- al departamento y país indicados. Con columnas nulas la FK no se exige
-- (MATCH SIMPLE), así que la ubicación sigue siendo opcional.
ALTER TABLE agentes DROP CONSTRAINT IF EXISTS agentes_city_matches_location;
ALTER TABLE agentes ADD CONSTRAINT agentes_city_matches_location
  FOREIGN KEY (id_ciudad, codigo_departamento, codigo_pais)
  REFERENCES ciudades(id, codigo_departamento, codigo_pais) ON UPDATE CASCADE;

-- Marca de tiempo de la última edición. Se hace con trigger y no desde
-- la API para que quede registrada venga el cambio de donde venga.
CREATE OR REPLACE FUNCTION perfil_marca_actualizacion()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_actualizacion = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clientes_touch_updated ON clientes;
CREATE TRIGGER clientes_touch_updated
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION perfil_marca_actualizacion();

DROP TRIGGER IF EXISTS agentes_touch_updated ON agentes;
CREATE TRIGGER agentes_touch_updated
  BEFORE UPDATE ON agentes
  FOR EACH ROW EXECUTE FUNCTION perfil_marca_actualizacion();
