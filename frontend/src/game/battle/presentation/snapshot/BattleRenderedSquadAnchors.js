import { UNIT_INSTANCE_STRIDE } from './BattleSnapshotSchema';

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

const resolveSquadById = (runtime = null, squadsById = new Map(), squadId = '') => (
  squadsById.get(String(squadId || ''))
    || runtime?.getSquadById?.(String(squadId || ''))
    || null
);

const resolveRenderableBattleAgents = (runtime = null, squadsById = new Map()) => {
  const agents = Array.isArray(runtime?.crowd?.allAgents) ? runtime.crowd.allAgents : [];
  const rows = [];
  agents.forEach((agent) => {
    if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) return;
    const squadId = String(agent.squadId || '');
    const squad = resolveSquadById(runtime, squadsById, squadId);
    if (agent.team === TEAM_DEFENDER && squad?.hiddenFromAttacker) return;
    rows.push({
      squadId,
      agent,
      squad
    });
  });
  return rows;
};

const resolveSnapshotUnitSquadId = (snapshot = null, index = 0, fallback = '') => {
  const ids = snapshot?.unitSquadIds;
  if (Array.isArray(ids) && ids[index]) return String(ids[index]);
  return String(fallback || '');
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
  const agentRows = resolveRenderableBattleAgents(runtime, squadsById);
  const units = snapshot?.units;
  const data = units?.data;
  const unitCount = Math.max(0, Math.floor(Number(units?.count) || 0));
  const aggregates = new Map();

  for (let index = 0; index < unitCount; index += 1) {
    const row = agentRows[index] || null;
    const squadId = resolveSnapshotUnitSquadId(snapshot, index, row?.squadId);
    if (!squadId) continue;
    const base = index * UNIT_INSTANCE_STRIDE;
    const fallbackX = finiteOr(row?.agent?.x);
    const fallbackY = finiteOr(row?.agent?.y);
    const x = finiteOr(data?.[base + 0], fallbackX);
    const y = finiteOr(data?.[base + 1], fallbackY);
    const aggregate = aggregates.get(squadId) || { x: 0, y: 0, count: 0 };
    aggregate.x += x;
    aggregate.y += y;
    aggregate.count += 1;
    aggregates.set(squadId, aggregate);
  }

  const anchors = new Map();
  squads.forEach((squad) => {
    if (!squad?.id || (Number(squad.remain) || 0) <= 0) return;
    if (squad.team === TEAM_DEFENDER && squad.hiddenFromAttacker) return;
    const id = String(squad.id);
    const aggregate = aggregates.get(id);
    const x = aggregate?.count > 0
      ? aggregate.x / aggregate.count
      : finiteOr(squad.centerX, finiteOr(squad.x));
    const y = aggregate?.count > 0
      ? aggregate.y / aggregate.count
      : finiteOr(squad.centerY, finiteOr(squad.y));
    anchors.set(id, {
      id,
      squadId: id,
      team: squad.team || (id.startsWith('neutral_') ? TEAM_NEUTRAL : ''),
      x,
      y,
      centerX: x,
      centerY: y,
      count: aggregate?.count || 0
    });
  });
  return anchors;
};

export default resolveTrainingRenderedSquadAnchors;
