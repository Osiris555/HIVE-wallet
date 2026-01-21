🟡 Honey.net Consensus Finality Rules

ARCHITECTURE FREEZE — v1

1️⃣ Finality Design Goals (Locked)

Honey.net finality must:

Support high-velocity micropayments

Prevent deep chain reorganizations

Be fast enough for UX, strong enough for value

Be deterministic (clear final state)

Scale from testnet → mainnet

2️⃣ Transaction State Lifecycle

Every transaction moves through four explicit states:

State	Meaning
PENDING	In mempool, not yet included
INCLUDED	Included in a proposed block
CONFIRMED	Block has validator attestations
FINALIZED	Cannot be reverted

These states are first-class protocol concepts, not UI guesses.

3️⃣ Block Confirmation Model

Honey.net uses a two-layer confirmation model:

Layer 1 — Fast Confirmation (Soft Finality)

Achieved via attestation quorum

Used for:

UI updates

Tipping

Micropayments

Instant feedback

Layer 2 — Economic Finality (Hard Finality)

Achieved after finality checkpoint

Used for:

Withdrawals

Bridges

Large value transfers

4️⃣ Attestation Quorum (Soft Finality)
Rules

A block is CONFIRMED when:

≥ 2/3 of attestation committee
sign the block hash

Properties

Happens in 1 block

Typical time: 1–3 seconds

Reversible only by massive slashing event

5️⃣ Finality Checkpoints (Hard Finality)
Epoch Structure

Blocks grouped into epochs

Example:

Epoch length: 32 blocks

Finality Rule

An epoch is FINALIZED when:

A checkpoint block is proposed

≥ 2/3 of total validator stake attests

The next epoch checkpoint builds on it

This is Casper-style finality (battle-tested).

6️⃣ Confirmation Counts (User-Facing)
Confirmations	Status	UX Meaning
0	Pending	Broadcast
1	Included	Seen on-chain
1 + quorum	Confirmed	Safe for tips
Epoch finalized	Final	Irreversible
Recommended UX Labels

Pending

Confirmed (1/1)

Finalized

7️⃣ Reorganization Rules (Reorgs)
Allowed Reorg Depth
Max reorg depth: 1–2 blocks

Forbidden

Reorgs past finalized checkpoint

Competing finalized chains

Consequence

Any validator attempting this:

Automatically slashed

Chain halts if threshold exceeded

8️⃣ Validator Slashing for Finality Violations
Slashable Offenses
Violation	Result
Signing conflicting blocks	Severe slash
Finality reversion attempt	Max slash
Withholding attestations	Moderate slash

Finality safety is economically enforced.

9️⃣ Transaction Guarantees
After CONFIRMED

Transaction visible

Balance updated

Tip shown to recipient

Reorg risk extremely low

After FINALIZED

Funds irrevocable

Eligible for:

Bridge transfer

Staking

Contract settlement

🔟 Gas & Finality Interaction

Gas is charged at inclusion

If block is reverted before confirmation:

Gas refunded

After confirmation:

Gas non-refundable

1️⃣1️⃣ Micropayment Optimization (QueenBeeCams)

For tips:

Accept CONFIRMED state as “complete”

Finality happens in background

Optional gas sponsorship applies

This is how Visa-like UX is achieved without sacrificing decentralization.

🔒 FINAL LOCK STATEMENT

A Honey.net transaction is economically confirmed after one attested block and absolutely final after epoch checkpoint finalization.
No finalized transaction can be reverted without slashing ≥⅔ of validator stake.