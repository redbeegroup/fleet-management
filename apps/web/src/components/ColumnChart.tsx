import { useId, useMemo, useState } from 'react';

export interface Series {
  key: string;
  label: string;
  /** CSS variable holding the series color, e.g. 'var(--series-1)'. */
  color: string;
}

export interface Datum {
  label: string; // x category (e.g. a day)
  values: Record<string, number>;
}

interface Props {
  title: string;
  data: Datum[];
  series: Series[];
  format?: (v: number) => string;
  formatX?: (label: string) => string;
  height?: number;
}

/** "Nice" tick step: 1, 2, 2.5 or 5 × 10^n. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

const compact = (v: number) =>
  v >= 1e9 ? `${+(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${+(v / 1e3).toFixed(0)}k` : v.toLocaleString();

/**
 * Column chart, single or stacked series. One y-axis, recessive grid, 2px surface
 * gaps between stacked segments and columns, 4px rounded data-end. Every column is a
 * focusable hit target with a tooltip listing all series; a table view is one click away.
 */
export function ColumnChart({ title, data, series, format = (v) => v.toLocaleString(), formatX = (x) => x, height = 220 }: Props) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 720;
  const H = height;
  const pad = { top: 12, right: 8, bottom: 28, left: 52 };
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const ticks = useMemo(() => niceTicks(Math.max(0, ...totals)), [totals]);
  const yMax = ticks[ticks.length - 1] || 1;
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(36, band - 4));
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
  const labelEvery = Math.ceil(data.length / 10);

  return (
    <figure className="viz" aria-labelledby={`${id}-t`}>
      <figcaption className="viz-head">
        <span id={`${id}-t`} className="viz-title">
          {title}
        </span>
        {series.length > 1 && (
          <span className="viz-legend">
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
        <button type="button" className="link viz-toggle" onClick={() => setTable((t) => !t)}>
          {table ? 'Chart' : 'Table'}
        </button>
      </figcaption>
      {table ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                {series.map((s) => (
                  <th key={s.key} className="num">
                    {s.label}
                  </th>
                ))}
                {series.length > 1 && <th className="num">Total</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.label}>
                  <td>{formatX(d.label)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {format(d.values[s.key] ?? 0)}
                    </td>
                  ))}
                  {series.length > 1 && <td className="num">{format(totals[i])}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="none">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
                <text x={pad.left - 8} y={y(t)} className="viz-tick" textAnchor="end" dominantBaseline="middle">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = pad.left + i * band + (band - barW) / 2;
              let acc = 0;
              const segs = series
                .map((s) => ({ s, v: d.values[s.key] ?? 0 }))
                .filter((x) => x.v > 0);
              return (
                <g key={d.label} className={hover === i ? 'viz-col hover' : 'viz-col'}>
                  {segs.map(({ s, v }, j) => {
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    const top = j === segs.length - 1;
                    const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0)); // 2px surface gap between segments
                    const r = top ? Math.min(4, barW / 2, h) : 0;
                    // Rounded top only (data-end), square at the baseline / joins.
                    const path = `M${x},${y1 + h} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y1 + h} Z`;
                    return <path key={s.key} d={path} style={{ fill: s.color }} />;
                  })}
                  {i % labelEvery === 0 && (
                    <text x={pad.left + i * band + band / 2} y={H - 8} className="viz-tick" textAnchor="middle">
                      {formatX(d.label)}
                    </text>
                  )}
                  <rect
                    x={pad.left + i * band}
                    y={pad.top}
                    width={band}
                    height={plotH}
                    className="viz-hit"
                    tabIndex={0}
                    aria-label={`${formatX(d.label)}: ${series.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(', ')}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="viz-tip"
              style={{ left: `${((pad.left + (hover + 0.5) * band) / W) * 100}%`, transform: hover > data.length * 0.6 ? 'translateX(-100%)' : 'translateX(8px)' }}
            >
              <div className="viz-tip-x">{formatX(data[hover].label)}</div>
              {series.map((s) => (
                <div key={s.key} className="viz-tip-row">
                  <i style={{ background: s.color }} />
                  <strong>{format(data[hover].values[s.key] ?? 0)}</strong>
                  {series.length > 1 && <span>{s.label}</span>}
                </div>
              ))}
              {series.length > 1 && (
                <div className="viz-tip-row total">
                  <strong>{format(totals[hover])}</strong>
                  <span>Total</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
