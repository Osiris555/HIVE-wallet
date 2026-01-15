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
const MINT_COOLDOWN_MS = 60 * 1000;

// Blocks
const BLOCK_TIME_MS = 5000;
const MAX_BLOCK_TXS = 500;
const MAX_BLOCKS_RETURN = 200;

// NEW: Testnet-style rules
const TX_TTL_MS = 60 * 1000; // pending tx expires after 60s
const MAX_PENDING_PER_WALLET = 20; // "max nonce gap" practical equivalent
const MAX_TXS_PER_WALLET_PER_BLOCK = 5; // per wallet per block
const MIN_GAS_FEE = 0.000001; // fee floor

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

/**
 * "Max nonce gap" practical control: limit how many pending txs a wallet can have queued.
 * - send: counts pending sends from that wallet
 * - mint: counts pending mints to that wallet (wallet is the "owner")
 */
async function countPendingForWallet({ type, wallet }) {
  if (type === "send") {
    const r = await get(
      db,
      `SELECT COUNT(*) AS c FROM transactions WHERE status='pending' AND type='send' AND fromWallet=?`,
      [wallet]
    );
    return Number(r?.c || 0);
  }
  if (type === "mint") {
    const r = await get(
      db,
      `SELECT COUNT(*) AS c FROM transactions WHERE status='pending' AND type='mint' AND toWallet=?`,
      [wallet]
    );
    return Number(r?.c || 0);
  }
  return 0;
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

function createTx({ type, from = null, to, amount, nonce, gasFee, timestampMs, expiresAtMs }) {
  const id = crypto.randomUUID();
  const hash = sha256Hex(`${id}:${type}:${from ?? ""}:${to}:${amount}:${nonce}:${gasFee}:${timestampMs}:${expiresAtMs}`);

  return {
    id,
    hash,
    type,
    fromWallet: from,
    toWallet: to,
    amount,
    nonce,
    gasFee,
    status: "pending",
    failReason: null,
    expiresAtMs,
    blockHeight: null,
    blockHash: null,
    timestampMs,
  };
}

async function insertTx(tx) {
  await run(
    db,
    `INSERT INTO transactions
     (id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, status, failReason, expiresAtMs, blockHeight, blockHash, timestampMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      tx.expiresAtMs,
      tx.blockHeight,
      tx.blockHash,
      tx.timestampMs,
    ]
  );
}

/* ======================
   BLOCK PRODUCER (confirmed-only + failed reasons + rules)
====================== */

async function getLatestBlock() {
  return await get(db, `SELECT height, hash, timestampMs FROM blocks ORDER BY height DESC LIMIT 1`);
}

async function buildBlockWithRules() {
  const pending = await all(
    db,
    `SELECT id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, expiresAtMs, timestampMs
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

  // We include ONLY confirmed txs in the block body
  const confirmedIds = [];

  await run(db, "BEGIN TRANSACTION");

  try {
    // Working balances for involved wallets
    const wallets = new Set();
    for (const tx of pending) {
      if (tx.toWallet) wallets.add(tx.toWallet);
      if (tx.fromWallet) wallets.add(tx.fromWallet);
    }
    for (const w of wallets) await ensureAccountExists(w);

    const working = {};
    for (const w of wallets) {
      const a = await getAccountRow(w);
      working[w] = Number(a.balance);
    }

    // Per-wallet confirmation counter for this block
    const perWalletCount = {}; // wallet -> count

    function bump(wallet) {
      perWalletCount[wallet] = (perWalletCount[wallet] || 0) + 1;
      return perWalletCount[wallet];
    }
    function isOverLimit(wallet) {
      return (perWalletCount[wallet] || 0) >= MAX_TXS_PER_WALLET_PER_BLOCK;
    }

    for (const tx of pending) {
      const amt = Number(tx.amount);
      const fee = Number(tx.gasFee);
      const exp = tx.expiresAtMs == null ? null : Number(tx.expiresAtMs);

      // Expiry check (NULL means "no expiry" for old DB rows; treat as not expired)
      if (exp != null && Number.isFinite(exp) && ts > exp) {
        await run(
          db,
          `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
          ["expired", height, "PENDING_HASH", tx.id]
        );
        continue;
      }

      // Fee floor check
      if (!Number.isFinite(fee) || fee < MIN_GAS_FEE) {
        await run(
          db,
          `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
          ["fee_too_low", height, "PENDING_HASH", tx.id]
        );
        continue;
      }

      // Amount check
      if (!Number.isFinite(amt) || amt <= 0) {
        await run(
          db,
          `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
          ["invalid_amount", height, "PENDING_HASH", tx.id]
        );
        continue;
      }

      if (tx.type === "mint") {
        const wallet = tx.toWallet;

        // Per-wallet-per-block limit (mints count toward the wallet too)
        if (isOverLimit(wallet)) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["per_wallet_block_limit", height, "PENDING_HASH", tx.id]
          );
          continue;
        }
        bump(wallet);

        working[wallet] = (working[wallet] || 0) + amt;

        await run(
          db,
          `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`,
          [height, "PENDING_HASH", tx.id]
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
            ["missing_from_or_to", height, "PENDING_HASH", tx.id]
          );
          continue;
        }

        // Per-wallet-per-block limit based on sender
        if (isOverLimit(from)) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["per_wallet_block_limit", height, "PENDING_HASH", tx.id]
          );
          continue;
        }

        const fromBal = working[from] || 0;
        if (fromBal < amt) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["insufficient_confirmed_at_block", height, "PENDING_HASH", tx.id]
          );
          continue;
        }

        bump(from);

        working[from] = fromBal - amt;
        working[to] = (working[to] || 0) + amt;

        await run(
          db,
          `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`,
          [height, "PENDING_HASH", tx.id]
        );
        confirmedIds.push(tx.id);
        continue;
      }

      await run(
        db,
        `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
        ["unknown_type", height, "PENDING_HASH", tx.id]
      );
    }

    // Apply working balances to DB
    for (const [w, bal] of Object.entries(working)) {
      await updateBalance(w, bal);
    }

    // Build the block hash over confirmed txs only
    const confirmedRows = pending.filter((t) => confirmedIds.includes(t.id));
    const confirmedHashes = confirmedRows.map((t) => t.hash);

    const txRoot = sha256Hex(confirmedHashes.join("|"));
    const header = `${height}:${ts}:${confirmedIds.length}:${prevHash}`;
    const blockHash = sha256Hex(`${header}:${txRoot}`);

    // Update txs with final blockHash (both confirmed + failed for grouping)
    if (confirmedIds.length > 0) {
      const placeholders = confirmedIds.map(() => "?").join(",");
      await run(
        db,
        `UPDATE transactions SET blockHash=? WHERE id IN (${placeholders})`,
        [blockHash, ...confirmedIds]
      );
    }

    const allIds = pending.map((t) => t.id);
    const failedIds = allIds.filter((id) => !confirmedIds.includes(id));
    if (failedIds.length > 0) {
      const placeholders = failedIds.map(() => "?").join(",");
      await run(
        db,
        `UPDATE transactions SET blockHash=? WHERE id IN (${placeholders})`,
        [blockHash, ...failedIds]
      );
    }

    // Insert block
    await run(
      db,
      `INSERT INTO blocks (height, hash, prevHash, timestampMs, txCount, txRoot, txIdsJson)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [height, blockHash, prevHash, ts, confirmedIds.length, txRoot, JSON.stringify(confirmedIds)]
    );

    await run(db, "COMMIT");
    return { height, hash: blockHash, timestampMs: ts, txCount: confirmedIds.length, txRoot };
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
      const block = await buildBlockWithRules();
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
    mode: "confirmed-only + failed reasons + ttl + per-block limits + min-fee",
    rules: {
      TX_TTL_MS,
      MAX_PENDING_PER_WALLET,
      MAX_TXS_PER_WALLET_PER_BLOCK,
      MIN_GAS_FEE,
    },
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

    res.json({ success: true, wallet, nonce: acct.nonce, registered: true });
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
        expiresAtMs: t.expiresAtMs == null ? null : Number(t.expiresAtMs),
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
    const gasFee = Number(req.body?.gasFee ?? MIN_GAS_FEE);
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!wallet) return res.status(400).json({ error: "Missing wallet" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    if (!Number.isFinite(gasFee) || gasFee < MIN_GAS_FEE) {
      return res.status(400).json({ error: "Fee too low", minGasFee: MIN_GAS_FEE });
    }

    const ttlMax = now() + TX_TTL_MS * 2; // cap client-provided expiry
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    const acct = await getAccountRow(wallet);

    // anti-spam / "nonce gap" practical control
    const pendingCount = await countPendingForWallet({ type: "mint", wallet });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({
        error: "Too many pending transactions for this wallet",
        maxPendingPerWallet: MAX_PENDING_PER_WALLET,
      });
    }

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
      gasFee,
      timestampMs: timestamp,
      expiresAtMs,
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
      rules: { TX_TTL_MS, MIN_GAS_FEE, MAX_PENDING_PER_WALLET, MAX_TXS_PER_WALLET_PER_BLOCK },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "mint failed" });
  }
});

app.post("/send", async (req, res) => {
  try {
    const { from, to, amount, nonce, timestamp, signature } = req.body;
    const gasFee = Number(req.body?.gasFee ?? MIN_GAS_FEE);
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!from || !to) return res.status(400).json({ error: "Missing from/to" });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be a positive number" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    if (!Number.isFinite(gasFee) || gasFee < MIN_GAS_FEE) {
      return res.status(400).json({ error: "Fee too low", minGasFee: MIN_GAS_FEE });
    }

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    await ensureAccountExists(to);

    const fromAcct = await getAccountRow(from);

    // anti-spam / "nonce gap" practical control
    const pendingCount = await countPendingForWallet({ type: "send", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({
        error: "Too many pending transactions for this wallet",
        maxPendingPerWallet: MAX_PENDING_PER_WALLET,
      });
    }

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

    await incrementNonce(from);

    const tx = createTx({
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      gasFee,
      timestampMs: timestamp,
      expiresAtMs,
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
      rules: { TX_TTL_MS, MIN_GAS_FEE, MAX_PENDING_PER_WALLET, MAX_TXS_PER_WALLET_PER_BLOCK },
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
      console.log(`✅ Rules: TTL=${TX_TTL_MS}ms, MIN_FEE=${MIN_GAS_FEE}, MAX_PENDING=${MAX_PENDING_PER_WALLET}, MAX_PER_BLOCK=${MAX_TXS_PER_WALLET_PER_BLOCK}`);
    });
  } catch (e) {
    console.error("FATAL STARTUP ERROR:", e);
    process.exit(1);
  }
})();
