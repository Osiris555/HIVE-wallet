// ── Trading Bots Router ──────────────────────────────────────
// Queen Bee AI-powered automated trading bots for the Honey Network.
//
// Bot types:
//   dca      — Dollar Cost Average: buy a fixed HNY amount every N minutes
//   grid     — Grid Bot: place a ladder of buy/sell orders in a price range
//   momentum — Momentum: buy on uptrend, sell on downtrend (% threshold)
//   stoptp   — Stop Loss / Take Profit: sell when price hits target or stop
//   futures_grid — Grid bot on perpetual futures (long/short grid)

const express = require("express");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

const BOTS_FEE_VAULT  = "HNY_BOTS_FEE_VAULT";
const BOT_FEE_RATE    = 0.003;   // 0.3% per automated trade
const BOT_CHECK_MS    = 60_000;  // run bot engine every 60 seconds

// ── Bot Config Schemas ────────────────────────────────────────
// Each type has a JSON config blob with these keys:
//
// dca:
//   { pair, buyAmountHny, intervalMinutes }
//
// grid:
//   { pair, lowerPrice, upperPrice, gridCount, totalHny }
//   Places gridCount buy orders from lowerPrice→upperPrice.
//   When a buy fills, immediately places a sell gridStep higher.
//
// momentum:
//   { pair, tradeAmountHny, buyThresholdPct, sellThresholdPct, lookbackMinutes }
//   Tracks price change over lookback window.
//
// stoptp:
//   { pair, holdingAmountHny, takeProfitPrice, stopLossPrice }
//   Sells when price ≥ takeProfit or ≤ stopLoss.
//
// futures_grid:
//   { market, lowerPrice, upperPrice, gridCount, collateralHny, leverage }
//   Opens long positions at lower levels, short at upper levels.

// ── Helpers ──────────────────────────────────────────────────
function makeId() {
  return `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function currentPrice(db, symbol) {
  if (symbol === "HNY") return 1;
  const row = await get(db, `SELECT mockPriceUSD FROM tokens WHERE symbol=?`, [symbol]);
  const hny = await get(db, `SELECT mockPriceUSD FROM tokens WHERE symbol='HNY'`);
  if (!row || !hny || !Number(hny.mockPriceUSD)) return null;
  return Number(row.mockPriceUSD) / Number(hny.mockPriceUSD);
}

async function getWalletBalance(db, wallet) {
  const row = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
  return Number(row?.balance || 0);
}

async function deductBalance(db, wallet, amount) {
  await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [amount, wallet]);
}
async function addBalance(db, wallet, amount) {
  await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [amount, wallet]);
}

async function logBotTrade(db, botId, action, amountHny, priceHny, notes) {
  await run(db,
    `INSERT INTO bot_trades (bot_id, action, amount_hny, price_hny, notes, traded_at)
     VALUES (?,?,?,?,?,datetime('now'))`,
    [botId, action, amountHny, priceHny, notes || ""]
  );
}

async function updateBot(db, botId, patch) {
  const sets = Object.keys(patch).map(k => `${k}=?`).join(", ");
  const vals = [...Object.values(patch), botId];
  await run(db, `UPDATE trading_bots SET ${sets} WHERE id=?`, vals);
}

// ── Bot Execution: DCA ────────────────────────────────────────
async function runDcaBot(db, bot) {
  const cfg = JSON.parse(bot.config);
  const [base] = cfg.pair.split("/");
  const now = Date.now();
  const lastRun = bot.last_run_at ? new Date(bot.last_run_at).getTime() : 0;
  const intervalMs = cfg.intervalMinutes * 60_000;

  if (now - lastRun < intervalMs) return; // not time yet

  const price = await currentPrice(db, base);
  if (!price) return;

  const cost = cfg.buyAmountHny * (1 + BOT_FEE_RATE);
  const bal  = await getWalletBalance(db, bot.wallet);
  if (bal < cost) {
    await updateBot(db, bot.id, { status: "paused", state_json: JSON.stringify({ reason: "Insufficient balance" }) });
    return;
  }

  await deductBalance(db, bot.wallet, cost);
  await addBalance(db, BOTS_FEE_VAULT, cfg.buyAmountHny * BOT_FEE_RATE);

  const tokensReceived = cfg.buyAmountHny / price;
  const state = JSON.parse(bot.state_json || "{}");
  state.totalBought = (state.totalBought || 0) + tokensReceived;
  state.totalSpent  = (state.totalSpent  || 0) + cfg.buyAmountHny;
  state.avgPrice    = state.totalSpent / state.totalBought;
  state.trades      = (state.trades || 0) + 1;

  await logBotTrade(db, bot.id, "buy", cfg.buyAmountHny, price, `DCA buy ${tokensReceived.toFixed(4)} ${base}`);
  await updateBot(db, bot.id, {
    last_run_at: new Date().toISOString(),
    state_json: JSON.stringify(state),
    total_pnl: (state.totalBought * price - state.totalSpent).toFixed(6),
  });
}

// ── Bot Execution: Grid ───────────────────────────────────────
async function runGridBot(db, bot) {
  const cfg   = JSON.parse(bot.config);
  const state = JSON.parse(bot.state_json || "{}");
  const [base] = cfg.pair.split("/");
  const price  = await currentPrice(db, base);
  if (!price) return;

  const step    = (cfg.upperPrice - cfg.lowerPrice) / cfg.gridCount;
  const perGrid = cfg.totalHny / cfg.gridCount;

  // Initialise grid levels if first run
  if (!state.levels) {
    state.levels = [];
    for (let i = 0; i <= cfg.gridCount; i++) {
      state.levels.push({
        price: Number((cfg.lowerPrice + i * step).toFixed(8)),
        hasBuy: false,
        hasSell: false,
      });
    }
    state.invested = 0;
  }

  let changed = false;

  for (const level of state.levels) {
    // Place buy order below current price if not already placed
    if (!level.hasBuy && level.price < price) {
      const cost = perGrid * (1 + BOT_FEE_RATE);
      const bal  = await getWalletBalance(db, bot.wallet);
      if (bal >= cost) {
        await deductBalance(db, bot.wallet, cost);
        await addBalance(db, BOTS_FEE_VAULT, perGrid * BOT_FEE_RATE);
        level.hasBuy   = true;
        level.buyFill  = perGrid / level.price; // tokens acquired
        state.invested = (state.invested || 0) + perGrid;
        await logBotTrade(db, bot.id, "grid_buy", perGrid, level.price, `Grid buy at ${level.price.toFixed(6)}`);
        changed = true;
      }
    }

    // Place sell order above current price if we have a corresponding buy filled
    if (level.hasBuy && !level.hasSell) {
      const sellLevel = state.levels.find(l => Math.abs(l.price - (level.price + step)) < 0.000001);
      if (sellLevel && sellLevel.price > price) {
        const proceeds = (level.buyFill || 0) * sellLevel.price * (1 - BOT_FEE_RATE);
        await addBalance(db, bot.wallet, proceeds);
        await addBalance(db, BOTS_FEE_VAULT, (level.buyFill || 0) * sellLevel.price * BOT_FEE_RATE);
        level.hasSell   = true;
        state.invested  = Math.max(0, (state.invested || 0) - perGrid);
        await logBotTrade(db, bot.id, "grid_sell", proceeds, sellLevel.price, `Grid sell at ${sellLevel.price.toFixed(6)}`);
        changed = true;
        // Reset so the cycle can repeat
        level.hasBuy  = false;
        level.hasSell = false;
        level.buyFill = 0;
      }
    }
  }

  if (changed) {
    const valueNow = (state.invested || 0) * (price / ((cfg.lowerPrice + cfg.upperPrice) / 2));
    await updateBot(db, bot.id, {
      last_run_at: new Date().toISOString(),
      state_json:  JSON.stringify(state),
      total_pnl:   (valueNow - cfg.totalHny).toFixed(6),
    });
  } else {
    await updateBot(db, bot.id, { last_run_at: new Date().toISOString() });
  }
}

// ── Bot Execution: Momentum ───────────────────────────────────
async function runMomentumBot(db, bot) {
  const cfg   = JSON.parse(bot.config);
  const state = JSON.parse(bot.state_json || "{}");
  const [base] = cfg.pair.split("/");
  const price   = await currentPrice(db, base);
  if (!price) return;

  // Record price history
  const history = state.priceHistory || [];
  history.push({ price, time: Date.now() });
  // Keep only the lookback window
  const cutoff = Date.now() - cfg.lookbackMinutes * 60_000;
  const trimmed = history.filter(h => h.time > cutoff);
  if (trimmed.length < 2) {
    await updateBot(db, bot.id, { last_run_at: new Date().toISOString(), state_json: JSON.stringify({ ...state, priceHistory: trimmed }) });
    return;
  }

  const oldPrice = trimmed[0].price;
  const changePct = ((price - oldPrice) / oldPrice) * 100;

  const now = Date.now();
  const lastRun = bot.last_run_at ? new Date(bot.last_run_at).getTime() : 0;
  if (now - lastRun < 5 * 60_000) return; // throttle to once per 5 min

  const inPosition = state.inPosition || false;

  if (!inPosition && changePct >= cfg.buyThresholdPct) {
    // Buy signal
    const cost = cfg.tradeAmountHny * (1 + BOT_FEE_RATE);
    const bal  = await getWalletBalance(db, bot.wallet);
    if (bal >= cost) {
      await deductBalance(db, bot.wallet, cost);
      await addBalance(db, BOTS_FEE_VAULT, cfg.tradeAmountHny * BOT_FEE_RATE);
      state.inPosition  = true;
      state.entryPrice  = price;
      state.entryAmount = cfg.tradeAmountHny;
      await logBotTrade(db, bot.id, "momentum_buy", cfg.tradeAmountHny, price, `+${changePct.toFixed(2)}% momentum signal`);
    }
  } else if (inPosition && changePct <= -cfg.sellThresholdPct) {
    // Sell signal
    const proceeds = state.entryAmount * (price / state.entryPrice) * (1 - BOT_FEE_RATE);
    await addBalance(db, bot.wallet, proceeds);
    await addBalance(db, BOTS_FEE_VAULT, state.entryAmount * BOT_FEE_RATE);
    const pnl = proceeds - state.entryAmount;
    state.inPosition  = false;
    state.totalPnl    = (state.totalPnl || 0) + pnl;
    await logBotTrade(db, bot.id, "momentum_sell", proceeds, price, `${changePct.toFixed(2)}% momentum exit, PnL: ${pnl.toFixed(4)} HNY`);
  }

  await updateBot(db, bot.id, {
    last_run_at: new Date().toISOString(),
    state_json:  JSON.stringify({ ...state, priceHistory: trimmed }),
    total_pnl:   (state.totalPnl || 0).toFixed(6),
  });
}

// ── Bot Execution: Stop Loss / Take Profit ────────────────────
async function runStopTpBot(db, bot) {
  const cfg   = JSON.parse(bot.config);
  const state = JSON.parse(bot.state_json || "{}");
  const [base] = cfg.pair.split("/");
  const price   = await currentPrice(db, base);
  if (!price) return;

  const triggered = price >= cfg.takeProfitPrice || price <= cfg.stopLossPrice;
  if (!triggered || state.triggered) return;

  const action = price >= cfg.takeProfitPrice ? "take_profit" : "stop_loss";
  const proceeds = cfg.holdingAmountHny * (price / (cfg.entryPrice || price)) * (1 - BOT_FEE_RATE);
  await addBalance(db, bot.wallet, proceeds);
  await addBalance(db, BOTS_FEE_VAULT, cfg.holdingAmountHny * BOT_FEE_RATE);

  state.triggered   = true;
  state.exitPrice   = price;
  state.exitAction  = action;
  const pnl = proceeds - cfg.holdingAmountHny;
  state.finalPnl    = pnl;

  await logBotTrade(db, bot.id, action, proceeds, price, `${action} at ${price.toFixed(6)} HNY, PnL: ${pnl.toFixed(4)} HNY`);
  await updateBot(db, bot.id, {
    status:      "completed",
    last_run_at: new Date().toISOString(),
    state_json:  JSON.stringify(state),
    total_pnl:   pnl.toFixed(6),
  });
}

// ── Bot Execution: Futures Grid ───────────────────────────────
async function runFuturesGridBot(db, bot) {
  const cfg   = JSON.parse(bot.config);
  const state = JSON.parse(bot.state_json || "{}");
  const { market } = cfg;

  const mkt = await get(db, `SELECT * FROM futures_markets WHERE id=?`, [market]);
  if (!mkt) return;
  const price = Number(mkt.mark_price);

  const step      = (cfg.upperPrice - cfg.lowerPrice) / cfg.gridCount;
  const collPerGrid = cfg.collateralHny / cfg.gridCount;

  if (!state.gridPositions) state.gridPositions = [];

  // Open long positions below current price (expecting bounce up)
  for (let i = 0; i < cfg.gridCount; i++) {
    const lvlPrice = cfg.lowerPrice + i * step;
    if (lvlPrice >= price) continue;
    const exists = state.gridPositions.find(p => Math.abs(p.entryPrice - lvlPrice) < 0.000001 && p.side === "long" && p.open);
    if (exists) continue;

    const cost = collPerGrid * (1 + BOT_FEE_RATE);
    const bal  = await getWalletBalance(db, bot.wallet);
    if (bal < cost) continue;

    await deductBalance(db, bot.wallet, cost);
    await addBalance(db, BOTS_FEE_VAULT, collPerGrid * BOT_FEE_RATE);

    const posId = makeId();
    const sizeUsd = collPerGrid * cfg.leverage;
    await run(db,
      `INSERT INTO futures_positions (id, wallet, market_id, side, size_usd, collateral_hny, entry_price_hny, liq_price_hny, status, opened_at, updated_at)
       VALUES (?,?,?,'long',?,?,?,?,  'open', datetime('now'), datetime('now'))`,
      [posId, bot.wallet, market, sizeUsd, collPerGrid, lvlPrice,
       lvlPrice * (1 - 0.975 / cfg.leverage)]
    );
    state.gridPositions.push({ posId, entryPrice: lvlPrice, side: "long", open: true, targetPrice: lvlPrice + step });
    await logBotTrade(db, bot.id, "futures_grid_long", collPerGrid, lvlPrice, `Futures grid long at ${lvlPrice.toFixed(4)}`);
  }

  // Close long positions that reached their target
  for (const pos of state.gridPositions.filter(p => p.side === "long" && p.open)) {
    if (price >= pos.targetPrice) {
      const dbPos = await get(db, `SELECT * FROM futures_positions WHERE id=?`, [pos.posId]);
      if (!dbPos || dbPos.status !== "open") { pos.open = false; continue; }
      const pnlHny = (price - pos.entryPrice) / price * (dbPos.size_usd / price) * cfg.leverage;
      const payout = Number(dbPos.collateral_hny) + Math.max(-Number(dbPos.collateral_hny), pnlHny);
      await addBalance(db, bot.wallet, payout);
      await run(db,
        `UPDATE futures_positions SET status='closed', close_price_hny=?, realized_pnl_hny=?, updated_at=datetime('now') WHERE id=?`,
        [price, pnlHny, pos.posId]
      );
      pos.open = false;
      await logBotTrade(db, bot.id, "futures_grid_close_long", payout, price, `Closed long at ${price.toFixed(4)}, PnL: ${pnlHny.toFixed(4)} HNY`);
    }
  }

  await updateBot(db, bot.id, {
    last_run_at: new Date().toISOString(),
    state_json:  JSON.stringify(state),
  });
}

// ── Bot Runner — called every BOT_CHECK_MS ───────────────────
async function runAllBots() {
  const db = openDb();
  try {
    const bots = await all(db, `SELECT * FROM trading_bots WHERE status='active'`);
    for (const bot of bots) {
      try {
        switch (bot.type) {
          case "dca":          await runDcaBot(db, bot);          break;
          case "grid":         await runGridBot(db, bot);         break;
          case "momentum":     await runMomentumBot(db, bot);     break;
          case "stoptp":       await runStopTpBot(db, bot);       break;
          case "futures_grid": await runFuturesGridBot(db, bot);  break;
        }
      } catch (e) {
        console.error(`Bot ${bot.id} (${bot.type}) error:`, e.message);
      }
    }
  } catch (e) {
    console.error("runAllBots error:", e);
  } finally { db.close(); }
}

// ── POST /bots/create ─────────────────────────────────────────
router.post("/create", async (req, res) => {
  const { wallet, type, name, config } = req.body;
  const validTypes = ["dca", "grid", "momentum", "stoptp", "futures_grid"];
  if (!wallet || !validTypes.includes(type) || !config) {
    return res.status(400).json({ error: "Missing wallet, type, or config" });
  }

  // Validate config has required fields per type
  const cfg = config;
  const errors = [];
  if (type === "dca")           { if (!cfg.pair || !cfg.buyAmountHny || !cfg.intervalMinutes) errors.push("DCA needs pair, buyAmountHny, intervalMinutes"); }
  if (type === "grid")          { if (!cfg.pair || !cfg.lowerPrice || !cfg.upperPrice || !cfg.gridCount || !cfg.totalHny) errors.push("Grid needs pair, lowerPrice, upperPrice, gridCount, totalHny"); }
  if (type === "momentum")      { if (!cfg.pair || !cfg.tradeAmountHny || !cfg.buyThresholdPct || !cfg.sellThresholdPct) errors.push("Momentum needs pair, tradeAmountHny, buyThresholdPct, sellThresholdPct"); }
  if (type === "stoptp")        { if (!cfg.pair || !cfg.holdingAmountHny || !cfg.takeProfitPrice || !cfg.stopLossPrice) errors.push("StopTP needs pair, holdingAmountHny, takeProfitPrice, stopLossPrice"); }
  if (type === "futures_grid")  { if (!cfg.market || !cfg.lowerPrice || !cfg.upperPrice || !cfg.gridCount || !cfg.collateralHny) errors.push("Futures grid needs market, lowerPrice, upperPrice, gridCount, collateralHny"); }
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  const db = openDb();
  try {
    const id = makeId();
    await run(db,
      `INSERT INTO trading_bots (id, wallet, type, name, config, status, state_json, total_pnl, created_at, updated_at)
       VALUES (?,?,?,?,?,  'active','{}',0, datetime('now'),datetime('now'))`,
      [id, wallet, type, name || `${type.toUpperCase()} Bot`, JSON.stringify(config)]
    );
    const bot = await get(db, `SELECT * FROM trading_bots WHERE id=?`, [id]);
    res.json({ ok: true, bot });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── POST /bots/pause/:id ──────────────────────────────────────
router.post("/pause/:id", async (req, res) => {
  const { id } = req.params;
  const { wallet } = req.body;
  const db = openDb();
  try {
    const bot = await get(db, `SELECT * FROM trading_bots WHERE id=? AND wallet=?`, [id, wallet]);
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    await run(db, `UPDATE trading_bots SET status='paused', updated_at=datetime('now') WHERE id=?`, [id]);
    res.json({ ok: true });
  } finally { db.close(); }
});

// ── POST /bots/resume/:id ─────────────────────────────────────
router.post("/resume/:id", async (req, res) => {
  const { id } = req.params;
  const { wallet } = req.body;
  const db = openDb();
  try {
    const bot = await get(db, `SELECT * FROM trading_bots WHERE id=? AND wallet=?`, [id, wallet]);
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    await run(db, `UPDATE trading_bots SET status='active', updated_at=datetime('now') WHERE id=?`, [id]);
    res.json({ ok: true });
  } finally { db.close(); }
});

// ── POST /bots/delete/:id ─────────────────────────────────────
router.post("/delete/:id", async (req, res) => {
  const { id } = req.params;
  const { wallet } = req.body;
  const db = openDb();
  try {
    const bot = await get(db, `SELECT * FROM trading_bots WHERE id=? AND wallet=?`, [id, wallet]);
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    await run(db, `UPDATE trading_bots SET status='deleted', updated_at=datetime('now') WHERE id=?`, [id]);
    res.json({ ok: true });
  } finally { db.close(); }
});

// ── GET /bots/list/:wallet ────────────────────────────────────
router.get("/list/:wallet", async (req, res) => {
  const { wallet } = req.params;
  const db = openDb();
  try {
    const bots = await all(db,
      `SELECT b.*, (SELECT COUNT(*) FROM bot_trades WHERE bot_id=b.id) as trade_count
       FROM trading_bots b WHERE wallet=? AND status != 'deleted'
       ORDER BY created_at DESC`,
      [wallet]
    );
    res.json({ bots });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /bots/trades/:id ──────────────────────────────────────
router.get("/trades/:id", async (req, res) => {
  const { id } = req.params;
  const db = openDb();
  try {
    const trades = await all(db,
      `SELECT * FROM bot_trades WHERE bot_id=? ORDER BY traded_at DESC LIMIT 100`,
      [id]
    );
    res.json({ trades });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

// ── GET /bots/stats ───────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const db = openDb();
  try {
    const activeBots   = await get(db, `SELECT COUNT(*) as n FROM trading_bots WHERE status='active'`);
    const totalBots    = await get(db, `SELECT COUNT(*) as n FROM trading_bots WHERE status != 'deleted'`);
    const totalTrades  = await get(db, `SELECT COUNT(*) as n FROM bot_trades`);
    const totalPnl     = await get(db, `SELECT SUM(CAST(total_pnl AS REAL)) as v FROM trading_bots WHERE status != 'deleted'`);
    const byType       = await all(db,
      `SELECT type, COUNT(*) as count FROM trading_bots WHERE status='active' GROUP BY type`
    );
    res.json({
      activeBots:  Number(activeBots?.n  || 0),
      totalBots:   Number(totalBots?.n   || 0),
      totalTrades: Number(totalTrades?.n || 0),
      totalPnlHny: Number(totalPnl?.v   || 0),
      byType,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally { db.close(); }
});

module.exports = { router, BOTS_FEE_VAULT, runAllBots, BOT_CHECK_MS };
