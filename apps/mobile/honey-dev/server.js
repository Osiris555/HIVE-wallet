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
const MAX_BLOCKS_RETURN = 200;

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
 * wallet = HNY_<first 40 hex chars of sha256(pubkeyBytes)>
 */
function deriveWalletFromPubKeyB64(pubB64) {
  const pubBytes = naclUtil.decodeBase64(pubB64);
  const hex = sha256Hex(Buffer.from(pubBytes));
  return `HNY_${hex.slice(0, 40)}`;
}

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

async function getAccountRow(wallet) {
  await ensureAccountExists(wallet);
  return await get(
    db,
    `SELECT wallet, publicKeyB64, balance, nonce, lastMintMs FROM accounts WHERE wallet = ?`,
    [wallet]
  );
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

async function getPendingOutgoing(wallet) {
  const row = await get(
    db,
    `SELECT COALESCE(SUM(amount), 0) AS s
     FROM transactions
     WHERE status = 'pending' AND type = 'send' AND fromWallet = ?`,
    [wallet]
  );
  return Number(row?.s || 0);
}

async function getPendingDelta(wallet) {
  const row = await get(
    db,
    `SELECT
      COALESCE((SELECT SUM(amount) FROM transactions WHERE status='pending' AND type='mint' AND toWallet=?), 0) +
      COALESCE((SELECT SUM(amount) FROM transactions WHERE status='pending' AND type='send' AND toWallet=?), 0) -
      COALESCE((SELECT SUM(amount) FROM transactions WHERE status='pending' AND type='send' AND fromWallet=?), 0)
    AS d`,
    [wallet, wallet, wallet]
  );
  return Number(row?.d || 0);
}

function verifySignature({ walletPubKeyB64, message, signatureB64 }) {
  if (!walletPubKeyB64) return { ok: false, error: "Wallet not registered (missing public key)" };
  if (!signatureB64) return { ok: false, error: "Missing signature" };

  let pubKey, sig;
  try {
    pubKey = naclUtil.decodeBase64(walletPubKeyB64);
    sig = naclUtil.decodeBase64(signatureB64);
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
    failReason: null,
    blockHeight: null,
    blockHash: null,
    timestampMs,
  };
}

async function insertTx(tx) {
  await run(
    db,
    `INSERT INTO transactions
     (id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, status, failReason, blockHeight, blockHash, timestampMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      tx.failReason,
      tx.blockHeight,
      tx.blockHash,
      tx.timestampMs,
    ]
  );
}

/* ======================
   BLOCK PRODUCER (confirmed-only + failure reasons)
====================== */

async function getLatestBlock() {
  return await get(db, `SELECT height, hash, timestampMs FROM blocks ORDER BY height DESC LIMIT 1`);
}

/**
 * We validate txs at block time against:
 *  - non-negative amount
 *  - for sends: from has enough "working confirmed" balance after applying prior txs in this block
 *  - accounts exist
 *
 * If invalid -> mark tx failed with reason, do NOT apply.
 * If valid -> mark confirmed and apply to balances.
 */
async function buildBlockWithFailureHandling() {
  const pending = await all(
    db,
    `SELECT id, hash, type, fromWallet, toWallet, amount, nonce, timestampMs
     FROM transactions
     WHERE status = 'pending'
     ORDER BY timestampMs ASC
     LIMIT ?`,
    [MAX_BLOCK_TXS]
  );

  const latest = await getLatestBlock();
  const prevHash = latest?.hash || "GENESIS";
  const height = (latest?.height || 0) + 1;
  const ts = now();

  const allIds = pending.map((t) => t.id);
  const txRoot = sha256Hex(pending.map((t) => t.hash).join("|"));
  const header = `${height}:${ts}:${allIds.length}:${prevHash}`;
  const blockHash = sha256Hex(`${header}:${txRoot}`);

  // We'll confirm only valid tx IDs in the block; failed remain out of txIdsJson
  const confirmedIds = [];

  await run(db, "BEGIN TRANSACTION");

  try {
    // Load working balances only for involved wallets
    const wallets = new Set();
    for (const tx of pending) {
      if (tx.toWallet) wallets.add(tx.toWallet);
      if (tx.fromWallet) wallets.add(tx.fromWallet);
    }
    const walletArr = Array.from(wallets);

    // Ensure all exist
    for (const w of walletArr) {
      await ensureAccountExists(w);
    }

    const working = {}; // wallet => number
    for (const w of walletArr) {
      const a = await getAccountRow(w);
      working[w] = Number(a.balance);
    }

    for (const tx of pending) {
      const amt = Number(tx.amount);

      // Basic validation
      if (!Number.isFinite(amt) || amt <= 0) {
        await run(
          db,
          `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
          ["invalid_amount", height, blockHash, tx.id]
        );
        continue;
      }

      if (tx.type === "mint") {
        // mint always valid at block time
        working[tx.toWallet] = (working[tx.toWallet] || 0) + amt;

        await run(
          db,
          `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`,
          [height, blockHash, tx.id]
        );
        confirmedIds.push(tx.id);
        continue;
      }

      if (tx.type === "send") {
        const from = tx.fromWallet;
        const to = tx.toWallet;

        if (!from || !to) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["missing_from_or_to", height, blockHash, tx.id]
          );
          continue;
        }

        const fromBal = working[from] || 0;

        if (fromBal < amt) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["insufficient_confirmed_at_block", height, blockHash, tx.id]
          );
          continue;
        }

        // Apply
        working[from] = fromBal - amt;
        working[to] = (working[to] || 0) + amt;

        await run(
          db,
          `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`,
          [height, blockHash, tx.id]
        );
        confirmedIds.push(tx.id);
        continue;
      }

      // Unknown type
      await run(
        db,
        `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
        ["unknown_type", height, blockHash, tx.id]
      );
    }

    // Write back working balances for any touched wallets
    for (const [w, bal] of Object.entries(working)) {
      await updateBalance(w, bal);
    }

    // Insert block with ONLY confirmed tx IDs (failed txs are not included)
    const txIdsJson = JSON.stringify(confirmedIds);

    const confirmedHashes = pending
      .filter((t) => confirmedIds.includes(t.id))
      .map((t) => t.hash);

    const confirmedTxRoot = sha256Hex(confirmedHashes.join("|"));
    const blockHash2 = sha256Hex(`${height}:${ts}:${confirmedIds.length}:${prevHash}:${confirmedTxRoot}`);

    // Update confirmed txs to point to FINAL block hash (blockHash2)
    if (confirmedIds.length > 0) {
      const placeholders = confirmedIds.map(() => "?").join(",");
      await run(
        db,
        `UPDATE transactions SET blockHash=? WHERE id IN (${placeholders})`,
        [blockHash2, ...confirmedIds]
      );
    }

    // Update failed txs to point to FINAL block hash too (for explorer grouping)
    const failedIds = allIds.filter((id) => !confirmedIds.includes(id));
    if (failedIds.length > 0) {
      const placeholders = failedIds.map(() => "?").join(",");
      await run(
        db,
        `UPDATE transactions SET blockHash=? WHERE id IN (${placeholders})`,
        [blockHash2, ...failedIds]
      );
    }

    await run(
      db,
      `INSERT INTO blocks (height, hash, prevHash, timestampMs, txCount, txRoot, txIdsJson)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [height, blockHash2, prevHash, ts, confirmedIds.length, confirmedTxRoot, txIdsJson]
    );

    await run(db, "COMMIT");

    return { height, hash: blockHash2, timestampMs: ts, txCount: confirmedIds.length, txRoot: confirmedTxRoot };
  } catch (e) {
    await run(db, "ROLLBACK");
    throw e;
  }
}

let lastBlockTimeMs = now();

async function startBlockProducer() {
  const latest = await getLatestBlock();
  if (latest?.timestampMs) lastBlockTimeMs = latest.timestampMs;

  setInterval(async () => {
    try {
      const block = await buildBlockWithFailureHandling();
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
  res.json({
    status: "HIVE Wallet server running",
    db: DB_PATH,
    mode: "confirmed-only + failed-tx-reasons",
  });
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

app.post("/register", async (req, res) => {
  try {
    const publicKey = req.body?.publicKey;
    if (!publicKey) return res.status(400).json({ error: "Missing publicKey" });

    try {
      const pk = naclUtil.decodeBase64(publicKey);
      if (pk.length !== 32) throw new Error("bad length");
    } catch {
      return res.status(400).json({ error: "Invalid publicKey (must be base64 32 bytes)" });
    }

    const wallet = deriveWalletFromPubKeyB64(publicKey);
    await ensureAccountExists(wallet);
    await setPubKey(wallet, publicKey);

    const acct = await getAccountRow(wallet);

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

    const acct = await getAccountRow(wallet);
    const pendingDelta = await getPendingDelta(wallet);
    const pendingOutgoing = await getPendingOutgoing(wallet);

    res.json({
      wallet: acct.wallet,
      balance: Number(acct.balance),
      pendingDelta,
      spendableBalance: Number(acct.balance) - pendingOutgoing,
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

    const acct = await getAccountRow(wallet);
    const pendingDelta = await getPendingDelta(wallet);
    const pendingOutgoing = await getPendingOutgoing(wallet);

    res.json({
      wallet,
      balance: Number(acct.balance),
      pendingDelta,
      spendableBalance: Number(acct.balance) - pendingOutgoing,
    });
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
        failReason: t.failReason || null,
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
   SIGNED TX ROUTES (pending submit)
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

    const acct = await getAccountRow(wallet);

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

    // consume nonce/cooldown immediately
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

    const acct2 = await getAccountRow(wallet);
    const pendingDelta = await getPendingDelta(wallet);
    const pendingOutgoing = await getPendingOutgoing(wallet);

    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    res.json({
      success: true,
      wallet,
      balance: Number(acct2.balance),
      pendingDelta,
      spendableBalance: Number(acct2.balance) - pendingOutgoing,
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

    const fromAcct = await getAccountRow(from);

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

    const pendingOutgoing = await getPendingOutgoing(from);
    const spendable = Number(fromAcct.balance) - pendingOutgoing;

    if (spendable < amt) {
      return res.status(400).json({
        error: "Insufficient spendable balance (pending outgoing reduces spendable)",
        confirmedBalance: Number(fromAcct.balance),
        pendingOutgoing,
        spendableBalance: spendable,
      });
    }

    // consume nonce immediately
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

    const acct2 = await getAccountRow(from);
    const pendingDelta2 = await getPendingDelta(from);
    const pendingOutgoing2 = await getPendingOutgoing(from);

    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    res.json({
      success: true,
      tx,
      confirmedBalance: Number(acct2.balance),
      pendingDelta: pendingDelta2,
      spendableBalance: Number(acct2.balance) - pendingOutgoing2,
      fromNonce: acct2.nonce,
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
      console.log(`✅ Mode: confirmed-only + failed tx handling`);
    });
  } catch (e) {
    console.error("FATAL STARTUP ERROR:", e);
    process.exit(1);
  }
})();
