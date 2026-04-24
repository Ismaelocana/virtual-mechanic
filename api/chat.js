const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function cargarManual(marca, modelo, anio) {
  const nombreArchivo = `${modelo.toLowerCase().replace(/ /g, '')}-${anio}.txt`;
  const url = `https://raw.githubusercontent.com/Ismaelocana/virtual-mechanic/master/manuales/${marca.toLowerCase()}/${nombreArchivo}`;
  try {
    const response = await fetch(url);
    if (response.ok) {
      console.log(`Manual encontrado: ${url}`);
      return await response.text();
    }
    console.log(`Manual no encontrado: ${url}`);
    return null;
  } catch (error) {
    console.log(`Error cargando manual: ${error.message}`);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { messages, brand, model, year } = req.body;
  const manual = await cargarManual(brand, model, year || '2020');
  const systemPrompt = manual
    ? `Eres Virtual Mechanic, mecánico experto en motos de enduro y offroad especializado en ${brand}.
El usuario tiene una ${brand} ${model} ${year || ''}.
Tienes acceso al manual oficial de esta moto. Úsalo como primera fuente para responder.
Si la respuesta está en el manual, cítalo y sé preciso.
Si no está en el manual, usa tu conocimiento general pero indícalo claramente.
Nunca inventes información. Si no sabes algo, dilo.
Responde en español, sé conciso y práctico.
MANUAL OFICIAL ${brand} ${model}:
${manual}`
    : `Eres Virtual Mechanic, mecánico experto en motos de enduro y offroad especializado en ${brand}.
El usuario tiene una ${brand} ${model}.
No tienes el manual oficial de esta moto disponible, usa tu conocimiento general.
Nunca inventes información. Si no sabes algo, dilo claramente.
Responde en español, sé conciso y práctico.`;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages
    });
    const textBlock = response.content.find(b => b.type === 'text');
    res.json({ reply: textBlock ? textBlock.text : 'No se pudo obtener respuesta.' });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};