'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { NftSummary } from '@/lib/types';

type ActionType = 'buy' | 'bid' | 'offer' | 'swap';

const ACTION_LABELS: Record<ActionType, string> = {
  buy: 'Buy',
  bid: 'Place Bid',
  offer: 'Make Offer',
  swap: 'Confirm Swap',
};

const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  buy: 'purchase',
  bid: 'place a bid on',
  offer: 'make an offer on',
  swap: 'execute',
};

type HiveWindow = { hive?: { isHive?: boolean; requestTransaction?: (d: unknown) => Promise<unknown> } };

export default function ActionModal({
  action,
  nft,
  onClose,
}: {
  action: ActionType;
  nft: NftSummary;
  onClose: () => void;
}) {
  const [extStatus, setExtStatus] = useState<'idle'|'pending'|'success'|'error'>('idle');
  const [extError, setExtError] = useState('');

  const hasExt = typeof window !== 'undefined' && !!(window as HiveWindow).hive?.requestTransaction;

  const qrData = JSON.stringify({
    action,
    nft_id: nft.id,
    nft_name: nft.name,
    price: nft.listed_price_hny,
  });

  async function handleExtConfirm() {
    const hive = (window as HiveWindow).hive;
    if (!hive?.requestTransaction) return;
    setExtStatus('pending');
    try {
      await hive.requestTransaction({
        txType: action === 'buy' ? 'buy_nft' : 'generic',
        description: `${ACTION_LABELS[action]} "${nft.name}"${nft.listed_price_hny ? ` for ${nft.listed_price_hny} HNY` : ''}`,
        nftId: nft.id,
        nftName: nft.name,
        price: nft.listed_price_hny ?? undefined,
      });
      setExtStatus('success');
      setTimeout(() => { onClose(); }, 1500);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setExtStatus('error');
      setExtError(err?.message ?? 'Transaction rejected');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="glass-card p-6 w-full max-w-sm text-center"
        style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg" style={{ color: 'var(--gold)' }}>
            🐝 {ACTION_LABELS[action]} via HIVE Wallet
          </h2>
          <button onClick={onClose} className="text-2xl opacity-50 hover:opacity-100">×</button>
        </div>

        {hasExt ? (
          /* Extension flow */
          <div className="flex flex-col gap-4">
            <div className="rounded-xl p-4 text-sm text-left flex flex-col gap-2"
              style={{ background: 'var(--glass2)', border: '1px solid var(--border2)' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Action</span>
                <span className="font-bold" style={{ color: 'var(--gold)' }}>{ACTION_LABELS[action]}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>NFT</span>
                <span style={{ color: 'var(--text)', maxWidth: '60%', textAlign: 'right', fontSize: 12 }}>{nft.name}</span>
              </div>
              {nft.listed_price_hny != null && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--sub)' }}>Price</span>
                  <span className="font-bold" style={{ color: 'var(--green)' }}>{nft.listed_price_hny.toLocaleString()} HNY</span>
                </div>
              )}
            </div>

            {extStatus === 'error' && (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>{extError}</p>
            )}
            {extStatus === 'success' && (
              <p className="text-xs font-bold" style={{ color: 'var(--green)' }}>✓ Transaction confirmed!</p>
            )}
            {extStatus === 'pending' && (
              <p className="text-xs font-mono-hive" style={{ color: 'var(--gold)' }}>⬡ Chrysalis signing…</p>
            )}

            <div className="flex gap-2">
              <button className="btn-outline flex-1 justify-center" onClick={onClose}>Cancel</button>
              <button
                className="btn-green flex-1 justify-center"
                onClick={handleExtConfirm}
                disabled={extStatus === 'pending' || extStatus === 'success'}
              >
                {extStatus === 'pending' ? '⬡ Signing…' : extStatus === 'success' ? '✓ Done' : '⬡ Confirm'}
              </button>
            </div>
          </div>
        ) : (
          /* QR code fallback */
          <>
            <div
              className="flex items-center justify-center p-4 rounded-xl mb-4 mx-auto"
              style={{ background: '#fff', width: 'fit-content' }}
            >
              <QRCodeSVG
                value={qrData}
                size={180}
                bgColor="#ffffff"
                fgColor="#040507"
                level="M"
              />
            </div>

            <p className="text-sm mb-2" style={{ color: 'var(--text)' }}>
              Scan this QR with your <strong style={{ color: 'var(--green)' }}>HIVE Wallet</strong> app to{' '}
              {ACTION_DESCRIPTIONS[action]}{' '}
              <strong>&ldquo;{nft.name}&rdquo;</strong>.
            </p>

            {nft.listed_price_hny != null && action === 'buy' && (
              <p className="text-sm font-bold mb-3" style={{ color: 'var(--green)' }}>
                {nft.listed_price_hny.toLocaleString()} HNY
              </p>
            )}

            <p className="text-xs mb-4" style={{ color: 'var(--sub)' }}>
              Install the HIVE Wallet browser extension for one-click confirmations.
            </p>

            <button className="btn-outline w-full justify-center" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
