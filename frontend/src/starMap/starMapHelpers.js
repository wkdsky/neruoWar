export const KNOWLEDGE_MAIN_VIEW_MODE = {
  MAIN: 'main',
  STAR_MAP: 'starMap'
};

export const STAR_MAP_LAYER = {
  TITLE: 'title',
  SENSE: 'sense'
};

export const DEFAULT_STAR_MAP_LIMIT = 50;

export const toSenseVertexKey = (nodeId = '', senseId = '') => `${String(nodeId || '')}::${String(senseId || '').trim()}`;

export const getTitleNodeKey = (node = {}) => String(node?._id || '');

export const getSenseNodeKey = (node = {}) => {
  const explicitKey = typeof node?.vertexKey === 'string' ? node.vertexKey.trim() : '';
  if (explicitKey) return explicitKey;
  return toSenseVertexKey(node?._id, node?.activeSenseId);
};

export const getStarMapNodeKey = (node = {}, layer = STAR_MAP_LAYER.TITLE) => (
  layer === STAR_MAP_LAYER.SENSE ? getSenseNodeKey(node) : getTitleNodeKey(node)
);

export const getStarMapCenterKey = (graph = {}, layer = STAR_MAP_LAYER.TITLE) => {
  if (layer === STAR_MAP_LAYER.SENSE) {
    const explicitKey = typeof graph?.centerVertexKey === 'string' ? graph.centerVertexKey.trim() : '';
    if (explicitKey) return explicitKey;
    return getSenseNodeKey(graph?.centerNode || {});
  }
  const explicitNodeId = typeof graph?.centerNodeId === 'string' ? graph.centerNodeId.trim() : '';
  if (explicitNodeId) return explicitNodeId;
  return getTitleNodeKey(graph?.centerNode || {});
};

export const getStarMapLevelMap = (graph = {}, layer = STAR_MAP_LAYER.TITLE) => (
  layer === STAR_MAP_LAYER.SENSE
    ? (graph?.levelByVertexKey || {})
    : (graph?.levelByNodeId || {})
);

export const areStarMapCentersEqual = (left = null, right = null) => (
  !!left
  && !!right
  && String(left?.layer || '') === String(right?.layer || '')
  && String(left?.nodeId || '') === String(right?.nodeId || '')
  && String(left?.senseId || '') === String(right?.senseId || '')
);
