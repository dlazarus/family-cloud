// Cifrado en reposo campo a campo: AES-256-GCM
// Formato almacenado: base64(iv):base64(tag):base64(ciphertext)
import crypto from 'node:crypto';

let key = null;

export function initCrypto() {
  const pass = process.env.MASTER_PASSPHRASE;
  const salt = process.env.MASTER_SALT;
  if (!pass || !salt) {
    throw new Error('Faltan MASTER_PASSPHRASE / MASTER_SALT en el archivo .env');
  }
  key = crypto.scryptSync(pass, Buffer.from(salt, 'hex'), 32);
}

export function encryptField(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain ?? ''), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join(':');
}

export function decryptField(blob) {
  const [ivB, tagB, ctB] = String(blob).split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  d.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]).toString('utf8');
}
