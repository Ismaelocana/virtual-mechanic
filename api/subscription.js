// GET /api/subscription — devuelve el estado de suscripción del usuario autenticado.
// Lo usa el frontend para pintar la UI (premium vs gratuito). Solo lee Redis.
const { verificarSesion, getSubscription } = require('./_common');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = await verificarSesion(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  const sub = await getSubscription(userId);
  return res.status(200).json({
    premium: sub.premium,
    plan: sub.plan,
    premiumUntil: sub.premiumUntil || null,
    status: sub.status,
  });
};
