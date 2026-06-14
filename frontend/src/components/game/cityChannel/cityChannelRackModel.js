import {
  createCellKey,
  isValidCell
} from './schema/keys';
import {
  getGearSocketWorldPosition,
  isCornerGearSocket
} from './cityChannelMechanismRuntime';

export const DOUBLE_SIDED_RACK_COMPONENT_TYPE = 'double_sided_rack';
export const DOUBLE_SIDED_RACK_LABEL = '双面齿条';
export const RACK_PLANES = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical'
};
export const RACK_DIRECTIONS = {
  X: 'x',
  Y: 'y',
  Z: 'z'
};

export const DOUBLE_SIDED_RACK_WIDTH_WORLD = 0.16;
export const DOUBLE_SIDED_RACK_HEIGHT_WORLD = 0.08;
export const DOUBLE_SIDED_RACK_TOOTH_DEPTH_WORLD = 0.08;
export const DOUBLE_SIDED_RACK_CONTACT_EPSILON = 0.09;
export const DOUBLE_SIDED_RACK_SIDE_CONTACT_OFFSET = 0.5;

const sanitizeCoord = (value = 0) => String(Number(value).toFixed(3)).replace(/[-.]/g, '_');
const RACK_AXIS_BLOCK_STEP = 1;

export const snapRackCoord = (value = 0) => Number((Math.round((Number(value) || 0) - 0.5) + 0.5).toFixed(3));
export const snapRackHalfCoord = (value = 0) => Number((Math.round((Number(value) || 0) * 2) / 2).toFixed(3));
export const snapRackHeightCoord = (value = 0) => Number(Math.round(Number(value) || 0).toFixed(3));

const normalizeRackPlane = (rack = {}) => (
  rack.plane === RACK_PLANES.VERTICAL ? RACK_PLANES.VERTICAL : RACK_PLANES.HORIZONTAL
);

const normalizeRackNormalAxis = (axis = '') => (axis === RACK_DIRECTIONS.X ? RACK_DIRECTIONS.X : RACK_DIRECTIONS.Y);

const normalizeRackNormalSign = () => 1;

const getRackDirection = (direction = null, fallback = RACK_DIRECTIONS.X) => (
  direction === RACK_DIRECTIONS.X || direction === RACK_DIRECTIONS.Y || direction === RACK_DIRECTIONS.Z
    ? direction
    : fallback
);

export const createRackKey = (rack = {}) => {
  if (rack.id) return rack.id;
  const plane = normalizeRackPlane(rack);
  const direction = getRackDirection(rack.direction, RACK_DIRECTIONS.X);
  const start = rack.start || {};
  const end = rack.end || {};
  return [
    'rack',
    plane,
    normalizeRackNormalAxis(rack.normalAxis),
    direction,
    sanitizeCoord(rack.line ?? (normalizeRackNormalAxis(rack.normalAxis) === RACK_DIRECTIONS.X ? start.x : start.y)),
    sanitizeCoord(start.x),
    sanitizeCoord(start.y),
    sanitizeCoord(start.z),
    sanitizeCoord(end.x),
    sanitizeCoord(end.y),
    sanitizeCoord(end.z)
  ].join('_');
};

const getRackDirectionFromPoints = (start = {}, end = {}, plane = RACK_PLANES.HORIZONTAL, normalAxis = RACK_DIRECTIONS.Y) => {
  const dx = Math.abs((Number(end.x) || 0) - (Number(start.x) || 0));
  const dy = Math.abs((Number(end.y) || 0) - (Number(start.y) || 0));
  if (plane === RACK_PLANES.VERTICAL) {
    const dz = Math.abs((Number(end.z) || 0) - (Number(start.z) || 0));
    const horizontalDirection = normalAxis === RACK_DIRECTIONS.X ? RACK_DIRECTIONS.Y : RACK_DIRECTIONS.X;
    const horizontalDelta = horizontalDirection === RACK_DIRECTIONS.X ? dx : dy;
    return dz > horizontalDelta ? RACK_DIRECTIONS.Z : horizontalDirection;
  }
  return dy > dx ? RACK_DIRECTIONS.Y : RACK_DIRECTIONS.X;
};

export const getRackCanonicalSegment = (rack = {}) => {
  const start = rack.start || {};
  const end = rack.end || {};
  const plane = normalizeRackPlane(rack);
  const normalAxis = normalizeRackNormalAxis(rack.normalAxis);
  const normalSign = normalizeRackNormalSign(rack.normalSign);
  const direction = getRackDirection(rack.direction, RACK_DIRECTIONS.X);

  if (plane === RACK_PLANES.VERTICAL) {
    const line = snapRackHalfCoord(normalAxis === RACK_DIRECTIONS.X ? start.x : start.y);
    if (direction === RACK_DIRECTIONS.Z) {
      const x = snapRackHalfCoord(start.x);
      const y = snapRackHalfCoord(start.y);
      const min = Math.min(snapRackHeightCoord(start.z), snapRackHeightCoord(end.z));
      const max = Math.max(snapRackHeightCoord(start.z), snapRackHeightCoord(end.z));
      return {
        plane,
        direction,
        normalAxis,
        normalSign,
        line,
        tangentLine: normalAxis === RACK_DIRECTIONS.X ? y : x,
        min,
        max,
        start: { x, y, z: min },
        end: { x, y, z: max },
        length: max - min
      };
    }
    if (direction === RACK_DIRECTIONS.Y) {
      const x = snapRackHalfCoord(start.x);
      const z = snapRackHeightCoord(start.z);
      const min = Math.min(snapRackHalfCoord(start.y), snapRackHalfCoord(end.y));
      const max = Math.max(snapRackHalfCoord(start.y), snapRackHalfCoord(end.y));
      return {
        plane,
        direction,
        normalAxis: RACK_DIRECTIONS.X,
        normalSign,
        line: x,
        zLine: z,
        min,
        max,
        start: { x, y: min, z },
        end: { x, y: max, z },
        length: max - min
      };
    }
    const y = snapRackHalfCoord(start.y);
    const z = snapRackHeightCoord(start.z);
    const min = Math.min(snapRackHalfCoord(start.x), snapRackHalfCoord(end.x));
    const max = Math.max(snapRackHalfCoord(start.x), snapRackHalfCoord(end.x));
    return {
      plane,
      direction: RACK_DIRECTIONS.X,
      normalAxis: RACK_DIRECTIONS.Y,
      normalSign,
      line: y,
      zLine: z,
      min,
      max,
      start: { x: min, y, z },
      end: { x: max, y, z },
      length: max - min
    };
  }

  const z = Number(rack.z ?? start.z ?? end.z) || 0;
  if (direction === RACK_DIRECTIONS.Y) {
    const x = snapRackCoord(start.x);
    const min = Math.min(snapRackCoord(start.y), snapRackCoord(end.y));
    const max = Math.max(snapRackCoord(start.y), snapRackCoord(end.y));
    return {
      plane,
      direction,
      z,
      line: x,
      min,
      max,
      start: { x, y: min, z },
      end: { x, y: max, z },
      length: max - min
    };
  }
  const y = snapRackCoord(start.y);
  const min = Math.min(snapRackCoord(start.x), snapRackCoord(end.x));
  const max = Math.max(snapRackCoord(start.x), snapRackCoord(end.x));
  return {
    plane,
    direction,
    z,
    line: y,
    min,
    max,
    start: { x: min, y, z },
    end: { x: max, y, z },
    length: max - min
  };
};

export const normalizeRackAxisBinding = (binding = null) => {
  if (!binding?.componentKey) return null;
  const localPosition = binding.localPosition && typeof binding.localPosition === 'object'
    ? {
      x: Number(binding.localPosition.x) || 0,
      y: Number(binding.localPosition.y) || 0
    }
    : null;
  return {
    hostKind: binding.hostKind === 'wall' ? 'wall' : 'tile',
    componentKey: String(binding.componentKey),
    ...(binding.side ? { side: binding.side } : {}),
    ...(Number.isInteger(binding.segmentIndex) ? { segmentIndex: binding.segmentIndex } : {}),
    ...(localPosition ? { localPosition } : {})
  };
};

export const normalizeRack = (rack = {}, bounds = null) => {
  if (!rack || typeof rack !== 'object') return null;
  const plane = normalizeRackPlane(rack);
  const startInput = rack.start || {
    x: rack.startX ?? rack.x1,
    y: rack.startY ?? rack.y1,
    z: rack.z
  };
  const endInput = rack.end || {
    x: rack.endX ?? rack.x2,
    y: rack.endY ?? rack.y2,
    z: rack.z
  };
  const inferredNormalAxis = rack.normalAxis === RACK_DIRECTIONS.X || rack.normalAxis === RACK_DIRECTIONS.Y
    ? rack.normalAxis
    : Math.abs((Number(endInput.x) || 0) - (Number(startInput.x) || 0))
      < Math.abs((Number(endInput.y) || 0) - (Number(startInput.y) || 0))
        ? RACK_DIRECTIONS.X
        : RACK_DIRECTIONS.Y;
  const direction = getRackDirection(
    rack.direction,
    getRackDirectionFromPoints(startInput, endInput, plane, inferredNormalAxis)
  );

  if (plane === RACK_PLANES.VERTICAL) {
    const normalAxis = direction === RACK_DIRECTIONS.Y
      ? RACK_DIRECTIONS.X
      : direction === RACK_DIRECTIONS.X
        ? RACK_DIRECTIONS.Y
        : normalizeRackNormalAxis(inferredNormalAxis);
    const start = {
      x: snapRackHalfCoord(startInput.x),
      y: snapRackHalfCoord(startInput.y),
      z: snapRackHeightCoord(startInput.z)
    };
    if (normalAxis === RACK_DIRECTIONS.X) start.x = snapRackHalfCoord(startInput.x);
    else start.y = snapRackHalfCoord(startInput.y);
    const end = direction === RACK_DIRECTIONS.Z
      ? {
        x: start.x,
        y: start.y,
        z: snapRackHeightCoord(endInput.z)
      }
      : direction === RACK_DIRECTIONS.Y
        ? {
          x: start.x,
          y: snapRackHalfCoord(endInput.y),
          z: start.z
        }
        : {
          x: snapRackHalfCoord(endInput.x),
          y: start.y,
          z: start.z
        };
    const normalized = {
      id: typeof rack.id === 'string' && rack.id.trim() ? rack.id.trim() : null,
      componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      type: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
      plane,
      direction,
      normalAxis,
      normalSign: normalizeRackNormalSign(rack.normalSign),
      z: Math.max(0, Math.floor(Math.min(start.z, end.z))),
      start,
      end,
      axisBinding: normalizeRackAxisBinding(rack.axisBinding)
    };
    const canonical = getRackCanonicalSegment(normalized);
    if (canonical.length < 1) return null;
    if (bounds) {
      const maxX = Number.isInteger(bounds.width) ? bounds.width - 0.5 : Infinity;
      const maxY = Number.isInteger(bounds.height) ? bounds.height - 0.5 : Infinity;
      const maxZ = Number.isInteger(bounds.layers) ? bounds.layers : Infinity;
      if (canonical.normalAxis === RACK_DIRECTIONS.X) {
        if (canonical.line < -0.5 || canonical.line > maxX) return null;
      } else if (canonical.line < -0.5 || canonical.line > maxY) {
        return null;
      }
      if (canonical.direction === RACK_DIRECTIONS.Z) {
        const tangentMax = canonical.normalAxis === RACK_DIRECTIONS.X ? maxY : maxX;
        if (canonical.tangentLine < -0.5 || canonical.tangentLine > tangentMax) return null;
        if (canonical.max < 0 || canonical.min > maxZ) return null;
      } else {
        const tangentMax = canonical.direction === RACK_DIRECTIONS.X ? maxX : maxY;
        if (canonical.max < -0.5 || canonical.min > tangentMax) return null;
        if (canonical.zLine < 0 || canonical.zLine > maxZ) return null;
      }
    }
    return {
      ...normalized,
      id: normalized.id || createRackKey(normalized)
    };
  }

  const z = Number.parseInt(rack.z ?? startInput.z ?? endInput.z, 10);
  const start = {
    x: snapRackCoord(startInput.x),
    y: snapRackCoord(startInput.y),
    z: Number.isInteger(z) && z >= 0 ? z : 0
  };
  const end = direction === RACK_DIRECTIONS.Y
    ? {
      x: start.x,
      y: snapRackCoord(endInput.y),
      z: start.z
    }
    : {
      x: snapRackCoord(endInput.x),
      y: start.y,
      z: start.z
    };
  const normalized = {
    id: typeof rack.id === 'string' && rack.id.trim() ? rack.id.trim() : null,
    componentType: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
    type: DOUBLE_SIDED_RACK_COMPONENT_TYPE,
    plane,
    direction,
    z: start.z,
    start,
    end,
    axisBinding: normalizeRackAxisBinding(rack.axisBinding)
  };
  const canonical = getRackCanonicalSegment(normalized);
  if (canonical.length < 1) return null;
  if (bounds) {
    const maxX = Number.isInteger(bounds.width) ? bounds.width - 0.5 : Infinity;
    const maxY = Number.isInteger(bounds.height) ? bounds.height - 0.5 : Infinity;
    const minX = -0.5;
    const minY = -0.5;
    if (canonical.direction === RACK_DIRECTIONS.X) {
      if (canonical.line < minY || canonical.line > maxY) return null;
      if (canonical.max < minX || canonical.min > maxX) return null;
    } else {
      if (canonical.line < minX || canonical.line > maxX) return null;
      if (canonical.max < minY || canonical.min > maxY) return null;
    }
  }
  return {
    ...normalized,
    id: normalized.id || createRackKey(normalized)
  };
};

export const getRackSegmentMidpoints = (rack = {}) => {
  const canonical = getRackCanonicalSegment(rack);
  const count = Math.max(0, Math.floor(canonical.length));
  return Array.from({ length: count }, (_, index) => {
    const axis = canonical.min + index + 0.5;
    if (canonical.plane === RACK_PLANES.VERTICAL) {
      if (canonical.direction === RACK_DIRECTIONS.Z) {
        return {
          x: canonical.start.x,
          y: canonical.start.y,
          z: axis,
          index,
          plane: canonical.plane,
          normalAxis: canonical.normalAxis
        };
      }
      return canonical.direction === RACK_DIRECTIONS.Y
        ? { x: canonical.line, y: axis, z: canonical.zLine, index, plane: canonical.plane, normalAxis: canonical.normalAxis }
        : { x: axis, y: canonical.line, z: canonical.zLine, index, plane: canonical.plane, normalAxis: canonical.normalAxis };
    }
    return canonical.direction === RACK_DIRECTIONS.Y
      ? { x: canonical.line, y: axis, z: canonical.z, index, plane: canonical.plane }
      : { x: axis, y: canonical.line, z: canonical.z, index, plane: canonical.plane };
  });
};

const normalizeQuarterRotation = (rotation = 0) => (((Number(rotation) || 0) % 360) + 360) % 360;

const getVerticalPlacementPlane = (placement = null, hostKind = 'tile') => {
  if (!placement) return null;
  if (hostKind === 'wall' || placement.edge) {
    const edge = placement.edge || 'north';
    if (edge === 'east' || edge === 'west') {
      return {
        normalAxis: RACK_DIRECTIONS.X,
        direction: RACK_DIRECTIONS.Y,
        line: (Number(placement.x) || 0) + (edge === 'east' ? 0.5 : -0.5),
        tangentCenter: Number(placement.y) || 0,
        min: (Number(placement.y) || 0) - 0.5,
        max: (Number(placement.y) || 0) + 0.5,
        zMin: Number(placement.z) || 0,
        zMax: (Number(placement.z) || 0) + 1
      };
    }
    return {
      normalAxis: RACK_DIRECTIONS.Y,
      direction: RACK_DIRECTIONS.X,
      line: (Number(placement.y) || 0) + (edge === 'south' ? 0.5 : -0.5),
      tangentCenter: Number(placement.x) || 0,
      min: (Number(placement.x) || 0) - 0.5,
      max: (Number(placement.x) || 0) + 0.5,
      zMin: Number(placement.z) || 0,
      zMax: (Number(placement.z) || 0) + 1
    };
  }
  if (!placement.isVertical) return null;
  const rotation = normalizeQuarterRotation(placement.rotation || 0);
  if (rotation === 90 || rotation === 270) {
    return {
      normalAxis: RACK_DIRECTIONS.X,
      direction: RACK_DIRECTIONS.Y,
      line: Number(placement.x) || 0,
      tangentCenter: Number(placement.y) || 0,
      min: (Number(placement.y) || 0) - 0.5,
      max: (Number(placement.y) || 0) + 0.5,
      zMin: Number(placement.z) || 0,
      zMax: (Number(placement.z) || 0) + 1
    };
  }
  return {
    normalAxis: RACK_DIRECTIONS.Y,
    direction: RACK_DIRECTIONS.X,
    line: Number(placement.y) || 0,
    tangentCenter: Number(placement.x) || 0,
    min: (Number(placement.x) || 0) - 0.5,
    max: (Number(placement.x) || 0) + 0.5,
    zMin: Number(placement.z) || 0,
    zMax: (Number(placement.z) || 0) + 1
  };
};

const isWithin = (value = 0, min = 0, max = 0, epsilon = 0.001) => (
  value >= min - epsilon && value <= max + epsilon
);

const getVerticalRackSideCandidates = (mapData = {}, rack = {}) => {
  const canonical = getRackCanonicalSegment(rack);
  const candidates = [];
  const seen = new Set();
  const addCandidate = ({ hostKind, componentKey, placement, plane, point }) => {
    const tangentCoord = plane.direction === RACK_DIRECTIONS.X ? point.x : point.y;
    const side = canonical.direction === RACK_DIRECTIONS.Z
      ? (plane.tangentCenter >= tangentCoord ? 'positive' : 'negative')
      : (((plane.zMin + plane.zMax) * 0.5) >= point.z ? 'positive' : 'negative');
    const key = `${hostKind}:${componentKey}:${side}:${point.index}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      hostKind,
      componentKey,
      placement,
      side,
      segmentIndex: point.index,
      point,
      localPosition: {
        x: Number((tangentCoord - plane.tangentCenter).toFixed(3)),
        y: Number((((plane.zMin + plane.zMax) * 0.5) - point.z).toFixed(3))
      }
    });
  };
  const placements = [
    ...Object.entries(mapData.tiles || {}).map(([componentKey, placement]) => ({ hostKind: 'tile', componentKey, placement })),
    ...Object.entries(mapData.walls || {}).map(([componentKey, placement]) => ({ hostKind: 'wall', componentKey, placement }))
  ];
  getRackSegmentMidpoints(rack).forEach((point) => {
    placements.forEach(({ hostKind, componentKey, placement }) => {
      const plane = getVerticalPlacementPlane(placement, hostKind);
      if (!plane) return;
      if (plane.normalAxis !== canonical.normalAxis) return;
      if (Math.abs(plane.line - canonical.line) > DOUBLE_SIDED_RACK_CONTACT_EPSILON) return;
      const tangentCoord = plane.direction === RACK_DIRECTIONS.X ? point.x : point.y;
      if (canonical.direction === RACK_DIRECTIONS.Z) {
        if (!isWithin(canonical.tangentLine, plane.min, plane.max, DOUBLE_SIDED_RACK_CONTACT_EPSILON)) return;
        if (!isWithin(point.z, plane.zMin, plane.zMax, DOUBLE_SIDED_RACK_CONTACT_EPSILON)) return;
        addCandidate({ hostKind, componentKey, placement, plane, point });
        return;
      }
      if (plane.direction !== canonical.direction) return;
      if (!isWithin(tangentCoord, plane.min, plane.max, DOUBLE_SIDED_RACK_CONTACT_EPSILON)) return;
      if (!isWithin(point.z, plane.zMin, plane.zMax, DOUBLE_SIDED_RACK_CONTACT_EPSILON)) return;
      addCandidate({ hostKind, componentKey, placement, plane, point });
    });
  });
  return candidates;
};

export const getRackSideCandidates = (mapData = {}, rack = {}) => {
  const canonical = getRackCanonicalSegment(rack);
  if (canonical.plane === RACK_PLANES.VERTICAL) return getVerticalRackSideCandidates(mapData, rack);
  const candidates = [];
  getRackSegmentMidpoints(rack).forEach((point) => {
    const sideCells = canonical.direction === RACK_DIRECTIONS.Y
      ? [
        { side: 'negative', x: point.x - 0.5, y: point.y },
        { side: 'positive', x: point.x + 0.5, y: point.y }
      ]
      : [
        { side: 'negative', x: point.x, y: point.y - 0.5 },
        { side: 'positive', x: point.x, y: point.y + 0.5 }
      ];
    sideCells.forEach((cell) => {
      const x = Math.round(cell.x);
      const y = Math.round(cell.y);
      const z = Number(canonical.z) || 0;
      if (!isValidCell(x, y, z, mapData)) return;
      const componentKey = createCellKey(x, y, z);
      const placement = mapData.tiles?.[componentKey];
      if (!placement || placement.isVertical) return;
      candidates.push({
        hostKind: 'tile',
        componentKey,
        placement,
        side: cell.side,
        segmentIndex: point.index,
        point,
        localPosition: {
          x: Number((point.x - x).toFixed(3)),
          y: Number((point.y - y).toFixed(3))
        }
      });
    });
  });
  return candidates;
};

const isInstalledGearMount = (mount = null) => (
  !!mount?.componentType
);

const isInstalledCornerGearMount = (mount = null) => (
  isInstalledGearMount(mount)
  && (isCornerGearSocket(mount.position) || mount.position === 'intersection')
);

export const getRackGearPoints = (mapData = {}) => {
  const collect = (placements = {}, hostKind = 'tile') => Object.entries(placements || {}).flatMap(([componentKey, placement]) => (
    (placement?.gearMounts || [])
      .filter(isInstalledGearMount)
      .map((mount) => {
        const point = getGearSocketWorldPosition(placement, mount.position, mount.surface || 'front');
        return point ? {
          hostKind,
          componentKey,
          placement,
          mount,
          point
        } : null;
      })
      .filter(Boolean)
  ));
  const rootGears = Object.entries(mapData.gears || {}).map(([componentKey, gear]) => (
    gear?.componentType
      ? {
        hostKind: 'intersection',
        componentKey,
        placement: null,
        mount: gear,
        point: { x: Number(gear.x) || 0, y: Number(gear.y) || 0, z: Number(gear.z) || 0 }
      }
      : null
  )).filter(Boolean);
  return [
    ...collect(mapData.tiles, 'tile'),
    ...collect(mapData.walls, 'wall'),
    ...rootGears
  ];
};

export const getRackCornerGearPoints = (mapData = {}) => (
  getRackGearPoints(mapData).filter((gear) => isInstalledCornerGearMount(gear.mount))
);

const getRackPointAxisValue = (canonical = {}, point = {}) => {
  if (canonical.direction === RACK_DIRECTIONS.Z) return Number(point.z) || 0;
  if (canonical.direction === RACK_DIRECTIONS.Y) return Number(point.y) || 0;
  return Number(point.x) || 0;
};

const getRackGearAxisValueOnSegment = (canonical = {}, point = {}, epsilon = DOUBLE_SIDED_RACK_CONTACT_EPSILON) => {
  if (!point) return null;
  if (canonical.plane === RACK_PLANES.VERTICAL) {
    const normalCoord = canonical.normalAxis === RACK_DIRECTIONS.X ? Number(point.x) || 0 : Number(point.y) || 0;
    if (Math.abs(normalCoord - canonical.line) > epsilon) return null;
    if (canonical.direction === RACK_DIRECTIONS.Z) {
      const tangentCoord = canonical.normalAxis === RACK_DIRECTIONS.X ? Number(point.y) || 0 : Number(point.x) || 0;
      if (Math.abs(tangentCoord - canonical.tangentLine) > epsilon) return null;
      return Number(point.z) || 0;
    }
    if (Math.abs((Number(point.z) || 0) - canonical.zLine) > epsilon) return null;
    return canonical.direction === RACK_DIRECTIONS.Y ? Number(point.y) || 0 : Number(point.x) || 0;
  }
  if (Math.abs((Number(point.z) || 0) - canonical.z) > epsilon) return null;
  if (canonical.direction === RACK_DIRECTIONS.Y) {
    if (Math.abs((Number(point.x) || 0) - canonical.line) > epsilon) return null;
    return Number(point.y) || 0;
  }
  if (Math.abs((Number(point.y) || 0) - canonical.line) > epsilon) return null;
  return Number(point.x) || 0;
};

export const getRackGearIntersections = (mapData = {}, rack = {}, {
  gears = getRackGearPoints(mapData)
} = {}) => {
  const canonical = getRackCanonicalSegment(rack);
  return (Array.isArray(gears) ? gears : [])
    .map((gear) => {
      const axis = getRackGearAxisValueOnSegment(canonical, gear.point);
      if (!Number.isFinite(axis)) return null;
      if (axis < canonical.min - DOUBLE_SIDED_RACK_CONTACT_EPSILON) return null;
      if (axis > canonical.max + DOUBLE_SIDED_RACK_CONTACT_EPSILON) return null;
      return { ...gear, axis };
    })
    .filter(Boolean)
    .sort((left, right) => left.axis - right.axis);
};

export const getRackCornerGearIntersections = (mapData = {}, rack = {}) => (
  getRackGearIntersections(mapData, rack, { gears: getRackCornerGearPoints(mapData) })
);

export const getRackOverlappingGears = getRackGearIntersections;

export const isGearPointOnRack = (rack = {}, point = null, epsilon = DOUBLE_SIDED_RACK_CONTACT_EPSILON) => {
  if (!point) return false;
  const normalized = normalizeRack(rack);
  if (!normalized) return false;
  const canonical = getRackCanonicalSegment(normalized);
  const axis = getRackGearAxisValueOnSegment(canonical, point, epsilon);
  return Number.isFinite(axis)
    && axis >= canonical.min - epsilon
    && axis <= canonical.max + epsilon;
};

export const getGearRackOverlaps = (mapData = {}, point = null, {
  excludeRackIds = new Set()
} = {}) => {
  if (!point) return [];
  const excluded = excludeRackIds instanceof Set
    ? excludeRackIds
    : new Set(Array.isArray(excludeRackIds) ? excludeRackIds : []);
  return Object.values(mapData.racks || {})
    .filter((rack) => rack?.id && !excluded.has(rack.id))
    .filter((rack) => isGearPointOnRack(rack, point));
};

export const isGearPointOnAnyRack = (mapData = {}, point = null, options = {}) => (
  getGearRackOverlaps(mapData, point, options).length > 0
);

export const isRackPointOnCornerGear = (mapData = {}, point = null, epsilon = DOUBLE_SIDED_RACK_CONTACT_EPSILON) => (
  !!point
  && getRackCornerGearPoints(mapData).some((gear) => (
    Math.abs((Number(gear.point.x) || 0) - (Number(point.x) || 0)) <= epsilon
    && Math.abs((Number(gear.point.y) || 0) - (Number(point.y) || 0)) <= epsilon
    && Math.abs((Number(gear.point.z) || 0) - (Number(point.z) || 0)) <= epsilon
  ))
);

export const isRackPointOnGear = (mapData = {}, point = null, epsilon = DOUBLE_SIDED_RACK_CONTACT_EPSILON) => (
  !!point
  && getRackGearPoints(mapData).some((gear) => (
    Math.abs((Number(gear.point.x) || 0) - (Number(point.x) || 0)) <= epsilon
    && Math.abs((Number(gear.point.y) || 0) - (Number(point.y) || 0)) <= epsilon
    && Math.abs((Number(gear.point.z) || 0) - (Number(point.z) || 0)) <= epsilon
  ))
);

const setRackEndAxisValue = (rack = {}, direction = RACK_DIRECTIONS.X, axis = 0) => {
  const end = { ...(rack.end || {}) };
  if (direction === RACK_DIRECTIONS.Z) end.z = axis;
  else if (direction === RACK_DIRECTIONS.Y) end.y = axis;
  else end.x = axis;
  return {
    ...rack,
    end
  };
};

export const clipRackToCornerGearBlocker = (mapData = {}, rack = {}) => {
  const normalized = normalizeRack(rack, mapData);
  if (!normalized) return rack;
  const canonical = getRackCanonicalSegment(normalized);
  const startAxis = getRackPointAxisValue(canonical, rack.start || normalized.start);
  const endAxis = getRackPointAxisValue(canonical, rack.end || normalized.end);
  const delta = endAxis - startAxis;
  const sign = Math.sign(delta);
  if (!sign) return rack;
  const blocker = getRackGearIntersections(mapData, normalized)
    .filter((gear) => {
      const distance = (gear.axis - startAxis) * sign;
      return distance > DOUBLE_SIDED_RACK_CONTACT_EPSILON
        && distance <= Math.abs(delta) + DOUBLE_SIDED_RACK_CONTACT_EPSILON;
    })
    .sort((left, right) => Math.abs(left.axis - startAxis) - Math.abs(right.axis - startAxis))[0];
  if (!blocker) return rack;
  const clippedAxis = blocker.axis - (sign * RACK_AXIS_BLOCK_STEP);
  return setRackEndAxisValue(rack, canonical.direction, clippedAxis);
};

export const getRackPlacementRuleStatus = (mapData = {}, rack = {}) => {
  const normalized = normalizeRack(rack, mapData);
  if (!normalized) return { valid: false, reason: 'invalidRack', rack: null };
  const canonical = getRackCanonicalSegment(normalized);
  const gearHits = getRackGearIntersections(mapData, normalized);
  const endpointHits = gearHits.filter((hit) => (
    Math.abs(hit.axis - canonical.min) <= DOUBLE_SIDED_RACK_CONTACT_EPSILON
    || Math.abs(hit.axis - canonical.max) <= DOUBLE_SIDED_RACK_CONTACT_EPSILON
  ));
  if (endpointHits.length > 0) {
    const reason = endpointHits.some((hit) => isCornerGearSocket(hit.mount?.position))
      ? 'cornerGearEndpoint'
      : 'gearEndpoint';
    return { valid: false, reason, rack: normalized, gearHits, cornerHits: gearHits };
  }
  const pathHits = gearHits.filter((hit) => (
    hit.axis > canonical.min + DOUBLE_SIDED_RACK_CONTACT_EPSILON
    && hit.axis < canonical.max - DOUBLE_SIDED_RACK_CONTACT_EPSILON
  ));
  if (pathHits.length > 0) {
    const reason = pathHits.some((hit) => isCornerGearSocket(hit.mount?.position))
      ? 'cornerGearBlocked'
      : 'gearBlocked';
    return { valid: false, reason, rack: normalized, gearHits, cornerHits: gearHits };
  }

  const candidates = getRackSideCandidates(mapData, normalized);
  if (candidates.length <= 0) {
    return {
      valid: false,
      reason: 'missingSideBoard',
      rack: normalized,
      candidates
    };
  }
  return {
    valid: true,
    reason: 'ok',
    rack: normalized,
    candidates
  };
};

export const getRackAxisBindingStatus = ({ mapData = {}, rack = null } = {}) => {
  const binding = normalizeRackAxisBinding(rack?.axisBinding);
  if (!binding) return { bound: false, valid: false, binding: null, reason: 'none' };
  const candidate = getRackSideCandidates(mapData, rack).find((item) => (
    item.hostKind === binding.hostKind
    && item.componentKey === binding.componentKey
    && (!binding.side || item.side === binding.side)
    && (!Number.isInteger(binding.segmentIndex) || item.segmentIndex === binding.segmentIndex)
  ));
  if (!candidate) {
    return {
      bound: true,
      valid: false,
      binding,
      candidate: null,
      reason: 'missing_component'
    };
  }
  return {
    bound: true,
    valid: true,
    binding: {
      ...binding,
      localPosition: binding.localPosition || candidate.localPosition
    },
    candidate,
    reason: 'ok'
  };
};

const isWithinRackAxis = (value = 0, canonical = {}) => (
  value >= canonical.min - DOUBLE_SIDED_RACK_CONTACT_EPSILON
  && value <= canonical.max + DOUBLE_SIDED_RACK_CONTACT_EPSILON
);

const getRackContactRadius = (node = {}) => (
  Math.max(
    0,
    Number(node.pitchRadiusWorld ?? node.rackPitchRadiusWorld ?? node.pitchRadius) || 0
  )
);

const isRackContactOffset = (offset = 0, node = {}, epsilon = DOUBLE_SIDED_RACK_CONTACT_EPSILON) => {
  const distance = Math.abs(Number(offset) || 0);
  const radius = getRackContactRadius(node);
  return distance <= epsilon
    || Math.abs(distance - radius) <= epsilon
    || Math.abs(distance - DOUBLE_SIDED_RACK_SIDE_CONTACT_OFFSET) <= epsilon;
};

const getRackContactSideSign = (offset = 0, fallback = 1) => {
  const parsed = Number(offset) || 0;
  if (Math.abs(parsed) > DOUBLE_SIDED_RACK_CONTACT_EPSILON) return parsed >= 0 ? 1 : -1;
  return Number(fallback) < 0 ? -1 : 1;
};

export const getRackGearContacts = (rack = {}, nodes = []) => {
  const canonical = getRackCanonicalSegment(rack);
  if (canonical.length < 1) return [];
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const point = node.worldPoint || node.point;
    if (!point) return null;
    const host = node.attachmentPlacement || node.placement || {};
    const hostCenter = {
      x: Number(host.x) || 0,
      y: Number(host.y) || 0,
      z: (Number(host.z) || 0) + 0.5
    };

    if (canonical.plane === RACK_PLANES.VERTICAL) {
      const normalCoord = canonical.normalAxis === RACK_DIRECTIONS.X ? Number(point.x) || 0 : Number(point.y) || 0;
      const normalOffset = normalCoord - canonical.line;
      if (Math.abs(normalOffset) > DOUBLE_SIDED_RACK_CONTACT_EPSILON) return null;
      if (canonical.direction === RACK_DIRECTIONS.Z) {
        const tangentCoord = canonical.normalAxis === RACK_DIRECTIONS.X ? Number(point.y) || 0 : Number(point.x) || 0;
        const tangentOffset = tangentCoord - canonical.tangentLine;
        if (!isRackContactOffset(tangentOffset, node)) return null;
        if (!isWithinRackAxis(Number(point.z) || 0, canonical)) return null;
        const hostTangent = canonical.normalAxis === RACK_DIRECTIONS.X ? hostCenter.y : hostCenter.x;
        const sideSign = getRackContactSideSign(tangentOffset, hostTangent >= canonical.tangentLine ? 1 : -1);
        return {
          rack,
          node,
          sideSign,
          rackAxis: Number(point.z) || 0,
          point: { x: canonical.start.x, y: canonical.start.y, z: Number(point.z) || 0 }
        };
      }
      const zOffset = (Number(point.z) || 0) - canonical.zLine;
      if (!isRackContactOffset(zOffset, node)) return null;
      const tangentCoord = canonical.direction === RACK_DIRECTIONS.X ? Number(point.x) || 0 : Number(point.y) || 0;
      if (!isWithinRackAxis(tangentCoord, canonical)) return null;
      const sideSign = getRackContactSideSign(zOffset, hostCenter.z >= canonical.zLine ? 1 : -1);
      return {
        rack,
        node,
        sideSign,
        rackAxis: tangentCoord,
        point: canonical.direction === RACK_DIRECTIONS.X
          ? { x: tangentCoord, y: canonical.line, z: canonical.zLine }
          : { x: canonical.line, y: tangentCoord, z: canonical.zLine }
      };
    }

    if (Math.abs((Number(point.z) || 0) - canonical.z) > DOUBLE_SIDED_RACK_CONTACT_EPSILON) return null;
    if (canonical.direction === RACK_DIRECTIONS.Y) {
      const normalOffset = (Number(point.x) || 0) - canonical.line;
      if (!isRackContactOffset(normalOffset, node)) return null;
      if (!isWithinRackAxis(Number(point.y) || 0, canonical)) return null;
      const sideSign = getRackContactSideSign(normalOffset, hostCenter.x >= canonical.line ? 1 : -1);
      return {
        rack,
        node,
        sideSign,
        rackAxis: Number(point.y) || 0,
        point: { x: canonical.line, y: Number(point.y) || 0, z: canonical.z }
      };
    }
    const normalOffset = (Number(point.y) || 0) - canonical.line;
    if (!isRackContactOffset(normalOffset, node)) return null;
    if (!isWithinRackAxis(Number(point.x) || 0, canonical)) return null;
    const sideSign = getRackContactSideSign(normalOffset, hostCenter.y >= canonical.line ? 1 : -1);
    return {
      rack,
      node,
      sideSign,
      rackAxis: Number(point.x) || 0,
      point: { x: Number(point.x) || 0, y: canonical.line, z: canonical.z }
    };
  }).filter(Boolean);
};

export const getRackBindingCandidateKey = (candidate = {}) => (
  candidate?.componentKey
    ? [
      candidate.hostKind || 'tile',
      candidate.componentKey,
      candidate.side || '',
      Number.isInteger(candidate.segmentIndex) ? candidate.segmentIndex : ''
    ].join(':')
    : ''
);
