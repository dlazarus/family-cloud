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
      el.title = 'Clic para editar';
    }
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
    author.textContent = `Cuelgue de ${note.author} · ${shortDate(note.created_at)}`;
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
}

boot();
