import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDb } from './db.js';
import { initCrypto } from './crypto.js';
import { resolveDirs, ensureDirs, describeStorage, storageStatus } from './storage.js';
import { authRouter, statusRouter } from './auth.js';
import { usersRouter } from './users.js';
import { eventsRouter } from './events.js';
import { vaultRouter } from './vault.js';
import { filesRouter } from './files.js';
import { notesRouter } from './notes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// version del servicio (la mismo del package.json): la ensena common.js
// en una esquinita de todas las paginas, via GET /api/version
let VERSION = 'dev';
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || VERSION;
} catch { /* paquete raro: seguimos con 'dev' */ }

// Cargar .env (passphrase maestra, puerto, etc.)
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  console.error('[!] No se encontró .env — cópialo de .env.example y genera claves.');
  process.exit(1);
}

initCrypto();
// Rutas de datos configurables (DATA_DIR para la base, FILES_DIR para los blobs
// cifrados de archivos). Preparar el disco (formatearlo, montarlo, dar espacio) es
// tarea del sysadmin: aqui solo se usa la ruta indicada.
const { dataDir } = resolveDirs(ROOT);
const dirWarning = ensureDirs();
if (dirWarning) console.log(`[!] Almacenamiento de archivos: ${dirWarning}`);
initDb(dataDir);
console.log(`[i] ${describeStorage()}`);
const bootStorage = storageStatus();
if (bootStorage.ok && !bootStorage.posix_perms) {
  console.log('[i] FILES_DIR esta en un sistema sin permisos POSIX (NTFS/vfat): la propiedad se fija en el montaje (uid=...); el aislamiento entre usuarios lo sigue dando la base de datos.');
}

const app = express();
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        // desactivado a propósito: servimos solo HTTP en la LAN
        upgradeInsecureRequests: null,
      },
    },
  })
);

app.use(express.json({ limit: '64kb' }));

app.use(
  session({
    name: 'familycloud.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // HTTP en LAN; cambiar a true si se activa HTTPS
      maxAge: 14 * 24 * 3600 * 1000, // 14 dias
    },
  })
);

// Rutas públicas
app.use('/api', statusRouter);
app.use('/api', authRouter);
// version del servicio, publica: la pinta common.js en un rincon de cada pagina
app.get('/api/version', (_req, res) => res.json({ version: VERSION }));

// Rutas protegidas
app.use('/api/events', eventsRouter);
app.use('/api/users', usersRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/files', filesRouter);
app.use('/api/notes', notesRouter);

// Frontend estático (sin CDN: servido desde aquí)
app.use(express.static(path.join(ROOT, 'public')));

// Páginas de la aplicación
app.get('/calendario', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'calendar.html'));
});
app.get('/contrasenhas', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'passwords.html'));
});
app.get('/administracion', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});
app.get('/archivos', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'files.html'));
});
app.get('/notas', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'notes.html'));
});
app.get('/mi-cuenta', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'account.html'));
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Family Cloud en http://${HOST}:${PORT}`);
});
