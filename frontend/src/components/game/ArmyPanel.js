import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ArmyPanel.css';
import { API_BASE } from '../../runtimeConfig';
import normalizeUnitTypes from '../../game/unit/normalizeUnitTypes';
import { formatAttackRange, normalizeAttackRange } from '../../game/unit/attackRange';
import {
  ArmyUnitCloseupCanvasPreview,
  ArmyUnitBattleCanvasPreview
} from './unit/ArmyUnitPreviewCanvases';
import { formatUnitClassLabel, resolveUnitClassMeta } from './unit/unitClassMeta';
import SkillTreePanel from './skillTree/SkillTreePanel';
import BattleTemplateFillModal from '../../game/battle/presentation/ui/BattleTemplateFillModal';
import {
  allocateTemplateUnits,
  normalizeTemplatePercentages
} from '../../game/battle/screens/battleSceneUtils';
import {
  MAX_NAME_DISPLAY_WIDTH,
  limitNameByDisplayWidth
} from '../../game/battle/shared/nameLimits';
import {
  buildDefaultFormationLayout,
  DEFAULT_FORMATION_NAME
} from '../../game/formation/defaultFormation';
import {
  ArmyBattlefieldItemCloseupPreview,
  ArmyBattlefieldItemBattlePreview
} from './item/ArmyBattlefieldItemPreviewCanvases';

const parseApiResponse = async (response) => {
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    data = null;
  }
  return { response, data, rawText };
};

const getApiErrorMessage = (parsed, fallback) => {
  if (parsed?.data?.error) return parsed.data.error;
  if (parsed?.data?.message) return parsed.data.message;
  return fallback;
};

const ARMY_EDITOR_STEPS = ['units', 'preview'];
const ARMY_MAX_UNIT_BASIS = 100;
const MAX_COMBAT_ARMY_UNIT_COUNT = 1000000;

const getUnitId = (unit) => {
  const id = typeof unit?.id === 'string' ? unit.id.trim() : '';
  if (id) return id;
  return typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
};

const normalizeTemplateUnits = (units = []) => (
  (Array.isArray(units) ? units : [])
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0)
);

const getTemplateId = (template) => (typeof template?.templateId === 'string' ? template.templateId.trim() : '');
const getCombatArmyId = (army) => {
  const armyId = typeof army?.armyId === 'string' ? army.armyId.trim() : '';
  if (armyId) return armyId;
  return typeof army?.id === 'string' ? army.id.trim() : '';
};
const getTroopDisplayName = (template) => {
  const name = typeof template?.name === 'string' ? template.name.trim() : '';
  return limitNameByDisplayWidth(name) || '未命名部队';
};

const buildUnitIntro = (unit = {}) => {
  const explicit = typeof unit?.description === 'string' ? unit.description.trim() : '';
  if (explicit) return explicit;
  const classMeta = resolveUnitClassMeta(unit);
  const categoryLabel = classMeta.categoryLabel || '近战';
  const classLabel = classMeta.label || `${categoryLabel}-${classMeta.subtypeLabel || '通用型'}`;
  const professionId = typeof unit?.professionId === 'string' ? unit.professionId : '';
  const speed = Number(unit?.speed) || 0;
  const attackRange = formatAttackRange(unit);
  if (categoryLabel === '辅助') {
    return `该兵种定位为${classLabel}（${professionId}），用于为部队提供战术增益或干预效果。当前攻击范围 ${attackRange}，机动 ${speed}。`;
  }
  return `该兵种定位为${classLabel}（${professionId}），当前攻击范围 ${attackRange}，机动 ${speed}。`;
};

const unitsToSummaryText = (units = [], unitNameById = new Map()) => (
  normalizeTemplateUnits(units)
    .map((entry) => `${unitNameById.get(entry.unitTypeId) || entry.unitTypeId} ${entry.count}%`)
    .join(' / ')
);

const combatUnitsToSummaryText = (units = [], unitNameById = new Map()) => (
  (Array.isArray(units) ? units : [])
    .map((entry) => {
      const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      if (!unitTypeId || count <= 0) return '';
      return `${unitNameById.get(unitTypeId) || entry.unitName || unitTypeId} ${count}`;
    })
    .filter(Boolean)
    .join(' / ')
);

const getUnitKnowledgeCost = (unit = {}) => (
  Math.max(1, Math.floor(Number(unit?.costKP) || 1))
);

const formatUnitKnowledgeCost = (unit = {}) => `${getUnitKnowledgeCost(unit)} 知识点/人`;

const buildTemplatePurchaseQuote = (template = {}, totalCount = 0, unitTypeMap = {}) => {
  const total = Math.max(0, Math.floor(Number(totalCount) || 0));
  const units = allocateTemplateUnits(template?.units || [], total);
  const breakdown = units.map((entry) => {
    const unit = unitTypeMap?.[entry.unitTypeId] || {};
    const unitCost = getUnitKnowledgeCost(unit);
    return {
      ...entry,
      unitCost,
      subtotal: entry.count * unitCost
    };
  });
  return {
    totalCount: total,
    units,
    breakdown,
    totalCost: breakdown.reduce((sum, entry) => sum + entry.subtotal, 0)
  };
};

const getTemplateCapacityByKnowledgeBalance = (template = {}, unitTypeMap = {}, knowledgeBalance = 0) => {
  const balance = Math.max(0, Math.floor(Number(knowledgeBalance) || 0));
  const percentages = normalizeTemplatePercentages(template?.units || []);
  if (balance <= 0 || percentages.length <= 0) return 0;

  const minUnitCost = percentages.reduce((minimum, entry) => (
    Math.min(minimum, getUnitKnowledgeCost(unitTypeMap?.[entry.unitTypeId]))
  ), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(minUnitCost) || minUnitCost <= 0) return 0;

  let low = 0;
  let high = Math.min(MAX_COMBAT_ARMY_UNIT_COUNT, Math.floor(balance / minUnitCost));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (buildTemplatePurchaseQuote(template, mid, unitTypeMap).totalCost <= balance) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
};

const createDefaultCombatArmyCreatePanel = () => ({
  open: false,
  mode: 'create',
  team: 'attacker',
  knowledgeCostEnabled: true,
  template: null,
  name: '',
  rows: [],
  totalRequested: 0,
  totalFilled: 0,
  maxTotal: 0,
  stats: null
});

const buildCombatArmyComposerStats = (units = [], unitTypeMap = {}) => {
  let totalCount = 0;
  let totalHp = 0;
  let totalAtk = 0;
  let totalDef = 0;
  let totalRangeMin = 0;
  let totalRangeMax = 0;
  let speedReciprocalSum = 0;
  (Array.isArray(units) ? units : []).forEach((entry) => {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
    const unit = unitTypeMap?.[unitTypeId] || {};
    if (!unitTypeId || count <= 0) return;
    const hp = Math.max(0, Number(unit?.hp) || 0);
    const atk = Math.max(0, Number(unit?.atk) || 0);
    const def = Math.max(0, Number(unit?.def) || 0);
    const speed = Math.max(0.2, Number(unit?.speed) || 1);
    const attackRange = normalizeAttackRange(unit);
    totalCount += count;
    totalHp += hp * count;
    totalAtk += atk * count;
    totalDef += def * count;
    totalRangeMin += attackRange.min * count;
    totalRangeMax += attackRange.max * count;
    speedReciprocalSum += count / speed;
  });
  return {
    totalCount,
    totalHp,
    totalAtk,
    totalDef,
    cohesiveSpeed: totalCount > 0 && speedReciprocalSum > 0 ? totalCount / speedReciprocalSum : 0,
    attackRange: {
      min: totalCount > 0 ? totalRangeMin / totalCount : 0,
      max: totalCount > 0 ? totalRangeMax / totalCount : 0
    },
    range: totalCount > 0 ? totalRangeMax / totalCount : 0
  };
};

const buildCombatArmyCreateSnapshot = (template = {}, totalCount = 0, unitTypeMap = {}, knowledgeBalance = 0) => {
  const percentages = normalizeTemplatePercentages(template?.units || []);
  const maxTotal = getTemplateCapacityByKnowledgeBalance(template, unitTypeMap, knowledgeBalance);
  const requestedTotal = Math.max(0, Math.min(maxTotal, Math.floor(Number(totalCount) || 0)));
  const allocatedUnits = allocateTemplateUnits(template?.units || [], requestedTotal);
  const maximumUnits = allocateTemplateUnits(template?.units || [], maxTotal);
  const quote = buildTemplatePurchaseQuote(template, requestedTotal, unitTypeMap);
  const allocatedByUnitTypeId = new Map(allocatedUnits.map((entry) => [entry.unitTypeId, entry.count]));
  const maximumByUnitTypeId = new Map(maximumUnits.map((entry) => [entry.unitTypeId, entry.count]));
  const costByUnitTypeId = new Map(quote.breakdown.map((entry) => [entry.unitTypeId, entry]));
  const rows = percentages.map((entry) => {
    const requested = Math.max(0, Math.floor(Number(allocatedByUnitTypeId.get(entry.unitTypeId)) || 0));
    const available = Math.max(0, Math.floor(Number(maximumByUnitTypeId.get(entry.unitTypeId)) || 0));
    const cost = costByUnitTypeId.get(entry.unitTypeId) || {};
    return {
      unitTypeId: entry.unitTypeId,
      unitName: unitTypeMap?.[entry.unitTypeId]?.name || entry.unitName || entry.unitTypeId,
      percent: entry.count,
      requested,
      available,
      filled: requested,
      unitCost: Math.max(0, Math.floor(Number(cost.unitCost) || 0)),
      totalCost: Math.max(0, Math.floor(Number(cost.subtotal) || 0))
    };
  });
  return {
    rows,
    totalRequested: rows.reduce((sum, row) => sum + row.requested, 0),
    totalFilled: rows.reduce((sum, row) => sum + row.filled, 0),
    maxTotal,
    stats: buildCombatArmyComposerStats(allocatedUnits, unitTypeMap),
    totalCost: quote.totalCost
  };
};

const clampUnitBasisValue = (value) => (
  Math.max(1, Math.min(ARMY_MAX_UNIT_BASIS, Math.floor(Number(value) || 1)))
);

const normalizeUnitBasisEntryRows = (entries = []) => {
  const byId = [];
  const seen = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const unitTypeId = typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '';
    if (!unitTypeId || seen.has(unitTypeId)) return;
    seen.add(unitTypeId);
    byId.push({
      unitTypeId,
      basis: clampUnitBasisValue(Number(entry?.basis) || Number(entry?.count) || 1)
    });
  });
  return byId;
};

const normalizeUnitBasisEntries = (entries = []) => {
  const normalized = normalizeUnitBasisEntryRows(entries).slice(0, ARMY_MAX_UNIT_BASIS);
  if (normalized.length <= 0) return [];
  let total = normalized.reduce((sum, entry) => sum + entry.basis, 0);
  if (total < ARMY_MAX_UNIT_BASIS) {
    normalized[0] = {
      ...normalized[0],
      basis: normalized[0].basis + (ARMY_MAX_UNIT_BASIS - total)
    };
    return normalized;
  }
  let overflow = total - ARMY_MAX_UNIT_BASIS;
  for (let index = 0; index < normalized.length && overflow > 0; index += 1) {
    const reduction = Math.min(Math.max(0, normalized[index].basis - 1), overflow);
    normalized[index] = {
      ...normalized[index],
      basis: normalized[index].basis - reduction
    };
    overflow -= reduction;
  }
  total = normalized.reduce((sum, entry) => sum + entry.basis, 0);
  if (total < ARMY_MAX_UNIT_BASIS) {
    normalized[0] = {
      ...normalized[0],
      basis: normalized[0].basis + (ARMY_MAX_UNIT_BASIS - total)
    };
  }
  return normalized;
};

const rebalanceUnitBasisOnChange = (entries = [], unitTypeId = '', nextBasisRaw = 1) => {
  const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
  const source = normalizeUnitBasisEntryRows(entries);
  const activeIndex = source.findIndex((entry) => entry.unitTypeId === safeId);
  if (!safeId || activeIndex < 0) return normalizeUnitBasisEntries(source);
  const otherCount = Math.max(0, source.length - 1);
  const maxActiveBasis = otherCount > 0
    ? Math.max(1, ARMY_MAX_UNIT_BASIS - otherCount)
    : ARMY_MAX_UNIT_BASIS;
  const requested = Math.min(clampUnitBasisValue(nextBasisRaw), maxActiveBasis);
  if (otherCount <= 0) {
    return [{ ...source[activeIndex], basis: ARMY_MAX_UNIT_BASIS }];
  }

  const otherRows = source.filter((entry, index) => index !== activeIndex);
  const remaining = ARMY_MAX_UNIT_BASIS - requested;
  const minimumRemaining = otherRows.length;
  const extra = Math.max(0, remaining - minimumRemaining);
  const weightTotal = otherRows.reduce((sum, entry) => sum + Math.max(1, entry.basis), 0);
  const distributed = otherRows.map((entry, index) => {
    const exact = (extra * Math.max(1, entry.basis)) / weightTotal;
    return {
      ...entry,
      basis: 1 + Math.floor(exact),
      remainder: exact - Math.floor(exact),
      index
    };
  });
  let remainingExtra = extra - distributed.reduce((sum, entry) => sum + (entry.basis - 1), 0);
  distributed
    .slice()
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach((entry) => {
      if (remainingExtra <= 0) return;
      entry.basis += 1;
      remainingExtra -= 1;
    });
  const nextById = new Map([
    [safeId, { ...source[activeIndex], basis: requested }],
    ...distributed.map(({ remainder, index, ...entry }) => [entry.unitTypeId, entry])
  ]);
  return source.map((entry) => nextById.get(entry.unitTypeId) || entry);
};

const getUnitBasisTotal = (entries = []) => (
  normalizeUnitBasisEntries(entries).reduce((sum, entry) => sum + entry.basis, 0)
);

const buildPercentTenthsByUnitId = (entries = []) => {
  const normalized = normalizeUnitBasisEntries(entries);
  const total = normalized.reduce((sum, entry) => sum + entry.basis, 0);
  if (total <= 0) return new Map();
  const rawRows = normalized.map((entry) => {
    const raw = (entry.basis * 1000) / total;
    const floor = Math.floor(raw);
    return { unitTypeId: entry.unitTypeId, floor, rest: raw - floor };
  });
  let remaining = 1000 - rawRows.reduce((sum, row) => sum + row.floor, 0);
  rawRows
    .slice()
    .sort((a, b) => b.rest - a.rest || a.unitTypeId.localeCompare(b.unitTypeId))
    .forEach((row) => {
      if (remaining <= 0) return;
      row.floor += 1;
      remaining -= 1;
    });
  return new Map(rawRows.map((row) => [row.unitTypeId, row.floor]));
};

const formatPercentTenths = (tenths = 0) => `${(Math.max(0, Math.floor(Number(tenths) || 0)) / 10).toFixed(1)}%`;

const basisEntriesToUnits = (entries = []) => (
  normalizeUnitBasisEntries(entries).map((entry) => ({
    unitTypeId: entry.unitTypeId,
    count: entry.basis
  }))
);

const getNextTemplateDraftName = (templates = []) => {
  const usedNumbers = new Set(
    (Array.isArray(templates) ? templates : [])
      .map((template) => {
        const match = String(template?.name || '').trim().match(/^创建部队模板(\d+)$/);
        return match ? Math.max(0, Math.floor(Number(match[1]) || 0)) : 0;
      })
      .filter((value) => value > 0)
  );
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  return `创建部队模板${nextNumber}`;
};

const createTemplateEditorDraft = (name = '') => ({
  name,
  unitBasis: []
});

const buildUnitBasisRows = (entries = [], unitTypeMap = {}, unitClassMetaById = {}) => {
  const normalized = normalizeUnitBasisEntries(entries).filter((entry) => unitTypeMap[entry.unitTypeId]);
  const percentMap = buildPercentTenthsByUnitId(normalized);
  return normalized.map((entry) => {
    const unit = unitTypeMap[entry.unitTypeId] || {};
    return {
      ...entry,
      unit,
      unitName: unit.name || entry.unitTypeId,
      classMeta: unitClassMetaById[entry.unitTypeId] || resolveUnitClassMeta(unit),
      percentTenths: percentMap.get(entry.unitTypeId) || 0
    };
  });
};

const DefaultFormationPreview = ({ layout = null, unitTypeMap = {}, unitClassMetaById = {} }) => {
  const slots = Array.isArray(layout?.deploySlots) ? layout.deploySlots : [];
  const columns = Math.max(1, Math.floor(Number(layout?.formationRect?.columns) || 1));
  const rows = Math.max(1, Math.floor(Number(layout?.formationRect?.rows) || 1));
  return (
    <div className="army-formation-mini-preview is-static army-default-formation-preview" aria-label={DEFAULT_FORMATION_NAME}>
      <div className="army-formation-mini-board">
        {slots.length <= 0 ? (
          <span className="army-formation-mini-empty" />
        ) : slots.map((slot) => {
          const unit = unitTypeMap[slot.unitTypeId] || {};
          const classMeta = unitClassMetaById[slot.unitTypeId] || resolveUnitClassMeta(unit);
          return (
            <span
              key={`default-slot-${slot.templateIndex}`}
              className="army-formation-mini-tile"
              style={{
                background: classMeta.color,
                left: `${(Math.max(0, Number(slot.col) || 0) / columns) * 100}%`,
                top: `${(Math.max(0, Number(slot.row) || 0) / rows) * 100}%`,
                width: `${100 / columns}%`,
                height: `${100 / rows}%`
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

const buildTroopCompositionRows = (units = [], unitTypeMap = {}, unitClassMetaById = {}) => (
  normalizeTemplatePercentages(units)
    .map((entry) => {
      const unit = unitTypeMap[entry.unitTypeId] || {};
      return {
        ...entry,
        unit,
        unitName: unit.name || entry.unitName || entry.unitTypeId,
        classMeta: unitClassMetaById[entry.unitTypeId] || resolveUnitClassMeta(unit)
      };
    })
);

const buildTroopAggregateStats = (units = [], unitTypeMap = {}, unitClassMetaById = {}) => {
  const rows = buildTroopCompositionRows(units, unitTypeMap, unitClassMetaById);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const weighted = (key) => {
    if (total <= 0) return 0;
    const value = rows.reduce((sum, row) => sum + ((Number(row.unit?.[key]) || 0) * row.count), 0) / total;
    return Math.round(value * 10) / 10;
  };
  const weightedAttackRange = (key) => {
    if (total <= 0) return 0;
    const value = rows.reduce((sum, row) => (
      sum + (normalizeAttackRange(row.unit)[key] * row.count)
    ), 0) / total;
    return Math.round(value * 10) / 10;
  };
  return {
    total,
    speed: weighted('speed'),
    hp: weighted('hp'),
    atk: weighted('atk'),
    def: weighted('def'),
    attackRange: {
      min: weightedAttackRange('min'),
      max: weightedAttackRange('max')
    },
    range: weighted('range')
  };
};

const normalizeBattlefieldItemCatalog = (items = []) => {
  const source = Array.isArray(items) ? items : [];
  const out = [];
  const seen = new Set();
  source.forEach((item) => {
    const itemId = typeof item?.itemId === 'string' && item.itemId.trim()
      ? item.itemId.trim()
      : (typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : '');
    if (!itemId || seen.has(itemId)) return;
    seen.add(itemId);
    out.push({
      itemId,
      name: (typeof item?.name === 'string' && item.name.trim()) ? item.name.trim() : itemId,
      description: (typeof item?.description === 'string' && item.description.trim())
        ? item.description.trim()
        : '',
      width: Math.max(12, Number(item?.width) || 84),
      depth: Math.max(12, Number(item?.depth) || 24),
      height: Math.max(10, Number(item?.height) || 32),
      hp: Math.max(1, Math.floor(Number(item?.hp) || 1)),
      defense: Math.max(0.1, Number(item?.defense) || 1),
      style: item?.style && typeof item.style === 'object' ? item.style : {},
      collider: item?.collider && typeof item.collider === 'object' ? item.collider : null,
      renderProfile: item?.renderProfile && typeof item.renderProfile === 'object' ? item.renderProfile : null,
      interactions: Array.isArray(item?.interactions) ? item.interactions : [],
      sockets: Array.isArray(item?.sockets) ? item.sockets : [],
      maxStack: Number.isFinite(Number(item?.maxStack)) ? Math.max(1, Math.floor(Number(item.maxStack))) : null,
      requiresSupport: item?.requiresSupport === true,
      snapPriority: Number.isFinite(Number(item?.snapPriority)) ? Number(item.snapPriority) : 0
    });
  });
  return out;
};

const buildBattlefieldItemIntro = (item = {}) => {
  const explicit = typeof item?.description === 'string' ? item.description.trim() : '';
  if (explicit) return explicit;
  const shape = typeof item?.style?.shape === 'string' ? item.style.shape.trim().toLowerCase() : '';
  const shapeLabel = shape === 'stakes' ? '拒马木刺' : '防御墙体';
  return `${item?.name || item?.itemId || '该设置物'}用于战场布置，属于${shapeLabel}，可用于阻挡推进与吸收伤害。`;
};

const formatStyleValue = (value) => {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
};

const formatBattlefieldItemStyleSummary = (style = {}) => {
  const entries = Object.entries(style || {})
    .map(([key, value]) => [key, formatStyleValue(value)])
    .filter(([, value]) => value !== '');
  if (entries.length <= 0) return '默认样式';
  return entries.slice(0, 8).map(([key, value]) => `${key}: ${value}`).join(' ｜ ');
};

const getBattlefieldItemStyleEntries = (style = {}) => (
  Object.entries(style || {})
    .map(([key, value]) => ({ key, value: formatStyleValue(value) }))
    .filter((entry) => entry.value !== '')
);

const ArmyPanel = ({
  initialLibraryTab = 'units',
  mode = 'barracks',
  templateToEdit = null,
  onTemplateSaved = null,
  onClose = null
}) => {
  const isLibraryMode = mode === 'library';
  const isTemplateEditorMode = mode === 'templateEditor';
  const safeInitialLibraryTab = initialLibraryTab === 'equipment' ? 'equipment' : 'units';
  const [activeBarracksTab, setActiveBarracksTab] = useState('troops');
  const [libraryTab, setLibraryTab] = useState(safeInitialLibraryTab);
  const [unitTypes, setUnitTypes] = useState([]);
  const [knowledgeBalance, setKnowledgeBalance] = useState(0);
  const [roster, setRoster] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [combatArmies, setCombatArmies] = useState([]);
  const [battlefieldItems, setBattlefieldItems] = useState([]);
  const [battlefieldItemsError, setBattlefieldItemsError] = useState('');
  const [styleModalItemId, setStyleModalItemId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [templateActionId, setTemplateActionId] = useState('');
  const [hoveredTemplateId, setHoveredTemplateId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedCombatArmyId, setSelectedCombatArmyId] = useState('');
  const [combatArmyActionId, setCombatArmyActionId] = useState('');
  const [combatArmyCreatePanel, setCombatArmyCreatePanel] = useState(createDefaultCombatArmyCreatePanel);
  const [detailUnitId, setDetailUnitId] = useState('');
  const [detailRotation, setDetailRotation] = useState({ closeup: 0, battle: 0 });
  const [detailDragTarget, setDetailDragTarget] = useState('');
  const detailRotationDragRef = useRef(null);
  const [detailItemId, setDetailItemId] = useState('');
  const [detailItemRotation, setDetailItemRotation] = useState({ closeup: 0, battle: 0 });
  const [detailItemDragTarget, setDetailItemDragTarget] = useState('');
  const detailItemRotationDragRef = useRef(null);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateEditingId, setTemplateEditingId] = useState('');
  const [templateEditorStep, setTemplateEditorStep] = useState('units');
  const [templateEditorDraft, setTemplateEditorDraft] = useState(() => createTemplateEditorDraft());
  const [templateEditorHoverUnitId, setTemplateEditorHoverUnitId] = useState('');
  const [templateEditorHoverPoint, setTemplateEditorHoverPoint] = useState(null);
  const [armyToasts, setArmyToasts] = useState([]);
  const templateEditorAutoOpenedRef = useRef(false);
  const combatArmyCreateInFlightRef = useRef(false);

  const token = localStorage.getItem('token');

  useEffect(() => {
    setLibraryTab(initialLibraryTab === 'equipment' ? 'equipment' : 'units');
  }, [initialLibraryTab]);

  const unitTypeMap = useMemo(() => {
    return unitTypes.reduce((acc, unit) => {
      const unitId = getUnitId(unit);
      if (unitId) {
        acc[unitId] = unit;
      }
      return acc;
    }, {});
  }, [unitTypes]);

  const unitClassMetaById = useMemo(() => (
    unitTypes.reduce((acc, unit) => {
      const unitId = getUnitId(unit);
      if (unitId) acc[unitId] = resolveUnitClassMeta(unit);
      return acc;
    }, {})
  ), [unitTypes]);

  const unitNameByTypeId = useMemo(() => (
    new Map(
      unitTypes
        .map((unit) => {
          const unitId = getUnitId(unit);
          if (!unitId) return null;
          return [unitId, unit?.name || unitId];
        })
        .filter(Boolean)
    )
  ), [unitTypes]);

  const rosterByUnitId = useMemo(() => roster.reduce((acc, item) => {
    const key = typeof item?.unitTypeId === 'string' ? item.unitTypeId : '';
    if (!key) return acc;
    acc[key] = item;
    return acc;
  }, {}), [roster]);

  const unitsWithCount = useMemo(() => unitTypes.map((unit) => {
    const unitId = getUnitId(unit);
    return {
      ...unit,
      id: unitId,
      count: Number.isFinite(rosterByUnitId[unitId]?.count) ? rosterByUnitId[unitId].count : 0
    };
  }), [unitTypes, rosterByUnitId]);

  const detailUnit = useMemo(
    () => unitsWithCount.find((unit) => unit.id === detailUnitId) || null,
    [unitsWithCount, detailUnitId]
  );
  const detailItem = useMemo(
    () => battlefieldItems.find((item) => item.itemId === detailItemId) || null,
    [battlefieldItems, detailItemId]
  );
  const styleModalItem = useMemo(
    () => battlefieldItems.find((item) => item.itemId === styleModalItemId) || null,
    [battlefieldItems, styleModalItemId]
  );
  const styleModalEntries = useMemo(
    () => getBattlefieldItemStyleEntries(styleModalItem?.style || {}),
    [styleModalItem]
  );

  const activeTemplate = useMemo(() => {
    const preferredId = hoveredTemplateId || selectedTemplateId || getTemplateId(templates[0]);
    return templates.find((template) => getTemplateId(template) === preferredId) || templates[0] || null;
  }, [hoveredTemplateId, selectedTemplateId, templates]);

  const selectedCombatArmy = useMemo(() => {
    const preferredId = selectedCombatArmyId || getCombatArmyId(combatArmies[0]);
    return combatArmies.find((army) => getCombatArmyId(army) === preferredId) || combatArmies[0] || null;
  }, [combatArmies, selectedCombatArmyId]);

  const availableRosterTotal = useMemo(
    () => roster.reduce((sum, entry) => sum + Math.max(0, Math.floor(Number(entry?.count) || 0)), 0),
    [roster]
  );

  const templateEditorAvailableRows = useMemo(() => (
    unitsWithCount
      .map((unit) => ({
        unitTypeId: unit.id,
        unitName: unit.name || unit.id,
        unit,
        classMeta: unitClassMetaById[unit.id] || resolveUnitClassMeta(unit)
      }))
      .sort((a, b) => a.unitName.localeCompare(b.unitName, 'zh-Hans-CN'))
  ), [unitClassMetaById, unitsWithCount]);

  const templateEditorBasisRows = useMemo(
    () => buildUnitBasisRows(templateEditorDraft.unitBasis, unitTypeMap, unitClassMetaById),
    [templateEditorDraft.unitBasis, unitClassMetaById, unitTypeMap]
  );

  const templateEditorUnits = useMemo(
    () => basisEntriesToUnits(templateEditorDraft.unitBasis),
    [templateEditorDraft.unitBasis]
  );

  const templateEditorTotal = useMemo(
    () => getUnitBasisTotal(templateEditorDraft.unitBasis),
    [templateEditorDraft.unitBasis]
  );

  const templateEditorSummary = useMemo(
    () => unitsToSummaryText(templateEditorUnits, unitNameByTypeId),
    [templateEditorUnits, unitNameByTypeId]
  );

  const templateEditorDefaultFormation = useMemo(() => buildDefaultFormationLayout({
    units: templateEditorUnits,
    unitTypes,
    slotCount: templateEditorTotal,
    spacing: 1
  }), [templateEditorTotal, templateEditorUnits, unitTypes]);

  const templateEditorPreviewStats = useMemo(
    () => buildTroopAggregateStats(templateEditorUnits, unitTypeMap, unitClassMetaById),
    [templateEditorUnits, unitClassMetaById, unitTypeMap]
  );

  const templateEditorDetailUnit = useMemo(() => {
    const unitId = templateEditorHoverUnitId || '';
    return unitTypeMap[unitId] || null;
  }, [templateEditorHoverUnitId, unitTypeMap]);

  const templateEditorDetailClassMeta = useMemo(
    () => (templateEditorDetailUnit
      ? unitClassMetaById[templateEditorHoverUnitId] || resolveUnitClassMeta(templateEditorDetailUnit)
      : null),
    [templateEditorDetailUnit, templateEditorHoverUnitId, unitClassMetaById]
  );

  const updateTemplateEditorUnitHover = useCallback((unitTypeId, event = null) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId || !unitTypeMap[safeId]) return;
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    const fallbackX = rect ? rect.right : 320;
    const fallbackY = rect ? rect.top : 180;
    const rawX = Number.isFinite(clientX) ? clientX : fallbackX;
    const rawY = Number.isFinite(clientY) ? clientY : fallbackY;
    const width = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const height = typeof window !== 'undefined' ? window.innerHeight : 720;
    setTemplateEditorHoverUnitId(safeId);
    setTemplateEditorHoverPoint({
      x: Math.max(12, Math.min(width - 340, rawX + 16)),
      y: Math.max(12, Math.min(height - 430, rawY + 16))
    });
  }, [unitTypeMap]);

  const clearTemplateEditorUnitHover = useCallback(() => {
    setTemplateEditorHoverUnitId('');
    setTemplateEditorHoverPoint(null);
  }, []);

  const pushArmyToast = useCallback((message, type = 'info') => {
    const safeMessage = typeof message === 'string' ? message.trim() : '';
    if (!safeMessage) return;
    const id = `army_toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setArmyToasts((prev) => [...prev.slice(-3), { id, message: safeMessage, type }]);
    window.setTimeout(() => {
      setArmyToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  const fetchArmyData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('未登录，无法加载军团数据');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [unitTypesResponse, meResponse, templatesResponse, trainingInitResponse] = await Promise.all([
        fetch(`${API_BASE}/army/unit-types`),
        fetch(`${API_BASE}/army/me`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }),
        fetch(`${API_BASE}/army/templates`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }),
        fetch(`${API_BASE}/army/training/init`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }).catch(() => null)
      ]);

      const unitTypesParsed = await parseApiResponse(unitTypesResponse);
      const meParsed = await parseApiResponse(meResponse);
      const templatesParsed = await parseApiResponse(templatesResponse);
      const trainingInitParsed = trainingInitResponse
        ? await parseApiResponse(trainingInitResponse)
        : null;

      if (!unitTypesResponse.ok) {
        setError(getApiErrorMessage(unitTypesParsed, '加载兵种列表失败'));
        setLoading(false);
        return;
      }

      if (!meResponse.ok) {
        setError(getApiErrorMessage(meParsed, '加载军团信息失败'));
        setLoading(false);
        return;
      }

      if (!templatesResponse.ok) {
        setError(getApiErrorMessage(templatesParsed, '加载部队失败'));
        setLoading(false);
        return;
      }

      const nextUnitTypes = normalizeUnitTypes(
        Array.isArray(unitTypesParsed.data?.unitTypes) ? unitTypesParsed.data.unitTypes : [],
        { enabledOnly: true }
      );
      const nextRoster = Array.isArray(meParsed.data?.roster) ? meParsed.data.roster : [];
      const nextBalance = Number.isFinite(meParsed.data?.knowledgeBalance) ? meParsed.data.knowledgeBalance : 0;
      const nextTemplates = Array.isArray(templatesParsed.data?.templates) ? templatesParsed.data.templates : [];
      const nextCombatArmies = Array.isArray(meParsed.data?.combatArmies) ? meParsed.data.combatArmies : [];
      const nextBattlefieldItems = trainingInitResponse?.ok
        ? normalizeBattlefieldItemCatalog(trainingInitParsed?.data?.battlefield?.itemCatalog)
        : [];

      setUnitTypes(nextUnitTypes);
      setRoster(nextRoster);
      setKnowledgeBalance(nextBalance);
      setTemplates(nextTemplates);
      setCombatArmies(nextCombatArmies);
      setSelectedTemplateId((prev) => (
        prev && nextTemplates.some((template) => getTemplateId(template) === prev)
          ? prev
          : getTemplateId(nextTemplates[0])
      ));
      setSelectedCombatArmyId((prev) => (
        prev && nextCombatArmies.some((army) => getCombatArmyId(army) === prev)
          ? prev
          : getCombatArmyId(nextCombatArmies[0])
      ));
      setBattlefieldItems(nextBattlefieldItems);
      setBattlefieldItemsError(
        trainingInitResponse?.ok
          ? ''
          : getApiErrorMessage(trainingInitParsed, '加载战场设置物失败，请稍后重试')
      );
      setStyleModalItemId('');
    } catch (requestError) {
      setError(`加载军团信息失败: ${requestError.message}`);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchArmyData();
  }, [fetchArmyData]);

  useEffect(() => {
    if (!error) return;
    pushArmyToast(error, 'error');
    setError('');
  }, [error, pushArmyToast]);

  useEffect(() => {
    if (!templateNotice) return;
    const isErrorNotice = /失败|未登录|不足|不能为空|至少|无效|不可/.test(templateNotice);
    pushArmyToast(templateNotice, isErrorNotice ? 'error' : 'info');
    setTemplateNotice('');
  }, [pushArmyToast, templateNotice]);

  useEffect(() => {
    if (!detailUnitId) {
      detailRotationDragRef.current = null;
      setDetailDragTarget('');
    }
  }, [detailUnitId]);

  useEffect(() => {
    if (!detailItemId) {
      detailItemRotationDragRef.current = null;
      setDetailItemDragTarget('');
    }
  }, [detailItemId]);

  const beginDetailRotationDrag = useCallback((stageKey, event) => {
    if (!detailUnitId || event.button !== 0) return;
    event.preventDefault();
    const safeKey = stageKey === 'battle' ? 'battle' : 'closeup';
    setDetailDragTarget(safeKey);
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    detailRotationDragRef.current = {
      stageKey: safeKey,
      startX: Number(event.clientX) || 0,
      startRotation: Number(detailRotation[safeKey]) || 0,
      pointerId
    };
    if (pointerId !== null && event.currentTarget?.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(pointerId);
      } catch (error) {
        // Ignore browsers that reject pointer capture in specific edge cases.
      }
    }
  }, [detailUnitId, detailRotation]);

  const updateDetailRotationDrag = useCallback((stageKey, event) => {
    const drag = detailRotationDragRef.current;
    if (!drag || drag.stageKey !== stageKey) return;
    if (drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
    const dx = (Number(event.clientX) || 0) - drag.startX;
    const next = drag.startRotation + (dx * 0.55);
    const normalized = ((next % 360) + 360) % 360;
    setDetailRotation((prev) => ({
      ...prev,
      [drag.stageKey]: normalized
    }));
  }, []);

  const stopDetailRotationDrag = useCallback((event) => {
    const drag = detailRotationDragRef.current;
    if (!drag) return;
    if (drag.pointerId !== null && Number.isFinite(event?.pointerId) && event.pointerId !== drag.pointerId) return;
    if (drag.pointerId !== null && event?.currentTarget?.releasePointerCapture) {
      try {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      } catch (error) {
        // Ignore when capture is already released.
      }
    }
    detailRotationDragRef.current = null;
    setDetailDragTarget('');
  }, []);

  const beginItemDetailRotationDrag = useCallback((stageKey, event) => {
    if (!detailItemId || event.button !== 0) return;
    event.preventDefault();
    const safeKey = stageKey === 'battle' ? 'battle' : 'closeup';
    setDetailItemDragTarget(safeKey);
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    detailItemRotationDragRef.current = {
      stageKey: safeKey,
      startX: Number(event.clientX) || 0,
      startRotation: Number(detailItemRotation[safeKey]) || 0,
      pointerId
    };
    if (pointerId !== null && event.currentTarget?.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(pointerId);
      } catch (error) {
        // Ignore browsers that reject pointer capture in specific edge cases.
      }
    }
  }, [detailItemId, detailItemRotation]);

  const updateItemDetailRotationDrag = useCallback((stageKey, event) => {
    const drag = detailItemRotationDragRef.current;
    if (!drag || drag.stageKey !== stageKey) return;
    if (drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
    const dx = (Number(event.clientX) || 0) - drag.startX;
    const next = drag.startRotation + (dx * 0.55);
    const normalized = ((next % 360) + 360) % 360;
    setDetailItemRotation((prev) => ({
      ...prev,
      [drag.stageKey]: normalized
    }));
  }, []);

  const stopItemDetailRotationDrag = useCallback((event) => {
    const drag = detailItemRotationDragRef.current;
    if (!drag) return;
    if (drag.pointerId !== null && Number.isFinite(event?.pointerId) && event.pointerId !== drag.pointerId) return;
    if (drag.pointerId !== null && event?.currentTarget?.releasePointerCapture) {
      try {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      } catch (error) {
        // Ignore when capture is already released.
      }
    }
    detailItemRotationDragRef.current = null;
    setDetailItemDragTarget('');
  }, []);

  const closeTemplateEditor = () => {
    setTemplateEditorOpen(false);
    setTemplateEditingId('');
    setTemplateEditorStep('units');
    setTemplateEditorDraft(createTemplateEditorDraft());
    setTemplateEditorHoverUnitId('');
    setTemplateEditorHoverPoint(null);
    if (isTemplateEditorMode) onClose?.();
  };

  const isolateTemplateEditorEvent = (event) => {
    event.stopPropagation();
  };

  const openTemplateCreate = useCallback(() => {
    setTemplateNotice('');
    const nextDraft = createTemplateEditorDraft(getNextTemplateDraftName(templates));
    setTemplateEditorOpen(true);
    setTemplateEditingId('');
    setTemplateEditorStep('units');
    setTemplateEditorDraft(nextDraft);
    setTemplateEditorHoverUnitId('');
    setTemplateEditorHoverPoint(null);
  }, [templates]);

  const openTemplateEdit = useCallback((template) => {
    if (!template) return;
    setTemplateNotice('');
    const units = normalizeTemplateUnits(template.units).slice(0, ARMY_MAX_UNIT_BASIS);
    const unitBasis = normalizeUnitBasisEntries(normalizeTemplatePercentages(units).map((entry) => ({
      unitTypeId: entry.unitTypeId,
      basis: entry.count
    })));
    const nextDraft = {
      name: typeof template.name === 'string' ? template.name : '',
      unitBasis
    };
    setTemplateEditorOpen(true);
    setTemplateEditingId(typeof template.templateId === 'string' ? template.templateId : '');
    setTemplateEditorStep('units');
    setTemplateEditorDraft(nextDraft);
    setTemplateEditorHoverUnitId('');
    setTemplateEditorHoverPoint(null);
  }, []);

  useEffect(() => {
    if (!isTemplateEditorMode) {
      templateEditorAutoOpenedRef.current = false;
      return;
    }
    if (loading || templateEditorAutoOpenedRef.current) return;
    templateEditorAutoOpenedRef.current = true;
    if (templateToEdit) {
      openTemplateEdit(templateToEdit);
    } else {
      openTemplateCreate();
    }
  }, [isTemplateEditorMode, loading, openTemplateCreate, openTemplateEdit, templateToEdit]);

  const handleAddEditorUnit = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId || !unitTypeMap[safeId]) return;
    const currentDraftBasis = normalizeUnitBasisEntries(templateEditorDraft.unitBasis);
    if (currentDraftBasis.some((entry) => entry.unitTypeId === safeId)) {
      pushArmyToast('该兵种已在部队中', 'error');
      return;
    }
    setTemplateEditorDraft((prev) => {
      const current = normalizeUnitBasisEntries(prev.unitBasis);
      if (current.some((entry) => entry.unitTypeId === safeId)) return prev;
      const nextBasis = normalizeUnitBasisEntries([...current, { unitTypeId: safeId, basis: 1 }]);
      return {
        ...prev,
        unitBasis: nextBasis
      };
    });
  }, [pushArmyToast, templateEditorDraft.unitBasis, unitTypeMap]);

  const handleRemoveEditorUnit = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setTemplateEditorDraft((prev) => {
      const nextBasis = normalizeUnitBasisEntries(prev.unitBasis.filter((entry) => entry.unitTypeId !== safeId));
      return {
        ...prev,
        unitBasis: nextBasis
      };
    });
    if (templateEditorHoverUnitId === safeId) {
      setTemplateEditorHoverUnitId('');
      setTemplateEditorHoverPoint(null);
    }
  }, [templateEditorHoverUnitId]);

  const handleChangeEditorUnitBasis = useCallback((unitTypeId, nextBasisRaw) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setTemplateEditorDraft((prev) => {
      const nextBasis = rebalanceUnitBasisOnChange(prev.unitBasis, safeId, nextBasisRaw);
      return {
        ...prev,
        unitBasis: nextBasis
      };
    });
  }, []);

  const handleUnitStageDrop = useCallback((event) => {
    event.preventDefault();
    const unitTypeId = event.dataTransfer?.getData('application/x-army-unit-type-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    handleAddEditorUnit(unitTypeId);
  }, [handleAddEditorUnit]);

  const goTemplateEditorStep = useCallback((direction) => {
    const currentIndex = ARMY_EDITOR_STEPS.indexOf(templateEditorStep);
    if (direction > 0) {
      if (templateEditorStep === 'units') {
        if (templateEditorTotal !== ARMY_MAX_UNIT_BASIS) {
          pushArmyToast('兵种占比总和必须为100%', 'error');
          return;
        }
      }
    }
    const nextIndex = Math.max(0, Math.min(ARMY_EDITOR_STEPS.length - 1, currentIndex + direction));
    setTemplateEditorStep(ARMY_EDITOR_STEPS[nextIndex] || 'units');
  }, [pushArmyToast, templateEditorStep, templateEditorTotal]);

  const submitTemplateEditor = async () => {
    if (!token) {
      setTemplateNotice('未登录，无法保存创建部队模板');
      return;
    }
    const units = normalizeTemplateUnits(templateEditorUnits);
    if (units.length <= 0) {
      setTemplateNotice('请至少配置一个士兵单位');
      return;
    }
    if (templateEditorTotal !== ARMY_MAX_UNIT_BASIS) {
      setTemplateNotice('兵种占比总和必须为100%');
      return;
    }
    const isEditing = !!templateEditingId;
    const actionId = isEditing ? templateEditingId : '__create__';
    setTemplateActionId(actionId);
    setTemplateNotice('');

    try {
      const response = await fetch(
        isEditing
          ? `${API_BASE}/army/templates/${templateEditingId}`
          : `${API_BASE}/army/templates`,
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            name: limitNameByDisplayWidth(templateEditorDraft.name || ''),
            units
          })
        }
      );
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        setTemplateNotice(getApiErrorMessage(parsed, isEditing ? '更新创建部队模板失败' : '创建部队模板失败'));
        return;
      }
      let nextTemplates = Array.isArray(parsed.data?.templates) ? parsed.data.templates : templates;
      try {
        const refreshResponse = await fetch(`${API_BASE}/army/templates`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const refreshParsed = await parseApiResponse(refreshResponse);
        if (refreshResponse.ok && Array.isArray(refreshParsed.data?.templates)) {
          nextTemplates = refreshParsed.data.templates;
        }
      } catch {
        // The save already succeeded; keep the save response if the follow-up refresh fails.
      }
      setTemplates(nextTemplates);
      const savedTemplate = parsed.data?.template
        || nextTemplates.find((template) => getTemplateId(template) === templateEditingId)
        || nextTemplates[0]
        || null;
      const nextActiveId = getTemplateId(savedTemplate) || getTemplateId(nextTemplates[0]);
      setSelectedTemplateId(nextActiveId);
      onTemplateSaved?.(savedTemplate, { editing: isEditing });
      closeTemplateEditor();
      pushArmyToast(`${isEditing ? '编辑' : '创建'}部队模板成功`, 'info');
    } catch (requestError) {
      setTemplateNotice(`${isEditing ? '更新创建部队模板' : '创建部队模板'}失败: ${requestError.message}`);
    } finally {
      setTemplateActionId('');
    }
  };

  const openCombatArmyCreate = useCallback((template) => {
    const templateId = getTemplateId(template);
    if (!templateId) return;
    if (!token) {
      pushArmyToast('未登录，无法创建实际参战部队', 'error');
      return;
    }
    const maxTotal = getTemplateCapacityByKnowledgeBalance(template, unitTypeMap, knowledgeBalance);
    if (maxTotal <= 0) {
      const singleQuote = buildTemplatePurchaseQuote(template, 1, unitTypeMap);
      if (singleQuote.totalCost <= 0) {
        pushArmyToast('该模板没有可创建的兵种，请先检查模板配比', 'error');
        return;
      }
      pushArmyToast(
        `知识点不足：创建该模板至少需要 ${singleQuote.totalCost} 点，当前余额 ${Math.max(0, Math.floor(Number(knowledgeBalance) || 0))} 点`,
        'error'
      );
      return;
    }
    const snapshot = buildCombatArmyCreateSnapshot(template, 0, unitTypeMap, knowledgeBalance);
    setCombatArmyCreatePanel({
      ...createDefaultCombatArmyCreatePanel(),
      open: true,
      template,
      name: getTroopDisplayName(template),
      ...snapshot
    });
  }, [knowledgeBalance, pushArmyToast, token, unitTypeMap]);

  const closeCombatArmyCreate = useCallback(() => {
    if (combatArmyActionId === '__create__') return;
    setCombatArmyCreatePanel(createDefaultCombatArmyCreatePanel());
  }, [combatArmyActionId]);

  const handleChangeCombatArmyCreateTotal = useCallback((totalCount) => {
    setCombatArmyCreatePanel((previous) => {
      if (!previous?.template) return previous;
      const snapshot = buildCombatArmyCreateSnapshot(
        previous.template,
        totalCount,
        unitTypeMap,
        knowledgeBalance
      );
      return { ...previous, ...snapshot };
    });
  }, [knowledgeBalance, unitTypeMap]);

  const handleChangeCombatArmyCreateName = useCallback((name) => {
    const safeName = typeof name === 'string' ? limitNameByDisplayWidth(name) : '';
    setCombatArmyCreatePanel((previous) => ({ ...previous, name: safeName }));
  }, []);

  const createCombatArmyFromTemplate = useCallback(async () => {
    if (combatArmyActionId === '__create__' || combatArmyCreateInFlightRef.current) return;
    const template = combatArmyCreatePanel.template;
    const templateId = getTemplateId(template);
    const maxTotal = Math.max(0, Math.floor(Number(combatArmyCreatePanel.maxTotal) || 0));
    const safeTotal = Math.max(0, Math.min(maxTotal, Math.floor(Number(combatArmyCreatePanel.totalRequested) || 0)));
    if (!templateId || maxTotal <= 0 || !token) {
      setCombatArmyCreatePanel(createDefaultCombatArmyCreatePanel());
      return;
    }
    if (safeTotal <= 0) {
      pushArmyToast('请先设置要创建的部队总兵力', 'error');
      return;
    }

    combatArmyCreateInFlightRef.current = true;
    setCombatArmyActionId('__create__');
    try {
      const response = await fetch(`${API_BASE}/army/combat-armies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          templateId,
          totalCount: safeTotal,
          name: String(combatArmyCreatePanel.name || '').trim()
        })
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        pushArmyToast(getApiErrorMessage(parsed, '创建实际参战部队失败'), 'error');
        return;
      }
      const nextCombatArmies = Array.isArray(parsed.data?.combatArmies) ? parsed.data.combatArmies : [];
      const nextRoster = Array.isArray(parsed.data?.roster) ? parsed.data.roster : roster;
      setCombatArmies(nextCombatArmies);
      setRoster(nextRoster);
      if (Number.isFinite(parsed.data?.knowledgeBalance)) setKnowledgeBalance(parsed.data.knowledgeBalance);
      const createdId = getCombatArmyId(parsed.data?.combatArmy);
      setSelectedCombatArmyId(createdId || getCombatArmyId(nextCombatArmies[0]));
      setCombatArmyCreatePanel(createDefaultCombatArmyCreatePanel());
      const totalCost = Math.max(0, Math.floor(Number(parsed.data?.totalCost) || 0));
      pushArmyToast(
        totalCost > 0
          ? `实际参战部队已创建，已消耗 ${totalCost} 知识点`
          : '实际参战部队已创建，并已登记真实士兵',
        'info'
      );
    } catch (requestError) {
      pushArmyToast(`创建实际参战部队失败: ${requestError.message}`, 'error');
    } finally {
      combatArmyCreateInFlightRef.current = false;
      setCombatArmyActionId('');
    }
  }, [combatArmyActionId, combatArmyCreatePanel, pushArmyToast, roster, token]);

  const deleteCombatArmy = useCallback(async (army) => {
    const armyId = getCombatArmyId(army);
    if (!armyId || !token) return;
    const armyName = getTroopDisplayName(army);
    if (!window.confirm(`确认解散实际参战部队「${armyName}」？已购买的真实士兵会回到未分配库存，知识点不返还。`)) return;

    setCombatArmyActionId(armyId);
    try {
      const response = await fetch(`${API_BASE}/army/combat-armies/${encodeURIComponent(armyId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        pushArmyToast(getApiErrorMessage(parsed, '解散实际参战部队失败'), 'error');
        return;
      }
      const nextCombatArmies = Array.isArray(parsed.data?.combatArmies) ? parsed.data.combatArmies : [];
      setCombatArmies(nextCombatArmies);
      if (Array.isArray(parsed.data?.roster)) setRoster(parsed.data.roster);
      setSelectedCombatArmyId((previous) => (
        previous === armyId ? getCombatArmyId(nextCombatArmies[0]) : previous
      ));
      pushArmyToast('实际参战部队已解散，真实士兵已回到未分配库存', 'info');
    } catch (requestError) {
      pushArmyToast(`解散实际参战部队失败: ${requestError.message}`, 'error');
    } finally {
      setCombatArmyActionId('');
    }
  }, [pushArmyToast, token]);

  const deleteTemplate = async (template) => {
    const templateId = typeof template?.templateId === 'string' ? template.templateId.trim() : '';
    if (!templateId || !token) return;
    if (!window.confirm(`确认删除部队模板「${getTroopDisplayName(template)}」？`)) return;

    setTemplateActionId(templateId);
    setTemplateNotice('');
    try {
      const response = await fetch(`${API_BASE}/army/templates/${templateId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        setTemplateNotice(getApiErrorMessage(parsed, '删除部队失败'));
        return;
      }
      const nextTemplates = Array.isArray(parsed.data?.templates) ? parsed.data.templates : [];
      setTemplates(nextTemplates);
      setSelectedTemplateId((prev) => (prev === templateId ? getTemplateId(nextTemplates[0]) : prev));
      setHoveredTemplateId((prev) => (prev === templateId ? '' : prev));
      if (templateEditingId === templateId) {
        closeTemplateEditor();
      }
      setTemplateNotice('部队已删除');
    } catch (requestError) {
      setTemplateNotice(`删除部队失败: ${requestError.message}`);
    } finally {
      setTemplateActionId('');
    }
  };

  return (
    <div className={`army-panel ${isTemplateEditorMode ? 'army-template-editor-only' : ''}`}>
      <div className="army-panel-header">
        <h2>{isLibraryMode ? '军事资料库' : '军团编制'}</h2>
        {!isLibraryMode ? (
          <div className="army-balance">知识点余额：<strong>{knowledgeBalance}</strong></div>
        ) : null}
      </div>

      {isLibraryMode ? (
        <div className="army-library-tabs">
          <button
            type="button"
            className={`army-library-tab ${libraryTab === 'units' ? 'active' : ''}`}
            onClick={() => setLibraryTab('units')}
          >
            兵种库
          </button>
          <button
            type="button"
            className={`army-library-tab ${libraryTab === 'equipment' ? 'active' : ''}`}
            onClick={() => setLibraryTab('equipment')}
          >
            装备库
          </button>
        </div>
      ) : null}
      {!isLibraryMode ? (
        <div className="army-barracks-tabs" role="tablist" aria-label="兵营">
          <button
            type="button"
            role="tab"
            aria-selected={activeBarracksTab === 'troops'}
            className={`army-barracks-tab ${activeBarracksTab === 'troops' ? 'active' : ''}`}
            onClick={() => setActiveBarracksTab('troops')}
          >
            我的部队
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeBarracksTab === 'units'}
            className={`army-barracks-tab ${activeBarracksTab === 'units' ? 'active' : ''}`}
            onClick={() => setActiveBarracksTab('units')}
          >
            兵种一览
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeBarracksTab === 'skills'}
            className={`army-barracks-tab ${activeBarracksTab === 'skills' ? 'active' : ''}`}
            onClick={() => setActiveBarracksTab('skills')}
          >
            技能树
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="army-loading">加载中...</div>
      ) : isLibraryMode && libraryTab === 'equipment' ? (
        <div className="army-equipment-content">
          {battlefieldItemsError ? (
            <div className="army-message army-message-error army-message-inline">{battlefieldItemsError}</div>
          ) : null}
          <section className="army-equipment-section">
            <div className="army-equipment-head">
              <h3>战场设置物一览</h3>
              <span>点击卡片查看 3D 模型与战场模型</span>
            </div>
            {battlefieldItems.length <= 0 ? (
              <div className="army-preview-empty">暂无可用战场设置物，请先在管理员面板配置物品目录。</div>
            ) : (
              <div className="army-equipment-grid">
                {battlefieldItems.map((item) => (
                  <article
                    key={item.itemId}
                    className="army-equipment-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      detailItemRotationDragRef.current = null;
                      setDetailItemDragTarget('');
                      setDetailItemId(item.itemId);
                      setDetailItemRotation({ closeup: 0, battle: 0 });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      detailItemRotationDragRef.current = null;
                      setDetailItemDragTarget('');
                      setDetailItemId(item.itemId);
                      setDetailItemRotation({ closeup: 0, battle: 0 });
                    }}
                  >
                    <div className="army-equipment-card-head">
                      <h4>{item.name}</h4>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={(event) => {
                          event.stopPropagation();
                          setStyleModalItemId(item.itemId);
                        }}
                      >
                        样式
                      </button>
                    </div>
                    <p className="army-equipment-desc">{buildBattlefieldItemIntro(item)}</p>
                    <div className="army-equipment-stats">
                      <span>{`尺寸 ${Math.round(item.width)} x ${Math.round(item.depth)} x ${Math.round(item.height)}`}</span>
                      <span>{`生命 ${Math.round(item.hp)}`}</span>
                      <span>{`防御 ${Number(item.defense).toFixed(1)}`}</span>
                    </div>
                    <div className="army-equipment-open-tip">点击查看模型详情</div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : isLibraryMode ? (
        <div className="army-equipment-content">
          <section className="army-equipment-section">
            <div className="army-equipment-head">
              <h3>兵种库</h3>
              <span>仅展示兵种资料，编队请前往兵营</span>
            </div>
            {unitsWithCount.length <= 0 ? (
              <div className="army-preview-empty">暂无可用兵种数据</div>
            ) : (
              <div className="army-unit-grid army-unit-grid-library">
                {unitsWithCount.map((unit) => {
                  const classMeta = unitClassMetaById[unit.id] || resolveUnitClassMeta(unit);
                  return (
                    <article className="army-unit-card army-unit-card-library" key={`library-${unit.id}`}>
                      <div className="army-unit-head">
                        <h3>{unit.name}</h3>
                        <div className="army-unit-head-right">
                          <span style={{ color: classMeta.color }}>{classMeta.label}</span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => {
                              setDetailUnitId(unit.id);
                              setDetailRotation({ closeup: 0, battle: 0 });
                              setDetailDragTarget('');
                            }}
                          >
                            详情
                          </button>
                        </div>
                      </div>
                      <div className="army-unit-stats">
                        <span>速度 {unit.speed}</span>
                        <span>生命 {unit.hp}</span>
                        <span>攻击 {unit.atk}</span>
                        <span>防御 {unit.def}</span>
                        <span>{`攻击范围 ${formatAttackRange(unit)}`}</span>
                        <span>{formatUnitKnowledgeCost(unit)}</span>
                        <span>{`职业 ${unit.professionId || '-'}`}</span>
                      </div>
                      <p className="army-equipment-desc">{buildUnitIntro(unit)}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : activeBarracksTab === 'skills' ? (
        <SkillTreePanel />
      ) : activeBarracksTab === 'troops' ? (
        <div className="army-troop-workspace">
          <section className="army-troop-section army-template-column">
            <div className="army-troop-toolbar">
              <div className="army-troop-title">
                <h3>部队模板</h3>
                <span>{`已有 ${templates.length} 个模板；模板本身不占用士兵`}</span>
              </div>
              <button type="button" className="btn btn-primary btn-small" onClick={openTemplateCreate}>
                创建部队模板
              </button>
            </div>
            {templates.length <= 0 ? (
              <div className="army-preview-empty">暂无部队模板</div>
            ) : (
              <div className="army-troop-grid">
                {templates.map((template) => {
                  const templateId = getTemplateId(template);
                  const summary = unitsToSummaryText(template?.units || [], unitNameByTypeId);
                  const rowBusy = templateActionId === templateId || templateActionId === '__create__';
                  const active = activeTemplate && getTemplateId(activeTemplate) === templateId;
                  const maxTotal = getTemplateCapacityByKnowledgeBalance(template, unitTypeMap, knowledgeBalance);
                  return (
                    <article
                      key={templateId || getTroopDisplayName(template)}
                      className={`army-troop-card ${active ? 'is-active' : ''}`}
                      onMouseEnter={() => setHoveredTemplateId(templateId)}
                      onFocus={() => {
                        setHoveredTemplateId(templateId);
                        setSelectedTemplateId(templateId);
                      }}
                      tabIndex={0}
                    >
                      <div className="army-troop-card-head">
                        <div>
                          <h4>{getTroopDisplayName(template)}</h4>
                          <span>模板占比合计 100%</span>
                        </div>
                        <div className="army-template-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={rowBusy}
                            onClick={() => openTemplateEdit(template)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="btn btn-warning btn-small"
                            disabled={rowBusy}
                            onClick={() => deleteTemplate(template)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <p>{summary || '无兵种配置'}</p>
                      <div className="army-template-create-row">
                        <span>
                          {maxTotal > 0
                            ? `按当前知识点最多可创建 ${maxTotal} 人`
                            : '知识点不足，点击查看创建成本'}
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={rowBusy || combatArmyActionId === '__create__'}
                          onClick={() => openCombatArmyCreate(template)}
                        >
                          创建参战部队
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="army-troop-detail-panel army-combat-army-panel">
            <div className="army-troop-detail-head">
              <div>
                <h3>实际可参战部队</h3>
                <span>{`已编成 ${combatArmies.length} 支 ｜ 未分配真实士兵 ${availableRosterTotal}`}</span>
              </div>
            </div>
            <div className="army-combat-army-note">
              这里的部队才会进入围城战；创建时按模板购入真实士兵，解散后回到未分配库存但不返还知识点。训练营部队不会显示在这里。
            </div>
            {combatArmies.length <= 0 ? (
              <div className="army-preview-empty">从左侧模板创建部队后，会在这里成为可参战编组。</div>
            ) : (
              <div className="army-combat-army-list">
                {combatArmies.map((army) => {
                  const armyId = getCombatArmyId(army);
                  const selected = selectedCombatArmy && getCombatArmyId(selectedCombatArmy) === armyId;
                  const summary = combatUnitsToSummaryText(army.units, unitNameByTypeId);
                  const busy = combatArmyActionId === armyId || combatArmyActionId === '__create__';
                  return (
                    <article
                      key={armyId || army.name}
                      className={`army-combat-army-card ${selected ? 'is-selected' : ''}`}
                      tabIndex={0}
                      onClick={() => setSelectedCombatArmyId(armyId)}
                      onFocus={() => setSelectedCombatArmyId(armyId)}
                    >
                      <div className="army-troop-card-head">
                        <div>
                          <h4>{getTroopDisplayName(army)}</h4>
                          <span>{`${Math.max(0, Math.floor(Number(army.totalCount) || 0))} 人 ｜ 可参战`}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-warning btn-small"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteCombatArmy(army);
                          }}
                        >
                          解散
                        </button>
                      </div>
                      <p>{summary || '无兵种配置'}</p>
                      <em>{`来源模板：${army.templateName || army.templateId || '独立编组'}`}</em>
                    </article>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="army-equipment-content">
          <section className="army-equipment-section">
            <div className="army-equipment-head">
              <h3>兵种一览</h3>
              <span>{`已解锁 ${unitsWithCount.length} 类`}</span>
            </div>
            {unitsWithCount.length <= 0 ? (
              <div className="army-preview-empty">暂无可用兵种数据</div>
            ) : (
              <div className="army-unit-grid army-unit-grid-library">
                {unitsWithCount.map((unit) => {
                  const classMeta = unitClassMetaById[unit.id] || resolveUnitClassMeta(unit);
                  return (
                    <article className="army-unit-card army-unit-card-library" key={`barracks-${unit.id}`}>
                      <div className="army-unit-head">
                        <h3>{unit.name}</h3>
                        <div className="army-unit-head-right">
                          <span style={{ color: classMeta.color }}>{classMeta.label}</span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => {
                              setDetailUnitId(unit.id);
                              setDetailRotation({ closeup: 0, battle: 0 });
                              setDetailDragTarget('');
                            }}
                          >
                            详情
                          </button>
                        </div>
                      </div>
                      <div className="army-unit-stats">
                        <span>速度 {unit.speed}</span>
                        <span>生命 {unit.hp}</span>
                        <span>攻击 {unit.atk}</span>
                        <span>防御 {unit.def}</span>
                        <span>{`攻击范围 ${formatAttackRange(unit)}`}</span>
                        <span>{formatUnitKnowledgeCost(unit)}</span>
                        <span>{`未分配 ${unit.count}`}</span>
                      </div>
                      <p className="army-equipment-desc">{buildUnitIntro(unit)}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {detailUnit ? (
        <div
          className="army-unit-detail-overlay"
          onClick={() => {
            detailRotationDragRef.current = null;
            setDetailDragTarget('');
            setDetailUnitId('');
          }}
        >
          <div
            className="army-unit-detail-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="army-unit-detail-head">
              <div>
                <h4>{detailUnit.name || detailUnit.id}</h4>
                <span>
                  {`${formatUnitClassLabel(detailUnit)} ｜ ${detailUnit.professionId || '-'} ｜ T${Math.max(1, Number(detailUnit.tier) || 1)}`}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  detailRotationDragRef.current = null;
                  setDetailDragTarget('');
                  setDetailUnitId('');
                }}
              >
                关闭
              </button>
            </div>

            <div className="army-unit-detail-intro">
              <strong>兵种简介</strong>
              <p>{buildUnitIntro(detailUnit)}</p>
            </div>

            <div className="army-unit-detail-stats">
              <div><span>速度</span><strong>{Number(detailUnit.speed) || 0}</strong></div>
              <div><span>生命</span><strong>{Number(detailUnit.hp) || 0}</strong></div>
              <div><span>攻击</span><strong>{Number(detailUnit.atk) || 0}</strong></div>
              <div><span>防御</span><strong>{Number(detailUnit.def) || 0}</strong></div>
              <div><span>攻击范围</span><strong>{formatAttackRange(detailUnit)}</strong></div>
              <div><span>每名知识点</span><strong>{`${getUnitKnowledgeCost(detailUnit)} 点`}</strong></div>
              <div><span>未分配</span><strong>{Number(detailUnit.count) || 0}</strong></div>
              <div><span>升级到</span><strong>{detailUnit.nextUnitTypeId || '无'}</strong></div>
            </div>

            <div className="army-unit-detail-intro">
              <strong>组件装配</strong>
              <p>
                {`body=${detailUnit.bodyId || '-'} ｜ weapon=${(detailUnit.weaponIds || []).join(', ') || '-'} ｜ vehicle=${detailUnit.vehicleId || '-'} ｜ behavior=${detailUnit.behaviorProfileId || '-'} ｜ stability=${detailUnit.stabilityProfileId || '-'} ｜ skill=部队技能系统`}
              </p>
            </div>

            <div className="army-unit-detail-visuals">
              <section className="army-unit-visual-card">
                <header>
                  <strong>近距离3D模型 + 贴图</strong>
                  <span>预留（可旋转）</span>
                </header>
                <div
                  className={`army-unit-visual-stage ${detailDragTarget === 'closeup' ? 'is-dragging' : ''}`}
                  onPointerDown={(event) => beginDetailRotationDrag('closeup', event)}
                  onPointerMove={(event) => updateDetailRotationDrag('closeup', event)}
                  onPointerUp={stopDetailRotationDrag}
                  onPointerCancel={stopDetailRotationDrag}
                >
                  <div className="army-unit-turntable">
                    <div className="army-unit-turntable-shadow" />
                    <div className="army-unit-turntable-disc" />
                    <ArmyUnitCloseupCanvasPreview
                      unit={detailUnit}
                      rotationDeg={detailRotation.closeup}
                      className="army-unit-visual-dummy"
                    />
                  </div>
                </div>
              </section>

              <section className="army-unit-visual-card">
                <header>
                  <strong>战场形象（小人模型 + 贴图）</strong>
                  <span>预留（可旋转）</span>
                </header>
                <div
                  className={`army-unit-visual-stage is-battle ${detailDragTarget === 'battle' ? 'is-dragging' : ''}`}
                  onPointerDown={(event) => beginDetailRotationDrag('battle', event)}
                  onPointerMove={(event) => updateDetailRotationDrag('battle', event)}
                  onPointerUp={stopDetailRotationDrag}
                  onPointerCancel={stopDetailRotationDrag}
                >
                  <div className="army-unit-turntable is-battle">
                    <div className="army-unit-turntable-shadow is-battle" />
                    <div className="army-unit-turntable-disc is-battle" />
                    <ArmyUnitBattleCanvasPreview
                      unit={detailUnit}
                      rotationDeg={detailRotation.battle}
                      className="army-unit-visual-dummy is-battle"
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {detailItem ? (
        <div
          className="army-unit-detail-overlay"
          onClick={() => {
            detailItemRotationDragRef.current = null;
            setDetailItemDragTarget('');
            setDetailItemId('');
          }}
        >
          <div
            className="army-unit-detail-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="army-unit-detail-head">
              <div>
                <h4>{detailItem.name || detailItem.itemId}</h4>
                <span>{`设置物ID：${detailItem.itemId || '-'}`}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  detailItemRotationDragRef.current = null;
                  setDetailItemDragTarget('');
                  setDetailItemId('');
                }}
              >
                关闭
              </button>
            </div>

            <div className="army-unit-detail-intro">
              <strong>设置物简介</strong>
              <p>{buildBattlefieldItemIntro(detailItem)}</p>
            </div>

            <div className="army-unit-detail-stats">
              <div><span>宽度</span><strong>{Math.round(Number(detailItem.width) || 0)}</strong></div>
              <div><span>深度</span><strong>{Math.round(Number(detailItem.depth) || 0)}</strong></div>
              <div><span>高度</span><strong>{Math.round(Number(detailItem.height) || 0)}</strong></div>
              <div><span>生命</span><strong>{Math.round(Number(detailItem.hp) || 0)}</strong></div>
              <div><span>防御</span><strong>{Number(detailItem.defense || 0).toFixed(1)}</strong></div>
              <div><span>样式</span><strong>{detailItem?.style?.shape || 'wall'}</strong></div>
              <div><span>模型</span><strong>3D</strong></div>
              <div><span>战场模型</span><strong>impostor</strong></div>
            </div>

            <div className="army-unit-detail-intro">
              <strong>样式参数</strong>
              <p>{formatBattlefieldItemStyleSummary(detailItem.style)}</p>
            </div>

            <div className="army-unit-detail-visuals">
              <section className="army-unit-visual-card">
                <header>
                  <strong>3D模型 + 贴图</strong>
                  <span>可拖拽旋转</span>
                </header>
                <div
                  className={`army-unit-visual-stage ${detailItemDragTarget === 'closeup' ? 'is-dragging' : ''}`}
                  onPointerDown={(event) => beginItemDetailRotationDrag('closeup', event)}
                  onPointerMove={(event) => updateItemDetailRotationDrag('closeup', event)}
                  onPointerUp={stopItemDetailRotationDrag}
                  onPointerCancel={stopItemDetailRotationDrag}
                >
                  <div className="army-unit-turntable">
                    <div className="army-unit-turntable-shadow" />
                    <div className="army-unit-turntable-disc" />
                    <ArmyBattlefieldItemCloseupPreview
                      item={detailItem}
                      rotationDeg={detailItemRotation.closeup}
                      className="army-unit-visual-dummy"
                    />
                  </div>
                </div>
              </section>

              <section className="army-unit-visual-card">
                <header>
                  <strong>战场模型</strong>
                  <span>可拖拽旋转</span>
                </header>
                <div
                  className={`army-unit-visual-stage is-battle ${detailItemDragTarget === 'battle' ? 'is-dragging' : ''}`}
                  onPointerDown={(event) => beginItemDetailRotationDrag('battle', event)}
                  onPointerMove={(event) => updateItemDetailRotationDrag('battle', event)}
                  onPointerUp={stopItemDetailRotationDrag}
                  onPointerCancel={stopItemDetailRotationDrag}
                >
                  <div className="army-unit-turntable is-battle">
                    <div className="army-unit-turntable-shadow is-battle" />
                    <div className="army-unit-turntable-disc is-battle" />
                    <ArmyBattlefieldItemBattlePreview
                      item={detailItem}
                      rotationDeg={detailItemRotation.battle}
                      className="army-unit-visual-dummy is-battle"
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {styleModalItem ? (
        <div className="army-unit-detail-overlay" onClick={() => setStyleModalItemId('')}>
          <div
            className="army-item-style-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="army-item-style-modal-head">
              <div>
                <h4>{`${styleModalItem.name || styleModalItem.itemId} · 样式`}</h4>
                <span>{`设置物ID：${styleModalItem.itemId || '-'}`}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setStyleModalItemId('')}
              >
                关闭
              </button>
            </div>
            {styleModalEntries.length <= 0 ? (
              <div className="army-preview-empty">该设置物当前使用默认样式参数。</div>
            ) : (
              <div className="army-item-style-list">
                {styleModalEntries.map((entry) => (
                  <div key={`style-${styleModalItem.itemId}-${entry.key}`} className="army-item-style-row">
                    <span>{entry.key}</span>
                    <strong>{entry.value}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="army-item-style-summary">{formatBattlefieldItemStyleSummary(styleModalItem.style)}</div>
          </div>
        </div>
      ) : null}

      {templateEditorOpen && (
        <div
          className="army-template-editor-overlay"
          onClick={isolateTemplateEditorEvent}
          onPointerDown={isolateTemplateEditorEvent}
          onPointerUp={isolateTemplateEditorEvent}
          onPointerMove={isolateTemplateEditorEvent}
          onMouseDown={isolateTemplateEditorEvent}
          onMouseUp={isolateTemplateEditorEvent}
          onMouseMove={isolateTemplateEditorEvent}
          onWheel={isolateTemplateEditorEvent}
          onDragStart={isolateTemplateEditorEvent}
          onDragOver={isolateTemplateEditorEvent}
          onDrop={isolateTemplateEditorEvent}
          onContextMenu={(event) => {
            event.preventDefault();
            isolateTemplateEditorEvent(event);
          }}
        >
          <div
            className="army-template-editor-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="army-template-editor-head">
              <div>
                <h4>创建部队模板</h4>
                <span>{`兵种占比 ${templateEditorTotal}% ｜ ${DEFAULT_FORMATION_NAME}`}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={closeTemplateEditor}
                disabled={Boolean(templateActionId)}
              >
                关闭
              </button>
            </div>
            <div className="army-template-stepper" role="tablist" aria-label="创建部队模板步骤">
              {ARMY_EDITOR_STEPS.map((step, index) => {
                const label = step === 'units' ? '兵种' : '预览';
                const active = templateEditorStep === step;
                return (
                  <button
                    key={`army-step-${step}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`army-template-step ${active ? 'active' : ''}`}
                    onClick={() => {
                      if (index <= ARMY_EDITOR_STEPS.indexOf(templateEditorStep)) {
                        setTemplateEditorStep(step);
                      }
                    }}
                  >
                    <span>{index + 1}</span>
                    {label}
                  </button>
                );
              })}
            </div>
            <label>
              <span>模板名称</span>
              <input
                type="text"
                maxLength={MAX_NAME_DISPLAY_WIDTH}
                value={templateEditorDraft.name || ''}
                placeholder="创建部队模板1"
                onChange={(event) => setTemplateEditorDraft((prev) => ({
                  ...prev,
                  name: limitNameByDisplayWidth(event.target.value || '')
                }))}
              />
            </label>
            {templateEditorStep === 'units' ? (
              <div className="army-unit-selection-stage">
                <aside className="army-formation-unit-list">
                  <div className="army-formation-panel-title">可选兵种</div>
                  {templateEditorAvailableRows.map((row) => {
                    const picked = templateEditorBasisRows.some((item) => item.unitTypeId === row.unitTypeId);
                    const classMeta = row.classMeta;
                    const addBlocked = false;
                    return (
                      <button
                        key={`unit-stage-${row.unitTypeId}`}
                        type="button"
                        className={`army-formation-unit-button ${picked ? 'is-selected' : ''} ${addBlocked ? 'is-disabled' : ''}`}
                        draggable={!picked && !addBlocked}
                        aria-disabled={addBlocked}
                        onDragStart={(event) => {
                          if (picked || addBlocked) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer?.setData('application/x-army-unit-type-id', row.unitTypeId);
                          event.dataTransfer?.setData('text/plain', row.unitTypeId);
                        }}
                        onClick={(event) => {
                          updateTemplateEditorUnitHover(row.unitTypeId, event);
                          if (!picked) handleAddEditorUnit(row.unitTypeId);
                        }}
                        onMouseEnter={(event) => updateTemplateEditorUnitHover(row.unitTypeId, event)}
                        onMouseMove={(event) => updateTemplateEditorUnitHover(row.unitTypeId, event)}
                        onFocus={(event) => updateTemplateEditorUnitHover(row.unitTypeId, event)}
                        onMouseLeave={clearTemplateEditorUnitHover}
                        onBlur={clearTemplateEditorUnitHover}
                      >
                        <i style={{ background: classMeta.color }} />
                        <span>
                          <strong>{row.unitName}</strong>
                          <em>{classMeta.label}</em>
                        </span>
                      </button>
                    );
                  })}
                </aside>
                <section
                  className="army-unit-selection-dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleUnitStageDrop}
                >
                  <div className="army-formation-panel-title">模板兵种占比</div>
                  {templateEditorBasisRows.length <= 0 ? (
                    <div className="army-unit-selection-empty">拖拽左侧兵种到这里</div>
                  ) : (
                    <div className="army-unit-basis-grid">
                      {templateEditorBasisRows.map((row) => (
                        <article
                          key={`basis-${row.unitTypeId}`}
                          className="army-unit-basis-card"
                          tabIndex={0}
                          onMouseEnter={(event) => updateTemplateEditorUnitHover(row.unitTypeId, event)}
                          onMouseMove={(event) => updateTemplateEditorUnitHover(row.unitTypeId, event)}
                          onFocus={(event) => updateTemplateEditorUnitHover(row.unitTypeId, event)}
                          onMouseLeave={clearTemplateEditorUnitHover}
                          onBlur={clearTemplateEditorUnitHover}
                          onClick={(event) => {
                            const targetTag = String(event.target?.tagName || '').toLowerCase();
                            if (targetTag === 'button' || targetTag === 'input') return;
                            updateTemplateEditorUnitHover(row.unitTypeId, event);
                          }}
                        >
                          <div className="army-unit-basis-head">
                            <i style={{ background: row.classMeta.color }} />
                            <div>
                              <strong>{row.unitName}</strong>
                              <span>{row.classMeta.label}</span>
                            </div>
                            <button type="button" className="btn btn-warning btn-small" onClick={() => handleRemoveEditorUnit(row.unitTypeId)}>
                              移除
                            </button>
                          </div>
                          <div className="army-unit-basis-percent">{formatPercentTenths(row.percentTenths)}</div>
                          <label className="army-unit-basis-input">
                            <span>占比</span>
                            <div className="army-unit-basis-range-control">
                              <input
                                type="range"
                                min={1}
                                max={ARMY_MAX_UNIT_BASIS}
                                step={1}
                                value={row.basis}
                                aria-label={`${row.unitName}占比`}
                                onChange={(event) => handleChangeEditorUnitBasis(row.unitTypeId, event.target.value)}
                              />
                              <output>{`${row.basis}%`}</output>
                            </div>
                          </label>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <aside className="army-template-troop-info-panel">
                  <div className="army-formation-panel-title">模板信息</div>
                  <div className="army-template-troop-info-head">
                    <strong>{templateEditorDraft.name || '创建部队模板'}</strong>
                    <span>{templateEditorSummary || '尚未配置兵种'}</span>
                  </div>
                  <div className="army-template-troop-info-stats">
                    <div><span>占比合计</span><strong>{`${templateEditorTotal}%`}</strong></div>
                    <div><span>兵种</span><strong>{templateEditorBasisRows.length}</strong></div>
                    <div><span>阵型</span><strong>{DEFAULT_FORMATION_NAME}</strong></div>
                    <div><span>平均速度</span><strong>{templateEditorPreviewStats.speed}</strong></div>
                    <div><span>生命</span><strong>{templateEditorPreviewStats.hp}</strong></div>
                    <div><span>攻击</span><strong>{templateEditorPreviewStats.atk}</strong></div>
                    <div><span>防御</span><strong>{templateEditorPreviewStats.def}</strong></div>
                    <div><span>攻击范围</span><strong>{formatAttackRange(templateEditorPreviewStats.attackRange)}</strong></div>
                  </div>
                  <div className="army-template-troop-info-compose">
                    {templateEditorBasisRows.length <= 0 ? (
                      <div className="army-preview-empty">从左侧添加兵种后汇总部队信息。</div>
                    ) : templateEditorBasisRows.map((row) => (
                      <div key={`info-compose-${row.unitTypeId}`} className="army-troop-composition-row">
                        <i style={{ background: row.classMeta.color }} />
                        <span>{row.unitName}</span>
                        <em>{formatPercentTenths(row.percentTenths)}</em>
                        <strong>{`${row.basis}%`}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="army-template-skill-placeholder">
                    <strong>部队技能树</strong>
                    <span>请在兵营「技能树」选项卡中学习与查看技能</span>
                  </div>
                </aside>
                {templateEditorDetailUnit && templateEditorHoverPoint ? (
                  <div
                    className="army-template-unit-hover-card"
                    style={{
                      left: `${templateEditorHoverPoint.x}px`,
                      top: `${templateEditorHoverPoint.y}px`
                    }}
                  >
                    <div className="army-template-unit-hover-head">
                      <div>
                        <strong>{templateEditorDetailUnit.name || templateEditorDetailUnit.id}</strong>
                        <span style={{ color: templateEditorDetailClassMeta?.color }}>
                          {templateEditorDetailClassMeta?.label || '步兵'}
                        </span>
                      </div>
                    </div>
                    <div className="army-template-unit-hover-preview">
                      <ArmyUnitCloseupCanvasPreview
                        unit={templateEditorDetailUnit}
                        rotationDeg={0}
                        className="army-formation-preview-canvas"
                      />
                    </div>
                    <div className="army-formation-stat-grid">
                      <div><span>速度</span><strong>{Number(templateEditorDetailUnit.speed) || 0}</strong></div>
                      <div><span>生命</span><strong>{Number(templateEditorDetailUnit.hp) || 0}</strong></div>
                      <div><span>攻击</span><strong>{Number(templateEditorDetailUnit.atk) || 0}</strong></div>
                      <div><span>防御</span><strong>{Number(templateEditorDetailUnit.def) || 0}</strong></div>
                      <div><span>攻击范围</span><strong>{formatAttackRange(templateEditorDetailUnit)}</strong></div>
                      <div><span>库存</span><strong>{Number(templateEditorDetailUnit.count) || 0}</strong></div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {templateEditorStep === 'preview' ? (
              <div className="army-template-preview-stage">
                <section className="army-template-preview-section">
                  <div className="army-formation-panel-title">兵种组成</div>
                  <div className="army-troop-composition">
                    {templateEditorBasisRows.map((row) => (
                      <div key={`preview-unit-${row.unitTypeId}`} className="army-troop-composition-row">
                        <i style={{ background: row.classMeta.color }} />
                        <span>{row.unitName}</span>
                        <em>{formatPercentTenths(row.percentTenths)}</em>
                        <strong>{`${row.basis}%`}</strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="army-template-preview-section">
                  <div className="army-formation-panel-title">整体数据</div>
                  <div className="army-troop-stat-grid">
                    <div><span>速度</span><strong>{templateEditorPreviewStats.speed}</strong></div>
                    <div><span>生命</span><strong>{templateEditorPreviewStats.hp}</strong></div>
                    <div><span>攻击</span><strong>{templateEditorPreviewStats.atk}</strong></div>
                    <div><span>防御</span><strong>{templateEditorPreviewStats.def}</strong></div>
                    <div><span>攻击范围</span><strong>{formatAttackRange(templateEditorPreviewStats.attackRange)}</strong></div>
                  </div>
                </section>
                <section className="army-template-preview-section">
                  <div className="army-formation-panel-title">{DEFAULT_FORMATION_NAME}</div>
                  <p className="army-template-preview-note">系统根据兵种组成自动生成；战斗中将始终使用此阵型。</p>
                  <DefaultFormationPreview
                    layout={templateEditorDefaultFormation}
                    unitTypeMap={unitTypeMap}
                    unitClassMetaById={unitClassMetaById}
                  />
                </section>
              </div>
            ) : null}
            <div className="army-template-editor-summary">
              {`兵种占比合计 ${templateEditorTotal}%${templateEditorSummary ? ` ｜ ${templateEditorSummary}` : ''}`}
            </div>
            <div className="army-template-editor-actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  if (templateEditorStep === 'units') {
                    closeTemplateEditor();
                  } else {
                    goTemplateEditorStep(-1);
                  }
                }}
                disabled={Boolean(templateActionId)}
              >
                {templateEditorStep === 'units' ? '取消' : '上一步'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => {
                  if (templateEditorStep === 'preview') {
                    submitTemplateEditor();
                  } else {
                    goTemplateEditorStep(1);
                  }
                }}
                disabled={templateEditorTotal <= 0 || Boolean(templateActionId)}
              >
                {templateActionId ? '保存中...' : (templateEditorStep === 'preview' ? '保存创建部队模板' : '下一步')}
              </button>
            </div>
          </div>
        </div>
      )}
      <BattleTemplateFillModal
        open={combatArmyCreatePanel.open}
        preview={combatArmyCreatePanel}
        isTrainingMode={false}
        onClose={closeCombatArmyCreate}
        onChangeTotal={handleChangeCombatArmyCreateTotal}
        onChangeName={handleChangeCombatArmyCreateName}
        onConfirm={createCombatArmyFromTemplate}
      />
      {armyToasts.length > 0 && typeof document !== 'undefined'
        ? createPortal(
          <div className="army-toast-stack" aria-live="polite" role="status">
            {armyToasts.map((toast) => (
              <div key={toast.id} className={`army-toast army-toast-${toast.type}`}>
                {toast.message}
              </div>
            ))}
          </div>,
          document.body
        )
        : null}
    </div>
  );
};

export default ArmyPanel;
