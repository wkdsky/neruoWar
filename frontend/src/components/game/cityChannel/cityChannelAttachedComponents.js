import { cloneGearMounts as cloneGearMountsFromSchema } from './cityChannelSchema';

export const GEAR_COMPONENT_TYPE = 'gear';

export const clonePlacementGearMounts = (gearMounts) => cloneGearMountsFromSchema(gearMounts);

export const isInstalledComponentMount = (mount) => (
  !!mount
  && typeof mount.componentType === 'string'
  && mount.componentType.trim().length > 0
);

export const getInstalledComponentMounts = (placement) => (
  Array.isArray(placement?.gearMounts)
    ? placement.gearMounts.filter(isInstalledComponentMount)
    : []
);

export const buildPlacementGhostAtTarget = (sourcePlacement, target = {}) => {
  if (!sourcePlacement || !target) return null;
  // 当目标带有 layFlat 时（搬运竖直板放平到水平面），ghost 需要按水平板渲染，
  // 否则会出现“数据已转水平、视觉仍是竖直”的不一致。
  // 反之 target.isVertical 时（沿上边沿竖直向上搭），即便源是水平板也要竖直渲染。
  let poseOverride = {};
  if (target.layFlat) poseOverride = { isVertical: false };
  else if (target.isVertical) poseOverride = { isVertical: true };
  return {
    ...sourcePlacement,
    x: target.x,
    y: target.y,
    z: target.z,
    ...(target.edge ? { edge: target.edge } : { edge: undefined }),
    ...(target.rotation !== undefined ? { rotation: target.rotation } : {}),
    ...(target.transmissionRotation !== undefined ? { transmissionRotation: target.transmissionRotation } : {}),
    ...poseOverride
  };
};

export const preservePlacementGearMounts = (placement) => (
  clonePlacementGearMounts(placement?.gearMounts || [])
);

export const getMovingHostKeysFromOrigins = (origins = []) => {
  const keys = new Set();
  origins.forEach((origin) => {
    if (!origin) return;
    if (origin.edge) {
      keys.add(`${origin.z}:${origin.x}:${origin.y}:${origin.edge}`);
      return;
    }
    keys.add(`${origin.z}:${origin.x}:${origin.y}`);
  });
  return keys;
};
