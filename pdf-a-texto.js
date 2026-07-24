const fs = require('fs');
require('dotenv').config();

// Umbral (en unidades de fuente) por debajo del cual dos items se consideran
// en la misma fila visual, y por encima del cual el hueco horizontal entre dos
// items de la misma fila se trata como un salto de columna (tabla) en vez de
// un espacio normal entre palabras.
const UMBRAL_FILA = 0.4;
const UMBRAL_COLUMNA = 1.2;

// pdf.js (getTextContent) devuelve cada fragmento de texto con su posición
// (item.transform) pero en el orden interno del content stream del PDF, que
// en tablas no suele coincidir con el orden de lectura visual (p. ej. puede
// emitir todas las celdas de una columna antes que las de la siguiente).
// Reconstruimos aquí el orden real agrupando por fila (coordenada Y) y
// ordenando cada fila por columna (coordenada X), en vez de confiar en el
// orden de emisión.
function reconstruirPagina(items) {
  const conPos = items
    .filter(it => it.str && it.str.trim() !== '' && it.transform)
    .map(it => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width || 0,
      height: Math.abs(it.transform[3]) || 10,
    }));
  if (!conPos.length) return '';

  // Arriba a abajo (Y decreciente en coordenadas PDF), izquierda a derecha
  conPos.sort((a, b) => b.y - a.y || a.x - b.x);

  const filas = [];
  let filaActual = [];
  let yFila = null;
  for (const it of conPos) {
    if (yFila === null || Math.abs(it.y - yFila) <= Math.max(2, it.height * UMBRAL_FILA)) {
      filaActual.push(it);
      yFila = yFila === null ? it.y : yFila;
    } else {
      filas.push(filaActual);
      filaActual = [it];
      yFila = it.y;
    }
  }
  if (filaActual.length) filas.push(filaActual);

  return filas.map(filaATexto).join('\n');
}

function filaATexto(fila) {
  fila.sort((a, b) => a.x - b.x);
  let texto = '';
  let anterior = null;
  for (const it of fila) {
    if (anterior) {
      const hueco = it.x - (anterior.x + anterior.width);
      const umbral = Math.max(anterior.height, it.height) * UMBRAL_COLUMNA;
      if (hueco > umbral) {
        texto += '  |  ';
      } else if (!texto.endsWith(' ')) {
        texto += ' ';
      }
    }
    texto += it.str;
    anterior = it;
  }
  return texto;
}

async function convertir(rutaPDF, rutaSalida) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(rutaPDF));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let texto = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texto += reconstruirPagina(content.items) + '\n';
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
