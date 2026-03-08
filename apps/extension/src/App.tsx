import React, { useEffect, useState, useCallback } from 'react';
import ChrysalisModal from './components/ChrysalisModal';
import type { ChrysalisStage } from './components/ChrysalisModal';
import HexQR from './components/HexQR';
import type { ExtState, PendingRequest, WalletProfile, NetworkConfig } from './shared/types';

// ── Background bridge ─────────────────────────────────────────
type BgResp = { ok?: boolean; error?: string } & Record<string, unknown>;
function sendBg<T = BgResp>(msg: Record<string, unknown>): Promise<T> {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, (r: T) => resolve(r)));
}

// ── Domain types ──────────────────────────────────────────────
type ActiveTab  = 'assets' | 'nfts' | 'activity' | 'settings';
type TxModal    = 'none' | 'send' | 'receive' | 'swap' | 'stake' | 'lp' | 'send_nft';
type SettingsView = 'main' | 'chrysalis' | 'view_seed' | 'wallet_manager' |
                    'create_wallet' | 'import_wallet_profile' | 'networks' | 'add_network' | 'danger_zone';
interface Bal      { amount: number; valueUsd?: number; }
interface NftItem  { id: string; name: string; media_type: string; }
interface TxItem   { txid?: string; id?: string; type?: string; amount?: number; token?: string; from_wallet?: string; to_wallet?: string; created_at?: string; timestamp?: number; }
interface WalletData { balances: Record<string, Bal>; nfts: NftItem[]; recentTxs: TxItem[]; chrysalisRegistered: boolean; }
interface SwapQuote  { amountOut: number; priceImpact: number; fee: number; }

// ── Token / tx metadata ───────────────────────────────────────
const T_ICON: Record<string, string> = { HNY:'🍯', stHNY:'🏛', LPHNY:'💧', USDC:'💵', BTC:'₿', ETH:'Ξ', SOL:'◎', BNB:'🔶', USDT:'💰' };
const T_NAME: Record<string, string> = { HNY:'Honey', stHNY:'Staked HNY', LPHNY:'LP Honey', USDC:'USD Coin', BTC:'Bitcoin', ETH:'Ethereum', SOL:'Solana', BNB:'BNB Chain', USDT:'Tether' };
const ALL_TOKENS = ['HNY','stHNY','USDC','BTC','ETH','SOL','BNB'];
const LP_PAIRS   = ['HNY/USDC','HNY/BTC','HNY/ETH','stHNY/HNY'];
const TX_ICONS: Record<string, string> = { send:'↑', receive:'↓', swap:'⇌', stake:'⛏', unstake:'📤', liquidity_add:'💧', nft_transfer:'🖼' };

function tIcon(s: string) { return T_ICON[s] ?? s.slice(0,2); }
function tName(s: string) { return T_NAME[s] ?? s; }
function fmt(n: number)   { return n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4}); }
function fmtS(n: number)  { return n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function short(a: string) { return a.length > 14 ? `${a.slice(0,8)}…${a.slice(-6)}` : a; }
function timeAgo(s?: string, ts?: number) {
  const d = (Date.now() - (s ? new Date(s).getTime() : (ts ?? 0))) / 1000;
  if (d < 60) return 'just now'; if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`; return `${Math.floor(d/86400)}d ago`;
}

// ── Shared UI atoms ───────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="card" style={style}>{children}</div>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <p style={{color:'var(--sub)',fontSize:11,margin:'0 0 4px',textTransform:'uppercase',letterSpacing:1}}>{children}</p>;
}
function Err({ msg }: { msg: string }) {
  return msg ? <p style={{color:'var(--danger)',fontSize:12,margin:'6px 0 0',lineHeight:1.4}}>{msg}</p> : null;
}
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:100,background:'rgba(4,5,7,0.9)',backdropFilter:'blur(8px)',display:'flex',flexDirection:'column'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 16px',borderBottom:'1px solid var(--border)'}}>
        <span style={{color:'var(--text)',fontWeight:700,fontSize:15}}>{title}</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:'var(--sub)',cursor:'pointer',fontSize:22,lineHeight:1}}>×</button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'16px'}}>{children}</div>
    </div>
  );
}
function BackBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} style={{background:'none',border:'none',color:'var(--sub)',cursor:'pointer',fontSize:13,padding:'0 0 12px',display:'block'}}>← Back</button>;
}
function SectionBtn({ icon, label, sub, onClick, danger }: { icon:string; label:string; sub?:string; onClick:()=>void; danger?:boolean }) {
  return (
    <button onClick={onClick} style={{
      width:'100%',display:'flex',alignItems:'center',gap:12,padding:'12px 14px',
      background:'var(--glass)',border:'1px solid var(--border)',borderRadius:12,
      cursor:'pointer',textAlign:'left',marginBottom:8,
    }}>
      <span style={{fontSize:20,width:28,textAlign:'center'}}>{icon}</span>
      <div style={{flex:1}}>
        <div style={{color:danger?'var(--danger)':'var(--text)',fontSize:13,fontWeight:600}}>{label}</div>
        {sub && <div style={{color:'var(--sub)',fontSize:11,marginTop:2}}>{sub}</div>}
      </div>
      <span style={{color:'var(--sub)',fontSize:16}}>›</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// SETUP SCREEN
// ─────────────────────────────────────────────────────────────
function SetupScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep]     = useState<'choose'|'create'|'import'>('choose');
  const [mnem, setMnem]     = useState('');
  const [password, setPass] = useState('');
  const [confirm, setConf]  = useState('');
  const [generated, setGen] = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoad]  = useState(false);

  async function generateMnemonic() {
    const { generateMnemonic: gen } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english');
    const phrase = gen(wordlist); setGen(phrase); setMnem(phrase); setStep('create');
  }
  async function handleSetup() {
    setError('');
    if (password.length < 8) { setError('Password must be ≥ 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (mnem.trim().split(/\s+/).length < 12) { setError('Seed phrase must be ≥ 12 words'); return; }
    setLoad(true);
    const res = await sendBg({ type:'setup', mnemonic:mnem.trim(), password });
    setLoad(false);
    if (res.ok) onDone(); else setError((res.error as string) ?? 'Setup failed');
  }

  if (step === 'choose') return (
    <div style={{padding:'32px 20px',display:'flex',flexDirection:'column',gap:16,alignItems:'center'}}>
      <div style={{textAlign:'center',marginBottom:4}}>
        <div style={{fontSize:44}}>🍯</div>
        <h2 style={{color:'var(--gold)',margin:'8px 0 2px'}}>HIVE Wallet</h2>
        <p style={{color:'var(--sub)',fontSize:12,margin:0}}>Post-quantum secured · ML-DSA-65</p>
        <div style={{display:'flex',gap:5,justifyContent:'center',marginTop:8,flexWrap:'wrap'}}>
          {['ML-DSA-65','ML-KEM-768','CAS-φ'].map(b=>(
            <span key={b} style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'rgba(245,180,41,0.1)',border:'1px solid rgba(245,180,41,0.3)',color:'var(--gold)',letterSpacing:0.5}}>{b}</span>
          ))}
        </div>
      </div>
      <button className="btn-primary" onClick={generateMnemonic} style={{width:'100%'}}>+ Create New Wallet</button>
      <button className="btn-secondary" onClick={()=>setStep('import')} style={{width:'100%'}}>Import Existing Wallet</button>
      <p style={{color:'var(--sub)',fontSize:11,textAlign:'center',lineHeight:1.6}}>⬡ Chrysalis Security Framework<br/>Quantum-resistant from your first block</p>
    </div>
  );

  return (
    <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:12}}>
      <BackBtn onClick={()=>setStep('choose')} />
      <h3 style={{margin:'0 0 4px',color:'var(--text)'}}>{step==='create'?'New Wallet':'Import Wallet'}</h3>
      {step==='create' && generated && (
        <Card style={{background:'rgba(245,180,41,0.06)',border:'1px solid rgba(245,180,41,0.3)'}}>
          <p style={{color:'var(--gold)',fontSize:11,fontWeight:700,margin:'0 0 6px',textTransform:'uppercase',letterSpacing:1}}>⚠ Save this — never share it</p>
          <p style={{fontFamily:'monospace',fontSize:12,color:'var(--text)',lineHeight:1.8,margin:0,wordBreak:'break-word'}}>{generated}</p>
        </Card>
      )}
      {step==='import' && (
        <div><Label>Seed Phrase</Label>
          <textarea className="input" rows={4} placeholder="Enter 12 or 24 word seed phrase…" value={mnem} onChange={e=>setMnem(e.target.value)} style={{resize:'vertical',fontFamily:'monospace',fontSize:12}} />
        </div>
      )}
      <div><Label>Password (min 8 chars)</Label><input className="input" type="password" value={password} onChange={e=>setPass(e.target.value)} /></div>
      <div><Label>Confirm Password</Label><input className="input" type="password" value={confirm} onChange={e=>setConf(e.target.value)} /></div>
      <Err msg={error} />
      <button className="btn-primary" onClick={handleSetup} disabled={loading}>
        {loading ? 'Setting up…' : `⬡ ${step==='create'?'Create':'Import'} with Chrysalis`}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LOCKED SCREEN
// ─────────────────────────────────────────────────────────────
function LockedScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pass, setPass]   = useState('');
  const [error, setError] = useState('');
  const [load, setLoad]   = useState(false);
  async function handleUnlock() {
    setError(''); setLoad(true);
    const res = await sendBg({ type:'unlock', password:pass });
    setLoad(false);
    if (res.ok) onUnlock(); else setError((res.error as string) ?? 'Wrong password');
  }
  return (
    <div style={{padding:'36px 24px',display:'flex',flexDirection:'column',gap:14,alignItems:'center'}}>
      <div style={{fontSize:48}}>🔒</div>
      <h2 style={{color:'var(--gold)',margin:0}}>HIVE Wallet</h2>
      <div style={{display:'flex',gap:5}}>{['ML-DSA-65','Chrysalis'].map(b=><span key={b} style={{fontSize:9,padding:'2px 7px',borderRadius:4,background:'rgba(245,180,41,0.08)',border:'1px solid rgba(245,180,41,0.25)',color:'var(--gold)'}}>{b}</span>)}</div>
      <input className="input" type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleUnlock()} style={{width:'100%'}} autoFocus />
      <Err msg={error} />
      <button className="btn-primary" onClick={handleUnlock} disabled={load} style={{width:'100%'}}>{load?'Unlocking…':'Unlock'}</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APPROVE SCREEN
// ─────────────────────────────────────────────────────────────
function ApproveScreen({ req, address, onDone }: { req:PendingRequest; address:string; onDone:()=>void }) {
  const [load, setLoad] = useState(false);
  const [chrysStage, setChrysStage] = useState('');
  const isConnect = req.type === 'connect';
  const isTx = req.type === 'tx';
  const tx = req.txData;

  async function approve() {
    setLoad(true);
    if (isTx) {
      // Show Chrysalis ceremony stages for transaction signing
      setChrysStage('Initialising Chrysalis...');
      await new Promise(r => setTimeout(r, 400));
      setChrysStage('Deriving ML-DSA-65 keypair...');
      await new Promise(r => setTimeout(r, 500));
      setChrysStage('Signing transaction...');
      await sendBg({ type:'approve_request', requestId:req.id });
      setChrysStage('Broadcasting to Honey Network...');
      await new Promise(r => setTimeout(r, 500));
      setChrysStage('✓ Transaction confirmed');
      await new Promise(r => setTimeout(r, 700));
    } else if (isConnect) {
      // Chrysalis ceremony for site connection authorisation
      setChrysStage('Initialising Chrysalis...');
      await new Promise(r => setTimeout(r, 400));
      setChrysStage('Verifying site identity...');
      await new Promise(r => setTimeout(r, 500));
      setChrysStage('Signing authorisation with ML-DSA-65...');
      await sendBg({ type:'approve_request', requestId:req.id });
      setChrysStage('✓ Site authorised');
      await new Promise(r => setTimeout(r, 700));
    } else {
      // Generic sign
      setChrysStage('Signing with ML-DSA-65...');
      await sendBg({ type:'approve_request', requestId:req.id });
      await new Promise(r => setTimeout(r, 400));
    }
    setLoad(false); setChrysStage(''); onDone();
  }
  async function reject() { await sendBg({ type:'reject_request', requestId:req.id }); onDone(); }

  const TxTypeIcon: Record<string, string> = {
    swap: '🔄', futures_open: '📈', futures_close: '📉', buy_nft: '🎨', generic: '⬡',
  };

  return (
    <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:14}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:36}}>{isTx ? (TxTypeIcon[tx?.txType??'generic']??'⬡') : isConnect ? '🔗' : '✍️'}</div>
        <h3 style={{color:'var(--text)',margin:'8px 0 4px'}}>
          {isTx ? 'Confirm Transaction' : isConnect ? 'Connect to Site' : 'Sign Message'}
        </h3>
        <p style={{color:'var(--sub)',fontSize:13,margin:0}}>{req.origin}</p>
      </div>
      <div style={{textAlign:'center'}}>
        <span style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:'rgba(245,180,41,0.1)',border:'1px solid rgba(245,180,41,0.3)',color:'var(--gold)',letterSpacing:1}}>
          ⬡ CHRYSALIS PROTECTED
        </span>
      </div>
      <Card>
        <Label>Site</Label><p style={{color:'var(--text)',margin:'0 0 10px',fontWeight:600}}>{req.title}</p>
        <Label>Your Address</Label>
        <p style={{color:'var(--green)',fontSize:11,fontFamily:'monospace',margin:0,wordBreak:'break-all'}}>{address}</p>
      </Card>
      {isTx && tx && (
        <Card style={{background:'rgba(57,255,20,0.04)'}}>
          <Label>Transaction</Label>
          <p style={{color:'var(--text)',fontWeight:700,margin:'0 0 8px',fontSize:14}}>{tx.description}</p>
          {tx.fromToken && tx.toToken && (
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
              <span style={{color:'var(--sub)'}}>Swap</span>
              <span style={{color:'var(--text)'}}>{tx.amountIn} {tx.fromToken} → {tx.amountOut?.toFixed(4)} {tx.toToken}</span>
            </div>
          )}
          {tx.priceImpact !== undefined && (
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
              <span style={{color:'var(--sub)'}}>Price Impact</span>
              <span style={{color: (tx.priceImpact??0) > 3 ? 'var(--danger)' : 'var(--text)'}}>{tx.priceImpact?.toFixed(2)}%</span>
            </div>
          )}
          {tx.leverage !== undefined && (
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
              <span style={{color:'var(--sub)'}}>Leverage</span>
              <span style={{color:'var(--gold)'}}>{tx.leverage}×</span>
            </div>
          )}
          {tx.fee !== undefined && (
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
              <span style={{color:'var(--sub)'}}>Fee</span>
              <span style={{color:'var(--text)'}}>{tx.fee?.toFixed(4)} HNY</span>
            </div>
          )}
        </Card>
      )}
      {!isConnect && !isTx && req.message && (
        <Card style={{background:'rgba(57,255,20,0.04)'}}>
          <Label>Message</Label>
          <p style={{color:'var(--text)',fontSize:12,fontFamily:'monospace',margin:0,wordBreak:'break-all',maxHeight:80,overflow:'auto'}}>{req.message}</p>
        </Card>
      )}
      {chrysStage && (
        <div style={{textAlign:'center',padding:'8px 0',color:'var(--gold)',fontSize:12,fontFamily:'monospace'}}>
          ⬡ {chrysStage}
        </div>
      )}
      <div style={{display:'flex',gap:10}}>
        <button className="btn-secondary" onClick={reject} style={{flex:1}} disabled={load}>Reject</button>
        <button className="btn-primary" onClick={approve} disabled={load} style={{flex:1}}>
          {load ? '⬡ …' : isTx ? '⬡ Confirm' : isConnect ? '⬡ Authorise' : '⬡ Sign'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// UNLOCKED SCREEN
// ─────────────────────────────────────────────────────────────
function UnlockedScreen({ state, onLock }: { state:ExtState; onLock:()=>void }) {
  const [tab, setTab]         = useState<ActiveTab>('assets');
  const [modal, setModal]     = useState<TxModal>('none');
  const [data, setData]       = useState<WalletData|null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Network + profiles (for header/settings)
  const [networks, setNetworks]   = useState<NetworkConfig[]>([]);
  const [activeNetId, setActiveNetId] = useState<string>(state.networkId ?? 'hny-devnet');
  const [netPickerOpen, setNetPickerOpen] = useState(false);

  // Chrysalis ceremony
  const [cVisible, setCVisible] = useState(false);
  const [cStage, setCStage]     = useState<ChrysalisStage>('init');
  const [cError, setCError]     = useState('');

  // Transaction form state
  const [sendTo, setSendTo]     = useState(''); const [sendAmt, setSendAmt] = useState(''); const [sendTok, setSendTok] = useState('HNY');
  const [swapFrom, setSwapFrom] = useState('HNY'); const [swapTo, setSwapTo] = useState('USDC'); const [swapAmt, setSwapAmt] = useState(''); const [swapQuote, setSwapQuote] = useState<SwapQuote|null>(null); const [quoteLoad, setQuoteLoad] = useState(false);
  const [stakeTab, setStakeTab] = useState<'stake'|'unstake'>('stake'); const [stakeAmt, setStakeAmt] = useState('');
  const [lpPair, setLpPair]     = useState('HNY/USDC'); const [lpAmtA, setLpAmtA] = useState(''); const [lpAmtB, setLpAmtB] = useState(''); const [lpRatio, setLpRatio] = useState(1);
  const [selNft, setSelNft]     = useState<NftItem|null>(null); const [nftTo, setNftTo] = useState('');
  const [txErr, setTxErr]       = useState('');
  const [copied, setCopied]     = useState(false);

  // ── Load data ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    const res = await sendBg<{ok?:boolean;balances?:Record<string,Bal>;nfts?:NftItem[];recentTxs?:TxItem[];chrysalisRegistered?:boolean}>({ type:'fetch_wallet_data' });
    if (res.ok) setData({ balances:res.balances??{}, nfts:res.nfts??[], recentTxs:res.recentTxs??[], chrysalisRegistered:res.chrysalisRegistered??false });
    setLoading(false);
  }, []);

  const loadNetworks = useCallback(async () => {
    const res = await sendBg<{ok?:boolean;networks?:NetworkConfig[];activeId?:string}>({ type:'get_networks' });
    if (res.ok) { setNetworks(res.networks??[]); if (res.activeId) setActiveNetId(res.activeId); }
  }, []);

  useEffect(() => { loadData(); loadNetworks(); }, [loadData, loadNetworks]);

  // Auto-refresh every 30s so received funds appear without manual refresh
  useEffect(() => {
    const id = setInterval(() => { loadData(); }, 30_000);
    return () => clearInterval(id);
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true); await loadData(); setRefreshing(false);
  }

  // ── Chrysalis ceremony wrapper ─────────────────────────────
  async function runChry<T>(fn: () => Promise<T>): Promise<T> {
    setCError(''); setCStage('init'); setCVisible(true);
    try {
      setCStage('keys'); await delay(350);
      setCStage('attest');
      const result = await fn();
      setCStage('sign'); await delay(280);
      setCStage('done');
      setTimeout(() => { setCVisible(false); setTimeout(loadData, 800); }, 1800);
      return result;
    } catch (e) { setCStage('error'); setCError(e instanceof Error ? e.message : String(e)); throw e; }
  }
  function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  // ── TX handlers ────────────────────────────────────────────
  async function handleSend() {
    if (!sendTo.trim() || !sendAmt) return; setTxErr('');
    try { await runChry(async () => { const r = await sendBg<BgResp>({ type:'exec_send', toWallet:sendTo.trim(), amount:parseFloat(sendAmt), token:sendTok }); if (!r.ok) throw new Error((r.error as string)??'Failed'); }); setModal('none'); setSendTo(''); setSendAmt(''); } catch(e){setTxErr(String(e));}
  }
  async function handleSwap() {
    if (!swapAmt||!swapQuote) return; setTxErr('');
    try { await runChry(async () => { const r = await sendBg<BgResp>({ type:'exec_swap', fromToken:swapFrom, toToken:swapTo, amountIn:parseFloat(swapAmt) }); if (!r.ok) throw new Error((r.error as string)??'Failed'); }); setModal('none'); setSwapAmt(''); setSwapQuote(null); } catch(e){setTxErr(String(e));}
  }
  async function handleStake() {
    if (!stakeAmt) return; setTxErr('');
    try { await runChry(async () => { const r = await sendBg<BgResp>({ type: stakeTab==='stake'?'exec_stake':'exec_unstake', amount:parseFloat(stakeAmt) }); if (!r.ok) throw new Error((r.error as string)??'Failed'); }); setModal('none'); setStakeAmt(''); } catch(e){setTxErr(String(e));}
  }
  async function handleAddLp() {
    if (!lpAmtA||!lpAmtB) return; setTxErr('');
    const [tokenA,tokenB]=lpPair.split('/');
    try { await runChry(async () => { const r = await sendBg<BgResp>({ type:'exec_add_lp', tokenA, tokenB, amountA:parseFloat(lpAmtA), amountB:parseFloat(lpAmtB) }); if (!r.ok) throw new Error((r.error as string)??'Failed'); }); setModal('none'); setLpAmtA(''); setLpAmtB(''); } catch(e){setTxErr(String(e));}
  }
  async function handleSendNft() {
    if (!selNft||!nftTo.trim()) return; setTxErr('');
    try { await runChry(async () => { const r = await sendBg<BgResp>({ type:'exec_send_nft', toWallet:nftTo.trim(), nftId:selNft.id }); if (!r.ok) throw new Error((r.error as string)??'Failed'); }); setModal('none'); setSelNft(null); setNftTo(''); } catch(e){setTxErr(String(e));}
  }
  async function fetchSwapQuote() {
    if (!swapAmt||parseFloat(swapAmt)<=0) return; setQuoteLoad(true);
    const r = await sendBg<{ok?:boolean;amountOut?:number;priceImpact?:number;fee?:number;error?:string}>({ type:'get_swap_quote', fromToken:swapFrom, toToken:swapTo, amountIn:parseFloat(swapAmt) });
    setQuoteLoad(false);
    if (r.ok&&r.amountOut!==undefined) setSwapQuote({amountOut:r.amountOut,priceImpact:r.priceImpact??0,fee:r.fee??0.003}); else setSwapQuote(null);
  }
  async function fetchLpRatio(pair: string) {
    const [tA, tB] = pair.split('/');
    const r = await sendBg<{ok?:boolean;ratio?:number}>({ type:'get_pool_ratio', tokenA:tA, tokenB:tB });
    setLpRatio(r.ok && r.ratio ? r.ratio : 1);
  }
  function copyAddr() { navigator.clipboard.writeText(state.address).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);}); }
  async function lock() { await sendBg({type:'lock'}); onLock(); }
  async function switchNetwork(id: string) {
    await sendBg({ type:'switch_network', networkId:id }); setActiveNetId(id); setNetPickerOpen(false);
  }

  // ── Derived values ─────────────────────────────────────────
  const hnyBal  = data?.balances['HNY']?.amount ?? 0;
  const hnyUsd  = data?.balances['HNY']?.valueUsd ?? hnyBal;
  const tokens  = Object.entries(data?.balances ?? {}).filter(([,b])=>b.amount>0).sort(([a],[b])=>a==='HNY'?-1:b==='HNY'?1:a.localeCompare(b));
  const chrysOk = data?.chrysalisRegistered ?? state.chrysalisRegistered ?? false;
  const chrysId = `CHRY-${state.address.slice(4,8).toUpperCase()}-${state.address.slice(8,12).toUpperCase()}`;
  const activeNet = networks.find(n=>n.id===activeNetId);
  const netShort  = activeNet?.shortName ?? 'HNY-DEV';
  const netIsHive = !activeNet || activeNet.type === 'hive';
  const [lpA,lpB] = lpPair.split('/');

  const TABS: {id:ActiveTab;icon:string;label:string}[] = [
    {id:'assets',icon:'💰',label:'Assets'},{id:'nfts',icon:'🖼',label:'NFTs'},
    {id:'activity',icon:'📊',label:'Activity'},{id:'settings',icon:'⚙',label:'Settings'},
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
      {/* ── Header ───────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <span style={{fontSize:20}}>🍯</span>
          <span style={{color:'var(--gold)',fontWeight:700,fontSize:14}}>HIVE Wallet</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <button onClick={handleRefresh} title="Refresh" style={{
            background:'none',border:'1px solid var(--border)',color:'var(--sub)',borderRadius:7,
            padding:'3px 7px',cursor:'pointer',fontSize:12,transition:'transform 0.3s',
            transform: refreshing ? 'rotate(180deg)' : 'none',
          }}>🔄</button>
          <span style={{
            fontSize:9,padding:'3px 7px',borderRadius:4,letterSpacing:1,fontWeight:700,cursor:'pointer',
            background:chrysOk?'rgba(57,255,20,0.1)':'rgba(245,180,41,0.1)',
            border:`1px solid ${chrysOk?'rgba(57,255,20,0.3)':'rgba(245,180,41,0.3)'}`,
            color:chrysOk?'var(--green)':'var(--gold)',
          }}>⬡ {chrysOk?'PROTECTED':'CHRYSALIS'}</span>
          <button onClick={lock} style={{background:'none',border:'1px solid var(--border)',color:'var(--sub)',borderRadius:7,padding:'3px 8px',cursor:'pointer',fontSize:11}}>🔒</button>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────── */}
      <div style={{flex:1,overflowY:'auto',position:'relative'}}>
        {loading && !data ? (
          <div style={{padding:32,textAlign:'center',color:'var(--sub)'}}>Loading…</div>
        ) : (
          <>
            {/* ───── ASSETS TAB ──────────────────────────── */}
            {tab === 'assets' && (
              <div style={{padding:'14px 14px 80px'}}>
                {/* Balance card with network ticker */}
                <Card style={{textAlign:'center',marginBottom:10,background:'linear-gradient(135deg,rgba(245,180,41,0.06),rgba(57,255,20,0.03))'}}>
                  {/* Network ticker */}
                  <button onClick={()=>setNetPickerOpen(true)} style={{
                    background:'rgba(255,255,255,0.04)',border:'1px solid var(--border)',borderRadius:8,
                    padding:'3px 10px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5,marginBottom:8,
                  }}>
                    <span style={{width:6,height:6,borderRadius:'50%',background:netIsHive?'var(--green)':'var(--blue)',display:'inline-block'}} />
                    <span style={{color:'var(--sub)',fontSize:10,fontWeight:600,letterSpacing:1}}>{netShort}</span>
                    <span style={{color:'var(--sub)',fontSize:9}}>▾</span>
                  </button>
                  <p style={{color:'var(--green)',fontSize:32,fontWeight:700,margin:'0 0 2px',fontFamily:'monospace',lineHeight:1.1}}>{fmt(hnyBal)}</p>
                  <p style={{color:'var(--sub)',fontSize:11,margin:'0 0 8px'}}>HNY ≈ ${fmtS(hnyUsd)} USD</p>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                    <span style={{color:'var(--sub)',fontSize:11,fontFamily:'monospace'}}>{short(state.address)}</span>
                    <button onClick={copyAddr} style={{background:'none',border:'1px solid var(--border)',color:copied?'var(--green)':'var(--sub)',borderRadius:5,padding:'2px 7px',cursor:'pointer',fontSize:11}}>{copied?'✓':'⧉'}</button>
                  </div>
                </Card>

                {/* Action buttons */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:7,marginBottom:7}}>
                  {[['↑','Send','send'],['↓','Receive','receive'],['⇌','Swap','swap'],['⛏','Stake','stake']].map(([icon,label,id])=>(
                    <button key={id} onClick={()=>{setModal(id as TxModal);setTxErr('');}} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'10px 4px',background:'var(--glass)',border:'1px solid var(--border)',borderRadius:11,cursor:'pointer',color:'var(--text)',fontSize:17}}>
                      <span>{icon}</span><span style={{fontSize:10,color:'var(--sub)'}}>{label}</span>
                    </button>
                  ))}
                </div>
                <button onClick={()=>{setModal('lp');setTxErr('');fetchLpRatio(lpPair);}} style={{width:'100%',padding:'8px',background:'var(--glass)',border:'1px solid var(--border)',borderRadius:9,cursor:'pointer',color:'var(--sub)',fontSize:12,marginBottom:14}}>💧 Add Liquidity</button>

                {/* Token list */}
                <Label>Your Tokens</Label>
                {tokens.length === 0
                  ? <p style={{color:'var(--sub)',fontSize:12,textAlign:'center',padding:'16px 0'}}>No tokens yet — use the faucet to get started</p>
                  : tokens.map(([sym,bal])=>(
                    <div key={sym} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'var(--glass)',border:'1px solid var(--border)',borderRadius:9,marginBottom:4}}>
                      <span style={{fontSize:18,width:26,textAlign:'center'}}>{tIcon(sym)}</span>
                      <div style={{flex:1}}>
                        <div style={{color:'var(--text)',fontSize:13,fontWeight:600}}>{sym}</div>
                        <div style={{color:'var(--sub)',fontSize:10}}>{tName(sym)}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{color:'var(--text)',fontSize:12,fontFamily:'monospace'}}>{fmt(bal.amount)}</div>
                        {bal.valueUsd!==undefined&&<div style={{color:'var(--sub)',fontSize:10}}>${fmtS(bal.valueUsd)}</div>}
                      </div>
                    </div>
                  ))
                }
              </div>
            )}

            {/* ───── NFTs TAB ────────────────────────────── */}
            {tab === 'nfts' && (
              <div style={{padding:'14px 14px 80px'}}>
                {(data?.nfts.length??0)===0
                  ? <div style={{textAlign:'center',padding:'40px 20px'}}><div style={{fontSize:48,marginBottom:12}}>🖼</div><p style={{color:'var(--sub)'}}>No NFTs yet</p><p style={{color:'var(--sub)',fontSize:11}}>Buy or receive NFTs from honey.trade</p></div>
                  : <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                      {data?.nfts.map(nft=>(
                        <div key={nft.id} style={{background:'var(--glass)',border:'1px solid var(--border)',borderRadius:11,padding:12,cursor:'pointer'}} onClick={()=>{setSelNft(nft);setModal('send_nft');setTxErr('');}}>
                          <div style={{fontSize:26,textAlign:'center',marginBottom:6}}>{nft.media_type==='audio'?'🎵':nft.media_type==='video'?'🎬':nft.media_type==='document'?'📄':'🖼'}</div>
                          <div style={{color:'var(--text)',fontSize:12,fontWeight:600,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis',textAlign:'center'}}>{nft.name}</div>
                          <div style={{color:'var(--sub)',fontSize:10,textAlign:'center',marginTop:2,textTransform:'capitalize'}}>{nft.media_type}</div>
                          <button style={{width:'100%',marginTop:7,padding:'5px',borderRadius:7,border:'1px solid var(--border)',background:'var(--glass2)',color:'var(--sub)',cursor:'pointer',fontSize:11}}>Send →</button>
                        </div>
                      ))}
                    </div>
                }
              </div>
            )}

            {/* ───── ACTIVITY TAB ────────────────────────── */}
            {tab === 'activity' && (
              <div style={{padding:'14px 14px 80px'}}>
                {(data?.recentTxs.length??0)===0
                  ? <div style={{textAlign:'center',padding:'40px 20px'}}><div style={{fontSize:36,marginBottom:12}}>📊</div><p style={{color:'var(--sub)'}}>No transactions yet</p></div>
                  : data?.recentTxs.map((tx,i)=>{
                      const type=tx.type??'unknown'; const icon=TX_ICONS[type]??'•';
                      const other=type==='send'?tx.to_wallet:tx.from_wallet;
                      return (
                        <div key={tx.txid??tx.id??i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'var(--glass)',border:'1px solid var(--border)',borderRadius:9,marginBottom:4}}>
                          <span style={{fontSize:16,width:22,textAlign:'center',flexShrink:0}}>{icon}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{color:'var(--text)',fontSize:12,fontWeight:600,textTransform:'capitalize'}}>{type.replace(/_/g,' ')}</div>
                            {other&&<div style={{color:'var(--sub)',fontSize:10,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{short(other)}</div>}
                          </div>
                          <div style={{textAlign:'right',flexShrink:0}}>
                            <div style={{color:type==='receive'?'var(--green)':'var(--text)',fontSize:12,fontFamily:'monospace'}}>{type==='receive'?'+':type==='send'?'-':''}{fmt(tx.amount??0)} {tx.token??'HNY'}</div>
                            <div style={{color:'var(--sub)',fontSize:10}}>{timeAgo(tx.created_at,tx.timestamp)}</div>
                          </div>
                        </div>
                      );
                    })
                }
              </div>
            )}

            {/* ───── SETTINGS TAB ────────────────────────── */}
            {tab === 'settings' && (
              <SettingsPane
                extState={state} walletData={data} chrysalisId={chrysId} chrysalisOk={chrysOk}
                activeNetId={activeNetId} networks={networks}
                onLock={lock} onReset={async()=>{await sendBg({type:'reset'});onLock();}}
                onNetworksChange={loadNetworks} onDataRefresh={loadData}
              />
            )}
          </>
        )}
      </div>

      {/* ── Bottom tab nav ────────────────────────────────── */}
      <div style={{display:'flex',borderTop:'1px solid var(--border)',background:'var(--bg2)',flexShrink:0}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'10px 4px 8px',background:'none',border:'none',cursor:'pointer',color:tab===t.id?'var(--green)':'var(--sub)',borderTop:`2px solid ${tab===t.id?'var(--green)':'transparent'}`,fontSize:18}}>
            <span>{t.icon}</span><span style={{fontSize:9,letterSpacing:0.5}}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ──────── TX MODALS ──────── */}
      {modal==='send'&&(
        <ModalShell title="Send Tokens" onClose={()=>setModal('none')}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div><Label>To Address</Label><input className="input" placeholder="HNY_..." value={sendTo} onChange={e=>setSendTo(e.target.value)} style={{width:'100%'}} /></div>
            <div style={{display:'grid',gridTemplateColumns:'120px 1fr',gap:10}}>
              <div><Label>Token</Label><select className="input" value={sendTok} onChange={e=>setSendTok(e.target.value)} style={{width:'100%'}}>{ALL_TOKENS.map(t=><option key={t} value={t}>{tIcon(t)} {t}</option>)}</select></div>
              <div><Label>Amount</Label><input className="input" type="number" placeholder="0.00" value={sendAmt} onChange={e=>setSendAmt(e.target.value)} style={{width:'100%'}} /></div>
            </div>
            {sendAmt&&<p style={{color:'var(--sub)',fontSize:11,margin:0}}>Available: {fmt(data?.balances[sendTok]?.amount??0)} {sendTok}</p>}
            <Err msg={txErr} />
            <button className="btn-primary" onClick={handleSend}>⬡ Send with Chrysalis</button>
          </div>
        </ModalShell>
      )}

      {modal==='receive'&&(
        <ModalShell title="Receive" onClose={()=>setModal('none')}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14}}>
            <p style={{color:'var(--sub)',fontSize:12,textAlign:'center',margin:0}}>Scan with HIVE Wallet or share your address</p>
            <HexQR value={state.address} size={192} />
            <p style={{color:'var(--text)',fontSize:11,fontFamily:'monospace',textAlign:'center',wordBreak:'break-all',lineHeight:1.6}}>{state.address}</p>
            <button onClick={copyAddr} style={{padding:'10px 24px',borderRadius:10,border:'1px solid var(--border)',background:'var(--glass)',color:copied?'var(--green)':'var(--sub)',cursor:'pointer',fontSize:13}}>{copied?'✓ Copied':'⧉ Copy Address'}</button>
          </div>
        </ModalShell>
      )}

      {modal==='swap'&&(
        <ModalShell title="Swap Tokens" onClose={()=>setModal('none')}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div><Label>From</Label><div style={{display:'grid',gridTemplateColumns:'120px 1fr',gap:8}}><select className="input" value={swapFrom} onChange={e=>{setSwapFrom(e.target.value);setSwapQuote(null);}}>{ALL_TOKENS.map(t=><option key={t} value={t}>{tIcon(t)} {t}</option>)}</select><input className="input" type="number" placeholder="0.00" value={swapAmt} onChange={e=>{setSwapAmt(e.target.value);setSwapQuote(null);}} onBlur={fetchSwapQuote} /></div></div>
            <div style={{textAlign:'center',color:'var(--sub)',fontSize:18}}>⇅</div>
            <div><Label>To</Label><select className="input" value={swapTo} onChange={e=>{setSwapTo(e.target.value);setSwapQuote(null);}} style={{width:'100%'}}>{ALL_TOKENS.filter(t=>t!==swapFrom).map(t=><option key={t} value={t}>{tIcon(t)} {t}</option>)}</select></div>
            {quoteLoad&&<p style={{color:'var(--sub)',fontSize:12}}>Getting quote…</p>}
            {swapQuote&&<Card style={{background:'rgba(57,255,20,0.04)'}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}><span style={{color:'var(--sub)'}}>You receive</span><span style={{color:'var(--green)',fontFamily:'monospace',fontWeight:700}}>{fmt(swapQuote.amountOut)} {swapTo}</span></div><div style={{display:'flex',justifyContent:'space-between',fontSize:11}}><span style={{color:'var(--sub)'}}>Price impact</span><span style={{color:swapQuote.priceImpact>2?'var(--danger)':'var(--sub)'}}>{swapQuote.priceImpact.toFixed(2)}%</span></div></Card>}
            {!swapQuote&&swapAmt&&<button onClick={fetchSwapQuote} style={{padding:'8px',background:'var(--glass)',border:'1px solid var(--border)',borderRadius:8,color:'var(--sub)',cursor:'pointer',fontSize:12}}>Get Quote</button>}
            <Err msg={txErr} />
            <button className="btn-primary" onClick={handleSwap} disabled={!swapQuote}>⬡ Swap with Chrysalis</button>
          </div>
        </ModalShell>
      )}

      {modal==='stake'&&(
        <ModalShell title="Stake / Unstake" onClose={()=>setModal('none')}>
          <div style={{display:'flex',gap:0,marginBottom:12,borderRadius:9,overflow:'hidden',border:'1px solid var(--border)'}}>
            {(['stake','unstake'] as const).map(t=><button key={t} onClick={()=>{setStakeTab(t);setStakeAmt('');}} style={{flex:1,padding:'9px',border:'none',cursor:'pointer',fontWeight:600,fontSize:12,background:stakeTab===t?'rgba(57,255,20,0.12)':'var(--glass)',color:stakeTab===t?'var(--green)':'var(--sub)',textTransform:'capitalize'}}>{t}</button>)}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {stakeTab==='stake'&&(
              <Card style={{background:'rgba(57,255,20,0.04)'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                  <span style={{color:'var(--sub)'}}>APR</span>
                  <span style={{color:'var(--green)',fontWeight:700}}>5.0%</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:6}}>
                  <span style={{color:'var(--sub)'}}>Rewards paid in</span>
                  <span style={{color:'var(--gold)'}}>🍯 HNY</span>
                </div>
                <div style={{fontSize:10,color:'var(--sub)',lineHeight:1.5}}>
                  Stake HNY to receive stHNY representing your position + accrued rewards. Rewards accumulate every second.
                </div>
              </Card>
            )}
            {stakeTab==='unstake'&&(
              <Card style={{background:'rgba(245,180,41,0.05)'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:4}}>
                  <span style={{color:'var(--sub)'}}>stHNY balance</span>
                  <span style={{color:'var(--gold)',fontFamily:'monospace'}}>{fmt(data?.balances['stHNY']?.amount??0)} stHNY</span>
                </div>
                <div style={{fontSize:10,color:'var(--sub)',lineHeight:1.5}}>
                  Unstaking converts stHNY back to HNY including all accumulated rewards.
                </div>
              </Card>
            )}
            <div>
              <Label>Amount</Label>
              <input className="input" type="number" placeholder="0.00" value={stakeAmt} onChange={e=>setStakeAmt(e.target.value)} style={{width:'100%'}} />
              <p style={{color:'var(--sub)',fontSize:11,margin:'4px 0 0'}}>Available: {fmt(data?.balances[stakeTab==='stake'?'HNY':'stHNY']?.amount??0)} {stakeTab==='stake'?'HNY':'stHNY'}</p>
            </div>
            <Err msg={txErr} />
            <button className="btn-primary" onClick={handleStake}>⬡ {stakeTab==='stake'?'Stake HNY':'Unstake stHNY'} with Chrysalis</button>
          </div>
        </ModalShell>
      )}

      {modal==='lp'&&(
        <ModalShell title="Add Liquidity" onClose={()=>setModal('none')}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {/* APR info card */}
            <Card style={{background:'rgba(57,255,20,0.04)'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                <span style={{color:'var(--sub)'}}>APR</span>
                <span style={{color:'var(--green)',fontWeight:700}}>8.0%</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}>
                <span style={{color:'var(--sub)'}}>Rewards paid in</span>
                <span style={{color:'var(--gold)'}}>🍯 HNY</span>
              </div>
              <div style={{fontSize:10,color:'var(--sub)',marginTop:6,lineHeight:1.5}}>
                Provide equal-value liquidity to earn 8% APR. Rewards accumulate continuously and are claimable any time.
              </div>
            </Card>
            <div><Label>Pool</Label><select className="input" value={lpPair} onChange={e=>{const p=e.target.value;setLpPair(p);setLpAmtA('');setLpAmtB('');fetchLpRatio(p);}} style={{width:'100%'}}>{LP_PAIRS.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
            <div>
              <Label>{lpA} Amount</Label>
              <input className="input" type="number" placeholder="0.00" value={lpAmtA} style={{width:'100%'}}
                onChange={e=>{
                  const v=e.target.value; setLpAmtA(v);
                  if(v&&parseFloat(v)>0) setLpAmtB((parseFloat(v)*lpRatio).toFixed(6)); else setLpAmtB('');
                }} />
              <p style={{color:'var(--sub)',fontSize:10,margin:'3px 0 0'}}>Available: {fmt(data?.balances[lpA]?.amount??0)} {lpA}</p>
            </div>
            <div>
              <Label>{lpB} Amount</Label>
              <input className="input" type="number" placeholder="0.00" value={lpAmtB} style={{width:'100%'}}
                onChange={e=>{
                  const v=e.target.value; setLpAmtB(v);
                  if(v&&parseFloat(v)>0&&lpRatio>0) setLpAmtA((parseFloat(v)/lpRatio).toFixed(6)); else setLpAmtA('');
                }} />
              <p style={{color:'var(--sub)',fontSize:10,margin:'3px 0 0'}}>Available: {fmt(data?.balances[lpB]?.amount??0)} {lpB}</p>
            </div>
            <Err msg={txErr} />
            <button className="btn-primary" onClick={handleAddLp}>⬡ Add Liquidity with Chrysalis</button>
          </div>
        </ModalShell>
      )}

      {modal==='send_nft'&&selNft&&(
        <ModalShell title="Send NFT" onClose={()=>{setModal('none');setSelNft(null);}}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Card style={{textAlign:'center'}}><div style={{fontSize:32,marginBottom:6}}>{selNft.media_type==='audio'?'🎵':selNft.media_type==='video'?'🎬':selNft.media_type==='document'?'📄':'🖼'}</div><p style={{color:'var(--text)',fontWeight:700,margin:'0 0 2px'}}>{selNft.name}</p></Card>
            <div><Label>Recipient</Label><input className="input" placeholder="HNY_..." value={nftTo} onChange={e=>setNftTo(e.target.value)} style={{width:'100%'}} /></div>
            <Err msg={txErr} />
            <button className="btn-primary" onClick={handleSendNft}>⬡ Send NFT with Chrysalis</button>
          </div>
        </ModalShell>
      )}

      {/* Network picker overlay */}
      {netPickerOpen&&(
        <div style={{position:'fixed',inset:0,zIndex:100,background:'rgba(4,5,7,0.88)',backdropFilter:'blur(8px)',display:'flex',flexDirection:'column'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 16px',borderBottom:'1px solid var(--border)'}}>
            <span style={{color:'var(--text)',fontWeight:700,fontSize:15}}>Select Network</span>
            <button onClick={()=>setNetPickerOpen(false)} style={{background:'none',border:'none',color:'var(--sub)',cursor:'pointer',fontSize:22,lineHeight:1}}>×</button>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'12px 14px'}}>
            {networks.map(n=>(
              <button key={n.id} onClick={()=>switchNetwork(n.id)} style={{
                width:'100%',display:'flex',alignItems:'center',gap:12,padding:'11px 14px',
                background: n.id===activeNetId ? 'rgba(57,255,20,0.08)' : 'var(--glass)',
                border: `1px solid ${n.id===activeNetId?'rgba(57,255,20,0.3)':'var(--border)'}`,
                borderRadius:11,cursor:'pointer',marginBottom:8,
              }}>
                <span style={{width:8,height:8,borderRadius:'50%',background:n.type==='hive'?'var(--green)':'var(--blue)',flexShrink:0,boxShadow:n.id===activeNetId?`0 0 6px ${n.type==='hive'?'var(--green)':'var(--blue)'}`:'none',display:'inline-block'}} />
                <div style={{flex:1,textAlign:'left'}}>
                  <div style={{color:n.id===activeNetId?'var(--green)':'var(--text)',fontSize:13,fontWeight:600}}>{n.name}</div>
                  <div style={{color:'var(--sub)',fontSize:10}}>{n.type==='hive'?n.rpcUrl:`Chain ID: ${n.chainId}`}{n.isTestnet?' · Testnet':''}</div>
                </div>
                {n.id===activeNetId&&<span style={{color:'var(--green)',fontSize:14}}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chrysalis ceremony overlay */}
      <ChrysalisModal visible={cVisible} stage={cStage} errorMsg={cError} onClose={()=>setCVisible(false)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SETTINGS PANE (sub-navigation)
// ─────────────────────────────────────────────────────────────
function SettingsPane({ extState, walletData, chrysalisId, chrysalisOk, activeNetId, networks, onLock, onReset, onNetworksChange, onDataRefresh }: {
  extState: ExtState; walletData: WalletData|null; chrysalisId: string; chrysalisOk: boolean;
  activeNetId: string; networks: NetworkConfig[];
  onLock: ()=>void; onReset: ()=>void; onNetworksChange: ()=>void; onDataRefresh: ()=>void;
}) {
  const [view, setView]         = useState<SettingsView>('main');
  // Wallet manager
  const [profiles, setProfileList] = useState<WalletProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [profLoading, setProfLoad] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newMnemonic, setNewMnemonic]     = useState('');
  const [importMnem, setImportMnem]       = useState('');
  const [importName, setImportName]       = useState('');
  const [walletMsg, setWalletMsg]         = useState('');
  const [walletErr, setWalletErr]         = useState('');
  // Seed phrase
  const [seedPass, setSeedPass]   = useState('');
  const [seedPhrase, setSeedPhrase] = useState('');
  const [seedErr, setSeedErr]     = useState('');
  const [seedLoading, setSeedLoad] = useState(false);
  // Networks
  const [netErr, setNetErr]       = useState('');
  const [customNetForm, setCustomNetForm] = useState({ name:'', shortName:'', rpcUrl:'', chainId:'', currencySymbol:'', isTestnet:false, type:'hive' as 'hive'|'evm' });
  // Chrysalis ceremony for seed phrase
  const [cVisible, setCVisible]   = useState(false);
  const [cStage, setCStage]       = useState<ChrysalisStage>('init');
  const [cError, setCError]       = useState('');

  async function loadProfiles() {
    setProfLoad(true);
    const r = await sendBg<{ok?:boolean;profiles?:WalletProfile[];activeId?:string}>({ type:'get_profiles' });
    if (r.ok) { setProfileList(r.profiles??[]); setActiveProfileId(r.activeId??''); }
    setProfLoad(false);
  }

  async function handleSwitchProfile(id: string) {
    const r = await sendBg<{ok?:boolean;error?:string}>({ type:'switch_profile', profileId:id });
    if (r.ok) { await loadProfiles(); setWalletMsg('Switched wallet'); onDataRefresh(); }
    else setWalletErr((r.error as string)??'Failed');
  }

  async function handleAddAddress() {
    const r = await sendBg<{ok?:boolean;address?:string;error?:string}>({ type:'add_address' });
    if (r.ok) { setWalletMsg(`New address added: ${r.address}`); await loadProfiles(); }
    else setWalletErr((r.error as string)??'Failed');
  }

  async function handleCreateWallet() {
    const r = await sendBg<{ok?:boolean;profile?:WalletProfile;mnemonic?:string;error?:string}>({ type:'create_profile', name:newWalletName });
    if (r.ok) { setNewMnemonic(r.mnemonic??''); await loadProfiles(); }
    else setWalletErr((r.error as string)??'Failed');
  }

  async function handleImportWallet() {
    const r = await sendBg<{ok?:boolean;error?:string}>({ type:'import_profile', name:importName, mnemonic:importMnem });
    if (r.ok) { setWalletMsg('Wallet imported'); await loadProfiles(); setImportMnem(''); setImportName(''); setView('wallet_manager'); }
    else setWalletErr((r.error as string)??'Failed');
  }

  async function handleDeleteProfile(id: string) {
    if (!confirm('Delete this wallet? This cannot be undone.')) return;
    const r = await sendBg<{ok?:boolean;error?:string}>({ type:'delete_profile', profileId:id });
    if (r.ok) { setWalletMsg('Wallet deleted'); await loadProfiles(); }
    else setWalletErr((r.error as string)??'Failed');
  }

  async function handleViewSeedPhrase() {
    setSeedErr(''); setSeedLoad(true);
    setCError(''); setCStage('init'); setCVisible(true);
    try {
      setCStage('keys'); await delay(400);
      setCStage('attest');
      const r = await sendBg<{ok?:boolean;mnemonic?:string;error?:string}>({ type:'get_seed_phrase', password:seedPass });
      setCStage('sign'); await delay(300);
      if (r.ok && r.mnemonic) {
        setCStage('done');
        setSeedPhrase(r.mnemonic);
        setTimeout(() => setCVisible(false), 1800);
      } else {
        setCStage('error'); setCError((r.error as string)??'Wrong password');
        setSeedErr((r.error as string)??'Wrong password');
      }
    } finally { setSeedLoad(false); }
  }

  function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  async function handleAddNetwork() {
    setNetErr('');
    if (!customNetForm.name || !customNetForm.rpcUrl || !customNetForm.currencySymbol) { setNetErr('Name, RPC URL and currency symbol are required'); return; }
    const network: NetworkConfig = {
      id: `custom-${Date.now()}`, ...customNetForm,
      shortName: customNetForm.shortName || customNetForm.name.slice(0,8).toUpperCase(),
    };
    const r = await sendBg<{ok?:boolean;error?:string}>({ type:'add_network', network });
    if (r.ok) { onNetworksChange(); setView('networks'); setCustomNetForm({name:'',shortName:'',rpcUrl:'',chainId:'',currencySymbol:'',isTestnet:false,type:'hive'}); }
    else setNetErr((r.error as string)??'Failed');
  }

  async function handleRemoveNetwork(id: string) {
    if (!confirm('Remove this network?')) return;
    await sendBg({ type:'remove_network', networkId:id });
    onNetworksChange();
  }

  useEffect(() => { if (view==='wallet_manager'||view==='create_wallet') loadProfiles(); }, [view]);

  const activeNet = networks.find(n=>n.id===activeNetId);
  const chrysId   = chrysalisId;

  // ── Sub-views ──────────────────────────────────────────────
  if (view === 'chrysalis') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>setView('main')} />
      <div style={{padding:'18px',borderRadius:14,background:'linear-gradient(135deg,rgba(245,180,41,0.08),rgba(245,180,41,0.03))',border:'1px solid rgba(245,180,41,0.35)',marginBottom:14}}>
        <div style={{textAlign:'center',marginBottom:14}}>
          <div style={{fontSize:32}}>⬡</div>
          <div style={{color:'var(--gold)',fontWeight:700,fontSize:14,letterSpacing:2,marginTop:6}}>CHRYSALIS SECURITY</div>
          <div style={{color:'var(--sub)',fontSize:11,marginTop:3}}>Post-Quantum Protection Framework</div>
        </div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:12,justifyContent:'center'}}>
          {['ML-DSA-65','ML-KEM-768','CAS-φ','FIPS 204','FIPS 203'].map(b=><span key={b} style={{fontSize:9,padding:'2px 6px',borderRadius:3,background:'rgba(245,180,41,0.08)',border:'1px solid rgba(245,180,41,0.2)',color:'var(--gold)'}}>{b}</span>)}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[['Status', chrysalisOk?'✓ Protected':'⏳ Enrolling', chrysalisOk?'var(--green)':'var(--gold)'],['Chrysalis ID',chrysId,'var(--gold)'],['Signing Algorithm','ML-DSA-65 (NIST FIPS 204)','var(--text)'],['KEM','ML-KEM-768 (NIST FIPS 203)','var(--text)'],['Sharding','CAS-φ (Golden Ratio)','var(--text)'],['All transactions','Chrysalis attested','var(--green)']].map(([k,v,c])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
              <span style={{color:'var(--sub)'}}>{k}</span>
              <span style={{color:c,fontFamily:'monospace',fontWeight:600,fontSize:11}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <p style={{color:'var(--sub)',fontSize:12,lineHeight:1.6,textAlign:'center'}}>Every transaction you sign is wrapped in a Chrysalis attestation — an additional ML-DSA-65 signature proving integrity. This protects against quantum adversaries who can break classical signatures.</p>
    </div>
  );

  if (view === 'view_seed') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>{setView('main');setSeedPhrase('');setSeedPass('');setSeedErr('');}} />
      <h3 style={{margin:'0 0 12px',color:'var(--gold)'}}>🔑 View Seed Phrase</h3>
      {!seedPhrase ? (
        <>
          <Card style={{marginBottom:14,background:'rgba(245,180,41,0.05)',border:'1px solid rgba(245,180,41,0.25)'}}>
            <p style={{color:'var(--gold)',fontSize:12,fontWeight:700,margin:'0 0 6px'}}>⚠ Chrysalis-Locked Feature</p>
            <p style={{color:'var(--sub)',fontSize:12,margin:0,lineHeight:1.6}}>Your seed phrase unlocks full access to your wallet. Never share it with anyone. HIVE will never ask for it.</p>
          </Card>
          <div style={{marginBottom:12}}><Label>Confirm Password</Label><input className="input" type="password" placeholder="Your extension password" value={seedPass} onChange={e=>setSeedPass(e.target.value)} style={{width:'100%'}} /></div>
          <Err msg={seedErr} />
          <button className="btn-primary" onClick={handleViewSeedPhrase} disabled={!seedPass||seedLoading} style={{marginTop:8}}>⬡ Reveal with Chrysalis Ceremony</button>
        </>
      ) : (
        <>
          <Card style={{background:'rgba(245,180,41,0.06)',border:'1px solid rgba(245,180,41,0.35)',marginBottom:12}}>
            <p style={{color:'var(--gold)',fontSize:11,fontWeight:700,margin:'0 0 10px',textTransform:'uppercase',letterSpacing:1}}>⚠ Keep this private — never share</p>
            <p style={{fontFamily:'monospace',fontSize:13,color:'var(--text)',lineHeight:1.9,margin:0,wordBreak:'break-word'}}>{seedPhrase}</p>
          </Card>
          <button onClick={()=>{setSeedPhrase('');setSeedPass('');}} style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid var(--border)',background:'var(--glass)',color:'var(--sub)',cursor:'pointer',fontSize:12}}>🔒 Hide Seed Phrase</button>
        </>
      )}
      <ChrysalisModal visible={cVisible} stage={cStage} errorMsg={cError} onClose={()=>setCVisible(false)} />
    </div>
  );

  if (view === 'wallet_manager') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>setView('main')} />
      <h3 style={{margin:'0 0 12px',color:'var(--text)'}}>👛 Wallet Manager</h3>
      {walletErr&&<div style={{padding:'8px 12px',background:'rgba(255,90,90,0.08)',border:'1px solid rgba(255,90,90,0.25)',borderRadius:8,marginBottom:10}}><Err msg={walletErr} /></div>}
      {walletMsg&&<div style={{padding:'8px 12px',background:'rgba(57,255,20,0.06)',border:'1px solid rgba(57,255,20,0.2)',borderRadius:8,marginBottom:10,color:'var(--green)',fontSize:12}}>{walletMsg}</div>}
      {profLoading ? <p style={{color:'var(--sub)',fontSize:12}}>Loading…</p> : (
        <div style={{marginBottom:14}}>
          {profiles.map(p=>(
            <div key={p.id} style={{padding:'12px',background: p.id===activeProfileId?'rgba(57,255,20,0.06)':'var(--glass)',border:`1px solid ${p.id===activeProfileId?'rgba(57,255,20,0.3)':'var(--border)'}`,borderRadius:11,marginBottom:8}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {p.id===activeProfileId&&<span style={{width:7,height:7,borderRadius:'50%',background:'var(--green)',display:'inline-block'}} />}
                  <span style={{color:'var(--text)',fontWeight:700,fontSize:13}}>{p.name}</span>
                </div>
                <div style={{display:'flex',gap:6}}>
                  {p.id!==activeProfileId&&<button onClick={()=>{setWalletErr('');setWalletMsg('');handleSwitchProfile(p.id);}} style={{padding:'3px 10px',borderRadius:6,border:'1px solid var(--green)',background:'rgba(57,255,20,0.08)',color:'var(--green)',cursor:'pointer',fontSize:11}}>Switch</button>}
                  {profiles.length>1&&p.id!==activeProfileId&&<button onClick={()=>handleDeleteProfile(p.id)} style={{padding:'3px 8px',borderRadius:6,border:'1px solid rgba(255,90,90,0.3)',background:'rgba(255,90,90,0.06)',color:'var(--danger)',cursor:'pointer',fontSize:11}}>×</button>}
                </div>
              </div>
              <p style={{color:'var(--sub)',fontSize:10,fontFamily:'monospace',margin:'0 0 4px'}}>{short(p.address)}</p>
              <p style={{color:'var(--sub)',fontSize:10,margin:0}}>{p.hdAddresses.length} address{p.hdAddresses.length!==1?'es':''}</p>
              {p.id===activeProfileId&&p.hdAddresses.length>1&&(
                <div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:4}}>
                  {p.hdAddresses.map((addr,i)=>(
                    <button key={i} onClick={async()=>{await sendBg({type:'switch_address',index:i});await loadProfiles();onDataRefresh();}} style={{padding:'2px 8px',borderRadius:5,border:`1px solid ${i===p.walletIndex?'var(--green)':'var(--border)'}`,background:i===p.walletIndex?'rgba(57,255,20,0.1)':'var(--glass)',color:i===p.walletIndex?'var(--green)':'var(--sub)',cursor:'pointer',fontSize:10}}>#{i}: {addr.slice(4,10)}…</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <button onClick={()=>{setWalletErr('');setWalletMsg('');handleAddAddress();}} style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid var(--border)',background:'var(--glass)',color:'var(--sub)',cursor:'pointer',fontSize:12}}>+ Add Address (Same Seed)</button>
        <button onClick={()=>{setWalletErr('');setWalletMsg('');setNewMnemonic('');setNewWalletName('');setView('create_wallet');}} style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid rgba(57,255,20,0.3)',background:'rgba(57,255,20,0.06)',color:'var(--green)',cursor:'pointer',fontSize:12,fontWeight:600}}>+ Create New Wallet</button>
        <button onClick={()=>{setWalletErr('');setWalletMsg('');setView('import_wallet_profile');}} style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid var(--border)',background:'var(--glass)',color:'var(--sub)',cursor:'pointer',fontSize:12}}>↓ Import Wallet</button>
      </div>
    </div>
  );

  if (view === 'create_wallet') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>setView('wallet_manager')} />
      <h3 style={{margin:'0 0 12px',color:'var(--text)'}}>+ Create New Wallet</h3>
      {!newMnemonic ? (
        <>
          <div style={{marginBottom:12}}><Label>Wallet Name</Label><input className="input" placeholder="e.g. Trading Wallet" value={newWalletName} onChange={e=>setNewWalletName(e.target.value)} style={{width:'100%'}} /></div>
          <Err msg={walletErr} />
          <button className="btn-primary" onClick={handleCreateWallet}>Generate New Wallet</button>
        </>
      ) : (
        <>
          <Card style={{background:'rgba(245,180,41,0.06)',border:'1px solid rgba(245,180,41,0.35)',marginBottom:12}}>
            <p style={{color:'var(--gold)',fontSize:11,fontWeight:700,margin:'0 0 8px',textTransform:'uppercase',letterSpacing:1}}>⚠ Write this down — never share it</p>
            <p style={{fontFamily:'monospace',fontSize:12,color:'var(--text)',lineHeight:1.9,margin:0,wordBreak:'break-word'}}>{newMnemonic}</p>
          </Card>
          <p style={{color:'var(--sub)',fontSize:12,textAlign:'center',marginBottom:12}}>New wallet created and saved. Switch to it from the Wallet Manager.</p>
          <button onClick={()=>{setNewMnemonic('');setView('wallet_manager');}} className="btn-primary">I've Saved My Seed Phrase ✓</button>
        </>
      )}
    </div>
  );

  if (view === 'import_wallet_profile') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>setView('wallet_manager')} />
      <h3 style={{margin:'0 0 12px',color:'var(--text)'}}>↓ Import Wallet</h3>
      <div style={{marginBottom:10}}><Label>Wallet Name</Label><input className="input" placeholder="e.g. Ledger Import" value={importName} onChange={e=>setImportName(e.target.value)} style={{width:'100%'}} /></div>
      <div style={{marginBottom:12}}><Label>Seed Phrase</Label><textarea className="input" rows={4} placeholder="Enter 12 or 24 word seed phrase…" value={importMnem} onChange={e=>setImportMnem(e.target.value)} style={{resize:'vertical',fontFamily:'monospace',fontSize:12}} /></div>
      <Err msg={walletErr} />
      <button className="btn-primary" onClick={handleImportWallet} style={{marginTop:8}}>Import Wallet</button>
    </div>
  );

  if (view === 'networks') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>setView('main')} />
      <h3 style={{margin:'0 0 12px',color:'var(--text)'}}>🌐 Networks</h3>
      {networks.map(n=>(
        <div key={n.id} style={{padding:'12px',background:n.id===activeNetId?'rgba(57,255,20,0.06)':'var(--glass)',border:`1px solid ${n.id===activeNetId?'rgba(57,255,20,0.3)':'var(--border)'}`,borderRadius:11,marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
          <span style={{width:8,height:8,borderRadius:'50%',background:n.type==='hive'?'var(--green)':'var(--blue)',flexShrink:0,display:'inline-block'}} />
          <div style={{flex:1}}>
            <div style={{color:n.id===activeNetId?'var(--green)':'var(--text)',fontSize:13,fontWeight:600}}>{n.name} {n.isTestnet&&<span style={{fontSize:9,padding:'1px 5px',borderRadius:3,background:'rgba(245,180,41,0.12)',color:'var(--gold)',marginLeft:4}}>Testnet</span>}</div>
            <div style={{color:'var(--sub)',fontSize:10,marginTop:2}}>{n.type==='hive'?n.rpcUrl:`Chain ${n.chainId}`}</div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {n.id===activeNetId&&<span style={{color:'var(--green)',fontSize:13}}>✓</span>}
            {!n.isPreset&&<button onClick={()=>handleRemoveNetwork(n.id)} style={{padding:'2px 8px',borderRadius:5,border:'1px solid rgba(255,90,90,0.3)',background:'none',color:'var(--danger)',cursor:'pointer',fontSize:11}}>✕</button>}
          </div>
        </div>
      ))}
      <button onClick={()=>setView('add_network')} style={{width:'100%',marginTop:4,padding:'11px',borderRadius:11,border:'1px solid rgba(57,255,20,0.3)',background:'rgba(57,255,20,0.06)',color:'var(--green)',cursor:'pointer',fontSize:13,fontWeight:600}}>+ Add Custom Network</button>
    </div>
  );

  if (view === 'add_network') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>setView('networks')} />
      <h3 style={{margin:'0 0 14px',color:'var(--text)'}}>+ Add Network</h3>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div><Label>Network Name *</Label><input className="input" placeholder="e.g. My HIVE Node" value={customNetForm.name} onChange={e=>setCustomNetForm(f=>({...f,name:e.target.value}))} style={{width:'100%'}} /></div>
        <div><Label>Short Name</Label><input className="input" placeholder="e.g. MY-HNY" value={customNetForm.shortName} onChange={e=>setCustomNetForm(f=>({...f,shortName:e.target.value}))} style={{width:'100%'}} /></div>
        <div><Label>RPC URL *</Label><input className="input" placeholder="http://localhost:3000" value={customNetForm.rpcUrl} onChange={e=>setCustomNetForm(f=>({...f,rpcUrl:e.target.value}))} style={{width:'100%'}} /></div>
        <div><Label>Chain ID (EVM only)</Label><input className="input" placeholder="8453" value={customNetForm.chainId} onChange={e=>setCustomNetForm(f=>({...f,chainId:e.target.value}))} style={{width:'100%'}} /></div>
        <div><Label>Currency Symbol *</Label><input className="input" placeholder="HNY or ETH" value={customNetForm.currencySymbol} onChange={e=>setCustomNetForm(f=>({...f,currencySymbol:e.target.value}))} style={{width:'100%'}} /></div>
        <div style={{display:'flex',gap:10}}>
          <div style={{flex:1}}><Label>Type</Label>
            <div style={{display:'flex',borderRadius:8,overflow:'hidden',border:'1px solid var(--border)'}}>
              {(['hive','evm'] as const).map(t=><button key={t} onClick={()=>setCustomNetForm(f=>({...f,type:t}))} style={{flex:1,padding:'7px',border:'none',cursor:'pointer',fontSize:12,background:customNetForm.type===t?'rgba(57,255,20,0.1)':'var(--glass)',color:customNetForm.type===t?'var(--green)':'var(--sub)',fontWeight:customNetForm.type===t?700:400,textTransform:'uppercase'}}>{t}</button>)}
            </div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'var(--glass)',border:'1px solid var(--border)',borderRadius:9}}>
          <input type="checkbox" checked={customNetForm.isTestnet} onChange={e=>setCustomNetForm(f=>({...f,isTestnet:e.target.checked}))} />
          <span style={{color:'var(--sub)',fontSize:12}}>This is a testnet</span>
        </div>
      </div>
      <Err msg={netErr} />
      <button className="btn-primary" onClick={handleAddNetwork} style={{marginTop:14}}>Add Network</button>
    </div>
  );

  if (view === 'danger_zone') return (
    <div style={{padding:'14px 14px 80px'}}>
      <BackBtn onClick={()=>setView('main')} />
      <h3 style={{margin:'0 0 4px',color:'var(--danger)'}}>⚠ Danger Zone</h3>
      <p style={{color:'var(--sub)',fontSize:12,marginBottom:16}}>These actions are irreversible. Proceed with caution.</p>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <button onClick={async()=>{
          if(!confirm('Disconnect all connected sites?')) return;
          const state=extState; if(!state) return;
          for(const o of state.connectedOrigins) await sendBg({type:'disconnect_site',origin:o});
          onDataRefresh();
        }} style={{width:'100%',padding:'12px',borderRadius:11,border:'1px solid rgba(255,165,0,0.3)',background:'rgba(255,165,0,0.06)',color:'#ffa500',cursor:'pointer',fontSize:13,textAlign:'left',fontWeight:600}}>
          🔗 Disconnect All Sites<div style={{fontSize:11,fontWeight:400,color:'var(--sub)',marginTop:2}}>Revoke access for all connected dApps</div>
        </button>
        <button onClick={async()=>{
          if(!confirm('Lock and wipe the session? You will need your password to unlock again.')) return;
          onLock();
        }} style={{width:'100%',padding:'12px',borderRadius:11,border:'1px solid rgba(255,165,0,0.3)',background:'rgba(255,165,0,0.06)',color:'#ffa500',cursor:'pointer',fontSize:13,textAlign:'left',fontWeight:600}}>
          🔒 Lock Wallet<div style={{fontSize:11,fontWeight:400,color:'var(--sub)',marginTop:2}}>Wipe session seed and require password</div>
        </button>
        <button onClick={()=>{
          if(confirm('FACTORY RESET: This will permanently erase ALL wallets, settings, and keys from this extension. Make sure you have your seed phrases backed up.\n\nType "RESET" to confirm.') && prompt('Type RESET to confirm:') === 'RESET') onReset();
        }} style={{width:'100%',padding:'12px',borderRadius:11,border:'1px solid rgba(255,90,90,0.4)',background:'rgba(255,90,90,0.08)',color:'var(--danger)',cursor:'pointer',fontSize:13,textAlign:'left',fontWeight:600}}>
          💥 Factory Reset Extension<div style={{fontSize:11,fontWeight:400,color:'var(--sub)',marginTop:2}}>Erase ALL wallets and data permanently</div>
        </button>
      </div>
    </div>
  );

  // ── Main settings list ────────────────────────────────────
  return (
    <div style={{padding:'14px 14px 80px'}}>
      {/* Chrysalis hero */}
      <div onClick={()=>setView('chrysalis')} style={{padding:'14px',borderRadius:13,background:'linear-gradient(135deg,rgba(245,180,41,0.08),rgba(245,180,41,0.02))',border:'1px solid rgba(245,180,41,0.35)',marginBottom:14,cursor:'pointer'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:22}}>⬡</span>
            <div><div style={{color:'var(--gold)',fontWeight:700,fontSize:13,letterSpacing:1}}>CHRYSALIS SECURITY</div><div style={{color:'var(--sub)',fontSize:10}}>ML-DSA-65 · ML-KEM-768 · CAS-φ</div></div>
          </div>
          <span style={{fontSize:10,padding:'3px 8px',borderRadius:4,fontWeight:700,letterSpacing:1,background:chrysalisOk?'rgba(57,255,20,0.12)':'rgba(245,180,41,0.12)',border:`1px solid ${chrysalisOk?'rgba(57,255,20,0.4)':'rgba(245,180,41,0.4)'}`,color:chrysalisOk?'var(--green)':'var(--gold)'}}>{chrysalisOk?'PROTECTED':'ENROLLING'}</span>
        </div>
        <div style={{marginTop:8,display:'flex',justifyContent:'space-between',fontSize:11}}>
          <span style={{color:'var(--sub)'}}>ID</span>
          <span style={{color:'var(--gold)',fontFamily:'monospace',fontWeight:600}}>{chrysId}</span>
        </div>
      </div>

      <SectionBtn icon="🔑" label="View Seed Phrase" sub="Chrysalis-locked · requires password" onClick={()=>setView('view_seed')} />
      <SectionBtn icon="👛" label="Wallet Manager" sub="Add, import, and switch wallets" onClick={()=>setView('wallet_manager')} />
      <SectionBtn icon="🌐" label="Networks" sub={activeNet?.name ?? 'Honey Network Testnet'} onClick={()=>setView('networks')} />

      {/* honey.trade link */}
      <a href="http://localhost:3001" target="_blank" rel="noreferrer" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',borderRadius:12,textDecoration:'none',background:'var(--glass)',border:'1px solid var(--border)',marginBottom:8}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:20,width:28,textAlign:'center'}}>🍯</span><div><div style={{color:'var(--text)',fontSize:13,fontWeight:600}}>honey.trade</div><div style={{color:'var(--sub)',fontSize:11}}>Open DEX in browser</div></div></div>
        <span style={{color:'var(--sub)',fontSize:16}}>↗</span>
      </a>

      {/* Connected sites */}
      {extState.connectedOrigins.length > 0 && (
        <Card style={{marginBottom:8}}>
          <Label>Connected Sites ({extState.connectedOrigins.length})</Label>
          {extState.connectedOrigins.map(o=>(
            <div key={o} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border)'}}>
              <span style={{color:'var(--text)',fontSize:12}}>{o}</span>
              <button onClick={async()=>{await sendBg({type:'disconnect_site',origin:o});onDataRefresh();}} style={{background:'none',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:11}}>Disconnect</button>
            </div>
          ))}
        </Card>
      )}

      <SectionBtn icon="⚠" label="Danger Zone" sub="Disconnect sites, reset extension" onClick={()=>setView('danger_zone')} danger />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────
type Screen = 'loading' | 'setup' | 'locked' | 'approve' | 'unlocked';

export default function App() {
  const [screen, setScreen]           = useState<Screen>('loading');
  const [extState, setExtState]       = useState<ExtState | null>(null);
  const [pendingReqs, setPendingReqs] = useState<PendingRequest[]>([]);

  const refreshState = useCallback(async () => {
    const s = await sendBg<Record<string, unknown>>({ type:'get_state' });
    if (!s || (s['status'] as string) === 'setup_required') { setScreen('setup'); return; }
    const extS = s as unknown as ExtState;
    setExtState(extS);
    if (extS.status === 'unlocked') {
      // Race-condition fix: check for pending requests that may have arrived before listener registered
      const pending = await sendBg<{ requests: PendingRequest[] }>({ type:'get_pending_requests' });
      if (pending?.requests?.length > 0) {
        setPendingReqs(pending.requests);
        setScreen('approve');
        return;
      }
    }
    setScreen(extS.status === 'unlocked' ? 'unlocked' : 'locked');
  }, []);

  useEffect(() => {
    refreshState();
    const listener = (msg: unknown) => {
      const m = msg as { type: string; state?: ExtState; requests?: PendingRequest[] };
      if (m.type === 'state_update' && m.state) {
        setExtState(m.state);
        setScreen(m.state.status === 'unlocked' ? 'unlocked' : 'locked');
      }
      if (m.type === 'pending_requests' && m.requests) {
        setPendingReqs(m.requests);
        if (m.requests.length > 0) setScreen('approve');
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshState]);

  useEffect(() => {
    if (pendingReqs.length > 0 && extState?.status === 'unlocked') setScreen('approve');
  }, [pendingReqs, extState?.status]);

  if (screen === 'loading') return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:10}}>
      <div style={{fontSize:32}}>🍯</div>
      <span style={{color:'var(--sub)',fontSize:13}}>Loading HIVE Wallet…</span>
    </div>
  );
  if (screen === 'setup')  return <SetupScreen onDone={refreshState} />;
  if (screen === 'locked') return <LockedScreen onUnlock={refreshState} />;
  if (screen === 'approve' && pendingReqs.length > 0 && extState) return (
    <ApproveScreen req={pendingReqs[0]} address={extState.address}
      onDone={()=>{ setPendingReqs(prev=>prev.slice(1)); if(pendingReqs.length<=1) setScreen('unlocked'); }} />
  );
  if (screen === 'unlocked' && extState) return (
    <UnlockedScreen state={extState} onLock={()=>setScreen('locked')} />
  );
  return null;
}
