# Honey Blockchain – Fee Specification (FEE_SPEC.md)

## Overview
This document defines the canonical fee model for the Honey Blockchain (HNY).

Goals:
- Predictable fees for wallets, creators, and integrators
- Micropayment-friendly tipping and streaming payouts
- Competitive large-value settlement with a hard ceiling
- Simple UX: a tiny network **base gas**, a value-based **service fee**, and an optional **priority tip**

---

## Fee Components

Every transaction fee is:

```
total_fee = base_gas + service_fee + priority_tip
```

### 1) Base Gas (Required)
A fixed minimum network fee required for all transactions.

- **Base gas:** `1 Honey Cone = 0.00000001 HNY`
- Purpose:
  - Prevent spam / maintain mempool hygiene
  - Ensure non-zero validator compensation
  - Provide a deterministic minimum cost floor

> Terminology: we call this **base gas** (not “minimum gas”). Nodes may still enforce additional *policy* minimums, but the consensus base is defined above.

---

### 2) Service Fee (Required, Value-Based)
A percentage-based fee computed from the transaction amount. The service fee rate follows a continuous discount curve that rewards larger transfers, but never goes below a floor.

#### 2.1 Service Fee Rate Curve (Continuous)
Let `A` be the transaction amount in HNY (same unit as the transferred amount).

- **Rate at/under 100,000,000,000 HNY:** `0.0005%` (decimal `0.000005`)
- **Rate at/over 500,000,000,000 HNY:** `0.0003%` (decimal `0.000003`)
- **Floor:** service fee rate will **never go below** `0.0003%`

**Piecewise definition:**
- If `A ≤ 100,000,000,000` then `rate(A) = 0.0005%`
- If `A ≥ 500,000,000,000` then `rate(A) = 0.0003%`
- Otherwise (continuous linear interpolation):

```
t = (A - 100,000,000,000) / (500,000,000,000 - 100,000,000,000)
rate(A) = 0.0005% - t * (0.0005% - 0.0003%)
```

#### 2.2 Service Fee Calculation
```
service_fee_raw = A × rate(A)
```

---

### 3) Service Fee Hard Cap (Required)
To guarantee enterprise competitiveness and protect large transfers, a hard cap is applied to the **service fee rate**.

- **Max service fee rate cap:** `0.000999%`
- Decimal equivalent: `0.00000999`

```
service_fee_cap = A × 0.00000999
service_fee = min(service_fee_raw, service_fee_cap)
```

**Interpretation:** for a **$1,000,000 USD-equivalent transfer**, the **service fee** will not exceed **$9.99 USD** (assuming 1 HNY = $1 for illustration of the cap promise).

---

### 4) Priority Tip (Optional)
A voluntary additional fee used to accelerate inclusion and/or replacement (RBF / cancel).

- **priority_tip ≥ 0**
- Users may set any value (no protocol cap in this spec)
- Priority tips are **additive** and **not included** in the service-fee cap

---

## Practical Examples (Illustrative)

### Example 1 — Small Transfer (17 HNY, no tip)
Assume `A = 17` and `A ≤ 100B`, so `rate(A) = 0.0005%`.

- Base gas: `0.00000001`
- Service fee: `17 × 0.000005 = 0.000085`
- Priority tip: `0`
- **Total fee:** `0.00008501 HNY`

### Example 2 — $1,000,000 Transfer (assuming 1 HNY = $1)
Assume `A = 1,000,000` and `A ≤ 100B`, so `rate(A) = 0.0005%`.

- Service fee raw: `1,000,000 × 0.000005 = 5 HNY` → `$5.00`
- Service cap: `1,000,000 × 0.00000999 = 9.99 HNY` → `$9.99`
- **Service fee charged:** `$5.00` (cap does not trigger)
- Base gas and any tip are additional.

### Example 3 — Large Amount Past the Curve Floor
Assume `A = 600,000,000,000` (≥ 500B), so `rate(A) = 0.0003%`.

- Service fee: `600,000,000,000 × 0.000003 = 1,800,000 HNY`
- Cap check: `600,000,000,000 × 0.00000999 = 5,994,000 HNY`
- **Service fee charged:** `1,800,000 HNY` (cap does not trigger)

---

## Status
Frozen for Testnet Economics Lock-In (subject to governance for Mainnet changes).
