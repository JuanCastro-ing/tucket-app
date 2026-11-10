-- ============================================================
--  TUCKET · 11 · Pagos
-- ============================================================
--  SIMULACIÓN. Tucket no cobra dinero real: no hay pasarela, no hay
--  cuenta de comercio y no se guarda ningún dato de tarjeta más allá de
--  los cuatro últimos dígitos, que sirven para que el cliente reconozca
--  su propio pago en el comprobante. El número completo, la fecha de
--  vencimiento y el código de seguridad no llegan a la base: se validan
--  en el servidor y se descartan.
--
--  Se sigue el mismo patrón que los estados: los métodos y los estados de
--  pago son tablas de catálogo con su comportamiento en columnas, no
--  listas escritas en el código.
-- ============================================================

-- ---------- Catálogo: métodos de pago ----------
CREATE TABLE IF NOT EXISTS payment_methods (
  code          VARCHAR(20) PRIMARY KEY,
  label         VARCHAR(40) NOT NULL,
  display_order SMALLINT    NOT NULL,
  -- Si pide los datos de una tarjeta en el formulario.
  needs_card    BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Si el dinero entra en el momento. Taquilla no: queda pendiente.
  instant       BOOLEAN     NOT NULL DEFAULT TRUE,
  active        BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO payment_methods (code, label, display_order, needs_card, instant) VALUES
  ('Tarjeta',  'Tarjeta de crédito o débito', 1, TRUE,  TRUE),
  ('PSE',      'PSE · débito bancario',       2, FALSE, TRUE),
  ('Taquilla', 'Efectivo en taquilla',        3, FALSE, FALSE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  needs_card = EXCLUDED.needs_card,
  instant = EXCLUDED.instant;

-- ---------- Catálogo: estados de pago ----------
CREATE TABLE IF NOT EXISTS payment_statuses (
  code          VARCHAR(20) PRIMARY KEY,
  label         VARCHAR(40) NOT NULL,
  display_order SMALLINT    NOT NULL,
  -- Si este estado significa que el dinero entró. Es la columna que
  -- gobierna los ingresos y la confirmación de la reserva.
  is_paid       BOOLEAN     NOT NULL DEFAULT FALSE,
  is_final      BOOLEAN     NOT NULL DEFAULT FALSE,
  badge_class   VARCHAR(40) NOT NULL
);

INSERT INTO payment_statuses (code, label, display_order, is_paid, is_final, badge_class) VALUES
  ('Pendiente',  'Pendiente',  1, FALSE, FALSE, 'badge-pendiente'),
  ('Aprobado',   'Aprobado',   2, TRUE,  TRUE,  'badge-aprobado'),
  ('Rechazado',  'Rechazado',  3, FALSE, TRUE,  'badge-rechazado'),
  ('Reembolsado','Reembolsado',4, FALSE, TRUE,  'badge-reembolsado')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  is_paid = EXCLUDED.is_paid,
  is_final = EXCLUDED.is_final,
  badge_class = EXCLUDED.badge_class;

-- ---------- Códigos de pago ----------
-- Una secuencia, como los eventos y las reservas: el número es único en
-- toda la base aunque dos clientes paguen en el mismo instante.
CREATE SEQUENCE IF NOT EXISTS payment_code_seq START 1;

-- ---------- Pagos ----------
CREATE TABLE IF NOT EXISTS payments (
  id             BIGSERIAL PRIMARY KEY,
  code           VARCHAR(20) NOT NULL UNIQUE
                   DEFAULT 'PAG-' || LPAD(nextval('payment_code_seq')::text, 5, '0'),
  reservation_id BIGINT      NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  method_code    VARCHAR(20) NOT NULL REFERENCES payment_methods(code)
                   ON UPDATE CASCADE ON DELETE RESTRICT,
  status         VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                   REFERENCES payment_statuses(code)
                   ON UPDATE CASCADE ON DELETE RESTRICT,
  amount         NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  -- Referencia que devolvería una pasarela. Aquí la genera el servidor.
  reference      VARCHAR(40)  NOT NULL UNIQUE,
  -- Solo los cuatro últimos dígitos, y solo cuando el método usa tarjeta.
  card_last4     CHAR(4),
  card_brand     VARCHAR(20),
  -- Por qué se rechazó. Igual que en las reservas: solo puede existir si
  -- el estado lo justifica.
  decline_reason VARCHAR(200),
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT payments_last4_digits CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT payments_reason_only_when_declined CHECK (
    status = 'Rechazado' OR decline_reason IS NULL
  ),
  CONSTRAINT payments_paid_at_only_when_paid CHECK (
    (status = 'Aprobado') = (paid_at IS NOT NULL)
  )
);

-- Una reserva no puede tener dos pagos aprobados. Los rechazados sí se
-- acumulan: son el historial de intentos, y perderlos sería perder la
-- explicación de por qué el cliente volvió a intentar.
CREATE UNIQUE INDEX IF NOT EXISTS payments_un_aprobado_por_reserva
  ON payments (reservation_id)
  WHERE status = 'Aprobado';

CREATE INDEX IF NOT EXISTS payments_reservation_idx ON payments (reservation_id);
CREATE INDEX IF NOT EXISTS payments_status_idx      ON payments (status);
CREATE INDEX IF NOT EXISTS payments_created_idx     ON payments (created_at DESC);

-- ---------- El pago aprobado confirma la reserva ----------
-- La regla vive en la base, no en la API: así una reserva no puede quedar
-- pagada y sin confirmar aunque alguien escriba en la tabla por fuera del
-- servidor, por ejemplo desde pgAdmin.
CREATE OR REPLACE FUNCTION payments_confirm_reservation() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN (SELECT code FROM payment_statuses WHERE is_paid) THEN
    UPDATE reservations
       SET status = 'Confirmada',
           status_updated_at = NOW()
     WHERE id = NEW.reservation_id
       AND status = 'Reservada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_confirm_reservation_trg ON payments;
CREATE TRIGGER payments_confirm_reservation_trg
  AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_confirm_reservation();

-- ---------- No se paga una reserva cancelada ----------
CREATE OR REPLACE FUNCTION payments_check_reservation() RETURNS TRIGGER AS $$
DECLARE
  estado  TEXT;
  debido  NUMERIC(12, 2);
BEGIN
  SELECT status, total_amount INTO estado, debido
    FROM reservations WHERE id = NEW.reservation_id;

  IF estado IS NULL THEN
    RAISE EXCEPTION 'La reserva % no existe.', NEW.reservation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF estado IN (SELECT code FROM reservation_statuses WHERE NOT occupies_seat) THEN
    RAISE EXCEPTION 'La reserva está en estado % y no admite pagos.', estado
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.amount <> debido THEN
    RAISE EXCEPTION 'El pago (%) no coincide con el total de la reserva (%).',
      NEW.amount, debido
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_check_reservation_trg ON payments;
CREATE TRIGGER payments_check_reservation_trg
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_check_reservation();
