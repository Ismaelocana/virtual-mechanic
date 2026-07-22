// POST /api/stripe-portal — crea una sesión del Customer Portal de Stripe para
// que el usuario autenticado gestione o cancele su suscripción. Devuelve { url }.
const { verificarSesion, getSubscription } = require('./_common');
const { stripeRequest } = require('./_stripe');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const userId = await verificarSesion(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Pagos no configurados (falta STRIPE_SECRET_KEY)' });
  }

  try {
    const sub = await getSubscription(userId);
    if (!sub.customerId) {
      return res.status(404).json({ error: 'No tienes ninguna suscripción todavía' });
    }

    const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : 'https://virtual-mechanic.vercel.app');

    const session = await stripeRequest('billing_portal/sessions', {
      customer: sub.customerId,
      return_url: `${origin}/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('stripe-portal error:', e.message);
    return res.status(500).json({ error: 'No se pudo abrir el portal de gestión' });
  }
};
