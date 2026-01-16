// apps/mobile/src/chain/transactions.ts
import nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

export type TxType = "mint" | "send";

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

const API_BASE =
  ((Constants.expoConfig?.extra as any)?.HIVE_API_BASE as string | undefined) ||
  (process.env.EXPO_PUBLIC_HIVE_API_BASE as string | undefined) ||
  (isWeb() ? "http://localhost:3000" : "http://192.168.0.11:3000");

const KEY_STORAGE_PRIV = "HIVE_PRIVKEY_B64";
const KEY_STORAGE_PUB = "HIVE_PUBKEY_B64";
const WALLET_STORAGE = "HIVE_WALLET_ID";

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
 * chainId|type|from|to|amount|nonce|gasFee|serviceFee|expiresAtMs|timestamp
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

export function computeServiceFee(amount: number, rate?: number) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return 0;
  return Number((Number(amount) * r).toFixed(8));
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

export async function mint(): Promise<any> {
  const wallet = await ensureWalletId();
  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct = await getAccount(wallet);
  if (!acct?.registered) await registerWallet();

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
  });
}

export async function send(params: {
  to: string;
  amount: number;
  gasFee: number;
  serviceFee: number;
}): Promise<any> {
  const from = await ensureWalletId();

  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct = await getAccount(from);
  if (!acct?.registered) await registerWallet();

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
  const from = await ensureWalletId();

  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct = await getAccount(from);
  if (!acct?.registered) await registerWallet();

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
  const from = await ensureWalletId();

  const status = await getChainStatus();
  const chainId = String(status.chainId || "");
  if (!chainId) throw makeError("Server did not return chainId", 500, status);

  const acct = await getAccount(from);
  if (!acct?.registered) await registerWallet();

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
