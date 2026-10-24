# CHANGELOG

## Sin publicar (sobre v0.2.4)

- **Calendario — horas opcionales en los eventos**: entre las fechas y la categoría hay
  dos campos nuevos, «Hora inicio» y «Hora fin» (del mismo tamaño que los de fecha).
  Son opcionales; la de fin exige la de inicio y no puede ser anterior. Cuando un evento
  tiene hora, esta sale en el resumen «Próximos eventos» (p. ej. `vie 6 nov · 18:30–20:00`)
  y en el tooltip al pasar el ratón por la celda del calendario; la lista de próximos
  ordena también por hora. En la base de datos son columnas nuevas (`start_time`,
  `end_time`, migración automática al arrancar) guardadas en claro: no son sensibles y
  permiten ordenar/filtrar.

- **Administración → cupos**: al lado de lo ocupado por cada cuenta sale ahora el
  porcentaje sobre su cupo en vigor, p. ej. `1,2 GB (31 %)`; con cuentas sin limite no
  se muestra porcentaje.

- **Archivos — carpetas vacías ajenas**: en una carpeta compartida de OTRO usuario que
  esté vacía ya no sale el mensaje invitando a «Usa ⬆ Subir o arrastra archivos aquí»
  (no se puede escribir ahí); sale solo «Esta carpeta esta vacia.». La invitación a
  subir se mantiene en las carpetas propias.

- **Administración → cupos**: el espacio libre del disco de archivos ahora sale TAMBIEN
  en la fila de totales, al lado del cupo total y con el mismo tamaño de letra
  («💽 167 GB libres en disco») — la nota pequeña seguía siendo demasiado discreta. Y se
  añade respiro entre esa fila y las notas explicativas.

## v0.2.4 — 2026-10-24

- **FIX CRÍTICO — la tarjeta Archivos daba 500 siempre** (`GET /api/files/`, uso, y el
  chequeo de cupo de las subidas): `quotaFor` esperaba el OBJETO usuario (`user.id`) pero
  todos los sitios que lo llaman pasan el ID (`u.id`) desde su primer commit — al buscar
  `.id` en un número sale `undefined` y SQLite rechaza el parámetro. Consecuencia visible:
  lista de archivos vacía + «error 500» al crear carpetas (la carpeta SÍ se creaba en la
  base de datos; lo que fallaba era el refresco posterior). Ahora `quotaFor(userId)`,
  coherente con las 5 llamadas. Probado de punta a punta en local: setup, login, lista,
  carpeta, subida, descarga y uso, todo 200/201.

- **BUG REAL del instalador — el disco de archivos quedaba de SOLO LECTURA para el
  servicio**: las dos lineas `ReadWritePaths` (DATA_DIR y FILES_DIR) se insertaban con un
  unico `sed` multilinea, y GNU sed insertaba SOLO la primera y descartaba la segunda EN
  SILENCIO (exit 0). Con `ProtectSystem=strict`, FILES_DIR quedaba no escribible: la
  pagina de archivos avisaba «el almacenamiento de archivos no esta disponible» y las
  subidas fallaban, aunque la prueba de escritura del propio instalador pasara (la hace
  fuera de la caja de sandbox de systemd). Ahora cada linea se inserta con su propio sed,
  y el instalador VERIFICA despues que la unidad declara efectivamente las dos rutas.

## v0.2.3 — 2026-10-24

- **El instalador ya no pregunta dos veces las rutas y los cupos**: al crear el `.env`
  de cero, `gen-env.js` ya pregunta `DATA_DIR`, `FILES_DIR`, cupo y tope; la ronda de
  repregunta del instalador aparecía inmediatamente después con esos mismos valores por
  defecto (doble pregunta en toda instalación de cero). Ahora esa ronda solo se muestra
  para RE-ajustar un `.env` que ya existía.

- **README: la puesta en marcha empieza por `sudo ./scripts/install.sh`**. Antes el
  bloque «Puesta en marcha (primera vez)」listaba los pasos manuales (`npm install`,
  `gen-env.js`, `npm start`), que el instalador ya hace y que además parecen LA
  instalacion al estar los primeros. La secuencia manual se queda como subapartado
  explicito «Probar sin instalar (desarrollo o ensayo)».

- **Adios a la pista de AdGuard Home**: el instalador y el README ya no dan por hecho
  que la LAN usa AdGuard Home ni un nombre `cloud.lan`. Los pasos finales solo dicen la
  URL con la IP; el nombre bonito es opcional y cosa del servidor DNS que cada uno use
  (AdGuard, Pi-hole, el router…) o de usar la IP directamente.

## v0.2.2 — 2026-10-24

- **`start.sh` renombrado y movido**: el arranque manual de pruebas vive ahora en
  `scripts/server-manual-test.sh` (antes `start.sh` en la raiz del proyecto, facil de
  confundir con el script de instalacion; lo de produccion es `scripts/install.sh` +
  systemd).

## v0.2.1 — 2026-10-24

- **Instalador más claro al empezar**: ahora muestra los **discos y puntos de montaje
  detectados ANTES de preguntar las rutas** de `DATA_DIR`/`FILES_DIR` (antes la tabla
  `lsblk` salia despues, cuando las rutas ya estaban escritas) y **aborta con un mensaje
  explicito si faltan las dependencias** (`node_modules`): sin ellas el servicio entraba
  en bucle de reinicios con `ERR_MODULE_NOT_FOUND` y el unico modo de enterarse era el
  `journalctl`.
- **Aviso de `node_modules` con el `sudo` puesto**: el mensaje dice `sudo npm install`
  (en un proyecto copiado a /srv como root, un `npm install` de usuario corriente deja
  los ficheros sin permisos para el servicio).

## v0.2.0 — 2026-10-24

Nueva tarjeta **📁 Archivos**: nube de archivos familiar con cifrado individual por
archivo y cupo por cuenta. Sin dependencias nuevas (el ZIP también es propio).

- **Archivos por cuenta**: subir (botón o arrastrar casi sobre toda la página, con
  un aviso grande que dice a qué carpeta van), crear carpetas (ENTER guarda),
  renombrar, descargar, borrar en cascade y descargar una carpeta entera como **ZIP**
  generado al vuelo (`src/zip.js`, sin dependencias ni temporeros en disco; sin Zip64
  el tope son 4 GB, y se avisa en vez de generar un zip roto). Los .zip se comprueban
  con `unzip -t`, `bsdtar` y `python zipfile`: bandera de data descriptor correcta
  (bit 3), nombres UTF-8 y rutas de carpeta bien formadas.
- **Manejo tipo Drive**: clic en un archivo lo selecciona (ya no lo descarga) y doble
  clic lo abre; selección múltiple con `Ctrl+clic`, `Shift+clic`, `Ctrl+A` o
  arrastrando el ratón sobre el hueco libre; barra flotante con «⬇ Descargar», «Mover
  a…» y «Eliminar» (en el móvil la barra pasa a ser una barra de acciones ancha); y
  **mover arrastrando** una fila o la selección entera sobre otra carpeta, sobre un
  tramo del camino o sobre el hueco libre (= carpeta actual).
- **Descargar en lote**: un archivo suelto se baja tal cual; una selección mixta
  (archivos y carpetas) se baja en **un único .zip** llamado como la carpeta o
  «seleccion-N». Los homónimos se renombran dentro del .zip («foto.jpg (2)»), una
  carpeta elegida junto a algo de su interior solo se descarga una vez, y una carpeta
  anidada conserva su ruta relativa dentro del zip.
- **Cifrado en streaming**: cada archivo se cifra con AES-256-GCM al subir y se
  descifra al bajar, por trozos — un archivo de 3 GB no necesita 3 GB de RAM. La
  llave va ligada al id del archivo (AAD), así que copiar un blob a otra parte no
  sirve. En la base de datos **los nombres también van cifrados** (`name_enc`).
- **CARPETA-COMPARTIDA**: cada cuenta tiene una carpeta compartida claramente
  diferenciada (borde de color, icono de familia y subtítulo) y una segunda vista
  «👥 Lo que comparte la familia» con lo de los demás en **solo lectura** (no se
  puede crear, subir ni borrar dentro de lo ajeno). Tu propia compartida aparece en
  las dos vistas y se comporta igual desde ambas. El nombre lo cambia el admin de
  un golpe y aplica a todas las cuentas; nadie puede crear un archivo con ese nombre.
- **Compartir arrastrando**: mover algo a la carpeta compartida (o sacarlo de ella)
  cambia el **alcance** de ese nodo y de todo su subárbol de una vez — deja de ser
  privado y lo ve la familia, o vuelve a ser privado. Los blobs no se reescriben.
- **Cupos**: 4 GB por cuenta por defecto, editables por el admin en global o por
  cuenta (0 = sin límite); se comprueban al empezar y al terminar la subida. Al
  borrar una cuenta se borran también sus archivos del disco.
- **Totales del servicio en Administración**: la tabla de cupos termina en una fila
  **Total** (sumas de lo ocupado y de lo reservado por los cupos en vigor, y cuántas
  cuentas tienen cupo propio) y debajo sale una frase con el tamaño del servicio y el
  disco real: `Las cuentas suman 1,2 GB en disco · 24 GB reservados por cupos (se ha
  usado el 5 %) · en /mnt/disco-grande/nube quedan 890 GB libres de 1,9 TB`. Con
  alguna cuenta sin límite la reserva se muestra como «sin límite» (se dice cuántas),
  y si lo reservado supera la capacidad del disco se avisa. Los datos los aporta
  `/api/users/usage`, que ahora incluye `total` (usado, reserva, cuentas sin tope y
  espacio libre/capacidad del `FILES_DIR`, leídos con `fs.statfsSync`).
- **Temas de color en «Mi cuenta»** (cada uno con su variante clara y oscura):
  - 11 temas: el de siempre (*Predeterminado*), rojo, naranja, amarillo, verde,
    azul, violeta, mar (verde+azul), neón, blanco y negro y sepia. Se eligen en un
    muestrario que se pinta con los colores reales de cada tema.
  - La variante clara/oscura es la de siempre (botón ☀/🌙 o «la del sistema»), pero
    ahora tiene un control explícito en «Mi cuenta» (sistema / clara / oscura) que
    se sincroniza con ese botón.
  - Cada tema define además un **segundo color** (`--accent2`) con el que se marca
    lo compartido con la familia: la fila de CARPETA-COMPARTIDA, el borde de las
    filas ajenas y la barra de espacio usado. En los monocolor es una variante del
    principal; en mar, neón y sepia son dos colores distintos.
  - La preferencia vive en `localStorage` (por navegador, no por cuenta) y un script
    en el `<head>` de cada página la aplica antes de pintar: se acabó el destello del
    tema por defecto al cargar, y el claro/oscuro deja de estar duplicado en un
    `@media`.
  - Contraste comprobado en las 22 combinaciones: texto normal ≥ 7, secundario ≥ 4,5
    y etiquetas de botón ≥ 3. Para ello se oscureció el gris del texto apagado en los
    temas claros (en el de siempre sube de 3,4 a 4,9). Excepción documentada: el
    botón salmón de siempre queda en 2,95 con texto blanco.
- **Almacenamiento configurable**: `DATA_DIR` (base de datos, mejor siempre en el
  ext4 del servidor) y `FILES_DIR` (archivos; puede vivir en un disco grande NTFS).
  Utilidades nuevas: `scripts/storage-check.js` (rutas, sistema de archivos, espacio
  y cupos; solo lectura) y `scripts/relocate-data.sh` (mover los datos a otro disco
  sin borrar jamás el origen; admite `--dry-run`).
- **Instalador**: elige las rutas de datos y archivos, muestra el disco real donde
  caen (tipo de sistema de archivos y espacio libre), avisa en NTFS/vfat/FAT con el
  snippet de montaje recomendado (**no monta ni formatea discos**: eso es del
  sysadmin), añade `FILES_DIR` a los `ReadWritePaths` de systemd y termina probando
  que el usuario del servicio **puede escribir** en las dos carpetas. **No toca un
  `.env` que ya exista** (las claves no se regeneran solas). Sin terminal
  (`printf ... | node scripts/gen-env.js`) también funciona: lee las respuestas de
  stdin y usa los valores por defecto donde la linea esta vacia.
- **Robustez**: si `FILES_DIR` apunta a un disco desmontado, el servicio arranca y
  calendario y contraseñas siguen funcionando; la tarjeta de archivos avisa y las
  subidas devuelven 503. No se crean rutas fantasma dentro de un montaje inexistente.
- **Nombres seguros**: se rechazan `\ / : * ? " < > |`, los nombres que terminan en
  punto o espacio y los reservados de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`,
  `LPT1-9`, también con extensión: `CON.txt`), para que los ZIP se puedan extraer en
  cualquier sistema operativo.
- **Arreglos del ZIP** (detectados probando con `unzip -t`, no solo con Python):
  las banderas de los entradas estaban mal (`0x0800|0x8000` en vez de `0x0008|0x0800`,
  así que faltaba el bit del data descriptor y el `0x8000` se leía como «cifrado»):
  Info-ZIP fallaba al descomprimir. Tampoco se cerraba la respuesta HTTP y la
  descarga se quedaba colgada hasta el timeout (ahora tarda ~30 ms), y descargar una
  carpeta anidada generaba entradas `undefined…` dentro del zip.
- **Líneas separadoras de las tablas de administración**: cada línea se cortaba y
  subía 3-4 px justo antes de la columna de botones (un «escalón»; solo la primera
  línea, la de la cabecera, estaba entera). La causa: `.user-table .actions` tenía
  `display:flex` sobre un `<td>`, y una caja que no es `table-cell` no se estira a
  la altura de la fila, así que su `border-bottom` se dibuja más arriba. La celda
  vuelve a ser celda y los botones se alinean con `text-align`. Venía del primer
  commit y también afectaba a la tabla de cuentas (las tres filas de botones).
- **Mover una carpeta dentro de su propia hija** ya no es posible: `isDescendant()`
  salía del bucle antes de comprobar el padre cuando este es una carpeta raíz, así
  que no veía a los hijos directos y se podía romper el árbol (contenido huérfano).
- **API nueva**: `/api/files*` (lista, carpeta, subida, descarga, ZIP de carpeta,
  ZIP de selección `GET /api/files/archive?ids=…`, mover, renombrar, borrar — mover
  admite cambiar el alcance privado↔compartido) y `GET /api/users/usage` +
  `PUT /api/users/settings` para los cupos y el nombre de la carpeta compartida.

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
