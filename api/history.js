async function redis(...args) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([args]),
  });
  if (!res.ok) return null;
  const [{ result }] = await res.json();
  return result;
}

const LIST_KEY = uid => `vm:history:${uid}`;
const CHAT_KEY = (uid, cid) => `vm:chat:${uid}:${cid}`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return res.status(503).json({ error: 'Redis no configurado' });
  }

  const userId = req.query.userId ?? req.body?.userId;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  // ── GET lista de conversaciones ────────────────────────────────────────────
  if (req.method === 'GET' && !req.query.chatId) {
    const raw = await redis('GET', LIST_KEY(userId));
    return res.json(raw ? JSON.parse(raw) : []);
  }

  // ── GET conversación completa ──────────────────────────────────────────────
  if (req.method === 'GET' && req.query.chatId) {
    const raw = await redis('GET', CHAT_KEY(userId, req.query.chatId));
    return res.json(raw ? JSON.parse(raw) : null);
  }

  // ── POST guardar / actualizar conversación ─────────────────────────────────
  if (req.method === 'POST') {
    const { chatId, brand, model, year, messages, createdAt } = req.body ?? {};
    if (!chatId || !messages?.length) {
      return res.status(400).json({ error: 'chatId y messages requeridos' });
    }

    const now       = new Date().toISOString();
    const created   = createdAt || now;
    const preview   = messages.find(m => m.role === 'user')?.content?.slice(0, 100) ?? '';
    const userCount = messages.filter(m => m.role === 'user').length;

    // Guardar conversación completa
    await redis('SET', CHAT_KEY(userId, chatId),
      JSON.stringify({ chatId, brand, model, year, messages, createdAt: created, updatedAt: now }));

    // Actualizar índice de resúmenes: reemplazar entrada existente o añadir al frente
    const listRaw = await redis('GET', LIST_KEY(userId));
    let list = listRaw ? JSON.parse(listRaw) : [];
    const summary = { chatId, brand, model, year, createdAt: created, updatedAt: now, preview, messageCount: userCount };
    list = list.filter(c => c.chatId !== chatId);
    list.unshift(summary);
    if (list.length > 50) list.length = 50;
    await redis('SET', LIST_KEY(userId), JSON.stringify(list));

    return res.json({ ok: true });
  }

  // ── DELETE eliminar conversación ───────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { chatId } = req.query;
    if (!chatId) return res.status(400).json({ error: 'chatId requerido' });

    await redis('DEL', CHAT_KEY(userId, chatId));

    const listRaw = await redis('GET', LIST_KEY(userId));
    if (listRaw) {
      const list = JSON.parse(listRaw).filter(c => c.chatId !== chatId);
      await redis('SET', LIST_KEY(userId), JSON.stringify(list));
    }

    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
};
