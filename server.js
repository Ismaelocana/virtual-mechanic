const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function cargarManual(marca, modelo, anio) {
  const nombreArchivo = `${modelo.toLowerCase().replace(/ /g, '')}-${anio}.txt`;
  const rutaArchivo = path.join('manuales', marca.toLowerCase(), nombreArchivo);
  if (fs.existsSync(rutaArchivo)) {
    console.log(`Manual encontrado: ${rutaArchivo}`);
    return fs.readFileSync(rutaArchivo, 'utf8');
  }
  console.log(`Manual no encontrado: ${rutaArchivo}`);
  return null;
}

app.post('/chat', async (req, res) => {
  const { messages, brand, model, year } = req.body;
  const manual = cargarManual(brand, model, year || '2020');

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
No tienes el manual oficial de esta moto disponible, así que usa tu conocimiento general.
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
});

app.listen(3000, () => console.log('Virtual Mechanic servidor corriendo en puerto 3000'));