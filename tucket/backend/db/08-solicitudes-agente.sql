-- TUCKET · Módulo 8: Solicitudes de cuenta de agente
--
-- Quien quiera publicar espectáculos llena un formulario público con sus
-- datos y una justificación. La solicitud queda Pendiente hasta que un
-- administrador la aprueba (y entonces nace la cuenta de agente) o la
-- rechaza registrando el motivo.
--
-- La solicitud se conserva después de resuelta: es el rastro de por qué
-- existe cada cuenta de agente.

CREATE TABLE IF NOT EXISTS agent_requests (
  id BIGSERIAL PRIMARY KEY,

  -- Datos de quien solicita
  full_name VARCHAR(160) NOT NULL,
  document_number VARCHAR(32) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(32) NOT NULL,

  -- Qué representa: el teatro, la productora o la empresa
  organization VARCHAR(180) NOT NULL,
  nit VARCHAR(32),
  justification TEXT NOT NULL,

  -- Resolución
  status VARCHAR(12) NOT NULL DEFAULT 'Pendiente',
  review_notes TEXT,
  reviewed_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agent_requests_status_check
    CHECK (status IN ('Pendiente', 'Aprobada', 'Rechazada')),

  -- La justificación es el motivo por el que se aprueba o no: pedirla de
  -- adorno no sirve, así que la base exige que diga algo.
  CONSTRAINT agent_requests_justification_len
    CHECK (char_length(btrim(justification)) BETWEEN 30 AND 1000),

  -- Rechazar exige explicar por qué, igual que cancelar un evento.
  CONSTRAINT agent_requests_reject_needs_notes CHECK (
    (status = 'Rechazada'
       AND review_notes IS NOT NULL
       AND char_length(btrim(review_notes)) BETWEEN 10 AND 500)
    OR status <> 'Rechazada'
  ),

  -- Una solicitud aprobada tiene que apuntar a la cuenta que creó. Sin esto
  -- podría quedar marcada como aprobada sin que exista el agente.
  CONSTRAINT agent_requests_approved_needs_agent CHECK (
    (status = 'Aprobada' AND agent_id IS NOT NULL)
    OR (status <> 'Aprobada' AND agent_id IS NULL)
  ),

  -- Mientras está pendiente nadie la ha revisado todavía.
  CONSTRAINT agent_requests_pending_is_clean CHECK (
    status <> 'Pendiente'
    OR (review_notes IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
  )
);

-- La bandeja se abre siempre por estado y por fecha.
CREATE INDEX IF NOT EXISTS agent_requests_status_idx
  ON agent_requests(status, created_at DESC);

-- Un mismo correo no puede tener dos solicitudes esperando a la vez: evita
-- que alguien llene la bandeja mandando el formulario veinte veces. Es un
-- índice parcial, así que sí puede volver a solicitar si la anterior fue
-- rechazada.
CREATE UNIQUE INDEX IF NOT EXISTS agent_requests_una_pendiente_por_correo
  ON agent_requests(email)
  WHERE status = 'Pendiente';
