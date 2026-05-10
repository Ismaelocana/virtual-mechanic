# Virtual Mechanic

Asistente mecánico con IA especializado en motos de enduro y offroad. El usuario selecciona su moto paso a paso (marca → categoría → tipo de motor → modelo → año) y accede a un chat que usa manuales oficiales en texto + Claude para dar diagnósticos precisos.

## Stack

- **Frontend**: HTML + CSS + JS vanilla, todo en `index.html`. Diseño móvil fijo (375px).
- **Backend producción**: Vercel Serverless (`api/chat.js`)
- **Backend local**: Express en `server.js` (puerto 3000)
- **IA**: Anthropic Claude (`claude-sonnet-4-5`), vía `@anthropic-ai/sdk`
- **Manuales**: Archivos `.txt` extraídos de PDFs, alojados en este repo y descargados en runtime desde GitHub raw

## Estructura del proyecto

```
index.html          → Frontend completo (UI + lógica de navegación + llamada a API)
api/chat.js         → Endpoint serverless POST /api/chat (producción en Vercel)
server.js           → Servidor Express local equivalente
pdf-a-texto.js      → Utilidad: convierte PDF a .txt (uso: node pdf-a-texto.js <in.pdf> <out.txt>)
vercel.json         → Config de despliegue (static + serverless)
manuales/           → Manuales en .txt organizados por marca/modelo-año
  husqvarna/
    te250-2020.txt
    te250-2024.txt
    te300-2020.txt
    te300-2024.txt
    te125-2026.txt
    te125-2026.pdf  → PDF original (no subir si es grande)
  (resto de carpetas vacías por ahora: ktm, beta, gasgas, sherco, etc.)
```

## Flujo de la aplicación

```
index.html → usuario elige marca / categoría / tipo motor / modelo / año
           → POST https://virtual-mechanic.vercel.app/api/chat
           → api/chat.js descarga el manual desde GitHub raw (si existe)
           → construye system prompt con el manual
           → llama a Claude Sonnet 4.5
           → devuelve { reply: "..." }
           → index.html muestra la respuesta en el chat
```

## Manuales

- Ruta en repo: `manuales/{marca}/{modelo-sin-espacios}-{año}.txt`
- La marca y modelo se normalizan a minúsculas con espacios reemplazados por guiones:
  - `Husqvarna` + `TE 250` + `2024` → `manuales/husqvarna/te-250-2024.txt`
  - OJO: los archivos actuales usan formato sin guion entre letra y número (`te250-2020.txt`), revisar la función `cargarManual` en `api/chat.js` si hay inconsistencias
- Si no existe el manual, Claude responde sin él (degradación elegante)
- Para añadir un manual: convertir PDF con `pdf-a-texto.js`, guardar en la ruta correcta, subir a GitHub

## Variables de entorno (.env, no subir)

```
ANTHROPIC_API_KEY=...   → requerida, usada en api/chat.js y server.js
PINECONE_API_KEY=...    → configurada pero no usada actualmente
```

En Vercel las variables se configuran en el dashboard del proyecto.

## Marcas y modelos disponibles (hardcodeados en index.html)

| Marca     | Categorías              | 2T                                              | 4T                                      |
|-----------|-------------------------|-------------------------------------------------|-----------------------------------------|
| KTM       | Enduro, Motocross       | EXC 125/150/200/250/300, SX 50/65/85/125/150/250 | EXC-F 250/350/450/500, SX-F 250/350/450 |
| Husqvarna | Enduro, Motocross       | TE 125/150/250/300, TC 50/65/85/125/150/250/300 | FE 250/350/450/501, FC 250/350/450      |
| Sherco    | Enduro, Trial           | SE 125/250/300, ST 125/250/300                  | SEF 250/300/450/500                     |
| GasGas    | Enduro, Motocross, Trial| EC 125/250/300, MC 50/65/85/125/250/300, TXT Racing/GP | EC 250F/350F/450F/500F, MC 250F/350F/450F |
| Beta      | Enduro, Motocross, Trial| RR 125/200/250/300, Xtrainer 250/300, RX 125/200/250/300, EVO 125/200/250/300 | RR 350/390/430/480, RX 450, EVO 300 4T |

## Despliegue

- **Producción**: Vercel. Push a `master` → deploy automático.
- URL producción: `https://virtual-mechanic.vercel.app`
- `vercel.json` sirve `index.html` como estático y `api/chat.js` como función serverless.

## Desarrollo local

```bash
node server.js        # arranca en localhost:3000
```

El frontend en producción apunta siempre a Vercel (`SERVER = 'https://virtual-mechanic.vercel.app/api'`). Para desarrollo local hay que cambiar esa constante o usar el servidor local directamente.

## Decisiones de diseño relevantes

- Los datos de marcas/modelos están hardcodeados en `index.html` (sin base de datos). Para añadir un modelo, editar `brandsData` en el script.
- Los iconos de tipo de motor (2T / 4T) son texto en negrita dentro de un cuadrado (`cat-icon-wrap`), no SVGs.
- El upload de fotos en el chat es solo UI: no envía la imagen a la API, responde con un mensaje fijo pidiendo descripción textual.
- Pinecone está instalado pero no integrado en ningún endpoint activo.
