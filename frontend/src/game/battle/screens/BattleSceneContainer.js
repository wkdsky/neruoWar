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
import BattleQuickDeployModal from '../presentation/ui/BattleQuickDeployModal';
import BattleTemplateFillModal from '../presentation/ui/BattleTemplateFillModal';
import BattleFormationSpacingFloat from '../presentation/ui/BattleFormationSpacingFloat';
import BattleSkillPickFloat from '../presentation/ui/BattleSkillPickFloat';
import DeployGroupInfoPanel from '../presentation/ui/DeployGroupInfoPanel';
import BattleFormationWheel from '../presentation/ui/BattleFormationWheel';
import TrainingSkillTreeModal from '../presentation/ui/TrainingSkillTreeModal';
import TrainingSettingsModal from '../presentation/ui/TrainingSettingsModal';
import TrainingFlagLabels from '../presentation/ui/TrainingFlagLabels';
import useDraggablePanel from '../presentation/ui/useDraggablePanel';
import ArmyPanel from '../../../components/game/ArmyPanel';
import unitVisualConfig from '../presentation/assets/UnitVisualConfig.example.json';
import BattleDataService from '../data/BattleDataService';
import {
  getSkillTreeById,
  getSkillTreeFirstActiveSkill,
  normalizeSkillSlots
} from '../../../components/game/skillTree/skillTreeData';
import {
  BATTLE_FOLLOW_MIRROR_X,
  BATTLE_FOLLOW_WORLD_YAW_DEG,
  BATTLE_FOLLOW_YAW_DEG,
  BATTLE_PITCH_HIGH_DEG,
  BATTLE_PITCH_LOW_DEG,
  BATTLE_UI_MODE_SPACING_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  BATTLE_UI_MODE_SKILL_PICK,
  CAMERA_DISTANCE_CLOSE_MIN,
  CAMERA_DISTANCE_MAX,
  CAMERA_DISTANCE_MIN,
  CAMERA_ZOOM_STEP,
  TRAINING_OVERVIEW_DISTANCE_EXTRA,
  TRAINING_OVERVIEW_DISTANCE_MAX,
  TRAINING_OVERVIEW_VIEW_PADDING,
  DEPLOY_DEFAULT_YAW_DEG,
  DEPLOY_PITCH_DEG,
  DEPLOY_ROTATE_CLICK_THRESHOLD,
  DEPLOY_ROTATE_SENSITIVITY,
  DEPLOY_WHEEL_ROTATE_STEP_DEG,
  ORDER_MOVE,
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultDeployInfoState,
  createDefaultResultState,
  createDefaultTrainingPresentationSettings,
  TRAINING_FONT_SCALE_BY_SIZE,
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

const serializeTrainingArmyGroup = (group = {}) => {
  const armyId = String(group?.armyId || group?.id || '').trim();
  const units = Object.entries(group?.units || {})
    .map(([unitTypeId, count]) => ({
      unitTypeId: String(unitTypeId || '').trim(),
      count: Math.max(0, Math.floor(Number(count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0);
  if (!armyId || units.length <= 0) return null;
  return {
    armyId,
    team: group?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER,
    controlMode: group?.controlMode === 'AI' ? 'AI' : 'USER',
    sortOrder: Math.max(0, Math.floor(Number(group?.sortOrder) || 0)),
    name: String(group?.name || '').trim(),
    templateId: String(group?.templateId || '').trim(),
    templateName: String(group?.templateName || '').trim(),
    units,
    templateFormations: Array.isArray(group?.templateFormations)
      ? group.templateFormations.slice(0, 9).map((formation) => ({
        formationId: String(formation?.formationId || formation?.id || '').trim(),
        name: String(formation?.name || '').trim(),
        placements: Array.isArray(formation?.placements)
          ? formation.placements.map((placement) => ({
            unitTypeId: String(placement?.unitTypeId || '').trim(),
            x: Math.floor(Number(placement?.x) || 0),
            y: Math.floor(Number(placement?.y) || 0)
          })).filter((placement) => placement.unitTypeId)
          : []
      })).filter((formation) => formation.formationId)
      : [],
    activeFormationId: String(group?.activeFormationId || group?.formationRect?.formationId || '').trim(),
    formationRect: group?.formationRect && typeof group.formationRect === 'object'
      ? { ...group.formationRect }
      : null,
    deploySlots: Array.isArray(group?.deploySlots) ? group.deploySlots.map((slot) => ({ ...slot })) : [],
    skillSlots: Array.isArray(group?.skillSlots)
      ? group.skillSlots.slice(0, 3).map((slot) => ({ ...slot }))
      : [],
    x: Number(group?.x) || 0,
    y: Number(group?.y) || 0,
    placed: group?.placed !== false
  };
};

const buildTrainingArmiesSnapshot = (runtime) => {
  const deployGroups = runtime?.getDeployGroups?.();
  if (!deployGroups) return [];
  return [
    ...(Array.isArray(deployGroups.attacker) ? deployGroups.attacker : []),
    ...(Array.isArray(deployGroups.defender) ? deployGroups.defender : [])
  ]
    .map(serializeTrainingArmyGroup)
    .filter(Boolean)
    .sort((left, right) => (
      (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0)
      || left.armyId.localeCompare(right.armyId)
    ));
};

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
  const deployDirectionArcDragRef = useRef(null);
  const spacePressedRef = useRef(false);
  const mapKeyCommandsRef = useRef(new Set());
  const runtimeInitRef = useRef(null);
  const reportBattleResultRef = useRef(() => {});
  const lastTrainingArmySnapshotRef = useRef('');
  const trainingArmySaveInFlightRef = useRef(null);
  const resetDeployNoticeTimeoutRef = useRef(null);
  const [mapKeyCommand, setMapKeyCommand] = useState('');
  const [deployFormationLibrary, setDeployFormationLibrary] = useState({});
  const [formationWheelState, setFormationWheelState] = useState({
    open: false,
    groupId: '',
    x: 0,
    y: 0
  });
  const [trainingSettingsOpen, setTrainingSettingsOpen] = useState(false);
  const [templateEditorState, setTemplateEditorState] = useState({
    open: false,
    template: null
  });
  const [trainingPresentationSettings, setTrainingPresentationSettings] = useState(createDefaultTrainingPresentationSettings);
  const [skillTreeModal, setSkillTreeModal] = useState({
    open: false,
    groupId: '',
    slotIndex: 0,
    treeCategory: '',
    progress: { unlocked: [] }
  });
  const trainingUiScale = TRAINING_FONT_SCALE_BY_SIZE[trainingPresentationSettings.fontSize]
    || TRAINING_FONT_SCALE_BY_SIZE.medium;

  useEffect(() => () => {
    if (resetDeployNoticeTimeoutRef.current) {
      window.clearTimeout(resetDeployNoticeTimeoutRef.current);
    }
  }, []);

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
    spacingPickOpen,
    setSpacingPickOpen,
    spacingPopupPos,
    setSpacingPopupPos,
    selectedSquadId,
    setSelectedSquadId,
    resultState,
    setResultState,
    setDeployDraggingGroup,
    deployActionAnchorMode,
    setDeployActionAnchorMode,
    deployNotice,
    setDeployNotice,
    selectedPaletteItemId,
    setSelectedPaletteItemId,
    confirmDeleteGroupId,
    setConfirmDeleteGroupId,
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

  const {
    runtimeRef,
    phase,
    runtimeVersion,
    setPhase,
    trainingSessionActive,
    api: { startBattle, resetTraining }
  } = useBattleRuntime({
    open,
    initData: battleInitData,
    mode,
    visualConfig: unitVisualConfig
  });

  const persistTrainingArmies = useCallback(async ({ force = false } = {}) => {
    if (!isTrainingMode || !open) return { ok: true, skipped: true };
    const runtime = runtimeRef.current;
    if (!runtime) return { ok: true, skipped: true };

    if (trainingArmySaveInFlightRef.current) {
      await trainingArmySaveInFlightRef.current;
    }

    const armies = buildTrainingArmiesSnapshot(runtime);
    const snapshot = JSON.stringify(armies);
    if (!force && snapshot === lastTrainingArmySnapshotRef.current) {
      return { ok: true, skipped: true };
    }

    const request = BattleDataService.saveTrainingArmies({ armies });
    trainingArmySaveInFlightRef.current = request;
    try {
      await request;
      lastTrainingArmySnapshotRef.current = snapshot;
      return { ok: true };
    } catch (saveError) {
      return { ok: false, error: saveError };
    } finally {
      if (trainingArmySaveInFlightRef.current === request) {
        trainingArmySaveInFlightRef.current = null;
      }
    }
  }, [isTrainingMode, open, runtimeRef]);

  const closeModal = useCallback(async () => {
    if (isTrainingMode) {
      const saved = await persistTrainingArmies({ force: true });
      if (!saved.ok) {
        setDeployNotice(`训练部队保存失败，未退出训练营：${saved.error?.message || '请重试'}`);
        return;
      }
    }
    if (typeof onClose === 'function') onClose();
  }, [isTrainingMode, onClose, persistTrainingArmies, setDeployNotice]);

  useEffect(() => {
    if (!isTrainingMode || !open || !runtimeRef.current) {
      lastTrainingArmySnapshotRef.current = '';
      return;
    }
    lastTrainingArmySnapshotRef.current = JSON.stringify(buildTrainingArmiesSnapshot(runtimeRef.current));
  }, [isTrainingMode, open, runtimeRef, runtimeVersion]);

  useEffect(() => {
    if (!isTrainingMode || !open || runtimeVersion <= 0) return undefined;
    const timerId = window.setInterval(() => {
      persistTrainingArmies().catch(() => {});
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isTrainingMode, open, persistTrainingArmies, runtimeVersion]);

  const deployPlacementLocked = phase === 'deploy' && !!deployDraggingGroupId;

  const {
    battleStatus,
    cardRows: cards,
    minimapSnapshot,
    trainingState,
    setBattleStatus,
    setCardRows: setCards,
    setMinimapSnapshot,
    setTrainingState
  } = useBattleUiSync({
    runtimeRef,
    intervalMs: 120,
    enabled: open && runtimeVersion > 0
  });

  const {
    armyTemplates,
    armyTemplatesLoading,
    armyTemplatesError,
    reloadArmyTemplates,
    deleteTemplate: deleteArmyTemplate
  } = useArmyTemplates({ open });

  const handleOpenTemplateEditor = useCallback((template = null) => {
    setTemplateEditorState({ open: true, template: template || null });
  }, []);

  const handleCloseTemplateEditor = useCallback(() => {
    setTemplateEditorState({ open: false, template: null });
  }, []);

  const handleTemplateEditorSaved = useCallback(() => {
    reloadArmyTemplates().catch((loadError) => {
      setDeployNotice(`部队模板刷新失败: ${loadError?.message || '请重试'}`);
    });
  }, [reloadArmyTemplates, setDeployNotice]);

  const handleDeleteArmyTemplate = useCallback(async (template) => {
    const templateId = String(template?.templateId || '').trim();
    if (!templateId) return;
    const templateName = String(template?.name || '未命名模板').trim() || '未命名模板';
    if (typeof window !== 'undefined' && !window.confirm(`确认删除部队模板「${templateName}」？`)) return;
    try {
      await deleteArmyTemplate(templateId);
      setDeployNotice(`已删除部队模板「${templateName}」`);
    } catch (deleteError) {
      setDeployNotice(`删除部队模板失败: ${deleteError?.message || '请重试'}`);
    }
  }, [deleteArmyTemplate, setDeployNotice]);

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

  useEffect(() => {
    if (!isTrainingMode || !renderReady) return;
    pipelineRef.current?.threePipeline?.setGridVisible?.(trainingPresentationSettings.showGrid);
  }, [isTrainingMode, pipelineRef, renderReady, trainingPresentationSettings.showGrid]);

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
    skillConfirmState,
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
    isTrainingMode,
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
    setSpacingPickOpen,
    setSpacingPopupPos,
    setResultState,
    setDeployDraggingGroup,
    setDeployInfoState,
    setDeployActionAnchorMode,
    setDeployNotice,
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
        .slice(0, 9);
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

  useEffect(() => {
    if (!open || runtimeVersion <= 0) {
      setDeployFormationLibrary({});
      return;
    }
    const runtime = runtimeRef.current;
    const deployGroups = runtime?.getDeployGroups?.();
    const allGroups = [
      ...(Array.isArray(deployGroups?.attacker) ? deployGroups.attacker : []),
      ...(Array.isArray(deployGroups?.defender) ? deployGroups.defender : [])
    ];
    const nextLibrary = allGroups.reduce((library, group) => {
      const groupId = String(group?.id || '').trim();
      const formations = (Array.isArray(group?.templateFormations) ? group.templateFormations : [])
        .filter((formation) => formation && formation.legal !== false && Array.isArray(formation.placements) && formation.placements.length > 0)
        .slice(0, 9);
      if (!groupId || formations.length <= 0) return library;
      library[groupId] = {
        formations,
        activeFormationId: String(group?.activeFormationId || group?.formationRect?.formationId || formations[0]?.formationId || formations[0]?.id || '').trim()
      };
      return library;
    }, {});
    setDeployFormationLibrary(nextLibrary);
  }, [open, runtimeRef, runtimeVersion]);

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
    const runtimePhase = runtime?.getPhase?.();
    const canChangeFormation = runtimePhase === 'deploy' || runtimePhase === 'battle';
    if (!runtime || !canChangeFormation || !safeGroupId) return false;
    const library = deployFormationLibrary[safeGroupId];
    const runtimeFormations = runtime.getDeployGroupFormations?.(safeGroupId) || [];
    const formations = runtimeFormations.length > 0
      ? runtimeFormations
      : (Array.isArray(library?.formations) ? library.formations : []);
    if (formations.length <= 0) {
      setDeployNotice('该部队没有可切换的模板阵型');
      return false;
    }
    const group = runtime.getFormationGroupById?.(safeGroupId)
      || runtime.getSquadById?.(safeGroupId)
      || runtime.getDeployGroupById(safeGroupId);
    const activeFormationId = String(
      group?.activeFormationId
      || group?.formationRect?.formationId
      || library?.activeFormationId
      || formations[0]?.formationId
      || ''
    ).trim();
    setDeployFormationLibrary((prev) => ({
      ...prev,
      [safeGroupId]: {
        ...(prev[safeGroupId] || {}),
        formations,
        activeFormationId
      }
    }));
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
    if (phase !== 'deploy' && phase !== 'battle') return;
    const targetGroupId = deployDraggingGroupId || selectedSquadId;
    if (!targetGroupId) return;
    openFormationWheelForGroup(targetGroupId);
  }, [deployDraggingGroupId, openFormationWheelForGroup, phase, selectedSquadId]);

  const handleCloseFormationWheel = useCallback(() => {
    setFormationWheelState((prev) => ({ ...prev, open: false }));
  }, []);

  const handlePickDeployFormation = useCallback((formation, targetGroupIdOverride = '') => {
    const runtime = runtimeRef.current;
    const groupId = String(targetGroupIdOverride || formationWheelState.groupId || deployDraggingGroupId || selectedSquadId || '').trim();
    const runtimePhase = runtime?.getPhase?.();
    const canChangeFormation = runtimePhase === 'deploy' || runtimePhase === 'battle';
    if (!runtime || !canChangeFormation || !groupId || !formation) return;
    const group = runtime.getFormationGroupById?.(groupId)
      || runtime.getSquadById?.(groupId)
      || runtime.getDeployGroupById(groupId);
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
    if (runtimePhase === 'deploy') runtime.setSelectedDeployGroup(groupId);
    else runtime.setSelectedBattleSquad?.(groupId);
    runtime.setFocusSquad(groupId);
    setSelectedSquadId(groupId);
    setFormationWheelState((prev) => ({ ...prev, open: false }));

    if (runtimePhase === 'deploy' && group.placed !== false && !runtime.canDeployGroupFitAt(groupId, group, groupTeam)) {
      runtime.setDeployGroupPlaced(groupTeam, groupId, false);
      setDeployDraggingGroup({ groupId, team: groupTeam });
      setDeployActionAnchorMode('');
      setDeployNotice('新阵型放不下当前位置，已回到鼠标吸附状态；右键可取消放置');
    } else if (result.reforming) {
      setDeployNotice(`开始换阵：${formation?.name || '未命名阵型'}（约 ${Math.ceil(result.reformDurationSec || 0)} 秒）`);
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

  const handleReorderDeployFormations = useCallback((groupId = '', formations = []) => {
    const runtime = runtimeRef.current;
    const safeGroupId = String(groupId || '').trim();
    if (!runtime || runtime.getPhase?.() !== 'deploy' || !safeGroupId) return;
    const orderedIds = (Array.isArray(formations) ? formations : [])
      .map((formation) => String(formation?.formationId || formation?.id || '').trim())
      .filter(Boolean);
    const result = runtime.reorderDeployGroupFormations?.(safeGroupId, orderedIds, 'any');
    if (result?.ok === false) {
      setDeployNotice(result.reason || '阵型快捷键调整失败');
      return;
    }
    const nextFormations = Array.isArray(result?.formations) ? result.formations : formations;
    setDeployFormationLibrary((prev) => {
      const source = prev[safeGroupId];
      if (!source) return prev;
      return {
        ...prev,
        [safeGroupId]: { ...source, formations: nextFormations.slice(0, 9) }
      };
    });
    setCards(runtime.getCardRows?.() || []);
  }, [runtimeRef, setCards, setDeployNotice]);

  const handleFormationHotkey = useCallback((slotIndex = 0) => {
    if (phase !== 'deploy' && phase !== 'battle') return;
    const runtime = runtimeRef.current;
    const groupId = String(
      deployDraggingGroupId
      || selectedSquadId
      || runtime?.getDeployGroups?.()?.selectedId
      || ''
    ).trim();
    if (!groupId) return;
    const runtimeFormations = runtime?.getDeployGroupFormations?.(groupId, 'any') || [];
    const formations = runtimeFormations.length > 0
      ? runtimeFormations
      : (deployFormationLibrary[groupId]?.formations || []);
    const formation = formations[Math.max(0, Math.min(8, Math.floor(Number(slotIndex) || 0)))];
    if (!formation) return;
    handlePickDeployFormation(formation, groupId);
  }, [deployDraggingGroupId, deployFormationLibrary, handlePickDeployFormation, phase, runtimeRef, selectedSquadId]);

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

        if (rotateDirection !== 0) {
          camera.worldYawDeg += rotateDirection * rotateSpeed * dt;
        }

        const clampedCenter = clampCameraCenterToField(nextCenterX, nextCenterY);
        camera.centerX = clampedCenter.x;
        camera.centerY = clampedCenter.y;
        hasActiveCameraMotion = (
          moveLen > 1e-4
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
    isPathPointBlocked
  } = useBattleSceneSelection({
    runtimeRef,
    cameraRef,
    cameraViewRectRef,
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
    setSpacingPickOpen,
    setSpacingPopupPos,
    setDeployDraggingGroup,
    setDeployActionAnchorMode,
    setSelectedPaletteItemId,
    setQuickDeployOpen,
    setQuickDeployApplying,
    setQuickDeployError,
    setDeployNotice,
    setMinimapSnapshot
  });

  const setClockPaused = useCallback((nextPaused) => {
    setPaused(!!nextPaused);
    setLoopPaused(!!nextPaused);
  }, [setLoopPaused, setPaused]);

  const {
    syncBattleCards,
    selectBattleSquad,
    followBattleSquad,
    closeSkillConfirm,
    closeSkillPick,
    commitPathPlanning,
    closeSpacingPick,
    executeBattleAction,
    handleCycleSpeedMode,
    handleBattleActionClick,
    handleSkillPick,
    handleFinishPathPlanning,
    handlePickFormationSpacing
  } = useBattleActions({
    runtimeRef,
    cameraRef,
    glCanvasRef,
    worldToDomRef,
    isTrainingMode,
    selectedSquadId,
    paused,
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
    setSpacingPickOpen,
    setSpacingPopupPos,
    setSkillPopupPos,
    setSkillPopupSquadId
  });

  const {
    handleRecallDeployDraggingGroup,
    handleOpenTemplateFillPreview,
    handleOpenTemplateFillEditor,
    handleCloseTemplateFillPreview,
    handleConfirmTemplateFillPreview,
    handleChangeTemplateFillTotal,
    handleChangeTemplateFillTeam,
    handleChangeTemplateFillControlMode,
    handleChangeTemplateFillName
  } = useBattleDeployEditor({
    runtimeRef,
    pointerWorldRef,
    isTrainingMode,
    templateFillPreview,
    setDeployNotice,
    setSelectedSquadId,
    setDeployDraggingGroup,
    setDeployActionAnchorMode,
    setCards,
    setMinimapSnapshot,
    setTemplateFillPreview,
    onDeployGroupFormationsChange: handleDeployGroupFormationsChange
  });

  const modalInteractionLocked = templateEditorState.open || templateFillPreview.open;

  const {
    onDoubleClick: handleSceneDoubleClick,
    onMouseDown: handleSceneMouseDown,
    onMouseMove: handlePointerMove,
    onMouseLeave: handleSceneMouseLeave,
    onWheel: handleSceneWheel,
    onContextMenu: handleSceneContextMenu,
    onMinimapClick: handleMinimapClick
  } = useBattleSceneInputController({
    open,
    interactionLocked: modalInteractionLocked,
    glCanvasRef,
    runtimeRef,
    cameraRef,
    pipelineRef,
    worldToScreenRef,
    pointerWorldRef,
    panDragRef,
    deployYawDragRef,
    deployRectDragRef,
    deployDirectionArcDragRef,
    spacePressedRef,
    selectedSquadId,
    paused,
    battleUiMode,
    skillConfirmState,
    aimState,
    deployDraggingGroupId,
    deployDraggingTeam,
    selectedPaletteItemId,
    isTrainingMode,
    isPathPointBlocked,
    syncBattleCards,
    selectBattleSquad,
    followBattleSquad,
    closeSkillConfirm,
    closeSkillPick,
    closeSpacingPick,
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
    CAMERA_DISTANCE_CLOSE_MIN,
    CAMERA_DISTANCE_MIN,
    CAMERA_DISTANCE_MAX,
    TRAINING_OVERVIEW_DISTANCE_EXTRA,
    TRAINING_OVERVIEW_DISTANCE_MAX,
    TRAINING_OVERVIEW_VIEW_PADDING,
    DEPLOY_ROTATE_SENSITIVITY,
    DEPLOY_ROTATE_CLICK_THRESHOLD,
    DEPLOY_WHEEL_ROTATE_STEP_DEG,
    DEPLOY_PITCH_DEG,
    BATTLE_UI_MODE_NONE,
    BATTLE_UI_MODE_PATH,
    BATTLE_UI_MODE_SPACING_PICK,
    BATTLE_UI_MODE_SKILL_PICK,
    BATTLE_UI_MODE_SKILL_CONFIRM,
    skillRangeByClass,
    skillAoeRadiusByClass
  });

  const {
    syncDeployUiFromRuntime,
    handleDeployMove,
    handleDeployDelete,
    handleDeployPlacementAction,
    handleDeployControlModeToggle,
    handleDeployReorder,
    handleConfirmDeployDelete
  } = useBattleDeployGroupActions({
    runtimeRef,
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
    onDeployGroupRemoved: handleDeployGroupRemoved
  });

  const syncTrainingUi = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setBattleStatus(runtime.getBattleStatus());
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setTrainingState(runtime.getTrainingState?.() || null);
  }, [runtimeRef, setBattleStatus, setCards, setMinimapSnapshot, setTrainingState]);

  const handleTrainingBattleControlModeToggle = useCallback((squadId, nextMode) => {
    const runtime = runtimeRef.current;
    if (!isTrainingMode || !runtime || phase !== 'battle') return;
    const result = runtime.setTrainingBattleSquadControlMode?.(squadId, nextMode);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '切换控制权失败');
      return;
    }

    if (result.controlMode === 'USER') {
      selectBattleSquad(result.squadId, true);
    } else {
      runtime.setSelectedBattleSquad(result.squadId);
      runtime.setFocusSquad(result.squadId);
      setSelectedSquadId(result.squadId);
      setWorldActionsVisibleForSquadId('');
      setPendingPathPoints([]);
      setPlanningHoverPoint(null);
      setSkillConfirmState(null);
      setSkillPopupSquadId('');
      setSpacingPickOpen(false);
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      if (
        battleUiMode === BATTLE_UI_MODE_PATH
        || battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM
        || battleUiMode === BATTLE_UI_MODE_SPACING_PICK
      ) {
        setClockPaused(false);
      }
    }

    setDeployNotice(result.controlMode === 'AI' ? '已切换为 AI 接管' : '已切换为用户操作');
    syncTrainingUi();
  }, [
    battleUiMode,
    isTrainingMode,
    phase,
    runtimeRef,
    selectBattleSquad,
    setBattleUiMode,
    setClockPaused,
    setDeployNotice,
    setSpacingPickOpen,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setSelectedSquadId,
    setSkillConfirmState,
    setSkillPopupSquadId,
    setWorldActionsVisibleForSquadId,
    syncTrainingUi
  ]);

  const closeTrainingSkillTree = useCallback(() => {
    setSkillTreeModal((prev) => ({ ...prev, open: false }));
  }, []);

  const handleOpenTrainingSkillTree = useCallback((groupId, slotIndex = 0, treeCategory = '') => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const safeGroupId = String(groupId || '');
    const safeIndex = clamp(Math.floor(Number(slotIndex) || 0), 0, 2);
    if (
      skillTreeModal.open
      && skillTreeModal.groupId === safeGroupId
      && skillTreeModal.slotIndex === safeIndex
    ) {
      closeTrainingSkillTree();
      return;
    }
    const source = phase === 'battle'
      ? runtime.getSquadById?.(safeGroupId)
      : runtime.getDeployGroupById?.(safeGroupId, 'any');
    if (!source) return;
    const slot = normalizeSkillSlots(source.skillSlots)[safeIndex];
    const category = String(treeCategory || slot?.treeCategory || '').trim();
    setSkillTreeModal({
      open: true,
      groupId: safeGroupId,
      slotIndex: safeIndex,
      treeCategory: category,
      progress: category ? runtime.getTrainingSkillTreeProgress?.(safeGroupId, category) || { unlocked: [] } : { unlocked: [] }
    });
  }, [closeTrainingSkillTree, phase, runtimeRef, skillTreeModal.groupId, skillTreeModal.open, skillTreeModal.slotIndex]);

  const handleTrainingTreeCategoryChange = useCallback((nextCategory = '') => {
    const runtime = runtimeRef.current;
    if (!runtime || phase !== 'deploy' || !skillTreeModal.groupId) return;
    const group = runtime.getDeployGroupById(skillTreeModal.groupId, 'any');
    if (!group) return;
    const tree = getSkillTreeById(nextCategory);
    const slots = normalizeSkillSlots(group.skillSlots);
    slots[skillTreeModal.slotIndex] = {
      ...slots[skillTreeModal.slotIndex],
      treeCategory: tree?.id || '',
      skillId: getSkillTreeFirstActiveSkill(tree?.id)?.id || '',
      cooldownRemain: 0
    };
    const result = runtime.setDeployGroupSkillSlots(group.id, slots, 'any');
    if (!result?.ok) {
      setDeployNotice(result?.reason || '技能树绑定失败');
      return;
    }
    setSkillTreeModal((prev) => ({
      ...prev,
      treeCategory: tree?.id || '',
      progress: tree?.id ? runtime.getTrainingSkillTreeProgress?.(group.id, tree.id) || { unlocked: [] } : { unlocked: [] }
    }));
    syncTrainingUi();
  }, [phase, runtimeRef, setDeployNotice, skillTreeModal.groupId, skillTreeModal.slotIndex, syncTrainingUi]);

  const handleTrainingTreeSkillClick = useCallback((skill, meta = {}) => {
    const runtime = runtimeRef.current;
    if (!runtime || !skill || !skillTreeModal.groupId) return;
    if (skill.kind === 'passive') {
      setDeployNotice('被动节点会自动生效，不能放入技能栏');
      return;
    }
    if (phase === 'deploy') {
      if (!meta.lit) {
        setDeployNotice('准备阶段仅保留起始技能，训练中使用技能点点亮后才能装备');
        return;
      }
      const group = runtime.getDeployGroupById(skillTreeModal.groupId, 'any');
      if (!group) return;
      const slots = normalizeSkillSlots(group.skillSlots);
      const current = slots[skillTreeModal.slotIndex] || {};
      slots[skillTreeModal.slotIndex] = {
        ...current,
        treeCategory: skillTreeModal.treeCategory || meta.treeCategory || current.treeCategory,
        skillId: skill.id,
        cooldownRemain: 0
      };
      const result = runtime.setDeployGroupSkillSlots(group.id, slots, 'any');
      if (!result?.ok) {
        setDeployNotice(result?.reason || '技能配置失败');
        return;
      }
      setDeployNotice(`已将 ${skill.name} 装备到槽位 ${skillTreeModal.slotIndex + 1}`);
      setSkillTreeModal((prev) => ({ ...prev, treeCategory: slots[skillTreeModal.slotIndex].treeCategory }));
      syncTrainingUi();
      return;
    }
    if (phase !== 'battle') return;
    const category = skillTreeModal.treeCategory || meta.treeCategory;
    const result = meta.lit
      ? runtime.equipTrainingSkill?.(skillTreeModal.groupId, skillTreeModal.slotIndex, skill.id)
      : runtime.unlockTrainingSkill?.(skillTreeModal.groupId, category, skill.id);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '技能操作失败');
      return;
    }
    const progress = runtime.getTrainingSkillTreeProgress?.(skillTreeModal.groupId, category) || { unlocked: [] };
    setSkillTreeModal((prev) => ({ ...prev, progress }));
    setDeployNotice(meta.lit
      ? `已将 ${skill.name} 替换到槽位 ${skillTreeModal.slotIndex + 1}`
      : `已点亮 ${skill.name}，再次点击该技能即可替换到槽位`);
    syncTrainingUi();
  }, [phase, runtimeRef, setDeployNotice, skillTreeModal.groupId, skillTreeModal.slotIndex, skillTreeModal.treeCategory, syncTrainingUi]);

  const handleTrainingTreeSkillUpgrade = useCallback((skill, meta = {}) => {
    const runtime = runtimeRef.current;
    if (!runtime || !skill || !skillTreeModal.groupId || phase !== 'battle') return;
    const category = skillTreeModal.treeCategory || meta.treeCategory;
    const result = runtime.upgradeTrainingSkill?.(skillTreeModal.groupId, category, skill.id);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '技能升级失败');
      return;
    }
    const progress = runtime.getTrainingSkillTreeProgress?.(skillTreeModal.groupId, category) || { unlocked: [], levels: {} };
    setSkillTreeModal((prev) => ({ ...prev, progress }));
    setDeployNotice(`${skill.name} 已升级至 Lv${result.level}`);
    syncTrainingUi();
  }, [phase, runtimeRef, setDeployNotice, skillTreeModal.groupId, skillTreeModal.treeCategory, syncTrainingUi]);

  const handleTrainingTreeAdjustSkillPoints = useCallback((delta) => {
    const runtime = runtimeRef.current;
    if (!runtime || !skillTreeModal.groupId) return;
    const result = runtime.adjustTrainingSquadSkillPoints?.(skillTreeModal.groupId, delta);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '技能点调整失败');
      return;
    }
    const category = skillTreeModal.treeCategory;
    const progress = category
      ? runtime.getTrainingSkillTreeProgress?.(skillTreeModal.groupId, category) || { unlocked: [], levels: {} }
      : { unlocked: [], levels: {}, points: result.pointState?.points || 0 };
    setSkillTreeModal((prev) => ({ ...prev, progress }));
    syncTrainingUi();
  }, [runtimeRef, setDeployNotice, skillTreeModal.groupId, skillTreeModal.treeCategory, syncTrainingUi]);

  const handleTrainingTreeUnbind = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || phase !== 'deploy' || !skillTreeModal.groupId) return;
    const group = runtime.getDeployGroupById(skillTreeModal.groupId, 'any');
    if (!group) return;
    const slots = normalizeSkillSlots(group.skillSlots);
    slots[skillTreeModal.slotIndex] = {
      ...slots[skillTreeModal.slotIndex],
      treeCategory: '',
      skillId: '',
      cooldownRemain: 0
    };
    const result = runtime.setDeployGroupSkillSlots(group.id, slots, 'any');
    if (!result?.ok) {
      setDeployNotice(result?.reason || '解除绑定失败');
      return;
    }
    closeTrainingSkillTree();
    setDeployNotice(`已清空槽位 ${skillTreeModal.slotIndex + 1}`);
    syncTrainingUi();
  }, [closeTrainingSkillTree, phase, runtimeRef, setDeployNotice, skillTreeModal.groupId, skillTreeModal.slotIndex, syncTrainingUi]);

  const handleCastTrainingSkillSlot = useCallback((groupId, slotIndex = 0) => {
    const runtime = runtimeRef.current;
    if (!runtime || phase !== 'battle') return;
    const skill = runtime.getSkillMetaForSquad?.(groupId)?.skills?.[slotIndex];
    if (!skill || !skill.available) {
      setDeployNotice(skill ? '技能冷却中或当前兵种不可施放' : '技能槽为空');
      return;
    }
    handleSkillPick(skill, { squadId: groupId });
    syncTrainingUi();
  }, [handleSkillPick, phase, runtimeRef, setDeployNotice, syncTrainingUi]);

  const handleTrainingSkillHotkey = useCallback((slotIndex = 0) => {
    if (!isTrainingMode || phase !== 'battle' || !selectedSquadId) return;
    handleCastTrainingSkillSlot(selectedSquadId, slotIndex);
  }, [handleCastTrainingSkillSlot, isTrainingMode, phase, selectedSquadId]);

  const handleTrainingPointIntervalChange = useCallback((intervalSec) => {
    const result = runtimeRef.current?.setTrainingSkillPointInterval?.(intervalSec);
    if (!result?.ok) {
      if (result?.reason) setDeployNotice(result.reason);
      return;
    }
    setTrainingState(result.state);
  }, [runtimeRef, setDeployNotice, setTrainingState]);

  const handleTrainingAutoSkillPointGainChange = useCallback((enabled) => {
    const result = runtimeRef.current?.setTrainingAutoSkillPointGainEnabled?.(enabled);
    if (!result?.ok) {
      if (result?.reason) setDeployNotice(result.reason);
      return;
    }
    setTrainingState(result.state);
  }, [runtimeRef, setDeployNotice, setTrainingState]);

  const handleApplyTrainingPresentationSettings = useCallback((nextSettings = {}) => {
    const fontSize = TRAINING_FONT_SCALE_BY_SIZE[nextSettings.fontSize]
      ? nextSettings.fontSize
      : 'medium';
    setTrainingPresentationSettings({
      fontSize,
      showGrid: nextSettings.showGrid !== false
    });
  }, []);

  const handleResetTraining = useCallback(() => {
    const result = resetTraining();
    if (!result?.ok) {
      setDeployNotice(result?.reason || '训练重置失败');
      return;
    }
    setTrainingSettingsOpen(false);
    closeTrainingSkillTree();
    setResultState(createDefaultResultState());
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    runtimeRef.current?.clearSelection?.();
    setSelectedSquadId('');
    const resetNotice = '已重置到开始训练前的部署状态';
    setDeployNotice(resetNotice);
    if (resetDeployNoticeTimeoutRef.current) {
      window.clearTimeout(resetDeployNoticeTimeoutRef.current);
    }
    resetDeployNoticeTimeoutRef.current = window.setTimeout(() => {
      setDeployNotice((current) => (current === resetNotice ? '' : current));
      resetDeployNoticeTimeoutRef.current = null;
    }, 2800);
    syncTrainingUi();
  }, [closeTrainingSkillTree, resetTraining, runtimeRef, setBattleUiMode, setDeployNotice, setResultState, setSelectedSquadId, syncTrainingUi]);

  const handleTrainingExitRequest = useCallback(() => {
    if (isTrainingMode && trainingSessionActive) {
      handleResetTraining();
      return;
    }
    closeModal();
  }, [closeModal, handleResetTraining, isTrainingMode, trainingSessionActive]);

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
    handleOpenTemplateFillEditor(groupId, event);
  }, [closeDeployInfoPanel, handleOpenTemplateFillEditor]);

  const handleDeployDeleteWithInfoClose = useCallback((groupId, event) => {
    closeDeployInfoPanel();
    if (isTrainingMode) {
      handleDeployPlacementAction(groupId, event);
      return;
    }
    handleDeployDelete(groupId, event);
  }, [closeDeployInfoPanel, handleDeployDelete, handleDeployPlacementAction, isTrainingMode]);

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
    setConfirmDeleteGroupId,
    setSelectedPaletteItemId,
    setDeployNotice
  });

  const { handleEscape } = useBattleEscapeHandler({
    confirmDeleteGroupId,
    deployInfoOpen: deployInfoState.open,
    quickDeployOpen,
    templateFillPreviewOpen: templateFillPreview.open,
    deployDraggingGroupId,
    deployDraggingTeam,
    deployRectDragRef,
    deployDirectionArcDragRef,
    battleUiMode,
    worldActionsVisibleForSquadId,
    aimStateActive: aimState.active,
    setConfirmDeleteGroupId,
    setDeployInfoState,
    handleCloseQuickDeploy,
    handleCloseTemplateFillPreview,
    setDeployDraggingGroup,
    setDeployNotice,
    onRecallDeployDraggingGroup: handleRecallDeployDraggingGroup,
    closeSkillConfirm,
    commitPathPlanning,
    setBattleUiMode,
    setSkillPopupSquadId,
    setSpacingPickOpen,
    setClockPaused,
    setWorldActionsVisibleForSquadId,
    setAimState,
    closeModal: handleTrainingExitRequest
  });

  const handleSceneEscape = useCallback(() => {
    if (modalInteractionLocked) return;
    if (trainingSettingsOpen) {
      setTrainingSettingsOpen(false);
      return;
    }
    if (skillTreeModal.open) {
      closeTrainingSkillTree();
      return;
    }
    if (formationWheelState.open) {
      handleCloseFormationWheel();
      return;
    }
    handleEscape();
  }, [closeTrainingSkillTree, formationWheelState.open, handleCloseFormationWheel, handleEscape, modalInteractionLocked, skillTreeModal.open, trainingSettingsOpen]);

  useBattleSceneGlobalInput({
    open,
    interactionLocked: modalInteractionLocked,
    runtimeRef,
    spacePressedRef,
    spacingPickOpen,
    isSkillPickMode: battleUiMode === BATTLE_UI_MODE_SKILL_PICK,
    onEscape: handleSceneEscape,
    onTogglePause: handleTogglePause,
    onTogglePitch: handleTogglePitch,
    onMapKeyCommand: handleMapKeyCommand,
    onFormationKey: isTrainingMode ? undefined : handleFormationKey,
    onFormationHotkey: isTrainingMode ? handleFormationHotkey : undefined,
    onSkillHotkey: handleTrainingSkillHotkey,
    onCloseSpacingPick: closeSpacingPick,
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
    selectedDeployFormation,
    selectedDeployFormationLines,
    worldActionGroupId,
    worldActionPos,
    selectedBattleActionSquad,
    pathPlanningTailDom,
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
    deployDraggingGroupId,
    worldToDomRef,
    deployActionAnchorMode,
    worldActionsVisibleForSquadId,
    pendingPathPoints,
    quickDeployRandomForm,
    debugEnabled,
    showMidlineDebug,
    debugStats
  });

  const skillTreeModalGroup = useMemo(
    () => cards.find((row) => row.id === skillTreeModal.groupId) || null,
    [cards, skillTreeModal.groupId]
  );

  const selectedTrainingSkillTreeProgress = useMemo(() => {
    const runtime = runtimeRef.current;
    if (!isTrainingMode || !runtime || !selectedCardRow?.id) return {};
    const treeCategories = Array.from(new Set(
      normalizeSkillSlots(selectedCardRow.skillSlots)
        .map((slot) => String(slot?.treeCategory || '').trim())
        .filter(Boolean)
    ));
    return Object.fromEntries(treeCategories.map((treeCategory) => [
      treeCategory,
      runtime.getTrainingSkillTreeProgress?.(selectedCardRow.id, treeCategory) || { unlocked: [] }
    ]));
  }, [isTrainingMode, runtimeRef, selectedCardRow]);

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

  const clearDeleteConfirmation = useCallback(() => {
    setConfirmDeleteGroupId('');
  }, [setConfirmDeleteGroupId]);

  useEffect(() => {
    if (!confirmDeleteGroupId) return undefined;
    const dismissDeleteConfirmation = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('.pve2-card-confirm-overlay')) {
        return;
      }
      clearDeleteConfirmation();
    };
    document.addEventListener('pointerdown', dismissDeleteConfirmation, true);
    document.addEventListener('click', dismissDeleteConfirmation, true);
    return () => {
      document.removeEventListener('pointerdown', dismissDeleteConfirmation, true);
      document.removeEventListener('click', dismissDeleteConfirmation, true);
    };
  }, [clearDeleteConfirmation, confirmDeleteGroupId]);

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
    isTrainingMode ? `training-font-${trainingPresentationSettings.fontSize}` : '',
    deployPlacementLocked ? 'is-deploy-placement-lock' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      className={overlayClassName}
      style={isTrainingMode ? { '--pve2-training-ui-scale': trainingUiScale } : undefined}
    >
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
            onReset={handleResetTraining}
            onStart={handleStartBattle}
            canStart={runtimeRef.current?.canStartBattle?.()}
            debugEnabled={debugEnabled}
            onToggleDebug={() => setDebugEnabled((prev) => !prev)}
            onOpenSettings={() => setTrainingSettingsOpen(true)}
            isTrainingMode={isTrainingMode}
            trainingSessionActive={trainingSessionActive}
            pitchLabel={pitchLabel}
            startLabel={startLabel}
            speedModeLabel={speedModeLabel(selectedSpeedModeUi)}
            onCycleSpeedMode={!isTrainingMode && phase === 'battle' ? handleCycleSpeedMode : null}
            interactionLocked={deployPlacementLocked}
          />

          <div
            ref={sceneRef}
            className={`pve2-scene ${isPanning ? 'is-panning' : ''}`}
            onDoubleClick={handleSceneDoubleClick}
            onMouseDown={handleSceneMouseDown}
            onMouseMove={handlePointerMove}
            onMouseLeave={handleSceneMouseLeave}
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
              isTrainingMode={isTrainingMode}
            />

            {isTrainingMode ? (
              <TrainingFlagLabels
                squads={cards}
                phase={phase}
                runtimeRef={runtimeRef}
                worldToDomRef={worldToDomRef}
                cameraRef={cameraRef}
                onHoverSquad={(squadId) => {
                  const runtime = runtimeRef.current;
                  if (!runtime) return;
                  if (phase === 'deploy') runtime.setHoveredDeployGroup?.(squadId);
                  else runtime.setHoveredBattleSquad?.(squadId);
                }}
                onSelectSquad={(squadId) => handleCardSelect(squadId)}
              />
            ) : null}

            {!isTrainingMode && phase === 'deploy' && selectedDeployFormation && !deployPlacementLocked ? (
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
              onFollow={followBattleSquad}
              hoverSquadIdOnCard={hoverSquadIdOnCard}
              onCardHoverChange={setHoverSquadIdOnCard}
              onBattleAction={handleBattleActionClick}
              onDeployInfo={handleOpenDeployInfo}
              onDeployMove={handleDeployMoveWithInfoClose}
              onDeployEdit={handleDeployEditWithInfoClose}
              onDeployFormation={(groupId, event) => openFormationWheelForGroup(groupId, event)}
              onDeployDelete={handleDeployDeleteWithInfoClose}
              confirmDeleteGroupId={confirmDeleteGroupId}
              onConfirmDelete={handleConfirmDeployDeleteWithInfoClose}
              onCancelDelete={clearDeleteConfirmation}
              onControlModeToggle={handleDeployControlModeToggle}
              onBattleControlModeToggle={handleTrainingBattleControlModeToggle}
              onReorder={handleDeployReorder}
              onPlacementAction={handleDeployPlacementAction}
              onOpenSkillTree={handleOpenTrainingSkillTree}
              onCastSkillSlot={handleCastTrainingSkillSlot}
              onFormationSpacingPick={(squadId, spacing) => handlePickFormationSpacing(spacing, squadId)}
              onFormationPick={isTrainingMode ? (groupId, formation) => handlePickDeployFormation(formation, groupId) : undefined}
              onFormationReorder={isTrainingMode ? handleReorderDeployFormations : undefined}
              trainingSkillTreeOpen={skillTreeModal.open && skillTreeModal.groupId === selectedCardRow?.id}
              trainingSkillTreeSlotIndex={skillTreeModal.groupId === selectedCardRow?.id ? skillTreeModal.slotIndex : -1}
              trainingSkillTreeProgress={selectedTrainingSkillTreeProgress}
              armyTemplates={armyTemplates}
              armyTemplatesLoading={armyTemplatesLoading}
              armyTemplatesError={armyTemplatesError}
              onTemplateFill={handleOpenTemplateFillPreview}
              onTemplateCreate={isTrainingMode ? () => handleOpenTemplateEditor() : undefined}
              onTemplateEdit={isTrainingMode ? handleOpenTemplateEditor : undefined}
              onTemplateDelete={isTrainingMode ? handleDeleteArmyTemplate : undefined}
              isTrainingMode={isTrainingMode}
            />

            {templateEditorState.open ? (
              <ArmyPanel
                mode="templateEditor"
                templateToEdit={templateEditorState.template}
                onTemplateSaved={handleTemplateEditorSaved}
                onClose={handleCloseTemplateEditor}
              />
            ) : null}

            {phase === 'battle' && !isTrainingMode ? (
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
            ) : null}

            {phase === 'battle' ? (
              <BattleFormationSpacingFloat
                open={spacingPickOpen}
                popupPos={spacingPopupPos}
                value={selectedCardRow?.formationSpacing || 'standard'}
                onPickSpacing={handlePickFormationSpacing}
              />
            ) : null}

            {phase === 'battle' && !isTrainingMode ? (
              <BattleSkillPickFloat
                open={battleUiMode === BATTLE_UI_MODE_SKILL_PICK}
                popupPos={skillPopupPos}
                squadId={skillPopupTargetSquadId}
                skillPopupMeta={skillPopupMeta}
                onPickSkill={handleSkillPick}
              />
            ) : null}

            {phase === 'deploy' && !deployPlacementLocked ? (
              <BattleTemplateFillModal
                open={templateFillPreview.open}
                preview={templateFillPreview}
                isTrainingMode={isTrainingMode}
                trainingUiScale={trainingUiScale}
                onClose={handleCloseTemplateFillPreview}
                onChangeTotal={handleChangeTemplateFillTotal}
                onChangeTeam={handleChangeTemplateFillTeam}
                onChangeControlMode={handleChangeTemplateFillControlMode}
                onChangeName={handleChangeTemplateFillName}
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
              <div className="pve2-aim-tip">
                {skillConfirmState?.targetMode === 'direction'
                  ? '近战出击方向：移动鼠标旋转地面箭头，红环为可能命中目标，LMB 确认，RMB 取消'
                  : skillConfirmState?.targetMode === 'enemy'
                    ? '选择敌方部队：悬停目标后红环提示，LMB 确认，RMB 取消'
                    : skillConfirmState?.profile?.castStyle === 'melee'
                      ? '选择近战突击地点：圆形地点跟随鼠标，箭头表示突进方向，LMB 确认，RMB 取消'
                      : '选择远程打击区域：地面圆圈跟随鼠标，红环为可能命中目标，LMB 确认，RMB 取消'}
              </div>
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

            {phase === 'battle' && !isTrainingMode ? (
              <BattleActionButtons
                visible={!!worldActionsVisibleForSquadId}
                mode="world"
                isTrainingMode={isTrainingMode}
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

            {phase === 'deploy' && !isTrainingMode && worldActionPos?.visible && !deployPlacementLocked ? (
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
                  onFormation={isTrainingMode ? undefined : (event) => openFormationWheelForGroup(worldActionGroupId, event)}
                  onDelete={(event) => handleDeployDeleteWithInfoClose(worldActionGroupId, event)}
                  showDelete={!isTrainingMode}
                  deleteTitle={isTrainingMode
                    ? (selectedCardRow?.placed !== false ? '取消放置' : '删除训练部队')
                    : '删除'}
                  deleteAriaLabel={isTrainingMode
                    ? (selectedCardRow?.placed !== false ? '取消放置' : '删除训练部队')
                    : '删除'}
                />
              </div>
            ) : null}

            {(phase === 'deploy' || phase === 'battle') && !isTrainingMode ? (
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
                isTrainingMode={isTrainingMode}
                onClose={closeDeployInfoPanel}
              />
            ) : null}

            {deployNotice ? (
              <div className="pve2-deploy-notice" role="status" aria-live="polite">{deployNotice}</div>
            ) : null}

          </div>

          {isTrainingMode ? (
            <TrainingSkillTreeModal
              open={skillTreeModal.open && !!skillTreeModalGroup}
              group={skillTreeModalGroup}
              slotIndex={skillTreeModal.slotIndex}
              treeCategory={skillTreeModal.treeCategory}
              phase={phase}
              progress={skillTreeModal.progress}
              skillPoints={skillTreeModalGroup?.trainingSkillPoints || 0}
              onClose={closeTrainingSkillTree}
              onTreeChange={handleTrainingTreeCategoryChange}
              onSkillClick={handleTrainingTreeSkillClick}
              onSkillUpgrade={handleTrainingTreeSkillUpgrade}
              onAdjustPoints={handleTrainingTreeAdjustSkillPoints}
              onUnbind={handleTrainingTreeUnbind}
            />
          ) : null}

          {isTrainingMode ? (
            <TrainingSettingsModal
              open={trainingSettingsOpen}
              state={trainingState}
              settings={trainingPresentationSettings}
              onClose={() => setTrainingSettingsOpen(false)}
              onChangeAutoSkillPointGain={handleTrainingAutoSkillPointGainChange}
              onChangeInterval={handleTrainingPointIntervalChange}
              onApply={handleApplyTrainingPresentationSettings}
            />
          ) : null}

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
              <div className="pve2-result-body">
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
              </div>
              <div className="pve2-result-actions">
                <button type="button" className="btn btn-secondary" onClick={isTrainingMode ? handleResetTraining : closeModal}>{isTrainingMode ? '重置训练' : '返回围城'}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default BattleSceneContainer;
