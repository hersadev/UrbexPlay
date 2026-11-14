/*
 * ZIP mínimo para la copia de seguridad. Guarda sin comprimir (las fotos ya
 * son JPEG) y trabaja con trozos del fichero, de modo que ni al exportar ni al
 * importar hace falta tener todas las fotos a la vez en memoria.
 */

export interface ZipFile {
  name: string;
  data: Blob;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** Nombres en UTF-8. */
const FLAGS = 0x0800;

export async function makeZip(files: ZipFile[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const body: BlobPart[] = [];
  const index: BlobPart[] = [];
  let offset = 0;
  let indexSize = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const size = file.data.size;
    // Se lee cada fichero solo para calcular su suma de control, de uno en uno.
    const crc = crc32(new Uint8Array(await file.data.arrayBuffer()));

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, FLAGS, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    body.push(local.buffer, name, file.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, CENTRAL, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, FLAGS, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    index.push(central.buffer, name);

    offset += 30 + name.length + size;
    indexSize += 46 + name.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, indexSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...body, ...index, end.buffer], { type: 'application/zip' });
}

/** Ficheros del ZIP por su nombre; cada uno se lee solo cuando se pide. */
export async function readZip(file: Blob): Promise<Map<string, () => Promise<Blob>>> {
  const broken = () => new Error('El fichero ZIP está dañado o incompleto.');
  const tailSize = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  let at = tail.byteLength - 22;
  while (at >= 0 && tail.getUint32(at, true) !== END) at--;
  if (at < 0) throw broken();
  const count = tail.getUint16(at + 10, true);
  const indexSize = tail.getUint32(at + 12, true);
  const indexOffset = tail.getUint32(at + 16, true);

  const index = new DataView(await file.slice(indexOffset, indexOffset + indexSize).arrayBuffer());
  const decoder = new TextDecoder();
  const out = new Map<string, () => Promise<Blob>>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > index.byteLength || index.getUint32(p, true) !== CENTRAL) throw broken();
    const method = index.getUint16(p + 10, true);
    const packed = index.getUint32(p + 20, true);
    const nameLength = index.getUint16(p + 28, true);
    const skip = index.getUint16(p + 30, true) + index.getUint16(p + 32, true);
    const local = index.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(index.buffer, p + 46, nameLength));
    p += 46 + nameLength + skip;

    out.set(name, async () => {
      const header = new DataView(await file.slice(local, local + 30).arrayBuffer());
      if (header.byteLength < 30 || header.getUint32(0, true) !== LOCAL) throw broken();
      const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      const raw = file.slice(start, start + packed);
      if (method === 0) return raw;
      // Por si el ZIP se ha vuelto a comprimir con otro programa.
      if (method === 8 && 'DecompressionStream' in window) {
        return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      }
      throw new Error('Este ZIP está comprimido de una forma que la app no sabe leer.');
    });
  }
  return out;
}
