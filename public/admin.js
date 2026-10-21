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
        actions = `<button data-act="pass" class="btn ghost">Nueva contraseña</button>
                   <span class="muted">cuenta del sistema</span>`;
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
