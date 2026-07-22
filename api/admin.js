async function redisPipeline(commands) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!res.ok) return null;
  return await res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pwd = req.headers['x-admin-password'] || req.query.p;
  if (!process.env.ADMIN_PASSWORD || pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return res.json({ total: 0, today: 0, manual: 0, general: 0, days: [], brands: [], recent: [], sinManual: [], fbUp: 0, fbDown: 0, fbRecent: [] });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Obtener datos base + últimos 30 días en una sola pipeline
  const dayKeys = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  const pipeline = [
    ['GET', 'vm:total'],
    ['GET', 'vm:manual'],
    ['GET', 'vm:general'],
    ['GET', `vm:day:${today}`],
    ['ZREVRANGE', 'vm:brands', '0', '19', 'WITHSCORES'],
    ['LRANGE', 'vm:recent', '0', '49'],
    ['ZREVRANGE', 'vm:sin_manual', '0', '19', 'WITHSCORES'],
    ['GET', 'vm:fb:up'],
    ['GET', 'vm:fb:down'],
    ['LRANGE', 'vm:fb:recent', '0', '49'],
    ...dayKeys.map(d => ['GET', `vm:day:${d}`])
  ];

  const results = await redisPipeline(pipeline);
  if (!results) return res.json({ total: 0, today: 0, manual: 0, general: 0, days: [], brands: [], recent: [], sinManual: [], fbUp: 0, fbDown: 0, fbRecent: [] });

  const [totalR, manualR, generalR, todayR, brandsR, recentR, sinManualR, fbUpR, fbDownR, fbRecentR, ...dayResults] = results.map(r => r.result);

  // Marcas: sorted set viene como array [nombre, score, nombre, score, ...]
  const brands = [];
  if (Array.isArray(brandsR)) {
    for (let i = 0; i < brandsR.length; i += 2) {
      brands.push({ name: brandsR[i], count: parseInt(brandsR[i + 1]) || 0 });
    }
  }

  // Consultas recientes
  const recent = Array.isArray(recentR)
    ? recentR.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean)
    : [];

  // Sin manual: sorted set brand|model|year -> nº de veces que se respondió sin manual.
  // Agregado persistente (no se pierde al salir de las últimas 200 de "recent").
  const sinManual = [];
  if (Array.isArray(sinManualR)) {
    for (let i = 0; i < sinManualR.length; i += 2) {
      const [brand, model, year] = String(sinManualR[i]).split('|');
      sinManual.push({ brand, model, year, count: parseInt(sinManualR[i + 1]) || 0 });
    }
  }

  // Feedback: 👍/👎 recientes (registro completo, mismo patrón que vm:recent)
  const fbRecent = Array.isArray(fbRecentR)
    ? fbRecentR.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean)
    : [];

  // Días: ordenar de antiguo a reciente
  const days = dayKeys.map((date, i) => ({ date, count: parseInt(dayResults[i]) || 0 })).reverse();

  res.json({
    total: parseInt(totalR) || 0,
    today: parseInt(todayR) || 0,
    manual: parseInt(manualR) || 0,
    general: parseInt(generalR) || 0,
    days,
    brands,
    recent,
    sinManual,
    fbUp: parseInt(fbUpR) || 0,
    fbDown: parseInt(fbDownR) || 0,
    fbRecent
  });
};
