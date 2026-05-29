export const isLayerVisible = (cell = {}, visibleLayerCutoff = null) => (
  visibleLayerCutoff === null || (Number(cell.z) || 0) <= visibleLayerCutoff
);

export const getCityChannelPlaneLevels = (mapData = {}) => {
  const levels = new Set([0]);
  Object.values(mapData.tiles || {}).forEach((tile) => {
    if (tile && !tile.isVertical) levels.add(Number(tile.z) || 0);
  });
  return Array.from(levels).sort((a, b) => a - b);
};

export const getNextHiddenPlaneLevel = (mapData = {}, visibleLayerCutoff = null) => {
  if (visibleLayerCutoff === null) return null;
  const cutoff = Number(visibleLayerCutoff) || 0;
  return getCityChannelPlaneLevels(mapData).find((level) => level > cutoff) ?? null;
};

export const isVerticalAttachmentPlacement = (placement = {}) => {
  if (!placement) return false;
  if (placement.edge) return true;
  return !!placement.isVertical;
};

export const isPlacementVisible = (placement = {}, {
  mapData = {},
  visibleLayerCutoff = null
} = {}) => {
  if (visibleLayerCutoff === null) return true;
  const z = Number(placement?.z) || 0;
  if (z <= visibleLayerCutoff) return true;
  const nextHiddenPlaneLevel = getNextHiddenPlaneLevel(mapData, visibleLayerCutoff);
  return (
    isVerticalAttachmentPlacement(placement)
    && nextHiddenPlaneLevel !== null
    && z < nextHiddenPlaneLevel
  );
};
