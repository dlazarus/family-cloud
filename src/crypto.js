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

// ---- Capa de cifrado del vault (gestor de contraseñas) ----
// Unica puerta de cifrado/descifrado de las entradas del vault. Hoy (opcion A)
// delega en la clave maestra; si se activa la opcion B (clave derivada de la
// contraseña de cada usuario), solo cambia el interior de estas dos funciones:
// enc_ver indica con que clave estaba cifrada cada fila y kdf_salt guarda el salt
// por usuario. Las filas 'master' se recifran con scripts/reencrypt-vault.js.
export function encryptForUser(user, plain) {
  return encryptField(plain);
}

export function decryptForUser(user, blob, encVer = 'master') {
  if (encVer !== 'master') {
    throw new Error(`Version de cifrado de vault no soportada: ${encVer}`);
  }
  return decryptField(blob);
}
