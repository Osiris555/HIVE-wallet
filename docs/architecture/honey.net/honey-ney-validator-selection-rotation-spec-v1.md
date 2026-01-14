🐝 Honey.net Validator Selection & Rotation Specification (FROZEN)

Status: 🔒 ARCHITECTURE LOCKED
Applies to: Testnet → Mainnet
Consensus Model: Proof-of-Stake with deterministic rotation
Design Goals:

Decentralization

Predictable rewards

Fast finality

Sybil resistance

Tip-friendly, high-velocity throughput

1️⃣ Validator Roles

Honey.net distinguishes three roles, all stake-backed.

1. Block Proposer

Proposes the next block

Selected deterministically per slot

2. Block Attesters

Verify block validity

Sign block confirmation

3. Backup Validators

Standby validators

Replace slashed or offline validators

2️⃣ Validator Set Size (LOCKED)
Network	Active Validators
Testnet	21
Mainnet (Phase 1)	69
Mainnet (Phase 2)	169

These numbers balance decentralization and sub-3s finality.

3️⃣ Validator Eligibility Rules

A node may become a validator only if:

✔ Minimum stake met
✔ Full node synced
✔ Public validator key registered
✔ Slashing bond deposited
✔ Uptime ≥ 98% (rolling window)

4️⃣ Minimum Stake (LOCKED)
Network	Minimum Stake
Testnet	10,000 HNY
Mainnet	50,000 HNY

Stake is:

Locked

Non-transferable

Slashable

5️⃣ Validator Selection Algorithm
🔒 Deterministic + Weighted Random

For each epoch:

Selection weight = stake × uptime score × reputation score


Validators are then shuffled deterministically using:

seed = hash(previous_block_hash + epoch_number)


This ensures:

No leader prediction

No manipulation

Same ordering on all nodes

6️⃣ Block Proposal Rotation
Slot Timing
Block time: 2 seconds
Epoch length: 300 blocks (~10 minutes)

Per Slot
slot N → validator[N % validatorSetSize]


No auctions.
No MEV bidding.
No bribing.

7️⃣ Attestation Rules

Each block requires:

Requirement	Value
Attesters	≥ 67% of active set
Signatures	Aggregated
Timeout	1 slot

If quorum not reached:
➡ Slot skipped
➡ Next validator proceeds

8️⃣ Finality Model

Honey.net uses Fast Finality:

State	Blocks
Pending	0
Confirmed	1
Finalized	3

Finality ≈ 6 seconds

This is critical for:

Tipping

Live streaming payments

Creator UX

9️⃣ Validator Rotation (LOCKED)

Rotation occurs every epoch.

Rules

Bottom 10% (by performance) rotated out

Top standby validators rotated in

No validator can be removed arbitrarily

Rotation is:

Automatic

Transparent

Non-political

🔟 Slashing Rules (SUMMARY)

Validators are slashed if they:

✖ Double sign
✖ Propose invalid block
✖ Remain offline > threshold
✖ Censor transactions

Slashing Penalties
Violation	Slash
Minor	1–5% stake
Severe	10–50% stake
Malicious	100% + permanent ban

Slashed stake is redistributed:

60% validators

30% staking pool

10% treasury

(As you designed — now protocol-enforced.)

1️⃣1️⃣ Validator Rewards (LOCKED)

Rewards per block:

Destination	%
Block proposer	20%
Attesters	40%
Staking pool	30%
Treasury	10%

Gas fees follow the same split.

1️⃣2️⃣ Validator Identity & Transparency

Each validator exposes:

Validator {
  address,
  stake,
  uptime,
  reputation,
  blocksProposed,
  blocksSigned,
  slashes
}


This enables:

Public dashboards

Creator trust

Community governance

1️⃣3️⃣ Validator Exit Rules

A validator may exit only if:

✔ No pending slashing
✔ Exit delay completed
✔ Stake unlock delay passed

Exit Delay
Testnet: 1 epoch
Mainnet: 7 epochs


Prevents rage-quitting attacks.

🔒 FINAL LOCK STATEMENT

Validator selection & rotation rules are now frozen.

Any modification requires:

Governance proposal

Validator supermajority

Advance notice period