import {
  normalizeString,
  normalizeStringArray,
  normalizeVector3
} from './valueUtils';

const inferPortKind = (connector = {}, material = {}) => {
  const id = String(connector.id || '').toLowerCase();
  const category = material.category || '';
  if (id.includes('axis') || id.includes('gear') || id.includes('teeth')) return connector.direction === 'in' ? 'rotary_in' : 'rotary_out';
  if (id.includes('signal')) return 'signal';
  if (id.includes('hinge') || id.includes('drive') || id.includes('spring')) return connector.direction === 'in' ? 'linear_in' : 'linear_out';
  if (category === 'mechanical_sensor') return connector.direction === 'in' ? 'linear_in' : 'signal';
  if (category === 'mechanical_gear') return connector.direction === 'in' ? 'rotary_in' : 'rotary_out';
  return connector.direction === 'in' ? 'linear_in' : 'linear_out';
};

const defaultMediaForPortKind = (kind) => {
  if (kind === 'signal') return ['rigid_rod', 'rope'];
  if (kind === 'rotary_in' || kind === 'rotary_out') return ['rigid_rod', 'belt', 'gear_mesh'];
  return ['rigid_rod', 'rope'];
};

const connectorToMechanicalPort = (connector = {}, material = {}) => {
  const position = connector.position || {};
  const kind = inferPortKind(connector, material);
  const direction = connector.direction === 'in' ? 'in' : connector.direction === 'out' ? 'out' : 'bidirectional';
  return {
    id: typeof connector.id === 'string' && connector.id.trim() ? connector.id.trim() : 'port',
    label: typeof connector.label === 'string' && connector.label.trim() ? connector.label.trim() : '连接口',
    kind,
    direction,
    mediums: defaultMediaForPortKind(kind),
    localPosition3d: {
      x: Number.isFinite(Number(position.dx)) ? Number(position.dx) : 0,
      y: Number.isFinite(Number(position.dy)) ? Number(position.dy) : 0,
      z: -0.08
    },
    localDirection3d: {
      x: Number.isFinite(Number(position.dx)) ? Math.sign(Number(position.dx)) : 0,
      y: Number.isFinite(Number(position.dy)) ? Math.sign(Number(position.dy)) : (direction === 'in' ? -1 : 1),
      z: 0
    },
    motionAxis: kind.includes('rotary') ? 'z' : 'xy',
    phaseBehavior: 'same',
    capacity: 1,
    compatibleWith: []
  };
};

export const normalizeMechanicalPort = (port = {}, fallback = {}, material = {}) => {
  const source = port && typeof port === 'object' ? port : {};
  const base = fallback && typeof fallback === 'object' ? fallback : connectorToMechanicalPort(source, material);
  const kind = typeof source.kind === 'string' && source.kind ? source.kind : base.kind || inferPortKind(source, material);
  const mediums = normalizeStringArray(source.mediums, normalizeStringArray(base.mediums, defaultMediaForPortKind(kind)));
  return {
    id: normalizeString(source.id, normalizeString(base.id, 'port')),
    label: normalizeString(source.label, normalizeString(base.label, '连接口')),
    kind,
    direction: ['in', 'out', 'bidirectional'].includes(source.direction) ? source.direction : (base.direction || 'bidirectional'),
    mediums,
    localPosition3d: normalizeVector3(source.localPosition3d, normalizeVector3(base.localPosition3d)),
    localDirection3d: normalizeVector3(source.localDirection3d, normalizeVector3(base.localDirection3d, { x: 0, y: 1, z: 0 })),
    motionAxis: normalizeString(source.motionAxis, normalizeString(base.motionAxis, kind.includes('rotary') ? 'z' : 'xy')),
    phaseBehavior: normalizeString(source.phaseBehavior, normalizeString(base.phaseBehavior, 'same')),
    capacity: Math.max(1, Number.parseInt(source.capacity ?? base.capacity ?? 1, 10) || 1),
    compatibleWith: normalizeStringArray(source.compatibleWith, normalizeStringArray(base.compatibleWith, []))
  };
};

export const cloneMechanicalPorts = (ports = [], material = {}) => {
  const sourcePorts = Array.isArray(ports) ? ports : [];
  return sourcePorts
    .map((port, index) => normalizeMechanicalPort(port, { id: `port_${index}` }, material))
    .filter((port) => port.id);
};

export const createMechanicalPortsForMaterial = (catalogItem = {}) => {
  if (Array.isArray(catalogItem.mechanicalPorts) && catalogItem.mechanicalPorts.length > 0) {
    return cloneMechanicalPorts(catalogItem.mechanicalPorts, catalogItem);
  }
  if (!Array.isArray(catalogItem.connectors) || catalogItem.connectors.length <= 0) return [];
  return catalogItem.connectors.map((connector) => normalizeMechanicalPort(connectorToMechanicalPort(connector, catalogItem), {}, catalogItem));
};

export const createMechanicalLink = ({
  id = null,
  medium = 'rigid_rod',
  from,
  to,
  routing = [],
  tensionMode = 'push_pull',
  slack = 0
} = {}) => ({
  id: normalizeString(id, `link_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`),
  medium,
  from,
  to,
  routing: Array.isArray(routing) ? routing.map((point) => normalizeVector3(point)).filter(Boolean) : [],
  tensionMode,
  slack: Number.isFinite(Number(slack)) ? Number(slack) : 0
});

const normalizeMechanicalEndpoint = (endpoint = {}, tiles = {}) => {
  const componentKey = normalizeString(endpoint.componentKey, '');
  const portId = normalizeString(endpoint.portId, '');
  if (!componentKey || !portId || !tiles[componentKey]) return null;
  const tile = tiles[componentKey];
  const port = (tile.mechanicalPorts || []).find((item) => item.id === portId);
  if (!port) return null;
  return { componentKey, portId };
};

export const normalizeMechanicalLink = (link = {}, tiles = {}) => {
  const from = normalizeMechanicalEndpoint(link.from, tiles);
  const to = normalizeMechanicalEndpoint(link.to, tiles);
  if (!from || !to || (from.componentKey === to.componentKey && from.portId === to.portId)) return null;
  return createMechanicalLink({
    id: link.id,
    medium: normalizeString(link.medium, 'rigid_rod'),
    from,
    to,
    routing: link.routing,
    tensionMode: normalizeString(link.tensionMode, 'push_pull'),
    slack: link.slack
  });
};
