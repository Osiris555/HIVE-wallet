const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

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

// Blocks
const BLOCK_TIME_MS = 5000; // 5 seconds
const MAX_BLOCK_TXS = 500;
const MAX_BLOCKS_STORED = 200;

/* ======================
   IN-MEMORY STATE
====================== */
const balances = {};        // wallet => number
const transactions = [];    // newest-first list of all txs
const mintCooldowns = {};   // wallet => lastMintTimeMs

// Accounts
const publicKeys = {};      // wallet => base64(pubkey 32 bytes)
const nonces = {};          // wallet => next expected nonce (integer)

// Chain state
let chainHeight = 0;
let lastBlockTimeMs = Date.now();
const blocks = [];          // newest-first
const mempool = [];         // txs waiting to be included

/* ======================
   HELPERS
====================== */
function now() {
  return Date.now();
}

function getBalance(wallet) {
  return balances[wallet] || 0;
}

function getNonce(wallet) {
  return Number.isInteger(nonces[wallet]) ? nonces[wallet] : 0;
}

function setNonce(wallet, value) {
  nonces[wallet] = value;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * ✅ Derive wallet address from pubkey (testnet-style)
 * wallet = HNY_<first 40 hex chars of sha256(pubkeyBytes)>
 */
function deriveWalletFromPubKeyB64(pubB64) {
  const pubBytes = naclUtil.decodeBase64(pubB64);
  const hex = sha256Hex(Buffer.from(pubBytes));
  return `HNY_${hex.slice(0, 40)}`;
}

// Canonical signing string must match client exactly
function canonicalMessage({ type, from, to, amount, nonce, timestamp }) {
  return [
    String(type),
    String(from ?? ""),
    String(to ?? ""),
    String(amount),
    String(nonce),
    String(timestamp),
  ].join("|");
}

function verifySignature({ wallet, message, signatureB64 }) {
  const pubB64 = publicKeys[wallet];
  if (!pubB64) return { ok: false, error: "Wallet not registered (missing public key)" };
  if (!signatureB64) return { ok: false, error: "Missing signature" };

  let pubKey, sig;
  try {
    pubKey = naclUtil.decodeBase64(pubB64);      // 32 bytes
    sig = naclUtil.decodeBase64(signatureB64);   // 64 bytes
  } catch {
    return { ok: false, error: "Invalid base64 public key or signature" };
  }

  const msgBytes = naclUtil.decodeUTF8(message);
  const ok = nacl.sign.detached.verify(msgBytes, sig, pubKey);
  if (!ok) return { ok: false, error: "Invalid signature" };
  return { ok: true };
}

function createTx({ type, from = null, to, amount, nonce, timestamp }) {
  const id = crypto.randomUUID();
  const hash = sha256Hex(`${id}:${type}:${from ?? ""}:${to}:${amount}:${nonce}:${timestamp}`);

  return {
    id,
    hash,
    type,
    from,
    to,
    amount,
    nonce,
    gasFee: 0.000001,
    status: "pending",
    blockHeight: null,
    blockHash: null,
    timestamp,
  };
}

function addTx(tx) {
  transactions.unshift(tx);
  mempool.push(tx);
}

function buildBlockFromMempool() {
  const txs = mempool.splice(0, MAX_BLOCK_TXS);
  const height = ++chainHeight;
  const ts = now();

  const header = `${height}:${ts}:${txs.length}:${blocks[0]?.hash || "GENESIS"}`;
  const txRoot = sha256Hex(txs.map((t) => t.hash).join("|"));
  const hash = sha256Hex(`${header}:${txRoot}`);

  const block = {
    height,
    hash,
    timestamp: ts,
    txCount: txs.length,
    txRoot,
    txs: txs.map((t) => t.id),
  };

  for (const tx of txs) {
    tx.status = "confirmed";
    tx.blockHeight = height;
    tx.blockHash = hash;
  }

  blocks.unshift(block);
  if (blocks.length > MAX_BLOCKS_STORED) blocks.length = MAX_BLOCKS_STORED;

  lastBlockTimeMs = ts;
  return block;
}

/* ======================
   BLOCK PRODUCER
====================== */
setInterval(() => {
  buildBlockFromMempool(); // produces empty blocks too
}, BLOCK_TIME_MS);

/* ======================
   ROUTES
====================== */

app.get("/", (_req, res) => {
  res.json({ status: "HIVE Wallet server running" });
});

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

app.get("/blocks", (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
  res.json(blocks.slice(0, limit));
});

/**
 * ✅ Register with publicKey only.
 * Server derives the wallet address from the publicKey.
 */
app.post("/register", (req, res) => {
  const publicKey = req.body?.publicKey; // base64

  if (!publicKey) {
    return res.status(400).json({ error: "Missing publicKey" });
  }

  // Validate: decode to 32 bytes
  try {
    const pk = naclUtil.decodeBase64(publicKey);
    if (pk.length !== 32) throw new Error("bad length");
  } catch {
    return res.status(400).json({ error: "Invalid publicKey (must be base64 32 bytes)" });
  }

  const wallet = deriveWalletFromPubKeyB64(publicKey);

  publicKeys[wallet] = publicKey;
  if (!Number.isInteger(nonces[wallet])) nonces[wallet] = 0;
  if (!Number.isFinite(balances[wallet])) balances[wallet] = getBalance(wallet);

  res.json({
    success: true,
    wallet,
    nonce: getNonce(wallet),
    registered: true,
  });
});

app.get("/account/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  res.json({
    wallet,
    balance: getBalance(wallet),
    nonce: getNonce(wallet),
    registered: !!publicKeys[wallet],
  });
});

app.get("/balance/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  res.json({ wallet, balance: getBalance(wallet) });
});

app.get("/transactions/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  const txs = transactions.filter((tx) => tx.from === wallet || tx.to === wallet);
  res.json(txs);
});

/* ======================
   SIGNED TX ROUTES
====================== */

app.post("/mint", (req, res) => {
  const wallet = req.body?.wallet;          // derived wallet string
  const nonce = req.body?.nonce;
  const timestamp = req.body?.timestamp;
  const signature = req.body?.signature;

  if (!wallet) return res.status(400).json({ error: "Missing wallet" });
  if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
  if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

  const expected = getNonce(wallet);
  if (nonce !== expected) {
    return res.status(409).json({ error: "Nonce mismatch", expectedNonce: expected, gotNonce: nonce });
  }

  const msg = canonicalMessage({
    type: "mint",
    from: "",
    to: wallet,
    amount: MINT_AMOUNT,
    nonce,
    timestamp,
  });

  const sigOk = verifySignature({ wallet, message: msg, signatureB64: signature });
  if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

  const lastMint = mintCooldowns[wallet] || 0;
  const remaining = lastMint + MINT_COOLDOWN_MS - now();
  if (remaining > 0) {
    const cooldownSeconds = Math.ceil(remaining / 1000);
    res.set("Retry-After", String(cooldownSeconds));
    return res.status(429).json({ error: "Cooldown active", cooldownSeconds });
  }

  // accept: increment nonce
  setNonce(wallet, expected + 1);

  balances[wallet] = getBalance(wallet) + MINT_AMOUNT;
  mintCooldowns[wallet] = now();

  const tx = createTx({
    type: "mint",
    from: null,
    to: wallet,
    amount: MINT_AMOUNT,
    nonce,
    timestamp,
  });

  addTx(tx);

  res.json({
    success: true,
    wallet,
    balance: balances[wallet],
    nonce: getNonce(wallet),
    tx,
    cooldownSeconds: Math.ceil(MINT_COOLDOWN_MS / 1000),
    chainHeight,
  });
});

app.post("/send", (req, res) => {
  const { from, to, amount, nonce, timestamp, signature } = req.body;

  if (!from || !to) return res.status(400).json({ error: "Missing from/to" });

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be a positive number" });
  if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
  if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

  const expected = getNonce(from);
  if (nonce !== expected) {
    return res.status(409).json({ error: "Nonce mismatch", expectedNonce: expected, gotNonce: nonce });
  }

  const msg = canonicalMessage({
    type: "send",
    from,
    to,
    amount: amt,
    nonce,
    timestamp,
  });

  const sigOk = verifySignature({ wallet: from, message: msg, signatureB64: signature });
  if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

  if (getBalance(from) < amt) return res.status(400).json({ error: "Insufficient balance" });

  setNonce(from, expected + 1);

  balances[from] = getBalance(from) - amt;
  balances[to] = getBalance(to) + amt;

  const tx = createTx({
    type: "send",
    from,
    to,
    amount: amt,
    nonce,
    timestamp,
  });

  addTx(tx);

  res.json({
    success: true,
    tx,
    fromBalance: balances[from],
    toBalance: balances[to],
    fromNonce: getNonce(from),
    chainHeight,
  });
});

app.use((err, _req, res, _next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`🚀 HIVE Wallet server running on http://localhost:${PORT}`);
  console.log(`⛓️  Block time: ${BLOCK_TIME_MS}ms`);
});
