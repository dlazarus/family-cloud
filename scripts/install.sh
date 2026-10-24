#!/usr/bin/env bash
# Instalador de Family Cloud (nube familiar: calendario, contraseñas, ...) (Debian/Ubuntu).
# Uso:  sudo ./scripts/install.sh          (instalación real)
#       ./scripts/install.sh --dry-run     (ensayo: muestra sin ejecutar pasos privilegiados)
set -u

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_NAME="family-cloud"
SVC_USER="familycloud"
NODE_MAJOR_MIN=22
NODE_MINOR_MIN=5
CURRENT="?"

step()  { CURRENT="$1"; echo; echo "── $1 ──────────────────────────────"; }
ok()    { echo "   ✓ $1"; }
warn()  { echo "   ! $1"; }
fail()  { echo "   ✗ FALLO en el paso '$CURRENT': $1"; exit 1; }
run()   { if [[ $DRY_RUN -eq 1 ]]; then echo "   [dry-run] $*"; else "$@"; fi; }

# Lee una clave del .env (con valor por defecto si no existe)
env_get() {
  local k="$1" def="${2:-}" v=""
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    v="$(grep -E "^${k}=" "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
  fi
  [[ -n "$v" ]] && echo "$v" || echo "$def"
}

# Escribe/actualiza una clave en el .env (idempotente: re-ejecutar no duplica lineas)
env_set() {
  local k="$1" v="$2"
  if [[ $DRY_RUN -eq 1 ]]; then echo "   [dry-run] .env: $k=$v"; return; fi
  [[ -f "$PROJECT_DIR/.env" ]] || : > "$PROJECT_DIR/.env"
  if grep -qE "^${k}=" "$PROJECT_DIR/.env"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$PROJECT_DIR/.env"
  else
    printf '%s=%s\n' "$k" "$v" >> "$PROJECT_DIR/.env"
  fi
}

# Ruta relativa al proyecto -> absoluta (acepta rutas inexistentes)
abs_of() {
  if [[ "$1" = /* ]]; then echo "$1"; else realpath -m "$PROJECT_DIR/$1"; fi
}

# Tipo de sistema de ficheros de una ruta (ext4, ntfs, vfat, fuseblk...)
fstype_of() {
  local t
  t="$(findmnt -T "$1" -no FSTYPE 2>/dev/null)"
  [[ -z "$t" ]] && t="$(findmnt -T "$(dirname "$1")" -no FSTYPE 2>/dev/null)"
  echo "${t:-desconocido}"
}

# Sin permisos POSIX: chown/chmod no funcionan (NTFS, vfat, FUSE): la propiedad se fija
# en el MONTAJE, y eso lo hace el sysadmin.
no_posix() { [[ "$(fstype_of "$1")" =~ ^(ntfs|ntfs3|vfat|exfat|fuseblk)$ ]]; }

[[ $DRY_RUN -eq 0 && $EUID -ne 0 ]] && fail "se debe ejecutar con sudo: sudo $0"

# Lee el puerto definido en .env (si existe)
PORT=3000
if [[ -f "$PROJECT_DIR/.env" ]]; then
  p="$(grep -E '^PORT=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2 | tr -d '"')"
  [[ -n "$p" ]] && PORT="$p"
fi

echo "Family Cloud — instalador"
echo "Proyecto: $PROJECT_DIR"
[[ $DRY_RUN -eq 1 ]] && echo "(modo ensayo: no se ejecutan pasos privilegiados)"

# ────────────────────────────────────────────────
step "1. Instalando Node 22 LTS"
need_node=1
if command -v node >/dev/null 2>&1; then
  ver="$(node -v)"; maj="${ver#v}"; min="${maj#*.}"; min="${min%%.*}"; maj="${maj%%.*}"
  if (( maj > NODE_MAJOR_MIN )) || (( maj == NODE_MAJOR_MIN && min >= NODE_MINOR_MIN )); then
    ok "Node $ver ya instalado (cumple >= $NODE_MAJOR_MIN.$NODE_MINOR_MIN, necesario para node:sqlite)"
    need_node=0
  else
    warn "Node $ver es demasiado antiguo (se requiere >= $NODE_MAJOR_MIN.$NODE_MINOR_MIN)"
  fi
else
  warn "Node no está instalado"
fi
if (( need_node )); then
  command -v curl >/dev/null 2>&1 || fail "falta 'curl' (sudo apt install curl) para añadir el repositorio NodeSource"
  [[ -f /etc/debian_version ]] || fail "este instalador espera Debian/Ubuntu; instala Node 22+ por tu cuenta y repite"
  echo "   Añadiendo repositorio NodeSource (necesita internet)…"
  run bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -" \
    || fail "no se pudo añadir el repositorio NodeSource (¿sin internet? ¿clave GPG?)"
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs \
    || fail "'apt install nodejs' falló (¿falta 'apt update'?)"
  command -v node >/dev/null 2>&1 || fail "tras instalar, 'node' sigue sin estar en el PATH"
  ok "Node $(node -v) instalado"
fi
# Sin dependencias el servicio entra en bucle de reinicios con ERR_MODULE_NOT_FOUND
# (el error real sale en journalctl, lejos de la pantalla del instalador): mejor decirlo aqui.
if [[ ! -d "$PROJECT_DIR/node_modules/express" ]]; then
  fail "faltan las dependencias del proyecto (no hay node_modules). Ejecuta antes:  cd $PROJECT_DIR && npm install  y repite el instalador"
fi
ok "dependencias presentes (node_modules)"

# ────────────────────────────────────────────────
step "2. Generar configuración (frase maestra)"
# Los discos a la vista ANTES de preguntar las rutas: asi se puede copiar el punto
# de montaje del disco externo en vez de escribirlo de memoria.
if command -v lsblk >/dev/null 2>&1; then
  echo "   Discos y puntos de montaje detectados (para elegir las rutas de abajo):"
  lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINTS 2>/dev/null | sed 's/^/     /' | head -20
  echo "   (el instalador NO monta ni formatea: el disco debe estar montado ya)"
fi
if [[ -f "$PROJECT_DIR/.env" ]]; then
  ok ".env ya existe — se conserva (edítalo a mano si quieres cambiar valores)"
elif [[ $DRY_RUN -eq 1 ]]; then
  echo "   [dry-run] node scripts/gen-env.js (pediría la frase maestra)"
else
  echo "   La frase maestra cifra los eventos: guárdala en un lugar seguro."
  node "$PROJECT_DIR/scripts/gen-env.js" || fail "gen-env.js falló o se canceló (revisa la frase: mínimo 10 caracteres)"
  [[ -f "$PROJECT_DIR/.env" ]] || fail "no se creó .env"
  chmod 600 "$PROJECT_DIR/.env"
  ok ".env creado con permisos 600"
fi
if [[ -f "$PROJECT_DIR/.env" ]]; then
  PORT="$(env_get PORT 3000)"
fi

# --- donde se guarda todo: DATA_DIR = base de datos, FILES_DIR = archivos cifrados ---
# Preparar el disco (particionar, formatear, montar, dejar espacio) es del sysadmin:
# aqui solo se asigna la ruta y se comprueba que existe y se puede escribir.
DATA_DIR_RAW="$(env_get DATA_DIR ./data)"
FILES_DIR_RAW="$(env_get FILES_DIR ./data/files)"
FILE_QUOTA_MB="$(env_get FILE_QUOTA_MB 4096)"
if [[ -f "$PROJECT_DIR/.env" ]] && [[ $DRY_RUN -eq 0 ]] && [[ -t 0 ]]; then
  echo
  echo "   Donde se guarda todo (Enter para mantener lo que hay):"
  printf "   DATA_DIR  (base de datos; mejor en el disco del servidor) [%s]: " "$DATA_DIR_RAW"; read -r d
  [[ -n "$d" ]] && DATA_DIR_RAW="$d"
  printf "   FILES_DIR (archivos cifrados; admite un disco externo) [%s]: " "$FILES_DIR_RAW"; read -r f
  [[ -n "$f" ]] && FILES_DIR_RAW="$f"
  printf "   Cupo por defecto por cuenta en MB (0 = sin limite) [%s]: " "$FILE_QUOTA_MB"; read -r q
  [[ -n "$q" ]] && FILE_QUOTA_MB="$q"
fi
env_set DATA_DIR "$DATA_DIR_RAW"
env_set FILES_DIR "$FILES_DIR_RAW"
env_set FILE_QUOTA_MB "$FILE_QUOTA_MB"
[[ -z "$(env_get FILE_MIN_FREE_MB '')" ]] && env_set FILE_MIN_FREE_MB 2048
DATA_DIR_ABS="$(abs_of "$DATA_DIR_RAW")"
FILES_DIR_ABS="$(abs_of "$FILES_DIR_RAW")"
ok "DATA_DIR  = $DATA_DIR_ABS"
ok "FILES_DIR = $FILES_DIR_ABS  (cupo por defecto: ${FILE_QUOTA_MB} MB por cuenta)"

# ────────────────────────────────────────────────
step "3. Usuario de servicio y permisos"
if id "$SVC_USER" >/dev/null 2>&1; then
  ok "usuario '$SVC_USER' ya existe"
else
  run useradd -r -s /usr/sbin/nologin "$SVC_USER" || fail "no se pudo crear el usuario de sistema '$SVC_USER'"
  [[ $DRY_RUN -eq 1 ]] || ok "usuario de sistema '$SVC_USER' creado (sin shell de login)"
fi
run mkdir -p "$DATA_DIR_ABS" || fail "no se pudo crear $DATA_DIR_ABS"
# FILES_DIR solo se crea si su padre existe: si el disco externo no esta montado, su
# punto de montaje puede no existir — ahi NO creamos un directorio fantasma que lo tape.
if [[ -d "$FILES_DIR_ABS" ]]; then
  ok "FILES_DIR ya existe: $FILES_DIR_ABS"
elif [[ -d "$(dirname "$FILES_DIR_ABS")" ]]; then
  run mkdir -p "$FILES_DIR_ABS" || fail "no se pudo crear $FILES_DIR_ABS"
  ok "FILES_DIR creado: $FILES_DIR_ABS"
else
  warn "FILES_DIR ($FILES_DIR_ABS) no existe y su padre tampoco: ¿no esta montado el disco?"
  warn "montalo antes (preparacion de disco = tarea del sysadmin) y re-ejecuta el instalador"
fi
run chown -R "$SVC_USER:$SVC_USER" "$PROJECT_DIR" || fail "no se pudo dar propiedad de $PROJECT_DIR a $SVC_USER"
for d in "$DATA_DIR_ABS" "$FILES_DIR_ABS"; do
  [[ -d "$d" ]] || continue
  if no_posix "$d"; then
    # NTFS/vfat/exfat: chown no funciona (la propiedad se fija en el MONTAJE). El disco
    # debe montarse con uid/gid del usuario de servicio. Lo aplica el sysadmin.
    warn "$d esta en $(fstype_of "$d"): sin permisos POSIX, se omite el chown"
    warn "monta el disco asi (lo hace el sysadmin, este script NO toca /etc/fstab):"
    warn "   <disco> $d $(fstype_of "$d") defaults,uid=$(id -u "$SVC_USER" 2>/dev/null || echo UID),gid=$(id -g "$SVC_USER" 2>/dev/null || echo GID),fmask=0137,dmask=0137,nofail 0 0"
  else
    run chown -R "$SVC_USER:$SVC_USER" "$d" || fail "no se pudo dar propiedad de $d a $SVC_USER"
  fi
done
ok "perfiles y permisos listos (la app escribe en DATA_DIR y FILES_DIR)"

# ────────────────────────────────────────────────
step "3 bis. Verificacion del almacenamiento elegido (solo informa: no monta ni formatea)"
for d in "$DATA_DIR_ABS" "$FILES_DIR_ABS"; do
  target="$d"; [[ -d "$target" ]] || target="$(dirname "$d")"
  [[ -d "$target" ]] || continue
  fs="$(fstype_of "$target")"
  free="$(df -h "$target" 2>/dev/null | awk 'NR==2{print $4}')"
  echo "   $d  ->  sistema: $fs   libre: ${free:-?}"
  if ! no_posix "$target" && [[ "$d" == "$DATA_DIR_ABS" ]]; then
    ok "DATA_DIR en $fs: vale para la base de datos (SQLite WAL)"
  fi
done
if no_posix "$DATA_DIR_ABS"; then
  warn "DATA_DIR esta en un sistema sin bloqueos POSIX fiables (NTFS/vfat/FUSE): SQLite en modo WAL puede dar errores"
  warn "recomendacion: deja la base de datos en el disco del servidor y pon solo FILES_DIR en el disco externo"
fi
USERS_N=0
if [[ $DRY_RUN -eq 0 ]] && [[ -f "$DATA_DIR_ABS/family-cloud.db" ]]; then
  USERS_N="$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);console.log(d.prepare('SELECT COUNT(*) n FROM users').get().n)" "$DATA_DIR_ABS/family-cloud.db" 2>/dev/null || echo 0)"
fi
FREE_KB="$(df -k "$FILES_DIR_ABS" 2>/dev/null | awk 'NR==2{print $4}')"
if [[ -n "$FREE_KB" && "$FREE_KB" != "0" && "$FILE_QUOTA_MB" != "0" && "$USERS_N" != "0" ]]; then
  need=$(( USERS_N * FILE_QUOTA_MB ))
  if (( need > FREE_KB / 1024 )); then
    warn "el cupo (${FILE_QUOTA_MB} MB x ${USERS_N} cuentas = ${need} MB) no cabe en el espacio libre de FILES_DIR"
    warn "ajusta el cupo desde Administracion o libera espacio en el disco (la limpieza la decide el sysadmin)"
  else
    ok "el cupo actual cabe holgadamente en FILES_DIR (${USERS_N} cuentas x ${FILE_QUOTA_MB} MB)"
  fi
fi

# ────────────────────────────────────────────────
step "4. Instalar y arrancar el servicio systemd"
UNIT_SRC="$PROJECT_DIR/deploy/$UNIT_NAME.service"
[[ -f "$UNIT_SRC" ]] || fail "no se encuentra la unidad en $UNIT_SRC"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "   [dry-run] sed … > /etc/systemd/system/$UNIT_NAME.service && daemon-reload && enable --now"
  echo "   [dry-run] ReadWritePaths declarados: $DATA_DIR_ABS y $FILES_DIR_ABS"
else
  # Adaptar la ruta de la unidad a la ubicación real del proyecto
  sed "s|/srv/family-cloud|$PROJECT_DIR|g" "$UNIT_SRC" > "/etc/systemd/system/$UNIT_NAME.service" \
    || fail "no se pudo escribir /etc/systemd/system/$UNIT_NAME.service"
  ok "unidad instalada (ruta adaptada a $PROJECT_DIR)"
  # ProtectSystem=strict solo deja escribir en lo que se liste: hay que declarar tanto
  # DATA_DIR como FILES_DIR (que puede estar en otro disco). Idempotente: se borran las
  # lineas ReadWritePaths antiguas y se vuelven a escribir con las rutas actuales.
  sed -i '/^ReadWritePaths=/d' "/etc/systemd/system/$UNIT_NAME.service"
  RWP="ReadWritePaths=$DATA_DIR_ABS"
  [[ "$FILES_DIR_ABS" != "$DATA_DIR_ABS" ]] && RWP="$RWP
ReadWritePaths=$FILES_DIR_ABS"
  # se insertan justo antes de [Install], que es donde acaban las secciones [Service]
  sed -i "/^\[Install\]/i $RWP" "/etc/systemd/system/$UNIT_NAME.service"
  RWP_NOTE="$DATA_DIR_ABS"
  [[ "$FILES_DIR_ABS" != "$DATA_DIR_ABS" ]] && RWP_NOTE="$DATA_DIR_ABS y $FILES_DIR_ABS"
  ok "ReadWritePaths declarados: $RWP_NOTE"
  # ProtectHome oculta /home al servicio: si el proyecto vive ahí, desactivarlo
  if [[ "$PROJECT_DIR" == /home/* ]]; then
    sed -i "s|^ProtectHome=true|ProtectHome=false|" "/etc/systemd/system/$UNIT_NAME.service"
    warn "proyecto bajo /home: ProtectHome desactivado en la unidad para que el servicio pueda leerlo"
  fi
  run systemctl daemon-reload || fail "systemctl daemon-reload falló"
  run systemctl enable --now "$UNIT_NAME" || fail "no se pudo habilitar/arrancar el servicio (mira: journalctl -u $UNIT_NAME -n 20)"
  ok "servicio habilitado (arranca con el servidor) y en marcha"
fi

# ────────────────────────────────────────────────
step "5. Verificación"
sleep 2
if [[ $DRY_RUN -eq 1 ]]; then
  echo "   [dry-run] se omiten comprobaciones de servicio"
else
  state="$(systemctl is-active "$UNIT_NAME" 2>&1)"
  [[ "$state" == "active" ]] || fail "el servicio no está activo (estado: $state). Detalle: journalctl -u $UNIT_NAME -n 20"
  ok "servicio activo"
  # Prueba REAL de escritura en las dos rutas, hecha como el usuario de servicio: es lo
  # que falla en cuanto un disco externo se desmonta o se monta con el uid equivocado.
  for d in "$DATA_DIR_ABS" "$FILES_DIR_ABS"; do
    if [[ ! -d "$d" ]]; then
      warn "$d no existe: ¿no está montado el disco? la tarjeta «Archivos» quedará degradada (503); calendario y contraseñas seguirán funcionando"
      continue
    fi
    probe="$d/.fc-write-test.$$"
    if su -s /bin/sh "$SVC_USER" -c "touch '$probe' && rm -f '$probe'" 2>/dev/null; then
      ok "$d: escribible por $SVC_USER ($(fstype_of "$d"), libre $(df -h "$d" 2>/dev/null | awk 'NR==2{print $4}'))"
    else
      rm -f "$probe" 2>/dev/null
      fail "el servicio NO puede escribir en $d — revisa la propiedad (en NTFS/vfat se fija con uid=/gid= al montar)"
    fi
  done
  resp="$(curl -sf -m 5 "http://localhost:$PORT/api/status" 2>&1)"
  if [[ "$resp" == *needsSetup* ]]; then
    ok "la API responde en el puerto $PORT ($resp)"
  else
    fail "el servicio está activo pero la API no responde en http://localhost:$PORT (¿puerto ocupado? ¿PORT en .env?)"
  fi
fi

# ────────────────────────────────────────────────
step "6. Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  if ufw status 2>/dev/null | grep -q "${PORT}/tcp"; then
    ok "el puerto $PORT ya está abierto en ufw"
  else
    printf "   ufw está activo. ¿Abrir el puerto %s/tcp a la red local? [S/n] " "$PORT"
    read -r ans
    case "${ans:-S}" in
      [nN]*) warn "puerto NO abierto — la web solo será accesible desde el propio servidor" ;;
      *)     subnet="$(ip -4 route show scope global | awk '{print $1}' | grep -m1 '^10\.\|^172\.\|^192\.')"
             subnet="${subnet:-192.168.1.0/24}"
             run ufw allow from "$subnet" to any port "$PORT" proto tcp || fail "ufw allow falló"
             ok "puerto $PORT abierto a $subnet" ;;
    esac
  fi
else
  ok "ufw no está activo — no hay nada que abrir"
fi

# ────────────────────────────────────────────────
echo
echo "══ Instalación terminada correctamente ══"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="$(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet )\d+(\.\d+){3}' | head -1)"
fi
LAN_IP="${LAN_IP:-<IP_DEL_SERVIDOR>}"
echo
echo "Pasos finales (manuales):"
echo "  1. En AdGuard Home: redireccionamiento DNS  cloud.lan -> $LAN_IP"
echo "  2. Abre en el navegador  http://$LAN_IP:$PORT"
echo "     (si aún no hay usuarios verás la pantalla para crear el administrador)"
echo
echo "Comandos útiles:"
echo "  node scripts/storage-check.js     # dónde están los datos, espacio libre y cupos"
echo "  scripts/relocate-data.sh --files=/mnt/disco/nube   # mover los archivos a otro disco"
echo
echo "Recordatorio: la frase maestra de .env es la llave de tus datos (eventos, contraseñas, archivos)."
echo "              Backup = DATA_DIR ($(env_get DATA_DIR ./data)) + FILES_DIR ($(env_get FILES_DIR ./data/files)) + .env"
echo "              La preparación del disco externo (formatear, montar, espacio) es tuya: el instalador solo usa la ruta."
