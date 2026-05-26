export const compareCityChannelHits = (a, b, { preferOcclusion = false } = {}) => {
  const snapPriorityDelta = (b.snapPriority || 0) - (a.snapPriority || 0);
  if (snapPriorityDelta !== 0) return snapPriorityDelta;

  if (preferOcclusion) {
    const depthDelta = (b.depth || 0) - (a.depth || 0);
    if (depthDelta !== 0) return depthDelta;
    return (a.snapDistanceSquared ?? Infinity) - (b.snapDistanceSquared ?? Infinity);
  }

  const selectionPriorityDelta = (b.selectionPriority || 0) - (a.selectionPriority || 0);
  if (selectionPriorityDelta !== 0) return selectionPriorityDelta;

  const snapDistanceDelta = (a.snapDistanceSquared ?? Infinity) - (b.snapDistanceSquared ?? Infinity);
  if (snapDistanceDelta !== 0) return snapDistanceDelta;

  return (b.depth || 0) - (a.depth || 0);
};
