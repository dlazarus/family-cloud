'use strict';

// ---------- mi cuenta: tema de colores + cambio de propia contraseña ----------

// Los muestrarios se construyen con PALETTES (definida en common.js, que es la
// misma lista que usa el CSS). Cada boton lleva data-palette, y el CSS pinta
// cada boton con los colores de ESA paleta (selectores .pal[data-palette=...]).
$('#pal-grid').innerHTML = PALETTES.map((p) => `
  <button type="button" class="pal" data-palette="${p.id}" aria-pressed="false" title="Tema ${p.label}">
    <span class="pal-demo"></span>
    <span class="pal-name">${p.label}</span>
  </button>`).join('');
applyPaletteWidgets();

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
