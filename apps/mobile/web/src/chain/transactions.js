// apps/mobile/web/src/chain/transactions.js
const API_BASE = "http://192.168.0.15:3000";

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function makeError(message, status, data) {
  const err = new Error(message || "Request failed");
  err.status = status;
  err.data = data;
  return err;
}

function pickFeeVaultBalance(status) {
  return Number(
    status?.feeVaultBalance ??
      status?.feeVaultBalanceHny ??
      status?.feeVault ??
      0
  );
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: "GET" });
  const body = await readJsonSafe(res);
  if (!res.ok) throw makeError(body?.error || `GET ${path} failed`, res.status, body);
  return body;
}

async function postJson(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readJsonSafe(res);

  if (res.status === 429) {
    const err = makeError(body?.error || "Cooldown active", 429, body);
    err.cooldownSeconds = body?.cooldownSeconds ?? 60;
    throw err;
  }

  if (res.status === 409) {
    const err = makeError(body?.error || "Nonce mismatch", 409, body);
    err.expectedNonce = body?.expectedNonce;
    err.gotNonce = body?.gotNonce;
    throw err;
  }

  if (!res.ok) throw makeError(body?.error || `POST ${path} failed`, res.status, body);

  return body;
}

// ---- exports that the web UI expects ----

export async function getChainStatus() {
  const s = await getJson("/status");
  return { ...s, feeVaultBalance: pickFeeVaultBalance(s) };
}

export async function getAccount(wallet) {
  return await getJson(`/account/${encodeURIComponent(wallet)}`);
}

export async function getBalance(wallet) {
  return await getJson(`/balance/${encodeURIComponent(wallet)}`);
}

export async function getTransactions(wallet) {
  return await getJson(`/transactions/${encodeURIComponent(wallet)}`);
}

export async function register(publicKey) {
  return await postJson("/register", { publicKey });
}

export async function mint(payload) {
  // payload should include { chainId, wallet, nonce, timestamp, signature, gasFee, expiresAtMs }
  return await postJson("/mint", payload ?? {});
}

export async function send(payload) {
  // payload should include { chainId, from, to, amount, nonce, timestamp, signature, gasFee, serviceFee, expiresAtMs }
  return await postJson("/send", payload ?? {});
}
