const API = '/api/v1';
const CHART_POINTS = 30;

let token = localStorage.getItem('token');
let cpuHistory = new Array(CHART_POINTS).fill(0);
let statsInterval;
let appsInterval;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  let data;
  try {
    data = await res.json();
  } catch {
    const text = await res.text();
    throw new Error(text || 'Request failed');
  }
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function show(id) {
  document.querySelectorAll('#auth-section > div, #dashboard').forEach(el => el.style.display = 'none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.getElementById(name).classList.add('active');
  if (name === 'tab-apps') loadApps();
  if (name === 'tab-users') loadUsers();
}

function bytesToGb(bytes) {
  return (bytes / (1024 ** 3)).toFixed(1);
}

function msg(id, text, isError) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg' + (isError ? ' error' : '');
}

/* ---- Chart ---- */
function drawCpuChart(history) {
  const canvas = document.getElementById('cpu-chart');
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.min(400, rect.width - 32) * dpr;
  const h = 130 * dpr;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = (w / dpr) + 'px';
  canvas.style.height = '100px';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const pad = 4 * dpr;
  const cw = w - pad * 2;
  const ch = h - pad * 2;

  const pts = history.map((v, i) => ({
    x: (i / (CHART_POINTS - 1)) * cw + pad,
    y: ch + pad - (v / 100) * ch
  }));

  // Gradient fill under curve
  ctx.beginPath();
  ctx.moveTo(pts[0].x, ch + pad);
  for (let i = 1; i < pts.length - 2; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.lineTo(last.x, ch + pad);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(245, 158, 11, 0.12)');
  grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.04)');
  grad.addColorStop(1, 'rgba(245, 158, 11, 0.01)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Smooth line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 2; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
  }
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2 * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  let parts = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  parts.push(m + 'm');
  return parts.join(' ');
}

function formatStats(data) {
  document.getElementById('uptime-val').textContent = formatUptime(data.uptime_seconds);
  document.getElementById('cpu-val').textContent = data.cpu + '%';
  document.getElementById('ram-val').textContent = data.ram_percent + '%';
  document.getElementById('ram-bar').style.width = data.ram_percent + '%';
  document.getElementById('ram-detail').textContent =
    bytesToGb(data.ram_used) + ' / ' + bytesToGb(data.ram_total) + ' GB';
  document.getElementById('swap-val').textContent = data.swap_percent + '%';
  document.getElementById('swap-bar').style.width = data.swap_percent + '%';
  document.getElementById('swap-detail').textContent =
    bytesToGb(data.swap_used) + ' / ' + bytesToGb(data.swap_total) + ' GB';
  document.getElementById('disk-val').textContent = data.disk_percent + '%';
  document.getElementById('disk-bar').style.width = data.disk_percent + '%';
  cpuHistory.push(data.cpu);
  cpuHistory.shift();
  drawCpuChart(cpuHistory);
}

async function fetchStats() {
  try {
    formatStats(await api('/system/stats'));
  } catch {}
}

/* ---- Apps ---- */
async function loadApps() {
  try {
    const apps = await api('/apps/status');
    const el = document.getElementById('app-list');
    el.textContent = '';
    for (const app of apps) {
      const item = document.createElement('div');
      item.className = 'app-item';
      item.innerHTML = `
        <div class="app-info">
          <strong>${app.name}</strong>
          <span class="app-desc">${app.desc}${app.version ? ' · v' + app.version : ''}</span>
        </div>
        <div class="app-action">
          <span class="badge badge-${app.installed ? 'yes' : 'no'}">${app.installed ? app.version || 'Installed' : 'Not installed'}</span>
          ${!app.installed ? `<button class="btn btn-sm" data-app="${app.id}">Install</button>` : ''}
        </div>`;
      el.appendChild(item);
    }
    el.querySelectorAll('[data-app]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appId = btn.dataset.app;
        msg('app-msg', `Installing ${appId}...`);
        try {
          const data = await api(`/apps/install/${appId}`, { method: 'POST' });
          msg('app-msg', data.message);
          setTimeout(loadApps, 5000);
        } catch (e) {
          msg('app-msg', e.message, true);
        }
      });
    });
  } catch {}
}

/* ---- WWW ---- */
async function loadWww() {
  try {
    const data = await api('/www');
    const el = document.getElementById('www-list');
    el.textContent = '';
    if (!data.items.length) {
      el.innerHTML = '<div class="www-empty">Empty</div>';
      return;
    }
    for (const item of data.items) {
      const row = document.createElement('div');
      row.className = 'www-row';
      row.innerHTML = `<span>${item.is_dir ? '📁' : '📄'} ${item.name}</span>`;
      el.appendChild(row);
    }
  } catch {}
}

/* ---- Users ---- */
async function loadUsers() {
  try {
    const users = await api('/auth/users');
    const el = document.getElementById('user-list');
    el.textContent = '';
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `<span>${u.username}</span><span class="badge badge-${u.role}">${u.role}</span>`;
      el.appendChild(row);
    }
  } catch {}
}

/* ---- Init ---- */
async function init() {
  try {
    const check = await api('/auth/check');
    if (token) {
      try {
        const me = await api('/auth/me');
        return enterDashboard(me);
      } catch { localStorage.removeItem('token'); token = null; }
    }
    if (!check.admin_exists) show('register-form');
    else show('login-form');
  } catch {
    document.getElementById('register-form').style.display = 'block';
  }
}

async function enterDashboard(user) {
  show('dashboard');
  document.getElementById('user-info').textContent = `${user.username} · ${user.role}`;
  if (user.role === 'admin') {
    document.getElementById('tab-users-btn').style.display = 'inline-block';
  }
  activateTab('tab-dashboard');
  cpuHistory = new Array(CHART_POINTS).fill(0);
  await fetchStats();
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(fetchStats, 3000);
  window.addEventListener('resize', () => drawCpuChart(cpuHistory));
}

/* ---- Events ---- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
});

document.querySelectorAll('.pw-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const open = btn.querySelector('.eye-open');
    const closed = btn.querySelector('.eye-closed');
    if (input.type === 'password') {
      input.type = 'text';
      open.style.display = 'none';
      closed.style.display = 'block';
    } else {
      input.type = 'password';
      open.style.display = 'block';
      closed.style.display = 'none';
    }
  });
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
  } catch (e) { msg('reg-error', e.message, true); }
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = data.access_token;
    localStorage.setItem('token', token);
    enterDashboard(await api('/auth/me'));
  } catch (e) { msg('login-error', e.message, true); }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('token');
  token = null;
  if (statsInterval) clearInterval(statsInterval);
  location.reload();
});

document.getElementById('add-user-btn').addEventListener('click', async () => {
  const username = document.getElementById('new-username').value;
  const email = document.getElementById('new-email').value;
  const password = document.getElementById('new-password').value;
  try {
    await api('/auth/users', { method: 'POST', body: JSON.stringify({ username, email, password, role: 'user' }) });
    msg('add-user-error', `User ${username} created`);
    document.getElementById('new-username').value = '';
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    loadUsers();
  } catch (e) { msg('add-user-error', e.message, true); }
});

document.getElementById('www-btn').addEventListener('click', async () => {
  const name = document.getElementById('www-name').value;
  try {
    await api('/www', { method: 'POST', body: JSON.stringify({ name }) });
    msg('www-msg', `Folder ${name} created`);
    document.getElementById('www-name').value = '';
    loadWww();
  } catch (e) { msg('www-msg', e.message, true); }
});

document.getElementById('sub-btn').addEventListener('click', async () => {
  const subdomain = document.getElementById('sub-name').value;
  const domain = document.getElementById('sub-domain').value;
  try {
    const data = await api('/subdomain', { method: 'POST', body: JSON.stringify({ subdomain, domain }) });
    msg('sub-msg', data.message);
  } catch (e) { msg('sub-msg', e.message, true); }
});

init();
