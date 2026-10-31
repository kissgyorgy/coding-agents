const MASK = (1n << 64n) - 1n;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;

function rotate(value: bigint, bits: bigint): bigint {
  value &= MASK;
  return ((value << bits) | (value >> (64n - bits))) & MASK;
}

function round(accumulator: bigint, value: bigint): bigint {
  return (rotate(accumulator + value * P2, 31n) * P1) & MASK;
}

// XXH64, with unsigned 64-bit arithmetic matching OMP's Bun.hash.xxHash64.
export function xxhash64(bytes: Uint8Array, seed = 0n): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.length;
  let offset = 0;
  let hash: bigint;

  if (length >= 32) {
    let v1 = (seed + P1 + P2) & MASK;
    let v2 = (seed + P2) & MASK;
    let v3 = seed & MASK;
    let v4 = (seed - P1) & MASK;
    do {
      v1 = round(v1, view.getBigUint64(offset, true));
      v2 = round(v2, view.getBigUint64(offset + 8, true));
      v3 = round(v3, view.getBigUint64(offset + 16, true));
      v4 = round(v4, view.getBigUint64(offset + 24, true));
      offset += 32;
    } while (offset <= length - 32);
    hash =
      (rotate(v1, 1n) + rotate(v2, 7n) + rotate(v3, 12n) + rotate(v4, 18n)) &
      MASK;
    for (const value of [v1, v2, v3, v4]) {
      hash = ((hash ^ round(0n, value)) * P1 + P4) & MASK;
    }
  } else {
    hash = (seed + P5) & MASK;
  }

  hash = (hash + BigInt(length)) & MASK;
  while (offset <= length - 8) {
    hash ^= round(0n, view.getBigUint64(offset, true));
    hash = (rotate(hash, 27n) * P1 + P4) & MASK;
    offset += 8;
  }
  if (offset <= length - 4) {
    hash ^= BigInt(view.getUint32(offset, true)) * P1;
    hash = (rotate(hash, 23n) * P2 + P3) & MASK;
    offset += 4;
  }
  while (offset < length) {
    hash ^= BigInt(bytes[offset++]) * P5;
    hash = (rotate(hash, 11n) * P1) & MASK;
  }
  hash ^= hash >> 33n;
  hash = (hash * P2) & MASK;
  hash ^= hash >> 29n;
  hash = (hash * P3) & MASK;
  return (hash ^ (hash >> 32n)) & MASK;
}
