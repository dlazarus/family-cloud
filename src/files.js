// API de archivos personales (y de la CARPETA-COMPARTIDA).
//
// Modelo: el ARBOL vive en la base de datos (fs_nodes) con los nombres cifrados; en el
// disco solo hay blobs cifrados con nombre opaco (FILES_DIR/<uid>/<hex>.bin). Por eso:
//   * no existe riesgo de path traversal (ninguna ruta se construye con nombres del usuario)
//   * renombrar/mover es barato y no toca el contenido
//   * ni los nombres ni el contenido se leen en claro en el disco
//
// Aislamiento: igual que el gestor de contraseñas, TODAS las consultas filtran por
// user_id y un id ajeno responde 404 (no se filtra la existencia). Unica excepcion
// deliberada: el arbol scope='shared' (CARPETA-COMPARTIDA) es visible en LECTURA para
// el resto de usuarios activos; escribir en el compartido ajeno esta prohibido.
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import rateLimit from 'express-rate-limit';

import { getDb, getSetting, setSetting } from './db.js';
import { requireAuth } from './auth.js';
import { encryptForUser, decryptForUser, newFileCipher, newFileDecipher } from './crypto.js';
import { getFilesDir, filesDirFor, storageStatus } from './storage.js';
import { ZipWriter } from './zip.js';

export const filesRouter = Router();
filesRouter.use(requireAuth);

const filesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento.' },
});
filesRouter.use(filesLimiter);

const MB = 1024 * 1024;
const MAX_DEPTH = 20;
const MAX_NODES = 5000; // tope suave: el arbol se envia descifrado al navegador
const ZIP_32BIT_LIMIT = 4 * 1024 * 1024 * 1024; // limitacion del ZIP sin Zip64

function cfg() {
  const quotaMb = Number(getSetting('file_quota_mb', '4096'));
  return {
    quotaMb,
    quotaBytes: quotaMb > 0 ? quotaMb * MB : Infinity, // 0 = sin limite
    maxUploadBytes: (Number(process.env.FILE_MAX_UPLOAD_MB || 0) || 0) * MB || Infinity,
    minFreeBytes: (Number(process.env.FILE_MIN_FREE_MB || 2048) || 2048) * MB,
    sharedName: getSetting('shared_folder_name', 'CARPETA-COMPARTIDA'),
  };
}

// ---------------- nombres ----------------
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// Validacion pensada para que un disco NTFS/vfat no de sorpresas: ahí no caben estos
// caracteres ni estos nombres, y mayuscululas/minuscululas no se distinguen.
function validateName(raw, { allowSharedName = false } = {}) {
  const name = String(raw ?? '').trim();
  if (!name) return { error: 'El nombre no puede estar vacio.' };
  if (name === '.' || name === '..') return { error: 'Nombre no valido.' };
  if (name.length > 200) return { error: 'El nombre es demasiado largo (max. 200 caracteres).' };
  if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name)) {
    return { error: 'Nombre no valido: no se permiten \\ / : * ? " < > | ni caracteres de control.' };
  }
  if (/[. ]$/.test(name)) return { error: 'El nombre no puede terminar en punto o espacio.' };
  if (WINDOWS_RESERVED.test(name)) return { error: 'Ese nombre esta reservado (CON, PRN, AUX, NUL, COM1-9, LPT1-9).' };
  if (!allowSharedName && name.toLowerCase() === cfg().sharedName.toLowerCase()) {
    return { error: `Ese nombre esta reservado por la carpeta compartida (${cfg().sharedName}).` };
  }
  return { value: name };
}

function sameName(a, b) {
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }) === 0;
}

// ---------------- nodos ----------------
function rowToPublic(user, row, names) {
  const shared = row.scope === 'shared';
  const name = shared && row.parent_id === null ? names.shared : decryptForUser(user, row.name_enc, row.enc_ver);
  return {
    id: row.id,
    parent_id: row.parent_id,
    kind: row.kind,
    scope: row.scope,
    is_shared_root: shared && row.parent_id === null,
    name,
    size: row.kind === 'file' ? Number(row.size_bytes || 0) : null,
    mime: row.mime || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function findNode(id) {
  return getDb().prepare('SELECT * FROM fs_nodes WHERE id = ?').get(Number(id));
}

// Reglas de acceso del arbol de archivos.
//   private -> solo el dueño
//   shared  -> dueño (todo) / resto de usuarios (leer y descargar)
function accessOf(user, row) {
  if (!row) return null;
  if (row.user_id === user.id) return { row, owner: true, readable: true };
  if (row.scope === 'shared') {
    const owner = getDb().prepare('SELECT id, active FROM users WHERE id = ?').get(row.user_id);
    if (owner && owner.active) return { row, owner: false, readable: true };
  }
  return null;
}

function requireNode(user, id, { write = false } = {}) {
  const acc = accessOf(user, findNode(id));
  if (!acc) return { error: { code: 404, msg: 'No encontrado' } };
  if (write && !acc.owner) return { error: { code: 403, msg: 'Solo el dueño puede modificar su carpeta compartida.' } };
  return acc;
}

// Raiz compartida: una por usuario, creada la primera vez que se necesita.
// Su nombre NO se guarda por fila: es el ajuste global shared_folder_name.
function ensureSharedRoot(user) {
  const db = getDb();
  let row = db
    .prepare("SELECT * FROM fs_nodes WHERE user_id = ? AND scope = 'shared' AND parent_id IS NULL")
    .get(user.id);
  if (!row) {
    db.prepare("INSERT INTO fs_nodes (user_id, parent_id, kind, scope, name_enc) VALUES (?, NULL, 'folder', 'shared', NULL)").run(user.id);
    row = db
      .prepare("SELECT * FROM fs_nodes WHERE user_id = ? AND scope = 'shared' AND parent_id IS NULL")
      .get(user.id);
  }
  return row;
}

function totalNodes(userId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM fs_nodes WHERE user_id = ?').get(userId).n;
}

function depthOf(row) {
  let depth = 0;
  let cur = row;
  while (cur && cur.parent_id !== null) {
    cur = findNode(cur.parent_id);
    depth += 1;
    if (depth > MAX_DEPTH + 5) break;
  }
  return depth;
}

function isDescendant(ancestorId, nodeId) {
  let cur = findNode(nodeId);
  while (cur && cur.parent_id !== null) {
    if (cur.id === ancestorId) return true;
    cur = findNode(cur.parent_id);
  }
  return false;
}

// Subarbol completo (incluida la raiz) en orden de ascendientes.
function subtree(rootId) {
  const out = [];
  const db = getDb();
  const walk = (id) => {
    const node = findNode(id);
    if (!node) return;
    out.push(node);
    for (const child of db.prepare('SELECT id FROM fs_nodes WHERE parent_id = ?').all(id)) walk(child.id);
  };
  walk(rootId);
  return out;
}

// ---------------- cupo ----------------
function quotaFor(user) {
  const c = cfg();
  const own = getDb().prepare('SELECT quota_mb FROM users WHERE id = ?').get(user.id);
  const q = own && own.quota_mb !== null && own.quota_mb !== undefined ? Number(own.quota_mb) : c.quotaMb;
  return q > 0 ? q * MB : Infinity;
}

function usedBytes(userId) {
  return Number(
    getDb()
      .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM fs_nodes WHERE user_id = ? AND kind = 'file'")
      .get(userId).n
  );
}

function sendBlob(user, node, res, { inline = false } = {}) {
  const abs = path.join(getFilesDir(), node.blob_rel);
  if (!fs.existsSync(abs)) {
    return res.status(500).json({ error: 'El archivo no esta en el disco (¿se ha desconectado el almacenamiento?).' });
  }
  const name = node.scope === 'shared' && node.parent_id === null ? cfg().sharedName : decryptForUser(user, node.name_enc, node.enc_ver);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  res.setHeader('Content-Type', node.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'no-store');
  const raw = fs.createReadStream(abs);
  let dec;
  try {
    dec = newFileDecipher(node);
  } catch (e) {
    raw.destroy();
    return res.status(500).json({ error: `No se pudo descifrar: ${e.message}` });
  }
  raw.on('error', () => res.destroy());
  pipeline(raw, dec, res).catch((e) => {
    if (!res.headersSent) res.status(500).json({ error: `Error al descargar: ${e.message}` });
    else res.destroy();
  });
}

// ============================================================
// Listados
// ============================================================

// Arbol privado del usuario + su CARPETA-COMPARTIDA destacada (se muestra en la misma
// raiz, pero con aspecto claramente distinto: es lo unico que ve el resto de la familia).
filesRouter.get('/', (req, res) => {
  const u = req.session.user;
  ensureSharedRoot(u);
  const names = { shared: cfg().sharedName };
  const rows = getDb()
    .prepare("SELECT * FROM fs_nodes WHERE user_id = ? AND scope = 'private' ORDER BY kind, id")
    .all(u.id);
  const sharedRows = subtree(ensureSharedRoot(u).id);
  const otherUsers = getDb()
    .prepare("SELECT id, username FROM users WHERE active = 1 AND id <> ? ORDER BY username")
    .all(u.id);
  const sharedRoots = [];
  for (const other of otherUsers) {
    const root = getDb()
      .prepare("SELECT * FROM fs_nodes WHERE user_id = ? AND scope = 'shared' AND parent_id IS NULL")
      .get(other.id);
    if (!root) continue;
    const nodes = subtree(root.id).map((r) => rowToPublic(u, r, names));
    for (const n of nodes) n.owner = other.username;
    sharedRoots.push(nodes);
  }
  const st = storageStatus();
  res.json({
    storage: st,
    quota: {
      used: usedBytes(u.id),
      limit: Number.isFinite(quotaFor(u.id)) ? quotaFor(u.id) : null,
      unlimited: !Number.isFinite(quotaFor(u.id)),
      max_upload: Number.isFinite(cfg().maxUploadBytes) ? cfg().maxUploadBytes : null,
    },
    shared_folder_name: names.shared,
    private: rows.map((r) => rowToPublic(u, r, names)),
    shared_own: sharedRows.map((r) => rowToPublic(u, r, names)),
    shared_others: sharedRoots.flat(),
  });
});

filesRouter.get('/usage', (req, res) => {
  const u = req.session.user;
  const st = storageStatus();
  res.json({
    used: usedBytes(u.id),
    limit: quotaFor(u.id),
    unlimited: !Number.isFinite(quotaFor(u.id)),
    max_upload: cfg().maxUploadBytes,
    min_free: cfg().minFreeBytes,
    shared_folder_name: cfg().sharedName,
    storage: st,
  });
});

// ============================================================
// Carpetas
// ============================================================
filesRouter.post('/folder', (req, res) => {
  const u = req.session.user;
  const scope = req.body?.scope === 'shared' ? 'shared' : 'private';
  const v = validateName(req.body?.name);
  if (v.error) return res.status(400).json({ error: v.error });
  const name = v.value;

  let parentId = null;
  if (scope === 'shared') {
    parentId = req.body?.parent_id ? Number(req.body.parent_id) : ensureSharedRoot(u).id;
    const acc = requireNode(u, parentId, { write: true });
    if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
    if (acc.row.kind !== 'folder' || acc.row.scope !== 'shared') return res.status(400).json({ error: 'El destino no es una carpeta compartida.' });
  } else if (req.body?.parent_id) {
    parentId = Number(req.body.parent_id);
    const acc = requireNode(u, parentId, { write: true });
    if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
    if (acc.row.kind !== 'folder' || acc.row.scope !== 'private') return res.status(400).json({ error: 'El destino no es una carpeta.' });
    if (depthOf(acc.row) + 1 > MAX_DEPTH) return res.status(400).json({ error: `Demasiada profundidad (max. ${MAX_DEPTH} niveles).` });
  }

  for (const sib of getDb().prepare('SELECT name_enc, enc_ver FROM fs_nodes WHERE parent_id IS ? AND scope = ? AND user_id = ?').all(parentId, scope, u.id)) {
    if (sameName(decryptForUser(u, sib.name_enc, sib.enc_ver), name)) {
      return res.status(409).json({ error: `Ya existe "${name}" en esta carpeta.` });
    }
  }
  if (totalNodes(u.id) >= MAX_NODES) return res.status(400).json({ error: `Demasiados elementos (max. ${MAX_NODES}).` });

  const info = getDb()
    .prepare('INSERT INTO fs_nodes (user_id, parent_id, kind, scope, name_enc) VALUES (?, ?, ?, ?, ?)')
    .run(u.id, parentId, 'folder', scope, encryptForUser(u, name));
  res.status(201).json(rowToPublic(u, findNode(info.lastInsertRowid), { shared: cfg().sharedName }));
});

// ============================================================
// Subida (cuerpo crudo: el navegador envia el fichero como application/octet-stream)
// ============================================================
filesRouter.post('/upload', async (req, res) => {
  const u = req.session.user;
  const st = storageStatus();
  if (!st.ok) {
    return res.status(503).json({ error: `El almacenamiento de archivos no esta disponible (${st.path}).` });
  }
  const c = cfg();
  const scope = req.query.scope === 'shared' ? 'shared' : 'private';
  let parentId = null;
  if (scope === 'shared') {
    parentId = req.query.parent ? Number(req.query.parent) : ensureSharedRoot(u).id;
    const acc = requireNode(u, parentId, { write: true });
    if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
    if (acc.row.kind !== 'folder' || acc.row.scope !== 'shared') return res.status(400).json({ error: 'El destino no es una carpeta compartida.' });
  } else if (req.query.parent) {
    parentId = Number(req.query.parent);
    const acc = requireNode(u, parentId, { write: true });
    if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
    if (acc.row.kind !== 'folder' || acc.row.scope !== 'private') return res.status(400).json({ error: 'El destino no es una carpeta.' });
    if (depthOf(acc.row) + 1 > MAX_DEPTH) return res.status(400).json({ error: `Demasiada profundidad (max. ${MAX_DEPTH} niveles).` });
  }

  let name;
  try {
    name = decodeURIComponent(String(req.get('x-file-name') || ''));
  } catch {
    return res.status(400).json({ error: 'Nombre de archivo no valido.' });
  }
  // Las cabeceras HTTP viajan como bytes: si el cliente no ha percent-encodeado el
  // nombre, Node lo lee como latin1 y los acentos salen como 'Ã±'. Se normaliza.
  if (/[ÂÃ]/.test(name)) {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD')) name = fixed;
  }
  const v = validateName(name);
  if (v.error) return res.status(400).json({ error: v.error });
  name = v.value;

  const declared = Number(req.get('content-length') || 0);
  const limit = quotaFor(u.id);
  const used = usedBytes(u.id);
  if (Number.isFinite(limit) && used + declared > limit) {
    return res.status(507).json({
      error: `No te cabe: ocupas ${(used / MB).toFixed(0)} MB de ${(limit / MB).toFixed(0)} MB concedidos${declared ? ` y este archivo pesa ${(declared / MB).toFixed(0)} MB` : ''}.`,
    });
  }
  if (Number.isFinite(c.maxUploadBytes) && declared > c.maxUploadBytes) {
    return res.status(413).json({ error: `Archivo demasiado grande (max. ${(c.maxUploadBytes / MB).toFixed(0)} MB).` });
  }
  if (st.free_bytes != null && st.free_bytes < c.minFreeBytes) {
    return res.status(507).json({ error: `Queda poco espacio libre en el disco (${(st.free_bytes / MB).toFixed(0)} MB).` });
  }

  // 1) fila -> id (el id es parte del AAD del cifrado)
  const info = getDb()
    .prepare("INSERT INTO fs_nodes (user_id, parent_id, kind, scope, name_enc, mime) VALUES (?, ?, 'file', ?, ?, ?)")
    .run(u.id, parentId, scope, encryptForUser(u, name), String(req.get('x-file-type') || '').slice(0, 120) || null);
  const nodeId = Number(info.lastInsertRowid);
  const node = findNode(nodeId);

  // 2) stream: req -> contadores -> cifrado -> .part   (nada se acumula en memoria)
  const dir = filesDirFor(u);
  fs.mkdirSync(dir, { recursive: true });
  const finalRel = path.join(String(u.id), `${crypto.randomBytes(16).toString('hex')}.bin`);
  const partAbs = path.join(getFilesDir(), finalRel + '.part');
  const { cipher, iv } = newFileCipher(nodeId);

  let received = 0;
  let aborted = null;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (Number.isFinite(c.maxUploadBytes) && received > c.maxUploadBytes) aborted = 'too-big';
      else if (Number.isFinite(limit) && used + received > limit) aborted = 'quota';
      else if (st.free_bytes != null && st.free_bytes - received < c.minFreeBytes) aborted = 'disk';
      if (aborted) return cb(new Error('abort:' + aborted));
      cb(null, chunk);
    },
  });

  try {
    await pipeline(req, counter, cipher, fs.createWriteStream(partAbs));
  } catch (e) {
    fs.rmSync(partAbs, { force: true });
    getDb().prepare('DELETE FROM fs_nodes WHERE id = ?').run(nodeId);
    const why = String(e.message || '');
    if (why.startsWith('abort:quota')) return res.status(507).json({ error: 'La subida supera tu espacio concedido.' });
    if (why.startsWith('abort:too-big')) return res.status(413).json({ error: `Archivo demasiado grande (max. ${(c.maxUploadBytes / MB).toFixed(0)} MB).` });
    if (why.startsWith('abort:disk')) return res.status(507).json({ error: 'No queda espacio libre suficiente en el disco.' });
    return res.status(400).json({ error: 'La subida se ha interrumpido.' });
  }

  fs.renameSync(partAbs, path.join(getFilesDir(), finalRel));
  getDb()
    .prepare("UPDATE fs_nodes SET size_bytes = ?, blob_rel = ?, blob_iv = ?, blob_tag = ?, updated_at = datetime('now') WHERE id = ?")
    .run(received, finalRel, iv.toString('base64'), cipher.getAuthTag().toString('base64'), nodeId);

  res.status(201).json(rowToPublic(u, findNode(nodeId), { shared: cfg().sharedName }));
});

// ============================================================
// Descargas
// ============================================================
filesRouter.get('/:id/download', (req, res) => {
  const acc = requireNode(req.session.user, req.params.id);
  if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
  if (acc.row.kind !== 'file') return res.status(400).json({ error: 'Ese elemento es una carpeta: usa «descargar carpeta».' });
  sendBlob(req.session.user, acc.row, res);
});

// Carpeta entera en un .zip stremeado (los archivos se descifran al vuelo).
// Limitacion honesta: sin Zip64 el total ha de quedar por debajo de 4 GB.
filesRouter.get('/:id/archive', async (req, res) => {
  const u = req.session.user;
  const acc = requireNode(u, req.params.id);
  if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
  if (acc.row.kind !== 'folder') return res.status(400).json({ error: 'Solo se pueden descargar en .zip las carpetas.' });
  const rows = subtree(acc.row.id);
  const names = { shared: cfg().sharedName };
  const items = rows.map((r) => ({ row: r, pub: rowToPublic(u, r, names) }));
  const total = items.reduce((s, i) => s + (i.pub.size || 0), 0);
  if (total >= ZIP_32BIT_LIMIT) {
    return res.status(400).json({ error: 'La carpeta supera 4 GB: descarga los archivos uno a uno.' });
  }
  // mapa id -> ruta visible
  const pathOf = new Map();
  for (const it of items) {
    const parent = it.row.parent_id ? pathOf.get(it.row.parent_id) : '';
    pathOf.set(it.row.id, `${parent}${parent ? '/' : ''}${it.pub.name}`);
  }
  const rootName = items[0].pub.name;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${rootName.replace(/[^\x20-\x7e]/g, '_')}.zip"; filename*=UTF-8''${encodeURIComponent(rootName)}.zip`);
  res.setHeader('Cache-Control', 'no-store');
  const zip = new ZipWriter(res);
  try {
    for (const it of items) {
      // pathOf ya incluye el nombre de la raiz: la entrada del zip queda "Carpeta/sub/archivo"
      const entry = `${pathOf.get(it.row.id)}${it.row.kind === 'folder' ? '/' : ''}`;
      if (it.row.kind === 'folder') {
        await zip.add({ name: entry, isDir: true, mtime: it.row.updated_at });
      } else {
        const raw = fs.createReadStream(path.join(getFilesDir(), it.row.blob_rel));
        await zip.add({ name: entry, mtime: it.row.updated_at, source: raw.pipe(newFileDecipher(it.row)) });
      }
    }
    await zip.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: `Error al preparar el .zip: ${e.message}` });
    else res.destroy();
  }
});

// ============================================================
// Renombrar / mover / borrar
// ============================================================
filesRouter.put('/:id', (req, res) => {
  const u = req.session.user;
  const acc = requireNode(u, req.params.id, { write: true });
  if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
  const row = acc.row;
  if (row.scope === 'shared' && row.parent_id === null) {
    return res.status(400).json({ error: `El nombre de la carpeta compartida solo lo puede cambiar el administrador.` });
  }
  const v = validateName(req.body?.name, { allowSharedName: row.scope === 'shared' });
  if (v.error) return res.status(400).json({ error: v.error });
  for (const sib of getDb().prepare('SELECT id, name_enc, enc_ver FROM fs_nodes WHERE parent_id IS ? AND scope = ? AND user_id = ? AND id <> ?').all(row.parent_id, row.scope, u.id, row.id)) {
    if (sameName(decryptForUser(u, sib.name_enc, sib.enc_ver), v.value)) {
      return res.status(409).json({ error: `Ya existe "${v.value}" en esta carpeta.` });
    }
  }
  getDb()
    .prepare("UPDATE fs_nodes SET name_enc = ?, updated_at = datetime('now') WHERE id = ?")
    .run(encryptForUser(u, v.value), row.id);
  res.json(rowToPublic(u, findNode(row.id), { shared: cfg().sharedName }));
});

filesRouter.post('/:id/move', (req, res) => {
  const u = req.session.user;
  const acc = requireNode(u, req.params.id, { write: true });
  if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
  const row = acc.row;
  if (row.scope === 'shared' && row.parent_id === null) {
    return res.status(400).json({ error: 'La carpeta compartida no se puede mover.' });
  }
  const rawDest = req.body?.parent_id;
  const destId = rawDest === null || rawDest === undefined || rawDest === '' ? null : Number(rawDest);
  if (destId !== null) {
    const dest = requireNode(u, destId, { write: true });
    if (dest.error) return res.status(dest.error.code).json({ error: dest.error.msg });
    if (dest.row.kind !== 'folder') return res.status(400).json({ error: 'El destino no es una carpeta.' });
    if (dest.row.scope !== row.scope) return res.status(400).json({ error: 'No se puede mover entre lo privado y lo compartido.' });
    if (dest.row.id === row.id || isDescendant(row.id, dest.row.id)) {
      return res.status(400).json({ error: 'No puedes mover una carpeta dentro de si misma.' });
    }
    if (depthOf(dest.row) + depthOf(row) + 1 > MAX_DEPTH) return res.status(400).json({ error: `Ese moveria algo mas alla de ${MAX_DEPTH} niveles.` });
  } else if (row.scope === 'shared') {
    return res.status(400).json({ error: 'Dentro de la carpeta compartida si que puedes mover elementos (a la raiz: elige «CARPETA-COMPARTIDA»).' });
  }
  getDb().prepare("UPDATE fs_nodes SET parent_id = ?, updated_at = datetime('now') WHERE id = ?").run(destId, row.id);
  res.json(rowToPublic(u, findNode(row.id), { shared: cfg().sharedName }));
});

filesRouter.delete('/:id', (req, res) => {
  const u = req.session.user;
  const acc = requireNode(u, req.params.id, { write: true });
  if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
  const row = acc.row;
  if (row.scope === 'shared' && row.parent_id === null) {
    return res.status(400).json({ error: 'La carpeta compartida no se puede eliminar (si quieres, vaciala).' });
  }
  const rows = subtree(row.id);
  for (const r of rows) {
    if (r.kind === 'file' && r.blob_rel) fs.rmSync(path.join(getFilesDir(), r.blob_rel), { force: true });
  }
  getDb().prepare('DELETE FROM fs_nodes WHERE id = ?').run(row.id); // la cascada borra el subarbol
  res.json({ ok: true, removed: rows.length });
});

// Vaciar la raiz compartida (borrar su contenido, conservar la carpeta).
filesRouter.post('/:id/empty', (req, res) => {
  const u = req.session.user;
  const acc = requireNode(u, req.params.id, { write: true });
  if (acc.error) return res.status(acc.error.code).json({ error: acc.error.msg });
  if (!(acc.row.scope === 'shared' && acc.row.parent_id === null)) {
    return res.status(400).json({ error: 'Solo se puede vaciar la carpeta compartida.' });
  }
  let n = 0;
  for (const child of getDb().prepare('SELECT id FROM fs_nodes WHERE parent_id = ?').all(acc.row.id)) {
    for (const r of subtree(child.id)) {
      if (r.kind === 'file' && r.blob_rel) fs.rmSync(path.join(getFilesDir(), r.blob_rel), { force: true });
    }
    getDb().prepare('DELETE FROM fs_nodes WHERE id = ?').run(child.id);
    n += 1;
  }
  res.json({ ok: true, removed: n });
});

// ----------------------------------------------------------
// Ajuste global del nombre de la carpeta compartida (solo admin).
// El nombre es UN valor global: por eso cambiarlo una vez lo cambia para toda la
// familia y un miembro no puede renombrar su propia carpeta compartida.
// ----------------------------------------------------------
export function renameSharedFolder(rawName) {
  const v = validateName(rawName, { allowSharedName: true });
  if (v.error) return v;
  setSetting('shared_folder_name', v.value);
  return { value: v.value };
}
