'use strict';
const fs = require('fs');
const path = require('path');

function safe(p) {
  if (!p) throw new Error('path is required');
  return path.resolve(p);
}

async function list(dir) {
  const d = safe(dir);
  const entries = fs.readdirSync(d, { withFileTypes: true });
  const items = entries.map((e) => {
    const full = path.join(d, e.name);
    let st = null;
    try { st = fs.statSync(full); } catch (_) { /* dangling symlink etc */ }
    return {
      name: e.name,
      path: full,
      dir: e.isDirectory(),
      size: st ? st.size : 0,
      mtime: st ? st.mtimeMs : 0,
      mode: st ? (st.mode & 0o777).toString(8) : ''
    };
  }).sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name));
  return { path: d, parent: path.dirname(d), items };
}

async function read(p) {
  const f = safe(p);
  const st = fs.statSync(f);
  if (st.isDirectory()) throw new Error('that is a directory');
  if (st.size > 2 * 1024 * 1024) throw new Error('file too large to edit in-panel (>2MB)');
  return { path: f, content: fs.readFileSync(f, 'utf8') };
}

async function write(p, content) {
  fs.writeFileSync(safe(p), content == null ? '' : String(content));
  return { ok: true };
}

async function mkdir(p) { fs.mkdirSync(safe(p), { recursive: true }); return { ok: true }; }

async function remove(p) {
  const f = safe(p);
  if (f === '/' || f === '') throw new Error('refusing to delete root');
  fs.rmSync(f, { recursive: true, force: true });
  return { ok: true };
}

async function rename(from, to) { fs.renameSync(safe(from), safe(to)); return { ok: true }; }

async function saveUpload(file, destDir) {
  if (!file) throw new Error('no file received');
  const dir = safe(destDir);
  const dest = path.join(dir, file.originalname);
  fs.copyFileSync(file.path, dest);
  fs.unlinkSync(file.path);
  return { ok: true, path: dest };
}

module.exports = { list, read, write, mkdir, remove, rename, saveUpload };
