/**
 * Keccak-256, pure TypeScript.
 *
 * Ethereum uses the original Keccak submission, NOT the finalised NIST SHA-3.
 * They differ only in the domain-separation byte, 0x01 here versus 0x06 for
 * SHA3-256, but that produces a completely different digest. `node:crypto`
 * ships sha3-256 and no keccak, so this exists to keep the verifier's zero
 * dependency guarantee, which is the product claim.
 */

const RATE_BYTES = 136;   // 1088 bits for Keccak-256
const OUT_BYTES = 32;

/** Round constants for Keccak-f[1600], as [low, high] 32-bit halves. */
const RC: readonly [number, number][] = [
  [0x00000001, 0x00000000], [0x00008082, 0x00000000], [0x0000808a, 0x80000000],
  [0x80008000, 0x80000000], [0x0000808b, 0x00000000], [0x80000001, 0x00000000],
  [0x80008081, 0x80000000], [0x00008009, 0x80000000], [0x0000008a, 0x00000000],
  [0x00000088, 0x00000000], [0x80008009, 0x00000000], [0x8000000a, 0x00000000],
  [0x8000808b, 0x00000000], [0x0000008b, 0x80000000], [0x00008089, 0x80000000],
  [0x00008003, 0x80000000], [0x00008002, 0x80000000], [0x00000080, 0x80000000],
  [0x0000800a, 0x00000000], [0x8000000a, 0x80000000], [0x80008081, 0x80000000],
  [0x00008080, 0x80000000], [0x80000001, 0x00000000], [0x80008008, 0x80000000],
];

const ROT = [
   0,  1, 62, 28, 27, 36, 44,  6, 55, 20,  3, 10, 43,
  25, 39, 41, 45, 15, 21,  8, 18,  2, 61, 56, 14,
];

/** State is 25 lanes of 64 bits, held as [lo, hi] pairs in a flat Int32Array. */
function keccakF(s: Int32Array): void {
  const C = new Int32Array(10);
  const D = new Int32Array(10);
  const B = new Int32Array(50);

  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++) {
      C[x * 2] = s[x * 2]! ^ s[(x + 5) * 2]! ^ s[(x + 10) * 2]! ^ s[(x + 15) * 2]! ^ s[(x + 20) * 2]!;
      C[x * 2 + 1] = s[x * 2 + 1]! ^ s[(x + 5) * 2 + 1]! ^ s[(x + 10) * 2 + 1]! ^ s[(x + 15) * 2 + 1]! ^ s[(x + 20) * 2 + 1]!;
    }
    for (let x = 0; x < 5; x++) {
      const nx = ((x + 1) % 5) * 2;
      const px = ((x + 4) % 5) * 2;
      // D[x] = C[x-1] ^ rotl64(C[x+1], 1)
      D[x * 2] = C[px]! ^ (((C[nx]! << 1) | (C[nx + 1]! >>> 31)) | 0);
      D[x * 2 + 1] = C[px + 1]! ^ (((C[nx + 1]! << 1) | (C[nx]! >>> 31)) | 0);
    }
    for (let i = 0; i < 25; i++) {
      s[i * 2] = s[i * 2]! ^ D[(i % 5) * 2]!;
      s[i * 2 + 1] = s[i * 2 + 1]! ^ D[(i % 5) * 2 + 1]!;
    }

    // rho and pi.  Lane index is i = x + 5y.
    // Spec: B[y, (2x+3y) mod 5] = rot(A[x,y], r[x,y])
    for (let i = 0; i < 25; i++) {
      const x = i % 5;
      const y = (i - x) / 5;
      const dest = y + 5 * ((2 * x + 3 * y) % 5);
      const r = ROT[i]!;
      const lo = s[i * 2]!;
      const hi = s[i * 2 + 1]!;
      let nlo: number, nhi: number;
      if (r === 0) { nlo = lo; nhi = hi; }
      else if (r < 32) {
        nlo = ((lo << r) | (hi >>> (32 - r))) | 0;
        nhi = ((hi << r) | (lo >>> (32 - r))) | 0;
      } else if (r === 32) { nlo = hi; nhi = lo; }
      else {
        const k = r - 32;
        nlo = ((hi << k) | (lo >>> (32 - k))) | 0;
        nhi = ((lo << k) | (hi >>> (32 - k))) | 0;
      }
      B[dest * 2] = nlo;
      B[dest * 2 + 1] = nhi;
    }

    // chi.  A[x,y] = B[x,y] xor ((not B[x+1,y]) and B[x+2,y])
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const i = x + 5 * y;
        const n1 = ((x + 1) % 5) + 5 * y;
        const n2 = ((x + 2) % 5) + 5 * y;
        s[i * 2] = B[i * 2]! ^ (~B[n1 * 2]! & B[n2 * 2]!);
        s[i * 2 + 1] = B[i * 2 + 1]! ^ (~B[n1 * 2 + 1]! & B[n2 * 2 + 1]!);
      }
    }

    // iota
    s[0] = s[0]! ^ RC[round]![0];
    s[1] = s[1]! ^ RC[round]![1];
  }
}

export function keccak256(input: Buffer | Uint8Array | string): Buffer {
  const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  const state = new Int32Array(50);

  // absorb
  const padded = Buffer.alloc(Math.ceil((data.length + 1) / RATE_BYTES) * RATE_BYTES);
  data.copy(padded);
  padded[data.length] = 0x01;                       // Keccak padding, NOT 0x06
  padded[padded.length - 1] = (padded[padded.length - 1]! | 0x80);

  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let i = 0; i < RATE_BYTES / 8; i++) {
      state[i * 2] = state[i * 2]! ^ padded.readInt32LE(offset + i * 8);
      state[i * 2 + 1] = state[i * 2 + 1]! ^ padded.readInt32LE(offset + i * 8 + 4);
    }
    keccakF(state);
  }

  // squeeze
  const out = Buffer.alloc(OUT_BYTES);
  for (let i = 0; i < OUT_BYTES / 8; i++) {
    out.writeInt32LE(state[i * 2]!, i * 8);
    out.writeInt32LE(state[i * 2 + 1]!, i * 8 + 4);
  }
  return out;
}

export const keccak256Hex = (input: Buffer | Uint8Array | string): string =>
  `0x${keccak256(input).toString('hex')}`;
