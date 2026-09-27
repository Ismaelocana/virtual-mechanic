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

// ── App nativa ───────────────────────────────────────────────────────────────
// La app Android (Capacitor) añade "VirtualMechanicApp/Android" al User-Agent.
// Mientras no use Google Play Billing, las peticiones desde ella no pueden
// abrir pagos de Stripe (política de Google Play para apps de solo acceso).
function esAppNativa(req) {
  return (req.headers['user-agent'] || '').includes('VirtualMechanicApp/');
}

// ── Suscripciones multifuente ────────────────────────────────────────────────
// Cada fuente de pago tiene su propio registro y solo escribe en él:
//   vm:sub:{userId}:stripe | :google | :apple
//     source, status, plan, premiumUntil, externalId, autoRenew, updatedAt
//     (+ customerId en Stripe)
// y un resumen que se recalcula tras cada escritura:
//   vm:sub:{userId}
//     schema=2, premium, premiumUntil, source, status, plan, updatedAt
// esPremium() y getSubscription() solo leen el resumen, así que funcionan
// igual pague el usuario donde pague. Toda escritura pasa por
// guardarSuscripcionFuente().
const FUENTES_PAGO = ['stripe', 'google', 'apple'];
const SCHEMA_SUSCRIPCION = '2';
const CAMPOS_ANTIGUOS = ['subscriptionId', 'customerId'];

const claveResumen = userId => `vm:sub:${userId}`;
const claveFuente = (userId, fuente) => `vm:sub:${userId}:${fuente}`;

function _normalizarFuente(fuente, raw) {
  const premiumUntil = raw.premiumUntil ? Number(raw.premiumUntil) : 0;
  return {
    source: fuente,
    premium: premiumUntil > Date.now(),
    premiumUntil,
    status: raw.status || 'none',
    plan: raw.plan || null,
    externalId: raw.externalId || null,
    autoRenew: raw.autoRenew === '1',
    updatedAt: raw.updatedAt ? Number(raw.updatedAt) : 0,
    customerId: raw.customerId || null,
  };
}

// Registro antiguo (antes de multifuente): un único hash vm:sub:{userId} sin
// `schema`, siempre de Stripe. Devuelve los campos que tendría en su registro
// de fuente, o null si no hay nada que migrar.
function _registroAntiguoAStripe(resumenRaw) {
  if (!resumenRaw || resumenRaw.schema === SCHEMA_SUSCRIPCION) return null;
  if (!Object.keys(resumenRaw).length) return null;
  return {
    source: 'stripe',
    status: resumenRaw.status || 'none',
    plan: resumenRaw.plan || '',
    premiumUntil: resumenRaw.premiumUntil || 0,
    externalId: resumenRaw.subscriptionId || '',
    autoRenew: '',   // desconocido: lo rellenará el próximo evento de Stripe
    updatedAt: resumenRaw.updatedAt || Date.now(),
    customerId: resumenRaw.customerId || '',
  };
}

async function _hset(clave, campos) {
  const args = ['HSET', clave];
  for (const [k, v] of Object.entries(campos)) args.push(k, v === null || v === undefined ? '' : String(v));
  return redisCommand(args);
}

// Elige el resumen a partir de los registros de fuente: manda la fuente con el
// premiumUntil más lejano; si ninguna está activa, la actualizada más reciente.
function _calcularResumen(fuentes) {
  const lista = Object.values(fuentes);
  const ahora = Date.now();
  const activas = lista.filter(f => f.premiumUntil > ahora).sort((a, b) => b.premiumUntil - a.premiumUntil);
  const principal = activas[0] || lista.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  return {
    schema: SCHEMA_SUSCRIPCION,
    premium: activas.length ? '1' : '0',
    premiumUntil: activas.length ? activas[0].premiumUntil : 0,
    source: principal ? principal.source : '',
    status: principal ? principal.status : 'none',
    plan: principal && principal.plan ? principal.plan : '',
    updatedAt: ahora,
  };
}

// Lee los registros de todas las fuentes existentes del usuario.
async function getFuentesSuscripcion(userId) {
  const fuentes = {};
  for (const fuente of FUENTES_PAGO) {
    const raw = _flatToObj(await redisCommand(['HGETALL', claveFuente(userId, fuente)]));
    if (Object.keys(raw).length) fuentes[fuente] = _normalizarFuente(fuente, raw);
  }
  return fuentes;
}

// Pasa un registro antiguo al formato multifuente (idempotente). Guarda antes
// una copia del hash original en vm:subbak:{userId} durante 90 días.
// Con { simular: true } no escribe nada y devuelve lo que haría.
async function migrarSuscripcionAntigua(userId, { simular = false } = {}) {
  const resumenRaw = _flatToObj(await redisCommand(['HGETALL', claveResumen(userId)]));
  const stripe = _registroAntiguoAStripe(resumenRaw);
  if (!stripe) return { migrado: false, antes: resumenRaw };

  const fuentes = await getFuentesSuscripcion(userId);
  if (!fuentes.stripe) fuentes.stripe = _normalizarFuente('stripe', stripe);
  const resumen = _calcularResumen(fuentes);
  const resultado = { migrado: true, antes: resumenRaw, stripe, resumen };
  if (simular) return resultado;

  await redisCommand(['SET', `vm:subbak:${userId}`, JSON.stringify(resumenRaw), 'EX', String(90 * 86400)]);
  const existe = await redisCommand(['EXISTS', claveFuente(userId, 'stripe')]);
  if (!existe) await _hset(claveFuente(userId, 'stripe'), stripe);
  await _hset(claveResumen(userId), resumen);
  await redisCommand(['HDEL', claveResumen(userId), ...CAMPOS_ANTIGUOS]);
  return resultado;
}

// Única vía de escritura del estado de pago: actualiza (fusiona) el registro de
// UNA fuente y recalcula el resumen. `campos` usa los nombres del registro de
// fuente (status, plan, premiumUntil, externalId, autoRenew, customerId).
async function guardarSuscripcionFuente(userId, fuente, campos) {
  if (!FUENTES_PAGO.includes(fuente)) throw new Error(`Fuente de pago desconocida: ${fuente}`);
  await migrarSuscripcionAntigua(userId);
  await _hset(claveFuente(userId, fuente), { ...campos, source: fuente, updatedAt: Date.now() });
  const resumen = _calcularResumen(await getFuentesSuscripcion(userId));
  await _hset(claveResumen(userId), resumen);
  return resumen;
}

// Estado de suscripción del usuario (resumen). Siempre devuelve un objeto
// normalizado (por defecto, usuario gratuito). Premium se decide por `premiumUntil`.
async function getSubscription(userId) {
  let raw = {};
  try {
    raw = _flatToObj(await redisCommand(['HGETALL', claveResumen(userId)]));
  } catch (e) {
    console.error('getSubscription error:', e.message);
  }
  const premiumUntil = raw.premiumUntil ? Number(raw.premiumUntil) : 0;
  return {
    premium: premiumUntil > Date.now(),
    premiumUntil,
    // Registro antiguo sin `source`: solo podía venir de Stripe
    source: raw.source || (raw.schema !== SCHEMA_SUSCRIPCION && raw.subscriptionId ? 'stripe' : null),
    status: raw.status || 'none',
    plan: raw.plan || null,
  };
}

// Registro de una fuente concreta (p. ej. el customerId de Stripe para el
// checkout y el portal). Si el usuario aún tiene el registro antiguo, se lee de ahí.
async function getSuscripcionFuente(userId, fuente) {
  try {
    const raw = _flatToObj(await redisCommand(['HGETALL', claveFuente(userId, fuente)]));
    if (Object.keys(raw).length) return _normalizarFuente(fuente, raw);
    if (fuente === 'stripe') {
      const antiguo = _registroAntiguoAStripe(_flatToObj(await redisCommand(['HGETALL', claveResumen(userId)])));
      if (antiguo) return _normalizarFuente('stripe', antiguo);
    }
  } catch (e) {
    console.error('getSuscripcionFuente error:', e.message);
  }
  return _normalizarFuente(fuente, {});
}

// Comprobación ligera de premium (usada por chat.js). Lee solo el resumen.
// Fail-safe: ante cualquier fallo, devuelve false (trata al usuario como gratuito).
async function esPremium(userId) {
  try {
    const v = await redisCommand(['HGET', claveResumen(userId), 'premiumUntil']);
    return v ? Number(v) > Date.now() : false;
  } catch (e) {
    console.error('esPremium error:', e.message);
    return false;
  }
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
  FUENTES_PAGO,
  getSubscription,
  getSuscripcionFuente,
  getFuentesSuscripcion,
  guardarSuscripcionFuente,
  migrarSuscripcionAntigua,
  esPremium,
  mapCustomerToUser,
  getUserByCustomer,
  mondayOf,
  esAppNativa,
};
