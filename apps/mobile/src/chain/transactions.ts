const API_BASE = ""; // if your dev server proxies to backend, keep "".
// Otherwise set: "http://localhost:3000"

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function parseRetryAfterSeconds(res, body) {
  const ra = res.headers.get("retry-after");
  if (ra && !Number.isNaN(Number(ra))) return Number(ra);

  if (body && typeof body === "object") {
    if (typeof body.retryAfterSeconds === "number") return body.retryAfterSeconds;
    if (typeof body.retryAfterMs === "number") return Math.ceil(body.retryAfterMs / 1000);
    if (typeof body.msLeft === "number") return Math.ceil(body.msLeft / 1000);
    if (typeof body.secondsLeft === "number") return body.secondsLeft;
    if (typeof body.cooldownSeconds === "number") return body.cooldownSeconds;
  }
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
    return {
      ok: false,
      status: 429,
      cooldownSeconds,
      message: body?.message || `Cooldown active. Try again in ${cooldownSeconds}s.`,
      data: body,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: body?.message || `Request failed (${res.status})`,
      data: body,
    };
  }

  return { ok: true, status: res.status, message: body?.message || "OK", data: body };
}

export async function mint() {
  return post("/mint");
}

export async function getBalance() {
  return post("/balance");
}

export async function send({ to, amount }) {
  return post("/send", { to, amount });
}

export async function getTransactions() {
  return post("/transactions");
}
