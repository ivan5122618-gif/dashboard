import React from 'react';
import { X } from 'lucide-react';
import InteractiveChart from '../charts/InteractiveChart.jsx';

export default function DetailsDrawer({ isOpen, onClose, stage }) {
  if (!stage || (!stage.rooms && !stage.gameDetails)) return null;
  const isGameView = stage.id === 'game-save-31-pc';
  const list = isGameView ? stage.gameDetails : stage.rooms;

  return (
    <>
      <div
        className={`fixed inset-0 z-[55] bg-slate-900/30 backdrop-blur-[2px] transition-opacity ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 z-[60] h-full w-[540px] transform border-l border-slate-200/60 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-xl transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex h-full flex-col font-sans text-slate-700">
          <div className="flex items-center justify-between border-b border-slate-100/80 px-6 py-5">
            <div>
              <h2 className="flex items-center text-base font-bold text-slate-900">
                <stage.icon size={18} className="mr-3 text-indigo-600" />
                {stage.name} - {isGameView ? '游戏维度统计' : '机房分组统计'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">统计周期：24小时趋势 (异常判定阈值: 90%)</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-auto bg-slate-50/50 p-6">
            {list.map((item) => (
              <div
                key={item.id}
                className={`flex flex-col rounded-xl border bg-white p-4 transition-shadow hover:shadow-md ${item.success < 90 ? 'border-red-200 bg-red-50/20' : 'border-slate-200'}`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`h-2 w-2 rounded-full ${item.success >= 90 ? 'bg-emerald-500' : 'animate-pulse bg-red-500'}`} />
                    <span className="text-sm font-bold text-slate-800">{item.name}</span>
                    {item.success < 90 && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-black text-red-600">异常</span>
                    )}
                  </div>
                  <div className="flex space-x-4 text-right">
                    <div className="text-[10px]">
                      <span className="text-slate-400">平均耗时:</span>{' '}
                      <span className="font-bold">{Math.round(item.time)}s</span>
                    </div>
                    <div className="text-[10px]">
                      <span className="text-slate-400">成功率:</span>{' '}
                      <span className={`font-bold ${item.success >= 90 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {item.success}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-1 h-10 w-full">
                  <InteractiveChart
                    data={item.successTrend}
                    color={item.success >= 90 ? '#10b981' : '#ef4444'}
                    height={40}
                    unit="%"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
