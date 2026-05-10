const fs = require('fs');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = 'virtual-mechanic';
const CHUNK_WORDS = 500;
const OVERLAP_WORDS = 75;
const EMBED_BATCH = 20;
const EMBED_DELAY_MS = 500; // pausa mínima entre peticiones (cuenta de pago)

function limpiarTexto(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trocear(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + CHUNK_WORDS).join(' '));
    i += CHUNK_WORDS - OVERLAP_WORDS;
  }
  return chunks;
}

async function obtenerEmbeddings(texts, intento = 1) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`
    },
    body: JSON.stringify({ model: 'voyage-3', input: texts })
  });
  if (res.status === 429) {
    if (intento > 5) throw new Error('Voyage AI 429: demasiados reintentos');
    const espera = 10000 * intento;
    process.stdout.write(`\n  Rate limit, esperando ${espera / 1000}s (intento ${intento}/5)...\r`);
    await new Promise(r => setTimeout(r, espera));
    return obtenerEmbeddings(texts, intento + 1);
  }
  if (!res.ok) throw new Error(`Voyage AI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.map(d => d.embedding);
}

async function indexarManual(brand, model, year, text, { firstCall }) {
  const chunks = trocear(limpiarTexto(text));
  console.log(`  ${chunks.length} fragmentos`);
  const idx = pc.index(INDEX_NAME);

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    if (!firstCall.value) await new Promise(r => setTimeout(r, EMBED_DELAY_MS));
    firstCall.value = false;
    const lote = chunks.slice(i, i + EMBED_BATCH);
    const vectores = await obtenerEmbeddings(lote);
    await idx.upsert({ records: lote.map((chunkText, j) => ({
      id: `${brand}-${model}-${year}-${i + j}`,
      values: vectores[j],
      metadata: { brand, model, year, text: chunkText }
    })) });
    const done = Math.min(i + EMBED_BATCH, chunks.length);
    process.stdout.write(`  ${done}/${chunks.length} subidos\r`);
  }
  console.log(`  ✓ ${chunks.length}/${chunks.length} subidos`);
}

async function main() {
  if (!process.env.VOYAGE_API_KEY) throw new Error('Falta VOYAGE_API_KEY en .env');
  if (!process.env.PINECONE_API_KEY) throw new Error('Falta PINECONE_API_KEY en .env');

  // --desde te250-2020 para saltar manuales ya indexados
  // --marca=sherco para indexar solo una marca
  const desdeArg  = process.argv.find(a => a.startsWith('--desde='))?.split('=')[1] || null;
  const marcaArg  = process.argv.find(a => a.startsWith('--marca='))?.split('=')[1] || null;
  let saltando = !!desdeArg;

  const manualesDir = path.join(__dirname, 'manuales');
  const firstCall = { value: true };
  let total = 0;

  for (const brand of fs.readdirSync(manualesDir)) {
    if (marcaArg && brand !== marcaArg) continue;
    const brandDir = path.join(manualesDir, brand);
    if (!fs.statSync(brandDir).isDirectory()) continue;

    for (const file of fs.readdirSync(brandDir).filter(f => f.endsWith('.txt'))) {
      const match = file.match(/^(.+)-(\d{4})\.txt$/);
      if (!match) continue;
      const [, model, year] = match;

      if (saltando) {
        if (file.startsWith(desdeArg)) saltando = false;
        else { console.log(`  Saltando ${brand}/${file}`); continue; }
      }

      console.log(`\nIndexando ${brand}/${file}...`);
      const text = fs.readFileSync(path.join(brandDir, file), 'utf8');
      await indexarManual(brand, model, year, text, { firstCall });
      total++;
    }
  }

  console.log(`\n✅ ${total} manual(es) indexado(s)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
