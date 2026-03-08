// apps/mobile/honey-dev/launchpad.js
// Token Launchpad router — Phase H4
// Pump-style bonding curve token launches on Honey Network
"use strict";

const express = require("express");
const crypto  = require("crypto");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

/* ───────────────────────────────────────────────────────────
   CONSTANTS
─────────────────────────────────────────────────────────── */
const VIRTUAL_HNY_INIT      = 1_000;          // virtual HNY in curve at launch
const VIRTUAL_SUPPLY_INIT   = 1_000_000_000;  // 1B total token supply
const GRADUATION_THRESHOLD  = 100;            // HNY raised to graduate to AMM
const CREATOR_FEE_RATE      = 0.01;           // 1% of every trade to creator
const PLATFORM_FEE_RATE     = 0.005;          // 0.5% platform fee
const LAUNCHPAD_FEE_VAULT   = "HNY_LAUNCHPAD_FEE_VAULT";

/* ───────────────────────────────────────────────────────────
   BONDING CURVE MATH
   Constant-product: (vHNY + realHNY) * remainingSupply = k
   Price = vHNY / remainingSupply
─────────────────────────────────────────────────────────── */

/** Current token price in HNY */
function bondingPrice(vHny, vSupply, realHnyRaised, tokensSold) {
  const poolHny    = vHny + realHnyRaised;
  const remaining  = vSupply - tokensSold;
  if (remaining <= 0) return Infinity;
  return poolHny / remaining;
}

/** How many tokens you get for `hnyIn` HNY */
function calcBuyTokens(vHny, vSupply, realHnyRaised, tokensSold, hnyIn) {
  const poolHny   = vHny + realHnyRaised;
  const remaining = vSupply - tokensSold;
  // tokens = remaining * hnyIn / (poolHny + hnyIn)
  return (remaining * hnyIn) / (poolHny + hnyIn);
}

/** How much HNY you get for selling `tokensIn` tokens */
function calcSellHny(vHny, vSupply, realHnyRaised, tokensSold, tokensIn) {
  const poolHny   = vHny + realHnyRaised;
  const remaining = vSupply - tokensSold;
  // hny = poolHny * tokensIn / (remaining + tokensIn)
  return (poolHny * tokensIn) / (remaining + tokensIn);
}

/** Market cap in HNY at current price */
function marketCapHny(vHny, vSupply, realHnyRaised, tokensSold) {
  const price = bondingPrice(vHny, vSupply, realHnyRaised, tokensSold);
  return price * vSupply;
}

/** Graduation progress 0–100% */
function graduationPct(realHnyRaised, threshold = GRADUATION_THRESHOLD) {
  return Math.min(100, (realHnyRaised / threshold) * 100);
}

/* ───────────────────────────────────────────────────────────
   HELPERS
─────────────────────────────────────────────────────────── */

async function ensureLaunchpadVault(db) {
  const exists = await get(db, `SELECT wallet FROM accounts WHERE wallet=?`, [LAUNCHPAD_FEE_VAULT]);
  if (!exists) {
    await run(db,
      `INSERT OR IGNORE INTO accounts (wallet, publicKeyB64, balance, nonce, lastMintMs, createdAtMs) VALUES (?,?,0,0,0,?)`,
      [LAUNCHPAD_FEE_VAULT, "", Date.now()]
    );
  }
}

/** Verify ML-DSA-65 signature (same pattern as futures.js / server.js) */
async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  if (!mldsaPubKeyHex) return { ok: false, error: "Wallet not registered (missing ML-DSA-65 public key)" };
  if (!signatureHex)   return { ok: false, error: "Missing signatureHex" };
  try {
    const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa");
    const ok = ml_dsa65.verify(
      Buffer.from(mldsaPubKeyHex, "hex"),
      Buffer.from(message, "utf8"),
      Buffer.from(signatureHex, "hex")
    );
    if (!ok) return { ok: false, error: "Invalid ML-DSA-65 signature" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `ML-DSA-65 verify error: ${e.message}` };
  }
}

/** Enrich a raw DB token row with computed fields */
function enrichToken(t) {
  const price  = bondingPrice(t.virtual_hny, t.virtual_supply, t.real_hny_raised, t.tokens_sold);
  const mcap   = marketCapHny(t.virtual_hny, t.virtual_supply, t.real_hny_raised, t.tokens_sold);
  const pct    = graduationPct(t.real_hny_raised, t.graduation_threshold);
  return {
    id:                  t.id,
    name:                t.name,
    ticker:              t.ticker,
    description:         t.description,
    imageEmoji:          t.image_emoji,
    creatorWallet:       t.creator_wallet,
    priceHny:            price,
    marketCapHny:        mcap,
    realHnyRaised:       t.real_hny_raised,
    tokensSold:          t.tokens_sold,
    totalSupply:         t.total_supply,
    graduationThreshold: t.graduation_threshold,
    graduationPct:       pct,
    graduated:           !!t.graduated,
    graduatedAt:         t.graduated_at,
    website:             t.website,
    twitter:             t.twitter,
    telegram:            t.telegram,
    createdAt:           t.created_at,
    lastTradeAt:         t.last_trade_at,
  };
}

/* ───────────────────────────────────────────────────────────
   GET /launchpad/tokens
   List tokens — sort: newest (default) | trending | graduating
─────────────────────────────────────────────────────────── */
router.get("/tokens", async (req, res) => {
  const db = openDb();
  try {
    const sort  = req.query.sort ?? "newest";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const graduated = req.query.graduated === "true" ? 1 : 0;

    let orderBy = "created_at DESC";
    if (sort === "trending")   orderBy = "real_hny_raised DESC, last_trade_at DESC";
    if (sort === "graduating") orderBy = "real_hny_raised DESC";
    if (sort === "newest")     orderBy = "created_at DESC";

    const tokens = await all(db,
      `SELECT * FROM launchpad_tokens WHERE graduated=? ORDER BY ${orderBy} LIMIT ?`,
      [graduated, limit]
    );

    res.json({ tokens: tokens.map(enrichToken) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   GET /launchpad/token/:id
   Single token detail + recent trades
─────────────────────────────────────────────────────────── */
router.get("/token/:id", async (req, res) => {
  const db = openDb();
  try {
    const token = await get(db, `SELECT * FROM launchpad_tokens WHERE id=?`, [req.params.id]);
    if (!token) return res.status(404).json({ error: "Token not found" });

    const trades = await all(db,
      `SELECT * FROM launchpad_trades WHERE token_id=? ORDER BY traded_at DESC LIMIT 50`,
      [token.id]
    );

    res.json({ token: enrichToken(token), trades });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   GET /launchpad/portfolio/:wallet
   All launchpad token holdings for a wallet
─────────────────────────────────────────────────────────── */
router.get("/portfolio/:wallet", async (req, res) => {
  const db = openDb();
  try {
    const rows = await all(db,
      `SELECT h.*, t.name, t.ticker, t.image_emoji,
              t.virtual_hny, t.virtual_supply, t.real_hny_raised, t.tokens_sold,
              t.total_supply, t.graduation_threshold, t.graduated
       FROM launchpad_holdings h
       LEFT JOIN launchpad_tokens t ON t.id=h.token_id
       WHERE h.wallet=? AND h.balance>0`,
      [req.params.wallet]
    );

    const holdings = rows.map((r) => {
      const price = bondingPrice(r.virtual_hny, r.virtual_supply, r.real_hny_raised, r.tokens_sold);
      return {
        tokenId:     r.token_id,
        name:        r.name,
        ticker:      r.ticker,
        imageEmoji:  r.image_emoji,
        balance:     r.balance,
        valueHny:    price * r.balance,
        priceHny:    price,
        graduated:   !!r.graduated,
      };
    });

    res.json({ holdings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   GET /launchpad/stats
   Overall launchpad stats
─────────────────────────────────────────────────────────── */
router.get("/stats", async (req, res) => {
  const db = openDb();
  try {
    const total      = await get(db, `SELECT COUNT(*) as n FROM launchpad_tokens`);
    const graduated  = await get(db, `SELECT COUNT(*) as n FROM launchpad_tokens WHERE graduated=1`);
    const totalRaised = await get(db, `SELECT COALESCE(SUM(real_hny_raised),0) as r FROM launchpad_tokens`);
    const totalTrades = await get(db, `SELECT COUNT(*) as n FROM launchpad_trades`);
    res.json({
      totalTokens:    Number(total?.n || 0),
      graduatedTokens: Number(graduated?.n || 0),
      totalHnyRaised: Number(totalRaised?.r || 0),
      totalTrades:    Number(totalTrades?.n || 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   POST /launchpad/launch
   Create a new token and launch it on the bonding curve

   Body: wallet, name, ticker, description, imageEmoji,
         website?, twitter?, telegram?, signatureHex
─────────────────────────────────────────────────────────── */
router.post("/launch", async (req, res) => {
  const db = openDb();
  try {
    await ensureLaunchpadVault(db);

    const { wallet, name, ticker, description, imageEmoji, website, twitter, telegram, signatureHex } = req.body;

    // ── Validate ───────────────────────────────────────────
    if (!wallet || !name || !ticker) {
      return res.status(400).json({ error: "Missing required fields: wallet, name, ticker" });
    }
    const cleanTicker = String(ticker).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (cleanTicker.length < 2) return res.status(400).json({ error: "Ticker must be 2–10 alphanumeric characters" });
    if (String(name).length > 50) return res.status(400).json({ error: "Name too long (max 50 chars)" });

    // ── Auth ────────────────────────────────────────────────
    const account = await get(db, `SELECT * FROM accounts WHERE wallet=?`, [wallet]);
    if (!account) return res.status(404).json({ error: "Wallet not found" });

    const message = `launchpad_launch:${wallet}:${cleanTicker}:${name}`;
    const sigResult = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key,
      message,
      signatureHex,
    });
    if (!sigResult.ok) return res.status(403).json({ error: sigResult.error });

    // ── Deduct launch fee (1 HNY) ──────────────────────────
    const LAUNCH_FEE = 1.0;
    if (Number(account.balance) < LAUNCH_FEE) {
      return res.status(400).json({ error: `Need ${LAUNCH_FEE} HNY to launch a token` });
    }
    await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [LAUNCH_FEE, wallet]);
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [LAUNCH_FEE, LAUNCHPAD_FEE_VAULT]);

    // ── Create token ───────────────────────────────────────
    const id = `${cleanTicker.toLowerCase()}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    await run(db,
      `INSERT INTO launchpad_tokens
         (id, name, ticker, description, image_emoji, creator_wallet,
          virtual_hny, virtual_supply, real_hny_raised, tokens_sold, total_supply,
          graduation_threshold, website, twitter, telegram)
       VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?,?)`,
      [id, String(name).slice(0, 50), cleanTicker, String(description || "").slice(0, 500),
       String(imageEmoji || "🚀").slice(0, 4), wallet,
       VIRTUAL_HNY_INIT, VIRTUAL_SUPPLY_INIT, VIRTUAL_SUPPLY_INIT,
       GRADUATION_THRESHOLD,
       website || null, twitter || null, telegram || null]
    );

    const token = await get(db, `SELECT * FROM launchpad_tokens WHERE id=?`, [id]);
    res.json({ ok: true, token: enrichToken(token) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   POST /launchpad/buy
   Buy tokens on the bonding curve

   Body: wallet, tokenId, hnyAmount, signatureHex
─────────────────────────────────────────────────────────── */
router.post("/buy", async (req, res) => {
  const db = openDb();
  try {
    await ensureLaunchpadVault(db);

    const { wallet, tokenId, hnyAmount, signatureHex } = req.body;
    if (!wallet || !tokenId || !hnyAmount) {
      return res.status(400).json({ error: "Missing wallet, tokenId, or hnyAmount" });
    }

    const hny = Number(hnyAmount);
    if (hny <= 0) return res.status(400).json({ error: "hnyAmount must be positive" });

    // ── Fetch token ────────────────────────────────────────
    const token = await get(db, `SELECT * FROM launchpad_tokens WHERE id=? AND graduated=0`, [tokenId]);
    if (!token) return res.status(404).json({ error: "Token not found or already graduated" });

    // ── Fetch account + verify ─────────────────────────────
    const account = await get(db, `SELECT * FROM accounts WHERE wallet=?`, [wallet]);
    if (!account) return res.status(404).json({ error: "Wallet not found" });

    const message = `launchpad_buy:${wallet}:${tokenId}:${hny}`;
    const sigResult = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key,
      message,
      signatureHex,
    });
    if (!sigResult.ok) return res.status(403).json({ error: sigResult.error });

    // ── Calculate fees ─────────────────────────────────────
    const creatorFee   = hny * CREATOR_FEE_RATE;
    const platformFee  = hny * PLATFORM_FEE_RATE;
    const hnyForCurve  = hny - creatorFee - platformFee;

    if (Number(account.balance) < hny) {
      return res.status(400).json({ error: `Insufficient balance (need ${hny.toFixed(4)} HNY)` });
    }

    // ── Calculate tokens out ───────────────────────────────
    const tokensOut = calcBuyTokens(
      token.virtual_hny, token.virtual_supply,
      token.real_hny_raised, token.tokens_sold,
      hnyForCurve
    );
    if (tokensOut <= 0) return res.status(400).json({ error: "Calculated zero tokens out" });

    const priceHny = hnyForCurve / tokensOut;

    // ── Apply trade ────────────────────────────────────────
    await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [hny, wallet]);
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [creatorFee, token.creator_wallet === wallet ? LAUNCHPAD_FEE_VAULT : token.creator_wallet]);
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [platformFee, LAUNCHPAD_FEE_VAULT]);

    // Update bonding curve state
    const newRealHny   = token.real_hny_raised + hnyForCurve;
    const newTokensSold = token.tokens_sold + tokensOut;

    await run(db,
      `UPDATE launchpad_tokens SET real_hny_raised=?, tokens_sold=?, last_trade_at=datetime('now') WHERE id=?`,
      [newRealHny, newTokensSold, tokenId]
    );

    // Update buyer holdings
    await run(db,
      `INSERT INTO launchpad_holdings (wallet, token_id, balance, updated_at)
       VALUES (?,?,?,datetime('now'))
       ON CONFLICT(wallet, token_id) DO UPDATE SET balance=balance+?, updated_at=datetime('now')`,
      [wallet, tokenId, tokensOut, tokensOut]
    );

    // Record trade
    await run(db,
      `INSERT INTO launchpad_trades (token_id, wallet, type, hny_amount, token_amount, price_hny, fee_hny)
       VALUES (?,?,?,?,?,?,?)`,
      [tokenId, wallet, "buy", hny, tokensOut, priceHny, creatorFee + platformFee]
    );

    // ── Check graduation ───────────────────────────────────
    let graduated = false;
    if (newRealHny >= token.graduation_threshold) {
      await run(db,
        `UPDATE launchpad_tokens SET graduated=1, graduated_at=datetime('now') WHERE id=?`,
        [tokenId]
      );
      graduated = true;
      console.log(`🎓 Token ${token.ticker} graduated! ${newRealHny.toFixed(2)} HNY raised`);
    }

    const updatedToken = await get(db, `SELECT * FROM launchpad_tokens WHERE id=?`, [tokenId]);
    res.json({
      ok:          true,
      tokensOut:   Number(tokensOut.toFixed(2)),
      hnySpent:    hny,
      priceHny:    Number(priceHny.toFixed(8)),
      feesHny:     Number((creatorFee + platformFee).toFixed(8)),
      graduated,
      token:       enrichToken(updatedToken),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

/* ───────────────────────────────────────────────────────────
   POST /launchpad/sell
   Sell tokens back to the bonding curve

   Body: wallet, tokenId, tokenAmount, signatureHex
─────────────────────────────────────────────────────────── */
router.post("/sell", async (req, res) => {
  const db = openDb();
  try {
    await ensureLaunchpadVault(db);

    const { wallet, tokenId, tokenAmount, signatureHex } = req.body;
    if (!wallet || !tokenId || !tokenAmount) {
      return res.status(400).json({ error: "Missing wallet, tokenId, or tokenAmount" });
    }

    const tokensIn = Number(tokenAmount);
    if (tokensIn <= 0) return res.status(400).json({ error: "tokenAmount must be positive" });

    // ── Fetch token + holding ──────────────────────────────
    const token = await get(db, `SELECT * FROM launchpad_tokens WHERE id=? AND graduated=0`, [tokenId]);
    if (!token) return res.status(404).json({ error: "Token not found or already graduated" });

    const holding = await get(db,
      `SELECT balance FROM launchpad_holdings WHERE wallet=? AND token_id=?`,
      [wallet, tokenId]
    );
    if (!holding || Number(holding.balance) < tokensIn) {
      return res.status(400).json({ error: "Insufficient token balance" });
    }

    // ── Fetch account + verify ─────────────────────────────
    const account = await get(db, `SELECT * FROM accounts WHERE wallet=?`, [wallet]);
    if (!account) return res.status(404).json({ error: "Wallet not found" });

    const message = `launchpad_sell:${wallet}:${tokenId}:${tokensIn}`;
    const sigResult = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key,
      message,
      signatureHex,
    });
    if (!sigResult.ok) return res.status(403).json({ error: sigResult.error });

    // ── Calculate HNY out (before fees) ───────────────────
    const rawHnyOut   = calcSellHny(
      token.virtual_hny, token.virtual_supply,
      token.real_hny_raised, token.tokens_sold,
      tokensIn
    );
    const creatorFee  = rawHnyOut * CREATOR_FEE_RATE;
    const platformFee = rawHnyOut * PLATFORM_FEE_RATE;
    const hnyOut      = rawHnyOut - creatorFee - platformFee;
    const priceHny    = rawHnyOut / tokensIn;

    if (hnyOut <= 0) return res.status(400).json({ error: "Calculated zero HNY out" });

    // ── Apply trade ────────────────────────────────────────
    const newRealHny    = Math.max(0, token.real_hny_raised - rawHnyOut);
    const newTokensSold = Math.max(0, token.tokens_sold - tokensIn);

    await run(db,
      `UPDATE launchpad_tokens SET real_hny_raised=?, tokens_sold=?, last_trade_at=datetime('now') WHERE id=?`,
      [newRealHny, newTokensSold, tokenId]
    );
    await run(db,
      `UPDATE launchpad_holdings SET balance=balance-?, updated_at=datetime('now')
       WHERE wallet=? AND token_id=?`,
      [tokensIn, wallet, tokenId]
    );
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [hnyOut, wallet]);
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [creatorFee + platformFee, LAUNCHPAD_FEE_VAULT]);

    // Record trade
    await run(db,
      `INSERT INTO launchpad_trades (token_id, wallet, type, hny_amount, token_amount, price_hny, fee_hny)
       VALUES (?,?,?,?,?,?,?)`,
      [tokenId, wallet, "sell", rawHnyOut, tokensIn, priceHny, creatorFee + platformFee]
    );

    const updatedToken = await get(db, `SELECT * FROM launchpad_tokens WHERE id=?`, [tokenId]);
    res.json({
      ok:         true,
      hnyOut:     Number(hnyOut.toFixed(8)),
      tokensIn,
      priceHny:   Number(priceHny.toFixed(8)),
      feesHny:    Number((creatorFee + platformFee).toFixed(8)),
      token:      enrichToken(updatedToken),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    db.close();
  }
});

module.exports = { router, LAUNCHPAD_FEE_VAULT };
