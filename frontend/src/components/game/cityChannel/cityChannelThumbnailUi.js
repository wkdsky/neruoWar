import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';

export const THUMBNAIL_NEAR_CURSOR_DISTANCE_PX = 80;

export const isCityChannelThumbnailInteractionLocked = ({
  activeTool,
  activeTileType,
  activeComponentType,
  carryActive = false
} = {}) => (
  (activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE && !!activeTileType)
  || (activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && !!activeComponentType)
  || !!carryActive
);

export const getDistanceToBoundingRect = (clientX, clientY, rect) => {
  if (!rect) return Infinity;
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
  const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  return Math.hypot(dx, dy);
};

export const isPointerNearThumbnail = (
  clientX,
  clientY,
  rect,
  distance = THUMBNAIL_NEAR_CURSOR_DISTANCE_PX
) => getDistanceToBoundingRect(clientX, clientY, rect) <= distance;

export const getCityChannelThumbnailClassName = ({
  isOpen = true,
  isLocked = false,
  isNearCursor = false
} = {}) => [
  'city-channel-thumbnail',
  isOpen ? 'is-open' : 'is-closed',
  isLocked ? 'is-interaction-locked' : '',
  isLocked && isNearCursor ? 'is-near-cursor' : ''
].filter(Boolean).join(' ');

export const buildThumbnailAssemblyColorMap = ({
  assemblyGraph = {},
  componentKeys = [],
  adjacentPairs = [],
  palette = []
} = {}) => {
  const assemblyByComponentKey = assemblyGraph?.assemblyByComponentKey || {};
  const colors = {};
  if (!Array.isArray(palette) || palette.length <= 0) return colors;
  const assemblyIds = [];
  const seenAssemblyIds = new Set();
  componentKeys.forEach((componentKey) => {
    const assemblyId = assemblyByComponentKey[componentKey];
    if (!assemblyId || seenAssemblyIds.has(assemblyId)) return;
    seenAssemblyIds.add(assemblyId);
    assemblyIds.push(assemblyId);
  });

  const adjacentAssemblyIds = new Map();
  const addAssemblyNeighbor = (assemblyId, neighborAssemblyId) => {
    if (!assemblyId || !neighborAssemblyId || assemblyId === neighborAssemblyId) return;
    adjacentAssemblyIds.set(assemblyId, adjacentAssemblyIds.get(assemblyId) || new Set());
    adjacentAssemblyIds.get(assemblyId).add(neighborAssemblyId);
  };
  adjacentPairs.forEach(([fromKey, toKey]) => {
    const fromAssemblyId = assemblyByComponentKey[fromKey];
    const toAssemblyId = assemblyByComponentKey[toKey];
    addAssemblyNeighbor(fromAssemblyId, toAssemblyId);
    addAssemblyNeighbor(toAssemblyId, fromAssemblyId);
  });

  assemblyIds.forEach((assemblyId, index) => {
    const blockedColors = new Set(
      Array.from(adjacentAssemblyIds.get(assemblyId) || [])
        .map((neighborAssemblyId) => colors[neighborAssemblyId]?.top)
        .filter(Boolean)
    );
    colors[assemblyId] = palette.find((color) => !blockedColors.has(color.top))
      || palette[index % palette.length];
  });
  return colors;
};
