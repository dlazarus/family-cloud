'use strict';

// ---------- tarjeta «Archivos» ----------
// Arbol propio (privado) + la carpeta compartida con la familia, que se ve siempre
// diferenciada. Lo que comparten los demás es de solo lectura.

const state = {
  me: null,
  data: null,          // ultima respuesta de /api/files
  view: 'mine',        // 'mine' | 'family'
  cwd: null,           // id de la carpeta actual (null = raiz de la vista)
};

const fmtSize = (n) => {
  if (n === null || n === undefined) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};
const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

function pool() {
  if (!state.data) return [];
  return state.view === 'mine' ? [...state.data.private, ...state.data.shared_own] : state.data.shared_others;
}
const byName = (a, b) =>
  (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) ||
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

function childrenOf(id) {
  return pool().filter((n) => n.parent_id === id).sort(byName);
}
const nodeById = (id) => pool().find((n) => n.id === id);

// ruta completa de la carpeta actual (para el breadcrumb)
function pathTo(id) {
  const out = [];
  let cur = id;
  while (cur !== null && cur !== undefined) {
    const n = nodeById(cur);
    if (!n) break;
    out.unshift(n);
    cur = n.parent_id;
  }
  return out;
}

// ---------- arranque ----------
async function boot() {
  state.me = await requireUser();
  if (!state.me) return;
  initTopbar(state.me);
  await load();
}

async function load() {
  state.data = await api('/files');
  render();
}

// ---------- render ----------
function render() {
  const d = state.data;

  // aviso si el almacen esta caido (disco desmontado, sin permisos...)
  const warn = $('#storage-warn');
  if (d.storage && !d.storage.ok) {
    warn.classList.remove('hidden');
    warn.innerHTML = `⚠️ <b>El almacen de archivos no esta disponible.</b> ${escapeHtml(d.storage.error || '')}<br>` +
      `Calendario y contraseñas siguen funcionando. Avisaa al administrador (FILES_DIR: ${escapeHtml(d.storage.path || '')}).`;
  } else {
    warn.classList.add('hidden');
  }

  // cupo
  const q = d.quota || {};
  const used = q.used || 0;
  if (q.unlimited || q.limit === null) {
    $('#quota-text').textContent = `📊 Ocupas ${fmtSize(used)} (sin limite de espacio)`;
    $('#quota-fill').style.width = '100%';
  } else {
    const pct = Math.min(100, q.limit ? (used / q.limit) * 100 : 0);
    $('#quota-text').textContent = `📊 Ocupas ${fmtSize(used)} de ${fmtSize(q.limit)} (${pct.toFixed(0)} %)`;
    $('#quota-fill').style.width = pct + '%';
    $('#quota-fill').classList.toggle('over', pct >= 90);
  }

  // botones disponibles segun la vista
  const readOnly = state.view === 'family';
  $('#btn-mkdir').classList.toggle('hidden', readOnly);
  $('#btn-upload').classList.toggle('hidden', readOnly);
  $('#files-actions-disabled')?.remove();
  document.querySelector('.files-actions').classList.toggle('hidden', readOnly);

  renderCrumbs();
  renderList();

  $('#files-note').textContent = readOnly
    ? '👥 Los archivos que comparten los demás son de solo lectura: puedes verlos y descargarlos, pero no modificarlos.'
    : '🔒 Tus archivos se guardan cifrados. Solo tu carpeta compartida es visible para el resto de la familia.';
}

function renderCrumbs() {
  const el = $('#crumbs');
  const path = pathTo(state.cwd);
  const parts = [];
  if (state.view === 'family') {
    parts.push(`<button class="crumb" data-go="__family__">👥 La familia</button>`);
  } else if (state.cwd === null) {
    parts.push(`<span class="crumb here">🔒 Mis archivos</span>`);
  } else {
    parts.push(`<button class="crumb" data-go="__root__">🔒 Mis archivos</button>`);
  }
  for (const n of path) {
    const cls = n.is_shared_root ? 'crumb shared-crumb' : 'crumb';
    const last = n === path[path.length - 1];
    parts.push(last
      ? `<span class="${cls} here">${n.is_shared_root ? '👥' : '📁'} ${escapeHtml(n.name)}</span>`
      : `<button class="${cls}" data-go="${n.id}">${n.is_shared_root ? '👥' : '📁'} ${escapeHtml(n.name)}</button>`);
  }
  el.innerHTML = parts.join('<span class="crumb-sep">›</span>');
  el.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.go;
      if (v === '__family__') { state.view = 'family'; state.cwd = null; }
      else if (v === '__root__') { state.cwd = null; }
      else state.cwd = Number(v);
      render();
    })
  );
}

function renderList() {
  const list = $('#files-list');
  const empty = $('#files-empty');
  list.innerHTML = '';
  let items;
  if (state.view === 'family' && state.cwd === null) {
    // raiz de la vista familiar: las carpetas compartidas de cada persona
    items = pool().filter((n) => n.is_shared_root).sort(byName);
  } else if (state.view === 'mine' && state.cwd === null) {
    items = [
      ...state.data.shared_own.filter((n) => n.is_shared_root), // la compartida, siempre arriba y destacada
      ...state.data.private.filter((n) => n.parent_id === null).sort(byName),
    ];
  } else {
    items = childrenOf(state.cwd);
  }

  if (!items.length) {
    empty.classList.remove('hidden');
    empty.textContent = state.view === 'family' && state.cwd === null
      ? 'Nadie ha compartido nada todavia. Sube algo a tu CARPETA-COMPARTIDA para que la familia lo vea.'
      : 'Esta carpeta esta vacia. Usa «⬆ Subir» o arrastra archivos aqui.';
    return;
  }
  empty.classList.add('hidden');

  for (const n of items) list.appendChild(row(n));
}

function row(n) {
  const el = document.createElement('div');
  const isSharedRoot = n.is_shared_root;
  const shared = n.scope === 'shared';
  el.className = 'frow' + (isSharedRoot ? ' shared-root' : '') + (shared && state.view === 'family' ? ' foreign' : '');
  el.draggable = state.view === 'mine' && !isSharedRoot;
  el.dataset.id = n.id;

  const icon = isSharedRoot ? '👥' : n.kind === 'folder' ? '📁' : '📄';
  const sub = state.view === 'family'
    ? `de ${escapeHtml(n.owner || '')}`
    : isSharedRoot ? 'compartida con la familia' : '';
  el.innerHTML = `
    <span class="ficon">${icon}</span>
    <span class="fname"><span class="ftitle">${escapeHtml(n.name)}</span>${sub ? `<span class="fsub">${sub}</span>` : ''}</span>
    <span class="fmeta">${n.kind === 'file' ? fmtSize(n.size) : ''} <span class="fdate">${fmtDate(n.updated_at)}</span></span>
    <button class="icon-btn fmenu" title="Acciones">⋯</button>`;

  el.querySelector('.fname').addEventListener('click', () => open(n));
  el.querySelector('.fmenu').addEventListener('click', (e) => { e.stopPropagation(); openMenu(e.currentTarget, n); });
  if (n.kind === 'folder' && !(state.view === 'mine' && isSharedRoot)) {
    el.addEventListener('dblclick', () => open(n));
  }
  // arrastrar para mover
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(n.id));
    e.dataTransfer.effectAllowed = 'move';
  });
  if (n.kind === 'folder' && state.view === 'mine') {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dropping'); });
    el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('dropping');
      const id = Number(e.dataTransfer.getData('text/plain'));
      if (!id || id === n.id) return;
      await act(() => api(`/files/${id}/move`, { method: 'POST', body: { parent_id: n.id } }), `Movido a «${n.name}»`);
    });
  }
  return el;
}

function open(n) {
  if (n.kind === 'folder') { state.cwd = n.id; render(); return; }
  if (n.mime && /^(image|text|application\/pdf)/.test(n.mime)) {
    window.open(`/api/files/${n.id}/download?inline=1`, '_blank');
  } else {
    location.href = `/api/files/${n.id}/download`;
  }
}

// ---------- menu de acciones ----------
let menuFor = null;
function openMenu(btn, n) {
  const menu = $('#ctx-menu');
  const readOnly = state.view === 'family';
  const items = [];
  if (n.kind === 'file') items.push(['⬇ Descargar', () => { location.href = `/api/files/${n.id}/download`; }]);
  if (n.kind === 'folder') items.push(['🗄 Descargar ZIP', () => { location.href = `/api/files/${n.id}/archive`; }]);
  if (!readOnly) {
    if (n.kind === 'folder' && !n.is_shared_root) items.push(['📦 Mover a…', () => moveModal(n)]);
    if (!n.is_shared_root) items.push(['✏️ Renombrar', () => nameModal(n)]);
    if (n.is_shared_root) items.push(['🧹 Vaciar la compartida', () => emptyShared(n)]);
    items.push(['🗑 Eliminar', () => remove(n), true]);
  }
  menu.innerHTML = items
    .map((it, i) => `<button class="ctx-item${it[2] ? ' danger' : ''}" data-i="${i}">${it[0]}</button>`)
    .join('');
  menu.classList.remove('hidden');
  const r = btn.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left - 120, window.innerWidth - 220))}px`;
  menuFor = items;
  menu.querySelectorAll('.ctx-item').forEach((b) =>
    b.addEventListener('click', () => { closeMenu(); items[Number(b.dataset.i)][1](); })
  );
}
function closeMenu() { $('#ctx-menu').classList.add('hidden'); menuFor = null; }
document.addEventListener('click', (e) => { if (!e.target.closest('#ctx-menu') && !e.target.closest('.fmenu')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// aviso breve abajo a la derecha (sin librerias)
let toastTimer = null;
function toast(msg, isError = false) {
  let el = document.getElementById('fc-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fc-toast';
    el.className = 'fc-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 6000 : 2500);
}

// ---------- acciones ----------
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await load();
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

async function remove(n) {
  const extra = n.kind === 'folder' ? ' (incluye todo su contenido)' : '';
  if (!confirm(`¿Eliminar «${n.name}»?${extra}`)) return;
  await act(() => api(`/files/${n.id}`, { method: 'DELETE' }), `«${n.name}» eliminado`);
}

async function emptyShared(n) {
  if (!confirm(`¿Vaciar «${n.name}»? Se eliminan todos los archivos que has compartido (tu carpeta seguira existiendo).`)) return;
  await act(() => api(`/files/${n.id}/empty`, { method: 'POST' }), 'Carpeta compartida vaciada');
}

function nameModal(n) {
  $('#name-modal-title').textContent = `✏️ Renombrar «${n.name}»`;
  const inp = $('#name-input');
  inp.value = n.name;
  $('#name-error').classList.add('hidden');
  $('#name-modal').classList.remove('hidden');
  inp.focus();
  inp.select();
  $('#name-ok').onclick = async () => {
    const okk = await act(() => api(`/files/${n.id}`, { method: 'PUT', body: { name: inp.value } }), 'Nombre actualizado');
    if (okk) $('#name-modal').classList.add('hidden');
  };
  $('#name-cancel').onclick = () => $('#name-modal').classList.add('hidden');
  inp.onkeydown = (e) => { if (e.key === 'Enter') $('#name-ok').click(); };
}

function moveModal(n) {
  const targets = [];
  const poolM = [...state.data.private, ...state.data.shared_own];
  // no se puede mover dentro de si misma ni dentro de un descendiente
  const isDesc = (id) => {
    let cur = id;
    while (cur !== null && cur !== undefined) {
      if (cur === n.id) return true;
      const p = poolM.find((x) => x.id === cur);
      cur = p ? p.parent_id : null;
    }
    return false;
  };
  const add = (node, depth) => {
    if (node.kind !== 'folder') return;
    if (node.id === n.id || isDesc(node.id)) return;
    targets.push({ id: node.id, label: ' '.repeat(depth * 2) + (node.is_shared_root ? '👥 ' : '📁 ') + node.name, node });
    for (const c of poolM.filter((x) => x.parent_id === node.id).sort(byName)) add(c, depth + 1);
  };
  if (n.scope === 'private') targets.push({ id: null, label: '🔒 Raiz de Mis archivos' });
  for (const c of poolM.filter((x) => x.parent_id === null).sort(byName)) add(c, 1);

  $('#move-list').innerHTML = targets.length
    ? targets.map((t, i) => `<button class="move-item" data-i="${i}">${escapeHtml(t.label)}</button>`).join('')
    : '<p class="muted">No hay otra carpeta donde moverlo.</p>';
  $('#move-modal').classList.remove('hidden');
  $('#move-list').querySelectorAll('.move-item').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = targets[Number(b.dataset.i)];
      const okk = await act(() => api(`/files/${n.id}/move`, { method: 'POST', body: { parent_id: t.id } }), 'Movido');
      if (okk) $('#move-modal').classList.add('hidden');
    })
  );
  $('#move-cancel').onclick = () => $('#move-modal').classList.add('hidden');
}

// ---------- crear carpeta / subir ----------
function mkdirModal() {
  $('#name-modal-title').textContent = '📁 Nueva carpeta';
  const inp = $('#name-input');
  inp.value = '';
  $('#name-error').classList.add('hidden');
  $('#name-modal').classList.remove('hidden');
  inp.focus();
  $('#name-ok').onclick = async () => {
    const body = { name: inp.value, scope: targetScope(), parent_id: targetParent() };
    const okk = await act(() => api('/files/folder', { method: 'POST', body }), 'Carpeta creada');
    if (okk) $('#name-modal').classList.add('hidden');
  };
  $('#name-cancel').onclick = () => $('#name-modal').classList.add('hidden');
}

// donde caen los nuevos elementos segun donde estemos
function targetScope() {
  const cur = state.cwd === null ? null : nodeById(state.cwd);
  return cur && cur.scope === 'shared' ? 'shared' : 'private';
}
function targetParent() {
  if (targetScope() === 'shared') return state.cwd; // dentro de la compartida: siempre hay carpeta
  return state.cwd;
}

async function uploadFiles(files) {
  if (state.view === 'family') return;
  const scope = targetScope();
  const parent = targetParent();
  const box = $('#upload-progress');
  for (const f of files) {
    box.classList.remove('hidden');
    $('#upload-label').textContent = `Subiendo ${f.name} (${fmtSize(f.size)})…`;
    const okk = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/files/upload?scope=${scope}` + (parent ? `&parent=${parent}` : ''));
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(f.name));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) $('#upload-fill').style.width = `${(e.loaded / e.total) * 100}%`;
      };
      xhr.onload = () => {
        let msg = '';
        try { msg = JSON.parse(xhr.responseText).error || ''; } catch { /* html */ }
        if (xhr.status >= 400) toast(`${f.name}: ${msg || 'error ' + xhr.status}`, true);
        resolve(xhr.status < 400);
      };
      xhr.onerror = () => { toast(`${f.name}: fallo de red`, true); resolve(false); };
      xhr.send(f);
    });
    if (okk) toast(`Subido ${f.name}`);
  }
  box.classList.add('hidden');
  $('#upload-fill').style.width = '0%';
  await load();
}

// ---------- eventos ----------
$('#view-mine').addEventListener('click', () => { state.view = 'mine'; state.cwd = null; syncSeg(); render(); });
$('#view-family').addEventListener('click', () => { state.view = 'family'; state.cwd = null; syncSeg(); render(); });
function syncSeg() {
  $('#view-mine').classList.toggle('active', state.view === 'mine');
  $('#view-family').classList.toggle('active', state.view === 'family');
}
$('#btn-mkdir').addEventListener('click', mkdirModal);
$('#btn-upload').addEventListener('click', () => $('#file-picker').click());
$('#file-picker').addEventListener('change', async (e) => {
  const fs = [...e.target.files];
  e.target.value = '';
  if (fs.length) await uploadFiles(fs);
});

// arrastrar archivos del escritorio a la lista
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => {
    if (state.view === 'family') return;
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); dz.classList.add('over'); }
  })
);
dz.addEventListener('dragleave', (e) => { if (!dz.contains(e.relatedTarget)) dz.classList.remove('over'); });
dz.addEventListener('drop', (e) => {
  if (state.view === 'family') return;
  if (e.dataTransfer.getData('text/plain')) return; // era un elemento de la lista (mover)
  const fs = [...e.dataTransfer.files];
  if (fs.length) { e.preventDefault(); dz.classList.remove('over'); uploadFiles(fs); }
});

boot();
