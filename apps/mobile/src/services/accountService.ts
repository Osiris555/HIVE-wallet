// FILE: apps/mobile/src/services/accountService.ts
// TYPE: TypeScript (React Native / Expo)
// PURPOSE: Fetch balances and transaction history for HONEY accounts

import { getBalance } from './rpcClient';

// -----------------------------
// Types
// -----------------------------

export interface HoneyBalance {
  address: string;
  balance: string; // string to avoid floating point errors
}

export interface HoneyTransaction {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  timestamp: number; // unix timestamp (seconds)
  status: 'pending' | 'confirmed' | 'failed';
}

// -----------------------------
// Configuration
// -----------------------------

// NOTE:
// In Phase 0, transaction history is fetched via RPC/indexer.
// This placeholder endpoint can later be swapped for a full indexer
// without changing UI or wallet logic.

const DEVNET_INDEXER_URL = 'https://devnet.honeychain.io/indexer';

// -----------------------------
// Balance Service
// -----------------------------

export async function fetchHoneyBalance(address: string): Promise<HoneyBalance> {
  const balance = await getBalance(address);

  return {
    address,
    balance,
  };
}

// -----------------------------
// Transaction History Service
// -----------------------------

export async function fetchTransactionHistory(
  address: string
): Promise<HoneyTransaction[]> {
  const response = await fetch(`${DEVNET_INDEXER_URL}/txs?address=${address}`);

  if (!response.ok) {
    throw new Error('Failed to fetch transaction history');
  }

  const data = await response.json();

  // Expected response shape (example):
  // [
  //   { txHash, from, to, amount, timestamp, status }
  // ]

  return data as HoneyTransaction[];
}

// -----------------------------
// Auto-Refresh Helper (Optional)
// -----------------------------

export async function pollAccountState(
  address: string,
  intervalMs: number,
  onUpdate: (balance: HoneyBalance, txs: HoneyTransaction[]) => void
): Promise<() => void> {
  let active = true;

  async function poll() {
    if (!active) return;

    try {
      const [balance, txs] = await Promise.all([
        fetchHoneyBalance(address),
        fetchTransactionHistory(address),
      ]);

      onUpdate(balance, txs);
    } catch (err) {
      // Silently fail; UI can decide how to show errors
      console.warn('Account polling error', err);
    }

    setTimeout(poll, intervalMs);
  }

  poll();

  // Return cleanup function
  return () => {
    active = false;
  };
}

// -----------------------------
// DESIGN & SECURITY NOTES
// -----------------------------
// - Balances are always sourced from chain
// - History is read-only (indexer)
// - No private data leaves device
// - Indexer can be replaced without refactors
