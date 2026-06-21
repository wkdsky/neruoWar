import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ArmyPanel.css';
import { API_BASE } from '../../runtimeConfig';
import normalizeUnitTypes from '../../game/unit/normalizeUnitTypes';
import {
  ArmyUnitCloseupCanvasPreview,
  ArmyUnitBattleCanvasPreview
} from './unit/ArmyUnitPreviewCanvases';
import { resolveUnitClassMeta } from './unit/unitClassMeta';
import ArmyFormationThreeEditor, {
  ARMY_FORMATION_MAX_CELLS,
  expandUnitsToFormationPlacements,
  getFormationOccupancyMetrics,
  normalizeFormationPlacements,
  resolveFormationMovePreview
} from './unit/ArmyFormationThreeEditor';
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

const ARMY_EDITOR_STEPS = ['units', 'formations', 'preview'];
const ARMY_MAX_UNIT_BASIS = 100;

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

const createFormationPlacementId = () => `formation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createFormationSlotId = () => `formation_slot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getTemplateId = (template) => (typeof template?.templateId === 'string' ? template.templateId.trim() : '');
const getFormationSlotId = (formation) => {
  const id = typeof formation?.id === 'string' ? formation.id.trim() : '';
  if (id) return id;
  return typeof formation?.formationId === 'string' ? formation.formationId.trim() : '';
};

const getTroopDisplayName = (template) => {
  const name = typeof template?.name === 'string' ? template.name.trim() : '';
  return name || '未命名部队';
};

const buildUnitIntro = (unit = {}) => {
  const explicit = typeof unit?.description === 'string' ? unit.description.trim() : '';
  if (explicit) return explicit;
  const role = unit?.roleTag === '远程' ? '远程压制' : '近战突击';
  const rpsType = typeof unit?.rpsType === 'string' ? unit.rpsType : 'mobility';
  const professionId = typeof unit?.professionId === 'string' ? unit.professionId : '';
  const speed = Number(unit?.speed) || 0;
  const range = Number(unit?.range) || 0;
  if (role === '远程压制') {
    return `该兵种定位为${role}（${rpsType}/${professionId}），擅长在中远距离持续输出。当前射程 ${range}，机动 ${speed}。`;
  }
  return `该兵种定位为${role}（${rpsType}/${professionId}），擅长正面接战与阵线压迫。当前射程 ${range}，机动 ${speed}。`;
};

const unitsToSummaryText = (units = [], unitNameById = new Map()) => (
  normalizeTemplateUnits(units)
    .map((entry) => `${unitNameById.get(entry.unitTypeId) || entry.unitTypeId}x${entry.count}`)
    .join(' / ')
);

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
  const byId = normalizeUnitBasisEntryRows(entries);
  let total = 0;
  const normalized = [];
  byId.forEach((entry) => {
    const remaining = ARMY_MAX_UNIT_BASIS - total;
    if (remaining <= 0) return;
    const basis = Math.min(remaining, entry.basis);
    if (basis <= 0) return;
    total += basis;
    normalized.push({ ...entry, basis });
  });
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
  const nextEntries = source.map((entry, index) => (
    index === activeIndex ? { ...entry, basis: requested } : { ...entry }
  ));
  let overflow = nextEntries.reduce((sum, entry) => sum + entry.basis, 0) - ARMY_MAX_UNIT_BASIS;
  if (overflow <= 0) return normalizeUnitBasisEntries(nextEntries);

  const otherIndexes = nextEntries
    .map((entry, index) => (index === activeIndex ? -1 : index))
    .filter((index) => index >= 0);
  while (overflow > 0) {
    const adjustableIndexes = [];
    for (let otherIndexIndex = 0; otherIndexIndex < otherIndexes.length; otherIndexIndex += 1) {
      const index = otherIndexes[otherIndexIndex];
      if (nextEntries[index].basis > 1) adjustableIndexes.push(index);
    }
    if (adjustableIndexes.length <= 0) break;
    for (let sortIndex = 0; sortIndex < adjustableIndexes.length - 1; sortIndex += 1) {
      for (let compareIndex = sortIndex + 1; compareIndex < adjustableIndexes.length; compareIndex += 1) {
        const leftIndex = adjustableIndexes[sortIndex];
        const rightIndex = adjustableIndexes[compareIndex];
        const shouldSwap = nextEntries[rightIndex].basis > nextEntries[leftIndex].basis
          || (nextEntries[rightIndex].basis === nextEntries[leftIndex].basis && rightIndex < leftIndex);
        if (shouldSwap) {
          adjustableIndexes[sortIndex] = rightIndex;
          adjustableIndexes[compareIndex] = leftIndex;
        }
      }
    }
    const share = Math.max(1, Math.floor(overflow / adjustableIndexes.length));
    for (let indexIndex = 0; indexIndex < adjustableIndexes.length && overflow > 0; indexIndex += 1) {
      const index = adjustableIndexes[indexIndex];
      const reduction = Math.min(nextEntries[index].basis - 1, share, overflow);
      nextEntries[index] = {
        ...nextEntries[index],
        basis: nextEntries[index].basis - reduction
      };
      overflow -= reduction;
    }
  }
  return normalizeUnitBasisEntries(nextEntries);
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

const createFormationSlot = (index = 0, placements = []) => ({
  id: createFormationSlotId(),
  name: index <= 0 ? '默认阵型' : `新建阵型${index}`,
  placements: normalizeFormationPlacements(placements),
  history: []
});

const getNextTemplateDraftName = (templates = []) => {
  const usedNumbers = new Set(
    (Array.isArray(templates) ? templates : [])
      .map((template) => {
        const match = String(template?.name || '').trim().match(/^新建部队(\d+)$/);
        return match ? Math.max(0, Math.floor(Number(match[1]) || 0)) : 0;
      })
      .filter((value) => value > 0)
  );
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  return `新建部队${nextNumber}`;
};

const createTemplateEditorDraft = (name = '') => ({
  name,
  unitBasis: [],
  formations: [createFormationSlot(0)]
});

const buildUnitBasisRows = (entries = [], unitTypeMap = {}) => {
  const normalized = normalizeUnitBasisEntries(entries).filter((entry) => unitTypeMap[entry.unitTypeId]);
  const percentMap = buildPercentTenthsByUnitId(normalized);
  return normalized.map((entry) => {
    const unit = unitTypeMap[entry.unitTypeId] || {};
    return {
      ...entry,
      unit,
      unitName: unit.name || entry.unitTypeId,
      classMeta: resolveUnitClassMeta(unit),
      percentTenths: percentMap.get(entry.unitTypeId) || 0
    };
  });
};

const trimPlacementsToBasis = (placements = [], basisEntries = []) => {
  const allowed = new Map(normalizeUnitBasisEntries(basisEntries).map((entry) => [entry.unitTypeId, entry.basis]));
  const used = new Map();
  return normalizeFormationPlacements(placements).filter((placement) => {
    const max = allowed.get(placement.unitTypeId) || 0;
    if (max <= 0) return false;
    const next = (used.get(placement.unitTypeId) || 0) + 1;
    if (next > max) return false;
    used.set(placement.unitTypeId, next);
    return true;
  });
};

const normalizeFormationSlots = (formations = [], basisEntries = []) => {
  const source = Array.isArray(formations) && formations.length > 0
    ? formations
    : [createFormationSlot(0)];
  return source.map((formation, index) => ({
    id: getFormationSlotId(formation) || createFormationSlotId(),
    name: (typeof formation?.name === 'string' && formation.name.trim())
      ? formation.name.trim().slice(0, 24)
      : (index <= 0 ? '默认阵型' : `新建阵型${index}`),
    placements: trimPlacementsToBasis(formation?.placements || [], basisEntries),
    history: Array.isArray(formation?.history) ? formation.history.slice(-20) : []
  }));
};

const buildPlacementCountsByUnitId = (placements = []) => (
  normalizeFormationPlacements(placements).reduce((acc, placement) => {
    acc[placement.unitTypeId] = (acc[placement.unitTypeId] || 0) + 1;
    return acc;
  }, {})
);

const isFormationLegal = (formation = {}, basisRows = []) => {
  if (basisRows.length <= 0) return false;
  const counts = buildPlacementCountsByUnitId(formation?.placements || []);
  return basisRows.every((row) => (counts[row.unitTypeId] || 0) === row.basis)
    && normalizeFormationPlacements(formation?.placements || []).length === basisRows.reduce((sum, row) => sum + row.basis, 0);
};

const createFormationFromUnits = (units = []) => (
  createFormationSlot(0, expandUnitsToFormationPlacements(normalizeTemplateUnits(units).slice(0, ARMY_MAX_UNIT_BASIS)))
);

const buildFormationPayload = (formations = [], basisEntries = []) => (
  normalizeFormationSlots(formations, basisEntries).map((formation) => ({
    id: formation.id,
    formationId: formation.id,
    name: formation.name,
    placements: normalizeFormationPlacements(formation.placements).map((placement) => ({
      unitTypeId: placement.unitTypeId,
      x: placement.x,
      y: placement.y
    }))
  }))
);

const buildLegalFormationPayload = (formations = [], basisEntries = []) => {
  const basisRows = normalizeUnitBasisEntries(basisEntries);
  return buildFormationPayload(
    normalizeFormationSlots(formations, basisRows).filter((formation) => isFormationLegal(formation, basisRows)),
    basisRows
  );
};

const pushFormationHistory = (formation, nextPlacements) => ({
  ...formation,
  placements: normalizeFormationPlacements(nextPlacements),
  history: [...(Array.isArray(formation.history) ? formation.history : []), normalizeFormationPlacements(formation.placements)].slice(-30)
});

const areFormationPlacementsEqual = (left = [], right = []) => {
  const normalizedLeft = normalizeFormationPlacements(left);
  const normalizedRight = normalizeFormationPlacements(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((placement, index) => {
    const next = normalizedRight[index];
    return placement.id === next.id
      && placement.unitTypeId === next.unitTypeId
      && placement.x === next.x
      && placement.y === next.y;
  });
};

const normalizeFormationPlacementIds = (ids = []) => (
  Array.from(new Set((Array.isArray(ids) ? ids : [ids])
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean)))
);

const FORMATION_MINI_PREVIEW_MIN_SPAN = 6;

const buildFormationMiniPreviewGeometry = (metrics = {}) => {
  const count = Math.max(0, Math.floor(Number(metrics?.count) || 0));
  if (count <= 0) {
    return {
      span: FORMATION_MINI_PREVIEW_MIN_SPAN,
      offsetX: 0,
      offsetY: 0
    };
  }
  const width = Math.max(1, Number(metrics.width) || 1);
  const height = Math.max(1, Number(metrics.height) || 1);
  const span = Math.max(FORMATION_MINI_PREVIEW_MIN_SPAN, width, height);
  return {
    span,
    offsetX: (span - width) / 2 - (Number(metrics.minX) || 0),
    offsetY: (span - height) / 2 - (Number(metrics.minY) || 0)
  };
};

const buildFormationMiniPreviewTileStyle = (placement = {}, geometry = {}) => {
  const span = Math.max(1, Number(geometry.span) || FORMATION_MINI_PREVIEW_MIN_SPAN);
  return {
    left: `${((Number(placement.x) + (Number(geometry.offsetX) || 0)) / span) * 100}%`,
    top: `${((Number(placement.y) + (Number(geometry.offsetY) || 0)) / span) * 100}%`,
    width: `${100 / span}%`,
    height: `${100 / span}%`
  };
};

const FormationMiniPreview = ({ formation = {}, unitTypeMap = {}, className = '' }) => {
  const placements = normalizeFormationPlacements(formation.placements);
  const geometry = buildFormationMiniPreviewGeometry(formation.occupancyMetrics);
  const classes = ['army-formation-mini-preview', className].filter(Boolean).join(' ');

  return (
    <div className={classes} aria-hidden="true">
      <div className="army-formation-mini-board">
        {placements.length <= 0 ? (
          <span className="army-formation-mini-empty" />
        ) : placements.map((placement) => {
          const unit = unitTypeMap[placement.unitTypeId] || {};
          return (
            <span
              key={`mini-${formation.id}-${placement.id}`}
              className="army-formation-mini-tile"
              style={{
                background: resolveUnitClassMeta(unit).color,
                ...buildFormationMiniPreviewTileStyle(placement, geometry)
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

const buildTroopCompositionRows = (units = [], unitTypeMap = {}) => (
  normalizeTemplateUnits(units)
    .map((entry) => {
      const unit = unitTypeMap[entry.unitTypeId] || {};
      return {
        ...entry,
        unit,
        unitName: unit.name || entry.unitName || entry.unitTypeId,
        classMeta: resolveUnitClassMeta(unit)
      };
    })
);

const buildTroopAggregateStats = (units = [], unitTypeMap = {}) => {
  const rows = buildTroopCompositionRows(units, unitTypeMap);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const weighted = (key) => {
    if (total <= 0) return 0;
    const value = rows.reduce((sum, row) => sum + ((Number(row.unit?.[key]) || 0) * row.count), 0) / total;
    return Math.round(value * 10) / 10;
  };
  return {
    total,
    speed: weighted('speed'),
    hp: weighted('hp'),
    atk: weighted('atk'),
    def: weighted('def'),
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

const ArmyPanel = ({ initialLibraryTab = 'units', mode = 'barracks' }) => {
  const isLibraryMode = mode === 'library';
  const safeInitialLibraryTab = initialLibraryTab === 'equipment' ? 'equipment' : 'units';
  const [activeBarracksTab, setActiveBarracksTab] = useState('troops');
  const [libraryTab, setLibraryTab] = useState(safeInitialLibraryTab);
  const [unitTypes, setUnitTypes] = useState([]);
  const [knowledgeBalance, setKnowledgeBalance] = useState(0);
  const [roster, setRoster] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [battlefieldItems, setBattlefieldItems] = useState([]);
  const [battlefieldItemsError, setBattlefieldItemsError] = useState('');
  const [styleModalItemId, setStyleModalItemId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [templateActionId, setTemplateActionId] = useState('');
  const [hoveredTemplateId, setHoveredTemplateId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
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
  const [templateEditorActiveFormationId, setTemplateEditorActiveFormationId] = useState('');
  const [templateEditorSelectedUnitId, setTemplateEditorSelectedUnitId] = useState('');
  const [templateEditorHoverUnitId, setTemplateEditorHoverUnitId] = useState('');
  const [templateEditorHoverPoint, setTemplateEditorHoverPoint] = useState(null);
  const [templateEditorSelectedPlacementId, setTemplateEditorSelectedPlacementId] = useState('');
  const [templateEditorSelectedPlacementIds, setTemplateEditorSelectedPlacementIds] = useState([]);
  const [templateEditorMoveSelectionIds, setTemplateEditorMoveSelectionIds] = useState([]);
  const [armyToasts, setArmyToasts] = useState([]);

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

  const activeTemplateCompositionRows = useMemo(
    () => buildTroopCompositionRows(activeTemplate?.units || [], unitTypeMap),
    [activeTemplate, unitTypeMap]
  );

  const activeTemplateStats = useMemo(
    () => buildTroopAggregateStats(activeTemplate?.units || [], unitTypeMap),
    [activeTemplate, unitTypeMap]
  );

  const activeTemplateBasisRows = useMemo(
    () => activeTemplateCompositionRows.map((row) => ({ ...row, basis: row.count })),
    [activeTemplateCompositionRows]
  );

  const activeTemplateFormationSummaries = useMemo(() => {
    if (!activeTemplate) return [];
    return (Array.isArray(activeTemplate.formations) ? activeTemplate.formations : []).map((formation, index) => {
      const placements = normalizeFormationPlacements(formation?.placements || []);
      const legal = formation?.legal === true || isFormationLegal({ placements }, activeTemplateBasisRows);
      return {
        id: getFormationSlotId(formation) || `formation_${index}`,
        name: (typeof formation?.name === 'string' && formation.name.trim())
          ? formation.name.trim()
          : (index <= 0 ? '默认阵型' : `新建阵型${index}`),
        placements,
        occupancyMetrics: getFormationOccupancyMetrics(placements),
        legal,
        totalPlaced: Math.max(0, Math.floor(Number(formation?.totalPlaced) || placements.length))
      };
    });
  }, [activeTemplate, activeTemplateBasisRows]);

  const templateEditorAvailableRows = useMemo(() => (
    unitsWithCount
      .map((unit) => ({
        unitTypeId: unit.id,
        unitName: unit.name || unit.id,
        unit
      }))
      .sort((a, b) => a.unitName.localeCompare(b.unitName, 'zh-Hans-CN'))
  ), [unitsWithCount]);

  const templateEditorBasisRows = useMemo(
    () => buildUnitBasisRows(templateEditorDraft.unitBasis, unitTypeMap),
    [templateEditorDraft.unitBasis, unitTypeMap]
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

  const templateEditorFormations = useMemo(
    () => normalizeFormationSlots(templateEditorDraft.formations, templateEditorDraft.unitBasis),
    [templateEditorDraft.formations, templateEditorDraft.unitBasis]
  );

  const templateEditorActiveFormation = useMemo(() => (
    templateEditorFormations.find((formation) => formation.id === templateEditorActiveFormationId)
      || templateEditorFormations[0]
      || null
  ), [templateEditorActiveFormationId, templateEditorFormations]);

  const templateEditorPlacements = useMemo(
    () => normalizeFormationPlacements(templateEditorActiveFormation?.placements || []),
    [templateEditorActiveFormation]
  );

  const templateEditorOccupancyMetrics = useMemo(
    () => getFormationOccupancyMetrics(templateEditorPlacements),
    [templateEditorPlacements]
  );

  const templateEditorPlacementCounts = useMemo(
    () => buildPlacementCountsByUnitId(templateEditorPlacements),
    [templateEditorPlacements]
  );

  const templateEditorFormationSummaries = useMemo(
    () => templateEditorFormations.map((formation) => {
      const placements = normalizeFormationPlacements(formation.placements);
      return {
        ...formation,
        placements,
        occupancyMetrics: getFormationOccupancyMetrics(placements),
        legal: isFormationLegal(formation, templateEditorBasisRows),
        totalPlaced: placements.length
      };
    }),
    [templateEditorBasisRows, templateEditorFormations]
  );

  const templateEditorLegalFormationCount = useMemo(
    () => templateEditorFormationSummaries.filter((formation) => formation.legal).length,
    [templateEditorFormationSummaries]
  );

  const templateEditorPreviewStats = useMemo(
    () => buildTroopAggregateStats(templateEditorUnits, unitTypeMap),
    [templateEditorUnits, unitTypeMap]
  );

  const templateEditorActiveUnitRows = useMemo(
    () => templateEditorBasisRows.map((row) => {
      const placed = templateEditorPlacementCounts[row.unitTypeId] || 0;
      return {
        ...row,
        placed,
        remaining: Math.max(0, row.basis - placed)
      };
    }),
    [templateEditorBasisRows, templateEditorPlacementCounts]
  );

  const templateEditorDetailUnit = useMemo(() => {
    const unitId = templateEditorHoverUnitId || '';
    return unitTypeMap[unitId] || null;
  }, [templateEditorHoverUnitId, unitTypeMap]);

  const templateEditorSelectedPlacements = useMemo(() => {
    const ids = new Set(normalizeFormationPlacementIds(templateEditorSelectedPlacementIds));
    return templateEditorPlacements.filter((placement) => ids.has(placement.id));
  }, [templateEditorPlacements, templateEditorSelectedPlacementIds]);

  useEffect(() => {
    const liveIds = new Set(templateEditorPlacements.map((placement) => placement.id));
    const nextSelectedIds = normalizeFormationPlacementIds(templateEditorSelectedPlacementIds)
      .filter((id) => liveIds.has(id));
    if (nextSelectedIds.length !== templateEditorSelectedPlacementIds.length) {
      setTemplateEditorSelectedPlacementIds(nextSelectedIds);
      setTemplateEditorSelectedPlacementId(nextSelectedIds[0] || '');
    }
    const nextMoveIds = normalizeFormationPlacementIds(templateEditorMoveSelectionIds)
      .filter((id) => liveIds.has(id));
    if (nextMoveIds.length !== templateEditorMoveSelectionIds.length) {
      setTemplateEditorMoveSelectionIds(nextMoveIds);
    }
  }, [templateEditorMoveSelectionIds, templateEditorPlacements, templateEditorSelectedPlacementIds]);

  const templateEditorDetailClassMeta = useMemo(
    () => (templateEditorDetailUnit ? resolveUnitClassMeta(templateEditorDetailUnit) : null),
    [templateEditorDetailUnit]
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
      const nextBattlefieldItems = trainingInitResponse?.ok
        ? normalizeBattlefieldItemCatalog(trainingInitParsed?.data?.battlefield?.itemCatalog)
        : [];

      setUnitTypes(nextUnitTypes);
      setRoster(nextRoster);
      setKnowledgeBalance(nextBalance);
      setTemplates(nextTemplates);
      setSelectedTemplateId((prev) => (
        prev && nextTemplates.some((template) => getTemplateId(template) === prev)
          ? prev
          : getTemplateId(nextTemplates[0])
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
    if (!templateEditorOpen) return;
    if (templateEditorFormations.length <= 0) return;
    if (templateEditorActiveFormationId && templateEditorFormations.some((formation) => formation.id === templateEditorActiveFormationId)) {
      return;
    }
    setTemplateEditorActiveFormationId(templateEditorFormations[0].id);
  }, [templateEditorActiveFormationId, templateEditorFormations, templateEditorOpen]);

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
    setTemplateEditorActiveFormationId('');
    setTemplateEditorSelectedUnitId('');
    setTemplateEditorHoverUnitId('');
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  };

  const openTemplateCreate = () => {
    setTemplateNotice('');
    const nextDraft = createTemplateEditorDraft(getNextTemplateDraftName(templates));
    setTemplateEditorOpen(true);
    setTemplateEditingId('');
    setTemplateEditorStep('units');
    setTemplateEditorDraft(nextDraft);
    setTemplateEditorActiveFormationId(nextDraft.formations[0]?.id || '');
    setTemplateEditorSelectedUnitId('');
    setTemplateEditorHoverUnitId('');
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  };

  const openTemplateEdit = (template) => {
    if (!template) return;
    setTemplateNotice('');
    const units = normalizeTemplateUnits(template.units).slice(0, ARMY_MAX_UNIT_BASIS);
    const unitBasis = normalizeUnitBasisEntries(units.map((entry) => ({
      unitTypeId: entry.unitTypeId,
      basis: entry.count
    })));
    const fallbackFormation = createFormationFromUnits(unitBasis.map((entry) => ({
      unitTypeId: entry.unitTypeId,
      count: entry.basis
    })));
    const formations = Array.isArray(template.formations) && template.formations.length > 0
      ? normalizeFormationSlots(template.formations, unitBasis)
      : [fallbackFormation];
    const nextDraft = {
      name: typeof template.name === 'string' ? template.name : '',
      unitBasis,
      formations
    };
    setTemplateEditorOpen(true);
    setTemplateEditingId(typeof template.templateId === 'string' ? template.templateId : '');
    setTemplateEditorStep('units');
    setTemplateEditorDraft(nextDraft);
    setTemplateEditorActiveFormationId(formations[0]?.id || '');
    setTemplateEditorSelectedUnitId('');
    setTemplateEditorHoverUnitId('');
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  };

  const sanitizeDraftFormations = useCallback((unitBasis, formations) => (
    normalizeFormationSlots(formations, unitBasis)
  ), []);

  const handleAddEditorUnit = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId || !unitTypeMap[safeId]) return;
    const currentDraftBasis = normalizeUnitBasisEntries(templateEditorDraft.unitBasis);
    if (currentDraftBasis.some((entry) => entry.unitTypeId === safeId)) {
      pushArmyToast('该兵种已在部队中', 'error');
      return;
    }
    if (getUnitBasisTotal(currentDraftBasis) >= ARMY_MAX_UNIT_BASIS) {
      pushArmyToast('基础数已达上限', 'error');
      return;
    }
    setTemplateEditorDraft((prev) => {
      const current = normalizeUnitBasisEntries(prev.unitBasis);
      if (current.some((entry) => entry.unitTypeId === safeId)) return prev;
      if (getUnitBasisTotal(current) >= ARMY_MAX_UNIT_BASIS) return prev;
      const nextBasis = normalizeUnitBasisEntries([...current, { unitTypeId: safeId, basis: 1 }]);
      return {
        ...prev,
        unitBasis: nextBasis,
        formations: sanitizeDraftFormations(nextBasis, prev.formations)
      };
    });
    setTemplateEditorSelectedUnitId(safeId);
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [pushArmyToast, sanitizeDraftFormations, templateEditorDraft.unitBasis, unitTypeMap]);

  const handleRemoveEditorUnit = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setTemplateEditorDraft((prev) => {
      const nextBasis = normalizeUnitBasisEntries(prev.unitBasis.filter((entry) => entry.unitTypeId !== safeId));
      return {
        ...prev,
        unitBasis: nextBasis,
        formations: sanitizeDraftFormations(nextBasis, prev.formations)
      };
    });
    if (templateEditorSelectedUnitId === safeId) setTemplateEditorSelectedUnitId('');
    if (templateEditorHoverUnitId === safeId) {
      setTemplateEditorHoverUnitId('');
      setTemplateEditorHoverPoint(null);
    }
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [sanitizeDraftFormations, templateEditorHoverUnitId, templateEditorSelectedUnitId]);

  const handleChangeEditorUnitBasis = useCallback((unitTypeId, nextBasisRaw) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setTemplateEditorDraft((prev) => {
      const nextBasis = rebalanceUnitBasisOnChange(prev.unitBasis, safeId, nextBasisRaw);
      return {
        ...prev,
        unitBasis: nextBasis,
        formations: sanitizeDraftFormations(nextBasis, prev.formations)
      };
    });
  }, [sanitizeDraftFormations]);

  const handleUnitStageDrop = useCallback((event) => {
    event.preventDefault();
    const unitTypeId = event.dataTransfer?.getData('application/x-army-unit-type-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    handleAddEditorUnit(unitTypeId);
  }, [handleAddEditorUnit]);

  const updateActiveFormation = useCallback((producer) => {
    setTemplateEditorDraft((prev) => ({
      ...prev,
      formations: normalizeFormationSlots(prev.formations, prev.unitBasis).map((formation) => {
        if (formation.id !== templateEditorActiveFormation?.id) return formation;
        const nextPlacements = producer(normalizeFormationPlacements(formation.placements), formation);
        if (!Array.isArray(nextPlacements)) return formation;
        if (areFormationPlacementsEqual(formation.placements, nextPlacements)) return formation;
        return pushFormationHistory(formation, nextPlacements);
      })
    }));
  }, [templateEditorActiveFormation]);

  const canPlaceFormationUnit = useCallback((unitTypeId, cell) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId || !cell) return false;
    const row = templateEditorBasisRows.find((item) => item.unitTypeId === safeId);
    if (!row) return false;
    if (templateEditorPlacements.some((placement) => placement.x === cell.x && placement.y === cell.y)) return false;
    return (templateEditorPlacementCounts[safeId] || 0) < row.basis;
  }, [templateEditorBasisRows, templateEditorPlacementCounts, templateEditorPlacements]);

  const handlePlaceFormationUnit = useCallback((unitTypeId, cell) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId || !cell || !unitTypeMap[safeId]) return;
    updateActiveFormation((source) => {
      const row = templateEditorBasisRows.find((item) => item.unitTypeId === safeId);
      if (!row) return source;
      const hitPlacement = source.find((placement) => placement.x === cell.x && placement.y === cell.y) || null;
      if (hitPlacement?.unitTypeId === safeId) {
        return source.filter((placement) => placement.id !== hitPlacement.id);
      }
      const currentCount = source.filter((placement) => placement.unitTypeId === safeId).length;
      if (currentCount >= row.basis) return source;
      if (hitPlacement) {
        return source.map((placement) => (
          placement.id === hitPlacement.id
            ? { ...placement, unitTypeId: safeId }
            : placement
        ));
      }
      return [
        ...source,
        {
          id: createFormationPlacementId(),
          unitTypeId: safeId,
          x: cell.x,
          y: cell.y
        }
      ];
    });
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [templateEditorBasisRows, unitTypeMap, updateActiveFormation]);

  const handleChangeFormationPlacements = useCallback((placements = []) => {
    const nextPlacements = normalizeFormationPlacements(placements);
    updateActiveFormation(() => nextPlacements);
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [updateActiveFormation]);

  const handleMoveFormationPlacement = useCallback((placementId, cell) => {
    const safeId = typeof placementId === 'string' ? placementId.trim() : '';
    if (!safeId || !cell) return;
    updateActiveFormation((source) => {
      if (source.some((placement) => placement.id !== safeId && placement.x === cell.x && placement.y === cell.y)) return source;
      return source.map((placement) => (
        placement.id === safeId
          ? { ...placement, x: cell.x, y: cell.y }
          : placement
      ));
    });
  }, [updateActiveFormation]);

  const handleSelectFormationPlacements = useCallback((placementIds = []) => {
    const liveIds = new Set(templateEditorPlacements.map((placement) => placement.id));
    const safeIds = normalizeFormationPlacementIds(placementIds).filter((id) => liveIds.has(id));
    setTemplateEditorSelectedPlacementIds(safeIds);
    setTemplateEditorSelectedPlacementId(safeIds[0] || '');
    setTemplateEditorMoveSelectionIds([]);
    if (safeIds.length > 0) {
      setTemplateEditorSelectedUnitId('');
    }
  }, [templateEditorPlacements]);

  const handleSelectFormationPlacement = useCallback((placementId) => {
    handleSelectFormationPlacements(placementId ? [placementId] : []);
  }, [handleSelectFormationPlacements]);

  const handleCancelFormationCanvasAction = useCallback(() => {
    if (templateEditorSelectedUnitId || templateEditorMoveSelectionIds.length > 0) {
      setTemplateEditorSelectedUnitId('');
      setTemplateEditorMoveSelectionIds([]);
      return;
    }
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
  }, [templateEditorMoveSelectionIds.length, templateEditorSelectedUnitId]);

  const handleDeleteFormationSelection = useCallback((placementIds = templateEditorSelectedPlacementIds) => {
    const safeIds = new Set(normalizeFormationPlacementIds(placementIds));
    if (safeIds.size <= 0) return;
    updateActiveFormation((source) => source.filter((placement) => !safeIds.has(placement.id)));
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [templateEditorSelectedPlacementIds, updateActiveFormation]);

  const handleBeginMoveFormationSelection = useCallback(() => {
    const safeIds = normalizeFormationPlacementIds(templateEditorSelectedPlacementIds.length > 0
      ? templateEditorSelectedPlacementIds
      : templateEditorSelectedPlacementId);
    if (safeIds.length <= 0) return;
    setTemplateEditorSelectedUnitId('');
    setTemplateEditorMoveSelectionIds(safeIds);
  }, [templateEditorSelectedPlacementId, templateEditorSelectedPlacementIds]);

  const handleMoveFormationSelectionToCell = useCallback((cell) => {
    if (!cell) return;
    const safeIds = normalizeFormationPlacementIds(templateEditorMoveSelectionIds.length > 0
      ? templateEditorMoveSelectionIds
      : templateEditorSelectedPlacementIds);
    if (safeIds.length <= 0) return;
    const preview = resolveFormationMovePreview(templateEditorPlacements, safeIds, cell);
    if (preview.blocked) {
      pushArmyToast('目标区域已被其他士兵占用', 'error');
      return;
    }
    const movedById = new Map(preview.placements.map((placement) => [placement.id, placement]));
    updateActiveFormation((source) => source.map((placement) => {
      const next = movedById.get(placement.id);
      return next ? { ...placement, x: next.x, y: next.y } : placement;
    }));
    setTemplateEditorMoveSelectionIds([]);
  }, [
    pushArmyToast,
    templateEditorMoveSelectionIds,
    templateEditorPlacements,
    templateEditorSelectedPlacementIds,
    updateActiveFormation
  ]);

  const handleUndoFormation = useCallback(() => {
    if (!templateEditorActiveFormation) return;
    setTemplateEditorDraft((prev) => ({
      ...prev,
      formations: normalizeFormationSlots(prev.formations, prev.unitBasis).map((formation) => {
        if (formation.id !== templateEditorActiveFormation.id) return formation;
        const history = Array.isArray(formation.history) ? formation.history : [];
        if (history.length <= 0) return formation;
        return {
          ...formation,
          placements: normalizeFormationPlacements(history[history.length - 1]),
          history: history.slice(0, -1)
        };
      })
    }));
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [templateEditorActiveFormation]);

  const handleClearFormation = useCallback(() => {
    updateActiveFormation(() => []);
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [updateActiveFormation]);

  const handleAddFormationSlot = useCallback(() => {
    const nextFormation = createFormationSlot(templateEditorFormations.length);
    setTemplateEditorDraft((prev) => {
      const source = normalizeFormationSlots(prev.formations, prev.unitBasis);
      return {
        ...prev,
        formations: [...source, nextFormation]
      };
    });
    setTemplateEditorActiveFormationId(nextFormation.id);
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [templateEditorFormations.length]);

  const handleDeleteFormationSlot = useCallback((formationId) => {
    const safeId = typeof formationId === 'string' ? formationId.trim() : '';
    if (!safeId) return;
    if (templateEditorFormations.length <= 1) {
      pushArmyToast('至少保留一个阵型栏', 'error');
      return;
    }
    const nextActiveId = templateEditorActiveFormationId === safeId
      ? templateEditorFormations.find((formation) => formation.id !== safeId)?.id || ''
      : templateEditorActiveFormationId;
    setTemplateEditorDraft((prev) => {
      const source = normalizeFormationSlots(prev.formations, prev.unitBasis);
      const next = source.filter((formation) => formation.id !== safeId);
      return { ...prev, formations: next };
    });
    setTemplateEditorActiveFormationId(nextActiveId);
    setTemplateEditorSelectedPlacementId('');
    setTemplateEditorSelectedPlacementIds([]);
    setTemplateEditorMoveSelectionIds([]);
  }, [pushArmyToast, templateEditorActiveFormationId, templateEditorFormations]);

  const handleRenameFormationSlot = useCallback((formationId, name) => {
    const safeId = typeof formationId === 'string' ? formationId.trim() : '';
    setTemplateEditorDraft((prev) => ({
      ...prev,
      formations: normalizeFormationSlots(prev.formations, prev.unitBasis).map((formation) => (
        formation.id === safeId
          ? { ...formation, name: String(name || '').slice(0, 24) }
          : formation
      ))
    }));
  }, []);

  const goTemplateEditorStep = useCallback((direction) => {
    const currentIndex = ARMY_EDITOR_STEPS.indexOf(templateEditorStep);
    if (direction > 0) {
      if (templateEditorStep === 'units') {
        if (templateEditorTotal < 1) {
          pushArmyToast('至少选择 1 个兵种', 'error');
          return;
        }
        if (templateEditorTotal > ARMY_MAX_UNIT_BASIS) {
          pushArmyToast(`部队基础数最多 ${ARMY_MAX_UNIT_BASIS}`, 'error');
          return;
        }
      }
      if (templateEditorStep === 'formations' && templateEditorLegalFormationCount <= 0) {
        pushArmyToast('至少需要一个合法阵型才能预览', 'error');
        return;
      }
    }
    const nextIndex = Math.max(0, Math.min(ARMY_EDITOR_STEPS.length - 1, currentIndex + direction));
    setTemplateEditorStep(ARMY_EDITOR_STEPS[nextIndex] || 'units');
  }, [pushArmyToast, templateEditorLegalFormationCount, templateEditorStep, templateEditorTotal]);

  const submitTemplateEditor = async () => {
    if (!token) {
      setTemplateNotice('未登录，无法保存部队');
      return;
    }
    const units = normalizeTemplateUnits(templateEditorUnits);
    if (units.length <= 0) {
      setTemplateNotice('请至少配置一个士兵单位');
      return;
    }
    if (templateEditorTotal > ARMY_MAX_UNIT_BASIS) {
      setTemplateNotice(`部队基础数最多 ${ARMY_MAX_UNIT_BASIS}`);
      return;
    }
    if (templateEditorLegalFormationCount <= 0) {
      setTemplateNotice('至少需要一个合法阵型才能保存部队');
      return;
    }
    const legalFormationPayload = buildLegalFormationPayload(templateEditorFormations, templateEditorDraft.unitBasis);
    if (legalFormationPayload.length <= 0) {
      setTemplateNotice('至少需要一个合法阵型才能保存部队');
      return;
    }
    const ignoredFormationCount = Math.max(0, templateEditorFormations.length - legalFormationPayload.length);

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
            name: templateEditorDraft.name || '',
            units,
            formations: legalFormationPayload
          })
        }
      );
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        setTemplateNotice(getApiErrorMessage(parsed, isEditing ? '更新部队失败' : '创建部队失败'));
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
      const nextActiveId = getTemplateId(parsed.data?.template) || getTemplateId(nextTemplates[0]);
      setSelectedTemplateId(nextActiveId);
      closeTemplateEditor();
      const successMessage = `${isEditing ? '编辑' : '创建'}部队成功${ignoredFormationCount > 0 ? `，已忽略 ${ignoredFormationCount} 个未完成阵型` : ''}`;
      pushArmyToast(successMessage, 'info');
    } catch (requestError) {
      setTemplateNotice(`${isEditing ? '更新部队' : '创建部队'}失败: ${requestError.message}`);
    } finally {
      setTemplateActionId('');
    }
  };

  const deleteTemplate = async (template) => {
    const templateId = typeof template?.templateId === 'string' ? template.templateId.trim() : '';
    if (!templateId || !token) return;
    if (!window.confirm(`确认删除部队「${getTroopDisplayName(template)}」？`)) return;

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
    <div className="army-panel">
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
                {unitsWithCount.map((unit) => (
                  <article className="army-unit-card army-unit-card-library" key={`library-${unit.id}`}>
                    <div className="army-unit-head">
                      <h3>{unit.name}</h3>
                      <div className="army-unit-head-right">
                        <span>{unit.roleTag}</span>
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
                      <span>射程 {unit.range}</span>
                      <span>{`职业 ${unit.professionId || '-'}`}</span>
                    </div>
                    <p className="army-equipment-desc">{buildUnitIntro(unit)}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : activeBarracksTab === 'troops' ? (
        <div className="army-troop-workspace">
          <section className="army-troop-section">
            <div className="army-troop-toolbar">
              <div className="army-troop-title">
                <h3>我的部队</h3>
                <span>{`已编组 ${templates.length} 支`}</span>
              </div>
              <button type="button" className="btn btn-primary btn-small" onClick={openTemplateCreate}>
                新增部队
              </button>
            </div>
            {templates.length <= 0 ? (
              <div className="army-preview-empty">暂无部队</div>
            ) : (
              <div className="army-troop-grid">
                {templates.map((template) => {
                  const templateId = getTemplateId(template);
                  const summary = unitsToSummaryText(template?.units || [], unitNameByTypeId);
                  const rowBusy = templateActionId === templateId || templateActionId === '__create__';
                  const active = activeTemplate && getTemplateId(activeTemplate) === templateId;
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
                          <span>{`总兵力 ${Math.max(0, Math.floor(Number(template?.totalCount) || 0))}`}</span>
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
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="army-troop-detail-panel">
            {activeTemplate ? (
              <>
                <div className="army-troop-detail-head">
                  <div>
                    <h3>{getTroopDisplayName(activeTemplate)}</h3>
                    <span>{`总兵力 ${activeTemplateStats.total}`}</span>
                  </div>
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => openTemplateEdit(activeTemplate)}>
                    编辑
                  </button>
                </div>
                <div className="army-troop-stat-grid">
                  <div><span>速度</span><strong>{activeTemplateStats.speed}</strong></div>
                  <div><span>生命</span><strong>{activeTemplateStats.hp}</strong></div>
                  <div><span>攻击</span><strong>{activeTemplateStats.atk}</strong></div>
                  <div><span>防御</span><strong>{activeTemplateStats.def}</strong></div>
                  <div><span>射程</span><strong>{activeTemplateStats.range}</strong></div>
                </div>
                <div className="army-troop-composition">
                  {activeTemplateCompositionRows.length <= 0 ? (
                    <div className="army-preview-empty">无兵种配置</div>
                  ) : activeTemplateCompositionRows.map((row) => (
                    <div key={`detail-${row.unitTypeId}`} className="army-troop-composition-row">
                      <i style={{ background: row.classMeta.color }} />
                      <span>{row.unitName}</span>
                      <em>{row.classMeta.label}</em>
                      <strong>{row.count}</strong>
                    </div>
                  ))}
                </div>
                <div className="army-troop-formation-list">
                  <div className="army-formation-panel-title">阵型</div>
                  {activeTemplateFormationSummaries.length <= 0 ? (
                    <div className="army-preview-empty">无阵型</div>
                  ) : activeTemplateFormationSummaries.map((formation) => (
                    <div key={`detail-formation-${formation.id}`} className={`army-template-preview-formation ${formation.legal ? 'is-legal' : ''}`}>
                      <strong>{formation.name}</strong>
                      <span>{formation.legal ? '合法' : '未完成'}</span>
                      <em>{`${formation.totalPlaced}/${activeTemplateStats.total}`}</em>
                      <FormationMiniPreview
                        formation={formation}
                        unitTypeMap={unitTypeMap}
                        className="is-static is-compact"
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="army-preview-empty">暂无部队</div>
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
                  const classMeta = resolveUnitClassMeta(unit);
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
                        <span>射程 {unit.range}</span>
                        <span>{`库存 ${unit.count}`}</span>
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
                  {`${detailUnit.roleTag || '未知'} ｜ ${detailUnit.rpsType || '-'} ｜ ${detailUnit.professionId || '-'} ｜ T${Math.max(1, Number(detailUnit.tier) || 1)}`}
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
              <div><span>射程</span><strong>{Number(detailUnit.range) || 0}</strong></div>
              <div><span>单价</span><strong>{Number(detailUnit.costKP) || 0}</strong></div>
              <div><span>库存</span><strong>{Number(detailUnit.count) || 0}</strong></div>
              <div><span>升级到</span><strong>{detailUnit.nextUnitTypeId || '无'}</strong></div>
            </div>

            <div className="army-unit-detail-intro">
              <strong>组件装配</strong>
              <p>
                {`body=${detailUnit.bodyId || '-'} ｜ weapon=${(detailUnit.weaponIds || []).join(', ') || '-'} ｜ vehicle=${detailUnit.vehicleId || '-'} ｜ ability=${(detailUnit.abilityIds || []).join(', ') || '-'} ｜ behavior=${detailUnit.behaviorProfileId || '-'} ｜ stability=${detailUnit.stabilityProfileId || '-'}`}
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
        <div className="army-template-editor-overlay" onClick={closeTemplateEditor}>
          <div
            className="army-template-editor-modal"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="army-template-editor-head">
              <div>
                <h4>{templateEditingId ? '编辑部队' : '新建部队'}</h4>
                <span>{`基础数 ${templateEditorTotal}/${ARMY_FORMATION_MAX_CELLS} ｜ 合法阵型 ${templateEditorLegalFormationCount}/${templateEditorFormations.length}`}</span>
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
            <div className="army-template-stepper" role="tablist" aria-label="新建部队步骤">
              {ARMY_EDITOR_STEPS.map((step, index) => {
                const label = step === 'units' ? '兵种' : (step === 'formations' ? '阵型' : '预览');
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
              <span>部队名称</span>
              <input
                type="text"
                maxLength={32}
                value={templateEditorDraft.name || ''}
                placeholder="新建部队1"
                onChange={(event) => setTemplateEditorDraft((prev) => ({ ...prev, name: event.target.value || '' }))}
              />
            </label>
            {templateEditorStep === 'units' ? (
              <div className="army-unit-selection-stage">
                <aside className="army-formation-unit-list">
                  <div className="army-formation-panel-title">可选兵种</div>
                  {templateEditorAvailableRows.map((row) => {
                    const picked = templateEditorBasisRows.some((item) => item.unitTypeId === row.unitTypeId);
                    const classMeta = resolveUnitClassMeta(row.unit);
                    const addBlocked = !picked && templateEditorTotal >= ARMY_MAX_UNIT_BASIS;
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
                          <em>{picked ? '已选择' : classMeta.label}</em>
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
                  <div className="army-formation-panel-title">上阵兵种</div>
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
                            <span>基础数</span>
                            <div className="army-unit-basis-range-control">
                              <input
                                type="range"
                                min={1}
                                max={ARMY_MAX_UNIT_BASIS}
                                step={1}
                                value={row.basis}
                                aria-label={`${row.unitName}基础数`}
                                onChange={(event) => handleChangeEditorUnitBasis(row.unitTypeId, event.target.value)}
                              />
                              <output>{row.basis}</output>
                            </div>
                          </label>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <aside className="army-template-troop-info-panel">
                  <div className="army-formation-panel-title">部队信息</div>
                  <div className="army-template-troop-info-head">
                    <strong>{templateEditorDraft.name || '新建部队'}</strong>
                    <span>{templateEditorSummary || '尚未配置兵种'}</span>
                  </div>
                  <div className="army-template-troop-info-stats">
                    <div><span>基础数</span><strong>{`${templateEditorTotal}/${ARMY_FORMATION_MAX_CELLS}`}</strong></div>
                    <div><span>兵种</span><strong>{templateEditorBasisRows.length}</strong></div>
                    <div><span>合法阵型</span><strong>{`${templateEditorLegalFormationCount}/${templateEditorFormations.length}`}</strong></div>
                    <div><span>平均速度</span><strong>{templateEditorPreviewStats.speed}</strong></div>
                    <div><span>生命</span><strong>{templateEditorPreviewStats.hp}</strong></div>
                    <div><span>攻击</span><strong>{templateEditorPreviewStats.atk}</strong></div>
                    <div><span>防御</span><strong>{templateEditorPreviewStats.def}</strong></div>
                    <div><span>射程</span><strong>{templateEditorPreviewStats.range}</strong></div>
                  </div>
                  <div className="army-template-troop-info-compose">
                    {templateEditorBasisRows.length <= 0 ? (
                      <div className="army-preview-empty">从左侧添加兵种后汇总部队信息。</div>
                    ) : templateEditorBasisRows.map((row) => (
                      <div key={`info-compose-${row.unitTypeId}`} className="army-troop-composition-row">
                        <i style={{ background: row.classMeta.color }} />
                        <span>{row.unitName}</span>
                        <em>{formatPercentTenths(row.percentTenths)}</em>
                        <strong>{row.basis}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="army-template-skill-placeholder">
                    <strong>部队技能树</strong>
                    <span>预留区域</span>
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
                      <div><span>射程</span><strong>{Number(templateEditorDetailUnit.range) || 0}</strong></div>
                      <div><span>库存</span><strong>{Number(templateEditorDetailUnit.count) || 0}</strong></div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {templateEditorStep === 'formations' ? (
              <div className="army-formation-build-stage">
                <div className="army-formation-selected-strip">
                  {templateEditorActiveUnitRows.map((row) => (
                    <button
                      key={`active-unit-${row.unitTypeId}`}
                      type="button"
                      className={`army-formation-top-unit ${templateEditorSelectedUnitId === row.unitTypeId ? 'is-selected' : ''} ${row.remaining <= 0 ? 'is-depleted' : ''}`}
                      draggable={row.remaining > 0}
                      onDragStart={(event) => {
                        event.dataTransfer?.setData('application/x-army-unit-type-id', row.unitTypeId);
                        event.dataTransfer?.setData('text/plain', row.unitTypeId);
                        setTemplateEditorSelectedUnitId(row.unitTypeId);
                        setTemplateEditorSelectedPlacementId('');
                        setTemplateEditorSelectedPlacementIds([]);
                        setTemplateEditorMoveSelectionIds([]);
                      }}
                      onClick={() => {
                        setTemplateEditorSelectedUnitId(row.unitTypeId);
                        setTemplateEditorSelectedPlacementId('');
                        setTemplateEditorSelectedPlacementIds([]);
                        setTemplateEditorMoveSelectionIds([]);
                      }}
                    >
                      <i style={{ background: row.classMeta.color }} />
                      <strong>{row.unitName}</strong>
                      <span>{formatPercentTenths(row.percentTenths)}</span>
                      <em>{row.remaining}</em>
                    </button>
                  ))}
                </div>
                <div className="army-formation-build-layout">
                  <aside className="army-formation-slot-panel">
                    <div className="army-formation-slot-head">
                      <span>阵型栏</span>
                      <button type="button" className="btn btn-secondary btn-small" onClick={handleAddFormationSlot}>新增阵型</button>
                    </div>
                    <div className="army-formation-slot-list">
                      {templateEditorFormationSummaries.map((formation) => (
                        <article
                          key={`formation-slot-${formation.id}`}
                          className={`army-formation-slot-card ${formation.id === templateEditorActiveFormation?.id ? 'is-active' : ''} ${formation.legal ? 'is-legal' : ''}`}
                          onClick={() => {
                            setTemplateEditorActiveFormationId(formation.id);
                            setTemplateEditorSelectedPlacementId('');
                            setTemplateEditorSelectedPlacementIds([]);
                            setTemplateEditorMoveSelectionIds([]);
                          }}
                        >
                          <input
                            type="text"
                            value={formation.name}
                            maxLength={24}
                            onChange={(event) => handleRenameFormationSlot(formation.id, event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                          />
                          <span>{`${formation.totalPlaced}/${templateEditorTotal}`}</span>
                          <FormationMiniPreview formation={formation} unitTypeMap={unitTypeMap} />
                          <button
                            type="button"
                            className="btn btn-warning btn-small"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteFormationSlot(formation.id);
                            }}
                          >
                            删除
                          </button>
                        </article>
                      ))}
                    </div>
                  </aside>
                  <section className="army-formation-stage-panel">
                    <div className="army-formation-panel-title">{templateEditorActiveFormation?.name || '阵型画布'}</div>
                    <div className="army-formation-canvas-shell is-adaptive">
                      <ArmyFormationThreeEditor
                        unitTypes={unitTypes}
                        placements={templateEditorPlacements}
                        selectedUnitTypeId={templateEditorSelectedUnitId}
                        selectedPlacementId={templateEditorSelectedPlacementId}
                        selectedPlacementIds={templateEditorSelectedPlacementIds}
                        isMoveSelectionMode={templateEditorMoveSelectionIds.length > 0}
                        onPlaceUnit={handlePlaceFormationUnit}
                        onChangePlacements={handleChangeFormationPlacements}
                        onMovePlacement={handleMoveFormationPlacement}
                        onSelectPlacement={handleSelectFormationPlacement}
                        onSelectPlacements={handleSelectFormationPlacements}
                        onCancelAction={handleCancelFormationCanvasAction}
                        onBeginMoveSelection={handleBeginMoveFormationSelection}
                        onDeleteSelection={handleDeleteFormationSelection}
                        onMoveSelectionToCell={handleMoveFormationSelectionToCell}
                        unitBasis={templateEditorBasisRows}
                        canPlaceUnit={canPlaceFormationUnit}
                        className="army-formation-canvas"
                      />
                      <div className="army-formation-dimension-badge">
                        {`${templateEditorOccupancyMetrics.width}×${templateEditorOccupancyMetrics.height}`}
                      </div>
                      <div className="army-formation-canvas-hint">
                        {templateEditorSelectedUnitId
                          ? `放置模式：${unitNameByTypeId.get(templateEditorSelectedUnitId) || templateEditorSelectedUnitId}`
                          : (templateEditorMoveSelectionIds.length > 0
                            ? `移动模式：${templateEditorMoveSelectionIds.length} 个`
                            : (templateEditorSelectedPlacements.length > 0
                              ? `已选中 ${templateEditorSelectedPlacements.length} 个`
                              : '默认模式'))}
                      </div>
                    </div>
                    <div className="army-formation-selected-actions">
                      <button type="button" className="btn btn-secondary btn-small" onClick={handleUndoFormation}>
                        撤销
                      </button>
                      <button type="button" className="btn btn-secondary btn-small" onClick={handleClearFormation}>
                        清空
                      </button>
                      <span>{templateEditorSelectedPlacements.length > 0 ? `选区 ${templateEditorSelectedPlacements.length} 个` : '合法阵型需要把上方所有剩余基础数用光。'}</span>
                    </div>
                  </section>
                </div>
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
                        <strong>{row.basis}</strong>
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
                    <div><span>射程</span><strong>{templateEditorPreviewStats.range}</strong></div>
                  </div>
                </section>
                <section className="army-template-preview-section">
                  <div className="army-formation-panel-title">阵型列表</div>
                  <div className="army-template-preview-formations">
                    {templateEditorFormationSummaries.map((formation) => (
                      <div key={`preview-formation-${formation.id}`} className={`army-template-preview-formation ${formation.legal ? 'is-legal' : ''}`}>
                        <strong>{formation.name}</strong>
                        <span>{formation.legal ? '合法' : '未完成'}</span>
                        <em>{`${formation.totalPlaced}/${templateEditorTotal}`}</em>
                        <FormationMiniPreview
                          formation={formation}
                          unitTypeMap={unitTypeMap}
                          className="is-static"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
            <div className="army-template-editor-summary">
              {`基础数 ${templateEditorTotal}/${ARMY_MAX_UNIT_BASIS}${templateEditorSummary ? ` ｜ ${templateEditorSummary}` : ''}`}
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
                {templateActionId ? '保存中...' : (templateEditorStep === 'preview' ? (templateEditingId ? '保存部队' : '创建部队') : '下一步')}
              </button>
            </div>
          </div>
        </div>
      )}
      {armyToasts.length > 0 ? (
        <div className="army-toast-stack" aria-live="polite">
          {armyToasts.map((toast) => (
            <div key={toast.id} className={`army-toast army-toast-${toast.type}`}>
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default ArmyPanel;
