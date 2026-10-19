import { Router } from 'express';
import { getDb } from './db.js';
import { requireAuth } from './auth.js';
import { encryptField, decryptField } from './crypto.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ['cumple', 'comida', 'viaje', 'tarea', 'salud', 'otro'];

function toPublic(row) {
  return {
    id: row.id,
    date: row.date,
    end_date: row.end_date,
    category: row.category,
    title: decryptField(row.title_enc),
    description: decryptField(row.description_enc),
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateBody(body) {
  const b = body || {};
  if (!DATE_RE.test(String(b.date || ''))) return { error: 'Fecha no válida (formato YYYY-MM-DD).' };
  if (b.end_date && !DATE_RE.test(String(b.end_date))) return { error: 'Fecha de fin no válida.' };
  if (b.end_date && b.end_date < b.date) return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
  const title = String(b.title || '').trim();
  if (!title || title.length > 120) return { error: 'El título es obligatorio (máx. 120 caracteres).' };
  const description = String(b.description || '').trim();
  if (description.length > 2000) return { error: 'La descripción es demasiado larga (máx. 2000).' };
  const category = CATEGORIES.includes(b.category) ? b.category : 'otro';
  return { value: { date: b.date, end_date: b.end_date || null, title, description, category } };
}

// Lista de eventos en un rango (fechas en claro para filtrar; contenido se descifra al vuelo)
eventsRouter.get('/', (req, res) => {
  const { from, to } = req.query;
  const rows = from && to && DATE_RE.test(from) && DATE_RE.test(to)
    ? getDb().prepare('SELECT * FROM events WHERE date BETWEEN ? AND ? ORDER BY date, id').all(from, to)
    : getDb().prepare('SELECT * FROM events ORDER BY date, id').all();
  res.json(rows.map(toPublic));
});

eventsRouter.post('/', (req, res) => {
  const v = validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { date, end_date, title, description, category } = v.value;
  const info = getDb()
    .prepare(`INSERT INTO events (date, end_date, category, title_enc, description_enc, created_by, updated_by)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(date, end_date, category, encryptField(title), encryptField(description), req.session.user.id, req.session.user.id);
  const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json(toPublic(row));
});

eventsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Evento no encontrado' });
  const v = validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { date, end_date, title, description, category } = v.value;
  getDb()
    .prepare(`UPDATE events SET date = ?, end_date = ?, category = ?, title_enc = ?, description_enc = ?,
              updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(date, end_date, category, encryptField(title), encryptField(description), req.session.user.id, id);
  res.json(toPublic(getDb().prepare('SELECT * FROM events WHERE id = ?').get(id)));
});

eventsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = getDb().prepare('DELETE FROM events WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json({ ok: true });
});
