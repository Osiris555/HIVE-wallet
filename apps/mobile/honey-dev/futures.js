// apps/mobile/honey-dev/futures.js
// Perpetual Futures router — Phase H3
// Markets, positions, open/close, history, funding rates
"use strict";

const express = require("express");
const crypto  = require("crypto");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

/* ───────────────────────────────────────────────────────────
   CONSTANTS
─────────────────────────────────────────────────────────── */
const MAINTENANCE_MARGIN_RATE = 0.025;   // 2.5% MMR
const TAKER_FEE_RATE          = 0.0006;  // 0.06%
const MAKER_FEE_RATE          = 0.0002;  // 0.02%
const FUNDING_RATE_8H         = 0.0001;  // 0.01% per 8-hour period
const FUTURES_FEE_VAULT       = "HNY_FUTURES_FEE_VAULT";
const HNY_PRICE_USD           = 1.00;    // matches server.js constant

/* ───────────────────────────────────────────────────────────
   HELPERS
─────────────────────────────────────────────────────────── */

/** Get the current USD price for a token symbol from the DB */
async function getTokenPriceUsd(db, symbol) {
  if (symbol === "USD") return 1.0;
  const row = await get(db,
    `SELECT mockPriceUSD FROM tokens WHERE symbol=? LIMIT 1`,
    [symbol]
  );
  return Number(row?.mockPriceUSD || 0) || 1.0;
}

/** Calculate liquidation price */
function calcLiqPrice(side, entryPrice, leverage) {
  if (side === "long") {
    return entryPrice * (1 - (1 - MAINTENANCE_MARGIN_RATE) / leverage);
  } else {
    return entryPrice * (1 + (1 - MAINTENANCE_MARGIN_RATE) / leverage);
  }
}

/** Calculate unrealized PnL in HNY */
function calcPnlHny(side, entryPrice, markPrice, sizeUsd, hnyPriceUsd) {
  const priceDelta = side === "long"
    ? markPrice - entryPrice
    : entryPrice - markPrice;
  return (priceDelta / entryPrice) * sizeUsd / hnyPriceUsd;
}

/** Check if a position should be liquidated */
function isLiquidated(side, markPrice, liqPrice) {
  if (side === "long")  return markPrice <= liqPrice;
  if (side === "short") return markPrice >= liqPrice;
  return false;
}

/** Verify ML-DSA-65 signature (ESM dynamic import, same as server.js) */
async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  if (!mldsaPubKeyHex) return { ok: false, error: "Wallet not registered (missing ML-DSA-65 public key)" };
  if (!signatureHex)   return { ok: false, error: "Missing signatureHex" };
  try {
    const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa");
    const pubKey   = Buffer.from(mldsaPubKeyHex, "hex");
    const sig      = Buffer.from(signatureHex,   "hex");
    const msgBytes = Buffer.from(message, "utf8");
    const ok = ml_dsa65.verify(pubKey, msgBytes, sig);
    if (!ok) return { ok: false, error: "Invalid ML-DSA-65 signature" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `ML-DSA-65 verify error: ${e.message}` };
  }
}

/** Ensure the futures fee vault account exists */
async function ensureFuturesVault(db) {
  const exists = await get(db, `SELECT wallet FROM accounts WHERE wallet=?`, [FUTURES_FEE_VAULT]);
  if (!exists) {
    await run(db,
      `INSERT OR IGNORE INTO accounts (wallet, publicKeyB64, balance, nonce, lastMintMs, createdAtMs) VALUES (?,?,0,0,0,?)`,
      [FUTURES_FEE_VAULT, "", Date.now()]
    );
  }
}

/* ───────────────────────────────────────────────────────────
   GET /futures/markets
   Returns all active markets with live price + open interest
─────────────────────────────────────────────────────────── */
router.get("/markets", async (req, res) => {
  const db = openDb();
  try {
    const markets = await all(db, `SELECT * FROM futures_markets WHERE is_active=1 ORDER BY id`);

    const result = await Promise.all(markets.map(async (m) => {
      const markPrice = await getTokenPriceUsd(db, m.base_symbol);

      // Open interest = sum of size_usd for open positions in this market
      const oiLong  = await get(db,
        `SELECT COALESCE(SUM(size_usd),0) as oi FROM futures_positions WHERE market_id=? AND side='long'  AND status='open'`,
        [m.id]
      );
      const oiShort = await get(db,
        `SELECT COALESCE(SUM(size_usd),0) as oi FROM futures_positions WHERE market_id=? AND side='short' AND status='open'`,
        [m.id]
      );

      // Latest funding rate
      const latestFunding = await get(db,
        `SELECT funding_rate FROM futures_funding_history WHERE market_id=? ORDER BY applied_at DESC LIMIT 1`,
        [m.id]
      );

      return {
        id:                     m.id,
        baseSymbol:             m.base_symbol,
        quoteSymbol:            m.quote_symbol,
        markPriceUsd:           markPrice,
        maxLeverage:            m.max_leverage,
        minSizeUsd:             m.min_size_usd,
        makerFeeRate:           m.maker_fee_rate,
        takerFeeRate:           m.taker_fee_rate,
        maintenanceMarginRate:  m.maintenance_margin_rate,
        openInterestLongUsd:    Number(oiLong?.oi  || 0),
        openInterestShortUsd:   Number(oiShort?.oi || 0),
        fundingRate8h:          Number(latestFunding?.funding_rate || FUNDING_RATE_8H),
      };
    }));

    res.json({ markets: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   GET /futures/positions/:wallet
   Returns all open positions for a wallet with live PnL
─────────────────────────────────────────────────────────── */
router.get("/positions/:wallet", async (req, res) => {
  const db = openDb();
  try {
    const { wallet } = req.params;
    const positions = await all(db,
      `SELECT * FROM futures_positions WHERE wallet=? AND status='open' ORDER BY opened_at DESC`,
      [wallet]
    );

    const hnyPrice = await getTokenPriceUsd(db, "HNY");

    const result = await Promise.all(positions.map(async (p) => {
      const market    = await get(db, `SELECT base_symbol FROM futures_markets WHERE id=?`, [p.market_id]);
      const markPrice = await getTokenPriceUsd(db, market?.base_symbol || "HNY");
      const pnl       = calcPnlHny(p.side, p.entry_price_usd, markPrice, p.size_usd, hnyPrice);
      const liqPrice  = Number(p.liquidation_price_usd);
      const liquidated = isLiquidated(p.side, markPrice, liqPrice);

      return {
        id:                  p.id,
        marketId:            p.market_id,
        baseSymbol:          market?.base_symbol || "",
        side:                p.side,
        sizeUsd:             p.size_usd,
        collateralHny:       p.collateral_hny,
        leverage:            p.leverage,
        entryPriceUsd:       p.entry_price_usd,
        markPriceUsd:        markPrice,
        liquidationPriceUsd: liqPrice,
        unrealizedPnlHny:    Number(pnl.toFixed(8)),
        fundingPaidHny:      p.funding_paid_hny,
        status:              liquidated ? "liquidated_pending" : p.status,
        openedAt:            p.opened_at,
      };
    }));

    res.json({ positions: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   GET /futures/history/:wallet
   Returns closed/liquidated position history for a wallet
─────────────────────────────────────────────────────────── */
router.get("/history/:wallet", async (req, res) => {
  const db = openDb();
  try {
    const { wallet } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const positions = await all(db,
      `SELECT p.*, m.base_symbol FROM futures_positions p
       LEFT JOIN futures_markets m ON m.id=p.market_id
       WHERE p.wallet=? AND p.status IN ('closed','liquidated')
       ORDER BY p.closed_at DESC LIMIT ?`,
      [wallet, limit]
    );

    res.json({
      history: positions.map((p) => ({
        id:               p.id,
        marketId:         p.market_id,
        baseSymbol:       p.base_symbol || "",
        side:             p.side,
        sizeUsd:          p.size_usd,
        collateralHny:    p.collateral_hny,
        leverage:         p.leverage,
        entryPriceUsd:    p.entry_price_usd,
        closePriceUsd:    p.close_price_usd,
        realizedPnlHny:   p.realized_pnl_hny,
        fundingPaidHny:   p.funding_paid_hny,
        status:           p.status,
        openedAt:         p.opened_at,
        closedAt:         p.closed_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   GET /futures/funding/:market_id
   Returns recent funding rate history for a market
─────────────────────────────────────────────────────────── */
router.get("/funding/:market_id", async (req, res) => {
  const db = openDb();
  try {
    const rows = await all(db,
      `SELECT * FROM futures_funding_history WHERE market_id=? ORDER BY applied_at DESC LIMIT 48`,
      [req.params.market_id]
    );
    res.json({ funding: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   GET /futures/stats
   Returns aggregate stats across all markets
─────────────────────────────────────────────────────────── */
router.get("/stats", async (req, res) => {
  const db = openDb();
  try {
    const totalPositions  = await get(db, `SELECT COUNT(*) as n FROM futures_positions WHERE status='open'`);
    const totalOi         = await get(db, `SELECT COALESCE(SUM(size_usd),0) as oi FROM futures_positions WHERE status='open'`);
    const totalCollateral = await get(db, `SELECT COALESCE(SUM(collateral_hny),0) as c FROM futures_positions WHERE status='open'`);
    const totalVolume     = await get(db, `SELECT COALESCE(SUM(size_usd),0) as v FROM futures_positions`);
    const totalLiquidations = await get(db, `SELECT COUNT(*) as n FROM futures_positions WHERE status='liquidated'`);
    res.json({
      openPositions:       Number(totalPositions?.n || 0),
      totalOpenInterestUsd: Number(totalOi?.oi || 0),
      totalCollateralHny:  Number(totalCollateral?.c || 0),
      totalVolumeUsd:      Number(totalVolume?.v || 0),
      totalLiquidations:   Number(totalLiquidations?.n || 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   POST /futures/open
   Open a new perpetual futures position

   Body:
     wallet, marketId, side ('long'|'short'), sizeUsd,
     leverage, signatureHex
─────────────────────────────────────────────────────────── */
router.post("/open", async (req, res) => {
  const db = openDb();
  try {
    await ensureFuturesVault(db);

    const { wallet, marketId, side, sizeUsd, leverage, signatureHex } = req.body;

    // ── Validate inputs ──────────────────────────────────────
    if (!wallet || !marketId || !side || !sizeUsd || !leverage) {
      return res.status(400).json({ error: "Missing required fields: wallet, marketId, side, sizeUsd, leverage" });
    }
    if (!["long", "short"].includes(side)) {
      return res.status(400).json({ error: "side must be 'long' or 'short'" });
    }

    // ── Fetch market ──────────────────────────────────────────
    const market = await get(db, `SELECT * FROM futures_markets WHERE id=? AND is_active=1`, [marketId]);
    if (!market) return res.status(404).json({ error: "Market not found or inactive" });

    const lev = Number(leverage);
    if (lev < 1 || lev > market.max_leverage) {
      return res.status(400).json({ error: `Leverage must be 1–${market.max_leverage}x` });
    }
    if (Number(sizeUsd) < market.min_size_usd) {
      return res.status(400).json({ error: `Minimum position size is $${market.min_size_usd}` });
    }

    // ── Fetch account + verify signature ─────────────────────
    const account = await get(db, `SELECT * FROM accounts WHERE wallet=?`, [wallet]);
    if (!account) return res.status(404).json({ error: "Wallet not found" });

    const message = `futures_open:${wallet}:${marketId}:${side}:${sizeUsd}:${leverage}`;
    const sigResult = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key,
      message,
      signatureHex,
    });
    if (!sigResult.ok) return res.status(403).json({ error: sigResult.error });

    // ── Calculate collateral and fees ─────────────────────────
    const hnyPriceUsd  = await getTokenPriceUsd(db, "HNY");
    const markPriceUsd = await getTokenPriceUsd(db, market.base_symbol);

    const size        = Number(sizeUsd);
    const collateralUsd = size / lev;
    const feeUsd        = size * TAKER_FEE_RATE;
    const totalUsd      = collateralUsd + feeUsd;
    const totalHny      = totalUsd / hnyPriceUsd;

    if (Number(account.balance) < totalHny) {
      return res.status(400).json({
        error: `Insufficient balance. Need ${totalHny.toFixed(4)} HNY, have ${Number(account.balance).toFixed(4)} HNY`,
      });
    }

    // ── Deduct collateral + fee ───────────────────────────────
    const collateralHny = collateralUsd / hnyPriceUsd;
    const feeHny        = feeUsd / hnyPriceUsd;
    await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [totalHny, wallet]);
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [feeHny, FUTURES_FEE_VAULT]);

    // ── Create position ───────────────────────────────────────
    const posId  = crypto.randomUUID();
    const liqPx  = calcLiqPrice(side, markPriceUsd, lev);

    await run(db,
      `INSERT INTO futures_positions
         (id, wallet, market_id, side, size_usd, collateral_hny, leverage,
          entry_price_usd, mark_price_usd, liquidation_price_usd,
          unrealized_pnl_hny, funding_paid_hny, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,0,'open')`,
      [posId, wallet, marketId, side, size, collateralHny, lev, markPriceUsd, markPriceUsd, liqPx]
    );

    res.json({
      ok:                  true,
      positionId:          posId,
      marketId,
      side,
      sizeUsd:             size,
      collateralHny:       Number(collateralHny.toFixed(8)),
      feeHny:              Number(feeHny.toFixed(8)),
      entryPriceUsd:       markPriceUsd,
      liquidationPriceUsd: Number(liqPx.toFixed(4)),
      leverage:            lev,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   POST /futures/close
   Close an open position and realize PnL

   Body: wallet, positionId, signatureHex
─────────────────────────────────────────────────────────── */
router.post("/close", async (req, res) => {
  const db = openDb();
  try {
    const { wallet, positionId, signatureHex } = req.body;
    if (!wallet || !positionId) {
      return res.status(400).json({ error: "Missing wallet or positionId" });
    }

    // ── Fetch position ────────────────────────────────────────
    const pos = await get(db,
      `SELECT * FROM futures_positions WHERE id=? AND wallet=? AND status='open'`,
      [positionId, wallet]
    );
    if (!pos) return res.status(404).json({ error: "Open position not found" });

    // ── Verify signature ──────────────────────────────────────
    const account = await get(db, `SELECT * FROM accounts WHERE wallet=?`, [wallet]);
    if (!account) return res.status(404).json({ error: "Wallet not found" });

    const message = `futures_close:${wallet}:${positionId}`;
    const sigResult = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key,
      message,
      signatureHex,
    });
    if (!sigResult.ok) return res.status(403).json({ error: sigResult.error });

    // ── Calculate PnL ─────────────────────────────────────────
    const market     = await get(db, `SELECT base_symbol FROM futures_markets WHERE id=?`, [pos.market_id]);
    const hnyPrice   = await getTokenPriceUsd(db, "HNY");
    const markPrice  = await getTokenPriceUsd(db, market?.base_symbol || "HNY");

    const pnlHny     = calcPnlHny(pos.side, pos.entry_price_usd, markPrice, pos.size_usd, hnyPrice);
    const closeFee   = (pos.size_usd * TAKER_FEE_RATE) / hnyPrice;
    const payout     = pos.collateral_hny + pnlHny - closeFee - pos.funding_paid_hny;
    const actualPayout = Math.max(0, payout); // can't return more than exists

    // ── Update position record ────────────────────────────────
    await run(db,
      `UPDATE futures_positions
       SET status='closed', close_price_usd=?, realized_pnl_hny=?,
           mark_price_usd=?, closed_at=datetime('now')
       WHERE id=?`,
      [markPrice, pnlHny, markPrice, positionId]
    );

    // ── Return payout to wallet ───────────────────────────────
    if (actualPayout > 0) {
      await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [actualPayout, wallet]);
    }

    // ── Fee to vault ──────────────────────────────────────────
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [closeFee, FUTURES_FEE_VAULT]);

    res.json({
      ok:             true,
      positionId,
      closePriceUsd:  markPrice,
      realizedPnlHny: Number(pnlHny.toFixed(8)),
      closeFeeHny:    Number(closeFee.toFixed(8)),
      payoutHny:      Number(actualPayout.toFixed(8)),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   BACKGROUND JOBS (exported for use in server.js)
─────────────────────────────────────────────────────────── */

/**
 * checkLiquidations — runs every 30 seconds.
 * Finds open positions where mark price crossed liquidation price.
 * Seizes collateral to fee vault and marks position as liquidated.
 */
async function checkLiquidations() {
  const db = openDb();
  try {
    await ensureFuturesVault(db);
    const positions = await all(db,
      `SELECT p.*, m.base_symbol FROM futures_positions p
       LEFT JOIN futures_markets m ON m.id=p.market_id
       WHERE p.status='open'`
    );

    for (const p of positions) {
      const markPrice = await getTokenPriceUsd(db, p.base_symbol || "HNY");
      const liqPrice  = Number(p.liquidation_price_usd);

      if (isLiquidated(p.side, markPrice, liqPrice)) {
        // Seize all remaining collateral
        const seized = Number(p.collateral_hny);
        await run(db,
          `UPDATE futures_positions
           SET status='liquidated', close_price_usd=?, mark_price_usd=?,
               realized_pnl_hny=?, closed_at=datetime('now')
           WHERE id=?`,
          [markPrice, markPrice, -seized, p.id]
        );
        if (seized > 0) {
          await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [seized, FUTURES_FEE_VAULT]);
        }
        console.log(`⚡ Liquidated position ${p.id} (${p.side} ${p.base_symbol} @ ${markPrice}, liq=${liqPrice})`);
      }
    }
  } catch (e) {
    console.error("checkLiquidations error:", e.message);
  } finally {
    db.close();
  }
}

/**
 * applyFunding — runs every 8 hours (28800000ms).
 * Applies funding payments to all open positions and records history.
 * Longs pay shorts when funding rate > 0 (typical in bullish markets).
 */
async function applyFunding() {
  const db = openDb();
  try {
    const markets = await all(db, `SELECT * FROM futures_markets WHERE is_active=1`);

    for (const market of markets) {
      const markPrice   = await getTokenPriceUsd(db, market.base_symbol);
      const fundingRate = FUNDING_RATE_8H; // fixed for devnet; mainnet uses TWAP-based calculation
      const hnyPrice    = await getTokenPriceUsd(db, "HNY");

      // Record funding rate
      await run(db,
        `INSERT INTO futures_funding_history (market_id, funding_rate, mark_price_usd) VALUES (?,?,?)`,
        [market.id, fundingRate, markPrice]
      );

      // Apply to open positions in this market
      const positions = await all(db,
        `SELECT * FROM futures_positions WHERE market_id=? AND status='open'`,
        [market.id]
      );

      for (const p of positions) {
        // Funding = sizeUsd * fundingRate / hnyPrice
        const fundingHny = (p.size_usd * fundingRate) / hnyPrice;
        // Longs pay, shorts receive
        const walletDelta = p.side === "long" ? -fundingHny : +fundingHny;

        await run(db,
          `UPDATE futures_positions SET funding_paid_hny=funding_paid_hny+?, collateral_hny=collateral_hny+? WHERE id=?`,
          [p.side === "long" ? fundingHny : -fundingHny, walletDelta, p.id]
        );
        // Adjust wallet balance accordingly
        if (Number.isFinite(walletDelta)) {
          await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [walletDelta, p.wallet]);
        }
      }
    }
    console.log(`💸 Funding applied to ${markets.length} futures markets`);
  } catch (e) {
    console.error("applyFunding error:", e.message);
  } finally {
    db.close();
  }
}

module.exports = { router, checkLiquidations, applyFunding, FUTURES_FEE_VAULT };
