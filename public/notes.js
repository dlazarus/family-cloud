'use strict';

// ---------- corcho de notas ----------
const COLORS = ['amarillo', 'rosa', 'azul', 'verde', 'naranja', 'lavanda'];

let me = null;
let notes = [];
let editing = null;   // nota en edición (null = creando)
let pickedColor = COLORS[0];
let deleteArmed = false;

async function boot() {
  me = await requireUser();
  if (!me) return;
  initTopbar(me);
  buildSwatches();
  bindUI();
  await refresh();
}

async function refresh() {
  notes = await api('/notes');
  renderBoard();
}

// ---------- tablero ----------
function rotFor(id) {
  // rotacion ligera y estable (depende solo del id: la nota no "baila" al recargar)
  return (((id * 37) % 7) - 3) * 0.9; // -2.7º .. +2.7º
}

function shortDate(iso) {
  // 'YYYY-MM-DD ...' -> '5 mar' (año solo si no es el actual)
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const f = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
  const y = new Intl.DateTimeFormat('es', { year: 'numeric' });
  const txt = f.format(d);
  return String(y.format(d)) === String(new Date().getFullYear()) ? txt : txt + ' ' + y.format(d);
}

function longDate(iso) {
  // como shortDate pero con la hora de colgado: '5 mar, 18:42'
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const f = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const y = new Intl.DateTimeFormat('es', { year: 'numeric' });
  const txt = f.format(d);
  return String(y.format(d)) === String(new Date().getFullYear()) ? txt : txt + ' ' + y.format(d);
}

function renderBoard() {
  const board = $('#corkboard');
  $('#board-empty').classList.toggle('hidden', notes.length > 0);
  board.innerHTML = '';
  for (const n of notes) {
    const el = document.createElement('article');
    el.className = `nota nota-${n.color}`;
    el.style.setProperty('--rot', `${rotFor(n.id)}deg`);
    el.tabIndex = 0;

    const canEdit = me.role === 'admin' || n.created_by === me.id;

    const pin = document.createElement('span');
    pin.className = 'nota-pin';
    pin.textContent = '📌';

    const text = document.createElement('p');
    text.className = 'nota-text hand';
    text.textContent = n.text;

    const sign = document.createElement('span');
    sign.className = 'nota-sign hand';
    const who = n.author ? n.author : '???';
    const edited = n.updated_at && n.updated_at.slice(0, 16) !== n.created_at.slice(0, 16);
    sign.textContent = `— ${who} · ${shortDate(n.created_at)}${edited ? ' · editada' : ''}`;

    el.append(pin, text, sign);
    if (canEdit) {
      el.addEventListener('click', () => openModal(n));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(n); }
      });
    }
    // la hora de colgado se ve al pasar el raton en todas las notas; el aviso de
    // editar, en una segunda linea, solo donde procede
    el.title = `Colgada el ${longDate(n.created_at)}` + (canEdit ? '\nClic para editar' : '');
    board.appendChild(el);
  }
}

// ---------- modal ----------
function buildSwatches() {
  $('#swatches').innerHTML = COLORS
    .map((c) => `<button type="button" class="swatch swatch-${c}" data-color="${c}" title="${c}" aria-label="Color ${c}"></button>`)
    .join('');
  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (b) pickColor(b.dataset.color);
  });
}

function pickColor(c) {
  pickedColor = COLORS.includes(c) ? c : COLORS[0];
  for (const b of $('#swatches').querySelectorAll('.swatch')) {
    const on = b.dataset.color === pickedColor;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function openModal(note) {
  editing = note || null;
  deleteArmed = false;
  $('#modal-title').textContent = note ? '✏️ Editar nota' : '📌 Nueva nota';
  $('#note-text').value = note ? note.text : '';
  $('#note-count').textContent = String($('#note-text').value.length);
  pickColor(note ? note.color : COLORS[Math.floor(Math.random() * COLORS.length)]);
  const author = $('#note-author');
  if (note && note.author) {
    // la tarjeta de edicion solo la abre el autor o un admin: ahi si se muestra la hora
    author.textContent = `Autoría: ${note.author} · ${longDate(note.created_at)}`;
    author.classList.remove('hidden');
  } else {
    author.classList.add('hidden');
  }
  const del = $('#note-delete');
  del.textContent = 'Eliminar';
  del.classList.toggle('hidden', !note);
  $('#modal-error').classList.add('hidden');
  $('#modal').classList.remove('hidden');
  $('#note-text').focus();
}

function closeModal() {
  $('#modal').classList.add('hidden');
  editing = null;
}

function modalError(err) {
  const el = $('#modal-error');
  el.textContent = err.message;
  el.classList.remove('hidden');
}

// ---------- gestionar mis notas (lista ordenada de vieja a nueva, con casillas) ----------
function snippet(text, max = 70) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

function renderManage() {
  // el admin gestiona todas las notas del corcho; los demas, solo las suyas
  const admin = me.role === 'admin';
  $('#manage-title').textContent = admin ? '🗂️ Todas las notas' : '🗂️ Mis notas';
  $('#manage-hint').textContent = admin
    ? 'De mas vieja a mas nueva. Como admin puedes borrar cualquiera, la firme quien la firme.'
    : 'De mas vieja a mas nueva. Marca las que quieras quitar del corcho.';
  $('#manage-empty').textContent = admin ? 'El corcho esta vacio.' : 'No tienes ninguna nota colgada todavía.';
  const mine = notes
    .filter((n) => admin || n.created_by === me.id)
    .sort((a, b) => a.id - b.id);           // de mas vieja a mas nueva
  $('#manage-empty').classList.toggle('hidden', mine.length > 0);
  $('#manage-list').innerHTML = mine
    .map(
      (n) => `<li class="manage-item">
        <input type="checkbox" id="msel-${n.id}" data-id="${n.id}" aria-label="Seleccionar nota" />
        <label class="manage-snip" for="msel-${n.id}">${escapeHtml(snippet(n.text))}</label>
        ${admin ? `<span class="manage-by">${escapeHtml(n.author)}</span>` : ''}
        <span class="manage-date">${shortDate(n.created_at)}</span>
      </li>`
    )
    .join('');
  updateManageDelete();
}

function selectedManage() {
  return [...$('#manage-list').querySelectorAll('input:checked')].map((i) => Number(i.dataset.id));
}

function updateManageDelete() {
  const n = selectedManage().length;
  const btn = $('#manage-delete');
  btn.disabled = n === 0;
  btn.textContent = n ? `Eliminar seleccionadas (${n})` : 'Eliminar seleccionadas';
}

function openManage() {
  $('#manage-error').classList.add('hidden');
  renderManage();
  $('#manage-modal').classList.remove('hidden');
}

function closeManage() {
  $('#manage-modal').classList.add('hidden');
}

// ---------- eventos UI ----------
function bindUI() {
  $('#btn-new').addEventListener('click', () => openModal(null));
  $('#modal-close').addEventListener('click', closeModal);
  $('#note-cancel').addEventListener('click', closeModal);
  $('#note-text').addEventListener('input', () => {
    $('#note-count').textContent = String($('#note-text').value.length);
  });

  $('#note-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { text: $('#note-text').value, color: pickedColor };
    try {
      if (editing) await api(`/notes/${editing.id}`, { method: 'PUT', body });
      else await api('/notes', { method: 'POST', body });
      closeModal();
      await refresh();
    } catch (err) { modalError(err); }
  });

  $('#note-delete').addEventListener('click', async () => {
    if (!editing) return;
    if (!deleteArmed) {
      // segundo clic confirma: mas simple que un modal dentro del modal
      deleteArmed = true;
      $('#note-delete').textContent = '¿Seguro? Clic otra vez';
      return;
    }
    try {
      await api(`/notes/${editing.id}`, { method: 'DELETE' });
      closeModal();
      await refresh();
    } catch (err) { modalError(err); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
  });

  // ----- gestionar notas -----
  if (me.role === 'admin') $('#btn-manage').textContent = '🗂️ Gestionar todas las notas';
  $('#btn-manage').addEventListener('click', openManage);
  $('#manage-close').addEventListener('click', closeManage);
  $('#manage-cancel').addEventListener('click', closeManage);
  $('#manage-list').addEventListener('change', updateManageDelete);
  $('#manage-delete').addEventListener('click', async () => {
    const ids = selectedManage();
    if (!ids.length) return;
    if (!confirm(`¿Eliminar ${ids.length} ${ids.length === 1 ? 'nota' : 'notas'} del corcho?`)) return;
    try {
      for (const id of ids) await api(`/notes/${id}`, { method: 'DELETE' });
      await refresh();       // corcho al dia
      renderManage();        // la lista se queda abierta, ya sin las borradas
    } catch (err) {
      const el = $('#manage-error');
      el.textContent = err.message;
      el.classList.remove('hidden');
      await refresh().then(renderManage); // refrescar igualmente lo que haya cambiado
    }
  });
}

boot();
