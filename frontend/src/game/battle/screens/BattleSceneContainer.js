import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../presentation/ui/Battle.css';
import CameraController from '../presentation/render/CameraController';
import useBattleRuntime from '../hooks/useBattleRuntime';
import useBattleRenderPipeline from '../hooks/useBattleRenderPipeline';
import useBattleLoop from '../hooks/useBattleLoop';
import useBattleUiSync from '../hooks/useBattleUiSync';
import useArmyTemplates from '../hooks/useArmyTemplates';
import useBattleSceneGlobalInput from '../hooks/useBattleSceneGlobalInput';
import useBattleSceneDerivedState from '../hooks/useBattleSceneDerivedState';
import useBattleQuickDeploy from '../hooks/useBattleQuickDeploy';
import useBattleDeployEditor from '../hooks/useBattleDeployEditor';
import useBattleDeployGroupActions from '../hooks/useBattleDeployGroupActions';
import useBattleActions from '../hooks/useBattleActions';
import useBattleSceneSelection from '../hooks/useBattleSceneSelection';
import useBattleEscapeHandler from '../hooks/useBattleEscapeHandler';
import useBattleSceneInputController from '../hooks/useBattleSceneInputController';
import useBattleSceneLifecycle from '../hooks/useBattleSceneLifecycle';
import useBattleSceneUiState from '../hooks/useBattleSceneUiState';
import BattleHUD from '../presentation/ui/BattleHUD';
import SquadCards from '../presentation/ui/SquadCards';
import DeployActionButtons from '../presentation/ui/DeployActionButtons';
import BattleActionButtons from '../presentation/ui/BattleActionButtons';
import Minimap from '../presentation/ui/Minimap';
import AimOverlayCanvas from '../presentation/ui/AimOverlayCanvas';
import BattleDebugPanel from '../presentation/ui/BattleDebugPanel';
import BattleDeploySidebar from '../presentation/ui/BattleDeploySidebar';
import BattleQuickDeployModal from '../presentation/ui/BattleQuickDeployModal';
import BattleTemplateFillModal from '../presentation/ui/BattleTemplateFillModal';
import BattleDeployEditorPanel from '../presentation/ui/BattleDeployEditorPanel';
import BattleMarchModeFloat from '../presentation/ui/BattleMarchModeFloat';
import BattleSkillPickFloat from '../presentation/ui/BattleSkillPickFloat';
import DeployGroupInfoPanel from '../presentation/ui/DeployGroupInfoPanel';
import BattleFormationWheel from '../presentation/ui/BattleFormationWheel';
import useDraggablePanel from '../presentation/ui/useDraggablePanel';
import unitVisualConfig from '../presentation/assets/UnitVisualConfig.example.json';
import NumberPadDialog from '../../../components/common/NumberPadDialog';
import BattleDataService from '../data/BattleDataService';
import {
  BATTLE_FOLLOW_MIRROR_X,
  BATTLE_FOLLOW_WORLD_YAW_DEG,
  BATTLE_FOLLOW_YAW_DEG,
  BATTLE_PITCH_HIGH_DEG,
  BATTLE_PITCH_LOW_DEG,
  BATTLE_UI_MODE_MARCH_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  BATTLE_UI_MODE_SKILL_PICK,
  CAMERA_DISTANCE_MAX,
  CAMERA_DISTANCE_MIN,
  CAMERA_ZOOM_STEP,
  DEPLOY_DEFAULT_YAW_DEG,
  DEPLOY_PITCH_DEG,
  DEPLOY_ROTATE_CLICK_THRESHOLD,
  DEPLOY_ROTATE_SENSITIVITY,
  ORDER_MOVE,
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultConfirmDeletePos,
  createDefaultDeployInfoState,
  createDefaultResultState,
  createDefaultDeployQuantityDialog,
  speedModeLabel
} from './battleSceneConstants';
import {
  clamp,
  buildCompatSummaryPayload,
  resolveBattleDebugSwitch,
  skillAoeRadiusByClass,
  skillRangeByClass,
  toCardsByTeam
} from './battleSceneUtils';

const EDGE_SCROLL_ZONE_PX = 42;
const EDGE_SCROLL_CURVE = 1.55;

const isBattleDocumentActive = () => (
  typeof document === 'undefined'
    || (
      document.visibilityState === 'visible'
      && (typeof document.hasFocus !== 'function' || document.hasFocus())
    )
);

const resolveEdgeScrollAxis = (position, start, end) => {
  const axisLength = Math.max(1, end - start);
  const edgeZone = Math.min(EDGE_SCROLL_ZONE_PX, axisLength * 0.25);
  const leadingDepth = (start + edgeZone) - position;
  const trailingDepth = position - (end - edgeZone);
  if (leadingDepth <= 0 && trailingDepth <= 0) return 0;
  const direction = leadingDepth > trailingDepth ? -1 : 1;
  const depth = Math.max(leadingDepth, trailingDepth);
  const normalizedDepth = clamp(depth / Math.max(1, edgeZone), 0, 1);
  return direction * (normalizedDepth ** EDGE_SCROLL_CURVE);
};

const resolveEdgeScrollVector = (pointer, rect) => ({
  x: resolveEdgeScrollAxis(pointer.clientX, rect.left, rect.right),
  y: -resolveEdgeScrollAxis(pointer.clientY, rect.top, rect.bottom)
});

const BattleSceneContainer = ({
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
  const sceneRef = useRef(null);
  const cameraRef = useRef(new CameraController({
    yawDeg: DEPLOY_DEFAULT_YAW_DEG,
    pitchLow: BATTLE_PITCH_LOW_DEG,
    pitchHigh: BATTLE_PITCH_HIGH_DEG,
    distance: 560,
    mirrorX: false
  }));
  const pointerWorldRef = useRef({ x: 0, y: 0 });
  const panDragRef = useRef(null);
  const deployYawDragRef = useRef(null);
  const deployRectDragRef = useRef(null);
  const spacePressedRef = useRef(false);
  const mapKeyCommandsRef = useRef(new Set());
  const edgeScrollPointerRef = useRef({ active: false, clientX: 0, clientY: 0 });
  const edgeScrollMotionRef = useRef({ intensity: 0, directionKey: '', carrying: false });
  const runtimeInitRef = useRef(null);
  const reportBattleResultRef = useRef(() => {});
  const [mapKeyCommand, setMapKeyCommand] = useState('');
  const [deployFormationLibrary, setDeployFormationLibrary] = useState({});
  const [formationWheelState, setFormationWheelState] = useState({
    open: false,
    groupId: '',
    x: 0,
    y: 0
  });

  const {
    paused,
    setPaused,
    debugEnabled,
    setDebugEnabled,
    aimState,
    setAimState,
    battleUiMode,
    setBattleUiMode,
    worldActionsVisibleForSquadId,
    setWorldActionsVisibleForSquadId,
    hoverSquadIdOnCard,
    setHoverSquadIdOnCard,
    pendingPathPoints,
    setPendingPathPoints,
    planningHoverPoint,
    setPlanningHoverPoint,
    skillConfirmState,
    setSkillConfirmState,
    skillPopupSquadId,
    setSkillPopupSquadId,
    skillPopupPos,
    setSkillPopupPos,
    marchModePickOpen,
    setMarchModePickOpen,
    marchPopupPos,
    setMarchPopupPos,
    selectedSquadId,
    setSelectedSquadId,
    resultState,
    setResultState,
    deployEditorOpen,
    setDeployEditorOpen,
    deployEditingGroupId,
    setDeployEditingGroupId,
    deployEditorDraft,
    setDeployEditorDraft,
    deployQuantityDialog,
    setDeployQuantityDialog,
    setDeployDraggingGroup,
    deployActionAnchorMode,
    setDeployActionAnchorMode,
    deployNotice,
    setDeployNotice,
    deployEditorDragUnitId,
    setDeployEditorDragUnitId,
    deployEditorTeam,
    setDeployEditorTeam,
    selectedPaletteItemId,
    setSelectedPaletteItemId,
    confirmDeleteGroupId,
    setConfirmDeleteGroupId,
    confirmDeletePos,
    setConfirmDeletePos,
    deployInfoState,
    setDeployInfoState,
    quickDeployOpen,
    setQuickDeployOpen,
    quickDeployTab,
    setQuickDeployTab,
    quickDeployApplying,
    setQuickDeployApplying,
    quickDeployError,
    setQuickDeployError,
    quickDeployRandomForm,
    setQuickDeployRandomForm,
    templateFillPreview,
    setTemplateFillPreview,
    showMidlineDebug,
    setShowMidlineDebug,
    isPanning,
    setIsPanning,
    deployDraggingGroupId,
    deployDraggingTeam
  } = useBattleSceneUiState();

  const closeModal = useCallback(() => {
    if (typeof onClose === 'function') onClose();
  }, [onClose]);

  const {
    runtimeRef,
    phase,
    runtimeVersion,
    setPhase,
    api: { startBattle }
  } = useBattleRuntime({
    open,
    initData: battleInitData,
    mode,
    visualConfig: unitVisualConfig
  });
  const deployPlacementLocked = phase === 'deploy' && !!deployDraggingGroupId;

  const {
    battleStatus,
    cardRows: cards,
    minimapSnapshot,
    setBattleStatus,
    setCardRows: setCards,
    setMinimapSnapshot
  } = useBattleUiSync({
    runtimeRef,
    intervalMs: 120,
    enabled: open && runtimeVersion > 0
  });

  const {
    armyTemplates,
    armyTemplatesLoading,
    armyTemplatesError
  } = useArmyTemplates({ open });

  const {
    pipelineRef,
    isReady: renderReady,
    glError
  } = useBattleRenderPipeline({
    canvasRef: glCanvasRef,
    runtimeRef,
    enabled: open,
    loading,
    error,
    battleInitData,
    mode
  });

  const {
    stats: debugStats,
    setPaused: setLoopPaused,
    resetClock,
    worldToScreenRef,
    worldToDomRef,
    cameraViewRectRef,
    cameraMiniState,
    cameraAssert,
    runtimeDebugOverlay
  } = useBattleLoop({
    enabled: open && runtimeVersion > 0 && renderReady && !loading && !error && !glError,
    canvasRef: glCanvasRef,
    runtimeRef,
    pipelineRef,
    cameraControllerRef: cameraRef,
    idleFrameIntervalMs: isTrainingMode ? (1000 / 20) : 0,
    debugEnabled,
    callbacks: {
      onBattleEnded: (summary) => {
        setResultState({ ...createDefaultResultState(), open: true, summary });
        reportBattleResultRef.current(summary);
      },
      onPhaseChange: setPhase,
      pointerWorldRef,
      panDragRef,
      resolveBattleDebugSwitch
    },
    constants: {
      DEPLOY_DEFAULT_YAW_DEG,
      DEPLOY_PITCH_DEG,
      BATTLE_FOLLOW_YAW_DEG,
      BATTLE_FOLLOW_WORLD_YAW_DEG,
      BATTLE_FOLLOW_MIRROR_X
    }
  });

  useBattleSceneLifecycle({
    open,
    phase,
    runtimeRef,
    runtimeVersion,
    runtimeInitRef,
    cameraRef,
    resetClock,
    setLoopPaused,
    setPaused,
    setBattleStatus,
    setCards,
    setMinimapSnapshot,
    setSelectedSquadId,
    setAimState,
    setBattleUiMode,
    setWorldActionsVisibleForSquadId,
    setHoverSquadIdOnCard,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setSkillConfirmState,
    setSkillPopupSquadId,
    setSkillPopupPos,
    setMarchModePickOpen,
    setMarchPopupPos,
    setResultState,
    setDeployEditorOpen,
    setDeployEditingGroupId,
    setDeployEditorDraft,
    setDeployQuantityDialog,
    setDeployDraggingGroup,
    setDeployInfoState,
    setDeployActionAnchorMode,
    setDeployNotice,
    setDeployEditorDragUnitId,
    setDeployEditorTeam,
    setSelectedPaletteItemId,
    setQuickDeployOpen,
    setQuickDeployTab,
    setQuickDeployApplying,
    setQuickDeployError,
    setQuickDeployRandomForm,
    setShowMidlineDebug,
    templateFillPreviewOpen: templateFillPreview.open,
    setTemplateFillPreview
  });

  const reportBattleResult = useCallback(async (summary) => {
    if (!summary) return;
    if (!requireResultReport || !battleInitData?.nodeId) {
      if (typeof onBattleFinished === 'function') onBattleFinished();
      setResultState((prev) => ({ ...prev, submitting: false, recorded: true, error: '' }));
      return;
    }
    setResultState((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      await BattleDataService.postPveBattleResult({
        nodeId: battleInitData.nodeId,
        payload: buildCompatSummaryPayload(summary)
      });

      setResultState((prev) => ({ ...prev, submitting: false, recorded: true, error: '' }));
      if (typeof onBattleFinished === 'function') {
        onBattleFinished();
      }
    } catch (submitError) {
      setResultState((prev) => ({ ...prev, submitting: false, error: submitError.message || '上报失败' }));
    }
  }, [battleInitData, onBattleFinished, requireResultReport, setResultState]);

  useEffect(() => {
    reportBattleResultRef.current = reportBattleResult;
  }, [reportBattleResult]);

  const clampCameraCenterToField = useCallback((nextX, nextY) => {
    const runtime = runtimeRef.current;
    const field = runtime?.getField?.();
    const halfFieldW = Math.max(50, Number(field?.width) || 2700) * 0.5;
    const halfFieldH = Math.max(50, Number(field?.height) || 1488) * 0.5;
    const viewHalfW = Math.max(1, Number(cameraViewRectRef.current?.widthWorld) || 240) * 0.5;
    const viewHalfH = Math.max(1, Number(cameraViewRectRef.current?.heightWorld) || 160) * 0.5;
    const edgeMargin = 8;

    const minX = -halfFieldW - viewHalfW + edgeMargin;
    const maxX = halfFieldW + viewHalfW - edgeMargin;
    const minY = -halfFieldH - viewHalfH + edgeMargin;
    const maxY = halfFieldH + viewHalfH - edgeMargin;

    return {
      x: Math.min(maxX, Math.max(minX, Number(nextX) || 0)),
      y: Math.min(maxY, Math.max(minY, Number(nextY) || 0))
    };
  }, [cameraViewRectRef, runtimeRef]);

  const handleMapKeyCommand = useCallback((command, active, options = {}) => {
    if (options.clearAll) {
      mapKeyCommandsRef.current.clear();
      setMapKeyCommand('');
      return;
    }
    if (!command) return;
    if (active) mapKeyCommandsRef.current.add(command);
    else mapKeyCommandsRef.current.delete(command);
    setMapKeyCommand(Array.from(mapKeyCommandsRef.current).sort().join('|'));
  }, []);

  const handleDeployGroupFormationsChange = useCallback((groupId, formations = [], activeFormationId = '') => {
    const safeGroupId = String(groupId || '').trim();
    if (!safeGroupId) return;
    setDeployFormationLibrary((prev) => {
      const legalFormations = (Array.isArray(formations) ? formations : [])
        .filter((formation) => formation && formation.legal !== false)
        .slice(0, 15);
      if (legalFormations.length <= 0) {
        const next = { ...prev };
        delete next[safeGroupId];
        return next;
      }
      const fallbackId = String(legalFormations[0]?.formationId || legalFormations[0]?.id || '').trim();
      return {
        ...prev,
        [safeGroupId]: {
          formations: legalFormations,
          activeFormationId: String(activeFormationId || fallbackId || '').trim()
        }
      };
    });
  }, []);

  const handleDeployGroupRemoved = useCallback((groupId) => {
    const safeGroupId = String(groupId || '').trim();
    if (!safeGroupId) return;
    setDeployFormationLibrary((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, safeGroupId)) return prev;
      const next = { ...prev };
      delete next[safeGroupId];
      return next;
    });
    setFormationWheelState((prev) => (
      prev.groupId === safeGroupId ? { ...prev, open: false, groupId: '' } : prev
    ));
  }, []);

  const handleDeployGroupIdChanged = useCallback((prevGroupId, nextGroupId, nextActiveFormationId = '') => {
    const safePrevId = String(prevGroupId || '').trim();
    const safeNextId = String(nextGroupId || '').trim();
    if (!safePrevId || !safeNextId || safePrevId === safeNextId) return;
    setDeployFormationLibrary((prev) => {
      const source = prev[safePrevId];
      if (!source) return prev;
      const next = { ...prev };
      delete next[safePrevId];
      next[safeNextId] = {
        ...source,
        activeFormationId: nextActiveFormationId || source.activeFormationId || ''
      };
      return next;
    });
    setFormationWheelState((prev) => (
      prev.groupId === safePrevId ? { ...prev, groupId: safeNextId } : prev
    ));
  }, []);

  const getSceneRelativePosition = useCallback((event = null, fallbackWorld = null) => {
    const sceneRect = sceneRef.current?.getBoundingClientRect();
    let x = Number(sceneRect?.width) * 0.5 || 360;
    let y = Number(sceneRect?.height) * 0.5 || 240;
    if (event?.currentTarget?.getBoundingClientRect && sceneRect) {
      const targetRect = event.currentTarget.getBoundingClientRect();
      x = (targetRect.left + (targetRect.width * 0.5)) - sceneRect.left;
      y = (targetRect.top + (targetRect.height * 0.5)) - sceneRect.top;
    } else if (Number.isFinite(Number(event?.clientX)) && Number.isFinite(Number(event?.clientY)) && sceneRect) {
      x = Number(event.clientX) - sceneRect.left;
      y = Number(event.clientY) - sceneRect.top;
    } else if (fallbackWorld && worldToDomRef.current) {
      const dom = worldToDomRef.current({ x: Number(fallbackWorld.x) || 0, y: Number(fallbackWorld.y) || 0, z: 0 });
      if (dom?.visible !== false) {
        x = Number(dom.x) || x;
        y = Number(dom.y) || y;
      }
    }
    const maxX = Math.max(28, Number(sceneRect?.width) || x);
    const maxY = Math.max(28, Number(sceneRect?.height) || y);
    const marginX = Math.min(152, Math.max(28, (maxX * 0.5) - 4));
    const marginY = Math.min(152, Math.max(28, (maxY * 0.5) - 4));
    return {
      x: clamp(x, marginX, Math.max(marginX, maxX - marginX)),
      y: clamp(y, marginY, Math.max(marginY, maxY - marginY))
    };
  }, [worldToDomRef]);

  const openFormationWheelForGroup = useCallback((groupId, event = null) => {
    const runtime = runtimeRef.current;
    const safeGroupId = String(groupId || '').trim();
    if (!runtime || runtime.getPhase?.() !== 'deploy' || !safeGroupId) return false;
    const library = deployFormationLibrary[safeGroupId];
    const formations = Array.isArray(library?.formations) ? library.formations : [];
    if (formations.length <= 0) {
      setDeployNotice('该部队没有可切换的模板阵型');
      return false;
    }
    const group = runtime.getDeployGroupById(safeGroupId);
    const pos = getSceneRelativePosition(event, group || pointerWorldRef.current);
    setFormationWheelState({
      open: true,
      groupId: safeGroupId,
      x: pos.x,
      y: pos.y
    });
    setDeployActionAnchorMode('');
    return true;
  }, [
    deployFormationLibrary,
    getSceneRelativePosition,
    pointerWorldRef,
    runtimeRef,
    setDeployActionAnchorMode,
    setDeployNotice
  ]);

  const handleFormationKey = useCallback(() => {
    if (phase !== 'deploy') return;
    const targetGroupId = deployDraggingGroupId || selectedSquadId;
    if (!targetGroupId) return;
    openFormationWheelForGroup(targetGroupId);
  }, [deployDraggingGroupId, openFormationWheelForGroup, phase, selectedSquadId]);

  const handleCloseFormationWheel = useCallback(() => {
    setFormationWheelState((prev) => ({ ...prev, open: false }));
  }, []);

  const handlePickDeployFormation = useCallback((formation) => {
    const runtime = runtimeRef.current;
    const groupId = String(formationWheelState.groupId || deployDraggingGroupId || selectedSquadId || '').trim();
    if (!runtime || runtime.getPhase?.() !== 'deploy' || !groupId || !formation) return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) {
      setFormationWheelState((prev) => ({ ...prev, open: false, groupId: '' }));
      return;
    }
    const groupTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = runtime.setDeployGroupFormation(groupId, formation, groupTeam);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '阵型切换失败');
      return;
    }
    const formationId = String(formation?.formationId || formation?.id || '').trim();
    setDeployFormationLibrary((prev) => {
      const source = prev[groupId];
      if (!source) return prev;
      return {
        ...prev,
        [groupId]: {
          ...source,
          activeFormationId: formationId || source.activeFormationId || ''
        }
      };
    });
    runtime.setSelectedDeployGroup(groupId);
    runtime.setFocusSquad(groupId);
    setSelectedSquadId(groupId);
    setFormationWheelState((prev) => ({ ...prev, open: false }));

    if (group.placed !== false && !runtime.canDeployGroupFitAt(groupId, group, groupTeam)) {
      runtime.setDeployGroupPlaced(groupTeam, groupId, false);
      setDeployDraggingGroup({ groupId, team: groupTeam });
      setDeployActionAnchorMode('');
      setDeployNotice('新阵型放不下当前位置，已回到鼠标吸附状态；右键可取消放置');
    } else {
      setDeployNotice(`已切换阵型：${formation?.name || '未命名阵型'}`);
    }
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
  }, [
    deployDraggingGroupId,
    formationWheelState.groupId,
    runtimeRef,
    selectedSquadId,
    setCards,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployNotice,
    setMinimapSnapshot,
    setSelectedSquadId
  ]);

  const handleDeployGroupTeamSwitched = useCallback(({ prevGroupId = '', nextGroupId = '', nextTeam = TEAM_ATTACKER } = {}) => {
    const safePrevId = String(prevGroupId || '').trim();
    const safeNextId = String(nextGroupId || '').trim();
    if (!safePrevId || !safeNextId || safePrevId === safeNextId) return;
    const source = deployFormationLibrary[safePrevId];
    const activeFormationId = String(source?.activeFormationId || '').trim();
    const activeFormation = Array.isArray(source?.formations)
      ? source.formations.find((formation) => String(formation?.formationId || formation?.id || '').trim() === activeFormationId)
      : null;
    if (activeFormation) {
      runtimeRef.current?.setDeployGroupFormation?.(safeNextId, activeFormation, nextTeam === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER);
    }
    handleDeployGroupIdChanged(safePrevId, safeNextId, activeFormationId);
  }, [deployFormationLibrary, handleDeployGroupIdChanged, runtimeRef]);

  useEffect(() => {
    if (!open) return undefined;
    const clearEdgeScroll = () => {
      edgeScrollPointerRef.current.active = false;
      edgeScrollMotionRef.current = { intensity: 0, directionKey: '', carrying: false };
    };
    const handleWindowMouseMove = (event) => {
      if (!isBattleDocumentActive()) {
        clearEdgeScroll();
        return;
      }
      const clientX = Number(event.clientX);
      const clientY = Number(event.clientY);
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        clearEdgeScroll();
        return;
      }
      edgeScrollPointerRef.current = { active: true, clientX, clientY };
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') clearEdgeScroll();
    };
    window.addEventListener('mousemove', handleWindowMouseMove, true);
    window.addEventListener('blur', clearEdgeScroll);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove, true);
      window.removeEventListener('blur', clearEdgeScroll);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearEdgeScroll();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let rafId = 0;
    let idleTimerId = 0;
    let lastTs = performance.now();
    const step = (ts) => {
      const runtime = runtimeRef.current;
      const camera = cameraRef.current;
      let hasActiveCameraMotion = false;
      if (runtime && camera) {
        const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
        lastTs = ts;
        const panSpeed = Math.max(170, (Number(camera.distance) || 560) * 1.05);
        const rotateSpeed = 145;
        const worldYawRad = (Number(camera.worldYawDeg) || 0) * (Math.PI / 180);
        let rightX = Math.sin(worldYawRad);
        let rightY = Math.cos(worldYawRad);
        let forwardX = Math.cos(worldYawRad);
        let forwardY = -Math.sin(worldYawRad);
        const canvas = glCanvasRef.current;
        if (canvas) {
          const viewportWidth = Math.max(1, Number(canvas.width) || 1);
          const viewportHeight = Math.max(1, Number(canvas.height) || 1);
          const centerPxX = viewportWidth * 0.5;
          const centerPxY = viewportHeight * 0.5;
          const samplePx = Math.max(24, Math.min(viewportWidth, viewportHeight) * 0.08);
          const centerWorld = camera.screenToGround(centerPxX, centerPxY, { width: viewportWidth, height: viewportHeight });
          const rightWorld = camera.screenToGround(centerPxX + samplePx, centerPxY, { width: viewportWidth, height: viewportHeight });
          const upWorld = camera.screenToGround(centerPxX, centerPxY - samplePx, { width: viewportWidth, height: viewportHeight });
          const rx = (Number(rightWorld?.x) || 0) - (Number(centerWorld?.x) || 0);
          const ry = (Number(rightWorld?.y) || 0) - (Number(centerWorld?.y) || 0);
          const fx = (Number(upWorld?.x) || 0) - (Number(centerWorld?.x) || 0);
          const fy = (Number(upWorld?.y) || 0) - (Number(centerWorld?.y) || 0);
          const rightLen = Math.hypot(rx, ry);
          const forwardLen = Math.hypot(fx, fy);
          if (rightLen > 1e-4) {
            rightX = rx / rightLen;
            rightY = ry / rightLen;
          }
          if (forwardLen > 1e-4) {
            forwardX = fx / forwardLen;
            forwardY = fy / forwardLen;
          }
        }
        let nextCenterX = Number(camera.centerX) || 0;
        let nextCenterY = Number(camera.centerY) || 0;

        const commands = new Set(mapKeyCommandsRef.current);
        let moveRight = 0;
        let moveForward = 0;
        let rotateDirection = 0;
        if (commands.has('forward')) moveForward += 1;
        if (commands.has('backward')) moveForward -= 1;
        if (commands.has('right')) moveRight += 1;
        if (commands.has('left')) moveRight -= 1;
        if (commands.has('rotate_ccw')) rotateDirection -= 1;
        if (commands.has('rotate_cw')) rotateDirection += 1;
        const moveLen = Math.hypot(moveRight, moveForward);
        if (moveLen > 1e-4) {
          const dx = ((rightX * moveRight) + (forwardX * moveForward)) / moveLen;
          const dy = ((rightY * moveRight) + (forwardY * moveForward)) / moveLen;
          nextCenterX += dx * panSpeed * dt;
          nextCenterY += dy * panSpeed * dt;
        }

        const documentActive = isBattleDocumentActive();
        const edgePointer = edgeScrollPointerRef.current;
        if (!documentActive) edgePointer.active = false;
        const sceneRect = sceneRef.current?.getBoundingClientRect?.();
        const edgeScroll = documentActive
          && edgePointer.active
          && !panDragRef.current
          && sceneRect
          && (runtime.getPhase?.() === 'deploy' || runtime.getPhase?.() === 'battle')
          ? resolveEdgeScrollVector(edgePointer, sceneRect)
          : { x: 0, y: 0 };
        const rawEdgeIntensity = Math.max(Math.abs(edgeScroll.x), Math.abs(edgeScroll.y));
        const edgeMotion = edgeScrollMotionRef.current;
        let edgeIntensity = 0;
        if (rawEdgeIntensity > 1e-4) {
          const edgeDirectionKey = `${Math.sign(edgeScroll.x)},${Math.sign(edgeScroll.y)}`;
          const directionChanged = edgeMotion.directionKey && edgeMotion.directionKey !== edgeDirectionKey;
          if (directionChanged) edgeMotion.carrying = true;
          if (!edgeMotion.carrying) {
            edgeMotion.intensity = rawEdgeIntensity;
          } else {
            edgeMotion.intensity = Math.max(edgeMotion.intensity, rawEdgeIntensity);
          }
          edgeMotion.directionKey = edgeDirectionKey;
          edgeIntensity = edgeMotion.intensity;
        } else {
          edgeMotion.intensity = 0;
          edgeMotion.directionKey = '';
          edgeMotion.carrying = false;
        }
        const edgeLength = Math.hypot(edgeScroll.x, edgeScroll.y);
        if (edgeIntensity > 1e-4 && edgeLength > 1e-4) {
          const edgeWorldX = ((rightX * edgeScroll.x) + (forwardX * edgeScroll.y)) / edgeLength;
          const edgeWorldY = ((rightY * edgeScroll.x) + (forwardY * edgeScroll.y)) / edgeLength;
          nextCenterX += edgeWorldX * panSpeed * edgeIntensity * dt;
          nextCenterY += edgeWorldY * panSpeed * edgeIntensity * dt;
        }
        if (rotateDirection !== 0) {
          camera.worldYawDeg += rotateDirection * rotateSpeed * dt;
        }

        const clampedCenter = clampCameraCenterToField(nextCenterX, nextCenterY);
        camera.centerX = clampedCenter.x;
        camera.centerY = clampedCenter.y;
        hasActiveCameraMotion = (
          moveLen > 1e-4
          || edgeIntensity > 1e-4
          || rotateDirection !== 0
        );
      }
      if (hasActiveCameraMotion) {
        rafId = requestAnimationFrame(step);
      } else {
        idleTimerId = window.setTimeout(() => {
          idleTimerId = 0;
          rafId = requestAnimationFrame(step);
        }, 100);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (idleTimerId) window.clearTimeout(idleTimerId);
    };
  }, [clampCameraCenterToField, mapKeyCommand, open, runtimeRef]);


  const handleTogglePause = useCallback(() => {
    const next = !paused;
    setPaused(next);
    setLoopPaused(next);
  }, [paused, setLoopPaused, setPaused]);

  const handleTogglePitch = useCallback(() => {
    cameraRef.current.togglePitchMode();
  }, []);

  const {
    handleStartBattle,
    handleCardFocus,
    handleCardSelect,
    resolveDeployPlacementTeam,
    switchDeployGroupTeamForTraining,
    isPathPointBlocked
  } = useBattleSceneSelection({
    runtimeRef,
    cameraRef,
    startBattle,
    isTrainingMode,
    setPhase,
    setBattleStatus,
    setCards,
    setSelectedSquadId,
    setResultState,
    setAimState,
    setBattleUiMode,
    setWorldActionsVisibleForSquadId,
    setHoverSquadIdOnCard,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setSkillConfirmState,
    setMarchModePickOpen,
    setMarchPopupPos,
    setDeployDraggingGroup,
    setDeployActionAnchorMode,
    setDeployEditorOpen,
    setSelectedPaletteItemId,
    setQuickDeployOpen,
    setQuickDeployApplying,
    setQuickDeployError,
    setMinimapSnapshot
  });

  const setClockPaused = useCallback((nextPaused) => {
    setPaused(!!nextPaused);
    setLoopPaused(!!nextPaused);
  }, [setLoopPaused, setPaused]);

  const {
    syncBattleCards,
    selectBattleSquad,
    closeSkillConfirm,
    closeSkillPick,
    commitPathPlanning,
    closeMarchModePick,
    executeBattleAction,
    handleCycleSpeedMode,
    handleBattleActionClick,
    handleSkillPick,
    handleFinishPathPlanning,
    handlePickMarchMode
  } = useBattleActions({
    runtimeRef,
    cameraRef,
    glCanvasRef,
    worldToDomRef,
    selectedSquadId,
    battleUiMode,
    pendingPathPoints,
    setCards,
    setSelectedSquadId,
    setWorldActionsVisibleForSquadId,
    setSkillConfirmState,
    setBattleUiMode,
    setClockPaused,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setMarchModePickOpen,
    setMarchPopupPos,
    setSkillPopupPos,
    setSkillPopupSquadId
  });

  const {
    closeDeployEditor,
    handleOpenDeployCreator,
    handleOpenDeployEditorForGroup,
    openDeployQuantityDialog,
    handleDeployEditorDrop,
    handleConfirmDeployQuantity,
    handleRemoveDraftUnit,
    handleSaveDeployEditor,
    handleRecallDeployDraggingGroup,
    handleCreateTrainingGroupByTemplate,
    handleOpenTemplateFillPreview,
    handleCloseTemplateFillPreview,
    handleConfirmTemplateFillPreview
  } = useBattleDeployEditor({
    runtimeRef,
    pointerWorldRef,
    isTrainingMode,
    deployEditingGroupId,
    deployEditorDraft,
    deployEditorTeam,
    deployQuantityDialog,
    templateFillPreview,
    setDeployEditorOpen,
    setDeployEditingGroupId,
    setDeployEditorDraft,
    setDeployQuantityDialog,
    setDeployEditorDragUnitId,
    setDeployEditorTeam,
    setDeployNotice,
    setSelectedSquadId,
    setDeployDraggingGroup,
    setDeployActionAnchorMode,
    setCards,
    setMinimapSnapshot,
    setTemplateFillPreview,
    onDeployGroupFormationsChange: handleDeployGroupFormationsChange,
    onDeployGroupRemoved: handleDeployGroupRemoved
  });

  const handleCreateTrainingTemplateAtPointer = useCallback((template, team = TEAM_ATTACKER, event = null) => {
    const canvas = glCanvasRef.current;
    if (canvas && event && Number.isFinite(Number(event.clientX)) && Number.isFinite(Number(event.clientY))) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const px = ((Number(event.clientX) - rect.left) / Math.max(1, rect.width)) * canvas.width;
        const py = ((Number(event.clientY) - rect.top) / Math.max(1, rect.height)) * canvas.height;
        const world = cameraRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
        if (Number.isFinite(Number(world?.x)) && Number.isFinite(Number(world?.y))) {
          pointerWorldRef.current = world;
        }
      }
    }
    handleCreateTrainingGroupByTemplate(template, team);
  }, [cameraRef, glCanvasRef, handleCreateTrainingGroupByTemplate, pointerWorldRef]);

  const {
    onMouseDown: handleSceneMouseDown,
    onMouseMove: handlePointerMove,
    onWheel: handleSceneWheel,
    onContextMenu: handleSceneContextMenu,
    onMinimapClick: handleMinimapClick
  } = useBattleSceneInputController({
    open,
    glCanvasRef,
    runtimeRef,
    cameraRef,
    cameraViewRectRef,
    worldToScreenRef,
    pointerWorldRef,
    panDragRef,
    deployYawDragRef,
    deployRectDragRef,
    spacePressedRef,
    selectedSquadId,
    battleUiMode,
    skillConfirmState,
    aimState,
    deployDraggingGroupId,
    deployDraggingTeam,
    selectedPaletteItemId,
    isTrainingMode,
    resolveDeployPlacementTeam,
    switchDeployGroupTeamForTraining,
    onDeployGroupTeamSwitched: handleDeployGroupTeamSwitched,
    isPathPointBlocked,
    syncBattleCards,
    selectBattleSquad,
    closeSkillConfirm,
    closeSkillPick,
    closeMarchModePick,
    recallDeployDraggingGroup: handleRecallDeployDraggingGroup,
    setClockPaused,
    setCards,
    setMinimapSnapshot,
    setIsPanning,
    setDeployNotice,
    setSelectedSquadId,
    setDeployDraggingGroup,
    setDeployActionAnchorMode,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setBattleUiMode,
    setSkillPopupSquadId,
    setAimState,
    setSkillConfirmState,
    setWorldActionsVisibleForSquadId,
    ORDER_MOVE,
    CAMERA_ZOOM_STEP,
    CAMERA_DISTANCE_MIN,
    CAMERA_DISTANCE_MAX,
    DEPLOY_ROTATE_SENSITIVITY,
    DEPLOY_ROTATE_CLICK_THRESHOLD,
    DEPLOY_PITCH_DEG,
    BATTLE_UI_MODE_NONE,
    BATTLE_UI_MODE_PATH,
    BATTLE_UI_MODE_MARCH_PICK,
    BATTLE_UI_MODE_SKILL_PICK,
    BATTLE_UI_MODE_SKILL_CONFIRM,
    skillRangeByClass,
    skillAoeRadiusByClass
  });

  const {
    syncDeployUiFromRuntime,
    handleDeployMove,
    handleDeployDelete,
    handleConfirmDeployDelete
  } = useBattleDeployGroupActions({
    runtimeRef,
    glCanvasRef,
    pointerWorldRef,
    isTrainingMode,
    confirmDeleteGroupId,
    setSelectedSquadId,
    setDeployDraggingGroup,
    setDeployActionAnchorMode,
    setCards,
    setMinimapSnapshot,
    setDeployNotice,
    setConfirmDeleteGroupId,
    setConfirmDeletePos,
    onDeployGroupRemoved: handleDeployGroupRemoved
  });

  const closeDeployInfoPanel = useCallback(() => {
    setDeployInfoState(createDefaultDeployInfoState());
  }, [setDeployInfoState]);

  const handleOpenDeployInfo = useCallback((groupId, event = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    if (!isTrainingMode && group.team === TEAM_DEFENDER) return;
    const groupInfo = runtime.getDeployGroupInfo?.(groupId);
    if (!groupInfo) return;

    const canvas = glCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    let x = (Number(window?.innerWidth) || 640) * 0.5;
    let y = (Number(window?.innerHeight) || 420) * 0.5;
    if (event?.currentTarget?.getBoundingClientRect) {
      const targetRect = event.currentTarget.getBoundingClientRect();
      x = targetRect.left + (targetRect.width * 0.5);
      y = targetRect.top + (targetRect.height * 0.5);
    } else if (Number.isFinite(Number(event?.clientX)) && Number.isFinite(Number(event?.clientY))) {
      x = Number(event.clientX);
      y = Number(event.clientY);
    } else if (rect) {
      x = rect.left + (rect.width * 0.5);
      y = rect.top + (rect.height * 0.5);
    }
    const viewportW = Math.max(320, Number(window?.innerWidth) || 0);
    const viewportH = Math.max(240, Number(window?.innerHeight) || 0);
    setDeployInfoState({
      open: true,
      groupId: String(groupId || ''),
      x: clamp(x, 8, Math.max(8, viewportW - 8)),
      y: clamp(y, 8, Math.max(8, viewportH - 8))
    });
  }, [glCanvasRef, isTrainingMode, runtimeRef, setDeployInfoState]);

  const handleDeployMoveWithInfoClose = useCallback((groupId, event) => {
    closeDeployInfoPanel();
    handleDeployMove(groupId, event);
  }, [closeDeployInfoPanel, handleDeployMove]);

  const handleDeployEditWithInfoClose = useCallback((groupId, event) => {
    closeDeployInfoPanel();
    handleOpenDeployEditorForGroup(groupId, event);
  }, [closeDeployInfoPanel, handleOpenDeployEditorForGroup]);

  const handleDeployDeleteWithInfoClose = useCallback((groupId, event) => {
    closeDeployInfoPanel();
    handleDeployDelete(groupId, event);
  }, [closeDeployInfoPanel, handleDeployDelete]);

  const handleConfirmDeployDeleteWithInfoClose = useCallback(() => {
    closeDeployInfoPanel();
    handleConfirmDeployDelete();
  }, [closeDeployInfoPanel, handleConfirmDeployDelete]);

  const {
    handleCloseQuickDeploy,
    handleQuickDeployTabChange,
    handleQuickDeployRandomFieldChange,
    handleApplyStandardQuickDeploy,
    handleApplyRandomQuickDeploy
  } = useBattleQuickDeploy({
    runtimeRef,
    isTrainingMode,
    quickDeployApplying,
    quickDeployRandomForm,
    syncDeployUiFromRuntime,
    setQuickDeployOpen,
    setQuickDeployTab,
    setQuickDeployError,
    setQuickDeployRandomForm,
    setQuickDeployApplying,
    setDeployDraggingGroup,
    setDeployActionAnchorMode,
    setDeployEditorOpen,
    setDeployEditingGroupId,
    setDeployEditorTeam,
    setDeployEditorDraft,
    setDeployEditorDragUnitId,
    setDeployQuantityDialog,
    setConfirmDeleteGroupId,
    setConfirmDeletePos,
    setSelectedPaletteItemId,
    setDeployNotice
  });

  const { handleEscape } = useBattleEscapeHandler({
    confirmDeleteGroupId,
    deployQuantityDialogOpen: deployQuantityDialog.open,
    deployInfoOpen: deployInfoState.open,
    quickDeployOpen,
    deployEditorOpen,
    deployDraggingGroupId,
    deployDraggingTeam,
    deployRectDragRef,
    battleUiMode,
    worldActionsVisibleForSquadId,
    aimStateActive: aimState.active,
    setConfirmDeleteGroupId,
    setConfirmDeletePos,
    setDeployQuantityDialog,
    setDeployInfoState,
    handleCloseQuickDeploy,
    closeDeployEditor,
    setDeployDraggingGroup,
    setDeployNotice,
    onRecallDeployDraggingGroup: handleRecallDeployDraggingGroup,
    closeSkillConfirm,
    commitPathPlanning,
    setBattleUiMode,
    setSkillPopupSquadId,
    setMarchModePickOpen,
    setClockPaused,
    setWorldActionsVisibleForSquadId,
    setAimState,
    closeModal
  });

  const handleSceneEscape = useCallback(() => {
    if (formationWheelState.open) {
      handleCloseFormationWheel();
      return;
    }
    handleEscape();
  }, [formationWheelState.open, handleCloseFormationWheel, handleEscape]);

  useBattleSceneGlobalInput({
    open,
    runtimeRef,
    spacePressedRef,
    marchModePickOpen,
    isSkillPickMode: battleUiMode === BATTLE_UI_MODE_SKILL_PICK,
    onEscape: handleSceneEscape,
    onTogglePause: handleTogglePause,
    onTogglePitch: handleTogglePitch,
    onMapKeyCommand: handleMapKeyCommand,
    onFormationKey: handleFormationKey,
    onCloseMarchModePick: closeMarchModePick,
    onCloseSkillPick: closeSkillPick
  });


  const {
    selectedSquad,
    selectedCardRow,
    skillPopupTargetSquadId,
    skillPopupMeta,
    selectedSpeedModeUi,
    selectedWaypoints,
    pitchLabel,
    deployEditorAvailableRows,
    deployEditorDraftSummary,
    deployEditorTeamLabel,
    deployEditorTotal,
    selectedDeployFormation,
    selectedDeployFormationLines,
    worldActionGroupId,
    worldActionPos,
    selectedBattleActionSquad,
    pathPlanningTailDom,
    confirmDeleteGroup,
    quickParsedAttackerTeams,
    quickParsedDefenderTeams,
    quickParsedAttackerTotal,
    quickParsedDefenderTotal,
    canDrawMidlineDebug,
    midlineLineStyle,
    teamMinLineStyle,
    teamMaxLineStyle
  } = useBattleSceneDerivedState({
    runtimeRef,
    phase,
    cards,
    selectedSquadId,
    battleUiMode,
    skillPopupSquadId,
    cameraRef,
    isTrainingMode,
    deployEditingGroupId,
    deployEditorTeam,
    deployEditorDraft,
    deployDraggingGroupId,
    worldToDomRef,
    deployActionAnchorMode,
    worldActionsVisibleForSquadId,
    pendingPathPoints,
    confirmDeleteGroupId,
    quickDeployRandomForm,
    debugEnabled,
    showMidlineDebug,
    debugStats
  });

  const deployInfoData = (
    phase === 'deploy'
    && deployInfoState.open
    && runtimeRef.current
  )
    ? runtimeRef.current.getDeployGroupInfo?.(deployInfoState.groupId)
    : null;

  useEffect(() => {
    if (!deployInfoState.open) return;
    if (phase !== 'deploy') {
      setDeployInfoState(createDefaultDeployInfoState());
      return;
    }
    if (!deployInfoData) {
      setDeployInfoState(createDefaultDeployInfoState());
    }
  }, [deployInfoData, deployInfoState.open, phase, setDeployInfoState]);

  const confirmOpen = phase === 'deploy' && !!confirmDeleteGroup && !deployPlacementLocked;
  const confirmInitialPosition = useMemo(() => {
    if (!confirmOpen) return null;
    const sceneRect = sceneRef.current?.getBoundingClientRect();
    if (!sceneRect) return null;
    return {
      x: sceneRect.left + (Number(confirmDeletePos?.x) || 0) - 160,
      y: sceneRect.top + (Number(confirmDeletePos?.y) || 0) - 72
    };
  }, [confirmDeletePos?.x, confirmDeletePos?.y, confirmOpen]);

  const {
    panelRef: confirmPanelRef,
    panelStyle: confirmPanelStyle,
    handleHeaderPointerDown: handleConfirmHeaderPointerDown
  } = useDraggablePanel({
    open: confirmOpen,
    initialPosition: confirmInitialPosition,
    defaultSize: { width: 360, height: 180 }
  });

  const {
    panelRef: resultPanelRef,
    panelStyle: resultPanelStyle,
    handleHeaderPointerDown: handleResultHeaderPointerDown
  } = useDraggablePanel({
    open: !!resultState.open,
    defaultSize: { width: 520, height: 320 }
  });

  if (!open) return null;

  const overlayClassName = [
    'pve2-overlay',
    isTrainingMode ? 'is-training-three' : '',
    deployPlacementLocked ? 'is-deploy-placement-lock' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={overlayClassName}>
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
            interactionLocked={deployPlacementLocked}
          />

          <div
            ref={sceneRef}
            className={`pve2-scene ${isPanning ? 'is-panning' : ''}`}
            onMouseDown={handleSceneMouseDown}
            onMouseMove={handlePointerMove}
            onContextMenu={handleSceneContextMenu}
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

            {phase === 'deploy' && selectedDeployFormation && !deployPlacementLocked ? (
              <div className="pve2-formation-overlay">
                {selectedDeployFormationLines.map((style, idx) => (
                  <div key={`formation-line-${idx}`} className="pve2-formation-line" style={style} />
                ))}
              </div>
            ) : null}

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
              disabled={deployPlacementLocked}
              onFocus={handleCardFocus}
              onSelect={handleCardSelect}
              hoverSquadIdOnCard={hoverSquadIdOnCard}
              onCardHoverChange={setHoverSquadIdOnCard}
              onBattleAction={handleBattleActionClick}
              onDeployInfo={handleOpenDeployInfo}
              onDeployMove={handleDeployMoveWithInfoClose}
              onDeployEdit={handleDeployEditWithInfoClose}
              onDeployDelete={handleDeployDeleteWithInfoClose}
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
              <BattleDeploySidebar
                isTrainingMode={isTrainingMode}
                armyTemplatesLoading={armyTemplatesLoading}
                armyTemplatesError={armyTemplatesError}
                armyTemplates={armyTemplates}
                attackerTeam={TEAM_ATTACKER}
                disabled={deployPlacementLocked}
                onCreateDeployGroup={handleOpenDeployCreator}
                onCreateTemplateGroup={handleCreateTrainingTemplateAtPointer}
                onOpenTemplateFillPreview={handleOpenTemplateFillPreview}
              />
            )}

            {phase === 'battle' ? (
              <BattleMarchModeFloat
                open={marchModePickOpen}
                popupPos={marchPopupPos}
                onPickMode={handlePickMarchMode}
              />
            ) : null}

            {phase === 'battle' ? (
              <BattleSkillPickFloat
                open={battleUiMode === BATTLE_UI_MODE_SKILL_PICK}
                popupPos={skillPopupPos}
                squadId={skillPopupTargetSquadId}
                skillPopupMeta={skillPopupMeta}
                onPickSkill={handleSkillPick}
              />
            ) : null}

            {phase === 'deploy' && !isTrainingMode && !deployPlacementLocked ? (
              <BattleTemplateFillModal
                open={templateFillPreview.open}
                preview={templateFillPreview}
                onClose={handleCloseTemplateFillPreview}
                onConfirm={handleConfirmTemplateFillPreview}
              />
            ) : null}

            {phase === 'deploy' && isTrainingMode && !deployPlacementLocked ? (
              <BattleQuickDeployModal
                open={quickDeployOpen}
                quickDeployTab={quickDeployTab}
                quickDeployApplying={quickDeployApplying}
                quickDeployError={quickDeployError}
                quickDeployRandomForm={quickDeployRandomForm}
                quickParsedAttackerTeams={quickParsedAttackerTeams}
                quickParsedDefenderTeams={quickParsedDefenderTeams}
                quickParsedAttackerTotal={quickParsedAttackerTotal}
                quickParsedDefenderTotal={quickParsedDefenderTotal}
                onClose={handleCloseQuickDeploy}
                onTabChange={handleQuickDeployTabChange}
                onChangeRandomForm={handleQuickDeployRandomFieldChange}
                onApplyStandardPreset={handleApplyStandardQuickDeploy}
                onApplyRandom={handleApplyRandomQuickDeploy}
              />
            ) : null}

            <Minimap
              snapshot={minimapSnapshot}
              cameraCenter={cameraMiniState.center}
              cameraViewport={cameraMiniState.viewport}
              onMapClick={handleMinimapClick}
              interactive={!deployPlacementLocked}
            />

            {battleUiMode === BATTLE_UI_MODE_PATH ? (
              <div className="pve2-aim-tip">路径规划中：LMB 添加路点，RMB 撤销，点击最后路径点“√”执行</div>
            ) : null}
            {battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM ? (
              <div className="pve2-aim-tip">技能确认态：LMB 确认释放，RMB 取消</div>
            ) : null}
            {runtimeDebugOverlay.enabled ? (
              <div className="pve2-runtime-debug">
                <div>{`phase: ${runtimeDebugOverlay.phase}`}</div>
                <div>{`pitchMix: ${Number(runtimeDebugOverlay.pitchMix || 0).toFixed(3)}`}</div>
                <div>{`formationRect: ${
                  runtimeDebugOverlay.formationRect
                    ? `w=${runtimeDebugOverlay.formationRect.width.toFixed(1)}, d=${runtimeDebugOverlay.formationRect.depth.toFixed(1)}, A=${runtimeDebugOverlay.formationRect.area.toFixed(1)}`
                    : 'n/a'
                }`}</div>
                {runtimeDebugOverlay.steeringWeights ? (
                  <div>{`steerW: ${JSON.stringify(runtimeDebugOverlay.steeringWeights)}`}</div>
                ) : null}
              </div>
            ) : null}

            {debugEnabled && !deployPlacementLocked ? (
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

            {phase === 'deploy' && worldActionPos?.visible && !deployPlacementLocked ? (
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
                  onInfo={(event) => handleOpenDeployInfo(worldActionGroupId, event)}
                  onMove={(event) => handleDeployMoveWithInfoClose(worldActionGroupId, event)}
                  onEdit={(event) => handleDeployEditWithInfoClose(worldActionGroupId, event)}
                  onFormation={(event) => openFormationWheelForGroup(worldActionGroupId, event)}
                  onDelete={(event) => handleDeployDeleteWithInfoClose(worldActionGroupId, event)}
                />
              </div>
            ) : null}

            {phase === 'deploy' ? (
              <BattleFormationWheel
                open={formationWheelState.open}
                formations={deployFormationLibrary[formationWheelState.groupId]?.formations || []}
                activeFormationId={deployFormationLibrary[formationWheelState.groupId]?.activeFormationId || ''}
                position={{ x: formationWheelState.x, y: formationWheelState.y }}
                onPick={handlePickDeployFormation}
                onClose={handleCloseFormationWheel}
              />
            ) : null}

            {phase === 'deploy' && !deployPlacementLocked && deployInfoState.open && deployInfoData ? (
              <DeployGroupInfoPanel
                open
                info={deployInfoData}
                position={deployInfoState}
                onClose={closeDeployInfoPanel}
              />
            ) : null}

            {phase === 'deploy' && !deployPlacementLocked ? (
              <BattleDeployEditorPanel
                open={deployEditorOpen}
                deployEditingGroupId={deployEditingGroupId}
                deployEditorTeamLabel={deployEditorTeamLabel}
                deployEditorDraft={deployEditorDraft}
                deployEditorTeam={deployEditorTeam}
                deployEditorAvailableRows={deployEditorAvailableRows}
                deployEditorDragUnitId={deployEditorDragUnitId}
                deployEditorTotal={deployEditorTotal}
                deployEditorDraftSummary={deployEditorDraftSummary}
                onChangeDraftName={(name) => setDeployEditorDraft((prev) => ({ ...prev, name }))}
                onSetDragUnitId={setDeployEditorDragUnitId}
                onOpenQuantityDialog={openDeployQuantityDialog}
                onDropUnit={handleDeployEditorDrop}
                onRemoveDraftUnit={handleRemoveDraftUnit}
                onCancel={closeDeployEditor}
                onConfirm={handleSaveDeployEditor}
              />
            ) : null}

            {phase === 'deploy' && deployNotice ? (
              <div className="pve2-deploy-notice">{deployNotice}</div>
            ) : null}

            {confirmOpen ? (
              <div
                ref={confirmPanelRef}
                className="pve2-confirm"
                style={confirmPanelStyle}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="pve2-confirm-head pve2-drag-handle" onPointerDown={handleConfirmHeaderPointerDown}>
                  <p>{`确认删除部队「${confirmDeleteGroup.name || '未命名部队'}」吗？`}</p>
                </div>
                <div className="pve2-confirm-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    data-no-drag
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      setConfirmDeleteGroupId('');
                      setConfirmDeletePos(createDefaultConfirmDeletePos());
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-warning btn-small"
                    data-no-drag
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={handleConfirmDeployDeleteWithInfoClose}
                  >
                    确认删除
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {resultState.open ? (
            <div
              ref={resultPanelRef}
              className="pve2-result"
              style={resultPanelStyle}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseUp={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="pve2-drag-handle" onPointerDown={handleResultHeaderPointerDown}>{isTrainingMode ? '训练结算' : '战斗结算'}</h3>
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
        onCancel={() => setDeployQuantityDialog(createDefaultDeployQuantityDialog())}
        onConfirm={handleConfirmDeployQuantity}
      />
    </div>
  );
};

export default BattleSceneContainer;
