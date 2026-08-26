import { UNIT_INSTANCE_STRIDE } from './BattleSnapshotSchema';
import { resolveSquadSpatialAnchor } from '../../shared/squadSpatialAnchor';

const TEAM_DEFENDER = 'defender';
const TEAM_NEUTRAL = 'neutral';

const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const resolveRuntimeSquads = (runtime = null) => (
  Array.isArray(runtime?.sim?.squads)
    ? runtime.sim.squads
    : (Array.isArray(runtime?.squads) ? runtime.squads : [])
);

const resolveSnapshotUnitSquadId = (snapshot = null, index = 0) => {
  const ids = snapshot?.unitSquadIds;
  if (Array.isArray(ids) && ids[index]) return String(ids[index]);
  return '';
};

export const resolveTrainingRenderedSquadAnchors = (runtime = null, snapshot = null) => {
  const phase = runtime?.getPhase?.() || runtime?.phase || '';
  if (
    phase !== 'battle'
    && phase !== 'ended'
    && !(runtime?.sim && runtime?.crowd)
  ) {
    return new Map();
  }

  const squads = resolveRuntimeSquads(runtime);
  const squadsById = new Map(
    squads
      .filter((squad) => squad?.id)
      .map((squad) => [String(squad.id), squad])
  );
  const units = snapshot?.units;
  const data = units?.data;
  const unitCount = Math.max(0, Math.floor(Number(units?.count) || 0));
  const aggregates = new Map();

  for (let index = 0; index < unitCount; index += 1) {
    const squadId = resolveSnapshotUnitSquadId(snapshot, index);
    if (!squadId) continue;
    const squad = squadsById.get(squadId) || null;
    const base = index * UNIT_INSTANCE_STRIDE;
    const fallbackX = finiteOr(squad?.centerX, finiteOr(squad?.x));
    const fallbackY = finiteOr(squad?.centerY, finiteOr(squad?.y));
    const x = finiteOr(data?.[base + 0], fallbackX);
    const y = finiteOr(data?.[base + 1], fallbackY);
    const aggregate = aggregates.get(squadId) || {
      points: [],
      flagBearer: null
    };
    aggregate.points.push({ x, y });
    if (
      (squad?.team === TEAM_NEUTRAL || Number(data?.[base + 5]) >= 1.5)
      && Number(data?.[base + 13]) > 0.5
    ) {
      aggregate.flagBearer = { x, y };
    }
    aggregates.set(squadId, aggregate);
  }

  const anchors = new Map();
  squads.forEach((squad) => {
    if (!squad?.id || (Number(squad.remain) || 0) <= 0) return;
    if (squad.team === TEAM_DEFENDER && squad.hiddenFromAttacker) return;
    const id = String(squad.id);
    const aggregate = aggregates.get(id);
    const fallbackX = finiteOr(squad.centerX, finiteOr(squad.x));
    const fallbackY = finiteOr(squad.centerY, finiteOr(squad.y));
    const spatialAnchor = resolveSquadSpatialAnchor(aggregate?.points, {
      fallbackX,
      fallbackY,
      minimumRadius: 8,
      radiusPadding: 6
    });
    const x = aggregate?.flagBearer?.x ?? spatialAnchor.x;
    const y = aggregate?.flagBearer?.y ?? spatialAnchor.y;
    anchors.set(id, {
      id,
      squadId: id,
      team: squad.team || (id.startsWith('neutral_') ? TEAM_NEUTRAL : ''),
      x,
      y,
      centerX: x,
      centerY: y,
      contactX: x,
      contactY: y,
      radius: spatialAnchor.radius,
      count: spatialAnchor.count,
      inlierCount: spatialAnchor.inlierCount
    });
  });
  return anchors;
};

export default resolveTrainingRenderedSquadAnchors;
