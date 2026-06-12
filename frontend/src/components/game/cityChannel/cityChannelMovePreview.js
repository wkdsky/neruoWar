import {
  cloneGearMounts,
  createCellKey,
  createTile,
  createWall,
  createWallKey,
  isValidCell,
  normalizeRotation
} from './cityChannelSchema';
import { getGearSocketWorldPosition } from './cityChannelMechanismRuntime';
import { isGearPointOnAnyRack } from './cityChannelRackModel';
import {
  boxSetsIntersect,
  getCityChannelPlacementCollisionBoxes,
  isSupportCollisionExempt
} from './cityChannelPlacementGeometry';
import {
  buildSelectionComponents,
  createComponentResult,
  createWallSelectionKey,
  getMovingPlacementKey,
  getSelectionAnchor,
  getSelectionPlacement,
  getSelectionPlacementKey,
  markComponentPlacementInvalid
} from './cityChannelMoveSelectionGraph';
import {
  createPlacementTargetCell,
  createRigidTransform,
  getEdgeCenterOffset,
  getPlacementRigidPoint,
  getPlacementShapeRotation,
  getPlacementTargetShape,
  getRotationSteps
} from './cityChannelMoveTransform';

const createCollisionEntry = ({ placement, key, origin = null, moving = false }) => ({
  key,
  placement,
  origin,
  moving,
  boxes: getCityChannelPlacementCollisionBoxes(placement)
});

const addConflict = (state, reason, to, edge = null) => {
  if (!to) return;
  const conflictEdge = edge ?? to.edge ?? null;
  const placementKey = conflictEdge
    ? createWallKey(to.x, to.y, to.z, conflictEdge)
    : createCellKey(to.x, to.y, to.z);
  const key = `${placementKey}:${reason}`;
  if (state.seenConflictKeys?.has(key)) return;
  state.seenConflictKeys?.add(key);
  state.conflicts.push({
    key,
    cell: to,
    edge: conflictEdge,
    reason,
    placementKey
  });
  state.conflictKeys?.add(placementKey);
  const componentId = state.componentIdByPlacementKey?.get(placementKey);
  markComponentPlacementInvalid(state, placementKey, componentId, reason);
};

const addCollisionConflicts = (state, leftEntry, rightEntry) => {
  if (leftEntry.moving && rightEntry.moving) {
    addConflict(state, 'selection_overlap', leftEntry.placement, leftEntry.placement.edge || null);
    addConflict(state, 'selection_overlap', rightEntry.placement, rightEntry.placement.edge || null);
    return;
  }
  if (leftEntry.moving) {
    addConflict(state, 'placement_occupied', leftEntry.placement, leftEntry.placement.edge || null);
  }
  if (rightEntry.moving) {
    addConflict(state, 'placement_occupied', rightEntry.placement, rightEntry.placement.edge || null);
  }
};

const addGearRackOverlapConflicts = (state, mapData = {}, placement = null) => {
  if (!placement || !Array.isArray(placement.gearMounts)) return;
  const hasOverlap = placement.gearMounts.some((mount) => {
    if (!mount?.componentType) return false;
    const point = getGearSocketWorldPosition(placement, mount.position, mount.surface || 'front');
    return isGearPointOnAnyRack(mapData, point);
  });
  if (hasOverlap) addConflict(state, 'gear_rack_overlap', placement, placement.edge || null);
};

const collectStaticCollisionEntries = ({
  mapData = {},
  movingTileKeys = new Set(),
  movingWallKeys = new Set()
} = {}) => {
  const entries = [];
  Object.entries(mapData.tiles || {}).forEach(([key, tile]) => {
    if (!tile || movingTileKeys.has(key)) return;
    entries.push(createCollisionEntry({ placement: tile, key, moving: false }));
  });
  Object.entries(mapData.walls || {}).forEach(([key, wall]) => {
    if (!wall || movingWallKeys.has(key)) return;
    entries.push(createCollisionEntry({ placement: wall, key, moving: false }));
  });
  return entries;
};

export const computeCityChannelMovePreviewModel = ({
  mapData = {},
  origins = [],
  targetCell = null,
  anchor = null,
  explicitSurfaceTarget = null,
  preserveOrigins = false,
  groupRotationSteps = 0,
  groupPoseSteps = 0,
  includeConflictKeys = false
} = {}) => {
  const emptyComponents = [];
  const emptyComponentResults = new Map();
  if (!Array.isArray(origins) || origins.length <= 0 || !targetCell) {
    return {
      valid: true,
      moves: [],
      conflicts: [],
      conflictKeys: includeConflictKeys ? new Set() : undefined,
      invalidPlacementKeys: new Set(),
      componentResults: emptyComponentResults,
      components: emptyComponents,
      componentByPlacementKey: new Map(),
      componentIdByPlacementKey: new Map(),
      movedTilePlacements: [],
      movedWallPlacements: [],
      movingTileKeys: new Set(),
      movingWallKeys: new Set(),
      anchor: null,
      previewTiles: new Map(Object.entries(mapData.tiles || {})),
      previewWalls: new Map(Object.entries(mapData.walls || {})),
      targetKey: targetCell ? createCellKey(targetCell.x, targetCell.y, targetCell.z) : ''
    };
  }

  const resolvedAnchor = anchor || getSelectionAnchor(origins) || origins[0];
  const sourcePlacementByOriginKey = new Map(
    origins.map((origin) => {
      const originKey = getSelectionPlacementKey(origin);
      const sourcePlacement = getSelectionPlacement(mapData, origin);
      return [originKey, sourcePlacement || null];
    })
  );
  const sourceRigidPointByOriginKey = new Map(
    origins.map((origin) => {
      const originKey = getSelectionPlacementKey(origin);
      return [originKey, getPlacementRigidPoint(origin, sourcePlacementByOriginKey.get(originKey))];
    })
  );
  const sourceCenter = Array.from(sourceRigidPointByOriginKey.values()).reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y,
    z: acc.z + point.z
  }), { x: 0, y: 0, z: 0 });
  const sourceCenterPoint = {
    x: sourceCenter.x / origins.length,
    y: sourceCenter.y / origins.length,
    z: sourceCenter.z / origins.length
  };
  const normalizedGroupPoseSteps = ((groupPoseSteps % 4) + 4) % 4;
  const poseQuarterTurns = origins.length > 1 ? normalizedGroupPoseSteps : 0;
  const normalizedRotationSteps = ((groupRotationSteps % 4) + 4) % 4;
  const resolvedAnchorKey = getSelectionPlacementKey(resolvedAnchor);
  const anchorSourcePlacement = sourcePlacementByOriginKey.get(resolvedAnchorKey);
  const basisRotationSteps = getRotationSteps(getPlacementShapeRotation(resolvedAnchor, anchorSourcePlacement));
  const transformRigidPoint = createRigidTransform({
    sourceCenterPoint,
    normalizedRotationSteps,
    poseQuarterTurns,
    basisRotationSteps
  });
  const rotatedAnchorPoint = transformRigidPoint(
    sourceRigidPointByOriginKey.get(resolvedAnchorKey) || getPlacementRigidPoint(resolvedAnchor, anchorSourcePlacement)
  );
  const anchorTargetShape = getPlacementTargetShape({
    origin: resolvedAnchor,
    sourcePlacement: anchorSourcePlacement,
    targetCell,
    originsLength: origins.length,
    normalizedGroupPoseSteps,
    normalizedRotationSteps,
    basisRotationSteps,
    layFlatTarget: false
  });
  const anchorTargetOffset = anchorTargetShape.edge ? getEdgeCenterOffset(anchorTargetShape.edge) : { x: 0, y: 0 };
  const targetAnchorPoint = anchorTargetShape.edge
    ? getPlacementRigidPoint({ ...targetCell, edge: anchorTargetShape.edge }, null)
    : {
      x: (Number(targetCell.x) || 0) + anchorTargetOffset.x,
      y: (Number(targetCell.y) || 0) + anchorTargetOffset.y,
      z: Number(targetCell.z) || 0
    };
  const dx = targetAnchorPoint.x - rotatedAnchorPoint.x;
  const dy = targetAnchorPoint.y - rotatedAnchorPoint.y;
  const dz = targetAnchorPoint.z - (Number(rotatedAnchorPoint.z) || 0);
  const components = buildSelectionComponents(mapData, origins);
  const componentIdByOriginKey = new Map();
  components.forEach((component) => {
    component.originKeys.forEach((key) => componentIdByOriginKey.set(key, component.id));
  });
  const componentResults = new Map(components.map((component) => [component.id, createComponentResult(component)]));
  const componentByPlacementKey = new Map();
  const componentIdByPlacementKey = new Map();
  const invalidPlacementKeys = new Set();
  const movingTileKeys = new Set(origins.filter((item) => !item.edge).map((item) => createCellKey(item.x, item.y, item.z)));
  const movingWallKeys = new Set(origins.filter((item) => item.edge).map(createWallSelectionKey));
  const movableTileKeys = preserveOrigins ? new Set() : movingTileKeys;
  const movableWallKeys = preserveOrigins ? new Set() : movingWallKeys;
  const state = {
    conflicts: [],
    conflictKeys: includeConflictKeys ? new Set() : null,
    seenConflictKeys: new Set(),
    componentResults,
    componentByPlacementKey,
    componentIdByPlacementKey,
    invalidPlacementKeys
  };
  const layFlatTarget = origins.length === 1 && !!targetCell?.layFlat && !targetCell?.edge;
  const moves = origins.map((origin) => ({
    from: origin,
    componentId: componentIdByOriginKey.get(getSelectionPlacementKey(origin)) || null,
    to: (() => {
      const originKey = getSelectionPlacementKey(origin);
      const sourcePlacement = sourcePlacementByOriginKey.get(originKey);
      const targetShape = getPlacementTargetShape({
        origin,
        sourcePlacement,
        targetCell,
        originsLength: origins.length,
        normalizedGroupPoseSteps,
        normalizedRotationSteps,
        basisRotationSteps,
        layFlatTarget
      });
      const rotatedOriginPoint = transformRigidPoint(sourceRigidPointByOriginKey.get(originKey));
      const to = createPlacementTargetCell({
        transformedPoint: rotatedOriginPoint,
        targetShape,
        dx,
        dy,
        dz
      });
      if (targetShape.includeRotation) {
        to.rotation = normalizeRotation(targetShape.shapeRotation);
        to.transmissionRotation = normalizeRotation(targetShape.surfaceRotation);
      }
      if (explicitSurfaceTarget) {
        if (explicitSurfaceTarget.edge) to.edge = explicitSurfaceTarget.edge;
      } else if (targetShape.edge) {
        to.edge = targetShape.edge;
      } else if (targetShape.layFlat) {
        to.layFlat = true;
      } else if (targetShape.isVertical) {
        to.isVertical = true;
      }
      return to;
    })()
  }));
  const movedTilePlacements = [];
  const movedWallPlacements = [];
  const movingEntries = [];
  const previewTiles = new Map(Object.entries(mapData.tiles || {}).filter(([key]) => !movableTileKeys.has(key)));
  const previewWalls = new Map(Object.entries(mapData.walls || {}).filter(([key]) => !movableWallKeys.has(key)));
  const movedTilePlacementKeys = new Set();
  const registerPlacementKey = (placementKey, componentId) => {
    componentIdByPlacementKey.set(placementKey, componentId);
    const componentResult = componentResults.get(componentId);
    if (componentResult) {
      componentResult.placementKeys.add(placementKey);
      componentByPlacementKey.set(placementKey, componentResult);
    }
  };

  const registerMovedPlacement = (placement, componentId) => {
    const placementKey = getMovingPlacementKey(placement);
    registerPlacementKey(placementKey, componentId);
    return placementKey;
  };

  moves.forEach(({ from, to, componentId }) => {
    registerPlacementKey(getMovingPlacementKey(to), componentId);
    if (!isValidCell(to.x, to.y, to.z, mapData)) {
      addConflict(state, 'out_of_bounds', to, to.edge || null);
      return;
    }

    if (to.edge) {
      const sourceWall = from.edge ? mapData.walls?.[createWallSelectionKey(from)] : null;
      const sourceTile = !from.edge ? mapData.tiles?.[createCellKey(from.x, from.y, from.z)] : null;
      const placement = sourceWall
        ? {
          ...sourceWall,
          x: to.x,
          y: to.y,
          z: to.z,
          edge: to.edge,
          ...(to.transmissionRotation !== undefined || to.rotation !== undefined
            ? { transmissionRotation: normalizeRotation(to.transmissionRotation ?? to.rotation) }
            : {}),
          gearMounts: cloneGearMounts(sourceWall.gearMounts || [])
        }
        : sourceTile
          ? {
            ...createWall({
              x: to.x,
              y: to.y,
              z: to.z,
              edge: to.edge,
              panelType: sourceTile.panelType,
              transmissionRotation: to.transmissionRotation ?? to.rotation ?? sourceTile.transmissionRotation ?? sourceTile.rotation ?? 0
            }),
            gearMounts: cloneGearMounts(sourceTile.gearMounts || [])
          }
          : null;
      if (!placement) return;
      movedWallPlacements.push(placement);
      const placementKey = registerMovedPlacement(placement, componentId);
      previewWalls.set(placementKey, placement);
      movingEntries.push(createCollisionEntry({
        placement,
        key: placementKey,
        origin: from,
        moving: true
      }));
      return;
    }

    const sourceTile = !from.edge ? mapData.tiles?.[createCellKey(from.x, from.y, from.z)] : null;
    const sourceWall = from.edge ? mapData.walls?.[createWallSelectionKey(from)] : null;
    const placement = sourceTile
      ? {
        ...sourceTile,
        x: to.x,
        y: to.y,
        z: to.z,
        ...(to.rotation !== undefined ? { rotation: normalizeRotation(to.rotation) } : {}),
        ...(to.transmissionRotation !== undefined || to.rotation !== undefined
          ? { transmissionRotation: normalizeRotation(to.transmissionRotation ?? to.rotation) }
          : {}),
        ...(to.layFlat ? { isVertical: false } : (to.isVertical ? { isVertical: true } : {})),
        gearMounts: cloneGearMounts(sourceTile.gearMounts || [])
      }
      : sourceWall
        ? {
          ...createTile({
            x: to.x,
            y: to.y,
            z: to.z,
            panelType: sourceWall.panelType,
            rotation: to.rotation ?? sourceWall.rotation ?? 0,
            transmissionRotation: to.transmissionRotation ?? to.rotation ?? sourceWall.transmissionRotation ?? sourceWall.rotation ?? 0
          }),
          gearMounts: cloneGearMounts(sourceWall.gearMounts || []),
          isVertical: to.layFlat ? false : sourceWall.isVertical
        }
        : null;
    if (!placement) return;
    movedTilePlacements.push(placement);
    const placementKey = registerMovedPlacement(placement, componentId);
    movedTilePlacementKeys.add(placementKey);
    previewTiles.set(placementKey, placement);
    movingEntries.push(createCollisionEntry({
      placement,
      key: placementKey,
      origin: from,
      moving: true
    }));
  });

  const staticEntries = collectStaticCollisionEntries({
    mapData,
    movingTileKeys: movableTileKeys,
    movingWallKeys: movableWallKeys
  });

  // 新规则1: 检查遮挡（碰撞）
  // 移动物体之间的碰撞（选中物体内部碰撞）
  for (let i = 0; i < movingEntries.length; i += 1) {
    for (let j = i + 1; j < movingEntries.length; j += 1) {
      if (boxSetsIntersect(movingEntries[i].boxes, movingEntries[j].boxes)) {
        addCollisionConflicts(state, movingEntries[i], movingEntries[j]);
      }
    }
  }

  // 移动物体与静态物体的碰撞
  movingEntries.forEach((movingEntry) => {
    staticEntries.forEach((staticEntry) => {
      if (boxSetsIntersect(movingEntry.boxes, staticEntry.boxes)) {
        // 支撑关系豁免：墙体可以穿过其支撑的地板
        if (isSupportCollisionExempt(movingEntry.placement, staticEntry.placement)) return;
        addCollisionConflicts(state, movingEntry, staticEntry);
      }
    });
  });

  const previewMapData = {
    ...mapData,
    tiles: Object.fromEntries(previewTiles),
    walls: Object.fromEntries(previewWalls)
  };
  [...movedTilePlacements, ...movedWallPlacements].forEach((placement) => {
    addGearRackOverlapConflicts(state, previewMapData, placement);
  });

  return {
    valid: state.conflicts.length === 0,
    moves: moves.map(({ componentId, ...move }) => move),
    conflicts: state.conflicts,
    conflictKeys: state.conflictKeys || undefined,
    invalidPlacementKeys,
    componentResults,
    components,
    componentByPlacementKey,
    componentIdByPlacementKey,
    movedTilePlacements,
    movedWallPlacements,
    anchor: resolvedAnchor,
    translation: { dx, dy, dz },
    previewTiles,
    previewWalls,
    movingTileKeys,
    movingWallKeys,
    targetKey: createCellKey(targetCell.x, targetCell.y, targetCell.z)
  };
};

export const createMoveGhostMapData = ({ mapData = {}, previewTiles = new Map(), previewWalls = new Map() } = {}) => ({
  ...mapData,
  tiles: Object.fromEntries(previewTiles),
  walls: Object.fromEntries(previewWalls),
  entrances: [],
  exits: [],
  safeRoute: [],
  mechanisms: []
});

export const getCityChannelMovePreviewPlacementKey = getSelectionPlacementKey;
export {
  collectSupportedFloorKeys,
  getSelectionAnchor
} from './cityChannelMoveSelectionGraph';
export {
  EDGE_NEIGHBOR_OFFSETS,
  getCityChannelPlacementCollisionBox,
  getCityChannelPlacementCollisionBoxes,
  isPortalMaterial
} from './cityChannelPlacementGeometry';
