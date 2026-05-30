const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PDF_A_TEXTO = path.join(__dirname, 'pdf-a-texto.js');

const KTM = 'https://www.ktmshop.se/documents';
const KTM2 = 'https://www.ktmshop.se/bike-manuals';
const GG = 'https://gasgas.com.ru/assets/media/files/manuals';

const DESCARGAS = [
  // ── KTM SX 2T ─────────────────────────────────────────────────────────────
  { url: `${KTM}/16_3213330_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125-150-250', year: 2016 }] },
  { url: `${KTM}/17_3213471_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125-150-250', year: 2017 }] },
  { url: `${KTM}/18_3213636_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125-150', year: 2018 }] },
  { url: `${KTM}/18_3213637_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx250', year: 2018 }] },
  { url: `${KTM}/19_3213847_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125-150', year: 2019 }] },
  { url: `${KTM}/19_3213848_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx250', year: 2019 }] },
  { url: `${KTM}/20_3214000_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125-150', year: 2020 }] },
  { url: `${KTM}/20_3214001_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx250', year: 2020 }] },
  { url: `${KTM2}/21_3214209_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125-150', year: 2021 }] },
  { url: `${KTM2}/21_3214210_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx250', year: 2021 }] },
  { url: `${KTM}/22_3214411_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125-150', year: 2022 }] },
  { url: `${KTM}/22_3214412_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx250', year: 2022 }] },
  { url: `${KTM2}/23_3214638_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125', year: 2023 }] },
  { url: `${KTM2}/23_3214639_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx250-300', year: 2023 }] },
  { url: `${KTM2}/24_3214832_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx125', year: 2024 }] },
  { url: `${KTM2}/24_3214833_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx250-300', year: 2024 }] },

  // ── KTM SX 85 ─────────────────────────────────────────────────────────────
  { url: `${KTM2}/24_3214830_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx85', year: 2024 }] },

  // ── KTM SX-F 4T ───────────────────────────────────────────────────────────
  { url: `${KTM}/16_3213331_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2016 }] },
  { url: `${KTM}/17_3213473_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2017 }] },
  { url: `${KTM}/17_3213474_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2017 }] },
  { url: `${KTM}/17_3213476_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2017 }] },
  { url: `${KTM}/18_3213638_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2018 }] },
  { url: `${KTM}/18_3213640_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2018 }] },
  { url: `${KTM}/18_3213641_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2018 }] },
  { url: `${KTM}/19_3213849_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2019 }] },
  { url: `${KTM}/19_3213850_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2019 }] },
  { url: `${KTM}/19_3213851_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2019 }] },
  { url: `${KTM}/20_3214003_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2020 }] },
  { url: `${KTM}/20_3214004_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2020 }] },
  { url: `${KTM}/20_3214005_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2020 }] },
  { url: `${KTM2}/21_3214213_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2021 }] },
  { url: `${KTM2}/21_3214215_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2021 }] },
  { url: `${KTM2}/21_3214217_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2021 }] },
  { url: `${KTM}/22_3214414_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2022 }] },
  { url: `${KTM}/22_3214417_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2022 }] },
  { url: `${KTM}/22_3214418_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2022 }] },
  { url: `${KTM2}/23_3214640_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2023 }] },
  { url: `${KTM2}/23_3214641_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2023 }] },
  { url: `${KTM2}/23_3214642_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2023 }] },
  { url: `${KTM2}/24_3214834_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f250', year: 2024 }] },
  { url: `${KTM2}/24_3214835_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f350', year: 2024 }] },
  { url: `${KTM2}/24_3214836_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'sx-f450', year: 2024 }] },

  // ── KTM EXC extras (encontrados durante la búsqueda) ──────────────────────
  { url: `${KTM}/22_3214420_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'exc150', year: 2022 }] },
  { url: `${KTM}/22_3214423_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'exc-f250', year: 2022 }] },
  { url: `${KTM2}/23_3214643_en_OM.pdf`, brand: 'ktm', targets: [{ model: 'exc150', year: 2023 }] },

  // ── GasGas MC 2T ──────────────────────────────────────────────────────────
  { url: `${GG}/motocross/mc%2065%202022.pdf`, brand: 'gasgas', targets: [{ model: 'mc65', year: 2022 }] },
  { url: `${GG}/motocross/mc%2065%202023.pdf`, brand: 'gasgas', targets: [{ model: 'mc65', year: 2023 }] },
  { url: `${GG}/motocross/mc%2065%202024.pdf`, brand: 'gasgas', targets: [{ model: 'mc65', year: 2024 }] },
  { url: `${GG}/motocross/mc%2085%202022.pdf`, brand: 'gasgas', targets: [{ model: 'mc85', year: 2022 }] },
  { url: `${GG}/motocross/mc%2085%202023.pdf`, brand: 'gasgas', targets: [{ model: 'mc85', year: 2023 }] },
  { url: `${GG}/motocross/mc%2085%202024.pdf`, brand: 'gasgas', targets: [{ model: 'mc85', year: 2024 }] },
  { url: `${GG}/motocross/mc%20125%202021.pdf`, brand: 'gasgas', targets: [{ model: 'mc125', year: 2021 }] },
  { url: `${GG}/motocross/mc%20125%202022.pdf`, brand: 'gasgas', targets: [{ model: 'mc125', year: 2022 }] },
  { url: `${GG}/motocross/mc%20125%202023.pdf`, brand: 'gasgas', targets: [{ model: 'mc125', year: 2023 }] },
  { url: `${GG}/motocross/mc%20125%202024.pdf`, brand: 'gasgas', targets: [{ model: 'mc125', year: 2024 }] },
  { url: `${GG}/motocross/mc%20250%202022.pdf`, brand: 'gasgas', targets: [{ model: 'mc250', year: 2022 }] },
  { url: `${GG}/motocross/mc%20250%202023.pdf`, brand: 'gasgas', targets: [{ model: 'mc250', year: 2023 }] },
  { url: `${GG}/motocross/mc%20250%202024.pdf`, brand: 'gasgas', targets: [{ model: 'mc250', year: 2024 }] },

  // ── GasGas MC 4T ──────────────────────────────────────────────────────────
  { url: `${GG}/motocross/mc%20250F%202022.pdf`, brand: 'gasgas', targets: [{ model: 'mc250f', year: 2022 }] },
  { url: `${GG}/motocross/mc%20250F%202023.pdf`, brand: 'gasgas', targets: [{ model: 'mc250f', year: 2023 }] },
  { url: `${GG}/motocross/mc%20350F%202022.pdf`, brand: 'gasgas', targets: [{ model: 'mc350f', year: 2022 }] },
  { url: `${GG}/motocross/mc%20350F%202023.pdf`, brand: 'gasgas', targets: [{ model: 'mc350f', year: 2023 }] },
  { url: `${GG}/motocross/mc%20350F%202024.pdf`, brand: 'gasgas', targets: [{ model: 'mc350f', year: 2024 }] },
  { url: `${GG}/motocross/mc%20450F%202022.pdf`, brand: 'gasgas', targets: [{ model: 'mc450f', year: 2022 }] },
  { url: `${GG}/motocross/mc%20450F%202023.pdf`, brand: 'gasgas', targets: [{ model: 'mc450f', year: 2023 }] },
  { url: `${GG}/motocross/mc%20450F%202024.pdf`, brand: 'gasgas', targets: [{ model: 'mc450f', year: 2024 }] },

  // ── GasGas TXT Trial ──────────────────────────────────────────────────────
  { url: `${GG}/trial/TXT%20GP%20300%202021.pdf`, brand: 'gasgas', targets: [{ model: 'txt125-250-280-300', year: 2021 }] },
  { url: `${GG}/trial/TXT%20GP%20300%202022.pdf`, brand: 'gasgas', targets: [{ model: 'txt125-250-280-300', year: 2022 }] },
  { url: `${GG}/trial/TXT%20GP%20300%202023.pdf`, brand: 'gasgas', targets: [{ model: 'txt125-250-280-300', year: 2023 }] },
  { url: `${GG}/trial/TXT%20GP%20300%202024.pdf`, brand: 'gasgas', targets: [{ model: 'txt125-250-280-300', year: 2024 }] },
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
