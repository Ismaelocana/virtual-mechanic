// DELETE /api/account — elimina la cuenta del usuario autenticado y sus datos.
// Requisito de Google Play para apps que permiten crear cuenta.
//
// Orden (cada paso es idempotente, así que si algo falla se puede reintentar):
//   1) Stripe: borra el Customer. Eso cancela al momento cualquier suscripción
//      activa y elimina los métodos de pago guardados. Las facturas y cobros ya
//      emitidos los conserva Stripe por obligación legal.
//      Si falla, se aborta sin haber borrado nada.
//   2) Redis: historial, chats, garaje, suscripción (resumen + fuentes + copia),
//      contadores de límite y marca de actividad semanal.
//   3) Clerk: borra el usuario (último, para que un fallo previo permita reintentar
//      con la sesión aún válida).
// Las suscripciones de Google Play / App Store no se pueden cancelar desde aquí:
// el frontend avisa al usuario de que lo haga en la tienda antes de continuar.
// Las estadísticas y valoraciones anónimas (sin userId) no se tocan.
const {
  verificarSesion, redisCommand, mondayOf, FUENTES_PAGO, getSuscripcionFuente, fetchWithTimeout,
  marcarCuentaEliminada, desmarcarCuentaEliminada,
} = require('./_common');
const { stripeRequest } = require('./_stripe');

async function scanClaves(patron) {
  const claves = [];
  let cursor = '0';
  do {
    const [siguiente, lote] = await redisCommand(['SCAN', cursor, 'MATCH', patron, 'COUNT', '500']);
    cursor = siguiente;
    claves.push(...lote);
  } while (cursor !== '0');
  return claves;
}

async function borrarDatosRedis(userId, customerId) {
  const chats = await scanClaves(`vm:chat:${userId}:*`);
  const claves = [
    ...chats,
    `vm:history:${userId}`,
    `vm:garage:${userId}`,
    `vm:rl:d:${userId}`,
    `vm:rl:w:${userId}`,
    `vm:sub:${userId}`,
    ...FUENTES_PAGO.map(f => `vm:sub:${userId}:${f}`),
    `vm:subbak:${userId}`,
  ];
  if (customerId) claves.push(`vm:stripecust:${customerId}`);
  // DEL admite varias claves; se trocea por si hubiera muchos chats
  for (let i = 0; i < claves.length; i += 100) {
    await redisCommand(['DEL', ...claves.slice(i, i + 100)]);
  }
  const semanaPasada = mondayOf(new Date(Date.now() - 7 * 86400000));
  await redisCommand(['SREM', `vm:active:week:${mondayOf()}`, userId]);
  await redisCommand(['SREM', `vm:active:week:${semanaPasada}`, userId]);
  return claves.length;
}

async function borrarUsuarioClerk(userId) {
  const res = await fetchWithTimeout(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
  }, 10000);
  if (res.ok || res.status === 404) return;
  throw new Error(`Clerk HTTP ${res.status}`);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Método no permitido' });

  const userId = await verificarSesion(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  if (!process.env.CLERK_SECRET_KEY) {
    console.error('[account] falta CLERK_SECRET_KEY');
    return res.status(500).json({ error: 'No se pudo eliminar la cuenta. Escríbenos a soporte@virtualmechanic.es' });
  }

  // Marca antes de tocar Stripe: la baja que notifique su webhook se ignorará
  const stripe = await getSuscripcionFuente(userId, 'stripe');
  await marcarCuentaEliminada(userId);

  // 1) Stripe
  if (stripe.customerId) {
    try {
      await stripeRequest(`customers/${stripe.customerId}`, null, 'DELETE');
    } catch (e) {
      if (!(e.stripe && e.stripe.code === 'resource_missing')) {
        console.error('[account] error borrando customer de Stripe:', e.message);
        await desmarcarCuentaEliminada(userId).catch(() => {});
        return res.status(502).json({ error: 'No se pudo cancelar tu suscripción. Inténtalo de nuevo o escríbenos a soporte@virtualmechanic.es' });
      }
    }
  }

  try {
    // 2) Redis
    const n = await borrarDatosRedis(userId, stripe.customerId);
    // 3) Clerk
    await borrarUsuarioClerk(userId);
    console.log(`[account] cuenta eliminada ${userId} (${n} claves, stripe=${stripe.customerId ? 'sí' : 'no'})`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[account] error eliminando cuenta:', e.message);
    return res.status(500).json({ error: 'No se pudo completar la eliminación. Inténtalo de nuevo o escríbenos a soporte@virtualmechanic.es' });
  }
};
