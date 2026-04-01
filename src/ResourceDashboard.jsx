import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Server, Network, Save, MonitorPlay, Zap, HardDrive, 
  Clock, ArrowRight, TrendingDown, 
  Activity, HeartPulse,
  Users, Gauge, ShieldCheck, Database, LayoutPanelTop,
  ChevronRight, Info, BarChart3, Filter, CheckCircle2, AlertCircle, X, Search,
  RefreshCw, Layers, Cpu, Laptop, Smartphone, Globe, Signal, RotateCcw, Box, Container,
  Gamepad2, Tablet, FastForward, CloudDownload, Link2, UserCheck, BarChart, LineChart, Timer, AlertTriangle,
  Workflow, Rocket, HelpCircle, HardDriveDownload, PackageOpen, Share2, MousePointer2, Layers3,
  Trophy, AlertOctagon, TrendingUp, CheckSquare, ShieldAlert, Calendar
} from 'lucide-react';
import {
  fetchDashboardSnapshot,
  fetchProjectOptions,
  fetchSupplyCurrentRoutesFromMetabase,
  fetchSupplyCurrentRoutesBytedanceFromMetabase,
  fetchSupplyOrders7dFromMetabase,
  fetchSupplyOrdersTodayFromMetabase,
  fetchSupplyRoutes7dBytedanceFromMetabase,
  fetchSupplyRoutes7dFromMetabase,
  fetchTabStages,
  fetchTabSummary,
} from './api/dashboardApi.js';
import { getAllMappedProjectIds, projectIdsFromSettlementId } from './supply/settlementToProject.js';

// --- 模拟数据生成器 ---
const cities = ['青岛', '上海', '北京', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京'];
const games = ['英雄联盟', '绝地求生', '永劫无间', '魔兽世界', 'CS2', '无畏契约', '赛博朋克2077', '原神', '命运2'];
const projectList = ['项目A', '项目B', '项目C', '项目D'];

const generateTrendData = (points, base, variance, labelType = 'hour') => 
  Array.from({ length: points }, (_, i) => ({
    date: labelType === 'hour' ? `${i}:00` : `03-0${i + 1}`,
    value: Math.max(0, base + (Math.random() * variance - variance / 2))
  }));

const generateRooms = (count, avgTime, forceHighSuccess = false) => Array.from({ length: count }, (_, i) => {
  const cityName = cities[Math.floor(Math.random() * cities.length)];
  const roomNumber = 1000 + Math.floor(Math.random() * 9000);
  const successVal = forceHighSuccess 
    ? (92 + Math.random() * 7.9) 
    : (Math.random() > 0.7 ? (82 + Math.random() * 7) : (92 + Math.random() * 7));

  return {
    id: `room-${Math.random()}`,
    name: `${cityName}-${roomNumber}`,
    time: avgTime * (0.8 + Math.random() * 0.4),
    success: parseFloat(successVal.toFixed(1)),
    timeTrend: generateTrendData(12, avgTime, avgTime * 0.2),
    successTrend: generateTrendData(12, successVal, 5)
  };
});

const generateGameDetails = (count, avgTime) => Array.from({ length: count }, (_, i) => {
  const gameName = games[i % games.length];
  const successVal = Math.random() > 0.6 ? (84 + Math.random() * 5) : (94 + Math.random() * 5);
  return {
    id: `game-${Math.random()}`,
    name: gameName,
    time: avgTime * (0.9 + Math.random() * 0.3),
    success: parseFloat(successVal.toFixed(1)),
    failure: parseFloat((100 - successVal).toFixed(1)),
    timeTrend: generateTrendData(12, avgTime, avgTime * 0.2),
    successTrend: generateTrendData(12, successVal, 3),
    failureTrend: generateTrendData(12, 100 - successVal, 3)
  };
});

const makeEmptySupplyByProject = (projects) =>
  (projects || []).reduce((acc, p) => {
    acc[p] = {
      project: p,
      projectName: '',
      currentRoutes: null, // 当前真实供应路数（来自 Metabase db=131）
      ordersToday: null, // 当前真实下单路数（常规+弹性，来自 Metabase db=159）
      redundancy: null,
      redundancyRatio: null, // 冗余占订单的比例
    };
    return acc;
  }, {});

// --- 增强型交互式趋势图组件 ---
const InteractiveChart = ({ data, color = "#3b82f6", height = 40, showArea = true, unit = "" }) => {
  const [hoverInfo, setHoverInfo] = useState(null);
  const svgRef = useRef(null);

  const values = data.map(d => d.value);
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
    
    points.forEach(p => {
      const diff = Math.abs(mouseX - p.x);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    });
    setHoverInfo(closest);
  };

  return (
    <div className="relative w-full h-full group" onMouseLeave={() => setHoverInfo(null)}>
      <svg 
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`} 
        className="w-full h-full overflow-visible cursor-crosshair" 
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
        <path d={pathString} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        
        {hoverInfo && (
          <g>
            <line x1={hoverInfo.x} y1="0" x2={hoverInfo.x} y2={height} stroke={color} strokeWidth="0.5" strokeDasharray="2,2" />
            <circle cx={hoverInfo.x} cy={hoverInfo.y} r="2" fill="white" stroke={color} strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {hoverInfo && (
        <div 
          className="absolute z-[100] pointer-events-none bg-slate-900/90 text-white px-2 py-1.5 rounded shadow-xl text-[10px] whitespace-nowrap -translate-y-full"
          style={{ 
            left: `${(hoverInfo.x / width) * 100}%`, 
            top: `${(hoverInfo.y / height) * 100 - 8}px`,
            transform: `translate(${hoverInfo.x > width * 0.7 ? '-105%' : '5%'}, -100%)` 
          }}
        >
          <div className="font-bold border-b border-white/20 mb-1 pb-0.5">{hoverInfo.date}</div>
          <div>{hoverInfo.value.toFixed(1)}{unit}</div>
        </div>
      )}
    </div>
  );
};

const MiniCompareChart = ({ a, b, colorA, colorB, height = 56, unit = '' }) => {
  const [hoverInfo, setHoverInfo] = useState(null);
  const svgRef = useRef(null);

  const width = 100;
  const values = [...a.map(d => d.value), ...b.map(d => d.value)];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const mkPoints = (data) => data.map((d, i) => {
    const x = (i / Math.max(1, data.length - 1)) * width;
    const y = height - ((d.value - min) / range) * height;
    return { x, y, value: d.value, date: d.date };
  });

  const pointsA = mkPoints(a);
  const pointsB = mkPoints(b);

  const pathA = pointsA.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  const pathB = pointsB.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round((mouseX / width) * (Math.max(1, a.length - 1)));
    const safeIdx = Math.min(Math.max(0, idx), Math.max(0, a.length - 1));
    setHoverInfo({
      date: a[safeIdx]?.date,
      a: a[safeIdx]?.value,
      b: b[safeIdx]?.value,
      x: pointsA[safeIdx]?.x ?? 0,
    });
  };

  return (
    <div className="relative w-full h-full" onMouseLeave={() => setHoverInfo(null)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full overflow-visible cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
      >
        <path d={pathA} fill="none" stroke={colorA} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathB} fill="none" stroke={colorB} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3,3" />
        {hoverInfo && (
          <g>
            <line x1={hoverInfo.x} y1="0" x2={hoverInfo.x} y2={height} stroke="#94a3b8" strokeWidth="0.6" strokeDasharray="2,2" />
          </g>
        )}
      </svg>

      {hoverInfo && (
        <div
          className="absolute z-[100] pointer-events-none bg-slate-900/90 text-white px-2 py-1.5 rounded shadow-xl text-[10px] whitespace-nowrap -translate-y-full"
          style={{
            left: `${(hoverInfo.x / width) * 100}%`,
            top: `-4px`,
            transform: `translate(${hoverInfo.x > width * 0.7 ? '-105%' : '5%'}, -100%)`,
          }}
        >
          <div className="font-bold border-b border-white/20 mb-1 pb-0.5">{hoverInfo.date}</div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-200">当前</span>
            <span className="font-black">{Number(hoverInfo.a ?? 0).toFixed(0)}{unit}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-200">订单峰值</span>
            <span className="font-black">{Number(hoverInfo.b ?? 0).toFixed(0)}{unit}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const DualSeriesChart = ({ seriesA, seriesB, labelA, labelB, colorA, colorB, height = 56, unit = '' }) => {
  const [hoverInfo, setHoverInfo] = useState(null);
  const svgRef = useRef(null);

  const a = Array.isArray(seriesA) ? seriesA : [];
  const b = Array.isArray(seriesB) ? seriesB : [];
  const len = Math.max(a.length, b.length);
  const width = 100;

  const values = [...a.map(d => d.value), ...b.map(d => d.value)];
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const range = max - min || 1;

  const mkPoints = (data) => data.map((d, i) => {
    const x = (i / Math.max(1, len - 1)) * width;
    const y = height - ((d.value - min) / range) * height;
    return { x, y, value: d.value, date: d.date };
  });

  const pointsA = mkPoints(a);
  const pointsB = mkPoints(b);
  const pathA = pointsA.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  const pathB = pointsB.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round((mouseX / width) * (Math.max(1, len - 1)));
    const safeIdx = Math.min(Math.max(0, idx), Math.max(0, len - 1));
    const date = a[safeIdx]?.date || b[safeIdx]?.date || '';
    setHoverInfo({
      date,
      a: a[safeIdx]?.value,
      b: b[safeIdx]?.value,
      x: (safeIdx / Math.max(1, len - 1)) * width,
    });
  };

  return (
    <div className="relative w-full h-full" onMouseLeave={() => setHoverInfo(null)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full overflow-visible cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
      >
        {pathA && <path d={pathA} fill="none" stroke={colorA} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {pathB && <path d={pathB} fill="none" stroke={colorB} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3,3" />}
        {hoverInfo && (
          <g>
            <line x1={hoverInfo.x} y1="0" x2={hoverInfo.x} y2={height} stroke="#94a3b8" strokeWidth="0.6" strokeDasharray="2,2" />
          </g>
        )}
      </svg>

      {hoverInfo && (
        <div
          className="absolute z-[100] pointer-events-none bg-slate-900/90 text-white px-2 py-1.5 rounded shadow-xl text-[10px] whitespace-nowrap -translate-y-full"
          style={{
            left: `${(hoverInfo.x / width) * 100}%`,
            top: `-4px`,
            transform: `translate(${hoverInfo.x > width * 0.7 ? '-105%' : '5%'}, -100%)`,
          }}
        >
          <div className="font-bold border-b border-white/20 mb-1 pb-0.5">{hoverInfo.date}</div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-200">{labelA}</span>
            <span className="font-black">{Number(hoverInfo.a ?? 0).toFixed(0)}{unit}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-200">{labelB}</span>
            <span className="font-black">{Number(hoverInfo.b ?? 0).toFixed(0)}{unit}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const MultiSeriesChart = ({ seriesList, height = 56, unit = '' }) => {
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
    const idx = Math.round((mouseX / width) * (Math.max(1, maxLen - 1)));
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
    <div className="relative w-full h-full" onMouseLeave={() => setHoverInfo(null)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full overflow-visible cursor-crosshair"
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
            <line x1={hoverInfo.x} y1="0" x2={hoverInfo.x} y2={height} stroke="#94a3b8" strokeWidth="0.6" strokeDasharray="2,2" />
          </g>
        )}
      </svg>

      {hoverInfo && (
        <div
          className="absolute z-[100] pointer-events-none bg-slate-900/90 text-white px-2 py-1.5 rounded shadow-xl text-[10px] whitespace-nowrap -translate-y-full"
          style={{
            left: `${(hoverInfo.x / width) * 100}%`,
            top: `-4px`,
            transform: `translate(${hoverInfo.x > width * 0.7 ? '-105%' : '5%'}, -100%)`,
          }}
        >
          <div className="font-bold border-b border-white/20 mb-1 pb-0.5">{hoverInfo.date}</div>
          <div className="space-y-0.5">
            {hoverInfo.values.map((v) => (
              <div key={v.label} className="flex items-center justify-between gap-3">
                <span className="text-slate-200 flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: v.color }} />
                  {v.label}
                </span>
                <span className="font-black">{Number(v.value ?? 0).toFixed(0)}{unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const unitLabelForProject = (projectId) => (String(projectId) === '33' ? '卡' : '路');

// --- 全部机房/游戏明细抽屉 ---
const DetailsDrawer = ({ isOpen, onClose, stage }) => {
  if (!stage || (!stage.rooms && !stage.gameDetails)) return null;
  const isGameView = stage.id === 'game-save-31-pc';
  const list = isGameView ? stage.gameDetails : stage.rooms;

  return (
    <>
      <div className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-[55] transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed top-0 right-0 h-full w-[540px] bg-white shadow-2xl z-[60] transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full font-sans text-slate-700">
          <div className="px-6 py-5 border-b flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center">
                <stage.icon size={18} className="mr-3 text-blue-600" />
                {stage.name} - {isGameView ? '游戏维度统计' : '机房分组统计'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">统计周期：24小时趋势 (异常判定阈值: 90%)</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-auto p-6 space-y-3 bg-slate-50/50">
            {list.map((item) => (
              <div key={item.id} className={`flex flex-col p-4 bg-white border rounded-xl hover:shadow-md transition-shadow ${item.success < 90 ? 'border-red-200 bg-red-50/20' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`w-2 h-2 rounded-full ${item.success >= 90 ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
                    <span className="text-sm font-bold text-slate-800">{item.name}</span>
                    {item.success < 90 && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-black">异常</span>}
                  </div>
                  <div className="flex space-x-4 text-right">
                    <div className="text-[10px]"><span className="text-slate-400">平均耗时:</span> <span className="font-bold">{Math.round(item.time)}s</span></div>
                    <div className="text-[10px]"><span className="text-slate-400">成功率:</span> <span className={`font-bold ${item.success >= 90 ? 'text-emerald-600' : 'text-red-600'}`}>{item.success}%</span></div>
                  </div>
                </div>
                <div className="h-10 w-full mt-1">
                  <InteractiveChart data={item.successTrend} color={item.success >= 90 ? "#10b981" : "#ef4444"} height={40} unit="%" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// --- 指标详情抽屉 (支持 7 天) ---
const MetricDetailDrawer = ({ isOpen, onClose, metricName, data, seriesList, unit, color, isSevenDays = false }) => {
  const hasMulti = Array.isArray(seriesList) && seriesList.length > 0;
  if (!hasMulti && !data) return null;
  const values = hasMulti
    ? seriesList.flatMap((s) => (Array.isArray(s?.data) ? s.data.map((d) => d.value) : []))
    : data.map(d => d.value);
  const max = values.length ? Math.max(...values).toFixed(1) : '—';
  const min = values.length ? Math.min(...values).toFixed(1) : '—';
  const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : '—';

  return (
    <>
      <div className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-[70] transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-[80] transform transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full font-sans">
          <div className="p-6 border-b flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">{metricName}</h3>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {isSevenDays ? '近 7 天趋势分析' : '按小时统计趋势'} ({unit})
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"><X size={20}/></button>
          </div>
          <div className="flex-1 overflow-auto p-6 bg-slate-50/30">
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center">
                <div className="text-[10px] font-bold text-slate-400 mb-1">峰值</div>
                <div className="text-lg font-black text-slate-800">{max}{unit}</div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center">
                <div className="text-[10px] font-bold text-slate-400 mb-1">平均</div>
                <div className="text-lg font-black text-slate-800">{avg}{unit}</div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-center">
                <div className="text-[10px] font-bold text-slate-400 mb-1">谷值</div>
                <div className="text-lg font-black text-slate-800">{min}{unit}</div>
              </div>
            </div>
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-48 w-full">
                {hasMulti ? (
                  <MultiSeriesChart seriesList={seriesList} height={180} unit={unit} />
                ) : (
                  <InteractiveChart data={data} color={color} height={180} unit={unit} />
                )}
              </div>
              <div className="flex justify-between mt-4 text-[10px] text-slate-400 font-bold uppercase">
                <span>{hasMulti ? (seriesList?.[0]?.data?.[0]?.date || '') : data[0].date}</span>
                <span>{hasMulti ? (seriesList?.[0]?.data?.[Math.floor((seriesList?.[0]?.data?.length || 1)/2)]?.date || '') : data[Math.floor(data.length/2)].date}</span>
                <span>{hasMulti ? (seriesList?.[0]?.data?.[(seriesList?.[0]?.data?.length || 1)-1]?.date || '') : data[data.length-1].date}</span>
              </div>
            </div>

            {isSevenDays && (
               <div className="mt-8 p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
                  <div className="flex items-center text-blue-700 text-xs font-bold mb-2">
                    <Info size={14} className="mr-2" /> 趋势解读
                  </div>
                  {hasMulti ? (() => {
                    const pick = (lbl) =>
                      (seriesList || []).find((s) => String(s?.label || '') === lbl)?.data || [];
                    const supplyMax = pick('供应最大');
                    const supplyAvg = pick('供应平均');
                    const orders = pick('订单');
                    const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);
                    const lastMax = last(supplyMax)?.value;
                    const lastAvg = last(supplyAvg)?.value;
                    const lastOrders = last(orders)?.value;
                    const maxOf = (arr) => (Array.isArray(arr) && arr.length ? Math.max(...arr.map((d) => d.value)) : null);
                    const avgOf = (arr) =>
                      (Array.isArray(arr) && arr.length ? (arr.reduce((s, d) => s + d.value, 0) / arr.length) : null);
                    const peakSupply = maxOf(supplyMax);
                    const meanSupply = avgOf(supplyAvg);
                    const peakOrders = maxOf(orders);
                    const meanOrders = avgOf(orders);
                    const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(0) : '—');
                    const u = unit || '';
                    const risk =
                      typeof peakSupply === 'number' && typeof peakOrders === 'number'
                        ? (peakSupply < peakOrders ? '风险：订单峰值高于供应峰值，可能出现排队/缺口。' : '供应峰值覆盖订单峰值，整体余量充足。')
                        : '当前数据不足，无法判断冗余风险。';

                    return (
                      <div className="text-[11px] text-blue-600 leading-relaxed space-y-1">
                        <div>
                          近7天供应峰值/均值：{fmt(peakSupply)}{u} / {fmt(meanSupply)}{u}；订单峰值/均值：{fmt(peakOrders)}{u} / {fmt(meanOrders)}{u}
                        </div>
                        <div>
                          最近一天：供应最大 {fmt(lastMax)}{u}，供应平均 {fmt(lastAvg)}{u}，订单 {fmt(lastOrders)}{u}
                        </div>
                        <div className="font-bold">{risk}</div>
                      </div>
                    );
                  })() : (
                    <p className="text-[11px] text-blue-600 leading-relaxed">
                      近7天数据用于观察波动与异常尖峰。若峰值显著高于均值，通常代表存在短时脉冲流量或资源调度抖动，建议结合订单与供应对比判断冗余风险。
                    </p>
                  )}
               </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// --- 阶段行组件 ---
const StageRow = ({ stage, index, onMetricClick, onShowAllRooms, timeRange }) => {
  const isQueueStage = stage.id === 'queue-status';
  const isGameViewStage = stage.id === 'game-save-31-pc';
  const timeSeries =
    stage.timeTrendByRange && timeRange
      ? stage.timeTrendByRange[timeRange] || stage.timeTrend
      : stage.timeTrend;
  
  const riskyItems = useMemo(() => {
    const list = isGameViewStage ? stage.gameDetails : stage.rooms;
    if (!list) return [];
    return list
      .filter(r => r.success < 90) 
      .sort((a, b) => a.success - b.success);
  }, [stage.rooms, stage.gameDetails, isGameViewStage]);

  const hasAnomaly = riskyItems.length > 0;

  return (
    <div className="flex flex-col md:flex-row bg-white border border-slate-200 mb-[-1px] first:rounded-t-xl last:rounded-b-xl hover:bg-slate-50 transition-colors group">
      <div className={`p-5 shrink-0 border-r border-slate-100 flex flex-col justify-between bg-slate-50/30 md:w-80`}>
        <div className="flex items-start space-x-3">
          <div className="relative">
            <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm text-slate-600 group-hover:text-blue-600 transition-colors"><stage.icon size={20} /></div>
            <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-slate-900 text-white rounded-md flex items-center justify-center text-[10px] font-black italic">
              {String(index + 1).padStart(2, '0')}
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">{stage.name}</h3>
            <p className="text-[11px] text-slate-400 mt-1 leading-tight line-clamp-2">{stage.note}</p>
          </div>
        </div>
        <div className={`grid grid-cols-2 gap-2 mt-5`}>
          <button onClick={() => onMetricClick(`${stage.name}-耗时`, timeSeries, 's', '#3b82f6')} className="bg-white p-2.5 rounded-lg border border-slate-200/60 text-left hover:border-blue-300 hover:shadow-sm transition-all">
            <div className="text-[9px] text-slate-400 font-bold mb-0.5">平均耗时</div>
            <div className="text-xs font-black text-slate-800 flex items-center justify-between">{stage.avgTime}s <BarChart3 size={10} className="text-slate-300" /></div>
          </button>
          <button onClick={() => onMetricClick(`${stage.name}-成功率`, stage.successTrend, '%', '#10b981')} className="bg-white p-2.5 rounded-lg border border-slate-200/60 text-left hover:border-emerald-300 hover:shadow-sm transition-all">
            <div className="text-[9px] text-slate-400 font-bold mb-0.5">成功率</div>
            <div className="text-xs font-black flex items-center justify-between">
              <span className={stage.successRate >= 90 ? 'text-emerald-600' : 'text-red-500'}>{stage.successRate}%</span>
              <BarChart3 size={10} className="text-slate-300" />
            </div>
          </button>
        </div>
      </div>

      <div className="flex-1 p-5 flex flex-col justify-center min-w-0 bg-white">
        {isQueueStage ? (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
               <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 flex items-center">
                 <TrendingUp size={12} className="mr-1.5" />
                 排队人数趋势 (24小时)
               </span>
               <button onClick={() => onShowAllRooms(stage)} className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center">详情分布 <ChevronRight size={14} /></button>
            </div>
            <div className="flex-1 bg-slate-50/50 rounded-xl p-4 border border-slate-100 flex items-end relative overflow-hidden">
               <div className="w-full h-24 relative z-10">
                 <InteractiveChart data={stage.queueTrend} color="#3b82f6" height={100} showArea={true} unit="人" />
               </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                 <span className={`text-[10px] font-bold uppercase tracking-wider ${hasAnomaly ? 'text-red-600 flex items-center' : 'text-slate-300'}`}>
                  {hasAnomaly && <AlertTriangle size={12} className="mr-1.5 animate-pulse" />}
                  {hasAnomaly ? `${isGameViewStage ? '异常游戏' : '异常机房'}分布 (24h 波动)` : `系统监控状态`}
                </span>
                {!hasAnomaly && <CheckCircle2 size={12} className="text-emerald-500" />}
              </div>
              <button onClick={() => onShowAllRooms(stage)} className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center transition-colors">查看详情 <ChevronRight size={14} className="ml-0.5" /></button>
            </div>
            
            <div className="flex space-x-3 overflow-x-auto pb-2 custom-scrollbar-minimal min-h-[80px]">
              {hasAnomaly ? (
                riskyItems.map((item, idx) => (
                  <div key={item.id} className={`shrink-0 w-48 p-3 bg-red-50/30 border rounded-xl shadow-sm transition-all relative ${idx === 0 ? 'border-red-500 ring-2 ring-red-500/10' : 'border-red-200 hover:border-red-400'}`}>
                    <div className="text-[11px] font-bold text-slate-800 truncate mb-1 flex items-center justify-between">
                        <span className="flex items-center">
                          {isGameViewStage && <Gamepad2 size={12} className="mr-1.5 text-slate-400" />}
                          {item.name}
                        </span>
                        <span className="text-[9px] bg-red-500 text-white px-1 rounded uppercase">异常</span>
                    </div>
                    <div className="h-10 w-full mb-1">
                      <InteractiveChart data={item.successTrend} color="#ef4444" height={40} unit="%" />
                    </div>
                    <div className="flex justify-between w-full text-[9px]">
                        <span className="text-slate-400">实时成功率:</span>
                        <span className="text-red-600 font-black">{item.success}%</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center w-full bg-emerald-50/20 border border-emerald-100/50 rounded-2xl py-4 transition-all">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-emerald-100 text-emerald-600 rounded-full">
                       <ShieldCheck size={18} />
                    </div>
                    <span className="text-sm font-bold text-emerald-700 tracking-tight">24小时内所有检测点位表现正常</span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default function ResourceDashboard() {
  const useApi =
    String(import.meta.env.VITE_USE_API || '').toLowerCase() === '1' ||
    String(import.meta.env.VITE_USE_API || '').toLowerCase() === 'true';
  const [activeTab, setActiveTab] = useState('cloud'); // 默认云化 Tab，便于首屏就拉取 Metabase 数据 
  const [metricDrawer, setMetricDrawer] = useState({ isOpen: false, name: '', data: null, unit: '', color: '', isSevenDays: false });
  const [roomsDrawer, setRoomsDrawer] = useState({ isOpen: false, stage: null });
  const [selectedProjects, setSelectedProjects] = useState([]);
  const [timeRange, setTimeRange] = useState('24h'); // 24h | 7d | 30d
  const [remoteProjects, setRemoteProjects] = useState(null);
  const [remoteByTab, setRemoteByTab] = useState({});
  const [dataStatus, setDataStatus] = useState({ loading: false, error: null, source: 'mock' }); // mock | api
  const [retryKey, setRetryKey] = useState(0);
  const [supplyOrdersToday, setSupplyOrdersToday] = useState({ byProject: null, unmapped: null, error: null, loading: false });
  const [supplyCurrentRoutes, setSupplyCurrentRoutes] = useState({ byProject: null, error: null, loading: false });
  const [supplyRoutes7d, setSupplyRoutes7d] = useState({ byProject: null, error: null, loading: false });
  const [supplyOrders7d, setSupplyOrders7d] = useState({ byProject: null, unmapped: null, error: null, loading: false });
  const [expandedSupplyTableByProject, setExpandedSupplyTableByProject] = useState({});

  const cloudStageData = useMemo(() => [
    { 
      id: 'auto-cloud',
      project: '项目A',
      name: '自动云化任务',
      icon: Workflow,
      avgTime: 1250,
      successRate: 98.5,
      note: '全自动云化流程，从发起至交付客户全时长统计',
      rooms: generateRooms(8, 1250, true),
      timeTrend: generateTrendData(24, 1250, 200),
      timeTrendByRange: {
        '24h': generateTrendData(24, 1250, 200),
        '7d': generateTrendData(7, 1250, 150, 'day'),
        '30d': generateTrendData(30, 1250, 250, 'day'),
      },
      successTrend: generateTrendData(24, 98.5, 1),
    },
    { 
      id: 'room-dist-32',
      project: '项目A',
      name: '机房分发阶段',
      icon: Network,
      avgTime: 420,
      successRate: 99.1,
      note: '全部机房机房分发子任务',
      rooms: generateRooms(15, 420, true),
      timeTrend: generateTrendData(24, 420, 60),
      timeTrendByRange: {
        '24h': generateTrendData(24, 420, 60),
        '7d': generateTrendData(7, 420, 45, 'day'),
        '30d': generateTrendData(30, 420, 80, 'day'),
      },
      successTrend: generateTrendData(24, 99.1, 0.5),
    },
    { 
        id: 'game-save-31-pc', 
        project: '项目B',
        name: '游戏镜像保存 (端游)', 
        icon: Save, 
        avgTime: 185, 
        successRate: 94.2, 
        note: '上传到OSS按游戏维度统计：Σ(结束时间-开始时间)/子任务总数', 
        gameDetails: generateGameDetails(9, 185), 
        timeTrend: generateTrendData(24, 185, 30),
        timeTrendByRange: {
          '24h': generateTrendData(24, 185, 30),
          '7d': generateTrendData(7, 185, 25, 'day'),
          '30d': generateTrendData(30, 185, 35, 'day'),
        },
        successTrend: generateTrendData(24, 94.2, 5),
    },
    { 
      id: 'deploy-33',
      project: '项目B',
      name: '游戏部署阶段',
      icon: MonitorPlay,
      avgTime: 65,
      successRate: 99.5,
      note: '统计全部机房游戏部署子任务成功比例',
      rooms: generateRooms(10, 65),
      timeTrend: generateTrendData(24, 65, 10),
      timeTrendByRange: {
        '24h': generateTrendData(24, 65, 10),
        '7d': generateTrendData(7, 65, 8, 'day'),
        '30d': generateTrendData(30, 65, 12, 'day'),
      },
      successTrend: generateTrendData(24, 99.5, 0.3),
    },
    { 
      id: 'accelerate-34',
      project: '项目C',
      name: '游戏加速阶段',
      icon: Zap,
      avgTime: 12,
      successRate: 99.8,
      note: '统计全部游戏游戏加速子任务成功比例',
      rooms: generateRooms(10, 12),
      timeTrend: generateTrendData(24, 12, 2),
      timeTrendByRange: {
        '24h': generateTrendData(24, 12, 2),
        '7d': generateTrendData(7, 12, 1.5, 'day'),
        '30d': generateTrendData(30, 12, 3, 'day'),
      },
      successTrend: generateTrendData(24, 99.8, 0.1),
    },
    { 
      id: 'game-save-31-mobile',
      project: '项目C',
      name: '保存镜像 (手游)',
      icon: Smartphone,
      avgTime: 210,
      successRate: 98.4,
      note: '手游：保存镜像；统计已完成子任务成功比例',
      rooms: generateRooms(12, 210),
      timeTrend: generateTrendData(24, 210, 40),
      timeTrendByRange: {
        '24h': generateTrendData(24, 210, 40),
        '7d': generateTrendData(7, 210, 35, 'day'),
        '30d': generateTrendData(30, 210, 50, 'day'),
      },
      successTrend: generateTrendData(24, 98.4, 1.5),
    },
    { 
      id: 'mount-35',
      project: '项目D',
      name: '云盘挂载阶段',
      icon: HardDrive,
      avgTime: 18,
      successRate: 99.2,
      note: '统计全部游戏云盘挂载子任务成功比例',
      rooms: generateRooms(10, 18),
      timeTrend: generateTrendData(24, 18, 5),
      timeTrendByRange: {
        '24h': generateTrendData(24, 18, 5),
        '7d': generateTrendData(7, 18, 4, 'day'),
        '30d': generateTrendData(30, 18, 6, 'day'),
      },
      successTrend: generateTrendData(24, 99.2, 0.5),
    },
    { 
      id: 'dist-36',
      project: '项目D',
      name: '云盘分发阶段',
      icon: Share2,
      avgTime: 315,
      successRate: 92.1,
      note: '统计全部游戏云盘分发子任务成功比例',
      rooms: generateRooms(12, 315),
      timeTrend: generateTrendData(24, 315, 50),
      timeTrendByRange: {
        '24h': generateTrendData(24, 315, 50),
        '7d': generateTrendData(7, 315, 45, 'day'),
        '30d': generateTrendData(30, 315, 70, 'day'),
      },
      successTrend: generateTrendData(24, 92.1, 4),
    },
  ], []);

  const schedulingData = useMemo(() => [
    { 
      id: 'queue-status', 
      project: '项目A',
      name: '用户排队情况', 
      icon: Users, 
      avgTime: 142, 
      successRate: 85.5, 
      note: '统计全局平均出队时长及排队趋势', 
      rooms: generateRooms(20, 142),
      timeTrend: generateTrendData(24, 142, 30), 
      successTrend: generateTrendData(24, 85.5, 10),
      queueTrend: generateTrendData(24, 800, 400) 
    },
  ], []);

  const instanceData = useMemo(() => [
    { id: 'phys-reboot-41', project: '项目A', name: '物理机重启阶段', icon: Cpu, avgTime: 180, successRate: 99.3, note: '物理服务器执行硬重启/软重启的子任务成功比例', rooms: generateRooms(12, 180, true), timeTrend: generateTrendData(24, 180, 20), successTrend: generateTrendData(24, 99.3, 0.4) },
    { id: 'inst-reboot-42', project: '项目B', name: '实例重启阶段', icon: RotateCcw, avgTime: 42, successRate: 98.8, note: '实例执行重启操作的子任务成功比例', rooms: generateRooms(15, 42), timeTrend: generateTrendData(24, 42, 10), successTrend: generateTrendData(24, 98.8, 1) },
    { id: 'inst-img-43', project: '项目C', name: '镜像分发阶段 (实例)', icon: Box, avgTime: 280, successRate: 91.5, note: '实例执行镜像同步/更新的子任务成功比例', rooms: generateRooms(18, 280), timeTrend: generateTrendData(24, 280, 45), successTrend: generateTrendData(24, 91.5, 4) },
    { id: 'service-dist-44', project: '项目D', name: '服务组分发阶段', icon: Layers3, avgTime: 15, successRate: 99.4, note: '实例加入或迁移至服务组的分发任务成功比例', rooms: generateRooms(10, 15), timeTrend: generateTrendData(24, 15, 3), successTrend: generateTrendData(24, 99.4, 0.4) },
  ], []);

  const activeData =
    activeTab === 'cloud'
      ? cloudStageData
      : activeTab === 'scheduling'
        ? schedulingData
        : activeTab === 'health'
          ? instanceData
          : [];

  const summaryMetrics = {
    cloud: { 
      label: '云化任务平均耗时',
      value: '1250s',
      color: '#10b981',
      icon: Workflow,
      tabName: '游戏云化任务',
      trends: {
        '24h': generateTrendData(24, 1250, 200),
        '7d': generateTrendData(7, 1250, 150, 'day'),
        '30d': generateTrendData(30, 1250, 220, 'day'),
      },
      sevenDayTrend: generateTrendData(7, 1250, 150, 'day'),
    },
    scheduling: { label: '全局出队时长', value: '142s', color: '#8b5cf6', icon: Users, tabName: '调度与体验', trend: generateTrendData(24, 142, 30), sevenDayTrend: generateTrendData(7, 142, 40, 'day') },
    health: { label: '全局实例可用率', value: '99.2%', color: '#10b981', icon: ShieldCheck, tabName: '实例任务', trend: generateTrendData(24, 99.2, 0.5), sevenDayTrend: generateTrendData(7, 99.2, 0.3, 'day') },
    supply: { label: '供应路数冗余', value: '—', color: '#0ea5e9', icon: Server, tabName: '供应看板', trend: generateTrendData(7, 120, 30, 'day'), sevenDayTrend: generateTrendData(7, 120, 30, 'day') },
  };

  const currentSummary = summaryMetrics[activeTab];
  const overviewTrend =
    activeTab === 'cloud'
      ? currentSummary.trends[timeRange]
      : currentSummary.trend;

  // --- 接口数据加载（预留板块）：你只需要实现 src/api/dashboardApi.js ---
  useEffect(() => {
    if (!useApi) return;
    let cancelled = false;
    (async () => {
      try {
        const options = await fetchProjectOptions();
        if (!cancelled && Array.isArray(options) && options.length > 0) {
          setRemoteProjects(options);
        }
      } catch {
        // 未接入接口时保持 mock
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!useApi) {
      setDataStatus({ loading: false, error: null, source: 'mock' });
      return;
    }
    let cancelled = false;
    (async () => {
      setDataStatus(prev => ({ ...prev, loading: true, error: null }));
      try {
        // 云化 Tab 已对接 Metabase，不请求 snapshot，直接请求 summary（会发 Metabase /api/dataset）
        const skipSnapshot = activeTab === 'cloud';

        if (!skipSnapshot) {
          try {
            const payload = await fetchDashboardSnapshot({
              tab: activeTab,
              timeRange,
              projects: selectedProjects,
            });
            const valid = payload && typeof payload === 'object' && payload.summary != null;
            if (!cancelled && valid) {
              setRemoteByTab(prev => ({ ...prev, [activeTab]: payload }));
              setDataStatus({ loading: false, error: null, source: 'api' });
              return;
            }
          } catch (_) {}
        }

        // 云化 Tab 或 snapshot 未实现：分别请求 summary、stages（云化会走 Metabase）
        let summary = null;
        let stages = null;
        try {
          summary = await fetchTabSummary({ tab: activeTab, timeRange, projects: selectedProjects });
        } catch (err) {
          if (activeTab === 'cloud') console.error('[资源观测] Metabase summary 请求失败:', err);
        }
        try {
          stages = await fetchTabStages({ tab: activeTab, timeRange, projects: selectedProjects });
        } catch (_) {}
        if (cancelled) return;
        if (summary != null || stages != null) {
          setRemoteByTab(prev => ({ ...prev, [activeTab]: { summary, stages } }));
          setDataStatus({ loading: false, error: null, source: 'api' });
        } else {
          const errMsg =
            activeTab === 'cloud'
              ? 'Metabase 未返回数据，请检查 .env、Network 里是否有 /api/metabase 请求'
              : '接口请求失败';
          console.error('[资源观测] 回退到模拟数据:', errMsg);
          setDataStatus({ loading: false, error: errMsg, source: 'mock' });
        }
      } catch (e) {
        if (cancelled) return;
        const errMsg = (e && e.message) || '接口请求失败';
        console.error('[资源观测] 接口回退到模拟数据:', e);
        setDataStatus({ loading: false, error: errMsg, source: 'mock' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, timeRange, selectedProjects, retryKey, useApi]);

  useEffect(() => {
    // 不同 tab 的项目标识不一定一致（例如供应看板用 biz 项目ID），避免串台
    setSelectedProjects([]);
  }, [activeTab]);

  useEffect(() => {
    if (!useApi || activeTab !== 'supply') return;
    let cancelled = false;
    (async () => {
      setSupplyOrdersToday((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetchSupplyOrdersTodayFromMetabase({
          settlementIdToProjectId: projectIdsFromSettlementId,
        });
        if (cancelled) return;
        setSupplyOrdersToday({ byProject: res.byProject, unmapped: res.unmapped, error: null, loading: false });
      } catch (e) {
        if (cancelled) return;
        setSupplyOrdersToday((s) => ({ ...s, loading: false, error: e?.message || '供应看板取数失败' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useApi, activeTab, retryKey]);

  useEffect(() => {
    if (!useApi || activeTab !== 'supply') return;
    let cancelled = false;
    (async () => {
      setSupplyOrders7d((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetchSupplyOrders7dFromMetabase({
          settlementIdToProjectId: projectIdsFromSettlementId,
        });
        if (cancelled) return;
        setSupplyOrders7d({ byProject: res.byProject, unmapped: res.unmapped, error: null, loading: false });
      } catch (e) {
        if (cancelled) return;
        setSupplyOrders7d((s) => ({ ...s, loading: false, error: e?.message || '订单近7天取数失败' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useApi, activeTab, retryKey]);

  useEffect(() => {
    if (!useApi || activeTab !== 'supply') return;
    let cancelled = false;
    (async () => {
      setSupplyCurrentRoutes((s) => ({ ...s, loading: true, error: null }));
      try {
        const [res, bd] = await Promise.all([
          fetchSupplyCurrentRoutesFromMetabase(),
          fetchSupplyCurrentRoutesBytedanceFromMetabase().catch(() => null),
        ]);
        if (cancelled) return;
          const byProject = { ...(res.byProject || {}) };
        // 字节跳动当前：强制用专用 SQL 覆盖 project_id=33
        if (bd && bd.projectId === '33') {
          byProject['33'] = {
            projectName: bd.projectName || byProject['33']?.projectName || '字节跳动',
            total: bd.value,
            available: bd.value,
            unavailable: 0,
          };
        }
        setSupplyCurrentRoutes({ byProject, error: null, loading: false });
      } catch (e) {
        if (cancelled) return;
        setSupplyCurrentRoutes((s) => ({ ...s, loading: false, error: e?.message || '供应路数取数失败' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useApi, activeTab, retryKey]);

  useEffect(() => {
    if (!useApi || activeTab !== 'supply') return;
    let cancelled = false;
    (async () => {
      setSupplyRoutes7d((s) => ({ ...s, loading: true, error: null }));
      try {
        const [res, bytedance] = await Promise.all([
          fetchSupplyRoutes7dFromMetabase(),
          fetchSupplyRoutes7dBytedanceFromMetabase().catch(() => ({ byProject: {} })),
        ]);
        if (cancelled) return;
        const base = res.byProject || {};
        const bd = bytedance.byProject || {};

        const merged = { ...base };
        // 字节跳动项目：强制用专用 SQL 覆盖 project_id=33 的 7 天 max/avg
        if (bd['33']) merged['33'] = bd['33'];

        setSupplyRoutes7d({ byProject: merged, error: null, loading: false });
      } catch (e) {
        if (cancelled) return;
        setSupplyRoutes7d((s) => ({ ...s, loading: false, error: e?.message || '供应近7天取数失败' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useApi, activeTab, retryKey]);

  const apiPayload = remoteByTab[activeTab];
  const projectOptions = remoteProjects || projectList;
  const mappedSupplyProjectIdSet = useMemo(
    () => new Set(getAllMappedProjectIds().map((x) => String(x).trim()).filter(Boolean)),
    [],
  );
  const supplyProjectOptions = useMemo(() => {
    // 过滤规则：仅展示“有订单数据”的项目
    const ordersByProject = supplyOrdersToday.byProject;
    if (ordersByProject && typeof ordersByProject === 'object') {
      const orderIds = Object.keys(ordersByProject)
        .map((pid) => String(pid).trim())
        .filter((pid) => mappedSupplyProjectIdSet.has(pid));
      if (orderIds.length === 0) return [];
      return orderIds
        .map((pid) => {
          const infoNow = supplyCurrentRoutes.byProject?.[pid];
          const info7d = supplyRoutes7d.byProject?.[pid];
          const label =
            infoNow?.projectName ||
            info7d?.projectName ||
            pid;
          return { id: String(pid), label: String(label) };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
    }
    // 严格模式：订单未返回前，不展示任何项目（避免供应兜底导致“注释映射仍渲染”）
    return [];
  }, [supplyOrdersToday.byProject, supplyCurrentRoutes.byProject, supplyRoutes7d.byProject]);

  const effectiveProjectOptions =
    activeTab === 'supply'
      ? supplyProjectOptions
      : projectOptions.map((p) => ({ id: String(p), label: String(p) }));

  useEffect(() => {
    if (activeTab !== 'supply') return;
    const allowed = new Set((supplyProjectOptions || []).map((p) => String(p.id).trim()));
    setSelectedProjects((prev) => prev.map((id) => String(id).trim()).filter((id) => allowed.has(id)));
  }, [activeTab, supplyProjectOptions]);

  const mergedSummary = (() => {
    if (!apiPayload || !apiPayload.summary) return currentSummary;
    const s = { ...currentSummary, ...apiPayload.summary };
    if (typeof s.value !== 'string' && s.value != null) s.value = String(s.value);
    return s;
  })();

  const mergedStages = (() => {
    if (!apiPayload || !Array.isArray(apiPayload.stages)) return activeData;
    return apiPayload.stages;
  })();

  const finalOverviewTrend =
    activeTab === 'cloud'
      ? (mergedSummary.trends && mergedSummary.trends[timeRange]) ||
        mergedSummary.trend ||
        overviewTrend
      : mergedSummary.trend || overviewTrend;

  const filteredStages =
    selectedProjects.length > 0
      ? mergedStages.filter(stage => selectedProjects.includes(stage.project))
      : mergedStages;

  const supplyByProjectAll = useMemo(
    () => {
      const base = makeEmptySupplyByProject(effectiveProjectOptions.map((p) => p.id));

      const ordersByProject = supplyOrdersToday.byProject || null;
      if (ordersByProject) {
        for (const [projectId, agg] of Object.entries(ordersByProject)) {
          if (!base[projectId]) continue;
          const todayTotal = Number(agg?.total ?? NaN);
          base[projectId].ordersToday = Number.isFinite(todayTotal) ? todayTotal : null;
        }
      }

      const supplyByProject = supplyCurrentRoutes.byProject || null;
      if (supplyByProject) {
        for (const [projectId, info] of Object.entries(supplyByProject)) {
          if (!base[projectId]) continue;
          const total = Number(info?.total ?? NaN);
          base[projectId].projectName = String(info?.projectName || '').trim();
          base[projectId].currentRoutes = Number.isFinite(total) ? total : null;
        }
      }

      const by7d = supplyRoutes7d.byProject || null;
      if (by7d) {
        for (const [projectId, info] of Object.entries(by7d)) {
          if (!base[projectId]) continue;
          if (!base[projectId].projectName) base[projectId].projectName = String(info?.projectName || '').trim();
          const seriesMax = Array.isArray(info?.seriesMax) ? info.seriesMax : [];
          const seriesAvg = Array.isArray(info?.seriesAvg) ? info.seriesAvg : [];
          base[projectId].seriesMax7d = seriesMax;
          base[projectId].seriesAvg7d = seriesAvg;
          base[projectId].max7d = seriesMax.length ? Math.max(...seriesMax.map((d) => d.value)) : null;
          base[projectId].avg7d =
            seriesAvg.length
              ? (seriesAvg.reduce((s, d) => s + d.value, 0) / seriesAvg.length)
              : null;
        }
      }

      const orders7d = supplyOrders7d.byProject || null;
      if (orders7d) {
        for (const [projectId, info] of Object.entries(orders7d)) {
          if (!base[projectId]) continue;
          const series = Array.isArray(info?.series) ? info.series : [];
          base[projectId].seriesOrders7d = series;
          base[projectId].ordersMax7d = series.length ? Math.max(...series.map((d) => d.value)) : null;
          base[projectId].ordersAvg7d =
            series.length ? (series.reduce((s, d) => s + d.value, 0) / series.length) : null;
        }
      }

      // 近7天冗余率序列： (供应-订单)/订单
      for (const it of Object.values(base)) {
        const supplySeries = Array.isArray(it.seriesMax7d) ? it.seriesMax7d : [];
        const orderSeries = Array.isArray(it.seriesOrders7d) ? it.seriesOrders7d : [];
        if (!supplySeries.length || !orderSeries.length) {
          it.seriesRedundancy7d = [];
          continue;
        }
        const supplyByDate = supplySeries.reduce((acc, cur) => {
          acc[cur.date] = cur.value;
          return acc;
        }, {});
        const orderByDate = orderSeries.reduce((acc, cur) => {
          acc[cur.date] = cur.value;
          return acc;
        }, {});
        const dates = Array.from(new Set([...Object.keys(supplyByDate), ...Object.keys(orderByDate)])).sort((a, b) => a.localeCompare(b));
        it.seriesRedundancy7d = dates
          .map((date) => {
            const s = Number(supplyByDate[date]);
            const o = Number(orderByDate[date]);
            if (!Number.isFinite(s) || !Number.isFinite(o) || o === 0) return null;
            return { date, value: ((s - o) / o) * 100 };
          })
          .filter(Boolean);
      }

      for (const it of Object.values(base)) {
        const supply = it.currentRoutes;
        const orders = it.ordersToday;
        if (typeof supply === 'number' && typeof orders === 'number' && orders !== 0) {
          it.redundancy = supply - orders;
          // 冗余率 = (供应-订单)/订单
          it.redundancyRatio = it.redundancy / orders;
        } else {
          it.redundancy = null;
          it.redundancyRatio = null;
        }
      }

      return base;
    },
    [effectiveProjectOptions, supplyOrdersToday.byProject, supplyCurrentRoutes.byProject, supplyRoutes7d.byProject, supplyOrders7d.byProject],
  );

  const supplyByProject = useMemo(() => {
    const base = supplyByProjectAll;
    if (selectedProjects.length === 0) return base;
    return selectedProjects.reduce((acc, p) => {
      const key = String(p).trim();
      if (base[key]) acc[key] = base[key];
      return acc;
    }, {});
  }, [supplyByProjectAll, selectedProjects]);

  const supplySummaryAll = useMemo(() => {
    const list = Object.values(supplyByProjectAll);
    const totalSupply = list.reduce((sum, it) => sum + (typeof it.currentRoutes === 'number' ? it.currentRoutes : 0), 0);
    const totalOrders = list.reduce((sum, it) => sum + (typeof it.ordersToday === 'number' ? it.ordersToday : 0), 0);
    const hasAnySupply = list.some((it) => typeof it.currentRoutes === 'number');
    const hasAnyOrders = list.some((it) => typeof it.ordersToday === 'number');
    const redundancy = hasAnySupply && hasAnyOrders ? (totalSupply - totalOrders) : null;
    const supplyToOrders = totalOrders > 0 ? (totalSupply / totalOrders) : null;
    // 冗余率 = (供应-订单)/订单
    const redundancyRatio = totalOrders > 0 ? ((totalSupply - totalOrders) / totalOrders) : null;
    return { totalSupply: hasAnySupply ? totalSupply : null, totalOrders: hasAnyOrders ? totalOrders : null, redundancy, supplyToOrders, redundancyRatio };
  }, [supplyByProjectAll]);

  const supplyLoading =
    activeTab === 'supply' &&
    (supplyOrdersToday.loading ||
      supplyCurrentRoutes.loading ||
      supplyRoutes7d.loading ||
      supplyOrders7d.loading);

  const supplyEverLoaded = useMemo(() => {
    if (activeTab !== 'supply') return false;
    const hasAny =
      (supplyOrdersToday.byProject && Object.keys(supplyOrdersToday.byProject).length > 0) ||
      (supplyCurrentRoutes.byProject && Object.keys(supplyCurrentRoutes.byProject).length > 0) ||
      (supplyRoutes7d.byProject && Object.keys(supplyRoutes7d.byProject).length > 0) ||
      (supplyOrders7d.byProject && Object.keys(supplyOrders7d.byProject).length > 0);
    return Boolean(hasAny);
  }, [
    activeTab,
    supplyOrdersToday.byProject,
    supplyCurrentRoutes.byProject,
    supplyRoutes7d.byProject,
    supplyOrders7d.byProject,
  ]);

  return (
    <div className="h-full w-full bg-[#f8fafc] text-slate-700 font-sans flex flex-col overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-8 py-4 shrink-0 flex items-center justify-between z-40">
        <div className="flex items-center space-x-4">
          <div className="bg-slate-900 p-2.5 rounded-xl text-white shadow-lg"><LayoutPanelTop size={20} /></div>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-none">资源全链路观测</h1>
            <p className="text-[10px] font-bold text-emerald-600 mt-2 flex items-center uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse"/> 
              实时监测已开启
            </p>
          </div>
        </div>
        <nav className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
          {[
            { id: 'cloud', label: '游戏云化任务' },
            { id: 'scheduling', label: '调度与体验' },
            { id: 'health', label: '实例任务' },
            { id: 'supply', label: '供应看板' }
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-8 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-md shadow-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-auto p-8 pt-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="bg-white px-6 py-3 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center text-[11px] text-slate-500">
              <Filter size={14} className="mr-2 text-slate-400" />
              <span className="font-bold">项目筛选</span>
              {selectedProjects.length > 0 && (
                <span className="ml-2 text-xs text-blue-600 font-bold">
                  已选 {selectedProjects.length} 个
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSelectedProjects([])}
                className={`px-2.5 py-1 rounded-full text-[11px] border ${
                  selectedProjects.length === 0
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                }`}
              >
                全部项目
              </button>
              {effectiveProjectOptions.map(opt => {
                const active = selectedProjects.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    onClick={() =>
                      setSelectedProjects(prev =>
                        prev.includes(opt.id)
                          ? prev.filter(item => item !== opt.id)
                          : [...prev, opt.id],
                      )
                    }
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      active
                        ? 'bg-blue-50 text-blue-600 border-blue-400'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}

              {activeTab === 'cloud' && (
                <div className="flex items-center gap-1 ml-2">
                  <span className="text-[10px] text-slate-400">时间维度</span>
                  {[
                    { id: '24h', label: '24小时' },
                    { id: '7d', label: '近7天' },
                    { id: '30d', label: '近30天' },
                  ].map(range => (
                    <button
                      key={range.id}
                      onClick={() => setTimeRange(range.id)}
                      className={`px-2 py-1 rounded-full text-[10px] border transition-colors ${
                        timeRange === range.id
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-400'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group/board">
            <div className="relative flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex-1">
                <div className="flex items-center space-x-2 text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3">
                  <mergedSummary.icon size={14} />
                  <span>{mergedSummary.tabName}</span>
                </div>
                <div className="text-sm font-bold text-slate-400 mb-1">{mergedSummary.label}</div>
                <div className="flex items-baseline flex-wrap gap-2">
                  <span className="text-6xl font-black text-slate-900 tracking-tighter">
                    {activeTab === 'supply'
                      ? (typeof supplySummaryAll.redundancyRatio === 'number'
                        ? `${(supplySummaryAll.redundancyRatio * 100).toFixed(1)}%`
                        : '—')
                      : activeTab === 'cloud' && useApi
                      ? (apiPayload?.summary?.value != null && apiPayload.summary.value !== ''
                        ? String(apiPayload.summary.value)
                        : '— min')
                      : mergedSummary.value}
                  </span>
                  {activeTab === 'cloud' && useApi && dataStatus.source === 'mock' && (
                    <button
                      type="button"
                      onClick={() => setRetryKey((k) => k + 1)}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 underline"
                    >
                      重试接口
                    </button>
                  )}
                  <div className="flex items-center text-emerald-500 text-xs font-bold">
                    <TrendingUp size={14} className="mr-1" />
                    {activeTab === 'supply'
                      ? `所有项目：供应 ${typeof supplySummaryAll.totalSupply === 'number' ? supplySummaryAll.totalSupply.toFixed(0) : '—'} / 订单 ${typeof supplySummaryAll.totalOrders === 'number' ? supplySummaryAll.totalOrders.toFixed(0) : '—'}`
                      : activeTab === 'cloud' && useApi
                      ? (apiPayload?.summary?.value != null && apiPayload.summary.value !== ''
                        ? '正常运行中'
                        : '示例数据')
                      : (dataStatus.source === 'api' ? '正常运行中' : '示例数据')}
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => {
                  if (activeTab === 'supply') return;
                  setMetricDrawer({
                    isOpen: true,
                    name: `全局历史趋势: ${mergedSummary.tabName}`,
                    data: mergedSummary.sevenDayTrend,
                    unit: activeTab === 'health' ? '%' : (activeTab === 'cloud' && apiPayload?.summary ? ' min' : 's'),
                    color: mergedSummary.color,
                    isSevenDays: true,
                  });
                }}
                className={`w-full md:w-[480px] h-32 bg-slate-50/80 rounded-2xl p-4 border border-slate-100 text-left transition-all cursor-pointer relative ${
                  activeTab === 'supply'
                    ? 'cursor-default hover:bg-slate-50/80 hover:border-slate-100'
                    : 'hover:bg-slate-100/50 hover:border-blue-200'
                }`}
              >
                  <div className="flex justify-between items-center mb-2 px-1">
                    <span className="text-[10px] font-bold text-slate-400 flex items-center">
                      <Calendar size={12} className="mr-1" />
                      {activeTab === 'supply'
                        ? '当前供应 vs 当前订单'
                        : activeTab === 'cloud'
                        ? timeRange === '24h'
                          ? '24小时实时趋势'
                          : timeRange === '7d'
                            ? '近 7 天趋势'
                            : '近 30 天趋势'
                        : '24小时实时趋势'}
                    </span>
                    <span className="text-[10px] text-blue-600 font-bold flex items-center opacity-0 group-hover/board:opacity-100 transition-opacity">
                      查看近7天 <ChevronRight size={12} className="ml-0.5" />
                    </span>
                  </div>
                  <div className="h-20">
                    {activeTab === 'supply' ? (
                      <div className="h-full flex items-center justify-between gap-4 px-2">
                        <div className="flex-1 bg-white/70 border border-slate-100 rounded-xl p-3">
                          <div className="text-[10px] font-bold text-slate-400">供应（当前）</div>
                          <div className="text-lg font-black text-slate-900 mt-0.5">
                            {typeof supplySummaryAll.totalSupply === 'number' ? supplySummaryAll.totalSupply.toFixed(0) : '—'}
                          </div>
                        </div>
                        <div className="flex-1 bg-white/70 border border-slate-100 rounded-xl p-3">
                          <div className="text-[10px] font-bold text-slate-400">订单（当前）</div>
                          <div className="text-lg font-black text-slate-900 mt-0.5">
                            {typeof supplySummaryAll.totalOrders === 'number' ? supplySummaryAll.totalOrders.toFixed(0) : '—'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <InteractiveChart
                        data={finalOverviewTrend}
                        color={mergedSummary.color}
                        height={80}
                        unit={activeTab === 'health' ? '%' : (activeTab === 'cloud' && apiPayload?.summary ? ' min' : 's')}
                      />
                    )}
                  </div>
              </button>
            </div>
          </div>

          {activeTab !== 'supply' ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b bg-slate-50/30 flex justify-between items-center">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{mergedSummary.tabName} - 任务流水线</span>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-[10px] text-slate-400 bg-white px-2 py-1 rounded font-bold border border-slate-100">
                    共 {filteredStages.length} 个监测阶段
                  </span>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredStages.map((stage, index) => (
                  <StageRow
                    key={stage.id}
                    index={index}
                    stage={stage}
                    timeRange={timeRange}
                    onMetricClick={(name, data, unit, color) => setMetricDrawer({ isOpen: true, name, data, unit, color, isSevenDays: false })}
                    onShowAllRooms={(s) => setRoomsDrawer({ isOpen: true, stage: s })}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b bg-slate-50/30 flex justify-between items-center">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">供应看板 - 路数对比</span>
                  {supplyLoading && (
                    <span className="text-[10px] font-black text-slate-400 inline-flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                      加载中
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-4">
                  <span className={`text-[10px] px-2 py-1 rounded font-bold border ${
                    (typeof supplySummaryAll.redundancy === 'number' ? supplySummaryAll.redundancy : 0) >= 0
                      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      : 'text-red-700 bg-red-50 border-red-200'
                  }`}>
                    所有项目冗余比率 {typeof supplySummaryAll.redundancyRatio === 'number' ? `${(supplySummaryAll.redundancyRatio * 100).toFixed(1)}%` : '—'}（供应/订单 {typeof supplySummaryAll.supplyToOrders === 'number' ? supplySummaryAll.supplyToOrders.toFixed(2) : '—'}）
                  </span>
                </div>
              </div>

              <div className="p-6 bg-white">
                {!supplyEverLoaded && supplyLoading ? (
                  <div className="w-full py-16 flex flex-col items-center justify-center text-slate-500">
                    <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-slate-600 animate-spin" />
                    <div className="mt-4 text-sm font-black text-slate-700">加载中…</div>
                    <div className="mt-1 text-[11px] text-slate-400 font-bold">
                      正在拉取供应（db=131）与订单（db=159）数据
                    </div>
                  </div>
                ) : (
                  <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-300 ${supplyLoading ? 'opacity-80' : 'opacity-100'}`}>
                    {Object.values(supplyByProject)
                      .filter((it) => mappedSupplyProjectIdSet.has(String(it.project).trim()))
                      .map((it) => (
                      <div
                        key={it.project}
                        className="border border-slate-200 rounded-2xl p-5 hover:shadow-sm transition-shadow"
                      >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-900 truncate">
                            {it.projectName ? it.projectName : it.project}
                            <span className="ml-2 text-[10px] font-black text-slate-400">({it.project})</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1 leading-tight">
                            {(it.project === '33' ? '当前卡数' : '当前路数')}{' '}
                            <span className="font-black text-slate-900">
                              {typeof it.currentRoutes === 'number' ? it.currentRoutes : '—'}
                            </span>
                            <span className="text-slate-300 mx-2">|</span>
                            当前订单{' '}
                            <span className="font-black text-slate-900">
                              {typeof it.ordersToday === 'number' ? it.ordersToday : '—'}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[10px] text-slate-400 font-bold">冗余</div>
                          <div className={`text-sm font-black ${it.redundancy >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {typeof it.redundancy === 'number'
                              ? `当前 ${it.redundancy >= 0 ? '+' : ''}${it.redundancy}`
                              : '—'}
                          </div>
                        </div>
                      </div>

                      {Array.isArray(it.seriesRedundancy7d) && it.seriesRedundancy7d.length > 0 ? (
                        <div className="mt-4 w-full bg-slate-50/60 rounded-xl p-3 border border-slate-100">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">近7天冗余率趋势（%）</span>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500 font-bold">
                              <button
                                type="button"
                                onClick={() => {
                                  setMetricDrawer({
                                    isOpen: true,
                                    name: `近7天冗余趋势: ${it.projectName ? it.projectName : it.project} (${it.project})`,
                                    data: Array.isArray(it.seriesRedundancy7d) ? it.seriesRedundancy7d : [],
                                    seriesList: null,
                                    unit: '%',
                                    color: '#10b981',
                                    isSevenDays: true,
                                  });
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-200 bg-white/70 text-slate-700 hover:bg-white hover:border-slate-300 transition-colors"
                              >
                                <ChevronRight size={12} className="mr-0.5" />
                                查看近7天
                              </button>
                            </div>
                          </div>
                          <div className="h-10">
                            <InteractiveChart
                              data={Array.isArray(it.seriesRedundancy7d) ? it.seriesRedundancy7d : []}
                              color="#10b981"
                              height={40}
                              unit="%"
                            />
                          </div>

                          {(() => {
                            const arr = Array.isArray(it.seriesRedundancy7d) ? it.seriesRedundancy7d : [];
                            if (!arr.length) return null;
                            const values = arr.map((d) => d.value);
                            const max = Math.max(...values);
                            const min = Math.min(...values);
                            const maxPoint = arr.find((d) => d.value === max) || null;
                            const minPoint = arr.find((d) => d.value === min) || null;
                            const current = values[values.length - 1];
                            const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
                            const valueTone = (v) => (v >= 0 ? 'text-emerald-600' : 'text-red-600');
                            return (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                                <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-500">
                                  当前 <span className={valueTone(current)}>{fmt(current)}</span>
                                </span>
                                <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-500">
                                  最高
                                  {maxPoint?.date ? <span className="text-slate-400">({maxPoint.date})</span> : null}{' '}
                                  <span className={valueTone(max)}>{fmt(max)}</span>
                                </span>
                                <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-500">
                                  最低
                                  {minPoint?.date ? <span className="text-slate-400">({minPoint.date})</span> : null}{' '}
                                  <span className={valueTone(min)}>{fmt(min)}</span>
                                </span>
                              </div>
                            );
                          })()}

                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center"
                              onClick={() => {
                                setExpandedSupplyTableByProject((prev) => ({
                                  ...prev,
                                  [it.project]: !prev[it.project],
                                }));
                              }}
                            >
                              {expandedSupplyTableByProject[it.project] ? '收起表格' : '展开表格'}
                              <ChevronRight size={12} className={expandedSupplyTableByProject[it.project] ? 'rotate-90 transition-transform' : ''} />
                            </button>
                          </div>

                          {expandedSupplyTableByProject[it.project] && (
                            <div className="mt-3 overflow-auto">
                              {(() => {
                                const dates = Array.from(
                                  new Set([
                                    ...(Array.isArray(it.seriesMax7d) ? it.seriesMax7d.map((d) => d.date) : []),
                                    ...(Array.isArray(it.seriesAvg7d) ? it.seriesAvg7d.map((d) => d.date) : []),
                                    ...(Array.isArray(it.seriesOrders7d) ? it.seriesOrders7d.map((d) => d.date) : []),
                                  ]),
                                ).sort((a, b) => a.localeCompare(b));

                                const mapArr = (arr) =>
                                  (Array.isArray(arr) ? arr.reduce((acc, cur) => {
                                    acc[cur.date] = cur.value;
                                    return acc;
                                  }, {}) : {});

                                const maxMap = mapArr(it.seriesMax7d);
                                const avgMap = mapArr(it.seriesAvg7d);
                                const ordersMap = mapArr(it.seriesOrders7d);

                                return (
                                  <table className="min-w-[320px] w-full text-left text-[10px] border border-slate-200 rounded-lg bg-white">
                                    <thead>
                                      <tr className="bg-slate-50">
                                        <th className="px-2 py-2 border-r border-slate-100">日期</th>
                                        <th className="px-2 py-2 border-r border-slate-100">
                                          供应最大（{unitLabelForProject(it.project)}）
                                        </th>
                                        <th className="px-2 py-2 border-r border-slate-100">
                                          供应平均（{unitLabelForProject(it.project)}）
                                        </th>
                                        <th className="px-2 py-2">订单（{unitLabelForProject(it.project)}）</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {dates.map((dt) => (
                                        <tr key={dt} className="border-t border-slate-100">
                                          <td className="px-2 py-2 border-r border-slate-100 font-bold text-slate-700">{dt}</td>
                                          <td className="px-2 py-2 border-r border-slate-100 text-slate-900">
                                            {typeof maxMap[dt] === 'number' ? maxMap[dt].toFixed(0) : '—'}
                                          </td>
                                          <td className="px-2 py-2 border-r border-slate-100 text-slate-900">
                                            {typeof avgMap[dt] === 'number' ? avgMap[dt].toFixed(0) : '—'}
                                          </td>
                                          <td className="px-2 py-2 text-slate-900">
                                            {typeof ordersMap[dt] === 'number' ? ordersMap[dt].toFixed(0) : '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-4 w-full h-14 bg-slate-50/60 rounded-xl p-3 border border-slate-100 flex items-center justify-center text-[11px] text-slate-400 font-bold">
                          近7天无趋势数据
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500 font-bold">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
                          当前供应（db=131）
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                          当前订单（db=159）
                        </span>
                      </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <MetricDetailDrawer 
        isOpen={metricDrawer.isOpen} 
        onClose={() => setMetricDrawer(prev => ({ ...prev, isOpen: false }))}
        metricName={metricDrawer.name}
        data={metricDrawer.data}
        seriesList={metricDrawer.seriesList}
        unit={metricDrawer.unit}
        color={metricDrawer.color}
        isSevenDays={metricDrawer.isSevenDays}
      />

      <DetailsDrawer 
        isOpen={roomsDrawer.isOpen} 
        onClose={() => setRoomsDrawer(prev => ({ ...prev, isOpen: false }))}
        stage={roomsDrawer.stage}
      />

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar-minimal::-webkit-scrollbar { height: 4px; }
        .custom-scrollbar-minimal::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}} />
    </div>
  );
}

