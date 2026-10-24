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

// Con terminal se pregunta una a una (como siempre). SIN terminal (una tuberia,
// `printf '...\n' | node scripts/gen-env.js`, un playbook de aprobicion) se leen
// de una vez todas las lineas de stdin y se usan como respuestas: las que falten
// toman su valor por defecto. Antes, con tuberia, el script se quedaba colgado en
// el primer question y salia sin escribir el .env.
let cola = null;
if (!process.stdin.isTTY) {
  const rlPlano = (await import('node:readline')).default;
  cola = await new Promise((res) => {
    const acc = [];
    const li = rlPlano.createInterface({ input: process.stdin });
    li.on('line', (l) => acc.push(l.replace(/\r$/, '')));
    li.on('close', () => res(acc));
  });
  console.log('(sin terminal: las respuestas se leen de stdin; linea vacia = valor por defecto)');
}
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = async (q, def) => {
  if (cola) {
    const a = (cola.shift() ?? '').trim();
    console.log(`${q}${def ? ` [${def}]` : ''}: ${a || def}`);
    return a || def;
  }
  const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
  return a || def;
};

console.log('Configuración de Family Cloud');
console.log('La frase maestra cifra los eventos, las contraseñas y los nombres de archivo.');
console.log('Guárdala en un lugar seguro (gestor de contraseñas).\n');
const pass = await ask('Frase maestra');
if (!pass || pass.length < 10) {
  console.error('La frase maestra debe tener al menos 10 caracteres.');
  process.exit(1);
}

console.log('\nDónde se guarda todo (ruta relativa al proyecto o absoluta):');
const dataDir = await ask('  DATA_DIR (base de datos; mejor en el disco del sistema)', './data');
const filesDir = await ask('  FILES_DIR (archivos cifrados; admite un disco externo)', './data/files');
const quota = await ask('  Cupo por defecto por cuenta en MB (0 = sin límite)', '4096');
const maxUpload = await ask('  Tope por archivo en MB (0 = sin tope, solo manda el cupo)', '0');
if (rl) rl.close();

const hex = () => crypto.randomBytes(32).toString('hex');
fs.writeFileSync(
  envPath,
  [
    `MASTER_PASSPHRASE=${JSON.stringify(pass)}`,
    `MASTER_SALT=${hex()}`,
    `SESSION_SECRET=${hex()}`,
    `DATA_DIR=${dataDir}`,
    `FILES_DIR=${filesDir}`,
    `FILE_QUOTA_MB=${quota}`,
    `FILE_MAX_UPLOAD_MB=${maxUpload}`,
    'FILE_MIN_FREE_MB=2048',
    'HOST=0.0.0.0',
    'PORT=3000',
    '',
  ].join('\n')
);
fs.chmodSync(envPath, 0o600);
console.log('Creado .env (permisos 600). Arranca con: npm start');
console.log('Recordatorio: preparar el disco externo (formatear/montar) lo hace el sysadmin antes de instalar.');
