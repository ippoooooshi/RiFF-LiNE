/**
 * 依存なしの同期 SHA-256（data-model-persistence.md §3.2 `ChecksumUtil`）。
 *
 * なぜ自前実装か：`computeChecksum(): string` は同期シグネチャで確定しており（00_reference.md §3.2）、
 * かつ Webコアはレンダラー（sandbox + contextIsolation）で動くため `node:crypto` を使えず、
 * `crypto.subtle` は非同期。整合性検証（改ざん・破損検知。暗号用途ではない）に足る決定的ハッシュを
 * 同期で得るために、公開されている標準アルゴリズムをそのまま実装する。
 *
 * 出典：FIPS 180-4。実装は広く知られた定数・手続きのみで、外部コードのコピーではない。
 */

// 最初の 64 個の素数の立方根の小数部（先頭 32bit）。
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** 右回転（32bit）。 */
function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * バイト列の SHA-256 を小文字 16 進文字列（64 桁）で返す。
 * @param bytes 入力バイト列。
 */
export function sha256Hex(bytes: Uint8Array): string {
  // --- 前処理：0x80 パディング + 64bit ビット長（ビッグエンディアン） ---
  const bitLen = bytes.length * 8;
  const withPadLen = ((bytes.length + 8) >> 6) + 1; // 64 バイトブロック数
  const buffer = new Uint8Array(withPadLen * 64);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  // ビット長は下位 53bit のみ書く（JS の安全整数の範囲。実運用のファイルサイズで十分）。
  const view = new DataView(buffer.buffer);
  view.setUint32(buffer.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(buffer.length - 4, bitLen >>> 0);

  // --- 初期ハッシュ値（最初の 8 個の素数の平方根の小数部） ---
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  // --- 各 512bit ブロックを処理 ---
  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, '0')).join('');
}
