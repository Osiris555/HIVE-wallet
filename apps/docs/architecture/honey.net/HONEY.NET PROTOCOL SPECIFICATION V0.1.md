HONEY.NET PROTOCOL SPECIFICATION
Version 0.1 — Non-Economic Testnet
1. Scope

This specification defines the Honey.Net blockchain protocol for non-economic testnet deployment.

Goals:

Validate account-based state model

Validate staking mechanics

Validate Chrysalis identity anchoring

Validate wallet-to-chain interaction

Validate block production and finality

Non-goals:

Token sale

Economic mainnet

Bridge support

Full DAO governance

2. Network Model

Honey.Net v0.1 is:

Account-based

Authority-based Proof of Stake (Testnet)

3–5 validator nodes

Fixed validator set for v0.1

3. Accounts & Addresses

Address format:

Testnet:

HNY_<hex-encoded-public-key-hash>


Mainnet (future):

hny_<hex-encoded-public-key-hash>


Address derivation:

address = prefix + sha256(public_key)[0:40]


Accounts store:

balance

nonce

stakePositions[]

pendingUnlocks[]

4. Transaction Structure

All transactions contain:

{
  chainId: number,
  nonce: number,
  from: address,
  to: address | null,
  value: uint64,
  gasLimit: uint64,
  gasPrice: uint64,
  serviceFee: uint64,
  walletFee: uint64,
  data: bytes | null,
  signature: bytes
}


Signature:

Ed25519 (current testnet)

PQC migration path defined in Chrysalis layer

Validation rules:

nonce must match account.nonce

balance >= value + gas + fees

signature valid

5. Fees

Three fee types:

Gas Fee → Paid to validator

Service Fee → Paid to protocol treasury

Wallet Fee → Paid to HIVE Inc. wallet address

Wallet fee must be explicitly declared.

6. Native Asset — HONEY (Testnet)

Testnet token:

Mintable via faucet endpoint

No economic value

Used for:

Transfers

Staking

Fee simulation

7. Staking Model

Stake Options:

30 days → 3 day unlock

60 days → 7 day unlock

90 days → 7 day unlock

Reward Rate:

6% APR (testnet constant)

Rewards:

Accrue continuously while staked

No accrual during unlock

Claimable anytime (gas required)

Unlock:

Moves stake to pendingUnlock

Rewards cease

Withdrawable after unlock period

No slashing in v0.1.

8. Consensus

Authority-based PoS:

Fixed validator set

Round-robin block proposal

2/3 validator signature finality

No dynamic validator selection in v0.1

9. Chrysalis Anchoring

Blockchain stores:

Public keys

Identity commitments (hashes)

Content hashes

Pointer references

Blockchain does NOT store:

Bulk media

Documents

Encrypted shards

10. Testnet Success Criteria

v0.1 is successful if:

Wallet can send/receive

Staking works as defined

Blocks finalize

Identity hashes anchor correctly

3–5 nodes maintain stable network