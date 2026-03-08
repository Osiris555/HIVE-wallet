// apps/mobile/src/components/HexQR.tsx
// Renders a QR code where each dark module is drawn as a pointy-top hexagon.
// Uses the `qrcode` package to get the bit matrix, then renders SVG via react-native-svg.

import React, { useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";
// `qrcode` is a transitive dependency of react-native-qrcode-svg
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCodeLib = require("qrcode") as {
  create: (text: string, opts?: { errorCorrectionLevel?: string }) => {
    modules: { data: Uint8Array; size: number };
  };
};

type Props = {
  value          : string;
  size?          : number;
  color?         : string;
  backgroundColor?: string;
  borderRadius?  : number;
};

/**
 * Returns the SVG path string for a pointy-top hexagon
 * centred at (cx, cy) with circumradius r.
 */
function hexPath(cx: number, cy: number, r: number): string {
  let d = "";
  for (let i = 0; i < 6; i++) {
    const angle = ((i * 60 - 30) * Math.PI) / 180;
    const x = (cx + r * Math.cos(angle)).toFixed(3);
    const y = (cy + r * Math.sin(angle)).toFixed(3);
    d += i === 0 ? `M${x},${y}` : `L${x},${y}`;
  }
  return d + "Z";
}

export function HexQR({
  value,
  size           = 240,
  color          = "#39ff14",
  backgroundColor = "#040507",
  borderRadius   = 12,
}: Props) {
  const svgData = useMemo(() => {
    try {
      const qr       = QRCodeLib.create(value, { errorCorrectionLevel: "H" });
      const count    = qr.modules.size;
      const data     = qr.modules.data;
      const cellSize = size / count;
      // r slightly larger than inscribed circle radius so adjacent hexes touch
      const r        = (cellSize / 2) * 1.01;

      const paths: string[] = [];
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (data[row * count + col]) {
            const cx = col * cellSize + cellSize / 2;
            const cy = row * cellSize + cellSize / 2;
            paths.push(hexPath(cx, cy, r));
          }
        }
      }
      return { combined: paths.join(" "), count };
    } catch {
      return null;
    }
  }, [value, size]);

  if (!svgData) return null;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <Rect
        width={size}
        height={size}
        fill={backgroundColor}
        rx={borderRadius}
      />
      <Path d={svgData.combined} fill={color} />
    </Svg>
  );
}
