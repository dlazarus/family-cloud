# Family Cloud

> [!NOTE]
> **Nota del autor:** no sé programar. Este proyecto está hecho íntegramente con *vibe coding* (lo escriben agentes de IA bajo mi dirección y yo lo pruebo). También soy novato total en GitHub: tenlo en cuenta al leer el código, y si abres un issue o un pull request y tardo en responder (o no sé qué hacer con él), no es desidia — es que literalmente estoy aprendiendo a usar GitHub. Aun así, mi intención es compartir: como amante del software libre, quiero que cualquiera pueda usarlo, clonarlo y probarlo aunque su autor sea un novato.

Nube familiar local (100 % offline en tiempo de ejecución, sin CDN): varios servicios
para casa servidos desde un mismo servidor y detrás de un mismo login. Los datos se
guardan **cifrados** en la base de datos; el acceso requiere usuario y contraseña.

Tras iniciar sesión se abre un **hub** con tarjetas de servicios:

| Servicio | Qué es | Estado |
| --- | --- | --- |
| 🗓️ **Calendario** | Eventos compartidos de toda la familia | ✅ incluido |
| 🔑 **Contraseñas** | Gestor personal de contraseñas, aislado por usuario | ✅ incluido |
| 👤 **Mi cuenta** | Cambio de propia contraseña | ✅ incluido |
| ⚙️ **Administración** | Gestión de cuentas (solo admins) | ✅ incluido |
| 📁 **Archivos** | Nube de archivos familiar, cifrada y con cupo por cuenta | ✅ incluido |
| 📌 **Notas** | El corcho de la familia: post-its compartidos, con colores y firma | ✅ incluido |

---

## Puesta en marcha (primera vez)

Copia el proyecto al servidor y ejecuta el instalador: es la vía recomendada y la
única necesaria (Node 22 si falta, `.env` con la frase maestra, usuario de servicio,
systemd, permisos de las carpetas y firewall — detalle en «Instalación en el servidor
de casa» más abajo):

```bash
cd family-cloud
sudo ./scripts/install.sh
```

Por defecto escucha en **http://0.0.0.0:3000** (configurable en `.env`).

> ⚠️ La frase maestra de `.env` cifra los datos (eventos, contraseñas y archivos). Si
> se pierde, no se pueden recuperar. Haz copias de `.env`, de la base de datos y de la
> carpeta de archivos juntas.

### Probar sin instalar (desarrollo o ensayo)

Para ver la web en marcha en cualquier máquina, sin tocar el sistema (no crea usuario
 de servicio ni systemd; NO es una instalación):

```bash
cd family-cloud
npm install                 # solo la primera vez, requiere internet una vez
node scripts/gen-env.js     # genera .env (pide la frase maestra; guárdala a salvo)
npm start                   # o ./scripts/server-manual-test.sh (arranque en primer plano)
```

## Primer acceso

Al abrir la web por primera vez se pide crear la cuenta de administrador
(usuario `admin` por defecto, contraseña la que elijas). Ese endpoint solo
funciona mientras no exista ningún usuario.

El admin crea las cuentas de la familia desde la tarjeta **⚙️ Administración** del hub.

---

## Servicios incluidos

Tras iniciar sesión se abre un **hub** con tarjetas de los servicios disponibles.

### 🗓️ Calendario

Eventos compartidos por toda la familia: crear, editar y eliminar eventos con fecha
(opcionalmente rango), categoría y notas; filtros por categoría y vista mensual.
Las categorías son 🎂 Cumpleaños, 🍝 Comida, ✈️ Viaje, 🔧 Tarea, 🩺 Salud, 🎉 Ocio
(quedadas, cine, conciertos…), 🎓 Cole y 📌 Otro, cada una con su color.
Todos los usuarios autenticados ven todos los eventos y pueden crear nuevos; cada
evento guarda su autoría (se muestra al pie de la tarjeta de edición) y solo quien lo
creó puede editarlo o borrarlo. Incluye una sección «Próximos eventos» bajo la vista
mensual.

### 🔑 Gestor de contraseñas

Cada usuario guarda sus propias contraseñas (sitio, nombre de acceso y contraseña)
y **solo él** puede verlas y gestionarlas: el administrador no tiene acceso a las
entradas de otros desde la web. Incluye buscador, mostrar/ocultar y copiar al
portapapeles, y un **generador de contraseñas seguras** (longitud de 8 a 128,
tipos de caracteres y opción de evitar caracteres ambiguos) disponible tanto al
crear como al editar una entrada, también como generador independiente. Los tres
campos se guardan cifrados (AES-256-GCM) con la frase maestra; el esquema de la
base de datos está preparado para migrar en el futuro a una clave por usuario
(cifrado que ni el servidor puede leer).

### 📁 Archivos

Cada miembro tiene su espacio de archivos, como un Drive pequeño pero en tu casa.

**Cómo se maneja** (ratón y teclado, como en un Drive):

- **Clic en un archivo** lo selecciona (no lo descarga); **doble clic** lo abre o lo
  descarga. **Clic en una carpeta** entra en ella.
- **Selección múltiple**: `Ctrl+clic`, `Shift+clic`, `Ctrl+A`, o arrastrar el ratón
  sobre el hueco libre de la página. `Supr` borra la selección, `Esc` la limpia.
- **Mover arrastrando**: arrastra una fila (o toda la selección) encima de otra
  carpeta, sobre un tramo del camino de arriba, o suéltala en el hueco libre para
  dejarla en la carpeta actual. También existe «📦 Mover a…» en el menú `⋯`.
- **Compartir al momento**: arrastra un archivo o una carpeta a la
  **CARPETA-COMPARTIDA** y pasa a ser visible para toda la familia (con todo su
  contenido); arrástralo fuera para dejar de compartirlo.
- **Subir arrastrando**: casi toda la página es zona de soltado, con un aviso
  grande que dice a qué carpeta van los archivos.
- **Descargar la selección**: un archivo suelto se baja directo; si hay varios
  elementos o hay carpetas, se bajan en **un único .zip** (generado al vuelo, sin
  temporeros en disco). Si dos elementos elegidos se llaman igual, dentro del .zip el
  segundo pasa a «foto.jpg (2)» en vez de pisarse, y si eliges una carpeta y además
  algo de su interior se descarga una sola vez.
- Descargar una carpeta entera como **ZIP** desde el menú `⋯`, renombrar y borrar con
  todo su contenido desde el menú `⋯`.

- **CARPETA-COMPARTIDA**: cada cuenta tiene una, marcada a propósito (borde de
  color, icono de familia y subtítulo «tuya · la editas tu») para que no haya
  duda de lo que ven los demás. Su nombre lo decide el admin en ⚙️ Administración y
  aplica a todas las cuentas; nadie puede crear un archivo con ese nombre.
- **👥 Lo que comparte la familia**: segunda vista con lo que compartieron los demás,
  en **solo lectura** (se puede descargar y navegar, no modificar). Tu propia
  carpeta compartida también aparece ahí, marcada como tuya y editable igual que
  desde «Mis archivos».
- **Cupo**: 4 GB por cuenta por defecto, ajustables por el admin globalmente o
  cuenta por cuenta (0 = sin límite), con la ocupación visible en la tarjeta.
- **Cifrado**: cada archivo se cifra individualmente (AES-256-GCM) mientras sube y
  mientras baja, en streaming: un archivo de 3 GB no necesita 3 GB de RAM. En el
  disco solo hay blobs opacos; **hasta los nombres** van cifrados en la base de datos.
- No hay vista previa de archivos (descarga y abre); está en el camino.

### 📌 Notas (el corcho)

Un tablero compartido para toda la familia, como un corcho de cocina: recados, avisos
y recordatorios en post-its de colores.

- **Un solo corcho familiar**: todos ven todas las notas (es lo contrario del gestor de
  contraseñas, que es íntimo de cada uno).
- **Colores a elegir**: ocho tonos de post-it (amarillo, rosa, azul, verde, naranja,
  lavanda, coral y menta) con la letra siempre oscura, fácil de leer también en tema oscuro. Se elige
  color al colgar la nota y **se puede cambiar cuando quieras** desde la propia nota;
  si no eliges ninguno, el corcho lo sortea.
- **Firma en la esquina**: cada nota muestra quién la escribió y cuándo; si se editó,
  aparece también la pista «editada».
- **Quién puede tocar qué**: solo el autor (y el admin) puede editar o borrar una nota;
  a los no autores no se les muestra ni el botón «Eliminar». El borrado pide confirmación
  a dos clics.
- **Hasta 500 caracteres** por nota (es un post-it, no un ensayo).
- **Ambiente**: corcho con marco de madera, chinches, rotaciones suaves y letra
  manuscrita (*Patrick Hand*, servida localmente: sin CDNs ni dependencias externas).

### 🗄️ Dónde se guarda todo: `DATA_DIR` y `FILES_DIR`

| Variable | Qué guarda | Dónde conviene |
| --- | --- | --- |
| `DATA_DIR` | La base de datos SQLite (cuentas, eventos, bóvedas y el árbol de nombres de archivos, todo cifrado) | **En el disco del servidor, siempre en ext4**: SQLite en modo WAL necesita bloqueos POSIX fiables |
| `FILES_DIR` | Los archivos cifrados, una carpeta por cuenta | Aquí **sí** puede parar un disco grande, interno o externo |

Las rutas admiten valores relativos (al proyecto) o absolutos, se eligen durante
`scripts/install.sh` y se pueden editar a mano en `.env`. Preparar el disco
(particionar, formatear, montar y tener sitio) **es tarea del administrador**: el
instalador no formatea ni monta discos, solo te avisa si la ruta no existe o si el
sistema de archivos no admite permisos POSIX.

Con **NTFS**, monta la partición con el usuario del servicio como dueño (añade la
línea a `/etc/fstab` con el UUID real; tras cambiar el dueño, `sudo blockdev
--flushbufs /dev/sdXN1` y desmontar y volver a montar):

```
UUID=... /mnt/datos ntfs-3g defaults,uid=FAMILYCLOUD_UID,gid=FAMILYCLOUD_GID,fmask=0137,dmask=0137,nofail 0 0
```

y en `.env`: `FILES_DIR=/mnt/datos/family-cloud-files`. En FAT/exFAT no hay permisos
POSIX: la seguridad son las llaves de cifrado y el acceso físico al disco.

Para llevar la cuenta del disco:

```bash
node scripts/storage-check.js                     # rutas, sistema de archivos, espacio libre y cupos (solo lectura)
scripts/relocate-data.sh --files=/mnt/datos/nube  # mover los archivos a otro disco
scripts/relocate-data.sh --files=/mnt/datos/nube --dry-run   # ensayo sin tocar nada
```

`relocate-data.sh` copia los datos, actualiza `.env`, ajusta los `ReadWritePaths` de
systemd y comprueba que el servicio arranca; **nunca borra el origen**: al final
imprime el comando para que lo borres tú cuando lo veas claro.

Si `FILES_DIR` apunta a un disco desmontado, el servicio **sigue funcionando**
calendario y contraseñas: la tarjeta de archivos avisa («el disco de archivos no
está disponible») y las subidas se rechazan; no se crean carpetas fantasma.

---

## Instalación en el servidor de casa (recomendada: script)

Copia el directorio del proyecto al servidor (p. ej. a `/srv/family-cloud`)
y ejecuta el instalador, que recorre los 6 pasos con mensajes ✓/✗ por paso:

```bash
sudo /srv/family-cloud/scripts/install.sh
```

Qué hace:

1. **Node 22 LTS** — lo detecta si ya está (exige ≥ 22.5 por `node:sqlite`) o lo instala desde NodeSource. Comprueba además que el proyecto tiene las dependencias (`node_modules`): si no, para y avisa de ejecutar `npm install` antes.
2. **Configuración** — muestra los discos y puntos de montaje detectados (para elegir las rutas a la vista), genera `.env` pidiendo la frase maestra (la respeta si ya existe) y pregunta `DATA_DIR`, `FILES_DIR` y el cupo por defecto.
3. **Usuario de servicio y permisos** — crea `familycloud`, `DATA_DIR` y `FILES_DIR`,
   detecta el disco donde van (tipo de sistema de archivos y espacio libre) y aplica
   `chown` (avisa con el snippet de montaje si el destino es NTFS/vfat/FAT).
4. **systemd** — instala la unidad **adaptando la ruta a donde esté el proyecto**
   (funciona en `/srv`, `/opt`, etc.; si está bajo `/home` desactiva `ProtectHome`
   en la unidad) y añade a `ReadWritePaths` tanto la base de datos como la carpeta
   de archivos.
5. **Verificación** — deja el servicio activo y prueba que el usuario del servicio
   **puede escribir** en `DATA_DIR` y en `FILES_DIR` (un disco mal montado se detecta
   aquí, no a la tercera subida fallida) y que la API responde en el puerto del `.env`
   (con pista `journalctl -u family-cloud -n 20` si falla).
6. **Firewall** — si `ufw` está activo, pregunta si abre el puerto a la subred local.

Es **idempotente** (re-ejecutarlo no duplica nada) y tiene modo ensayo sin efectos:

```bash
./scripts/install.sh --dry-run
```

Al terminar, abre `http://<IP del servidor>:<puerto>` desde cualquier aparato de la
red. Si prefieres un nombre (p. ej. `cloud.lan`) en vez de la IP, añade la entrada en
el servidor DNS que uses (AdGuard Home, Pi-hole, el router…): el instalador no toca
el DNS de la red.

### Instalación manual (alternativa al script)

```bash
sudo useradd -r -s /usr/sbin/nologin familycloud
sudo cp -r . /srv/family-cloud          # incluye node_modules y .env
sudo mkdir -p /srv/family-cloud/data
sudo chown -R familycloud:familycloud /srv/family-cloud
sudo cp deploy/family-cloud.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now family-cloud
```

Ajusta el `PORT`/`HOST` del `.env` si cambia. Después abre
`http://<IP del servidor>:<puerto>`; si quieres un nombre en vez de la IP, añade la
entrada DNS en el servidor que uses.

### ⚙️ Administración

Solo para administradores (la tarjeta no aparece para los miembros): crear cuentas
nuevas, cambiar contraseñas, activar/desactivar y eliminar cuentas.

En el bloque **📁 Archivos de la familia** se ajusta el cupo por defecto, el nombre de
la carpeta compartida y el cupo de cada cuenta. La tabla termina en una fila
**Total** (lo que ocupan las cuentas sumado y lo que reservan los cupos en vigor) y
debajo sale una línea con el tamaño del servicio y el disco real donde vive:

> Las cuentas suman 1,2 GB en disco · 24 GB reservados por cupos (se ha usado el 5 %) ·
> en /mnt/disco-grande/nube quedan 890 GB libres de 1,9 TB.

Si alguna cuenta está sin límite, la reserva se muestra como «sin límite» (y se dice
cuántas cuentas son); si la suma de los cupos supera la capacidad del disco, avisa.

Garantías de que el servicio nunca se queda sin administración:

- La cuenta **`admin` es la cuenta del sistema**: no puede desactivarse, degradarse
  ni eliminarse (ni siquiera por otro admin).
- Ningún admin puede desactivarse, degradarse o eliminarse a sí mismo, y siempre
  debe quedar al menos un administrador activo.
- Si aun así se perdiera el acceso (p. ej. olvido de la contraseña del último admin),
  hay rescate **por consola en el propio servidor** — solo accesible desde la máquina,
  nunca de forma remota:

  ```bash
  node scripts/reset-password.js <usuario>   # pide la nueva contraseña dos veces (oculta)
  ```

### 👤 Mi cuenta

Cualquier usuario (incluido `admin`) puede cambiar su contraseña desde la tarjeta
«Mi cuenta» del hub: pide la contraseña actual y la nueva dos veces. La sesión en
curso no se corta; el cambio surte efecto en el siguiente acceso.

### 🎨 Temas de color

En **Mi cuenta**, arriba del todo, está el apartado **Tema de colores**:

- **11 temas**: el de siempre (*Predeterminado*, salmón/tierra), rojo, naranja,
  amarillo, verde, azul, violeta, **mar** (verde + azul), **neón**, **blanco y
  negro** y **sepia** (papel y tinta).
- Cada tema tiene sus **dos variantes**, clara y oscura: se cambian con el botón
  ☀️/🌙 de la barra superior o con el control **Variante** del propio apartado
  («La del sistema» sigue lo que use el móvil/PC).
- Cada tarjeta de muestra se pinta con los colores de SU tema, así que el
  muestrario es una previsualización real; al tocarlo el tema se aplica al
  instante en toda la página.
- La elección **se guarda en el navegador** (`localStorage`), no en la cuenta:
  cada aparato elige el suyo. Un script en el `<head>` la aplica antes de pintar,
  así que no se ve ningún destello al cargar.
- Cada tema define **dos colores**: el principal (botones, marca, selección) y un
  **segundo color** con el que se marca **lo compartido con la familia** (la fila
  de CARPETA-COMPARTIDA y la barra de espacio usado). En los temas de un solo
  color el segundo es una variante del primero; en mar, neón y sepia son
  combinaciones de dos colores.
- Las 22 combinaciones (11 temas × claro/oscura) se comprueban de forma
  automática para que todo se lea: contraste ≥ 4,5 del texto secundario y ≥ 7 del
  texto normal sobre el fondo y las tarjetas. Única excepción conocida: el botón
  salmón de siempre queda en 2,95 con el texto blanco (rozando el 3,0); se
  mejoraría oscureciendo un pelín `--accent` del tema por defecto.

---

## Seguridad

- **En reposo**: títulos y descripciones de eventos cifrados con AES-256-GCM
  (clave derivada con scrypt de la frase maestra). Contraseñas con bcrypt
  (coste 12). Fechas, categorías y autoría quedan en claro para poder indexar y controlar permisos.
- **Archivos**: cada archivo se cifra individualmente (AES-256-GCM, con el id del
  archivo como dato asociado) y se guarda como un blob opaco; los nombres cifrados
  viven en la base de datos. Sin la frase maestra, lo robado del disco es ilegible.
- **En tránsito**: HTTP en la LAN (suficiente para uso doméstico; migra a HTTPS
  cuando quieras — el código está preparado: certificado en `app.listen` y
  `cookie.secure = true`).
- Sesiones en cookie `httpOnly` + `SameSite=Lax` (14 días), límite de intentos de login
  (solo cuenta los fallidos), `helmet` con CSP estricta (`default-src 'self'`), sin
  recursos externos.

---

## Estructura

```
src/server.js   arranque, sesiones, CSP, estáticos
src/db.js       esquema SQLite (node:sqlite, sin dependencias nativas)
src/crypto.js   cifrado AES-256-GCM campo a campo
src/auth.js     setup de un solo uso, login/logout, middlewares de rol
src/users.js    gestión de cuentas (solo admin)
src/events.js   API CRUD de eventos
src/vault.js    API del gestor de contraseñas (aislada por usuario) + generador
src/storage.js  DATA_DIR / FILES_DIR: resolución, estado del disco y avisos
src/files.js    API de archivos (carpetas, subida y bajada cifradas, ZIP, cupos)
src/zip.js      escritor de ZIP al vuelo, sin dependencias
public/         HTML + CSS + JS vanilla (sin librerías): index (login+hub),
                calendar, passwords, files, admin, account — comparten common.js
scripts/gen-env.js  generador de .env
scripts/server-manual-test.sh  arranque manual de pruebas (primer plano, sin systemd)
scripts/reset-password.js  rescate de contraseña (solo por consola en el servidor)
scripts/storage-check.js   informe de disco, espacio y cupos (solo lectura)
scripts/relocate-data.sh   mover DATA_DIR / FILES_DIR a otro disco
scripts/install.sh  instalador completo (Node, .env, usuario, systemd, firewall)
deploy/family-cloud.service  unidad systemd
```

---

## Notas

- Las sesiones viven en memoria: al reiniciar el servicio hay que volver a
  iniciar sesión (nada importante se pierde).
- Backup = copiar `DATA_DIR` (base de datos, incluyendo `-wal` y `-shm`) + `FILES_DIR`
  + `.env`. Los tres juntos: sin las llaves del `.env`, los archivos cifrados no se
  pueden descifrar.
- El archivo de base de datos se renombró de `calendar.db` (herencia del proyecto
  original) a `family-cloud.db`: al arrancar, si existe el antiguo y no el nuevo,
  el servidor lo renombra solo (migración de una sola vez, sin pérdida).

---

## Licencia

AGPL-3.0-only — Copyright (C) 2026 dlazarus.

Este programa es software libre: puede redistribuirlo y/o modificarlo bajo los términos de la [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) publicada por la Free Software Foundation (versión 3).

Se distribuye sin garantía de ningún tipo. Los trabajos derivados que se expongan a usuarios por una red deben publicar también su código fuente.
