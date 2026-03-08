// apps/mobile/src/chain/chrysalis.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chrysalis Security Framework v1.0 — HIVE Wallet Integration
//
// Post-Quantum Hybrid Cryptography:
//   Classical : Ed25519  (existing wallet signing)
//   PQ-KEM    : ML-KEM-768  (NIST FIPS 203 — quantum-safe key encapsulation)
//   PQ-Sign   : ML-DSA-65   (NIST FIPS 204 — quantum-safe digital signatures)
//
// Architecture:
//   - All Chrysalis keys are derived deterministically from the master seed
//     (same derivation path as Ed25519, using HKDF-SHA3-256 with domain tags)
//   - Private keys are NEVER stored — re-derived on demand
//   - Public keys are registered on-chain and stored server-side
//   - Hybrid encryption: ML-KEM (key encap) + XSalsa20-Poly1305 (data)
//   - CAS-φ: Chrysalis Adaptive Sharding using the golden ratio (φ ≈ 0.618)
// ─────────────────────────────────────────────────────────────────────────────

import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { ml_dsa65 }  from "@noble/post-quantum/ml-dsa";
import { hkdf }      from "@noble/hashes/hkdf";
import { sha3_256 }  from "@noble/hashes/sha3";
import { sha256 }    from "@noble/hashes/sha2";
import { pbkdf2 }    from "@noble/hashes/pbkdf2";
import nacl          from "tweetnacl";
import * as naclUtil from "tweetnacl-util";

// ── Version & algorithm labels ────────────────────────────────────────────────
export const CHRYSALIS_VERSION  = "1.0";
export const CHRYSALIS_KEM_ALG  = "ML-KEM-768";
export const CHRYSALIS_DSA_ALG  = "ML-DSA-65";
export const CHRYSALIS_SYM_ALG  = "XSalsa20-Poly1305";
export const CAS_PHI            = 0.6180339887; // golden ratio φ

// ── Types ─────────────────────────────────────────────────────────────────────

/** Public-key material that is safe to share and register on-chain */
export type ChrysalisPublicKeys = {
  kemPublicKeyHex : string;  // ML-KEM-768 public key  (hex, 1184 bytes → 2368 chars)
  dsaPublicKeyHex : string;  // ML-DSA-65  public key  (hex, 1952 bytes → 3904 chars)
  chrysalisId     : string;  // SHA3-256(kemPub ∥ dsaPub) — unique 64-char identity
  version         : string;
};

/** Full bundle including private keys — derived on-demand, never stored */
export type ChrysalisKeyBundle = ChrysalisPublicKeys & {
  kemSecretKeyHex : string;  // ML-KEM-768 secret key (hex, 2400 bytes) — never transmitted
  dsaSecretKeyHex : string;  // ML-DSA-65  secret key (hex, 4032 bytes) — never transmitted
};

/**
 * Chrysalis hybrid-encrypted blob.
 * Encryption: ML-KEM-768 encapsulation → sharedSecret → XSalsa20-Poly1305(data)
 * Quantum-safe: attacker must solve the ML-KEM lattice problem to recover the key.
 */
export type ChrysalisEncryptedBlob = {
  kemCipherTextHex : string;  // ML-KEM ciphertext (1088 bytes → 2176 hex chars)
  nonce            : string;  // 24-byte nonce (base64)
  cipherText       : string;  // encrypted payload (base64)
  version          : string;
};

/** Chrysalis Consent Token — all-or-nothing, irreversible once consent=true */
export type ConsentToken = {
  tokenType    : "CCT";
  version      : string;
  sessionId    : string;
  viewerWallet : string;
  creatorWallet: string;
  consent      : boolean;      // TRUE = creator owns media; FALSE = media locked
  issuedAt     : number;       // Unix ms
  revocable    : boolean;      // true only while consent=false (pre-mint)
  scope        : "FULL";       // Chrysalis is all-or-nothing per spec
};

/** Signed CCT — includes ML-DSA-65 signature over the token hash */
export type SignedConsentToken = ConsentToken & {
  consentHash       : string;  // SHA3-256(canonical token body) — hex
  dsaSignatureHex   : string;  // ML-DSA-65 signature over consentHash bytes
  signerPublicKeyHex: string;  // Viewer's Chrysalis DSA public key
  chrysalisId       : string;  // Viewer's Chrysalis ID
};

/**
 * CAS-φ shard.
 * `role` and `part` are internal metadata — NEVER included in exported/copied shard JSON.
 * What gets shared externally is only `{ index, data }`.
 */
export type CasPhiShard = {
  index : number;
  role  : "primary" | "decoy";    // internal — stripped before export
  part  ?: "A" | "B" | "C" | "parity";  // internal — RAID-5 part label
  data  : string;   // base64
  size  : number;
};

/** CAS-φ manifest describing how data was sharded */
export type CasPhiManifest = {
  totalShards  : number;
  primaryShards: number;
  decoyShards  : number;
  threshold    : number;    // minimum primary shards needed for reconstruction
  phiRatio     : number;    // always CAS_PHI
  shards       : CasPhiShard[];
};

// ── Utility helpers ───────────────────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function u8ToB64(u8: Uint8Array): string { return naclUtil.encodeBase64(u8); }
function b64ToU8(b64: string): Uint8Array { return naclUtil.decodeBase64(b64); }

/** Concatenate two Uint8Arrays */
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** 4-byte big-endian encoding of a 32-bit integer */
function indexBytes(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >> 24) & 0xff;
  b[1] = (n >> 16) & 0xff;
  b[2] = (n >>  8) & 0xff;
  b[3] =  n        & 0xff;
  return b;
}

// ── Key derivation ────────────────────────────────────────────────────────────
//
// Deterministically derives Chrysalis keys from the master BIP39 seed using
// HKDF-SHA3-256 with domain-separated info strings.
//
//   kemSeed (64 bytes) = HKDF(sha3_256, masterSeed, info="CHRYSALIS_KEM_v1_"||idx)
//   dsaSeed (32 bytes) = HKDF(sha3_256, masterSeed, info="CHRYSALIS_DSA_v1_"||idx)
//
// The same master seed that generates Ed25519 keys (via SHA-256 in wallet-manager)
// independently generates the PQ keys here — no key material is shared.
//
export function deriveChrysalisKeys(
  masterSeedB64: string,
  walletIndex  : number
): ChrysalisKeyBundle {
  const enc        = new TextEncoder();
  const masterSeed = b64ToU8(masterSeedB64);
  const idxB       = indexBytes(walletIndex);

  // ML-KEM-768 keygen seed: 64 bytes (d || z per FIPS 203)
  const kemInfo  = concat(enc.encode("CHRYSALIS_KEM_v1_"), idxB);
  const kemSeed  = hkdf(sha3_256, masterSeed, undefined, kemInfo, 64);
  const { publicKey: kemPub, secretKey: kemSec } = ml_kem768.keygen(kemSeed);

  // ML-DSA-65 keygen seed: 32 bytes (ξ per FIPS 204)
  const dsaInfo  = concat(enc.encode("CHRYSALIS_DSA_v1_"), idxB);
  const dsaSeed  = hkdf(sha3_256, masterSeed, undefined, dsaInfo, 32);
  const { publicKey: dsaPub, secretKey: dsaSec } = ml_dsa65.keygen(dsaSeed);

  // Chrysalis ID: SHA3-256(kemPub ∥ dsaPub) → 64-char hex
  const chrysalisId = bytesToHex(sha3_256(concat(kemPub, dsaPub)));

  return {
    kemPublicKeyHex : bytesToHex(kemPub),
    kemSecretKeyHex : bytesToHex(kemSec),
    dsaPublicKeyHex : bytesToHex(dsaPub),
    dsaSecretKeyHex : bytesToHex(dsaSec),
    chrysalisId,
    version         : CHRYSALIS_VERSION,
  };
}

/** Extract only the public-key portion (safe to transmit) */
export function chrysalisPublicKeys(bundle: ChrysalisKeyBundle): ChrysalisPublicKeys {
  return {
    kemPublicKeyHex: bundle.kemPublicKeyHex,
    dsaPublicKeyHex: bundle.dsaPublicKeyHex,
    chrysalisId    : bundle.chrysalisId,
    version        : bundle.version,
  };
}

// ── Hybrid encryption (ML-KEM-768 + XSalsa20-Poly1305) ───────────────────────
//
// 1. ML-KEM-768 encapsulate(recipientKemPublicKey)
//       → { cipherText (1088 bytes), sharedSecret (32 bytes) }
// 2. nacl.secretbox(data, nonce, sharedSecret)  — XSalsa20-Poly1305
//
// Quantum-safe: recovering the plaintext requires breaking ML-KEM-768
// (a lattice problem with no known quantum speedup).
//

export function chrysalisEncrypt(
  data            : Uint8Array,
  kemPublicKeyHex : string
): ChrysalisEncryptedBlob {
  const kemPublicKey = hexToBytes(kemPublicKeyHex);

  // ML-KEM encapsulation — generates a one-time shared secret
  const { cipherText: kemCipherText, sharedSecret } = ml_kem768.encapsulate(kemPublicKey);

  // Symmetric encryption with the 32-byte shared secret
  const nonce     = nacl.randomBytes(24);
  const encrypted = nacl.secretbox(data, nonce, sharedSecret);

  return {
    kemCipherTextHex: bytesToHex(kemCipherText),
    nonce           : u8ToB64(nonce),
    cipherText      : u8ToB64(encrypted),
    version         : CHRYSALIS_VERSION,
  };
}

export function chrysalisDecrypt(
  blob            : ChrysalisEncryptedBlob,
  kemSecretKeyHex : string
): Uint8Array | null {
  try {
    const kemSecretKey  = hexToBytes(kemSecretKeyHex);
    const kemCipherText = hexToBytes(blob.kemCipherTextHex);

    // ML-KEM decapsulation — recovers the shared secret
    const sharedSecret  = ml_kem768.decapsulate(kemCipherText, kemSecretKey);

    const nonce     = b64ToU8(blob.nonce);
    const encrypted = b64ToU8(blob.cipherText);

    return nacl.secretbox.open(encrypted, nonce, sharedSecret);
  } catch {
    return null;
  }
}

// ── Post-quantum signatures (ML-DSA-65) ──────────────────────────────────────
//
// Used for Chrysalis Consent Tokens (CCT) and wallet attestations.
// ML-DSA-65 (CRYSTALS-Dilithium, NIST FIPS 204) is secure against Shor's algorithm.
//

export function chrysalisSign(
  message       : Uint8Array,
  dsaSecretKeyHex: string
): Uint8Array {
  return ml_dsa65.sign(hexToBytes(dsaSecretKeyHex), message);
}

export function chrysalisVerify(
  message       : Uint8Array,
  signatureHex  : string,
  dsaPublicKeyHex: string
): boolean {
  try {
    return ml_dsa65.verify(
      hexToBytes(dsaPublicKeyHex),
      message,
      hexToBytes(signatureHex)
    );
  } catch {
    return false;
  }
}

// ── Chrysalis Consent Token (CCT) ─────────────────────────────────────────────
//
// Per the Chrysalis Consent Registry spec (CR-V1):
//   - Consent is binary (all-or-nothing)
//   - Once consent=true is signed and submitted, it is irreversible
//   - No platform or creator can override a viewer's consent state
//   - Signed with the viewer's ML-DSA-65 private key
//

export function createCCT(params: {
  sessionId    : string;
  viewerWallet : string;
  creatorWallet: string;
  consent      : boolean;
}): ConsentToken {
  return {
    tokenType    : "CCT",
    version      : CHRYSALIS_VERSION,
    sessionId    : params.sessionId,
    viewerWallet : params.viewerWallet,
    creatorWallet: params.creatorWallet,
    consent      : params.consent,
    issuedAt     : Date.now(),
    // Consent token is revocable only if consent=false (no rights transferred yet)
    revocable    : !params.consent,
    scope        : "FULL",
  };
}

/** Canonical JSON body used for hashing — field order is deterministic */
function cctBody(cct: ConsentToken): string {
  return JSON.stringify({
    tokenType    : cct.tokenType,
    version      : cct.version,
    sessionId    : cct.sessionId,
    viewerWallet : cct.viewerWallet,
    creatorWallet: cct.creatorWallet,
    consent      : cct.consent,
    issuedAt     : cct.issuedAt,
    scope        : cct.scope,
  });
}

/**
 * Sign a CCT with the viewer's ML-DSA-65 key.
 * The viewer's wallet signs to prove they issued consent.
 */
export function signCCT(
  cct             : ConsentToken,
  dsaSecretKeyHex : string,
  dsaPublicKeyHex : string,
  chrysalisId     : string
): SignedConsentToken {
  const enc         = new TextEncoder();
  const bodyBytes   = enc.encode(cctBody(cct));
  const hashBytes   = sha3_256(bodyBytes);
  const consentHash = bytesToHex(hashBytes);
  const signature   = chrysalisSign(hashBytes, dsaSecretKeyHex);

  return {
    ...cct,
    consentHash,
    dsaSignatureHex   : bytesToHex(signature),
    signerPublicKeyHex: dsaPublicKeyHex,
    chrysalisId,
  };
}

/** Verify a signed CCT — returns false on any error */
export function verifyCCT(sct: SignedConsentToken): boolean {
  try {
    const enc          = new TextEncoder();
    const expectedHash = bytesToHex(sha3_256(enc.encode(cctBody(sct))));
    if (expectedHash !== sct.consentHash) return false;

    return chrysalisVerify(
      hexToBytes(sct.consentHash),
      sct.dsaSignatureHex,
      sct.signerPublicKeyHex
    );
  } catch {
    return false;
  }
}

// ── CAS-φ: Chrysalis Adaptive Sharding ───────────────────────────────────────
//
// (3,4) RAID-5 threshold scheme + decoy shards, random interleaving.
//
// Primary shards (4 total, any 3 reconstruct):
//   Split data into 3 equal parts A, B, C (last padded to same size).
//   P0 = A,  P1 = B,  P2 = C,  P3 = A ⊕ B ⊕ C  (parity)
//   Any 3 of {P0,P1,P2,P3} → reconstruct all of A, B, C → full data.
//
// Decoy shards (3 total):
//   Cryptographically random bytes, same size as primary shards.
//   Visually and statistically indistinguishable from primary shards.
//
// Security:
//   - Shards are randomly shuffled so decoys are NOT always at the end.
//   - `role` and `part` are INTERNAL metadata only — stripped before export.
//   - Exported shard JSON is { index, data } — no role, no part.
//   - Even knowing all 7 shards, data is still ML-KEM-768 encrypted.
//
/** Fisher-Yates shuffle using nacl.randomBytes for cryptographic randomness */
function cryptoShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    // nacl.randomBytes gives uniform random bytes; use modulo for index
    const j = nacl.randomBytes(2).reduce((acc, b) => (acc * 256 + b), 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function casPhiShard(data: Uint8Array, n: number = 5): CasPhiManifest {
  // With n=5: primaryCount=4, decoyCount=3, threshold=3 (any 3 of 4 primaries)
  const primaryCount = Math.ceil(n * CAS_PHI);   // 4
  const decoyCount   = Math.floor(n * CAS_PHI);  // 3
  const threshold    = 3;                          // explicit: any 3 of 4 primary shards

  // Pad data so it divides evenly into 3 chunks (for parts A, B, C)
  const chunkSize = Math.ceil(data.length / 3);
  const padded    = new Uint8Array(chunkSize * 3);
  padded.set(data);

  const chunkA    = padded.slice(0, chunkSize);
  const chunkB    = padded.slice(chunkSize, chunkSize * 2);
  const chunkC    = padded.slice(chunkSize * 2, chunkSize * 3);

  // Parity shard = A ⊕ B ⊕ C
  const parity    = new Uint8Array(chunkSize);
  for (let j = 0; j < chunkSize; j++) parity[j] = chunkA[j] ^ chunkB[j] ^ chunkC[j];

  // Build ordered primary shard objects (roles stripped at export time)
  const primaries: CasPhiShard[] = [
    { index: 0, role: "primary", part: "A",      data: u8ToB64(chunkA),  size: chunkSize },
    { index: 1, role: "primary", part: "B",      data: u8ToB64(chunkB),  size: chunkSize },
    { index: 2, role: "primary", part: "C",      data: u8ToB64(chunkC),  size: chunkSize },
    { index: 3, role: "primary", part: "parity", data: u8ToB64(parity),  size: chunkSize },
  ];

  // Build decoy shards (random noise, same size as primary)
  const decoys: CasPhiShard[] = Array.from({ length: decoyCount }, (_, i) => {
    const d = nacl.randomBytes(chunkSize);
    return { index: 4 + i, role: "decoy" as const, data: u8ToB64(d), size: chunkSize };
  });

  // Shuffle all shards together so decoys are NOT always at the end
  const shuffled = cryptoShuffle([...primaries, ...decoys]);
  // Reassign sequential indices after shuffling
  const final = shuffled.map((s, i) => ({ ...s, index: i }));

  return {
    totalShards  : final.length,
    primaryShards: primaryCount,
    decoyShards  : decoyCount,
    threshold,
    phiRatio     : CAS_PHI,
    shards       : final,
  };
}

/**
 * Reconstruct data from a CasPhiManifest using any 3 of the 4 primary shards.
 * Requires internal manifest with `role` and `part` fields intact.
 * The original data length is unknown so callers may need to trim trailing zeros.
 */
export function casPhiReconstruct(manifest: CasPhiManifest): Uint8Array {
  const primaries = manifest.shards.filter(s => s.role === "primary");
  if (primaries.length < manifest.threshold) {
    throw new Error(
      `CAS-φ reconstruction needs ≥${manifest.threshold} primary shards, have ${primaries.length}`
    );
  }

  const chunkSize = b64ToU8(primaries[0].data).length;

  const getChunk = (part: string): Uint8Array | null => {
    const s = primaries.find(p => p.part === part);
    return s ? b64ToU8(s.data) : null;
  };

  let A = getChunk("A");
  let B = getChunk("B");
  let C = getChunk("C");
  const P = getChunk("parity");

  // RAID-5: recover whichever chunk is missing using parity = A ⊕ B ⊕ C
  if (!A && P && B && C) {
    A = new Uint8Array(chunkSize);
    for (let j = 0; j < chunkSize; j++) A[j] = P[j] ^ B[j] ^ C[j];
  } else if (!B && P && A && C) {
    B = new Uint8Array(chunkSize);
    for (let j = 0; j < chunkSize; j++) B[j] = P[j] ^ A[j] ^ C[j];
  } else if (!C && P && A && B) {
    C = new Uint8Array(chunkSize);
    for (let j = 0; j < chunkSize; j++) C[j] = P[j] ^ A[j] ^ B[j];
  }

  if (!A || !B || !C) {
    throw new Error("CAS-φ reconstruction: insufficient primary shards to recover all data parts");
  }

  // Concatenate A ∥ B ∥ C — caller trims trailing zero-padding
  const result = new Uint8Array(chunkSize * 3);
  result.set(A, 0);
  result.set(B, chunkSize);
  result.set(C, chunkSize * 2);
  return result;
}

// ── Human-readable fingerprint ────────────────────────────────────────────────
//
// Short identifier shown in the wallet UI.
// Format: "CHRY-XXXX-XXXX-XXXX" — first 12 hex chars of chrysalisId
//
export function chrysalisFingerprint(chrysalisId: string): string {
  const id = chrysalisId.toUpperCase();
  return `CHRY-${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8, 12)}`;
}

// ── Recovery Shards (cross-device disaster recovery) ─────────────────────────
//
// Unlike the ML-KEM Chrysalis backup (which requires re-deriving the private
// key from the master seed), Recovery Shards use PBKDF2-SHA256 + XSalsa20
// symmetric encryption so any device can decrypt with just the passphrase.
//
// Format: 4 primary shards (A, B, C, parity) — any 3 reconstruct.
// No decoy shards: all 4 are real, user stores each separately.
//

export type RecoveryShard = {
  type: "HIVE_RECOVERY_SHARD_v1";
  part: "A" | "B" | "C" | "parity";
  data: string; // base64 — 1/3 of the PBKDF2-encrypted payload
};

const RECOVERY_PBKDF2_ITERS = 100_000;
const RECOVERY_SALT_BYTES   = 16;

/**
 * Encrypts the mnemonic with a user passphrase, then RAID-5 shards the result
 * into 4 RecoveryShards (A, B, C, parity). Any 3 shards + the passphrase
 * can reconstruct the mnemonic on any device — no master seed required.
 */
export function generateRecoveryShards(
  mnemonic  : string,
  passphrase: string,
): RecoveryShard[] {
  const enc  = new TextEncoder();

  // PBKDF2-SHA256: passphrase → 32-byte symmetric key
  const salt = nacl.randomBytes(RECOVERY_SALT_BYTES);
  const key  = pbkdf2(sha256, enc.encode(passphrase), salt, {
    c    : RECOVERY_PBKDF2_ITERS,
    dkLen: 32,
  });

  // XSalsa20-Poly1305 encrypt
  const nonce     = nacl.randomBytes(24);
  const plaintext = enc.encode(mnemonic.trim());
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  // Pack: salt(16) ∥ nonce(24) ∥ ciphertext(variable)
  const payload = new Uint8Array(salt.length + nonce.length + ciphertext.length);
  payload.set(salt,       0);
  payload.set(nonce,      salt.length);
  payload.set(ciphertext, salt.length + nonce.length);

  // RAID-5 split into 3 equal chunks + parity
  const chunkSize = Math.ceil(payload.length / 3);
  const padded    = new Uint8Array(chunkSize * 3);
  padded.set(payload);

  const chunkA  = padded.slice(0, chunkSize);
  const chunkB  = padded.slice(chunkSize, chunkSize * 2);
  const chunkC  = padded.slice(chunkSize * 2);
  const parity  = new Uint8Array(chunkSize);
  for (let i = 0; i < chunkSize; i++) parity[i] = chunkA[i] ^ chunkB[i] ^ chunkC[i];

  return [
    { type: "HIVE_RECOVERY_SHARD_v1", part: "A",      data: u8ToB64(chunkA)  },
    { type: "HIVE_RECOVERY_SHARD_v1", part: "B",      data: u8ToB64(chunkB)  },
    { type: "HIVE_RECOVERY_SHARD_v1", part: "C",      data: u8ToB64(chunkC)  },
    { type: "HIVE_RECOVERY_SHARD_v1", part: "parity", data: u8ToB64(parity)  },
  ];
}

/**
 * Reconstructs the mnemonic from any 3 of the 4 RecoveryShards + the passphrase.
 * Throws if fewer than 3 valid shards are provided or decryption fails.
 */
export function reconstructFromRecoveryShards(
  shards    : RecoveryShard[],
  passphrase: string,
): string {
  if (shards.length < 3) {
    throw new Error("Need at least 3 recovery shards to reconstruct");
  }

  const getChunk = (part: RecoveryShard["part"]) => {
    const s = shards.find(s => s.part === part);
    return s ? b64ToU8(s.data) : null;
  };

  const chunkSize = b64ToU8(shards[0].data).length;

  let A = getChunk("A");
  let B = getChunk("B");
  let C = getChunk("C");
  const P = getChunk("parity");

  // RAID-5: recover whichever chunk is missing
  if (!A && P && B && C) { A = new Uint8Array(chunkSize); for (let i = 0; i < chunkSize; i++) A[i] = P[i] ^ B[i] ^ C[i]; }
  if (!B && P && A && C) { B = new Uint8Array(chunkSize); for (let i = 0; i < chunkSize; i++) B[i] = P[i] ^ A[i] ^ C[i]; }
  if (!C && P && A && B) { C = new Uint8Array(chunkSize); for (let i = 0; i < chunkSize; i++) C[i] = P[i] ^ A[i] ^ B[i]; }

  if (!A || !B || !C) {
    throw new Error("Insufficient shard combination — provide shards A+B+C, A+B+P, A+C+P, or B+C+P");
  }

  // Reassemble payload: salt(16) ∥ nonce(24) ∥ ciphertext
  const padded = new Uint8Array(chunkSize * 3);
  padded.set(A, 0);
  padded.set(B, chunkSize);
  padded.set(C, chunkSize * 2);

  const salt       = padded.slice(0, RECOVERY_SALT_BYTES);
  const nonce      = padded.slice(RECOVERY_SALT_BYTES, RECOVERY_SALT_BYTES + 24);
  const ciphertext = padded.slice(RECOVERY_SALT_BYTES + 24);

  // Re-derive key from passphrase + salt
  const enc = new TextEncoder();
  const key = pbkdf2(sha256, enc.encode(passphrase), salt, {
    c    : RECOVERY_PBKDF2_ITERS,
    dkLen: 32,
  });

  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
  if (!decrypted) {
    throw new Error("Decryption failed — wrong passphrase or corrupted shards");
  }

  const mnemonic = new TextDecoder().decode(decrypted).replace(/\0+$/, "").trim();
  if (!mnemonic) throw new Error("Reconstructed data is empty — shards may be corrupted");
  return mnemonic;
}
