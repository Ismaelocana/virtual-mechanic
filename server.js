const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/chat', async (req, res) => {
  const { messages, brand, model } = req.body;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: `Eres Virtual Mechanic, mecánico experto en motos de enduro y offroad. El usuario tiene una ${brand} ${model}. Consulta los manuales técnicos oficiales de ${brand} como primera fuente. Da diagnósticos paso a paso, identifica causas y propón soluciones prácticas. Responde en español, sé conciso y práctico. Si no estás seguro, dilo claramente.`,
      messages
    });
    res.json({ reply: response.content[0].text });
} catch (error) {
    console.error('Error completo:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log('Virtual Mechanic servidor corriendo en puerto 3000'));
