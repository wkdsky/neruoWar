import { useCallback, useEffect } from 'react';
import {
  CAMERA_ROTATE_SENSITIVITY,
  CAMERA_ROTATE_CLICK_THRESHOLD,
  ROTATE_STEP,
  ZOOM_STEP,
  DEFENDER_DEFAULT_FACING_DEG,
  createWallFromLike,
  normalizeDefenderFacingDeg,
  normalizeDeg,
  sanitizeDefenderDeployments
} from './battlefieldShared';
import {
  evaluateGhostPlacement,
  findTopWallAtPoint,
  findTopWallByScreenPoint,
  getHintAnchorId,
  getPlacementReasonText,
  hasCollision,
  isOutOfBounds
} from './battlefieldPlacementUtils';

const useBattlefieldInteractions = ({
  open = false,
  editMode = false,
  effectiveCanEdit = false,
  sidebarTab = 'items',
  ghost = null,
  ghostBlocked = false,
  snapState = null,
  invalidReason = '',
  activeDefenderMoveId = '',
  selectedDeploymentId = '',
  selectedWallId = '',
  itemDetailModalItemId = '',
  walls = [],
  defenderDeployments = [],
  fieldWidth = 0,
  fieldHeight = 0,
  defenderZoneMinX = 0,
  cameraAngle = 0,
  cameraYaw = 0,
  worldScale = 1,
  zoom = 1,
  viewport,
  itemCatalogById,
  itemStockMetaMap,
  refs,
  setters,
  callbacks
}) => {
  const {
    canvasRef,
    threeRef,
    mouseScreenRef,
    mouseWorldRef,
    mouseSnapHintRef,
    panDragRef,
    panWorldRef,
    rotateDragRef,
    spacePressedRef,
    cameraYawRef,
    zoomTargetRef
  } = refs;
  const {
    setMessage,
    setItemDetailModalItemId,
    setActiveDefenderMoveId,
    setDefenderDragPreview,
    setSelectedDeploymentId,
    setSelectedWallId,
    setSidebarTab,
    setHasDraftChanges,
    setPanWorld,
    setCameraYaw,
    setGhost,
    setGhostBlocked,
    setSnapState,
    setInvalidReason,
    setDefenderDeployments,
    setWallsWithRecompute,
    setIsPanning,
    setIsRotating
  } = setters;
  const {
    cancelGhostPlacement,
    resolveMouseSnapHint,
    getWorldFromScreenPoint,
    moveDefenderDeployment,
    resolveDefenderMovePreview,
    findDeploymentAtWorld,
    unplaceDefenderDeployment,
    startMoveWall,
    recycleWallToPalette,
    startLayoutEditing,
    animateZoomTo,
    clearPanDragging,
    clearRotateDragging,
    syncGhostByMouse,
    findWallActionButton,
    findDefenderActionButton,
    pickWallFromScreenPoint
  } = callbacks;

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && itemDetailModalItemId) {
        event.preventDefault();
        setItemDetailModalItemId('');
        return;
      }
      if (event.key === ' ') {
        spacePressedRef.current = true;
        event.preventDefault();
      }
      if (event.key === 'Escape' && ghost) {
        event.preventDefault();
        cancelGhostPlacement('已取消放置');
      } else if (event.key === 'Escape' && activeDefenderMoveId) {
        event.preventDefault();
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
        setMessage('已取消守军部队移动');
      }
    };
    const handleKeyUp = (event) => {
      if (event.key === ' ') {
        spacePressedRef.current = false;
      }
    };
    const handleBlur = () => {
      spacePressedRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    activeDefenderMoveId,
    cancelGhostPlacement,
    ghost,
    itemDetailModalItemId,
    open,
    setActiveDefenderMoveId,
    setDefenderDragPreview,
    setItemDetailModalItemId,
    setMessage,
    spacePressedRef
  ]);

  const getPanDeltaFromScreenPoints = useCallback((from, to) => {
    const start = getWorldFromScreenPoint(from.x, from.y);
    const current = getWorldFromScreenPoint(to.x, to.y);
    return {
      x: (Number(start.x) || 0) - (Number(current.x) || 0),
      y: (Number(start.y) || 0) - (Number(current.y) || 0)
    };
  }, [getWorldFromScreenPoint]);

  const startPanDrag = useCallback((event, startScreen, buttonMask = 1) => {
    if (!startScreen) return;
    event.preventDefault();
    const pan = panWorldRef.current;
    panDragRef.current = {
      startScreenX: Number(startScreen.x) || 0,
      startScreenY: Number(startScreen.y) || 0,
      startPanX: Number(pan.x) || 0,
      startPanY: Number(pan.y) || 0,
      buttonMask
    };
    setIsPanning(true);
  }, [panDragRef, panWorldRef, setIsPanning]);

  const commitGhostWallPlacement = useCallback((nextWall, sourceId = '') => {
    if (sourceId) {
      setWallsWithRecompute((prev) => prev.map((item) => (item.id === sourceId ? nextWall : item)));
      setHasDraftChanges(true);
      cancelGhostPlacement('');
      setMessage('物品位置已更新');
      return;
    }

    setWallsWithRecompute((prev) => [...prev, nextWall]);
    setHasDraftChanges(true);
    cancelGhostPlacement('');
    setMessage('物品已放置');
  }, [
    cancelGhostPlacement,
    setHasDraftChanges,
    setMessage,
    setWallsWithRecompute
  ]);

  const handleMouseDown = useCallback((event) => {
    if (!open) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return;

    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    mouseScreenRef.current = { x: point.x, y: point.y, valid: true };
    const world = getWorldFromScreenPoint(point.x, point.y);
    mouseWorldRef.current = world;
    resolveMouseSnapHint(point.x, point.y);

    if (event.button === 2) {
      event.preventDefault();
      rotateDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startYaw: cameraYawRef.current,
        moved: false
      };
      setIsRotating(true);
      return;
    }

    if (event.button === 1) {
      startPanDrag(event, point, 4);
      return;
    }

    if (event.button !== 0) return;

    if (spacePressedRef.current) {
      startPanDrag(event, point, 1);
      return;
    }

    if (ghost) {
      const sourceId = (
        ghost?._mode === 'move'
        && typeof ghost?._sourceId === 'string'
        && ghost._sourceId.trim()
      ) ? ghost._sourceId.trim() : '';
      const ignoreIds = sourceId ? [sourceId] : [];
      const blockedByBounds = isOutOfBounds(ghost, fieldWidth, fieldHeight, itemCatalogById);
      const blockedByCollision = !blockedByBounds && hasCollision(ghost, walls, itemCatalogById, ignoreIds);
      const blockedReason = blockedByBounds ? 'out_of_bounds' : (blockedByCollision ? 'collision' : '');
      if (ghostBlocked || blockedByBounds || blockedByCollision) {
        const reasonText = getPlacementReasonText(blockedReason || invalidReason) || '当前位置无法放置';
        setMessage(reasonText);
        setGhost(ghost);
        setGhostBlocked(true);
        setSnapState(snapState);
        setInvalidReason(blockedReason || invalidReason || '');
        return;
      }
      if (!effectiveCanEdit) {
        setMessage('当前仅可预览，不可编辑战场');
        return;
      }
      const ghostItemId = typeof ghost?.itemId === 'string' ? ghost.itemId : '';
      const ghostItemDef = itemCatalogById.get(ghostItemId) || null;
      const ghostRemaining = itemStockMetaMap.get(ghostItemId)?.remaining ?? 0;
      if (ghost?._mode !== 'move' && ghostRemaining <= 0) {
        setMessage(`物品「${ghostItemDef?.name || ghostItemId || '未知'}」库存不足，无法放置`);
        return;
      }
      const nextWall = createWallFromLike(ghost, {
        id: ghost?._sourceId || undefined
      });
      commitGhostWallPlacement(
        nextWall,
        ghost?._mode === 'move' && ghost?._sourceId ? ghost._sourceId : ''
      );
      return;
    }

    if (editMode && effectiveCanEdit) {
      const defenderActionButton = findDefenderActionButton(point.x, point.y);
      if (defenderActionButton) {
        if (defenderActionButton.type === 'move') {
          setActiveDefenderMoveId(defenderActionButton.deployId);
          setSelectedDeploymentId(defenderActionButton.deployId);
          setSelectedWallId('');
          cancelGhostPlacement('');
          setSidebarTab('defender');
          const selectedDeployment = (Array.isArray(defenderDeployments) ? defenderDeployments : [])
            .find((item) => item?.deployId === defenderActionButton.deployId);
          const previewSeed = selectedDeployment
            ? {
              x: Number(selectedDeployment?.x) || 0,
              y: Number(selectedDeployment?.y) || 0,
              rotation: normalizeDefenderFacingDeg(selectedDeployment?.rotation)
            }
            : world;
          const nextPreview = resolveDefenderMovePreview(defenderActionButton.deployId, previewSeed);
          setDefenderDragPreview(nextPreview);
          setMessage('移动守军部队：鼠标移动预览，左键确认位置（仅右侧蓝色区域可放置）');
        } else if (defenderActionButton.type === 'remove') {
          unplaceDefenderDeployment(defenderActionButton.deployId);
        }
        return;
      }
    }

    if (editMode && effectiveCanEdit && activeDefenderMoveId) {
      const preview = resolveDefenderMovePreview(activeDefenderMoveId, world);
      if (!preview) {
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
        return;
      }
      setDefenderDragPreview(preview);
      if (preview.blocked) {
        setMessage(preview.reason === 'zone' ? '守军仅可放置在右侧蓝色守方区域' : '守军部队点位过近，请稍微错开');
        return;
      }
      const moved = moveDefenderDeployment(activeDefenderMoveId, preview);
      if (moved) {
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
      }
      return;
    }

    if (editMode && effectiveCanEdit) {
      const pickedDeployment = findDeploymentAtWorld(world);
      if (pickedDeployment) {
        setSelectedDeploymentId(pickedDeployment.deployId);
        setActiveDefenderMoveId('');
        setDefenderDragPreview(null);
        setSelectedWallId('');
        cancelGhostPlacement('');
        setSidebarTab('defender');
        const teamName = (typeof pickedDeployment?.name === 'string' && pickedDeployment.name.trim())
          ? pickedDeployment.name.trim()
          : '守军部队';
        setMessage(`已选中守军部队：${teamName}`);
        return;
      }
    }

    if (editMode && effectiveCanEdit) {
      const actionButton = findWallActionButton(point.x, point.y);
      if (actionButton) {
        if (actionButton.type === 'move') {
          const targetWall = walls.find((item) => item.id === actionButton.wallId);
          if (targetWall) startMoveWall(targetWall);
        } else if (actionButton.type === 'remove') {
          recycleWallToPalette(actionButton.wallId);
        }
        return;
      }
      const hasThreeCamera = !!threeRef.current?.camera;
      const pickedWall = pickWallFromScreenPoint(point.x, point.y)
        || (!hasThreeCamera
          ? findTopWallByScreenPoint({
            screenPoint: point,
            walls,
            viewport,
            cameraAngle,
            cameraYaw,
            worldScale
          })
          : null)
        || findTopWallAtPoint(world, walls, itemCatalogById);
      if (pickedWall) {
        setSelectedWallId(pickedWall.id);
        setSelectedDeploymentId('');
        setSidebarTab('items');
        cancelGhostPlacement('');
        const pickedItemName = itemCatalogById.get(pickedWall.itemId)?.name || '物品';
        setMessage(`已选中${pickedItemName}：点击头顶图标可移动或回收`);
        return;
      }
      if (selectedWallId) {
        setSelectedWallId('');
      }
      if (selectedDeploymentId) {
        setSelectedDeploymentId('');
      }
    }

    startPanDrag(event, point, 1);
  }, [
    activeDefenderMoveId,
    cameraAngle,
    cameraYaw,
    cameraYawRef,
    cancelGhostPlacement,
    canvasRef,
    defenderDeployments,
    editMode,
    effectiveCanEdit,
    fieldHeight,
    fieldWidth,
    findDefenderActionButton,
    findDeploymentAtWorld,
    findWallActionButton,
    getWorldFromScreenPoint,
    ghost,
    ghostBlocked,
    invalidReason,
    itemCatalogById,
    itemStockMetaMap,
    moveDefenderDeployment,
    mouseScreenRef,
    mouseWorldRef,
    open,
    pickWallFromScreenPoint,
    recycleWallToPalette,
    commitGhostWallPlacement,
    resolveDefenderMovePreview,
    resolveMouseSnapHint,
    rotateDragRef,
    selectedDeploymentId,
    selectedWallId,
    setActiveDefenderMoveId,
    setDefenderDragPreview,
    setGhost,
    setGhostBlocked,
    setInvalidReason,
    setIsRotating,
    setMessage,
    setSelectedDeploymentId,
    setSelectedWallId,
    setSidebarTab,
    setSnapState,
    snapState,
    spacePressedRef,
    startMoveWall,
    startPanDrag,
    threeRef,
    unplaceDefenderDeployment,
    viewport,
    walls,
    worldScale
  ]);

  const handleMouseMove = useCallback((event) => {
    if (!open) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;

    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    mouseScreenRef.current = { x: point.x, y: point.y, valid: true };
    const world = getWorldFromScreenPoint(point.x, point.y);
    mouseWorldRef.current = world;
    resolveMouseSnapHint(point.x, point.y);

    if (ghost) {
      if (!panDragRef.current && !rotateDragRef.current) {
        syncGhostByMouse(ghost);
      }
      return;
    }
    if (editMode && effectiveCanEdit && activeDefenderMoveId && !panDragRef.current && !rotateDragRef.current) {
      const preview = resolveDefenderMovePreview(activeDefenderMoveId, world);
      if (preview) {
        setDefenderDragPreview(preview);
      }
    }
  }, [
    activeDefenderMoveId,
    canvasRef,
    editMode,
    effectiveCanEdit,
    getWorldFromScreenPoint,
    ghost,
    mouseScreenRef,
    mouseWorldRef,
    open,
    panDragRef,
    resolveDefenderMovePreview,
    resolveMouseSnapHint,
    rotateDragRef,
    setDefenderDragPreview,
    syncGhostByMouse
  ]);

  const handleCanvasDoubleClick = useCallback((event) => {
    if (editMode || !effectiveCanEdit) return;
    event.preventDefault();
    event.stopPropagation();
    startLayoutEditing();
    setMessage('已通过双击战场进入布置模式');
  }, [editMode, effectiveCanEdit, setMessage, startLayoutEditing]);

  const handleCanvasDragOver = useCallback((event) => {
    if (!effectiveCanEdit || !editMode || sidebarTab !== 'defender') return;
    event.preventDefault();
    const deployId = event.dataTransfer?.getData('application/x-defender-deploy-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    if (!deployId) {
      setDefenderDragPreview(null);
      return;
    }
    setActiveDefenderMoveId(deployId);
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const world = getWorldFromScreenPoint(sx, sy);
    const nextX = Math.max(-fieldWidth / 2, Math.min(fieldWidth / 2, Number(world?.x) || 0));
    const nextY = Math.max(-fieldHeight / 2, Math.min(fieldHeight / 2, Number(world?.y) || 0));
    const blocked = (Number(world?.x) || 0) < defenderZoneMinX;
    setDefenderDragPreview({
      deployId,
      x: nextX,
      y: nextY,
      rotation: normalizeDefenderFacingDeg(
        (Array.isArray(defenderDeployments) ? defenderDeployments : []).find((item) => item?.deployId === deployId)?.rotation
      ),
      blocked
    });
  }, [
    canvasRef,
    defenderDeployments,
    defenderZoneMinX,
    editMode,
    effectiveCanEdit,
    fieldHeight,
    fieldWidth,
    getWorldFromScreenPoint,
    setActiveDefenderMoveId,
    setDefenderDragPreview,
    sidebarTab
  ]);

  const handleCanvasDragLeave = useCallback((event) => {
    if (event?.currentTarget !== event?.target) return;
    setDefenderDragPreview(null);
  }, [setDefenderDragPreview]);

  const handleCanvasDrop = useCallback((event) => {
    if (!effectiveCanEdit || !editMode || sidebarTab !== 'defender') return;
    event.preventDefault();
    const deployId = event.dataTransfer?.getData('application/x-defender-deploy-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    if (!deployId) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const world = getWorldFromScreenPoint(sx, sy);
    setSelectedDeploymentId(deployId);
    moveDefenderDeployment(deployId, world);
    setDefenderDragPreview(null);
  }, [
    canvasRef,
    editMode,
    effectiveCanEdit,
    getWorldFromScreenPoint,
    moveDefenderDeployment,
    setDefenderDragPreview,
    setSelectedDeploymentId,
    sidebarTab
  ]);

  useEffect(() => {
    if (!open) return undefined;
    const handleWindowMouseMove = (event) => {
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      if (rect) {
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        mouseScreenRef.current = { x: sx, y: sy, valid: true };
        if (ghost) {
          resolveMouseSnapHint(sx, sy);
        }
      }
      const rotateDrag = rotateDragRef.current;
      if (rotateDrag) {
        if ((event.buttons & 2) !== 2) {
          if (!rotateDrag.moved && ghost) {
            cancelGhostPlacement('已取消放置');
          }
          clearRotateDragging();
        } else {
          const dx = event.clientX - rotateDrag.startX;
          const nextYaw = normalizeDeg(rotateDrag.startYaw + (dx * CAMERA_ROTATE_SENSITIVITY));
          if (Math.abs(dx) >= CAMERA_ROTATE_CLICK_THRESHOLD) {
            rotateDrag.moved = true;
          }
          cameraYawRef.current = nextYaw;
          setCameraYaw(nextYaw);
        }
      }

      const drag = panDragRef.current;
      if (!drag) return;
      if ((event.buttons & drag.buttonMask) !== drag.buttonMask) {
        clearPanDragging();
        return;
      }
      const panRect = canvasRef.current?.getBoundingClientRect();
      if (!panRect) return;
      const sx = event.clientX - panRect.left;
      const sy = event.clientY - panRect.top;
      const world = getWorldFromScreenPoint(sx, sy);
      mouseWorldRef.current = world;
      const delta = getPanDeltaFromScreenPoints(
        { x: drag.startScreenX, y: drag.startScreenY },
        { x: sx, y: sy }
      );
      const nextPan = {
        x: drag.startPanX + delta.x,
        y: drag.startPanY + delta.y
      };
      panWorldRef.current = nextPan;
      setPanWorld(nextPan);
    };
    const handleWindowMouseUp = () => {
      const rotateDrag = rotateDragRef.current;
      if (rotateDrag && !rotateDrag.moved && ghost) {
        cancelGhostPlacement('已取消放置');
      }
      clearRotateDragging();
      clearPanDragging();
    };
    const handleWindowBlur = () => {
      clearRotateDragging();
      clearPanDragging();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    cancelGhostPlacement,
    cameraYawRef,
    canvasRef,
    clearPanDragging,
    clearRotateDragging,
    getPanDeltaFromScreenPoints,
    getWorldFromScreenPoint,
    ghost,
    mouseScreenRef,
    mouseWorldRef,
    open,
    panDragRef,
    panWorldRef,
    resolveMouseSnapHint,
    rotateDragRef,
    setCameraYaw,
    setPanWorld
  ]);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    const pointer = mouseScreenRef.current;
    if (pointer?.valid) {
      resolveMouseSnapHint(pointer.x, pointer.y);
    }
    if (!ghost && editMode && effectiveCanEdit) {
      const rotatingDeployId = activeDefenderMoveId || selectedDeploymentId;
      if (rotatingDeployId) {
        const delta = event.deltaY < 0 ? ROTATE_STEP : -ROTATE_STEP;
        let nextDeg = DEFENDER_DEFAULT_FACING_DEG;
        setDefenderDeployments((prev) => sanitizeDefenderDeployments(prev).map((item) => {
          if (item.deployId !== rotatingDeployId) return item;
          nextDeg = normalizeDefenderFacingDeg(item.rotation + delta);
          return { ...item, rotation: nextDeg };
        }));
        setDefenderDragPreview((prev) => (
          prev && prev.deployId === rotatingDeployId
            ? { ...prev, rotation: nextDeg }
            : prev
        ));
        setHasDraftChanges(true);
        setMessage(`守军朝向 ${Math.round(nextDeg)}°`);
        return;
      }
    }
    if (!ghost) {
      const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      animateZoomTo((zoomTargetRef.current || zoom) + delta);
      setMessage(`缩放 ${Math.round(zoomTargetRef.current * 100)}%`);
      return;
    }
    if (!effectiveCanEdit) return;

    const wheelDelta = event.deltaY < 0 ? ROTATE_STEP : -ROTATE_STEP;
    const hoveredAnchorId = getHintAnchorId(mouseSnapHintRef.current);
    const isSnappedToHoveredAnchor = (
      typeof snapState?.anchorId === 'string'
      && !!snapState.anchorId
      && snapState.anchorId === hoveredAnchorId
    );

    if (snapState?.type === 'pillar-face' && isSnappedToHoveredAnchor) {
      const nextMode = ghost?._pillarSnapMode === 'short' ? 'long' : 'short';
      const nextGhost = {
        ...ghost,
        _pillarSnapMode: nextMode
      };
      const evaluated = evaluateGhostPlacement(
        nextGhost,
        walls,
        mouseWorldRef.current,
        fieldWidth,
        fieldHeight,
        itemCatalogById,
        mouseSnapHintRef.current
      );
      setGhost(evaluated.ghost);
      setGhostBlocked(evaluated.blocked);
      setSnapState(evaluated.snap);
      setInvalidReason(evaluated.reason || '');
      setMessage(nextMode === 'long' ? '木制梁吸附模式：长端贴面（可沿面左右移动）' : '木制梁吸附模式：短端贴面');
      return;
    }

    const lockRotation = snapState?.type === 'top';
    if (lockRotation) {
      const anchor = walls.find((item) => item.id === snapState?.anchorId);
      if (anchor) {
        setGhost((prevGhost) => (
          prevGhost
            ? { ...prevGhost, rotation: anchor.rotation }
            : prevGhost
        ));
      }
      return;
    }

    if (isSnappedToHoveredAnchor && snapState?.type && snapState.type !== 'top') {
      const maxProbeCount = Math.max(1, Math.round(360 / Math.max(0.1, Math.abs(wheelDelta))));
      let probeGhost = { ...ghost };
      let matched = null;
      for (let i = 0; i < maxProbeCount; i += 1) {
        probeGhost = {
          ...probeGhost,
          rotation: normalizeDeg((Number(probeGhost?.rotation) || 0) + wheelDelta)
        };
        const evaluated = evaluateGhostPlacement(
          probeGhost,
          walls,
          mouseWorldRef.current,
          fieldWidth,
          fieldHeight,
          itemCatalogById,
          mouseSnapHintRef.current
        );
        const nextAnchorId = getHintAnchorId(mouseSnapHintRef.current);
        if (!nextAnchorId || nextAnchorId !== snapState.anchorId) break;
        if (
          evaluated?.snap
          && evaluated.snap.anchorId === snapState.anchorId
          && evaluated.snap.type !== 'top'
        ) {
          matched = evaluated;
          break;
        }
      }
      if (matched) {
        setGhost(matched.ghost);
        setGhostBlocked(matched.blocked);
        setSnapState(matched.snap);
        setInvalidReason(matched.reason || '');
        setMessage(`吸附转向 ${Math.round(Number(matched?.ghost?.rotation) || 0)}°`);
        return;
      }
      setMessage('当前吸附面没有可用转向');
      return;
    }

    setGhost((prevGhost) => (
      prevGhost
        ? { ...prevGhost, rotation: normalizeDeg((Number(prevGhost?.rotation) || 0) + wheelDelta) }
        : prevGhost
    ));
  }, [
    activeDefenderMoveId,
    animateZoomTo,
    editMode,
    effectiveCanEdit,
    fieldHeight,
    fieldWidth,
    ghost,
    itemCatalogById,
    mouseScreenRef,
    mouseSnapHintRef,
    mouseWorldRef,
    resolveMouseSnapHint,
    selectedDeploymentId,
    setDefenderDeployments,
    setDefenderDragPreview,
    setGhost,
    setGhostBlocked,
    setHasDraftChanges,
    setInvalidReason,
    setMessage,
    setSnapState,
    snapState,
    walls,
    zoom,
    zoomTargetRef
  ]);

  useEffect(() => {
    if (!ghost) return;
    const pointer = mouseScreenRef.current;
    if (pointer?.valid) {
      resolveMouseSnapHint(pointer.x, pointer.y);
    }
    syncGhostByMouse(ghost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldHeight, fieldWidth, ghost?.rotation, walls, cameraAngle, cameraYaw, resolveMouseSnapHint]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleCanvasDoubleClick,
    handleCanvasDragOver,
    handleCanvasDragLeave,
    handleCanvasDrop,
    handleWheel
  };
};

export default useBattlefieldInteractions;
