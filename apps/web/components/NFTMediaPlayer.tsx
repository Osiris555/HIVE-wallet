'use client';

import { useState, useRef } from 'react';
import { mediaUrl } from '@/lib/api';
import type { NftSummary } from '@/lib/types';

type FileInfo = { file_index: number; file_name: string; mime_type: string; file_size: number };

export default function NFTMediaPlayer({
  nft,
  files,
}: {
  nft: NftSummary;
  files: FileInfo[];
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const currentFile = files[currentIndex];
  const currentUrl = currentFile ? mediaUrl(nft.id, currentFile.file_index) : '';

  // ── Audio Player ───────────────────────────────────────────────────────────
  if (nft.media_type === 'audio') {
    return (
      <div
        className="glass-card p-5 flex flex-col gap-4"
        style={{ minHeight: 360 }}
      >
        {/* Album art placeholder */}
        <div
          className="w-full aspect-square rounded-xl flex items-center justify-center text-7xl"
          style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', maxHeight: 200 }}
        >
          🎵
        </div>

        {/* Now playing */}
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--sub)' }}>Now Playing</p>
          <p className="font-semibold truncate" style={{ color: 'var(--text)' }}>
            {currentFile?.file_name ?? nft.name}
          </p>
        </div>

        {/* HTML5 audio (browser-native controls) */}
        <audio
          ref={audioRef}
          key={currentUrl}
          src={currentUrl}
          controls
          className="w-full"
          style={{ accentColor: 'var(--green)' }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />

        {/* Track list */}
        <div
          className="flex-1 overflow-y-auto rounded-xl"
          style={{ maxHeight: 200, background: 'var(--glass)' }}
        >
          {files.map((f, i) => (
            <div
              key={f.file_index}
              onClick={() => setCurrentIndex(i)}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: i === currentIndex ? 'var(--glass2)' : 'transparent',
                color: i === currentIndex ? 'var(--green)' : 'var(--text)',
              }}
            >
              <span className="text-xs font-mono-hive w-5 text-right" style={{ color: 'var(--sub)' }}>
                {i === currentIndex && playing ? '▶' : i + 1}
              </span>
              <span className="text-sm truncate flex-1">{f.file_name}</span>
              <span className="text-xs" style={{ color: 'var(--sub)' }}>
                {(f.file_size / 1024).toFixed(0)}KB
              </span>
            </div>
          ))}
        </div>

        {/* Prev / Next */}
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="btn-outline px-4 py-2 text-sm disabled:opacity-30"
          >
            ⏮ Prev
          </button>
          <button
            onClick={() => setCurrentIndex(Math.min(files.length - 1, currentIndex + 1))}
            disabled={currentIndex >= files.length - 1}
            className="btn-outline px-4 py-2 text-sm disabled:opacity-30"
          >
            Next ⏭
          </button>
        </div>
      </div>
    );
  }

  // ── Video Player ───────────────────────────────────────────────────────────
  if (nft.media_type === 'video') {
    return (
      <div className="glass-card overflow-hidden flex flex-col gap-3">
        <video
          ref={videoRef}
          key={currentUrl}
          src={currentUrl}
          controls
          className="w-full"
          style={{ background: '#000', maxHeight: 360 }}
        />
        {files.length > 1 && (
          <div className="p-3">
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--sub)' }}>Chapters</p>
            <div className="flex flex-col gap-1">
              {files.map((f, i) => (
                <div
                  key={f.file_index}
                  onClick={() => setCurrentIndex(i)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                  style={{
                    background: i === currentIndex ? 'var(--glass2)' : 'transparent',
                    color: i === currentIndex ? 'var(--green)' : 'var(--text)',
                  }}
                >
                  <span className="text-sm">{i === currentIndex ? '▶' : `${i + 1}.`}</span>
                  <span className="text-sm truncate">{f.file_name.replace(/\.[^.]+$/, '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Document (PDF) ─────────────────────────────────────────────────────────
  if (nft.media_type === 'document') {
    return (
      <div className="glass-card overflow-hidden flex flex-col" style={{ minHeight: 480 }}>
        <iframe
          key={currentUrl}
          src={currentUrl}
          className="w-full flex-1"
          style={{ minHeight: 420, border: 'none' }}
          title={currentFile?.file_name}
        />
        {files.length > 1 && (
          <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: '1px solid var(--border2)' }}>
            <button
              onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="btn-outline text-xs px-3 py-1.5 disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="text-sm" style={{ color: 'var(--sub)' }}>
              Page {currentIndex + 1} of {files.length}
            </span>
            <button
              onClick={() => setCurrentIndex(Math.min(files.length - 1, currentIndex + 1))}
              disabled={currentIndex >= files.length - 1}
              className="btn-outline text-xs px-3 py-1.5 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Photo Gallery ──────────────────────────────────────────────────────────
  return (
    <div className="glass-card overflow-hidden flex flex-col">
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{ minHeight: 360, background: 'var(--bg2)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={currentUrl}
          src={currentUrl}
          alt={currentFile?.file_name}
          className="max-w-full max-h-full object-contain cursor-zoom-in"
          style={{ maxHeight: 480 }}
        />
      </div>

      {/* Thumbnails */}
      {files.length > 1 && (
        <div className="flex items-center gap-2 p-3 overflow-x-auto">
          {files.map((f, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={f.file_index}
              src={mediaUrl(nft.id, f.file_index)}
              alt={f.file_name}
              onClick={() => setCurrentIndex(i)}
              className="rounded-lg cursor-pointer flex-shrink-0 transition-all"
              style={{
                width: 56,
                height: 56,
                objectFit: 'cover',
                border: i === currentIndex ? '2px solid var(--green)' : '2px solid transparent',
                opacity: i === currentIndex ? 1 : 0.5,
              }}
            />
          ))}
        </div>
      )}

      {files.length > 1 && (
        <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: '1px solid var(--border2)' }}>
          <button
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="btn-outline text-xs px-3 py-1.5 disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-sm" style={{ color: 'var(--sub)' }}>
            {currentIndex + 1} / {files.length}
          </span>
          <button
            onClick={() => setCurrentIndex(Math.min(files.length - 1, currentIndex + 1))}
            disabled={currentIndex >= files.length - 1}
            className="btn-outline text-xs px-3 py-1.5 disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
