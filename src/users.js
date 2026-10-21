import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from './db.js';
import { requireAdmin } from './auth.js';

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

  const { password, active, role } = req.body || {};
  const sets = [];
  const vals = [];
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
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
  res.json({ ok: true });
});
