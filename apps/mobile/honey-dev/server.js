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

// Failure / queue rules
const TX_TTL_MS = 60 * 1000;
const MAX_PENDING_PER_WALLET = 20;
const MAX_TXS_PER_WALLET_PER_BLOCK = 5;

// Fees (base)
const BASE_MIN_GAS_FEE = 0.000001;
// 0.005% = 0.00005
const SERVICE_FEE_RATE = 0.00005;

// 1 satoshi-like unit
const ONE_SAT = 0.00000001;

const CHAIN_ID = process.env.HIVE_CHAIN_ID || "hny-devnet-1";
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

function fmt8(n) {
  return Number(n).toFixed(8);
}

function deriveWalletFromPubKeyB64(pubB64) {
  const pubBytes = naclUtil.decodeBase64(pubB64);
  const hex = sha256Hex(Buffer.from(pubBytes));
  return `HNY_${hex.slice(0, 40)}`;
}

/**
 * Signed envelope:
 * chainId|type|from|to|amount|nonce|gasFee|serviceFee|expiresAtMs|timestamp
 */
function canonicalSignedMessage({
  chainId,
  type,
  from,
  to,
  amount,
  nonce,
  gasFee,
  serviceFee,
  expiresAtMs,
  timestamp,
}) {
  return [
    String(chainId),
    String(type),
    String(from ?? ""),
    String(to ?? ""),
    fmt8(amount),
    String(nonce),
    fmt8(gasFee),
    fmt8(serviceFee),
    String(expiresAtMs),
    String(timestamp),
  ].join("|");
}


function txIdFromMessage(message) {
  // Deterministic txid = sha256(canonicalSignedMessage)
  return sha256Hex(message);
}

function expectedServiceFee(amount) {
  return Number((Number(amount) * SERVICE_FEE_RATE).toFixed(8));
}

async function getMempoolSize() {
  const r = await get(db, `SELECT COUNT(*) AS c FROM transactions WHERE status='pending'`);
  return Number(r?.c || 0);
}

function feeMarketMinGasFee(mempoolSize) {
  const multiplier = Math.min(10, 1 + mempoolSize / 1000);
  return Number((BASE_MIN_GAS_FEE * multiplier).toFixed(8));
}

async function currentMinGasFee() {
  const mempool = await getMempoolSize();
  return { mempool, minGasFee: feeMarketMinGasFee(mempool) };
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

async function getFeeVaultBalance() {
  const row = await get(db, `SELECT balance FROM accounts WHERE wallet = ?`, [FEE_VAULT]);
  return Number(row?.balance || 0);
}

async function setPubKey(wallet, publicKeyB64) {
  await ensureAccountExists(wallet);
  await run(db, `UPDATE accounts SET publicKeyB64 = ? WHERE wallet = ?`, [publicKeyB64, wallet]);
}

async function incrementNonce(wallet) {
  await ensureAccountExists(wallet);
  await run(db, `UPDATE accounts SET nonce = nonce + 1 WHERE wallet = ?`, [wallet]);
}

async function setLastMint(wallet, ms) {
  await ensureAccountExists(wallet);
  await run(db, `UPDATE accounts SET lastMintMs = ? WHERE wallet = ?`, [ms, wallet]);
}

async function getPendingOutgoingCost(wallet) {
  const row = await get(
    db,
    `SELECT COALESCE(SUM(amount + gasFee + serviceFee), 0) AS s
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
      COALESCE((SELECT SUM(amount + gasFee + serviceFee) FROM transactions WHERE status='pending' AND type='send' AND fromWallet=?), 0)
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

function createTx({ type, from = null, to, amount, nonce, gasFee, serviceFee, timestampMs, expiresAtMs }) {
  // Deterministic txid/hash based on the canonical signed message (must match client).
  const msg = canonicalSignedMessage({
    chainId: CHAIN_ID,
    type,
    from: from ?? "",
    to,
    amount,
    nonce,
    gasFee,
    serviceFee,
    expiresAtMs,
    timestamp: timestampMs,
  });

  const id = txIdFromMessage(msg);
  const hash = id;

  return {
    id,
    hash,
    type,
    fromWallet: from,
    toWallet: to,
    amount,
    nonce,
    gasFee,
    serviceFee,
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
     (id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, serviceFee, status, failReason, expiresAtMs, blockHeight, blockHash, timestampMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.id,
      tx.hash,
      tx.type,
      tx.fromWallet,
      tx.toWallet,
      tx.amount,
      tx.nonce,
      tx.gasFee,
      tx.serviceFee,
      tx.status,
      tx.failReason,
      tx.expiresAtMs,
      tx.blockHeight,
      tx.blockHash,
      tx.timestampMs,
    ]
  );
}

async function failTx(id, height, reason) {
  await run(
    db,
    `UPDATE transactions SET status='failed', failReason=?, blockHeight=?, blockHash=? WHERE id=?`,
    [reason, height, "TBD", id]
  );
}

/* ======================
   BLOCK PRODUCER
====================== */
async function getLatestBlock() {
  return await get(db, `SELECT height, hash, timestampMs FROM blocks ORDER BY height DESC LIMIT 1`);
}

async function buildBlockWithRules() {
  const pending = await all(
    db,
    `SELECT id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, serviceFee, expiresAtMs, timestampMs
     FROM transactions
     WHERE status='pending'
     ORDER BY (gasFee + serviceFee) DESC, timestampMs ASC
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
    const wallets = new Set([FEE_VAULT]);
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

    const perWalletCount = {};
    const isOverLimit = (wallet) => (perWalletCount[wallet] || 0) >= MAX_TXS_PER_WALLET_PER_BLOCK;
    const bump = (wallet) => (perWalletCount[wallet] = (perWalletCount[wallet] || 0) + 1);

    for (const tx of pending) {
      const amt = Number(tx.amount);
      const gasFee = Number(tx.gasFee);
      const serviceFee = Number(tx.serviceFee);
      const totalFee = gasFee + serviceFee;
      const exp = tx.expiresAtMs == null ? null : Number(tx.expiresAtMs);

      if (exp != null && Number.isFinite(exp) && ts > exp) {
        await failTx(tx.id, height, "expired");
        continue;
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        await failTx(tx.id, height, "invalid_amount");
        continue;
      }
      if (!Number.isFinite(gasFee) || gasFee <= 0) {
        await failTx(tx.id, height, "invalid_gas_fee");
        continue;
      }
      if (!Number.isFinite(serviceFee) || serviceFee < 0) {
        await failTx(tx.id, height, "invalid_service_fee");
        continue;
      }

      if (tx.type === "mint") {
        const owner = tx.toWallet;
        if (isOverLimit(owner)) {
          await failTx(tx.id, height, "per_wallet_block_limit");
          continue;
        }
        bump(owner);

        // ✅ FIX: credit feeVault on mint and deduct from minted amount
        const netMint = Number((amt - gasFee).toFixed(8));
        if (netMint <= 0) {
          await failTx(tx.id, height, "mint_fee_exceeds_amount");
          continue;
        }

        working[owner] = (working[owner] || 0) + netMint;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + gasFee;

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
          await failTx(tx.id, height, "missing_from_or_to");
          continue;
        }
        if (isOverLimit(from)) {
          await failTx(tx.id, height, "per_wallet_block_limit");
          continue;
        }

        const totalCost = amt + totalFee;
        const fromBal = working[from] || 0;
        if (fromBal < totalCost) {
          await failTx(tx.id, height, "insufficient_confirmed_at_block");
          continue;
        }
        bump(from);

        working[from] = fromBal - totalCost;
        working[to] = (working[to] || 0) + amt;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;

        await run(
          db,
          `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`,
          [height, "TBD", tx.id]
        );
        confirmedIds.push(tx.id);
        continue;
      }

      await failTx(tx.id, height, "unknown_type");
    }

    for (const [w, bal] of Object.entries(working)) {
      await run(db, `UPDATE accounts SET balance=? WHERE wallet=?`, [bal, w]);
    }

    const confirmedHashes = pending.filter((t) => confirmedIds.includes(t.id)).map((t) => t.hash);
    const txRoot = sha256Hex(confirmedHashes.join("|"));
    const header = `${height}:${ts}:${confirmedIds.length}:${prevHash}`;
    const blockHash = sha256Hex(`${header}:${txRoot}`);

    const allIds = pending.map((t) => t.id);
    if (allIds.length > 0) {
      const placeholders = allIds.map(() => "?").join(",");
      await run(db, `UPDATE transactions SET blockHash=? WHERE id IN (${placeholders})`, [blockHash, ...allIds]);
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
app.get("/status", async (_req, res) => {
  try {
    const latest = await getLatestBlock();
    const chainHeight = latest?.height || 0;

    const elapsed = now() - lastBlockTimeMs;
    const msUntilNext = Math.max(0, BLOCK_TIME_MS - (elapsed % BLOCK_TIME_MS));

    const { mempool, minGasFee } = await currentMinGasFee();
    const feeVaultBalance = await getFeeVaultBalance();

    res.json({
      chainId: CHAIN_ID,
      chainHeight,
      lastBlockTimeMs,
      blockTimeMs: BLOCK_TIME_MS,
      msUntilNextBlock: msUntilNext,
      mempoolSize: mempool,
      baseMinGasFee: BASE_MIN_GAS_FEE,
      minGasFee,
      serviceFeeRate: SERVICE_FEE_RATE,
      txTtlMs: TX_TTL_MS,
      latestBlock: latest || null,
      feeVaultBalance: Number(Number(feeVaultBalance || 0).toFixed(8)),
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
      wallet,
      registered: !!acct.publicKeyB64, // ✅ FIX
      publicKeyB64: acct.publicKeyB64,
      nonce: acct.nonce,
      lastMintMs: acct.lastMintMs,
      balance: Number(acct.balance),
      pendingDelta,
      spendableBalance: Number(acct.balance) - pendingOutgoingCost,
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
    const spendableBalance = Number(acct.balance) - pendingOutgoingCost;

    const feeVaultBalance = await getFeeVaultBalance();

    // ✅ FIX: return BOTH the old fields AND the fields the UI expects
    res.json({
      chainId: CHAIN_ID,
      wallet,

      // old fields:
      balance: Number(acct.balance),
      pendingDelta,
      spendableBalance,

      // UI-friendly fields:
      confirmed: Number(acct.balance),
      spendable: spendableBalance,
      feeVault: Number(Number(feeVaultBalance || 0).toFixed(8)),
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
        amount: Number(t.amount),
        nonce: t.nonce,
        gasFee: Number(t.gasFee),
        serviceFee: Number(t.serviceFee || 0),
        totalFee: Number(t.gasFee) + Number(t.serviceFee || 0),
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
   MINT (SIGNED)
====================== */
app.post("/mint", async (req, res) => {
  try {
    const wallet = req.body?.wallet;
    const nonce = req.body?.nonce;
    const timestamp = req.body?.timestamp;
    const signature = req.body?.signature;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = 0;
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!wallet) return res.status(400).json({ error: "Missing wallet" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    if (!Number.isFinite(gasFee) || gasFee < minGasFee) {
      return res.status(400).json({ error: "Fee too low", minGasFee });
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
      serviceFee,
      expiresAtMs,
      timestamp,
    });

    const txidExpected = txIdFromMessage(msg);
    if (req.body?.txid && String(req.body.txid) !== txidExpected) {
      return res.status(400).json({ error: "txid mismatch", expectedTxid: txidExpected, gotTxid: String(req.body.txid) });
    }

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
      serviceFee,
      timestampMs: timestamp,
      expiresAtMs,
    });

    await insertTx(tx);

    res.json({ success: true, chainId: CHAIN_ID, wallet, tx, cooldownSeconds: Math.ceil(MINT_COOLDOWN_MS / 1000) });
  } catch (e) {
    res.status(500).json({ error: e.message || "mint failed" });
  }
});

/* ======================
   SEND (SIGNED)
====================== */
app.post("/send", async (req, res) => {
  try {
    const { from, to, amount, nonce, timestamp, signature } = req.body;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    if (!from || !to) return res.status(400).json({ error: "Missing from/to" });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be positive" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const { minGasFee } = await currentMinGasFee();

    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = Number(req.body?.serviceFee ?? expectedServiceFee(amt));
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!Number.isFinite(gasFee) || gasFee < minGasFee) {
      return res.status(400).json({ error: "Fee too low", minGasFee });
    }

    const svcExpected = expectedServiceFee(amt);
    if (Number(serviceFee.toFixed(8)) !== Number(svcExpected.toFixed(8))) {
      return res.status(400).json({
        error: "Bad serviceFee (must match server formula)",
        expectedServiceFee: svcExpected,
        gotServiceFee: serviceFee,
        rate: SERVICE_FEE_RATE,
      });
    }

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    await ensureAccountExists(to);
    const fromAcct = await getAccountRow(from);

    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
    });

    const txidExpected = txIdFromMessage(msg);
    if (req.body?.txid && String(req.body.txid) !== txidExpected) {
      return res.status(400).json({ error: "txid mismatch", expectedTxid: txidExpected, gotTxid: String(req.body.txid) });
    }

    const sigOk = verifySignature({ walletPubKeyB64: fromAcct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    // accept only exact nonce for now
    if (nonce !== fromAcct.nonce) {
      return res.status(409).json({ error: "Nonce mismatch", expectedNonce: fromAcct.nonce, gotNonce: nonce });
    }

    const pendingCount = await countPendingForWallet({ type: "send", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs for wallet", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendable = Number(fromAcct.balance) - pendingOutgoingCost;

    const totalFee = gasFee + serviceFee;
    const totalCost = amt + totalFee;

    if (spendable < totalCost) {
      return res.status(400).json({
        error: "Insufficient spendable balance",
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
      serviceFee,
      timestampMs: timestamp,
      expiresAtMs,
    });

    await insertTx(tx);

    res.json({
      success: true,
      chainId: CHAIN_ID,
      tx,
      fees: { minGasFee, gasFee, serviceFee, totalFee, totalCost },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "send failed" });
  }
});

/* ======================
   RBF REPLACE (SIGNED)
   - Replaces an existing *pending* send with the same (fromWallet, nonce)
   - Requires higher gasFee than the pending tx
====================== */
app.post("/rbf", async (req, res) => {
  try {
    const { from, to, amount, nonce, timestamp, signature } = req.body;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });
    if (!from || !to) return res.status(400).json({ error: "Missing from/to" });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be positive" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = Number(req.body?.serviceFee ?? expectedServiceFee(amt));
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!Number.isFinite(gasFee) || gasFee < minGasFee) {
      return res.status(400).json({ error: "Fee too low", minGasFee });
    }

    const svcExpected = expectedServiceFee(amt);
    if (Number(serviceFee.toFixed(8)) !== Number(svcExpected.toFixed(8))) {
      return res.status(400).json({
        error: "Bad serviceFee (must match server formula)",
        expectedServiceFee: svcExpected,
        gotServiceFee: serviceFee,
        rate: SERVICE_FEE_RATE,
      });
    }

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    await ensureAccountExists(to);
    const fromAcct = await getAccountRow(from);

    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
    });

    const sigOk = verifySignature({ walletPubKeyB64: fromAcct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    const txidExpected = txIdFromMessage(msg);
    if (req.body?.txid && String(req.body.txid) !== txidExpected) {
      return res.status(400).json({ error: "txid mismatch", expectedTxid: txidExpected, gotTxid: String(req.body.txid) });
    }

    // Mark the old pending tx as failed (replaced), then insert the replacement as a new tx (new txid).
    await run(
      db,
      `UPDATE transactions SET status='failed', failReason=? WHERE id=?`,
      ["Replaced by RBF", pending.id]
    );

    const tx = createTx({
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      timestampMs: timestamp,
      expiresAtMs,
    });

    await insertTx(tx);

    const inserted = await get(db, `SELECT * FROM transactions WHERE id=?`, [tx.id]);
    return res.json({ success: true, chainId: CHAIN_ID, tx: inserted, replaced: { id: pending.id } });
  } catch (e) {
    return res.status(500).json({ error: e.message || "rbf failed" });
  }
});

/* ======================
   CANCEL (SIGNED)
   - Replaces an existing pending send with a self-send (net 0 transfer)
====================== */
app.post("/cancel", async (req, res) => {
  try {
    const { from, nonce, timestamp, signature } = req.body;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });
    if (!from) return res.status(400).json({ error: "Missing from" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const amt = ONE_SAT;
    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = Number(req.body?.serviceFee ?? expectedServiceFee(amt));
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!Number.isFinite(gasFee) || gasFee < minGasFee) {
      return res.status(400).json({ error: "Fee too low", minGasFee });
    }

    const svcExpected = expectedServiceFee(amt);
    if (Number(serviceFee.toFixed(8)) !== Number(svcExpected.toFixed(8))) {
      return res.status(400).json({
        error: "Bad serviceFee (must match server formula)",
        expectedServiceFee: svcExpected,
        gotServiceFee: serviceFee,
        rate: SERVICE_FEE_RATE,
      });
    }

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    const fromAcct = await getAccountRow(from);
    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "send",
      from,
      to: from,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
    });

    const sigOk = verifySignature({ walletPubKeyB64: fromAcct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    // Find existing pending tx.
    const pending = await get(
      db,
      `SELECT id, gasFee, amount, toWallet, serviceFee, expiresAtMs
       FROM transactions
       WHERE status='pending' AND type='send' AND fromWallet=? AND nonce=?
       ORDER BY timestampMs DESC
       LIMIT 1`,
      [from, nonce]
    );
    if (!pending) return res.status(404).json({ error: "No pending tx found for nonce" });
    if (Number(pending.expiresAtMs || 0) < now()) return res.status(410).json({ error: "Pending tx already expired" });

    // Cancel is also a replacement — enforce higher gasFee.
    if (gasFee <= Number(pending.gasFee || 0)) {
      return res.status(400).json({ error: "gasFee must be higher than current pending gasFee", currentGasFee: Number(pending.gasFee || 0) });
    }

    // Spendable check similar to RBF.
    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const oldTotalCost = Number(pending.amount || 0) + Number(pending.gasFee || 0) + Number(pending.serviceFee || 0);
    const newTotalCost = amt + gasFee + serviceFee;

    const spendable = Number(fromAcct.balance) - (pendingOutgoingCost - oldTotalCost);
    if (spendable < newTotalCost) {
      return res.status(400).json({
        error: "Insufficient spendable balance",
        confirmedBalance: Number(fromAcct.balance),
        pendingOutgoingCost,
        spendableBalance: spendable,
        required: newTotalCost,
      });
    }

        const txidExpected = txIdFromMessage(msg);
    if (req.body?.txid && String(req.body.txid) !== txidExpected) {
      return res.status(400).json({ error: "txid mismatch", expectedTxid: txidExpected, gotTxid: String(req.body.txid) });
    }

    // Mark the old pending tx as failed (canceled), then insert the cancel tx as a new tx (new txid).
    await run(
      db,
      `UPDATE transactions SET status='failed', failReason=? WHERE id=?`,
      ["Canceled", pending.id]
    );

    const tx = createTx({
      type: "send",
      from,
      to: from,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      timestampMs: timestamp,
      expiresAtMs,
    });

    await insertTx(tx);

    const inserted = await get(db, `SELECT * FROM transactions WHERE id=?`, [tx.id]);
    return res.json({ success: true, chainId: CHAIN_ID, tx: inserted, canceled: { id: pending.id } });

  } catch (e) {
    return res.status(500).json({ error: e.message || "cancel failed" });
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
      console.log(`🧱 blockTime: ${BLOCK_TIME_MS}ms`);
    });
  } catch (e) {
    console.error("FATAL STARTUP ERROR:", e);
    process.exit(1);
  }
})();
