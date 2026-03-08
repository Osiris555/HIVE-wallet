'use client';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import {
  getDaoProposals, getDaoStats, getDaoTreasury, getDaoVotingPower, getDaoMyVotes,
} from '@/lib/api';
import type { DaoProposal, DaoProposalType, DaoStats, DaoTreasury, DaoVotingPower, DaoVote } from '@/lib/types';
import { useHiveWallet } from '@/components/HiveWalletConnect';

// ── Helpers ────────────────────────────────────────────────────────────────
const TYPE_META: Record<DaoProposalType, { label: string; color: string; icon: string }> = {
  parameter_change:    { label: 'Param Change',      color: 'var(--blue)',    icon: '⚙️' },
  treasury_allocation: { label: 'Treasury',          color: 'var(--gold)',    icon: '🏦' },
  protocol_upgrade:    { label: 'Protocol Upgrade',  color: '#9b72ff',        icon: '⬆️' },
  emergency:           { label: 'Emergency',         color: 'var(--danger)',  icon: '🚨' },
};

const STATUS_COLOR: Record<string, string> = {
  draft:      'rgba(232,240,228,0.4)',
  active:     'var(--green)',
  timelocked: 'var(--gold)',
  executed:   'rgba(232,240,228,0.35)',
  rejected:   'var(--danger)',
  cancelled:  'rgba(232,240,228,0.3)',
};

function fmtHny(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function timeRemaining(ms?: number): string {
  if (!ms) return '';
  const diff = ms - Date.now();
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000)  / 60000);
  if (d > 0) return `${d}d ${h}h remaining`;
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

function VoteBar({ yes, no, abstain }: { yes: number; no: number; abstain: number }) {
  const total = yes + no + abstain || 1;
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.06)', gap: 1 }}>
      <div style={{ width: `${(yes / total) * 100}%`, background: 'var(--green)', transition: 'width 0.4s' }} />
      <div style={{ width: `${(no  / total) * 100}%`, background: 'var(--danger)', transition: 'width 0.4s' }} />
      <div style={{ width: `${(abstain / total) * 100}%`, background: 'rgba(232,240,228,0.25)', transition: 'width 0.4s' }} />
    </div>
  );
}

// ── Proposal Type selector cards ───────────────────────────────────────────
const TYPE_CARDS: { type: DaoProposalType; title: string; desc: string; icon: string; color: string }[] = [
  { type: 'parameter_change',    icon: '⚙️', color: 'var(--blue)',   title: 'Parameter Change',    desc: 'Modify protocol parameters like fees, limits, or APR rates' },
  { type: 'treasury_allocation', icon: '🏦', color: 'var(--gold)',   title: 'Treasury Allocation', desc: 'Request HNY from the DAO treasury for a project or grant' },
  { type: 'protocol_upgrade',    icon: '⬆️', color: '#9b72ff',      title: 'Protocol Upgrade',    desc: 'Propose logic changes or feature additions to Honey Network' },
  { type: 'emergency',           icon: '🚨', color: 'var(--danger)', title: 'Emergency Action',    desc: 'Critical fix for chain halts, exploits, or economic attacks' },
];

// ── QR Modal ───────────────────────────────────────────────────────────────
function DaoQRModal({ payload, title, onClose }: { payload: object; title: string; onClose: () => void }) {
  const qrStr = JSON.stringify(payload);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(4,5,7,0.85)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '28px 32px', maxWidth: 400, width: '90%',
          textAlign: 'center',
        }}
      >
        <p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{title}</p>
        <p style={{ color: 'var(--sub)', fontSize: 12, marginBottom: 20 }}>
          Scan with HIVE Wallet to sign and submit
        </p>
        <div style={{ display: 'inline-block', background: '#fff', padding: 12, borderRadius: 12 }}>
          <QRCodeSVG value={qrStr} size={200} />
        </div>
        <p style={{ color: 'rgba(232,240,228,0.35)', fontSize: 10, marginTop: 14, fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {qrStr.slice(0, 80)}…
        </p>
        <button
          onClick={onClose}
          style={{
            marginTop: 18, padding: '8px 28px', background: 'var(--glass2)',
            border: '1px solid var(--border2)', borderRadius: 10,
            color: 'var(--sub)', cursor: 'pointer', fontSize: 13,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── Create Proposal Modal ──────────────────────────────────────────────────
function CreateProposalModal({
  wallet, onClose,
}: { wallet: string; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<DaoProposalType>('parameter_change');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recipientWallet, setRecipientWallet] = useState('');
  const [allocAmount, setAllocAmount] = useState('');
  const [showQR, setShowQR] = useState(false);

  const qrPayload = {
    action: 'governance_draft',
    wallet,
    title,
    type,
    description,
    ...(type === 'treasury_allocation' && { metadataJson: { recipient: recipientWallet, amount: parseFloat(allocAmount) || 0 } }),
    ts: Date.now(),
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(4,5,7,0.88)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '28px 32px', maxWidth: 560, width: '95%',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 18 }}>
            🏛️ New Proposal — Step {step}/3
          </p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--sub)', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        {/* Step 1 — Choose type */}
        {step === 1 && (
          <>
            <p style={{ color: 'var(--sub)', fontSize: 13, marginBottom: 16 }}>Select the type of proposal you want to create:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {TYPE_CARDS.map(tc => (
                <button
                  key={tc.type}
                  onClick={() => setType(tc.type)}
                  style={{
                    background: type === tc.type ? `${tc.color}18` : 'var(--glass)',
                    border: `1.5px solid ${type === tc.type ? tc.color : 'var(--border2)'}`,
                    borderRadius: 14, padding: '14px 12px', cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <p style={{ fontSize: 22, marginBottom: 6 }}>{tc.icon}</p>
                  <p style={{ color: type === tc.type ? tc.color : 'var(--text)', fontWeight: 700, fontSize: 13 }}>{tc.title}</p>
                  <p style={{ color: 'var(--sub)', fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>{tc.desc}</p>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep(2)}
              style={{
                marginTop: 20, width: '100%', padding: '12px 0',
                background: 'var(--gold)', color: '#040507',
                border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              Continue →
            </button>
          </>
        )}

        {/* Step 2 — Fill details */}
        {step === 2 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>{TYPE_META[type].icon}</span>
              <span style={{ color: TYPE_META[type].color, fontWeight: 700, fontSize: 14 }}>{TYPE_META[type].label}</span>
            </div>
            <label style={{ color: 'var(--sub)', fontSize: 12, display: 'block', marginBottom: 4 }}>Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 200))}
              placeholder="Short, descriptive title for your proposal"
              maxLength={200}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                background: 'var(--glass)', border: '1px solid var(--border2)',
                borderRadius: 10, color: 'var(--text)', fontSize: 14, marginBottom: 14,
              }}
            />
            <label style={{ color: 'var(--sub)', fontSize: 12, display: 'block', marginBottom: 4 }}>Description *</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 4000))}
              placeholder="Describe your proposal in detail — motivation, implementation, expected impact…"
              rows={5}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                background: 'var(--glass)', border: '1px solid var(--border2)',
                borderRadius: 10, color: 'var(--text)', fontSize: 13, resize: 'vertical', marginBottom: 14,
              }}
            />
            {type === 'treasury_allocation' && (
              <>
                <label style={{ color: 'var(--sub)', fontSize: 12, display: 'block', marginBottom: 4 }}>Recipient Wallet *</label>
                <input
                  value={recipientWallet}
                  onChange={e => setRecipientWallet(e.target.value)}
                  placeholder="HNY_..."
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                    background: 'var(--glass)', border: '1px solid var(--border2)',
                    borderRadius: 10, color: 'var(--text)', fontSize: 13, marginBottom: 14,
                    fontFamily: 'monospace',
                  }}
                />
                <label style={{ color: 'var(--sub)', fontSize: 12, display: 'block', marginBottom: 4 }}>Requested Amount (HNY) *</label>
                <input
                  type="number"
                  value={allocAmount}
                  onChange={e => setAllocAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                    background: 'var(--glass)', border: '1px solid var(--border2)',
                    borderRadius: 10, color: 'var(--gold)', fontSize: 14, marginBottom: 14,
                  }}
                />
              </>
            )}
            <div style={{
              background: 'rgba(245,180,41,0.08)', border: '1px solid rgba(245,180,41,0.2)',
              borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--sub)', marginBottom: 16,
            }}>
              ⚠️ Requires ≥ 10,000 staked HNY to create a draft.<br />
              Submitting to vote requires a <strong style={{ color: 'var(--gold)' }}>50,000 HNY bond</strong> (non-refundable if rejected).
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  flex: 1, padding: '12px 0', background: 'var(--glass2)',
                  border: '1px solid var(--border2)', borderRadius: 12,
                  color: 'var(--sub)', cursor: 'pointer', fontSize: 14,
                }}
              >
                ← Back
              </button>
              <button
                onClick={() => title && description ? setStep(3) : null}
                disabled={!title || !description}
                style={{
                  flex: 2, padding: '12px 0',
                  background: title && description ? 'var(--gold)' : 'rgba(245,180,41,0.3)',
                  color: '#040507', border: 'none', borderRadius: 12,
                  fontWeight: 700, fontSize: 14, cursor: title && description ? 'pointer' : 'default',
                }}
              >
                Review →
              </button>
            </div>
          </>
        )}

        {/* Step 3 — QR */}
        {step === 3 && (
          <>
            <p style={{ color: 'var(--sub)', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
              Scan this QR code in your <strong style={{ color: 'var(--green)' }}>HIVE Wallet</strong> app to sign and submit your draft proposal.
            </p>
            <div style={{ background: '#fff', padding: 16, borderRadius: 16, display: 'inline-block', marginBottom: 16 }}>
              <QRCodeSVG value={JSON.stringify(qrPayload)} size={220} />
            </div>
            <div style={{
              background: 'var(--glass)', border: '1px solid var(--border2)',
              borderRadius: 10, padding: '10px 14px', marginBottom: 16, textAlign: 'left',
            }}>
              <p style={{ color: 'var(--sub)', fontSize: 11, marginBottom: 4 }}>Proposal type:</p>
              <p style={{ color: TYPE_META[type].color, fontWeight: 700, fontSize: 13 }}>{TYPE_META[type].icon} {TYPE_META[type].label}</p>
              <p style={{ color: 'var(--sub)', fontSize: 11, marginTop: 8, marginBottom: 4 }}>Title:</p>
              <p style={{ color: 'var(--text)', fontSize: 13 }}>{title}</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setStep(2)}
                style={{
                  flex: 1, padding: '12px 0', background: 'var(--glass2)',
                  border: '1px solid var(--border2)', borderRadius: 12,
                  color: 'var(--sub)', cursor: 'pointer', fontSize: 14,
                }}
              >
                ← Edit
              </button>
              <button
                onClick={onClose}
                style={{
                  flex: 2, padding: '12px 0', background: 'var(--green)',
                  color: '#040507', border: 'none', borderRadius: 12,
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Proposal Card ──────────────────────────────────────────────────────────
function ProposalCard({ p }: { p: DaoProposal }) {
  const tm = TYPE_META[p.type];
  const statusColor = STATUS_COLOR[p.status] || 'var(--sub)';
  const totalCast   = p.yesVp + p.noVp + p.abstainVp;
  const quorumColor = p.quorumPct >= 0.20 ? 'var(--green)' : 'var(--danger)';

  return (
    <Link href={`/dao/${p.id}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--glass)', border: '1px solid var(--border2)',
        borderRadius: 16, padding: '18px 20px', cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}
      >
        {/* Top row: type + status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{
            background: `${tm.color}1a`, color: tm.color,
            border: `1px solid ${tm.color}40`,
            borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600,
          }}>
            {tm.icon} {tm.label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {p.status === 'active' && (
              <span style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: 'var(--green)',
                boxShadow: '0 0 6px var(--green)',
                animation: 'pulse 2s infinite',
              }} />
            )}
            <span style={{ color: statusColor, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {p.status}
            </span>
          </div>
        </div>

        {/* Title */}
        <p style={{
          color: 'var(--text)', fontWeight: 700, fontSize: 15, lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          marginBottom: 12,
        }}>
          {p.title}
        </p>

        {/* Vote bar */}
        <VoteBar yes={p.yesVp} no={p.noVp} abstain={p.abstainVp} />

        {/* Stats row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span style={{ color: quorumColor, fontSize: 11 }}>
            Quorum: {(p.quorumPct * 100).toFixed(1)}% / 20%
          </span>
          {p.status === 'active' && p.votingEndsAtMs && (
            <span style={{ color: 'var(--sub)', fontSize: 11 }}>
              ⏱ {timeRemaining(p.votingEndsAtMs)}
            </span>
          )}
          {p.status !== 'active' && (
            <span style={{ color: 'var(--sub)', fontSize: 11 }}>
              {totalCast > 0 ? `${(p.passPct * 100).toFixed(1)}% YES` : 'No votes'}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
const TABS = ['All', 'Active', 'Passed', 'Rejected', 'My Votes'];
const TAB_STATUS: Record<string, string> = {
  'All': 'all', 'Active': 'active', 'Passed': 'timelocked',
  'Rejected': 'rejected', 'My Votes': 'my-votes',
};

export default function DaoPage() {
  const { address: wallet } = useHiveWallet();
  const [tab, setTab]           = useState('All');
  const [proposals, setProposals] = useState<DaoProposal[]>([]);
  const [myVotes, setMyVotes]   = useState<DaoVote[]>([]);
  const [stats, setStats]       = useState<DaoStats | null>(null);
  const [treasury, setTreasury] = useState<DaoTreasury | null>(null);
  const [vp, setVp]             = useState<DaoVotingPower | null>(null);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (activeTab: string) => {
    try {
      if (activeTab === 'My Votes' && wallet) {
        const [mvRes, sRes, tRes] = await Promise.all([
          getDaoMyVotes(wallet),
          getDaoStats(),
          getDaoTreasury(),
        ]);
        setMyVotes(mvRes.votes);
        // Fetch proposals that the wallet voted on
        const votedIds = mvRes.votes.map(v => v.proposalId);
        if (votedIds.length > 0) {
          const all = await getDaoProposals();
          setProposals(all.proposals.filter(p => votedIds.includes(p.id)));
        } else {
          setProposals([]);
        }
        setStats(sRes);
        setTreasury(tRes);
      } else {
        const status = TAB_STATUS[activeTab] || 'all';
        const [pRes, sRes, tRes] = await Promise.all([
          getDaoProposals(status),
          getDaoStats(),
          getDaoTreasury(),
        ]);
        setProposals(pRes.proposals);
        setStats(sRes);
        setTreasury(tRes);
      }
    } catch (e) {
      console.error('[dao] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    setLoading(true);
    load(tab);
  }, [tab, load]);

  useEffect(() => {
    if (!wallet) return;
    getDaoVotingPower(wallet).then(setVp).catch(() => {});
  }, [wallet]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => load(tab), 30_000);
    return () => clearInterval(id);
  }, [tab, load]);

  const displayedProposals = proposals;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 20px 60px' }}>
      {/* Pulse animation */}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      {/* Page title */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ color: 'var(--text)', fontSize: 28, fontWeight: 800, marginBottom: 6 }}>
          🏛️ DAO Governance
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: 14 }}>
          Stake-weighted community governance — voting power = √(staked HNY), max 5% per entity.
        </p>
      </div>

      {/* Stats bar */}
      {stats && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
          background: 'var(--border2)', borderRadius: 14, overflow: 'hidden', marginBottom: 24,
        }}>
          {[
            { label: 'Total Proposals', value: stats.totalProposals.toString() },
            { label: 'Active',          value: stats.activeProposals.toString(), color: 'var(--green)' },
            { label: 'Passed',          value: (stats.passedProposals + stats.executedProposals).toString(), color: 'var(--gold)' },
            { label: 'Treasury',        value: `${fmtHny(stats.treasuryBalanceHny)} HNY`, color: '#9b72ff' },
          ].map(s => (
            <div key={s.label} style={{
              background: 'var(--bg2)', padding: '14px 18px', textAlign: 'center',
            }}>
              <p style={{ color: s.color || 'var(--text)', fontSize: 20, fontWeight: 800, fontFamily: 'monospace' }}>{s.value}</p>
              <p style={{ color: 'var(--sub)', fontSize: 11, marginTop: 2 }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs + VP chip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(t => {
            const disabled = t === 'My Votes' && !wallet;
            return (
              <button
                key={t}
                disabled={disabled}
                onClick={() => !disabled && setTab(t)}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: 'none', cursor: disabled ? 'default' : 'pointer',
                  fontSize: 12, fontWeight: 600,
                  background: tab === t ? 'var(--gold)' : disabled ? 'rgba(255,255,255,0.03)' : 'var(--glass2)',
                  color:      tab === t ? '#040507' : disabled ? 'rgba(232,240,228,0.25)' : 'var(--sub)',
                  transition: 'all 0.15s',
                }}
              >
                {t}
              </button>
            );
          })}
        </div>

        {vp && vp.votingPower > 0 && (
          <div style={{
            background: 'rgba(245,180,41,0.1)', border: '1px solid rgba(245,180,41,0.3)',
            borderRadius: 20, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 700 }}>
              ⚡ VP: {vp.votingPower.toFixed(2)}
            </span>
            <span style={{ color: 'var(--sub)', fontSize: 11 }}>
              ({fmtHny(vp.stakedHny)} staked)
            </span>
          </div>
        )}
      </div>

      {/* Proposals grid */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--sub)', padding: 60, fontSize: 14 }}>
          Loading proposals…
        </div>
      ) : displayedProposals.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          color: 'var(--sub)', fontSize: 14,
        }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>🏛️</p>
          <p style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No proposals yet</p>
          <p style={{ fontSize: 13 }}>Be the first to shape Honey Network governance.</p>
          {wallet && (
            <button
              onClick={() => setShowCreate(true)}
              style={{
                marginTop: 16, padding: '10px 24px',
                background: 'var(--gold)', color: '#040507',
                border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              + Create First Proposal
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {displayedProposals.map(p => <ProposalCard key={p.id} p={p} />)}
        </div>
      )}

      {/* Treasury mini-panel */}
      {treasury && treasury.recentTxs.length > 0 && (
        <div style={{
          marginTop: 40, background: 'var(--glass)', border: '1px solid var(--border2)',
          borderRadius: 16, padding: '20px 24px',
        }}>
          <p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
            🏦 Treasury Activity
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--sub)' }}>
                  <th style={{ textAlign: 'left', padding: '0 8px 8px', fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '0 8px 8px', fontWeight: 600 }}>Wallet</th>
                  <th style={{ textAlign: 'right', padding: '0 8px 8px', fontWeight: 600 }}>Amount</th>
                  <th style={{ textAlign: 'right', padding: '0 8px 8px', fontWeight: 600 }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {treasury.recentTxs.slice(0, 5).map(tx => (
                  <tr key={tx.id} style={{ borderTop: '1px solid var(--border2)' }}>
                    <td style={{ padding: '8px', color: tx.type === 'withdrawal' ? 'var(--danger)' : 'var(--green)', fontWeight: 600 }}>
                      {tx.type === 'withdrawal' ? '↑' : '↓'} {tx.type.replace('_', ' ')}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--sub)', fontFamily: 'monospace', fontSize: 11 }}>
                      {tx.wallet.slice(0, 16)}…
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', color: tx.type === 'withdrawal' ? 'var(--danger)' : 'var(--green)', fontFamily: 'monospace' }}>
                      {tx.type === 'withdrawal' ? '-' : '+'}{fmtHny(tx.amount)} HNY
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--sub)', fontSize: 11 }}>
                      {(tx.description || '').slice(0, 30)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* How it works */}
      <div style={{ marginTop: 48 }}>
        <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17, marginBottom: 20, textAlign: 'center' }}>
          How DAO Governance Works
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {[
            { n: '01', title: 'Draft a Proposal', desc: 'Need ≥ 10,000 HNY staked. Create your draft for free — visible but not yet executable.' },
            { n: '02', title: 'Submit + Bond',     desc: 'Pay 50,000 HNY bond to open voting. Bond goes to treasury. Non-refundable if rejected.' },
            { n: '03', title: 'Community Votes',   desc: 'Voting window: 7 days. Power = √(staked HNY), capped at 5% per entity.' },
            { n: '04', title: 'Quorum & Threshold',desc: 'Need 20% quorum + 66.7% YES (of YES+NO) to pass.' },
            { n: '05', title: 'Timelock',          desc: 'Passed proposals enter 48h–7d timelock before automatic execution.' },
          ].map(step => (
            <div key={step.n} style={{
              background: 'var(--glass)', border: '1px solid var(--border2)',
              borderRadius: 14, padding: '16px 18px',
            }}>
              <p style={{ color: 'var(--gold)', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{step.n}</p>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{step.title}</p>
              <p style={{ color: 'var(--sub)', fontSize: 12, lineHeight: 1.5 }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Floating create button */}
      {wallet && (
        <button
          onClick={() => setShowCreate(true)}
          style={{
            position: 'fixed', bottom: 32, right: 32,
            background: 'var(--gold)', color: '#040507',
            border: 'none', borderRadius: 50, padding: '14px 20px',
            fontWeight: 800, fontSize: 14, cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(245,180,41,0.4)',
            zIndex: 100,
          }}
        >
          + New Proposal
        </button>
      )}

      {showCreate && wallet && (
        <CreateProposalModal wallet={wallet} onClose={() => setShowCreate(false)} />
      )}
    </main>
  );
}
