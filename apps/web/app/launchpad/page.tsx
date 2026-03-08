'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { getLaunchpadTokens, getLaunchpadStats } from '@/lib/api';
import type { LaunchpadToken, LaunchpadStats } from '@/lib/types';
import { useHiveWallet } from '@/components/HiveWalletConnect';

// ── Bonding curve math (mirrors server) ───────────────────
const VIRTUAL_HNY  = 1_000;
const VIRTUAL_SUP  = 1_000_000_000;
const GRAD_THRESH  = 100;

function bondingPrice(realHny: number, tokensSold: number) {
  return (VIRTUAL_HNY + realHny) / (VIRTUAL_SUP - tokensSold);
}

function graduationPct(raised: number) {
  return Math.min(100, (raised / GRAD_THRESH) * 100);
}

function fmtHny(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function fmtNum(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

// ── Token card ─────────────────────────────────────────────
function TokenCard({ token }: { token: LaunchpadToken }) {
  const pct = token.graduationPct;
  const isHot = token.realHnyRaised > 50;

  return (
    <Link href={`/launchpad/${token.id}`} style={{ textDecoration: 'none' }}>
      <motion.div
        whileHover={{ y: -3, boxShadow: '0 0 20px rgba(57,255,20,0.12)' }}
        className="glass-card p-4 cursor-pointer h-full flex flex-col gap-3"
        style={{ border: `1px solid ${isHot ? 'rgba(57,255,20,0.3)' : 'var(--border2)'}` }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}
            >
              {token.imageEmoji}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>{token.name}</span>
                {isHot && <span className="text-xs" title="Trending">🔥</span>}
                {token.graduated && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                    style={{ background: 'rgba(245,180,41,0.15)', color: 'var(--gold)', border: '1px solid var(--gold)' }}
                  >
                    🎓 Graduated
                  </span>
                )}
              </div>
              <span
                className="text-xs font-mono-hive px-1.5 py-0.5 rounded"
                style={{ background: 'var(--glass2)', color: 'var(--green)' }}
              >
                ${token.ticker}
              </span>
            </div>
          </div>
          <div className="text-right text-xs" style={{ color: 'var(--sub)' }}>
            <div className="font-bold" style={{ color: 'var(--gold)' }}>{fmtHny(token.marketCapHny)} HNY</div>
            <div>mcap</div>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--sub)' }}>
          {token.description || 'No description.'}
        </p>

        {/* Stats row */}
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--sub)' }}>
          <span>Price: <strong style={{ color: 'var(--text)' }}>{token.priceHny.toFixed(8)} HNY</strong></span>
          <span>Raised: <strong style={{ color: 'var(--green)' }}>{fmtHny(token.realHnyRaised)} HNY</strong></span>
        </div>

        {/* Graduation progress bar */}
        {!token.graduated && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--sub)' }}>
              <span>Bonding curve progress</span>
              <span style={{ color: pct >= 80 ? 'var(--gold)' : 'var(--sub)' }}>{pct.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--glass2)' }}>
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
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs mt-auto" style={{ color: 'var(--sub)' }}>
          <span>{fmtNum(token.tokensSold)} sold</span>
          <span>{token.lastTradeAt
            ? new Date(token.lastTradeAt).toLocaleTimeString()
            : new Date(token.createdAt).toLocaleDateString()}
          </span>
        </div>
      </motion.div>
    </Link>
  );
}

// ── Launch modal ───────────────────────────────────────────
function LaunchModal({ onClose, onLaunched }: { onClose: () => void; onLaunched: (t: LaunchpadToken) => void }) {
  const { address } = useHiveWallet();
  const [form, setForm] = useState({
    name: '', ticker: '', description: '', imageEmoji: '🚀',
    website: '', twitter: '', telegram: '',
  });
  const [step, setStep] = useState<'form' | 'confirm'>('form');

  const EMOJI_OPTIONS = ['🚀','🍯','🐝','💎','🔥','🌙','⚡','🦋','🌸','👑','💥','🌈','🦊','🐸','🎯'];

  function set(k: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  const valid = form.name.trim().length >= 2 && form.ticker.trim().length >= 2;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card p-6 w-full max-w-md"
        style={{ background: 'var(--bg2)', border: '1px solid var(--border)', margin: 'auto' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg" style={{ color: 'var(--gold)' }}>🚀 Launch a Token</h2>
          <button onClick={onClose} className="text-2xl opacity-50 hover:opacity-100">×</button>
        </div>

        {step === 'form' ? (
          <>
            {/* Emoji picker */}
            <label className="block text-xs mb-1.5" style={{ color: 'var(--sub)' }}>Token Logo</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => set('imageEmoji', e)}
                  className="w-9 h-9 rounded-xl text-xl flex items-center justify-center transition-all"
                  style={{
                    background: form.imageEmoji === e ? 'var(--glass2)' : 'transparent',
                    border: `1px solid ${form.imageEmoji === e ? 'var(--green)' : 'var(--border2)'}`,
                  }}
                >
                  {e}
                </button>
              ))}
            </div>

            {/* Name + ticker */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Token Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Honey Moon"
                  maxLength={50}
                  className="w-full rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Ticker *</label>
                <input
                  value={form.ticker}
                  onChange={(e) => set('ticker', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                  placeholder="HMOON"
                  maxLength={10}
                  className="w-full rounded-xl px-3 py-2 text-sm font-mono-hive"
                  style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--green)', outline: 'none' }}
                />
              </div>
            </div>

            {/* Description */}
            <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What's the vibe? Tell the community about your token..."
              rows={3}
              maxLength={500}
              className="w-full rounded-xl px-3 py-2 text-sm mb-3 resize-none"
              style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
            />

            {/* Social links */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {[['website', '🌐', 'Website URL'], ['twitter', '𝕏', 'Twitter/X'], ['telegram', '✈️', 'Telegram']].map(([k, icon, ph]) => (
                <div key={k}>
                  <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>{icon}</label>
                  <input
                    value={form[k as keyof typeof form]}
                    onChange={(e) => set(k as keyof typeof form, e.target.value)}
                    placeholder={ph}
                    className="w-full rounded-xl px-2 py-1.5 text-xs"
                    style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
                  />
                </div>
              ))}
            </div>

            <div className="text-xs mb-4 p-3 rounded-xl" style={{ background: 'var(--glass2)', color: 'var(--sub)' }}>
              Launch fee: <strong style={{ color: 'var(--gold)' }}>1 HNY</strong> · Total supply: <strong style={{ color: 'var(--text)' }}>1B tokens</strong> · Graduation: <strong style={{ color: 'var(--green)' }}>100 HNY raised</strong>
            </div>

            {!address ? (
              <p className="text-xs text-center" style={{ color: 'var(--sub)' }}>Connect HIVE Wallet to launch</p>
            ) : (
              <button
                className="btn-green w-full justify-center"
                disabled={!valid}
                onClick={() => setStep('confirm')}
                style={{ opacity: valid ? 1 : 0.4 }}
              >
                Continue →
              </button>
            )}
          </>
        ) : (
          <>
            {/* Confirm step */}
            <div className="flex items-center gap-4 mb-5">
              <div className="text-5xl">{form.imageEmoji}</div>
              <div>
                <div className="font-bold text-xl" style={{ color: 'var(--text)' }}>{form.name}</div>
                <div className="font-mono-hive text-sm" style={{ color: 'var(--green)' }}>${form.ticker}</div>
              </div>
            </div>

            <div className="glass-card p-4 mb-5 text-sm flex flex-col gap-2" style={{ borderColor: 'var(--border2)' }}>
              {[
                ['Total Supply', '1,000,000,000'],
                ['Launch Fee', '1 HNY'],
                ['Graduation Goal', '100 HNY raised'],
                ['Creator Fee', '1% of every trade'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>{k}</span>
                  <span style={{ color: 'var(--text)' }}>{v}</span>
                </div>
              ))}
            </div>

            <p className="text-xs mb-5 text-center" style={{ color: 'var(--sub)' }}>
              Open your <strong style={{ color: 'var(--green)' }}>HIVE Wallet</strong> mobile app → Launchpad to sign and launch this token.
            </p>

            <div className="flex gap-3">
              <button className="btn-outline flex-1 justify-center" onClick={() => setStep('form')}>← Back</button>
              <a
                href="https://honey.network"
                target="_blank"
                rel="noreferrer"
                className="btn-green flex-1 justify-center"
                style={{ display: 'flex' }}
                onClick={onClose}
              >
                Open HIVE Wallet 🐝
              </a>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════ */
export default function LaunchpadPage() {
  const { address } = useHiveWallet();

  const [tokens, setTokens]       = useState<LaunchpadToken[]>([]);
  const [stats, setStats]         = useState<LaunchpadStats | null>(null);
  const [sort, setSort]           = useState<'newest' | 'trending' | 'graduating'>('trending');
  const [showGraduated, setShowGraduated] = useState(false);
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(true);
  const [serverOffline, setServerOffline] = useState(false);
  const [showLaunch, setShowLaunch] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tokData, statsData] = await Promise.all([
        getLaunchpadTokens(sort, showGraduated),
        getLaunchpadStats(),
      ]);
      setTokens(tokData.tokens);
      setStats(statsData);
      setServerOffline(false);
    } catch {
      setServerOffline(true);
    } finally {
      setLoading(false);
    }
  }, [sort, showGraduated]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = tokens.filter((t) =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.ticker.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen" style={{ paddingTop: 68, background: 'var(--bg)' }}>
      <div className="max-w-screen-xl mx-auto px-4 py-6">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
              🚀 Token Launchpad
            </h1>
            <p className="text-sm" style={{ color: 'var(--sub)' }}>
              Launch any token on Honey Network with a fair bonding curve. No pre-sale. No team allocation.
            </p>
          </div>
          <button
            className="btn-green flex-shrink-0"
            onClick={() => setShowLaunch(true)}
          >
            + Launch Token
          </button>
        </div>

        {/* ── Stats bar ──────────────────────────────────────── */}
        {stats && (
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
          >
            {[
              { label: 'Tokens Launched', value: stats.totalTokens.toLocaleString(), color: 'var(--green)' },
              { label: 'Graduated', value: stats.graduatedTokens.toLocaleString(), color: 'var(--gold)' },
              { label: 'HNY Raised', value: `${fmtHny(stats.totalHnyRaised)} HNY`, color: 'var(--green)' },
              { label: 'Total Trades', value: stats.totalTrades.toLocaleString(), color: 'var(--blue)' },
            ].map((s) => (
              <div key={s.label} className="glass-card p-4 text-center" style={{ borderColor: 'var(--border2)' }}>
                <div className="text-xl font-bold font-mono-hive" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--sub)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── How it works ──────────────────────────────────── */}
        <div
          className="glass-card p-4 mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 text-center text-xs"
          style={{ borderColor: 'var(--border2)' }}
        >
          {[
            { icon: '🚀', title: 'Launch', desc: 'Pay 1 HNY to deploy your token with a 1B supply' },
            { icon: '📈', title: 'Buy & Sell', desc: 'Bonding curve pricing — early buyers pay less' },
            { icon: '🎓', title: 'Graduate', desc: 'Raise 100 HNY to graduate to the AMM DEX' },
            { icon: '💸', title: 'Earn', desc: '1% creator fee on every trade of your token' },
          ].map((s) => (
            <div key={s.title}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className="font-bold mb-1" style={{ color: 'var(--text)' }}>{s.title}</div>
              <div style={{ color: 'var(--sub)' }}>{s.desc}</div>
            </div>
          ))}
        </div>

        {/* ── Filter + search bar ────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* Sort chips */}
          <div className="flex gap-1">
            {(['trending', 'newest', 'graduating'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all"
                style={{
                  background: sort === s ? 'rgba(57,255,20,0.15)' : 'var(--glass)',
                  border: `1px solid ${sort === s ? 'var(--green)' : 'var(--border2)'}`,
                  color: sort === s ? 'var(--green)' : 'var(--sub)',
                }}
              >
                {s === 'trending' ? '🔥 Trending' : s === 'newest' ? '🆕 Newest' : '🎓 Graduating'}
              </button>
            ))}
          </div>

          {/* Graduated toggle */}
          <button
            onClick={() => setShowGraduated((v) => !v)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: showGraduated ? 'rgba(245,180,41,0.15)' : 'var(--glass)',
              border: `1px solid ${showGraduated ? 'var(--gold)' : 'var(--border2)'}`,
              color: showGraduated ? 'var(--gold)' : 'var(--sub)',
            }}
          >
            🎓 Graduated
          </button>

          {/* Search */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tokens..."
            className="ml-auto rounded-xl px-3 py-1.5 text-sm"
            style={{
              background: 'var(--glass2)',
              border: '1px solid var(--border2)',
              color: 'var(--text)',
              outline: 'none',
              minWidth: 180,
            }}
          />
        </div>

        {/* ── Offline banner ─────────────────────────────────── */}
        {serverOffline && (
          <div className="glass-card p-3 mb-4 flex items-center justify-between" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            <span className="text-sm">⚠️ Server offline — make sure the HIVE server is running on port 3000</span>
            <button onClick={load} className="text-xs btn-outline py-1 px-3">Retry</button>
          </div>
        )}

        {/* ── Token grid ─────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--green)', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-3">🚀</div>
            <p className="text-lg font-bold mb-2" style={{ color: 'var(--text)' }}>No tokens yet</p>
            <p className="text-sm mb-5" style={{ color: 'var(--sub)' }}>Be the first to launch a token on Honey Network!</p>
            <button className="btn-green" onClick={() => setShowLaunch(true)}>Launch Token</button>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
          >
            {filtered.map((token) => (
              <motion.div
                key={token.id}
                variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
              >
                <TokenCard token={token} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Launch modal ──────────────────────────────────────── */}
      <AnimatePresence>
        {showLaunch && (
          <LaunchModal
            onClose={() => setShowLaunch(false)}
            onLaunched={(t) => {
              setShowLaunch(false);
              setTokens((prev) => [t, ...prev]);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
