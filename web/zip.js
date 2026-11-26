// Zero-dependency uncompressed ZIP builder (Store mode + CRC32) for folder/multi-file bundles.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32Update(crc, bytes) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export async function buildZipFile(entries, zipName = 'cycles-bundle.zip') {
  // entries: Array<{ path: string, file: File }>
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { path, file } of entries) {
    const nameBytes = enc.encode(path.replace(/^\/+/, ''));
    const data = new Uint8Array(await file.arrayBuffer());
    const crc = crc32Update(0, data);
    const size = data.length;

    // Local file header (30 bytes + name)
    const lfh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lfh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true); // version needed
    ldv.setUint16(6, 0x0800, true); // UTF-8 flag
    ldv.setUint16(8, 0, true); // method 0 = store
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);
    ldv.setUint32(22, size, true);
    ldv.setUint16(26, nameBytes.length, true);
    lfh.set(nameBytes, 30);

    parts.push(lfh, data);

    // Central directory header (46 bytes + name)
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cdh.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);

    central.push(cdh);
    offset += lfh.length + size;
  }

  let centralSize = 0;
  for (const c of central) {
    parts.push(c);
    centralSize += c.length;
  }

  // End of central directory (22 bytes)
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  parts.push(eocd);

  return new File(parts, zipName, { type: 'application/zip' });
}
