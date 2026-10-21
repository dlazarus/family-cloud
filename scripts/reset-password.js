#!/usr/bin/env node
// Rescate de acceso: cambia la contraseña de cualquier cuenta desde el propio servidor.
//
// Solo puede ejecutarse quien tenga acceso al servidor (lectura de .env + data/calendar.db):
// esa es exactamente la garantía de seguridad — no hay forma remota de usar este script.
//
// Uso (en el servidor, como el usuario familycloud o con sudo):
//   node scripts/reset-password.js <usuario>
//
// Pide la nueva contraseña dos veces sin mostrarla. Si la entrada no es un terminal
// (p. ej. tubería), lee dos líneas de stdin con un aviso de visibilidad.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  console.error('[!] No se encontró .env en ' + ROOT);
  process.exit(1);
}

const username = process.argv[2];
if (!username) {
  console.error('Uso: node scripts/reset-password.js <usuario>');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || path.join(ROOT, 'data', 'calendar.db');
const db = new DatabaseSync(dbPath);
const user = db.prepare('SELECT id, username, active FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`No existe la cuenta "${username}". Cuentas existentes:`);
  for (const u of db.prepare('SELECT username, role, active FROM users').all()) {
    console.error(`  - ${u.username} (${u.role}${u.active ? '' : ', desactivada'})`);
  }
  process.exit(1);
}

// --- lectura oculta de la nueva contraseña ---
function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return resolve(null); // sin terminal: usar fallback
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    const onData = (chunk) => {
      for (const c of chunk.toString()) {
        if (c === '\n' || c === '\r' || c === '\u0004') { finish(); return; }
        if (c === '\u0003') { stdin.setRawMode(false); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else if (c >= ' ') buf += c;
      }
    };
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(buf);
    };
    stdin.on('data', onData);
  });
}

async function readNewPassword() {
  const a = await askHidden('Nueva contraseña (mín. 8 caracteres): ');
  if (a === null) {
    console.warn('AVISO: sin terminal: la contraseña se leerá de stdin (introdúcela por tubería).');
    const lines = await new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', (d) => (data += d));
      process.stdin.on('end', () => resolve(data.split('\n').map((l) => l.replace(/\r$/, ''))));
    });
    return [lines[0], lines[1]];
  }
  const b = await askHidden('Repita la contraseña: ');
  return [a, b];
}

const [p1, p2] = await readNewPassword();
if (!p1 || p1.length < 8) {
  console.error('ERROR: la contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}
if (p1 !== p2) {
  console.error('ERROR: las contraseñas no coinciden.');
  process.exit(1);
}

db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(p1, 12), user.id);
if (!user.active) {
  console.warn(`AVISO: la cuenta "${user.username}" está DESACTIVADA; sigue sin poder acceder hasta que un admin la active.`);
}
console.log(`Contraseña de "${user.username}" actualizada correctamente.`);
