# CHANGELOG

## v0.1.0 — 2026-10-22

El antiguo **family-calendar** se convierte en **family-cloud**: una nube familiar
local con varios servicios detrás de un mismo login. Hereda del calendario todo lo
que ya funcionaba y añade:

- **Hub de servicios**: tras el login, tarjetas de acceso (multi-página en lugar de
  SPA); la barra superior es idéntica en todas las páginas.
- **🔑 Gestor de contraseñas**: cada usuario con su bóveda privada (cifrado
  AES-256-GCM campo a campo; el admin no ve las entradas de otros), buscador,
  copiar al portapapeles y generador de contraseñas seguras en el servidor
  (`crypto.randomInt`, 8-128 caracteres, opción de evitar ambiguos).
- **👤 Mi cuenta**: cualquier usuario cambia su contraseña (actual + nueva dos veces).
- **⚙️ Administración** como página propia (antes era una pestaña del calendario),
  con garantías de que el servicio nunca se queda sin administración: la cuenta
  `admin` es del sistema (no se puede desactivar, degradar ni eliminar), ningún
  admin puede tocarse a sí mismo, siempre queda un admin activo, y existe rescate
  por consola en el servidor (`scripts/reset-password.js`).
- **Calendario**: sección «Próximos eventos» bajo la vista mensual.
- **Login**: antibruza que solo cuenta intentos fallidos; campos siempre limpios
  (sin autofill) y botón ojo 👁 en todos los campos de contraseña; sesión de 14 días.
- **Base de datos** renombrada `calendar.db` → `family-cloud.db` con migración
  automática al arrancar.

## v0.x — 2025-2026 (como family-calendar)

Calendario familiar local: eventos compartidos cifrados, usuarios con roles,
instalador systemd. Ver historial en el repositorio original.
