'use client';
// ChrysalisSignModal — shown to platform (auth) users when a page needs an ML-DSA-65 signature.
// Extension users get the extension popup instead — this component is only rendered for auth users.

import React, { useState, useEffect } from 'react';

type Stage = 'idle' | 'init' | 'keys' | 'attest' | 'sign' | 'done' | 'error';

interface ChrysalisSignModalProps {
  /** Title shown in the modal header */
  title: string;
  /** Human-readable description of the action being signed */
  description: string;
  /** Whether the modal is visible */
  visible: boolean;
  /** Current signing stage (driven by useSign hook) */
  stage: Stage;
  /** Optional error message */
  error?: string;
  /** Called when the user dismisses the modal */
  onClose: () => void;
}

const STAGE_LABELS: Record<Stage, string> = {
  idle:   'Waiting…',
  init:   'Initialising Chrysalis…',
  keys:   'Loading ML-DSA-65 keys…',
  attest: 'Creating Chrysalis attestation…',
  sign:   'Signing with post-quantum ML-DSA-65…',
  done:   'Signed!',
  error:  'Signing failed',
};

const STAGE_ICONS: Record<Stage, string> = {
  idle:   '⏳',
  init:   '🔄',
  keys:   '🔑',
  attest: '🛡️',
  sign:   '✍️',
  done:   '✅',
  error:  '❌',
};

export default function ChrysalisSignModal({
  title, description, visible, stage, error, onClose,
}: ChrysalisSignModalProps) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (stage === 'done' || stage === 'error' || stage === 'idle') return;
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(id);
  }, [stage]);

  // Auto-close 1.8s after done
  useEffect(() => {
    if (stage === 'done') {
      const id = setTimeout(onClose, 1800);
      return () => clearTimeout(id);
    }
  }, [stage, onClose]);

  if (!visible) return null;

  const isWorking = stage !== 'idle' && stage !== 'done' && stage !== 'error';
  const isDone    = stage === 'done';
  const isError   = stage === 'error';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(4,5,7,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#0a0d14',
        border: '1px solid rgba(245,180,41,0.3)',
        borderRadius: 16,
        padding: '32px 28px',
        width: 360,
        maxWidth: '90vw',
        boxShadow: '0 0 40px rgba(245,180,41,0.15), 0 0 80px rgba(57,255,20,0.05)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        position: 'relative',
      }}>
        {/* Hex pattern background */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 16, overflow: 'hidden',
          backgroundImage: `radial-gradient(circle at 50% 0%, rgba(245,180,41,0.06) 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        {/* Header */}
        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <div style={{
            fontSize: 11, letterSpacing: '0.18em', color: '#f5b429',
            fontFamily: 'Space Mono, monospace', marginBottom: 6,
          }}>
            CHRYSALIS SECURITY ◆ ML-DSA-65
          </div>
          <div style={{
            fontSize: 18, fontWeight: 700, color: '#fff',
            fontFamily: 'Space Grotesk, sans-serif',
          }}>{title}</div>
        </div>

        {/* Description */}
        <div style={{
          background: 'rgba(57,255,20,0.05)', border: '1px solid rgba(57,255,20,0.15)',
          borderRadius: 8, padding: '10px 14px', width: '100%', zIndex: 1,
        }}>
          <div style={{ color: '#39ff14', fontSize: 12, fontFamily: 'Space Mono, monospace', wordBreak: 'break-all' }}>
            {description}
          </div>
        </div>

        {/* Stage indicator */}
        <div style={{ width: '100%', zIndex: 1 }}>
          {/* Progress track */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['init','keys','attest','sign','done'] as Stage[]).map((s, i) => {
              const stages: Stage[] = ['init','keys','attest','sign','done'];
              const currentIdx = stages.indexOf(stage as Stage);
              const active = i === currentIdx;
              const past   = i < currentIdx;
              return (
                <div key={s} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: isError ? '#ff4444'
                    : past ? '#f5b429'
                    : active ? '#39ff14'
                    : 'rgba(255,255,255,0.12)',
                  transition: 'background 0.3s',
                }} />
              );
            })}
          </div>
          {/* Stage label */}
          <div style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {isWorking && (
              <div style={{
                width: 16, height: 16, border: '2px solid rgba(245,180,41,0.3)',
                borderTop: '2px solid #f5b429', borderRadius: '50%',
                animation: 'hive-spin 0.8s linear infinite',
              }} />
            )}
            <span style={{
              color: isError ? '#ff6b6b' : isDone ? '#39ff14' : '#f5b429',
              fontSize: 13, fontFamily: 'Space Mono, monospace',
            }}>
              {STAGE_ICONS[stage]} {STAGE_LABELS[stage]}{isWorking ? dots : ''}
            </span>
          </div>
        </div>

        {/* Error message */}
        {isError && error && (
          <div style={{
            background: 'rgba(255,68,68,0.1)', border: '1px solid rgba(255,68,68,0.3)',
            borderRadius: 8, padding: '8px 12px', width: '100%', zIndex: 1,
          }}>
            <div style={{ color: '#ff6b6b', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>
              {error}
            </div>
          </div>
        )}

        {/* Chrysalis branding */}
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', zIndex: 1,
        }}>
          {['ML-DSA-65', 'ML-KEM-768', 'CAS-φ'].map(tag => (
            <span key={tag} style={{
              background: 'rgba(245,180,41,0.08)', border: '1px solid rgba(245,180,41,0.25)',
              borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#f5b429',
              fontFamily: 'Space Mono, monospace', letterSpacing: '0.05em',
            }}>{tag}</span>
          ))}
        </div>

        {/* Close button (only after done/error) */}
        {(isDone || isError) && (
          <button onClick={onClose} style={{
            background: isDone ? 'rgba(57,255,20,0.15)' : 'rgba(255,68,68,0.15)',
            border: `1px solid ${isDone ? 'rgba(57,255,20,0.4)' : 'rgba(255,68,68,0.4)'}`,
            color: isDone ? '#39ff14' : '#ff6b6b',
            borderRadius: 8, padding: '8px 24px', cursor: 'pointer',
            fontFamily: 'Space Mono, monospace', fontSize: 13, zIndex: 1,
          }}>
            {isDone ? '✓ Done' : '✗ Close'}
          </button>
        )}

        <style>{`
          @keyframes hive-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}
