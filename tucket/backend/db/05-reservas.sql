-- TUCKET · Módulo 5: Reservas y boletas
-- Una reserva agrupa N boletas de un mismo evento para un cliente.

-- Consecutivo del código visible de la reserva (RES-00842, RES-00843, …).
-- Arranca en 842 para continuar la numeración que ya mostraba la maqueta.
CREATE SEQUENCE IF NOT EXISTS reservas_codigo_seq START WITH 1;

CREATE TABLE IF NOT EXISTS reservas (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE
    DEFAULT 'RES-' || LPAD(nextval('reservas_codigo_seq')::text, 5, '0'),
  id_cliente BIGINT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  id_evento BIGINT NOT NULL REFERENCES eventos(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 10),
  -- Se congela el precio del momento de la reserva: si el evento cambia de
  -- precio después, lo ya reservado no se altera.
  precio_unitario NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0),
  valor_total NUMERIC(12, 2) NOT NULL CHECK (valor_total >= 0),
  estado VARCHAR(20) NOT NULL DEFAULT 'Reservada'
    CHECK (estado IN ('Reservada', 'Confirmada', 'Cancelada', 'Usada')),
  motivo_cancelacion VARCHAR(500),
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_cambio_estado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reservas_total_matches CHECK (valor_total = precio_unitario * cantidad),
  -- El motivo es opcional, pero solo puede existir si está cancelada.
  CONSTRAINT reservas_reason_only_when_cancelled CHECK (
    estado = 'Cancelada' OR motivo_cancelacion IS NULL
  )
);

CREATE INDEX IF NOT EXISTS reservas_client_idx ON reservas(id_cliente, fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS reservas_event_idx ON reservas(id_evento, estado);

CREATE TABLE IF NOT EXISTS boletas (
  id BIGSERIAL PRIMARY KEY,
  id_reserva BIGINT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  serial VARCHAR(32) NOT NULL UNIQUE,
  nombre_titular VARCHAR(160),
  silla VARCHAR(24),
  fecha_uso TIMESTAMPTZ,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boletas_reservation_idx ON boletas(id_reserva);

-- Disponibilidad: capacidad del evento menos lo reservado vigente.
-- Las canceladas no ocupan cupo.
CREATE OR REPLACE VIEW disponibilidad_eventos AS
SELECT
  e.id   AS id_evento,
  e.codigo AS codigo_evento,
  e.capacidad_total,
  COALESCE(SUM(r.cantidad), 0)::integer AS sillas_reservadas,
  e.capacidad_total - COALESCE(SUM(r.cantidad), 0)::integer AS sillas_disponibles
FROM eventos e
LEFT JOIN reservas r
  ON r.id_evento = e.id
 AND r.estado IN ('Reservada', 'Confirmada', 'Usada')
GROUP BY e.id, e.codigo, e.capacidad_total;

-- Regla de integridad: no se puede sobrevender un evento.
-- Vive en la base y no solo en la API, para que tampoco se pueda romper
-- insertando a mano desde psql o desde la consola de Neon.
CREATE OR REPLACE FUNCTION reservas_check_capacity()
RETURNS TRIGGER AS $$
DECLARE
  capacity  INTEGER;
  taken     INTEGER;
BEGIN
  -- Solo las reservas que ocupan cupo necesitan verificación.
  IF NEW.estado = 'Cancelada' THEN
    RETURN NEW;
  END IF;

  -- Se bloquea la fila del evento para que dos reservas simultáneas no
  -- lean la misma disponibilidad y la superen entre ambas.
  SELECT capacidad_total INTO capacity
  FROM eventos WHERE id = NEW.id_evento FOR UPDATE;

  IF capacity IS NULL THEN
    RAISE EXCEPTION 'El evento % no existe.', NEW.id_evento;
  END IF;

  SELECT COALESCE(SUM(cantidad), 0) INTO taken
  FROM reservas
  WHERE id_evento = NEW.id_evento
    AND estado IN ('Reservada', 'Confirmada', 'Usada')
    AND id <> COALESCE(NEW.id, -1);

  IF taken + NEW.cantidad > capacity THEN
    RAISE EXCEPTION
      'Sin cupo: el evento tiene % puestos y ya hay % reservados; se pidieron %.',
      capacity, taken, NEW.cantidad
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reservas_control_aforo ON reservas;
CREATE TRIGGER reservas_control_aforo
  BEFORE INSERT OR UPDATE OF cantidad, estado, id_evento ON reservas
  FOR EACH ROW EXECUTE FUNCTION reservas_check_capacity();

-- Marca de tiempo del último cambio de estado.
CREATE OR REPLACE FUNCTION reservas_touch_estado()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.fecha_cambio_estado = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reservas_marca_estado ON reservas;
CREATE TRIGGER reservas_marca_estado
  BEFORE UPDATE ON reservas
  FOR EACH ROW EXECUTE FUNCTION reservas_touch_estado();

-- Observaciones del cliente al reservar: silla de ruedas, acceso
-- preferencial, acompañante… El formulario ya las pedía, pero no había
-- dónde guardarlas y se perdían al enviar. Son peticiones de
-- accesibilidad: perderlas en silencio es peor que no preguntarlas.
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS observaciones VARCHAR(500);
