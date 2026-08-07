const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { fetchUnitTypesWithComponents } = require('../services/unitRegistryService');
const { fetchBattlefieldItems } = require('../services/placeableCatalogService');
const { UNIT_TYPE_DTO_VERSION } = require('../services/unitTypeDtoService');
const {
  BATTLEFIELD_FIELD_WIDTH,
  BATTLEFIELD_FIELD_HEIGHT
} = require('../services/battlefieldScale');

const getUnitTypeId = (unit) => {
  const unitTypeId = typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
  if (unitTypeId) return unitTypeId;
  return typeof unit?.id === 'string' ? unit.id.trim() : '';
};

const fetchEnabledUnitTypes = async () => {
  const registry = await fetchUnitTypesWithComponents({ enabledOnly: true });
  return Array.isArray(registry?.unitTypes) ? registry.unitTypes : [];
};

const normalizeRoster = (rawRoster, unitTypes) => {
  const incoming = Array.isArray(rawRoster) ? rawRoster : [];
  const rosterById = incoming.reduce((acc, item) => {
    const unitTypeId = typeof item?.unitTypeId === 'string' ? item.unitTypeId : '';
    if (!unitTypeId || acc[unitTypeId]) return acc;

    acc[unitTypeId] = {
      unitTypeId,
      count: Number.isFinite(item?.count) ? Math.max(0, Math.floor(item.count)) : 0,
      level: Number.isFinite(item?.level) ? Math.max(1, Math.floor(item.level)) : 1,
      nextUnitTypeId: typeof item?.nextUnitTypeId === 'string' && item.nextUnitTypeId.trim()
        ? item.nextUnitTypeId.trim()
        : null,
      upgradeCostKP: Number.isFinite(item?.upgradeCostKP)
        ? Math.max(0, Math.floor(item.upgradeCostKP))
        : null
    };
    return acc;
  }, {});

  return unitTypes.map((unit) => {
    const unitTypeId = getUnitTypeId(unit);
    const existed = rosterById[unitTypeId];
    if (existed) {
      return {
        ...existed,
        unitTypeId
      };
    }

    return {
      unitTypeId,
      count: 0,
      level: Number.isFinite(unit.level) ? Math.max(1, Math.floor(unit.level)) : 1,
      nextUnitTypeId: unit.nextUnitTypeId || null,
      upgradeCostKP: Number.isFinite(unit.upgradeCostKP) ? unit.upgradeCostKP : null
    };
  });
};

const buildUnitTypeMap = (unitTypes) => unitTypes.reduce((acc, unit) => {
  const unitTypeId = getUnitTypeId(unit);
  if (unitTypeId) {
    acc[unitTypeId] = unit;
  }
  return acc;
}, {});

const getUnitKnowledgeCost = (unitType) => (
  Math.max(1, Math.floor(Number(unitType?.costKP) || 1))
);

const MAX_TEMPLATE_NAME_LEN = 32;
const MAX_TEMPLATE_COUNT = 100;
const MAX_TEMPLATE_UNIT_COUNT = 100;
const MAX_TEMPLATE_TOTAL_COUNT = 100;
const TRAINING_MAX_GROUP_TOTAL = 10000;
const MAX_TEMPLATE_FORMATION_COUNT = 12;
const MAX_TEMPLATE_FORMATION_NAME_LEN = 24;
const MAX_TEMPLATE_FORMATION_COORD = 999;
const MAX_COMBAT_ARMY_COUNT = 100;
const MAX_TRAINING_ARMY_COUNT = 200;
const MAX_ARMY_NAME_LEN = 32;
const MAX_ARMY_UNIT_COUNT = 1000000;
const MAX_ARMY_DEPLOY_SLOT_COUNT = 1000;
const MAX_ARMY_COORD = 100000;
const MAX_ARMY_SKILL_SLOT_COUNT = 8;

const buildTemplateId = () => `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const buildFormationId = () => `fmt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const buildArmyId = (scope = 'army') => `${scope}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeTemplateName = (rawName, fallback = '未命名模板') => {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return fallback;
  return name.slice(0, MAX_TEMPLATE_NAME_LEN);
};

const normalizeFormationName = (rawName, fallback = '默认阵型') => {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return fallback;
  return name.slice(0, MAX_TEMPLATE_FORMATION_NAME_LEN);
};

const normalizeArmyName = (rawName, fallback = '未命名部队') => {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  return (name || fallback).slice(0, MAX_ARMY_NAME_LEN);
};

const normalizeTemplateUnitsLoose = (rawUnits) => {
  const source = Array.isArray(rawUnits) ? rawUnits : [];
  const byId = source.reduce((acc, raw) => {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(raw?.count) || 0));
    if (!unitTypeId || count <= 0) return acc;
    acc[unitTypeId] = (acc[unitTypeId] || 0) + count;
    return acc;
  }, {});
  const out = [];
  let total = 0;
  Object.keys(byId).forEach((unitTypeId) => {
    if (total >= MAX_TEMPLATE_TOTAL_COUNT) return;
    const next = Math.min(MAX_TEMPLATE_UNIT_COUNT, Math.max(1, byId[unitTypeId]));
    const count = Math.min(next, MAX_TEMPLATE_TOTAL_COUNT - total);
    if (count <= 0) return;
    out.push({ unitTypeId, count });
    total += count;
  });
  return out;
};

const normalizeTemplateUnitsStrict = (rawUnits, unitTypeMap) => {
  if (!Array.isArray(rawUnits) || rawUnits.length <= 0) {
    return { error: '模板兵种清单不能为空' };
  }

  const byId = {};
  for (const raw of rawUnits) {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const countRaw = Number(raw?.count);
    if (!unitTypeId || !unitTypeMap[unitTypeId]) {
      return { error: '模板中存在无效兵种' };
    }
    if (!Number.isInteger(countRaw) || countRaw <= 0) {
      return { error: '模板兵力必须为正整数' };
    }
    byId[unitTypeId] = Math.min(
      MAX_TEMPLATE_UNIT_COUNT,
      (byId[unitTypeId] || 0) + Math.floor(countRaw)
    );
  }

  const units = Object.keys(byId).map((unitTypeId) => ({
    unitTypeId,
    count: byId[unitTypeId]
  }));
  if (units.length <= 0) {
    return { error: '模板兵种清单不能为空' };
  }
  const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
  if (totalCount !== MAX_TEMPLATE_TOTAL_COUNT) {
    return { error: `部队模板中各兵种占比总和必须为${MAX_TEMPLATE_TOTAL_COUNT}%` };
  }
  return { units };
};

const normalizeTemplatePercentagesLoose = (rawUnits) => {
  const source = normalizeTemplateUnitsLoose(rawUnits);
  if (source.length <= 0) return [];
  const total = source.reduce((sum, entry) => sum + entry.count, 0);
  if (total <= 0) return [];
  const rows = source.map((entry, index) => {
    const exact = (entry.count * MAX_TEMPLATE_TOTAL_COUNT) / total;
    return {
      ...entry,
      count: Math.floor(exact),
      remainder: exact - Math.floor(exact),
      index
    };
  });
  let remaining = MAX_TEMPLATE_TOTAL_COUNT - rows.reduce((sum, entry) => sum + entry.count, 0);
  rows
    .slice()
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach((entry) => {
      if (remaining <= 0) return;
      entry.count += 1;
      remaining -= 1;
    });
  if (remaining > 0) rows[0].count += remaining;
  return rows
    .sort((left, right) => left.index - right.index)
    .map(({ remainder, index, ...entry }) => entry)
    .filter((entry) => entry.count > 0);
};

const getFormationId = (formation) => {
  const formationId = typeof formation?.formationId === 'string' ? formation.formationId.trim() : '';
  if (formationId) return formationId;
  return typeof formation?.id === 'string' ? formation.id.trim() : '';
};

const buildUnitCountMap = (units = []) => (
  normalizeTemplateUnitsLoose(units).reduce((acc, entry) => {
    acc.set(entry.unitTypeId, entry.count);
    return acc;
  }, new Map())
);

const buildDefaultFormationPlacements = (units = []) => {
  const placements = [];
  let cursor = 0;
  normalizeTemplateUnitsLoose(units).forEach((entry) => {
    for (let i = 0; i < entry.count && cursor < MAX_TEMPLATE_TOTAL_COUNT; i += 1) {
      const row = Math.floor(cursor / 10);
      placements.push({
        unitTypeId: entry.unitTypeId,
        x: (cursor % 10) - 4,
        y: row - 4
      });
      cursor += 1;
    }
  });
  return placements;
};

const countFormationPlacements = (placements = []) => (
  (Array.isArray(placements) ? placements : []).reduce((acc, placement) => {
    const unitTypeId = typeof placement?.unitTypeId === 'string' ? placement.unitTypeId.trim() : '';
    if (!unitTypeId) return acc;
    acc.set(unitTypeId, (acc.get(unitTypeId) || 0) + 1);
    return acc;
  }, new Map())
);

const isFormationLegal = (formation, units) => {
  const unitCounts = buildUnitCountMap(units);
  const placements = Array.isArray(formation?.placements) ? formation.placements : [];
  const total = Array.from(unitCounts.values()).reduce((sum, count) => sum + count, 0);
  if (total <= 0 || placements.length !== total) return false;
  const placementCounts = countFormationPlacements(placements);
  return Array.from(unitCounts.entries()).every(([unitTypeId, count]) => (
    (placementCounts.get(unitTypeId) || 0) === count
  ));
};

const normalizeFormationPlacements = (rawPlacements, unitTypeMap, unitCounts, strict = false) => {
  const source = Array.isArray(rawPlacements) ? rawPlacements : [];
  const out = [];
  const occupied = new Set();
  const used = new Map();
  for (const raw of source) {
    if (out.length >= MAX_TEMPLATE_TOTAL_COUNT) break;
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    if (!unitTypeId) continue;
    if (strict && (!unitTypeMap[unitTypeId] || !unitCounts.has(unitTypeId))) {
      return { error: '阵型中存在无效兵种' };
    }
    if (!unitCounts.has(unitTypeId)) continue;
    const x = Math.max(
      -MAX_TEMPLATE_FORMATION_COORD,
      Math.min(MAX_TEMPLATE_FORMATION_COORD, Math.floor(Number(raw?.x) || 0))
    );
    const y = Math.max(
      -MAX_TEMPLATE_FORMATION_COORD,
      Math.min(MAX_TEMPLATE_FORMATION_COORD, Math.floor(Number(raw?.y) || 0))
    );
    const cellKey = `${x}:${y}`;
    if (occupied.has(cellKey)) {
      if (strict) return { error: '阵型中存在重复站位' };
      continue;
    }
    const nextUsed = (used.get(unitTypeId) || 0) + 1;
    if (nextUsed > (unitCounts.get(unitTypeId) || 0)) {
      if (strict) return { error: '阵型兵种数量超过部队基础数' };
      continue;
    }
    occupied.add(cellKey);
    used.set(unitTypeId, nextUsed);
    out.push({ unitTypeId, x, y });
  }
  return { placements: out };
};

const normalizeTemplateFormationsLoose = (rawFormations, units) => {
  const unitCounts = buildUnitCountMap(units);
  const source = Array.isArray(rawFormations) && rawFormations.length > 0
    ? rawFormations
    : [{
      formationId: buildFormationId(),
      name: '默认阵型',
      placements: buildDefaultFormationPlacements(units)
    }];
  const formations = source
    .slice(0, MAX_TEMPLATE_FORMATION_COUNT)
    .map((formation, index) => {
      const normalized = normalizeFormationPlacements(
        formation?.placements || [],
        {},
        unitCounts,
        false
      );
      return {
        formationId: getFormationId(formation) || buildFormationId(),
        name: normalizeFormationName(formation?.name, index <= 0 ? '默认阵型' : `新建阵型${index}`),
        placements: normalized.placements || []
      };
    });
  return formations.length > 0 ? formations : [{
    formationId: buildFormationId(),
    name: '默认阵型',
    placements: buildDefaultFormationPlacements(units)
  }];
};

const normalizeTemplateForStorage = (template) => {
  const raw = template && typeof template.toObject === 'function'
    ? template.toObject()
    : (template || {});
  const units = normalizeTemplatePercentagesLoose(raw.units);
  const unitCounts = buildUnitCountMap(units);
  const formations = (Array.isArray(raw.formations) ? raw.formations : [])
    .slice(0, MAX_TEMPLATE_FORMATION_COUNT)
    .map((formation, index) => {
      const normalized = normalizeFormationPlacements(
        formation?.placements || [],
        {},
        unitCounts,
        false
      );
      return {
        formationId: getFormationId(formation) || buildFormationId(),
        name: normalizeFormationName(formation?.name, index <= 0 ? '默认阵型' : `新建阵型${index}`),
        placements: (normalized.placements || []).map((placement) => ({
          unitTypeId: placement.unitTypeId,
          x: placement.x,
          y: placement.y
        }))
      };
    });

  return {
    templateId: typeof raw.templateId === 'string' ? raw.templateId.trim() : '',
    name: normalizeTemplateName(raw.name, '未命名模板'),
    units,
    formations,
    createdAt: raw.createdAt || new Date(),
    updatedAt: raw.updatedAt || new Date()
  };
};

const persistArmyTemplates = async (userId, templates) => {
  const nextTemplates = (Array.isArray(templates) ? templates : [])
    .map((template) => normalizeTemplateForStorage(template))
    .filter((template) => template.templateId)
    .slice(0, MAX_TEMPLATE_COUNT);

  return User.findByIdAndUpdate(
    userId,
    { $set: { armyTemplates: nextTemplates } },
    { new: true, runValidators: true }
  ).select('armyTemplates');
};

const normalizeTemplateFormationsStrict = (rawFormations, unitTypeMap, units) => {
  const unitCounts = buildUnitCountMap(units);
  const source = Array.isArray(rawFormations) && rawFormations.length > 0
    ? rawFormations
    : [{
      formationId: buildFormationId(),
      name: '默认阵型',
      placements: buildDefaultFormationPlacements(units)
    }];
  const formations = [];
  for (const [index, formation] of source.slice(0, MAX_TEMPLATE_FORMATION_COUNT).entries()) {
    const normalized = normalizeFormationPlacements(
      formation?.placements || [],
      unitTypeMap,
      unitCounts,
      true
    );
    if (normalized.error) return { error: normalized.error };
    formations.push({
      formationId: getFormationId(formation) || buildFormationId(),
      name: normalizeFormationName(formation?.name, index <= 0 ? '默认阵型' : `新建阵型${index}`),
      placements: normalized.placements || []
    });
  }
  if (!formations.some((formation) => isFormationLegal(formation, units))) {
    return { error: '至少需要一个合法阵型' };
  }
  return { formations };
};

const serializeArmyTemplate = (template, unitTypeMap) => {
  const units = normalizeTemplatePercentagesLoose(template?.units).map((entry) => ({
    unitTypeId: entry.unitTypeId,
    unitName: unitTypeMap[entry.unitTypeId]?.name || entry.unitTypeId,
    count: entry.count
  }));
  const formations = normalizeTemplateFormationsLoose(template?.formations, units).map((formation) => ({
    id: formation.formationId,
    formationId: formation.formationId,
    name: formation.name,
    placements: formation.placements,
    totalPlaced: formation.placements.length,
    legal: isFormationLegal(formation, units)
  }));
  const totalCount = units.reduce((sum, item) => sum + item.count, 0);
  const createdAtMs = new Date(template?.createdAt || 0).getTime();
  const updatedAtMs = new Date(template?.updatedAt || 0).getTime();
  return {
    templateId: typeof template?.templateId === 'string' ? template.templateId.trim() : '',
    name: normalizeTemplateName(template?.name, '未命名模板'),
    units,
    formations,
    totalCount,
    createdAt: Number.isFinite(createdAtMs) && createdAtMs > 0 ? new Date(createdAtMs).toISOString() : null,
    updatedAt: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null
  };
};

const serializeArmyTemplates = (rawTemplates, unitTypeMap) => (
  (Array.isArray(rawTemplates) ? rawTemplates : [])
    .map((template) => serializeArmyTemplate(template, unitTypeMap))
    .filter((template) => template.templateId)
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    })
);

const getArmyInstanceId = (army) => {
  const armyId = typeof army?.armyId === 'string' ? army.armyId.trim() : '';
  if (armyId) return armyId;
  return typeof army?.id === 'string' ? army.id.trim() : '';
};

const toPlainObject = (value) => (
  value && typeof value.toObject === 'function' ? value.toObject() : (value || {})
);

const toRawArmyUnitEntries = (rawUnits) => {
  if (Array.isArray(rawUnits)) return rawUnits;
  if (!rawUnits || typeof rawUnits !== 'object') return [];
  return Object.entries(rawUnits).map(([unitTypeId, count]) => ({ unitTypeId, count }));
};

const normalizeArmyUnitsStrict = (rawUnits, unitTypeMap, { maxTotal = MAX_ARMY_UNIT_COUNT } = {}) => {
  const source = toRawArmyUnitEntries(rawUnits);
  if (source.length <= 0) return { error: '部队兵种清单不能为空' };

  const byId = {};
  for (const raw of source) {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const count = Number(raw?.count);
    if (!unitTypeId || !unitTypeMap[unitTypeId]) {
      return { error: '部队中存在无效兵种' };
    }
    if (!Number.isInteger(count) || count <= 0) {
      return { error: '部队兵力必须为正整数' };
    }
    byId[unitTypeId] = (byId[unitTypeId] || 0) + count;
    if (byId[unitTypeId] > MAX_ARMY_UNIT_COUNT) {
      return { error: `单个兵种数量不能超过 ${MAX_ARMY_UNIT_COUNT}` };
    }
  }

  const units = Object.entries(byId).map(([unitTypeId, count]) => ({ unitTypeId, count }));
  const total = units.reduce((sum, entry) => sum + entry.count, 0);
  if (total <= 0) return { error: '部队兵种清单不能为空' };
  if (total > maxTotal) return { error: `单支部队最多 ${maxTotal} 人` };
  return { units, total };
};

const normalizeArmyUnitsLoose = (rawUnits) => {
  const byId = {};
  toRawArmyUnitEntries(rawUnits).forEach((raw) => {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(raw?.count) || 0));
    if (!unitTypeId || count <= 0) return;
    byId[unitTypeId] = Math.min(MAX_ARMY_UNIT_COUNT, (byId[unitTypeId] || 0) + count);
  });
  return Object.entries(byId).map(([unitTypeId, count]) => ({ unitTypeId, count }));
};

const normalizeArmyFormationSnapshots = (rawFormations, unitTypeMap = {}) => {
  const source = Array.isArray(rawFormations) ? rawFormations : [];
  const seen = new Set();
  return source.slice(0, MAX_TEMPLATE_FORMATION_COUNT).map((formation, index) => {
    const formationId = getFormationId(formation) || buildFormationId();
    const occupied = new Set();
    const placements = (Array.isArray(formation?.placements) ? formation.placements : [])
      .slice(0, MAX_TEMPLATE_TOTAL_COUNT)
      .reduce((out, raw) => {
        const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
        if (!unitTypeId || (Object.keys(unitTypeMap).length > 0 && !unitTypeMap[unitTypeId])) return out;
        const x = Math.max(
          -MAX_TEMPLATE_FORMATION_COORD,
          Math.min(MAX_TEMPLATE_FORMATION_COORD, Math.floor(Number(raw?.x) || 0))
        );
        const y = Math.max(
          -MAX_TEMPLATE_FORMATION_COORD,
          Math.min(MAX_TEMPLATE_FORMATION_COORD, Math.floor(Number(raw?.y) || 0))
        );
        const key = `${x}:${y}`;
        if (occupied.has(key)) return out;
        occupied.add(key);
        out.push({ unitTypeId, x, y });
        return out;
      }, []);
    if (seen.has(formationId)) return null;
    seen.add(formationId);
    return {
      formationId,
      name: normalizeFormationName(formation?.name, index <= 0 ? '默认阵型' : `阵型${index + 1}`),
      placements
    };
  }).filter(Boolean);
};

const normalizeArmyFormationRect = (rawRect) => {
  if (!rawRect || typeof rawRect !== 'object') return null;
  const clampPositive = (value) => Math.max(0, Math.min(MAX_ARMY_COORD, Number(value) || 0));
  const formationId = typeof rawRect?.formationId === 'string' ? rawRect.formationId.trim().slice(0, 96) : '';
  return {
    area: clampPositive(rawRect.area),
    width: clampPositive(rawRect.width),
    depth: clampPositive(rawRect.depth),
    spacing: clampPositive(rawRect.spacing),
    facingRad: Math.max(-Math.PI * 2, Math.min(Math.PI * 2, Number(rawRect.facingRad) || 0)),
    slotCount: Math.max(0, Math.min(MAX_ARMY_DEPLOY_SLOT_COUNT, Math.floor(Number(rawRect.slotCount) || 0))),
    formationId,
    formationName: normalizeFormationName(rawRect.formationName, '').slice(0, MAX_TEMPLATE_FORMATION_NAME_LEN)
  };
};

const normalizeArmyDeploySlots = (rawSlots) => (
  (Array.isArray(rawSlots) ? rawSlots : [])
    .slice(0, MAX_ARMY_DEPLOY_SLOT_COUNT)
    .map((slot, index) => ({
      side: Math.max(-MAX_ARMY_COORD, Math.min(MAX_ARMY_COORD, Number(slot?.side) || 0)),
      front: Math.max(-MAX_ARMY_COORD, Math.min(MAX_ARMY_COORD, Number(slot?.front) || 0)),
      row: Math.max(0, Math.min(MAX_ARMY_DEPLOY_SLOT_COUNT, Math.floor(Number(slot?.row) || 0))),
      col: Math.max(0, Math.min(MAX_ARMY_DEPLOY_SLOT_COUNT, Math.floor(Number(slot?.col) || 0))),
      unitTypeId: typeof slot?.unitTypeId === 'string' ? slot.unitTypeId.trim().slice(0, 96) : '',
      templateIndex: Math.max(0, Math.min(MAX_ARMY_DEPLOY_SLOT_COUNT, Math.floor(Number(slot?.templateIndex) || index)))
    }))
);

const normalizeArmySkillSlots = (rawSlots) => {
  const seen = new Set();
  return (Array.isArray(rawSlots) ? rawSlots : [])
    .slice(0, MAX_ARMY_SKILL_SLOT_COUNT)
    .reduce((out, slot, index) => {
      const slotIndex = Math.max(0, Math.min(MAX_ARMY_SKILL_SLOT_COUNT - 1, Math.floor(Number(slot?.slotIndex) || index)));
      if (seen.has(slotIndex)) return out;
      seen.add(slotIndex);
      out.push({
        slotIndex,
        treeCategory: typeof slot?.treeCategory === 'string' ? slot.treeCategory.trim().slice(0, 48) : '',
        skillId: typeof slot?.skillId === 'string' ? slot.skillId.trim().slice(0, 96) : '',
        cooldownRemain: Math.max(0, Math.min(3600, Number(slot?.cooldownRemain) || 0))
      });
      return out;
    }, []);
};

const serializeArmyInstance = (rawArmy, unitTypeMap, { includeTeam = false } = {}) => {
  const army = toPlainObject(rawArmy);
  const units = normalizeArmyUnitsLoose(army.units).map((entry) => ({
    ...entry,
    unitName: unitTypeMap[entry.unitTypeId]?.name || entry.unitTypeId
  }));
  const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
  const armyId = getArmyInstanceId(army);
  const templateFormations = normalizeArmyFormationSnapshots(army.templateFormations, unitTypeMap).map((formation) => ({
    id: formation.formationId,
    ...formation
  }));
  const createdAtMs = new Date(army.createdAt || 0).getTime();
  const updatedAtMs = new Date(army.updatedAt || 0).getTime();
  const result = {
    id: armyId,
    armyId,
    templateId: typeof army.templateId === 'string' ? army.templateId.trim() : '',
    templateName: normalizeArmyName(army.templateName || army.name, '未命名部队'),
    name: normalizeArmyName(army.name, '未命名部队'),
    units,
    totalCount,
    templateFormations,
    activeFormationId: typeof army.activeFormationId === 'string' ? army.activeFormationId.trim() : '',
    formationRect: normalizeArmyFormationRect(army.formationRect),
    deploySlots: normalizeArmyDeploySlots(army.deploySlots),
    skillSlots: normalizeArmySkillSlots(army.skillSlots),
    x: Math.max(-MAX_ARMY_COORD, Math.min(MAX_ARMY_COORD, Number(army.x) || 0)),
    y: Math.max(-MAX_ARMY_COORD, Math.min(MAX_ARMY_COORD, Number(army.y) || 0)),
    placed: army.placed !== false,
    createdAt: Number.isFinite(createdAtMs) && createdAtMs > 0 ? new Date(createdAtMs).toISOString() : null,
    updatedAt: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null
  };
  if (includeTeam) {
    result.team = army.team === 'defender' ? 'defender' : 'attacker';
    result.sortOrder = Math.max(0, Math.floor(Number(army.sortOrder) || 0));
    result.controlMode = army.controlMode === 'AI' || army.controlMode === 'USER'
      ? army.controlMode
      : (result.team === 'defender' ? 'AI' : 'USER');
  }
  return result;
};

const serializeCombatArmies = (rawArmies, unitTypeMap) => (
  (Array.isArray(rawArmies) ? rawArmies : [])
    .map((army) => serializeArmyInstance(army, unitTypeMap))
    .filter((army) => army.armyId && army.totalCount > 0)
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'zh-Hans-CN'))
);

const serializeTrainingArmies = (rawArmies, unitTypeMap) => (
  (Array.isArray(rawArmies) ? rawArmies : [])
    .map((army) => serializeArmyInstance(army, unitTypeMap, { includeTeam: true }))
    .filter((army) => army.armyId && army.totalCount > 0)
    .sort((left, right) => (
      (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0)
      || String(left.armyId).localeCompare(String(right.armyId))
    ))
);

const buildAllocatedCombatUnitMap = (rawArmies) => {
  const allocated = new Map();
  (Array.isArray(rawArmies) ? rawArmies : []).forEach((army) => {
    normalizeArmyUnitsLoose(toPlainObject(army).units).forEach((entry) => {
      allocated.set(entry.unitTypeId, (allocated.get(entry.unitTypeId) || 0) + entry.count);
    });
  });
  return allocated;
};

const buildAvailableRoster = (userDoc, unitTypes) => {
  const ownedRoster = normalizeRoster(userDoc?.armyRoster, unitTypes);
  const allocated = buildAllocatedCombatUnitMap(userDoc?.combatArmies);
  return ownedRoster.map((entry) => ({
    ...entry,
    count: Math.max(0, entry.count - (allocated.get(entry.unitTypeId) || 0))
  }));
};

const allocateTemplateUnits = (templateUnits, totalCount) => {
  const percentages = normalizeTemplatePercentagesLoose(templateUnits);
  const total = Math.max(0, Math.floor(Number(totalCount) || 0));
  if (percentages.length <= 0 || total <= 0) return [];
  const rows = percentages.map((entry, index) => {
    const exact = (entry.count * total) / MAX_TEMPLATE_TOTAL_COUNT;
    return {
      unitTypeId: entry.unitTypeId,
      count: Math.floor(exact),
      remainder: exact - Math.floor(exact),
      index
    };
  });
  let remaining = total - rows.reduce((sum, row) => sum + row.count, 0);
  rows
    .slice()
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach((row) => {
      if (remaining <= 0) return;
      row.count += 1;
      remaining -= 1;
    });
  return rows.filter((row) => row.count > 0).map(({ remainder, index, ...entry }) => entry);
};

const normalizeArmyInstanceId = (rawId, fallback) => {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  return /^[A-Za-z0-9_-]{1,96}$/.test(id) ? id : fallback;
};

const normalizeArmyInstanceForStorage = ({
  rawArmy,
  unitTypeMap,
  maxTotal,
  scope = 'army',
  includeTeam = false,
  existing = null
} = {}) => {
  const raw = toPlainObject(rawArmy);
  const existingArmy = existing ? toPlainObject(existing) : null;
  const unitsResult = normalizeArmyUnitsStrict(raw.units, unitTypeMap, { maxTotal });
  if (unitsResult.error) return unitsResult;

  const formationSource = raw.templateFormations || raw.formations || existingArmy?.templateFormations || [];
  const templateFormations = normalizeArmyFormationSnapshots(formationSource, unitTypeMap);
  const requestedFormationId = typeof raw.activeFormationId === 'string' ? raw.activeFormationId.trim() : '';
  const activeFormationId = templateFormations.some((formation) => formation.formationId === requestedFormationId)
    ? requestedFormationId
    : (templateFormations[0]?.formationId || '');
  const now = new Date();
  const safeTeam = raw.team === 'defender' ? 'defender' : 'attacker';
  const fallbackControlMode = safeTeam === 'defender' ? 'AI' : 'USER';
  const next = {
    armyId: normalizeArmyInstanceId(getArmyInstanceId(raw), getArmyInstanceId(existingArmy) || buildArmyId(scope)),
    sortOrder: Math.max(0, Math.min(MAX_TRAINING_ARMY_COUNT, Math.floor(Number(raw.sortOrder ?? existingArmy?.sortOrder) || 0))),
    templateId: typeof raw.templateId === 'string'
      ? raw.templateId.trim().slice(0, 96)
      : (typeof existingArmy?.templateId === 'string' ? existingArmy.templateId : ''),
    templateName: normalizeArmyName(raw.templateName || existingArmy?.templateName || raw.name, '未命名模板'),
    name: normalizeArmyName(raw.name || existingArmy?.name, '未命名部队'),
    units: unitsResult.units,
    templateFormations,
    activeFormationId,
    formationRect: normalizeArmyFormationRect(raw.formationRect),
    deploySlots: normalizeArmyDeploySlots(raw.deploySlots),
    skillSlots: normalizeArmySkillSlots(raw.skillSlots),
    x: Math.max(-MAX_ARMY_COORD, Math.min(MAX_ARMY_COORD, Number(raw.x) || 0)),
    y: Math.max(-MAX_ARMY_COORD, Math.min(MAX_ARMY_COORD, Number(raw.y) || 0)),
    placed: raw.placed !== false,
    createdAt: existingArmy?.createdAt || now,
    updatedAt: now
  };
  if (includeTeam) {
    next.team = safeTeam;
    next.controlMode = raw.controlMode === 'AI' || raw.controlMode === 'USER'
      ? raw.controlMode
      : (existingArmy?.controlMode === 'AI' || existingArmy?.controlMode === 'USER'
        ? existingArmy.controlMode
        : fallbackControlMode);
  }
  return { army: next, total: unitsResult.total };
};

const persistCombatArmies = async (userId, combatArmies, expectedUpdatedAt = null) => {
  const filter = { _id: userId };
  const expectedMs = new Date(expectedUpdatedAt || 0).getTime();
  if (Number.isFinite(expectedMs) && expectedMs > 0) {
    filter.updatedAt = new Date(expectedMs);
  }
  return User.findOneAndUpdate(
    filter,
    { $set: { combatArmies } },
    { new: true, runValidators: true }
  ).select('armyRoster combatArmies knowledgeBalance updatedAt');
};

const persistTrainingArmies = async (userId, trainingArmies) => (
  User.findByIdAndUpdate(
    userId,
    { $set: { trainingArmies } },
    { new: true, runValidators: true }
  ).select('trainingArmies')
);

const buildMePayload = (userDoc, unitTypes) => ({
  knowledgeBalance: Number.isFinite(userDoc?.knowledgeBalance)
    ? Math.max(0, Math.floor(userDoc.knowledgeBalance))
    : 0,
  roster: buildAvailableRoster(userDoc, unitTypes),
  totalRoster: normalizeRoster(userDoc?.armyRoster, unitTypes),
  combatArmies: serializeCombatArmies(userDoc?.combatArmies, buildUnitTypeMap(unitTypes))
});

const buildBatchRecruitRosterExpression = (recruitEntries) => ({
  $reduce: {
    input: recruitEntries,
    initialValue: { $ifNull: ['$armyRoster', []] },
    in: {
      $let: {
        vars: {
          roster: '$$value',
          recruit: '$$this'
        },
        in: {
          $let: {
            vars: {
              existingIds: {
                $map: {
                  input: '$$roster',
                  as: 'entry',
                  in: '$$entry.unitTypeId'
                }
              }
            },
            in: {
              $cond: [
                { $in: ['$$recruit.unitTypeId', '$$existingIds'] },
                {
                  $map: {
                    input: '$$roster',
                    as: 'entry',
                    in: {
                      $cond: [
                        { $eq: ['$$entry.unitTypeId', '$$recruit.unitTypeId'] },
                        {
                          $mergeObjects: [
                            '$$entry',
                            {
                              count: {
                                $add: [
                                  { $ifNull: ['$$entry.count', 0] },
                                  '$$recruit.qty'
                                ]
                              }
                            }
                          ]
                        },
                        '$$entry'
                      ]
                    }
                  }
                },
                {
                  $concatArrays: [
                    '$$roster',
                    [{
                      unitTypeId: '$$recruit.unitTypeId',
                      count: '$$recruit.qty',
                      level: '$$recruit.level',
                      nextUnitTypeId: '$$recruit.nextUnitTypeId',
                      upgradeCostKP: '$$recruit.upgradeCostKP'
                    }]
                  ]
                }
              ]
            }
          }
        }
      }
    }
  }
});

const normalizeRecruitItems = (rawItems, unitTypeMap) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: '征召清单不能为空' };
  }

  const qtyByUnitTypeId = rawItems.reduce((acc, raw) => {
    const unitTypeId = typeof raw?.unitTypeId === 'string' ? raw.unitTypeId.trim() : '';
    const qty = Number(raw?.qty);

    if (!unitTypeId || !unitTypeMap[unitTypeId]) {
      acc.__error = '存在无效的兵种类型';
      return acc;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      acc.__error = '数量必须为正整数';
      return acc;
    }

    acc[unitTypeId] = (acc[unitTypeId] || 0) + qty;
    return acc;
  }, {});

  if (qtyByUnitTypeId.__error) {
    return { error: qtyByUnitTypeId.__error };
  }

  const items = Object.keys(qtyByUnitTypeId).map((unitTypeId) => ({
    unitTypeId,
    qty: qtyByUnitTypeId[unitTypeId],
    unitType: unitTypeMap[unitTypeId]
  }));

  if (items.length === 0) {
    return { error: '征召清单不能为空' };
  }

  return { items };
};

const buildRecruitEntries = (recruitItems) => recruitItems.map(({ unitTypeId, qty, unitType }) => ({
  unitTypeId,
  qty,
  level: Number.isFinite(unitType?.level) ? Math.max(1, Math.floor(unitType.level)) : 1,
  nextUnitTypeId: unitType?.nextUnitTypeId || null,
  upgradeCostKP: Number.isFinite(unitType?.upgradeCostKP) ? unitType.upgradeCostKP : null
}));

const executeRecruitCheckout = async ({ userId, recruitItems }) => {
  const totalCost = recruitItems.reduce((sum, item) => (
    sum + (getUnitKnowledgeCost(item.unitType) * item.qty)
  ), 0);
  const recruitEntries = buildRecruitEntries(recruitItems);

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      knowledgeBalance: { $gte: totalCost }
    },
    [
      {
        $set: {
          knowledgeBalance: { $subtract: ['$knowledgeBalance', totalCost] },
          armyRoster: buildBatchRecruitRosterExpression(recruitEntries)
        }
      }
    ],
    {
      new: true,
      projection: {
        knowledgeBalance: 1,
        armyRoster: 1,
        combatArmies: 1
      }
    }
  );

  if (!updatedUser) {
    const user = await User.findById(userId).select('knowledgeBalance');
    if (!user) {
      return { error: 'USER_NOT_FOUND' };
    }
    if ((user.knowledgeBalance || 0) < totalCost) {
      return { error: 'INSUFFICIENT_BALANCE' };
    }
    return { error: 'CONFLICT' };
  }

  return {
    updatedUser,
    totalCost
  };
};

const executeCombatArmyCheckout = async ({
  userId,
  combatArmies,
  recruitItems,
  expectedUpdatedAt = null
}) => {
  const totalCost = recruitItems.reduce((sum, item) => (
    sum + (getUnitKnowledgeCost(item.unitType) * item.qty)
  ), 0);
  const recruitEntries = buildRecruitEntries(recruitItems);
  const filter = {
    _id: userId,
    knowledgeBalance: { $gte: totalCost }
  };
  const expectedMs = new Date(expectedUpdatedAt || 0).getTime();
  if (Number.isFinite(expectedMs) && expectedMs > 0) {
    filter.updatedAt = new Date(expectedMs);
  }

  const updatedUser = await User.findOneAndUpdate(
    filter,
    [
      {
        $set: {
          knowledgeBalance: { $subtract: ['$knowledgeBalance', totalCost] },
          armyRoster: buildBatchRecruitRosterExpression(recruitEntries),
          combatArmies,
          updatedAt: new Date()
        }
      }
    ],
    {
      new: true,
      projection: {
        knowledgeBalance: 1,
        armyRoster: 1,
        combatArmies: 1,
        updatedAt: 1
      }
    }
  );

  if (!updatedUser) {
    const user = await User.findById(userId).select('knowledgeBalance');
    if (!user) {
      return { error: 'USER_NOT_FOUND', totalCost };
    }
    if ((user.knowledgeBalance || 0) < totalCost) {
      return { error: 'INSUFFICIENT_BALANCE', totalCost };
    }
    return { error: 'CONFLICT', totalCost };
  }

  return {
    updatedUser,
    totalCost
  };
};

router.get('/unit-types', async (req, res) => {
  try {
    const unitTypes = await fetchEnabledUnitTypes();
    return res.json({
      unitTypeDtoVersion: UNIT_TYPE_DTO_VERSION,
      unitTypes
    });
  } catch (error) {
    console.error('获取兵种列表失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/training/init', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, itemCatalog, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      fetchBattlefieldItems({ enabledOnly: true }),
      User.findById(req.user.userId).select('username trainingArmies')
    ]);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const unlimitedUnits = (Array.isArray(unitTypes) ? unitTypes : [])
      .map((unit) => {
        const unitTypeId = getUnitTypeId(unit);
        if (!unitTypeId) return null;
        return {
          unitTypeId,
          unitName: unit?.name || unitTypeId,
          count: TRAINING_MAX_GROUP_TOTAL
        };
      })
      .filter(Boolean);

    const unlimitedItems = (Array.isArray(itemCatalog) ? itemCatalog : []).map((item) => ({
      ...item,
      initialCount: MAX_TEMPLATE_UNIT_COUNT
    }));
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const trainingArmies = serializeTrainingArmies(user.trainingArmies, unitTypeMap);
    const attackerDeployUnits = trainingArmies.filter((army) => army.team !== 'defender');
    const defenderDeployUnits = trainingArmies.filter((army) => army.team === 'defender');
    const sumArmyCount = (armies) => armies.reduce((sum, army) => sum + (Number(army?.totalCount) || 0), 0);

    return res.json({
      mode: 'training',
      battleId: `training_${Date.now()}`,
      nodeId: '',
      gateKey: 'training',
      gateLabel: '训练场',
      nodeName: '训练场',
      timeLimitSec: 240,
      unitsPerSoldier: 10,
      rules: {
        maxDeployGroupTotal: TRAINING_MAX_GROUP_TOTAL,
        templatePercentageTotal: MAX_TEMPLATE_TOTAL_COUNT
      },
      attacker: {
        username: user.username || '我方',
        totalCount: sumArmyCount(attackerDeployUnits),
        units: unlimitedUnits,
        rosterUnits: unlimitedUnits,
        deployUnits: attackerDeployUnits
      },
      defender: {
        username: '敌方',
        totalCount: sumArmyCount(defenderDeployUnits),
        units: [],
        rosterUnits: unlimitedUnits,
        deployUnits: defenderDeployUnits
      },
      unitTypeDtoVersion: UNIT_TYPE_DTO_VERSION,
      unitTypes: Array.isArray(unitTypes) ? unitTypes : [],
      battlefield: {
        intelVisible: true,
        layoutMeta: {
          fieldWidth: BATTLEFIELD_FIELD_WIDTH,
          fieldHeight: BATTLEFIELD_FIELD_HEIGHT,
          maxItemsPerType: 999999
        },
        itemCatalog: unlimitedItems,
        objects: [],
        defenderDeployments: []
      }
    });
  } catch (error) {
    console.error('获取训练场初始化失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('knowledgeBalance armyRoster combatArmies')
    ]);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    return res.json(buildMePayload(user, unitTypes));
  } catch (error) {
    console.error('获取军团信息失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/combat-armies', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyRoster combatArmies')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    return res.json({
      success: true,
      combatArmies: serializeCombatArmies(user.combatArmies, unitTypeMap),
      roster: buildAvailableRoster(user, unitTypes),
      totalRoster: normalizeRoster(user.armyRoster, unitTypes)
    });
  } catch (error) {
    console.error('获取实际参战部队失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/combat-armies', authenticateToken, async (req, res) => {
  try {
    const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId.trim() : '';
    const totalCount = Number(req.body?.totalCount);
    if (!templateId) {
      return res.status(400).json({ error: '创建实际参战部队需要选择部队模板' });
    }
    if (!Number.isInteger(totalCount) || totalCount <= 0 || totalCount > MAX_ARMY_UNIT_COUNT) {
      return res.status(400).json({ error: `部队总兵数必须为 1 - ${MAX_ARMY_UNIT_COUNT} 的整数` });
    }

    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyRoster armyTemplates combatArmies knowledgeBalance updatedAt')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const templates = Array.isArray(user.armyTemplates) ? user.armyTemplates : [];
    const template = templates.find((item) => (
      typeof item?.templateId === 'string' && item.templateId.trim() === templateId
    ));
    if (!template) {
      return res.status(404).json({ error: '部队模板不存在' });
    }
    const existingArmies = Array.isArray(user.combatArmies)
      ? user.combatArmies.map((army) => toPlainObject(army))
      : [];
    if (existingArmies.length >= MAX_COMBAT_ARMY_COUNT) {
      return res.status(400).json({ error: `实际参战部队数量已达上限（${MAX_COMBAT_ARMY_COUNT}）` });
    }

    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const units = allocateTemplateUnits(template.units, totalCount);
    const normalizedUnits = normalizeArmyUnitsStrict(units, unitTypeMap, { maxTotal: MAX_ARMY_UNIT_COUNT });
    if (normalizedUnits.error) {
      return res.status(400).json({ error: normalizedUnits.error });
    }

    const templateFormations = normalizeArmyFormationSnapshots(template.formations, unitTypeMap);
    const now = new Date();
    const created = {
      armyId: buildArmyId('combat'),
      templateId,
      templateName: normalizeArmyName(template.name, '未命名模板'),
      name: normalizeArmyName(req.body?.name, normalizeArmyName(template.name, '未命名部队')),
      units: normalizedUnits.units,
      templateFormations,
      activeFormationId: templateFormations[0]?.formationId || '',
      formationRect: null,
      deploySlots: [],
      skillSlots: [],
      x: 0,
      y: 0,
      placed: true,
      createdAt: now,
      updatedAt: now
    };
    const recruitItems = normalizedUnits.units.map((entry) => ({
      unitTypeId: entry.unitTypeId,
      qty: entry.count,
      unitType: unitTypeMap[entry.unitTypeId]
    }));
    const checkout = await executeCombatArmyCheckout({
      userId: req.user.userId,
      combatArmies: [...existingArmies, created],
      recruitItems,
      expectedUpdatedAt: user.updatedAt
    });
    if (checkout.error === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (checkout.error === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({
        error: `知识点不足：创建 ${normalizedUnits.total} 名真实士兵需要 ${checkout.totalCost} 点`
      });
    }
    if (checkout.error === 'CONFLICT') {
      return res.status(409).json({ error: '兵力或知识点已更新，请刷新后重试' });
    }

    const savedUser = checkout.updatedUser;

    const combatArmies = serializeCombatArmies(savedUser.combatArmies, unitTypeMap);
    const createdArmy = combatArmies.find((army) => army.armyId === created.armyId) || serializeArmyInstance(created, unitTypeMap);
    return res.json({
      success: true,
      totalCost: checkout.totalCost,
      combatArmy: createdArmy,
      combatArmies,
      ...buildMePayload(savedUser, unitTypes)
    });
  } catch (error) {
    console.error('创建实际参战部队失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/combat-armies/:armyId', authenticateToken, async (req, res) => {
  try {
    const armyId = normalizeArmyInstanceId(req.params?.armyId, '');
    if (!armyId) {
      return res.status(400).json({ error: '部队ID不能为空' });
    }
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyRoster combatArmies knowledgeBalance updatedAt')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const combatArmies = Array.isArray(user.combatArmies) ? user.combatArmies : [];
    const nextArmies = combatArmies.filter((army) => getArmyInstanceId(army) !== armyId);
    if (nextArmies.length === combatArmies.length) {
      return res.status(404).json({ error: '实际参战部队不存在' });
    }
    const savedUser = await persistCombatArmies(req.user.userId, nextArmies, user.updatedAt);
    if (!savedUser) {
      return res.status(409).json({ error: '兵力状态已更新，请刷新后重试' });
    }
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    return res.json({
      success: true,
      combatArmies: serializeCombatArmies(savedUser.combatArmies, unitTypeMap),
      ...buildMePayload(savedUser, unitTypes)
    });
  } catch (error) {
    console.error('解散实际参战部队失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/training/armies', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('trainingArmies')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    return res.json({
      success: true,
      maxGroupTotal: TRAINING_MAX_GROUP_TOTAL,
      armies: serializeTrainingArmies(user.trainingArmies, buildUnitTypeMap(unitTypes))
    });
  } catch (error) {
    console.error('获取训练部队失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.put('/training/armies', authenticateToken, async (req, res) => {
  try {
    const rawArmies = Array.isArray(req.body?.armies)
      ? req.body.armies
      : (Array.isArray(req.body?.groups) ? req.body.groups : null);
    if (!rawArmies) {
      return res.status(400).json({ error: '训练部队清单必须为数组' });
    }
    if (rawArmies.length > MAX_TRAINING_ARMY_COUNT) {
      return res.status(400).json({ error: `训练部队数量不能超过 ${MAX_TRAINING_ARMY_COUNT}` });
    }

    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('trainingArmies')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const existingById = new Map(
      (Array.isArray(user.trainingArmies) ? user.trainingArmies : [])
        .map((army) => [getArmyInstanceId(army), army])
        .filter(([armyId]) => !!armyId)
    );
    const seen = new Set();
    const trainingArmies = [];
    for (const rawArmy of rawArmies) {
      const rawArmyId = normalizeArmyInstanceId(getArmyInstanceId(rawArmy), '');
      const normalized = normalizeArmyInstanceForStorage({
        rawArmy,
        unitTypeMap,
        maxTotal: TRAINING_MAX_GROUP_TOTAL,
        scope: 'training',
        includeTeam: true,
        existing: rawArmyId ? existingById.get(rawArmyId) : null
      });
      if (normalized.error) {
        return res.status(400).json({ error: normalized.error });
      }
      if (seen.has(normalized.army.armyId)) {
        return res.status(400).json({ error: '训练部队ID不能重复' });
      }
      seen.add(normalized.army.armyId);
      trainingArmies.push(normalized.army);
    }

    const savedUser = await persistTrainingArmies(req.user.userId, trainingArmies);
    if (!savedUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    return res.json({
      success: true,
      maxGroupTotal: TRAINING_MAX_GROUP_TOTAL,
      armies: serializeTrainingArmies(savedUser.trainingArmies, unitTypeMap)
    });
  } catch (error) {
    console.error('保存训练部队失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/templates', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    return res.json({
      success: true,
      templates: serializeArmyTemplates(user.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('获取部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/templates', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const existingTemplates = Array.isArray(user.armyTemplates) ? user.armyTemplates : [];
    if (existingTemplates.length >= MAX_TEMPLATE_COUNT) {
      return res.status(400).json({ error: `模板数量已达上限（${MAX_TEMPLATE_COUNT}）` });
    }

    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const normalizedUnits = normalizeTemplateUnitsStrict(req.body?.units, unitTypeMap);
    if (normalizedUnits.error) {
      return res.status(400).json({ error: normalizedUnits.error });
    }
    const normalizedFormations = normalizeTemplateFormationsStrict(
      req.body?.formations,
      unitTypeMap,
      normalizedUnits.units
    );
    if (normalizedFormations.error) {
      return res.status(400).json({ error: normalizedFormations.error });
    }
    const templateName = normalizeTemplateName(req.body?.name, `模板${existingTemplates.length + 1}`);
    const now = new Date();
    const created = {
      templateId: buildTemplateId(),
      name: templateName,
      units: normalizedUnits.units,
      formations: normalizedFormations.formations,
      createdAt: now,
      updatedAt: now
    };

    const savedUser = await persistArmyTemplates(req.user.userId, [...existingTemplates, created]);
    if (!savedUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const savedTemplate = (Array.isArray(savedUser.armyTemplates) ? savedUser.armyTemplates : [])
      .find((template) => typeof template?.templateId === 'string' && template.templateId.trim() === created.templateId)
      || created;

    return res.json({
      success: true,
      template: serializeArmyTemplate(savedTemplate, unitTypeMap),
      templates: serializeArmyTemplates(savedUser.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('创建部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.put('/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const templateId = typeof req.params?.templateId === 'string' ? req.params.templateId.trim() : '';
    if (!templateId) {
      return res.status(400).json({ error: '模板ID不能为空' });
    }
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const templates = Array.isArray(user.armyTemplates) ? user.armyTemplates : [];
    const index = templates.findIndex((item) => (
      typeof item?.templateId === 'string' && item.templateId.trim() === templateId
    ));
    if (index < 0) {
      return res.status(404).json({ error: '模板不存在' });
    }

    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const hasUnitsPayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'units');
    const hasNamePayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
    const hasFormationsPayload = Object.prototype.hasOwnProperty.call(req.body || {}, 'formations');
    if (!hasUnitsPayload && !hasNamePayload && !hasFormationsPayload) {
      return res.status(400).json({ error: '至少提供 name、units 或 formations 字段' });
    }

    const current = templates[index];
    const nextName = hasNamePayload
      ? normalizeTemplateName(req.body?.name, normalizeTemplateName(current?.name, `模板${index + 1}`))
      : normalizeTemplateName(current?.name, `模板${index + 1}`);

    let nextUnits = normalizeTemplateUnitsLoose(current?.units);
    if (hasUnitsPayload) {
      const normalizedUnits = normalizeTemplateUnitsStrict(req.body?.units, unitTypeMap);
      if (normalizedUnits.error) {
        return res.status(400).json({ error: normalizedUnits.error });
      }
      nextUnits = normalizedUnits.units;
    }

    let nextFormations = normalizeTemplateFormationsLoose(current?.formations, nextUnits);
    if (hasFormationsPayload || hasUnitsPayload) {
      const formationsPayload = hasFormationsPayload ? req.body?.formations : undefined;
      const normalizedFormations = normalizeTemplateFormationsStrict(
        formationsPayload,
        unitTypeMap,
        nextUnits
      );
      if (normalizedFormations.error) {
        return res.status(400).json({ error: normalizedFormations.error });
      }
      nextFormations = normalizedFormations.formations;
    }

    const nextTemplate = {
      templateId,
      name: nextName,
      units: nextUnits,
      formations: nextFormations,
      createdAt: current?.createdAt || new Date(),
      updatedAt: new Date()
    };

    const nextTemplates = templates.map((template, templateIndex) => (
      templateIndex === index ? nextTemplate : template
    ));
    const savedUser = await persistArmyTemplates(req.user.userId, nextTemplates);
    if (!savedUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const savedTemplate = (Array.isArray(savedUser.armyTemplates) ? savedUser.armyTemplates : [])
      .find((template) => typeof template?.templateId === 'string' && template.templateId.trim() === templateId)
      || nextTemplate;

    return res.json({
      success: true,
      template: serializeArmyTemplate(savedTemplate, unitTypeMap),
      templates: serializeArmyTemplates(savedUser.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('更新部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const templateId = typeof req.params?.templateId === 'string' ? req.params.templateId.trim() : '';
    if (!templateId) {
      return res.status(400).json({ error: '模板ID不能为空' });
    }
    const [unitTypes, user] = await Promise.all([
      fetchEnabledUnitTypes(),
      User.findById(req.user.userId).select('armyTemplates')
    ]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const templates = Array.isArray(user.armyTemplates) ? user.armyTemplates : [];
    const nextTemplates = templates.filter((item) => (
      !(typeof item?.templateId === 'string' && item.templateId.trim() === templateId)
    ));
    if (nextTemplates.length === templates.length) {
      return res.status(404).json({ error: '模板不存在' });
    }

    const savedUser = await persistArmyTemplates(req.user.userId, nextTemplates);
    if (!savedUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const unitTypeMap = buildUnitTypeMap(unitTypes);
    return res.json({
      success: true,
      templates: serializeArmyTemplates(savedUser.armyTemplates, unitTypeMap)
    });
  } catch (error) {
    console.error('删除部队模板失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/recruit', authenticateToken, async (req, res) => {
  try {
    const unitTypeId = typeof req.body?.unitTypeId === 'string' ? req.body.unitTypeId.trim() : '';
    const qty = Number(req.body?.qty);

    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: '数量必须为正整数' });
    }

    const unitTypes = await fetchEnabledUnitTypes();
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const unitType = unitTypeMap[unitTypeId];

    if (!unitType) {
      return res.status(400).json({ error: '无效的兵种类型' });
    }

    const result = await executeRecruitCheckout({
      userId: req.user.userId,
      recruitItems: [{ unitTypeId, qty, unitType }]
    });

    if (result.error === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (result.error === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: '知识点不足' });
    }
    if (result.error === 'CONFLICT') {
      return res.status(409).json({ error: '征召失败，请稍后重试' });
    }

    return res.json({
      success: true,
      ...buildMePayload(result.updatedUser, unitTypes)
    });
  } catch (error) {
    console.error('征召失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/recruit/checkout', authenticateToken, async (req, res) => {
  try {
    const unitTypes = await fetchEnabledUnitTypes();
    const unitTypeMap = buildUnitTypeMap(unitTypes);
    const normalized = normalizeRecruitItems(req.body?.items, unitTypeMap);

    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }

    const result = await executeRecruitCheckout({
      userId: req.user.userId,
      recruitItems: normalized.items
    });

    if (result.error === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (result.error === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: '知识点不足' });
    }
    if (result.error === 'CONFLICT') {
      return res.status(409).json({ error: '结算失败，请稍后重试' });
    }

    return res.json({
      success: true,
      totalCost: result.totalCost,
      ...buildMePayload(result.updatedUser, unitTypes)
    });
  } catch (error) {
    console.error('结算征召失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
