// apps/mobile/honey-dev/analytics.js
// Phase H7a — Portfolio Analytics Router
'use strict';

const express = require('express');
const { openDb, run, get, all } = require('./db');

const router = express.Router();

// ── Price helper (uses live Pyth prices from server.js global or falls back) ──
const HNY_PRICE_USD = Number(process.env.HNY_PRICE_USD) || 1.0;

async function getHnyPrice(db) {
  // Try to get from pyth_prices table if it exists, else fallback
  try {
    const row = await get(db, `SELECT price FROM pyth_prices WHERE symbol='HNY' ORDER BY fetched_at DESC LIMIT 1`, []);
    return row ? Number(row.price) : HNY_PRICE_USD;
  } catch {
    return HNY_PRICE_USD;
  }
}

// ── GET /analytics/portfolio/:wallet ─────────────────────────────────────────

router.get('/portfolio/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const db = await openDb();

    const [
      account,
      tokenBals,
      stakingRows,
      lpRows,
      futuresOpen,
      futuresClosed,
      bots,
      copySubs,
      launchpadHoldings,
      vaultDeps,
      locks,
      nftCount,
    ] = await Promise.all([
      get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]),
      all(db, `SELECT tokenSymbol as symbol, balance FROM token_balances WHERE wallet=? AND balance>0`, [wallet]),
      all(db, `SELECT principal, reward_paid as rewardPaid, lock_days, unlock_at_ms as unlockAtMs, status
               FROM staking_positions WHERE wallet=? AND status NOT IN ('withdrawn')`, [wallet]),
      all(db, `SELECT lp.id, lp.lp_shares as lpShares, lp.reward_paid_hny as rewardPaidHny,
                      p.token_a as tokenA, p.token_b as tokenB,
                      p.reserve_a as reserveA, p.reserve_b as reserveB, p.total_lp_shares as totalShares
               FROM lp_positions lp JOIN liquidity_pools p ON lp.pool_id=p.id WHERE lp.wallet=?`, [wallet]),
      all(db, `SELECT unrealized_pnl_hny FROM futures_positions WHERE wallet=? AND status='open'`, [wallet]),
      all(db, `SELECT realized_pnl_hny FROM futures_positions WHERE wallet=? AND status IN ('closed','liquidated')`, [wallet]),
      all(db, `SELECT total_pnl FROM trading_bots WHERE wallet=? AND status!='deleted'`, [wallet]),
      all(db, `SELECT total_pnl_hny FROM copy_subscriptions WHERE follower_wallet=?`, [wallet]),
      all(db, `SELECT lh.balance, lt.virtual_hny, lt.virtual_supply
               FROM launchpad_holdings lh JOIN launchpad_tokens lt ON lh.token_id=lt.id WHERE lh.wallet=? AND lh.balance>0`, [wallet]),
      all(db, `SELECT vd.vault_id, SUM(vd.shares_issued) as totalShares,
                      vs.total_hny, vs.total_shares as vaultTotalShares
               FROM vault_deposits vd JOIN vault_state vs ON vd.vault_id=vs.vault_id
               WHERE vd.wallet=? GROUP BY vd.vault_id`, [wallet]),
      all(db, `SELECT SUM(amount_hny) as locked FROM hny_locks WHERE wallet=? AND status='locked'`, [wallet]),
      get(db, `SELECT COUNT(*) as n FROM nfts WHERE owner_wallet=?`, [wallet]),
    ]);

    const hnyPrice = await getHnyPrice(db);
    const hnyBalance = Number(account?.balance || 0);

    // Token balances with mock USD prices (would join tokens table in prod)
    const TOKEN_PRICES = { USDC: 1.0, WBTC: 97000, WETH: 3200, SOL: 180, AVAX: 38, MATIC: 0.8, LINK: 18, UNI: 10, AAVE: 230 };
    const tokenBalances = tokenBals.map(t => {
      const priceUsd = TOKEN_PRICES[t.symbol] ?? 0;
      return { symbol: t.symbol, balance: Number(t.balance), priceUsd, valueUsd: Number(t.balance) * priceUsd };
    });

    // LP position values
    const lpPositions = lpRows.map(lp => {
      const share = lp.totalShares > 0 ? lp.lpShares / lp.totalShares : 0;
      const valueHny = share * (Number(lp.reserveA) + Number(lp.reserveB));
      return { poolId: lp.id, tokenA: lp.tokenA, tokenB: lp.tokenB, valueHny, rewardPaidHny: Number(lp.rewardPaidHny || 0) };
    });

    // Staking
    const stakingPositions = stakingRows.map(s => ({
      principal: Number(s.principal),
      rewardPaid: Number(s.rewardPaid || 0),
      apr: 5.0,
      unlockAtMs: s.unlockAtMs,
      status: s.status,
    }));

    // Vault positions
    const vaultPositions = vaultDeps.map(v => {
      const sharePrice = v.vaultTotalShares > 0 ? v.total_hny / v.vaultTotalShares : 1.0;
      const valueHny = v.totalShares * sharePrice;
      return { vaultId: v.vault_id, shares: v.totalShares, valueHny };
    });

    // Launchpad holdings value (using bonding curve price)
    let launchpadValueHny = 0;
    for (const h of launchpadHoldings) {
      if (h.virtual_supply > 0) {
        const price = h.virtual_hny / h.virtual_supply;
        launchpadValueHny += h.balance * price;
      }
    }

    const futuresUnrealizedPnlHny = futuresOpen.reduce((s, r) => s + Number(r.unrealized_pnl_hny || 0), 0);
    const futuresRealizedPnlHny   = futuresClosed.reduce((s, r) => s + Number(r.realized_pnl_hny || 0), 0);
    const botsTotalPnlHny         = bots.reduce((s, r) => s + Number(r.total_pnl || 0), 0);
    const copyTradingPnlHny       = copySubs.reduce((s, r) => s + Number(r.total_pnl_hny || 0), 0);
    const vaultValueHny           = vaultPositions.reduce((s, v) => s + v.valueHny, 0);
    const lockedHny               = Number(locks[0]?.locked || 0);
    const lpValueHny              = lpPositions.reduce((s, l) => s + l.valueHny, 0);
    const stakingValueHny         = stakingPositions.reduce((s, p) => s + p.principal, 0);

    const totalValueHny = hnyBalance + lpValueHny + stakingValueHny + vaultValueHny + launchpadValueHny + lockedHny;
    const totalValueUsd = totalValueHny * hnyPrice + tokenBalances.reduce((s, t) => s + t.valueUsd, 0);

    return res.json({
      wallet, hnyBalance, hnyPriceUsd: hnyPrice,
      tokenBalances, stakingPositions, lpPositions,
      futuresUnrealizedPnlHny, futuresRealizedPnlHny,
      botsTotalPnlHny, copyTradingPnlHny,
      launchpadValueHny, vaultValueHny, vaultPositions, lockedHny,
      nftCount: Number(nftCount?.n || 0),
      totalValueHny, totalValueUsd,
    });
  } catch (e) {
    console.error('analytics/portfolio error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /analytics/income/:wallet ────────────────────────────────────────────

router.get('/income/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db = await openDb();

    const [stakingRows, lpRows, bots, futures, copySubs, nftSales] = await Promise.all([
      all(db, `SELECT reward_paid FROM staking_positions WHERE wallet=?`, [wallet]),
      all(db, `SELECT reward_paid_hny FROM lp_positions WHERE wallet=?`, [wallet]),
      all(db, `SELECT total_pnl FROM trading_bots WHERE wallet=? AND status!='deleted'`, [wallet]),
      get(db, `SELECT SUM(realized_pnl_hny) as pnl FROM futures_positions WHERE wallet=? AND status IN ('closed','liquidated')`, [wallet]),
      all(db, `SELECT total_pnl_hny FROM copy_subscriptions WHERE follower_wallet=?`, [wallet]),
      get(db, `SELECT SUM(amount) as income FROM transactions WHERE toWallet=? AND type='nft_sale'`, [wallet]),
    ]);

    const stakingRewardsHny = stakingRows.reduce((s, r) => s + Number(r.reward_paid || 0), 0);
    const lpRewardsHny      = lpRows.reduce((s, r) => s + Number(r.reward_paid_hny || 0), 0);
    const botPnlHny         = bots.reduce((s, r) => s + Number(r.total_pnl || 0), 0);
    const futuresPnlHny     = Number(futures?.pnl || 0);
    const copyPnlHny        = copySubs.reduce((s, r) => s + Number(r.total_pnl_hny || 0), 0);
    const nftSalesHny       = Number(nftSales?.income || 0);
    const totalIncomeHny    = stakingRewardsHny + lpRewardsHny + botPnlHny + futuresPnlHny + copyPnlHny + nftSalesHny;

    const sources = [
      { source: 'Staking Rewards', amountHny: stakingRewardsHny },
      { source: 'LP Rewards',      amountHny: lpRewardsHny      },
      { source: 'Bot Trading',     amountHny: botPnlHny         },
      { source: 'Futures',         amountHny: futuresPnlHny     },
      { source: 'Copy Trading',    amountHny: copyPnlHny        },
      { source: 'NFT Sales',       amountHny: nftSalesHny       },
    ];
    const breakdown = sources.map(s => ({
      ...s, pct: totalIncomeHny !== 0 ? Math.round(s.amountHny / Math.abs(totalIncomeHny) * 100) : 0,
    }));

    return res.json({ stakingRewardsHny, lpRewardsHny, botPnlHny, futuresPnlHny, copyPnlHny, nftSalesHny, totalIncomeHny, breakdown });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /analytics/activity/:wallet ──────────────────────────────────────────

router.get('/activity/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const db     = await openDb();

    // Gather from multiple sources
    const [txns, botTrades, copyTrades, futuresClosed, obTrades] = await Promise.all([
      all(db, `SELECT timestampMs as ts, type, amount as amountHny,
                      CASE WHEN fromWallet=? THEN 'sent' ELSE 'received' END as dir,
                      CASE WHEN fromWallet=? THEN toWallet ELSE fromWallet END as counterparty
               FROM transactions WHERE (fromWallet=? OR toWallet=?) AND status='confirmed'
               ORDER BY timestampMs DESC LIMIT ?`,
        [wallet, wallet, wallet, wallet, limit]),
      all(db, `SELECT bt.traded_at as tradedAt, bt.action, bt.amount_hny as amountHny,
                      bt.price_hny as priceHny, tb.name as botName
               FROM bot_trades bt JOIN trading_bots tb ON bt.bot_id=tb.id
               WHERE tb.wallet=? ORDER BY bt.id DESC LIMIT ?`,
        [wallet, limit]),
      all(db, `SELECT executed_at_ms as ts, action, copy_amount_hny as amountHny,
                      leader_wallet as leaderWallet
               FROM copy_trades WHERE follower_wallet=? ORDER BY executed_at_ms DESC LIMIT ?`,
        [wallet, limit]),
      all(db, `SELECT closed_at as ts, side, realized_pnl_hny as pnlHny, close_price_usd as price
               FROM futures_positions WHERE wallet=? AND status IN ('closed','liquidated')
               ORDER BY closed_at DESC LIMIT ?`,
        [wallet, limit]),
      all(db, `SELECT ot.traded_at as ts, ot.price_hny as priceHny, ot.size_hny as amountHny,
                      lo.side, ot.pair
               FROM orderbook_trades ot
               JOIN limit_orders lo ON (ot.buy_order_id=lo.id OR ot.sell_order_id=lo.id)
               WHERE lo.wallet=? ORDER BY ot.traded_at DESC LIMIT ?`,
        [wallet, limit]),
    ]);

    const feed = [
      ...txns.map(r => ({
        ts: r.ts,
        type: r.type,
        label: `${r.type.replace(/_/g,' ')} ${r.dir === 'sent' ? '→' : '←'} ${r.counterparty?.slice(0,10)}`,
        amountHny: Number(r.amountHny || 0),
        detail: r.dir,
      })),
      ...botTrades.map(r => ({
        ts: new Date(r.tradedAt).getTime(),
        type: 'bot_trade',
        label: `🤖 ${r.botName}: ${r.action}`,
        amountHny: Number(r.amountHny || 0),
        detail: `@ $${Number(r.priceHny || 0).toFixed(4)}`,
      })),
      ...copyTrades.map(r => ({
        ts: r.ts,
        type: 'copy_trade',
        label: `📋 Copy trade from ${r.leaderWallet?.slice(0,10)}`,
        amountHny: Number(r.amountHny || 0),
        detail: r.action,
      })),
      ...futuresClosed.map(r => ({
        ts: typeof r.ts === 'string' ? new Date(r.ts).getTime() : r.ts,
        type: 'futures_closed',
        label: `📈 Futures ${r.side} closed`,
        amountHny: Number(r.pnlHny || 0),
        detail: `@ $${Number(r.price || 0).toFixed(2)}`,
      })),
      ...obTrades.map(r => ({
        ts: typeof r.ts === 'string' ? new Date(r.ts).getTime() : r.ts,
        type: 'orderbook_fill',
        label: `📒 ${r.pair} ${r.side} fill`,
        amountHny: Number(r.amountHny || 0),
        detail: `@ ${Number(r.priceHny || 0).toFixed(4)} HNY`,
      })),
    ]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);

    return res.json({ wallet, activity: feed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /analytics/stats/:wallet ─────────────────────────────────────────────

router.get('/stats/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db     = await openDb();

    const [memberRow, txStats, botStats, botWin, futuresStats, daoVotes, nftStats, activeBots, openFutures] = await Promise.all([
      get(db, `SELECT MIN(timestampMs) as firstTs FROM transactions WHERE fromWallet=? OR toWallet=?`, [wallet, wallet]),
      get(db, `SELECT COUNT(*) as cnt, SUM(amount) as vol, SUM(gasFee+serviceFee) as fees
               FROM transactions WHERE fromWallet=? AND status='confirmed'`, [wallet]),
      get(db, `SELECT SUM(total_pnl) as totalPnl FROM trading_bots WHERE wallet=? AND status!='deleted'`, [wallet]),
      all(db, `SELECT bt.amount_hny, bt.action FROM bot_trades bt
               JOIN trading_bots tb ON bt.bot_id=tb.id WHERE tb.wallet=?`, [wallet]),
      get(db, `SELECT MAX(realized_pnl_hny) as best, MIN(realized_pnl_hny) as worst
               FROM futures_positions WHERE wallet=? AND status IN ('closed','liquidated')`, [wallet]),
      get(db, `SELECT COUNT(*) as cnt FROM dao_votes WHERE voter_wallet=?`, [wallet]),
      get(db, `SELECT COUNT(*) as minted, SUM(CASE WHEN transfer_count>0 THEN 1 ELSE 0 END) as sold
               FROM nfts WHERE creator_wallet=?`, [wallet]),
      get(db, `SELECT COUNT(*) as cnt FROM trading_bots WHERE wallet=? AND status='active'`, [wallet]),
      get(db, `SELECT COUNT(*) as cnt FROM futures_positions WHERE wallet=? AND status='open'`, [wallet]),
    ]);

    const wins = botWin.filter(t => t.amount_hny > 0).length;
    const botWinRate = botWin.length > 0 ? Math.round(wins / botWin.length * 100) : 0;

    return res.json({
      memberSinceMs: memberRow?.firstTs || null,
      totalTxCount: Number(txStats?.cnt || 0),
      totalVolumeHny: Number(txStats?.vol || 0),
      totalFeesPaidHny: Number(txStats?.fees || 0),
      bestTradeHny: Number(futuresStats?.best || 0),
      worstTradeHny: Number(futuresStats?.worst || 0),
      botWinRate,
      activeBots: Number(activeBots?.cnt || 0),
      openFuturesPositions: Number(openFutures?.cnt || 0),
      daoVotesCast: Number(daoVotes?.cnt || 0),
      nftsMinted: Number(nftStats?.minted || 0),
      nftsSold: Number(nftStats?.sold || 0),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /analytics/history/:wallet ───────────────────────────────────────────

router.get('/history/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const days   = Math.min(Number(req.query.days) || 30, 365);
    const db     = await openDb();

    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const rows = await all(db,
      `SELECT snapshot_ms as snapshotMs, net_worth_hny as netWorthHny
       FROM portfolio_snapshots WHERE wallet=? AND snapshot_ms >= ? ORDER BY snapshot_ms ASC`,
      [wallet, cutoff]);

    return res.json({ wallet, days, history: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Background: snapshotPortfolios() ─────────────────────────────────────────

async function snapshotPortfolios() {
  try {
    const db = await openDb();
    // Only snapshot wallets active in last 24h
    const activeWallets = await all(db,
      `SELECT DISTINCT fromWallet as wallet FROM transactions
       WHERE timestampMs > ? AND status='confirmed'
       UNION
       SELECT DISTINCT toWallet FROM transactions WHERE timestampMs > ? AND status='confirmed'`,
      [Date.now() - 86400_000, Date.now() - 86400_000]);

    const hnyPrice = await getHnyPrice(db);
    const snapshotMs = Math.floor(Date.now() / 3600_000) * 3600_000; // round to hour

    for (const { wallet } of activeWallets) {
      if (!wallet || wallet.startsWith('HNY_') && wallet.includes('VAULT')) continue;
      try {
        const account = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
        const hnyBalance = Number(account?.balance || 0);
        // Simplified snapshot — just HNY balance for sparkline
        await run(db,
          `INSERT OR REPLACE INTO portfolio_snapshots(wallet, snapshot_ms, net_worth_hny, breakdown_json)
           VALUES (?,?,?,?)`,
          [wallet, snapshotMs, hnyBalance, JSON.stringify({ hny: hnyBalance })]);
      } catch { /* skip individual wallet errors */ }
    }
    console.log(`📊 Portfolio snapshots written for ${activeWallets.length} wallets`);
  } catch (e) {
    console.error('snapshotPortfolios error:', e);
  }
}

module.exports = { router, snapshotPortfolios };
