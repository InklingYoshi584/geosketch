import type { Id } from './types';

/** Structural view of the global Web Crypto object; keeps this module DOM-free. */
interface CryptoLike {
  randomUUID?: () => string;
}

let counter = 0;

/**
 * Mint a fresh object id. Prefers `crypto.randomUUID()` (browsers and Node ≥ 19)
 * and falls back to a counter plus random suffix where it is unavailable.
 * Ids only need to be unique within one document.
 */
export function newId(): Id {
  const host = globalThis as { crypto?: CryptoLike };
  const cryptoLike = host.crypto;
  if (cryptoLike !== undefined && typeof cryptoLike.randomUUID === 'function') {
    return cryptoLike.randomUUID();
  }
  counter += 1;
  return `id-${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
