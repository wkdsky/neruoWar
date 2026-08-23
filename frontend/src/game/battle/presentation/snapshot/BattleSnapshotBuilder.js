import { buildWorldColliderParts } from '../../../battlefield/items/ItemGeometryRegistry';
import {
  normalizeUnitsMap,
  resolveRepConfigForSquads,
  sumUnitsMap
} from '../runtime/RepMapping';
import { degToRad } from '../../shared/angle';
import { resolveTrainingMapTerrainElevation } from '../../shared/trainingMap';
import { resolveTrainingAgentVisualSize } from '../../shared/trainingUnitSelection';
import BattleSnapshotSchema from './BattleSnapshotSchema';
import BattleSnapshotPool from './BattleSnapshotPool';
import { isConcealmentObstacle } from '../../simulation/items/itemObstacleUtils';
import { createCrowdSim } from '../../simulation/crowd/CrowdSim';
import { initializeTrainingNeutralCamps } from '../../simulation/objectives/TrainingNeutralCampSystem';

const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const TEAM_NEUTRAL = 'neutral';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const resolveTeamIndex = (team = TEAM_ATTACKER) => {
  if (team === TEAM_DEFENDER) return 1;
  if (team === TEAM_NEUTRAL) return 2;
  return 0;
};

const inferClassFromUnitType = (unitType = {}) => {
  const explicit = typeof unitType?.classTag === 'string' ? unitType.classTag.trim().toLowerCase() : '';
  if (explicit === 'infantry' || explicit === 'cavalry' || explicit === 'archer' || explicit === 'artillery') return explicit;
  const name = typeof unitType?.name === 'string' ? unitType.name : '';
  const roleTag = unitType?.roleTag === '远程' ? '远程' : '近战';
  const speed = Number(unitType?.speed) || 0;
  const range = Number(unitType?.attackRange?.max ?? unitType?.range) || 0;
  if (/(炮|投石|火炮|炮兵|臼炮|加农)/.test(name)) return 'artillery';
  if (/(弓|弩|射手)/.test(name) || (roleTag === '远程' && range >= 3)) return 'archer';
  if (/(骑|铁骑|龙骑)/.test(name) || speed >= 2.1) return 'cavalry';
  return 'infantry';
};

const inferSkillCategoryFromUnitType = (unitType = {}, fallback = 'melee') => {
  const category = typeof unitType?.unitCategory === 'string'
    ? unitType.unitCategory.trim().toLowerCase()
    : (typeof unitType?.rpsType === 'string' ? unitType.rpsType.trim().toLowerCase() : '');
  if (category === 'ranged' || category === 'support' || category === 'melee') return category;
  return fallback === 'ranged' || fallback === 'support' ? fallback : 'melee';
};

const skillCategoryIndex = (category = 'melee') => (
  category === 'ranged' ? 1 : (category === 'support' ? 2 : 0)
);

const skillSubtypeIndex = (category = 'melee', subtype = '') => {
  const value = String(subtype || '').trim().toLowerCase();
  if (category === 'support') {
    return value === 'combination' ? 0 : (value === 'intervention' ? 2 : 1);
  }
  return value === 'mobility' ? 0 : (value === 'defense' ? 1 : 2);
};

const resolveSkillVisualState = (agent = null) => {
  const category = inferSkillCategoryFromUnitType({ unitCategory: agent?.unitCategory }, 'melee');
  const cast = agent?.castState;
  const style = String(cast?.style || '');
  const skillActionIndex = style === 'ranged' ? 2 : (style === 'support' ? 3 : (style === 'melee' ? 1 : 0));
  const duration = Math.max(0.01, Number(cast?.durationSec) || 0.01);
  return {
    categoryIndex: skillCategoryIndex(category),
    subtypeIndex: skillSubtypeIndex(category, agent?.unitSubtype),
    skillActionIndex,
    skillProgress: cast ? clamp((Number(cast.elapsedSec) || 0) / duration, 0, 1) : 0
  };
};

const writeSkillVisualState = (data, base, agent = null) => {
  const category = inferSkillCategoryFromUnitType({ unitCategory: agent?.unitCategory }, 'melee');
  const cast = agent?.castState;
  const style = String(cast?.style || '');
  const duration = Math.max(0.01, Number(cast?.durationSec) || 0.01);
  data[base + 0] = skillCategoryIndex(category);
  data[base + 1] = skillSubtypeIndex(category, agent?.unitSubtype);
  data[base + 2] = style === 'ranged' ? 2 : (style === 'support' ? 3 : (style === 'melee' ? 1 : 0));
  data[base + 3] = cast ? clamp((Number(cast.elapsedSec) || 0) / duration, 0, 1) : 0;
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

const buildDeploymentRepSignature = (runtime = null) => (
  [...(runtime?.attackerDeployGroups || []), ...(runtime?.defenderDeployGroups || [])]
    .filter((group) => group && group.placed !== false)
    .map((group) => [
      String(group?.id || ''),
      Number(group?.representativeAgentWeightCap) || 0,
      Object.entries(normalizeUnitsMap(group?.units || {}))
        .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
    ])
    .map((entry) => JSON.stringify(entry))
    .join('|')
);

const buildRepConfigSignature = (config = {}) => [
  Number(config?.maxAgentWeight) || 0,
  Number(config?.maxTotalAgents) || 0,
  Number(config?.damageExponent) || 0,
  config?.strictAgentMapping === false ? 0 : 1,
  Number(config?.effectiveMaxAgentWeight) || 0,
  Number(config?.estimatedAgentCount) || 0
].join(':');

const resolveNeutralPreviewRepConfig = (runtime = null, neutralSquads = []) => {
  const deploySquads = [...(runtime?.attackerDeployGroups || []), ...(runtime?.defenderDeployGroups || [])]
    .filter((group) => group && group.placed !== false)
    .map((group) => ({
      units: normalizeUnitsMap(group?.units || {}),
      representativeAgentWeightCap: group?.representativeAgentWeightCap
    }));
  return resolveRepConfigForSquads([
    ...deploySquads,
    ...(Array.isArray(neutralSquads) ? neutralSquads : [])
  ], runtime?.repConfig || {});
};

const buildRenderableBuildingParts = (walls = [], resolveTerrainElevation = () => 0) => {
  const out = [];
  (Array.isArray(walls) ? walls : []).forEach((wall) => {
    if (!wall) return;
    const rendersAsTrainingWallPath = wall?.mapStatic === true
      && wall?.category === 'wall'
      && Array.isArray(wall?.visualPath)
      && wall.visualPath.length >= 2;
    const rendersAsTrainingMapPlaceholder = wall?.mapStatic === true
      && (wall?.category === 'tower' || wall?.category === 'barracks' || wall?.category === 'neutralCamp');
    if (rendersAsTrainingWallPath || rendersAsTrainingMapPlaceholder) return;
    const hpRatio = clamp((Number(wall?.hp) || 0) / Math.max(1, Number(wall?.maxHp) || 1), 0, 1);
    const colors = wall?.renderColors && typeof wall.renderColors === 'object'
      ? wall.renderColors
      : { top: [0.52, 0.58, 0.66], side: [0.38, 0.44, 0.52] };
    const meshId = typeof wall?.renderProfile?.battle?.meshId === 'string' ? wall.renderProfile.battle.meshId : '';
    const isBush = /bush/i.test(meshId) || isConcealmentObstacle(wall);
    if (isBush) {
      const terrainElevation = Math.max(0, Number(resolveTerrainElevation({ x: wall?.x, y: wall?.y })) || 0);
      out.push({
        x: Number(wall?.x) || 0,
        y: Number(wall?.y) || 0,
        z: Math.max(0, Number(wall?.z) || 0) + terrainElevation,
        width: Math.max(1, Number(wall?.width) || 1),
        depth: Math.max(1, Number(wall?.depth) || 1),
        height: Math.max(1, Number(wall?.height) || 1),
        rotation: Number(wall?.rotation) || 0,
        hpRatio,
        destroyed: wall.destroyed ? 1 : 0,
        topColor: Array.isArray(colors.top) ? colors.top : [0.52, 0.58, 0.66],
        sideColor: Array.isArray(colors.side) ? colors.side : [0.38, 0.44, 0.52],
        foliageOpacity: clamp(Number(wall?.renderOpacity) || 0.94, 0.14, 1)
      });
      return;
    }
    const localParts = Array.isArray(wall?.colliderParts) && wall.colliderParts.length > 0
      ? wall.colliderParts
      : buildWorldColliderParts(wall, wall, { stackLayerHeight: Number(wall?.height) || 32 });
    localParts.forEach((part) => {
      const terrainElevation = Math.max(0, Number(resolveTerrainElevation({ x: part?.cx, y: part?.cy })) || 0);
      out.push({
        x: Number(part?.cx) || 0,
        y: Number(part?.cy) || 0,
        z: Math.max(0, Number(part?.cz) || 0) - (Math.max(1, Number(part?.h) || 1) * 0.5) + terrainElevation,
        width: Math.max(1, Number(part?.w) || 1),
        depth: Math.max(1, Number(part?.d) || 1),
        height: Math.max(1, Number(part?.h) || 1),
        rotation: Number(part?.yawDeg) || 0,
        hpRatio,
        destroyed: wall.destroyed ? 1 : 0,
        topColor: Array.isArray(colors.top) ? colors.top : [0.52, 0.58, 0.66],
        sideColor: Array.isArray(colors.side) ? colors.side : [0.38, 0.44, 0.52],
        foliageOpacity: 0
      });
    });
  });
  return out;
};

export default class BattleSnapshotBuilder {
  constructor(schema = BattleSnapshotSchema, pool = new BattleSnapshotPool(schema)) {
    this.schema = schema;
    this.pool = pool;
    this.neutralPreviewCache = null;
  }

  getNeutralPreview(runtime = null) {
    const mapConfigObjectives = runtime?.getTrainingMapConfig?.()?.objectives;
    const definitions = Array.isArray(runtime?.trainingMapObjectiveDefinitions)
      ? runtime.trainingMapObjectiveDefinitions
      : (Array.isArray(mapConfigObjectives) ? mapConfigObjectives : []);
    if (definitions.length <= 0 || runtime?.sim || runtime?.crowd) return null;
    const initialBuildings = Array.isArray(runtime?.initialBuildings) ? runtime.initialBuildings : [];
    const deploymentRepSignature = buildDeploymentRepSignature(runtime);
    const baseRepConfigSignature = buildRepConfigSignature(runtime?.repConfig);
    if (
      this.neutralPreviewCache
      && this.neutralPreviewCache.definitions === definitions
      && this.neutralPreviewCache.initialBuildings === initialBuildings
      && this.neutralPreviewCache.unitTypeMap === runtime?.unitTypeMap
      && this.neutralPreviewCache.field === runtime?.field
      && this.neutralPreviewCache.deploymentRepSignature === deploymentRepSignature
      && this.neutralPreviewCache.baseRepConfigSignature === baseRepConfigSignature
    ) {
      return this.neutralPreviewCache;
    }
    const state = initializeTrainingNeutralCamps({
      definitions,
      buildings: initialBuildings,
      context: {
        field: runtime?.field,
        navigator: runtime?.trainingMapNavigator,
        obstacles: initialBuildings
      },
      nowSec: 0
    });
    const repConfig = resolveNeutralPreviewRepConfig(runtime, state.squads);
    const previewSim = {
      field: runtime?.field,
      buildings: initialBuildings,
      squads: state.squads,
      repConfig,
      trainingNavigator: runtime?.trainingMapNavigator
    };
    const previewCrowd = createCrowdSim(previewSim, {
      unitTypeMap: runtime?.unitTypeMap
    });
    this.neutralPreviewCache = {
      definitions,
      initialBuildings,
      unitTypeMap: runtime?.unitTypeMap,
      field: runtime?.field,
      deploymentRepSignature,
      baseRepConfigSignature,
      repConfig,
      squads: state.squads,
      agents: previewCrowd.allAgents
    };
    return this.neutralPreviewCache;
  }

  build(runtime, outSnapshot = this.pool.acquire()) {
    const unitsSchema = this.schema.units;
    const skillStatesSchema = this.schema.skillStates;
    const buildingsSchema = this.schema.buildings;
    const projectilesSchema = this.schema.projectiles;
    const effectsSchema = this.schema.effects;

    const neutralPreview = this.getNeutralPreview(runtime);
    const deployUnitCount = [...(runtime?.attackerDeployGroups || []), ...(runtime?.defenderDeployGroups || [])]
      .reduce((sum, group) => {
        if (!group) return sum;
        runtime.hydrateDeployGroupFormation(group, group.team);
        const slots = Array.isArray(group.deploySlots) ? group.deploySlots : [];
        return sum + Math.max(1, slots.length);
      }, 0);

    const requestedUnitCapacity = runtime?.crowd?.allAgents?.length
      || (deployUnitCount + (neutralPreview?.agents?.length || 0));
    this.pool.ensureCapacity('units', requestedUnitCapacity);
    this.pool.ensureCapacity('skillStates', requestedUnitCapacity);
    const hideDefenderIntelInDeploy = !runtime?.intelVisible && (!runtime?.sim || runtime?.phase === 'deploy');
    const activeBuildings = hideDefenderIntelInDeploy
      ? []
      : (Array.isArray(runtime?.sim?.buildings) ? runtime.sim.buildings : runtime?.initialBuildings);
    const mapConfig = runtime?.getTrainingMapConfig?.() || null;
    const resolveTerrainElevation = (point = {}) => resolveTrainingMapTerrainElevation(mapConfig, point);
    const activeBuildingParts = buildRenderableBuildingParts(activeBuildings, resolveTerrainElevation);
    this.pool.ensureCapacity('buildings', activeBuildingParts.length || 0);
    this.pool.ensureCapacity('projectiles', runtime?.sim?.projectiles?.length || 0);
    this.pool.ensureCapacity('effects', runtime?.sim?.hitEffects?.length || 0);

    const units = outSnapshot.units;
    const unitSquadIds = Array.isArray(outSnapshot.unitSquadIds) ? outSnapshot.unitSquadIds : [];
    const skillStates = outSnapshot.skillStates;
    const buildings = outSnapshot.buildings;
    const projectiles = outSnapshot.projectiles;
    const effects = outSnapshot.effects;

    if (!runtime?.sim || !runtime?.crowd) {
      let previewCount = 0;
      const fillPreviewGroup = (group, teamTag, selected) => {
        if (!group) return;
        if (group.placed === false && !group.placementActive) return;
        const hovered = !selected && group.id === runtime.hoveredDeploySquadId;
        runtime.hydrateDeployGroupFormation(group, teamTag);
        const unitsMap = normalizeUnitsMap(group.units || {});
        const total = Math.max(1, sumUnitsMap(unitsMap));
        const typeRows = Object.entries(unitsMap)
          .map(([unitTypeId, count]) => ({ unitTypeId, count: Math.max(0, Number(count) || 0) }))
          .filter((row) => row.unitTypeId && row.count > 0);
        if (typeRows.length <= 0) return;

        const showFullFormation = group.placed !== false || runtime.canDeployGroupFitAt?.(group.id, group, teamTag) === true;
        const slots = showFullFormation && Array.isArray(group.deploySlots) && group.deploySlots.length > 0
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
          const representedWeight = showFullFormation ? Math.max(1, total / slotCount) : total;
          const terrainElevation = resolveTerrainElevation(world);
          const base = previewCount * unitsSchema.stride;
          unitSquadIds[previewCount] = String(group?.id || '');
          units.data[base + 0] = Number(world.x) || 0;
          units.data[base + 1] = Number(world.y) || 0;
          units.data[base + 2] = terrainElevation + (isFlying ? 8.5 : 0);
          units.data[base + 3] = showFullFormation
            ? Math.max(2.5, Math.min(9.5, Math.sqrt(representedWeight) * 0.82))
            : Math.max(5.5, Math.min(11.5, 3.8 + (Math.sqrt(representedWeight) * 0.52)));
          units.data[base + 4] = Number(world.yaw) || (teamTag === TEAM_ATTACKER ? 0 : Math.PI);
          units.data[base + 5] = teamTag === TEAM_ATTACKER ? 0 : 1;
          units.data[base + 6] = 1;
          units.data[base + 7] = visual.bodyIndex;
          units.data[base + 8] = visual.gearIndex;
          units.data[base + 9] = visual.vehicleIndex;
          units.data[base + 10] = visual.silhouetteIndex || 0;
          units.data[base + 11] = Number.isFinite(Number(visual.tint)) ? Number(visual.tint) : 1;
          units.data[base + 12] = selected ? 1 : 0;
          units.data[base + 13] = !showFullFormation || slotIndex === 0 ? 1 : 0;
          units.data[base + 14] = 1;
          units.data[base + 15] = hovered ? 1 : 0;
          units.data[base + 16] = visual.bodyTopIndex;
          units.data[base + 17] = visual.gearTopIndex;
          units.data[base + 18] = visual.vehicleTopIndex;
          units.data[base + 19] = visual.silhouetteTopIndex;
          const previewSkillVisual = resolveSkillVisualState({
            unitCategory: runtime.unitTypeMap.get(pickedTypeId)?.unitCategory,
            unitSubtype: runtime.unitTypeMap.get(pickedTypeId)?.unitSubtype
          });
          const skillBase = previewCount * skillStatesSchema.stride;
          skillStates.data[skillBase + 0] = previewSkillVisual.categoryIndex;
          skillStates.data[skillBase + 1] = previewSkillVisual.subtypeIndex;
          skillStates.data[skillBase + 2] = 0;
          skillStates.data[skillBase + 3] = 0;
          previewCount += 1;
        }
      };
      (runtime.attackerDeployGroups || []).forEach((group) => fillPreviewGroup(group, TEAM_ATTACKER, group.id === runtime.selectedDeploySquadId));
      if (!hideDefenderIntelInDeploy) {
        (runtime.defenderDeployGroups || []).forEach((group) => fillPreviewGroup(group, TEAM_DEFENDER, group.id === runtime.selectedDeploySquadId));
      }
      const previewSquadsById = new Map((neutralPreview?.squads || []).map((squad) => [String(squad?.id || ''), squad]));
      (neutralPreview?.agents || []).forEach((agent) => {
        if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) return;
        const squad = previewSquadsById.get(String(agent.squadId || '')) || null;
        const unitType = runtime?.unitTypeMap?.get?.(agent.unitTypeId) || {};
        const classTag = squad?.classTag || agent.typeCategory || 'infantry';
        const visual = (typeof runtime?.visualConfig === 'function'
          ? runtime.visualConfig(agent.unitTypeId, classTag)
          : {}) || {};
        const isFlying = !!unitType.isFlying;
        const terrainElevation = resolveTerrainElevation(agent);
        const base = previewCount * unitsSchema.stride;
        unitSquadIds[previewCount] = String(agent.squadId || '');
        units.data[base + 0] = Number(agent.x) || 0;
        units.data[base + 1] = Number(agent.y) || 0;
        units.data[base + 2] = terrainElevation + (isFlying ? 8.5 : 0);
        units.data[base + 3] = resolveTrainingAgentVisualSize(agent);
        units.data[base + 4] = Number(agent.yaw) || 0;
        units.data[base + 5] = resolveTeamIndex(TEAM_NEUTRAL);
        units.data[base + 6] = clamp((Number(agent.hpWeight) || Number(agent.weight) || 1) / Math.max(0.001, Number(agent.initialWeight) || 1), 0, 1);
        units.data[base + 7] = visual.bodyIndex || 0;
        units.data[base + 8] = visual.gearIndex || 0;
        units.data[base + 9] = visual.vehicleIndex || 0;
        units.data[base + 10] = visual.silhouetteIndex || 0;
        units.data[base + 11] = Number.isFinite(Number(visual.tint)) ? Number(visual.tint) : 1;
        units.data[base + 12] = 0;
        units.data[base + 13] = agent.isFlagBearer ? 1 : 0;
        units.data[base + 14] = 0;
        units.data[base + 15] = 0;
        units.data[base + 16] = visual.bodyTopIndex || 0;
        units.data[base + 17] = visual.gearTopIndex || 0;
        units.data[base + 18] = visual.vehicleTopIndex || 0;
        units.data[base + 19] = visual.silhouetteTopIndex || 0;
        writeSkillVisualState(skillStates.data, previewCount * skillStatesSchema.stride, agent);
        previewCount += 1;
      });
      units.count = previewCount;
      skillStates.count = previewCount;
      unitSquadIds.length = previewCount;
      outSnapshot.unitSquadIds = unitSquadIds;

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
        buildings.data[base + 15] = Number(part.foliageOpacity) || 0;
        wallCount += 1;
      }
      buildings.count = wallCount;
      projectiles.count = 0;
      effects.count = 0;
      return outSnapshot;
    }

    const agents = Array.isArray(runtime.crowd.allAgents) ? runtime.crowd.allAgents : [];
    const squadsById = runtime?.sim?._squadById instanceof Map
      ? runtime.sim._squadById
      : new Map((Array.isArray(runtime?.sim?.squads) ? runtime.sim.squads : [])
        .filter((squad) => squad?.id)
        .map((squad) => [String(squad.id), squad]));
    let unitCount = 0;
    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i];
      if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) continue;
      const squad = squadsById.get(String(agent.squadId || '')) || null;
      const hiddenFromAttacker = !!squad?.hiddenFromAttacker;
      if (agent.team === TEAM_DEFENDER && hiddenFromAttacker) continue;
      const visual = runtime.visualConfig(agent.unitTypeId, squad?.classTag || agent.typeCategory || 'infantry');
      const isFlying = !!runtime.unitTypeMap.get(agent.unitTypeId)?.isFlying;
      const terrainElevation = resolveTerrainElevation(agent);
      const base = unitCount * unitsSchema.stride;
      unitSquadIds[unitCount] = String(agent.squadId || '');
      units.data[base + 0] = Number(agent.x) || 0;
      units.data[base + 1] = Number(agent.y) || 0;
      units.data[base + 2] = terrainElevation + (isFlying ? 8.5 : 0);
      const agentVisualSize = resolveTrainingAgentVisualSize(agent);
      units.data[base + 3] = squad?.isMinionWaveUnit === true
        ? Math.min(15, Math.max(7.2, agentVisualSize * 2.8))
        : agentVisualSize;
      units.data[base + 4] = Number(agent.yaw) || 0;
      units.data[base + 5] = resolveTeamIndex(agent.team);
      units.data[base + 6] = clamp((Number(agent.hpWeight) || Number(agent.weight) || 1) / Math.max(0.001, Number(agent.initialWeight) || 1), 0, 1);
      units.data[base + 7] = visual.bodyIndex;
      units.data[base + 8] = visual.gearIndex;
      units.data[base + 9] = visual.vehicleIndex;
      units.data[base + 10] = visual.silhouetteIndex || 0;
      units.data[base + 11] = Number.isFinite(Number(visual.tint)) ? Number(visual.tint) : 1;
      units.data[base + 12] = agent.squadId === runtime.selectedBattleSquadId ? 1 : 0;
      units.data[base + 13] = agent.isFlagBearer ? 1 : 0;
      units.data[base + 14] = 0;
      units.data[base + 15] = runtime.hoveredBattleSquadId
        && agent.squadId === runtime.hoveredBattleSquadId
        ? 1
        : 0;
      units.data[base + 16] = visual.bodyTopIndex;
      units.data[base + 17] = visual.gearTopIndex;
      units.data[base + 18] = visual.vehicleTopIndex;
      units.data[base + 19] = visual.silhouetteTopIndex;
      const skillBase = unitCount * skillStatesSchema.stride;
      writeSkillVisualState(skillStates.data, skillBase, agent);
      unitCount += 1;
    }
    units.count = unitCount;
    skillStates.count = unitCount;
    unitSquadIds.length = unitCount;
    outSnapshot.unitSquadIds = unitSquadIds;

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
      buildings.data[base + 15] = Number(part.foliageOpacity) || 0;
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
      projectiles.data[base + 4] = resolveTeamIndex(p.team);
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
      effects.data[base + 4] = resolveTeamIndex(e.team);
      if (e.type === 'explosion') effects.data[base + 5] = 1;
      else if (e.type === 'buff_aura') effects.data[base + 5] = 2;
      else if (e.type === 'charge_dust') effects.data[base + 5] = 3;
      else if (e.type === 'smoke') effects.data[base + 5] = 4;
      else if (e.type === 'debuff_aura') effects.data[base + 5] = 5;
      else if (e.type === 'cast_pulse') effects.data[base + 5] = 6;
      else effects.data[base + 5] = 0;
      effects.data[base + 6] = clamp((Number(e.ttl) || 0) / Math.max(0.01, (Number(e.elapsed) || 0) + (Number(e.ttl) || 0)), 0, 1);
      effects.data[base + 7] = 0;
      effectCount += 1;
    }
    effects.count = effectCount;

    return outSnapshot;
  }
}
