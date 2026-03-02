import React, { useCallback, useEffect, useRef, useState } from 'react';
import './pveBattle.css';
import BattleRuntime from '../../game/battle/presentation/runtime/BattleRuntime';
import BattleClock from '../../game/battle/presentation/runtime/BattleClock';
import CameraController from '../../game/battle/presentation/render/CameraController';
import {
  createBattleGlContext,
  resizeCanvasToDisplaySize
} from '../../game/battle/presentation/render/WebGL2Context';
import ImpostorRenderer from '../../game/battle/presentation/render/ImpostorRenderer';
import BuildingRenderer from '../../game/battle/presentation/render/BuildingRenderer';
import ProjectileRenderer from '../../game/battle/presentation/render/ProjectileRenderer';
import EffectRenderer from '../../game/battle/presentation/render/EffectRenderer';
import GroundRenderer from '../../game/battle/presentation/render/GroundRenderer';
import BattleHUD from '../../game/battle/presentation/ui/BattleHUD';
import SquadCards from '../../game/battle/presentation/ui/SquadCards';
import DeployActionButtons from '../../game/battle/presentation/ui/DeployActionButtons';
import BattleActionButtons from '../../game/battle/presentation/ui/BattleActionButtons';
import Minimap from '../../game/battle/presentation/ui/Minimap';
import AimOverlayCanvas from '../../game/battle/presentation/ui/AimOverlayCanvas';
import BattleDebugPanel from '../../game/battle/presentation/ui/BattleDebugPanel';
import unitVisualConfig from '../../game/battle/presentation/assets/UnitVisualConfig.example.json';
import createBattleProceduralTextures from '../../game/battle/presentation/assets/ProceduralTextures';
import NumberPadDialog from '../common/NumberPadDialog';
import { API_BASE } from '../../runtimeConfig';
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const ORDER_MOVE = 'MOVE';
const SPEED_MODE_B = 'B_HARMONIC';
const SPEED_MODE_C = 'C_PER_TYPE';
const SPEED_MODE_AUTO = 'AUTO';
const CAMERA_ZOOM_STEP = 24;
const CAMERA_DISTANCE_MIN = 360;
const CAMERA_DISTANCE_MAX = 980;
const DEPLOY_ROTATE_SENSITIVITY = 0.28;
const DEPLOY_ROTATE_CLICK_THRESHOLD = 3;
// Keep attacker (world -X) on web-left when using pitch > 90 deg.
const DEPLOY_DEFAULT_YAW_DEG = 0;
const DEPLOY_DEFAULT_WORLD_YAW_DEG = 0;
const DEPLOY_PITCH_DEG = 30;
const BATTLE_PITCH_LOW_DEG = 40;
const BATTLE_PITCH_HIGH_DEG = 90;
const BATTLE_FOLLOW_YAW_DEG = 0;
const BATTLE_FOLLOW_WORLD_YAW_DEG = 0;
const BATTLE_FOLLOW_MIRROR_X = false;
const BATTLE_UI_MODE_NONE = 'NONE';
const BATTLE_UI_MODE_PATH = 'PATH_PLANNING';
const BATTLE_UI_MODE_MARCH_PICK = 'MARCH_PICK';
const BATTLE_UI_MODE_GUARD = 'GUARD';
const BATTLE_UI_MODE_SKILL_PICK = 'SKILL_PICK';
const BATTLE_UI_MODE_SKILL_CONFIRM = 'SKILL_CONFIRM';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeDeg = (deg) => {
  const raw = Number(deg) || 0;
  const wrapped = ((raw % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
};
const createNoopImpostorRenderer = () => ({
  updateFromSnapshot() {},
  render() {},
  dispose() {}
});

const skillRangeByClass = (classTag) => {
  if (classTag === 'cavalry') return 220;
  if (classTag === 'archer') return 260;
  if (classTag === 'artillery') return 310;
  return 180;
};

const skillAoeRadiusByClass = (classTag) => {
  if (classTag === 'archer') return 72;
  if (classTag === 'artillery') return 126;
  return 24;
};

const toCardsByTeam = (cards = []) => (
  Array.isArray(cards) ? cards : []
);

const buildCompatSummaryPayload = (summary = {}) => ({
  battleId: summary?.battleId || '',
  gateKey: summary?.gateKey || '',
  durationSec: Math.max(0, Math.floor(Number(summary?.durationSec) || 0)),
  attacker: {
    start: Math.max(0, Math.floor(Number(summary?.attacker?.start) || 0)),
    remain: Math.max(0, Math.floor(Number(summary?.attacker?.remain) || 0)),
    kills: Math.max(0, Math.floor(Number(summary?.attacker?.kills) || 0))
  },
  defender: {
    start: Math.max(0, Math.floor(Number(summary?.defender?.start) || 0)),
    remain: Math.max(0, Math.floor(Number(summary?.defender?.remain) || 0)),
    kills: Math.max(0, Math.floor(Number(summary?.defender?.kills) || 0))
  },
  details: summary?.details && typeof summary.details === 'object' ? summary.details : {},
  startedAt: summary?.startedAt || null,
  endedAt: summary?.endedAt || null,
  endReason: summary?.endReason || ''
});

const normalizeDraftUnits = (units = []) => (
  (Array.isArray(units) ? units : [])
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0)
);

const unitsToMap = (units = []) => {
  const map = {};
  normalizeDraftUnits(units).forEach((entry) => {
    map[entry.unitTypeId] = (map[entry.unitTypeId] || 0) + entry.count;
  });
  return map;
};

const unitsToSummary = (units = [], unitNameByTypeId = new Map()) => (
  normalizeDraftUnits(units)
    .map((entry) => `${unitNameByTypeId.get(entry.unitTypeId) || entry.unitTypeId}x${entry.count}`)
    .join(' / ')
);

const normalizeTemplateUnits = (units = []) => (
  (Array.isArray(units) ? units : [])
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      unitName: typeof entry?.unitName === 'string' ? entry.unitName.trim() : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0)
);

const QUICK_DEPLOY_TEAM_SHORTCUTS = [5, 10, 20, 30, 50];
const QUICK_DEPLOY_TOTAL_SHORTCUTS = [
  { label: '5000', value: 5000 },
  { label: '1万', value: 10000 },
  { label: '5万', value: 50000 },
  { label: '10万', value: 100000 },
  { label: '20万', value: 200000 },
  { label: '30万', value: 300000 },
  { label: '50万', value: 500000 }
];
const QUICK_DEPLOY_MAX_TEAM_COUNT = 200;
const QUICK_DEPLOY_MAX_TOTAL = 500000;
const QUICK_DEPLOY_RANDOM_DEFAULT = {
  attackerTeamCount: '10',
  defenderTeamCount: '10',
  attackerTotal: '10000',
  defenderTotal: '10000'
};

const SPEED_MODE_CYCLE = [SPEED_MODE_B, SPEED_MODE_C, SPEED_MODE_AUTO];
const speedModeLabel = (mode) => {
  if (mode === SPEED_MODE_C) return '撤退(C)';
  if (mode === SPEED_MODE_AUTO) return '自动(A)';
  return '行军(B)';
};
const QUICK_DEPLOY_STANDARD_PRESETS = [
  {
    id: 'std_small',
    label: '小规模标准',
    desc: '双方 5 支部队，共 5000 人',
    attackerTeamCount: 5,
    defenderTeamCount: 5,
    attackerTotal: 5000,
    defenderTotal: 5000
  },
  {
    id: 'std_balanced',
    label: '均衡标准',
    desc: '双方 10 支部队，共 1 万人',
    attackerTeamCount: 10,
    defenderTeamCount: 10,
    attackerTotal: 10000,
    defenderTotal: 10000
  },
  {
    id: 'std_large',
    label: '大会战标准',
    desc: '双方 20 支部队，共 5 万人',
    attackerTeamCount: 20,
    defenderTeamCount: 20,
    attackerTotal: 50000,
    defenderTotal: 50000
  }
];

const parseQuickDeployNumber = (input) => {
  if (typeof input === 'number' && Number.isFinite(input)) return Math.floor(input);
  if (typeof input !== 'string') return NaN;
  const compact = input.trim().replace(/[,\s，_]/g, '');
  if (!compact) return NaN;
  let multiplier = 1;
  let numberPart = compact;
  if (compact.endsWith('万')) {
    multiplier = 10000;
    numberPart = compact.slice(0, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(numberPart)) return NaN;
  const parsed = Number(numberPart);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.floor(parsed * multiplier);
};

const splitTotalEvenly = (total, parts) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeParts = Math.max(1, Math.floor(Number(parts) || 1));
  const base = Math.floor(safeTotal / safeParts);
  const remainder = safeTotal - (base * safeParts);
  return Array.from({ length: safeParts }, (_, idx) => base + (idx < remainder ? 1 : 0));
};

const splitTotalRandomly = (total, parts) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safeParts = Math.max(1, Math.floor(Number(parts) || 1));
  const base = Array.from({ length: safeParts }, () => 1);
  let remain = safeTotal - safeParts;
  if (remain <= 0) return base;
  const weights = Array.from({ length: safeParts }, () => 0.25 + Math.random());
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const alloc = weights.map((weight) => Math.floor((weight / Math.max(1e-6, weightSum)) * remain));
  let used = alloc.reduce((sum, value) => sum + value, 0);
  remain -= used;
  const rank = weights
    .map((weight, idx) => ({
      idx,
      score: ((weight / Math.max(1e-6, weightSum)) * (safeTotal - safeParts)) - alloc[idx]
    }))
    .sort((a, b) => b.score - a.score);
  for (let i = 0; i < remain; i += 1) {
    alloc[rank[i % rank.length].idx] += 1;
  }
  return base.map((value, idx) => value + alloc[idx]);
};

const randomPickUnique = (values = [], count = 1) => {
  const list = Array.isArray(values) ? [...values] : [];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.max(1, Math.floor(Number(count) || 1)));
};

const buildTeamPositions = ({ team, count, field, deployRange, jitter = true }) => {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const safeFieldW = Math.max(120, Number(field?.width) || 900);
  const safeFieldH = Math.max(120, Number(field?.height) || 620);
  const safeRange = deployRange && typeof deployRange === 'object'
    ? deployRange
    : {
        minX: -safeFieldW / 2,
        maxX: safeFieldW / 2,
        attackerMaxX: -safeFieldW * 0.3,
        defenderMinX: safeFieldW * 0.3
      };

  const zoneMinX = team === TEAM_DEFENDER ? Number(safeRange.defenderMinX) || 0 : Number(safeRange.minX) || 0;
  const zoneMaxX = team === TEAM_DEFENDER ? Number(safeRange.maxX) || 0 : Number(safeRange.attackerMaxX) || 0;
  const usableMinX = Math.min(zoneMinX, zoneMaxX) + 8;
  const usableMaxX = Math.max(zoneMinX, zoneMaxX) - 8;
  const zoneCenterX = (usableMinX + usableMaxX) * 0.5;
  const zoneSpan = Math.max(18, usableMaxX - usableMinX);
  const compactSpan = Math.max(20, Math.min(zoneSpan * 0.72, 168));
  const minX = clamp(zoneCenterX - compactSpan * 0.5, usableMinX, usableMaxX);
  const maxX = clamp(zoneCenterX + compactSpan * 0.5, usableMinX, usableMaxX);
  const minY = -safeFieldH * 0.42;
  const maxY = safeFieldH * 0.42;

  const cols = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
  const rows = Math.max(1, Math.ceil(safeCount / cols));
  const jitterX = Math.max(1, Math.min(14, (maxX - minX) / Math.max(2, cols + 1)));
  const jitterY = Math.max(1, Math.min(16, (maxY - minY) / Math.max(2, rows + 1)));

  return Array.from({ length: safeCount }, (_, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const tx = cols <= 1 ? 0.5 : (col / (cols - 1));
    const ty = rows <= 1 ? 0.5 : (row / (rows - 1));
    const rx = jitter ? ((Math.random() * 2 - 1) * jitterX) : 0;
    const ry = jitter ? ((Math.random() * 2 - 1) * jitterY) : 0;
    return {
      x: clamp(minX + ((maxX - minX) * tx) + rx, usableMinX, usableMaxX),
      y: clamp(minY + ((maxY - minY) * ty) + ry, -safeFieldH / 2 + 8, safeFieldH / 2 - 8)
    };
  });
};

const buildDomLineStyle = (fromPoint, toPoint) => {
  const ax = Number(fromPoint?.x);
  const ay = Number(fromPoint?.y);
  const bx = Number(toPoint?.x);
  const by = Number(toPoint?.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-3) return null;
  return {
    left: `${ax}px`,
    top: `${ay}px`,
    width: `${len}px`,
    transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`
  };
};

const computeDeployOverviewDistance = (field = null) => {
  const width = Math.max(120, Number(field?.width) || 900);
  const height = Math.max(120, Number(field?.height) || 620);
  const dominantSpan = Math.max(width, height * 1.2);
  return clamp(dominantSpan * 1.18, CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX);
};

const buildStandardGroups = ({ teamLabel, teamCount, totalPeople, rosterRows = [] }) => {
  const unitTypeIds = rosterRows
    .map((row) => row?.unitTypeId)
    .filter((unitTypeId) => typeof unitTypeId === 'string' && unitTypeId);
  const totals = splitTotalEvenly(totalPeople, teamCount);
  return totals.map((groupTotal, idx) => {
    const primaryId = unitTypeIds[idx % unitTypeIds.length];
    const secondaryId = unitTypeIds.length > 1 ? unitTypeIds[(idx + 1) % unitTypeIds.length] : '';
    if (!secondaryId || groupTotal < 8) {
      return {
        name: `${teamLabel}标准${idx + 1}`,
        units: { [primaryId]: groupTotal }
      };
    }
    const secondaryCount = clamp(Math.floor(groupTotal * 0.3), 1, Math.max(1, groupTotal - 1));
    return {
      name: `${teamLabel}标准${idx + 1}`,
      units: {
        [primaryId]: groupTotal - secondaryCount,
        [secondaryId]: secondaryCount
      }
    };
  });
};

const buildRandomGroups = ({ teamLabel, teamCount, totalPeople, rosterRows = [] }) => {
  const unitTypeIds = rosterRows
    .map((row) => row?.unitTypeId)
    .filter((unitTypeId) => typeof unitTypeId === 'string' && unitTypeId);
  const groupTotals = splitTotalRandomly(totalPeople, teamCount);
  return groupTotals.map((groupTotal, idx) => {
    const typeCount = clamp(1 + Math.floor(Math.random() * 3), 1, Math.min(unitTypeIds.length, groupTotal));
    const pickedTypeIds = randomPickUnique(unitTypeIds, typeCount);
    const typeTotals = splitTotalRandomly(groupTotal, pickedTypeIds.length);
    const units = {};
    pickedTypeIds.forEach((unitTypeId, typeIdx) => {
      units[unitTypeId] = (units[unitTypeId] || 0) + (typeTotals[typeIdx] || 0);
    });
    return {
      name: `${teamLabel}随机${idx + 1}`,
      units
    };
  });
};

const BattleSceneModal = ({
  open = false,
  loading = false,
  error = '',
  battleInitData = null,
  mode = 'siege',
  startLabel = '开战',
  requireResultReport = false,
  onClose,
  onBattleFinished
}) => {
  const isTrainingMode = mode === 'training';
  const glCanvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const clockRef = useRef(new BattleClock({ fixedStep: 1 / 30 }));
  const cameraRef = useRef(new CameraController({
    yawDeg: DEPLOY_DEFAULT_YAW_DEG,
    pitchLow: BATTLE_PITCH_LOW_DEG,
    pitchHigh: BATTLE_PITCH_HIGH_DEG,
    distance: 560,
    mirrorX: false
  }));
  const glRef = useRef(null);
  const renderersRef = useRef({
    ground: null,
    impostor: null,
    building: null,
    projectile: null,
    effect: null
  });
  const proceduralTexRef = useRef(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastUiSyncRef = useRef(0);
  const worldToScreenRef = useRef(null);
  const worldToDomRef = useRef(null);
  const cameraStateRef = useRef(null);
  const cameraViewRectRef = useRef({ widthWorld: 240, heightWorld: 160 });
  const fpsStateRef = useRef({ windowSec: 0, frames: 0 });
  const reportedRef = useRef(false);
  const pointerWorldRef = useRef({ x: 0, y: 0 });
  const panDragRef = useRef(null);
  const deployYawDragRef = useRef(null);
  const spacePressedRef = useRef(false);

  const [glError, setGlError] = useState('');
  const [phase, setPhase] = useState('deploy');
  const [battleStatus, setBattleStatus] = useState({ timerSec: 0, ended: false, endReason: '' });
  const [cards, setCards] = useState([]);
  const [paused, setPaused] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugStats, setDebugStats] = useState({ fps: 0, simStepMs: 0, renderMs: 0, unitModelCount: 0, agentCount: 0, projectileCount: 0, buildingCount: 0 });
  const [aimState, setAimState] = useState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
  const [battleUiMode, setBattleUiMode] = useState(BATTLE_UI_MODE_NONE);
  const [worldActionsVisibleForSquadId, setWorldActionsVisibleForSquadId] = useState('');
  const [hoverSquadIdOnCard, setHoverSquadIdOnCard] = useState('');
  const [pendingPathPoints, setPendingPathPoints] = useState([]);
  const [planningHoverPoint, setPlanningHoverPoint] = useState(null);
  const [skillConfirmState, setSkillConfirmState] = useState(null);
  const [skillPopupSquadId, setSkillPopupSquadId] = useState('');
  const [skillPopupPos, setSkillPopupPos] = useState({ x: 120, y: 120 });
  const [marchModePickOpen, setMarchModePickOpen] = useState(false);
  const [marchPopupPos, setMarchPopupPos] = useState({ x: 120, y: 120 });
  const [selectedSquadId, setSelectedSquadId] = useState('');
  const [minimapSnapshot, setMinimapSnapshot] = useState(null);
  const [cameraMiniState, setCameraMiniState] = useState({ center: { x: 0, y: 0 }, viewport: { widthWorld: 220, heightWorld: 150 } });
  const [cameraAssert, setCameraAssert] = useState({
    cameraImplTag: '',
    phase: '',
    yawDeg: 0,
    worldYawDeg: 0,
    currentPitch: 0,
    pitchLow: 0,
    pitchHigh: 0,
    distance: 0,
    mirrorX: false,
    handedness: 0,
    centerX: 0,
    centerY: 0,
    eyeX: 0,
    eyeY: 0,
    eyeZ: 0,
    forwardZ: 0,
    flipFixApplied: false,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    cameraRightX: 0,
    cameraRightY: 0,
    cameraRightZ: 0,
    fieldWidth: 0,
    fieldHeight: 0,
    deployAttackerMaxX: 0,
    deployDefenderMinX: 0,
    pointerX: 0,
    pointerY: 0,
    pointerValid: false,
    isPanning: false,
    panStartDistance: 0,
    panStartPitch: 0,
    followTargetX: 0,
    followTargetY: 0,
    followTargetSquadId: '',
    focusActualX: 0,
    focusActualY: 0,
    focusActualSquadId: '',
    focusActualResolved: false
  });
  const [resultState, setResultState] = useState({ open: false, submitting: false, error: '', summary: null, recorded: false });
  const [deployEditorOpen, setDeployEditorOpen] = useState(false);
  const [deployEditingGroupId, setDeployEditingGroupId] = useState('');
  const [deployEditorDraft, setDeployEditorDraft] = useState({ name: '', units: [] });
  const [deployQuantityDialog, setDeployQuantityDialog] = useState({
    open: false,
    unitTypeId: '',
    unitName: '',
    max: 0,
    current: 1
  });
  const [deployDraggingGroup, setDeployDraggingGroup] = useState({ groupId: '', team: TEAM_ATTACKER });
  const [deployActionAnchorMode, setDeployActionAnchorMode] = useState('');
  const [deployNotice, setDeployNotice] = useState('');
  const [deployEditorDragUnitId, setDeployEditorDragUnitId] = useState('');
  const [deployEditorTeam, setDeployEditorTeam] = useState(TEAM_ATTACKER);
  const [selectedPaletteItemId, setSelectedPaletteItemId] = useState('');
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState('');
  const [confirmDeletePos, setConfirmDeletePos] = useState({ x: 0, y: 0 });
  const [quickDeployOpen, setQuickDeployOpen] = useState(false);
  const [quickDeployTab, setQuickDeployTab] = useState('standard');
  const [quickDeployApplying, setQuickDeployApplying] = useState(false);
  const [quickDeployError, setQuickDeployError] = useState('');
  const [quickDeployRandomForm, setQuickDeployRandomForm] = useState({ ...QUICK_DEPLOY_RANDOM_DEFAULT });
  const [armyTemplates, setArmyTemplates] = useState([]);
  const [armyTemplatesLoading, setArmyTemplatesLoading] = useState(false);
  const [armyTemplatesError, setArmyTemplatesError] = useState('');
  const [templateFillPreview, setTemplateFillPreview] = useState({
    open: false,
    team: TEAM_ATTACKER,
    template: null,
    rows: [],
    totalRequested: 0,
    totalFilled: 0
  });
  const [showMidlineDebug, setShowMidlineDebug] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const deployDraggingGroupId = String(deployDraggingGroup?.groupId || '');
  const deployDraggingTeam = deployDraggingGroup?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;

  const closeModal = useCallback(() => {
    if (typeof onClose === 'function') onClose();
  }, [onClose]);

  const destroyRenderers = useCallback(() => {
    const renderers = renderersRef.current;
    if (renderers.ground) renderers.ground.dispose();
    if (renderers.impostor) renderers.impostor.dispose();
    if (renderers.building) renderers.building.dispose();
    if (renderers.projectile) renderers.projectile.dispose();
    if (renderers.effect) renderers.effect.dispose();
    renderersRef.current = {
      ground: null,
      impostor: null,
      building: null,
      projectile: null,
      effect: null
    };
    if (proceduralTexRef.current?.dispose) {
      proceduralTexRef.current.dispose();
    }
    proceduralTexRef.current = null;
    glRef.current = null;
  }, []);

  const setupRuntime = useCallback(() => {
    if (!open || !battleInitData) {
      runtimeRef.current = null;
      return;
    }
    const runtime = new BattleRuntime(battleInitData, {
      repConfig: {
        maxAgentWeight: 50,
        damageExponent: 0.75,
        strictAgentMapping: true
      },
      visualConfig: unitVisualConfig,
      rules: isTrainingMode ? { allowCrossMidline: true } : undefined
    });
    runtimeRef.current = runtime;
    const cardsRows = runtime.getCardRows();
    setCards(cardsRows);
    setPhase(runtime.getPhase());
    setBattleStatus(runtime.getBattleStatus());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    const initialSelected = runtime.getDeployGroups()?.selectedId || cardsRows.find((row) => row.team === TEAM_ATTACKER)?.id || '';
    setSelectedSquadId(initialSelected);
    runtime.setFocusSquad(initialSelected);
    const field = runtime.getField();
    cameraRef.current.centerX = 0;
    cameraRef.current.centerY = 0;
    cameraRef.current.yawDeg = DEPLOY_DEFAULT_YAW_DEG;
    cameraRef.current.worldYawDeg = DEPLOY_DEFAULT_WORLD_YAW_DEG;
    cameraRef.current.mirrorX = false;
    cameraRef.current.pitchLow = BATTLE_PITCH_LOW_DEG;
    cameraRef.current.pitchHigh = BATTLE_PITCH_HIGH_DEG;
    cameraRef.current.distance = computeDeployOverviewDistance(field);
    cameraRef.current.currentPitch = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchFrom = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchTo = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
    clockRef.current.reset();
    clockRef.current.setPaused(false);
    reportedRef.current = false;
    setPaused(false);
    setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setWorldActionsVisibleForSquadId('');
    setHoverSquadIdOnCard('');
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setSkillConfirmState(null);
    setSkillPopupSquadId('');
    setSkillPopupPos({ x: 120, y: 120 });
    setMarchModePickOpen(false);
    setMarchPopupPos({ x: 120, y: 120 });
    setResultState({ open: false, submitting: false, error: '', summary: null, recorded: false });
    setDeployEditorOpen(false);
    setDeployEditingGroupId('');
    setDeployEditorDraft({ name: '', units: [] });
    setDeployQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 1
    });
    setDeployDraggingGroup({ groupId: '', team: TEAM_ATTACKER });
    setDeployActionAnchorMode('');
    setDeployNotice('');
    setDeployEditorDragUnitId('');
    setDeployEditorTeam(TEAM_ATTACKER);
    setSelectedPaletteItemId('');
    setQuickDeployOpen(false);
    setQuickDeployTab('standard');
    setQuickDeployApplying(false);
    setQuickDeployError('');
    setQuickDeployRandomForm({ ...QUICK_DEPLOY_RANDOM_DEFAULT });
    setShowMidlineDebug(true);
    setCameraAssert({
      cameraImplTag: '',
      phase: runtime.getPhase(),
      yawDeg: Number(cameraRef.current.yawDeg) || 0,
      worldYawDeg: Number(cameraRef.current.worldYawDeg) || 0,
      currentPitch: Number(cameraRef.current.currentPitch) || 0,
      pitchLow: Number(cameraRef.current.pitchLow) || 0,
      pitchHigh: Number(cameraRef.current.pitchHigh) || 0,
      distance: Number(cameraRef.current.distance) || 0,
      mirrorX: !!cameraRef.current.mirrorX,
      handedness: 0,
      centerX: Number(cameraRef.current.centerX) || 0,
      centerY: Number(cameraRef.current.centerY) || 0,
      eyeX: 0,
      eyeY: 0,
      eyeZ: 0,
      forwardZ: 0,
      flipFixApplied: false,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      cameraRightX: 0,
      cameraRightY: 0,
      cameraRightZ: 0,
      fieldWidth: Number(runtime.getField()?.width) || 0,
      fieldHeight: Number(runtime.getField()?.height) || 0,
      deployAttackerMaxX: Number(runtime.getDeployRange()?.attackerMaxX) || 0,
      deployDefenderMinX: Number(runtime.getDeployRange()?.defenderMinX) || 0,
      pointerX: Number(pointerWorldRef.current?.x) || 0,
      pointerY: Number(pointerWorldRef.current?.y) || 0,
      pointerValid: pointerWorldRef.current?.valid !== false,
      isPanning: false,
      panStartDistance: 0,
      panStartPitch: 0
    });
    setConfirmDeleteGroupId('');
    setConfirmDeletePos({ x: 0, y: 0 });
    setIsPanning(false);
    panDragRef.current = null;
    deployYawDragRef.current = null;
    spacePressedRef.current = false;
  }, [open, battleInitData, isTrainingMode]);

  useEffect(() => {
    if (!open) return;
    setupRuntime();
  }, [open, setupRuntime]);

  useEffect(() => {
    if (!open) {
      setArmyTemplates([]);
      setArmyTemplatesLoading(false);
      setArmyTemplatesError('');
      setTemplateFillPreview({
        open: false,
        team: TEAM_ATTACKER,
        template: null,
        rows: [],
        totalRequested: 0,
        totalFilled: 0
      });
      return;
    }

    let cancelled = false;
    const token = localStorage.getItem('token');
    if (!token) {
      setArmyTemplates([]);
      setArmyTemplatesError('未登录，无法加载部队模板');
      setArmyTemplatesLoading(false);
      return;
    }

    const fetchTemplates = async () => {
      setArmyTemplatesLoading(true);
      setArmyTemplatesError('');
      try {
        const response = await fetch(`${API_BASE}/army/templates`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const parsed = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setArmyTemplates([]);
          setArmyTemplatesError(parsed?.error || parsed?.message || '加载部队模板失败');
          return;
        }
        setArmyTemplates(Array.isArray(parsed?.templates) ? parsed.templates : []);
      } catch (loadError) {
        if (cancelled) return;
        setArmyTemplates([]);
        setArmyTemplatesError(`加载部队模板失败: ${loadError.message}`);
      } finally {
        if (!cancelled) {
          setArmyTemplatesLoading(false);
        }
      }
    };

    fetchTemplates();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !glCanvasRef.current || loading || error || !battleInitData) return;
    try {
      const gl = createBattleGlContext(glCanvasRef.current);
      if (!gl) {
        setGlError('当前环境不支持 WebGL2，无法进入新版战斗场景');
        return;
      }
      glRef.current = gl;
      renderersRef.current.ground = new GroundRenderer(gl);
      renderersRef.current.building = new BuildingRenderer(gl);
      renderersRef.current.projectile = new ProjectileRenderer(gl);
      renderersRef.current.effect = new EffectRenderer(gl);
      proceduralTexRef.current = createBattleProceduralTextures(gl);
      if (proceduralTexRef.current) {
        renderersRef.current.projectile.setTextureArray?.(proceduralTexRef.current.projectileTexArray);
        renderersRef.current.effect.setTextureArray?.(proceduralTexRef.current.effectTexArray);
      }
      try {
        renderersRef.current.impostor = new ImpostorRenderer(gl, { maxSlices: 32, textureSize: 64 });
        renderersRef.current.impostor.setTextureArray?.(proceduralTexRef.current?.unitTexArray, 8);
      } catch (impostorError) {
        console.error('ImpostorRenderer 初始化失败，降级为空渲染器:', impostorError);
        renderersRef.current.impostor = createNoopImpostorRenderer();
      }
      setGlError('');
    } catch (renderInitError) {
      setGlError(`初始化渲染器失败: ${renderInitError.message}`);
      destroyRenderers();
    }

    return () => {
      destroyRenderers();
    };
  }, [open, loading, error, battleInitData, destroyRenderers]);

  useEffect(() => {
    if (phase === 'deploy') return;
    if (!templateFillPreview.open) return;
    setTemplateFillPreview({
      open: false,
      team: TEAM_ATTACKER,
      template: null,
      rows: [],
      totalRequested: 0,
      totalFilled: 0
    });
  }, [phase, templateFillPreview.open]);

  useEffect(() => {
    if (phase === 'battle') return;
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setWorldActionsVisibleForSquadId('');
    setHoverSquadIdOnCard('');
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setSkillConfirmState(null);
    setMarchModePickOpen(false);
    setMarchPopupPos({ x: 120, y: 120 });
    setPaused(false);
    clockRef.current.setPaused(false);
  }, [phase]);

  const reportBattleResult = useCallback(async (summary) => {
    if (!summary) return;
    if (!requireResultReport || !battleInitData?.nodeId) {
      if (typeof onBattleFinished === 'function') onBattleFinished();
      setResultState((prev) => ({ ...prev, submitting: false, recorded: true, error: '' }));
      return;
    }
    setResultState((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/nodes/${battleInitData.nodeId}/siege/pve/battle-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(buildCompatSummaryPayload(summary))
      });
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok || !parsed?.success) {
        throw new Error(parsed?.error || '上报战斗结果失败');
      }
      setResultState((prev) => ({ ...prev, submitting: false, recorded: true, error: '' }));
      if (typeof onBattleFinished === 'function') {
        onBattleFinished();
      }
    } catch (submitError) {
      setResultState((prev) => ({ ...prev, submitting: false, error: submitError.message || '上报失败' }));
    }
  }, [battleInitData, onBattleFinished, requireResultReport]);

  useEffect(() => {
    if (!open || loading || !!error || !!glError) return undefined;
    const runtime = runtimeRef.current;
    const gl = glRef.current;
    const renderers = renderersRef.current;
    if (!runtime || !gl || !renderers?.ground || !renderers?.impostor || !renderers?.building || !renderers?.projectile || !renderers?.effect) return undefined;

    let active = true;

    const frame = (ts) => {
      if (!active) return;
      const last = lastFrameRef.current || ts;
      const deltaSec = clamp((ts - last) / 1000, 0, 0.05);
      lastFrameRef.current = ts;

      const fpsWindow = fpsStateRef.current;
      fpsWindow.windowSec += deltaSec;
      fpsWindow.frames += 1;
      if (fpsWindow.windowSec >= 0.5) {
        const fps = fpsWindow.frames / Math.max(0.0001, fpsWindow.windowSec);
        runtime.setFps(fps);
        fpsWindow.windowSec = 0;
        fpsWindow.frames = 0;
      }

      const sceneCanvas = glCanvasRef.current;
      if (!sceneCanvas) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      resizeCanvasToDisplaySize(sceneCanvas, gl);

      const nowPhase = runtime.getPhase();
      if (nowPhase === 'battle') {
        clockRef.current.tick(deltaSec, (fixedStep) => runtime.step(fixedStep));
      }
      if (nowPhase === 'deploy') {
        cameraRef.current.yawDeg = DEPLOY_DEFAULT_YAW_DEG;
        cameraRef.current.mirrorX = false;
        cameraRef.current.currentPitch = DEPLOY_PITCH_DEG;
        cameraRef.current.pitchFrom = DEPLOY_PITCH_DEG;
        cameraRef.current.pitchTo = DEPLOY_PITCH_DEG;
        cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
      } else {
        // Keep battle follow camera on the same axis orientation as deploy.
        cameraRef.current.yawDeg = BATTLE_FOLLOW_YAW_DEG;
        cameraRef.current.worldYawDeg = BATTLE_FOLLOW_WORLD_YAW_DEG;
        cameraRef.current.mirrorX = BATTLE_FOLLOW_MIRROR_X;
      }

      const focusAnchor = runtime.getFocusAnchor();
      const focusTargetSquadId = String(focusAnchor?.squadId || '');
      const followTargetSquadId = nowPhase === 'battle' ? focusTargetSquadId : '';
      const followAnchor = nowPhase === 'battle'
        ? {
            x: Number(focusAnchor?.x) || 0,
            y: Number(focusAnchor?.y) || 0,
            vx: Number(focusAnchor?.vx) || 0,
            vy: Number(focusAnchor?.vy) || 0,
            squadId: followTargetSquadId
          }
        : null;
      cameraRef.current.update(deltaSec, followAnchor);
      const cameraState = cameraRef.current.buildMatrices(sceneCanvas.width, sceneCanvas.height);
      cameraStateRef.current = cameraState;

      const topLeft = cameraRef.current.screenToGround(0, 0, { width: sceneCanvas.width, height: sceneCanvas.height });
      const bottomRight = cameraRef.current.screenToGround(sceneCanvas.width, sceneCanvas.height, { width: sceneCanvas.width, height: sceneCanvas.height });
      cameraViewRectRef.current = {
        widthWorld: Math.abs((bottomRight.x || 0) - (topLeft.x || 0)),
        heightWorld: Math.abs((bottomRight.y || 0) - (topLeft.y || 0))
      };

      worldToScreenRef.current = (world) => cameraRef.current.worldToScreen(world, { width: sceneCanvas.width, height: sceneCanvas.height });
      const cssRect = sceneCanvas.getBoundingClientRect();
      const scaleX = sceneCanvas.width / Math.max(1, cssRect.width || 1);
      const scaleY = sceneCanvas.height / Math.max(1, cssRect.height || 1);
      worldToDomRef.current = (world) => {
        const p = cameraRef.current.worldToScreen(world, { width: sceneCanvas.width, height: sceneCanvas.height });
        return {
          x: p.x / Math.max(1e-6, scaleX),
          y: p.y / Math.max(1e-6, scaleY),
          visible: p.visible
        };
      };

      const renderStart = performance.now();
      const snapshot = runtime.getRenderSnapshot();
      const field = runtime.getField();
      renderers.ground.setFieldSize(field?.width || 900, field?.height || 620);
      renderers.ground.setDeployRange(runtime.getDeployRange());
      renderers.building.updateFromSnapshot(snapshot.buildings);
      renderers.impostor.updateFromSnapshot(snapshot.units);
      renderers.projectile.updateFromSnapshot(snapshot.projectiles);
      renderers.effect.updateFromSnapshot(snapshot.effects);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const pitchMix = cameraRef.current.getPitchBlend();
      renderers.ground.render(cameraState);
      renderers.building.render(cameraState, pitchMix);
      renderers.impostor.render(cameraState, pitchMix);
      renderers.projectile.render(cameraState);
      renderers.effect.render(cameraState);
      runtime.setRenderMs(performance.now() - renderStart);

      const now = performance.now();
      if ((now - lastUiSyncRef.current) >= 120) {
        lastUiSyncRef.current = now;
        const status = runtime.getBattleStatus();
        const nextCards = runtime.getCardRows();
        setPhase(runtime.getPhase());
        setBattleStatus(status);
        setCards(nextCards);
        setMinimapSnapshot(runtime.getMinimapSnapshot());
        const followedSquad = followTargetSquadId ? runtime.getSquadById(followTargetSquadId) : null;
        const followedDeployGroup = (nowPhase === 'deploy' && focusTargetSquadId)
          ? runtime.getDeployGroupById(focusTargetSquadId)
          : null;
        const lockAnchor = nowPhase === 'battle'
          ? followAnchor
          : {
              x: Number(focusAnchor?.x) || 0,
              y: Number(focusAnchor?.y) || 0,
              squadId: focusTargetSquadId
            };
        setCameraMiniState({
          center: {
            x: nowPhase === 'battle' ? (followAnchor?.x || 0) : cameraRef.current.centerX,
            y: nowPhase === 'battle' ? (followAnchor?.y || 0) : cameraRef.current.centerY
          },
          viewport: cameraViewRectRef.current
        });
        setCameraAssert({
          cameraImplTag: cameraState?.cameraImplTag || '',
          phase: nowPhase,
          yawDeg: Number(cameraRef.current.yawDeg) || 0,
          worldYawDeg: Number(cameraState?.worldYawDeg) || 0,
          currentPitch: Number(cameraRef.current.currentPitch) || 0,
          pitchLow: Number(cameraRef.current.pitchLow) || 0,
          pitchHigh: Number(cameraRef.current.pitchHigh) || 0,
          distance: Number(cameraRef.current.distance) || 0,
          mirrorX: !!cameraRef.current.mirrorX,
          handedness: Number(cameraState?.handedness) || 0,
          centerX: Number(cameraRef.current.centerX) || 0,
          centerY: Number(cameraRef.current.centerY) || 0,
          eyeX: Number(cameraState?.eye?.[0]) || 0,
          eyeY: Number(cameraState?.eye?.[1]) || 0,
          eyeZ: Number(cameraState?.eye?.[2]) || 0,
          forwardZ: Number(cameraState?.forwardZ) || 0,
          flipFixApplied: !!cameraState?.flipFixApplied,
          targetX: Number(cameraState?.target?.[0]) || 0,
          targetY: Number(cameraState?.target?.[1]) || 0,
          targetZ: Number(cameraState?.target?.[2]) || 0,
          cameraRightX: Number(cameraState?.cameraRight?.[0]) || 0,
          cameraRightY: Number(cameraState?.cameraRight?.[1]) || 0,
          cameraRightZ: Number(cameraState?.cameraRight?.[2]) || 0,
          fieldWidth: Number(field?.width) || 0,
          fieldHeight: Number(field?.height) || 0,
          deployAttackerMaxX: Number(runtime.getDeployRange()?.attackerMaxX) || 0,
          deployDefenderMinX: Number(runtime.getDeployRange()?.defenderMinX) || 0,
          pointerX: Number(pointerWorldRef.current?.x) || 0,
          pointerY: Number(pointerWorldRef.current?.y) || 0,
          pointerValid: pointerWorldRef.current?.valid !== false,
          isPanning: !!panDragRef.current,
          panStartDistance: Number(panDragRef.current?.startDistance) || 0,
          panStartPitch: Number(panDragRef.current?.startPitch) || 0,
          followTargetX: Number(lockAnchor?.x) || 0,
          followTargetY: Number(lockAnchor?.y) || 0,
          followTargetSquadId: String(lockAnchor?.squadId || followTargetSquadId || ''),
          focusActualX: Number((followedSquad || followedDeployGroup)?.x) || 0,
          focusActualY: Number((followedSquad || followedDeployGroup)?.y) || 0,
          focusActualSquadId: String((followedSquad || followedDeployGroup)?.id || ''),
          focusActualResolved: !!(followedSquad || followedDeployGroup)
        });
        if (debugEnabled) {
          setDebugStats(runtime.getDebugStats());
        }

        if (runtime.isEnded() && !reportedRef.current) {
          reportedRef.current = true;
          const summary = runtime.getSummary();
          setResultState({ open: true, submitting: false, error: '', summary, recorded: false });
          reportBattleResult(summary);
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      lastFrameRef.current = 0;
      lastUiSyncRef.current = 0;
      fpsStateRef.current = { windowSec: 0, frames: 0 };
    };
  }, [open, loading, error, glError, reportBattleResult, debugEnabled]);

  const handleTogglePause = useCallback(() => {
    const next = !paused;
    setPaused(next);
    clockRef.current.setPaused(next);
  }, [paused]);

  const handleTogglePitch = useCallback(() => {
    if (runtimeRef.current?.getPhase() !== 'battle') return;
    cameraRef.current.togglePitchMode();
  }, []);

  const handleStartBattle = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const result = runtime.startBattle();
    if (!result?.ok) {
      setResultState((prev) => ({ ...prev, open: true, error: result?.reason || '无法开战', summary: null }));
      return;
    }
    const attacker = runtime.getCardRows().find((row) => row.team === TEAM_ATTACKER && row.alive);
    if (attacker) {
      runtime.setFocusSquad(attacker.id);
      runtime.setSelectedBattleSquad(attacker.id);
      setSelectedSquadId(attacker.id);
      const anchor = runtime.getFocusAnchor();
      cameraRef.current.centerX = Number(anchor?.x) || 0;
      cameraRef.current.centerY = Number(anchor?.y) || 0;
      cameraRef.current.yawDeg = BATTLE_FOLLOW_YAW_DEG;
      cameraRef.current.worldYawDeg = BATTLE_FOLLOW_WORLD_YAW_DEG;
      cameraRef.current.mirrorX = BATTLE_FOLLOW_MIRROR_X;
      cameraRef.current.pitchLow = BATTLE_PITCH_LOW_DEG;
      cameraRef.current.pitchHigh = BATTLE_PITCH_HIGH_DEG;
      cameraRef.current.currentPitch = cameraRef.current.pitchLow;
      cameraRef.current.pitchFrom = cameraRef.current.pitchLow;
      cameraRef.current.pitchTo = cameraRef.current.pitchLow;
      cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
    }
    setPhase(runtime.getPhase());
    setBattleStatus(runtime.getBattleStatus());
    setCards(runtime.getCardRows());
    setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setWorldActionsVisibleForSquadId(attacker?.id || '');
    setHoverSquadIdOnCard('');
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setSkillConfirmState(null);
    setMarchModePickOpen(false);
    setMarchPopupPos({ x: 120, y: 120 });
    setDeployDraggingGroup({ groupId: '', team: TEAM_ATTACKER });
    setDeployActionAnchorMode('');
    setDeployEditorOpen(false);
    setSelectedPaletteItemId('');
    setQuickDeployOpen(false);
    setQuickDeployApplying(false);
    setQuickDeployError('');
  }, []);

  const handleCardFocus = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy' && !isTrainingMode) {
      const row = runtime.getCardRows().find((item) => item.id === squadId);
      if (row?.team === TEAM_DEFENDER) return;
    }
    runtime.setFocusSquad(squadId);
    if (runtime.getPhase() === 'deploy') {
      setDeployActionAnchorMode('card');
    } else {
      setWorldActionsVisibleForSquadId(String(squadId || ''));
    }
  }, [isTrainingMode]);

  const handleCardSelect = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      if (!isTrainingMode) {
        const row = runtime.getCardRows().find((item) => item.id === squadId);
        if (row?.team === TEAM_DEFENDER) return;
      }
      runtime.setSelectedDeployGroup(squadId);
      runtime.setFocusSquad(squadId);
      setSelectedSquadId(squadId);
      setCards(runtime.getCardRows());
      setDeployActionAnchorMode('card');
      return;
    }
    if (runtime.setSelectedBattleSquad(squadId)) {
      setSelectedSquadId(squadId);
      runtime.setFocusSquad(squadId);
      const anchor = runtime.getFocusAnchor();
      cameraRef.current.beginFocusTransition(anchor);
      setWorldActionsVisibleForSquadId(squadId);
      setBattleUiMode((prev) => (
        prev === BATTLE_UI_MODE_PATH || prev === BATTLE_UI_MODE_SKILL_CONFIRM || prev === BATTLE_UI_MODE_MARCH_PICK
          ? prev
          : BATTLE_UI_MODE_NONE
      ));
      setCards(runtime.getCardRows());
    }
  }, [isTrainingMode]);

  const resolveEventWorldPoint = useCallback((event) => {
    const canvas = glCanvasRef.current;
    if (!canvas || !cameraStateRef.current) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const world = cameraRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    pointerWorldRef.current = world;
    if (!Number.isFinite(Number(world?.x)) || !Number.isFinite(Number(world?.y))) return null;
    return world;
  }, []);

  const isPointInsideBattleField = useCallback((point) => {
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    const field = runtime.getField?.();
    const halfW = Math.max(10, Number(field?.width) || 900) * 0.5;
    const halfH = Math.max(10, Number(field?.height) || 620) * 0.5;
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x >= -halfW && x <= halfW && y >= -halfH && y <= halfH;
  }, []);

  const isPathPointBlocked = useCallback((point) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return true;
    if (!isPointInsideBattleField(point)) return true;
    const hit = runtime.pickBuilding(point, 8);
    return !!hit;
  }, [isPointInsideBattleField]);

  const resolvePopupPos = useCallback((payload, fallbackWorld = null) => {
    const canvas = glCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) {
      return { x: 120, y: 120 };
    }
    let x = Number(payload?.clientX) - rect.left;
    let y = Number(payload?.clientY) - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (fallbackWorld && worldToDomRef.current) {
        const dom = worldToDomRef.current({ x: fallbackWorld.x, y: fallbackWorld.y, z: 0 });
        if (dom?.visible) {
          x = Number(dom.x);
          y = Number(dom.y);
        }
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = rect.width * 0.5;
      y = rect.height * 0.5;
    }
    return {
      x: clamp(x, 16, Math.max(16, rect.width - 16)),
      y: clamp(y, 16, Math.max(16, rect.height - 16))
    };
  }, []);

  const setClockPaused = useCallback((nextPaused) => {
    setPaused(!!nextPaused);
    clockRef.current.setPaused(!!nextPaused);
  }, []);

  const syncBattleCards = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setCards(runtime.getCardRows());
  }, []);

  const selectBattleSquad = useCallback((squadId, showActions = true) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return false;
    if (!runtime.setSelectedBattleSquad(squadId)) return false;
    runtime.setFocusSquad(squadId);
    const anchor = runtime.getFocusAnchor();
    cameraRef.current.beginFocusTransition(anchor);
    setSelectedSquadId(squadId);
    if (showActions) {
      setWorldActionsVisibleForSquadId(squadId);
    }
    syncBattleCards();
    return true;
  }, [syncBattleCards]);

  const closeSkillConfirm = useCallback((resumeBattle = true) => {
    setSkillConfirmState(null);
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    if (resumeBattle) setClockPaused(false);
  }, [setClockPaused]);

  const closeSkillPick = useCallback(() => {
    if (battleUiMode === BATTLE_UI_MODE_SKILL_PICK) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
    }
    setSkillPopupSquadId('');
  }, [battleUiMode]);

  const commitPathPlanning = useCallback((commit = true) => {
    const runtime = runtimeRef.current;
    if (runtime && commit && selectedSquadId) {
      runtime.commandSetWaypoints(selectedSquadId, pendingPathPoints, { inputType: 'path_planning' });
      syncBattleCards();
    }
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setClockPaused(false);
  }, [selectedSquadId, pendingPathPoints, setClockPaused, syncBattleCards]);

  const closeMarchModePick = useCallback(() => {
    setMarchModePickOpen(false);
    if (battleUiMode === BATTLE_UI_MODE_MARCH_PICK) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setClockPaused(false);
    }
  }, [battleUiMode, setClockPaused]);

  const executeBattleAction = useCallback((squadId, actionId, payload = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    if (!selectBattleSquad(squadId, true)) return;
    const squad = runtime.getSquadById(squadId);
    if (!squad) return;
    const popupPos = resolvePopupPos(payload, { x: Number(squad.x) || 0, y: Number(squad.y) || 0 });

    if (actionId !== 'marchMode') {
      closeMarchModePick();
    }
    if (actionId !== 'skills') {
      closeSkillPick();
    }

    if (actionId === 'planPath') {
      setPendingPathPoints([]);
      setPlanningHoverPoint(null);
      setBattleUiMode(BATTLE_UI_MODE_PATH);
      setClockPaused(true);
      return;
    }
    if (actionId === 'marchMode') {
      setBattleUiMode(BATTLE_UI_MODE_MARCH_PICK);
      setMarchModePickOpen(true);
      setMarchPopupPos(popupPos);
      setClockPaused(true);
      return;
    }
    if (actionId === 'freeAttack') {
      runtime.commandGuard(squadId, {
        centerX: Number(squad.x) || 0,
        centerY: Number(squad.y) || 0,
        radius: Math.max(42, Number(squad.radius) || 24)
      });
      setBattleUiMode(BATTLE_UI_MODE_GUARD);
      setTimeout(() => setBattleUiMode(BATTLE_UI_MODE_NONE), 0);
      syncBattleCards();
      return;
    }
    if (actionId === 'skills') {
      setSkillPopupPos(popupPos);
      setSkillPopupSquadId(squadId);
      setBattleUiMode(BATTLE_UI_MODE_SKILL_PICK);
      setSkillConfirmState(null);
      return;
    }
    if (actionId === 'standby') {
      runtime.commandBehavior(squadId, 'standby');
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      syncBattleCards();
      return;
    }
    if (actionId === 'retreat') {
      runtime.commandBehavior(squadId, 'retreat');
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      syncBattleCards();
    }
  }, [setClockPaused, selectBattleSquad, syncBattleCards, closeMarchModePick, closeSkillPick, resolvePopupPos]);

  const handleMapCommand = useCallback((event) => {
    if (event.button !== 0) return;
    const runtime = runtimeRef.current;
    const world = resolveEventWorldPoint(event);
    if (!runtime || !world) return;

    if (runtime.getPhase() !== 'deploy') return;
    if (deployDraggingGroupId) {
      if (!runtime.canDeployAt(world, deployDraggingTeam, 10)) {
        setDeployNotice(deployDraggingTeam === TEAM_DEFENDER
          ? '中间交战区不可部署，请放置在右侧红色区域'
          : '中间交战区不可部署，请放置在左侧蓝色区域');
        return;
      }
      runtime.moveDeployGroup(deployDraggingGroupId, world, deployDraggingTeam);
      runtime.setDeployGroupPlaced(deployDraggingTeam, deployDraggingGroupId, true);
      runtime.setSelectedDeployGroup(deployDraggingGroupId);
      runtime.setFocusSquad(deployDraggingGroupId);
      setSelectedSquadId(deployDraggingGroupId);
      setDeployDraggingGroup({ groupId: '', team: TEAM_ATTACKER });
      setDeployActionAnchorMode('world');
      setDeployNotice(`部队已放置，可继续编辑或${isTrainingMode ? '开始训练' : '开战'}`);
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }
    if (isTrainingMode && selectedPaletteItemId) {
      const placeResult = runtime.placeBuilding({
        itemId: selectedPaletteItemId,
        x: world.x,
        y: world.y,
        z: 0,
        rotation: 0
      });
      if (!placeResult?.ok) {
        setDeployNotice(placeResult?.reason || '物品放置失败');
        return;
      }
      setDeployNotice('物品已放置，可继续布置');
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }
    const picked = runtime.pickDeployGroup(world, isTrainingMode ? 'any' : TEAM_ATTACKER);
    if (picked?.id) {
      runtime.setSelectedDeployGroup(picked.id);
      runtime.setFocusSquad(picked.id);
      setSelectedSquadId(picked.id);
      setDeployActionAnchorMode('world');
      setCards(runtime.getCardRows());
      return;
    }
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
  }, [deployDraggingGroupId, deployDraggingTeam, isTrainingMode, selectedPaletteItemId, resolveEventWorldPoint]);

  const clearPanDrag = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
  }, []);

  const clearDeployYawDrag = useCallback(() => {
    deployYawDragRef.current = null;
  }, []);

  const beginPanDrag = useCallback((event, buttonMask = 1) => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    panDragRef.current = {
      prevPx: px,
      prevPy: py,
      buttonMask,
      startDistance: Number(cameraRef.current.distance) || CAMERA_DISTANCE_MIN,
      startPitch: Number(cameraRef.current.currentPitch) || DEPLOY_PITCH_DEG
    };
    setIsPanning(true);
    event.preventDefault();
  }, []);

  const handleSceneMouseDown = useCallback((event) => {
    const target = event.target;
    if (
      target
      && typeof target.closest === 'function'
      && target.closest('.pve2-world-actions, .pve2-battle-actions, .pve2-card-actions, .pve2-deploy-creator, .pve2-deploy-sidebar, .pve2-minimap-wrap, .pve2-action-pad, .pve2-skill-float, .pve2-march-float, .pve2-path-confirm-btn, .pve2-hud, .pve2-confirm, .pve2-quick-deploy-backdrop, .pve2-quick-deploy-panel, .number-pad-dialog-overlay, .number-pad-dialog')
    ) {
      return;
    }
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const currentPhase = runtime.getPhase();
    if (currentPhase === 'deploy') {
      if (event.button === 2) {
        deployYawDragRef.current = {
          startX: Number(event.clientX) || 0,
          startWorldYawDeg: Number(cameraRef.current.worldYawDeg) || 0,
          moved: false
        };
        event.preventDefault();
        return;
      }
      if (event.button === 1) {
        beginPanDrag(event, 4);
        return;
      }
      if (event.button === 0 && spacePressedRef.current) {
        beginPanDrag(event, 1);
        return;
      }
    }
    if (currentPhase !== 'battle') {
      handleMapCommand(event);
      return;
    }
    const world = resolveEventWorldPoint(event);
    if (!world) return;
    const selected = runtime.getSquadById(selectedSquadId);

    if (battleUiMode === BATTLE_UI_MODE_MARCH_PICK) {
      closeMarchModePick();
      return;
    }

    if (event.button === 2) {
      event.preventDefault();
      if (battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM) {
        closeSkillConfirm(true);
        return;
      }
      if (battleUiMode === BATTLE_UI_MODE_PATH) {
        setPendingPathPoints((prev) => {
          if (prev.length > 0) return prev.slice(0, prev.length - 1);
          setBattleUiMode(BATTLE_UI_MODE_NONE);
          setPlanningHoverPoint(null);
          setClockPaused(false);
          return prev;
        });
        return;
      }
      if (battleUiMode === BATTLE_UI_MODE_SKILL_PICK) {
        closeSkillPick();
        return;
      }
      if (selected && selected.team === TEAM_ATTACKER && selected.remain > 0) {
        runtime.commandMove(selected.id, world, { append: false, replace: true, orderType: ORDER_MOVE, inputType: 'battle_rmb_move' });
        syncBattleCards();
      }
      return;
    }
    if (event.button !== 0) return;

    if (battleUiMode === BATTLE_UI_MODE_SKILL_PICK) {
      closeSkillPick();
    }

    if (battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM) {
      if (!skillConfirmState || !selected || selected.id !== skillConfirmState.squadId) return;
      const centerX = Number(skillConfirmState?.center?.x) || Number(selected.x) || 0;
      const centerY = Number(skillConfirmState?.center?.y) || Number(selected.y) || 0;
      if (skillConfirmState.kind === 'infantry') {
        runtime.commandSkill(selected.id, { kind: 'infantry', x: centerX, y: centerY });
      } else if (skillConfirmState.kind === 'cavalry') {
        const dirX = Number(skillConfirmState?.dir?.x) || 1;
        const dirY = Number(skillConfirmState?.dir?.y) || 0;
        const len = Math.max(18, Number(skillConfirmState?.len) || 80);
        runtime.commandSkill(selected.id, {
          kind: 'cavalry',
          x: centerX + (dirX * len),
          y: centerY + (dirY * len),
          dirX,
          dirY,
          distance: len
        });
      } else if (skillConfirmState.hoverPoint) {
        runtime.commandSkill(selected.id, {
          kind: skillConfirmState.kind,
          x: skillConfirmState.hoverPoint.x,
          y: skillConfirmState.hoverPoint.y
        });
      }
      closeSkillConfirm(true);
      syncBattleCards();
      return;
    }

    if (battleUiMode === BATTLE_UI_MODE_PATH) {
      if (isPathPointBlocked(world)) return;
      setPendingPathPoints((prev) => [...prev, { x: world.x, y: world.y }]);
      return;
    }

    const pickedSquadId = runtime.pickSquadAtPoint(world.x, world.y, { team: TEAM_ATTACKER, maxDist: 34 });
    if (pickedSquadId) {
      selectBattleSquad(pickedSquadId, true);
      return;
    }
    setWorldActionsVisibleForSquadId('');
    if (battleUiMode !== BATTLE_UI_MODE_NONE) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setSkillPopupSquadId('');
    }
  }, [
    beginPanDrag,
    handleMapCommand,
    resolveEventWorldPoint,
    battleUiMode,
    closeSkillConfirm,
    closeSkillPick,
    closeMarchModePick,
    selectedSquadId,
    skillConfirmState,
    setClockPaused,
    selectBattleSquad,
    syncBattleCards,
    isPathPointBlocked
  ]);

  const handleSceneWheel = useCallback((event) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'battle') {
      event.preventDefault();
      return;
    }
    if (runtime.getPhase() !== 'deploy') return;
    if (panDragRef.current) return;
    event.preventDefault();
    const nextDistance = cameraRef.current.distance + (event.deltaY < 0 ? -CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP);
    cameraRef.current.distance = clamp(nextDistance, CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX);
  }, []);

  const handleMinimapClick = useCallback((worldPoint) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      if (!deployDraggingGroupId) return;
      if (!runtime.canDeployAt(worldPoint, deployDraggingTeam, 10)) {
        setDeployNotice(deployDraggingTeam === TEAM_DEFENDER
          ? '中间交战区不可部署，请放置在右侧红色区域'
          : '中间交战区不可部署，请放置在左侧蓝色区域');
        return;
      }
      runtime.moveDeployGroup(deployDraggingGroupId, worldPoint, deployDraggingTeam);
      runtime.setDeployGroupPlaced(deployDraggingTeam, deployDraggingGroupId, true);
      runtime.setSelectedDeployGroup(deployDraggingGroupId);
      runtime.setFocusSquad(deployDraggingGroupId);
      setSelectedSquadId(deployDraggingGroupId);
      setDeployDraggingGroup({ groupId: '', team: TEAM_ATTACKER });
      setDeployActionAnchorMode('world');
      setDeployNotice(`部队已放置，可继续编辑或${isTrainingMode ? '开始训练' : '开战'}`);
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }
    if (runtime.getPhase() !== 'battle') return;
    cameraRef.current.centerX = Number(worldPoint?.x) || 0;
    cameraRef.current.centerY = Number(worldPoint?.y) || 0;
  }, [deployDraggingGroupId, deployDraggingTeam, isTrainingMode]);

  const handlePointerMove = useCallback((event) => {
    const runtime = runtimeRef.current;
    const canvas = glCanvasRef.current;
    if (!runtime || !canvas) return;
    if (panDragRef.current || deployYawDragRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const world = cameraRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    pointerWorldRef.current = world;

    if (runtime.getPhase() === 'deploy' && deployDraggingGroupId) {
      runtime.moveDeployGroup(deployDraggingGroupId, world, deployDraggingTeam);
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }

    if (runtime.getPhase() !== 'battle') return;
    if (battleUiMode === BATTLE_UI_MODE_PATH) {
      if (isPathPointBlocked(world)) {
        setPlanningHoverPoint(null);
      } else {
        setPlanningHoverPoint({ x: world.x, y: world.y });
      }
      return;
    }
    if (battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM && skillConfirmState?.squadId) {
      const selected = runtime.getSquadById(skillConfirmState.squadId);
      if (!selected) return;
      const centerX = Number(skillConfirmState?.center?.x) || Number(selected.x) || 0;
      const centerY = Number(skillConfirmState?.center?.y) || Number(selected.y) || 0;
      if (skillConfirmState.kind === 'cavalry') {
        const dx = world.x - centerX;
        const dy = world.y - centerY;
        const len = Math.hypot(dx, dy) || 1;
        const clampedLen = clamp(len, 18, skillRangeByClass('cavalry'));
        setSkillConfirmState((prev) => (prev ? {
          ...prev,
          dir: { x: dx / len, y: dy / len },
          len: clampedLen,
          hoverPoint: { x: world.x, y: world.y }
        } : prev));
        return;
      }
      if (skillConfirmState.kind === 'archer' || skillConfirmState.kind === 'artillery') {
        const maxRange = skillRangeByClass(skillConfirmState.kind);
        const sx = centerX;
        const sy = centerY;
        const dx = world.x - sx;
        const dy = world.y - sy;
        const dist = Math.hypot(dx, dy) || 1;
        const tx = dist > maxRange ? sx + (dx / dist) * maxRange : world.x;
        const ty = dist > maxRange ? sy + (dy / dist) * maxRange : world.y;
        setSkillConfirmState((prev) => (prev ? {
          ...prev,
          hoverPoint: { x: tx, y: ty }
        } : prev));
        return;
      }
    }

    if (!aimState.active) return;
    const selected = runtime.getSquadById(aimState.squadId);
    if (!selected) return;
    const center = worldToScreenRef.current ? worldToScreenRef.current({ x: world.x, y: world.y, z: 0 }) : null;
    const edge = worldToScreenRef.current ? worldToScreenRef.current({ x: world.x + skillAoeRadiusByClass(selected.classTag), y: world.y, z: 0 }) : null;
    const radiusPx = center && edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : 22;
    setAimState((prev) => ({ ...prev, point: { x: world.x, y: world.y }, radiusPx }));
  }, [aimState, deployDraggingGroupId, deployDraggingTeam, battleUiMode, skillConfirmState, isPathPointBlocked]);

  useEffect(() => {
    if (!open) return undefined;
    const handleWindowMouseMove = (event) => {
      const canvas = glCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const runtime = runtimeRef.current;
      const isDeploy = runtime?.getPhase() === 'deploy';
      if (!isDeploy) {
        clearPanDrag();
        clearDeployYawDrag();
        return;
      }

      const rotate = deployYawDragRef.current;
      if (rotate) {
        if ((event.buttons & 2) !== 2) {
          clearDeployYawDrag();
        } else {
          const dx = (Number(event.clientX) || 0) - (Number(rotate.startX) || 0);
          if (Math.abs(dx) >= DEPLOY_ROTATE_CLICK_THRESHOLD) rotate.moved = true;
          cameraRef.current.worldYawDeg = normalizeDeg((Number(rotate.startWorldYawDeg) || 0) + (dx * DEPLOY_ROTATE_SENSITIVITY));
        }
      }

      const pan = panDragRef.current;
      if (!pan) return;
      if ((event.buttons & pan.buttonMask) !== pan.buttonMask) {
        clearPanDrag();
        return;
      }
      const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
      const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
      cameraRef.current.distance = Number(pan.startDistance) || cameraRef.current.distance;
      cameraRef.current.currentPitch = Number(pan.startPitch) || cameraRef.current.currentPitch;
      cameraRef.current.pitchFrom = cameraRef.current.currentPitch;
      cameraRef.current.pitchTo = cameraRef.current.currentPitch;
      cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
      const dxPx = px - pan.prevPx;
      const dyPx = py - pan.prevPy;
      const viewW = Math.max(1, Number(cameraViewRectRef.current?.widthWorld) || 1);
      const viewH = Math.max(1, Number(cameraViewRectRef.current?.heightWorld) || 1);
      cameraRef.current.centerX += (dxPx / Math.max(1, canvas.width)) * viewW;
      cameraRef.current.centerY -= (dyPx / Math.max(1, canvas.height)) * viewH;
      pan.prevPx = px;
      pan.prevPy = py;
    };

    const handleWindowMouseUp = (event) => {
      const rotate = deployYawDragRef.current;
      if (rotate && !rotate.moved && runtimeRef.current?.getPhase() === 'deploy') {
        handleMapCommand({
          button: 0,
          clientX: Number(event?.clientX) || 0,
          clientY: Number(event?.clientY) || 0,
          shiftKey: !!event?.shiftKey
        });
      }
      clearPanDrag();
      clearDeployYawDrag();
    };
    const handleWindowBlur = () => {
      clearPanDrag();
      clearDeployYawDrag();
      spacePressedRef.current = false;
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [open, clearPanDrag, clearDeployYawDrag, handleMapCommand]);

  const handleSetSpeedMode = useCallback((mode) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const selected = runtime.getSquadById(selectedSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;
    runtime.commandSpeedMode([selected.id], mode, 'USER');
    setCards(runtime.getCardRows());
  }, [selectedSquadId]);

  const handleCycleSpeedMode = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const row = runtime.getCardRows().find((item) => item.id === selectedSquadId);
    const current = row
      ? (row.speedModeAuthority === 'USER' ? (row.speedMode || SPEED_MODE_B) : SPEED_MODE_AUTO)
      : SPEED_MODE_B;
    const idx = Math.max(0, SPEED_MODE_CYCLE.indexOf(current));
    const next = SPEED_MODE_CYCLE[(idx + 1) % SPEED_MODE_CYCLE.length];
    handleSetSpeedMode(next);
  }, [selectedSquadId, handleSetSpeedMode]);

  const handleBattleActionClick = useCallback((squadId, actionId, payload = null) => {
    executeBattleAction(squadId, actionId, payload);
  }, [executeBattleAction]);

  const handleSkillPick = useCallback((skill, meta = {}) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const candidateSquadId = typeof meta?.squadId === 'string' && meta.squadId
      ? meta.squadId
      : selectedSquadId;
    const selected = runtime.getSquadById(candidateSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;
    if (selected.id !== selectedSquadId) {
      selectBattleSquad(selected.id, true);
    }
    if (!skill?.available) return;
    closeSkillPick();
    const kind = (skill.kind === 'infantry' || skill.kind === 'cavalry' || skill.kind === 'archer' || skill.kind === 'artillery')
      ? skill.kind
      : (selected.classTag || 'infantry');
    const center = skill?.anchor && Number.isFinite(Number(skill.anchor.x)) && Number.isFinite(Number(skill.anchor.y))
      ? { x: Number(skill.anchor.x), y: Number(skill.anchor.y) }
      : (
        selected?.classCenters?.[kind]
          ? {
            x: Number(selected.classCenters[kind].x) || Number(selected.x) || 0,
            y: Number(selected.classCenters[kind].y) || Number(selected.y) || 0
          }
          : { x: Number(selected.x) || 0, y: Number(selected.y) || 0 }
      );
    if (kind === 'infantry') {
      runtime.commandSkill(selected.id, {
        kind: 'infantry',
        x: center.x,
        y: center.y
      });
      setSkillConfirmState(null);
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setClockPaused(false);
      syncBattleCards();
      return;
    }
    if (kind === 'cavalry') {
      const dirX = Number(selected.dirX) || 1;
      const dirY = Number(selected.dirY) || 0;
      const len = 82;
      setSkillConfirmState({
        squadId: selected.id,
        kind: 'cavalry',
        center,
        dir: { x: dirX, y: dirY },
        len,
        aoeRadius: 0,
        hoverPoint: { x: center.x + (dirX * len), y: center.y + (dirY * len) }
      });
      setBattleUiMode(BATTLE_UI_MODE_SKILL_CONFIRM);
      setClockPaused(true);
      return;
    }
    const aoeRadius = skillAoeRadiusByClass(kind);
    setSkillConfirmState({
      squadId: selected.id,
      kind: kind === 'artillery' ? 'artillery' : 'archer',
      center,
      dir: { x: 1, y: 0 },
      len: 0,
      aoeRadius,
      hoverPoint: { x: center.x, y: center.y }
    });
    setBattleUiMode(BATTLE_UI_MODE_SKILL_CONFIRM);
    setClockPaused(true);
  }, [selectedSquadId, setClockPaused, selectBattleSquad, closeSkillPick, syncBattleCards]);

  const handleFinishPathPlanning = useCallback(() => {
    commitPathPlanning(true);
  }, [commitPathPlanning]);

  const handlePickMarchMode = useCallback((mode) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle' || !selectedSquadId) return;
    runtime.commandMarchMode(selectedSquadId, mode);
    syncBattleCards();
    closeMarchModePick();
  }, [selectedSquadId, syncBattleCards, closeMarchModePick]);

  const handleOpenDeployCreator = useCallback((team = TEAM_ATTACKER) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const rows = runtime.getRosterRows(safeTeam);
    if (rows.length <= 0 || rows.every((row) => row.total <= 0)) {
      setDeployNotice('当前没有可用兵种库存，无法新建部队');
      return;
    }
    setDeployEditorTeam(safeTeam);
    setDeployEditingGroupId('');
    setDeployEditorDraft({ name: '', units: [] });
    setDeployEditorOpen(true);
    setDeployQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 1
    });
    setDeployNotice('');
  }, []);

  const handleOpenDeployEditorForGroup = useCallback((groupId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) {
      setDeployNotice('未找到可编辑部队');
      return;
    }
    if (!isTrainingMode && group.team === TEAM_DEFENDER) {
      setDeployNotice('当前模式不可编辑敌方部队');
      return;
    }
    const draftUnits = Object.entries(group.units || {}).map(([unitTypeId, count]) => ({
      unitTypeId,
      count: Math.max(1, Math.floor(Number(count) || 1))
    }));
    setDeployEditorTeam(group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER);
    setDeployEditingGroupId(group.id);
    setDeployEditorDraft({
      name: group.name || '',
      units: normalizeDraftUnits(draftUnits)
    });
    setDeployEditorOpen(true);
    setDeployQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 1
    });
    setDeployNotice('');
  }, [isTrainingMode]);

  const resolveDeployUnitMax = useCallback((unitTypeId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return 0;
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return 0;
    const rosterRow = runtime.getRosterRows(deployEditorTeam).find((row) => row.unitTypeId === safeId);
    const baseAvailable = Math.max(0, Math.floor(Number(rosterRow?.available) || 0));
    if (!deployEditingGroupId) return baseAvailable;
    const editingGroup = runtime.getDeployGroupById(deployEditingGroupId, deployEditorTeam);
    const existing = Math.max(0, Math.floor(Number(editingGroup?.units?.[safeId]) || 0));
    return baseAvailable + existing;
  }, [deployEditingGroupId, deployEditorTeam]);

  const openDeployQuantityDialog = useCallback((unitTypeId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    const max = resolveDeployUnitMax(safeId);
    if (max <= 0) {
      setDeployNotice('该兵种没有可分配数量');
      return;
    }
    const unitName = runtime.getRosterRows(deployEditorTeam).find((row) => row.unitTypeId === safeId)?.unitName || safeId;
    const current = normalizeDraftUnits(deployEditorDraft.units).find((entry) => entry.unitTypeId === safeId)?.count || 1;
    setDeployQuantityDialog({
      open: true,
      unitTypeId: safeId,
      unitName,
      max,
      current: clamp(current, 1, max)
    });
  }, [deployEditorDraft.units, resolveDeployUnitMax, deployEditorTeam]);

  const handleDeployEditorDrop = useCallback((event) => {
    event.preventDefault();
    const droppedUnitTypeId = event.dataTransfer?.getData('application/x-deploy-unit-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    setDeployEditorDragUnitId('');
    openDeployQuantityDialog(droppedUnitTypeId);
  }, [openDeployQuantityDialog]);

  const handleConfirmDeployQuantity = useCallback((qty) => {
    const safeId = typeof deployQuantityDialog?.unitTypeId === 'string' ? deployQuantityDialog.unitTypeId.trim() : '';
    if (!safeId) {
      setDeployQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 });
      return;
    }
    const max = Math.max(1, Math.floor(Number(deployQuantityDialog.max) || 1));
    const safeQty = clamp(Math.floor(Number(qty) || 1), 1, max);
    setDeployEditorDraft((prev) => {
      const source = normalizeDraftUnits(prev?.units || []);
      const idx = source.findIndex((entry) => entry.unitTypeId === safeId);
      if (idx >= 0) {
        source[idx] = { ...source[idx], count: safeQty };
      } else {
        source.push({ unitTypeId: safeId, count: safeQty });
      }
      return { ...prev, units: normalizeDraftUnits(source) };
    });
    setDeployQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 });
  }, [deployQuantityDialog]);

  const handleRemoveDraftUnit = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setDeployEditorDraft((prev) => ({
      ...prev,
      units: normalizeDraftUnits(prev?.units || []).filter((entry) => entry.unitTypeId !== safeId)
    }));
  }, []);

  const handleSaveDeployEditor = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const draftUnits = normalizeDraftUnits(deployEditorDraft.units);
    if (draftUnits.length <= 0) {
      setDeployNotice('请至少添加一个兵种到部队编组');
      return;
    }
    const unitsMap = unitsToMap(draftUnits);
    let targetGroupId = '';
    const safeTeam = deployEditorTeam === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (deployEditingGroupId) {
      const result = runtime.updateDeployGroup(safeTeam, deployEditingGroupId, {
        name: deployEditorDraft.name,
        units: unitsMap
      });
      if (!result?.ok) {
        setDeployNotice(result?.reason || '编辑部队失败');
        return;
      }
      targetGroupId = deployEditingGroupId;
    } else {
      const result = runtime.createDeployGroup(safeTeam, {
        name: deployEditorDraft.name,
        units: unitsMap,
        x: pointerWorldRef.current.x,
        y: pointerWorldRef.current.y,
        placed: false
      });
      if (!result?.ok) {
        setDeployNotice(result?.reason || '新建部队失败');
        return;
      }
      targetGroupId = result.groupId;
    }
    runtime.setSelectedDeployGroup(targetGroupId);
    runtime.setFocusSquad(targetGroupId);
    runtime.setDeployGroupPlaced(safeTeam, targetGroupId, false);
    setSelectedSquadId(targetGroupId);
    setDeployDraggingGroup({ groupId: targetGroupId, team: safeTeam });
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setDeployEditorOpen(false);
    setDeployEditingGroupId('');
    setDeployEditorTeam(TEAM_ATTACKER);
    setDeployEditorDraft({ name: '', units: [] });
    setDeployNotice(`部队已创建，移动鼠标并点击地图放置到${safeTeam === TEAM_DEFENDER ? '右侧红色' : '左侧蓝色'}部署区`);
  }, [deployEditingGroupId, deployEditorDraft, deployEditorTeam]);

  const buildTemplateFillSnapshot = useCallback((template, team = TEAM_ATTACKER) => {
    const runtime = runtimeRef.current;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (!runtime) {
      return { rows: [], totalRequested: 0, totalFilled: 0 };
    }
    const rosterRows = runtime.getRosterRows(safeTeam);
    const rosterMap = new Map(
      (Array.isArray(rosterRows) ? rosterRows : []).map((row) => ([
        row.unitTypeId,
        {
          available: Math.max(0, Math.floor(Number(row?.available) || 0)),
          unitName: row?.unitName || row?.unitTypeId || ''
        }
      ]))
    );
    const rows = normalizeTemplateUnits(template?.units || []).map((entry) => {
      const rosterInfo = rosterMap.get(entry.unitTypeId) || { available: 0, unitName: entry.unitTypeId };
      const requested = Math.max(1, Math.floor(Number(entry.count) || 1));
      const filled = Math.max(0, Math.min(requested, rosterInfo.available));
      const fillPercent = requested > 0 ? Math.max(0, Math.min(100, (filled / requested) * 100)) : 0;
      return {
        unitTypeId: entry.unitTypeId,
        unitName: entry.unitName || rosterInfo.unitName || entry.unitTypeId,
        requested,
        available: rosterInfo.available,
        filled,
        fillPercent
      };
    });
    const totalRequested = rows.reduce((sum, row) => sum + row.requested, 0);
    const totalFilled = rows.reduce((sum, row) => sum + row.filled, 0);
    return { rows, totalRequested, totalFilled };
  }, []);

  const createDeployGroupFromTemplateUnits = useCallback((team, unitsMap, templateName = '') => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return false;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = runtime.createDeployGroup(safeTeam, {
      name: typeof templateName === 'string' ? templateName.trim() : '',
      units: unitsMap,
      x: pointerWorldRef.current.x,
      y: pointerWorldRef.current.y,
      placed: false
    });
    if (!result?.ok) {
      setDeployNotice(result?.reason || '按模板创建部队失败');
      return false;
    }
    const targetGroupId = result.groupId;
    runtime.setSelectedDeployGroup(targetGroupId);
    runtime.setFocusSquad(targetGroupId);
    runtime.setDeployGroupPlaced(safeTeam, targetGroupId, false);
    setSelectedSquadId(targetGroupId);
    setDeployDraggingGroup({ groupId: targetGroupId, team: safeTeam });
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setDeployNotice(`模板部队已创建，移动鼠标并点击地图放置到${safeTeam === TEAM_DEFENDER ? '右侧红色' : '左侧蓝色'}部署区`);
    return true;
  }, []);

  const handleCreateTrainingGroupByTemplate = useCallback((template, team = TEAM_ATTACKER) => {
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const snapshot = buildTemplateFillSnapshot(template, safeTeam);
    const unitsMap = {};
    snapshot.rows.forEach((row) => {
      if (row.filled > 0) {
        unitsMap[row.unitTypeId] = row.filled;
      }
    });
    createDeployGroupFromTemplateUnits(safeTeam, unitsMap, template?.name || '');
  }, [buildTemplateFillSnapshot, createDeployGroupFromTemplateUnits]);

  const handleOpenTemplateFillPreview = useCallback((template, team = TEAM_ATTACKER) => {
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const snapshot = buildTemplateFillSnapshot(template, safeTeam);
    setTemplateFillPreview({
      open: true,
      team: safeTeam,
      template,
      rows: snapshot.rows,
      totalRequested: snapshot.totalRequested,
      totalFilled: snapshot.totalFilled
    });
  }, [buildTemplateFillSnapshot]);

  const handleCloseTemplateFillPreview = useCallback(() => {
    setTemplateFillPreview({
      open: false,
      team: TEAM_ATTACKER,
      template: null,
      rows: [],
      totalRequested: 0,
      totalFilled: 0
    });
  }, []);

  const handleConfirmTemplateFillPreview = useCallback(() => {
    const template = templateFillPreview.template;
    if (!template) return;
    const safeTeam = templateFillPreview.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const snapshot = buildTemplateFillSnapshot(template, safeTeam);
    const unitsMap = {};
    snapshot.rows.forEach((row) => {
      if (row.filled > 0) {
        unitsMap[row.unitTypeId] = row.filled;
      }
    });
    const created = createDeployGroupFromTemplateUnits(safeTeam, unitsMap, template?.name || '');
    if (created) {
      handleCloseTemplateFillPreview();
    }
  }, [templateFillPreview, buildTemplateFillSnapshot, createDeployGroupFromTemplateUnits, handleCloseTemplateFillPreview]);

  const handleDeployMove = useCallback((groupId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    if (!isTrainingMode && group.team === TEAM_DEFENDER) return;
    const safeTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    pointerWorldRef.current = {
      x: Number(group.x) || 0,
      y: Number(group.y) || 0
    };
    runtime.setSelectedDeployGroup(groupId);
    runtime.setFocusSquad(groupId);
    runtime.setDeployGroupPlaced(safeTeam, groupId, false);
    setSelectedSquadId(groupId);
    setDeployDraggingGroup({ groupId, team: safeTeam });
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setDeployNotice(`已拾取部队，移动鼠标并点击地图可重新放置到${safeTeam === TEAM_DEFENDER ? '右侧红色' : '左侧蓝色'}部署区`);
  }, [isTrainingMode]);

  const handleDeployDelete = useCallback((groupId, event = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    if (!isTrainingMode && group.team === TEAM_DEFENDER) return;
    const canvas = glCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    let x = Number(rect?.width) * 0.5 || 220;
    let y = Number(rect?.height) * 0.5 || 140;
    if (event?.currentTarget?.getBoundingClientRect && rect) {
      const targetRect = event.currentTarget.getBoundingClientRect();
      x = (targetRect.left + targetRect.width / 2) - rect.left;
      y = (targetRect.top + targetRect.height / 2) - rect.top;
    } else if (Number.isFinite(Number(event?.clientX)) && Number.isFinite(Number(event?.clientY)) && rect) {
      x = Number(event.clientX) - rect.left;
      y = Number(event.clientY) - rect.top;
    }
    setConfirmDeletePos({
      x: clamp(x, 24, Math.max(24, (Number(rect?.width) || x) - 24)),
      y: clamp(y, 24, Math.max(24, (Number(rect?.height) || y) - 24))
    });
    setConfirmDeleteGroupId(String(groupId || ''));
  }, [isTrainingMode]);

  const handleConfirmDeployDelete = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const groupId = String(confirmDeleteGroupId || '');
    if (!groupId) return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) {
      setConfirmDeleteGroupId('');
      setConfirmDeletePos({ x: 0, y: 0 });
      return;
    }
    if (!isTrainingMode && group.team === TEAM_DEFENDER) {
      setConfirmDeleteGroupId('');
      setConfirmDeletePos({ x: 0, y: 0 });
      return;
    }
    const safeTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = runtime.removeDeployGroup(safeTeam, groupId);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '删除部队失败');
      setConfirmDeleteGroupId('');
      setConfirmDeletePos({ x: 0, y: 0 });
      return;
    }
    const nextSelected = runtime.getDeployGroups()?.selectedId || '';
    setSelectedSquadId(nextSelected);
    setDeployDraggingGroup((prev) => (prev.groupId === groupId ? { groupId: '', team: TEAM_ATTACKER } : prev));
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setConfirmDeleteGroupId('');
    setConfirmDeletePos({ x: 0, y: 0 });
    setDeployNotice('部队已删除');
  }, [confirmDeleteGroupId, isTrainingMode]);

  const syncDeployUiFromRuntime = useCallback((runtime, preferredSelectedId = '') => {
    if (!runtime) return;
    const nextSelectedId = String(preferredSelectedId || runtime.getDeployGroups()?.selectedId || '');
    if (nextSelectedId) {
      runtime.setSelectedDeployGroup(nextSelectedId);
      runtime.setFocusSquad(nextSelectedId);
    }
    setSelectedSquadId(nextSelectedId);
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
  }, []);

  const handleCloseQuickDeploy = useCallback(() => {
    setQuickDeployOpen(false);
    setQuickDeployApplying(false);
    setQuickDeployError('');
  }, []);

  const validateQuickDeployConfig = useCallback((config, runtime) => {
    const attackerTeamCount = parseQuickDeployNumber(config?.attackerTeamCount);
    const defenderTeamCount = parseQuickDeployNumber(config?.defenderTeamCount);
    const attackerTotal = parseQuickDeployNumber(config?.attackerTotal);
    const defenderTotal = parseQuickDeployNumber(config?.defenderTotal);
    if (!Number.isInteger(attackerTeamCount) || attackerTeamCount < 1 || attackerTeamCount > QUICK_DEPLOY_MAX_TEAM_COUNT) {
      return { ok: false, error: `我方部队数需为 1-${QUICK_DEPLOY_MAX_TEAM_COUNT} 的整数` };
    }
    if (!Number.isInteger(defenderTeamCount) || defenderTeamCount < 1 || defenderTeamCount > QUICK_DEPLOY_MAX_TEAM_COUNT) {
      return { ok: false, error: `敌方部队数需为 1-${QUICK_DEPLOY_MAX_TEAM_COUNT} 的整数` };
    }
    if (!Number.isInteger(attackerTotal) || attackerTotal < 1 || attackerTotal > QUICK_DEPLOY_MAX_TOTAL) {
      return { ok: false, error: `我方总人数需为 1-${QUICK_DEPLOY_MAX_TOTAL} 的整数` };
    }
    if (!Number.isInteger(defenderTotal) || defenderTotal < 1 || defenderTotal > QUICK_DEPLOY_MAX_TOTAL) {
      return { ok: false, error: `敌方总人数需为 1-${QUICK_DEPLOY_MAX_TOTAL} 的整数` };
    }
    if (attackerTotal < attackerTeamCount) {
      return { ok: false, error: '我方总人数不能小于我方部队数（每支至少 1 人）' };
    }
    if (defenderTotal < defenderTeamCount) {
      return { ok: false, error: '敌方总人数不能小于敌方部队数（每支至少 1 人）' };
    }
    const attackerRosterRows = runtime.getRosterRows(TEAM_ATTACKER).filter((row) => Math.max(0, Math.floor(Number(row?.total) || 0)) > 0);
    const defenderRosterRows = runtime.getRosterRows(TEAM_DEFENDER).filter((row) => Math.max(0, Math.floor(Number(row?.total) || 0)) > 0);
    if (attackerRosterRows.length <= 0) return { ok: false, error: '我方没有可用兵种，无法一键布置' };
    if (defenderRosterRows.length <= 0) return { ok: false, error: '敌方没有可用兵种，无法一键布置' };
    const attackerCapacity = attackerRosterRows.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.total) || 0)), 0);
    const defenderCapacity = defenderRosterRows.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.total) || 0)), 0);
    if (attackerTotal > attackerCapacity) return { ok: false, error: `我方总人数超出可用上限（${attackerCapacity}）` };
    if (defenderTotal > defenderCapacity) return { ok: false, error: `敌方总人数超出可用上限（${defenderCapacity}）` };
    return {
      ok: true,
      values: {
        attackerTeamCount,
        defenderTeamCount,
        attackerTotal,
        defenderTotal,
        attackerRosterRows,
        defenderRosterRows
      }
    };
  }, []);

  const applyQuickDeploy = useCallback((mode, config) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') {
      setQuickDeployError('仅部署阶段可使用一键布置');
      return false;
    }
    if (!isTrainingMode) {
      setQuickDeployError('仅训练场可使用一键布置');
      return false;
    }

    const validated = validateQuickDeployConfig(config, runtime);
    if (!validated.ok) {
      setQuickDeployError(validated.error || '配置校验失败');
      return false;
    }

    const {
      attackerTeamCount,
      defenderTeamCount,
      attackerTotal,
      defenderTotal,
      attackerRosterRows,
      defenderRosterRows
    } = validated.values;

    try {
      const field = runtime.getField();
      const deployRange = runtime.getDeployRange();
      const attackerPlans = mode === 'standard'
        ? buildStandardGroups({
            teamLabel: '我方',
            teamCount: attackerTeamCount,
            totalPeople: attackerTotal,
            rosterRows: attackerRosterRows
          })
        : buildRandomGroups({
            teamLabel: '我方',
            teamCount: attackerTeamCount,
            totalPeople: attackerTotal,
            rosterRows: attackerRosterRows
          });
      const defenderPlans = mode === 'standard'
        ? buildStandardGroups({
            teamLabel: '敌方',
            teamCount: defenderTeamCount,
            totalPeople: defenderTotal,
            rosterRows: defenderRosterRows
          })
        : buildRandomGroups({
            teamLabel: '敌方',
            teamCount: defenderTeamCount,
            totalPeople: defenderTotal,
            rosterRows: defenderRosterRows
          });

      const attackerPositions = buildTeamPositions({
        team: TEAM_ATTACKER,
        count: attackerPlans.length,
        field,
        deployRange,
        jitter: mode !== 'standard'
      });
      const defenderPositions = buildTeamPositions({
        team: TEAM_DEFENDER,
        count: defenderPlans.length,
        field,
        deployRange,
        jitter: mode !== 'standard'
      });

      setDeployDraggingGroup({ groupId: '', team: TEAM_ATTACKER });
      setDeployActionAnchorMode('');
      setDeployEditorOpen(false);
      setDeployEditingGroupId('');
      setDeployEditorTeam(TEAM_ATTACKER);
      setDeployEditorDraft({ name: '', units: [] });
      setDeployEditorDragUnitId('');
      setDeployQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 });
      setConfirmDeleteGroupId('');
      setConfirmDeletePos({ x: 0, y: 0 });
      setSelectedPaletteItemId('');

      const existing = runtime.getDeployGroups();
      const attackerIds = (existing?.attacker || []).map((group) => String(group?.id || '')).filter(Boolean);
      const defenderIds = (existing?.defender || []).map((group) => String(group?.id || '')).filter(Boolean);
      attackerIds.forEach((groupId) => runtime.removeDeployGroup(TEAM_ATTACKER, groupId));
      defenderIds.forEach((groupId) => runtime.removeDeployGroup(TEAM_DEFENDER, groupId));

      let firstGroupId = '';
      attackerPlans.forEach((plan, idx) => {
        const pos = attackerPositions[idx] || {};
        const result = runtime.createDeployGroup(TEAM_ATTACKER, {
          name: plan.name,
          units: plan.units,
          x: pos.x,
          y: pos.y,
          placed: true
        });
        if (!result?.ok) throw new Error(result?.reason || '创建我方部队失败');
        if (!firstGroupId) firstGroupId = result.groupId || '';
      });
      defenderPlans.forEach((plan, idx) => {
        const pos = defenderPositions[idx] || {};
        const result = runtime.createDeployGroup(TEAM_DEFENDER, {
          name: plan.name,
          units: plan.units,
          x: pos.x,
          y: pos.y,
          placed: true
        });
        if (!result?.ok) throw new Error(result?.reason || '创建敌方部队失败');
      });

      syncDeployUiFromRuntime(runtime, firstGroupId);
      setQuickDeployOpen(false);
      setQuickDeployError('');
      setDeployNotice(
        `${mode === 'standard' ? '标准' : '随机'}配置完成：我方 ${attackerTeamCount} 支 / ${attackerTotal} 人，敌方 ${defenderTeamCount} 支 / ${defenderTotal} 人`
      );
      return true;
    } catch (quickDeployApplyError) {
      setQuickDeployError(quickDeployApplyError?.message || '一键布置失败');
      syncDeployUiFromRuntime(runtime);
      return false;
    }
  }, [isTrainingMode, syncDeployUiFromRuntime, validateQuickDeployConfig]);

  const handleApplyStandardQuickDeploy = useCallback((preset) => {
    if (!preset || quickDeployApplying) return;
    setQuickDeployApplying(true);
    try {
      applyQuickDeploy('standard', {
        attackerTeamCount: String(preset.attackerTeamCount),
        defenderTeamCount: String(preset.defenderTeamCount),
        attackerTotal: String(preset.attackerTotal),
        defenderTotal: String(preset.defenderTotal)
      });
    } finally {
      setQuickDeployApplying(false);
    }
  }, [applyQuickDeploy, quickDeployApplying]);

  const handleApplyRandomQuickDeploy = useCallback(() => {
    if (quickDeployApplying) return;
    setQuickDeployApplying(true);
    try {
      applyQuickDeploy('random', quickDeployRandomForm);
    } finally {
      setQuickDeployApplying(false);
    }
  }, [applyQuickDeploy, quickDeployApplying, quickDeployRandomForm]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (confirmDeleteGroupId) {
          setConfirmDeleteGroupId('');
          setConfirmDeletePos({ x: 0, y: 0 });
          return;
        }
        if (deployQuantityDialog.open) {
          setDeployQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 });
          return;
        }
        if (quickDeployOpen) {
          setQuickDeployOpen(false);
          setQuickDeployApplying(false);
          setQuickDeployError('');
          return;
        }
        if (deployEditorOpen) {
          setDeployEditorOpen(false);
          setDeployEditingGroupId('');
          setDeployEditorDragUnitId('');
          setDeployEditorTeam(TEAM_ATTACKER);
          return;
        }
        if (deployDraggingGroupId) {
          setDeployDraggingGroup({ groupId: '', team: TEAM_ATTACKER });
          setDeployNotice('已取消部队拖拽放置');
          return;
        }
        if (battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM) {
          closeSkillConfirm(true);
          return;
        }
        if (battleUiMode === BATTLE_UI_MODE_PATH) {
          commitPathPlanning(false);
          return;
        }
        if (battleUiMode === BATTLE_UI_MODE_MARCH_PICK || battleUiMode === BATTLE_UI_MODE_SKILL_PICK || battleUiMode === BATTLE_UI_MODE_GUARD) {
          setBattleUiMode(BATTLE_UI_MODE_NONE);
          setSkillPopupSquadId('');
          setMarchModePickOpen(false);
          setClockPaused(false);
          return;
        }
        if (worldActionsVisibleForSquadId) {
          setWorldActionsVisibleForSquadId('');
          return;
        }
        if (aimState.active) {
          setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
          return;
        }
        closeModal();
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (runtimeRef.current?.getPhase() === 'deploy') {
          spacePressedRef.current = true;
          return;
        }
        if (runtimeRef.current?.getPhase() === 'battle') {
          handleTogglePause();
        }
      }
      if (event.key.toLowerCase() === 'v') {
        handleTogglePitch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    open,
    closeModal,
    aimState.active,
    handleTogglePause,
    handleTogglePitch,
    confirmDeleteGroupId,
    deployEditorOpen,
    deployQuantityDialog.open,
    quickDeployOpen,
    deployDraggingGroupId,
    battleUiMode,
    closeSkillConfirm,
    commitPathPlanning,
    worldActionsVisibleForSquadId,
    setClockPaused
  ]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyUp = (event) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
      }
    };
    const onBlur = () => {
      spacePressedRef.current = false;
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !marchModePickOpen) return undefined;
    const handleGlobalPointerDown = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('.pve2-march-float')) {
        return;
      }
      closeMarchModePick();
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [open, marchModePickOpen, closeMarchModePick]);

  useEffect(() => {
    if (!open || battleUiMode !== BATTLE_UI_MODE_SKILL_PICK) return undefined;
    const handleGlobalPointerDown = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('.pve2-skill-float, .pve2-battle-action-btn.skills')) {
        return;
      }
      closeSkillPick();
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [open, battleUiMode, closeSkillPick]);

  useEffect(() => {
    if (!open) {
      runtimeRef.current = null;
      destroyRenderers();
      return;
    }
    return () => {
      runtimeRef.current = null;
      destroyRenderers();
    };
  }, [open, destroyRenderers]);

  const selectedSquad = (() => {
    const runtime = runtimeRef.current;
    if (!runtime) return null;
    if (runtime.getPhase() !== 'battle') return null;
    return runtime.getSquadById(selectedSquadId);
  })();
  const selectedCardRow = cards.find((row) => row.id === selectedSquadId) || null;
  const skillPopupTargetSquadId = (battleUiMode === BATTLE_UI_MODE_SKILL_PICK && skillPopupSquadId)
    ? skillPopupSquadId
    : '';
  const skillPopupMeta = (phase === 'battle' && runtimeRef.current && skillPopupTargetSquadId)
    ? runtimeRef.current.getSkillMetaForSquad(skillPopupTargetSquadId)
    : { skills: [], cooldownRemain: 0 };
  const selectedSpeedModeUi = selectedCardRow
    ? (selectedCardRow.speedModeAuthority === 'USER'
      ? (selectedCardRow.speedMode || SPEED_MODE_B)
      : SPEED_MODE_AUTO)
    : SPEED_MODE_B;
  const selectedWaypoints = selectedSquad && Array.isArray(selectedSquad.waypoints) ? selectedSquad.waypoints : [];

  const pitchLabel = cameraRef.current.getPitchBlend() >= 0.5
    ? `${Math.round(Number(cameraRef.current.pitchHigh) || BATTLE_PITCH_HIGH_DEG)}°`
    : `${Math.round(Number(cameraRef.current.pitchLow) || BATTLE_PITCH_LOW_DEG)}°`;
  const deployRosterRows = runtimeRef.current?.getRosterRows?.(deployEditorTeam) || [];
  const deployEditingGroup = deployEditingGroupId ? runtimeRef.current?.getDeployGroupById?.(deployEditingGroupId, deployEditorTeam) : null;
  const deployEditingBaseUnits = deployEditingGroup?.units || {};
  const deployEditorAvailableRows = deployRosterRows
    .map((row) => ({
      ...row,
      availableForDraft: Math.max(0, row.available + Math.max(0, Number(deployEditingBaseUnits[row.unitTypeId]) || 0))
    }))
    .sort((a, b) => a.unitName.localeCompare(b.unitName, 'zh-Hans-CN'));
  const deployEditorDraftSummary = unitsToSummary(
    deployEditorDraft.units,
    new Map(deployRosterRows.map((row) => [row.unitTypeId, row.unitName]))
  );
  const deployEditorTotal = normalizeDraftUnits(deployEditorDraft.units).reduce((sum, entry) => sum + entry.count, 0);
  const selectedDeployGroup = phase === 'deploy' ? runtimeRef.current?.getDeployGroupById?.(selectedSquadId) : null;
  const worldActionGroupId = selectedDeployGroup?.id || '';
  const worldActionPos = (
    phase === 'deploy'
    && deployActionAnchorMode === 'world'
    && worldActionGroupId
    && worldToDomRef.current
  )
    ? worldToDomRef.current({ x: selectedDeployGroup.x, y: selectedDeployGroup.y, z: 0 })
    : null;
  const selectedBattleActionSquad = (
    phase === 'battle'
    && runtimeRef.current
    && worldActionsVisibleForSquadId
  ) ? runtimeRef.current.getSquadById(worldActionsVisibleForSquadId) : null;
  const pathPlanningTailPoint = (
    phase === 'battle'
    && battleUiMode === BATTLE_UI_MODE_PATH
    && Array.isArray(pendingPathPoints)
    && pendingPathPoints.length > 0
  ) ? pendingPathPoints[pendingPathPoints.length - 1] : null;
  const pathPlanningTailDom = (
    pathPlanningTailPoint
    && worldToDomRef.current
  ) ? worldToDomRef.current({
    x: Number(pathPlanningTailPoint.x) || 0,
    y: Number(pathPlanningTailPoint.y) || 0,
    z: 0
  }) : null;
  const confirmDeleteGroup = (
    phase === 'deploy'
    && confirmDeleteGroupId
    && runtimeRef.current
  )
    ? runtimeRef.current.getDeployGroupById(confirmDeleteGroupId)
    : null;
  const quickParsedAttackerTeams = parseQuickDeployNumber(quickDeployRandomForm.attackerTeamCount);
  const quickParsedDefenderTeams = parseQuickDeployNumber(quickDeployRandomForm.defenderTeamCount);
  const quickParsedAttackerTotal = parseQuickDeployNumber(quickDeployRandomForm.attackerTotal);
  const quickParsedDefenderTotal = parseQuickDeployNumber(quickDeployRandomForm.defenderTotal);
  const currentField = runtimeRef.current?.getField?.() || { width: 900, height: 620 };
  const canDrawMidlineDebug = debugEnabled && showMidlineDebug && !!worldToDomRef.current;
  const midlineTop = canDrawMidlineDebug ? worldToDomRef.current({ x: 0, y: (Number(currentField?.height) || 620) * 0.5, z: 0 }) : null;
  const midlineBottom = canDrawMidlineDebug ? worldToDomRef.current({ x: 0, y: -(Number(currentField?.height) || 620) * 0.5, z: 0 }) : null;
  const midlineLineStyle = (midlineTop?.visible !== false && midlineBottom?.visible !== false)
    ? buildDomLineStyle(midlineTop, midlineBottom)
    : null;
  const teamMinX = Number(debugStats?.clampAllowedMinX);
  const teamMaxX = Number(debugStats?.clampAllowedMaxX);
  const teamMinTop = canDrawMidlineDebug && Number.isFinite(teamMinX)
    ? worldToDomRef.current({ x: teamMinX, y: (Number(currentField?.height) || 620) * 0.5, z: 0 })
    : null;
  const teamMinBottom = canDrawMidlineDebug && Number.isFinite(teamMinX)
    ? worldToDomRef.current({ x: teamMinX, y: -(Number(currentField?.height) || 620) * 0.5, z: 0 })
    : null;
  const teamMaxTop = canDrawMidlineDebug && Number.isFinite(teamMaxX)
    ? worldToDomRef.current({ x: teamMaxX, y: (Number(currentField?.height) || 620) * 0.5, z: 0 })
    : null;
  const teamMaxBottom = canDrawMidlineDebug && Number.isFinite(teamMaxX)
    ? worldToDomRef.current({ x: teamMaxX, y: -(Number(currentField?.height) || 620) * 0.5, z: 0 })
    : null;
  const teamMinLineStyle = (teamMinTop?.visible !== false && teamMinBottom?.visible !== false)
    ? buildDomLineStyle(teamMinTop, teamMinBottom)
    : null;
  const teamMaxLineStyle = (teamMaxTop?.visible !== false && teamMaxBottom?.visible !== false)
    ? buildDomLineStyle(teamMaxTop, teamMaxBottom)
    : null;

  if (!open) return null;

  return (
    <div className="pve2-overlay">
      <div className="pve2-head">
        <div className="pve2-title">
          <strong>{battleInitData?.nodeName || (isTrainingMode ? '训练场' : '攻占战')}</strong>
          <span>{battleInitData?.gateLabel || battleInitData?.gateKey || ''}</span>
        </div>
        <div className="pve2-side-info">
          <div className="pve2-side attacker">
            <span>我方</span>
            <strong>{battleInitData?.attacker?.username || '-'}</strong>
            <em>{battleInitData?.attacker?.totalCount || 0}</em>
          </div>
          <div className="pve2-side defender">
            <span>{isTrainingMode ? '敌方' : '守军'}</span>
            <strong>{battleInitData?.defender?.username || '-'}</strong>
            <em>{battleInitData?.defender?.totalCount || 0}</em>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="pve2-loading">加载战斗初始化数据...</div>
      ) : null}
      {!loading && error ? (
        <div className="pve2-error">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={closeModal}>关闭</button>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="pve2-main">
          <BattleHUD
            phase={phase}
            status={battleStatus}
            paused={paused}
            onTogglePause={handleTogglePause}
            onTogglePitch={handleTogglePitch}
            onExit={closeModal}
            onStart={handleStartBattle}
            canStart={runtimeRef.current?.canStartBattle?.()}
            debugEnabled={debugEnabled}
            onToggleDebug={() => setDebugEnabled((prev) => !prev)}
            pitchLabel={pitchLabel}
            startLabel={startLabel}
            speedModeLabel={speedModeLabel(selectedSpeedModeUi)}
            onCycleSpeedMode={phase === 'battle' ? handleCycleSpeedMode : null}
          />

          <div
            className={`pve2-scene ${isPanning ? 'is-panning' : ''}`}
            onMouseDown={handleSceneMouseDown}
            onMouseMove={handlePointerMove}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={handleSceneWheel}
          >
            <canvas ref={glCanvasRef} className="pve2-gl-canvas" />
            <AimOverlayCanvas
              width={glCanvasRef.current?.width || 1}
              height={glCanvasRef.current?.height || 1}
              worldToScreen={(world) => (worldToScreenRef.current ? worldToScreenRef.current(world) : { x: -9999, y: -9999, visible: false })}
              selectedSquad={selectedSquad}
              aimState={aimState}
              waypoints={selectedWaypoints}
              battleUiMode={battleUiMode}
              pendingPathPoints={pendingPathPoints}
              planningHoverPoint={planningHoverPoint}
              skillConfirmState={skillConfirmState}
            />

            {canDrawMidlineDebug ? (
              <div className="pve2-midline-overlay">
                {midlineLineStyle ? <div className="pve2-midline-line midline" style={midlineLineStyle} /> : null}
                {!debugStats?.allowCrossMidline && teamMinLineStyle ? (
                  <div className="pve2-midline-line min-bound" style={teamMinLineStyle} />
                ) : null}
                {!debugStats?.allowCrossMidline && teamMaxLineStyle ? (
                  <div className="pve2-midline-line max-bound" style={teamMaxLineStyle} />
                ) : null}
              </div>
            ) : null}

            <SquadCards
              squads={toCardsByTeam(cards)}
              phase={phase}
              actionAnchorMode={deployActionAnchorMode}
              deployActionTeam={isTrainingMode ? '' : TEAM_ATTACKER}
              onFocus={handleCardFocus}
              onSelect={handleCardSelect}
              hoverSquadIdOnCard={hoverSquadIdOnCard}
              onCardHoverChange={setHoverSquadIdOnCard}
              onBattleAction={handleBattleActionClick}
              onDeployMove={handleDeployMove}
              onDeployEdit={handleOpenDeployEditorForGroup}
              onDeployDelete={handleDeployDelete}
            />

            {phase === 'battle' ? (
              <div className="pve2-action-pad">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={handleCycleSpeedMode}
                >
                  {`速度模式：${speedModeLabel(selectedSpeedModeUi)}`}
                </button>
                <span className="pve2-hint">{`交互态：${battleUiMode}`}</span>
              </div>
            ) : (
              <div className="pve2-deploy-sidebar">
                <section className="pve2-deploy-sidebar-section">
                  <div className="pve2-deploy-sidebar-title">新建部队</div>
                  <div className="pve2-deploy-sidebar-body">
                    <button type="button" className="btn btn-primary" onClick={() => handleOpenDeployCreator(TEAM_ATTACKER)}>新建部队</button>
                  </div>
                </section>

                <section className="pve2-deploy-sidebar-section">
                  <div className="pve2-deploy-sidebar-title">部队模板</div>
                  <div className="pve2-deploy-sidebar-body">
                    {armyTemplatesLoading ? (
                      <span className="pve2-hint">部队模板加载中...</span>
                    ) : null}
                    {!armyTemplatesLoading && armyTemplatesError ? (
                      <span className="pve2-hint pve2-template-error">{armyTemplatesError}</span>
                    ) : null}
                    {!armyTemplatesLoading && !armyTemplatesError && armyTemplates.length <= 0 ? (
                      <span className="pve2-hint">暂无部队模板，可在兵营里创建后回来使用</span>
                    ) : null}
                    {!armyTemplatesLoading && armyTemplates.length > 0 ? (
                      <div className="pve2-template-list">
                        {armyTemplates.map((template, index) => {
                          const templateId = typeof template?.templateId === 'string' ? template.templateId : `idx_${index}`;
                          const templateUnits = normalizeTemplateUnits(template?.units || []);
                          const templateSummary = templateUnits
                            .map((entry) => `${entry.unitName || entry.unitTypeId}x${entry.count}`)
                            .join(' / ');
                          const templateTotal = templateUnits.reduce((sum, item) => sum + item.count, 0);
                        return (
                            <div key={`tpl-${templateId}`} className="pve2-template-row">
                              <button
                                type="button"
                                className="pve2-template-row-main"
                                onClick={() => {
                                  if (isTrainingMode) {
                                    handleCreateTrainingGroupByTemplate(template, TEAM_ATTACKER);
                                    return;
                                  }
                                  handleOpenTemplateFillPreview(template, TEAM_ATTACKER);
                                }}
                              >
                                <span className="pve2-template-meta">
                                  <strong>{template?.name || '未命名模板'}</strong>
                                  <span>{`模板兵力 ${Math.max(0, Math.floor(Number(template?.totalCount) || templateTotal))}`}</span>
                                  <em>{templateSummary || '无兵种配置'}</em>
                                </span>
                                {!isTrainingMode ? (
                                  <span className="pve2-template-direct">填充</span>
                                ) : null}
                              </button>
                              {isTrainingMode ? (
                                <span className="pve2-template-actions">
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-small"
                                    onClick={() => handleCreateTrainingGroupByTemplate(template, TEAM_DEFENDER)}
                                  >
                                    敌方
                                  </button>
                                </span>
                              ) : null}
                            </div>
                        );
                      })}
                    </div>
                  ) : null}
                  </div>
                </section>
              </div>
            )}

            {phase === 'battle' && marchModePickOpen ? (
              <div
                className="pve2-march-float"
                style={{ left: `${marchPopupPos.x}px`, top: `${marchPopupPos.y}px` }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" className="btn btn-primary btn-small" onClick={() => handlePickMarchMode('cohesive')}>整体行进</button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => handlePickMarchMode('loose')}>游离行进</button>
              </div>
            ) : null}

            {phase === 'battle' && battleUiMode === BATTLE_UI_MODE_SKILL_PICK && skillPopupTargetSquadId && (skillPopupMeta.skills || []).length > 0 ? (
              <div
                className="pve2-skill-float"
                style={{ left: `${skillPopupPos.x}px`, top: `${skillPopupPos.y}px` }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {(skillPopupMeta.skills || []).map((skill) => {
                  const total = Math.max(0.1, Number(skill?.cooldownTotal) || 1);
                  const remain = Math.max(0, Number(skill?.cooldownRemain) || 0);
                  const ratio = clamp(remain / total, 0, 1);
                  const ringStyle = {
                    backgroundImage: `conic-gradient(rgba(148,163,184,0.82) ${Math.round(ratio * 360)}deg, rgba(59,130,246,0.94) 0deg)`
                  };
                  return (
                    <button
                      key={skill.id || skill.kind}
                      type="button"
                      className={`pve2-skill-float-btn ${skill.available ? '' : 'is-cd'}`}
                      style={ringStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSkillPick(skill, {
                          squadId: skillPopupTargetSquadId,
                          clientX: Number(event.clientX) || 0,
                          clientY: Number(event.clientY) || 0
                        });
                      }}
                    >
                      <span className="pve2-skill-float-icon">{skill.icon || skill.name?.slice(0, 1) || '技'}</span>
                      <span className="pve2-skill-float-tip">
                        <strong>{skill.name || '技能'}</strong>
                        <em>{skill.description || ''}</em>
                        <i>{`兵力 ${Math.max(0, Number(skill.count) || 0)} | ${remain > 0.01 ? `冷却 ${remain.toFixed(1)}s` : '可释放'}`}</i>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {phase === 'deploy' && !isTrainingMode && templateFillPreview.open ? (
              <div
                className="pve2-template-fill-backdrop"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCloseTemplateFillPreview();
                }}
              >
                <div
                  className="pve2-template-fill-panel"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="pve2-template-fill-head">
                    <h4>{`模板填充：${templateFillPreview.template?.name || '未命名模板'}`}</h4>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleCloseTemplateFillPreview}>关闭</button>
                  </div>
                  <div className="pve2-template-fill-summary">
                    <span>{`模板总兵力 ${templateFillPreview.totalRequested}`}</span>
                    <span>{`当前可填充 ${templateFillPreview.totalFilled}`}</span>
                    <strong>{`填充率 ${templateFillPreview.totalRequested > 0 ? ((templateFillPreview.totalFilled / templateFillPreview.totalRequested) * 100).toFixed(1) : '0.0'}%`}</strong>
                  </div>
                  <div className="pve2-template-fill-list">
                    {(templateFillPreview.rows || []).map((row) => (
                      <div key={`fill-${row.unitTypeId}`} className="pve2-template-fill-row">
                        <div className="pve2-template-fill-meta">
                          <strong>{row.unitName || row.unitTypeId}</strong>
                          <span>{`模板 ${row.requested} ｜ 可用 ${row.available} ｜ 填充 ${row.filled}`}</span>
                        </div>
                        <div className="pve2-template-fill-progress">
                          <div className="pve2-template-fill-progress-bar" style={{ width: `${Math.max(0, Math.min(100, row.fillPercent || 0))}%` }} />
                        </div>
                        <em>{`${Math.max(0, Math.min(100, row.fillPercent || 0)).toFixed(1)}%`}</em>
                      </div>
                    ))}
                  </div>
                  <div className="pve2-template-fill-actions">
                    <button type="button" className="btn btn-secondary" onClick={handleCloseTemplateFillPreview}>取消</button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={templateFillPreview.totalFilled <= 0}
                      onClick={handleConfirmTemplateFillPreview}
                    >
                      生成部队
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {phase === 'deploy' && isTrainingMode && quickDeployOpen ? (
              <div
                className="pve2-quick-deploy-backdrop"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCloseQuickDeploy();
                }}
              >
                <div
                  className="pve2-quick-deploy-panel"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="pve2-quick-deploy-head">
                    <h4>一键布置</h4>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={handleCloseQuickDeploy}
                    >
                      关闭
                    </button>
                  </div>
                  <div className="pve2-quick-deploy-tabs">
                    <button
                      type="button"
                      className={`pve2-quick-tab ${quickDeployTab === 'standard' ? 'active' : ''}`}
                      onClick={() => {
                        setQuickDeployTab('standard');
                        setQuickDeployError('');
                      }}
                    >
                      标准配置
                    </button>
                    <button
                      type="button"
                      className={`pve2-quick-tab ${quickDeployTab === 'random' ? 'active' : ''}`}
                      onClick={() => {
                        setQuickDeployTab('random');
                        setQuickDeployError('');
                      }}
                    >
                      随机配置
                    </button>
                  </div>

                  {quickDeployTab === 'standard' ? (
                    <div className="pve2-quick-standard-list">
                      {QUICK_DEPLOY_STANDARD_PRESETS.map((preset) => (
                        <div key={preset.id} className="pve2-quick-standard-item">
                          <div className="pve2-quick-standard-meta">
                            <strong>{preset.label}</strong>
                            <span>{preset.desc}</span>
                            <em>{`我方 ${preset.attackerTeamCount} 支 / ${preset.attackerTotal} 人 ｜ 敌方 ${preset.defenderTeamCount} 支 / ${preset.defenderTotal} 人`}</em>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={quickDeployApplying}
                            onClick={() => handleApplyStandardQuickDeploy(preset)}
                          >
                            应用
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pve2-quick-random-form">
                      <div className="pve2-quick-form-block">
                        <h5>我方</h5>
                        <label>
                          <span>部队数</span>
                          <div className="pve2-quick-input-wrap">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={quickDeployRandomForm.attackerTeamCount}
                              onChange={(event) => setQuickDeployRandomForm((prev) => ({ ...prev, attackerTeamCount: event.target.value || '' }))}
                              placeholder="输入我方部队数"
                            />
                          </div>
                          <div className="pve2-quick-shortcuts">
                            {QUICK_DEPLOY_TEAM_SHORTCUTS.map((value) => (
                              <button
                                key={`atk-team-${value}`}
                                type="button"
                                className={`pve2-quick-chip ${quickParsedAttackerTeams === value ? 'active' : ''}`}
                                onClick={() => setQuickDeployRandomForm((prev) => ({ ...prev, attackerTeamCount: String(value) }))}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                        </label>
                        <label>
                          <span>总人数</span>
                          <div className="pve2-quick-input-wrap">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={quickDeployRandomForm.attackerTotal}
                              onChange={(event) => setQuickDeployRandomForm((prev) => ({ ...prev, attackerTotal: event.target.value || '' }))}
                              placeholder="输入我方总人数"
                            />
                          </div>
                          <div className="pve2-quick-shortcuts">
                            {QUICK_DEPLOY_TOTAL_SHORTCUTS.map((shortcut) => (
                              <button
                                key={`atk-total-${shortcut.value}`}
                                type="button"
                                className={`pve2-quick-chip ${quickParsedAttackerTotal === shortcut.value ? 'active' : ''}`}
                                onClick={() => setQuickDeployRandomForm((prev) => ({ ...prev, attackerTotal: String(shortcut.value) }))}
                              >
                                {shortcut.label}
                              </button>
                            ))}
                          </div>
                        </label>
                      </div>

                      <div className="pve2-quick-form-block">
                        <h5>敌方</h5>
                        <label>
                          <span>部队数</span>
                          <div className="pve2-quick-input-wrap">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={quickDeployRandomForm.defenderTeamCount}
                              onChange={(event) => setQuickDeployRandomForm((prev) => ({ ...prev, defenderTeamCount: event.target.value || '' }))}
                              placeholder="输入敌方部队数"
                            />
                          </div>
                          <div className="pve2-quick-shortcuts">
                            {QUICK_DEPLOY_TEAM_SHORTCUTS.map((value) => (
                              <button
                                key={`def-team-${value}`}
                                type="button"
                                className={`pve2-quick-chip ${quickParsedDefenderTeams === value ? 'active' : ''}`}
                                onClick={() => setQuickDeployRandomForm((prev) => ({ ...prev, defenderTeamCount: String(value) }))}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                        </label>
                        <label>
                          <span>总人数</span>
                          <div className="pve2-quick-input-wrap">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={quickDeployRandomForm.defenderTotal}
                              onChange={(event) => setQuickDeployRandomForm((prev) => ({ ...prev, defenderTotal: event.target.value || '' }))}
                              placeholder="输入敌方总人数"
                            />
                          </div>
                          <div className="pve2-quick-shortcuts">
                            {QUICK_DEPLOY_TOTAL_SHORTCUTS.map((shortcut) => (
                              <button
                                key={`def-total-${shortcut.value}`}
                                type="button"
                                className={`pve2-quick-chip ${quickParsedDefenderTotal === shortcut.value ? 'active' : ''}`}
                                onClick={() => setQuickDeployRandomForm((prev) => ({ ...prev, defenderTotal: String(shortcut.value) }))}
                              >
                                {shortcut.label}
                              </button>
                            ))}
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {quickDeployError ? <p className="pve2-quick-error">{quickDeployError}</p> : null}

                  <div className="pve2-quick-deploy-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={handleCloseQuickDeploy}
                      disabled={quickDeployApplying}
                    >
                      取消
                    </button>
                    {quickDeployTab === 'random' ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        onClick={handleApplyRandomQuickDeploy}
                        disabled={quickDeployApplying}
                      >
                        {quickDeployApplying ? '生成中...' : '生成并布置'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <Minimap
              snapshot={minimapSnapshot}
              cameraCenter={cameraMiniState.center}
              cameraViewport={cameraMiniState.viewport}
              onMapClick={handleMinimapClick}
            />

            {battleUiMode === BATTLE_UI_MODE_PATH ? (
              <div className="pve2-aim-tip">路径规划中：LMB 添加路点，RMB 撤销，点击最后路径点“√”执行</div>
            ) : null}
            {battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM ? (
              <div className="pve2-aim-tip">技能确认态：LMB 确认释放，RMB 取消</div>
            ) : null}

            {debugEnabled ? (
              <BattleDebugPanel
                phase={phase}
                stats={debugStats}
                camera={cameraAssert}
                selectedSquad={selectedCardRow}
                showMidlineDebug={showMidlineDebug}
                onToggleMidlineDebug={() => setShowMidlineDebug((prev) => !prev)}
              />
            ) : null}

            {glError ? (
              <div className="pve2-error-overlay">{glError}</div>
            ) : null}

            {phase === 'battle' && pathPlanningTailDom?.visible ? (
              <button
                type="button"
                className="pve2-path-confirm-btn"
                style={{ left: `${pathPlanningTailDom.x}px`, top: `${pathPlanningTailDom.y}px` }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  handleFinishPathPlanning();
                }}
              >
                √
              </button>
            ) : null}

            {phase === 'battle' ? (
              <BattleActionButtons
                visible={!!worldActionsVisibleForSquadId}
                mode="world"
                anchorWorldPos={selectedBattleActionSquad ? {
                  x: Number(selectedBattleActionSquad.x) || 0,
                  y: Number(selectedBattleActionSquad.y) || 0,
                  z: Math.max(3, Number(selectedBattleActionSquad.radius) || 12) * 0.25
                } : null}
                camera={(world) => (worldToDomRef.current ? worldToDomRef.current(world) : null)}
                onAction={(actionId, payload) => {
                  if (!worldActionsVisibleForSquadId) return;
                  executeBattleAction(worldActionsVisibleForSquadId, actionId, payload);
                }}
              />
            ) : null}

            {phase === 'deploy' && worldActionPos?.visible ? (
              <div
                className="pve2-world-actions"
                style={{ left: `${worldActionPos.x}px`, top: `${worldActionPos.y}px` }}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <DeployActionButtons
                  layout="arc"
                  onMove={(event) => handleDeployMove(worldActionGroupId, event)}
                  onEdit={(event) => handleOpenDeployEditorForGroup(worldActionGroupId, event)}
                  onDelete={(event) => handleDeployDelete(worldActionGroupId, event)}
                />
              </div>
            ) : null}

            {phase === 'deploy' && deployEditorOpen ? (
              <div
                className="pve2-deploy-creator"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <h4>{`${deployEditingGroupId ? '编辑部队' : '新建部队'}（${deployEditorTeam === TEAM_DEFENDER ? '敌方' : '我方'}）`}</h4>
                <label>
                  <span>部队名称</span>
                  <input
                    type="text"
                    maxLength={32}
                    value={deployEditorDraft.name || ''}
                    placeholder="不填则自动命名"
                    onChange={(event) => setDeployEditorDraft((prev) => ({ ...prev, name: event.target.value || '' }))}
                  />
                </label>
                <div className="pve2-deploy-editor-transfer">
                  <div className="pve2-deploy-editor-col">
                    <div className="pve2-deploy-editor-col-title">可用兵种（左侧）</div>
                    {deployEditorAvailableRows.map((row) => (
                      <button
                        key={`${deployEditorTeam}-left-${row.unitTypeId}`}
                        type="button"
                        className="pve2-deploy-unit-card"
                        draggable={row.availableForDraft > 0}
                        disabled={row.availableForDraft <= 0}
                        onDragStart={(event) => {
                          event.dataTransfer?.setData('application/x-deploy-unit-id', row.unitTypeId);
                          event.dataTransfer?.setData('text/plain', row.unitTypeId);
                          setDeployEditorDragUnitId(row.unitTypeId);
                        }}
                        onDragEnd={() => setDeployEditorDragUnitId('')}
                        onClick={() => openDeployQuantityDialog(row.unitTypeId)}
                      >
                        <strong>{row.unitName}</strong>
                        <span>{`可用 ${row.availableForDraft}`}</span>
                      </button>
                    ))}
                  </div>
                  <div
                    className={`pve2-deploy-editor-col pve2-deploy-editor-col-right ${deployEditorDragUnitId ? 'is-dropzone' : ''}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDeployEditorDrop}
                  >
                    <div className="pve2-deploy-editor-col-title">部队编组（右侧）</div>
                    {normalizeDraftUnits(deployEditorDraft.units).length <= 0 ? (
                      <div className="pve2-deploy-editor-tip">拖拽左侧兵种到这里后，会弹出数量输入框。</div>
                    ) : null}
                    {normalizeDraftUnits(deployEditorDraft.units).map((entry) => (
                      <div key={`${deployEditorTeam}-right-${entry.unitTypeId}`} className="pve2-deploy-editor-row">
                        <span>{`${deployEditorAvailableRows.find((row) => row.unitTypeId === entry.unitTypeId)?.unitName || entry.unitTypeId} x${entry.count}`}</span>
                        <div className="pve2-deploy-editor-row-actions">
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => openDeployQuantityDialog(entry.unitTypeId)}>数量</button>
                          <button type="button" className="btn btn-warning btn-small" onClick={() => handleRemoveDraftUnit(entry.unitTypeId)}>移除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pve2-deploy-editor-summary">
                  {`总兵力 ${deployEditorTotal}${deployEditorDraftSummary ? ` ｜ ${deployEditorDraftSummary}` : ''}`}
                </div>
                <div className="pve2-deploy-creator-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setDeployEditorOpen(false);
                      setDeployEditingGroupId('');
                      setDeployQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 });
                      setDeployEditorDragUnitId('');
                      setDeployEditorTeam(TEAM_ATTACKER);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={handleSaveDeployEditor}
                    disabled={deployEditorTotal <= 0}
                  >
                    确定编组
                  </button>
                </div>
              </div>
            ) : null}

            {phase === 'deploy' && deployNotice ? (
              <div className="pve2-deploy-notice">{deployNotice}</div>
            ) : null}

            {phase === 'deploy' && confirmDeleteGroup ? (
              <div
                className="pve2-confirm"
                style={{ left: `${confirmDeletePos.x}px`, top: `${confirmDeletePos.y}px` }}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <p>{`确认删除部队「${confirmDeleteGroup.name || '未命名部队'}」吗？`}</p>
                <div className="pve2-confirm-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setConfirmDeleteGroupId('');
                      setConfirmDeletePos({ x: 0, y: 0 });
                    }}
                  >
                    取消
                  </button>
                  <button type="button" className="btn btn-warning btn-small" onClick={handleConfirmDeployDelete}>确认删除</button>
                </div>
              </div>
            ) : null}
          </div>

          {resultState.open ? (
            <div className="pve2-result">
              <h3>{isTrainingMode ? '训练结算' : '战斗结算'}</h3>
              {resultState.summary ? (
                <>
                  <p>{resultState.summary.endReason || (isTrainingMode ? '训练结束' : '战斗结束')}</p>
                  <div className="pve2-result-grid">
                    <div>
                      <strong>我方</strong>
                      <span>{resultState.summary.attacker?.remain || 0}/{resultState.summary.attacker?.start || 0}</span>
                      <span>击杀 {resultState.summary.attacker?.kills || 0}</span>
                    </div>
                    <div>
                      <strong>{isTrainingMode ? '敌方' : '守军'}</strong>
                      <span>{resultState.summary.defender?.remain || 0}/{resultState.summary.defender?.start || 0}</span>
                      <span>击杀 {resultState.summary.defender?.kills || 0}</span>
                    </div>
                  </div>
                </>
              ) : null}
              {requireResultReport && resultState.submitting ? <p>正在上报战斗结果...</p> : null}
              {resultState.error ? <p className="error">{resultState.error}</p> : null}
              {requireResultReport && resultState.recorded ? <p className="ok">战报已记录</p> : null}
              <div className="pve2-result-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>{isTrainingMode ? '返回训练场' : '返回围城'}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <NumberPadDialog
        open={phase === 'deploy' && deployQuantityDialog.open}
        title={`设置兵力：${deployQuantityDialog.unitName || deployQuantityDialog.unitTypeId}`}
        description="可滑动或直接输入数量"
        min={1}
        max={Math.max(1, Math.floor(Number(deployQuantityDialog.max) || 1))}
        initialValue={Math.max(1, Math.floor(Number(deployQuantityDialog.current) || 1))}
        zIndex={36010}
        confirmLabel="确定"
        cancelLabel="取消"
        onCancel={() => setDeployQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 })}
        onConfirm={handleConfirmDeployQuantity}
      />
    </div>
  );
};

export default BattleSceneModal;
