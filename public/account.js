'use strict';

// ---------- mi cuenta: cambio de propia contraseña (cualquier usuario) ----------

async function boot() {
  const me = await requireUser();
  if (!me) return;
  initTopbar(me);
}

$('#pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#account-msg');
  msg.textContent = '';
  const cur = $('#cur-pass').value;
  const nw = $('#new-pass').value;
  const nw2 = $('#new-pass2').value;
  if (nw !== nw2) { msg.textContent = '⚠️ La nueva contraseña y la repetición no coinciden.'; return; }
  try {
    await api('/me/password', { method: 'PUT', body: { current_password: cur, new_password: nw } });
    $('#pass-form').reset();
    msg.textContent = '✓ Contraseña cambiada. La próxima vez entra con la nueva.';
  } catch (err) {
    msg.textContent = `⚠️ ${err.message}`;
  }
});

boot();
