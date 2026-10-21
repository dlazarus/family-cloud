'use strict';

// ---------- index: login / setup + hub de servicios ----------

const SERVICES = [
  { icon: '🗓️', name: 'Calendario', desc: 'Eventos compartidos de toda la familia.', href: '/calendario' },
  { icon: '🔑', name: 'Contraseñas', desc: 'Tu gestor personal de contraseñas.', href: '/contrasenhas', soon: true },
];

async function boot() {
  try {
    const me = await api('/me');
    await showHub(me);
  } catch {
    const { needsSetup } = await api('/status');
    showGate(needsSetup);
  }
}

function showGate(needsSetup) {
  $('#gate').classList.remove('hidden');
  $('#app').classList.add('hidden');
  if (needsSetup) {
    $('#gate-title').textContent = 'Bienvenida a Family Cloud';
    $('#gate-sub').textContent = 'Es la primera vez: crea la cuenta de administrador (usuario "admin") con la contraseña que elijáis.';
    $('#setup-form').classList.remove('hidden');
    $('#login-form').classList.add('hidden');
  } else {
    $('#setup-form').classList.add('hidden');
    $('#login-form').classList.remove('hidden');
  }
}

async function showHub(me) {
  $('#gate').classList.add('hidden');
  $('#app').classList.remove('hidden');
  initTopbar(me);
  $('#hub').innerHTML = SERVICES.map((s) => {
    const inner = `<div class="icon">${s.icon}</div><h3>${s.name}</h3><p class="muted">${s.desc}</p>`;
    if (s.soon) return `<div class="service-card disabled">${inner}<span class="soon-badge">próximamente</span></div>`;
    return `<a class="service-card" href="${s.href}">${inner}</a>`;
  }).join('');
}

// ---------- gate: login / setup ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const me = await api('/login', { method: 'POST', body: { username: $('#login-user').value, password: $('#login-pass').value } });
    await showHub(me);
  } catch (err) { gateError(err); }
});

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = $('#setup-pass').value;
  if (p !== $('#setup-pass2').value) return gateError(new Error('Las contraseñas no coinciden.'));
  try {
    const me = await api('/setup', { method: 'POST', body: { username: $('#setup-user').value, password: p } });
    await showHub(me);
  } catch (err) { gateError(err); }
});

function gateError(err) {
  const el = $('#gate-error');
  el.textContent = err.message;
  el.classList.remove('hidden');
}

boot();
