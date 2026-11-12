#!/usr/bin/env node
/* Revisión de la base de datos: busca incoherencias en los datos.

   Es de SOLO LECTURA. No modifica ni borra nada: solo consulta y reporta.
   Se puede correr contra Neon sin ningún riesgo.

       cd backend
       npm run db:revisar

   Cada comprobación responde a algo que puede haberse colado con el tiempo:
   datos de prueba olvidados, imágenes que quedaron apuntando a archivos que
   ya no existen, eventos con la fecha pasada que siguen vendiendo, cuentas
   repetidas entre tablas… Lo que salga aquí hay que mirarlo a mano: el
   script señala, no arregla. */

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const pool = require('../src/db');

let problemas = 0;
let avisos = 0;

function titulo(texto) {
  console.log(`\n${texto}`);
  console.log('─'.repeat(texto.length));
}

/* nivel: 'error' = hay que corregirlo; 'aviso' = conviene mirarlo */
function reportar(nivel, mensaje, filas) {
  const marca = nivel === 'error' ? '  ✗' : '  !';
  console.log(`${marca} ${mensaje}`);
  if (filas && filas.length) {
    filas.slice(0, 10).forEach((f) => console.log(`       · ${f}`));
    if (filas.length > 10) console.log(`       … y ${filas.length - 10} más`);
  }
  if (nivel === 'error') problemas += 1; else avisos += 1;
}

function bien(mensaje) {
  console.log(`  ✓ ${mensaje}`);
}

async function filas(sql, params) {
  const r = await pool.query(sql, params || []);
  return r.rows;
}

async function revisar() {
  console.log('\n═══ REVISIÓN DE LA BASE DE DATOS DE TUCKET ═══');
  const quien = await filas('SELECT current_database() AS db, version() AS v');
  console.log(`Base: ${quien[0].db} · ${quien[0].v.split(',')[0]}`);

  /* ---------------------------------------------------------------- */
  titulo('1. Qué hay dentro');
  const conteos = await filas(`
    SELECT 'clientes' AS tabla, COUNT(*)::int AS n FROM clientes
    UNION ALL SELECT 'agentes', COUNT(*)::int FROM agentes
    UNION ALL SELECT 'administradores', COUNT(*)::int FROM administradores
    UNION ALL SELECT 'eventos', COUNT(*)::int FROM eventos
    UNION ALL SELECT 'reservas', COUNT(*)::int FROM reservas
    UNION ALL SELECT 'boletas', COUNT(*)::int FROM boletas
    UNION ALL SELECT 'solicitudes de agente', COUNT(*)::int FROM solicitudes_agente
    UNION ALL SELECT 'ciudades', COUNT(*)::int FROM ciudades`);
  conteos.forEach((c) => console.log(`    ${String(c.n).padStart(6)}  ${c.tabla}`));

  /* ---------------------------------------------------------------- */
  titulo('2. Cuentas');

  const correosCruzados = await filas(`
    SELECT correo AS "email", string_agg(origen, ' + ') AS tablas FROM (
      SELECT correo AS "email", 'cliente' AS origen FROM clientes WHERE activo
      UNION ALL SELECT correo AS "email", 'agente' FROM agentes WHERE activo
      UNION ALL SELECT correo AS "email", 'administrador' FROM administradores WHERE activo
    ) t GROUP BY correo HAVING COUNT(*) > 1`);
  if (correosCruzados.length) {
    reportar('error',
      'Hay correos registrados en más de una tabla. Al iniciar sesión solo entra el rol de mayor privilegio (administrador > agente > cliente) y la otra cuenta queda inaccesible:',
      correosCruzados.map((c) => `${c.email} → ${c.tablas}`));
  } else bien('Ningún correo está repetido entre clientes, agentes y administradores.');

  const docsRepetidos = await filas(`
    SELECT numero_documento AS "document_number", COUNT(*)::int AS n FROM clientes
     GROUP BY numero_documento HAVING COUNT(*) > 1`);
  if (docsRepetidos.length) {
    reportar('error', 'Documentos de identidad repetidos entre clientes:',
      docsRepetidos.map((d) => `${d.document_number} (${d.n} cuentas)`));
  } else bien('No hay documentos de identidad repetidos.');

  const inactivos = await filas(`
    SELECT 'clientes' AS t, COUNT(*)::int AS n FROM clientes WHERE NOT activo
    UNION ALL SELECT 'agentes', COUNT(*)::int FROM agentes WHERE NOT activo
    UNION ALL SELECT 'administradores', COUNT(*)::int FROM administradores WHERE NOT activo`);
  const totalInactivos = inactivos.reduce((a, b) => a + b.n, 0);
  if (totalInactivos) {
    reportar('aviso', `Hay ${totalInactivos} cuenta(s) desactivadas (no pueden iniciar sesión):`,
      inactivos.filter((i) => i.n).map((i) => `${i.n} ${i.t}`));
  } else bien('Todas las cuentas están activas.');

  const sinAdmin = await filas('SELECT COUNT(*)::int AS n FROM administradores WHERE activo');
  if (!sinAdmin[0].n) {
    reportar('error', 'No hay ningún administrador activo: nadie puede aprobar solicitudes de agente ni ver los reportes. Se crea con `npm run admin:create`.');
  } else bien(`Hay ${sinAdmin[0].n} administrador(es) activo(s).`);

  /* ---------------------------------------------------------------- */
  titulo('3. Códigos de evento');

  const secuencia = await filas(`
    SELECT last_value, is_called FROM eventos_codigo_seq`);
  const maxNuevo = await filas(`
    SELECT COALESCE(MAX(SUBSTRING(codigo FROM '^EVT-([0-9]{5,})$')::BIGINT), 0) AS m
      FROM eventos WHERE codigo ~ '^EVT-[0-9]{5,}$'`);
  const sig = secuencia[0].is_called ? Number(secuencia[0].last_value) + 1 : Number(secuencia[0].last_value);
  console.log(`    Próximo código a entregar: EVT-${String(sig).padStart(5, '0')}`);
  if (Number(maxNuevo[0].m) >= sig) {
    reportar('error',
      `La secuencia va por detrás de los códigos que ya existen (el mayor es EVT-${String(maxNuevo[0].m).padStart(5, '0')}). Los próximos intentos chocarán. Se corrige volviendo a correr \`npm run db:setup\`.`);
  } else bien('La secuencia de códigos va por delante de lo que ya existe.');

  const codigosViejos = await filas(`
    SELECT codigo AS "code", nombre AS "name" FROM eventos WHERE codigo !~ '^EVT-[0-9]{5,}$' ORDER BY codigo`);
  if (codigosViejos.length) {
    reportar('aviso',
      `${codigosViejos.length} evento(s) con códigos del formato antiguo, escritos a mano. No es un error —siguen siendo únicos— pero conviven dos formatos:`,
      codigosViejos.map((c) => `${c.code} · ${c.name}`));
  } else bien('Todos los eventos usan el formato de código nuevo.');

  const codigosDuplicados = await filas(`
    SELECT codigo AS "code", COUNT(*)::int AS n FROM eventos GROUP BY codigo HAVING COUNT(*) > 1`);
  if (codigosDuplicados.length) {
    reportar('error', 'CÓDIGOS DE EVENTO REPETIDOS:',
      codigosDuplicados.map((c) => `${c.code} (${c.n} veces)`));
  } else bien('No hay códigos de evento repetidos.');

  /* ---------------------------------------------------------------- */
  titulo('4. Imágenes');

  const enDisco = await filas(`
    SELECT codigo AS "code", nombre AS "name",
           (ruta_imagen LIKE '/uploads/%') AS afiche,
           (ruta_banner LIKE '/uploads/%') AS banner
      FROM eventos
     WHERE ruta_imagen LIKE '/uploads/%' OR ruta_banner LIKE '/uploads/%'
     ORDER BY codigo`);
  if (enDisco.length) {
    reportar('error',
      `${enDisco.length} evento(s) con imágenes guardadas en el disco del servidor. En el servidor publicado ese disco se borra en cada despliegue, así que esas imágenes probablemente ya no existen y se ven rotas. Hay que volver a subirlas para que vayan a Cloudinary:`,
      enDisco.map((e) => `${e.code} · ${e.name} ${e.afiche ? '[afiche]' : ''}${e.banner ? '[banner]' : ''}`));
  } else bien('Ninguna imagen depende del disco del servidor.');

  const enNube = await filas(`
    SELECT COUNT(*)::int AS n FROM eventos WHERE ruta_imagen LIKE 'https://res.cloudinary.com/%'`);
  console.log(`    ${enNube[0].n} evento(s) con el afiche en Cloudinary.`);

  const sinAfiche = await filas(`
    SELECT codigo AS "code", nombre AS "name" FROM eventos WHERE ruta_imagen IS NULL ORDER BY codigo`);
  if (sinAfiche.length) {
    reportar('aviso', `${sinAfiche.length} evento(s) sin afiche (se ven con la marquesina azul):`,
      sinAfiche.map((e) => `${e.code} · ${e.name}`));
  } else bien('Todos los eventos tienen afiche.');

  const altVacio = await filas(`
    SELECT codigo AS "code" FROM eventos WHERE ruta_imagen IS NOT NULL AND (texto_imagen IS NULL OR btrim(texto_imagen) = '')`);
  if (altVacio.length) {
    reportar('aviso', `${altVacio.length} afiche(s) sin texto alternativo (accesibilidad):`,
      altVacio.map((e) => e.code));
  } else bien('Todos los afiches tienen texto alternativo.');

  /* ---------------------------------------------------------------- */
  titulo('5. Eventos');

  const fechasAlReves = await filas(`
    SELECT codigo AS "code", nombre AS "name", fecha_inicio AS "starts_at", fecha_fin AS "ends_at" FROM eventos WHERE fecha_fin <= fecha_inicio`);
  if (fechasAlReves.length) {
    reportar('error', 'Eventos que terminan antes de empezar:',
      fechasAlReves.map((e) => `${e.code} · inicia ${e.starts_at.toISOString()} termina ${e.ends_at.toISOString()}`));
  } else bien('Todas las fechas de fin son posteriores al inicio.');

  const vendiendoPasado = await filas(`
    SELECT codigo AS "code", nombre AS "name", fecha_inicio AS "starts_at", estado AS "status" FROM eventos
     WHERE estado IN ('En Boletería','Programado') AND fecha_fin < NOW() ORDER BY fecha_inicio`);
  if (vendiendoPasado.length) {
    reportar('aviso',
      `${vendiendoPasado.length} evento(s) con estado "${'En Boletería/Programado'}" pero cuya fecha ya pasó. La página los muestra como Finalizados, pero en la base siguen con el estado viejo:`,
      vendiendoPasado.map((e) => `${e.code} · ${e.name} · fue el ${e.starts_at.toISOString().slice(0,10)}`));
  } else bien('Ningún evento pasado sigue marcado como vigente.');

  const canceladoSinCausa = await filas(`
    SELECT codigo AS "code", nombre AS "name" FROM eventos
     WHERE estado = 'Cancelado' AND (motivo_cancelacion IS NULL OR btrim(motivo_cancelacion) = '')`);
  if (canceladoSinCausa.length) {
    reportar('error', 'Eventos cancelados sin causa registrada:',
      canceladoSinCausa.map((e) => `${e.code} · ${e.name}`));
  } else bien('Todo evento cancelado tiene su causa.');

  const precioCero = await filas(`SELECT codigo AS "code", nombre AS "name" FROM eventos WHERE precio_base = 0`);
  if (precioCero.length) {
    reportar('aviso', `${precioCero.length} evento(s) con precio 0 (¿son gratuitos a propósito?):`,
      precioCero.map((e) => `${e.code} · ${e.name}`));
  } else bien('Ningún evento tiene precio cero.');

  const sobrevendidos = await filas(`
    SELECT e.codigo AS "code", e.nombre AS "name", e.capacidad_total AS "total_capacity",
           COALESCE(SUM(r.cantidad), 0)::int AS reservadas
      FROM eventos e
      LEFT JOIN reservas r ON r.id_evento = e.id AND r.estado IN ('Reservada','Confirmada','Usada')
     GROUP BY e.id, e.codigo, e.nombre, e.capacidad_total
    HAVING COALESCE(SUM(r.cantidad), 0) > e.capacidad_total`);
  if (sobrevendidos.length) {
    reportar('error', 'EVENTOS SOBREVENDIDOS (más butacas reservadas que capacidad):',
      sobrevendidos.map((e) => `${e.code} · capacidad ${e.total_capacity} · reservadas ${e.reservadas}`));
  } else bien('Ningún evento está sobrevendido.');

  const huerfanos = await filas(`
    SELECT e.codigo AS "code", e.nombre AS "name" FROM eventos e
     LEFT JOIN agentes a ON a.id = e.id_agente
     WHERE a.id IS NULL OR NOT a.activo`);
  if (huerfanos.length) {
    reportar('aviso', 'Eventos cuyo agente ya no existe o está desactivado:',
      huerfanos.map((e) => `${e.code} · ${e.name}`));
  } else bien('Todos los eventos tienen un agente activo.');

  /* ---------------------------------------------------------------- */
  titulo('6. Reservas');

  const cuentasMal = await filas(`
    SELECT codigo AS "code", cantidad AS "quantity", precio_unitario AS "unit_price", valor_total AS "total_amount" FROM reservas
     WHERE valor_total <> precio_unitario * cantidad`);
  if (cuentasMal.length) {
    reportar('error', 'Reservas cuyo total no coincide con precio × cantidad:',
      cuentasMal.map((r) => `${r.code} · ${r.quantity} × ${r.unit_price} ≠ ${r.total_amount}`));
  } else bien('Todos los totales cuadran con precio × cantidad.');

  const boletasMal = await filas(`
    SELECT r.codigo AS "code", r.cantidad AS "quantity", COUNT(t.id)::int AS boletas
      FROM reservas r LEFT JOIN boletas t ON t.id_reserva = r.id
     WHERE r.estado <> 'Cancelada'
     GROUP BY r.id, r.codigo, r.cantidad
    HAVING COUNT(t.id) <> r.cantidad`);
  if (boletasMal.length) {
    reportar('error', 'Reservas con un número de boletas distinto a la cantidad reservada:',
      boletasMal.map((r) => `${r.code} · ${r.quantity} entradas pero ${r.boletas} boletas`));
  } else bien('Cada reserva vigente tiene una boleta por entrada.');

  const vivasEnCancelado = await filas(`
    SELECT r.codigo AS "code", e.codigo AS evento FROM reservas r
      JOIN eventos e ON e.id = r.id_evento
     WHERE e.estado = 'Cancelado' AND r.estado IN ('Reservada','Confirmada')`);
  if (vivasEnCancelado.length) {
    reportar('error',
      'Reservas todavía vigentes en eventos cancelados. El cliente cree que tiene entrada para algo que no se hará:',
      vivasEnCancelado.map((r) => `reserva ${r.code} · evento ${r.evento}`));
  } else bien('Ningún evento cancelado deja reservas vigentes.');

  const resSinCausa = await filas(`
    SELECT codigo AS "code" FROM reservas
     WHERE estado = 'Cancelada' AND (motivo_cancelacion IS NULL OR btrim(motivo_cancelacion) = '')`);
  if (resSinCausa.length) {
    /* No es un fallo: cuando el cliente cancela su propia reserva el motivo
       es opcional. Sí lo es cuando la cancelación vino de arriba, al
       cancelarse el evento, porque ahí el cliente merece una explicación. */
    console.log(`  · ${resSinCausa.length} reserva(s) cancelada(s) sin motivo. Es normal si las canceló el propio cliente: ahí el motivo es opcional.`);
  } else bien('Toda reserva cancelada tiene su causa.');

  const precioDesfasado = await filas(`
    SELECT r.codigo AS "code", r.precio_unitario AS "unit_price", e.precio_base AS "base_price", e.codigo AS evento
      FROM reservas r JOIN eventos e ON e.id = r.id_evento
     WHERE r.estado IN ('Reservada','Confirmada') AND r.precio_unitario <> e.precio_base`);
  if (precioDesfasado.length) {
    reportar('aviso',
      'Reservas cuyo precio por entrada ya no coincide con el del evento (normal si el agente cambió el precio después; se respeta el precio del momento de reservar):',
      precioDesfasado.map((r) => `${r.code} · pagó ${r.unit_price}, hoy vale ${r.base_price} (${r.evento})`));
  } else bien('Los precios de las reservas coinciden con los de sus eventos.');

  /* ---------------------------------------------------------------- */
  titulo('7. Solicitudes de agente');

  const aprobadaSinCuenta = await filas(`
    SELECT id, correo AS "email" FROM solicitudes_agente WHERE estado = 'Aprobada' AND id_agente IS NULL`);
  if (aprobadaSinCuenta.length) {
    reportar('error', 'Solicitudes aprobadas que no crearon la cuenta de agente:',
      aprobadaSinCuenta.map((s) => `#${s.id} · ${s.email}`));
  } else bien('Toda solicitud aprobada tiene su cuenta de agente.');

  const pendientes = await filas(`SELECT COUNT(*)::int AS n FROM solicitudes_agente WHERE estado = 'Pendiente'`);
  if (pendientes[0].n) {
    reportar('aviso', `${pendientes[0].n} solicitud(es) pendientes de revisar en el panel de administrador.`);
  } else bien('No hay solicitudes pendientes.');

  /* ---------------------------------------------------------------- */
  titulo('8. Datos de prueba');

  const prueba = await filas(`
    SELECT codigo AS "code", nombre AS "name" FROM eventos
     WHERE codigo LIKE 'DEMO-%' OR codigo LIKE 'TEST%' OR codigo LIKE 'VERIF%' OR codigo LIKE 'HERO-%'
        OR lower(nombre) LIKE '%prueba%' OR lower(nombre) LIKE '%test%'
     ORDER BY codigo`);
  if (prueba.length) {
    reportar('aviso',
      `${prueba.length} evento(s) que parecen de prueba. Si van a presentar el proyecto, conviene decidir cuáles se quedan:`,
      prueba.map((e) => `${e.code} · ${e.name}`));
  } else bien('No se ven eventos de prueba.');

  const cuentasPrueba = await filas(`
    SELECT correo AS "email", 'cliente' AS rol FROM clientes WHERE lower(correo) LIKE '%prueba%' OR lower(correo) LIKE '%test%'
    UNION ALL
    SELECT correo AS "email", 'agente' FROM agentes WHERE lower(correo) LIKE '%prueba%' OR lower(correo) LIKE '%test%'`);
  if (cuentasPrueba.length) {
    reportar('aviso', 'Cuentas que parecen de prueba:',
      cuentasPrueba.map((c) => `${c.email} (${c.rol})`));
  } else bien('No se ven cuentas de prueba.');

  /* ---------------------------------------------------------------- */
  titulo('9. Geografía');

  const geo = await filas(`
    SELECT (SELECT COUNT(*)::int FROM paises) AS paises,
           (SELECT COUNT(*)::int FROM departamentos) AS deptos,
           (SELECT COUNT(*)::int FROM ciudades) AS ciudades`);
  console.log(`    ${geo[0].paises} país(es) · ${geo[0].deptos} departamentos · ${geo[0].ciudades} ciudades`);
  if (geo[0].ciudades < 1000) {
    reportar('error',
      `Solo hay ${geo[0].ciudades} ciudades: el archivo DIVIPOLA no se cargó completo. Se arregla con \`npm run db:setup\`.`);
  } else bien('El listado de municipios está completo.');

  /* ---------------------------------------------------------------- */
  console.log('\n═══ RESUMEN ═══');
  console.log(`  ${problemas} problema(s) que conviene corregir`);
  console.log(`  ${avisos} aviso(s) para revisar\n`);
}

revisar()
  .catch((e) => { console.error('\nFalló la revisión:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
