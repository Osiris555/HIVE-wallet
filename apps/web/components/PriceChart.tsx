'use client';
import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { getCandles } from '@/lib/api';
import type { OhlcvCandle, CandleTimeframe } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PriceChartProps {
  pair:               string;   // e.g. "HNY/USDC"
  color?:             string;   // area/line color (default #39ff14)
  height?:            number;   // total component height px (default 280)
  showVolume?:        boolean;  // show volume bar row (default true)
  spotPrice?:         number;   // gold dashed reference line
  liquidationPrice?:  number;   // red dashed reference line (futures)
}

type ChartPoint = OhlcvCandle & { label: string };

// ── Constants ─────────────────────────────────────────────────────────────────
const TIMEFRAMES: CandleTimeframe[] = ['1s','1m','5m','15m','30m','1h','4h','1D','1W','1M','1Y'];

function getRefreshMs(tf: CandleTimeframe): number {
  if (tf === '1s' || tf === '1m') return 5_000;
  if (tf === '5m' || tf === '15m' || tf === '30m') return 30_000;
  return 5 * 60_000;
}

function formatLabel(ts: number, tf: CandleTimeframe): string {
  const d = new Date(ts);
  if (tf === '1s') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (tf === '1m') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (tf === '5m' || tf === '15m' || tf === '30m' || tf === '1h' || tf === '4h')
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (tf === '1D' || tf === '1W')
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function CandleTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <div style={{
      background: 'rgba(7,9,12,0.95)', border: '1px solid rgba(57,255,20,0.2)',
      borderRadius: 8, padding: '8px 12px', fontSize: 11,
    }}>
      <p style={{ color: 'rgba(232,240,228,0.55)', marginBottom: 4 }}>{c.label}</p>
      <p style={{ color: '#39ff14',  fontFamily: 'monospace', margin: '2px 0' }}>C: {c.c.toFixed(6)}</p>
      <p style={{ color: '#e8f0e4', fontFamily: 'monospace', margin: '2px 0' }}>O: {c.o.toFixed(6)}</p>
      <p style={{ color: '#39ff14',  fontFamily: 'monospace', margin: '2px 0' }}>H: {c.h.toFixed(6)}</p>
      <p style={{ color: '#ff5a5a', fontFamily: 'monospace', margin: '2px 0' }}>L: {c.l.toFixed(6)}</p>
      <p style={{ color: 'rgba(232,240,228,0.55)', fontFamily: 'monospace', margin: '2px 0' }}>Vol: {c.v.toFixed(4)}</p>
    </div>
  );
}

function VolumeTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <div style={{ background: 'rgba(7,9,12,0.9)', border: '1px solid rgba(57,255,20,0.15)', borderRadius: 6, padding: '5px 9px', fontSize: 10 }}>
      <p style={{ color: 'rgba(232,240,228,0.55)', margin: 0 }}>Vol: {c.v.toFixed(4)}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PriceChart({
  pair,
  color = '#39ff14',
  height = 280,
  showVolume = true,
  spotPrice,
  liquidationPrice,
}: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<CandleTimeframe>('15m');
  const [candles, setCandles]     = useState<OhlcvCandle[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);

  const fetchData = useCallback(async (tf: CandleTimeframe, p: string) => {
    try {
      const res = await getCandles(p, tf, 200);
      setCandles(res.candles ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCandles([]);

    const run = async () => {
      if (cancelled) return;
      try {
        const res = await getCandles(pair, timeframe, 200);
        if (!cancelled) { setCandles(res.candles ?? []); setError(false); }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    const intervalMs = getRefreshMs(timeframe);
    const id = setInterval(run, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pair, timeframe, fetchData]);

  const chartData: ChartPoint[] = candles.map(c => ({ ...c, label: formatLabel(c.ts, timeframe) }));
  const priceHeight  = showVolume ? height - 70 : height;
  const volHeight    = 60;
  const gradId       = `grad-${pair.replace('/','_')}`;

  // Determine Y axis domain for a bit of padding
  const prices = chartData.map(c => c.c);
  const minP   = prices.length ? Math.min(...prices) : 0;
  const maxP   = prices.length ? Math.max(...prices) : 1;
  const pad    = (maxP - minP) * 0.05 || maxP * 0.02 || 0.0001;
  const yDomain: [number, number] = [minP - pad, maxP + pad];

  return (
    <div style={{ width: '100%' }}>
      {/* Timeframe selector */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12,
        overflowX: 'auto', paddingBottom: 2,
      }}>
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            onClick={() => { setTimeframe(tf); setLoading(true); }}
            style={{
              padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
              background: tf === timeframe ? '#f5b429' : 'rgba(255,255,255,0.06)',
              color:      tf === timeframe ? '#040507' : 'rgba(232,240,228,0.55)',
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{
          height: priceHeight, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(232,240,228,0.35)', fontSize: 13,
        }}>
          Loading candles…
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div style={{
          height: priceHeight, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#ff5a5a', fontSize: 13,
        }}>
          Failed to load chart data
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && chartData.length < 2 && (
        <div style={{
          height: priceHeight, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: 'rgba(232,240,228,0.35)', fontSize: 13, gap: 6,
        }}>
          <span style={{ fontSize: 28 }}>📊</span>
          No candle data yet for {pair}
          <span style={{ fontSize: 11 }}>Chart populates as trades are executed</span>
        </div>
      )}

      {/* Price chart */}
      {!loading && !error && chartData.length >= 2 && (
        <>
          <ResponsiveContainer width="100%" height={priceHeight}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={color} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'rgba(232,240,228,0.45)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={yDomain}
                tick={{ fill: 'rgba(232,240,228,0.45)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={v => v < 0.01 ? v.toFixed(6) : v < 1 ? v.toFixed(4) : v.toFixed(2)}
              />
              <Tooltip content={<CandleTooltip />} />
              {spotPrice !== undefined && spotPrice > 0 && (
                <ReferenceLine
                  y={spotPrice}
                  stroke="rgba(245,180,41,0.5)"
                  strokeDasharray="4 4"
                  label={{ value: 'Spot', fill: 'rgba(245,180,41,0.7)', fontSize: 10, position: 'insideTopRight' }}
                />
              )}
              {liquidationPrice !== undefined && liquidationPrice > 0 && (
                <ReferenceLine
                  y={liquidationPrice}
                  stroke="rgba(255,90,90,0.6)"
                  strokeDasharray="4 4"
                  label={{ value: 'Liq', fill: '#ff5a5a', fontSize: 10, position: 'insideTopRight' }}
                />
              )}
              <Area
                type="monotone"
                dataKey="c"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradId})`}
                dot={false}
                activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Volume bar chart */}
          {showVolume && (
            <ResponsiveContainer width="100%" height={volHeight}>
              <BarChart data={chartData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" hide />
                <YAxis hide />
                <Tooltip content={<VolumeTooltip />} />
                <Bar dataKey="v" fill="rgba(57,255,20,0.22)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
}
