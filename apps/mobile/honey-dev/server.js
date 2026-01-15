// apps/mobile/honey-dev/server.js
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

const { openDb, initDb, run, get, all, DB_PATH } = require("./db");

const app = express();
const PORT = 3000;

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

// Failure rules
const TX_TTL_MS = 60 * 1000;
const MAX_PENDING_PER_WALLET = 20;
const MAX_TXS_PER_WALLET_PER_BLOCK = 5;
const MIN_GAS_FEE = 0.000001;

// ✅ chainId
const CHAIN_ID = process.env.HIVE_CHAIN_ID || "hny-devnet-1";

// ✅ fee vault
const FEE_VAULT = "HNY_FEE_VAULT";

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

/**
 * Everything signed:
 * chainId | type | from | to | amount | nonce | gasFee | expiresAtMs | timestamp
 */
function canonicalSignedMessage({
  chainId,
  type,
  from,
  to,
  amount,
  nonce,
  gasFee,
  expiresAtMs,
  timestamp,
}) {
  return [
    String(chainId),
    String(type),
    String(from ?? ""),
    String(to ?? ""),
    String(amount),
    String(nonce),
    String(gasFee),
    String(expiresAtMs),
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

/**
 * ✅ Pending outgoing cost includes gas fees
 * For spendable calculations, a send "reserves" amount + gasFee.
 */
async function getPendingOutgoingCost(wallet) {
  const row = await get(
    db,
    `SELECT COALESCE(SUM(amount + gasFee), 0) AS s
     FROM transactions
     WHERE status='pending' AND type='send' AND fromWallet=?`,
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
      COALESCE((SELECT SUM(amount + gasFee) FROM transactions WHERE status='pending' AND type='send' AND fromWallet=?), 0)
    AS d`,
    [wallet, wallet, wallet]
  );
  return Number(row?.d || 0);
}

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
  const hash = sha256Hex(
    `${CHAIN_ID}:${id}:${type}:${from ?? ""}:${to}:${amount}:${nonce}:${gasFee}:${expiresAtMs}:${timestampMs}`
  );

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
   BLOCK PRODUCER
   - confirmed-only balances
   - fees charged on confirm
====================== */
async function getLatestBlock() {
  return await get(db, `SELECT height, hash, timestampMs FROM blocks ORDER BY height DESC LIMIT 1`);
}

async function buildBlockWithRules() {
  const pending = await all(
    db,
    `SELECT id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, expiresAtMs, timestampMs
     FROM transactions
     WHERE status='pending'
     ORDER BY timestampMs ASC
     LIMIT ?`,
    [MAX_BLOCK_TXS]
  );

  const latest = await getLatestBlock();
  const prevHash = latest?.hash || "GENESIS";
  const height = (latest?.height || 0) + 1;
  const ts = now();

  const confirmedIds = [];

  await run(db, "BEGIN TRANSACTION");
  try {
    // ensure involved accounts exist + fee vault exists
    const wallets = new Set([FEE_VAULT]);
    for (const tx of pending) {
      if (tx.toWallet) wallets.add(tx.toWallet);
      if (tx.fromWallet) wallets.add(tx.fromWallet);
    }
    for (const w of wallets) await ensureAccountExists(w);

    // working confirmed balances
    const working = {};
    for (const w of wallets) {
      const a = await getAccountRow(w);
      working[w] = Number(a.balance);
    }

    // per-wallet-per-block limiter
    const perWalletCount = {};
    const isOverLimit = (wallet) => (perWalletCount[wallet] || 0) >= MAX_TXS_PER_WALLET_PER_BLOCK;
    const bump = (wallet) => (perWalletCount[wallet] = (perWalletCount[wallet] || 0) + 1);

    for (const tx of pending) {
      const amt = Number(tx.amount);
      const fee = Number(tx.gasFee);
      const exp = tx.expiresAtMs == null ? null : Number(tx.expiresAtMs);

      // 1) expiry
      if (exp != null && Number.isFinite(exp) && ts > exp) {
        await run(
          db,
          `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
          ["expired", height, "TBD", tx.id]
        );
        continue;
      }

      // 4) fee too low
      if (!Number.isFinite(fee) || fee < MIN_GAS_FEE) {
        await run(
          db,
          `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
          ["fee_too_low", height, "TBD", tx.id]
        );
        continue;
      }

      if (!Number.isFinite(amt) || amt <= 0) {
        await run(
          db,
          `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
          ["invalid_amount", height, "TBD", tx.id]
        );
        continue;
      }

      if (tx.type === "mint") {
        const owner = tx.toWallet;

        // 3) per wallet per block
        if (isOverLimit(owner)) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["per_wallet_block_limit", height, "TBD", tx.id]
          );
          continue;
        }
        bump(owner);

        // faucet pays fee for mint (no fee charge to user)
        working[owner] = (working[owner] || 0) + amt;

        await run(
          db,
          `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`,
          [height, "TBD", tx.id]
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
            ["missing_from_or_to", height, "TBD", tx.id]
          );
          continue;
        }

        // 3) per wallet per block (sender)
        if (isOverLimit(from)) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["per_wallet_block_limit", height, "TBD", tx.id]
          );
          continue;
        }

        // ✅ charge amount + fee from sender
        const totalCost = amt + fee;
        const fromBal = working[from] || 0;

        if (fromBal < totalCost) {
          await run(
            db,
            `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
            ["insufficient_confirmed_at_block", height, "TBD", tx.id]
          );
          continue;
        }

        bump(from);

        working[from] = fromBal - totalCost;
        working[to] = (working[to] || 0) + amt;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + fee;

        await run(
          db,
          `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`,
          [height, "TBD", tx.id]
        );
        confirmedIds.push(tx.id);
        continue;
      }

      await run(
        db,
        `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
        ["unknown_type", height, "TBD", tx.id]
      );
    }

    // persist confirmed balances
    for (const [w, bal] of Object.entries(working)) {
      await updateBalance(w, bal);
    }

    // block hash over confirmed txs only
    const confirmedHashes = pending.filter((t) => confirmedIds.includes(t.id)).map((t) => t.hash);
    const txRoot = sha256Hex(confirmedHashes.join("|"));
    const header = `${height}:${ts}:${confirmedIds.length}:${prevHash}`;
    const blockHash = sha256Hex(`${header}:${txRoot}`);

    // set final blockHash for all processed
    const allIds = pending.map((t) => t.id);
    if (allIds.length > 0) {
      const placeholders = allIds.map(() => "?").join(",");
      await run(
        db,
        `UPDATE transactions SET blockHash=? WHERE id IN (${placeholders})`,
        [blockHash, ...allIds]
      );
    }

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
    chainId: CHAIN_ID,
    feeVault: FEE_VAULT,
    rules: { TX_TTL_MS, MAX_PENDING_PER_WALLET, MAX_TXS_PER_WALLET_PER_BLOCK, MIN_GAS_FEE },
  });
});

app.get("/status", async (_req, res) => {
  try {
    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    const elapsed = now() - lastBlockTimeMs;
    const msUntilNext = Math.max(0, BLOCK_TIME_MS - (elapsed % BLOCK_TIME_MS));

    const mempoolSizeRow = await get(db, `SELECT COUNT(*) as c FROM transactions WHERE status='pending'`);
    const mempoolSize = mempoolSizeRow?.c || 0;

    res.json({
      chainId: CHAIN_ID,
      chainHeight,
      lastBlockTimeMs,
      blockTimeMs: BLOCK_TIME_MS,
      msUntilNextBlock: msUntilNext,
      mempoolSize,
      latestBlock: latest || null,
      minGasFee: MIN_GAS_FEE,
      txTtlMs: TX_TTL_MS,
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
    res.json({ success: true, wallet, nonce: acct.nonce, registered: true, chainId: CHAIN_ID });
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
    const pendingOutgoingCost = await getPendingOutgoingCost(wallet);

    res.json({
      chainId: CHAIN_ID,
      wallet: acct.wallet,
      balance: Number(acct.balance),
      pendingDelta,
      spendableBalance: Number(acct.balance) - pendingOutgoingCost,
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
    const pendingOutgoingCost = await getPendingOutgoingCost(wallet);

    res.json({
      chainId: CHAIN_ID,
      wallet,
      balance: Number(acct.balance),
      pendingDelta,
      spendableBalance: Number(acct.balance) - pendingOutgoingCost,
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
       WHERE fromWallet=? OR toWallet=?
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
   SIGNED TX SUBMISSION
====================== */
app.post("/mint", async (req, res) => {
  try {
    const wallet = req.body?.wallet;
    const nonce = req.body?.nonce;
    const timestamp = req.body?.timestamp;
    const signature = req.body?.signature;

    const gasFee = Number(req.body?.gasFee ?? MIN_GAS_FEE);
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));
    const chainId = String(req.body?.chainId || "");

    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    if (!Number.isFinite(gasFee) || gasFee < MIN_GAS_FEE) {
      return res.status(400).json({ error: "Fee too low", minGasFee: MIN_GAS_FEE });
    }

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    const acct = await getAccountRow(wallet);

    const pendingCount = await countPendingForWallet({ type: "mint", wallet });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs for wallet", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    if (nonce !== acct.nonce) {
      return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });
    }

    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "mint",
      from: "",
      to: wallet,
      amount: MINT_AMOUNT,
      nonce,
      gasFee,
      expiresAtMs,
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
    const pendingOutgoingCost = await getPendingOutgoingCost(wallet);

    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    res.json({
      success: true,
      chainId: CHAIN_ID,
      wallet,
      balance: Number(acct2.balance),
      pendingDelta,
      spendableBalance: Number(acct2.balance) - pendingOutgoingCost,
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

    const gasFee = Number(req.body?.gasFee ?? MIN_GAS_FEE);
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));
    const chainId = String(req.body?.chainId || "");

    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });
    if (!from || !to) return res.status(400).json({ error: "Missing from/to" });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be positive" });
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

    const pendingCount = await countPendingForWallet({ type: "send", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs for wallet", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    if (nonce !== fromAcct.nonce) {
      return res.status(409).json({ error: "Nonce mismatch", expectedNonce: fromAcct.nonce, gotNonce: nonce });
    }

    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      gasFee,
      expiresAtMs,
      timestamp,
    });

    const sigOk = verifySignature({ walletPubKeyB64: fromAcct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    // ✅ spendable check includes pending outgoing cost (amount+fee)
    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendable = Number(fromAcct.balance) - pendingOutgoingCost;

    const totalCost = amt + gasFee;
    if (spendable < totalCost) {
      return res.status(400).json({
        error: "Insufficient spendable balance (pending outgoing + fees reduce spendable)",
        confirmedBalance: Number(fromAcct.balance),
        pendingOutgoingCost,
        spendableBalance: spendable,
        required: totalCost,
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
    const pendingOutgoingCost2 = await getPendingOutgoingCost(from);

    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    res.json({
      success: true,
      chainId: CHAIN_ID,
      tx,
      confirmedBalance: Number(acct2.balance),
      pendingDelta: pendingDelta2,
      spendableBalance: Number(acct2.balance) - pendingOutgoingCost2,
      fromNonce: acct2.nonce,
      chainHeight,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "send failed" });
  }
});

/* ======================
   START
====================== */
(async () => {
  try {
    await initDb(db);
    await ensureAccountExists(FEE_VAULT);
    await startBlockProducer();

    app.listen(PORT, () => {
      console.log(`🚀 HIVE Wallet server running on http://localhost:${PORT}`);
      console.log(`🗄️  SQLite DB: ${DB_PATH}`);
      console.log(`⛓️  chainId: ${CHAIN_ID}`);
      console.log(`💰 fee vault: ${FEE_VAULT}`);
      console.log(
        `✅ Rules: TTL=${TX_TTL_MS}ms, MIN_FEE=${MIN_GAS_FEE}, MAX_PENDING=${MAX_PENDING_PER_WALLET}, MAX_PER_BLOCK=${MAX_TXS_PER_WALLET_PER_BLOCK}`
      );
    });
  } catch (e) {
    console.error("FATAL STARTUP ERROR:", e);
    process.exit(1);
  }
})();
