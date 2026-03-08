const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const DEFAULT_CONCEALMENT_MOVE_SPEED_MUL = 0.84;

const toInteractions = (obstacle = {}) => (
  Array.isArray(obstacle?.interactions)
    ? obstacle.interactions.filter((row) => row && typeof row === 'object')
    : []
);

export const getInteractionByKind = (obstacle = {}, kind = '') => {
  const safeKind = typeof kind === 'string' ? kind.trim() : '';
  if (!safeKind) return null;
  return toInteractions(obstacle).find((interaction) => interaction?.kind === safeKind) || null;
};

export const isConcealmentObstacle = (obstacle = {}) => !!getInteractionByKind(obstacle, 'concealment');

export const isSoftObstacle = (obstacle = {}) => {
  const interaction = getInteractionByKind(obstacle, 'concealment');
  if (!interaction) return false;
  if (interaction?.params?.softObstacle === false) return false;
  if (interaction?.params?.blocksMovement === true) return false;
  return true;
};

export const resolveObstacleMoveSpeedMul = (obstacle = {}, fallback = DEFAULT_CONCEALMENT_MOVE_SPEED_MUL) => {
  const interaction = getInteractionByKind(obstacle, 'concealment');
  const source = interaction?.params || {};
  const raw = Number(source?.moveSpeedMul ?? source?.speedMul ?? source?.slowMoveMul);
  const candidate = Number.isFinite(raw) ? raw : fallback;
  return Math.max(0.72, Math.min(0.98, candidate));
};

export const resolveObstacleFootprintRadius = (obstacle = {}) => {
  const ox = Number(obstacle?.x) || 0;
  const oy = Number(obstacle?.y) || 0;
  const parts = Array.isArray(obstacle?.colliderParts) ? obstacle.colliderParts : [];
  if (parts.length <= 0) {
    return Math.max(6, Math.hypot((Number(obstacle?.width) || 0) * 0.5, (Number(obstacle?.depth) || 0) * 0.5));
  }
  let best = 0;
  parts.forEach((part) => {
    const px = Number(part?.cx) || ox;
    const py = Number(part?.cy) || oy;
    const hw = Math.max(0.5, Number(part?.w) || 1) * 0.5;
    const hd = Math.max(0.5, Number(part?.d) || 1) * 0.5;
    const yaw = (Number(part?.yawDeg) || 0) * Math.PI / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const corners = [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd }
    ];
    corners.forEach((corner) => {
      const wx = px + ((corner.x * cos) - (corner.y * sin));
      const wy = py + ((corner.x * sin) + (corner.y * cos));
      best = Math.max(best, Math.hypot(wx - ox, wy - oy));
    });
  });
  return Math.max(6, best);
};

export const resolveConcealmentMaskRadius = (obstacle = {}) => {
  const footprint = resolveObstacleFootprintRadius(obstacle);
  return Math.max(6, footprint + Math.min(4, Math.max(1.5, footprint * 0.08)));
};

export const resolveConcealmentMaskTriggerRadius = (obstacle = {}) => {
  const radius = resolveConcealmentMaskRadius(obstacle);
  return radius + Math.max(6, Math.min(12, radius * 0.24));
};

export const filterBlockingObstacles = (obstacles = []) => (
  (Array.isArray(obstacles) ? obstacles : []).filter((obstacle) => obstacle && !obstacle.destroyed && !isSoftObstacle(obstacle))
);

export const resolveViewerTeam = (sim = {}) => {
  const viewerTeam = typeof sim?.viewerTeam === 'string' ? sim.viewerTeam.trim() : '';
  if (viewerTeam === TEAM_ATTACKER || viewerTeam === TEAM_DEFENDER) return viewerTeam;
  return TEAM_ATTACKER;
};

export const isOccupiedByViewerTeam = (obstacle = {}, viewerTeam = TEAM_ATTACKER) => {
  if (!obstacle) return false;
  if (viewerTeam === TEAM_DEFENDER) return !!obstacle.occupiedByDefender;
  return !!obstacle.occupiedByAttacker;
};

const itemObstacleUtils = {
  getInteractionByKind,
  isConcealmentObstacle,
  isSoftObstacle,
  resolveObstacleMoveSpeedMul,
  resolveObstacleFootprintRadius,
  resolveConcealmentMaskRadius,
  resolveConcealmentMaskTriggerRadius,
  filterBlockingObstacles,
  resolveViewerTeam,
  isOccupiedByViewerTeam
};

export default itemObstacleUtils;
