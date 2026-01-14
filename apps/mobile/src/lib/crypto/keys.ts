import * as ed25519 from '@noble/ed25519'
import { sha512 } from 'js-sha512'
import * as Crypto from 'expo-crypto'
import { getSecureItem, setSecureItem } from './secureStore'

/* ------------------------------------------------------------------ */
/* REQUIRED: SYNC SHA-512 FOR noble/ed25519                            */
/* ------------------------------------------------------------------ */

ed25519.etc.sha512Sync = (message: Uint8Array): Uint8Array => {
  return Uint8Array.from(sha512.array(message))
}

/* ------------------------------------------------------------------ */
/* HEX UTILITIES (NO BUFFER)                                           */
/* ------------------------------------------------------------------ */

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

/* ------------------------------------------------------------------ */
/* TYPES                                                              */
/* ------------------------------------------------------------------ */

export type KeyPair = {
  publicKey: string
  privateKey: string
}

/* ------------------------------------------------------------------ */
/* RANDOMNESS (Expo-safe)                                              */
/* ------------------------------------------------------------------ */

async function randomBytes(length: number): Promise<Uint8Array> {
  const bytes = await Crypto.getRandomBytesAsync(length)
  return Uint8Array.from(bytes)
}

/* ------------------------------------------------------------------ */
/* KEY GENERATION                                                      */
/* ------------------------------------------------------------------ */

export async function getOrCreateKeyPair(): Promise<KeyPair> {
  const existing = await getSecureItem('hive_keypair')
  if (existing) return JSON.parse(existing)

  const privateKey = await randomBytes(32)
  const publicKey = await ed25519.getPublicKey(privateKey)

  const keypair: KeyPair = {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey)
  }

  await setSecureItem('hive_keypair', JSON.stringify(keypair))
  return keypair
}

/* ------------------------------------------------------------------ */
/* ADDRESS DERIVATION                                                  */
/* ------------------------------------------------------------------ */
/**
 * Address = first 20 bytes of SHA-256(publicKey)
 * Returned as hex string (EVM-style length, chain-agnostic)
 */
export async function deriveAddress(publicKeyHex: string): Promise<string> {
  const publicKeyBytes = hexToBytes(publicKeyHex)

  const hash = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    publicKeyBytes
  )

  const addressBytes = new Uint8Array(hash).slice(0, 20)
  const addressHex = bytesToHex(addressBytes)

  return `HNY_${addressHex}`
}

/* ------------------------------------------------------------------ */
/* SIGNING                                                             */
/* ------------------------------------------------------------------ */

export async function signMessage(
  message: Uint8Array,
  privateKeyHex: string
): Promise<string> {
  const privateKey = hexToBytes(privateKeyHex)
  const signature = await ed25519.sign(message, privateKey)
  return bytesToHex(signature)
}

/* ------------------------------------------------------------------ */
/* VERIFICATION (VALIDATOR USE)                                        */
/* ------------------------------------------------------------------ */

export async function verifySignature(
  message: Uint8Array,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  const signature = hexToBytes(signatureHex)
  const publicKey = hexToBytes(publicKeyHex)
  return ed25519.verify(signature, message, publicKey)
}
