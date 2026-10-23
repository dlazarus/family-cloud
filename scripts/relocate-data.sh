#!/usr/bin/env bash
# Mover los datos de Family Cloud a otra ruta (por ejemplo a un disco más grande).
#
#   DATA_DIR  -> base de datos (mejor siempre en el disco del servidor: SQLite WAL
#                necesita bloqueos POSIX fiables; NTFS/vfat/FUSE dan errores)
#   FILES_DIR -> archivos CIFRADOS de los usuarios (aquí sí puede ir un disco externo)
#
# Uso (en el servidor, con sudo si la unidad systemd está instalada):
#   sudo scripts/relocate-data.sh --files=/mnt/datos/family-cloud-files
#   sudo scripts/relocate-data.sh --data=/srv/datos/family-cloud --files=/mnt/datos/files
#   ... añades --dry-run para ver exactamente qué haría, sin tocar nada
#
# Este script NUNCA borra el origen: al final imprime el comando para que lo borres tú,
# cuando hayas comprobado que todo funciona. La preparación del disco (particionar,
# formatear y montar) sigue siendo tarea del sysadmin.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_NAME="family-cloud"
SVC_USER="familycloud"
ENV_FILE="$PROJECT_DIR/.env"
NEW_DATA=""
NEW_FILES=""
DRY_RUN=0

step() { echo; echo "── $1 ──────────────────────────────"; }
ok()   { echo "   ✓ $1"; }
warn() { echo "   ! $1"; }
fail() { echo "   ✗ FALLO: $1"; exit 1; }
run()  { if [[ $DRY_RUN -eq 1 ]]; then echo "   [dry-run] $*"; else "$@"; fi; }

[[ -f "$ENV_FILE" ]] || fail "no hay .env en $PROJECT_DIR (¿instalaste la app?)"

for arg in "$@"; do
  case "$arg" in
    --data=*)  NEW_DATA="${arg#--data=}" ;;
    --files=*) NEW_FILES="${arg#--files=}" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) fail "opcion no reconocida: $arg  (usa --data=... --files=... [--dry-run])" ;;
  esac
done
[[ -z "$NEW_DATA" && -z "$NEW_FILES" ]] && fail "indica al menos --files=/ruta (y opcionalmente --data=/ruta)"

env_get() {
  local k="$1" def="${2:-}" v=""
  v="$(grep -E "^${k}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
  [[ -n "$v" ]] && echo "$v" || echo "$def"
}
abs_of() { if [[ "$1" = /* ]]; then echo "$1"; else realpath -m "$PROJECT_DIR/$1"; fi; }
fstype_of() {
  local t
  t="$(findmnt -T "$1" -no FSTYPE 2>/dev/null)"
  [[ -z "$t" ]] && t="$(findmnt -T "$(dirname "$1")" -no FSTYPE 2>/dev/null)"
  echo "${t:-desconocido}"
}
no_posix() { [[ "$(fstype_of "$1")" =~ ^(ntfs|ntfs3|vfat|exfat|fuseblk)$ ]]; }

CUR_DATA="$(abs_of "$(env_get DATA_DIR ./data)")"
CUR_FILES="$(abs_of "$(env_get FILES_DIR ./data/files)")"
DEST_DATA="${NEW_DATA:+$(abs_of "$NEW_DATA")}"
DEST_FILES="${NEW_FILES:+$(abs_of "$NEW_FILES")}"
DEST_DATA="${DEST_DATA:-$CUR_DATA}"
DEST_FILES="${DEST_FILES:-$CUR_FILES}"

echo "Family Cloud — reubicar datos"
echo "  destino DATA_DIR : $CUR_DATA  ->  $DEST_DATA"
echo "  destino FILES_DIR: $CUR_FILES ->  $DEST_FILES"
[[ $DRY_RUN -eq 1 ]] && echo "  (modo ensayo: no se toca nada)"

# ────────────────────────────────────────────────
step "1. Comprobar los destinos"
for pair in "DATA:$DEST_DATA" "FILES:$DEST_FILES"; do
  name="${pair%%:*}"; dir="${pair#*:}"
  if no_posix "$dir"; then
    if [[ "$name" == "DATA" ]]; then
      warn "vas a poner la base de datos sobre $(fstype_of "$dir"): SQLite (WAL) puede fallar con bloqueos en NTFS/vfat/FUSE"
      warn "recomendado: DATA_DIR en el disco del servidor y solo FILES_DIR en el disco externo"
      read -r -p "      ¿De todos modos mover la base de datos ahi? [y/N] " r
      [[ "$r" =~ ^[SsYy]$ ]] || { echo "   cancelado"; exit 1; }
    elif [[ -d "$dir" ]]; then
      warn "$name en $(fstype_of "$dir"): sin permisos POSIX; montala con uid=$(id -u "$SVC_USER" 2>/dev/null || echo UID),gid=$(id -g "$SVC_USER" 2>/dev/null || echo GID),fmask=0137,dmask=0137,nofail"
    fi
  fi
  if [[ -e "$dir" ]]; then
    [[ -d "$dir" ]] || fail "$dir existe pero no es un directorio"
    ok "$dir existe ($(fstype_of "$dir"))"
  elif [[ -d "$(dirname "$dir")" ]]; then
    run mkdir -p "$dir"
    ok "$dir se creara"
  else
    fail "$dir no existe y tampoco su padre ($(dirname "$dir")): monta el disco antes (preparar el disco es del sysadmin)"
  fi
done

# espacio aproximado del origen (informativo: el que libera el disco es cosa del sysadmin)
for pair in "DATA:$CUR_DATA:$DEST_DATA" "FILES:$CUR_FILES:$DEST_FILES"; do
  name="${pair%%:*}"; rest="${pair#*:}"; src="${rest%%:*}"; dst="${rest#*:}"
  [[ -d "$src" ]] || continue
  need_kb="$(du -sk "$src" 2>/dev/null | awk '{print $1}')"
  probe="$(dirname "$dst")"; [[ -d "$dst" ]] && probe="$dst"
  free_kb="$(df -k "$probe" 2>/dev/null | awk 'NR==2{print $4}')"
  echo "   $name: ${need_kb:-0} KB en el origen; $(df -h "$probe" 2>/dev/null | awk 'NR==2{print $4}') libres en $probe"
  if [[ -n "${free_kb:-}" ]] && (( need_kb > free_kb )); then
    warn "$name no cabe en el destino (${need_kb} KB > ${free_kb} KB libres)"
  fi
done

# ────────────────────────────────────────────────
step "2. Parar el servicio (si existe)"
if systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null; then
  run systemctl stop "$UNIT_NAME"
  ok "servicio parado (la base de datos se copia sin escrituras a medias)"
else
  ok "el servicio no esta en marcha: nada que parar"
fi

# ────────────────────────────────────────────────
step "3. Copiar los datos (el origen se conserva intacto)"
copy_tree() {
  local src="$1" dst="$2" label="$3"
  [[ -d "$src" ]] || { warn "$label: no hay nada que copiar en $src"; return; }
  if [[ "$src" == "$dst" ]]; then ok "$label: origen y destino coinciden, nada que copiar"; return; fi
  if command -v rsync >/dev/null 2>&1; then
    run rsync -a --info=progress2 "$src/" "$dst/"
  else
    run cp -a "$src/." "$dst/"
  fi
  ok "$label copiado de $src a $dst"
}
copy_tree "$CUR_DATA" "$DEST_DATA" "DATA_DIR"
copy_tree "$CUR_FILES" "$DEST_FILES" "FILES_DIR"

# en NTFS/vfat el chown no funciona (la propiedad va en el montaje)
for d in "$DEST_DATA" "$DEST_FILES"; do
  [[ -d "$d" ]] || continue
  [[ "$d" == "$CUR_DATA" || "$d" == "$CUR_FILES" ]] && continue  # no tocamos lo que no se ha movido
  if no_posix "$d"; then
    warn "$d: se omite el chown (sistema sin permisos POSIX); recuerda el uid=/gid= en el montaje"
  elif ! id "$SVC_USER" >/dev/null 2>&1; then
    warn "el usuario de servicio '$SVC_USER' no existe aqui: se omite el chown de $d"
  else
    run chown -R "$SVC_USER:$SVC_USER" "$d"
  fi
done

# ────────────────────────────────────────────────
step "4. Actualizar .env y la unidad systemd"
env_set() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$ENV_FILE"; then sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE";
  else printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"; fi
  ok ".env: $k=$v"
}
if [[ $DRY_RUN -eq 1 ]]; then
  echo "   [dry-run] .env: DATA_DIR=$DEST_DATA y FILES_DIR=$DEST_FILES"
else
  env_set DATA_DIR "$DEST_DATA"
  env_set FILES_DIR "$DEST_FILES"
fi

UNIT="/etc/systemd/system/$UNIT_NAME.service"
if [[ -f "$UNIT" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "   [dry-run] reescribir ReadWritePaths en $UNIT -> $DEST_DATA y $DEST_FILES"
  else
    sed -i '/^ReadWritePaths=/d' "$UNIT"
    RWP="ReadWritePaths=$DEST_DATA"
    [[ "$DEST_FILES" != "$DEST_DATA" ]] && RWP="$RWP
ReadWritePaths=$DEST_FILES"
    sed -i "/^\[Install\]/i $RWP" "$UNIT"
    run systemctl daemon-reload
    ok "ReadWritePaths actualizados en $UNIT"
  fi
else
  warn "no hay unidad en $UNIT: no hace falta tocar systemd (modo manual)"
fi

# ────────────────────────────────────────────────
step "5. Arrancar y comprobar"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "   [dry-run] systemctl start $UNIT_NAME + comprobacion HTTP"
  echo
  echo "Ensayo terminado: no se ha movido nada. Repite sin --dry-run cuando lo veas claro."
  exit 0
fi
if [[ -f "$UNIT" ]]; then
  run systemctl start "$UNIT_NAME"
  sleep 2
  systemctl is-active --quiet "$UNIT_NAME" || fail "el servicio no arranca tras la mudanza: mira 'journalctl -u $UNIT_NAME -n 30'"
  ok "servicio activo con las rutas nuevas"
else
  warn "modo manual: arranca la app tu ('npm start') y comprueba que todo se ve"
fi
PORT="$(env_get PORT 3000)"
if [[ -f "$UNIT" ]] && command -v curl >/dev/null 2>&1; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/status" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]] && ok "la app responde en el puerto $PORT" || warn "el endpoint /api/status devolvio $code (revisa el arranque)"
fi
if [[ -d "$DEST_FILES" ]]; then
  probe="$DEST_FILES/.fc-write-test.$$"
  if ! id "$SVC_USER" >/dev/null 2>&1; then
    warn "el usuario de servicio '$SVC_USER' no existe en esta maquina: prueba tu que la app pueda escribir en $DEST_FILES"
  elif su -s /bin/sh "$SVC_USER" -c "touch '$probe' && rm -f '$probe'" 2>/dev/null; then
    ok "$DEST_FILES: escribible por $SVC_USER"
  else
    rm -f "$probe" 2>/dev/null
    fail "$DEST_FILES no es escribible por $SVC_USER (en NTFS/vfat: uid=/gid= al montar)"
  fi
fi

echo
echo "══ Mudanza terminada ══"
echo "El origen sigue intacto (por si acaso):"
[[ "$CUR_DATA" != "$DEST_DATA" ]]  && echo "   $CUR_DATA"
[[ "$CUR_FILES" != "$DEST_FILES" ]] && echo "   $CUR_FILES"
echo
echo "Cuando hayas entrado en la web y visto el calendario, las contraseñas y los archivos"
echo "en su sitio, puedes liberar espacio borrando el origen a mano, por ejemplo:"
[[ "$CUR_DATA" != "$DEST_DATA" ]]  && echo "   sudo rm -rf $CUR_DATA"
[[ "$CUR_FILES" != "$DEST_FILES" ]] && echo "   sudo rm -rf $CUR_FILES"
echo
echo "Y recuerda: el backup ahora es  $DEST_DATA + $DEST_FILES + .env"
