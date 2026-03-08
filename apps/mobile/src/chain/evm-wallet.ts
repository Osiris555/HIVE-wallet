// apps/mobile/src/chain/evm-wallet.ts
// EVM (Base / Ethereum) wallet: BIP44 key derivation + EIP-1559 transaction signing.
// Uses the noble/scure ecosystem for consistency with existing HIVE signing code.

import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { decodeBase64 } from "tweetnacl-util";

// ── Types ──────────────────────────────────────────────────────────────────

export type EvmKeypair = {
  address: string;       // EIP-55 checksummed 0x address
  privateKey: Uint8Array;
  publicKey: Uint8Array; // 33-byte compressed
};

export type EvmTxData = {
  chainId: bigint;
  nonce: bigint;
  maxPriorityFeePerGas: bigint; // wei
  maxFeePerGas: bigint;          // wei
  gasLimit: bigint;
  to: string;                    // checksummed 0x address
  value: bigint;                 // wei
  data: string;                  // hex string, "0x" for ETH transfer
};

// ── BIP44 Address Derivation ───────────────────────────────────────────────

/**
 * Derive a secp256k1 keypair for EVM (Base / Ethereum) from a HIVE master seed.
 * Path: m/44'/60'/0'/0/{index}  (BIP44 standard Ethereum path)
 *
 * The same 12-word seed produces both a HIVE (ML-DSA-65) address and an
 * Ethereum (secp256k1) address — no new import needed.
 */
export function deriveEvmKeypair(masterSeedB64: string, index: number = 0): EvmKeypair {
  const masterSeedBytes = decodeBase64(masterSeedB64);
  const root = HDKey.fromMasterSeed(masterSeedBytes);
  const child = root.derive(`m/44'/60'/0'/0/${index}`);

  if (!child.privateKey) throw new Error("EVM key derivation failed");

  const privateKey = child.privateKey; // 32 bytes
  const pubKey33 = child.publicKey ?? secp256k1.getPublicKey(privateKey, true); // 33-byte compressed

  // Ethereum address = keccak256(uncompressed_pubkey[1:])[12:]
  const pubKeyUncompressed = secp256k1.getPublicKey(privateKey, false); // 65 bytes, 0x04 prefix
  const pubKeyPayload = pubKeyUncompressed.slice(1); // drop 0x04 prefix → 64 bytes
  const hash = keccak_256(pubKeyPayload);
  const addressBytes = hash.slice(12); // last 20 bytes
  const address = toChecksumAddress(bytesToHex(addressBytes));

  return { address, privateKey, publicKey: pubKey33 ?? new Uint8Array(33) };
}

// ── EIP-55 Checksum Address ────────────────────────────────────────────────

function toChecksumAddress(addr: string): string {
  const lower = addr.toLowerCase().replace("0x", "");
  // keccak256 needs bytes — encode the lowercase hex string as ASCII bytes
  const lowerBytes = new Uint8Array(lower.length);
  for (let i = 0; i < lower.length; i++) lowerBytes[i] = lower.charCodeAt(i);
  const hash = bytesToHex(keccak_256(lowerBytes));
  let result = "0x";
  for (let i = 0; i < lower.length; i++) {
    result += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return result;
}

// ── Minimal RLP Encoder ────────────────────────────────────────────────────
// Handles the subset of RLP needed for EIP-1559 transactions.

function rlpEncode(input: RlpInput): Uint8Array {
  if (input instanceof Uint8Array) return rlpEncodeBytes(input);
  if (typeof input === "bigint") return rlpEncodeBytes(bigintToBytes(input));
  if (Array.isArray(input)) return rlpEncodeList(input);
  throw new Error(`Unsupported RLP input type: ${typeof input}`);
}

type RlpInput = Uint8Array | bigint | RlpInput[];

function rlpEncodeBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return concat([rlpLength(bytes.length, 0x80), bytes]);
}

function rlpEncodeList(items: RlpInput[]): Uint8Array {
  const encoded = concat(items.map(rlpEncode));
  return concat([rlpLength(encoded.length, 0xc0), encoded]);
}

function rlpLength(len: number, offset: number): Uint8Array {
  if (len < 56) return new Uint8Array([offset + len]);
  const lenBytes = bigintToBytes(BigInt(len));
  return new Uint8Array([offset + 55 + lenBytes.length, ...lenBytes]);
}

function bigintToBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  const hex = n.toString(16).padStart(n.toString(16).length % 2 ? 1 : 0, "");
  const padded = hex.length % 2 ? "0" + hex : hex;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = clean.length % 2 ? "0" + clean : clean;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

// ── EIP-1559 Transaction Signing ───────────────────────────────────────────

/**
 * Signs an EIP-1559 (type 2) transaction and returns the raw hex
 * ready for eth_sendRawTransaction.
 */
export function signEvmTransaction(tx: EvmTxData, privateKey: Uint8Array): string {
  // Encode unsigned tx for signing
  const unsigned: RlpInput[] = [
    tx.chainId,
    tx.nonce,
    tx.maxPriorityFeePerGas,
    tx.maxFeePerGas,
    tx.gasLimit,
    hexToBytes(tx.to),
    tx.value,
    hexToBytes(tx.data),
    [], // accessList (empty)
  ];

  const signingPayload = concat([new Uint8Array([0x02]), rlpEncode(unsigned)]);
  const signingHash = keccak_256(signingPayload);

  // Sign with secp256k1 (deterministic RFC6979)
  const sig = secp256k1.sign(signingHash, privateKey, { lowS: true });
  const v = BigInt(sig.recovery); // 0 or 1 for EIP-1559
  const r = BigInt("0x" + bytesToHex(sig.toCompactRawBytes().slice(0, 32)));
  const s = BigInt("0x" + bytesToHex(sig.toCompactRawBytes().slice(32, 64)));

  // Encode signed tx
  const signed: RlpInput[] = [
    tx.chainId,
    tx.nonce,
    tx.maxPriorityFeePerGas,
    tx.maxFeePerGas,
    tx.gasLimit,
    hexToBytes(tx.to),
    tx.value,
    hexToBytes(tx.data),
    [], // accessList
    v,
    r,
    s,
  ];

  const encoded = concat([new Uint8Array([0x02]), rlpEncode(signed)]);
  return "0x" + bytesToHex(encoded);
}

// ── ABI Helpers ────────────────────────────────────────────────────────────

/**
 * Encode ERC-20 transfer(address,uint256) calldata.
 */
export function encodeErc20Transfer(to: string, amount: bigint): string {
  // Function selector: keccak256("transfer(address,uint256)")[0:4]
  const selector = "a9059cbb";
  const toHex = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const amtHex = amount.toString(16).padStart(64, "0");
  return "0x" + selector + toHex + amtHex;
}

/**
 * Encode ERC-20 balanceOf(address) calldata.
 */
export function encodeBalanceOf(address: string): string {
  const selector = "70a08231";
  const addrHex = address.toLowerCase().replace("0x", "").padStart(64, "0");
  return "0x" + selector + addrHex;
}
