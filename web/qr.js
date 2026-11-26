// Minimal, zero-dependency QR Code generator (Byte mode, EC Level L)
// Supports versions 1..22 (up to ~1000 bytes) for offline SDP/URL pairing.

const QR = (() => {
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const res = new Uint8Array(data.length + ecLen);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const coef = res[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          res[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return res.slice(data.length);
  }

  // [totalDataBytes, ecBytesPerBlock, numBlocksGroup1, dataBytesGroup1, numBlocksGroup2, dataBytesGroup2]
  // Error Correction Level L for versions 1..22
  const VERSIONS = [
    null,
    [19, 7, 1, 19, 0, 0],
    [34, 10, 1, 34, 0, 0],
    [55, 15, 1, 55, 0, 0],
    [80, 20, 1, 80, 0, 0],
    [108, 26, 1, 108, 0, 0],
    [136, 18, 2, 68, 0, 0],
    [156, 20, 2, 78, 0, 0],
    [194, 24, 2, 97, 0, 0],
    [232, 30, 2, 116, 0, 0],
    [274, 18, 2, 68, 2, 69],
    [324, 20, 4, 81, 0, 0],
    [370, 24, 2, 92, 2, 93],
    [428, 26, 4, 107, 0, 0],
    [461, 30, 3, 115, 1, 116],
    [523, 22, 5, 87, 1, 88],
    [589, 24, 5, 98, 1, 99],
    [647, 28, 1, 107, 5, 108],
    [721, 30, 5, 120, 1, 121],
    [795, 28, 3, 113, 4, 114],
    [861, 28, 3, 107, 5, 108],
    [932, 28, 4, 116, 4, 117],
    [1006, 28, 2, 111, 7, 112],
  ];

  const ALIGN_POS = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
    [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
    [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
  ];

  function encodeData(bytes) {
    let version = -1;
    for (let v = 1; v < VERSIONS.length; v++) {
      const cap = VERSIONS[v][0];
      const headerBytes = v < 10 ? 2 : 3;
      if (bytes.length + headerBytes <= cap) {
        version = v;
        break;
      }
    }
    if (version === -1) throw new Error('Payload too large for QR code');

    const [totalData, ecPerBlock, b1, d1, b2, d2] = VERSIONS[version];
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    pushBits(0b0100, 4); // Byte mode
    pushBits(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) pushBits(b, 8);

    const maxBits = totalData * 8;
    for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (bits.length < maxBits) {
      pushBits(padBytes[padIdx % 2], 8);
      padIdx++;
    }

    const dataBytes = new Uint8Array(totalData);
    for (let i = 0; i < totalData; i++) {
      let val = 0;
      for (let b = 0; b < 8; b++) val = (val << 1) | bits[i * 8 + b];
      dataBytes[i] = val;
    }

    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (let i = 0; i < b1; i++) {
      const slice = dataBytes.slice(offset, offset + d1);
      dataBlocks.push(slice);
      ecBlocks.push(rsEncode(slice, ecPerBlock));
      offset += d1;
    }
    for (let i = 0; i < b2; i++) {
      const slice = dataBytes.slice(offset, offset + d2);
      dataBlocks.push(slice);
      ecBlocks.push(rsEncode(slice, ecPerBlock));
      offset += d2;
    }

    const interleaved = [];
    const maxD = Math.max(d1, d2);
    for (let i = 0; i < maxD; i++) {
      for (const blk of dataBlocks) if (i < blk.length) interleaved.push(blk[i]);
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (const blk of ecBlocks) interleaved.push(blk[i]);
    }

    return { version, codewords: interleaved };
  }

  function buildMatrix(version, codewords) {
    const size = version * 4 + 17;
    const grid = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setMod = (r, c, val, fn = true) => {
      if (r < 0 || r >= size || c < 0 || c >= size) return;
      grid[r][c] = val ? 1 : 0;
      if (fn) isFunc[r][c] = 1;
    };

    const drawFinder = (r, c) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setMod(rr, cc, inOuter && (onBorder || inInner));
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Alignment patterns
    const aligns = ALIGN_POS[version];
    for (const r of aligns) {
      for (const c of aligns) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const onEdge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const center = dr === 0 && dc === 0;
            setMod(r + dr, c + dc, onEdge || center);
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      setMod(6, i, i % 2 === 0);
      setMod(i, 6, i % 2 === 0);
    }

    // Dark module & reserve format/version areas
    setMod(size - 8, 8, 1);
    for (let i = 0; i < 9; i++) {
      if (!isFunc[8][i]) isFunc[8][i] = 1;
      if (!isFunc[i][8]) isFunc[i][8] = 1;
    }
    for (let i = 0; i < 8; i++) {
      isFunc[8][size - 1 - i] = 1;
      isFunc[size - 1 - i][8] = 1;
    }
    if (version >= 7) {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          isFunc[i][size - 11 + j] = 1;
          isFunc[size - 11 + j][i] = 1;
        }
      }
    }

    // Place data bits
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let up = true;
    for (let col = size - 1; col >= 1; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < size; i++) {
        const r = up ? size - 1 - i : i;
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (!isFunc[r][c]) {
            let bit = 0;
            if (bitIdx < totalBits) {
              bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            // Mask 0: (r + c) % 2 === 0
            if ((r + c) % 2 === 0) bit ^= 1;
            grid[r][c] = bit;
          }
        }
      }
      up = !up;
    }

    // Format info for EC Level L (01) + Mask 0 (000) => 01000 => BCH = 0x77c4
    const fmt = 0x77c4;
    for (let i = 0; i < 15; i++) {
      const bit = (fmt >> i) & 1;
      if (i < 6) grid[i][8] = bit;
      else if (i < 8) grid[i + 1][8] = bit;
      else grid[size - 15 + i][8] = bit;

      if (i < 8) grid[8][size - 1 - i] = bit;
      else if (i < 9) grid[8][15 - i] = bit;
      else grid[8][15 - i - 1] = bit;
    }

    // Version info if >= 7
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
      const verBits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = (verBits >> i) & 1;
        const r = Math.floor(i / 3);
        const c = size - 11 + (i % 3);
        grid[r][c] = bit;
        grid[c][r] = bit;
      }
    }

    return grid;
  }

  function toSvg(text, px = 220) {
    const bytes = new TextEncoder().encode(text);
    const { version, codewords } = encodeData(bytes);
    const grid = buildMatrix(version, codewords);
    const n = grid.length;
    const pad = 2;
    const total = n + pad * 2;
    let paths = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (grid[r][c] === 1) {
          paths += `M${c + pad},${r + pad}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${paths}" fill="#0f1115"/></svg>`;
  }

  return { toSvg };
})();
