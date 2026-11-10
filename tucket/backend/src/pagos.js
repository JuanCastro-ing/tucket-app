/* Simulación de pasarela de pago.

   Tucket no cobra dinero real. Este módulo imita lo que haría una pasarela
   —validar la tarjeta, aprobar o rechazar, devolver una referencia— para
   que el sistema tenga el flujo completo sin mover un peso.

   Qué NO hace, a propósito:
     · no guarda el número de la tarjeta, ni el vencimiento, ni el código
       de seguridad: se validan aquí y se descartan;
     · no habla con ningún servicio externo;
     · no acepta datos de tarjetas reales como válidos salvo por la forma,
       porque la aprobación depende de un número de prueba conocido.

   Cómo decide aprobar o rechazar: por el número de tarjeta, de modo que en
   la sustentación se puedan mostrar los dos caminos a voluntad. */

/* Tarjetas de prueba. Son números inventados que pasan el algoritmo de
   Luhn; no corresponden a ninguna tarjeta emitida. */
const TARJETAS_DE_PRUEBA = {
  '4111111111111111': { marca: 'Visa',       resultado: 'Aprobado' },
  '5500000000000004': { marca: 'Mastercard', resultado: 'Aprobado' },
  '4000000000000002': { marca: 'Visa',       resultado: 'Rechazado', motivo: 'Fondos insuficientes.' },
  '4000000000000127': { marca: 'Visa',       resultado: 'Rechazado', motivo: 'Código de seguridad incorrecto.' }
};

/* Luhn: la comprobación que hace cualquier formulario de pago antes de
   molestar al banco. Detecta dígitos cambiados y transposiciones. */
function pasaLuhn(numero) {
  let suma = 0;
  let doble = false;
  for (let i = numero.length - 1; i >= 0; i -= 1) {
    let d = numero.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (doble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doble = !doble;
  }
  return numero.length >= 13 && suma % 10 === 0;
}

function marcaPorPrefijo(numero) {
  if (/^4/.test(numero)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(numero)) return 'Mastercard';
  if (/^3[47]/.test(numero)) return 'American Express';
  return 'Tarjeta';
}

/* El vencimiento llega como MM/AA. Se compara contra el mes en curso. */
function vencimientoValido(mmaa) {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(mmaa || '').trim());
  if (!m) return false;
  const mes = Number(m[1]);
  const anio = 2000 + Number(m[2]);
  if (mes < 1 || mes > 12) return false;
  const ahora = new Date();
  /* El día 1 del mes siguiente: una tarjeta vence al terminar su mes. */
  return new Date(anio, mes, 1) > ahora;
}

/* Referencia de la operación, como la que devolvería una pasarela.
   Lleva la fecha para que sea legible y un tramo aleatorio para que no se
   repita aunque dos pagos caigan en el mismo milisegundo. */
function referenciaNueva() {
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const azar = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SIM-${hoy}-${azar}`;
}

/* Procesa el intento y devuelve qué habría respondido una pasarela.
   No toca la base de datos: eso es trabajo de la ruta. */
function procesarTarjeta({ numero, vencimiento, cvv, titular }) {
  const limpio = String(numero || '').replace(/[\s-]/g, '');

  if (!/^\d{13,19}$/.test(limpio)) {
    return { ok: false, error: 'El número de la tarjeta debe tener entre 13 y 19 dígitos.' };
  }
  if (!pasaLuhn(limpio)) {
    return { ok: false, error: 'El número de la tarjeta no es válido.' };
  }
  if (!vencimientoValido(vencimiento)) {
    return { ok: false, error: 'La fecha de vencimiento no es válida o ya pasó.' };
  }
  if (!/^\d{3,4}$/.test(String(cvv || '').trim())) {
    return { ok: false, error: 'El código de seguridad debe tener 3 o 4 dígitos.' };
  }
  if (String(titular || '').trim().length < 5) {
    return { ok: false, error: 'Escribe el nombre que aparece en la tarjeta.' };
  }

  const prueba = TARJETAS_DE_PRUEBA[limpio];

  /* Una tarjeta bien formada que no está en la lista de prueba se rechaza.
     Es deliberado: evita que alguien escriba su tarjeta real y vea un
     «Aprobado» que podría hacerle creer que le cobraron. */
  if (!prueba) {
    return {
      ok: true,
      estado: 'Rechazado',
      motivo: 'Tarjeta no autorizada en el entorno de simulación.',
      marca: marcaPorPrefijo(limpio),
      ultimos4: limpio.slice(-4),
      referencia: referenciaNueva()
    };
  }

  return {
    ok: true,
    estado: prueba.resultado,
    motivo: prueba.motivo || null,
    marca: prueba.marca,
    ultimos4: limpio.slice(-4),
    referencia: referenciaNueva()
  };
}

module.exports = {
  TARJETAS_DE_PRUEBA,
  pasaLuhn,
  vencimientoValido,
  referenciaNueva,
  procesarTarjeta
};
