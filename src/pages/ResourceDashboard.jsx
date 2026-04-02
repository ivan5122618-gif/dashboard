import React, { useState, useMemo, useEffect } from 'react';
import {
  Server, Network, Save, MonitorPlay, Zap, HardDrive,
  Smartphone, Share2,
  Users, ShieldCheck, LayoutPanelTop,
  ChevronRight, Filter,
  Workflow, Cpu, RotateCcw, Box, Layers3,
  Calendar, TrendingUp,
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
} from '../api/dashboardApi.js';
import { getAllMappedProjectIds, projectIdsFromSettlementId } from '../utils/settlementToProject.js';
import {
  projectList,
  generateTrendData,
  generateRooms,
  generateGameDetails,
  makeEmptySupplyByProject,
} from '../utils/mockData.js';
import { unitLabelForProject } from '../utils/supplyLabels.js';
import InteractiveChart from '../components/charts/InteractiveChart.jsx';
import StageRow from '../components/dashboard/StageRow.jsx';
import DetailsDrawer from '../components/dashboard/DetailsDrawer.jsx';
import MetricDetailDrawer from '../components/dashboard/MetricDetailDrawer.jsx';

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
    // 与 dist_bak 一致：调度 Tab 不拉 summary（仍用本地模拟流水线）
    if (activeTab === 'scheduling') {
      setRemoteByTab((prev) => ({ ...prev, scheduling: { summary: null, stages: null } }));
      setDataStatus({ loading: false, error: null, source: 'api' });
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
          if (activeTab === 'cloud' || activeTab === 'health') {
            console.error('[资源观测] Metabase summary 请求失败:', err);
          }
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
      : (Array.isArray(projectOptions) ? projectOptions : []).map((p) =>
          typeof p === 'object' && p !== null && 'id' in p
            ? { id: String(p.id), label: String(p.label ?? p.id) }
            : { id: String(p), label: String(p) },
        );

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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden text-slate-800">
      <header className="z-40 flex shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/80 px-5 py-3 backdrop-blur-md sm:px-8 sm:py-4">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 p-2.5 text-white shadow-lg shadow-slate-900/25 ring-1 ring-white/15">
            <LayoutPanelTop size={20} strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-slate-900">资源全链路观测</h1>
            <p className="mt-2 flex items-center text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              实时监测已开启
            </p>
          </div>
        </div>
        <nav className="flex gap-0.5 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 shadow-inner">
          {[
            { id: 'cloud', label: '游戏云化任务' },
            { id: 'scheduling', label: '调度与体验' },
            { id: 'health', label: '实例任务' },
            { id: 'supply', label: '供应看板' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-5 py-2 text-xs font-semibold transition-all duration-200 sm:px-7 ${
                activeTab === tab.id
                  ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200/70'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-auto p-5 pt-5 sm:p-8 sm:pt-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/85 px-5 py-3.5 shadow-card backdrop-blur-sm">
            <div className="flex items-center text-[11px] text-slate-600">
              <Filter size={14} className="mr-2 text-indigo-400" />
              <span className="font-bold text-slate-800">项目筛选</span>
              {selectedProjects.length > 0 && (
                <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-100">
                  已选 {selectedProjects.length} 个
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSelectedProjects([])}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  selectedProjects.length === 0
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-600/25'
                    : 'border-slate-200/90 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/60'
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
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                      active
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-800 shadow-sm ring-1 ring-indigo-100/80'
                        : 'border-slate-200/90 bg-white text-slate-600 hover:border-indigo-200 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}

              {activeTab === 'cloud' && (
                <div className="ml-2 flex items-center gap-1 border-l border-slate-200/80 pl-3">
                  <span className="text-[10px] font-medium text-slate-400">时间维度</span>
                  {[
                    { id: '24h', label: '24小时' },
                    { id: '7d', label: '近7天' },
                    { id: '30d', label: '近30天' },
                  ].map(range => (
                    <button
                      key={range.id}
                      onClick={() => setTimeRange(range.id)}
                      className={`rounded-full border px-2 py-1 text-[10px] font-semibold transition-all ${
                        timeRange === range.id
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-800 shadow-sm ring-1 ring-emerald-100'
                          : 'border-slate-200/90 bg-white text-slate-600 hover:border-emerald-200'
                      }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="group/board relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-7 shadow-card backdrop-blur-sm">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-indigo-400/20 via-violet-400/10 to-emerald-400/15 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-indigo-200/50 to-transparent" />
            <div className="relative flex flex-col items-center justify-between gap-8 md:flex-row">
              <div className="flex-1">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-600">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                    <mergedSummary.icon size={14} strokeWidth={2.25} />
                  </span>
                  <span>{mergedSummary.tabName}</span>
                </div>
                <div className="mb-1 text-sm font-bold text-slate-500">{mergedSummary.label}</div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-5xl font-black tracking-tighter text-slate-900 sm:text-6xl">
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
                      className="text-xs font-bold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-700"
                    >
                      重试接口
                    </button>
                  )}
                  <div className="flex items-center text-xs font-bold text-emerald-600">
                    <TrendingUp size={14} className="mr-1 shrink-0" strokeWidth={2.25} />
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
                className={`relative h-32 w-full cursor-pointer rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50/95 to-white p-4 text-left shadow-inner transition-all md:w-[480px] ${
                  activeTab === 'supply'
                    ? 'cursor-default hover:border-slate-200/80 hover:from-slate-50 hover:to-white'
                    : 'hover:border-indigo-200/80 hover:shadow-md hover:shadow-indigo-500/5'
                }`}
              >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="flex items-center text-[10px] font-bold text-slate-500">
                      <Calendar size={12} className="mr-1 text-indigo-400" />
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
                    <span className="flex items-center text-[10px] font-bold text-indigo-600 opacity-0 transition-opacity group-hover/board:opacity-100">
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
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-card backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-slate-100/90 bg-gradient-to-r from-slate-50/90 via-white to-indigo-50/30 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                  <span className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
                    {mergedSummary.tabName} - 任务流水线
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="rounded-lg border border-slate-200/80 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 shadow-sm">
                    共 {filteredStages.length} 个监测阶段
                  </span>
                </div>
              </div>
              <div className="divide-y divide-slate-100/90">
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
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-card backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-slate-100/90 bg-gradient-to-r from-slate-50/90 via-white to-sky-50/40 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.45)]" />
                  <span className="text-xs font-extrabold uppercase tracking-widest text-slate-500">供应看板 - 路数对比</span>
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

    </div>
  );
}

