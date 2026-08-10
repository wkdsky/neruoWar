import { normalizeDeg } from '../shared/angle';
import {
  isPointOnTrainingDirectionArc,
  resolveTrainingDirectionOffsetFromPoint
} from '../shared/trainingDirectionArc';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PAN_DRAG_THRESHOLD_PX = 4;
const TEAM_ANY = 'any';
const CAMERA_VERTICAL_FOV_DEG = 48;
const DEFAULT_TRAINING_OVERVIEW_DISTANCE_EXTRA = 900;
const DEFAULT_TRAINING_OVERVIEW_DISTANCE_MAX = 4600;
const DEFAULT_TRAINING_OVERVIEW_VIEW_PADDING = 1.08;
const TRAINING_DIRECTION_ARC_PRIORITY_HIT_OPTIONS = Object.freeze({
  minimumHitRadius: 24,
  maximumHitRadius: 42,
  extraPadding: 14
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
  '.pve2-confirm',
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
  worldToScreenRef,
  pointerWorldRef,
  panDragRef,
  deployYawDragRef,
  deployRectDragRef,
  deployDirectionArcDragRef,
  spacePressedRef,
  constants = {},
  getters = {},
  callbacks = {}
} = {}) => {
  const resolveEventWorldPoint = (event) => {
    const canvas = canvasRef?.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const camera = cameraControllerRef.current;
    camera?.buildMatrices?.(canvas.width, canvas.height);
    const world = camera.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    if (world?.valid === false) return null;
    pointerWorldRef.current = world;
    if (!Number.isFinite(Number(world?.x)) || !Number.isFinite(Number(world?.y))) return null;
    return world;
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
    const world = resolveEventWorldPoint(event);
    if (!runtime || !world) return;

    if (runtime.getPhase() !== 'deploy') return;
    const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
    const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
    if (deployDraggingGroupId) {
      if (!runtime.canDeployGroupFitAt(deployDraggingGroupId, world, deployDraggingTeam)) {
        callbacks.setDeployNotice?.(deployDraggingTeam === 'defender'
          ? '当前阵型超出右侧红色部署区，请调整位置或切换阵型'
          : '当前阵型超出左侧蓝色部署区，请调整位置或切换阵型');
        return;
      }
      runtime.moveDeployGroup(deployDraggingGroupId, world, deployDraggingTeam);
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

  const handleBattlePrimaryAction = (event) => {
    if (interactionLocked) return;
    if (event.button !== 0) return;
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase?.() !== 'battle') return;
    const world = resolveEventWorldPoint(event);
    if (!world) return;
    const selected = runtime.getSquadById(getters.getSelectedSquadId?.());
    const battleUiMode = getters.getBattleUiMode?.();
    const skillConfirmState = getters.getSkillConfirmState?.();

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
      callbacks.closeSkillConfirm?.(true);
      callbacks.syncBattleCards?.();
      return;
    }

    if (battleUiMode === constants.BATTLE_UI_MODE_PATH) {
      if (callbacks.isPathPointBlocked?.(world)) return;
      callbacks.setPendingPathPoints?.((prev) => [...prev, { x: world.x, y: world.y }]);
      return;
    }

    const pickedSquadId = runtime.pickSquadAtPoint(world.x, world.y, {
      team: 'any',
      maxDist: 34
    });
    if (pickedSquadId) {
      callbacks.selectBattleSquad?.(pickedSquadId, true);
      return;
    }
    runtime.clearSelection?.();
    callbacks.setSelectedSquadId?.('');
    callbacks.syncBattleCards?.();
    callbacks.setWorldActionsVisibleForSquadId?.('');
    if (battleUiMode !== constants.BATTLE_UI_MODE_NONE) {
      callbacks.setBattleUiMode?.(constants.BATTLE_UI_MODE_NONE);
      callbacks.setSkillPopupSquadId?.('');
    }
  };

  const onDoubleClick = (event) => {
    if (interactionLocked) return;
    if (event.button !== 0 || !getters.isTrainingMode?.()) return;
    const target = event.target;
    if (isInteractiveUiTarget(target)) return;
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase?.() !== 'deploy') return;
    const world = resolveEventWorldPoint(event);
    if (!world) return;
    const group = runtime.pickDeployGroup?.(world, 'any');
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
        const world = resolveEventWorldPoint(event);
        const directionGroup = resolveSelectedDirectionArcGroup(world);
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
    if (battleUiMode === constants.BATTLE_UI_MODE_SPACING_PICK) {
      callbacks.closeSpacingPick?.();
      return;
    }
    if (event.button === 0) {
      const world = resolveEventWorldPoint(event);
      const directionGroup = resolveSelectedDirectionArcGroup(world);
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
      callbacks.closeSkillConfirm?.(true);
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
    const overviewDistanceMax = getters.isTrainingMode?.()
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
    const nextDistance = cameraControllerRef.current.distance + (event.deltaY < 0 ? -(constants.CAMERA_ZOOM_STEP || 24) : (constants.CAMERA_ZOOM_STEP || 24));
    if (typeof cameraControllerRef.current.setDistanceWithDynamicPitch === 'function') {
      cameraControllerRef.current.setDistanceWithDynamicPitch(
        nextDistance,
        closeDistanceMin,
        baseDistanceMax,
        overviewDistanceMax,
        constants.CAMERA_DISTANCE_MIN || closeDistanceMin
      );
    } else {
      cameraControllerRef.current.distance = clamp(nextDistance, closeDistanceMin, overviewDistanceMax);
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
        setDirectionArcCursor('');
      }
      return;
    }
    const target = event.target;
    if (isInteractiveUiTarget(target)) {
      if (runtime.getPhase?.() === 'deploy') {
        runtime.setHoveredDeployGroup?.('');
      }
      if (runtime.getPhase?.() === 'deploy' || runtime.getPhase?.() === 'battle') {
        runtime.setHoveredDeployDirectionArc?.('');
        setDirectionArcCursor('');
      }
      return;
    }
    if (panDragRef.current || deployYawDragRef.current || deployDirectionArcDragRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    cameraControllerRef.current.buildMatrices?.(canvas.width, canvas.height);
    const world = cameraControllerRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    if (world?.valid === false) {
      if (runtime.getPhase?.() === 'deploy') {
        runtime.setHoveredDeployGroup?.('');
      }
      if (runtime.getPhase?.() === 'deploy' || runtime.getPhase?.() === 'battle') {
        runtime.setHoveredDeployDirectionArc?.('');
        setDirectionArcCursor('');
      }
      return;
    }
    pointerWorldRef.current = world;

    const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
    const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
    if (runtime.getPhase() === 'deploy' && deployDraggingGroupId) {
      runtime.setHoveredDeployGroup?.('');
      runtime.setHoveredDeployDirectionArc?.('');
      setDirectionArcCursor('');
      runtime.moveDeployGroup(deployDraggingGroupId, world, deployDraggingTeam);
      syncCardsAndMinimap();
      return;
    }

    if (runtime.getPhase() === 'deploy') {
      const directionGroup = resolveSelectedDirectionArcGroup(world);
      runtime.setHoveredDeployDirectionArc?.(directionGroup?.id || '');
      if (directionGroup) {
        runtime.setHoveredDeployGroup?.('');
        setDirectionArcCursor('grab');
        return;
      }
      setDirectionArcCursor('');
      const hovered = runtime.pickDeployGroup?.(
        world,
        getters.isTrainingMode?.() ? 'any' : 'attacker'
      );
      runtime.setHoveredDeployGroup?.(hovered?.placed === false ? '' : (hovered?.id || ''));
      // Hovering only changes the renderer preselection. Selection is
      // committed by a click in handleMapCommand.
      return;
    }

    if (runtime.getPhase() !== 'battle') return;
    const directionGroup = resolveSelectedDirectionArcGroup(world);
    runtime.setHoveredDeployDirectionArc?.(directionGroup?.id || '');
    if (directionGroup) {
      setDirectionArcCursor('grab');
      return;
    }
    setDirectionArcCursor('');
    const battleUiMode = getters.getBattleUiMode?.();
    const skillConfirmState = getters.getSkillConfirmState?.();
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
      if (skillConfirmState.kind === 'cavalry') {
        const dx = world.x - centerX;
        const dy = world.y - centerY;
        const len = Math.hypot(dx, dy) || 1;
        const clampedLen = clamp(len, 18, constants.skillRangeByClass?.('cavalry') || 220);
        callbacks.setSkillConfirmState?.((prev) => (prev ? {
          ...prev,
          dir: { x: dx / len, y: dy / len },
          len: clampedLen,
          hoverPoint: { x: world.x, y: world.y }
        } : prev));
        return;
      }
      if (skillConfirmState.kind === 'archer' || skillConfirmState.kind === 'artillery') {
        const maxRange = constants.skillRangeByClass?.(skillConfirmState.kind) || 260;
        const dx = world.x - centerX;
        const dy = world.y - centerY;
        const dist = Math.hypot(dx, dy) || 1;
        const tx = dist > maxRange ? centerX + (dx / dist) * maxRange : world.x;
        const ty = dist > maxRange ? centerY + (dy / dist) * maxRange : world.y;
        callbacks.setSkillConfirmState?.((prev) => (prev ? {
          ...prev,
          hoverPoint: { x: tx, y: ty }
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
      runtimeRef.current?.setHoveredDeployGroup?.('');
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
