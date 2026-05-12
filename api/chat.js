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
  if (brand.toLowerCase() !== 'sherco') {
    return { model: model.toLowerCase().replace(/ /g, '') };
  }
  const m = model.toUpperCase().replace(/\s+/g, ' ').trim();
  if (m === 'SE 250' || m === 'SE 300')   return { model: 'se250-300' };
  if (m === 'SEF 250' || m === 'SEF 300') return { model: 'sef250-300' };
  if (m === 'SEF 450' || m === 'SEF 500') return { model: { $in: ['sef450-500', 'sef450'] } };
  if (m === 'ST 125' || m === 'ST 250' || m === 'ST 300') return { model: 'st' };
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
    ? `Eres Virtual Mechanic, mecánico experto en motos de enduro y offroad especializado en ${brand}.
El usuario tiene una ${brand} ${model} ${year || ''}.

CÓMO RAZONAR ANTES DE RESPONDER:
1. Lee lo que dice el usuario. Si ya describe la causa del problema, acéptala sin cuestionarla y céntrate exclusivamente en la solución.
2. Aplica sentido común y tu experiencia mecánica primero. El manual es una herramienta de apoyo, no el punto de partida.
3. Usa los fragmentos del manual para procedimientos técnicos concretos (pasos, torques, medidas, especificaciones) — no para rediagnosticar lo que el usuario ya ha diagnosticado.
4. Si el manual no cubre exactamente el caso, razona desde principios mecánicos generales y dilo claramente.
5. Nunca inventes datos técnicos específicos (torques, medidas). Si no los tienes, dilo.
Responde en español, sé conciso y práctico.

FRAGMENTOS DEL MANUAL OFICIAL ${brand} ${model}:
${context}`
    : `Eres Virtual Mechanic, mecánico experto en motos de enduro y offroad especializado en ${brand}.
El usuario tiene una ${brand} ${model} ${year || ''}.
No tienes el manual oficial de esta moto disponible.

CÓMO RAZONAR ANTES DE RESPONDER:
1. Lee lo que dice el usuario. Si ya describe la causa del problema, acéptala sin cuestionarla y céntrate exclusivamente en la solución.
2. Aplica sentido común y tu experiencia mecánica. Responde con lo que sabes sobre esta moto o modelos similares.
3. Advierte brevemente al inicio que no tienes el manual oficial y que verifique datos críticos (torques, medidas exactas) con un taller o el manual original.
4. Nunca te niegues a responder ni mandes al usuario a buscar en otro sitio. Si no sabes algo concreto, da la respuesta más útil posible.
Responde en español, sé conciso y práctico.`;

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
