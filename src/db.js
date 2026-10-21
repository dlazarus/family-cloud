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
    CREATE TABLE IF NOT EXISTS vault_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      site_enc TEXT NOT NULL,            -- AES-256-GCM (cifrado campo a campo)
      login_enc TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      enc_ver TEXT NOT NULL DEFAULT 'master',  -- 'master' = clave maestra (opcion A); 'user' = clave por usuario (opcion B futura)
      kdf_salt TEXT,                     -- NULL en opcion A; salt por usuario en la B
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vault_user ON vault_entries(user_id);
  `);
  return db;
}

export function getDb() {
  return db;
}
