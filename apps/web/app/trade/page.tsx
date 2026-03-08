'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import ActionModal from '@/components/ActionModal';
import PriceChart from '@/components/PriceChart';
import { getPrices, getPools, getRecentSwaps, getOrderbook, getOrderbookTrades } from '@/lib/api';
import type { Pool, TokenPrice, RecentSwap, NftSummary, OrderbookSnapshot, OrderbookTrade } from '@/lib/types';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import { useSign } from '@/hooks/useSign';
import { executeSwap } from '@/lib/txHelper';

// ── AMM math (same formula as server) ────────────────────
function ammOutput(reserveIn: number, reserveOut: number, amountIn: number, fee = 0.003): number {
  if (!reserveIn || !reserveOut || !amountIn) return 0;
  const amountInWithFee = amountIn * (1 - fee);
  return (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
}

function ammPrice(reserveA: number, reserveB: number): number {
  return reserveA > 0 ? reserveB / reserveA : 0;
}

const TOKEN_COLORS: Record<string, string> = {
  HNY: '#f5b429',
  stHNY: '#39ff14',
  LPHNY: '#4a9eff',
  USDT: '#26a17b',
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#9945ff',
  BNB: '#f3ba2f',
  AVAX: '#e84142',
};

function tokenColor(symbol: string) {
  return TOKEN_COLORS[symbol] ?? '#e8f0e4';
}

// Dummy NFT summary shape for ActionModal reuse
function makeSwapNft(fromToken: string, toToken: string, fromAmount: number): NftSummary {
  return {
    id: `swap-${fromToken}-${toToken}`,
    name: `Swap ${fromAmount} ${fromToken} → ${toToken}`,
    description: '',
    ai_description: '',
    media_type: 'photo',
    creator_wallet: '',
    owner_wallet: '',
    royalty_bps: 0,
    listed_price_hny: null,
    listed_at: null,
    minted_at: '',
    transfer_count: 0,
    collection_id: null,
    auction_id: null,
    file_count: 0,
  };
}


export default function TradePage() {
  const { isAuthUser, address } = useHiveWallet();
  const { sign, sigModal } = useSign();

  const [prices, setPrices] = useState<Record<string, TokenPrice>>({});
  const [pools, setPools] = useState<Pool[]>([]);
  const [recentSwaps, setRecentSwaps] = useState<RecentSwap[]>([]);
  const [offline, setOffline] = useState(false);

  // Swap form state
  const [fromToken, setFromToken] = useState('HNY');
  const [toToken, setToToken] = useState('USDT');
  const [fromAmount, setFromAmount] = useState('');
  const [actionTarget, setActionTarget] = useState<NftSummary | null>(null);
  const [swapExtStatus, setSwapExtStatus] = useState<'idle'|'pending'|'success'|'error'>('idle');
  const [swapExtError, setSwapExtError] = useState('');

  // Order book state
  const [orderbook, setOrderbook] = useState<OrderbookSnapshot | null>(null);
  const [obTrades, setObTrades] = useState<OrderbookTrade[]>([]);
  const [obTab, setObTab] = useState<'book' | 'limit' | 'fills'>('book');
  const [limitSide, setLimitSide] = useState<'buy' | 'sell'>('buy');
  const [limitPrice, setLimitPrice] = useState('');
  const [limitSize, setLimitSize] = useState('');
  const [limitAction, setLimitAction] = useState<NftSummary | null>(null);

  const load = useCallback(async () => {
    setOffline(false);
    try {
      const [p, pl, rs] = await Promise.all([
        getPrices().catch(() => ({ prices: {} })),
        getPools().catch(() => ({ pools: [] })),
        getRecentSwaps().catch(() => ({ swaps: [] })),
      ]);
      setPrices(p.prices ?? {});
      setPools(pl.pools ?? []);
      setRecentSwaps(rs.swaps ?? []);
    } catch {
      setOffline(true);
    }
  }, []);

  // Load order book for the selected pair
  const pair = `${fromToken}/${toToken}`;
  const loadOrderbook = useCallback(async () => {
    try {
      const [ob, fills] = await Promise.all([
        getOrderbook(pair).catch(() => null),
        getOrderbookTrades(pair).catch(() => ({ trades: [] })),
      ]);
      if (ob) setOrderbook(ob);
      setObTrades(fills.trades ?? []);
    } catch { /* server may be offline */ }
  }, [pair]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    loadOrderbook();
    const id = setInterval(loadOrderbook, 5000);
    return () => clearInterval(id);
  }, [loadOrderbook]);

  // Find the pool for the selected pair
  const selectedPool = pools.find(
    (p) =>
      (p.tokenA === fromToken && p.tokenB === toToken) ||
      (p.tokenA === toToken && p.tokenB === fromToken)
  );

  // Determine reserve direction
  const reserveIn = selectedPool
    ? selectedPool.tokenA === fromToken ? selectedPool.reserveA : selectedPool.reserveB
    : 0;
  const reserveOut = selectedPool
    ? selectedPool.tokenA === fromToken ? selectedPool.reserveB : selectedPool.reserveA
    : 0;

  const numFromAmount = parseFloat(fromAmount) || 0;
  const estimatedOut = ammOutput(reserveIn, reserveOut, numFromAmount, selectedPool?.feeRate ?? 0.003);
  const spotPrice = ammPrice(reserveIn, reserveOut);
  const priceImpact = numFromAmount > 0 && reserveIn > 0
    ? Math.abs((estimatedOut / numFromAmount - spotPrice) / spotPrice) * 100
    : 0;


  // All tokens from prices
  const allTokens = Object.keys(prices).length > 0
    ? Object.keys(prices)
    : ['HNY', 'stHNY', 'LPHNY', 'USDT', 'BTC', 'ETH', 'SOL'];

  // Pair chips from available pools
  const pairChips = pools.map((p) => ({ from: p.tokenA, to: p.tokenB }));

  const tvl = selectedPool
    ? (selectedPool.reserveA * (prices[selectedPool.tokenA]?.price_usd ?? 1) +
       selectedPool.reserveB * (prices[selectedPool.tokenB]?.price_usd ?? 1))
    : 0;

  return (
    <div className="min-h-screen" style={{ paddingTop: 68 }}>
      {/* Chrysalis signing modal (platform auth users) */}
      {sigModal}

      {/* Page header */}
      <div
        className="px-6 pt-10 pb-6"
        style={{ background: 'linear-gradient(180deg, rgba(57,255,20,0.04) 0%, transparent 100%)' }}
      >
        <div className="max-w-7xl mx-auto flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--text)' }}>🍯 Trade</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--sub)' }}>
              Honey Network AMM — swap tokens via native liquidity pools
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className="badge" style={{ background: 'rgba(57,255,20,0.1)', color: 'var(--green)', border: '1px solid var(--border)' }}>
              📋 Order Book Live
            </span>
          </div>
        </div>
      </div>

      {/* Offline warning */}
      {offline && (
        <div className="mx-6 rounded-xl p-3 flex items-center gap-3 mb-4"
          style={{ background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.4)' }}>
          <span>⚠️</span>
          <p className="text-sm" style={{ color: 'var(--danger)' }}>HIVE server offline — make sure <code className="font-mono-hive">node server.js</code> is running</p>
          <button className="ml-auto btn-outline text-xs px-3 py-1" onClick={load}>Retry</button>
        </div>
      )}

      {/* Pair selector chips */}
      <div className="px-6 pb-4">
        <div className="max-w-7xl mx-auto flex gap-2 flex-wrap">
          {pairChips.length === 0
            ? [{ from: 'HNY', to: 'USDT' }, { from: 'stHNY', to: 'HNY' }, { from: 'LPHNY', to: 'HNY' }].map((c) => (
                <button
                  key={`${c.from}/${c.to}`}
                  onClick={() => { setFromToken(c.from); setToToken(c.to); setFromAmount(''); }}
                  className="text-xs px-4 py-1.5 rounded-full font-medium transition-all"
                  style={{
                    background: fromToken === c.from && toToken === c.to ? 'var(--gold)' : 'var(--glass2)',
                    color: fromToken === c.from && toToken === c.to ? '#040507' : 'var(--text)',
                    border: '1px solid var(--border2)',
                  }}
                >
                  {c.from}/{c.to}
                </button>
              ))
            : pairChips.map((c) => (
                <button
                  key={`${c.from}/${c.to}`}
                  onClick={() => { setFromToken(c.from); setToToken(c.to); setFromAmount(''); }}
                  className="text-xs px-4 py-1.5 rounded-full font-medium transition-all"
                  style={{
                    background: fromToken === c.from && toToken === c.to ? 'var(--gold)' : 'var(--glass2)',
                    color: fromToken === c.from && toToken === c.to ? '#040507' : 'var(--text)',
                    border: '1px solid var(--border2)',
                  }}
                >
                  {c.from}/{c.to}
                </button>
              ))
          }
        </div>
      </div>

      {/* Main grid */}
      <div className="max-w-7xl mx-auto px-6 pb-16 grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── LEFT: Swap form ── */}
        <div className="flex flex-col gap-4">

          {/* Price card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-5"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-2xl font-mono-hive" style={{ color: tokenColor(fromToken) }}>
                {fromToken}
              </span>
              <span style={{ color: 'var(--sub)' }}>/</span>
              <span className="font-bold text-2xl font-mono-hive" style={{ color: tokenColor(toToken) }}>
                {toToken}
              </span>
            </div>
            <p className="text-3xl font-bold font-mono-hive mb-1" style={{ color: 'var(--text)' }}>
              {spotPrice > 0 ? spotPrice.toFixed(spotPrice < 0.01 ? 6 : 4) : '—'}
            </p>
            <p className="text-xs" style={{ color: 'var(--sub)' }}>
              1 {fromToken} = {spotPrice > 0 ? spotPrice.toFixed(4) : '?'} {toToken}
            </p>
            {prices[fromToken] && (
              <p className="text-xs mt-1" style={{ color: 'var(--sub)' }}>
                ${prices[fromToken].price_usd.toFixed(4)} USD
              </p>
            )}
          </motion.div>

          {/* Swap calculator */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="glass-card p-5"
          >
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text)' }}>Swap</h3>

            {/* From */}
            <div className="rounded-xl p-3 mb-2" style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: 'var(--sub)' }}>You pay</span>
                <select
                  value={fromToken}
                  onChange={(e) => { setFromToken(e.target.value); setFromAmount(''); }}
                  className="text-xs font-bold bg-transparent border-none outline-none cursor-pointer"
                  style={{ color: tokenColor(fromToken) }}
                >
                  {allTokens.filter((t) => t !== toToken).map((t) => (
                    <option key={t} value={t} style={{ background: '#040507' }}>{t}</option>
                  ))}
                </select>
              </div>
              <input
                type="number"
                placeholder="0.00"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                className="w-full text-xl font-bold font-mono-hive bg-transparent border-none outline-none"
                style={{ color: 'var(--text)' }}
              />
            </div>

            {/* Swap direction button */}
            <button
              onClick={() => {
                const tmp = fromToken;
                setFromToken(toToken);
                setToToken(tmp);
                setFromAmount('');
              }}
              className="w-full flex justify-center py-1 text-lg"
              style={{ color: 'var(--sub)' }}
            >
              ⇅
            </button>

            {/* To */}
            <div className="rounded-xl p-3 mt-2 mb-4" style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: 'var(--sub)' }}>You receive (~)</span>
                <select
                  value={toToken}
                  onChange={(e) => { setToToken(e.target.value); setFromAmount(''); }}
                  className="text-xs font-bold bg-transparent border-none outline-none cursor-pointer"
                  style={{ color: tokenColor(toToken) }}
                >
                  {allTokens.filter((t) => t !== fromToken).map((t) => (
                    <option key={t} value={t} style={{ background: '#040507' }}>{t}</option>
                  ))}
                </select>
              </div>
              <p className="text-xl font-bold font-mono-hive" style={{ color: estimatedOut > 0 ? 'var(--green)' : 'var(--sub)' }}>
                {estimatedOut > 0 ? estimatedOut.toFixed(estimatedOut < 0.01 ? 6 : 4) : '0.00'}
              </p>
            </div>

            {/* Stats row */}
            {numFromAmount > 0 && estimatedOut > 0 && (
              <div className="flex flex-col gap-1 mb-4 text-xs" style={{ color: 'var(--sub)' }}>
                <div className="flex justify-between">
                  <span>Rate</span>
                  <span className="font-mono-hive">1 {fromToken} ≈ {(estimatedOut / numFromAmount).toFixed(4)} {toToken}</span>
                </div>
                <div className="flex justify-between">
                  <span>Price Impact</span>
                  <span className="font-mono-hive" style={{ color: priceImpact > 5 ? 'var(--danger)' : priceImpact > 1 ? 'var(--gold)' : 'var(--green)' }}>
                    {priceImpact.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Fee ({((selectedPool?.feeRate ?? 0.003) * 100).toFixed(1)}%)</span>
                  <span className="font-mono-hive">{(numFromAmount * (selectedPool?.feeRate ?? 0.003)).toFixed(4)} {fromToken}</span>
                </div>
              </div>
            )}

            {swapExtStatus === 'error' && (
              <p className="text-xs mb-2 text-center" style={{ color: 'var(--danger)' }}>{swapExtError}</p>
            )}
            {swapExtStatus === 'success' && (
              <p className="text-xs mb-2 text-center font-bold" style={{ color: 'var(--green)' }}>✓ Swap confirmed!</p>
            )}
            <button
              disabled={!numFromAmount || estimatedOut === 0 || swapExtStatus === 'pending' || swapExtStatus === 'success'}
              onClick={async () => {
                if (isAuthUser && address) {
                  // Platform auth user — sign server-side with Chrysalis ceremony
                  setSwapExtStatus('pending');
                  try {
                    await executeSwap(
                      { wallet: address, tokenIn: fromToken, tokenOut: toToken, amountIn: numFromAmount },
                      sign,
                    );
                    setSwapExtStatus('success');
                    setTimeout(() => { setSwapExtStatus('idle'); load(); }, 3000);
                  } catch (e: unknown) {
                    const err = e as { message?: string };
                    setSwapExtStatus('error');
                    setSwapExtError(err?.message ?? 'Swap failed');
                    setTimeout(() => setSwapExtStatus('idle'), 4000);
                  }
                } else {
                  const hive = (window as unknown as { hive?: { isHive?: boolean; requestTransaction?: (d: unknown) => Promise<unknown> } }).hive;
                  if (hive?.requestTransaction) {
                    setSwapExtStatus('pending');
                    try {
                      await hive.requestTransaction({
                        txType: 'swap',
                        description: `Swap ${numFromAmount} ${fromToken} → ${estimatedOut.toFixed(4)} ${toToken}`,
                        fromToken, toToken, amountIn: numFromAmount, amountOut: estimatedOut,
                        priceImpact, fee: numFromAmount * (selectedPool?.feeRate ?? 0.003),
                      });
                      setSwapExtStatus('success');
                      setTimeout(() => setSwapExtStatus('idle'), 3000);
                    } catch (e: unknown) {
                      const err = e as { message?: string };
                      setSwapExtStatus('error');
                      setSwapExtError(err?.message ?? 'Rejected');
                      setTimeout(() => setSwapExtStatus('idle'), 4000);
                    }
                  } else {
                    setActionTarget(makeSwapNft(fromToken, toToken, numFromAmount));
                  }
                }
              }}
              className="btn-green w-full justify-center disabled:opacity-40"
            >
              {swapExtStatus === 'pending' ? '⬡ Signing…' : swapExtStatus === 'success' ? '✓ Done' : `Swap ${fromToken} → ${toToken}`}
            </button>

            <p className="text-xs text-center mt-2" style={{ color: 'var(--sub)' }}>
              {isAuthUser
                ? '⬡ Platform account — Chrysalis ML-DSA-65 signing'
                : (typeof window !== 'undefined' && (window as unknown as { hive?: { isHive?: boolean } }).hive?.isHive)
                  ? '⬡ Chrysalis extension detected'
                  : 'No extension? Scan QR with HIVE Wallet app'}
            </p>
          </motion.div>

          {/* Pool stats */}
          {selectedPool && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-5"
            >
              <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text)' }}>
                Pool — {selectedPool.tokenA}/{selectedPool.tokenB}
              </h3>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>{selectedPool.tokenA} Reserve</span>
                  <span className="font-mono-hive font-bold" style={{ color: tokenColor(selectedPool.tokenA) }}>
                    {selectedPool.reserveA.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>{selectedPool.tokenB} Reserve</span>
                  <span className="font-mono-hive font-bold" style={{ color: tokenColor(selectedPool.tokenB) }}>
                    {selectedPool.reserveB.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>TVL</span>
                  <span className="font-mono-hive font-bold" style={{ color: 'var(--green)' }}>
                    ${tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>LP Shares</span>
                  <span className="font-mono-hive" style={{ color: 'var(--text)' }}>
                    {selectedPool.totalLpShares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Swap Fee</span>
                  <span style={{ color: 'var(--text)' }}>
                    {(selectedPool.feeRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>LP Reward APR</span>
                  <span style={{ color: 'var(--green)' }}>8%</span>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── CENTER + RIGHT: Chart + Prices ── */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Price chart */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="glass-card p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold" style={{ color: 'var(--text)' }}>
                {fromToken}/{toToken} Price
              </h3>
              {spotPrice > 0 && (
                <span className="text-xs font-mono-hive" style={{ color: 'var(--gold)' }}>
                  Spot: {spotPrice.toFixed(spotPrice < 0.01 ? 6 : 4)}
                </span>
              )}
            </div>
            <PriceChart
              pair={`${fromToken}/${toToken}`}
              height={310}
              showVolume={true}
              spotPrice={spotPrice > 0 ? spotPrice : undefined}
            />
          </motion.div>

          {/* Token prices grid */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="glass-card p-5"
          >
            <h3 className="font-semibold mb-3" style={{ color: 'var(--text)' }}>Live Prices</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {Object.values(prices).map((p) => (
                <div
                  key={p.symbol}
                  className="rounded-xl p-3 flex flex-col gap-1"
                  style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}
                >
                  <span className="text-xs font-bold" style={{ color: tokenColor(p.symbol) }}>
                    {p.symbol}
                  </span>
                  <span className="font-bold font-mono-hive text-sm" style={{ color: 'var(--text)' }}>
                    ${p.price_usd < 0.01
                      ? p.price_usd.toFixed(6)
                      : p.price_usd < 1
                      ? p.price_usd.toFixed(4)
                      : p.price_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {Object.keys(prices).length === 0 && (
                <div className="col-span-4 text-center py-4 text-sm" style={{ color: 'var(--sub)' }}>
                  Waiting for price data…
                </div>
              )}
            </div>
          </motion.div>

          {/* Recent swaps table */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card p-5"
          >
            <h3 className="font-semibold mb-3" style={{ color: 'var(--text)' }}>Recent Swaps</h3>
            {recentSwaps.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: 'var(--sub)' }}>
                No swaps yet — execute your first swap from the HIVE Wallet app
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--sub)', borderBottom: '1px solid var(--border2)' }}>
                      <th className="text-left pb-2 font-medium">Pair</th>
                      <th className="text-right pb-2 font-medium">Sold</th>
                      <th className="text-right pb-2 font-medium">Bought</th>
                      <th className="text-right pb-2 font-medium hidden sm:table-cell">Price</th>
                      <th className="text-right pb-2 font-medium hidden md:table-cell">Wallet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSwaps.slice(0, 20).map((s, i) => (
                      <tr
                        key={s.txid || i}
                        style={{ borderBottom: '1px solid var(--border2)', color: 'var(--text)' }}
                      >
                        <td className="py-2">
                          <span style={{ color: tokenColor(s.fromToken) }}>{s.fromToken}</span>
                          <span style={{ color: 'var(--sub)' }}> → </span>
                          <span style={{ color: tokenColor(s.toToken) }}>{s.toToken}</span>
                        </td>
                        <td className="text-right py-2 font-mono-hive" style={{ color: 'var(--danger)' }}>
                          -{s.fromAmount.toFixed(2)}
                        </td>
                        <td className="text-right py-2 font-mono-hive" style={{ color: 'var(--green)' }}>
                          +{s.toAmount.toFixed(2)}
                        </td>
                        <td className="text-right py-2 font-mono-hive hidden sm:table-cell" style={{ color: 'var(--sub)' }}>
                          {s.price.toFixed(4)}
                        </td>
                        <td className="text-right py-2 font-mono-hive hidden md:table-cell" style={{ color: 'var(--sub)' }}>
                          {s.wallet.slice(0, 8)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>

          {/* ── Live Order Book ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="glass-card p-5"
          >
            {/* Header + tabs */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold" style={{ color: 'var(--text)' }}>📋 Order Book — {pair}</h3>
              <div className="flex gap-1">
                {(['book', 'limit', 'fills'] as const).map(t => (
                  <button key={t} onClick={() => setObTab(t)}
                    className="text-xs px-3 py-1 rounded-full font-medium"
                    style={{ background: obTab === t ? 'var(--green)' : 'var(--glass2)', color: obTab === t ? '#040507' : 'var(--sub)', border: '1px solid var(--border2)' }}>
                    {t === 'book' ? 'Depth' : t === 'limit' ? 'Place Order' : 'Recent Fills'}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab: Depth (bids/asks) */}
            {obTab === 'book' && (
              <div className="grid grid-cols-2 gap-4">
                {/* Asks (sells) */}
                <div>
                  <p className="text-xs mb-2 font-semibold" style={{ color: 'var(--danger)' }}>ASKS (Sell orders)</p>
                  <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--sub)' }}>
                    <span>Price (HNY)</span><span>Size (HNY)</span>
                  </div>
                  {(orderbook?.asks?.length ?? 0) === 0 ? (
                    <p className="text-xs py-4 text-center" style={{ color: 'var(--sub)' }}>No open sell orders</p>
                  ) : orderbook?.asks.slice(0, 10).map((level, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5 font-mono-hive relative overflow-hidden">
                      <div className="absolute inset-0 opacity-10" style={{ background: 'var(--danger)', width: `${Math.min(100, (level.total_hny / (orderbook.asks[0]?.total_hny || 1)) * 100)}%` }} />
                      <span style={{ color: 'var(--danger)' }}>{Number(level.price_hny).toFixed(4)}</span>
                      <span style={{ color: 'var(--text)' }}>{Number(level.total_hny).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                {/* Bids (buys) */}
                <div>
                  <p className="text-xs mb-2 font-semibold" style={{ color: 'var(--green)' }}>BIDS (Buy orders)</p>
                  <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--sub)' }}>
                    <span>Price (HNY)</span><span>Size (HNY)</span>
                  </div>
                  {(orderbook?.bids?.length ?? 0) === 0 ? (
                    <p className="text-xs py-4 text-center" style={{ color: 'var(--sub)' }}>No open buy orders</p>
                  ) : orderbook?.bids.slice(0, 10).map((level, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5 font-mono-hive relative overflow-hidden">
                      <div className="absolute inset-0 opacity-10" style={{ background: 'var(--green)', width: `${Math.min(100, (level.total_hny / (orderbook.bids[0]?.total_hny || 1)) * 100)}%` }} />
                      <span style={{ color: 'var(--green)' }}>{Number(level.price_hny).toFixed(4)}</span>
                      <span style={{ color: 'var(--text)' }}>{Number(level.total_hny).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                {/* Last trade */}
                {orderbook?.lastTrade && (
                  <div className="col-span-2 pt-2 border-t" style={{ borderColor: 'var(--border2)' }}>
                    <p className="text-xs" style={{ color: 'var(--sub)' }}>
                      Last fill: <span className="font-mono-hive" style={{ color: 'var(--gold)' }}>{Number(orderbook.lastTrade.price_hny).toFixed(4)} HNY</span>
                      {' '}· {Number(orderbook.lastTrade.size_hny).toFixed(2)} HNY · {new Date(orderbook.lastTrade.traded_at).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Place limit order */}
            {obTab === 'limit' && (
              <div className="flex flex-col gap-4 max-w-sm">
                {/* Buy / Sell toggle */}
                <div className="flex gap-2">
                  {(['buy', 'sell'] as const).map(s => (
                    <button key={s} onClick={() => setLimitSide(s)}
                      className="flex-1 py-2 rounded-xl text-sm font-bold transition-all"
                      style={{ background: limitSide === s ? (s === 'buy' ? 'var(--green)' : 'var(--danger)') : 'var(--glass2)', color: limitSide === s ? '#040507' : 'var(--sub)', border: '1px solid var(--border2)' }}>
                      {s === 'buy' ? '▲ Buy' : '▼ Sell'}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: 'var(--sub)' }}>Limit Price (HNY per {toToken})</label>
                  <input type="number" placeholder={spotPrice > 0 ? spotPrice.toFixed(4) : '0.00'}
                    value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                    className="w-full p-3 rounded-xl text-sm font-mono-hive"
                    style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: 'var(--sub)' }}>Size (HNY)</label>
                  <input type="number" placeholder="100"
                    value={limitSize} onChange={e => setLimitSize(e.target.value)}
                    className="w-full p-3 rounded-xl text-sm font-mono-hive"
                    style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }} />
                </div>
                {limitPrice && limitSize && (
                  <div className="rounded-xl p-3 text-xs flex flex-col gap-1" style={{ background: 'var(--glass)', border: '1px solid var(--border)' }}>
                    <div className="flex justify-between"><span style={{ color: 'var(--sub)' }}>Total</span><span className="font-mono-hive" style={{ color: 'var(--text)' }}>{(parseFloat(limitPrice) * parseFloat(limitSize)).toFixed(4)} HNY</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--sub)' }}>Maker fee (0.1%)</span><span className="font-mono-hive" style={{ color: 'var(--sub)' }}>{(parseFloat(limitSize) * 0.001).toFixed(4)} HNY</span></div>
                  </div>
                )}
                <button
                  disabled={!limitPrice || !limitSize}
                  onClick={() => setLimitAction(makeSwapNft(limitSide === 'buy' ? pair.split('/')[1] : pair.split('/')[0], limitSide === 'buy' ? pair.split('/')[0] : pair.split('/')[1], parseFloat(limitSize || '0')))}
                  className="w-full py-3 rounded-xl font-bold text-sm disabled:opacity-40"
                  style={{ background: limitSide === 'buy' ? 'var(--green)' : 'var(--danger)', color: '#040507' }}>
                  {limitSide === 'buy' ? `Buy ${toToken} at ${limitPrice || '?'} HNY` : `Sell ${fromToken} at ${limitPrice || '?'} HNY`}
                </button>
                <p className="text-xs text-center" style={{ color: 'var(--sub)' }}>Executes via HIVE Wallet · ML-DSA-65 signed</p>
              </div>
            )}

            {/* Tab: Recent fills */}
            {obTab === 'fills' && (
              obTrades.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--sub)' }}>No fills yet for {pair}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: 'var(--sub)', borderBottom: '1px solid var(--border2)' }}>
                        <th className="text-left pb-2 font-medium">Price</th>
                        <th className="text-right pb-2 font-medium">Size</th>
                        <th className="text-right pb-2 font-medium">Total</th>
                        <th className="text-right pb-2 font-medium hidden sm:table-cell">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {obTrades.slice(0, 25).map((t) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td className="py-1.5 font-mono-hive" style={{ color: 'var(--green)' }}>{Number(t.price_hny).toFixed(4)}</td>
                          <td className="text-right py-1.5 font-mono-hive" style={{ color: 'var(--text)' }}>{Number(t.size_hny).toFixed(2)}</td>
                          <td className="text-right py-1.5 font-mono-hive" style={{ color: 'var(--sub)' }}>{(Number(t.price_hny) * Number(t.size_hny)).toFixed(2)}</td>
                          <td className="text-right py-1.5 hidden sm:table-cell" style={{ color: 'var(--sub)' }}>{new Date(t.traded_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </motion.div>
        </div>
      </div>

      {/* Swap Action Modal */}
      {actionTarget && (
        <ActionModal
          action="swap"
          nft={actionTarget}
          onClose={() => setActionTarget(null)}
        />
      )}
    </div>
  );
}
