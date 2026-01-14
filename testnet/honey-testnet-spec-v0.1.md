\# 🐝 Honey Testnet – Technical Specification (v0.1)



\## 1. Purpose



Honey Testnet is a developer-focused blockchain environment designed to validate Honey (HNY) core mechanics before mainnet launch. It prioritizes clarity, debuggability, and rapid iteration over decentralization guarantees.



---



\## 2. Core Design Principles



\* \*\*State-first\*\*: Balances and transactions are authoritative on-chain state

\* \*\*Wallet-agnostic\*\*: Any wallet controlling a valid private key can interact

\* \*\*Hot-wallet default\*\*: HIVE Wallet is the primary Testnet wallet

\* \*\*Ledger optional\*\*: Hardware signing is supported later, not required

\* \*\*Deterministic rules\*\*: No hidden logic, all transitions explicit



---



\## 3. Address Format



```

HNY\_<ROLE>\_<UNIQUE>

```



Examples:



\* `HNY\_DEV\_WALLET`

\* `HNY\_USER\_abc123`

\* `HNY\_VALIDATOR\_01`

\* `HNY\_TREASURY`



---



\## 4. Token



\* \*\*Symbol\*\*: HNY

\* \*\*Decimals\*\*: 2 (testnet default)

\* \*\*Supply Model\*\*: Minted via genesis + faucet



---



\## 5. State Objects



\### 5.1 Balances



```ts

balances: Record<string, number>

```



\### 5.2 Transactions



```ts

type TransactionStatus = "pending" | "confirmed";



interface Transaction {

&nbsp; id: string;

&nbsp; from: string;

&nbsp; to: string;

&nbsp; amount: number;

&nbsp; fee: number;

&nbsp; status: TransactionStatus;

&nbsp; confirmations?: number;

&nbsp; timestamp: number;

}

```



---



\## 6. Fees



\* \*\*Flat validator fee\*\*: `0.01 HNY`

\* Fee is paid by sender

\* Fee is credited to `HNY\_VALIDATOR`



---



\## 7. Transaction Lifecycle



1\. \*\*Create\*\* → status = `pending`

2\. \*\*Apply balances immediately\*\* (optimistic execution)

3\. \*\*Confirm after delay\*\* (simulated block)

4\. Increment `confirmations`

5\. status → `confirmed`



---



\## 8. Wallet Responsibilities (HIVE Wallet)



\* Generate / store private keys

\* Sign transactions (logical for now)

\* Display balances

\* Display transaction history

\* Submit transactions to chain



> Wallet does NOT store tokens — only keys



---



\## 9. Validator Model (Testnet)



\* Single default validator:



&nbsp; ```

&nbsp; HNY\_VALIDATOR

&nbsp; ```

\* Receives all fees

\* Confirmation simulated by timer



---



\## 10. Ledger (Out of Scope for v0.1)



Ledger support is explicitly \*\*not required\*\* for Testnet.

It will be added later as a signing backend once tx formats stabilize.



---



\## 11. Non-Goals (v0.1)



\* Slashing

\* Governance

\* Real networking

\* Consensus algorithms



---



\## 12. Status



\*\*Honey Testnet v0.1 is a controlled, deterministic, developer-first environment.\*\*



