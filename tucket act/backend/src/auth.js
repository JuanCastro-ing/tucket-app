const jwt = require('jsonwebtoken');

function requireAgent(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.includes('CAMBIA')) {
    return res.status(500).json({ error: 'JWT_SECRET debe tener al menos 32 caracteres.' });
  }

  const token = req.cookies?.tucket_session;
  if (!token) return res.status(401).json({ error: 'Inicia sesión como agente para continuar.' });

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'], issuer: 'tucket-api', audience: 'tucket-web'
    });
    const agentId = Number(payload.agentId);
    if (payload.role !== 'agente' || !Number.isSafeInteger(agentId) || agentId < 1) {
      return res.status(403).json({ error: 'Esta operación requiere una cuenta de agente.' });
    }
    req.agent = { id: agentId, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'La sesión venció o no es válida. Inicia sesión otra vez.' });
  }
}

module.exports = { requireAgent };
