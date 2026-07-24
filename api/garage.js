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
const MAX_LOG_ENTRIES = 30;

function generarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

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

  // ── POST: añadir moto (por defecto) / actualizar horas / mantenimiento ─────
  if (req.method === 'POST') {
    const { action } = req.body ?? {};

    // Acciones que operan sobre una moto ya existente del garaje
    if (action === 'updateHours' || action === 'addMaintenance' || action === 'deleteMaintenance') {
      const { bikeId } = req.body ?? {};
      if (!bikeId) return res.status(400).json({ error: 'bikeId requerido' });

      const raw = await redis('GET', KEY(userId));
      const garage = raw ? JSON.parse(raw) : [];
      const bike = garage.find(b => b.bikeId === bikeId);
      if (!bike) return res.status(404).json({ error: 'Moto no encontrada en el garaje' });

      if (action === 'updateHours') {
        const { hours } = req.body ?? {};
        const h = Number(hours);
        if (!Number.isFinite(h) || h < 0) return res.status(400).json({ error: 'hours inválido' });
        bike.hours = h;
        bike.hoursUpdatedAt = new Date().toISOString();
      }

      if (action === 'addMaintenance') {
        const { entry } = req.body ?? {};
        if (!entry || !entry.label) return res.status(400).json({ error: 'entry.label requerido' });
        const nuevaEntrada = {
          id: generarId(),
          type: String(entry.type || 'otro').slice(0, 30),
          label: String(entry.label).slice(0, 60),
          hours: entry.hours != null && Number.isFinite(Number(entry.hours)) ? Number(entry.hours) : null,
          date: entry.date || new Date().toISOString().slice(0, 10),
        };
        bike.maintenanceLog = bike.maintenanceLog || [];
        bike.maintenanceLog.unshift(nuevaEntrada);
        if (bike.maintenanceLog.length > MAX_LOG_ENTRIES) bike.maintenanceLog.length = MAX_LOG_ENTRIES;
      }

      if (action === 'deleteMaintenance') {
        const { entryId } = req.body ?? {};
        bike.maintenanceLog = (bike.maintenanceLog || []).filter(e => e.id !== entryId);
      }

      await redis('SET', KEY(userId), JSON.stringify(garage));
      return res.json({ ok: true, bike });
    }

    // Acción por defecto: añadir moto nueva al garaje (comportamiento original, intacto)
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
