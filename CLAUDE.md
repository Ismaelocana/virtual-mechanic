# Virtual Mechanic

Asistente mecánico con IA especializado en motos de enduro, motocross y trial. El usuario selecciona su moto paso a paso (marca → categoría → tipo de motor → modelo → año) y accede a un chat que usa manuales oficiales indexados en Pinecone + Claude para dar diagnósticos precisos.

## Stack

- **Frontend**: HTML + CSS + JS vanilla, todo en `index.html`. Diseño móvil fijo (375px).
- **Backend producción**: Vercel Serverless (`api/`)
- **Backend local**: Express en `server.js` (puerto 3000)
- **IA**: Anthropic Claude (`claude-sonnet-4-6`), vía `@anthropic-ai/sdk`. Soporta visión (análisis de fotos).
- **Auth**: Clerk (magic link passwordless). Dominio: `clerk.virtualmechanic.es`. Publishable key hardcodeada en `index.html`.
- **RAG**: Voyage AI (embeddings `voyage-3`) + Pinecone (índice `virtual-mechanic`). Filtra por `brand`, `model`, `year`.
- **Almacenamiento**: Upstash Redis (historial de chats, garaje, analytics).
- **Manuales**: Archivos `.txt` locales en `manuales/`, indexados en Pinecone por chunks. 614 archivos de 7 marcas.

## Estructura del proyecto

```
index.html          → Frontend completo (UI + lógica de navegación + llamada a API)
api/chat.js         → POST /api/chat — RAG + Claude (producción en Vercel)
api/history.js      → GET/POST/DELETE /api/history — historial de chats por usuario (Redis)
api/garage.js       → GET/POST/DELETE /api/garage — garaje de motos por usuario (Redis)
api/admin.js        → Endpoint de administración
server.js           → Servidor Express local equivalente
pdf-a-texto.js      → Utilidad: convierte PDF a .txt (uso: node pdf-a-texto.js <in.pdf> <out.txt>)
vercel.json         → Config de despliegue (static + serverless)
manifest.json       → PWA manifest
sw.js               → Service worker para PWA
icons/              → Iconos de la app
manuales/           → Manuales en .txt organizados por marca/modelo-año
  beta/             → 111 archivos
  gasgas/           → 70 archivos
  husqvarna/        → 145 archivos
  ktm/              → 218 archivos
  rieju/            → 7 archivos
  sherco/           → 60 archivos
  triumph/          → 3 archivos
```

## Flujo de la aplicación

```
index.html → Clerk verifica sesión → home
           → usuario elige marca / categoría / tipo motor / modelo / año
           → POST /api/chat { messages, brand, model, year, [imageBase64, imageMediaType] }
           → api/chat.js genera embedding con Voyage AI
           → consulta Pinecone filtrando por brand+model+year → top 15 chunks
           → construye system prompt con fragmentos del manual (o sin manual si no hay chunks)
           → llama a Claude Sonnet 4.6 (con visión si hay imagen)
           → devuelve { reply: "..." }
           → index.html muestra la respuesta en el chat
           → POST /api/history guarda el chat en Redis
```

## Auth (Clerk)

- Magic link (passwordless). El usuario introduce su email y recibe un enlace.
- Flujo: sign-in si el usuario existe, sign-up automático si es nuevo.
- `CLERK_ENABLED = true` en `index.html`. Si se pone a `false`, la app salta directamente al home sin auth.
- Al hacer login se guarda `window.currentUserId` = Clerk user ID, usado para historial y garaje.
- `signOut()` limpia la sesión y vuelve a la pantalla de login.

## RAG (Voyage AI + Pinecone)

- `buscarContexto(brand, model, year, query)` en `api/chat.js`:
  1. Genera embedding del último mensaje del usuario con Voyage AI (`voyage-3`).
  2. Llama a Pinecone con `topK: 15` y filtros `{ brand, model, year }`.
  3. Concatena los chunks devueltos y los inyecta en el system prompt.
- `normalizarModelo(brand, model)` mapea los nombres de modelo de la UI a los valores del filtro de Pinecone (necesario porque un PDF puede cubrir varios modelos, ej. `rr125-200-250-300` cubre RR 125, RR 200, RR 250 y RR 300).
- Si faltan `VOYAGE_API_KEY` o `PINECONE_API_KEY`, el RAG se omite y Claude responde sin manual.
- Timeout de 5 s en las llamadas externas (`fetchWithTimeout`).

## Manuales

- Ruta local: `manuales/{marca}/{modelo}-{año}.txt`
- Nomenclatura: marca en minúsculas, modelo con guiones entre componentes y sin espacios.
  - Ejemplos: `ktm/exc125-200-250-300-2015.txt`, `husqvarna/te250-300-2022.txt`, `beta/rr350-390-430-480-2024.txt`
- Los archivos están indexados en Pinecone; **no se descargan en runtime** (la arquitectura antigua de GitHub raw ya no está en uso).
- Para añadir un manual: convertir PDF con `pdf-a-texto.js`, guardar en la ruta correcta, indexar en Pinecone, y actualizar `normalizarModelo()` si es necesario.

## Almacenamiento Redis (Upstash)

- **Historial**: `vm:history:{userId}` (lista de chatIds) + `vm:chat:{userId}:{chatId}` (JSON del chat)
- **Garaje**: `vm:garage:{userId}` (lista JSON de motos)
- **Analytics** (en `logConsulta`): `vm:total`, `vm:day:{fecha}`, `vm:brands`, `vm:manual` / `vm:general`, `vm:recent`

## Variables de entorno

```
ANTHROPIC_API_KEY=...           → requerida, para Claude
PINECONE_API_KEY=...            → para RAG (sin ella, no hay contexto de manual)
VOYAGE_API_KEY=...              → para embeddings RAG (sin ella, no hay RAG)
UPSTASH_REDIS_REST_URL=...      → para historial, garaje y analytics
UPSTASH_REDIS_REST_TOKEN=...    → para historial, garaje y analytics
```

En Vercel las variables se configuran en el dashboard del proyecto.

## Marcas y modelos disponibles (hardcodeados en `brandsData` en `index.html`)

| Marca     | Categorías                    | 2T                                                                                                      | 4T                                                              |
|-----------|-------------------------------|---------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| KTM       | Enduro, Motocross             | EXC 125/150/200/250/300, SX 65/85/125/150/250/300                                                      | EXC-F 250/350/450/500, SX-F 250/350/450                        |
| Husqvarna | Enduro, Motocross             | TE 125/150/250/300, TC 65/85/125/250                                                                    | FE 250/350/450/501, FC 250/350/450                             |
| Sherco    | Enduro, Trial                 | SE 125/250/300, ST 125/250/300                                                                          | SEF 250/300/450/500                                            |
| GasGas    | Enduro, Motocross, Trial      | EC 250/300, MC 65/85/125/250                                                                            | EC 250F/350F/450F/500F, MC 250F/350F/450F, TXT 125/250/280/300 |
| Beta      | Enduro, Motocross, Trial      | RR 125/200/250/300, Xtrainer 250/300, RX 250/300/350, EVO 80/125/200/250/300/300 SS, Sincro 125/200/250/300/300 SS | RR 350/390/430/480, RX 450, EVO 250/300             |
| Rieju     | Enduro                        | MR 200/250/300                                                                                          | —                                                               |
| Triumph   | Enduro, Motocross             | —                                                                                                       | TF 250-E/450-E (Enduro), TF 250-X/450-X/450 RC Edition (MX)   |

## Funcionalidades del frontend

- **Selección de moto**: 5 pasos (marca → categoría → tipo motor → modelo → año). Pasos intermedios se saltan automáticamente si solo hay una opción.
- **Chat**: historial de mensajes con markdown renderizado (negrita, listas, tablas, títulos, código inline, separadores).
- **Foto**: el usuario puede enviar una imagen. Se redimensiona a máx 1024px con canvas, se convierte a base64 JPEG (calidad 0.85) y se envía a la API. Claude la analiza con visión.
- **Mi garaje**: el usuario guarda motos para acceder directamente al chat sin pasar por la selección.
- **Historial**: lista de chats anteriores por usuario, cargables y eliminables.
- **PWA**: `manifest.json` + `sw.js` + botón "Instalar app" (aparece solo si el navegador soporta `beforeinstallprompt`).

## Despliegue

- **Producción**: Vercel. Push a `master` → deploy automático.
- URL producción: `https://virtual-mechanic.vercel.app`
- `vercel.json` sirve `index.html` como estático y `api/*.js` como funciones serverless.
- El frontend apunta siempre a Vercel (`const SERVER = 'https://virtual-mechanic.vercel.app/api'`). Para desarrollo local hay que cambiar esa constante.

## Desarrollo local

```bash
node server.js        # arranca en localhost:3000
```

## Decisiones de diseño relevantes

- Los datos de marcas/modelos están hardcodeados en `brandsData` en `index.html`. Para añadir un modelo, editar ese objeto y añadir la lógica de años en `selectModel()`.
- Los rangos de años disponibles por modelo están hardcodeados en la función `selectModel()`.
- `normalizarModelo()` en `api/chat.js` debe actualizarse cuando se añaden modelos nuevos, para que el filtro de Pinecone funcione correctamente.
- El upload de fotos es funcional y envía la imagen a Claude vía base64. El historial de mensajes no guarda el contenido visual, solo `[Foto enviada para diagnóstico]`.
- Pinecone usa filtro exacto por año (tipo string). Al indexar chunks, el campo `year` debe ser string.
