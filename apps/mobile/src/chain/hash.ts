import { sha256 } from 'js-sha256'

export function hashTransaction(tx: {
  from: string
  to: string
  amount: number
  nonce: number
  timestamp: number
}): Uint8Array {
  const canonical = [
    tx.from,
    tx.to,
    tx.amount.toString(),
    tx.nonce.toString(),
    tx.timestamp.toString()
  ].join('|')

  return Uint8Array.from(Buffer.from(sha256.array(canonical)))
}
