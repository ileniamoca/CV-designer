// Items (.item) inside text frames, and the shared undo history.
//  - An item is a job, a project, a degree, a group of skills…
//  - It can be dragged to another position in the same frame, to another frame, or to an
//    empty area of the page (a new frame is then created for it).
// Controls are injected with the editor attribute and removed on save.

export const FRAME = '.page > .frame';
const ITEM = '.item';

export const BLOCKS_CSS = `
  .item { position: relative; }
  .cv-ctl {
    position: absolute; z-index: 20; display: none; gap: 3px;
    font: 12px/1 -apple-system, BlinkMacSystemFont, sans-serif;
    user-select: none; -webkit-user-select: none;
  }
  .cv-ctl button {
    all: unset; box-sizing: border-box; width: 22px; height: 22px;
    display: grid; place-items: center; cursor: pointer;
    background: #fff; color: #555; border: 1px solid #c9c9c9; border-radius: 5px;
    box-shadow: 0 1px 3px rgba(0,0,0,.12);
  }
  .cv-ctl button:hover { background: #2b5797; border-color: #2b5797; color: #fff; }
  .cv-ctl button[data-act="drag"], .cv-ctl button[data-act="move"] { cursor: grab; }
  .cv-ctl-item { left: -30px; top: 0; flex-direction: column; padding-right: 8px; }
  .item:hover > .cv-ctl-item { display: flex; }
  .item:hover { outline: 1px dashed rgba(43,87,151,.6); outline-offset: 3px; }
  .cv-dragging { opacity: .3; }
  .cv-drop { height: 0; border-top: 3px solid #2b5797; border-radius: 2px; margin: 6px 0; }
  .cv-drop-new {
    position: absolute; z-index: 30; height: 40px; border: 2px dashed #2b5797; border-radius: 4px;
    background: rgba(43,87,151,.06); pointer-events: none;
  }
  body.cv-is-dragging, body.cv-is-dragging * { cursor: grabbing !important; user-select: none !important; }
  body.cv-is-dragging .cv-ctl { display: none !important; }
  body.cv-is-dragging .item { outline: none !important; }
  .frame.cv-target { outline: 2px solid rgba(43,87,151,.35) !important; outline-offset: 2px; }
  @media print { .cv-ctl, .cv-drop, .cv-drop-new { display: none !important; } .item { outline: none !important; } }
`;

/**
 * @param {object} o
 * @param {() => Document} o.doc
 * @param {string} o.attr                 attribute marking what the editor injects
 * @param {() => any} o.getState          full state for undo (body + styles)
 * @param {(s: any) => void} o.setState
 * @param {() => void} o.onChange         after each structural change
 * @param {(msg: string) => void} o.toast
 */
export function createBlocks({ doc, attr, getState, setState, onChange, toast }) {
  let undoStack = [];
  let redoStack = [];
  let lastWasStructural = false;

  function controls() {
    const d = doc();
    const box = d.createElement('div');
    box.setAttribute(attr, '');
    box.setAttribute('contenteditable', 'false');
    box.className = 'cv-ctl cv-ctl-item';
    for (const [act, icon, title] of [
      ['drag', '⠿', 'Drag block (elsewhere in the frame, to another frame or to an empty area)'],
      ['dup', '⧉', 'Duplicate block'],
      ['del', '✕', 'Delete block'],
    ]) {
      const b = d.createElement('button');
      b.type = 'button';
      b.dataset.act = act;
      b.title = title;
      b.textContent = icon;
      box.append(b);
    }
    return box;
  }

  function ensureControls() {
    const d = doc();
    if (!d?.body) return;
    d.querySelectorAll('.cv-ctl-item').forEach((c) => {
      if (!c.parentElement?.matches(ITEM)) c.remove();
    });
    for (const el of d.querySelectorAll(ITEM)) {
      if (el.closest('.frame') && !el.querySelector(':scope > .cv-ctl-item')) el.append(controls());
    }
  }

  // ---------- History (shared by blocks, frames, shapes and styles) ----------
  function snapshot() {
    undoStack.push(getState());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function committed() {
    lastWasStructural = true;
    onChange();
  }
  function undo() {
    if (!lastWasStructural || !undoStack.length) return false;
    redoStack.push(getState());
    setState(undoStack.pop());
    onChange();
    return true;
  }
  function redo() {
    if (!lastWasStructural || !redoStack.length) return false;
    undoStack.push(getState());
    setState(redoStack.pop());
    onChange();
    return true;
  }
  /** When typing or formatting, ⌘Z goes back to being the native text undo. */
  function textEdited() {
    lastWasStructural = false;
  }
  function reset() {
    undoStack = [];
    redoStack = [];
    lastWasStructural = false;
  }

  // ---------- Actions ----------
  function duplicate(el) {
    snapshot();
    const clone = el.cloneNode(true);
    clone.querySelectorAll(`[${attr}]`).forEach((n) => n.remove());
    el.after(clone);
    committed();
  }

  function remove(el) {
    snapshot();
    el.remove();
    committed();
    toast('Block deleted · ⌘Z to undo');
  }

  // ---------- Drag ----------
  function pageScale(page) {
    return page.getBoundingClientRect().width / page.offsetWidth || 1;
  }

  function dropTarget(x, y, el) {
    const d = doc();
    const hit = d.elementFromPoint(x, y);
    if (!hit) return null;
    const frame = hit.closest(FRAME);
    if (!frame || frame.classList.contains('shape')) {
      const page = hit.closest('.page');
      if (!page) return null;
      const r = page.getBoundingClientRect();
      const s = pageScale(page);
      return { page, x: Math.round((x - r.left) / s), y: Math.round((y - r.top) / s) };
    }
    const items = [...frame.children].filter((c) => c.matches(ITEM) && c !== el);
    let before = items.find((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (!before) {
      before = items.length ? items.at(-1).nextElementSibling : frame.querySelector(`:scope > [${attr}]`);
      if (before?.classList.contains('cv-drop')) before = before.nextElementSibling;
    }
    return { container: frame, before: before ?? null };
  }

  function startDrag(e, el) {
    e.preventDefault();
    const d = doc();
    const win = d.defaultView;
    const handle = e.target;
    handle.setPointerCapture?.(e.pointerId);
    const sourceFrame = el.closest('.frame');

    const drop = d.createElement('div');
    drop.setAttribute(attr, '');
    const ghost = d.createElement('div');
    ghost.setAttribute(attr, '');
    ghost.className = 'cv-drop-new';
    ghost.style.width = `${sourceFrame.offsetWidth}px`;

    el.classList.add('cv-dragging');
    d.body.classList.add('cv-is-dragging');
    d.getSelection()?.removeAllRanges();
    let target = null;
    let highlighted = null;

    const onMove = (ev) => {
      target = dropTarget(ev.clientX, ev.clientY, el);
      if (target?.container) {
        ghost.remove();
        drop.className = 'cv-drop';
        if (drop.parentNode !== target.container || drop.nextSibling !== target.before) {
          target.container.insertBefore(drop, target.before);
        }
      } else if (target?.page) {
        drop.remove();
        target.page.append(ghost);
        ghost.style.left = `${target.x}px`;
        ghost.style.top = `${target.y}px`;
      } else {
        drop.remove();
        ghost.remove();
      }
      const c = target?.container ?? null;
      if (c !== highlighted) {
        highlighted?.classList.remove('cv-target');
        highlighted = c;
        highlighted?.classList.add('cv-target');
      }
      const edge = 50;
      if (ev.clientY < edge) win.scrollBy(0, -12);
      else if (ev.clientY > win.innerHeight - edge) win.scrollBy(0, 12);
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      el.classList.remove('cv-dragging');
      d.body.classList.remove('cv-is-dragging');
      highlighted?.classList.remove('cv-target');

      if (drop.parentNode && drop.previousElementSibling !== el && drop.nextElementSibling !== el) {
        const parent = drop.parentNode;
        const next = drop.nextSibling;
        drop.remove();
        snapshot();
        parent.insertBefore(el, next);
        committed();
      } else if (ghost.parentNode) {
        // Dropped on an empty area: new frame with this block.
        const { x, y } = target;
        ghost.remove();
        snapshot();
        const frame = d.createElement('section');
        frame.className = 'frame';
        frame.style.left = `${x}px`;
        frame.style.top = `${y}px`;
        frame.style.width = `${sourceFrame.offsetWidth}px`;
        sourceFrame.parentNode.append(frame);
        frame.append(el);
        committed();
      }
      drop.remove();
      ghost.remove();
      for (const n of [el, d.body]) if (n.getAttribute('class') === '') n.removeAttribute('class');
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  /** Hooks events onto the iframe document (call after each load). */
  function attach() {
    const d = doc();
    reset();
    ensureControls();
    d.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest?.('.cv-ctl-item button');
      if (!btn) return;
      const el = btn.parentElement.parentElement;
      if (btn.dataset.act === 'drag') return startDrag(e, el);
      e.preventDefault();
      if (btn.dataset.act === 'dup') duplicate(el);
      if (btn.dataset.act === 'del') remove(el);
    });
  }

  return { attach, ensureControls, undo, redo, textEdited, snapshot, committed };
}
