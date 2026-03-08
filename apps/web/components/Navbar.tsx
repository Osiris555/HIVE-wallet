'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import HiveWalletConnect, { useHiveWallet } from './HiveWalletConnect';
import MetaMaskButton from './MetaMaskButton';
import { getNotificationCount, getNotifications, getSocialProfile } from '@/lib/api';
import type { Notification, UserProfile } from '@/lib/types';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/nft', label: 'NFTs' },
  { href: '/nft/mint', label: '🎨 Mint' },
  { href: '/trade', label: 'Trade' },
  { href: '/futures', label: 'Futures' },
  { href: '/launchpad', label: 'Launchpad' },
  { href: '/bots',      label: '🤖 Bots' },
  { href: '/bridge',    label: '🌉 Bridge' },
  { href: '/dao',       label: '🏛️ DAO' },
  { href: '/copy',      label: '📋 Copy' },
  { href: '/analytics', label: '📊 Analytics' },
  { href: '/vaults',    label: '🏦 Vaults' },
  { href: '/wallet',    label: '💰 Wallet' },
];

function shortAddr(w: string) { return w.length > 12 ? `${w.slice(0, 7)}…${w.slice(-4)}` : w; }

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000)    return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

const TYPE_ICONS: Record<string, string> = {
  bot_status: '🤖', liquidation_warning: '⚠️', dao_result: '🏛️',
  copy_trade: '📋', bridge_complete: '🌉', nft_bid: '🖼',
  vault_compound: '🏦', social_follow: '👥', social_mention: '💬',
};

// ── HoneyBook Profile Badge ───────────────────────────────────────────────────

function ProfileBadge() {
  const { address: wallet } = useHiveWallet();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [open, setOpen]       = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wallet) { setProfile(null); return; }
    getSocialProfile(wallet).then(d => setProfile(d.profile)).catch(() => {});
  }, [wallet]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!wallet) return null;

  const hasPhoto = !!(profile?.avatarPhoto);
  const avatarEmoji = profile?.avatarEmoji || '🐝';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="HoneyBook Profile"
        style={{
          background: open ? 'rgba(57,255,20,0.12)' : 'rgba(57,255,20,0.06)',
          border: '1px solid rgba(57,255,20,0.3)',
          borderRadius: '50%', width: 34, height: 34,
          cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {hasPhoto ? (
          <img src={profile!.avatarPhoto!} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 16 }}>{avatarEmoji}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14,
          width: 240, zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}>
          {/* Mini banner */}
          <div style={{
            height: 52, background: profile?.bannerData
              ? `url(${profile.bannerData}) center/cover no-repeat`
              : 'linear-gradient(135deg, #0a1a0a 0%, #1a2a0a 100%)',
          }} />

          {/* Avatar + name */}
          <div style={{ padding: '0 14px 14px', marginTop: -18 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              border: '2px solid #0d1117',
              background: '#111', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 8,
            }}>
              {hasPhoto
                ? <img src={profile!.avatarPhoto!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 20 }}>{avatarEmoji}</span>
              }
            </div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>
              {profile?.displayName || 'Anonymous'}
            </div>
            <div style={{ color: '#555', fontSize: 11, marginBottom: 8 }}>{shortAddr(wallet)}</div>

            {profile && (
              <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 12 }}>
                <span style={{ color: '#aaa' }}><strong style={{ color: '#fff' }}>{profile.followerCount}</strong> followers</span>
                <span style={{ color: '#aaa' }}><strong style={{ color: '#fff' }}>{profile.postCount}</strong> posts</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Link href="/wallet" onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#39ff14', color: '#000', borderRadius: 8, padding: '7px 12px', textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
                💰 My Wallet
              </Link>
              <Link href="/social" onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111', color: '#aaa', border: '1px solid #333', borderRadius: 8, padding: '7px 12px', textDecoration: 'none', fontSize: 13 }}>
                🐝 HoneyBook Feed
              </Link>
              <Link href="/social?edit=1" onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111', color: '#aaa', border: '1px solid #333', borderRadius: 8, padding: '7px 12px', textDecoration: 'none', fontSize: 13 }}>
                ✏️ Edit Profile
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notification Bell ─────────────────────────────────────────────────────────

function NotificationBell() {
  const { address: wallet } = useHiveWallet();
  const [count, setCount]           = useState(0);
  const [open, setOpen]             = useState(false);
  const [notifications, setNotifs]  = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch count every 30s
  useEffect(() => {
    if (!wallet) return;
    const fetch = async () => {
      try {
        const { count: c } = await getNotificationCount(wallet);
        setCount(c);
      } catch { /* ignore */ }
    };
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [wallet]);

  // Fetch notifications when bell opened
  useEffect(() => {
    if (!open || !wallet) return;
    getNotifications(wallet, 10).then(d => setNotifs(d.notifications)).catch(() => {});
  }, [open, wallet]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!wallet) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', padding: '4px 8px', fontSize: 20 }}
        title="Notifications"
      >
        🔔
        {count > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#ff4444', color: '#fff',
            borderRadius: '50%', fontSize: 10, fontWeight: 700,
            minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 12,
          width: 320, maxHeight: 400, overflowY: 'auto', zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1e2a1e' }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Notifications</span>
            {count > 0 && (
              <button
                onClick={async () => {
                  try { await fetch(`/api/notifications/read-all/${wallet}`, { method: 'POST' }); setCount(0); setNotifs(prev => prev.map(n => ({ ...n, read: true }))); } catch { /* */ }
                }}
                style={{ background: 'none', border: 'none', color: '#39ff14', fontSize: 12, cursor: 'pointer' }}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>No notifications</div>
          ) : (
            notifications.map(n => (
              <div key={n.id} style={{
                padding: '12px 16px', borderBottom: '1px solid #0a0a0a',
                background: n.read ? 'transparent' : 'rgba(57,255,20,0.03)',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 16 }}>{TYPE_ICONS[n.type] || '🔔'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                    <div style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{n.body}</div>
                    <div style={{ color: '#555', fontSize: 11, marginTop: 4 }}>{timeAgo(n.createdAtMs)}</div>
                  </div>
                  {!n.read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#39ff14', marginTop: 4, flexShrink: 0 }} />}
                </div>
              </div>
            ))
          )}

          <div style={{ padding: '10px 16px', borderTop: '1px solid #1e2a1e', textAlign: 'center' }}>
            <Link href="/analytics" onClick={() => setOpen(false)} style={{ color: '#39ff14', fontSize: 12, textDecoration: 'none' }}>
              View Portfolio →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-6 md:px-10"
      style={{
        height: 68,
        background: 'rgba(4,5,7,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        className="flex items-center gap-2 font-bold text-xl mr-8 flex-shrink-0"
        style={{ color: 'var(--gold)', textDecoration: 'none' }}
      >
        <span style={{ fontSize: '1.5rem' }}>🍯</span>
        <span>honey.trade</span>
      </Link>

      {/* Nav links — scrollable on smaller screens */}
      <div className="hidden md:flex items-center gap-5 flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium transition-colors flex-shrink-0"
            style={{
              color: pathname === link.href ? 'var(--green)' : 'var(--sub)',
              textDecoration: 'none',
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>

      {/* Right-side actions */}
      <div className="flex items-center gap-2 ml-auto">
        <NotificationBell />
        <ProfileBadge />
        <HiveWalletConnect />
        <MetaMaskButton />
      </div>
    </nav>
  );
}
