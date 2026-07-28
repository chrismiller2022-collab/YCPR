interface RadarSeries {
  metrics: { key: string; label: string; percentile: number | null }[];
  color: string;
  name?: string;
}

export default function RadarChart({
  series,
  size = 280,
}: {
  series: RadarSeries[];
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 46;
  const n = series[0]?.metrics.length ?? 6;

  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  function pointFor(i: number, pct: number): [number, number] {
    const r = (Math.max(0, Math.min(100, pct)) / 100) * radius;
    const a = angleFor(i);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  const gridLevels = [20, 40, 60, 80, 100];
  const labels = series[0]?.metrics ?? [];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: "block", margin: "0 auto" }}>
      {gridLevels.map((lvl) => (
        <polygon
          key={lvl}
          points={labels.map((_, i) => pointFor(i, lvl).join(",")).join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
        />
      ))}

      {labels.map((_, i) => {
        const [x, y] = pointFor(i, 100);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.08)" />
        );
      })}

      {series.map((s, si) => {
        const pts = s.metrics.map((m, i) => pointFor(i, m.percentile ?? 0).join(",")).join(" ");
        return (
          <polygon
            key={si}
            points={pts}
            fill={s.color}
            fillOpacity={0.28}
            stroke={s.color}
            strokeWidth={2}
          />
        );
      })}

      {series.map((s, si) =>
        s.metrics.map((m, i) => {
          if (m.percentile == null) return null;
          const [x, y] = pointFor(i, m.percentile);
          return <circle key={`${si}-${i}`} cx={x} cy={y} r={2.5} fill={s.color} />;
        })
      )}

      {labels.map((m, i) => {
        const [x, y] = pointFor(i, 118);
        return (
          <text
            key={i}
            x={x}
            y={y}
            fontSize="9.5"
            fontWeight={700}
            fill="var(--chalk-dim)"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {m.label}
          </text>
        );
      })}
    </svg>
  );
}
