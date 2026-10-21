# Family Cloud

> [!NOTE]
> **Nota del autor:** no sé programar. Este proyecto está hecho íntegramente con *vibe coding* (lo escriben agentes de IA bajo mi dirección y yo lo pruebo). También soy novato total en GitHub: tenlo en cuenta al leer el código, y si abres un issue o un pull request y tardo en responder (o no sé qué hacer con él), no es desidia — es que literalmente estoy aprendiendo a usar GitHub. Aun así, mi intención es compartir: como amante del software libre, quiero que cualquiera pueda usarlo, clonarlo y probarlo aunque su autor sea un novato.

Nube familiar local (100 % offline en tiempo de ejecución, sin CDN): varios servicios
para casa servidos desde un mismo servidor y detrás de un mismo login. El primer
servicio es el **calendario familiar** (eventos compartidos); le seguirán más (gestor de
contraseñas, notas, archivos…). Los datos se guardan **cifrados** en la base de datos;
el acceso requiere usuario y contraseña.

## Puesta en marcha (primera vez)

```bash
cd family-cloud
npm install                 # solo la primera vez, requiere internet una vez
node scripts/gen-env.js     # genera .env (pide la frase maestra; guárdala a salvo)
npm start                   # o ./start.sh
```

Por defecto escucha en **http://0.0.0.0:3000** (configurable en `.env`).

> ⚠️ La frase maestra de `.env` cifra los datos (eventos y demás). Si se pierde, no se
> pueden recuperar. Haz copias de `.env` y de `data/family-cloud.db` juntas.

## Primer acceso

Al abrir la web por primera vez se pide crear la cuenta de administrador
(usuario `admin` por defecto, contraseña la que elijas). Ese endpoint solo
funciona mientras no exista ningún usuario.

El admin crea las cuentas de la familia desde la tarjeta **⚙️ Administración** del hub.

## Servicios incluidos

Tras iniciar sesión se abre un **hub** con tarjetas de los servicios disponibles.

### 🗓️ Calendario

Eventos compartidos por toda la familia: crear, editar y eliminar eventos con fecha
(opcionalmente rango), categoría y notas; filtros por categoría y vista mensual.
Todos los usuarios autenticados pueden ver y editar los eventos.

### 🔑 Gestor de contraseñas

Cada usuario guarda sus propias contraseñas (sitio, nombre de acceso y contraseña)
y **solo él** puede verlas y gestionarlas: el administrador no tiene acceso a las
entradas de otros desde la web. Incluye buscador, mostrar/ocultar y copiar al
portapapeles, y un **generador de contraseñas seguras** (longitud de 8 a 128,
tipos de caracteres y opción de evitar caracteres ambiguos) disponible tanto al
crear como al editar una entrada. Los tres campos se guardan cifrados (AES-256-GCM)
con la frase maestra; el esquema de la base de datos está preparado para migrar en
el futuro a una clave por usuario (cifrado que ni el servidor puede leer).

## Instalación en el servidor de casa (recomendada: script)

Copia el directorio del proyecto al servidor (p. ej. a `/srv/family-cloud`)
y ejecuta el instalador, que recorre los 6 pasos con mensajes ✓/✗ por paso:

```bash
sudo /srv/family-cloud/scripts/install.sh
```

Qué hace:

1. **Node 22 LTS** — lo detecta si ya está (exige ≥ 22.5 por `node:sqlite`) o lo instala desde NodeSource.
2. **Configuración** — genera `.env` pidiendo la frase maestra (la respeta si ya existe).
3. **Usuario de servicio y permisos** — crea `familycloud`, `data/` y aplica `chown`.
4. **systemd** — instala la unidad **adaptando la ruta a donde esté el proyecto** (funciona en `/srv`, `/opt`, etc.; si está bajo `/home` desactiva `ProtectHome` en la unidad).
5. **Verificación** — comprueba que el servicio está activo y que la API responde en el puerto del `.env` (con pista `journalctl -u family-cloud -n 20` si falla).
6. **Firewall** — si `ufw` está activo, pregunta si abre el puerto a la subred local.

Es **idempotente** (re-ejecutarlo no duplica nada) y tiene modo ensayo sin efectos:

```bash
./scripts/install.sh --dry-run
```

Al terminar recuerda los dos pasos manuales que imprime: el redireccionamiento
DNS `cloud.lan → <IP>` en AdGuard Home y el enlace desde tu página de inicio.

### Instalación manual (alternativa al script)

```bash
sudo useradd -r -s /usr/sbin/nologin familycloud
sudo cp -r . /srv/family-cloud          # incluye node_modules y .env
sudo mkdir -p /srv/family-cloud/data
sudo chown -R familycloud:familycloud /srv/family-cloud
sudo cp deploy/family-cloud.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now family-cloud
```

Ajusta el `PORT`/`HOST` del `.env` si cambia. Después crea el redireccionamiento
DNS `cloud.lan → <IP del servidor>` en AdGuard Home y enlázalo desde tu
página de inicio.

### ⚙️ Administración

Solo para administradores (la tarjeta no aparece para los miembros): crear cuentas
nuevas, cambiar contraseñas, activar/desactivar y eliminar cuentas.

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

## Seguridad

- **En reposo**: títulos y descripciones de eventos cifrados con AES-256-GCM
  (clave derivada con scrypt de la frase maestra). Contraseñas con bcrypt
  (coste 12). Fechas y categorías quedan en claro para poder indexar.
- **En tránsito**: HTTP en la LAN (suficiente para uso doméstico; migra a HTTPS
  cuando quieras — el código está preparado: certificado en `app.listen` y
  `cookie.secure = true`).
- Sesiones en cookie `httpOnly` + `SameSite=Lax`, límite de intentos de login,
  `helmet` con CSP estricta (`default-src 'self'`), sin recursos externos.

## Estructura

```
src/server.js   arranque, sesiones, CSP, estáticos
src/db.js       esquema SQLite (node:sqlite, sin dependencias nativas)
src/crypto.js   cifrado AES-256-GCM campo a campo
src/auth.js     setup de un solo uso, login/logout, middlewares de rol
src/users.js    gestión de cuentas (solo admin)
src/events.js   API CRUD de eventos
src/vault.js    API del gestor de contraseñas (aislada por usuario) + generador
public/         HTML + CSS + JS vanilla (sin librerías): index (login+hub),
                calendar, passwords, admin, account — comparten common.js
scripts/gen-env.js  generador de .env
scripts/install.sh  instalador completo (Node, .env, usuario, systemd, firewall)
deploy/family-cloud.service  unidad systemd
```

## Notas

- Las sesiones viven en memoria: al reiniciar el servicio hay que volver a
  iniciar sesión (nada importante se pierde).
- Backup = copiar `data/family-cloud.db` + `.env`.
- El archivo de base de datos se renombró de `calendar.db` (herencia del proyecto
  original) a `family-cloud.db`: al arrancar, si existe el antiguo y no el nuevo,
  el servidor lo renombra solo (migración de una sola vez, sin pérdida).
