import React, { useCallback, useEffect, useRef, useState } from 'react';
import './pveBattle.css';
import BattleRuntime from '../../game/battle_v2/runtime/BattleRuntime';
import BattleClock from '../../game/battle_v2/runtime/BattleClock';
import CameraController from '../../game/battle_v2/render/CameraController';
import {
  createBattleGlContext,
  resizeCanvasToDisplaySize
} from '../../game/battle_v2/render/WebGL2Context';
import ImpostorRenderer from '../../game/battle_v2/render/ImpostorRenderer';
import BuildingRenderer from '../../game/battle_v2/render/BuildingRenderer';
import ProjectileRenderer from '../../game/battle_v2/render/ProjectileRenderer';
import EffectRenderer from '../../game/battle_v2/render/EffectRenderer';
import GroundRenderer from '../../game/battle_v2/render/GroundRenderer';
import BattleHUD from '../../game/battle_v2/ui/BattleHUD';
import SquadCards from '../../game/battle_v2/ui/SquadCards';
import DeployActionButtons from '../../game/battle_v2/ui/DeployActionButtons';
import Minimap from '../../game/battle_v2/ui/Minimap';
import AimOverlayCanvas from '../../game/battle_v2/ui/AimOverlayCanvas';
import unitVisualConfig from '../../game/battle_v2/assets/UnitVisualConfig.example.json';
import NumberPadDialog from '../common/NumberPadDialog';

const API_BASE = 'http://localhost:5000';
const TEAM_ATTACKER = 'attacker';
const CAMERA_ZOOM_STEP = 24;
const CAMERA_DISTANCE_MIN = 360;
const CAMERA_DISTANCE_MAX = 980;
const DEPLOY_ROTATE_SENSITIVITY = 0.28;
const DEPLOY_ROTATE_CLICK_THRESHOLD = 3;
const DEPLOY_DEFAULT_YAW_DEG = 180;
const DEPLOY_DEFAULT_WORLD_YAW_DEG = 180;
const DEPLOY_PITCH_DEG = 62;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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

const PveBattleModal = ({
  open = false,
  loading = false,
  error = '',
  battleInitData = null,
  onClose,
  onBattleFinished
}) => {
  const glCanvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const clockRef = useRef(new BattleClock({ fixedStep: 1 / 30 }));
  const cameraRef = useRef(new CameraController({
    yawDeg: DEPLOY_DEFAULT_YAW_DEG,
    pitchLow: 40,
    pitchHigh: 90,
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
  const [debugStats, setDebugStats] = useState({ fps: 0, simStepMs: 0, renderMs: 0, agentCount: 0, projectileCount: 0, buildingCount: 0 });
  const [aimState, setAimState] = useState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
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
    panStartPitch: 0
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
  const [deployDraggingGroupId, setDeployDraggingGroupId] = useState('');
  const [deployActionAnchorMode, setDeployActionAnchorMode] = useState('');
  const [deployNotice, setDeployNotice] = useState('');
  const [deployEditorDragUnitId, setDeployEditorDragUnitId] = useState('');
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState('');
  const [confirmDeletePos, setConfirmDeletePos] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

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
      visualConfig: unitVisualConfig
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
    const anchor = runtime.getFocusAnchor();
    cameraRef.current.centerX = Number(anchor?.x) || 0;
    cameraRef.current.centerY = Number(anchor?.y) || 0;
    cameraRef.current.yawDeg = DEPLOY_DEFAULT_YAW_DEG;
    cameraRef.current.worldYawDeg = DEPLOY_DEFAULT_WORLD_YAW_DEG;
    cameraRef.current.mirrorX = false;
    cameraRef.current.distance = 560;
    cameraRef.current.currentPitch = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchFrom = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchTo = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
    clockRef.current.reset();
    clockRef.current.setPaused(false);
    reportedRef.current = false;
    setPaused(false);
    setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
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
    setDeployDraggingGroupId('');
    setDeployActionAnchorMode('');
    setDeployNotice('');
    setDeployEditorDragUnitId('');
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
  }, [open, battleInitData]);

  useEffect(() => {
    if (!open) return;
    setupRuntime();
  }, [open, setupRuntime]);

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
      try {
        renderersRef.current.impostor = new ImpostorRenderer(gl, { maxSlices: 32, textureSize: 64 });
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

  const reportBattleResult = useCallback(async (summary) => {
    if (!battleInitData?.nodeId || !summary) return;
    setResultState((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/api/nodes/${battleInitData.nodeId}/siege/pve/battle-result`, {
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
  }, [battleInitData, onBattleFinished]);

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
        cameraRef.current.worldYawDeg = 0;
      }

      const followAnchor = nowPhase === 'battle' ? runtime.getFocusAnchor() : null;
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
          panStartPitch: Number(panDragRef.current?.startPitch) || 0
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
      cameraRef.current.currentPitch = cameraRef.current.pitchLow;
      cameraRef.current.pitchFrom = cameraRef.current.pitchLow;
      cameraRef.current.pitchTo = cameraRef.current.pitchLow;
      cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
    }
    setPhase(runtime.getPhase());
    setBattleStatus(runtime.getBattleStatus());
    setCards(runtime.getCardRows());
    setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
    setDeployDraggingGroupId('');
    setDeployActionAnchorMode('');
    setDeployEditorOpen(false);
  }, []);

  const handleCardFocus = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setFocusSquad(squadId);
    if (runtime.getPhase() === 'deploy') {
      setDeployActionAnchorMode('card');
    }
  }, []);

  const handleCardSelect = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      runtime.setSelectedDeployGroup(squadId);
      runtime.setFocusSquad(squadId);
      setSelectedSquadId(squadId);
      setCards(runtime.getCardRows());
      setDeployActionAnchorMode('card');
      return;
    }
    if (runtime.setSelectedBattleSquad(squadId)) {
      setSelectedSquadId(squadId);
      setCards(runtime.getCardRows());
    }
  }, []);

  const handleMapCommand = useCallback((event) => {
    if (event.button !== 0) return;
    const runtime = runtimeRef.current;
    const canvas = glCanvasRef.current;
    if (!runtime || !canvas || !cameraStateRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const world = cameraRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    pointerWorldRef.current = world;

    if (runtime.getPhase() === 'deploy') {
      if (deployDraggingGroupId) {
        if (!runtime.canDeployAt(world, TEAM_ATTACKER, 10)) {
          setDeployNotice('中间交战区不可部署，请放置在左侧蓝色区域');
          return;
        }
        runtime.moveDeployGroup(deployDraggingGroupId, world);
        runtime.setAttackerDeployGroupPlaced(deployDraggingGroupId, true);
        runtime.setSelectedDeployGroup(deployDraggingGroupId);
        runtime.setFocusSquad(deployDraggingGroupId);
        setSelectedSquadId(deployDraggingGroupId);
        setDeployDraggingGroupId('');
        setDeployActionAnchorMode('world');
        setDeployNotice('部队已放置，可继续编辑或开战');
        setCards(runtime.getCardRows());
        setMinimapSnapshot(runtime.getMinimapSnapshot());
        return;
      }
      const picked = runtime.pickAttackerDeployGroup(world);
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
      return;
    }

    if (runtime.getPhase() !== 'battle' || paused) return;
    const selected = runtime.getSquadById(selectedSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;

    if (aimState.active && aimState.squadId === selected.id) {
      const maxRange = skillRangeByClass(selected.classTag);
      const aoeRadius = skillAoeRadiusByClass(selected.classTag);
      const dx = world.x - selected.x;
      const dy = world.y - selected.y;
      const dist = Math.hypot(dx, dy) || 1;
      const tx = dist > maxRange ? selected.x + (dx / dist) * maxRange : world.x;
      const ty = dist > maxRange ? selected.y + (dy / dist) * maxRange : world.y;
      runtime.commandSkill(selected.id, {
        kind: 'ground_aoe',
        x: tx,
        y: ty,
        radius: aoeRadius,
        maxRange,
        clipPolygon: [],
        blockedByWall: false
      });
      setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
      return;
    }

    runtime.commandMove(selected.id, world, { append: event.shiftKey });
    setCards(runtime.getCardRows());
  }, [selectedSquadId, paused, aimState, deployDraggingGroupId]);

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
      && target.closest('.pve2-world-actions, .pve2-card-actions, .pve2-deploy-creator, .pve2-minimap-wrap, .pve2-action-pad, .pve2-hud, .pve2-confirm, .number-pad-dialog-overlay, .number-pad-dialog')
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
    handleMapCommand(event);
  }, [beginPanDrag, handleMapCommand]);

  const handleSceneWheel = useCallback((event) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
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
      if (!runtime.canDeployAt(worldPoint, TEAM_ATTACKER, 10)) {
        setDeployNotice('中间交战区不可部署，请放置在左侧蓝色区域');
        return;
      }
      runtime.moveDeployGroup(deployDraggingGroupId, worldPoint);
      runtime.setAttackerDeployGroupPlaced(deployDraggingGroupId, true);
      runtime.setSelectedDeployGroup(deployDraggingGroupId);
      runtime.setFocusSquad(deployDraggingGroupId);
      setSelectedSquadId(deployDraggingGroupId);
      setDeployDraggingGroupId('');
      setDeployActionAnchorMode('world');
      setDeployNotice('部队已放置，可继续编辑或开战');
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }
    if (runtime.getPhase() !== 'battle') return;
    runtime.commandMove(selectedSquadId, worldPoint, { append: false });
    runtime.setFocusSquad(selectedSquadId);
    setCards(runtime.getCardRows());
  }, [selectedSquadId, deployDraggingGroupId]);

  const handleToggleSkillAim = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const selected = runtime.getSquadById(selectedSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;
    if (selected.classTag !== 'archer' && selected.classTag !== 'artillery' && selected.classTag !== 'cavalry' && selected.classTag !== 'infantry') return;
    setAimState((prev) => {
      if (prev.active && prev.squadId === selected.id) {
        return { active: false, squadId: '', classTag: '', point: null, radiusPx: 0 };
      }
      return {
        active: true,
        squadId: selected.id,
        classTag: selected.classTag,
        point: null,
        radiusPx: 0
      };
    });
  }, [selectedSquadId]);

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
      runtime.moveDeployGroup(deployDraggingGroupId, world);
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }

    if (!aimState.active) return;
    const selected = runtime.getSquadById(aimState.squadId);
    if (!selected) return;
    const center = worldToScreenRef.current ? worldToScreenRef.current({ x: world.x, y: world.y, z: 0 }) : null;
    const edge = worldToScreenRef.current ? worldToScreenRef.current({ x: world.x + skillAoeRadiusByClass(selected.classTag), y: world.y, z: 0 }) : null;
    const radiusPx = center && edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : 22;
    setAimState((prev) => ({ ...prev, point: { x: world.x, y: world.y }, radiusPx }));
  }, [aimState, deployDraggingGroupId]);

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
          cameraRef.current.worldYawDeg = (Number(rotate.startWorldYawDeg) || 0) + (dx * DEPLOY_ROTATE_SENSITIVITY);
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

    const handleWindowMouseUp = () => {
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
  }, [open, clearPanDrag, clearDeployYawDrag]);

  const handleBehavior = useCallback((behavior) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    runtime.commandBehavior(selectedSquadId, behavior);
    setCards(runtime.getCardRows());
  }, [selectedSquadId]);

  const handleOpenDeployCreator = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const rows = runtime.getAttackerRosterRows();
    if (rows.length <= 0 || rows.every((row) => row.total <= 0)) {
      setDeployNotice('当前没有可用兵种库存，无法新建部队');
      return;
    }
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
    const draftUnits = Object.entries(group.units || {}).map(([unitTypeId, count]) => ({
      unitTypeId,
      count: Math.max(1, Math.floor(Number(count) || 1))
    }));
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
  }, []);

  const resolveDeployUnitMax = useCallback((unitTypeId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return 0;
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return 0;
    const rosterRow = runtime.getAttackerRosterRows().find((row) => row.unitTypeId === safeId);
    const baseAvailable = Math.max(0, Math.floor(Number(rosterRow?.available) || 0));
    if (!deployEditingGroupId) return baseAvailable;
    const editingGroup = runtime.getDeployGroupById(deployEditingGroupId);
    const existing = Math.max(0, Math.floor(Number(editingGroup?.units?.[safeId]) || 0));
    return baseAvailable + existing;
  }, [deployEditingGroupId]);

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
    const unitName = runtime.getAttackerRosterRows().find((row) => row.unitTypeId === safeId)?.unitName || safeId;
    const current = normalizeDraftUnits(deployEditorDraft.units).find((entry) => entry.unitTypeId === safeId)?.count || 1;
    setDeployQuantityDialog({
      open: true,
      unitTypeId: safeId,
      unitName,
      max,
      current: clamp(current, 1, max)
    });
  }, [deployEditorDraft.units, resolveDeployUnitMax]);

  const handleDeployEditorDrop = useCallback((event) => {
    event.preventDefault();
    const droppedUnitTypeId = event.dataTransfer?.getData('application/x-attacker-unit-id')
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
    if (deployEditingGroupId) {
      const result = runtime.updateAttackerDeployGroup(deployEditingGroupId, {
        name: deployEditorDraft.name,
        units: unitsMap
      });
      if (!result?.ok) {
        setDeployNotice(result?.reason || '编辑部队失败');
        return;
      }
      targetGroupId = deployEditingGroupId;
    } else {
      const result = runtime.createAttackerDeployGroup({
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
    runtime.setAttackerDeployGroupPlaced(targetGroupId, false);
    setSelectedSquadId(targetGroupId);
    setDeployDraggingGroupId(targetGroupId);
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setDeployEditorOpen(false);
    setDeployEditingGroupId('');
    setDeployEditorDraft({ name: '', units: [] });
    setDeployNotice('部队已创建，移动鼠标并点击地图完成放置');
  }, [deployEditingGroupId, deployEditorDraft]);

  const handleDeployMove = useCallback((groupId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    pointerWorldRef.current = {
      x: Number(group.x) || 0,
      y: Number(group.y) || 0
    };
    runtime.setSelectedDeployGroup(groupId);
    runtime.setFocusSquad(groupId);
    runtime.setAttackerDeployGroupPlaced(groupId, false);
    setSelectedSquadId(groupId);
    setDeployDraggingGroupId(groupId);
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setDeployNotice('已拾取部队，移动鼠标并点击地图可重新放置');
  }, []);

  const handleDeployDelete = useCallback((groupId, event = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    if (!runtime.getDeployGroupById(groupId)) return;
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
  }, []);

  const handleConfirmDeployDelete = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const groupId = String(confirmDeleteGroupId || '');
    if (!groupId) return;
    const result = runtime.removeAttackerDeployGroup(groupId);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '删除部队失败');
      setConfirmDeleteGroupId('');
      setConfirmDeletePos({ x: 0, y: 0 });
      return;
    }
    const nextSelected = runtime.getDeployGroups()?.selectedId || '';
    setSelectedSquadId(nextSelected);
    setDeployDraggingGroupId((prev) => (prev === groupId ? '' : prev));
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setConfirmDeleteGroupId('');
    setConfirmDeletePos({ x: 0, y: 0 });
    setDeployNotice('部队已删除');
  }, [confirmDeleteGroupId]);

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
        if (deployEditorOpen) {
          setDeployEditorOpen(false);
          setDeployEditingGroupId('');
          setDeployEditorDragUnitId('');
          return;
        }
        if (deployDraggingGroupId) {
          setDeployDraggingGroupId('');
          setDeployNotice('已取消部队拖拽放置');
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
    deployDraggingGroupId
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

  const selectedWaypoints = selectedSquad && Array.isArray(selectedSquad.waypoints) ? selectedSquad.waypoints : [];

  const pitchLabel = cameraRef.current.getPitchBlend() >= 0.5 ? '90°' : '40°';
  const deployRosterRows = runtimeRef.current?.getAttackerRosterRows?.() || [];
  const deployEditingGroup = deployEditingGroupId ? runtimeRef.current?.getDeployGroupById?.(deployEditingGroupId) : null;
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
  const confirmDeleteGroup = (
    phase === 'deploy'
    && confirmDeleteGroupId
    && runtimeRef.current
  )
    ? runtimeRef.current.getDeployGroupById(confirmDeleteGroupId)
    : null;

  if (!open) return null;

  return (
    <div className="pve2-overlay">
      <div className="pve2-head">
        <div className="pve2-title">
          <strong>{battleInitData?.nodeName || '攻占战'}</strong>
          <span>{battleInitData?.gateLabel || battleInitData?.gateKey || ''}</span>
        </div>
        <div className="pve2-side-info">
          <div className="pve2-side attacker">
            <span>我方</span>
            <strong>{battleInitData?.attacker?.username || '-'}</strong>
            <em>{battleInitData?.attacker?.totalCount || 0}</em>
          </div>
          <div className="pve2-side defender">
            <span>守军</span>
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
            debugStats={debugStats}
            pitchLabel={pitchLabel}
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
            />

            <SquadCards
              squads={toCardsByTeam(cards)}
              phase={phase}
              actionAnchorMode={deployActionAnchorMode}
              onFocus={handleCardFocus}
              onSelect={handleCardSelect}
              onDeployMove={handleDeployMove}
              onDeployEdit={handleOpenDeployEditorForGroup}
              onDeployDelete={handleDeployDelete}
            />

            <div className="pve2-action-pad">
              {phase === 'battle' ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('idle')}>待命</button>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('auto')}>自动</button>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('defend')}>防御</button>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('retreat')}>撤退</button>
                  <button type="button" className={`btn ${aimState.active ? 'btn-warning' : 'btn-primary'}`} onClick={handleToggleSkillAim}>技能瞄准</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-primary" onClick={handleOpenDeployCreator}>新建部队</button>
                  <span className="pve2-hint">
                    {deployDraggingGroupId
                      ? '部队已吸附鼠标：仅可放置在左侧蓝色部署区'
                      : '部署阶段：左蓝(我方) / 中间交战区禁布置 / 右红(敌方)'}
                  </span>
                </>
              )}
            </div>

            <Minimap
              snapshot={minimapSnapshot}
              cameraCenter={cameraMiniState.center}
              cameraViewport={cameraMiniState.viewport}
              onMapClick={handleMinimapClick}
            />

            {aimState.active ? (
              <div className="pve2-aim-tip">技能瞄准中：点击地面释放，`Esc` 取消</div>
            ) : null}

            {open ? (
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 56,
                  zIndex: 30030,
                  pointerEvents: 'none',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: '#dbeafe',
                  background: 'rgba(2, 6, 23, 0.72)',
                  border: '1px solid rgba(148, 163, 184, 0.35)',
                  borderRadius: 8,
                  padding: '6px 8px',
                  maxWidth: 'min(94vw, 860px)',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {[
                  `impl=${cameraAssert.cameraImplTag || 'N/A'} phase=${cameraAssert.phase || '-'} mirrorX=${cameraAssert.mirrorX ? 'true' : 'false'} handedness=${(Number(cameraAssert.handedness) || 0).toFixed(4)}`,
                  `yawDeg=${(Number(cameraAssert.yawDeg) || 0).toFixed(2)} worldYawDeg=${(Number(cameraAssert.worldYawDeg) || 0).toFixed(2)} deltaYaw=${((Number(cameraAssert.worldYawDeg) || 0) - (Number(cameraAssert.yawDeg) || 0)).toFixed(2)} pitch=${(Number(cameraAssert.currentPitch) || 0).toFixed(2)} [low=${(Number(cameraAssert.pitchLow) || 0).toFixed(2)}, high=${(Number(cameraAssert.pitchHigh) || 0).toFixed(2)}] distance=${(Number(cameraAssert.distance) || 0).toFixed(2)}`,
                  `center=(${(Number(cameraAssert.centerX) || 0).toFixed(2)}, ${(Number(cameraAssert.centerY) || 0).toFixed(2)}) eye=(${(Number(cameraAssert.eyeX) || 0).toFixed(2)}, ${(Number(cameraAssert.eyeY) || 0).toFixed(2)}, ${(Number(cameraAssert.eyeZ) || 0).toFixed(2)}) target=(${(Number(cameraAssert.targetX) || 0).toFixed(2)}, ${(Number(cameraAssert.targetY) || 0).toFixed(2)}, ${(Number(cameraAssert.targetZ) || 0).toFixed(2)})`,
                  `cameraRight=(${(Number(cameraAssert.cameraRightX) || 0).toFixed(4)}, ${(Number(cameraAssert.cameraRightY) || 0).toFixed(4)}, ${(Number(cameraAssert.cameraRightZ) || 0).toFixed(4)})`,
                  `field=(${(Number(cameraAssert.fieldWidth) || 0).toFixed(1)} x ${(Number(cameraAssert.fieldHeight) || 0).toFixed(1)}) deployRange=[attackerMaxX ${(Number(cameraAssert.deployAttackerMaxX) || 0).toFixed(2)}, defenderMinX ${(Number(cameraAssert.deployDefenderMinX) || 0).toFixed(2)}]`,
                  `pointerWorld=(${(Number(cameraAssert.pointerX) || 0).toFixed(2)}, ${(Number(cameraAssert.pointerY) || 0).toFixed(2)}) pointerValid=${cameraAssert.pointerValid ? 'true' : 'false'} isPanning=${cameraAssert.isPanning ? 'true' : 'false'} panStart(distance=${(Number(cameraAssert.panStartDistance) || 0).toFixed(2)}, pitch=${(Number(cameraAssert.panStartPitch) || 0).toFixed(2)})`
                ].join('\n')}
              </div>
            ) : null}

            {glError ? (
              <div className="pve2-error-overlay">{glError}</div>
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
                <h4>{deployEditingGroupId ? '编辑部队' : '新建部队'}</h4>
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
                        key={`atk-left-${row.unitTypeId}`}
                        type="button"
                        className="pve2-deploy-unit-card"
                        draggable={row.availableForDraft > 0}
                        disabled={row.availableForDraft <= 0}
                        onDragStart={(event) => {
                          event.dataTransfer?.setData('application/x-attacker-unit-id', row.unitTypeId);
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
                      <div key={`atk-right-${entry.unitTypeId}`} className="pve2-deploy-editor-row">
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
              <h3>战斗结算</h3>
              {resultState.summary ? (
                <>
                  <p>{resultState.summary.endReason || '战斗结束'}</p>
                  <div className="pve2-result-grid">
                    <div>
                      <strong>我方</strong>
                      <span>{resultState.summary.attacker?.remain || 0}/{resultState.summary.attacker?.start || 0}</span>
                      <span>击杀 {resultState.summary.attacker?.kills || 0}</span>
                    </div>
                    <div>
                      <strong>守军</strong>
                      <span>{resultState.summary.defender?.remain || 0}/{resultState.summary.defender?.start || 0}</span>
                      <span>击杀 {resultState.summary.defender?.kills || 0}</span>
                    </div>
                  </div>
                </>
              ) : null}
              {resultState.submitting ? <p>正在上报战斗结果...</p> : null}
              {resultState.error ? <p className="error">{resultState.error}</p> : null}
              {resultState.recorded ? <p className="ok">战报已记录</p> : null}
              <div className="pve2-result-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>返回围城</button>
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

export default PveBattleModal;
