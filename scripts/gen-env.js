import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(ROOT, '.env');

if (fs.existsSync(envPath)) {
  console.error('Ya existe .env — no lo sobrescribo. Edítalo a mano si quieres cambiar valores.');
  process.exit(1);
}

const readline = await import('node:readline/promises');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Configuración del calendario familiar');
console.log('La frase maestra cifra los eventos. Guárdala en un lugar seguro (gestor de contraseñas).');
const pass = await rl.question('Frase maestra: ');
if (!pass || pass.length < 10) {
  console.error('La frase maestra debe tener al menos 10 caracteres.');
  process.exit(1);
}
rl.close();

const hex = () => crypto.randomBytes(32).toString('hex');
fs.writeFileSync(
  envPath,
  `MASTER_PASSPHRASE=${JSON.stringify(pass)}\nMASTER_SALT=${hex()}\nSESSION_SECRET=${hex()}\nHOST=0.0.0.0\nPORT=3000\n`
);
fs.chmodSync(envPath, 0o600);
console.log('Creado .env (permisos 600). Arranca con: npm start');
