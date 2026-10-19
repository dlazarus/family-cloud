import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

let db;

export function initDb(dataDir) {
  db = new DatabaseSync(path.join(dataDir, 'calendar.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,              -- YYYY-MM-DD (en claro, indexable)
      end_date TEXT,                   -- YYYY-MM-DD opcional
      category TEXT NOT NULL DEFAULT 'otro',
      title_enc TEXT NOT NULL,         -- AES-256-GCM
      description_enc TEXT NOT NULL,   -- AES-256-GCM
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
  `);
  return db;
}

export function getDb() {
  return db;
}
