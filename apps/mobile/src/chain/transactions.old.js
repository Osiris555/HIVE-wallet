// apps/mobile/src/chain/transactions.js

const API_BASE = "http://192.168.0.11:3000";

/* -----------------------
   Helpers
----------------------- */
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

/* -----------------------
   API FUNCTIONS
   (CANONICAL NAMES)
----------------------- */

export async function getBalance(wallet) {
  if (!wallet) throw makeError("Missing wallet", 400);

  const res = await fetch(
    `${API_BASE}/balance/${encodeURIComponent(wallet)}`
  );

  const body = await readJsonSafe(res);

  if (!res.ok) {
    throw makeError(body?.error || "Balance fetch failed", res.status, body);
  }

  return body; // { wallet, balance }
}

export async function mint(wallet) {
  if (!wallet) throw makeError("Missing wallet", 400);

  const res = await fetch(`${API_BASE}/mint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });

  const body = await readJsonSafe(res);

  if (res.status === 429) {
    const err = makeError(body?.error || "Cooldown active", 429, body);
    err.cooldownSeconds = body?.cooldownSeconds ?? 60;
    throw err;
  }

  if (!res.ok) {
    throw makeError(body?.error || "Mint failed", res.status, body);
  }

  return body;
  // { success, wallet, balance, tx, cooldownSeconds }
}

export async function send(from, to, amount) {
  if (!from || !to) throw makeError("Missing from/to", 400);

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw makeError("Amount must be a positive number", 400);
  }

  const res = await fetch(`${API_BASE}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, amount: amt }),
  });

  const body = await readJsonSafe(res);

  if (!res.ok) {
    throw makeError(body?.error || "Send failed", res.status, body);
  }

  return body;
  // { success, tx, fromBalance, toBalance }
}

export async function getTransactions(wallet) {
  if (!wallet) throw makeError("Missing wallet", 400);

  const res = await fetch(
    `${API_BASE}/transactions/${encodeURIComponent(wallet)}`
  );

  const body = await readJsonSafe(res);

  if (!res.ok) {
    throw makeError(
      body?.error || "Transaction fetch failed",
      res.status,
      body
    );
  }

  return body; // tx[]
}
