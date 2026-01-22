🐝 Honey Testnet v0 — Frozen Architecture

Status: FROZEN
Purpose: Deterministic testnet architecture leading directly to Honey.net mainnet
Scope: Protocol-level only

1️⃣ Network Model

Honey is an account-based blockchain

Deterministic state machine

Single canonical chain

Validators produce blocks

Transactions move through lifecycle states

2️⃣ Wallet & Identity
Wallet ID
type WalletAddress = string; // e.g. "HNY1_DEV_WALLET"


Wallets are string identifiers

Signature verification exists (can be mocked initially)

Nonce is enforced per wallet

3️⃣ Transaction (CANONICAL — NEVER CHANGE)
type Transaction = {
  txId: string;              // sha256 hash of tx payload
  from: WalletAddress;
  to: WalletAddress;
  amount: number;            // HNY
  gasFee: number;            // HNY
  nonce: number;
  timestamp: number;         // ms
  signature: string;         // hex or base64
  status: TxStatus;
};

Transaction Status
type TxStatus =
  | "pending"        // in mempool
  | "included"       // in a block
  | "confirmed"      // >= N confirmations
  | "failed";        // invalid / reverted

4️⃣ Transaction Types

All actions are transactions.

Action	Type
Faucet mint	SYSTEM_TX
Admin mint	SYSTEM_TX
Send HNY	USER_TX
Admin-only mint

Implemented as SYSTEM_TX

Only allowed from ADMIN wallet

Enforced at validation layer

5️⃣ Gas & Fees (Frozen Rules)
const GAS_PER_TX = 1;
const MIN_GAS_PRICE = 0.000001; // HNY


Sender must have: amount + gasFee

Gas fees are protocol revenue and are distributed to validators, staking and treasury pools.

🐝 Gas Fee Distribution Model (FROZEN EXTENSION)

Add this to the architecture without breaking anything.

New System Wallets
const SYSTEM_WALLETS = {
  VALIDATOR_POOL: "HNY_VALIDATOR_POOL",
  TREASURY: "HNY_TREASURY"
};


These wallets:

Cannot send user transactions

Only receive protocol funds

🔥 Gas Fee Flow (Authoritative)

When a transaction is included in a block:

Sender pays gasFee

gasFee is removed from sender balance

Gas is split by protocol rule

Example split (testnet default):

const GAS_DISTRIBUTION = {
  validator: 0.60, // 60%
  staking: 0.30,   // 30%
  treasury: 0.10   // 10%
};

🧮 Example

Transaction:

amount: 10 HNY
gasFee: 1 HNY


Distribution:

Validator pool → 0.60 HNY

Staking pool → 0.30 HNY

Treasury → 0.10 HNY

Total conserved: ✅ 1 HNY

🔐 Why This Is the Right Design
✅ Decentralization

Validators are economically incentivized

Delegators share rewards

Not reliant on inflation alone

✅ Community alignment

Stakers earn from real network usage

Treasury funds grants, dev, DAO ops

✅ Mainnet-compatible

This maps 1:1 with:

Ethereum fee recipients

Cosmos distribution module

Solana validator rewards

🧠 Where This Lives in Code (Conceptually)
During block application
state.balances[from] -= amount + gasFee;

state.balances[to] += amount;

state.balances[VALIDATOR_POOL] += gasFee * 0.6;
state.balances[STAKING_POOL]   += gasFee * 0.3;
state.balances[TREASURY]       += gasFee * 0.1;


(staking pool may be same as validator pool initially)

🧪 Testnet vs Mainnet
Testnet v0

Single validator

Gas still accumulated

Rewards may not yet be claimable

Testnet v1

Validator rotation

Reward accounting per validator

Mainnet

Delegation

Slashing

Dynamic gas market

🔒 Architecture Update (Addendum)

You can append this to the frozen doc as:

Gas fees are not burned.
Gas fees are protocol revenue and are distributed to validator, staking, and treasury pools according to protocol constants.

This does not require redesign later.

6️⃣ Nonce Rules (Critical)

Each wallet has a monotonically increasing nonce

Transaction is invalid if:

nonce ≠ expected nonce

nonce reused

7️⃣ State Model (FROZEN)
type ChainState = {
  balances: Record<WalletAddress, number>;
  nonces: Record<WalletAddress, number>;
};


State is mutated only by confirmed blocks

Mempool does NOT mutate state

8️⃣ Mempool (Defined, not yet implemented)
type Mempool = {
  transactions: Transaction[];
};


Rules:

Only valid transactions enter mempool

Sorted by:

Gas fee (desc)

Timestamp (asc)

9️⃣ Block Structure (FROZEN)
type Block = {
  height: number;
  hash: string;
  prevHash: string;
  timestamp: number;
  validator: string;
  transactions: Transaction[];
};

🔟 Validators (Testnet v0)
const VALIDATORS = [
  "HNY_VALIDATOR_1"
];


Single active validator initially

Rotating / staking later

Validator identity stored in block

1️⃣1️⃣ Block Production Rules

Fixed block time (e.g. 5s or manual)

Validator:

Pulls valid txs from mempool

Applies them in order

Produces block

Updates state

Broadcasts confirmations

1️⃣2️⃣ Confirmations (Frozen Logic)
const CONFIRMATIONS_REQUIRED = 6;


Tx becomes confirmed after N blocks

UI must reflect:

Pending

Included (0/6)

Confirmed (6/6)

1️⃣3️⃣ Transaction Hash (txId)
txId = sha256(
  from +
  to +
  amount +
  gasFee +
  nonce +
  timestamp
)


Deterministic

Used for explorer & receipts

1️⃣4️⃣ Explorer / History Requirements

Every transaction must expose:

txId

status

from / to

amount

gasFee

block height (if included)

confirmations

validator

1️⃣5️⃣ Faucet Rules

Faucet is not special

Faucet submits SYSTEM_TX

Cooldown enforced before tx enters mempool

Cooldown is wallet-based

1️⃣6️⃣ What This Architecture Enables

✅ Real mempool
✅ Real confirmations
✅ Validator fees
✅ Explorer
✅ Seamless transition to mainnet
✅ No more UI/server desync
✅ No more “magic minting”

1️⃣7️⃣ What Is Explicitly OUT OF SCOPE (for now)

Networking / P2P gossip

Slashing

Governance

Sharding

Cross-chain

FINAL DECISION

Honey Testnet v0 is now architecturally frozen.

Everything we build next:

Mempool

Server

UI

Admin tools

MUST conform to this document.