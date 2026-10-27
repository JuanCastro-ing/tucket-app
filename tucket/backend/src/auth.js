/* Sesión: un JWT firmado que viaja en una cookie HttpOnly.
   El rol ('agente' o 'cliente') va dentro del token, así que los guardias
   de abajo no necesitan volver a consultar la base en cada petición. */
const jwt = require('jsonwebtoken');

const COOKIE = 'tucket_session';
const DURACION_HORAS = 8;

function secreto() {
  const valor = process.env.JWT_SECRET;
  if (!valor || valor.length < 32 || valor.includes('CAMBIA')) return null;
  return valor;
}

function opcionesCookie() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api'
  };
}

/* Firma el token y lo deja en la cookie de respuesta. */
function abrirSesion(res, { id, email, role }) {
  const clave = secreto();
  if (!clave) throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
  const payload = role === 'agente'
    ? { agentId: id, email, role }
    : { clientId: id, email, role };
  const token = jwt.sign(payload, clave, {
    algorithm: 'HS256', expiresIn: `${DURACION_HORAS}h`,
    issuer: 'tucket-api', audience: 'tucket-web'
  });
  res.cookie(COOKIE, token, { ...opcionesCookie(), maxAge: DURACION_HORAS * 60 * 60 * 1000 });
  return token;
}

function cerrarSesion(res) {
  res.clearCookie(COOKIE, opcionesCookie());
}

/* Lee y valida el token. Devuelve null si no hay sesión utilizable. */
function leerSesion(req) {
  const clave = secreto();
  if (!clave) return null;
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, clave, {
      algorithms: ['HS256'], issuer: 'tucket-api', audience: 'tucket-web'
    });
  } catch {
    return null;
  }
}

function idValido(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

/* Solo agentes: publicar y administrar eventos. */
function requireAgent(req, res, next) {
  if (!secreto()) return res.status(500).json({ error: 'JWT_SECRET debe tener al menos 32 caracteres.' });
  const payload = leerSesion(req);
  if (!payload) return res.status(401).json({ error: 'Inicia sesión como agente para continuar.' });
  const id = idValido(payload.agentId);
  if (payload.role !== 'agente' || !id) {
    return res.status(403).json({ error: 'Esta operación requiere una cuenta de agente.' });
  }
  req.agent = { id, email: payload.email };
  return next();
}

/* Solo clientes: reservar y gestionar sus propias reservas. */
function requireClient(req, res, next) {
  if (!secreto()) return res.status(500).json({ error: 'JWT_SECRET debe tener al menos 32 caracteres.' });
  const payload = leerSesion(req);
  if (!payload) return res.status(401).json({ error: 'Inicia sesión como cliente para continuar.' });
  const id = idValido(payload.clientId);
  if (payload.role !== 'cliente' || !id) {
    return res.status(403).json({ error: 'Esta operación requiere una cuenta de cliente.' });
  }
  req.client = { id, email: payload.email };
  return next();
}

module.exports = { abrirSesion, cerrarSesion, leerSesion, requireAgent, requireClient, COOKIE };
