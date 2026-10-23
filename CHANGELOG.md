# CHANGELOG

## v0.2.0 — 2026-10-23

Nueva tarjeta **📁 Archivos**: nube de archivos familiar con cifrado individual por
archivo y cupo por cuenta. Sin dependencias nuevas (el ZIP también es propio).

- **Archivos por cuenta**: subir (botón o arrastrar y soltar), crear carpetas,
  renombrar, mover arrastrando una fila sobre otra carpeta, descargar, borrar en
  cascade y descargar una carpeta entera como **ZIP** generado al vuelo
  (`src/zip.js`, sin dependencias ni temporeros en disco).
- **Cifrado en streaming**: cada archivo se cifra con AES-256-GCM al subir y se
  descifra al bajar, por trozos — un archivo de 3 GB no necesita 3 GB de RAM. La
  llave va ligada al id del archivo (AAD), así que copiar un blob a otra parte no
  sirve. En la base de datos **los nombres también van cifrados** (`name_enc`).
- **CARPETA-COMPARTIDA**: cada cuenta tiene una carpeta compartida claramente
  diferenciada (borde de color, icono de familia y subtítulo) y una segunda vista
  «👥 Lo que comparte la familia» con lo de los demás en **solo lectura** (no se
  puede crear, subir ni borrar dentro de lo ajeno). El nombre lo cambia el admin de
  un golpe y aplica a todas las cuentas; nadie puede crear un archivo con ese nombre.
- **Cupos**: 4 GB por cuenta por defecto, editables por el admin en global o por
  cuenta (0 = sin límite); se comprueban al empezar y al terminar la subida. Al
  borrar una cuenta se borran también sus archivos del disco.
- **Almacenamiento configurable**: `DATA_DIR` (base de datos, mejor siempre en el
  ext4 del servidor) y `FILES_DIR` (archivos; puede vivir en un disco grande NTFS).
  Utilidades nuevas: `scripts/storage-check.js` (rutas, sistema de archivos, espacio
  y cupos; solo lectura) y `scripts/relocate-data.sh` (mover los datos a otro disco
  sin borrar jamás el origen; admite `--dry-run`).
- **Instalador**: elige las rutas de datos y archivos, muestra el disco real donde
  caen (tipo de sistema de archivos y espacio libre), avisa en NTFS/vfat/FAT con el
  snippet de montaje recomendado (**no monta ni formatea discos**: eso es del
  sysadmin), añade `FILES_DIR` a los `ReadWritePaths` de systemd y termina probando
  que el usuario del servicio **puede escribir** en las dos carpetas.
- **Robustez**: si `FILES_DIR` apunta a un disco desmontado, el servicio arranca y
  calendario y contraseñas siguen funcionando; la tarjeta de archivos avisa y las
  subidas devuelven 503. No se crean rutas fantasma dentro de un montaje inexistente.
- **Nombres seguros**: se rechazan `\ / : * ? " < > |`, los nombres que terminan en
  punto o espacio y los reservados de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`,
  `LPT1-9`, también con extensión: `CON.txt`), para que los ZIP se puedan extraer en
  cualquier sistema operativo.
- **API nueva**: `/api/files*` (lista, carpeta, subida, descarga, ZIP, mover,
  renombrar, borrar) y `GET /api/users/usage` + `PUT /api/users/settings` para los
  cupos y el nombre de la carpeta compartida.

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
