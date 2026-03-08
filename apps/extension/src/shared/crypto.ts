// Crypto helpers — identical key derivation to apps/mobile/src/chain/wallet-manager.ts
// mnemonic → masterSeed(32B) → HKDF-SHA3-256 → ML-DSA-65 → HNY_ address

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { hkdf }     from '@noble/hashes/hkdf';
import { sha3_256 } from '@noble/hashes/sha3';
import { pbkdf2 }   from '@noble/hashes/pbkdf2';
import { sha512 }   from '@noble/hashes/sha2';

// ── Helpers ────────────────────────────────────────────────
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function indexBytes(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >> 24) & 0xff;
  b[1] = (n >> 16) & 0xff;
  b[2] = (n >>  8) & 0xff;
  b[3] =  n        & 0xff;
  return b;
}

export function bytesToHex(u8: Uint8Array): string {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Mnemonic → master seed (matches mnemonicToWalletSeed in bip39.ts) ─────────
// BIP39: PBKDF2-HMAC-SHA512, 2048 rounds, 64 bytes → take first 32 bytes
export function mnemonicToMasterSeed(mnemonic: string): Uint8Array {
  const normalised  = mnemonic.trim().toLowerCase();
  const mnemonicBytes = new TextEncoder().encode(normalised);
  const saltBytes   = new TextEncoder().encode('mnemonic');
  const full64 = pbkdf2(sha512, mnemonicBytes, saltBytes, { c: 2048, dkLen: 64 });
  return full64.slice(0, 32);
}

// ── ML-DSA-65 key derivation (matches deriveHiveMLDSAKeypair in wallet-manager.ts) ─
const HIVE_DSA_DOMAIN = new TextEncoder().encode('HIVE_WALLET_DSA_v1');

export type HiveKeypair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  address:   string;
};

export function deriveHiveKeypair(masterSeed: Uint8Array, index: number): HiveKeypair {
  const info   = concat(HIVE_DSA_DOMAIN, indexBytes(index));
  const seed32 = hkdf(sha3_256, masterSeed, undefined, info, 32);
  const { publicKey, secretKey } = ml_dsa65.keygen(seed32);
  const hash   = sha3_256(publicKey);
  const address = `HNY_${bytesToHex(hash).slice(0, 40)}`;
  return { publicKey, secretKey, address };
}

// ── Sign a message with ML-DSA-65 (returns hex) ───────────
export function signMessage(secretKey: Uint8Array, message: string): string {
  const msgBytes = new TextEncoder().encode(message);
  const sig = ml_dsa65.sign(secretKey, msgBytes);
  return bytesToHex(sig);
}

// ── AES-GCM-256 encryption for seed storage ───────────────
// Key derived from user password via PBKDF2-SHA256 (100k rounds)
async function deriveEncryptionKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a seed (Uint8Array) with a password. Returns base64 blob. */
export async function encryptSeed(password: string, seed: Uint8Array): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveEncryptionKey(password, salt);
  const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, seed as BufferSource);
  // Layout: salt(16) | iv(12) | ciphertext
  const blob = new Uint8Array(28 + ct.byteLength);
  blob.set(salt, 0);
  blob.set(iv, 16);
  blob.set(new Uint8Array(ct), 28);
  return btoa(String.fromCharCode(...blob));
}

/** Decrypt the seed blob with a password. Throws on wrong password. */
export async function decryptSeed(password: string, blobB64: string): Promise<Uint8Array> {
  const blob = Uint8Array.from(atob(blobB64), c => c.charCodeAt(0));
  const salt = blob.slice(0, 16);
  const iv   = blob.slice(16, 28);
  const ct   = blob.slice(28);
  const key  = await deriveEncryptionKey(password, salt);
  const pt   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(pt);
}
