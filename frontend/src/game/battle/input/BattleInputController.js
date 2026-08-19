import { normalizeDeg } from '../shared/angle';
import {
  isPointOnTrainingDirectionArc,
  resolveTrainingDirectionOffsetFromPoint
} from '../shared/trainingDirectionArc';
import {
  pickTrainingWorldFlagId,
  resolveTrainingDirectionArcAnchors,
  resolveTrainingWorldFlagHitRects
} from '../presentation/render/TrainingThreeRenderPipeline';
import {
  appendSkillPaintDabs,
  cloneSkillPaintArea,
  constrainSkillPaintPoint,
  finishSkillPaintArea,
  getSkillPaintRemainingRadius
} from '../shared/skillPaintArea';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PAN_DRAG_THRESHOLD_PX = 4;
const TEAM_ANY = 'any';
const CAMERA_VERTICAL_FOV_DEG = 48;
const DEFAULT_TRAINING_CAMERA_ZOOM_STEP = 50;
const DEFAULT_TRAINING_PITCH_DISTANCE_MAX = 2000;
const DEFAULT_TRAINING_OVERVIEW_DISTANCE_EXTRA = 1200;
const DEFAULT_TRAINING_OVERVIEW_DISTANCE_MAX = 2560;
const DEFAULT_TRAINING_OVERVIEW_VIEW_PADDING = 1.08;
const TRAINING_DIRECTION_ARC_PRIORITY_HIT_OPTIONS = Object.freeze({
  minimumHitRadius: 3,
  maximumHitRadius: 8,
  extraPadding: 2
});
const INTERACTIVE_UI_SELECTOR = [
  '.pve2-world-actions',
  '.pve2-battle-actions',
  '.pve2-card-actions',
  '.pve2-card',
  '.pve2-training-card-controls',
  '.pve2-selected-squad-panel',
  '.pve2-training-squad-panel',
  '.pve2-training-squad-info-panel',
  '.pve2-training-squad-skills-panel',
  '.pve2-training-skill-slots',
  '.pve2-training-flag-label',
  '.pve2-formation-slots',
  '.pve2-template-strip',
  '.pve2-template-row-main',
  '.pve2-template-row-actions',
  '.army-template-editor-overlay',
  '.army-template-editor-modal',
  '.pve2-template-fill-backdrop',
  '.pve2-template-fill-panel',
  '.pve2-minimap-wrap',
  '.pve2-action-pad',
  '.pve2-skill-float',
  '.pve2-formation-spacing-float',
  '.pve2-path-confirm-btn',
  '.pve2-hud',
  '.pve2-quick-deploy-backdrop',
  '.pve2-quick-deploy-panel',
  '.pve2-deploy-info',
  '.pve2-formation-wheel',
  '.number-pad-dialog-overlay',
  '.number-pad-dialog'
].join(', ');

const isInteractiveUiTarget = (target) => (
  !!target
  && typeof target.closest === 'function'
  && !!target.closest(INTERACTIVE_UI_SELECTOR)
);

const resolveSkillTargetMode = (skillConfirmState = null) => (
  skillConfirmState?.targetMode
    || (skillConfirmState?.kind === 'cavalry' ? 'direction' : (
      skillConfirmState?.kind === 'archer' || skillConfirmState?.kind === 'artillery' ? 'ground' : 'self'
    ))
);

const resolveTrainingFlagIdFromTarget = (target) => {
  if (!target || typeof target.closest !== 'function') return '';
  const flagTarget = target.closest('[data-training-flag]');
  return String(
    flagTarget?.dataset?.trainingFlag
    || flagTarget?.getAttribute?.('data-training-flag')
    || ''
  ).trim();
};

const resolveTrainingWorldFlagIdAtScreen = (runtime, camera, canvas, px, py) => {
  if (!runtime || !camera || !canvas) return '';
  camera.buildMatrices?.(canvas.width, canvas.height);
  const anchors = resolveTrainingDirectionArcAnchors(runtime);
  if (anchors.length <= 0) return '';
  const rect = canvas.getBoundingClientRect?.();
  const hitRects = resolveTrainingWorldFlagHitRects({
    anchors,
    camera,
    viewportWidth: canvas.width,
    viewportHeight: canvas.height,
    viewportCssHeight: Math.max(1, Number(rect?.height) || canvas.height)
  });
  return pickTrainingWorldFlagId(hitRects, px, py);
};

export const resolveTrainingOverviewDistance = ({
  field = null,
  viewport = null,
  baseDistance = 980,
  extraDistance = DEFAULT_TRAINING_OVERVIEW_DISTANCE_EXTRA,
  maxDistance = DEFAULT_TRAINING_OVERVIEW_DISTANCE_MAX,
  padding = DEFAULT_TRAINING_OVERVIEW_VIEW_PADDING
} = {}) => {
  const base = Math.max(1, Number(baseDistance) || 980);
  const minimumOverview = base + Math.max(1, Number(extraDistance) || DEFAULT_TRAINING_OVERVIEW_DISTANCE_EXTRA);
  const cap = Math.max(minimumOverview, Number(maxDistance) || DEFAULT_TRAINING_OVERVIEW_DISTANCE_MAX);
  const fieldWidth = Math.max(0, Number(field?.width) || 0);
  const fieldHeight = Math.max(0, Number(field?.height) || 0);
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  if (fieldWidth <= 0 || fieldHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return cap;
  }

  const aspect = Math.max(0.1, viewportWidth / viewportHeight);
  const halfFovTangent = Math.tan((CAMERA_VERTICAL_FOV_DEG * Math.PI / 180) * 0.5);
  const widthDistance = (fieldWidth * 0.5) / (halfFovTangent * aspect);
  const heightDistance = (fieldHeight * 0.5) / halfFovTangent;
  const fitDistance = Math.ceil(Math.max(widthDistance, heightDistance) * Math.max(1, Number(padding) || 1));
  return Math.min(cap, Math.max(minimumOverview, fitDistance));
};

export const createBattleInputController = ({
  open = false,
  interactionLocked = false,
  canvasRef,
  runtimeRef,
  cameraControllerRef,
  pipelineRef,
  worldToScreenRef,
  pointerWorldRef,
  panDragRef,
  deployYawDragRef,
  deployRectDragRef,
  deployDirectionArcDragRef,
  skillPaintDragRef = { current: null },
  spacePressedRef,
  constants = {},
  getters = {},
  callbacks = {}
} = {}) => {
  const resolveEventCanvasPoint = (event) => {
    const canvas = canvasRef?.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect?.();
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY) || !rect.width || !rect.height) return null;
    return {
      canvas,
      px: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      py: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height
    };
  };

  const resolveEventWorldPoint = (event) => {
    const screenPoint = resolveEventCanvasPoint(event);
    if (!screenPoint) return null;
    const { canvas, px, py } = screenPoint;
    const camera = cameraControllerRef.current;
    camera?.buildMatrices?.(canvas.width, canvas.height);
    const world = camera.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    if (world?.valid === false) return null;
    pointerWorldRef.current = world;
    if (!Number.isFinite(Number(world?.x)) || !Number.isFinite(Number(world?.y))) return null;
    return world;
  };

  const resolveTrainingWorldFlagIdForEvent = (event, runtime = runtimeRef.current) => {
    if (!getters.isTrainingMode?.()) return '';
    const screenPoint = resolveEventCanvasPoint(event);
    if (!screenPoint) return '';
    const { canvas, px, py } = screenPoint;
    const threePipeline = pipelineRef?.current?.threePipeline;
    if (typeof threePipeline?.pickTrainingWorldFlagIdAtScreen === 'function') {
      return String(threePipeline.pickTrainingWorldFlagIdAtScreen(px, py) || '');
    }
    return resolveTrainingWorldFlagIdAtScreen(
      runtime,
      cameraControllerRef.current,
      canvas,
      px,
      py
    );
  };

  const isTrainingSkillPaintConfirm = (skillConfirmState = getters.getSkillConfirmState?.()) => (
    !!getters.isTrainingMode?.()
    && resolveSkillTargetMode(skillConfirmState) === 'ground'
    && !!skillConfirmState?.paintArea
  );

  const resolveSkillPaintOrigin = (skillConfirmState = null, squad = null) => ({
    x: Number(skillConfirmState?.center?.x) || Number(squad?.x) || 0,
    y: Number(skillConfirmState?.center?.y) || Number(squad?.y) || 0
  });

  const resolveSkillPaintCursorPoint = (world = null, skillConfirmState = null, squad = null) => {
    if (!world || !skillConfirmState) return null;
    const origin = resolveSkillPaintOrigin(skillConfirmState, squad);
    const maxRange = Math.max(8, Number(skillConfirmState?.maxRange) || 180);
    return constrainSkillPaintPoint(
      world,
      origin,
      maxRange,
      getSkillPaintRemainingRadius(skillConfirmState.paintArea)
    );
  };

  const restoreSkillPaintDrag = () => {
    const drag = skillPaintDragRef?.current;
    if (!drag) return false;
    skillPaintDragRef.current = null;
    callbacks.setSkillConfirmState?.((prev) => {
      if (!prev || prev.squadId !== drag.squadId) return prev;
      return {
        ...prev,
        hoverPoint: drag.initialHoverPoint ? { ...drag.initialHoverPoint } : null,
        paintArea: cloneSkillPaintArea(drag.initialPaintArea)
      };
    });
    return true;
  };

  const beginSkillPaintDrag = (event, skillConfirmState = null) => {
    if (!isTrainingSkillPaintConfirm(skillConfirmState)) return false;
    const runtime = runtimeRef.current;
    const squad = runtime?.getSquadById?.(skillConfirmState.squadId);
    if (!squad) return false;
    const world = resolveEventWorldPoint(event);
    if (!world) return false;
    const cursorPoint = resolveSkillPaintCursorPoint(world, skillConfirmState, squad);
    const initialPaintArea = cloneSkillPaintArea(skillConfirmState.paintArea);
    if (!cursorPoint || !initialPaintArea) return false;
    const activePaintArea = {
      ...cloneSkillPaintArea(initialPaintArea),
      isDragging: true
    };
    skillPaintDragRef.current = {
      squadId: skillConfirmState.squadId,
      initialHoverPoint: skillConfirmState.hoverPoint ? { ...skillConfirmState.hoverPoint } : null,
      initialPaintArea,
      paintArea: activePaintArea,
      startPoint: { ...cursorPoint },
      currentPoint: { ...cursorPoint },
      lastStampPoint: { ...cursorPoint }
    };
    callbacks.setSkillConfirmState?.((prev) => (prev && prev.squadId === skillConfirmState.squadId ? {
      ...prev,
      hoverPoint: { ...cursorPoint },
      paintArea: cloneSkillPaintArea(activePaintArea)
    } : prev));
    event.preventDefault();
    return true;
  };

  const updateSkillPaintDrag = (event) => {
    const drag = skillPaintDragRef?.current;
    if (!drag || (Number(event?.buttons) & 1) !== 1) return false;
    const runtime = runtimeRef.current;
    const skillConfirmState = getters.getSkillConfirmState?.();
    if (
      !runtime
      || runtime.getPhase?.() !== 'battle'
      || !isTrainingSkillPaintConfirm(skillConfirmState)
      || skillConfirmState.squadId !== drag.squadId
    ) {
      skillPaintDragRef.current = null;
      return false;
    }
    const squad = runtime.getSquadById?.(drag.squadId);
    const world = resolveEventWorldPoint(event);
    const cursorPoint = resolveSkillPaintCursorPoint(world, {
      ...skillConfirmState,
      paintArea: drag.paintArea
    }, squad);
    if (!cursorPoint) return true;
    const origin = resolveSkillPaintOrigin(skillConfirmState, squad);
    const brushed = appendSkillPaintDabs({
      paintArea: drag.paintArea,
      from: drag.lastStampPoint,
      to: cursorPoint,
      origin,
      maxRange: Math.max(8, Number(skillConfirmState?.maxRange) || 180)
    });
    drag.paintArea = {
      ...(brushed.paintArea || drag.paintArea),
      isDragging: true
    };
    drag.lastStampPoint = brushed.lastStampPoint || drag.lastStampPoint;
    drag.currentPoint = { ...cursorPoint };
    callbacks.setSkillConfirmState?.((prev) => (prev && prev.squadId === drag.squadId ? {
      ...prev,
      hoverPoint: { ...cursorPoint },
      paintArea: cloneSkillPaintArea(drag.paintArea)
    } : prev));
    return true;
  };

  const finishSkillPaintDrag = (event) => {
    const drag = skillPaintDragRef?.current;
    if (!drag) return null;
    const runtime = runtimeRef.current;
    const skillConfirmState = getters.getSkillConfirmState?.();
    if (!runtime || !isTrainingSkillPaintConfirm(skillConfirmState) || skillConfirmState.squadId !== drag.squadId) {
      skillPaintDragRef.current = null;
      return null;
    }
    const squad = runtime.getSquadById?.(drag.squadId);
    const world = resolveEventWorldPoint(event);
    const cursorPoint = resolveSkillPaintCursorPoint(world, {
      ...skillConfirmState,
      paintArea: drag.paintArea
    }, squad) || drag.currentPoint;
    const paintArea = finishSkillPaintArea({
      paintArea: drag.paintArea,
      point: cursorPoint,
      origin: resolveSkillPaintOrigin(skillConfirmState, squad),
      maxRange: Math.max(8, Number(skillConfirmState?.maxRange) || 180)
    });
    skillPaintDragRef.current = null;
    if (!paintArea || !cursorPoint) return null;
    const completedState = {
      ...skillConfirmState,
      hoverPoint: { ...cursorPoint },
      paintArea: {
        ...paintArea,
        isDragging: false
      }
    };
    callbacks.setSkillConfirmState?.(completedState);
    return completedState;
  };

  const beginPanDrag = (event, buttonMask = 1, primaryAction = '') => {
    if (interactionLocked) return;
    const canvas = canvasRef?.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const clientX = Number(event.clientX) || 0;
    const clientY = Number(event.clientY) || 0;
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const camera = cameraControllerRef.current;
    camera?.buildMatrices?.(canvas.width, canvas.height);
    const anchorWorld = camera?.screenToGround?.(px, py, { width: canvas.width, height: canvas.height });
    panDragRef.current = {
      anchorWorld: Number.isFinite(Number(anchorWorld?.x)) && Number.isFinite(Number(anchorWorld?.y)) && anchorWorld?.valid !== false
        ? { x: Number(anchorWorld.x), y: Number(anchorWorld.y) }
        : null,
      startClientX: clientX,
      startClientY: clientY,
      buttonMask,
      moved: false,
      primaryAction,
      primaryEvent: primaryAction ? {
        button: 0,
        clientX,
        clientY,
        shiftKey: !!event.shiftKey
      } : null,
      startDistance: Number(cameraControllerRef.current.distance) || constants.CAMERA_DISTANCE_MIN || 360,
      startPitch: Number(cameraControllerRef.current.currentPitch) || constants.DEPLOY_PITCH_DEG || 30
    };
    callbacks.setIsPanning?.(true);
    event.preventDefault();
  };

  const clearPanDrag = () => {
    panDragRef.current = null;
    callbacks.setIsPanning?.(false);
  };

  const clearDeployYawDrag = () => {
    deployYawDragRef.current = null;
  };

  const clearDeployRectDrag = () => {
    deployRectDragRef.current = null;
  };

  const setDirectionArcCursor = (cursor = '') => {
    const canvas = canvasRef?.current;
    if (canvas?.style) canvas.style.cursor = cursor;
  };

  const clearDeployDirectionArcDrag = () => {
    const directionDrag = deployDirectionArcDragRef.current;
    deployDirectionArcDragRef.current = null;
    if (directionDrag?.resumeClockOnRelease) callbacks.setClockPaused?.(false);
    setDirectionArcCursor('');
    runtimeRef.current?.setHoveredDeployDirectionArc?.('');
  };

  const resolveSelectedDirectionArcGroup = (world = null) => {
    const runtime = runtimeRef.current;
    const phase = runtime?.getPhase?.();
    const isDeploy = phase === 'deploy';
    const isBattle = phase === 'battle';
    if (
      !runtime
      || !world
      || world.valid === false
      || (!isDeploy && !isBattle)
      || (isDeploy && getters.getDeployDraggingGroupId?.())
      || (isBattle && getters.getBattleUiMode?.() && getters.getBattleUiMode?.() !== constants.BATTLE_UI_MODE_NONE)
    ) return null;
    const groupId = getters.getSelectedSquadId?.()
      || (isBattle ? runtime.selectedBattleSquadId : runtime.getDeployGroups?.()?.selectedId)
      || '';
    const group = groupId
      ? (isBattle ? runtime.getSquadById?.(groupId) : runtime.getDeployGroupById?.(groupId, TEAM_ANY))
      : null;
    if (!group || (isDeploy && group.placed === false)) return null;
    if (isBattle && runtime.canControlSquad?.(group) === false) return null;
    return isPointOnTrainingDirectionArc(
      world,
      group,
      group.team,
      TRAINING_DIRECTION_ARC_PRIORITY_HIT_OPTIONS
    ) ? group : null;
  };

  const resolveDirectionArcDragGroup = (directionDrag = null, runtime = runtimeRef.current) => {
    if (!directionDrag || !runtime || runtime.getPhase?.() !== directionDrag.phase) return null;
    return directionDrag.phase === 'battle'
      ? runtime.getSquadById?.(directionDrag.groupId)
      : runtime.getDeployGroupById?.(directionDrag.groupId, directionDrag.team);
  };

  const updateDirectionArcFromWorld = (directionDrag = null, world = null, runtime = runtimeRef.current) => {
    const group = resolveDirectionArcDragGroup(directionDrag, runtime);
    if (!group || !world) return false;
    const directionOffsetRad = resolveTrainingDirectionOffsetFromPoint(group, world, directionDrag.team);
    if (directionOffsetRad === null || typeof runtime?.setDeployGroupDirection !== 'function') return false;
    if (directionDrag.directionOffsetRad !== directionOffsetRad) {
      const result = runtime.setDeployGroupDirection(group.id, directionOffsetRad, directionDrag.team);
      if (result === false || result?.ok === false) return false;
      directionDrag.directionOffsetRad = directionOffsetRad;
    }
    runtime.setHoveredDeployDirectionArc?.(group.id);
    setDirectionArcCursor('grabbing');
    return true;
  };

  const beginDirectionArcDrag = (group = null, world = null, phase = '') => {
    const runtime = runtimeRef.current;
    if (!group?.id || !world || !runtime || (phase !== 'deploy' && phase !== 'battle')) return false;
    const directionDrag = {
      groupId: group.id,
      team: group.team === 'defender' ? 'defender' : 'attacker',
      phase,
      resumeClockOnRelease: phase === 'battle' && !getters.isClockPaused?.()
    };
    deployDirectionArcDragRef.current = directionDrag;
    if (!updateDirectionArcFromWorld(directionDrag, world, runtime)) {
      deployDirectionArcDragRef.current = null;
      return false;
    }
    if (phase === 'battle') callbacks.setClockPaused?.(true);
    return true;
  };

  const syncCardsAndMinimap = () => {
    const runtime = runtimeRef?.current;
    if (!runtime) return;
    callbacks.setCards?.(runtime.getCardRows?.() || []);
    callbacks.setMinimapSnapshot?.(runtime.getMinimapSnapshot?.() || null);
  };

  const handleMapCommand = (event) => {
    if (interactionLocked) return;
    if (event.button !== 0) return;
    const runtime = runtimeRef.current;
    const trainingFlagHitId = resolveTrainingWorldFlagIdForEvent(event, runtime);
    const world = resolveEventWorldPoint(event);
    if (!runtime || (!world && !trainingFlagHitId)) return;

    if (runtime.getPhase() !== 'deploy') return;
    const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
    const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
    if (deployDraggingGroupId) {
      if (!world) return;
      const usesHighlandDeployment = runtime.isTrainingMapHighlandSpawnEnabled?.() === true;
      const clickedSpawnRegionId = usesHighlandDeployment
        ? String(runtime.getTrainingMapSpawnMetadata?.(world, deployDraggingTeam)?.spawnRegionId || '')
        : '';
      if (usesHighlandDeployment && !clickedSpawnRegionId) {
        const recallResult = callbacks.recallDeployDraggingGroup?.(deployDraggingGroupId, deployDraggingTeam);
        if (recallResult?.ok === false) {
          callbacks.setDeployNotice?.(recallResult.reason || '取消放置失败');
        }
        return;
      }
      if (!runtime.canDeployGroupFitAt(deployDraggingGroupId, world, deployDraggingTeam)) {
        callbacks.setDeployNotice?.(usesHighlandDeployment
          ? '当前阵型无法完全放入己方高地，请调整位置或切换阵型'
          : (deployDraggingTeam === 'defender'
            ? '当前阵型超出右侧红色部署区，请调整位置或切换阵型'
            : '当前阵型超出左侧蓝色部署区，请调整位置或切换阵型'));
        return;
      }
      if (runtime.moveDeployGroup(deployDraggingGroupId, world, deployDraggingTeam) === false) {
        callbacks.setDeployNotice?.('当前位置不可部署，请选择己方高地内的空闲位置');
        return;
      }
      runtime.setDeployGroupPlaced(deployDraggingTeam, deployDraggingGroupId, true);
      runtime.setSelectedDeployGroup(deployDraggingGroupId);
      runtime.setFocusSquad(deployDraggingGroupId);
      callbacks.setSelectedSquadId?.(deployDraggingGroupId);
      callbacks.setDeployDraggingGroup?.({ groupId: '', team: 'attacker' });
      callbacks.setDeployActionAnchorMode?.('world');
      callbacks.setDeployNotice?.(`部队已放置，可继续编辑或${getters.isTrainingMode?.() ? '开始训练' : '开战'}`);
      syncCardsAndMinimap();
      return;
    }
    const selectedPaletteItemId = getters.getSelectedPaletteItemId?.() || '';
    if (getters.isTrainingMode?.() && selectedPaletteItemId) {
      if (!world) return;
      const placeResult = runtime.placeBuilding({
        itemId: selectedPaletteItemId,
        x: world.x,
        y: world.y,
        z: 0,
        rotation: 0
      });
      if (!placeResult?.ok) {
        callbacks.setDeployNotice?.(placeResult?.reason || '物品放置失败');
        return;
      }
      callbacks.setDeployNotice?.('物品已放置，可继续布置');
      callbacks.setMinimapSnapshot?.(runtime.getMinimapSnapshot?.() || null);
      return;
    }
    if (trainingFlagHitId) {
      const pickedFlagGroup = runtime.getDeployGroupById?.(trainingFlagHitId, 'any');
      if (pickedFlagGroup?.id && pickedFlagGroup.placed !== false) {
        runtime.setSelectedDeployGroup(pickedFlagGroup.id);
        runtime.setFocusSquad(pickedFlagGroup.id);
        callbacks.setSelectedSquadId?.(pickedFlagGroup.id);
        callbacks.setDeployActionAnchorMode?.('world');
        callbacks.setCards?.(runtime.getCardRows?.() || []);
        return;
      }
    }
    if (!world) return;
    const picked = runtime.pickDeployGroup(world, getters.isTrainingMode?.() ? 'any' : 'attacker');
    if (picked?.id) {
      runtime.setSelectedDeployGroup(picked.id);
      runtime.setFocusSquad(picked.id);
      callbacks.setSelectedSquadId?.(picked.id);
      callbacks.setDeployActionAnchorMode?.('world');
      callbacks.setCards?.(runtime.getCardRows?.() || []);
      return;
    }
    runtime.clearSelection?.();
    callbacks.setSelectedSquadId?.('');
    callbacks.setDeployActionAnchorMode?.('');
    callbacks.setCards?.(runtime.getCardRows?.() || []);
  };

  const handleBattlePrimaryAction = (event, skillConfirmOverride = null) => {
    if (interactionLocked) return;
    if (event.button !== 0) return;
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase?.() !== 'battle') return;
    const trainingFlagHitId = resolveTrainingWorldFlagIdForEvent(event, runtime);
    const world = resolveEventWorldPoint(event);
    if (!world && !trainingFlagHitId) return;
    const selected = runtime.getSquadById(getters.getSelectedSquadId?.());
    const battleUiMode = getters.getBattleUiMode?.();
    const skillConfirmState = skillConfirmOverride || getters.getSkillConfirmState?.();

    if (battleUiMode === constants.BATTLE_UI_MODE_SPACING_PICK) {
      callbacks.closeSpacingPick?.();
      return;
    }
    if (battleUiMode === constants.BATTLE_UI_MODE_SKILL_PICK) {
      callbacks.closeSkillPick?.();
    }

    if (battleUiMode === constants.BATTLE_UI_MODE_SKILL_CONFIRM) {
      if (!skillConfirmState || !selected || selected.id !== skillConfirmState.squadId) return;
      const centerX = Number(skillConfirmState?.center?.x) || Number(selected.x) || 0;
      const centerY = Number(skillConfirmState?.center?.y) || Number(selected.y) || 0;
      const targetMode = resolveSkillTargetMode(skillConfirmState);
      let targetSquadId = String(skillConfirmState.targetSquadId || '').trim();
      if (targetMode === 'enemy' && !targetSquadId) {
        const pickedEnemyId = trainingFlagHitId || (world && runtime.pickSquadAtPoint(world.x, world.y, {
          team: 'any',
          maxDist: Math.max(34, Number(selected.radius) || 34)
        }));
        const pickedEnemy = pickedEnemyId ? runtime.getSquadById(pickedEnemyId) : null;
        if (!pickedEnemy || pickedEnemy.team === selected.team) {
          callbacks.setDeployNotice?.('请点击敌方部队的核心标记');
          return;
        }
        targetSquadId = pickedEnemy.id;
      }
      const payload = {
        sourceCategory: skillConfirmState.sourceCategory,
        skillId: skillConfirmState.skillId,
        treeCategory: skillConfirmState.treeCategory,
        castProfile: skillConfirmState.profile,
        kind: skillConfirmState.kind,
        targetMode
      };
      if (targetMode === 'direction') {
        if (!world) return;
        const dirX = Number(skillConfirmState?.dir?.x) || 1;
        const dirY = Number(skillConfirmState?.dir?.y) || 0;
        const len = Math.max(0, Number(skillConfirmState?.len) || 0);
        payload.x = centerX + (dirX * len);
        payload.y = centerY + (dirY * len);
        payload.dirX = dirX;
        payload.dirY = dirY;
        payload.distance = len;
      } else if (targetMode === 'ground') {
        if (!world) return;
        const point = skillConfirmState.hoverPoint || { x: centerX, y: centerY };
        payload.x = Number(point.x) || centerX;
        payload.y = Number(point.y) || centerY;
        if (skillConfirmState.paintArea?.stamps?.length > 0) {
          payload.paintArea = cloneSkillPaintArea(skillConfirmState.paintArea);
        }
        if (skillConfirmState?.profile?.castStyle === 'melee') {
          payload.dirX = Number(skillConfirmState?.dir?.x) || 1;
          payload.dirY = Number(skillConfirmState?.dir?.y) || 0;
          payload.distance = Math.max(0, Number(skillConfirmState?.len) || 0);
        }
      } else if (targetMode === 'enemy') {
        payload.targetSquadId = targetSquadId;
        const target = runtime.getSquadById(targetSquadId);
        payload.x = Number(target?.x) || centerX;
        payload.y = Number(target?.y) || centerY;
      } else {
        payload.x = centerX;
        payload.y = centerY;
      }
      const result = Number.isFinite(Number(skillConfirmState.slotIndex))
        ? runtime.commandSkillSlot(selected.id, Number(skillConfirmState.slotIndex), payload)
        : runtime.commandSkill(selected.id, payload);
      if (!result?.ok) {
        callbacks.setDeployNotice?.(result?.reason || '技能施放失败');
        return;
      }
      callbacks.closeSkillConfirm?.(skillConfirmState.resumeOnConfirm !== false);
      callbacks.syncBattleCards?.();
      return;
    }

    if (battleUiMode === constants.BATTLE_UI_MODE_PATH) {
      if (!world) return;
      if (callbacks.isPathPointBlocked?.(world)) return;
      callbacks.setPendingPathPoints?.((prev) => [...prev, { x: world.x, y: world.y }]);
      return;
    }

    const pickedSquadId = trainingFlagHitId || (world && (
      getters.isTrainingMode?.()
        ? runtime.pickSquadAtAgentPoint?.(world.x, world.y, { team: 'any' })
        : runtime.pickSquadAtPoint(world.x, world.y, { team: 'any', maxDist: 34 })
    ));
    if (pickedSquadId) {
      callbacks.selectBattleSquad?.(pickedSquadId, true);
      return;
    }
    runtime.clearSelection?.();
    cameraControllerRef.current?.clearFollow?.();
    callbacks.setSelectedSquadId?.('');
    callbacks.setWorldActionsVisibleForSquadId?.('');
    callbacks.setPlanningHoverPoint?.(null);
    callbacks.syncBattleCards?.();
    return;
  };

  const onDoubleClick = (event) => {
    if (interactionLocked) return;
    if (event.button !== 0 || !getters.isTrainingMode?.()) return;
    const target = event.target;
    const targetFlagId = resolveTrainingFlagIdFromTarget(target);
    if (isInteractiveUiTarget(target) && !targetFlagId) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const phase = runtime.getPhase?.();
    const trainingFlagHitId = targetFlagId || resolveTrainingWorldFlagIdForEvent(event, runtime);
    const world = resolveEventWorldPoint(event);
    if (phase === 'battle') {
      const pickedSquadId = trainingFlagHitId || (world && runtime.pickSquadAtAgentPoint?.(
        world.x,
        world.y,
        { team: 'any' }
      ));
      if (!pickedSquadId) return;
      const followed = callbacks.followBattleSquad?.(pickedSquadId);
      if (followed === undefined) callbacks.selectBattleSquad?.(pickedSquadId, true);
      event.preventDefault();
      return;
    }
    if (phase !== 'deploy') return;
    if (!world && !trainingFlagHitId) return;
    const group = trainingFlagHitId
      ? runtime.getDeployGroupById?.(trainingFlagHitId, TEAM_ANY)
      : runtime.pickDeployGroup?.(world, 'any');
    if (!group?.id || group.placed === false) return;

    const camera = cameraControllerRef.current;
    const anchor = {
      x: Number(group.x) || 0,
      y: Number(group.y) || 0,
      squadId: group.id
    };
    camera.centerX = anchor.x;
    camera.centerY = anchor.y;
    camera.beginFocusTransition?.(anchor);
    const canvas = canvasRef?.current;
    camera.buildMatrices?.(canvas?.width, canvas?.height);
    runtime.setSelectedDeployGroup?.(group.id);
    runtime.setFocusSquad?.(group.id);
    callbacks.setSelectedSquadId?.(group.id);
    callbacks.setDeployActionAnchorMode?.('world');
    callbacks.setCards?.(runtime.getCardRows?.() || []);
    callbacks.setMinimapSnapshot?.(runtime.getMinimapSnapshot?.() || null);
    event.preventDefault();
  };

  const onMouseDown = (event) => {
    if (interactionLocked) return;
    const target = event.target;
    if (isInteractiveUiTarget(target)) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const currentPhase = runtime.getPhase();
    if (currentPhase === 'deploy') {
      const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
      const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
      if (deployDraggingGroupId && event.button === 2) {
        event.preventDefault();
        const recallResult = callbacks.recallDeployDraggingGroup?.(deployDraggingGroupId, deployDraggingTeam);
        if (!recallResult?.ok) {
          callbacks.setDeployNotice?.(recallResult?.reason || '撤回待部署部队失败');
        }
        return;
      }
      if (deployDraggingGroupId && event.button !== 0) {
        event.preventDefault();
        return;
      }
      if (event.button === 2) {
        deployYawDragRef.current = {
          startX: Number(event.clientX) || 0,
          startWorldYawDeg: Number(cameraControllerRef.current.worldYawDeg) || 0,
          moved: false
        };
        event.preventDefault();
        return;
      }
      if (event.button === 1) {
        beginPanDrag(event, 4);
        return;
      }
      if (event.button === 0) {
        const trainingFlagHitId = resolveTrainingWorldFlagIdForEvent(event, runtime);
        const world = resolveEventWorldPoint(event);
        const directionGroup = trainingFlagHitId ? null : resolveSelectedDirectionArcGroup(world);
        if (directionGroup && beginDirectionArcDrag(directionGroup, world, currentPhase)) {
          event.preventDefault();
          return;
        }
        beginPanDrag(event, 1, spacePressedRef.current ? '' : 'map');
        return;
      }
    }
    if (currentPhase !== 'battle') {
      handleMapCommand(event);
      return;
    }

    const battleUiMode = getters.getBattleUiMode?.();
    const skillConfirmState = getters.getSkillConfirmState?.();
    if (battleUiMode === constants.BATTLE_UI_MODE_SPACING_PICK) {
      callbacks.closeSpacingPick?.();
      return;
    }
    if (event.button === 2 && skillPaintDragRef?.current) {
      event.preventDefault();
      restoreSkillPaintDrag();
      return;
    }
    if (battleUiMode === constants.BATTLE_UI_MODE_SKILL_CONFIRM && event.button === 0) {
      if (beginSkillPaintDrag(event, skillConfirmState)) return;
      beginPanDrag(event, 1, 'battle');
      return;
    }
    if (event.button === 0) {
      const trainingFlagHitId = resolveTrainingWorldFlagIdForEvent(event, runtime);
      const world = resolveEventWorldPoint(event);
      const soldierHitId = !trainingFlagHitId && getters.isTrainingMode?.() && world
        ? runtime.pickSquadAtAgentPoint?.(world.x, world.y, { team: 'any' })
        : '';
      const directionGroup = trainingFlagHitId || soldierHitId
        ? null
        : resolveSelectedDirectionArcGroup(world);
      if (directionGroup && beginDirectionArcDrag(directionGroup, world, currentPhase)) {
        event.preventDefault();
        return;
      }
      beginPanDrag(event, 1, 'battle');
      return;
    }
    if (event.button !== 2) return;

    const selected = runtime.getSquadById(getters.getSelectedSquadId?.());
    event.preventDefault();
    if (battleUiMode === constants.BATTLE_UI_MODE_SKILL_CONFIRM) {
      callbacks.closeSkillConfirm?.(getters.getSkillConfirmState?.()?.resumeOnConfirm !== false);
      return;
    }
    if (battleUiMode === constants.BATTLE_UI_MODE_PATH) {
      callbacks.setPendingPathPoints?.((prev) => {
        if (prev.length > 0) return prev.slice(0, prev.length - 1);
        callbacks.setBattleUiMode?.(constants.BATTLE_UI_MODE_NONE);
        callbacks.setPlanningHoverPoint?.(null);
        callbacks.setClockPaused?.(false);
        return prev;
      });
      return;
    }
    if (battleUiMode === constants.BATTLE_UI_MODE_SKILL_PICK) {
      callbacks.closeSkillPick?.();
      return;
    }
    if (selected && runtime.canControlSquad?.(selected) && selected.remain > 0) {
      const world = resolveEventWorldPoint(event);
      if (!world) return;
      runtime.commandMove(selected.id, world, { append: false, replace: true, orderType: constants.ORDER_MOVE, inputType: 'battle_rmb_move' });
      callbacks.syncBattleCards?.();
      return;
    }
    deployYawDragRef.current = {
      startX: Number(event.clientX) || 0,
      startWorldYawDeg: Number(cameraControllerRef.current.worldYawDeg) || 0,
      moved: false
    };
  };

  const onWheel = (event) => {
    if (interactionLocked) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const phase = runtime.getPhase?.();
    if (phase !== 'deploy' && phase !== 'battle') return;
    if (isInteractiveUiTarget(event?.target)) return;
    if (panDragRef.current) return;
    event.preventDefault();

    if (phase === 'deploy') {
      const groupId = getters.getDeployDraggingGroupId?.()
        || getters.getSelectedSquadId?.()
        || runtime.getDeployGroups?.()?.selectedId
        || '';
      const group = groupId ? runtime.getDeployGroupById?.(groupId, TEAM_ANY) : null;
      if (group && typeof runtime.setDeployGroupRect === 'function') {
        const fallbackFacing = group.team === 'defender' ? Math.PI : 0;
        const currentFacing = Number.isFinite(Number(group?.formationRect?.facingRad))
          ? Number(group.formationRect.facingRad)
          : fallbackFacing;
        const stepDeg = Math.max(1, Number(constants.DEPLOY_WHEEL_ROTATE_STEP_DEG) || 15);
        const direction = Number(event?.deltaY) < 0 ? -1 : 1;
        const nextFacing = (normalizeDeg((currentFacing * 180 / Math.PI) + (direction * stepDeg)) * Math.PI) / 180;
        const result = runtime.setDeployGroupRect(group.id, { facingRad: nextFacing }, group.team);
        if (result?.ok !== false) {
          callbacks.setCards?.(runtime.getCardRows?.() || []);
          callbacks.setMinimapSnapshot?.(runtime.getMinimapSnapshot?.() || null);
        }
        return;
      }
    }

    const closeDistanceMin = constants.CAMERA_DISTANCE_CLOSE_MIN || constants.CAMERA_DISTANCE_MIN || 360;
    const baseDistanceMax = constants.CAMERA_DISTANCE_MAX || 980;
    const isTrainingMode = getters.isTrainingMode?.() === true;
    const pitchDistanceMin = constants.CAMERA_DISTANCE_MIN || closeDistanceMin;
    const zoomDistanceMin = isTrainingMode ? pitchDistanceMin : closeDistanceMin;
    const overviewDistanceMax = isTrainingMode
      ? resolveTrainingOverviewDistance({
        field: runtime.getField?.(),
        viewport: {
          width: canvasRef?.current?.width || canvasRef?.current?.clientWidth,
          height: canvasRef?.current?.height || canvasRef?.current?.clientHeight
        },
        baseDistance: baseDistanceMax,
        extraDistance: constants.TRAINING_OVERVIEW_DISTANCE_EXTRA,
        maxDistance: constants.TRAINING_OVERVIEW_DISTANCE_MAX,
        padding: constants.TRAINING_OVERVIEW_VIEW_PADDING
      })
      : baseDistanceMax;
    const zoomStep = isTrainingMode
      ? Math.max(1, Number(constants.TRAINING_CAMERA_ZOOM_STEP) || DEFAULT_TRAINING_CAMERA_ZOOM_STEP)
      : Math.max(1, Number(constants.CAMERA_ZOOM_STEP) || 24);
    const pitchDistanceMax = isTrainingMode
      ? Math.min(
        overviewDistanceMax,
        Math.max(zoomDistanceMin + 1, Number(constants.TRAINING_PITCH_DISTANCE_MAX) || DEFAULT_TRAINING_PITCH_DISTANCE_MAX)
      )
      : baseDistanceMax;
    const nextDistance = cameraControllerRef.current.distance + (event.deltaY < 0 ? -zoomStep : zoomStep);
    if (typeof cameraControllerRef.current.setDistanceWithDynamicPitch === 'function') {
      cameraControllerRef.current.setDistanceWithDynamicPitch(
        nextDistance,
        zoomDistanceMin,
        pitchDistanceMax,
        overviewDistanceMax,
        pitchDistanceMin
      );
    } else {
      cameraControllerRef.current.distance = clamp(nextDistance, zoomDistanceMin, overviewDistanceMax);
    }
  };

  const onMinimapClick = (worldPoint) => {
    if (interactionLocked) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
      if (!deployDraggingGroupId) return;
      callbacks.setDeployNotice?.('待部署阶段请在主战场左键放置，或右键撤回');
      return;
    }
    if (runtime.getPhase() !== 'battle') return;
    cameraControllerRef.current.centerX = Number(worldPoint?.x) || 0;
    cameraControllerRef.current.centerY = Number(worldPoint?.y) || 0;
    const canvas = canvasRef?.current;
    cameraControllerRef.current.buildMatrices?.(canvas?.width, canvas?.height);
  };

  const onMouseMove = (event) => {
    const runtime = runtimeRef.current;
    const canvas = canvasRef?.current;
    if (!runtime || !canvas) return;
    if (interactionLocked) {
      if (runtime.getPhase?.() === 'deploy') {
        runtime.setHoveredDeployGroup?.('');
      }
      if (runtime.getPhase?.() === 'deploy' || runtime.getPhase?.() === 'battle') {
        runtime.setHoveredDeployDirectionArc?.('');
        runtime.setHoveredBattleSquad?.('');
        setDirectionArcCursor('');
      }
      return;
    }
    const target = event.target;
    if (isInteractiveUiTarget(target)) {
      const isTrainingFlagTarget = typeof target?.closest === 'function'
        && !!target.closest('.pve2-training-flag-label');
      if (!isTrainingFlagTarget) {
        if (runtime.getPhase?.() === 'deploy') {
          runtime.setHoveredDeployGroup?.('');
        }
        if (runtime.getPhase?.() === 'deploy' || runtime.getPhase?.() === 'battle') {
          runtime.setHoveredDeployDirectionArc?.('');
          runtime.setHoveredBattleSquad?.('');
          setDirectionArcCursor('');
        }
      }
      return;
    }
    if (skillPaintDragRef?.current) return;
    if (panDragRef.current || deployYawDragRef.current || deployDirectionArcDragRef.current) return;
    const screenPoint = resolveEventCanvasPoint(event);
    if (!screenPoint) return;
    const { px, py } = screenPoint;
    cameraControllerRef.current.buildMatrices?.(canvas.width, canvas.height);
    const trainingFlagHitId = resolveTrainingWorldFlagIdForEvent(event, runtime);
    const world = cameraControllerRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    if (world?.valid === false) {
      if (runtime.getPhase?.() === 'deploy') {
        runtime.setHoveredDeployGroup?.(trainingFlagHitId);
      }
      if (runtime.getPhase?.() === 'deploy' || runtime.getPhase?.() === 'battle') {
        runtime.setHoveredDeployDirectionArc?.('');
        runtime.setHoveredBattleSquad?.(runtime.getPhase?.() === 'battle' ? trainingFlagHitId : '');
        setDirectionArcCursor('');
      }
      return;
    }
    pointerWorldRef.current = world;

    const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
    const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
    if (runtime.getPhase() === 'deploy' && deployDraggingGroupId) {
      runtime.setHoveredDeployGroup?.('');
      runtime.setHoveredBattleSquad?.('');
      runtime.setHoveredDeployDirectionArc?.('');
      setDirectionArcCursor('');
      runtime.moveDeployGroup(deployDraggingGroupId, world, deployDraggingTeam);
      syncCardsAndMinimap();
      return;
    }

    if (runtime.getPhase() === 'deploy') {
      runtime.setHoveredBattleSquad?.('');
      const directionGroup = resolveSelectedDirectionArcGroup(world);
      runtime.setHoveredDeployDirectionArc?.(directionGroup?.id || '');
      if (directionGroup && !trainingFlagHitId) {
        runtime.setHoveredDeployGroup?.('');
        setDirectionArcCursor('grab');
        return;
      }
      setDirectionArcCursor('');
      const hovered = runtime.pickDeployGroup?.(
        world,
        getters.isTrainingMode?.() ? 'any' : 'attacker'
      );
      runtime.setHoveredDeployGroup?.(trainingFlagHitId || (hovered?.placed === false ? '' : (hovered?.id || '')));
      // Hovering only changes the renderer preselection. Selection is
      // committed by a click in handleMapCommand.
      return;
    }

    if (runtime.getPhase() !== 'battle') return;
    const battleUiMode = getters.getBattleUiMode?.();
    const skillConfirmState = getters.getSkillConfirmState?.();
    const directionGroup = resolveSelectedDirectionArcGroup(world);
    runtime.setHoveredDeployDirectionArc?.(directionGroup?.id || '');
    if (directionGroup && !trainingFlagHitId && battleUiMode !== constants.BATTLE_UI_MODE_SKILL_CONFIRM) {
      runtime.setHoveredBattleSquad?.('');
      setDirectionArcCursor('grab');
      return;
    }
    setDirectionArcCursor('');
    const hoveredBattleSquadId = getters.isTrainingMode?.()
      ? (trainingFlagHitId || runtime.pickSquadAtAgentPoint?.(world.x, world.y, { team: 'any' }))
      : '';
    runtime.setHoveredBattleSquad?.(hoveredBattleSquadId || '');
    const aimState = getters.getAimState?.();
    if (battleUiMode === constants.BATTLE_UI_MODE_PATH) {
      if (callbacks.isPathPointBlocked?.(world)) callbacks.setPlanningHoverPoint?.(null);
      else callbacks.setPlanningHoverPoint?.({ x: world.x, y: world.y });
      return;
    }
    if (battleUiMode === constants.BATTLE_UI_MODE_SKILL_CONFIRM && skillConfirmState?.squadId) {
      const selected = runtime.getSquadById(skillConfirmState.squadId);
      if (!selected) return;
      const centerX = Number(skillConfirmState?.center?.x) || Number(selected.x) || 0;
      const centerY = Number(skillConfirmState?.center?.y) || Number(selected.y) || 0;
      const targetMode = resolveSkillTargetMode(skillConfirmState);
      if (targetMode === 'direction') {
        const dx = world.x - centerX;
        const dy = world.y - centerY;
        const len = Math.hypot(dx, dy) || 1;
        const minRange = Math.max(0, Number(skillConfirmState?.profile?.minRange) || 0);
        const maxRange = Math.max(minRange || 1, Number(skillConfirmState?.maxRange) || 220);
        const clampedLen = clamp(len, minRange, maxRange);
        callbacks.setSkillConfirmState?.((prev) => (prev ? {
          ...prev,
          dir: { x: dx / len, y: dy / len },
          len: clampedLen,
          hoverPoint: {
            x: centerX + ((dx / len) * clampedLen),
            y: centerY + ((dy / len) * clampedLen)
          }
        } : prev));
        return;
      }
      if (targetMode === 'ground') {
        const maxRange = Math.max(8, Number(skillConfirmState?.maxRange) || 260);
        const dx = world.x - centerX;
        const dy = world.y - centerY;
        const dist = Math.hypot(dx, dy) || 1;
        const paintCursorPoint = isTrainingSkillPaintConfirm(skillConfirmState)
          ? resolveSkillPaintCursorPoint(world, skillConfirmState, selected)
          : null;
        const tx = paintCursorPoint ? paintCursorPoint.x : (dist > maxRange ? centerX + (dx / dist) * maxRange : world.x);
        const ty = paintCursorPoint ? paintCursorPoint.y : (dist > maxRange ? centerY + (dy / dist) * maxRange : world.y);
        const isMeleeGround = skillConfirmState?.profile?.castStyle === 'melee';
        callbacks.setSkillConfirmState?.((prev) => (prev ? {
          ...prev,
          hoverPoint: { x: tx, y: ty },
          ...(isMeleeGround ? {
            dir: { x: (tx - centerX) / (Math.hypot(tx - centerX, ty - centerY) || 1), y: (ty - centerY) / (Math.hypot(tx - centerX, ty - centerY) || 1) },
            len: Math.min(maxRange, Math.max(0, Math.hypot(tx - centerX, ty - centerY)))
          } : {})
        } : prev));
        return;
      }
      if (targetMode === 'enemy') {
        const pickedSquadId = trainingFlagHitId || runtime.pickSquadAtPoint(world.x, world.y, {
          team: 'any',
          maxDist: Math.max(34, Number(selected.radius) || 34)
        });
        const picked = pickedSquadId ? runtime.getSquadById(pickedSquadId) : null;
        callbacks.setSkillConfirmState?.((prev) => (prev ? {
          ...prev,
          targetSquadId: picked && picked.team !== selected.team ? picked.id : '',
          hoverPoint: picked && picked.team !== selected.team
            ? { x: Number(picked.x) || 0, y: Number(picked.y) || 0 }
            : null
        } : prev));
        return;
      }
    }
    if (!aimState?.active) return;
    const selected = runtime.getSquadById(aimState.squadId);
    if (!selected) return;
    const center = worldToScreenRef.current ? worldToScreenRef.current({ x: world.x, y: world.y, z: 0 }) : null;
    const edge = worldToScreenRef.current
      ? worldToScreenRef.current({ x: world.x + (constants.skillAoeRadiusByClass?.(selected.classTag) || 24), y: world.y, z: 0 })
      : null;
    const radiusPx = center && edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : 22;
    callbacks.setAimState?.((prev) => ({ ...prev, point: { x: world.x, y: world.y }, radiusPx }));
  };

  const onMouseLeave = () => {
    if (interactionLocked) return;
    runtimeRef.current?.setHoveredDeployGroup?.('');
    runtimeRef.current?.setHoveredBattleSquad?.('');
    if (!deployDirectionArcDragRef.current) {
      runtimeRef.current?.setHoveredDeployDirectionArc?.('');
      setDirectionArcCursor('');
    }
  };

  const onContextMenu = (event) => {
    event.preventDefault();
  };

  const bindWindow = () => {
    if (!open) return () => {};
    const handleWindowMouseMove = (event) => {
      if (interactionLocked) {
        clearPanDrag();
        clearDeployYawDrag();
        clearDeployRectDrag();
        clearDeployDirectionArcDrag();
        restoreSkillPaintDrag();
        return;
      }
      const canvas = canvasRef?.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const runtime = runtimeRef.current;
      const phase = runtime?.getPhase?.();
      const isDeploy = phase === 'deploy';
      const canEditDirectionArc = isDeploy || phase === 'battle';
      const canPan = isDeploy || phase === 'battle';
      if (!canPan) {
        clearPanDrag();
        clearDeployYawDrag();
        clearDeployRectDrag();
        clearDeployDirectionArcDrag();
        return;
      }
      if (skillPaintDragRef?.current) {
        if (phase !== 'battle') {
          restoreSkillPaintDrag();
          return;
        }
        if ((Number(event?.buttons) & 1) === 1 && updateSkillPaintDrag(event)) return;
      }
      if (!isDeploy) clearDeployRectDrag();
      if (!canEditDirectionArc) clearDeployDirectionArcDrag();
      const directionDrag = deployDirectionArcDragRef.current;
      if (canEditDirectionArc && directionDrag && runtime) {
        if (directionDrag.phase !== phase) {
          clearDeployDirectionArcDrag();
          return;
        }
        if ((event.buttons & 1) !== 1) {
          clearDeployDirectionArcDrag();
          return;
        }
        const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
        const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
        const camera = cameraControllerRef.current;
        camera.buildMatrices?.(canvas.width, canvas.height);
        const world = camera.screenToGround(px, py, { width: canvas.width, height: canvas.height });
        if (world?.valid !== false && Number.isFinite(Number(world?.x)) && Number.isFinite(Number(world?.y))) {
          pointerWorldRef.current = world;
          if (!updateDirectionArcFromWorld(directionDrag, world, runtime)) {
            clearDeployDirectionArcDrag();
          }
        }
        return;
      }
      const rectDrag = deployRectDragRef.current;
      if (isDeploy && rectDrag && runtime) {
        if ((event.buttons & 1) !== 1) {
          clearDeployRectDrag();
          return;
        }
        const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
        const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
        const camera = cameraControllerRef.current;
        camera.buildMatrices?.(canvas.width, canvas.height);
        const world = camera.screenToGround(px, py, { width: canvas.width, height: canvas.height });
        if (world?.valid !== false && Number.isFinite(Number(world?.x)) && Number.isFinite(Number(world?.y))) {
          const dx = (Number(world.x) || 0) - (Number(rectDrag.centerX) || 0);
          const dy = (Number(world.y) || 0) - (Number(rectDrag.centerY) || 0);
          const projection = ((dx * (Number(rectDrag.axisX) || 0)) + (dy * (Number(rectDrag.axisY) || 0))) * (Number(rectDrag.sideSign) || 1);
          const width = Math.max(8, Math.abs(projection) * 2);
          runtime.setDeployGroupRect(rectDrag.groupId, { width }, rectDrag.team);
          syncCardsAndMinimap();
        }
        return;
      }

      const rotate = deployYawDragRef.current;
      if (rotate) {
        if ((event.buttons & 2) !== 2) {
          clearDeployYawDrag();
        } else {
          const dx = (Number(event.clientX) || 0) - (Number(rotate.startX) || 0);
          if (Math.abs(dx) >= (constants.DEPLOY_ROTATE_CLICK_THRESHOLD || 3)) rotate.moved = true;
          cameraControllerRef.current.worldYawDeg = normalizeDeg((Number(rotate.startWorldYawDeg) || 0) + (dx * (constants.DEPLOY_ROTATE_SENSITIVITY || 0.28)));
        }
      }

      const pan = panDragRef.current;
      if (!pan) return;
      if ((event.buttons & pan.buttonMask) !== pan.buttonMask) {
        clearPanDrag();
        return;
      }
      const dragDistance = Math.hypot(
        (Number(event.clientX) || 0) - pan.startClientX,
        (Number(event.clientY) || 0) - pan.startClientY
      );
      if (!pan.moved && dragDistance < PAN_DRAG_THRESHOLD_PX) return;
      pan.moved = true;
      if ((pan.buttonMask & 1) === 1) cameraControllerRef.current?.clearFollow?.();
      const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
      const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
      cameraControllerRef.current.distance = Number(pan.startDistance) || cameraControllerRef.current.distance;
      cameraControllerRef.current.currentPitch = Number(pan.startPitch) || cameraControllerRef.current.currentPitch;
      cameraControllerRef.current.pitchFrom = cameraControllerRef.current.currentPitch;
      cameraControllerRef.current.pitchTo = cameraControllerRef.current.currentPitch;
      cameraControllerRef.current.pitchTweenSec = cameraControllerRef.current.pitchTweenDurationSec;
      const camera = cameraControllerRef.current;
      camera.buildMatrices?.(canvas.width, canvas.height);
      const currentWorld = camera.screenToGround?.(px, py, { width: canvas.width, height: canvas.height });
      if (
        pan.anchorWorld
        && Number.isFinite(Number(currentWorld?.x))
        && Number.isFinite(Number(currentWorld?.y))
        && currentWorld?.valid !== false
      ) {
        // Keep the ground point grabbed on pointer down under the cursor. This
        // remains correct when the camera yaw or pitch changes the screen axes.
        camera.centerX += pan.anchorWorld.x - Number(currentWorld.x);
        camera.centerY += pan.anchorWorld.y - Number(currentWorld.y);
      }
      camera.buildMatrices?.(canvas.width, canvas.height);
    };

    const handleWindowMouseUp = (event) => {
      if (interactionLocked) {
        clearPanDrag();
        clearDeployYawDrag();
        clearDeployRectDrag();
        clearDeployDirectionArcDrag();
        restoreSkillPaintDrag();
        return;
      }
      const completedSkillPaint = event.button === 0 ? finishSkillPaintDrag(event) : null;
      if (completedSkillPaint) {
        clearPanDrag();
        clearDeployYawDrag();
        clearDeployRectDrag();
        clearDeployDirectionArcDrag();
        handleBattlePrimaryAction(event, completedSkillPaint);
        return;
      }
      const pan = panDragRef.current;
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
      clearDeployRectDrag();
      clearDeployDirectionArcDrag();
      if (!pan?.primaryAction || pan.moved || event.button !== 0) return;
      if (pan.primaryAction === 'map') {
        handleMapCommand(pan.primaryEvent);
      } else if (pan.primaryAction === 'battle') {
        handleBattlePrimaryAction(pan.primaryEvent);
      }
    };
    const handleWindowBlur = () => {
      clearPanDrag();
      clearDeployYawDrag();
      clearDeployRectDrag();
      clearDeployDirectionArcDrag();
      restoreSkillPaintDrag();
      runtimeRef.current?.setHoveredDeployGroup?.('');
      runtimeRef.current?.setHoveredBattleSquad?.('');
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
  };

  return {
    beginPanDrag,
    clearPanDrag,
    clearDeployYawDrag,
    clearDeployRectDrag,
    clearDeployDirectionArcDrag,
    clearSkillPaintDrag: restoreSkillPaintDrag,
    resolveEventWorldPoint,
    handleMapCommand,
    onDoubleClick,
    onMouseDown,
    onMouseUp: () => {},
    onMouseMove,
    onMouseLeave,
    onWheel,
    onContextMenu,
    onMinimapClick,
    bindWindow
  };
};

export default createBattleInputController;
