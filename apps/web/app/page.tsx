'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import MatrixCanvas from '@/components/MatrixCanvas';
import LiveStats from '@/components/LiveStats';
import NFTCard from '@/components/NFTCard';
import ActionModal from '@/components/ActionModal';
import { getMarketplace } from '@/lib/api';
import type { NftSummary } from '@/lib/types';

const FEATURES = [
  { icon: '🍯', title: 'Native AMM', desc: 'Swap 9 tokens via constant-product liquidity pools with real-time Pyth oracle pricing.' },
  { icon: '🐝', title: 'ML-DSA-65 Security', desc: 'Post-quantum signatures on every transaction — NIST FIPS 204 standard, future-proof by design.' },
  { icon: '🖼', title: 'NFT Marketplace', desc: 'Mint audio, video, document, and photo NFTs directly on-chain. Trade, auction, and collect.' },
  { icon: '🔐', title: 'Chrysalis Vault', desc: 'ML-KEM-768 encrypted backup with CAS-φ sharding. Your keys, distributed and reconstructable.' },
  { icon: '📈', title: 'Live Pyth Prices', desc: 'Real-time oracle price feeds for HNY and wrapped tokens — no stale prices, ever.' },
  { icon: '⚡', title: 'Sub-second Finality', desc: 'Honey Network confirms transactions in under one second with deterministic block production.' },
  { icon: '🔌', title: 'Browser Extension', desc: 'HIVE Wallet Chrome extension injects window.hive into every page. One-click ML-DSA-65 signing for web dApps.' },
];

const ROADMAP = [
  { phase: 'Phase 7', label: 'NFT Foundation', desc: 'Mint, trade, auction, and collect NFTs. Queen Bee AI security guardian.', done: true },
  { phase: 'Phase H1', label: 'Web Platform', desc: 'honey.trade landing page, NFT marketplace browser, MetaMask support.', done: true },
  { phase: 'Phase H2', label: 'AMM Trading', desc: 'Live price charts, AMM swap calculator, pool stats, recent trade history. Order book + HIVE extension coming in H2b.', done: true },
  { phase: 'Phase H3', label: 'Perpetuals', desc: 'Leveraged perpetual futures with auto-liquidation, funding rates, and live PnL tracking.', done: true },
  { phase: 'Phase H4', label: 'Launchpad', desc: 'Fair-launch bonding curve token launchpad. No pre-sales. Creator fees. Graduates to AMM at 100 HNY raised.', done: true },
  { phase: 'Phase H5', label: 'Extension + Order Book + AI Bots', desc: 'HIVE Wallet Chrome extension (MV3, window.hive). Limit order book with maker/taker matching. DCA, Grid, Momentum, Stop/TP, and Futures Grid bots.', done: true, current: true },
  { phase: 'Phase H6', label: 'Cross-chain Bridge + DAO', desc: 'Bridge HNY ↔ EVM chains. On-chain governance for protocol parameters. Copy-trading and advanced bot strategies.', done: false },
];

const TOKEN_INFO = [
  {
    symbol: 'HNY', name: 'Honey', color: 'var(--gold)',
    desc: 'Native utility token. Used for gas, staking, and NFT purchases.',
    apr: '5% staking APR',
  },
  {
    symbol: 'stHNY', name: 'Staked Honey', color: 'var(--green)',
    desc: 'Liquid staking receipt for HNY. Earns staking rewards.',
    apr: 'Accrues 5% APR',
  },
  {
    symbol: 'LPHNY', name: 'LP Honey', color: 'var(--blue)',
    desc: 'Liquidity provider token representing AMM pool shares.',
    apr: '8% LP reward APR',
  },
];

export default function LandingPage() {
  const [previewNfts, setPreviewNfts] = useState<NftSummary[]>([]);
  const [actionTarget, setActionTarget] = useState<{ action: 'buy' | 'bid' | 'offer'; nft: NftSummary } | null>(null);

  useEffect(() => {
    getMarketplace({ sort: 'newest' })
      .then((data) => setPreviewNfts((data.nfts ?? []).slice(0, 6)))
      .catch(() => {});
  }, []);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <>
      <MatrixCanvas opacity={0.055} />

      {/* ── HERO ── */}
      <section
        className="relative flex flex-col items-center justify-center text-center px-6 pt-40 pb-28"
        style={{ minHeight: '100vh', zIndex: 1 }}
      >
        {/* Hex grid background decoration */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 0, overflow: 'hidden' }}
        >
          {Array.from({ length: 14 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute text-6xl opacity-10 select-none"
              style={{
                left: `${(i % 7) * 15 + 5}%`,
                top: `${Math.floor(i / 7) * 50 + 15}%`,
                color: i % 2 === 0 ? 'var(--green)' : 'var(--gold)',
              }}
              animate={{ y: [0, -12, 0], rotate: [0, 5, 0] }}
              transition={{ duration: 4 + i * 0.3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }}
            >
              ⬡
            </motion.div>
          ))}
        </div>

        <div className="relative z-10 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
            className="text-7xl md:text-8xl mb-6"
          >
            🍯
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="font-bold mb-4"
            style={{ fontSize: 'clamp(2.5rem, 8vw, 5rem)', lineHeight: 1.1 }}
          >
            <span style={{ color: 'var(--gold)' }}>honey</span>
            <span style={{ color: 'var(--text)' }}>.trade</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="text-lg md:text-xl mb-3"
            style={{ color: 'var(--sub)' }}
          >
            The <strong style={{ color: 'var(--text)' }}>Honey Network</strong> Decentralized Exchange
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="text-base mb-10"
            style={{ color: 'var(--sub)' }}
          >
            Swap tokens · Stake HNY · Mint NFTs · Trade on-chain — secured by post-quantum cryptography
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="flex flex-wrap gap-4 justify-center"
          >
            <a
              href="https://honey.network"
              target="_blank"
              rel="noreferrer"
              className="btn-gold text-base px-7 py-3"
            >
              🐝 Launch HIVE Wallet
            </a>
            <Link href="/nft" className="btn-outline text-base px-7 py-3">
              🖼 NFTs →
            </Link>
            <Link href="/trade" className="btn-outline text-base px-7 py-3">
              📈 Trade →
            </Link>
          </motion.div>

          {/* Testnet badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm"
            style={{ background: 'var(--glass2)', border: '1px solid var(--border2)', color: 'var(--sub)' }}
          >
            <span className="w-2 h-2 rounded-full bg-[var(--green)] inline-block animate-pulse" />
            Honey Network Testnet — Live
          </motion.div>
        </div>
      </section>

      {/* ── LIVE STATS ── */}
      <div className="relative z-10">
        <LiveStats />
      </div>

      {/* ── FEATURES ── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-24">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-3xl font-bold text-center mb-4"
          style={{ color: 'var(--text)' }}
        >
          Built Different
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center mb-12"
          style={{ color: 'var(--sub)' }}
        >
          Post-quantum DeFi from the ground up
        </motion.p>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.title}
              variants={itemVariants}
              className="glass-card p-6"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-bold text-base mb-2" style={{ color: 'var(--text)' }}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--sub)' }}>{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── NFT PREVIEW STRIP ── */}
      {previewNfts.length > 0 && (
        <section className="relative z-10 py-16" style={{ background: 'var(--bg2)' }}>
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Latest NFTs</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--sub)' }}>
                  Freshly listed on the Honey Network marketplace
                </p>
              </div>
              <Link href="/nft" className="btn-outline text-sm">
                View All →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {previewNfts.map((nft) => (
                <NFTCard
                  key={nft.id}
                  nft={nft}
                  onAction={(action, n) => setActionTarget({ action, nft: n })}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── TOKENOMICS ── */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 py-24">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-3xl font-bold text-center mb-4"
          style={{ color: 'var(--text)' }}
        >
          Tokenomics
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-center mb-12"
          style={{ color: 'var(--sub)' }}
        >
          Three-token ecosystem designed for DeFi
        </motion.p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TOKEN_INFO.map((t, i) => (
            <motion.div
              key={t.symbol}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="glass-card p-6 text-center"
            >
              <div
                className="text-3xl font-bold font-mono-hive mb-1"
                style={{ color: t.color }}
              >
                {t.symbol}
              </div>
              <div className="text-sm font-medium mb-3" style={{ color: 'var(--sub)' }}>{t.name}</div>
              <p className="text-sm mb-4" style={{ color: 'var(--text)' }}>{t.desc}</p>
              <div
                className="inline-block px-3 py-1 rounded-full text-xs font-bold"
                style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}
              >
                {t.apr}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── ROADMAP ── */}
      <section className="relative z-10 py-20" style={{ background: 'var(--bg2)' }}>
        <div className="max-w-3xl mx-auto px-6">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-3xl font-bold text-center mb-12"
            style={{ color: 'var(--text)' }}
          >
            Roadmap
          </motion.h2>

          <div className="relative">
            {/* Vertical line */}
            <div
              className="absolute left-5 top-0 bottom-0 w-px"
              style={{ background: 'var(--border2)' }}
            />

            <div className="flex flex-col gap-8">
              {ROADMAP.map((item, i) => (
                <motion.div
                  key={item.phase}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                  className="flex gap-5 pl-0"
                >
                  {/* Dot */}
                  <div
                    className="relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{
                      background: item.done ? (item.current ? 'var(--gold)' : 'var(--glass2)') : 'var(--glass)',
                      border: item.done ? (item.current ? '2px solid var(--gold)' : '2px solid var(--green)') : '2px solid var(--border2)',
                      color: item.done ? (item.current ? '#040507' : 'var(--green)') : 'var(--sub)',
                    }}
                  >
                    {item.done ? (item.current ? '★' : '✓') : '○'}
                  </div>

                  <div className="flex-1 pb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono-hive" style={{ color: 'var(--sub)' }}>{item.phase}</span>
                      {item.current && (
                        <span className="badge text-xs" style={{ background: 'rgba(245,180,41,0.2)', color: 'var(--gold)', border: '1px solid rgba(245,180,41,0.4)' }}>
                          Current
                        </span>
                      )}
                    </div>
                    <h3
                      className="font-bold text-base mb-1"
                      style={{ color: item.done ? 'var(--text)' : 'var(--sub)' }}
                    >
                      {item.label}
                    </h3>
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        className="relative z-10 py-10 px-6"
        style={{ borderTop: '1px solid var(--border2)' }}
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--gold)' }}>
            <span>🍯</span>
            <span>honey.trade</span>
          </div>
          <p className="text-xs text-center" style={{ color: 'var(--sub)' }}>
            Honey Network Testnet — Post-quantum DeFi secured by ML-DSA-65 &amp; ML-KEM-768
          </p>
          <div className="flex items-center gap-5 text-sm" style={{ color: 'var(--sub)' }}>
            <a href="https://honey.network" target="_blank" rel="noreferrer" style={{ color: 'var(--sub)', textDecoration: 'none' }}>
              honey.network
            </a>
            <Link href="/nft" style={{ color: 'var(--sub)', textDecoration: 'none' }}>NFTs</Link>
          </div>
        </div>
      </footer>

      {/* Action Modal */}
      {actionTarget && (
        <ActionModal
          action={actionTarget.action}
          nft={actionTarget.nft}
          onClose={() => setActionTarget(null)}
        />
      )}
    </>
  );
}
