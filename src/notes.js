import { Router } from 'express';
import { getDb } from './db.js';
import { requireAuth } from './auth.js';
import { encryptField, decryptField } from './crypto.js';

export const notesRouter = Router();
notesRouter.use(requireAuth);

// Paleta fija del corcho (en claro en la BD; el CSS define los mismos nombres).
const NOTE_COLORS = ['amarillo', 'rosa', 'azul', 'verde', 'naranja', 'lavanda'];
const MAX_LEN = 500;

function toPublic(row) {
  return {
    id: row.id,
    text: decryptField(row.text_enc),
    color: NOTE_COLORS.includes(row.color) ? row.color : 'amarillo',
    author: row.author ?? null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// seleccion con el nombre de quien creo la nota (la firma del corcho)
const SEL = `SELECT n.*, au.username AS author FROM notes n
             LEFT JOIN users au ON au.id = n.created_by`;

// solo quien creo la nota puede editarla/borrarla; los admin pueden con cualquiera
function ownedBy(row, user) {
  return user.role === 'admin' || row.created_by == null || row.created_by === user.id;
}

function validateBody(body) {
  const b = body || {};
  const text = String(b.text || '').trim();
  if (!text) return { error: 'La nota no puede quedar vacia.' };
  if (text.length > MAX_LEN) return { error: `La nota es demasiado larga (max. ${MAX_LEN} caracteres).` };
  // sin color elegido -> color al azar (el corcho queda mas variado)
  const color = NOTE_COLORS.includes(b.color)
    ? b.color
    : NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
  return { value: { text, color } };
}

// El corcho es unico y familiar: todos ven todas las notas.
notesRouter.get('/', (_req, res) => {
  const rows = getDb().prepare(`${SEL} ORDER BY n.id DESC`).all();
  res.json(rows.map(toPublic));
});

notesRouter.post('/', (req, res) => {
  const v = validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const info = getDb()
    .prepare(`INSERT INTO notes (text_enc, color, created_by, updated_by) VALUES (?, ?, ?, ?)`)
    .run(encryptField(v.value.text), v.value.color, req.session.user.id, req.session.user.id);
  const row = getDb().prepare(`${SEL} WHERE n.id = ?`).get(Number(info.lastInsertRowid));
  res.status(201).json(toPublic(row));
});

notesRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Nota no encontrada' });
  if (!ownedBy(row, req.session.user)) return res.status(403).json({ error: 'Solo quien escribio esta nota puede editarla.' });
  const v = validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  getDb()
    .prepare(`UPDATE notes SET text_enc = ?, color = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(encryptField(v.value.text), v.value.color, req.session.user.id, id);
  res.json(toPublic(getDb().prepare(`${SEL} WHERE n.id = ?`).get(id)));
});

notesRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Nota no encontrada' });
  if (!ownedBy(row, req.session.user)) return res.status(403).json({ error: 'Solo quien escribio esta nota puede borrarla.' });
  const info = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Nota no encontrada' });
  res.json({ ok: true });
});
