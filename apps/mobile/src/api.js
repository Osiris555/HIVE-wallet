import axios from "axios";

const API_BASE = "http://localhost:3000";

export async function getBalance(wallet) {
  const res = await axios.get(`${API_BASE}/balance/${wallet}`);
  return res.data;
}

export async function mint(wallet) {
  try {
    const res = await axios.post(`${API_BASE}/mint`, {
      wallet,
    });
    return { success: true, data: res.data };
  } catch (err) {
    if (err.response?.status === 429) {
      return {
        success: false,
        cooldownSeconds: err.response.data.cooldownSeconds,
      };
    }
    throw err;
  }
}

export async function send(from, to, amount) {
  const res = await axios.post(`${API_BASE}/send`, {
    from,
    to,
    amount,
  });
  return res.data;
}

export async function getTransactions(wallet) {
  const res = await axios.get(`${API_BASE}/transactions/${wallet}`);
  return res.data;
}
