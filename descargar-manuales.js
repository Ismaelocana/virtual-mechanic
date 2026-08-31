// Descarga manuales de propietario de fuentes públicas oficiales y los convierte a .txt
// Uso: node descargar-manuales.js
//      node descargar-manuales.js --marca=sherco   (solo una marca)
//      node descargar-manuales.js --desde=beta/rr2t-2024  (saltar hasta ese archivo)

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MANUALES_DIR = path.join(__dirname, 'manuales');

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE MANUALES
// Cada entrada: { marca, modelo, año, url }
// Un PDF puede cubrir varios modelos (ej. SE 250-300 → mismo manual para ambos)
// ─────────────────────────────────────────────────────────────────────────────
const MANUALES = [

  // ── SHERCO ────────────────────────────────────────────────────────────────
  // Fuente: sherco.com/wp-content/uploads/ — acceso directo sin login
  // Patrón: OWNER_MANUAL_{cilindrada}_{modelo}-{año}.pdf

  { marca: 'sherco', modelo: 'se125',    año: 2024, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_125-SE-2T-2024.pdf' },
  { marca: 'sherco', modelo: 'se125',    año: 2025, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_125-SE-2T-2025.pdf' },
  { marca: 'sherco', modelo: 'se250-300', año: 2024, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_250-300_SE-2024.pdf' },
  { marca: 'sherco', modelo: 'se250-300', año: 2025, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_250-300_SE-2025.pdf' },
  { marca: 'sherco', modelo: 'se250-300', año: 2026, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_250-300_SE-2026.pdf' },
  { marca: 'sherco', modelo: 'sef250-300', año: 2024, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_250-300_SEF-2024.pdf' },
  { marca: 'sherco', modelo: 'sef250-300', año: 2025, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_250-300_SEF-2025.pdf' },
  { marca: 'sherco', modelo: 'sef250-300', año: 2026, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_250-300_SEF-2026.pdf' },
  { marca: 'sherco', modelo: 'sef450-500', año: 2024, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_450-500_SEF-2024.pdf' },
  { marca: 'sherco', modelo: 'sef450-500', año: 2025, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_450-500_SEF-2025.pdf' },
  { marca: 'sherco', modelo: 'sef450-500', año: 2026, url: 'https://www.sherco.com/wp-content/uploads/OWNER_MANUAL_450-500_SEF-2026.pdf' },
  { marca: 'sherco', modelo: 'st125-250-300', año: 2025, url: 'https://www.sherco.com/wp-content/uploads/SHERCO-OWNERS-MANUAL-TRIAL-125-250-300-ST-F-FACTORY-2025.pdf' },

  // ── BETA ──────────────────────────────────────────────────────────────────
  // Fuente: betausa.com — importador oficial USA, sin login ni VIN
  // (betamotor.com oficial requiere VIN)

  { marca: 'beta', modelo: 'rr2t',    año: 2024, url: 'https://betausa.com/content/2024_Owner%20manual_RR%26RR-Race_2Stroke.pdf' },
  { marca: 'beta', modelo: 'rr4t',    año: 2024, url: 'https://betausa.com/content/SUPPORT_PDF%27s/2024_Owner%20manual_RR%26RR-Race_4Stroke.pdf' },
  { marca: 'beta', modelo: 'xtrainer', año: 2024, url: 'https://betausa.com/content/2024xtrainer.pdf' },
  { marca: 'beta', modelo: 'rr2t',    año: 2025, url: 'https://betausa.com/content/2025-Owner%20manual-RR-RACE-2T.rev.pdf' },
  { marca: 'beta', modelo: 'rr4t',    año: 2025, url: 'https://betausa.com/content/race4t_Owner%20manual_%20RR4T_EN%20%281%29.pdf' },
  { marca: 'beta', modelo: 'xtrainer', año: 2025, url: 'https://betausa.com/content/2025%20250-300%20Beta%20Xtrainer%20owners%20Manual.pdf' },
  { marca: 'beta', modelo: 'rr2t',    año: 2026, url: 'https://betausa.com/content/Owner%20manual%5FRace%202t%5FEN.pdf' },
  { marca: 'beta', modelo: 'xtrainer', año: 2026, url: 'https://betausa.com/content/Owner%20manual%5FXTRAINER%5FEN.pdf' },

  // ── KTM ───────────────────────────────────────────────────────────────────
  // Fuente: ktmshop.se — concesionario oficial sueco, sin login
  // Nota: cada PDF cubre varios modelos similares del mismo año
  // El nº de artículo (ej. 3214007) es interno de KTM y no predecible

  { marca: 'ktm', modelo: 'exc250-300tpi', año: 2020, url: 'https://www.ktmshop.se/bike-manuals/20_3214007_en_OM.pdf' },
  { marca: 'ktm', modelo: 'exc-f350',      año: 2022, url: 'https://www.ktmshop.se/bike-manuals/22_3214424_en_OM.pdf' },
  { marca: 'ktm', modelo: 'exc250-300',    año: 2023, url: 'https://www.ktmshop.se/bike-manuals/23_3214644_en_OM.pdf' },
  { marca: 'ktm', modelo: 'sx250-300',     año: 2024, url: 'https://www.ktmshop.se/bike-manuals/24_3214833_en_OM.pdf' },
  { marca: 'ktm', modelo: 'sx-f250',       año: 2024, url: 'https://www.ktmshop.se/bike-manuals/24_3214834_en_OM.pdf' },
  { marca: 'ktm', modelo: 'sx125-150',     año: 2025, url: 'https://www.ktmshop.se/bike-manuals/25_3240041_en_OM.pdf' },
  { marca: 'ktm', modelo: 'sx-f250',       año: 2025, url: 'https://www.ktmshop.se/bike-manuals/25_3240043_en_OM.pdf' },

  // ── GASGAS ────────────────────────────────────────────────────────────────
  // Fuente: gasgas.com.ru — web regional oficial, sin login
  // gasgas.com oficial redirige a print.ktm.com (portal de pago)

  { marca: 'gasgas', modelo: 'ec250-300', año: 2024, url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250%202024.pdf' },
  { marca: 'gasgas', modelo: 'ec500f',    año: 2024, url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20500F%202024.pdf' },

  // ── HUSQVARNA ─────────────────────────────────────────────────────────────
  // husqvarna-motorcycles.com redirige a print.ktm.com (pago)
  // No se encontraron URLs públicas directas equivalentes a ktmshop.se
  // Los manuales TE/FE ya indexados vienen de PDFs convertidos manualmente

  // ── HONDA ─────────────────────────────────────────────────────────────────
  // Fuente: hondamotopub.com (portal oficial global de Honda) — sin login,
  // sin protección anti-bot. Región Europa (HMEE): el manual cubre R y RX en
  // un mismo documento para cada cilindrada, de ahí el token compartido.
  // API de búsqueda (JSON, sin necesidad de navegador):
  //   GET /ajax/get_model_names/HMEE/{cc}          cc: "1-125"|"126-400"|"401-750"|"751-"
  //   GET /ajax/get_model_years/HMEE/{model_name}
  //   Página con el PDF real: /om/HMEE/{model_name}/{year}
  // powersports.honda.com (EE.UU.) tiene URLs más recientes pero está detrás
  // de Akamai Bot Manager — descartado (mismo motivo que KTM con Cloudflare).
  // CRF125R: no existe manual publicado en ningún registro (US ni EU) — es un
  // modelo de competición sin homologación, probablemente nunca se publicó.
  // 2024 (CRF250R/450R): solo visor web (webom.hondamotopub.com), no PDF
  // descargable — se dejó sin cubrir en vez de scrapear el visor.

  { marca: 'honda', modelo: 'crf450r-450rx', año: 2019, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF450R/2019/CRF450R.RX_3RMKE621_0_Eng.pdf' },
  { marca: 'honda', modelo: 'crf450r-450rx', año: 2020, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF450R/2020/CRF450R.RX_3RMKE630_0_Eng.pdf' },
  { marca: 'honda', modelo: 'crf450r-450rx', año: 2021, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF450R/2021/42MKE602%20OM%20CRF450R-RX%2021_eng_WEB.pdf' },
  { marca: 'honda', modelo: 'crf450r-450rx', año: 2022, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF450R/2022/42MKE6020_eng_BOOK.pdf' },
  { marca: 'honda', modelo: 'crf450r-450rx', año: 2023, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF450R/2023/English%20file_42MKE6100_eng_BOOK.pdf' },
  { marca: 'honda', modelo: 'crf450r-450rx', año: 2025, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF450R/2025/CRF450R_RX_RWE-S_42MKE630_eng_WEB.pdf' },
  { marca: 'honda', modelo: 'crf450r-450rx', año: 2026, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF450R/2026/CRF450R_RX_RWE_32MKEB00_OM_eng_WEB.pdf' },

  { marca: 'honda', modelo: 'crf250r-250rx', año: 2019, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF250R/2019/CRF250R.RX_3RK95610_0_Eng.pdf' },
  { marca: 'honda', modelo: 'crf250r-250rx', año: 2020, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF250R/2020/CRF250R.RX_3RK95621_0_Eng.pdf' },
  { marca: 'honda', modelo: 'crf250r-250rx', año: 2022, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF250R/2022/INDEX%E7%84%A1%E3%81%97_20210720082638_32K958110_eng_BOOK.pdf' },
  { marca: 'honda', modelo: 'crf250r-250rx', año: 2025, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF250R/2025/CRF250R_RX_RWE%20OM%2032K95830_eng_WEB.pdf' },
  { marca: 'honda', modelo: 'crf250r-250rx', año: 2026, url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF250R/2026/CRF250R_RX_RWE_32K958400_OM_EN_web.pdf' },

  // Un solo PDF cubre 2022-2025 (mismo manual, sin cambios) — se descarga una
  // vez y se copia a los 4 años; por eso no aparece aquí como 4 URLs.
  { marca: 'honda', modelo: 'crf150r', año: '2022-2023-2024-2025', url: 'https://2rom-prd-data.hondamotopub.com/om/HMEE/CRF150RB/2022-2023-2024-2025/INDEX%E7%84%A1%E3%81%97_20210720082851_32KSE8110_eng_BOOK.pdf' },

];

// ─────────────────────────────────────────────────────────────────────────────
// DESCARGA CON REDIRECCIONES Y USER-AGENT
// ─────────────────────────────────────────────────────────────────────────────
function descargarPDF(url, destino) {
  return new Promise((resolve, reject) => {
    const archivo = fs.createWriteStream(destino);

    function seguir(urlActual, saltos = 0) {
      if (saltos > 5) { archivo.destroy(); return reject(new Error('Demasiadas redirecciones')); }
      const proto = urlActual.startsWith('https') ? https : http;
      proto.get(urlActual, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          return seguir(res.headers.location, saltos + 1);
        }
        if (res.statusCode !== 200) {
          archivo.destroy();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(archivo);
        archivo.on('finish', () => archivo.close(resolve));
        archivo.on('error', reject);
      }).on('error', reject);
    }

    seguir(url);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESAR UN MANUAL
// ─────────────────────────────────────────────────────────────────────────────
async function procesarManual({ marca, modelo, año, url }) {
  const dirMarca = path.join(MANUALES_DIR, marca);
  const baseName = `${modelo}-${año}`;
  const pdfPath  = path.join(dirMarca, `${baseName}.pdf`);
  const txtPath  = path.join(dirMarca, `${baseName}.txt`);

  if (fs.existsSync(txtPath)) {
    console.log(`  ↷ Ya existe ${marca}/${baseName}.txt`);
    return { ok: true, saltado: true };
  }

  fs.mkdirSync(dirMarca, { recursive: true });

  process.stdout.write(`\n↓ ${marca}/${baseName}  `);
  try {
    await descargarPDF(url, pdfPath);
    process.stdout.write('PDF ✓  ');
  } catch (err) {
    console.log(`\n  ✗ Descarga fallida: ${err.message}`);
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    return { ok: false };
  }

  try {
    execSync(`node pdf-a-texto.js "${pdfPath}" "${txtPath}"`, { stdio: 'pipe' });
    fs.unlinkSync(pdfPath); // borrar PDF, solo guardamos el .txt
    console.log(`→ txt ✓`);
    return { ok: true };
  } catch (err) {
    console.log(`\n  ✗ Conversión fallida`);
    return { ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const argMarca = (process.argv.find(a => a.startsWith('--marca=')) || '').replace('--marca=', '');
  const argDesde = (process.argv.find(a => a.startsWith('--desde=')) || '').replace('--desde=', '');

  let lista = MANUALES;
  if (argMarca) lista = lista.filter(m => m.marca === argMarca);

  let saltando = !!argDesde;
  if (argDesde) {
    lista = lista.filter(m => {
      if (saltando && `${m.marca}/${m.modelo}-${m.año}` === argDesde) saltando = false;
      return !saltando;
    });
  }

  console.log(`Virtual Mechanic — descarga de manuales`);
  console.log(`${lista.length} manual(es) a procesar\n`);

  let ok = 0, fallidos = 0, saltados = 0;
  for (const m of lista) {
    const res = await procesarManual(m);
    if (res.saltado) saltados++;
    else if (res.ok)  ok++;
    else              fallidos++;
  }

  console.log(`\n─────────────────────────────`);
  console.log(`✅ Descargados: ${ok}`);
  if (saltados) console.log(`↷  Ya existían: ${saltados}`);
  if (fallidos) console.log(`✗  Fallidos:    ${fallidos}`);
}

main().catch(console.error);
