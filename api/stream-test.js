// Endpoint temporal SOLO para verificar si Vercel entrega res.write() de forma
// progresiva (streaming real) o en buffer (todo de golpe al terminar).
// Escribe 5 líneas con 1s de pausa entre cada una. Se borra tras la prueba.
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // por si hay algun proxy intermedio
  if (res.flushHeaders) res.flushHeaders();

  for (let i = 1; i <= 5; i++) {
    res.write(`chunk-${i}-${Date.now()}\n`);
    if (res.flush) res.flush();
    await new Promise(r => setTimeout(r, 1000));
  }
  res.end();
};
