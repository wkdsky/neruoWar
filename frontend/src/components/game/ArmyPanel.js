import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ArmyPanel.css';
import NumberPadDialog from '../common/NumberPadDialog';
import { API_BASE } from '../../runtimeConfig';
import normalizeUnitTypes from '../../game/unit/normalizeUnitTypes';
import {
  ArmyCloseupThreePreview,
  ArmyBattleImpostorPreview
} from './unit/ArmyUnitPreviewCanvases';
import {
  ArmyBattlefieldItemCloseupPreview,
  ArmyBattlefieldItemBattlePreview
} from './item/ArmyBattlefieldItemPreviewCanvases';

const QUICK_QTY_STEPS = [10, 50, 100, 500, 1000];
const TEMPLATE_MAX_COUNT = 999999999;

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

const getUnitId = (unit) => {
  const id = typeof unit?.id === 'string' ? unit.id.trim() : '';
  if (id) return id;
  return typeof unit?.unitTypeId === 'string' ? unit.unitTypeId.trim() : '';
};

const normalizeInteger = (value, fallback = 0, min = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.floor(num));
};

const normalizeTemplateUnits = (units = []) => (
  (Array.isArray(units) ? units : [])
    .map((entry) => ({
      unitTypeId: typeof entry?.unitTypeId === 'string' ? entry.unitTypeId.trim() : '',
      count: Math.max(0, Math.floor(Number(entry?.count) || 0))
    }))
    .filter((entry) => entry.unitTypeId && entry.count > 0)
);

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
      style: item?.style && typeof item.style === 'object' ? item.style : {}
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
  const [libraryTab, setLibraryTab] = useState(safeInitialLibraryTab);
  const [unitTypes, setUnitTypes] = useState([]);
  const [knowledgeBalance, setKnowledgeBalance] = useState(0);
  const [roster, setRoster] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [battlefieldItems, setBattlefieldItems] = useState([]);
  const [battlefieldItemsError, setBattlefieldItemsError] = useState('');
  const [styleModalItemId, setStyleModalItemId] = useState('');
  const [draftByUnit, setDraftByUnit] = useState({});
  const [cartByUnit, setCartByUnit] = useState({});
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [templateActionId, setTemplateActionId] = useState('');
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
  const [templateEditorDraft, setTemplateEditorDraft] = useState({ name: '', units: [] });
  const [templateEditorDragUnitId, setTemplateEditorDragUnitId] = useState('');
  const [templateQuantityDialog, setTemplateQuantityDialog] = useState({
    open: false,
    unitTypeId: '',
    unitName: '',
    max: 0,
    current: 1
  });

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

  const recruitedUnits = useMemo(
    () => unitsWithCount.filter((unit) => (Number(unit.count) || 0) > 0),
    [unitsWithCount]
  );

  const cartItems = useMemo(() => {
    return Object.entries(cartByUnit)
      .map(([unitTypeId, qty]) => {
        const normalizedQty = normalizeInteger(qty, 0, 0);
        if (normalizedQty <= 0) return null;
        const unit = unitTypeMap[unitTypeId];
        if (!unit) return null;
        const costKP = Number(unit.costKP) || 0;
        return {
          unitTypeId,
          unit,
          qty: normalizedQty,
          subtotalCost: costKP * normalizedQty
        };
      })
      .filter(Boolean);
  }, [cartByUnit, unitTypeMap]);

  const totalCost = useMemo(() => cartItems.reduce((sum, item) => sum + item.subtotalCost, 0), [cartItems]);
  const remainBalance = knowledgeBalance - totalCost;
  const isInsufficient = remainBalance < 0;

  const templateEditorAvailableRows = useMemo(() => (
    unitsWithCount
      .map((unit) => ({
        unitTypeId: unit.id,
        unitName: unit.name || unit.id,
        availableForDraft: TEMPLATE_MAX_COUNT,
        unlimited: true
      }))
      .sort((a, b) => a.unitName.localeCompare(b.unitName, 'zh-Hans-CN'))
  ), [unitsWithCount]);

  const templateEditorTotal = useMemo(
    () => normalizeTemplateUnits(templateEditorDraft.units).reduce((sum, entry) => sum + entry.count, 0),
    [templateEditorDraft.units]
  );

  const templateEditorSummary = useMemo(
    () => unitsToSummaryText(templateEditorDraft.units, unitNameByTypeId),
    [templateEditorDraft.units, unitNameByTypeId]
  );

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
        setError(getApiErrorMessage(templatesParsed, '加载模板失败'));
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
      setBattlefieldItems(nextBattlefieldItems);
      setBattlefieldItemsError(
        trainingInitResponse?.ok
          ? ''
          : getApiErrorMessage(trainingInitParsed, '加载战场设置物失败，请稍后重试')
      );
      setStyleModalItemId('');

      setDraftByUnit((prev) => {
        const next = { ...prev };
        nextUnitTypes.forEach((unit) => {
          const unitId = getUnitId(unit);
          if (unitId && !Object.prototype.hasOwnProperty.call(next, unitId)) {
            next[unitId] = '0';
          }
        });
        return next;
      });
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

  const getDraftQty = (unitTypeId) => normalizeInteger(draftByUnit[unitTypeId], 0, 0);

  const updateDraftByDelta = (unitTypeId, delta) => {
    setDraftByUnit((prev) => {
      const current = normalizeInteger(prev[unitTypeId], 0, 0);
      const nextQty = Math.max(0, current + delta);
      return {
        ...prev,
        [unitTypeId]: String(nextQty)
      };
    });
  };

  const addDraftToCart = (unit) => {
    const unitTypeId = unit.id;
    const draftQty = getDraftQty(unitTypeId);
    if (draftQty <= 0) {
      setError('请先设置大于 0 的征召数量');
      return;
    }

    setCartByUnit((prev) => ({
      ...prev,
      [unitTypeId]: normalizeInteger(prev[unitTypeId], 0, 0) + draftQty
    }));

    setDraftByUnit((prev) => ({
      ...prev,
      [unitTypeId]: '0'
    }));
    setError('');
  };

  const updateCartQty = (unitTypeId, nextQtyRaw) => {
    const nextQty = normalizeInteger(nextQtyRaw, 0, 0);
    setCartByUnit((prev) => {
      const next = { ...prev };
      if (nextQty <= 0) {
        delete next[unitTypeId];
      } else {
        next[unitTypeId] = nextQty;
      }
      return next;
    });
  };

  const removeCartItem = (unitTypeId) => {
    setCartByUnit((prev) => {
      const next = { ...prev };
      delete next[unitTypeId];
      return next;
    });
  };

  const handleCheckout = async () => {
    if (!token) {
      setError('未登录，无法结算');
      return;
    }
    if (cartItems.length === 0) {
      setError('征召预览为空，请先添加兵种');
      return;
    }
    if (isInsufficient) {
      setError('知识点不足，无法结算');
      return;
    }

    setCheckingOut(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/army/recruit/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          items: cartItems.map((item) => ({
            unitTypeId: item.unitTypeId,
            qty: item.qty
          }))
        })
      });

      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        setError(getApiErrorMessage(parsed, '结算失败'));
        return;
      }

      const nextRoster = Array.isArray(parsed.data?.roster) ? parsed.data.roster : [];
      const nextBalance = Number.isFinite(parsed.data?.knowledgeBalance)
        ? parsed.data.knowledgeBalance
        : knowledgeBalance;

      setRoster(nextRoster);
      setKnowledgeBalance(nextBalance);
      setCartByUnit({});
    } catch (requestError) {
      setError(`结算失败: ${requestError.message}`);
    } finally {
      setCheckingOut(false);
    }
  };

  const closeTemplateEditor = () => {
    setTemplateEditorOpen(false);
    setTemplateEditingId('');
    setTemplateEditorDragUnitId('');
    setTemplateEditorDraft({ name: '', units: [] });
    setTemplateQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 1
    });
  };

  const openTemplateCreate = () => {
    setTemplateNotice('');
    setTemplateEditorOpen(true);
    setTemplateEditingId('');
    setTemplateEditorDragUnitId('');
    setTemplateEditorDraft({ name: '', units: [] });
    setTemplateQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 1
    });
  };

  const openTemplateEdit = (template) => {
    if (!template) return;
    setTemplateNotice('');
    setTemplateEditorOpen(true);
    setTemplateEditingId(typeof template.templateId === 'string' ? template.templateId : '');
    setTemplateEditorDragUnitId('');
    setTemplateEditorDraft({
      name: typeof template.name === 'string' ? template.name : '',
      units: normalizeTemplateUnits(template.units)
    });
    setTemplateQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 1
    });
  };

  const resolveTemplateUnitMax = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return 0;
    const row = templateEditorAvailableRows.find((item) => item.unitTypeId === safeId);
    const baseMax = row?.unlimited
      ? TEMPLATE_MAX_COUNT
      : Math.max(0, Math.floor(Number(row?.availableForDraft) || 0));
    const existing = normalizeTemplateUnits(templateEditorDraft.units)
      .find((entry) => entry.unitTypeId === safeId)?.count || 0;
    return Math.min(TEMPLATE_MAX_COUNT, baseMax + existing);
  }, [templateEditorAvailableRows, templateEditorDraft.units]);

  const openTemplateQuantityDialog = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    const row = templateEditorAvailableRows.find((item) => item.unitTypeId === safeId);
    const max = resolveTemplateUnitMax(safeId);
    if (max <= 0) {
      setTemplateNotice('该兵种当前不可配置');
      return;
    }
    const current = normalizeTemplateUnits(templateEditorDraft.units).find((entry) => entry.unitTypeId === safeId)?.count || 1;
    setTemplateQuantityDialog({
      open: true,
      unitTypeId: safeId,
      unitName: row?.unitName || safeId,
      max,
      current: Math.max(1, Math.min(max, current))
    });
  }, [resolveTemplateUnitMax, templateEditorAvailableRows, templateEditorDraft.units]);

  const handleTemplateDrop = useCallback((event) => {
    event.preventDefault();
    const droppedUnitTypeId = event.dataTransfer?.getData('application/x-deploy-unit-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    setTemplateEditorDragUnitId('');
    openTemplateQuantityDialog(droppedUnitTypeId);
  }, [openTemplateQuantityDialog]);

  const handleConfirmTemplateQuantity = useCallback((qty) => {
    const safeId = typeof templateQuantityDialog?.unitTypeId === 'string' ? templateQuantityDialog.unitTypeId.trim() : '';
    if (!safeId) {
      setTemplateQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 });
      return;
    }
    const max = Math.max(1, Math.floor(Number(templateQuantityDialog.max) || 1));
    const safeQty = Math.max(1, Math.min(max, Math.floor(Number(qty) || 1)));
    setTemplateEditorDraft((prev) => {
      const source = normalizeTemplateUnits(prev?.units || []);
      const idx = source.findIndex((entry) => entry.unitTypeId === safeId);
      if (idx >= 0) {
        source[idx] = { ...source[idx], count: safeQty };
      } else {
        source.push({ unitTypeId: safeId, count: safeQty });
      }
      return { ...prev, units: normalizeTemplateUnits(source) };
    });
    setTemplateQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 });
  }, [templateQuantityDialog]);

  const handleRemoveTemplateUnit = (unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setTemplateEditorDraft((prev) => ({
      ...prev,
      units: normalizeTemplateUnits(prev?.units || []).filter((entry) => entry.unitTypeId !== safeId)
    }));
  };

  const submitTemplateEditor = async () => {
    if (!token) {
      setTemplateNotice('未登录，无法保存模板');
      return;
    }
    const units = normalizeTemplateUnits(templateEditorDraft.units);
    if (units.length <= 0) {
      setTemplateNotice('请至少添加一个兵种到模板');
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
            name: templateEditorDraft.name || '',
            units
          })
        }
      );
      const parsed = await parseApiResponse(response);
      if (!response.ok) {
        setTemplateNotice(getApiErrorMessage(parsed, isEditing ? '更新模板失败' : '创建模板失败'));
        return;
      }
      const nextTemplates = Array.isArray(parsed.data?.templates) ? parsed.data.templates : templates;
      setTemplates(nextTemplates);
      closeTemplateEditor();
      setTemplateNotice(isEditing ? '模板已更新' : '模板已创建');
    } catch (requestError) {
      setTemplateNotice(`${isEditing ? '更新模板' : '创建模板'}失败: ${requestError.message}`);
    } finally {
      setTemplateActionId('');
    }
  };

  const deleteTemplate = async (template) => {
    const templateId = typeof template?.templateId === 'string' ? template.templateId.trim() : '';
    if (!templateId || !token) return;
    if (!window.confirm(`确认删除模板「${template?.name || '未命名模板'}」？`)) return;

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
        setTemplateNotice(getApiErrorMessage(parsed, '删除模板失败'));
        return;
      }
      const nextTemplates = Array.isArray(parsed.data?.templates) ? parsed.data.templates : [];
      setTemplates(nextTemplates);
      if (templateEditingId === templateId) {
        closeTemplateEditor();
      }
      setTemplateNotice('模板已删除');
    } catch (requestError) {
      setTemplateNotice(`删除模板失败: ${requestError.message}`);
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

      {error && <div className="army-message army-message-error">{error}</div>}
      {!isLibraryMode && templateNotice && <div className="army-message army-message-info">{templateNotice}</div>}
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
              <span>仅展示兵种资料，征召请前往兵营</span>
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
      ) : (
        <div className="army-content">
          <div className="army-unit-grid">
            {unitsWithCount.map((unit) => {
              const unitId = unit.id;
              const draftQty = getDraftQty(unitId);
              const draftCost = draftQty * (Number(unit.costKP) || 0);

              return (
                <article className="army-unit-card" key={unitId}>
                  <div className="army-unit-head">
                    <h3>{unit.name}</h3>
                    <div className="army-unit-head-right">
                      <span>{unit.roleTag}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => {
                          setDetailUnitId(unitId);
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
                  </div>
                  <div className="army-unit-cost">单价：{unit.costKP} 知识点</div>

                  <div className="army-unit-actions">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={draftByUnit[unitId] ?? '0'}
                      onChange={(event) => {
                        const nextQty = normalizeInteger(event.target.value, 0, 0);
                        setDraftByUnit((prev) => ({
                          ...prev,
                          [unitId]: String(nextQty)
                        }));
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={draftQty <= 0}
                      onClick={() => addDraftToCart(unit)}
                    >
                      征召
                    </button>
                  </div>

                  <div className="army-step-group">
                    <div className="army-step-row plus">
                      {QUICK_QTY_STEPS.map((step) => (
                        <button
                          key={`plus-${unitId}-${step}`}
                          type="button"
                          className="army-step-btn"
                          onClick={() => updateDraftByDelta(unitId, step)}
                        >
                          +{step}
                        </button>
                      ))}
                    </div>
                    <div className="army-step-row minus">
                      {QUICK_QTY_STEPS.map((step) => (
                        <button
                          key={`minus-${unitId}-${step}`}
                          type="button"
                          className="army-step-btn"
                          onClick={() => updateDraftByDelta(unitId, -step)}
                        >
                          -{step}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="army-unit-foot">
                    <span>当前待征召：{draftQty}</span>
                    <span>预计消耗：{draftCost}</span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="army-side-panel">
            <aside className="army-preview-card">
              <h3>征召预览</h3>
              {cartItems.length === 0 ? (
                <div className="army-preview-empty">预览为空，请先点击各兵种的“征召”</div>
              ) : (
                <>
                  <div className="army-preview-list">
                    {cartItems.map((item) => (
                      <div className="army-preview-row" key={`preview-${item.unitTypeId}`}>
                        <span className="army-preview-name">{item.unit.name}</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={item.qty}
                          onChange={(event) => updateCartQty(item.unitTypeId, event.target.value)}
                        />
                        <span className="army-preview-cost">{item.subtotalCost}</span>
                        <button
                          type="button"
                          className="btn-action btn-delete"
                          onClick={() => removeCartItem(item.unitTypeId)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="army-preview-summary">
                    <div>总花费：<strong>{totalCost}</strong> 知识点</div>
                    <div className={isInsufficient ? 'army-insufficient' : ''}>
                      结算后剩余：<strong>{remainBalance}</strong> 知识点
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={checkingOut || cartItems.length === 0 || isInsufficient}
                    onClick={handleCheckout}
                  >
                    {checkingOut ? '结算中...' : '结算'}
                  </button>
                </>
              )}
            </aside>

            <aside className="army-roster-card">
              <h3>我的军团</h3>
              <div className="army-roster-list">
                {recruitedUnits.length <= 0 ? (
                  <div className="army-preview-empty">暂无已征召士兵</div>
                ) : recruitedUnits.map((unit) => (
                  <div className="army-roster-row" key={`roster-${unit.id}`}>
                    <span>{unit.name}</span>
                    <strong>{unit.count}</strong>
                  </div>
                ))}
              </div>
            </aside>

            <aside className="army-template-card">
              <div className="army-template-card-head">
                <h3>部队模板</h3>
                <button type="button" className="btn btn-primary btn-small" onClick={openTemplateCreate}>
                  新建模板
                </button>
              </div>
              {templates.length <= 0 ? (
                <div className="army-preview-empty">暂无模板，点击“新建模板”创建</div>
              ) : (
                <div className="army-template-list">
                  {templates.map((template) => {
                    const templateId = typeof template?.templateId === 'string' ? template.templateId : '';
                    const summary = unitsToSummaryText(template?.units || [], unitNameByTypeId);
                    const rowBusy = templateActionId === templateId || templateActionId === '__create__';
                    return (
                      <div key={templateId || Math.random()} className="army-template-row">
                        <div className="army-template-meta">
                          <strong>{template?.name || '未命名模板'}</strong>
                          <span>{`总兵力 ${Math.max(0, Math.floor(Number(template?.totalCount) || 0))}`}</span>
                          <em>{summary || '无兵种配置'}</em>
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
                    );
                  })}
                </div>
              )}
            </aside>
          </div>
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
                    <ArmyCloseupThreePreview
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
                    <ArmyBattleImpostorPreview
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
            <h4>{templateEditingId ? '编辑部队模板' : '新建部队模板'}</h4>
            <label>
              <span>模板名称</span>
              <input
                type="text"
                maxLength={32}
                value={templateEditorDraft.name || ''}
                placeholder="不填则自动命名"
                onChange={(event) => setTemplateEditorDraft((prev) => ({ ...prev, name: event.target.value || '' }))}
              />
            </label>
            <div className="army-template-editor-transfer">
              <div className="army-template-editor-col">
                <div className="army-template-editor-col-title">可用兵种（左侧）</div>
                {templateEditorAvailableRows.map((row) => (
                  <button
                    key={`template-left-${row.unitTypeId}`}
                    type="button"
                    className="army-template-unit-card"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer?.setData('application/x-deploy-unit-id', row.unitTypeId);
                      event.dataTransfer?.setData('text/plain', row.unitTypeId);
                      setTemplateEditorDragUnitId(row.unitTypeId);
                    }}
                    onDragEnd={() => setTemplateEditorDragUnitId('')}
                    onClick={() => openTemplateQuantityDialog(row.unitTypeId)}
                  >
                    <strong>{row.unitName}</strong>
                    <span>{row.unlimited ? '可用 ∞' : `可用 ${row.availableForDraft}`}</span>
                  </button>
                ))}
              </div>
              <div
                className={`army-template-editor-col army-template-editor-col-right ${templateEditorDragUnitId ? 'is-dropzone' : ''}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleTemplateDrop}
              >
                <div className="army-template-editor-col-title">模板编组（右侧）</div>
                {normalizeTemplateUnits(templateEditorDraft.units).length <= 0 ? (
                  <div className="army-template-editor-tip">拖拽左侧兵种到这里后，会弹出数量输入框。</div>
                ) : null}
                {normalizeTemplateUnits(templateEditorDraft.units).map((entry) => (
                  <div key={`template-right-${entry.unitTypeId}`} className="army-template-editor-row">
                    <span>{`${unitNameByTypeId.get(entry.unitTypeId) || entry.unitTypeId} x${entry.count}`}</span>
                    <div className="army-template-editor-row-actions">
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => openTemplateQuantityDialog(entry.unitTypeId)}>数量</button>
                      <button type="button" className="btn btn-warning btn-small" onClick={() => handleRemoveTemplateUnit(entry.unitTypeId)}>移除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="army-template-editor-summary">
              {`总兵力 ${templateEditorTotal}${templateEditorSummary ? ` ｜ ${templateEditorSummary}` : ''}`}
            </div>
            <div className="army-template-editor-actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={closeTemplateEditor}
                disabled={Boolean(templateActionId)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={submitTemplateEditor}
                disabled={templateEditorTotal <= 0 || Boolean(templateActionId)}
              >
                {templateActionId ? '保存中...' : '保存模板'}
              </button>
            </div>
          </div>
        </div>
      )}

      <NumberPadDialog
        open={templateEditorOpen && templateQuantityDialog.open}
        title={`设置兵力：${templateQuantityDialog.unitName || templateQuantityDialog.unitTypeId}`}
        description="可滑动或直接输入数量"
        min={1}
        max={Math.max(1, Math.floor(Number(templateQuantityDialog.max) || 1))}
        initialValue={Math.max(1, Math.floor(Number(templateQuantityDialog.current) || 1))}
        zIndex={36100}
        confirmLabel="确定"
        cancelLabel="取消"
        onCancel={() => setTemplateQuantityDialog({ open: false, unitTypeId: '', unitName: '', max: 0, current: 1 })}
        onConfirm={handleConfirmTemplateQuantity}
      />
    </div>
  );
};

export default ArmyPanel;
