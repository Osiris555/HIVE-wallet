// apps/mobile/honey-dev/bridge.js
// Cross-Chain Bridge Router — Phase H6a
// Trusted relayer model (testnet): no EVM smart contracts.
// Supports: Honey Network ↔ Base Mainnet / Base Sepolia
"use strict";

const express = require("express");
const crypto  = require("crypto");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────
const BRIDGE_FEE_RATE  = 0.001; // 0.1%
const BRIDGE_FEE_VAULT = "HNY_BRIDGE_FEE_VAULT";

const BRIDGE_TOKENS = {
  HNY:  { hnySymbol: "HNY",  evmSymbol: "HNY",  decimals: 18, min: 1,     max: 50000 },
  USDC: { hnySymbol: "USDC", evmSymbol: "USDC",  decimals: 6,  min: 1,     max: 50000 },
  ETH:  { hnySymbol: "ETH",  evmSymbol: "ETH",   decimals: 18, min: 0.001, max: 100   },
};

const EVM_CHAINS = {
  8453:  { name: "Base Mainnet",  rpc: "https://mainnet.base.org" },
  84532: { name: "Base Sepolia",  rpc: "https://sepolia.base.org" },
};

// ── ML-DSA-65 signature verification (same lazy-import pattern as server.js) ──
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
    const mlDsa   = await getMlDsa();
    const pubKey  = Buffer.from(mldsaPubKeyHex,  "hex");
    const sig     = Buffer.from(signatureHex,    "hex");
    const msgBuf  = Buffer.from(message, "utf8");
    return { ok: mlDsa.verify(pubKey, msgBuf, sig) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function now() { return Date.now(); }
function uid() { return crypto.randomUUID(); }

async function getHnyBalance(db, wallet) {
  const row = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
  return Number(row?.balance || 0);
}

async function getTokenBalance(db, wallet, token) {
  if (token === "HNY") return getHnyBalance(db, wallet);
  const row = await get(db,
    `SELECT balance FROM token_balances WHERE wallet=? AND token_symbol=?`,
    [wallet, token]
  );
  return Number(row?.balance || 0);
}

async function ensureAccount(db, wallet) {
  const row = await get(db, `SELECT wallet FROM accounts WHERE wallet=?`, [wallet]);
  if (!row) {
    await run(db,
      `INSERT INTO accounts (wallet, publicKeyB64, balance, nonce, lastMintMs, createdAtMs)
       VALUES (?, NULL, 0, 0, 0, ?)`,
      [wallet, now()]
    );
  }
}

// ── GET /bridge/supported ─────────────────────────────────────────────────
router.get("/supported", (_req, res) => {
  res.json({
    tokens: Object.keys(BRIDGE_TOKENS),
    chains: Object.entries(EVM_CHAINS).map(([id, c]) => ({ id: Number(id), name: c.name })),
    feeRate: BRIDGE_FEE_RATE,
    limits: Object.fromEntries(
      Object.entries(BRIDGE_TOKENS).map(([sym, t]) => [sym, { min: t.min, max: t.max }])
    ),
  });
});

// ── GET /bridge/quote ─────────────────────────────────────────────────────
router.get("/quote", (req, res) => {
  try {
    const { token, amount } = req.query;
    const sym = String(token || "HNY").toUpperCase();
    const amt = parseFloat(amount);

    if (!BRIDGE_TOKENS[sym]) return res.status(400).json({ error: "Unsupported token" });
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });
    const { min, max } = BRIDGE_TOKENS[sym];
    if (amt < min) return res.status(400).json({ error: `Minimum bridge amount is ${min} ${sym}` });
    if (amt > max) return res.status(400).json({ error: `Maximum bridge amount is ${max} ${sym}` });

    const fee       = Number((amt * BRIDGE_FEE_RATE).toFixed(8));
    const netAmount = Number((amt - fee).toFixed(8));

    res.json({ token: sym, amount: amt, fee, netAmount, feeRate: BRIDGE_FEE_RATE, estimatedSeconds: 30 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /bridge/stats ─────────────────────────────────────────────────────
router.get("/stats", async (_req, res) => {
  const db = openDb();
  try {
    const total     = await get(db, `SELECT COUNT(*) AS n FROM bridge_transactions`, []);
    const completed = await get(db, `SELECT COUNT(*) AS n FROM bridge_transactions WHERE status='completed'`, []);
    const pending   = await get(db, `SELECT COUNT(*) AS n FROM bridge_transactions WHERE status IN ('pending','confirmed')`, []);
    const vol       = await get(db, `SELECT COALESCE(SUM(amount),0) AS v FROM bridge_transactions WHERE status='completed'`, []);
    res.json({
      totalBridges:    Number(total?.n || 0),
      totalVolumeHny:  Number(vol?.v   || 0),
      completedBridges: Number(completed?.n || 0),
      pendingBridges:  Number(pending?.n || 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally { db.close(); }
});

// ── GET /bridge/history/:wallet ───────────────────────────────────────────
router.get("/history/:wallet", async (req, res) => {
  const db = openDb();
  try {
    const wallet = String(req.params.wallet || "").trim();
    if (!wallet) return res.status(400).json({ error: "Missing wallet" });

    const rows = await all(db,
      `SELECT * FROM bridge_transactions WHERE wallet=? ORDER BY created_at_ms DESC LIMIT 50`,
      [wallet]
    );
    res.json({
      transactions: rows.map(r => ({
        id:           r.id,
        direction:    r.direction,
        fromChain:    r.from_chain,
        toChain:      r.to_chain,
        token:        r.from_token,
        amount:       Number(r.amount),
        feeAmount:    Number(r.fee_amount),
        netAmount:    Number(r.net_amount),
        fromAddress:  r.from_address,
        toAddress:    r.to_address,
        status:       r.status,
        evmChainId:   r.evm_chain_id ? Number(r.evm_chain_id) : null,
        evmTxHash:    r.evm_tx_hash  || null,
        hnyTxId:      r.hny_tx_id    || null,
        createdAt:    r.created_at,
        confirmedAt:  r.confirmed_at || null,
        completedAt:  r.completed_at || null,
        failReason:   r.fail_reason  || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally { db.close(); }
});

// ── GET /bridge/status/:id ────────────────────────────────────────────────
router.get("/status/:id", async (req, res) => {
  const db = openDb();
  try {
    const row = await get(db, `SELECT * FROM bridge_transactions WHERE id=?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: "Bridge transaction not found" });
    res.json({ transaction: {
      id: row.id, direction: row.direction, fromChain: row.from_chain, toChain: row.to_chain,
      token: row.from_token, amount: Number(row.amount), feeAmount: Number(row.fee_amount),
      netAmount: Number(row.net_amount), fromAddress: row.from_address, toAddress: row.to_address,
      status: row.status, evmChainId: row.evm_chain_id, evmTxHash: row.evm_tx_hash,
      hnyTxId: row.hny_tx_id, createdAt: row.created_at, completedAt: row.completed_at,
      failReason: row.fail_reason,
    }});
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally { db.close(); }
});

// ── POST /bridge/initiate ─────────────────────────────────────────────────
// Initiates a bridge swap (signed by HIVE wallet via ML-DSA-65)
router.post("/initiate", async (req, res) => {
  const db = openDb();
  try {
    const {
      wallet, direction, token, amount, toAddress, evmChainId,
      timestamp, signatureHex, mldsaPubKeyHex,
    } = req.body;

    // Validate inputs
    if (!wallet || !direction || !token || !amount || !toAddress) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!["hny_to_evm","evm_to_hny"].includes(direction)) {
      return res.status(400).json({ error: "Invalid direction" });
    }
    const sym = String(token).toUpperCase();
    if (!BRIDGE_TOKENS[sym]) return res.status(400).json({ error: "Unsupported token" });

    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });
    const { min, max } = BRIDGE_TOKENS[sym];
    if (amt < min || amt > max) return res.status(400).json({ error: `Amount must be ${min}–${max} ${sym}` });

    if (evmChainId && !EVM_CHAINS[Number(evmChainId)]) {
      return res.status(400).json({ error: "Unsupported EVM chain" });
    }
    const chainId  = evmChainId ? Number(evmChainId) : 8453;
    const chainName = EVM_CHAINS[chainId].name;

    // Verify ML-DSA-65 signature
    if (!signatureHex || !mldsaPubKeyHex) {
      return res.status(401).json({ error: "Missing signature" });
    }
    const canonMsg = `bridge|${wallet}|${direction}|${sym}|${amt}|${toAddress}|${chainId}|${timestamp}`;
    const sigOk = await verifyMLDSASignature({ mldsaPubKeyHex, message: canonMsg, signatureHex });
    if (!sigOk.ok) return res.status(401).json({ error: "Invalid signature" });

    // Verify sender's registered public key matches
    await ensureAccount(db, wallet);
    const acct = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!acct?.mldsa_public_key) return res.status(401).json({ error: "Wallet not registered on Honey Network" });
    if (acct.mldsa_public_key.toLowerCase() !== mldsaPubKeyHex.toLowerCase()) {
      return res.status(401).json({ error: "Public key mismatch" });
    }

    // Check balance for hny_to_evm (deduct immediately)
    const fee       = Number((amt * BRIDGE_FEE_RATE).toFixed(8));
    const netAmount = Number((amt - fee).toFixed(8));

    if (direction === "hny_to_evm") {
      const bal = await getTokenBalance(db, wallet, sym);
      if (bal < amt) return res.status(400).json({ error: `Insufficient ${sym} balance`, balance: bal, required: amt });

      if (sym === "HNY") {
        // Deduct from HNY balance in accounts table
        await run(db, `UPDATE accounts SET balance = balance - ? WHERE wallet=?`, [amt, wallet]);
        // Credit fee to bridge vault
        await ensureAccount(db, BRIDGE_FEE_VAULT);
        await run(db, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [fee, BRIDGE_FEE_VAULT]);
      } else {
        // Deduct from token_balances
        await run(db, `UPDATE token_balances SET balance = balance - ? WHERE wallet=? AND token_symbol=?`, [amt, wallet, sym]);
        await run(db, `INSERT INTO token_balances (wallet, token_symbol, balance) VALUES (?,?,?)
                       ON CONFLICT(wallet,token_symbol) DO UPDATE SET balance=balance+?`,
          [BRIDGE_FEE_VAULT, sym, fee, fee]);
      }
    }

    // Record the bridge transaction
    const id = uid();
    const fromChain = direction === "hny_to_evm" ? "Honey Network" : chainName;
    const toChain   = direction === "hny_to_evm" ? chainName        : "Honey Network";
    const fromAddr  = direction === "hny_to_evm" ? wallet    : toAddress;
    const toAddr    = direction === "hny_to_evm" ? toAddress : wallet;

    await run(db,
      `INSERT INTO bridge_transactions
         (id, wallet, direction, from_chain, to_chain, from_token, to_token,
          amount, fee_amount, net_amount, from_address, to_address,
          status, evm_chain_id, created_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, wallet, direction, fromChain, toChain, sym, sym,
       amt, fee, netAmount, fromAddr, toAddr,
       direction === "hny_to_evm" ? "pending" : "pending",
       chainId, now()]
    );

    const row = await get(db, `SELECT * FROM bridge_transactions WHERE id=?`, [id]);
    res.json({ ok: true, transaction: formatBridge(row) });
  } catch (e) {
    console.error("[bridge] initiate error:", e);
    res.status(500).json({ error: e.message });
  } finally { db.close(); }
});

// ── POST /bridge/confirm-evm ──────────────────────────────────────────────
// User submits EVM tx hash after sending on-chain (evm_to_hny flow)
router.post("/confirm-evm", async (req, res) => {
  const db = openDb();
  try {
    const { bridgeId, evmTxHash, wallet } = req.body;
    if (!bridgeId || !evmTxHash || !wallet) return res.status(400).json({ error: "Missing bridgeId/evmTxHash/wallet" });

    const bridge = await get(db, `SELECT * FROM bridge_transactions WHERE id=?`, [bridgeId]);
    if (!bridge) return res.status(404).json({ error: "Bridge transaction not found" });
    if (bridge.wallet !== wallet) return res.status(403).json({ error: "Unauthorized" });
    if (bridge.direction !== "evm_to_hny") return res.status(400).json({ error: "Only evm_to_hny bridges require EVM confirmation" });
    if (bridge.status !== "pending") return res.status(400).json({ error: `Bridge already ${bridge.status}` });

    await run(db,
      `UPDATE bridge_transactions SET evm_tx_hash=?, status='confirmed', confirmed_at=datetime('now') WHERE id=?`,
      [evmTxHash, bridgeId]
    );
    const row = await get(db, `SELECT * FROM bridge_transactions WHERE id=?`, [bridgeId]);
    res.json({ ok: true, transaction: formatBridge(row) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally { db.close(); }
});

// ── Background Job: processPendingBridges ─────────────────────────────────
// Called every 30s from server.js. Auto-completes bridges after 30s (testnet relayer).
async function processPendingBridges() {
  const db = openDb();
  try {
    const cutoffMs = now() - 30_000; // 30 seconds ago

    // hny_to_evm pending → auto-complete (real relayer would verify EVM receipt)
    const pendingHnyToEvm = await all(db,
      `SELECT * FROM bridge_transactions
       WHERE direction='hny_to_evm' AND status='pending' AND created_at_ms <= ? LIMIT 20`,
      [cutoffMs]
    );
    for (const b of pendingHnyToEvm) {
      const fakeTxHash = "0x" + crypto.randomBytes(32).toString("hex");
      await run(db,
        `UPDATE bridge_transactions
         SET status='completed', completed_at=datetime('now'), evm_tx_hash=?
         WHERE id=?`,
        [fakeTxHash, b.id]
      );
    }

    // evm_to_hny confirmed (has evm_tx_hash) → credit HNY balance, complete
    const confirmedEvmToHny = await all(db,
      `SELECT * FROM bridge_transactions
       WHERE direction='evm_to_hny' AND status='confirmed' AND created_at_ms <= ? LIMIT 20`,
      [cutoffMs]
    );
    for (const b of confirmedEvmToHny) {
      const token = String(b.from_token || "HNY").toUpperCase();
      if (token === "HNY") {
        await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [b.net_amount, b.wallet]);
      } else {
        await run(db, `INSERT INTO token_balances (wallet, token_symbol, balance) VALUES (?,?,?)
                       ON CONFLICT(wallet,token_symbol) DO UPDATE SET balance=balance+?`,
          [b.wallet, token, b.net_amount, b.net_amount]);
      }
      const hnyTxId = `BRIDGE-${b.id}`;
      await run(db,
        `UPDATE bridge_transactions
         SET status='completed', completed_at=datetime('now'), hny_tx_id=?
         WHERE id=?`,
        [hnyTxId, b.id]
      );
    }
  } catch (e) {
    console.error("[bridge] processPendingBridges error:", e);
  } finally { db.close(); }
}

// ── Format helper ─────────────────────────────────────────────────────────
function formatBridge(r) {
  return {
    id: r.id, direction: r.direction, fromChain: r.from_chain, toChain: r.to_chain,
    token: r.from_token, amount: Number(r.amount), feeAmount: Number(r.fee_amount),
    netAmount: Number(r.net_amount), fromAddress: r.from_address, toAddress: r.to_address,
    status: r.status, evmChainId: r.evm_chain_id ? Number(r.evm_chain_id) : null,
    evmTxHash: r.evm_tx_hash || null, hnyTxId: r.hny_tx_id || null,
    createdAt: r.created_at, confirmedAt: r.confirmed_at || null,
    completedAt: r.completed_at || null, failReason: r.fail_reason || null,
  };
}

module.exports = { router, BRIDGE_FEE_VAULT, processPendingBridges };
