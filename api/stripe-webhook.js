// POST /api/stripe-webhook — receptor de eventos de Stripe.
// ÚNICA vía que escribe el estado premium en Redis (fuente de verdad).
//
// PUNTO DELICADO — RAW BODY:
// La firma de Stripe se calcula sobre los BYTES EXACTOS del cuerpo. Vercel parsea
// el JSON por defecto y eso destruye los bytes originales. Por eso:
//   1) Se desactiva el body parser para esta función (config de abajo).
//   2) getRawBody() lee el stream y, por si acaso, acepta también Buffer/string.
// La firma se verifica a mano con crypto (HMAC-SHA256), sin el SDK de Stripe:
// el tracer de @vercel/node no empaqueta ese paquete (ver api/_stripe.js).
const crypto = require('crypto');
const { hsetSubscription, mapCustomerToUser, getUserByCustomer } = require('./_common');
const { stripeRequest } = require('./_stripe');

// ── Raw body ────────────────────────────────────────────────────────────────
async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  const chunks = [];
  try {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (e) {
    console.error('getRawBody error:', e.message);
  }
  if (chunks.length) return Buffer.concat(chunks);
  return null;   // el cuerpo ya venía parseado y se perdieron los bytes originales
}

// ── Verificación de la firma de Stripe (HMAC-SHA256) ────────────────────────
// Cabecera: Stripe-Signature: t=<timestamp>,v1=<hmac hex>[,v1=<otro>]
function verificarFirmaStripe(rawBody, sigHeader, secret, toleranciaSeg = 300) {
  if (!sigHeader || !secret || !rawBody) return false;
  let t = null;
  const firmas = [];
  for (const parte of String(sigHeader).split(',')) {
    const idx = parte.indexOf('=');
    if (idx === -1) continue;
    const clave = parte.slice(0, idx).trim();
    const valor = parte.slice(idx + 1).trim();
    if (clave === 't') t = valor;
    else if (clave === 'v1') firmas.push(valor);
  }
  if (!t || !firmas.length) return false;

  // Anti-replay: rechaza eventos con marca de tiempo demasiado antigua/futura
  const edad = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(edad) || edad > toleranciaSeg) return false;

  const esperado = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody.toString('utf8')}`, 'utf8')
    .digest('hex');
  const esperadoBuf = Buffer.from(esperado, 'utf8');

  // Comparación en tiempo constante
  return firmas.some(f => {
    const fBuf = Buffer.from(f, 'utf8');
    return fBuf.length === esperadoBuf.length && crypto.timingSafeEqual(fBuf, esperadoBuf);
  });
}

// ── Resolución del usuario de Clerk a partir del objeto del evento ──────────
async function resolverUserId(obj) {
  if (obj.metadata && obj.metadata.clerkUserId) return obj.metadata.clerkUserId;
  if (obj.client_reference_id) return obj.client_reference_id;
  if (obj.customer) return await getUserByCustomer(obj.customer);
  return null;
}

// Fin de periodo: Stripe movió current_period_end al item de la suscripción en
// versiones recientes de la API. Se leen ambas ubicaciones por robustez.
function finDePeriodoMs(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const seg = Number(sub.current_period_end || (item && item.current_period_end) || 0);
  return seg > 0 ? seg * 1000 : 0;
}

function planDesdePrecio(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  const priceId = item && item.price ? item.price.id : null;
  if (priceId && priceId === process.env.STRIPE_PRICE_ANNUAL) return 'annual';
  if (priceId && priceId === process.env.STRIPE_PRICE_MONTHLY) return 'monthly';
  return 'unknown';
}

// Guarda/actualiza el estado a partir de un objeto Subscription de Stripe.
async function guardarSuscripcion(userId, sub) {
  const activa = ['active', 'trialing'].includes(sub.status);
  const premiumUntil = activa ? finDePeriodoMs(sub) : 0;
  await hsetSubscription(userId, {
    premium: premiumUntil > Date.now() ? '1' : '0',
    premiumUntil,
    status: sub.status || 'unknown',
    plan: planDesdePrecio(sub),
    subscriptionId: sub.id || '',
    customerId: sub.customer || '',
    updatedAt: Date.now(),
  });
  if (sub.customer) await mapCustomerToUser(sub.customer, userId);
  console.log(`[webhook] ${userId} -> premium=${premiumUntil > Date.now()} status=${sub.status} hasta=${new Date(premiumUntil).toISOString()}`);
}

// ── Manejo de eventos ───────────────────────────────────────────────────────
async function manejarEvento(event) {
  const obj = event.data && event.data.object;
  if (!obj) return;

  switch (event.type) {
    // Alta inicial tras completar el pago
    case 'checkout.session.completed': {
      if (obj.mode && obj.mode !== 'subscription') return;
      const userId = await resolverUserId(obj);
      if (!userId) { console.error('[webhook] sin userId en checkout.session', obj.id); return; }
      if (obj.customer) await mapCustomerToUser(obj.customer, userId);
      if (obj.subscription) {
        const sub = await stripeRequest(`subscriptions/${obj.subscription}`, null, 'GET');
        await guardarSuscripcion(userId, sub);
      }
      break;
    }

    // Cambios de la suscripción (incluye programar cancelación a fin de periodo)
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const userId = await resolverUserId(obj);
      if (!userId) { console.error('[webhook] sin userId en subscription', obj.id); return; }
      await guardarSuscripcion(userId, obj);
      break;
    }

    // Baja efectiva -> vuelve a gratuito de inmediato
    case 'customer.subscription.deleted': {
      const userId = await resolverUserId(obj);
      if (!userId) { console.error('[webhook] sin userId en subscription.deleted', obj.id); return; }
      await hsetSubscription(userId, {
        premium: '0',
        premiumUntil: 0,
        status: 'canceled',
        subscriptionId: obj.id || '',
        updatedAt: Date.now(),
      });
      console.log(`[webhook] ${userId} -> premium=false (cancelada)`);
      break;
    }

    // Renovación cobrada -> extiende premiumUntil al nuevo fin de periodo
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const userId = await resolverUserId(obj);
      if (!userId) { console.error('[webhook] sin userId en invoice', obj.id); return; }
      const subId = obj.subscription || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
      if (!subId) return;
      const sub = await stripeRequest(`subscriptions/${subId}`, null, 'GET');
      await guardarSuscripcion(userId, sub);
      break;
    }

    // Fallo de cobro -> se marca past_due y NO se extiende: el premium caduca solo
    case 'invoice.payment_failed': {
      const userId = await resolverUserId(obj);
      if (!userId) return;
      await hsetSubscription(userId, { status: 'past_due', updatedAt: Date.now() });
      console.log(`[webhook] ${userId} -> pago fallido (past_due)`);
      break;
    }

    default:
      break;   // resto de eventos: se ignoran devolviendo 200
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] falta STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook no configurado' });
  }

  const raw = await getRawBody(req);
  if (!raw) {
    // Si esto ocurre, el body llegó ya parseado y no se puede verificar la firma.
    console.error('[webhook] RAW BODY no disponible: el body parser no está desactivado');
    return res.status(400).json({ error: 'Raw body no disponible' });
  }

  if (!verificarFirmaStripe(raw, req.headers['stripe-signature'], secret)) {
    console.error('[webhook] firma inválida');
    return res.status(400).json({ error: 'Firma inválida' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  try {
    await manejarEvento(event);
  } catch (e) {
    // 500 hace que Stripe reintente: correcto ante fallos transitorios (Redis, red...)
    console.error(`[webhook] error procesando ${event.type}:`, e.message);
    return res.status(500).json({ error: 'Error procesando el evento' });
  }

  return res.status(200).json({ received: true });
}

module.exports = handler;
// Desactiva el body parser de Vercel para conservar los bytes originales.
module.exports.config = { api: { bodyParser: false } };

// Exportado para pruebas locales de la verificación de firma
module.exports.verificarFirmaStripe = verificarFirmaStripe;
