CREATE TABLE IF NOT EXISTS countries (
  code VARCHAR(3) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS departments (
  code VARCHAR(8) PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL REFERENCES countries(code) ON UPDATE CASCADE,
  name VARCHAR(120) NOT NULL,
  UNIQUE (country_code, name),
  UNIQUE (code, country_code)
);

CREATE TABLE IF NOT EXISTS cities (
  id BIGSERIAL PRIMARY KEY,
  dane_code VARCHAR(5) NOT NULL UNIQUE,
  country_code VARCHAR(3) NOT NULL,
  department_code VARCHAR(8) NOT NULL,
  name VARCHAR(120) NOT NULL,
  FOREIGN KEY (department_code, country_code)
    REFERENCES departments(code, country_code) ON UPDATE CASCADE,
  UNIQUE (department_code, name),
  UNIQUE (id, department_code, country_code)
);

CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
CREATE INDEX IF NOT EXISTS cities_department_name_idx ON cities(department_code, name);

-- ============================================================
-- Ciclo de vida del evento: migración para bases ya creadas.
-- CREATE TABLE IF NOT EXISTS no modifica una tabla existente, así que los
-- cambios se reaplican aquí de forma idempotente.
-- ============================================================
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check
  CHECK (status IN ('Programado', 'En Boletería', 'En Vivo', 'Finalizado', 'Cancelado'));

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_cancel_reason;
ALTER TABLE events ADD CONSTRAINT events_cancel_reason CHECK (
  (status = 'Cancelado' AND cancellation_reason IS NOT NULL
     AND char_length(btrim(cancellation_reason)) BETWEEN 10 AND 500)
  OR (status <> 'Cancelado' AND cancellation_reason IS NULL)
);
