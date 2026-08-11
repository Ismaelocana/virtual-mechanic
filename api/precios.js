// GET /api/precios — precios públicos del plan Premium, leídos en vivo de Stripe.
// Fuente única de verdad para la página pública /precios y el modal "Hazte
// Premium" de la app — así un cambio de precio en Stripe no exige tocar código
// en dos sitios (ni recordarse de hacerlo).
// Sin autenticación: es información pública, igual que /aviso-legal.
const { stripeRequest } = require('./_stripe');

// Último recurso si Stripe no responde, para que la página nunca se quede en
// blanco. NO es la fuente de verdad — solo se usa ante un fallo real.
const FALLBACK = {
  monthly: { amount: 499, currency: 'eur', interval: 'month' },
  annual: { amount: 4999, currency: 'eur', interval: 'year' },
};

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 3600000; // 1h — los precios cambian muy rara vez

async function leerPrecio(plan, priceId) {
  if (!priceId) return FALLBACK[plan];
  try {
    const p = await stripeRequest(`prices/${priceId}`, null, 'GET');
    return {
      amount: p.unit_amount,
      currency: p.currency,
      interval: (p.recurring && p.recurring.interval) || FALLBACK[plan].interval,
    };
  } catch (e) {
    console.error(`precios: fallo leyendo "${plan}" de Stripe:`, e.message);
    return FALLBACK[plan];
  }
}

async function obtenerPrecios() {
  const [monthly, annual] = await Promise.all([
    leerPrecio('monthly', process.env.STRIPE_PRICE_MONTHLY),
    leerPrecio('annual', process.env.STRIPE_PRICE_ANNUAL),
  ]);
  return { monthly, annual };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = Date.now();
  if (_cache && (now - _cacheAt) < CACHE_MS) {
    return res.status(200).json(_cache);
  }

  const precios = await obtenerPrecios();
  _cache = precios;
  _cacheAt = now;
  return res.status(200).json(precios);
};
