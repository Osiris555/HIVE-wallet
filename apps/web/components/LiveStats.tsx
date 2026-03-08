'use client';

import { useEffect, useState, useRef } from 'react';
import { getWebStats } from '@/lib/api';
import type { WebStats } from '@/lib/types';

function useCountUp(target: number, duration = 1800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else setValue(target);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

function StatItem({ label, value, prefix = '', suffix = '', decimals = 0 }: {
  label: string; value: number; prefix?: string; suffix?: string; decimals?: number;
}) {
  const animated = useCountUp(Math.floor(value));
  const display = decimals > 0
    ? `${prefix}${(animated / Math.pow(10, decimals)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
    : `${prefix}${animated.toLocaleString()}${suffix}`;

  return (
    <div className="flex flex-col items-center gap-1 px-4 md:px-6">
      <span
        className="font-bold text-xl md:text-2xl font-mono-hive"
        style={{ color: 'var(--green)' }}
      >
        {display}
      </span>
      <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--sub)' }}>
        {label}
      </span>
    </div>
  );
}

export default function LiveStats() {
  const [stats, setStats] = useState<WebStats | null>(null);

  useEffect(() => {
    getWebStats()
      .then(setStats)
      .catch(() => {});
    const interval = setInterval(() => {
      getWebStats().then(setStats).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) {
    return (
      <div className="w-full py-6 flex justify-center" style={{ borderTop: '1px solid var(--border2)', borderBottom: '1px solid var(--border2)' }}>
        <span className="text-sm" style={{ color: 'var(--sub)' }}>Loading live stats…</span>
      </div>
    );
  }

  return (
    <div
      className="w-full py-5 relative z-10"
      style={{
        borderTop: '1px solid var(--border2)',
        borderBottom: '1px solid var(--border2)',
        background: 'var(--glass)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="max-w-5xl mx-auto flex flex-wrap justify-center gap-y-4 divide-x divide-[var(--border2)]">
        <StatItem label="Wallets" value={stats.totalWallets} />
        <StatItem label="Transactions" value={stats.totalTransactions} />
        <StatItem label="NFTs Minted" value={stats.totalNfts} />
        <StatItem label="Listed NFTs" value={stats.listedNfts} />
        <StatItem label="HNY Price" value={Math.round(stats.hnyPriceUsd * 100)} prefix="$" decimals={2} />
        <StatItem label="Block Height" value={stats.blockHeight} prefix="#" />
      </div>
    </div>
  );
}
