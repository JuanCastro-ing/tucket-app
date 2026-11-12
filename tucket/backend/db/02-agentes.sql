-- TUCKET · Módulo 2: Agentes (quien publica y administra eventos)
-- Las cuentas se crean con `npm run agent:create`, nunca desde el
-- formulario público de registro.

CREATE TABLE IF NOT EXISTS agentes (
  id BIGSERIAL PRIMARY KEY,
  nombre_completo VARCHAR(160) NOT NULL,
  correo VARCHAR(254) NOT NULL UNIQUE,
  clave_hash VARCHAR(100) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
