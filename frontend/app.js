const API = '/api/v1';

let token = localStorage.getItem('token');

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
  } catch (e) {
    document.getElementById('register-form').querySelector('h2').textContent = 'Server Error';
    document.getElementById('register-form').querySelector('.subtitle').textContent = 'Could not connect to server. Make sure the backend is running.';
    show('register-form');
  }
}

async function enterDashboard(user) {
  show('dashboard');
  document.getElementById('user-info').textContent = `Logged in as ${user.username} (${user.role})`;
  if (user.role === 'admin') {
    document.getElementById('admin-panel').style.display = 'block';
    loadUsers();
  }
  fetchStats();
  setInterval(fetchStats, 5000);
}

async function fetchStats() {
  try {
    const data = await api('/system/stats');
    document.getElementById('cpu-usage').textContent = data.cpu_usage + '%';
    document.getElementById('ram-usage').textContent = data.ram_usage + '%';
    document.getElementById('disk-usage').textContent = data.disk_usage + '%';
  } catch {}
}

async function loadUsers() {
  try {
    const users = await api('/auth/users');
    const el = document.getElementById('user-list');
    el.textContent = '';
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'user-row';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = u.username;
      const badge = document.createElement('span');
      badge.className = 'badge badge-' + u.role;
      badge.textContent = u.role;
      row.appendChild(nameSpan);
      row.appendChild(badge);
      el.appendChild(row);
    }
  } catch {}
}

function msg(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg' + (isError ? ' error' : '');
}

document.getElementById('reg-btn').addEventListener('click', async () => {
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-password-confirm').value;
  if (password !== confirm) {
    msg('reg-error', 'Passwords do not match', true);
    return;
  }
  try {
    await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    msg('reg-error', 'Admin created! You can now login.');
    document.getElementById('reg-btn').disabled = true;
  } catch (e) {
    msg('reg-error', e.message, true);
  }
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = data.access_token;
    localStorage.setItem('token', token);
    const me = await api('/auth/me');
    enterDashboard(me);
  } catch (e) {
    msg('login-error', e.message, true);
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('token');
  token = null;
  location.reload();
});

document.getElementById('install-docker').addEventListener('click', async () => {
  msg('status-message', 'Installing Docker...');
  try {
    const data = await api('/apps/install/docker', { method: 'POST' });
    msg('status-message', data.message);
  } catch (e) {
    msg('status-message', e.message, true);
  }
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
  } catch (e) {
    msg('add-user-error', e.message, true);
  }
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

init();
