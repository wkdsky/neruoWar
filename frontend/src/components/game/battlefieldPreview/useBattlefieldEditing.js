import { useCallback, useEffect } from 'react';
import {
  CAMERA_ANGLE_EDIT,
  CAMERA_ANGLE_PREVIEW,
  PALETTE_WALL_TEMPLATE,
  cloneWalls,
  createWallFromLike,
  sanitizeDefenderDeployments
} from './battlefieldShared';
import {
  evaluateGhostPlacement,
  isWoodPlankItem,
  isBushItem
} from './battlefieldPlacementUtils';
import { collectCascadeRemovedWallIds } from './battlefieldConnectivityUtils';

const useBattlefieldEditing = ({
  selectedWallId = '',
  editMode = false,
  effectiveCanEdit = false,
  hasDraftChanges = false,
  walls = [],
  defenderDeployments = [],
  normalizedItemCatalog = [],
  itemStockMetaMap,
  itemCatalogById,
  fieldWidth,
  fieldHeight,
  refs,
  setters,
  callbacks
}) => {
  const {
    mouseWorldRef,
    mouseSnapHintRef,
    editSessionWallsRef,
    editSessionDefenderDeploymentsRef,
    resetDefenderUiRef
  } = refs;
  const {
    setMessage,
    setSelectedDeploymentId,
    setSelectedWallId,
    setSidebarTab,
    setSelectedPaletteItem,
    setGhost,
    setGhostBlocked,
    setSnapState,
    setInvalidReason,
    setHasDraftChanges,
    setEditMode,
    setDefenderDeployments,
    setWallsWithRecompute
  } = setters;
  const {
    cancelGhostPlacement,
    animateCameraAngle,
    persistBattlefieldLayout
  } = callbacks;

  const pickPaletteItem = useCallback((itemId) => {
    if (!effectiveCanEdit || !editMode) return;
    if (!itemId) return;
    const itemDef = normalizedItemCatalog.find((item) => item.itemId === itemId) || null;
    if (!itemDef) return;
    const remaining = itemStockMetaMap.get(itemId)?.remaining ?? 0;
    if (remaining <= 0) {
      setMessage(`物品「${itemDef.name || itemId}」库存不足，无法继续放置`);
      return;
    }
    const nextGhost = createWallFromLike(PALETTE_WALL_TEMPLATE, {
      itemId,
      width: itemDef.width,
      depth: itemDef.depth,
      height: itemDef.height,
      hp: itemDef.hp,
      defense: itemDef.defense,
      maxStack: itemDef.maxStack,
      baseHp: itemDef.hp,
      baseDefense: itemDef.defense,
      baseMaxStack: itemDef.maxStack,
      mergeCount: 1,
      id: '',
      x: mouseWorldRef.current.x,
      y: mouseWorldRef.current.y,
      z: 0,
      rotation: 0
    });
    if (isWoodPlankItem(itemDef)) {
      nextGhost._pillarSnapMode = 'long';
    }
    const evaluated = evaluateGhostPlacement(
      nextGhost,
      walls,
      mouseWorldRef.current,
      fieldWidth,
      fieldHeight,
      itemCatalogById,
      mouseSnapHintRef.current
    );
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setSidebarTab('items');
    setSelectedPaletteItem(itemId);
    setGhost({
      ...evaluated.ghost,
      _mode: 'create'
    });
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    if (isWoodPlankItem(itemDef)) {
      setMessage(`已选中${itemDef.name || '物品'}：左键放置，右键或 ESC 取消，靠近立柱可吸附，滚轮切换长端/短端贴面，Space+左键平移`);
    } else if (isBushItem(itemDef)) {
      setMessage(`已选中${itemDef.name || '草丛'}：左键放置，右键或 ESC 取消；绿色半球罩及地面圆环为隐身范围`);
    } else {
      setMessage(`已选中${itemDef.name || '物品'}：左键放置，右键或 ESC 取消，滚轮旋转，Space+左键平移`);
    }
  }, [
    editMode,
    effectiveCanEdit,
    fieldHeight,
    fieldWidth,
    itemCatalogById,
    itemStockMetaMap,
    mouseSnapHintRef,
    mouseWorldRef,
    normalizedItemCatalog,
    setGhost,
    setGhostBlocked,
    setInvalidReason,
    setMessage,
    setSelectedDeploymentId,
    setSelectedPaletteItem,
    setSelectedWallId,
    setSidebarTab,
    setSnapState,
    walls
  ]);

  const startMoveWall = useCallback((wallLike) => {
    if (!wallLike) return;
    const moveItemDef = itemCatalogById.get(typeof wallLike?.itemId === 'string' ? wallLike.itemId : '') || null;
    const sourceId = typeof wallLike?.id === 'string' ? wallLike.id : '';
    const moveGhostId = sourceId
      ? `moving_${sourceId}_${Date.now().toString(36)}`
      : `moving_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const movingGhostSeed = {
      ...createWallFromLike(wallLike, { id: moveGhostId }),
      _pillarSnapMode: isWoodPlankItem(moveItemDef) ? 'long' : undefined,
      _mode: 'move',
      _sourceId: sourceId
    };
    const evaluated = evaluateGhostPlacement(
      movingGhostSeed,
      walls,
      mouseWorldRef.current,
      fieldWidth,
      fieldHeight,
      itemCatalogById,
      mouseSnapHintRef.current
    );
    setGhost({ ...evaluated.ghost, _mode: 'move', _sourceId: wallLike.id });
    setGhostBlocked(evaluated.blocked);
    setSnapState(evaluated.snap);
    setInvalidReason(evaluated.reason || '');
    setSelectedWallId('');
    setSelectedDeploymentId('');
    setSelectedPaletteItem(wallLike.itemId || '');
    setMessage('移动模式：左键确认位置，右键或 ESC 取消');
  }, [
    fieldHeight,
    fieldWidth,
    itemCatalogById,
    mouseSnapHintRef,
    mouseWorldRef,
    setGhost,
    setGhostBlocked,
    setInvalidReason,
    setMessage,
    setSelectedDeploymentId,
    setSelectedPaletteItem,
    setSelectedWallId,
    setSnapState,
    walls
  ]);

  const recycleWallToPalette = useCallback((wallId) => {
    if (!wallId) return;
    let removedCount = 1;
    setWallsWithRecompute((prev) => {
      const removedIds = collectCascadeRemovedWallIds(wallId, prev);
      removedCount = Math.max(1, removedIds.size || 1);
      return prev.filter((item) => !removedIds.has(item.id));
    });
    setHasDraftChanges(true);
    setSelectedWallId('');
    setSelectedDeploymentId('');
    cancelGhostPlacement('');
    setMessage(removedCount > 1
      ? `已回收 ${removedCount} 个物品（含上层失去支撑物品）`
      : '物品已回收到物品栏');
  }, [
    cancelGhostPlacement,
    setHasDraftChanges,
    setMessage,
    setSelectedDeploymentId,
    setSelectedWallId,
    setWallsWithRecompute
  ]);

  const startLayoutEditing = useCallback(() => {
    if (!effectiveCanEdit) return;
    editSessionWallsRef.current = cloneWalls(walls);
    editSessionDefenderDeploymentsRef.current = sanitizeDefenderDeployments(defenderDeployments);
    setHasDraftChanges(false);
    setEditMode(true);
    setSidebarTab('items');
    resetDefenderUiRef.current();
    setSelectedWallId('');
    animateCameraAngle(CAMERA_ANGLE_EDIT);
    cancelGhostPlacement('');
    setMessage('布置模式已开启：完成后请点击“保存布置”');
  }, [
    animateCameraAngle,
    cancelGhostPlacement,
    defenderDeployments,
    editSessionDefenderDeploymentsRef,
    editSessionWallsRef,
    effectiveCanEdit,
    resetDefenderUiRef,
    setEditMode,
    setHasDraftChanges,
    setMessage,
    setSelectedWallId,
    setSidebarTab,
    walls
  ]);

  const cancelLayoutEditing = useCallback(() => {
    const snapshotWalls = editSessionWallsRef.current;
    const snapshotDeployments = editSessionDefenderDeploymentsRef.current;
    if (Array.isArray(snapshotWalls)) {
      setWallsWithRecompute(cloneWalls(snapshotWalls));
    }
    if (Array.isArray(snapshotDeployments)) {
      setDefenderDeployments(sanitizeDefenderDeployments(snapshotDeployments));
    }
    editSessionWallsRef.current = null;
    editSessionDefenderDeploymentsRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    resetDefenderUiRef.current();
    setSelectedWallId('');
    animateCameraAngle(CAMERA_ANGLE_PREVIEW);
    cancelGhostPlacement('');
    setMessage('已取消布置，已恢复到上一次战场布置状态');
  }, [
    animateCameraAngle,
    cancelGhostPlacement,
    editSessionDefenderDeploymentsRef,
    editSessionWallsRef,
    resetDefenderUiRef,
    setDefenderDeployments,
    setEditMode,
    setHasDraftChanges,
    setMessage,
    setSelectedWallId,
    setWallsWithRecompute
  ]);

  const saveLayoutEditing = useCallback(async () => {
    if (!effectiveCanEdit) return;
    cancelGhostPlacement('');
    if (!hasDraftChanges) {
      editSessionWallsRef.current = null;
      editSessionDefenderDeploymentsRef.current = null;
      setEditMode(false);
      resetDefenderUiRef.current();
      setSelectedWallId('');
      animateCameraAngle(CAMERA_ANGLE_PREVIEW);
      setMessage('布置内容无变化');
      return;
    }
    const result = await persistBattlefieldLayout(walls, { silent: false });
    if (!result?.ok) return;
    editSessionWallsRef.current = null;
    editSessionDefenderDeploymentsRef.current = null;
    setHasDraftChanges(false);
    setEditMode(false);
    resetDefenderUiRef.current();
    setSelectedWallId('');
    animateCameraAngle(CAMERA_ANGLE_PREVIEW);
  }, [
    animateCameraAngle,
    cancelGhostPlacement,
    editSessionDefenderDeploymentsRef,
    editSessionWallsRef,
    effectiveCanEdit,
    hasDraftChanges,
    persistBattlefieldLayout,
    resetDefenderUiRef,
    setEditMode,
    setHasDraftChanges,
    setMessage,
    setSelectedWallId,
    walls
  ]);

  useEffect(() => {
    if (!selectedWallId) return;
    const exists = walls.some((item) => item.id === selectedWallId);
    if (!exists) setSelectedWallId('');
  }, [selectedWallId, setSelectedWallId, walls]);

  return {
    pickPaletteItem,
    startMoveWall,
    recycleWallToPalette,
    startLayoutEditing,
    cancelLayoutEditing,
    saveLayoutEditing
  };
};

export default useBattlefieldEditing;
