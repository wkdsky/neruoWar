import {
  assemblyHasPressureSource,
  buildMechanicalAssemblies,
  CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS,
  getAssemblyForCell,
  getGearAxisBindingStatus,
  getGearSocketKind,
  isCornerGearSocket,
  isPressureLinkedIntermediateGear,
  normalizeGearRotationDirection
} from './cityChannelMechanismRuntime';
import {
  buildGearContactGraph,
  CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
  getAxisBindingForMount,
  getGearMeshPlane,
  getGearRatioRadiusForMount,
  getGearSurfaceKey,
  getGearWorldPosition
} from './cityChannelMechanismSimulation';
import { normalizeGearSurfaceForPanel } from './cityChannelGearPressurePlateRender';

const getPlacementByComponentKey = (mapData = {}, componentKey = '') => (
  mapData.tiles?.[componentKey] || mapData.walls?.[componentKey] || null
);

const getGearAttachmentForConfig = ({
  mapData = {},
  componentKey = '',
  hostKind = 'tile',
  placement = null,
  mount = null
} = {}) => {
  const status = getGearAxisBindingStatus({
    mapData,
    placement,
    mount
  });
  const binding = status?.valid ? status.binding : null;
  if (!binding?.componentKey) {
    return {
      componentKey,
      hostKind,
      placement,
      mount,
      followsAxisBinding: false
    };
  }
  const attachmentPlacement = getPlacementByComponentKey(mapData, binding.componentKey);
  if (!attachmentPlacement) {
    return {
      componentKey,
      hostKind,
      placement,
      mount,
      followsAxisBinding: false
    };
  }
  return {
    componentKey: binding.componentKey,
    hostKind: binding.hostKind === 'wall' ? 'wall' : 'tile',
    placement: attachmentPlacement,
    mount: {
      ...mount,
      position: binding.socket,
      surface: normalizeGearSurfaceForPanel(attachmentPlacement.panelType, binding.surface || 'front')
    },
    followsAxisBinding: true
  };
};

const createGearRotationConfigNode = ({
  mapData = {},
  componentKey = '',
  hostKind = 'tile',
  placement = null,
  mount = null
} = {}) => {
  if (!componentKey || !placement || !mount?.id) return null;
  const normalizedMount = {
    ...mount,
    socketKind: mount.socketKind || getGearSocketKind(mount.position),
    rotationDirection: normalizeGearRotationDirection(mount.rotationDirection),
    axisBinding: getAxisBindingForMount({
      mapData,
      mount,
      componentKey,
      placement
    })
  };
  const attachment = getGearAttachmentForConfig({
    mapData,
    componentKey,
    hostKind,
    placement,
    mount: normalizedMount
  });
  const worldPoint = getGearWorldPosition(attachment.placement, attachment.mount);
  if (!worldPoint) return null;
  return {
    id: `${componentKey}:${mount.id}`,
    componentKey,
    hostKind,
    placement,
    attachmentComponentKey: attachment.componentKey,
    attachmentHostKind: attachment.hostKind,
    attachmentPlacement: attachment.placement,
    attachmentMount: attachment.mount,
    followsAxisBinding: attachment.followsAxisBinding,
    mountId: mount.id,
    mount: normalizedMount,
    point: worldPoint,
    worldPoint,
    meshPlane: getGearMeshPlane(attachment.placement, attachment.mount, worldPoint),
    pitchRadius: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
    pitchRadiusWorld: CITY_CHANNEL_GEAR_PITCH_RADIUS_WORLD,
    gearRatioRadius: getGearRatioRadiusForMount(normalizedMount),
    surfaceKey: getGearSurfaceKey(attachment.placement, attachment.mount),
    driveRatio: 0,
    direction: 0
  };
};

const getGearRotationConfigNodes = (mapData = {}) => {
  const nodes = [];
  Object.entries(mapData.tiles || {}).forEach(([componentKey, placement]) => {
    (placement.gearMounts || []).forEach((mount) => {
      const node = createGearRotationConfigNode({
        mapData,
        componentKey,
        hostKind: 'tile',
        placement,
        mount
      });
      if (node) nodes.push(node);
    });
  });
  Object.entries(mapData.walls || {}).forEach(([componentKey, placement]) => {
    (placement.gearMounts || []).forEach((mount) => {
      const node = createGearRotationConfigNode({
        mapData,
        componentKey,
        hostKind: 'wall',
        placement,
        mount
      });
      if (node) nodes.push(node);
    });
  });
  return nodes;
};

const isActiveGearNode = (node = null) => (
  normalizeGearRotationDirection(node?.mount?.rotationDirection)
    !== CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE
);

export const getGearRotationDirectionConfigStatus = ({
  mapData = {},
  assemblyGraph = null,
  componentKey = '',
  placement = null,
  mount = null,
  mountId = ''
} = {}) => {
  const resolvedPlacement = placement || getPlacementByComponentKey(mapData, componentKey);
  const resolvedMount = mount?.id
    ? mount
    : (resolvedPlacement?.gearMounts || []).find((item) => item.id === mountId);
  if (!componentKey || !resolvedPlacement || !resolvedMount?.id) {
    return {
      canConfigure: false,
      pressureLinked: false,
      blockedByActiveGear: false,
      activeNeighborIds: []
    };
  }

  const resolvedAssemblyGraph = assemblyGraph?.assemblies
    ? assemblyGraph
    : buildMechanicalAssemblies(mapData);
  const cornerGear = isCornerGearSocket(resolvedMount.position);
  const normalizedMount = {
    ...resolvedMount,
    axisBinding: getAxisBindingForMount({
      mapData,
      mount: resolvedMount,
      componentKey,
      placement: resolvedPlacement
    })
  };
  const bindingStatus = cornerGear
    ? getGearAxisBindingStatus({
      mapData,
      placement: resolvedPlacement,
      mount: normalizedMount
    })
    : null;
  const binding = bindingStatus?.valid ? bindingStatus.binding : null;
  const pressureLinked = cornerGear
    ? !!binding?.componentKey
      && assemblyHasPressureSource(getAssemblyForCell(resolvedAssemblyGraph, binding.componentKey), mapData)
    : isPressureLinkedIntermediateGear({
      mapData,
      assemblyGraph: resolvedAssemblyGraph,
      componentKey,
      placement: resolvedPlacement
    });
  if (!pressureLinked) {
    return {
      canConfigure: false,
      pressureLinked: false,
      blockedByActiveGear: false,
      activeNeighborIds: []
    };
  }
  if (!cornerGear) {
    return {
      canConfigure: true,
      pressureLinked: true,
      blockedByActiveGear: false,
      activeNeighborIds: []
    };
  }

  const targetId = `${componentKey}:${resolvedMount.id}`;
  const nodes = getGearRotationConfigNodes(mapData);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(targetId)) {
    return {
      canConfigure: false,
      pressureLinked: true,
      blockedByActiveGear: false,
      activeNeighborIds: []
    };
  }
  const contactGraph = buildGearContactGraph(
    nodes,
    undefined,
    Object.values(mapData.racks || {})
  );
  const activeNeighborIds = (contactGraph.get(targetId) || [])
    .filter((edge) => !edge.viaRackId)
    .map((edge) => edge.id)
    .filter((neighborId) => isActiveGearNode(nodeById.get(neighborId)));
  return {
    canConfigure: activeNeighborIds.length <= 0,
    pressureLinked: true,
    blockedByActiveGear: activeNeighborIds.length > 0,
    activeNeighborIds
  };
};

export const canConfigureGearRotationDirection = (args = {}) => (
  getGearRotationDirectionConfigStatus(args).canConfigure
);
