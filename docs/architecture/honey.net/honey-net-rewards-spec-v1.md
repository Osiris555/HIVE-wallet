.

🐝 Honey.net Rewards Specification (FROZEN)

Status: 🔒 ARCHITECTURE LOCKED
Applies to: Testnet → Mainnet
Scope:

Block rewards

Gas fee redistribution

Staking rewards

Validator incentives

Treasury funding

This spec assumes:

PoS validators (already frozen)

EIP-1559–style gas (already frozen)

Fast finality (already frozen)

1️⃣ Reward Sources (LOCKED)

Honey.net has three reward inflows:

A. Block Issuance (Inflation)

New HNY minted per block

Predictable, capped, decaying over time

B. Gas Fees

Paid in HNY

Dynamic, percentage-based

Split across ecosystem

C. Slashing Redistribution

Penalties from misbehaving validators

Recycled into the system

2️⃣ Block Issuance Schedule
Initial Issuance (Testnet / Early Mainnet)
Block time: 2 seconds
Blocks per day: ~43,200

Initial Block Reward
1.0 HNY per block


This is intentionally modest to avoid runaway inflation.

Annual Inflation Target (LOCKED)
Phase	Inflation
Year 1	≤ 5%
Year 2	≤ 3%
Long-term	≤ 1%

Block rewards decay automatically via epoch schedule.

3️⃣ Gas Fee Redistribution (LOCKED)

All gas fees (base + priority tip) are redistributed, not burned.

Gas Fee Split (as you designed)
Destination	%
Validators	60%
Staking Pool	30%
Treasury	10%

This applies to:

Transfers

Tips

Smart actions

NFT / token ops (future)

4️⃣ Block Reward Distribution (LOCKED)

Each block’s issuance is split as follows:

Recipient	%
Block Proposer	20%
Attesting Validators	40%
Staking Pool	30%
Treasury	10%

This mirrors gas distribution for economic symmetry.

5️⃣ Staking Pool Rewards

The staking pool aggregates:

✔ 30% of block issuance
✔ 30% of all gas fees
✔ Portion of slashed stake

Who earns staking rewards?

Non-validator stakers

Delegators

DAO pools

Ecosystem incentive programs

Distribution Model
Reward ∝ amount staked × time staked


Rewards accrue per epoch, not per block.

6️⃣ Validator Rewards (Detailed)
Validator earns from:
Source	Description
Proposal reward	Fixed %
Attestation reward	Signature-based
Gas fees	Weighted by participation
Slashing share	If honest

Validators with:

Higher uptime

More signatures

Fewer misses

➡ earn proportionally more

7️⃣ Reward Claiming Rules
Validators

Rewards auto-accrue

Claimable per epoch

Claiming does NOT reset stake lock

Stakers

Rewards accrue continuously

Claimable anytime

Optional auto-compound

8️⃣ Reward Finality

Rewards are:

State	Description
Pending	Earned but reversible
Confirmed	1 block
Finalized	After 3 blocks

Once finalized:
➡ Cannot be revoked
➡ Cannot be slashed retroactively

9️⃣ Slashing Redistribution (LOCKED)

When stake is slashed:

Destination	%
Honest validators	60%
Staking pool	30%
Treasury	10%

This creates economic defense:

Attackers fund honest actors

Community benefits from enforcement

🔟 Treasury Rewards (LOCKED)

Treasury receives:

✔ 10% block issuance
✔ 10% gas fees
✔ 10% slashing penalties


Treasury funds:

Grants

Dev tooling

Gas subsidies (e.g. QueenBeeCams memberships)

Ecosystem growth

Treasury funds cannot be minted arbitrarily.

1️⃣1️⃣ Gas Subsidies & Memberships (SUPPORTED)

Your idea is fully compatible and first-class.

Example:

QueenBeeCams Pro Membership

Platform covers base gas

User pays 0 gas for tips

Protocol behavior:

Gas paid by platform wallet
Rewards still distributed normally


No protocol changes required.

1️⃣2️⃣ Rewards Transparency (REQUIRED)

All rewards are recorded as transactions:

{
  type: "REWARD",
  source: "BLOCK | GAS | SLASH",
  to: "WALLET",
  amount,
  block,
  epoch
}


Users see:

Pending rewards

Confirmed rewards

Finalized rewards

1️⃣3️⃣ Anti-Gaming Protections

Rewards are reduced if validator:

✖ Misses slots
✖ Late attestations
✖ Low uptime


Zero tolerance for:

Self-dealing

Fake staking loops

Wash activity

🔒 FINAL LOCK STATEMENT

The Honey.net Rewards System is now frozen.

Changes require:

Governance proposal

Validator supermajority

Notice period