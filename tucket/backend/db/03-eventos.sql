-- ============================================================
-- TUCKET · Módulo 3: Eventos
-- Incluye el afiche del evento (image_path / image_alt) y el ciclo
-- de vida del estado.
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  venue VARCHAR(180) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  total_capacity INTEGER NOT NULL CHECK (total_capacity > 0),
  base_price NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
  observations TEXT NOT NULL,
  -- Afiche: se guarda la RUTA del archivo servido por el backend
  -- (/uploads/events/xxx.jpg), no la imagen en binario. Mantiene la
  -- base liviana, que es lo que conviene en Neon.
  image_path VARCHAR(255),
  image_alt VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'Programado'
    CHECK (status IN ('Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado')),
  cancellation_reason TEXT,
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  country_code VARCHAR(3) NOT NULL,
  department_code VARCHAR(8) NOT NULL,
  city_id BIGINT NOT NULL,
  agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_end_after_start CHECK (ends_at > starts_at),
  CONSTRAINT events_cancel_reason CHECK (
    (status = 'Cancelado' AND cancellation_reason IS NOT NULL
       AND char_length(btrim(cancellation_reason)) BETWEEN 10 AND 500)
    OR (status <> 'Cancelado' AND cancellation_reason IS NULL)
  ),
  CONSTRAINT events_city_matches_location
    FOREIGN KEY (city_id, department_code, country_code)
    REFERENCES cities(id, department_code, country_code) ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS events_agent_created_idx ON events(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);

-- ============================================================
-- Migraciones idempotentes para bases ya creadas.
-- CREATE TABLE IF NOT EXISTS no modifica una tabla existente, así que
-- los cambios posteriores se reaplican aquí.
-- ============================================================

-- Ciclo de vida del evento
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Afiche del evento
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_path VARCHAR(255);
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_alt VARCHAR(200);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check
  CHECK (status IN ('Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado'));

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_cancel_reason;
ALTER TABLE events ADD CONSTRAINT events_cancel_reason CHECK (
  (status = 'Cancelado' AND cancellation_reason IS NOT NULL
     AND char_length(btrim(cancellation_reason)) BETWEEN 10 AND 500)
  OR (status <> 'Cancelado' AND cancellation_reason IS NULL)
);
