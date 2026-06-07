import {
  CITY_CHANNEL_TOOLS,
  createCellKey,
  createWallKey
} from '../cityChannelSchema';
import {
  CITY_CHANNEL_MECHANISM_KINDS,
  findFixedAxisForTrigger,
  getAssemblyForCell,
  getGearMountLocalPosition,
  getMechanismTemplateKind,
  isTriggerMechanismTile,
  normalizeMechanismParams
} from '../cityChannelMechanismRuntime';
import { isPlacementVisible as isCityChannelPlacementVisible } from './cityChannelPhaserVisibility';
import { getMechanismScreenAnchor } from './cityChannelInspection';
import {
  buildGearContactGraph as buildGearContactGraphModel,
  getAssemblyComponentDistances as getAssemblyComponentDistancesModel,
  getDrivenGearRoots as getDrivenGearRootsModel,
  getGearContactThreshold as getGearContactThresholdModel,
  getGearPhase,
  getGearSurfaceKey as getGearSurfaceKeyModel,
  resolveDrivenGearNodes as resolveDrivenGearNodesModel
} from './cityChannelGears';
import { GEAR_PITCH_RADIUS_LOCAL } from './cityChannelPhaserSceneUtils';
import {
  createAxisBindingRuntimeEntryFromGearNode,
  createRackTranslationRuntimeEntries,
  createMechanismRuntimeSnapshot,
  findRackTranslationObstruction,
  findRotationObstruction,
  getAllowedRotationAngle,
  getAxisBindingForMount,
  getFixedAxisWorldAnchor,
  getRackContactLimitedTranslationDistance,
  getGearMeshPlane,
  getGearTeeth,
  getGearWorldPosition,
  isDrivenGearAxisBindingActive,
  isRackTranslationRuntimeEntry
} from '../cityChannelMechanismSimulation';

export const triggerMechanismFromHit = (scene, hit) => {
  if (!hit?.cell || !isTriggerMechanismTile(hit.panelType)) return false;
  try {
    if (!scene.isSelectedHit(hit)) scene.selectHit(hit, false);
    if (scene.activeTool === CITY_CHANNEL_TOOLS.BROWSE) scene.config.onRequestTool?.(CITY_CHANNEL_TOOLS.SELECT);
    const key = hit.type === 'wall'
      ? createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge)
      : createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
    const params = normalizeMechanismParams(scene.mechanismParams?.[key]);
    scene.config.onMechanismPanelRequest?.({
      key,
      cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
      edge: hit.type === 'wall' ? hit.edge : null,
      panelType: hit.panelType,
      params,
      anchor: getMechanismScreenAnchor(scene, hit.cell)
    });
  } catch (error) {
    if (!scene.isSelectedHit(hit)) scene.selectHit(hit, false);
    scene.config.onToast?.(`机关面板打开失败：${error?.message || 'unknown error'}`, 'error');
  }
  return true;
};

export const triggerMechanismAtCell = (scene, cell, paramsOverride = null) => {
  if (!cell) return false;
  const key = createCellKey(cell.x, cell.y, cell.z);
  const tile = scene.mapData.tiles?.[key];
  if (!tile) return false;
  if (!isTriggerMechanismTile(tile.panelType)) return false;
  scene.cancelMechanismRuntimePreview?.({ silent: true });
  const params = normalizeMechanismParams(paramsOverride || scene.mechanismParams?.[key]);
  let driveStarted = false;
  const startDrive = () => {
    if (driveStarted) return false;
    driveStarted = true;
    const graph = scene.getMechanicalAssemblyGraph();
    const sourceAssembly = getAssemblyForCell(graph, key);
    if (sourceAssembly?.gearMounts?.length > 0) {
      playAssemblyGearRotation(scene, sourceAssembly, key, params);
      return true;
    }
    const drive = findFixedAxisForTrigger(scene.mapData, cell);
    if (!drive.ok || !drive.assembly || !drive.fixedAxis) {
      scene.config.onToast?.(drive.message || '没有可驱动的承动组件。', 'error');
      return false;
    }
    playAssemblyRotation(scene, drive.assembly, drive.fixedAxis, params);
    return true;
  };
  if (isTriggerMechanismTile(tile.panelType)) {
    const actionPlayed = playMechanismAction(scene, tile, key, params, { onEngage: startDrive });
    playInspectMechanismAction(scene, tile, key, params);
    if (!actionPlayed) startDrive();
  }
  return true;
};

export const requestMechanismPanel = (scene, hit) => {
  if (!hit?.cell) {
    scene.config.onMechanismPanelRequest?.(null);
    return;
  }
  const key = hit.type === 'wall'
    ? createWallKey(hit.cell.x, hit.cell.y, hit.cell.z, hit.edge)
    : createCellKey(hit.cell.x, hit.cell.y, hit.cell.z);
  scene.config.onMechanismPanelRequest?.({
    key,
    cell: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z },
    edge: hit.type === 'wall' ? hit.edge : null,
    panelType: hit.panelType,
    params: normalizeMechanismParams(scene.mechanismParams?.[key]),
    anchor: getMechanismScreenAnchor(scene, hit.cell)
  });
};

export const notifyMechanismPreviewProgress = (scene, key, tile, progress, params) => {
  scene.config.onMechanismPreviewProgress?.({
    key,
    panelType: tile?.panelType,
    progress: Math.max(0, Math.min(1, Number(progress) || 0)),
    params: normalizeMechanismParams(params),
    kind: tile ? getMechanismTemplateKind(tile.panelType) : null
  });
};

export const playPreviewAnimation = (scene, cell, paramsOverride = null) => (
  triggerMechanismAtCell(scene, cell, paramsOverride)
);

const getBasePlacementsForAssembly = (scene, assembly) => (
  (assembly?.componentKeys || []).reduce((placements, componentKey) => {
    const placement = scene.mapData.tiles?.[componentKey] || scene.mapData.walls?.[componentKey];
    if (placement) placements[componentKey] = placement;
    return placements;
  }, {})
);

const createFixedAxisRuntimeEntry = (scene, assembly, fixedMount, {
  pivotWorld = null,
  driveRatio = 1
} = {}) => {
  if (!assembly || !fixedMount) return null;
  const basePlacement = scene.mapData.tiles?.[fixedMount.componentKey] || scene.mapData.walls?.[fixedMount.componentKey] || null;
  const resolvedPivot = pivotWorld || getGearWorldPosition(basePlacement, fixedMount) || getFixedAxisWorldAnchor(scene.mapData, fixedMount);
  return {
    assembly,
    componentKey: fixedMount.componentKey,
    fixedAxis: fixedMount,
    fixedMount,
    pivotWorld: resolvedPivot,
    anchor: resolvedPivot,
    anchorLocal: getGearMountLocalPosition(fixedMount.position),
    basePlacement,
    basePlacements: getBasePlacementsForAssembly(scene, assembly),
    baseRotation: basePlacement?.edge ? 0 : (Number(basePlacement?.rotation) || 0),
    driveRatio: Number(driveRatio) || 1,
    phase: Number(fixedMount.phase) || 0
  };
};

export const playAssemblyRotation = (scene, assembly, fixedAxis, params) => {
  if (!assembly || !fixedAxis) return false;
  const runtimeEntry = createFixedAxisRuntimeEntry(scene, assembly, fixedAxis);
  const anchorWorld = runtimeEntry?.pivotWorld || getFixedAxisWorldAnchor(scene.mapData, fixedAxis);
  const members = assembly.componentKeys.flatMap((componentKey) => ([
    scene.renderObjects.get(`tile:${componentKey}`),
    scene.renderObjects.get(`wall:${componentKey}`),
    scene.renderObjects.get(`gear-far:tile:${componentKey}`),
    scene.renderObjects.get(`gear-near:tile:${componentKey}`),
    scene.renderObjects.get(`gear-far:wall:${componentKey}`),
    scene.renderObjects.get(`gear-near:wall:${componentKey}`),
    scene.renderObjects.get(`edge-overlay:tile:${componentKey}`),
    scene.renderObjects.get(`edge-overlay:wall:${componentKey}`),
    scene.renderObjects.get(`mechanism:${componentKey}`),
    scene.renderObjects.get(`tile-label:${componentKey}`)
  ].filter(Boolean)));
  if (members.length <= 0) return false;

  const normalized = normalizeMechanismParams(params);
  const targetAngle = normalized.rotationAngle;
  const obstruction = findRotationObstruction({
    mapData: scene.mapData,
    assembly,
    anchor: anchorWorld,
    fixedMount: runtimeEntry?.fixedMount || fixedAxis,
    targetAngle
  });
  const allowedRotation = getAllowedRotationAngle({ targetAngle, obstruction });
  if (!allowedRotation.canRotate) {
    scene.clearMechanismRuntimeSnapshot?.();
    scene.flashMechanismObstruction?.(obstruction);
    scene.config.onToast?.('旁边有遮挡物，当前结构没有足够转动空间。', 'error');
    return false;
  }
  const blockedTargetAngle = allowedRotation.angle;
  const duration = Math.max(120, Math.round((Math.max(1, normalized.rotationAngle) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
  const forwardDuration = Math.max(80, Math.round(duration * (Math.abs(blockedTargetAngle) / Math.max(1, Math.abs(targetAngle)))));
  const delay = Math.round(normalized.triggerDelaySeconds * 1000);
  const applyAngle = (degrees) => {
    const snapshot = createMechanismRuntimeSnapshot({
      mapData: scene.mapData,
      assemblyEntries: [runtimeEntry || { assembly, fixedAxis, anchor: anchorWorld }],
      sourceAngle: degrees,
      obstruction
    });
    scene.setMechanismRuntimeSnapshot?.(snapshot);
    scene.applyMechanismRuntimePlacementTransforms?.(assembly, runtimeEntry || fixedAxis, degrees);
  };
  const motion = { angle: 0 };
  scene.registerMechanismPreviewTarget?.(motion);
  scene.tweens.killTweensOf(motion);
  scene.tweens.add({
    targets: motion,
    angle: blockedTargetAngle,
    delay,
    duration: forwardDuration,
    ease: 'sine.inout',
    onUpdate: () => {
      applyAngle(motion.angle);
      scene.config.onMechanismPreviewProgress?.({
        key: fixedAxis.componentKey,
        panelType: scene.mapData.tiles?.[fixedAxis.componentKey]?.panelType,
        progress: Math.min(1, Math.abs(motion.angle) / Math.max(1, normalized.rotationAngle)),
        params: normalized,
        kind: CITY_CHANNEL_MECHANISM_KINDS.FIXED_AXIS_ASSEMBLY,
        assemblyId: assembly.id
      });
    },
    onComplete: () => {
      if (obstruction && !normalized.autoReturn) {
        scene.config.onToast?.(`转动受阻，已停在 ${Math.abs(blockedTargetAngle).toFixed(1)} 度。`, 'error');
        return;
      }
      if (!normalized.autoReturn) return;
      const returnTimer = scene.time.delayedCall(Math.round(normalized.autoReturnDelaySeconds * 1000), () => {
        scene.tweens.add({
          targets: motion,
          angle: 0,
          duration: forwardDuration,
          ease: 'sine.inout',
          onUpdate: () => applyAngle(motion.angle),
          onComplete: () => {
            applyAngle(0);
            scene.clearMechanismRuntimeSnapshot?.();
            scene.config.onMechanismPreviewProgress?.(null);
          }
        });
      });
      scene.registerMechanismPreviewTimer?.(returnTimer);
    }
  });
  scene.config.onToast?.(`${assembly.id} 运行预览：固定轴驱动 ${assembly.componentKeys.length} 块板材。`, 'success');
  return true;
};

export const getGearHostKindAndPlacement = (scene, componentKey) => {
  const tile = scene.mapData.tiles?.[componentKey];
  if (tile) return { hostKind: 'tile', placement: tile };
  const wall = scene.mapData.walls?.[componentKey];
  if (wall) return { hostKind: 'wall', placement: wall };
  return { hostKind: null, placement: null };
};

export const getAssemblyGearNodes = (scene, assembly) => {
  if (!assembly?.gearMounts?.length) return [];
  return getGearNodesForMounts(scene, assembly.gearMounts);
};

export const getGearSurfaceKey = (placement, mount = {}) => getGearSurfaceKeyModel(placement, mount);

export const getGearPitchRadiusAtPoint = (scene, placement, mount = {}, point = null) => {
  if (!placement || !mount || !point) return 24;
  const local = getGearMountLocalPosition(mount.position);
  const edgePoint = scene.mapGearLocalPointToSurface(
    placement,
    { x: (local.x || 0) + GEAR_PITCH_RADIUS_LOCAL, y: local.y || 0 },
    { surface: mount.surface || 'front', allowOverflow: true }
  );
  if (!edgePoint) return 24;
  return Math.max(14, Math.min(34, Math.hypot(edgePoint.x - point.x, edgePoint.y - point.y)));
};

export const getGearRatioRadiusForMount = (mount = {}) => (
  Math.max(1, getGearTeeth(mount))
);

export const getGearNodesForMounts = (scene, mounts = []) => {
  if (!Array.isArray(mounts) || mounts.length <= 0) return [];
  return mounts.map((mount) => {
    const { hostKind, placement } = getGearHostKindAndPlacement(scene, mount.componentKey);
    if (!hostKind || !placement) return null;
    const liveMount = (placement.gearMounts || []).find((item) => item.id === mount.id) || mount;
    const point = scene.getGearMountPoint(placement, liveMount);
    if (!point) return null;
    const worldPoint = getGearWorldPosition(placement, liveMount);
    return {
      id: `${mount.componentKey}:${mount.id}`,
      componentKey: mount.componentKey,
      hostKind,
      placement,
      mountId: liveMount.id,
      mount: {
        ...liveMount,
        axisBinding: getAxisBindingForMount({
          mapData: scene.mapData,
          mount: liveMount,
          componentKey: mount.componentKey,
          placement
        })
      },
      point,
      worldPoint,
      meshPlane: getGearMeshPlane(placement, liveMount, worldPoint),
      pitchRadius: getGearPitchRadiusAtPoint(scene, placement, liveMount, point),
      pitchRadiusWorld: GEAR_PITCH_RADIUS_LOCAL,
      gearRatioRadius: getGearRatioRadiusForMount(liveMount),
      surfaceKey: getGearSurfaceKey(placement, liveMount),
      driveRatio: 0,
      direction: 0
    };
  }).filter(Boolean);
};

export const getAllGearNodes = (scene, { visibleOnly = false } = {}) => {
  const mounts = [];
  Object.entries(scene.mapData.tiles || {}).forEach(([componentKey, tile]) => {
    if (visibleOnly && !isCityChannelPlacementVisible(tile, {
      mapData: scene.mapData,
      visibleLayerCutoff: scene.visibleLayerCutoff
    })) return;
    (tile.gearMounts || []).forEach((mount) => mounts.push({ ...mount, componentKey }));
  });
  Object.entries(scene.mapData.walls || {}).forEach(([componentKey, wall]) => {
    if (visibleOnly && !isCityChannelPlacementVisible(wall, {
      mapData: scene.mapData,
      visibleLayerCutoff: scene.visibleLayerCutoff
    })) return;
    (wall.gearMounts || []).forEach((mount) => mounts.push({ ...mount, componentKey }));
  });
  return getGearNodesForMounts(scene, mounts);
};

export const getGearContactThreshold = () => getGearContactThresholdModel();

export const buildGearContactGraph = (nodes = [], racks = []) => (
  buildGearContactGraphModel(nodes, getGearContactThreshold(), racks)
);

export const getAssemblyComponentDistances = (assembly, sourceComponentKey) => (
  getAssemblyComponentDistancesModel(assembly, sourceComponentKey)
);

export const getDrivenGearRoots = (assembly, nodes = [], sourceComponentKey = '') => (
  getDrivenGearRootsModel(assembly, nodes, sourceComponentKey)
);

export const resolveDrivenGearNodes = (scene, assembly, sourceComponentKey = '') => {
  const assemblyNodes = getAssemblyGearNodes(scene, assembly);
  if (assemblyNodes.length <= 0) return [];
  const allNodes = getAllGearNodes(scene);
  const contactGraph = buildGearContactGraph(allNodes, Object.values(scene.mapData?.racks || {}));
  return resolveDrivenGearNodesModel({
    assembly,
    assemblyNodes,
    allNodes,
    contactGraph,
    sourceComponentKey
  });
};

export const setGearMountPhases = (scene, nodes = [], angle = 0, basePhases = new Map(), options = {}) => {
  const runtimeGearStates = {};
  const dirtyHosts = new Map();
  nodes.forEach((node) => {
    const { hostKind, placement } = getGearHostKindAndPlacement(scene, node.componentKey);
    if (!hostKind || !placement || !Array.isArray(placement.gearMounts)) return;
    const mount = placement.gearMounts.find((item) => item.id === node.mountId);
    if (!mount) return;
    const base = basePhases.get(node.id) || 0;
    const resolvedAxisBinding = getAxisBindingForMount({
      mapData: scene.mapData,
      mount,
      componentKey: node.componentKey,
      placement
    });
    const axisBinding = node.axisBindingSuppressed ? null : resolvedAxisBinding;
    runtimeGearStates[node.id] = {
      componentKey: node.componentKey,
      mountId: node.mountId,
      axisType: axisBinding ? 'bound' : (mount.axisType || 'freeAxis'),
      socketKind: node.mount?.socketKind,
      axisBinding,
      phase: getGearPhase(node, angle, base),
      speedRatio: Number(node.driveRatio) || 1,
      torqueRatio: Number(node.driveRatio) ? 1 / Math.abs(node.driveRatio) : 1,
      teeth: getGearTeeth(mount)
    };
    dirtyHosts.set(node.componentKey, { hostKind, placement });
  });
  if (options.publish !== false) {
    scene.setMechanismRuntimeSnapshot?.({
      sourceAngle: angle,
      placements: {},
      gears: runtimeGearStates,
      sync: [],
      obstruction: null
    });
  } else {
    scene.mergeMechanismRuntimeGearStates?.(runtimeGearStates);
  }
  dirtyHosts.forEach(({ hostKind, placement }, hostKey) => {
    scene.redrawMountedGearHostLayers(hostKind, hostKey, placement);
  });
  scene.sortMapLayer();
};

export const getGearRotationTransmissionEventKeys = (assembly, assemblyEntries = []) => {
  const eventKeys = new Set(assembly?.componentKeys || []);
  assemblyEntries.forEach((entry) => {
    (entry?.assembly?.componentKeys || []).forEach((componentKey) => {
      eventKeys.add(componentKey);
    });
  });
  return eventKeys;
};

export const playAssemblyGearRotation = (scene, assembly, sourceComponentKey, params) => {
  const nodes = resolveDrivenGearNodes(scene, assembly, sourceComponentKey);
  if (nodes.length <= 0) return false;
  const allGearNodes = getAllGearNodes(scene);
  const graph = scene.getMechanicalAssemblyGraph?.();
  const seenAxisBindings = new Set();
  const fixedNodes = nodes.filter((node) => isDrivenGearAxisBindingActive(node, assembly));
  const axisEntries = fixedNodes.map((node) => {
    const axisBinding = getAxisBindingForMount({
      mapData: scene.mapData,
      mount: node.mount,
      componentKey: node.componentKey,
      placement: node.placement,
      pivotWorld: getGearWorldPosition(node.placement, node.mount)
    });
    if (!axisBinding) return null;
    const entryKey = `${axisBinding.componentKey}:${axisBinding.socket}:${node.componentKey}:${node.mountId}`;
    if (seenAxisBindings.has(entryKey)) return null;
    seenAxisBindings.add(entryKey);
    return createAxisBindingRuntimeEntryFromGearNode({
      mapData: scene.mapData,
      assemblyGraph: graph,
      gearNode: node,
      axisBinding,
      pivotWorld: getGearWorldPosition(node.placement, node.mount),
      driveRatio: node.driveRatio || 1
    });
  }).filter(Boolean);
  const rackEntries = createRackTranslationRuntimeEntries({
    mapData: scene.mapData,
    assemblyGraph: graph,
    nodes
  });
  const assemblyEntries = [
    ...axisEntries,
    ...rackEntries
  ].filter((entry, index, entries) => (
    entries.findIndex((item) => (
      (item.componentKey || item.sourceRackId || item.rackId)
      === (entry.componentKey || entry.sourceRackId || entry.rackId)
    )) === index
  ));
  if (assemblyEntries.length <= 0) {
    const normalized = normalizeMechanismParams(params);
    const targetAngle = normalized.rotationAngle;
    const duration = Math.max(120, Math.round((Math.max(1, normalized.rotationAngle) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
    const delay = Math.round(normalized.triggerDelaySeconds * 1000);
    const basePhases = new Map(nodes.map((node) => [node.id, Number(node.mount?.phase) || 0]));
    const motion = { angle: 0 };
    scene.registerMechanismPreviewTarget?.(motion);
    scene.tweens.killTweensOf(motion);
    scene.tweens.add({
      targets: motion,
      angle: targetAngle,
      delay,
      duration,
      ease: 'sine.inout',
      onUpdate: () => {
        setGearMountPhases(scene, nodes, motion.angle, basePhases);
        scene.config.onMechanismPreviewProgress?.({
          key: sourceComponentKey,
          panelType: scene.mapData.tiles?.[sourceComponentKey]?.panelType,
          progress: Math.min(1, Math.abs(motion.angle) / Math.max(1, normalized.rotationAngle)),
          params: normalized,
          kind: CITY_CHANNEL_MECHANISM_KINDS.FIXED_AXIS_ASSEMBLY,
          assemblyId: assembly.id
        });
      },
      onComplete: () => {
        setGearMountPhases(scene, nodes, targetAngle, basePhases);
        if (!normalized.autoReturn) return;
        const returnTimer = scene.time.delayedCall(Math.round(normalized.autoReturnDelaySeconds * 1000), () => {
          scene.tweens.add({
            targets: motion,
            angle: 0,
            duration,
            ease: 'sine.inout',
            onUpdate: () => setGearMountPhases(scene, nodes, motion.angle, basePhases),
            onComplete: () => {
              setGearMountPhases(scene, nodes, 0, basePhases);
              scene.clearMechanismRuntimeSnapshot?.();
              scene.config.onMechanismPreviewProgress?.(null);
            }
          });
        });
        scene.registerMechanismPreviewTimer?.(returnTimer);
      }
    });
    scene.config.onToast?.(`${assembly.id} 齿轮传动预览：${nodes.length} 个齿轮转动。`, 'success');
    return true;
  }
  const normalized = normalizeMechanismParams(params);
  const targetAngle = normalized.rotationAngle;
  const obstructions = assemblyEntries.map((entry) => {
    if (isRackTranslationRuntimeEntry(entry)) {
      const targetDistance = getRackContactLimitedTranslationDistance(entry, targetAngle);
      const obstruction = findRackTranslationObstruction({
        mapData: scene.mapData,
        assembly: entry.assembly,
        translationAxis: entry.translationAxis,
        targetDistance
      });
      if (!obstruction) return null;
      const distancePerSourceAngle = Math.abs(targetAngle) > 0.000001
        ? targetDistance / targetAngle
        : 0;
      const sourceAngle = Math.abs(distancePerSourceAngle) > 0.000001
        ? obstruction.distance / distancePerSourceAngle
        : targetAngle;
      return {
        ...obstruction,
        assemblyId: entry.assembly?.id,
        rackId: entry.rackId || entry.sourceRackId,
        linearDistance: obstruction.distance,
        sourceAngle
      };
    }
    const driveRatio = Number(entry.driveRatio) || 1;
    const obstruction = findRotationObstruction({
      mapData: scene.mapData,
      assembly: entry.assembly,
      anchor: entry.anchor,
      fixedMount: entry.fixedMount,
      targetAngle: targetAngle * driveRatio
    });
    if (!obstruction) return null;
    return {
      ...obstruction,
      assemblyId: entry.assembly?.id,
      fixedAxisId: entry.fixedAxis?.id,
      assemblyAngle: obstruction.angle,
      sourceAngle: obstruction.angle / driveRatio
    };
  }).filter(Boolean);
  const obstruction = obstructions.sort((a, b) => Math.abs(a.sourceAngle) - Math.abs(b.sourceAngle))[0] || null;
  const limitingObstruction = obstruction
    ? { ...obstruction, angle: obstruction.sourceAngle }
    : null;
  const allowedRotation = getAllowedRotationAngle({
    targetAngle,
    obstruction: limitingObstruction
  });
  if (limitingObstruction || !allowedRotation.canRotate) {
    scene.clearMechanismRuntimeSnapshot?.();
    scene.flashMechanismObstruction?.(limitingObstruction);
    scene.config.onToast?.('旁边有遮挡物，当前齿轮组没有足够转动空间。', 'error');
    return false;
  }
  const blockedTargetAngle = allowedRotation.angle;
  const duration = Math.max(120, Math.round((Math.max(1, normalized.rotationAngle) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
  const forwardDuration = Math.max(80, Math.round(duration * (Math.abs(blockedTargetAngle) / Math.max(1, Math.abs(targetAngle)))));
  const delay = Math.round(normalized.triggerDelaySeconds * 1000);
  const phaseNodeById = new Map();
  [...allGearNodes, ...nodes].forEach((node) => {
    if (node?.id && !phaseNodeById.has(node.id)) phaseNodeById.set(node.id, node);
  });
  const basePhases = new Map([...phaseNodeById.values()].map((node) => [node.id, Number(node.mount?.phase) || 0]));
  const applyRuntimeState = (angle) => {
    const snapshot = createMechanismRuntimeSnapshot({
      mapData: scene.mapData,
      assemblyEntries,
      gearNodes: nodes,
      rackContactGearNodes: allGearNodes,
      sourceAngle: angle,
      basePhases,
      obstruction: limitingObstruction
    });
    scene.setMechanismRuntimeSnapshot?.(snapshot);
    setGearMountPhases(scene, nodes, angle, basePhases, { publish: false });
    assemblyEntries.forEach((entry) => {
      scene.applyMechanismRuntimePlacementTransforms?.(
        entry.assembly,
        entry,
        isRackTranslationRuntimeEntry(entry) ? angle : (Number(entry.driveRatio) || 1) * angle
      );
    });
  };
  const motion = { angle: 0 };
  scene.registerMechanismPreviewTarget?.(motion);
  scene.tweens.killTweensOf(motion);
  scene.tweens.add({
    targets: motion,
    angle: blockedTargetAngle,
    delay,
    duration: forwardDuration,
    ease: 'sine.inout',
    onUpdate: () => {
      applyRuntimeState(motion.angle);
      scene.config.onMechanismPreviewProgress?.({
        key: sourceComponentKey,
        panelType: scene.mapData.tiles?.[sourceComponentKey]?.panelType,
        progress: Math.min(1, Math.abs(motion.angle) / Math.max(1, normalized.rotationAngle)),
        params: normalized,
        kind: CITY_CHANNEL_MECHANISM_KINDS.FIXED_AXIS_ASSEMBLY,
        assemblyId: assembly.id
      });
    },
    onComplete: () => {
      applyRuntimeState(blockedTargetAngle);
      if (limitingObstruction && !normalized.autoReturn) {
        scene.config.onToast?.(`齿轮传动受阻，已停在 ${Math.abs(blockedTargetAngle).toFixed(1)} 度。`, 'error');
        return;
      }
      if (!normalized.autoReturn) return;
      const returnTimer = scene.time.delayedCall(Math.round(normalized.autoReturnDelaySeconds * 1000), () => {
        scene.tweens.add({
          targets: motion,
          angle: 0,
          duration: forwardDuration,
          ease: 'sine.inout',
          onUpdate: () => applyRuntimeState(motion.angle),
          onComplete: () => {
            applyRuntimeState(0);
            scene.clearMechanismRuntimeSnapshot?.();
            scene.config.onMechanismPreviewProgress?.(null);
          }
        });
      });
      scene.registerMechanismPreviewTimer?.(returnTimer);
    }
  });
  scene.config.onToast?.(`${assembly.id} 齿轮传动预览：${nodes.length} 个齿轮转动。`, 'success');
  return true;
};

export const playMechanismAction = (scene, tile, key, params, options = {}) => {
  if (!tile || !key) return false;
  const object = scene.renderObjects.get(`mechanism:${key}`);
  const runtime = object?.getData('runtime');
  if (!object || !runtime) return false;
  const { onEngage } = options || {};
  const duration = Math.round(Math.max(0.5, params.durationSeconds || 1.5) * 1000);
  const travelDuration = Math.max(120, Math.round(duration / 2));
  let engaged = false;
  const engage = () => {
    if (engaged) return;
    engaged = true;
    onEngage?.();
  };
  scene.registerMechanismPreviewTarget?.(runtime.state);
  scene.registerMechanismPreviewResetter?.(() => {
    runtime.state.progress = 0;
    runtime.state.running = false;
    scene.drawMechanismState(tile, runtime, 0, params);
    notifyMechanismPreviewProgress(scene, key, tile, 0, params);
  });
  scene.tweens.killTweensOf(runtime.state);
  runtime.state.progress = 0;
  runtime.state.running = true;
  scene.drawMechanismState(tile, runtime, 0, params);
  notifyMechanismPreviewProgress(scene, key, tile, 0, params);
  scene.tweens.add({
    targets: runtime.state,
    progress: 1,
    duration: travelDuration,
    yoyo: true,
    hold: 150,
    ease: 'cubic.out',
    onUpdate: () => {
      scene.drawMechanismState(tile, runtime, runtime.state.progress, params);
      notifyMechanismPreviewProgress(scene, key, tile, runtime.state.progress, params);
      if (runtime.state.progress >= 0.98) engage();
    },
    onComplete: () => {
      engage();
      runtime.state.progress = 0;
      runtime.state.running = false;
      scene.drawMechanismState(tile, runtime, 0, params);
      notifyMechanismPreviewProgress(scene, key, tile, 0, params);
    }
  });
  return true;
};

export const playInspectMechanismAction = (scene, tile, key, params) => {
  const state = scene.inspectState;
  if (!state || state.key !== key || !state.runtime) return;
  const duration = Math.round(Math.max(0.5, params.durationSeconds || 1.5) * 1000);
  const travelDuration = Math.max(120, Math.round(duration / 2));
  scene.tweens.killTweensOf(state.runtime.state);
  scene.registerMechanismPreviewTarget?.(state.runtime.state);
  scene.registerMechanismPreviewResetter?.(() => {
    state.runtime.state.progress = 0;
    scene.drawMechanismState(tile, state.runtime, 0, params, state.yaw);
  });
  state.runtime.state.progress = 0;
  scene.drawMechanismState(tile, state.runtime, 0, params, state.yaw);
  scene.tweens.add({
    targets: state.runtime.state,
    progress: 1,
    duration: travelDuration,
    yoyo: true,
    ease: 'cubic.inout',
    onUpdate: () => scene.drawMechanismState(tile, state.runtime, state.runtime.state.progress, params, state.yaw),
    onComplete: () => {
      state.runtime.state.progress = 0;
      scene.drawMechanismState(tile, state.runtime, 0, params, state.yaw);
    }
  });
};
