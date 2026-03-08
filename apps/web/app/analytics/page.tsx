'use client';

import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import {
  getPortfolio, getIncomeBreakdown, getActivityFeed,
  getPortfolioStats, getPortfolioHistory,
} from '@/lib/api';
import type { PortfolioSummary, IncomeData, ActivityItem, PortfolioStats, PortfolioSnapshot } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2) { return n.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function pnlColor(v: number) { return v >= 0 ? '#39ff14' : '#ff4444'; }
function fmtPnl(v: number) { return `${v >= 0 ? '+' : ''}${fmt(v)} HNY`; }
function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000)   return `${Math.floor(diff/1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff/60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff/3600_000)}h ago`;
  return `${Math.floor(diff/86400_000)}d ago`;
}

const ACTIVITY_ICONS: Record<string, string> = {
  send: '→', receive: '←', swap: '🔄', stake: '🔒', unstake: '🔓',
  bot_trade: '🤖', copy_trade: '📋', futures_closed: '📈', orderbook_fill: '📒',
  add_liquidity: '💧', remove_liquidity: '💧', nft_mint: '🖼', nft_sale: '💰',
};

// ── Sparkline chart ───────────────────────────────────────────────────────────

function Sparkline({ data, color = '#39ff14' }: { data: PortfolioSnapshot[]; color?: string }) {
  if (data.length < 2) {
    return <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 12 }}>No history yet</div>;
  }
  const chartData = data.map(d => ({ t: d.snapshotMs, v: d.netWorthHny }));
  return (
    <ResponsiveContainer width="100%" height={60}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area dataKey="v" stroke={color} fill="url(#sparkGrad)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <XAxis dataKey="t" hide />
        <YAxis hide domain={['auto', 'auto']} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { address: wallet } = useHiveWallet();

  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [income, setIncome]       = useState<IncomeData | null>(null);
  const [activity, setActivity]   = useState<ActivityItem[]>([]);
  const [stats, setStats]         = useState<PortfolioStats | null>(null);
  const [history, setHistory]     = useState<PortfolioSnapshot[]>([]);
  const [loading, setLoading]     = useState(false);
  const [tab, setTab]             = useState<'overview' | 'income' | 'activity'>('overview');

  const refresh = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const [p, inc, act, st, hist] = await Promise.all([
        getPortfolio(wallet),
        getIncomeBreakdown(wallet),
        getActivityFeed(wallet, 50),
        getPortfolioStats(wallet),
        getPortfolioHistory(wallet, 30),
      ]);
      setPortfolio(p);
      setIncome(inc);
      setActivity(act.activity);
      setStats(st);
      setHistory(hist.history);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div style={{ minHeight: '100vh', background: '#040507', color: '#e0e0e0', fontFamily: 'Space Grotesk, sans-serif', padding: '92px 16px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#39ff14', letterSpacing: -1, margin: 0 }}>📊 Portfolio Analytics</h1>
          <p style={{ color: '#666', marginTop: 6 }}>Unified view across all HIVE products.</p>
        </div>

        {!wallet ? (
          <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
            <p style={{ color: '#aaa' }}>Connect your HIVE Wallet to view your portfolio analytics.</p>
          </div>
        ) : loading && !portfolio ? (
          <div style={{ color: '#666', textAlign: 'center', padding: 60 }}>Loading portfolio…</div>
        ) : !portfolio ? (
          <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
            <p style={{ color: '#aaa' }}>No portfolio data yet — make your first transaction to start tracking.</p>
            <button onClick={refresh} style={{ marginTop: 16, background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : portfolio && (
          <>
            {/* Net Worth Card */}
            <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 24, marginBottom: 20 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ color: '#666', fontSize: 13, marginBottom: 4 }}>Total Net Worth</div>
                  <div style={{ color: '#39ff14', fontSize: 36, fontWeight: 800, fontFamily: 'Space Mono, monospace' }}>
                    {fmt(portfolio.totalValueHny)} HNY
                  </div>
                  <div style={{ color: '#f5b429', fontSize: 16, marginTop: 4 }}>
                    ≈ ${fmt(portfolio.totalValueUsd)} USD
                  </div>
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <div style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>30-Day Net Worth</div>
                  <Sparkline data={history} />
                </div>
              </div>
            </div>

            {/* Allocation Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'HNY Balance',   value: portfolio.hnyBalance,           icon: '🍯' },
                { label: 'Staking',       value: portfolio.stakingPositions.reduce((s,p) => s+p.principal, 0), icon: '🔒' },
                { label: 'LP Positions',  value: portfolio.lpPositions.reduce((s,p) => s+p.valueHny, 0), icon: '💧' },
                { label: 'Bot PnL',       value: portfolio.botsTotalPnlHny,       icon: '🤖', pnl: true },
                { label: 'Futures PnL',   value: portfolio.futuresRealizedPnlHny + portfolio.futuresUnrealizedPnlHny, icon: '📈', pnl: true },
                { label: 'Copy Trading',  value: portfolio.copyTradingPnlHny,     icon: '📋', pnl: true },
              ].map(({ label, value, icon, pnl }) => (
                <div key={label} style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 18, marginBottom: 6 }}>{icon}</div>
                  <div style={{ color: pnl ? pnlColor(value) : '#fff', fontWeight: 700, fontFamily: 'Space Mono, monospace', fontSize: 15 }}>
                    {pnl ? fmtPnl(value) : `${fmt(value)} HNY`}
                  </div>
                  <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Stats Row */}
            {stats && (
              <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 20, marginBottom: 20 }}>
                <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>Trading Stats</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'Total Txs',    value: stats.totalTxCount.toLocaleString() },
                    { label: 'Volume',       value: `${fmt(stats.totalVolumeHny)} HNY` },
                    { label: 'Best Trade',   value: fmtPnl(stats.bestTradeHny), color: pnlColor(stats.bestTradeHny) },
                    { label: 'Worst Trade',  value: fmtPnl(stats.worstTradeHny), color: pnlColor(stats.worstTradeHny) },
                    { label: 'Fees Paid',    value: `${fmt(stats.totalFeesPaidHny)} HNY` },
                    { label: 'Bot Win Rate', value: `${stats.botWinRate}%` },
                    { label: 'DAO Votes',    value: stats.daoVotesCast.toString() },
                    { label: 'NFTs Minted',  value: stats.nftsMinted.toString() },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{ color: color || '#fff', fontWeight: 700, fontFamily: 'Space Mono, monospace', fontSize: 14 }}>{value}</div>
                      <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['overview', 'income', 'activity'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ background: tab === t ? '#39ff14' : '#111', color: tab === t ? '#000' : '#aaa',
                           border: '1px solid ' + (tab === t ? '#39ff14' : '#333'), borderRadius: 8,
                           padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Income Breakdown */}
            {tab === 'income' && income && (
              <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 20 }}>
                <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>Income Breakdown</h2>
                <div style={{ marginBottom: 16 }}>
                  <span style={{ color: '#666', fontSize: 13 }}>Total Earned: </span>
                  <span style={{ color: pnlColor(income.totalIncomeHny), fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>
                    {fmtPnl(income.totalIncomeHny)}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {income.breakdown.map(b => (
                    <div key={b.source}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: '#aaa', fontSize: 13 }}>{b.source}</span>
                        <span style={{ color: pnlColor(b.amountHny), fontFamily: 'Space Mono, monospace', fontSize: 13 }}>{fmtPnl(b.amountHny)}</span>
                      </div>
                      <div style={{ background: '#111', borderRadius: 4, height: 6 }}>
                        <div style={{ background: pnlColor(b.amountHny), width: `${Math.abs(b.pct)}%`, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Token Balances Overview */}
            {tab === 'overview' && (
              <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 20 }}>
                <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>Token Holdings</h2>
                {portfolio.tokenBalances.length === 0 ? (
                  <p style={{ color: '#555', fontSize: 13 }}>No token balances.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {portfolio.tokenBalances.map(t => (
                      <div key={t.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #111' }}>
                        <span style={{ color: '#fff', fontWeight: 600 }}>{t.symbol}</span>
                        <span style={{ color: '#aaa', fontFamily: 'Space Mono, monospace', fontSize: 13 }}>{fmt(t.balance, 4)}</span>
                        <span style={{ color: '#f5b429', fontFamily: 'Space Mono, monospace', fontSize: 13 }}>${fmt(t.valueUsd)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Activity Feed */}
            {tab === 'activity' && (
              <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 20 }}>
                <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>Activity Feed</h2>
                {activity.length === 0 ? (
                  <p style={{ color: '#555', fontSize: 13 }}>No activity yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activity.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #111' }}>
                        <span style={{ fontSize: 18, minWidth: 24 }}>{ACTIVITY_ICONS[item.type] || '•'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#fff', fontSize: 13 }}>{item.label}</div>
                          <div style={{ color: '#555', fontSize: 11 }}>{item.detail}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: pnlColor(item.amountHny), fontFamily: 'Space Mono, monospace', fontSize: 13 }}>
                            {item.amountHny !== 0 ? `${item.amountHny > 0 ? '+' : ''}${fmt(item.amountHny, 4)} HNY` : '—'}
                          </div>
                          <div style={{ color: '#555', fontSize: 11 }}>{timeAgo(item.ts)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
