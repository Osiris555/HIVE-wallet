// txHelper.ts — builds canonical messages, fetches nonce/fees, and submits txs for platform auth users.
// Used by all honey.trade pages that need server-side ML-DSA-65 signing.

const API_BASE = process.env.NEXT_PUBLIC_HIVE_API || 'http://localhost:3000';

// ── Types ─────────────────────────────────────────────────────────────────

export type SignFn = (
  message: string,
  opts?: { title?: string; description?: string },
) => Promise<{ signatureHex: string; mldsaPubKeyHex: string; wallet: string }>;

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt8(n: number): string { return Number(n).toFixed(8); }

/**
 * Builds the canonical signed message:
 * chainId|type|from|to|amount|nonce|gasFee|serviceFee|expiresAtMs|timestamp|metaJson
 */
function canonicalMsg(params: {
  chainId: string; type: string; from: string; to: string;
  amount: number; nonce: number; gasFee: number; serviceFee: number;
  expiresAtMs: number; timestamp: number; metaJson?: string;
}): string {
  return [
    params.chainId, params.type, params.from, params.to,
    fmt8(params.amount), String(params.nonce),
    fmt8(params.gasFee), fmt8(params.serviceFee),
    String(params.expiresAtMs), String(params.timestamp),
    params.metaJson ?? '',
  ].join('|');
}

/** Fetch chainId + minGasFee from /status */
async function getStatus(): Promise<{ chainId: string; minGasFee: number }> {
  const r = await fetch(`${API_BASE}/status`).then(r => r.json());
  return { chainId: String(r.chainId ?? '1'), minGasFee: Number(r.minGasFee ?? 0.00000001) };
}

/** Fetch current nonce for a wallet */
async function getNonce(wallet: string): Promise<number> {
  const r = await fetch(`${API_BASE}/account/${wallet}`).then(r => r.json());
  return Number(r.nonce ?? 0);
}

// ── AMM Swap ──────────────────────────────────────────────────────────────

export async function executeSwap(params: {
  wallet: string; tokenIn: string; tokenOut: string;
  amountIn: number; minAmountOut?: number;
}, sign: SignFn): Promise<{ success: boolean; expectedAmountOut: number }> {
  const { wallet, tokenIn, tokenOut, amountIn, minAmountOut = 0 } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const serviceFee = 0; // server computes actual
  const expiresAtMs = ts + 60_000;
  const metaJson = JSON.stringify({ tokenIn, tokenOut, amountIn, minAmountOut });

  const msg = canonicalMsg({ chainId, type: 'swap', from: wallet, to: wallet, amount: amountIn, nonce, gasFee, serviceFee, expiresAtMs, timestamp: ts, metaJson });
  const sig = await sign(msg, { title: 'Swap Tokens', description: `Swap ${amountIn} ${tokenIn} → ${tokenOut}` });

  const resp = await fetch(`${API_BASE}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, tokenIn, tokenOut, amountIn, minAmountOut, nonce, timestamp: ts,
      chainId, gasFee, serviceFee, expiresAtMs, metaJson,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true, expectedAmountOut: data.expectedAmountOut ?? 0 };
}

// ── Futures Open ──────────────────────────────────────────────────────────

export async function executeFuturesOpen(params: {
  wallet: string; marketId: string; side: 'long' | 'short';
  sizeHny: number; leverage: number;
}, sign: SignFn): Promise<{ success: boolean; positionId: string }> {
  const { wallet, marketId, side, sizeHny, leverage } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const expiresAtMs = ts + 60_000;
  const metaJson = JSON.stringify({ marketId, side, leverage });

  const msg = canonicalMsg({ chainId, type: 'futures_open', from: wallet, to: wallet, amount: sizeHny, nonce, gasFee, serviceFee: 0, expiresAtMs, timestamp: ts, metaJson });
  const sig = await sign(msg, { title: 'Open Futures Position', description: `${side.toUpperCase()} ${sizeHny} HNY @ ${leverage}x on ${marketId}` });

  const resp = await fetch(`${API_BASE}/futures/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, market_id: marketId, side, size_hny: sizeHny, leverage, nonce, timestamp: ts,
      chainId, gasFee, expiresAtMs, metaJson,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true, positionId: data.position?.id ?? '' };
}

// ── Futures Close ─────────────────────────────────────────────────────────

export async function executeFuturesClose(params: {
  wallet: string; positionId: string;
}, sign: SignFn): Promise<{ success: boolean; pnl: number }> {
  const { wallet, positionId } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const expiresAtMs = ts + 60_000;
  const metaJson = JSON.stringify({ positionId });

  const msg = canonicalMsg({ chainId, type: 'futures_close', from: wallet, to: wallet, amount: 0, nonce, gasFee, serviceFee: 0, expiresAtMs, timestamp: ts, metaJson });
  const sig = await sign(msg, { title: 'Close Position', description: `Close position ${positionId}` });

  const resp = await fetch(`${API_BASE}/futures/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, position_id: positionId, nonce, timestamp: ts,
      chainId, gasFee, expiresAtMs, metaJson,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true, pnl: data.realized_pnl ?? 0 };
}

// ── Stake ─────────────────────────────────────────────────────────────────

export async function executeStake(params: {
  wallet: string; amount: number;
}, sign: SignFn): Promise<{ success: boolean }> {
  const { wallet, amount } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const expiresAtMs = ts + 60_000;

  const msg = canonicalMsg({ chainId, type: 'stake', from: wallet, to: wallet, amount, nonce, gasFee, serviceFee: 0, expiresAtMs, timestamp: ts });
  const sig = await sign(msg, { title: 'Stake HNY', description: `Stake ${amount} HNY → stHNY` });

  const resp = await fetch(`${API_BASE}/stake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, amount, nonce, timestamp: ts, chainId, gasFee, expiresAtMs,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true };
}

// ── Unstake ───────────────────────────────────────────────────────────────

export async function executeUnstake(params: {
  wallet: string; amount: number;
}, sign: SignFn): Promise<{ success: boolean }> {
  const { wallet, amount } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const expiresAtMs = ts + 60_000;

  const msg = canonicalMsg({ chainId, type: 'unstake', from: wallet, to: wallet, amount, nonce, gasFee, serviceFee: 0, expiresAtMs, timestamp: ts });
  const sig = await sign(msg, { title: 'Unstake stHNY', description: `Unstake ${amount} stHNY → HNY` });

  const resp = await fetch(`${API_BASE}/unstake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, amount, nonce, timestamp: ts, chainId, gasFee, expiresAtMs,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true };
}

// ── Add Liquidity ─────────────────────────────────────────────────────────

export async function executeAddLiquidity(params: {
  wallet: string; tokenA: string; tokenB: string; amountA: number; amountB: number;
}, sign: SignFn): Promise<{ success: boolean }> {
  const { wallet, tokenA, tokenB, amountA, amountB } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const expiresAtMs = ts + 60_000;
  const metaJson = JSON.stringify({ tokenA, tokenB, amountA, amountB });

  const msg = canonicalMsg({ chainId, type: 'liquidity_add', from: wallet, to: wallet, amount: amountA + amountB, nonce, gasFee, serviceFee: 0, expiresAtMs, timestamp: ts, metaJson });
  const sig = await sign(msg, { title: 'Add Liquidity', description: `Add ${amountA} ${tokenA} + ${amountB} ${tokenB}` });

  const resp = await fetch(`${API_BASE}/liquidity/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, tokenA, tokenB, amountA, amountB, nonce, timestamp: ts,
      chainId, gasFee, expiresAtMs, metaJson,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true };
}

// ── Launchpad Buy ─────────────────────────────────────────────────────────

export async function executeLaunchpadBuy(params: {
  wallet: string; tokenId: string; hnyAmount: number;
}, sign: SignFn): Promise<{ success: boolean; tokensReceived: number }> {
  const { wallet, tokenId, hnyAmount } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const expiresAtMs = ts + 60_000;
  const metaJson = JSON.stringify({ tokenId });

  const msg = canonicalMsg({ chainId, type: 'launchpad_buy', from: wallet, to: wallet, amount: hnyAmount, nonce, gasFee, serviceFee: 0, expiresAtMs, timestamp: ts, metaJson });
  const sig = await sign(msg, { title: 'Buy Token', description: `Spend ${hnyAmount} HNY on token ${tokenId}` });

  const resp = await fetch(`${API_BASE}/launchpad/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, tokenId, hnyAmount, nonce, timestamp: ts,
      chainId, gasFee, expiresAtMs, metaJson,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true, tokensReceived: data.tokensReceived ?? 0 };
}

// ── Launchpad Sell ────────────────────────────────────────────────────────

export async function executeLaunchpadSell(params: {
  wallet: string; tokenId: string; tokenAmount: number;
}, sign: SignFn): Promise<{ success: boolean; hnyReceived: number }> {
  const { wallet, tokenId, tokenAmount } = params;
  const [{ chainId, minGasFee }, nonce] = await Promise.all([getStatus(), getNonce(wallet)]);
  const ts = Date.now();
  const gasFee = minGasFee;
  const expiresAtMs = ts + 60_000;
  const metaJson = JSON.stringify({ tokenId });

  const msg = canonicalMsg({ chainId, type: 'launchpad_sell', from: wallet, to: wallet, amount: tokenAmount, nonce, gasFee, serviceFee: 0, expiresAtMs, timestamp: ts, metaJson });
  const sig = await sign(msg, { title: 'Sell Token', description: `Sell ${tokenAmount} tokens (id: ${tokenId})` });

  const resp = await fetch(`${API_BASE}/launchpad/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, tokenId, tokenAmount, nonce, timestamp: ts,
      chainId, gasFee, expiresAtMs, metaJson,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true, hnyReceived: data.hnyReceived ?? 0 };
}

// ── DAO Vote ──────────────────────────────────────────────────────────────

export async function executeDAOVote(params: {
  wallet: string; proposalId: string; vote: 'yes' | 'no' | 'abstain'; mldsaPubKeyHex: string;
}, sign: SignFn): Promise<{ success: boolean }> {
  const { wallet, proposalId, vote, mldsaPubKeyHex: pubKey } = params;
  const ts = Date.now();
  const voteMsg = `dao_vote|${wallet}|${proposalId}|${vote}|${ts}`;
  const sig = await sign(voteMsg, { title: 'Cast Vote', description: `Vote ${vote.toUpperCase()} on proposal #${proposalId}` });

  const resp = await fetch(`${API_BASE}/dao/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet, proposalId, vote, timestamp: ts,
      signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex || pubKey,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
  return { success: true };
}
