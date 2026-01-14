const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

/* ======================
   BASIC SETUP
====================== */
app.use(cors());
app.use(express.json()); // ✅ REQUIRED for JSON POST bodies

/* ======================
   CONFIG
====================== */
const MINT_AMOUNT = 100;
const MINT_COOLDOWN_MS = 60 * 1000; // 1 minute

/* ======================
   IN-MEMORY STATE
====================== */
const balances = {};
const transactions = [];
const mintCooldowns = {};

/* ======================
   HELPERS
====================== */
function now() {
  return Date.now();
}

function normalizeWallet(body) {
  // ✅ Accept BOTH address and wallet (client-safe)
  return body?.wallet || body?.address || null;
}

function createTx({ type, from = null, to, amount }) {
  return {
    id: crypto.randomUUID(),
    hash: crypto
      .createHash("sha256")
      .update(`${now()}-${Math.random()}`)
      .digest("hex"),
    type,
    from,
    to,
    amount,
    gasFee: 0.000001,
    status: "confirmed",
    timestamp: now(),
  };
}

function addTx(tx) {
  transactions.unshift(tx);
}

function getBalance(wallet) {
  return balances[wallet] || 0;
}

/* ======================
   ROUTES
====================== */

/* Health check */
app.get("/", (_req, res) => {
  res.json({ status: "HIVE Wallet server running" });
});

/* ----------------------
   BALANCE
---------------------- */

/* Get balance (GET /balance/:wallet) */
app.get("/balance/:wallet", (req, res) => {
  const wallet = req.params.wallet;

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }

  res.json({
    wallet,
    balance: getBalance(wallet),
  });
});

/* Get balance (POST /balance) ✅ Added for web client compatibility */
app.post("/balance", (req, res) => {
  const wallet = normalizeWallet(req.body);

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet/address" });
  }

  res.json({
    wallet,
    balance: getBalance(wallet),
  });
});

/* ----------------------
   TRANSACTIONS
---------------------- */

/* Get transactions (GET /transactions/:wallet) */
app.get("/transactions/:wallet", (req, res) => {
  const wallet = req.params.wallet;

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }

  const txs = transactions.filter((tx) => tx.from === wallet || tx.to === wallet);

  res.json(txs);
});

/* Get transactions (POST /transactions) ✅ Added for web client compatibility */
app.post("/transactions", (req, res) => {
  const wallet = normalizeWallet(req.body);

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet/address" });
  }

  const txs = transactions.filter((tx) => tx.from === wallet || tx.to === wallet);

  res.json(txs);
});

/* ----------------------
   MINT
---------------------- */

/* Mint (POST /mint) */
app.post("/mint", (req, res) => {
  const wallet = normalizeWallet(req.body);

  if (!wallet) {
    return res.status(400).json({
      error: "Missing wallet/address",
    });
  }

  const lastMint = mintCooldowns[wallet] || 0;
  const remaining = lastMint + MINT_COOLDOWN_MS - now();

  if (remaining > 0) {
    const cooldownSeconds = Math.ceil(remaining / 1000);

    // ✅ Optional but recommended: standard header for rate limiting
    res.set("Retry-After", String(cooldownSeconds));

    return res.status(429).json({
      error: "Cooldown active",
      cooldownSeconds,
    });
  }

  balances[wallet] = getBalance(wallet) + MINT_AMOUNT;
  mintCooldowns[wallet] = now();

  const tx = createTx({
    type: "mint",
    to: wallet,
    amount: MINT_AMOUNT,
  });

  addTx(tx);

  res.json({
    success: true,
    wallet,
    balance: balances[wallet],
    tx,
    cooldownSeconds: Math.ceil(MINT_COOLDOWN_MS / 1000),
  });
});

/* ----------------------
   SEND
---------------------- */

/* Send (POST /send) */
app.post("/send", (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || amount === undefined || amount === null) {
    return res.status(400).json({
      error: "Missing from, to, or amount",
    });
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({
      error: "Amount must be a positive number",
    });
  }

  if (getBalance(from) < amt) {
    return res.status(400).json({
      error: "Insufficient balance",
    });
  }

  balances[from] = getBalance(from) - amt;
  balances[to] = getBalance(to) + amt;

  const tx = createTx({
    type: "send",
    from,
    to,
    amount: amt,
  });

  addTx(tx);

  res.json({
    success: true,
    tx,
    fromBalance: balances[from],
    toBalance: balances[to],
  });
});

/* ======================
   GLOBAL ERROR HANDLER
====================== */
app.use((err, _req, res, _next) => {
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

/* ======================
   START SERVER
====================== */
app.listen(PORT, () => {
  console.log(`🚀 HIVE Wallet server running on http://localhost:${PORT}`);
});
