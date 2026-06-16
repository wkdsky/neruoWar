import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';

const getFiniteMax = (values = []) => {
  const finiteValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null;
};

const getOperationTargetLayer = (operation = {}) => {
  const rack = operation?.kind === 'rack'
    ? (operation.rack || operation)
    : null;
  if (rack) {
    return getFiniteMax([
      rack.z,
      rack.start?.z,
      rack.end?.z
    ]);
  }
  return getFiniteMax([operation?.cell?.z]);
};

export const getMaxTargetLayerFromPlacementOperations = (operations = []) => (
  (Array.isArray(operations) ? operations : []).reduce((maxLayer, operation) => {
    const z = getOperationTargetLayer(operation);
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
  activeComponentType = null,
  carryActive = false
} = {}) => (
  activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
    || (activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT && !!activeComponentType)
    || carryActive
    ? null
    : visibleLayerCutoff
);
