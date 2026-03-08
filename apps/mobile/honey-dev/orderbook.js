// ── Order Book Router ─────────────────────────────────────────
// Limit order matching engine for the Honey Network DEX.
// Pairs: any two tokens that have a pool (e.g. HNY/USDC, BTC/HNY, etc.)
// Orders live in the `limit_orders` table; the matching engine runs after
// every new order is placed and after every block (triggered from server.js).

const express = require("express");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

// ── Constants ────────────────────────────────────────────────
const ORDERBOOK_FEE_VAULT = "HNY_ORDERBOOK_FEE_VAULT";
const MAKER_FEE_RATE = 0.001;  // 0.1% maker
const TAKER_FEE_RATE = 0.002;  // 0.2% taker

// ── Signature verification (same as server.js) ───────────────
let _mlDsa65;
async function getMlDsa() {
  if (!_mlDsa65) {
    const mod = await import("@noble/post-quantum/ml-dsa");
    _mlDsa65 = mod.ml_dsa65;
  }
  return _mlDsa65;
}

async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  const mlDsa = await getMlDsa();
  const pubKey = Buffer.from(mldsaPubKeyHex, "hex");
  const sig    = Buffer.from(signatureHex, "hex");
  const msg    = Buffer.from(message, "utf8");
  return mlDsa.verify(pubKey, msg, sig);
}

// ── Helper: get token price in HNY ──────────────────────────
async function getHnyPriceFor(db, symbol) {
  if (symbol === "HNY") return 1;
  const tok = await get(db, `SELECT mockPriceUSD FROM tokens WHERE symbol=?`, [symbol]);
  const hny = await get(db, `SELECT mockPriceUSD FROM tokens WHERE symbol='HNY'`);
  if (!tok || !hny || !Number(hny.mockPriceUSD)) return null;
  return Number(tok.mockPriceUSD) / Number(hny.mockPriceUSD);
}

// ── Matching Engine ──────────────────────────────────────────
// Tries to match a newly placed order against resting orders on the book.
// Uses price-time priority: best price first, then oldest first.
async function matchOrder(db, newOrder) {
  const oppSide = newOrder.side === "buy" ? "sell" : "buy";
  const priceFilter = newOrder.side === "buy"
    ? `price <= ${newOrder.price_hny}`   // buy: match sells at or below limit price
    : `price >= ${newOrder.price_hny}`;  // sell: match buys at or above limit price
  const priceSort = newOrder.side === "buy" ? "ASC" : "DESC"; // best price first

  const restingOrders = await all(db,
    `SELECT * FROM limit_orders
     WHERE pair=? AND side=? AND status='open' AND ${priceFilter}
     ORDER BY price ${priceSort}, created_at ASC`,
    [newOrder.pair, oppSide]
  );

  let remaining = newOrder.size_hny - newOrder.filled_hny;

  for (const resting of restingOrders) {
    if (remaining <= 0) break;
    const restingRemaining = resting.size_hny - resting.filled_hny;
    const fillAmt = Math.min(remaining, restingRemaining);
    const fillPrice = resting.price_hny; // maker sets the price

    // Fee collection
    const makerFee = fillAmt * MAKER_FEE_RATE;
    const takerFee = fillAmt * TAKER_FEE_RATE;

    // Credit taker (newOrder wallet): receives base token
    const takerReceives = fillAmt - takerFee;
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [takerReceives, newOrder.wallet]);

    // Credit maker (resting wallet): receives quote token
    const makerQuoteReceived = fillAmt * fillPrice - makerFee;
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [makerQuoteReceived, resting.wallet]);

    // Fees to vault
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [makerFee + takerFee, ORDERBOOK_FEE_VAULT]);

    // Update resting order
    const restingFilled = resting.filled_hny + fillAmt;
    const restingStatus = restingFilled >= resting.size_hny - 0.000001 ? "filled" : "open";
    await run(db,
      `UPDATE limit_orders SET filled_hny=?, status=?, updated_at=datetime('now') WHERE id=?`,
      [restingFilled, restingStatus, resting.id]
    );

    // Log the trade
    await run(db,
      `INSERT INTO orderbook_trades (pair, buy_order_id, sell_order_id, price_hny, size_hny, traded_at)
       VALUES (?,?,?,?,?,datetime('now'))`,
      [
        newOrder.pair,
        newOrder.side === "buy" ? newOrder.id : resting.id,
        newOrder.side === "sell" ? newOrder.id : resting.id,
        fillPrice,
        fillAmt,
      ]
    );

    remaining -= fillAmt;
  }

  // Update new order fill amount
  const totalFilled = newOrder.size_hny - remaining;
  const newStatus = remaining <= 0.000001 ? "filled" : "open";
  await run(db,
    `UPDATE limit_orders SET filled_hny=?, status=?, updated_at=datetime('now') WHERE id=?`,
    [totalFilled, newStatus, newOrder.id]
  );
}

// ── POST /orderbook/place ────────────────────────────────────
// Place a limit order. Locks funds immediately.
// Body: { wallet, pair, side, price_hny, size_hny, mldsaPubKeyHex, signatureHex }
router.post("/place", async (req, res) => {
  const { wallet, pair, side, price_hny, size_hny, mldsaPubKeyHex, signatureHex } = req.body;
  if (!wallet || !pair || !["buy","sell"].includes(side) || !price_hny || !size_hny) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (size_hny <= 0 || price_hny <= 0) {
    return res.status(400).json({ error: "Price and size must be positive" });
  }

  const db = openDb();
  try {
    // Verify ML-DSA signature
    const message = `orderbook_place:${wallet}:${pair}:${side}:${price_hny}:${size_hny}`;
    const acct = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!acct?.mldsa_public_key) return res.status(403).json({ error: "Wallet not registered" });
    const pubKey = mldsaPubKeyHex || acct.mldsa_public_key;
    if (signatureHex) {
      const valid = await verifyMLDSASignature({ mldsaPubKeyHex: pubKey, message, signatureHex });
      if (!valid) return res.status(403).json({ error: "Invalid signature" });
    }

    // Lock funds from wallet balance
    // For a buy order: lock size_hny * price_hny worth of quote token (HNY)
    // For a sell order: lock size_hny of base token (HNY equivalent)
    const lockAmount = side === "buy" ? size_hny * price_hny : size_hny;
    const bal = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
    if (!bal || Number(bal.balance) < lockAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [lockAmount, wallet]);

    const id = `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await run(db,
      `INSERT INTO limit_orders (id, wallet, pair, side, price_hny, size_hny, filled_hny, locked_hny, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,0,?,  'open', datetime('now'), datetime('now'))`,
      [id, wallet, pair, side, price_hny, size_hny, lockAmount]
    );

    // Run matching engine
    const order = await get(db, `SELECT * FROM limit_orders WHERE id=?`, [id]);
    await matchOrder(db, order);

    const updated = await get(db, `SELECT * FROM limit_orders WHERE id=?`, [id]);
    res.json({ ok: true, order: updated });
  } catch (e) {
    console.error("orderbook/place error:", e);
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── POST /orderbook/cancel ───────────────────────────────────
// Cancel an open order and refund locked funds.
router.post("/cancel", async (req, res) => {
  const { wallet, orderId } = req.body;
  if (!wallet || !orderId) return res.status(400).json({ error: "Missing wallet or orderId" });

  const db = openDb();
  try {
    const order = await get(db, `SELECT * FROM limit_orders WHERE id=? AND wallet=?`, [orderId, wallet]);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "open") return res.status(400).json({ error: "Order is not open" });

    // Refund remaining locked funds
    const refund = order.locked_hny - (order.filled_hny * (order.side === "buy" ? order.price_hny : 1));
    const safeRefund = Math.max(0, refund);
    if (safeRefund > 0) {
      await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [safeRefund, wallet]);
    }
    await run(db,
      `UPDATE limit_orders SET status='cancelled', updated_at=datetime('now') WHERE id=?`,
      [orderId]
    );
    res.json({ ok: true, refunded: safeRefund });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /orderbook/book/:pair ────────────────────────────────
// Returns the current bids and asks for a pair, aggregated by price level.
router.get("/book/:pair", async (req, res) => {
  const { pair } = req.params;
  const db = openDb();
  try {
    const bids = await all(db,
      `SELECT price_hny, SUM(size_hny - filled_hny) as total_hny, COUNT(*) as count
       FROM limit_orders WHERE pair=? AND side='buy' AND status='open'
       GROUP BY price_hny ORDER BY price_hny DESC LIMIT 20`,
      [pair]
    );
    const asks = await all(db,
      `SELECT price_hny, SUM(size_hny - filled_hny) as total_hny, COUNT(*) as count
       FROM limit_orders WHERE pair=? AND side='sell' AND status='open'
       GROUP BY price_hny ORDER BY price_hny ASC LIMIT 20`,
      [pair]
    );
    const lastTrade = await get(db,
      `SELECT price_hny, size_hny, traded_at FROM orderbook_trades WHERE pair=? ORDER BY traded_at DESC LIMIT 1`,
      [pair]
    );
    res.json({ pair, bids, asks, lastTrade: lastTrade || null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /orderbook/orders/:wallet ───────────────────────────
// All open orders for a wallet (optionally filter by pair).
router.get("/orders/:wallet", async (req, res) => {
  const { wallet } = req.params;
  const { pair } = req.query;
  const db = openDb();
  try {
    const pairFilter = pair ? `AND pair=?` : "";
    const params = pair ? [wallet, pair] : [wallet];
    const orders = await all(db,
      `SELECT * FROM limit_orders WHERE wallet=? ${pairFilter} AND status='open'
       ORDER BY created_at DESC LIMIT 100`,
      params
    );
    res.json({ orders });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /orderbook/history/:wallet ───────────────────────────
// Filled and cancelled orders for a wallet.
router.get("/history/:wallet", async (req, res) => {
  const { wallet } = req.params;
  const db = openDb();
  try {
    const orders = await all(db,
      `SELECT * FROM limit_orders WHERE wallet=? AND status IN ('filled','cancelled')
       ORDER BY updated_at DESC LIMIT 100`,
      [wallet]
    );
    res.json({ orders });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /orderbook/trades/:pair ──────────────────────────────
// Recent filled trades for a pair.
router.get("/trades/:pair", async (req, res) => {
  const { pair } = req.params;
  const db = openDb();
  try {
    const trades = await all(db,
      `SELECT * FROM orderbook_trades WHERE pair=? ORDER BY traded_at DESC LIMIT 50`,
      [pair]
    );
    res.json({ trades });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /orderbook/pairs ─────────────────────────────────────
// Returns all tradeable pairs (derived from AMM pools).
router.get("/pairs", async (req, res) => {
  const db = openDb();
  try {
    const pools = await all(db, `SELECT token_a, token_b FROM liquidity_pools`);
    const pairs = pools.map(p => `${p.token_a}/${p.token_b}`);
    res.json({ pairs });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /orderbook/stats ─────────────────────────────────────
router.get("/stats", async (req, res) => {
  const db = openDb();
  try {
    const openOrders   = await get(db, `SELECT COUNT(*) as n FROM limit_orders WHERE status='open'`);
    const totalFills   = await get(db, `SELECT COUNT(*) as n FROM orderbook_trades`);
    const volumeHny    = await get(db, `SELECT SUM(size_hny) as v FROM orderbook_trades`);
    const uniqueTraders = await get(db, `SELECT COUNT(DISTINCT wallet) as n FROM limit_orders`);
    res.json({
      openOrders:    Number(openOrders?.n  || 0),
      totalFills:    Number(totalFills?.n  || 0),
      volumeHny:     Number(volumeHny?.v   || 0),
      uniqueTraders: Number(uniqueTraders?.n || 0),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

module.exports = { router, ORDERBOOK_FEE_VAULT };
