'use strict';

// ---------- utilidades compartidas por todas las páginas ----------
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && location.pathname !== '/') {
    location.replace('/'); // sesion caducada en pagina protegida -> volver al login
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- tema (sistema por defecto, alternable y persistente) ----------
const mediaDark = window.matchMedia('(prefers-color-scheme: dark)');

// Boton ojo en campos de contrasena: alterna visible/oculto (delegado, vale para todas las paginas)
document.addEventListener('click', (e) => {
  const eye = e.target.closest('.pw-eye');
  if (!eye) return;
  const inp = eye.closest('.pw-wrap')?.querySelector('input');
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  eye.textContent = show ? '🙈' : '👁';
  inp.focus();
});
function effectiveTheme() {
  return localStorage.getItem('theme') || (mediaDark.matches ? 'dark' : 'light');
}
function applyTheme() {
  const t = effectiveTheme();
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.documentElement.classList.toggle('light', t === 'light');
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}
document.addEventListener('DOMContentLoaded', () => {
  const btn = $('#theme-toggle');
  if (btn) btn.addEventListener('click', () => {
    localStorage.setItem('theme', effectiveTheme() === 'dark' ? 'light' : 'dark');
    applyTheme();
  });
});
mediaDark.addEventListener('change', () => {
  if (!localStorage.getItem('theme')) applyTheme(); // sin elección manual: seguir al sistema
});
applyTheme();

// ---------- páginas protegidas: sesión obligatoria ----------
async function requireUser() {
  try {
    return await api('/me');
  } catch {
    location.replace('/'); // sesión caducada o no iniciada -> login
    return null;
  }
}

function initTopbar(me) {
  $('#who').textContent = me.username + (me.role === 'admin' ? ' · admin' : '');
  $('#btn-logout').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* da igual */ }
    location.replace('/');
  });
}
