'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useHiveWallet } from '@/components/HiveWalletConnect';
import { getWalletCollections } from '@/lib/api';
import type { NftCollection } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type MediaType = 'photo' | 'audio' | 'video' | 'document';
type CollectionMode = 'none' | 'existing' | 'create';
type ReleaseType = 'immediate' | 'scheduled';
type PricingMode = 'unlisted' | 'fixed';
type Step = 'upload' | 'metadata' | 'collection' | 'edition' | 'pricing' | 'confirm';
type MintStatus = 'idle' | 'signing' | 'uploading' | 'success' | 'error';

type HiveWin = {
  hive?: {
    sign?: (msg: string) => Promise<{ signature: string; address: string; publicKeyHex?: string }>;
    accounts?: () => Promise<string[]>;
    requestAccounts?: () => Promise<string[]>;
  };
};

const MINT_API_BASE = typeof window !== 'undefined' ? '/api' : 'http://localhost:3000';

interface UploadedFile {
  file: File;
  preview?: string; // object URL for images
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS: Step[] = ['upload', 'metadata', 'collection', 'edition', 'pricing', 'confirm'];
const STEP_LABELS: Record<Step, string> = {
  upload: 'Upload',
  metadata: 'Details',
  collection: 'Collection',
  edition: 'Edition',
  pricing: 'Pricing',
  confirm: 'Confirm',
};

const MEDIA_ACCEPT: Record<MediaType, string> = {
  photo: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
  document: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*',
};

const LOCK_TIERS = [
  { days: 0, label: 'No lock', color: '#aaa' },
  { days: 30, label: '30 days', color: '#39ff14' },
  { days: 90, label: '90 days', color: '#f5b429' },
  { days: 180, label: '6 months', color: '#ff6b35' },
  { days: 365, label: '1 year', color: '#ff4444' },
];

// ── Flat mint fee tiers (same price regardless of copy count within tier) ──────
function getMintFee(copies: number): number {
  if (copies >= 20000) return 1.00;   // 20k–30k edition
  if (copies >= 10000) return 0.55;   // 10k–20k edition
  return 0.20;                        // 1–9,999 copies
}
function getMintFeeTierLabel(copies: number): string {
  if (copies >= 20000) return '20,000–30,000 edition';
  if (copies >= 10000) return '10,000–19,999 edition';
  return copies === 1 ? '1/1 original' : '1–9,999 copies';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function detectMediaType(file: File): MediaType {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

function fileIcon(mediaType: MediaType) {
  return { photo: '🖼', audio: '🎵', video: '🎬', document: '📄' }[mediaType];
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: Step }) {
  const ci = STEPS.indexOf(current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32 }}>
      {STEPS.map((s, i) => {
        const done = i < ci;
        const active = i === ci;
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: done ? '#39ff14' : active ? '#39ff14' : '#111',
                border: `2px solid ${done || active ? '#39ff14' : '#333'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                color: done || active ? '#000' : '#555',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 10, color: active ? '#39ff14' : done ? '#39ff14' : '#555', whiteSpace: 'nowrap' }}>
                {STEP_LABELS[s]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? '#39ff14' : '#1e2a1e', margin: '0 4px', marginBottom: 16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MintPage() {
  const { address: wallet, isAuthUser, authUser } = useHiveWallet();
  const authToken = authUser?.token ?? null;

  // Step state
  const [step, setStep] = useState<Step>('upload');

  // Upload
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Metadata
  const [mediaType, setMediaType] = useState<MediaType>('photo');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  // Collection
  const [collMode, setCollMode] = useState<CollectionMode>('none');
  const [collections, setCollections] = useState<NftCollection[]>([]);
  const [selectedColl, setSelectedColl] = useState('');
  const [newCollName, setNewCollName] = useState('');
  const [newCollDesc, setNewCollDesc] = useState('');
  const [newCollTags, setNewCollTags] = useState('');

  // Edition
  const [copies, setCopies] = useState(1);
  const [royaltyPct, setRoyaltyPct] = useState(5);

  // Pricing
  const [pricingMode, setPricingMode] = useState<PricingMode>('unlisted');
  const [listPrice, setListPrice] = useState('');
  const [listDays, setListDays] = useState(30);
  const [releaseType, setReleaseType] = useState<ReleaseType>('immediate');
  const [releaseDate, setReleaseDate] = useState('');

  // Mint status
  const [mintStatus, setMintStatus] = useState<MintStatus>('idle');
  const [mintError, setMintError] = useState('');
  const [mintedId, setMintedId] = useState('');

  // Load wallet collections when reaching collection step
  useEffect(() => {
    if (step === 'collection' && wallet) {
      getWalletCollections(wallet)
        .then(d => setCollections(d.collections))
        .catch(() => {});
    }
  }, [step, wallet]);

  // ── File handling ────────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const newUploads: UploadedFile[] = arr.map(f => {
      const uf: UploadedFile = { file: f };
      if (f.type.startsWith('image/')) uf.preview = URL.createObjectURL(f);
      return uf;
    });
    setFiles(prev => {
      const combined = [...prev, ...newUploads].slice(0, 30);
      if (combined.length > 0) {
        setMediaType(detectMediaType(combined[0].file));
      }
      return combined;
    });
  }, []);

  const removeFile = (i: number) => {
    setFiles(prev => {
      const next = [...prev];
      if (next[i].preview) URL.revokeObjectURL(next[i].preview!);
      next.splice(i, 1);
      if (next.length > 0) setMediaType(detectMediaType(next[0].file));
      return next;
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  // ── Navigation ───────────────────────────────────────────────────────────

  const canNext: Record<Step, boolean> = {
    upload: files.length > 0,
    metadata: name.trim().length > 0,
    collection: true,
    edition: copies >= 1 && copies <= 30000,
    pricing: pricingMode === 'unlisted' || (parseFloat(listPrice) > 0),
    confirm: mintStatus === 'idle' || mintStatus === 'error',
  };

  const next = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  };
  const back = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  // ── Mint ─────────────────────────────────────────────────────────────────

  async function handleMint() {
    if (!wallet) return;

    const hiveExt = (window as HiveWin).hive;

    // Determine signing method
    const canSign = isAuthUser ? !!authToken : !!hiveExt?.sign;
    if (!canSign) {
      setMintError(isAuthUser
        ? 'Session expired. Please log in again.'
        : 'HIVE Wallet extension not detected. Please install it or log in with a platform account to mint.');
      setMintStatus('error');
      return;
    }

    setMintStatus('signing');
    setMintError('');

    try {
      // If extension user, ensure it's authorized
      if (!isAuthUser && hiveExt?.requestAccounts) {
        const accounts = await hiveExt.requestAccounts();
        if (!accounts || accounts.length === 0) {
          throw new Error('No wallet connected in extension. Unlock your HIVE Wallet extension first.');
        }
      }

      // Generate nftId client-side so we can sign it
      const nftId = `nft_${randomHex(16)}`;
      const ts = Date.now();
      const message = `mint|${wallet}|${nftId}|${ts}`;

      let signatureHex: string;
      if (isAuthUser && authToken) {
        // Platform account: sign server-side via session key
        const resp = await fetch(`${MINT_API_BASE}/auth/sign-tx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ message }),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error((e as { error?: string }).error || 'Signing failed');
        }
        const sigData = await resp.json() as { signatureHex: string };
        signatureHex = sigData.signatureHex;
      } else {
        // Extension wallet: sign via window.hive.sign()
        const sigResult = await hiveExt!.sign!(message);
        // sign() returns { signature, address, publicKeyHex } — extract the hex string
        signatureHex = typeof sigResult === 'string'
          ? sigResult
          : (sigResult as { signature: string }).signature;
      }

      setMintStatus('uploading');

      // Build FormData for multipart upload
      const fd = new FormData();
      fd.append('wallet', wallet);
      fd.append('signatureHex', signatureHex);
      fd.append('client_nft_id', nftId);
      fd.append('timestamp', String(ts));
      fd.append('name', name.trim());
      fd.append('description', description.trim());
      fd.append('tags', tags.trim());
      fd.append('mediaType', mediaType);
      fd.append('royalty_bps', String(Math.round(royaltyPct * 100)));
      fd.append('copy_count', String(copies));

      // Collection
      if (collMode === 'existing' && selectedColl) {
        fd.append('collection_mode', 'existing');
        fd.append('collection_id', selectedColl);
      } else if (collMode === 'create' && newCollName.trim()) {
        fd.append('collection_mode', 'create');
        fd.append('new_coll_name', newCollName.trim());
        fd.append('new_coll_desc', newCollDesc.trim());
        fd.append('new_coll_tags', newCollTags.trim());
      } else {
        fd.append('collection_mode', 'none');
      }

      // Pricing
      if (pricingMode === 'fixed' && parseFloat(listPrice) > 0) {
        fd.append('list_price_hny', listPrice);
        fd.append('list_duration_days', String(listDays));
      }

      // Release schedule
      if (releaseType === 'scheduled' && releaseDate) {
        fd.append('release_type', 'scheduled');
        fd.append('release_at_ms', String(new Date(releaseDate).getTime()));
      } else {
        fd.append('release_type', 'immediate');
      }

      // Files
      files.forEach(uf => fd.append('files', uf.file));

      const res = await fetch('/api/nft/mint', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      setMintedId(data.nftIds?.[0] || nftId);
      setMintStatus('success');
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMintError(err?.message ?? 'Mint failed');
      setMintStatus('error');
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const card = (content: React.ReactNode) => (
    <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 16, padding: 28 }}>
      {content}
    </div>
  );

  const label = (text: string) => (
    <div style={{ color: '#aaa', fontSize: 13, marginBottom: 6, fontWeight: 600 }}>{text}</div>
  );

  const input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      {...props}
      style={{
        width: '100%', background: '#111', border: '1px solid #1e2a1e', borderRadius: 8,
        color: '#fff', padding: '10px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
        ...props.style,
      }}
    />
  );

  const textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea
      {...props}
      style={{
        width: '100%', background: '#111', border: '1px solid #1e2a1e', borderRadius: 8,
        color: '#fff', padding: '10px 12px', fontSize: 14, outline: 'none',
        resize: 'vertical', minHeight: 80, boxSizing: 'border-box',
        ...props.style,
      }}
    />
  );

  const hasExt = typeof window !== 'undefined' && !!(window as HiveWin).hive?.sign;
  const canMint = isAuthUser || hasExt;

  // ── Success screen ─────────────────────────────────────────────────────────

  if (mintStatus === 'success') {
    return (
      <div style={{ minHeight: '100vh', background: '#040507', color: '#e0e0e0', fontFamily: 'Space Grotesk, sans-serif', padding: '92px 16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h1 style={{ color: '#39ff14', fontSize: 28, fontWeight: 800, marginBottom: 8 }}>NFT Minted!</h1>
          <p style={{ color: '#aaa', marginBottom: 32 }}>
            Your NFT{copies > 1 ? 's have' : ' has'} been minted on the HIVE network.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href={`/nft/${mintedId}`}
              style={{ background: '#39ff14', color: '#000', borderRadius: 10, padding: '12px 28px', fontWeight: 700, textDecoration: 'none', fontSize: 15 }}>
              View NFT →
            </Link>
            <Link href="/nft"
              style={{ background: '#111', color: '#aaa', border: '1px solid #333', borderRadius: 10, padding: '12px 28px', fontWeight: 600, textDecoration: 'none', fontSize: 15 }}>
              Marketplace
            </Link>
            <button
              onClick={() => {
                setStep('upload'); setFiles([]); setName(''); setDescription(''); setTags('');
                setCollMode('none'); setCopies(1); setRoyaltyPct(5);
                setPricingMode('unlisted'); setListPrice(''); setMintStatus('idle'); setMintError('');
              }}
              style={{ background: '#111', color: '#39ff14', border: '1px solid #39ff14', borderRadius: 10, padding: '12px 28px', fontWeight: 600, cursor: 'pointer', fontSize: 15 }}>
              Mint Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#040507', color: '#e0e0e0', fontFamily: 'Space Grotesk, sans-serif', padding: '92px 16px 24px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#39ff14', letterSpacing: -1, margin: 0 }}>🎨 Mint NFT</h1>
          <p style={{ color: '#666', marginTop: 6 }}>Create and mint your digital art on HIVE.</p>
        </div>

        {/* Wallet gate */}
        {!wallet ? (
          <div style={{ background: '#0d1117', border: '1px solid #1e2a1e', borderRadius: 16, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔐</div>
            <p style={{ color: '#aaa', marginBottom: 16 }}>Connect your HIVE Wallet to mint NFTs.</p>
            <p style={{ color: '#555', fontSize: 13 }}>Use the wallet connect button in the top-right corner.</p>
          </div>
        ) : (
          <>
            <StepBar current={step} />

            {/* ── Step: Upload ───────────────────────────────────────────── */}
            {step === 'upload' && card(
              <>
                <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Upload Files</h2>
                <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>
                  Supports photos, audio, video, documents. Up to 30 files, 500 MB each.
                </p>

                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragging ? '#39ff14' : '#1e2a1e'}`,
                    borderRadius: 12, padding: '40px 20px', textAlign: 'center',
                    cursor: 'pointer', transition: 'border-color 0.2s',
                    background: dragging ? 'rgba(57,255,20,0.04)' : 'transparent',
                    marginBottom: files.length ? 20 : 0,
                  }}
                >
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
                  <div style={{ color: '#39ff14', fontWeight: 700, marginBottom: 4 }}>
                    Drag &amp; drop files here
                  </div>
                  <div style={{ color: '#555', fontSize: 13 }}>or click to browse</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,audio/*,video/*,application/pdf,text/*"
                    style={{ display: 'none' }}
                    onChange={e => e.target.files && addFiles(e.target.files)}
                  />
                </div>

                {/* File list */}
                {files.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {files.map((uf, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#111', borderRadius: 8, padding: '10px 12px' }}>
                        {uf.preview ? (
                          <img src={uf.preview} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 40, height: 40, background: '#1e2a1e', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                            {fileIcon(detectMediaType(uf.file))}
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uf.file.name}</div>
                          <div style={{ color: '#555', fontSize: 11 }}>{fmtSize(uf.file.size)}</div>
                        </div>
                        <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18, padding: 4 }}>×</button>
                      </div>
                    ))}
                    <button onClick={() => fileInputRef.current?.click()} style={{ background: 'none', border: '1px dashed #333', borderRadius: 8, color: '#39ff14', padding: '8px', fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
                      + Add more files
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Step: Metadata ─────────────────────────────────────────── */}
            {step === 'metadata' && card(
              <>
                <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 20px' }}>NFT Details</h2>

                <div style={{ marginBottom: 16 }}>
                  {label('Media Type')}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['photo', 'audio', 'video', 'document'] as MediaType[]).map(t => (
                      <button key={t} onClick={() => setMediaType(t)}
                        style={{ background: mediaType === t ? '#39ff14' : '#111', color: mediaType === t ? '#000' : '#aaa', border: `1px solid ${mediaType === t ? '#39ff14' : '#333'}`, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                        {fileIcon(t)} {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  {label('Name *')}
                  {input({ value: name, onChange: e => setName(e.target.value), placeholder: 'Give your NFT a name', maxLength: 120 })}
                </div>

                <div style={{ marginBottom: 16 }}>
                  {label('Description')}
                  {textarea({ value: description, onChange: e => setDescription(e.target.value), placeholder: 'Describe your NFT (optional)', maxLength: 2000 })}
                </div>

                <div style={{ marginBottom: 4 }}>
                  {label('Tags')}
                  {input({ value: tags, onChange: e => setTags(e.target.value), placeholder: 'art, music, photography … (comma-separated)' })}
                </div>
              </>
            )}

            {/* ── Step: Collection ──────────────────────────────────────── */}
            {step === 'collection' && card(
              <>
                <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Collection</h2>
                <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>Group your NFT into a collection (optional).</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {([
                    { mode: 'none' as CollectionMode, label: 'No collection', desc: 'Standalone NFT' },
                    { mode: 'existing' as CollectionMode, label: 'Add to existing', desc: 'Pick one of your collections' },
                    { mode: 'create' as CollectionMode, label: 'Create new', desc: 'Start a new collection' },
                  ]).map(opt => (
                    <div key={opt.mode}
                      onClick={() => setCollMode(opt.mode)}
                      style={{ border: `1px solid ${collMode === opt.mode ? '#39ff14' : '#1e2a1e'}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer', background: collMode === opt.mode ? 'rgba(57,255,20,0.05)' : 'transparent' }}>
                      <div style={{ color: collMode === opt.mode ? '#39ff14' : '#fff', fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
                      <div style={{ color: '#555', fontSize: 12, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>

                {collMode === 'existing' && (
                  <div>
                    {label('Select collection')}
                    {collections.length === 0 ? (
                      <p style={{ color: '#555', fontSize: 13 }}>No collections found. Create one first.</p>
                    ) : (
                      <select value={selectedColl} onChange={e => setSelectedColl(e.target.value)}
                        style={{ width: '100%', background: '#111', border: '1px solid #1e2a1e', borderRadius: 8, color: '#fff', padding: '10px 12px', fontSize: 14 }}>
                        <option value="">— Choose —</option>
                        {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                )}

                {collMode === 'create' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      {label('Collection Name *')}
                      {input({ value: newCollName, onChange: e => setNewCollName(e.target.value), placeholder: 'My Collection', maxLength: 80 })}
                    </div>
                    <div>
                      {label('Description')}
                      {textarea({ value: newCollDesc, onChange: e => setNewCollDesc(e.target.value), placeholder: 'About this collection', style: { minHeight: 60 } })}
                    </div>
                    <div>
                      {label('Tags')}
                      {input({ value: newCollTags, onChange: e => setNewCollTags(e.target.value), placeholder: 'art, photography …' })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Step: Edition ─────────────────────────────────────────── */}
            {step === 'edition' && card(
              <>
                <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Edition &amp; Royalties</h2>
                <p style={{ color: '#666', fontSize: 13, marginBottom: 24 }}>
                  Choose between a 1/1 original or a numbered edition. Set royalties for secondary sales.
                </p>

                <div style={{ marginBottom: 24 }}>
                  {label('Number of copies')}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {[1, 5, 10, 100, 1000].map(n => (
                      <button key={n} onClick={() => setCopies(n)}
                        style={{ background: copies === n ? '#39ff14' : '#111', color: copies === n ? '#000' : '#aaa', border: `1px solid ${copies === n ? '#39ff14' : '#333'}`, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        {n === 1 ? '1/1' : `${n}×`}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {input({
                      type: 'number', min: 1, max: 30000, value: copies,
                      onChange: e => setCopies(Math.max(1, Math.min(30000, parseInt(e.target.value) || 1))),
                      style: { width: 120 },
                    })}
                    <span style={{ color: '#555', fontSize: 13 }}>copies (max 30,000)</span>
                  </div>
                  {copies > 1 && <p style={{ color: '#f5b429', fontSize: 12, marginTop: 6 }}>Each copy will be named &ldquo;{name || 'NFT'} #1&rdquo;, &ldquo;#2&rdquo;, etc.</p>}
                </div>

                <div>
                  {label(`Creator Royalty: ${royaltyPct}%`)}
                  <input type="range" min={0} max={20} step={0.5} value={royaltyPct}
                    onChange={e => setRoyaltyPct(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: '#39ff14' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555', fontSize: 11, marginTop: 4 }}>
                    <span>0%</span><span>10%</span><span>20%</span>
                  </div>
                  <p style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
                    You receive {royaltyPct}% of every secondary sale automatically.
                  </p>
                  <div style={{ background: '#111', borderRadius: 8, padding: '10px 14px', marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#555', fontSize: 13 }}>Mint fee</span>
                    <span style={{ color: '#f5b429', fontFamily: 'Space Mono, monospace', fontSize: 13 }}>{getMintFee(copies).toFixed(2)} HNY · {getMintFeeTierLabel(copies)}</span>
                  </div>
                </div>
              </>
            )}

            {/* ── Step: Pricing ─────────────────────────────────────────── */}
            {step === 'pricing' && card(
              <>
                <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Pricing &amp; Release</h2>
                <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>
                  List immediately or save as unlisted. You can always list later from your wallet.
                </p>

                <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
                  {([
                    { mode: 'unlisted' as PricingMode, label: 'Mint unlisted', icon: '🔒' },
                    { mode: 'fixed' as PricingMode, label: 'List for sale', icon: '💰' },
                  ]).map(opt => (
                    <div key={opt.mode} onClick={() => setPricingMode(opt.mode)}
                      style={{ flex: 1, border: `1px solid ${pricingMode === opt.mode ? '#39ff14' : '#1e2a1e'}`, borderRadius: 10, padding: '14px', cursor: 'pointer', background: pricingMode === opt.mode ? 'rgba(57,255,20,0.05)' : 'transparent', textAlign: 'center' }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>{opt.icon}</div>
                      <div style={{ color: pricingMode === opt.mode ? '#39ff14' : '#fff', fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
                    </div>
                  ))}
                </div>

                {pricingMode === 'fixed' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
                    <div>
                      {label('Price (HNY)')}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {input({ type: 'number', min: 0.01, step: 0.01, value: listPrice, onChange: e => setListPrice(e.target.value), placeholder: '0.00', style: { width: 160 } })}
                        <span style={{ color: '#f5b429', fontSize: 14, fontWeight: 600 }}>HNY</span>
                      </div>
                    </div>
                    <div>
                      {label(`Listing duration: ${listDays} days`)}
                      <input type="range" min={1} max={365} value={listDays} onChange={e => setListDays(parseInt(e.target.value))}
                        style={{ width: '100%', accentColor: '#39ff14' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555', fontSize: 11, marginTop: 4 }}>
                        {LOCK_TIERS.slice(1).map(t => <span key={t.days}>{t.label}</span>)}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ borderTop: '1px solid #1e2a1e', paddingTop: 20 }}>
                  {label('Release')}
                  <div style={{ display: 'flex', gap: 10, marginBottom: releaseType === 'scheduled' ? 14 : 0 }}>
                    {([
                      { rt: 'immediate' as ReleaseType, label: 'Mint now' },
                      { rt: 'scheduled' as ReleaseType, label: 'Schedule' },
                    ]).map(opt => (
                      <button key={opt.rt} onClick={() => setReleaseType(opt.rt)}
                        style={{ background: releaseType === opt.rt ? '#39ff14' : '#111', color: releaseType === opt.rt ? '#000' : '#aaa', border: `1px solid ${releaseType === opt.rt ? '#39ff14' : '#333'}`, borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {releaseType === 'scheduled' && (
                    <div style={{ marginTop: 12 }}>
                      {label('Release date & time')}
                      {input({ type: 'datetime-local', value: releaseDate, onChange: e => setReleaseDate(e.target.value), min: new Date().toISOString().slice(0, 16) })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Step: Confirm ──────────────────────────────────────────── */}
            {step === 'confirm' && card(
              <>
                <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 20px' }}>Review &amp; Mint</h2>

                {/* Summary table */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {[
                    { label: 'Name', value: name },
                    { label: 'Media type', value: <span style={{ textTransform: 'capitalize' }}>{fileIcon(mediaType)} {mediaType}</span> },
                    { label: 'Files', value: `${files.length} file${files.length > 1 ? 's' : ''}` },
                    { label: 'Copies', value: copies === 1 ? '1/1 Original' : `${copies} editions` },
                    { label: 'Royalty', value: `${royaltyPct}%` },
                    { label: 'Collection', value: collMode === 'none' ? 'None' : collMode === 'create' ? `New: ${newCollName}` : collections.find(c => c.id === selectedColl)?.name || '—' },
                    { label: 'Listing', value: pricingMode === 'unlisted' ? 'Unlisted' : `${listPrice} HNY for ${listDays} days` },
                    { label: 'Release', value: releaseType === 'immediate' ? 'Immediately' : new Date(releaseDate).toLocaleString() },
                    { label: 'Mint fee', value: <span style={{ color: '#f5b429', fontFamily: 'Space Mono, monospace' }}>{getMintFee(copies).toFixed(2)} HNY</span> },
                  ].map(({ label: l, value }) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #111', paddingBottom: 10 }}>
                      <span style={{ color: '#666', fontSize: 13 }}>{l}</span>
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, maxWidth: '55%', textAlign: 'right' }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* File previews */}
                {files.some(f => f.preview) && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                    {files.filter(f => f.preview).slice(0, 6).map((uf, i) => (
                      <img key={i} src={uf.preview!} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #1e2a1e' }} />
                    ))}
                  </div>
                )}

                {/* Extension status */}
                {!hasExt && (
                  <div style={{ background: 'rgba(255,68,68,0.08)', border: '1px solid #ff4444', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                    <div style={{ color: '#ff4444', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>⚠️ Extension required</div>
                    <p style={{ color: '#aaa', fontSize: 13, margin: 0 }}>
                      Install the HIVE Wallet browser extension to sign your mint transaction.
                      Without it, you can mint from the mobile app instead.
                    </p>
                  </div>
                )}

                {/* Error */}
                {mintStatus === 'error' && (
                  <div style={{ background: 'rgba(255,68,68,0.08)', border: '1px solid #ff4444', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                    <div style={{ color: '#ff4444', fontWeight: 700, fontSize: 13 }}>Mint failed</div>
                    <p style={{ color: '#aaa', fontSize: 13, margin: '4px 0 0' }}>{mintError}</p>
                  </div>
                )}

                {/* Status messages */}
                {mintStatus === 'signing' && (
                  <div style={{ background: 'rgba(57,255,20,0.05)', border: '1px solid #39ff14', borderRadius: 10, padding: '12px 16px', marginBottom: 16, textAlign: 'center' }}>
                    <div style={{ color: '#39ff14', fontWeight: 700, fontSize: 14 }}>⬡ Chrysalis signing…</div>
                    <p style={{ color: '#aaa', fontSize: 13, margin: '4px 0 0' }}>
                      {isAuthUser ? 'Signing with platform account — native ML-DSA-65…' : 'Approve in your HIVE Wallet extension.'}
                    </p>
                  </div>
                )}
                {mintStatus === 'uploading' && (
                  <div style={{ background: 'rgba(57,255,20,0.05)', border: '1px solid #1e2a1e', borderRadius: 10, padding: '12px 16px', marginBottom: 16, textAlign: 'center' }}>
                    <div style={{ color: '#39ff14', fontWeight: 700, fontSize: 14 }}>⬡ Uploading to HIVE network…</div>
                    <p style={{ color: '#666', fontSize: 13, margin: '4px 0 0' }}>This may take a moment for large files.</p>
                  </div>
                )}

                <button
                  onClick={handleMint}
                  disabled={!canMint || mintStatus === 'signing' || mintStatus === 'uploading'}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 10, border: 'none',
                    background: !canMint ? '#222' : '#39ff14',
                    color: !canMint ? '#555' : '#000',
                    fontWeight: 800, fontSize: 16, cursor: !canMint ? 'not-allowed' : 'pointer',
                    fontFamily: 'Space Grotesk, sans-serif',
                    opacity: (mintStatus === 'signing' || mintStatus === 'uploading') ? 0.7 : 1,
                  }}
                >
                  {mintStatus === 'signing' ? '⬡ Signing…'
                    : mintStatus === 'uploading' ? '⬡ Uploading…'
                    : `🎨 Mint NFT${copies > 1 ? ` (${copies} copies)` : ''}`}
                </button>

                <p style={{ color: '#444', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                  {isAuthUser
                    ? 'Platform account — native Chrysalis signing, no extension needed.'
                    : 'Minting requires the HIVE Wallet browser extension or a platform account.'}
                  · Fees deducted from wallet balance.
                </p>
              </>
            )}

            {/* ── Navigation ─────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              {step !== 'upload' && (
                <button onClick={back}
                  style={{ background: '#111', color: '#aaa', border: '1px solid #333', borderRadius: 10, padding: '12px 24px', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                  ← Back
                </button>
              )}
              {step !== 'confirm' && (
                <button onClick={next} disabled={!canNext[step]}
                  style={{ flex: 1, background: canNext[step] ? '#39ff14' : '#1e2a1e', color: canNext[step] ? '#000' : '#555', borderRadius: 10, border: 'none', padding: '12px 24px', fontWeight: 700, cursor: canNext[step] ? 'pointer' : 'not-allowed', fontSize: 14 }}>
                  {step === 'pricing' ? 'Review →' : 'Next →'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
