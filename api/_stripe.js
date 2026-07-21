// Cliente ligero de la API REST de Stripe vía fetch.
// Se evita el SDK oficial 'stripe' porque el tracer legacy de @vercel/node no lo
// empaqueta (su exports map ESM causa "Cannot find module", igual que @clerk/backend).
// Stripe usa cuerpos application/x-www-form-urlencoded con notación de corchetes.
const { fetchWithTimeout } = require('./_common');

// Aplana un objeto/array anidado a pares clave[bracket]=valor para form-urlencoded.
function _encode(params, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') _encode(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (typeof v === 'object') {
      _encode(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return out;
}

// Llama a la API de Stripe. `path` p.ej. 'customers' o 'checkout/sessions'.
// Lanza un Error (con .stripe = objeto de error de Stripe) si la respuesta no es OK.
async function stripeRequest(path, params, method = 'POST') {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY no configurada');
  const body = params ? _encode(params).join('&') : undefined;
  const res = await fetchWithTimeout(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  }, 10000);
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json && json.error ? json.error.message : `Stripe HTTP ${res.status}`);
    err.stripe = json && json.error;
    throw err;
  }
  return json;
}

module.exports = { stripeRequest, _encode };
