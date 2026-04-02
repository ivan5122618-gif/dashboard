import React from 'react';
import { X, Info } from 'lucide-react';
import InteractiveChart from '../charts/InteractiveChart.jsx';
import MultiSeriesChart from '../charts/MultiSeriesChart.jsx';

export default function MetricDetailDrawer({
  isOpen,
  onClose,
  metricName,
  data,
  seriesList,
  unit,
  color,
  isSevenDays = false,
}) {
  const hasMulti = Array.isArray(seriesList) && seriesList.length > 0;
  if (!hasMulti && !data) return null;
  const values = hasMulti
    ? seriesList.flatMap((s) => (Array.isArray(s?.data) ? s.data.map((d) => d.value) : []))
    : data.map((d) => d.value);
  const max = values.length ? Math.max(...values).toFixed(1) : '—';
  const min = values.length ? Math.min(...values).toFixed(1) : '—';
  const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : '—';

  return (
    <>
      <div
        className={`fixed inset-0 z-[70] bg-slate-900/30 backdrop-blur-[2px] transition-opacity ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`fixed right-0 top-0 z-[80] h-full w-[480px] transform border-l border-slate-200/60 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-xl transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex h-full flex-col font-sans">
          <div className="flex items-center justify-between border-b border-slate-100/80 p-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">{metricName}</h3>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {isSevenDays ? '近 7 天趋势分析' : '按小时统计趋势'} ({unit})
              </p>
            </div>
            <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-slate-50/30 p-6">
            <div className="mb-8 grid grid-cols-3 gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="mb-1 text-[10px] font-bold text-slate-400">峰值</div>
                <div className="text-lg font-black text-slate-800">
                  {max}
                  {unit}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="mb-1 text-[10px] font-bold text-slate-400">平均</div>
                <div className="text-lg font-black text-slate-800">
                  {avg}
                  {unit}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="mb-1 text-[10px] font-bold text-slate-400">谷值</div>
                <div className="text-lg font-black text-slate-800">
                  {min}
                  {unit}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="h-48 w-full">
                {hasMulti ? (
                  <MultiSeriesChart seriesList={seriesList} height={180} unit={unit} />
                ) : (
                  <InteractiveChart data={data} color={color} height={180} unit={unit} />
                )}
              </div>
              <div className="mt-4 flex justify-between text-[10px] font-bold uppercase text-slate-400">
                <span>{hasMulti ? seriesList?.[0]?.data?.[0]?.date || '' : data[0].date}</span>
                <span>
                  {hasMulti
                    ? seriesList?.[0]?.data?.[Math.floor((seriesList?.[0]?.data?.length || 1) / 2)]?.date || ''
                    : data[Math.floor(data.length / 2)].date}
                </span>
                <span>
                  {hasMulti
                    ? seriesList?.[0]?.data?.[(seriesList?.[0]?.data?.length || 1) - 1]?.date || ''
                    : data[data.length - 1].date}
                </span>
              </div>
            </div>

            {isSevenDays && (
              <div className="mt-8 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="mb-2 flex items-center text-xs font-bold text-blue-700">
                  <Info size={14} className="mr-2" /> 趋势解读
                </div>
                {hasMulti ? (
                  (() => {
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
                      Array.isArray(arr) && arr.length ? arr.reduce((s, d) => s + d.value, 0) / arr.length : null;
                    const peakSupply = maxOf(supplyMax);
                    const meanSupply = avgOf(supplyAvg);
                    const peakOrders = maxOf(orders);
                    const meanOrders = avgOf(orders);
                    const fmt = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(0) : '—');
                    const u = unit || '';
                    const risk =
                      typeof peakSupply === 'number' && typeof peakOrders === 'number'
                        ? peakSupply < peakOrders
                          ? '风险：订单峰值高于供应峰值，可能出现排队/缺口。'
                          : '供应峰值覆盖订单峰值，整体余量充足。'
                        : '当前数据不足，无法判断冗余风险。';

                    return (
                      <div className="space-y-1 text-[11px] leading-relaxed text-blue-600">
                        <div>
                          近7天供应峰值/均值：{fmt(peakSupply)}
                          {u} / {fmt(meanSupply)}
                          {u}；订单峰值/均值：{fmt(peakOrders)}
                          {u} / {fmt(meanOrders)}
                          {u}
                        </div>
                        <div>
                          最近一天：供应最大 {fmt(lastMax)}
                          {u}，供应平均 {fmt(lastAvg)}
                          {u}，订单 {fmt(lastOrders)}
                          {u}
                        </div>
                        <div className="font-bold">{risk}</div>
                      </div>
                    );
                  })()
                ) : (
                  <p className="text-[11px] leading-relaxed text-blue-600">
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
}
