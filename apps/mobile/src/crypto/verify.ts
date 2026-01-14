// apps/mobile/src/crypto/verify.ts
// Honey Wallet — ed25519 Transaction Verification
// Phase 2: Validator-grade verification

import nacl from 'tweetnacl'
import { decode as base64Decode } from 'base64-arraybuffer'
import { SignedTransaction } from './sign'

// -----------------------------
// Helpers
// -----------------------------

function base64ToBuffer(base64: string): Uint8Array {
  return new Uint8Array(base64Decode(base64))
}

// Must EXACTLY match serialization used in sign.ts
function serializeTransaction(tx: any): string {
  return JSON.stringify({
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    nonce: tx.nonce,
    timestamp: tx.timestamp
  })
}

// SHA-256
async function sha256(message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

// -----------------------------
// Verification
// -----------------------------

export async function verifyTransaction(
  signedTx: SignedTransaction
): Promise<boolean> {
  try {
    // 1. Re-serialize tx
    const serialized = serializeTransaction(signedTx.tx)

    // 2. Re-hash tx
    const hashBytes = await sha256(serialized)

    // 3. Decode signature + public key
    const signatureBytes = base64ToBuffer(signedTx.signature)
    const publicKeyBytes = base64ToBuffer(signedTx.publicKey)

    // 4. Verify signature
    return nacl.sign.detached.verify(
      hashBytes,
      signatureBytes,
      publicKeyBytes
    )
  } catch {
    return false
  }
}
