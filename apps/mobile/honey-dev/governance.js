// apps/mobile/honey-dev/governance.js
// DAO Governance Router — Phase H6b
// Stake-weighted voting (sqrt model), proposal lifecycle, DAO treasury.
"use strict";

const express = require("express");
const crypto  = require("crypto");
const { openDb, run, get, all } = require("./db");

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────
const GOVERNANCE_TREASURY = "HNY_GOVERNANCE_TREASURY";
const PROPOSAL_BOND       = 50_000;   // HNY required to submit draft to active
const MIN_STAKED_TO_DRAFT = 10_000;   // HNY staked required to create a draft
const VOTING_WINDOW_MS    = 7 * 24 * 3600 * 1000; // 7 days
const QUORUM_PCT          = 0.20;     // 20% of total VP
const PASS_THRESHOLD      = 0.667;    // 66.7% YES (of YES+NO)
const MAX_VP_PCT          = 0.05;     // 5% cap per entity

const TIMELOCK_MS = {
  parameter_change:    48 * 3600 * 1000,
  protocol_upgrade:    7 * 24 * 3600 * 1000,
  emergency:           12 * 3600 * 1000,
  treasury_allocation: 48 * 3600 * 1000,
};

const PROPOSAL_TYPES = ['parameter_change', 'treasury_allocation', 'protocol_upgrade', 'emergency'];

// ── ML-DSA-65 verification ────────────────────────────────────────────────
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

// Staked HNY for a wallet = SUM of active staking_positions principals
async function getStakedHny(db, wallet) {
  const row = await get(db,
    `SELECT COALESCE(SUM(principal), 0) AS staked FROM staking_positions WHERE wallet=? AND status='active'`,
    [wallet]
  );
  return Number(row?.staked || 0);
}

// Total voting power across the network (sum of sqrt of each wallet's stake)
async function getTotalVP(db) {
  const rows = await all(db,
    `SELECT wallet, SUM(principal) AS staked FROM staking_positions WHERE status='active' GROUP BY wallet`,
    []
  );
  return rows.reduce((sum, r) => sum + Math.sqrt(Number(r.staked || 0)), 0);
}

// Voting power for a single wallet, optionally capped by 5% of totalVP
async function getVotingPower(db, wallet, totalVP) {
  const staked = await getStakedHny(db, wallet);
  const vp = Math.sqrt(staked);
  const cap = (totalVP || 0) * MAX_VP_PCT;
  return cap > 0 ? Math.min(vp, cap) : vp;
}

// Format a proposal row for API response
function formatProposal(p) {
  const totalCastVP = p.yes_vp + p.no_vp + p.abstain_vp;
  return {
    id:               p.id,
    proposerWallet:   p.proposer_wallet,
    title:            p.title,
    description:      p.description,
    type:             p.type,
    status:           p.status,
    bondHny:          p.bond_hny,
    yesVp:            p.yes_vp,
    noVp:             p.no_vp,
    abstainVp:        p.abstain_vp,
    totalVpSnapshot:  p.total_vp_snapshot,
    metadataJson:     p.metadata_json || null,
    draftAtMs:        p.draft_at_ms,
    submittedAtMs:    p.submitted_at_ms || null,
    votingEndsAtMs:   p.voting_ends_at_ms || null,
    timelockEndsAtMs: p.timelock_ends_at_ms || null,
    executedAtMs:     p.executed_at_ms || null,
    cancelledAtMs:    p.cancelled_at_ms || null,
    failReason:       p.fail_reason || null,
    // computed
    quorumPct:        p.total_vp_snapshot > 0 ? totalCastVP / p.total_vp_snapshot : 0,
    passPct:          (p.yes_vp + p.no_vp) > 0 ? p.yes_vp / (p.yes_vp + p.no_vp) : 0,
  };
}

function formatVote(v) {
  return {
    id:           v.id,
    proposalId:   v.proposal_id,
    voterWallet:  v.voter_wallet,
    vote:         v.vote,
    votingPower:  v.voting_power,
    votedAtMs:    v.voted_at_ms,
  };
}

function formatTreasuryTx(t) {
  return {
    id:           t.id,
    proposalId:   t.proposal_id || null,
    type:         t.type,
    wallet:       t.wallet,
    amount:       t.amount,
    description:  t.description || null,
    createdAtMs:  t.created_at_ms,
  };
}

// ── GET /governance/proposals ─────────────────────────────────────────────
router.get("/proposals", async (req, res) => {
  try {
    const db     = await openDb();
    const status = req.query.status;
    const limit  = Math.min(parseInt(req.query.limit || "100"), 200);
    let rows;
    if (status && status !== 'all') {
      rows = await all(db,
        `SELECT * FROM dao_proposals WHERE status=? ORDER BY draft_at_ms DESC LIMIT ?`,
        [status, limit]
      );
    } else {
      rows = await all(db,
        `SELECT * FROM dao_proposals ORDER BY draft_at_ms DESC LIMIT ?`,
        [limit]
      );
    }
    return res.json({ proposals: rows.map(formatProposal) });
  } catch (e) {
    console.error("[governance] GET /proposals error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /governance/proposal/:id ──────────────────────────────────────────
router.get("/proposal/:id", async (req, res) => {
  try {
    const db = await openDb();
    const p  = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [req.params.id]);
    if (!p) return res.status(404).json({ error: "Proposal not found" });
    const votes = await all(db,
      `SELECT * FROM dao_votes WHERE proposal_id=? ORDER BY voted_at_ms DESC`,
      [p.id]
    );
    return res.json({ proposal: formatProposal(p), votes: votes.map(formatVote) });
  } catch (e) {
    console.error("[governance] GET /proposal/:id error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /governance/votes/:proposalId ─────────────────────────────────────
router.get("/votes/:proposalId", async (req, res) => {
  try {
    const db    = await openDb();
    const votes = await all(db,
      `SELECT * FROM dao_votes WHERE proposal_id=? ORDER BY voted_at_ms DESC`,
      [req.params.proposalId]
    );
    return res.json({ votes: votes.map(formatVote) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /governance/my-votes/:wallet ──────────────────────────────────────
router.get("/my-votes/:wallet", async (req, res) => {
  try {
    const db    = await openDb();
    const votes = await all(db,
      `SELECT * FROM dao_votes WHERE voter_wallet=? ORDER BY voted_at_ms DESC`,
      [req.params.wallet]
    );
    return res.json({ votes: votes.map(formatVote) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /governance/voting-power/:wallet ──────────────────────────────────
router.get("/voting-power/:wallet", async (req, res) => {
  try {
    const db      = await openDb();
    const wallet  = req.params.wallet;
    const staked  = await getStakedHny(db, wallet);
    const totalVP = await getTotalVP(db);
    const vp      = await getVotingPower(db, wallet, totalVP);
    return res.json({
      wallet,
      stakedHny:   staked,
      votingPower: vp,
      vpPct:       totalVP > 0 ? vp / totalVP : 0,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /governance/stats ─────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const db = await openDb();
    const [totRow, activeRow, passRow, rejRow, execRow, votesRow, treRow, vpRow] = await Promise.all([
      get(db, `SELECT COUNT(*) AS n FROM dao_proposals`, []),
      get(db, `SELECT COUNT(*) AS n FROM dao_proposals WHERE status='active'`, []),
      get(db, `SELECT COUNT(*) AS n FROM dao_proposals WHERE status='timelocked'`, []),
      get(db, `SELECT COUNT(*) AS n FROM dao_proposals WHERE status='rejected'`, []),
      get(db, `SELECT COUNT(*) AS n FROM dao_proposals WHERE status='executed'`, []),
      get(db, `SELECT COUNT(*) AS n FROM dao_votes`, []),
      get(db, `SELECT balance FROM accounts WHERE wallet=?`, [GOVERNANCE_TREASURY]),
      all(db, `SELECT wallet, SUM(principal) AS staked FROM staking_positions WHERE status='active' GROUP BY wallet`, []),
    ]);
    const totalVP = vpRow.reduce((s, r) => s + Math.sqrt(Number(r.staked || 0)), 0);
    return res.json({
      totalProposals:    Number(totRow?.n || 0),
      activeProposals:   Number(activeRow?.n || 0),
      passedProposals:   Number(passRow?.n || 0),
      rejectedProposals: Number(rejRow?.n || 0),
      executedProposals: Number(execRow?.n || 0),
      totalVotesCast:    Number(votesRow?.n || 0),
      treasuryBalanceHny: Number(treRow?.balance || 0),
      totalVpLocked:     totalVP,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /governance/treasury ──────────────────────────────────────────────
router.get("/treasury", async (req, res) => {
  try {
    const db      = await openDb();
    const treRow  = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [GOVERNANCE_TREASURY]);
    const recentTxs = await all(db,
      `SELECT * FROM dao_treasury_txs ORDER BY created_at_ms DESC LIMIT 20`,
      []
    );
    return res.json({
      balanceHny: Number(treRow?.balance || 0),
      recentTxs:  recentTxs.map(formatTreasuryTx),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /governance/draft ────────────────────────────────────────────────
router.post("/draft", async (req, res) => {
  try {
    const db = await openDb();
    const { wallet, title, type, description, metadataJson,
            signatureHex, ts } = req.body;

    if (!wallet || !title || !type || !description)
      return res.status(400).json({ error: "wallet, title, type, description required" });
    if (!PROPOSAL_TYPES.includes(type))
      return res.status(400).json({ error: `type must be one of: ${PROPOSAL_TYPES.join(', ')}` });

    // Verify ML-DSA-65 signature
    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!account?.mldsa_public_key)
      return res.status(403).json({ error: "Wallet not registered" });

    const message = `governance_draft|${wallet}|${title}|${type}|${description}|${ts}`;
    const sigCheck = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex,
    });
    if (!sigCheck.ok)
      return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    // Check staking threshold
    const staked = await getStakedHny(db, wallet);
    if (staked < MIN_STAKED_TO_DRAFT)
      return res.status(403).json({
        error: `Must have ≥ ${MIN_STAKED_TO_DRAFT.toLocaleString()} HNY staked to draft a proposal (you have ${staked.toFixed(2)})`,
      });

    const id = uid();
    const t  = now();
    await run(db,
      `INSERT INTO dao_proposals (id, proposer_wallet, title, description, type, status, metadata_json, draft_at_ms)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [id, wallet, title.slice(0, 200), description.slice(0, 4000), type,
       metadataJson ? JSON.stringify(metadataJson) : null, t]
    );

    const row = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [id]);
    return res.status(201).json({ proposal: formatProposal(row) });
  } catch (e) {
    console.error("[governance] POST /draft error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /governance/submit/:id ───────────────────────────────────────────
router.post("/submit/:id", async (req, res) => {
  try {
    const db = await openDb();
    const { wallet, signatureHex, ts } = req.body;
    const proposalId = req.params.id;

    const proposal = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [proposalId]);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.proposer_wallet !== wallet)
      return res.status(403).json({ error: "Only proposer can submit" });
    if (proposal.status !== 'draft')
      return res.status(400).json({ error: `Proposal is already ${proposal.status}` });

    // Verify signature
    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!account?.mldsa_public_key)
      return res.status(403).json({ error: "Wallet not registered" });

    const message = `governance_submit|${wallet}|${proposalId}|${ts}`;
    const sigCheck = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex,
    });
    if (!sigCheck.ok)
      return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    // Check balance
    const walletRow = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [wallet]);
    const balance   = Number(walletRow?.balance || 0);
    if (balance < PROPOSAL_BOND)
      return res.status(400).json({
        error: `Insufficient balance — need ${PROPOSAL_BOND.toLocaleString()} HNY bond (have ${balance.toFixed(2)})`,
      });

    const t       = now();
    const totalVP = await getTotalVP(db);

    // Deduct bond from proposer, credit to treasury
    await run(db, `UPDATE accounts SET balance = balance - ? WHERE wallet=?`, [PROPOSAL_BOND, wallet]);
    await run(db, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [PROPOSAL_BOND, GOVERNANCE_TREASURY]);
    await run(db,
      `INSERT INTO dao_treasury_txs (id, proposal_id, type, wallet, amount, description, created_at_ms)
       VALUES (?, ?, 'bond_received', ?, ?, ?, ?)`,
      [uid(), proposalId, wallet, PROPOSAL_BOND, `Bond for proposal: ${proposal.title}`, t]
    );

    // Move to active
    await run(db,
      `UPDATE dao_proposals SET status='active', submitted_at_ms=?, voting_ends_at_ms=?, total_vp_snapshot=?
       WHERE id=?`,
      [t, t + VOTING_WINDOW_MS, totalVP, proposalId]
    );

    const updated = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [proposalId]);
    return res.json({ proposal: formatProposal(updated) });
  } catch (e) {
    console.error("[governance] POST /submit/:id error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /governance/vote ─────────────────────────────────────────────────
router.post("/vote", async (req, res) => {
  try {
    const db = await openDb();
    const { wallet, proposalId, vote, signatureHex, ts } = req.body;

    if (!wallet || !proposalId || !vote)
      return res.status(400).json({ error: "wallet, proposalId, vote required" });
    if (!['yes','no','abstain'].includes(vote))
      return res.status(400).json({ error: "vote must be 'yes', 'no', or 'abstain'" });

    const proposal = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [proposalId]);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.status !== 'active')
      return res.status(400).json({ error: `Proposal is not active (status: ${proposal.status})` });
    if (now() > proposal.voting_ends_at_ms)
      return res.status(400).json({ error: "Voting period has ended" });

    // Verify signature
    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    if (!account?.mldsa_public_key)
      return res.status(403).json({ error: "Wallet not registered" });

    const message = `governance_vote|${wallet}|${proposalId}|${vote}|${ts}`;
    const sigCheck = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex,
    });
    if (!sigCheck.ok)
      return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    // Compute VP (capped at 5% of snapshot)
    const staked = await getStakedHny(db, wallet);
    let vp = Math.sqrt(staked);
    if (proposal.total_vp_snapshot > 0) {
      const cap = proposal.total_vp_snapshot * MAX_VP_PCT;
      vp = Math.min(vp, cap);
    }
    if (vp <= 0)
      return res.status(403).json({ error: "No staked HNY — voting power is 0" });

    const t = now();
    try {
      await run(db,
        `INSERT INTO dao_votes (id, proposal_id, voter_wallet, vote, voting_power, voted_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uid(), proposalId, wallet, vote, vp, t]
      );
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: "You have already voted on this proposal" });
      }
      throw e;
    }

    // Update tally
    const col = vote === 'yes' ? 'yes_vp' : vote === 'no' ? 'no_vp' : 'abstain_vp';
    await run(db, `UPDATE dao_proposals SET ${col} = ${col} + ? WHERE id=?`, [vp, proposalId]);

    const updated = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [proposalId]);
    return res.json({ proposal: formatProposal(updated), votingPower: vp });
  } catch (e) {
    console.error("[governance] POST /vote error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /governance/cancel/:id ───────────────────────────────────────────
router.post("/cancel/:id", async (req, res) => {
  try {
    const db = await openDb();
    const { wallet, signatureHex, ts } = req.body;
    const proposalId = req.params.id;

    const proposal = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [proposalId]);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });
    if (proposal.proposer_wallet !== wallet)
      return res.status(403).json({ error: "Only proposer can cancel" });
    if (proposal.status !== 'draft')
      return res.status(400).json({ error: "Only draft proposals can be cancelled" });

    const account = await get(db, `SELECT mldsa_public_key FROM accounts WHERE wallet=?`, [wallet]);
    const message = `governance_cancel|${wallet}|${proposalId}|${ts}`;
    const sigCheck = await verifyMLDSASignature({
      mldsaPubKeyHex: account.mldsa_public_key, message, signatureHex,
    });
    if (!sigCheck.ok)
      return res.status(403).json({ error: `Invalid signature: ${sigCheck.error}` });

    await run(db,
      `UPDATE dao_proposals SET status='cancelled', cancelled_at_ms=? WHERE id=?`,
      [now(), proposalId]
    );
    const updated = await get(db, `SELECT * FROM dao_proposals WHERE id=?`, [proposalId]);
    return res.json({ proposal: formatProposal(updated) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Background job: processGovernance ─────────────────────────────────────
async function processGovernance() {
  const db = await openDb();
  const t  = now();

  // 1. Close voting on active proposals past deadline
  const expiredActive = await all(db,
    `SELECT * FROM dao_proposals WHERE status='active' AND voting_ends_at_ms <= ?`,
    [t]
  );
  for (const p of expiredActive) {
    const totalCast = p.yes_vp + p.no_vp + p.abstain_vp;
    const quorum    = p.total_vp_snapshot > 0 ? totalCast / p.total_vp_snapshot : 0;
    const yesNo     = p.yes_vp + p.no_vp;
    const passPct   = yesNo > 0 ? p.yes_vp / yesNo : 0;

    if (quorum < QUORUM_PCT) {
      await run(db,
        `UPDATE dao_proposals SET status='rejected', fail_reason=? WHERE id=?`,
        [`Quorum not met (${(quorum * 100).toFixed(1)}% < ${(QUORUM_PCT * 100)}% required)`, p.id]
      );
      console.log(`[governance] Proposal ${p.id} rejected: quorum not met (${(quorum*100).toFixed(1)}%)`);
    } else if (passPct < PASS_THRESHOLD) {
      await run(db,
        `UPDATE dao_proposals SET status='rejected', fail_reason=? WHERE id=?`,
        [`Threshold not met (${(passPct * 100).toFixed(1)}% YES < ${(PASS_THRESHOLD * 100)}% required)`, p.id]
      );
      console.log(`[governance] Proposal ${p.id} rejected: pass threshold not met (${(passPct*100).toFixed(1)}%)`);
    } else {
      const timelockMs = TIMELOCK_MS[p.type] || TIMELOCK_MS.parameter_change;
      await run(db,
        `UPDATE dao_proposals SET status='timelocked', timelock_ends_at_ms=? WHERE id=?`,
        [t + timelockMs, p.id]
      );
      console.log(`[governance] Proposal ${p.id} passed — entering timelock (${p.type})`);
    }
  }

  // 2. Execute timelocked proposals past timelock deadline
  const readyToExecute = await all(db,
    `SELECT * FROM dao_proposals WHERE status='timelocked' AND timelock_ends_at_ms <= ?`,
    [t]
  );
  for (const p of readyToExecute) {
    // If treasury_allocation, transfer funds
    if (p.type === 'treasury_allocation' && p.metadata_json) {
      try {
        const meta = JSON.parse(p.metadata_json);
        if (meta.recipient && meta.amount > 0) {
          const treRow = await get(db, `SELECT balance FROM accounts WHERE wallet=?`, [GOVERNANCE_TREASURY]);
          const treBalance = Number(treRow?.balance || 0);
          const transferAmt = Math.min(Number(meta.amount), treBalance);
          if (transferAmt > 0) {
            await run(db, `UPDATE accounts SET balance = balance - ? WHERE wallet=?`, [transferAmt, GOVERNANCE_TREASURY]);
            await run(db, `UPDATE accounts SET balance = balance + ? WHERE wallet=?`, [transferAmt, meta.recipient]);
            await run(db,
              `INSERT INTO dao_treasury_txs (id, proposal_id, type, wallet, amount, description, created_at_ms)
               VALUES (?, ?, 'withdrawal', ?, ?, ?, ?)`,
              [uid(), p.id, meta.recipient, transferAmt, `Treasury allocation: ${p.title}`, t]
            );
            console.log(`[governance] Treasury allocation executed: ${transferAmt} HNY → ${meta.recipient}`);
          }
        }
      } catch (e) {
        console.error(`[governance] Failed to parse metadata for ${p.id}:`, e.message);
      }
    }
    await run(db,
      `UPDATE dao_proposals SET status='executed', executed_at_ms=? WHERE id=?`,
      [t, p.id]
    );
    console.log(`[governance] Proposal ${p.id} executed`);
  }
}

module.exports = { router, GOVERNANCE_TREASURY, processGovernance };
