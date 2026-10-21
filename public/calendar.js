'use strict';

// ---------- calendario + administración de usuarios ----------

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const WEEKDAYS = ['lun','mar','mié','jue','vie','sáb','dom'];
const CATS = {
  cumple: { label: '🎂', name: 'Cumpleaños' },
  comida: { label: '🍝', name: 'Comida' },
  viaje:  { label: '✈️', name: 'Viaje' },
  tarea:  { label: '🔧', name: 'Tarea' },
  salud:  { label: '🩺', name: 'Salud' },
  otro:   { label: '📌', name: 'Otro' },
};

const state = {
  me: null,
  view: new Date(),          // mes mostrado
  events: [],
  filter: new Set(Object.keys(CATS)),
  editing: null,             // evento en edición (null = nuevo)
};

// ---------- arranque ----------
async function boot() {
  state.me = await requireUser();
  if (!state.me) return;
  initTopbar(state.me);
  buildFilters();
  buildWeekdays();
  await loadMonth();
}

// ---------- calendario ----------
function buildWeekdays() {
  $('#weekdays').innerHTML = WEEKDAYS.map((w) => `<div>${w}</div>`).join('');
}

function buildFilters() {
  $('#filters').innerHTML = Object.entries(CATS)
    .map(([k, c]) => `<label class="chip-filter cat-${k}"><input type="checkbox" data-cat="${k}" checked /> ${c.label} ${c.name}</label>`)
    .join('');
  $('#filters').addEventListener('change', (e) => {
    const cat = e.target.dataset.cat;
    if (!cat) return;
    e.target.checked ? state.filter.add(cat) : state.filter.delete(cat);
    renderGrid();
  });
}

async function loadMonth() {
  const y = state.view.getFullYear();
  const m = state.view.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  // ampliación para semanas del grid
  const from = ymd(new Date(first.getTime() - 7 * 86400000));
  const to = ymd(new Date(last.getTime() + 7 * 86400000));
  state.events = await api(`/events?from=${from}&to=${to}`);
  renderGrid();
}

function renderGrid() {
  const y = state.view.getFullYear();
  const m = state.view.getMonth();
  $('#cal-title').textContent = `${MONTHS[m]} ${y}`;

  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // lunes = 0
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const today = ymd(new Date());

  const byDate = new Map();
  for (const ev of state.events) {
    if (!state.filter.has(ev.category)) continue;
    // eventos multiday: aparecer en cada día del rango
    const start = ev.date;
    const end = ev.end_date || ev.date;
    let d = new Date(start + 'T00:00:00');
    const endD = new Date(end + 'T00:00:00');
    while (d <= endD && ymd(d) <= ymd(new Date(y, m + 1, 0))) {
      const key = ymd(d);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(ev);
      d = new Date(d.getTime() + 86400000);
    }
  }

  let html = '';
  for (let i = 0; i < cells; i++) {
    const date = new Date(y, m, i - lead + 1);
    const key = ymd(date);
    const inMonth = date.getMonth() === m;
    const evs = byDate.get(key) || [];
    const chips = evs.slice(0, 3)
      .map((ev) => `<button class="chip cat-${ev.category}" data-id="${ev.id}" title="${escapeHtml(ev.title)}">${CATS[ev.category].label} ${escapeHtml(ev.title)}</button>`)
      .join('');
    const more = evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : '';
    html += `<div class="cell ${inMonth ? '' : 'dim'} ${key === today ? 'today' : ''}" data-date="${key}">
      <span class="daynum">${date.getDate()}</span>
      <div class="chips">${chips}${more}</div>
    </div>`;
  }
  $('#cal-grid').innerHTML = html;
}

$('#cal-grid').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) {
    openModal(state.events.find((ev) => ev.id === Number(chip.dataset.id)));
    return;
  }
  const cell = e.target.closest('.cell');
  if (cell) openModal(null, cell.dataset.date);
});

$('#prev').addEventListener('click', () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1); loadMonth(); });
$('#next').addEventListener('click', () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1); loadMonth(); });
$('#today').addEventListener('click', () => { state.view = new Date(); loadMonth(); });

// ---------- modal de evento ----------
function openModal(ev, date) {
  state.editing = ev || null;
  $('#modal-title').textContent = ev ? 'Editar evento' : 'Nuevo evento';
  $('#ev-title').value = ev?.title || '';
  $('#ev-date').value = ev?.date || date || ymd(new Date());
  $('#ev-end').value = ev?.end_date || '';
  $('#ev-cat').value = ev?.category || 'otro';
  $('#ev-desc').value = ev?.description || '';
  $('#ev-delete').classList.toggle('hidden', !ev);
  $('#modal-error').classList.add('hidden');
  $('#modal').classList.remove('hidden');
  $('#ev-title').focus();
}

function closeModal() {
  $('#modal').classList.add('hidden');
  state.editing = null;
}

$('#ev-cancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: $('#ev-title').value,
    date: $('#ev-date').value,
    end_date: $('#ev-end').value || null,
    category: $('#ev-cat').value,
    description: $('#ev-desc').value,
  };
  try {
    if (state.editing) await api(`/events/${state.editing.id}`, { method: 'PUT', body });
    else await api('/events', { method: 'POST', body });
    await loadMonth();
    closeModal();
  } catch (err) {
    const el = $('#modal-error');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
});

$('#ev-delete').addEventListener('click', async () => {
  if (!state.editing || !confirm('¿Eliminar este evento?')) return;
  await api(`/events/${state.editing.id}`, { method: 'DELETE' });
  await loadMonth();
  closeModal();
});

boot();
