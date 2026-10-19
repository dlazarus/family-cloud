#!/usr/bin/env bash
# Arranque manual (para pruebas). En producción usar systemd (deploy/family-calendar.service).
cd "$(dirname "$0")"
exec node src/server.js
