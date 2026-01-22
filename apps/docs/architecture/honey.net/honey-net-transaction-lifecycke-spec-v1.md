# Honey.net Transaction Lifecycle Specification v1

**Status:** Frozen (Architecture Lock)

---

## 1. Purpose

This document defines the **authoritative transaction lifecycle** for Honey.net.
It governs how transactions move from creation → confirmation → finality, and is the single source of truth for:

* Wallet behavior
* Validator logic
* Mempool handling
* Explorer / UI states
* Gas accounting

No component may implement transaction logic outside this specification.

---

## 2. Core Transaction Object

Every transaction on Honey.net MUST contain the following fields:

```json
{
  "txId": "HNY_TX_HASH",
  "from": "HNY_WALLET",
  "to": "HNY_WALLET",
  "amount": 100.0,
  "gas": {
    "baseFee": 0.000001,
    "valueFee": 0.0003,
    "totalGas": 0.030001
  },
  "nonce": 42,
  "timestamp": 1710000000000,
  "status": "pending",
  "blockHeight": null,
  "confirmations": 0,
  "validator": null
}
```

---

## 3. Transaction States

### 3.1 Created

* Transaction is signed locally
* Nonce assigned
* Gas estimated
* **Not yet broadcast**

State:

```text
status = created
```

---

### 3.2 Broadcast

* Wallet submits transaction to Honey.net
* Transaction enters mempool
* Gas is reserved but not spent

State:

```text
status = pending
confirmations = 0
```

Failure conditions:

* Invalid signature
* Insufficient balance (amount + gas)
* Nonce mismatch

---

## 4. Mempool Phase

### 4.1 Pending

* Transaction is waiting to be picked by a validator
* Visible in explorer as **Pending**

Rules:

* Transactions are ordered by **nonce then timestamp**
* No fee bidding
* Validators may not reorder arbitrarily

---

## 5. Block Inclusion

### 5.1 Included

* Validator selects pending transactions
* Block is produced
* Gas is charged

State update:

```text
status = included
blockHeight = N
confirmations = 1
validator = HNY_VALIDATOR_ID
```

Gas distribution occurs here:

* 60% → Validator
* 30% → Staking pool
* 10% → Treasury

---

## 6. Confirmation Phase

Each new block adds **+1 confirmation**.

| Confirmations | Status     |
| ------------- | ---------- |
| 0             | Pending    |
| 1–2           | Confirming |
| ≥3            | Finalized  |

---

## 7. Finalization

### 7.1 Finalized

* Transaction is immutable
* Cannot be reversed
* Balances permanently updated

State:

```text
status = finalized
confirmations >= 3
```

---

## 8. Failed Transactions

Transactions may fail **before inclusion** or **during execution**.

### 8.1 Pre-Inclusion Failure

Examples:

* Insufficient funds
* Invalid nonce

Result:

* No gas charged
* Transaction dropped

---

### 8.2 Execution Failure

Examples:

* Smart contract revert (future)

Result:

* Gas is charged
* No value transfer

State:

```text
status = failed
```

---

## 9. Transaction Hashing

Transaction ID (`txId`) is computed as:

```
SHA256(from + to + amount + nonce + timestamp)
```

This hash:

* Is user-visible
* Is explorer-searchable
* Is used for confirmations

---

## 10. Wallet UI Requirements

Wallets MUST display:

* Tx ID
* Status badge (Pending / Confirming / Finalized)
* Gas fee breakdown
* Validator ID (once included)
* Confirmation count

---

## 11. Explorer Requirements

Explorer MUST support:

* Wallet transaction history
* Pending transaction view
* Block-level transaction lists
* Validator attribution

---

## 12. Future Extensions (Non-Breaking)

* Smart contract execution
* Fee sponsorship metadata
* Validator slashing
* Reorg simulation

---

## 13. Architectural Rule

**No UI, server, or validator logic may skip lifecycle states.**
If a transaction is shown as "sent", it MUST pass through:

```
created → pending → included → confirming → finalized
```

---

## 14. Status

✅ **Transaction Lifecycle v1 is finalized and frozen.**

Any future changes require a versioned upgrade (v2+).
