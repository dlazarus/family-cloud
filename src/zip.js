// Escritor ZIP minimo, sin dependencias externas (coherente con la filosofia del
// proyecto: nada de librerias nativas).
//
// Es secuencial y de un solo paso: no necesita volver atras sobre el stream, porque
// usa el "data descriptor" (bit 3 del flag de proposito general) para escribir el CRC
// y los tamanos DESPUES de los datos. Lo leen sin problema Windows, macOS, Android,
// unzip/7zip.
//
// Los contenidos se alimentan ya DESCIFRADOS (streams de src/crypto.js), asi que la
// memoria usada no depende del tamano del archivo.
'use strict';

// --- CRC32 (tabla de 256 entradas, sin dependencias) ---
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32Update(crc, buf) {
  let c = ~crc;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c;
}

// --- fechas en formato DOS ---
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

const LFH_SIG = 0x04034b50; // local file header
const DD_SIG = 0x08074b50; // data descriptor
const CDH_SIG = 0x02014b50; // central directory header
const EOCD_SIG = 0x06054b50; // end of central directory

class ZipWriter {
  // writable: stream de destino (p. ej. la respuesta HTTP). deflate = comprimido DEFLATE
  constructor(writable, { deflate = true, level = 6 } = {}) {
    this.out = writable;
    this.deflate = deflate;
    this.level = level;
    this.offset = 0;
    this.entries = [];
    this.ended = false;
  }

  async write(buf) {
    if (!this.out.write(buf)) {
      await new Promise((resolve) => this.out.once('drain', resolve));
    }
    this.offset += buf.length;
  }

  // nombre de entrada: con '/' final si es carpeta
  async add({ name, isDir = false, mtime, source = null, size = null }) {
    if (this.ended) throw new Error('ZipWriter ya cerrado');
    const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
    const entryName = isDir && !clean.endsWith('/') ? `${clean}/` : clean;
    const nameBuf = Buffer.from(entryName, 'utf8');
    const { time, date } = dosDateTime(mtime ? new Date(mtime) : new Date());
    const flags = 0x0800 | 0x8000; // data descriptor + nombres UTF-8
    const method = isDir || !this.deflate ? 0 : 8;

    // cabecera local: tamanos y CRC a cero (van en el data descriptor)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(LFH_SIG, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(0, 14); // crc
    lfh.writeUInt32LE(0, 18); // compressed size
    lfh.writeUInt32LE(0, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    const localOffset = this.offset;
    await this.write(Buffer.concat([lfh, nameBuf]));

    let crc = 0;
    let compSize = 0;
    let rawSize = 0;

    if (!isDir && source) {
      // Contadores en medio del stream: el CRC y el tamano original son del contenido
      // SIN comprimir (como exige el formato ZIP); nunca se acumula el fichero en memoria.
      const { Transform } = await import('node:stream');
      const zlib = await import('node:zlib');
      const rawCounter = new Transform({
        transform(chunk, _enc, cb) {
          crc = crc32Update(crc, chunk);
          rawSize += chunk.length;
          cb(null, chunk);
        },
      });
      const stages = [source, rawCounter];
      if (this.deflate) {
        const deflater = zlib.createDeflateRaw({ level: this.level });
        deflater.on('data', (b) => (compSize += b.length));
        stages.push(deflater);
      } else {
        rawCounter.on('data', (b) => (compSize += b.length));
      }
      for (let i = 0; i < stages.length - 1; i++) stages[i].pipe(stages[i + 1]);
      for await (const b of stages[stages.length - 1]) await this.write(b);
      if (!this.deflate) compSize = rawSize;
    }

    // data descriptor
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(DD_SIG, 0);
    dd.writeUInt32LE(crc >>> 0, 4);
    dd.writeUInt32LE(compSize >>> 0, 8);
    dd.writeUInt32LE(rawSize >>> 0, 12);
    await this.write(dd);

    this.entries.push({ nameBuf, flags, method, time, date, crc: crc >>> 0, compSize, rawSize, localOffset, isDir });
    return { compSize, rawSize };
  }

  async end() {
    if (this.ended) return;
    const cdStart = this.offset;
    for (const e of this.entries) {
      const cdh = Buffer.alloc(46);
      cdh.writeUInt32LE(CDH_SIG, 0);
      cdh.writeUInt16LE(20, 4); // version made by
      cdh.writeUInt16LE(20, 6); // version needed
      cdh.writeUInt16LE(e.flags, 8);
      cdh.writeUInt16LE(e.method, 10);
      cdh.writeUInt16LE(e.time, 12);
      cdh.writeUInt16LE(e.date, 14);
      cdh.writeUInt32LE(e.crc, 16);
      cdh.writeUInt32LE(e.compSize, 20);
      cdh.writeUInt32LE(e.rawSize, 24);
      cdh.writeUInt16LE(e.nameBuf.length, 28);
      cdh.writeUInt16LE(0, 30); // extra
      cdh.writeUInt16LE(0, 32); // comment
      cdh.writeUInt16LE(0, 34); // disk
      cdh.writeUInt16LE(0, 36); // internal attrs
      const ext = e.isDir ? 0x10 : 0; // atributo de directorio
      cdh.writeUInt32LE(ext, 38);
      cdh.writeUInt32LE(e.localOffset, 42);
      await this.write(Buffer.concat([cdh, e.nameBuf]));
    }
    const cdSize = this.offset - cdStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    await this.write(eocd);
    this.ended = true;
  }
}

export { ZipWriter };
