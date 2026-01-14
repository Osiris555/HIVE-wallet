// apps/mobile/src/crypto/sign.ts
// Honey Wallet — ed25519 Transaction Signing
// Phase 2: Real cryptographic transactions

import nacl from 'tweetnacl'
import { encode as base64Encode, decode as base64Decode } from 'base64-arraybuffer'
import { WalletKeys } from './keys'

// -----------------------------
// Types
// -----------------------------

export interface HoneyTransaction {
  from: string
  to: string
  amount: number
  nonce: number
  timestamp: number
}

export interface SignedTransaction {
  tx: HoneyTransaction
  hash: string
  signature: string
  publicKey: string
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

// Canonical serialization (VERY important)
function serializeTransaction(tx: HoneyTransaction): string {
  return JSON.stringify({
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    nonce: tx.nonce,
    timestamp: tx.timestamp
  })
}

// SHA-256 using Web Crypto (works on Web + Expo)
async function sha256(message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

// -----------------------------
// Signing
// -----------------------------

export async function signTransaction(
  tx: HoneyTransaction,
  wallet: WalletKeys
): Promise<SignedTransaction> {
  // 1. Serialize transaction
  const serialized = serializeTransaction(tx)

  // 2. Hash transaction
  const hashBytes = await sha256(serialized)
  const hashBase64 = bufferToBase64(hashBytes)

  // 3. Load private key
  const privateKeyBytes = base64ToBuffer(wallet.privateKey)

  // 4. Sign hash
  const signatureBytes = nacl.sign.detached(hashBytes, privateKeyBytes)
  const signatureBase64 = bufferToBase64(signatureBytes)

  return {
    tx,
    hash: hashBase64,
    signature: signatureBase64,
    publicKey: wallet.publicKey
  }
}
