'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { getDaoProposal, getDaoMyVotes, getDaoVotingPower } from '@/lib/api';
import type { DaoProposal, DaoVote, DaoVoteChoice, DaoProposalType, DaoVotingPower } from '@/lib/types';
import { useHiveWallet } from '@/components/HiveWalletConnect';

// ── Helpers ────────────────────────────────────────────────────────────────
const TYPE_META: Record<DaoProposalType, { label: string; color: string; icon: string }> = {
  parameter_change:    { label: 'Param Change',     color: 'var(--blue)',   icon: '⚙️' },
  treasury_allocation: { label: 'Treasury',         color: 'var(--gold)',   icon: '🏦' },
  protocol_upgrade:    { label: 'Protocol Upgrade', color: '#9b72ff',       icon: '⬆️' },
  emergency:           { label: 'Emergency',        color: 'var(--danger)', icon: '🚨' },
};

const STATUS_COLOR: Record<string, string> = {
  draft:      'rgba(232,240,228,0.45)',
  active:     'var(--green)',
  timelocked: 'var(--gold)',
  executed:   'rgba(232,240,228,0.35)',
  rejected:   'var(--danger)',
  cancelled:  'rgba(232,240,228,0.3)',
};

const VOTE_COLOR: Record<DaoVoteChoice, string> = {
  yes:     'var(--green)',
  no:      'var(--danger)',
  abstain: 'rgba(232,240,228,0.4)',
};

function fmt(n: number) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(4);
}

function fmtDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeRemaining(ms?: number): string {
  if (!ms) return '';
  const diff = ms - Date.now();
  if (diff <= 0) return 'Ended';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

// ── Vote QR Modal ──────────────────────────────────────────────────────────
function VoteQRModal({
  wallet, proposalId, vote, onClose,
}: { wallet: string; proposalId: string; vote: DaoVoteChoice; onClose: () => void }) {
  const VOTE_LABEL: Record<DaoVoteChoice, string> = { yes: '✅ YES', no: '❌ NO', abstain: '🤚 ABSTAIN' };
  const payload = { action: 'governance_vote', wallet, proposalId, vote, ts: Date.now() };
  const qrStr   = JSON.stringify(payload);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(4,5,7,0.88)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '28px 32px', maxWidth: 420, width: '90%', textAlign: 'center',
        }}
      >
        <p style={{ color: VOTE_COLOR[vote], fontWeight: 800, fontSize: 22, marginBottom: 4 }}>
          {VOTE_LABEL[vote]}
        </p>
        <p style={{ color: 'var(--sub)', fontSize: 13, marginBottom: 20 }}>
          Scan with HIVE Wallet to cast your vote on-chain
        </p>
        <div style={{ display: 'inline-block', background: '#fff', padding: 14, borderRadius: 14, marginBottom: 16 }}>
          <QRCodeSVG value={qrStr} size={200} />
        </div>
        <p style={{ color: 'rgba(232,240,228,0.3)', fontSize: 10, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 18 }}>
          {qrStr.slice(0, 90)}…
        </p>
        <button
          onClick={onClose}
          style={{
            padding: '9px 30px', background: 'var(--glass2)',
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

// ── Vote Submit QR Modal (for draft submit) ────────────────────────────────
function SubmitQRModal({
  wallet, proposalId, onClose,
}: { wallet: string; proposalId: string; onClose: () => void }) {
  const payload = { action: 'governance_submit', wallet, proposalId, ts: Date.now() };
  const qrStr   = JSON.stringify(payload);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(4,5,7,0.88)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '28px 32px', maxWidth: 420, width: '90%', textAlign: 'center',
        }}
      >
        <p style={{ color: 'var(--gold)', fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
          Submit Proposal to Vote
        </p>
        <p style={{ color: 'var(--sub)', fontSize: 12, marginBottom: 8 }}>
          This will deduct <strong style={{ color: 'var(--gold)' }}>50,000 HNY</strong> bond from your wallet.
        </p>
        <p style={{ color: 'var(--sub)', fontSize: 12, marginBottom: 20 }}>
          Scan with HIVE Wallet to sign and submit.
        </p>
        <div style={{ display: 'inline-block', background: '#fff', padding: 14, borderRadius: 14, marginBottom: 16 }}>
          <QRCodeSVG value={qrStr} size={200} />
        </div>
        <br />
        <button onClick={onClose} style={{ marginTop: 12, padding: '9px 30px', background: 'var(--glass2)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--sub)', cursor: 'pointer', fontSize: 13 }}>
          Close
        </button>
      </div>
    </div>
  );
}

// ── Proposal Timeline ──────────────────────────────────────────────────────
function Timeline({ p }: { p: DaoProposal }) {
  const steps = [
    { label: 'Draft Created',  done: true,              time: p.draftAtMs },
    { label: 'Bond Paid / Active', done: !!p.submittedAtMs, time: p.submittedAtMs },
    { label: 'Voting Ends',    done: !!(p.votingEndsAtMs && Date.now() > p.votingEndsAtMs), time: p.votingEndsAtMs },
    { label: 'Timelock Ends',  done: !!(p.timelockEndsAtMs && Date.now() > p.timelockEndsAtMs), time: p.timelockEndsAtMs },
    { label: 'Executed',       done: !!p.executedAtMs,  time: p.executedAtMs },
  ];

  return (
    <div style={{ padding: '4px 0' }}>
      {steps.map((s, i) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: i < steps.length - 1 ? 0 : 0 }}>
          {/* Line + dot */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0, marginTop: 2,
              background: s.done ? 'var(--green)' : 'var(--glass2)',
              border: `2px solid ${s.done ? 'var(--green)' : 'var(--border2)'}`,
              boxShadow: s.done ? '0 0 6px rgba(57,255,20,0.4)' : 'none',
            }} />
            {i < steps.length - 1 && (
              <div style={{
                width: 2, flexGrow: 1, minHeight: 22,
                background: s.done ? 'rgba(57,255,20,0.3)' : 'var(--border2)',
              }} />
            )}
          </div>
          {/* Label */}
          <div style={{ paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
            <p style={{ color: s.done ? 'var(--text)' : 'var(--sub)', fontSize: 13, fontWeight: s.done ? 600 : 400, marginBottom: 1 }}>
              {s.label}
            </p>
            {s.time && (
              <p style={{ color: 'rgba(232,240,228,0.35)', fontSize: 11, fontFamily: 'monospace' }}>
                {fmtDate(s.time)}
                {s.label === 'Voting Ends' && !s.done && p.votingEndsAtMs && Date.now() < p.votingEndsAtMs && (
                  <span style={{ color: 'var(--green)', marginLeft: 8 }}>({timeRemaining(p.votingEndsAtMs)} left)</span>
                )}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function ProposalDetailPage() {
  const params = useParams<{ id: string }>();
  const { address: wallet } = useHiveWallet();

  const [proposal, setProposal]   = useState<DaoProposal | null>(null);
  const [votes, setVotes]         = useState<DaoVote[]>([]);
  const [myVote, setMyVote]       = useState<DaoVote | null>(null);
  const [vp, setVp]               = useState<DaoVotingPower | null>(null);
  const [loading, setLoading]     = useState(true);
  const [voteModal, setVoteModal] = useState<DaoVoteChoice | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);

  const load = useCallback(async () => {
    if (!params?.id) return;
    try {
      const res = await getDaoProposal(params.id);
      setProposal(res.proposal);
      setVotes(res.votes);
      if (wallet) {
        const mvRes = await getDaoMyVotes(wallet);
        const mv = mvRes.votes.find(v => v.proposalId === params.id) ?? null;
        setMyVote(mv);
        getDaoVotingPower(wallet).then(setVp).catch(() => {});
      }
    } catch (e) {
      console.error('[dao/detail] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [params?.id, wallet]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 15s while active
  useEffect(() => {
    if (proposal?.status !== 'active') return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [proposal?.status, load]);

  if (loading) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '100px 20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--sub)', fontSize: 14 }}>Loading proposal…</p>
      </main>
    );
  }

  if (!proposal) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '100px 20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)', fontSize: 14 }}>Proposal not found.</p>
        <Link href="/dao" style={{ color: 'var(--green)', fontSize: 13 }}>← Back to DAO</Link>
      </main>
    );
  }

  const tm          = TYPE_META[proposal.type];
  const statusColor = STATUS_COLOR[proposal.status] || 'var(--sub)';
  const totalCast   = proposal.yesVp + proposal.noVp + proposal.abstainVp;
  const totalVP     = totalCast || 1;
  const quorumColor = proposal.quorumPct >= 0.20 ? 'var(--green)' : 'var(--danger)';
  const passColor   = proposal.passPct >= 0.667 ? 'var(--green)' : 'var(--danger)';
  const isActive    = proposal.status === 'active' && (proposal.votingEndsAtMs ?? 0) > Date.now();
  const isDraft     = proposal.status === 'draft';
  const canVote     = isActive && !!wallet && !myVote && (vp?.votingPower ?? 0) > 0;
  const isProposer  = wallet && proposal.proposerWallet === wallet;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '80px 20px 60px' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      {/* Back link */}
      <Link href="/dao" style={{ color: 'var(--sub)', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
        ← Back to DAO
      </Link>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{
            background: `${tm.color}1a`, color: tm.color,
            border: `1px solid ${tm.color}40`,
            borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 600,
          }}>
            {tm.icon} {tm.label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {proposal.status === 'active' && (
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: 'var(--green)', boxShadow: '0 0 8px var(--green)',
                animation: 'pulse 2s infinite',
              }} />
            )}
            <span style={{ color: statusColor, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {proposal.status}
            </span>
          </div>
        </div>
        <h1 style={{ color: 'var(--text)', fontSize: 24, fontWeight: 800, lineHeight: 1.3, marginBottom: 8 }}>
          {proposal.title}
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: 12, fontFamily: 'monospace' }}>
          Proposed by {proposal.proposerWallet.slice(0, 20)}… · {fmtDate(proposal.draftAtMs)}
        </p>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
        background: 'var(--border2)', borderRadius: 14, overflow: 'hidden', marginBottom: 24,
      }}>
        {[
          { label: 'Bond',         value: `${fmt(proposal.bondHny)} HNY`,          color: 'var(--gold)' },
          { label: 'Votes Cast',   value: votes.length.toString(),                  color: 'var(--text)' },
          { label: 'Time Remaining', value: isActive ? timeRemaining(proposal.votingEndsAtMs) : proposal.status, color: isActive ? 'var(--green)' : statusColor },
          { label: 'Quorum',       value: `${(proposal.quorumPct * 100).toFixed(1)}%`, color: quorumColor },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg2)', padding: '12px 16px', textAlign: 'center' }}>
            <p style={{ color: s.color, fontSize: 17, fontWeight: 800, fontFamily: 'monospace' }}>{s.value}</p>
            <p style={{ color: 'var(--sub)', fontSize: 11, marginTop: 2 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
        <div>
          {/* Vote tally card */}
          <div style={{
            background: 'var(--glass)', border: '1px solid var(--border2)',
            borderRadius: 16, padding: '20px 24px', marginBottom: 20,
          }}>
            <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Vote Tally</p>

            {(['yes','no','abstain'] as DaoVoteChoice[]).map(v => {
              const raw    = v === 'yes' ? proposal.yesVp : v === 'no' ? proposal.noVp : proposal.abstainVp;
              const pct    = ((raw / totalVP) * 100).toFixed(1);
              const colors = { yes: 'var(--green)', no: 'var(--danger)', abstain: 'rgba(232,240,228,0.4)' };
              const labels = { yes: '✅ YES', no: '❌ NO', abstain: '🤚 ABSTAIN' };
              return (
                <div key={v} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: colors[v], fontSize: 12, fontWeight: 600 }}>{labels[v]}</span>
                    <span style={{ color: 'var(--sub)', fontSize: 12, fontFamily: 'monospace' }}>
                      {pct}% ({fmt(raw)} VP)
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${pct}%`,
                      background: colors[v], borderRadius: 4, transition: 'width 0.4s',
                    }} />
                  </div>
                </div>
              );
            })}

            {/* Threshold + quorum indicators */}
            <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
              <p style={{ color: passColor, fontSize: 12 }}>
                Pass: {(proposal.passPct * 100).toFixed(1)}% YES <span style={{ color: 'var(--sub)' }}>(need 66.7%)</span>
              </p>
              <p style={{ color: quorumColor, fontSize: 12 }}>
                Quorum: {(proposal.quorumPct * 100).toFixed(1)}% <span style={{ color: 'var(--sub)' }}>(need 20%)</span>
              </p>
            </div>

            {proposal.failReason && (
              <p style={{ marginTop: 12, color: 'var(--danger)', fontSize: 12, background: 'rgba(255,90,90,0.08)', borderRadius: 8, padding: '8px 12px' }}>
                ✗ {proposal.failReason}
              </p>
            )}
          </div>

          {/* Vote buttons or already-voted banner */}
          {isActive && wallet && (
            <div style={{
              background: 'var(--glass)', border: '1px solid var(--border2)',
              borderRadius: 16, padding: '18px 24px', marginBottom: 20,
            }}>
              {myVote ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: VOTE_COLOR[myVote.vote], fontWeight: 700, fontSize: 15 }}>
                    You voted: {myVote.vote.toUpperCase()} ✓
                  </p>
                  <p style={{ color: 'var(--sub)', fontSize: 12, marginTop: 4 }}>
                    Voting power used: {fmt(myVote.votingPower)} VP
                  </p>
                </div>
              ) : (vp?.votingPower ?? 0) > 0 ? (
                <>
                  <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
                    Cast Your Vote
                  </p>
                  <p style={{ color: 'var(--sub)', fontSize: 12, marginBottom: 16 }}>
                    Your voting power: <strong style={{ color: 'var(--gold)' }}>{(vp?.votingPower ?? 0).toFixed(4)} VP</strong>
                    {' '}({fmt(vp?.stakedHny ?? 0)} staked)
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {(['yes','no','abstain'] as DaoVoteChoice[]).map(v => (
                      <button
                        key={v}
                        onClick={() => setVoteModal(v)}
                        style={{
                          flex: 1, padding: '11px 0',
                          background: v === 'yes' ? 'rgba(57,255,20,0.12)' : v === 'no' ? 'rgba(255,90,90,0.12)' : 'var(--glass2)',
                          border: `1.5px solid ${v === 'yes' ? 'rgba(57,255,20,0.4)' : v === 'no' ? 'rgba(255,90,90,0.4)' : 'var(--border2)'}`,
                          borderRadius: 12, color: VOTE_COLOR[v],
                          cursor: 'pointer', fontWeight: 700, fontSize: 13,
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.8'}
                        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
                      >
                        {v === 'yes' ? '✅ YES' : v === 'no' ? '❌ NO' : '🤚 ABSTAIN'}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--sub)', fontSize: 13, textAlign: 'center' }}>
                  You need staked HNY to vote. Stake on the <Link href="/trade" style={{ color: 'var(--green)' }}>Trade page</Link>.
                </p>
              )}
            </div>
          )}

          {/* Submit draft button (for proposer) */}
          {isDraft && isProposer && (
            <div style={{
              background: 'rgba(245,180,41,0.07)', border: '1px solid rgba(245,180,41,0.25)',
              borderRadius: 16, padding: '18px 24px', marginBottom: 20,
            }}>
              <p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                Ready to open voting?
              </p>
              <p style={{ color: 'var(--sub)', fontSize: 12, marginBottom: 14 }}>
                Submitting costs a 50,000 HNY bond. Bond is credited to the DAO treasury and is non-refundable if the proposal is rejected.
              </p>
              <button
                onClick={() => setShowSubmit(true)}
                style={{
                  padding: '10px 24px', background: 'var(--gold)', color: '#040507',
                  border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}
              >
                Submit to Vote (50,000 HNY bond)
              </button>
            </div>
          )}

          {/* Description */}
          <div style={{
            background: 'var(--glass)', border: '1px solid var(--border2)',
            borderRadius: 16, padding: '20px 24px', marginBottom: 20,
          }}>
            <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Description</p>
            <p style={{ color: 'var(--sub)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {proposal.description}
            </p>
          </div>

          {/* Voters table */}
          {votes.length > 0 && (
            <div style={{
              background: 'var(--glass)', border: '1px solid var(--border2)',
              borderRadius: 16, padding: '20px 24px',
            }}>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, marginBottom: 14 }}>
                Voters ({votes.length})
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--sub)' }}>
                      <th style={{ textAlign: 'left', padding: '0 8px 10px', fontWeight: 600 }}>Wallet</th>
                      <th style={{ textAlign: 'center', padding: '0 8px 10px', fontWeight: 600 }}>Vote</th>
                      <th style={{ textAlign: 'right', padding: '0 8px 10px', fontWeight: 600 }}>VP</th>
                      <th style={{ textAlign: 'right', padding: '0 8px 10px', fontWeight: 600 }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {votes.map(v => (
                      <tr key={v.id} style={{ borderTop: '1px solid var(--border2)' }}>
                        <td style={{ padding: '8px', color: 'var(--sub)', fontFamily: 'monospace', fontSize: 11 }}>
                          {v.voterWallet.slice(0, 18)}…
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <span style={{
                            background: `${VOTE_COLOR[v.vote]}1a`,
                            color: VOTE_COLOR[v.vote],
                            borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600,
                          }}>
                            {v.vote.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text)', fontFamily: 'monospace' }}>
                          {v.votingPower.toFixed(4)}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right', color: 'var(--sub)', fontSize: 11 }}>
                          {timeAgo(v.votedAtMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: timeline + metadata */}
        <div>
          {/* Timeline */}
          <div style={{
            background: 'var(--glass)', border: '1px solid var(--border2)',
            borderRadius: 16, padding: '18px 20px', marginBottom: 16,
          }}>
            <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Timeline</p>
            <Timeline p={proposal} />
          </div>

          {/* Metadata */}
          {proposal.metadataJson && (() => {
            try {
              const meta = JSON.parse(proposal.metadataJson);
              return (
                <div style={{
                  background: 'var(--glass)', border: '1px solid var(--border2)',
                  borderRadius: 16, padding: '16px 18px',
                }}>
                  <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Proposal Details</p>
                  {meta.recipient && (
                    <>
                      <p style={{ color: 'var(--sub)', fontSize: 11, marginBottom: 3 }}>Recipient</p>
                      <p style={{ color: 'var(--text)', fontFamily: 'monospace', fontSize: 11, marginBottom: 10, wordBreak: 'break-all' }}>{meta.recipient}</p>
                    </>
                  )}
                  {meta.amount > 0 && (
                    <>
                      <p style={{ color: 'var(--sub)', fontSize: 11, marginBottom: 3 }}>Amount</p>
                      <p style={{ color: 'var(--gold)', fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }}>
                        {fmt(meta.amount)} HNY
                      </p>
                    </>
                  )}
                </div>
              );
            } catch { return null; }
          })()}
        </div>
      </div>

      {/* Modals */}
      {voteModal && wallet && (
        <VoteQRModal
          wallet={wallet}
          proposalId={proposal.id}
          vote={voteModal}
          onClose={() => setVoteModal(null)}
        />
      )}
      {showSubmit && wallet && (
        <SubmitQRModal
          wallet={wallet}
          proposalId={proposal.id}
          onClose={() => setShowSubmit(false)}
        />
      )}
    </main>
  );
}
