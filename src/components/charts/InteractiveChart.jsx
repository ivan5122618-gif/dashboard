import React, { useState, useRef } from 'react';

export default function InteractiveChart({
  data,
  color = '#3b82f6',
  height = 40,
  showArea = true,
  unit = '',
}) {
  const [hoverInfo, setHoverInfo] = useState(null);
  const svgRef = useRef(null);

  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const width = 100;

  const points = values.map((val, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return { x, y, value: val, date: data[i].date };
  });

  const pathString = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  const areaString = `${pathString} L ${width},${height} L 0,${height} Z`;

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;

    let closest = points[0];
    let minDiff = Math.abs(mouseX - points[0].x);

    points.forEach((p) => {
      const diff = Math.abs(mouseX - p.x);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    });
    setHoverInfo(closest);
  };

  return (
    <div className="group relative h-full w-full" onMouseLeave={() => setHoverInfo(null)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full cursor-crosshair overflow-visible"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
      >
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {showArea && <path d={areaString} fill={`url(#grad-${color.replace('#', '')})`} />}
        <path
          d={pathString}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {hoverInfo && (
          <g>
            <line
              x1={hoverInfo.x}
              y1="0"
              x2={hoverInfo.x}
              y2={height}
              stroke={color}
              strokeWidth="0.5"
              strokeDasharray="2,2"
            />
            <circle cx={hoverInfo.x} cy={hoverInfo.y} r="2" fill="white" stroke={color} strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-[100] -translate-y-full whitespace-nowrap rounded bg-slate-900/90 px-2 py-1.5 text-[10px] text-white shadow-xl"
          style={{
            left: `${(hoverInfo.x / width) * 100}%`,
            top: `${(hoverInfo.y / height) * 100 - 8}px`,
            transform: `translate(${hoverInfo.x > width * 0.7 ? '-105%' : '5%'}, -100%)`,
          }}
        >
          <div className="mb-1 border-b border-white/20 pb-0.5 font-bold">{hoverInfo.date}</div>
          <div>
            {hoverInfo.value.toFixed(1)}
            {unit}
          </div>
        </div>
      )}
    </div>
  );
}
