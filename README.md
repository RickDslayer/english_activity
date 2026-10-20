# Would like, ask & tell + to

Página de práctica de inglés con 4 juegos: **Hangman**, **Match the Ideas**, **Fill & Drag** y **Question Cards**. Trabaja *would like / ask / tell + (not) to + verb*. Una pantalla inicial permite elegir el tema gramatical (presente continuo, pasado perfecto, modales…) y el tema de vocabulario (vegetales, IT…), y la IA (Gemini) genera los ejercicios. Las actividades por defecto practican *would like / ask / tell + (not) to*.

- **Página (GitHub Pages):** https://rickdslayer.github.io/english_activity/
- **Servidor de IA:** Cloudflare Worker, en la carpeta `worker/`

```
english_activity/
├── index.html          ← la página (GitHub Pages la sirve desde la raíz)
├── .nojekyll           ← sirve el sitio tal cual, sin procesarlo con Jekyll
├── .gitignore
└── worker/
    ├── worker.js       ← servidor intermedio que guarda la API key y llama a Gemini
    └── wrangler.toml   ← configuración opcional para desplegar con Wrangler
```

> La API key de Gemini **nunca** se sube a este repositorio. Solo vive en Cloudflare, como Secret.

---

## 1. Subir el código a GitHub

Desde una terminal en esta carpeta:

```bash
git add .
git commit -m "Infinitives activity page with Gemini topic generator"
git push -u origin main
```

## 2. Activar GitHub Pages

1. En GitHub, entra a **RickDslayer/english_activity → Settings → Pages**.
2. En **Build and deployment**, elige **Source: Deploy from a branch**.
3. Elige **Branch: `main`**, carpeta **`/ (root)`**, y pulsa **Save**.
4. En uno o dos minutos la página estará en https://rickdslayer.github.io/english_activity/

Sin el paso 3 y el paso 4 la página ya funciona con las actividades por defecto. La generación por tema necesita el Worker.

## 3. Crear el Worker en Cloudflare (gratis)

1. Entra a https://dash.cloudflare.com, ve a **Workers & Pages → Create → Create Worker**, ponle el nombre `infinitives-ai` y pulsa **Deploy**.
2. Pulsa **Edit code**, pega el contenido de `worker/worker.js` y pulsa **Deploy**.
3. En **Settings → Variables and Secrets**, agrega:
   - `GEMINI_API_KEY`, de tipo **Secret**: tu API key de Gemini.
   - `ALLOWED_ORIGINS`, de tipo **Text**: `https://rickdslayer.github.io`
   - `GEMINI_MODEL`, de tipo **Text** (opcional): `gemini-2.5-flash`
4. Copia la dirección del Worker. Tiene esta forma: `https://infinitives-ai.TU-SUBDOMINIO.workers.dev`.

Si prefieres la terminal en lugar del panel web, también puedes desplegar así:

```bash
cd worker
npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY
```

## 4. Conectar la página con el Worker

En `index.html`, al inicio del `<script>`, cambia esta línea:

```js
const API_URL = 'https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev';
```

por la dirección del Worker. Luego sube el cambio:

```bash
git commit -am "Connect page to AI worker"
git push
```

---

## Si algo falla

| Mensaje en la página | Causa probable |
|---|---|
| "The page is not connected to the AI yet" | Falta cambiar `API_URL` (paso 4) |
| "This page is not allowed to use the AI server" | `ALLOWED_ORIGINS` no es `https://rickdslayer.github.io` |
| "Gemini rejected the request…" | La API key o el modelo no son válidos. Crea una key en https://aistudio.google.com/apikey |
| "The free Gemini quota is used up" | Se alcanzó el límite gratuito. Hay que esperar un minuto |
| "Could not reach the AI server" | `API_URL` mal escrita o sin internet |

**Seguridad:** como la key se compartió en un chat, cuando todo funcione crea una nueva en AI Studio, borra la anterior y guarda la nueva solo en Cloudflare.
