// ─────────────────────────────────────────────────────────────────────────────
// QA semanal — Nivel A (sin autenticación real, coste ≈0).
//
// Comprueba que:
//   1. Las páginas públicas principales responden 200.
//   2. /api/admin responde 200 con el password correcto (valida Vercel + Redis).
//   3. Los endpoints autenticados rechazan peticiones sin credenciales con el
//      código esperado (401 los que exigen JWT de Clerk, 400 los que solo
//      exigen un userId) — confirma que la función no está rota, sin gastar
//      una sola llamada a Claude/Pinecone/Voyage.
//   4. El flujo de "enviar enlace mágico" de Clerk acepta la petición y
//      muestra "Revisa tu correo" — sin completar un login real.
//
// Uso: node qa-checks.js
// Variables de entorno: ADMIN_PASSWORD (opcional; si falta, ese check falla
// con un mensaje claro en vez de deducir mal el motivo).
//
// Salida: imprime el detalle en consola, escribe qa-informe.md (para el
// cuerpo del issue de GitHub si algo falla) y termina con código 1 si hay
// algún fallo, 0 si todo va bien.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');

const BASE = 'https://www.virtualmechanic.es';
const TIMEOUT_MS = 15000;

const resultados = [];

function registrar(nombre, ok, detalle, informativo = false) {
  resultados.push({ nombre, ok, detalle, informativo });
  const icono = ok ? '✓' : (informativo ? '⚠' : '✗');
  console.log(`  ${icono}  ${nombre}${detalle ? `  —  ${detalle}` : ''}`);
}

async function fetchConTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. Páginas públicas ───────────────────────────────────────────────────────
const PAGINAS = [
  { path: '/', nombre: 'Landing' },
  { path: '/app', nombre: 'App principal' },
  { path: '/motos', nombre: 'Hub de motos' },
  { path: '/aviso-legal', nombre: 'Aviso legal' },
  { path: '/privacidad', nombre: 'Política de privacidad' },
  { path: '/terminos', nombre: 'Términos y condiciones' },
  { path: '/sitemap.xml', nombre: 'Sitemap' },
  { path: '/robots.txt', nombre: 'Robots.txt' },
];

async function comprobarPaginas() {
  console.log('\n── Páginas públicas ──────────────────────────────');
  for (const p of PAGINAS) {
    try {
      const res = await fetchConTimeout(BASE + p.path);
      registrar(`Página: ${p.nombre}`, res.status === 200, `HTTP ${res.status} — ${BASE}${p.path}`);
    } catch (e) {
      registrar(`Página: ${p.nombre}`, false, `Error de red: ${e.message} — ${BASE}${p.path}`);
    }
  }
}

// ── 2. /api/admin (valida Vercel + Redis, y de paso trae sinManual real) ──────
async function comprobarAdmin() {
  console.log('\n── /api/admin ────────────────────────────────────');
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd) {
    registrar('/api/admin responde con datos', false, 'Falta la variable de entorno ADMIN_PASSWORD (secret de GitHub no configurado)');
    return;
  }
  try {
    const res = await fetchConTimeout(`${BASE}/api/admin`, {
      headers: { 'x-admin-password': pwd }
    });
    if (res.status !== 200) {
      registrar('/api/admin responde con datos', false, `HTTP ${res.status} (esperaba 200 — revisa que ADMIN_PASSWORD coincide con el valor de Vercel)`);
      return;
    }
    const json = await res.json();
    const formaValida = typeof json.total === 'number' && Array.isArray(json.sinManual);
    registrar('/api/admin responde con datos', formaValida, formaValida
      ? `total=${json.total}, sinManual=${json.sinManual.length} combinaciones`
      : 'JSON con forma inesperada (¿cambió el endpoint?)');
    if (formaValida && json.sinManual.length > 0) {
      console.log(`     ℹ️  ${json.sinManual.length} combinaciones sin manual detectadas en tráfico real reciente (no es un fallo, solo información).`);
    }
  } catch (e) {
    registrar('/api/admin responde con datos', false, `Error de red: ${e.message}`);
  }
}

// ── 3. Endpoints autenticados rechazan sin credenciales con el código esperado
async function comprobarAuth() {
  console.log('\n── Endpoints autenticados ────────────────────────');

  try {
    const res = await fetchConTimeout(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], brand: 'KTM', model: 'EXC 300', year: 2024 })
    });
    registrar('/api/chat rechaza sin sesión', res.status === 401, `HTTP ${res.status} (esperaba 401)`);
  } catch (e) {
    registrar('/api/chat rechaza sin sesión', false, `Error de red: ${e.message}`);
  }

  try {
    const res = await fetchConTimeout(`${BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'qa-test', vote: 'up' })
    });
    registrar('/api/feedback rechaza sin sesión', res.status === 401, `HTTP ${res.status} (esperaba 401)`);
  } catch (e) {
    registrar('/api/feedback rechaza sin sesión', false, `Error de red: ${e.message}`);
  }

  try {
    const res = await fetchConTimeout(`${BASE}/api/history`);
    registrar('/api/history exige userId', res.status === 400, `HTTP ${res.status} (esperaba 400)`);
  } catch (e) {
    registrar('/api/history exige userId', false, `Error de red: ${e.message}`);
  }

  try {
    const res = await fetchConTimeout(`${BASE}/api/garage`);
    registrar('/api/garage exige userId', res.status === 400, `HTTP ${res.status} (esperaba 400)`);
  } catch (e) {
    registrar('/api/garage exige userId', false, `Error de red: ${e.message}`);
  }
}

// ── 4. Flujo de enlace mágico de Clerk (sin completar login real) ────────────
// NOTA: Clerk protege este formulario con Cloudflare Turnstile (#clerk-captcha),
// un sistema anti-bot que puede detectar y bloquear precisamente un navegador
// headless como este. Por eso este check es INFORMATIVO: si falla, se anota
// en el informe pero no hace fallar el workflow ni abre un issue — de lo
// contrario tendríamos falsos positivos semanales por el propio anti-bot,
// no por un fallo real de la app.
async function comprobarLoginClerk() {
  console.log('\n── Login (enlace mágico de Clerk) — informativo ──');
  const { chromium } = require('playwright');
  // Email dedicado a este chequeo: nunca se lee la bandeja ni se completa el
  // login. Solo importa que Clerk acepte la petición y muestre "Revisa tu
  // correo" — así no generamos un enlace mágico semanal a un buzón real.
  const EMAIL = 'qa-weekly-check@virtualmechanic.es';

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForSelector('#login-email', { state: 'visible', timeout: 15000 });
    await page.fill('#login-email', EMAIL);
    await page.click('#btn-login');

    const resultado = await page.waitForFunction(() => {
      const sent = document.getElementById('login-sent');
      const err = document.getElementById('login-err');
      if (sent && sent.style.display === 'flex') return { ok: true };
      if (err && err.textContent.trim() !== '') return { ok: false, error: err.textContent.trim() };
      return false;
    }, undefined, { timeout: 25000 }).then(h => h.jsonValue());

    registrar('Clerk acepta la petición de enlace mágico', resultado.ok,
      resultado.ok ? 'Apareció "Revisa tu correo"' : `Error en la UI: "${resultado.error}"`, true);
  } catch (e) {
    registrar('Clerk acepta la petición de enlace mágico', false,
      `${e.message} (puede deberse al anti-bot de Cloudflare Turnstile, no necesariamente a un fallo real)`, true);
  } finally {
    await browser.close();
  }
}

// ── Informe final ──────────────────────────────────────────────────────────
function escribirInforme() {
  const fallosCriticos = resultados.filter(r => !r.ok && !r.informativo);
  const avisos = resultados.filter(r => !r.ok && r.informativo);
  const ok = resultados.filter(r => r.ok);

  let md = `# Informe QA semanal — ${new Date().toISOString().slice(0, 10)}\n\n`;
  md += `**${ok.length}/${resultados.length} comprobaciones correctas.**\n\n`;

  if (fallosCriticos.length > 0) {
    md += `## ❌ Fallos (${fallosCriticos.length})\n\n`;
    for (const r of fallosCriticos) md += `- **${r.nombre}** — ${r.detalle || 'sin detalle'}\n`;
    md += '\n';
  }

  if (avisos.length > 0) {
    md += `## ⚠️ Avisos informativos, no bloquean el QA (${avisos.length})\n\n`;
    for (const r of avisos) md += `- ${r.nombre} — ${r.detalle || 'sin detalle'}\n`;
    md += '\n';
  }

  md += `## ✅ Correctas (${ok.length})\n\n`;
  for (const r of ok) md += `- ${r.nombre}${r.detalle ? ` — ${r.detalle}` : ''}\n`;

  fs.writeFileSync('qa-informe.md', md);
  return fallosCriticos;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  QA SEMANAL — Virtual Mechanic (Nivel A)');
  console.log('═══════════════════════════════════════════════════');

  await comprobarPaginas();
  await comprobarAdmin();
  await comprobarAuth();
  await comprobarLoginClerk();

  console.log('\n═══════════════════════════════════════════════════');
  const fallos = escribirInforme();
  if (fallos.length > 0) {
    console.log(`  ❌ ${fallos.length} comprobación(es) fallaron. Ver qa-informe.md`);
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(1);
  }
  console.log(`  ✅ Todas las comprobaciones (${resultados.length}) correctas.`);
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('Error fatal ejecutando el QA:', e);
  process.exit(1);
});
