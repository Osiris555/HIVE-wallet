import nacl from "tweetnacl";
import * as naclUtil from "tweetnacl-util";

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

// IMPORTANT: must be your backend
const API_BASE = "http://192.168.0.11:3000";

// ---- simple key storage ----
// Web: localStorage
// Native: in-memory (works for now; later we’ll use SecureStore/Keychain)
const KEY_STORAGE_PRIV = "HIVE_PRIVKEY_B64";
const KEY_STORAGE_PUB = "HIVE_PUBKEY_B64";

let memPrivB64: string | null = null;
let memPubB64: string | null = null;

function isWeb() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getStored(key: string) {
  if (isWeb()) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  return null;
}

function setStored(key: string, value: string) {
  if (isWeb()) {
    try { window.localStorage.setItem(key, value); } catch {}
  }
}

function b64ToU8(b64: string) {
  return naclUtil.decodeBase64(b64);
}
function u8ToB64(u8: Uint8Array) {
  return naclUtil.encodeBase64(u8);
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

// ---- key management ----
export async function ensureKeypair(): Promise<{ publicKeyB64: string; secretKeyB64: string }> {
  // load
  let pub = isWeb() ? getStored(KEY_STORAGE_PUB) : memPubB64;
  let priv = isWeb() ? getStored(KEY_STORAGE_PRIV) : memPrivB64;

  if (pub && priv) return { publicKeyB64: pub, secretKeyB64: priv };

  // generate new
  const kp = nacl.sign.keyPair();
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

export async function registerWallet(wallet: string): Promise<any> {
  const { publicKeyB64 } = await ensureKeypair();
  return await postJson("/register", { wallet, publicKey: publicKeyB64 });
}

export async function getAccount(wallet: string): Promise<{ wallet: string; balance: number; nonce: number; registered: boolean }> {
  return await getJson(`/account/${encodeURIComponent(wallet)}`);
}

export async function getChainStatus(): Promise<ChainStatus> {
  return await getJson("/status");
}

export async function getBalance(wallet: string): Promise<{ wallet: string; balance: number }> {
  if (!wallet) throw makeError("Missing wallet", 400);
  return await getJson(`/balance/${encodeURIComponent(wallet)}`);
}

export async function getTransactions(wallet: string): Promise<Transaction[]> {
  if (!wallet) throw makeError("Missing wallet", 400);
  return await getJson(`/transactions/${encodeURIComponent(wallet)}`);
}

// ---- signed tx calls ----
function signMessage(message: string, secretKeyB64: string) {
  const msgBytes = naclUtil.decodeUTF8(message);
  const sk = b64ToU8(secretKeyB64);
  const sig = nacl.sign.detached(msgBytes, sk);
  return u8ToB64(sig);
}

export async function mint(wallet: string): Promise<any> {
  if (!wallet) throw makeError("Missing wallet", 400);

  // Ensure wallet registered
  const acct = await getAccount(wallet);
  if (!acct.registered) await registerWallet(wallet);

  // fetch nonce again (in case it changed)
  const acct2 = await getAccount(wallet);
  const nonce = acct2.nonce;
  const timestamp = Date.now();
  const amount = 100;

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalMessage({ type: "mint", from: "", to: wallet, amount, nonce, timestamp });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/mint", { wallet, nonce, timestamp, signature });
}

export async function send(from: string, to: string, amount: number): Promise<any> {
  if (!from || !to) throw makeError("Missing from/to", 400);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be a positive number", 400);

  // Ensure sender registered
  const acct = await getAccount(from);
  if (!acct.registered) await registerWallet(from);

  const acct2 = await getAccount(from);
  const nonce = acct2.nonce;
  const timestamp = Date.now();

  const { secretKeyB64 } = await ensureKeypair();
  const msg = canonicalMessage({ type: "send", from, to, amount: amt, nonce, timestamp });
  const signature = signMessage(msg, secretKeyB64);

  return await postJson("/send", { from, to, amount: amt, nonce, timestamp, signature });
}
