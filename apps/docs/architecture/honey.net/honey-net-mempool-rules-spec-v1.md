🐝 Honey.net Mempool Rules Specification (FROZEN)

Status: 🔒 ARCHITECTURE LOCKED
Applies to: Testnet → Mainnet
Layer: Consensus-critical (soft-fork resistant)

1️⃣ Purpose of the Mempool

The mempool is the pre-consensus transaction staging area.

It:

Holds valid but unconfirmed transactions

Enforces anti-spam + fairness

Orders transactions for block proposal

Enables fast UX for high-velocity payments (tips)

2️⃣ Mempool Admission Rules (STRICT)

A transaction MUST be rejected if any rule fails.

✅ Required Conditions
✔ Valid signature
✔ Correct nonce
✔ Sufficient balance (amount + maxFee)
✔ GasLimit ≥ intrinsic gas
✔ maxFee ≥ baseGas
✔ priorityFee ≥ 0 (user-controlled)
✔ Wallet not rate-limited

3️⃣ Gas Rules (LOCKED)
Minimums
Parameter	Value
Base gas	0.00000001 HNY (1 Honey Cone)
Min priority fee	0 HNY (user-controlled)
Max gas per tx	BlockGasLimit × 0.2

This allows microtransactions even at trillion-dollar network scale.

4️⃣ Dynamic Fee Enforcement

If:

maxFee < current baseGas


➡ Transaction is rejected immediately

If:

priorityFee too low


➡ Transaction accepted but low priority

5️⃣ Per-Wallet Rate Limiting

To prevent spam while preserving UX:

Rule	Limit
Pending tx per wallet	50
Tx per second	10
Faucet tx	1 per cooldown

Violations result in:

Temporary rejection

NOT permanent bans

6️⃣ Replacement Rules (Nonce-Based)

Honey.net supports Replace-By-Fee (RBF).

A tx may replace another ONLY IF:

same wallet
same nonce
higher priorityFee (+10% minimum bump)


Otherwise:
❌ rejected

7️⃣ Global Mempool Capacity (IMPORTANT)
🔒 HARD LIMIT
MAX_MEMPOOL_TX = 100,000


This is a global safety valve, not a throughput cap.

Why this is OK

Blocks clear mempool every 2–3 seconds

High-value txs are prioritized

Low-fee spam is evicted first

8️⃣ Eviction Policy (LOCKED)

When mempool is full:

Evict lowest effective fee

Evict oldest timestamp

Evict nonces blocking newer txs

❌ NEVER evicted

Admin txs

Validator ops

Governance txs

9️⃣ Transaction States
CREATED → MEMPOOL → PENDING → INCLUDED → CONFIRMED → FINALIZED


If dropped:

MEMPOOL → DROPPED


Wallets must notify user if dropped.

🔟 Pending Transaction Visibility

Each tx exposes:

PendingTx {
  txId,
  from,
  to,
  amount,
  gasEstimate,
  effectiveFee,
  mempoolPosition,
  seenByValidators
}


This enables:

“Pending…” UX

Live confirmations

Tip animations (QueenBeeCams 👑🐝)

1️⃣1️⃣ Faucet-Specific Rules (Admin Mint)
Rule	Value
Faucet tx type	FAUCET
Admin-only	✅
Cooldown enforced	Protocol-level
Not replaceable	❌ RBF disabled
1️⃣2️⃣ Mempool Gossip Rules

Validators gossip transactions only if:

✔ Passed local validation
✔ Not already seen
✔ Fee above min relay fee


This prevents mempool flooding across the network.

1️⃣3️⃣ Deterministic Ordering (Pre-Block)

Before block proposal:

Sort by:
1. effectiveFee (desc)
2. timestamp (asc)
3. txId (asc)


This ensures:

Fairness

No MEV-style reordering

Identical block candidates across validators

🔒 FINAL LOCK STATEMENT

These mempool rules are frozen.

Any change:

Requires governance proposal

Requires validator supermajority

May require a fork depending on scope