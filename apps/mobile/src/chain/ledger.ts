import { Transaction } from "./types";

const ledger: Transaction[] = [];

export function appendTransaction(tx: Transaction) {
  ledger.push(tx);
}

export function getLedger(): Transaction[] {
  return [...ledger];
}
