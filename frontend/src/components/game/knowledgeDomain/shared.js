const getNodePrimarySense = (node) => {
  const senses = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
  if (typeof node?.activeSenseId === 'string' && node.activeSenseId.trim()) {
    const matched = senses.find((item) => item?.senseId === node.activeSenseId.trim());
    if (matched) return matched;
  }
  return senses[0] || null;
};

export const getNodeDisplayName = (node) => {
  if (typeof node?.displayName === 'string' && node.displayName.trim()) return node.displayName.trim();
  const name = typeof node?.name === 'string' ? node.name.trim() : '';
  const senseTitle = typeof node?.activeSenseTitle === 'string' && node.activeSenseTitle.trim()
    ? node.activeSenseTitle.trim()
    : (typeof getNodePrimarySense(node)?.title === 'string' ? getNodePrimarySense(node).title.trim() : '');
  return senseTitle ? `${name}-${senseTitle}` : (name || '知识域');
};

export const DISTRIBUTION_SCOPE_OPTIONS = [
  { value: 'all', label: '全部分发（100%）' },
  { value: 'partial', label: '部分分发（按比例）' }
];

export const clampPercent = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
};

export const createDefaultDistributionRule = () => ({
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

export const createDistributionRuleProfileId = () => (
  `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
);

export const mapDistributionRuleFromApi = (rawRule = {}) => ({
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

export const mapDistributionRuleProfileFromApi = (rawProfile = {}, index = 0) => {
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

export const createDistributionRuleProfile = (profileId = 'default', name = '默认规则', rawRule = null) => ({
  profileId,
  name,
  enabled: true,
  rule: rawRule ? mapDistributionRuleFromApi(rawRule) : createDefaultDistributionRule(),
  percentSummary: null
});

export const buildDistributionRulePayload = (rule = {}) => ({
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

export const createDefaultDistributionState = () => ({
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

export const computePercentSummary = (rule, allianceContributionPercent) => {
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

export const getDistributionScopePercent = (rule = {}) => (
  rule?.distributionScope === 'partial' ? clampPercent(rule?.distributionPercent, 100) : 100
);

export const toHourInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:00`;
};

export const getDefaultPublishExecuteAtInput = () => {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toHourInputValue(date);
};

export const parseHourInputToDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (date.getMinutes() !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0) return null;
  return date;
};

export const formatCountdown = (seconds) => {
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

export const CITY_BUILDING_LIMIT = 3;
export const CITY_BUILDING_DEFAULT_RADIUS = 0.17;
export const CITY_BUILDING_MIN_DISTANCE = 0.34;
export const CITY_BUILDING_MAX_DISTANCE = 0.86;
export const CITY_CAMERA_DEFAULT_ANGLE_DEG = 45;
export const CITY_CAMERA_BUILD_ANGLE_DEG = 90;
export const CITY_CAMERA_TRANSITION_MS = 460;
export const CITY_GATE_KEYS = ['cheng', 'qi'];
export const INTEL_HEIST_SCAN_MS = 8000;
export const INTEL_HEIST_TIMEOUT_BUFFER_MS = INTEL_HEIST_SCAN_MS;
export const CITY_GATE_LABELS = {
  cheng: '承口',
  qi: '启口'
};
export const CITY_GATE_TOOLTIPS = {
  cheng: '通往上一级知识域',
  qi: '通往下一级知识域'
};
export const CITY_BUILDING_CANDIDATE_POSITIONS = [
  { x: -0.46, y: -0.12 },
  { x: 0.46, y: -0.12 },
  { x: -0.34, y: 0.36 },
  { x: 0.34, y: 0.36 },
  { x: 0, y: -0.42 },
  { x: 0, y: 0.42 }
];

export const cloneDefenseLayout = (layout = {}) => ({
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

export const createDefaultDefenseLayout = () => ({
  buildings: [],
  intelBuildingId: '',
  gateDefense: {
    cheng: [],
    qi: []
  },
  gateDefenseViewAdminIds: []
});

export const normalizeDefenseLayoutFromApi = (rawLayout = {}) => {
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
      buildingTypeId: typeof item.buildingTypeId === 'string' ? item.buildingTypeId.trim() : '',
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
    const seenGateEntries = new Set();
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0) continue;
      if (seenGateEntries.has(unitTypeId)) continue;
      seenGateEntries.add(unitTypeId);
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

export const normalizeBuildingCatalogFromApi = (rawCatalog = []) => {
  const source = Array.isArray(rawCatalog) ? rawCatalog : [];
  const out = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const buildingTypeId = typeof item.buildingTypeId === 'string' ? item.buildingTypeId.trim() : '';
    if (!buildingTypeId || seen.has(buildingTypeId)) continue;
    seen.add(buildingTypeId);
    out.push({
      buildingTypeId,
      name: (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : `建筑类型${out.length + 1}`,
      initialCount: Math.max(0, Math.floor(Number(item.initialCount) || 0)),
      radius: Number.isFinite(Number(item.radius))
        ? Math.max(0.1, Math.min(0.24, Number(item.radius)))
        : CITY_BUILDING_DEFAULT_RADIUS,
      level: Math.max(1, Math.floor(Number(item.level) || 1)),
      nextUnitTypeId: typeof item.nextUnitTypeId === 'string' ? item.nextUnitTypeId.trim() : '',
      upgradeCostKP: Number.isFinite(Number(item.upgradeCostKP)) ? Number(item.upgradeCostKP) : null,
      style: item.style && typeof item.style === 'object' ? item.style : {}
    });
  }
  return out;
};

export const createDefaultDefenseLayoutState = () => ({
  loading: false,
  saving: false,
  error: '',
  feedback: '',
  canEdit: false,
  canViewGateDefense: false,
  maxBuildings: CITY_BUILDING_LIMIT,
  minBuildings: 0,
  buildingCatalog: [],
  selectedBuildingTypeId: '',
  buildMode: false,
  isDirty: false,
  selectedBuildingId: '',
  draggingBuildingId: '',
  savedLayout: createDefaultDefenseLayout(),
  draftLayout: createDefaultDefenseLayout()
});

export const createDefaultGateDeployState = () => ({
  loading: false,
  error: '',
  unitTypes: [],
  roster: [],
  activeGateKey: '',
  draggingUnitTypeId: '',
  editMode: false
});

const calcDistance = (a, b) => Math.sqrt(((a.x - b.x) ** 2) + ((a.y - b.y) ** 2));

export const clampPositionInsideCity = (position = { x: 0, y: 0 }) => {
  const length = Math.sqrt((position.x ** 2) + (position.y ** 2));
  if (length <= CITY_BUILDING_MAX_DISTANCE) return position;
  const ratio = CITY_BUILDING_MAX_DISTANCE / (length || 1);
  return {
    x: position.x * ratio,
    y: position.y * ratio
  };
};

export const isValidPlacement = (position, buildings, buildingId) => {
  const distanceToCenter = Math.sqrt((position.x ** 2) + (position.y ** 2));
  if (distanceToCenter > CITY_BUILDING_MAX_DISTANCE) return false;
  return buildings.every((item) => {
    if (item.buildingId === buildingId) return true;
    return calcDistance(position, item) >= CITY_BUILDING_MIN_DISTANCE;
  });
};

export const clampCityCameraAngle = (angleDeg) => {
  const parsed = Number(angleDeg);
  if (!Number.isFinite(parsed)) return CITY_CAMERA_DEFAULT_ANGLE_DEG;
  return Math.max(CITY_CAMERA_DEFAULT_ANGLE_DEG, Math.min(CITY_CAMERA_BUILD_ANGLE_DEG, parsed));
};

export const getCityCameraTiltBlend = (angleDeg) => {
  const normalizedAngle = clampCityCameraAngle(angleDeg);
  return (normalizedAngle - CITY_CAMERA_DEFAULT_ANGLE_DEG) / (CITY_CAMERA_BUILD_ANGLE_DEG - CITY_CAMERA_DEFAULT_ANGLE_DEG);
};

export const getCityMetrics = (width, height, angleDeg = CITY_CAMERA_DEFAULT_ANGLE_DEG) => {
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

export const clampScenePanOffset = (offset = { x: 0, y: 0 }, width = 0, height = 0) => {
  const maxX = Math.max(0, (Number(width) || 0) * 0.28);
  const maxY = Math.max(0, (Number(height) || 0) * 0.2);
  return {
    x: Math.max(-maxX, Math.min(maxX, Number(offset.x) || 0)),
    y: Math.max(-maxY, Math.min(maxY, Number(offset.y) || 0))
  };
};

export const defenseLayoutToPayload = (layout = {}) => ({
  buildings: (layout.buildings || []).map((item) => ({
    buildingId: item.buildingId,
    buildingTypeId: typeof item.buildingTypeId === 'string' ? item.buildingTypeId.trim() : '',
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

export const normalizeDomainManagerUser = (user) => {
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

export const getGateDefenseEntries = (layout = {}, gateKey) => {
  const sourceEntries = Array.isArray(layout?.gateDefense?.[gateKey]) ? layout.gateDefense[gateKey] : [];
  return sourceEntries
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0);
};

export const getGateDefenseTotal = (layout = {}, gateKey) => (
  getGateDefenseEntries(layout, gateKey).reduce((sum, entry) => sum + entry.count, 0)
);

export const formatElapsedMinutesText = (value) => {
  const timeMs = new Date(value || 0).getTime();
  if (!Number.isFinite(timeMs) || timeMs <= 0) return '未知时刻';
  const diffMs = Math.max(0, Date.now() - timeMs);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 60) {
    return `${minutes}分钟`;
  }
  const hours = diffMs / 3600000;
  if (hours > 24) {
    return '>1天前';
  }
  return `${hours.toFixed(1)}小时前`;
};

export const getDeployedCountByUnitType = (layout = {}) => {
  const counter = new Map();
  CITY_GATE_KEYS.forEach((gateKey) => {
    getGateDefenseEntries(layout, gateKey).forEach((entry) => {
      counter.set(entry.unitTypeId, (counter.get(entry.unitTypeId) || 0) + entry.count);
    });
  });
  return counter;
};

export const normalizeDistributionProfiles = (rawProfiles = [], rawActiveRuleId = '', allianceContributionPercent = 0) => {
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
