const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { Pinecone } = require('@pinecone-database/pinecone');
const { esPremium, redisCommand, mondayOf } = require('./_common');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Dominio del Frontend API de Clerk (mismo que usa index.html). El JWKS público
// para verificar los JWT de sesión está en /.well-known/jwks.json de este dominio.
const CLERK_DOMAIN = 'clerk.virtualmechanic.es';

// Cache del JWKS en memoria (se refresca cada hora). Evita pedirlo en cada request.
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
// nunca el token ni datos sensibles (solo el motivo y, si aplica, un dato
// no sensible como el kid o un desfase en segundos). Temporal, para poder
// distinguir en los logs de Vercel "sin token" de "caducado de verdad" de
// "firma invalida", en vez de que todo se vea igual como un 401 opaco.
function rechazarSesion(motivo, detalle) {
  console.warn(`[verificarSesion] 401: ${motivo}${detalle ? ' | ' + detalle : ''}`);
  return null;
}

// Verifica el JWT de sesión de Clerk enviado en el header Authorization.
// Comprueba la firma RS256 contra el JWKS de Clerk y la expiración.
// Devuelve el userId (claim `sub`) si es válido, o null si falta/es inválido.
// Verificación manual con crypto nativo: sin dependencias que empaquetar.
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

    // Busca la clave por kid; si no está (Clerk rotó sus claves), refresca el JWKS y reintenta
    let jwk = (await getClerkJwks()).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await getClerkJwks(true)).find(k => k.kid === header.kid);
    if (!jwk) return rechazarSesion('kid no encontrado en el JWKS de Clerk', `kid=${header.kid}`);
    const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!crypto.verify('RSA-SHA256', signingInput, pubKey, signature)) return rechazarSesion('firma inválida');

    // Margen de 60s para el desfase de reloj y los tokens de Clerk (viven ~60s):
    // evita 401 esporádicos cuando el token llega al servidor al límite de su vida.
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

// Lazy singleton — no crashea si PINECONE_API_KEY no está configurada
let _pineconeIndex = null;
function getPineconeIndex() {
  if (!_pineconeIndex && process.env.PINECONE_API_KEY) {
    _pineconeIndex = new Pinecone({ apiKey: process.env.PINECONE_API_KEY }).index('virtual-mechanic');
  }
  return _pineconeIndex;
}

async function fetchWithTimeout(url, options, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Mapea el modelo seleccionado en la UI al nombre de archivo en manuales/
// Necesario porque un PDF puede cubrir varios modelos (ej. se250-300 cubre SE 250 y SE 300)
function normalizarModelo(brand, model) {
  const m = model.toUpperCase().replace(/\s+/g, ' ').trim();

  if (brand.toLowerCase() === 'beta') {
    // Enduro RR 2T
    if (m === 'RR 125' || m === 'RR 200') return { model: { $in: ['rr125-200', 'rr125-200-250-300'] } };
    if (m === 'RR 250' || m === 'RR 300') return { model: { $in: ['rr250-300', 'rr125-200-250-300'] } };
    if (m === 'XTRAINER 250' || m === 'XTRAINER 300') return { model: 'xtrainer' };
    if (m === 'RR 350' || m === 'RR 390' || m === 'RR 430' || m === 'RR 480') return { model: 'rr350-390-430-480' };
    if (m === 'EVO 80') return { model: 'evo80' };
    if (m === 'EVO 300 SS') return { model: { $in: ['evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss'] } };
    if (m === 'SINCRO 125' || m === 'SINCRO 200' || m === 'SINCRO 250' || m === 'SINCRO 300' || m === 'SINCRO 300 SS') return { model: 'sincro2t-125-200-250-300-300ss' };
    if (m === 'RX 300') return { model: 'rx300' };
    if (m === 'RX 250' || m === 'RX 350') return { model: 'rx250-350' };
    if (m === 'RX 450') return { model: 'rx450' };
    if (m === 'EVO 125') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss'] } };
    if (m === 'EVO 200') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss', 'evo2t200'] } };
    if (m === 'EVO 250') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss', 'evo4t250-300'] } };
    if (m === 'EVO 300') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss', 'evo4t250-300'] } };
  }

  if (brand.toLowerCase() === 'ktm') {
    if (m === 'EXC 125' || m === 'EXC 200') return { model: { $in: ['exc125-200-250-300', 'exc125-150-250-300', 'exc125-200'] } };
    if (m === 'EXC 250' || m === 'EXC 300') return { model: { $in: ['exc125-200-250-300', 'exc125-150-250-300', 'exc250-300'] } };
    if (m === 'EXC 150') return { model: { $in: ['exc125-150-250-300', 'exc150-250-300', 'exc150'] } };
    if (m === 'EXC-F 450' || m === 'EXC-F 500') return { model: 'exc-f450-500' };
    if (m === 'EXC-F 350') return { model: { $in: ['exc-f350-450-500', 'exc-f350'] } };
    if (m === 'SX 125') return { model: { $in: ['sx125-250', 'sx125-150-250', 'sx125-150', 'sx125'] } };
    if (m === 'SX 150') return { model: { $in: ['sx125-150-250', 'sx125-150'] } };
    if (m === 'SX 250') return { model: { $in: ['sx125-250', 'sx125-150-250', 'sx250', 'sx250-300'] } };
    if (m === 'SX 300') return { model: 'sx250-300' };
  }

  if (brand.toLowerCase() === 'husqvarna') {
    if (m === 'TC 125') return { model: { $in: ['tc125', 'tc125-250'] } };
    if (m === 'TC 250') return { model: { $in: ['tc250', 'tc125-250'] } };
    if (m === 'TE 125' || m === 'TE 150') return { model: { $in: ['te125-150-250-300', 'te125-150'] } };
    if (m === 'TE 250' || m === 'TE 300') return { model: { $in: ['te125-150-250-300', 'te250-300'] } };
    if (m === 'FE 450' || m === 'FE 501') return { model: { $in: ['fe450-501', 'fe450'] } };
  }

  if (brand.toLowerCase() === 'gasgas') {
    if (m === 'EC 250') return { model: { $in: ['ec250-300', 'ec125-250-300', 'ec250'] } };
    if (m === 'EC 300') return { model: { $in: ['ec250-300', 'ec125-250-300', 'ec300'] } };
    if (m === 'EC 450F') return { model: { $in: ['ec450f-500f', 'ec450f'] } };
    if (m === 'EC 500F') return { model: { $in: ['ec450f-500f', 'ec450f', 'ec500f'] } };
    if (m === 'MC 250') return { model: 'mc250' };
    if (m.startsWith('TXT')) return { model: 'txt' };
  }

  if (brand.toLowerCase() === 'rieju') {
    if (m === 'MR 200' || m === 'MR 250') return { model: 'mr200-250-300' };
    if (m === 'MR 300') return { model: { $in: ['mr200-250-300', 'mr300'] } };
  }

  if (brand.toLowerCase() === 'triumph') {
    if (m === 'TF 250-E' || m === 'TF 450-E') return { model: 'tf250e-450e' };
    if (m === 'TF 250-X' || m === 'TF 450-X' || m === 'TF 450 RC EDITION') return { model: 'tf250x-450x-450rc' };
  }

  if (brand.toLowerCase() === 'honda') {
    if (m === 'CRF 150R') return { model: 'crf150r' };
    // CRF250R de antes de 2019 (cuando no existía la RX) usa el token
    // 'crf250r' en solitario; desde 2019 el manual europeo cubre R+RX en
    // 'crf250r-250rx'. Igual con CRF450R/'crf450r' desde 2009 hasta 2016.
    if (m === 'CRF 250R') return { model: { $in: ['crf250r-250rx', 'crf250r'] } };
    if (m === 'CRF 250RX') return { model: 'crf250r-250rx' };
    if (m === 'CRF 450R') return { model: { $in: ['crf450r-450rx', 'crf450r'] } };
    if (m === 'CRF 450RX') return { model: 'crf450r-450rx' };
    // Montesa Cota (trial) — fuente: montesa.com (sitio oficial de Montesa).
    if (m === 'MONTESA COTA 260') return { model: 'cota260' };
    if (m === 'MONTESA COTA 301') return { model: 'cota301' };
    // Montesa Cota 315R (2T, 1999-2004): sin manual público conocido.
  }

  if (brand.toLowerCase() === 'sherco') {
    if (m === 'SE 250' || m === 'SE 300')   return { model: 'se250-300' };
    if (m === 'SEF 250' || m === 'SEF 300') return { model: 'sef250-300' };
    if (m === 'SEF 450' || m === 'SEF 500') return { model: { $in: ['sef450-500', 'sef450'] } };
    if (m === 'ST 125' || m === 'ST 250' || m === 'ST 300') return { model: 'st' };
  }

  return { model: model.toLowerCase().replace(/ /g, '') };
}

// URL base del propio despliegue: los .txt de manuales/ se sirven como
// estáticos (vercel.json), no están empaquetados en la función serverless,
// así que para leer un manual completo (comparador de años) hay que pedirlo
// por HTTP en vez de con fs.readFileSync.
const BASE_URL = 'https://virtual-mechanic.vercel.app';

// normalizarModelo() devuelve un filtro de Pinecone ({model: 'token'} o
// {model: {$in: [...]}}) — aquí solo nos interesan los tokens candidatos,
// que son los mismos nombres de archivo usados en manuales/{marca}/.
function extraerTokensDeFiltro(filtro) {
  if (!filtro || !filtro.model) return [];
  if (typeof filtro.model === 'string') return [filtro.model];
  if (filtro.model.$in) return filtro.model.$in;
  return [];
}

// Intenta descargar el manual completo (.txt) de un modelo+año probando cada
// token de archivo candidato. Devuelve { texto, token } del primero que
// exista, o null si ninguno existe (no hay manual para ese año).
async function obtenerManualCompleto(brand, model, year) {
  const tokens = extraerTokensDeFiltro(normalizarModelo(brand, model));
  for (const token of tokens) {
    try {
      const url = `${BASE_URL}/manuales/${brand.toLowerCase()}/${token}-${year}.txt`;
      const res = await fetchWithTimeout(url, {}, 8000);
      if (res.ok) return { texto: await res.text(), token };
    } catch (e) {
      console.error('obtenerManualCompleto error:', e.message);
    }
  }
  return null;
}

// Resuelve los dos manuales completos para el comparador de años. No usa RAG:
// una comparación "qué cambió" necesita ver los documentos enteros, no
// fragmentos relevantes a una pregunta semántica (los cambios reales entre
// años consecutivos no suelen "destacar" en una búsqueda vectorial genérica).
// Devuelve { ok:false, motivo } si falta algún manual o si ambos años
// resuelven al mismo archivo (nada que comparar), para que el caller pueda
// avisar la limitación en vez de arriesgarse a que Claude invente diferencias.
async function resolverComparacionAnios(brand, model, yearA, yearB) {
  const [manualA, manualB] = await Promise.all([
    obtenerManualCompleto(brand, model, yearA),
    obtenerManualCompleto(brand, model, yearB),
  ]);

  const faltantes = [];
  if (!manualA) faltantes.push(yearA);
  if (!manualB) faltantes.push(yearB);
  if (faltantes.length) return { ok: false, motivo: 'sin_manual', faltantes };

  // Cada año tiene su propio archivo por convención de nombres (.../{token}-{año}.txt),
  // así que nunca comparten literalmente la misma ruta — pero el mismo PDF de origen
  // puede haberse guardado sin cambios bajo dos años distintos. Comparamos el
  // contenido, no la ruta, para detectar ese caso.
  if (manualA.texto === manualB.texto) {
    return { ok: false, motivo: 'mismo_manual' };
  }

  return { ok: true, textoA: manualA.texto, textoB: manualB.texto };
}

async function buscarContexto(brand, model, year, query) {
  if (!process.env.VOYAGE_API_KEY || !process.env.PINECONE_API_KEY) return null;
  try {
    const embRes = await fetchWithTimeout('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`
      },
      body: JSON.stringify({ model: 'voyage-3', input: [query] })
    });
    if (!embRes.ok) throw new Error(`Voyage AI ${embRes.status}`);
    const embJson = await embRes.json();
    const vector = embJson.data[0].embedding;

    const modelFilter = normalizarModelo(brand, model);
    const result = await getPineconeIndex().query({
      vector,
      topK: 15,
      filter: {
        brand: brand.toLowerCase(),
        ...modelFilter,
        year: String(year)
      },
      includeMetadata: true
    });

    if (!result.matches.length) return null;
    return result.matches.map(m => m.metadata.text).join('\n\n---\n\n');
  } catch (e) {
    console.error('buscarContexto error:', e.message);
    return null;
  }
}

// Construye (si procede) el bloque de mantenimiento proactivo, solo para el
// primer mensaje de una conversación abierta desde el garaje. Devuelve null
// si no hay datos suficientes para razonar con confianza (sin horas
// registradas, la moto ya no está en el garaje, o el manual no cubre
// intervalos de mantenimiento) — así se evita que la IA invente un intervalo
// que no existe, y no se paga el coste extra cuando no hay nada que aportar.
async function construirBloqueMantenimiento(userId, bikeId, brand, model, year) {
  try {
    const raw = await redisCommand(['GET', `vm:garage:${userId}`]);
    if (!raw) { console.log('[mantenimiento] sin garaje en Redis para este userId'); return null; }
    const garage = JSON.parse(raw);
    const bike = garage.find(b => b.bikeId === bikeId);
    if (!bike) { console.log(`[mantenimiento] bikeId=${bikeId} no encontrado en el garaje (motos guardadas: ${garage.length})`); return null; }
    if (bike.hours == null) { console.log(`[mantenimiento] bikeId=${bikeId} encontrado pero sin horas registradas`); return null; }
    console.log(`[mantenimiento] moto encontrada: hours=${bike.hours}, entradas en historial=${(bike.maintenanceLog || []).length}`);

    const contextoMantenimiento = await buscarContexto(
      brand, model, year,
      'intervalos de mantenimiento programado, revisión periódica por horas, cambio de aceite y filtros'
    );
    if (!contextoMantenimiento) { console.log('[mantenimiento] buscarContexto devolvió null (sin matches en Pinecone para brand/model/year)'); return null; }
    console.log(`[mantenimiento] contexto de manual encontrado, longitud=${contextoMantenimiento.length} caracteres`);

    const historial = (bike.maintenanceLog || []).length
      ? bike.maintenanceLog.map(e => `- ${e.label} a las ${e.hours != null ? e.hours + 'h' : '?'} (${e.date})`).join('\n')
      : '(sin ningún mantenimiento registrado todavía)';

    return `

DATOS DE MANTENIMIENTO DE ESTA MOTO (proporcionados por el usuario en su garaje — trátalos como datos reales, no los cuestiones):
- Horas actuales: ${bike.hours}h
- Historial registrado:
${historial}

FRAGMENTOS DEL MANUAL SOBRE INTERVALOS DE MANTENIMIENTO:
${contextoMantenimiento}

INSTRUCCIÓN IMPORTANTE: Si, comparando las horas actuales y el historial contra los intervalos del manual de arriba, hay algún mantenimiento que parece pendiente o cercano, menciónalo de forma breve y proactiva al principio de tu respuesta (antes de responder a lo que te pregunte el usuario). Si los fragmentos del manual no dejan claro el intervalo exacto, o no tienes datos suficientes para estar seguro, NO menciones nada al respecto — no inventes ni supongas un intervalo que no esté explícito.`;
  } catch (e) {
    console.error('construirBloqueMantenimiento error:', e.message);
    return null;
  }
}

async function logConsulta(brand, model, year, usedManual, userId) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const semana = mondayOf();
    const entry = JSON.stringify({ brand, model, year, usedManual, t: Date.now() });
    const comandos = [
      ['INCR', 'vm:total'],
      ['INCR', `vm:day:${today}`],
      ['EXPIRE', `vm:day:${today}`, '7776000'],
      ['ZINCRBY', 'vm:brands', '1', `${brand}|${model}`],
      ['INCR', usedManual ? 'vm:manual' : 'vm:general'],
      ['LPUSH', 'vm:recent', entry],
      ['LTRIM', 'vm:recent', '0', '199'],
      // Contadores por semana (lunes-domingo, UTC) para el informe semanal —
      // independientes de los acumulados de arriba, con TTL de 14 días.
      ['ZINCRBY', `vm:brands:week:${semana}`, '1', `${brand}|${model}`],
      ['EXPIRE', `vm:brands:week:${semana}`, '1209600', 'NX'],
    ];
    if (userId) {
      comandos.push(
        ['SADD', `vm:active:week:${semana}`, userId],
        ['EXPIRE', `vm:active:week:${semana}`, '1209600', 'NX']
      );
    }
    // Agregado persistente (no se pierde al salir de las últimas 200 consultas)
    // de qué combinación marca+modelo+año se responde sin manual, para priorizar
    // qué manuales indexar o qué mapeos de normalizarModelo revisar.
    if (!usedManual) {
      comandos.push(['ZINCRBY', 'vm:sin_manual', '1', `${brand}|${model}|${year}`]);
    }
    await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(comandos)
    });
  } catch (_) { /* logging no debe romper la respuesta principal */ }
}

// Rate limiting por usuario: doble límite con ventanas rodantes independientes.
// Claves vm:rl:d:{userId} (24h) y vm:rl:w:{userId} (7 días), cada una con
// INCR + EXPIRE NX (el TTL solo se fija en la primera consulta de esa ventana,
// así el contador y su reinicio "ruedan" desde entonces). El límite semanal
// evita que alguien agote el diario todos los días y acabe con un uso casi
// ilimitado.
// Devuelve { ok, limitType, resetAt } si se supera algún límite (limitType
// indica cuál: 'week' tiene prioridad sobre 'day' porque es el techo real —
// se puede superar el semanal sin haber agotado el diario de hoy).
// Fail-open: si Redis no está configurado o falla, permite pasar (no bloquea el chat).
async function comprobarRateLimit(userId) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const limitDay = parseInt(process.env.RATE_LIMIT_PER_DAY, 10) || 5;
  const limitWeek = parseInt(process.env.RATE_LIMIT_PER_WEEK, 10) || 20;
  const WINDOW_DAY = 86400;                                        // 24h en segundos
  const WINDOW_WEEK = 604800;                                      // 7 días en segundos
  if (!url || !token) return { ok: true };
  try {
    const keyDay = `vm:rl:d:${userId}`;
    const keyWeek = `vm:rl:w:${userId}`;
    const res = await fetchWithTimeout(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', keyDay],
        ['EXPIRE', keyDay, String(WINDOW_DAY), 'NX'],
        ['PTTL', keyDay],
        ['INCR', keyWeek],
        ['EXPIRE', keyWeek, String(WINDOW_WEEK), 'NX'],
        ['PTTL', keyWeek],
      ])
    }, 3000);
    if (!res.ok) return { ok: true };                               // fail-open si Redis responde mal
    const data = await res.json();
    const countDay = Array.isArray(data) && data[0] ? Number(data[0].result) : 0;
    const pttlDay = Array.isArray(data) && data[2] ? Number(data[2].result) : -1;
    const countWeek = Array.isArray(data) && data[3] ? Number(data[3].result) : 0;
    const pttlWeek = Array.isArray(data) && data[5] ? Number(data[5].result) : -1;

    if (countWeek > limitWeek) {
      return { ok: false, limitType: 'week', resetAt: pttlWeek > 0 ? Date.now() + pttlWeek : null };
    }
    if (countDay > limitDay) {
      return { ok: false, limitType: 'day', resetAt: pttlDay > 0 ? Date.now() + pttlDay : null };
    }
    return { ok: true };
  } catch (e) {
    console.error('comprobarRateLimit error:', e.message);
    return { ok: true };                                            // fail-open ante cualquier fallo
  }
}

// Maneja una petición de comparación de años (flag compareYear). Independiente
// del flujo normal de chat: no usa RAG, no añade bloque de mantenimiento, y
// construye su propio system prompt a partir de los manuales completos.
// Devuelve la misma respuesta NDJSON en streaming que el resto de /api/chat,
// para que el frontend pueda reusar exactamente el mismo lector.
async function manejarComparacionAnios(res, userId, brand, model, yearA, yearB) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const enviar = (obj) => {
    res.write(JSON.stringify(obj) + '\n');
    if (res.flush) res.flush();
  };

  try {
    const comparacion = await resolverComparacionAnios(brand, model, yearA, yearB);

    if (!comparacion.ok) {
      // Sin llamar a Claude: son mensajes deterministas, no hay nada que
      // "generar" y así evitamos cualquier riesgo de que invente una
      // diferencia que no puede confirmar.
      const mensaje = comparacion.motivo === 'sin_manual'
        ? `No tengo el manual oficial de ${brand} ${model} del año ${comparacion.faltantes.join(' ni del ')}, así que no puedo comparar con precisión. Prefiero avisarte de esto antes que arriesgarme a inventar diferencias que no puedo confirmar.`
        : `El manual oficial de ${brand} ${model} no distingue entre ${yearA} y ${yearB} — ambos años comparten el mismo documento, así que no hay diferencias documentadas entre ellos.`;
      enviar({ type: 'meta', usedManual: false });
      enviar({ type: 'delta', text: mensaje });
      enviar({ type: 'done' });
      res.end();
      logConsulta(brand, model, `${yearA}vs${yearB}`, false, userId);
      return;
    }

    const systemPrompt = `Eres un mecánico experto en motos de enduro y offroad, especializado en ${brand}. Te voy a dar el manual oficial COMPLETO de la ${brand} ${model} de dos años distintos: ${yearA} y ${yearB}.

Tu tarea es escribir un resumen breve, para el propietario de la moto (no un informe técnico exhaustivo), de qué cambia realmente entre un año y otro y por qué le importa a quien la conduce.

Cómo decidir qué incluir:
- Prioriza cambios que el piloto nota o le afectan de verdad: suspensión (marca/modelo del componente, no solo un ajuste de clics), frenos, embrague, electrónica/tecnología (instrumentación, mapas de encendido, arranque eléctrico, etc.), chasis/geometría, motor (solo si cambia algo relevante: cilindrada, relación de compresión, arquitectura), relación de marchas/desarrollo (primaria, caja de cambios, desarrollo final — afecta directamente a cómo tira la moto y a qué revoluciones va en cada marcha), y equipamiento o extras de serie.
- Ignora por completo diferencias menores de pares de apriete, tornillería, o cifras técnicas de detalle (mm, Nm, ml) que no cambian cómo se comporta o se mantiene la moto de forma perceptible. Si solo cambia un par de apriete puntual, no lo menciones.
- No es un catálogo de especificaciones: no vuelques tablas comparando cada parámetro exista o no diferencia. Si algo es igual en ambos años, simplemente no lo menciones — nunca escribas una fila o frase solo para decir "esto no cambió".
- Si un componente entero se sustituye por otro modelo/tecnología distinta (p. ej. cambia la marca o el tipo de horquilla, se añade quickshifter, cambia el sistema de frenos), eso sí es lo más importante y debe ir primero.
- IMPORTANTE — no te quedes solo con las tablas de datos técnicos: antes de responder, compara también los índices de contenidos de ambos manuales. Si un capítulo, procedimiento o función existe en un año y no en el otro (p. ej. un procedimiento de calibración nuevo, un sistema que antes no existía), es una señal fuerte de un cambio real y hay que mencionarlo, aunque no aparezca en ninguna tabla de especificaciones.

Formato:
- Responde en español, con un breve encabezado por categoría solo si esa categoría tiene cambios reales, y dentro una explicación corta en prosa o bullets — no tablas gigantes con cada especificación (excepto la relación de marchas, que puedes dar como lista breve si cambia, por ser un dato muy concreto y útil).
- Sé conciso: el objetivo es que alguien lo lea entero en menos de un minuto, no una comparativa exhaustiva.
- Basa todo en diferencias que puedas confirmar comparando ambos textos — no inventes ni asumas cambios por conocimiento general si el manual no lo confirma.
- Si de verdad no hay cambios relevantes para el usuario (aunque haya diferencias menores de tornillería), dilo directamente en una frase.

MANUAL ${yearA}:
${comparacion.textoA}

MANUAL ${yearB}:
${comparacion.textoB}`;

    enviar({ type: 'meta', usedManual: true });

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Compara qué cambia entre el año ${yearA} y el año ${yearB} de esta moto — solo lo relevante para el propietario, sin tablas de especificaciones completas.` }]
    });

    stream.on('text', (delta) => enviar({ type: 'delta', text: delta }));
    const finalMsg = await stream.finalMessage();

    // Con las instrucciones de ser conciso no debería pasar, pero si aun así
    // se corta por límite de tokens, mejor avisarlo que dejar la respuesta
    // incompleta sin explicación.
    if (finalMsg.stop_reason === 'max_tokens') {
      enviar({ type: 'delta', text: '\n\n*⚠️ La respuesta se ha cortado por ser demasiado larga. Pregunta por una categoría concreta (p. ej. "¿qué cambia en la suspensión?") para más detalle.*' });
    }

    enviar({ type: 'done' });
    res.end();
    logConsulta(brand, model, `${yearA}vs${yearB}`, true, userId);
  } catch (error) {
    console.error('manejarComparacionAnios error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      try { res.write(JSON.stringify({ type: 'error', message: error.message }) + '\n'); } catch (_) {}
      res.end();
    }
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Fase 1: exigir sesión válida de Clerk antes de procesar nada
  const userId = await verificarSesion(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });

  // Los usuarios premium no tienen límite de consultas.
  // (esPremium es fail-safe: ante cualquier fallo devuelve false y se aplica el límite)
  const premium = await esPremium(userId);

  // Fase 2: limitar consultas por usuario y día — solo para el plan gratuito
  if (!premium) {
    const rl = await comprobarRateLimit(userId);
    if (!rl.ok) {
      return res.status(429).json({ error: 'Has agotado tus consultas.', limitType: rl.limitType, resetAt: rl.resetAt || null });
    }
  }

  const { messages, brand, model, year, imageBase64, imageMediaType, bikeId, checkMaintenance, compareYear } = req.body;
  console.log(`[mantenimiento] checkMaintenance=${!!checkMaintenance} bikeId=${bikeId ? 'presente' : 'ausente'}`);

  // Comparador de años: flujo totalmente aparte del chat normal (sin RAG, sin
  // bloque de mantenimiento), con su propio system prompt y sus propias
  // salvaguardas. Termina la petición aquí.
  if (compareYear) {
    return manejarComparacionAnios(res, userId, brand, model, year, compareYear);
  }

  // For images use last text user message as query; for text use the last user message
  const lastTextUser = [...messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string');
  const searchQuery = imageBase64
    ? (lastTextUser ? lastTextUser.content : 'diagnóstico visual inspección moto')
    : (lastTextUser ? lastTextUser.content : null);

  const context = searchQuery ? await buscarContexto(brand, model, year, searchQuery) : null;

  // Mantenimiento proactivo: solo en el primer mensaje de una conversación
  // abierta desde el garaje (el frontend manda checkMaintenance+bikeId una
  // única vez por sesión). No añade coste en el resto de la conversación.
  const bloqueMantenimiento = (checkMaintenance && bikeId)
    ? await construirBloqueMantenimiento(userId, bikeId, brand, model, year)
    : null;

  const systemPromptBase = context
    ? `Eres un mecánico experto en motos de enduro y offroad con décadas de experiencia, especializado en ${brand}. Estás hablando con alguien que tiene una ${brand} ${model} ${year || ''} y necesita tu ayuda.

Tienes delante el manual oficial de esta moto. Lo usas igual que lo usaría cualquier mecánico profesional: lo consultas cuando necesitas un dato exacto (par de apriete, cantidad de aceite, especificación técnica), no como guion para responder.

Cómo trabajas:
- Entiendes primero qué le pasa y qué necesita. Si el usuario ya sabe la causa, la aceptas y vas directo a ayudarle con la solución. No re-diagnosticas lo que ya está diagnosticado.
- Razonas como un mecánico, no como un buscador de manual. Piensas en el problema, aplicas lógica y experiencia, y si necesitas confirmar un dato exacto, lo buscas en el manual.
- Si te falta información para dar una buena respuesta, haces las preguntas concretas que haría un mecánico: "¿cuántos kilómetros tiene?", "¿hace cuánto cambiaste el aceite?", "¿el problema aparece en frío o en caliente?".
- Das soluciones prácticas y directas. Cuando el procedimiento tiene pasos, los explicas en orden. Cuando hay un dato técnico importante (par de apriete, volumen, medida), lo das con precisión si está en el manual.
- Si el manual no cubre exactamente lo que preguntan, usas tu conocimiento sobre mecánica y sobre esta gama de motos. No te bloqueas.
- No inventas datos técnicos específicos. Si no tienes el dato exacto en el manual, lo dices y das el rango aproximado o la referencia más cercana.

Responde siempre en español. Sé directo y práctico, como lo sería un buen mecánico de confianza.

MANUAL OFICIAL ${brand} ${model} — fragmentos relevantes:
${context}`
    : `Eres un mecánico experto en motos de enduro y offroad con décadas de experiencia, especializado en ${brand}. Estás hablando con alguien que tiene una ${brand} ${model} ${year || ''} y necesita tu ayuda.

No tienes el manual oficial de esta moto a mano, pero conoces bien esta gama y la mecánica de motos de enduro en general.

Cómo trabajas:
- Entiendes primero qué le pasa y qué necesita. Si el usuario ya sabe la causa, la aceptas y vas directo a ayudarle con la solución.
- Razonas desde tu experiencia. Usas lo que sabes sobre esta moto, sobre modelos similares del mismo fabricante, y sobre mecánica general de enduro.
- Si te falta información, haces las preguntas concretas que haría un mecánico.
- Das soluciones prácticas. Cuando no tienes un dato técnico exacto (par de apriete, volumen preciso), lo dices claramente y recomiendas verificarlo en el manual original o con el taller, pero siempre dando el rango aproximado si lo conoces.
- No te niegas a responder ni mandas al usuario a buscar en otro sitio. Siempre hay algo útil que aportar.

Responde siempre en español. Sé directo y práctico, como lo sería un buen mecánico de confianza.`;

  const systemPrompt = systemPromptBase + (bloqueMantenimiento || '');

  const apiMessages = imageBase64 && imageMediaType
    ? [...messages, {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
          { type: 'text', text: 'Analiza esta foto de mi moto. ¿Qué observas? ¿Hay algún problema visible o algo que necesite atención?' }
        ]
      }]
    : messages;

  // Respuesta en streaming: NDJSON (una línea = un evento JSON), no SSE real.
  // El frontend lee con fetch()+ReadableStream (no EventSource, que solo admite
  // GET y no puede llevar el header Authorization con el token de Clerk).
  try {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no'); // por si hay algún proxy intermedio

    const enviar = (obj) => {
      res.write(JSON.stringify(obj) + '\n');
      if (res.flush) res.flush();
    };

    // usedManual ya se conoce (viene de la búsqueda en Pinecone, previa a Claude):
    // se manda antes de empezar a generar texto para que el frontend pinte el
    // badge "Manual oficial"/"Conocimiento general" de inmediato.
    enviar({ type: 'meta', usedManual: !!context });

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: apiMessages
    });

    stream.on('text', (delta) => enviar({ type: 'delta', text: delta }));

    await stream.finalMessage();

    enviar({ type: 'done' });
    res.end();
    logConsulta(brand, model, year, !!context, userId);
  } catch (error) {
    console.error('Error:', error.message);
    if (!res.headersSent) {
      // Fallo antes de escribir nada: aún podemos responder con un error normal.
      res.status(500).json({ error: error.message });
    } else {
      // Ya se envió el meta/algún delta: no se puede cambiar el status code.
      // Se señaliza el error dentro del propio stream NDJSON.
      try { res.write(JSON.stringify({ type: 'error', message: error.message }) + '\n'); } catch (_) {}
      res.end();
    }
  }
};
