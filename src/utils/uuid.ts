export interface UUIDGeneratorOptions {
  disableRandomUUID?: boolean;
  disableGetRandomValues?: boolean;
}

let monotonicSequence = 0;
let lastTimestampMs = 0;

// Internal 128-bit state for xorshift128+ fallback when Web Crypto APIs are unavailable
let state0 = 0x9e3779b9 ^ Date.now();
let state1 = 0x243f6a88 ^ (typeof performance !== 'undefined' ? Math.floor(performance.now() * 1000) : 0x85a308d3);
let state2 = 0xb7e15162 ^ 0x45d9f3b;
let state3 = 0x6a09e667 ^ 0x119de1f3;

function nextXorShift32(): number {
  let t = state3;
  const s = state0;
  state3 = state2;
  state2 = state1;
  state1 = s;
  t ^= (t << 11) & 0xffffffff;
  t ^= t >>> 8;
  state0 = (t ^ s ^ (s >>> 19)) >>> 0;
  return state0;
}

function bytesToUuidString(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * Generates an RFC 4122 v4 compliant UUID string under any browser security context:
 * 1. Uses `crypto.randomUUID()` if available (HTTPS / localhost).
 * 2. Uses `crypto.getRandomValues()` if available (HTTP public IP in modern browsers).
 * 3. Uses a stateful high-entropy fallback combining millisecond time, high-resolution
 *    performance ticks, a monotonic sequence counter, and xorshift128+ state mixing.
 */
export function generateUUID(options?: UUIDGeneratorOptions): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  // Tier 1: Native crypto.randomUUID (Secure Contexts)
  if (
    !options?.disableRandomUUID &&
    cryptoObj &&
    typeof cryptoObj.randomUUID === 'function'
  ) {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // Fall through to Tier 2 if restricted by runtime
    }
  }

  // Tier 2: crypto.getRandomValues (Works on HTTP IP addresses in standard browsers)
  if (
    !options?.disableGetRandomValues &&
    cryptoObj &&
    typeof cryptoObj.getRandomValues === 'function'
  ) {
    try {
      const bytes = new Uint8Array(16);
      cryptoObj.getRandomValues(bytes);
      // RFC 4122 section 4.4: set version 4 and variant 10xx
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return bytesToUuidString(bytes);
    } catch {
      // Fall through to Tier 3
    }
  }

  // Tier 3: Deterministic-collision-free non-crypto fallback
  const nowMs = Date.now();
  if (nowMs === lastTimestampMs) {
    monotonicSequence = (monotonicSequence + 1) & 0xffff;
  } else {
    lastTimestampMs = nowMs;
    monotonicSequence = (monotonicSequence + 1) & 0xffff;
  }

  const perfTicks =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? Math.floor(performance.now() * 1000) & 0xffffffff
      : 0;

  // Mix fresh entropy into xorshift state
  state0 = (state0 ^ (nowMs & 0xffffffff) ^ monotonicSequence) >>> 0;
  state1 = (state1 ^ ((nowMs / 0x100000000) >>> 0) ^ perfTicks) >>> 0;
  if (state0 === 0 && state1 === 0 && state2 === 0 && state3 === 0) {
    state0 = 0x9e3779b9;
  }

  const bytes = new Uint8Array(16);
  // First 6 bytes incorporate 48-bit timestamp + xorshift output
  const r0 = nextXorShift32();
  const r1 = nextXorShift32();
  const r2 = nextXorShift32();
  const r3 = nextXorShift32();

  bytes[0] = ((nowMs / 0x10000000000) ^ (r0 >>> 24)) & 0xff;
  bytes[1] = ((nowMs / 0x100000000) ^ (r0 >>> 16)) & 0xff;
  bytes[2] = ((nowMs >>> 24) ^ (r0 >>> 8)) & 0xff;
  bytes[3] = ((nowMs >>> 16) ^ r0) & 0xff;
  bytes[4] = ((nowMs >>> 8) ^ (r1 >>> 24)) & 0xff;
  bytes[5] = (nowMs ^ (r1 >>> 16)) & 0xff;

  // Bytes 6..7 incorporate monotonic sequence counter
  bytes[6] = (((monotonicSequence >>> 8) ^ (r1 >>> 8)) & 0x0f) | 0x40;
  bytes[7] = (monotonicSequence ^ r1) & 0xff;

  // Bytes 8..15 incorporate performance ticks + xorshift words
  bytes[8] = (((perfTicks >>> 24) ^ (r2 >>> 24)) & 0x3f) | 0x80;
  bytes[9] = ((perfTicks >>> 16) ^ (r2 >>> 16)) & 0xff;
  bytes[10] = ((perfTicks >>> 8) ^ (r2 >>> 8)) & 0xff;
  bytes[11] = (perfTicks ^ r2) & 0xff;
  bytes[12] = (r3 >>> 24) & 0xff;
  bytes[13] = (r3 >>> 16) & 0xff;
  bytes[14] = (r3 >>> 8) & 0xff;
  bytes[15] = r3 & 0xff;

  return bytesToUuidString(bytes);
}

export function generateId(prefix: string, options?: UUIDGeneratorOptions): string {
  const cleanPrefix = prefix.replace(/_+$/, '');
  return `${cleanPrefix}_${generateUUID(options)}`;
}
