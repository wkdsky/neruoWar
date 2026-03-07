import { normalizeDeg } from '../shared/angle';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const createBattleInputController = ({
  open = false,
  canvasRef,
  runtimeRef,
  cameraControllerRef,
  cameraViewRectRef,
  worldToScreenRef,
  pointerWorldRef,
  panDragRef,
  deployYawDragRef,
  deployRectDragRef,
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
    const world = cameraControllerRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    pointerWorldRef.current = world;
    if (!Number.isFinite(Number(world?.x)) || !Number.isFinite(Number(world?.y))) return null;
    return world;
  };

  const beginPanDrag = (event, buttonMask = 1) => {
    const canvas = canvasRef?.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    panDragRef.current = {
      prevPx: px,
      prevPy: py,
      buttonMask,
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

  const syncCardsAndMinimap = () => {
    const runtime = runtimeRef?.current;
    if (!runtime) return;
    callbacks.setCards?.(runtime.getCardRows?.() || []);
    callbacks.setMinimapSnapshot?.(runtime.getMinimapSnapshot?.() || null);
  };

  const handleMapCommand = (event) => {
    if (event.button !== 0) return;
    const runtime = runtimeRef.current;
    const world = resolveEventWorldPoint(event);
    if (!runtime || !world) return;

    if (runtime.getPhase() !== 'deploy') return;
    const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
    const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
    if (deployDraggingGroupId) {
      let targetGroupId = deployDraggingGroupId;
      let targetTeam = deployDraggingTeam;
      if (getters.isTrainingMode?.()) {
        const desiredTeam = callbacks.resolveDeployPlacementTeam?.(world, targetTeam);
        const switchResult = callbacks.switchDeployGroupTeamForTraining?.(targetGroupId, desiredTeam);
        if (!switchResult?.ok) {
          callbacks.setDeployNotice?.(switchResult?.reason || '切换部队阵营失败');
          return;
        }
        targetGroupId = switchResult.groupId || targetGroupId;
        targetTeam = switchResult.team === 'defender' ? 'defender' : 'attacker';
      }
      if (!runtime.canDeployAt(world, targetTeam, 10)) {
        callbacks.setDeployNotice?.(targetTeam === 'defender'
          ? '中间交战区不可部署，请放置在右侧红色区域'
          : '中间交战区不可部署，请放置在左侧蓝色区域');
        return;
      }
      runtime.moveDeployGroup(targetGroupId, world, targetTeam);
      runtime.setDeployGroupPlaced(targetTeam, targetGroupId, true);
      runtime.setSelectedDeployGroup(targetGroupId);
      runtime.setFocusSquad(targetGroupId);
      callbacks.setSelectedSquadId?.(targetGroupId);
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
    callbacks.setDeployActionAnchorMode?.('');
    callbacks.setCards?.(runtime.getCardRows?.() || []);
  };

  const onMouseDown = (event) => {
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
    const selected = runtime.getSquadById(getters.getSelectedSquadId?.());
    const battleUiMode = getters.getBattleUiMode?.();
    const skillConfirmState = getters.getSkillConfirmState?.();

    if (battleUiMode === constants.BATTLE_UI_MODE_MARCH_PICK) {
      callbacks.closeMarchModePick?.();
      return;
    }

    if (event.button === 2) {
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
      if (selected && selected.team === 'attacker' && selected.remain > 0) {
        runtime.commandMove(selected.id, world, { append: false, replace: true, orderType: constants.ORDER_MOVE, inputType: 'battle_rmb_move' });
        callbacks.syncBattleCards?.();
      }
      return;
    }
    if (event.button !== 0) return;

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

    const pickedSquadId = runtime.pickSquadAtPoint(world.x, world.y, { team: 'attacker', maxDist: 34 });
    if (pickedSquadId) {
      callbacks.selectBattleSquad?.(pickedSquadId, true);
      return;
    }
    callbacks.setWorldActionsVisibleForSquadId?.('');
    if (battleUiMode !== constants.BATTLE_UI_MODE_NONE) {
      callbacks.setBattleUiMode?.(constants.BATTLE_UI_MODE_NONE);
      callbacks.setSkillPopupSquadId?.('');
    }
  };

  const onWheel = (event) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'battle') {
      event.preventDefault();
      return;
    }
    if (runtime.getPhase() !== 'deploy') return;
    if (panDragRef.current) return;
    event.preventDefault();
    const nextDistance = cameraControllerRef.current.distance + (event.deltaY < 0 ? -(constants.CAMERA_ZOOM_STEP || 24) : (constants.CAMERA_ZOOM_STEP || 24));
    cameraControllerRef.current.distance = clamp(nextDistance, constants.CAMERA_DISTANCE_MIN || 360, constants.CAMERA_DISTANCE_MAX || 980);
  };

  const onMinimapClick = (worldPoint) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
      const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
      if (!deployDraggingGroupId) return;
      let targetGroupId = deployDraggingGroupId;
      let targetTeam = deployDraggingTeam;
      if (getters.isTrainingMode?.()) {
        const desiredTeam = callbacks.resolveDeployPlacementTeam?.(worldPoint, targetTeam);
        const switchResult = callbacks.switchDeployGroupTeamForTraining?.(targetGroupId, desiredTeam);
        if (!switchResult?.ok) {
          callbacks.setDeployNotice?.(switchResult?.reason || '切换部队阵营失败');
          return;
        }
        targetGroupId = switchResult.groupId || targetGroupId;
        targetTeam = switchResult.team === 'defender' ? 'defender' : 'attacker';
      }
      if (!runtime.canDeployAt(worldPoint, targetTeam, 10)) {
        callbacks.setDeployNotice?.(targetTeam === 'defender'
          ? '中间交战区不可部署，请放置在右侧红色区域'
          : '中间交战区不可部署，请放置在左侧蓝色区域');
        return;
      }
      runtime.moveDeployGroup(targetGroupId, worldPoint, targetTeam);
      runtime.setDeployGroupPlaced(targetTeam, targetGroupId, true);
      runtime.setSelectedDeployGroup(targetGroupId);
      runtime.setFocusSquad(targetGroupId);
      callbacks.setSelectedSquadId?.(targetGroupId);
      callbacks.setDeployDraggingGroup?.({ groupId: '', team: 'attacker' });
      callbacks.setDeployActionAnchorMode?.('world');
      callbacks.setDeployNotice?.(`部队已放置，可继续编辑或${getters.isTrainingMode?.() ? '开始训练' : '开战'}`);
      syncCardsAndMinimap();
      return;
    }
    if (runtime.getPhase() !== 'battle') return;
    cameraControllerRef.current.centerX = Number(worldPoint?.x) || 0;
    cameraControllerRef.current.centerY = Number(worldPoint?.y) || 0;
  };

  const onMouseMove = (event) => {
    const runtime = runtimeRef.current;
    const canvas = canvasRef?.current;
    if (!runtime || !canvas) return;
    if (panDragRef.current || deployYawDragRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const world = cameraControllerRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    pointerWorldRef.current = world;

    const deployDraggingGroupId = getters.getDeployDraggingGroupId?.() || '';
    const deployDraggingTeam = getters.getDeployDraggingTeam?.() || 'attacker';
    if (runtime.getPhase() === 'deploy' && deployDraggingGroupId) {
      let targetGroupId = deployDraggingGroupId;
      let targetTeam = deployDraggingTeam;
      if (getters.isTrainingMode?.()) {
        const desiredTeam = callbacks.resolveDeployPlacementTeam?.(world, targetTeam);
        const switchResult = callbacks.switchDeployGroupTeamForTraining?.(targetGroupId, desiredTeam);
        if (!switchResult?.ok) return;
        targetGroupId = switchResult.groupId || targetGroupId;
        targetTeam = switchResult.team === 'defender' ? 'defender' : 'attacker';
      }
      runtime.moveDeployGroup(targetGroupId, world, targetTeam);
      syncCardsAndMinimap();
      return;
    }

    if (runtime.getPhase() !== 'battle') return;
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

  const onContextMenu = (event) => {
    event.preventDefault();
  };

  const bindWindow = () => {
    if (!open) return () => {};
    const handleWindowMouseMove = (event) => {
      const canvas = canvasRef?.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const runtime = runtimeRef.current;
      const isDeploy = runtime?.getPhase() === 'deploy';
      if (!isDeploy) {
        clearPanDrag();
        clearDeployYawDrag();
        clearDeployRectDrag();
        return;
      }

      const rectDrag = deployRectDragRef.current;
      if (rectDrag && runtime) {
        if ((event.buttons & 1) !== 1) {
          clearDeployRectDrag();
          return;
        }
        const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
        const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
        const world = cameraControllerRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
        if (Number.isFinite(Number(world?.x)) && Number.isFinite(Number(world?.y))) {
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
      const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
      const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
      cameraControllerRef.current.distance = Number(pan.startDistance) || cameraControllerRef.current.distance;
      cameraControllerRef.current.currentPitch = Number(pan.startPitch) || cameraControllerRef.current.currentPitch;
      cameraControllerRef.current.pitchFrom = cameraControllerRef.current.currentPitch;
      cameraControllerRef.current.pitchTo = cameraControllerRef.current.currentPitch;
      cameraControllerRef.current.pitchTweenSec = cameraControllerRef.current.pitchTweenDurationSec;
      const dxPx = px - pan.prevPx;
      const dyPx = py - pan.prevPy;
      const viewW = Math.max(1, Number(cameraViewRectRef.current?.widthWorld) || 1);
      const viewH = Math.max(1, Number(cameraViewRectRef.current?.heightWorld) || 1);
      cameraControllerRef.current.centerX += (dxPx / Math.max(1, canvas.width)) * viewW;
      cameraControllerRef.current.centerY -= (dyPx / Math.max(1, canvas.height)) * viewH;
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
      clearDeployRectDrag();
    };
    const handleWindowBlur = () => {
      clearPanDrag();
      clearDeployYawDrag();
      clearDeployRectDrag();
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
    resolveEventWorldPoint,
    handleMapCommand,
    onMouseDown,
    onMouseUp: () => {},
    onMouseMove,
    onWheel,
    onContextMenu,
    onMinimapClick,
    bindWindow
  };
};

export default createBattleInputController;
