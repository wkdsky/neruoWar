import {
  CITY_CHANNEL_TILE_TYPES,
  createCellKey,
  createWallKey,
  parseCellKey
} from './cityChannelSchema';

export const CITY_CHANNEL_TRIGGER_MECHANISM_TYPES = new Set([
  CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE,
  CITY_CHANNEL_TILE_TYPES.PRESSURE_PLATE,
  CITY_CHANNEL_TILE_TYPES.DIRECTIONAL_PRESSURE_PLATE,
  CITY_CHANNEL_TILE_TYPES.VERTICAL_PUSH_BUTTON,
  CITY_CHANNEL_TILE_TYPES.HORIZONTAL_PUSH_BUTTON,
  CITY_CHANNEL_TILE_TYPES.ROTARY_BUTTON
]);

export const DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS = {
  rotationAngle: 90,
  rotationDirection: 'right',
  rotationSpeedDegPerSec: 20,
  triggerDelaySeconds: 0,
  autoReturn: false,
  autoReturnDelaySeconds: 0,
  durationSeconds: 1.5,
  verticalExtensionLength: 70,
  horizontalExtensionLength: 80
};

export const CITY_CHANNEL_MECHANISM_LIMITS = {
  rotationAngle: { min: 0, max: 360, step: 5 },
  rotationSpeedDegPerSec: { min: 1, max: 360, step: 1 },
  triggerDelaySeconds: { min: 0, max: 30, step: 0.5 },
  autoReturnDelaySeconds: { min: 0, max: 30, step: 0.5 },
  durationSeconds: { min: 0.5, max: 8, step: 0.5 },
  verticalExtensionLength: { min: 30, max: 140, step: 5 },
  horizontalExtensionLength: { min: 30, max: 160, step: 5 }
};

export const CITY_CHANNEL_MECHANISM_KINDS = {
  GEAR_PRESSURE_PLATE: 'gearPressurePlate',
  FIXED_AXIS_ASSEMBLY: 'fixedAxisAssembly',
  TRANSMISSION_BOARD: 'transmissionBoard',
  ACTUATOR_BOARD: 'actuatorBoard',
  VERTICAL_POP_PLATE: 'verticalPopPlate',
  HORIZONTAL_POP_PLATE: 'horizontalPopPlate',
  ROTARY_BUTTON_PLATE: 'rotaryButtonPlate'
};

const DIRECTIONS = ['north', 'east', 'south', 'west'];

const directionVector = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 }
};

const oppositeDirection = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east'
};

const clampToStep = (value, { min, max, step }) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  const clamped = Math.max(min, Math.min(max, parsed));
  return Number((Math.round(clamped / step) * step).toFixed(2));
};

export const normalizeMechanismParams = (params = {}) => ({
  rotationAngle: clampToStep(
    params.rotationAngle ?? params.angle ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationAngle,
    CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle
  ),
  rotationDirection: params.rotationDirection === 'left' ? 'left' : 'right',
  rotationSpeedDegPerSec: clampToStep(
    params.rotationSpeedDegPerSec ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.rotationSpeedDegPerSec,
    CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec
  ),
  triggerDelaySeconds: clampToStep(
    params.triggerDelaySeconds ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.triggerDelaySeconds,
    CITY_CHANNEL_MECHANISM_LIMITS.triggerDelaySeconds
  ),
  autoReturn: !!params.autoReturn,
  autoReturnDelaySeconds: clampToStep(
    params.autoReturnDelaySeconds ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.autoReturnDelaySeconds,
    CITY_CHANNEL_MECHANISM_LIMITS.autoReturnDelaySeconds
  ),
  durationSeconds: clampToStep(
    params.durationSeconds ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.durationSeconds,
    CITY_CHANNEL_MECHANISM_LIMITS.durationSeconds
  ),
  verticalExtensionLength: clampToStep(
    params.verticalExtensionLength ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.verticalExtensionLength,
    CITY_CHANNEL_MECHANISM_LIMITS.verticalExtensionLength
  ),
  horizontalExtensionLength: clampToStep(
    params.horizontalExtensionLength ?? DEFAULT_CITY_CHANNEL_MECHANISM_PARAMS.horizontalExtensionLength,
    CITY_CHANNEL_MECHANISM_LIMITS.horizontalExtensionLength
  )
});

export const isTriggerMechanismTile = (panelType) => CITY_CHANNEL_TRIGGER_MECHANISM_TYPES.has(panelType);

export const getMechanismTemplateKind = (panelType) => {
  if (panelType === CITY_CHANNEL_TILE_TYPES.GEAR_PRESSURE_PLATE) return CITY_CHANNEL_MECHANISM_KINDS.GEAR_PRESSURE_PLATE;
  if (String(panelType || '').startsWith('transmission_')) return CITY_CHANNEL_MECHANISM_KINDS.TRANSMISSION_BOARD;
  if (String(panelType || '').startsWith('actuator_')) return CITY_CHANNEL_MECHANISM_KINDS.ACTUATOR_BOARD;
  if (panelType === CITY_CHANNEL_TILE_TYPES.HORIZONTAL_PUSH_BUTTON || panelType === CITY_CHANNEL_TILE_TYPES.DIRECTIONAL_PRESSURE_PLATE) {
    return CITY_CHANNEL_MECHANISM_KINDS.HORIZONTAL_POP_PLATE;
  }
  if (panelType === CITY_CHANNEL_TILE_TYPES.ROTARY_BUTTON) {
    return CITY_CHANNEL_MECHANISM_KINDS.ROTARY_BUTTON_PLATE;
  }
  return CITY_CHANNEL_MECHANISM_KINDS.VERTICAL_POP_PLATE;
};

export const getMechanismParamKey = (cell) => (
  cell ? createCellKey(cell.x, cell.y, cell.z) : ''
);

const rotateDirection = (direction, rotation = 0, flipped = false) => {
  let index = DIRECTIONS.indexOf(direction);
  if (index < 0) return direction;
  if (flipped) {
    if (direction === 'east') index = DIRECTIONS.indexOf('west');
    else if (direction === 'west') index = DIRECTIONS.indexOf('east');
  }
  const steps = Math.round((((Number(rotation) || 0) % 360 + 360) % 360) / 90) % 4;
  return DIRECTIONS[(index + steps) % 4];
};

const rotateLocalPosition = (position = {}, rotation = 0, flipped = false) => {
  let x = Number(position.x) || 0;
  let y = Number(position.y) || 0;
  if (flipped) x *= -1;
  const steps = Math.round((((Number(rotation) || 0) % 360 + 360) % 360) / 90) % 4;
  for (let index = 0; index < steps; index += 1) {
    const nextX = -y;
    y = x;
    x = nextX;
  }
  return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), z: Number(position.z) || 0 };
};

export const getWorldTransmissionPorts = (tile = {}, componentKey = '') => {
  const ports = Array.isArray(tile.transmissionSkeleton?.ports) ? tile.transmissionSkeleton.ports : [];
  return ports.map((port) => ({
    ...port,
    componentKey: componentKey || createCellKey(tile.x, tile.y, tile.z),
    worldDirection: rotateDirection(port.direction, tile.rotation || 0, !!tile.flipped),
    worldLocalPosition: rotateLocalPosition(port.localPosition, tile.rotation || 0, !!tile.flipped)
  }));
};

export const getGearMountLocalPosition = (position = 'center') => {
  const lookup = {
    center: { x: 0, y: 0, z: 0 },
    corner_ne: { x: 0.32, y: -0.32, z: 0 },
    corner_nw: { x: -0.32, y: -0.32, z: 0 },
    corner_se: { x: 0.32, y: 0.32, z: 0 },
    corner_sw: { x: -0.32, y: 0.32, z: 0 }
  };
  return lookup[position] || lookup.center;
};

const getNeighborKeyForPort = (tile, port) => {
  const offset = directionVector[port.worldDirection];
  if (!offset) return '';
  return createCellKey(tile.x + offset.x, tile.y + offset.y, tile.z);
};

const arePortsAligned = (fromPort, toPort) => {
  if (!fromPort || !toPort) return false;
  if (toPort.worldDirection !== oppositeDirection[fromPort.worldDirection]) return false;
  const fromPos = fromPort.worldLocalPosition || {};
  const toPos = toPort.worldLocalPosition || {};
  if (fromPort.worldDirection === 'north' || fromPort.worldDirection === 'south') {
    return Math.abs((fromPos.x || 0) - (toPos.x || 0)) <= 0.08;
  }
  return Math.abs((fromPos.y || 0) - (toPos.y || 0)) <= 0.08;
};

const addEdge = (graph, a, b, meta) => {
  graph.set(a, graph.get(a) || []);
  graph.set(b, graph.get(b) || []);
  graph.get(a).push({ key: b, ...meta });
  graph.get(b).push({ key: a, ...meta, from: meta.to, to: meta.from });
};

export const buildMechanicalAssemblies = (mapData = {}) => {
  const tiles = mapData.tiles || {};
  const walls = mapData.walls || {};
  const components = { ...tiles, ...walls };
  const graph = new Map();
  const portByTileKey = new Map();
  const warnings = [];
  const connectableKeys = new Set();

  Object.entries(components).forEach(([key, tile]) => {
    const ports = getWorldTransmissionPorts(tile, key);
    const gearMounts = Array.isArray(tile.gearMounts) ? tile.gearMounts : [];
    if (ports.length > 0 || gearMounts.length > 0) {
      connectableKeys.add(key);
      graph.set(key, graph.get(key) || []);
      portByTileKey.set(key, ports);
    }
  });

  connectableKeys.forEach((key) => {
    const tile = components[key];
    const ports = portByTileKey.get(key) || [];
    ports.forEach((port) => {
      const targetKey = getNeighborKeyForPort(tile, port);
      const candidateKeys = [];
      if (targetKey && connectableKeys.has(targetKey)) candidateKeys.push(targetKey);
      if (!tile.edge && port.worldDirection) {
        const ownWallKey = createWallKey(tile.x, tile.y, tile.z, port.worldDirection);
        const neighbor = directionVector[port.worldDirection];
        const neighborWallKey = neighbor
          ? createWallKey(tile.x + neighbor.x, tile.y + neighbor.y, tile.z, oppositeDirection[port.worldDirection])
          : '';
        [ownWallKey, neighborWallKey].forEach((wallKey) => {
          if (wallKey && connectableKeys.has(wallKey)) candidateKeys.push(wallKey);
        });
      }
      candidateKeys.forEach((candidateKey) => {
        if (candidateKey === key) return;
        const targetPorts = portByTileKey.get(candidateKey) || [];
        const targetPort = targetPorts.find((item) => arePortsAligned(port, item));
        if (!targetPort) return;
        if (key < candidateKey) {
          addEdge(graph, key, candidateKey, {
            from: { componentKey: key, portId: port.id },
            to: { componentKey: candidateKey, portId: targetPort.id }
          });
        }
      });
    });
  });

  const assemblies = [];
  const assemblyByComponentKey = {};
  const visited = new Set();
  connectableKeys.forEach((key) => {
    if (visited.has(key)) return;
    const queue = [key];
    const componentKeys = [];
    visited.add(key);
    while (queue.length > 0) {
      const current = queue.shift();
      componentKeys.push(current);
      (graph.get(current) || []).forEach(({ key: nextKey }) => {
        if (visited.has(nextKey)) return;
        visited.add(nextKey);
        queue.push(nextKey);
      });
    }
    const id = `assembly_${assemblies.length + 1}`;
    const gearMounts = componentKeys.flatMap((componentKey) => {
      const tile = components[componentKey];
      return (Array.isArray(tile.gearMounts) ? tile.gearMounts : []).map((mount) => ({
        ...mount,
        componentKey,
        cell: parseCellKey(componentKey)
      }));
    });
    const fixedAxes = gearMounts.filter((mount) => mount.axisType === 'fixedAxis');
    const assembly = {
      id,
      componentKeys,
      edges: componentKeys.flatMap((componentKey) => (graph.get(componentKey) || []).map((edge) => ({ componentKey, ...edge }))),
      gearMounts,
      fixedAxes,
      warnings: []
    };
    if (componentKeys.length === 1 && (portByTileKey.get(componentKeys[0]) || []).length > 0 && fixedAxes.length <= 0) {
      assembly.warnings.push('该传动骨骼未连接到固定轴。');
    }
    if (fixedAxes.length <= 0 && gearMounts.length > 0) {
      assembly.warnings.push('承动结构没有固定轴，运行预览不会带动整体旋转。');
    }
    assemblies.push(assembly);
    componentKeys.forEach((componentKey) => {
      assemblyByComponentKey[componentKey] = id;
    });
  });

  Object.entries(components).forEach(([key, tile]) => {
    if (tile.boardRole === 'power_source' && !assemblyByComponentKey[key]) {
      warnings.push({ componentKey: key, message: '齿轮压力板没有连接到有效传动骨骼。' });
    }
  });

  return {
    assemblies,
    assemblyByComponentKey,
    graph,
    warnings
  };
};

export const getAssemblyForCell = (assemblyGraph, cell) => {
  const key = typeof cell === 'string' ? cell : getMechanismParamKey(cell);
  const id = assemblyGraph?.assemblyByComponentKey?.[key];
  return (assemblyGraph?.assemblies || []).find((assembly) => assembly.id === id) || null;
};

export const findFixedAxisForTrigger = (mapData = {}, cell) => {
  const assemblyGraph = buildMechanicalAssemblies(mapData);
  const sourceKey = getMechanismParamKey(cell);
  const sourceTile = mapData.tiles?.[sourceKey];
  const sourceAssembly = getAssemblyForCell(assemblyGraph, sourceKey);
  const fixedAxis = sourceAssembly?.fixedAxes?.[0] || null;
  if (sourceTile?.boardRole === 'power_source' && !fixedAxis) {
    return {
      ok: false,
      reason: 'no_connected_fixed_axis',
      message: '齿轮压力板没有连接到带固定轴的机械整体。',
      assemblyGraph
    };
  }
  const fallbackFixedAxis = fixedAxis
    || assemblyGraph.assemblies.find((assembly) => assembly.fixedAxes.length > 0)?.fixedAxes?.[0]
    || null;
  if (!fallbackFixedAxis) {
    return {
      ok: false,
      reason: 'no_fixed_axis',
      message: '当前传动网络中没有可驱动的固定轴。',
      assemblyGraph
    };
  }
  const assembly = getAssemblyForCell(assemblyGraph, fallbackFixedAxis.componentKey);
  return {
    ok: !!assembly,
    reason: assembly ? 'ok' : 'missing_assembly',
    message: assembly ? '已找到固定轴。' : '固定轴没有所属机械整体。',
    fixedAxis: fallbackFixedAxis,
    assembly,
    assemblyGraph
  };
};
