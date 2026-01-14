// apps/mobile/src/crypto/keys.ts
// Honey Wallet — ed25519 Key Management
// Phase 1: Real cryptographic identity

import * as SecureStore from 'expo-secure-store'
import nacl from 'tweetnacl'
import { encode as base64Encode, decode as base64Decode } from 'base64-arraybuffer'

// -----------------------------
// Constants
// -----------------------------

const PRIVATE_KEY_STORAGE_KEY = 'HONEY_PRIVATE_KEY'

// -----------------------------
// Types
// -----------------------------

export interface WalletKeys {
  publicKey: string
  privateKey: string
  address: string
}

// -----------------------------
// Helpers
// -----------------------------

function bufferToBase64(buffer: Uint8Array): string {
  return base64Encode(buffer)
}

function base64ToBuffer(base64: string): Uint8Array {
  return new Uint8Array(base64Decode(base64))
}

// Simple address format for now:
// HNY + first 20 bytes of public key (base64, trimmed)
function deriveAddress(publicKey: Uint8Array): string {
  const short = publicKey.slice(0, 20)
  return `HNY_${bufferToBase64(short)}`
}

// -----------------------------
// Key Management
// -----------------------------

export async function generateWalletKeys(): Promise<WalletKeys> {
  const keypair = nacl.sign.keyPair()

  const privateKeyBase64 = bufferToBase64(keypair.secretKey)
  const publicKeyBase64 = bufferToBase64(keypair.publicKey)

  await SecureStore.setItemAsync(
    PRIVATE_KEY_STORAGE_KEY,
    privateKeyBase64,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED }
  )

  const address = deriveAddress(keypair.publicKey)

  return {
    publicKey: publicKeyBase64,
    privateKey: privateKeyBase64,
    address
  }
}

export async function loadWalletKeys(): Promise<WalletKeys | null> {
  const storedPrivateKey = await SecureStore.getItemAsync(
    PRIVATE_KEY_STORAGE_KEY
  )

  if (!storedPrivateKey) {
    return null
  }

  const secretKey = base64ToBuffer(storedPrivateKey)

  if (secretKey.length !== nacl.sign.secretKeyLength) {
    console.warn('Invalid private key length')
    return null
  }

  const keypair = nacl.sign.keyPair.fromSecretKey(secretKey)

  const publicKeyBase64 = bufferToBase64(keypair.publicKey)
  const address = deriveAddress(keypair.publicKey)

  return {
    publicKey: publicKeyBase64,
    privateKey: storedPrivateKey,
    address
  }
}

export async function getOrCreateWallet(): Promise<WalletKeys> {
  const existing = await loadWalletKeys()
  if (existing) {
    return existing
  }
  return generateWalletKeys()
}

export async function resetWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(PRIVATE_KEY_STORAGE_KEY)
}
