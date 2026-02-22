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
const MINT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// Blocks
const BLOCK_TIME_MS = 5000;
const MAX_BLOCK_TXS = 500;

// Failure / queue rules
const TX_TTL_MS = 60 * 1000;
const MAX_PENDING_PER_WALLET = 20;
const MAX_TXS_PER_WALLET_PER_BLOCK = 5;

// Fees (base)
// Base gas is the smallest on-chain unit (1 Honey Cone).
const BASE_MIN_GAS_FEE = 0.00000001;
// 0.0005% of USD value, paid in HNY (at $1/HNY)
const SERVICE_FEE_RATE = 0.000005;
const HNY_PRICE_USD = 1.00;

// 1 satoshi-like unit
const ONE_SAT = 0.00000001;

const CHAIN_ID = process.env.HIVE_CHAIN_ID || "hny-devnet-1";
const FEE_VAULT = "HNY_FEE_VAULT";
const STAKE_VAULT = "HNY_STAKE_VAULT";

// Staking (simple testnet model)
// NOTE: This is a wallet-facing feature for testnet/devnet. Mainnet economics can replace this later.
const STAKING_APR = Number(process.env.HNY_STAKING_APR || 0.05); // 5% APR default


// ========== REAL-TIME PRICE FEEDS - PYTH NETWORK ==========
const { fetchPythPrices } = require('./pyth-price-feed');

async function fetchRealPrices() {
  const prices = await fetchPythPrices();

  for (const [symbol, price] of Object.entries(prices)) {
    await run(
      db,
      `UPDATE tokens SET mockPriceUSD=? WHERE symbol=?`,
      [price, symbol]
    ).catch(() => { }); // Ignore errors
  }

  return prices;
}

// Fetch prices every minute
setInterval(() => {
  fetchRealPrices().catch(console.error);
}, 60000);

// Initial fetch
fetchRealPrices().catch(console.error);

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
 * chainId|type|from|to|amount|nonce|gasFee|serviceFee|expiresAtMs|timestamp|metaJson
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
  metaJson,
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
    String(metaJson ?? ""),
  ].join("|");
}

// Service fee = 0.0005% of USD value, paid in HNY.
// e.g. 1 BTC @ $65,000 => fee = 65000 * 0.000005 = 0.325 HNY
// e.g. 1 ETH @ $3,500  => fee = 3500 * 0.000005 = 0.0175 HNY
// e.g. 100 HNY @ $1    => fee = 100 * 0.000005 = 0.0005 HNY
function expectedServiceFee(amount, tokenPriceUSD) {
  const price = Number(tokenPriceUSD || HNY_PRICE_USD);
  const usdValue = Number(amount) * price;
  const feeInHNY = (usdValue * SERVICE_FEE_RATE) / HNY_PRICE_USD;
  return Number(feeInHNY.toFixed(8));
}

function daysToMs(days) {
  return Number(days) * 24 * 60 * 60 * 1000;
}

function computeStakingReward(principal, startMs, endMs) {
  const p = Number(principal);
  const s = Number(startMs);
  const e = Number(endMs);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  const r = p * STAKING_APR * ((e - s) / yearMs);
  return Number(r.toFixed(8));
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
  // Outgoing cost reserved from spendable balance.
  // - send/stake reserve amount + fees
  // - claim/unstake/unlock reserve fees only (payout/inflow is not spendable until confirmed)
  const row = await get(
    db,
    `SELECT
       COALESCE((SELECT SUM(amount + gasFee + serviceFee)
                 FROM transactions
                 WHERE status='pending' AND type IN ('send','stake') AND fromWallet=?), 0) +
       COALESCE((SELECT SUM(gasFee + serviceFee)
                 FROM transactions
                 WHERE status='pending' AND type IN ('claim','unstake','unlock') AND fromWallet=?), 0)
     AS s`,
    [wallet, wallet]
  );
  return Number(row?.s || 0);
}

async function getPendingDelta(wallet) {
  // Net pending change to balance (for UI "Pending" display).
  // Incoming: mint, received sends, claim payouts, unstake payouts
  // Outgoing: send/stake total cost, and fees for claim/unstake/unlock
  const row = await get(
    db,
    `SELECT
       COALESCE((SELECT SUM(amount) FROM transactions WHERE status='pending' AND type='mint' AND toWallet=?), 0) +
       COALESCE((SELECT SUM(amount) FROM transactions WHERE status='pending' AND type='send' AND toWallet=?), 0) +
       COALESCE((SELECT SUM(amount) FROM transactions WHERE status='pending' AND type='claim' AND toWallet=?), 0) +
       COALESCE((SELECT SUM(amount) FROM transactions WHERE status='pending' AND type='unstake' AND toWallet=?), 0) -
       COALESCE((SELECT SUM(amount + gasFee + serviceFee) FROM transactions WHERE status='pending' AND type IN ('send','stake') AND fromWallet=?), 0) -
       COALESCE((SELECT SUM(gasFee + serviceFee) FROM transactions WHERE status='pending' AND type IN ('claim','unstake','unlock') AND fromWallet=?), 0)
     AS d`,
    [wallet, wallet, wallet, wallet, wallet, wallet]
  );
  return Number(row?.d || 0);
}

async function countPendingForWallet({ type, wallet }) {
  const t = String(type || "");
  if (t === "send") {
    const r = await get(db, `SELECT COUNT(*) AS c FROM transactions WHERE status='pending' AND type='send' AND fromWallet=?`, [wallet]);
    return Number(r?.c || 0);
  }
  if (t === "mint") {
    const r = await get(db, `SELECT COUNT(*) AS c FROM transactions WHERE status='pending' AND type='mint' AND toWallet=?`, [wallet]);
    return Number(r?.c || 0);
  }
  if (t === "stake" || t === "unstake" || t === "unlock" || t === "claim") {
    const r = await get(db, `SELECT COUNT(*) AS c FROM transactions WHERE status='pending' AND type=? AND fromWallet=?`, [t, wallet]);
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

function createTx({ type, from = null, to, amount, nonce, gasFee, serviceFee, metaJson = null, timestampMs, expiresAtMs }) {
  const id = crypto.randomUUID();
  const hash = sha256Hex(
    `${CHAIN_ID}:${id}:${type}:${from ?? ""}:${to}:${fmt8(amount)}:${nonce}:${fmt8(gasFee)}:${fmt8(serviceFee)}:${expiresAtMs}:${timestampMs}:${metaJson ?? ""}`
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
    serviceFee,
    metaJson,
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
     (id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, serviceFee, metaJson, status, failReason, expiresAtMs, blockHeight, blockHash, timestampMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      tx.metaJson,
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
    `SELECT id, hash, type, fromWallet, toWallet, amount, nonce, gasFee, serviceFee, metaJson, expiresAtMs, timestampMs
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
    const wallets = new Set([FEE_VAULT, STAKE_VAULT]);
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
      if (!Number.isFinite(amt) || (amt <= 0 && tx.type !== "unlock")) {
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

      if (tx.type === "stake") {
        const from = tx.fromWallet;
        const to = tx.toWallet;
        if (!from || to !== STAKE_VAULT) {
          await failTx(tx.id, height, "invalid_stake_vault");
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

        let meta;
        try {
          meta = tx.metaJson ? JSON.parse(tx.metaJson) : null;
        } catch {
          meta = null;
        }
        const lockDays = Number(meta?.lockDays);
        if (!Number.isInteger(lockDays) || lockDays <= 0 || lockDays > 3650) {
          await failTx(tx.id, height, "invalid_lock_days");
          continue;
        }

        bump(from);
        working[from] = fromBal - totalCost;
        working[STAKE_VAULT] = (working[STAKE_VAULT] || 0) + amt;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;

        const startMs = ts;
        const unlockAtMs = startMs + daysToMs(lockDays);
        await run(
          db,
          `INSERT INTO staking_positions
           (id, wallet, principal, lockDays, startMs, unlockAtMs, status, rewardPaid, unstakedAtMs, stakeTxId, unstakeTxId, createdAtMs)
           VALUES (?, ?, ?, ?, ?, ?, 'staked', 0, NULL, ?, NULL, ?)`,
          [tx.id, from, amt, lockDays, startMs, unlockAtMs, tx.id, ts]
        );

        // Mint stHNY tokens (1:1 with staked amount)
        const stHnyBal = await get(
          db,
          `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol='stHNY'`,
          [from]
        );
        
        if (stHnyBal) {
          const newBal = Number(stHnyBal.balance) + amt;
          await run(
            db,
            `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol='stHNY'`,
            [newBal, from]
          );
        } else {
          await run(
            db,
            `INSERT INTO token_balances (wallet, tokenSymbol, balance, createdAtMs)
             VALUES (?, 'stHNY', ?, ?)`,
            [from, amt, ts]
          );
        }

        await run(db, `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`, [height, "TBD", tx.id]);
        confirmedIds.push(tx.id);
        continue;
      }

      if (tx.type === "unlock") {
        const wallet = tx.fromWallet;
        const to = tx.toWallet;
        if (!wallet || to !== wallet) {
          await failTx(tx.id, height, "invalid_unlock_to");
          continue;
        }
        if (isOverLimit(wallet)) {
          await failTx(tx.id, height, "per_wallet_block_limit");
          continue;
        }

        let meta;
        try {
          meta = tx.metaJson ? JSON.parse(tx.metaJson) : null;
        } catch {
          meta = null;
        }
        const positionId = String(meta?.positionId || "").trim();
        if (!positionId) {
          await failTx(tx.id, height, "missing_position_id");
          continue;
        }

        const pos = await get(db, `SELECT id, wallet, lockDays, status FROM staking_positions WHERE id=?`, [positionId]);
        if (!pos || pos.wallet !== wallet) {
          await failTx(tx.id, height, "position_not_found");
          continue;
        }
        if (String(pos.status) !== "staked") {
          await failTx(tx.id, height, "position_not_staked");
          continue;
        }

        const lockDays = Number(pos.lockDays);
        const delayDays = lockDays <= 30 ? 3 : 7;
        const withdrawAtMs = ts + daysToMs(delayDays);

        // Unlock has no payout; wallet only pays fees.
        const walletBal = working[wallet] || 0;
        if (walletBal < totalFee) {
          await failTx(tx.id, height, "insufficient_confirmed_for_fees");
          continue;
        }

        bump(wallet);
        working[wallet] = walletBal - totalFee;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;

        await run(
          db,
          `UPDATE staking_positions
             SET status='unlocking', unlockingAtMs=?, rewardsFrozenAtMs=?, withdrawAtMs=?, unlockTxId=?
           WHERE id=?`,
          [ts, ts, withdrawAtMs, tx.id, positionId]
        );

        await run(db, `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`, [height, "TBD", tx.id]);
        confirmedIds.push(tx.id);
        continue;
      }

      if (tx.type === "claim") {
        const wallet = tx.fromWallet;
        const to = tx.toWallet;
        if (!wallet || to !== wallet) {
          await failTx(tx.id, height, "invalid_claim_to");
          continue;
        }
        if (isOverLimit(wallet)) {
          await failTx(tx.id, height, "per_wallet_block_limit");
          continue;
        }

        let meta;
        try {
          meta = tx.metaJson ? JSON.parse(tx.metaJson) : null;
        } catch {
          meta = null;
        }
        const positionId = String(meta?.positionId || "").trim();
        if (!positionId) {
          await failTx(tx.id, height, "missing_position_id");
          continue;
        }

        const pos = await get(
          db,
          `SELECT id, wallet, principal, startMs, status, rewardPaid, rewardsFrozenAtMs FROM staking_positions WHERE id=?`,
          [positionId]
        );
        if (!pos || pos.wallet !== wallet) {
          await failTx(tx.id, height, "position_not_found");
          continue;
        }
        if (String(pos.status) !== "staked") {
          await failTx(tx.id, height, "claim_not_allowed");
          continue;
        }

        const principal = Number(pos.principal);
        const endMs = Number(pos.rewardsFrozenAtMs || ts);
        const totalReward = computeStakingReward(principal, Number(pos.startMs), endMs);
        const alreadyPaid = Number(pos.rewardPaid || 0);
        const claimable = Number(Math.max(0, totalReward - alreadyPaid).toFixed(8));
        if (!(claimable > 0)) {
          await failTx(tx.id, height, "nothing_to_claim");
          continue;
        }

        // Fees: wallet pays gas + service on claim amount.
        const svc = expectedServiceFee(claimable);
        const totalFee2 = Number((Number(tx.gasFee || 0) + svc).toFixed(8));
        const walletBal = working[wallet] || 0;
        if (walletBal < totalFee2) {
          await failTx(tx.id, height, "insufficient_confirmed_for_fees");
          continue;
        }
        const stakeVaultBal = working[STAKE_VAULT] || 0;
        if (stakeVaultBal < claimable) {
          await failTx(tx.id, height, "stake_vault_insufficient");
          continue;
        }

        bump(wallet);
        working[wallet] = walletBal - totalFee2 + claimable;
        working[STAKE_VAULT] = stakeVaultBal - claimable;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee2;

        await run(db, `UPDATE staking_positions SET rewardPaid=?, lastClaimTxId=? WHERE id=?`, [alreadyPaid + claimable, tx.id, positionId]);
        await run(db, `UPDATE transactions SET serviceFee=?, status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`, [svc, height, "TBD", tx.id]);
        confirmedIds.push(tx.id);
        continue;
      }

      if (tx.type === "unstake") {
        const wallet = tx.fromWallet;
        const to = tx.toWallet;
        if (!wallet || to !== wallet) {
          await failTx(tx.id, height, "invalid_unstake_to");
          continue;
        }
        if (isOverLimit(wallet)) {
          await failTx(tx.id, height, "per_wallet_block_limit");
          continue;
        }

        let meta;
        try {
          meta = tx.metaJson ? JSON.parse(tx.metaJson) : null;
        } catch {
          meta = null;
        }
        const positionId = String(meta?.positionId || "").trim();
        if (!positionId) {
          await failTx(tx.id, height, "missing_position_id");
          continue;
        }

        const pos = await get(
          db,
          `SELECT id, wallet, principal, lockDays, startMs, unlockAtMs, withdrawAtMs, rewardsFrozenAtMs, status, rewardPaid
             FROM staking_positions
            WHERE id=?`,
          [positionId]
        );
        if (!pos || pos.wallet !== wallet) {
          await failTx(tx.id, height, "position_not_found");
          continue;
        }
        const st = String(pos.status);
        if (st === "staked") {
          // legacy direct-unstake path: only after full lock expires
          if (ts < Number(pos.unlockAtMs)) {
            await failTx(tx.id, height, "position_locked");
            continue;
          }
        } else if (st === "unlocking") {
          // new flow: withdraw only after unlock delay
          if (ts < Number(pos.withdrawAtMs || 0)) {
            await failTx(tx.id, height, "position_unlocking");
            continue;
          }
        } else {
          await failTx(tx.id, height, "position_not_withdrawable");
          continue;
        }

        const principal = Number(pos.principal);
        const rewardEnd = st === "unlocking" ? Number(pos.rewardsFrozenAtMs || ts) : ts;
        const totalReward = computeStakingReward(principal, Number(pos.startMs), rewardEnd);
        const alreadyPaid = Number(pos.rewardPaid || 0);
        const remainingReward = Number(Math.max(0, totalReward - alreadyPaid).toFixed(8));
        const payout = Number((principal + remainingReward).toFixed(8));

        // Wallet pays only fees; payout comes from stake vault.
        const walletBal = working[wallet] || 0;
        if (walletBal < totalFee) {
          await failTx(tx.id, height, "insufficient_confirmed_for_fees");
          continue;
        }

        const stakeVaultBal = working[STAKE_VAULT] || 0;
        if (stakeVaultBal < payout) {
          await failTx(tx.id, height, "stake_vault_insufficient");
          continue;
        }

        bump(wallet);
        working[wallet] = walletBal - totalFee + payout;
        working[STAKE_VAULT] = stakeVaultBal - payout;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;

        await run(
          db,
          `UPDATE staking_positions
              SET status='unstaked', rewardPaid=?, unstakedAtMs=?, unstakeTxId=?
            WHERE id=?`,
          [alreadyPaid + remainingReward, ts, tx.id, positionId]
        );

        // Burn stHNY tokens (principal amount, not including rewards)
        const stHnyBal = await get(
          db,
          `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol='stHNY'`,
          [wallet]
        );
        
        if (stHnyBal && Number(stHnyBal.balance) >= principal) {
          const newBal = Number(stHnyBal.balance) - principal;
          await run(
            db,
            `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol='stHNY'`,
            [newBal, wallet]
          );
        }

        await run(db, `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`, [height, "TBD", tx.id]);
        confirmedIds.push(tx.id);
        continue;
      }

      if (tx.type === "token_send") {
        const wallet = tx.fromWallet;
        const to = tx.toWallet;
        if (!wallet || !to) {
          await failTx(tx.id, height, "invalid_token_send");
          continue;
        }
        if (isOverLimit(wallet)) {
          await failTx(tx.id, height, "per_wallet_block_limit");
          continue;
        }

        let meta;
        try {
          meta = tx.metaJson ? JSON.parse(tx.metaJson) : null;
        } catch {
          meta = null;
        }
        const tokenSymbol = String(meta?.tokenSymbol || "").trim();
        if (!tokenSymbol || tokenSymbol === 'HNY') {
          await failTx(tx.id, height, "invalid_token_symbol");
          continue;
        }

        const amt = Number(tx.amount);

        // Check sender's token balance
        const senderTokenBal = await get(
          db,
          `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`,
          [wallet, tokenSymbol]
        );
        if (!senderTokenBal || Number(senderTokenBal.balance) < amt) {
          await failTx(tx.id, height, "insufficient_token_balance");
          continue;
        }

        // Check sender can pay HNY fees
        const walletBal = working[wallet] || 0;
        if (walletBal < totalFee) {
          await failTx(tx.id, height, "insufficient_hny_for_fees");
          continue;
        }

        bump(wallet);
        
        // Deduct HNY fees
        working[wallet] = walletBal - totalFee;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;

        // ========== SPECIAL HANDLING FOR stHNY TRANSFERS ==========
        if (tokenSymbol === 'stHNY') {
          // When transferring stHNY, we need to split the underlying staking positions
          // This allows the recipient to actually unstake and withdraw their portion
          
          // Get sender's active staking positions (oldest first for FIFO)
          const senderPositions = await all(
            db,
            `SELECT id, wallet, principal, lockDays, startMs, unlockAtMs, status, rewardPaid,
                    unlockingAtMs, withdrawAtMs, rewardsFrozenAtMs, stakeTxId
             FROM staking_positions
             WHERE wallet=? AND status IN ('staked', 'unlocking')
             ORDER BY startMs ASC`,
            [wallet]
          );

          let remainingToTransfer = amt;
          const splitPositions = [];

          for (const pos of senderPositions) {
            if (remainingToTransfer <= 0) break;

            const posPrincipal = Number(pos.principal);
            const transferFromThisPos = Math.min(remainingToTransfer, posPrincipal);

            if (transferFromThisPos >= posPrincipal) {
              // Transfer entire position - just change ownership
              await run(
                db,
                `UPDATE staking_positions SET wallet=? WHERE id=?`,
                [to, pos.id]
              );
              splitPositions.push({ positionId: pos.id, amount: posPrincipal, action: 'transferred' });
            } else {
              // Partial transfer - split the position
              const remainingInOriginal = posPrincipal - transferFromThisPos;
              
              // Update original position with reduced principal
              await run(
                db,
                `UPDATE staking_positions SET principal=? WHERE id=?`,
                [remainingInOriginal, pos.id]
              );

              // Create new position for recipient with transferred amount
              const newPosId = `${pos.id}_split_${Date.now()}`;
              await run(
                db,
                `INSERT INTO staking_positions
                 (id, wallet, principal, lockDays, startMs, unlockAtMs, status, rewardPaid,
                  unlockingAtMs, withdrawAtMs, rewardsFrozenAtMs, stakeTxId, createdAtMs)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  newPosId,
                  to,
                  transferFromThisPos,
                  pos.lockDays,
                  pos.startMs,
                  pos.unlockAtMs,
                  pos.status,
                  0, // Recipient starts with 0 rewards paid (they get their share going forward)
                  pos.unlockingAtMs,
                  pos.withdrawAtMs,
                  pos.rewardsFrozenAtMs,
                  pos.stakeTxId,
                  ts
                ]
              );
              
              splitPositions.push({ 
                originalId: pos.id, 
                newId: newPosId, 
                originalRemaining: remainingInOriginal,
                transferred: transferFromThisPos 
              });
            }

            remainingToTransfer -= transferFromThisPos;
          }

          if (remainingToTransfer > 0.00000001) {
            // Shouldn't happen if balances are consistent, but safety check
            await failTx(tx.id, height, "insufficient_staking_positions_for_sthny_transfer");
            continue;
          }
        }

        // Transfer token balances (works for all tokens including stHNY)
        const newSenderBal = Number(senderTokenBal.balance) - amt;
        await run(
          db,
          `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`,
          [newSenderBal, wallet, tokenSymbol]
        );

        // Get or create recipient token balance
        const recipientTokenBal = await get(
          db,
          `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`,
          [to, tokenSymbol]
        );
        
        if (recipientTokenBal) {
          const newRecipientBal = Number(recipientTokenBal.balance) + amt;
          await run(
            db,
            `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`,
            [newRecipientBal, to, tokenSymbol]
          );
        } else {
          await run(
            db,
            `INSERT INTO token_balances (wallet, tokenSymbol, balance, createdAtMs)
             VALUES (?, ?, ?, ?)`,
            [to, tokenSymbol, amt, ts]
          );
        }

        // stHNY position splitting already handled above (line 831 block).

        await run(db, `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`, [height, "TBD", tx.id]);
        confirmedIds.push(tx.id);
        continue;
      }

      if (tx.type === "swap") {
        const wallet = tx.fromWallet;
        if (!wallet) {
          await failTx(tx.id, height, "invalid_swap");
          continue;
        }
        if (isOverLimit(wallet)) {
          await failTx(tx.id, height, "per_wallet_block_limit");
          continue;
        }

        let meta;
        try {
          meta = tx.metaJson ? JSON.parse(tx.metaJson) : null;
        } catch {
          meta = null;
        }
        
        const poolId = String(meta?.poolId || "").trim();
        const tokenIn = String(meta?.tokenIn || "").trim();
        const tokenOut = String(meta?.tokenOut || "").trim();
        const amountIn = Number(meta?.amountIn || 0);
        const minAmountOut = Number(meta?.minAmountOut || 0);

        if (!poolId || !tokenIn || !tokenOut || amountIn <= 0) {
          await failTx(tx.id, height, "invalid_swap_params");
          continue;
        }

        // Helper: compute AMM output
        function ammOut(rIn, rOut, input, fee) {
          const withFee = input * (1 - fee);
          return (rOut * withFee) / (rIn + withFee);
        }

        // Determine if multi-hop (poolId contains "|")
        const isMultiHop = poolId.includes("|");
        let amountOut, pool1, pool2;

        if (isMultiHop) {
          // Multi-hop: tokenIn → HNY → tokenOut
          const [p1Id, p2Id] = poolId.split("|");
          pool1 = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [p1Id]);
          pool2 = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [p2Id]);
          if (!pool1 || !pool2) {
            await failTx(tx.id, height, "pool_not_found");
            continue;
          }

          // Leg 1: tokenIn → HNY
          const rev1 = pool1.tokenA !== tokenIn;
          const rIn1 = rev1 ? Number(pool1.reserveB) : Number(pool1.reserveA);
          const rOut1 = rev1 ? Number(pool1.reserveA) : Number(pool1.reserveB);
          const hnyMid = ammOut(rIn1, rOut1, amountIn, Number(pool1.feeRate || 0.003));

          // Leg 2: HNY → tokenOut
          const rev2 = pool2.tokenA !== "HNY";
          const rIn2 = rev2 ? Number(pool2.reserveB) : Number(pool2.reserveA);
          const rOut2 = rev2 ? Number(pool2.reserveA) : Number(pool2.reserveB);
          amountOut = ammOut(rIn2, rOut2, hnyMid, Number(pool2.feeRate || 0.003));

          if (amountOut < minAmountOut) {
            await failTx(tx.id, height, "slippage_exceeded");
            continue;
          }

          // Check balances (tokenIn is never HNY in multi-hop)
          const tokenBal = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, tokenIn]);
          if (!tokenBal || Number(tokenBal.balance) < amountIn) {
            await failTx(tx.id, height, "insufficient_token_in");
            continue;
          }
          const walletBal = working[wallet] || 0;
          if (walletBal < totalFee) {
            await failTx(tx.id, height, "insufficient_hny_for_fees");
            continue;
          }

          bump(wallet);

          // Deduct tokenIn from sender
          const newSenderBal = Number(tokenBal.balance) - amountIn;
          await run(db, `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`, [newSenderBal, wallet, tokenIn]);
          working[wallet] = (working[wallet] || 0) - totalFee;
          working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;

          // Credit tokenOut to sender
          const recipBal = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, tokenOut]);
          if (recipBal) {
            await run(db, `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`, [Number(recipBal.balance) + amountOut, wallet, tokenOut]);
          } else {
            await run(db, `INSERT INTO token_balances (wallet, tokenSymbol, balance, createdAtMs) VALUES (?, ?, ?, ?)`, [wallet, tokenOut, amountOut, ts]);
          }

          // Update pool1 reserves
          const newRIn1 = rIn1 + amountIn;
          const newROut1 = rOut1 - hnyMid;
          if (rev1) {
            await run(db, `UPDATE liquidity_pools SET reserveA=?, reserveB=? WHERE id=?`, [newROut1, newRIn1, p1Id]);
          } else {
            await run(db, `UPDATE liquidity_pools SET reserveA=?, reserveB=? WHERE id=?`, [newRIn1, newROut1, p1Id]);
          }

          // Update pool2 reserves
          const newRIn2 = rIn2 + hnyMid;
          const newROut2 = rOut2 - amountOut;
          if (rev2) {
            await run(db, `UPDATE liquidity_pools SET reserveA=?, reserveB=? WHERE id=?`, [newROut2, newRIn2, p2Id]);
          } else {
            await run(db, `UPDATE liquidity_pools SET reserveA=?, reserveB=? WHERE id=?`, [newRIn2, newROut2, p2Id]);
          }

        } else {
          // Direct swap (single pool)
          const pool = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [poolId]);
          if (!pool) {
            await failTx(tx.id, height, "pool_not_found");
            continue;
          }

          const reversed = pool.tokenA === tokenOut && pool.tokenB === tokenIn;
          const reserveIn = reversed ? Number(pool.reserveB) : Number(pool.reserveA);
          const reserveOut = reversed ? Number(pool.reserveA) : Number(pool.reserveB);
          const feeRate = Number(pool.feeRate || 0.003);
          amountOut = ammOut(reserveIn, reserveOut, amountIn, feeRate);

          if (amountOut < minAmountOut) {
            await failTx(tx.id, height, "slippage_exceeded");
            continue;
          }

          // Check balances
          if (tokenIn === 'HNY') {
            if ((working[wallet] || 0) < amountIn + totalFee) {
              await failTx(tx.id, height, "insufficient_hny");
              continue;
            }
          } else {
            const tokenBal = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, tokenIn]);
            if (!tokenBal || Number(tokenBal.balance) < amountIn) {
              await failTx(tx.id, height, "insufficient_token_in");
              continue;
            }
            if ((working[wallet] || 0) < totalFee) {
              await failTx(tx.id, height, "insufficient_hny_for_fees");
              continue;
            }
          }

          bump(wallet);

          // Deduct tokenIn
          if (tokenIn === 'HNY') {
            working[wallet] = (working[wallet] || 0) - amountIn - totalFee;
          } else {
            const tokenBal = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, tokenIn]);
            await run(db, `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`, [Number(tokenBal.balance) - amountIn, wallet, tokenIn]);
            working[wallet] = (working[wallet] || 0) - totalFee;
          }

          working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;

          // Credit tokenOut
          if (tokenOut === 'HNY') {
            working[wallet] = (working[wallet] || 0) + amountOut;
          } else {
            const tokenBal = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, tokenOut]);
            if (tokenBal) {
              await run(db, `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`, [Number(tokenBal.balance) + amountOut, wallet, tokenOut]);
            } else {
              await run(db, `INSERT INTO token_balances (wallet, tokenSymbol, balance, createdAtMs) VALUES (?, ?, ?, ?)`, [wallet, tokenOut, amountOut, ts]);
            }
          }

          // Update pool reserves
          const newReserveIn = reserveIn + amountIn;
          const newReserveOut = reserveOut - amountOut;
          if (reversed) {
            await run(db, `UPDATE liquidity_pools SET reserveA=?, reserveB=? WHERE id=?`, [newReserveOut, newReserveIn, poolId]);
          } else {
            await run(db, `UPDATE liquidity_pools SET reserveA=?, reserveB=? WHERE id=?`, [newReserveIn, newReserveOut, poolId]);
          }
        }

        await run(db, `UPDATE transactions SET status='confirmed', failReason=NULL, blockHeight=?, blockHash=? WHERE id=?`, [height, "TBD", tx.id]);
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

    // Include token prices so client can compute USD-based service fees
    const tokenRows = await all(db, `SELECT symbol, mockPriceUSD FROM tokens`);
    const tokenPricesUSD = {};
    for (const t of tokenRows) {
      tokenPricesUSD[t.symbol] = Number(t.mockPriceUSD || 0);
    }

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
      tokenPricesUSD,
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
        metaJson: t.metaJson || null,
      }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message || "transactions failed" });
  }
});


app.get("/tx/:txid", async (req, res) => {
  try {
    const txid = String(req.params.txid || "").trim();
    if (!txid) return res.status(400).json({ error: "Missing txid" });

    const row = await get(db, "SELECT * FROM transactions WHERE id=? OR hash=? LIMIT 1", [txid, txid]);
    if (!row) return res.status(404).json({ error: "Not found" });

    // Normalize common field names for clients
    res.json({ tx: row });
  } catch (e) {
    res.status(500).json({ error: e.message || "tx lookup failed" });
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

    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    const remaining = acct.lastMintMs + MINT_COOLDOWN_MS - now();
    if (remaining > 0) {
      const cooldownSeconds = Math.ceil(remaining / 1000);
      res.set("Retry-After", String(cooldownSeconds));
      return res.status(429).json({ error: "Cooldown active", cooldownSeconds });
    }

    // Also check seed fingerprint cooldown (prevents creating new wallet to bypass cooldown)
    const seedFp = String(req.body?.seedFingerprint || "").trim();
    if (seedFp) {
      const fpCooldown = await get(db, 
        `SELECT MAX(timestampMs) as lastMs FROM transactions 
         WHERE type='mint' AND status IN ('confirmed','pending') AND metaJson LIKE ?`,
        [`%"seedFingerprint":"${seedFp}"%`]
      );
      if (fpCooldown?.lastMs) {
        const fpRemaining = Number(fpCooldown.lastMs) + MINT_COOLDOWN_MS - now();
        if (fpRemaining > 0) {
          return res.status(429).json({ error: "Cooldown active (seed phrase limit)", cooldownSeconds: Math.ceil(fpRemaining / 1000) });
        }
      }
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
      metaJson: seedFp ? JSON.stringify({ seedFingerprint: seedFp }) : null,
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
   STAKING (SIGNED)
====================== */

// also support query-style for easier mobile/web parity
app.get("/staking/positions", async (req, res) => {
  try {
    const wallet = String(req.query?.wallet || "").trim();
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const rows = await all(
      db,
      `SELECT id, wallet, principal, lockDays, startMs, unlockAtMs, status, rewardPaid,
              unlockingAtMs, withdrawAtMs, rewardsFrozenAtMs, unlockTxId, lastClaimTxId,
              unstakedAtMs, stakeTxId, unstakeTxId
         FROM staking_positions
        WHERE wallet=? AND status != 'unstaked'
        ORDER BY startMs DESC`,
      [wallet]
    );

    const ts = now();
    const positions = rows.map((r) => {
      const principal = Number(r.principal);
      const startMs = Number(r.startMs);
      const unlockAtMs = Number(r.unlockAtMs);
      const withdrawAtMs = r.withdrawAtMs == null ? null : Number(r.withdrawAtMs);
      const unlockingAtMs = r.unlockingAtMs == null ? null : Number(r.unlockingAtMs);
      const rewardsFrozenAtMs = r.rewardsFrozenAtMs == null ? null : Number(r.rewardsFrozenAtMs);
      const status = String(r.status);
      const endMs = status === "unlocking" ? Number(rewardsFrozenAtMs || ts) : ts;
      const accruedTotal = status === "staked" || status === "unlocking" ? computeStakingReward(principal, startMs, endMs) : Number(r.rewardPaid || 0);
      const paid = Number(r.rewardPaid || 0);
      const claimable = Number(Math.max(0, accruedTotal - paid).toFixed(8));
      return {
        id: r.id,
        wallet: r.wallet,
        principal: Number(principal.toFixed(8)),
        lockDays: Number(r.lockDays),
        startMs,
        unlockAtMs,
        status,
        unlockingAtMs,
        withdrawAtMs,
        rewardsFrozenAtMs,
        unlockTxId: r.unlockTxId,
        lastClaimTxId: r.lastClaimTxId,
        rewardAccrued: Number(accruedTotal.toFixed(8)),
        rewardPaid: Number(paid.toFixed(8)),
        claimable,
        unstakedAtMs: r.unstakedAtMs,
        stakeTxId: r.stakeTxId,
        unstakeTxId: r.unstakeTxId,
        canUnlock: status === "staked",
        canWithdraw: status === "unlocking" && !!withdrawAtMs && ts >= withdrawAtMs,
      };
    });

    return res.json({ success: true, chainId: CHAIN_ID, wallet, apr: STAKING_APR, positions });
  } catch (e) {
    return res.status(500).json({ error: e.message || "staking positions failed" });
  }
});

app.get("/staking/positions/:wallet", async (req, res) => {
  try {
    const wallet = String(req.params.wallet || "").trim();
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const rows = await all(
      db,
      `SELECT id, wallet, principal, lockDays, startMs, unlockAtMs, status, rewardPaid,
              unlockingAtMs, withdrawAtMs, rewardsFrozenAtMs, unlockTxId, lastClaimTxId,
              unstakedAtMs, stakeTxId, unstakeTxId
         FROM staking_positions
        WHERE wallet=? AND status != 'unstaked'
        ORDER BY startMs DESC`,
      [wallet]
    );

    const ts = now();
      const positions = rows.map((r) => {
      const principal = Number(r.principal);
      const startMs = Number(r.startMs);
      const unlockAtMs = Number(r.unlockAtMs);
      const status = String(r.status);
      const rewardEnd = status === 'unlocking' ? Number(r.rewardsFrozenAtMs || ts) : ts;
      const accrued = status === 'staked' || status === 'unlocking'
        ? computeStakingReward(principal, startMs, rewardEnd)
        : Number(r.rewardPaid || 0);
      return {
        id: r.id,
        wallet: r.wallet,
        principal: Number(principal.toFixed(8)),
        lockDays: Number(r.lockDays),
        startMs,
        unlockAtMs,
        status,
        rewardAccrued: Number(accrued.toFixed(8)),
        rewardPaid: Number(Number(r.rewardPaid || 0).toFixed(8)),
        unlockingAtMs: r.unlockingAtMs,
        withdrawAtMs: r.withdrawAtMs,
        rewardsFrozenAtMs: r.rewardsFrozenAtMs,
        unlockTxId: r.unlockTxId,
        lastClaimTxId: r.lastClaimTxId,
        unstakedAtMs: r.unstakedAtMs,
        stakeTxId: r.stakeTxId,
        unstakeTxId: r.unstakeTxId,
        canUnlock: status === 'staked',
        canWithdraw: status === 'unlocking' && ts >= Number(r.withdrawAtMs || 0),
      };
    });

    return res.json({ success: true, chainId: CHAIN_ID, wallet, apr: STAKING_APR, positions });
  } catch (e) {
    return res.status(500).json({ error: e.message || "staking positions failed" });
  }
});

app.post("/stake", async (req, res) => {
  try {
    const { wallet, amount, lockDays, nonce, timestamp, signature } = req.body;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    const from = String(wallet || "").trim();
    if (!from) return res.status(400).json({ error: "Missing wallet" });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be positive" });
    const ld = Number(lockDays);
    if (!Number.isInteger(ld) || ld <= 0 || ld > 3650) return res.status(400).json({ error: "Invalid lockDays" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = Number(req.body?.serviceFee ?? Number((amt * 1 * SERVICE_FEE_RATE).toFixed(8)));
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));
    if (!Number.isFinite(gasFee) || gasFee < minGasFee) return res.status(400).json({ error: "Fee too low", minGasFee });

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    await ensureAccountExists(from);
    const acct = await getAccountRow(from);

    // accept only exact nonce for now
    if (nonce !== acct.nonce) return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });

    const pendingCount = await countPendingForWallet({ type: "stake", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs for wallet", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendable = Number(acct.balance) - pendingOutgoingCost;
    const totalCost = Number((amt + gasFee + serviceFee).toFixed(8));
    if (spendable < totalCost) {
      return res.status(400).json({ error: "Insufficient spendable balance", spendableBalance: spendable, required: totalCost });
    }

    const metaJson = JSON.stringify({ lockDays: ld });
    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "stake",
      from,
      to: STAKE_VAULT,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
      metaJson,
    });

    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await incrementNonce(from);

    const tx = createTx({
      type: "stake",
      from,
      to: STAKE_VAULT,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      metaJson,
      timestampMs: timestamp,
      expiresAtMs,
    });
    await insertTx(tx);
    return res.json({ success: true, chainId: CHAIN_ID, tx });
  } catch (e) {
    return res.status(500).json({ error: e.message || "stake failed" });
  }
});

app.post("/unstake", async (req, res) => {
  try {
    const { wallet, positionId, nonce, timestamp, signature } = req.body;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    const from = String(wallet || "").trim();
    if (!from) return res.status(400).json({ error: "Missing wallet" });
    const pid = String(positionId || "").trim();
    if (!pid) return res.status(400).json({ error: "Missing positionId" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    // Use the signed timestamp for reward evaluation (within allowed skew).
    const nowMs = now();
    const tsEval = Number(timestamp);
    if (!Number.isFinite(tsEval)) return res.status(400).json({ error: "Invalid timestamp" });
    if (tsEval < nowMs - 5 * 60 * 1000) return res.status(400).json({ error: "Timestamp too old" });
    if (Number(timestamp) > nowMs + 30 * 1000) return res.status(400).json({ error: "Timestamp too far in future" });

    const pos = await get(
      db,
      `SELECT id, wallet, principal, lockDays, startMs, unlockAtMs, withdrawAtMs, rewardsFrozenAtMs, status, rewardPaid
         FROM staking_positions
        WHERE id=?`,
      [pid]
    );
    if (!pos || pos.wallet !== from) return res.status(404).json({ error: "Position not found" });
    const st = String(pos.status);
    if (st === "staked") {
      if (tsEval < Number(pos.unlockAtMs)) return res.status(400).json({ error: "Position is still locked", unlockAtMs: Number(pos.unlockAtMs) });
    } else if (st === "unlocking") {
      if (tsEval < Number(pos.withdrawAtMs || 0)) {
        return res.status(400).json({ error: "Position is still unlocking", withdrawAtMs: Number(pos.withdrawAtMs || 0) });
      }
    } else {
      return res.status(400).json({ error: "Position is not withdrawable" });
    }

    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = 0;
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));
    if (!Number.isFinite(gasFee) || gasFee < minGasFee) return res.status(400).json({ error: "Fee too low", minGasFee });

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    await ensureAccountExists(from);
    const acct = await getAccountRow(from);
    if (nonce !== acct.nonce) return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });

    const pendingCount = await countPendingForWallet({ type: "unstake", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs for wallet", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    // Wallet must be able to pay fees.
    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendable = Number(acct.balance) - pendingOutgoingCost;
    if (spendable < gasFee + serviceFee) {
      return res.status(400).json({ error: "Insufficient spendable balance for fees", spendableBalance: spendable, required: gasFee + serviceFee });
    }

    const principal = Number(pos.principal);
    const rewardEnd = st === "unlocking" ? Number(pos.rewardsFrozenAtMs || tsEval) : tsEval;
    const totalReward = computeStakingReward(principal, Number(pos.startMs), rewardEnd);
    const alreadyPaid = Number(pos.rewardPaid || 0);
    const remainingReward = Number(Math.max(0, totalReward - alreadyPaid).toFixed(8));
    const payout = Number((principal + remainingReward).toFixed(8));

    const metaJson = JSON.stringify({ positionId: pid });
    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "unstake",
      from,
      to: from,
      amount: payout,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
      metaJson,
    });

    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await incrementNonce(from);

    const tx = createTx({
      type: "unstake",
      from,
      to: from,
      amount: payout,
      nonce,
      gasFee,
      serviceFee,
      metaJson,
      timestampMs: timestamp,
      expiresAtMs,
    });
    await insertTx(tx);
    return res.json({ success: true, chainId: CHAIN_ID, tx, payout, remainingReward });
  } catch (e) {
    return res.status(500).json({ error: e.message || "unstake failed" });
  }
});

app.post("/staking/unlock", async (req, res) => {
  try {
    const { wallet, positionId, nonce, timestamp, signature } = req.body;
    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    const from = String(wallet || "").trim();
    const pid = String(positionId || "").trim();
    if (!from || !pid) return res.status(400).json({ error: "Missing wallet/positionId" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = 0;
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));
    if (!Number.isFinite(gasFee) || gasFee < minGasFee) return res.status(400).json({ error: "Fee too low", minGasFee });

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    const acct = await getAccountRow(from);
    if (nonce !== acct.nonce) return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });

    const pos = await get(db, `SELECT id, wallet, lockDays, status FROM staking_positions WHERE id=?`, [pid]);
    if (!pos || pos.wallet !== from) return res.status(404).json({ error: "Position not found" });
    if (String(pos.status) !== "staked") return res.status(400).json({ error: "Position not staked" });

    const pendingCount = await countPendingForWallet({ type: "unlock", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs for wallet", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendable = Number(acct.balance) - pendingOutgoingCost;
    const totalCost = Number((gasFee + serviceFee).toFixed(8));
    if (spendable < totalCost) {
      return res.status(400).json({ error: "Insufficient spendable balance", spendableBalance: spendable, required: totalCost });
    }

    const metaJson = JSON.stringify({ positionId: pid });
    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "unlock",
      from,
      to: from,
      amount: 0,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
      metaJson,
    });
    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await incrementNonce(from);

    const tx = createTx({
      type: "unlock",
      from,
      to: from,
      amount: 0,
      nonce,
      gasFee,
      serviceFee,
      metaJson,
      timestampMs: timestamp,
      expiresAtMs,
    });
    await insertTx(tx);

    res.json({ success: true, chainId: CHAIN_ID, tx, positionId: pid, unlockDelayDays: Number(pos.lockDays) <= 30 ? 3 : 7 });
  } catch (e) {
    res.status(500).json({ error: e.message || "unlock failed" });
  }
});

app.post("/staking/claim", async (req, res) => {
  try {
    const { wallet, positionId, nonce, timestamp, signature } = req.body;
    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    const from = String(wallet || "").trim();
    const pid = String(positionId || "").trim();
    if (!from || !pid) return res.status(400).json({ error: "Missing wallet/positionId" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const pos = await get(db, `SELECT id, wallet, principal, startMs, rewardsFrozenAtMs, status, rewardPaid FROM staking_positions WHERE id=?`, [pid]);
    if (!pos || pos.wallet !== from) return res.status(404).json({ error: "Position not found" });
    if (String(pos.status) !== "staked") return res.status(400).json({ error: "Cannot claim while unlocking/unstaked" });

    // Clamp evaluation timestamp to avoid signature drift while preventing future timestamps.
    const nowMs = now();
    const tsEval = Math.min(nowMs, Number(timestamp));
    if (!Number.isFinite(tsEval)) return res.status(400).json({ error: "Invalid timestamp" });
    if (tsEval < nowMs - 5 * 60 * 1000) return res.status(400).json({ error: "Timestamp too old" });
    if (Number(timestamp) > nowMs + 30 * 1000) return res.status(400).json({ error: "Timestamp too far in future" });
    const principal = Number(pos.principal);
    const endMs = Number(pos.rewardsFrozenAtMs || tsEval);
    const totalReward = computeStakingReward(principal, Number(pos.startMs), endMs);
    const alreadyPaid = Number(pos.rewardPaid || 0);
    const claimable = Number(Math.max(0, totalReward - alreadyPaid).toFixed(8));
    if (!(claimable > 0)) return res.status(400).json({ error: "Nothing to claim" });

    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    const serviceFee = Number(req.body?.serviceFee ?? expectedServiceFee(claimable));
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));
    if (!Number.isFinite(gasFee) || gasFee < minGasFee) return res.status(400).json({ error: "Fee too low", minGasFee });

    const svcExpected = expectedServiceFee(claimable);
    if (Number(serviceFee.toFixed(8)) !== Number(svcExpected.toFixed(8))) {
      return res.status(400).json({ error: "Bad serviceFee", expectedServiceFee: svcExpected, gotServiceFee: serviceFee, rate: SERVICE_FEE_RATE });
    }

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    const acct = await getAccountRow(from);
    if (nonce !== acct.nonce) return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });

    const pendingCount = await countPendingForWallet({ type: "claim", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs for wallet", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendable = Number(acct.balance) - pendingOutgoingCost;
    const totalFee = Number((gasFee + serviceFee).toFixed(8));
    if (spendable < totalFee) return res.status(400).json({ error: "Insufficient spendable balance", spendableBalance: spendable, required: totalFee });

    const metaJson = JSON.stringify({ positionId: pid });
    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "claim",
      from,
      to: from,
      amount: claimable,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
      metaJson,
    });
    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await incrementNonce(from);

    const tx = createTx({
      type: "claim",
      from,
      to: from,
      amount: claimable,
      nonce,
      gasFee,
      serviceFee,
      metaJson,
      timestampMs: timestamp,
      expiresAtMs,
    });
    await insertTx(tx);

    res.json({ success: true, chainId: CHAIN_ID, tx, claimable });
  } catch (e) {
    res.status(500).json({ error: e.message || "claim failed" });
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

    // Must already exist in mempool.
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
    if (gasFee <= Number(pending.gasFee || 0)) {
      return res.status(400).json({ error: "gasFee must be higher than current pending gasFee", currentGasFee: Number(pending.gasFee || 0) });
    }

    // Recheck spendable using *updated* cost for this nonce (replace old pending cost with new one).
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

    // Update tx in-place (same id) with new params + new hash.
    const newHash = sha256Hex(
      `${CHAIN_ID}:${pending.id}:send:${from}:${to}:${fmt8(amt)}:${nonce}:${fmt8(gasFee)}:${fmt8(serviceFee)}:${expiresAtMs}:${timestamp}`
    );

    await run(
      db,
      `UPDATE transactions
       SET hash=?, toWallet=?, amount=?, gasFee=?, serviceFee=?, expiresAtMs=?, timestampMs=?
       WHERE id=?`,
      [newHash, to, amt, gasFee, serviceFee, expiresAtMs, timestamp, pending.id]
    );

    const updated = await get(db, `SELECT * FROM transactions WHERE id=?`, [pending.id]);
    return res.json({ success: true, chainId: CHAIN_ID, tx: updated });
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

    const newHash = sha256Hex(
      `${CHAIN_ID}:${pending.id}:send:${from}:${from}:${fmt8(amt)}:${nonce}:${fmt8(gasFee)}:${fmt8(serviceFee)}:${expiresAtMs}:${timestamp}`
    );

    await run(
      db,
      `UPDATE transactions
       SET hash=?, toWallet=?, amount=?, gasFee=?, serviceFee=?, expiresAtMs=?, timestampMs=?
       WHERE id=?`,
      [newHash, from, amt, gasFee, serviceFee, expiresAtMs, timestamp, pending.id]
    );

    const updated = await get(db, `SELECT * FROM transactions WHERE id=?`, [pending.id]);
    return res.json({ success: true, chainId: CHAIN_ID, tx: updated });
  } catch (e) {
    return res.status(500).json({ error: e.message || "cancel failed" });
  }
});

/* ======================
   PRICE FEEDS (PYTH NETWORK)
====================== */
// Update prices every 10 seconds
let lastPriceUpdate = 0;
async function ensureFreshPrices() {
  const now = Date.now();
  if (now - lastPriceUpdate > 10000) {
    await fetchPythPrices();
    lastPriceUpdate = now;
  }
}

// Endpoint to manually trigger price update
app.post("/prices/refresh", async (req, res) => {
  try {
    const prices = await fetchPythPrices();
    return res.json({ success: true, prices, timestamp: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: e.message || "price refresh failed" });
  }
});

// Get current prices
app.get("/prices", async (req, res) => {
  try {
    await ensureFreshPrices();
    const tokens = await all(db, `SELECT symbol, name, mockPriceUSD as price, pythPriceId FROM tokens`);
    const prices = {};
    for (const t of tokens) {
      prices[t.symbol] = {
        price: Number(t.price),
        name: t.name,
        hasRealPrice: !!t.pythPriceId,
      };
    }
    return res.json({ success: true, prices, timestamp: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: e.message || "failed to fetch prices" });
  }
});

/* ======================
   MULTI-TOKEN ENDPOINTS
====================== */

// Get all tokens
app.get("/tokens", async (req, res) => {
  try {
    const tokens = await all(db, `SELECT * FROM tokens ORDER BY symbol`);
    return res.json({ success: true, tokens });
  } catch (e) {
    return res.status(500).json({ error: e.message || "failed to fetch tokens" });
  }
});

// Get current real-time prices
app.get("/tokens/prices", async (req, res) => {
  try {
    const prices = await fetchRealPrices();
    return res.json({ success: true, prices, cachedAt: priceCache.lastUpdate });
  } catch (e) {
    return res.status(500).json({ error: e.message || "failed to fetch prices" });
  }
});

// Get token balances for a wallet
app.get("/tokens/balances/:wallet", async (req, res) => {
  try {
    const wallet = String(req.params.wallet || "").trim();
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    await ensureAccountExists(wallet);
    await ensureFreshPrices(); // Refresh prices before returning balances

    // Get HNY balance from accounts table
    const account = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
    const hnyBalance = Number(account?.balance || 0);

    // Get all other token balances
    const tokenBalances = await all(
      db,
      `SELECT tb.tokenSymbol, tb.balance, t.name, t.decimals, t.mockPriceUSD
       FROM token_balances tb
       JOIN tokens t ON tb.tokenSymbol = t.symbol
       WHERE tb.wallet=?`,
      [wallet]
    );

    // Get stHNY balance from staked positions
    const stakedPositions = await all(
      db,
      `SELECT principal, rewardPaid, startMs, status, rewardsFrozenAtMs
       FROM staking_positions
       WHERE wallet=? AND status IN ('staked', 'unlocking')`,
      [wallet]
    );
    
    const ts = now();
    let totalStHNY = 0;
    for (const pos of stakedPositions) {
      const principal = Number(pos.principal || 0);
      const rewardEnd = String(pos.status) === 'unlocking' ? Number(pos.rewardsFrozenAtMs || ts) : ts;
      const totalReward = computeStakingReward(principal, Number(pos.startMs), rewardEnd);
      const paid = Number(pos.rewardPaid || 0);
      const accrued = Math.max(0, totalReward - paid);
      totalStHNY += principal + accrued;
    }

    // Combine all balances
    const balances = {
      HNY: Number(hnyBalance.toFixed(8)),
      stHNY: Number(totalStHNY.toFixed(8)),
    };

    for (const tb of tokenBalances) {
      // Skip stHNY — it's already computed from staking positions above.
      // The block producer mints stHNY into token_balances AND we calculate from positions,
      // so including it here would double-count.
      if (tb.tokenSymbol === 'stHNY') continue;
      balances[tb.tokenSymbol] = Number(Number(tb.balance).toFixed(8));
    }

    // Get token metadata
    const tokens = await all(db, `SELECT * FROM tokens`);
    const tokenMap = {};
    for (const t of tokens) {
      tokenMap[t.symbol] = {
        name: t.name,
        decimals: t.decimals,
        price: Number(t.mockPriceUSD),
        hasRealPrice: !!t.pythPriceId,
      };
    }

    return res.json({ success: true, balances, tokens: tokenMap });
  } catch (e) {
    return res.status(500).json({ error: e.message || "failed to fetch balances" });
  }
});

// Token faucet (mint tokens for testing)
app.post("/tokens/faucet", async (req, res) => {
  try {
    const { wallet, tokenSymbol, amount } = req.body;
    if (!wallet || !tokenSymbol) {
      return res.status(400).json({ error: "Missing wallet or tokenSymbol" });
    }

    // Can't faucet HNY or stHNY through this endpoint
    if (tokenSymbol === 'HNY' || tokenSymbol === 'stHNY') {
      return res.status(400).json({ error: "Use /mint for HNY, stHNY is earned through staking" });
    }

    const token = await get(db, `SELECT * FROM tokens WHERE symbol=?`, [tokenSymbol]);
    if (!token) return res.status(404).json({ error: "Token not found" });

    // 24h cooldown per token per wallet
    const oneDayAgo = now() - 86400000;
    const recentMint = await get(
      db,
      `SELECT id, timestampMs FROM transactions
       WHERE fromWallet='FAUCET' AND toWallet=? AND type='token_faucet'
       AND timestampMs > ?
       AND metaJson LIKE ?
       LIMIT 1`,
      [wallet, oneDayAgo, `%"tokenSymbol":"${tokenSymbol}"%`]
    );
    if (recentMint) {
      const nextMintMs = Number(recentMint.timestampMs) + 86400000;
      const waitSec = Math.ceil((nextMintMs - now()) / 1000);
      return res.status(429).json({
        error: `${tokenSymbol} faucet cooldown active. Try again in ${Math.ceil(waitSec / 3600)} hours.`,
        cooldownSeconds: waitSec,
      });
    }

    // Also check seed fingerprint cooldown (prevents creating new wallet to bypass)
    const seedFp = String(req.body?.seedFingerprint || "").trim();
    if (seedFp) {
      const fpMint = await get(
        db,
        `SELECT id, timestampMs FROM transactions
         WHERE type='token_faucet' AND timestampMs > ?
         AND metaJson LIKE ? AND metaJson LIKE ?
         LIMIT 1`,
        [oneDayAgo, `%"tokenSymbol":"${tokenSymbol}"%`, `%"seedFingerprint":"${seedFp}"%`]
      );
      if (fpMint) {
        const nextMs = Number(fpMint.timestampMs) + 86400000;
        const waitSec = Math.ceil((nextMs - now()) / 1000);
        return res.status(429).json({
          error: `${tokenSymbol} faucet cooldown active (seed phrase limit). Try again in ${Math.ceil(waitSec / 3600)} hours.`,
          cooldownSeconds: waitSec,
        });
      }
    }

    const faucetAmount = Math.min(Number(amount) || 100, 100); // Max 100 tokens per 24h
    if (!Number.isFinite(faucetAmount) || faucetAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    await ensureAccountExists(wallet);

    // Get or create token balance
    let balance = await get(
      db,
      `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`,
      [wallet, tokenSymbol]
    );

    if (balance) {
      const newBalance = Number(balance.balance) + faucetAmount;
      await run(
        db,
        `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`,
        [newBalance, wallet, tokenSymbol]
      );
    } else {
      await run(
        db,
        `INSERT INTO token_balances (wallet, tokenSymbol, balance, createdAtMs)
         VALUES (?, ?, ?, ?)`,
        [wallet, tokenSymbol, faucetAmount, now()]
      );
    }

    // Create a transaction record for the faucet mint
    const txId = crypto.randomUUID();
    const ts = now();
    const metaJson = JSON.stringify({ tokenSymbol, amount: faucetAmount, seedFingerprint: seedFp || undefined });
    const txRow = {
      id: txId,
      hash: sha256Hex(`token_faucet:${wallet}:${tokenSymbol}:${faucetAmount}:${ts}`),
      type: "mint",
      fromWallet: "FAUCET",
      toWallet: wallet,
      amount: faucetAmount,
      nonce: 0,
      gasFee: 0,
      serviceFee: 0,
      metaJson,
      status: "confirmed",
      failReason: null,
      expiresAtMs: ts + 60000,
      timestampMs: ts,
      blockHeight: null,
      blockHash: null,
    };
    await insertTx(txRow);

    return res.json({
      success: true,
      wallet,
      tokenSymbol,
      amount: faucetAmount,
      message: `Minted ${faucetAmount} ${tokenSymbol}`,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "faucet failed" });
  }
});

// Token send
app.post("/tokens/send", async (req, res) => {
  try {
    const { wallet, to, tokenSymbol, amount, nonce, timestamp, signature } = req.body;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    const from = String(wallet || "").trim();
    const toAddr = String(to || "").trim();
    const token = String(tokenSymbol || "").trim();
    
    if (!from || !toAddr || !token) {
      return res.status(400).json({ error: "Missing wallet, to, or tokenSymbol" });
    }
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });

    // Can't send HNY through token endpoint
    if (token === 'HNY') {
      return res.status(400).json({ error: "Use /send for HNY transfers" });
    }

    // stHNY transfers are allowed!
    const tokenInfo = await get(db, `SELECT * FROM tokens WHERE symbol=?`, [token]);
    if (!tokenInfo) return res.status(404).json({ error: "Token not found" });

    const tokenPriceUSD = Number(tokenInfo.mockPriceUSD || 1);
    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    // Service fee based on USD value of tokens being sent
    const serviceFee = Number(req.body?.serviceFee ?? 0);
    const svcExpected = expectedServiceFee(amt, tokenPriceUSD);
    if (Math.abs(serviceFee - svcExpected) > 0.1) {
      return res.status(400).json({ error: "Bad serviceFee", expectedServiceFee: svcExpected, gotServiceFee: serviceFee, rate: SERVICE_FEE_RATE, tokenPriceUSD });
    }
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!Number.isFinite(gasFee) || gasFee < minGasFee) {
      return res.status(400).json({ error: "Fee too low", minGasFee });
    }

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    await ensureAccountExists(from);
    await ensureAccountExists(toAddr);

    const acct = await getAccountRow(from);
    if (nonce !== acct.nonce) {
      return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });
    }

    // Check token balance
    const tokenBalance = await get(
      db,
      `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`,
      [from, token]
    );
    const currentBalance = Number(tokenBalance?.balance || 0);
    if (currentBalance < amt) {
      return res.status(400).json({ error: "Insufficient token balance", balance: currentBalance, required: amt });
    }

    // Check HNY balance for gas
    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendableHNY = Number(acct.balance) - pendingOutgoingCost;
    if (spendableHNY < gasFee + serviceFee) {
      return res.status(400).json({
        error: "Insufficient HNY for fees",
        spendableBalance: spendableHNY,
        required: gasFee + serviceFee,
      });
    }

    const pendingCount = await countPendingForWallet({ type: "token_send", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs", maxPendingPerWallet: MAX_PENDING_PER_WALLET });
    }

    const metaJson = JSON.stringify({ tokenSymbol: token, amount: amt });
    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "token_send",
      from,
      to: toAddr,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      expiresAtMs,
      timestamp,
      metaJson,
    });

    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await incrementNonce(from);

    const tx = createTx({
      type: "token_send",
      from,
      to: toAddr,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      metaJson,
      timestampMs: timestamp,
      expiresAtMs,
    });

    await insertTx(tx);

    return res.json({ success: true, chainId: CHAIN_ID, tx });
  } catch (e) {
    return res.status(500).json({ error: e.message || "token send failed" });
  }
});

// Swap tokens
app.post("/swap", async (req, res) => {
  try {
    const { wallet, tokenIn, tokenOut, amountIn, minAmountOut, nonce, timestamp, signature } = req.body;

    const chainId = String(req.body?.chainId || "");
    if (chainId !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });

    const from = String(wallet || "").trim();
    const tIn = String(tokenIn || "").trim();
    const tOut = String(tokenOut || "").trim();
    
    if (!from || !tIn || !tOut) {
      return res.status(400).json({ error: "Missing wallet, tokenIn, or tokenOut" });
    }
    if (tIn === tOut) return res.status(400).json({ error: "Cannot swap same token" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const amtIn = Number(amountIn);
    const minOut = Number(minAmountOut || 0);
    if (!Number.isFinite(amtIn) || amtIn <= 0) return res.status(400).json({ error: "Invalid amountIn" });
    if (!Number.isFinite(minOut) || minOut < 0) return res.status(400).json({ error: "Invalid minAmountOut" });

    const { minGasFee } = await currentMinGasFee();
    const gasFee = Number(req.body?.gasFee ?? minGasFee);
    // Service fee: 0.0005% of USD value of tokenIn, paid in HNY
    const tokenInInfo = await get(db, `SELECT mockPriceUSD FROM tokens WHERE symbol=?`, [tIn]);
    const tokenPriceUSD = Number(tokenInInfo?.mockPriceUSD || 1);
    const usdValue = amtIn * tokenPriceUSD;
    const serverServiceFee = Number((usdValue * SERVICE_FEE_RATE).toFixed(8));
    // Use client-sent serviceFee for signature verification (must match what client signed)
    const clientServiceFee = Number(req.body?.serviceFee ?? 0);
    const expiresAtMs = Number(req.body?.expiresAtMs ?? (now() + TX_TTL_MS));

    if (!Number.isFinite(gasFee) || gasFee < minGasFee) {
      return res.status(400).json({ error: "Fee too low", minGasFee });
    }

    await ensureAccountExists(from);
    const acct = await getAccountRow(from);
    if (nonce !== acct.nonce) {
      return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce, gotNonce: nonce });
    }

    // Find pool (try both orderings) — or multi-hop through HNY
    let pool = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tIn, tOut]);
    let reversed = false;
    if (!pool) {
      pool = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tOut, tIn]);
      reversed = true;
    }

    // Multi-hop routing helper
    function ammCalcEndpoint(rIn, rOut, input, fee) {
      const withFee = input * (1 - fee);
      return (rOut * withFee) / (rIn + withFee);
    }

    let poolIdForMeta, amountOut;
    const BRIDGE = "HNY";

    if (pool) {
      // Direct pool
      const reserveIn = reversed ? Number(pool.reserveB) : Number(pool.reserveA);
      const reserveOut = reversed ? Number(pool.reserveA) : Number(pool.reserveB);
      const feeRate = Number(pool.feeRate || 0.003);
      amountOut = ammCalcEndpoint(reserveIn, reserveOut, amtIn, feeRate);
      poolIdForMeta = pool.id;
    } else if (tIn !== BRIDGE && tOut !== BRIDGE) {
      // Multi-hop: tokenIn → HNY → tokenOut
      let pool1 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tIn, BRIDGE]);
      let rev1 = false;
      if (!pool1) { pool1 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [BRIDGE, tIn]); rev1 = true; }
      let pool2 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [BRIDGE, tOut]);
      let rev2 = false;
      if (!pool2) { pool2 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tOut, BRIDGE]); rev2 = true; }

      if (!pool1 || !pool2) {
        return res.status(404).json({ error: `No liquidity pool found for ${tIn}/${tOut}` });
      }

      const rIn1 = rev1 ? Number(pool1.reserveB) : Number(pool1.reserveA);
      const rOut1 = rev1 ? Number(pool1.reserveA) : Number(pool1.reserveB);
      const hnyMid = ammCalcEndpoint(rIn1, rOut1, amtIn, Number(pool1.feeRate || 0.003));

      const rIn2 = rev2 ? Number(pool2.reserveB) : Number(pool2.reserveA);
      const rOut2 = rev2 ? Number(pool2.reserveA) : Number(pool2.reserveB);
      amountOut = ammCalcEndpoint(rIn2, rOut2, hnyMid, Number(pool2.feeRate || 0.003));
      poolIdForMeta = `${pool1.id}|${pool2.id}`;
    } else {
      return res.status(404).json({ error: `No liquidity pool found for ${tIn}/${tOut}` });
    }
    
    if (amountOut < minOut) {
      return res.status(400).json({
        error: "Slippage too high",
        expectedMin: minOut,
        actualOutput: Number(amountOut.toFixed(8)),
      });
    }

    // Check balances (use server fee for balance check)
    if (tIn === 'HNY') {
      const pendingCost = await getPendingOutgoingCost(from);
      const spendable = Number(acct.balance) - pendingCost;
      if (spendable < amtIn + gasFee + serverServiceFee) {
        return res.status(400).json({ error: "Insufficient HNY balance" });
      }
    } else {
      const tokenBal = await get(
        db,
        `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`,
        [from, tIn]
      );
      if (Number(tokenBal?.balance || 0) < amtIn) {
        return res.status(400).json({ error: `Insufficient ${tIn} balance` });
      }
      
      // Still need HNY for gas
      const pendingCost = await getPendingOutgoingCost(from);
      const spendableHNY = Number(acct.balance) - pendingCost;
      if (spendableHNY < gasFee + serverServiceFee) {
        return res.status(400).json({ error: "Insufficient HNY for fees" });
      }
    }

    const pendingCount = await countPendingForWallet({ type: "swap", wallet: from });
    if (pendingCount >= MAX_PENDING_PER_WALLET) {
      return res.status(429).json({ error: "Too many pending txs" });
    }

    // Use client-provided metaJson for signature verification
    const clientMetaJson = req.body?.metaJson || JSON.stringify({
      poolId: poolIdForMeta,
      tokenIn: tIn,
      tokenOut: tOut,
      amountIn: amtIn,
      minAmountOut: minOut,
      expectedAmountOut: Number(amountOut.toFixed(8)),
    });

    // Use client-sent serviceFee for signature verification (must match what client signed)
    const msg = canonicalSignedMessage({
      chainId: CHAIN_ID,
      type: "swap",
      from,
      to: from,
      amount: amtIn,
      nonce,
      gasFee,
      serviceFee: clientServiceFee,
      expiresAtMs,
      timestamp,
      metaJson: clientMetaJson,
    });

    const sigOk = verifySignature({ walletPubKeyB64: acct.publicKeyB64, message: msg, signatureB64: signature });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    await incrementNonce(from);

    // Record tx with server-computed service fee
    const tx = createTx({
      type: "swap",
      from,
      to: from,
      amount: amtIn,
      nonce,
      gasFee,
      serviceFee: serverServiceFee,
      metaJson,
      timestampMs: timestamp,
      expiresAtMs,
    });

    await insertTx(tx);

    return res.json({
      success: true,
      chainId: CHAIN_ID,
      tx,
      expectedAmountOut: Number(amountOut.toFixed(8)),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "swap failed" });
  }
});

// Get swap quote
app.post("/swap/quote", async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn } = req.body;
    
    const tIn = String(tokenIn || "").trim();
    const tOut = String(tokenOut || "").trim();
    if (!tIn || !tOut) return res.status(400).json({ error: "Missing tokenIn or tokenOut" });
    if (tIn === tOut) return res.status(400).json({ error: "Cannot swap same token" });

    const amtIn = Number(amountIn);
    if (!Number.isFinite(amtIn) || amtIn <= 0) return res.status(400).json({ error: "Invalid amountIn" });

    // Helper: compute AMM output for a single pool
    function ammCalc(reserveIn, reserveOut, inputAmt, feeRate) {
      const amtWithFee = inputAmt * (1 - feeRate);
      const out = (reserveOut * amtWithFee) / (reserveIn + amtWithFee);
      return out;
    }

    // Try direct pool first
    let pool = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tIn, tOut]);
    let reversed = false;
    if (!pool) {
      pool = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tOut, tIn]);
      reversed = true;
    }

    if (pool) {
      // Direct pool found
      const reserveIn = reversed ? Number(pool.reserveB) : Number(pool.reserveA);
      const reserveOut = reversed ? Number(pool.reserveA) : Number(pool.reserveB);
      const feeRate = Number(pool.feeRate || 0.003);

      const amountOut = ammCalc(reserveIn, reserveOut, amtIn, feeRate);
      const priceImpact = (amountOut / reserveOut) * 100;
      const exchangeRate = amountOut / amtIn;

      return res.json({
        success: true,
        poolId: pool.id,
        route: "direct",
        tokenIn: tIn,
        tokenOut: tOut,
        amountIn: amtIn,
        amountOut: Number(amountOut.toFixed(8)),
        exchangeRate: Number(exchangeRate.toFixed(8)),
        priceImpact: Number(priceImpact.toFixed(4)),
        feeRate,
        reserveIn: Number(reserveIn.toFixed(8)),
        reserveOut: Number(reserveOut.toFixed(8)),
      });
    }

    // No direct pool — try multi-hop through HNY as bridge
    // Route: tokenIn → HNY → tokenOut
    const BRIDGE = "HNY";
    if (tIn === BRIDGE || tOut === BRIDGE) {
      return res.status(404).json({ error: `No liquidity pool found for ${tIn}/${tOut}` });
    }

    // Leg 1: tokenIn → HNY
    let pool1 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tIn, BRIDGE]);
    let rev1 = false;
    if (!pool1) {
      pool1 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [BRIDGE, tIn]);
      rev1 = true;
    }
    if (!pool1) return res.status(404).json({ error: `No pool for ${tIn}/${BRIDGE} (leg 1)` });

    // Leg 2: HNY → tokenOut
    let pool2 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [BRIDGE, tOut]);
    let rev2 = false;
    if (!pool2) {
      pool2 = await get(db, `SELECT * FROM liquidity_pools WHERE tokenA=? AND tokenB=?`, [tOut, BRIDGE]);
      rev2 = true;
    }
    if (!pool2) return res.status(404).json({ error: `No pool for ${BRIDGE}/${tOut} (leg 2)` });

    const fee1 = Number(pool1.feeRate || 0.003);
    const fee2 = Number(pool2.feeRate || 0.003);

    const resIn1 = rev1 ? Number(pool1.reserveB) : Number(pool1.reserveA);
    const resOut1 = rev1 ? Number(pool1.reserveA) : Number(pool1.reserveB);
    const hnyMid = ammCalc(resIn1, resOut1, amtIn, fee1);

    const resIn2 = rev2 ? Number(pool2.reserveB) : Number(pool2.reserveA);
    const resOut2 = rev2 ? Number(pool2.reserveA) : Number(pool2.reserveB);
    const amountOut = ammCalc(resIn2, resOut2, hnyMid, fee2);

    const impact1 = (hnyMid / resOut1) * 100;
    const impact2 = (amountOut / resOut2) * 100;
    const totalImpact = Math.min(100, impact1 + impact2);
    const exchangeRate = amountOut / amtIn;
    // Effective combined fee rate
    const combinedFeeRate = 1 - (1 - fee1) * (1 - fee2);

    return res.json({
      success: true,
      poolId: `${pool1.id}|${pool2.id}`,
      route: "multi-hop",
      bridgeToken: BRIDGE,
      pool1Id: pool1.id,
      pool2Id: pool2.id,
      tokenIn: tIn,
      tokenOut: tOut,
      amountIn: amtIn,
      amountOut: Number(amountOut.toFixed(8)),
      hnyIntermediate: Number(hnyMid.toFixed(8)),
      exchangeRate: Number(exchangeRate.toFixed(8)),
      priceImpact: Number(totalImpact.toFixed(4)),
      feeRate: Number(combinedFeeRate.toFixed(6)),
      reserveIn: Number(resIn1.toFixed(8)),
      reserveOut: Number(resOut2.toFixed(8)),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "quote failed" });
  }
});

// Get all liquidity pools
app.get("/pools", async (req, res) => {
  try {
    const pools = await all(db, `SELECT * FROM liquidity_pools ORDER BY id`);
    return res.json({ success: true, pools });
  } catch (e) {
    return res.status(500).json({ error: e.message || "failed to fetch pools" });
  }
});

/* ======================
   START
====================== */
(async () => {
  try {
    await initDb(db);
    await ensureAccountExists(FEE_VAULT);
    await ensureAccountExists(STAKE_VAULT);
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
