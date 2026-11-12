-- TUCKET · Módulo 12: Datos de persona exigidos por el enunciado
--
-- El enunciado del proyecto integrador pide, en «Estructura de Datos y
-- Reglas de Negocio», información que las tres tablas de personas no
-- tenían:
--
--   · Usuarios/Personas  → número de identificación para todos
--   · Clientes           → cantidad de puntos y visualización de publicidad
--   · Agentes            → comisión y experiencia
--   · Administradores    → salario y horario
--
-- Clientes ya guardaba su documento desde el módulo 04. Aquí se agrega
-- a agentes y administradores, y los campos propios de cada rol.
--
-- Todo con ADD COLUMN IF NOT EXISTS para que el módulo se pueda correr
-- sobre una base que ya está en producción sin perder nada.


-- ------------------------------------------------------------------
--  Documento de identidad en agentes y administradores
-- ------------------------------------------------------------------
-- Mismo juego de columnas que ya usa clients: tipo y número. El tipo
-- se limita a los dos que nombra el enunciado.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS document_type VARCHAR(4);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS document_number VARCHAR(32);

ALTER TABLE admins ADD COLUMN IF NOT EXISTS document_type VARCHAR(4);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS document_number VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_document_type') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_document_type
      CHECK (document_type IS NULL OR document_type IN ('CC', 'PAS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_document_type') THEN
    ALTER TABLE admins ADD CONSTRAINT admins_document_type
      CHECK (document_type IS NULL OR document_type IN ('CC', 'PAS'));
  END IF;
END $$;

-- El documento identifica a la persona, así que no se puede repetir.
-- Índice parcial: las cuentas viejas que todavía no lo tienen quedan
-- fuera del índice en vez de chocar entre ellas por ser todas nulas.
CREATE UNIQUE INDEX IF NOT EXISTS agents_un_documento
  ON agents (document_number) WHERE document_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admins_un_documento
  ON admins (document_number) WHERE document_number IS NOT NULL;


-- ------------------------------------------------------------------
--  Clientes: puntos y publicidad
-- ------------------------------------------------------------------
-- points: puntos acumulados por compras. Arranca en cero y no puede
-- ser negativo.
-- shows_ads: si el cliente acepta ver publicidad en su panel.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS shows_ads BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_points_no_negativos') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_points_no_negativos
      CHECK (points >= 0);
  END IF;
END $$;


-- ------------------------------------------------------------------
--  Agentes: comisión y experiencia
-- ------------------------------------------------------------------
-- commission_rate: porcentaje que recibe el agente por cada venta.
-- Se guarda como porcentaje (5.50 = 5,5 %), no como fracción, porque
-- es como lo escribe quien administra la cuenta.
-- experience_years: años de experiencia del agente.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS experience_years SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_comision_valida') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_comision_valida
      CHECK (commission_rate >= 0 AND commission_rate <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_experiencia_valida') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_experiencia_valida
      CHECK (experience_years >= 0 AND experience_years <= 70);
  END IF;
END $$;


-- ------------------------------------------------------------------
--  Administradores: salario y horario
-- ------------------------------------------------------------------
-- salary: en pesos, con la misma precisión que el resto del dinero
-- del sistema (NUMERIC, nunca punto flotante).
-- work_schedule: el turno en texto, porque el enunciado no define una
-- estructura y en la práctica se escribe «Lunes a viernes, 8:00 a 17:00».

ALTER TABLE admins ADD COLUMN IF NOT EXISTS salary NUMERIC(12, 2);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS work_schedule VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_salario_positivo') THEN
    ALTER TABLE admins ADD CONSTRAINT admins_salario_positivo
      CHECK (salary IS NULL OR salary > 0);
  END IF;
END $$;


-- ------------------------------------------------------------------
--  Los puntos se ganan solos al pagar
-- ------------------------------------------------------------------
-- Sin esto, points sería una columna que nadie llena nunca. La regla es
-- simple y queda en la base, no en la aplicación, por la misma razón que
-- el resto de disparadores: un pago registrado desde cualquier otro
-- programa también debe sumar los puntos.
--
-- Un punto por cada mil pesos de la reserva, sin decimales.

CREATE OR REPLACE FUNCTION clients_award_points()
RETURNS TRIGGER AS $$
DECLARE
  cliente  BIGINT;
  ganados  INTEGER;
BEGIN
  -- Solo cuando el pago queda en un estado que cuenta como pagado, y solo
  -- la primera vez que llega a ese estado.
  IF NOT EXISTS (SELECT 1 FROM payment_statuses
                  WHERE code = NEW.status AND is_paid) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT r.client_id, FLOOR(r.total_amount / 1000)::INTEGER
    INTO cliente, ganados
    FROM reservations r
   WHERE r.id = NEW.reservation_id;

  IF cliente IS NOT NULL AND ganados > 0 THEN
    UPDATE clients SET points = points + ganados WHERE id = cliente;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clients_award_points_trg ON payments;
CREATE TRIGGER clients_award_points_trg
  AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION clients_award_points();
