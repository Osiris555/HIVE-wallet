const API_BASE = "http://192.168.0.11:3000";

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function handleResponse(res) {
  const body = await readJsonSafe(res);

  // Your server uses { error: "...", cooldownSeconds: N }
  if (res.status === 429) {
    const cooldownSeconds = body?.cooldownSeconds ?? 60;
    return {
      ok: false,
      status: 429,
      cooldownSeconds,
      message: body?.error || `Cooldown active. Try again in ${cooldownSeconds}s.`,
      data: body,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: body?.error || body?.message || `Request failed (${res.status})`,
      data: body,
    };
  }

  return {
    ok: true,
    status: res.status,
    message: body?.message || "OK",
    data: body,
  };
}

export async function mint(wallet) {
  const res = await fetch(`${API_BASE}/mint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  return handleResponse(res);
}

export async function getBalance(wallet) {
  const res = await fetch(`${API_BASE}/balance/${encodeURIComponent(wallet)}`);
  return handleResponse(res);
}

export async function send({ from, to, amount }) {
  const res = await fetch(`${API_BASE}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, amount }),
  });
  return handleResponse(res);
}

export async function getTransactions(wallet) {
  const res = await fetch(`${API_BASE}/transactions/${encodeURIComponent(wallet)}`);
  return handleResponse(res);
}
