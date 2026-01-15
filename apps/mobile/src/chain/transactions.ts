// apps/mobile/src/chain/transactions.ts
import nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

export type TxType = "mint" | "send";

export type Transaction = {
  id: string;
  hash: string;
  type: TxType;
  from: string | null;
  to: string;
  amount: number;
  gasFee?: number;
  status?: "pending" | "confirmed" | "failed";
  failReason?: string | null;
  blockHeight?: number | null;
  blockHash?: string | null;
  nonce?: number;
  expiresAtMs?: number | null;
  timestamp: number;
};

export type ChainStatus = {
  chainId: string;
  chainHeight: number;
  lastBlockTimeMs: number;
  blockTimeMs: number;
  msUntilNextBlock: number;
  mempoolSize: number;
  latestBlock: any;
};

const API_BASE = "http://192.168.0.11:3000";

// defaults (server enforces anyway)
const DEFAULT_GAS_FEE = 0.000001;
const DEFAULT_TX_TTL_MS = 60 * 1000;

const KEY_STORAGE_PRIV = "HIVE_PRIVKEY_B64";
const KEY_STORAGE_PUB = "HIVE_PUBKEY_B64";
const WALLET_STORAGE = "HIVE_WALLET_ID";

function isWeb() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function kvGet(key: string): Promise<string | null> {
  if (isWeb()) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

async function kvSet(key: string, value: string): Promise<void> {
  if (isWeb()) {
    try { window.localStorage.setItem(key, value); } catch {}
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
 * ✅ must match server canonicalSignedMessage()
 */
function canonicalSignedMessage(params: {
  chainId: string;
  type: TxType;
  from?: string | null;
  to?: string;
  amount: number;
  nonce: number;
  gasFee: number;
  expiresAtMs: number;
  timestamp: number;
}) {
  return [
    String(params.chainId),
    String(params.type),
    String(params.from ?? ""),
    String(params.to ?? ""),
    String(params.amount),
    String(params.nonce),
    String(params.gasFee),
    String(params.expiresAtMs),
    String(params.timestamp),
  ].join("|");
}

async function readJsonSafe(res: Response) {
  try { return await res.json(); } catch { return null; }
}

function makeError(message: string, status?: number, data?: any) {
  const err: any = new Error(message || "Request failed");
  err.status = status;
  err.data = data;
  return err;
}

async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: "GET" });
  const body = await readJsonSafe(res);
  if (!res.ok) throw makeError(body?.error || `GET ${path} failed`, res.status, body);
  return body;
}

async function postJson(path: string, payload: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

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

export async function ensureKeypair(): Promise<{ publicKeyB64: string; secretKeyB64: string }> {
  const pub = await kvGet(KEY_STORAGE_PUB);
  const priv = await kvGet(KEY_STORAGE_PRIV);
  if (pub && priv) return { publicKeyB64: pub, secretKeyB64: priv };

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

export async function getChainStatus(): Promise<ChainStatus> {
  return await getJson("/status");
}

export async function getAccount(wallet: string) {
  return await getJson(`/account/${encodeURIComponent(wallet)}`);
}

export async function getBalance(wallet: string) {
  return await getJson(`/balance/${encodeURIComponent(wallet)}`);
}

export async function getTransactions(wallet: string): Promise<Transaction[]> {
  return await getJson(`/transactions/${encodeURIComponent(wallet)}`);
}

function signMessage(message: string, secretKeyB64: string) {
  const msgBytes = naclUtil.decodeUTF8(message);
  const sk = b64ToU8(secretKeyB64);
  const sig = nacl.sign.detached(msgBytes, sk);
  return u8ToB64(sig);
}

export async function mint(): Promise<any> {
  const wallet = await ensureWalletId();

  // pull chainId from server status (single source of truth)
  const status = await getChainStatus();
  const chainId = String(status?.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct = await getAccount(wallet);
  if (!acct.registered) await registerWallet();

  const acct2 = await getAccount(wallet);
  const nonce = acct2.nonce;

  const timestamp = Date.now();
  const amount = 100;

  const gasFee = DEFAULT_GAS_FEE;
  const expiresAtMs = timestamp + DEFAULT_TX_TTL_MS;

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "mint",
    from: "",
    to: wallet,
    amount,
    nonce,
    gasFee,
    expiresAtMs,
    timestamp,
  });

  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/mint", { chainId, wallet, nonce, timestamp, signature, gasFee, expiresAtMs });
}

export async function send(to: string, amount: number): Promise<any> {
  const from = await ensureWalletId();

  const status = await getChainStatus();
  const chainId = String(status?.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct = await getAccount(from);
  if (!acct.registered) await registerWallet();

  const acct2 = await getAccount(from);
  const nonce = acct2.nonce;

  const timestamp = Date.now();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be positive", 400);

  const gasFee = DEFAULT_GAS_FEE;
  const expiresAtMs = timestamp + DEFAULT_TX_TTL_MS;

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalSignedMessage({
    chainId,
    type: "send",
    from,
    to,
    amount: amt,
    nonce,
    gasFee,
    expiresAtMs,
    timestamp,
  });

  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/send", { chainId, from, to, amount: amt, nonce, timestamp, signature, gasFee, expiresAtMs });
}
