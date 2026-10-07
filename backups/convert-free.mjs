// Convierte el CV de flujo (main/aside) a diseño libre (marcos absolutos + estilos de texto).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [input, output] = process.argv.slice(2);
const src = fs.readFileSync(input, 'utf8');

const TEXT_STYLES = `
  :root {
    /* Nombre */
    --nombre-font: "Roboto Mono", monospace;
    --nombre-size: 21pt;
    --nombre-weight: 700;
    --nombre-style: normal;
    --nombre-case: none;
    --nombre-spacing: 1px;
    --nombre-leading: 1.2;
    --nombre-color: #222222;
    --nombre-before: 0pt;
    --nombre-after: 0pt;
    /* Subtítulo */
    --cargo-font: "Roboto", sans-serif;
    --cargo-size: 15.75pt;
    --cargo-weight: 400;
    --cargo-style: normal;
    --cargo-case: none;
    --cargo-spacing: 0.5px;
    --cargo-leading: 1.2;
    --cargo-color: #222222;
    --cargo-before: 3pt;
    --cargo-after: 0pt;
    /* Título de sección */
    --seccion-font: "Roboto Mono", monospace;
    --seccion-size: 9.75pt;
    --seccion-weight: 700;
    --seccion-style: normal;
    --seccion-case: uppercase;
    --seccion-spacing: 1px;
    --seccion-leading: 1.28;
    --seccion-color: #222222;
    --seccion-before: 12pt;
    --seccion-after: 5.25pt;
    /* Encabezado */
    --subtitulo-font: "Roboto", sans-serif;
    --subtitulo-size: 7.875pt;
    --subtitulo-weight: 700;
    --subtitulo-style: normal;
    --subtitulo-case: none;
    --subtitulo-spacing: 0px;
    --subtitulo-leading: 1.28;
    --subtitulo-color: #222222;
    --subtitulo-before: 6.75pt;
    --subtitulo-after: 2.25pt;
    /* Cuerpo */
    --cuerpo-font: "Tinos", serif;
    --cuerpo-size: 8.25pt;
    --cuerpo-weight: 400;
    --cuerpo-style: normal;
    --cuerpo-case: none;
    --cuerpo-spacing: 0px;
    --cuerpo-leading: 1.28;
    --cuerpo-color: #222222;
    --cuerpo-before: 0pt;
    --cuerpo-after: 4.5pt;
    /* Detalle */
    --detalle-font: "Roboto", sans-serif;
    --detalle-size: 7.5pt;
    --detalle-weight: 400;
    --detalle-style: normal;
    --detalle-case: none;
    --detalle-spacing: 0px;
    --detalle-leading: 1.45;
    --detalle-color: #222222;
    --detalle-before: 0pt;
    --detalle-after: 0pt;
    /* Nota */
    --nota-font: "Roboto", sans-serif;
    --nota-size: 7.875pt;
    --nota-weight: 400;
    --nota-style: normal;
    --nota-case: none;
    --nota-spacing: 0px;
    --nota-leading: 1.28;
    --nota-color: #999999;
    --nota-before: 0pt;
    --nota-after: 0pt;
  }
`;

const t = (id) => `font-family: var(--${id}-font); font-size: var(--${id}-size); font-weight: var(--${id}-weight);
    font-style: var(--${id}-style); text-transform: var(--${id}-case); letter-spacing: var(--${id}-spacing);
    line-height: var(--${id}-leading); color: var(--${id}-color);`;
const m = (id) => `margin: var(--${id}-before) 0 var(--${id}-after);`;

const LAYOUT = `
  :root { --rule: #b5b5b5; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #d9d9d9; }
  a { color: inherit; text-decoration: none; }

  /* Hoja A4 y elementos con posición libre (left/top/width en cada elemento) */
  .page {
    position: relative; width: 210mm; height: 297mm; margin: 24px auto;
    background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.15);
  }
  .frame, .shape { position: absolute; }
  .frame > :first-child, .frame > .item:first-child > :first-child { margin-top: 0; }
  .frame > :nth-last-child(1 of :not([data-cv-editor])),
  .item > :nth-last-child(1 of :not([data-cv-editor])) { margin-bottom: 0; }

  /* Estilos de texto (los valores están en #cv-text-styles) */
  h1 { ${t('nombre')} ${m('nombre')} }
  .role { ${t('cargo')} ${m('cargo')} }
  h2 { ${t('seccion')} ${m('seccion')}
    padding-bottom: 4px; border-bottom: 1px solid var(--rule);
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h3, .job-head { ${t('subtitulo')} ${m('subtitulo')} }
  .job-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; font-weight: 400; }
  .job-head strong { font-weight: var(--subtitulo-weight); }
  h3 .plain { font-weight: 400; }
  p, li { ${t('cuerpo')} }
  p { ${m('cuerpo')} }
  .detail, .where, h2 .meta { ${t('detalle')} }
  .detail { ${m('detalle')} }
  h2 .meta { font-weight: 700; }
  h2 .meta span { font-weight: 400; }
  .note { ${t('nota')} }

  ul { margin: 3px 0 5px; padding-left: 18px; }
  li { margin: 0 0 1.5px; }
  .italic li { font-style: italic; }
  .email { font-weight: 700; }
  .langs p { margin: 0; }

  @media print {
    @page { size: A4; margin: 0; }
    body { background: #fff; }
    .page { margin: 0; box-shadow: none; overflow: hidden; }
    .shape { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1000, height: 1200 });
await p.setContent(src, { waitUntil: 'load' });

const parts = await p.evaluate(() => {
  const clean = (el) => el.outerHTML.replace(/^<section(\s|>)/, '<section class="frame"$1').replace('<section class="frame" class="', '<section class="frame ');
  return {
    title: document.title,
    fontsHref: document.querySelector('link[href*="fonts.googleapis.com/css2"]').href,
    h1: document.querySelector('header.top h1').outerHTML,
    role: document.querySelector('header.top .role').outerHTML,
    contact: [...document.querySelectorAll('.contact > div')].map((d) =>
      `<p class="detail${d.classList.contains('email') ? ' email' : ''}">${d.innerHTML}</p>`),
    main: [...document.querySelectorAll('main > section')].map(clean),
    aside: [...document.querySelectorAll('aside > section')].map(clean),
  };
});

const ind = (s, n) => s.split('\n').map((l) => ' '.repeat(n) + l.trim()).join('\n');
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${parts.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link id="cv-fonts" href="${parts.fontsHref}" rel="stylesheet">
<style id="cv-text-styles">${TEXT_STYLES}</style>
<style>${LAYOUT}</style>
</head>
<body>
<div class="page">
  <!-- Formas de fondo -->
  <div class="shape" data-role="lateral" style="left: 584px; top: 0px; width: 210px; height: 1123px; background: #efefef;"></div>
  <div class="shape" data-role="linea" style="left: 0px; top: 0px; width: 794px; height: 3px; background: #555555;"></div>

  <!-- Cabecera -->
  <div class="frame" data-role="cabecera" style="left: 40px; top: 28px; width: 516px;">
    ${parts.h1}
    ${parts.role}
  </div>
  <div class="frame contact" data-role="contacto" style="left: 606px; top: 34px; width: 166px;">
${parts.contact.map((c) => '    ' + c).join('\n')}
  </div>

  <!-- Columna principal -->
${parts.main.map((s) => ind(s.replace(/<section class="frame([^"]*)"/, '<section class="frame$1" data-col="main" style="left: 40px; top: 0px; width: 516px;"'), 2)).join('\n\n')}

  <!-- Columna lateral -->
${parts.aside.map((s) => ind(s.replace(/<section class="frame([^"]*)"/, '<section class="frame$1" data-col="aside" style="left: 606px; top: 0px; width: 166px;"'), 2)).join('\n\n')}
</div>
</body>
</html>
`;

// Apilar en Chrome con las alturas reales
await p.setViewport({ width: 900, height: 1200 });
await p.setContent(html, { waitUntil: 'load' });
await p.evaluateHandle('document.fonts.ready');
const result = await p.evaluate(() => {
  const bottom = (el) => el.offsetTop + el.offsetHeight;
  const head = document.querySelector('[data-role=cabecera]');
  const contact = document.querySelector('[data-role=contacto]');
  const lineY = Math.round(Math.max(bottom(head), bottom(contact)) + 18);
  document.querySelector('[data-role=linea]').style.top = lineY + 'px';
  const out = {};
  for (const col of ['main', 'aside']) {
    let y = lineY + 3 + 16;
    for (const f of document.querySelectorAll(`[data-col=${col}]`)) {
      f.style.top = y + 'px';
      y = bottom(f) + 16;
    }
    out[col] = y - 16;
  }
  document.querySelectorAll('[data-col]').forEach((f) => f.removeAttribute('data-col'));
  return { lineY, ...out, html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML + '\n' };
});
fs.writeFileSync(output, result.html);
console.log({ lineY: result.lineY, mainBottom: result.main, asideBottom: result.aside, pageHeight: 1123 });
await b.close();
