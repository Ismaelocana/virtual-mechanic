const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PDF_A_TEXTO = path.join(__dirname, 'pdf-a-texto.js');

// Lista de descargas: { url, brand, targets: [{model, year}] }
const DESCARGAS = [
  // ── KTM ──────────────────────────────────────────────────────────────────
  {
    url: 'https://en.enduro.team/images/c/c8/2015_KTM_125_200_250_300-OM-eng.pdf',
    brand: 'ktm',
    targets: [
      { model: 'exc125', year: 2015 },
      { model: 'exc200', year: 2015 },
      { model: 'exc250', year: 2015 },
      { model: 'exc300', year: 2015 },
    ],
  },
  {
    url: 'https://en.enduro.team/images/1/11/2020_KTM_250-300_EXC_TPI_OM_eng.pdf',
    brand: 'ktm',
    targets: [
      { model: 'exc250', year: 2020 },
      { model: 'exc300', year: 2020 },
    ],
  },
  {
    url: 'https://en.enduro.team/images/0/01/2021_KTM_250-300_EXC_TPI_OM_eng.pdf',
    brand: 'ktm',
    targets: [
      { model: 'exc250', year: 2021 },
      { model: 'exc300', year: 2021 },
    ],
  },
  {
    url: 'https://en.enduro.team/images/9/9a/2022_KTM_250-300_EXC_TPI_OM_eng.pdf',
    brand: 'ktm',
    targets: [
      { model: 'exc250', year: 2022 },
      { model: 'exc300', year: 2022 },
    ],
  },
  {
    url: 'https://en.enduro.team/images/0/0e/2012_450-500_EXC-F_eng.pdf',
    brand: 'ktm',
    targets: [
      { model: 'exc-f450', year: 2012 },
      { model: 'exc-f500', year: 2012 },
    ],
  },
  {
    url: 'https://en.enduro.team/images/a/aa/2013_450-500_EXC-F_eng.pdf',
    brand: 'ktm',
    targets: [
      { model: 'exc-f450', year: 2013 },
      { model: 'exc-f500', year: 2013 },
    ],
  },
  {
    url: 'https://en.enduro.team/images/d/d3/2014_250_EXC-F_eng.pdf',
    brand: 'ktm',
    targets: [{ model: 'exc-f250', year: 2014 }],
  },
  {
    url: 'https://en.enduro.team/images/7/7f/2017_250_EXC-F_eng.pdf',
    brand: 'ktm',
    targets: [{ model: 'exc-f250', year: 2017 }],
  },

  // ── Husqvarna ─────────────────────────────────────────────────────────────
  {
    url: 'https://en.enduro.team/images/4/47/Husqvarna_16_te_en_OM.pdf',
    brand: 'husqvarna',
    targets: [
      { model: 'te125', year: 2016 },
      { model: 'te150', year: 2016 },
      { model: 'te250', year: 2016 },
      { model: 'te300', year: 2016 },
    ],
  },
  {
    url: 'https://en.enduro.team/images/8/85/Husqvarna_17_te_en_OM.pdf',
    brand: 'husqvarna',
    targets: [
      { model: 'te125', year: 2017 },
      { model: 'te150', year: 2017 },
      { model: 'te250', year: 2017 },
      { model: 'te300', year: 2017 },
    ],
  },

  // ── GasGas ────────────────────────────────────────────────────────────────
  // EC 250/300 2T
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250%202021.pdf',
    brand: 'gasgas',
    targets: [
      { model: 'ec250', year: 2021 },
      { model: 'ec300', year: 2021 },
    ],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250%202022.pdf',
    brand: 'gasgas',
    targets: [
      { model: 'ec250', year: 2022 },
      { model: 'ec300', year: 2022 },
    ],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250%202023.pdf',
    brand: 'gasgas',
    targets: [
      { model: 'ec250', year: 2023 },
      { model: 'ec300', year: 2023 },
    ],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250%202024.pdf',
    brand: 'gasgas',
    targets: [
      { model: 'ec250', year: 2024 },
      { model: 'ec300', year: 2024 },
    ],
  },
  // EC 250F 4T
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250F%202022.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec250f', year: 2022 }],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250F%202023.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec250f', year: 2023 }],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20250F%202024.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec250f', year: 2024 }],
  },
  // EC 350F 4T
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20350F%202021.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec350f', year: 2021 }],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20350F%202022.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec350f', year: 2022 }],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20350F%202023.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec350f', year: 2023 }],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20350F%202024.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec350f', year: 2024 }],
  },
  // EC 450F y EC 500F 4T (solo 2024 disponible)
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20450F%202024.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec450f', year: 2024 }],
  },
  {
    url: 'https://gasgas.com.ru/assets/media/files/manuals/enduro/EC%20500F%202024.pdf',
    brand: 'gasgas',
    targets: [{ model: 'ec500f', year: 2024 }],
  },
];

function curlDownload(url, dest) {
  execSync(`curl -s -L -A "${UA}" -o "${dest}" "${url}"`, { stdio: 'inherit' });
}

function convertirPdf(pdfPath, txtPath) {
  const result = spawnSync('node', [PDF_A_TEXTO, pdfPath, txtPath], {
    stdio: 'inherit',
    timeout: 120000,
  });
  if (result.status !== 0) throw new Error(`pdf-a-texto falló en ${pdfPath}`);
}

async function main() {
  let total = 0;
  for (const { url, brand, targets } of DESCARGAS) {
    const brandDir = path.join(__dirname, 'manuales', brand);
    fs.mkdirSync(brandDir, { recursive: true });

    // Comprobar si ya existe algún target
    const firstTarget = `${targets[0].model}-${targets[0].year}.txt`;
    if (fs.existsSync(path.join(brandDir, firstTarget))) {
      console.log(`  Saltando (ya existe): ${brand}/${firstTarget}`);
      continue;
    }

    const tmpPdf = path.join(brandDir, '_tmp.pdf');
    const tmpTxt = path.join(brandDir, '_tmp.txt');

    console.log(`\nDescargando ${brand}: ${path.basename(url)}`);
    try {
      curlDownload(url, tmpPdf);

      const pdfSize = fs.statSync(tmpPdf).size;
      if (pdfSize < 10000) {
        console.log(`  ERROR: PDF demasiado pequeño (${pdfSize} bytes), saltando`);
        fs.unlinkSync(tmpPdf);
        continue;
      }

      console.log(`  Convirtiendo...`);
      convertirPdf(tmpPdf, tmpTxt);

      const txt = fs.readFileSync(tmpTxt, 'utf8');

      for (const { model, year } of targets) {
        const dest = path.join(brandDir, `${model}-${year}.txt`);
        fs.writeFileSync(dest, txt);
        console.log(`  ✓ ${brand}/${model}-${year}.txt`);
        total++;
      }
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
      if (fs.existsSync(tmpTxt)) fs.unlinkSync(tmpTxt);
    }
  }

  console.log(`\n✅ ${total} archivo(s) generado(s)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
