'use client';

import type { MarketplaceFilters } from '@/lib/types';

const MEDIA_TYPES = [
  { value: '', label: 'All' },
  { value: 'audio', label: '🎵 Audio' },
  { value: 'video', label: '🎬 Video' },
  { value: 'document', label: '📄 Document' },
  { value: 'photo', label: '🖼 Photo' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
];

export default function NFTFilters({
  filters,
  onChange,
}: {
  filters: MarketplaceFilters;
  onChange: (f: MarketplaceFilters) => void;
}) {
  return (
    <div
      className="sticky top-[68px] z-40 flex flex-wrap items-center gap-3 px-4 py-3"
      style={{
        background: 'rgba(4,5,7,0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border2)',
      }}
    >
      {/* Media type chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {MEDIA_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => onChange({ ...filters, mediaType: t.value || undefined })}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-all"
            style={{
              background: (filters.mediaType ?? '') === t.value ? 'var(--green)' : 'var(--glass2)',
              color: (filters.mediaType ?? '') === t.value ? '#040507' : 'var(--text)',
              border: '1px solid ' + ((filters.mediaType ?? '') === t.value ? 'var(--green)' : 'var(--border2)'),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-5 hidden md:block" style={{ background: 'var(--border2)' }} />

      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: 'var(--sub)' }}>Sort:</span>
        {SORT_OPTIONS.map((s) => (
          <button
            key={s.value}
            onClick={() => onChange({ ...filters, sort: s.value as MarketplaceFilters['sort'] })}
            className="text-xs px-3 py-1.5 rounded-full font-medium transition-all"
            style={{
              background: (filters.sort ?? 'newest') === s.value ? 'rgba(245,180,41,0.2)' : 'var(--glass)',
              color: (filters.sort ?? 'newest') === s.value ? 'var(--gold)' : 'var(--text)',
              border: '1px solid ' + ((filters.sort ?? 'newest') === s.value ? 'rgba(245,180,41,0.5)' : 'var(--border2)'),
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Price range */}
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs" style={{ color: 'var(--sub)' }}>Price:</span>
        <input
          type="number"
          placeholder="Min"
          value={filters.minPrice ?? ''}
          onChange={(e) => onChange({ ...filters, minPrice: e.target.value ? Number(e.target.value) : undefined })}
          className="w-20 text-xs px-2 py-1.5 rounded-lg"
          style={{ background: 'var(--glass)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
        />
        <span style={{ color: 'var(--sub)' }}>—</span>
        <input
          type="number"
          placeholder="Max"
          value={filters.maxPrice ?? ''}
          onChange={(e) => onChange({ ...filters, maxPrice: e.target.value ? Number(e.target.value) : undefined })}
          className="w-20 text-xs px-2 py-1.5 rounded-lg"
          style={{ background: 'var(--glass)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
        />
      </div>
    </div>
  );
}
