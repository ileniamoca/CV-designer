# Editor de CVs

Herramienta local (Vite) para editar los currículums de Ilenia como si fuera Word, guardar copias y exportar PDF.

## Dónde están los documentos

- `documentos/originales/` — CVs originales (HTML autocontenido, estilos dentro de `<style>`). **Son la fuente de verdad.**
- `documentos/copias/` — copias guardadas desde la web ("Guardar como copia…").
- `documentos/pdf/` — PDFs exportados (A4, generados con Chrome vía puppeteer-core).

## Estructura del CV: diseño libre (marcos, formas y estilos)

Los CVs usan un diseño libre tipo InDesign/Canva sobre una hoja A4 fija (`.page`, 210 × 297 mm = 794 × 1123 px):

- **Marco** = `.page > .frame` (normalmente `<section class="frame">`) con posición absoluta en línea:
  `style="left: 40px; top: 129px; width: 516px;"`. El alto lo da su contenido. Columna principal: x 40, ancho 516;
  columna lateral: x 606, ancho 166; separación estándar entre marcos: 16 px.
- **Forma** = `.page > .shape` con `left/top/width/height/background` (franja gris lateral, línea de cabecera…).
  Van antes que los marcos en el HTML (quedan detrás).
- **Elemento** = `<div class="item">` dentro de un marco: un trabajo (`.job-head` + `ul`/`p`), un proyecto
  (`h3` + `ul`), un estudio, un grupo de skills, un idioma… Al añadir contenido, envuélvelo en un `.item`.
- **Estilos de texto** = variables en `<style id="cv-text-styles">` (`--<estilo>-font|size|weight|style|case|spacing|leading|color|before|after`).
  Estilos: `nombre` (h1), `cargo` (.role), `seccion` (h2), `subtitulo` (h3, .job-head), `cuerpo` (p, li),
  `detalle` (.detail, .where, .meta) y `nota` (.note). Para cambiar la tipografía de todo el documento, cambia
  estas variables, no las reglas. Las fuentes se cargan con `<link id="cv-fonts">` (el editor lo regenera).
- Para convertir un CV antiguo de flujo (`main`/`aside`) a este formato: `node backups/convert-free.mjs <entrada> <salida>`.

## Formato A4

- Cada CV debe caber en **una sola hoja A4**: ningún marco debe pasar de `top + alto > 1123 px` ni solaparse con otro.
  Tras editar texto, recoloca los marcos de debajo (o exporta el PDF y revísalo). El editor avisa en la barra
  inferior de marcos fuera de la hoja o solapados.

## Cuando Ilenia pida cambios en un CV

- Edita directamente el `.html` correspondiente con Edit. Conserva la estructura y las clases existentes
  (`.frame`, `.item`, `.job-head`, `.where`, `.note`, `h2 .meta`…) para no romper el diseño ni el A4 de impresión.
- Si pide una versión nueva (p. ej. adaptada a una oferta), crea un archivo nuevo en `documentos/copias/`
  partiendo del original, en vez de tocar el original.
- Si el editor está abierto, recarga solo el documento al detectar el cambio en disco (no hace falta avisar).
- Para generar el PDF desde terminal: `npm run pdf -- documentos/copias/<archivo>.html`
  (sale en `documentos/pdf/`).
- Contexto profesional de Ilenia para redactar contenido: `../ilenia/*.md`, `../career_summary_ilenia_1.md`,
  ofertas en `../jobs/`.

## Datos personales

- Los datos personales de Ilenia (email, teléfono, etc.) están en `ilenia.md`, que está en `.gitignore`.
  **El repo es público:** nunca copies esos datos en `CLAUDE.md` ni en ningún archivo que se suba.

## Git

- Repositorio: https://github.com/ileniamoca/CV-designer.git (rama `main`).
- **Después de cada cambio sustancial, haz commit y push a `main`** (`git add … && git commit && git push origin main`),
  con un mensaje descriptivo. Los retoques triviales pueden agruparse en el siguiente commit.

## Código

- `server/cv-api.js` — plugin de Vite con la API local (`/api/docs`, `/api/copies`, `/api/pdf`, `/api/events` SSE).
- `server/pdf.js` — HTML → PDF con el Chrome/Brave instalado.
- `src/main.js` — editor: el CV se carga en un iframe con `body.contentEditable`; lo que inyecta el editor lleva
  `data-cv-editor` (y clases `cv-*`) y se elimina al guardar.
- `src/canvas.js` — diseño libre: seleccionar/mover/redimensionar marcos y formas, snap con guías, teclado,
  apartar marcos al crecer el texto, avisos de solapamiento, alinear, añadir elementos.
- `src/blocks.js` — elementos (.item): arrastrar entre marcos o a un marco nuevo, duplicar, eliminar; y el
  historial de deshacer compartido (cuerpo + estilos).
- `src/styles.js` — estilos de texto: leer/escribir las variables, aplicar estilo al párrafo, catálogo de fuentes.
- Arrancar: `npm run dev` → http://localhost:5180
