import { getLedger } from "../chain/ledger";

export function getBalance(address: string): number {
  return getLedger().reduce((balance, tx) => {
    if (tx.to === address) return balance + tx.amount;
    if (tx.from === address) return balance - tx.amount;
    return balance;
  }, 0);
}
