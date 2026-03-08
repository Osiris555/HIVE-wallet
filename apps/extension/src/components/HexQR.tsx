import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

// CSS clip-path for a flat-top regular hexagon
const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';

/** Compute SVG polygon points for a pointy-top hexagon centered in [size×size] */
function hexPoints(size: number, padding = 2): string {
  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2 - padding;
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // pointy-top
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

export default function HexQR({
  value,
  size = 192,
  color = '#39ff14',
  bg = '#07090c',
}: {
  value: string;
  size?: number;
  color?: string;
  bg?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: { dark: color, light: bg },
    }).catch(console.error);
  }, [value, size, color, bg]);

  return (
    <div style={{
      position: 'relative',
      width: size,
      height: size,
      display: 'inline-block',
    }}>
      {/* Glowing hexagonal border */}
      <svg
        width={size}
        height={size}
        style={{
          position: 'absolute', top: 0, left: 0,
          pointerEvents: 'none', zIndex: 2,
          overflow: 'visible',
        }}
      >
        <polygon
          points={hexPoints(size, 2)}
          fill="none"
          stroke={color}
          strokeWidth={2}
          style={{ filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 12px ${color}44)` }}
        />
      </svg>

      {/* QR code canvas clipped to hexagon */}
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{
          clipPath: HEX_CLIP,
          display: 'block',
          borderRadius: 0,
        }}
      />
    </div>
  );
}
