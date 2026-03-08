// Typed chrome.storage wrappers for the HIVE Wallet extension

import type { ExtState, WalletProfile, NetworkConfig } from './types';

// ── Storage keys ─────────────────────────────────────────────
const KEY_STATE           = 'hive_ext_state';
const KEY_SEED            = 'hive_encrypted_seed';     // legacy single-wallet seed
const KEY_SESSION         = 'hive_session_seed';       // session: raw seed b64
const KEY_SESSION_PASS    = 'hive_session_pass';       // session: unlock password (cleared on lock)
const KEY_PROFILES        = 'hive_profiles';           // WalletProfile[]
const KEY_ACTIVE_PROFILE  = 'hive_active_profile';     // string id
const KEY_CUSTOM_NETS     = 'hive_custom_networks';    // NetworkConfig[]
const KEY_ACTIVE_NETWORK  = 'hive_active_network';     // string id

// ── Low-level helpers ─────────────────────────────────────────
function chromeGet<T>(area: chrome.storage.StorageArea, key: string): Promise<T | undefined> {
  return new Promise(resolve => area.get(key, r => resolve(r[key] as T | undefined)));
}
function chromeSet(area: chrome.storage.StorageArea, key: string, value: unknown): Promise<void> {
  return new Promise(resolve => area.set({ [key]: value }, resolve));
}
function chromeRemove(area: chrome.storage.StorageArea, key: string): Promise<void> {
  return new Promise(resolve => area.remove(key, resolve));
}

// ── Extension state (persisted) ──────────────────────────────
export async function getExtState(): Promise<ExtState | undefined> {
  return chromeGet<ExtState>(chrome.storage.local, KEY_STATE);
}
export async function setExtState(state: ExtState): Promise<void> {
  return chromeSet(chrome.storage.local, KEY_STATE, state);
}

// ── Encrypted seed blob (legacy + active profile) ────────────
export async function getEncryptedSeed(): Promise<string | undefined> {
  return chromeGet<string>(chrome.storage.local, KEY_SEED);
}
export async function setEncryptedSeed(blob: string): Promise<void> {
  return chromeSet(chrome.storage.local, KEY_SEED, blob);
}

// ── Session seed ─────────────────────────────────────────────
export async function getSessionSeed(): Promise<string | undefined> {
  if (!chrome.storage.session) return undefined;
  return chromeGet<string>(chrome.storage.session, KEY_SESSION);
}
export async function setSessionSeed(seedB64: string): Promise<void> {
  if (!chrome.storage.session) return;
  return chromeSet(chrome.storage.session, KEY_SESSION, seedB64);
}
export async function clearSessionSeed(): Promise<void> {
  if (!chrome.storage.session) return;
  return chromeRemove(chrome.storage.session, KEY_SESSION);
}

// ── Session password (cleared on lock / browser close) ───────
export async function getSessionPassword(): Promise<string | undefined> {
  if (!chrome.storage.session) return undefined;
  return chromeGet<string>(chrome.storage.session, KEY_SESSION_PASS);
}
export async function setSessionPassword(password: string): Promise<void> {
  if (!chrome.storage.session) return;
  return chromeSet(chrome.storage.session, KEY_SESSION_PASS, password);
}
export async function clearSessionPassword(): Promise<void> {
  if (!chrome.storage.session) return;
  return chromeRemove(chrome.storage.session, KEY_SESSION_PASS);
}

// ── Wallet profiles ───────────────────────────────────────────
export async function getProfiles(): Promise<WalletProfile[]> {
  return (await chromeGet<WalletProfile[]>(chrome.storage.local, KEY_PROFILES)) ?? [];
}
export async function setProfiles(profiles: WalletProfile[]): Promise<void> {
  return chromeSet(chrome.storage.local, KEY_PROFILES, profiles);
}
export async function getActiveProfileId(): Promise<string | undefined> {
  return chromeGet<string>(chrome.storage.local, KEY_ACTIVE_PROFILE);
}
export async function setActiveProfileId(id: string): Promise<void> {
  return chromeSet(chrome.storage.local, KEY_ACTIVE_PROFILE, id);
}

// ── Custom networks ───────────────────────────────────────────
export async function getCustomNetworks(): Promise<NetworkConfig[]> {
  return (await chromeGet<NetworkConfig[]>(chrome.storage.local, KEY_CUSTOM_NETS)) ?? [];
}
export async function setCustomNetworks(nets: NetworkConfig[]): Promise<void> {
  return chromeSet(chrome.storage.local, KEY_CUSTOM_NETS, nets);
}
export async function getActiveNetworkId(): Promise<string | undefined> {
  return chromeGet<string>(chrome.storage.local, KEY_ACTIVE_NETWORK);
}
export async function setActiveNetworkId(id: string): Promise<void> {
  return chromeSet(chrome.storage.local, KEY_ACTIVE_NETWORK, id);
}

// ── Full wipe (factory reset) ─────────────────────────────────
export async function clearAll(): Promise<void> {
  const keys = [KEY_STATE, KEY_SEED, KEY_PROFILES, KEY_ACTIVE_PROFILE, KEY_CUSTOM_NETS, KEY_ACTIVE_NETWORK];
  await Promise.all(keys.map(k => chromeRemove(chrome.storage.local, k)));
  await clearSessionSeed();
  await clearSessionPassword();
}

// ── Serialize / deserialize Uint8Array ↔ base64 ──────────────
export function seedToB64(seed: Uint8Array): string {
  return btoa(String.fromCharCode(...seed));
}
export function b64ToSeed(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
