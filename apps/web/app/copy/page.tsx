'use client';

import { useState, useEffect, useCallback } from 'react';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import {
  getCopyLeaderboard,
  getMyCopySubscriptions,
  getMyCopyTrades,
  getCopyStats,
} from '@/lib/api';
import type { CopyLeader, CopySubscription, CopyTrade, CopyStats } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function shortAddr(w: string) {
  return w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

function pnlColor(v: number) {
  return v >= 0 ? '#39ff14' : '#ff4444';
}

function fmtPnl(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)} HNY`;
}

function statusBadge(s: string) {
  const map: Record<string, { bg: string; label: string }> = {
    active:    { bg: '#39ff14', label: 'Active'    },
    paused:    { bg: '#f5b429', label: 'Paused'    },
    cancelled: { bg: '#ff4444', label: 'Cancelled' },
  };
  const c = map[s] || { bg: '#666', label: s };
  return (
    <span style={{ background: c.bg, color: '#000', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
      {c.label}
    </span>
  );
}

function rankBadge(rank: number) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

// ── QR payload helpers ────────────────────────────────────────────────────────

function buildQRRegister(wallet: string, displayName: string, bio: string, strategyDescription: string, feePct: number) {
  const ts = Date.now();
  return JSON.stringify({
    action: 'copy_register_leader',
    wallet,
    displayName,
    bio,
    strategyDescription,
    feePct,
    ts,
    message: `copy_register|${wallet}|${displayName}|${feePct}|${ts}`,
  });
}

function buildQRSubscribe(followerWallet: string, leaderWallet: string, perTradeLimitHny: number) {
  const ts = Date.now();
  return JSON.stringify({
    action: 'copy_subscribe',
    followerWallet,
    leaderWallet,
    perTradeLimitHny,
    ts,
    message: `copy_subscribe|${followerWallet}|${leaderWallet}|${perTradeLimitHny}|${ts}`,
  });
}

function buildQRCancelSub(followerWallet: string, subscriptionId: string) {
  const ts = Date.now();
  return JSON.stringify({
    action: 'copy_cancel_sub',
    followerWallet,
    subscriptionId,
    ts,
    message: `copy_cancel|${followerWallet}|${subscriptionId}|${ts}`,
  });
}

// ── QR Modal ──────────────────────────────────────────────────────────────────

function QRModal({ title, payload, onClose }: { title: string; payload: string; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 16, padding: 32, maxWidth: 420, width: '90%', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        <h3 style={{ color: '#39ff14', marginBottom: 16, textAlign: 'center' }}>{title}</h3>
        <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
          Scan with HIVE Wallet to sign and submit.
        </p>
        <div style={{ background: '#111', borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 10, color: '#39ff14', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', marginBottom: 16 }}>
          {payload}
        </div>
        <p style={{ color: '#666', fontSize: 11, textAlign: 'center' }}>
          Open HIVE Wallet → Scan QR → Confirm transaction
        </p>
      </div>
    </div>
  );
}

// ── Register Leader Modal ─────────────────────────────────────────────────────

function RegisterLeaderModal({ wallet, onClose }: { wallet: string; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [strategyDescription, setStrategyDescription] = useState('');
  const [feePct, setFeePct] = useState(10);

  const payload = buildQRRegister(wallet, displayName, bio, strategyDescription, feePct);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 16, padding: 32, maxWidth: 480, width: '90%', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        <h3 style={{ color: '#39ff14', marginBottom: 8 }}>Become a Copy Leader</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{ flex: 1, height: 3, background: s <= step ? '#39ff14' : '#222', borderRadius: 2 }} />
          ))}
        </div>

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ color: '#aaa', fontSize: 13 }}>
              Display Name
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. Queen Bee Trader"
                style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 14, boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ color: '#aaa', fontSize: 13 }}>
              Bio
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Short introduction..."
                rows={2}
                style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ color: '#aaa', fontSize: 13 }}>
              Strategy Description
              <textarea
                value={strategyDescription}
                onChange={e => setStrategyDescription(e.target.value)}
                placeholder="Describe your trading strategy..."
                rows={3}
                style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ color: '#aaa', fontSize: 13 }}>
              Performance Fee: <span style={{ color: '#f5b429', fontWeight: 700 }}>{feePct}%</span>
              <input
                type="range" min={0} max={20} step={0.5}
                value={feePct}
                onChange={e => setFeePct(Number(e.target.value))}
                style={{ display: 'block', width: '100%', marginTop: 4 }}
              />
              <span style={{ fontSize: 11, color: '#666' }}>0% — 20%</span>
            </label>
            <button
              onClick={() => setStep(2)}
              disabled={!displayName.trim()}
              style={{ background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '12px 0', fontSize: 15, fontWeight: 700, cursor: displayName.trim() ? 'pointer' : 'not-allowed', opacity: displayName.trim() ? 1 : 0.4, marginTop: 4 }}
            >
              Preview →
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>This is how you will appear on the leaderboard:</p>
            <div style={{ background: '#111', border: '1px solid #39ff14', borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>⭐</span>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{displayName}</div>
                  <div style={{ color: '#666', fontSize: 11 }}>{shortAddr(wallet)}</div>
                </div>
                <span style={{ marginLeft: 'auto', background: '#f5b429', color: '#000', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Leader</span>
              </div>
              {bio && <p style={{ color: '#aaa', fontSize: 13, margin: '8px 0 4px' }}>{bio}</p>}
              {strategyDescription && <p style={{ color: '#666', fontSize: 12, fontStyle: 'italic' }}>{strategyDescription}</p>}
              <div style={{ marginTop: 10, color: '#aaa', fontSize: 12 }}>Performance fee: <span style={{ color: '#f5b429' }}>{feePct}%</span></div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(1)} style={{ flex: 1, background: '#111', border: '1px solid #444', borderRadius: 8, padding: '10px 0', color: '#aaa', cursor: 'pointer' }}>← Back</button>
              <button onClick={() => setStep(3)} style={{ flex: 2, background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 700, cursor: 'pointer' }}>Get QR Code →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>Scan with HIVE Wallet to register as a Copy Leader.</p>
            <div style={{ background: '#111', borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 10, color: '#39ff14', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', marginBottom: 16 }}>
              {payload}
            </div>
            <p style={{ color: '#666', fontSize: 11, textAlign: 'center' }}>Open HIVE Wallet → Scan QR → Confirm</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Copy Subscribe Modal ──────────────────────────────────────────────────────

function CopySubscribeModal({ leader, followerWallet, onClose }: { leader: CopyLeader; followerWallet: string; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [limit, setLimit] = useState(10);

  const payload = buildQRSubscribe(followerWallet, leader.wallet, limit);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 16, padding: 32, maxWidth: 440, width: '90%', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        <h3 style={{ color: '#39ff14', marginBottom: 8 }}>Copy {leader.displayName || shortAddr(leader.wallet)}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[1, 2].map(s => (
            <div key={s} style={{ flex: 1, height: 3, background: s <= step ? '#39ff14' : '#222', borderRadius: 2 }} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: 12, marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: pnlColor(leader.totalPnlHny ?? 0), fontWeight: 700, fontSize: 14 }}>{fmtPnl(leader.totalPnlHny ?? 0)}</div>
                <div style={{ color: '#666', fontSize: 11 }}>Total PnL</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{(leader.winRatePct ?? 0).toFixed(1)}%</div>
                <div style={{ color: '#666', fontSize: 11 }}>Win Rate</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{leader.followerCount ?? 0}</div>
                <div style={{ color: '#666', fontSize: 11 }}>Copiers</div>
              </div>
            </div>

            <div style={{ background: '#1a1a00', border: '1px solid #f5b429', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 12, color: '#f5b429' }}>
              ⚠️ Funds are deducted automatically when this leader's bots trade. Max per trade: {limit} HNY.
            </div>

            <label style={{ color: '#aaa', fontSize: 13 }}>
              Per-Trade Limit (HNY)
              <input
                type="number" min={1} max={10000} step={1}
                value={limit}
                onChange={e => setLimit(Math.max(1, Number(e.target.value)))}
                style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 15, boxSizing: 'border-box' }}
              />
              <span style={{ fontSize: 11, color: '#666' }}>Max HNY copied per single bot trade</span>
            </label>

            {leader.feePct > 0 && (
              <p style={{ color: '#aaa', fontSize: 12, marginTop: 10 }}>
                Leader fee: <span style={{ color: '#f5b429' }}>{leader.feePct}%</span> of profits + 1% copy fee per trade.
              </p>
            )}

            <button
              onClick={() => setStep(2)}
              style={{ width: '100%', background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '12px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 16 }}
            >
              Get QR Code →
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
              Scan with HIVE Wallet to start copying <strong style={{ color: '#fff' }}>{leader.displayName || shortAddr(leader.wallet)}</strong>.
            </p>
            <div style={{ background: '#111', borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 10, color: '#39ff14', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', marginBottom: 16 }}>
              {payload}
            </div>
            <button onClick={() => setStep(1)} style={{ width: '100%', background: '#111', border: '1px solid #444', borderRadius: 8, padding: '10px 0', color: '#aaa', cursor: 'pointer' }}>← Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CopyTradingPage() {
  const { address: wallet } = useHiveWallet();

  const [stats, setStats] = useState<CopyStats | null>(null);
  const [leaders, setLeaders] = useState<CopyLeader[]>([]);
  const [mySubs, setMySubs] = useState<CopySubscription[]>([]);
  const [myTrades, setMyTrades] = useState<CopyTrade[]>([]);
  const [loading, setLoading] = useState(true);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<CopyLeader | null>(null);
  const [cancelPayload, setCancelPayload] = useState<string | null>(null);
  const [expandedSub, setExpandedSub] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([getCopyStats(), getCopyLeaderboard()]);
      setStats(s);
      setLeaders(l.leaders);
      if (wallet) {
        const [subs, trades] = await Promise.all([getMyCopySubscriptions(wallet), getMyCopyTrades(wallet)]);
        setMySubs(subs.subscriptions);
        setMyTrades(trades.trades);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Map sub by leader wallet for quick lookup
  const subByLeader = Object.fromEntries(mySubs.map(s => [s.leaderWallet, s]));

  return (
    <div style={{ minHeight: '100vh', background: '#040507', color: '#e0e0e0', fontFamily: 'Space Grotesk, sans-serif', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#39ff14', letterSpacing: -1, margin: 0 }}>
            📋 Copy Trading
          </h1>
          <p style={{ color: '#666', marginTop: 6 }}>Mirror top traders automatically. Leaders earn fees when you profit.</p>
        </div>

        {/* Stats Bar */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 28 }}>
            {[
              { label: 'Leaders',       value: stats.totalLeaders },
              { label: 'Active Copiers', value: stats.totalCopiers },
              { label: 'Active Subs',   value: stats.activeSubs },
              { label: 'Copy Volume',   value: `${stats.totalCopyVolumeHny.toFixed(0)} HNY` },
              { label: 'Copy Trades',   value: stats.totalCopyTrades },
              { label: 'Fee Vault',     value: `${stats.feeVaultBalanceHny.toFixed(2)} HNY` },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ color: '#39ff14', fontSize: 18, fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>{value}</div>
                <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Leaderboard */}
        <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 20, marginBottom: 28 }}>
          <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Trader Leaderboard</h2>

          {loading ? (
            <div style={{ color: '#666', textAlign: 'center', padding: 40 }}>Loading…</div>
          ) : leaders.length === 0 ? (
            <div style={{ color: '#666', textAlign: 'center', padding: 40 }}>
              No traders yet. Create bots to appear on the leaderboard.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e2a1e', color: '#666' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left' }}>Rank</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left' }}>Trader</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Total PnL</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Bots</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Trades</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Win Rate</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Copiers</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Fee</th>
                    <th style={{ padding: '6px 10px', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((l) => {
                    const isMe = wallet && l.wallet === wallet;
                    const mySub = subByLeader[l.wallet];
                    const isCopying = mySub?.status === 'active';

                    return (
                      <tr key={l.wallet} style={{ borderBottom: '1px solid #111', transition: 'background 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#111')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '10px 10px', fontFamily: 'Space Mono, monospace', fontSize: 14 }}>
                          {rankBadge(l.rank ?? 99)}
                        </td>
                        <td style={{ padding: '10px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {l.isLeader && <span title="Registered Leader">⭐</span>}
                            <div>
                              <span style={{ color: '#fff', fontWeight: 600 }}>
                                {l.displayName || shortAddr(l.wallet)}
                              </span>
                              {l.displayName && (
                                <div style={{ color: '#555', fontSize: 10 }}>{shortAddr(l.wallet)}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'Space Mono, monospace', color: pnlColor(l.totalPnlHny ?? 0), fontWeight: 700 }}>
                          {fmtPnl(l.totalPnlHny ?? 0)}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#aaa' }}>{l.activeBots ?? 0}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#aaa' }}>{l.tradeCount ?? 0}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#aaa' }}>
                          {(l.winRatePct ?? 0).toFixed(1)}%
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#aaa' }}>{l.followerCount ?? 0}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', color: '#f5b429' }}>
                          {l.isLeader ? `${l.feePct}%` : '—'}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                          {isMe ? (
                            <span style={{ color: '#555', fontSize: 12 }}>— You</span>
                          ) : isCopying ? (
                            <span style={{ background: '#1a3a1a', color: '#39ff14', border: '1px solid #39ff14', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                              ✓ Copying
                            </span>
                          ) : l.isLeader && wallet ? (
                            <button
                              onClick={() => setCopyTarget(l)}
                              style={{ background: '#39ff14', color: '#000', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                            >
                              📋 Copy
                            </button>
                          ) : (
                            <span style={{ color: '#333', fontSize: 12 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* My Subscriptions */}
        {wallet && mySubs.length > 0 && (
          <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 20, marginBottom: 28 }}>
            <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>My Subscriptions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {mySubs.map(sub => {
                const leader = leaders.find(l => l.wallet === sub.leaderWallet);
                const leaderName = leader?.displayName || shortAddr(sub.leaderWallet);
                const subTrades = myTrades.filter(t => t.subscriptionId === sub.id);
                const isExpanded = expandedSub === sub.id;

                return (
                  <div key={sub.id} style={{ background: '#111', border: '1px solid #1e2a1e', borderRadius: 10, padding: 16 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ color: '#fff', fontWeight: 600 }}>{leaderName}</div>
                        <div style={{ color: '#555', fontSize: 11 }}>{shortAddr(sub.leaderWallet)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#aaa', fontSize: 11 }}>Per-Trade Limit</div>
                        <div style={{ color: '#fff', fontWeight: 600 }}>{sub.perTradeLimitHny} HNY</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#aaa', fontSize: 11 }}>Total Used</div>
                        <div style={{ color: '#f5b429', fontWeight: 600 }}>{sub.usedHny.toFixed(2)} HNY</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#aaa', fontSize: 11 }}>Total PnL</div>
                        <div style={{ color: pnlColor(sub.totalPnlHny), fontWeight: 600 }}>{fmtPnl(sub.totalPnlHny)}</div>
                      </div>
                      <div>{statusBadge(sub.status)}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {sub.status === 'active' && (
                          <button
                            onClick={() => setCancelPayload(buildQRCancelSub(wallet, sub.id))}
                            style={{ background: '#1a0000', border: '1px solid #ff4444', color: '#ff4444', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        )}
                        {subTrades.length > 0 && (
                          <button
                            onClick={() => setExpandedSub(isExpanded ? null : sub.id)}
                            style={{ background: '#111', border: '1px solid #333', color: '#aaa', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                          >
                            {isExpanded ? 'Hide' : `Trades (${subTrades.length})`}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && subTrades.length > 0 && (
                      <div style={{ marginTop: 14, borderTop: '1px solid #1e2a1e', paddingTop: 12 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ color: '#555' }}>
                              <th style={{ textAlign: 'left', padding: '4px 8px' }}>Time</th>
                              <th style={{ textAlign: 'left', padding: '4px 8px' }}>Action</th>
                              <th style={{ textAlign: 'right', padding: '4px 8px' }}>Amount</th>
                              <th style={{ textAlign: 'right', padding: '4px 8px' }}>Fee</th>
                              <th style={{ textAlign: 'right', padding: '4px 8px' }}>Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {subTrades.slice(0, 5).map(t => (
                              <tr key={t.id} style={{ borderBottom: '1px solid #0a0a0a' }}>
                                <td style={{ padding: '6px 8px', color: '#555' }}>{new Date(t.executedAtMs).toLocaleString()}</td>
                                <td style={{ padding: '6px 8px', color: '#39ff14' }}>{t.action}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#fff' }}>{t.copyAmountHny.toFixed(4)} HNY</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#f5b429' }}>{t.feeHny.toFixed(4)} HNY</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#aaa', fontFamily: 'Space Mono, monospace' }}>${t.leaderPrice.toFixed(4)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Become a Leader + How It Works */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 28 }}>

          {/* Become a Leader */}
          <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 14, padding: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⭐</div>
            <h2 style={{ color: '#39ff14', fontSize: 18, fontWeight: 700, margin: '0 0 10px' }}>Become a Copy Leader</h2>
            <p style={{ color: '#aaa', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Register as a leader to let others copy your bot trades. Earn a performance fee every time your followers profit.
            </p>
            {wallet ? (
              <button
                onClick={() => setRegisterOpen(true)}
                style={{ background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >
                Register as Leader
              </button>
            ) : (
              <p style={{ color: '#555', fontSize: 13 }}>Connect your HIVE Wallet to register.</p>
            )}
          </div>

          {/* How It Works */}
          <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 24 }}>
            <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>How It Works</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { icon: '⭐', title: 'Become a Leader', desc: 'Register your wallet, set a display name, bio, and performance fee.' },
                { icon: '🤖', title: 'Trade with Bots',  desc: 'Your automated bots trade on the HIVE network every 60 seconds.' },
                { icon: '📋', title: 'Followers Mirror', desc: 'Subscribers automatically copy your bot trades proportionally.' },
                { icon: '💰', title: 'Earn Fees',        desc: 'Earn 50% of the 1% copy fee on every trade your followers mirror.' },
              ].map(({ icon, title, desc }) => (
                <div key={title} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ fontSize: 20, minWidth: 28 }}>{icon}</div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{title}</div>
                    <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Modals */}
      {registerOpen && wallet && (
        <RegisterLeaderModal wallet={wallet} onClose={() => setRegisterOpen(false)} />
      )}
      {copyTarget && wallet && (
        <CopySubscribeModal leader={copyTarget} followerWallet={wallet} onClose={() => setCopyTarget(null)} />
      )}
      {cancelPayload && (
        <QRModal title="Cancel Subscription" payload={cancelPayload} onClose={() => setCancelPayload(null)} />
      )}
    </div>
  );
}
