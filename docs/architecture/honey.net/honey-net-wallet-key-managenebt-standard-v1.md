🍯 Honey.net Wallet & Key Management Standard

ARCHITECTURE FREEZE — v1

1️⃣ Design Goals (Locked)

Wallets on Honey.net must:

Be simple for users

Be secure for large balances

Support mobile + web + hardware

Be recoverable

Work unchanged from testnet → mainnet

Support future smart contract accounts

2️⃣ Account Model

Honey.net uses a dual-account model.

A) Externally Owned Accounts (EOA)

Controlled by private keys

Used by users, validators, apps

B) Contract Accounts

Controlled by code

Used for staking, DAOs, system logic

3️⃣ Key Format (Locked)
Private Key

32 bytes

Secp256k1 curve

Public Key

Derived from private key

Compressed form allowed

Address Format
HNY1_<40 hex chars>


Example:

HNY1_7fa3c9e4c2a1d9b8e0a91f4c6d8e3a1b2c4d5e6f

4️⃣ Wallet Derivation Standard (HD)

Honey.net wallets must support hierarchical deterministic derivation.

Standard

BIP-39 mnemonic

BIP-32 derivation

BIP-44-style path

Derivation Path
m / 44' / 777' / account' / change / index

Field	Meaning
777	Honey.net chain ID
account	User account
change	0 = receive, 1 = change
5️⃣ Mnemonic Rules
Property	Value
Word count	12 / 24
Language	English (v1)
Checksum	Mandatory
Storage	Never on-chain
6️⃣ Transaction Signing
Signing Algorithm

ECDSA (secp256k1)

Canonical low-S signatures

Signed Payload
hash(
  chainId,
  nonce,
  from,
  to,
  value,
  gasLimit,
  gasPrice,
  data
)

7️⃣ Nonce Model

Each EOA maintains:

nonce: uint64


Rules:

Strictly increasing

Prevents replay

Enforces ordering

8️⃣ Multi-Wallet Support

A wallet application may manage:

Multiple EOAs

Multiple derivation paths

Multiple networks (testnet/mainnet)

9️⃣ Smart Contract Wallets (Future-Safe)

Honey.net reserves support for:

Multi-sig wallets

Social recovery

Session keys

Spending limits

⚠️ Not required for v1 consensus.

🔐 10️⃣ Security Standards (Locked)

Wallets must:

Rule	Required
Secure enclave support	✅
Biometric unlock (mobile)	✅
Private key never leaves device	✅
Encrypted local storage	✅
11️⃣ Hardware Wallet Support

Honey.net wallets must support:

Ledger-class devices

Blind signing disabled by default

Explicit transaction preview

12️⃣ Backup & Recovery
Primary Recovery

Mnemonic phrase

Optional Enhancements

Encrypted cloud backup (opt-in)

Shamir Secret Sharing (future)

13️⃣ Address Reuse Policy

Address reuse allowed

New address recommended for privacy

Wallets may auto-rotate

14️⃣ Network Awareness

Wallets must display:

Network (Testnet / Mainnet)

Chain ID

Gas fees clearly

No silent network switching.

15️⃣ Wallet API Standard

Wallets expose:

connect()
signTransaction(tx)
signMessage(msg)
getAccounts()
getChainId()

16️⃣ Permissions Model

DApps request:

Read address

Sign tx

Sign message

User must approve each scope.

🔒 FINAL LOCK STATEMENT

Honey.net wallets use deterministic secp256k1 keys, BIP-39 recovery, strict nonce ordering, explicit permissions, and are compatible with mobile, web, and hardware environments.