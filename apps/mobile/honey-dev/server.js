const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

/* ======================
   BASIC SETUP
====================== */
app.use(cors());
app.use(express.json());

/* ======================
   CONFIG
====================== */
const MINT_AMOUNT = 100;
const MINT_COOLDOWN_MS = 60 * 1000; // 1 minute

// ✅ Block production (Option B)
const BLOCK_TIME_MS = 5000; // 5 seconds (tune later)
const MAX_BLOCK_TXS = 500; // safety for demo
const MAX_BLOCKS_STORED = 200; // keep memory bounded

/* ======================
   IN-MEMORY STATE
====================== */
const balances = {};             // wallet => number
const transactions = [];         // newest-first list of all txs
const mintCooldowns = {};        // wallet => lastMintTimeMs

// ✅ Chain state
let chainHeight = 0;             // increments per block
let lastBlockTimeMs = Date.now();
const blocks = [];               // newest-first
const mempool = [];              // txs waiting to be included

/* ======================
   HELPERS
====================== */
function now() {
  return Date.now();
}

function normalizeWallet(body) {
  return body?.wallet || body?.address || null;
}

function getBalance(wallet) {
  return balances[wallet] || 0;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function createTx({ type, from = null, to, amount }) {
  const ts = now();
  const id = crypto.randomUUID();
  const hash = sha256Hex(`${id}:${type}:${from ?? ""}:${to}:${amount}:${ts}:${Math.random()}`);

  return {
    id,
    hash,
    type,
    from,
    to,
    amount,
    gasFee: 0.000001,
    status: "pending",          // ✅ pending until included in a block
    blockHeight: null,          // ✅ set on confirmation
    blockHash: null,            // ✅ set on confirmation
    timestamp: ts,
  };
}

function addTx(tx) {
  // Store globally (newest-first)
  transactions.unshift(tx);
  // Add to mempool for block inclusion
  mempool.push(tx);
}

function buildBlockFromMempool() {
  const txs = mempool.splice(0, MAX_BLOCK_TXS); // take up to MAX_BLOCK_TXS
  const height = ++chainHeight;
  const ts = now();

  // Build a block hash from header + tx hashes
  const header = `${height}:${ts}:${txs.length}:${blocks[0]?.hash || "GENESIS"}`;
  const txRoot = sha256Hex(txs.map((t) => t.hash).join("|"));
  const hash = sha256Hex(`${header}:${txRoot}`);

  const block = {
    height,
    hash,
    timestamp: ts,
    txCount: txs.length,
    txRoot,
    txs: txs.map((t) => t.id), // store ids to keep block light
  };

  // Confirm txs
  for (const tx of txs) {
    tx.status = "confirmed";
    tx.blockHeight = height;
    tx.blockHash = hash;
  }

  // Store newest-first
  blocks.unshift(block);
  if (blocks.length > MAX_BLOCKS_STORED) blocks.length = MAX_BLOCKS_STORED;

  lastBlockTimeMs = ts;
  return block;
}

/* ======================
   BLOCK PRODUCER (Option B)
====================== */
setInterval(() => {
  // Produce empty blocks too (useful for chain height ticking like a real network)
  // If you don't want empty blocks, wrap with: if (mempool.length === 0) return;
  buildBlockFromMempool();
}, BLOCK_TIME_MS);

/* ======================
   ROUTES
====================== */

/* Health check */
app.get("/", (_req, res) => {
  res.json({ status: "HIVE Wallet server running" });
});

/* Chain status */
app.get("/status", (_req, res) => {
  const elapsed = now() - lastBlockTimeMs;
  const msUntilNext = Math.max(0, BLOCK_TIME_MS - (elapsed % BLOCK_TIME_MS));

  res.json({
    chainHeight,
    lastBlockTimeMs,
    blockTimeMs: BLOCK_TIME_MS,
    msUntilNextBlock: msUntilNext,
    mempoolSize: mempool.length,
    latestBlock: blocks[0] || null,
  });
});

/* Recent blocks */
app.get("/blocks", (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
  res.json(blocks.slice(0, limit));
});

/* ----------------------
   BALANCE
---------------------- */

/* Get balance (GET /balance/:wallet) */
app.get("/balance/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  res.json({ wallet, balance: getBalance(wallet) });
});

/* Get balance (POST /balance) */
app.post("/balance", (req, res) => {
  const wallet = normalizeWallet(req.body);
  if (!wallet) return res.status(400).json({ error: "Missing wallet/address" });

  res.json({ wallet, balance: getBalance(wallet) });
});

/* ----------------------
   TRANSACTIONS
---------------------- */

/* Get transactions (GET /transactions/:wallet) */
app.get("/transactions/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  const txs = transactions.filter((tx) => tx.from === wallet || tx.to === wallet);
  res.json(txs);
});

/* Get transactions (POST /transactions) */
app.post("/transactions", (req, res) => {
  const wallet = normalizeWallet(req.body);
  if (!wallet) return res.status(400).json({ error: "Missing wallet/address" });

  const txs = transactions.filter((tx) => tx.from === wallet || tx.to === wallet);
  res.json(txs);
});

/* ----------------------
   MINT
---------------------- */
app.post("/mint", (req, res) => {
  const wallet = normalizeWallet(req.body);

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet/address" });
  }

  const lastMint = mintCooldowns[wallet] || 0;
  const remaining = lastMint + MINT_COOLDOWN_MS - now();

  if (remaining > 0) {
    const cooldownSeconds = Math.ceil(remaining / 1000);
    res.set("Retry-After", String(cooldownSeconds));
    return res.status(429).json({
      error: "Cooldown active",
      cooldownSeconds,
    });
  }

  // Update balance immediately (wallet will show value even while tx pending)
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
    chainHeight,
  });
});

/* ----------------------
   SEND
---------------------- */
app.post("/send", (req, res) => {
  const { from, to, amount } = req.body;

  if (!from || !to || amount === undefined || amount === null) {
    return res.status(400).json({ error: "Missing from, to, or amount" });
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number" });
  }

  if (getBalance(from) < amt) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  // Apply balances immediately (tx will still be pending until block)
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
    chainHeight,
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
  console.log(`⛓️  Block time: ${BLOCK_TIME_MS}ms`);
});
