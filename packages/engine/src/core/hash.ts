import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** JSON with object keys sorted, so equal values always hash identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export function hashValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Hash-chain link: hash(prevHash + canonical(event)). */
export function chainHash(prevHash: string, event: unknown): string {
  return sha256Hex(prevHash + canonicalJson(event));
}
