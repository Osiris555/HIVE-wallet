'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { getLaunchpadToken } from '@/lib/api';
import type { LaunchpadToken, LaunchpadTrade } from '@/lib/types';
import { useHiveWallet } from '@/components/HiveWalletConnect';

// ── Bonding curve math (mirrors server) ───────────────────
const VIRTUAL_HNY  = 1_000;
const VIRTUAL_SUP  = 1_000_000_000;
const GRAD_THRESH  = 100;
const CREATOR_FEE  = 0.01;
const PLATFORM_FEE = 0.005;

function bondingPrice(realHny: number, tokensSold: number) {
  return (VIRTUAL_HNY + realHny) / (VIRTUAL_SUP - tokensSold);
}

function calcBuyTokens(realHny: number, tokensSold: number, hnyIn: number) {
  const poolHny   = VIRTUAL_HNY + realHny;
  const remaining = VIRTUAL_SUP - tokensSold;
  const fees      = hnyIn * (CREATOR_FEE + PLATFORM_FEE);
  const net       = hnyIn - fees;
  return (remaining * net) / (poolHny + net);
}

function calcSellHny(realHny: number, tokensSold: number, tokensIn: number) {
  const poolHny   = VIRTUAL_HNY + realHny;
  const remaining = VIRTUAL_SUP - tokensSold;
  const raw       = (poolHny * tokensIn) / (remaining + tokensIn);
  return raw * (1 - CREATOR_FEE - PLATFORM_FEE);
}

function fmtHny(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(4);
}

function fmtTokens(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

// ── Build price history chart from trades ─────────────────
function buildChartData(trades: LaunchpadTrade[]) {
  return [...trades]
    .reverse()
    .map((t, i) => ({
      idx:   i,
      price: t.price_hny,
      type:  t.type,
      time:  new Date(t.traded_at).toLocaleTimeString(),
      hny:   t.hny_amount,
    }));
}

// ── Build bonding curve simulation data ───────────────────
function buildCurveData(currentRaised: number, currentSold: number) {
  const points = [];
  const steps  = 30;
  for (let i = 0; i <= steps; i++) {
    const raised = (i / steps) * GRAD_THRESH;
    // Approximate tokens sold proportional to raised
    const sold  = currentSold > 0
      ? (raised / Math.max(currentRaised, 0.001)) * currentSold
      : (raised / GRAD_THRESH) * (VIRTUAL_SUP * 0.1);
    const price = bondingPrice(raised, Math.min(sold, VIRTUAL_SUP * 0.99));
    points.push({ raised: Number(raised.toFixed(2)), price: Number(price.toFixed(8)) });
  }
  return points;
}

// ── Custom tooltip ─────────────────────────────────────────
function PriceTooltip({ active, payload }: { active?: boolean; payload?: { value: number; payload: { time: string; type: string } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="glass-card px-3 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
      <div style={{ color: d.payload.type === 'buy' ? 'var(--green)' : 'var(--danger)' }}>
        {d.payload.type === 'buy' ? '▲ Buy' : '▼ Sell'} {d.value?.toFixed(8)} HNY
      </div>
      <div style={{ color: 'var(--sub)' }}>{d.payload.time}</div>
    </div>
  );
}

function CurveTooltip({ active, payload }: { active?: boolean; payload?: { value: number; payload: { raised: number } }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card px-3 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
      <div style={{ color: 'var(--gold)' }}>{payload[0].value?.toFixed(8)} HNY / token</div>
      <div style={{ color: 'var(--sub)' }}>{payload[0].payload.raised} HNY raised</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════ */
export default function LaunchpadTokenPage() {
  const params = useParams();
  const id     = params?.id as string;
  const { address } = useHiveWallet();

  const [token, setToken]   = useState<LaunchpadToken | null>(null);
  const [trades, setTrades] = useState<LaunchpadTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Trade form
  const [tab, setTab]           = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount]     = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [chartView, setChartView] = useState<'price' | 'curve'>('price');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getLaunchpadToken(id);
      setToken(data.token);
      setTrades(data.trades);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ paddingTop: 68 }}>
        <div className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: 'var(--green)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (notFound || !token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ paddingTop: 68 }}>
        <div className="text-5xl mb-4">🤷</div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>Token Not Found</h1>
        <Link href="/launchpad" className="btn-green mt-4">← Back to Launchpad</Link>
      </div>
    );
  }

  // Derived values
  const pct         = token.graduationPct;
  const currentPrice = token.priceHny;
  const amountNum   = Number(amount) || 0;

  const previewOut  = tab === 'buy' && amountNum > 0
    ? calcBuyTokens(token.realHnyRaised, token.tokensSold, amountNum)
    : tab === 'sell' && amountNum > 0
      ? calcSellHny(token.realHnyRaised, token.tokensSold, amountNum)
      : 0;

  const totalFees   = amountNum * (CREATOR_FEE + PLATFORM_FEE);

  const chartData   = buildChartData(trades);
  const curveData   = buildCurveData(token.realHnyRaised, token.tokensSold);

  return (
    <div className="min-h-screen" style={{ paddingTop: 68, background: 'var(--bg)' }}>
      <div className="max-w-screen-xl mx-auto px-4 py-6">

        {/* ── Breadcrumb ─────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-sm mb-6" style={{ color: 'var(--sub)' }}>
          <Link href="/" style={{ color: 'var(--sub)', textDecoration: 'none' }}>Home</Link>
          <span>/</span>
          <Link href="/launchpad" style={{ color: 'var(--sub)', textDecoration: 'none' }}>Launchpad</Link>
          <span>/</span>
          <span style={{ color: 'var(--text)' }}>{token.name}</span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Left: Chart + trades ──────────────────────────── */}
          <div className="xl:col-span-2 flex flex-col gap-4">

            {/* Token header */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-5"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl flex-shrink-0"
                    style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}
                  >
                    {token.imageEmoji}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{token.name}</h1>
                      <span className="font-mono-hive text-sm px-2 py-0.5 rounded" style={{ background: 'var(--glass2)', color: 'var(--green)' }}>
                        ${token.ticker}
                      </span>
                      {token.graduated && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{ background: 'rgba(245,180,41,0.15)', color: 'var(--gold)', border: '1px solid var(--gold)' }}>
                          🎓 Graduated
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1" style={{ color: 'var(--sub)' }}>{token.description}</p>
                  </div>
                </div>
                {/* Social links */}
                <div className="flex gap-2 flex-shrink-0">
                  {token.website  && <a href={token.website}  target="_blank" rel="noreferrer" className="text-lg opacity-60 hover:opacity-100">🌐</a>}
                  {token.twitter  && <a href={token.twitter}  target="_blank" rel="noreferrer" className="text-lg opacity-60 hover:opacity-100">𝕏</a>}
                  {token.telegram && <a href={token.telegram} target="_blank" rel="noreferrer" className="text-lg opacity-60 hover:opacity-100">✈️</a>}
                </div>
              </div>

              {/* Key stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-center">
                {[
                  { label: 'Price', value: `${currentPrice.toFixed(8)} HNY`, color: 'var(--gold)' },
                  { label: 'Market Cap', value: `${fmtHny(token.marketCapHny)} HNY`, color: 'var(--green)' },
                  { label: 'HNY Raised', value: `${fmtHny(token.realHnyRaised)} / ${token.graduationThreshold}`, color: 'var(--text)' },
                  { label: 'Tokens Sold', value: fmtTokens(token.tokensSold), color: 'var(--text)' },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl p-2" style={{ background: 'var(--glass2)' }}>
                    <div className="font-bold text-sm font-mono-hive" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-xs" style={{ color: 'var(--sub)' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Graduation progress */}
              {!token.graduated && (
                <div>
                  <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--sub)' }}>
                    <span>🎓 Graduation progress</span>
                    <span style={{ color: pct >= 80 ? 'var(--gold)' : 'var(--sub)' }}>
                      {pct.toFixed(1)}% ({fmtHny(token.realHnyRaised)} / {token.graduationThreshold} HNY)
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--glass2)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 80
                          ? 'linear-gradient(90deg, var(--green), var(--gold))'
                          : 'var(--green)',
                      }}
                    />
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--sub)' }}>
                    When {token.graduationThreshold} HNY is raised, this token graduates to the AMM DEX with permanent liquidity.
                  </p>
                </div>
              )}
            </motion.div>

            {/* Chart */}
            <div className="glass-card p-5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                  {chartView === 'price' ? 'Trade Price History' : 'Bonding Curve'}
                </div>
                <div className="flex gap-1">
                  {(['price', 'curve'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setChartView(v)}
                      className="px-3 py-1 rounded-lg text-xs capitalize transition-all"
                      style={{
                        background: chartView === v ? 'var(--glass2)' : 'transparent',
                        border: `1px solid ${chartView === v ? 'var(--border)' : 'var(--border2)'}`,
                        color: chartView === v ? 'var(--text)' : 'var(--sub)',
                      }}
                    >
                      {v === 'price' ? '📈 Trades' : '📐 Curve'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ height: 220 }}>
                {chartView === 'price' ? (
                  chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="tradeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#39ff14" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#39ff14" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" tick={{ fill: 'var(--sub)', fontSize: 10 }} tickLine={false} />
                        <YAxis
                          domain={['auto', 'auto']}
                          tick={{ fill: 'var(--sub)', fontSize: 10 }}
                          tickLine={false}
                          tickFormatter={(v) => v.toFixed(6)}
                          width={70}
                        />
                        <Tooltip content={<PriceTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="price"
                          stroke="var(--green)"
                          strokeWidth={2}
                          fill="url(#tradeGrad)"
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                        <ReferenceLine
                          y={currentPrice}
                          stroke="var(--gold)"
                          strokeDasharray="4 4"
                          label={{ value: 'Current', fill: 'var(--gold)', fontSize: 10, position: 'insideTopRight' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--sub)' }}>
                      No trades yet — be the first to buy!
                    </div>
                  )
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={curveData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#f5b429" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#f5b429" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="raised"
                        tick={{ fill: 'var(--sub)', fontSize: 10 }}
                        tickLine={false}
                        tickFormatter={(v) => `${v}H`}
                        label={{ value: 'HNY Raised', fill: 'var(--sub)', fontSize: 10, position: 'insideBottom', offset: -4 }}
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        tick={{ fill: 'var(--sub)', fontSize: 10 }}
                        tickLine={false}
                        tickFormatter={(v) => v.toFixed(6)}
                        width={70}
                      />
                      <Tooltip content={<CurveTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="var(--gold)"
                        strokeWidth={2}
                        fill="url(#curveGrad)"
                        dot={false}
                      />
                      <ReferenceLine
                        x={token.realHnyRaised}
                        stroke="var(--green)"
                        strokeDasharray="4 4"
                        label={{ value: 'Now', fill: 'var(--green)', fontSize: 10, position: 'top' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Recent trades */}
            <div className="glass-card p-5" style={{ borderColor: 'var(--border2)' }}>
              <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text)' }}>
                Recent Trades ({trades.length})
              </h3>
              {trades.length === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: 'var(--sub)' }}>No trades yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: 'var(--sub)', borderBottom: '1px solid var(--border2)' }}>
                        {['Type', 'Wallet', 'HNY', 'Tokens', 'Price', 'Time'].map((h) => (
                          <th key={h} className="text-left pb-2 pr-3 font-medium uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trades.slice(0, 20).map((t) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border2)' }}>
                          <td className="py-1.5 pr-3">
                            <span style={{ color: t.type === 'buy' ? 'var(--green)' : 'var(--danger)', fontWeight: 700 }}>
                              {t.type === 'buy' ? '▲ Buy' : '▼ Sell'}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 font-mono-hive" style={{ color: 'var(--sub)' }}>
                            {t.wallet.slice(0, 12)}…
                          </td>
                          <td className="py-1.5 pr-3" style={{ color: 'var(--text)' }}>
                            {t.hny_amount.toFixed(4)}
                          </td>
                          <td className="py-1.5 pr-3" style={{ color: 'var(--text)' }}>
                            {fmtTokens(t.token_amount)}
                          </td>
                          <td className="py-1.5 pr-3" style={{ color: 'var(--gold)' }}>
                            {t.price_hny.toFixed(8)}
                          </td>
                          <td className="py-1.5" style={{ color: 'var(--sub)' }}>
                            {new Date(t.traded_at).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Trade form ──────────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Trade form */}
            <div className="glass-card p-5" style={{ borderColor: 'var(--border)' }}>
              <h3 className="font-bold text-sm mb-4" style={{ color: 'var(--text)' }}>
                Trade ${token.ticker}
              </h3>

              {/* Buy / Sell toggle */}
              <div className="flex rounded-xl overflow-hidden mb-4" style={{ border: '1px solid var(--border2)' }}>
                {(['buy', 'sell'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTab(t); setAmount(''); }}
                    className="flex-1 py-2 text-sm font-bold transition-all capitalize"
                    style={{
                      background: tab === t
                        ? (t === 'buy' ? 'rgba(57,255,20,0.18)' : 'rgba(255,90,90,0.18)')
                        : 'transparent',
                      color: tab === t
                        ? (t === 'buy' ? 'var(--green)' : 'var(--danger)')
                        : 'var(--sub)',
                    }}
                  >
                    {t === 'buy' ? '▲ Buy' : '▼ Sell'}
                  </button>
                ))}
              </div>

              {/* Amount input */}
              <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                {tab === 'buy' ? 'HNY to spend' : `${token.ticker} to sell`}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={0}
                step={tab === 'buy' ? '1' : '1000000'}
                placeholder={tab === 'buy' ? '10' : '1000000'}
                className="w-full rounded-xl px-4 py-2 text-sm font-mono-hive mb-2"
                style={{
                  background: 'var(--glass2)',
                  border: '1px solid var(--border2)',
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />

              {/* Quick amounts */}
              {tab === 'buy' && (
                <div className="flex gap-1 mb-4">
                  {[1, 5, 10, 50].map((v) => (
                    <button
                      key={v}
                      onClick={() => setAmount(String(v))}
                      className="flex-1 py-1 rounded-lg text-xs transition-colors"
                      style={{
                        background: amount === String(v) ? 'var(--glass2)' : 'transparent',
                        border: '1px solid var(--border2)',
                        color: 'var(--sub)',
                      }}
                    >
                      {v} HNY
                    </button>
                  ))}
                </div>
              )}

              {/* Preview output */}
              {amountNum > 0 && (
                <div
                  className="rounded-xl p-3 mb-4 text-xs flex flex-col gap-1.5"
                  style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}
                >
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--sub)' }}>
                      {tab === 'buy' ? 'Tokens received' : 'HNY received'}
                    </span>
                    <span className="font-bold" style={{ color: tab === 'buy' ? 'var(--green)' : 'var(--gold)' }}>
                      {tab === 'buy'
                        ? `${fmtTokens(previewOut)} ${token.ticker}`
                        : `${fmtHny(previewOut)} HNY`
                      }
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--sub)' }}>Fees (1.5%)</span>
                    <span style={{ color: 'var(--text)' }}>{totalFees.toFixed(4)} {tab === 'buy' ? 'HNY' : token.ticker}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--sub)' }}>Avg price</span>
                    <span style={{ color: 'var(--text)' }}>
                      {previewOut > 0
                        ? (tab === 'buy'
                            ? (amountNum / previewOut).toFixed(8)
                            : (previewOut / amountNum).toFixed(8))
                        : '—'
                      } HNY/{token.ticker}
                    </span>
                  </div>
                </div>
              )}

              {token.graduated ? (
                <div className="text-center py-2">
                  <p className="text-xs mb-2" style={{ color: 'var(--sub)' }}>
                    This token has graduated to the AMM DEX
                  </p>
                  <Link href="/trade" className="btn-green w-full justify-center" style={{ display: 'flex' }}>
                    Trade on AMM →
                  </Link>
                </div>
              ) : !address ? (
                <p className="text-xs text-center py-2" style={{ color: 'var(--sub)' }}>
                  Connect your HIVE Wallet to trade
                </p>
              ) : amountNum <= 0 ? (
                <button className="btn-outline w-full justify-center" disabled>
                  Enter amount
                </button>
              ) : (
                <button
                  className="w-full py-3 rounded-xl font-bold text-sm transition-all"
                  style={{
                    background: tab === 'buy' ? 'var(--green)' : 'var(--danger)',
                    color: '#040507',
                  }}
                  onClick={() => setShowConfirm(true)}
                >
                  {tab === 'buy'
                    ? `▲ Buy ${fmtTokens(previewOut)} ${token.ticker}`
                    : `▼ Sell ${fmtTokens(amountNum)} ${token.ticker}`
                  }
                </button>
              )}

              <p className="text-xs mt-3 text-center" style={{ color: 'var(--sub)' }}>
                Requires HIVE Wallet mobile app to sign
              </p>
            </div>

            {/* Token info */}
            <div className="glass-card p-4 text-xs" style={{ borderColor: 'var(--border2)' }}>
              <div className="font-semibold mb-2" style={{ color: 'var(--text)' }}>Token Info</div>
              <div className="flex flex-col gap-1.5">
                {[
                  ['Creator', `${token.creatorWallet.slice(0, 14)}…`],
                  ['Total Supply', '1,000,000,000'],
                  ['Tokens Sold', fmtTokens(token.tokensSold)],
                  ['Remaining', fmtTokens(VIRTUAL_SUP - token.tokensSold)],
                  ['Creator Fee', '1% / trade'],
                  ['Platform Fee', '0.5% / trade'],
                  ['Launched', new Date(token.createdAt).toLocaleDateString()],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span style={{ color: 'var(--sub)' }}>{k}</span>
                    <span style={{ color: 'var(--text)', fontFamily: k === 'Creator' ? 'var(--font-mono)' : 'inherit' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Confirm modal ──────────────────────────────────────── */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={(e) => e.target === e.currentTarget && setShowConfirm(false)}
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            className="glass-card p-6 w-full max-w-sm text-center"
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
          >
            <h2 className="font-bold text-lg mb-1" style={{ color: 'var(--gold)' }}>🐝 Confirm via HIVE Wallet</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--sub)' }}>
              Open your HIVE Wallet mobile app → Launchpad to sign this trade.
            </p>
            <div className="glass-card p-4 mb-4 text-sm text-left flex flex-col gap-2" style={{ borderColor: 'var(--border2)' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Token</span>
                <span className="font-bold" style={{ color: 'var(--green)' }}>{token.imageEmoji} ${token.ticker}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Action</span>
                <span style={{ color: tab === 'buy' ? 'var(--green)' : 'var(--danger)', fontWeight: 700 }}>
                  {tab === 'buy' ? '▲ BUY' : '▼ SELL'}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>{tab === 'buy' ? 'Spending' : 'Selling'}</span>
                <span style={{ color: 'var(--text)' }}>
                  {tab === 'buy' ? `${amountNum} HNY` : `${fmtTokens(amountNum)} ${token.ticker}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>{tab === 'buy' ? 'Receiving ~' : 'Receiving ~'}</span>
                <span style={{ color: tab === 'buy' ? 'var(--green)' : 'var(--gold)', fontWeight: 700 }}>
                  {tab === 'buy'
                    ? `${fmtTokens(previewOut)} ${token.ticker}`
                    : `${fmtHny(previewOut)} HNY`
                  }
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline flex-1 justify-center" onClick={() => setShowConfirm(false)}>Cancel</button>
              <a
                href="https://honey.network"
                target="_blank"
                rel="noreferrer"
                className="btn-green flex-1 justify-center"
                style={{ display: 'flex' }}
                onClick={() => setShowConfirm(false)}
              >
                Open HIVE Wallet
              </a>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
