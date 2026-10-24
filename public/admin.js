'use strict';

// ---------- administracion: gestion de cuentas de la familia (solo admin) ----------

async function boot() {
  me = await requireUser();
  if (!me) return;
  if (me.role !== 'admin') { location.replace('/'); return; } // los miembros no entran aqui
  initTopbar(me);
  await renderUsers();
  await renderUsage();
}

let me = null;

async function renderUsers() {
  const users = await api('/users');
  $('#user-rows').innerHTML = users
    .map((u) => {
      const self = u.id === me.id;
      const system = u.username.toLowerCase() === 'admin';
      let actions;
      if (self) {
        actions = '<span class="muted">tu cuenta</span>';
      } else if (system) {
        actions = '<span class="muted">cuenta del sistema · solo ella cambia su contraseña</span>';
      } else {
        actions = `<button data-act="pass" class="btn ghost">Nueva contraseña</button>
                   <button data-act="toggle" class="btn ghost">${u.active ? 'Desactivar' : 'Activar'}</button>
                   <button data-act="del" class="btn danger">Eliminar</button>`;
      }
      return `<tr data-id="${u.id}">
        <td>${escapeHtml(u.username)}</td>
        <td>${u.role}</td>
        <td>${u.active ? 'activa' : 'desactivada'}</td>
        <td class="actions">${actions}</td>
      </tr>`;
    })
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

// ---------- dialogo de nueva contraseña ----------
let pwTargetId = null;

function openPwModal(id, username) {
  pwTargetId = id;
  $('#pw-title').textContent = `Nueva contraseña para “${username}”`;
  $('#pw-input').value = '';
  $('#pw-input').type = 'password';
  $('#pw-eye').textContent = '👁';
  $('#pw-error').classList.add('hidden');
  $('#pw-modal').classList.remove('hidden');
  $('#pw-input').focus();
}
function closePwModal() {
  pwTargetId = null;
  $('#pw-modal').classList.add('hidden');
}

$('#pw-cancel').addEventListener('click', closePwModal);
$('#pw-modal').addEventListener('click', (e) => { if (e.target.id === 'pw-modal') closePwModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePwModal(); });

$('#pw-save').addEventListener('click', async () => {
  if (!pwTargetId) return;
  const p = $('#pw-input').value;
  if (!p || p.length < 8) { $('#pw-error').textContent = 'La contraseña debe tener al menos 8 caracteres.'; $('#pw-error').classList.remove('hidden'); return; }
  try {
    await api(`/users/${pwTargetId}`, { method: 'PUT', body: { password: p } });
    closePwModal();
    adminMsg('Contraseña actualizada ✓');
    renderUsers();
  } catch (err) {
    $('#pw-error').textContent = err.message;
    $('#pw-error').classList.remove('hidden');
  }
});

$('#user-rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const row = btn.closest('tr');
  const id = row.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'pass') {
      openPwModal(Number(id), row.children[0].textContent);
    } else if (act === 'toggle') {
      await api(`/users/${id}`, { method: 'PUT', body: { active: row.children[2].textContent === 'desactivada' } });
      adminMsg('Estado actualizado ✓');
      renderUsers();
    } else if (act === 'del') {
      if (!confirm('¿Eliminar esta cuenta?')) return;
      await api(`/users/${id}`, { method: 'DELETE' });
      adminMsg('Cuenta eliminada ✓');
      renderUsers();
    }
  } catch (err) { adminMsg(err.message); }
});

// ---------- ajustes de archivos (cupos y nombre de la carpeta compartida) ----------
const fmtSize = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n) || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};

async function renderUsage() {
  const info = await api('/users/usage');
  $('#g-quota').value = info.global_quota_mb;
  $('#g-shared').value = info.shared_folder_name;
  $('#usage-rows').innerHTML = info.users
    .map((u) => {
      // porcentaje sobre el cupo EN VIGOR (el propio o el defecto); sin limite no hay %
      const pct = u.unlimited || u.effective_mb <= 0
        ? ''
        : ` <span class="muted small-note">(${Math.round((u.used_bytes / (u.effective_mb * 1024 * 1024)) * 100)} %)</span>`;
      return `<tr data-id="${u.id}">
      <td>${escapeHtml(u.username)}</td>
      <td>${fmtSize(u.used_bytes)}${pct}</td>
      <td><input class="quota-input" type="number" min="0" step="1" value="${u.quota_mb ?? ''}" placeholder="(defecto)" /></td>
      <td>${u.unlimited ? 'sin limite' : fmtSize(u.effective_mb * 1024 * 1024)}</td>
      <td class="actions"><button data-act="quota" class="btn ghost">Guardar cupo</button></td>
    </tr>`;
    })
    .join('');
  renderUsageTotals(info.total);
}

// Resumen del servicio: lo que ocupa de verdad y lo que reservan los cupos.
function renderUsageTotals(t) {
  if (!t) return;
  const reserved = t.quota_bytes === null ? 'sin limite' : fmtSize(t.quota_bytes);
  $('#usage-foot').innerHTML = `<tr class="usage-sum">
    <td>Total</td>
    <td>${fmtSize(t.used_bytes)}</td>
    <td class="sum-note">${t.own_count} de ${t.users} con cupo propio</td>
    <td>${reserved}</td>
    <td>${t.disk_free_bytes == null ? '' : `💽 ${fmtSize(t.disk_free_bytes)} libres en disco`}</td>
  </tr>`;

  const parts = [`Las cuentas suman ${fmtSize(t.used_bytes)} en disco`];
  if (t.quota_bytes === null) {
    parts.push(`el cupo total es sin limite (${t.unlimited} de ${t.users} cuenta${t.unlimited === 1 ? '' : 's'} sin tope)`);
  } else {
    const pct = t.quota_bytes > 0 ? Math.min(100, Math.round((t.used_bytes / t.quota_bytes) * 1000) / 10) : 0;
    parts.push(`${fmtSize(t.quota_bytes)} reservados por cupos (se ha usado el ${pct} %)`);
    if (t.disk_total_bytes && t.quota_bytes > t.disk_total_bytes) {
      parts.push('ojo: lo reservado supera la capacidad del disco');
    }
  }
  if (t.disk_free_bytes == null) {
    parts.push(`el disco de archivos (${t.disk_path}) no esta accesible`);
  } else {
    parts.push(`en ${t.disk_path} quedan ${fmtSize(t.disk_free_bytes)} libres de ${fmtSize(t.disk_total_bytes)}`);
  }
  $('#usage-disk').textContent = parts.join(' · ') + '.';
}

$('#g-save').addEventListener('click', async () => {
  try {
    await api('/users/settings', {
      method: 'PUT',
      body: { file_quota_mb: Number($('#g-quota').value), shared_folder_name: $('#g-shared').value },
    });
    adminMsg('Ajustes de archivos guardados ✓');
    renderUsage();
  } catch (err) { adminMsg(err.message); }
});

$('#usage-rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="quota"]');
  if (!btn) return;
  const tr = btn.closest('tr');
  const raw = tr.querySelector('.quota-input').value.trim();
  try {
    await api(`/users/${tr.dataset.id}`, { method: 'PUT', body: { quota_mb: raw === '' ? null : Number(raw) } });
    adminMsg('Cupo actualizado ✓');
    renderUsage();
  } catch (err) { adminMsg(err.message); }
});

function adminMsg(msg) { $('#admin-msg').textContent = msg; }

boot();
