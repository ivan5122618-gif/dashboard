import React, { useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Gamepad2,
} from 'lucide-react';
import InteractiveChart from '../charts/InteractiveChart.jsx';

export default function StageRow({ stage, index, onMetricClick, onShowAllRooms, timeRange }) {
  const isQueueStage = stage.id === 'queue-status';
  const isGameViewStage = stage.id === 'game-save-31-pc';
  const timeSeries =
    stage.timeTrendByRange && timeRange
      ? stage.timeTrendByRange[timeRange] || stage.timeTrend
      : stage.timeTrend;

  const riskyItems = useMemo(() => {
    const list = isGameViewStage ? stage.gameDetails : stage.rooms;
    if (!list) return [];
    return list.filter((r) => r.success < 90).sort((a, b) => a.success - b.success);
  }, [stage.rooms, stage.gameDetails, isGameViewStage]);

  const hasAnomaly = riskyItems.length > 0;

  return (
    <div className="group flex flex-col bg-white transition-colors hover:bg-slate-50/70 md:flex-row">
      <div className="flex shrink-0 flex-col justify-between border-slate-100/90 bg-slate-50/40 p-5 md:w-80 md:border-r">
        <div className="flex items-start space-x-3">
          <div className="relative">
            <div className="rounded-xl border border-slate-200/80 bg-white p-2.5 text-slate-600 shadow-sm transition-all group-hover:border-indigo-200 group-hover:text-indigo-600 group-hover:shadow-md">
              <stage.icon size={20} />
            </div>
            <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-slate-800 to-slate-950 text-[10px] font-black italic text-white shadow ring-1 ring-white">
              {String(index + 1).padStart(2, '0')}
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold leading-tight text-slate-900">{stage.name}</h3>
            <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-slate-400">{stage.note}</p>
          </div>
        </div>
        <div className={`mt-5 grid grid-cols-2 gap-2`}>
          <button
            onClick={() => onMetricClick(`${stage.name}-耗时`, timeSeries, 's', '#3b82f6')}
            className="rounded-lg border border-slate-200/70 bg-white p-2.5 text-left transition-all hover:border-indigo-300 hover:shadow-sm"
          >
            <div className="mb-0.5 text-[9px] font-bold text-slate-400">平均耗时</div>
            <div className="flex items-center justify-between text-xs font-black text-slate-800">
              {stage.avgTime}s <BarChart3 size={10} className="text-slate-300" />
            </div>
          </button>
          <button
            onClick={() => onMetricClick(`${stage.name}-成功率`, stage.successTrend, '%', '#10b981')}
            className="rounded-lg border border-slate-200/70 bg-white p-2.5 text-left transition-all hover:border-emerald-300 hover:shadow-sm"
          >
            <div className="mb-0.5 text-[9px] font-bold text-slate-400">成功率</div>
            <div className="flex items-center justify-between text-xs font-black">
              <span className={stage.successRate >= 90 ? 'text-emerald-600' : 'text-red-500'}>{stage.successRate}%</span>
              <BarChart3 size={10} className="text-slate-300" />
            </div>
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center bg-white/80 p-5">
        {isQueueStage ? (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center text-[10px] font-black uppercase tracking-wider text-indigo-600">
                <TrendingUp size={12} className="mr-1.5" />
                排队人数趋势 (24小时)
              </span>
              <button
                onClick={() => onShowAllRooms(stage)}
                className="flex items-center text-[11px] font-bold text-indigo-600 hover:text-indigo-700"
              >
                详情分布 <ChevronRight size={14} />
              </button>
            </div>
            <div className="relative flex flex-1 items-end overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <div className="relative z-10 h-24 w-full">
                <InteractiveChart data={stage.queueTrend} color="#3b82f6" height={100} showArea={true} unit="人" />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${hasAnomaly ? 'flex items-center text-red-600' : 'text-slate-300'}`}
                >
                  {hasAnomaly && <AlertTriangle size={12} className="mr-1.5 animate-pulse" />}
                  {hasAnomaly ? `${isGameViewStage ? '异常游戏' : '异常机房'}分布 (24h 波动)` : `系统监控状态`}
                </span>
                {!hasAnomaly && <CheckCircle2 size={12} className="text-emerald-500" />}
              </div>
              <button
                onClick={() => onShowAllRooms(stage)}
                className="flex items-center text-[11px] font-bold text-indigo-600 transition-colors hover:text-indigo-700"
              >
                查看详情 <ChevronRight size={14} className="ml-0.5" />
              </button>
            </div>

            <div className="custom-scrollbar-minimal flex min-h-[80px] space-x-3 overflow-x-auto pb-2">
              {hasAnomaly ? (
                riskyItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`relative w-48 shrink-0 rounded-xl border bg-red-50/30 p-3 shadow-sm transition-all ${idx === 0 ? 'border-red-500 ring-2 ring-red-500/10' : 'border-red-200 hover:border-red-400'}`}
                  >
                    <div className="mb-1 flex items-center justify-between truncate text-[11px] font-bold text-slate-800">
                      <span className="flex items-center">
                        {isGameViewStage && <Gamepad2 size={12} className="mr-1.5 text-slate-400" />}
                        {item.name}
                      </span>
                      <span className="rounded bg-red-500 px-1 text-[9px] uppercase text-white">异常</span>
                    </div>
                    <div className="mb-1 h-10 w-full">
                      <InteractiveChart data={item.successTrend} color="#ef4444" height={40} unit="%" />
                    </div>
                    <div className="flex w-full justify-between text-[9px]">
                      <span className="text-slate-400">实时成功率:</span>
                      <span className="font-black text-red-600">{item.success}%</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex w-full flex-col items-center justify-center rounded-2xl border border-emerald-100/50 bg-emerald-50/20 py-4 transition-all">
                  <div className="flex items-center space-x-3">
                    <div className="rounded-full bg-emerald-100 p-2 text-emerald-600">
                      <ShieldCheck size={18} />
                    </div>
                    <span className="text-sm font-bold tracking-tight text-emerald-700">24小时内所有检测点位表现正常</span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
