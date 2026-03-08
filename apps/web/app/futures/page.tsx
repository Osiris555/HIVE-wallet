'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getFuturesMarkets, getFuturesPositions, getFuturesHistory, getFuturesStats } from '@/lib/api';
import type { FuturesMarket, FuturesPosition, FuturesStats } from '@/lib/types';
import PriceChart from '@/components/PriceChart';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import { useSign } from '@/hooks/useSign';
import { executeFuturesOpen, executeFuturesClose } from '@/lib/txHelper';

// ── Constants ──────────────────────────────────────────────
const TAKER_FEE = 0.0006;
const MMR       = 0.025;

const TOKEN_COLORS: Record<string, string> = {
  HNY: '#f5b429', BTC: '#f7931a', ETH: '#627eea',
  SOL: '#9945ff', BNB: '#f3ba2f',
};

function tokenColor(sym: string) { return TOKEN_COLORS[sym] ?? '#39ff14'; }

// ── Math helpers ───────────────────────────────────────────
function calcLiqPrice(side: 'long' | 'short', entryPrice: number, leverage: number) {
  if (side === 'long')  return entryPrice * (1 - (1 - MMR) / leverage);
  return entryPrice * (1 + (1 - MMR) / leverage);
}

function calcPnlHny(side: 'long' | 'short', entry: number, mark: number, sizeUsd: number, hnyPrice = 1) {
  const delta = side === 'long' ? mark - entry : entry - mark;
  return (delta / entry) * sizeUsd / hnyPrice;
}

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number, decimals = 4) { return `${(n * 100).toFixed(decimals)}%`; }


// ── PnL badge ─────────────────────────────────────────────
function PnlBadge({ pnl }: { pnl: number }) {
  const pos = pnl >= 0;
  return (
    <span style={{ color: pos ? 'var(--green)' : 'var(--danger)', fontWeight: 700 }}>
      {pos ? '+' : ''}{pnl.toFixed(4)} HNY
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════ */
export default function FuturesPage() {
  const { address: hiveAddress, isAuthUser } = useHiveWallet();
  const { sign, sigModal } = useSign();

  // ── Data state ────────────────────────────────────────────
  const [markets, setMarkets]     = useState<FuturesMarket[]>([]);
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [history, setHistory]     = useState<FuturesPosition[]>([]);
  const [stats, setStats]         = useState<FuturesStats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [serverOffline, setServerOffline] = useState(false);

  // ── UI state ──────────────────────────────────────────────
  const [selectedMarket, setSelectedMarket] = useState<FuturesMarket | null>(null);
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions');
  const [side, setSide]           = useState<'long' | 'short'>('long');
  const [sizeUsd, setSizeUsd]     = useState('100');
  const [leverage, setLeverage]   = useState(5);
  const [showConfirm, setShowConfirm] = useState(false);
  const [extStatus, setExtStatus] = useState<'idle'|'pending'|'success'|'error'>('idle');
  const [extError,  setExtError]  = useState('');

  // ── TX confirm handler ─────────────────────────────────────
  async function handleExtConfirm() {
    if (!hiveAddress || !market) return;
    setExtStatus('pending');
    try {
      if (isAuthUser) {
        // Platform auth — Chrysalis ceremony shown by useSign
        await executeFuturesOpen(
          { wallet: hiveAddress, marketId: market.id, side, sizeHny: collateral, leverage },
          sign,
        );
      } else {
        const hive = (window as unknown as { hive?: { isHive?: boolean; requestTransaction?: (d: unknown) => Promise<unknown> } }).hive;
        if (!hive?.requestTransaction) { setExtStatus('error'); setExtError('HIVE Wallet extension not found'); return; }
        await hive.requestTransaction({
          txType: 'futures_open',
          description: `Open ${leverage}× ${side === 'long' ? 'Long' : 'Short'} ${market?.baseSymbol}/USD · ${fmtUsd(size)}`,
          marketId: market?.id, side, leverage, fee,
          params: { size: collateral, sizeUsd: size },
        });
      }
      setExtStatus('success');
      setTimeout(() => { setShowConfirm(false); setExtStatus('idle'); load(); }, 1500);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setExtStatus('error');
      setExtError(err?.message ?? 'Transaction rejected');
    }
  }

  // ── Computed values ───────────────────────────────────────
  const market      = selectedMarket;
  const markPrice   = market?.markPriceUsd ?? 0;
  const size        = Number(sizeUsd) || 0;
  const collateral  = size > 0 && leverage > 0 ? size / leverage : 0;
  const fee         = size * TAKER_FEE;
  const totalCost   = collateral + fee;
  const liqPrice    = markPrice > 0 ? calcLiqPrice(side, markPrice, leverage) : 0;
  const priceImpact = 0; // perpetuals = no slippage on open

  // ── Load data ─────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [mktData, statsData] = await Promise.all([
        getFuturesMarkets(),
        getFuturesStats(),
      ]);
      setMarkets(mktData.markets);
      setStats(statsData);
      setServerOffline(false);

      // Select first market if none selected
      setSelectedMarket((prev) => prev
        ? (mktData.markets.find((m) => m.id === prev.id) ?? mktData.markets[0] ?? null)
        : (mktData.markets[0] ?? null)
      );

      // Load positions/history if connected
      if (hiveAddress) {
        const [posData, histData] = await Promise.all([
          getFuturesPositions(hiveAddress),
          getFuturesHistory(hiveAddress),
        ]);
        setPositions(posData.positions);
        setHistory(histData.history);
      }
    } catch {
      setServerOffline(true);
    } finally {
      setLoading(false);
    }
  }, [hiveAddress]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  // ── Offline banner ────────────────────────────────────────
  if (serverOffline && loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ paddingTop: 68 }}>
        <div className="text-5xl mb-4">📡</div>
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>Server Offline</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--sub)' }}>Make sure the HIVE server is running on port 3000</p>
        <button className="btn-green" onClick={() => { setLoading(true); load(); }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ paddingTop: 68, background: 'var(--bg)' }}>
      {/* Chrysalis signing modal (platform auth users) */}
      {sigModal}

      <div className="max-w-screen-xl mx-auto px-4 py-6">

        {/* ── Header ────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
              ⚡ Perpetual Futures
            </h1>
            <p className="text-sm" style={{ color: 'var(--sub)' }}>
              Trade with up to 20× leverage on Honey Network
            </p>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--sub)' }}>
              <span>OI: <strong style={{ color: 'var(--gold)' }}>{fmtUsd(stats.totalOpenInterestUsd)}</strong></span>
              <span>Vol: <strong style={{ color: 'var(--green)' }}>{fmtUsd(stats.totalVolumeUsd)}</strong></span>
              <span>Liquidations: <strong style={{ color: 'var(--danger)' }}>{stats.totalLiquidations}</strong></span>
            </div>
          )}
        </div>

        {/* Offline warning (non-blocking) */}
        {serverOffline && (
          <div className="glass-card p-3 mb-4 flex items-center justify-between" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            <span className="text-sm">⚠️ Server connection lost — showing cached data</span>
            <button onClick={load} className="text-xs btn-outline py-1 px-3">Retry</button>
          </div>
        )}

        {/* ── Market selector chips ──────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-6">
          {markets.map((m) => {
            const selected = selectedMarket?.id === m.id;
            const color = tokenColor(m.baseSymbol);
            return (
              <button
                key={m.id}
                onClick={() => setSelectedMarket(m)}
                className="glass-card px-4 py-2 text-sm font-bold flex items-center gap-2 transition-all"
                style={{
                  borderColor: selected ? color : 'var(--border2)',
                  color: selected ? color : 'var(--sub)',
                  background: selected ? `${color}12` : 'var(--glass)',
                  minWidth: 110,
                }}
              >
                <span>{m.baseSymbol}/USD</span>
                <span className="text-xs font-normal opacity-80">${m.markPriceUsd?.toFixed(2)}</span>
              </button>
            );
          })}
        </div>

        {/* ── Main grid ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* ── Left: Chart + Market stats ─────────────────── */}
          <div className="xl:col-span-2 flex flex-col gap-4">

            {/* Price card */}
            {market && (
              <motion.div
                key={market.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-5"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--sub)' }}>
                      {market.baseSymbol}/USD — Mark Price
                    </span>
                    <div className="text-4xl font-bold font-mono-hive" style={{ color: tokenColor(market.baseSymbol) }}>
                      ${market.markPriceUsd?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </div>
                  </div>
                  <div className="text-right text-xs" style={{ color: 'var(--sub)' }}>
                    <div>Funding 8h: <strong style={{ color: 'var(--gold)' }}>{fmtPct(market.fundingRate8h)}</strong></div>
                    <div>Max lev: <strong style={{ color: 'var(--text)' }}>{market.maxLeverage}×</strong></div>
                    <div>Taker fee: <strong style={{ color: 'var(--text)' }}>{fmtPct(market.takerFeeRate)}</strong></div>
                  </div>
                </div>

                {/* OI bar */}
                <div className="flex items-center gap-2 mt-3 mb-1">
                  <span className="text-xs" style={{ color: 'var(--sub)' }}>OI</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--glass2)' }}>
                    {(() => {
                      const total = market.openInterestLongUsd + market.openInterestShortUsd;
                      const longPct = total > 0 ? (market.openInterestLongUsd / total) * 100 : 50;
                      return (
                        <div className="h-full flex">
                          <div style={{ width: `${longPct}%`, background: 'var(--green)' }} />
                          <div style={{ flex: 1, background: 'var(--danger)' }} />
                        </div>
                      );
                    })()}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--green)' }}>
                    L {fmtUsd(market.openInterestLongUsd)}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--danger)' }}>
                    S {fmtUsd(market.openInterestShortUsd)}
                  </span>
                </div>

                {/* Chart */}
                <div style={{ marginTop: 16 }}>
                  <PriceChart
                    pair={`${market.baseSymbol}/USDC`}
                    color={tokenColor(market.baseSymbol)}
                    height={260}
                    showVolume={false}
                    spotPrice={market.markPriceUsd}
                    liquidationPrice={liqPrice > 0 ? liqPrice : undefined}
                  />
                </div>
              </motion.div>
            )}

            {/* ── Positions / History tabs ───────────────────── */}
            <div className="glass-card p-5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex gap-4 mb-4 border-b" style={{ borderColor: 'var(--border2)' }}>
                {(['positions', 'history'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="pb-2 text-sm font-semibold capitalize transition-colors"
                    style={{
                      color: activeTab === tab ? 'var(--green)' : 'var(--sub)',
                      borderBottom: activeTab === tab ? '2px solid var(--green)' : '2px solid transparent',
                    }}
                  >
                    {tab === 'positions' ? `Open Positions (${positions.length})` : `History (${history.length})`}
                  </button>
                ))}
              </div>

              {!hiveAddress ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--sub)' }}>
                  Connect your HIVE Wallet to view positions
                </p>
              ) : activeTab === 'positions' ? (
                positions.length === 0 ? (
                  <p className="text-sm text-center py-6" style={{ color: 'var(--sub)' }}>No open positions</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ color: 'var(--sub)', borderBottom: '1px solid var(--border2)' }}>
                          {['Market', 'Side', 'Size', 'Entry', 'Mark', 'Liq', 'PnL', 'Status'].map((h) => (
                            <th key={h} className="text-left pb-2 pr-4 font-medium text-xs uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((p) => {
                          const pnl = calcPnlHny(p.side, p.entryPriceUsd, p.markPriceUsd, p.sizeUsd);
                          const isLiqPending = p.status === 'liquidated_pending';
                          return (
                            <tr key={p.id} style={{ borderBottom: '1px solid var(--border2)', opacity: isLiqPending ? 0.6 : 1 }}>
                              <td className="py-2 pr-4 font-bold" style={{ color: tokenColor(p.baseSymbol) }}>
                                {p.baseSymbol}/USD
                              </td>
                              <td className="py-2 pr-4">
                                <span
                                  className="badge"
                                  style={{
                                    background: p.side === 'long' ? 'rgba(57,255,20,0.15)' : 'rgba(255,90,90,0.15)',
                                    color: p.side === 'long' ? 'var(--green)' : 'var(--danger)',
                                    border: `1px solid ${p.side === 'long' ? 'var(--green)' : 'var(--danger)'}`,
                                  }}
                                >
                                  {p.side.toUpperCase()} {p.leverage}×
                                </span>
                              </td>
                              <td className="py-2 pr-4" style={{ color: 'var(--text)' }}>{fmtUsd(p.sizeUsd)}</td>
                              <td className="py-2 pr-4" style={{ color: 'var(--sub)' }}>${p.entryPriceUsd.toFixed(4)}</td>
                              <td className="py-2 pr-4" style={{ color: tokenColor(p.baseSymbol) }}>${p.markPriceUsd.toFixed(4)}</td>
                              <td className="py-2 pr-4" style={{ color: 'var(--danger)' }}>${p.liquidationPriceUsd.toFixed(4)}</td>
                              <td className="py-2 pr-4"><PnlBadge pnl={pnl} /></td>
                              <td className="py-2 pr-4">
                                <span style={{ color: isLiqPending ? 'var(--danger)' : 'var(--green)', fontSize: 11 }}>
                                  {isLiqPending ? '⚠️ Liq Pending' : '● Open'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                history.length === 0 ? (
                  <p className="text-sm text-center py-6" style={{ color: 'var(--sub)' }}>No position history</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ color: 'var(--sub)', borderBottom: '1px solid var(--border2)' }}>
                          {['Market', 'Side', 'Size', 'Entry', 'Close', 'PnL', 'Status', 'Closed'].map((h) => (
                            <th key={h} className="text-left pb-2 pr-4 font-medium text-xs uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((p) => (
                          <tr key={p.id} style={{ borderBottom: '1px solid var(--border2)' }}>
                            <td className="py-2 pr-4 font-bold" style={{ color: tokenColor(p.baseSymbol) }}>
                              {p.baseSymbol}/USD
                            </td>
                            <td className="py-2 pr-4">
                              <span
                                className="badge"
                                style={{
                                  background: p.side === 'long' ? 'rgba(57,255,20,0.15)' : 'rgba(255,90,90,0.15)',
                                  color: p.side === 'long' ? 'var(--green)' : 'var(--danger)',
                                  border: `1px solid ${p.side === 'long' ? 'var(--green)' : 'var(--danger)'}`,
                                }}
                              >
                                {p.side.toUpperCase()} {p.leverage}×
                              </span>
                            </td>
                            <td className="py-2 pr-4" style={{ color: 'var(--text)' }}>{fmtUsd(p.sizeUsd)}</td>
                            <td className="py-2 pr-4" style={{ color: 'var(--sub)' }}>${p.entryPriceUsd?.toFixed(4)}</td>
                            <td className="py-2 pr-4" style={{ color: 'var(--sub)' }}>${(p.closePriceUsd ?? 0).toFixed(4)}</td>
                            <td className="py-2 pr-4">
                              <PnlBadge pnl={p.realizedPnlHny ?? 0} />
                            </td>
                            <td className="py-2 pr-4">
                              <span style={{
                                color: p.status === 'liquidated' ? 'var(--danger)' : 'var(--sub)',
                                fontSize: 11,
                              }}>
                                {p.status === 'liquidated' ? '⚡ Liquidated' : '✓ Closed'}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-xs" style={{ color: 'var(--sub)' }}>
                              {p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </div>

          {/* ── Right: Order form ──────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Order form */}
            <div className="glass-card p-5" style={{ borderColor: 'var(--border)' }}>
              <h3 className="font-bold text-sm mb-4" style={{ color: 'var(--text)' }}>
                Open Position {market ? `— ${market.baseSymbol}/USD` : ''}
              </h3>

              {/* Long / Short toggle */}
              <div className="flex rounded-xl overflow-hidden mb-4" style={{ border: '1px solid var(--border2)' }}>
                {(['long', 'short'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className="flex-1 py-2 text-sm font-bold transition-all capitalize"
                    style={{
                      background: side === s
                        ? (s === 'long' ? 'rgba(57,255,20,0.18)' : 'rgba(255,90,90,0.18)')
                        : 'transparent',
                      color: side === s
                        ? (s === 'long' ? 'var(--green)' : 'var(--danger)')
                        : 'var(--sub)',
                    }}
                  >
                    {s === 'long' ? '▲ Long' : '▼ Short'}
                  </button>
                ))}
              </div>

              {/* Size input */}
              <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Position Size (USD)</label>
              <div className="flex items-center gap-2 mb-1">
                <input
                  type="number"
                  value={sizeUsd}
                  onChange={(e) => setSizeUsd(e.target.value)}
                  min={market?.minSizeUsd ?? 1}
                  step="10"
                  placeholder="100"
                  className="w-full rounded-xl px-4 py-2 text-sm font-mono-hive"
                  style={{
                    background: 'var(--glass2)',
                    border: '1px solid var(--border2)',
                    color: 'var(--text)',
                    outline: 'none',
                  }}
                />
                <span className="text-xs font-bold" style={{ color: 'var(--sub)', whiteSpace: 'nowrap' }}>USD</span>
              </div>
              {/* Quick size buttons */}
              <div className="flex gap-1 mb-4">
                {[100, 500, 1000, 5000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setSizeUsd(String(v))}
                    className="flex-1 py-1 rounded-lg text-xs transition-colors"
                    style={{
                      background: sizeUsd === String(v) ? 'var(--glass2)' : 'transparent',
                      border: '1px solid var(--border2)',
                      color: 'var(--sub)',
                    }}
                  >
                    ${v >= 1000 ? `${v / 1000}K` : v}
                  </button>
                ))}
              </div>

              {/* Leverage slider */}
              <label className="flex items-center justify-between text-xs mb-2">
                <span style={{ color: 'var(--sub)' }}>Leverage</span>
                <span className="font-bold" style={{ color: 'var(--gold)' }}>{leverage}×</span>
              </label>
              <input
                type="range"
                min={1}
                max={market?.maxLeverage ?? 20}
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full mb-1"
                style={{ accentColor: side === 'long' ? 'var(--green)' : 'var(--danger)' }}
              />
              {/* Tick labels — positioned at correct % of slider range 1→20 */}
              <div className="relative text-xs mb-4" style={{ height: 14, color: 'var(--sub)' }}>
                <span style={{ position: 'absolute', left: '0%' }}>1×</span>
                <span style={{ position: 'absolute', left: '21.1%', transform: 'translateX(-50%)' }}>5×</span>
                <span style={{ position: 'absolute', left: '47.4%', transform: 'translateX(-50%)' }}>10×</span>
                <span style={{ position: 'absolute', right: '0%' }}>20×</span>
              </div>

              {/* Order summary */}
              <div
                className="rounded-xl p-3 mb-4 flex flex-col gap-1 text-xs"
                style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}
              >
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Collateral required</span>
                  <span style={{ color: 'var(--text)' }}>{fmtUsd(collateral)} ({(collateral / 1).toFixed(4)} HNY)</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Taker fee</span>
                  <span style={{ color: 'var(--text)' }}>{fmtUsd(fee)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Total cost</span>
                  <span className="font-bold" style={{ color: 'var(--gold)' }}>{fmtUsd(totalCost)}</span>
                </div>
                <div className="flex justify-between pt-1" style={{ borderTop: '1px solid var(--border2)', marginTop: 4 }}>
                  <span style={{ color: 'var(--sub)' }}>Entry price</span>
                  <span style={{ color: 'var(--text)' }}>${markPrice.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Liq. price</span>
                  <span style={{ color: 'var(--danger)', fontWeight: 700 }}>${liqPrice.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Price impact</span>
                  <span style={{ color: 'var(--green)' }}>~0% (perps)</span>
                </div>
              </div>

              {!hiveAddress ? (
                <p className="text-xs text-center py-2" style={{ color: 'var(--sub)' }}>
                  Connect your HIVE Wallet to trade
                </p>
              ) : !market ? (
                <p className="text-xs text-center py-2" style={{ color: 'var(--sub)' }}>Select a market</p>
              ) : size <= 0 ? (
                <button className="btn-outline w-full justify-center" disabled>Enter position size</button>
              ) : (
                <button
                  className="w-full py-3 rounded-xl font-bold text-sm transition-all"
                  style={{
                    background: side === 'long' ? 'var(--green)' : 'var(--danger)',
                    color: '#040507',
                  }}
                  onClick={() => setShowConfirm(true)}
                >
                  {side === 'long' ? '▲ Open Long' : '▼ Open Short'} {leverage}× — {fmtUsd(size)}
                </button>
              )}

              <p className="text-xs mt-3 text-center" style={{ color: 'var(--sub)' }}>
                Requires HIVE Wallet extension or mobile app to sign
              </p>
            </div>

            {/* Market info card */}
            {market && (
              <div className="glass-card p-4 text-xs" style={{ borderColor: 'var(--border2)' }}>
                <div className="font-semibold mb-2" style={{ color: 'var(--text)' }}>Market Info</div>
                <div className="flex flex-col gap-1.5">
                  {[
                    ['Mark Price', `$${market.markPriceUsd.toLocaleString()}`],
                    ['Funding Rate (8h)', fmtPct(market.fundingRate8h)],
                    ['Max Leverage', `${market.maxLeverage}×`],
                    ['Min Size', fmtUsd(market.minSizeUsd)],
                    ['Maker Fee', fmtPct(market.makerFeeRate)],
                    ['Taker Fee', fmtPct(market.takerFeeRate)],
                    ['MMR', fmtPct(market.maintenanceMarginRate, 1)],
                    ['Long OI', fmtUsd(market.openInterestLongUsd)],
                    ['Short OI', fmtUsd(market.openInterestShortUsd)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <span style={{ color: 'var(--sub)' }}>{label}</span>
                      <span style={{ color: 'var(--text)' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Confirm modal ──────────────────────────────────── */}
      <AnimatePresence>
        {showConfirm && market && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.8)' }}
            onClick={(e) => e.target === e.currentTarget && setShowConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="glass-card p-6 w-full max-w-sm text-center"
              style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
            >
              <h2 className="font-bold text-lg mb-1" style={{ color: 'var(--gold)' }}>
                🐝 Confirm via HIVE Wallet
              </h2>
              <p className="text-sm mb-4" style={{ color: 'var(--sub)' }}>
                Open your HIVE Wallet mobile app → Futures to sign this position.
              </p>

              <div
                className="rounded-xl p-4 mb-4 text-sm text-left flex flex-col gap-2"
                style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}
              >
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Market</span>
                  <span className="font-bold" style={{ color: tokenColor(market.baseSymbol) }}>{market.baseSymbol}/USD</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Side</span>
                  <span className="font-bold" style={{ color: side === 'long' ? 'var(--green)' : 'var(--danger)' }}>
                    {side === 'long' ? '▲ LONG' : '▼ SHORT'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Size</span>
                  <span style={{ color: 'var(--text)' }}>{fmtUsd(size)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Leverage</span>
                  <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{leverage}×</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Liq. price</span>
                  <span style={{ color: 'var(--danger)', fontWeight: 700 }}>${liqPrice.toFixed(4)}</span>
                </div>
                <div className="flex justify-between" style={{ borderTop: '1px solid var(--border2)', paddingTop: 8, marginTop: 4 }}>
                  <span style={{ color: 'var(--sub)' }}>Total cost</span>
                  <span className="font-bold" style={{ color: 'var(--gold)' }}>{fmtUsd(totalCost)}</span>
                </div>
              </div>

              {extStatus === 'error' && (
                <p className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{extError}</p>
              )}
              {extStatus === 'success' && (
                <p className="text-xs mb-3 font-bold" style={{ color: 'var(--green)' }}>✓ Position opened!</p>
              )}
              {extStatus === 'pending' && (
                <p className="text-xs mb-3 font-mono-hive" style={{ color: 'var(--gold)' }}>⬡ Chrysalis signing…</p>
              )}
              <div className="flex gap-2">
                <button className="btn-outline flex-1 justify-center" onClick={() => { setShowConfirm(false); setExtStatus('idle'); }}>
                  Cancel
                </button>
                <button
                  className="btn-green flex-1 justify-center"
                  onClick={handleExtConfirm}
                  disabled={extStatus === 'pending' || extStatus === 'success'}
                  style={{ opacity: extStatus === 'pending' ? 0.7 : 1 }}
                >
                  {extStatus === 'pending' ? '⬡ Signing…' : extStatus === 'success' ? '✓ Done' : '⬡ Open HIVE Wallet'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
