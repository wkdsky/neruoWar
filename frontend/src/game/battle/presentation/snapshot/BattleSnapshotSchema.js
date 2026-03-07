/**
 * Battle Snapshot Schema (Phase-3 freeze)
 *
 * Coordinate protocol:
 * - world space: +X right, +Y up, +Z up
 * - width maps to local X axis, depth maps to local Y axis
 * - persisted / UI-facing yaw uses `yawDeg` (CCW from +X)
 * - renderer instance buffers use `yawRad`
 *
 * Renderer rule:
 * - renderers must treat these stride definitions as the single source of truth
 * - runtime / builders must not hardcode stride outside this schema module
 */

export const UNIT_INSTANCE_STRIDE = 20;
export const BUILDING_INSTANCE_STRIDE = 16;
export const PROJECTILE_INSTANCE_STRIDE = 8;
export const EFFECT_INSTANCE_STRIDE = 8;

const BattleSnapshotSchema = {
  version: 'battle-snapshot-v1',
  coordinates: {
    world: 'X right+, Y up+, Z up+',
    localAxes: 'width -> local X, depth -> local Y, height -> local Z',
    yawDeg: 'CCW from +X, used by UI/storage/minimap/layout DTO',
    yawRad: 'CCW from +X, used by renderer instance buffers and sim-facing draw data'
  },
  units: {
    stride: UNIT_INSTANCE_STRIDE,
    typedArray: 'Float32Array',
    fields: [
      'x', 'y', 'z', 'size',
      'yawRad', 'teamIndex', 'hpRatio', 'bodyIndex',
      'gearIndex', 'vehicleIndex', 'silhouetteIndex', 'tint',
      'selectedFlag', 'flagBearerFlag', 'ghostFlag', 'reserved',
      'bodyTopIndex', 'gearTopIndex', 'vehicleTopIndex', 'silhouetteTopIndex'
    ],
    notes: 'Compatible with ImpostorRenderer attribute layout locations 2..6'
  },
  buildings: {
    stride: BUILDING_INSTANCE_STRIDE,
    typedArray: 'Float32Array',
    fields: [
      'x', 'y', 'z', 'yawRad',
      'width', 'depth', 'height', 'hpRatio',
      'destroyedFlag', 'topR', 'topG', 'topB',
      'sideR', 'sideG', 'sideB', 'reserved'
    ],
    notes: 'width -> local X, depth -> local Y; yawRad follows world CCW from +X'
  },
  projectiles: {
    stride: PROJECTILE_INSTANCE_STRIDE,
    typedArray: 'Float32Array',
    fields: [
      'x', 'y', 'z', 'radius',
      'teamIndex', 'typeIndex', 'life01', 'reserved'
    ]
  },
  effects: {
    stride: EFFECT_INSTANCE_STRIDE,
    typedArray: 'Float32Array',
    fields: [
      'x', 'y', 'z', 'radius',
      'teamIndex', 'typeIndex', 'life01', 'reserved'
    ]
  },
  minimapSnapshot: {
    position: 'world x/y in the same +X right, +Y up coordinate system',
    buildingRotation: 'yawDeg (CCW from +X); canvas may invert sign because screen Y points downward'
  }
};

export default BattleSnapshotSchema;
