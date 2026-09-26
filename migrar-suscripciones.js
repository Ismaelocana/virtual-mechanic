// ─────────────────────────────────────────────────────────────────────────────
// Migra las suscripciones de Redis al formato multifuente.
//
//   Antes:   vm:sub:{userId}          (un solo hash, siempre de Stripe)
//   Después: vm:sub:{userId}:stripe   (registro de la fuente)
//            vm:sub:{userId}          (resumen: premiumUntil, source, ...)
//
// Usa exactamente la misma función que la API (migrarSuscripcionAntigua), que
// además guarda una copia del hash original en vm:subbak:{userId} (90 días).
// Es idempotente: los registros ya migrados se saltan.
//
// Uso:
//   node migrar-suscripciones.js             → SIMULACIÓN (no escribe nada)
//   node migrar-suscripciones.js --ejecutar  → migra de verdad
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config({ quiet: true });
const { redisCommand, migrarSuscripcionAntigua, esPremium, getSubscription } = require('./api/_common');

const EJECUTAR = process.argv.includes('--ejecutar');
const fecha = ms => (Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : '—');
const idCorto = id => `${id.slice(0, 10)}…${id.slice(-4)}`;

async function clavesResumen() {
  const claves = [];
  let cursor = '0';
  do {
    const [siguiente, lote] = await redisCommand(['SCAN', cursor, 'MATCH', 'vm:sub:*', 'COUNT', '500']);
    cursor = siguiente;
    claves.push(...lote);
  } while (cursor !== '0');
  // Solo los resúmenes vm:sub:{userId}, no los registros vm:sub:{userId}:{fuente}
  return claves.filter(k => k.split(':').length === 3);
}

(async () => {
  if (!process.env.UPSTASH_REDIS_REST_URL) throw new Error('Falta UPSTASH_REDIS_REST_URL en .env');
  console.log(EJECUTAR ? '\n=== MIGRACIÓN REAL ===\n' : '\n=== SIMULACIÓN (no se escribe nada) ===\n');

  const claves = await clavesResumen();
  let migrados = 0, saltados = 0, errores = 0;

  for (const clave of claves) {
    const userId = clave.slice('vm:sub:'.length);
    const premiumAntes = await esPremium(userId);
    const r = await migrarSuscripcionAntigua(userId, { simular: !EJECUTAR });

    if (!r.migrado) {
      saltados++;
      console.log(`• ${idCorto(userId)}  ya migrado, se salta`);
      continue;
    }
    migrados++;
    const a = r.antes;
    console.log(`• ${idCorto(userId)}`);
    console.log(`    ANTES   vm:sub          premium hasta ${fecha(a.premiumUntil)} | status=${a.status || '—'} | plan=${a.plan || '—'} | sub=${a.subscriptionId || '—'} | cliente=${a.customerId || '—'}`);
    console.log(`    DESPUÉS vm:sub:…:stripe premium hasta ${fecha(r.stripe.premiumUntil)} | status=${r.stripe.status} | plan=${r.stripe.plan || '—'} | externalId=${r.stripe.externalId || '—'} | cliente=${r.stripe.customerId || '—'}`);
    console.log(`    DESPUÉS vm:sub (resumen) premium=${r.resumen.premium === '1' ? 'sí' : 'no'} hasta ${fecha(r.resumen.premiumUntil)} | fuente=${r.resumen.source || '—'} | status=${r.resumen.status} | plan=${r.resumen.plan || '—'}`);

    const premiumDespues = EJECUTAR ? await esPremium(userId) : r.resumen.premium === '1';
    const igual = premiumAntes === premiumDespues;
    if (!igual) errores++;
    console.log(`    esPremium: antes=${premiumAntes ? 'sí' : 'no'} → después=${premiumDespues ? 'sí' : 'no'}  ${igual ? '✓ sin cambios' : '✗ CAMBIA'}`);
    if (EJECUTAR) {
      const s = await getSubscription(userId);
      console.log(`    /api/subscription devolverá: premium=${s.premium} source=${s.source} plan=${s.plan} status=${s.status}`);
    }
  }

  console.log(`\nResumen: ${claves.length} usuario(s) · ${migrados} ${EJECUTAR ? 'migrado(s)' : 'a migrar'} · ${saltados} ya migrado(s) · ${errores} con cambio de premium`);
  if (!EJECUTAR) console.log('Para aplicarlo: node migrar-suscripciones.js --ejecutar\n');
  if (errores) process.exitCode = 1;
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
