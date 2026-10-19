import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDb } from './db.js';
import { initCrypto } from './crypto.js';
import { authRouter, statusRouter } from './auth.js';
import { usersRouter } from './users.js';
import { eventsRouter } from './events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Cargar .env (passphrase maestra, puerto, etc.)
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  console.error('[!] No se encontró .env — cópialo de .env.example y genera claves.');
  process.exit(1);
}

initCrypto();
initDb(path.join(ROOT, 'data'));

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
    name: 'familycal.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // HTTP en LAN; cambiar a true si se activa HTTPS
      maxAge: 30 * 24 * 3600 * 1000, // 30 días
    },
  })
);

// Rutas públicas
app.use('/api', statusRouter);
app.use('/api', authRouter);

// Rutas protegidas
app.use('/api/events', eventsRouter);
app.use('/api/users', usersRouter);

// Frontend estático (sin CDN: todo servido desde aquí)
app.use(express.static(path.join(ROOT, 'public')));

// SPA: cualquier ruta desconocida -> index.html
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Calendario familiar en http://${HOST}:${PORT}`);
});
