-- ============================================================
-- TUCKET · Módulo 1: Geografía (países, departamentos, ciudades)
-- Catálogo DIVIPOLA del DANE. Lo cargan los scripts de setup.
-- ============================================================

CREATE TABLE IF NOT EXISTS countries (
  code VARCHAR(3) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS departments (
  code VARCHAR(8) PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL REFERENCES countries(code) ON UPDATE CASCADE,
  name VARCHAR(120) NOT NULL,
  UNIQUE (country_code, name),
  -- Clave única compuesta: la necesitan las FK que validan que una ciudad
  -- pertenezca de verdad al departamento y país indicados.
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

CREATE INDEX IF NOT EXISTS cities_department_name_idx ON cities(department_code, name);
