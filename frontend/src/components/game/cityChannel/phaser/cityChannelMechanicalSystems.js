import {
  createCellKey,
  createWallKey,
  normalizeRotation
} from '../cityChannelSchema';
import { getWorldTransmissionPorts } from '../cityChannelMechanismRuntime';
import { projectWorldOffset } from '../cityChannelGeometryUtils';
import { projectCell } from './renderer/CityChannelGeometry';
import { isPlacementVisible as isCityChannelPlacementVisible } from './cityChannelPhaserVisibility';
import { rotateLocalPoint } from './cityChannelPhaserSceneUtils';

const mediumColor = {
  rigid_rod: 0xe2e8f0,
  rope: 0xfacc15,
  belt: 0x38bdf8,
  gear_mesh: 0xfb923c
};

export const getTransmissionRotationDelta = (direction = 'forward') => (
  direction === 'reverse' ? -90 : 90
);

export const rotateTransmissionPlacementsInPlace = (mapData = {}, placements = [], direction = 'forward') => {
  const list = Array.isArray(placements) ? placements : [];
  if (list.length <= 0) return [];
  const delta = getTransmissionRotationDelta(direction);
  const changed = [];

  list.forEach((placement) => {
    if (!placement) return;
    if (placement.edge) {
      const key = createWallKey(placement.x, placement.y, placement.z, placement.edge);
      const wall = mapData.walls?.[key];
      if (!wall) return;
      wall.transmissionRotation = normalizeRotation((wall.transmissionRotation || 0) + delta);
      changed.push({ kind: 'wall', key, placement: wall });
      return;
    }

    const key = createCellKey(placement.x, placement.y, placement.z);
    const tile = mapData.tiles?.[key];
    if (!tile) return;
    tile.transmissionRotation = normalizeRotation((tile.transmissionRotation ?? tile.rotation ?? 0) + delta);
    changed.push({ kind: 'tile', key, placement: tile });
  });

  return changed;
};

export const getMechanicalPortPoint = ({
  mapData,
  cameraYaw,
  tile,
  port
}) => {
  if (!tile || !port) return null;
  const cell = { x: tile.x, y: tile.y, z: tile.z };
  const projection = projectCell(cell, cameraYaw, mapData);
  const local = port.localPosition3d || { x: 0, y: 0, z: 0 };
  const rotated = rotateLocalPoint({ x: local.x || 0, y: local.y || 0 }, tile.rotation || 0);
  const offset = projectWorldOffset(rotated.x, rotated.y, cameraYaw);
  return {
    x: projection.x + offset.x,
    y: projection.y + offset.y - ((Number(local.z) || 0) * 52)
  };
};

export const getMechanicalEndpointPoint = ({
  mapData,
  cameraYaw,
  visibleLayerCutoff,
  endpoint
}) => {
  const tile = mapData.tiles?.[endpoint?.componentKey];
  if (!isCityChannelPlacementVisible(tile, { mapData, visibleLayerCutoff })) return null;
  if (!tile) return null;
  const port = (tile.mechanicalPorts || []).find((item) => item.id === endpoint.portId);
  return getMechanicalPortPoint({ mapData, cameraYaw, tile, port });
};

export const getMechanicalPortHit = ({
  mapData,
  cameraYaw,
  zoom,
  visibleLayerCutoff,
  localPoint
}) => {
  if (!localPoint) return null;
  const radius = Math.max(8, 13 / Math.max(0.45, zoom || 1));
  const radiusSquared = radius * radius;
  let best = null;
  Object.entries(mapData.tiles || {}).forEach(([componentKey, tile]) => {
    if (!isCityChannelPlacementVisible(tile, { mapData, visibleLayerCutoff })) return;
    (tile.mechanicalPorts || []).forEach((port) => {
      const point = getMechanicalPortPoint({ mapData, cameraYaw, tile, port });
      if (!point) return;
      const distanceSquared = ((localPoint.x - point.x) ** 2) + ((localPoint.y - point.y) ** 2);
      if (distanceSquared > radiusSquared) return;
      if (!best || distanceSquared < best.distanceSquared) {
        best = {
          type: 'mechanical_port',
          cell: { x: tile.x, y: tile.y, z: tile.z },
          componentKey,
          portId: port.id,
          port,
          panelType: tile.panelType,
          tile,
          point,
          distanceSquared,
          depth: 999999
        };
      }
    });
  });
  return best;
};

export const areMechanicalPortsCompatible = (fromHit, toHit) => {
  if (!fromHit || !toHit) return { ok: false, reason: 'missing' };
  if (fromHit.componentKey === toHit.componentKey && fromHit.portId === toHit.portId) {
    return { ok: false, reason: 'same_port' };
  }
  const fromMedia = new Set(fromHit.port?.mediums || []);
  const medium = (toHit.port?.mediums || []).find((item) => fromMedia.has(item));
  if (!medium) return { ok: false, reason: 'medium' };
  const fromDirection = fromHit.port?.direction || 'bidirectional';
  const toDirection = toHit.port?.direction || 'bidirectional';
  if (fromDirection === toDirection && fromDirection !== 'bidirectional') {
    return { ok: false, reason: 'direction' };
  }
  return { ok: true, medium };
};

export const handleMechanicalPortHit = ({
  scene,
  hit
}) => {
  if (!hit?.port) return false;
  if (!scene.pendingMechanicalPort) {
    scene.pendingMechanicalPort = hit;
    scene.config.onHoverStatusChange?.(`${hit.port.label}，选择另一个连接口`);
    drawMechanicalLayers(scene);
    return true;
  }
  const from = scene.pendingMechanicalPort;
  scene.pendingMechanicalPort = null;
  const compatibility = areMechanicalPortsCompatible(from, hit);
  if (!compatibility.ok) {
    scene.config.onToast?.('连接口不兼容，无法连接。', 'error');
    drawMechanicalLayers(scene);
    return true;
  }
  scene.config.onCommitOperations?.([{
    kind: 'mechanicalLink',
    action: 'place',
    medium: compatibility.medium,
    from: { componentKey: from.componentKey, portId: from.portId },
    to: { componentKey: hit.componentKey, portId: hit.portId },
    tensionMode: compatibility.medium === 'rope' ? 'tension_only' : 'push_pull'
  }], { label: '连接机械端口' });
  scene.config.onToast?.('机械连接已建立。', 'success');
  drawMechanicalLayers(scene);
  return true;
};

export const drawMechanicalLayers = (scene) => {
  scene.mechanicalLinkLayer.clear();
  scene.mechanicalPortLayer.clear();
  scene.redrawAllMountedGearLayers();
  scene.sortMapLayer();
  const assemblyGraph = scene.getMechanicalAssemblyGraph();
  const components = Object.fromEntries(
    Object.entries({ ...(scene.mapData.tiles || {}), ...(scene.mapData.walls || {}) })
      .filter(([, placement]) => isCityChannelPlacementVisible(placement, {
        mapData: scene.mapData,
        visibleLayerCutoff: scene.visibleLayerCutoff
      }))
  );
  const portsByComponentKey = new Map();
  Object.entries(components).forEach(([componentKey, tile]) => {
    portsByComponentKey.set(componentKey, getWorldTransmissionPorts(tile, componentKey));
  });
  const assemblyById = new Map((assemblyGraph.assemblies || []).map((assembly) => [assembly.id, assembly]));
  const connectedPortKeys = new Set();
  const focusedComponentKeys = new Set();
  scene.selectedCells.forEach((cell) => focusedComponentKeys.add(createCellKey(cell.x, cell.y, cell.z)));
  scene.selectedWalls.forEach((wall) => focusedComponentKeys.add(createWallKey(wall.x, wall.y, wall.z, wall.edge)));
  scene.selectedGears.forEach((gear) => {
    if (gear.hostKey) focusedComponentKeys.add(gear.hostKey);
  });
  const hoverHit = scene.hoverTarget?.hit;
  if (hoverHit?.type === 'tile') {
    focusedComponentKeys.add(createCellKey(hoverHit.cell.x, hoverHit.cell.y, hoverHit.cell.z));
  } else if (hoverHit?.type === 'wall') {
    focusedComponentKeys.add(createWallKey(hoverHit.cell.x, hoverHit.cell.y, hoverHit.cell.z, hoverHit.edge));
  } else if (hoverHit?.type === 'gear' && hoverHit.hostKey) {
    focusedComponentKeys.add(hoverHit.hostKey);
  } else if (hoverHit?.type === 'mechanical_port' && hoverHit.componentKey) {
    focusedComponentKeys.add(hoverHit.componentKey);
  }
  const focusedAssemblyIds = new Set();
  focusedComponentKeys.forEach((componentKey) => {
    const assemblyId = assemblyGraph.assemblyByComponentKey?.[componentKey];
    if (assemblyId) focusedAssemblyIds.add(assemblyId);
  });
  const revealConnectionSockets = scene.pendingMechanicalPort || focusedAssemblyIds.size > 0;
  (assemblyGraph.assemblies || []).forEach((assembly) => {
    assembly.edges.forEach((edge) => {
      if (edge.from?.componentKey && edge.from?.portId) connectedPortKeys.add(`${edge.from.componentKey}:${edge.from.portId}`);
      if (edge.to?.componentKey && edge.to?.portId) connectedPortKeys.add(`${edge.to.componentKey}:${edge.to.portId}`);
    });
  });
  Object.entries(components).forEach(([componentKey, tile]) => {
    (portsByComponentKey.get(componentKey) || []).forEach((port) => {
      const assemblyId = assemblyGraph.assemblyByComponentKey?.[componentKey];
      const connected = !!assemblyById.get(assemblyId) && connectedPortKeys.has(`${componentKey}:${port.id}`);
      const shouldReveal = revealConnectionSockets && focusedAssemblyIds.has(assemblyId);
      if (!connected) return;
      if (!shouldReveal) return;
      scene.drawTransmissionPortSocket(scene.mechanicalPortLayer, tile, port, true);
    });
  });

  (scene.mapData.mechanicalLinks || []).forEach((link) => {
    const fromTile = scene.mapData.tiles?.[link.from?.componentKey];
    const toTile = scene.mapData.tiles?.[link.to?.componentKey];
    if (
      !isCityChannelPlacementVisible(fromTile, { mapData: scene.mapData, visibleLayerCutoff: scene.visibleLayerCutoff })
      || !isCityChannelPlacementVisible(toTile, { mapData: scene.mapData, visibleLayerCutoff: scene.visibleLayerCutoff })
    ) return;
    const from = getMechanicalEndpointPoint({
      mapData: scene.mapData,
      cameraYaw: scene.cameraState.yaw,
      visibleLayerCutoff: scene.visibleLayerCutoff,
      endpoint: link.from
    });
    const to = getMechanicalEndpointPoint({
      mapData: scene.mapData,
      cameraYaw: scene.cameraState.yaw,
      visibleLayerCutoff: scene.visibleLayerCutoff,
      endpoint: link.to
    });
    if (!from || !to) return;
    const color = mediumColor[link.medium] || 0xcbd5e1;
    scene.mechanicalLinkLayer.lineStyle(link.medium === 'rope' ? 2 : 4, color, link.medium === 'rope' ? 0.74 : 0.82);
    if (link.medium === 'rope') {
      const sag = Math.min(26, Math.max(8, Math.hypot(to.x - from.x, to.y - from.y) * 0.08));
      scene.mechanicalLinkLayer.beginPath();
      scene.mechanicalLinkLayer.moveTo(from.x, from.y);
      scene.mechanicalLinkLayer.lineTo((from.x + to.x) / 2, ((from.y + to.y) / 2) + sag);
      scene.mechanicalLinkLayer.lineTo(to.x, to.y);
      scene.mechanicalLinkLayer.strokePath();
    } else {
      scene.mechanicalLinkLayer.lineBetween(from.x, from.y, to.x, to.y);
    }
  });

  Object.entries(scene.mapData.tiles || {}).forEach(([componentKey, tile]) => {
    if (!isCityChannelPlacementVisible(tile, { mapData: scene.mapData, visibleLayerCutoff: scene.visibleLayerCutoff })) return;
    (tile.mechanicalPorts || []).forEach((port) => {
      const point = getMechanicalPortPoint({
        mapData: scene.mapData,
        cameraYaw: scene.cameraState.yaw,
        tile,
        port
      });
      if (!point) return;
      const isPending = scene.pendingMechanicalPort?.componentKey === componentKey && scene.pendingMechanicalPort?.portId === port.id;
      const isOutput = port.direction === 'out';
      const color = port.kind === 'signal' ? 0xfacc15 : port.kind?.includes('rotary') ? 0xfb923c : 0x67e8f9;
      scene.mechanicalPortLayer.fillStyle(0x020617, 0.94);
      scene.mechanicalPortLayer.fillCircle(point.x, point.y, isPending ? 7 : 5);
      scene.mechanicalPortLayer.lineStyle(isPending ? 3 : 2, isPending ? 0xffffff : color, isPending ? 0.96 : 0.86);
      scene.mechanicalPortLayer.strokeCircle(point.x, point.y, isPending ? 8 : 6);
      if (isOutput) {
        scene.mechanicalPortLayer.fillStyle(color, 0.82);
        scene.mechanicalPortLayer.fillTriangle(point.x + 7, point.y, point.x + 2, point.y - 3, point.x + 2, point.y + 3);
      }
    });
  });
};
