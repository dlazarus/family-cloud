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

# ────────────────────────────────────────────────
step "2. Generar configuración (frase maestra)"
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
  PORT="$(grep -E '^PORT=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2 | tr -d '"')"; PORT="${PORT:-3000}"
fi

# ────────────────────────────────────────────────
step "3. Usuario de servicio y permisos"
if id "$SVC_USER" >/dev/null 2>&1; then
  ok "usuario '$SVC_USER' ya existe"
else
  run useradd -r -s /usr/sbin/nologin "$SVC_USER" || fail "no se pudo crear el usuario de sistema '$SVC_USER'"
  [[ $DRY_RUN -eq 1 ]] || ok "usuario de sistema '$SVC_USER' creado (sin shell de login)"
fi
run mkdir -p "$PROJECT_DIR/data" || fail "no se pudo crear $PROJECT_DIR/data"
run chown -R "$SVC_USER:$SVC_USER" "$PROJECT_DIR" || fail "no se pudo dar propiedad de $PROJECT_DIR a $SVC_USER"
ok "perfiles y permisos listos (la app escribe en $PROJECT_DIR/data)"

# ────────────────────────────────────────────────
step "4. Instalar y arrancar el servicio systemd"
UNIT_SRC="$PROJECT_DIR/deploy/$UNIT_NAME.service"
[[ -f "$UNIT_SRC" ]] || fail "no se encuentra la unidad en $UNIT_SRC"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "   [dry-run] sed … > /etc/systemd/system/$UNIT_NAME.service && daemon-reload && enable --now"
else
  # Adaptar la ruta de la unidad a la ubicación real del proyecto
  sed "s|/srv/family-cloud|$PROJECT_DIR|g" "$UNIT_SRC" > "/etc/systemd/system/$UNIT_NAME.service" \
    || fail "no se pudo escribir /etc/systemd/system/$UNIT_NAME.service"
  ok "unidad instalada (ruta adaptada a $PROJECT_DIR)"
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
echo "Recordatorio: la frase maestra de .env es la llave de tus eventos."
echo "              Backup = copiar data/calendar.db + .env juntos."
