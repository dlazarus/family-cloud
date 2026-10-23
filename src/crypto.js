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
    throw new Error(`Version de cifrado de vault/archivos no soportada: ${encVer}`);
  }
  return decryptField(blob);
}

// ---- Capa de cifrado de ARCHIVOS (streaming, para ficheros de cualquier tamano) ----
// El blob en disco contiene SOLO el ciphertext; el IV y la etiqueta de autenticacion
// viven en la base de datos (columnas blob_iv / blob_tag). El AAD incluye el id del
// nodo, de modo que un blob no puede sustituir al de otro nodo ni a otro usuario.
// AAD con el id exige conocer el id ANTES de cifrar: por eso files.js inserta primero
// la fila y despues escribe el blob (si la subida falla, se revierte la fila).
const FILE_AAD = (id) => Buffer.from(`familycloud-fs:${id}`, 'utf8');

export function newFileCipher(nodeId) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(FILE_AAD(nodeId));
  return { cipher: c, iv };
}

export function newFileDecipher(node) {
  if (node.enc_ver !== 'master') {
    throw new Error(`Version de cifrado de archivos no soportada: ${node.enc_ver}`);
  }
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(node.blob_iv, 'base64'));
  d.setAAD(FILE_AAD(node.id));
  d.setAuthTag(Buffer.from(node.blob_tag, 'base64'));
  return d;
}
