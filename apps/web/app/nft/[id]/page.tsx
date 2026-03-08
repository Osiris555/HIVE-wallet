'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import NFTMediaPlayer from '@/components/NFTMediaPlayer';
import ActionModal from '@/components/ActionModal';
import { getNft, getNftOffers, getAuction } from '@/lib/api';
import type { NftSummary, NftOffer, NftAuction } from '@/lib/types';

const MEDIA_ICONS: Record<string, string> = {
  audio: '🎵', video: '🎬', document: '📄', photo: '🖼',
};

function AuctionTimer({ endsAt }: { endsAt: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const calc = () => {
      const diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(diff === 0 ? 'Ended' : `${h}h ${m}m ${s}s`);
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return (
    <span className="font-bold font-mono-hive" style={{ color: 'var(--gold)' }}>
      {remaining}
    </span>
  );
}

function truncateAddr(addr: string) {
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

export default function NFTDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [nft, setNft] = useState<NftSummary | null>(null);
  const [files, setFiles] = useState<{ file_index: number; file_name: string; mime_type: string; file_size: number }[]>([]);
  const [offers, setOffers] = useState<NftOffer[]>([]);
  const [auction, setAuction] = useState<NftAuction | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionTarget, setActionTarget] = useState<'buy' | 'bid' | 'offer' | null>(null);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        const data = await getNft(id);
        setNft(data.nft);
        setFiles(data.files ?? []);

        const offerData = await getNftOffers(id).catch(() => ({ offers: [] }));
        setOffers(offerData.offers ?? []);

        // Load auction if applicable
        if (data.nft.auction_id) {
          const auctionData = await getAuction(data.nft.auction_id).catch(() => null);
          if (auctionData) setAuction(auctionData.auction);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ paddingTop: 68 }}>
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-full border-2 animate-spin"
            style={{ borderColor: 'var(--green)', borderTopColor: 'transparent' }}
          />
          <p style={{ color: 'var(--sub)' }}>Loading NFT…</p>
        </div>
      </div>
    );
  }

  if (notFound || !nft) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ paddingTop: 68 }}>
        <div className="text-5xl mb-4">🤷</div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>NFT Not Found</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--sub)' }}>
          This NFT doesn&apos;t exist or has been transferred off the marketplace.
        </p>
        <Link href="/nft" className="btn-green">← Back to Marketplace</Link>
      </div>
    );
  }

  const icon = MEDIA_ICONS[nft.media_type] ?? '🖼';
  const pendingOffers = offers.filter((o) => o.status === 'pending');

  return (
    <div className="min-h-screen" style={{ paddingTop: 68 }}>
      {/* Breadcrumb */}
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-2">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--sub)' }}>
          <Link href="/" style={{ color: 'var(--sub)', textDecoration: 'none' }}>Home</Link>
          <span>/</span>
          <Link href="/nft" style={{ color: 'var(--sub)', textDecoration: 'none' }}>NFTs</Link>
          <span>/</span>
          <span style={{ color: 'var(--text)' }}>{nft.name}</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-2 gap-10">

        {/* ── Left: Media player ── */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <NFTMediaPlayer nft={nft} files={files} />
        </motion.div>

        {/* ── Right: Metadata + Actions ── */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex flex-col gap-5"
        >
          {/* Title + type badge */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`badge badge-${nft.media_type}`}>
                {icon} {nft.media_type}
              </span>
              {nft.collection_name && (
                <span
                  className="badge"
                  style={{ background: 'var(--glass2)', color: 'var(--text)', border: '1px solid var(--border2)' }}
                >
                  📁 {nft.collection_name}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text)' }}>{nft.name}</h1>
            {nft.ai_description && (
              <p className="text-sm italic leading-relaxed" style={{ color: 'var(--sub)' }}>
                &ldquo;{nft.ai_description}&rdquo;
              </p>
            )}
          </div>

          {/* Price / Auction card */}
          <div
            className="glass-card p-5"
            style={{ border: nft.listed_price_hny != null ? '1px solid var(--border)' : '1px solid var(--border2)' }}
          >
            {auction && !auction.settled ? (
              <>
                <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--sub)' }}>Live Auction — Ends in</p>
                <AuctionTimer endsAt={auction.ends_at} />
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-2xl font-bold font-mono-hive" style={{ color: 'var(--gold)' }}>
                    {auction.current_bid_hny?.toLocaleString() ?? auction.start_price_hny.toLocaleString()} HNY
                  </span>
                  <span className="text-sm" style={{ color: 'var(--sub)' }}>
                    {auction.current_bidder ? 'current bid' : 'starting bid'}
                  </span>
                </div>
                <button
                  className="btn-gold w-full justify-center mt-4"
                  onClick={() => setActionTarget('bid')}
                >
                  ⏱ Place Bid
                </button>
              </>
            ) : nft.listed_price_hny != null ? (
              <>
                <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--sub)' }}>Buy Now Price</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold font-mono-hive" style={{ color: 'var(--green)' }}>
                    {nft.listed_price_hny.toLocaleString()} HNY
                  </span>
                </div>
                <button
                  className="btn-green w-full justify-center mt-4"
                  onClick={() => setActionTarget('buy')}
                >
                  🛒 Buy Now
                </button>
              </>
            ) : (
              <>
                <p className="text-sm" style={{ color: 'var(--sub)' }}>Not currently listed for sale</p>
              </>
            )}

            {/* Make offer always available */}
            <button
              className="btn-outline w-full justify-center mt-2"
              onClick={() => setActionTarget('offer')}
            >
              💬 Make Offer
            </button>
          </div>

          {/* NFT Details */}
          <div className="glass-card p-5">
            <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text)' }}>Details</h3>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Creator</span>
                <span className="font-mono-hive text-xs" style={{ color: 'var(--text)' }}>
                  {truncateAddr(nft.creator_wallet)}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Owner</span>
                <span className="font-mono-hive text-xs" style={{ color: 'var(--text)' }}>
                  {truncateAddr(nft.owner_wallet)}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Royalty</span>
                <span style={{ color: 'var(--text)' }}>{(nft.royalty_bps / 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Files</span>
                <span style={{ color: 'var(--text)' }}>
                  {nft.file_count} {nft.media_type === 'audio' ? 'track' : 'page'}{nft.file_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Transfers</span>
                <span style={{ color: 'var(--text)' }}>{nft.transfer_count}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>Minted</span>
                <span style={{ color: 'var(--text)' }}>
                  {new Date(nft.minted_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--sub)' }}>NFT ID</span>
                <span className="font-mono-hive text-xs truncate" style={{ color: 'var(--sub)', maxWidth: 140 }}>
                  {nft.id}
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          {nft.description && (
            <div className="glass-card p-5">
              <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--text)' }}>Description</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--sub)' }}>{nft.description}</p>
            </div>
          )}

          {/* Active Offers */}
          {pendingOffers.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text)' }}>
                Active Offers ({pendingOffers.length})
              </h3>
              <div className="flex flex-col gap-2">
                {pendingOffers.slice(0, 5).map((offer) => (
                  <div
                    key={offer.id}
                    className="flex items-center justify-between text-sm"
                    style={{ padding: '8px 0', borderBottom: '1px solid var(--border2)' }}
                  >
                    <span className="font-mono-hive text-xs" style={{ color: 'var(--sub)' }}>
                      {truncateAddr(offer.buyer_wallet)}
                    </span>
                    <span className="font-bold" style={{ color: 'var(--green)' }}>
                      {offer.offer_hny.toLocaleString()} HNY
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Back link */}
          <Link href="/nft" className="btn-outline justify-center text-sm">
            ← Back to Marketplace
          </Link>
        </motion.div>
      </div>

      {/* Action Modal */}
      {actionTarget && (
        <ActionModal
          action={actionTarget}
          nft={nft}
          onClose={() => setActionTarget(null)}
        />
      )}
    </div>
  );
}
