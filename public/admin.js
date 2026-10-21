'use strict';

// ---------- administracion: gestion de cuentas de la familia (solo admin) ----------

async function boot() {
  me = await requireUser();
  if (!me) return;
  if (me.role !== 'admin') { location.replace('/'); return; } // los miembros no entran aqui
  initTopbar(me);
  await renderUsers();
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

function adminMsg(msg) { $('#admin-msg').textContent = msg; }

boot();
