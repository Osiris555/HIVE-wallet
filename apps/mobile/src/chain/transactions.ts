// apps/mobile/src/chain/transactions.ts
import nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";

// Keep in sync with apps/mobile/honey-dev/server.js
export type TxType = "mint" | "send" | "stake" | "unlock" | "claim" | "unstake" | "token_send" | "swap";

export type Transaction = {
  id: string;
  hash: string;
  type: TxType;
  from: string | null;
  to: string;
  amount: number;
  nonce?: number;
  gasFee?: number;
  serviceFee?: number;
  totalFee?: number;
  status?: "pending" | "confirmed" | "failed";
  failReason?: string | null;
  blockHeight?: number | null;
  blockHash?: string | null;
  expiresAtMs?: number | null;
  timestamp: number;
};

export type StakingPosition = {
  id: string;
  wallet: string;
  principal: number;
  lockDays: number;
  startMs: number;
  unlockAtMs: number;
  // server supports: staked | unlocking | unstaked
  status: "staked" | "unlocking" | "unstaked";
  rewardAccrued: number;
  rewardPaid: number;
  unstakedAtMs?: number | null;
  stakeTxId?: string | null;
  unstakeTxId?: string | null;
  // legacy field kept for UI compatibility
  canUnstake: boolean;
};

// NOTE: Boost/Cancel support
// - rbfReplacePending replaces an existing *pending* send with the same nonce ("RBF" style).
// - cancelPending replaces an existing *pending* send with a self-send (net 0 amount), paying only fees.

export type ChainStatus = {
  chainId: string;
  chainHeight: number;
  lastBlockTimeMs: number;
  blockTimeMs: number;
  msUntilNextBlock: number;
  mempoolSize: number;
  latestBlock: any;
  minGasFee: number;
  txTtlMs: number;
  serviceFeeRate: number;
  feeVaultBalance?: number;
};

export const ONE_SAT = 0.00000001;

export function fmt8(n: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00000000";
  return x.toFixed(8);
}

function isWeb() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function stripHost(input: string): string {
  // Accept:
  //  - 192.168.0.20:8081
  //  - http://192.168.0.20:8081
  //  - http://192.168.0.20:8081/...
  //  - 192.168.0.20
  const s = String(input || "").trim();
  if (!s) return "";
  try {
    // If it looks like a URL, parse it.
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      return u.hostname;
    }
  } catch {
    // fall through
  }
  // Remove any path/query
  const noPath = s.split("/")[0].split("?")[0];
  // Remove port
  return noPath.split(":")[0];
}

function resolveApiBase(): string {
  const fromExtra = ((Constants.expoConfig?.extra as any)?.HIVE_API_BASE as string | undefined) ||
    ((Constants.manifest as any)?.extra?.HIVE_API_BASE as string | undefined);
  const fromEnv = process.env.EXPO_PUBLIC_HIVE_API_BASE as string | undefined;
  const explicit = fromExtra || fromEnv;
  // Respect explicit base unless it's a localhost URL on a physical device
  // (localhost would point at the phone itself, not your dev machine).
  if (explicit) {
    const isLocalhost = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(String(explicit).trim());
    const isDevice = !!(Constants as any)?.isDevice;
    if (!isDevice || !isLocalhost || Platform.OS === "web") return explicit;
    // Fall through to auto-detect a LAN host.
  }

  // Web: use localhost unless overridden.
  if (isWeb()) return "http://localhost:3000";

  // Native: derive host from Expo dev server / bundle URL.
  let host = "";

  // Expo Go / dev clients (varies by SDK): debuggerHost or hostUri
  const dbgHost =
    (Constants.expoConfig as any)?.hostUri ||
    (Constants.manifest as any)?.debuggerHost ||
    (Constants.manifest2 as any)?.extra?.expoGo?.debuggerHost ||
    (Constants.manifest2 as any)?.extra?.expoClient?.hostUri;
  if (dbgHost) host = stripHost(String(dbgHost));

  // Fallback: parse bundle URL (works even when manifest fields are missing)
  if (!host) {
    const scriptURL = (NativeModules as any)?.SourceCode?.scriptURL as string | undefined;
    if (scriptURL) host = stripHost(scriptURL);
  }

  // Extra fallback: Expo linking URI often contains the LAN host even when manifest fields don't.
  if (!host) {
    const linkingUri = (Constants as any)?.linkingUri as string | undefined;
    if (linkingUri) host = stripHost(linkingUri);
  }

  // Extra fallback: RN packager hostname (sometimes injected in dev)
  if (!host) {
    const packagerHost = (process.env as any)?.REACT_NATIVE_PACKAGER_HOSTNAME as string | undefined;
    if (packagerHost) host = stripHost(packagerHost);
  }

  // Simulator sometimes can use localhost; physical devices generally cannot.
  if (!host) host = "localhost";
  if (host === "127.0.0.1") host = "localhost";

  // If we landed on localhost while running on a physical device, this is almost certainly wrong.
  // Keep it (so errors surface), but make the mistake explicit for easier debugging.
  if ((Constants as any)?.isDevice && host === "localhost") {
    // eslint-disable-next-line no-console
    console.warn(
      "[HIVE] API_BASE resolved to localhost on a physical device. " +
        "Set EXPO_PUBLIC_HIVE_API_BASE or HIVE_API_BASE in app config to your LAN IP (e.g. http://192.168.1.10:3000)."
    );
  }

  // If we ended up with localhost on a physical device, calls will fail. Keep it,
  // but include a helpful hint in the error surfaces (handled by callers).
  return `http://${host}:3000`;
}

// Allow runtime override (helpful on iOS physical devices when Expo runs in tunnel mode).
let API_BASE = resolveApiBase();

export function getApiBase() {
  return API_BASE;
}

export function setApiBase(next: string) {
  const v = String(next || "").trim();
  if (!v) return;
  API_BASE = v;
}

export function resetApiBase() {
  API_BASE = resolveApiBase();
  return API_BASE;
}

const KEY_STORAGE_PRIV = "HIVE_PRIVKEY_B64";
const KEY_STORAGE_PUB = "HIVE_PUBKEY_B64";
const WALLET_STORAGE = "HIVE_WALLET_ID";

// --- Address + amount validation helpers ---
// Adjust these to your chain’s actual address format.
// Right now: we enforce hex-like strings with a minimum length and optional prefix.

export function validateRecipientAddress(addr: string): { ok: boolean; reason?: string } {
  const a = String(addr || "").trim();

  // Accept HNY_<40 hex>
  // Allow case-insensitive prefix, but require underscore
  const m = a.match(/^hny_([0-9a-fA-F]{40})$/i);
  if (!m) {
    return { ok: false, reason: "Recipient address format must be HNY_<40 hex>." };
  }

  // Normalize to uppercase prefix + lowercase hex (canonical)
  // (optional: you can return this normalized string if you want)
  return { ok: true };
}

// Normalize and validate an amount string to 8 decimals max
export function parseAmount8(amountText: string): { ok: boolean; value?: number; reason?: string } {
  const raw = String(amountText || "").trim();

  if (!raw) return { ok: false, reason: "Amount is required." };

  // Reject commas/spaces
  if (/[,\s]/.test(raw)) return { ok: false, reason: "Amount must not contain spaces or commas." };

  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, reason: "Amount is not a valid number." };
  if (n <= 0) return { ok: false, reason: "Amount must be greater than 0." };

  // Enforce 8 decimal places max
  const parts = raw.split(".");
  if (parts[1] && parts[1].length > 8) {
    return { ok: false, reason: "Amount supports up to 8 decimal places." };
  }

  // Normalize to 8 decimals but keep as number for current code
  const normalized = Number(n.toFixed(8));
  if (normalized <= 0) return { ok: false, reason: "Amount is too small." };

  return { ok: true, value: normalized };
}

/**
 * Preflight checks before quote/sign/broadcast.
 * Pass spendable balance + computed fees from your UI.
 */
export function preflightSend(args: {
  to: string;
  amountText: string;
  spendableBalance: number;
  minGasFee: number;
  serviceFeeRate: number;
  chosenGasFee: number; // the gas fee you plan to use (after multiplier)
}) {
  const toCheck = validateRecipientAddress(args.to);
  if (!toCheck.ok) return { ok: false as const, reason: toCheck.reason };

  const amtCheck = parseAmount8(args.amountText);
  if (!amtCheck.ok) return { ok: false as const, reason: amtCheck.reason };

  const amount = Number(amtCheck.value || 0);
  const serviceFee = computeServiceFee(amount, args.serviceFeeRate);
  const gasFee = Number((args as any).chosenGasFee ?? (args as any).chosenGas ?? 0);

  if (!Number.isFinite(gasFee) || gasFee < args.minGasFee) {
    return { ok: false as const, reason: `Gas fee must be at least ${args.minGasFee}.` };
  }

  const totalCost = Number((amount + gasFee + serviceFee).toFixed(8));

  if (!Number.isFinite(args.spendableBalance)) {
    return { ok: false as const, reason: "Spendable balance unavailable." };
  }

  if (totalCost > args.spendableBalance) {
    return {
      ok: false as const,
      reason: `Insufficient spendable balance. Need ${totalCost} (amount+fees).`,
    };
  }

  return {
    ok: true as const,
    amount,
    gasFee,
    serviceFee,
    totalCost,
  };
}

async function kvGet(key: string): Promise<string | null> {
  if (isWeb()) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: string): Promise<void> {
  if (isWeb()) {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } catch {}
}

function b64ToU8(b64: string) {
  return naclUtil.decodeBase64(b64);
}
function u8ToB64(u8: Uint8Array) {
  return naclUtil.encodeBase64(u8);
}

async function randomBytes(count: number): Promise<Uint8Array> {
  const bytes = await Crypto.getRandomBytesAsync(count);
  return Uint8Array.from(bytes);
}

/**
 * MUST match server:
 * chainId|type|from|to|amount|nonce|gasFee|serviceFee|expiresAtMs|timestamp|metaJson
 */
function canonicalSignedMessage(params: {
  chainId: string;
  type: TxType;
  from?: string | null;
  to?: string;
  amount: number;
  nonce: number;
  gasFee: number;
  serviceFee: number;
  expiresAtMs: number;
  timestamp: number;
  metaJson?: string | null;
}) {
  return [
    String(params.chainId),
    String(params.type),
    String(params.from ?? ""),
    String(params.to ?? ""),
    fmt8(params.amount),
    String(params.nonce),
    fmt8(params.gasFee),
    fmt8(params.serviceFee),
    String(params.expiresAtMs),
    String(params.timestamp),
    String(params.metaJson ?? ""),
  ].join("|");
}

async function readJsonSafe(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function makeError(message: string, status?: number, data?: any) {
  const err: any = new Error(message || "Request failed");
  err.status = status;
  err.data = data;
  return err;
}

async function getJson(path: string) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: "GET" });
  } catch (e: any) {
    throw makeError(`Network error on GET ${path}. API_BASE=${API_BASE}`, 0, { cause: String(e?.message || e) });
  }
  const body = await readJsonSafe(res);
  if (!res.ok) throw makeError(body?.error || `GET ${path} failed`, res.status, body);
  return body;
}

async function postJson(path: string, payload: any) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
  } catch (e: any) {
    throw makeError(`Network error on POST ${path}. API_BASE=${API_BASE}`, 0, { cause: String(e?.message || e) });
  }

  const body = await readJsonSafe(res);

  if (res.status === 429) {
    const err: any = makeError(body?.error || "Rate limited", 429, body);
    err.cooldownSeconds = body?.cooldownSeconds ?? 60;
    throw err;
  }
  if (res.status === 409) {
    const err: any = makeError(body?.error || "Nonce mismatch", 409, body);
    err.expectedNonce = body?.expectedNonce;
    err.gotNonce = body?.gotNonce;
    throw err;
  }
  if (!res.ok) throw makeError(body?.error || `POST ${path} failed`, res.status, body);

  return body;
}

async function getByWalletFlexible(route: string, wallet: string) {
  const w = encodeURIComponent(wallet);
  try {
    return await getJson(`/${route}/${w}`);
  } catch (e1: any) {
    try {
      return await getJson(`/${route}?wallet=${w}`);
    } catch (e2: any) {
      throw makeError(e2?.message || e1?.message || `${route} failed`, e2?.status || e1?.status || 500);
    }
  }
}

export async function ensureKeypair(): Promise<{ publicKeyB64: string; secretKeyB64: string }> {
  // First check legacy storage (fast path - wallet-manager keeps these updated)
  const pub = await kvGet(KEY_STORAGE_PUB);
  const priv = await kvGet(KEY_STORAGE_PRIV);
  if (pub && priv) return { publicKeyB64: pub, secretKeyB64: priv };

  // Fall back: let wallet-manager initialize and write legacy keys
  try {
    const { getWallets, getKeypairForIndex } = require("./wallet-manager");
    const list = await getWallets();
    const active = list.wallets.find((w: any) => w.index === list.activeIndex) || list.wallets[0];
    if (active) {
      const kp = await getKeypairForIndex(active.index);
      await kvSet(KEY_STORAGE_PUB, kp.publicKeyB64);
      await kvSet(KEY_STORAGE_PRIV, kp.secretKeyB64);
      await kvSet(WALLET_STORAGE, active.address);
      return kp;
    }
  } catch (e) {
    console.warn("wallet-manager fallback failed, generating fresh keypair:", e);
  }

  // Last resort: generate fresh keypair
  const seed = await randomBytes(32);
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const pubB64 = u8ToB64(kp.publicKey);
  const privB64 = u8ToB64(kp.secretKey);
  await kvSet(KEY_STORAGE_PUB, pubB64);
  await kvSet(KEY_STORAGE_PRIV, privB64);
  return { publicKeyB64: pubB64, secretKeyB64: privB64 };
}

export async function registerWallet(): Promise<{ wallet: string; nonce: number; registered: boolean; chainId: string }> {
  const { publicKeyB64 } = await ensureKeypair();
  const res = await postJson("/register", { publicKey: publicKeyB64 });

  const wallet = String(res?.wallet || "");
  if (!wallet) throw makeError("Register did not return a wallet", 500, res);

  await kvSet(WALLET_STORAGE, wallet);
  return res;
}

export async function ensureWalletId(): Promise<string> {
  const stored = await kvGet(WALLET_STORAGE);
  if (stored) return stored;
  const reg = await registerWallet();
  return reg.wallet;
}

/**
 * Ensures the wallet is registered on the server and returns the correct wallet address.
 * Call this before any signed transaction to prevent "missing public key" errors.
 */
export async function ensureRegisteredWallet(): Promise<string> {
  let wallet = await ensureWalletId();
  const acct = await getAccount(wallet);
  if (!acct?.registered) {
    const regResult = await registerWallet();
    // Re-read wallet in case registration derived a different address
    wallet = regResult.wallet || await ensureWalletId();
  }
  return wallet;
}

export async function getChainStatus(): Promise<ChainStatus> {
  return await getJson(`/status`);
}

export async function getAccount(wallet: string) {
  return await getByWalletFlexible("account", wallet);
}

export async function getBalance(wallet: string) {
  return await getByWalletFlexible("balance", wallet);
}

export async function getTransactions(wallet: string): Promise<Transaction[]> {
  const out = await getByWalletFlexible("transactions", wallet);
  if (Array.isArray(out)) return out;
  return out?.transactions || out?.txs || [];
}

function signMessage(message: string, secretKeyB64: string) {
  const msgBytes = naclUtil.decodeUTF8(message);
  const sk = b64ToU8(secretKeyB64);
  const sig = nacl.sign.detached(msgBytes, sk);
  return u8ToB64(sig);
}

export async function getTransactionById(txid: string): Promise<any> {
  const id = String(txid || "").trim();
  if (!id) throw makeError("Missing txid", 400);
  return await getJson(`/tx/${encodeURIComponent(id)}`);
}

export function computeServiceFee(amount: number, rate?: number) {
  // Use deterministic decimal math (BigInt) to avoid float drift across JS engines (Hermes vs V8),
  // which can break signature checks on the server when serviceFee must match exactly.
  const rRaw = Number(rate);
  const r = Number.isFinite(rRaw) && rRaw > 0 ? rRaw : 0.00005; // 0.005% default

  // Convert a decimal number to "sat" BigInt using 8-decimal fixed formatting.
  const dec8ToSat = (n: number): bigint => {
    const s = fmt8(n); // always "A.BBBBBBBB"
    const [a, b] = s.split(".");
    return BigInt((a || "0") + (b || "").padEnd(8, "0"));
  };

  const amountSat = dec8ToSat(Number(amount) || 0);
  const rateScaled = dec8ToSat(Number(r) || 0); // rate scaled by 1e8

  // feeSat = round(amountSat * rateScaled / 1e8)
  const numerator = amountSat * rateScaled;
  const feeSat = (numerator + 50_000_000n) / 100_000_000n;

  return Number(feeSat) / 1e8;
}

function computeStakingRewardClient(principal: number, startMs: number, endMs: number, apr: number) {
  const p = Number(principal);
  const s = Number(startMs);
  const e = Number(endMs);
  const a = Number(apr);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  const r = p * (Number.isFinite(a) ? a : 0) * ((e - s) / yearMs);
  return Number(r.toFixed(8));
}

export async function quoteSend(to: string, amount: number) {
  const status = await getChainStatus();
  const minGas = Number(status.minGasFee || ONE_SAT) || ONE_SAT;
  const serviceFee = computeServiceFee(amount, status.serviceFeeRate);
  const totalFee = Number((minGas + serviceFee).toFixed(8));
  const totalCost = Number((amount + totalFee).toFixed(8));

  return {
    chainId: status.chainId,
    gasFee: minGas,
    minGasFee: minGas,
    serviceFee,
    totalFee,
    totalCost,
    status,
  };
}

export async function getStakingPositions(wallet?: string): Promise<{ positions: StakingPosition[]; apr: number }> {
  const w = wallet || (await ensureWalletId());
  // Prefer query-style (some RN iOS / proxy combos dislike path params)
  let body: any;
  try {
    body = await getJson(`/staking/positions?wallet=${encodeURIComponent(w)}`);
  } catch {
    body = await getJson(`/staking/positions/${encodeURIComponent(w)}`);
  }
  return { positions: (body?.positions || []) as StakingPosition[], apr: Number(body?.apr || 0) };
}

export async function stake(params: { amount: number; lockDays: number; gasFee?: number; serviceFee?: number }): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct2 = await getAccount(wallet);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const amt = Number(params.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be positive", 400);
  const lockDays = Number(params.lockDays);
  if (!Number.isInteger(lockDays) || lockDays <= 0) throw makeError("Invalid lockDays", 400);

  const gasFee = Number(params.gasFee ?? status.minGasFee ?? ONE_SAT) || ONE_SAT;
  const serviceFee = Number(params.serviceFee ?? 0);
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const metaJson = JSON.stringify({ lockDays });
  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "stake",
    from: wallet,
    to: "HNY_STAKE_VAULT",
    amount: amt,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
    metaJson,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/stake", {
    chainId,
    wallet,
    amount: amt,
    lockDays,
    nonce,
    timestamp,
    signature,
    gasFee,
    serviceFee,
    expiresAtMs,
  });
}

export async function unstake(params: { positionId: string; gasFee?: number }): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  const chainStatus = await getChainStatus();
  const chainId = String(chainStatus.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, chainStatus);

  const acct2 = await getAccount(wallet);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const positionId = String(params.positionId || "").trim();
  if (!positionId) throw makeError("Missing positionId", 400);

  const gasFee = Number(params.gasFee ?? chainStatus.minGasFee ?? ONE_SAT) || ONE_SAT;
  const serviceFee = 0;
  const expiresAtMs = timestamp + Number(chainStatus.txTtlMs || 60000);

  // Server requires signed amount to match its computed payout.
  // Compute payout deterministically using the same timestamp we sign with.
  const { positions, apr } = await getStakingPositions(wallet);
  const pos: any = positions.find((p) => p.id === positionId);
  const principal = Number(pos?.principal || 0);
  const startMs = Number(pos?.startMs || 0);
  const rewardsFrozenAtMs = pos?.rewardsFrozenAtMs == null ? null : Number(pos?.rewardsFrozenAtMs);
  const rewardPaid = Number(pos?.rewardPaid || 0);
  const posStatus = String(pos?.status || "");

  // If unlocking, rewards freeze at rewardsFrozenAtMs.
  const rewardEnd = posStatus === "unlocking" ? Number(rewardsFrozenAtMs || timestamp) : timestamp;
  const totalReward = computeStakingRewardClient(principal, startMs, rewardEnd, Number(apr || 0));
  const remainingReward = Number(Math.max(0, totalReward - rewardPaid).toFixed(8));
  const payout = Number((principal + remainingReward).toFixed(8));
  if (!Number.isFinite(payout) || payout <= 0) throw makeError("Unable to compute unstake payout", 500, pos);

  const metaJson = JSON.stringify({ positionId });
  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "unstake",
    from: wallet,
    to: wallet,
    amount: payout,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
    metaJson,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/unstake", {
    chainId,
    wallet,
    positionId,
    nonce,
    timestamp,
    signature,
    gasFee,
    expiresAtMs,
  });
}

export async function unlockStakePosition(params: { positionId: string; gasFee?: number }): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct2 = await getAccount(wallet);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const positionId = String(params.positionId || "").trim();
  if (!positionId) throw makeError("Missing positionId", 400);

  const gasFee = Number(params.gasFee ?? status.minGasFee ?? ONE_SAT) || ONE_SAT;
  const serviceFee = 0;
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const metaJson = JSON.stringify({ positionId });
  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "unlock",
    from: wallet,
    to: wallet,
    amount: 0,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
    metaJson,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/staking/unlock", {
    chainId,
    wallet,
    positionId,
    nonce,
    timestamp,
    signature,
    gasFee,
    expiresAtMs,
  });
}

// Back-compat alias used by UI
export const unlockStake = unlockStakePosition;

export async function claimStakingReward(params: { positionId: string; gasFee?: number }): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  const chainStatus = await getChainStatus();
  const chainId = String(chainStatus.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, chainStatus);

  const acct2 = await getAccount(wallet);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const positionId = String(params.positionId || "").trim();
  if (!positionId) throw makeError("Missing positionId", 400);

  const gasFee = Number(params.gasFee ?? chainStatus.minGasFee ?? ONE_SAT) || ONE_SAT;
  const expiresAtMs = timestamp + Number(chainStatus.txTtlMs || 60000);

  // Sign an amount that the server can recompute deterministically.
  // We compute claimable using the same timestamp we sign with.
  const { positions, apr } = await getStakingPositions(wallet);
  const pos: any = positions.find((p) => p.id === positionId);
  const principal = Number(pos?.principal || 0);
  const startMs = Number(pos?.startMs || 0);
  const rewardsFrozenAtMs = pos?.rewardsFrozenAtMs == null ? null : Number(pos?.rewardsFrozenAtMs);
  const rewardPaid = Number(pos?.rewardPaid || 0);
  const posStatus = String(pos?.status || "");

  const endMs = posStatus === "unlocking" ? Number(rewardsFrozenAtMs || timestamp) : timestamp;
  const totalReward = computeStakingRewardClient(principal, startMs, endMs, Number(apr || 0));
  const claimable = Number(Math.max(0, totalReward - rewardPaid).toFixed(8));
  const amt = Number(claimable.toFixed(8));
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Nothing to claim", 400, { claimable: amt });

  const serviceFee = computeServiceFee(amt, chainStatus.serviceFeeRate);
  const metaJson = JSON.stringify({ positionId });
  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "claim",
    from: wallet,
    to: wallet,
    amount: amt,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
    metaJson,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/staking/claim", {
    chainId,
    wallet,
    positionId,
    amount: amt,
    nonce,
    timestamp,
    signature,
    gasFee,
    serviceFee,
    expiresAtMs,
  });
}

export async function mint(options?: { seedFingerprint?: string }): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct2 = await getAccount(wallet);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const amount = 100;

  const gasFee = Number(status.minGasFee || ONE_SAT) || ONE_SAT;
  const serviceFee = 0;
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "mint",
    from: "",
    to: wallet,
    amount,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
  });

  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/mint", {
    chainId,
    wallet,
    nonce,
    timestamp,
    signature,
    gasFee,
    expiresAtMs,
    seedFingerprint: options?.seedFingerprint || "",
  });
}

export async function send(params: {
  to: string;
  amount: number;
  gasFee: number;
  serviceFee: number;
}): Promise<any> {
  const from = await ensureRegisteredWallet();

  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct2 = await getAccount(from);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const amt = Number(params.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be positive", 400);

  const gasFee = Number(params.gasFee);
  const serviceFee = Number(params.serviceFee);
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "send",
    from,
    to: params.to,
    amount: amt,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
  });

  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/send", {
    chainId,
    from,
    to: params.to,
    amount: amt,
    nonce,
    timestamp,
    signature,
    gasFee,
    serviceFee,
    expiresAtMs,
  });
}

/**
 * Replace an existing pending send (same from + nonce) with a higher-fee version.
 * Server will validate that a pending tx exists and that gasFee increased.
 */
export async function rbfReplacePending(params: {
  to: string;
  amount: number;
  nonce: number;
  gasFee: number;
  serviceFee: number;
}): Promise<any> {
  const from = await ensureRegisteredWallet();

  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const nonce = Number(params.nonce);
  if (!Number.isInteger(nonce) || nonce < 0) throw makeError("Missing/invalid nonce", 400);

  const timestamp = Date.now();
  const amt = Number(params.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be positive", 400);

  const gasFee = Number(params.gasFee);
  const serviceFee = Number(params.serviceFee);
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "send",
    from,
    to: params.to,
    amount: amt,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/rbf", {
    chainId,
    from,
    to: params.to,
    amount: amt,
    nonce,
    timestamp,
    signature,
    gasFee,
    serviceFee,
    expiresAtMs,
  });
}

/**
 * Cancel an existing pending send by replacing it with a self-send (net 0 transfer), paying only fees.
 */
export async function cancelPending(params: { nonce: number; gasFee: number; serviceFee: number }): Promise<any> {
  const from = await ensureRegisteredWallet();

  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const nonce = Number(params.nonce);
  if (!Number.isInteger(nonce) || nonce < 0) throw makeError("Missing/invalid nonce", 400);

  const timestamp = Date.now();
  const amt = ONE_SAT; // self-send dust, net 0 transfer

  const gasFee = Number(params.gasFee);
  const serviceFee = Number(params.serviceFee);
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "send",
    from,
    to: from,
    amount: amt,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/cancel", {
    chainId,
    from,
    nonce,
    timestamp,
    signature,
    gasFee,
    serviceFee,
    expiresAtMs,
  });
}

/* ======================
   MULTI-TOKEN SUPPORT
====================== */

export type Token = {
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
  mockPriceUSD: number;
  iconUrl?: string;
};

export type TokenBalance = {
  [symbol: string]: number;
};

export type TokenInfo = {
  name: string;
  decimals: number;
  price: number;
};

export type SwapQuote = {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  exchangeRate: number;
  priceImpact: number;
  feeRate: number;
  reserveIn: number;
  reserveOut: number;
};

export type LiquidityPool = {
  id: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  totalLpShares: number;
  feeRate: number;
};

// Get all available tokens
export async function getTokens(): Promise<Token[]> {
  const body = await getJson("/tokens");
  return (body?.tokens || []) as Token[];
}

// Get real-time token prices
export async function getTokenPrices(): Promise<{ [symbol: string]: number }> {
  const body = await getJson("/tokens/prices");
  return body?.prices || {};
}

// Get token balances for a wallet
export async function getTokenBalances(
  wallet?: string
): Promise<{ balances: TokenBalance; tokens: { [symbol: string]: TokenInfo } }> {
  const w = wallet || (await ensureWalletId());
  const body = await getJson(`/tokens/balances/${encodeURIComponent(w)}`);
  return {
    balances: body?.balances || {},
    tokens: body?.tokens || {},
  };
}

// Token faucet - mint test tokens
export async function tokenFaucet(params: {
  tokenSymbol: string;
  amount?: number;
  seedFingerprint?: string;
}): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  return await postJson("/tokens/faucet", {
    wallet,
    tokenSymbol: params.tokenSymbol,
    amount: params.amount,
    seedFingerprint: params.seedFingerprint || "",
  });
}

// Send tokens (not HNY)
export async function sendToken(params: {
  to: string;
  tokenSymbol: string;
  amount: number;
  gasFee?: number;
  serviceFee?: number;
}): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct2 = await getAccount(wallet);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const amt = Number(params.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be positive", 400);

  const to = String(params.to || "").trim();
  if (!to) throw makeError("Missing recipient", 400);

  const gasFee = Number(params.gasFee ?? status.minGasFee ?? ONE_SAT) || ONE_SAT;
  const serviceFee = Number(params.serviceFee ?? 0);
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const metaJson = JSON.stringify({ tokenSymbol: params.tokenSymbol, amount: amt });
  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "token_send",
    from: wallet,
    to,
    amount: amt,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
    metaJson,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/tokens/send", {
    chainId,
    wallet,
    to,
    tokenSymbol: params.tokenSymbol,
    amount: amt,
    nonce,
    timestamp,
    signature,
    gasFee,
    serviceFee,
    expiresAtMs,
  });
}

// Get swap quote
export async function getSwapQuote(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
}): Promise<SwapQuote> {
  const body = await postJson("/swap/quote", {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
  });
  
  return {
    poolId: body.poolId,
    tokenIn: body.tokenIn,
    tokenOut: body.tokenOut,
    amountIn: body.amountIn,
    amountOut: body.amountOut,
    exchangeRate: body.exchangeRate,
    priceImpact: body.priceImpact,
    feeRate: body.feeRate,
    reserveIn: body.reserveIn,
    reserveOut: body.reserveOut,
  };
}

// Execute swap
export async function swap(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  minAmountOut?: number;
  gasFee?: number;
  serviceFee?: number;
}): Promise<any> {
  const wallet = await ensureRegisteredWallet();
  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct2 = await getAccount(wallet);
  const nonce = Number(acct2?.nonce ?? 0);

  const timestamp = Date.now();
  const amtIn = Number(params.amountIn);
  if (!Number.isFinite(amtIn) || amtIn <= 0) throw makeError("Amount must be positive", 400);

  const minOut = Number(params.minAmountOut ?? 0);
  
  // Get quote to calculate expected output
  const quote = await getSwapQuote({
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: amtIn,
  });

  const gasFee = Number(params.gasFee ?? status.minGasFee ?? ONE_SAT) || ONE_SAT;
  const serviceFee = Number(params.serviceFee ?? 0);
  const expiresAtMs = timestamp + Number(status.txTtlMs || 60000);

  const metaJson = JSON.stringify({
    poolId: quote.poolId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: amtIn,
    minAmountOut: minOut,
    expectedAmountOut: quote.amountOut,
  });

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "swap",
    from: wallet,
    to: wallet,
    amount: amtIn,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp,
    metaJson,
  });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/swap", {
    chainId,
    wallet,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: amtIn,
    minAmountOut: minOut,
    nonce,
    timestamp,
    signature,
    gasFee,
    serviceFee,
    expiresAtMs,
    metaJson,
  });
}

// Get all liquidity pools
export async function getLiquidityPools(): Promise<LiquidityPool[]> {
  const body = await getJson("/pools");
  return (body?.pools || []) as LiquidityPool[];
}

