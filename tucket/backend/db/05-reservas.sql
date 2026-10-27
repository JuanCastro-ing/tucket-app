-- ============================================================
-- TUCKET · Módulo 5: Reservas y boletas
-- Una reserva agrupa N boletas de un mismo evento para un cliente.
-- ============================================================

-- Consecutivo del código visible de la reserva (RES-00842, RES-00843, …).
-- Arranca en 842 para continuar la numeración que ya mostraba la maqueta.
CREATE SEQUENCE IF NOT EXISTS reservation_code_seq START WITH 842;

CREATE TABLE IF NOT EXISTS reservations (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE
    DEFAULT 'RES-' || LPAD(nextval('reservation_code_seq')::text, 5, '0'),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  -- Se congela el precio del momento de la reserva: si el evento cambia de
  -- precio después, lo ya reservado no se altera.
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'Reservada'
    CHECK (status IN ('Reservada', 'Confirmada', 'Cancelada', 'Usada')),
  cancellation_reason VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reservations_total_matches CHECK (total_amount = unit_price * quantity),
  -- El motivo es opcional, pero solo puede existir si está cancelada.
  CONSTRAINT reservations_reason_only_when_cancelled CHECK (
    status = 'Cancelada' OR cancellation_reason IS NULL
  )
);

CREATE INDEX IF NOT EXISTS reservations_client_idx ON reservations(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reservations_event_idx ON reservations(event_id, status);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  reservation_id BIGINT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  serial VARCHAR(32) NOT NULL UNIQUE,
  holder_name VARCHAR(160),
  seat_label VARCHAR(24),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tickets_reservation_idx ON tickets(reservation_id);

-- ============================================================
-- Disponibilidad: capacidad del evento menos lo reservado vigente.
-- Las canceladas no ocupan cupo.
-- ============================================================
CREATE OR REPLACE VIEW event_availability AS
SELECT
  e.id   AS event_id,
  e.code AS event_code,
  e.total_capacity,
  COALESCE(SUM(r.quantity), 0)::integer AS reserved_seats,
  e.total_capacity - COALESCE(SUM(r.quantity), 0)::integer AS available_seats
FROM events e
LEFT JOIN reservations r
  ON r.event_id = e.id
 AND r.status IN ('Reservada', 'Confirmada', 'Usada')
GROUP BY e.id, e.code, e.total_capacity;

-- ============================================================
-- Regla de integridad: no se puede sobrevender un evento.
-- Vive en la base y no solo en la API, para que tampoco se pueda romper
-- insertando a mano desde psql o desde la consola de Neon.
-- ============================================================
CREATE OR REPLACE FUNCTION reservations_check_capacity()
RETURNS TRIGGER AS $$
DECLARE
  capacity  INTEGER;
  taken     INTEGER;
BEGIN
  -- Solo las reservas que ocupan cupo necesitan verificación.
  IF NEW.status = 'Cancelada' THEN
    RETURN NEW;
  END IF;

  -- Se bloquea la fila del evento para que dos reservas simultáneas no
  -- lean la misma disponibilidad y la superen entre ambas.
  SELECT total_capacity INTO capacity
  FROM events WHERE id = NEW.event_id FOR UPDATE;

  IF capacity IS NULL THEN
    RAISE EXCEPTION 'El evento % no existe.', NEW.event_id;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO taken
  FROM reservations
  WHERE event_id = NEW.event_id
    AND status IN ('Reservada', 'Confirmada', 'Usada')
    AND id <> COALESCE(NEW.id, -1);

  IF taken + NEW.quantity > capacity THEN
    RAISE EXCEPTION
      'Sin cupo: el evento tiene % puestos y ya hay % reservados; se pidieron %.',
      capacity, taken, NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reservations_capacity_guard ON reservations;
CREATE TRIGGER reservations_capacity_guard
  BEFORE INSERT OR UPDATE OF quantity, status, event_id ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_check_capacity();

-- Marca de tiempo del último cambio de estado.
CREATE OR REPLACE FUNCTION reservations_touch_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reservations_status_touch ON reservations;
CREATE TRIGGER reservations_status_touch
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_touch_status();
