import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3333;
const COOLDOWN_MS = 60_000; // 1 minute
const MINT_AMOUNT = 100;

const balances = {};
const lastMint = {};
const transactions = [];

app.post("/faucet", (req, res) => {
  const { address } = req.body;
  if (!address) {
    return res.status(400).json({ error: "Missing address" });
  }

  const now = Date.now();
  const last = lastMint[address] || 0;

  const COOLDOWN_MS = 60_000; // 1 minute

  if (lastMint && Date.now() - lastMint < COOLDOWN_MS) {
    const remaining = Math.ceil(
      (COOLDOWN_MS - (Date.now() - lastMint)) / 1000
    );

    return res.status(429).json({
      error: "Cooldown active",
      remainingSeconds: remaining,
    });
  }


  balances[address] = (balances[address] || 0) + MINT_AMOUNT;
  lastMint[address] = now;

  const tx = {
    id: transactions.length + 1,
    type: "FAUCET",
    to: address,
    amount: MINT_AMOUNT,
    timestamp: now
  };

  transactions.unshift(tx);

  res.json({
    balance: balances[address],
    tx
  });
});

app.get("/balance/:address", (req, res) => {
  const { address } = req.params;
  res.json({ balance: balances[address] || 0 });
});

app.get("/transactions", (req, res) => {
  res.json(transactions);
});

app.listen(PORT, () => {
  console.log(`🚰 Faucet running on http://localhost:${PORT}`);
});
