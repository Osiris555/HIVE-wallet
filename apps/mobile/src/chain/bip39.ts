// apps/mobile/src/chain/bip39.ts
// BIP39 mnemonic generation, validation, and seed derivation

import * as bip39Lib from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha512 } from "@noble/hashes/sha2";

/**
 * Generate a new 12-word BIP39 mnemonic phrase.
 */
export function generateMnemonic(): string {
  return bip39Lib.generateMnemonic(wordlist, 128); // 128 bits of entropy → 12 words
}

/**
 * Validate a mnemonic phrase (checks words and checksum).
 */
export function validateMnemonic(mnemonic: string): boolean {
  try {
    return bip39Lib.validateMnemonic(mnemonic.trim().toLowerCase(), wordlist);
  } catch {
    return false;
  }
}

/**
 * Derive a 64-byte seed from a mnemonic using PBKDF2-HMAC-SHA512 (BIP39 standard).
 * The caller should slice the first 32 bytes to use as a master seed for Ed25519.
 *
 * @param mnemonic - The BIP39 mnemonic phrase
 * @param passphrase - Optional BIP39 passphrase (default: "")
 */
export async function mnemonicToMasterSeed(
  mnemonic: string,
  passphrase: string = ""
): Promise<Uint8Array> {
  const normalised = mnemonic.trim().toLowerCase();
  const mnemonicBytes = new TextEncoder().encode(normalised);
  const saltBytes = new TextEncoder().encode("mnemonic" + passphrase);

  // BIP39 standard: PBKDF2-HMAC-SHA512, 2048 iterations, 64-byte output
  const seed = await pbkdf2Async(sha512, mnemonicBytes, saltBytes, {
    c: 2048,
    dkLen: 64,
  });

  return seed;
}

/**
 * Derive the 32-byte master seed slice from a mnemonic.
 * This is what wallet-manager uses as its internal master seed.
 */
export async function mnemonicToWalletSeed(mnemonic: string): Promise<Uint8Array> {
  const fullSeed = await mnemonicToMasterSeed(mnemonic);
  return fullSeed.slice(0, 32);
}
