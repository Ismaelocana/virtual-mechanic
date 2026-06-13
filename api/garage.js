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

const KEY = uid => `vm:garage:${uid}`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.UPSTASH_REDIS_REST_URL)
    return res.status(503).json({ error: 'Redis no configurado' });

  const userId = req.query.userId ?? req.body?.userId;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });

  // ── GET lista de motos ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const raw = await redis('GET', KEY(userId));
    return res.json(raw ? JSON.parse(raw) : []);
  }

  // ── POST añadir moto ───────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { bikeId, brand, category, engine, model, year } = req.body ?? {};
    if (!bikeId || !brand || !model || !year)
      return res.status(400).json({ error: 'bikeId, brand, model y year requeridos' });

    const raw = await redis('GET', KEY(userId));
    let garage = raw ? JSON.parse(raw) : [];

    // Evitar duplicados exactos (mismo brand+model+year)
    if (!garage.some(b => b.brand === brand && b.model === model && String(b.year) === String(year))) {
      garage.push({ bikeId, brand, category, engine, model, year, addedAt: new Date().toISOString() });
      if (garage.length > 20) garage = garage.slice(-20);
      await redis('SET', KEY(userId), JSON.stringify(garage));
    }
    return res.json({ ok: true });
  }

  // ── DELETE eliminar moto ───────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { bikeId } = req.query;
    if (!bikeId) return res.status(400).json({ error: 'bikeId requerido' });

    const raw = await redis('GET', KEY(userId));
    if (raw) {
      const garage = JSON.parse(raw).filter(b => b.bikeId !== bikeId);
      await redis('SET', KEY(userId), JSON.stringify(garage));
    }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
};
