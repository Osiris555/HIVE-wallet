# Honey.net Gas Specification v1

**Status:** Frozen (Testnet Economics Locked)

This document defines Honey.net’s canonical **fee mechanics** (base fee, value-based service fee, caps, and optional priority tips),
and the **redistribution** of collected fees.

> **Source of truth for fee parameters:** `apps/docs/fees/FEE_SPEC.md`  
> This document describes *how* fees work and how they are applied at runtime.

---

## 1. Design Goals

- Enable frictionless micropayments (tipping, streaming, creator payouts)
- Prevent fee volatility and bidding wars
- Scale safely from cents to large-value settlement
- Reward validators/stakers/treasury from real usage
- Keep UX simple: fees should be predictable and low

---

## 2. Fee Components

Every transaction fee has two required components and one optional component.

### 2.1 Base Fee (Required)
A fixed minimum fee charged for all transactions.

- **Base fee:** `0.000001 HONEY`

Purpose:
- Anti-spam / mempool hygiene
- Non-zero validator compensation
- Predictable minimum cost

### 2.2 Service Fee (Required, Value-Based)
A percentage-based fee charged on the transaction amount.

- **Service fee rate:** `0.0005%` (decimal `0.000005`)

Formula:
```
service_fee_raw = amount × 0.0005%
```

### 2.3 Service Fee Cap (Required)
To guarantee enterprise competitiveness and prevent large transfers from becoming expensive when HONEY price rises,
the service fee is **capped**.

- **Cap rate:** `0.0017%` (decimal `0.00001`)

Formula:
```
service_fee_cap = amount × 0.00001
service_fee = min(service_fee_raw, service_fee_cap)
```

> **Interpretation:** For a $1,000,000 USD-equivalent transfer, the service fee will not exceed ~$17 USD-equivalent
> (excluding the base fee), regardless of HONEY’s market price.

### 2.4 Priority Tip (Optional)
A voluntary extra fee used to accelerate inclusion or replacement (RBF / cancel). Priority tips are **additive** and optional.

- **priority_tip ≥ 0**
- Wallets may offer UI presets (Slow/Normal/Fast) as a convenience.
- Priority tips are **not** part of the service-fee cap unless explicitly enforced by node policy.

---

## 3. Total Fee Formula

```
total_fee = base_fee + service_fee + priority_tip
```

Where:
- `base_fee = 0.000001 HONEY`
- `service_fee = min(amount × 0.0005% + base_fee)`
- `priority_tip` is user-selected (optional)

---

## 4. Redistribution Model (Locked)

All collected fees are redistributed as follows:

| Recipient    | Share |
|------------:|------:|
| Validators   | 60%   |
| Staking Pool | 30%   |
| Treasury     | 10%   |

Notes:
- No fees are burned
- Rewards are usage-based (supports sustainable security)
- Treasury funds ecosystem development (grants, audits, infra)

---

## 5. Examples

### Example A — Small Transfer (17 HONEY, no priority tip)

- Base fee: `0.000001`
- Service fee: `17 × 0.0005% = 0.000085`
- Priority tip: `0`
- **Total fee:** `0.000086 HONEY`

### Example B — Large Transfer (33,333,333 HONEY, ≈ $1,000,000 at $0.03/HONEY)

- Service fee: `33,333,333 × 0.0005% ≈ 166.666665 HONEY`
- USD-equivalent fee: `166.666665 × $0.03 ≈ $5.00`
- Cap does not apply here (raw service fee < cap)

### Example C — High Price Scenario (HONEY = $1,000,000,000 transfer)

- Amount: `1,000,000,000 HONEY`
- Raw service fee: `1,000,000,000 × 0.0005% = 5,000 HONEY` (=$5,000)
- **Capped service fee:** `1,000,000,000 × 0.0017 = 17,000 HONEY` (cap rate)
- This example illustrates the *rate cap mechanics*; the intended *USD ceiling* depends on the USD-equivalent amount sent.
  See `apps/docs/fees/FEE_SPEC.md` for the value-stable framing and examples.

---

## 6. Mempool Policy Hooks (Non-Consensus)

Nodes MAY enforce additional policy rules, such as:
- Minimum total fee (base fee already enforces a floor)
- Minimum priority tip for RBF/cancel operations
- Rate limits for free faucets / sponsored gas
- DoS protections (per-IP, per-address)

These are *policy* controls and should not change the consensus fee formula above.

---

## 7. Membership-Sponsored Gas (QueenBeeCams / Apps)

Apps MAY subsidize fees for eligible users (e.g., membership tiers):

- Platform may cover base fee and/or service fee and/or priority tip
- User still signs the transaction normally
- Subsidy rules are application-level and do not change consensus rules

---

## 8. Versioning

**Gas Spec:** v1 (Frozen)

Any changes require:
- Public proposal (DAO governance)
- Validator signaling
- Scheduled network upgrade window

---

**Honey.net fees are designed to be predictable, micro-payment friendly, and enterprise-competitive.**
