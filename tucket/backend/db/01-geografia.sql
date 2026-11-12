-- TUCKET · Módulo 1: Geografía (países, departamentos, ciudades)
-- Catálogo DIVIPOLA del DANE. Lo cargan los scripts de setup.

CREATE TABLE IF NOT EXISTS paises (
  codigo VARCHAR(3) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS departamentos (
  codigo VARCHAR(8) PRIMARY KEY,
  codigo_pais VARCHAR(3) NOT NULL REFERENCES paises(codigo) ON UPDATE CASCADE,
  nombre VARCHAR(120) NOT NULL,
  UNIQUE (codigo_pais, nombre),
  -- Clave única compuesta: la necesitan las FK que validan que una ciudad
  -- pertenezca de verdad al departamento y país indicados.
  UNIQUE (codigo, codigo_pais)
);

CREATE TABLE IF NOT EXISTS ciudades (
  id BIGSERIAL PRIMARY KEY,
  codigo_dane VARCHAR(5) NOT NULL UNIQUE,
  codigo_pais VARCHAR(3) NOT NULL,
  codigo_departamento VARCHAR(8) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  FOREIGN KEY (codigo_departamento, codigo_pais)
    REFERENCES departamentos(codigo, codigo_pais) ON UPDATE CASCADE,
  UNIQUE (codigo_departamento, nombre),
  UNIQUE (id, codigo_departamento, codigo_pais)
);

CREATE INDEX IF NOT EXISTS ciudades_department_nombre_idx ON ciudades(codigo_departamento, nombre);
