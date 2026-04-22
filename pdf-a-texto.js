const fs = require('fs');
require('dotenv').config();

async function convertir(rutaPDF, rutaSalida) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let texto = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texto += content.items.map(item => item.str).join(' ') + '\n';
    if (i % 10 === 0) console.log(`Procesadas ${i}/${doc.numPages} páginas...`);
  }
  fs.writeFileSync(rutaSalida, texto, 'utf8');
  console.log(`Listo! Guardado en ${rutaSalida}`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Uso: node pdf-a-texto.js <entrada.pdf> <salida.txt>');
  process.exit(1);
}

convertir(args[0], args[1]);