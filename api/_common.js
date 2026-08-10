// ─────────────────────────────────────────────────────────────────────────────
// Módulo común de la API de Virtual Mechanic.
// Reúne la verificación de sesión de Clerk (JWT) y los helpers de Upstash Redis,
// para reutilizarlos entre endpoints sin duplicar código.
// NOTA: los archivos que empiezan por "_" no son endpoints; se empaquetan como
// dependencia de las funciones que los requieren (Vercel los traza vía require).
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

// ── Utilidad: fetch con timeout ──────────────────────────────────────────────
async function fetchWithTimeout(url, options, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fecha (YYYY-MM-DD, UTC) del lunes de la semana que contiene `fecha`. Usado
// como sufijo de las claves Redis ':week:{semana}' — chat.js, feedback.js y
// admin.js deben calcular la misma clave para una fecha dada.
function mondayOf(fecha = new Date()) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dia = d.getUTCDay();                          // 0=domingo .. 6=sábado
  const diff = (dia === 0 ? -6 : 1) - dia;             // retrocede hasta el lunes
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── Verificación del JWT de sesión de Clerk (idéntica a la de chat.js) ───────
const CLERK_DOMAIN = 'clerk.virtualmechanic.es';

let _jwksCache = null;
let _jwksFetchedAt = 0;
async function getClerkJwks(forzarRefresco = false) {
  const now = Date.now();
  if (!forzarRefresco && _jwksCache && (now - _jwksFetchedAt) < 3600000) return _jwksCache;
  const res = await fetchWithTimeout(`https://${CLERK_DOMAIN}/.well-known/jwks.json`, {}, 5000);
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const json = await res.json();
  _jwksCache = json.keys || [];
  _jwksFetchedAt = now;
  return _jwksCache;
}

// Log de diagnóstico: registra POR QUÉ se rechaza una sesión, sin loguear
// nunca el token ni datos sensibles. Temporal, para distinguir en los logs
// de Vercel "sin token" de "caducado de verdad" de "firma inválida".
function rechazarSesion(motivo, detalle) {
  console.warn(`[verificarSesion] 401: ${motivo}${detalle ? ' | ' + detalle : ''}`);
  return null;
}

// Devuelve el userId (claim `sub`) si el token es válido, o null si falta/es inválido.
async function verificarSesion(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return rechazarSesion('sin header Authorization Bearer');
  const token = auth.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return rechazarSesion('token con formato inválido (no son 3 partes)');
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const signature = Buffer.from(parts[2], 'base64url');
    if (header.alg !== 'RS256' || !header.kid) return rechazarSesion('alg/kid inválido', `alg=${header.alg}`);

    let jwk = (await getClerkJwks()).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await getClerkJwks(true)).find(k => k.kid === header.kid);
    if (!jwk) return rechazarSesion('kid no encontrado en el JWKS de Clerk', `kid=${header.kid}`);
    const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!crypto.verify('RSA-SHA256', signingInput, pubKey, signature)) return rechazarSesion('firma inválida');

    const nowSec = Math.floor(Date.now() / 1000);
    const LEEWAY = 60;
    if (payload.exp && nowSec >= payload.exp + LEEWAY) {
      return rechazarSesion('token caducado', `caducado hace ${nowSec - payload.exp}s (margen ${LEEWAY}s)`);
    }
    if (payload.nbf && nowSec < payload.nbf - LEEWAY) {
      return rechazarSesion('token aún no válido (nbf)', `faltan ${payload.nbf - nowSec}s`);
    }

    return payload.sub || null;
  } catch (e) {
    console.error('verificarSesion error (excepción):', e.message);
    return null;
  }
}

// ── Helpers de Upstash Redis (REST) ──────────────────────────────────────────
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Ejecuta un comando Redis suelto. Devuelve el `result` (o null si Redis no está
// configurado). Lanza si Redis responde con error.
async function redisCommand(args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetchWithTimeout(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  }, 3000);
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error(`Redis: ${json.error}`);
  return json ? json.result : null;
}

// Convierte el array plano [campo, valor, campo, valor, ...] de HGETALL en objeto.
function _flatToObj(arr) {
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
}

// Lee el estado de suscripción de un usuario. Siempre devuelve un objeto normalizado
// (por defecto, usuario gratuito). El acceso premium se decide por `premiumUntil`.
async function getSubscription(userId) {
  let raw = {};
  try {
    raw = _flatToObj(await redisCommand(['HGETALL', `vm:sub:${userId}`]));
  } catch (e) {
    console.error('getSubscription error:', e.message);
  }
  const premiumUntil = raw.premiumUntil ? Number(raw.premiumUntil) : 0;
  return {
    premium: premiumUntil > Date.now(),
    premiumUntil,
    status: raw.status || 'none',
    plan: raw.plan || null,
    customerId: raw.customerId || null,
    subscriptionId: raw.subscriptionId || null,
  };
}

// Comprobación ligera de premium (usada por chat.js más adelante).
// Fail-safe: ante cualquier fallo, devuelve false (trata al usuario como gratuito).
async function esPremium(userId) {
  try {
    const v = await redisCommand(['HGET', `vm:sub:${userId}`, 'premiumUntil']);
    return v ? Number(v) > Date.now() : false;
  } catch (e) {
    console.error('esPremium error:', e.message);
    return false;
  }
}

// Escribe campos en el hash de suscripción del usuario (vm:sub:{userId}).
async function hsetSubscription(userId, fields) {
  const args = ['HSET', `vm:sub:${userId}`];
  for (const [k, v] of Object.entries(fields)) args.push(k, String(v));
  return redisCommand(args);
}

// Mapa inverso Stripe customer -> userId, para resolver el usuario en el webhook.
async function mapCustomerToUser(customerId, userId) {
  return redisCommand(['SET', `vm:stripecust:${customerId}`, userId]);
}

async function getUserByCustomer(customerId) {
  try {
    return await redisCommand(['GET', `vm:stripecust:${customerId}`]);
  } catch (e) {
    console.error('getUserByCustomer error:', e.message);
    return null;
  }
}

module.exports = {
  fetchWithTimeout,
  verificarSesion,
  redisCommand,
  getSubscription,
  esPremium,
  hsetSubscription,
  mapCustomerToUser,
  getUserByCustomer,
  mondayOf,
};
