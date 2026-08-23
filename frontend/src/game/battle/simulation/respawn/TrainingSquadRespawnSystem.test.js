import { updateTrainingSquadRespawns } from './TrainingSquadRespawnSystem';

const createSquad = (overrides = {}) => ({
  id: 'attacker_squad',
  team: 'attacker',
  controlMode: 'USER',
  startCount: 20,
  remain: 0,
  units: { infantry_basic: 20 },
  remainUnits: {},
  maxHealth: 1600,
  health: 0,
  radius: 12,
  x: 0,
  y: 0,
  respawnPoint: {
    id: 'respawn-attacker-top',
    x: -320,
    y: 120,
    facingRad: 0
  },
  ...overrides
});

describe('TrainingSquadRespawnSystem', () => {
  test('queues a defeated squad and respawns its full formation at the home point', () => {
    const squad = createSquad();
    const sim = {
      trainingRespawnConfig: { enabled: true, delaySec: 12 },
      squads: [squad]
    };
    const crowd = { agentsBySquad: new Map([[squad.id, []]]) };
    const spawned = [];
    const spawnSquad = (row) => {
      const agents = [{ id: `${row.id}_agent`, dead: false, weight: row.remain }];
      crowd.agentsBySquad.set(row.id, agents);
      spawned.push({ ...row });
      return agents;
    };

    expect(updateTrainingSquadRespawns({ sim, crowd, nowSec: 3, spawnSquad })).toEqual({ queued: 1, respawned: 0 });
    expect(squad.respawnState).toMatchObject({ state: 'waiting', respawnAt: 15, remainingSec: 12 });
    expect(squad.action).toBe('重生倒计时');

    expect(updateTrainingSquadRespawns({ sim, crowd, nowSec: 10, spawnSquad })).toEqual({ queued: 0, respawned: 0 });
    expect(squad.respawnState.remainingSec).toBe(5);

    expect(updateTrainingSquadRespawns({ sim, crowd, nowSec: 15, spawnSquad })).toEqual({ queued: 0, respawned: 1 });
    expect(spawned).toHaveLength(1);
    expect(squad).toMatchObject({
      x: -320,
      y: 120,
      remain: 20,
      health: 1600,
      action: '重生完成'
    });
    expect(squad.respawnState).toMatchObject({ state: 'alive', lastRespawnAt: 15, cycles: 1 });
  });

  test('does not queue neutral camp guards for team respawn', () => {
    const squad = createSquad({ team: 'neutral', isNeutralCampUnit: true });
    const result = updateTrainingSquadRespawns({
      sim: {
        trainingRespawnConfig: { enabled: true, delaySec: 12 },
        squads: [squad]
      },
      crowd: { agentsBySquad: new Map([[squad.id, []]]) },
      nowSec: 3
    });

    expect(result).toEqual({ queued: 0, respawned: 0 });
    expect(squad.respawnState).toBeUndefined();
  });
});
