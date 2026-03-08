// apps/mobile/honey-dev/copy-trading.js
// Copy Trading Router — Phase H6c
// Social copy-trading: mirror top bot traders automatically.
// Leaders earn 50% of copy fees; followers mirror proportionally.
"use strict";

const express = require("express");
const crypto  = require("crypto");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────
const COPY_FEE_VAULT  = "HNY_COPY_FEE_VAULT";
const COPY_FEE_RATE   = 0.01;   // 1% per copy trade
const LEADER_SHARE    = 0.5;    // leader earns 50% of copy fee
const LOOKBACK_SEC    = 120;    // seconds to look back for bot trades to copy

// ── ML-DSA-65 verification (same lazy-import pattern as governance.js) ────
let _mlDsa65;
async function getMlDsa() {
  if (!_mlDsa65) {
    const mod = await import("@noble/post-quantum/ml-dsa");
    _mlDsa65 = mod.ml_dsa65;
  }
  return _mlDsa65;
}
async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  try {
    const mlDsa  = await getMlDsa();
    const pubKey = Buffer.from(mldsaPubKeyHex, "hex");
    const sig    = Buffer.from(signatureHex,   "hex");
    const msgBuf = Buffer.from(message, "utf8");
    return { ok: mlDsa.verify(pubKey, msgBuf, sig) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function now() { return Date.now(); }
function uid() { return crypto.randomUUID(); }

function formatLeader(row) {
  return {
    wallet:               row.wallet,
    displayName:          row.display_name || '',
    bio:                  row.bio || '',
    strategyDescription:  row.strategy_description || '',
    feePct:               row.fee_pct || 10,
    isPublic:             !!row.is_public,
    registeredAtMs:       row.registered_at_ms,
    // optional computed fields
    rank:           row.rank         ?? null,
    totalPnlHny:    row.total_pnl    != null ? Number(row.total_pnl)    : null,
    tradeCount:     row.trade_count  != null ? Number(row.trade_count)  : null,
    activeBots:     row.active_bots  != null ? Number(row.active_bots)  : null,
    followerCount:  row.follower_count != null ? Number(row.follower_count) : null,
    winRatePct:     row.win_rate_pct != null ? Number(row.win_rate_pct) : null,
    isLeader:       !!row.is_leader,
  };
}

function formatSub(row) {
  return {
    id:               row.id,
    followerWallet:   row.follower_wallet,
    leaderWallet:     row.leader_wallet,
    perTradeLimitHny: row.per_trade_limit_hny,
    usedHny:          row.used_hny,
    totalPnlHny:      row.total_pnl_hny,
    status:           row.status,
    subscribedAtMs:   row.subscribed_at_ms,
    lastCopyAtMs:     row.last_copy_at_ms || null,
    // optional joined fields
    leaderDisplayName: row.display_name || null,
  };
}

function formatCopyTrade(row) {
  return {
    id:             row.id,
    subscriptionId: row.subscription_id,
    followerWallet: row.follower_wallet,
    leaderWallet:   row.leader_wallet,
    leaderBotId:    row.leader_bot_id,
    action:         row.action,
    copyAmountHny:  row.copy_amount_hny,
    feeHny:         row.fee_hny,
    leaderPrice:    row.leader_price,
    executedAtMs:   row.executed_at_ms,
  };
}

// ── GET /copy/leaderboard ─────────────────────────────────────────────────
router.get("/leaderboard", async (req, res) => {
  try {
    const db    = await openDb();
    const limit = Math.min(parseInt(req.query.limit || "50"), 100);

    // Aggregate PnL + trade count per wallet from trading_bots + bot_trades
    const rows = await all(db, `
      SELECT
        tb.wallet,
        COALESCE(cl.display_name, '')        AS display_name,
        COALESCE(cl.bio, '')                 AS bio,
        COALESCE(cl.strategy_description,'') AS strategy_description,
        COALESCE(cl.fee_pct, 10)             AS fee_pct,
        CASE WHEN cl.wallet IS NOT NULL THEN 1 ELSE 0 END AS is_leader,
        ROUND(SUM(CAST(tb.total_pnl AS REAL)), 6) AS total_pnl,
        COUNT(DISTINCT tb.id)                AS active_bots,
        COALESCE(tc.trade_count, 0)          AS trade_count,
        COALESCE(cs.follower_count, 0)       AS follower_count
      FROM trading_bots tb
      LEFT JOIN copy_leaders cl ON cl.wallet = tb.wallet
      LEFT JOIN (
        SELECT bot_id, COUNT(*) AS trade_count
        FROM bot_trades
        GROUP BY bot_id
      ) tc ON tc.bot_id = tb.id
      LEFT JOIN (
        SELECT leader_wallet, COUNT(*) AS follower_count
        FROM copy_subscriptions
        WHERE status = 'active'
        GROUP BY leader_wallet
      ) cs ON cs.leader_wallet = tb.wallet
      WHERE tb.status != 'deleted'
      GROUP BY tb.wallet
      ORDER BY total_pnl DESC
      LIMIT ?
    `, [limit]);

    const leaders = rows.map((r, i) => ({ ...formatLeader(r), rank: i + 1 }));
    return res.json({ leaders });
  } catch (e) {
    console.error("[copy] GET /leaderboard error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /copy/leader/:wallet ──────────────────────────────────────────────
router.get("/leader/:wallet", async (req, res) => {
  try {
    const db     = await openDb();
    const wallet = req.params.wallet;
    const row    = await get(db, `SELECT * FROM copy_leaders WHERE wallet=?`, [wallet]);
    if (!row) return res.status(404).json({ error: "Not a registered copy leader" });

    // Compute stats
    const pnlRow   = await get(db, `SELECT COALESCE(SUM(CAST(total_pnl AS REAL)),0) AS pnl FROM trading_bots WHERE wallet=? AND status!='deleted'`, [wallet]);
    const botsRow  = await get(db, `SELECT COUNT(*) AS n FROM trading_bots WHERE wallet=? AND status='active'`, [wallet]);
    const fwRow    = await get(db, `SELECT COUNT(*) AS n FROM copy_subscriptions WHERE leader_wallet=? AND status='active'`, [wallet]);
    const trRow    = await get(db, `SELECT COUNT(*) AS n FROM bot_trades bt JOIN trading_bots tb ON tb.id=bt.bot_id WHERE tb.wallet=?`, [wallet]);

    return res.json({
      leader: {
        ...formatLeader(row),
        totalPnlHny:   Number(pnlRow?.pnl || 0),
        activeBots:    Number(botsRow?.n || 0),
        followerCount: Number(fwRow?.n || 0),
        tradeCount:    Number(trRow?.n || 0),
        isLeader:      true,
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /copy/subscriptions/:wallet (follower's subs) ─────────────────────
router.get("/subscriptions/:wallet", async (req, res) => {
  try {
    const db   = await openDb();
    const rows = await all(db,
      `SELECT cs.*, cl.display_name FROM copy_subscriptions cs
       LEFT JOIN copy_leaders cl ON cl.wallet = cs.leader_wallet
       WHERE cs.follower_wallet=? ORDER BY cs.subscribed_at_ms DESC`,
      [req.params.wallet]
    );
    return res.json({ subscriptions: rows.map(formatSub) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /copy/followers/:wallet (leader's followers) ──────────────────────
router.get("/followers/:wallet", async (req, res) => {
  try {
    const db   = await openDb();
    const rows = await all(db,
      `SELECT * FROM copy_subscriptions WHERE leader_wallet=? ORDER BY subscribed_at_ms DESC`,
      [req.params.wallet]
    );
    return res.json({ subscriptions: rows.map(formatSub) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /copy/trades/:wallet (follower's copy trade history) ──────────────
router.get("/trades/:wallet", async (req, res) => {
  try {
    const db    = await openDb();
    const limit = Math.min(parseInt(req.query.limit || "50"), 200);
    const rows  = await all(db,
      `SELECT * FROM copy_trades WHERE follower_wallet=? ORDER BY executed_at_ms DESC LIMIT ?`,
      [req.params.wallet, limit]
    );
    return res.json({ trades: rows.map(formatCopyTrade) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /copy/stats ───────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const db = await openDb();
    const [ldRow, subRow, activeRow, volRow, trRow, vaultRow] = await Promise.all([
      get(db, `SELECT COUNT(*) AS n FROM copy_leaders`, []),
      get(db, `SELECT COUNT(DISTINCT follower_wallet) AS n FROM copy_subscriptions WHERE status='active'`, []),
      get(db, `SELECT COUNT(*) AS n FROM copy_subscriptions WHERE status='active'`, []),
      get(db, `SELECT COALESCE(SUM(copy_amount_hny + fee_hny),0) AS vol FROM copy_trades`, []),
      get(db, `SELECT COUNT(*) AS n FROM copy_trades`, []),
      get(db, `SELECT balance FROM accounts WHERE wallet=?`, [COPY_FEE_VAULT]),
    ]);
    return res.json({
      totalLeaders:        Number(ldRow?.n || 0),
      totalCopiers:        Number(subRow?.n || 0),
      activeSubs:          Number(activeRow?.n || 0),
      totalCopyVolumeHny:  Number(volRow?.vol || 0),
      totalCopyTrades:     Number(trRow?.n || 0),
      feeVaultBalanceHny:  Number(vaultRow?.balance || 0),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /copy/register-leader ────────────────────────────────────────────
router.post("/register-leader", async (req, res) => {
  try {
    const db = await openDb();
    const { wallet, displayName, bio, strategyDescription, feePct,
            signatureHex, ts } = req.body;

    if (!wallet || !displayName)
      return res.status(400).json({ error: "wallet and displayName required" });

    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!account?.mldsa_public_key)
      return res.status(403).json({ error: "Wallet not registered" });

    const message = `copy_register|${wallet}|${displayName}|${feePct || 10}|${ts}`;
    const sigCheck = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex,
    });
    if (!sigCheck.ok)
      return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    await run(db,
      `INSERT OR REPLACE INTO copy_leaders
         (wallet, display_name, bio, strategy_description, fee_pct, is_public, registered_at_ms)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [wallet, displayName.slice(0, 50), (bio||'').slice(0, 300),
       (strategyDescription||'').slice(0, 500), Math.min(Math.max(Number(feePct||10),0),20), now()]
    );
    const row = await get(db, `SELECT * FROM copy_leaders WHERE wallet=?`, [wallet]);
    return res.status(201).json({ leader: formatLeader(row) });
  } catch (e) {
    console.error("[copy] POST /register-leader error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /copy/update-leader ──────────────────────────────────────────────
router.post("/update-leader", async (req, res) => {
  try {
    const db = await openDb();
    const { wallet, displayName, bio, strategyDescription, feePct,
            signatureHex, ts } = req.body;

    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!account?.mldsa_public_key) return res.status(403).json({ error: "Wallet not registered" });

    const message = `copy_update|${wallet}|${displayName}|${feePct || 10}|${ts}`;
    const sigCheck = await verifyMLDSASignature({ mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex });
    if (!sigCheck.ok) return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    await run(db,
      `UPDATE copy_leaders SET display_name=?, bio=?, strategy_description=?, fee_pct=? WHERE wallet=?`,
      [displayName.slice(0, 50), (bio||'').slice(0, 300),
       (strategyDescription||'').slice(0, 500), Math.min(Math.max(Number(feePct||10),0),20), wallet]
    );
    const row = await get(db, `SELECT * FROM copy_leaders WHERE wallet=?`, [wallet]);
    return res.json({ leader: formatLeader(row) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /copy/subscribe ──────────────────────────────────────────────────
router.post("/subscribe", async (req, res) => {
  try {
    const db = await openDb();
    const { followerWallet, leaderWallet, perTradeLimitHny,
            signatureHex, ts } = req.body;

    if (!followerWallet || !leaderWallet || !perTradeLimitHny)
      return res.status(400).json({ error: "followerWallet, leaderWallet, perTradeLimitHny required" });
    if (followerWallet === leaderWallet)
      return res.status(400).json({ error: "Cannot copy yourself" });

    const leader = await get(db, `SELECT * FROM copy_leaders WHERE wallet=?`, [leaderWallet]);
    if (!leader) return res.status(404).json({ error: "Leader not found — they must register first" });

    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [followerWallet]);
    if (!account?.mldsa_public_key) return res.status(403).json({ error: "Wallet not registered" });

    const message = `copy_subscribe|${followerWallet}|${leaderWallet}|${perTradeLimitHny}|${ts}`;
    const sigCheck = await verifyMLDSASignature({ mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex });
    if (!sigCheck.ok) return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    const id = uid();
    try {
      await run(db,
        `INSERT INTO copy_subscriptions
           (id, follower_wallet, leader_wallet, per_trade_limit_hny, status, subscribed_at_ms)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [id, followerWallet, leaderWallet, Number(perTradeLimitHny), now()]
      );
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        // Reactivate if cancelled
        await run(db,
          `UPDATE copy_subscriptions SET status='active', per_trade_limit_hny=?, subscribed_at_ms=?
           WHERE follower_wallet=? AND leader_wallet=?`,
          [Number(perTradeLimitHny), now(), followerWallet, leaderWallet]
        );
      } else { throw e; }
    }
    const sub = await get(db,
      `SELECT * FROM copy_subscriptions WHERE follower_wallet=? AND leader_wallet=?`,
      [followerWallet, leaderWallet]
    );
    return res.status(201).json({ subscription: formatSub(sub) });
  } catch (e) {
    console.error("[copy] POST /subscribe error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /copy/pause-sub/:id ──────────────────────────────────────────────
router.post("/pause-sub/:id", async (req, res) => {
  try {
    const db  = await openDb();
    const sub = await get(db, `SELECT * FROM copy_subscriptions WHERE id=?`, [req.params.id]);
    if (!sub) return res.status(404).json({ error: "Subscription not found" });
    if (sub.follower_wallet !== req.body.wallet)
      return res.status(403).json({ error: "Not your subscription" });
    await run(db, `UPDATE copy_subscriptions SET status='paused' WHERE id=?`, [sub.id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /copy/cancel-sub/:id ─────────────────────────────────────────────
router.post("/cancel-sub/:id", async (req, res) => {
  try {
    const db  = await openDb();
    const { wallet, signatureHex, ts } = req.body;
    const sub = await get(db, `SELECT * FROM copy_subscriptions WHERE id=?`, [req.params.id]);
    if (!sub) return res.status(404).json({ error: "Subscription not found" });
    if (sub.follower_wallet !== wallet)
      return res.status(403).json({ error: "Not your subscription" });

    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    const message = `copy_cancel|${wallet}|${sub.id}|${ts}`;
    const sigCheck = await verifyMLDSASignature({ mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex });
    if (!sigCheck.ok) return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    await run(db, `UPDATE copy_subscriptions SET status='cancelled' WHERE id=?`, [sub.id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── processCopyTrades — called after runAllBots ───────────────────────────
async function processCopyTrades() {
  const db = await openDb();
  try {
    // Find all bot trades in the last LOOKBACK_SEC seconds
    const recentTrades = await all(db, `
      SELECT bt.*, tb.wallet AS leader_wallet
      FROM bot_trades bt
      JOIN trading_bots tb ON tb.id = bt.bot_id
      WHERE datetime(bt.traded_at) >= datetime('now', '-${LOOKBACK_SEC} seconds')
        AND tb.status != 'deleted'
    `, []);

    for (const trade of recentTrades) {
      // Get active subscriptions for this leader
      const subs = await all(db,
        `SELECT * FROM copy_subscriptions WHERE leader_wallet=? AND status='active'`,
        [trade.leader_wallet]
      );
      if (subs.length === 0) continue;

      const sig = `${trade.bot_id}|${trade.traded_at}|${trade.action}`;

      for (const sub of subs) {
        // Skip copying own trades (safety)
        if (sub.follower_wallet === trade.leader_wallet) continue;

        const copyAmount = Math.min(Number(trade.amount_hny), sub.per_trade_limit_hny);
        if (copyAmount <= 0) continue;

        const fee   = copyAmount * COPY_FEE_RATE;
        const total = copyAmount + fee;

        // Check follower balance
        const balRow = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [sub.follower_wallet]);
        const bal    = Number(balRow?.balance || 0);
        if (bal < total) continue;

        try {
          // Deduct from follower
          await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [total, sub.follower_wallet]);
          // Credit leader (50% of fee as performance reward)
          await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [fee * LEADER_SHARE, trade.leader_wallet]);
          // Credit fee vault (other 50%)
          await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [fee * (1 - LEADER_SHARE), COPY_FEE_VAULT]);

          // Record the copy trade (INSERT OR IGNORE deduplicates)
          await run(db, `
            INSERT OR IGNORE INTO copy_trades
              (id, subscription_id, follower_wallet, leader_wallet, leader_bot_id,
               bot_trade_sig, action, copy_amount_hny, fee_hny, leader_price, executed_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [uid(), sub.id, sub.follower_wallet, trade.leader_wallet, trade.bot_id,
              sig, trade.action, copyAmount, fee, Number(trade.price_hny || 0), Date.now()]);

          // Update subscription stats
          await run(db,
            `UPDATE copy_subscriptions SET used_hny=used_hny+?, last_copy_at_ms=? WHERE id=?`,
            [total, Date.now(), sub.id]
          );
        } catch (e) {
          if (!e.message.includes('UNIQUE')) {
            console.error(`[copy] copy trade error for sub ${sub.id}:`, e.message);
          }
        }
      }
    }
  } catch (e) {
    console.error("[copy] processCopyTrades error:", e);
  }
}

module.exports = { router, COPY_FEE_VAULT, processCopyTrades };
