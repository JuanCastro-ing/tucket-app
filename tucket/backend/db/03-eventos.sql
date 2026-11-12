-- TUCKET · Módulo 3: Eventos
-- Incluye el afiche del evento (ruta_imagen / texto_imagen) y el ciclo
-- de vida del estado.

CREATE TABLE IF NOT EXISTS eventos (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(32) NOT NULL UNIQUE,
  nombre VARCHAR(160) NOT NULL,
  descripcion TEXT NOT NULL,
  teatro VARCHAR(180) NOT NULL,
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ NOT NULL,
  capacidad_total INTEGER NOT NULL CHECK (capacidad_total > 0),
  precio_base NUMERIC(12, 2) NOT NULL CHECK (precio_base >= 0),
  observaciones TEXT NOT NULL,
  -- Afiche: se guarda la RUTA del archivo servido por el backend
  -- (/uploads/eventos/xxx.jpg), no la imagen en binario. Mantiene la
  -- base liviana, que es lo que conviene en Neon.
  ruta_imagen VARCHAR(255),
  texto_imagen VARCHAR(200),
  estado VARCHAR(20) NOT NULL DEFAULT 'Programado'
    CHECK (estado IN ('Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado')),
  motivo_cancelacion TEXT,
  fecha_cambio_estado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  codigo_pais VARCHAR(3) NOT NULL,
  codigo_departamento VARCHAR(8) NOT NULL,
  id_ciudad BIGINT NOT NULL,
  id_agente BIGINT NOT NULL REFERENCES agentes(id) ON DELETE RESTRICT,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT eventos_end_after_start CHECK (fecha_fin > fecha_inicio),
  CONSTRAINT eventos_cancel_reason CHECK (
    (estado = 'Cancelado' AND motivo_cancelacion IS NOT NULL
       AND char_length(btrim(motivo_cancelacion)) BETWEEN 10 AND 500)
    OR (estado <> 'Cancelado' AND motivo_cancelacion IS NULL)
  ),
  CONSTRAINT eventos_city_matches_location
    FOREIGN KEY (id_ciudad, codigo_departamento, codigo_pais)
    REFERENCES ciudades(id, codigo_departamento, codigo_pais) ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS eventos_agent_created_idx ON eventos(id_agente, fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS eventos_starts_at_idx ON eventos(fecha_inicio);

-- Migraciones idempotentes para bases ya creadas.
-- CREATE TABLE IF NOT EXISTS no modifica una tabla existente, así que
-- los cambios posteriores se reaplican aquí.

-- Ciclo de vida del evento
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS fecha_cambio_estado TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Afiche del evento
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS ruta_imagen VARCHAR(255);
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS texto_imagen VARCHAR(200);

-- Banner: la imagen ancha que se ve de fondo en el detalle del evento.
-- Es opcional y distinta del afiche: el afiche es vertical y se mira de
-- cerca, el banner es apaisado y se ve detrás del título. Cuando no hay
-- banner, el detalle usa el afiche, así que nadie queda sin fondo.
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS ruta_banner VARCHAR(255);
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS texto_banner VARCHAR(200);

-- Código del evento: secuencial y asignado por el sistema.
--
-- Antes lo escribía el agente a mano, y eso abría dos problemas: dos
-- agentes podían elegir el mismo código (el UNIQUE lo rechazaba, pero
-- después de llenar todo el formulario) y los códigos quedaban sin
-- ningún orden. Con una secuencia el número lo da PostgreSQL, que
-- garantiza que nunca entrega el mismo dos veces, ni siquiera cuando
-- dos agentes guardan al mismo tiempo.
--
-- El formato es EVT-00001, EVT-00002… Al pasar de 99999 simplemente
-- crece a seis dígitos; no se reinicia ni se reutiliza.
CREATE SEQUENCE IF NOT EXISTS eventos_codigo_seq AS BIGINT START WITH 1 MINVALUE 1;

-- Si la base ya tiene eventos con el formato nuevo, la secuencia se
-- adelanta para no chocar con ellos. Los códigos viejos escritos a mano
-- (EVT-2026-0220 y parecidos) se quedan como están: siguen siendo
-- únicos y válidos, solo que los nuevos ya no se parecen a ellos.
SELECT setval(
  'eventos_codigo_seq',
  GREATEST(
    (SELECT COALESCE(MAX(SUBSTRING(codigo FROM '^EVT-([0-9]{5,})$')::BIGINT), 0) FROM eventos),
    1
  ),
  (SELECT EXISTS (SELECT 1 FROM eventos WHERE codigo ~ '^EVT-[0-9]{5,}$'))
);

ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_estado_check;
ALTER TABLE eventos ADD CONSTRAINT eventos_estado_check
  CHECK (estado IN ('Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado'));

ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_cancel_reason;
ALTER TABLE eventos ADD CONSTRAINT eventos_cancel_reason CHECK (
  (estado = 'Cancelado' AND motivo_cancelacion IS NOT NULL
     AND char_length(btrim(motivo_cancelacion)) BETWEEN 10 AND 500)
  OR (estado <> 'Cancelado' AND motivo_cancelacion IS NULL)
);
