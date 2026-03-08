'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useHiveWallet } from '@/components/HiveWalletConnect';

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = typeof window !== 'undefined' ? '/api' : 'http://localhost:3000';
const SERVICE_FEE_RATE = 0.000005;
const HNY_PRICE_USD = 1.0;
const TX_TTL_MS = 5 * 60 * 1000; // 5 min
const ADDR_BOOK_KEY = 'hive_address_book';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt8(n: number) { return n.toFixed(8); }

function expectedServiceFee(amount: number) {
  const usdValue = amount * HNY_PRICE_USD;
  return Math.max(0.0001, (usdValue * SERVICE_FEE_RATE) / HNY_PRICE_USD);
}

function canonicalSignedMessage({
  chainId, type, from, to, amount, nonce, gasFee, serviceFee, expiresAtMs, timestamp,
}: {
  chainId: string; type: string; from: string; to: string;
  amount: number; nonce: number; gasFee: number; serviceFee: number;
  expiresAtMs: number; timestamp: number;
}) {
  return [
    String(chainId), String(type), String(from ?? ''), String(to ?? ''),
    fmt8(amount), String(nonce), fmt8(gasFee), fmt8(serviceFee),
    String(expiresAtMs), String(timestamp), '',
  ].join('|');
}

type AddrBookEntry = { label: string; address: string };
function loadAddressBook(): AddrBookEntry[] {
  try { return JSON.parse(localStorage.getItem(ADDR_BOOK_KEY) || '[]'); } catch { return []; }
}
function saveAddressBook(book: AddrBookEntry[]) {
  localStorage.setItem(ADDR_BOOK_KEY, JSON.stringify(book));
}

type SigResult = { signatureHex: string; mldsaPubKeyHex: string; wallet: string };
type ExtHive = { sign?: (msg: string) => Promise<{ signatureHex: string; publicKeyHex: string; address: string }> };
function getHiveExt(): ExtHive | null {
  if (typeof window === 'undefined') return null;
  const h = (window as unknown as { hive?: ExtHive }).hive;
  return h?.sign ? h : null;
}

async function platformSign(message: string, token: string): Promise<SigResult> {
  const resp = await fetch(`${API_BASE}/auth/sign-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || 'Signing failed');
  }
  return resp.json() as Promise<SigResult>;
}

// ── Hex QR Component ──────────────────────────────────────────────────────────

function HexQR({ value, size = 180 }: { value: string; size?: number }) {
  const clip = `polygon(
    50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%
  )`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        {/* Glow ring */}
        <div style={{
          position: 'absolute', inset: -4,
          clipPath: clip,
          background: 'linear-gradient(135deg, #39ff14 0%, #f5b429 50%, #39ff14 100%)',
          filter: 'blur(4px)',
          opacity: 0.6,
        }} />
        {/* QR canvas */}
        <div style={{ position: 'relative', clipPath: clip, overflow: 'hidden', width: size, height: size }}>
          <QRCodeCanvas value={value} size={size} bgColor="#0d1117" fgColor="#39ff14" level="M" />
        </div>
      </div>
      <div style={{ color: '#555', fontSize: 11, textAlign: 'center', wordBreak: 'break-all', maxWidth: size + 40 }}>
        {value}
      </div>
    </div>
  );
}

// ── QR Scanner (html5-qrcode via dynamic import) ──────────────────────────────

function QRScanner({ onScan, onClose }: { onScan: (addr: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        // Use BarcodeDetector if available
        const BD = (window as unknown as { BarcodeDetector?: { getSupportedFormats: () => Promise<string[]>; new(o: unknown): { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } } }).BarcodeDetector;
        if (BD) {
          const detector = new BD({ formats: ['qr_code'] });
          const scan = async () => {
            if (!active || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes.length > 0) { onScan(codes[0].rawValue); return; }
            } catch { /* ignore */ }
            requestAnimationFrame(scan);
          };
          videoRef.current?.addEventListener('loadeddata', scan);
        }
      } catch (e) {
        if (active) setError((e as Error).message || 'Camera access denied');
      }
    }
    startCamera();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [onScan]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <h3 style={{ color: '#39ff14', margin: 0 }}>Scan QR Code</h3>
      {error ? (
        <p style={{ color: '#ff4444' }}>{error}</p>
      ) : (
        <div style={{ border: '2px solid #39ff14', borderRadius: 12, overflow: 'hidden', width: 260, height: 260, position: 'relative' }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {/* Corner guides */}
          {['0 0', '0 auto', 'auto 0', 'auto auto'].map((pos, i) => (
            <div key={i} style={{
              position: 'absolute', width: 24, height: 24,
              borderTop: ['0 0','0 auto'].includes(pos) ? '3px solid #39ff14' : 'none',
              borderBottom: ['auto 0','auto auto'].includes(pos) ? '3px solid #39ff14' : 'none',
              borderLeft: ['0 0','auto 0'].includes(pos) ? '3px solid #39ff14' : 'none',
              borderRight: ['0 auto','auto auto'].includes(pos) ? '3px solid #39ff14' : 'none',
              top: pos.startsWith('0') ? 8 : 'auto', bottom: pos.startsWith('auto') ? 8 : 'auto',
              left: pos.endsWith('0') ? 8 : 'auto', right: pos.endsWith('auto') ? 8 : 'auto',
            }} />
          ))}
        </div>
      )}
      <p style={{ color: '#666', fontSize: 12 }}>Point camera at a HIVE wallet QR code</p>
      <button onClick={onClose} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#aaa', padding: '8px 24px', cursor: 'pointer' }}>Cancel</button>
    </div>
  );
}

// ── Wallet Settings Modal ─────────────────────────────────────────────────────

function WalletSettings({ wallet, isAuthUser, authToken, authUser: au, onClose, onLogout }: {
  wallet: string;
  isAuthUser: boolean;
  authToken: string | null;
  authUser: { displayName?: string; email?: string | null; phone?: string | null } | null;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'backup' | 'security'>('overview');

  // Backup phrase reveal
  const [bpPassword, setBpPassword]     = useState('');
  const [bpPhrase, setBpPhrase]         = useState<string | null>(null);
  const [bpStatus, setBpStatus]         = useState<'idle' | 'loading' | 'shown' | 'error'>('idle');
  const [bpError, setBpError]           = useState('');
  const [_bpRevealed, _setBpRevealed]   = useState(false); // reserved for future "I've written it down" confirm

  // Change display name
  const [newName, setNewName]           = useState(au?.displayName || '');
  const [nameStatus, setNameStatus]     = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleRevealBackup() {
    if (!authToken || !bpPassword) return;
    setBpStatus('loading');
    setBpError('');
    try {
      const resp = await fetch(`${API_BASE}/auth/reveal-backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ password: bpPassword }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed');
      setBpPhrase(data.backupPhrase);
      setBpStatus('shown');
      setBpPassword('');
    } catch (e: unknown) {
      setBpStatus('error');
      setBpError((e as Error).message || 'Failed to reveal backup phrase');
    }
  }

  const phraseGroups = bpPhrase ? bpPhrase.split('-') : [];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
      <div style={{ background: '#0d1117', border: '1px solid #333', borderRadius: 16, maxWidth: 500, width: '90%', position: 'relative', marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #1a1a1a' }}>
          <h3 style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: 16 }}>⚙️ Wallet Settings</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a' }}>
          {(['overview', 'backup', 'security'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, background: 'none', border: 'none', borderBottom: `2px solid ${tab === t ? '#39ff14' : 'transparent'}`, padding: '10px 0', color: tab === t ? '#39ff14' : '#555', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 400, textTransform: 'capitalize' }}>
              {t === 'overview' ? '🐝 Overview' : t === 'backup' ? '🔑 Recovery' : '🔒 Security'}
            </button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {/* Overview tab */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Account info rows */}
              {[
                { label: 'Wallet Address', value: wallet, mono: true },
                ...(au?.email    ? [{ label: 'Email',   value: au.email,   mono: false }] : []),
                ...(au?.phone    ? [{ label: 'Phone',   value: au.phone,   mono: false }] : []),
                { label: 'Account Type', value: isAuthUser ? 'Platform Account (custodial)' : 'Extension Wallet', mono: false },
                { label: 'Signing Method', value: 'ML-DSA-65 (NIST FIPS 204)', mono: false },
              ].map(row => (
                <div key={row.label}>
                  <div style={{ color: '#555', fontSize: 11, marginBottom: 4 }}>{row.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: '7px 10px', fontSize: row.mono ? 11 : 13, color: '#aaa', fontFamily: row.mono ? 'Space Mono, monospace' : 'inherit', flex: 1, wordBreak: 'break-all' }}>
                      {row.value}
                    </div>
                    {row.mono && (
                      <button onClick={() => navigator.clipboard.writeText(row.value)}
                        style={{ background: '#111', border: '1px solid #222', borderRadius: 6, padding: '6px 10px', color: '#555', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>
                        📋
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Chrysalis status */}
              <div style={{ background: '#0a1a0a', border: '1px solid #1e3a1e', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#39ff14', fontSize: 16 }}>⬡</span>
                  <div>
                    <div style={{ color: '#39ff14', fontWeight: 700, fontSize: 13 }}>CHRYSALIS PROTECTED</div>
                    <div style={{ color: '#555', fontSize: 11 }}>ML-DSA-65 + ML-KEM-768 + CAS-φ active</div>
                  </div>
                </div>
              </div>

              {/* Logout */}
              <button onClick={onLogout}
                style={{ background: 'none', border: '1px solid #ff4444', borderRadius: 8, padding: '10px 0', color: '#ff4444', cursor: 'pointer', fontWeight: 600, fontSize: 14, marginTop: 4 }}>
                🚪 Log Out
              </button>
            </div>
          )}

          {/* Backup / Recovery tab */}
          {tab === 'backup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: '#1a0a00', border: '1px solid #ff6b00', borderRadius: 10, padding: 14 }}>
                <div style={{ color: '#ff6b00', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>⚠️ Keep this secret</div>
                <p style={{ color: '#aaa', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                  Your recovery phrase gives full access to your wallet. Never share it. Store it offline in a safe place. Losing it means losing access to your funds.
                </p>
              </div>

              {!isAuthUser ? (
                <p style={{ color: '#555', fontSize: 13, textAlign: 'center' }}>
                  Recovery phrase is stored in your HIVE Wallet extension. Open the extension → Settings to view it.
                </p>
              ) : bpStatus === 'shown' && bpPhrase ? (
                <div>
                  <div style={{ color: '#aaa', fontSize: 12, marginBottom: 10 }}>Your Recovery Phrase ({phraseGroups.length} groups of 4 hex chars):</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                    {phraseGroups.map((chunk, i) => (
                      <div key={i} style={{ background: '#0a1a0a', border: '1px solid #1e3a1e', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                        <div style={{ color: '#555', fontSize: 9, marginBottom: 2 }}>{i + 1}</div>
                        <div style={{ color: '#39ff14', fontFamily: 'Space Mono, monospace', fontSize: 13, fontWeight: 700 }}>{chunk}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(bpPhrase)}
                    style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, padding: '8px 0', color: '#aaa', cursor: 'pointer', fontSize: 13, marginBottom: 8 }}>
                    📋 Copy All
                  </button>
                  <button onClick={() => { setBpPhrase(null); setBpStatus('idle'); _setBpRevealed(false); }}
                    style={{ width: '100%', background: 'none', border: '1px solid #333', borderRadius: 8, padding: '8px 0', color: '#555', cursor: 'pointer', fontSize: 12 }}>
                    🙈 Hide
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ color: '#aaa', fontSize: 13, marginBottom: 10 }}>Enter your password to reveal your recovery phrase:</div>
                  <input
                    type="password" value={bpPassword} onChange={e => setBpPassword(e.target.value)}
                    placeholder="Your account password"
                    onKeyDown={e => e.key === 'Enter' && handleRevealBackup()}
                    style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '10px 12px', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', outline: 'none' }}
                  />
                  {bpStatus === 'error' && <p style={{ color: '#ff4444', fontSize: 13, marginBottom: 8 }}>{bpError}</p>}
                  <button onClick={handleRevealBackup} disabled={!bpPassword || bpStatus === 'loading'}
                    style={{ width: '100%', background: bpPassword ? '#f5b429' : '#222', border: 'none', borderRadius: 8, padding: '10px 0', color: bpPassword ? '#000' : '#555', fontWeight: 700, cursor: bpPassword ? 'pointer' : 'not-allowed', fontSize: 14 }}>
                    {bpStatus === 'loading' ? '🔓 Decrypting…' : '🔑 Reveal Recovery Phrase'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Security tab */}
          {tab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 10, padding: 16 }}>
                <h4 style={{ color: '#fff', margin: '0 0 12px', fontSize: 14 }}>🔐 Cryptography</h4>
                {[
                  ['Signature Algorithm', 'ML-DSA-65 (Dilithium, NIST FIPS 204)'],
                  ['Key Encapsulation', 'ML-KEM-768 (Kyber, NIST FIPS 203)'],
                  ['Key Derivation', 'PBKDF2-HMAC-SHA256 (310,000 rounds)'],
                  ['Secret Storage', 'AES-256-GCM encrypted at rest'],
                  ['Recovery Shards', 'CAS-φ (golden ratio sharding)'],
                  ['Session Keys', 'SHA-256(token) — zero knowledge'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #111', fontSize: 12 }}>
                    <span style={{ color: '#555' }}>{label}</span>
                    <span style={{ color: '#39ff14', fontWeight: 600, textAlign: 'right', maxWidth: '55%' }}>{value}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 10, padding: 16 }}>
                <h4 style={{ color: '#fff', margin: '0 0 12px', fontSize: 14 }}>🛡️ Post-Quantum Security</h4>
                <p style={{ color: '#555', fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                  Your HIVE wallet uses NIST-standardized post-quantum cryptography algorithms that are resistant to attacks from both classical and quantum computers. Your keys are safe against future quantum threats.
                </p>
              </div>

              <button onClick={onLogout}
                style={{ background: 'none', border: '1px solid #ff4444', borderRadius: 8, padding: '10px 0', color: '#ff4444', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                🚪 Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Send Modal ────────────────────────────────────────────────────────────────

function SendModal({ wallet, balance, isAuthUser, authToken, onClose, onSuccess }: {
  wallet: string; balance: number; isAuthUser: boolean; authToken: string | null;
  onClose: () => void; onSuccess: () => void;
}) {
  const [to, setTo]         = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [showScan, setShowScan] = useState(false);
  const [addressBook, setAddressBook] = useState<AddrBookEntry[]>([]);

  useEffect(() => { setAddressBook(loadAddressBook()); }, []);

  const amt = parseFloat(amount) || 0;
  const serviceFee = amt > 0 ? expectedServiceFee(amt) : 0;
  const gasFee = 0.0001;
  const totalCost = amt + serviceFee + gasFee;
  const hasEnough = balance >= totalCost && amt > 0;

  async function handleSend() {
    if (!hasEnough) return;
    setStatus('pending');
    try {
      // 1. Get account nonce
      const acctResp = await fetch(`${API_BASE}/account/${wallet}`);
      if (!acctResp.ok) throw new Error('Failed to fetch account');
      const acct = await acctResp.json();

      // 2. Get chain params
      const statusResp = await fetch(`${API_BASE}/status`);
      const chainStatus = statusResp.ok ? await statusResp.json() : { chainId: '1', minGasFee: gasFee };
      const chainId = String(chainStatus.chainId || '1');
      const actualGasFee = Math.max(gasFee, chainStatus.minGasFee || gasFee);

      const nonce = acct.nonce ?? 0;
      const timestamp = Date.now();
      const expiresAtMs = timestamp + TX_TTL_MS;
      const svcFee = expectedServiceFee(amt);

      // 3. Build canonical message
      const msg = canonicalSignedMessage({ chainId, type: 'send', from: wallet, to, amount: amt, nonce, gasFee: actualGasFee, serviceFee: svcFee, expiresAtMs, timestamp });

      // 4. Sign
      let sig: SigResult;
      if (isAuthUser && authToken) {
        sig = await platformSign(msg, authToken);
      } else {
        const ext = getHiveExt();
        if (!ext?.sign) throw new Error('HIVE Wallet extension not detected');
        const r = await ext.sign(msg);
        sig = { signatureHex: r.signatureHex, mldsaPubKeyHex: r.publicKeyHex, wallet: r.address };
      }

      // 5. POST /send
      const sendResp = await fetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sig.wallet, to, amount: amt, nonce, timestamp, signatureHex: sig.signatureHex, gasFee: actualGasFee, serviceFee: svcFee, expiresAtMs, chainId }),
      });
      if (!sendResp.ok) {
        const e = await sendResp.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error || 'Send failed');
      }
      setStatus('success');
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (e: unknown) {
      setStatus('error');
      setErrMsg((e as Error).message || 'Send failed');
    }
  }

  if (showScan) {
    return <QRScanner onScan={addr => { setTo(addr); setShowScan(false); }} onClose={() => setShowScan(false)} />;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
      <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 16, padding: 28, maxWidth: 460, width: '90%', position: 'relative', marginBottom: 24 }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
        <h3 style={{ color: '#39ff14', marginBottom: 20 }}>↗ Send HNY</h3>

        {/* To address */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>Recipient Address</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={to} onChange={e => setTo(e.target.value)} placeholder="HNY_…"
              style={{ flex: 1, background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '10px 12px', fontSize: 13, outline: 'none' }}
            />
            <button onClick={() => setShowScan(true)}
              style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '0 12px', color: '#39ff14', cursor: 'pointer', fontSize: 18 }}
              title="Scan QR">⬡</button>
          </div>

          {/* Address book quick-select */}
          {addressBook.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {addressBook.map(e => (
                <button key={e.address} onClick={() => setTo(e.address)}
                  style={{ background: '#111', border: '1px solid #333', borderRadius: 6, padding: '3px 10px', color: '#aaa', fontSize: 11, cursor: 'pointer' }}>
                  {e.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Amount */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>Amount (HNY)</div>
          <input
            value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00"
            style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {[10, 25, 50, 100].map(pct => (
              <button key={pct} onClick={() => setAmount(((balance * pct) / 100 / 1.001).toFixed(4))}
                style={{ flex: 1, background: '#111', border: '1px solid #222', borderRadius: 6, color: '#666', fontSize: 11, padding: '4px 0', cursor: 'pointer' }}>
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Fee breakdown */}
        {amt > 0 && (
          <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 12 }}>
            {[
              ['Amount', `${fmt8(amt)} HNY`],
              ['Gas Fee', `${fmt8(gasFee)} HNY`],
              ['Service Fee', `${fmt8(serviceFee)} HNY`],
              ['Total', `${fmt8(totalCost)} HNY`],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#555' }}>{label}</span>
                <span style={{ color: label === 'Total' ? '#39ff14' : '#fff', fontWeight: label === 'Total' ? 700 : 400 }}>{value}</span>
              </div>
            ))}
          </div>
        )}

        {status === 'error' && <p style={{ color: '#ff4444', fontSize: 13, marginBottom: 10 }}>{errMsg}</p>}
        {status === 'success' && <p style={{ color: '#39ff14', fontWeight: 700, marginBottom: 10 }}>✓ Transaction queued!</p>}
        {status === 'pending' && <p style={{ color: '#39ff14', fontSize: 13, marginBottom: 10 }}>⬡ Chrysalis signing…</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, background: 'none', border: '1px solid #333', borderRadius: 8, padding: '10px 0', color: '#aaa', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSend} disabled={!hasEnough || status === 'pending' || status === 'success'}
            style={{ flex: 2, background: hasEnough ? '#39ff14' : '#222', border: 'none', borderRadius: 8, padding: '10px 0', color: hasEnough ? '#000' : '#555', fontWeight: 700, cursor: hasEnough && status === 'idle' ? 'pointer' : 'not-allowed' }}>
            {status === 'pending' ? '⬡ Signing…' : status === 'success' ? '✓ Sent!' : '↗ Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Wallet Page ───────────────────────────────────────────────────────────

export default function WalletPage() {
  const { address: wallet, isAuthUser, authUser, disconnect } = useHiveWallet();
  const authToken = authUser?.token ?? null;

  const [balance, setBalance]     = useState(0);
  const [hnyUsd, setHnyUsd]       = useState(HNY_PRICE_USD);
  const [txHistory, setTxHistory] = useState<{ id: string; type: string; from: string; to: string; amount: number; status: string; createdAt: number }[]>([]);
  const [loading, setLoading]     = useState(false);

  // Modal state
  const [showSend, setShowSend]         = useState(false);
  const [showReceive, setShowReceive]   = useState(false);
  const [showAddrBook, setShowAddrBook] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Address book
  const [addrBook, setAddrBook]     = useState<AddrBookEntry[]>([]);
  const [newLabel, setNewLabel]     = useState('');
  const [newAddr, setNewAddr]       = useState('');

  useEffect(() => { setAddrBook(loadAddressBook()); }, []);

  const loadData = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const [acctResp, txResp] = await Promise.all([
        fetch(`${API_BASE}/account/${wallet}`),
        fetch(`${API_BASE}/transactions/${wallet}?limit=20`),
      ]);
      if (acctResp.ok) {
        const d = await acctResp.json();
        setBalance(Number(d.balance ?? 0));
      }
      if (txResp.ok) {
        const d = await txResp.json();
        const txs = Array.isArray(d) ? d : (d.transactions || d.txs || []);
        setTxHistory(txs.slice(0, 20));
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { const id = setInterval(loadData, 15_000); return () => clearInterval(id); }, [loadData]);

  function addToBook() {
    if (!newLabel.trim() || !newAddr.trim()) return;
    const updated = [...addrBook, { label: newLabel.trim(), address: newAddr.trim() }];
    setAddrBook(updated);
    saveAddressBook(updated);
    setNewLabel(''); setNewAddr('');
  }
  function removeFromBook(addr: string) {
    const updated = addrBook.filter(e => e.address !== addr);
    setAddrBook(updated);
    saveAddressBook(updated);
  }

  if (!wallet) {
    return (
      <div style={{ minHeight: '100vh', background: '#040507', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Space Grotesk, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🐝</div>
          <h2 style={{ color: '#39ff14', margin: '0 0 8px' }}>Connect your wallet</h2>
          <p style={{ color: '#555' }}>Sign in to view your HIVE wallet</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#040507', color: '#e0e0e0', fontFamily: 'Space Grotesk, sans-serif', padding: '92px 16px 40px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#39ff14', letterSpacing: -1, margin: '0 0 4px' }}>⬡ My Wallet</h1>
            <p style={{ color: '#555', margin: 0, fontSize: 13 }}>
              {isAuthUser ? 'Platform account · native Chrysalis signing' : 'Extension wallet connected'}
            </p>
          </div>
          <button onClick={() => setShowSettings(true)}
            style={{ background: '#111', border: '1px solid #333', borderRadius: 10, padding: '10px 14px', color: '#aaa', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
            title="Wallet Settings">⚙️</button>
        </div>

        {/* Balance card */}
        <div style={{ background: 'linear-gradient(135deg, #0a1a0a 0%, #1a2e0a 50%, #0a1a0a 100%)', border: '1px solid #1e3a1e', borderRadius: 16, padding: 28, marginBottom: 20 }}>
          <div style={{ color: '#555', fontSize: 13, marginBottom: 8 }}>Total Balance</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
            <span style={{ fontSize: 42, fontWeight: 800, color: '#39ff14' }}>{balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
            <span style={{ fontSize: 18, color: '#39ff14', opacity: 0.7 }}>HNY</span>
          </div>
          <div style={{ color: '#555', fontSize: 14 }}>≈ ${(balance * hnyUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</div>

          {/* Address pill */}
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '6px 12px', fontSize: 11, color: '#aaa', fontFamily: 'Space Mono, monospace', wordBreak: 'break-all' }}>
              {wallet}
            </div>
            <button onClick={() => navigator.clipboard.writeText(wallet)}
              style={{ background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 8px', color: '#555', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
              title="Copy address">📋</button>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={() => setShowSend(true)}
              style={{ flex: 1, background: '#39ff14', border: 'none', borderRadius: 10, padding: '12px 0', color: '#000', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              ↗ Send
            </button>
            <button onClick={() => setShowReceive(true)}
              style={{ flex: 1, background: '#111', border: '1px solid #39ff14', borderRadius: 10, padding: '12px 0', color: '#39ff14', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              ↙ Receive
            </button>
            <button onClick={() => setShowAddrBook(true)}
              style={{ background: '#111', border: '1px solid #333', borderRadius: 10, padding: '12px 16px', color: '#aaa', cursor: 'pointer', fontSize: 18 }}
              title="Address Book">📒</button>
          </div>
        </div>

        {/* Transaction history */}
        <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2a1e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: 15 }}>Recent Transactions</h3>
            <button onClick={loadData} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16 }} title="Refresh">↻</button>
          </div>

          {loading && txHistory.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#555' }}>Loading…</div>
          ) : txHistory.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#555' }}>No transactions yet</div>
          ) : (
            txHistory.map(tx => {
              const isSend = tx.from === wallet;
              const sign = isSend ? '-' : '+';
              const color = isSend ? '#ff6b6b' : '#39ff14';
              const counterpart = isSend ? tx.to : tx.from;
              const label = tx.type === 'send' ? (isSend ? '↗ Sent' : '↙ Received') : tx.type;
              return (
                <div key={tx.id} style={{ padding: '14px 20px', borderBottom: '1px solid #0d1a0d', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: isSend ? '#1a0a0a' : '#0a1a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                    {isSend ? '↗' : '↙'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{label}</div>
                    <div style={{ color: '#555', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isSend ? 'To: ' : 'From: '}{counterpart}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ color, fontWeight: 700, fontSize: 14 }}>{sign}{Number(tx.amount).toFixed(4)} HNY</div>
                    <div style={{ color: '#555', fontSize: 11, textTransform: 'capitalize' }}>{tx.status}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Send modal */}
      {showSend && (
        <SendModal
          wallet={wallet} balance={balance}
          isAuthUser={isAuthUser} authToken={authToken}
          onClose={() => setShowSend(false)}
          onSuccess={loadData}
        />
      )}

      {/* Receive modal */}
      {showReceive && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0d1117', border: '1px solid #39ff14', borderRadius: 16, padding: 36, maxWidth: 400, width: '90%', position: 'relative', textAlign: 'center' }}>
            <button onClick={() => setShowReceive(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
            <h3 style={{ color: '#39ff14', marginBottom: 24 }}>↙ Receive HNY</h3>
            <HexQR value={wallet} size={200} />
            <div style={{ marginTop: 20 }}>
              <button onClick={() => navigator.clipboard.writeText(wallet)}
                style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '8px 20px', color: '#aaa', cursor: 'pointer', fontSize: 13 }}>
                📋 Copy Address
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Address Book modal */}
      {showAddrBook && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, overflowY: 'auto' }}>
          <div style={{ background: '#0d1117', border: '1px solid #333', borderRadius: 16, padding: 28, maxWidth: 460, width: '90%', position: 'relative', marginBottom: 24 }}>
            <button onClick={() => setShowAddrBook(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>✕</button>
            <h3 style={{ color: '#fff', marginBottom: 20 }}>📒 Address Book</h3>

            {/* Add new */}
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>Add Address</div>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (e.g. Alice)"
                style={{ display: 'block', width: '100%', background: '#0d1117', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 10px', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
              <input value={newAddr} onChange={e => setNewAddr(e.target.value)} placeholder="HNY_…"
                style={{ display: 'block', width: '100%', background: '#0d1117', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '8px 10px', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
              <button onClick={addToBook} disabled={!newLabel.trim() || !newAddr.trim()}
                style={{ background: '#39ff14', border: 'none', borderRadius: 8, padding: '8px 20px', color: '#000', fontWeight: 700, cursor: newLabel.trim() && newAddr.trim() ? 'pointer' : 'not-allowed', opacity: newLabel.trim() && newAddr.trim() ? 1 : 0.4 }}>
                + Add
              </button>
            </div>

            {/* Entries */}
            {addrBook.length === 0 ? (
              <p style={{ color: '#555', textAlign: 'center', fontSize: 13 }}>No saved addresses yet.</p>
            ) : (
              addrBook.map(e => (
                <div key={e.address} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{e.label}</div>
                    <div style={{ color: '#555', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.address}</div>
                  </div>
                  <button onClick={() => { setShowSend(true); setShowAddrBook(false); }}
                    style={{ background: '#0a1a0a', border: '1px solid #1e3a1e', borderRadius: 6, padding: '4px 10px', color: '#39ff14', fontSize: 11, cursor: 'pointer' }}>
                    Send
                  </button>
                  <button onClick={() => removeFromBook(e.address)}
                    style={{ background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 8px', color: '#ff6b6b', fontSize: 11, cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Wallet Settings modal */}
      {showSettings && (
        <WalletSettings
          wallet={wallet}
          isAuthUser={isAuthUser}
          authToken={authToken}
          authUser={authUser}
          onClose={() => setShowSettings(false)}
          onLogout={() => { disconnect(); setShowSettings(false); }}
        />
      )}
    </div>
  );
}
