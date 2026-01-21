🧱 Honey.net Block Format Specification (FROZEN)

Status: 🔒 ARCHITECTURE LOCKED
Applies to: Testnet & Mainnet
Forward compatible: Yes

1️⃣ Block Overview

A block is the atomic unit of consensus and finality on Honey.net.

Each block contains:

Metadata (header)

Ordered transactions

Execution results

Validator signatures

Blocks are immutable once finalized.

2️⃣ High-Level Structure
Block
├── Header
├── Transactions[]
├── Receipts[]
├── ValidatorSignatures[]

3️⃣ Block Header (Fixed Layout)

The header is hashed to produce the block hash.

BlockHeader {
  version: number,
  chainId: string,

  height: number,
  previousHash: string,

  timestamp: number,

  proposer: string,           // validator address
  validatorSetHash: string,   // snapshot hash

  txRoot: string,             // Merkle root of txs
  receiptRoot: string,        // Merkle root of receipts
  stateRoot: string,          // post-state root

  gasLimit: number,
  gasUsed: number,

  baseFee: number,            // EIP-1559 style
  difficulty: number,         // PoS tuning parameter

  blockHash: string           // hash(header)
}

🔒 LOCKED FIELDS

These will not change without a hard fork:

txRoot

receiptRoot

stateRoot

baseFee

validatorSetHash

4️⃣ Transaction List

Transactions are ordered deterministically by:

Effective fee (tip + base)

Arrival time

Tx hash (tie-breaker)

Transaction {
  txId: string,
  from: string,
  to: string,

  nonce: number,
  amount: number,

  gasLimit: number,
  maxFee: number,
  priorityFee: number,

  data?: string,

  signature: string,
  timestamp: number
}

5️⃣ Gas Model (Locked)

Honey.net uses EIP-1559-style dynamic gas.

Per-transaction gas cost:
totalFee = gasUsed × (baseFee + priorityFee)

Distribution (LOCKED)
Recipient	%
Validators	60%
Staking Pool	30%
Treasury	10%

Base fee is burned logically, then redistributed via protocol accounting.

6️⃣ Receipts (Execution Proof)

Each transaction produces one receipt.

Receipt {
  txId: string,
  status: "SUCCESS" | "FAILED",

  gasUsed: number,
  effectiveFee: number,

  blockHeight: number,
  blockHash: string,

  confirmations: number,

  logs: [
    {
      event: string,
      data: object
    }
  ]
}


Receipts are:

Merklized

Light-client verifiable

Used for confirmations tracking

7️⃣ Validator Signatures

Honey.net uses BFT-style finality.

ValidatorSignature {
  validator: string,
  signature: string,
  votingPower: number
}

Finalization Rule (LOCKED)

A block is finalized when:

≥ 66% of total staking power signs


Once finalized:

Block cannot be reverted

Receipts become permanent

Confirmations stop increasing

8️⃣ Block Timing (Target)
Parameter	Value
Target block time	2–3 seconds
Max tx per block	Gas-limited
Reorg depth	0 after finality
9️⃣ Confirmation Model
Confirmations	Meaning
0	Pending (mempool)
1	Included
5	Practically final
Finalized	Immutable

Apps like QueenBeeCams can:

Accept tips at 1 confirmation

Lock withdrawals at finality

🔒 FINAL LOCK STATEMENT

This block format is frozen.

Future upgrades:

Add new tx types

Add new receipt events

Extend header without changing existing fields

No breaking changes without governance + fork.