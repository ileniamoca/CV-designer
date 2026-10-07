// Converts a flow CV (main/aside) to the free-form layout (absolute frames + text styles).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [input, output] = process.argv.slice(2);
const src = fs.readFileSync(input, 'utf8');

const TEXT_STYLES = `
  :root {
    /* Name */
    --name-font: "Roboto Mono", monospace;
    --name-size: 21pt;
    --name-weight: 700;
    --name-style: normal;
    --name-case: none;
    --name-spacing: 1px;
    --name-leading: 1.2;
    --name-color: #222222;
    --name-before: 0pt;
    --name-after: 0pt;
    /* Subtitle */
    --role-font: "Roboto", sans-serif;
    --role-size: 15.75pt;
    --role-weight: 400;
    --role-style: normal;
    --role-case: none;
    --role-spacing: 0.5px;
    --role-leading: 1.2;
    --role-color: #222222;
    --role-before: 3pt;
    --role-after: 0pt;
    /* Section title */
    --section-font: "Roboto Mono", monospace;
    --section-size: 9.75pt;
    --section-weight: 700;
    --section-style: normal;
    --section-case: uppercase;
    --section-spacing: 1px;
    --section-leading: 1.28;
    --section-color: #222222;
    --section-before: 12pt;
    --section-after: 5.25pt;
    /* Heading */
    --subheading-font: "Roboto", sans-serif;
    --subheading-size: 7.875pt;
    --subheading-weight: 700;
    --subheading-style: normal;
    --subheading-case: none;
    --subheading-spacing: 0px;
    --subheading-leading: 1.28;
    --subheading-color: #222222;
    --subheading-before: 6.75pt;
    --subheading-after: 2.25pt;
    /* Body */
    --body-font: "Tinos", serif;
    --body-size: 8.25pt;
    --body-weight: 400;
    --body-style: normal;
    --body-case: none;
    --body-spacing: 0px;
    --body-leading: 1.28;
    --body-color: #222222;
    --body-before: 0pt;
    --body-after: 4.5pt;
    /* Detail */
    --detail-font: "Roboto", sans-serif;
    --detail-size: 7.5pt;
    --detail-weight: 400;
    --detail-style: normal;
    --detail-case: none;
    --detail-spacing: 0px;
    --detail-leading: 1.45;
    --detail-color: #222222;
    --detail-before: 0pt;
    --detail-after: 0pt;
    /* Note */
    --note-font: "Roboto", sans-serif;
    --note-size: 7.875pt;
    --note-weight: 400;
    --note-style: normal;
    --note-case: none;
    --note-spacing: 0px;
    --note-leading: 1.28;
    --note-color: #999999;
    --note-before: 0pt;
    --note-after: 0pt;
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

  /* A4 page and free-positioned elements (left/top/width on each element) */
  .page {
    position: relative; width: 210mm; height: 297mm; margin: 24px auto;
    background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.15);
  }
  .frame, .shape { position: absolute; }
  .frame > :first-child, .frame > .item:first-child > :first-child { margin-top: 0; }
  .frame > :nth-last-child(1 of :not([data-cv-editor])),
  .item > :nth-last-child(1 of :not([data-cv-editor])) { margin-bottom: 0; }

  /* Text styles (values live in #cv-text-styles) */
  h1 { ${t('name')} ${m('name')} }
  .role { ${t('role')} ${m('role')} }
  h2 { ${t('section')} ${m('section')}
    padding-bottom: 4px; border-bottom: 1px solid var(--rule);
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h3, .job-head { ${t('subheading')} ${m('subheading')} }
  .job-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; font-weight: 400; }
  .job-head strong { font-weight: var(--subheading-weight); }
  h3 .plain { font-weight: 400; }
  p, li { ${t('body')} }
  p { ${m('body')} }
  .detail, .where, h2 .meta { ${t('detail')} }
  .detail { ${m('detail')} }
  h2 .meta { font-weight: 700; }
  h2 .meta span { font-weight: 400; }
  .note { ${t('note')} }

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
  <!-- Background shapes -->
  <div class="shape" data-role="sidebar" style="left: 584px; top: 0px; width: 210px; height: 1123px; background: #efefef;"></div>
  <div class="shape" data-role="rule" style="left: 0px; top: 0px; width: 794px; height: 3px; background: #555555;"></div>

  <!-- Header -->
  <div class="frame" data-role="header" style="left: 40px; top: 28px; width: 516px;">
    ${parts.h1}
    ${parts.role}
  </div>
  <div class="frame contact" data-role="contact" style="left: 606px; top: 34px; width: 166px;">
${parts.contact.map((c) => '    ' + c).join('\n')}
  </div>

  <!-- Main column -->
${parts.main.map((s) => ind(s.replace(/<section class="frame([^"]*)"/, '<section class="frame$1" data-col="main" style="left: 40px; top: 0px; width: 516px;"'), 2)).join('\n\n')}

  <!-- Side column -->
${parts.aside.map((s) => ind(s.replace(/<section class="frame([^"]*)"/, '<section class="frame$1" data-col="aside" style="left: 606px; top: 0px; width: 166px;"'), 2)).join('\n\n')}
</div>
</body>
</html>
`;

// Stack the frames in Chrome using their real heights
await p.setViewport({ width: 900, height: 1200 });
await p.setContent(html, { waitUntil: 'load' });
await p.evaluateHandle('document.fonts.ready');
const result = await p.evaluate(() => {
  const bottom = (el) => el.offsetTop + el.offsetHeight;
  const head = document.querySelector('[data-role=header]');
  const contact = document.querySelector('[data-role=contact]');
  const lineY = Math.round(Math.max(bottom(head), bottom(contact)) + 18);
  document.querySelector('[data-role=rule]').style.top = lineY + 'px';
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
