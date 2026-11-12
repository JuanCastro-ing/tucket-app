-- TUCKET · Módulo 8: Solicitudes de cuenta de agente
--
-- Quien quiera publicar espectáculos llena un formulario público con sus
-- datos y una justificación. La solicitud queda Pendiente hasta que un
-- administrador la aprueba (y entonces nace la cuenta de agente) o la
-- rechaza registrando el motivo.
--
-- La solicitud se conserva después de resuelta: es el rastro de por qué
-- existe cada cuenta de agente.

CREATE TABLE IF NOT EXISTS solicitudes_agente (
  id BIGSERIAL PRIMARY KEY,

  -- Datos de quien solicita
  nombre_completo VARCHAR(160) NOT NULL,
  numero_documento VARCHAR(32) NOT NULL,
  correo VARCHAR(254) NOT NULL,
  telefono VARCHAR(32) NOT NULL,

  -- Qué representa: el teatro, la productora o la empresa
  organizacion VARCHAR(180) NOT NULL,
  nit VARCHAR(32),
  justificacion TEXT NOT NULL,

  -- Resolución
  estado VARCHAR(12) NOT NULL DEFAULT 'Pendiente',
  notas_revision TEXT,
  revisado_por BIGINT REFERENCES administradores(id) ON DELETE SET NULL,
  fecha_revision TIMESTAMPTZ,
  id_agente BIGINT REFERENCES agentes(id) ON DELETE SET NULL,

  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT solicitudes_agente_estado_check
    CHECK (estado IN ('Pendiente', 'Aprobada', 'Rechazada')),

  -- La justificación es el motivo por el que se aprueba o no: pedirla de
  -- adorno no sirve, así que la base exige que diga algo.
  CONSTRAINT solicitudes_agente_justificacion_len
    CHECK (char_length(btrim(justificacion)) BETWEEN 30 AND 1000),

  -- Rechazar exige explicar por qué, igual que cancelar un evento.
  CONSTRAINT solicitudes_agente_reject_needs_notes CHECK (
    (estado = 'Rechazada'
       AND notas_revision IS NOT NULL
       AND char_length(btrim(notas_revision)) BETWEEN 10 AND 500)
    OR estado <> 'Rechazada'
  ),

  -- Una solicitud aprobada tiene que apuntar a la cuenta que creó. Sin esto
  -- podría quedar marcada como aprobada sin que exista el agente.
  CONSTRAINT solicitudes_agente_approved_needs_agent CHECK (
    (estado = 'Aprobada' AND id_agente IS NOT NULL)
    OR (estado <> 'Aprobada' AND id_agente IS NULL)
  ),

  -- Mientras está pendiente nadie la ha revisado todavía.
  CONSTRAINT solicitudes_agente_pending_is_clean CHECK (
    estado <> 'Pendiente'
    OR (notas_revision IS NULL AND revisado_por IS NULL AND fecha_revision IS NULL)
  )
);

-- La bandeja se abre siempre por estado y por fecha.
CREATE INDEX IF NOT EXISTS solicitudes_agente_estado_idx
  ON solicitudes_agente(estado, fecha_creacion DESC);

-- Un mismo correo no puede tener dos solicitudes esperando a la vez: evita
-- que alguien llene la bandeja mandando el formulario veinte veces. Es un
-- índice parcial, así que sí puede volver a solicitar si la anterior fue
-- rechazada.
CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_agente_una_pendiente_por_correo
  ON solicitudes_agente(correo)
  WHERE estado = 'Pendiente';
