const Anthropic = require('@anthropic-ai/sdk');
const { Pinecone } = require('@pinecone-database/pinecone');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    if (m === 'RR 125' || m === 'RR 200') return { model: 'rr125-200' };
    if (m === 'RR 250' || m === 'RR 300') return { model: 'rr250-300' };
    // Enduro Xtrainer
    if (m === 'XTRAINER 250' || m === 'XTRAINER 300') return { model: 'xtrainer250-300' };
    // Enduro RR 4T
    if (m === 'RR 350' || m === 'RR 390' || m === 'RR 430' || m === 'RR 480') return { model: 'rr350-390-430-480' };
    // Trial EVO 80 (nombre de archivo coincide con la normalización por defecto)
    if (m === 'EVO 80') return { model: 'evo80' };
    // Trial EVO 300 SS
    if (m === 'EVO 300 SS') return { model: { $in: ['evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss'] } };
    // Trial EVO 125
    if (m === 'EVO 125') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss'] } };
    // Trial EVO 200 (solo 2T)
    if (m === 'EVO 200') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t200'] } };
    // Trial EVO 250 (2T y 4T)
    if (m === 'EVO 250') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss', 'evo4t250-300'] } };
    // Trial EVO 300 (2T y 4T)
    if (m === 'EVO 300') return { model: { $in: ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo2t125-250-300-300ss', 'evo4t250-300', 'evo4t300'] } };
  }

  if (brand.toLowerCase() === 'ktm') {
    if (m === 'EXC 125' || m === 'EXC 200') return { model: { $in: ['exc125-200-250-300', 'exc125-150-250-300', 'exc125-200'] } };
    if (m === 'EXC 250' || m === 'EXC 300') return { model: { $in: ['exc125-200-250-300', 'exc125-150-250-300', 'exc250-300'] } };
    if (m === 'EXC 150') return { model: { $in: ['exc125-150-250-300', 'exc150-250-300', 'exc150'] } };
    if (m === 'EXC-F 450' || m === 'EXC-F 500') return { model: 'exc-f450-500' };
    if (m === 'EXC-F 350') return { model: { $in: ['exc-f350-450-500', 'exc-f350'] } };
    if (m === 'SX 125' || m === 'SX 150') return { model: { $in: ['sx125-150-250', 'sx125-150', 'sx125'] } };
    if (m === 'SX 250') return { model: { $in: ['sx125-150-250', 'sx250', 'sx250-300'] } };
  }

  if (brand.toLowerCase() === 'husqvarna') {
    // TE 2T — un PDF cubre 125+150+250+300 (2016–2017) o 250+300 (2020+)
    if (m === 'TE 125' || m === 'TE 150') return { model: { $in: ['te125-150-250-300', 'te125-150'] } };
    if (m === 'TE 250' || m === 'TE 300') return { model: { $in: ['te125-150-250-300', 'te250-300'] } };
    // FE 4T
    if (m === 'FE 450' || m === 'FE 501') return { model: { $in: ['fe450-501', 'fe450'] } };
  }

  if (brand.toLowerCase() === 'gasgas') {
    if (m === 'EC 250') return { model: { $in: ['ec250-300', 'ec125-250-300', 'ec250'] } };
    if (m === 'EC 300') return { model: { $in: ['ec250-300', 'ec125-250-300', 'ec300'] } };
    if (m === 'EC 450F') return { model: { $in: ['ec450f-500f', 'ec450f'] } };
    if (m === 'EC 500F') return { model: { $in: ['ec450f-500f', 'ec450f', 'ec500f'] } };
    if (m === 'MC 125') return { model: { $in: ['mc125', 'mc125-150'] } };
    if (m === 'MC 150') return { model: 'mc125-150' };
    if (m === 'MC 250') return { model: { $in: ['mc250', 'mc250-300'] } };
    if (m === 'MC 300') return { model: 'mc250-300' };
    if (m.startsWith('TXT')) return { model: 'txt125-250-280-300' };
  }

  if (brand.toLowerCase() === 'sherco') {
    if (m === 'SE 250' || m === 'SE 300')   return { model: 'se250-300' };
    if (m === 'SEF 250' || m === 'SEF 300') return { model: 'sef250-300' };
    if (m === 'SEF 450' || m === 'SEF 500') return { model: { $in: ['sef450-500', 'sef450'] } };
    if (m === 'ST 125' || m === 'ST 250' || m === 'ST 300') return { model: 'st' };
  }

  return { model: model.toLowerCase().replace(/ /g, '') };
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
      topK: 5,
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { messages, brand, model, year, imageBase64, imageMediaType } = req.body;

  // For images use last text user message as query; for text use the last user message
  const lastTextUser = [...messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string');
  const searchQuery = imageBase64
    ? (lastTextUser ? lastTextUser.content : 'diagnóstico visual inspección moto')
    : (lastTextUser ? lastTextUser.content : null);

  const context = searchQuery ? await buscarContexto(brand, model, year, searchQuery) : null;

  const systemPrompt = context
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

  const apiMessages = imageBase64 && imageMediaType
    ? [...messages, {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
          { type: 'text', text: 'Analiza esta foto de mi moto. ¿Qué observas? ¿Hay algún problema visible o algo que necesite atención?' }
        ]
      }]
    : messages;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: apiMessages
    });
    const textBlock = response.content.find(b => b.type === 'text');
    res.json({ reply: textBlock ? textBlock.text : 'No se pudo obtener respuesta.' });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
