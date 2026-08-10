// ─────────────────────────────────────────────────────────────────────────────
// Informe semanal por email — estadísticas de la semana pasada (lunes-domingo).
//
// Lee /api/admin (mismo endpoint que usa el panel, protegido con ADMIN_PASSWORD)
// y envía un resumen por email vía Resend: consultas totales, usuarios activos,
// % de satisfacción del feedback, modelos más consultados y modelos sin manual
// pedidos (acumulado histórico, para priorizar qué indexar).
//
// Uso: node informe-semanal.js
// Variables de entorno: ADMIN_PASSWORD, RESEND_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

const BASE = 'https://www.virtualmechanic.es';
const DESTINATARIO = 'soporte@virtualmechanic.es';
// Remitente de pruebas de Resend: funciona sin verificar un dominio propio.
// Cuando se verifique virtualmechanic.es en Resend, cambiar por algo como
// 'Virtual Mechanic <informes@virtualmechanic.es>'.
const REMITENTE = 'Virtual Mechanic <onboarding@resend.dev>';

function formatoFecha(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function nombreModelo(clave) {
  return clave.replace('|', ' ');
}

function construirHtml(datos) {
  const { week, sinManual } = datos;
  const totalFb = week.fbUp + week.fbDown;
  const satisfaccion = totalFb > 0 ? Math.round((week.fbUp / totalFb) * 100) : null;

  const filasModelos = week.brands.length
    ? week.brands.slice(0, 5).map(b => `<li>${nombreModelo(b.name)} — ${b.count} consulta${b.count === 1 ? '' : 's'}</li>`).join('')
    : '<li style="color:#888">Sin consultas esta semana</li>';

  const filasSinManual = sinManual.length
    ? sinManual.slice(0, 5).map(s => `<li>${s.brand} ${s.model} (${s.year}) — pedido ${s.count} ${s.count === 1 ? 'vez' : 'veces'}</li>`).join('')
    : '<li style="color:#888">Sin huecos detectados</li>';

  return `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
      <h1 style="font-size:18px;color:#EF9F27">Virtual Mechanic — Informe semanal</h1>
      <p style="font-size:13px;color:#666">Semana del ${formatoFecha(week.desde)} al ${formatoFecha(week.hasta)}</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee">Consultas totales</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${week.total}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee">Usuarios activos</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${week.activeUsers}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee">Satisfacción del feedback</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${satisfaccion !== null ? satisfaccion + '% (' + week.fbUp + '👍 / ' + week.fbDown + '👎)' : 'sin votos esta semana'}</td></tr>
      </table>

      <h2 style="font-size:15px;margin-top:20px">Modelos más consultados esta semana</h2>
      <ul style="font-size:13px;padding-left:20px;margin:8px 0">${filasModelos}</ul>

      <h2 style="font-size:15px;margin-top:20px">Modelos sin manual más pedidos (acumulado histórico)</h2>
      <ul style="font-size:13px;padding-left:20px;margin:8px 0">${filasSinManual}</ul>

      <p style="font-size:11px;color:#999;margin-top:24px">Generado automáticamente cada lunes. Datos de <a href="${BASE}/app" style="color:#EF9F27">virtualmechanic.es</a>.</p>
    </div>
  `;
}

async function main() {
  const adminPwd = process.env.ADMIN_PASSWORD;
  const resendKey = process.env.RESEND_API_KEY;
  if (!adminPwd) throw new Error('Falta ADMIN_PASSWORD');
  if (!resendKey) throw new Error('Falta RESEND_API_KEY');

  console.log('Pidiendo estadísticas a /api/admin...');
  const res = await fetch(`${BASE}/api/admin`, { headers: { 'x-admin-password': adminPwd } });
  if (!res.ok) throw new Error(`/api/admin respondió HTTP ${res.status}`);
  const datos = await res.json();

  if (!datos.week || !datos.week.desde) throw new Error('La respuesta de /api/admin no incluye datos semanales (¿Redis no configurado?)');

  console.log(`Semana ${datos.week.desde} → ${datos.week.hasta}: ${datos.week.total} consultas, ${datos.week.activeUsers} usuarios activos`);

  const html = construirHtml(datos);

  console.log('Enviando email vía Resend...');
  const envio = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: REMITENTE,
      to: [DESTINATARIO],
      subject: `Informe semanal Virtual Mechanic — ${formatoFecha(datos.week.desde)} a ${formatoFecha(datos.week.hasta)}`,
      html,
    }),
  });

  const cuerpoRespuesta = await envio.text();
  if (!envio.ok) {
    throw new Error(`Resend respondió HTTP ${envio.status}: ${cuerpoRespuesta}`);
  }
  console.log('Email enviado correctamente:', cuerpoRespuesta);
}

main().catch(e => {
  console.error('Error generando/enviando el informe semanal:', e.message);
  process.exit(1);
});
