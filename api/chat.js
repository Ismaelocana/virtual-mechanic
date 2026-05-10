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
Tienes fragmentos relevantes del manual oficial de esta moto. Úsalos como primera fuente para responder.
Si la respuesta está en los fragmentos, cítala y sé preciso.
Si no está, usa tu conocimiento general pero indícalo claramente.
Nunca inventes información. Si no sabes algo, dilo.
Responde en español, sé conciso y práctico.

FRAGMENTOS DEL MANUAL OFICIAL ${brand} ${model}:
${context}`
    : `Eres Virtual Mechanic, mecánico experto en motos de enduro y offroad especializado en ${brand}.
El usuario tiene una ${brand} ${model} ${year || ''}.
No tienes el manual oficial de esta moto concreta disponible, pero DEBES responder siendo útil con tu conocimiento general sobre motos de enduro y offroad.
IMPORTANTE: Responde siempre con información práctica y detallada. Al inicio de tu respuesta advierte brevemente que no tienes el manual oficial de esta moto y que verifique los datos críticos (torques, medidas exactas, etc.) con un taller o el manual original.
Nunca te niegues a responder ni mandes al usuario a buscar en otro sitio. Si no sabes algo concreto, da la respuesta más útil posible basándote en modelos similares o en principios generales de mecánica.
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
