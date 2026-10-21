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
  $('#tab-admin').classList.toggle('hidden', state.me.role !== 'admin');
  buildFilters();
  buildWeekdays();
  await loadMonth();
}

// ---------- pestañas ----------
$('#tab-cal').addEventListener('click', () => switchTab('cal'));
$('#tab-admin').addEventListener('click', () => switchTab('admin'));
function switchTab(which) {
  $('#tab-cal').classList.toggle('active', which === 'cal');
  $('#tab-admin').classList.toggle('active', which === 'admin');
  $('#view-cal').classList.toggle('hidden', which !== 'cal');
  $('#view-admin').classList.toggle('hidden', which !== 'admin');
  if (which === 'admin') renderUsers();
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

// ---------- administración de usuarios ----------
async function renderUsers() {
  const users = await api('/users');
  $('#user-rows').innerHTML = users
    .map((u) => `<tr data-id="${u.id}">
      <td>${escapeHtml(u.username)}</td>
      <td>${u.role}</td>
      <td>${u.active ? 'activa' : 'desactivada'}</td>
      <td class="actions">
        <button data-act="pass" class="btn ghost">Nueva contraseña</button>
        <button data-act="toggle" class="btn ghost">${u.active ? 'Desactivar' : 'Activar'}</button>
        <button data-act="del" class="btn danger">Eliminar</button>
      </td>
    </tr>`)
    .join('');
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/users', { method: 'POST', body: { username: $('#nu-name').value, password: $('#nu-pass').value, role: $('#nu-role').value } });
    $('#nu-name').value = ''; $('#nu-pass').value = '';
    adminMsg('Cuenta creada ✓');
    renderUsers();
  } catch (err) { adminMsg(err.message); }
});

$('#user-rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'pass') {
      const p = prompt('Nueva contraseña (mín. 8 caracteres):');
      if (!p) return;
      await api(`/users/${id}`, { method: 'PUT', body: { password: p } });
      adminMsg('Contraseña actualizada ✓');
    } else if (act === 'toggle') {
      const row = btn.closest('tr');
      await api(`/users/${id}`, { method: 'PUT', body: { active: row.children[2].textContent === 'desactivada' } });
      adminMsg('Estado actualizado ✓');
    } else if (act === 'del') {
      if (!confirm('¿Eliminar esta cuenta?')) return;
      await api(`/users/${id}`, { method: 'DELETE' });
      adminMsg('Cuenta eliminada ✓');
    }
    renderUsers();
  } catch (err) { adminMsg(err.message); }
});

function adminMsg(msg) { $('#admin-msg').textContent = msg; }

boot();
