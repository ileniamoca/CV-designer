# CV Designer

Local tool (Vite) to edit Ilenia's CVs as if in Word, save copies and export PDFs.

## Language

- **Everything in this repository is written in English**: code, comments, UI text, documentation and commit
  messages. Keep it that way when adding or changing anything (talking to Ilenia in Spanish is fine).

## Where the documents live

- `documents/originals/` — original CVs (self-contained HTML, styles inside `<style>`). **They are the source of truth.**
- `documents/copies/` — copies saved from the web app ("Save as copy…").
- `documents/pdf/` — exported PDFs (A4, generated with Chrome via puppeteer-core).

## CV structure: free-form layout (frames, shapes and styles)

CVs use an InDesign/Canva-style free-form layout on a fixed A4 page (`.page`, 210 × 297 mm = 794 × 1123 px):

- **Frame** = `.page > .frame` (usually `<section class="frame">`) with an inline absolute position:
  `style="left: 40px; top: 129px; width: 516px;"`. Its height comes from its content. Main column: x 40, width 516;
  side column: x 606, width 166; standard spacing between frames: 16 px.
- **Shape** = `.page > .shape` with `left/top/width/height/background` (grey side stripe, header rule…).
  Shapes come before the frames in the HTML (so they sit behind them).
- **Item** = `<div class="item">` inside a frame: a job (`.job-head` + `ul`/`p`), a project
  (`h3` + `ul`), a degree, a group of skills, a language… When adding content, wrap it in an `.item`.
- **Text styles** = variables in `<style id="cv-text-styles">` (`--<style>-font|size|weight|style|case|spacing|leading|color|before|after`).
  Styles: `name` (h1), `role` (.role), `section` (h2), `subheading` (h3, .job-head), `body` (p, li),
  `detail` (.detail, .where, .meta) and `note` (.note). To change the typography of the whole document, change
  these variables, not the rules. Fonts are loaded with `<link id="cv-fonts">` (the editor regenerates it).
- To convert an old flow CV (`main`/`aside`) to this format: `node backups/convert-free.mjs <input> <output>`.

## A4 format

- Every CV must fit on **a single A4 page**: no frame may go past `top + height > 1123 px` or overlap another.
  After editing text, reposition the frames below (or export the PDF and check it). The editor's status bar
  warns about frames outside the page or overlapping.

## When Ilenia asks for changes to a CV

- Edit the corresponding `.html` directly with Edit. Keep the existing structure and classes
  (`.frame`, `.item`, `.job-head`, `.where`, `.note`, `h2 .meta`…) so the design and A4 print layout don't break.
- If she asks for a new version (e.g. tailored to a job offer), create a new file in `documents/copies/`
  based on the original, instead of touching the original.
- If the editor is open, it reloads the document by itself when it detects the change on disk (no need to say so).
- To generate the PDF from the terminal: `npm run pdf -- documents/copies/<file>.html`
  (output goes to `documents/pdf/`).
- Ilenia's professional background for writing content: `../ilenia/*.md`, `../career_summary_ilenia_1.md`,
  job offers in `../jobs/`.

## Personal data

- Ilenia's personal data (email, phone, etc.) is in `ilenia.md`, which is in `.gitignore`.
  **The repo is public:** never copy that data into `CLAUDE.md` or any other file that gets pushed.

## Git

- Repository: https://github.com/ileniamoca/CV-designer.git (branch `main`).
- **After every substantial change, commit and push to `main`** (`git add … && git commit && git push origin main`)
  with a descriptive message. Trivial tweaks can be grouped into the next commit.

## Code

- `server/cv-api.js` — Vite plugin with the local API (`/api/docs`, `/api/copies`, `/api/pdf`, `/api/events` SSE).
- `server/pdf.js` — HTML → PDF with the installed Chrome/Brave.
- `src/main.js` — editor: the CV is loaded in an iframe with `body.contentEditable`; whatever the editor injects
  carries `data-cv-editor` (and `cv-*` classes) and is removed on save.
- `src/canvas.js` — free-form layout: select/move/resize frames and shapes, snapping with guides, keyboard,
  pushing frames down as text grows, overlap warnings, alignment, adding elements.
- `src/blocks.js` — items (.item): drag between frames or into a new frame, duplicate, delete; plus the
  shared undo history (body + styles).
- `src/styles.js` — text styles: read/write the variables, apply a style to a paragraph, font catalog.
- Start: `npm run dev` → http://localhost:5180
