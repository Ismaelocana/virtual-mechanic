/**
 * Test semi-automático del flujo de login con Clerk magic link.
 *
 * Uso:
 *   node test-login-clerk.js                          → usa email por defecto
 *   node test-login-clerk.js otro@correo.com          → email personalizado
 *
 * El script automatiza: abrir la app → escribir email → clic en "Enviar enlace"
 * Luego deja el navegador abierto para que puedas pegar el enlace del correo.
 * Captura todos los logs de consola y errores de red en tiempo real.
 */

const { chromium } = require('playwright');

const EMAIL = process.argv[2] || 'ismaelocaa@gmail.com';
const URL   = 'https://virtualmechanic.es';

// ── Colores para la terminal ───────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',  gray: '\x1b[90m',   green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m',   cyan: '\x1b[36m', bold: '\x1b[1m',
};
const ts  = () => new Date().toLocaleTimeString('es', { hour12: false });
const log = (icon, color, ...args) => console.log(`${c.gray}${ts()}${c.reset} ${icon} ${color}${args.join(' ')}${c.reset}`);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--window-size=430,900'],
  });

  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
  });
  const page = await context.newPage();

  // ── Captura de logs de consola ───────────────────────────────────────────
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error')        log('❌', c.red,    `[console.error] ${text}`);
    else if (type === 'warn')    log('⚠️ ', c.yellow, `[console.warn]  ${text}`);
    else if (text.includes('[Clerk]')) log('🔑', c.cyan,   `[console.log]   ${text}`);
    else                         log('   ', c.gray,   `[console.log]   ${text}`);
  });

  page.on('pageerror', err => log('💥', c.red, `[page error] ${err.message}`));

  // ── Captura de peticiones de red ─────────────────────────────────────────
  page.on('requestfailed', req => {
    log('❌', c.red, `[net fail]  ${req.method()} ${req.url()}\n            ${req.failure()?.errorText}`);
  });

  page.on('response', async res => {
    const url    = req => req.url();
    const status = res.status();
    const method = res.request().method();
    const isClerk = res.url().includes('clerk');
    const isError = status >= 400;

    if (!isClerk && !isError) return; // solo Clerk y errores

    const color = status >= 500 ? c.red : status >= 400 ? c.yellow : c.green;
    const icon  = status >= 400 ? '⚠️ ' : '✓ ';
    log(icon, color, `[HTTP ${status}] ${method} ${res.url()}`);

    if (isError) {
      try {
        const body = await res.text();
        const preview = body.length > 400 ? body.slice(0, 400) + '…' : body;
        console.log(`         ${c.gray}${preview}${c.reset}`);
      } catch (_) {}
    }
  });

  // ── Navegar a la app ─────────────────────────────────────────────────────
  console.log(`\n${c.bold}═══════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}  TEST  ·  Clerk magic link — ${URL}${c.reset}`);
  console.log(`${c.bold}═══════════════════════════════════════════════════════${c.reset}`);
  log('→', c.cyan, `Abriendo ${URL} ...`);

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Esperar a que cargue Clerk y aparezca la pantalla de login
  log('⏳', c.gray, 'Esperando pantalla de login...');
  try {
    await page.waitForSelector('#login-email', { timeout: 15000 });
    log('✓', c.green, 'Pantalla de login visible');
  } catch {
    log('❌', c.red, 'No apareció #login-email en 15s — ¿ya hay sesión activa?');
    const screen = await page.evaluate(() =>
      [...document.querySelectorAll('.screen.active')].map(s => s.id).join(', ')
    );
    log('ℹ️ ', c.yellow, `Pantalla activa: ${screen}`);
  }

  // ── Escribir email ───────────────────────────────────────────────────────
  log('→', c.cyan, `Escribiendo email: ${EMAIL}`);
  await page.fill('#login-email', EMAIL);
  await page.waitForTimeout(400);

  // ── Clic en "Enviar enlace" ──────────────────────────────────────────────
  log('→', c.cyan, 'Haciendo clic en "Enviar enlace"...');
  await page.click('#btn-login');

  // Esperar a que aparezca el estado "Revisa tu correo" o un error
  log('⏳', c.gray, 'Esperando respuesta de Clerk...');
  try {
    await page.waitForFunction(
      () => {
        const sent  = document.getElementById('login-sent');
        const errEl = document.getElementById('login-err');
        return (sent  && sent.style.display  === 'flex') ||
               (errEl && errEl.textContent.trim() !== '');
      },
      { timeout: 20000 }
    );

    // Comprobar qué apareció
    const result = await page.evaluate(() => {
      const sent  = document.getElementById('login-sent');
      const errEl = document.getElementById('login-err');
      if (sent && sent.style.display === 'flex')
        return { ok: true, email: document.getElementById('login-email-sent')?.textContent };
      return { ok: false, error: errEl?.textContent };
    });

    if (result.ok) {
      log('✅', c.green, `Email enviado a ${result.email}`);
    } else {
      log('❌', c.red, `Error en la UI: "${result.error}"`);
    }
  } catch {
    log('⚠️ ', c.yellow, 'Timeout esperando respuesta — revisa los logs de arriba');
  }

  // ── Dejar el navegador abierto ───────────────────────────────────────────
  console.log(`\n${c.bold}───────────────────────────────────────────────────────${c.reset}`);
  console.log(`${c.bold}  Revisa ${EMAIL} y haz clic en el enlace del correo.${c.reset}`);
  console.log(`  El navegador permanece abierto. Los logs siguen capturándose.`);
  console.log(`  Pulsa ${c.bold}Ctrl+C${c.reset} para cerrar cuando hayas terminado.`);
  console.log(`${c.bold}───────────────────────────────────────────────────────${c.reset}\n`);

  process.on('SIGINT', async () => {
    log('→', c.gray, 'Cerrando navegador...');
    await browser.close();
    process.exit(0);
  });

  await new Promise(() => {}); // mantener proceso vivo
})().catch(async err => {
  console.error(`\n${c.red}Error fatal: ${err.message}${c.reset}`);
  process.exit(1);
});
