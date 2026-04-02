import React, { useState, useRef } from 'react';

export default function MultiSeriesChart({ seriesList, height = 56, unit = '' }) {
  const [hoverInfo, setHoverInfo] = useState(null);
  const svgRef = useRef(null);

  const list = Array.isArray(seriesList) ? seriesList.filter(Boolean) : [];
  const series = list.map((s) => ({
    label: String(s.label || ''),
    color: String(s.color || '#64748b'),
    data: Array.isArray(s.data) ? s.data : [],
    dashed: Boolean(s.dashed),
  }));

  const width = 100;
  const maxLen = Math.max(0, ...series.map((s) => s.data.length));
  const allValues = series.flatMap((s) => s.data.map((d) => d.value));
  const max = allValues.length ? Math.max(...allValues) : 0;
  const min = allValues.length ? Math.min(...allValues) : 0;
  const range = max - min || 1;

  const mkPoints = (data) =>
    (data || []).map((d, i) => {
      const x = (i / Math.max(1, maxLen - 1)) * width;
      const y = height - ((d.value - min) / range) * height;
      return { x, y, value: d.value, date: d.date };
    });

  const rendered = series.map((s) => {
    const points = mkPoints(s.data);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    return { ...s, points, path };
  });

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round((mouseX / width) * Math.max(1, maxLen - 1));
    const safeIdx = Math.min(Math.max(0, idx), Math.max(0, maxLen - 1));
    const date =
      rendered.find((r) => r.data?.[safeIdx]?.date)?.data?.[safeIdx]?.date ||
      rendered.find((r) => r.data?.[0]?.date)?.data?.[0]?.date ||
      '';
    setHoverInfo({
      date,
      x: (safeIdx / Math.max(1, maxLen - 1)) * width,
      values: rendered.map((r) => ({
        label: r.label,
        color: r.color,
        value: r.data?.[safeIdx]?.value,
      })),
    });
  };

  return (
    <div className="relative h-full w-full" onMouseLeave={() => setHoverInfo(null)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full cursor-crosshair overflow-visible"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
      >
        {rendered.map((r) =>
          r.path ? (
            <path
              key={r.label}
              d={r.path}
              fill="none"
              stroke={r.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={r.dashed ? '3,3' : undefined}
            />
          ) : null,
        )}
        {hoverInfo && (
          <g>
            <line
              x1={hoverInfo.x}
              y1="0"
              x2={hoverInfo.x}
              y2={height}
              stroke="#94a3b8"
              strokeWidth="0.6"
              strokeDasharray="2,2"
            />
          </g>
        )}
      </svg>

      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-[100] -translate-y-full whitespace-nowrap rounded bg-slate-900/90 px-2 py-1.5 text-[10px] text-white shadow-xl"
          style={{
            left: `${(hoverInfo.x / width) * 100}%`,
            top: `-4px`,
            transform: `translate(${hoverInfo.x > width * 0.7 ? '-105%' : '5%'}, -100%)`,
          }}
        >
          <div className="mb-1 border-b border-white/20 pb-0.5 font-bold">{hoverInfo.date}</div>
          <div className="space-y-0.5">
            {hoverInfo.values.map((v) => (
              <div key={v.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1 text-slate-200">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: v.color }} />
                  {v.label}
                </span>
                <span className="font-black">
                  {Number(v.value ?? 0).toFixed(0)}
                  {unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
