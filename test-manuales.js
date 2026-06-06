const fs = require('fs');

const API = 'https://virtual-mechanic.vercel.app/api/chat';
const CONCURRENCIA = 2;
const DELAY_MS = 500;

// ── Extraer brandsData de index.html ─────────────────────────────────────────
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/const brandsData = (\{[\s\S]+?\});\s*\nconst catIcons/);
if (!match) { console.error('No se pudo extraer brandsData de index.html'); process.exit(1); }
const brandsData = eval('(' + match[1] + ')');

// ── Replicar lógica de años de selectModel ────────────────────────────────────
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
    if (brand === 'Triumph' && model.endsWith('-E')) fromYear = 2026;
    else fromYear = 2025;
  }
  const years = [];
  for (let y = toYear; y >= fromYear; y--) years.push(y);
  return years;
}

// ── Generar lista de combinaciones ────────────────────────────────────────────
function getCombinaciones() {
  const combis = [];
  for (const [brand, data] of Object.entries(brandsData)) {
    for (const [cat, engines] of Object.entries(data.categories)) {
      for (const [eng, models] of Object.entries(engines)) {
        for (const model of models) {
          const years = getYears(brand, model, eng);
          for (const year of years) {
            combis.push({ brand, cat, eng, model, year });
          }
        }
      }
    }
  }
  return combis;
}

// ── Llamada a la API ──────────────────────────────────────────────────────────
async function testCombi({ brand, model, year }) {
  const body = JSON.stringify({
    brand,
    model,
    year,
    messages: [{ role: 'user', content: '¿Tienes el manual oficial de esta moto? Responde únicamente TENGO_MANUAL o SIN_MANUAL.' }]
  });

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    const reply = (json.reply || '').toUpperCase();
    const tieneManual = reply.includes('TENGO_MANUAL') && !reply.includes('SIN_MANUAL');
    return { ok: true, tieneManual };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Ejecutar en paralelo con límite ──────────────────────────────────────────
async function runBatch(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const combis = getCombinaciones();
  console.log(`\nTestando ${combis.length} combinaciones (${CONCURRENCIA} en paralelo)...\n`);

  let done = 0;
  const resultados = await runBatch(combis, async (c) => {
    const r = await testCombi(c);
    done++;
    const estado = r.ok ? (r.tieneManual ? '✓' : '✗') : '!';
    process.stdout.write(`\r  Progreso: ${done}/${combis.length}  `);
    return { ...c, ...r };
  }, CONCURRENCIA);

  console.log('\n');

  // ── Informe ─────────────────────────────────────────────────────────────────
  const sinManual = resultados.filter(r => r.ok && !r.tieneManual);
  const errores   = resultados.filter(r => !r.ok);
  const conManual = resultados.filter(r => r.ok && r.tieneManual);

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  INFORME DE COBERTURA DE MANUALES`);
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  ✓ Con manual:    ${conManual.length}`);
  console.log(`  ✗ Sin manual:    ${sinManual.length}`);
  console.log(`  ! Errores API:   ${errores.length}`);
  console.log(`  Total testado:   ${resultados.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (sinManual.length > 0) {
    console.log('SIN MANUAL — combinaciones sin cobertura:\n');
    // Agrupar por marca+modelo
    const grupos = {};
    for (const r of sinManual) {
      const key = `${r.brand} | ${r.model}`;
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(r.year);
    }
    for (const [key, years] of Object.entries(grupos)) {
      years.sort((a, b) => a - b);
      // Comprimir rangos: 2005,2006,2007 → 2005-2007
      const rangos = [];
      let start = years[0], end = years[0];
      for (let i = 1; i < years.length; i++) {
        if (years[i] === end + 1) { end = years[i]; }
        else { rangos.push(start === end ? `${start}` : `${start}-${end}`); start = end = years[i]; }
      }
      rangos.push(start === end ? `${start}` : `${start}-${end}`);
      console.log(`  ✗  ${key.padEnd(35)} ${rangos.join(', ')}`);
    }
  }

  if (errores.length > 0) {
    console.log('\nERRORES API:\n');
    for (const r of errores) {
      console.log(`  !  ${r.brand} ${r.model} ${r.year}: ${r.error}`);
    }
  }

  // Guardar informe completo en JSON
  const informe = {
    fecha: new Date().toISOString(),
    total: resultados.length,
    conManual: conManual.length,
    sinManual: sinManual.length,
    errores: errores.length,
    detalle: sinManual.map(r => ({ brand: r.brand, model: r.model, year: r.year }))
  };
  fs.writeFileSync('informe-manuales.json', JSON.stringify(informe, null, 2));
  console.log('\nInforme completo guardado en informe-manuales.json');
}

main().catch(e => { console.error(e.message); process.exit(1); });
