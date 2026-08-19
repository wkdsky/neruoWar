const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const SKILL_PAINT_MAX_STAMPS = 256;

const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const normalizePoint = (point = {}, fallback = {}) => ({
  x: finiteOr(point?.x, finiteOr(fallback?.x)),
  y: finiteOr(point?.y, finiteOr(fallback?.y))
});

const copyStamp = (stamp = {}) => ({
  x: finiteOr(stamp?.x),
  y: finiteOr(stamp?.y),
  radius: Math.max(0, finiteOr(stamp?.radius))
});

export const resolveSkillPaintCasterModelCount = (
  agents = [],
  squadId = '',
  sourceCategory = ''
) => {
  const safeSquadId = String(squadId || '');
  const safeSourceCategory = String(sourceCategory || '');
  return (Array.isArray(agents) ? agents : []).filter((agent) => (
    agent
    && !agent.dead
    && (Number(agent.weight) || 0) > 0.001
    && String(agent.squadId || '') === safeSquadId
    && String(agent.unitCategory || 'melee') === safeSourceCategory
  )).length;
};

export const createSkillPaintArea = ({
  casterModelCount = 1,
  aoeRadius = 24,
  maxRange = 180
} = {}) => {
  const modelCount = Math.max(1, Math.floor(finiteOr(casterModelCount, 1)));
  const safeRange = Math.max(8, finiteOr(maxRange, 180));
  const modelRadiusMin = Math.min(5.8, safeRange * 0.25);
  const modelRadiusMax = Math.max(modelRadiusMin, Math.min(17, safeRange * 0.2));
  const modelAreaRadius = clamp(
    Math.max(modelRadiusMin, finiteOr(aoeRadius, 24) * 0.2),
    modelRadiusMin,
    modelRadiusMax
  );
  const dabRadiusMin = Math.min(9.5, safeRange * 0.32);
  const dabRadiusMax = Math.max(dabRadiusMin, Math.min(28, safeRange * 0.38));
  const dabRadius = clamp(
    modelAreaRadius * 1.72,
    dabRadiusMin,
    dabRadiusMax
  );
  const uncappedArea = Math.PI * (modelAreaRadius ** 2) * modelCount;
  const maxArea = Math.PI * ((safeRange * 0.78) ** 2);
  const totalArea = Math.min(uncappedArea, maxArea);
  return {
    casterModelCount: modelCount,
    dabRadius,
    totalArea,
    remainingArea: totalArea,
    stamps: []
  };
};

export const cloneSkillPaintArea = (paintArea = null) => {
  if (!paintArea || typeof paintArea !== 'object') return null;
  return {
    ...paintArea,
    stamps: Array.isArray(paintArea.stamps)
      ? paintArea.stamps.map(copyStamp)
      : []
  };
};

export const getSkillPaintRemainingRadius = (paintArea = null) => {
  const remainingArea = Math.max(0, finiteOr(paintArea?.remainingArea));
  return remainingArea > 0 ? Math.sqrt(remainingArea / Math.PI) : 0;
};

export const constrainSkillPaintPoint = (
  point = {},
  origin = {},
  maxRange = 0,
  radius = 0
) => {
  const safeOrigin = normalizePoint(origin);
  const safePoint = normalizePoint(point, safeOrigin);
  const safeRange = Math.max(0, finiteOr(maxRange));
  const safeRadius = Math.max(0, finiteOr(radius));
  const allowedDistance = Math.max(0, safeRange - safeRadius);
  const dx = safePoint.x - safeOrigin.x;
  const dy = safePoint.y - safeOrigin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= allowedDistance || distance <= 1e-5) return safePoint;
  return {
    x: safeOrigin.x + ((dx / distance) * allowedDistance),
    y: safeOrigin.y + ((dy / distance) * allowedDistance)
  };
};

export const appendSkillPaintDabs = ({
  paintArea = null,
  from = null,
  to = null,
  origin = null,
  maxRange = 0,
  maxStamps = SKILL_PAINT_MAX_STAMPS
} = {}) => {
  const nextPaintArea = cloneSkillPaintArea(paintArea);
  if (!nextPaintArea || !from || !to || !origin) {
    return { paintArea: nextPaintArea, lastStampPoint: from ? normalizePoint(from) : null };
  }
  const dabRadius = Math.max(1, finiteOr(nextPaintArea.dabRadius, 6));
  const dabArea = Math.PI * (dabRadius ** 2);
  const availableDabCount = Math.max(0, Math.floor((Math.max(0, finiteOr(nextPaintArea.remainingArea)) + 1e-5) / dabArea));
  const availableStampCount = Math.max(0, Math.floor(finiteOr(maxStamps, SKILL_PAINT_MAX_STAMPS)) - nextPaintArea.stamps.length);
  const start = constrainSkillPaintPoint(from, origin, maxRange, dabRadius);
  const end = constrainSkillPaintPoint(to, origin, maxRange, dabRadius);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const spacing = Math.max(1.5, dabRadius * 0.78);
  const requestedDabCount = Math.floor(distance / spacing);
  const dabCount = Math.min(requestedDabCount, availableDabCount, availableStampCount);
  if (dabCount <= 0) return { paintArea: nextPaintArea, lastStampPoint: start };

  let lastStampPoint = start;
  for (let stampIndex = 1; stampIndex <= dabCount; stampIndex += 1) {
    const traveled = Math.min(distance, stampIndex * spacing);
    const stampPoint = constrainSkillPaintPoint({
      x: start.x + ((dx / distance) * traveled),
      y: start.y + ((dy / distance) * traveled)
    }, origin, maxRange, dabRadius);
    nextPaintArea.stamps.push({ ...stampPoint, radius: dabRadius });
    nextPaintArea.remainingArea = Math.max(0, finiteOr(nextPaintArea.remainingArea) - dabArea);
    lastStampPoint = stampPoint;
  }
  return { paintArea: nextPaintArea, lastStampPoint };
};

export const finishSkillPaintArea = ({
  paintArea = null,
  point = null,
  origin = null,
  maxRange = 0,
  maxStamps = SKILL_PAINT_MAX_STAMPS
} = {}) => {
  const nextPaintArea = cloneSkillPaintArea(paintArea);
  if (!nextPaintArea || !point || !origin) return nextPaintArea;
  const remainingArea = Math.max(0, finiteOr(nextPaintArea.remainingArea));
  const canAddTail = nextPaintArea.stamps.length < Math.max(1, Math.floor(finiteOr(maxStamps, SKILL_PAINT_MAX_STAMPS)));
  if (remainingArea <= 1e-5) {
    nextPaintArea.remainingArea = 0;
    return nextPaintArea;
  }
  const radius = Math.sqrt(remainingArea / Math.PI);
  const tailPoint = constrainSkillPaintPoint(point, origin, maxRange, radius);
  if (!canAddTail) {
    const tailIndex = nextPaintArea.stamps.length - 1;
    const previousRadius = Math.max(0, finiteOr(nextPaintArea.stamps[tailIndex]?.radius));
    const mergedRadius = Math.sqrt((previousRadius ** 2) + (radius ** 2));
    nextPaintArea.stamps[tailIndex] = { ...tailPoint, radius: mergedRadius };
    nextPaintArea.remainingArea = 0;
    return nextPaintArea;
  }
  nextPaintArea.stamps.push({ ...tailPoint, radius });
  nextPaintArea.remainingArea = 0;
  return nextPaintArea;
};

export const normalizeSkillPaintArea = ({
  paintArea = null,
  origin = null,
  maxRange = 0,
  maxStamps = SKILL_PAINT_MAX_STAMPS
} = {}) => {
  if (!paintArea || !origin) return null;
  const rawStamps = Array.isArray(paintArea.stamps) ? paintArea.stamps : [];
  const safeMaxStamps = Math.max(1, Math.floor(finiteOr(maxStamps, SKILL_PAINT_MAX_STAMPS)));
  const declaredArea = Math.max(0, finiteOr(paintArea.totalArea));
  let remainingBudget = declaredArea > 1e-5 ? declaredArea : Infinity;
  let weightedX = 0;
  let weightedY = 0;
  let coveredArea = 0;
  let maxStampRadius = 0;
  const stamps = [];

  rawStamps.slice(0, safeMaxStamps).forEach((rawStamp) => {
    const rawRadius = Math.min(
      Math.max(0, finiteOr(rawStamp?.radius)),
      Math.max(0, finiteOr(maxRange))
    );
    if (rawRadius <= 1e-5 || remainingBudget <= 1e-5) return;
    const rawArea = Math.PI * (rawRadius ** 2);
    const usedArea = Math.min(rawArea, remainingBudget);
    const radius = Math.sqrt(usedArea / Math.PI);
    const point = constrainSkillPaintPoint(rawStamp, origin, maxRange, radius);
    stamps.push({ ...point, radius });
    remainingBudget -= usedArea;
    weightedX += point.x * usedArea;
    weightedY += point.y * usedArea;
    coveredArea += usedArea;
    maxStampRadius = Math.max(maxStampRadius, radius);
  });

  if (stamps.length <= 0) return null;
  const fallbackCenter = normalizePoint(origin);
  return {
    stamps,
    totalArea: coveredArea,
    center: coveredArea > 1e-5
      ? { x: weightedX / coveredArea, y: weightedY / coveredArea }
      : fallbackCenter,
    maxStampRadius
  };
};

export const isPointInsideSkillPaintArea = (
  point = {},
  paintArea = null,
  padding = 0
) => {
  const safePoint = normalizePoint(point);
  const safePadding = Math.max(0, finiteOr(padding));
  const stamps = Array.isArray(paintArea?.stamps) ? paintArea.stamps : [];
  return stamps.some((stamp) => {
    const radius = Math.max(0, finiteOr(stamp?.radius)) + safePadding;
    if (radius <= 0) return false;
    const dx = safePoint.x - finiteOr(stamp?.x);
    const dy = safePoint.y - finiteOr(stamp?.y);
    return ((dx * dx) + (dy * dy)) <= (radius ** 2);
  });
};
