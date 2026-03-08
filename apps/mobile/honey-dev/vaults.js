// apps/mobile/honey-dev/vaults.js
// Phase H7b — Yield Vaults + HNY Time-Lock Router
'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { openDb, run, get, all } = require('./db');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const VAULT_COMPOUND_MS = 60 * 60_000; // 1 hour

const VAULTS = [
  { id: 'HNY_STAKING_VAULT', name: 'HNY Staking Vault', receiptToken: 'ystHNY', description: 'Auto-compounds HNY staking rewards. Receive ystHNY receipt tokens (5% base APR)', baseApr: 5.0 },
  { id: 'HNY_LP_VAULT',      name: 'HIVE LP Vault',     receiptToken: 'YLPHNY', description: 'Auto-compounds LP rewards across HIVE pools. Receive YLPHNY receipt tokens (8% base APR)', baseApr: 8.0 },
];

// Lock tiers: 6 months minimum — no short-term locks
const LOCK_TIERS = [
  { days: 180,  multiplier: 2.0, label: '6 Months' },
  { days: 365,  multiplier: 3.0, label: '1 Year'   },
  { days: 730,  multiplier: 4.0, label: '2 Years'  },
  { days: 1095, multiplier: 5.0, label: '3 Years'  },
];

const EARLY_UNLOCK_PENALTY = 0.5; // forfeit 50% of accrued rewards

// ── ML-DSA-65 lazy import ─────────────────────────────────────────────────────

let _mlDsa65;
async function getMlDsa() {
  if (!_mlDsa65) {
    const mod = await import('@noble/post-quantum/ml-dsa');
    _mlDsa65 = mod.ml_dsa65;
  }
  return _mlDsa65;
}

async function verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex }) {
  try {
    const mlDsa  = await getMlDsa();
    const pubKey = Buffer.from(mldsaPubKeyHex, 'hex');
    const sig    = Buffer.from(signatureHex,   'hex');
    const msgBuf = Buffer.from(message, 'utf8');
    return { ok: mlDsa.verify(pubKey, msgBuf, sig) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Share price helper ────────────────────────────────────────────────────────

function sharePrice(state) {
  if (!state || state.total_shares <= 0) return 1.0;
  return state.total_hny / state.total_shares;
}

// ── GET /vaults/list ─────────────────────────────────────────────────────────

router.get('/list', async (req, res) => {
  try {
    const db = await openDb();
    const vaultData = await Promise.all(VAULTS.map(async v => {
      const state = await get(db, `SELECT * FROM vault_state WHERE vault_id=?`, [v.id]);
      const totalShares = Number(state?.total_shares || 0);
      const totalHny    = Number(state?.total_hny    || 0);
      const sp          = sharePrice(state);
      return {
        id: v.id, name: v.name, description: v.description,
        receiptToken: v.receiptToken,
        baseApr: v.baseApr,
        totalHny, totalShares, sharePrice: sp,
        tvlHny: totalHny,
        lastCompoundMs: Number(state?.last_compound_ms || 0),
      };
    }));
    return res.json({ vaults: vaultData });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /vaults/lock-tiers ────────────────────────────────────────────────────

router.get('/lock-tiers', (req, res) => {
  const HNY_BASE_APR = 5.0;
  const tiers = LOCK_TIERS.map(t => ({
    ...t,
    effectiveApr: HNY_BASE_APR * t.multiplier,
  }));
  res.json({ tiers });
});

// ── GET /vaults/position/:wallet ─────────────────────────────────────────────

router.get('/position/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db = await openDb();

    const positions = await Promise.all(VAULTS.map(async v => {
      const [dep, state] = await Promise.all([
        get(db, `SELECT SUM(shares_issued) as shares, SUM(hny_deposited) as deposited
                 FROM vault_deposits WHERE wallet=? AND vault_id=?`, [wallet, v.id]),
        get(db, `SELECT * FROM vault_state WHERE vault_id=?`, [v.id]),
      ]);
      const shares    = Number(dep?.shares    || 0);
      const deposited = Number(dep?.deposited || 0);
      const sp        = sharePrice(state);
      const valueHny  = shares * sp;
      return {
        vaultId: v.id, vaultName: v.name,
        shares, depositedHny: deposited, valueHny,
        gainHny: valueHny - deposited,
        sharePrice: sp,
      };
    }));

    return res.json({ wallet, positions: positions.filter(p => p.shares > 0) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /vaults/locks/:wallet ─────────────────────────────────────────────────

router.get('/locks/:wallet', async (req, res) => {
  try {
    const wallet = String(req.params.wallet || '').trim();
    const db = await openDb();
    const locks = await all(db,
      `SELECT id, wallet, amount_hny as amountHny, lock_days as lockDays, multiplier,
              locked_at_ms as lockedAtMs, unlock_at_ms as unlockAtMs, status,
              reward_accrued_hny as rewardAccruedHny, penalty_hny as penaltyHny
       FROM hny_locks WHERE wallet=? ORDER BY locked_at_ms DESC`,
      [wallet]);
    return res.json({ wallet, locks });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /vaults/deposit ─────────────────────────────────────────────────────

router.post('/deposit', async (req, res) => {
  try {
    const { wallet, vaultId, amountHny, mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!wallet || !vaultId || !amountHny || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const vault = VAULTS.find(v => v.id === vaultId);
    if (!vault) return res.status(400).json({ error: 'Invalid vault' });

    const amount = Number(amountHny);
    if (amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

    // Verify ML-DSA signature
    const message = `vault_deposit|${wallet}|${vaultId}|${amount}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db = await openDb();

    // Check balance
    const account = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
    if (Number(account?.balance || 0) < amount) {
      return res.status(400).json({ error: 'Insufficient HNY balance' });
    }

    // Get/init vault state
    let state = await get(db, `SELECT * FROM vault_state WHERE vault_id=?`, [vaultId]);
    if (!state) {
      await run(db, `INSERT OR IGNORE INTO vault_state(vault_id,total_shares,total_hny,last_compound_ms,apr_pct) VALUES (?,0,0,0,?)`,
        [vaultId, vault.baseApr]);
      state = await get(db, `SELECT * FROM vault_state WHERE vault_id=?`, [vaultId]);
    }

    const sp = sharePrice(state);
    const shares = amount / sp;

    // Deduct HNY
    await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [amount, wallet]);

    // Record deposit
    await run(db,
      `INSERT INTO vault_deposits(id,wallet,vault_id,hny_deposited,shares_issued,deposited_at_ms) VALUES (?,?,?,?,?,?)`,
      [uuidv4(), wallet, vaultId, amount, shares, Date.now()]);

    // Update vault state
    await run(db,
      `UPDATE vault_state SET total_shares=total_shares+?, total_hny=total_hny+? WHERE vault_id=?`,
      [shares, amount, vaultId]);

    return res.status(201).json({
      success: true, vaultId, depositedHny: amount, sharesIssued: shares, sharePrice: sp,
    });
  } catch (e) {
    console.error('vault deposit error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /vaults/withdraw ─────────────────────────────────────────────────────

router.post('/withdraw', async (req, res) => {
  try {
    const { wallet, vaultId, sharesAmount, mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!wallet || !vaultId || !sharesAmount || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const shares = Number(sharesAmount);
    if (shares <= 0) return res.status(400).json({ error: 'shares must be positive' });

    // Verify signature
    const message = `vault_withdraw|${wallet}|${vaultId}|${shares}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db = await openDb();

    // Check user has enough shares
    const dep = await get(db,
      `SELECT SUM(shares_issued) as totalShares FROM vault_deposits WHERE wallet=? AND vault_id=?`,
      [wallet, vaultId]);
    const userShares = Number(dep?.totalShares || 0);
    if (userShares < shares) return res.status(400).json({ error: 'Insufficient vault shares' });

    const state = await get(db, `SELECT * FROM vault_state WHERE vault_id=?`, [vaultId]);
    const sp    = sharePrice(state);
    const hnyOut = shares * sp;

    // Update vault state
    await run(db,
      `UPDATE vault_state SET total_shares=total_shares-?, total_hny=total_hny-? WHERE vault_id=?`,
      [shares, hnyOut, vaultId]);

    // Record as negative deposit (withdrawal)
    await run(db,
      `INSERT INTO vault_deposits(id,wallet,vault_id,hny_deposited,shares_issued,deposited_at_ms) VALUES (?,?,?,?,?,?)`,
      [uuidv4(), wallet, vaultId, -hnyOut, -shares, Date.now()]);

    // Credit HNY to wallet
    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [hnyOut, wallet]);

    return res.json({ success: true, vaultId, sharesRedeemed: shares, hnyReceived: hnyOut, sharePrice: sp });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /vaults/lock ─────────────────────────────────────────────────────────

router.post('/lock', async (req, res) => {
  try {
    const { wallet, amountHny, lockDays, mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!wallet || !amountHny || lockDays === undefined || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const amount = Number(amountHny);
    const days   = Number(lockDays);
    if (amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

    const tier = LOCK_TIERS.find(t => t.days === days);
    if (!tier) return res.status(400).json({ error: `Invalid lock period. Valid: ${LOCK_TIERS.map(t=>t.days).join(',')}` });

    const message = `vault_lock|${wallet}|${amount}|${days}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db = await openDb();
    const account = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
    if (Number(account?.balance || 0) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const now = Date.now();
    const unlockAtMs = days === 0 ? now : now + days * 24 * 3600 * 1000;
    const lockId = uuidv4();

    await run(db, `UPDATE accounts SET balance=balance-? WHERE wallet=?`, [amount, wallet]);
    await run(db,
      `INSERT INTO hny_locks(id,wallet,amount_hny,lock_days,multiplier,locked_at_ms,unlock_at_ms,status,reward_accrued_hny,penalty_hny)
       VALUES (?,?,?,?,?,?,?,'locked',0,0)`,
      [lockId, wallet, amount, days, tier.multiplier, now, unlockAtMs]);

    return res.status(201).json({
      success: true, lockId, amountHny: amount, lockDays: days,
      multiplier: tier.multiplier, unlockAtMs,
      effectiveApr: 5.0 * tier.multiplier,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /vaults/unlock ───────────────────────────────────────────────────────

router.post('/unlock', async (req, res) => {
  try {
    const { wallet, lockId, mldsaPubKeyHex, signatureHex, ts } = req.body;
    if (!wallet || !lockId || !mldsaPubKeyHex || !signatureHex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const message = `vault_unlock|${wallet}|${lockId}|${ts}`;
    const { ok } = await verifyMLDSASignature({ mldsaPubKeyHex, message, signatureHex });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    const db   = await openDb();
    const lock = await get(db, `SELECT * FROM hny_locks WHERE id=? AND wallet=?`, [lockId, wallet]);
    if (!lock) return res.status(404).json({ error: 'Lock not found' });
    if (lock.status !== 'locked') return res.status(400).json({ error: 'Lock already unlocked' });

    const now       = Date.now();
    const isEarly   = now < lock.unlock_at_ms;
    const penalty   = isEarly ? Number(lock.reward_accrued_hny) * EARLY_UNLOCK_PENALTY : 0;
    const returnHny = Number(lock.amount_hny) + Number(lock.reward_accrued_hny) - penalty;

    await run(db,
      `UPDATE hny_locks SET status=?, penalty_hny=? WHERE id=?`,
      [isEarly ? 'early_unlocked' : 'unlocked', penalty, lockId]);

    await run(db, `UPDATE accounts SET balance=balance+? WHERE wallet=?`, [returnHny, wallet]);

    return res.json({
      success: true, lockId, returnedHny: returnHny, penaltyHny: penalty,
      rewardHny: Number(lock.reward_accrued_hny), isEarly,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Background: compoundVaults() ─────────────────────────────────────────────

async function compoundVaults() {
  try {
    const db  = await openDb();
    const now = Date.now();

    for (const vault of VAULTS) {
      const state = await get(db, `SELECT * FROM vault_state WHERE vault_id=?`, [vault.id]);
      if (!state || state.total_hny <= 0) continue;

      const lastMs  = Number(state.last_compound_ms) || now;
      const elapsedYears = (now - lastMs) / (365.25 * 24 * 3600 * 1000);
      const aprDecimal   = vault.baseApr / 100;
      const accrued      = state.total_hny * (Math.exp(aprDecimal * elapsedYears) - 1);

      if (accrued < 0.0001) continue;

      // Add accrued to vault (increases share price)
      await run(db,
        `UPDATE vault_state SET total_hny=total_hny+?, last_compound_ms=? WHERE vault_id=?`,
        [accrued, now, vault.id]);

      // Notify depositors
      const depositors = await all(db,
        `SELECT DISTINCT wallet FROM vault_deposits WHERE vault_id=?`, [vault.id]);
      for (const { wallet } of depositors) {
        await run(db,
          `INSERT INTO notifications(wallet,type,title,body,link_href,created_at_ms) VALUES (?,?,?,?,?,?)`,
          [wallet, 'vault_compound', '🏦 Vault Compounded',
            `${vault.name} compounded +${accrued.toFixed(4)} HNY. Your share value increased.`,
            '/vaults', now]).catch(() => {});
      }

      // Accrue rewards for active locks
      const activeLocks = await all(db, `SELECT * FROM hny_locks WHERE status='locked'`, []);
      for (const lock of activeLocks) {
        const lockElapsed = (now - Number(lock.locked_at_ms)) / (365.25 * 24 * 3600 * 1000);
        const lockApr     = 5.0 * lock.multiplier / 100;
        const lockAccrued = Number(lock.amount_hny) * lockApr * lockElapsed - Number(lock.reward_accrued_hny);
        if (lockAccrued > 0) {
          await run(db, `UPDATE hny_locks SET reward_accrued_hny=reward_accrued_hny+? WHERE id=?`,
            [lockAccrued, lock.id]).catch(() => {});
        }
      }

      console.log(`🏦 ${vault.name} compounded +${accrued.toFixed(4)} HNY`);
    }
  } catch (e) {
    console.error('compoundVaults error:', e);
  }
}

module.exports = { router, compoundVaults, VAULT_COMPOUND_MS };
