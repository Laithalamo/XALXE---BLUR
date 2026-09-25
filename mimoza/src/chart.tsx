/**
 * Monthly income vs expense: grouped columns (≤24px, 4px rounded tops, 2px gap), hairline grid,
 * a legend, and a hover / focus tooltip per column. The table next to it carries the same values.
 */
import { useState } from 'preact/hooks';
import { money } from './format';

export interface Series {
  name: string;
  /** CSS custom property holding the colour */
  color: string;
  values: number[];
}

function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const tick = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

export function ColumnChart({ labels, series, height = 220 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<{ i: number; s: number } | null>(null);
  const n = labels.length;
  const groupW = Math.max(28, Math.min(64, 640 / Math.max(1, n)));
  const barW = Math.min(24, (groupW - 12 - 2 * (series.length - 1)) / series.length);
  const left = 56, right = 8, top = 12, bottom = 28;
  const width = left + right + groupW * n;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)) / 100) * 100;
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const bar = (x: number, v: number) => {
    const y0 = top + plotH;
    const y1 = y(v);
    const h = y0 - y1;
    if (h <= 0) return '';
    const r = Math.min(4, h, barW / 2);
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + barW - r}Q${x + barW},${y1} ${x + barW},${y1 + r}V${y0}Z`;
  };
  const tipX = hover ? left + hover.i * groupW + groupW / 2 : 0;
  return (
    <div class="chart">
      <div class="chart-legend">
        {series.map((s) => (
          <span key={s.name}><i style={{ background: `var(${s.color})` }} />{s.name}</span>
        ))}
      </div>
      <div class="chart-scroll">
        <div class="chart-box" style={{ width: `${width}px` }}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map((s) => s.name).join(', ')}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} class={v === 0 ? 'axis' : 'grid'} />
                <text x={left - 8} y={y(v) + 4} class="tick" text-anchor="end">{tick.format(v / 100)}</text>
              </g>
            ))}
            {labels.map((l, i) => {
              const gx = left + i * groupW + (groupW - (barW * series.length + 2 * (series.length - 1))) / 2;
              return (
                <g key={l}>
                  {series.map((s, si) => {
                    const x = gx + si * (barW + 2);
                    const v = s.values[i] ?? 0;
                    const active = hover?.i === i && hover?.s === si;
                    return (
                      <g key={s.name}>
                        <path d={bar(x, v)} style={{ fill: `var(${s.color})` }} class={active ? 'bar active' : 'bar'} />
                        {/* hit area: the whole column height, wider than the bar */}
                        <rect
                          x={x - 1} y={top} width={barW + 2} height={plotH} fill="transparent" tabIndex={0}
                          aria-label={`${l} ${s.name} ${money(v)}`}
                          onPointerEnter={() => setHover({ i, s: si })} onPointerLeave={() => setHover(null)}
                          onFocus={() => setHover({ i, s: si })} onBlur={() => setHover(null)}
                        />
                      </g>
                    );
                  })}
                  <text x={left + i * groupW + groupW / 2} y={height - 8} class="tick" text-anchor="middle">{l}</text>
                </g>
              );
            })}
          </svg>
          {hover && (
            <div class="chart-tip" style={{ left: `${Math.min(Math.max(tipX, 70), width - 70)}px` }}>
              {series.map((s, si) => (
                <div key={s.name} class={si === hover.s ? 'on' : ''}>
                  <strong>{money(s.values[hover.i] ?? 0)}</strong>
                  <span><i style={{ background: `var(${s.color})` }} />{s.name}</span>
                </div>
              ))}
              <div class="muted">{labels[hover.i]}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
