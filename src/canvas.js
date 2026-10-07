// Diseño libre sobre la hoja A4 (al estilo InDesign/Canva).
//  - Marco (.frame): caja de texto con left/top/width; el alto lo da su contenido.
//  - Forma (.shape): rectángulo de color con left/top/width/height (fondos, líneas).
// Mover con el asa ✥ (o arrastrando la forma), redimensionar con los tiradores,
// snap suave a bordes/centros de la página y de otros elementos (⌥ lo desactiva).

const GAP = 16; // separación estándar entre secciones
const SNAP_PX = 6; // distancia de enganche, en píxeles de pantalla

export const CANVAS_CSS = `
  .page > .frame:hover, .page > .shape:hover { outline: 1px dashed rgba(43,87,151,.45); outline-offset: 2px; }
  .page > .shape { cursor: move; }
  .page > .cv-selected { outline: 1.5px solid #2b5797 !important; outline-offset: 2px; }
  .cv-ctl-frame { top: -32px; left: -3px; padding-bottom: 8px; }
  .page > .frame:hover > .cv-ctl-frame, .page > .shape:hover > .cv-ctl-frame,
  .page > .cv-selected > .cv-ctl-frame { display: flex; }
  .cv-h {
    position: absolute; z-index: 21; width: 10px; height: 10px; display: none;
    background: #fff; border: 1.5px solid #2b5797; border-radius: 2px; box-sizing: border-box;
  }
  .page > .cv-selected > .cv-h { display: block; }
  .cv-h[data-dir="e"] { right: -8px; top: calc(50% - 5px); cursor: ew-resize; }
  .cv-h[data-dir="w"] { left: -8px; top: calc(50% - 5px); cursor: ew-resize; }
  .cv-h[data-dir="n"] { top: -8px; left: calc(50% - 5px); cursor: ns-resize; }
  .cv-h[data-dir="s"] { bottom: -8px; left: calc(50% - 5px); cursor: ns-resize; }
  .cv-h[data-dir="ne"] { top: -8px; right: -8px; cursor: nesw-resize; }
  .cv-h[data-dir="nw"] { top: -8px; left: -8px; cursor: nwse-resize; }
  .cv-h[data-dir="se"] { bottom: -8px; right: -8px; cursor: nwse-resize; }
  .cv-h[data-dir="sw"] { bottom: -8px; left: -8px; cursor: nesw-resize; }
  .cv-guide { position: absolute; z-index: 40; pointer-events: none; background: #e8178a; }
  .cv-guide.v { width: 1px; top: 0; bottom: 0; }
  .cv-guide.h { height: 1px; left: 0; right: 0; }
  .cv-guide.gap { background: none; border-left: 1px dashed #e8178a; width: 0; }
  .cv-guide.gap::after {
    content: attr(data-label); position: absolute; left: 4px; top: 50%; transform: translateY(-50%);
    font: 600 10px/1.5 -apple-system, sans-serif; color: #fff; background: #e8178a; padding: 0 4px; border-radius: 3px;
  }
  .cv-badge {
    position: absolute; z-index: 41; pointer-events: none; white-space: nowrap;
    font: 600 10px/1.6 -apple-system, sans-serif; color: #fff; background: #2b5797; padding: 0 6px; border-radius: 3px;
  }
  .page > .cv-overlap { outline: 2px solid #f29900 !important; outline-offset: 2px; }
  .page > .cv-outside { outline: 2px solid #d93025 !important; outline-offset: 2px; }
  body.cv-moving, body.cv-moving * { user-select: none !important; }
  body.cv-moving .cv-ctl { display: none !important; }
  @media print { .cv-h, .cv-guide, .cv-badge { display: none !important; } .page > * { outline: none !important; } }
`;

/**
 * @param {object} o
 * @param {() => Document} o.doc
 * @param {string} o.attr
 * @param {{snapshot: () => void, committed: () => void}} o.history
 * @param {() => boolean} o.snapEnabled
 * @param {() => boolean} o.pushEnabled          al crecer un marco, desplazar los de debajo
 * @param {(el: Element|null) => void} o.onSelect   selección o geometría cambiada
 * @param {(r: {outside: number, overlaps: number}) => void} o.onLayout
 * @param {(msg: string) => void} o.toast
 */
export function createCanvas({ doc, attr, history, snapEnabled, pushEnabled, onSelect, onLayout, toast }) {
  let selected = null;
  let frameMode = false; // true: el marco está seleccionado como objeto (no editando su texto)
  let resizeObserver = null;
  let heights = new WeakMap(); // última altura conocida de cada marco
  let pushReady = false; // no empujar hasta que carguen las fuentes (cambian todas las alturas)

  const page = () => doc()?.querySelector('.page');
  const objects = () => [...(page()?.querySelectorAll(':scope > .frame, :scope > .shape') ?? [])];
  const frames = () => objects().filter((el) => el.classList.contains('frame'));
  const scale = () => {
    const p = page();
    return p ? p.getBoundingClientRect().width / p.offsetWidth || 1 : 1;
  };
  const geom = (el) => ({ l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });

  function editorEl(tag, cls) {
    const el = doc().createElement(tag);
    el.setAttribute(attr, '');
    el.setAttribute('contenteditable', 'false');
    el.className = cls;
    return el;
  }

  // ---------- Controles ----------
  function controls(isShape) {
    const box = editorEl('div', 'cv-ctl cv-ctl-frame');
    for (const [act, icon, title] of [
      ['move', '✥', isShape ? 'Mover forma' : 'Mover marco (⌥ para mover sin snap)'],
      ['dup', '⧉', 'Duplicar (⌘D)'],
      ['del', '✕', 'Eliminar (⌫ con el marco seleccionado)'],
    ]) {
      const b = doc().createElement('button');
      b.type = 'button';
      b.dataset.act = act;
      b.title = title;
      b.textContent = icon;
      box.append(b);
    }
    return box;
  }

  function ensureControls() {
    const p = page();
    if (!p) return;
    p.querySelectorAll('.cv-ctl-frame, .cv-h').forEach((c) => {
      if (!c.parentElement?.matches('.page > .frame, .page > .shape')) c.remove();
    });
    for (const el of objects()) {
      if (!el.querySelector(':scope > .cv-ctl-frame')) {
        const isShape = el.classList.contains('shape');
        el.append(controls(isShape));
        for (const dir of isShape ? ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] : ['e', 'w']) {
          const h = editorEl('div', 'cv-h');
          h.dataset.dir = dir;
          el.append(h);
        }
      }
    }
    // Vigilar alturas de los marcos (al escribir crecen): empujar los de debajo y avisar de solapamientos.
    resizeObserver?.disconnect();
    resizeObserver = new (doc().defaultView.ResizeObserver)(onFramesResized);
    rememberHeights();
    frames().forEach((f) => resizeObserver.observe(f));
  }

  function rememberHeights() {
    heights = new WeakMap(frames().map((f) => [f, f.offsetHeight]));
  }

  /** Si un marco cambia de alto, desplaza lo mismo los marcos que tiene justo debajo. */
  function onFramesResized() {
    console.log("[RO]", pushReady, pushEnabled(), frames().map((f) => (f.offsetHeight - (heights.get(f) ?? 0))).join(","));
    if (pushReady && pushEnabled()) {
      const list = frames().sort((a, b) => a.offsetTop - b.offsetTop);
      for (const f of list) {
        const old = heights.get(f);
        const delta = old == null ? 0 : f.offsetHeight - old;
        if (!delta) continue;
        const l = f.offsetLeft;
        const r = l + f.offsetWidth;
        const oldBottom = f.offsetTop + old;
        for (const o of list) {
          if (o === f || o.offsetTop < oldBottom - 1) continue;
          if (o.offsetLeft < r && o.offsetLeft + o.offsetWidth > l) o.style.top = `${o.offsetTop + delta}px`;
        }
      }
    }
    rememberHeights();
    checkLayout();
  }

  /** Empezar a empujar (tras cargar fuentes) con las alturas actuales como referencia. */
  function enablePush() {
    rememberHeights();
    pushReady = true;
  }

  // ---------- Selección ----------
  function select(el, asObject = false) {
    if (selected && selected !== el) selected.classList.remove('cv-selected');
    selected = el && el.isConnected ? el : null;
    frameMode = Boolean(selected) && asObject;
    selected?.classList.add('cv-selected');
    if (frameMode) doc().getSelection()?.removeAllRanges();
    for (const n of doc().querySelectorAll('[class=""]')) n.removeAttribute('class');
    onSelect(selected);
  }

  // ---------- Snap ----------
  function targets(exclude) {
    const p = page();
    const W = p.offsetWidth;
    const H = p.offsetHeight;
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    const gapTop = []; // donde puede empezar un marco: debajo de otro + GAP
    const gapBottom = []; // donde puede acabar un marco: encima de otro − GAP
    for (const el of objects()) {
      if (el === exclude) continue;
      const g = geom(el);
      xs.push(g.l, g.l + g.w / 2, g.l + g.w);
      ys.push(g.t, g.t + g.h / 2, g.t + g.h);
      if (el.classList.contains('frame')) {
        gapTop.push({ v: g.t + g.h + GAP, from: g.t + g.h, l: g.l, w: g.w });
        gapBottom.push({ v: g.t - GAP, from: g.t, l: g.l, w: g.w });
      }
    }
    return { xs, ys, gapTop, gapBottom };
  }

  /** Busca el enganche más cercano de cualquiera de los bordes `edges` contra `values`. */
  function nearest(edges, values, th) {
    let best = null;
    for (const e of edges) {
      for (const v of values) {
        const val = typeof v === 'number' ? v : v.v;
        const d = val - e.pos;
        if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: val, edge: e, target: v };
      }
    }
    return best;
  }

  function clearGuides() {
    page()?.querySelectorAll('.cv-guide, .cv-badge').forEach((g) => g.remove());
  }

  function drawGuides(snapX, snapY, box) {
    clearGuides();
    const p = page();
    if (snapX) {
      const g = editorEl('div', 'cv-guide v');
      g.style.left = `${snapX.at}px`;
      p.append(g);
    }
    if (snapY) {
      if (typeof snapY.target === 'object') {
        // Separación estándar entre marcos
        const g = editorEl('div', 'cv-guide gap');
        const top = Math.min(snapY.target.from, snapY.at);
        g.style.top = `${top}px`;
        g.style.height = `${GAP}px`;
        g.style.left = `${box.l + Math.min(box.w, snapY.target.w) / 2}px`;
        g.dataset.label = `${GAP}`;
        p.append(g);
      } else {
        const g = editorEl('div', 'cv-guide h');
        g.style.top = `${snapY.at}px`;
        p.append(g);
      }
    }
  }

  function badge(text, box) {
    const b = editorEl('div', 'cv-badge');
    b.textContent = text;
    b.style.left = `${box.l}px`;
    b.style.top = `${box.t + box.h + 8}px`;
    page().append(b);
  }

  // ---------- Mover y redimensionar ----------
  function startMove(e, el) {
    e.preventDefault();
    const handle = e.target;
    handle.setPointerCapture?.(e.pointerId);
    select(el, true);
    const d = doc();
    const s = scale();
    const start = geom(el);
    const sx = e.clientX;
    const sy = e.clientY;
    const t = targets(el);
    let moved = false;
    d.body.classList.add('cv-moving');

    const onMove = (ev) => {
      const dx = (ev.clientX - sx) / s;
      const dy = (ev.clientY - sy) / s;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      if (!moved) {
        history.snapshot();
        moved = true;
      }
      let l = start.l + dx;
      let tp = start.t + dy;
      let snapX = null;
      let snapY = null;
      if (snapEnabled() && !ev.altKey) {
        const th = SNAP_PX / s;
        snapX = nearest([{ pos: l, k: 0 }, { pos: l + start.w / 2, k: 0.5 }, { pos: l + start.w, k: 1 }], t.xs, th);
        if (snapX) l += snapX.d;
        snapY = nearest([{ pos: tp }, { pos: tp + start.h / 2 }, { pos: tp + start.h }], t.ys, th);
        const overlapsX = (g) => l < g.l + g.w && l + start.w > g.l;
        const gT = nearest([{ pos: tp }], t.gapTop.filter(overlapsX), th);
        const gB = nearest([{ pos: tp + start.h }], t.gapBottom.filter(overlapsX), th);
        for (const g of [gT, gB]) if (g && (!snapY || Math.abs(g.d) <= Math.abs(snapY.d))) snapY = g;
        if (snapY) tp += snapY.d;
      }
      el.style.left = `${Math.round(l)}px`;
      el.style.top = `${Math.round(tp)}px`;
      const box = { l: Math.round(l), t: Math.round(tp), w: start.w, h: start.h };
      drawGuides(snapX, snapY, box);
      badge(`x ${box.l} · y ${box.t}`, box);
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      d.body.classList.remove('cv-moving');
      clearGuides();
      if (moved) history.committed();
      select(el, true);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function startResize(e, el, dir) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.target;
    handle.setPointerCapture?.(e.pointerId);
    const d = doc();
    const s = scale();
    const start = geom(el);
    const sx = e.clientX;
    const sy = e.clientY;
    const t = targets(el);
    const isShape = el.classList.contains('shape');
    const min = isShape ? 1 : 40;
    history.snapshot();
    d.body.classList.add('cv-moving');

    const onMove = (ev) => {
      const dx = (ev.clientX - sx) / s;
      const dy = (ev.clientY - sy) / s;
      let { l, t: tp, w, h } = start;
      const snap = snapEnabled() && !ev.altKey;
      const th = SNAP_PX / s;
      let snapX = null;
      let snapY = null;
      if (dir.includes('e')) {
        let r = l + w + dx;
        if (snap && (snapX = nearest([{ pos: r }], t.xs, th))) r += snapX.d;
        w = Math.max(min, r - l);
      }
      if (dir.includes('w')) {
        let nl = l + dx;
        if (snap && (snapX = nearest([{ pos: nl }], t.xs, th))) nl += snapX.d;
        nl = Math.min(nl, l + w - min);
        w = l + w - nl;
        l = nl;
      }
      if (dir.includes('s')) {
        let b = tp + h + dy;
        if (snap && (snapY = nearest([{ pos: b }], t.ys, th))) b += snapY.d;
        h = Math.max(min, b - tp);
      }
      if (dir.includes('n')) {
        let nt = tp + dy;
        if (snap && (snapY = nearest([{ pos: nt }], t.ys, th))) nt += snapY.d;
        nt = Math.min(nt, tp + h - min);
        h = tp + h - nt;
        tp = nt;
      }
      el.style.left = `${Math.round(l)}px`;
      el.style.width = `${Math.round(w)}px`;
      if (isShape) {
        el.style.top = `${Math.round(tp)}px`;
        el.style.height = `${Math.round(h)}px`;
      }
      const box = geom(el);
      drawGuides(snapX, snapY, box);
      badge(isShape ? `${box.w} × ${box.h}` : `ancho ${box.w}`, box);
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      d.body.classList.remove('cv-moving');
      clearGuides();
      history.committed();
      select(el, true);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  // ---------- Acciones ----------
  function duplicate(el = selected) {
    if (!el) return;
    history.snapshot();
    const clone = el.cloneNode(true);
    clone.querySelectorAll(`[${attr}]`).forEach((n) => n.remove());
    clone.classList.remove('cv-selected', 'cv-overlap', 'cv-outside');
    clone.style.left = `${el.offsetLeft + GAP}px`;
    clone.style.top = `${el.offsetTop + GAP}px`;
    el.after(clone);
    ensureControls();
    history.committed();
    select(clone, true);
  }

  function remove(el = selected) {
    if (!el) return;
    history.snapshot();
    if (el === selected) select(null);
    el.remove();
    history.committed();
    toast('Elemento eliminado · ⌘Z para deshacer');
  }

  /** Cambia posición/tamaño del seleccionado (desde el inspector). */
  function setGeometry(patch) {
    if (!selected) return;
    history.snapshot();
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'height' && !selected.classList.contains('shape')) continue;
      if (Number.isFinite(v)) selected.style[k] = `${Math.round(v)}px`;
    }
    history.committed();
    onSelect(selected);
  }

  function setColor(color) {
    if (!selected?.classList.contains('shape')) return;
    history.snapshot();
    selected.style.background = color;
    history.committed();
  }

  function align(where) {
    if (!selected) return;
    const p = page();
    const g = geom(selected);
    const patch = {
      left: { left: 0 },
      hcenter: { left: (p.offsetWidth - g.w) / 2 },
      right: { left: p.offsetWidth - g.w },
      top: { top: 0 },
      vcenter: { top: (p.offsetHeight - g.h) / 2 },
      bottom: { top: p.offsetHeight - g.h },
    }[where];
    setGeometry(patch);
  }

  function arrange(where) {
    if (!selected) return;
    const p = page();
    history.snapshot();
    if (where === 'back') p.prepend(selected);
    else p.append(selected);
    history.committed();
  }

  function add(type) {
    const p = page();
    const win = doc().defaultView;
    const s = scale();
    const r = p.getBoundingClientRect();
    const y = Math.max(20, Math.min(p.offsetHeight - 80, Math.round((win.innerHeight / 2 - r.top) / s)));
    history.snapshot();
    let el;
    if (type === 'text') {
      el = doc().createElement('section');
      el.className = 'frame';
      el.innerHTML = '<h2>Nueva sección</h2><p>Escribe aquí…</p>';
      Object.assign(el.style, { left: '40px', top: `${y}px`, width: '300px' });
      p.append(el);
    } else {
      el = doc().createElement('div');
      el.className = 'shape';
      const line = type === 'line';
      Object.assign(el.style, {
        left: '40px', top: `${y}px`, width: line ? '300px' : '200px', height: line ? '2px' : '120px',
        background: line ? '#555555' : '#efefef',
      });
      // Las formas van detrás del texto.
      const firstFrame = p.querySelector(':scope > .frame');
      p.insertBefore(el, firstFrame);
    }
    ensureControls();
    history.committed();
    select(el, true);
  }

  /** Empuja hacia abajo los marcos que se solapan con otro que está encima. */
  function resolveOverlaps() {
    const list = frames().sort((a, b) => a.offsetTop - b.offsetTop);
    history.snapshot();
    let changed = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      for (let j = 0; j < i; j++) {
        const a = list[j];
        const ga = geom(a);
        const gb = geom(b);
        const overlapX = ga.l < gb.l + gb.w && ga.l + ga.w > gb.l;
        if (overlapX && ga.t <= gb.t && ga.t + ga.h > gb.t) {
          b.style.top = `${ga.t + ga.h + GAP}px`;
          changed++;
        }
      }
    }
    history.committed();
    toast(changed ? `${changed} marco${changed > 1 ? 's' : ''} recolocado${changed > 1 ? 's' : ''}` : 'No había solapamientos');
  }

  function checkLayout() {
    const p = page();
    if (!p) return;
    const list = frames().map((el) => ({ el, g: geom(el) }));
    let outside = 0;
    let overlaps = 0;
    for (const { el, g } of list) {
      const out = g.l < -1 || g.t < -1 || g.l + g.w > p.offsetWidth + 1 || g.t + g.h > p.offsetHeight + 1;
      const over = list.some(({ el: o, g: h }) => o !== el &&
        g.l < h.l + h.w - 1 && g.l + g.w > h.l + 1 && g.t < h.t + h.h - 1 && g.t + g.h > h.t + 1);
      el.classList.toggle('cv-outside', out);
      el.classList.toggle('cv-overlap', over && !out);
      if (!el.getAttribute('class')) el.removeAttribute('class');
      outside += out;
      overlaps += over;
    }
    onLayout({ outside, overlaps });
  }

  // ---------- Eventos ----------
  function onKeyDown(e) {
    if (!selected) return false;
    if (e.key === 'Escape') {
      if (frameMode) select(null);
      else select(selected, true);
      return true;
    }
    if (!frameMode) return false;
    const mod = e.metaKey || e.ctrlKey;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] && !mod) {
      const [dx, dy] = moves[e.key];
      setGeometry({ left: selected.offsetLeft + dx, top: selected.offsetTop + dy });
      return true;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mod) {
      remove();
      return true;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      duplicate();
      return true;
    }
    return false;
  }

  function attach() {
    const d = doc();
    selected = null;
    frameMode = false;
    pushReady = false;
    ensureControls();
    d.addEventListener('pointerdown', (e) => {
      const target = e.target;
      const h = target.closest?.('.cv-h');
      if (h) return startResize(e, h.parentElement, h.dataset.dir);
      const btn = target.closest?.('.cv-ctl-frame button');
      if (btn) {
        const el = btn.parentElement.parentElement;
        if (btn.dataset.act === 'move') return startMove(e, el);
        e.preventDefault();
        if (btn.dataset.act === 'dup') duplicate(el);
        if (btn.dataset.act === 'del') remove(el);
        return;
      }
      if (target.closest?.('.cv-ctl')) return; // controles de bloque
      // ⌥+clic: seleccionar la forma que hay detrás del texto (p. ej. la franja lateral).
      const behind = e.altKey && d.elementsFromPoint(e.clientX, e.clientY).find((n) => n.matches('.page > .shape'));
      if (behind) return startMove(e, behind);
      const shape = target.closest?.('.page > .shape');
      if (shape) return startMove(e, shape);
      const frame = target.closest?.('.page > .frame');
      if (frame) return select(frame, false); // editar texto
      select(null);
    }, true);
  }

  return {
    attach, ensureControls, checkLayout, onKeyDown, enablePush,
    select, getSelected: () => selected, isFrameMode: () => frameMode,
    setGeometry, setColor, align, arrange, add, duplicate, remove, resolveOverlaps,
  };
}
