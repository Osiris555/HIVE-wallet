import nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";
import * as Crypto from "expo-crypto";

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
  blockHeight?: number | null;
  blockHash?: string | null;
  nonce?: number;
  timestamp: number;
};

export type ChainStatus = {
  chainHeight: number;
  lastBlockTimeMs: number;
  blockTimeMs: number;
  msUntilNextBlock: number;
  mempoolSize: number;
  latestBlock: any;
};

const API_BASE = "http://192.168.0.11:3000";

// Web storage (native in-memory for now)
const KEY_STORAGE_PRIV = "HIVE_PRIVKEY_B64";
const KEY_STORAGE_PUB = "HIVE_PUBKEY_B64";
const WALLET_STORAGE = "HIVE_WALLET_ID";

let memPrivB64: string | null = null;
let memPubB64: string | null = null;
let memWallet: string | null = null;

function isWeb() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getStored(key: string) {
  if (!isWeb()) return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function setStored(key: string, value: string) {
  if (!isWeb()) return;
  try { window.localStorage.setItem(key, value); } catch {}
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
 * ✅ Derive wallet from pubkey (must match server)
 */
async function deriveWalletFromPubKeyB64(pubB64: string): Promise<string> {
  const pubBytes = b64ToU8(pubB64);
  // hash bytes -> hex
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    // convert bytes to a latin1-ish string safely:
    String.fromCharCode(...Array.from(pubBytes)),
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  return `HNY_${hex.slice(0, 40)}`;
}

function canonicalMessage(params: {
  type: TxType;
  from?: string | null;
  to?: string;
  amount: number;
  nonce: number;
  timestamp: number;
}) {
  return [
    String(params.type),
    String(params.from ?? ""),
    String(params.to ?? ""),
    String(params.amount),
    String(params.nonce),
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
    const err: any = makeError(body?.error || "Cooldown active", 429, body);
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

/**
 * ✅ Ensure keypair exists
 */
export async function ensureKeypair(): Promise<{ publicKeyB64: string; secretKeyB64: string }> {
  let pub = isWeb() ? getStored(KEY_STORAGE_PUB) : memPubB64;
  let priv = isWeb() ? getStored(KEY_STORAGE_PRIV) : memPrivB64;

  if (pub && priv) return { publicKeyB64: pub, secretKeyB64: priv };

  // generate from secure random seed (native-safe)
  const seed = await randomBytes(32);
  const kp = nacl.sign.keyPair.fromSeed(seed);

  pub = u8ToB64(kp.publicKey);
  priv = u8ToB64(kp.secretKey);

  if (isWeb()) {
    setStored(KEY_STORAGE_PUB, pub);
    setStored(KEY_STORAGE_PRIV, priv);
  } else {
    memPubB64 = pub;
    memPrivB64 = priv;
  }

  return { publicKeyB64: pub, secretKeyB64: priv };
}

/**
 * ✅ Ensure wallet id derived from pubkey and stored
 */
export async function ensureWalletId(): Promise<string> {
  const stored = isWeb() ? getStored(WALLET_STORAGE) : memWallet;
  if (stored) return stored;

  const { publicKeyB64 } = await ensureKeypair();
  const wallet = await deriveWalletFromPubKeyB64(publicKeyB64);

  if (isWeb()) setStored(WALLET_STORAGE, wallet);
  else memWallet = wallet;

  return wallet;
}

/**
 * ✅ Register this device’s wallet/pubkey (no collisions)
 */
export async function registerWallet(): Promise<{ wallet: string; nonce: number; registered: boolean }> {
  const { publicKeyB64 } = await ensureKeypair();
  const res = await postJson("/register", { publicKey: publicKeyB64 });

  // store derived wallet returned by server as source of truth
  const wallet = String(res?.wallet);
  if (isWeb()) setStored(WALLET_STORAGE, wallet);
  else memWallet = wallet;

  return res;
}

export async function getAccount(wallet: string) {
  return await getJson(`/account/${encodeURIComponent(wallet)}`);
}

export async function getChainStatus(): Promise<ChainStatus> {
  return await getJson("/status");
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
  // always operate on derived wallet
  const wallet = await ensureWalletId();

  // ensure registered
  const acct = await getAccount(wallet);
  if (!acct.registered) await registerWallet();

  const acct2 = await getAccount(wallet);
  const nonce = acct2.nonce;
  const timestamp = Date.now();
  const amount = 100;

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalMessage({ type: "mint", from: "", to: wallet, amount, nonce, timestamp });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/mint", { wallet, nonce, timestamp, signature });
}

export async function send(to: string, amount: number): Promise<any> {
  const from = await ensureWalletId();

  const acct = await getAccount(from);
  if (!acct.registered) await registerWallet();

  const acct2 = await getAccount(from);
  const nonce = acct2.nonce;
  const timestamp = Date.now();

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be a positive number", 400);

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalMessage({ type: "send", from, to, amount: amt, nonce, timestamp });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/send", { from, to, amount: amt, nonce, timestamp, signature });
}
