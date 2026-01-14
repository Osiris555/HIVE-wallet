import * as ed25519 from '@noble/ed25519'
import { bytesToHex } from '@noble/hashes/utils'

/**
 * Canonical JSON stringify
 * (guarantees deterministic signing)
 */
function canonicalize(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort())
}

export interface SignedTransaction {
  payload: any
  payloadHash: string
  signature: string
  publicKey: string
}

/**
 * Sign a transaction payload using ed25519
 */
export async function signTransaction(
  payload: any,
  privateKeyHex: string
): Promise<SignedTransaction> {
  // 1️⃣ Canonicalize payload
  const canonicalPayload = canonicalize(payload)

  // 2️⃣ Hash payload
  const payloadBytes = new TextEncoder().encode(canonicalPayload)
  const payloadHashBytes = await ed25519.utils.sha512(payloadBytes)
  const payloadHashHex = bytesToHex(payloadHashBytes)

  // 3️⃣ Sign hash
  const signatureBytes = await ed25519.sign(
    payloadHashBytes,
    privateKeyHex
  )
  const signatureHex = bytesToHex(signatureBytes)

  // 4️⃣ Derive public key
  const publicKeyBytes = await ed25519.getPublicKey(privateKeyHex)
  const publicKeyHex = bytesToHex(publicKeyBytes)

  return {
    payload,
    payloadHash: payloadHashHex,
    signature: signatureHex,
    publicKey: publicKeyHex
  }
}
