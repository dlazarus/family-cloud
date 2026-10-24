import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let db;

export function initDb(dataDir) {
  const dbPath = path.join(dataDir, 'family-cloud.db');
  const legacy = path.join(dataDir, 'calendar.db');
  // Migracion unica: renombrar la base heredada de family-calendar
  if (!fs.existsSync(dbPath) && fs.existsSync(legacy)) {
    fs.renameSync(legacy, dbPath);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(legacy + suffix)) fs.renameSync(legacy + suffix, dbPath + suffix);
    }
    console.log('[i] Base de datos renombrada: calendar.db -> family-cloud.db');
  }
  db = new DatabaseSync(dbPath);
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

    -- Arbol de archivos de cada usuario. La estructura (carpetas, nombres) vive AQUI;
    -- en el disco solo hay blobs con nombre opaco (blob_rel). Los nombres se guardan
    -- cifrados como el resto de datos personales.
    --   scope 'private' -> arbol privado del usuario (parent_id NULL = raiz)
    --   scope 'shared'  -> CARPETA-COMPARTIDA: una unica raiz por usuario, visible
    --                      en lectura para el resto de usuarios. Su nombre no se
    --                      guarda por fila: es el valor global app_settings.shared_folder_name
    --                      (lo cambia solo el administrador), asi no puede quedar
    --                      inconsistente entre cuentas.
    CREATE TABLE IF NOT EXISTS fs_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES fs_nodes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('folder','file')),
      scope TEXT NOT NULL DEFAULT 'private' CHECK (scope IN ('private','shared')),
      name_enc TEXT,                   -- AES-256-GCM; NULL solo en la raiz compartida
      size_bytes INTEGER,              -- tamano EN CLARO (para mostrar y cupos)
      mime TEXT,                       -- pista de tipo (iconos); en claro
      blob_rel TEXT,                   -- ruta opaca relativa a FILES_DIR (solo ciphertext)
      blob_iv TEXT,                    -- base64
      blob_tag TEXT,                   -- base64 (AES-GCM)
      enc_ver TEXT NOT NULL DEFAULT 'master',  -- como en el vault: 'master' hoy, 'user' manana
      kdf_salt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fs_user ON fs_nodes(user_id);
    CREATE INDEX IF NOT EXISTS idx_fs_parent ON fs_nodes(parent_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fs_shared_root
      ON fs_nodes(user_id) WHERE scope = 'shared' AND parent_id IS NULL;

    -- Ajustes globales editables desde Administracion (cupo por defecto, nombre de
    -- la carpeta compartida). Permiten cambiar valores sin tocar el .env.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrateColumns();
  seedSettings();
  return db;
}

// --- migraciones aditivas idempotentes (SQLite no puede usar IF NOT EXISTS en ALTER) ---
function migrateColumns() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('quota_mb')) {
    // NULL = hereda el cupo global; 0 = sin limite
    db.exec('ALTER TABLE users ADD COLUMN quota_mb INTEGER');
    console.log('[i] users.quota_mb anadido (cupo de archivos por cuenta)');
  }
  const evCols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  if (!evCols.includes('start_time')) {
    // horas opcionales 'HH:MM' (en claro: no son datos sensibles y sirven para ordenar)
    db.exec('ALTER TABLE events ADD COLUMN start_time TEXT');
    console.log('[i] events.start_time anadido');
  }
  if (!evCols.includes('end_time')) {
    db.exec('ALTER TABLE events ADD COLUMN end_time TEXT');
    console.log('[i] events.end_time anadido');
  }
}

function seedSettings() {
  const defaults = {
    file_quota_mb: String(Math.max(0, Number(process.env.FILE_QUOTA_MB ?? 4096) || 4096)),
    shared_folder_name: process.env.SHARED_FOLDER_NAME || 'CARPETA-COMPARTIDA',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) ins.run(k, String(v));
}

// --- ajustes globales ---
export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  const info = db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, String(value));
  return info.changes;
}

export function getDb() {
  return db;
}
