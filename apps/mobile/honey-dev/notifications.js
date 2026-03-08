// apps/mobile/honey-dev/notifications.js
// Phase H7c — Unified Notifications Router
'use strict';

const express = require('express');
const { openDb, run, get, all } = require('./db');

const router = express.Router();

// ── Internal helper ───────────────────────────────────────────────────────────

async function createNotification(db, wallet, type, title, body, linkHref = null) {
  await run(db,
    `INSERT INTO notifications(wallet,type,title,body,link_href,read,created_at_ms)
     VALUES (?,?,?,?,?,0,?)`,
    [wallet, type, title, body, linkHref, Date.now()]);
}

// ── GET /notifications/:wallet ────────────────────────────────────────────────

router.get('/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const limit  = Math.min(Number(req.query.limit) || 20, 100);
    const db     = await openDb();
    const rows   = await all(db,
      `SELECT id, wallet, type, title, body, link_href as linkHref, read,
              created_at_ms as createdAtMs
       FROM notifications WHERE wallet=? ORDER BY created_at_ms DESC LIMIT ?`,
      [wallet, limit]);
    return res.json({ wallet, notifications: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /notifications/count/:wallet ─────────────────────────────────────────

router.get('/count/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db     = await openDb();
    const row    = await get(db, `SELECT COUNT(*) as n FROM notifications WHERE wallet=? AND read=0`, [wallet]);
    return res.json({ wallet, count: Number(row?.n || 0) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /notifications/read/:id ─────────────────────────────────────────────

router.post('/read/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await openDb();
    await run(db, `UPDATE notifications SET read=1 WHERE id=?`, [id]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /notifications/read-all/:wallet ──────────────────────────────────────

router.post('/read-all/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db     = await openDb();
    await run(db, `UPDATE notifications SET read=1 WHERE wallet=?`, [wallet]);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Notification Generators ───────────────────────────────────────────────────

// Track which events we've already notified to avoid duplicates
const _notified = new Set();

async function checkBotAlerts() {
  const db = await openDb();
  // Bots that have been paused automatically (status changed to paused unexpectedly)
  const staleBots = await all(db,
    `SELECT tb.id, tb.wallet, tb.name, tb.type, tb.status
     FROM trading_bots tb
     WHERE tb.status = 'paused'
       AND tb.updated_at < datetime('now', '-5 minutes')
     LIMIT 20`, []);

  for (const bot of staleBots) {
    const key = `bot_paused_${bot.id}`;
    if (_notified.has(key)) continue;
    _notified.add(key);
    await createNotification(db, bot.wallet, 'bot_status',
      `🤖 Bot Paused: ${bot.name}`,
      `Your ${bot.type} bot "${bot.name}" was automatically paused. Check the Bots page.`,
      '/bots').catch(() => {});
  }
}

async function checkLiquidationWarnings() {
  const db = await openDb();
  // Futures positions where mark price is within 10% of liquidation price
  const atRisk = await all(db,
    `SELECT wallet, id, side, mark_price_usd, liquidation_price_usd,
            ABS(mark_price_usd - liquidation_price_usd) / NULLIF(mark_price_usd, 0) as pct_away
     FROM futures_positions
     WHERE status='open'
       AND ABS(mark_price_usd - liquidation_price_usd) / NULLIF(mark_price_usd, 0) < 0.10
     LIMIT 50`, []);

  for (const pos of atRisk) {
    const key = `liq_warn_${pos.id}_${Math.floor(Date.now() / 300_000)}`; // re-notify every 5m
    if (_notified.has(key)) continue;
    _notified.add(key);
    const pct = (pos.pct_away * 100).toFixed(1);
    await createNotification(db, pos.wallet, 'liquidation_warning',
      `⚠️ Liquidation Warning`,
      `Your ${pos.side} position is ${pct}% from liquidation price ($${Number(pos.liquidation_price_usd).toFixed(2)}). Add collateral now.`,
      '/futures').catch(() => {});
  }
}

async function checkDaoResults() {
  const db = await openDb();
  // Proposals that recently changed to executed/rejected/timelocked
  const recent = await all(db,
    `SELECT p.id, p.proposer_wallet, p.title, p.status, p.voting_ends_at_ms, p.executed_at_ms
     FROM dao_proposals p
     WHERE p.status IN ('executed','rejected','timelocked')
       AND (p.executed_at_ms > ? OR p.voting_ends_at_ms > ?)
     LIMIT 20`,
    [Date.now() - 120_000, Date.now() - 120_000]);

  for (const prop of recent) {
    const key = `dao_result_${prop.id}_${prop.status}`;
    if (_notified.has(key)) continue;
    _notified.add(key);

    // Notify all voters on this proposal
    const voters = await all(db,
      `SELECT DISTINCT voter_wallet FROM dao_votes WHERE proposal_id=?`, [prop.id]);
    const targets = [{ voter_wallet: prop.proposer_wallet }, ...voters];
    const emoji   = prop.status === 'executed' ? '✅' : prop.status === 'timelocked' ? '⏳' : '❌';
    const label   = prop.status === 'executed' ? 'Executed' : prop.status === 'timelocked' ? 'In Timelock' : 'Rejected';

    for (const { voter_wallet } of targets) {
      await createNotification(db, voter_wallet, 'dao_result',
        `${emoji} DAO Proposal ${label}`,
        `"${prop.title}" — ${label}. View on the DAO page.`,
        `/dao/${prop.id}`).catch(() => {});
    }
  }
}

async function checkBridgeComplete() {
  const db = await openDb();
  const recent = await all(db,
    `SELECT wallet, id, direction, amount, net_amount, status, completed_at, failed_at
     FROM bridge_transactions
     WHERE status IN ('completed','failed')
       AND (
         (status='completed' AND datetime(completed_at) >= datetime('now','-2 minutes'))
         OR (status='failed'    AND datetime(failed_at)    >= datetime('now','-2 minutes'))
       )
     LIMIT 20`, []);

  for (const bridge of recent) {
    const key = `bridge_${bridge.id}_${bridge.status}`;
    if (_notified.has(key)) continue;
    _notified.add(key);
    const ok    = bridge.status === 'completed';
    const emoji = ok ? '🌉' : '❌';
    await createNotification(db, bridge.wallet, 'bridge_complete',
      `${emoji} Bridge ${ok ? 'Complete' : 'Failed'}`,
      ok
        ? `Your bridge transfer of ${Number(bridge.net_amount).toFixed(4)} HNY completed successfully.`
        : `Your bridge transfer of ${Number(bridge.amount).toFixed(4)} HNY failed. Funds will be refunded.`,
      '/bridge').catch(() => {});
  }
}

async function checkNftBids() {
  const db = await openDb();
  // New bids in the last 2 minutes on auctions where this wallet is seller
  const newBids = await all(db,
    `SELECT nb.id, nb.auction_id, nb.bidder_wallet, nb.bid_hny, nb.bid_at,
            na.nft_id, n.owner_wallet as seller_wallet, n.name as nft_name
     FROM nft_bids nb
     JOIN nft_auctions na ON nb.auction_id=na.id
     JOIN nfts n ON na.nft_id=n.id
     WHERE datetime(nb.bid_at) >= datetime('now','-2 minutes')
       AND nb.refunded=0
     LIMIT 20`, []);

  for (const bid of newBids) {
    const key = `nft_bid_${bid.id}`;
    if (_notified.has(key)) continue;
    _notified.add(key);
    await createNotification(db, bid.seller_wallet, 'nft_bid',
      '🖼 New Bid on Your NFT',
      `${bid.bidder_wallet.slice(0,10)} bid ${Number(bid.bid_hny).toFixed(2)} HNY on "${bid.nft_name}".`,
      `/nft/${bid.nft_id}`).catch(() => {});
  }
}

module.exports = {
  router,
  createNotification,
  checkBotAlerts,
  checkLiquidationWarnings,
  checkDaoResults,
  checkBridgeComplete,
  checkNftBids,
};
