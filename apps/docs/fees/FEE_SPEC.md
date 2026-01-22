# Honey Blockchain – Fee Specification (Fee_Spec.md)

## Overview
This document defines the transaction fee model for the Honey Blockchain (HONEY).
The goal is to provide a predictable, fair, and scalable fee structure that supports:

- Micro-tipping
- Creator payments
- Retail transfers
- Large-value settlement
- Enterprise usage

The model is intentionally simple, deterministic, and resistant to price volatility.

---

## Fee Components

Every transaction fee consists of two components:

### 1. Base Fee
A fixed minimum fee required for all transactions.

- Base Fee: 0.000001 HONEY
- Purpose:
  - Prevent spam
  - Ensure non-zero validator compensation
  - Maintain mempool hygiene

---

### 2. Service Fee (Value-Based)
A percentage-based fee calculated from the transaction amount.

- Service Fee Rate: 0.0005% (0.000005 decimal)
- Formula:
  service_fee = amount × 0.000005

This ensures fees scale fairly with transaction value while remaining competitive across all price regimes.

---

## Maximum Service Fee Cap

To guarantee enterprise competitiveness and protect large transfers, a hard cap is applied.

- Max Service Fee Rate: 0.0017%
- Effective maximum cost:
  - At any HONEY price, the service fee for a $1,000,000 USD-equivalent transfer
    will not exceed $17 USD.

---

## Total Fee Formula

total_fee = base_fee + min(
  amount × 0.000005,
  amount × 0.00001
)

Where:
- base_fee = 0.000001 HONEY
- max service fee cap = 0.0015%

---

## Practical Examples

### Example 1: Small Transfer
- Amount: 17 HONEY
- Service Fee: 0.000085
- Base Fee: 0.000001
- Total Fee: 0.000086 HONEY

---

### Example 2: $1,000,000 Transfer @ $0.03
- HONEY required: ~33,333,333
- Service Fee: ~166.67 HONEY
- USD Cost: ~$5.00

---

### Example 3: $1,000,000 Transfer @ $200
- HONEY required: 5,000
- Service Fee: 0.025 HONEY
- USD Cost: $5.00

---

### Example 4: Cap Trigger Scenario
- Raw service fee exceeds cap
- Fee capped at 0.0017% (~$17 USD)

---

## Micro-Tipping Support

This model explicitly supports micro-payments:
- Sub-cent tips remain viable
- Base fee dominates only at very small values
- Creators retain nearly all value

---

## Status

Proposed for Testnet Lock-In
