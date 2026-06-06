const fs = require('fs');
const path = require('path');

// ── Extraer brandsData de index.html ─────────────────────────────────────────
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/const brandsData = (\{[\s\S]+?\});\s*\nconst catIcons/);
if (!match) { console.error('No se pudo extraer brandsData de index.html'); process.exit(1); }
const brandsData = eval('(' + match[1] + ')');

// ── Replicar lógica de años (igual que test-manuales.js) ─────────────────────
function getYears(brand, model, engine) {
  let fromYear = 2000, toYear = 2026;
  if (brand === 'Sherco') {
    if (model.startsWith('ST')) fromYear = 2009;
    else if (model === 'SE 125') fromYear = 2018;
    else fromYear = 2016;
  } else if (brand === 'Beta') {
    if (model.startsWith('Xtrainer')) fromYear = 2016;
    else if ((model === 'RR 125' || model === 'RR 200') && engine === '2T') fromYear = 2018;
    else if (model.startsWith('RR') && engine === '2T') fromYear = 2013;
    else if (model.startsWith('RR') && engine === '4T') fromYear = 2012;
    else if (model === 'EVO 300 SS') fromYear = 2017;
    else if (model.startsWith('EVO')) fromYear = 2009;
    if (model === 'EVO 200') toYear = 2017;
  } else if (brand === 'KTM') {
    if (model === 'EXC 125' || model === 'EXC 200') { fromYear = 2005; toYear = 2016; }
    else if (model === 'EXC 150') fromYear = 2020;
    else if (model === 'EXC 250' || model === 'EXC 300') fromYear = 2005;
    else if (model === 'EXC-F 250') fromYear = 2007;
    else if (model === 'EXC-F 350') fromYear = 2012;
    else if (model === 'EXC-F 450' || model === 'EXC-F 500') fromYear = 2005;
    else if (model === 'SX 65' || model === 'SX 85' || model === 'SX 125' || model === 'SX 250') fromYear = 2005;
    else if (model === 'SX 150') fromYear = 2008;
    else if (model === 'SX 300') fromYear = 2023;
    else if (model === 'SX-F 250') fromYear = 2005;
    else if (model === 'SX-F 350') fromYear = 2011;
    else if (model === 'SX-F 450') fromYear = 2007;
  } else if (brand === 'Husqvarna') {
    if (model === 'TC 65') fromYear = 2017;
    else fromYear = 2014;
  } else if (brand === 'GasGas') {
    if (model.startsWith('TXT')) fromYear = 2020;
    else if (model === 'EC 450F' || model === 'EC 500F') fromYear = 2024;
    else fromYear = 2021;
  } else if (brand === 'Rieju') {
    fromYear = 2020;
    if (model === 'MR 200' || model === 'MR 250') toYear = 2025;
  } else if (brand === 'Triumph') {
    if (model.endsWith('-E')) fromYear = 2026;
    else fromYear = 2025;
  }
  const years = [];
  for (let y = toYear; y >= fromYear; y--) years.push(y);
  return years;
}

// ── Replicar normalizarModelo (igual que api/chat.js) ────────────────────────
function normalizarModelo(brand, model) {
  const m = model.toUpperCase().replace(/\s+/g, ' ').trim();

  if (brand.toLowerCase() === 'beta') {
    if (m === 'RR 125' || m === 'RR 200') return ['rr125-200'];
    if (m === 'RR 250' || m === 'RR 300') return ['rr250-300'];
    if (m === 'XTRAINER 250' || m === 'XTRAINER 300') return ['xtrainer'];
    if (m === 'RR 350' || m === 'RR 390' || m === 'RR 430' || m === 'RR 480') return ['rr350-390-430-480'];
    if (m === 'EVO 80') return ['evo80'];
    if (m === 'EVO 300 SS') return ['evo2t125-200-250-300-300ss'];
    if (m === 'EVO 125') return ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss'];
    if (m === 'EVO 200') return ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss'];
    if (m === 'EVO 250') return ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo4t250-300'];
    if (m === 'EVO 300') return ['evo2t125-200-250-300', 'evo2t125-200-250-300-300ss', 'evo4t250-300'];
  }
  if (brand.toLowerCase() === 'ktm') {
    if (m === 'EXC 125' || m === 'EXC 200') return ['exc125-200-250-300', 'exc125-150-250-300', 'exc125-200'];
    if (m === 'EXC 250' || m === 'EXC 300') return ['exc125-200-250-300', 'exc125-150-250-300', 'exc250-300'];
    if (m === 'EXC 150') return ['exc125-150-250-300', 'exc150-250-300', 'exc150'];
    if (m === 'EXC-F 450' || m === 'EXC-F 500') return ['exc-f450-500'];
    if (m === 'EXC-F 350') return ['exc-f350-450-500', 'exc-f350'];
    if (m === 'SX 125') return ['sx125-250', 'sx125-150-250', 'sx125-150', 'sx125'];
    if (m === 'SX 150') return ['sx125-150-250', 'sx125-150'];
    if (m === 'SX 250') return ['sx125-250', 'sx125-150-250', 'sx250', 'sx250-300'];
    if (m === 'SX 300') return ['sx250-300'];
  }
  if (brand.toLowerCase() === 'husqvarna') {
    if (m === 'TC 125') return ['tc125', 'tc125-250'];
    if (m === 'TC 250') return ['tc250', 'tc125-250'];
    if (m === 'TE 125' || m === 'TE 150') return ['te125-150-250-300', 'te125-150'];
    if (m === 'TE 250' || m === 'TE 300') return ['te125-150-250-300', 'te250-300'];
    if (m === 'FE 450' || m === 'FE 501') return ['fe450-501', 'fe450'];
  }
  if (brand.toLowerCase() === 'gasgas') {
    if (m === 'EC 250') return ['ec250-300', 'ec125-250-300', 'ec250'];
    if (m === 'EC 300') return ['ec250-300', 'ec125-250-300', 'ec300'];
    if (m === 'EC 450F') return ['ec450f-500f', 'ec450f'];
    if (m === 'EC 500F') return ['ec450f-500f', 'ec450f', 'ec500f'];
    if (m === 'MC 250') return ['mc250'];
    if (m.startsWith('TXT')) return ['txt', 'txt125-250-280-300'];
  }
  if (brand.toLowerCase() === 'rieju') {
    if (m === 'MR 200' || m === 'MR 250') return ['mr200-250-300'];
    if (m === 'MR 300') return ['mr200-250-300', 'mr300'];
  }
  if (brand.toLowerCase() === 'triumph') {
    if (m === 'TF 250-E' || m === 'TF 450-E') return ['tf250e-450e'];
    if (m === 'TF 250-X' || m === 'TF 450-X' || m === 'TF 450 RC EDITION') return ['tf250x-450x-450rc'];
  }
  if (brand.toLowerCase() === 'sherco') {
    if (m === 'SE 250' || m === 'SE 300') return ['se250-300'];
    if (m === 'SEF 250' || m === 'SEF 300') return ['sef250-300'];
    if (m === 'SEF 450' || m === 'SEF 500') return ['sef450-500', 'sef450'];
    if (m === 'ST 125' || m === 'ST 250' || m === 'ST 300') return ['st'];
  }
  return [model.toLowerCase().replace(/ /g, '')];
}

// ── Comprobar si existe el archivo ────────────────────────────────────────────
function tieneManual(brand, modelKeys, year) {
  const dir = path.join(__dirname, 'manuales', brand.toLowerCase());
  for (const key of modelKeys) {
    if (fs.existsSync(path.join(dir, `${key}-${year}.txt`))) return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const sinManual = {};
const conManual = {};
let totalCon = 0, totalSin = 0;

for (const [brand, data] of Object.entries(brandsData)) {
  for (const [cat, engines] of Object.entries(data.categories)) {
    for (const [eng, models] of Object.entries(engines)) {
      for (const model of models) {
        const years = getYears(brand, model, eng);
        const keys = normalizarModelo(brand, model);
        const faltanAños = [];
        for (const year of years) {
          if (tieneManual(brand, keys, year)) {
            totalCon++;
          } else {
            totalSin++;
            faltanAños.push(year);
          }
        }
        if (faltanAños.length > 0) {
          const k = `${brand} | ${model}`;
          if (!sinManual[k]) sinManual[k] = { años: [], keys };
          sinManual[k].años.push(...faltanAños);
        }
      }
    }
  }
}

// ── Informe ───────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════');
console.log('  COBERTURA LOCAL DE MANUALES (sin llamadas API)');
console.log('═══════════════════════════════════════════════════════');
console.log(`  ✓ Con manual:  ${totalCon}`);
console.log(`  ✗ Sin manual:  ${totalSin}`);
console.log(`  Total:         ${totalCon + totalSin}`);
console.log('═══════════════════════════════════════════════════════\n');

if (Object.keys(sinManual).length === 0) {
  console.log('  ¡Cobertura completa!\n');
} else {
  console.log('SIN MANUAL — combinaciones sin .txt en manuales/:\n');
  for (const [key, { años, keys: modelKeys }] of Object.entries(sinManual)) {
    años.sort((a, b) => a - b);
    const rangos = [];
    let start = años[0], end = años[0];
    for (let i = 1; i < años.length; i++) {
      if (años[i] === end + 1) { end = años[i]; }
      else { rangos.push(start === end ? `${start}` : `${start}-${end}`); start = end = años[i]; }
    }
    rangos.push(start === end ? `${start}` : `${start}-${end}`);
    console.log(`  ✗  ${key.padEnd(40)} ${rangos.join(', ')}`);
    console.log(`       busca: ${modelKeys.join(' | ')}`);
  }
}
