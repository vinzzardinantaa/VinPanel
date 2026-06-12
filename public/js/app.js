'use strict';
/* ------------ helpers ------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  if (r.status === 402) { location.href = '/setup'; throw new Error('license required'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
const get = (u) => api('GET', u);
const post = (u, b) => api('POST', u, b);
const del = (u) => api('DELETE', u);

let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.className = 'toast ' + type;
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
const ok = (m) => toast(m, 'ok');
const err = (m) => toast(m, 'err');

function bytes(n) {
  n = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}
function rate(n) { return bytes(n) + '/s'; }
function uptime(s) {
  s = Math.floor(s); const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return (d ? d + 'd ' : '') + h + 'h ' + m + 'm';
}
function ago(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  return d.toLocaleString(undefined, { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ------------ modal ------------ */
const modal = $('#modal'), modalBox = $('#modalBox');
function openModal(html, wide) {
  modalBox.className = 'box' + (wide ? ' wide' : '');
  modalBox.innerHTML = html;
  modal.classList.add('show');
  const c = $('[data-close]', modalBox); if (c) c.onclick = closeModal;
  const fi = modalBox.querySelector('input,textarea,select'); if (fi) setTimeout(() => fi.focus(), 30);
}
function closeModal() { modal.classList.remove('show'); modalBox.innerHTML = ''; }
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ------------ navigation ------------ */
const loaders = {};
function show(view) {
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  if (loaders[view]) loaders[view]();
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view);
});
$$('[data-reload]').forEach((b) => b.addEventListener('click', () => loaders[b.dataset.reload] && loaders[b.dataset.reload]()));
$('#logout').onclick = async () => { await post('/api/logout'); location.href = '/login'; };

/* ------------ dashboard ------------ */
function setRing(id, valId, pct, label) {
  const r = $('#' + id); r.style.setProperty('--v', pct);
  $('#' + valId).textContent = pct + '%';
  return label;
}
function renderStats(s) {
  setRing('ringCpu', 'cpuVal', s.cpu);
  setRing('ringMem', 'memVal', s.mem.percent);
  setRing('ringDisk', 'diskVal', s.disk.percent);
  $('#cpuMeta').innerHTML = `<b>${s.cores}</b> cores<br>load <b>${s.load.join(' / ')}</b>`;
  $('#memMeta').innerHTML = `<b>${bytes(s.mem.used)}</b> used<br>of <b>${bytes(s.mem.total)}</b>`;
  $('#diskMeta').innerHTML = `<b>${bytes(s.disk.used)}</b> used<br>of <b>${bytes(s.disk.total)}</b>`;
  $('#liveInfo').innerHTML = [
    ['Uptime', uptime(s.uptime)],
    ['Net &#8595; in', rate(s.net.rxRate)],
    ['Net &#8593; out', rate(s.net.txRate)],
    ['Load 1m', s.load[0]]
  ].map((r) => `<div class="stat"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join('');
}
loaders.dash = async () => {
  try { renderStats(await get('/api/system')); } catch (e) { /* socket will fill in */ }
};

/* ------------ sites ------------ */
let phpCache = null;
async function phpVersions() { if (!phpCache) phpCache = await get('/api/php'); return phpCache; }

loaders.sites = async () => {
  const tb = $('#sitesTbl tbody');
  tb.innerHTML = '<tr><td colspan="6" class="muted">Loading&hellip;</td></tr>';
  try {
    const list = await get('/api/sites');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="6"><div class="empty">No sites yet. Click "New site" to create one.</div></td></tr>'; return; }
    tb.innerHTML = list.map((s) => `<tr>
      <td class="mono"><a href="http://${esc(s.domain)}" target="_blank" rel="noopener">${esc(s.domain)}</a></td>
      <td class="mono muted" style="font-size:12px">${esc(s.root)}</td>
      <td class="mono">${s.phpVersion ? esc(s.phpVersion) : '<span class="muted">static</span>'}</td>
      <td>${s.ssl ? '<span class="badge on">SSL</span>' : '<span class="badge off">none</span>'}</td>
      <td>${s.enabled ? '<span class="badge on">enabled</span>' : '<span class="badge off">disabled</span>'}</td>
      <td><div class="row">
        <button class="btn sm" data-toggle="${esc(s.domain)}">${s.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn sm danger" data-del="${esc(s.domain)}">Delete</button>
      </div></td></tr>`).join('');
    $$('[data-toggle]', tb).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await post('/api/sites/' + b.dataset.toggle + '/toggle'); ok('Site updated'); loaders.sites(); }
      catch (e) { err(e.message); b.disabled = false; }
    });
    $$('[data-del]', tb).forEach((b) => b.onclick = () => confirmDeleteSite(b.dataset.del));
  } catch (e) { tb.innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message)}</td></tr>`; }
};

$('#addSite').onclick = async () => {
  const php = await phpVersions().catch(() => ({ versions: [] }));
  const opts = ['<option value="">Static (no PHP)</option>']
    .concat(php.versions.map((v) => `<option value="${v}">PHP ${v}</option>`)).join('');
  openModal(`<button class="x" data-close>&times;</button><h3>New website</h3>
    <div class="field"><label>Domain</label><input id="nsDomain" placeholder="app.example.com"></div>
    <div class="field"><label>Document root <span class="muted">(optional)</span></label><input id="nsRoot" placeholder="leave blank for default"></div>
    <div class="field"><label>PHP version</label><select id="nsPhp">${opts}</select></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px">
      <button class="btn" data-close>Cancel</button>
      <button class="btn pri" id="nsSave">Create site</button></div>`);
  $('#nsSave').onclick = async () => {
    const domain = $('#nsDomain').value.trim();
    if (!domain) return err('Domain is required');
    const btn = $('#nsSave'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Creating';
    try {
      await post('/api/sites', { domain, root: $('#nsRoot').value.trim(), phpVersion: $('#nsPhp').value });
      closeModal(); ok('Site created'); loaders.sites();
    } catch (e) { err(e.message); btn.disabled = false; btn.textContent = 'Create site'; }
  };
};

function confirmDeleteSite(domain) {
  openModal(`<button class="x" data-close>&times;</button><h3>Delete ${esc(domain)}?</h3>
    <p class="muted" style="margin:0 0 14px">This removes the nginx config. Optionally delete the site files too.</p>
    <label class="row" style="gap:8px;margin-bottom:18px"><input type="checkbox" id="dsPurge" style="width:auto"> Also delete website files (irreversible)</label>
    <div class="row" style="justify-content:flex-end">
      <button class="btn" data-close>Cancel</button>
      <button class="btn pri danger" id="dsGo">Delete</button></div>`);
  $('#dsGo').onclick = async () => {
    try { await del('/api/sites/' + encodeURIComponent(domain) + '?purge=' + ($('#dsPurge').checked ? '1' : '0')); closeModal(); ok('Site deleted'); loaders.sites(); }
    catch (e) { err(e.message); }
  };
}

/* ------------ databases ------------ */
loaders.db = async () => {
  const tb = $('#dbTbl tbody');
  tb.innerHTML = '<tr><td colspan="3" class="muted">Loading&hellip;</td></tr>';
  try {
    const list = await get('/api/databases');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="3"><div class="empty">No databases yet.</div></td></tr>'; return; }
    tb.innerHTML = list.map((d) => `<tr>
      <td class="mono">${esc(d.name)}</td>
      <td class="mono muted">${d.sizeMB ? d.sizeMB + ' MB' : '&lt; 1 MB'}</td>
      <td><button class="btn sm danger" data-del="${esc(d.name)}">Drop</button></td></tr>`).join('');
    $$('[data-del]', tb).forEach((b) => b.onclick = () => {
      openModal(`<button class="x" data-close>&times;</button><h3>Drop database ${esc(b.dataset.del)}?</h3>
        <p class="muted" style="margin:0 0 18px">This permanently deletes all data in this database.</p>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" data-close>Cancel</button>
          <button class="btn pri danger" id="dropGo">Drop database</button></div>`);
      $('#dropGo').onclick = async () => {
        try { await del('/api/databases/' + encodeURIComponent(b.dataset.del)); closeModal(); ok('Database dropped'); loaders.db(); }
        catch (e) { err(e.message); }
      };
    });
  } catch (e) { tb.innerHTML = `<tr><td colspan="3" class="muted">${esc(e.message)}</td></tr>`; }
};

$('#addDb').onclick = () => {
  openModal(`<button class="x" data-close>&times;</button><h3>New database</h3>
    <div class="field"><label>Database name</label><input id="ndName" placeholder="myapp_db"></div>
    <div class="field"><label>User <span class="muted">(defaults to db name)</span></label><input id="ndUser" placeholder="myapp_user"></div>
    <div class="field"><label>Password</label><input id="ndPass" type="text" placeholder="strong password"></div>
    <div class="hint">A user with full privileges on this database will be created for @localhost and @%.</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button class="btn" data-close>Cancel</button>
      <button class="btn pri" id="ndSave">Create</button></div>`);
  $('#ndSave').onclick = async () => {
    const name = $('#ndName').value.trim();
    if (!name) return err('Database name required');
    try {
      const r = await post('/api/databases', { name, user: $('#ndUser').value.trim(), password: $('#ndPass').value });
      closeModal(); ok('Database "' + r.name + '" created (user: ' + r.user + ')'); loaders.db();
    } catch (e) { err(e.message); }
  };
};

/* ------------ php ------------ */
loaders.php = async () => {
  const c = $('#phpCard');
  c.innerHTML = '<span class="muted">Loading&hellip;</span>';
  try {
    const p = await get('/api/php'); phpCache = p;
    c.innerHTML = (p.versions.length
      ? '<div class="row" style="gap:10px;margin-bottom:14px">' +
        p.versions.map((v) => `<span class="badge on" style="font-size:13px;padding:7px 12px">PHP ${esc(v)}</span>`).join('') + '</div>'
      : '<div class="empty">No PHP-FPM versions detected. Install one, e.g. <code>apt install php8.3-fpm</code></div>') +
      (p.cli ? `<div class="stat"><span class="k">CLI</span><span class="v">${esc(p.cli)}</span></div>` : '') +
      '<p class="hint" style="margin-top:14px">Assign a PHP version per-site when creating a website. To add a version, install its <code>-fpm</code> package on the server, then it appears here automatically.</p>';
  } catch (e) { c.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
};

/* ------------ ssl ------------ */
$('#sslIssue').onclick = async () => {
  const domain = $('#sslDomain').value.trim(), email = $('#sslEmail').value.trim();
  if (!domain || !email) return err('Domain and email are required');
  const btn = $('#sslIssue'), out = $('#sslOut');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Issuing&hellip;'; out.textContent = 'Running certbot, this can take ~30s&hellip;';
  try {
    const r = await post('/api/ssl', { domain, email });
    out.textContent = (r.output || '').trim() || 'Done.';
    ok('Certificate issued for ' + domain); loaders.sites();
  } catch (e) { out.textContent = e.message; err('Certbot failed'); }
  finally { btn.disabled = false; btn.textContent = 'Issue certificate'; }
};

/* ------------ services ------------ */
loaders.services = async () => {
  const tb = $('#svcTbl tbody');
  tb.innerHTML = '<tr><td colspan="3" class="muted">Loading&hellip;</td></tr>';
  try {
    const list = await get('/api/services');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="3"><div class="empty">No managed services found.</div></td></tr>'; return; }
    tb.innerHTML = list.map((s) => {
      const run = s.status === 'active';
      return `<tr><td class="mono">${esc(s.name)}</td>
        <td><span class="badge ${run ? 'run' : 'dead'}">${esc(s.status)}</span></td>
        <td><div class="row">
          <button class="btn sm" data-svc="${esc(s.name)}" data-act="restart">Restart</button>
          ${run ? `<button class="btn sm danger" data-svc="${esc(s.name)}" data-act="stop">Stop</button>`
                : `<button class="btn sm" data-svc="${esc(s.name)}" data-act="start">Start</button>`}
        </div></td></tr>`;
    }).join('');
    $$('[data-svc]', tb).forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { await post('/api/services/' + b.dataset.svc + '/' + b.dataset.act); ok(b.dataset.svc + ' ' + b.dataset.act + 'ed'); loaders.services(); }
      catch (e) { err(e.message); b.disabled = false; }
    });
  } catch (e) { tb.innerHTML = `<tr><td colspan="3" class="muted">${esc(e.message)}</td></tr>`; }
};

/* ------------ files ------------ */
let cwd = null;
async function loadFiles(p) {
  const tb = $('#filesTbl tbody');
  tb.innerHTML = '<tr><td colspan="5" class="muted">Loading&hellip;</td></tr>';
  try {
    const r = await get('/api/files' + (p ? '?path=' + encodeURIComponent(p) : ''));
    cwd = r.path;
    $('#crumbs').textContent = r.path;
    tb.innerHTML = r.items.map((it) => `<tr>
      <td><div class="fitem"><span class="ic">${it.dir ? '&#128193;' : '&#128196;'}</span>
        ${it.dir ? `<a href="#" data-cd="${esc(it.path)}">${esc(it.name)}</a>`
                 : `<a href="#" data-edit="${esc(it.path)}">${esc(it.name)}</a>`}</div></td>
      <td class="mono muted">${it.dir ? '-' : bytes(it.size)}</td>
      <td class="mono muted">${esc(it.mode)}</td>
      <td class="mono muted" style="font-size:12px">${ago(it.mtime)}</td>
      <td><div class="row">
        <button class="btn sm" data-ren="${esc(it.path)}" data-name="${esc(it.name)}">Rename</button>
        <button class="btn sm danger" data-rm="${esc(it.path)}">Delete</button>
      </div></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Empty folder</div></td></tr>';

    $$('[data-cd]', tb).forEach((a) => a.onclick = (e) => { e.preventDefault(); loadFiles(a.dataset.cd); });
    $$('[data-edit]', tb).forEach((a) => a.onclick = (e) => { e.preventDefault(); editFile(a.dataset.edit); });
    $$('[data-rm]', tb).forEach((b) => b.onclick = () => rmFile(b.dataset.rm));
    $$('[data-ren]', tb).forEach((b) => b.onclick = () => renFile(b.dataset.ren, b.dataset.name));
    $('#fUp').dataset.parent = r.parent;
  } catch (e) { tb.innerHTML = `<tr><td colspan="5" class="muted">${esc(e.message)}</td></tr>`; }
}
loaders.files = () => loadFiles(cwd);
$('#fUp').onclick = () => loadFiles($('#fUp').dataset.parent);
$('#fHome').onclick = () => loadFiles(null);
$('#fMkdir').onclick = () => {
  openModal(`<button class="x" data-close>&times;</button><h3>New folder</h3>
    <div class="field"><label>Folder name</label><input id="mkName" placeholder="newfolder"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button>
    <button class="btn pri" id="mkGo">Create</button></div>`);
  $('#mkGo').onclick = async () => {
    const n = $('#mkName').value.trim(); if (!n) return;
    try { await post('/api/files/mkdir', { path: cwd + '/' + n }); closeModal(); ok('Folder created'); loadFiles(cwd); }
    catch (e) { err(e.message); }
  };
};
$('#fNewFile').onclick = () => {
  openModal(`<button class="x" data-close>&times;</button><h3>New file</h3>
    <div class="field"><label>File name</label><input id="nfName" placeholder="index.php"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button>
    <button class="btn pri" id="nfGo">Create</button></div>`);
  $('#nfGo').onclick = async () => {
    const n = $('#nfName').value.trim(); if (!n) return;
    try { await post('/api/files/write', { path: cwd + '/' + n, content: '' }); closeModal(); editFile(cwd + '/' + n); loadFiles(cwd); }
    catch (e) { err(e.message); }
  };
};
$('#fUpload').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file); fd.append('path', cwd);
  try {
    const r = await fetch('/api/files/upload', { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'upload failed');
    ok('Uploaded ' + file.name); loadFiles(cwd);
  } catch (er) { err(er.message); }
  e.target.value = '';
};
async function editFile(path) {
  try {
    const r = await get('/api/files/read?path=' + encodeURIComponent(path));
    openModal(`<button class="x" data-close>&times;</button><h3 style="font-family:var(--mono);font-size:14px">${esc(path)}</h3>
      <textarea id="efBody" rows="20">${esc(r.content)}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:12px">
        <button class="btn" data-close>Cancel</button>
        <button class="btn pri" id="efSave">Save</button></div>`, true);
    $('#efSave').onclick = async () => {
      try { await post('/api/files/write', { path, content: $('#efBody').value }); closeModal(); ok('Saved'); }
      catch (e) { err(e.message); }
    };
  } catch (e) { err(e.message); }
}
function rmFile(path) {
  openModal(`<button class="x" data-close>&times;</button><h3>Delete?</h3>
    <p class="mono muted" style="margin:0 0 16px;word-break:break-all">${esc(path)}</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button>
    <button class="btn pri danger" id="rmGo">Delete</button></div>`);
  $('#rmGo').onclick = async () => {
    try { await del('/api/files?path=' + encodeURIComponent(path)); closeModal(); ok('Deleted'); loadFiles(cwd); }
    catch (e) { err(e.message); }
  };
}
function renFile(path, name) {
  openModal(`<button class="x" data-close>&times;</button><h3>Rename</h3>
    <div class="field"><label>New name</label><input id="rnName" value="${esc(name)}"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button>
    <button class="btn pri" id="rnGo">Rename</button></div>`);
  $('#rnGo').onclick = async () => {
    const nn = $('#rnName').value.trim(); if (!nn) return;
    const to = cwd + '/' + nn;
    try { await post('/api/files/rename', { from: path, to }); closeModal(); ok('Renamed'); loadFiles(cwd); }
    catch (e) { err(e.message); }
  };
}

/* ------------ terminal ------------ */
const termOut = $('#termOut'), termIn = $('#termIn');
function termWrite(html) { termOut.insertAdjacentHTML('beforeend', html); termOut.scrollTop = termOut.scrollHeight; }
termIn.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const cmd = termIn.value.trim(); if (!cmd) return;
  termIn.value = '';
  termWrite(`\n<span class="cmd">$ ${esc(cmd)}</span>\n`);
  try {
    const r = await post('/api/exec', { cmd, cwd });
    if (r.stdout) termWrite(esc(r.stdout));
    if (r.stderr) termWrite(`<span class="err">${esc(r.stderr)}</span>`);
    if (r.code) termWrite(`<span class="err">[exit ${r.code}]</span>\n`);
  } catch (er) { termWrite(`<span class="err">${esc(er.message)}</span>\n`); }
});

/* ------------ settings ------------ */
$('#pwSave').onclick = async () => {
  const current = $('#pwCur').value, next = $('#pwNew').value;
  if (!current || !next) return err('Fill both fields');
  try { await post('/api/settings/password', { current, next }); ok('Password updated'); $('#pwCur').value = $('#pwNew').value = ''; }
  catch (e) { err(e.message); }
};
$('#portSave').onclick = async () => {
  const port = parseInt($('#portVal').value, 10);
  try { const r = await post('/api/settings/port', { port }); ok(r.note || 'Port saved'); }
  catch (e) { err(e.message); }
};

let serverIp = '';
loaders.settings = async () => {
  try {
    const st = await get('/api/settings/domain');
    serverIp = st.serverIp || '';
    $('#portVal').value = st.port || '';
    if (st.configured) {
      $('#domVal').value = st.domain;
      $('#domStatus').innerHTML =
        `Current: <b>${esc(st.host)}</b> ` +
        (st.ssl ? '<span class="badge on">HTTPS active</span>' : '<span class="badge off">no SSL yet</span>') +
        `<br>A record needed: <code>${esc(st.host)} &rarr; ${esc(serverIp || 'your-server-ip')}</code>`;
    } else {
      $('#domStatus').innerHTML =
        `No domain set. Create an A record <code>vpanel.&lt;yourdomain&gt; &rarr; ${esc(serverIp || 'your-server-ip')}</code>, then save.`;
    }
  } catch (e) { $('#domStatus').textContent = e.message; }
};

/* ------------ license ------------ */
function licFmtDate(u) { return u ? new Date(u * 1000).toLocaleDateString() : '—'; }
function licRemaining(u) {
  if (!u) return null;
  const secs = u - Math.floor(Date.now() / 1000);
  if (secs <= 0) return { txt: 'expired', days: 0, label: 'subscription ended' };
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  if (d >= 1) return { txt: d + (d === 1 ? ' day' : ' days'), days: d, label: 'remaining' };
  const m = Math.floor((secs % 3600) / 60);
  return { txt: h + 'h ' + m + 'm', days: 0, label: 'remaining' };
}
loaders.license = async () => {
  try {
    const L = await get('/api/license');
    $('#licBadge').innerHTML = L.licensed
      ? '<span class="badge on">● active</span>'
      : '<span class="badge off">● inactive</span>';
    const rem = licRemaining(L.licExp);
    if (L.scope === 'app' || L.scope === 'universal' || L.type === 'permanent') {
      if (!L.licExp) { // permanent / no expiry
        $('#licCountdown').textContent = '∞';
        $('#licCountLabel').textContent = L.licensed ? 'permanent license' : 'no active license';
        $('#licBarFill').style.width = L.licensed ? '100%' : '0';
      } else {
        $('#licCountdown').textContent = rem ? rem.txt : '—';
        $('#licCountLabel').textContent = rem ? rem.label : 'remaining';
        // bar relative to a 30-day window for a quick visual
        const pct = rem ? Math.max(4, Math.min(100, Math.round((rem.days / 30) * 100))) : 0;
        $('#licBarFill').style.width = pct + '%';
        $('#licBarFill').style.background = rem && rem.days <= 3 ? 'var(--danger)' : 'var(--accent)';
      }
    } else {
      $('#licCountdown').textContent = L.licensed ? '∞' : '—';
      $('#licCountLabel').textContent = L.licensed ? 'active' : 'no active license';
      $('#licBarFill').style.width = L.licensed ? '100%' : '0';
    }
    const rows = [
      ['Status', L.licensed ? 'Active' : 'Inactive'],
      ['Key', L.keyMasked || '—'],
      ['Scope', (L.scope || (L.app ? 'app' : 'universal')) + (L.app ? ' (' + L.app + ')' : '')],
      ['Type', L.type || '—'],
      ['Subscription ends', licFmtDate(L.licExp)],
      ['Offline grace until', licFmtDate(L.tokenExp)],
      ['Machine ID', L.machineId || '—'],
    ];
    $('#licDetails').innerHTML = rows.map((r) =>
      `<div class="stat"><span class="k">${r[0]}</span><span class="v">${esc(String(r[1]))}</span></div>`).join('') +
      (L.configured ? '' : `<div class="stat"><span class="k">Config</span><span class="v" style="color:var(--danger)">AKMS public key not set</span></div>`);
    $('#licOff').style.display = L.licensed ? '' : 'none';
  } catch (e) { $('#licDetails').textContent = e.message; }
};
$('#licRefresh').onclick = async () => {
  const b = $('#licRefresh'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Checking';
  try { await post('/api/license/refresh', {}); ok('License re-checked'); loaders.license(); }
  catch (e) { err(e.message); }
  finally { b.disabled = false; b.textContent = 'Re-check now'; }
};
$('#licOff').onclick = async () => {
  if (!confirm('Deactivate the license on this machine? The panel will lock until you activate again.')) return;
  try { await post('/api/license/deactivate', {}); location.href = '/setup'; }
  catch (e) { err(e.message); }
};
$('#licReplace').onclick = async () => {
  const key = $('#licNewKey').value.trim();
  const m = $('#licReplaceMsg'); m.style.color = '';
  if (!key) { m.style.color = 'var(--danger)'; m.textContent = 'Enter a license key.'; return; }
  const b = $('#licReplace'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Activating';
  try {
    const r = await post('/api/license/activate', { licenseKey: key });
    if (r.valid) { m.style.color = 'var(--ok)'; m.textContent = 'New license active ✓'; $('#licNewKey').value = ''; loaders.license(); }
    else { m.style.color = 'var(--danger)'; m.textContent = (r.message || r.error || 'Activation failed') + ' (' + (r.error || '?') + ')'; }
  } catch (e) { m.style.color = 'var(--danger)'; m.textContent = e.message; }
  finally { b.disabled = false; b.textContent = 'Activate new key'; }
};
$('#domCheck').onclick = async () => {
  const domain = $('#domVal').value.trim().toLowerCase();
  if (!domain) return err('Enter your domain first');
  $('#domStatus').innerHTML = '<span class="spin"></span> Checking DNS&hellip;';
  try {
    const r = await get('/api/settings/dns?domain=' + encodeURIComponent(domain));
    $('#domStatus').innerHTML = r.ok
      ? `<span class="badge on">DNS OK</span> ${esc(r.host)} points to this server (${esc(r.serverIp)}). Ready to secure.`
      : `<span class="badge off">not linked</span> ${esc(r.host)} resolves to ${r.ips.length ? '<code>' + esc(r.ips.join(', ')) + '</code>' : 'nothing'}; expected <code>${esc(r.serverIp || '?')}</code>.`;
  } catch (e) { err(e.message); }
};
$('#domSave').onclick = async () => {
  const domain = $('#domVal').value.trim().toLowerCase();
  const email = $('#domEmail').value.trim();
  if (!domain) return err('Enter your domain');
  const b = $('#domSave'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Setting up&hellip;';
  $('#domStatus').innerHTML = '<span class="spin"></span> Configuring nginx and requesting a certificate&hellip;';
  try {
    const r = await post('/api/settings/domain', { domain, email });
    if (r.ssl) ok('Panel secured at https://' + r.host);
    else toast('Domain set (HTTP). SSL pending' + (r.sslError ? ': ' + r.sslError : ''), 'err');
    loaders.settings();
  } catch (e) { err(e.message); $('#domStatus').textContent = e.message; }
  finally { b.disabled = false; b.textContent = 'Save & secure'; }
};

/* phpMyAdmin: served by nginx (port 80/443), not the node app */
$('#pmaBtn').onclick = () => {
  const l = window.location;
  const onProxy = (l.port === '' || l.port === '80' || l.port === '443');
  const base = onProxy ? l.origin : (l.protocol + '//' + l.hostname);
  window.open(base + '/phpmyadmin/', '_blank', 'noopener');
};

/* ------------ boot ------------ */
async function boot() {
  try {
    const o = await get('/api/system/overview');
    $('#host').textContent = o.hostname;
    $('#osPill').textContent = o.os + '  \u2022  node ' + o.node;
    $('#dashLead').textContent = o.model + '  \u2022  ' + o.cores + ' cores  \u2022  ' + o.arch;
    $('#sysInfo').innerHTML = [
      ['Hostname', o.hostname], ['OS', o.os], ['Kernel', o.kernel],
      ['Arch', o.arch], ['CPU', o.model], ['Node', o.node], ['Panel', 'v' + o.panel]
    ].map((r) => `<div class="stat"><span class="k">${r[0]}</span><span class="v">${esc(r[1])}</span></div>`).join('');
  } catch (e) { /* unauth -> redirected */ }

  loaders.dash();

  const socket = io();
  socket.on('stats', renderStats);
  socket.on('connect_error', () => {});
  socket.on('locked', () => { location.href = '/setup'; });

  // License heartbeat: if the license goes inactive while a tab is open, lock it.
  setInterval(async () => {
    try {
      const r = await fetch('/api/setup/status');
      const s = await r.json();
      if (s && s.needsLicense) location.href = '/setup';
    } catch (e) { /* ignore transient errors */ }
  }, 60000);
}
boot();
