import React, { useEffect, useState } from 'react';

const STAGES = [
  { text: 'Initializing post-quantum framework…' },
  { text: 'Deriving ML-DSA-65 keypair…' },
  { text: 'Building Chrysalis attestation…' },
  { text: 'Signing transaction…' },
  { text: 'Transaction authorized' },
];

export type ChrysalisStage = 'init' | 'keys' | 'attest' | 'sign' | 'done' | 'error';

const STAGE_INDEX: Record<ChrysalisStage, number> = {
  init: 0, keys: 1, attest: 2, sign: 3, done: 4, error: 4,
};

const HEX_SVG = `data:image/svg+xml,%3Csvg width='30' height='34' viewBox='0 0 30 34' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M15 0L30 8.5V25.5L15 34L0 25.5V8.5Z' fill='none' stroke='%23f5b429' stroke-width='0.8'/%3E%3C/svg%3E`;

export default function ChrysalisModal({
  visible,
  stage,
  errorMsg,
  onClose,
}: {
  visible: boolean;
  stage: ChrysalisStage;
  errorMsg?: string;
  onClose?: () => void;
}) {
  const [displayStep, setDisplayStep] = useState(0);

  useEffect(() => {
    if (!visible) { setDisplayStep(0); return; }
    setDisplayStep(0);
    const target = STAGE_INDEX[stage] ?? 0;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      setDisplayStep(step);
      if (step >= target) clearInterval(iv);
    }, 420);
    return () => clearInterval(iv);
  }, [visible, stage]);

  if (!visible) return null;

  const isDone  = stage === 'done';
  const isError = stage === 'error';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(4,5,7,0.93)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(10px)',
    }}>
      {/* Hex pattern background */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.06,
        backgroundImage: `url("${HEX_SVG}")`,
        backgroundSize: '30px 34px',
      }} />

      <div style={{
        background: 'rgba(7,9,12,0.97)',
        border: `1px solid ${isDone ? 'rgba(57,255,20,0.4)' : isError ? 'rgba(255,90,90,0.4)' : 'rgba(245,180,41,0.35)'}`,
        borderRadius: 20,
        padding: '28px 24px',
        width: 300,
        position: 'relative',
        boxShadow: `0 0 40px ${isDone ? 'rgba(57,255,20,0.12)' : isError ? 'rgba(255,90,90,0.12)' : 'rgba(245,180,41,0.12)'}`,
      }}>
        {/* Chrysalis header */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 8 }}>
            {isDone ? '✅' : isError ? '❌' : '⬡'}
          </div>
          <div style={{
            color: isDone ? 'var(--green)' : isError ? 'var(--danger)' : 'var(--gold)',
            fontWeight: 700, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase',
          }}>
            Chrysalis Security
          </div>
          <div style={{ color: 'var(--sub)', fontSize: 10, marginTop: 3, letterSpacing: 1 }}>
            ML-DSA-65 · ML-KEM-768 · CAS-φ
          </div>
        </div>

        {/* Stage steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {STAGES.map((s, i) => {
            const done   = isDone || i < displayStep;
            const active = !isDone && !isError && i === displayStep;
            const faded  = !isDone && !isError && i > displayStep;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                opacity: faded ? 0.3 : 1,
                transition: 'opacity 0.3s',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: done
                    ? 'rgba(57,255,20,0.15)'
                    : active ? 'rgba(245,180,41,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${done ? 'var(--green)' : active ? 'var(--gold)' : 'var(--border)'}`,
                  color: done ? 'var(--green)' : active ? 'var(--gold)' : 'var(--sub)',
                  boxShadow: active ? '0 0 8px rgba(245,180,41,0.3)' : 'none',
                }}>
                  {done ? '✓' : active ? '◉' : i + 1}
                </div>
                <span style={{
                  fontSize: 12, lineHeight: 1.3,
                  color: done ? 'var(--text)' : active ? 'var(--gold)' : 'var(--sub)',
                  fontWeight: active ? 600 : 400,
                }}>
                  {s.text}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {isError && errorMsg && (
          <div style={{
            marginTop: 16, padding: '10px 12px',
            background: 'rgba(255,90,90,0.08)',
            border: '1px solid rgba(255,90,90,0.25)',
            borderRadius: 10, color: 'var(--danger)', fontSize: 12, lineHeight: 1.4,
          }}>
            {errorMsg}
          </div>
        )}

        {/* Close button (done or error) */}
        {(isDone || isError) && onClose && (
          <button
            onClick={onClose}
            style={{
              width: '100%', marginTop: 18, padding: '11px',
              borderRadius: 10, border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 13, letterSpacing: 0.5,
              background: isDone ? 'rgba(57,255,20,0.12)' : 'rgba(255,90,90,0.12)',
              color: isDone ? 'var(--green)' : 'var(--danger)',
              transition: 'opacity 0.2s',
            }}
          >
            {isDone ? '✓ Done' : '✗ Close'}
          </button>
        )}

        {/* Animated spinner for in-progress */}
        {!isDone && !isError && (
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <div style={{
              display: 'inline-block',
              width: 20, height: 20,
              border: '2px solid rgba(245,180,41,0.15)',
              borderTop: '2px solid var(--gold)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
