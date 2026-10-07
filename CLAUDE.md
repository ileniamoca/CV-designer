# Editor de CVs

Herramienta local (Vite) para editar los currículums de Ilenia como si fuera Word, guardar copias y exportar PDF.

## Dónde están los documentos

- `documentos/originales/` — CVs originales (HTML autocontenido, estilos dentro de `<style>`). **Son la fuente de verdad.**
- `documentos/copias/` — copias guardadas desde la web ("Guardar como copia…").
- `documentos/pdf/` — PDFs exportados (A4, generados con Chrome vía puppeteer-core).

## Estructura en bloques (componentes)

El editor permite arrastrar, duplicar y eliminar bloques. Para que funcione, los CVs deben seguir esta estructura:

- **Sección** = cada `<section>` hijo directo de `<main>` (columna principal) o `<aside>` (columna lateral).
  Se puede mover entre columnas; su estilo lo pone la columna (`aside h3`, `aside p`…), no la sección.
- **Elemento** = cada `<div class="item">` dentro de una sección: un trabajo (`.job-head` + `ul`/`p`),
  un proyecto (`h3` + `ul`), un estudio, un grupo de skills, un idioma…
- Al añadir contenido nuevo, envuélvelo en `<div class="item">` dentro de su `<section>`.
- Al convertir un CV nuevo a HTML, sigue esta misma estructura (`main`/`aside` > `section` > `.item`).

## Formato A4

- `.page` mide 210 mm × 297 mm (mín.) también en pantalla: lo que se ve en el editor es lo que se imprime.
- Los CVs deben caber en **una sola hoja A4**. Tras editar, comprueba la altura (`.page` ≤ 1123 px a 96 dpi)
  o exporta el PDF y cuenta páginas. El editor marca en rojo los saltos de página y avisa en la barra inferior.

## Cuando Ilenia pida cambios en un CV

- Edita directamente el `.html` correspondiente con Edit. Conserva la estructura y las clases existentes
  (`.job-head`, `.where`, `.note`, `h2 .meta`, `aside`…) para no romper el diseño ni el A4 de impresión.
- Si pide una versión nueva (p. ej. adaptada a una oferta), crea un archivo nuevo en `documentos/copias/`
  partiendo del original, en vez de tocar el original.
- Si el editor está abierto, recarga solo el documento al detectar el cambio en disco (no hace falta avisar).
- Para generar el PDF desde terminal: `npm run pdf -- documentos/copias/<archivo>.html`
  (sale en `documentos/pdf/`).
- Contexto profesional de Ilenia para redactar contenido: `../ilenia/*.md`, `../career_summary_ilenia_1.md`,
  ofertas en `../jobs/`.

## Git

- Repositorio: https://github.com/ileniamoca/CV-designer.git (rama `main`).
- **Después de cada cambio sustancial, haz commit y push a `main`** (`git add … && git commit && git push origin main`),
  con un mensaje descriptivo. Los retoques triviales pueden agruparse en el siguiente commit.

## Código

- `server/cv-api.js` — plugin de Vite con la API local (`/api/docs`, `/api/copies`, `/api/pdf`, `/api/events` SSE).
- `server/pdf.js` — HTML → PDF con el Chrome/Brave instalado.
- `src/main.js` — editor: el CV se carga en un iframe con `body.contentEditable`; lo que inyecta el editor lleva
  `data-cv-editor` (y clases `cv-*`) y se elimina al guardar.
- `src/blocks.js` — bloques: controles, arrastrar entre columnas/secciones, duplicar, eliminar y deshacer estructural.
- Arrancar: `npm run dev` → http://localhost:5180
