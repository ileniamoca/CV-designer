import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { htmlToPdf, findChrome } from './pdf.js';

const ROOT = path.resolve('documents');
const DIRS = {
  originals: path.join(ROOT, 'originals'),
  copies: path.join(ROOT, 'copies'),
  pdf: path.join(ROOT, 'pdf'),
};
const EXT = { originals: '.html', copies: '.html', pdf: '.pdf' };

/** Returns the absolute path of a document, or throws if the name is invalid. */
function resolveDoc(kind, name) {
  if (!DIRS[kind]) throw httpError(400, `Unknown folder: ${kind}`);
  const base = path.basename(String(name || ''));
  if (!base || base.startsWith('.') || path.extname(base) !== EXT[kind]) {
    throw httpError(400, `Invalid name: ${name}`);
  }
  return path.join(DIRS[kind], base);
}

/** Sanitizes a user-chosen name so it can be used as a file name. */
function cleanName(name, ext) {
  const stem = String(name || '')
    .replace(new RegExp(`\\${ext}$`, 'i'), '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/^\.+/, '')
    .trim();
  if (!stem) throw httpError(400, 'The name is empty.');
  return stem + ext;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function listDir(kind) {
  const entries = await fsp.readdir(DIRS[kind], { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(EXT[kind]))
      .map(async (e) => {
        const st = await fsp.stat(path.join(DIRS[kind], e.name));
        return { name: e.name, mtime: st.mtimeMs, size: st.size };
      }),
  );
  return files.sort((a, b) => b.mtime - a.mtime);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return req.headers['content-type']?.includes('json') ? JSON.parse(raw || '{}') : raw;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

export function cvApi() {
  return {
    name: 'cv-api',
    configureServer(server) {
      for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });

      // Live notifications (SSE) when a file changes on disk, e.g. edited by Claude.
      const clients = new Set();
      const timers = new Map();
      // Only notify if the mtime really changed: on macOS fs.watch re-emits old events on startup.
      const mtimes = new Map();
      const mtimeOf = (rel) => {
        try { return fs.statSync(path.join(ROOT, rel)).mtimeMs; } catch { return null; }
      };
      for (const kind of Object.keys(DIRS)) {
        for (const name of fs.readdirSync(DIRS[kind])) mtimes.set(path.join(kind, name), mtimeOf(path.join(kind, name)));
      }
      const watcher = fs.watch(ROOT, { recursive: true }, (_evt, rel) => {
        if (!rel) return;
        const [kind, name] = rel.split(path.sep);
        if (!DIRS[kind] || !name || name.startsWith('.')) return;
        clearTimeout(timers.get(rel));
        timers.set(rel, setTimeout(() => {
          timers.delete(rel);
          const mtime = mtimeOf(rel);
          if (mtimes.get(rel) === mtime) return;
          mtimes.set(rel, mtime);
          const msg = `data: ${JSON.stringify({ kind, name })}\n\n`;
          for (const c of clients) c.write(msg);
        }, 150));
      });
      server.httpServer?.on('close', () => watcher.close());

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/files/')) return next();
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

        try {
          // GET /api/events
          if (parts[1] === 'events') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-store',
              Connection: 'keep-alive',
            });
            res.write(': ok\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
            return;
          }

          // GET /api/docs
          if (parts[1] === 'docs' && parts.length === 2 && req.method === 'GET') {
            const [originals, copies, pdf] = await Promise.all(
              ['originals', 'copies', 'pdf'].map(listDir),
            );
            return send(res, 200, { originals, copies, pdf, chrome: Boolean(findChrome()) });
          }

          // /api/docs/:kind/:name  (GET read, PUT save, DELETE delete)
          if (parts[1] === 'docs' && parts.length === 4) {
            const [, , kind, name] = parts;
            const file = resolveDoc(kind, name);
            if (req.method === 'GET') {
              return send(res, 200, await fsp.readFile(file, 'utf8'), 'text/html; charset=utf-8');
            }
            if (req.method === 'PUT' && kind !== 'pdf') {
              const html = await readBody(req);
              if (!html.trim()) throw httpError(400, 'Empty document.');
              await fsp.writeFile(file, html, 'utf8');
              return send(res, 200, { ok: true, kind, name: path.basename(file) });
            }
            if (req.method === 'DELETE' && kind !== 'originals') {
              await fsp.unlink(file);
              return send(res, 200, { ok: true });
            }
          }

          // POST /api/copies  { name, html }  → creates a new copy (never overwrites)
          if (parts[1] === 'copies' && req.method === 'POST') {
            const { name, html, kind = 'copias' } = await readBody(req);
            if (kind !== 'copias' && kind !== 'originales') throw httpError(400, `Carpeta no válida: ${kind}`);
            if (!String(html || '').trim()) throw httpError(400, 'Documento vacío.');
            let fileName = cleanName(name, '.html');
            const stem = fileName.slice(0, -5);
            for (let i = 2; fs.existsSync(path.join(DIRS.copies, fileName)); i++) {
              fileName = `${stem} (${i}).html`;
            }
            await fsp.writeFile(path.join(DIRS.copies, fileName), html, 'utf8');
            return send(res, 200, { ok: true, kind: 'copies', name: fileName });
          }

          // POST /api/pdf  { name, html }  → generates documents/pdf/<name>.pdf
          if (parts[1] === 'pdf' && req.method === 'POST') {
            const { name, html } = await readBody(req);
            const fileName = cleanName(name, '.pdf');
            await htmlToPdf(html, path.join(DIRS.pdf, fileName));
            return send(res, 200, { ok: true, name: fileName, url: `/files/pdf/${encodeURIComponent(fileName)}` });
          }

          // GET /files/:kind/:name  → serves the file as is (to open PDFs / preview)
          if (parts[0] === 'files' && parts.length === 3 && req.method === 'GET') {
            const file = resolveDoc(parts[1], parts[2]);
            const type = file.endsWith('.pdf') ? 'application/pdf' : 'text/html; charset=utf-8';
            return send(res, 200, await fsp.readFile(file), type);
          }

          throw httpError(404, 'Route not found');
        } catch (err) {
          const status = err.status ?? (err.code === 'ENOENT' ? 404 : 500);
          if (status === 500) console.error('[cv-api]', err);
          return send(res, status, { error: err.message });
        }
      });
    },
  };
}
