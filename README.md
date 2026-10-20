# English grammar games

Página de práctica de inglés con 4 juegos: **Hangman**, **Match the Ideas**, **Fill & Drag** y **Question Cards**.
Una pantalla inicial permite elegir el **tema gramatical** (presente continuo, pasado perfecto, modales…) y el **tema de vocabulario** (vegetales, IT…), y la IA (Gemini) genera los ejercicios.
Las actividades por defecto practican *would like / ask / tell + (not) to*.

```
english_activity/
├── index.html                          ← la página
├── netlify.toml                        ← configuración de Netlify
├── netlify/edge-functions/generate.js  ← servidor de IA en Netlify (guarda la API key y llama a Gemini)
├── worker/                             ← alternativa: el mismo servidor para Cloudflare Workers
├── .nojekyll                           ← para GitHub Pages
└── .gitignore
```

> La API key de Gemini **nunca** se sube a este repositorio. Solo vive en Netlify (o Cloudflare) como variable secreta.

---

## Publicar en Netlify (página + IA en el mismo sitio)

### 1. Subir el código a GitHub

```bash
git add .
git commit -m "Netlify edge function for AI generation"
git push
```

### 2. Crear el sitio en Netlify

1. Entra a https://app.netlify.com y elige **Sign up / Log in with GitHub**.
2. Pulsa **Add new project** (o **Add new site**) y luego **Import an existing project**.
3. Elige **GitHub** y autoriza a Netlify. Selecciona el repositorio **english_activity**.
4. En la configuración del build:
   - **Branch to deploy:** `main`
   - **Build command:** déjalo vacío
   - **Publish directory:** `.` (Netlify lo toma de `netlify.toml`)
5. Pulsa **Deploy**. En un minuto te da una dirección como `https://nombre-al-azar.netlify.app`.

### 3. Agregar la API key

1. En tu proyecto de Netlify, entra a **Project configuration** (o **Site configuration**) → **Environment variables** → **Add a variable**.
2. Crea `GEMINI_API_KEY` con tu key como valor. Marca **Contains secret values** si aparece la opción, y deja que aplique a todos los *scopes* (o al menos a **Functions**).
3. Crea `GEMINI_MODEL` con el valor `gemini-3.5-flash-lite`.
4. Las variables solo se aplican en un deploy nuevo. Ve a **Deploys** → **Trigger deploy** → **Deploy project** (o **Deploy site**).

### 4. Probar

1. Abre `https://TU-SITIO.netlify.app/api/generate` en el navegador. Si ves `{"error":"Use POST."}`, el servidor de IA funciona.
2. Abre `https://TU-SITIO.netlify.app`, elige gramática y vocabulario, y pulsa **Generate activities**.

**Opcional:** para cambiar el nombre al azar por uno fijo, ve a **Project configuration → General → Change project name** (por ejemplo `english-activity-rick`). La dirección quedará `https://english-activity-rick.netlify.app`.

Cada `git push` vuelve a publicar todo solo.

---

## Si algo falla

| Mensaje en la página | Causa probable |
|---|---|
| "The AI server was not found…" | Abriste la página desde GitHub Pages o desde tu computador. Usa la dirección de Netlify |
| "The AI server has no GEMINI_API_KEY yet…" | Falta la variable, o no hiciste un deploy nuevo después de crearla |
| "Gemini rejected the request…" | La key o el modelo no son válidos. Revisa `GEMINI_MODEL` y crea una key en https://aistudio.google.com/apikey |
| "The free Gemini quota is used up" | Se alcanzó el límite gratuito. Hay que esperar un minuto |

Los errores de Gemini también aparecen en Netlify: **Logs → Edge Functions**.

---

## GitHub Pages y Cloudflare (opcional)

- **GitHub Pages** (`https://rickdslayer.github.io/english_activity/`) sigue funcionando con las actividades por defecto. La generación con IA solo funciona en la dirección de Netlify.
- **Cloudflare Worker:** la carpeta `worker/` tiene el mismo servidor para Cloudflare. Para usarlo en lugar de Netlify, pega su URL completa en `API_URL` dentro de `index.html`. En Cloudflare necesita las variables `GEMINI_API_KEY` (Secret), `GEMINI_MODEL` y `ALLOWED_ORIGINS` (la dirección de la página).

**Seguridad:** como la key se compartió en un chat, cuando todo funcione crea una nueva en AI Studio, borra la anterior y guarda la nueva solo en Netlify.
