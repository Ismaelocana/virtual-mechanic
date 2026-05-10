const fs = require('fs');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = 'virtual-mechanic';
const CHUNK_WORDS = 500;
const OVERLAP_WORDS = 75;
const EMBED_BATCH = 4; // límite free tier: 3 RPM, 10K TPM
const EMBED_DELAY_MS = 21000; // 21 s entre peticiones → ~2.8 RPM

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

async function obtenerEmbeddings(texts) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`
    },
    body: JSON.stringify({ model: 'voyage-3', input: texts })
  });
  if (!res.ok) throw new Error(`Voyage AI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.map(d => d.embedding);
}

async function indexarManual(brand, model, year, text) {
  const chunks = trocear(limpiarTexto(text));
  console.log(`  ${chunks.length} fragmentos`);
  const idx = pc.index(INDEX_NAME);

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const lote = chunks.slice(i, i + EMBED_BATCH);
    const vectores = await obtenerEmbeddings(lote);
    await idx.upsert({ records: lote.map((chunkText, j) => ({
      id: `${brand}-${model}-${year}-${i + j}`,
      values: vectores[j],
      metadata: { brand, model, year, text: chunkText }
    })) });
    const done = Math.min(i + EMBED_BATCH, chunks.length);
    process.stdout.write(`  ${done}/${chunks.length} subidos\r`);
    if (done < chunks.length) await new Promise(r => setTimeout(r, EMBED_DELAY_MS));
  }
  console.log(`  ✓ ${chunks.length}/${chunks.length} subidos`);
}

async function main() {
  if (!process.env.VOYAGE_API_KEY) throw new Error('Falta VOYAGE_API_KEY en .env');
  if (!process.env.PINECONE_API_KEY) throw new Error('Falta PINECONE_API_KEY en .env');

  const manualesDir = path.join(__dirname, 'manuales');
  let total = 0;

  for (const brand of fs.readdirSync(manualesDir)) {
    const brandDir = path.join(manualesDir, brand);
    if (!fs.statSync(brandDir).isDirectory()) continue;

    for (const file of fs.readdirSync(brandDir).filter(f => f.endsWith('.txt'))) {
      const match = file.match(/^(.+)-(\d{4})\.txt$/);
      if (!match) continue;
      const [, model, year] = match;

      console.log(`\nIndexando ${brand}/${file}...`);
      const text = fs.readFileSync(path.join(brandDir, file), 'utf8');
      await indexarManual(brand, model, year, text);
      total++;
    }
  }

  console.log(`\n✅ ${total} manual(es) indexado(s)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
