// apps/mobile/src/chain/wallet-manager.ts
// Multi-wallet support: derive multiple wallets from a single master seed
import nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

// ── Storage helpers (same as transactions.ts) ──
let SecureStore: any = null;
try { SecureStore = require("expo-secure-store"); } catch {}
let AsyncStorage: any = null;
try { AsyncStorage = require("@react-native-async-storage/async-storage"); } catch {}

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

// ── Crypto helpers ──
function u8ToB64(u8: Uint8Array): string { return naclUtil.encodeBase64(u8); }
function b64ToU8(b64: string): Uint8Array { return naclUtil.decodeBase64(b64); }

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    Array.from(data).map(b => b.toString(16).padStart(2, "0")).join(""),
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

// ── Storage keys ──
const MASTER_SEED_KEY = "HIVE_MASTER_SEED_B64";
const WALLETS_KEY = "HIVE_WALLETS_JSON";
const ACTIVE_INDEX_KEY = "HIVE_ACTIVE_WALLET_IDX";

// ── Types ──
export type WalletEntry = {
  index: number;
  label: string;      // User-given name like "Main", "Trading", "Savings"
  address: string;     // HNY_<40hex>
  publicKeyB64: string;
  // secretKey is NOT stored in the list — derived on demand from seed + index
};

export type WalletList = {
  wallets: WalletEntry[];
  activeIndex: number;
};

// ── Seed derivation ──
// Derive a child keypair from master seed + index
// Uses: SHA256(masterSeed || "HIVE_WALLET" || index_bytes) → 32-byte child seed → Ed25519 keypair
async function deriveKeypair(masterSeedB64: string, index: number): Promise<{
  publicKeyB64: string;
  secretKeyB64: string;
}> {
  const masterSeed = b64ToU8(masterSeedB64);
  
  // Concatenate: masterSeed + "HIVE_WALLET" + 4-byte big-endian index
  const tag = new TextEncoder().encode("HIVE_WALLET");
  const idxBytes = new Uint8Array(4);
  idxBytes[0] = (index >> 24) & 0xff;
  idxBytes[1] = (index >> 16) & 0xff;
  idxBytes[2] = (index >> 8) & 0xff;
  idxBytes[3] = index & 0xff;
  
  const combined = new Uint8Array(masterSeed.length + tag.length + 4);
  combined.set(masterSeed, 0);
  combined.set(tag, masterSeed.length);
  combined.set(idxBytes, masterSeed.length + tag.length);
  
  const childSeed = await sha256(combined);
  const kp = nacl.sign.keyPair.fromSeed(childSeed);
  
  return {
    publicKeyB64: u8ToB64(kp.publicKey),
    secretKeyB64: u8ToB64(kp.secretKey),
  };
}

// Derive wallet address from public key (same as server: SHA256 of pubkey bytes)
async function pubKeyToAddress(publicKeyB64: string): Promise<string> {
  const pubBytes = b64ToU8(publicKeyB64);
  const hash = await sha256(pubBytes);
  const hex = Array.from(hash).map(b => b.toString(16).padStart(2, "0")).join("");
  return `HNY_${hex.slice(0, 40)}`;
}

// ── Master seed management ──
export async function getMasterSeed(): Promise<string | null> {
  return await kvGet(MASTER_SEED_KEY);
}

export async function setMasterSeed(seedB64: string): Promise<void> {
  await kvSet(MASTER_SEED_KEY, seedB64);
}

async function ensureMasterSeed(): Promise<string> {
  let seed = await getMasterSeed();
  if (seed) return seed;
  
  // Generate new 32-byte master seed using expo-crypto (works on all platforms)
  let seedBytes: Uint8Array;
  try {
    // expo-crypto's getRandomBytes is available on all platforms
    const randomHex = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${Date.now()}-${Math.random()}-${Math.random()}-${Math.random()}`,
      { encoding: Crypto.CryptoEncoding.HEX }
    );
    seedBytes = new Uint8Array(randomHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  } catch {
    // Fallback
    seedBytes = nacl.randomBytes(32);
  }
  seed = u8ToB64(seedBytes);
  await setMasterSeed(seed);
  return seed;
}

// ── Wallet list management ──
async function loadWalletList(): Promise<WalletList> {
  const json = await kvGet(WALLETS_KEY);
  if (json) {
    try {
      return JSON.parse(json);
    } catch {}
  }
  return { wallets: [], activeIndex: 0 };
}

async function saveWalletList(list: WalletList): Promise<void> {
  await kvSet(WALLETS_KEY, JSON.stringify(list));
  await kvSet(ACTIVE_INDEX_KEY, String(list.activeIndex));
}

// ── Public API ──

/**
 * Get all wallets. If none exist, creates the first one.
 */
export async function getWallets(): Promise<WalletList> {
  let list = await loadWalletList();
  
  if (list.wallets.length === 0) {
    // First run: check if there's a legacy keypair and migrate it,
    // or create wallet index 0
    const legacyPub = await kvGet("HIVE_PUBKEY_B64");
    const legacyPriv = await kvGet("HIVE_PRIVKEY_B64");
    const legacyWallet = await kvGet("HIVE_WALLET_ID");
    
    if (legacyPub && legacyPriv && legacyWallet) {
      const seed = await ensureMasterSeed();
      
      // Derive correct address from public key using SHA256 (matching server)
      const correctAddress = await pubKeyToAddress(legacyPub);
      
      list.wallets.push({
        index: 0,
        label: "Main Wallet",
        address: correctAddress,
        publicKeyB64: legacyPub,
      });
      list.activeIndex = 0;
      await saveWalletList(list);
      
      // Update legacy storage with correct address
      await kvSet("HIVE_WALLET_ID", correctAddress);
      
      // Mark that index 0 uses legacy keys
      await kvSet("HIVE_WALLET_0_IS_LEGACY", "true");
    } else {
      // Fresh start: create master seed and derive wallet 0
      await createWallet("Main Wallet");
      list = await loadWalletList();
    }
  }
  
  // Verify and fix wallet addresses (handles migration from old address derivation)
  let needsSave = false;
  for (const w of list.wallets) {
    if (w.publicKeyB64) {
      const correctAddr = await pubKeyToAddress(w.publicKeyB64);
      if (w.address !== correctAddr) {
        w.address = correctAddr;
        needsSave = true;
      }
    }
  }
  if (needsSave) {
    await saveWalletList(list);
    // Update legacy storage keys for active wallet
    const active = list.wallets.find(w => w.index === list.activeIndex) || list.wallets[0];
    if (active) {
      await kvSet("HIVE_WALLET_ID", active.address);
    }
  }
  
  return list;
}

/**
 * Create a new wallet derived from the master seed.
 * Returns the new wallet entry.
 */
export async function createWallet(label?: string): Promise<WalletEntry> {
  const seed = await ensureMasterSeed();
  let list = await loadWalletList();
  
  // Find next available index
  const usedIndices = new Set(list.wallets.map(w => w.index));
  let nextIndex = 0;
  while (usedIndices.has(nextIndex)) nextIndex++;
  
  const kp = await deriveKeypair(seed, nextIndex);
  const address = await pubKeyToAddress(kp.publicKeyB64);
  
  const entry: WalletEntry = {
    index: nextIndex,
    label: label || `Wallet ${nextIndex + 1}`,
    address,
    publicKeyB64: kp.publicKeyB64,
  };
  
  list.wallets.push(entry);
  
  // If this is the first wallet, set it as active
  if (list.wallets.length === 1) {
    list.activeIndex = nextIndex;
  }
  
  await saveWalletList(list);
  
  // Also write to legacy storage keys so existing code works
  if (list.wallets.length === 1 || list.activeIndex === nextIndex) {
    await kvSet("HIVE_PUBKEY_B64", kp.publicKeyB64);
    await kvSet("HIVE_PRIVKEY_B64", kp.secretKeyB64);
    await kvSet("HIVE_WALLET_ID", address);
  }
  
  return entry;
}

/**
 * Switch to a different wallet by index.
 * Updates the legacy storage keys so existing code works.
 */
export async function switchWallet(index: number): Promise<WalletEntry> {
  const list = await loadWalletList();
  const entry = list.wallets.find(w => w.index === index);
  if (!entry) throw new Error(`Wallet index ${index} not found`);
  
  list.activeIndex = index;
  await saveWalletList(list);
  
  // Get the keypair for this wallet
  const kp = await getKeypairForIndex(index);
  
  // Update legacy storage keys
  await kvSet("HIVE_PUBKEY_B64", kp.publicKeyB64);
  await kvSet("HIVE_PRIVKEY_B64", kp.secretKeyB64);
  await kvSet("HIVE_WALLET_ID", entry.address);
  
  return entry;
}

/**
 * Get the keypair for a specific wallet index.
 */
export async function getKeypairForIndex(index: number): Promise<{
  publicKeyB64: string;
  secretKeyB64: string;
}> {
  // Check if this is the legacy wallet
  const isLegacy = await kvGet(`HIVE_WALLET_${index}_IS_LEGACY`);
  if (isLegacy === "true") {
    const pub = await kvGet("HIVE_PUBKEY_B64");
    const priv = await kvGet("HIVE_PRIVKEY_B64");
    if (pub && priv) return { publicKeyB64: pub, secretKeyB64: priv };
  }
  
  const seed = await ensureMasterSeed();
  return await deriveKeypair(seed, index);
}

/**
 * Get the active wallet entry.
 */
export async function getActiveWallet(): Promise<WalletEntry | null> {
  const list = await getWallets();
  return list.wallets.find(w => w.index === list.activeIndex) || list.wallets[0] || null;
}

/**
 * Rename a wallet.
 */
export async function renameWallet(index: number, newLabel: string): Promise<void> {
  const list = await loadWalletList();
  const entry = list.wallets.find(w => w.index === index);
  if (entry) {
    entry.label = newLabel;
    await saveWalletList(list);
  }
}

/**
 * Get the master seed identifier (first 8 hex chars of SHA256(seed))
 * Used for faucet rate limiting per seed phrase
 */
export async function getSeedFingerprint(): Promise<string> {
  const seed = await ensureMasterSeed();
  const seedBytes = b64ToU8(seed);
  const hash = await sha256(seedBytes);
  return Array.from(hash.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Delete a wallet by index. Cannot delete the last wallet.
 */
export async function deleteWallet(index: number): Promise<void> {
  const list = await loadWalletList();
  if (list.wallets.length <= 1) throw new Error("Cannot delete the only wallet");
  
  list.wallets = list.wallets.filter(w => w.index !== index);
  
  // If we deleted the active wallet, switch to the first remaining
  if (list.activeIndex === index) {
    list.activeIndex = list.wallets[0].index;
    // Update legacy keys
    const kp = await getKeypairForIndex(list.activeIndex);
    await kvSet("HIVE_PUBKEY_B64", kp.publicKeyB64);
    await kvSet("HIVE_PRIVKEY_B64", kp.secretKeyB64);
    await kvSet("HIVE_WALLET_ID", list.wallets[0].address);
  }
  
  await saveWalletList(list);
}
