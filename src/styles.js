// Estilos de texto globales (como los estilos de párrafo de InDesign o Word).
// Los valores viven en el propio CV, en <style id="cv-text-styles"> como variables CSS
// (--<estilo>-<propiedad>); las reglas del CV las usan. Cambiar una variable cambia
// todo el texto con ese estilo.

export const TEXT_STYLES = [
  { id: 'nombre', label: 'Nombre', match: 'h1', tag: 'h1' },
  { id: 'cargo', label: 'Subtítulo', match: '.role', tag: 'p', cls: 'role' },
  { id: 'seccion', label: 'Título de sección', match: 'h2', tag: 'h2' },
  { id: 'subtitulo', label: 'Encabezado', match: 'h3, .job-head', tag: 'h3' },
  { id: 'cuerpo', label: 'Cuerpo', match: 'p, li', tag: 'p' },
  { id: 'detalle', label: 'Detalle', match: '.detail, .where, .meta', tag: 'p', cls: 'detail' },
  { id: 'nota', label: 'Nota', match: '.note', inline: true },
];
// Orden de detección: el más específico primero (p.role y p.detail también son <p>).
const DETECT_ORDER = ['nota', 'detalle', 'cargo', 'nombre', 'seccion', 'subtitulo', 'cuerpo'];

export const PROPS = ['font', 'size', 'weight', 'style', 'case', 'spacing', 'leading', 'color', 'before', 'after'];

export const FONTS = [
  { name: 'Roboto', stack: '"Roboto", sans-serif', weights: [400, 500, 700], ital: true },
  { name: 'Roboto Mono', stack: '"Roboto Mono", monospace', weights: [400, 500, 700], ital: true },
  { name: 'Tinos', stack: '"Tinos", serif', weights: [400, 700], ital: true },
  { name: 'Inter', stack: '"Inter", sans-serif', weights: [400, 500, 700], ital: false },
  { name: 'IBM Plex Sans', stack: '"IBM Plex Sans", sans-serif', weights: [400, 500, 700], ital: true },
  { name: 'IBM Plex Mono', stack: '"IBM Plex Mono", monospace', weights: [400, 500, 700], ital: true },
  { name: 'Lato', stack: '"Lato", sans-serif', weights: [400, 700], ital: true },
  { name: 'Montserrat', stack: '"Montserrat", sans-serif', weights: [400, 500, 700], ital: true },
  { name: 'Source Serif 4', stack: '"Source Serif 4", serif', weights: [400, 500, 700], ital: true },
  { name: 'Merriweather', stack: '"Merriweather", serif', weights: [400, 700], ital: true },
  { name: 'Playfair Display', stack: '"Playfair Display", serif', weights: [400, 500, 700], ital: true },
  { name: 'EB Garamond', stack: '"EB Garamond", serif', weights: [400, 500, 700], ital: true },
  { name: 'Space Mono', stack: '"Space Mono", monospace', weights: [400, 700], ital: true },
];

const familyOf = (stack) => (stack.match(/^\s*["']?([^"',]+)/)?.[1] ?? '').trim();
export const fontByStack = (stack) => FONTS.find((f) => f.name === familyOf(stack));

export function styleSheetEl(d) {
  return d?.getElementById('cv-text-styles') ?? null;
}

/** Lee { estilo: { propiedad: valor } } del documento. */
export function readStyles(d) {
  const el = styleSheetEl(d);
  if (!el?.sheet) return null;
  const rule = [...el.sheet.cssRules].find((r) => r.selectorText === ':root');
  if (!rule) return null;
  const values = {};
  for (const s of TEXT_STYLES) {
    values[s.id] = {};
    for (const p of PROPS) values[s.id][p] = rule.style.getPropertyValue(`--${s.id}-${p}`).trim();
  }
  return values;
}

/** Reescribe el bloque de variables (legible, para que también se pueda editar a mano). */
export function writeStyles(d, values) {
  const el = styleSheetEl(d);
  if (!el) return;
  const lines = ['', '  :root {'];
  for (const s of TEXT_STYLES) {
    lines.push(`    /* ${s.label} */`);
    for (const p of PROPS) lines.push(`    --${s.id}-${p}: ${values[s.id][p]};`);
  }
  lines.push('  }', '');
  el.textContent = lines.join('\n');
  updateFontsLink(d, values);
}

/** Ajusta el <link> de Google Fonts para cargar las familias que se usan. */
export function updateFontsLink(d, values) {
  const link = d.getElementById('cv-fonts');
  if (!link) return;
  const used = new Map();
  for (const s of TEXT_STYLES) {
    const f = fontByStack(values[s.id].font);
    if (f) used.set(f.name, f);
  }
  const families = [...used.values()].sort((a, b) => a.name.localeCompare(b.name)).map((f) => {
    const name = f.name.replace(/ /g, '+');
    if (!f.ital) return `family=${name}:wght@${f.weights.join(';')}`;
    const tuples = [...f.weights.map((w) => `0,${w}`), ...f.weights.map((w) => `1,${w}`)];
    return `family=${name}:ital,wght@${tuples.join(';')}`;
  });
  const href = `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/** Estilo del texto donde está el cursor. */
export function detectStyle(node) {
  let el = node?.nodeType === 1 ? node : node?.parentElement;
  while (el && !el.matches('.frame, body')) {
    for (const id of DETECT_ORDER) {
      if (el.matches(TEXT_STYLES.find((s) => s.id === id).match)) return id;
    }
    el = el.parentElement;
  }
  return null;
}

const BLOCKS = 'h1, h2, h3, p, li, .job-head';

/**
 * Aplica un estilo a los párrafos seleccionados (o al del cursor).
 * Devuelve un mensaje si no se pudo aplicar.
 */
export function applyStyle(d, id) {
  const style = TEXT_STYLES.find((s) => s.id === id);
  const sel = d.getSelection();
  if (!sel?.rangeCount) return 'Pon el cursor en un texto para aplicarle el estilo.';
  const range = sel.getRangeAt(0);

  if (style.inline) {
    const note = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('.note');
    if (note) {
      note.replaceWith(...note.childNodes);
      return null;
    }
    if (range.collapsed) return 'Selecciona el texto al que quieres aplicar «Nota».';
    const span = d.createElement('span');
    span.className = 'note';
    span.append(range.extractContents());
    range.insertNode(span);
    sel.selectAllChildren(span);
    return null;
  }

  const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  let blocks = [...d.querySelectorAll(BLOCKS)].filter((b) => b.closest('.frame') && range.intersectsNode(b));
  if (!blocks.length) {
    const b = start?.closest(BLOCKS);
    if (b?.closest('.frame')) blocks = [b];
  }
  // Un bloque dentro de otro (p. ej. un <p> en un <li>) se trata con su contenedor.
  blocks = blocks.filter((b) => !blocks.some((o) => o !== b && o.contains(b)));
  if (!blocks.length) return 'Pon el cursor en un texto para aplicarle el estilo.';

  let skipped = 0;
  let last = null;
  for (const b of blocks) {
    if (b.matches('li')) {
      if (id !== 'cuerpo') skipped++;
      continue;
    }
    const n = d.createElement(style.tag);
    if (style.cls) n.className = style.cls;
    n.innerHTML = b.innerHTML;
    b.replaceWith(n);
    last = n;
  }
  if (last) {
    const r = d.createRange();
    r.selectNodeContents(last);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  return skipped ? 'Las viñetas siempre usan el estilo Cuerpo.' : null;
}
