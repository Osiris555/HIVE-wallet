'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { authRegister, authLogin, authMe, authLogout } from '@/lib/api';
import type { AuthUser } from '@/lib/types';

const STORAGE_KEY      = 'hive_connected_address';
const AUTH_TOKEN_KEY   = 'hive_auth_token';
const AUTH_USER_KEY    = 'hive_auth_user';

type HiveWalletCtx = {
  address:    string | null;
  authUser:   AuthUser | null;
  isAuthUser: boolean;
  connect:    (addr: string) => void;
  connectAuth: (user: AuthUser) => void;
  disconnect: () => void;
};

const HiveWalletContext = createContext<HiveWalletCtx>({
  address: null, authUser: null, isAuthUser: false,
  connect: () => {}, connectAuth: () => {}, disconnect: () => {},
});

export function HiveWalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress]   = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    // Restore extension/manual connection
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { setAddress(stored); return; }
    // Restore auth session
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      authMe(token)
        .then(user => { setAuthUser(user); setAddress(user.wallet); })
        .catch(() => { localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.removeItem(AUTH_USER_KEY); });
    }
  }, []);

  const connect = (addr: string) => {
    localStorage.setItem(STORAGE_KEY, addr);
    setAddress(addr);
  };

  const connectAuth = (user: AuthUser) => {
    localStorage.setItem(AUTH_TOKEN_KEY, user.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    setAuthUser(user);
    setAddress(user.wallet);
  };

  const disconnect = () => {
    // Auth logout
    if (authUser) {
      authLogout(authUser.token).catch(() => {});
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
      setAuthUser(null);
    }
    localStorage.removeItem(STORAGE_KEY);
    setAddress(null);
  };

  return (
    <HiveWalletContext.Provider value={{ address, authUser, isAuthUser: !!authUser, connect, connectAuth, disconnect }}>
      {children}
    </HiveWalletContext.Provider>
  );
}

export function useHiveWallet() {
  return useContext(HiveWalletContext);
}

// Detect the injected window.hive extension provider
function getHiveExtension(): { requestAccounts: () => Promise<string[]> } | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const h = w['hive'] as { isHive?: boolean; requestAccounts?: () => Promise<string[]> } | undefined;
  if (h?.isHive && typeof h.requestAccounts === 'function') return h as { requestAccounts: () => Promise<string[]> };
  return null;
}

// ── Tab types ─────────────────────────────────────────────────────────────
type Tab = 'extension' | 'account' | 'manual';
type AuthMode = 'login' | 'register';

export default function HiveWalletConnect() {
  const { address, connect, connectAuth, disconnect } = useHiveWallet();
  const [open, setOpen]               = useState(false);
  const [tab, setTab]                 = useState<Tab>('extension');
  const [hasExtension, setHasExtension] = useState(false);
  const [mounted, setMounted]         = useState(false);

  // Extension tab state
  const [connecting, setConnecting]   = useState(false);
  const [extError, setExtError]       = useState('');

  // Account tab state
  const [authMode, setAuthMode]       = useState<AuthMode>('login');
  const [emailOrPhone, setEoP]        = useState('');
  const [password, setPassword]       = useState('');
  const [displayName, setDN]          = useState('');
  const [authError, setAuthError]     = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  // Shown once after successful registration
  const [backupPhrase, setBackupPhrase] = useState<string | null>(null);

  // Manual tab state
  const [input, setInput]             = useState('');
  const [manualError, setManualError] = useState('');

  // Mount flag: createPortal requires document to exist (SSR safety)
  useEffect(() => setMounted(true), []);

  // Check for extension after hydration
  useEffect(() => {
    const check = () => {
      const hasExt = !!getHiveExtension();
      setHasExtension(hasExt);
      if (hasExt) setTab('extension');
    };
    check();
    window.addEventListener('hive#initialized', check, { once: true });
    return () => window.removeEventListener('hive#initialized', check);
  }, []);

  // Auto-focus to account tab if no extension
  useEffect(() => {
    if (open && !hasExtension) setTab('account');
  }, [open, hasExtension]);

  // ── Extension connect ──────────────────────────────────────────────────
  async function connectViaExtension() {
    const ext = getHiveExtension();
    if (!ext) return;
    setConnecting(true); setExtError('');
    try {
      const accounts = await ext.requestAccounts();
      if (accounts?.[0]) { connect(accounts[0]); setOpen(false); }
      else setExtError('No accounts returned by extension');
    } catch (e) {
      setExtError(e instanceof Error ? e.message : 'Extension request failed');
    } finally { setConnecting(false); }
  }

  // ── Auth register / login ─────────────────────────────────────────────
  async function handleAuth() {
    setAuthError(''); setAuthLoading(true);
    try {
      const trimmed = emailOrPhone.trim();
      const isEmail = trimmed.includes('@');
      const email   = isEmail ? trimmed : null;
      const phone   = !isEmail ? trimmed : null;

      if (!trimmed) { setAuthError('Email or phone number is required'); return; }
      if (!password || password.length < 8) { setAuthError('Password must be at least 8 characters'); return; }

      let user: AuthUser;
      if (authMode === 'register') {
        const result = await authRegister(email, phone, password, displayName || undefined) as AuthUser & { backupPhrase?: string };
        user = result;
        if (result.backupPhrase) { setBackupPhrase(result.backupPhrase); }
      } else {
        user = await authLogin(email, phone, password);
      }
      connectAuth(user);
      if (!backupPhrase) setOpen(false);
      setPassword(''); setEoP(''); setDN('');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Authentication failed');
    } finally { setAuthLoading(false); }
  }

  // ── Manual address connect ────────────────────────────────────────────
  function handleManualConnect() {
    const trimmed = input.trim();
    if (!trimmed.startsWith('HNY_') || trimmed.length < 44) {
      setManualError('Enter a valid HNY_ address (starts with HNY_)');
      return;
    }
    connect(trimmed); setOpen(false); setInput(''); setManualError('');
  }

  const truncate = (addr: string) => `${addr.slice(0, 8)}…${addr.slice(-6)}`;

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="font-mono-hive text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer"
          style={{ background: 'var(--glass2)', border: '1px solid var(--border)', color: 'var(--green)' }}
          onClick={() => disconnect()}
          title="Click to disconnect"
        >
          <span className="w-2 h-2 rounded-full bg-[var(--green)] inline-block" />
          {truncate(address)}
        </span>
      </div>
    );
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px 4px', fontSize: 12, fontWeight: active ? 700 : 400,
    background: active ? 'rgba(57,255,20,0.1)' : 'none',
    border: 'none', borderBottom: active ? '2px solid var(--green)' : '2px solid transparent',
    color: active ? 'var(--green)' : 'var(--sub)', cursor: 'pointer', transition: 'all 0.15s',
  });

  // ── Backup-phrase modal (shown once after registration) ──────────────────
  const backupModal = backupPhrase && mounted ? createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#0d1117', border: '2px solid var(--gold)', borderRadius: 18, padding: 28, maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40 }}>🔑</div>
          <h2 style={{ color: 'var(--gold)', margin: '8px 0 4px' }}>Save Your Recovery Phrase</h2>
          <p style={{ color: 'var(--sub)', fontSize: 13, margin: 0 }}>Write this down and store it somewhere safe. It cannot be shown again.</p>
        </div>
        <div style={{ background: 'rgba(245,180,41,0.08)', border: '1px solid rgba(245,180,41,0.3)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <p style={{ color: 'var(--sub)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 10px' }}>⚠ Never share this — store it offline</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {backupPhrase.split('-').map((chunk, i) => (
              <div key={i} style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ color: '#555', fontSize: 9, marginBottom: 2 }}>{i + 1}</div>
                <div style={{ color: 'var(--gold)', fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{chunk}</div>
              </div>
            ))}
          </div>
        </div>
        <p style={{ color: '#555', fontSize: 11, textAlign: 'center', marginBottom: 16 }}>
          This 128-bit recovery key is your wallet backup. Keep it secret, keep it safe.
        </p>
        <button
          onClick={() => { setBackupPhrase(null); setOpen(false); }}
          style={{ width: '100%', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          I&apos;ve written it down — Continue →
        </button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button className="btn-outline text-sm" onClick={() => setOpen(true)}>
        🐝 Connect HIVE
      </button>

      {backupModal}

      {open && mounted && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, paddingTop: 80, overflowY: 'auto' }}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="glass-card p-6 w-full max-w-md" style={{ background: 'var(--bg2)', marginBottom: 16 }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg" style={{ color: 'var(--gold)' }}>Connect HIVE Wallet</h2>
              <button onClick={() => { setOpen(false); setExtError(''); setAuthError(''); setManualError(''); }}
                className="text-2xl opacity-50 hover:opacity-100">×</button>
            </div>

            {/* Tabs */}
            <div className="flex mb-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <button style={tabStyle(tab === 'extension')} onClick={() => setTab('extension')}>
                🍯 Extension
              </button>
              <button style={tabStyle(tab === 'account')} onClick={() => setTab('account')}>
                👤 Account
              </button>
              <button style={tabStyle(tab === 'manual')} onClick={() => setTab('manual')}>
                🔑 Manual
              </button>
            </div>

            {/* ── Extension Tab ── */}
            {tab === 'extension' && (
              <>
                {hasExtension ? (
                  <>
                    <div className="rounded-xl p-4 mb-4 flex items-center gap-3"
                      style={{ background: 'rgba(57,255,20,0.06)', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 28 }}>🍯</span>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--green)' }}>HIVE Wallet Extension</p>
                        <p className="text-xs" style={{ color: 'var(--sub)' }}>Extension detected · Chrysalis-signed connect</p>
                      </div>
                    </div>
                    {extError && <p className="text-xs mb-2" style={{ color: 'var(--danger)' }}>{extError}</p>}
                    <button className="btn-green w-full justify-center mb-3" onClick={connectViaExtension} disabled={connecting}>
                      {connecting ? '⬡ Authorising…' : '⬡ Connect with Extension'}
                    </button>
                    <p className="text-xs text-center" style={{ color: 'var(--sub)' }}>
                      A Chrysalis confirmation will appear in your extension popup.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="rounded-xl p-4 mb-4 flex items-center gap-3"
                      style={{ background: 'rgba(245,180,41,0.06)', border: '1px solid rgba(245,180,41,0.2)' }}>
                      <span style={{ fontSize: 28 }}>🔌</span>
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--gold)' }}>Extension Not Detected</p>
                        <p className="text-xs" style={{ color: 'var(--sub)' }}>Install the HIVE Wallet Chrome extension for one-click signing</p>
                      </div>
                    </div>
                    <a href="http://localhost:3001" target="_blank" rel="noreferrer"
                      className="btn-outline w-full justify-center text-sm flex items-center gap-2 mb-3"
                      style={{ textDecoration: 'none', display: 'flex' }}>
                      Download HIVE Wallet →
                    </a>
                    <p className="text-xs text-center" style={{ color: 'var(--sub)' }}>
                      Or use the <strong style={{ color: 'var(--text)' }}>Account</strong> or <strong style={{ color: 'var(--text)' }}>Manual</strong> tabs below.
                    </p>
                  </>
                )}
              </>
            )}

            {/* ── Account Tab ── */}
            {tab === 'account' && (
              <>
                {/* Login / Register toggle */}
                <div className="flex rounded-xl overflow-hidden mb-4" style={{ border: '1px solid var(--border)' }}>
                  <button
                    onClick={() => { setAuthMode('login'); setAuthError(''); }}
                    style={{ flex: 1, padding: '9px', fontSize: 13, fontWeight: authMode === 'login' ? 700 : 400,
                      background: authMode === 'login' ? 'rgba(57,255,20,0.1)' : 'none',
                      color: authMode === 'login' ? 'var(--green)' : 'var(--sub)', border: 'none', cursor: 'pointer' }}>
                    Sign In
                  </button>
                  <button
                    onClick={() => { setAuthMode('register'); setAuthError(''); }}
                    style={{ flex: 1, padding: '9px', fontSize: 13, fontWeight: authMode === 'register' ? 700 : 400,
                      background: authMode === 'register' ? 'rgba(57,255,20,0.1)' : 'none',
                      color: authMode === 'register' ? 'var(--green)' : 'var(--sub)', border: 'none', cursor: 'pointer',
                      borderLeft: '1px solid var(--border)' }}>
                    Create Account
                  </button>
                </div>

                {authMode === 'register' && (
                  <div className="mb-3">
                    <input type="text" placeholder="Display name (optional)"
                      value={displayName} onChange={e => setDN(e.target.value)}
                      className="w-full p-3 rounded-xl text-sm mb-2"
                      style={{ background: 'var(--glass)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }} />
                  </div>
                )}

                <input type="text" placeholder="Email or phone number"
                  value={emailOrPhone} onChange={e => { setEoP(e.target.value); setAuthError(''); }}
                  className="w-full p-3 rounded-xl text-sm mb-2"
                  style={{ background: 'var(--glass)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
                  onKeyDown={e => e.key === 'Enter' && handleAuth()} />

                <input type="password" placeholder="Password (min 8 characters)"
                  value={password} onChange={e => { setPassword(e.target.value); setAuthError(''); }}
                  className="w-full p-3 rounded-xl text-sm mb-2"
                  style={{ background: 'var(--glass)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
                  onKeyDown={e => e.key === 'Enter' && handleAuth()} />

                {authError && <p className="text-xs mb-2" style={{ color: 'var(--danger)' }}>{authError}</p>}

                <button className="btn-green w-full justify-center" onClick={handleAuth} disabled={authLoading}>
                  {authLoading ? '⬡ …' : authMode === 'register' ? '🐝 Create Account' : '🔑 Sign In'}
                </button>

                <div className="mt-3 p-3 rounded-xl" style={{ background: 'rgba(57,255,20,0.04)', border: '1px solid var(--border)' }}>
                  <p className="text-xs" style={{ color: 'var(--sub)', lineHeight: 1.6 }}>
                    ⬡ A native HNY wallet is created automatically.<br />
                    Chrysalis post-quantum security is applied to your account.<br />
                    Queen Bee AI monitors your activity in real-time.
                  </p>
                </div>
              </>
            )}

            {/* ── Manual Tab ── */}
            {tab === 'manual' && (
              <>
                <p className="text-sm mb-3" style={{ color: 'var(--sub)' }}>
                  Enter your HNY wallet address for <strong style={{ color: 'var(--text)' }}>read-only</strong> access. Transactions require the browser extension.
                </p>
                <input type="text" placeholder="HNY_abc123..."
                  value={input} onChange={e => { setInput(e.target.value); setManualError(''); }}
                  className="w-full p-3 rounded-xl text-sm font-mono-hive mb-2"
                  style={{ background: 'var(--glass)', border: '1px solid var(--border2)', color: 'var(--text)', outline: 'none' }}
                  onKeyDown={e => e.key === 'Enter' && handleManualConnect()} />
                {manualError && <p className="text-xs mb-2" style={{ color: 'var(--danger)' }}>{manualError}</p>}
                <button className="btn-outline w-full justify-center" onClick={handleManualConnect}>
                  Connect with Address
                </button>
              </>
            )}

            <p className="text-xs mt-4 text-center" style={{ color: 'var(--sub)' }}>
              Don&apos;t have HIVE Wallet?{' '}
              <a href="http://localhost:3001" target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>
                Download the mobile app →
              </a>
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
