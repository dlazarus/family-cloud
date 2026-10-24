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
  ocio:   { label: '🎉', name: 'Ocio' },
  cole:   { label: '🎓', name: 'Cole' },
  otro:   { label: '📌', name: 'Otro' },
};

const state = {
  me: null,
  view: new Date(),          // mes mostrado
  events: [],
  upcoming: [],              // eventos de los proximos 3 meses
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
  await Promise.all([loadMonth(), loadUpcoming()]);
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
    renderUpcoming();
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

// ---------- proximos eventos ----------
const UPCOMING_DAYS = 92;   // horizonte: ~3 meses
const UPCOMING_MAX = 12;    // maximo de eventos listados

async function loadUpcoming() {
  const now = new Date();
  const from = ymd(now);
  const to = ymd(new Date(now.getTime() + UPCOMING_DAYS * 86400000));
  state.upcoming = await api(`/events?from=${from}&to=${to}`);
  renderUpcoming();
}

function fmtDay(dateStr) {
  return new Date(dateStr + 'T00:00:00')
    .toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/\./g, '');
}

function renderUpcoming() {
  const items = state.upcoming
    .filter((ev) => state.filter.has(ev.category))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || '') || a.id - b.id)
    .slice(0, UPCOMING_MAX);
  $('#upcoming-empty').classList.toggle('hidden', items.length > 0);
  $('#upcoming-list').innerHTML = items.map((ev) => {
    const isToday = ymd(new Date()) === ev.date;
    const range = ev.end_date && ev.end_date > ev.date
      ? `${fmtDay(ev.date)} → ${fmtDay(ev.end_date)}`
      : fmtDay(ev.date);
    const time = ev.start_time ? ` · ${ev.start_time}${ev.end_time ? '–' + ev.end_time : ''}` : '';
    return `<li class="upcoming-item cat-${ev.category}" data-id="${ev.id}">
      <span class="upcoming-date${isToday ? ' today' : ''}">${range}${time}${isToday ? ' · hoy' : ''}</span>
      <span class="upcoming-title">${CATS[ev.category].label} ${escapeHtml(ev.title)}${ev.author ? ` <span class="upcoming-author">(${escapeHtml(ev.author)})</span>` : ''}</span>
    </li>`;
  }).join('');
}

$('#upcoming-list').addEventListener('click', (e) => {
  const li = e.target.closest('.upcoming-item');
  if (!li) return;
  const ev = state.upcoming.find((x) => x.id === Number(li.dataset.id));
  if (ev) openModal(ev);
});

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
      .map((ev) => {
        // el tooltip lleva el titulo, las horas (si las hay) y la autoría entre paréntesis
        const tip = ev.title + (ev.start_time ? ` · ${ev.start_time}${ev.end_time ? '–' + ev.end_time : ''}` : '')
          + (ev.author ? ` (${ev.author})` : '');
        return `<button class="chip cat-${ev.category}" data-id="${ev.id}" title="${escapeHtml(tip)}">${CATS[ev.category].label} ${escapeHtml(ev.title)}</button>`;
      })
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
  $('#ev-start').value = ev?.start_time || '';
  $('#ev-end-time').value = ev?.end_time || '';
  $('#ev-cat').value = ev?.category || 'otro';
  $('#ev-desc').value = ev?.description || '';
  // autoría: solo indicativa (no editable); quien creo el evento es el unico que puede cambiarlo
  const authorEl = $('#ev-author');
  if (ev?.author) { authorEl.textContent = `autoría: ${ev.author}`; authorEl.classList.remove('hidden'); }
  else authorEl.classList.add('hidden');
  const mine = !ev || ev.created_by == null || ev.created_by === state.me.id;
  state.canEdit = mine;
  const saveBtn = $('#ev-save');
  saveBtn.classList.toggle('off', !!ev && !mine);
  saveBtn.title = mine ? '' : 'Solo quien creo este evento puede editarlo';
  $('#ev-delete').classList.toggle('hidden', !ev || !mine);
  $('#modal-error').classList.add('hidden');
  $('#modal').classList.remove('hidden');
  $('#ev-title').focus();
}

function closeModal() {
  $('#modal').classList.add('hidden');
  state.editing = null;
}

$('#ev-cancel').addEventListener('click', closeModal);
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.editing && !state.canEdit) {
    const el = $('#modal-error');
    el.textContent = 'Solo el autor de un evento puede modificarlo o borrarlo.';
    el.classList.remove('hidden');
    return;
  }
  const body = {
    title: $('#ev-title').value,
    date: $('#ev-date').value,
    end_date: $('#ev-end').value || null,
    start_time: $('#ev-start').value || null,
    end_time: $('#ev-end-time').value || null,
    category: $('#ev-cat').value,
    description: $('#ev-desc').value,
  };
  try {
    if (state.editing) await api(`/events/${state.editing.id}`, { method: 'PUT', body });
    else await api('/events', { method: 'POST', body });
    await Promise.all([loadMonth(), loadUpcoming()]);
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
  await Promise.all([loadMonth(), loadUpcoming()]);
  closeModal();
});

boot();
