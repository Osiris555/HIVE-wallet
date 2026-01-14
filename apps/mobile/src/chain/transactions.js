// apps/mobile/src/chain/transactions.js

type TxType = "mint" | "send";

export type Transaction = {
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  type: TxType;
};

const balances: Record<string, number> = {};
const transactions: Transaction[] = [];
const API_BASE = "http://192.168.0.11:3000";


const FAUCET_AMOUNT = 100;

export function getBalance(address: string): number {
  return balances[address] || 0;
}

export function mint(address: string): { amount: number } {
  balances[address] = getBalance(address) + FAUCET_AMOUNT;

  transactions.push({
    from: "FAUCET",
    to: address,
    amount: FAUCET_AMOUNT,
    timestamp: Date.now(),
    type: "mint",
  });

  return { amount: FAUCET_AMOUNT };
}

export function send(
  from: string,
  to: string,
  amount: number
): { success: boolean } {
  const fromBalance = getBalance(from);

  if (fromBalance < amount) {
    throw new Error("Insufficient balance");
  }

  balances[from] = fromBalance - amount;
  balances[to] = getBalance(to) + amount;

  transactions.push({
    from,
    to,
    amount,
    timestamp: Date.now(),
    type: "send",
  });

  return { success: true };
}

export function getTransactions(address: string): Transaction[] {
  return transactions.filter(
    (tx) => tx.from === address || tx.to === address
  );
}
