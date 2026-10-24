'use strict';

// ---------- gestor de contraseñas (vault) ----------

const state = {
  me: null,
  entries: [],
  editing: null,   // entrada en edición (null = nueva)
  query: '',
};

// ---------- arranque ----------
async function boot() {
  state.me = await requireUser();
  if (!state.me) return;
  initTopbar(state.me);
  await load();
}

async function load() {
  state.entries = await api('/vault');
  // orden alfabetico por sitio (por defecto), ignorando mayuscululas y acentos
  state.entries.sort((a, b) => a.site.localeCompare(b.site, 'es', { sensitivity: 'base' }));
  render();
}

// ---------- lista ----------
function render() {
  const q = state.query.trim().toLowerCase();
  const items = state.entries.filter((e) =>
    !q || e.site.toLowerCase().includes(q) || e.login.toLowerCase().includes(q)
  );
  $('#vault-empty').classList.toggle('hidden', items.length > 0);
  $('#vault-list').innerHTML = items.map((e) => `
    <div class="vault-item" data-id="${e.id}">
      <div class="vault-main">
        <div class="vault-site">${escapeHtml(e.site)}</div>
        <div class="vault-login muted"><span class="login-text">${escapeHtml(e.login)}</span><button data-act="copy-login" class="icon-btn" title="Copiar nombre de acceso">📋</button></div>
      </div>
      <code class="vault-pass" data-pass="${escapeHtml(e.password)}">••••••••</code>
      <div class="vault-actions">
        <button data-act="show" class="icon-btn" title="Mostrar/ocultar contraseña">👁</button>
        <button data-act="copy" class="icon-btn" title="Copiar contraseña">📋</button>
        <button data-act="edit" class="icon-btn" title="Editar">✏️</button>
        <button data-act="del" class="icon-btn danger" title="Eliminar">🗑</button>
      </div>
    </div>`).join('');
}

$('#vault-search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
$('#vault-new').addEventListener('click', () => openModal(null));

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // http en LAN (no localhost): fallback con execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

$('#vault-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const item = btn.closest('.vault-item');
  const entry = state.entries.find((x) => x.id === Number(item.dataset.id));
  if (!entry) return;
  const act = btn.dataset.act;
  if (act === 'show') {
    const code = item.querySelector('.vault-pass');
    const shown = code.classList.toggle('revealed');
    code.textContent = shown ? entry.password : '••••••••';
  } else if (act === 'copy') {
    if (await copyText(entry.password)) {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋'; }, 1200);
    }
  } else if (act === 'copy-login') {
    if (await copyText(entry.login)) {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋'; }, 1200);
    }
  } else if (act === 'edit') {
    openModal(entry);
  } else if (act === 'del') {
    if (!confirm(`¿Eliminar la contraseña de "${entry.site}"?`)) return;
    try { await api(`/vault/${entry.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { vaultError(err.message); }
  }
});

// ---------- modal crear/editar ----------
function openModal(entry) {
  state.editing = entry || null;
  $('#vault-modal-title').textContent = entry ? 'Editar contraseña' : 'Nueva contraseña';
  $('#v-site').value = entry?.site || '';
  $('#v-login').value = entry?.login || '';
  $('#v-pass').value = entry?.password || '';
  $('#v-pass').type = 'password';
  $('#v-delete').classList.toggle('hidden', !entry);
  $('#vault-error').classList.add('hidden');
  hideGen();
  $('#vault-modal').classList.remove('hidden');
  $('#v-site').focus();
}

function closeModal() {
  $('#vault-modal').classList.add('hidden');
  state.editing = null;
}

function vaultError(msg) {
  const el = $('#vault-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

$('#v-cancel').addEventListener('click', closeModal);
$('#vault-modal').addEventListener('click', (e) => { if (e.target.id === 'vault-modal') closeModal(); });
$('#vault-modal-close').addEventListener('click', closeModal);
$('#gen-modal-close').addEventListener('click', sgClose);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); sgClose(); } });

$('#v-pass-eye').addEventListener('click', () => {
  const inp = $('#v-pass');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('#vault-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { site: $('#v-site').value, login: $('#v-login').value, password: $('#v-pass').value };
  try {
    if (state.editing) await api(`/vault/${state.editing.id}`, { method: 'PUT', body });
    else await api('/vault', { method: 'POST', body });
    await load();
    closeModal();
  } catch (err) { vaultError(err.message); }
});

$('#v-delete').addEventListener('click', async () => {
  if (!state.editing || !confirm('¿Eliminar esta contraseña?')) return;
  try {
    await api(`/vault/${state.editing.id}`, { method: 'DELETE' });
    await load();
    closeModal();
  } catch (err) { vaultError(err.message); }
});

// ---------- mini-generador ----------
let genLast = '';

function hideGen() {
  $('#gen-panel').classList.add('hidden');
  genLast = '';
  $('#gen-preview').textContent = '';
}

async function generate() {
  const body = {
    length: Number($('#gen-len').value),
    upper: $('#g-upper').checked,
    lower: $('#g-lower').checked,
    digits: $('#g-digits').checked,
    symbols: $('#g-symbols').checked,
    avoidAmbiguous: $('#g-avoid').checked,
  };
  try {
    const { password } = await api('/vault/generate', { method: 'POST', body });
    genLast = password;
    $('#gen-preview').textContent = password;
  } catch (err) { vaultError(err.message); }
}

$('#v-pass-gen').addEventListener('click', () => {
  const panel = $('#gen-panel');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    generate();
  } else {
    hideGen();
  }
});
$('#gen-again').addEventListener('click', generate);
$('#gen-len').addEventListener('input', (e) => { $('#gen-len-val').textContent = e.target.value; });
['g-upper', 'g-lower', 'g-digits', 'g-symbols', 'g-avoid'].forEach((id) =>
  $('#' + id).addEventListener('change', generate)
);
$('#gen-use').addEventListener('click', () => {
  if (!genLast) return;
  $('#v-pass').value = genLast;
  $('#v-pass').type = 'text';
  hideGen();
});

// ---------- generador independiente (boton 🎲 en la barra) ----------
let sgLast = '';

function sgOptions() {
  return {
    length: Number($('#sg-len').value),
    upper: $('#sg-upper').checked,
    lower: $('#sg-lower').checked,
    digits: $('#sg-digits').checked,
    symbols: $('#sg-symbols').checked,
    avoidAmbiguous: $('#sg-avoid').checked,
  };
}

async function sgGenerate() {
  try {
    const { password } = await api('/vault/generate', { method: 'POST', body: sgOptions() });
    sgLast = password;
    $('#sg-preview').textContent = password;
  } catch (err) {
    sgLast = '';
    $('#sg-preview').textContent = '';
    const el = $('#gen-modal-error');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
}

function sgClose() {
  $('#gen-modal').classList.add('hidden');
  $('#sg-preview').textContent = '';
  sgLast = '';
}

$('#gen-open').addEventListener('click', () => {
  $('#gen-modal-error').classList.add('hidden');
  $('#gen-modal').classList.remove('hidden');
  sgGenerate();
});
$('#sg-close').addEventListener('click', sgClose);
$('#gen-modal').addEventListener('click', (e) => { if (e.target.id === 'gen-modal') sgClose(); });
$('#sg-again').addEventListener('click', sgGenerate);
$('#sg-len').addEventListener('input', (e) => { $('#sg-len-val').textContent = e.target.value; });
['sg-upper', 'sg-lower', 'sg-digits', 'sg-symbols', 'sg-avoid'].forEach((id) =>
  $('#' + id).addEventListener('change', sgGenerate)
);
$('#sg-copy').addEventListener('click', async () => {
  if (!sgLast) return;
  const btn = $('#sg-copy');
  if (await copyText(sgLast)) {
    const t = btn.textContent;
    btn.textContent = '✓ Copiada';
    setTimeout(() => { btn.textContent = t; }, 1200);
  }
});

boot();
