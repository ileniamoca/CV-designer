import { createBlocks, BLOCKS_CSS } from './blocks.js';
import { createCanvas, CANVAS_CSS } from './canvas.js';
import {
  TEXT_STYLES, FONTS, fontByStack, styleSheetEl, readStyles, writeStyles, detectStyle, applyStyle,
} from './styles.js';
import TEMPLATE from '../plantillas/en-blanco.html?raw';

const $ = (sel) => document.querySelector(sel);
const iframe = $('#editor');
const EDITOR_ATTR = 'data-cv-editor'; // marca lo que inyecta el editor; nunca se guarda

const state = {
  current: null, // { kind, name }
  savedHtml: '',
  dirty: false,
  zoom: 1,
  chrome: false,
  docs: { originales: [], copias: [] }, // última lista recibida (para «Nuevo CV»)
  ownWrites: new Map(), // "kind/name" → timestamp de nuestro último guardado
  confirmedOriginals: new Set(),
};

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || `Error ${res.status}`);
  return body;
}
const docUrl = (kind, name) => `/api/docs/${kind}/${encodeURIComponent(name)}`;
const stem = (name) => name.replace(/\.(html|pdf)$/i, '');

// ---------- Lista lateral ----------
async function refreshList() {
  const data = await api('/api/docs');
  state.chrome = data.chrome;
  state.docs = data;
  $('#empty').textContent = data.originales.length || data.copias.length
    ? 'Elige un CV a la izquierda para empezar a editar.'
    : 'Aún no hay CVs. Pulsa «+ Nuevo CV» para crear el primero.';
  for (const kind of ['originales', 'copias', 'pdf']) {
    const ul = $(`#list-${kind}`);
    ul.replaceChildren();
    if (!data[kind].length) {
      ul.append(Object.assign(document.createElement('li'), { className: 'none', textContent: 'Vacío' }));
      continue;
    }
    for (const f of data[kind]) ul.append(renderItem(kind, f));
  }
}

function renderItem(kind, f) {
  const li = document.createElement('li');
  li.title = f.name;
  if (state.current?.kind === kind && state.current?.name === f.name) li.classList.add('current');
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = stem(f.name);
  const date = document.createElement('span');
  date.className = 'date';
  date.textContent = new Date(f.mtime).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
  label.append(date);
  li.append(label);

  if (kind === 'pdf') {
    li.addEventListener('click', () => window.open(`/files/pdf/${encodeURIComponent(f.name)}`, '_blank'));
  } else {
    li.addEventListener('click', () => openDoc(kind, f.name));
  }
  if (kind !== 'originales') {
    const del = document.createElement('button');
    del.className = 'mini del';
    del.textContent = '✕';
    del.title = 'Eliminar';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar "${f.name}"? No se puede deshacer.`)) return;
      await api(docUrl(kind, f.name), { method: 'DELETE' });
      if (state.current?.kind === kind && state.current?.name === f.name) closeDoc();
      refreshList();
    });
    li.append(del);
  }
  return li;
}

// ---------- Documento ----------
function doc() {
  return iframe.contentDocument;
}

function afterChange() {
  blocks.ensureControls();
  canvas.ensureControls();
  canvas.checkLayout();
  setDirty(serialize() !== state.savedHtml);
  updateWordCount();
  updateInspector(canvas.getSelected());
}

const blocks = createBlocks({
  doc,
  attr: EDITOR_ATTR,
  getState: () => {
    const d = doc();
    return {
      body: d.body.innerHTML,
      styles: styleSheetEl(d)?.textContent,
      fonts: d.getElementById('cv-fonts')?.getAttribute('href'),
    };
  },
  setState: (st) => {
    const d = doc();
    canvas.select(null);
    d.body.innerHTML = st.body;
    const css = styleSheetEl(d);
    if (css && st.styles != null) css.textContent = st.styles;
    if (st.fonts) d.getElementById('cv-fonts')?.setAttribute('href', st.fonts);
    renderStyles();
  },
  onChange: afterChange,
  toast: (msg) => toast(msg),
});

const canvas = createCanvas({
  doc,
  attr: EDITOR_ATTR,
  history: blocks,
  snapEnabled: () => $('#snapToggle').checked,
  pushEnabled: () => $('#pushToggle').checked,
  onSelect: (el) => updateInspector(el),
  onLayout: (r) => updateLayoutStatus(r),
  toast: (msg) => toast(msg),
});

function serialize() {
  const clone = doc().documentElement.cloneNode(true);
  clone.querySelectorAll(`[${EDITOR_ATTR}]`).forEach((n) => n.remove());
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  clone.querySelectorAll('[class*="cv-"]').forEach((n) => {
    [...n.classList].forEach((c) => c.startsWith('cv-') && n.classList.remove(c));
  });
  clone.querySelectorAll('[class=""]').forEach((n) => n.removeAttribute('class'));
  return '<!DOCTYPE html>\n' + clone.outerHTML + '\n';
}

async function openDoc(kind, name, { force = false, keepScroll = false } = {}) {
  if (!force && state.dirty && !confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
  try {
    const html = await api(docUrl(kind, name));
    const scrollY = keepScroll ? iframe.contentWindow?.scrollY ?? 0 : 0;
    state.current = { kind, name };
    try { localStorage.setItem('cv-editor:last', JSON.stringify(state.current)); } catch {}
    await loadIntoIframe(html);
    iframe.contentWindow.scrollTo(0, scrollY);
    state.savedHtml = serialize();
    setDirty(false);
    $('#banner').hidden = true;
    updateChrome();
    refreshList();
  } catch (err) {
    toast(err.message, true);
  }
}

function closeDoc() {
  state.current = null;
  state.dirty = false;
  iframe.hidden = true;
  $('#empty').hidden = false;
  updateChrome();
}

function loadIntoIframe(html) {
  return new Promise((resolve) => {
    iframe.onload = () => {
      setupEditing();
      resolve();
    };
    iframe.hidden = false;
    $('#empty').hidden = true;
    iframe.srcdoc = html;
  });
}

function setupEditing() {
  const d = doc();
  const style = d.createElement('style');
  style.setAttribute(EDITOR_ATTR, '');
  d.head.append(style);
  applyZoom();
  // contentEditable (no designMode) para que los controles de bloque no sean editables.
  d.body.contentEditable = 'true';
  try { d.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
  blocks.attach();
  canvas.attach();
  renderStyles();
  updateInspector(null);
  // Recalcular páginas/avisos cuando cambie la altura (texto, bloques movidos, fuentes cargadas…).
  new d.defaultView.ResizeObserver(() => updatePages()).observe(d.querySelector('.page') ?? d.body);
  d.fonts?.ready.then(() => {
    canvas.enablePush();
    canvas.checkLayout();
  });

  let t;
  d.addEventListener('input', (e) => {
    if (e.isTrusted) blocks.textEdited();
    clearTimeout(t);
    t = setTimeout(() => {
      blocks.ensureControls();
      canvas.ensureControls();
      setDirty(serialize() !== state.savedHtml);
    }, 150);
    updateWordCount();
  });
  d.addEventListener('keydown', handleShortcuts);
  d.addEventListener('selectionchange', () => {
    updateToolbarState();
    markActiveStyle();
  });
  // Triple clic: como en Word, seleccionar solo el párrafo (el navegador se extiende al bloque
  // siguiente y al escribir encima fusiona ambos, rompiendo el diseño).
  d.addEventListener('click', (e) => {
    if (e.detail !== 3) return;
    const block = e.target.closest?.('p, li, h1, h2, h3, h4, h5, h6, td, th, div, span.meta');
    if (!block) return;
    const range = d.createRange();
    range.selectNodeContents(block);
    const sel = d.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  // En modo edición los enlaces no navegan; ⌘+clic los abre.
  d.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (a && (e.metaKey || e.ctrlKey)) window.open(a.href, '_blank');
  });
  updateWordCount();
}

function applyZoom() {
  const style = doc()?.querySelector(`style[${EDITOR_ATTR}]`);
  if (style) {
    style.textContent = BLOCKS_CSS + CANVAS_CSS + `
      html { zoom: ${state.zoom}; }
      @media print { html { zoom: 1 !important; } }
      a { cursor: text; }
      .page { position: relative; }
      .cv-pagebreak {
        position: absolute; left: -12px; right: -12px; height: 0; z-index: 6; pointer-events: none;
        border-top: 2px dashed #d93025;
      }
      .cv-pagebreak::after {
        content: attr(data-label); position: absolute; right: 12px; top: 2px;
        font: 600 10px/1.6 -apple-system, sans-serif; color: #fff; background: #d93025;
        padding: 0 6px; border-radius: 0 0 4px 4px;
      }
      @media print { .cv-pagebreak { display: none !important; } }`;
  }
  $('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
}

function setDirty(dirty) {
  state.dirty = dirty;
  updateChrome();
}

function updateChrome() {
  const has = Boolean(state.current);
  $('#btnSave').disabled = !has || !state.dirty;
  $('#btnSaveCopy').disabled = !has;
  $('#btnPdf').disabled = !has;
  $('#btnPrint').disabled = !has;
  const label = has
    ? `${stem(state.current.name)} — ${state.current.kind === 'originales' ? 'Original' : 'Copia'}`
    : 'Ningún documento abierto';
  $('#docName').textContent = label + (state.dirty ? ' •' : '');
  $('#status').textContent = has ? (state.dirty ? 'Cambios sin guardar' : 'Guardado') : '';
  $('#pathInfo').textContent = has ? `CVs/documentos/${state.current.kind}/${state.current.name}` : '';
  document.title = has ? `${state.dirty ? '• ' : ''}${stem(state.current.name)} · Editor de CVs` : 'Editor de CVs';
}

function updateWordCount() {
  const text = doc()?.body?.innerText ?? '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  $('#wordCount').textContent = `${words} palabras`;
  updatePages();
}

// ---------- Páginas A4 ----------
const A4_HEIGHT_PX = (297 / 25.4) * 96;

/** Cuenta las hojas A4 que ocupa el CV y dibuja una marca donde acaba cada una. */
function updatePages() {
  const d = doc();
  const page = d?.querySelector('.page') ?? d?.body;
  if (!page) return;
  if (page.querySelector(':scope > .frame')) return canvas.checkLayout(); // diseño libre: hoja fija
  const pages = Math.max(1, Math.ceil(page.offsetHeight / A4_HEIGHT_PX - 0.01));
  const marks = [...page.querySelectorAll(':scope > .cv-pagebreak')];
  for (let i = marks.length; i < pages - 1; i++) {
    const m = d.createElement('div');
    m.setAttribute(EDITOR_ATTR, '');
    m.setAttribute('contenteditable', 'false');
    m.className = 'cv-pagebreak';
    page.append(m);
    marks.push(m);
  }
  marks.forEach((m, i) => {
    if (i >= pages - 1) return m.remove();
    m.style.top = `${(i + 1) * 297}mm`;
    m.dataset.label = `Fin de la página ${i + 1} · empieza la página ${i + 2}`;
  });
  const el = $('#pageCount');
  el.textContent = pages === 1 ? '1 página A4' : `⚠ ${pages} páginas A4: el contenido no cabe en una hoja`;
  el.classList.toggle('warn', pages > 1);
}

// ---------- Guardar ----------
function markOwnWrite(kind, name) {
  state.ownWrites.set(`${kind}/${name}`, Date.now());
}

async function save() {
  if (!state.current || !state.dirty) return;
  const { kind, name } = state.current;
  if (kind === 'originales' && !state.confirmedOriginals.has(name)) {
    const ok = confirm(
      'Vas a sobrescribir el ORIGINAL.\n\n¿Seguro? (Si prefieres conservarlo, usa "Guardar como copia…")',
    );
    if (!ok) return;
    state.confirmedOriginals.add(name);
  }
  const html = serialize();
  try {
    markOwnWrite(kind, name);
    await api(docUrl(kind, name), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    });
    state.savedHtml = html;
    setDirty(false);
    toast('Guardado');
    refreshList();
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveCopy() {
  if (!state.current) return;
  const today = new Date().toISOString().slice(0, 10);
  const base = stem(state.current.name).replace(/ - \d{4}-\d{2}-\d{2}( \(\d+\))?$/, '');
  const name = await askName('Guardar como copia', `${base} - ${today}`);
  if (!name) return;
  const html = serialize();
  try {
    const res = await api('/api/copies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, html }),
    });
    markOwnWrite('copias', res.name);
    state.current = { kind: 'copias', name: res.name };
    try { localStorage.setItem('cv-editor:last', JSON.stringify(state.current)); } catch {}
    state.savedHtml = html;
    setDirty(false);
    toast(`Copia guardada: ${res.name}`);
    refreshList();
  } catch (err) {
    toast(err.message, true);
  }
}

async function exportPdf() {
  if (!state.current) return;
  if (!state.chrome) {
    toast('No encontré Chrome para generar el PDF; usa "Guardar como PDF" en el diálogo de impresión.');
    return printDoc();
  }
  const name = await askName('Exportar PDF', stem(state.current.name), 'Exportar');
  if (!name) return;
  const btn = $('#btnPdf');
  btn.disabled = true;
  btn.textContent = 'Generando…';
  try {
    const res = await api('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, html: serialize() }),
    });
    toast(`PDF creado: <a href="${res.url}" target="_blank">${res.name}</a>`, false, true);
    refreshList();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.textContent = 'Exportar PDF';
    updateChrome();
  }
}

function printDoc() {
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
}

// ---------- CV nuevo ----------
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Crea un CV desde la plantilla en blanco (en Originales) o duplicando otro (en Copias) y lo abre. */
async function newCv() {
  const choice = await askNew();
  if (!choice) return;
  if (state.dirty && !confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
  const { name, source } = choice;
  try {
    const html = source
      ? await api(docUrl(source.kind, source.name))
      : TEMPLATE.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(stem(name))}</title>`);
    const res = await api('/api/copies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, html, kind: source ? 'copias' : 'originales' }),
    });
    markOwnWrite(res.kind, res.name);
    if (res.kind === 'originales') state.confirmedOriginals.add(res.name); // es suyo: guardar sin avisar
    await openDoc(res.kind, res.name, { force: true });
    toast(`CV creado: ${res.name}`);
  } catch (err) {
    toast(err.message, true);
  }
}

function askNew() {
  const dlg = $('#newDialog');
  const input = $('#newName');
  const select = $('#newFrom');
  const sources = [
    null,
    ...['originales', 'copias'].flatMap((kind) => (state.docs[kind] ?? []).map((f) => ({ kind, name: f.name }))),
  ];
  select.innerHTML = '<option value="0">Plantilla en blanco</option>' +
    ['originales', 'copias'].map((kind) => {
      const opts = sources
        .map((src, i) => (src?.kind === kind ? `<option value="${i}">${escapeHtml(stem(src.name))}</option>` : ''))
        .join('');
      return opts && `<optgroup label="${kind === 'originales' ? 'Originales' : 'Copias'}">${opts}</optgroup>`;
    }).join('');
  const today = new Date().toISOString().slice(0, 10);
  const suggest = (src) => (src ? `${stem(src.name).replace(/ - \d{4}-\d{2}-\d{2}( \(\d+\))?$/, '')} - ${today}` : 'CV nuevo');
  let suggested = suggest(null);
  const update = () => {
    const src = sources[select.value];
    $('#newHint').textContent = src
      ? `Se guardará en Copias como duplicado de «${stem(src.name)}».`
      : 'Se guardará en Originales: hoja A4 de dos columnas con texto de ejemplo para reemplazar.';
    if (input.value === suggested) input.value = suggested = suggest(src); // solo si no lo ha cambiado
  };
  select.onchange = update;
  input.value = suggested;
  update();
  dlg.returnValue = '';
  dlg.showModal();
  input.select();
  return new Promise((resolve) => {
    dlg.addEventListener(
      'close',
      () => resolve(dlg.returnValue === 'ok' && input.value.trim()
        ? { name: input.value.trim(), source: sources[select.value] }
        : null),
      { once: true },
    );
  });
}

// ---------- Diálogo de nombre ----------
function askName(title, value, okLabel = 'Guardar') {
  const dlg = $('#nameDialog');
  $('#nameDialogTitle').textContent = title;
  dlg.querySelector('button.primary').textContent = okLabel;
  const input = $('#nameInput');
  input.value = value;
  dlg.returnValue = ''; // si se cierra con Esc no queda el «ok» de la vez anterior
  dlg.showModal();
  input.select();
  return new Promise((resolve) => {
    dlg.addEventListener(
      'close',
      () => resolve(dlg.returnValue === 'ok' ? input.value.trim() : null),
      { once: true },
    );
  });
}

// ---------- Formato ----------
function exec(cmd, value = null) {
  const d = doc();
  if (!d) return;
  iframe.contentWindow.focus();
  if (cmd === 'undo' && blocks.undo()) return;
  if (cmd === 'redo' && blocks.redo()) return;
  blocks.textEdited();
  d.execCommand('styleWithCSS', false, !['bold', 'italic', 'underline'].includes(cmd));
  d.execCommand(cmd, false, value);
  d.dispatchEvent(new Event('input'));
  updateToolbarState();
}

function updateToolbarState() {
  const d = doc();
  if (!d) return;
  document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => {
    try { b.classList.toggle('active', d.queryCommandState(b.dataset.cmd)); } catch {}
  });
}

function insertLink() {
  const sel = doc()?.getSelection();
  const current = sel?.anchorNode?.parentElement?.closest('a')?.getAttribute('href') ?? 'https://';
  const url = prompt('Dirección del enlace (https://…, mailto:…, tel:…)', current);
  if (url) exec('createLink', url);
}

function handleShortcuts(e) {
  const inField = e.target?.matches?.('input, select, textarea');
  if (!inField && canvas.onKeyDown(e)) {
    e.preventDefault();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && (e.shiftKey ? blocks.redo() : blocks.undo())) {
    e.preventDefault();
  } else if (k === 'y' && blocks.redo()) {
    e.preventDefault();
  } else if (k === 's') {
    e.preventDefault();
    e.shiftKey ? saveCopy() : save();
  } else if (k === 'p') {
    e.preventDefault();
    printDoc();
  } else if (k === 'k') {
    e.preventDefault();
    insertLink();
  } else if (k === '=' || k === '+') {
    e.preventDefault();
    setZoom(state.zoom + 0.1);
  } else if (k === '-') {
    e.preventDefault();
    setZoom(state.zoom - 0.1);
  }
}

function setZoom(z) {
  state.zoom = Math.min(2, Math.max(0.5, Math.round(z * 10) / 10));
  applyZoom();
}

// ---------- Inspector: disposición ----------
function updateLayoutStatus({ outside, overlaps }) {
  const el = $('#pageCount');
  const msgs = [];
  if (outside) msgs.push(`${outside} marco${outside > 1 ? 's' : ''} fuera de la hoja`);
  if (overlaps) msgs.push(`${overlaps} marcos se solapan`);
  el.textContent = msgs.length ? `⚠ ${msgs.join(' · ')}` : '1 página A4 · sin solapamientos';
  el.classList.toggle('warn', msgs.length > 0);
  $('#btnResolve').classList.toggle('attention', overlaps > 0);
}

const toHex = (c) => {
  const m = String(c).match(/\d+(\.\d+)?/g);
  if (!m || c.startsWith('#')) return c?.startsWith('#') ? c : '#000000';
  return '#' + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('');
};

function updateInspector(el) {
  const has = Boolean(el?.isConnected);
  $('#selPanel').hidden = !has;
  $('#selHint').hidden = has;
  if (!has) return;
  const isShape = el.classList.contains('shape');
  const heading = el.querySelector('h1, h2, h3, p')?.textContent.trim().slice(0, 28);
  $('#selTitle').textContent = isShape ? 'Forma' : `Marco de texto${heading ? ` · ${heading}` : ''}`;
  $('#geoX').value = el.offsetLeft;
  $('#geoY').value = el.offsetTop;
  $('#geoW').value = el.offsetWidth;
  $('#geoH').value = el.offsetHeight;
  $('#geoH').disabled = !isShape;
  $('#geoH').title = isShape ? '' : 'El alto de un marco de texto lo marca su contenido';
  $('#colorRow').hidden = !isShape;
  if (isShape) $('#shapeColor').value = toHex(doc().defaultView.getComputedStyle(el).backgroundColor);
}

for (const [id, prop] of [['#geoX', 'left'], ['#geoY', 'top'], ['#geoW', 'width'], ['#geoH', 'height']]) {
  $(id).addEventListener('change', (e) => canvas.setGeometry({ [prop]: parseFloat(e.target.value) }));
}
$('#shapeColor').addEventListener('change', (e) => canvas.setColor(e.target.value));
document.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => canvas.align(b.dataset.align)));
document.querySelectorAll('[data-arrange]').forEach((b) => b.addEventListener('click', () => canvas.arrange(b.dataset.arrange)));
document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => doc() && canvas.add(b.dataset.add)));
$('#btnResolve').addEventListener('click', () => doc() && canvas.resolveOverlaps());

// ---------- Inspector: estilos de texto ----------
const WEIGHT_NAMES = { 400: 'Regular', 500: 'Medium', 700: 'Bold' };
const num = (v) => parseFloat(v) || 0;
let styleValues = null;
let styleEditing = false;

function previewCss(v) {
  const size = Math.min(17, Math.max(11, num(v.size) * 1.45));
  return `font-family:${v.font};font-weight:${v.weight};font-style:${v.style};` +
    `text-transform:${v.case};color:${v.color};font-size:${size}px;letter-spacing:${v.spacing}`;
}

function ensureFontsLoaded() {
  // Cargar en el editor todas las fuentes del catálogo para las previsualizaciones.
  if (document.getElementById('ui-fonts')) return;
  const link = document.createElement('link');
  link.id = 'ui-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?' +
    FONTS.map((f) => `family=${f.name.replace(/ /g, '+')}:wght@${f.weights.join(';')}`).join('&') + '&display=swap';
  document.head.append(link);
}

function renderStyles() {
  const list = $('#stylesList');
  styleValues = readStyles(doc());
  list.replaceChildren();
  if (!styleValues) {
    list.innerHTML = '<p class="hint">Este documento no tiene estilos de texto definidos.</p>';
    return;
  }
  ensureFontsLoaded();
  for (const s of TEXT_STYLES) list.append(styleRow(s));
  markActiveStyle();
}

function styleRow(s) {
  const v = styleValues[s.id];
  const row = document.createElement('div');
  row.className = 'style-row';
  row.dataset.id = s.id;

  const apply = document.createElement('button');
  apply.className = 'style-apply';
  apply.title = s.inline ? 'Aplicar a la selección (o quitar)' : 'Aplicar al párrafo';
  apply.innerHTML = `<span class="preview"></span><span class="meta"></span>`;
  apply.addEventListener('mousedown', (e) => e.preventDefault()); // conservar la selección del CV
  apply.addEventListener('click', () => {
    blocks.snapshot();
    const msg = applyStyle(doc(), s.id);
    blocks.committed();
    if (msg) toast(msg);
    markActiveStyle();
  });

  const edit = document.createElement('button');
  edit.className = 'style-edit';
  edit.title = 'Editar el estilo en todo el documento';
  edit.textContent = '✎';
  edit.addEventListener('click', () => {
    form.hidden = !form.hidden;
    edit.classList.toggle('active', !form.hidden);
  });

  const form = document.createElement('div');
  form.className = 'style-form';
  form.hidden = true;
  const font = fontByStack(v.font);
  const fontOptions = FONTS.map((f) => `<option value='${f.stack}'>${f.name}</option>`).join('') +
    (font ? '' : `<option value='${v.font}'>${v.font}</option>`);
  const weights = (font?.weights ?? [400, 700]).map((w) => `<option value="${w}">${WEIGHT_NAMES[w] ?? w}</option>`).join('');
  form.innerHTML = `
    <label class="wide">Fuente <select data-p="font">${fontOptions}</select></label>
    <label>Tamaño <span class="unit"><input type="number" data-p="size" step="0.25" min="4"> pt</span></label>
    <label>Peso <select data-p="weight">${weights}</select></label>
    <label>Interlineado <input type="number" data-p="leading" step="0.05" min="0.8"></label>
    <label>Espaciado <span class="unit"><input type="number" data-p="spacing" step="0.1"> px</span></label>
    <label>Antes <span class="unit"><input type="number" data-p="before" step="0.25" min="0"> pt</span></label>
    <label>Después <span class="unit"><input type="number" data-p="after" step="0.25" min="0"> pt</span></label>
    <label>Color <input type="color" data-p="color"></label>
    <label class="check"><input type="checkbox" data-p="style"> Cursiva</label>
    <label class="check"><input type="checkbox" data-p="case"> MAYÚSCULAS</label>`;
  const fields = Object.fromEntries([...form.querySelectorAll('[data-p]')].map((f) => [f.dataset.p, f]));
  fields.font.value = v.font;
  fields.size.value = num(v.size);
  fields.weight.value = v.weight;
  fields.leading.value = num(v.leading);
  fields.spacing.value = num(v.spacing);
  fields.before.value = num(v.before);
  fields.after.value = num(v.after);
  fields.color.value = toHex(v.color);
  fields.style.checked = v.style === 'italic';
  fields.case.checked = v.case === 'uppercase';

  const read = {
    font: (f) => f.value,
    size: (f) => `${num(f.value)}pt`,
    weight: (f) => f.value,
    leading: (f) => `${num(f.value)}`,
    spacing: (f) => `${num(f.value)}px`,
    before: (f) => `${num(f.value)}pt`,
    after: (f) => `${num(f.value)}pt`,
    color: (f) => f.value,
    style: (f) => (f.checked ? 'italic' : 'normal'),
    case: (f) => (f.checked ? 'uppercase' : 'none'),
  };
  form.addEventListener('input', (e) => {
    const p = e.target.dataset.p;
    if (!p) return;
    if (!styleEditing) {
      blocks.snapshot();
      styleEditing = true;
    }
    styleValues[s.id][p] = read[p](e.target);
    if (p === 'font') {
      // Ajustar los pesos disponibles a la nueva fuente.
      const f = fontByStack(e.target.value);
      const ws = f?.weights ?? [400, 700];
      fields.weight.innerHTML = ws.map((w) => `<option value="${w}">${WEIGHT_NAMES[w] ?? w}</option>`).join('');
      const cur = Number(styleValues[s.id].weight);
      const best = ws.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
      fields.weight.value = best;
      styleValues[s.id].weight = String(best);
    }
    writeStyles(doc(), styleValues);
    paintRow(row, s);
    setDirty(serialize() !== state.savedHtml);
  });
  form.addEventListener('change', () => {
    if (!styleEditing) return;
    styleEditing = false;
    blocks.committed();
  });

  row.append(apply, edit, form);
  paintRow(row, s);
  return row;
}

function paintRow(row, s) {
  const v = styleValues[s.id];
  const preview = row.querySelector('.preview');
  preview.textContent = s.label;
  preview.style.cssText = previewCss(v);
  const font = fontByStack(v.font)?.name ?? v.font;
  row.querySelector('.meta').textContent = `${font} · ${num(v.size)} pt`;
}

function markActiveStyle() {
  const sel = doc()?.getSelection();
  const id = sel?.rangeCount ? detectStyle(sel.anchorNode) : null;
  document.querySelectorAll('.style-row').forEach((r) => r.classList.toggle('active', r.dataset.id === id));
}

// ---------- Avisos ----------
let toastTimer;
function toast(msg, error = false, html = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el[html ? 'innerHTML' : 'textContent'] = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), html ? 8000 : 3000);
}

// ---------- Cambios en disco (p. ej. ediciones hechas por Claude) ----------
function listenForChanges() {
  const es = new EventSource('/api/events');
  let listTimer;
  es.onmessage = (e) => {
    const { kind, name } = JSON.parse(e.data);
    clearTimeout(listTimer);
    listTimer = setTimeout(refreshList, 200);
    if (state.current?.kind !== kind || state.current?.name !== name) return;
    if (Date.now() - (state.ownWrites.get(`${kind}/${name}`) ?? 0) < 2000) return;
    if (state.dirty) {
      $('#banner').hidden = false;
    } else {
      openDoc(kind, name, { force: true, keepScroll: true }).then(() => toast('Documento actualizado desde disco'));
    }
  };
}

// ---------- Inicio ----------
document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => {
  b.addEventListener('mousedown', (e) => e.preventDefault()); // conservar la selección
  b.addEventListener('click', () => exec(b.dataset.cmd));
});
$('#sizeSelect').addEventListener('change', (e) => {
  if (e.target.value) exec('fontSize', e.target.value);
  e.target.value = '';
});
$('#foreColor').addEventListener('input', (e) => exec('foreColor', e.target.value));
$('#hiliteColor').addEventListener('input', (e) => exec('hiliteColor', e.target.value));
$('#btnLink').addEventListener('mousedown', (e) => e.preventDefault());
$('#btnLink').addEventListener('click', insertLink);
$('#zoomIn').addEventListener('click', () => setZoom(state.zoom + 0.1));
$('#zoomOut').addEventListener('click', () => setZoom(state.zoom - 0.1));

$('#btnNew').addEventListener('click', newCv);
$('#btnSave').addEventListener('click', save);
$('#btnSaveCopy').addEventListener('click', saveCopy);
$('#btnPdf').addEventListener('click', exportPdf);
$('#btnPrint').addEventListener('click', printDoc);
$('#bannerReload').addEventListener('click', () => openDoc(state.current.kind, state.current.name, { force: true, keepScroll: true }));
$('#bannerDismiss').addEventListener('click', () => ($('#banner').hidden = true));

document.addEventListener('keydown', handleShortcuts);
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

updateChrome();
listenForChanges();
refreshList().then(() => {
  let last = null;
  try { last = JSON.parse(localStorage.getItem('cv-editor:last')); } catch {}
  const lastItem = last && [...document.querySelectorAll(`#list-${last.kind} li`)].find((li) => li.title === last.name);
  (lastItem ?? document.querySelector('#list-originales li:not(.none)'))?.click();
});
