// apps/mobile/src/chain/wallet-manager.ts
// Multi-wallet support: derive multiple wallets from a single master seed.
// Uses ML-DSA-65 (Dilithium, NIST FIPS 204) as the primary signing algorithm.
import * as naclUtil from "tweetnacl-util";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { hkdf }     from "@noble/hashes/hkdf";
import { sha3_256 } from "@noble/hashes/sha3";
import { generateMnemonic, mnemonicToWalletSeed, validateMnemonic } from "./bip39";
import {
  deriveChrysalisKeys,
  chrysalisPublicKeys,
  chrysalisFingerprint,
  type ChrysalisPublicKeys,
} from "./chrysalis";

// ── Storage helpers ────────────────────────────────────────────────────────────
let SecureStore: any = null;
try { SecureStore = require("expo-secure-store"); } catch {}

async function kvGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  try { return await SecureStore?.getItemAsync(key); } catch { return null; }
}

async function kvSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try { localStorage.setItem(key, value); } catch {}
    return;
  }
  try { await SecureStore?.setItemAsync(key, value, { keychainAccessible: 1 }); } catch {}
}

async function kvDel(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try { localStorage.removeItem(key); } catch {}
    return;
  }
  try { await SecureStore?.deleteItemAsync(key); } catch {}
}

// ── Crypto helpers ─────────────────────────────────────────────────────────────
function u8ToB64(u8: Uint8Array): string { return naclUtil.encodeBase64(u8); }
function b64ToU8(b64: string): Uint8Array { return naclUtil.decodeBase64(b64); }

function bytesToHex(u8: Uint8Array): string {
  return Array.from(u8).map(b => b.toString(16).padStart(2, "0")).join("");
}

// expo-crypto SHA256 helper (still used for getSeedFingerprint)
async function sha256Expo(data: Uint8Array): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    Array.from(data).map(b => b.toString(16).padStart(2, "0")).join(""),
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
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

// ── Storage keys ───────────────────────────────────────────────────────────────
const MASTER_SEED_KEY   = "HIVE_MASTER_SEED_B64";
const MNEMONIC_KEY      = "HIVE_MNEMONIC_PHRASE";
const WALLETS_KEY       = "HIVE_WALLETS_JSON";
const ACTIVE_INDEX_KEY  = "HIVE_ACTIVE_WALLET_IDX";
// Multi-profile seed support
const PROFILES_KEY      = "HIVE_PROFILES_V2";       // JSON: SeedProfile[]
const ACTIVE_PROFILE_KEY = "HIVE_ACTIVE_PROFILE_ID"; // string

// ── Types ──────────────────────────────────────────────────────────────────────

/** A named seed profile — each profile has its own master seed + wallet list. */
export type SeedProfile = {
  id      : string;   // unique, e.g. "default" or "p_1234567890"
  label   : string;   // user-facing name, e.g. "Main Wallet", "Base Wallet"
  address : string;   // first wallet address (for display in profile switcher)
};

export type WalletEntry = {
  index  : number;
  label  : string;    // User-given name like "Main", "Trading", "Savings"
  address: string;    // HNY_<40hex>
  // publicKeyB64 is no longer populated for ML-DSA-65 wallets — address is stored directly.
  publicKeyB64?: string;
  chrysalis?: ChrysalisPublicKeys;
};

export type WalletList = {
  wallets     : WalletEntry[];
  activeIndex : number;
  nextWalletIdx?: number;
};

/** Full ML-DSA-65 keypair for a HIVE wallet — private key never stored. */
export type HiveMLDSAKeypair = {
  publicKey: Uint8Array;  // 1952 bytes
  secretKey: Uint8Array;  // 4032 bytes
  address  : string;      // HNY_<40hex>
};

// ── ML-DSA-65 key derivation ───────────────────────────────────────────────────
// Domain: "HIVE_WALLET_DSA_v1" — distinct from Chrysalis "CHRYSALIS_DSA_v1_"
const HIVE_DSA_DOMAIN = new TextEncoder().encode("HIVE_WALLET_DSA_v1");

function deriveHiveMLDSAKeypair(masterSeedB64: string, index: number): HiveMLDSAKeypair {
  const masterSeed = b64ToU8(masterSeedB64);
  // HKDF-SHA3-256: 32-byte keygen seed
  const info    = concat(HIVE_DSA_DOMAIN, indexBytes(index));
  const seed32  = hkdf(sha3_256, masterSeed, undefined, info, 32);
  const { publicKey, secretKey } = ml_dsa65.keygen(seed32);
  const address = mldsaPubKeyToAddress(publicKey);
  return { publicKey, secretKey, address };
}

/** Derive wallet address from ML-DSA-65 public key: HNY_<hex(sha3_256(pk))[0:40]> */
function mldsaPubKeyToAddress(publicKey: Uint8Array): string {
  const hash = sha3_256(publicKey);
  return `HNY_${bytesToHex(hash).slice(0, 40)}`;
}

// ── Master seed management ─────────────────────────────────────────────────────
export async function getMasterSeed(): Promise<string | null> {
  return await kvGet(MASTER_SEED_KEY);
}
export async function setMasterSeed(seedB64: string): Promise<void> {
  await kvSet(MASTER_SEED_KEY, seedB64);
}

async function ensureMasterSeed(): Promise<string> {
  let seed = await getMasterSeed();
  if (seed) return seed;

  const mnemonic = generateMnemonic();
  const seedBytes = await mnemonicToWalletSeed(mnemonic);
  seed = u8ToB64(seedBytes);
  await kvSet(MNEMONIC_KEY, mnemonic);
  await kvSet(MASTER_SEED_KEY, seed);
  return seed;
}

// ── Mnemonic export / import ───────────────────────────────────────────────────
export async function exportMnemonic(): Promise<string | null> {
  return await kvGet(MNEMONIC_KEY);
}

export async function importFromMnemonic(mnemonic: string): Promise<void> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic phrase. Please check every word and try again.");
  }
  const seedBytes = await mnemonicToWalletSeed(mnemonic);
  const seedB64   = u8ToB64(seedBytes);

  // Write new data FIRST (crash-safe)
  await kvSet(MNEMONIC_KEY, mnemonic.trim().toLowerCase());
  await kvSet(MASTER_SEED_KEY, seedB64);

  // Wipe wallet list so getWallets() rebuilds from new seed
  await kvDel(WALLETS_KEY);
  await kvDel(ACTIVE_INDEX_KEY);
  await kvDel("HIVE_PUBKEY_B64");
  await kvDel("HIVE_PRIVKEY_B64");
  await kvDel("HIVE_WALLET_ID");
}

// ── Wallet list management ─────────────────────────────────────────────────────
async function loadWalletList(): Promise<WalletList> {
  const json = await kvGet(WALLETS_KEY);
  if (json) {
    try { return JSON.parse(json); } catch {}
  }
  return { wallets: [], activeIndex: 0 };
}

async function saveWalletList(list: WalletList): Promise<void> {
  await kvSet(WALLETS_KEY, JSON.stringify(list));
  await kvSet(ACTIVE_INDEX_KEY, String(list.activeIndex));
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getWallets(): Promise<WalletList> {
  let list = await loadWalletList();

  if (list.wallets.length === 0) {
    await createWallet("Main Wallet");
    list = await loadWalletList();
  }

  return list;
}

export async function createWallet(label?: string): Promise<WalletEntry> {
  const seed = await ensureMasterSeed();
  let list = await loadWalletList();

  const maxExisting = list.wallets.reduce((m, w) => Math.max(m, w.index), -1);
  const nextIndex   = Math.max(maxExisting + 1, list.nextWalletIdx ?? 0);
  list.nextWalletIdx = nextIndex + 1;

  const kp      = deriveHiveMLDSAKeypair(seed, nextIndex);
  const entry: WalletEntry = {
    index  : nextIndex,
    label  : label || `Wallet ${nextIndex + 1}`,
    address: kp.address,
  };

  list.wallets.push(entry);
  if (list.wallets.length === 1) list.activeIndex = nextIndex;

  await saveWalletList(list);

  // Write legacy address key so existing code that reads HIVE_WALLET_ID still works
  if (list.wallets.length === 1 || list.activeIndex === nextIndex) {
    await kvSet("HIVE_WALLET_ID", kp.address);
  }

  return entry;
}

export async function switchWallet(index: number): Promise<WalletEntry> {
  const list  = await loadWalletList();
  const entry = list.wallets.find(w => w.index === index);
  if (!entry) throw new Error(`Wallet index ${index} not found`);

  list.activeIndex = index;
  await saveWalletList(list);
  await kvSet("HIVE_WALLET_ID", entry.address);
  return entry;
}

export async function getActiveWallet(): Promise<WalletEntry | null> {
  const list = await getWallets();
  return list.wallets.find(w => w.index === list.activeIndex) || list.wallets[0] || null;
}

/** Re-derive the ML-DSA-65 keypair for a wallet index. Private key never stored. */
export async function getHiveMLDSAKeypairForIndex(index: number): Promise<HiveMLDSAKeypair> {
  const seed = await ensureMasterSeed();
  return deriveHiveMLDSAKeypair(seed, index);
}

/** Get the ML-DSA-65 keypair for the currently active wallet. */
export async function getActiveHiveMLDSAKeypair(): Promise<HiveMLDSAKeypair | null> {
  const wallet = await getActiveWallet();
  if (!wallet) return null;
  return getHiveMLDSAKeypairForIndex(wallet.index);
}

export async function renameWallet(index: number, newLabel: string): Promise<void> {
  const list  = await loadWalletList();
  const entry = list.wallets.find(w => w.index === index);
  if (entry) {
    entry.label = newLabel;
    await saveWalletList(list);
  }
}

export async function getSeedFingerprint(): Promise<string> {
  const seed      = await ensureMasterSeed();
  const seedBytes = b64ToU8(seed);
  const hash      = await sha256Expo(seedBytes);
  return Array.from(hash.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function deleteWallet(index: number): Promise<void> {
  const list = await loadWalletList();
  if (list.wallets.length <= 1) throw new Error("Cannot delete the only wallet");

  list.nextWalletIdx = Math.max(list.nextWalletIdx ?? 0, index + 1);
  list.wallets       = list.wallets.filter(w => w.index !== index);

  if (list.activeIndex === index) {
    list.activeIndex = list.wallets[0].index;
  }

  await saveWalletList(list);

  const active = list.wallets.find(w => w.index === list.activeIndex) || list.wallets[0];
  if (active) await kvSet("HIVE_WALLET_ID", active.address);
}

// ── Chrysalis key helpers ──────────────────────────────────────────────────────
export async function getChrysalisKeypairForIndex(index: number) {
  const seed = await ensureMasterSeed();
  return deriveChrysalisKeys(seed, index);
}

export async function getChrysalisPublicKeysForIndex(index: number): Promise<ChrysalisPublicKeys> {
  const bundle = await getChrysalisKeypairForIndex(index);
  return chrysalisPublicKeys(bundle);
}

export async function getActiveChrysalisPublicKeys(): Promise<ChrysalisPublicKeys | null> {
  const list   = await getWallets();
  const active = list.wallets.find(w => w.index === list.activeIndex) || list.wallets[0];
  if (!active) return null;
  return getChrysalisPublicKeysForIndex(active.index);
}

// ── Multi-profile seed support ─────────────────────────────────────────────────
// Allows the user to maintain multiple independent seed phrases (e.g. a HIVE
// native wallet AND an imported Base/MetaMask wallet) and switch between them.
// Each profile stores its full wallet state under a namespaced key.

function profileSlotKey(id: string): string {
  return `HIVE_SLOT_${id}`;
}

type ProfileSlot = {
  masterSeedB64: string;
  mnemonic     : string;
  walletsJson  : string;
  activeIdx    : string;
};

async function saveCurrentToProfile(id: string, label: string, address: string): Promise<void> {
  const slot: ProfileSlot = {
    masterSeedB64: (await kvGet(MASTER_SEED_KEY))  || "",
    mnemonic     : (await kvGet(MNEMONIC_KEY))     || "",
    walletsJson  : (await kvGet(WALLETS_KEY))      || "[]",
    activeIdx    : (await kvGet(ACTIVE_INDEX_KEY)) || "0",
  };
  await kvSet(profileSlotKey(id), JSON.stringify(slot));

  const metas: SeedProfile[] = JSON.parse((await kvGet(PROFILES_KEY)) || "[]");
  const existing = metas.findIndex(p => p.id === id);
  const entry: SeedProfile = { id, label, address };
  if (existing >= 0) metas[existing] = entry;
  else metas.push(entry);
  await kvSet(PROFILES_KEY, JSON.stringify(metas));
}

async function restoreProfileSlot(id: string): Promise<void> {
  const raw = await kvGet(profileSlotKey(id));
  if (!raw) throw new Error(`Profile "${id}" not found`);
  const slot: ProfileSlot = JSON.parse(raw);
  await kvSet(MASTER_SEED_KEY,  slot.masterSeedB64);
  await kvSet(MNEMONIC_KEY,     slot.mnemonic);
  await kvSet(WALLETS_KEY,      slot.walletsJson);
  await kvSet(ACTIVE_INDEX_KEY, slot.activeIdx);
  await kvSet(ACTIVE_PROFILE_KEY, id);
  // Sync legacy key
  const list: WalletList = JSON.parse(slot.walletsJson || "[]");
  const wallets = (list as any).wallets ?? [];
  const active  = wallets.find((w: WalletEntry) => w.index === parseInt(slot.activeIdx, 10)) || wallets[0];
  if (active) await kvSet("HIVE_WALLET_ID", active.address);
}

/** Return the list of available seed profiles. */
export async function getProfiles(): Promise<SeedProfile[]> {
  const raw = await kvGet(PROFILES_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** Return the ID of the currently active profile (defaults to "default"). */
export async function getActiveProfileId(): Promise<string> {
  return (await kvGet(ACTIVE_PROFILE_KEY)) || "default";
}

/**
 * Switch to a different seed profile.
 * Saves the current wallet state first so it can be restored later.
 */
export async function switchProfile(id: string): Promise<void> {
  // Persist the current state back into its own slot
  const currentId = await getActiveProfileId();
  const currentSeed = await kvGet(MASTER_SEED_KEY);
  if (currentSeed) {
    const list = await loadWalletList();
    const active = list.wallets.find(w => w.index === list.activeIndex) || list.wallets[0];
    await saveCurrentToProfile(currentId, active?.label || "Wallet", active?.address || "");
  }
  await restoreProfileSlot(id);
}

/**
 * Import a mnemonic as a brand-new seed profile without destroying the current one.
 * The existing wallet is saved as a named profile and can be restored via switchProfile().
 */
export async function importAsNewProfile(mnemonic: string, label: string = "Imported Wallet"): Promise<void> {
  // 1. Save the current seed profile before overwriting anything
  const currentId   = await getActiveProfileId();
  const currentSeed = await kvGet(MASTER_SEED_KEY);
  if (currentSeed) {
    const list = await loadWalletList();
    const active = list.wallets.find(w => w.index === list.activeIndex) || list.wallets[0];
    await saveCurrentToProfile(currentId, active?.label || "Wallet", active?.address || "");
  }

  // 2. Run the standard import (replaces main keys)
  await importFromMnemonic(mnemonic);

  // 3. Derive the first wallet address from the new seed (for profile display)
  const newSeed = await kvGet(MASTER_SEED_KEY);
  let newAddress = "";
  if (newSeed) {
    try {
      const kp = deriveHiveMLDSAKeypair(newSeed, 0);
      newAddress = kp.address;
    } catch {}
  }

  // 4. Save the new seed as a named profile and activate it
  const newId = `p_${Date.now()}`;
  // getWallets() will auto-create "Main Wallet" entry from the new seed
  const newList = await getWallets();
  const newActive = newList.wallets[0];
  await saveCurrentToProfile(newId, label, newActive?.address || newAddress);
  await kvSet(ACTIVE_PROFILE_KEY, newId);
}

// ── EVM Address Derivation ─────────────────────────────────────────────────

/**
 * Return the full 64-byte BIP39 seed (PBKDF2-HMAC-SHA512 output) as base64.
 *
 * MetaMask and all standard EVM HD wallets use the full 64-byte seed with
 * HDKey.fromMasterSeed().  wallet-manager stores only the first 32 bytes for
 * HIVE's HKDF derivation, so we must re-derive from the mnemonic here.
 * Falls back to the stored 32-byte seed when no mnemonic is available.
 */
export async function getEvmSeed(): Promise<string> {
  const mnemonic = await kvGet(MNEMONIC_KEY);
  if (mnemonic) {
    const { mnemonicToMasterSeed } = await import("./bip39");
    const fullSeed = await mnemonicToMasterSeed(mnemonic);
    return u8ToB64(fullSeed);
  }
  // Fallback: no mnemonic stored — use the 32-byte slice (won't match MetaMask)
  const seed = await getMasterSeed();
  if (!seed) throw new Error("No master seed found");
  return seed;
}

/**
 * Derive the EVM (Base / Ethereum) address for the currently active seed.
 * Uses BIP44 path m/44'/60'/0'/0/{index} (standard Ethereum derivation).
 * Returns a checksummed 0x address.
 */
export async function getEvmAddress(index: number = 0): Promise<string> {
  const evmSeed = await getEvmSeed();
  const { deriveEvmKeypair } = await import("./evm-wallet");
  const { address } = deriveEvmKeypair(evmSeed, index);
  return address;
}

// Re-exports
export { chrysalisFingerprint };
export { MNEMONIC_KEY };
