// POST /api/feedback — registra un voto 👍/👎 sobre una respuesta concreta del chat.
// Autenticado (mismo patrón que /api/chat). El estado de suscripción no interviene aquí.
const { verificarSesion, fetchWithTimeout, redisCommand } = require('./_common');

async function redisPipeline(commands) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetchWithTimeout(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  }, 5000);
  if (!res.ok) return null;
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const userId = await verificarSesion(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return res.status(503).json({ error: 'Redis no configurado' });
  }

  const { messageId, brand, model, year, question, usedManual, vote } = req.body || {};
  if (!messageId || (vote !== 'up' && vote !== 'down')) {
    return res.status(400).json({ error: 'Datos de feedback inválidos' });
  }

  try {
    const entry = JSON.stringify({
      brand: brand || '',
      model: model || '',
      year: year || '',
      question: String(question || '').slice(0, 300),
      usedManual: !!usedManual,
      vote,
      t: Date.now()
    });

    // SET ... NX: solo escribe si esta respuesta concreta no se había votado ya.
    // Evita que un reintento de red o un doble envío infle los contadores.
    const setResult = await redisCommand(['SET', `vm:fb:msg:${messageId}`, entry, 'NX']);

    if (setResult === 'OK') {
      await redisPipeline([
        ['INCR', vote === 'up' ? 'vm:fb:up' : 'vm:fb:down'],
        ['LPUSH', 'vm:fb:recent', entry],
        ['LTRIM', 'vm:fb:recent', '0', '199'],
      ]);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('feedback error:', e.message);
    return res.status(500).json({ error: 'No se pudo guardar el feedback' });
  }
};
