// apps/mobile/src/chain/evm-provider.ts
// EVM network provider: JSON-RPC helpers, ERC-20 balances, Basescan tx history, 0x swap quotes.
// All calls via plain fetch() — no ethers.js dependency.

import { encodeBalanceOf } from "./evm-wallet";

// ── Types ──────────────────────────────────────────────────────────────────

export type EvmTransaction = {
  hash: string;
  from: string;
  to: string;
  value: string;           // wei as decimal string
  timeStamp: string;       // unix seconds
  isError: string;         // "0" = success, "1" = failed
  functionName: string;    // e.g. "transfer(address,uint256)" or ""
  contractAddress?: string; // ERC-20 contract address (tokentx endpoint only)
  tokenSymbol?: string;    // ERC-20 symbol (tokentx only)
  tokenDecimal?: string;   // ERC-20 decimals as string (tokentx only)
  tokenName?: string;      // ERC-20 full name (tokentx only)
};

/** A single ERC-20 token holding with full display metadata. */
export type EvmTokenHolding = {
  balance:  bigint;
  decimals: number;
  address:  string;  // contract address (lowercase)
  symbol:   string;
  name?:    string;
};

export type EvmSwapQuote = {
  to: string;           // contract to call
  data: string;         // calldata
  value: bigint;        // ETH to send with call (wei)
  estimatedGas: bigint;
  buyAmount: bigint;    // token units received
  price: string;        // human-readable rate e.g. "1 ETH = 3200 USDC"
  sellToken: string;
  buyToken: string;
};

export type EvmGasEstimateInput = {
  to: string;
  value: bigint;
  data: string;
  from?: string;
};

// ── Token Definitions ──────────────────────────────────────────────────────

export type EvmTokenInfo = {
  address: string;
  decimals: number;
  chainId: number;
  symbol: string;
};

// Canonical token list for Base Mainnet (8453) and Base Sepolia (84532).
// Keyed by display symbol. WETH and ETH share same decimal representation.
export const BASE_TOKENS: Record<string, EvmTokenInfo> = {
  // Base Mainnet
  USDC:  { symbol: "USDC",  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  chainId: 8453 },
  USDbC: { symbol: "USDbC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6,  chainId: 8453 },
  WETH:  { symbol: "WETH",  address: "0x4200000000000000000000000000000000000006", decimals: 18, chainId: 8453 },
  cbETH: { symbol: "cbETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18, chainId: 8453 },
  DAI:   { symbol: "DAI",   address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, chainId: 8453 },
  // Base Sepolia
  USDC_SEP: { symbol: "USDC",  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6,  chainId: 84532 },
  WETH_SEP: { symbol: "WETH",  address: "0x4200000000000000000000000000000000000006", decimals: 18, chainId: 84532 },
};

/** Returns token infos for a given chainId, deduplicated by symbol. */
export function getTokensForChain(chainId: number): EvmTokenInfo[] {
  return Object.values(BASE_TOKENS).filter(t => t.chainId === chainId);
}

// ── Core JSON-RPC ──────────────────────────────────────────────────────────

let _rpcId = 1;

export async function evmRpc(rpcUrl: string, method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: _rpcId++, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} on ${method}`);
  const json: any = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result;
}

// ── Balance Queries ────────────────────────────────────────────────────────

export async function evmGetChainId(rpcUrl: string): Promise<number> {
  const result = await evmRpc(rpcUrl, "eth_chainId") as string;
  return Number(BigInt(result));
}

/** Returns native ETH balance in wei. */
export async function evmGetBalance(address: string, rpcUrl: string): Promise<bigint> {
  const result = await evmRpc(rpcUrl, "eth_getBalance", [address, "latest"]) as string;
  return BigInt(result);
}

/** Returns ERC-20 token balance in token's smallest unit (wei/satoshi equivalent). */
export async function evmGetTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  rpcUrl: string,
): Promise<bigint> {
  const data = encodeBalanceOf(walletAddress);
  const result = await evmRpc(rpcUrl, "eth_call", [
    { to: tokenAddress, data },
    "latest",
  ]) as string;
  if (!result || result === "0x") return 0n;
  return BigInt(result);
}

/**
 * Fetches all known token balances for the given chainId in parallel.
 * Returns a map of symbol → raw balance (BigInt, unscaled).
 */
export async function evmGetAllTokenBalances(
  walletAddress: string,
  rpcUrl: string,
  chainId: number,
): Promise<Record<string, bigint>> {
  const tokens = getTokensForChain(chainId);
  const results = await Promise.allSettled(
    tokens.map(t => evmGetTokenBalance(t.address, walletAddress, rpcUrl))
  );
  const out: Record<string, bigint> = {};
  for (let i = 0; i < tokens.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value > 0n) {
      out[tokens[i].symbol] = r.value;
    }
  }
  return out;
}

/**
 * Discovers ALL ERC-20 tokens held by a wallet address by combining:
 *   (a) The hardcoded BASE_TOKENS list for the chainId
 *   (b) Any token contract the address appears in via Basescan tokentx history
 *
 * For each unique token found, queries the current on-chain balance.
 * Returns only tokens with a non-zero balance, keyed by symbol.
 * Includes full metadata (decimals, address, name) needed for display.
 */
export async function evmDiscoverTokenBalances(
  walletAddress: string,
  rpcUrl: string,
  chainId: number,
  apiKey?: string,
): Promise<Record<string, EvmTokenHolding>> {
  // Seed with known tokens for this chain (address → info)
  const known = new Map<string, { symbol: string; decimals: number; name?: string }>();
  for (const t of getTokensForChain(chainId)) {
    known.set(t.address.toLowerCase(), { symbol: t.symbol, decimals: t.decimals });
  }

  // Augment with tokens discovered from Basescan ERC-20 transfer history.
  // This surfaces any token the wallet has ever received, regardless of the static list.
  const transfers = await evmGetTokenTransfers(walletAddress, chainId, apiKey).catch(() => [] as EvmTransaction[]);
  for (const tx of transfers) {
    if (!tx.contractAddress) continue;
    const addr = tx.contractAddress.toLowerCase();
    if (!known.has(addr) && tx.tokenSymbol) {
      known.set(addr, {
        symbol  : tx.tokenSymbol,
        decimals: parseInt(tx.tokenDecimal ?? "18", 10),
        name    : tx.tokenName,
      });
    }
  }

  // Query on-chain balance for every discovered token in parallel.
  const entries = Array.from(known.entries());
  const results = await Promise.allSettled(
    entries.map(([addr]) => evmGetTokenBalance(addr, walletAddress, rpcUrl))
  );

  const out: Record<string, EvmTokenHolding> = {};
  for (let i = 0; i < entries.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled" || r.value === 0n) continue;
    const [addr, info] = entries[i];
    // If two tokens share a symbol (e.g. bridged vs native USDC), disambiguate with contract prefix.
    const key = out[info.symbol] ? `${info.symbol}_${addr.slice(2, 6).toUpperCase()}` : info.symbol;
    out[key] = { balance: r.value, decimals: info.decimals, address: addr, symbol: info.symbol, name: info.name };
  }
  return out;
}

// ── Transaction Submission ─────────────────────────────────────────────────

export async function evmGetNonce(address: string, rpcUrl: string): Promise<bigint> {
  const result = await evmRpc(rpcUrl, "eth_getTransactionCount", [address, "pending"]) as string;
  return BigInt(result);
}

export async function evmGetFeeData(rpcUrl: string): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const [block, priorityFeeHex] = await Promise.all([
    evmRpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]) as Promise<any>,
    evmRpc(rpcUrl, "eth_maxPriorityFeePerGas") as Promise<string>,
  ]);
  const baseFee = BigInt(block?.baseFeePerGas ?? "0x0");
  const priorityFee = BigInt(priorityFeeHex ?? "0x0");
  // maxFeePerGas = 2× baseFee + priorityFee (generous buffer for base fee fluctuation)
  const maxFeePerGas = baseFee * 2n + priorityFee;
  return { maxFeePerGas, maxPriorityFeePerGas: priorityFee };
}

export async function evmEstimateGas(tx: EvmGasEstimateInput, rpcUrl: string): Promise<bigint> {
  const params: any = {
    to: tx.to,
    value: "0x" + tx.value.toString(16),
    data: tx.data,
  };
  if (tx.from) params.from = tx.from;
  const result = await evmRpc(rpcUrl, "eth_estimateGas", [params]) as string;
  // Add 20% buffer
  return (BigInt(result) * 12n) / 10n;
}

/** Broadcasts a signed raw transaction. Returns tx hash. */
export async function evmSendRawTransaction(signedHex: string, rpcUrl: string): Promise<string> {
  return await evmRpc(rpcUrl, "eth_sendRawTransaction", [signedHex]) as string;
}

// ── Transaction History (Basescan API) ────────────────────────────────────

const BASESCAN_URLS: Record<number, string> = {
  8453:  "https://api.basescan.org/api",
  84532: "https://api-sepolia.basescan.org/api",
};

/**
 * Fetches the last 50 normal (ETH) transactions for the address via Basescan.
 * Falls back to empty array if the API is unavailable or rate-limited.
 */
export async function evmGetTransactions(
  address: string,
  chainId: number,
  apiKey?: string,
): Promise<EvmTransaction[]> {
  const baseUrl = BASESCAN_URLS[chainId];
  if (!baseUrl) return [];
  const key = apiKey || ""; // works without key (rate limited)
  const url =
    `${baseUrl}?module=account&action=txlist` +
    `&address=${address}&startblock=0&endblock=99999999` +
    `&sort=desc&count=50` +
    (key ? `&apikey=${key}` : "");
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: any = await res.json();
    if (json.status !== "1" || !Array.isArray(json.result)) return [];
    return json.result as EvmTransaction[];
  } catch {
    return [];
  }
}

/**
 * Fetches ERC-20 token transfer events via Basescan.
 * Falls back to empty array on error.
 */
export async function evmGetTokenTransfers(
  address: string,
  chainId: number,
  apiKey?: string,
): Promise<EvmTransaction[]> {
  const baseUrl = BASESCAN_URLS[chainId];
  if (!baseUrl) return [];
  const key = apiKey || "";
  const url =
    `${baseUrl}?module=account&action=tokentx` +
    `&address=${address}&startblock=0&endblock=99999999` +
    `&sort=desc&count=50` +
    (key ? `&apikey=${key}` : "");
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: any = await res.json();
    if (json.status !== "1" || !Array.isArray(json.result)) return [];
    return json.result as EvmTransaction[];
  } catch {
    return [];
  }
}

// ── 0x Protocol Swap Quotes ────────────────────────────────────────────────

const ZEROX_URLS: Record<number, string> = {
  8453:  "https://base.api.0x.org/swap/permit2/quote",
  84532: "https://base-sepolia.api.0x.org/swap/permit2/quote",
};

export type EvmSwapParams = {
  sellToken: string;  // symbol like "ETH" or ERC-20 address
  buyToken: string;
  sellAmount: bigint; // in smallest unit (wei for ETH)
  takerAddress: string;
};

/**
 * Get a swap quote from 0x Protocol. Returns a ready-to-sign transaction.
 * On failure, throws with a descriptive message.
 */
export async function evmGetSwapQuote(
  params: EvmSwapParams,
  chainId: number,
): Promise<EvmSwapQuote> {
  const baseUrl = ZEROX_URLS[chainId];
  if (!baseUrl) throw new Error(`No 0x endpoint for chainId ${chainId}`);

  // Resolve token symbols to addresses
  const sellAddr = resolveTokenAddress(params.sellToken, chainId);
  const buyAddr  = resolveTokenAddress(params.buyToken,  chainId);

  const url =
    `${baseUrl}?sellToken=${sellAddr}` +
    `&buyToken=${buyAddr}` +
    `&sellAmount=${params.sellAmount.toString()}` +
    `&taker=${params.takerAddress}` +
    `&chainId=${chainId}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "0x-api-version": "2" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`0x swap quote failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json: any = await res.json();

  // 0x v2 response has transaction inside json.transaction
  const tx = json.transaction ?? json;
  const buyAmount = BigInt(json.buyAmount ?? json.minBuyAmount ?? "0");
  const sellDecimals = getTokenDecimals(params.sellToken, chainId);
  const buyDecimals  = getTokenDecimals(params.buyToken,  chainId);
  const rate = buyAmount > 0n
    ? (Number(buyAmount) / 10 ** buyDecimals) /
      (Number(params.sellAmount) / 10 ** sellDecimals)
    : 0;
  const price = `1 ${params.sellToken} ≈ ${rate.toFixed(4)} ${params.buyToken}`;

  return {
    to:           tx.to,
    data:         tx.data,
    value:        BigInt(tx.value ?? "0"),
    estimatedGas: BigInt(tx.gas ?? json.estimatedGas ?? "200000"),
    buyAmount,
    price,
    sellToken: params.sellToken,
    buyToken:  params.buyToken,
  };
}

// ── Token Helpers ──────────────────────────────────────────────────────────

function resolveTokenAddress(symbolOrAddress: string, chainId: number): string {
  if (symbolOrAddress.startsWith("0x")) return symbolOrAddress;
  if (symbolOrAddress.toUpperCase() === "ETH") return "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const token = Object.values(BASE_TOKENS).find(
    t => t.symbol.toUpperCase() === symbolOrAddress.toUpperCase() && t.chainId === chainId
  );
  if (token) return token.address;
  return symbolOrAddress; // pass through if not found
}

function getTokenDecimals(symbolOrAddress: string, chainId: number): number {
  if (symbolOrAddress.toUpperCase() === "ETH") return 18;
  const token = Object.values(BASE_TOKENS).find(
    t => (t.symbol.toUpperCase() === symbolOrAddress.toUpperCase() ||
          t.address.toLowerCase() === symbolOrAddress.toLowerCase()) &&
         t.chainId === chainId
  );
  return token?.decimals ?? 18;
}

// ── Formatting Helpers ─────────────────────────────────────────────────────

/** Format wei as a human-readable ETH string, up to 6 decimal places. */
export function formatEth(wei: bigint, decimals = 6): string {
  const eth = Number(wei) / 1e18;
  if (eth === 0) return "0";
  if (eth < 0.000001) return "< 0.000001";
  return eth.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Format a raw token amount given its decimals. */
export function formatTokenAmount(raw: bigint, decimals: number, displayDecimals = 4): string {
  const val = Number(raw) / 10 ** decimals;
  if (val === 0) return "0";
  if (val < Math.pow(10, -displayDecimals)) return `< ${Math.pow(10, -displayDecimals)}`;
  return val.toFixed(displayDecimals).replace(/\.?0+$/, "");
}
