// FILE: apps/mobile/src/services/rpcClient.ts
// TYPE: TypeScript (React Native / Expo)
// PURPOSE: Devnet RPC client for communicating with the HONEY blockchain

// -----------------------------
// Configuration
// -----------------------------

// IMPORTANT:
// This is a DEVNET endpoint placeholder.
// You can change this URL later without touching any other wallet code.

const DEVNET_RPC_URL = 'https://devnet.honeychain.io/rpc';

// -----------------------------
// Types
// -----------------------------

export interface RpcResponse<T> {
  result: T;
  error?: string;
}

export interface BalanceResponse {
  address: string;
  balance: string; // string to avoid floating point errors
}

export interface TxBroadcastResponse {
  txHash: string;
}

// -----------------------------
// Internal Helper
// -----------------------------

async function rpcRequest<T>(method: string, params: any): Promise<T> {
  const response = await fetch(DEVNET_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error('Network error while contacting HONEY devnet');
  }

  const data: RpcResponse<T> = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}

// -----------------------------
// Public RPC Methods
// -----------------------------

// Fetch HONEY balance for an address
export async function getBalance(address: string): Promise<string> {
  const result = await rpcRequest<BalanceResponse>('honey_getBalance', {
    address,
  });

  return result.balance;
}

// Broadcast a signed transaction to the network
export async function broadcastTransaction(
  signedTxHex: string
): Promise<string> {
  const result = await rpcRequest<TxBroadcastResponse>('honey_sendRawTransaction', {
    tx: signedTxHex,
  });

  return result.txHash;
}

// -----------------------------
// DESIGN & SECURITY NOTES
// -----------------------------
// - Wallet never trusts RPC blindly
// - All signing happens locally
// - RPC only sees public data
// - URL is easily swappable (mainnet/testnet)
