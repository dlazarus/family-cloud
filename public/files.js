'use strict';

// ---------- tarjeta «Archivos» ----------
// Arbol propio (privado) + la carpeta compartida con la familia, que se ve siempre
// diferenciada. Lo que comparten los demas es de solo lectura.
//
// Interaccion (pensada para parecerse a un Drive sencillo):
//   * clic en un ARCHIVO  -> seleccionar (no descarga: eso se pedia a gritos)
//   * doble clic          -> abrir la carpeta / descargar el archivo
//   * clic en una CARPETA -> entrar (Ctrl+clic para seleccionarla)
//   * Ctrl+clic, Shift+clic o arrastrar el raton en el vacio -> seleccion multiple
//   * arrastrar una seleccion encima de una carpeta -> moverla ahi
//   * arrastrar archivos del escritorio a casi cualquier parte de la pagina -> subirlos
//   * arrastrar algo a la CARPETA-COMPARTIDA -> compartirlo con la familia al momento

const state = {
  me: null,
  data: null, // ultima respuesta de /api/files
  view: 'mine', // 'mine' | 'family'
  cwd: null, // id de la carpeta actual (null = raiz de la vista)
  sel: new Set(), // ids seleccionados
  anchor: null, // ultimo clic (para Shift+clic)
};

const fmtSize = (n) => {
  if (n === null || n === undefined) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};
const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

// nodos que puedo escribir (todo lo mio: privado + mi compartida)
function ownNodes() {
  if (!state.data) return [];
  return [...state.data.private, ...state.data.shared_own];
}
let _ownIds = new Set(); // se recalcula en cada render (evita reconstruirlo por fila)
function ownIds() { return _ownIds; }

// que arbol se esta mirando
function pool() {
  if (!state.data) return [];
  if (state.view === 'mine') return ownNodes();
  // en la vista familiar tambien esta la mia (asi se ve igual desde los dos botones)
  return [...state.data.shared_own, ...state.data.shared_others];
}
const byName = (a, b) =>
  (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) ||
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

function childrenOf(id) {
  return pool().filter((n) => n.parent_id === id).sort(byName);
}
const nodeById = (id) => pool().find((n) => n.id === id) || ownNodes().find((n) => n.id === id);
const canWrite = (n) => !!n && ownIds().has(n.id);

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

// items visibles ahora mismo (orden de pantalla, para Shift+clic y el Ctrl+A)
function visibleItems() {
  if (state.view === 'family' && state.cwd === null) return pool().filter((n) => n.is_shared_root).sort(byName);
  if (state.view === 'mine' && state.cwd === null) {
    return [
      ...state.data.shared_own.filter((n) => n.is_shared_root),
      ...state.data.private.filter((n) => n.parent_id === null).sort(byName),
    ];
  }
  return childrenOf(state.cwd);
}

// donde caen los nuevos elementos segun donde estemos
function currentFolderWritable() {
  if (state.cwd === null) return state.view === 'mine';
  const cur = nodeById(state.cwd);
  return canWrite(cur) && cur.kind === 'folder';
}
function targetScope(parentId = state.cwd) {
  const cur = parentId === null ? null : nodeById(parentId);
  return cur && cur.scope === 'shared' ? 'shared' : 'private';
}
function whereName() {
  const p = pathTo(state.cwd);
  return p.length ? p[p.length - 1].name : state.view === 'mine' ? 'Mis archivos' : 'la vista familiar';
}

// ---------- arranque ----------
async function boot() {
  state.me = await requireUser();
  if (!state.me) return;
  initTopbar(state.me);
  history.replaceState({ view: state.view, cwd: state.cwd }, ''); // punto de partida del «atras»
  await load();
}

async function load() {
  state.data = await api('/files');
  // la seleccion solo tiene sentido sobre lo que hay en pantalla
  const vis = new Set(visibleItems().map((n) => n.id));
  state.sel = new Set([...state.sel].filter((id) => vis.has(id)));
  render();
}

// ---------- render ----------
function render() {
  const d = state.data;
  _ownIds = new Set(ownNodes().map((n) => n.id));

  const warn = $('#storage-warn');
  if (d.storage && !d.storage.ok) {
    warn.classList.remove('hidden');
    warn.innerHTML = `⚠️ <b>El almacen de archivos no esta disponible.</b> ${escapeHtml(d.storage.error || '')}<br>` +
      `Calendario y contraseñas siguen funcionando. Avisaa al administrador (FILES_DIR: ${escapeHtml(d.storage.path || '')}).`;
  } else {
    warn.classList.add('hidden');
  }

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

  // los botones dependen de si la carpeta ACTUAL es escribible (no de como hemos llegado)
  const writable = currentFolderWritable();
  $('#btn-mkdir').classList.toggle('hidden', !writable);
  $('#btn-upload').classList.toggle('hidden', !writable);
  document.querySelector('.files-actions').classList.toggle('hidden', !writable);

  renderCrumbs();
  renderList();
  renderSelBar();

  $('#files-note').textContent = state.view === 'family' && !currentFolderWritable()
    ? '👥 Los archivos que comparten los demás son de solo lectura: puedes verlos y descargarlos, pero no modificarlos.'
    : '🔒 Tus archivos se guardan cifrados. Clic en un archivo para seleccionarlo, doble clic para abrirlo. Ctrl+clic o arrastra en el vacio para elegir varios.';
}

// ---------- navegacion con el historial del navegador ----------
// El boton «atras» del raton debe llevar a la carpeta anterior, no salir del servicio.
// Cada cambio de vista/carpeta apila un estado; popstate lo reactiva.
function go(view, cwd) {
  if (state.view === view && (state.cwd || null) === (cwd || null)) return;
  state.view = view;
  state.cwd = cwd ?? null;
  state.sel.clear();
  syncSeg();
  render();
  history.pushState({ view, cwd: cwd ?? null }, '');
}
window.addEventListener('popstate', (e) => {
  const s = e.state || { view: 'mine', cwd: null };
  state.view = s.view;
  state.cwd = s.cwd ?? null;
  state.sel.clear();
  syncSeg();
  render();
});

function renderCrumbs() {
  const el = $('#crumbs');
  const path = pathTo(state.cwd);
  const parts = [];
  if (state.view === 'family') {
    parts.push(state.cwd === null
      ? `<span class="crumb here">👥 La familia</span>`
      : `<button class="crumb" data-go="__family__">👥 La familia</button>`);
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
      if (v === '__root__') go('mine', null);
      else if (v === '__family__') go('family', null);
      else go(state.view, Number(v));
    })
  );
  // soltar encima de un tramo del camino = mover alli (util para subir un nivel)
  if (state.view === 'mine') {
    el.querySelectorAll('.crumb').forEach((b) => {
      const dest = (!b.dataset.go || b.dataset.go === '__root__') ? null : Number(b.dataset.go);
      if (dest !== null && !canWrite(nodeById(dest))) return;
      b.addEventListener('dragover', (e) => { if (!dropAllowedTo(e, dest)) return; e.preventDefault(); b.classList.add('drop-crumb'); });
      b.addEventListener('dragleave', () => b.classList.remove('drop-crumb'));
      b.addEventListener('drop', (e) => {
        const ids = internalIds(e);
        if (!ids.length) return;
        e.preventDefault(); e.stopPropagation();
        b.classList.remove('drop-crumb');
        moveIds(ids, dest);
      });
    });
  }
}

// destino valido para un arrastre interno (no dentro de si mismo)
function dropAllowedTo(e, destId) {
  const ids = internalIds(e);
  if (!ids.length) return false;
  if (destId === null) return true;
  const dest = nodeById(destId);
  return !!dest && dest.kind === 'folder' && canWrite(dest) && !ids.includes(dest.id);
}

function renderList() {
  const list = $('#files-list');
  const empty = $('#files-empty');
  list.innerHTML = '';
  const items = visibleItems();

  if (!items.length) {
    empty.classList.remove('hidden');
    if (state.view === 'family' && state.cwd === null) {
      empty.textContent = 'Nadie ha compartido nada todavia. Sube algo a tu CARPETA-COMPARTIDA para que la familia lo vea.';
    } else if (!currentFolderWritable()) {
      // carpeta ajena (solo lectura): no tiene sentido invitar a subir aqui
      empty.textContent = 'Esta carpeta esta vacia.';
    } else {
      empty.textContent = 'Esta carpeta esta vacia. Usa «⬆ Subir» o arrastra archivos aqui.';
    }
    return;
  }
  empty.classList.add('hidden');

  for (const n of items) list.appendChild(row(n));
  paintSelection();
}

function row(n) {
  const el = document.createElement('div');
  const isSharedRoot = n.is_shared_root;
  const mine = canWrite(n);
  el.className = 'frow' + (isSharedRoot ? ' shared-root' : '') + (state.view === 'family' && n.scope === 'shared' && !mine ? ' foreign' : '');
  el.dataset.id = n.id;
  el.draggable = mine && !isSharedRoot;

  const icon = isSharedRoot ? '👥' : n.kind === 'folder' ? '📁' : '📄';
  let sub = '';
  // en la vista familiar, la raiz compartida de otro se rotula con su nombre DENTRO
  // del nombre grande (CARPETA-COMPARTIDA-DANI) para no repetir el nombre generico
  const foreignRoot = isSharedRoot && state.view === 'family' && !mine;
  const title = foreignRoot ? `${n.name}-${(n.owner || '').toUpperCase()}` : n.name;
  if (isSharedRoot) sub = foreignRoot ? '' : (mine ? 'tuya · la editas tu' : `de ${escapeHtml(n.owner || '')}`);
  else if (state.view === 'family') sub = `de ${escapeHtml(n.owner || '')}`;
  else if (mine && n.scope === 'shared') sub = 'visible para la familia';

  el.innerHTML = `
    <span class="ficon">${icon}</span>
    <span class="fname"><span class="ftitle">${escapeHtml(title)}</span>${sub ? `<span class="fsub">${sub}</span>` : ''}</span>
    <span class="fmeta">${n.kind === 'file' ? fmtSize(n.size) : ''} <span class="fdate">${fmtDate(n.updated_at)}</span></span>
    <button class="icon-btn fmenu" title="Acciones">⋯</button>`;

  el.addEventListener('click', (e) => {
    if (e.target.closest('.fmenu')) return;
    if (n.kind === 'folder' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { open(n); return; }
    pick(n, e);
  });
  el.addEventListener('dblclick', () => open(n));
  el.querySelector('.fmenu').addEventListener('click', (e) => { e.stopPropagation(); openMenu(e.currentTarget, n); });

  // arrastrar para mover (una seleccion o la fila suelta)
  el.addEventListener('dragstart', (e) => {
    const ids = dragIds(n);
    if (!ids.length) { e.preventDefault(); return; }
    e.dataTransfer.setData(DRAG_KEY, JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', ids.map(String).join(','));
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  // cualquier carpeta mia sirve de destino de arrastre (incluida la compartida)
  if (n.kind === 'folder' && mine) {
    el.addEventListener('dragover', (e) => {
      if (!dropAllowed(e, n)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('dropping');
    });
    el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    el.addEventListener('drop', (e) => {
      const ids = internalIds(e);
      const files = [...e.dataTransfer.files];
      if (!ids.length && !files.length) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('dropping');
      hideOverlay();
      if (files.length) { uploadFiles(files, n.id); return; }
      moveIds(ids, n.id);
    });
  }
  return el;
}

// ---------- seleccion ----------
const DRAG_KEY = 'application/x-familycloud-ids';

function pick(n, e) {
  if (e.ctrlKey || e.metaKey) {
    state.sel.has(n.id) ? state.sel.delete(n.id) : state.sel.add(n.id);
    state.anchor = n.id;
  } else if (e.shiftKey && state.anchor != null) {
    const items = visibleItems();
    const a = items.findIndex((x) => x.id === state.anchor);
    const b = items.findIndex((x) => x.id === n.id);
    if (a >= 0 && b >= 0) {
      for (const it of items.slice(Math.min(a, b), Math.max(a, b) + 1)) state.sel.add(it.id);
    }
  } else {
    state.sel = new Set([n.id]);
    state.anchor = n.id;
  }
  paintSelection();
  renderSelBar();
}

function paintSelection() {
  for (const el of $('#files-list').children) {
    el.classList.toggle('selected', state.sel.has(Number(el.dataset.id)));
  }
}

function renderSelBar() {
  const bar = $('#sel-bar');
  const n = state.sel.size;
  if (!n) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const writable = [...state.sel].every((id) => ownIds().has(id));
  $('#sel-count').textContent = `${n} seleccionado${n > 1 ? 's' : ''}`;
  $('#sel-move').classList.toggle('hidden', !writable);
  $('#sel-del').classList.toggle('hidden', !writable);
}

function clearSel() { state.sel.clear(); paintSelection(); renderSelBar(); }

// ids a mover si arrastramos esta fila (si esta seleccionada, se mueve toda la seleccion)
function dragIds(n) {
  const ids = state.sel.has(n.id) ? [...state.sel] : [n.id];
  return ids
    .map((id) => nodeById(id))
    .filter((x) => x && canWrite(x) && !x.is_shared_root)
    .map((x) => x.id);
}

function internalIds(e) {
  let raw = e.dataTransfer.getData(DRAG_KEY);
  if (!raw) {
    const t = e.dataTransfer.getData('text/plain');
    if (!/^[\d,]+$/.test(t || '')) return [];
    raw = JSON.stringify(t.split(',').map(Number));
  }
  try { return JSON.parse(raw).map(Number); } catch { return []; }
}

function dropAllowed(e, dest) {
  if (!dest || dest.kind !== 'folder' || !canWrite(dest)) return false;
  if ([...e.dataTransfer.types].includes('Files')) return true;
  const ids = internalIds(e);
  return ids.length > 0 && !ids.includes(dest.id);
}

async function moveIds(ids, destId) {
  const nodes = ids.map((id) => nodeById(id)).filter(Boolean);
  if (!nodes.length) return;
  const dest = destId === null ? null : nodeById(destId);
  const destName = dest ? dest.name : 'Mis archivos';
  let ok = 0, fail = 0;
  for (const nd of nodes) {
    if (nd.parent_id === destId) { continue; }
    try {
      await api(`/files/${nd.id}/move`, { method: 'POST', body: { parent_id: destId } });
      ok++;
    } catch (err) {
      fail++;
      toast(`«${nd.name}»: ${err.message}`, true);
    }
  }
  clearSel();
  await load();
  if (ok && !fail) {
    const shared = dest && dest.scope === 'shared';
    toast(`Movido${ok > 1 ? 's' : ''} ${ok} elemento${ok > 1 ? 's' : ''} a «${destName}»${shared ? ' 👥 ya visible para la familia' : ''}`);
  } else if (ok) {
    toast(`${ok} movido(s), ${fail} no`, true);
  }
}

// ---------- abrir / menu ----------
function open(n) {
  if (n.kind === 'folder') { go(state.view, n.id); return; }
  if (n.mime && /^(image|text|application\/pdf)/.test(n.mime)) {
    window.open(`/api/files/${n.id}/download?inline=1`, '_blank');
  } else {
    location.href = `/api/files/${n.id}/download`;
  }
}

// ---------- descargar una seleccion ----------
// Un archivo suelto se baja directo; si hay varios elementos o hay carpetas,
// se pide un unico .zip al servidor (lo genera al vuelo, sin temporeros).
function downloadNodes(nodes) {
  nodes = nodes.filter(Boolean);
  if (!nodes.length) return;
  if (nodes.length === 1 && nodes[0].kind === 'file') {
    location.href = `/api/files/${nodes[0].id}/download`;
    toast(`Descargando «${nodes[0].name}»…`);
    return;
  }
  const ids = nodes.map((n) => n.id);
  toast(`Preparando un .zip con ${ids.length} elemento${ids.length > 1 ? 's' : ''}…`);
  location.href = `/api/files/archive?ids=${ids.join(',')}`;
}

let menuFor = null;
function openMenu(btn, n) {
  const menu = $('#ctx-menu');
  const mine = canWrite(n);
  const items = [];
  if (n.kind === 'folder') items.push(['📂 Abrir', () => open(n)]);
  if (n.kind === 'file') items.push(['⬇ Descargar', () => { location.href = `/api/files/${n.id}/download`; }]);
  if (n.kind === 'folder') items.push(['🗄 Descargar ZIP', () => { location.href = `/api/files/${n.id}/archive`; }]);
  if (mine) {
    if (n.kind === 'folder' && !n.is_shared_root) items.push(['📦 Mover a…', () => moveModal([n])]);
    if (!n.is_shared_root) items.push(['✏️ Renombrar', () => nameModal(n)]);
    if (n.is_shared_root) items.push(['🧹 Vaciar la compartida', () => emptyShared(n)]);
    items.push(['🗑 Eliminar', () => remove([n]), true]);
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
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target : null;
  if (!el?.closest('#ctx-menu') && !el?.closest('.fmenu')) closeMenu();
});

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

async function remove(nodes) {
  const many = nodes.length > 1;
  const extra = many ? '' : nodes[0].kind === 'folder' ? ' (incluye todo su contenido)' : '';
  const label = many ? `${nodes.length} elementos` : `«${nodes[0].name}»`;
  if (!confirm(`¿Eliminar ${label}?${extra}`)) return;
  let ok = 0;
  for (const n of nodes) {
    try { await api(`/files/${n.id}`, { method: 'DELETE' }); ok++; }
    catch (err) { toast(`«${n.name}»: ${err.message}`, true); }
  }
  clearSel();
  await load();
  if (ok) toast(`Eliminado${ok > 1 ? 's' : ''} ${ok} elemento${ok > 1 ? 's' : ''}`);
}

async function emptyShared(n) {
  if (!confirm(`¿Vaciar «${n.name}»? Se eliminan todos los archivos que has compartido (tu carpeta seguira existiendo).`)) return;
  await act(() => api(`/files/${n.id}/empty`, { method: 'POST' }), 'Carpeta compartida vaciada');
}

// modal de nombre: nueva carpeta y renombrar (ENTER guarda)
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
}

function mkdirModal() {
  $('#name-modal-title').textContent = '📁 Nueva carpeta';
  const inp = $('#name-input');
  inp.value = '';
  $('#name-error').classList.add('hidden');
  $('#name-modal').classList.remove('hidden');
  inp.focus();
  $('#name-ok').onclick = async () => {
    const body = { name: inp.value, scope: targetScope(), parent_id: state.cwd };
    const okk = await act(() => api('/files/folder', { method: 'POST', body }), 'Carpeta creada');
    if (okk) $('#name-modal').classList.add('hidden');
  };
  $('#name-cancel').onclick = () => $('#name-modal').classList.add('hidden');
}

// modal de mover: acepta uno o varios nodos
let moveTargets = [];
function moveModal(nodes) {
  const targets = [];
  const poolM = ownNodes();
  const isDescOfAny = (id) =>
    nodes.some((n) => {
      let cur = id;
      while (cur !== null && cur !== undefined) {
        if (cur === n.id) return true;
        const p = poolM.find((x) => x.id === cur);
        cur = p ? p.parent_id : null;
      }
      return false;
    });
  const add = (node, depth) => {
    if (node.kind !== 'folder') return;
    if (nodes.some((n) => n.id === node.id) || isDescOfAny(node.id)) return;
    targets.push({ id: node.id, label: ' '.repeat(depth * 2) + (node.is_shared_root ? '👥 ' : '📁 ') + node.name });
    for (const c of poolM.filter((x) => x.parent_id === node.id).sort(byName)) add(c, depth + 1);
  };
  targets.push({ id: null, label: '🔒 Raiz de Mis archivos' });
  for (const c of poolM.filter((x) => x.parent_id === null).sort(byName)) add(c, 1);

  moveTargets = targets;
  $('#move-modal h3').textContent = nodes.length > 1 ? `📦 Mover ${nodes.length} elementos a…` : '📦 Mover a…';
  $('#move-list').innerHTML = targets
    .map((t, i) => `<button class="move-item" data-i="${i}">${escapeHtml(t.label)}</button>`)
    .join('');
  $('#move-modal').classList.remove('hidden');
  $('#move-list').querySelectorAll('.move-item').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = targets[Number(b.dataset.i)];
      $('#move-modal').classList.add('hidden');
      await moveIds(nodes.map((n) => n.id), t.id);
    })
  );
  $('#move-cancel').onclick = () => $('#move-modal').classList.add('hidden');
}

// ---------- subir ----------
async function uploadFiles(files, parentId = state.cwd) {
  if (!currentFolderWritable() && parentId === state.cwd) return;
  const scope = targetScope(parentId);
  const box = $('#upload-progress');
  for (const f of files) {
    box.classList.remove('hidden');
    $('#upload-label').textContent = `Subiendo ${f.name} (${fmtSize(f.size)})…`;
    const okk = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/files/upload?scope=${scope}` + (parentId ? `&parent=${parentId}` : ''));
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
$('#view-mine').addEventListener('click', () => go('mine', null));
$('#view-family').addEventListener('click', () => go('family', null));
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
$('#sel-clear').addEventListener('click', clearSel);
$('#sel-del').addEventListener('click', () => remove([...state.sel].map(nodeById).filter(Boolean)));
$('#sel-dl').addEventListener('click', () => downloadNodes([...state.sel].map(nodeById)));
$('#sel-move').addEventListener('click', () => moveModal([...state.sel].map(nodeById).filter(Boolean)));

// ENTER en el modal de nombre = guardar
$('#name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#name-ok').click(); }
  if (e.key === 'Escape') $('#name-modal').classList.add('hidden');
});

// teclado: Esc limpia, Supr elimina, Ctrl+A selecciona todo lo visible
document.addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : null; // el evento puede venir de document/window
  const inField = !!el?.closest('input, textarea, select');
  if (!inField && e.key === 'Escape') { closeMenu(); clearSel(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !inField) {
    e.preventDefault();
    state.sel = new Set(visibleItems().map((n) => n.id));
    paintSelection();
    renderSelBar();
    return;
  }
  if (inField || !state.sel.size) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove([...state.sel].map(nodeById).filter(Boolean)); }
});

// ------- soltar archivos del escritorio: practica toda la pagina -------
function hasFiles(e) {
  return [...e.dataTransfer.types].includes('Files');
}
function showOverlay(txt) {
  const ov = $('#drop-overlay');
  $('#drop-overlay-text').textContent = txt;
  ov.classList.remove('hidden');
}
function hideOverlay() { $('#drop-overlay').classList.add('hidden'); $('#dropzone').classList.remove('over'); }

document.addEventListener('dragenter', (e) => {
  if (state.view === 'family' && !currentFolderWritable()) return;
  if (!hasFiles(e)) return;
  e.preventDefault();
  showOverlay(`⬆ Suelta para subir a «${whereName()}»`);
});
document.addEventListener('dragover', (e) => {
  if (state.view === 'family' && !currentFolderWritable()) return;
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hideOverlay(); });
document.addEventListener('drop', (e) => {
  const ids = internalIds(e);
  const files = [...e.dataTransfer.files];
  if (!files.length && !ids.length) return;
  if (files.length) {
    if (state.view === 'family' && !currentFolderWritable()) return;
    e.preventDefault();
    hideOverlay();
    uploadFiles(files);
    return;
  }
  // arrastre interno soltado en el vacio -> mover a la carpeta actual
  e.preventDefault();
  hideOverlay();
  moveIds(ids, state.cwd);
});

// ------- seleccion con el raton en el vacio (marcha de seleccion) -------
// se arranca en cualquier hueco libre de la pagina (no solo encima de la lista)
const dz = document.querySelector('main.files-main');
let band = null;
dz.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' || e.button !== 0) return;
  if (e.target.closest('.frow, .sel-bar, .files-toolbar, .crumbs, #quota-bar, .storage-warn, .upload-progress, button, input, a')) return;
  band = { x0: e.clientX, y0: e.clientY, base: e.ctrlKey || e.metaKey ? new Set(state.sel) : new Set(), moved: false };
  const rect = document.createElement('div');
  rect.className = 'marquee hidden';
  document.body.appendChild(rect);
  band.el = rect;
  dz.setPointerCapture?.(e.pointerId);
});
dz.addEventListener('pointermove', (e) => {
  if (!band) return;
  const x = Math.min(band.x0, e.clientX), y = Math.min(band.y0, e.clientY);
  const w = Math.abs(e.clientX - band.x0), h = Math.abs(e.clientY - band.y0);
  if (w < 4 && h < 4) return;
  band.moved = true;
  band.el.classList.remove('hidden');
  Object.assign(band.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  const next = new Set(band.base);
  for (const el of $('#files-list').children) {
    const r = el.getBoundingClientRect();
    if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) next.add(Number(el.dataset.id));
  }
  state.sel = next;
  paintSelection();
});
window.addEventListener('pointerup', () => {
  if (!band) return;
  band.el.remove();
  if (!band.moved && !band.base.size) clearSel(); // clic en el vacio = deseleccionar
  band = null;
  renderSelBar();
});

boot();
