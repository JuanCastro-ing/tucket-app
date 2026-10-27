-- ============================================================
-- TUCKET · Módulo 2: Agentes (quien publica y administra eventos)
-- Las cuentas se crean con `npm run agent:create`, nunca desde el
-- formulario público de registro.
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
