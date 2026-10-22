import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getDb } from './db.js';

export const statusRouter = Router();
export const authRouter = Router();

function userCount() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function hasUsers() {
  return userCount() > 0;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 1000 * 60,
  limit: 10,
  // solo cuentan los intentos FALLIDOS: un uso normal nunca agota la cuota
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Espera unos minutos.' },
});

// --- Estado de configuración (público) ---
statusRouter.get('/status', (_req, res) => {
  res.json({ needsSetup: !hasUsers() });
});

// --- Bootstrap del administrador (un solo uso) ---
authRouter.post('/setup', loginLimiter, (req, res) => {
  if (hasUsers()) return res.status(404).json({ error: 'No encontrado' });
  const { username = 'admin', password } = req.body || {};
  const uname = String(username).trim();
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(uname)) {
    return res.status(400).json({ error: 'Nombre de usuario no válido (3-30 caracteres, sin espacios).' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  const hash = bcrypt.hashSync(String(password), 12);
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(uname, hash, 'admin');
  req.session.user = { id: Number(info.lastInsertRowid), username: uname, role: 'admin' };
  res.json({ ok: true, username: uname, role: 'admin' });
});

// --- Login / logout ---
authRouter.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username ?? '').trim());
  const ok = row && row.active && bcrypt.compareSync(String(password ?? ''), row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  req.session.user = { id: row.id, username: row.username, role: row.role };
  res.json({ ok: true, username: row.username, role: row.role });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  res.clearCookie('familycloud.sid');
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'No autenticado' });
  res.json(req.session.user);
});

// --- Cambio de propia contraseña (cualquier usuario, incluido admin) ---
authRouter.put('/me/password', loginLimiter, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'No autenticado' });
  const { current_password, new_password } = req.body || {};
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!row || !row.active) return res.status(401).json({ error: 'No autenticado' });
  if (!bcrypt.compareSync(String(current_password ?? ''), row.password_hash)) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  }
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }
  if (String(new_password) === String(current_password)) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser distinta a la actual.' });
  }
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(new_password), 12), row.id);
  res.json({ ok: true });
});

// --- Middlewares de protección ---
export function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'No autenticado' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Se requiere administrador' });
  next();
}
