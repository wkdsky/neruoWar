const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const sideSummary = (rows = []) => ({
  start: rows.reduce((sum, row) => sum + Math.max(0, Number(row?.startCount) || 0), 0),
  remain: rows.reduce((sum, row) => sum + Math.max(0, Number(row?.remain) || 0), 0),
  kills: rows.reduce((sum, row) => sum + Math.max(0, Number(row?.kills) || 0), 0)
});

export const buildBattleSummary = (sim = {}) => {
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  const attacker = squads.filter((row) => row.team === 'attacker');
  const defender = squads.filter((row) => row.team === 'defender');

  const byUnitType = {};
  squads.forEach((squad) => {
    const ratio = clamp01((Number(squad?.remain) || 0) / Math.max(1, Number(squad?.startCount) || 1));
    Object.entries(squad?.units || {}).forEach(([unitTypeId, count]) => {
      const start = Math.max(0, Math.floor(Number(count) || 0));
      if (!unitTypeId || start <= 0) return;
      if (!byUnitType[unitTypeId]) {
        byUnitType[unitTypeId] = { start: 0, remain: 0, kills: 0 };
      }
      byUnitType[unitTypeId].start += start;
      byUnitType[unitTypeId].remain += Math.max(0, Math.round(start * ratio));
      byUnitType[unitTypeId].kills += Math.max(0, Number(squad?.kills) || 0);
    });
  });

  return {
    battleId: sim?.battleId || '',
    gateKey: sim?.gateKey || '',
    durationSec: Math.max(0, Math.floor((Number(sim?.timeLimitSec) || 0) - (Number(sim?.timerSec) || 0))),
    attacker: sideSummary(attacker),
    defender: sideSummary(defender),
    details: {
      byUnitType,
      buildingsDestroyed: Math.max(0, Math.floor(Number(sim?.destroyedBuildings) || 0))
    }
  };
};
