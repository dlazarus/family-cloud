// Ubicacion y salud del almacenamiento.
//
//   DATA_DIR  -> base de datos (quedara en el disco de sistema del servidor: SQLite en
//                modo WAL necesita bloqueos POSIX fiables, algo que NTFS/FUSE no da)
//   FILES_DIR  -> blobs CIFRADOS de los archivos de los usuarios (aqui si puede ir un
//                disco externo, formateado como quiera el sysadmin)
//
// Ambos admiten ruta relativa (resuelta contra la raiz del proyecto) o absoluta
// (p. ej. /mnt/datos/family-cloud-files). Preparar el disco (particionar, formatear,
// montar) es responsabilidad del sysadmin: aqui solo se usa la ruta que se le indique.
import fs from 'node:fs';
import path from 'node:path';

let dataDir = null;
let filesDir = null;

export function resolveDirs(root) {
  const raw = (name, def) => {
    const v = String(process.env[name] || def).trim() || def;
    return path.isAbsolute(v) ? path.normalize(v) : path.resolve(root, v);
  };
  dataDir = raw('DATA_DIR', path.join(root, 'data'));
  filesDir = raw('FILES_DIR', path.join(dataDir, 'files'));
  return { dataDir, filesDir };
}

export function getDataDir() {
  return dataDir;
}
export function filesDirFor(user) {
  return path.join(filesDir, String(user.id));
}
export function getFilesDir() {
  return filesDir;
}

// Crear lo que haga falta sin destruir nada. DATA_DIR se crea siempre; FILES_DIR solo
// si su padre existe (si el disco externo no esta montado, su padre puede no existir:
// ahi no creamos un directorio fantasma que taparia el punto de montaje).
export function ensureDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  let dirWarning = null;
  if (!fs.existsSync(filesDir)) {
    const parent = path.dirname(filesDir);
    if (fs.existsSync(parent)) fs.mkdirSync(filesDir, { recursive: true });
    else dirWarning = `no existe y no se puede crear (falta el disco/punto de montaje: ${parent})`;
  }
  return dirWarning;
}

// Tipo de sistema de ficheros real, leido de /proc/mounts (statfs no informa el tipo).
function fstypeOf(dir) {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8')
      .split('\n')
      .map((line) => line.split(' '))
      .filter((p) => p.length >= 3 && p[1])
      .map((p) => ({ mount: p[1].replace(/\\040/g, ' '), type: p[2] }))
      .sort((a, b) => b.mount.length - a.mount.length);
    let probe = dir;
    for (const m of mounts) {
      const inside = m.mount === '/' || probe === m.mount || probe.startsWith(m.mount + '/');
      if (inside) return m.type;
    }
  } catch { /* sin /proc/mounts */ }
  return 'desconocido';
}

// Estado del almacenamiento de archivos: se consulta en cada peticion de archivos,
// asi que un disco desconectado se detecta al vuelo sin reiniciar el servicio.
export function storageStatus() {
  let writable = false;
  try {
    fs.accessSync(filesDir, fs.constants.W_OK | fs.constants.X_OK);
    writable = fs.statSync(filesDir).isDirectory();
  } catch {
    writable = false;
  }
  let stat = null;
  try {
    stat = fs.statfsSync(filesDir);
  } catch { /* no montado */ }
  // si la ruta no existe no hay montaje detras: no hay que confundirlo con el tipo del
  // sistema donde vive su padre (que seria el disco del servidor)
  let fstype = fstypeOf(filesDir);
  if (!fs.existsSync(filesDir)) {
    fstype = fs.existsSync(path.dirname(filesDir)) ? 'aun sin crear' : 'no montado';
  }
  return {
    ok: writable,
    path: filesDir,
    fstype,
    // ntfs/vfat no admiten chown/chmod: la propiedad se fija en el montaje
    posix_perms: !/ntfs|vfat|fuse/i.test(fstype),
    free_bytes: stat ? stat.bavail * stat.bsize : null,
    total_bytes: stat ? stat.blocks * stat.bsize : null,
  };
}

// Resumen para el log de arranque y para scripts de consola.
export function describeStorage() {
  const st = storageStatus();
  const free = st.free_bytes == null ? '?' : `${Math.round(st.free_bytes / 1024 / 1024)} MB`;
  return `FILES_DIR=${st.path} [${st.fstype}] ${st.ok ? 'escribible' : 'NO escribible'} libre=${free}`;
}
