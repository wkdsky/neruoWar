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
import { projectCell } from './renderer/CityChannelGeometry';
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

export const playAssemblyRotation = (scene, assembly, fixedAxis, params) => {
  if (!assembly || !fixedAxis) return false;
  const axisCell = fixedAxis.cell || { x: 0, y: 0, z: 0 };
  const axisHost = fixedAxis.componentKey
    ? (scene.mapData.tiles?.[fixedAxis.componentKey] || scene.mapData.walls?.[fixedAxis.componentKey])
    : (scene.mapData.tiles?.[createCellKey(axisCell.x, axisCell.y, axisCell.z)] || null);
  const anchor = scene.getGearMountPoint(axisHost, fixedAxis) || projectCell(axisCell, scene.cameraState.yaw, scene.mapData);
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
  const sign = normalized.rotationDirection === 'left' ? -1 : 1;
  const targetAngle = sign * normalized.rotationAngle;
  const duration = Math.max(120, Math.round((Math.max(1, normalized.rotationAngle) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
  const delay = Math.round(normalized.triggerDelaySeconds * 1000);
  const originals = members.map((object) => ({
    object,
    x: object.x,
    y: object.y,
    angle: object.angle || 0
  }));
  const applyAngle = (degrees) => {
    const radians = (degrees * Math.PI) / 180;
    originals.forEach((item) => {
      const dx = item.x - anchor.x;
      const dy = item.y - anchor.y;
      item.object.setPosition(
        anchor.x + (dx * Math.cos(radians)) - (dy * Math.sin(radians)),
        anchor.y + (dx * Math.sin(radians)) + (dy * Math.cos(radians))
      );
      item.object.setAngle(item.angle + degrees);
    });
  };
  const motion = { angle: 0 };
  scene.tweens.killTweensOf(motion);
  scene.tweens.add({
    targets: motion,
    angle: targetAngle,
    delay,
    duration,
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
      if (!normalized.autoReturn) return;
      scene.time.delayedCall(Math.round(normalized.autoReturnDelaySeconds * 1000), () => {
        scene.tweens.add({
          targets: motion,
          angle: 0,
          duration,
          ease: 'sine.inout',
          onUpdate: () => applyAngle(motion.angle),
          onComplete: () => {
            applyAngle(0);
            scene.config.onMechanismPreviewProgress?.(null);
          }
        });
      });
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

export const getGearNodesForMounts = (scene, mounts = []) => {
  if (!Array.isArray(mounts) || mounts.length <= 0) return [];
  return mounts.map((mount) => {
    const { hostKind, placement } = getGearHostKindAndPlacement(scene, mount.componentKey);
    if (!hostKind || !placement) return null;
    const liveMount = (placement.gearMounts || []).find((item) => item.id === mount.id) || mount;
    const point = scene.getGearMountPoint(placement, liveMount);
    if (!point) return null;
    return {
      id: `${mount.componentKey}:${mount.id}`,
      componentKey: mount.componentKey,
      hostKind,
      placement,
      mountId: liveMount.id,
      mount: liveMount,
      point,
      pitchRadius: getGearPitchRadiusAtPoint(scene, placement, liveMount, point),
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

export const buildGearContactGraph = (nodes = []) => (
  buildGearContactGraphModel(nodes, getGearContactThreshold())
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
  const contactGraph = buildGearContactGraph(allNodes);
  return resolveDrivenGearNodesModel({
    assembly,
    assemblyNodes,
    allNodes,
    contactGraph,
    sourceComponentKey
  });
};

export const setGearMountPhases = (scene, nodes = [], angle = 0, basePhases = new Map()) => {
  const dirtyHosts = new Map();
  nodes.forEach((node) => {
    const { hostKind, placement } = getGearHostKindAndPlacement(scene, node.componentKey);
    if (!hostKind || !placement || !Array.isArray(placement.gearMounts)) return;
    const mount = placement.gearMounts.find((item) => item.id === node.mountId);
    if (!mount) return;
    const base = basePhases.get(node.id) || 0;
    mount.phase = getGearPhase(node, angle, base);
    dirtyHosts.set(node.componentKey, { hostKind, placement });
  });
  dirtyHosts.forEach(({ hostKind, placement }, hostKey) => {
    scene.redrawMountedGearHostLayers(hostKind, hostKey, placement);
  });
  scene.sortMapLayer();
};

export const playAssemblyGearRotation = (scene, assembly, sourceComponentKey, params) => {
  const nodes = resolveDrivenGearNodes(scene, assembly, sourceComponentKey);
  if (nodes.length <= 0) return false;
  const normalized = normalizeMechanismParams(params);
  const sign = normalized.rotationDirection === 'left' ? -1 : 1;
  const targetAngle = sign * normalized.rotationAngle;
  const duration = Math.max(120, Math.round((Math.max(1, normalized.rotationAngle) / Math.max(1, normalized.rotationSpeedDegPerSec)) * 1000));
  const delay = Math.round(normalized.triggerDelaySeconds * 1000);
  const basePhases = new Map(nodes.map((node) => [node.id, Number(node.mount?.phase) || 0]));
  const motion = { angle: 0 };
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
      scene.time.delayedCall(Math.round(normalized.autoReturnDelaySeconds * 1000), () => {
        scene.tweens.add({
          targets: motion,
          angle: 0,
          duration,
          ease: 'sine.inout',
          onUpdate: () => setGearMountPhases(scene, nodes, motion.angle, basePhases),
          onComplete: () => {
            setGearMountPhases(scene, nodes, 0, basePhases);
            scene.config.onMechanismPreviewProgress?.(null);
          }
        });
      });
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
