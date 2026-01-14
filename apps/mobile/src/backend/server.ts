import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

type Tx = {
  id: string;
  type: "mint" | "send";
  from?: string;
  to: string;
  amount: number;
  timestamp: number;
};

const balances: Record<string, number> = {};
const transactions: Tx[] = [];
const faucetCooldown: Record<string, number> = {};

const FAUCET_AMOUNT = 100;
const COOLDOWN_MS = 60_000;

// ---------------- Faucet ----------------
app.post("/faucet", (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: "Missing address" });

  const now = Date.now();
  const last = faucetCooldown[address];

  if (last && now - last < COOLDOWN_MS) {
    return res.status(429).json({
      error: "Cooldown active",
      remainingMs: COOLDOWN_MS - (now - last),
    });
  }

  faucetCooldown[address] = now;
  balances[address] = (balances[address] ?? 0) + FAUCET_AMOUNT;

  const tx: Tx = {
    id: `tx_${now}`,
    type: "mint",
    to: address,
    amount: FAUCET_AMOUNT,
    timestamp: now,
  };

  transactions.unshift(tx);

  console.log("MINT:", tx);

  res.json({
    balance: balances[address],
    tx,
    cooldownMs: COOLDOWN_MS,
  });
});

// ---------------- Send ----------------
app.post("/send", (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || !amount) {
    return res.status(400).json({ error: "Invalid tx" });
  }

  if ((balances[from] ?? 0) < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  balances[from] -= amount;
  balances[to] = (balances[to] ?? 0) + amount;

  const tx: Tx = {
    id: `tx_${Date.now()}`,
    type: "send",
    from,
    to,
    amount,
    timestamp: Date.now(),
  };

  transactions.unshift(tx);

  console.log("SEND:", tx);

  res.json({ tx });
});

// ---------------- Balance ----------------
app.get("/balance/:address", (req, res) => {
  res.json({ balance: balances[req.params.address] ?? 0 });
});

// ---------------- Transactions ----------------
app.get("/transactions/:address", (req, res) => {
  const address = req.params.address;

  const filtered = transactions.filter(
    (tx) => tx.from === address || tx.to === address
  );

  res.json(filtered);
});

app.listen(3333, () => {
  console.log("🟡 HONEY chain running on :3333");
});
