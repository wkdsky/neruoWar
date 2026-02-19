/**
 * KnowledgeDomainScene - 知识域3D俯视角场景
 * 显示：承口+道路（上方）、圆形地面（中间）、启口+道路（下方）
 */

import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';
import defaultMale1 from '../../assets/avatars/default_male_1.svg';
import defaultMale2 from '../../assets/avatars/default_male_2.svg';
import defaultMale3 from '../../assets/avatars/default_male_3.svg';
import defaultFemale1 from '../../assets/avatars/default_female_1.svg';
import defaultFemale2 from '../../assets/avatars/default_female_2.svg';
import defaultFemale3 from '../../assets/avatars/default_female_3.svg';
import NumberPadDialog from '../common/NumberPadDialog';
import './KnowledgeDomainScene.css';

const avatarMap = {
  male1: defaultMale1,
  male2: defaultMale2,
  male3: defaultMale3,
  female1: defaultFemale1,
  female2: defaultFemale2,
  female3: defaultFemale3
};

const DISTRIBUTION_SCOPE_OPTIONS = [
  { value: 'all', label: '全部分发（100%）' },
  { value: 'partial', label: '部分分发（按比例）' }
];

const clampPercent = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

const createDefaultDistributionRule = () => ({
  enabled: false,
  distributionScope: 'all',
  distributionPercent: 100,
  masterPercent: 10,
  adminPercents: [],
  customUserPercents: [],
  nonHostileAlliancePercent: 0,
  specificAlliancePercents: [],
  noAlliancePercent: 0,
  blacklistUsers: [],
  blacklistAlliances: []
});

const createDistributionRuleProfileId = () => (
  `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
);

const mapDistributionRuleFromApi = (rawRule = {}) => ({
  enabled: !!rawRule.enabled,
  distributionScope: rawRule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: clampPercent(rawRule?.distributionPercent, 100),
  masterPercent: clampPercent(rawRule.masterPercent, 10),
  adminPercents: Array.isArray(rawRule.adminPercents)
    ? rawRule.adminPercents.map((item) => ({
        userId: item.userId,
        username: item.username || '',
        percent: clampPercent(item.percent, 0)
      })).filter((item) => item.userId)
    : [],
  customUserPercents: Array.isArray(rawRule.customUserPercents)
    ? rawRule.customUserPercents.map((item) => ({
        userId: item.userId,
        username: item.username || '',
        percent: clampPercent(item.percent, 0)
      })).filter((item) => item.userId)
    : [],
  nonHostileAlliancePercent: clampPercent(rawRule.nonHostileAlliancePercent, 0),
  specificAlliancePercents: Array.isArray(rawRule.specificAlliancePercents)
    ? rawRule.specificAlliancePercents.map((item) => ({
        allianceId: item.allianceId,
        allianceName: item.allianceName || '',
        percent: clampPercent(item.percent, 0)
      })).filter((item) => item.allianceId)
    : [],
  noAlliancePercent: clampPercent(rawRule.noAlliancePercent, 0),
  blacklistUsers: Array.isArray(rawRule.blacklistUsers)
    ? rawRule.blacklistUsers.map((item) => ({
        userId: item.userId || item._id || '',
        username: item.username || ''
      })).filter((item) => item.userId)
    : [],
  blacklistAlliances: Array.isArray(rawRule.blacklistAlliances)
    ? rawRule.blacklistAlliances.map((item) => ({
        allianceId: item.allianceId || item._id || '',
        allianceName: item.allianceName || ''
      })).filter((item) => item.allianceId)
    : []
});

const mapDistributionRuleProfileFromApi = (rawProfile = {}, index = 0) => {
  const fallbackRule = mapDistributionRuleFromApi(rawProfile?.rule || rawProfile);
  return {
    profileId: typeof rawProfile.profileId === 'string' && rawProfile.profileId.trim()
      ? rawProfile.profileId.trim()
      : `rule_${index + 1}`,
    name: typeof rawProfile.name === 'string' && rawProfile.name.trim()
      ? rawProfile.name.trim()
      : `规则${index + 1}`,
    enabled: !!rawProfile.enabled,
    rule: fallbackRule,
    percentSummary: rawProfile.percentSummary || null
  };
};

const createDistributionRuleProfile = (profileId = 'default', name = '默认规则', rawRule = null) => ({
  profileId,
  name,
  enabled: true,
  rule: rawRule ? mapDistributionRuleFromApi(rawRule) : createDefaultDistributionRule(),
  percentSummary: null
});

const buildDistributionRulePayload = (rule = {}) => ({
  enabled: false,
  distributionScope: rule?.distributionScope === 'partial' ? 'partial' : 'all',
  distributionPercent: clampPercent(rule?.distributionPercent, 100),
  masterPercent: clampPercent(rule.masterPercent, 10),
  adminPercents: (rule.adminPercents || [])
    .filter((item) => item.userId && clampPercent(item.percent, 0) > 0)
    .map((item) => ({ userId: item.userId, percent: clampPercent(item.percent, 0) })),
  customUserPercents: (rule.customUserPercents || [])
    .filter((item) => item.userId && clampPercent(item.percent, 0) > 0)
    .map((item) => ({ userId: item.userId, percent: clampPercent(item.percent, 0) })),
  nonHostileAlliancePercent: clampPercent(rule.nonHostileAlliancePercent, 0),
  specificAlliancePercents: (rule.specificAlliancePercents || [])
    .filter((item) => item.allianceId && clampPercent(item.percent, 0) > 0)
    .map((item) => ({ allianceId: item.allianceId, percent: clampPercent(item.percent, 0) })),
  noAlliancePercent: clampPercent(rule.noAlliancePercent, 0),
  blacklistUserIds: (rule.blacklistUsers || []).map((item) => item.userId).filter(Boolean),
  blacklistAllianceIds: (rule.blacklistAlliances || []).map((item) => item.allianceId).filter(Boolean)
});

const createDefaultDistributionState = () => ({
  loading: false,
  saving: false,
  publishing: false,
  error: '',
  feedback: '',
  canView: false,
  canEdit: false,
  isRuleLocked: false,
  percentSummary: { x: 0, y: 0, z: 0, b: 0, d: 0, e: 0, f: 0, total: 0 },
  allianceContributionPercent: 0,
  masterAllianceName: '',
  carryoverValue: 0,
  knowledgePointValue: 0,
  lastSyncedAt: Date.now(),
  locked: null,
  publishRuleId: 'default',
  publishExecuteAt: '',
  activeRuleId: 'default',
  ruleProfiles: [createDistributionRuleProfile('default', '默认规则')]
});

const computePercentSummary = (rule, allianceContributionPercent) => {
  const x = clampPercent(rule?.masterPercent, 10);
  const y = (rule?.adminPercents || []).reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const z = clampPercent(allianceContributionPercent, 0);
  const b = (rule?.customUserPercents || []).reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const d = clampPercent(rule?.nonHostileAlliancePercent, 0);
  const e = (rule?.specificAlliancePercents || []).reduce((sum, item) => sum + clampPercent(item?.percent, 0), 0);
  const f = clampPercent(rule?.noAlliancePercent, 0);
  const total = x + y + z + b + d + e + f;
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    z: Number(z.toFixed(2)),
    b: Number(b.toFixed(2)),
    d: Number(d.toFixed(2)),
    e: Number(e.toFixed(2)),
    f: Number(f.toFixed(2)),
    total: Number(total.toFixed(2))
  };
};

const getDistributionScopePercent = (rule = {}) => (
  rule?.distributionScope === 'partial' ? clampPercent(rule?.distributionPercent, 100) : 100
);

const toHourInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:00`;
};

const getDefaultPublishExecuteAtInput = () => {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toHourInputValue(date);
};

const parseHourInputToDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (date.getMinutes() !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0) return null;
  return date;
};

const formatCountdown = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const day = Math.floor(total / 86400);
  const hour = Math.floor((total % 86400) / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  if (day > 0) {
    return `${day}天 ${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}:${ss}`;
};

const CITY_BUILDING_LIMIT = 3;
const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
const CITY_BUILDING_MIN_DISTANCE = 0.34;
const CITY_BUILDING_MAX_DISTANCE = 0.86;
const CITY_CAMERA_DEFAULT_ANGLE_DEG = 45;
const CITY_CAMERA_BUILD_ANGLE_DEG = 90;
const CITY_CAMERA_TRANSITION_MS = 460;
const CITY_GATE_KEYS = ['cheng', 'qi'];
const INTEL_HEIST_SCAN_MS = 8000;
const INTEL_HEIST_TIMEOUT_BUFFER_MS = INTEL_HEIST_SCAN_MS*2/3;
const CITY_GATE_LABELS = {
  cheng: '承口',
  qi: '启口'
};
const CITY_GATE_TOOLTIPS = {
  cheng: '通往上一级知识域',
  qi: '通往下一级知识域'
};
const CITY_BUILDING_CANDIDATE_POSITIONS = [
  { x: -0.46, y: -0.12 },
  { x: 0.46, y: -0.12 },
  { x: -0.34, y: 0.36 },
  { x: 0.34, y: 0.36 },
  { x: 0, y: -0.42 },
  { x: 0, y: 0.42 }
];

const cloneDefenseLayout = (layout = {}) => ({
  buildings: Array.isArray(layout.buildings) ? layout.buildings.map((item) => ({ ...item })) : [],
  intelBuildingId: typeof layout.intelBuildingId === 'string' ? layout.intelBuildingId : '',
  gateDefense: CITY_GATE_KEYS.reduce((acc, key) => {
    const sourceEntries = Array.isArray(layout?.gateDefense?.[key]) ? layout.gateDefense[key] : [];
    acc[key] = sourceEntries.map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    })).filter((entry) => entry.unitTypeId && entry.count > 0);
    return acc;
  }, { cheng: [], qi: [] }),
  gateDefenseViewAdminIds: Array.isArray(layout.gateDefenseViewAdminIds)
    ? Array.from(new Set(layout.gateDefenseViewAdminIds.filter((id) => typeof id === 'string' && id)))
    : []
});

const createDefaultDefenseLayout = () => ({
  buildings: [{
    buildingId: 'core',
    name: '建筑1',
    x: 0,
    y: 0,
    radius: CITY_BUILDING_DEFAULT_RADIUS,
    level: 1,
    nextUnitTypeId: '',
    upgradeCostKP: null
  }],
  intelBuildingId: 'core',
  gateDefense: {
    cheng: [],
    qi: []
  },
  gateDefenseViewAdminIds: []
});

const normalizeDefenseLayoutFromApi = (rawLayout = {}) => {
  const source = rawLayout && typeof rawLayout === 'object' ? rawLayout : {};
  const sourceBuildings = Array.isArray(source.buildings) ? source.buildings : [];
  const normalizedBuildings = [];
  const seen = new Set();
  for (let index = 0; index < sourceBuildings.length; index += 1) {
    const item = sourceBuildings[index] || {};
    const rawId = typeof item.buildingId === 'string' ? item.buildingId.trim() : '';
    const buildingId = rawId || `building_${index + 1}`;
    if (!buildingId || seen.has(buildingId)) continue;
    seen.add(buildingId);
    const parsedX = Number(item.x);
    const parsedY = Number(item.y);
    const parsedRadius = Number(item.radius);
    const parsedName = typeof item.name === 'string' ? item.name.trim() : '';
    normalizedBuildings.push({
      buildingId,
      name: parsedName || `建筑${normalizedBuildings.length + 1}`,
      x: Number.isFinite(parsedX) ? Math.max(-1, Math.min(1, parsedX)) : 0,
      y: Number.isFinite(parsedY) ? Math.max(-1, Math.min(1, parsedY)) : 0,
      radius: Number.isFinite(parsedRadius) ? Math.max(0.1, Math.min(0.24, parsedRadius)) : CITY_BUILDING_DEFAULT_RADIUS,
      level: Math.max(1, parseInt(item.level, 10) || 1),
      nextUnitTypeId: typeof item.nextUnitTypeId === 'string' ? item.nextUnitTypeId : '',
      upgradeCostKP: Number.isFinite(Number(item.upgradeCostKP)) ? Number(item.upgradeCostKP) : null
    });
    if (normalizedBuildings.length >= CITY_BUILDING_LIMIT) break;
  }
  if (normalizedBuildings.length === 0) {
    return createDefaultDefenseLayout();
  }
  const sourceIntelBuildingId = typeof source.intelBuildingId === 'string' ? source.intelBuildingId.trim() : '';
  const intelBuildingId = normalizedBuildings.some((item) => item.buildingId === sourceIntelBuildingId)
    ? sourceIntelBuildingId
    : normalizedBuildings[0].buildingId;
  const sourceGateDefense = source.gateDefense && typeof source.gateDefense === 'object'
    ? source.gateDefense
    : {};
  const normalizeGateEntries = (entries = []) => {
    const out = [];
    const seen = new Set();
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0) continue;
      if (seen.has(unitTypeId)) continue;
      seen.add(unitTypeId);
      out.push({ unitTypeId, count });
    }
    return out;
  };
  const gateDefense = CITY_GATE_KEYS.reduce((acc, key) => {
    acc[key] = normalizeGateEntries(sourceGateDefense[key]);
    return acc;
  }, { cheng: [], qi: [] });
  const gateDefenseViewAdminIds = Array.isArray(source.gateDefenseViewAdminIds)
    ? Array.from(new Set(source.gateDefenseViewAdminIds
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => !!item)))
    : [];
  return {
    buildings: normalizedBuildings,
    intelBuildingId,
    gateDefense,
    gateDefenseViewAdminIds
  };
};

const createDefaultDefenseLayoutState = () => ({
  loading: false,
  saving: false,
  error: '',
  feedback: '',
  canEdit: false,
  canViewGateDefense: false,
  maxBuildings: CITY_BUILDING_LIMIT,
  minBuildings: 1,
  buildMode: false,
  isDirty: false,
  selectedBuildingId: '',
  draggingBuildingId: '',
  savedLayout: createDefaultDefenseLayout(),
  draftLayout: createDefaultDefenseLayout()
});

const calcDistance = (a, b) => Math.sqrt(((a.x - b.x) ** 2) + ((a.y - b.y) ** 2));

const clampPositionInsideCity = (position = { x: 0, y: 0 }) => {
  const length = Math.sqrt((position.x ** 2) + (position.y ** 2));
  if (length <= CITY_BUILDING_MAX_DISTANCE) return position;
  const ratio = CITY_BUILDING_MAX_DISTANCE / (length || 1);
  return {
    x: position.x * ratio,
    y: position.y * ratio
  };
};

const isValidPlacement = (position, buildings, buildingId) => {
  const distanceToCenter = Math.sqrt((position.x ** 2) + (position.y ** 2));
  if (distanceToCenter > CITY_BUILDING_MAX_DISTANCE) return false;
  return buildings.every((item) => {
    if (item.buildingId === buildingId) return true;
    return calcDistance(position, item) >= CITY_BUILDING_MIN_DISTANCE;
  });
};

const clampCityCameraAngle = (angleDeg) => {
  const parsed = Number(angleDeg);
  if (!Number.isFinite(parsed)) return CITY_CAMERA_DEFAULT_ANGLE_DEG;
  return Math.max(CITY_CAMERA_DEFAULT_ANGLE_DEG, Math.min(CITY_CAMERA_BUILD_ANGLE_DEG, parsed));
};

const getCityCameraTiltBlend = (angleDeg) => {
  const normalizedAngle = clampCityCameraAngle(angleDeg);
  return (normalizedAngle - CITY_CAMERA_DEFAULT_ANGLE_DEG) / (CITY_CAMERA_BUILD_ANGLE_DEG - CITY_CAMERA_DEFAULT_ANGLE_DEG);
};

const getCityMetrics = (width, height, angleDeg = CITY_CAMERA_DEFAULT_ANGLE_DEG) => {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const tiltBlend = getCityCameraTiltBlend(angleDeg);
  const radiusX = safeWidth * 0.35;
  const radiusY45 = safeHeight * 0.25;
  const radiusY90 = Math.min(safeHeight * 0.35, radiusX);
  const radiusY = radiusY45 + ((radiusY90 - radiusY45) * tiltBlend);
  return {
    centerX: safeWidth / 2,
    centerY: safeHeight / 2,
    radiusX,
    radiusY,
    tiltBlend,
    angleDeg: clampCityCameraAngle(angleDeg)
  };
};

const clampScenePanOffset = (offset = { x: 0, y: 0 }, width = 0, height = 0) => {
  const maxX = Math.max(0, (Number(width) || 0) * 0.28);
  const maxY = Math.max(0, (Number(height) || 0) * 0.2);
  return {
    x: Math.max(-maxX, Math.min(maxX, Number(offset.x) || 0)),
    y: Math.max(-maxY, Math.min(maxY, Number(offset.y) || 0))
  };
};

const defenseLayoutToPayload = (layout = {}) => ({
  buildings: (layout.buildings || []).map((item) => ({
    buildingId: item.buildingId,
    name: (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : '',
    x: Number(Number(item.x).toFixed(3)),
    y: Number(Number(item.y).toFixed(3)),
    radius: Number(Number(item.radius || CITY_BUILDING_DEFAULT_RADIUS).toFixed(3)),
    level: Number(item.level || 1),
    nextUnitTypeId: item.nextUnitTypeId || '',
    upgradeCostKP: Number.isFinite(Number(item.upgradeCostKP)) ? Number(item.upgradeCostKP) : null
  })),
  intelBuildingId: layout.intelBuildingId || '',
  gateDefense: CITY_GATE_KEYS.reduce((acc, key) => {
    const sourceEntries = Array.isArray(layout?.gateDefense?.[key]) ? layout.gateDefense[key] : [];
    acc[key] = sourceEntries
      .map((entry) => ({
        unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
        count: Math.max(0, Math.floor(Number(entry?.count) || 0))
      }))
      .filter((entry) => entry.unitTypeId && entry.count > 0);
    return acc;
  }, { cheng: [], qi: [] }),
  gateDefenseViewAdminIds: Array.isArray(layout?.gateDefenseViewAdminIds)
    ? Array.from(new Set(layout.gateDefenseViewAdminIds
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => !!item)))
    : []
});

const getUserId = (user) => {
  if (!user) return '';
  if (typeof user === 'string') return user;
  if (typeof user === 'object') {
    if (typeof user._id === 'string') return user._id;
    if (typeof user.id === 'string') return user.id;
  }
  return '';
};

const normalizeDomainManagerUser = (user) => {
  if (!user || typeof user !== 'object') return null;
  const userId = getUserId(user);
  if (!userId) return null;
  return {
    _id: userId,
    username: user.username || '',
    profession: user.profession || '',
    avatar: user.avatar || ''
  };
};

const getGateDefenseEntries = (layout = {}, gateKey) => {
  const sourceEntries = Array.isArray(layout?.gateDefense?.[gateKey]) ? layout.gateDefense[gateKey] : [];
  return sourceEntries
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0);
};

const getGateDefenseTotal = (layout = {}, gateKey) => (
  getGateDefenseEntries(layout, gateKey).reduce((sum, entry) => sum + entry.count, 0)
);

const formatElapsedMinutesText = (value) => {
  const timeMs = new Date(value || 0).getTime();
  if (!Number.isFinite(timeMs) || timeMs <= 0) return '未知时刻';
  const minutes = Math.max(0, Math.floor((Date.now() - timeMs) / 60000));
  return `${minutes}分钟前`;
};

const getDeployedCountByUnitType = (layout = {}) => {
  const counter = new Map();
  CITY_GATE_KEYS.forEach((gateKey) => {
    getGateDefenseEntries(layout, gateKey).forEach((entry) => {
      counter.set(entry.unitTypeId, (counter.get(entry.unitTypeId) || 0) + entry.count);
    });
  });
  return counter;
};

// 3D场景渲染器
class KnowledgeDomainRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.animationId = null;
    this.time = 0;
    this.viewOffset = { x: 0, y: 0 };
    this.cameraAngleDeg = CITY_CAMERA_DEFAULT_ANGLE_DEG;
    this.gateVisibility = {
      cheng: true,
      qi: true
    };

    // 场景参数
    this.groundColor = '#1a1f35';
    this.roadColor = '#2d3555';
    this.roadBorderColor = '#4a5580';
    this.centerColor = '#252b45';
    this.glowColor = 'rgba(168, 85, 247, 0.3)';

    // 动画状态
    this.particles = [];
    this.initParticles();
  }

  initParticles() {
    // 创建环境粒子
    for (let i = 0; i < 50; i++) {
      this.particles.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 0.5,
        speed: 0.0005 + Math.random() * 0.001,
        size: 1 + Math.random() * 2,
        alpha: 0.3 + Math.random() * 0.5
      });
    }
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setViewOffset(offsetX = 0, offsetY = 0) {
    this.viewOffset = {
      x: Number.isFinite(Number(offsetX)) ? Number(offsetX) : 0,
      y: Number.isFinite(Number(offsetY)) ? Number(offsetY) : 0
    };
  }

  setCameraAngle(angleDeg = CITY_CAMERA_DEFAULT_ANGLE_DEG) {
    this.cameraAngleDeg = clampCityCameraAngle(angleDeg);
  }

  setGateVisibility(visibility = {}) {
    this.gateVisibility = {
      cheng: visibility?.cheng !== false,
      qi: visibility?.qi !== false
    };
  }

  getSceneMetrics() {
    return getCityMetrics(this.canvas.width, this.canvas.height, this.cameraAngleDeg);
  }

  // 3D到2D投影（俯视角45度）
  project(x, y, z) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // 等距投影
    const scale = Math.min(width, height) * 0.4;
    const projX = centerX + (x - y * 0.5) * scale;
    const projY = centerY + (x * 0.3 + y * 0.5 - z) * scale;

    return { x: projX, y: projY };
  }

  // 绘制椭圆形地面（俯视角看起来的圆）
  drawGround() {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const { radiusX, radiusY } = metrics;

    // 绘制外层发光
    const gradient = ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, radiusX
    );
    gradient.addColorStop(0, 'rgba(168, 85, 247, 0.15)');
    gradient.addColorStop(0.7, 'rgba(168, 85, 247, 0.05)');
    gradient.addColorStop(1, 'transparent');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 1.3, radiusY * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 绘制主地面
    ctx.fillStyle = this.centerColor;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    // 绘制边框
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 绘制内圈装饰
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 0.8, radiusY * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX * 0.5, radiusY * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 绘制道路（上下口）
  drawRoad(gateKey) {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const isTop = gateKey === 'cheng';
    const showRoad = isTop ? this.gateVisibility.cheng : this.gateVisibility.qi;
    if (!showRoad) return;

    const roadHalfWidth = 34;
    const flare = 24 * (1 - metrics.tiltBlend);
    const outerY = isTop
      ? centerY - metrics.radiusY - 92
      : centerY + metrics.radiusY + 92;
    const innerY = isTop
      ? centerY - metrics.radiusY * 0.44
      : centerY + metrics.radiusY * 0.44;

    const points = isTop
      ? [
          { x: centerX - roadHalfWidth - flare, y: outerY },
          { x: centerX + roadHalfWidth + flare, y: outerY },
          { x: centerX + roadHalfWidth, y: innerY },
          { x: centerX - roadHalfWidth, y: innerY }
        ]
      : [
          { x: centerX - roadHalfWidth, y: innerY },
          { x: centerX + roadHalfWidth, y: innerY },
          { x: centerX + roadHalfWidth + flare, y: outerY },
          { x: centerX - roadHalfWidth - flare, y: outerY }
        ];

    // 道路主体（梯形）
    ctx.fillStyle = this.roadColor;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.fill();

    // 道路边框
    ctx.strokeStyle = this.roadBorderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 道路中线（虚线）
    ctx.setLineDash([15, 10]);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, outerY);
    ctx.lineTo(centerX, innerY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 绘制门/入口（上下口）
  drawGate(gateKey) {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const isTop = gateKey === 'cheng';
    const isVisible = isTop ? this.gateVisibility.cheng : this.gateVisibility.qi;
    if (!isVisible) return;

    const x = centerX;
    const y = isTop
      ? centerY - metrics.radiusY - 92
      : centerY + metrics.radiusY + 92;
    const gateWidth = 108;
    const gateHeight = 22 + ((1 - metrics.tiltBlend) * 18);
    const gateColor = isTop ? '#38bdf8' : '#34d399';

    // 扇形外发光
    const fanGradient = ctx.createRadialGradient(x, y, 8, x, y, 150);
    fanGradient.addColorStop(0, isTop ? 'rgba(56, 189, 248, 0.38)' : 'rgba(52, 211, 153, 0.38)');
    fanGradient.addColorStop(0.55, isTop ? 'rgba(56, 189, 248, 0.16)' : 'rgba(52, 211, 153, 0.16)');
    fanGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = fanGradient;
    ctx.beginPath();
    if (isTop) {
      ctx.moveTo(x, y);
      ctx.arc(x, y, 140, Math.PI, Math.PI * 2);
    } else {
      ctx.moveTo(x, y);
      ctx.arc(x, y, 140, 0, Math.PI);
    }
    ctx.closePath();
    ctx.fill();

    // 口位主体弧线
    ctx.strokeStyle = gateColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (isTop) {
      ctx.ellipse(x, y + 8, gateWidth * 0.5, gateHeight, 0, Math.PI, Math.PI * 2);
    } else {
      ctx.ellipse(x, y - 8, gateWidth * 0.5, gateHeight, 0, 0, Math.PI);
    }
    ctx.stroke();

    // 口位底座
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.beginPath();
    ctx.ellipse(x, y, gateWidth * 0.26, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

  }

  // 绘制粒子
  drawParticles() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;

    for (const p of this.particles) {
      // 更新位置（缓慢飘动）
      p.y += p.speed;
      if (p.y > 1) p.y = -1;

      const projX = centerX + p.x * width * 0.4;
      const projY = centerY + p.y * this.canvas.height * (0.3 + (metrics.tiltBlend * 0.08)) - p.z * (50 - (metrics.tiltBlend * 18));

      // 只绘制在可见区域内的粒子
      if (projX > 0 && projX < width && projY > 0 && projY < height) {
        ctx.fillStyle = `rgba(168, 85, 247, ${p.alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(projX, projY, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 绘制脉冲环
  drawPulseRings() {
    const ctx = this.ctx;
    const metrics = this.getSceneMetrics();
    const centerX = metrics.centerX + this.viewOffset.x;
    const centerY = metrics.centerY + this.viewOffset.y;
    const { radiusX, radiusY } = metrics;

    // 多个脉冲环
    for (let i = 0; i < 3; i++) {
      const phase = (this.time * 0.5 + i * 0.33) % 1;
      const scale = 0.5 + phase * 0.5;
      const alpha = (1 - phase) * 0.3;

      ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX * scale, radiusY * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 清空画布
    ctx.fillStyle = this.groundColor;
    ctx.fillRect(0, 0, width, height);

    // 绘制各层
    this.drawRoad('cheng');
    this.drawRoad('qi');
    this.drawGround();
    this.drawPulseRings();
    this.drawGate('cheng');
    this.drawGate('qi');
    this.drawParticles();

    // 更新时间
    this.time += 0.016;
  }

  startRenderLoop() {
    const animate = () => {
      this.render();
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  stopRenderLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  destroy() {
    this.stopRenderLoop();
  }
}

const KnowledgeDomainScene = ({
  node,
  isVisible,
  onExit,
  transitionProgress = 1, // 0-1，用于过渡动画
  mode = 'normal',
  onIntelSnapshotCaptured
}) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const containerRef = useRef(null);
  const cityDefenseLayerRef = useRef(null);
  const cityGateLayerRef = useRef(null);
  const [activeTab, setActiveTab] = useState('info');
  const [domainAdminState, setDomainAdminState] = useState({
    loading: false,
    error: '',
    canView: false,
    canEdit: false,
    isSystemAdmin: false,
    canResign: false,
    resignPending: false,
    domainMaster: null,
    domainAdmins: [],
    gateDefenseViewerAdminIds: [],
    pendingInvites: []
  });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [invitingUsername, setInvitingUsername] = useState('');
  const [revokingInviteId, setRevokingInviteId] = useState('');
  const [removingAdminId, setRemovingAdminId] = useState('');
  const [isSubmittingResign, setIsSubmittingResign] = useState(false);
  const [manageFeedback, setManageFeedback] = useState('');
  const [gateDefenseViewerDraftIds, setGateDefenseViewerDraftIds] = useState([]);
  const [gateDefenseViewerDirty, setGateDefenseViewerDirty] = useState(false);
  const [isSavingGateDefenseViewerPerms, setIsSavingGateDefenseViewerPerms] = useState(false);
  const [distributionState, setDistributionState] = useState(createDefaultDistributionState);
  const [distributionUserKeyword, setDistributionUserKeyword] = useState('');
  const [distributionUserResults, setDistributionUserResults] = useState([]);
  const [distributionUserSearching, setDistributionUserSearching] = useState(false);
  const [distributionAllianceKeyword, setDistributionAllianceKeyword] = useState('');
  const [distributionAllianceResults, setDistributionAllianceResults] = useState([]);
  const [distributionAllianceSearching, setDistributionAllianceSearching] = useState(false);
  const [isDistributionRuleModalOpen, setIsDistributionRuleModalOpen] = useState(false);
  const [newDistributionRuleName, setNewDistributionRuleName] = useState('');
  const [distributionClockMs, setDistributionClockMs] = useState(Date.now());
  const [hasUnsavedDistributionDraft, setHasUnsavedDistributionDraft] = useState(false);
  const [activeManageSidePanel, setActiveManageSidePanel] = useState('');
  const [isDomainInfoDockExpanded, setIsDomainInfoDockExpanded] = useState(false);
  const [defenseLayoutState, setDefenseLayoutState] = useState(createDefaultDefenseLayoutState);
  const [gateDeployState, setGateDeployState] = useState({
    loading: false,
    error: '',
    unitTypes: [],
    roster: [],
    activeGateKey: '',
    draggingUnitTypeId: ''
  });
  const [gateDeployDialogState, setGateDeployDialogState] = useState({
    open: false,
    gateKey: '',
    unitTypeId: '',
    unitName: '',
    max: 1
  });
  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 });
  const [isScenePanning, setIsScenePanning] = useState(false);
  const [cameraAngleDeg, setCameraAngleDeg] = useState(CITY_CAMERA_DEFAULT_ANGLE_DEG);
  const [intelHeistState, setIntelHeistState] = useState({
    active: false,
    totalMs: 0,
    deadlineMs: 0,
    activeBuildingId: '',
    searchStartedAtMs: 0,
    searchedBuildingIds: [],
    submitting: false,
    hintText: '',
    hintVisible: false,
    resultSnapshot: null,
    resultOpen: false,
    error: '',
    timeoutTriggered: false
  });
  const [intelHeistClockMs, setIntelHeistClockMs] = useState(Date.now());
  const [isIntelHeistExitConfirmOpen, setIsIntelHeistExitConfirmOpen] = useState(false);
  const buildingDragRef = useRef(null);
  const scenePanOffsetRef = useRef({ x: 0, y: 0 });
  const scenePanDragRef = useRef(null);
  const cameraAngleRef = useRef(CITY_CAMERA_DEFAULT_ANGLE_DEG);
  const cameraAngleAnimRef = useRef(null);
  const intelHeistHintTimerRef = useRef(null);
  const intelHeistScanRequestRef = useRef('');
  const intelHeistPauseStartedAtRef = useRef(0);
  const isIntelHeistMode = mode === 'intelHeist';
  const showManageTab = !!domainAdminState.canView;
  const hasParentEntrance = Array.isArray(node?.relatedParentDomains) && node.relatedParentDomains.length > 0;
  const hasChildEntrance = Array.isArray(node?.relatedChildDomains) && node.relatedChildDomains.length > 0;

  const parseApiResponse = async (response) => {
    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (e) {
      data = null;
    }
    return { response, data, rawText };
  };

  const getApiError = (parsed, fallback) => (
    parsed?.data?.error ||
    parsed?.data?.message ||
    fallback
  );

  const toggleManageSidePanel = (section) => {
    setActiveManageSidePanel((prev) => (prev === section ? '' : section));
  };

  const closeGateDeployDialog = () => {
    setGateDeployDialogState({
      open: false,
      gateKey: '',
      unitTypeId: '',
      unitName: '',
      max: 1
    });
  };

  const clearIntelHeistHintTimer = () => {
    if (intelHeistHintTimerRef.current) {
      clearTimeout(intelHeistHintTimerRef.current);
      intelHeistHintTimerRef.current = null;
    }
  };

  const resetIntelHeistState = () => {
    clearIntelHeistHintTimer();
    intelHeistScanRequestRef.current = '';
    intelHeistPauseStartedAtRef.current = 0;
    setIntelHeistClockMs(Date.now());
    setIsIntelHeistExitConfirmOpen(false);
    setIntelHeistState({
      active: false,
      totalMs: 0,
      deadlineMs: 0,
      activeBuildingId: '',
      searchStartedAtMs: 0,
      searchedBuildingIds: [],
      submitting: false,
      hintText: '',
      hintVisible: false,
      resultSnapshot: null,
      resultOpen: false,
      error: '',
      timeoutTriggered: false
    });
  };

  const showIntelHeistHint = (text) => {
    clearIntelHeistHintTimer();
    setIntelHeistState((prev) => ({
      ...prev,
      hintText: text,
      hintVisible: true
    }));
  };

  const startIntelHeistSearch = (buildingId) => {
    if (!isIntelHeistMode || !buildingId) return;
    setIntelHeistState((prev) => {
      if (!prev.active || prev.timeoutTriggered || prev.resultOpen) return prev;
      if (prev.submitting || prev.activeBuildingId) return prev;
      if ((prev.searchedBuildingIds || []).includes(buildingId)) return prev;
      if (prev.deadlineMs > 0 && Date.now() >= prev.deadlineMs) return prev;
      return {
        ...prev,
        activeBuildingId: buildingId,
        searchStartedAtMs: Date.now(),
        error: '',
        hintVisible: false
      };
    });
    clearIntelHeistHintTimer();
    intelHeistHintTimerRef.current = setTimeout(() => {
      setIntelHeistState((prev) => ({
        ...prev,
        hintText: ''
      }));
      intelHeistHintTimerRef.current = null;
    }, 220);
  };

  const exitIntelHeistGame = (exitPayload = {}) => {
    resetIntelHeistState();
    if (typeof onExit === 'function') {
      onExit(exitPayload);
    }
  };

  const requestExitIntelHeistGame = () => {
    if (!isIntelHeistMode) {
      if (typeof onExit === 'function') onExit();
      return;
    }
    if (intelHeistState.resultOpen || intelHeistState.timeoutTriggered || !intelHeistState.active) {
      exitIntelHeistGame();
      return;
    }
    setIsIntelHeistExitConfirmOpen(true);
  };

  const cancelExitIntelHeistGame = () => {
    setIsIntelHeistExitConfirmOpen(false);
  };

  const resolveIntelHeistSearch = async (buildingId) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !buildingId) return;
    const requestId = `${buildingId}_${Date.now()}`;
    intelHeistScanRequestRef.current = requestId;
    setIntelHeistState((prev) => ({
      ...prev,
      submitting: true,
      error: ''
    }));
    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/intel-heist/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ buildingId })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (intelHeistScanRequestRef.current !== requestId) return;
      if (!response.ok || !data) {
        setIntelHeistState((prev) => ({
          ...prev,
          submitting: false,
          error: getApiError(parsed, '建筑搜索失败')
        }));
        return;
      }
      if (data.found && data.snapshot) {
        setIntelHeistState((prev) => ({
          ...prev,
          active: false,
          submitting: false,
          activeBuildingId: '',
          searchStartedAtMs: 0,
          resultSnapshot: data.snapshot,
          resultOpen: true,
          hintText: '',
          hintVisible: false,
          searchedBuildingIds: Array.from(new Set([...(prev.searchedBuildingIds || []), buildingId]))
        }));
        if (typeof onIntelSnapshotCaptured === 'function') {
          onIntelSnapshotCaptured(data.snapshot, node);
        }
        return;
      }
      setIntelHeistState((prev) => ({
        ...prev,
        submitting: false,
        searchedBuildingIds: Array.from(new Set([...(prev.searchedBuildingIds || []), buildingId]))
      }));
      showIntelHeistHint(data.message || '该建筑未发现情报文件');
    } catch (error) {
      if (intelHeistScanRequestRef.current !== requestId) return;
      setIntelHeistState((prev) => ({
        ...prev,
        submitting: false,
        error: `建筑搜索失败: ${error.message}`
      }));
    } finally {
      if (intelHeistScanRequestRef.current === requestId) {
        intelHeistScanRequestRef.current = '';
      }
    }
  };

  const applyCameraAngle = (angleDeg, syncState = true) => {
    const clamped = clampCityCameraAngle(angleDeg);
    cameraAngleRef.current = clamped;
    if (rendererRef.current) {
      rendererRef.current.setCameraAngle(clamped);
    }
    if (syncState) {
      setCameraAngleDeg(clamped);
    }
  };

  const applyScenePanOffset = (nextOffset = { x: 0, y: 0 }) => {
    const container = containerRef.current;
    const width = container?.clientWidth || sceneSize.width || 0;
    const height = container?.clientHeight || sceneSize.height || 0;
    const clamped = clampScenePanOffset(nextOffset, width, height);
    scenePanOffsetRef.current = clamped;
    if (rendererRef.current) {
      rendererRef.current.setViewOffset(clamped.x, clamped.y);
    }
    if (cityDefenseLayerRef.current) {
      cityDefenseLayerRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    }
    if (cityGateLayerRef.current) {
      cityGateLayerRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    }
  };

  const handleScenePointerDown = (event) => {
    if (event.button !== 0) return;
    if (!isVisible || displayOpacity <= 0.5) return;
    if (defenseLayoutState.draggingBuildingId) return;
    const target = event.target;
    if (
      target?.closest('.domain-right-dock')
      || target?.closest('.exit-domain-btn')
      || target?.closest('.domain-return-top-btn')
      || target?.closest('.city-gate-trigger')
      || target?.closest('.gate-deploy-panel')
      || target?.closest('.number-pad-dialog-overlay')
      || target?.closest('.distribution-rule-modal-overlay')
      || target?.closest('.intel-heist-hud')
      || target?.closest('.intel-heist-result-overlay')
      || target?.closest('.intel-heist-hint')
      || target?.closest('.intel-heist-exit-confirm-overlay')
      || target?.closest('.intel-heist-exit-confirm-card')
      || target?.closest('.intel-heist-timeout-overlay')
      || target?.closest('.intel-heist-timeout-card')
      || target?.closest('.city-defense-building.editable')
      || target?.closest('.city-defense-building.intel-heist-searchable')
    ) {
      return;
    }

    scenePanDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: scenePanOffsetRef.current.x,
      originY: scenePanOffsetRef.current.y,
      pointerId: event.pointerId
    };
    setIsScenePanning(true);
    if (typeof containerRef.current?.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        containerRef.current.setPointerCapture(event.pointerId);
      } catch (e) {
        // ignore capture errors in unsupported environments
      }
    }
  };

  const fetchDefenseLayout = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    if (!silent) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        loading: true,
        error: '',
        feedback: ''
      }));
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/defense-layout`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDefenseLayoutState((prev) => ({
          ...prev,
          loading: false,
          canViewGateDefense: false,
          error: getApiError(parsed, '获取城防配置失败'),
          feedback: ''
        }));
        return;
      }

      const layout = normalizeDefenseLayoutFromApi(data.layout || {});
      setDefenseLayoutState((prev) => ({
        ...prev,
        loading: false,
        saving: false,
        error: '',
        feedback: '',
        canEdit: !!data.canEdit,
        canViewGateDefense: !!data.canViewGateDefense || !!data.canEdit,
        maxBuildings: Number.isFinite(Number(data.maxBuildings)) ? Math.max(1, Number(data.maxBuildings)) : CITY_BUILDING_LIMIT,
        minBuildings: Number.isFinite(Number(data.minBuildings)) ? Math.max(1, Number(data.minBuildings)) : 1,
        buildMode: false,
        isDirty: false,
        selectedBuildingId: '',
        draggingBuildingId: '',
        savedLayout: cloneDefenseLayout(layout),
        draftLayout: cloneDefenseLayout(layout)
      }));
      buildingDragRef.current = null;
      setGateDeployState((prev) => ({
        ...prev,
        activeGateKey: '',
        draggingUnitTypeId: ''
      }));
      closeGateDeployDialog();
    } catch (error) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        loading: false,
        canViewGateDefense: false,
        error: `获取城防配置失败: ${error.message}`,
        feedback: ''
      }));
    }
  };

  const fetchGateDeployArmyData = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;
    setGateDeployState((prev) => ({
      ...prev,
      loading: true,
      error: ''
    }));
    try {
      const [unitTypeResponse, meResponse] = await Promise.all([
        fetch('http://localhost:5000/api/army/unit-types', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch('http://localhost:5000/api/army/me', {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      const [unitTypeParsed, meParsed] = await Promise.all([
        parseApiResponse(unitTypeResponse),
        parseApiResponse(meResponse)
      ]);
      if (!unitTypeResponse.ok || !unitTypeParsed?.data || !meResponse.ok || !meParsed?.data) {
        setGateDeployState((prev) => ({
          ...prev,
          loading: false,
          error: getApiError(unitTypeParsed, getApiError(meParsed, '加载兵力配置失败'))
        }));
        return;
      }
      setGateDeployState((prev) => ({
        ...prev,
        loading: false,
        error: '',
        unitTypes: Array.isArray(unitTypeParsed.data.unitTypes) ? unitTypeParsed.data.unitTypes : [],
        roster: Array.isArray(meParsed.data.roster) ? meParsed.data.roster : []
      }));
    } catch (error) {
      setGateDeployState((prev) => ({
        ...prev,
        loading: false,
        error: `加载兵力配置失败: ${error.message}`
      }));
    }
  };

  const openGateDeployPanel = (gateKey) => {
    const canOpen = defenseLayoutState.canEdit || defenseLayoutState.canViewGateDefense;
    if (!canOpen) return;
    if (!CITY_GATE_KEYS.includes(gateKey)) return;
    closeGateDeployDialog();
    setGateDeployState((prev) => ({
      ...prev,
      activeGateKey: gateKey,
      error: ''
    }));
    if ((gateDeployState.unitTypes || []).length === 0 && !gateDeployState.loading) {
      fetchGateDeployArmyData();
    }
  };

  const updateGateDefenseEntries = (gateKey, updater) => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode) return prev;
      if (!CITY_GATE_KEYS.includes(gateKey)) return prev;
      const nextDraft = cloneDefenseLayout(prev.draftLayout);
      const currentEntries = getGateDefenseEntries(nextDraft, gateKey);
      const nextEntries = typeof updater === 'function'
        ? updater(currentEntries)
        : currentEntries;
      nextDraft.gateDefense = {
        ...(nextDraft.gateDefense || { cheng: [], qi: [] }),
        [gateKey]: Array.isArray(nextEntries) ? nextEntries.filter((entry) => entry.unitTypeId && entry.count > 0) : []
      };
      return {
        ...prev,
        draftLayout: nextDraft,
        isDirty: true,
        error: '',
        feedback: ''
      };
    });
  };

  const removeGateDefenseUnit = (gateKey, unitTypeId) => {
    if (!unitTypeId) return;
    updateGateDefenseEntries(gateKey, (entries) => entries.filter((entry) => entry.unitTypeId !== unitTypeId));
  };

  const handleGateDeployDrop = (gateKey, unitTypeId) => {
    if (!defenseLayoutState.canEdit || !defenseLayoutState.buildMode) return;
    if (!gateKey || !unitTypeId) return;

    const rosterMap = new Map(
      (Array.isArray(gateDeployState.roster) ? gateDeployState.roster : [])
        .map((entry) => [
          typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
          Math.max(0, Math.floor(Number(entry?.count) || 0))
        ])
        .filter(([id]) => !!id)
    );
    const rosterCount = rosterMap.get(unitTypeId) || 0;
    if (rosterCount <= 0) {
      setGateDeployState((prev) => ({
        ...prev,
        error: '该兵种当前可用兵力为 0'
      }));
      return;
    }

    const currentLayout = cloneDefenseLayout(defenseLayoutState.draftLayout);
    const deployedCounter = getDeployedCountByUnitType(currentLayout);
    const deployedTotal = deployedCounter.get(unitTypeId) || 0;
    const available = Math.max(0, rosterCount - deployedTotal);
    if (available <= 0) {
      setGateDeployState((prev) => ({
        ...prev,
        error: '该兵种已全部用于布防，无法继续派遣'
      }));
      return;
    }

    const unitTypeMap = new Map(
      (Array.isArray(gateDeployState.unitTypes) ? gateDeployState.unitTypes : [])
        .map((unitType) => [unitType?.id || unitType?.unitTypeId, unitType])
        .filter(([id]) => !!id)
    );
    const unitName = unitTypeMap.get(unitTypeId)?.name || unitTypeId;
    setGateDeployState((prev) => ({ ...prev, error: '' }));
    setGateDeployDialogState({
      open: true,
      gateKey,
      unitTypeId,
      unitName,
      max: available
    });
  };

  const confirmGateDeployQuantity = (qty) => {
    const gateKey = gateDeployDialogState.gateKey;
    const unitTypeId = gateDeployDialogState.unitTypeId;
    const max = Math.max(1, Math.floor(Number(gateDeployDialogState.max) || 1));
    const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
    if (!gateKey || !unitTypeId) {
      closeGateDeployDialog();
      return;
    }
    if (safeQty > max) {
      setGateDeployState((prev) => ({
        ...prev,
        error: `超出可用兵力，最多可派遣 ${max}`
      }));
      closeGateDeployDialog();
      return;
    }
    updateGateDefenseEntries(gateKey, (entries) => {
      const nextEntries = [...entries];
      const index = nextEntries.findIndex((entry) => entry.unitTypeId === unitTypeId);
      if (index >= 0) {
        nextEntries[index] = {
          ...nextEntries[index],
          count: nextEntries[index].count + safeQty
        };
      } else {
        nextEntries.push({ unitTypeId, count: safeQty });
      }
      return nextEntries;
    });
    closeGateDeployDialog();
  };

  const getPointerNormPosition = (clientX, clientY) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return null;
    const metrics = getCityMetrics(containerRect.width, containerRect.height, cameraAngleRef.current);
    const panOffset = scenePanOffsetRef.current || { x: 0, y: 0 };
    const rawX = (clientX - containerRect.left - metrics.centerX - panOffset.x) / (metrics.radiusX || 1);
    const rawY = (clientY - containerRect.top - metrics.centerY - panOffset.y) / (metrics.radiusY || 1);
    return clampPositionInsideCity({
      x: Math.max(-1, Math.min(1, rawX)),
      y: Math.max(-1, Math.min(1, rawY))
    });
  };

  const toggleBuildMode = () => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit) return prev;
      if (prev.buildMode) {
        if (prev.isDirty) {
          const shouldDiscard = window.confirm('当前有未保存的建造配置，退出建造模式会丢失改动，是否继续？');
          if (!shouldDiscard) return prev;
        }
        return {
          ...prev,
          buildMode: false,
          isDirty: false,
          selectedBuildingId: '',
          draggingBuildingId: '',
          error: '',
          feedback: '',
          draftLayout: cloneDefenseLayout(prev.savedLayout)
        };
      }
      return {
        ...prev,
        buildMode: true,
        isDirty: false,
        selectedBuildingId: '',
        draggingBuildingId: '',
        error: '',
        feedback: '',
        draftLayout: cloneDefenseLayout(prev.savedLayout)
      };
    });
    buildingDragRef.current = null;
    setGateDeployState((prev) => ({
      ...prev,
      activeGateKey: '',
      draggingUnitTypeId: ''
    }));
    closeGateDeployDialog();
  };

  const addDefenseBuilding = () => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode) return prev;
      const currentBuildings = prev.draftLayout?.buildings || [];
      if (currentBuildings.length >= prev.maxBuildings) {
        return {
          ...prev,
          feedback: `建筑上限为 ${prev.maxBuildings} 个`,
          error: ''
        };
      }

      const newId = `building_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const foundPosition = CITY_BUILDING_CANDIDATE_POSITIONS.find((candidate) => (
        isValidPlacement(candidate, currentBuildings, newId)
      ));
      if (!foundPosition) {
        return {
          ...prev,
          feedback: '没有可用空位，请先调整现有建筑位置',
          error: ''
        };
      }

      const nextLayout = cloneDefenseLayout(prev.draftLayout);
      nextLayout.buildings.push({
        buildingId: newId,
        name: `建筑${nextLayout.buildings.length + 1}`,
        x: foundPosition.x,
        y: foundPosition.y,
        radius: CITY_BUILDING_DEFAULT_RADIUS,
        level: 1,
        nextUnitTypeId: '',
        upgradeCostKP: null
      });
      return {
        ...prev,
        draftLayout: nextLayout,
        isDirty: true,
        selectedBuildingId: newId,
        feedback: '',
        error: ''
      };
    });
  };

  const setIntelOnSelectedBuilding = () => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode || !prev.selectedBuildingId) return prev;
      if (!(prev.draftLayout?.buildings || []).some((item) => item.buildingId === prev.selectedBuildingId)) {
        return prev;
      }
      if (prev.draftLayout.intelBuildingId === prev.selectedBuildingId) {
        return {
          ...prev,
          feedback: '当前建筑已存放情报文件',
          error: ''
        };
      }
      return {
        ...prev,
        draftLayout: {
          ...cloneDefenseLayout(prev.draftLayout),
          intelBuildingId: prev.selectedBuildingId
        },
        isDirty: true,
        feedback: '',
        error: ''
      };
    });
  };

  const removeSelectedDefenseBuilding = () => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode || !prev.selectedBuildingId) return prev;
      const currentBuildings = prev.draftLayout?.buildings || [];
      if (currentBuildings.length <= prev.minBuildings) {
        return {
          ...prev,
          feedback: `至少保留 ${prev.minBuildings} 个建筑`,
          error: ''
        };
      }
      const nextBuildings = currentBuildings.filter((item) => item.buildingId !== prev.selectedBuildingId);
      if (nextBuildings.length === currentBuildings.length) return prev;
      const nextIntelBuildingId = prev.draftLayout.intelBuildingId === prev.selectedBuildingId
        ? nextBuildings[0]?.buildingId || ''
        : prev.draftLayout.intelBuildingId;
      return {
        ...prev,
        draftLayout: {
          ...cloneDefenseLayout(prev.draftLayout),
          buildings: nextBuildings,
          intelBuildingId: nextIntelBuildingId
        },
        isDirty: true,
        selectedBuildingId: nextBuildings[0]?.buildingId || '',
        feedback: '',
        error: ''
      };
    });
  };

  const saveDefenseLayout = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    const snapshot = defenseLayoutState;
    if (!snapshot.canEdit || !snapshot.buildMode) return;
    if (!snapshot.isDirty) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        feedback: '当前没有需要保存的改动',
        error: ''
      }));
      return;
    }

    setDefenseLayoutState((prev) => ({
      ...prev,
      saving: true,
      feedback: '',
      error: ''
    }));
    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/defense-layout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          layout: defenseLayoutToPayload(snapshot.draftLayout)
        })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDefenseLayoutState((prev) => ({
          ...prev,
          saving: false,
          error: getApiError(parsed, '保存城防配置失败')
        }));
        return;
      }
      const layout = normalizeDefenseLayoutFromApi(data.layout || snapshot.draftLayout);
      setDefenseLayoutState((prev) => ({
        ...prev,
        saving: false,
        buildMode: false,
        isDirty: false,
        selectedBuildingId: '',
        draggingBuildingId: '',
        error: '',
        feedback: data.message || '城防配置已保存',
        savedLayout: cloneDefenseLayout(layout),
        draftLayout: cloneDefenseLayout(layout)
      }));
      buildingDragRef.current = null;
      setGateDeployState((prev) => ({
        ...prev,
        activeGateKey: '',
        draggingUnitTypeId: ''
      }));
      closeGateDeployDialog();
    } catch (error) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        saving: false,
        error: `保存城防配置失败: ${error.message}`
      }));
    }
  };

  const handleDefenseBuildingPointerDown = (event, buildingId) => {
    if (!defenseLayoutState.canEdit || !defenseLayoutState.buildMode) return;
    event.preventDefault();
    event.stopPropagation();
    buildingDragRef.current = { buildingId };
    setDefenseLayoutState((prev) => ({
      ...prev,
      selectedBuildingId: buildingId,
      draggingBuildingId: buildingId,
      feedback: '',
      error: ''
    }));
  };

  const fetchDomainAdmins = async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    if (!silent) {
      setDomainAdminState((prev) => ({ ...prev, loading: true, error: '' }));
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        // 权限不足时，直接隐藏“管理知识域”标签，不展示错误文案
        if (response.status === 403) {
          setDomainAdminState((prev) => ({
            ...prev,
            loading: false,
            canView: false,
            canEdit: false,
            isSystemAdmin: false,
            canResign: false,
            resignPending: false,
            gateDefenseViewerAdminIds: [],
            pendingInvites: [],
            error: ''
          }));
          setGateDefenseViewerDraftIds([]);
          setGateDefenseViewerDirty(false);
          return;
        }

        setDomainAdminState((prev) => ({
          ...prev,
          loading: false,
          canView: false,
          canEdit: false,
          isSystemAdmin: false,
          canResign: false,
          resignPending: false,
          gateDefenseViewerAdminIds: [],
          pendingInvites: [],
          error: getApiError(parsed, '获取域相列表失败')
        }));
        setGateDefenseViewerDraftIds([]);
        setGateDefenseViewerDirty(false);
        return;
      }

      const gateDefenseViewerAdminIds = Array.isArray(data.gateDefenseViewerAdminIds)
        ? Array.from(new Set(data.gateDefenseViewerAdminIds
          .map((id) => (typeof id === 'string' ? id : ''))
          .filter((id) => !!id)))
        : [];

      setDomainAdminState({
        loading: false,
        error: '',
        canView: !!data.canView,
        canEdit: !!data.canEdit,
        isSystemAdmin: !!data.isSystemAdmin,
        canResign: !!data.canResign,
        resignPending: !!data.resignPending,
        domainMaster: data.domainMaster || null,
        domainAdmins: data.domainAdmins || [],
        gateDefenseViewerAdminIds,
        pendingInvites: data.pendingInvites || []
      });
      setGateDefenseViewerDraftIds(gateDefenseViewerAdminIds);
      setGateDefenseViewerDirty(false);
    } catch (error) {
      setDomainAdminState((prev) => ({
        ...prev,
        loading: false,
        isSystemAdmin: false,
        canResign: false,
        resignPending: false,
        gateDefenseViewerAdminIds: [],
        pendingInvites: [],
        error: `获取域相列表失败: ${error.message}`
      }));
      setGateDefenseViewerDraftIds([]);
      setGateDefenseViewerDirty(false);
    }
  };

  const applyResignDomainAdmin = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    const confirmed = window.confirm('确认提交卸任申请？域主3天内未处理将自动同意。');
    if (!confirmed) return;

    setIsSubmittingResign(true);
    setManageFeedback('');
    setGateDefenseViewerDraftIds([]);
    setGateDefenseViewerDirty(false);
    setIsSavingGateDefenseViewerPerms(false);

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/resign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '提交卸任申请失败'));
        return;
      }

      setManageFeedback(data.message || '卸任申请已提交');
      await fetchDomainAdmins(true);
    } catch (error) {
      setManageFeedback(`提交卸任申请失败: ${error.message}`);
    } finally {
      setIsSubmittingResign(false);
    }
  };

  const inviteDomainAdmin = async (username) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !username) return;

    setInvitingUsername(username);
    setManageFeedback('');

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ username })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '发送邀请失败'));
        return;
      }

      setManageFeedback(data.message || '邀请已发送');
      setSearchKeyword('');
      setSearchResults([]);
      await fetchDomainAdmins(true);
      await fetchDistributionSettings(true);
    } catch (error) {
      setManageFeedback(`发送邀请失败: ${error.message}`);
    } finally {
      setInvitingUsername('');
    }
  };

  const removeDomainAdmin = async (adminUserId) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !adminUserId) return;

    const confirmed = window.confirm('确认移除该管理员吗？');
    if (!confirmed) return;

    setRemovingAdminId(adminUserId);
    setManageFeedback('');

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/${adminUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '移除管理员失败'));
        return;
      }

      setManageFeedback(data.message || '管理员已移除');
      await fetchDomainAdmins(true);
      await fetchDistributionSettings(true);
    } catch (error) {
      setManageFeedback(`移除管理员失败: ${error.message}`);
    } finally {
      setRemovingAdminId('');
    }
  };

  const toggleGateDefenseViewerAdmin = (adminUserId) => {
    if (!domainAdminState.canEdit || !adminUserId) return;
    setGateDefenseViewerDraftIds((prev) => {
      const exists = prev.includes(adminUserId);
      if (exists) {
        return prev.filter((id) => id !== adminUserId);
      }
      return [...prev, adminUserId];
    });
    setGateDefenseViewerDirty(true);
    setManageFeedback('');
  };

  const saveGateDefenseViewerPermissions = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !domainAdminState.canEdit) return;

    setIsSavingGateDefenseViewerPerms(true);
    setManageFeedback('');
    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/gate-defense-viewers`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          viewerAdminIds: gateDefenseViewerDraftIds
        })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '保存承口/启口可查看权限失败'));
        return;
      }

      const savedViewerIds = Array.isArray(data.gateDefenseViewerAdminIds)
        ? Array.from(new Set(data.gateDefenseViewerAdminIds
          .map((id) => (typeof id === 'string' ? id : ''))
          .filter((id) => !!id)))
        : [];
      setDomainAdminState((prev) => ({
        ...prev,
        gateDefenseViewerAdminIds: savedViewerIds
      }));
      setGateDefenseViewerDraftIds(savedViewerIds);
      setGateDefenseViewerDirty(false);
      setManageFeedback(data.message || '承口/启口可查看权限已保存');
    } catch (error) {
      setManageFeedback(`保存承口/启口可查看权限失败: ${error.message}`);
    } finally {
      setIsSavingGateDefenseViewerPerms(false);
    }
  };

  const revokeDomainAdminInvite = async (notificationId) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id || !notificationId) return;

    setRevokingInviteId(notificationId);
    setManageFeedback('');

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/domain-admins/invite/${notificationId}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;

      if (!response.ok || !data) {
        setManageFeedback(getApiError(parsed, '撤销邀请失败'));
        return;
      }

      setManageFeedback(data.message || '邀请已撤销');
      await fetchDomainAdmins(true);
      await fetchDistributionSettings(true);
    } catch (error) {
      setManageFeedback(`撤销邀请失败: ${error.message}`);
    } finally {
      setRevokingInviteId('');
    }
  };

  const normalizeDistributionProfiles = (rawProfiles = [], rawActiveRuleId = '', allianceContributionPercent = 0) => {
    const input = Array.isArray(rawProfiles) && rawProfiles.length > 0
      ? rawProfiles
      : [createDistributionRuleProfile('default', '默认规则')];
    const seen = new Set();
    const profiles = input
      .map((profile, index) => mapDistributionRuleProfileFromApi(profile, index))
      .filter((profile) => {
        if (!profile.profileId || seen.has(profile.profileId)) return false;
        seen.add(profile.profileId);
        return true;
      })
      .map((profile) => ({
        ...profile,
        percentSummary: computePercentSummary(profile.rule, allianceContributionPercent)
      }));

    const safeProfiles = profiles.length > 0 ? profiles : [createDistributionRuleProfile('default', '默认规则')];
    const activeRuleId = safeProfiles.some((profile) => profile.profileId === rawActiveRuleId)
      ? rawActiveRuleId
      : safeProfiles[0].profileId;

    return { profiles: safeProfiles, activeRuleId };
  };

  const updateDistributionRule = (updater) => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextProfiles = [...normalized.profiles];
      const targetIndex = nextProfiles.findIndex((item) => item.profileId === normalized.activeRuleId);
      const currentRule = nextProfiles[targetIndex]?.rule || createDefaultDistributionRule();
      const nextRule = typeof updater === 'function' ? updater(currentRule) : updater;
      const nextSummary = computePercentSummary(nextRule, prev.allianceContributionPercent);
      nextProfiles[targetIndex] = {
        ...nextProfiles[targetIndex],
        rule: nextRule,
        percentSummary: nextSummary
      };

      return {
        ...prev,
        ruleProfiles: nextProfiles,
        activeRuleId: normalized.activeRuleId,
        percentSummary: nextSummary,
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  };

  const updateActiveDistributionRuleName = (name) => {
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : '未命名规则';
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      return {
        ...prev,
        ruleProfiles: normalized.profiles.map((profile) => (
          profile.profileId === normalized.activeRuleId
            ? { ...profile, name: nextName }
            : profile
        )),
        activeRuleId: normalized.activeRuleId,
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  };

  const setActiveDistributionRule = (profileId) => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextActiveRuleId = normalized.profiles.some((profile) => profile.profileId === profileId)
        ? profileId
        : normalized.activeRuleId;
      const activeProfile = normalized.profiles.find((profile) => profile.profileId === nextActiveRuleId) || normalized.profiles[0];
      return {
        ...prev,
        ruleProfiles: normalized.profiles,
        activeRuleId: nextActiveRuleId,
        percentSummary: computePercentSummary(activeProfile?.rule || createDefaultDistributionRule(), prev.allianceContributionPercent),
        feedback: ''
      };
    });
  };

  const createDistributionRuleProfileItem = () => {
    const trimmedName = newDistributionRuleName.trim();
    const nextName = trimmedName || `规则${(distributionState.ruleProfiles || []).length + 1}`;
    const nextId = createDistributionRuleProfileId();
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      const nextProfiles = [
        ...normalized.profiles,
        {
          ...createDistributionRuleProfile(nextId, nextName),
          percentSummary: computePercentSummary(createDefaultDistributionRule(), prev.allianceContributionPercent)
        }
      ];
      return {
        ...prev,
        ruleProfiles: nextProfiles,
        activeRuleId: nextId,
        percentSummary: computePercentSummary(createDefaultDistributionRule(), prev.allianceContributionPercent),
        feedback: ''
      };
    });
    setNewDistributionRuleName('');
    setHasUnsavedDistributionDraft(true);
  };

  const removeActiveDistributionRule = () => {
    setDistributionState((prev) => {
      const normalized = normalizeDistributionProfiles(
        prev.ruleProfiles,
        prev.activeRuleId,
        prev.allianceContributionPercent
      );
      if (normalized.profiles.length <= 1) {
        return {
          ...prev,
          feedback: '至少保留一套分发规则'
        };
      }
      const filtered = normalized.profiles.filter((profile) => profile.profileId !== normalized.activeRuleId);
      const nextActive = filtered[0];
      return {
        ...prev,
        ruleProfiles: filtered,
        activeRuleId: nextActive.profileId,
        percentSummary: computePercentSummary(nextActive.rule, prev.allianceContributionPercent),
        feedback: ''
      };
    });
    setHasUnsavedDistributionDraft(true);
  };

  const fetchDistributionSettings = async (silent = true, forceApplyRules = false) => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;

    if (!silent) {
      setDistributionState((prev) => ({ ...prev, loading: true, error: '', feedback: '' }));
    }

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/distribution-settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        if (response.status === 403) {
          setDistributionState((prev) => ({ ...prev, loading: false, canView: false, canEdit: false, error: '' }));
          return;
        }
        setDistributionState((prev) => ({
          ...prev,
          loading: false,
          canView: false,
          canEdit: false,
          error: getApiError(parsed, '获取分发规则失败')
        }));
        return;
      }

      const allianceContributionPercent = Number(data.allianceContributionPercent || 0);
      const hasAlliance = !!data.masterAllianceName;
      const rawProfiles = Array.isArray(data.ruleProfiles) && data.ruleProfiles.length > 0
        ? data.ruleProfiles
        : [{ profileId: data.activeRuleId || 'default', name: '默认规则', rule: data.rule || {} }];
      const normalized = normalizeDistributionProfiles(rawProfiles, data.activeRuleId || '', allianceContributionPercent);
      const normalizedProfiles = hasAlliance
        ? normalized.profiles
        : normalized.profiles.map((profile) => ({
            ...profile,
            rule: {
              ...profile.rule,
              nonHostileAlliancePercent: 0,
              specificAlliancePercents: []
            },
            percentSummary: computePercentSummary({
              ...profile.rule,
              nonHostileAlliancePercent: 0,
              specificAlliancePercents: []
            }, allianceContributionPercent)
          }));
      const activeProfile = normalizedProfiles.find((profile) => profile.profileId === normalized.activeRuleId) || normalizedProfiles[0];
      const nextLocked = data.locked || null;
      const publishRuleId = nextLocked?.ruleProfileId
        || (normalizedProfiles.some((profile) => profile.profileId === data.activeRuleId) ? data.activeRuleId : activeProfile?.profileId || 'default');
      const publishExecuteAt = nextLocked?.executeAt
        ? toHourInputValue(nextLocked.executeAt)
        : getDefaultPublishExecuteAtInput();
      const shouldPreserveLocalDraft = silent && hasUnsavedDistributionDraft && !forceApplyRules;

      setDistributionState((prev) => {
        const appliedRuleState = shouldPreserveLocalDraft
          ? (() => {
              const localNormalized = normalizeDistributionProfiles(
                prev.ruleProfiles,
                prev.activeRuleId,
                allianceContributionPercent
              );
              const localProfiles = hasAlliance
                ? localNormalized.profiles
                : localNormalized.profiles.map((profile) => ({
                    ...profile,
                    rule: {
                      ...profile.rule,
                      nonHostileAlliancePercent: 0,
                      specificAlliancePercents: []
                    },
                    percentSummary: computePercentSummary({
                      ...profile.rule,
                      nonHostileAlliancePercent: 0,
                      specificAlliancePercents: []
                    }, allianceContributionPercent)
                  }));
              const localActiveProfile = localProfiles.find((profile) => profile.profileId === localNormalized.activeRuleId) || localProfiles[0];
              return {
                activeRuleId: localNormalized.activeRuleId,
                ruleProfiles: localProfiles,
                percentSummary: computePercentSummary(localActiveProfile?.rule || createDefaultDistributionRule(), allianceContributionPercent)
              };
            })()
          : {
              activeRuleId: normalized.activeRuleId,
              ruleProfiles: normalizedProfiles,
              percentSummary: computePercentSummary(activeProfile?.rule || createDefaultDistributionRule(), allianceContributionPercent)
            };

        return {
          ...prev,
          ...appliedRuleState,
          loading: false,
          saving: false,
          publishing: false,
          error: '',
          feedback: shouldPreserveLocalDraft ? prev.feedback : '',
          canView: !!data.canView,
          canEdit: !!data.canEdit,
          isRuleLocked: !!data.isRuleLocked,
          allianceContributionPercent,
          masterAllianceName: data.masterAllianceName || '',
          carryoverValue: Number(data.carryoverValue || 0),
          knowledgePointValue: Number(data.knowledgePointValue || 0),
          lastSyncedAt: Date.now(),
          locked: nextLocked,
          publishRuleId,
          publishExecuteAt
        };
      });
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        loading: false,
        error: `获取分发规则失败: ${error.message}`
      }));
    }
  };

  const saveDistributionSettings = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;
    if (!distributionState.canEdit) return;
    if (distributionState.locked) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '当前分发计划已发布，采用规则锁定中，请等待本次分发结束后再修改规则'
      }));
      return;
    }

    const hasMasterAlliance = !!distributionState.masterAllianceName;
    const normalized = normalizeDistributionProfiles(
      distributionState.ruleProfiles,
      distributionState.activeRuleId,
      distributionState.allianceContributionPercent
    );
    const overLimitProfile = normalized.profiles.find((profile) => (
      computePercentSummary(profile.rule, distributionState.allianceContributionPercent).total > 100
    ));
    if (overLimitProfile) {
      const overTotal = computePercentSummary(overLimitProfile.rule, distributionState.allianceContributionPercent).total;
      setDistributionState((prev) => ({
        ...prev,
        feedback: `规则「${overLimitProfile.name}」总比例 ${overTotal}% 超过 100%，请调整`
      }));
      return;
    }

    setDistributionState((prev) => ({ ...prev, saving: true, feedback: '', error: '' }));
    try {
      const payload = {
        activeRuleId: normalized.activeRuleId,
        ruleProfiles: normalized.profiles.map((profile) => ({
          profileId: profile.profileId,
          name: profile.name,
          rule: (() => {
            const baseRule = {
              ...buildDistributionRulePayload(profile.rule),
              distributionScope: profile.rule?.distributionScope === 'partial' ? 'partial' : 'all',
              distributionPercent: getDistributionScopePercent(profile.rule)
            };
            if (!hasMasterAlliance) {
              baseRule.nonHostileAlliancePercent = 0;
              baseRule.specificAlliancePercents = [];
            }
            return baseRule;
          })()
        }))
      };

      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/distribution-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionState((prev) => ({
          ...prev,
          saving: false,
          error: getApiError(parsed, '保存分发规则失败')
        }));
        return;
      }

      setDistributionState((prev) => ({
        ...prev,
        saving: false,
        feedback: data.message || '分发规则已保存',
        isRuleLocked: !!data.isRuleLocked
      }));
      setHasUnsavedDistributionDraft(false);
      await fetchDistributionSettings(true, true);
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        saving: false,
        error: `保存分发规则失败: ${error.message}`
      }));
    }
  };

  const publishDistributionPlan = async () => {
    const token = localStorage.getItem('token');
    if (!token || !node?._id) return;
    if (!distributionState.canEdit) return;

    if (distributionState.locked) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '当前已有已发布分发计划，发布后不可撤回，请等待本次分发执行后再发布'
      }));
      return;
    }

    const now = Date.now();

    const executeAtDate = parseHourInputToDate(distributionState.publishExecuteAt);
    if (!executeAtDate) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '请设置整点执行时间（例如 2026-02-16 16:00）'
      }));
      return;
    }
    if (executeAtDate.getTime() <= now) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: '执行时间必须晚于当前时间'
      }));
      return;
    }

    const normalized = normalizeDistributionProfiles(
      distributionState.ruleProfiles,
      distributionState.activeRuleId,
      distributionState.allianceContributionPercent
    );
    const targetProfile = normalized.profiles.find((profile) => profile.profileId === distributionState.publishRuleId)
      || normalized.profiles.find((profile) => profile.profileId === normalized.activeRuleId)
      || normalized.profiles[0];

    if (!targetProfile) {
      setDistributionState((prev) => ({ ...prev, feedback: '未找到可发布的分发规则' }));
      return;
    }

    const targetSummary = computePercentSummary(targetProfile.rule, distributionState.allianceContributionPercent);
    if (targetSummary.total > 100) {
      setDistributionState((prev) => ({
        ...prev,
        feedback: `规则「${targetProfile.name}」总比例 ${targetSummary.total}% 超过 100%，请先调整再发布`
      }));
      return;
    }

    setDistributionState((prev) => ({
      ...prev,
      publishing: true,
      feedback: '',
      error: ''
    }));

    try {
      const response = await fetch(`http://localhost:5000/api/nodes/${node._id}/distribution-settings/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ruleProfileId: targetProfile.profileId,
          executeAt: executeAtDate.toISOString()
        })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDistributionState((prev) => ({
          ...prev,
          publishing: false,
          error: getApiError(parsed, '发布分发计划失败')
        }));
        return;
      }

      setDistributionState((prev) => ({
        ...prev,
        publishing: false,
        feedback: data.message || '分发计划已发布并锁定，不可撤回'
      }));
      setHasUnsavedDistributionDraft(false);
      await fetchDistributionSettings(true, true);
    } catch (error) {
      setDistributionState((prev) => ({
        ...prev,
        publishing: false,
        error: `发布分发计划失败: ${error.message}`
      }));
    }
  };

  // 计算实际的显示透明度（在进度40%后开始淡入，或退出时在60%前淡出完成）
  const displayOpacity = transitionProgress < 0.4
    ? 0
    : Math.min(1, (transitionProgress - 0.4) / 0.5);

  useEffect(() => {
    if (!isVisible || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      setSceneSize({
        width: container.clientWidth,
        height: container.clientHeight
      });
    }

    // 创建渲染器
    rendererRef.current = new KnowledgeDomainRenderer(canvas);
    rendererRef.current.setCameraAngle(cameraAngleRef.current);
    rendererRef.current.setGateVisibility({
      cheng: hasParentEntrance,
      qi: hasChildEntrance
    });
    applyScenePanOffset(scenePanOffsetRef.current);
    rendererRef.current.startRenderLoop();

    // 监听窗口大小变化
    const handleResize = () => {
      if (container && rendererRef.current) {
        rendererRef.current.resize(container.clientWidth, container.clientHeight);
        setSceneSize({
          width: container.clientWidth,
          height: container.clientHeight
        });
        applyScenePanOffset(scenePanOffsetRef.current);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, [isVisible, hasParentEntrance, hasChildEntrance]);

  useEffect(() => {
    if (!isVisible || !node?._id) return;

    setActiveTab('info');
    setSearchKeyword('');
    setSearchResults([]);
    setManageFeedback('');
    setDistributionUserKeyword('');
    setDistributionUserResults([]);
    setDistributionAllianceKeyword('');
    setDistributionAllianceResults([]);
    setIsDistributionRuleModalOpen(false);
    setNewDistributionRuleName('');
    setActiveManageSidePanel(isIntelHeistMode ? '' : 'distribution');
    setIsDomainInfoDockExpanded(false);
    setDistributionState(createDefaultDistributionState());
    setHasUnsavedDistributionDraft(false);
    setDefenseLayoutState(createDefaultDefenseLayoutState());
    setGateDeployState({
      loading: false,
      error: '',
      unitTypes: [],
      roster: [],
      activeGateKey: '',
      draggingUnitTypeId: ''
    });
    closeGateDeployDialog();
    resetIntelHeistState();
    buildingDragRef.current = null;
    scenePanDragRef.current = null;
    setIsScenePanning(false);
    if (cameraAngleAnimRef.current) {
      cancelAnimationFrame(cameraAngleAnimRef.current);
      cameraAngleAnimRef.current = null;
    }
    applyCameraAngle(CITY_CAMERA_DEFAULT_ANGLE_DEG);
    applyScenePanOffset({ x: 0, y: 0 });
    if (!isIntelHeistMode) {
      fetchDomainAdmins(false);
    }
    fetchDefenseLayout(false);
  }, [isVisible, node?._id, isIntelHeistMode]);

  useEffect(() => {
    if (!showManageTab && activeTab === 'manage') {
      setActiveTab('info');
    }
  }, [showManageTab, activeTab]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || !domainAdminState.canEdit) {
      setSearchResults([]);
      return undefined;
    }

    const keyword = searchKeyword.trim();
    if (!keyword) {
      setSearchResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setIsSearchingUsers(true);
      try {
        const response = await fetch(
          `http://localhost:5000/api/nodes/${node._id}/domain-admins/search-users?keyword=${encodeURIComponent(keyword)}`,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setSearchResults([]);
          setManageFeedback(getApiError(parsed, '搜索用户失败'));
          return;
        }
        setSearchResults(data.users || []);
      } catch (error) {
        setSearchResults([]);
        setManageFeedback(`搜索用户失败: ${error.message}`);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 300);

    return () => {
      clearTimeout(timerId);
    };
  }, [activeTab, isVisible, node?._id, searchKeyword, domainAdminState.canEdit]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || hasUnsavedDistributionDraft) return;
    fetchDistributionSettings(false);
  }, [activeTab, isVisible, node?._id, hasUnsavedDistributionDraft]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage') return undefined;
    setDistributionClockMs(Date.now());
    const timerId = setInterval(() => {
      setDistributionClockMs(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [isVisible, activeTab]);

  useEffect(() => {
    if (
      !isVisible ||
      activeTab !== 'manage' ||
      !node?._id ||
      !distributionState.canView ||
      hasUnsavedDistributionDraft ||
      isDistributionRuleModalOpen
    ) return undefined;
    const timerId = setInterval(() => {
      fetchDistributionSettings(true);
    }, 15000);
    return () => clearInterval(timerId);
  }, [activeTab, isVisible, node?._id, distributionState.canView, hasUnsavedDistributionDraft, isDistributionRuleModalOpen]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || !distributionState.canEdit) {
      setDistributionUserResults([]);
      return undefined;
    }
    const keyword = distributionUserKeyword.trim();
    if (!keyword) {
      setDistributionUserResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setDistributionUserSearching(true);
      try {
        const response = await fetch(
          `http://localhost:5000/api/nodes/${node._id}/distribution-settings/search-users?keyword=${encodeURIComponent(keyword)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setDistributionUserResults([]);
          return;
        }
        setDistributionUserResults(data.users || []);
      } catch (error) {
        setDistributionUserResults([]);
      } finally {
        setDistributionUserSearching(false);
      }
    }, 280);

    return () => clearTimeout(timerId);
  }, [activeTab, distributionUserKeyword, distributionState.canEdit, isVisible, node?._id]);

  useEffect(() => {
    if (!isVisible || activeTab !== 'manage' || !node?._id || !distributionState.canEdit) {
      setDistributionAllianceResults([]);
      return undefined;
    }
    const keyword = distributionAllianceKeyword.trim();
    if (!keyword) {
      setDistributionAllianceResults([]);
      return undefined;
    }

    const timerId = setTimeout(async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      setDistributionAllianceSearching(true);
      try {
        const response = await fetch(
          `http://localhost:5000/api/nodes/${node._id}/distribution-settings/search-alliances?keyword=${encodeURIComponent(keyword)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const parsed = await parseApiResponse(response);
        const data = parsed.data;
        if (!response.ok || !data) {
          setDistributionAllianceResults([]);
          return;
        }
        setDistributionAllianceResults(data.alliances || []);
      } catch (error) {
        setDistributionAllianceResults([]);
      } finally {
        setDistributionAllianceSearching(false);
      }
    }, 280);

    return () => clearTimeout(timerId);
  }, [activeTab, distributionAllianceKeyword, distributionState.canEdit, isVisible, node?._id]);

  useEffect(() => {
    if (!isVisible || !defenseLayoutState.canEdit || !defenseLayoutState.buildMode) return;
    fetchGateDeployArmyData();
  }, [isVisible, defenseLayoutState.canEdit, defenseLayoutState.buildMode, node?._id]);

  useEffect(() => {
    if (!isVisible || !defenseLayoutState.draggingBuildingId || !defenseLayoutState.buildMode || !defenseLayoutState.canEdit) {
      return undefined;
    }

    const handlePointerMove = (event) => {
      const draggingId = buildingDragRef.current?.buildingId;
      if (!draggingId) return;
      const nextPosition = getPointerNormPosition(event.clientX, event.clientY);
      if (!nextPosition) return;

      setDefenseLayoutState((prev) => {
        if (!prev.buildMode || !prev.canEdit) return prev;
        const draftBuildings = prev.draftLayout?.buildings || [];
        const target = draftBuildings.find((item) => item.buildingId === draggingId);
        if (!target) return prev;
        const clamped = clampPositionInsideCity(nextPosition);
        if (!isValidPlacement(clamped, draftBuildings, draggingId)) {
          return prev;
        }
        const nextDraftLayout = cloneDefenseLayout(prev.draftLayout);
        nextDraftLayout.buildings = nextDraftLayout.buildings.map((item) => (
          item.buildingId === draggingId
            ? { ...item, x: clamped.x, y: clamped.y }
            : item
        ));
        return {
          ...prev,
          draftLayout: nextDraftLayout,
          selectedBuildingId: draggingId,
          isDirty: true,
          feedback: '',
          error: ''
        };
      });
    };

    const stopDragging = () => {
      buildingDragRef.current = null;
      setDefenseLayoutState((prev) => ({
        ...prev,
        draggingBuildingId: ''
      }));
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [isVisible, defenseLayoutState.draggingBuildingId, defenseLayoutState.buildMode, defenseLayoutState.canEdit]);

  useEffect(() => {
    if (!isVisible || !isScenePanning) return undefined;

    const handlePointerMove = (event) => {
      const dragMeta = scenePanDragRef.current;
      if (!dragMeta) return;
      const dx = event.clientX - dragMeta.startX;
      const dy = event.clientY - dragMeta.startY;
      applyScenePanOffset({
        x: dragMeta.originX + dx,
        y: dragMeta.originY + dy
      });
    };

    const stopPanning = () => {
      const dragMeta = scenePanDragRef.current;
      if (
        dragMeta?.pointerId !== undefined
        && typeof containerRef.current?.releasePointerCapture === 'function'
      ) {
        try {
          containerRef.current.releasePointerCapture(dragMeta.pointerId);
        } catch (e) {
          // ignore capture errors in unsupported environments
        }
      }
      scenePanDragRef.current = null;
      setIsScenePanning(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopPanning);
    window.addEventListener('pointercancel', stopPanning);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopPanning);
      window.removeEventListener('pointercancel', stopPanning);
    };
  }, [isVisible, isScenePanning]);

  useEffect(() => {
    if (!isVisible) {
      if (cameraAngleAnimRef.current) {
        cancelAnimationFrame(cameraAngleAnimRef.current);
        cameraAngleAnimRef.current = null;
      }
      applyCameraAngle(CITY_CAMERA_DEFAULT_ANGLE_DEG);
      return undefined;
    }

    const targetAngle = defenseLayoutState.buildMode
      ? CITY_CAMERA_BUILD_ANGLE_DEG
      : CITY_CAMERA_DEFAULT_ANGLE_DEG;
    const startAngle = cameraAngleRef.current;

    if (Math.abs(startAngle - targetAngle) < 0.05) {
      applyCameraAngle(targetAngle);
      return undefined;
    }

    if (cameraAngleAnimRef.current) {
      cancelAnimationFrame(cameraAngleAnimRef.current);
      cameraAngleAnimRef.current = null;
    }

    const transitionDuration = CITY_CAMERA_TRANSITION_MS;
    const startAt = performance.now();
    const easeInOutCubic = (t) => (
      t < 0.5
        ? (4 * t * t * t)
        : (1 - ((-2 * t + 2) ** 3) / 2)
    );

    const tick = (timestamp) => {
      const progress = Math.max(0, Math.min(1, (timestamp - startAt) / transitionDuration));
      const eased = easeInOutCubic(progress);
      const nextAngle = startAngle + ((targetAngle - startAngle) * eased);
      applyCameraAngle(nextAngle);
      if (progress < 1) {
        cameraAngleAnimRef.current = requestAnimationFrame(tick);
      } else {
        cameraAngleAnimRef.current = null;
        applyCameraAngle(targetAngle);
      }
    };

    cameraAngleAnimRef.current = requestAnimationFrame(tick);

    return () => {
      if (cameraAngleAnimRef.current) {
        cancelAnimationFrame(cameraAngleAnimRef.current);
        cameraAngleAnimRef.current = null;
      }
    };
  }, [defenseLayoutState.buildMode, isVisible]);

  useEffect(() => {
    return () => {
      clearIntelHeistHintTimer();
      intelHeistScanRequestRef.current = '';
      intelHeistPauseStartedAtRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if (!isIntelHeistMode || !intelHeistState.active) {
      intelHeistPauseStartedAtRef.current = 0;
      return;
    }

    if (isIntelHeistExitConfirmOpen) {
      if (!intelHeistPauseStartedAtRef.current) {
        intelHeistPauseStartedAtRef.current = Date.now();
      }
      return;
    }

    if (!intelHeistPauseStartedAtRef.current) return;
    const pauseDelta = Math.max(0, Date.now() - intelHeistPauseStartedAtRef.current);
    intelHeistPauseStartedAtRef.current = 0;
    if (pauseDelta <= 0) return;

    setIntelHeistState((prev) => {
      if (!prev.active) return prev;
      return {
        ...prev,
        deadlineMs: prev.deadlineMs > 0 ? prev.deadlineMs + pauseDelta : prev.deadlineMs,
        searchStartedAtMs: prev.searchStartedAtMs > 0 ? prev.searchStartedAtMs + pauseDelta : prev.searchStartedAtMs
      };
    });
    setIntelHeistClockMs(Date.now());
  }, [isIntelHeistMode, intelHeistState.active, isIntelHeistExitConfirmOpen]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode) {
      resetIntelHeistState();
      return;
    }
    const buildings = Array.isArray(defenseLayoutState.savedLayout?.buildings)
      ? defenseLayoutState.savedLayout.buildings
      : [];
    if (defenseLayoutState.loading || buildings.length === 0) return;
    setIntelHeistState((prev) => {
      if (prev.active && prev.totalMs > 0) return prev;
      const buildingCount = Math.max(1, buildings.length);
      const totalMs = buildingCount <= 1
        ? (INTEL_HEIST_SCAN_MS + INTEL_HEIST_TIMEOUT_BUFFER_MS)
        : (((buildingCount - 1) * INTEL_HEIST_SCAN_MS) + INTEL_HEIST_TIMEOUT_BUFFER_MS);
      return {
        ...prev,
        active: true,
        totalMs,
        deadlineMs: Date.now() + totalMs,
        activeBuildingId: '',
        searchStartedAtMs: 0,
        searchedBuildingIds: [],
        submitting: false,
        hintText: '',
        hintVisible: false,
        resultSnapshot: null,
        resultOpen: false,
        error: '',
        timeoutTriggered: false
      };
    });
    setIntelHeistClockMs(Date.now());
    setIsDomainInfoDockExpanded(false);
    setGateDeployState((prev) => ({
      ...prev,
      activeGateKey: '',
      draggingUnitTypeId: ''
    }));
    setIsDistributionRuleModalOpen(false);
    closeGateDeployDialog();
  }, [isVisible, isIntelHeistMode, node?._id, defenseLayoutState.loading, defenseLayoutState.savedLayout]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode || !intelHeistState.active || isIntelHeistExitConfirmOpen) return undefined;
    const timerId = setInterval(() => {
      setIntelHeistClockMs(Date.now());
    }, 100);
    return () => clearInterval(timerId);
  }, [isVisible, isIntelHeistMode, intelHeistState.active, isIntelHeistExitConfirmOpen]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode || !intelHeistState.activeBuildingId || isIntelHeistExitConfirmOpen) return;
    if (!intelHeistState.searchStartedAtMs || intelHeistState.submitting) return;
    const elapsed = intelHeistClockMs - intelHeistState.searchStartedAtMs;
    if (elapsed < INTEL_HEIST_SCAN_MS) return;
    const targetBuildingId = intelHeistState.activeBuildingId;
    setIntelHeistState((prev) => ({
      ...prev,
      activeBuildingId: '',
      searchStartedAtMs: 0
    }));
    resolveIntelHeistSearch(targetBuildingId);
  }, [
    isVisible,
    isIntelHeistMode,
    isIntelHeistExitConfirmOpen,
    intelHeistClockMs,
    intelHeistState.activeBuildingId,
    intelHeistState.searchStartedAtMs,
    intelHeistState.submitting
  ]);

  useEffect(() => {
    if (!isVisible || !isIntelHeistMode || isIntelHeistExitConfirmOpen) return undefined;
    if (!intelHeistState.active || !intelHeistState.deadlineMs) return undefined;
    if (intelHeistState.resultOpen || intelHeistState.timeoutTriggered) return undefined;
    if (intelHeistClockMs < intelHeistState.deadlineMs) return undefined;
    setIntelHeistState((prev) => ({
      ...prev,
      active: false,
      timeoutTriggered: true,
      activeBuildingId: '',
      searchStartedAtMs: 0,
      submitting: false,
      hintText: '',
      hintVisible: false
    }));
    return undefined;
  }, [
    isVisible,
    isIntelHeistMode,
    isIntelHeistExitConfirmOpen,
    intelHeistClockMs,
    intelHeistState.active,
    intelHeistState.deadlineMs,
    intelHeistState.resultOpen,
    intelHeistState.timeoutTriggered
  ]);

  const normalizedDistributionProfiles = normalizeDistributionProfiles(
    distributionState.ruleProfiles,
    distributionState.activeRuleId,
    distributionState.allianceContributionPercent
  );
  const distributionProfiles = normalizedDistributionProfiles.profiles;
  const activeDistributionRuleId = normalizedDistributionProfiles.activeRuleId;
  const activeDistributionProfile = distributionProfiles.find((profile) => profile.profileId === activeDistributionRuleId) || distributionProfiles[0];
  const publishDistributionProfile = distributionProfiles.find((profile) => profile.profileId === distributionState.publishRuleId)
    || activeDistributionProfile
    || distributionProfiles[0];
  const publishDistributionRuleId = distributionProfiles.some((profile) => profile.profileId === distributionState.publishRuleId)
    ? distributionState.publishRuleId
    : (publishDistributionProfile?.profileId || '');
  const distributionRule = activeDistributionProfile?.rule || createDefaultDistributionRule();
  const hasMasterAlliance = !!distributionState.masterAllianceName;
  const adminPercentMap = new Map(
    (distributionRule.adminPercents || [])
      .filter((item) => item.userId)
      .map((item) => [item.userId, clampPercent(item.percent, 0)])
  );
  const effectiveAdminPercents = (domainAdminState.domainAdmins || []).map((adminUser) => ({
    userId: adminUser._id,
    username: adminUser.username,
    percent: adminPercentMap.get(adminUser._id) || 0
  }));
  const currentPercentSummary = computePercentSummary(distributionRule, distributionState.allianceContributionPercent);
  const scopePercent = getDistributionScopePercent(distributionRule);
  const unallocatedPercent = Math.max(0, 100 - currentPercentSummary.total);

  const lockedDistribution = distributionState.locked || null;
  const lockedExecuteMs = new Date(lockedDistribution?.executeAt || 0).getTime();
  const hasLockedPlan = !!lockedDistribution && Number.isFinite(lockedExecuteMs);
  const hasUpcomingPublishedPlan = hasLockedPlan && lockedExecuteMs > distributionClockMs;
  const countdownSeconds = hasUpcomingPublishedPlan
    ? Math.max(0, Math.floor((lockedExecuteMs - distributionClockMs) / 1000))
    : 0;

  const blockedRuleNotes = [];
  if (!hasMasterAlliance) {
    blockedRuleNotes.push('域主当前未加入熵盟，Z / D / E 与敌对判定已自动禁用');
  } else {
    blockedRuleNotes.push('敌对熵盟成员优先级最高，固定不可获取（0%）');
  }
  blockedRuleNotes.push('黑名单（用户/熵盟）跟随域主，域主变更时将自动重置');

  const conflictMessages = [];
  const blackUserSet = new Set((distributionRule.blacklistUsers || []).map((item) => item.userId).filter(Boolean));
  const blackAllianceSet = new Set((distributionRule.blacklistAlliances || []).map((item) => item.allianceId).filter(Boolean));
  const conflictUsers = (distributionRule.customUserPercents || []).filter((item) => blackUserSet.has(item.userId));
  const conflictAlliances = (distributionRule.specificAlliancePercents || []).filter((item) => blackAllianceSet.has(item.allianceId));
  if (conflictUsers.length > 0) {
    conflictMessages.push(`指定用户与黑名单冲突 ${conflictUsers.length} 项，最终按“禁止”处理`);
  }
  if (conflictAlliances.length > 0) {
    conflictMessages.push(`指定熵盟与黑名单冲突 ${conflictAlliances.length} 项，最终按“禁止”处理`);
  }
  if (currentPercentSummary.total > 100) {
    conflictMessages.push(`总比例超限 ${currentPercentSummary.total.toFixed(2)}%，超出部分不会被允许保存`);
  }

  const activeDefenseLayout = defenseLayoutState.buildMode
    ? defenseLayoutState.draftLayout
    : defenseLayoutState.savedLayout;
  const defenseBuildings = Array.isArray(activeDefenseLayout?.buildings)
    ? activeDefenseLayout.buildings
    : [];
  const defenseMetrics = getCityMetrics(
    sceneSize.width || containerRef.current?.clientWidth || 1280,
    sceneSize.height || containerRef.current?.clientHeight || 720,
    cameraAngleDeg
  );
  const gatePositions = {
    cheng: {
      x: defenseMetrics.centerX,
      y: defenseMetrics.centerY - defenseMetrics.radiusY - 92
    },
    qi: {
      x: defenseMetrics.centerX,
      y: defenseMetrics.centerY + defenseMetrics.radiusY + 92
    }
  };
  const gateTotals = {
    cheng: getGateDefenseTotal(activeDefenseLayout, 'cheng'),
    qi: getGateDefenseTotal(activeDefenseLayout, 'qi')
  };
  const canInspectGateDefense = !!defenseLayoutState.canViewGateDefense;
  const canOpenGateDeployPanel = defenseLayoutState.canEdit || canInspectGateDefense;
  const selectedDefenseBuilding = (defenseLayoutState.buildMode
    ? (defenseLayoutState.draftLayout?.buildings || [])
    : defenseBuildings
  ).find((item) => item.buildingId === defenseLayoutState.selectedBuildingId) || null;
  const canAddDefenseBuilding = (
    defenseLayoutState.canEdit
    && defenseLayoutState.buildMode
    && (defenseLayoutState.draftLayout?.buildings || []).length < defenseLayoutState.maxBuildings
  );
  const masterFromNode = normalizeDomainManagerUser(node?.domainMaster);
  const masterFromAdminState = normalizeDomainManagerUser(domainAdminState.domainMaster);
  const displayMaster = masterFromNode || masterFromAdminState || null;
  const adminSourceList = [];
  if (Array.isArray(node?.domainAdmins)) {
    adminSourceList.push(...node.domainAdmins);
  }
  if (Array.isArray(domainAdminState.domainAdmins)) {
    adminSourceList.push(...domainAdminState.domainAdmins);
  }
  const adminUserMap = new Map();
  adminSourceList.forEach((item) => {
    const normalized = normalizeDomainManagerUser(item);
    if (!normalized) return;
    if (displayMaster && normalized._id === displayMaster._id) return;
    if (!adminUserMap.has(normalized._id)) {
      adminUserMap.set(normalized._id, normalized);
    }
  });
  const displayAdmins = Array.from(adminUserMap.values());
  const gateDefenseViewerIdSet = new Set(
    (domainAdminState.canEdit ? gateDefenseViewerDraftIds : domainAdminState.gateDefenseViewerAdminIds)
      .filter((id) => typeof id === 'string' && id)
  );
  const showDefenseManagerCard = defenseLayoutState.canEdit;
  const displayDefenseBuildings = defenseBuildings.map((building, index) => ({
    ...building,
    ordinal: index + 1,
    isIntel: defenseLayoutState.canEdit && activeDefenseLayout?.intelBuildingId === building.buildingId
  }));
  const armyUnitTypeMap = new Map(
    (Array.isArray(gateDeployState.unitTypes) ? gateDeployState.unitTypes : [])
      .map((unitType) => [unitType?.id || unitType?.unitTypeId, unitType])
      .filter(([id]) => !!id)
  );
  const rosterMap = new Map(
    (Array.isArray(gateDeployState.roster) ? gateDeployState.roster : [])
      .map((entry) => [
        typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
        Math.max(0, Math.floor(Number(entry?.count) || 0))
      ])
      .filter(([id]) => !!id)
  );
  const deployedCounter = getDeployedCountByUnitType(activeDefenseLayout);
  const rosterItems = (Array.isArray(gateDeployState.roster) ? gateDeployState.roster : [])
    .filter((entry) => (Math.max(0, Math.floor(Number(entry?.count) || 0)) > 0))
    .map((entry) => {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '';
      const totalCount = rosterMap.get(unitTypeId) || 0;
      const deployedCount = deployedCounter.get(unitTypeId) || 0;
      return {
        unitTypeId,
        totalCount,
        deployedCount,
        availableCount: Math.max(0, totalCount - deployedCount),
        name: armyUnitTypeMap.get(unitTypeId)?.name || unitTypeId
      };
    })
    .filter((entry) => !!entry.unitTypeId);
  const activeGateKey = gateDeployState.activeGateKey;
  const activeGateEntries = activeGateKey
    ? getGateDefenseEntries(activeDefenseLayout, activeGateKey)
    : [];
  const intelHeistRemainingMs = isIntelHeistMode && intelHeistState.deadlineMs > 0
    ? Math.max(0, intelHeistState.deadlineMs - intelHeistClockMs)
    : 0;
  const intelHeistRemainingRatio = isIntelHeistMode && intelHeistState.totalMs > 0
    ? Math.max(0, Math.min(1, intelHeistRemainingMs / intelHeistState.totalMs))
    : 1;
  const intelHeistActiveSearchRatio = isIntelHeistMode && intelHeistState.activeBuildingId && intelHeistState.searchStartedAtMs > 0
    ? Math.max(0, Math.min(1, 1 - ((intelHeistClockMs - intelHeistState.searchStartedAtMs) / INTEL_HEIST_SCAN_MS)))
    : 1;
  const intelHeistRemainingSeconds = Math.max(0, Math.ceil(intelHeistRemainingMs / 1000));
  const intelHeistCountdownText = formatCountdown(intelHeistRemainingSeconds);
  const showGateLayer = !isIntelHeistMode;
  const showRightDock = !isIntelHeistMode;
  const showBottomExitButton = !isIntelHeistMode;

  if (!isVisible && transitionProgress <= 0) return null;

  return (
    <div
      ref={containerRef}
      className={`knowledge-domain-container ${isScenePanning ? 'is-scene-panning' : ''}`}
      style={{
        opacity: displayOpacity,
        pointerEvents: displayOpacity > 0.5 ? 'auto' : 'none'
      }}
      onPointerDown={handleScenePointerDown}
    >
      <canvas ref={canvasRef} className="knowledge-domain-canvas" />
      {isIntelHeistMode ? (
        <div className="intel-heist-hud">
          <div className="intel-heist-hud-header">
            <strong>情报窃取</strong>
            <span>{`剩余 ${intelHeistCountdownText}`}</span>
          </div>
          <div className="intel-heist-timer-track">
            <span
              className="intel-heist-timer-fill"
              style={{ width: `${Math.max(0, Math.min(100, intelHeistRemainingRatio * 100))}%` }}
            />
          </div>
          <button
            type="button"
            className="intel-heist-exit-btn"
            onClick={requestExitIntelHeistGame}
          >
            退出情报窃取
          </button>
          {intelHeistState.error && <div className="intel-heist-hud-error">{intelHeistState.error}</div>}
        </div>
      ) : (
        <button
          type="button"
          className="domain-return-top-btn"
          onClick={onExit}
          title="返回节点主视角"
          aria-label="返回节点主视角"
        >
          <ArrowLeft size={14} />
          <span>返回节点主视角</span>
        </button>
      )}
      <div
        ref={cityDefenseLayerRef}
        className={`city-defense-layer ${defenseLayoutState.buildMode ? 'build-mode' : ''}`}
      >
        {displayDefenseBuildings.map((building) => {
          const px = defenseMetrics.centerX + building.x * defenseMetrics.radiusX;
          const py = defenseMetrics.centerY + building.y * defenseMetrics.radiusY;
          const radiusPx = Math.max(16, Math.min(36, Math.round(defenseMetrics.radiusY * (building.radius || CITY_BUILDING_DEFAULT_RADIUS))));
          const depthScale = 1 - defenseMetrics.tiltBlend;
          const topHeightPx = Math.max(10, Math.round(radiusPx * (0.6 + (defenseMetrics.tiltBlend * 0.25))));
          const bodyHeightPx = Math.max(4, Math.round(radiusPx * (0.35 + (depthScale * 1.05))));
          const totalHeightPx = bodyHeightPx + topHeightPx;
          const isSelected = defenseLayoutState.selectedBuildingId === building.buildingId;
          const isDragging = defenseLayoutState.draggingBuildingId === building.buildingId;
          const canEditBuilding = defenseLayoutState.canEdit && defenseLayoutState.buildMode;
          const isIntelSearched = (intelHeistState.searchedBuildingIds || []).includes(building.buildingId);
          const isIntelActive = isIntelHeistMode && intelHeistState.activeBuildingId === building.buildingId;
          const intelSearchLocked = isIntelHeistMode && (
            !intelHeistState.active
            || intelHeistState.resultOpen
            || intelHeistState.timeoutTriggered
            || intelHeistState.submitting
            || (!!intelHeistState.activeBuildingId && intelHeistState.activeBuildingId !== building.buildingId)
          );
          const intelBuildingDisabled = isIntelHeistMode && (isIntelSearched || intelSearchLocked);
          return (
            <button
              key={building.buildingId}
              type="button"
              className={`city-defense-building ${building.isIntel ? 'intel' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${canEditBuilding ? 'editable' : ''} ${isIntelHeistMode ? 'intel-heist-searchable' : ''} ${isIntelSearched ? 'searched' : ''} ${isIntelActive ? 'is-searching' : ''}`}
              style={{
                left: `${px - radiusPx}px`,
                top: `${py - totalHeightPx}px`,
                width: `${radiusPx * 2}px`,
                height: `${totalHeightPx}px`,
                '--cylinder-top-height': `${topHeightPx}px`,
                '--cylinder-body-height': `${bodyHeightPx}px`
              }}
              onPointerDown={(event) => {
                if (isIntelHeistMode) {
                  event.stopPropagation();
                  return;
                }
                handleDefenseBuildingPointerDown(event, building.buildingId);
              }}
              onClick={() => {
                if (isIntelHeistMode) {
                  if (intelBuildingDisabled) return;
                  startIntelHeistSearch(building.buildingId);
                  return;
                }
                if (!canEditBuilding) return;
                setDefenseLayoutState((prev) => ({ ...prev, selectedBuildingId: building.buildingId }));
              }}
              disabled={intelBuildingDisabled}
            >
              <span className="city-defense-building-top" />
              <span className="city-defense-building-body" />
              {building.isIntel && <span className="city-defense-intel-badge">情报文件</span>}
              <span className="city-defense-building-label">{building.name || `建筑${building.ordinal}`}</span>
              {isIntelActive && (
                <span className="intel-heist-building-progress">
                  <span
                    className="intel-heist-building-progress-fill"
                    style={{ width: `${Math.max(0, Math.min(100, intelHeistActiveSearchRatio * 100))}%` }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {showGateLayer && (
        <div ref={cityGateLayerRef} className="city-gate-layer">
          {hasParentEntrance && (
            <button
              type="button"
              className={`city-gate-trigger cheng ${canOpenGateDeployPanel ? 'editable' : ''}`}
              style={{
                left: `${gatePositions.cheng.x - 84}px`,
                top: `${gatePositions.cheng.y - 34}px`
              }}
              title={`${CITY_GATE_LABELS.cheng}：${CITY_GATE_TOOLTIPS.cheng}`}
              onClick={() => openGateDeployPanel('cheng')}
              disabled={!canOpenGateDeployPanel}
            >
              <span className="city-gate-name">{CITY_GATE_LABELS.cheng}</span>
              {canInspectGateDefense && (
                <span className="city-gate-total">{`驻防 ${gateTotals.cheng}`}</span>
              )}
            </button>
          )}
          {hasChildEntrance && (
            <button
              type="button"
              className={`city-gate-trigger qi ${canOpenGateDeployPanel ? 'editable' : ''}`}
              style={{
                left: `${gatePositions.qi.x - 84}px`,
                top: `${gatePositions.qi.y - 34}px`
              }}
              title={`${CITY_GATE_LABELS.qi}：${CITY_GATE_TOOLTIPS.qi}`}
              onClick={() => openGateDeployPanel('qi')}
              disabled={!canOpenGateDeployPanel}
            >
              <span className="city-gate-name">{CITY_GATE_LABELS.qi}</span>
              {canInspectGateDefense && (
                <span className="city-gate-total">{`驻防 ${gateTotals.qi}`}</span>
              )}
            </button>
          )}
        </div>
      )}
      {showGateLayer && canOpenGateDeployPanel && canInspectGateDefense && activeGateKey && (
        <div className="gate-deploy-panel">
          <div className="gate-deploy-header">
            <strong>{`${CITY_GATE_LABELS[activeGateKey]}布防`}</strong>
            <button
              type="button"
              className="btn btn-small btn-secondary"
              onClick={() => {
                setGateDeployState((prev) => ({ ...prev, activeGateKey: '' }));
                closeGateDeployDialog();
              }}
            >
              关闭
            </button>
          </div>
          <div className="domain-manage-tip">{CITY_GATE_TOOLTIPS[activeGateKey]}</div>
          {defenseLayoutState.canEdit && defenseLayoutState.buildMode ? (
            <>
              {gateDeployState.loading && <div className="domain-manage-tip">加载兵力中...</div>}
              {gateDeployState.error && <div className="domain-manage-error">{gateDeployState.error}</div>}
              {!gateDeployState.loading && (
                <>
                  <div
                    className="gate-deploy-dropzone"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const unitTypeId = event.dataTransfer.getData('text/plain');
                      handleGateDeployDrop(activeGateKey, unitTypeId);
                      setGateDeployState((prev) => ({ ...prev, draggingUnitTypeId: '' }));
                    }}
                  >
                    将兵种卡拖到此处进行派遣
                  </div>
                  <div className="gate-deploy-section-title">当前布防</div>
                  <div className="gate-deploy-current-list">
                    {activeGateEntries.length === 0 ? (
                      <div className="domain-manage-tip">当前无驻防兵力</div>
                    ) : activeGateEntries.map((entry) => (
                      <div key={entry.unitTypeId} className="gate-deploy-current-row">
                        <span>{armyUnitTypeMap.get(entry.unitTypeId)?.name || entry.unitTypeId}</span>
                        <strong>{entry.count}</strong>
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => removeGateDefenseUnit(activeGateKey, entry.unitTypeId)}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="gate-deploy-section-title">我的兵力（可拖拽）</div>
                  <div className="gate-deploy-roster-list">
                    {rosterItems.length === 0 ? (
                      <div className="domain-manage-tip">你当前没有可布防兵力</div>
                    ) : rosterItems.map((item) => (
                      <div
                        key={item.unitTypeId}
                        className={`gate-deploy-roster-card ${item.availableCount > 0 ? 'draggable' : 'disabled'} ${gateDeployState.draggingUnitTypeId === item.unitTypeId ? 'dragging' : ''}`}
                        draggable={item.availableCount > 0}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', item.unitTypeId);
                          setGateDeployState((prev) => ({ ...prev, draggingUnitTypeId: item.unitTypeId }));
                        }}
                        onDragEnd={() => setGateDeployState((prev) => ({ ...prev, draggingUnitTypeId: '' }))}
                      >
                        <span>{item.name}</span>
                        <em>{`总 ${item.totalCount} / 已派 ${item.deployedCount} / 可用 ${item.availableCount}`}</em>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="domain-manage-tip">仅可查看承口/启口驻防配置，不可编辑。</div>
              <div className="gate-deploy-section-title">当前布防</div>
              <div className="gate-deploy-current-list">
                {activeGateEntries.length === 0 ? (
                  <div className="domain-manage-tip">当前无驻防兵力</div>
                ) : activeGateEntries.map((entry) => (
                  <div key={entry.unitTypeId} className="gate-deploy-current-row">
                    <span>{armyUnitTypeMap.get(entry.unitTypeId)?.name || entry.unitTypeId}</span>
                    <strong>{entry.count}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showRightDock && (
      <div className={`domain-right-dock ${isDomainInfoDockExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="domain-info-panel">
        <div className="domain-tabs">
          <button
            type="button"
            className={`domain-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => setActiveTab('info')}
          >
            知识域信息
          </button>
          {showManageTab && (
            <button
              type="button"
              className={`domain-tab-btn ${activeTab === 'manage' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('manage');
                fetchDomainAdmins(false);
                fetchDistributionSettings(false);
              }}
            >
              管理知识域
            </button>
          )}
        </div>

        {activeTab === 'info' || !showManageTab ? (
          <div className="domain-tab-content">
            <h2 className="domain-title">{node?.name || '知识域'}</h2>
            <p className="domain-description">{node?.description || ''}</p>
            <div className="domain-stats">
              <div className="stat-item">
                <span className="stat-label">知识点</span>
                <span className="stat-value">{node?.knowledgePoint?.value?.toFixed(2) || '0.00'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">内容分数</span>
                <span className="stat-value">{node?.contentScore || 1}</span>
              </div>
            </div>
            <div className="domain-managers-card">
              <div className="domain-manager-section">
                <div className="domain-admins-subtitle">域主</div>
                <div className="domain-manager-avatar-row">
                  {displayMaster ? (
                    <div className="domain-manager-avatar-item master" title={`域主：${displayMaster.username || '未命名用户'}`}>
                      <img
                        src={avatarMap[displayMaster.avatar] || defaultMale1}
                        alt={displayMaster.username || '域主'}
                        className="domain-manager-avatar-img"
                      />
                      <span className="domain-manager-name">{displayMaster.username || '未设置域主'}</span>
                    </div>
                  ) : (
                    <div className="domain-manage-tip">暂无域主信息</div>
                  )}
                </div>
              </div>
              <div className="domain-manager-section">
                <div className="domain-admins-subtitle">域相</div>
                <div className="domain-manager-avatar-row admins">
                  {displayAdmins.length > 0 ? displayAdmins.map((adminUser) => (
                    <div key={adminUser._id} className="domain-manager-avatar-item" title={`域相：${adminUser.username || '未命名用户'}`}>
                      <img
                        src={avatarMap[adminUser.avatar] || defaultMale1}
                        alt={adminUser.username || '域相'}
                        className="domain-manager-avatar-img"
                      />
                      <span className="domain-manager-name">{adminUser.username || '未命名'}</span>
                    </div>
                  )) : (
                    <div className="domain-manage-tip">暂无域相</div>
                  )}
                </div>
              </div>
            </div>

            {showDefenseManagerCard && (
              <div className="domain-defense-card">
                <div className="domain-admins-subtitle">城区守备建筑</div>
                {defenseLayoutState.loading && <div className="domain-manage-tip">加载城防配置中...</div>}
                {!defenseLayoutState.loading && (
                  <div className="domain-manage-tip">
                    当前建筑 {defenseBuildings.length} / {defenseLayoutState.maxBuildings}
                  </div>
                )}
                {defenseLayoutState.buildMode && (
                  <div className="domain-manage-tip">
                    点击城区上方承口或下方启口，可打开布防面板并拖拽兵力进行派遣
                  </div>
                )}
                {defenseLayoutState.error && <div className="domain-manage-error">{defenseLayoutState.error}</div>}
                {defenseLayoutState.feedback && <div className="domain-manage-feedback">{defenseLayoutState.feedback}</div>}
                <div className="domain-defense-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    onClick={toggleBuildMode}
                  >
                    {defenseLayoutState.buildMode ? '退出建造模式' : '建造'}
                  </button>
                  {defenseLayoutState.buildMode && (
                    <>
                      <button
                        type="button"
                        className="btn btn-small btn-success"
                        onClick={addDefenseBuilding}
                        disabled={!canAddDefenseBuilding}
                      >
                        新增建筑
                      </button>
                      <button
                        type="button"
                        className="btn btn-small btn-warning"
                        onClick={saveDefenseLayout}
                        disabled={defenseLayoutState.saving}
                      >
                        {defenseLayoutState.saving ? '保存中...' : '保存配置'}
                      </button>
                    </>
                  )}
                </div>

                {defenseLayoutState.buildMode && selectedDefenseBuilding && (
                  <div className="domain-defense-selected-card">
                    <div className="domain-manage-tip">
                      当前选中：{selectedDefenseBuilding.name || '未命名建筑'}
                    </div>
                    <div className="domain-defense-actions">
                      <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={setIntelOnSelectedBuilding}
                      >
                        存放情报文件
                      </button>
                      <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={removeSelectedDefenseBuilding}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="domain-tab-content manage-tab-content">
            <h3 className="domain-manage-title">知识域域相</h3>

            {domainAdminState.loading && <div className="domain-manage-tip">加载中...</div>}
            {!domainAdminState.loading && domainAdminState.error && (
              <div className="domain-manage-error">{domainAdminState.error}</div>
            )}

            {!domainAdminState.loading && !domainAdminState.error && !domainAdminState.canView && (
              <div className="domain-manage-tip">你没有权限查看该知识域域相列表</div>
            )}

            {domainAdminState.canView && (
              <>
                {manageFeedback && <div className="domain-manage-feedback">{manageFeedback}</div>}

                <div className="manage-edge-shell">
                  <div className="manage-edge-tabs">
                    <button
                      type="button"
                      className={`manage-edge-tab ${activeManageSidePanel === 'admins' ? 'active' : ''}`}
                      onClick={() => toggleManageSidePanel('admins')}
                    >
                      域相管理
                    </button>
                    <button
                      type="button"
                      className={`manage-edge-tab ${activeManageSidePanel === 'distribution' ? 'active' : ''}`}
                      onClick={() => toggleManageSidePanel('distribution')}
                    >
                      知识点分发
                    </button>
                  </div>

                  <div className={`manage-edge-panel ${activeManageSidePanel ? 'open' : 'collapsed'}`}>
                    {!activeManageSidePanel && (
                      <div className="domain-manage-tip">点击左侧标签可展开对应管理面板，再次点击同标签可收回。</div>
                    )}

                    {activeManageSidePanel === 'admins' && (
                      <div className="manage-edge-panel-body">
                        <div className="domain-admins-section">
                          <div className="domain-admins-subtitle">域主</div>
                          <div className="domain-admin-row domain-master-row">
                            <span className="domain-admin-name">{domainAdminState.domainMaster?.username || '未设置'}</span>
                            <span className="domain-admin-badge master">域主</span>
                          </div>
                        </div>

                        <div className="domain-admins-section">
                          <div className="domain-admins-subtitle">域相列表</div>
                          {domainAdminState.domainAdmins.length === 0 && (!domainAdminState.pendingInvites || domainAdminState.pendingInvites.length === 0) ? (
                            <div className="domain-manage-tip">当前暂无其他域相</div>
                          ) : (
                            <div className="domain-admin-list">
                              {domainAdminState.domainAdmins.map((adminUser) => (
                                <div key={adminUser._id} className="domain-admin-row">
                                  {domainAdminState.canEdit ? (
                                    <label className="domain-admin-viewer-toggle">
                                      <input
                                        type="checkbox"
                                        checked={gateDefenseViewerIdSet.has(adminUser._id)}
                                        onChange={() => toggleGateDefenseViewerAdmin(adminUser._id)}
                                      />
                                      <span className="domain-admin-name">{adminUser.username}</span>
                                    </label>
                                  ) : (
                                    <span className="domain-admin-name">{adminUser.username}</span>
                                  )}
                                  {domainAdminState.canEdit ? (
                                    <div className="domain-admin-row-actions">
                                      {gateDefenseViewerIdSet.has(adminUser._id) && (
                                        <span className="domain-admin-badge readonly">可查看承口/启口</span>
                                      )}
                                      <button
                                        type="button"
                                        className="btn btn-small btn-danger"
                                        onClick={() => removeDomainAdmin(adminUser._id)}
                                        disabled={removingAdminId === adminUser._id}
                                      >
                                        {removingAdminId === adminUser._id ? '移除中...' : '移除'}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="domain-admin-badge readonly">
                                      {gateDefenseViewerIdSet.has(adminUser._id) ? '可查看承口/启口' : '仅查看'}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {domainAdminState.canEdit && (domainAdminState.pendingInvites || []).map((pendingItem) => (
                                <div key={pendingItem.notificationId} className="domain-admin-row pending">
                                  <span className="domain-admin-name pending">{pendingItem.username}</span>
                                  <div className="domain-admin-pending-actions">
                                    <span className="domain-admin-badge pending">邀请中</span>
                                    <button
                                      type="button"
                                      className="btn btn-small btn-secondary"
                                      onClick={() => revokeDomainAdminInvite(pendingItem.notificationId)}
                                      disabled={revokingInviteId === pendingItem.notificationId}
                                    >
                                      {revokingInviteId === pendingItem.notificationId ? '撤销中...' : '撤销邀请'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {domainAdminState.canEdit && (domainAdminState.pendingInvites || []).length > 0 && (
                            <div className="domain-manage-tip">灰色名称为内部待确认邀请，仅域主可见。</div>
                          )}
                          {domainAdminState.canEdit && domainAdminState.domainAdmins.length > 0 && (
                            <div className="domain-admin-permission-actions">
                              <div className="domain-manage-tip">勾选域相可授予“承口/启口兵力可查看权限”（仅查看，不可编辑）。</div>
                              <button
                                type="button"
                                className="btn btn-small btn-primary"
                                onClick={saveGateDefenseViewerPermissions}
                                disabled={!gateDefenseViewerDirty || isSavingGateDefenseViewerPerms}
                              >
                                {isSavingGateDefenseViewerPerms ? '保存中...' : '保存查看权限'}
                              </button>
                            </div>
                          )}
                        </div>

                        {domainAdminState.canEdit ? (
                          <div className="domain-admin-invite">
                            <div className="domain-admins-subtitle">邀请普通用户成为域相</div>
                            <input
                              type="text"
                              className="domain-admin-search-input"
                              placeholder="输入用户名自动搜索"
                              value={searchKeyword}
                              onChange={(e) => {
                                setSearchKeyword(e.target.value);
                                setManageFeedback('');
                              }}
                            />
                            {isSearchingUsers && <div className="domain-manage-tip">搜索中...</div>}
                            {!isSearchingUsers && searchKeyword.trim() && (
                              <div className="domain-search-results">
                                {searchResults.length > 0 ? (
                                  searchResults.map((userItem) => (
                                    <div key={userItem._id} className="domain-search-row">
                                      <span className="domain-admin-name">{userItem.username}</span>
                                      <button
                                        type="button"
                                        className="btn btn-small btn-success"
                                        onClick={() => inviteDomainAdmin(userItem.username)}
                                        disabled={invitingUsername === userItem.username}
                                      >
                                        {invitingUsername === userItem.username ? '邀请中...' : '邀请'}
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <div className="domain-manage-tip">没有匹配的普通用户</div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="domain-admin-invite">
                            <div className="domain-manage-tip">
                              {domainAdminState.isSystemAdmin
                                ? '你是系统管理员，可查看但不可编辑域相名单'
                                : '你当前可查看域相名单，编辑权限仅域主拥有'}
                            </div>
                            {domainAdminState.canResign && (
                              <button
                                type="button"
                                className="btn btn-small btn-warning"
                                onClick={applyResignDomainAdmin}
                                disabled={isSubmittingResign || domainAdminState.resignPending}
                              >
                                {domainAdminState.resignPending
                                  ? '卸任申请待处理'
                                  : (isSubmittingResign ? '提交中...' : '申请卸任域相')}
                              </button>
                            )}
                            {domainAdminState.resignPending && (
                              <div className="domain-manage-tip">已提交卸任申请，等待域主处理（3天超时自动同意）</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {activeManageSidePanel === 'distribution' && (
                      <div className="manage-edge-panel-body">
                        <div className="domain-distribution-section">
                  <div className="domain-admins-subtitle">知识点分发规则</div>
                  {distributionState.loading && <div className="domain-manage-tip">加载分发规则中...</div>}
                  {!distributionState.loading && distributionState.error && (
                    <div className="domain-manage-error">{distributionState.error}</div>
                  )}
                  {!distributionState.loading && !distributionState.error && (
                    <>
                      {(distributionState.feedback || distributionState.isRuleLocked) && (
                        <div className="domain-manage-feedback">
                          {distributionState.feedback || '当前存在已发布分发计划：发布后不可撤回，本次分发使用发布时快照规则。'}
                        </div>
                      )}
                      <div className="distribution-summary-grid">
                        <div className="distribution-summary-item">
                          <span>盟贡献同步比例</span>
                          <strong>{distributionState.allianceContributionPercent.toFixed(2)}%</strong>
                        </div>
                        <div className="distribution-summary-item">
                          <span>总比例</span>
                          <strong className={currentPercentSummary.total > 100 ? 'distribution-over-limit' : ''}>
                            {currentPercentSummary.total.toFixed(2)}%
                          </strong>
                        </div>
                      </div>
                      <div className="domain-manage-tip">
                        比例汇总：域主 {currentPercentSummary.x}% / 域内成员总池 {currentPercentSummary.y}% / 盟贡献 {currentPercentSummary.z}% /
                        指定用户 {currentPercentSummary.b}% / 非敌对熵盟总池 {currentPercentSummary.d}% / 指定熵盟总池 {currentPercentSummary.e}% /
                        无熵盟用户总池 {currentPercentSummary.f}%
                      </div>
                      <div className="domain-manage-tip">
                        {distributionState.masterAllianceName
                          ? `域主所在熵盟：${distributionState.masterAllianceName}`
                          : '域主当前不在熵盟，盟贡献同步比例固定为 0'}
                      </div>

                      {distributionState.canEdit ? (
                        <div className="distribution-editor">
                          <div className="distribution-rule-toolbar">
                            <div className="domain-manage-tip">
                              当前编辑规则：{activeDistributionProfile?.name || '默认规则'}（共 {distributionProfiles.length} 套）
                            </div>
                              <button
                                type="button"
                                className="btn btn-small btn-primary"
                                onClick={() => setIsDistributionRuleModalOpen(true)}
                                disabled={hasLockedPlan}
                              >
                                {hasLockedPlan ? '规则锁定中' : '打开分发规则工作台'}
                              </button>
                          </div>

                          <div className="distribution-subblock distribution-publish-panel">
                            <div className="distribution-subtitle">分发发布流程：选规则 -> 设时间 -> 发布（发布后不可撤回）</div>
                            <div className="distribution-publish-row">
                              <label>发布规则</label>
                              <select
                                value={publishDistributionRuleId}
                                onChange={(e) => setDistributionState((prev) => ({
                                  ...prev,
                                  publishRuleId: e.target.value,
                                  feedback: ''
                                }))}
                                disabled={hasLockedPlan || distributionState.publishing}
                              >
                                {distributionProfiles.map((profile) => (
                                  <option key={profile.profileId} value={profile.profileId}>{profile.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="distribution-publish-row">
                              <label>执行时间（整点）</label>
                              <input
                                type="datetime-local"
                                step="3600"
                                value={distributionState.publishExecuteAt || ''}
                                onChange={(e) => setDistributionState((prev) => ({
                                  ...prev,
                                  publishExecuteAt: e.target.value,
                                  feedback: ''
                                }))}
                                disabled={hasLockedPlan || distributionState.publishing}
                              />
                            </div>
                            <div className="distribution-publish-actions">
                              <button
                                type="button"
                                className="btn btn-small btn-success"
                                onClick={publishDistributionPlan}
                                disabled={hasLockedPlan || distributionState.publishing}
                              >
                                {distributionState.publishing ? '发布中...' : '发布分发计划'}
                              </button>
                              {publishDistributionProfile && (
                                <div className="domain-manage-tip">
                                  选中规则：{publishDistributionProfile.name}
                                </div>
                              )}
                            </div>
                            {hasUpcomingPublishedPlan ? (
                              <div className="distribution-countdown">
                                <strong>
                                  距离执行：{formatCountdown(countdownSeconds)}
                                </strong>
                                <span>
                                  执行时刻：{new Date(lockedExecuteMs).toLocaleString('zh-CN', { hour12: false })}
                                </span>
                                <span>执行时按当刻知识点总池结算（规则仅定义比例，不预显示点数）</span>
                              </div>
                            ) : hasLockedPlan ? (
                              <div className="domain-manage-tip">分发计划已到执行时刻，正在等待系统结算。</div>
                            ) : (
                              <div className="domain-manage-tip">当前未发布分发计划，可设置执行时刻后发布。</div>
                            )}
                          </div>

                          <div className="distribution-summary-grid distribution-summary-grid-wide">
                            <div className="distribution-summary-item">
                              <span>分发范围</span>
                              <strong>{distributionRule.distributionScope === 'partial' ? `部分 ${scopePercent.toFixed(2)}%` : '全部 100%'}</strong>
                            </div>
                            <div className="distribution-summary-item">
                              <span>未分配比例</span>
                              <strong>{unallocatedPercent.toFixed(2)}%</strong>
                            </div>
                            <div className="distribution-summary-item">
                              <span>结转规则</span>
                              <strong>未分配比例自动结转</strong>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="domain-manage-tip">你可以查看分发汇总，但仅域主可编辑分发规则。</div>
                      )}
                    </>
                  )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        </div>
      <button
        type="button"
        className="domain-right-dock-toggle"
          onClick={() => setIsDomainInfoDockExpanded((prev) => !prev)}
          aria-label={isDomainInfoDockExpanded ? '收起知识域面板' : '展开知识域面板'}
          title={isDomainInfoDockExpanded ? '收起知识域面板' : '展开知识域面板'}
        >
          <Info size={16} />
          <span className="domain-right-dock-label">知识域</span>
          {isDomainInfoDockExpanded ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      )}

      {showGateLayer && (
      <NumberPadDialog
        open={gateDeployDialogState.open}
        title={gateDeployDialogState.unitName ? `派遣「${gateDeployDialogState.unitName}」` : '派遣兵力'}
        description={`${CITY_GATE_LABELS[gateDeployDialogState.gateKey] || '口位'} 可用兵力 ${Math.max(1, Math.floor(Number(gateDeployDialogState.max) || 1))}`}
        min={1}
        max={Math.max(1, Math.floor(Number(gateDeployDialogState.max) || 1))}
        initialValue={1}
        confirmLabel="确认派遣"
        cancelLabel="取消"
        onCancel={closeGateDeployDialog}
        onConfirm={confirmGateDeployQuantity}
      />
      )}

      {isIntelHeistMode && (
        <>
          {isIntelHeistExitConfirmOpen && (
            <div
              className="intel-heist-exit-confirm-overlay"
              onClick={() => setIsIntelHeistExitConfirmOpen(false)}
            >
              <div
                className="intel-heist-exit-confirm-card"
                onClick={(event) => event.stopPropagation()}
              >
                <h3>提前结束情报窃取？</h3>
                <p>结束后将返回节点主视角，本次未完成搜索不会保留。</p>
                <div className="intel-heist-exit-confirm-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={cancelExitIntelHeistGame}
                  >
                    继续窃取
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => {
                      setIsIntelHeistExitConfirmOpen(false);
                      exitIntelHeistGame();
                    }}
                  >
                    确认结束
                  </button>
                </div>
              </div>
            </div>
          )}
          {intelHeistState.timeoutTriggered && !intelHeistState.resultOpen && (
            <div className="intel-heist-timeout-overlay">
              <div className="intel-heist-timeout-card">
                <h3>窃取行动失败</h3>
                <p>时间耗尽，未获得情报文件。</p>
                <div className="intel-heist-timeout-actions">
                  <button type="button" className="btn btn-small btn-primary" onClick={() => exitIntelHeistGame()}>
                    返回节点主视角
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className={`intel-heist-hint ${intelHeistState.hintVisible && intelHeistState.hintText ? 'visible' : ''}`}>
            {intelHeistState.hintText || ''}
          </div>
          {intelHeistState.resultOpen && intelHeistState.resultSnapshot && (
            <div className="intel-heist-result-overlay">
              <div className="intel-heist-result-card">
                <h3>{`已找到 ${node?.name || '该知识域'} 的情报文件`}</h3>
                <p>{`布防情报：${formatElapsedMinutesText(intelHeistState.resultSnapshot.deploymentUpdatedAt)}执行的部署`}</p>
                <div className="intel-heist-result-gates">
                  <div className="intel-heist-result-gate">
                    <strong>承口</strong>
                    {(intelHeistState.resultSnapshot?.gateDefense?.cheng || []).length > 0 ? (
                      (intelHeistState.resultSnapshot.gateDefense.cheng || []).map((entry) => (
                        <span key={`intel-result-cheng-${entry.unitTypeId}`}>
                          {`${entry.unitName || entry.unitTypeId} x ${entry.count}`}
                        </span>
                      ))
                    ) : (
                      <span>暂无驻防</span>
                    )}
                  </div>
                  <div className="intel-heist-result-gate">
                    <strong>启口</strong>
                    {(intelHeistState.resultSnapshot?.gateDefense?.qi || []).length > 0 ? (
                      (intelHeistState.resultSnapshot.gateDefense.qi || []).map((entry) => (
                        <span key={`intel-result-qi-${entry.unitTypeId}`}>
                          {`${entry.unitName || entry.unitTypeId} x ${entry.count}`}
                        </span>
                      ))
                    ) : (
                      <span>暂无驻防</span>
                    )}
                  </div>
                </div>
                <div className="intel-heist-result-actions">
                  <button type="button" className="btn btn-small btn-primary" onClick={() => exitIntelHeistGame()}>
                    返回节点主视角
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showRightDock && isDistributionRuleModalOpen && distributionState.canEdit && createPortal(
          <div
            className="distribution-rule-modal-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setIsDistributionRuleModalOpen(false);
              }
            }}
          >
            <div className="distribution-rule-modal">
              <div className="distribution-rule-modal-header">
                <strong>知识域知识点分发规则工作台</strong>
                <div className="distribution-modal-header-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    onClick={saveDistributionSettings}
                    disabled={distributionState.saving}
                  >
                    {distributionState.saving ? '保存中...' : '保存规则配置'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-secondary"
                    onClick={() => setIsDistributionRuleModalOpen(false)}
                  >
                    关闭
                  </button>
                </div>
              </div>
              <div className="distribution-rule-modal-body">
                <div className="distribution-rule-sidebar">
                  <div className="distribution-subtitle">规则列表</div>
                  <div className="distribution-rule-list">
                    {distributionProfiles.map((profile) => (
                      <button
                        key={profile.profileId}
                        type="button"
                        className={`distribution-rule-list-item ${profile.profileId === activeDistributionRuleId ? 'active' : ''}`}
                        onClick={() => setActiveDistributionRule(profile.profileId)}
                      >
                        <span>{profile.name}</span>
                        {profile.profileId === activeDistributionRuleId ? <em>当前编辑</em> : null}
                      </button>
                    ))}
                  </div>
                  <div className="distribution-rule-create">
                    <input
                      type="text"
                      className="domain-admin-search-input"
                      placeholder="输入新规则名称"
                      value={newDistributionRuleName}
                      onChange={(e) => setNewDistributionRuleName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-small btn-success"
                      onClick={createDistributionRuleProfileItem}
                    >
                      新建规则
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={removeActiveDistributionRule}
                      disabled={distributionProfiles.length <= 1}
                    >
                      删除当前规则
                    </button>
                  </div>
                </div>

                <div className="distribution-rule-main">

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">分发范围</div>
                    <div className="distribution-input-row">
                      <span>范围模式</span>
                      <select
                        value={distributionRule.distributionScope === 'partial' ? 'partial' : 'all'}
                        onChange={(e) => updateDistributionRule((prev) => ({
                          ...prev,
                          distributionScope: e.target.value === 'partial' ? 'partial' : 'all'
                        }))}
                      >
                        {DISTRIBUTION_SCOPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    {distributionRule.distributionScope === 'partial' && (
                      <div className="distribution-input-row">
                        <span>部分分发比例</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={scopePercent}
                          onChange={(e) => updateDistributionRule((prev) => ({
                            ...prev,
                            distributionPercent: clampPercent(e.target.value, 100)
                          }))}
                        />
                      </div>
                    )}
                    <div className="distribution-progress-wrap">
                      <div className="distribution-progress-track">
                        <div
                          className="distribution-progress-fill scope"
                          style={{ width: `${Math.max(0, Math.min(100, scopePercent))}%` }}
                        />
                      </div>
                      <span>{`本次参与分发比例：${scopePercent.toFixed(2)}%`}</span>
                    </div>
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">规则名称</div>
                    <div className="distribution-input-row">
                      <span>规则名称</span>
                      <input
                        type="text"
                        value={activeDistributionProfile?.name || ''}
                        onChange={(e) => updateActiveDistributionRuleName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="distribution-input-row">
                    <span>域主分配比例</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={distributionRule.masterPercent}
                      onChange={(e) => updateDistributionRule((prev) => ({ ...prev, masterPercent: clampPercent(e.target.value, 10) }))}
                    />
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">固定规则说明</div>
                    <div className="distribution-fixed-row">
                      <span>固定规则：盟贡献同步比例</span>
                      <strong>{distributionState.allianceContributionPercent.toFixed(2)}%</strong>
                      <em>{hasMasterAlliance ? `同步自熵盟「${distributionState.masterAllianceName}」` : '域主未加入熵盟，固定为 0'}</em>
                    </div>
                    <div className="distribution-fixed-row danger">
                      <span>规则 4：敌对熵盟成员</span>
                      <strong>0%</strong>
                      <em>{hasMasterAlliance ? '系统自动判定，优先级最高，不可更改' : '无熵盟时不触发敌对判定'}</em>
                    </div>
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">域内成员分配总池（当前 {currentPercentSummary.y.toFixed(2)}%）</div>
                    {effectiveAdminPercents.length === 0 ? (
                      <div className="domain-manage-tip">当前无域相可配置</div>
                    ) : effectiveAdminPercents.map((adminItem) => (
                      <div key={adminItem.userId} className="distribution-input-row">
                        <span>{adminItem.username}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={adminItem.percent}
                          onChange={(e) => {
                            const nextPercent = clampPercent(e.target.value, 0);
                            updateDistributionRule((prev) => {
                              const nextList = (prev.adminPercents || []).filter((item) => item.userId !== adminItem.userId);
                              if (nextPercent > 0) {
                                nextList.push({
                                  userId: adminItem.userId,
                                  username: adminItem.username,
                                  percent: nextPercent
                                });
                              }
                              return { ...prev, adminPercents: nextList };
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">指定用户分配比例与用户黑名单</div>
                    <div className="domain-manage-tip">黑名单跟随域主，域主变更时会自动重置</div>
                    <input
                      type="text"
                      className="domain-admin-search-input"
                      placeholder="搜索用户后加入指定比例或黑名单"
                      value={distributionUserKeyword}
                      onChange={(e) => setDistributionUserKeyword(e.target.value)}
                    />
                    {distributionUserSearching && <div className="domain-manage-tip">搜索中...</div>}
                    {!distributionUserSearching && distributionUserKeyword.trim() && (
                      <div className="domain-search-results">
                        {distributionUserResults.length === 0 ? (
                          <div className="domain-manage-tip">没有匹配用户</div>
                        ) : distributionUserResults.map((userItem) => (
                          <div key={userItem._id} className="domain-search-row">
                            <span className="domain-admin-name">{userItem.username}</span>
                            <div className="distribution-row-actions">
                              <button
                                type="button"
                                className="btn btn-small btn-success"
                                onClick={() => updateDistributionRule((prev) => {
                                  if ((prev.customUserPercents || []).some((item) => item.userId === userItem._id)) {
                                    return prev;
                                  }
                                  return {
                                    ...prev,
                                    customUserPercents: [...(prev.customUserPercents || []), {
                                      userId: userItem._id,
                                      username: userItem.username,
                                      percent: 0
                                    }]
                                  };
                                })}
                              >
                                加入指定用户池
                              </button>
                              <button
                                type="button"
                                className="btn btn-small btn-danger"
                                onClick={() => updateDistributionRule((prev) => {
                                  if ((prev.blacklistUsers || []).some((item) => item.userId === userItem._id)) {
                                    return prev;
                                  }
                                  return {
                                    ...prev,
                                    blacklistUsers: [...(prev.blacklistUsers || []), {
                                      userId: userItem._id,
                                      username: userItem.username
                                    }]
                                  };
                                })}
                              >
                                加黑
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(distributionRule.customUserPercents || []).map((item) => (
                      <div key={item.userId} className="distribution-input-row">
                        <span>{item.username || item.userId}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={item.percent}
                          onChange={(e) => {
                            const nextPercent = clampPercent(e.target.value, 0);
                            updateDistributionRule((prev) => ({
                              ...prev,
                              customUserPercents: (prev.customUserPercents || []).map((row) => (
                                row.userId === item.userId ? { ...row, percent: nextPercent } : row
                              ))
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            customUserPercents: (prev.customUserPercents || []).filter((row) => row.userId !== item.userId)
                          }))}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    {(distributionRule.blacklistUsers || []).map((item) => (
                      <div key={item.userId} className="distribution-tag-row danger">
                        <span>{item.username || item.userId}</span>
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            blacklistUsers: (prev.blacklistUsers || []).filter((row) => row.userId !== item.userId)
                          }))}
                        >
                          取消黑名单
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-input-row">
                      <span>非敌对熵盟成员分配总池</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={distributionRule.nonHostileAlliancePercent}
                        disabled={!hasMasterAlliance}
                        onChange={(e) => updateDistributionRule((prev) => ({ ...prev, nonHostileAlliancePercent: clampPercent(e.target.value, 0) }))}
                      />
                    </div>
                    {!hasMasterAlliance && (
                      <div className="domain-manage-tip">域主未加入熵盟，非敌对熵盟相关分配已禁用</div>
                    )}
                    <div className="distribution-input-row">
                      <span>无熵盟用户分配总池</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={distributionRule.noAlliancePercent}
                        onChange={(e) => updateDistributionRule((prev) => ({ ...prev, noAlliancePercent: clampPercent(e.target.value, 0) }))}
                      />
                    </div>
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">指定熵盟成员分配池与熵盟黑名单</div>
                    <div className="domain-manage-tip">熵盟黑名单同样跟随域主，和允许池冲突时按“禁止”优先</div>
                    {hasMasterAlliance ? (
                      <>
                        <input
                          type="text"
                          className="domain-admin-search-input"
                          placeholder="搜索熵盟后加入指定比例或黑名单"
                          value={distributionAllianceKeyword}
                          onChange={(e) => setDistributionAllianceKeyword(e.target.value)}
                        />
                        {distributionAllianceSearching && <div className="domain-manage-tip">搜索中...</div>}
                        {!distributionAllianceSearching && distributionAllianceKeyword.trim() && (
                          <div className="domain-search-results">
                            {distributionAllianceResults.length === 0 ? (
                              <div className="domain-manage-tip">没有匹配熵盟</div>
                            ) : distributionAllianceResults.map((allianceItem) => (
                              <div key={allianceItem._id} className="domain-search-row">
                                <span className="domain-admin-name">{allianceItem.name}</span>
                                <div className="distribution-row-actions">
                                  <button
                                    type="button"
                                    className="btn btn-small btn-success"
                                    onClick={() => updateDistributionRule((prev) => {
                                      if ((prev.specificAlliancePercents || []).some((item) => item.allianceId === allianceItem._id)) {
                                        return prev;
                                      }
                                      return {
                                        ...prev,
                                        specificAlliancePercents: [...(prev.specificAlliancePercents || []), {
                                          allianceId: allianceItem._id,
                                          allianceName: allianceItem.name,
                                          percent: 0
                                        }]
                                      };
                                    })}
                                  >
                                    加入指定熵盟池
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-small btn-danger"
                                    onClick={() => updateDistributionRule((prev) => {
                                      if ((prev.blacklistAlliances || []).some((item) => item.allianceId === allianceItem._id)) {
                                        return prev;
                                      }
                                      return {
                                        ...prev,
                                        blacklistAlliances: [...(prev.blacklistAlliances || []), {
                                          allianceId: allianceItem._id,
                                          allianceName: allianceItem.name
                                        }]
                                      };
                                    })}
                                  >
                                    加黑
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="domain-manage-tip">域主未加入熵盟，指定熵盟分配池自动禁用</div>
                    )}

                    {hasMasterAlliance && (distributionRule.specificAlliancePercents || []).map((item) => (
                      <div key={item.allianceId} className="distribution-input-row">
                        <span>{item.allianceName || item.allianceId}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={item.percent}
                          onChange={(e) => {
                            const nextPercent = clampPercent(e.target.value, 0);
                            updateDistributionRule((prev) => ({
                              ...prev,
                              specificAlliancePercents: (prev.specificAlliancePercents || []).map((row) => (
                                row.allianceId === item.allianceId ? { ...row, percent: nextPercent } : row
                              ))
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            specificAlliancePercents: (prev.specificAlliancePercents || []).filter((row) => row.allianceId !== item.allianceId)
                          }))}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    {(distributionRule.blacklistAlliances || []).map((item) => (
                      <div key={item.allianceId} className="distribution-tag-row danger">
                        <span>{item.allianceName || item.allianceId}</span>
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => updateDistributionRule((prev) => ({
                            ...prev,
                            blacklistAlliances: (prev.blacklistAlliances || []).filter((row) => row.allianceId !== item.allianceId)
                          }))}
                        >
                          取消黑名单
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="distribution-subblock">
                    <div className="distribution-subtitle">规则结果可视化与冲突解释</div>
                    <div className="distribution-progress-wrap">
                      <div className="distribution-progress-track">
                        <div
                          className={`distribution-progress-fill ${currentPercentSummary.total > 100 ? 'over' : ''}`}
                          style={{ width: `${Math.max(0, Math.min(100, currentPercentSummary.total))}%` }}
                        />
                      </div>
                      <span>{`分配占比 ${currentPercentSummary.total.toFixed(2)}%，未分配 ${unallocatedPercent.toFixed(2)}% 将结转`}</span>
                    </div>
                    <div className="distribution-visual-metrics">
                      <div className="distribution-metric-card">
                        <span>分发范围比例</span>
                        <strong>{scopePercent.toFixed(2)}%</strong>
                      </div>
                      <div className="distribution-metric-card">
                        <span>总分配占比</span>
                        <strong>{currentPercentSummary.total.toFixed(2)}%</strong>
                      </div>
                      <div className="distribution-metric-card">
                        <span>未分配比例</span>
                        <strong>{unallocatedPercent.toFixed(2)}%</strong>
                      </div>
                    </div>
                    <div className="distribution-notes">
                      {blockedRuleNotes.map((note) => (
                        <div key={note} className="domain-manage-tip">{note}</div>
                      ))}
                      {conflictMessages.length === 0 ? (
                        <div className="domain-manage-tip">当前未发现允许/禁止规则冲突</div>
                      ) : conflictMessages.map((message) => (
                        <div key={message} className="domain-manage-error">{message}</div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveDistributionSettings}
                    disabled={distributionState.saving}
                  >
                    {distributionState.saving ? '保存中...' : '保存当前规则'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {showBottomExitButton && (
          <button className="exit-domain-btn" onClick={onExit}>
            离开知识域
          </button>
        )}
    </div>
  );
};

export default KnowledgeDomainScene;
