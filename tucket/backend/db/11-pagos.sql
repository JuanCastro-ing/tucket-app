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
CREATE TABLE IF NOT EXISTS metodos_pago (
  codigo          VARCHAR(20) PRIMARY KEY,
  etiqueta         VARCHAR(40) NOT NULL,
  orden SMALLINT    NOT NULL,
  -- Si pide los datos de una tarjeta en el formulario.
  requiere_tarjeta    BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Si el dinero entra en el momento. Taquilla no: queda pendiente.
  inmediato       BOOLEAN     NOT NULL DEFAULT TRUE,
  activo        BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO metodos_pago (codigo, etiqueta, orden, requiere_tarjeta, inmediato) VALUES
  ('Tarjeta',  'Tarjeta de crédito o débito', 1, TRUE,  TRUE),
  ('PSE',      'PSE · débito bancario',       2, FALSE, TRUE),
  ('Taquilla', 'Efectivo en taquilla',        3, FALSE, FALSE)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta,
  orden = EXCLUDED.orden,
  requiere_tarjeta = EXCLUDED.requiere_tarjeta,
  inmediato = EXCLUDED.inmediato;

-- ---------- Catálogo: estados de pago ----------
CREATE TABLE IF NOT EXISTS estados_pago (
  codigo          VARCHAR(20) PRIMARY KEY,
  etiqueta         VARCHAR(40) NOT NULL,
  orden SMALLINT    NOT NULL,
  -- Si este estado significa que el dinero entró. Es la columna que
  -- gobierna los ingresos y la confirmación de la reserva.
  es_pagado       BOOLEAN     NOT NULL DEFAULT FALSE,
  es_final      BOOLEAN     NOT NULL DEFAULT FALSE,
  clase_insignia   VARCHAR(40) NOT NULL
);

INSERT INTO estados_pago (codigo, etiqueta, orden, es_pagado, es_final, clase_insignia) VALUES
  ('Pendiente',  'Pendiente',  1, FALSE, FALSE, 'badge-pendiente'),
  ('Aprobado',   'Aprobado',   2, TRUE,  TRUE,  'badge-aprobado'),
  ('Rechazado',  'Rechazado',  3, FALSE, TRUE,  'badge-rechazado'),
  ('Reembolsado','Reembolsado',4, FALSE, TRUE,  'badge-reembolsado')
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta,
  orden = EXCLUDED.orden,
  es_pagado = EXCLUDED.es_pagado,
  es_final = EXCLUDED.es_final,
  clase_insignia = EXCLUDED.clase_insignia;

-- ---------- Códigos de pago ----------
-- Una secuencia, como los eventos y las reservas: el número es único en
-- toda la base aunque dos clientes paguen en el mismo instante.
CREATE SEQUENCE IF NOT EXISTS pagos_codigo_seq START 1;

-- ---------- Pagos ----------
CREATE TABLE IF NOT EXISTS pagos (
  id             BIGSERIAL PRIMARY KEY,
  codigo           VARCHAR(20) NOT NULL UNIQUE
                   DEFAULT 'PAG-' || LPAD(nextval('pagos_codigo_seq')::text, 5, '0'),
  id_reserva BIGINT      NOT NULL REFERENCES reservas(id) ON DELETE RESTRICT,
  codigo_metodo    VARCHAR(20) NOT NULL REFERENCES metodos_pago(codigo)
                   ON UPDATE CASCADE ON DELETE RESTRICT,
  estado         VARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                   REFERENCES estados_pago(codigo)
                   ON UPDATE CASCADE ON DELETE RESTRICT,
  monto         NUMERIC(12, 2) NOT NULL CHECK (monto >= 0),
  -- Referencia que devolvería una pasarela. Aquí la genera el servidor.
  referencia      VARCHAR(40)  NOT NULL UNIQUE,
  -- Solo los cuatro últimos dígitos, y solo cuando el método usa tarjeta.
  ultimos4_tarjeta     CHAR(4),
  marca_tarjeta     VARCHAR(20),
  -- Por qué se rechazó. Igual que en las reservas: solo puede existir si
  -- el estado lo justifica.
  motivo_rechazo VARCHAR(200),
  fecha_pago        TIMESTAMPTZ,
  fecha_creacion     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pagos_last4_digits CHECK (ultimos4_tarjeta IS NULL OR ultimos4_tarjeta ~ '^[0-9]{4}$'),
  CONSTRAINT pagos_reason_only_when_declined CHECK (
    estado = 'Rechazado' OR motivo_rechazo IS NULL
  ),
  CONSTRAINT pagos_paid_at_only_when_paid CHECK (
    (estado = 'Aprobado') = (fecha_pago IS NOT NULL)
  )
);

-- Una reserva no puede tener dos pagos aprobados. Los rechazados sí se
-- acumulan: son el historial de intentos, y perderlos sería perder la
-- explicación de por qué el cliente volvió a intentar.
CREATE UNIQUE INDEX IF NOT EXISTS pagos_un_aprobado_por_reserva
  ON pagos (id_reserva)
  WHERE estado = 'Aprobado';

CREATE INDEX IF NOT EXISTS pagos_reservation_idx ON pagos (id_reserva);
CREATE INDEX IF NOT EXISTS pagos_estado_idx      ON pagos (estado);
CREATE INDEX IF NOT EXISTS pagos_created_idx     ON pagos (fecha_creacion DESC);

-- ---------- El pago aprobado confirma la reserva ----------
-- La regla vive en la base, no en la API: así una reserva no puede quedar
-- pagada y sin confirmar aunque alguien escriba en la tabla por fuera del
-- servidor, por ejemplo desde pgAdmin.
CREATE OR REPLACE FUNCTION pagos_confirma_reserva() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado IN (SELECT codigo FROM estados_pago WHERE es_pagado) THEN
    UPDATE reservas
       SET estado = 'Confirmada',
           fecha_cambio_estado = NOW()
     WHERE id = NEW.id_reserva
       AND estado = 'Reservada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pagos_confirma_reserva_trg ON pagos;
CREATE TRIGGER pagos_confirma_reserva_trg
  AFTER INSERT OR UPDATE OF estado ON pagos
  FOR EACH ROW EXECUTE FUNCTION pagos_confirma_reserva();

-- ---------- No se paga una reserva cancelada ----------
CREATE OR REPLACE FUNCTION pagos_valida_reserva() RETURNS TRIGGER AS $$
DECLARE
  estado_actual  TEXT;
  debido  NUMERIC(12, 2);
BEGIN
  SELECT estado, valor_total INTO estado_actual, debido
    FROM reservas WHERE id = NEW.id_reserva;

  IF estado_actual IS NULL THEN
    RAISE EXCEPTION 'La reserva % no existe.', NEW.id_reserva
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF estado_actual IN (SELECT codigo FROM estados_reserva WHERE NOT ocupa_silla) THEN
    RAISE EXCEPTION 'La reserva está en estado_actual % y no admite pagos.', estado_actual
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.monto <> debido THEN
    RAISE EXCEPTION 'El pago (%) no coincide con el total de la reserva (%).',
      NEW.monto, debido
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pagos_valida_reserva_trg ON pagos;
CREATE TRIGGER pagos_valida_reserva_trg
  BEFORE INSERT ON pagos
  FOR EACH ROW EXECUTE FUNCTION pagos_valida_reserva();
