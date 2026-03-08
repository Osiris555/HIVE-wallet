'use client';

import { useState, useEffect, useCallback } from 'react';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import { useSign } from '@/hooks/useSign';
import type { SignResult } from '@/hooks/useSign';
import { getVaultList, getVaultPositions, getHnyLocks, getLockTiers, getStakingPositions } from '@/lib/api';
import type { VaultInfo, VaultPosition, HnyLock, LockTier, SimpleStakingPosition } from '@/lib/types';

const VAULTS_API = process.env.NEXT_PUBLIC_HIVE_API || 'http://localhost:3000';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 2) { return Number(n).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function timeUntil(ms: number) {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Ready to unlock';
  const days  = Math.floor(diff / 86400_000);
  const hours = Math.floor((diff % 86400_000) / 3600_000);
  return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h remaining`;
}

function progressPct(lockedAtMs: number, unlockAtMs: number) {
  const total = unlockAtMs - lockedAtMs;
  const elapsed = Date.now() - lockedAtMs;
  return Math.min(100, Math.max(0, total > 0 ? (elapsed / total) * 100 : 100));
}

// ── Extension helper ──────────────────────────────────────────────────────────

type HiveWin = { hive?: { requestTransaction?: (d: unknown) => Promise<{ txId: string; success: boolean }> } };

function getHiveExt() {
  if (typeof window === 'undefined') return null;
  const h = (window as unknown as HiveWin).hive;
  return h?.requestTransaction ? h : null;
}

// ── Extension Confirmation Modal ──────────────────────────────────────────────

function ExtConfirmModal({
  title, color = '#39ff14', rows, txType, txDesc, txParams,
  onClose, onSuccess, authSign, authWallet,
}: {
  title: string; color?: string;
  rows: { label: string; value: string }[];
  txType: string; txDesc: string; txParams?: Record<string, unknown>;
  onClose: () => void; onSuccess: () => void;
  authSign?: (msg: string, opts?: { title?: string; description?: string }) => Promise<SignResult>;
  authWallet?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const ext = getHiveExt();
  const isAuth = !!(authSign && authWallet);

  async function handleConfirm() {
    setStatus('pending');
    try {
      if (isAuth) {
        // Platform auth — sign server-side, then POST to vault endpoint
        const ts = Date.now();
        let msg = '', url = '', body: Record<string, unknown> = {};
        const p = txParams ?? {};
        if (txType === 'vault_deposit') {
          msg = `vault_deposit|${authWallet}|${p.vaultId}|${p.amountHny}|${ts}`;
          url = '/vaults/deposit'; body = { wallet: authWallet, vaultId: p.vaultId, hnyAmount: p.amountHny, timestamp: ts };
        } else if (txType === 'vault_withdraw') {
          msg = `vault_withdraw|${authWallet}|${p.vaultId}|${p.sharesAmount}|${ts}`;
          url = '/vaults/withdraw'; body = { wallet: authWallet, vaultId: p.vaultId, shares: p.sharesAmount, timestamp: ts };
        } else if (txType === 'vault_lock') {
          msg = `vault_lock|${authWallet}|${p.amountHny}|${p.lockDays}|${ts}`;
          url = '/vaults/lock'; body = { wallet: authWallet, amountHny: p.amountHny, lockDays: p.lockDays, timestamp: ts };
        } else if (txType === 'vault_unlock') {
          msg = `vault_unlock|${authWallet}|${p.lockId}|${ts}`;
          url = '/vaults/unlock'; body = { wallet: authWallet, lockId: p.lockId, timestamp: ts };
        } else {
          msg = `${txType}|${authWallet}|${ts}`;
          url = `/${txType.replace('_', '/')}`; body = { wallet: authWallet, timestamp: ts, ...p };
        }
        const sig = await authSign!(msg, { title, description: txDesc });
        const resp = await fetch(`${VAULTS_API}${url}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, signatureHex: sig.signatureHex, mldsaPubKeyHex: sig.mldsaPubKeyHex }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      } else {
        if (!ext) return;
        await ext.requestTransaction!({ txType, description: txDesc, ...txParams });
      }
      setStatus('success');
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (e: unknown) {
      setStatus('error');
      setErrMsg((e as Error)?.message ?? 'Transaction rejected');
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
      <div style={{ background: '#0d1117', border: `1px solid ${color}`, borderRadius: 16, padding: 32, maxWidth: 440, width: '90%', position: 'relative', marginBottom: 24 }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        <h3 style={{ color, marginBottom: 20, fontSize: 17 }}>{title}</h3>

        {/* Details card */}
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: '#666' }}>{r.label}</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* Fee info */}
        <div style={{ fontSize: 11, color: '#555', marginBottom: 16 }}>
          Base gas + service fee → network treasury · Wallet fee → HIVE Labs
        </div>

        {/* Status */}
        {status === 'error' && <p style={{ color: '#ff4444', fontSize: 13, marginBottom: 12 }}>{errMsg}</p>}
        {status === 'success' && <p style={{ color: color, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>✓ Transaction confirmed!</p>}
        {status === 'pending' && <p style={{ color: color, fontSize: 13, marginBottom: 12 }}>⬡ Chrysalis signing…</p>}

        {!ext ? (
          <p style={{ color: '#ff4444', fontSize: 13 }}>HIVE Wallet extension not detected. Install it to sign transactions.</p>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ flex: 1, background: 'none', border: '1px solid #333', borderRadius: 8, padding: '11px 0', color: '#aaa', cursor: 'pointer', fontSize: 14 }}>
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={status === 'pending' || status === 'success'}
              style={{ flex: 2, background: color, border: 'none', borderRadius: 8, padding: '11px 0',
                       color: '#000', fontWeight: 700, cursor: status === 'idle' || status === 'error' ? 'pointer' : 'not-allowed',
                       opacity: status === 'pending' || status === 'success' ? 0.6 : 1, fontSize: 14 }}>
              {status === 'pending' ? '⬡ Signing…' : status === 'success' ? '✓ Done' : '⬡ Confirm'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Vault Action Modal (Deposit / Withdraw) ────────────────────────────────────

function VaultActionModal({ vault, wallet, action, onClose, onSuccess, authSign, authWallet }: {
  vault: VaultInfo; wallet: string; action: 'deposit' | 'withdraw'; onClose: () => void; onSuccess: () => void;
  authSign?: (msg: string, opts?: { title?: string; description?: string }) => Promise<SignResult>;
  authWallet?: string;
}) {
  const [amount, setAmount] = useState('');
  const [selectedPool, setSelectedPool] = useState('HNY-USDC');
  const isLp = vault.id === 'HNY_LP_VAULT';

  const LP_PAIRS = ['HNY-USDC', 'HNY-ETH', 'HNY-BTC', 'HNY-SOL'];

  if (!amount || Number(amount) <= 0) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
        <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 16, padding: 32, maxWidth: 440, width: '90%', position: 'relative', marginBottom: 24 }}>
          <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
          <h3 style={{ color: '#39ff14', marginBottom: 20 }}>{action === 'deposit' ? 'Deposit into' : 'Withdraw from'} {vault.name}</h3>

          <div style={{ background: '#111', border: '1px solid #333', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: '#666' }}>APR</span>
              <span style={{ color: '#39ff14', fontWeight: 700 }}>{vault.baseApr}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: '#666' }}>TVL</span>
              <span style={{ color: '#fff' }}>{fmt(vault.totalHny)} HNY</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>You receive</span>
              <span style={{ color: '#f5b429', fontWeight: 700 }}>{vault.receiptToken ?? 'vHNY'} tokens</span>
            </div>
          </div>

          {isLp && action === 'deposit' && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#aaa', fontSize: 13, marginBottom: 8 }}>Select LP Pool</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {LP_PAIRS.map(p => (
                  <button key={p} onClick={() => setSelectedPool(p)}
                    style={{ background: selectedPool === p ? '#1a2a0a' : '#111', border: `1px solid ${selectedPool === p ? '#39ff14' : '#333'}`,
                             borderRadius: 8, padding: '8px 0', color: selectedPool === p ? '#39ff14' : '#aaa', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label style={{ color: '#aaa', fontSize: 13, display: 'block' }}>
            {action === 'deposit' ? 'Amount to Deposit (HNY)' : `${vault.receiptToken ?? 'vHNY'} Shares to Redeem`}
            <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              style={{ display: 'block', width: '100%', marginTop: 6, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '10px 12px', fontSize: 15, boxSizing: 'border-box' }} />
          </label>
          {action === 'deposit' && Number(amount) > 0 && (
            <p style={{ color: '#aaa', fontSize: 12, marginTop: 8 }}>
              You receive ≈ {fmt(Number(amount) / Math.max(vault.sharePrice, 0.000001), 6)} {vault.receiptToken ?? 'vHNY'}
            </p>
          )}
          <button onClick={() => { /* validate - stays in same modal for ExtConfirm logic */ }}
            disabled={!amount || Number(amount) <= 0}
            style={{ width: '100%', background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '12px 0', fontWeight: 700,
                     cursor: Number(amount) > 0 ? 'pointer' : 'not-allowed', opacity: Number(amount) > 0 ? 1 : 0.4, marginTop: 16, fontSize: 15 }}>
            Preview →
          </button>
        </div>
      </div>
    );
  }

  const rows = [
    { label: 'Action', value: action === 'deposit' ? 'Deposit' : 'Withdraw' },
    { label: 'Vault', value: vault.name },
    ...(isLp && action === 'deposit' ? [{ label: 'LP Pool', value: selectedPool }] : []),
    { label: action === 'deposit' ? 'Amount' : 'Shares', value: `${fmt(Number(amount), 4)} ${action === 'deposit' ? 'HNY' : (vault.receiptToken ?? 'vHNY')}` },
    ...(action === 'deposit' ? [{ label: 'Receive', value: `≈ ${fmt(Number(amount) / Math.max(vault.sharePrice, 0.000001), 6)} ${vault.receiptToken ?? 'vHNY'}` }] : []),
  ];

  return (
    <ExtConfirmModal
      title={`${action === 'deposit' ? 'Deposit into' : 'Withdraw from'} ${vault.name}`}
      rows={rows}
      txType={action === 'deposit' ? 'vault_deposit' : 'vault_withdraw'}
      txDesc={`${action === 'deposit' ? 'Deposit' : 'Withdraw'} ${fmt(Number(amount), 4)} ${action === 'deposit' ? 'HNY' : (vault.receiptToken ?? 'vHNY')} ${action === 'deposit' ? 'into' : 'from'} ${vault.name}`}
      txParams={{ vaultId: vault.id, amountHny: Number(amount), sharesAmount: Number(amount), poolPair: selectedPool }}
      onClose={onClose}
      onSuccess={onSuccess}
      authSign={authSign}
      authWallet={authWallet}
    />
  );
}

// ── Lock Modal ────────────────────────────────────────────────────────────────

function LockModal({ wallet, tiers, onClose, onSuccess, authSign, authWallet }: {
  wallet: string; tiers: LockTier[]; onClose: () => void; onSuccess: () => void;
  authSign?: (msg: string, opts?: { title?: string; description?: string }) => Promise<SignResult>;
  authWallet?: string;
}) {
  const [amount, setAmount] = useState('');
  const [tierIdx, setTierIdx] = useState(0); // default 6 months
  const tier = tiers[tierIdx] || tiers[0];
  const unlockDate = tier ? new Date(Date.now() + tier.days * 86400_000).toLocaleDateString() : '';

  if (!amount || Number(amount) <= 0 || !tier) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
        <div style={{ background: '#0d1117', border: '1px solid #f5b429', borderRadius: 16, padding: 32, maxWidth: 440, width: '90%', position: 'relative', marginBottom: 24 }}>
          <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
          <h3 style={{ color: '#f5b429', marginBottom: 8 }}>🔒 Lock HNY for Boosted Yield</h3>
          <p style={{ color: '#666', fontSize: 12, marginBottom: 20 }}>Minimum 6-month lock. Longer locks earn higher yield multipliers.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ color: '#aaa', fontSize: 13 }}>
              Amount to Lock (HNY)
              <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: 6, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '10px 12px', fontSize: 15, boxSizing: 'border-box' }} />
            </label>

            <div>
              <div style={{ color: '#aaa', fontSize: 13, marginBottom: 8 }}>Lock Period</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tiers.map((t, i) => (
                  <button key={t.days} onClick={() => setTierIdx(i)}
                    style={{ background: tierIdx === i ? '#1a1400' : '#111',
                             border: `1px solid ${tierIdx === i ? '#f5b429' : '#333'}`,
                             borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
                    <span style={{ color: '#fff', fontWeight: 600 }}>{t.label}</span>
                    <span style={{ color: '#39ff14', fontWeight: 700 }}>{t.effectiveApr?.toFixed(1)}% APR ({t.multiplier}×)</span>
                  </button>
                ))}
              </div>
            </div>

            {tier && (
              <p style={{ color: '#f5b429', fontSize: 12 }}>
                Unlock date: {unlockDate} · Early unlock forfeits 50% of rewards.
              </p>
            )}

            <button onClick={() => {/* validated above */}} disabled={!amount || Number(amount) <= 0}
              style={{ background: '#f5b429', color: '#000', border: 'none', borderRadius: 8, padding: '12px 0',
                       fontWeight: 700, cursor: Number(amount) > 0 ? 'pointer' : 'not-allowed',
                       opacity: Number(amount) > 0 ? 1 : 0.4, fontSize: 15 }}>
              Preview →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rows = [
    { label: 'Action', value: 'Lock HNY' },
    { label: 'Amount', value: `${fmt(Number(amount), 4)} HNY` },
    { label: 'Period', value: tier.label },
    { label: 'Multiplier', value: `${tier.multiplier}×` },
    { label: 'Effective APR', value: `${tier.effectiveApr?.toFixed(1)}%` },
    { label: 'Unlock Date', value: unlockDate },
  ];

  return (
    <ExtConfirmModal
      title="🔒 Lock HNY for Boosted Yield"
      color="#f5b429"
      rows={rows}
      txType="vault_lock"
      txDesc={`Lock ${fmt(Number(amount), 4)} HNY for ${tier.label} at ${tier.effectiveApr?.toFixed(1)}% APR`}
      txParams={{ amountHny: Number(amount), lockDays: tier.days, multiplier: tier.multiplier }}
      onClose={onClose}
      onSuccess={onSuccess}
      authSign={authSign}
      authWallet={authWallet}
    />
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VaultsPage() {
  const { address: wallet, isAuthUser } = useHiveWallet();
  const { sign, sigModal } = useSign();

  const [vaults, setVaults]           = useState<VaultInfo[]>([]);
  const [positions, setPositions]     = useState<VaultPosition[]>([]);
  const [locks, setLocks]             = useState<HnyLock[]>([]);
  const [tiers, setTiers]             = useState<LockTier[]>([]);
  const [stakePositions, setStakePos] = useState<SimpleStakingPosition[]>([]);
  const [stakeApr, setStakeApr]       = useState(5);
  const [loading, setLoading]         = useState(true);

  type VaultActionState = { vault: VaultInfo; action: 'deposit' | 'withdraw' } | null;
  const [vaultAction, setVaultAction] = useState<VaultActionState>(null);
  const [lockOpen, setLockOpen]       = useState(false);

  // Extension-based action state for locks/staking
  type ExtAction = { title: string; color?: string; rows: { label: string; value: string }[]; txType: string; txDesc: string; txParams?: Record<string, unknown> } | null;
  const [extAction, setExtAction] = useState<ExtAction>(null);

  const refresh = useCallback(async () => {
    try {
      const [v, t] = await Promise.all([getVaultList(), getLockTiers()]);
      setVaults(v.vaults);
      setTiers(t.tiers);
      if (wallet) {
        const [pos, lks, sp] = await Promise.all([getVaultPositions(wallet), getHnyLocks(wallet), getStakingPositions(wallet)]);
        setPositions(pos.positions);
        setLocks(lks.locks);
        setStakePos(sp.positions);
        setStakeApr(Math.round((sp.apr ?? 0.05) * 100));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => { refresh(); }, [refresh]);

  const posMap = Object.fromEntries(positions.map(p => [p.vaultId, p]));

  return (
    <div style={{ minHeight: '100vh', background: '#040507', color: '#e0e0e0', fontFamily: 'Space Grotesk, sans-serif', padding: '92px 16px 24px' }}>
      {/* Chrysalis signing modal for platform auth users */}
      {sigModal}
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#f5b429', letterSpacing: -1, margin: 0 }}>🏦 Yield Vaults</h1>
          <p style={{ color: '#666', marginTop: 6 }}>Auto-compound your HNY. Lock 6 months–3 years for boosted yield up to 5×.</p>
        </div>

        {loading ? (
          <div style={{ color: '#666', textAlign: 'center', padding: 60 }}>Loading vaults…</div>
        ) : (
          <>
            {/* Vault Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
              {vaults.map(vault => {
                const pos = posMap[vault.id];
                const isLp = vault.id === 'HNY_LP_VAULT';
                return (
                  <div key={vault.id} style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 24 }}>{isLp ? '💧' : '🏦'}</span>
                      <div>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{vault.name}</div>
                        <div style={{ color: '#555', fontSize: 12 }}>{vault.description}</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                      <div style={{ background: '#111', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                        <div style={{ color: '#39ff14', fontWeight: 800, fontSize: 18 }}>{vault.baseApr}%</div>
                        <div style={{ color: '#666', fontSize: 10 }}>Base APR</div>
                      </div>
                      <div style={{ background: '#111', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{fmt(vault.totalHny)}</div>
                        <div style={{ color: '#666', fontSize: 10 }}>TVL (HNY)</div>
                      </div>
                      <div style={{ background: '#111', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                        <div style={{ color: '#f5b429', fontWeight: 700, fontSize: 13, fontFamily: 'Space Mono, monospace' }}>
                          {vault.receiptToken ?? 'vHNY'}
                        </div>
                        <div style={{ color: '#666', fontSize: 10 }}>Receipt Token</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 12 }}>
                      <span style={{ color: '#555' }}>Share Price</span>
                      <span style={{ color: '#aaa', fontFamily: 'Space Mono, monospace' }}>{fmt(vault.sharePrice, 6)} HNY</span>
                    </div>

                    {pos && (
                      <div style={{ background: '#1a2a0a', border: '1px solid #2a4a1a', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: '#aaa' }}>My {vault.receiptToken ?? 'vHNY'}</span>
                          <span style={{ color: '#f5b429', fontFamily: 'Space Mono, monospace', fontWeight: 700 }}>{fmt(pos.shares, 6)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: '#aaa' }}>Value</span>
                          <span style={{ color: '#39ff14', fontWeight: 700 }}>{fmt(pos.valueHny)} HNY</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#555' }}>Gain</span>
                          <span style={{ color: pos.gainHny >= 0 ? '#39ff14' : '#ff4444' }}>
                            {pos.gainHny >= 0 ? '+' : ''}{fmt(pos.gainHny)} HNY
                          </span>
                        </div>
                      </div>
                    )}

                    {wallet && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setVaultAction({ vault, action: 'deposit' })}
                          style={{ flex: 1, background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                          Deposit
                        </button>
                        {pos && pos.shares > 0 && (
                          <button onClick={() => setVaultAction({ vault, action: 'withdraw' })}
                            style={{ flex: 1, background: '#111', border: '1px solid #39ff14', color: '#39ff14', borderRadius: 8, padding: '10px 0', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                            Withdraw
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* HNY Time-Lock Panel */}
            <div style={{ background: '#0d1117', border: '1px solid #f5b429', borderRadius: 14, padding: 24, marginBottom: 24 }}>
              <h2 style={{ color: '#f5b429', fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>🔒 HNY Time-Lock</h2>
              <p style={{ color: '#aaa', fontSize: 13, marginBottom: 16 }}>
                Lock HNY for 6 months to 3 years to earn boosted yield. Minimum 6-month commitment required.
              </p>
              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #333', color: '#666' }}>
                      <th style={{ textAlign: 'left', padding: '6px 10px' }}>Period</th>
                      <th style={{ textAlign: 'right', padding: '6px 10px' }}>Multiplier</th>
                      <th style={{ textAlign: 'right', padding: '6px 10px' }}>Effective APR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map(t => (
                      <tr key={t.days} style={{ borderBottom: '1px solid #111' }}>
                        <td style={{ padding: '8px 10px', color: '#fff', fontWeight: 600 }}>{t.label}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#f5b429', fontWeight: 700 }}>{t.multiplier}×</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#39ff14', fontWeight: 700 }}>{t.effectiveApr?.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>Early unlock forfeits 50% of accrued rewards. Locked HNY compounds every hour.</p>
              {wallet && (
                <button onClick={() => setLockOpen(true)}
                  style={{ background: '#f5b429', color: '#000', border: 'none', borderRadius: 8, padding: '12px 24px', fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
                  🔒 Lock HNY
                </button>
              )}
            </div>

            {/* Simple Staking */}
            <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 24, marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <div>
                  <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: 0 }}>⚡ Simple Staking</h2>
                  <p style={{ color: '#666', fontSize: 13, margin: '4px 0 0' }}>Flexible HNY staking at {stakeApr}% APR. No lock-up — claim and unstake any time.</p>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ background: '#111', borderRadius: 8, padding: '8px 16px', textAlign: 'center' }}>
                    <div style={{ color: '#39ff14', fontWeight: 800, fontSize: 18 }}>{stakeApr}%</div>
                    <div style={{ color: '#666', fontSize: 11 }}>APR</div>
                  </div>
                  {wallet && (
                    <button onClick={() => setExtAction({
                      title: 'Stake HNY',
                      rows: [{ label: 'Action', value: 'Stake HNY' }, { label: 'APR', value: `${stakeApr}%` }, { label: 'Lock', value: 'None (flexible)' }],
                      txType: 'stake',
                      txDesc: 'Stake HNY at ' + stakeApr + '% APR (flexible)',
                    })}
                      style={{ background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>
                      Stake HNY →
                    </button>
                  )}
                </div>
              </div>

              {!wallet ? (
                <p style={{ color: '#555', fontSize: 13 }}>Connect your HIVE Wallet to view staking positions.</p>
              ) : stakePositions.length === 0 ? (
                <div style={{ background: '#111', borderRadius: 8, padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>
                  No staking positions yet — click Stake HNY to get started.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {stakePositions.map(sp => (
                    <div key={sp.id} style={{ background: '#111', border: '1px solid #1e2a1e', borderRadius: 10, padding: 16 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <div style={{ color: '#fff', fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>{fmt(sp.principal)} HNY</div>
                          <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>
                            <span style={{ background: sp.status === 'staked' ? '#1a3a1a' : '#2a1a00', color: sp.status === 'staked' ? '#39ff14' : '#f5b429', borderRadius: 4, padding: '2px 6px', fontSize: 10 }}>{sp.status}</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 90 }}>
                          <div style={{ color: '#39ff14', fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>{fmt(sp.rewardAccrued, 4)}</div>
                          <div style={{ color: '#555', fontSize: 11 }}>Accrued</div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 90 }}>
                          <div style={{ color: '#f5b429', fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>{fmt(sp.claimable, 4)}</div>
                          <div style={{ color: '#555', fontSize: 11 }}>Claimable</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {sp.claimable > 0 && (
                            <button onClick={() => setExtAction({
                              title: 'Claim Staking Rewards',
                              rows: [{ label: 'Claimable', value: `${fmt(sp.claimable, 4)} HNY` }, { label: 'Position', value: sp.id.slice(0, 12) + '…' }],
                              txType: 'stake_claim',
                              txDesc: `Claim ${fmt(sp.claimable, 4)} HNY staking rewards`,
                              txParams: { positionId: sp.id },
                            })}
                              style={{ background: '#1a3a0a', border: '1px solid #39ff14', color: '#39ff14', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                              Claim
                            </button>
                          )}
                          {sp.canUnlock && (
                            <button onClick={() => setExtAction({
                              title: 'Unlock Staking Position',
                              rows: [{ label: 'Principal', value: `${fmt(sp.principal)} HNY` }, { label: 'Rewards', value: `${fmt(sp.rewardAccrued, 4)} HNY` }],
                              txType: 'stake_unlock',
                              txDesc: `Unlock ${fmt(sp.principal)} HNY staking position`,
                              txParams: { positionId: sp.id },
                            })}
                              style={{ background: '#111', border: '1px solid #f5b429', color: '#f5b429', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                              Unlock
                            </button>
                          )}
                          {sp.canWithdraw && (
                            <button onClick={() => setExtAction({
                              title: 'Withdraw Staked HNY',
                              rows: [{ label: 'Amount', value: `${fmt(sp.principal)} HNY` }],
                              txType: 'stake_withdraw',
                              txDesc: `Withdraw ${fmt(sp.principal)} HNY from staking`,
                              txParams: { positionId: sp.id },
                            })}
                              style={{ background: '#39ff14', border: 'none', color: '#000', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* My Locks */}
            {wallet && locks.length > 0 && (
              <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, padding: 24 }}>
                <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>My Locked HNY</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {locks.map(lock => {
                    const pct = progressPct(lock.lockedAtMs, lock.unlockAtMs);
                    const isReady = Date.now() >= lock.unlockAtMs;
                    return (
                      <div key={lock.id} style={{ background: '#111', border: '1px solid #1e2a1e', borderRadius: 10, padding: 16 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                          <div style={{ flex: 1, minWidth: 140 }}>
                            <div style={{ color: '#fff', fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>{fmt(lock.amountHny)} HNY</div>
                            <div style={{ color: '#666', fontSize: 12 }}>{lock.lockDays}-day lock ({lock.multiplier}×)</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ color: '#39ff14', fontWeight: 700 }}>{fmt(lock.rewardAccruedHny, 4)} HNY</div>
                            <div style={{ color: '#555', fontSize: 11 }}>Accrued</div>
                          </div>
                          <div>
                            {lock.status === 'locked' ? (
                              <button onClick={() => setExtAction({
                                title: isReady ? 'Unlock HNY' : 'Early Unlock (Penalty)',
                                color: isReady ? '#39ff14' : '#f5b429',
                                rows: [
                                  { label: 'Amount', value: `${fmt(lock.amountHny)} HNY` },
                                  { label: 'Rewards', value: `${fmt(lock.rewardAccruedHny, 4)} HNY` },
                                  ...(!isReady ? [{ label: 'Penalty', value: `−${fmt(lock.rewardAccruedHny * 0.5, 4)} HNY (50%)` }] : []),
                                ],
                                txType: 'vault_unlock',
                                txDesc: `${isReady ? 'Unlock' : 'Early unlock'} ${fmt(lock.amountHny)} HNY time-lock`,
                                txParams: { lockId: lock.id },
                              })}
                                style={{ background: isReady ? '#39ff14' : '#1a0a00', border: `1px solid ${isReady ? '#39ff14' : '#f5b429'}`,
                                         color: isReady ? '#000' : '#f5b429', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                                {isReady ? 'Unlock' : 'Early Unlock'}
                              </button>
                            ) : (
                              <span style={{ background: '#1a3a1a', color: '#39ff14', borderRadius: 4, padding: '4px 10px', fontSize: 12 }}>
                                Unlocked
                              </span>
                            )}
                          </div>
                        </div>
                        {lock.status === 'locked' && lock.lockDays > 0 && (
                          <>
                            <div style={{ background: '#222', borderRadius: 4, height: 6, marginBottom: 6 }}>
                              <div style={{ background: isReady ? '#39ff14' : '#f5b429', width: `${pct}%`, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
                            </div>
                            <div style={{ color: '#555', fontSize: 11 }}>{timeUntil(lock.unlockAtMs)}</div>
                            {!isReady && (
                              <div style={{ color: '#f5b429', fontSize: 11, marginTop: 4 }}>
                                ⚠️ Early unlock penalty: forfeit {fmt(lock.rewardAccruedHny * 0.5, 4)} HNY (50% of rewards)
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {vaultAction && wallet && (
        <VaultActionModal vault={vaultAction.vault} wallet={wallet} action={vaultAction.action}
          onClose={() => setVaultAction(null)} onSuccess={refresh}
          authSign={isAuthUser ? sign : undefined} authWallet={isAuthUser ? wallet : undefined} />
      )}
      {lockOpen && wallet && tiers.length > 0 && (
        <LockModal wallet={wallet} tiers={tiers} onClose={() => setLockOpen(false)} onSuccess={refresh}
          authSign={isAuthUser ? sign : undefined} authWallet={isAuthUser ? wallet : undefined} />
      )}
      {extAction && (
        <ExtConfirmModal
          title={extAction.title}
          color={extAction.color}
          rows={extAction.rows}
          txType={extAction.txType}
          txDesc={extAction.txDesc}
          txParams={extAction.txParams}
          onClose={() => setExtAction(null)}
          onSuccess={refresh}
          authSign={isAuthUser ? sign : undefined}
          authWallet={isAuthUser && wallet ? wallet : undefined}
        />
      )}
    </div>
  );
}
