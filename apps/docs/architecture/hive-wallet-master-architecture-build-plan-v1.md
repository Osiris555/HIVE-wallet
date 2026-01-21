# HIVE Wallet (HONEY) – Proprietary Wallet System

## 1. Vision

HIVE Wallet is the sovereign gateway into the HONEY ecosystem: a secure, identity-aware, media-native, DeFi-enabled wallet that merges finance, social presence, and protected digital media into a single, vertically integrated product.

The wallet is not just storage — it is **an operating system for creators, users, and validators**.

---

## 2. Core Design Principles

1. **Sovereignty First** – User owns keys, identity, and media
2. **Modular Architecture** – Every feature is a pluggable module
3. **Progressive Disclosure** – Simple UX, powerful depth
4. **Post-Quantum Ready** – Chrysalis security roadmap
5. **Media-Native** – Vaults and playback are first-class citizens
6. **Regulatory Optionality** – KYC where required, privacy where possible

---

## 3. High-Level System Architecture

### Layers

```
┌────────────────────────────┐
│        UI / UX Layer       │
│ (Mobile, Desktop, Web)     │
└────────────┬───────────────┘
             │
┌────────────▼───────────────┐
│   Application Services     │
│ Wallet • Swap • Identity   │
│ Media • Social • Payments  │
└────────────┬───────────────┘
             │
┌────────────▼───────────────┐
│   Cryptographic Core       │
│ Keys • Signing • PQ Hooks  │
└────────────┬───────────────┘
             │
┌────────────▼───────────────┐
│  Network / Protocol Layer  │
│ Honey Chain • EVM • L2     │
└────────────────────────────┘
```

---

## 4. Wallet Core (Phase 1 – Mandatory)

### 4.1 Key Management

* HD wallet (BIP-32/39/44 compatible)
* Honey-native derivation path
* Optional hardware wallet support (Ledger-compatible later)
* Secure enclave / OS keystore usage

### 4.2 Accounts

* HONEY native account
* Multi-chain accounts (EVM, BTC optional later)
* Named accounts (human-readable)

### 4.3 Transactions

* Send / Receive HONEY
* Fee estimation
* Validator delegation & staking
* Transaction simulation (pre-flight)

---

## 5. Swaps & Liquidity

### 5.1 Swap Engine

* Aggregated routing (internal + external DEXs)
* HONEY ↔ Stablecoin
* Slippage protection
* MEV-resistant routing (future)

### 5.2 Liquidity Provision

* LP position visualization
* Impermanent loss indicators
* One-click enter/exit pools

---

## 6. Fiat On-Ramp / Off-Ramp

### 6.1 Providers (Abstracted)

* Stripe / MoonPay / Ramp (region-dependent)
* Modular provider interface

### 6.2 Flow

* Fiat → Stable → HONEY
* HONEY → Stable → Fiat

### 6.3 Compliance Mode

* Optional KYC profile
* Jurisdiction-aware limits
* Separated identity from wallet keys

---

## 7. Identity Layer (HIVE ID)

### 7.1 Decentralized Identity

* DID-compatible identity
* Wallet-bound but portable
* Multiple personas per wallet

### 7.2 Identity Components

* Username / Display name
* Avatar & profile metadata
* Reputation score (opt-in)

### 7.3 Privacy

* Zero-knowledge proofs (roadmap)
* Selective disclosure

---

## 8. Social Layer

### 8.1 Social Graph

* Follow / Subscribe
* Creator → Fan relationships
* Token-gated access

### 8.2 Messaging

* End-to-end encrypted DMs
* Wallet-to-wallet chat
* Media sharing (vault-backed)

### 8.3 Monetization

* Tips in HONEY
* Subscriptions
* Paywalled posts

---

## 9. Secure Media Vault (Critical Differentiator)

### 9.1 Vault Architecture

* Client-side encryption
* Per-file symmetric keys
* Key wrapping with wallet keys

### 9.2 Content Types

* Video
* Audio
* Images
* Documents

### 9.3 Access Control

* Owner-only
* Token-gated
* Time-limited access
* Viewer watermarking

---

## 10. Media Player

### 10.1 Player Capabilities

* Encrypted streaming
* Adaptive bitrate
* Offline playback (authorized cache)

### 10.2 Anti-Piracy

* Device binding
* Session-based decryption keys
* Dynamic watermark overlays

---

## 11. Validator & Staking Interface

* Stake HONEY
* Delegate to validators
* Reward visualization
* Emission runway tracking

---

## 12. DAO & Governance (Phase 2)

* Proposal creation
* Voting with staked HONEY
* Treasury visibility
* Delegated voting

---

## 13. Security Framework (Chrysalis V1 Integration)

* Modular cryptography engine
* PQ algorithm hooks (Dilithium/Kyber later)
* Key rotation support
* Recovery without custodians

---

## 14. Tech Stack (Proposed)

### Frontend

* React Native (mobile)
* Electron / Tauri (desktop)
* Web (limited)

### Backend (Minimal)

* Stateless API gateways
* Indexers
* Media relay (no plaintext storage)

### Storage

* IPFS / Arweave (metadata)
* Encrypted cloud blobs (media)

---

## 15. Phased Build Plan

### Phase 0 – Foundations (LOCKED SCOPE)

**Objective:** Ship a sovereign, production-grade HONEY wallet with staking that can be safely distributed, audited, and extended.

Phase 0 is intentionally opinionated and constrained. Anything not listed here is *explicitly out of scope*.

---

## 15.1 Phase 0 Feature Lock

### Included (Must Ship)

#### Wallet Core

* Generate / import wallet (mnemonic)
* Encrypted local key storage
* HONEY-only asset support
* Single primary account

#### Transactions

* Send HONEY
* Receive HONEY
* Transaction history (indexed)
* Fee estimation
* Transaction status tracking

#### Staking

* Stake HONEY
* Unstake / redelegate
* Delegate to validators
* Rewards dashboard (real-time + lifetime)

#### Validator Interface

* Validator list
* Basic validator metadata
* APR display
* Delegation allocation

#### Security

* App-level PIN / biometric lock
* Mnemonic backup flow
* Read-only mode (no signing)
* Deterministic address derivation

#### UX / Platform

* Mobile-first (iOS / Android)
* Dark-mode default
* Human-readable addresses
* QR send / receive

---

### Explicitly Excluded (Phase 1+)

* Swaps / DEX
* Fiat on/off ramps
* Identity (HIVE ID)
* Social features
* Media vault / player
* Multi-chain assets
* DAO / governance UI
* Hardware wallet support
* Cross-device sync

---

## 15.2 Phase 0 Non-Functional Requirements

### Performance

* App cold start < 2s
* Transaction signing < 300ms

### Security

* No plaintext keys ever
* All crypto operations sandboxed
* Memory zeroization after signing

### Reliability

* Offline receive support
* Graceful degraded mode if indexer is down

### Compliance

* No KYC
* No custodial services
* No user data retention

---

## 15.3 Phase 0 Architecture Decisions (Locked)

* **Key Custody:** Non-custodial only
* **Backend:** Optional indexer, no signing servers
* **Chain Support:** Honey mainnet only
* **Accounts:** 1 wallet = 1 primary account
* **Upgradability:** Forward-compatible schemas

---

## 15.4 Phase 0 Deliverables

* Mobile wallet app (TestFlight / Play Store internal)
* Open-source cryptographic core
* Validator API spec
* Internal security audit checklist
* User recovery documentation

---

## 15.5 Phase 0 Success Criteria

Phase 0 is considered complete when:

* A user can install, create a wallet, stake HONEY, earn rewards, and withdraw
* No private key material ever leaves the device
* Validators can be delegated to at scale
* App survives adversarial testing

---

### Phase 1 – Economic Engine (UNLOCKS AFTER PHASE 0 SIGN-OFF)

* Swaps
* Fiat ramps
* LP tooling

### Phase 2 – Identity & Social

* HIVE ID
* Messaging
* Creator tools

### Phase 3 – Media Domination

* Secure vault
* Encrypted streaming

### Phase 4 – Governance & Expansion

* DAO
* Post-quantum upgrade
* Cross-chain

---

## 16. Phase 0 – Cryptographic Core Specification (LOCKED)

This section defines the *non-negotiable* cryptographic foundations of HIVE Wallet. All UX, APIs, identity, and media systems MUST conform to this layer.

---

## 16.1 Key Hierarchy & Wallet Creation

### Standards

* BIP-39 mnemonic (12 or 24 words)
* BIP-32 hierarchical deterministic keys
* BIP-44–compatible structure

### Honey Derivation Path (Locked)

```
m / 44' / 7777' / 0' / 0 / 0
```

* `7777` = Honey registered coin type
* Single account index in Phase 0

---

## 16.2 Key Classes

### Root Seed

* Generated locally using OS CSPRNG
* Never persisted in plaintext

### Master Private Key

* Derived from seed
* Exists only in secure memory during derivation

### Account Private Key

* Used for all HONEY signing in Phase 0
* Scoped to single account

### Public Keys

* Cached freely
* Used for address derivation and verification

---

## 16.3 Key Storage Model

### At-Rest

* Encrypted using:

  * iOS Secure Enclave / Android Keystore where available
  * Fallback: AES-256-GCM with user PIN–derived key (Argon2id)

### In-Memory

* Loaded only for signing
* Zeroized immediately after use
* No background persistence

---

## 16.4 Signing Flow

1. Transaction constructed (unsigned)
2. Transaction simulation (fees, validity)
3. User confirmation
4. Private key loaded into memory
5. Transaction signed
6. Signature returned
7. Key material zeroized
8. Signed tx broadcast

No step may be skipped or reordered.

---

## 16.5 Cryptographic Algorithms (Phase 0)

### Signatures

* Ed25519 (primary)

### Hashing

* SHA-256

### Encryption

* AES-256-GCM

### KDF

* Argon2id (memory-hard)

---

## 16.6 Address Format

* Bech32-style human-readable prefix

```
hny1xxxxxxxxxxxxxxxxxxxx
```

* Checksum enforced
* Case-insensitive input

---

## 16.7 Recovery Model (Phase 0)

### Supported

* Mnemonic phrase recovery

### Not Supported

* Social recovery
* Cloud backups
* Shamir shares

Clear user warnings are mandatory.

---

## 16.8 Read-Only Mode

* Wallet can operate without private key loaded

* Allows:

  * Balance viewing
  * Transaction history
  * Staking status

* Disallows:

  * Signing
  * Staking actions

---

## 16.9 Forward Compatibility Hooks (Chrysalis)

* Abstract signature interface
* Algorithm identifiers stored alongside keys
* Future PQ algorithms pluggable without key migration

---

## 16.10 Threat Model (Phase 0)

### Defended Against

* Remote attackers
* Malicious dApps (no dApp support)
* Network MITM

### Out of Scope (Explicit)

* Compromised OS
* Physical coercion
* Advanced side-channel attacks

---

## 16.11 Audit Checklist (Minimum)

* No plaintext key persistence
* Memory zeroization verified
* Deterministic derivation confirmed
* Signing flow enforced
* RNG entropy validated

---

## 17. Phase 0 – Wallet UX Flows (LOCKED)

These UX flows are binding. Engineering, design, and QA must implement *exactly* these states before Phase 0 sign-off.

---

## 17.1 App Entry & Security

### Cold Start States

1. Splash → Integrity check
2. Security gate:

   * Biometric / PIN if wallet exists
   * Welcome if no wallet

### Failure States

* Biometric failure → PIN fallback
* Repeated failure → timed lockout

---

## 17.2 Onboarding Flow

### New Wallet

1. Welcome screen (non-custodial warning)
2. Create wallet
3. Display mnemonic (one screen, scroll locked)
4. Mandatory backup confirmation (word check)
5. Set PIN + biometric opt-in
6. Wallet ready

### Import Wallet

1. Choose import
2. Enter mnemonic (offline)
3. Set PIN
4. Wallet sync

No analytics, screenshots disabled during mnemonic display.

---

## 17.3 Home Dashboard

### Elements

* Total HONEY balance
* Staked vs liquid
* Rewards (claimable)
* Primary actions:

  * Send
  * Receive
  * Stake

Read-only mode badge when applicable.

---

## 17.4 Send HONEY Flow

1. Enter recipient (address / QR)
2. Enter amount
3. Fee preview
4. Final confirmation
5. Signing
6. Broadcast
7. Success / failure receipt

Invalid address or insufficient balance must block progression.

---

## 17.5 Receive Flow

* Address display
* QR code
* Copy warning (checksum enforced)

---

## 17.6 Staking UX

### Stake

1. View staking overview
2. Choose validator
3. Enter stake amount
4. Lock-up disclosure
5. Confirm

### Unstake / Redelegate

* Clear cooldown messaging
* Countdown timers

---

## 17.7 Validator List UX

* Sort by APR
* Sort by uptime
* Stake concentration warning
* Validator detail page

---

## 17.8 Transaction History

* Pending / confirmed states
* Explorer deep link
* Filter by type

---

## 17.9 Error & Edge Handling

* Network unavailable
* Indexer down (graceful degrade)
* Chain re-org awareness

---

**UX STATUS:** LOCKED

---

## 18. Phase 0 – Validator & Staking APIs (LOCKED)

These APIs define the minimum interface between the wallet, Honey chain, and optional indexers.

---

## 18.1 On-Chain Calls

* `GetBalance(address)`
* `GetDelegations(address)`
* `Delegate(validator, amount)`
* `Undelegate(validator, amount)`
* `Redelegate(from, to, amount)`
* `ClaimRewards(address)`

---

## 18.2 Validator Metadata

* Validator address
* Name
* Commission
* APR
* Uptime
* Total stake

No social metadata in Phase 0.

---

## 18.3 Indexer Requirements

* Block ingestion
* Transaction indexing
* Reward calculation
* Validator stats aggregation

Indexer must be replaceable without wallet update.

---

## 18.4 Staking Rules

* Minimum stake enforced
* Cooldown enforced
* Partial undelegation allowed

---

## 18.5 Failure Handling

* Transaction rejected
* Validator jailed
* Indexer unavailable

Wallet must surface actionable messages.

---

## 18.6 Performance Targets

* Balance fetch < 500ms
* Delegation update < 1 block

---

## 19. Phase 0 – Implementation Ticket Map (EXECUTION READY)

This section converts Phase 0 into concrete, assignable engineering tickets with clear dependencies.

---

## 19.1 Workstreams

Phase 0 is split into five parallel workstreams:

1. Cryptography & Key Management
2. Chain & Staking Logic
3. Indexer & Data Services
4. Wallet Frontend (Mobile)
5. QA, Security & Release

---

## 19.2 Workstream 1 – Cryptography & Key Management

**Owner:** Core / Security Engineer

### Tickets

* CRYPTO-001: Implement BIP-39 mnemonic generation
* CRYPTO-002: Implement Honey derivation path (m/44'/7777'/0'/0/0)
* CRYPTO-003: Secure key storage (iOS Secure Enclave / Android Keystore)
* CRYPTO-004: PIN-based encryption fallback (Argon2id + AES-256-GCM)
* CRYPTO-005: In-memory signing + zeroization
* CRYPTO-006: Read-only mode enforcement
* CRYPTO-007: Abstract signature interface (Chrysalis hook)

**Dependencies:** None

---

## 19.3 Workstream 2 – Chain & Staking Logic

**Owner:** Protocol Engineer

### Tickets

* CHAIN-001: Address encoding / decoding (bech32 hny)
* CHAIN-002: Transaction construction (send)
* CHAIN-003: Fee estimation logic
* CHAIN-004: Stake delegation transaction
* CHAIN-005: Undelegation / redelegation logic
* CHAIN-006: Reward claim transaction
* CHAIN-007: Tx simulation & validation

**Dependencies:** CRYPTO-001 → CRYPTO-005

---

## 19.4 Workstream 3 – Indexer & Data Services

**Owner:** Backend Engineer

### Tickets

* INDEX-001: Block ingestion service
* INDEX-002: Transaction indexer
* INDEX-003: Balance & delegation aggregation
* INDEX-004: Validator metadata ingestion
* INDEX-005: Reward calculation service
* INDEX-006: API abstraction layer (replaceable indexer)

**Dependencies:** CHAIN-001 → CHAIN-007

---

## 19.5 Workstream 4 – Wallet Frontend (Mobile)

**Owner:** Mobile Engineer

### Tickets

#### Onboarding

* UI-001: Welcome & non-custodial warning
* UI-002: Wallet creation flow
* UI-003: Mnemonic display & verification
* UI-004: Wallet import flow

#### Core Screens

* UI-005: Home dashboard
* UI-006: Send HONEY flow
* UI-007: Receive screen (QR)
* UI-008: Transaction history

#### Staking

* UI-009: Validator list
* UI-010: Validator detail screen
* UI-011: Stake / unstake flows
* UI-012: Rewards dashboard

#### Security

* UI-013: PIN & biometric gate
* UI-014: Read-only mode indicator

**Dependencies:** CRYPTO-001+, INDEX-003+

---

## 19.6 Workstream 5 – QA, Security & Release

**Owner:** QA / Security Lead

### Tickets

* QA-001: Unit test crypto primitives
* QA-002: Transaction signing tests
* QA-003: Staking edge-case tests
* QA-004: Offline / degraded mode tests
* QA-005: Adversarial testing checklist
* QA-006: App store compliance review
* QA-007: Internal security sign-off

**Dependencies:** All workstreams

---

## 19.7 Critical Path

1. CRYPTO-001 → CRYPTO-005
2. CHAIN-002 → CHAIN-006
3. INDEX-001 → INDEX-005
4. UI-002 → UI-012
5. QA-001 → QA-007

---

## 19.8 Definition of Done (Phase 0)

Phase 0 is complete when:

* All tickets are closed
* Testnet wallet deployed
* Validators actively delegated to
* No critical or high-severity audit issues remain

---

## 20. Phase 0 – Validator Bootstrapping Plan (TESTNET → MAINNET)

This section defines how the Honey network is safely activated, decentralized, and economically secure at launch.

---

## 20.1 Objectives

* Ensure chain liveness from genesis
* Prevent stake centralization
* Incentivize early, honest validators
* Provide real staking utility for Phase 0 wallet

---

## 20.2 Initial Validator Set

### Testnet

* **Target validators:** 7–11
* **Operator profile:**

  * Core team (minority)
  * Trusted infrastructure partners
  * Community technical operators

### Mainnet (Genesis)

* **Target validators:** 21
* **Hard cap per validator:** 7% of total bonded stake

---

## 20.3 Validator Requirements

### Technical

* Dedicated server or cloud VM
* Redundant monitoring
* Minimum uptime SLA: 95% (testnet), 98% (mainnet)

### Economic

* **Minimum self-bond:**

  * Testnet: symbolic
  * Mainnet: 0.5–1% of circulating supply at launch

---

## 20.4 Delegation Mechanics

* Delegators earn proportional rewards
* Validator commission range: 0–10%
* Commission changes rate-limited

Stake concentration warnings enforced in wallet UX.

---

## 20.5 Emissions & Incentives (Phase 0)

### Block Rewards

* Emissions sourced from staking allocation (35% of total HNY supply)
* Linear emission curve during first 24 months

### Early Validator Incentive

* Temporary +X% reward multiplier (time-limited)
* Slashes disabled or reduced on testnet

---

## 20.6 Slashing Policy

### Testnet

* No economic slashing
* Visibility-only penalties

### Mainnet

* Downtime slashing
* Double-sign slashing (severe)

Clear wallet messaging required.

---

## 20.7 Governance at Genesis

* Governance disabled in Phase 0
* Emergency multisig limited to:

  * Halt chain
  * Patch critical bugs

Multisig must sunset before DAO activation.

---

## 20.8 Launch Sequence

1. Private devnet
2. Public testnet (validators onboarded)
3. Phase 0 wallet connects to testnet
4. Validator performance observed
5. Genesis validator set finalized
6. Mainnet launch

---

## 20.9 Success Metrics

* > 99% chain uptime (mainnet week 1)
* No validator >7% stake
* Active delegation from wallet users
* No critical slashing events

---

**PHASE 0 STATUS:** FULLY EXECUTABLE

Next steps:

* Finalize validator applications
* Publish validator handbook
* Schedule testnet launch

## 21. Honey Validator Handbook (Phase 0)

This handbook defines the operational, economic, and security expectations for all Honey network validators during Phase 0.

---

## 21.1 Purpose

* Ensure network liveness and security
* Set clear expectations for validator operators
* Protect delegators through transparency
* Establish credibility prior to DAO governance

This document is binding for Phase 0 participation.

---

## 21.2 Validator Responsibilities

Validators are expected to:

* Produce blocks reliably
* Maintain high uptime
* Secure private keys and infrastructure
* Act honestly in consensus and governance
* Communicate outages or incidents promptly

Failure to meet these responsibilities may result in removal or slashing.

---

## 21.3 Infrastructure Requirements

### Minimum Specifications

* 4+ CPU cores
* 16GB RAM
* SSD storage
* Stable broadband connection

### Operational Standards

* 24/7 monitoring
* Automated alerting
* Regular OS and security updates
* Firewall and DDoS mitigation

Cloud or bare-metal deployments are acceptable.

---

## 21.4 Key Management

* Validator signing keys must be stored securely
* Hardware security modules (HSMs) strongly recommended
* No shared or reused keys
* Backup keys must be encrypted and offline

Key compromise must be reported immediately.

---

## 21.5 Uptime & Performance

### Targets

* Testnet: ≥95% uptime
* Mainnet: ≥98% uptime

### Measurement

* Measured per epoch
* Missed blocks tracked and published

Persistent underperformance may trigger removal.

---

## 21.6 Commission & Economics

* Commission range: 0–10%
* Commission increases are rate-limited
* Self-bond required at genesis

Validators are expected to align incentives with delegators.

---

## 21.7 Slashing Conditions

### Testnet

* No economic slashing
* Reputation penalties only

### Mainnet

* Downtime slashing
* Double-sign slashing (severe)

Slashing parameters are protocol-enforced and non-negotiable.

---

## 21.8 Incident Response

Validators must:

* Notify the team of outages or security incidents
* Restore service promptly
* Participate in post-incident reviews

Repeated incidents may result in validator expulsion.

---

## 21.9 Governance Status (Phase 0)

* Validators do not control governance in Phase 0
* Emergency multisig exists only for critical interventions
* DAO governance will replace this system in later phases

---

## 21.10 Removal & Exit

Validators may be removed for:

* Prolonged downtime
* Malicious behavior
* Failure to meet handbook requirements

Voluntary exit must respect unbonding periods.

---

## 21.11 Acceptance

Participation as a Honey validator constitutes acceptance of this handbook and all Phase 0 rules.

---

**DOCUMENT STATUS:** OFFICIAL – PHASE 0

---

## 22. Public-Facing Artifacts (Phase 0)

This section defines the outward-facing narrative and materials used to communicate Honey and HIVE Wallet to validators, early users, and partners. These artifacts must remain aligned with Phase 0 scope — no forward promises.

---

## 22.1 One-Page Overview ("What Is Honey?")

**Honey is a sovereign blockchain ecosystem built around HONEY, a native asset designed for staking, security, and creator-native finance.**

At launch, Honey provides:

* A non-custodial mobile wallet (HIVE Wallet)
* Native HONEY staking and delegation
* A capped, decentralized validator set

No custody. No KYC. No hidden leverage.

---

## 22.2 HIVE Wallet Public Description

**HIVE Wallet is the official non-custodial wallet for the Honey network.**

Phase 0 capabilities:

* Create or import a wallet
* Send and receive HONEY
* Stake and delegate to validators
* Track rewards and performance

HIVE Wallet never holds user keys and never requires identity verification.

---

## 22.3 Validator Call (Public)

**We are onboarding validators for the Honey testnet and genesis mainnet.**

We are seeking:

* Experienced node operators
* Infrastructure partners
* Community validators committed to decentralization

Validators must meet technical and economic requirements outlined in the Honey Validator Handbook.

---

## 22.4 Early Staker Messaging

**Stake early. Secure the network. Earn rewards.**

HONEY staking allows holders to:

* Secure the Honey network
* Earn protocol emissions
* Support trustworthy validators

Staking is non-custodial and fully controlled by the user.

---

## 22.5 What We Explicitly Do NOT Promise (Phase 0)

To maintain credibility, Phase 0 public messaging must avoid:

* Price predictions
* Guaranteed yields
* Media, social, or swap features
* DAO governance claims

Future phases will be communicated only when shipped.

---

## 22.6 Launch Assets Checklist

* Website landing page (Phase 0 scope only)
* Validator handbook (public)
* Testnet announcement post
* Wallet beta announcement

---

**PUBLIC COMMUNICATION STATUS:** READY

---

## 23. Phase 0 Launch Timeline & Milestones

This timeline establishes realistic, credibility-safe dates for testnet and mainnet readiness. Dates are expressed as windows to preserve execution flexibility.

---

## 23.1 Assumptions

* Core engineering team in place
* No protocol-breaking bugs discovered during testnet
* Phase 0 scope remains frozen

---

## 23.2 Timeline Overview

### T0 – Internal Devnet (Weeks 0–2)

**Goals:**

* Validate cryptographic core
* Validate staking transactions
* Smoke-test wallet UX

**Milestones:**

* Wallet can create/import keys
* Send/receive HONEY works
* Basic staking works against devnet

---

### T1 – Private Testnet (Weeks 3–4)

**Participants:**

* Core team
* 3–5 trusted validators

**Goals:**

* Validate validator operations
* Monitor uptime and signing
* Test delegation and rewards

**Milestones:**

* Validators producing blocks
* Rewards accruing correctly
* No critical crashes

---

### T2 – Public Testnet (Weeks 5–7)

**Participants:**

* 7–11 validators
* Early community users

**Goals:**

* Stress-test staking
* Observe delegation distribution
* Validate indexer reliability

**Milestones:**

* > 95% uptime across validators
* Active delegations via HIVE Wallet
* No security incidents

---

### T3 – Genesis Preparation (Week 8)

**Goals:**

* Finalize validator set
* Freeze genesis parameters
* Publish mainnet docs

**Milestones:**

* Genesis file signed
* Validator self-bonds confirmed
* Emergency multisig configured

---

### T4 – Mainnet Launch (Week 9)

**Goals:**

* Launch Honey mainnet
* Enable real staking
* Open Phase 0 wallet to public

**Milestones:**

* Blocks finalized
* Delegations live
* No chain halts

---

## 23.3 Post-Launch Stabilization (Weeks 10–12)

* Monitor validator performance
* Address minor bugs
* No feature additions

---

## 23.4 Date Communication Policy

* Announce *windows*, not exact days
* No countdown timers
* No feature promises beyond Phase 0

---

**TIMELINE STATUS:** APPROVED FOR PUBLIC USE
