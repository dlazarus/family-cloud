#!/usr/bin/env node
// Diagnóstico de almacenamiento de Family Cloud (SOLO LECTURA: no crea, no borra, no monta).
//
// Uso (en el servidor):  node scripts/storage-check.js
//
// Muestra de un vistazo: donde está cada cosa, tipo de sistema de ficheros, espacio
// libre, cuanto ocupa cada cuenta, que cupo tiene en vigor, y avisos cuando algo no
// encaja (SQLite sobre NTFS, cupos que no caben en el disco, rutas no escribibles).
'use strict';

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  console.error('[!] No se encontró .env — cópialo de .env.example y genera claves.');
  process.exit(1);
}

const { initDb, getDb, getSetting } = await import('../src/db.js');
const { resolveDirs, storageStatus, filesDirFor, describeStorage } = await import('../src/storage.js');

const MB = 1024 * 1024;
const fmt = (n) => (n === null || n === undefined ? '?' : `${Math.round(n / MB)} MB`);
const fstype = (p) => {
  try {
    return execSync(`findmnt -T "${p}" -no FSTYPE`, { encoding: 'utf8' }).trim() || 'desconocido';
  } catch {
    return 'desconocido';
  }
};

const dirs = resolveDirs(ROOT);
console.log('Rutas resueltas');
console.log(`  DATA_DIR  : ${dirs.dataDir}`);
console.log(`  FILES_DIR : ${dirs.filesDir}`);
console.log(`  (en .env:  DATA_DIR=${process.env.DATA_DIR || './data'}  FILES_DIR=${process.env.FILES_DIR || './data/files'})`);

const existsDb = fs.existsSync(path.join(dirs.dataDir, 'family-cloud.db'))
  || fs.existsSync(path.join(dirs.dataDir, 'calendar.db'));
if (existsDb) initDb(dirs.dataDir);
console.log(`\n${describeStorage()}`);

const st = storageStatus();
console.log('\nAlmacen de archivos');
console.log(`  estado    : ${st.ok ? 'OK' : 'PROBLEMA'}${st.error ? ` — ${st.error}` : ''}`);
console.log(`  sistema   : ${st.fstype}`);
console.log(`  libre     : ${fmt(st.free_bytes)}   total: ${fmt(st.total_bytes)}`);
console.log(`  POSIX     : ${st.posix_perms ? 'si (chown/chmod funcionan)' : 'no: la propiedad se fija al montar (uid=/gid=)'}`);
if (!st.posix_perms) {
  console.log('  montaje recomendado (eso lo aplica el sysadmin en /etc/fstab, nunca este script):');
  console.log(`    <disco> ${st.path} ${st.fstype} defaults,uid=USUARIO_DEL_SERVICIO,gid=GRUPO,fmask=0137,dmask=0137,nofail 0 0`);
}
const dataFs = fstype(dirs.dataDir);
if (/^(ntfs|ntfs3|vfat|exfat|fuseblk)$/i.test(dataFs)) {
  console.log(`\n[!] AVISO: DATA_DIR esta sobre ${dataFs}. SQLite en modo WAL necesita bloqueos POSIX fiables:`);
  console.log('    deja la base de datos en el disco del servidor y pon solo FILES_DIR en el disco externo.');
  console.log('    para mover los datos sin perder nada: scripts/relocate-data.sh');
}

console.log('\nOcupacion y cupos por cuenta');
if (!existsDb) {
  console.log('  (todavia no hay base de datos: nada que informar; este script no la crea)');
  process.exit(0);
}
const users = getDb().prepare('SELECT id, username, active, quota_mb FROM users ORDER BY username').all();
const globalMb = Number(getSetting('file_quota_mb', '4096'));
let concedidoTotal = 0;
for (const u of users) {
  const mb = u.quota_mb === null || u.quota_mb === undefined ? globalMb : Number(u.quota_mb);
  const bytes = getDb().prepare("SELECT COALESCE(SUM(size_bytes),0) b, COUNT(*) n FROM fs_nodes WHERE user_id=? AND kind='file'").get(u.id);
  if (mb > 0) concedidoTotal += mb;
  console.log(
    `  ${String(u.username).padEnd(14)} ${fmt(Number(bytes.b)).padStart(9)}  ${String(bytes.n).padStart(5)} archivos  ` +
      `cupo ${mb <= 0 ? 'sin limite' : fmt(mb * MB)}${u.quota_mb === null || u.quota_mb === undefined ? ' (global)' : ' (propio)'}` +
      `${u.active ? '' : '  [desactivada]'}`
  );
}
console.log(`\n  cupo global por defecto     : ${globalMb <= 0 ? 'sin limite' : fmt(globalMb * MB)}`);
console.log(`  suma de cupos concedidos    : ${fmt(concedidoTotal * MB)}`);
console.log(`  libre en FILES_DIR          : ${fmt(st.free_bytes)}`);
if (st.free_bytes !== null && concedidoTotal > 0 && concedidoTotal * MB > st.free_bytes) {
  console.log('[!] AVISO: la suma de cupos concedidos supera el espacio libre del disco.');
  console.log('    ajusta los cupos desde Administracion o libera espacio (la limpieza del disco es tuya).');
}
console.log(`\n  la carpeta compartida se llama: ${getSetting('shared_folder_name', 'CARPETA-COMPARTIDA')}`);

console.log('\nCarpeta de cada cuenta dentro de FILES_DIR');
for (const u of users) {
  const dir = filesDirFor({ id: u.id });
  console.log(`  ${String(u.username).padEnd(14)} ${dir}${fs.existsSync(dir) ? '' : '  (aun sin crear)'}`);
}

console.log('\nNo se ha creado, movido ni borrado ningun dato (como mucho se aplican las migraciones de esquema idempotentes).');
