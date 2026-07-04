// SVG 차트(게이지/가로막대) 컴포넌트
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function Gauge({ pct, label, size = 120, color }: { pct: number; label?: string; size?: number; color?: string }) {
  const p = Math.max(0, Math.min(pct, 100));
  const col = color || (p > 100 ? "var(--bad)" : p > 90 ? "var(--warn)" : "var(--brand)");
  const r = size / 2 - 12, cx = size / 2, cy = size / 2;
  const a0 = -Math.PI / 2, a1 = a0 + (p / 100) * Math.PI * 2;
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth={13} />
        {p > 0 && <path d={arc(cx, cy, r, a0, a1)} fill="none" stroke={col} strokeWidth={13} strokeLinecap="round" />}
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={20} fontWeight={800} fill="var(--ink)">{Math.round(pct)}%</text>
      </svg>
      {label && <div className="muted small">{label}</div>}
    </div>
  );
}

export interface Bar { label: string; pct: number; text?: string; color?: string; }
export function HBars({ bars }: { bars: Bar[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {bars.map((b, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(80px,140px) 1fr minmax(96px,auto)", gap: 10, alignItems: "center", fontSize: 13 }}>
          <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</span>
          <div className="bar" style={{ height: 9 }}><i style={{ width: `${Math.min(b.pct, 100)}%`, background: b.color || "var(--brand)" }} /></div>
          <span className="muted small" style={{ textAlign: "right" }}>{b.text ?? `${b.pct}%`}</span>
        </div>
      ))}
    </div>
  );
}
