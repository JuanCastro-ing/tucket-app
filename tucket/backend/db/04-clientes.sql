-- TUCKET · Módulo 4: Clientes (quien reserva)
-- Tabla separada de `agentes` a propósito: son dos roles con datos y
-- ciclo de vida distintos. El login identifica el rol por la tabla en
-- la que encuentra el correo.

CREATE TABLE IF NOT EXISTS clientes (
  id BIGSERIAL PRIMARY KEY,
  tipo_documento VARCHAR(4) NOT NULL DEFAULT 'CC'
    CHECK (tipo_documento IN ('CC', 'CE', 'TI', 'PAS', 'NIT')),
  numero_documento VARCHAR(32) NOT NULL,
  nombre_completo VARCHAR(160) NOT NULL,
  correo VARCHAR(254) NOT NULL UNIQUE,
  clave_hash VARCHAR(100) NOT NULL,
  telefono VARCHAR(32) NOT NULL,
  direccion VARCHAR(180),
  -- Ubicación opcional: si se envía, debe ser una ciudad real y coherente
  -- con su departamento y país (misma FK compuesta que en eventos).
  codigo_pais VARCHAR(3),
  codigo_departamento VARCHAR(8),
  id_ciudad BIGINT,
  acepto_terminos BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo_documento, numero_documento),
  CONSTRAINT clientes_correo_shape CHECK (correo LIKE '%_@_%._%'),
  CONSTRAINT clientes_terms_required CHECK (acepto_terminos = TRUE),
  CONSTRAINT clientes_city_matches_location
    FOREIGN KEY (id_ciudad, codigo_departamento, codigo_pais)
    REFERENCES ciudades(id, codigo_departamento, codigo_pais) ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS clientes_created_idx ON clientes(fecha_creacion DESC);
