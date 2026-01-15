// apps/mobile/honey-dev/server.js
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

const { openDb, initDb, run, get, all, DB_PATH } = require("./db");

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
const MAX_BLOCKS_RETURN = 200; // API cap

/* ======================
   DB
====================== */
const db = openDb();

/* ======================
   HELPERS
====================== */
function now() {
  return Date.now();
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Wallet address derived from pubkey bytes (server canonical)
 * wallet = HNY_<first 40 hex chars of sha256(pubkeyBytes)>
 */
function deriveWalletFromPubKeyB64(pubB64) {
  const pubBytes = naclUtil.decodeBase64(pubB64);
  const hex = sha256Hex(Buffer.from(pubBytes));
  return `HNY_${hex.slice(0, 40)}`;
}

// Canonical signing message (must match client)
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

async function ensureAccountExists(wallet) {
  const row = await get(db, `SELECT wallet FROM accounts WHERE wallet = ?`, [wallet]);
  if (row) return;

  await run(
    db,
    `INSERT INTO accounts (wallet, publicKeyB64, balance, nonce, lastMintMs, createdAtMs)
     VALUES (?, NULL, 0, 0, 0, ?)`,
    [wallet, now()]
  );
}

async function getAccount(wallet) {
  await ensureAccountExists(wallet);
  const row = await get(db, `SELECT wallet, publicKeyB64, balance, nonce, lastMintMs FROM accounts WHERE wallet = ?`, [
    wallet,
  ]);
  return row;
}

async function setPubKey(wallet, publicKeyB64) {
  await ensureAccountExists(wallet);
  await run(db, `UPDATE accounts SET publicKeyB64 = ? WHERE wallet = ?`, [publicKeyB64, wallet]);
}

async function updateBalance(wallet, newBalance) {
  await ensureAccountExists(wallet);
  await run(db, `UPDATE accounts SET balance = ? WHERE wallet = ?`, [newBalance, wallet]);
}

async function incrementNonce(wallet) {
  await ensureAccountExists(wallet);
  await run(db, `UPDATE accounts SET nonce = nonce + 1 WHERE wallet = ?`, [wallet]);
}

async function setLastMint(wallet, ms) {
  await ensureAccountExists(wallet);
  await run(db, `UPDATE accounts SET lastMintMs = ? WHERE wallet = ?`, [ms, wallet]);
}

function verifySignature({ walletPubKeyB64, message, signatureB64 }) {
  if (!walletPubKeyB64) return { ok: false, error: "Wallet not registered (missing public key)" };
  if (!signatureB64) return { ok: false, error: "Missing signature" };

  let pubKey, sig;
  try {
    pubKey = naclUtil.decodeBase64(walletPubKeyB64); // 32 bytes
    sig = naclUtil.decodeBase64(signatureB64); // 64 bytes
  } catch {
    return { ok: false, error: "Invalid base64 public key or signature" };
  }

  const msgBytes = naclUtil.decodeUTF8(message);
  const ok = nacl.sign.detached.verify(msgBytes, sig, pubKey);
  if (!ok) return { ok: false, error: "Invalid signature" };
  return { ok: true };
}

function createTx({ type, from = null, to, amount, nonce, timestampMs }) {
  const id = crypto.randomUUID();
  const hash = sha256Hex(`${id}:${type}:${from ?? ""}:${to}:${amount}:${nonce}:${timestampMs}`);

  return {
    id,
    hash,
    type,
    fromWallet: from,
    toWallet: to,
    amount,
    nonce,
    gasFee: 0.000001,
    status: "pending",
    blockHeight: null,
    blockHash: null,
    timestampMs,
  };
}

async function insertTx(tx) {
  await run(
    db,
    `INSERT INTO transactions
     (id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, status, blockHeight, blockHash, timestampMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.id,
      tx.hash,
      tx.type,
      tx.fromWallet,
      tx.toWallet,
      tx.amount,
      tx.nonce,
      tx.gasFee,
      tx.status,
      tx.blockHeight,
      tx.blockHash,
      tx.timestampMs,
    ]
  );
}

/* ======================
   BLOCK PRODUCER (SQLite-backed)
====================== */

async function getLatestBlock() {
  return await get(db, `SELECT height, hash, timestampMs FROM blocks ORDER BY height DESC LIMIT 1`);
}

async function buildBlock() {
  // Select pending txs (mempool) oldest-first, limit MAX_BLOCK_TXS
  const pending = await all(
    db,
    `SELECT id, hash FROM transactions
     WHERE status = 'pending'
     ORDER BY timestampMs ASC
     LIMIT ?`,
    [MAX_BLOCK_TXS]
  );

  const latest = await getLatestBlock();
  const prevHash = latest?.hash || "GENESIS";
  const height = (latest?.height || 0) + 1;
  const ts = now();

  const txIds = pending.map((t) => t.id);
  const txRoot = sha256Hex(pending.map((t) => t.hash).join("|"));
  const header = `${height}:${ts}:${txIds.length}:${prevHash}`;
  const hash = sha256Hex(`${header}:${txRoot}`);

  // Confirm selected txs
  if (txIds.length > 0) {
    // Use a single SQL statement with IN (...) placeholders
    const placeholders = txIds.map(() => "?").join(",");
    await run(
      db,
      `UPDATE transactions
       SET status = 'confirmed', blockHeight = ?, blockHash = ?
       WHERE id IN (${placeholders})`,
      [height, hash, ...txIds]
    );
  }

  // Insert block
  await run(
    db,
    `INSERT INTO blocks (height, hash, prevHash, timestampMs, txCount, txRoot, txIdsJson)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [height, hash, prevHash, ts, txIds.length, txRoot, JSON.stringify(txIds)]
  );

  return { height, hash, timestampMs: ts, txCount: txIds.length, txRoot };
}

let lastBlockTimeMs = now();

async function startBlockProducer() {
  const latest = await getLatestBlock();
  if (latest?.timestampMs) lastBlockTimeMs = latest.timestampMs;

  setInterval(async () => {
    try {
      const block = await buildBlock();
      lastBlockTimeMs = block.timestampMs;
    } catch (e) {
      console.error("BLOCK PRODUCER ERROR:", e);
    }
  }, BLOCK_TIME_MS);
}

/* ======================
   ROUTES
====================== */

app.get("/", (_req, res) => {
  res.json({ status: "HIVE Wallet server running", db: DB_PATH });
});

app.get("/status", async (_req, res) => {
  try {
    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    const elapsed = now() - lastBlockTimeMs;
    const msUntilNext = Math.max(0, BLOCK_TIME_MS - (elapsed % BLOCK_TIME_MS));

    const mempoolSizeRow = await get(db, `SELECT COUNT(*) as c FROM transactions WHERE status = 'pending'`);
    const mempoolSize = mempoolSizeRow?.c || 0;

    res.json({
      chainHeight,
      lastBlockTimeMs,
      blockTimeMs: BLOCK_TIME_MS,
      msUntilNextBlock: msUntilNext,
      mempoolSize,
      latestBlock: latest || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "status failed" });
  }
});

app.get("/blocks", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), MAX_BLOCKS_RETURN));
    const rows = await all(db, `SELECT * FROM blocks ORDER BY height DESC LIMIT ?`, [limit]);
    res.json(rows.map((b) => ({ ...b, txIds: JSON.parse(b.txIdsJson || "[]") })));
  } catch (e) {
    res.status(500).json({ error: e.message || "blocks failed" });
  }
});

/**
 * Register (server derives wallet from pubkey)
 */
app.post("/register", async (req, res) => {
  try {
    const publicKey = req.body?.publicKey;
    if (!publicKey) return res.status(400).json({ error: "Missing publicKey" });

    // Validate pubkey
    let pk;
    try {
      pk = naclUtil.decodeBase64(publicKey);
      if (pk.length !== 32) throw new Error("bad length");
    } catch {
      return res.status(400).json({ error: "Invalid publicKey (must be base64 32 bytes)" });
    }

    const wallet = deriveWalletFromPubKeyB64(publicKey);
    await ensureAccountExists(wallet);
    await setPubKey(wallet, publicKey);

    const acct = await getAccount(wallet);

    res.json({
      success: true,
      wallet,
      nonce: acct.nonce,
      registered: true,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "register failed" });
  }
});

app.get("/account/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const acct = await getAccount(wallet);

    res.json({
      wallet: acct.wallet,
      balance: acct.balance,
      nonce: acct.nonce,
      registered: !!acct.publicKeyB64,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "account failed" });
  }
});

app.get("/balance/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const acct = await getAccount(wallet);
    res.json({ wallet, balance: acct.balance });
  } catch (e) {
    res.status(500).json({ error: e.message || "balance failed" });
  }
});

app.get("/transactions/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const rows = await all(
      db,
      `SELECT * FROM transactions
       WHERE fromWallet = ? OR toWallet = ?
       ORDER BY timestampMs DESC
       LIMIT 200`,
      [wallet, wallet]
    );

    res.json(
      rows.map((t) => ({
        id: t.id,
        hash: t.hash,
        type: t.type,
        from: t.fromWallet,
        to: t.toWallet,
        amount: t.amount,
        nonce: t.nonce,
        gasFee: t.gasFee,
        status: t.status,
        blockHeight: t.blockHeight,
        blockHash: t.blockHash,
        timestamp: t.timestampMs,
      }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message || "transactions failed" });
  }
});

/* ======================
   SIGNED TX ROUTES
====================== */

app.post("/mint", async (req, res) => {
  try {
    const wallet = req.body?.wallet;
    const nonce = req.body?.nonce;
    const timestamp = req.body?.timestamp;
    const signature = req.body?.signature;

    if (!wallet) return res.status(400).json({ error: "Missing wallet" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const acct = await getAccount(wallet);

    if (nonce !== acct.nonce) {
      return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });
    }

    const msg = canonicalMessage({
      type: "mint",
      from: "",
      to: wallet,
      amount: MINT_AMOUNT,
      nonce,
      timestamp,
    });

    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    const remaining = acct.lastMintMs + MINT_COOLDOWN_MS - now();
    if (remaining > 0) {
      const cooldownSeconds = Math.ceil(remaining / 1000);
      res.set("Retry-After", String(cooldownSeconds));
      return res.status(429).json({ error: "Cooldown active", cooldownSeconds });
    }

    // Apply state changes (immediate apply; tx confirms when block producer includes it)
    const newBal = Number(acct.balance) + MINT_AMOUNT;
    await updateBalance(wallet, newBal);
    await setLastMint(wallet, now());
    await incrementNonce(wallet);

    const tx = createTx({
      type: "mint",
      from: null,
      to: wallet,
      amount: MINT_AMOUNT,
      nonce,
      timestampMs: timestamp,
    });

    await insertTx(tx);

    // Return updated
    const acct2 = await getAccount(wallet);
    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    res.json({
      success: true,
      wallet,
      balance: acct2.balance,
      nonce: acct2.nonce,
      tx,
      cooldownSeconds: Math.ceil(MINT_COOLDOWN_MS / 1000),
      chainHeight,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "mint failed" });
  }
});

app.post("/send", async (req, res) => {
  try {
    const { from, to, amount, nonce, timestamp, signature } = req.body;

    if (!from || !to) return res.status(400).json({ error: "Missing from/to" });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be a positive number" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    await ensureAccountExists(to);

    const fromAcct = await getAccount(from);

    if (nonce !== fromAcct.nonce) {
      return res.status(409).json({ error: "Nonce mismatch", expectedNonce: fromAcct.nonce, gotNonce: nonce });
    }

    const msg = canonicalMessage({
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      timestamp,
    });

    const sigOk = verifySignature({ walletPubKeyB64: fromAcct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    if (Number(fromAcct.balance) < amt) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Apply balances immediately
    const newFromBal = Number(fromAcct.balance) - amt;
    await updateBalance(from, newFromBal);

    const toAcct = await getAccount(to);
    const newToBal = Number(toAcct.balance) + amt;
    await updateBalance(to, newToBal);

    await incrementNonce(from);

    const tx = createTx({
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      timestampMs: timestamp,
    });

    await insertTx(tx);

    const fromAcct2 = await getAccount(from);
    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    res.json({
      success: true,
      tx,
      fromBalance: newFromBal,
      toBalance: newToBal,
      fromNonce: fromAcct2.nonce,
      chainHeight,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "send failed" });
  }
});

/* ======================
   START SERVER
====================== */
(async () => {
  try {
    await initDb(db);
    await startBlockProducer();

    app.listen(PORT, () => {
      console.log(`🚀 HIVE Wallet server running on http://localhost:${PORT}`);
      console.log(`🗄️  SQLite DB: ${DB_PATH}`);
      console.log(`⛓️  Block time: ${BLOCK_TIME_MS}ms`);
    });
  } catch (e) {
    console.error("FATAL STARTUP ERROR:", e);
    process.exit(1);
  }
})();
