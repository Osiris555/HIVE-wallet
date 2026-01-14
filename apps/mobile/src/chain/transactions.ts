// apps/mobile/src/chain/transactions.ts
// Canonical API client for both iOS + Expo Web
// Exports: mint, send, getBalance, getTransactions

export type TxType = "mint" | "send";

export type Transaction = {
  id: string;
  hash: string;
  type: TxType;
  from: string | null;
  to: string;
  amount: number;
  gasFee?: number;
  status?: string;
  timestamp: number;
};

// ✅ IMPORTANT: This MUST point to your backend, not Expo (8081).
// Use LAN IP for iOS device testing.
const API_BASE = "http://192.168.0.11:3000";

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
  const res = await fetch(`${API_BASE}${path}`, { method: "GET" });
  const body = await readJsonSafe(res);

  if (!res.ok) {
    throw makeError(body?.error || `GET ${path} failed`, res.status, body);
  }
  return body;
}

async function postJson(path: string, payload: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await readJsonSafe(res);

  // Handle cooldown explicitly
  if (res.status === 429) {
    const err: any = makeError(body?.error || "Cooldown active", 429, body);
    err.cooldownSeconds = body?.cooldownSeconds ?? 60;
    throw err;
  }

  if (!res.ok) {
    throw makeError(body?.error || `POST ${path} failed`, res.status, body);
  }

  return body;
}

/** ✅ getBalance(wallet) -> { wallet, balance } */
export async function getBalance(wallet: string): Promise<{ wallet: string; balance: number }> {
  if (!wallet) throw makeError("Missing wallet", 400);
  return await getJson(`/balance/${encodeURIComponent(wallet)}`);
}

/** ✅ getTransactions(wallet) -> Transaction[] */
export async function getTransactions(wallet: string): Promise<Transaction[]> {
  if (!wallet) throw makeError("Missing wallet", 400);
  return await getJson(`/transactions/${encodeURIComponent(wallet)}`);
}

/** ✅ mint(wallet) -> server response with balance + tx + cooldownSeconds */
export async function mint(wallet: string): Promise<any> {
  if (!wallet) throw makeError("Missing wallet", 400);
  return await postJson("/mint", { wallet });
}

/** ✅ send(from,to,amount) -> server response with tx + balances */
export async function send(from: string, to: string, amount: number): Promise<any> {
  if (!from || !to) throw makeError("Missing from/to", 400);

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw makeError("Amount must be a positive number", 400);

  return await postJson("/send", { from, to, amount: amt });
}
