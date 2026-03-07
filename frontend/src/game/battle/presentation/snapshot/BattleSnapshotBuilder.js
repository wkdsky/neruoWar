import { buildWorldColliderParts } from '../../../battlefield/items/ItemGeometryRegistry';
import { normalizeUnitsMap, sumUnitsMap } from '../runtime/RepMapping';
import { degToRad } from '../../shared/angle';
import BattleSnapshotSchema from './BattleSnapshotSchema';
import BattleSnapshotPool from './BattleSnapshotPool';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const inferClassFromUnitType = (unitType = {}) => {
  const explicit = typeof unitType?.classTag === 'string' ? unitType.classTag.trim().toLowerCase() : '';
  if (explicit === 'infantry' || explicit === 'cavalry' || explicit === 'archer' || explicit === 'artillery') return explicit;
  const name = typeof unitType?.name === 'string' ? unitType.name : '';
  const roleTag = unitType?.roleTag === '远程' ? '远程' : '近战';
  const speed = Number(unitType?.speed) || 0;
  const range = Number(unitType?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|射手)/.test(name) || (roleTag === '远程' && range >= 3)) return 'archer';
  if (/(骑|铁骑|龙骑)/.test(name) || speed >= 2.1) return 'cavalry';
  return 'infantry';
};

const normalizeFormationFacing = (team = TEAM_ATTACKER, rawFacing = null) => {
  const fallback = team === TEAM_DEFENDER ? Math.PI : 0;
  const candidate = Number(rawFacing);
  if (!Number.isFinite(candidate)) return fallback;
  return candidate;
};

const rotateFormationSlot = (group = {}, slot = {}) => {
  const facing = Number(group?.formationRect?.facingRad);
  const yaw = Number.isFinite(facing) ? facing : normalizeFormationFacing(group?.team, null);
  const side = Number(slot?.side) || 0;
  const front = Number(slot?.front) || 0;
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const sx = -fy;
  const sy = fx;
  return {
    x: (Number(group?.x) || 0) + (sx * side) + (fx * front),
    y: (Number(group?.y) || 0) + (sy * side) + (fy * front),
    yaw
  };
};

const buildRenderableBuildingParts = (walls = []) => {
  const out = [];
  (Array.isArray(walls) ? walls : []).forEach((wall) => {
    if (!wall) return;
    const hpRatio = clamp((Number(wall?.hp) || 0) / Math.max(1, Number(wall?.maxHp) || 1), 0, 1);
    const colors = wall?.renderColors && typeof wall.renderColors === 'object'
      ? wall.renderColors
      : { top: [0.52, 0.58, 0.66], side: [0.38, 0.44, 0.52] };
    const localParts = Array.isArray(wall?.colliderParts) && wall.colliderParts.length > 0
      ? wall.colliderParts
      : buildWorldColliderParts(wall, wall, { stackLayerHeight: Number(wall?.height) || 32 });
    localParts.forEach((part) => {
      out.push({
        x: Number(part?.cx) || 0,
        y: Number(part?.cy) || 0,
        z: Math.max(0, Number(part?.cz) || 0) - (Math.max(1, Number(part?.h) || 1) * 0.5),
        width: Math.max(1, Number(part?.w) || 1),
        depth: Math.max(1, Number(part?.d) || 1),
        height: Math.max(1, Number(part?.h) || 1),
        rotation: Number(part?.yawDeg) || 0,
        hpRatio,
        destroyed: wall.destroyed ? 1 : 0,
        topColor: Array.isArray(colors.top) ? colors.top : [0.52, 0.58, 0.66],
        sideColor: Array.isArray(colors.side) ? colors.side : [0.38, 0.44, 0.52]
      });
    });
  });
  return out;
};

export default class BattleSnapshotBuilder {
  constructor(schema = BattleSnapshotSchema, pool = new BattleSnapshotPool(schema)) {
    this.schema = schema;
    this.pool = pool;
  }

  build(runtime, outSnapshot = this.pool.acquire()) {
    const unitsSchema = this.schema.units;
    const buildingsSchema = this.schema.buildings;
    const projectilesSchema = this.schema.projectiles;
    const effectsSchema = this.schema.effects;

    const deployUnitCount = [...(runtime?.attackerDeployGroups || []), ...(runtime?.defenderDeployGroups || [])]
      .reduce((sum, group) => {
        if (!group) return sum;
        runtime.hydrateDeployGroupFormation(group, group.team);
        const slots = Array.isArray(group.deploySlots) ? group.deploySlots : [];
        return sum + Math.max(1, slots.length);
      }, 0);

    this.pool.ensureCapacity('units', runtime?.crowd?.allAgents?.length || deployUnitCount);
    const hideDefenderIntelInDeploy = !runtime?.intelVisible && (!runtime?.sim || runtime?.phase === 'deploy');
    const activeBuildings = hideDefenderIntelInDeploy
      ? []
      : (Array.isArray(runtime?.sim?.buildings) ? runtime.sim.buildings : runtime?.initialBuildings);
    const activeBuildingParts = buildRenderableBuildingParts(activeBuildings);
    this.pool.ensureCapacity('buildings', activeBuildingParts.length || 0);
    this.pool.ensureCapacity('projectiles', runtime?.sim?.projectiles?.length || 0);
    this.pool.ensureCapacity('effects', runtime?.sim?.hitEffects?.length || 0);

    const units = outSnapshot.units;
    const buildings = outSnapshot.buildings;
    const projectiles = outSnapshot.projectiles;
    const effects = outSnapshot.effects;

    if (!runtime?.sim || !runtime?.crowd) {
      let previewCount = 0;
      const fillPreviewGroup = (group, teamTag, selected) => {
        if (!group) return;
        runtime.hydrateDeployGroupFormation(group, teamTag);
        const unitsMap = normalizeUnitsMap(group.units || {});
        const total = Math.max(1, sumUnitsMap(unitsMap));
        const typeRows = Object.entries(unitsMap)
          .map(([unitTypeId, count]) => ({ unitTypeId, count: Math.max(0, Number(count) || 0) }))
          .filter((row) => row.unitTypeId && row.count > 0);
        if (typeRows.length <= 0) return;
        const slots = Array.isArray(group.deploySlots) && group.deploySlots.length > 0
          ? group.deploySlots
          : [{ side: 0, front: 0 }];
        const slotCount = Math.max(1, slots.length);
        for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
          const slot = slots[slotIndex] || { side: 0, front: 0 };
          const targetWeight = ((slotIndex + 0.5) / slotCount) * total;
          let pickedTypeId = typeRows[0].unitTypeId;
          let accWeight = 0;
          for (let rowIndex = 0; rowIndex < typeRows.length; rowIndex += 1) {
            accWeight += typeRows[rowIndex].count;
            if (targetWeight <= accWeight) {
              pickedTypeId = typeRows[rowIndex].unitTypeId;
              break;
            }
          }
          const classTag = inferClassFromUnitType(runtime.unitTypeMap.get(pickedTypeId) || {});
          const visual = runtime.visualConfig(pickedTypeId, classTag);
          const isFlying = !!runtime.unitTypeMap.get(pickedTypeId)?.isFlying;
          const world = rotateFormationSlot(group, slot);
          const representedWeight = Math.max(1, total / slotCount);
          const base = previewCount * unitsSchema.stride;
          units.data[base + 0] = Number(world.x) || 0;
          units.data[base + 1] = Number(world.y) || 0;
          units.data[base + 2] = isFlying ? 8.5 : 0;
          units.data[base + 3] = Math.max(2.5, Math.min(9.5, Math.sqrt(representedWeight) * 0.82));
          units.data[base + 4] = Number(world.yaw) || (teamTag === TEAM_ATTACKER ? 0 : Math.PI);
          units.data[base + 5] = teamTag === TEAM_ATTACKER ? 0 : 1;
          units.data[base + 6] = 1;
          units.data[base + 7] = visual.bodyIndex;
          units.data[base + 8] = visual.gearIndex;
          units.data[base + 9] = visual.vehicleIndex;
          units.data[base + 10] = visual.silhouetteIndex || 0;
          units.data[base + 11] = Number.isFinite(Number(visual.tint)) ? Number(visual.tint) : 1;
          units.data[base + 12] = selected ? 1 : 0;
          units.data[base + 13] = slotIndex === 0 ? 1 : 0;
          units.data[base + 14] = 1;
          units.data[base + 15] = 0;
          units.data[base + 16] = visual.bodyTopIndex;
          units.data[base + 17] = visual.gearTopIndex;
          units.data[base + 18] = visual.vehicleTopIndex;
          units.data[base + 19] = visual.silhouetteTopIndex;
          previewCount += 1;
        }
      };
      (runtime.attackerDeployGroups || []).forEach((group) => fillPreviewGroup(group, TEAM_ATTACKER, group.id === runtime.selectedDeploySquadId));
      if (!hideDefenderIntelInDeploy) {
        (runtime.defenderDeployGroups || []).forEach((group) => fillPreviewGroup(group, TEAM_DEFENDER, group.id === runtime.selectedDeploySquadId));
      }
      units.count = previewCount;

      let wallCount = 0;
      for (let i = 0; i < activeBuildingParts.length; i += 1) {
        const part = activeBuildingParts[i];
        if (!part) continue;
        const base = wallCount * buildingsSchema.stride;
        buildings.data[base + 0] = Number(part.x) || 0;
        buildings.data[base + 1] = Number(part.y) || 0;
        buildings.data[base + 2] = Number(part.z) || 0;
        buildings.data[base + 3] = degToRad(part.rotation);
        buildings.data[base + 4] = Math.max(1, Number(part.width) || 1);
        buildings.data[base + 5] = Math.max(1, Number(part.depth) || 1);
        buildings.data[base + 6] = Math.max(1, Number(part.height) || 1);
        buildings.data[base + 7] = clamp(Number(part.hpRatio) || 0, 0, 1);
        buildings.data[base + 8] = Number(part.destroyed) || 0;
        buildings.data[base + 9] = Number(part.topColor?.[0]) || 0.52;
        buildings.data[base + 10] = Number(part.topColor?.[1]) || 0.58;
        buildings.data[base + 11] = Number(part.topColor?.[2]) || 0.66;
        buildings.data[base + 12] = Number(part.sideColor?.[0]) || 0.38;
        buildings.data[base + 13] = Number(part.sideColor?.[1]) || 0.44;
        buildings.data[base + 14] = Number(part.sideColor?.[2]) || 0.52;
        buildings.data[base + 15] = 0;
        wallCount += 1;
      }
      buildings.count = wallCount;
      projectiles.count = 0;
      effects.count = 0;
      return outSnapshot;
    }

    const agents = Array.isArray(runtime.crowd.allAgents) ? runtime.crowd.allAgents : [];
    let unitCount = 0;
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i];
      if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) continue;
      const squad = runtime.getSquadById(agent.squadId);
      const hiddenFromAttacker = !!squad?.hiddenFromAttacker;
      if (agent.team === TEAM_DEFENDER && hiddenFromAttacker) continue;
      const visual = runtime.visualConfig(agent.unitTypeId, squad?.classTag || agent.typeCategory || 'infantry');
      const isFlying = !!runtime.unitTypeMap.get(agent.unitTypeId)?.isFlying;
      const base = unitCount * unitsSchema.stride;
      units.data[base + 0] = Number(agent.x) || 0;
      units.data[base + 1] = Number(agent.y) || 0;
      units.data[base + 2] = isFlying ? 8.5 : 0;
      units.data[base + 3] = Math.max(2.6, Math.min(10.5, Math.sqrt(Math.max(1, Number(agent.weight) || 1)) * 0.82));
      units.data[base + 4] = Number(agent.yaw) || 0;
      units.data[base + 5] = agent.team === TEAM_ATTACKER ? 0 : 1;
      units.data[base + 6] = clamp((Number(agent.hpWeight) || Number(agent.weight) || 1) / Math.max(0.001, Number(agent.initialWeight) || 1), 0, 1);
      units.data[base + 7] = visual.bodyIndex;
      units.data[base + 8] = visual.gearIndex;
      units.data[base + 9] = visual.vehicleIndex;
      units.data[base + 10] = visual.silhouetteIndex || 0;
      units.data[base + 11] = Number.isFinite(Number(visual.tint)) ? Number(visual.tint) : 1;
      units.data[base + 12] = agent.squadId === runtime.selectedBattleSquadId ? 1 : 0;
      units.data[base + 13] = agent.isFlagBearer ? 1 : 0;
      units.data[base + 14] = 0;
      units.data[base + 15] = 0;
      units.data[base + 16] = visual.bodyTopIndex;
      units.data[base + 17] = visual.gearTopIndex;
      units.data[base + 18] = visual.vehicleTopIndex;
      units.data[base + 19] = visual.silhouetteTopIndex;
      unitCount += 1;
    }
    units.count = unitCount;

    let wallCount = 0;
    for (let i = 0; i < activeBuildingParts.length; i += 1) {
      const part = activeBuildingParts[i];
      if (!part) continue;
      const base = wallCount * buildingsSchema.stride;
      buildings.data[base + 0] = Number(part.x) || 0;
      buildings.data[base + 1] = Number(part.y) || 0;
      buildings.data[base + 2] = Number(part.z) || 0;
      buildings.data[base + 3] = degToRad(part.rotation);
      buildings.data[base + 4] = Math.max(1, Number(part.width) || 1);
      buildings.data[base + 5] = Math.max(1, Number(part.depth) || 1);
      buildings.data[base + 6] = Math.max(1, Number(part.height) || 1);
      buildings.data[base + 7] = clamp(Number(part.hpRatio) || 0, 0, 1);
      buildings.data[base + 8] = Number(part.destroyed) || 0;
      buildings.data[base + 9] = Number(part.topColor?.[0]) || 0.52;
      buildings.data[base + 10] = Number(part.topColor?.[1]) || 0.58;
      buildings.data[base + 11] = Number(part.topColor?.[2]) || 0.66;
      buildings.data[base + 12] = Number(part.sideColor?.[0]) || 0.38;
      buildings.data[base + 13] = Number(part.sideColor?.[1]) || 0.44;
      buildings.data[base + 14] = Number(part.sideColor?.[2]) || 0.52;
      buildings.data[base + 15] = 0;
      wallCount += 1;
    }
    buildings.count = wallCount;

    const projectilesRaw = Array.isArray(runtime.sim.projectiles) ? runtime.sim.projectiles : [];
    let projectileCount = 0;
    for (let i = 0; i < projectilesRaw.length; i += 1) {
      const p = projectilesRaw[i];
      if (!p || p.hit) continue;
      const base = projectileCount * projectilesSchema.stride;
      projectiles.data[base + 0] = Number(p.x) || 0;
      projectiles.data[base + 1] = Number(p.y) || 0;
      projectiles.data[base + 2] = Number(p.z) || 0;
      projectiles.data[base + 3] = Math.max(0.8, Number(p.radius) || 2.2);
      projectiles.data[base + 4] = p.team === TEAM_ATTACKER ? 0 : 1;
      projectiles.data[base + 5] = p.type === 'shell' ? 1 : 0;
      projectiles.data[base + 6] = clamp((Number(p.ttl) || 0) / Math.max(0.01, (Number(p.elapsed) || 0) + (Number(p.ttl) || 0)), 0, 1);
      projectiles.data[base + 7] = 0;
      projectileCount += 1;
    }
    projectiles.count = projectileCount;

    const effectsRaw = Array.isArray(runtime.sim.hitEffects) ? runtime.sim.hitEffects : [];
    let effectCount = 0;
    for (let i = 0; i < effectsRaw.length; i += 1) {
      const e = effectsRaw[i];
      if (!e) continue;
      const base = effectCount * effectsSchema.stride;
      effects.data[base + 0] = Number(e.x) || 0;
      effects.data[base + 1] = Number(e.y) || 0;
      effects.data[base + 2] = Number(e.z) || 0;
      effects.data[base + 3] = Math.max(0.6, Number(e.radius) || 2.2);
      effects.data[base + 4] = e.team === TEAM_ATTACKER ? 0 : 1;
      if (e.type === 'explosion') effects.data[base + 5] = 1;
      else if (e.type === 'buff_aura') effects.data[base + 5] = 2;
      else if (e.type === 'charge_dust') effects.data[base + 5] = 3;
      else if (e.type === 'smoke') effects.data[base + 5] = 4;
      else effects.data[base + 5] = 0;
      effects.data[base + 6] = clamp((Number(e.ttl) || 0) / Math.max(0.01, (Number(e.elapsed) || 0) + (Number(e.ttl) || 0)), 0, 1);
      effects.data[base + 7] = 0;
      effectCount += 1;
    }
    effects.count = effectCount;

    return outSnapshot;
  }
}
