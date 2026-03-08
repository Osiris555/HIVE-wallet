// apps/mobile/honey-dev/server.js
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");
// @noble/hashes ships CJS — safe to require() directly
const { sha3_256 } = require("@noble/hashes/sha3");

const { openDb, initDb, run, get, all, DB_PATH } = require("./db");
const { router: nftRouter }                       = require("./nft");
const { router: futuresRouter, checkLiquidations, applyFunding, FUTURES_FEE_VAULT } = require("./futures");
const { router: launchpadRouter, LAUNCHPAD_FEE_VAULT } = require("./launchpad");
const { router: orderbookRouter, ORDERBOOK_FEE_VAULT } = require("./orderbook");
const { router: botsRouter, BOTS_FEE_VAULT, runAllBots, BOT_CHECK_MS } = require("./bots");
const { router: bridgeRouter, BRIDGE_FEE_VAULT, processPendingBridges } = require("./bridge");
const { router: governanceRouter, GOVERNANCE_TREASURY, processGovernance } = require("./governance");
const { router: copyRouter, COPY_FEE_VAULT, processCopyTrades } = require("./copy-trading");
const { router: analyticsRouter, snapshotPortfolios } = require("./analytics");
const { router: vaultsRouter, compoundVaults, VAULT_COMPOUND_MS } = require("./vaults");
const { router: notificationsRouter, checkBotAlerts, checkLiquidationWarnings,
        checkDaoResults, checkBridgeComplete, checkNftBids } = require("./notifications");
const { router: socialRouter } = require("./social");
const { router: authRouter }  = require("./auth");
const queenBeeAI                                  = require("./queen-bee-ai");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ── NFT router ────────────────────────────────────────────────────────────────
// Must come before express.json() body-size limits don't apply to multipart
app.use("/nft", nftRouter);

// ── Futures router ─────────────────────────────────────────────────────────────
app.use("/futures", futuresRouter);

// ── Launchpad router ───────────────────────────────────────────────────────────
app.use("/launchpad", launchpadRouter);

// ── Order Book router ──────────────────────────────────────────────────────────
app.use("/orderbook", orderbookRouter);

// ── Trading Bots router ────────────────────────────────────────────────────────
app.use("/bots", botsRouter);

// ── Bridge router ──────────────────────────────────────────────────────────────
app.use("/bridge", bridgeRouter);

// ── Governance router ─────────────────────────────────────────────────────────
app.use("/governance", governanceRouter);

// ── Copy Trading router ───────────────────────────────────────────────────────
app.use("/copy", copyRouter);

// ── Analytics router ──────────────────────────────────────────────────────────
app.use("/analytics", analyticsRouter);

// ── Vaults router ─────────────────────────────────────────────────────────────
app.use("/vaults", vaultsRouter);

// ── Notifications router ──────────────────────────────────────────────────────
app.use("/notifications", notificationsRouter);

// ── Social router ─────────────────────────────────────────────────────────────
app.use("/social", socialRouter);

// ── Auth router ───────────────────────────────────────────────────────────────
app.use("/auth", authRouter);

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
const LP_REWARD_VAULT = "HNY_LP_REWARD_VAULT";
const WALLET_FEE_VAULT = "HNY_WALLET_FEE_VAULT";
const WALLET_FEE_RATE = 0.25; // 25% of service fee goes to wallet fee vault

// Staking (simple testnet model)
// NOTE: This is a wallet-facing feature for testnet/devnet. Mainnet economics can replace this later.
const STAKING_APR = Number(process.env.HNY_STAKING_APR || 0.05); // 5% APR default
const LP_APR = 0.08; // 8% APR for liquidity providers


// ========== REAL-TIME PRICE FEEDS - PYTH NETWORK ==========
const { fetchPythPrices } = require('./pyth-price-feed');

async function fetchRealPrices() {
  const prices = await fetchPythPrices();

  for (const [symbol, price] of Object.entries(prices)) {
    await run(
      db,
      `UPDATE tokens SET mockPriceUSD=? WHERE symbol=?`,
      [price, symbol]
    ).catch(() => { });
  }

  // Rebalance AMM pools to reflect live prices
  await rebalancePoolsToMarket().catch(e => console.error("Pool rebalance error:", e));

  return prices;
}

// Rebalance liquidity pool reserves so swap rates match current market prices.
// For devnet: reset both sides to a fixed USD target so rates always track
// Pyth prices regardless of how much previous test swaps have drained the pool.
const POOL_TARGET_USD_MAJOR = 10_000_000;  // $10M per side for main pairs
const POOL_TARGET_USD_MINOR =  5_000_000;  // $5M per side for stHNY pairs
async function rebalancePoolsToMarket() {
  const tokenRows = await all(db, `SELECT symbol, mockPriceUSD FROM tokens`);
  const priceMap = {};
  for (const t of tokenRows) priceMap[t.symbol] = Number(t.mockPriceUSD || 0);

  const pools = await all(db, `SELECT * FROM liquidity_pools`);
  for (const pool of pools) {
    const pA = priceMap[pool.tokenA];
    const pB = priceMap[pool.tokenB];
    if (!pA || !pB || !Number.isFinite(pA) || !Number.isFinite(pB) || pA <= 0 || pB <= 0) continue;

    const target = (pool.tokenA === 'stHNY' || pool.tokenB === 'stHNY')
      ? POOL_TARGET_USD_MINOR
      : POOL_TARGET_USD_MAJOR;

    // Both sides reset to `target` USD worth of each token at current price.
    // This keeps spot price = pA/pB (market rate) and gives consistent deep liquidity.
    const newA = target / pA;
    const newB = target / pB;
    const newLpShares = Math.sqrt(newA * newB);

    if (Number.isFinite(newA) && Number.isFinite(newB) && newA > 0 && newB > 0) {
      await run(db, `UPDATE liquidity_pools SET reserveA=?, reserveB=?, totalLpShares=? WHERE id=?`,
        [Number(newA.toFixed(8)), Number(newB.toFixed(8)), Number(newLpShares.toFixed(8)), pool.id]);
    }
  }
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
  const hex = Buffer.from(pubBytes).toString("hex");
  return `HNY_${hex.slice(0, 40)}`;
}

/** Derive wallet address from ML-DSA-65 public key hex: HNY_<sha3_256(pk)[0:40]> */
function deriveWalletFromMLDSAPubKeyHex(pubKeyHex) {
  const pk   = Buffer.from(pubKeyHex, "hex");
  const hash = sha3_256(pk);
  return `HNY_${Buffer.from(hash).toString("hex").slice(0, 40)}`;
}

/**
 * Verify an ML-DSA-65 (Dilithium) signature.
 * Uses dynamic ESM import since @noble/post-quantum is pure ESM.
 * The module is cached by Node.js after the first import call.
 */
async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  if (!mldsaPubKeyHex) return { ok: false, error: "Wallet not registered (missing ML-DSA-65 public key)" };
  if (!signatureHex)   return { ok: false, error: "Missing signatureHex" };
  try {
    const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa");
    const pubKey  = Buffer.from(mldsaPubKeyHex, "hex");
    const sig     = Buffer.from(signatureHex,   "hex");
    const msgBytes = Buffer.from(message, "utf8");
    const ok = ml_dsa65.verify(pubKey, msgBytes, sig);
    if (!ok) return { ok: false, error: "Invalid ML-DSA-65 signature" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `ML-DSA-65 verify error: ${e.message}` };
  }
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

function computeWalletFee(serviceFee) {
  return Number((Number(serviceFee) * WALLET_FEE_RATE).toFixed(8));
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
    `SELECT wallet, publicKeyB64, mldsa_public_key, balance, nonce, lastMintMs FROM accounts WHERE wallet = ?`,
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
    const wallets = new Set([FEE_VAULT, STAKE_VAULT, WALLET_FEE_VAULT]);
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

        const walletFee = computeWalletFee(serviceFee);
        const totalCost = amt + totalFee + walletFee;
        const fromBal = working[from] || 0;
        if (fromBal < totalCost) {
          await failTx(tx.id, height, "insufficient_confirmed_at_block");
          continue;
        }
        bump(from);

        working[from] = fromBal - totalCost;
        working[to] = (working[to] || 0) + amt;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;
        working[WALLET_FEE_VAULT] = (working[WALLET_FEE_VAULT] || 0) + walletFee;

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
        const stakeWalletFee = computeWalletFee(serviceFee);
        const totalCost = amt + totalFee + stakeWalletFee;
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
        working[WALLET_FEE_VAULT] = (working[WALLET_FEE_VAULT] || 0) + stakeWalletFee;

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
        const claimWalletFee = computeWalletFee(svc);
        const totalFee2 = Number((Number(tx.gasFee || 0) + svc).toFixed(8));
        const walletBal = working[wallet] || 0;
        if (walletBal < totalFee2 + claimWalletFee) {
          await failTx(tx.id, height, "insufficient_confirmed_for_fees");
          continue;
        }
        const stakeVaultBal = working[STAKE_VAULT] || 0;
        if (stakeVaultBal < claimable) {
          await failTx(tx.id, height, "stake_vault_insufficient");
          continue;
        }

        bump(wallet);
        working[wallet] = walletBal - totalFee2 - claimWalletFee + claimable;
        working[STAKE_VAULT] = stakeVaultBal - claimable;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee2;
        working[WALLET_FEE_VAULT] = (working[WALLET_FEE_VAULT] || 0) + claimWalletFee;

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

        // Check sender can pay HNY fees + wallet fee
        const tokenSendWalletFee = computeWalletFee(serviceFee);
        const walletBal = working[wallet] || 0;
        if (walletBal < totalFee + tokenSendWalletFee) {
          await failTx(tx.id, height, "insufficient_hny_for_fees");
          continue;
        }

        bump(wallet);
        // Deduct HNY fees
        working[wallet] = walletBal - totalFee - tokenSendWalletFee;
        working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;
        working[WALLET_FEE_VAULT] = (working[WALLET_FEE_VAULT] || 0) + tokenSendWalletFee;

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

        // stHNY position splitting already handled above.

        // ========== SPECIAL HANDLING FOR LPHNY TRANSFERS ==========
        // Sending LPHNY splits the sender's LP positions proportionally to the receiver.
        if (tokenSymbol === 'LPHNY') {
          const senderLpPositions = await all(
            db,
            `SELECT * FROM lp_positions WHERE wallet=? ORDER BY createdAtMs ASC`,
            [wallet]
          );
          const totalSenderShares = senderLpPositions.reduce((s, p) => s + Number(p.lpShares), 0);

          if (totalSenderShares > 0.00000001) {
            const fraction = amt / totalSenderShares;
            for (const pos of senderLpPositions) {
              const sharesToTransfer = Number((Number(pos.lpShares) * fraction).toFixed(8));
              if (sharesToTransfer <= 0) continue;
              const newSenderShares = Number((Number(pos.lpShares) - sharesToTransfer).toFixed(8));

              // Update or delete sender position
              if (newSenderShares <= 0.00000001) {
                await run(db, `DELETE FROM lp_positions WHERE id=?`, [pos.id]);
              } else {
                await run(db, `UPDATE lp_positions SET lpShares=? WHERE id=?`, [newSenderShares, pos.id]);
              }

              // Create or update receiver position
              const recvPos = await get(db, `SELECT id, lpShares FROM lp_positions WHERE wallet=? AND poolId=?`, [to, pos.poolId]);
              if (recvPos) {
                await run(db, `UPDATE lp_positions SET lpShares=? WHERE id=?`, [Number(recvPos.lpShares) + sharesToTransfer, recvPos.id]);
              } else {
                await run(db,
                  `INSERT INTO lp_positions (id, wallet, poolId, lpShares, createdAtMs, rewardPaidHNY) VALUES (?, ?, ?, ?, ?, 0)`,
                  [crypto.randomUUID(), to, pos.poolId, sharesToTransfer, ts]);
              }
            }
          }
        }

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
          const hnyMid = ammOut(rIn1, rOut1, amountIn, Number(pool1.feeRate || 0.001));

          // Leg 2: HNY → tokenOut
          const rev2 = pool2.tokenA !== "HNY";
          const rIn2 = rev2 ? Number(pool2.reserveB) : Number(pool2.reserveA);
          const rOut2 = rev2 ? Number(pool2.reserveA) : Number(pool2.reserveB);
          amountOut = ammOut(rIn2, rOut2, hnyMid, Number(pool2.feeRate || 0.001));

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
          const swapMultiWalletFee = computeWalletFee(serviceFee);
          const walletBal = working[wallet] || 0;
          if (walletBal < totalFee + swapMultiWalletFee) {
            await failTx(tx.id, height, "insufficient_hny_for_fees");
            continue;
          }

          bump(wallet);

          // Deduct tokenIn from sender
          const newSenderBal = Number(tokenBal.balance) - amountIn;
          await run(db, `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`, [newSenderBal, wallet, tokenIn]);
          working[wallet] = (working[wallet] || 0) - totalFee - swapMultiWalletFee;
          working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;
          working[WALLET_FEE_VAULT] = (working[WALLET_FEE_VAULT] || 0) + swapMultiWalletFee;

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
          const feeRate = Number(pool.feeRate || 0.001);
          amountOut = ammOut(reserveIn, reserveOut, amountIn, feeRate);

          if (amountOut < minAmountOut) {
            await failTx(tx.id, height, "slippage_exceeded");
            continue;
          }

          // Check balances
          const swapWalletFee = computeWalletFee(serviceFee);
          if (tokenIn === 'HNY') {
            if ((working[wallet] || 0) < amountIn + totalFee + swapWalletFee) {
              await failTx(tx.id, height, "insufficient_hny");
              continue;
            }
          } else {
            const tokenBal = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, tokenIn]);
            if (!tokenBal || Number(tokenBal.balance) < amountIn) {
              await failTx(tx.id, height, "insufficient_token_in");
              continue;
            }
            if ((working[wallet] || 0) < totalFee + swapWalletFee) {
              await failTx(tx.id, height, "insufficient_hny_for_fees");
              continue;
            }
          }

          bump(wallet);

          // Deduct tokenIn
          if (tokenIn === 'HNY') {
            working[wallet] = (working[wallet] || 0) - amountIn - totalFee - swapWalletFee;
          } else {
            const tokenBal = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, tokenIn]);
            await run(db, `UPDATE token_balances SET balance=? WHERE wallet=? AND tokenSymbol=?`, [Number(tokenBal.balance) - amountIn, wallet, tokenIn]);
            working[wallet] = (working[wallet] || 0) - totalFee - swapWalletFee;
          }

          working[FEE_VAULT] = (working[FEE_VAULT] || 0) + totalFee;
          working[WALLET_FEE_VAULT] = (working[WALLET_FEE_VAULT] || 0) + swapWalletFee;

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

// ── Auction settler ──────────────────────────────────────────────────────────
// Runs after each block to settle any expired auctions.
// Winning bidder gets the NFT; seller gets HNY (minus royalty to creator).
// No-bid auctions unlock the NFT back to the seller.
async function settleExpiredAuctions() {
  const db = openDb();
  try {
    const expired = await all(db,
      `SELECT a.*, n.creator_wallet, n.royalty_bps
         FROM nft_auctions a JOIN nfts n ON n.id=a.nft_id
        WHERE a.settled=0 AND a.ends_at <= datetime('now')`,
      []
    );
    for (const auction of expired) {
      try {
        if (auction.current_bidder && auction.current_bid_hny) {
          // Winning bid — transfer NFT and pay out
          const price      = Number(auction.current_bid_hny);
          const royaltyBps = Number(auction.royalty_bps || 0);
          const royalty    = Number((price * royaltyBps / 10000).toFixed(8));
          const sellerGets = Number((price - royalty).toFixed(8));

          await run(db, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [sellerGets, auction.seller_wallet]);
          if (royalty > 0 && auction.creator_wallet !== auction.seller_wallet) {
            await run(db, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [royalty, auction.creator_wallet]);
          }
          // Transfer NFT, clear auction ref
          await run(db,
            `UPDATE nfts SET owner_wallet=?, auction_id=NULL, listed_price_hny=NULL, listed_at=NULL,
                    transfer_count = transfer_count + 1 WHERE id=?`,
            [auction.current_bidder, auction.nft_id]
          );
          console.log(`🔨 Auction settled: ${auction.id} — ${auction.current_bidder} won ${auction.nft_id} for ${price} HNY`);
        } else {
          // No bids — unlock NFT back to seller
          await run(db, `UPDATE nfts SET auction_id=NULL WHERE id=?`, [auction.nft_id]);
          console.log(`🔨 Auction ended (no bids): ${auction.id} — NFT ${auction.nft_id} returned to ${auction.seller_wallet}`);
        }
        await run(db, `UPDATE nft_auctions SET settled=1, settled_at=datetime('now') WHERE id=?`, [auction.id]);
      } catch (e) {
        console.error(`Auction settle error (${auction.id}):`, e.message);
      }
    }
  } finally {
    db.close();
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
      // Settle expired auctions after each block
      settleExpiredAuctions().catch(e => console.error("Auction settler error:", e));
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

/* ======================
   HONEYSCAN — Block Explorer API
====================== */
app.get("/honeyscan/recent", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const txs = await all(db,
      `SELECT id, hash, type, fromWallet, toWallet, amount, gasFee, serviceFee, status, failReason, metaJson, timestampMs, blockHeight
       FROM transactions ORDER BY timestampMs DESC LIMIT ?`, [limit]);
    const blocks = await all(db,
      `SELECT height, hash, txCount, timestampMs FROM blocks ORDER BY height DESC LIMIT 10`);
    const accounts = await get(db, `SELECT COUNT(*) as cnt FROM accounts`);
    const totalTxs = await get(db, `SELECT COUNT(*) as cnt FROM transactions WHERE status='confirmed'`);
    return res.json({ success: true, txs, blocks, totalAccounts: accounts?.cnt || 0, totalTxs: totalTxs?.cnt || 0 });
  } catch (e) {
    return res.status(500).json({ error: e.message || "honeyscan failed" });
  }
});

app.get("/honeyscan/search/:query", async (req, res) => {
  try {
    const q = String(req.params.query || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query" });
    // Try as wallet address
    const account = await get(db, `SELECT * FROM accounts WHERE wallet=?`, [q]);
    if (account) {
      const txs = await all(db,
        `SELECT id, hash, type, fromWallet, toWallet, amount, gasFee, serviceFee, status, metaJson, timestampMs, blockHeight
         FROM transactions WHERE fromWallet=? OR toWallet=? ORDER BY timestampMs DESC LIMIT 50`, [q, q]);
      const tokenBals = await all(db, `SELECT tokenSymbol, balance FROM token_balances WHERE wallet=?`, [q]);
      return res.json({ type: "wallet", wallet: q, balance: Number(account.balance), nonce: account.nonce, tokenBalances: tokenBals, txs });
    }
    // Try as tx hash
    const tx = await get(db, `SELECT * FROM transactions WHERE hash=? OR id=?`, [q, q]);
    if (tx) return res.json({ type: "tx", tx });
    // Try as block hash or height
    const block = await get(db, `SELECT * FROM blocks WHERE hash=? OR height=?`, [q, Number(q) || -1]);
    if (block) {
      const txs = await all(db, `SELECT * FROM transactions WHERE blockHeight=?`, [block.height]);
      return res.json({ type: "block", block, txs });
    }
    return res.json({ type: "notfound" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "search failed" });
  }
});

app.post("/register", async (req, res) => {
  try {
    const mldsaPublicKeyHex = req.body?.mldsaPublicKeyHex;
    if (!mldsaPublicKeyHex) return res.status(400).json({ error: "Missing mldsaPublicKeyHex" });

    // ML-DSA-65 public key is 1952 bytes = 3904 hex chars
    if (!/^[0-9a-fA-F]{3904}$/.test(mldsaPublicKeyHex)) {
      return res.status(400).json({ error: "Invalid mldsaPublicKeyHex (must be 3904 hex chars = 1952 bytes)" });
    }

    const wallet = deriveWalletFromMLDSAPubKeyHex(mldsaPublicKeyHex);
    await ensureAccountExists(wallet);
    // Store the ML-DSA-65 public key for signature verification
    await run(db, `UPDATE accounts SET mldsa_public_key = ? WHERE wallet = ?`, [mldsaPublicKeyHex, wallet]);

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
      registered: !!acct.mldsa_public_key,
      mldsaPublicKeyHex: acct.mldsa_public_key || null,
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
    const signatureHex = req.body?.signatureHex;

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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
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
      from: "Devnet Faucet",
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
    const { from, to, amount, nonce, timestamp, signatureHex } = req.body;

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

    const ttlMax = now() + TX_TTL_MS * 2;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < now() || expiresAtMs > ttlMax) {
      return res.status(400).json({ error: "Invalid expiresAtMs", txTtlMs: TX_TTL_MS });
    }

    await ensureAccountExists(to);
    const fromAcct = await getAccountRow(from);
    const toAcct = await getAccountRow(to);

    // Intra-wallet transfers (both wallets registered) are exempt from service fee
    const svcExpected = expectedServiceFee(amt);
    const isIntraWallet = fromAcct.mldsa_public_key && toAcct.mldsa_public_key && Math.abs(serviceFee) < 0.00000001;
    if (!isIntraWallet && Number(serviceFee.toFixed(8)) !== Number(svcExpected.toFixed(8))) {
      return res.status(400).json({
        error: "Bad serviceFee (must match server formula)",
        expectedServiceFee: svcExpected,
        gotServiceFee: serviceFee,
        rate: SERVICE_FEE_RATE,
      });
    }

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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: fromAcct.mldsa_public_key, message: msg, signatureHex });
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
    const walletFee = computeWalletFee(serviceFee);
    const totalCost = amt + totalFee + walletFee;

    if (spendable < totalCost) {
      return res.status(400).json({
        error: "Insufficient spendable balance",
        confirmedBalance: Number(fromAcct.balance),
        pendingOutgoingCost,
        spendableBalance: spendable,
        required: totalCost,
        walletFee,
      });
    }

    await incrementNonce(from);

    // Attach Chrysalis attestation to metaJson if provided (stored, not yet enforced)
    let metaJson = null;
    const att = req.body?.chrysalisAttestation;
    if (att && att.chrysalisId && att.dsaSignatureHex) {
      metaJson = JSON.stringify({ chrysalisAttestation: att });
    }

    const tx = createTx({
      type: "send",
      from,
      to,
      amount: amt,
      nonce,
      gasFee,
      serviceFee,
      metaJson,
      timestampMs: timestamp,
      expiresAtMs,
    });

    await insertTx(tx);

    // Queen Bee AI: fire-and-forget security analysis (non-blocking)
    const recentCount = await get(db, `SELECT COUNT(*) AS c FROM transactions WHERE fromWallet=? AND timestampMs > ?`, [from, now() - 60000]);
    queenBeeAI.analyzeTransaction({
      type: "send", from, to, amount: amt, token: "HNY",
      recentTxCount: Number(recentCount?.c || 0),
      isNewRecipient: !toAcct?.mldsa_public_key,
    }).then(async result => {
      if (result.level !== "SAFE") {
        await run(db,
          `INSERT INTO security_alerts (wallet, tx_type, tx_data, alert_level, reason, confidence)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [from, "send", JSON.stringify({ from, to, amount: amt }), result.level, result.reason, result.confidence]
        ).catch(() => {});
      }
    }).catch(() => {});

    res.json({
      success: true,
      chainId: CHAIN_ID,
      tx,
      chrysalisAttested: !!att,
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
    const { wallet, amount, lockDays, nonce, timestamp, signatureHex } = req.body;

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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
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
    const { wallet, positionId, nonce, timestamp, signatureHex } = req.body;

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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
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
    const { wallet, positionId, nonce, timestamp, signatureHex } = req.body;
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
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
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
    const { wallet, positionId, nonce, timestamp, signatureHex } = req.body;
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
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
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
    const { from, to, amount, nonce, timestamp, signatureHex } = req.body;

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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: fromAcct.mldsa_public_key, message: msg, signatureHex });
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
    const { from, nonce, timestamp, signatureHex } = req.body;

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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: fromAcct.mldsa_public_key, message: msg, signatureHex });
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

    // Dynamic LPHNY price: compute from wallet's actual LP position value
    const lphnyBal = Number(balances["LPHNY"] || 0);
    if (lphnyBal > 0 && tokenMap["LPHNY"]) {
      const priceMap = {};
      for (const t of tokens) priceMap[t.symbol] = Number(t.mockPriceUSD || 0);
      const positions = await all(db, `SELECT * FROM lp_positions WHERE wallet=?`, [wallet]);
      let totalPosUSD = 0;
      for (const pos of positions) {
        const pool = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [pos.poolId]);
        if (!pool) continue;
        const totalLP = Number(pool.totalLpShares);
        if (totalLP <= 0) continue;
        const shareRatio = Number(pos.lpShares) / totalLP;
        const pA = priceMap[pool.tokenA] || 0;
        const pB = priceMap[pool.tokenB] || 0;
        totalPosUSD += shareRatio * (Number(pool.reserveA) * pA + Number(pool.reserveB) * pB);
      }
      if (totalPosUSD > 0) {
        tokenMap["LPHNY"].price = Number((totalPosUSD / lphnyBal).toFixed(8));
      }
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
       WHERE fromWallet='Devnet Faucet' AND toWallet=? AND type='token_faucet'
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
      type: "token_faucet",
      fromWallet: "Devnet Faucet",
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
    const { wallet, to, tokenSymbol, amount, nonce, timestamp, signatureHex } = req.body;

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
    const toAcctCheck = await getAccountRow(toAddr);
    const isIntraWallet = acct.mldsa_public_key && toAcctCheck.mldsa_public_key && Math.abs(serviceFee) < 0.00000001;
    if (!isIntraWallet && Math.abs(serviceFee - svcExpected) > 0.1) {
      return res.status(400).json({ error: "Bad serviceFee", expectedServiceFee: svcExpected, gotServiceFee: serviceFee, rate: SERVICE_FEE_RATE, tokenPriceUSD });
    }
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

    // Check HNY balance for gas + service fee + wallet fee
    const tokenSendWalletFee = computeWalletFee(serviceFee);
    const pendingOutgoingCost = await getPendingOutgoingCost(from);
    const spendableHNY = Number(acct.balance) - pendingOutgoingCost;
    if (spendableHNY < gasFee + serviceFee + tokenSendWalletFee) {
      return res.status(400).json({
        error: "Insufficient HNY for fees",
        spendableBalance: spendableHNY,
        required: gasFee + serviceFee + tokenSendWalletFee,
        walletFee: tokenSendWalletFee,
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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
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
    const { wallet, tokenIn, tokenOut, amountIn, minAmountOut, nonce, timestamp, signatureHex } = req.body;

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
      const feeRate = Number(pool.feeRate || 0.001);
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
      const hnyMid = ammCalcEndpoint(rIn1, rOut1, amtIn, Number(pool1.feeRate || 0.001));

      const rIn2 = rev2 ? Number(pool2.reserveB) : Number(pool2.reserveA);
      const rOut2 = rev2 ? Number(pool2.reserveA) : Number(pool2.reserveB);
      amountOut = ammCalcEndpoint(rIn2, rOut2, hnyMid, Number(pool2.feeRate || 0.001));
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

    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
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
      metaJson: clientMetaJson,
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
      const feeRate = Number(pool.feeRate || 0.001);

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

    const fee1 = Number(pool1.feeRate || 0.001);
    const fee2 = Number(pool2.feeRate || 0.001);

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
   LIQUIDITY POOL helpers
====================== */

// Get a token balance for a wallet (works for both HNY and token_balances)
async function getTokenBal(wallet, symbol) {
  if (symbol === "HNY") {
    const row = await getAccountRow(wallet);
    return Number(row?.balance || 0);
  }
  const row = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, symbol]);
  return Number(row?.balance || 0);
}

// Adjust a token balance by delta (positive = credit, negative = debit)
async function adjustTokenBal(wallet, symbol, delta) {
  if (symbol === "HNY") {
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [delta, wallet]);
    return;
  }
  const row = await get(db, `SELECT balance FROM token_balances WHERE wallet=? AND tokenSymbol=?`, [wallet, symbol]);
  if (row) {
    await run(db, `UPDATE token_balances SET balance=balance+? WHERE wallet=? AND tokenSymbol=?`, [delta, wallet, symbol]);
  } else {
    await run(db, `INSERT INTO token_balances (wallet, tokenSymbol, balance, createdAtMs) VALUES (?, ?, ?, ?)`, [wallet, symbol, Math.max(0, delta), now()]);
  }
}

// Compute pending LP reward in HNY for a position
function computeLpReward(lpShares, priceA, priceB, reserveA, reserveB, totalLpShares, positionCreatedMs, rewardPaidHNY) {
  if (!totalLpShares || totalLpShares <= 0) return 0;
  const shareRatio = lpShares / totalLpShares;
  const posValueUSD = shareRatio * (Number(reserveA) * Number(priceA) + Number(reserveB) * Number(priceB));
  const elapsedYears = (now() - Number(positionCreatedMs)) / (365 * 24 * 60 * 60 * 1000);
  const totalReward = posValueUSD * LP_APR * elapsedYears;
  return Math.max(0, Number((totalReward - Number(rewardPaidHNY || 0)).toFixed(8)));
}

/* ======================
   ADD LIQUIDITY (signed)
   Deducts tokenA + tokenB from wallet, mints LPHNY, updates pool reserves.
====================== */
app.post("/liquidity/add", async (req, res) => {
  try {
    const { wallet, poolId, amountA, amountB, nonce, timestamp, signatureHex, chainId, expiresAtMs: expiresRaw } = req.body;
    const expAt = Number(expiresRaw ?? (now() + TX_TTL_MS));

    if (String(chainId || "") !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });
    if (!wallet || !poolId) return res.status(400).json({ error: "Missing wallet or poolId" });
    const aA = Number(amountA), aB = Number(amountB);
    if (!Number.isFinite(aA) || aA <= 0) return res.status(400).json({ error: "Invalid amountA" });
    if (!Number.isFinite(aB) || aB <= 0) return res.status(400).json({ error: "Invalid amountB" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const pool = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [poolId]);
    if (!pool) return res.status(404).json({ error: `Pool '${poolId}' not found` });

    const acct = await getAccountRow(wallet);
    if (nonce !== acct.nonce) return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce });

    // Verify signature: lp_add:{chainId}:{wallet}:{poolId}:{amountA}:{amountB}:{nonce}:{timestamp}
    const msg = `lp_add:${CHAIN_ID}:${wallet}:${poolId}:${fmt8(aA)}:${fmt8(aB)}:${nonce}:${timestamp}`;
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    // Check balances
    const balA = await getTokenBal(wallet, pool.tokenA);
    const balB = await getTokenBal(wallet, pool.tokenB);
    if (balA < aA) return res.status(400).json({ error: `Insufficient ${pool.tokenA} balance`, have: balA, need: aA });
    if (balB < aB) return res.status(400).json({ error: `Insufficient ${pool.tokenB} balance`, have: balB, need: aB });

    // Calculate LP shares to mint (Uniswap v2 style)
    const rA = Number(pool.reserveA), rB = Number(pool.reserveB), totalLP = Number(pool.totalLpShares);
    let lpShares;
    if (totalLP === 0 || rA === 0 || rB === 0) {
      lpShares = Math.sqrt(aA * aB);
    } else {
      lpShares = Math.min(aA / rA, aB / rB) * totalLP;
    }
    lpShares = Number(lpShares.toFixed(8));
    if (lpShares <= 0) return res.status(400).json({ error: "LP shares calculation resulted in zero" });

    // Apply state changes
    await incrementNonce(wallet);
    await adjustTokenBal(wallet, pool.tokenA, -aA);
    await adjustTokenBal(wallet, pool.tokenB, -aB);
    await adjustTokenBal(wallet, "LPHNY", lpShares);

    // Update pool reserves
    await run(db, `UPDATE liquidity_pools SET reserveA=reserveA+?, reserveB=reserveB+?, totalLpShares=totalLpShares+? WHERE id=?`,
      [aA, aB, lpShares, poolId]);

    // Upsert lp_positions
    const existingPos = await get(db, `SELECT id, lpShares, createdAtMs, rewardPaidHNY FROM lp_positions WHERE wallet=? AND poolId=?`, [wallet, poolId]);
    const ts = now();
    if (existingPos) {
      // Snapshot pending reward before adding new shares to prevent backdating
      const tokenPriceRows = await all(db, `SELECT symbol, mockPriceUSD FROM tokens WHERE symbol IN (?, ?)`, [pool.tokenA, pool.tokenB]);
      const priceMapSnap = {};
      for (const t of tokenPriceRows) priceMapSnap[t.symbol] = Number(t.mockPriceUSD || 1);
      const snapshotReward = computeLpReward(
        Number(existingPos.lpShares), priceMapSnap[pool.tokenA] || 1, priceMapSnap[pool.tokenB] || 1,
        rA, rB, totalLP, existingPos.createdAtMs, existingPos.rewardPaidHNY
      );
      await run(db, `UPDATE lp_positions SET lpShares=lpShares+?, rewardPaidHNY=rewardPaidHNY+? WHERE id=?`,
        [lpShares, snapshotReward, existingPos.id]);
    } else {
      await run(db,
        `INSERT INTO lp_positions (id, wallet, poolId, lpShares, createdAtMs, rewardPaidHNY) VALUES (?, ?, ?, ?, ?, 0)`,
        [crypto.randomUUID(), wallet, poolId, lpShares, ts]);
    }

    // Record transaction
    const txId = crypto.randomUUID();
    await insertTx({
      id: txId,
      hash: sha256Hex(`lp_add:${wallet}:${poolId}:${fmt8(aA)}:${fmt8(aB)}:${nonce}:${ts}`),
      type: "lp_add",
      fromWallet: wallet,
      toWallet: poolId,
      amount: aA,
      nonce,
      gasFee: 0,
      serviceFee: 0,
      metaJson: JSON.stringify({ poolId, amountA: aA, amountB: aB, lpShares, tokenA: pool.tokenA, tokenB: pool.tokenB }),
      status: "confirmed",
      failReason: null,
      expiresAtMs: expAt,
      blockHeight: null,
      blockHash: null,
      timestampMs: ts,
    });

    return res.json({ success: true, poolId, lpShares, amountA: aA, amountB: aB, txId });
  } catch (e) {
    return res.status(500).json({ error: e.message || "add liquidity failed" });
  }
});

/* ======================
   REMOVE LIQUIDITY (signed)
   Burns LPHNY, returns proportional tokenA + tokenB + HNY reward.
====================== */
app.post("/liquidity/remove", async (req, res) => {
  try {
    const { wallet, poolId, lpShares: lpSharesRaw, nonce, timestamp, signatureHex, chainId, expiresAtMs: expiresRaw } = req.body;
    const expAt = Number(expiresRaw ?? (now() + TX_TTL_MS));

    if (String(chainId || "") !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });
    if (!wallet || !poolId) return res.status(400).json({ error: "Missing wallet or poolId" });
    const lpShares = Number(lpSharesRaw);
    if (!Number.isFinite(lpShares) || lpShares <= 0) return res.status(400).json({ error: "Invalid lpShares" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const pool = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [poolId]);
    if (!pool) return res.status(404).json({ error: `Pool '${poolId}' not found` });

    const pos = await get(db, `SELECT * FROM lp_positions WHERE wallet=? AND poolId=?`, [wallet, poolId]);
    if (!pos) return res.status(404).json({ error: "No LP position found for this pool" });
    if (Number(pos.lpShares) < lpShares) {
      return res.status(400).json({ error: "Insufficient LP shares in position", have: Number(pos.lpShares), need: lpShares });
    }

    const lphnyBal = await getTokenBal(wallet, "LPHNY");
    if (lphnyBal < lpShares) {
      return res.status(400).json({ error: "Insufficient LPHNY balance", have: lphnyBal, need: lpShares });
    }

    const acct = await getAccountRow(wallet);
    if (nonce !== acct.nonce) return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce });

    // Verify signature
    const msg = `lp_remove:${CHAIN_ID}:${wallet}:${poolId}:${fmt8(lpShares)}:${nonce}:${timestamp}`;
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    // Calculate proportional tokens to return
    const totalLP = Number(pool.totalLpShares);
    const shareRatio = lpShares / totalLP;
    const tokenAOut = Number((shareRatio * Number(pool.reserveA)).toFixed(8));
    const tokenBOut = Number((shareRatio * Number(pool.reserveB)).toFixed(8));

    // Calculate HNY reward (8% APR on USD position value)
    const tokenRows = await all(db, `SELECT symbol, mockPriceUSD FROM tokens WHERE symbol IN (?, ?)`, [pool.tokenA, pool.tokenB]);
    const priceMap = {};
    for (const t of tokenRows) priceMap[t.symbol] = Number(t.mockPriceUSD || 1);
    const pendingReward = computeLpReward(
      lpShares, priceMap[pool.tokenA] || 1, priceMap[pool.tokenB] || 1,
      pool.reserveA, pool.reserveB, totalLP,
      pos.createdAtMs, pos.rewardPaidHNY
    );

    // Ensure reward vault has enough HNY
    await ensureAccountExists(LP_REWARD_VAULT);
    const vaultBal = await getTokenBal(LP_REWARD_VAULT, "HNY");
    const rewardHNY = vaultBal >= pendingReward ? pendingReward : 0;

    // Apply state changes
    const ts = now();
    await incrementNonce(wallet);
    await adjustTokenBal(wallet, "LPHNY", -lpShares);
    await adjustTokenBal(wallet, pool.tokenA, tokenAOut);
    await adjustTokenBal(wallet, pool.tokenB, tokenBOut);
    if (rewardHNY > 0) {
      await adjustTokenBal(wallet, "HNY", rewardHNY);
      await adjustTokenBal(LP_REWARD_VAULT, "HNY", -rewardHNY);
    }

    // Update pool reserves
    await run(db, `UPDATE liquidity_pools SET reserveA=reserveA-?, reserveB=reserveB-?, totalLpShares=totalLpShares-? WHERE id=?`,
      [tokenAOut, tokenBOut, lpShares, poolId]);

    // Update lp_position
    const newLpShares = Number((Number(pos.lpShares) - lpShares).toFixed(8));
    if (newLpShares <= 0) {
      await run(db, `DELETE FROM lp_positions WHERE id=?`, [pos.id]);
    } else {
      await run(db, `UPDATE lp_positions SET lpShares=?, rewardPaidHNY=rewardPaidHNY+? WHERE id=?`,
        [newLpShares, rewardHNY, pos.id]);
    }

    // Record transaction
    const txId = crypto.randomUUID();
    await insertTx({
      id: txId,
      hash: sha256Hex(`lp_remove:${wallet}:${poolId}:${fmt8(lpShares)}:${nonce}:${ts}`),
      type: "lp_remove",
      fromWallet: wallet,
      toWallet: poolId,
      amount: lpShares,
      nonce,
      gasFee: 0,
      serviceFee: 0,
      metaJson: JSON.stringify({ poolId, lpShares, tokenAOut, tokenBOut, rewardHNY, tokenA: pool.tokenA, tokenB: pool.tokenB }),
      status: "confirmed",
      failReason: null,
      expiresAtMs: expAt,
      blockHeight: null,
      blockHash: null,
      timestampMs: ts,
    });

    return res.json({ success: true, poolId, lpShares, tokenAOut, tokenBOut, rewardHNY, txId });
  } catch (e) {
    return res.status(500).json({ error: e.message || "remove liquidity failed" });
  }
});

/* ======================
   CLAIM LP REWARDS (signed)
   Pays pending HNY reward from LP_REWARD_VAULT to wallet.
====================== */
app.post("/liquidity/claim", async (req, res) => {
  try {
    const { wallet, positionId, nonce, timestamp, signatureHex, chainId } = req.body;

    if (String(chainId || "") !== CHAIN_ID) return res.status(400).json({ error: "Wrong chainId", expected: CHAIN_ID });
    if (!wallet || !positionId) return res.status(400).json({ error: "Missing wallet or positionId" });
    if (!Number.isInteger(nonce)) return res.status(400).json({ error: "Missing/invalid nonce" });
    if (!Number.isInteger(timestamp)) return res.status(400).json({ error: "Missing/invalid timestamp" });

    const pos = await get(db, `SELECT * FROM lp_positions WHERE id=? AND wallet=?`, [positionId, wallet]);
    if (!pos) return res.status(404).json({ error: "LP position not found" });

    const pool = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [pos.poolId]);
    if (!pool) return res.status(404).json({ error: "Pool not found" });

    await ensureAccountExists(wallet);
    const acct = await getAccountRow(wallet);
    if (nonce !== acct.nonce) return res.status(409).json({ error: "Nonce mismatch", expectedNonce: acct.nonce });

    // Verify signature: lp_claim:{chainId}:{wallet}:{positionId}:{nonce}:{timestamp}
    const msg = `lp_claim:${CHAIN_ID}:${wallet}:${positionId}:${nonce}:${timestamp}`;
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex: acct.mldsa_public_key, message: msg, signatureHex });
    if (!sigOk.ok) return res.status(401).json({ error: sigOk.error });

    // Compute pending reward
    const tokenRows = await all(db, `SELECT symbol, mockPriceUSD FROM tokens WHERE symbol IN (?, ?)`, [pool.tokenA, pool.tokenB]);
    const priceMap = {};
    for (const t of tokenRows) priceMap[t.symbol] = Number(t.mockPriceUSD || 1);
    const pendingReward = computeLpReward(
      Number(pos.lpShares), priceMap[pool.tokenA] || 1, priceMap[pool.tokenB] || 1,
      pool.reserveA, pool.reserveB, Number(pool.totalLpShares),
      pos.createdAtMs, pos.rewardPaidHNY
    );

    if (pendingReward <= 0) return res.status(400).json({ error: "No pending rewards to claim" });

    // Check vault has enough
    await ensureAccountExists(LP_REWARD_VAULT);
    const vaultBal = await getTokenBal(LP_REWARD_VAULT, "HNY");
    const rewardHNY = Number(Math.min(pendingReward, vaultBal).toFixed(8));
    if (rewardHNY <= 0) return res.status(400).json({ error: "Reward vault empty" });

    const ts = now();
    await incrementNonce(wallet);
    await adjustTokenBal(wallet, "HNY", rewardHNY);
    await adjustTokenBal(LP_REWARD_VAULT, "HNY", -rewardHNY);
    await run(db, `UPDATE lp_positions SET rewardPaidHNY=rewardPaidHNY+? WHERE id=?`, [rewardHNY, positionId]);

    // Record transaction
    const txId = crypto.randomUUID();
    await insertTx({
      id: txId,
      hash: sha256Hex(`lp_claim:${wallet}:${positionId}:${nonce}:${ts}`),
      type: "lp_claim",
      fromWallet: LP_REWARD_VAULT,
      toWallet: wallet,
      amount: rewardHNY,
      nonce,
      gasFee: 0,
      serviceFee: 0,
      metaJson: JSON.stringify({ positionId, poolId: pos.poolId, rewardHNY }),
      status: "confirmed",
      failReason: null,
      expiresAtMs: ts + 60000,
      blockHeight: null,
      blockHash: null,
      timestampMs: ts,
    });

    return res.json({ success: true, positionId, rewardHNY, txId });
  } catch (e) {
    return res.status(500).json({ error: e.message || "claim LP reward failed" });
  }
});

/* ======================
   GET LP POSITIONS
====================== */
app.get("/liquidity/positions/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const positions = await all(db, `SELECT * FROM lp_positions WHERE wallet=?`, [wallet]);
    const tokenRows = await all(db, `SELECT symbol, mockPriceUSD FROM tokens`);
    const priceMap = {};
    for (const t of tokenRows) priceMap[t.symbol] = Number(t.mockPriceUSD || 1);

    const result = [];
    for (const pos of positions) {
      const pool = await get(db, `SELECT * FROM liquidity_pools WHERE id=?`, [pos.poolId]);
      if (!pool) continue;
      const totalLP = Number(pool.totalLpShares);
      const shareRatio = totalLP > 0 ? Number(pos.lpShares) / totalLP : 0;
      const tokenAValue = shareRatio * Number(pool.reserveA);
      const tokenBValue = shareRatio * Number(pool.reserveB);
      const posUSD = tokenAValue * (priceMap[pool.tokenA] || 1) + tokenBValue * (priceMap[pool.tokenB] || 1);
      const pendingRewardHNY = computeLpReward(
        Number(pos.lpShares), priceMap[pool.tokenA] || 1, priceMap[pool.tokenB] || 1,
        pool.reserveA, pool.reserveB, totalLP, pos.createdAtMs, pos.rewardPaidHNY
      );
      result.push({
        ...pos,
        pool,
        sharePercent: shareRatio * 100,
        tokenAValue: Number(tokenAValue.toFixed(8)),
        tokenBValue: Number(tokenBValue.toFixed(8)),
        positionUSD: Number(posUSD.toFixed(2)),
        pendingRewardHNY,
        apr: LP_APR,
      });
    }

    return res.json({ success: true, positions: result, apr: LP_APR });
  } catch (e) {
    return res.status(500).json({ error: e.message || "failed to fetch LP positions" });
  }
});

/* ======================
   LP SWAP QUOTE (for LPHNY token availability check)
====================== */
app.get("/liquidity/lphny-available", async (req, res) => {
  try {
    const { wallet } = req.query;
    const lphnyBal = wallet ? await getTokenBal(String(wallet), "LPHNY") : 0;
    const stHnyBal = wallet ? await getTokenBal(String(wallet), "stHNY") : 0;
    return res.json({ lphny: lphnyBal, stHNY: stHnyBal });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ======================
   CHRYSALIS SECURITY FRAMEWORK
   Post-quantum key registration, consent tokens, and wallet protection status.
====================== */

/**
 * POST /chrysalis/register
 * Register a wallet's Chrysalis post-quantum public keys on the server.
 * The wallet must already exist (ensureWalletId called first).
 * Body: { wallet, chrysalisId, kemPublicKeyHex, dsaPublicKeyHex, signature (Ed25519, hex) }
 */
app.post("/chrysalis/register", async (req, res) => {
  try {
    const { wallet, chrysalisId, kemPublicKeyHex, dsaPublicKeyHex } = req.body || {};
    if (!wallet || !chrysalisId || !kemPublicKeyHex || !dsaPublicKeyHex) {
      return res.status(400).json({ error: "wallet, chrysalisId, kemPublicKeyHex, dsaPublicKeyHex required" });
    }

    // Wallet must already exist
    const account = await get(db, `SELECT wallet, mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!account) {
      return res.status(404).json({ error: "Wallet not found. Register the wallet first." });
    }

    // Basic length sanity checks (ML-KEM-768 pub = 1184 bytes → 2368 hex chars)
    if (kemPublicKeyHex.length !== 2368) {
      return res.status(400).json({ error: `Invalid kemPublicKeyHex length: expected 2368, got ${kemPublicKeyHex.length}` });
    }
    // ML-DSA-65 pub = 1952 bytes → 3904 hex chars
    if (dsaPublicKeyHex.length !== 3904) {
      return res.status(400).json({ error: `Invalid dsaPublicKeyHex length: expected 3904, got ${dsaPublicKeyHex.length}` });
    }
    // chrysalisId = SHA3-256 → 64 hex chars
    if (chrysalisId.length !== 64) {
      return res.status(400).json({ error: "Invalid chrysalisId length: expected 64 hex chars" });
    }

    await run(
      db,
      `UPDATE accounts
         SET chrysalis_kem_pubkey=?, chrysalis_dsa_pubkey=?, chrysalis_id=?, chrysalis_registered_at=?
       WHERE wallet=?`,
      [kemPublicKeyHex, dsaPublicKeyHex, chrysalisId, now(), wallet]
    );

    return res.json({
      success     : true,
      wallet,
      chrysalisId,
      kemAlg      : "ML-KEM-768",
      dsaAlg      : "ML-DSA-65",
      version     : "1.0",
      message     : "Chrysalis post-quantum keys registered. Wallet is now quantum-resistant.",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "chrysalis/register failed" });
  }
});

/**
 * GET /chrysalis/status/:wallet
 * Returns the Chrysalis protection status for a wallet.
 */
app.get("/chrysalis/status/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;
    const account = await get(
      db,
      `SELECT chrysalis_id, chrysalis_kem_pubkey, chrysalis_dsa_pubkey, chrysalis_registered_at
         FROM accounts WHERE wallet=?`,
      [wallet]
    );
    if (!account) return res.status(404).json({ error: "Wallet not found" });

    const protected_ = !!(account.chrysalis_id && account.chrysalis_kem_pubkey);

    return res.json({
      success           : true,
      wallet,
      protected         : protected_,
      chrysalisId       : account.chrysalis_id || null,
      kemAlg            : protected_ ? "ML-KEM-768"  : null,
      dsaAlg            : protected_ ? "ML-DSA-65"   : null,
      version           : protected_ ? "1.0"         : null,
      registeredAt      : account.chrysalis_registered_at || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "chrysalis/status failed" });
  }
});

/**
 * POST /chrysalis/cct/submit
 * Submit a signed Chrysalis Consent Token (CCT) on behalf of the viewer.
 * Body: { signedCCT: SignedConsentToken }
 */
app.post("/chrysalis/cct/submit", async (req, res) => {
  try {
    const { signedCCT } = req.body || {};
    if (!signedCCT) return res.status(400).json({ error: "signedCCT required" });

    const {
      sessionId, viewerWallet, creatorWallet, consent,
      consentHash, dsaSignatureHex, signerPublicKeyHex, chrysalisId,
      issuedAt, revocable, scope, version,
    } = signedCCT;

    if (!sessionId || !viewerWallet || !creatorWallet || consentHash === undefined) {
      return res.status(400).json({ error: "Malformed CCT: missing required fields" });
    }

    // Check for existing non-revoked CCT for this session
    const existing = await get(
      db,
      `SELECT id, consent, revoked_at FROM chrysalis_consent_tokens WHERE session_id=? AND viewer_wallet=?`,
      [sessionId, viewerWallet]
    );

    if (existing && !existing.revoked_at && existing.consent) {
      return res.status(409).json({
        error: "A consent=true CCT for this session already exists and is irreversible.",
      });
    }

    const cctId = `CCT_${sessionId}_${viewerWallet}_${now()}`;
    await run(
      db,
      `INSERT INTO chrysalis_consent_tokens
         (id, session_id, viewer_wallet, creator_wallet, consent, consent_hash,
          dsa_signature_hex, signer_pubkey_hex, chrysalis_id, version,
          issued_at, is_revocable, scope, createdAtMs)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        cctId, sessionId, viewerWallet, creatorWallet,
        consent ? 1 : 0, consentHash, dsaSignatureHex,
        signerPublicKeyHex, chrysalisId, version || "1.0",
        issuedAt || now(), revocable ? 1 : 0, scope || "FULL", now(),
      ]
    );

    return res.json({
      success    : true,
      cctId,
      sessionId,
      viewerWallet,
      creatorWallet,
      consent,
      consentHash,
      irreversible: !!consent,
      message    : consent
        ? "Consent granted. Media ownership transfers to creator. This is irreversible."
        : "Consent withheld. Media remains locked.",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "chrysalis/cct/submit failed" });
  }
});

/**
 * GET /chrysalis/cct/:sessionId
 * Look up the consent status for a session.
 */
app.get("/chrysalis/cct/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const rows = await all(
      db,
      `SELECT id, viewer_wallet, creator_wallet, consent, consent_hash,
              chrysalis_id, issued_at, revoked_at, is_revocable
         FROM chrysalis_consent_tokens WHERE session_id=? ORDER BY issued_at DESC`,
      [sessionId]
    );
    return res.json({ success: true, sessionId, tokens: rows || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message || "chrysalis/cct lookup failed" });
  }
});

/**
 * POST /chrysalis/shards
 * Upload PBKDF2+XSalsa20-encrypted Recovery Shards to the Honey Network (DRSS).
 * The server stores ciphertext only — passphrase never leaves the device.
 * Uploading automatically replaces any previous shards for this wallet.
 * Body: { wallet, chrysalisId, shards: [{part, data}] }
 */
app.post("/chrysalis/shards", async (req, res) => {
  try {
    const { wallet, chrysalisId, shards } = req.body || {};
    if (!wallet || !chrysalisId || !Array.isArray(shards) || shards.length < 4) {
      return res.status(400).json({ error: "wallet, chrysalisId, and 4 shards required" });
    }

    // Wallet must exist and have Chrysalis registered with matching chrysalisId
    const acct = await get(
      db,
      `SELECT wallet, chrysalis_id FROM accounts WHERE wallet=?`,
      [wallet]
    );
    if (!acct) return res.status(404).json({ error: "Wallet not found" });
    if (!acct.chrysalis_id) {
      return res.status(403).json({ error: "Chrysalis not registered for this wallet" });
    }
    if (acct.chrysalis_id !== chrysalisId) {
      return res.status(403).json({ error: "chrysalisId mismatch — register Chrysalis first" });
    }

    // Delete previous shards for this wallet (rotation)
    await run(db, `DELETE FROM chrysalis_shards WHERE wallet=?`, [wallet]);

    // Store each shard
    const ts = now();
    for (const shard of shards) {
      if (!shard.part || !shard.data) continue;
      const id = crypto.randomUUID();
      await run(
        db,
        `INSERT INTO chrysalis_shards (id, chrysalis_id, wallet, shard_part, shard_data, version, uploaded_at)
         VALUES (?, ?, ?, ?, ?, '1.0', ?)`,
        [id, chrysalisId, wallet, shard.part, shard.data, ts]
      );
    }

    return res.json({
      success    : true,
      wallet,
      chrysalisId,
      shardCount : shards.length,
      uploadedAt : ts,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "chrysalis/shards upload failed" });
  }
});

/**
 * GET /chrysalis/shards/byWallet/:wallet
 * Retrieve all DRSS-stored encrypted recovery shards for a wallet.
 * Returns ciphertext — client reconstructs using passphrase locally.
 * Used by the "Restore from Network" flow in import-wallet.tsx.
 */
app.get("/chrysalis/shards/byWallet/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;
    const rows = await all(
      db,
      `SELECT shard_part, shard_data, version, uploaded_at
         FROM chrysalis_shards WHERE wallet=? ORDER BY shard_part`,
      [wallet]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: "No network shards found for this wallet. Generate Recovery Shards from Settings first.",
      });
    }
    return res.json({
      success    : true,
      wallet,
      shardCount : rows.length,
      uploadedAt : rows[0].uploaded_at,
      shards     : rows.map(r => ({
        type: "HIVE_RECOVERY_SHARD_v1",
        part: r.shard_part,
        data: r.shard_data,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "chrysalis/shards fetch failed" });
  }
});

/* ======================
   QUEEN BEE AI
====================== */

// GET /queen-bee/alerts/:wallet — last 20 security alerts for a wallet
app.get("/queen-bee/alerts/:wallet", async (req, res) => {
  try {
    const wallet = String(req.params.wallet || "").trim();
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });
    const alerts = await all(db,
      `SELECT id, wallet, tx_type, tx_data, alert_level, reason, confidence, created_at, dismissed
         FROM security_alerts
        WHERE wallet=? AND dismissed=0
        ORDER BY created_at DESC LIMIT 20`,
      [wallet]
    );
    return res.json({ success: true, wallet, alerts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /queen-bee/dismiss — dismiss an alert
app.post("/queen-bee/dismiss", async (req, res) => {
  try {
    const { alert_id, wallet } = req.body;
    if (!alert_id || !wallet) return res.status(400).json({ error: "Missing alert_id or wallet" });
    await run(db, `UPDATE security_alerts SET dismissed=1 WHERE id=? AND wallet=?`, [alert_id, wallet]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /queen-bee/scan — on-demand wallet activity scan
app.post("/queen-bee/scan", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });
    const recentTxs = await all(db,
      `SELECT type, fromWallet, toWallet AS toWallet, amount, status, timestampMs
         FROM transactions
        WHERE (fromWallet=? OR toWallet=?)
        ORDER BY timestampMs DESC LIMIT 30`,
      [wallet, wallet]
    );
    const { alerts, summary } = await queenBeeAI.scanWalletActivity(wallet, recentTxs);
    // Persist any new ALERT/CAUTION findings
    for (const a of alerts) {
      await run(db,
        `INSERT INTO security_alerts (wallet, tx_type, tx_data, alert_level, reason, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [wallet, a.txType || "scan", a.txData || "{}", a.level, a.reason, a.confidence]
      ).catch(() => {});
    }
    return res.json({ success: true, alerts, summary });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ======================
   TRADE (honey.trade /trade page)
====================== */

// Returns the last 50 swap transactions with parsed amounts for recent trades table
app.get("/trade/recent", async (req, res) => {
  const db = openDb();
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await all(db,
      `SELECT id AS txid, fromWallet AS wallet, metaJson AS meta, timestampMs
         FROM transactions
        WHERE type='swap' AND status='confirmed'
        ORDER BY timestampMs DESC
        LIMIT ?`,
      [limit]
    );
    const swaps = rows.map(r => {
      let meta = {};
      try { meta = JSON.parse(r.meta || "{}"); } catch {}
      const fromAmount = Number(meta.amountIn    || meta.fromAmount || 0);
      const toAmount   = Number(meta.expectedAmountOut || meta.toAmount || 0);
      return {
        txid:       r.txid,
        wallet:     r.wallet,
        fromToken:  meta.tokenIn    || meta.fromToken || meta.fromSymbol || "?",
        toToken:    meta.tokenOut   || meta.toToken   || meta.toSymbol   || "?",
        fromAmount,
        toAmount,
        price:      fromAmount > 0 ? toAmount / fromAmount : 0,
        ts:         Number(r.timestampMs || 0),
      };
    });
    return res.json({ swaps });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ======================
   OHLCV CANDLE DATA (honey.trade price charts)
====================== */
const TIMEFRAME_MS = {
  "1s":  1_000,
  "1m":  60_000,
  "5m":  5  * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h":  60 * 60_000,
  "4h":  4  * 60 * 60_000,
  "1D":  24 * 60 * 60_000,
  "1W":  7  * 24 * 60 * 60_000,
  "1M":  30 * 24 * 60 * 60_000,
  "1Y":  365 * 24 * 60 * 60_000,
};

app.get("/trade/candles", async (req, res) => {
  const db = openDb();
  try {
    const pair      = String(req.query.pair      || "HNY/USDC");
    const timeframe = String(req.query.timeframe || "15m");
    const limit     = Math.min(Number(req.query.limit) || 200, 500);

    const parts = pair.split("/");
    if (parts.length !== 2) return res.status(400).json({ error: "pair must be BASE/QUOTE e.g. HNY/USDC" });
    const [base, quote] = parts.map(s => s.toUpperCase());

    const bucketMs = TIMEFRAME_MS[timeframe];
    if (!bucketMs) {
      return res.status(400).json({ error: `Unsupported timeframe. Valid: ${Object.keys(TIMEFRAME_MS).join(", ")}` });
    }

    const nowMs    = Date.now();
    const windowMs = bucketMs * limit;
    const startMs  = nowMs - windowMs;

    const rows = await all(db,
      `SELECT metaJson, timestampMs
         FROM transactions
        WHERE type='swap' AND status='confirmed'
          AND timestampMs >= ? AND timestampMs <= ?
        ORDER BY timestampMs ASC`,
      [startMs, nowMs]
    );

    // Aggregate into OHLCV buckets
    const buckets = new Map(); // bucketStart (ms) → {ts, o, h, l, c, v}

    for (const row of rows) {
      let meta = {};
      try { meta = JSON.parse(row.metaJson || "{}"); } catch {}

      const tIn  = (meta.tokenIn  || meta.fromToken || meta.fromSymbol || "").toUpperCase();
      const tOut = (meta.tokenOut || meta.toToken   || meta.toSymbol   || "").toUpperCase();

      // Check if this swap belongs to the requested pair (either direction)
      const isPair = (tIn === base && tOut === quote) || (tIn === quote && tOut === base);
      if (!isPair) continue;

      const fromAmt = Number(meta.amountIn || meta.fromAmount || 0);
      const toAmt   = Number(meta.expectedAmountOut || meta.toAmount || 0);
      if (fromAmt <= 0 || toAmt <= 0) continue;

      // Normalize price as quotePerBase
      let price, vol;
      if (tIn === base) {
        price = toAmt / fromAmt;   // quoteOut per baseIn
        vol   = fromAmt;           // volume in base token
      } else {
        price = fromAmt / toAmt;   // quoteIn per baseOut
        vol   = toAmt;             // volume in base token
      }

      const ts = Number(row.timestampMs);
      const bucketStart = Math.floor(ts / bucketMs) * bucketMs;

      if (!buckets.has(bucketStart)) {
        buckets.set(bucketStart, { ts: bucketStart, o: price, h: price, l: price, c: price, v: vol });
      } else {
        const b = buckets.get(bucketStart);
        b.h = Math.max(b.h, price);
        b.l = Math.min(b.l, price);
        b.c = price;
        b.v += vol;
      }
    }

    // Sort and round
    let candles = Array.from(buckets.values())
      .sort((a, b) => a.ts - b.ts)
      .map(c => ({
        ts: c.ts,
        o:  Number(c.o.toFixed(8)),
        h:  Number(c.h.toFixed(8)),
        l:  Number(c.l.toFixed(8)),
        c:  Number(c.c.toFixed(8)),
        v:  Number(c.v.toFixed(8)),
      }));

    // Seed synthetic candles when no real trade data exists yet
    if (candles.length === 0) {
      const SEED_PRICES = {
        'HNY/USDC': 1.00, 'HNY/USDT': 1.00, 'HNY/ETH': 0.00035,
        'HNY/BTC': 0.000015, 'stHNY/HNY': 1.02, 'LPHNY/HNY': 1.05,
      };
      const basePrice = SEED_PRICES[pair] || 1.00;
      const seedCount = Math.min(limit, 100);
      let price = basePrice;
      for (let i = seedCount - 1; i >= 0; i--) {
        const ts = Math.floor((nowMs - i * bucketMs) / bucketMs) * bucketMs;
        // Random walk ±0.5%
        const change = (Math.random() - 0.5) * 0.01 * price;
        const o = price;
        price = Math.max(price + change, basePrice * 0.5);
        const h = Math.max(o, price) * (1 + Math.random() * 0.003);
        const l = Math.min(o, price) * (1 - Math.random() * 0.003);
        const v = Math.random() * 500 + 50;
        candles.push({ ts, o: Number(o.toFixed(8)), h: Number(h.toFixed(8)), l: Number(l.toFixed(8)), c: Number(price.toFixed(8)), v: Number(v.toFixed(4)) });
      }
    }

    return res.json({ pair, timeframe, candles, seeded: buckets.size === 0 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ======================
   WEB STATS (honey.trade landing page)
====================== */

app.get("/web/stats", async (_req, res) => {
  const db = openDb();
  try {
    const wallets  = await get(db, `SELECT COUNT(*) as n FROM accounts WHERE wallet NOT LIKE 'HNY_VAULT%' AND wallet NOT LIKE 'HNY_LP_%' AND wallet NOT LIKE 'HNY_WALLET_%'`, []);
    const txns     = await get(db, `SELECT COUNT(*) as n FROM transactions`, []);
    const nfts     = await get(db, `SELECT COUNT(*) as n FROM nfts`, []);
    const listed   = await get(db, `SELECT COUNT(*) as n FROM nfts WHERE listed_price_hny IS NOT NULL AND auction_id IS NULL`, []);
    const lp       = await get(db, `SELECT SUM(hny_amount * 2) as tvl FROM liquidity_positions WHERE is_active=1`, []);
    const blk      = await get(db, `SELECT MAX(block_number) as h FROM transactions`, []);
    const prices   = await get(db, `SELECT price_usd FROM token_prices WHERE symbol='HNY' ORDER BY updated_at DESC LIMIT 1`, []);
    return res.json({
      totalWallets:      Number(wallets?.n ?? 0),
      totalTransactions: Number(txns?.n ?? 0),
      totalNfts:         Number(nfts?.n ?? 0),
      listedNfts:        Number(listed?.n ?? 0),
      totalLiquidityHny: Number(lp?.tvl ?? 0),
      blockHeight:       Number(blk?.h ?? 0),
      hnyPriceUsd:       Number(prices?.price_usd ?? 1.00),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    db.close();
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
    await ensureAccountExists(LP_REWARD_VAULT);
    await ensureAccountExists(WALLET_FEE_VAULT);
    await ensureAccountExists(FUTURES_FEE_VAULT);
    await ensureAccountExists(LAUNCHPAD_FEE_VAULT);
    await ensureAccountExists(ORDERBOOK_FEE_VAULT);
    await ensureAccountExists(BOTS_FEE_VAULT);
    await ensureAccountExists(BRIDGE_FEE_VAULT);
    await ensureAccountExists(GOVERNANCE_TREASURY);
    await ensureAccountExists(COPY_FEE_VAULT);
    // ── H7b: Yield vault accounts + state seed ─────────────────────────────────
    await ensureAccountExists('HNY_STAKING_VAULT');
    await ensureAccountExists('HNY_LP_VAULT');
    await run(db, `INSERT OR IGNORE INTO vault_state(vault_id,total_shares,total_hny,last_compound_ms,apr_pct) VALUES ('HNY_STAKING_VAULT',0,0,0,5.0)`, []);
    await run(db, `INSERT OR IGNORE INTO vault_state(vault_id,total_shares,total_hny,last_compound_ms,apr_pct) VALUES ('HNY_LP_VAULT',0,0,0,8.0)`, []);
    // Seed DAO governance treasury with 100k HNY if empty (testnet)
    const govTreasRow = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [GOVERNANCE_TREASURY]);
    if (Number(govTreasRow?.balance || 0) === 0) {
      await run(db, `UPDATE accounts SET balance=100000 WHERE wallet=?`, [GOVERNANCE_TREASURY]);
      console.log('🏛️  DAO Treasury seeded: 100,000 HNY');
    }
    // Seed LP reward vault with 1M HNY if empty (devnet only)
    const lpVaultRow = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [LP_REWARD_VAULT]);
    if (Number(lpVaultRow?.balance || 0) === 0) {
      await run(db, `UPDATE accounts SET balance=1000000 WHERE wallet=?`, [LP_REWARD_VAULT]);
    }
    await startBlockProducer();

    // ── Futures background jobs ────────────────────────────────────────────────
    // Check liquidations every 30 seconds
    setInterval(() => checkLiquidations().catch(console.error), 30_000);
    // Apply funding every 8 hours
    setInterval(() => applyFunding().catch(console.error), 8 * 60 * 60 * 1000);
    // Run once on startup to catch any missed funding/liquidations
    checkLiquidations().catch(console.error);

    // ── Bot engine + Copy Trading (run together every BOT_CHECK_MS) ────────────
    setInterval(async () => {
      try { await runAllBots(); } catch(e) { console.error('runAllBots error:', e); }
      try { await processCopyTrades(); } catch(e) { console.error('processCopyTrades error:', e); }
    }, BOT_CHECK_MS);
    runAllBots().catch(console.error);
    processCopyTrades().catch(console.error);

    // ── Bridge relayer ─────────────────────────────────────────────────────────
    setInterval(() => processPendingBridges().catch(console.error), 30_000);
    processPendingBridges().catch(console.error);

    // ── DAO Governance processor ───────────────────────────────────────────────
    setInterval(() => processGovernance().catch(console.error), 60_000);
    processGovernance().catch(console.error);

    // ── Portfolio snapshots (every hour) ───────────────────────────────────────
    setInterval(() => snapshotPortfolios().catch(console.error), 60 * 60_000);

    // ── Vault compounding (every hour) ────────────────────────────────────────
    setInterval(() => compoundVaults().catch(console.error), VAULT_COMPOUND_MS);
    compoundVaults().catch(console.error);

    // ── Notification generators (every 60s) ───────────────────────────────────
    setInterval(async () => {
      try { await checkBotAlerts(); }          catch(e) { console.error('checkBotAlerts:', e); }
      try { await checkLiquidationWarnings(); } catch(e) { console.error('checkLiquidationWarnings:', e); }
      try { await checkDaoResults(); }         catch(e) { console.error('checkDaoResults:', e); }
      try { await checkBridgeComplete(); }     catch(e) { console.error('checkBridgeComplete:', e); }
      try { await checkNftBids(); }            catch(e) { console.error('checkNftBids:', e); }
    }, 60_000);

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
