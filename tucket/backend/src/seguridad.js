/* Protecciones del servidor.

   Se escriben a mano en vez de instalar helmet y express-rate-limit, por
   dos razones: son pocas líneas, y así el equipo puede explicar qué hace
   cada una en vez de decir «lo pone una librería». Si el proyecto
   creciera, cambiarlas por esas librerías sería lo sensato. */

/* ------------------------------------------------------------------
   Cabeceras de seguridad

   Son instrucciones al navegador sobre qué permitir en esta página.
   Sin ellas, el navegador aplica sus valores por defecto, que son los
   más permisivos por compatibilidad con webs antiguas.
------------------------------------------------------------------ */
function cabecerasDeSeguridad(req, res, next) {
  /* No adivines el tipo de archivo. Sin esto, un archivo subido podría
     interpretarse como JavaScript aunque se sirva como imagen. */
  res.setHeader('X-Content-Type-Options', 'nosniff');

  /* Nadie puede meter esta página dentro de un <iframe> en otro sitio.
     Evita el clickjacking: superponer una página invisible sobre otra
     para que la víctima pulse botones que no ve. */
  res.setHeader('X-Frame-Options', 'DENY');

  /* Al salir hacia otro sitio, no se le cuenta la ruta completa de la
     que se viene; solo el dominio. */
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  /* Esta página no usa cámara, micrófono ni ubicación: se renuncia a
     ellos explícitamente para que nada pueda pedirlos. */
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  /* Qué puede cargar la página y de dónde. Es la cabecera que más
     protege contra XSS: aunque alguien lograra inyectar un <script>
     apuntando a otro servidor, el navegador se negaría a ejecutarlo.

     'unsafe-inline' sigue siendo necesario porque las vistas usan
     onclick="..." y estilos en línea. Quitarlo exigiría reescribir esos
     atributos como addEventListener; queda como mejora pendiente. */
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: https://res.cloudinary.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));

  /* Solo en producción: obliga al navegador a usar HTTPS durante un año.
     En el computador de desarrollo se trabaja por http y esta cabecera
     dejaría el sitio inaccesible. */
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return next();
}

/* ------------------------------------------------------------------
   Límite de intentos

   Sin esto, alguien puede probar contraseñas sin freno: con un script
   sencillo son miles por minuto. Se cuentan los intentos fallidos por
   dirección IP y se bloquea un rato al pasarse.

   El recuento vive en memoria, así que se pierde al reiniciar el
   servidor y no se comparte si algún día hubiera varias instancias. Para
   este proyecto basta; lo correcto a escala sería guardarlo en Redis o
   en la propia base.
------------------------------------------------------------------ */
function limitarIntentos({ intentos = 8, ventanaMinutos = 15, mensaje } = {}) {
  const ventana = ventanaMinutos * 60 * 1000;
  const registro = new Map();

  /* Limpieza periódica: sin esto el Map crecería para siempre con las IP
     que pasaron una vez. unref() evita que este temporizador impida que
     el proceso termine. */
  const limpieza = setInterval(() => {
    const ahora = Date.now();
    for (const [clave, datos] of registro) {
      if (ahora - datos.desde > ventana) registro.delete(clave);
    }
  }, ventana);
  if (limpieza.unref) limpieza.unref();

  return function (req, res, next) {
    /* Detrás de Render la IP real llega en X-Forwarded-For. */
    const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const clave = reenviada || req.ip || req.socket.remoteAddress || 'desconocida';
    const ahora = Date.now();
    const datos = registro.get(clave);

    if (datos && ahora - datos.desde < ventana && datos.fallos >= intentos) {
      const faltan = Math.ceil((ventana - (ahora - datos.desde)) / 60000);
      res.setHeader('Retry-After', String(faltan * 60));
      return res.status(429).json({
        error: mensaje || `Demasiados intentos fallidos. Espera ${faltan} minuto(s) y vuelve a intentarlo.`
      });
    }

    /* Solo cuentan los fallos: quien entra bien no gasta cupo. Se mira
       el código de respuesta cuando la petición ya terminó. */
    res.on('finish', () => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        const actual = registro.get(clave);
        if (!actual || ahora - actual.desde >= ventana) {
          registro.set(clave, { fallos: 1, desde: ahora });
        } else {
          actual.fallos += 1;
        }
      } else if (res.statusCode < 400) {
        registro.delete(clave);
      }
    });

    return next();
  };
}

module.exports = { cabecerasDeSeguridad, limitarIntentos };
