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
-- Mismo juego de columnas que ya usa clientes: tipo y número. El tipo
-- se limita a los dos que nombra el enunciado.

ALTER TABLE agentes ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(4);
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(32);

ALTER TABLE administradores ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(4);
ALTER TABLE administradores ADD COLUMN IF NOT EXISTS numero_documento VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agentes_document_type') THEN
    ALTER TABLE agentes ADD CONSTRAINT agentes_document_type
      CHECK (tipo_documento IS NULL OR tipo_documento IN ('CC', 'PAS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'administradores_document_type') THEN
    ALTER TABLE administradores ADD CONSTRAINT administradores_document_type
      CHECK (tipo_documento IS NULL OR tipo_documento IN ('CC', 'PAS'));
  END IF;
END $$;

-- El documento identifica a la persona, así que no se puede repetir.
-- Índice parcial: las cuentas viejas que todavía no lo tienen quedan
-- fuera del índice en vez de chocar entre ellas por ser todas nulas.
CREATE UNIQUE INDEX IF NOT EXISTS agentes_un_documento
  ON agentes (numero_documento) WHERE numero_documento IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS administradores_un_documento
  ON administradores (numero_documento) WHERE numero_documento IS NOT NULL;


-- ------------------------------------------------------------------
--  Clientes: puntos y publicidad
-- ------------------------------------------------------------------
-- puntos: puntos acumulados por compras. Arranca en cero y no puede
-- ser negativo.
-- ve_publicidad: si el cliente acepta ver publicidad en su panel.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS puntos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ve_publicidad BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clientes_puntos_no_negativos') THEN
    ALTER TABLE clientes ADD CONSTRAINT clientes_puntos_no_negativos
      CHECK (puntos >= 0);
  END IF;
END $$;


-- ------------------------------------------------------------------
--  Agentes: comisión y experiencia
-- ------------------------------------------------------------------
-- comision: porcentaje que recibe el agente por cada venta.
-- Se guarda como porcentaje (5.50 = 5,5 %), no como fracción, porque
-- es como lo escribe quien administra la cuenta.
-- anios_experiencia: años de experiencia del agente.

ALTER TABLE agentes ADD COLUMN IF NOT EXISTS comision NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS anios_experiencia SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agentes_comision_valida') THEN
    ALTER TABLE agentes ADD CONSTRAINT agentes_comision_valida
      CHECK (comision >= 0 AND comision <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agentes_experiencia_valida') THEN
    ALTER TABLE agentes ADD CONSTRAINT agentes_experiencia_valida
      CHECK (anios_experiencia >= 0 AND anios_experiencia <= 70);
  END IF;
END $$;


-- ------------------------------------------------------------------
--  Administradores: salario y horario
-- ------------------------------------------------------------------
-- salario: en pesos, con la misma precisión que el resto del dinero
-- del sistema (NUMERIC, nunca punto flotante).
-- horario: el turno en texto, porque el enunciado no define una
-- estructura y en la práctica se escribe «Lunes a viernes, 8:00 a 17:00».

ALTER TABLE administradores ADD COLUMN IF NOT EXISTS salario NUMERIC(12, 2);
ALTER TABLE administradores ADD COLUMN IF NOT EXISTS horario VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'administradores_salario_positivo') THEN
    ALTER TABLE administradores ADD CONSTRAINT administradores_salario_positivo
      CHECK (salario IS NULL OR salario > 0);
  END IF;
END $$;


-- ------------------------------------------------------------------
--  Los puntos se ganan solos al pagar
-- ------------------------------------------------------------------
-- Sin esto, puntos sería una columna que nadie llena nunca. La regla es
-- simple y queda en la base, no en la aplicación, por la misma razón que
-- el resto de disparadores: un pago registrado desde cualquier otro
-- programa también debe sumar los puntos.
--
-- Un punto por cada mil pesos de la reserva, sin decimales.

CREATE OR REPLACE FUNCTION clientes_suma_puntos()
RETURNS TRIGGER AS $$
DECLARE
  cliente  BIGINT;
  ganados  INTEGER;
BEGIN
  -- Solo cuando el pago queda en un estado que cuenta como pagado, y solo
  -- la primera vez que llega a ese estado.
  IF NOT EXISTS (SELECT 1 FROM estados_pago
                  WHERE codigo = NEW.estado AND es_pagado) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = NEW.estado THEN
    RETURN NEW;
  END IF;

  SELECT r.id_cliente, FLOOR(r.valor_total / 1000)::INTEGER
    INTO cliente, ganados
    FROM reservas r
   WHERE r.id = NEW.id_reserva;

  IF cliente IS NOT NULL AND ganados > 0 THEN
    UPDATE clientes SET puntos = puntos + ganados WHERE id = cliente;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clientes_suma_puntos_trg ON pagos;
CREATE TRIGGER clientes_suma_puntos_trg
  AFTER INSERT OR UPDATE OF estado ON pagos
  FOR EACH ROW EXECUTE FUNCTION clientes_suma_puntos();
