import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';

export const getMaxTargetLayerFromPlacementOperations = (operations = []) => (
  (Array.isArray(operations) ? operations : []).reduce((maxLayer, operation) => {
    const z = Number(operation?.cell?.z);
    return Number.isFinite(z) ? Math.max(maxLayer, z) : maxLayer;
  }, null)
);

export const getMaxTargetLayerFromMoves = (moves = []) => (
  (Array.isArray(moves) ? moves : []).reduce((maxLayer, move) => {
    const z = Number(move?.to?.z);
    return Number.isFinite(z) ? Math.max(maxLayer, z) : maxLayer;
  }, null)
);

export const expandVisibleLayerCutoffForTargetLayer = (currentCutoff, targetLayer) => {
  if (currentCutoff === null) return null;
  if (!Number.isFinite(Number(targetLayer))) return currentCutoff;
  return Math.max(Number(currentCutoff) || 0, Number(targetLayer));
};

export const getRuntimeVisibleLayerCutoff = ({
  visibleLayerCutoff = null,
  activeTool = CITY_CHANNEL_TOOLS.BROWSE,
  carryActive = false
} = {}) => (
  activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE || carryActive
    ? null
    : visibleLayerCutoff
);
