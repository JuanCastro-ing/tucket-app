-- ============================================================
-- TUCKET · Módulo 10: catálogo de estados
--
-- Hasta aquí los estados eran cadenas sueltas validadas con un CHECK en
-- cada tabla, y las reglas sobre qué significa cada uno vivían repartidas
-- por el código: un Set en reservations.routes.js decía en qué estados se
-- puede reservar, otro en events.routes.js decía cuáles son finales, y un
-- objeto en events.js decidía el color de la etiqueta.
--
-- El problema no es la validación —un CHECK valida igual de bien— sino que
-- agregar un estado obligaba a tocar seis sitios, y olvidar uno producía
-- un fallo silencioso: el evento se guardaba pero no admitía reservas, o
-- salía sin color.
--
-- Con estas tablas, un estado es una fila con su comportamiento al lado.
-- Agregar «Aplazado» es un INSERT, y el resto del sistema se entera solo.
--
-- Decisión de diseño: la clave primaria es el propio texto del estado
-- ('En Boletería'), no un número. Así:
--   · No hubo que migrar ni una fila: lo que ya estaba guardado sigue
--     siendo válido, solo que ahora es una clave foránea.
--   · Mostrar el estado no exige un JOIN, porque la clave ya es el texto.
--   · La base sigue garantizando la integridad, igual que el CHECK.
-- El JOIN hace falta solo cuando se quieren los metadatos.
-- ============================================================

-- ------------------------------------------------------------
-- Estados de un evento
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_statuses (
  code VARCHAR(20) PRIMARY KEY,
  label VARCHAR(40) NOT NULL,
  -- Orden en que se muestran en los desplegables y las leyendas.
  display_order SMALLINT NOT NULL,
  -- ¿Un cliente puede reservar mientras el evento está así?
  allows_reservation BOOLEAN NOT NULL DEFAULT FALSE,
  -- ¿Es un estado terminal? Un evento así ya no se edita ni cambia de estado.
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  -- ¿Exige escribir una causa al pasar a este estado?
  requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
  -- Clase CSS de la etiqueta de color, para que el color también salga de aquí.
  badge_class VARCHAR(40) NOT NULL
);

INSERT INTO event_statuses (code, label, display_order, allows_reservation, is_final, requires_reason, badge_class) VALUES
  ('Programado',    'Programado',    1, TRUE,  FALSE, FALSE, 'badge-programado'),
  ('En Boletería',  'En Boletería',  2, TRUE,  FALSE, FALSE, 'badge-boleteria'),
  ('En Vivo',       'En Vivo',       3, FALSE, FALSE, FALSE, 'badge-vivo'),
  ('Finalizado',    'Finalizado',    4, FALSE, TRUE,  FALSE, 'badge-finalizado'),
  ('Cancelado',     'Cancelado',     5, FALSE, TRUE,  TRUE,  'badge-cancelado')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  allows_reservation = EXCLUDED.allows_reservation,
  is_final = EXCLUDED.is_final,
  requires_reason = EXCLUDED.requires_reason,
  badge_class = EXCLUDED.badge_class;

-- ------------------------------------------------------------
-- Estados de una reserva
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_statuses (
  code VARCHAR(20) PRIMARY KEY,
  label VARCHAR(40) NOT NULL,
  display_order SMALLINT NOT NULL,
  -- ¿Esta reserva sigue ocupando butacas? Es la regla que usan la vista de
  -- disponibilidad y el disparador que impide sobrevender.
  occupies_seat BOOLEAN NOT NULL DEFAULT FALSE,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  badge_class VARCHAR(40) NOT NULL
);

INSERT INTO reservation_statuses (code, label, display_order, occupies_seat, is_final, badge_class) VALUES
  ('Reservada',  'Reservada',  1, TRUE,  FALSE, 'badge-programado'),
  ('Confirmada', 'Confirmada', 2, TRUE,  FALSE, 'badge-boleteria'),
  ('Usada',      'Usada',      3, TRUE,  TRUE,  'badge-finalizado'),
  ('Cancelada',  'Cancelada',  4, FALSE, TRUE,  'badge-cancelado')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  occupies_seat = EXCLUDED.occupies_seat,
  is_final = EXCLUDED.is_final,
  badge_class = EXCLUDED.badge_class;

-- ------------------------------------------------------------
-- Estados de una solicitud de cuenta de agente
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_statuses (
  code VARCHAR(20) PRIMARY KEY,
  label VARCHAR(40) NOT NULL,
  display_order SMALLINT NOT NULL,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  badge_class VARCHAR(40) NOT NULL
);

INSERT INTO request_statuses (code, label, display_order, is_final, badge_class) VALUES
  ('Pendiente', 'Pendiente', 1, FALSE, 'badge-programado'),
  ('Aprobada',  'Aprobada',  2, TRUE,  'badge-boleteria'),
  ('Rechazada', 'Rechazada', 3, TRUE,  'badge-cancelado')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  display_order = EXCLUDED.display_order,
  is_final = EXCLUDED.is_final,
  badge_class = EXCLUDED.badge_class;

-- ============================================================
-- De CHECK a clave foránea
--
-- Se quitan los CHECK y en su lugar cada columna apunta al catálogo. Si no
-- se quitaran, agregar un estado nuevo a la tabla no serviría de nada: el
-- CHECK seguiría rechazándolo, que es precisamente el problema que se
-- quiere resolver.
--
-- ON DELETE RESTRICT: no se puede borrar un estado que algún registro esté
-- usando. ON UPDATE CASCADE: si algún día se corrige el texto de un estado,
-- el cambio se propaga solo a todas las filas.
-- ============================================================
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_fkey;
ALTER TABLE events ADD CONSTRAINT events_status_fkey
  FOREIGN KEY (status) REFERENCES event_statuses(code)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_fkey;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_fkey
  FOREIGN KEY (status) REFERENCES reservation_statuses(code)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE agent_requests DROP CONSTRAINT IF EXISTS agent_requests_status_check;
ALTER TABLE agent_requests DROP CONSTRAINT IF EXISTS agent_requests_status_fkey;
ALTER TABLE agent_requests ADD CONSTRAINT agent_requests_status_fkey
  FOREIGN KEY (status) REFERENCES request_statuses(code)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Índices sobre las columnas de estado: ahora son claves foráneas y además
-- se filtra por ellas constantemente (la cartelera, el panel del agente).
CREATE INDEX IF NOT EXISTS events_status_idx ON events(status);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status);
CREATE INDEX IF NOT EXISTS agent_requests_status_idx ON agent_requests(status);

-- ============================================================
-- La disponibilidad y el control de sobreventa pasan a leer el catálogo
--
-- Antes repetían la lista ('Reservada','Confirmada','Usada') dentro del
-- SQL. Si mañana se agrega un estado que también ocupa butaca, bastará con
-- marcarlo con occupies_seat = TRUE y estas dos reglas se enteran solas.
-- ============================================================
-- Se mantienen el nombre de la vista, sus columnas y el nombre de la
-- función: el resto del sistema los usa y no tienen por qué cambiar. Lo
-- único que cambia es de dónde sale la lista de estados que ocupan butaca.
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
 AND r.status IN (SELECT code FROM reservation_statuses WHERE occupies_seat)
GROUP BY e.id, e.code, e.total_capacity;

CREATE OR REPLACE FUNCTION reservations_check_capacity()
RETURNS TRIGGER AS $$
DECLARE
  capacity  INTEGER;
  taken     INTEGER;
BEGIN
  -- Una reserva que no ocupa butaca no puede sobrevender nada. Antes esto
  -- preguntaba literalmente si el estado era 'Cancelada'; ahora lo decide
  -- la columna occupies_seat del catálogo.
  IF NOT EXISTS (SELECT 1 FROM reservation_statuses WHERE code = NEW.status AND occupies_seat) THEN
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
    AND status IN (SELECT code FROM reservation_statuses WHERE occupies_seat)
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

-- Con qué estado puede NACER un evento. Publicar algo ya finalizado o en
-- curso no tiene sentido, y antes esa regla era otra lista escrita en
-- events.routes.js. Es la última que faltaba por traer al catálogo.
ALTER TABLE event_statuses ADD COLUMN IF NOT EXISTS allowed_as_initial BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE event_statuses SET allowed_as_initial = (code IN ('Programado', 'En Boletería'));
