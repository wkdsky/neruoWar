import {
  CITY_CHANNEL_TILE_TYPES,
  CITY_CHANNEL_TOOLS,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  normalizeRotation,
  wallEdgeToRotation
} from '../cityChannelSchema';
import { preserveGearMountsForReplacementPlacement } from '../cityChannelEditorMutations';
import {
  canSelectBoardPlacement,
  canSelectComponentPlacement
} from '../cityChannelSelectionRules';
import {
  drawMechanicalLayers,
  handleMechanicalPortHit
} from './cityChannelMechanicalSystems';
import { getGearInstallTargetForScene } from './cityChannelGears';
import { getSnapAxisKey } from './cityChannelVerticalSnap';
import {
  DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION,
  normalizeGearRotationDirection
} from '../cityChannelMechanismRuntime';
import {
  GEAR_COMPONENT_TYPE,
  createWallSelectionKey,
  sameCell
} from './cityChannelPhaserSceneUtils';

export const beginPaint = (scene, pointer, hitInfo) => {
  if (scene.activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && scene.activeComponentType === GEAR_COMPONENT_TYPE) {
    scene.paintStroke = {
      intent: 'place',
      isComponent: true,
      touched: new Set(),
      operations: [],
      label: '安装齿轮'
    };
    scene.dragState = {
      mode: 'paint',
      startX: pointer.x,
      startY: pointer.y,
      moved: false
    };
    applyPaint(scene, pointer, hitInfo);
    return;
  }
  const placementSnap = scene.resolvePlacementEdgeSnap(hitInfo);
  const snapAxisKey = getSnapAxisKey(placementSnap);
  if (snapAxisKey !== scene.activeSnapAxisKey) {
    scene.activeSnapAxisKey = snapAxisKey;
    scene.snapPlaneCycle = snapAxisKey
      ? scene.getPreferredAxisPlacementIndex(scene.getAxisPlacementOptions(placementSnap))
      : 0;
  }
  const placementTarget = scene.resolveDynamicPlacementTarget(hitInfo, { snap: placementSnap, allowReplacement: true });
  if (placementTarget?.valid === false) return;
  const isWall = placementTarget?.kind === 'wall';
  const cell = placementTarget?.cell;
  if (!cell) return;
  scene.paintStroke = {
    intent: 'place',
    isWall,
    touched: new Set(),
    operations: []
  };
  scene.dragState = {
    mode: 'paint',
    startX: pointer.x,
    startY: pointer.y,
    moved: false
  };
  applyPaint(scene, pointer, hitInfo);
};

export const applyPaint = (scene, pointer, suppliedHitInfo = null) => {
  if (!scene.paintStroke) return;
  const hitInfo = suppliedHitInfo || scene.hitTest(pointer, { allowOutline: true });
  if (scene.paintStroke.isComponent) {
    const target = getGearInstallTargetForScene(scene, hitInfo);
    if (!target?.valid) {
      scene.drawGhostLayer();
      return;
    }
    const key = `${target.hostKey}:${target.surface}:${target.socket}`;
    if (scene.paintStroke.touched.has(key)) {
      scene.drawGhostLayer();
      return;
    }
    scene.paintStroke.touched.add(key);
    const mount = {
      id: `gear_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      componentType: GEAR_COMPONENT_TYPE,
      position: target.socket,
      socketKind: target.socketKind,
      surface: target.surface,
      axisBinding: null,
      followMode: 'none',
      followDelaySeconds: 0,
      rotationDirection: normalizeGearRotationDirection(
        scene.config?.defaultGearRotationDirection || DEFAULT_CITY_CHANNEL_GEAR_ROTATION_DIRECTION
      ),
      radius: 1,
      teeth: 12,
      phase: 0
    };
    scene.paintStroke.operations.push({
      kind: 'gearMount',
      action: 'place',
      hostKind: target.hostKind,
      hostKey: target.hostKey,
      cell: target.cell,
      edge: target.edge,
      mount
    });
    scene.pendingGearAxisPrompt = null;
    const hostMap = target.hostKind === 'wall' ? scene.mapData.walls : scene.mapData.tiles;
    const host = hostMap?.[target.hostKey];
    if (host) {
      host.gearMounts = [...(host.gearMounts || []), mount];
      if (target.hostKind === 'wall') scene.renderWallObject(host);
      else scene.renderTileObject(host);
      drawMechanicalLayers(scene);
    }
    scene.setSelection?.([], [], [{
      hostKind: target.hostKind,
      hostKey: target.hostKey,
      mountId: mount.id,
      cell: target.cell,
      edge: target.edge || null
    }], 'component', { lockExternalSync: true });
    scene.refreshAfterIncrementalEdit();
    scene.drawGhostLayer(true);
    return;
  }

  const placementSnap = scene.resolvePlacementEdgeSnap(hitInfo);
  const snapAxisKey = getSnapAxisKey(placementSnap);
  if (snapAxisKey !== scene.activeSnapAxisKey) {
    scene.activeSnapAxisKey = snapAxisKey;
    scene.snapPlaneCycle = snapAxisKey
      ? scene.getPreferredAxisPlacementIndex(scene.getAxisPlacementOptions(placementSnap))
      : 0;
  }
  const placementTarget = scene.resolveDynamicPlacementTarget(hitInfo, { snap: placementSnap, allowReplacement: true });
  const isWall = placementTarget?.kind === 'wall';
  const cell = placementTarget?.cell;
  if (!cell) {
    scene.drawGhostLayer();
    return;
  }
  if (placementTarget?.valid === false) {
    scene.drawGhostLayer();
    return;
  }
  const edge = isWall ? placementTarget?.edge : null;
  const key = isWall ? `${createCellKey(cell.x, cell.y, cell.z)}:${edge}` : createCellKey(cell.x, cell.y, cell.z);
  if (scene.paintStroke.touched.has(key)) {
    scene.drawGhostLayer();
    return;
  }

  if (isWall) {
    applyWallPaint(scene, cell, edge, placementTarget);
  } else if (scene.activeTileType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || scene.activeTileType === CITY_CHANNEL_TILE_TYPES.EXIT) {
    applyMarkerTilePaint(scene, cell, key);
  } else {
    applyTilePaint(scene, cell, key);
  }
  scene.refreshAfterIncrementalEdit();
  scene.drawGhostLayer();
};

const applyWallPaint = (scene, cell, edge, placementTarget) => {
  const key = `${createCellKey(cell.x, cell.y, cell.z)}:${edge}`;
  if (placementTarget?.valid !== true && !scene.hasWallSupport(cell, edge)) {
    scene.drawGhostLayer();
    return;
  }
  scene.paintStroke.touched.add(key);
  const wallKey = createWallKey(cell.x, cell.y, cell.z, edge);
  const existing = scene.mapData.walls?.[wallKey];
  const nextTransmissionRotation = normalizeRotation(scene.activeRotation);
  const existingTransmissionRotation = normalizeRotation(
    existing?.transmissionRotation
      ?? existing?.rotation
      ?? wallEdgeToRotation(edge)
  );
  const shouldReplaceWall = !existing
    || existing.panelType !== scene.activeTileType
    || existingTransmissionRotation !== nextTransmissionRotation;
  if (scene.paintStroke.intent === 'erase') {
    if (existing) scene.paintStroke.operations.push({ kind: 'wall', action: 'erase', cell, edge });
    delete scene.mapData.walls[wallKey];
    scene.removeWallObject({ ...cell, edge });
  } else if (shouldReplaceWall) {
    const legacyVerticalKey = createCellKey(cell.x, cell.y, cell.z);
    const legacyVerticalTile = scene.mapData.tiles?.[legacyVerticalKey];
    if (legacyVerticalTile?.isVertical) {
      delete scene.mapData.tiles[legacyVerticalKey];
      scene.removeTileObject(cell);
    }
    const wall = createWall({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      edge,
      panelType: scene.activeTileType,
      transmissionRotation: scene.activeRotation
    });
    const preservedGearMounts = Array.isArray(existing?.gearMounts) && existing.gearMounts.length > 0
      ? preserveGearMountsForReplacementPlacement({
        fromPlacement: existing,
        toPlacement: wall
      })
      : (Array.isArray(legacyVerticalTile?.gearMounts) && legacyVerticalTile.gearMounts.length > 0
        ? preserveGearMountsForReplacementPlacement({
          fromPlacement: legacyVerticalTile,
          toPlacement: wall
        })
        : null);
    if (Array.isArray(preservedGearMounts) && preservedGearMounts.length > 0) {
      wall.gearMounts = preservedGearMounts;
    }
    scene.paintStroke.operations.push({
      kind: 'wall',
      action: 'place',
      cell,
      edge,
      panelType: scene.activeTileType,
      transmissionRotation: scene.activeRotation
    });
    scene.mapData.walls[wallKey] = wall;
    scene.renderWallObject(wall);
  }
};

const applyMarkerTilePaint = (scene, cell, key) => {
  scene.paintStroke.touched.add(key);
  const tileKey = createCellKey(cell.x, cell.y, cell.z);
  const existing = scene.mapData.tiles?.[tileKey];
  if (scene.paintStroke.intent === 'erase') {
    if (existing?.panelType === scene.activeTileType) scene.paintStroke.operations.push({ kind: 'tile', action: 'erase', cell });
    delete scene.mapData.tiles[tileKey];
    scene.removeTileObject(cell);
    return;
  }
  const marker = scene.activeTileType === CITY_CHANNEL_TILE_TYPES.ENTRANCE ? 'entrance' : 'exit';
  Object.values(scene.mapData.tiles || {}).forEach((tile) => {
    if (tile.marker !== marker && tile.panelType !== scene.activeTileType) return;
    const oldKey = createCellKey(tile.x, tile.y, tile.z);
    const floor = createTile({
      x: tile.x,
      y: tile.y,
      z: tile.z,
      panelType: CITY_CHANNEL_TILE_TYPES.BASIC_PLATE,
      rotation: tile.rotation || 0
    });
    scene.mapData.tiles[oldKey] = floor;
    scene.renderTileObject(floor);
  });
  const tile = createTile({
    x: cell.x,
    y: cell.y,
    z: cell.z,
    panelType: scene.activeTileType,
    rotation: scene.activeRotation
  });
  scene.paintStroke.operations.push({
    kind: 'tile',
    action: 'place',
    cell,
    panelType: scene.activeTileType,
    rotation: scene.activeRotation,
    transmissionRotation: scene.activeRotation
  });
  scene.mapData.tiles[tileKey] = tile;
  scene.renderTileObject(tile);
};

const applyTilePaint = (scene, cell, key) => {
  scene.paintStroke.touched.add(key);
  const tileKey = createCellKey(cell.x, cell.y, cell.z);
  const existing = scene.mapData.tiles?.[tileKey];
  const nextRotation = normalizeRotation(scene.activeRotation);
  const existingRotation = normalizeRotation(existing?.rotation || 0);
  const existingTransmissionRotation = normalizeRotation(
    existing?.transmissionRotation
      ?? existing?.rotation
      ?? 0
  );
  const shouldReplaceTile = !existing
    || existing.panelType !== scene.activeTileType
    || existingRotation !== nextRotation
    || existingTransmissionRotation !== nextRotation;
  if (scene.paintStroke.intent === 'erase') {
    if (existing?.panelType === scene.activeTileType) scene.paintStroke.operations.push({ kind: 'tile', action: 'erase', cell });
    delete scene.mapData.tiles[tileKey];
    scene.removeTileObject(cell);
  } else if (shouldReplaceTile) {
    const existingGearMounts = Array.isArray(existing?.gearMounts) && existing.gearMounts.length > 0
      ? existing.gearMounts
      : null;
    const tile = createTile({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      panelType: scene.activeTileType,
      rotation: scene.activeRotation
    });
    if (existingGearMounts) {
      tile.gearMounts = preserveGearMountsForReplacementPlacement({
        fromPlacement: existing,
        toPlacement: tile,
        gearMounts: existingGearMounts
      });
    }
    scene.paintStroke.operations.push({
      kind: 'tile',
      action: 'place',
      cell,
      panelType: scene.activeTileType,
      rotation: scene.activeRotation,
      transmissionRotation: scene.activeRotation
    });
    scene.mapData.tiles[tileKey] = tile;
    scene.renderTileObject(tile);
  }
};

export const commitPaint = (scene) => {
  const operations = scene.paintStroke?.operations || [];
  const label = scene.paintStroke?.label || '批量建造';
  const gearAxisPrompt = scene.pendingGearAxisPrompt;
  scene.pendingGearAxisPrompt = null;
  scene.paintStroke = null;
  if (operations.length > 0) {
    if (typeof scene.config?.onCommitOperations === 'function') {
      if (typeof scene.markLocalMapEchoPending === 'function') scene.markLocalMapEchoPending();
      else scene.skipMapDataRenderCount += 1;
    }
    scene.scheduleReactCommit(operations, { label });
    if (gearAxisPrompt) {
      if (typeof window !== 'undefined') {
        window.setTimeout(() => scene.config.onGearAxisPrompt?.(gearAxisPrompt), 0);
      } else {
        scene.config.onGearAxisPrompt?.(gearAxisPrompt);
      }
    }
  }
  scene.drawGhostLayer();
};

export const eraseHit = (scene, hitInfo) => {
  const operations = [];
  if (hitInfo.hit?.type === 'wall') {
    operations.push({ kind: 'wall', action: 'erase', cell: hitInfo.hit.cell, edge: hitInfo.hit.edge });
  } else if (hitInfo.hit?.type === 'tile') {
    operations.push({ kind: 'tile', action: 'erase', cell: hitInfo.hit.cell });
  }
  if (operations.length) scene.config.onCommitOperations?.(operations, { label: '擦除' });
};

export const toggleGearAxisBinding = (scene, hit) => {
  if (!hit?.hostKey || !hit?.mountId || !hit?.candidate) return false;
  const host = hit.hostKind === 'wall' ? scene.mapData.walls?.[hit.hostKey] : scene.mapData.tiles?.[hit.hostKey];
  if (!host) return false;
  const mount = (host.gearMounts || []).find((item) => item.id === hit.mountId);
  if (!mount) return false;
  const current = mount.axisBinding || null;
  const candidate = hit.candidate;
  const sameBinding = current
    && current.componentKey === candidate.componentKey
    && current.socket === candidate.socket
    && (current.surface || 'front') === (candidate.surface || 'front');
  const nextBinding = sameBinding
    ? null
    : {
      componentKey: candidate.componentKey,
      hostKind: candidate.hostKind || 'tile',
      socket: candidate.socket,
      surface: candidate.surface || 'front'
    };
  const placementRef = hit.hostKind === 'wall'
    ? { ...hit.cell, edge: hit.edge || host.edge || 'north' }
    : { x: host.x, y: host.y, z: host.z };
  if (typeof scene.config?.onCommitOperations === 'function') {
    if (typeof scene.markLocalMapEchoPending === 'function') scene.markLocalMapEchoPending();
    else scene.skipMapDataRenderCount = (scene.skipMapDataRenderCount || 0) + 1;
  }
  scene.config.onCommitOperations?.([{
    kind: 'gearMount',
    action: 'erase',
    hostKind: hit.hostKind,
    hostKey: hit.hostKey,
    mount
  }, {
    kind: 'gearMount',
    action: 'place',
    hostKind: hit.hostKind,
    hostKey: hit.hostKey,
    cell: placementRef,
    edge: hit.edge || host.edge || null,
    mount: {
      ...mount,
      socketKind: mount.socketKind || 'corner',
      axisBinding: nextBinding,
      followMode: 'none',
      followDelaySeconds: 0
    }
  }], { label: nextBinding ? '绑定连轴板材' : '取消连轴板材' });
  mount.axisBinding = nextBinding;
  scene.playGearBindingConfirmPulse?.(hit, nextBinding);
  scene.redrawMountedGearHostLayers(hit.hostKind, hit.hostKey, host);
  scene.drawGearBindingCandidates?.();
  scene.config.onToast?.(nextBinding ? '已绑定连轴板材。' : '已取消连轴板材。', 'success');
  return true;
};

export const selectHit = (scene, hit, additive = false) => {
  if (hit.type === 'gearBindingCandidate') {
    toggleGearAxisBinding(scene, hit);
    return;
  }
  if (hit.type === 'mechanical_port') {
    handleMechanicalPortHit({ scene, hit });
    return;
  }
  if (hit.type === 'gear') {
    selectGearHit(scene, hit, additive);
    return;
  }
  if (hit.type === 'wall') {
    selectWallHit(scene, hit, additive);
    return;
  }
  selectTileHit(scene, hit, additive);
};

const selectGearHit = (scene, hit, additive = false) => {
  if (!canSelectComponentPlacement(scene.selectionScope, additive)) return;
  const gear = {
    hostKind: hit.hostKind,
    hostKey: hit.hostKey,
    mountId: hit.mount?.id,
    cell: hit.cell,
    edge: hit.edge || null
  };
  let nextGears = additive ? [...scene.selectedGears] : [];
  const key = `${gear.hostKey}:${gear.mountId}`;
  if (additive && nextGears.some((item) => `${item.hostKey}:${item.mountId}` === key)) {
    nextGears = nextGears.filter((item) => `${item.hostKey}:${item.mountId}` !== key);
  } else {
    nextGears.push(gear);
  }
  setSelection(scene, [], [], nextGears, 'component');
  scene.config.onMechanismPanelRequest?.(null);
};

const selectWallHit = (scene, hit, additive = false) => {
  if (!canSelectBoardPlacement(scene.selectionScope, additive)) return;
  const wall = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z, edge: hit.edge };
  let nextWalls = additive ? [...scene.selectedWalls] : [];
  const key = createWallSelectionKey(wall);
  if (additive && nextWalls.some((item) => createWallSelectionKey(item) === key)) {
    nextWalls = nextWalls.filter((item) => createWallSelectionKey(item) !== key);
  } else {
    nextWalls.push(wall);
  }
  setSelection(scene, additive ? scene.selectedCells : [], nextWalls, [], 'board');
  if (!additive && nextWalls.length === 1) {
    scene.requestMechanismPanel(hit);
  } else {
    scene.config.onMechanismPanelRequest?.(null);
  }
};

const selectTileHit = (scene, hit, additive = false) => {
  if (!canSelectBoardPlacement(scene.selectionScope, additive)) return;
  const cell = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z };
  let nextCells = additive ? [...scene.selectedCells] : [];
  const key = createCellKey(cell.x, cell.y, cell.z);
  if (additive && nextCells.some((item) => createCellKey(item.x, item.y, item.z) === key)) {
    nextCells = nextCells.filter((item) => createCellKey(item.x, item.y, item.z) !== key);
  } else {
    nextCells.push(cell);
  }
  setSelection(scene, nextCells, additive ? scene.selectedWalls : [], [], 'board');
  if (!additive && nextCells.length === 1) {
    scene.requestMechanismPanel(hit);
  } else {
    scene.config.onMechanismPanelRequest?.(null);
  }
};

export const setSelection = (scene, cells, walls, gears = [], scope = null, { lockExternalSync = false } = {}) => {
  scene.selectedCells = cells;
  scene.selectedWalls = walls;
  scene.selectedGears = gears;
  scene.selectionScope = scope || (gears.length ? 'component' : (cells.length || walls.length) ? 'board' : null);
  if (lockExternalSync) {
    scene.selectionSyncLock = {
      cells: new Set(cells.map((cell) => createCellKey(cell.x, cell.y, cell.z))),
      walls: new Set(walls.map(createWallSelectionKey)),
      gears: new Set(gears.map((gear) => `${gear.hostKey}:${gear.mountId}`)),
      scope: scene.selectionScope,
      expiresAt: Date.now() + 1000
    };
  }
  scene.config.onSelectionChange?.({ cells, walls, gears, scope: scene.selectionScope });
  applySelectionScopeVisualState(scene);
  scene.drawSelectionLayer();
  scene.drawGearBindingCandidates?.();
  scene.refreshMechanismVisuals();
};

export const applySelectionScopeVisualState = (scene) => {
  const componentMode = scene.selectionScope === 'component';
  scene.renderObjects.forEach((object, key) => {
    if (key.startsWith('tile:') || key.startsWith('wall:')) {
      object.setAlpha?.(componentMode ? 0.46 : 1);
      object.setTint?.(componentMode ? 0x94a3b8 : 0xffffff);
      if (!componentMode) object.clearTint?.();
    }
  });
};

export const isSelectedHit = (scene, hit) => {
  if (!hit) return false;
  if (hit.type === 'gear') {
    return scene.selectedGears.some((gear) => gear.hostKey === hit.hostKey && gear.mountId === hit.mount?.id);
  }
  if (hit.type === 'wall') {
    return scene.selectedWalls.some((wall) => createWallSelectionKey(wall) === createWallSelectionKey({
      x: hit.cell.x,
      y: hit.cell.y,
      z: hit.cell.z,
      edge: hit.edge
    }));
  }
  return scene.selectedCells.some((cell) => sameCell(cell, hit.cell));
};
