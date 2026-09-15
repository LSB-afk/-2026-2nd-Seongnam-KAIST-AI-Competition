/**
 * Owned, fixed-purpose QR Model 2 encoder: version 6, level L, byte mode, mask 0.
 * Capacity/size: https://www.qrcode.com/en/about/versionPage/versionPage1_10.html
 * Algorithm cross-reference (MIT, not a bundled library):
 * https://github.com/nayuki/QR-Code-generator/blob/master/typescript-javascript/qrcodegen.ts
 * V6-L has two equal blocks of 68 data + 18 Reed–Solomon codewords, and 7 remainder bits.
 * This deliberately omits general version selection, ECI, and mask optimization.
 */
const SIZE = 41;
const DATA_BYTES = 136;

// Polynomial arithmetic over GF(256), primitive polynomial x^8+x^4+x^3+x^2+1.
function multiply(left: number, right: number): number {
  let value = 0;
  while (right > 0) {
    if (right & 1) value ^= left;
    right >>>= 1;
    left <<= 1;
    if (left & 256) left ^= 0x11d;
  }
  return value;
}

function correction(data: number[]): number[] {
  // The degree-18 generator has roots alpha^0 through alpha^17, alpha=2.
  let polynomial = [1];
  let root = 1;
  for (let degree = 0; degree < 18; degree++) {
    const next = new Array<number>(polynomial.length + 1).fill(0);
    polynomial.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= multiply(coefficient, root);
    });
    polynomial = next;
    root = multiply(root, 2);
  }
  const dividend = [...data, ...new Array<number>(18).fill(0)];
  for (let offset = 0; offset < data.length; offset++) {
    const leading = dividend[offset];
    polynomial.forEach((coefficient, index) => {
      dividend[offset + index] ^= multiply(coefficient, leading);
    });
  }
  return dividend.slice(data.length);
}

/** Encode an ASCII URL of 1–134 UTF-8 bytes. Percent-encode non-ASCII URL parts first. */
export function storyQrSvg(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0 || bytes.length > 134) {
    throw new RangeError('QR 공유 링크는 1~134바이트까지 지원합니다.');
  }
  if (Array.from(bytes).some(byte => byte < 32 || byte > 126)) {
    throw new TypeError('QR 공유 링크는 ASCII URL이어야 합니다. 한글 주소는 URL 인코딩해 주세요.');
  }

  const bits: number[] = [];
  const append = (value: number, width: number) => {
    for (let shift = width - 1; shift >= 0; shift--) bits.push((value >>> shift) & 1);
  };
  append(4, 4); // Byte-mode indicator.
  append(bytes.length, 8); // Versions 1–9 use an 8-bit byte count.
  bytes.forEach(byte => append(byte, 8));
  append(0, 4); // Terminator also completes the final data byte for this single segment.
  const data: number[] = [];
  for (let start = 0; start < bits.length; start += 8) {
    data.push(bits.slice(start, start + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; data.length < DATA_BYTES; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);
  const blocks = [data.slice(0, 68), data.slice(68)];
  const parity = blocks.map(correction);
  const codewords: number[] = [];
  for (let index = 0; index < 68; index++) codewords.push(blocks[0][index], blocks[1][index]);
  for (let index = 0; index < 18; index++) codewords.push(parity[0][index], parity[1][index]);

  // -1 means an unreserved data/remainder cell; 0/1 are fixed function cells.
  const grid = Array.from({ length: SIZE }, () => new Array<number>(SIZE).fill(-1));
  const mark = (x: number, y: number, dark: boolean) => { grid[y][x] = Number(dark); };
  for (const [left, top] of [[0, 0], [34, 0], [0, 34]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = left + dx;
        const y = top + dy;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const border = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const center = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        mark(x, y, inside && (border || center));
      }
    }
  }
  for (let index = 8; index <= 32; index++) {
    mark(index, 6, index % 2 === 0);
    mark(6, index, index % 2 === 0);
  }
  for (let y = 32; y <= 36; y++) {
    for (let x = 32; x <= 36; x++) {
      mark(x, y, x === 32 || x === 36 || y === 32 || y === 36 || (x === 34 && y === 34));
    }
  }

  // Standard BCH-protected, XOR-masked format value for level L + mask 0.
  const format = 0x77c4;
  const firstFormat = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  firstFormat.forEach(([x, y], index) => mark(x, y, Boolean((format >>> index) & 1)));
  for (let index = 0; index < 15; index++) {
    const [x, y] = index < 8 ? [40 - index, 8] : [8, 26 + index];
    mark(x, y, Boolean((format >>> index) & 1));
  }
  mark(8, 33, true);

  let cursor = 0;
  let upward = true;
  for (let right = 40; right > 0; right -= 2) {
    if (right === 6) right = 5; // Skip the vertical timing column.
    for (let row = 0; row < SIZE; row++) {
      const y = upward ? SIZE - 1 - row : row;
      for (const x of [right, right - 1]) {
        if (grid[y][x] !== -1) continue;
        const byte = codewords[Math.floor(cursor / 8)] ?? 0;
        const bit = (byte >>> (7 - cursor % 8)) & 1;
        grid[y][x] = bit ^ Number((x + y) % 2 === 0);
        cursor++;
      }
    }
    upward = !upward;
  }
  if (cursor !== 172 * 8 + 7) throw new Error('QR matrix layout mismatch');

  const squares: string[] = [];
  grid.forEach((row, y) => row.forEach((cell, x) => {
    if (cell === 1) squares.push(`M${x + 4} ${y + 4}h1v1h-1z`);
  }));
  // Four-module white quiet zone. Payload is never interpolated into markup.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 49 49" width="294" height="294" role="img" aria-label="공유 링크 QR 코드" shape-rendering="crispEdges"><rect width="49" height="49" fill="white"/><path fill="black" d="${squares.join('')}"/></svg>`;
}
