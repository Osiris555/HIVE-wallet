# Honey.net Gas Specification v1

**Status:** Frozen (Testnet Economics Locked)

This document defines Honey.net’s fee mechanics:
- **Base gas** (network minimum)
- **Service fee** (value-based, with a continuous discount curve + hard cap)
- **Priority tip** (optional, user-controlled)

> **Source of truth for parameters:** `apps/docs/fees/FEE_SPEC.md`  
> This document describes *how* fees are applied at runtime.

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

### 2.1 Base Gas (Required)
A fixed minimum network fee charged for all transactions.

- **Base gas:** `0.00000001 HNY` (1 Honey Cone)

Purpose:
- Anti-spam / mempool hygiene
- Non-zero validator compensation
- Predictable minimum cost floor

### 2.2 Service Fee (Required, Value-Based)
A percentage-based fee charged on the transaction amount `A` (in HNY). The service fee uses a continuous discount curve:

- **Rate at/under 100,000,000,000 HNY:** `0.0005%` (decimal `0.000005`)
- **Rate at/over 500,000,000,000 HNY:** `0.0003%` (decimal `0.000003`)
- **Floor:** service fee rate never goes below `0.0003%`

Piecewise definition:
- If `A ≤ 100,000,000` then `rate(A) = 0.0005%`
- If `A ≥ 1,000,000,000 then `rate(A) = 0.0003%`
- If `A ≥ 100,000,000,000 the `rate(A) = 0.00005%
- Otherwise (continuous linear interpolation):

```
t = (A - 100,000,000) / (1,000,000,000 - 100,000,000)
rate(A) = 0.0005% - t * (0.0005% - 0.0003%)
```

Formula:
```
service_fee_raw = A × rate(A)
```

### 2.3 Service Fee Hard Cap (Required)
To guarantee enterprise competitiveness and protect large transfers, the service fee is capped by a maximum rate:

- **Cap rate:** `0.000999%` (decimal `0.00000999`)

Formula:
```
service_fee_cap = A × 0.00000999
service_fee = min(service_fee_raw, service_fee_cap)
```

> Interpretation (value-stable framing): for a $1,000,000 USD-equivalent transfer, the service fee will not exceed ~$9.99 USD-equivalent (assuming 1 HNY = $1 for illustration of the cap promise).

### 2.4 Priority Tip (Optional)
A voluntary extra fee used to accelerate inclusion or replacement (RBF / cancel). Priority tips are additive and optional.

- **priority_tip ≥ 0**
- Users may set any value (no protocol cap in this spec)
- Priority tips are **not** part of the service-fee cap unless explicitly enforced by node policy

---

## 3. Total Fee Formula

```
total_fee = base_gas + service_fee + priority_tip
```

Where:
- `base_gas = 0.00000001 HNY`
- `service_fee = min(A × rate(A), A × 0.00000999)`
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

## 5. Examples (Illustrative)

### Example A — Small Transfer (17 HNY, no priority tip)
Assume `A = 17`:

- Base gas: `0.00000001`
- Service fee: `17 × 0.000005 = 0.000085`
- Priority tip: `0`
- **Total fee:** `0.00008501 HNY`

### Example B — $1,000,000 Transfer (assuming 1 HNY = $1)
Assume `A = 1,000,000` (so `rate(A)=0.0005%`):

- Service fee raw: `1,000,000 × 0.000005 = 5 HNY` → `$5.00`
- Service fee cap: `1,000,000 × 0.00000999 = 9.99 HNY` → `$9.99`
- **Service fee charged:** `5 HNY` (cap does not trigger)

### Example C — Past Curve Floor
Assume `A = 600,000,000,000` (so `rate(A)=0.0003%`):

- Service fee: `600,000,000,000 × 0.0000005 = 300,000 HNY`
- Cap check: `600,000,000,000 × 0.00000999 = 5,994,000 HNY`
- **Service fee charged:** `300,000 HNY` (cap does not trigger)

---

## 6. Mempool Policy Hooks (Non-Consensus)

Nodes MAY enforce additional policy rules, such as:
- Minimum *effective fee* for inclusion under heavy load
- Minimum priority tip for RBF/cancel operations
- Rate limits for faucets / sponsored gas
- DoS protections (per-IP, per-address)

These are policy controls and should not change the consensus fee formula above.

---

## 7. Membership-Sponsored Gas (QueenBeeCams / Apps)

Apps MAY subsidize fees for eligible users (e.g., membership tiers):

- Platform may cover base gas and/or service fee and/or priority tip
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

**Honey.net fees are designed to be predictable, micropayment-friendly, and enterprise-competitive.**
