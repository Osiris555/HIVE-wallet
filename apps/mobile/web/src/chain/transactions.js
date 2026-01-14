const API_BASE = "http://192.168.0.11:3000"; // or "" if using proxy

async function readJsonSafe(res) {
  try { return await res.json(); } catch { return null; }
}

function parseRetryAfterSeconds(res, body) {
  const ra = res.headers.get("retry-after");
  if (ra && !Number.isNaN(Number(ra))) return Number(ra);
  if (body?.retryAfterSeconds) return body.retryAfterSeconds;
  if (body?.retryAfterMs) return Math.ceil(body.retryAfterMs / 1000);
  if (body?.msLeft) return Math.ceil(body.msLeft / 1000);
  return null;
}

async function post(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : "{}",
  });

  const body = await readJsonSafe(res);

  if (res.status === 429) {
    const cooldownSeconds = parseRetryAfterSeconds(res, body) ?? 30;
    return { ok: false, status: 429, cooldownSeconds, message: body?.message, data: body };
  }
  if (!res.ok) return { ok: false, status: res.status, message: body?.message, data: body };

  return { ok: true, status: res.status, message: body?.message, data: body };
}

export const mint = () => post("/mint");
export const getBalance = () => post("/balance");
export const send = ({ to, amount }) => post("/send", { to, amount });
export const getTransactions = () => post("/transactions");
