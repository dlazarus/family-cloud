import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import { getDb, getSetting, setSetting } from './db.js';
import { requireAdmin } from './auth.js';
import { filesDirFor } from './storage.js';
import { renameSharedFolder } from './files.js';

export const usersRouter = Router();
usersRouter.use(requireAdmin);

// La cuenta "admin" es la cuenta del sistema: no puede desactivarse, cambiar de rol ni eliminarse.
const SYSTEM_ADMIN = 'admin';
const isSystemAdmin = (username) => String(username).toLowerCase() === SYSTEM_ADMIN;

usersRouter.get('/', (_req, res) => {
  const rows = getDb()
    .prepare('SELECT id, username, role, active, created_at FROM users ORDER BY username')
    .all();
  res.json(rows);
});

// Espacio ocupado y concedido por cuenta (SOLO tamanos: nunca nombres ni contenido).
usersRouter.get('/usage', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT u.id, u.username, u.role, u.active, u.quota_mb,
              COALESCE((SELECT SUM(f.size_bytes) FROM fs_nodes f
                        WHERE f.user_id = u.id AND f.kind = 'file'), 0) AS used_bytes
       FROM users u ORDER BY u.username`
    )
    .all();
  const globalMb = Number(getSetting('file_quota_mb', '4096'));
  res.json({
    global_quota_mb: globalMb,
    shared_folder_name: getSetting('shared_folder_name', 'CARPETA-COMPARTIDA'),
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      active: r.active,
      used_bytes: Number(r.used_bytes),
      quota_mb: r.quota_mb === null || r.quota_mb === undefined ? null : Number(r.quota_mb),
      effective_mb: (r.quota_mb === null || r.quota_mb === undefined ? globalMb : Number(r.quota_mb)) || 0,
      unlimited: Number(r.quota_mb ?? globalMb) <= 0,
    })),
  });
});

// Ajustes globales de archivos: cupo por defecto y nombre de la carpeta compartida.
usersRouter.put('/settings', (req, res) => {
  const b = req.body || {};
  const out = {};
  if (b.file_quota_mb !== undefined) {
    const q = Number(b.file_quota_mb);
    if (!Number.isFinite(q) || q < 0) return res.status(400).json({ error: 'El cupo debe ser un numero de MB (0 = sin limite).' });
    setSetting('file_quota_mb', String(Math.round(q)));
    out.file_quota_mb = Math.round(q);
  }
  if (b.shared_folder_name !== undefined) {
    const r = renameSharedFolder(b.shared_folder_name);
    if (r.error) return res.status(400).json({ error: r.error });
    out.shared_folder_name = r.value;
  }
  if (!Object.keys(out).length) return res.status(400).json({ error: 'Nada que actualizar' });
  res.json({ ok: true, ...out });
});

usersRouter.post('/', (req, res) => {
  const { username, password, role = 'member' } = req.body || {};
  const uname = String(username ?? '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(uname)) {
    return res.status(400).json({ error: 'Nombre de usuario no válido (3-30 caracteres, sin espacios).' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Rol no válido' });
  try {
    const hash = bcrypt.hashSync(String(password), 12);
    const info = getDb()
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(uname, hash, role);
    res.status(201).json({ id: Number(info.lastInsertRowid), username: uname, role });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ese nombre ya existe.' });
    throw e;
  }
});

usersRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { password, active, role, quota_mb } = req.body || {};
  const sets = [];
  const vals = [];
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    // La contraseña de la cuenta "admin" solo la cambia el propio admin (via /me/password)
    // o el script de consola en el propio servidor.
    if (isSystemAdmin(user.username) && id !== req.session.user.id) {
      return res.status(400).json({ error: 'La contraseña de la cuenta "admin" solo puede cambiarla el propio admin, o resetearse por consola en el servidor.' });
    }
    sets.push('password_hash = ?');
    vals.push(bcrypt.hashSync(String(password), 12));
  }
  if (active !== undefined) {
    // No desactivarse a sí mismo
    if (id === req.session.user.id) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
    if (isSystemAdmin(user.username)) return res.status(400).json({ error: 'La cuenta "admin" es la cuenta del sistema y no puede desactivarse.' });
    sets.push('active = ?');
    vals.push(active ? 1 : 0);
  }
  if (role !== undefined) {
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Rol no válido' });
    if (isSystemAdmin(user.username) && role !== 'admin') {
      return res.status(400).json({ error: 'La cuenta "admin" no puede dejar de ser administradora.' });
    }
    if (id === req.session.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'No puedes quitarte el rol de administrador a ti mismo.' });
    }
    sets.push('role = ?');
    vals.push(role);
  }
  if (quota_mb !== undefined) {
    const q = quota_mb === null || quota_mb === '' ? null : Number(quota_mb);
    if (q !== null && (!Number.isFinite(q) || q < 0)) {
      return res.status(400).json({ error: 'El cupo debe ser un numero de MB (0 = sin limite, vacio = usar el valor general).' });
    }
    sets.push('quota_mb = ?');
    vals.push(q);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  res.json({ ok: true });
});

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  const target = getDb().prepare('SELECT role, username FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (isSystemAdmin(target.username)) return res.status(400).json({ error: 'La cuenta "admin" es la cuenta del sistema y no puede eliminarse.' });
  // Debe quedar siempre al menos un administrador ACTIVO
  const activeAdmins = getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
  if (target.role === 'admin' && target.active && activeAdmins <= 1) {
    return res.status(400).json({ error: 'Debe quedar al menos un administrador activo.' });
  }
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  // La cascada de SQLite borra las filas del arbol, pero NO los blobs del disco:
  // al borrar una cuenta se borran tambien sus archivos ( asi lo pidio la familia ).
  fs.rmSync(filesDirFor({ id }), { recursive: true, force: true });
  res.json({ ok: true });
});
