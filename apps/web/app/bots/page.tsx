'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getMyBots, getBotTrades, getBotStats } from '@/lib/api';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import type { TradingBot, BotTrade, BotStats, BotType } from '@/lib/types';

// ── Bot type metadata ────────────────────────────────────────
const BOT_META: Record<BotType, { icon: string; label: string; color: string; desc: string }> = {
  dca:          { icon: '📅', label: 'DCA Bot',         color: 'var(--blue)',   desc: 'Buy a fixed amount at regular intervals — smooths out price volatility.' },
  grid:         { icon: '🔲', label: 'Grid Bot',        color: 'var(--green)',  desc: 'Place a ladder of buy/sell orders across a price range. Profits from up-down price oscillation.' },
  momentum:     { icon: '🚀', label: 'Momentum Bot',    color: 'var(--gold)',   desc: 'Buys when price rises past a threshold, sells when it falls back.' },
  stoptp:       { icon: '🛡️', label: 'Stop / Take-Profit', color: 'var(--danger)', desc: 'Automatically exits your position when price hits your target or stop loss.' },
  futures_grid: { icon: '⚡', label: 'Futures Grid',    color: 'var(--purple)', desc: 'Grid bot using leveraged perpetual futures — long at lower levels, closes on the way up.' },
};

// ── Helpers ──────────────────────────────────────────────────
function fmt(n: number, dp = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function pnlColor(pnl: number) {
  return pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--danger)' : 'var(--sub)';
}

// ── Create Bot Modal ─────────────────────────────────────────
function CreateBotModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep]   = useState<'type' | 'config' | 'confirm'>('type');
  const [type, setType]   = useState<BotType>('dca');
  const [name, setName]   = useState('');
  const [cfg, setCfg]     = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { address }       = useHiveWallet();

  const meta = BOT_META[type];

  // Default config fields per type
  const CONFIG_FIELDS: Record<BotType, { key: string; label: string; placeholder: string; hint?: string }[]> = {
    dca: [
      { key: 'pair',            label: 'Pair',              placeholder: 'HNY/USDT' },
      { key: 'buyAmountHny',    label: 'Buy Amount (HNY)',  placeholder: '50', hint: 'HNY spent per interval' },
      { key: 'intervalMinutes', label: 'Interval (minutes)', placeholder: '60', hint: 'How often to buy' },
    ],
    grid: [
      { key: 'pair',       label: 'Pair',          placeholder: 'HNY/USDT' },
      { key: 'lowerPrice', label: 'Lower Price',   placeholder: '0.80', hint: 'Bottom of the grid (HNY)' },
      { key: 'upperPrice', label: 'Upper Price',   placeholder: '1.20', hint: 'Top of the grid (HNY)' },
      { key: 'gridCount',  label: 'Grid Levels',   placeholder: '10',   hint: 'Number of buy/sell levels' },
      { key: 'totalHny',   label: 'Total HNY',     placeholder: '500',  hint: 'Total capital to deploy' },
    ],
    momentum: [
      { key: 'pair',              label: 'Pair',               placeholder: 'HNY/USDT' },
      { key: 'tradeAmountHny',    label: 'Trade Amount (HNY)', placeholder: '100' },
      { key: 'buyThresholdPct',   label: 'Buy Threshold (%)',  placeholder: '3', hint: 'Price rise % to trigger buy' },
      { key: 'sellThresholdPct',  label: 'Sell Threshold (%)', placeholder: '3', hint: 'Price fall % to trigger sell' },
      { key: 'lookbackMinutes',   label: 'Lookback (minutes)', placeholder: '30' },
    ],
    stoptp: [
      { key: 'pair',              label: 'Pair',                  placeholder: 'HNY/USDT' },
      { key: 'holdingAmountHny',  label: 'Holding Size (HNY)',    placeholder: '200' },
      { key: 'entryPrice',        label: 'Entry Price (HNY)',      placeholder: '1.00', hint: 'Your cost basis' },
      { key: 'takeProfitPrice',   label: 'Take Profit (HNY)',      placeholder: '1.25', hint: 'Sell when price ≥ this' },
      { key: 'stopLossPrice',     label: 'Stop Loss (HNY)',        placeholder: '0.85', hint: 'Sell when price ≤ this' },
    ],
    futures_grid: [
      { key: 'market',        label: 'Market ID',      placeholder: 'BTC' },
      { key: 'lowerPrice',    label: 'Lower Price',    placeholder: '90000', hint: 'Bottom of grid (HNY)' },
      { key: 'upperPrice',    label: 'Upper Price',    placeholder: '110000', hint: 'Top of grid (HNY)' },
      { key: 'gridCount',     label: 'Grid Levels',    placeholder: '8' },
      { key: 'collateralHny', label: 'Collateral (HNY)', placeholder: '200' },
      { key: 'leverage',      label: 'Leverage',       placeholder: '3', hint: '1x–20x' },
    ],
  };

  const fields = CONFIG_FIELDS[type];

  function buildConfig() {
    const out: Record<string, string | number> = {};
    for (const f of fields) {
      const v = cfg[f.key];
      if (!v) return null;
      out[f.key] = isNaN(Number(v)) ? v : Number(v);
    }
    return out;
  }

  async function handleCreate() {
    setError('');
    if (!address) { setError('Connect your HIVE Wallet first'); return; }
    const config = buildConfig();
    if (!config) { setError('Please fill in all fields'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/bots/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, type, name: name || `${meta.label} #${Date.now().toString().slice(-4)}`, config }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? 'Failed to create bot'); }
      else { onCreated(); onClose(); }
    } catch (e) {
      setError(String(e));
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-lg p-6 overflow-y-auto"
        style={{ maxHeight: '90vh', background: 'var(--bg2)' }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-bold text-xl" style={{ color: 'var(--gold)' }}>🤖 Create Trading Bot</h2>
          <button onClick={onClose} className="text-2xl opacity-50 hover:opacity-100">×</button>
        </div>

        {/* Step 1: Choose type */}
        {step === 'type' && (
          <>
            <p className="text-sm mb-4" style={{ color: 'var(--sub)' }}>Choose your bot strategy:</p>
            <div className="flex flex-col gap-3">
              {(Object.entries(BOT_META) as [BotType, typeof BOT_META[BotType]][]).map(([t, m]) => (
                <button key={t} onClick={() => setType(t)}
                  className="text-left rounded-xl p-4 transition-all"
                  style={{
                    background: type === t ? `rgba(${m.color === 'var(--green)' ? '57,255,20' : m.color === 'var(--blue)' ? '74,158,255' : m.color === 'var(--gold)' ? '245,180,41' : m.color === 'var(--danger)' ? '255,90,90' : '155,114,255'},0.12)` : 'var(--glass)',
                    border: `1px solid ${type === t ? m.color : 'var(--border2)'}`,
                  }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: 22 }}>{m.icon}</span>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: type === t ? m.color : 'var(--text)' }}>{m.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--sub)' }}>{m.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button className="btn-green w-full justify-center mt-6" onClick={() => setStep('config')}>
              Next: Configure →
            </button>
          </>
        )}

        {/* Step 2: Configure */}
        {step === 'config' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span style={{ fontSize: 20 }}>{meta.icon}</span>
              <h3 className="font-semibold" style={{ color: meta.color }}>{meta.label}</h3>
            </div>
            <div className="flex flex-col gap-1 mb-4">
              <label className="text-xs" style={{ color: 'var(--sub)' }}>Bot name (optional)</label>
              <input type="text" placeholder={`My ${meta.label}`} value={name} onChange={e => setName(e.target.value)}
                className="w-full p-3 rounded-xl text-sm"
                style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }} />
            </div>
            {fields.map(f => (
              <div key={f.key} className="flex flex-col gap-1 mb-3">
                <label className="text-xs flex items-center gap-2" style={{ color: 'var(--sub)' }}>
                  {f.label}
                  {f.hint && <span className="opacity-60">— {f.hint}</span>}
                </label>
                <input type="text" placeholder={f.placeholder}
                  value={cfg[f.key] ?? ''}
                  onChange={e => setCfg(c => ({ ...c, [f.key]: e.target.value }))}
                  className="w-full p-3 rounded-xl text-sm font-mono-hive"
                  style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }} />
              </div>
            ))}
            {error && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{error}</p>}
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1 justify-center" onClick={() => setStep('type')}>← Back</button>
              <button className="btn-green flex-1 justify-center" onClick={() => { if (buildConfig()) { setStep('confirm'); } else setError('Please fill in all fields'); }}>
                Preview →
              </button>
            </div>
          </>
        )}

        {/* Step 3: Confirm */}
        {step === 'confirm' && (
          <>
            <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--glass)', border: '1px solid var(--border)' }}>
              <p className="text-xs mb-2 font-semibold uppercase tracking-widest" style={{ color: 'var(--sub)' }}>Bot Summary</p>
              <div className="flex items-center gap-3 mb-3">
                <span style={{ fontSize: 28 }}>{meta.icon}</span>
                <div>
                  <p className="font-bold" style={{ color: meta.color }}>{name || meta.label}</p>
                  <p className="text-xs" style={{ color: 'var(--sub)' }}>{type}</p>
                </div>
              </div>
              {fields.map(f => (
                <div key={f.key} className="flex justify-between text-xs py-1" style={{ borderBottom: '1px solid var(--border2)', color: 'var(--sub)' }}>
                  <span>{f.label}</span>
                  <span className="font-mono-hive" style={{ color: 'var(--text)' }}>{cfg[f.key]}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl p-3 mb-4 text-xs" style={{ background: 'rgba(245,180,41,0.07)', border: '1px solid rgba(245,180,41,0.3)' }}>
              <p style={{ color: 'var(--gold)' }}>⚠ Bot runs automatically. It will trade on your behalf using funds from your wallet. Monitor and pause at any time.</p>
            </div>
            {error && <p className="text-xs mb-2" style={{ color: 'var(--danger)' }}>{error}</p>}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1 justify-center" onClick={() => setStep('config')}>← Edit</button>
              <button className="btn-green flex-1 justify-center" onClick={handleCreate} disabled={loading}>
                {loading ? 'Launching…' : '🚀 Launch Bot'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Bot Card ─────────────────────────────────────────────────
function BotCard({ bot, onRefresh }: { bot: TradingBot; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [trades, setTrades]     = useState<BotTrade[]>([]);
  const [loading, setLoading]   = useState(false);
  const { address }             = useHiveWallet();
  const meta = BOT_META[bot.type] ?? BOT_META.dca;
  const pnl  = parseFloat(bot.total_pnl) || 0;

  async function loadTrades() {
    const t = await getBotTrades(bot.id).catch(() => ({ trades: [] }));
    setTrades(t.trades ?? []);
  }

  async function togglePause() {
    if (!address) return;
    setLoading(true);
    const action = bot.status === 'active' ? 'pause' : 'resume';
    await fetch(`/api/bots/${action}/${bot.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: address }),
    });
    onRefresh();
    setLoading(false);
  }

  async function deleteBot() {
    if (!address) return;
    await fetch(`/api/bots/delete/${bot.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: address }),
    });
    onRefresh();
  }

  const config = JSON.parse(bot.config);
  const state  = JSON.parse(bot.state_json ?? '{}');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5"
      style={{ borderColor: bot.status === 'active' ? meta.color : 'var(--border2)', borderWidth: 1 }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 28 }}>{meta.icon}</span>
          <div>
            <p className="font-bold" style={{ color: 'var(--text)' }}>{bot.name}</p>
            <p className="text-xs" style={{ color: meta.color }}>{meta.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Status badge */}
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: bot.status === 'active' ? 'rgba(57,255,20,0.12)' : 'rgba(255,255,255,0.05)', color: bot.status === 'active' ? 'var(--green)' : 'var(--sub)', border: `1px solid ${bot.status === 'active' ? 'var(--border)' : 'var(--border2)'}` }}>
            {bot.status === 'active' ? '● ACTIVE' : bot.status.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="rounded-xl p-2 text-center" style={{ background: 'var(--glass2)' }}>
          <p className="text-xs" style={{ color: 'var(--sub)' }}>PnL</p>
          <p className="font-bold font-mono-hive text-sm" style={{ color: pnlColor(pnl) }}>
            {pnl >= 0 ? '+' : ''}{fmt(pnl)} HNY
          </p>
        </div>
        <div className="rounded-xl p-2 text-center" style={{ background: 'var(--glass2)' }}>
          <p className="text-xs" style={{ color: 'var(--sub)' }}>Trades</p>
          <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{bot.trade_count ?? 0}</p>
        </div>
        <div className="rounded-xl p-2 text-center" style={{ background: 'var(--glass2)' }}>
          <p className="text-xs" style={{ color: 'var(--sub)' }}>Last run</p>
          <p className="font-bold text-xs" style={{ color: 'var(--text)' }}>
            {bot.last_run_at ? new Date(bot.last_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
          </p>
        </div>
      </div>

      {/* Config summary */}
      <div className="text-xs mb-3 flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--sub)' }}>
        {bot.type === 'dca'      && <><span>Pair: <b style={{ color: 'var(--text)' }}>{config.pair}</b></span><span>Buy: <b style={{ color: 'var(--text)' }}>{config.buyAmountHny} HNY</b></span><span>Every: <b style={{ color: 'var(--text)' }}>{config.intervalMinutes}min</b></span></>}
        {bot.type === 'grid'     && <><span>Pair: <b style={{ color: 'var(--text)' }}>{config.pair}</b></span><span>Range: <b style={{ color: 'var(--text)' }}>{config.lowerPrice}–{config.upperPrice}</b></span><span>Levels: <b style={{ color: 'var(--text)' }}>{config.gridCount}</b></span></>}
        {bot.type === 'momentum' && <><span>Pair: <b style={{ color: 'var(--text)' }}>{config.pair}</b></span><span>Buy at: <b style={{ color: 'var(--green)' }}>+{config.buyThresholdPct}%</b></span><span>Sell at: <b style={{ color: 'var(--danger)' }}>-{config.sellThresholdPct}%</b></span></>}
        {bot.type === 'stoptp'   && <><span>TP: <b style={{ color: 'var(--green)' }}>{config.takeProfitPrice}</b></span><span>SL: <b style={{ color: 'var(--danger)' }}>{config.stopLossPrice}</b></span></>}
        {bot.type === 'futures_grid' && <><span>Market: <b style={{ color: 'var(--text)' }}>{config.market}</b></span><span>{config.leverage}× leverage</span></>}
        {state.inPosition && <span className="font-semibold" style={{ color: 'var(--gold)' }}>● In position @ {Number(state.entryPrice || 0).toFixed(4)}</span>}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button className="btn-outline text-xs px-3 py-1" onClick={async () => { setExpanded(!expanded); if (!expanded) await loadTrades(); }}>
          {expanded ? 'Hide' : 'Trades'}
        </button>
        {bot.status !== 'completed' && (
          <button
            className="text-xs px-3 py-1 rounded-xl font-medium"
            style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: bot.status === 'active' ? 'var(--gold)' : 'var(--green)', cursor: 'pointer' }}
            onClick={togglePause} disabled={loading}>
            {bot.status === 'active' ? '⏸ Pause' : '▶ Resume'}
          </button>
        )}
        <button className="text-xs px-3 py-1 rounded-xl font-medium" onClick={deleteBot}
          style={{ background: 'rgba(255,90,90,0.08)', border: '1px solid rgba(255,90,90,0.3)', color: 'var(--danger)', cursor: 'pointer' }}>
          🗑
        </button>
      </div>

      {/* Trade history */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border2)' }}>
              <p className="text-xs mb-2 font-semibold" style={{ color: 'var(--sub)' }}>Recent Trades</p>
              {trades.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--sub)' }}>No trades yet</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {trades.slice(0, 8).map(t => (
                    <div key={t.id} className="flex justify-between items-center text-xs py-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span className="font-medium" style={{ color: t.action.includes('buy') || t.action.includes('long') ? 'var(--green)' : 'var(--danger)' }}>
                        {t.action}
                      </span>
                      <span className="font-mono-hive" style={{ color: 'var(--text)' }}>{fmt(t.amount_hny)} HNY</span>
                      <span className="font-mono-hive" style={{ color: 'var(--sub)' }}>@ {Number(t.price_hny).toFixed(4)}</span>
                      <span style={{ color: 'var(--sub)' }}>{new Date(t.traded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function BotsPage() {
  const { address } = useHiveWallet();
  const [bots, setBots]         = useState<TradingBot[]>([]);
  const [stats, setStats]       = useState<BotStats | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter]     = useState<'all' | BotType>('all');
  const [offline, setOffline]   = useState(false);

  const load = useCallback(async () => {
    setOffline(false);
    try {
      const [s] = await Promise.all([
        getBotStats().catch(() => null),
      ]);
      if (s) setStats(s);
      if (address) {
        const b = await getMyBots(address).catch(() => ({ bots: [] }));
        setBots(b.bots ?? []);
      }
    } catch {
      setOffline(true);
    }
  }, [address]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const filteredBots = filter === 'all' ? bots : bots.filter(b => b.type === filter);
  const activeBots   = bots.filter(b => b.status === 'active').length;
  const totalPnl     = bots.reduce((s, b) => s + (parseFloat(b.total_pnl) || 0), 0);

  return (
    <div className="min-h-screen" style={{ paddingTop: 68 }}>
      {/* Hero header */}
      <div className="px-6 pt-10 pb-6" style={{ background: 'linear-gradient(180deg, rgba(155,114,255,0.06) 0%, transparent 100%)' }}>
        <div className="max-w-7xl mx-auto flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--text)' }}>🤖 Trading Bots</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--sub)' }}>
              Automated Queen Bee AI strategies — DCA, Grid, Momentum, Stop/TP, Futures Grid
            </p>
          </div>
          <button className="btn-green" onClick={() => setCreating(true)}>+ Create Bot</button>
        </div>
      </div>

      {offline && (
        <div className="mx-6 rounded-xl p-3 flex items-center gap-3 mb-4" style={{ background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.4)' }}>
          <span>⚠️</span>
          <p className="text-sm" style={{ color: 'var(--danger)' }}>HIVE server offline — bots are paused</p>
          <button className="ml-auto btn-outline text-xs px-3 py-1" onClick={load}>Retry</button>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 pb-16">
        {/* Global stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Active Bots',   value: stats.activeBots,               color: 'var(--green)' },
              { label: 'Total Bots',    value: stats.totalBots,                color: 'var(--text)' },
              { label: 'Total Trades',  value: stats.totalTrades.toLocaleString(), color: 'var(--blue)' },
              { label: 'Network PnL',   value: `${stats.totalPnlHny >= 0 ? '+' : ''}${fmt(stats.totalPnlHny)} HNY`, color: pnlColor(stats.totalPnlHny) },
            ].map(s => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-4 text-center">
                <p className="text-xs mb-1" style={{ color: 'var(--sub)' }}>{s.label}</p>
                <p className="text-xl font-bold font-mono-hive" style={{ color: s.color }}>{s.value}</p>
              </motion.div>
            ))}
          </div>
        )}

        {/* How it works */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 mb-8">
          <h2 className="font-bold text-lg mb-4" style={{ color: 'var(--text)' }}>🐝 How Trading Bots Work</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {(Object.entries(BOT_META) as [BotType, typeof BOT_META[BotType]][]).map(([t, m]) => (
              <div key={t} className="rounded-xl p-4" style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}>
                <div className="text-2xl mb-2">{m.icon}</div>
                <p className="font-semibold text-sm mb-1" style={{ color: m.color }}>{m.label}</p>
                <p className="text-xs" style={{ color: 'var(--sub)' }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* My bots section */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="font-bold text-lg" style={{ color: 'var(--text)' }}>
              My Bots {address && <span className="text-sm font-normal" style={{ color: 'var(--sub)' }}>({activeBots} active · {fmt(totalPnl)} HNY total PnL)</span>}
            </h2>
          </div>
          {/* Filter chips */}
          <div className="flex gap-2 flex-wrap">
            {(['all', ...Object.keys(BOT_META)] as ('all' | BotType)[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className="text-xs px-3 py-1.5 rounded-full font-medium"
                style={{ background: filter === f ? 'var(--purple)' : 'var(--glass2)', color: filter === f ? '#fff' : 'var(--sub)', border: '1px solid var(--border2)' }}>
                {f === 'all' ? 'All' : BOT_META[f as BotType]?.icon + ' ' + BOT_META[f as BotType]?.label}
              </button>
            ))}
          </div>
        </div>

        {!address ? (
          <div className="glass-card p-10 text-center">
            <p className="text-4xl mb-3">🔗</p>
            <p className="font-semibold text-lg mb-2" style={{ color: 'var(--text)' }}>Connect your HIVE Wallet</p>
            <p className="text-sm" style={{ color: 'var(--sub)' }}>Connect to manage and monitor your trading bots.</p>
          </div>
        ) : filteredBots.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <p className="text-4xl mb-3">🤖</p>
            <p className="font-semibold text-lg mb-2" style={{ color: 'var(--text)' }}>No bots yet</p>
            <p className="text-sm mb-4" style={{ color: 'var(--sub)' }}>Create your first bot to start automating your trades on the Honey Network.</p>
            <button className="btn-green mx-auto" onClick={() => setCreating(true)}>+ Create Bot</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {filteredBots.map(bot => (
              <BotCard key={bot.id} bot={bot} onRefresh={load} />
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {creating && <CreateBotModal onClose={() => setCreating(false)} onCreated={load} />}
    </div>
  );
}
