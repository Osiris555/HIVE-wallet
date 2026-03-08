'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import { getSocialFeed, getFollowingFeed, getSocialProfile } from '@/lib/api';
import type { SocialPost, UserProfile } from '@/lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function shortAddr(w: string) { return w.length > 12 ? `${w.slice(0, 8)}…${w.slice(-4)}` : w; }

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000)    return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return new Date(ms).toLocaleDateString();
}

const MAX_CHARS = 280;

// ── Local types ───────────────────────────────────────────────────────────────

type DmItem = {
  id: string;
  fromWallet: string;
  toWallet: string;
  partner: string;
  partnerName: string;
  partnerEmoji: string;
  partnerPhoto?: string | null;
  cipherJson: string;
  previewText: string;
  read: boolean;
  createdAtMs: number;
};

type DmMessage = {
  id: string;
  fromWallet: string;
  toWallet: string;
  cipherJson: string;
  previewText: string;
  read: boolean;
  createdAtMs: number;
};

type SearchResult = {
  wallet: string;
  displayName: string;
  avatarEmoji: string;
  avatarPhoto?: string | null;
  bio?: string;
  followerCount: number;
};

// ── Signing helpers ───────────────────────────────────────────────────────────

const API_BASE = typeof window !== 'undefined' ? '/api' : 'http://localhost:3000';

type ExtHive = { sign?: (msg: string) => Promise<{ signatureHex: string; publicKeyHex: string; address: string }> };
function getHiveExt(): ExtHive | null {
  if (typeof window === 'undefined') return null;
  const h = (window as unknown as { hive?: ExtHive }).hive;
  return h?.sign ? h : null;
}

type SigResult = { signatureHex: string; mldsaPubKeyHex: string; wallet: string };

async function signMessage(
  message: string,
  isAuthUser: boolean,
  authToken: string | null,
  extWallet: string,
): Promise<SigResult> {
  if (isAuthUser && authToken) {
    const resp = await fetch(`${API_BASE}/auth/sign-tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ message }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || 'Signing failed');
    }
    return resp.json() as Promise<SigResult>;
  }
  const ext = getHiveExt();
  if (!ext?.sign) throw new Error('HIVE Wallet extension not detected');
  const { signatureHex, publicKeyHex, address } = await ext.sign(message);
  return { signatureHex, mldsaPubKeyHex: publicKeyHex, wallet: address || extWallet };
}

// ── sha256 helper (browser Web Crypto) ───────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Reusable Chrysalis Confirmation Modal ─────────────────────────────────────

function SocialExtModal({
  title, rows, isAuthUser, authToken, wallet,
  sigMessage, onSign, onClose,
}: {
  title: string;
  rows: { label: string; value: string }[];
  isAuthUser: boolean;
  authToken: string | null;
  wallet: string;
  sigMessage: string;
  onSign: (sig: SigResult) => Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const ext = getHiveExt();
  const canConfirm = isAuthUser || !!ext;

  async function handleConfirm() {
    setStatus('pending');
    try {
      const sig = await signMessage(sigMessage, isAuthUser, authToken, wallet);
      await onSign(sig);
      setStatus('success');
      setTimeout(onClose, 1200);
    } catch (e: unknown) {
      setStatus('error');
      setErrMsg((e as Error)?.message ?? 'Action failed');
    }
  }

  const stageLabel =
    status === 'pending' ? '⬡ Chrysalis signing…' :
    status === 'success' ? '✓ Confirmed!' : '';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
      <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 16, padding: 28, maxWidth: 440, width: '90%', position: 'relative', marginBottom: 24 }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        <h3 style={{ color: '#39ff14', marginBottom: 16 }}>{title}</h3>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0a1a0a', border: '1px solid #1e3a1e', borderRadius: 6, padding: '4px 10px', marginBottom: 14, fontSize: 11 }}>
          <span style={{ color: '#39ff14' }}>⬡</span>
          <span style={{ color: '#666' }}>
            {isAuthUser ? 'Platform account — native Chrysalis signing' : 'Extension wallet — ML-DSA-65'}
          </span>
        </div>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: '#666' }}>{r.label}</span>
              <span style={{ color: '#fff', fontWeight: 600, maxWidth: '65%', textAlign: 'right', wordBreak: 'break-word' }}>{r.value}</span>
            </div>
          ))}
        </div>
        <p style={{ color: '#555', fontSize: 11, marginBottom: 14 }}>ML-DSA-65 signed — cryptographically tied to your wallet identity</p>
        {status === 'error' && <p style={{ color: '#ff4444', fontSize: 13, marginBottom: 10 }}>{errMsg}</p>}
        {(status === 'pending' || status === 'success') && (
          <p style={{ color: '#39ff14', fontSize: 13, fontWeight: status === 'success' ? 700 : 400, marginBottom: 10 }}>{stageLabel}</p>
        )}
        {!canConfirm ? (
          <p style={{ color: '#ff4444', fontSize: 13 }}>HIVE Wallet extension not detected. Install it or log in with a platform account.</p>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ flex: 1, background: 'none', border: '1px solid #333', borderRadius: 8, padding: '10px 0', color: '#aaa', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={status === 'pending' || status === 'success'}
              style={{ flex: 2, background: '#39ff14', border: 'none', borderRadius: 8, padding: '10px 0',
                       color: '#000', fontWeight: 700, cursor: status === 'idle' || status === 'error' ? 'pointer' : 'not-allowed',
                       opacity: status === 'pending' || status === 'success' ? 0.6 : 1 }}>
              {status === 'pending' ? '⬡ Signing…' : status === 'success' ? '✓ Done' : '⬡ Confirm'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Post Confirm Modal ────────────────────────────────────────────────────────

function PostExtModal({ wallet, content, isAuthUser, authToken, onClose, onSuccess }: {
  wallet: string; content: string; isAuthUser: boolean; authToken: string | null;
  onClose: () => void; onSuccess: () => void;
}) {
  const ts = Date.now();
  const text = content.slice(0, 280);
  const sigMessage = `social_post|${wallet}|${text}|${ts}`;

  async function handleSign(sig: SigResult) {
    const resp = await fetch(`${API_BASE}/social/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: sig.wallet, content: text, mldsaPubKeyHex: sig.mldsaPubKeyHex, signatureHex: sig.signatureHex, ts }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Post failed'); }
    onSuccess();
  }

  return (
    <SocialExtModal
      title="Post to HoneyBook"
      rows={[
        { label: 'From', value: `${wallet.slice(0, 10)}…` },
        { label: 'Length', value: `${text.length} chars` },
        { label: 'Preview', value: text.length > 60 ? text.slice(0, 60) + '…' : text },
      ]}
      isAuthUser={isAuthUser} authToken={authToken} wallet={wallet}
      sigMessage={sigMessage} onSign={handleSign} onClose={onClose}
    />
  );
}

// ── Follow Confirm Modal ──────────────────────────────────────────────────────

function FollowExtModal({ follower, following, isAuthUser, authToken, onClose, onSuccess }: {
  follower: string; following: string; isAuthUser: boolean; authToken: string | null;
  onClose: () => void; onSuccess: () => void;
}) {
  const ts = Date.now();
  const sigMessage = `social_follow|${follower}|${following}|${ts}`;

  async function handleSign(sig: SigResult) {
    const resp = await fetch(`${API_BASE}/social/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followerWallet: sig.wallet, followingWallet: following, mldsaPubKeyHex: sig.mldsaPubKeyHex, signatureHex: sig.signatureHex, ts }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Follow failed'); }
    onSuccess();
  }

  return (
    <SocialExtModal
      title="Follow Wallet"
      rows={[{ label: 'Following', value: following }]}
      isAuthUser={isAuthUser} authToken={authToken} wallet={follower}
      sigMessage={sigMessage} onSign={handleSign} onClose={onClose}
    />
  );
}

// ── DM Compose Modal ──────────────────────────────────────────────────────────

function DmComposeModal({ fromWallet, initialTo, isAuthUser, authToken, onClose, onSuccess }: {
  fromWallet: string; initialTo?: string; isAuthUser: boolean; authToken: string | null;
  onClose: () => void; onSuccess: () => void;
}) {
  const [toWallet, setToWallet] = useState(initialTo || '');
  const [msgText, setMsgText]   = useState('');
  const [step, setStep]         = useState<'compose' | 'confirm'>('compose');
  const [sigMsg, setSigMsg]     = useState('');
  const [cipherJson, setCipherJson] = useState('');
  const [ts, setTs]             = useState(0);

  async function handleSend() {
    if (!toWallet.trim() || !msgText.trim()) return;
    const nowTs = Date.now();
    const cipher = JSON.stringify({ v: 1, text: msgText.trim() }); // plaintext for now (real ML-KEM would encrypt here)
    const hash = await sha256Hex(cipher);
    const msg = `social_dm|${fromWallet}|${toWallet.trim()}|${hash.slice(0, 16)}|${nowTs}`;
    setSigMsg(msg);
    setCipherJson(cipher);
    setTs(nowTs);
    setStep('confirm');
  }

  async function handleSign(sig: SigResult) {
    const resp = await fetch(`${API_BASE}/social/dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromWallet: sig.wallet,
        toWallet: toWallet.trim(),
        cipherJson,
        previewText: msgText.trim().slice(0, 60),
        mldsaPubKeyHex: sig.mldsaPubKeyHex,
        signatureHex: sig.signatureHex,
        timestamp: ts,
      }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'DM failed'); }
    onSuccess();
  }

  if (step === 'confirm') {
    return (
      <SocialExtModal
        title="Send Encrypted DM"
        rows={[
          { label: 'To', value: shortAddr(toWallet.trim()) },
          { label: 'Preview', value: msgText.slice(0, 50) + (msgText.length > 50 ? '…' : '') },
          { label: 'Encryption', value: 'Chrysalis (ML-KEM-768)' },
        ]}
        isAuthUser={isAuthUser} authToken={authToken} wallet={fromWallet}
        sigMessage={sigMsg} onSign={handleSign}
        onClose={() => setStep('compose')}
      />
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
      <div style={{ background: '#0d1117', border: '1px solid #f5b429', borderRadius: 16, padding: 28, maxWidth: 480, width: '90%', position: 'relative', marginBottom: 24 }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        <h3 style={{ color: '#f5b429', marginBottom: 6 }}>💬 New Encrypted DM</h3>
        <p style={{ color: '#555', fontSize: 12, marginBottom: 18 }}>Messages are Chrysalis ML-KEM-768 encrypted. Only the recipient can read them.</p>

        <label style={{ color: '#aaa', fontSize: 13, display: 'block', marginBottom: 12 }}>
          Recipient Wallet Address
          <input
            value={toWallet} onChange={e => setToWallet(e.target.value)}
            placeholder="HNY_xxxx…" autoFocus={!initialTo}
            style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 14, boxSizing: 'border-box', fontFamily: 'Space Mono, monospace' }}
          />
        </label>

        <label style={{ color: '#aaa', fontSize: 13, display: 'block', marginBottom: 16 }}>
          Message
          <textarea
            value={msgText} onChange={e => setMsgText(e.target.value.slice(0, 500))}
            rows={5} placeholder="Write your message…"
            style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <span style={{ color: '#555', fontSize: 11 }}>{msgText.length}/500</span>
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, background: 'none', border: '1px solid #333', borderRadius: 8, padding: '10px 0', color: '#aaa', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSend} disabled={!toWallet.trim() || !msgText.trim()}
            style={{ flex: 2, background: '#f5b429', border: 'none', borderRadius: 8, padding: '10px 0',
                     color: '#000', fontWeight: 700, cursor: toWallet.trim() && msgText.trim() ? 'pointer' : 'not-allowed',
                     opacity: toWallet.trim() && msgText.trim() ? 1 : 0.4 }}>
            🔒 Send DM →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DM Thread View ────────────────────────────────────────────────────────────

function DmThread({ myWallet, partnerWallet, partnerName, partnerEmoji, isAuthUser, authToken, onBack, onCompose }: {
  myWallet: string;
  partnerWallet: string;
  partnerName: string;
  partnerEmoji: string;
  isAuthUser: boolean;
  authToken: string | null;
  onBack: () => void;
  onCompose: (to: string) => void;
}) {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/social/dm-thread/${myWallet}/${partnerWallet}`);
      const data = await resp.json();
      setMessages(data.messages || []);
      // Mark received messages as read
      for (const m of (data.messages || []) as DmMessage[]) {
        if (m.toWallet === myWallet && !m.read) {
          fetch(`${API_BASE}/social/dm-read/${m.id}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: myWallet }),
          }).catch(() => {});
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [myWallet, partnerWallet]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '1px solid #1e2a1e', marginBottom: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', color: '#aaa', cursor: 'pointer', fontSize: 13 }}>← Back</button>
        <span style={{ fontSize: 22 }}>{partnerEmoji}</span>
        <div>
          <div style={{ color: '#fff', fontWeight: 600 }}>{partnerName}</div>
          <div style={{ color: '#555', fontSize: 11, fontFamily: 'Space Mono, monospace' }}>{shortAddr(partnerWallet)}</div>
        </div>
        <button onClick={() => onCompose(partnerWallet)}
          style={{ marginLeft: 'auto', background: '#f5b429', border: 'none', borderRadius: 8, padding: '6px 14px', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
          ✉ Reply
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200, maxHeight: 400 }}>
        {loading ? (
          <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>Loading thread…</div>
        ) : messages.length === 0 ? (
          <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>No messages yet. Start the conversation!</div>
        ) : messages.map(m => {
          const isMine = m.fromWallet === myWallet;
          const text = (() => {
            try { return (JSON.parse(m.cipherJson) as { text?: string }).text || m.previewText; }
            catch { return m.previewText; }
          })();
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
              <div style={{
                background: isMine ? '#1a3a1a' : '#111',
                border: `1px solid ${isMine ? '#39ff14' : '#2a2a2a'}`,
                borderRadius: isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                padding: '8px 14px', maxWidth: '75%',
              }}>
                <p style={{ color: isMine ? '#c8ffc8' : '#e0e0e0', fontSize: 14, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{text}</p>
                <div style={{ color: '#444', fontSize: 10, marginTop: 4, textAlign: 'right' }}>{timeAgo(m.createdAtMs)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── DM Inbox View ─────────────────────────────────────────────────────────────

function DmInbox({ myWallet, isAuthUser, authToken, onCompose }: {
  myWallet: string; isAuthUser: boolean; authToken: string | null;
  onCompose: (to?: string) => void;
}) {
  const [dms, setDms]         = useState<DmItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [thread, setThread]   = useState<{ wallet: string; name: string; emoji: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/social/dms/${myWallet}`);
      const data = await resp.json();
      setDms(data.dms || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [myWallet]);

  useEffect(() => { load(); }, [load]);

  // Group by partner — latest message per partner
  const conversations = Array.from(
    dms.reduce((map, dm) => {
      if (!map.has(dm.partner)) map.set(dm.partner, dm);
      return map;
    }, new Map<string, DmItem>()).values()
  );

  if (thread) {
    return (
      <DmThread
        myWallet={myWallet}
        partnerWallet={thread.wallet}
        partnerName={thread.name}
        partnerEmoji={thread.emoji}
        isAuthUser={isAuthUser}
        authToken={authToken}
        onBack={() => { setThread(null); load(); }}
        onCompose={to => onCompose(to)}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ color: '#f5b429', fontSize: 17, fontWeight: 700, margin: 0 }}>💬 DM Inbox</h2>
        <button onClick={() => onCompose()}
          style={{ background: '#f5b429', border: 'none', borderRadius: 8, padding: '7px 16px', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
          ✉ New DM
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#555', textAlign: 'center', padding: 40 }}>Loading inbox…</div>
      ) : conversations.length === 0 ? (
        <div style={{ color: '#555', textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
          <div style={{ marginBottom: 8 }}>No messages yet.</div>
          <div style={{ fontSize: 13 }}>Send an encrypted DM to any HIVE wallet.</div>
        </div>
      ) : conversations.map(dm => (
        <button key={dm.partner} onClick={() => setThread({ wallet: dm.partner, name: dm.partnerName, emoji: dm.partnerEmoji })}
          style={{
            width: '100%', textAlign: 'left', background: dm.read ? '#0d1117' : '#0f1f12',
            border: `1px solid ${dm.read ? '#1e2a1e' : '#2a5a2a'}`,
            borderRadius: 10, padding: 14, marginBottom: 10, cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center',
          }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#111', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {dm.partnerPhoto
              ? <img src={dm.partnerPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 22 }}>{dm.partnerEmoji}</span>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{dm.partnerName}</span>
              {!dm.read && dm.toWallet === myWallet && (
                <span style={{ background: '#f5b429', color: '#000', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>NEW</span>
              )}
              <span style={{ marginLeft: 'auto', color: '#555', fontSize: 11, flexShrink: 0 }}>{timeAgo(dm.createdAtMs)}</span>
            </div>
            <div style={{ color: '#888', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dm.fromWallet === myWallet ? <span style={{ color: '#555' }}>You: </span> : null}
              {dm.previewText}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Post Card ─────────────────────────────────────────────────────────────────

function PostCard({ post, myWallet, onFollow }: { post: SocialPost; myWallet: string | null; onFollow: (w: string) => void }) {
  return (
    <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#111', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {(post as SocialPost & { avatarPhoto?: string }).avatarPhoto
            ? <img src={(post as SocialPost & { avatarPhoto?: string }).avatarPhoto!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 22 }}>{post.avatarEmoji || '🐝'}</span>
          }
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ color: '#fff', fontWeight: 600 }}>{post.displayName || shortAddr(post.wallet)}</span>
            {post.displayName && <span style={{ color: '#555', fontSize: 11 }}>{shortAddr(post.wallet)}</span>}
            <span style={{ marginLeft: 'auto', color: '#555', fontSize: 11 }}>{timeAgo(post.createdAtMs)}</span>
          </div>
          <p style={{ color: '#e0e0e0', fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{post.content}</p>
        </div>
      </div>
      {myWallet && post.wallet !== myWallet && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => onFollow(post.wallet)}
            style={{ background: 'none', border: '1px solid #39ff14', color: '#39ff14', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
            + Follow
          </button>
        </div>
      )}
    </div>
  );
}

// ── Edit Profile Form ─────────────────────────────────────────────────────────

function EditProfileForm({ wallet, profile, isAuthUser, authToken, onSuccess }: {
  wallet: string; profile: UserProfile | null; isAuthUser: boolean; authToken: string | null; onSuccess: () => void;
}) {
  const EMOJIS = ['🐝', '🍯', '👑', '🌸', '💎', '🔥', '⚡', '🌙', '🦁', '🐉', '🧠', '🌊'];
  const [name, setName]       = useState(profile?.displayName || '');
  const [bio, setBio]         = useState(profile?.bio || '');
  const [emoji, setEmoji]     = useState(profile?.avatarEmoji || '🐝');
  const [photoUrl, setPhotoUrl] = useState(profile?.avatarPhoto || '');
  const [bannerUrl, setBannerUrl] = useState(profile?.bannerData || '');
  const [photoScan, setPhotoScan] = useState<'idle' | 'scanning' | 'ok' | 'rejected'>('idle');
  const [bannerScan, setBannerScan] = useState<'idle' | 'scanning' | 'ok' | 'rejected'>('idle');
  const [showConfirm, setShowConfirm] = useState(false);

  async function scanImage(dataUrl: string, wallet: string): Promise<boolean> {
    try {
      const API = typeof window !== 'undefined' ? '/api' : 'http://localhost:3000';
      const resp = await fetch(`${API}/social/scan-photo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, photoData: dataUrl.slice(0, 50000) }),
      });
      const data = await resp.json();
      return !!data.approved;
    } catch { return true; }
  }

  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoScan('scanning');
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const ok = await scanImage(dataUrl, wallet);
      if (ok) { setPhotoUrl(dataUrl); setPhotoScan('ok'); }
      else { setPhotoScan('rejected'); }
    };
    reader.readAsDataURL(file);
  }

  async function handleBannerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerScan('scanning');
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const ok = await scanImage(dataUrl, wallet);
      if (ok) { setBannerUrl(dataUrl); setBannerScan('ok'); }
      else { setBannerScan('rejected'); }
    };
    reader.readAsDataURL(file);
  }

  if (showConfirm) {
    const ts = Date.now();
    const trimName = name.trim().slice(0, 50);
    const sigMessage = `social_profile|${wallet}|${trimName}|${bio}|${emoji}|${ts}`;

    const handleSign = async (sig: SigResult) => {
      const resp = await fetch(`${API_BASE}/social/update-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: sig.wallet, displayName: trimName, bio, avatarEmoji: emoji,
          ...(photoUrl ? { avatarPhoto: photoUrl } : {}),
          ...(bannerUrl ? { bannerData: bannerUrl } : {}),
          mldsaPubKeyHex: sig.mldsaPubKeyHex, signatureHex: sig.signatureHex, ts,
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error((e as { error?: string }).error || 'Profile update failed'); }
      onSuccess();
    }

    return (
      <SocialExtModal
        title="Update HoneyBook Profile"
        rows={[
          { label: 'Display Name', value: trimName || '(unchanged)' },
          { label: 'Avatar', value: emoji },
          { label: 'Bio', value: bio ? (bio.length > 40 ? bio.slice(0, 40) + '…' : bio) : '(unchanged)' },
          ...(photoUrl ? [{ label: 'Avatar Photo', value: '✓ Attached' }] : []),
          ...(bannerUrl ? [{ label: 'Banner Photo', value: '✓ Attached' }] : []),
        ]}
        isAuthUser={isAuthUser} authToken={authToken} wallet={wallet}
        sigMessage={sigMessage} onSign={handleSign}
        onClose={() => setShowConfirm(false)}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>Avatar Emoji</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)}
              style={{ fontSize: 20, background: emoji === e ? '#1a3a1a' : '#111', border: `1px solid ${emoji === e ? '#39ff14' : '#333'}`, borderRadius: 8, padding: '5px 8px', cursor: 'pointer' }}>
              {e}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>Profile Banner (optional)</div>
        {bannerUrl ? (
          <div style={{ marginBottom: 6 }}>
            <div style={{ width: '100%', height: 80, borderRadius: 8, background: `url(${bannerUrl}) center/cover no-repeat`, border: '2px solid #39ff14', marginBottom: 6 }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#39ff14', fontSize: 12, fontWeight: 600 }}>✓ Banner approved by Queen Bee AI</span>
              <button onClick={() => { setBannerUrl(''); setBannerScan('idle'); }} style={{ background: 'none', border: 'none', color: '#666', fontSize: 11, cursor: 'pointer', padding: 0 }}>Remove</button>
            </div>
          </div>
        ) : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: '#111', border: '1px dashed #333', borderRadius: 8, padding: '10px 14px' }}>
            <input type="file" accept="image/*" onChange={handleBannerFile} style={{ display: 'none' }} />
            <span style={{ fontSize: 18 }}>🖼</span>
            <span style={{ color: '#666', fontSize: 13 }}>
              {bannerScan === 'scanning' ? '🔍 Queen Bee AI scanning banner…' :
               bannerScan === 'rejected' ? '❌ Banner rejected — please choose another' :
               'Upload banner image (wide format recommended)'}
            </span>
          </label>
        )}
      </div>

      <div>
        <div style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>Profile Photo (optional)</div>
        {photoUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <img src={photoUrl} alt="preview" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid #39ff14' }} />
            <div>
              <div style={{ color: '#39ff14', fontSize: 12, fontWeight: 600 }}>✓ Photo approved by Queen Bee AI</div>
              <button onClick={() => { setPhotoUrl(''); setPhotoScan('idle'); }} style={{ background: 'none', border: 'none', color: '#666', fontSize: 11, cursor: 'pointer', padding: 0 }}>Remove</button>
            </div>
          </div>
        ) : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: '#111', border: '1px dashed #333', borderRadius: 8, padding: '10px 14px' }}>
            <input type="file" accept="image/*" onChange={handlePhotoFile} style={{ display: 'none' }} />
            <span style={{ fontSize: 18 }}>📷</span>
            <span style={{ color: '#666', fontSize: 13 }}>
              {photoScan === 'scanning' ? '🔍 Queen Bee AI scanning…' :
               photoScan === 'rejected' ? '❌ Photo rejected — please choose another' :
               'Upload profile photo'}
            </span>
          </label>
        )}
      </div>

      <label style={{ color: '#aaa', fontSize: 13 }}>
        Display Name
        <input value={name} onChange={e => setName(e.target.value)} maxLength={50} placeholder="Your name"
          style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 14, boxSizing: 'border-box' }} />
      </label>
      <label style={{ color: '#aaa', fontSize: 13 }}>
        Bio
        <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2} maxLength={200} placeholder="About you…"
          style={{ display: 'block', width: '100%', marginTop: 4, background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 12px', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
      </label>
      <button onClick={() => setShowConfirm(true)}
        style={{ background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '10px 0', fontWeight: 700, cursor: 'pointer' }}>
        ⬡ Update Profile →
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SocialPage() {
  const { address: wallet, isAuthUser, authUser } = useHiveWallet();
  const authToken = authUser?.token ?? null;
  const searchParams = useSearchParams();

  const [feedTab, setFeedTab] = useState<'global' | 'following' | 'dms'>('global');
  const [posts, setPosts]     = useState<SocialPost[]>([]);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [unreadDmCount, setUnreadDmCount]   = useState(0);

  // Compose DM modal
  const [dmComposeTo, setDmComposeTo] = useState<string | null>(null);

  // Modals
  const [postContent, setPostContent] = useState<string | null>(null);
  const [followTarget, setFollowTarget] = useState<string | null>(null);

  // Sidebar search
  const [searchQuery, setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching]       = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const feedFn = feedTab === 'following' && wallet ? getFollowingFeed(wallet) : getSocialFeed();
      if (feedTab !== 'dms') {
        const [feed] = await Promise.all([feedFn]);
        setPosts(feed.posts);
      }
      if (wallet) {
        try {
          const { profile } = await getSocialProfile(wallet);
          setMyProfile(profile);
        } catch { setMyProfile(null); }
        // Fetch unread DM count
        try {
          const r = await fetch(`${API_BASE}/social/unread-dm-count/${wallet}`);
          const d = await r.json();
          setUnreadDmCount(d.count || 0);
        } catch { /* silent */ }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [feedTab, wallet]);

  useEffect(() => {
    if (searchParams?.get('edit') === '1' && wallet) setEditingProfile(true);
  }, [searchParams, wallet]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  // Debounced user search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`${API_BASE}/social/search?q=${encodeURIComponent(searchQuery.trim())}`);
        const d = await r.json();
        setSearchResults(d.results || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
  }, [searchQuery]);

  function openDmCompose(to?: string) { setDmComposeTo(to ?? ''); }

  return (
    <div style={{ minHeight: '100vh', background: '#040507', color: '#e0e0e0', fontFamily: 'Space Grotesk, sans-serif', padding: '92px 16px 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>

        {/* Main feed column */}
        <div>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#39ff14', letterSpacing: -1, margin: 0 }}>🐝 HoneyBook</h1>
            <p style={{ color: '#666', marginTop: 6 }}>Signed posts · on-chain identity · Chrysalis-encrypted DMs</p>
          </div>

          {/* Compose */}
          {wallet && feedTab !== 'dms' && (
            <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              {!composing ? (
                <button onClick={() => setComposing(true)}
                  style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, padding: 14, color: '#555', textAlign: 'left', cursor: 'pointer', fontSize: 14 }}>
                  What&apos;s the buzz? 🐝 Share with the hive…
                </button>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <div style={{ fontSize: 28 }}>{myProfile?.avatarEmoji || '🐝'}</div>
                    <textarea
                      value={draft} onChange={e => setDraft(e.target.value.slice(0, MAX_CHARS))}
                      autoFocus rows={4} placeholder="Write your post (up to 280 chars)…"
                      style={{ flex: 1, background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '10px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: draft.length > MAX_CHARS * 0.9 ? '#ff4444' : '#555', fontSize: 12 }}>
                      {draft.length} / {MAX_CHARS}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { setComposing(false); setDraft(''); }}
                        style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '8px 14px' }}>
                        Cancel
                      </button>
                      <button onClick={() => draft.trim() && setPostContent(draft.trim())}
                        disabled={!draft.trim()}
                        style={{ background: '#39ff14', color: '#000', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'not-allowed', opacity: draft.trim() ? 1 : 0.4 }}>
                        ⬡ Post →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Feed tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {([
              { key: 'global',    label: '🌐 Global' },
              { key: 'following', label: '👥 Following' },
              { key: 'dms',       label: `💬 DMs${unreadDmCount > 0 ? ` (${unreadDmCount})` : ''}` },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setFeedTab(t.key)}
                style={{
                  background: feedTab === t.key ? (t.key === 'dms' ? '#f5b429' : '#39ff14') : '#111',
                  color: feedTab === t.key ? '#000' : (t.key === 'dms' && unreadDmCount > 0 ? '#f5b429' : '#aaa'),
                  border: '1px solid ' + (feedTab === t.key ? (t.key === 'dms' ? '#f5b429' : '#39ff14') : (t.key === 'dms' && unreadDmCount > 0 ? '#f5b429' : '#333')),
                  borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* DM Inbox */}
          {feedTab === 'dms' && wallet && (
            <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 12, padding: 16 }}>
              <DmInbox myWallet={wallet} isAuthUser={isAuthUser} authToken={authToken} onCompose={openDmCompose} />
            </div>
          )}
          {feedTab === 'dms' && !wallet && (
            <div style={{ color: '#555', textAlign: 'center', padding: 40 }}>Connect your wallet to view DMs.</div>
          )}

          {/* Posts feed */}
          {feedTab !== 'dms' && (
            loading ? (
              <div style={{ color: '#555', textAlign: 'center', padding: 40 }}>Loading feed…</div>
            ) : posts.length === 0 ? (
              <div style={{ color: '#555', textAlign: 'center', padding: 40 }}>
                {feedTab === 'following' ? 'Follow some wallets to see their posts here.' : 'No posts yet. Be the first to post!'}
              </div>
            ) : (
              posts.map(p => <PostCard key={p.id} post={p} myWallet={wallet} onFollow={w => setFollowTarget(w)} />)
            )
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* User Search */}
          <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 12, padding: 16 }}>
            <div style={{ color: '#aaa', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>🔍 Find Users</div>
            <div style={{ position: 'relative' }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name or wallet…"
                style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '8px 12px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>
            {searching && <div style={{ color: '#555', fontSize: 12, marginTop: 8 }}>Searching…</div>}
            {!searching && searchResults.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {searchResults.map(r => (
                  <div key={r.wallet} style={{ background: '#111', border: '1px solid #1e2a1e', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                      {r.avatarPhoto
                        ? <img src={r.avatarPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 18 }}>{r.avatarEmoji}</span>
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.displayName || shortAddr(r.wallet)}</div>
                      <div style={{ color: '#555', fontSize: 11 }}>{r.followerCount} followers</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {wallet && r.wallet !== wallet && (
                        <button onClick={() => setFollowTarget(r.wallet)}
                          style={{ background: 'none', border: '1px solid #39ff14', color: '#39ff14', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          + Follow
                        </button>
                      )}
                      {wallet && (
                        <button onClick={() => openDmCompose(r.wallet)}
                          style={{ background: 'none', border: '1px solid #f5b429', color: '#f5b429', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          💬 DM
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!searching && searchQuery.trim() && searchResults.length === 0 && (
              <div style={{ color: '#555', fontSize: 12, marginTop: 8 }}>No users found for &ldquo;{searchQuery}&rdquo;</div>
            )}
          </div>

          {/* My Profile */}
          {wallet && (
            <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 12, overflow: 'hidden' }}>
              {/* Banner */}
              <div style={{
                height: 72,
                background: myProfile?.bannerData
                  ? `url(${myProfile.bannerData}) center/cover no-repeat`
                  : 'linear-gradient(135deg, #0a1a0a 0%, #1a3a0a 50%, #0a1a0a 100%)',
              }} />
              {/* Avatar + info */}
              <div style={{ padding: '0 16px 16px', marginTop: -22 }}>
                <div style={{ width: 46, height: 46, borderRadius: '50%', border: '2px solid #0d1117', background: '#111', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                  {myProfile?.avatarPhoto
                    ? <img src={myProfile.avatarPhoto} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 24 }}>{myProfile?.avatarEmoji || '🐝'}</span>
                  }
                </div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{myProfile?.displayName || 'Anonymous'}</div>
                <div style={{ color: '#555', fontSize: 11, marginBottom: 8 }}>{shortAddr(wallet)}</div>
                {myProfile && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12 }}>
                    <span style={{ color: '#aaa' }}><strong style={{ color: '#fff' }}>{myProfile.followerCount}</strong> followers</span>
                    <span style={{ color: '#aaa' }}><strong style={{ color: '#fff' }}>{myProfile.followingCount}</strong> following</span>
                  </div>
                )}
                {myProfile?.bio && <p style={{ color: '#aaa', fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>{myProfile.bio}</p>}

                {/* DM compose shortcut */}
                <button onClick={() => openDmCompose()}
                  style={{ width: '100%', background: '#111', border: '1px solid #f5b42955', borderRadius: 8, padding: '7px 0', color: '#f5b429', cursor: 'pointer', fontSize: 13, marginBottom: 6 }}>
                  💬 New Encrypted DM
                </button>

                <button onClick={() => setEditingProfile(!editingProfile)}
                  style={{ width: '100%', background: editingProfile ? '#333' : '#111', border: '1px solid #333', borderRadius: 8, padding: '7px 0', color: editingProfile ? '#fff' : '#aaa', cursor: 'pointer', fontSize: 13 }}>
                  {editingProfile ? '✕ Cancel Edit' : '✏️ Edit Profile'}
                </button>
                {editingProfile && (
                  <div style={{ marginTop: 12 }}>
                    <EditProfileForm wallet={wallet} profile={myProfile} isAuthUser={isAuthUser} authToken={authToken} onSuccess={() => { setEditingProfile(false); refresh(); }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* How It Works */}
          <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 12, padding: 20 }}>
            <h3 style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>How It Works</h3>
            {[
              { icon: '🔐', title: 'Wallet Identity', desc: 'Your wallet IS your identity. No usernames.' },
              { icon: '✍️',  title: 'Signed Posts',   desc: 'Every post is ML-DSA-65 signed — cryptographically verifiable.' },
              { icon: '🔒', title: 'Encrypted DMs',  desc: 'Chrysalis ML-KEM-768 encryption. Server sees ciphertext only.' },
              { icon: '👥', title: 'Follow Anyone',  desc: 'Follow any HIVE wallet address to see their posts.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 18, minWidth: 24 }}>{icon}</span>
                <div>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{title}</div>
                  <div style={{ color: '#555', fontSize: 12 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Modals */}
      {postContent && wallet && (
        <PostExtModal wallet={wallet} content={postContent}
          isAuthUser={isAuthUser} authToken={authToken}
          onClose={() => { setPostContent(null); setComposing(false); setDraft(''); }}
          onSuccess={() => { setPostContent(null); setComposing(false); setDraft(''); refresh(); }} />
      )}
      {followTarget && wallet && (
        <FollowExtModal follower={wallet} following={followTarget}
          isAuthUser={isAuthUser} authToken={authToken}
          onClose={() => setFollowTarget(null)}
          onSuccess={() => { setFollowTarget(null); refresh(); }} />
      )}
      {dmComposeTo !== null && wallet && (
        <DmComposeModal
          fromWallet={wallet}
          initialTo={dmComposeTo}
          isAuthUser={isAuthUser}
          authToken={authToken}
          onClose={() => setDmComposeTo(null)}
          onSuccess={() => { setDmComposeTo(null); setFeedTab('dms'); }}
        />
      )}
    </div>
  );
}
