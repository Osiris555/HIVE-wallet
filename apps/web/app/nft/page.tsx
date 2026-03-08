'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import NFTCard from '@/components/NFTCard';
import NFTFilters from '@/components/NFTFilters';
import ActionModal from '@/components/ActionModal';
import { getMarketplace, getWalletNfts } from '@/lib/api';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import type { NftSummary, MarketplaceFilters } from '@/lib/types';

type Tab = 'marketplace' | 'mine';

export default function NFTMarketplacePage() {
  const { address } = useHiveWallet();
  const [tab, setTab] = useState<Tab>('marketplace');
  const [nfts, setNfts] = useState<NftSummary[]>([]);
  const [myNfts, setMyNfts] = useState<NftSummary[]>([]);
  const [filters, setFilters] = useState<MarketplaceFilters>({ sort: 'newest' });
  const [loading, setLoading] = useState(true);
  const [serverOffline, setServerOffline] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ action: 'buy' | 'bid' | 'offer'; nft: NftSummary } | null>(null);

  const loadMarketplace = useCallback(async (f: MarketplaceFilters) => {
    setLoading(true);
    setServerOffline(false);
    try {
      const data = await getMarketplace(f);
      setNfts(data.nfts ?? []);
    } catch {
      setServerOffline(true);
      setNfts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMyNfts = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setServerOffline(false);
    try {
      const data = await getWalletNfts(address);
      setMyNfts(data.nfts ?? []);
    } catch {
      setServerOffline(true);
      setMyNfts([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    loadMarketplace(filters);
  }, [filters, loadMarketplace]);

  useEffect(() => {
    if (tab === 'mine') loadMyNfts();
  }, [tab, loadMyNfts]);

  const displayNfts = tab === 'mine' ? myNfts : nfts;

  return (
    <div className="min-h-screen" style={{ paddingTop: 68 }}>
      {/* Page header */}
      <div
        className="px-6 pt-12 pb-8 text-center"
        style={{ background: 'linear-gradient(180deg, rgba(57,255,20,0.04) 0%, transparent 100%)' }}
      >
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl font-bold mb-2"
          style={{ color: 'var(--text)' }}
        >
          🖼 NFT Marketplace
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-base"
          style={{ color: 'var(--sub)' }}
        >
          Browse, collect, and trade NFTs on the Honey Network
        </motion.p>
      </div>

      {/* Connect HIVE wallet banner */}
      {!address && (
        <div
          className="mx-auto max-w-2xl mb-0 mx-6 rounded-xl p-4 flex items-center gap-3"
          style={{ background: 'rgba(57,255,20,0.08)', border: '1px solid var(--border)', margin: '0 24px 0' }}
        >
          <span className="text-2xl">🐝</span>
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--green)' }}>Connect your HIVE Wallet</p>
            <p className="text-xs" style={{ color: 'var(--sub)' }}>
              Click &ldquo;Connect HIVE&rdquo; in the nav bar to view your personal NFT collection.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        className="sticky z-40 flex items-center gap-0 px-6 pt-4"
        style={{ top: 68, background: 'rgba(4,5,7,0.92)', backdropFilter: 'blur(12px)' }}
      >
        {(['marketplace', ...(address ? ['mine'] : [])] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-5 py-2.5 text-sm font-semibold capitalize transition-colors border-b-2"
            style={{
              color: tab === t ? 'var(--green)' : 'var(--sub)',
              borderBottomColor: tab === t ? 'var(--green)' : 'transparent',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            {t === 'marketplace' ? '🛒 Marketplace' : '🎒 My NFTs'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <Link href="/nft/mint"
          style={{ background: '#39ff14', color: '#000', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none', marginBottom: 4 }}>
          🎨 Mint NFT
        </Link>
      </div>

      {/* Filters (marketplace only) */}
      {tab === 'marketplace' && (
        <NFTFilters filters={filters} onChange={(f) => setFilters(f)} />
      )}

      {/* Server offline banner */}
      {serverOffline && !loading && (
        <div className="mx-6 mt-4 rounded-xl p-4 flex items-center gap-3"
          style={{ background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.4)' }}>
          <span className="text-xl">⚠️</span>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--danger)' }}>HIVE server is offline</p>
            <p className="text-xs" style={{ color: 'var(--sub)' }}>
              Make sure <code className="font-mono-hive">node server.js</code> is running in{' '}
              <code className="font-mono-hive">apps/mobile/honey-dev/</code>
            </p>
          </div>
          <button className="ml-auto btn-outline text-xs px-3 py-1.5"
            onClick={() => loadMarketplace(filters)}>
            Retry
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex justify-center items-center py-24">
            <div className="flex flex-col items-center gap-3">
              <div
                className="w-10 h-10 rounded-full border-2 animate-spin"
                style={{ borderColor: 'var(--green)', borderTopColor: 'transparent' }}
              />
              <p className="text-sm" style={{ color: 'var(--sub)' }}>Loading NFTs…</p>
            </div>
          </div>
        ) : displayNfts.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">🖼</div>
            <p className="font-semibold text-lg mb-2" style={{ color: 'var(--text)' }}>
              {tab === 'mine' ? 'No NFTs in your wallet yet' : 'No NFTs listed'}
            </p>
            <p className="text-sm" style={{ color: 'var(--sub)' }}>
              {tab === 'mine'
                ? 'Mint your first NFT using the HIVE Wallet mobile app.'
                : 'Check back soon or adjust your filters.'}
            </p>
            {tab === 'mine' && (
              <a
                href="https://honey.network"
                target="_blank"
                rel="noreferrer"
                className="btn-green mt-6 inline-flex"
              >
                Get HIVE Wallet
              </a>
            )}
          </div>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.04 } }, hidden: {} }}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          >
            {displayNfts.map((nft) => (
              <motion.div
                key={nft.id}
                variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
              >
                <NFTCard
                  nft={nft}
                  onAction={(action, n) => setActionTarget({ action, nft: n })}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Mint CTA at bottom */}
      <div
        className="py-12 text-center"
        style={{ borderTop: '1px solid var(--border2)', background: 'var(--bg2)' }}
      >
        <h3 className="font-bold text-xl mb-2" style={{ color: 'var(--text)' }}>
          Ready to mint your own NFT?
        </h3>
        <p className="text-sm mb-6" style={{ color: 'var(--sub)' }}>
          Audio albums, video series, photo collections, and documents — mint any media type on HIVE.
        </p>
        <a
          href="https://honey.network"
          target="_blank"
          rel="noreferrer"
          className="btn-gold inline-flex"
        >
          🐝 Open HIVE Wallet to Mint
        </a>
      </div>

      {/* Action Modal */}
      {actionTarget && (
        <ActionModal
          action={actionTarget.action}
          nft={actionTarget.nft}
          onClose={() => setActionTarget(null)}
        />
      )}
    </div>
  );
}
