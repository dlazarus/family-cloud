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
  // el control de variante de «Mi cuenta» (si la pagina lo tiene)
  const seg = $('#variant-seg');
  if (seg) {
    const stored = localStorage.getItem('theme') || '';
    for (const b of seg.querySelectorAll('button')) {
      const on = b.dataset.v === stored;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  applyPaletteWidgets();
}
function setVariant(v) { // '' = seguir al sistema
  if (v) localStorage.setItem('theme', v);
  else localStorage.removeItem('theme');
  applyTheme();
}

// ---------- paletas de color ----------
// El nombre va en <html data-palette="...">; 'default' = el tema clasico
// (sin atributo). La paleta por defecto para quien no haya elegido ninguna es 'mar'.
// Se guarda en localStorage: es una preferencia de este navegador, no de la cuenta.
const PALETTES = [
  { id: 'default', label: 'Clasico' },
  { id: 'rojo', label: 'Rojo' },
  { id: 'naranja', label: 'Naranja' },
  { id: 'amarillo', label: 'Amarillo' },
  { id: 'verde', label: 'Verde' },
  { id: 'azul', label: 'Azul' },
  { id: 'violeta', label: 'Violeta' },
  { id: 'mar', label: 'Mar (verde+azul)' },
  { id: 'neon', label: 'Neon' },
  { id: 'bw', label: 'Blanco y negro' },
  { id: 'sepia', label: 'Sepia' },
];
function effectivePalette() {
  const p = localStorage.getItem('palette') || 'mar';
  return PALETTES.some((x) => x.id === p) ? p : 'mar';
}
function applyPalette() {
  const p = effectivePalette();
  if (p === 'default') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = p;
}
function applyPaletteWidgets() {
  const grid = $('#pal-grid');
  if (!grid) return;
  const p = effectivePalette();
  for (const b of grid.querySelectorAll('.pal')) {
    const on = b.dataset.palette === p;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
function setPalette(id) {
  if (!PALETTES.some((x) => x.id === id)) return;
  if (id === 'mar') localStorage.removeItem('palette'); // mar = sin guardar (es el defecto)
  else localStorage.setItem('palette', id);
  applyPalette();
  applyPaletteWidgets();
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = $('#theme-toggle');
  if (btn) btn.addEventListener('click', () => setVariant(effectiveTheme() === 'dark' ? 'light' : 'dark'));
  const seg = $('#variant-seg');
  if (seg) seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) setVariant(b.dataset.v);
  });
  const grid = $('#pal-grid');
  if (grid) grid.addEventListener('click', (e) => {
    const b = e.target.closest('.pal');
    if (b) setPalette(b.dataset.palette);
  });
  applyPaletteWidgets();
});
mediaDark.addEventListener('change', () => {
  if (!localStorage.getItem('theme')) applyTheme(); // sin elección manual: seguir al sistema
});
applyPalette();
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
