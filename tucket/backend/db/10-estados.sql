-- ============================================================
-- TUCKET · Módulo 10: catálogo de estados
--
-- Hasta aquí los estados eran cadenas sueltas validadas con un CHECK en
-- cada tabla, y las reglas sobre qué significa cada uno vivían repartidas
-- por el código: un Set en reservas.routes.js decía en qué estados se
-- puede reservar, otro en eventos.routes.js decía cuáles son finales, y un
-- objeto en eventos.js decidía el color de la etiqueta.
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
CREATE TABLE IF NOT EXISTS estados_evento (
  codigo VARCHAR(20) PRIMARY KEY,
  etiqueta VARCHAR(40) NOT NULL,
  -- Orden en que se muestran en los desplegables y las leyendas.
  orden SMALLINT NOT NULL,
  -- ¿Un cliente puede reservar mientras el evento está así?
  permite_reservar BOOLEAN NOT NULL DEFAULT FALSE,
  -- ¿Es un estado terminal? Un evento así ya no se edita ni cambia de estado.
  es_final BOOLEAN NOT NULL DEFAULT FALSE,
  -- ¿Exige escribir una causa al pasar a este estado?
  exige_motivo BOOLEAN NOT NULL DEFAULT FALSE,
  -- Clase CSS de la etiqueta de color, para que el color también salga de aquí.
  clase_insignia VARCHAR(40) NOT NULL
);

INSERT INTO estados_evento (codigo, etiqueta, orden, permite_reservar, es_final, exige_motivo, clase_insignia) VALUES
  ('Programado',    'Programado',    1, TRUE,  FALSE, FALSE, 'badge-programado'),
  ('En Boletería',  'En Boletería',  2, TRUE,  FALSE, FALSE, 'badge-boleteria'),
  ('En Vivo',       'En Vivo',       3, FALSE, FALSE, FALSE, 'badge-vivo'),
  ('Finalizado',    'Finalizado',    4, FALSE, TRUE,  FALSE, 'badge-finalizado'),
  ('Cancelado',     'Cancelado',     5, FALSE, TRUE,  TRUE,  'badge-cancelado')
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta,
  orden = EXCLUDED.orden,
  permite_reservar = EXCLUDED.permite_reservar,
  es_final = EXCLUDED.es_final,
  exige_motivo = EXCLUDED.exige_motivo,
  clase_insignia = EXCLUDED.clase_insignia;

-- ------------------------------------------------------------
-- Estados de una reserva
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estados_reserva (
  codigo VARCHAR(20) PRIMARY KEY,
  etiqueta VARCHAR(40) NOT NULL,
  orden SMALLINT NOT NULL,
  -- ¿Esta reserva sigue ocupando butacas? Es la regla que usan la vista de
  -- disponibilidad y el disparador que impide sobrevender.
  ocupa_silla BOOLEAN NOT NULL DEFAULT FALSE,
  es_final BOOLEAN NOT NULL DEFAULT FALSE,
  clase_insignia VARCHAR(40) NOT NULL
);

INSERT INTO estados_reserva (codigo, etiqueta, orden, ocupa_silla, es_final, clase_insignia) VALUES
  ('Reservada',  'Reservada',  1, TRUE,  FALSE, 'badge-programado'),
  ('Confirmada', 'Confirmada', 2, TRUE,  FALSE, 'badge-boleteria'),
  ('Usada',      'Usada',      3, TRUE,  TRUE,  'badge-finalizado'),
  ('Cancelada',  'Cancelada',  4, FALSE, TRUE,  'badge-cancelado')
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta,
  orden = EXCLUDED.orden,
  ocupa_silla = EXCLUDED.ocupa_silla,
  es_final = EXCLUDED.es_final,
  clase_insignia = EXCLUDED.clase_insignia;

-- ------------------------------------------------------------
-- Estados de una solicitud de cuenta de agente
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estados_solicitud (
  codigo VARCHAR(20) PRIMARY KEY,
  etiqueta VARCHAR(40) NOT NULL,
  orden SMALLINT NOT NULL,
  es_final BOOLEAN NOT NULL DEFAULT FALSE,
  clase_insignia VARCHAR(40) NOT NULL
);

INSERT INTO estados_solicitud (codigo, etiqueta, orden, es_final, clase_insignia) VALUES
  ('Pendiente', 'Pendiente', 1, FALSE, 'badge-programado'),
  ('Aprobada',  'Aprobada',  2, TRUE,  'badge-boleteria'),
  ('Rechazada', 'Rechazada', 3, TRUE,  'badge-cancelado')
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta,
  orden = EXCLUDED.orden,
  es_final = EXCLUDED.es_final,
  clase_insignia = EXCLUDED.clase_insignia;

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
ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_estado_check;
ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_estado_fkey;
ALTER TABLE eventos ADD CONSTRAINT eventos_estado_fkey
  FOREIGN KEY (estado) REFERENCES estados_evento(codigo)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE reservas DROP CONSTRAINT IF EXISTS reservas_estado_check;
ALTER TABLE reservas DROP CONSTRAINT IF EXISTS reservas_estado_fkey;
ALTER TABLE reservas ADD CONSTRAINT reservas_estado_fkey
  FOREIGN KEY (estado) REFERENCES estados_reserva(codigo)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE solicitudes_agente DROP CONSTRAINT IF EXISTS solicitudes_agente_estado_check;
ALTER TABLE solicitudes_agente DROP CONSTRAINT IF EXISTS solicitudes_agente_estado_fkey;
ALTER TABLE solicitudes_agente ADD CONSTRAINT solicitudes_agente_estado_fkey
  FOREIGN KEY (estado) REFERENCES estados_solicitud(codigo)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- Índices sobre las columnas de estado: ahora son claves foráneas y además
-- se filtra por ellas constantemente (la cartelera, el panel del agente).
CREATE INDEX IF NOT EXISTS eventos_estado_idx ON eventos(estado);
CREATE INDEX IF NOT EXISTS reservas_estado_idx ON reservas(estado);

-- solicitudes_agente no lleva uno aquí: el módulo 08 ya creó
-- solicitudes_agente_estado_idx sobre (estado, fecha_creacion DESC), que sirve
-- para lo mismo y además ordena la bandeja. Repetirlo con solo (estado)
-- no creaba nada —IF NOT EXISTS lo saltaba— pero dejaba dos sentencias
-- con el mismo nombre y distinta definición, que confunde al leerlas.

-- ============================================================
-- La disponibilidad y el control de sobreventa pasan a leer el catálogo
--
-- Antes repetían la lista ('Reservada','Confirmada','Usada') dentro del
-- SQL. Si mañana se agrega un estado que también ocupa butaca, bastará con
-- marcarlo con ocupa_silla = TRUE y estas dos reglas se enteran solas.
-- ============================================================
-- Se mantienen el nombre de la vista, sus columnas y el nombre de la
-- función: el resto del sistema los usa y no tienen por qué cambiar. Lo
-- único que cambia es de dónde sale la lista de estados que ocupan butaca.
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
 AND r.estado IN (SELECT codigo FROM estados_reserva WHERE ocupa_silla)
GROUP BY e.id, e.codigo, e.capacidad_total;

CREATE OR REPLACE FUNCTION reservas_check_capacity()
RETURNS TRIGGER AS $$
DECLARE
  capacity  INTEGER;
  taken     INTEGER;
BEGIN
  -- Una reserva que no ocupa butaca no puede sobrevender nada. Antes esto
  -- preguntaba literalmente si el estado era 'Cancelada'; ahora lo decide
  -- la columna ocupa_silla del catálogo.
  IF NOT EXISTS (SELECT 1 FROM estados_reserva WHERE codigo = NEW.estado AND ocupa_silla) THEN
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
    AND estado IN (SELECT codigo FROM estados_reserva WHERE ocupa_silla)
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

-- Con qué estado puede NACER un evento. Publicar algo ya finalizado o en
-- curso no tiene sentido, y antes esa regla era otra lista escrita en
-- eventos.routes.js. Es la última que faltaba por traer al catálogo.
ALTER TABLE estados_evento ADD COLUMN IF NOT EXISTS permitido_al_crear BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE estados_evento SET permitido_al_crear = (codigo IN ('Programado', 'En Boletería'));
