'use client';

import Link from 'next/link';
import { useState } from 'react';
import { mediaUrl } from '@/lib/api';
import type { NftSummary } from '@/lib/types';

const MEDIA_ICONS: Record<string, string> = {
  audio: '🎵',
  video: '🎬',
  document: '📄',
  photo: '🖼',
};

function AuctionCountdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt).getTime();
  const now = Date.now();
  const diff = Math.max(0, end - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return (
    <span className="font-mono-hive text-xs" style={{ color: 'var(--gold)' }}>
      {h > 0 ? `${h}h ` : ''}{m}m {s}s
    </span>
  );
}

export default function NFTCard({ nft, onAction }: {
  nft: NftSummary;
  onAction?: (action: 'buy' | 'bid' | 'offer', nft: NftSummary) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const thumbUrl = mediaUrl(nft.id, 0);
  const icon = MEDIA_ICONS[nft.media_type] ?? '🖼';

  return (
    <Link
      href={`/nft/${nft.id}`}
      className="group block"
      style={{ textDecoration: 'none' }}
    >
      <div
        className="glass-card overflow-hidden transition-all duration-200 group-hover:scale-[1.02]"
        style={{ cursor: 'pointer' }}
      >
        {/* Thumbnail */}
        <div
          className="relative aspect-square w-full overflow-hidden"
          style={{ background: 'var(--bg2)' }}
        >
          {(nft.media_type === 'photo' || nft.media_type === 'document') && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrl}
              alt={nft.name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl">
              {icon}
            </div>
          )}

          {/* Type badge */}
          <span className={`absolute top-2 left-2 badge badge-${nft.media_type}`}>
            {icon} {nft.media_type}
          </span>

          {/* Auction badge */}
          {nft.auction_id && (
            <span
              className="absolute top-2 right-2 badge text-xs"
              style={{ background: 'rgba(245,180,41,0.2)', color: 'var(--gold)', border: '1px solid rgba(245,180,41,0.4)' }}
            >
              ⏱ AUCTION
            </span>
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          <h3 className="font-semibold text-sm truncate mb-1" style={{ color: 'var(--text)' }}>
            {nft.name}
          </h3>

          {nft.collection_name && (
            <p className="text-xs mb-1 truncate" style={{ color: 'var(--sub)' }}>
              📁 {nft.collection_name}
            </p>
          )}

          {/* Price row */}
          <div className="flex items-center justify-between mt-2">
            {nft.listed_price_hny != null ? (
              <span className="font-bold text-sm" style={{ color: 'var(--green)' }}>
                {nft.listed_price_hny.toLocaleString()} HNY
              </span>
            ) : nft.auction_id ? (
              <span className="text-xs" style={{ color: 'var(--gold)' }}>
                Live Auction
              </span>
            ) : (
              <span className="text-xs" style={{ color: 'var(--sub)' }}>Not listed</span>
            )}

            <span className="text-xs" style={{ color: 'var(--sub)' }}>
              {nft.file_count} {nft.media_type === 'audio' ? 'track' : 'page'}{nft.file_count !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Action buttons (show on hover) */}
          <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {nft.listed_price_hny != null && (
              <button
                className="btn-green flex-1 text-xs py-1.5 justify-center"
                onClick={(e) => { e.preventDefault(); onAction?.('buy', nft); }}
              >
                Buy Now
              </button>
            )}
            {nft.auction_id && (
              <button
                className="btn-gold flex-1 text-xs py-1.5 justify-center"
                onClick={(e) => { e.preventDefault(); onAction?.('bid', nft); }}
              >
                Place Bid
              </button>
            )}
            {!nft.auction_id && (
              <button
                className="btn-outline flex-1 text-xs py-1.5 justify-center"
                onClick={(e) => { e.preventDefault(); onAction?.('offer', nft); }}
              >
                Offer
              </button>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
