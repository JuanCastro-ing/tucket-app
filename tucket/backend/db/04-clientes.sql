-- ============================================================
-- TUCKET · Módulo 4: Clientes (quien reserva)
-- Tabla separada de `agents` a propósito: son dos roles con datos y
-- ciclo de vida distintos. El login identifica el rol por la tabla en
-- la que encuentra el correo.
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  document_type VARCHAR(4) NOT NULL DEFAULT 'CC'
    CHECK (document_type IN ('CC', 'CE', 'TI', 'PAS', 'NIT')),
  document_number VARCHAR(32) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  address VARCHAR(180),
  -- Ubicación opcional: si se envía, debe ser una ciudad real y coherente
  -- con su departamento y país (misma FK compuesta que en events).
  country_code VARCHAR(3),
  department_code VARCHAR(8),
  city_id BIGINT,
  accepted_terms BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_type, document_number),
  CONSTRAINT clients_email_shape CHECK (email LIKE '%_@_%._%'),
  CONSTRAINT clients_terms_required CHECK (accepted_terms = TRUE),
  CONSTRAINT clients_city_matches_location
    FOREIGN KEY (city_id, department_code, country_code)
    REFERENCES cities(id, department_code, country_code) ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS clients_created_idx ON clients(created_at DESC);
