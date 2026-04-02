import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'ResourceDashboard.jsx');
const dest = path.join(root, 'src', 'pages', 'ResourceDashboard.jsx');

let s = fs.readFileSync(src, 'utf8');
const marker = 'export default function ResourceDashboard()';
const i = s.indexOf(marker);
if (i < 0) throw new Error('Marker not found');

const header = `import React, { useState, useMemo, useEffect } from 'react';
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

`;

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, header + s.slice(i), 'utf8');
console.log('Wrote', dest);
