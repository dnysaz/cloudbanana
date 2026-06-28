const API = '/api/v1';
const CHART_POINTS = 30;
const WIN_SIZES = {
  taskmgr: { w: 580, h: 380 },
  apps: { w: 500, h: 440 },
  users: { w: 440, h: 400 },
  subdomain: { w: 420, h: 260 },
  www: { w: 740, h: 500 },
  terminal: { w: 700, h: 420 },
  wget: { w: 460, h: 300 },
};

const APP_ICONS = {
  docker: 'docker', nginx: 'nginx', apache: 'apache',
  php: 'php', python: 'python', nodejs: 'nodedotjs',
  phpmyadmin: 'phpmyadmin', certbot: 'certbot',
  mysql: 'mysql', redis: 'redis',
};

const WALLPAPERS = [
  { id: 'purple', type: 'color', name: 'Deep Purple', value: '#0f0d1a' },
  { id: 'slate', type: 'color', name: 'Slate', value: '#1e293b' },
  { id: 'navy', type: 'color', name: 'Navy', value: '#0f172a' },
  { id: 'warm', type: 'color', name: 'Warm Gray', value: '#1c1917' },
  { id: 'teal', type: 'color', name: 'Teal Dark', value: '#0f1a1a' },
  { id: 'mtn', type: 'image', name: 'Mountains',
    value: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80' },
  { id: 'forest', type: 'image', name: 'Forest',
    value: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&q=80' },
  { id: 'lake', type: 'image', name: 'Mountain Lake',
    value: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1920&q=80' },
];

let token = localStorage.getItem('token');
let cpuHistory = new Array(CHART_POINTS).fill(0);
let statsInterval, clockInterval;
let winZIndex = 100;
let openWindows = {};
let startMenuOpen = false;

/* ========== API ========== */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  let data;
  try { data = await res.json(); }
  catch { const text = await res.text(); throw new Error(text || 'Request failed'); }
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function bytesToGb(bytes) { return (bytes / (1024 ** 3)).toFixed(1); }

/* ========== WINDOW MANAGER ========== */
function openWindow(id, title) {
  if (openWindows[id]) {
    if (openWindows[id].minimized) {
      openWindows[id].minimized = false;
      openWindows[id].win.style.display = 'flex';
      focusWindow(id);
    } else {
      focusWindow(id);
    }
    return;
  }

  const ws = document.getElementById('desktop-workspace');
  const win = document.createElement('div');
  win.className = 'win';
  win.id = 'win-' + id;
  win.style.zIndex = ++winZIndex;

  const count = Object.keys(openWindows).length;
  const sz = WIN_SIZES[id] || { w: 420, h: 320 };
  win.style.left = Math.min(40 + count * 24, window.innerWidth - sz.w - 20) + 'px';
  win.style.top = Math.min(30 + count * 20, window.innerHeight - sz.h - 60) + 'px';
  win.style.width = sz.w + 'px';
  win.style.height = sz.h + 'px';

  win.innerHTML = `
    <div class="win-header">
      <span class="win-title">${title}</span>
      <div class="win-actions">
        <button class="win-btn win-min" data-win="${id}">─</button>
        <button class="win-btn win-max" data-win="${id}">□</button>
        <button class="win-btn win-close" data-win="${id}">✕</button>
      </div>
    </div>
    <div class="win-body"></div>`;

  win.querySelector('.win-close').addEventListener('click', () => closeWindow(id));
  win.querySelector('.win-min').addEventListener('click', (e) => { e.stopPropagation(); minimizeWindow(id); });
  win.querySelector('.win-max').addEventListener('click', (e) => { e.stopPropagation(); maximizeWindow(id); });
  win.addEventListener('mousedown', () => focusWindow(id));

  // Drag
  const header = win.querySelector('.win-header');
  let dragging = false, dragOff = {};
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.win-actions')) return;
    focusWindow(id);
    dragging = true;
    dragOff = { x: e.clientX - win.offsetLeft, y: e.clientY - win.offsetTop };
    win.classList.add('win-dragging');
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    win.style.left = Math.max(0, e.clientX - dragOff.x) + 'px';
    win.style.top = Math.max(0, e.clientY - dragOff.y) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; win.classList.remove('win-dragging'); }
  });

  ws.appendChild(win);

  // Taskbar item
  const taskItems = document.getElementById('task-items');
  const taskBtn = document.createElement('button');
  taskBtn.className = 'task-item active';
  taskBtn.textContent = title;
  taskBtn.addEventListener('click', () => {
    if (!openWindows[id]) return;
    if (openWindows[id].minimized) {
      openWindows[id].minimized = false;
      openWindows[id].win.style.display = 'flex';
    }
    focusWindow(id);
  });
  taskItems.appendChild(taskBtn);

  openWindows[id] = { win, taskBtn, minimized: false, maximized: false, restore: null };
  loadContent(id);
}

function closeWindow(id) {
  if (!openWindows[id]) return;
  openWindows[id].win.remove();
  openWindows[id].taskBtn.remove();
  delete openWindows[id];
}

function focusWindow(id) {
  if (!openWindows[id]) return;
  if (openWindows[id].minimized) return;
  openWindows[id].win.style.zIndex = ++winZIndex;
  Object.keys(openWindows).forEach(k => {
    const btn = openWindows[k].taskBtn;
    btn.classList.toggle('active', k === id);
  });
}

function minimizeWindow(id) {
  if (!openWindows[id]) return;
  openWindows[id].minimized = true;
  openWindows[id].win.style.display = 'none';
  openWindows[id].taskBtn.classList.remove('active');
  // Focus next available window
  const ids = Object.keys(openWindows).filter(k => !openWindows[k].minimized);
  if (ids.length) focusWindow(ids[ids.length - 1]);
}

function maximizeWindow(id) {
  if (!openWindows[id]) return;
  const state = openWindows[id];
  if (state.maximized) {
    const r = state.restore;
    state.win.style.left = r.x + 'px';
    state.win.style.top = r.y + 'px';
    state.win.style.width = r.w + 'px';
    state.win.style.height = r.h + 'px';
    state.maximized = false;
    state.win.querySelector('.win-max').textContent = '□';
    state.win.querySelector('.win-max').classList.remove('win-max-active');
  } else {
    state.restore = {
      x: state.win.offsetLeft, y: state.win.offsetTop,
      w: state.win.offsetWidth, h: state.win.offsetHeight,
    };
    state.win.style.left = '0px';
    state.win.style.top = '0px';
    state.win.style.width = '100%';
    state.win.style.height = '100%';
    state.maximized = true;
    state.win.querySelector('.win-max').textContent = '❐';
    state.win.querySelector('.win-max').classList.add('win-max-active');
  }
}

function loadContent(id) {
  const body = document.querySelector(`#win-${id} .win-body`);
  if (!body) return;
  if (id === 'taskmgr') renderTaskMgr(body);
  else if (id === 'apps') renderApps(body);
  else if (id === 'users') renderUsers(body);
  else if (id === 'subdomain') renderSubdomain(body);
  else if (id === 'www') renderFiles(body);
  else if (id === 'terminal') renderTerminal(body);
  else if (id === 'wget') renderWget(body);
}

/* ========== TASK MANAGER ========== */
function renderTaskMgr(body) {
  body.innerHTML = `
    <div class="tm-grid">
      <div class="tm-left">
        <div class="tm-cpu-label">
          <span>CPU</span>
          <span id="tm-cpu-val">0%</span>
        </div>
        <div class="tm-chart-wrap">
          <canvas id="tm-chart"></canvas>
        </div>
        <div class="tm-uptime">Uptime: <span id="tm-uptime">--</span></div>
      </div>
      <div class="tm-right">
        ${barHtml('Disk', 'tm-disk-val', 'tm-disk-bar', 'tm-disk')}
        ${barHtml('RAM', 'tm-ram-val', 'tm-ram-bar', 'tm-ram')}
        <div>
          <div class="tm-bar-label"><span>Swap</span><span id="tm-swap-val">0%</span></div>
          <div class="tm-bar-track"><div class="tm-bar-fill tm-swap" id="tm-swap-bar" style="width:0%"></div></div>
          <div class="tm-bar-detail" id="tm-swap-detail">0 / 0 GB</div>
        </div>
      </div>
    </div>`;
}

function barHtml(name, valId, barId, cls) {
  return `<div>
    <div class="tm-bar-label"><span>${name}</span><span id="${valId}">0%</span></div>
    <div class="tm-bar-track"><div class="tm-bar-fill ${cls}" id="${barId}" style="width:0%"></div></div>
  </div>`;
}

/* ========== SOFTWARE CENTER ========== */
function renderApps(body) {
  body.innerHTML = '<div id="apps-msg" class="msg" style="margin-bottom:0.5rem;"></div><div class="app-grid" id="apps-list"></div>';
  loadApps();
}

async function loadApps() {
  const el = document.getElementById('apps-list');
  if (!el) return;
  try {
    const apps = await api('/apps/status');
    el.innerHTML = apps.map(a => {
      const iconId = APP_ICONS[a.id];
      const iconUrl = iconId ? `https://cdn.simpleicons.org/${iconId}/32/a1a1aa` : '';
      return `<div class="app-card${a.installed ? ' app-installed' : ''}">
        <div class="app-card-icon">${iconUrl ? `<img src="${iconUrl}" alt="${a.name}" width="32" height="32">` : '📦'}</div>
        <div class="app-card-name">${a.name}</div>
        <div class="app-card-desc">${a.desc}</div>
        ${a.version ? `<div class="app-card-ver">v${a.version}</div>` : ''}
        ${a.installed ? '<div class="app-card-installed">✓ Installed</div>'
          : `<button class="btn-install-card" data-app="${a.id}">Install</button>`}
      </div>`;
    }).join('');
    el.querySelectorAll('.btn-install-card').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Installing...';
      try {
        const d = await api(`/apps/install/${b.dataset.app}`, { method: 'POST' });
        msg('apps-msg', d.message);
        setTimeout(loadApps, 4000);
      } catch (e) { msg('apps-msg', e.message, true); b.disabled = false; b.textContent = 'Install'; }
    }));
  } catch {}
}

/* ========== USERS ========== */
function renderUsers(body) {
  body.className = 'win-body win-content';
  body.innerHTML = `
    <input type="text" id="new-username" placeholder="Username">
    <input type="email" id="new-email" placeholder="Email">
    <input type="password" id="new-password" placeholder="Password">
    <button class="btn" id="add-user-btn">Add User</button>
    <div id="add-user-msg" class="msg"></div>
    <div style="margin-top:1rem;font-size:0.75rem;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.3px;">Existing Users</div>
    <div id="user-list" style="margin-top:0.5rem;"></div>`;
  document.getElementById('add-user-btn').addEventListener('click', addUser);
  loadUsers();
}

async function loadUsers() {
  const el = document.getElementById('user-list');
  if (!el) return;
  try {
    const users = await api('/auth/users');
    el.innerHTML = users.map(u =>
      `<div class="user-row"><span>${u.username}</span><span class="badge badge-${u.role}">${u.role}</span></div>`
    ).join('');
  } catch {}
}

async function addUser() {
  const username = document.getElementById('new-username').value;
  const email = document.getElementById('new-email').value;
  const password = document.getElementById('new-password').value;
  try {
    await api('/auth/users', { method: 'POST', body: JSON.stringify({ username, email, password, role: 'user' }) });
    msg('add-user-msg', `User ${username} created`);
    document.getElementById('new-username').value = '';
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    loadUsers();
  } catch (e) { msg('add-user-msg', e.message, true); }
}

/* ========== SUBDOMAIN ========== */
function renderSubdomain(body) {
  body.className = 'win-body win-content';
  body.innerHTML = `
    <div class="form-row">
      <input type="text" id="sub-name" placeholder="Subdomain (e.g. api)">
      <input type="text" id="sub-domain" placeholder="Domain (e.g. example.com)">
    </div>
    <button class="btn" id="sub-btn">Create Subdomain</button>
    <div id="sub-msg" class="msg"></div>`;
  document.getElementById('sub-btn').addEventListener('click', async () => {
    const subdomain = document.getElementById('sub-name').value;
    const domain = document.getElementById('sub-domain').value;
    try {
      const d = await api('/subdomain', { method: 'POST', body: JSON.stringify({ subdomain, domain }) });
      msg('sub-msg', d.message);
    } catch (e) { msg('sub-msg', e.message, true); }
  });
}

/* ========== TERMINAL ========== */
function renderTerminal(body) {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${location.host}/api/v1/terminal/ws`;
  body.innerHTML = '<div class="term-wrap" id="term-wrap"></div>';
  const wrap = document.getElementById('term-wrap');
  if (!window.Terminal) { wrap.innerHTML = '<div style="padding:1rem;color:#ef4444;">xterm.js not loaded</div>'; return; }

  const term = new Terminal({ cursorBlink: true, cursorStyle: 'block', fontSize: 13, fontFamily: "'Menlo','Fira Code',monospace", theme: { background: '#0d0d0d', foreground: '#e0e0e0', cursor: '#f59e0b' } });
  term.open(wrap);
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { term.focus(); };
  ws.onmessage = (e) => { term.write(new Uint8Array(e.data)); };
  ws.onclose = () => { term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n'); };
  term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });

  // Resize handler
  const resize = () => {
    try {
      const cols = Math.floor(wrap.clientWidth / 8.5);
      const rows = Math.floor(wrap.clientHeight / 18);
      term.resize(cols > 20 ? cols : 80, rows > 5 ? rows : 24);
    } catch {}
  };
  setTimeout(resize, 100);
  window.addEventListener('resize', resize);
}

/* ========== WGET ========== */
function renderWget(body) {
  body.className = 'win-body win-content';
  body.innerHTML = `
    <input class="wget-input" id="wget-url" placeholder="URL to download (e.g. https://example.com/file.zip)">
    <div class="form-row">
      <input class="wget-input" id="wget-dir" placeholder="Output directory" value="/root" style="margin-bottom:0;">
      <button class="btn" id="wget-btn">⬇ Download</button>
    </div>
    <pre class="wget-output" id="wget-output">Ready</pre>`;
  document.getElementById('wget-btn').addEventListener('click', async () => {
    const url = document.getElementById('wget-url').value;
    const dir = document.getElementById('wget-dir').value;
    const out = document.getElementById('wget-output');
    if (!url) return;
    out.textContent = 'Downloading...\n';
    document.getElementById('wget-btn').disabled = true;
    try {
      const data = await api('/wget', { method: 'POST', body: JSON.stringify({ url, dir }) });
      out.textContent = data.output || 'Download completed';
    } catch (e) { out.textContent = 'Error: ' + e.message; }
    document.getElementById('wget-btn').disabled = false;
  });
}

/* ========== FILE MANAGER ========== */
let fmPath = '/var/www';

const FM_QUICK = [
  { label: '/ (Root)', path: '/' },
  { label: '/home', path: '/home' },
  { label: '/var/www', path: '/var/www' },
  { label: '/etc', path: '/etc' },
  { label: '/tmp', path: '/tmp' },
];

function renderFiles(body) {
  body.innerHTML = `
    <div class="fm-toolbar">
      <input class="fm-path" id="fm-path" value="${fmPath}" spellcheck="false">
      <button class="fm-btn" id="fm-go">Go</button>
      <button class="fm-btn" id="fm-new-dir">+ Folder</button>
      <button class="fm-btn" id="fm-new-file">+ File</button>
    </div>
    <div class="fm-body">
      <div class="fm-sidebar" id="fm-sidebar"></div>
      <div class="fm-main" id="fm-main"></div>
    </div>`;
  renderSidebar();
  document.getElementById('fm-go').addEventListener('click', () => {
    fmPath = document.getElementById('fm-path').value || '/';
    loadFiles();
  });
  document.getElementById('fm-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('fm-go').click();
  });
  document.getElementById('fm-new-dir').addEventListener('click', () => promptNewDir());
  document.getElementById('fm-new-file').addEventListener('click', () => promptNewFile());
  loadFiles();
}

function renderSidebar() {
  const sb = document.getElementById('fm-sidebar');
  sb.innerHTML = FM_QUICK.map(l =>
    `<button data-path="${l.path}">${l.label}</button>`
  ).join('');
  sb.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      fmPath = b.dataset.path;
      document.getElementById('fm-path').value = fmPath;
      loadFiles();
    });
  });
}

async function loadFiles() {
  const main = document.getElementById('fm-main');
  if (!main) return;
  main.innerHTML = '<div style="padding:1rem;color:#71717a;font-size:0.85rem;">Loading...</div>';
  try {
    const data = await api('/files?path=' + encodeURIComponent(fmPath));
    fmPath = data.path;
    document.getElementById('fm-path').value = data.path;
    if (!data.items.length) {
      main.innerHTML = '<div style="padding:1rem;color:#71717a;font-size:0.8rem;">Empty folder</div>';
      return;
    }
    let html = '<div class="fm-header"><span>Name</span><span>Size</span><span>Modified</span><span></span></div>';
    data.items.forEach(item => {
      const icon = item.is_dir ? '📁' : '📄';
      const size = item.is_dir ? '—' : fmtSize(item.size);
      const date = item.modified ? fmtDate(item.modified) : '—';
      html += `<div class="fm-item">
        <span class="fm-item-name" data-path="${fmPath}/${item.name}" data-is-dir="${item.is_dir}">${icon} ${item.name}</span>
        <span class="fm-item-size">${size}</span>
        <span class="fm-item-date">${date}</span>
        <span class="fm-item-actions">
          <button class="fm-action del" data-path="${fmPath}/${item.name}" data-name="${item.name}" data-is-dir="${item.is_dir}">🗑</button>
        </span>
      </div>`;
    });
    main.innerHTML = html;

    main.querySelectorAll('.fm-item-name').forEach(el => {
      el.addEventListener('click', () => {
        const path = el.dataset.path;
        if (el.dataset.isDir === 'true') {
          fmPath = path;
          document.getElementById('fm-path').value = path;
          loadFiles();
        } else {
          openFileEditor(path);
        }
      });
    });
    main.querySelectorAll('.fm-action.del').forEach(el => {
      el.addEventListener('click', () => {
        showDeleteModal(el.dataset.path, el.dataset.name, el.dataset.isDir === 'true');
      });
    });
  } catch (e) { main.innerHTML = '<div style="padding:1rem;color:#ef4444;font-size:0.8rem;">Error: ' + e.message + '</div>'; }
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function promptNewDir() {
  const name = prompt('Folder name:');
  if (!name) return;
  const path = fmPath.replace(/\/$/, '') + '/' + name;
  try {
    await api('/files/mkdir', { method: 'POST', body: JSON.stringify({ path }) });
    loadFiles();
  } catch (e) { alert('Error: ' + e.message); }
}

async function promptNewFile() {
  const name = prompt('File name:');
  if (!name) return;
  const path = fmPath.replace(/\/$/, '') + '/' + name;
  try {
    await api('/files/write', { method: 'POST', body: JSON.stringify({ path, content: '' }) });
    loadFiles();
  } catch (e) { alert('Error: ' + e.message); }
}

function showDeleteModal(path, name, isDir) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">Delete ${isDir ? 'Folder' : 'File'}</div>
      <div class="modal-desc">Delete <strong>${name}</strong>? This action requires root password.</div>
      <input class="modal-input" type="password" id="modal-pw" placeholder="Root password" autocomplete="off">
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" id="modal-cancel">Cancel</button>
        <button class="modal-btn modal-btn-danger" id="modal-confirm">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const pw = overlay.querySelector('#modal-pw');
  setTimeout(() => pw.focus(), 100);

  const close = () => { overlay.remove(); };
  overlay.querySelector('#modal-cancel').addEventListener('click', close);
  overlay.querySelector('#modal-confirm').addEventListener('click', async () => {
    if (!pw.value) return;
    overlay.querySelector('#modal-confirm').disabled = true;
    overlay.querySelector('#modal-confirm').textContent = 'Deleting...';
    try {
      await api('/files/remove', { method: 'POST', body: JSON.stringify({ path, password: pw.value }) });
      close();
      loadFiles();
    } catch (e) {
      overlay.querySelector('#modal-confirm').disabled = false;
      overlay.querySelector('#modal-confirm').textContent = 'Delete';
      alert('Error: ' + e.message);
    }
  });
  pw.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('#modal-confirm').click();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

async function openFileEditor(path) {
  const main = document.getElementById('fm-main');
  if (!main) return;
  try {
    const data = await api('/files/read', { method: 'POST', body: JSON.stringify({ path }) });
    main.innerHTML = `
      <div class="fm-editor">
        <div class="fm-editor-toolbar">
          <span class="fm-editor-title">📄 ${path}</span>
          <button class="fm-btn" id="fm-editor-back">← Back</button>
          <button class="fm-btn" id="fm-editor-save">💾 Save</button>
        </div>
        <textarea id="fm-editor-text">${escHtml(data.content)}</textarea>
      </div>`;
    document.getElementById('fm-editor-back').addEventListener('click', loadFiles);
    document.getElementById('fm-editor-save').addEventListener('click', async () => {
      const content = document.getElementById('fm-editor-text').value;
      try {
        await api('/files/write', { method: 'POST', body: JSON.stringify({ path, content }) });
        alert('Saved!');
      } catch (e) { alert('Error: ' + e.message); }
    });
  } catch (e) { alert('Error: ' + e.message); }
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ========== WALLPAPER ========== */

function lighten(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16);
  return `rgb(${Math.min(255,(n>>16)+amt)},${Math.min(255,((n>>8)&255)+amt)},${Math.min(255,(n&255)+amt)})`;
}

function applyWallpaper(id) {
  const wp = WALLPAPERS.find(w => w.id === id);
  if (!wp) return;
  const el = document.getElementById('desktop-workspace');
  if (wp.type === 'color') {
    el.style.background = `radial-gradient(ellipse at 50% 30%, ${lighten(wp.value, 30)} 0%, ${wp.value} 70%)`;
    el.style.backgroundImage = '';
  } else {
    el.style.background = `url('${wp.value}') center/cover no-repeat`;
    el.style.setProperty('background-blend-mode', 'normal');
  }
  localStorage.setItem('cb-wallpaper', id);
}

function showWallpaperPicker() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box wp-picker">
      <div class="modal-title">Change Wallpaper</div>
      <div class="wp-section-label">Colors</div>
      <div class="wp-colors" id="wp-colors"></div>
      <div class="wp-section-label" style="margin-top:0.75rem;">Landscape</div>
      <div class="wp-images" id="wp-images"></div>
      <div class="modal-actions" style="margin-top:0.75rem;">
        <button class="modal-btn modal-btn-cancel" id="wp-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const c = document.getElementById('wp-colors');
  WALLPAPERS.filter(w => w.type === 'color').forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'wp-swatch'; btn.dataset.id = w.id; btn.title = w.name;
    btn.style.background = w.value;
    c.appendChild(btn);
  });

  const i = document.getElementById('wp-images');
  WALLPAPERS.filter(w => w.type === 'image').forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'wp-img-btn'; btn.dataset.id = w.id;
    btn.style.backgroundImage = `url('${w.value}')`;
    btn.innerHTML = `<span class="wp-img-label">${w.name}</span>`;
    i.appendChild(btn);
  });

  overlay.querySelectorAll('.wp-swatch, .wp-img-btn').forEach(el => {
    el.addEventListener('click', () => { applyWallpaper(el.dataset.id); overlay.remove(); });
  });
  overlay.querySelector('#wp-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

/* ========== STATS ========== */
function formatUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm';
}

function drawChart(history) {
  const canvas = document.getElementById('tm-chart');
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(100, rect.width) * dpr;
  const h = rect.height * dpr;
  canvas.width = w; canvas.height = h;
  canvas.style.width = (w / dpr) + 'px'; canvas.style.height = (h / dpr) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const pad = 4 * dpr, cw = w - pad * 2, ch = h - pad * 2;
  const pts = history.map((v, i) => ({
    x: (i / (CHART_POINTS - 1)) * cw + pad,
    y: ch + pad - (v / 100) * ch
  }));
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.moveTo(pts[0].x, ch + pad);
  ctx.lineTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 2; i++) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  ctx.lineTo(last.x, last.y); ctx.lineTo(last.x, ch + pad); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(245,158,11,0.15)'); grad.addColorStop(0.6, 'rgba(245,158,11,0.04)'); grad.addColorStop(1, 'rgba(245,158,11,0.01)');
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 2; i++) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2 * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}

async function fetchStats() {
  try {
    const data = await api('/system/stats');
    document.getElementById('task-cpu').textContent = `CPU ${data.cpu}%`;
    document.getElementById('task-ram').textContent = `RAM ${data.ram_percent}%`;
    const cpuEl = document.getElementById('tm-cpu-val');
    if (cpuEl) cpuEl.textContent = data.cpu + '%';
    ['ram','swap','disk'].forEach(k => {
      const val = document.getElementById(`tm-${k}-val`);
      if (val) val.textContent = data[`${k}_percent`] + '%';
      const bar = document.getElementById(`tm-${k}-bar`);
      if (bar) bar.style.width = data[`${k}_percent`] + '%';
    });
    const sd = document.getElementById('tm-swap-detail');
    if (sd) sd.textContent = `${bytesToGb(data.swap_used)} / ${bytesToGb(data.swap_total)} GB`;
    const ut = document.getElementById('tm-uptime');
    if (ut) ut.textContent = formatUptime(data.uptime_seconds);
    cpuHistory.push(data.cpu); cpuHistory.shift();
    drawChart(cpuHistory);
  } catch {}
}

/* ========== CLOCK ========== */
function updateClock() {
  const now = new Date();
  document.getElementById('task-clock').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ========== AUTH ========== */

function msg(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('error', 'show');
  if (text) el.classList.add('show');
  if (isError) el.classList.add('error');
}

async function init() {
  try {
    const check = await api('/auth/check');
    if (token) {
      try {
        const me = await api('/auth/me');
        return enterDesktop(me);
      } catch { localStorage.removeItem('token'); token = null; }
    }
    if (!check.admin_exists) {
      document.getElementById('register-form').style.display = 'block';
      document.getElementById('login-form').style.display = 'none';
    }
  } catch {
    // server down, show login anyway
  }
}

function enterDesktop(user) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('desktop').style.display = 'flex';
  if (user.role === 'admin') document.getElementById('start-users').style.display = 'flex';

  cpuHistory = new Array(CHART_POINTS).fill(0);
  const saved = localStorage.getItem('cb-wallpaper');
  if (saved) applyWallpaper(saved);
  openWindow('taskmgr', 'System Monitor');
  fetchStats();
  statsInterval = setInterval(fetchStats, 3000);
  updateClock();
  clockInterval = setInterval(updateClock, 10000);
}

/* ========== EVENT BINDINGS ========== */

document.getElementById('login-btn').addEventListener('click', async () => {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = data.access_token;
    localStorage.setItem('token', token);
    enterDesktop(await api('/auth/me'));
  } catch (e) { msg('login-error', e.message, true); }
});

document.getElementById('reg-btn').addEventListener('click', async () => {
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-password-confirm').value;
  if (password !== confirm) { msg('reg-error', 'Passwords do not match', true); return; }
  try {
    await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    msg('reg-error', 'Admin created! You can now login.');
    document.getElementById('reg-btn').disabled = true;
    setTimeout(() => {
      document.getElementById('register-form').style.display = 'none';
      document.getElementById('login-form').style.display = 'block';
    }, 2000);
  } catch (e) { msg('reg-error', e.message, true); }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('token'); token = null;
  if (statsInterval) clearInterval(statsInterval);
  if (clockInterval) clearInterval(clockInterval);
  location.reload();
});

// Pinned taskbar icons
document.querySelectorAll('.task-pinned').forEach(btn => {
  btn.addEventListener('click', () => openWindow(btn.dataset.win, btn.title));
});

// Start menu
document.getElementById('start-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('start-menu');
  startMenuOpen = !startMenuOpen;
  menu.style.display = startMenuOpen ? 'block' : 'none';
});

document.querySelectorAll('.start-item').forEach(item => {
  item.addEventListener('click', () => {
    document.getElementById('start-menu').style.display = 'none';
    startMenuOpen = false;
    if (item.id === 'start-logout') {
      document.getElementById('logout-btn').click();
      return;
    }
    openWindow(item.dataset.win, item.textContent.trim());
  });
});

document.addEventListener('click', (e) => {
  if (startMenuOpen && !e.target.closest('#start-menu') && !e.target.closest('#start-btn')) {
    document.getElementById('start-menu').style.display = 'none';
    startMenuOpen = false;
  }
});

// Desktop context menu
const deskWs = document.getElementById('desktop-workspace');
const ctxMenu = document.getElementById('desktop-menu');
let ctxOpen = false;

deskWs.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  ctxMenu.style.display = 'block';
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - w) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - h) + 'px';
  ctxOpen = true;
});

document.addEventListener('click', () => {
  if (ctxOpen) { ctxMenu.style.display = 'none'; ctxOpen = false; }
});

document.querySelectorAll('#desktop-menu .ctx-item[data-win]').forEach(item => {
  item.addEventListener('click', () => {
    ctxMenu.style.display = 'none'; ctxOpen = false;
    openWindow(item.dataset.win, item.textContent.trim());
  });
});

document.getElementById('ctx-show-desktop').addEventListener('click', () => {
  ctxMenu.style.display = 'none'; ctxOpen = false;
  for (const id in openWindows) closeWindow(id);
});

document.getElementById('ctx-reload').addEventListener('click', () => {
  ctxMenu.style.display = 'none'; ctxOpen = false;
  location.reload();
});

document.getElementById('ctx-wallpaper').addEventListener('click', () => {
  ctxMenu.style.display = 'none'; ctxOpen = false;
  showWallpaperPicker();
});

// Enter key on login
document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

init();
