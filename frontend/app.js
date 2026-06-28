const API = '/api/v1';
const CHART_POINTS = 30;

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
  if (openWindows[id]) { focusWindow(id); return; }

  const ws = document.getElementById('desktop-workspace');
  const win = document.createElement('div');
  win.className = 'win';
  win.id = 'win-' + id;
  win.style.zIndex = ++winZIndex;

  // Position with slight random offset for multiple windows
  const count = Object.keys(openWindows).length;
  win.style.left = (40 + count * 24) + 'px';
  win.style.top = (30 + count * 20) + 'px';

  win.innerHTML = `
    <div class="win-header">
      <span class="win-title">${title}</span>
      <button class="win-close" data-win="${id}">✕</button>
    </div>
    <div class="win-body"></div>`;

  win.querySelector('.win-close').addEventListener('click', () => closeWindow(id));
  win.addEventListener('mousedown', () => focusWindow(id));
  ws.appendChild(win);

  // Taskbar item
  const taskItems = document.getElementById('task-items');
  const taskBtn = document.createElement('button');
  taskBtn.className = 'task-item active';
  taskBtn.textContent = title;
  taskBtn.addEventListener('click', () => {
    if (openWindows[id]) focusWindow(id);
  });
  taskItems.appendChild(taskBtn);

  openWindows[id] = { win, taskBtn };
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
  openWindows[id].win.style.zIndex = ++winZIndex;
  Object.keys(openWindows).forEach(k => {
    const btn = openWindows[k].taskBtn;
    btn.classList.toggle('active', k === id);
  });
}

function loadContent(id) {
  const body = document.querySelector(`#win-${id} .win-body`);
  if (!body) return;
  if (id === 'taskmgr') renderTaskMgr(body);
  else if (id === 'apps') renderApps(body);
  else if (id === 'users') renderUsers(body);
  else if (id === 'subdomain') renderSubdomain(body);
  else if (id === 'www') renderWww(body);
}

/* ========== TASK MANAGER ========== */
function renderTaskMgr(body) {
  body.className = 'win-body tm-pad';
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

/* ========== APPLICATIONS ========== */
function renderApps(body) {
  body.innerHTML = '<div id="apps-list"></div><div id="apps-msg" class="msg"></div>';
  loadApps();
}

async function loadApps() {
  const el = document.getElementById('apps-list');
  if (!el) return;
  try {
    const apps = await api('/apps/status');
    el.innerHTML = apps.map(a => `
      <div class="app-item">
        <div class="app-info">
          <strong>${a.name}</strong>
          <span class="app-desc">${a.desc}${a.version ? ' · v' + a.version : ''}</span>
        </div>
        <div class="app-action">
          <span class="badge ${a.installed ? 'badge-yes' : 'badge-no'}">${a.installed ? a.version || 'Installed' : 'Not installed'}</span>
          ${!a.installed ? `<button class="btn btn-install" data-app="${a.id}">Install</button>` : ''}
        </div>
      </div>`).join('');
    el.querySelectorAll('.btn-install').forEach(b => b.addEventListener('click', async () => {
      msg('apps-msg', 'Installing...');
      try {
        const d = await api(`/apps/install/${b.dataset.app}`, { method: 'POST' });
        msg('apps-msg', d.message);
        setTimeout(loadApps, 4000);
      } catch (e) { msg('apps-msg', e.message, true); }
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

/* ========== WWW ========== */
function renderWww(body) {
  body.className = 'win-body win-content';
  body.innerHTML = `
    <div id="www-list"></div>
    <div class="form-row" style="margin-top:0.75rem;">
      <input type="text" id="www-name" placeholder="Folder name">
      <button class="btn" id="www-btn">Create</button>
    </div>
    <div id="www-msg" class="msg"></div>`;
  document.getElementById('www-btn').addEventListener('click', async () => {
    const name = document.getElementById('www-name').value;
    try {
      await api('/www', { method: 'POST', body: JSON.stringify({ name }) });
      msg('www-msg', `Folder ${name} created`);
      document.getElementById('www-name').value = '';
      loadWww();
    } catch (e) { msg('www-msg', e.message, true); }
  });
  loadWww();
}

async function loadWww() {
  const el = document.getElementById('www-list');
  if (!el) return;
  try {
    const data = await api('/www');
    el.innerHTML = data.items.length
      ? data.items.map(i => `<div class="www-row">${i.is_dir ? '📁' : '📄'} ${i.name}</div>`).join('')
      : '<div class="www-empty">Empty</div>';
  } catch {}
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

    // System tray
    document.getElementById('task-cpu').textContent = `CPU ${data.cpu}%`;
    document.getElementById('task-ram').textContent = `RAM ${data.ram_percent}%`;

    // Task Manager window
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

// Desktop right-click context menu
const ws = document.getElementById('desktop-workspace');
const ctxMenu = document.getElementById('desktop-menu');
let ctxOpen = false;

ws.addEventListener('contextmenu', (e) => {
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

// Enter key on login
document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

init();
