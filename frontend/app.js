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
  const svg = document.getElementById('cpu-chart');
  const w = 300, h = 100, pad = 2;
  const max = 100;
  const points = history.map((v, i) => {
    const x = (i / (CHART_POINTS - 1)) * (w - pad * 2) + pad;
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');

  svg.innerHTML = `
    <defs>
      <linearGradient id="cpu-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polyline fill="url(#cpu-grad)" stroke="none"
      points="${w - pad},${h - pad} ${points} ${pad},${h - pad}"/>
    <polyline fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
      points="${points}"/>
  `;
}

function formatStats(data) {
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
