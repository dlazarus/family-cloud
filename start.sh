#!/usr/bin/env bash
# Arranque manual (para pruebas). En producción usar systemd (deploy/family-cloud.service).
cd "$(dirname "$0")"
exec node src/server.js
