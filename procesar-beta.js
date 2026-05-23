// Procesa todos los manuales de manuales/beta/:
// - Busca el PDF en inglés (o español) de cada carpeta
// - Lo convierte a .txt con pdf-a-texto.js
// - Para carpetas multi-año, copia el .txt a cada año
// - Borra todas las carpetas y ZIPs originales
// Uso: node procesar-beta.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BETA_DIR = path.join(__dirname, 'manuales', 'beta');
const PDF_A_TEXTO = path.join(__dirname, 'pdf-a-texto.js');

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9-]/g, '');
}

// Devuelve la ruta al mejor PDF del directorio (EN > ES > cualquiera, sin suplementos)
function findBestPdf(dir) {
  if (!fs.existsSync(dir)) return null;
  const all = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
  const main = all.filter(f => {
    const l = f.toLowerCase();
    return !l.includes('integrazione') && !l.includes('supplementary') && !l.includes('supplement');
  });
  if (!main.length) return null;

  const en = main.find(f => /_EN\.pdf$/i.test(f) || /_ENG\.pdf$/i.test(f));
  if (en) return path.join(dir, en);

  const es = main.find(f => /_SPA\.pdf$/i.test(f) || /_ES\.pdf$/i.test(f));
  if (es) return path.join(dir, es);

  return path.join(dir, main[0]);
}

// Parsea "Modelo [2020]" o "Modelo [2020 - 2023]" → { model, years }
function parseFolder(name) {
  const single = name.match(/^(.+?) \[(\d{4})\]$/);
  if (single) return { model: single[1], years: [parseInt(single[2])] };

  const range = name.match(/^(.+?) \[(\d{4})\s*[-–]\s*(\d{4})\]$/);
  if (range) {
    const y1 = parseInt(range[2]), y2 = parseInt(range[3]);
    const years = [];
    for (let y = y1; y <= y2; y++) years.push(y);
    return { model: range[1], years };
  }
  return null;
}

function main() {
  const entries = fs.readdirSync(BETA_DIR).sort();
  const toDelete = [];
  let ok = 0, failed = 0;

  for (const entry of entries) {
    const fullPath = path.join(BETA_DIR, entry);
    const stat = fs.statSync(fullPath);

    // Borrar ZIPs directamente
    if (!stat.isDirectory() && entry.toLowerCase().endsWith('.zip')) {
      toDelete.push(fullPath);
      continue;
    }
    // Borrar archivos que no son dirs (manual.pdf anterior, etc.)
    if (!stat.isDirectory()) {
      toDelete.push(fullPath);
      continue;
    }

    const parsed = parseFolder(entry);
    if (!parsed) {
      console.log(`↷ Sin año: "${entry}" — borrando`);
      toDelete.push(fullPath);
      continue;
    }

    const { model, years } = parsed;
    const slug = slugify(model);

    // Buscar directorio fuente: Europa > raíz > Extra-Europa
    const europaDir = path.join(fullPath, 'Europa');
    const extraDir  = path.join(fullPath, 'Extra-Europa');
    let searchDir;
    if (fs.existsSync(europaDir)) searchDir = europaDir;
    else searchDir = fullPath;

    let pdfPath = findBestPdf(searchDir);
    if (!pdfPath && fs.existsSync(extraDir)) pdfPath = findBestPdf(extraDir);

    if (!pdfPath) {
      console.log(`✗ Sin PDF: "${entry}"`);
      toDelete.push(fullPath);
      failed++;
      continue;
    }

    const primaryTxt = path.join(BETA_DIR, `${slug}-${years[0]}.txt`);

    if (fs.existsSync(primaryTxt)) {
      process.stdout.write(`↷ Ya existe ${slug}-${years[0]}.txt\n`);
    } else {
      process.stdout.write(`→ ${slug} [${years.join(',')}]... `);
      try {
        execSync(`node "${PDF_A_TEXTO}" "${pdfPath}" "${primaryTxt}"`, { stdio: 'pipe' });
      } catch (e) {
        console.log(`✗ Error conversión`);
        if (fs.existsSync(primaryTxt)) fs.unlinkSync(primaryTxt);
        toDelete.push(fullPath);
        failed++;
        continue;
      }

      const content = fs.readFileSync(primaryTxt, 'utf8');
      if (content.trim().length < 300) {
        console.log(`✗ Solo imágenes (${content.trim().length} chars)`);
        fs.unlinkSync(primaryTxt);
        toDelete.push(fullPath);
        failed++;
        continue;
      }
    }

    // Copiar para años adicionales
    for (let i = 1; i < years.length; i++) {
      const copyPath = path.join(BETA_DIR, `${slug}-${years[i]}.txt`);
      if (!fs.existsSync(copyPath)) fs.copyFileSync(primaryTxt, copyPath);
    }

    console.log(`✓ ${years.join(', ')}`);
    toDelete.push(fullPath);
    ok++;
  }

  console.log('\nLimpiando carpetas y ZIPs...');
  for (const p of toDelete) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignorar */ }
  }

  console.log(`\n✅ ${ok} procesados correctamente, ${failed} fallidos`);
}

main();
