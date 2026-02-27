const bySlotOrder = (a, b) => (Number(a?.slotOrder) || 0) - (Number(b?.slotOrder) || 0);

export const getAliveAgentsBySquad = (crowd, squadId) => {
  const agents = crowd?.agentsBySquad?.get(squadId);
  if (!Array.isArray(agents)) return [];
  return agents.filter((agent) => agent && !agent.dead && (Number(agent.weight) || 0) > 0.001);
};

export const resolveFlagBearerAgent = (crowd, squad) => {
  const alive = getAliveAgentsBySquad(crowd, squad?.id);
  if (alive.length <= 0) return null;
  const flagged = alive.find((agent) => agent.id === squad?.flagBearerAgentId);
  if (flagged) return flagged;
  const sorted = [...alive].sort(bySlotOrder);
  return sorted[0] || null;
};

export const resolveSquadAnchor = (sim, crowd, squadId) => {
  const squad = (sim?.squads || []).find((row) => row.id === squadId) || null;
  if (!squad) return null;
  const flag = resolveFlagBearerAgent(crowd, squad);
  if (flag) {
    return {
      x: Number(flag.x) || 0,
      y: Number(flag.y) || 0,
      vx: Number(flag.vx) || 0,
      vy: Number(flag.vy) || 0,
      squadId: squad.id,
      team: squad.team
    };
  }
  return {
    x: Number(squad.x) || 0,
    y: Number(squad.y) || 0,
    vx: 0,
    vy: 0,
    squadId: squad.id,
    team: squad.team
  };
};

export const resolveFallbackAnchor = (sim, crowd, preferredSquadId = '') => {
  if (preferredSquadId) {
    const picked = resolveSquadAnchor(sim, crowd, preferredSquadId);
    if (picked) return picked;
  }
  const firstAlive = (sim?.squads || []).find((row) => row && row.remain > 0) || null;
  if (!firstAlive) return { x: 0, y: 0, vx: 0, vy: 0, squadId: '', team: '' };
  return resolveSquadAnchor(sim, crowd, firstAlive.id)
    || { x: Number(firstAlive.x) || 0, y: Number(firstAlive.y) || 0, vx: 0, vy: 0, squadId: firstAlive.id, team: firstAlive.team };
};
