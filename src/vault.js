import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { getDb } from './db.js';
import { requireAuth } from './auth.js';
import { encryptForUser, decryptForUser } from './crypto.js';

export const vaultRouter = Router();
vaultRouter.use(requireAuth);

const vaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento.' },
});
vaultRouter.use(vaultLimiter);

// Cada entrada pertenece SOLO a su usuario: todas las consultas filtran por
// user_id de la sesion. Un id ajeno responde 404 (no se filtra la existencia).
function toPublic(user, row) {
  return {
    id: row.id,
    site: decryptForUser(user, row.site_enc, row.enc_ver),
    login: decryptForUser(user, row.login_enc, row.enc_ver),
    password: decryptForUser(user, row.password_enc, row.enc_ver),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateBody(body) {
  const b = body || {};
  const site = String(b.site || '').trim();
  if (!site || site.length > 120) return { error: 'El sitio es obligatorio (p. ej. "google.com", max. 120 caracteres).' };
  const login = String(b.login || '').trim();
  if (!login || login.length > 120) return { error: 'El nombre de acceso es obligatorio (p. ej. "pepito@correo.com", max. 120 caracteres).' };
  const password = String(b.password || '');
  if (!password || password.length > 512) return { error: 'La contraseña es obligatoria (max. 512 caracteres).' };
  return { value: { site, login, password } };
}

// --- CRUD (solo las entradas del usuario autenticado) ---
vaultRouter.get('/', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM vault_entries WHERE user_id = ? ORDER BY id')
    .all(req.session.user.id);
  res.json(rows.map((r) => toPublic(req.session.user, r)));
});

vaultRouter.post('/', (req, res) => {
  const v = validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { site, login, password } = v.value;
  const u = req.session.user;
  const info = getDb()
    .prepare(`INSERT INTO vault_entries (user_id, site_enc, login_enc, password_enc)
              VALUES (?, ?, ?, ?)`)
    .run(u.id, encryptForUser(u, site), encryptForUser(u, login), encryptForUser(u, password));
  const row = getDb().prepare('SELECT * FROM vault_entries WHERE id = ? AND user_id = ?').get(Number(info.lastInsertRowid), u.id);
  res.status(201).json(toPublic(u, row));
});

vaultRouter.put('/:id', (req, res) => {
  const u = req.session.user;
  const id = Number(req.params.id);
  const row = getDb().prepare('SELECT * FROM vault_entries WHERE id = ? AND user_id = ?').get(id, u.id);
  if (!row) return res.status(404).json({ error: 'Entrada no encontrada' });
  const v = validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { site, login, password } = v.value;
  getDb()
    .prepare(`UPDATE vault_entries SET site_enc = ?, login_enc = ?, password_enc = ?, updated_at = datetime('now')
              WHERE id = ? AND user_id = ?`)
    .run(encryptForUser(u, site), encryptForUser(u, login), encryptForUser(u, password), id, u.id);
  res.json(toPublic(u, getDb().prepare('SELECT * FROM vault_entries WHERE id = ? AND user_id = ?').get(id, u.id)));
});

vaultRouter.delete('/:id', (req, res) => {
  const u = req.session.user;
  const info = getDb()
    .prepare('DELETE FROM vault_entries WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), u.id);
  if (!info.changes) return res.status(404).json({ error: 'Entrada no encontrada' });
  res.json({ ok: true });
});

// --- Generador de contraseñas seguras ---
const GEN_DEFAULTS = { length: 20, upper: true, lower: true, digits: true, symbols: true, avoidAmbiguous: false };
const GEN_POOLS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',   // sin I ni O (ambiguos) si avoidAmbiguous
  lower: 'abcdefghijkmnpqrstuvwxyz',   // sin l ni o
  digits: '23456789',                  // sin 0 ni 1
};
const GEN_POOLS_FULL = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
};
const GEN_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';

function randInt(max) {
  return crypto.randomInt(max); // uniforme y criptograficamente seguro
}

vaultRouter.post('/generate', (req, res) => {
  const b = req.body || {};
  const length = Math.min(128, Math.max(8, Number(b.length ?? GEN_DEFAULTS.length)));
  const avoidAmbiguous = Boolean(b.avoidAmbiguous ?? GEN_DEFAULTS.avoidAmbiguous);
  const classes = [];
  const pools = avoidAmbiguous ? GEN_POOLS : GEN_POOLS_FULL;
  const symbols = avoidAmbiguous ? GEN_SYMBOLS.replace(/[lIO0]/g, '') : GEN_SYMBOLS;
  if (b.upper ?? GEN_DEFAULTS.upper) classes.push(pools.upper);
  if (b.lower ?? GEN_DEFAULTS.lower) classes.push(pools.lower);
  if (b.digits ?? GEN_DEFAULTS.digits) classes.push(pools.digits);
  if (b.symbols ?? GEN_DEFAULTS.symbols) classes.push(symbols);
  if (!classes.length) return res.status(400).json({ error: 'Selecciona al menos un tipo de caracter.' });

  const pool = classes.join('');
  const chars = [];
  // al menos un caracter de cada clase seleccionada
  for (const cls of classes) chars.push(cls[randInt(cls.length)]);
  while (chars.length < length) chars.push(pool[randInt(pool.length)]);
  // barajado Fisher-Yates con aleatoriedad segura
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  res.json({ password: chars.join(''), length: chars.length });
});
