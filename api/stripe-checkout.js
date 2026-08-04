// POST /api/stripe-checkout — crea una sesión de Stripe Checkout (suscripción)
// asociada al userId de Clerk autenticado. Devuelve { url } para redirigir.
// El estado premium NO se marca aquí: solo lo hará el webhook al confirmarse el pago.
const { verificarSesion, getSubscription, hsetSubscription, mapCustomerToUser } = require('./_common');
const { stripeRequest } = require('./_stripe');

const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  annual: process.env.STRIPE_PRICE_ANNUAL,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // 1) Autenticación (mismo mecanismo que /api/chat)
  const userId = await verificarSesion(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  // 2) Configuración necesaria
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Pagos no configurados (falta STRIPE_SECRET_KEY)' });
  }
  const plan = (req.body && req.body.plan) || 'monthly';
  const price = PRICES[plan];
  if (!price) {
    return res.status(400).json({ error: 'Plan no válido o price ID no configurado' });
  }

  try {
    // 3) Reutiliza el Customer del usuario si ya existe; si no, lo crea y lo guarda
    const sub = await getSubscription(userId);
    let customerId = sub.customerId;
    if (!customerId) {
      const customer = await stripeRequest('customers', { metadata: { clerkUserId: userId } });
      customerId = customer.id;
      await hsetSubscription(userId, { customerId });
      await mapCustomerToUser(customerId, userId);
    }

    // 4) URLs de retorno (a partir del origen de la petición)
    const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : 'https://virtual-mechanic.vercel.app');

    // 5) Sesión de Checkout. client_reference_id y metadata llevan el userId de Clerk
    //    para que el webhook sepa a quién marcar como premium.
    const session = await stripeRequest('checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { clerkUserId: userId } },
      allow_promotion_codes: true,
      success_url: `${origin}/app?checkout=success`,
      cancel_url: `${origin}/app?checkout=cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('stripe-checkout error:', e.message);
    return res.status(500).json({ error: 'No se pudo iniciar el pago' });
  }
};
