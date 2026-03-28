import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFENDER_FORMATION_METRIC_BUDGET,
  DEFENDER_OVERLAP_RATIO,
  DEFENDER_OVERLAP_ALLOWANCE,
  DEFENDER_DEFAULT_FACING_DEG,
  normalizeDefenderUnits,
  normalizeDefenderFacingDeg,
  sanitizeDefenderDeployments,
  resolveDefenderFootprintScaleByCount
} from './battlefieldShared';
import {
  createFormationVisualState,
  reconcileCounts,
  getFormationFootprint
} from '../../../game/formation/ArmyFormationRenderer';

const useDefenderDeployment = ({
  defenderDeployments = [],
  setDefenderDeployments,
  defenderRosterMap = new Map(),
  deployedDefenderCountMap = new Map(),
  defenderDeploymentRows = [],
  defenderStockRows = [],
  defenderUnitTypesForFormation = [],
  defenderFormationStateRef,
  fieldWidth,
  fieldHeight,
  defenderZoneMinX,
  effectiveCanEdit = false,
  editMode = false,
  walls = [],
  persistBattlefieldLayout,
  cancelGhostPlacement,
  setHasDraftChanges,
  setMessage,
  setSelectedWallId,
  setSidebarTab,
  mouseWorldRef
}) => {
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('');
  const [activeDefenderMoveId, setActiveDefenderMoveId] = useState('');
  const [defenderDragPreview, setDefenderDragPreview] = useState(null);
  const [defenderEditorOpen, setDefenderEditorOpen] = useState(false);
  const [defenderEditingDeployId, setDefenderEditingDeployId] = useState('');
  const [defenderEditorDraft, setDefenderEditorDraft] = useState({
    name: '',
    sortOrder: 1,
    units: []
  });
  const [defenderQuantityDialog, setDefenderQuantityDialog] = useState({
    open: false,
    unitTypeId: '',
    unitName: '',
    max: 0,
    current: 0
  });

  const selectedDefenderDeployment = useMemo(
    () => defenderDeploymentRows.find((item) => item.deployId === selectedDeploymentId) || null,
    [defenderDeploymentRows, selectedDeploymentId]
  );
  const defenderEditorUsedMap = useMemo(() => {
    const map = new Map();
    normalizeDefenderUnits(defenderEditorDraft?.units || []).forEach((entry) => {
      map.set(entry.unitTypeId, entry.count);
    });
    return map;
  }, [defenderEditorDraft?.units]);
  const defenderEditorAvailableRows = useMemo(() => (
    defenderStockRows.map((row) => {
      const draftUsed = defenderEditorUsedMap.get(row.unitTypeId) || 0;
      const available = Math.max(0, row.remaining + draftUsed);
      return {
        ...row,
        draftUsed,
        available
      };
    })
  ), [defenderEditorUsedMap, defenderStockRows]);
  const defenderEditorTotalCount = useMemo(
    () => normalizeDefenderUnits(defenderEditorDraft?.units || []).reduce((sum, entry) => sum + entry.count, 0),
    [defenderEditorDraft?.units]
  );
  const defenderEditorUnits = useMemo(
    () => normalizeDefenderUnits(defenderEditorDraft?.units || []),
    [defenderEditorDraft?.units]
  );

  const resolveDefenderAvailableCount = useCallback((unitTypeId, draftUnits = []) => {
    const safeUnitTypeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeUnitTypeId) return 0;
    const roster = defenderRosterMap.get(safeUnitTypeId);
    if (!roster) return 0;
    const deployed = deployedDefenderCountMap.get(safeUnitTypeId) || 0;
    const draftCurrent = normalizeDefenderUnits(draftUnits).find((entry) => entry.unitTypeId === safeUnitTypeId)?.count || 0;
    return Math.max(0, roster.count - deployed + draftCurrent);
  }, [defenderRosterMap, deployedDefenderCountMap]);

  const resolveDefenderDeploymentFootprint = useCallback((deploymentLike) => {
    const units = normalizeDefenderUnits(deploymentLike?.units, deploymentLike?.unitTypeId, deploymentLike?.count);
    if (units.length <= 0) return { radius: 16, width: 24, depth: 24 };
    const totalUnits = units.reduce((sum, entry) => sum + entry.count, 0);
    const countsByType = {};
    units.forEach((entry) => {
      countsByType[entry.unitTypeId] = (countsByType[entry.unitTypeId] || 0) + entry.count;
    });
    const deployId = typeof deploymentLike?.deployId === 'string' ? deploymentLike.deployId.trim() : '';
    const signature = Object.entries(countsByType)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh-Hans-CN'))
      .map(([unitTypeId, count]) => `${unitTypeId}:${count}`)
      .join('|');
    const cacheKey = `def_metric_${deployId || signature}`;
    const cameraState = {
      distance: 980,
      worldScale: 1,
      renderBudget: DEFENDER_FORMATION_METRIC_BUDGET,
      shape: 'grid',
      unitTypes: defenderUnitTypesForFormation
    };
    const cache = defenderFormationStateRef.current;
    let formationState = cache.get(cacheKey);
    if (!formationState) {
      formationState = createFormationVisualState({
        teamId: 'defender',
        formationId: cacheKey,
        countsByType,
        unitTypes: defenderUnitTypesForFormation,
        cameraState
      });
      cache.set(cacheKey, formationState);
    } else {
      reconcileCounts(formationState, countsByType, cameraState, Date.now());
    }
    const rawFootprint = getFormationFootprint(formationState);
    const scaleByCount = resolveDefenderFootprintScaleByCount(totalUnits);
    return {
      radius: Math.max(10, Number(rawFootprint?.radius || 16) * scaleByCount),
      width: Math.max(12, Number(rawFootprint?.width || 24) * scaleByCount),
      depth: Math.max(12, Number(rawFootprint?.depth || 24) * scaleByCount)
    };
  }, [
    defenderFormationStateRef,
    defenderUnitTypesForFormation
  ]);

  const resolveDefenderDeploymentRadius = useCallback((deploymentLike, fallback = 16) => {
    const footprint = resolveDefenderDeploymentFootprint(deploymentLike);
    return Math.max(9, (Number(footprint?.radius) || fallback) * 0.86);
  }, [resolveDefenderDeploymentFootprint]);

  const findDeploymentAtWorld = useCallback((worldPoint) => {
    const source = (Array.isArray(defenderDeployments) ? defenderDeployments : []).filter((item) => item?.placed !== false);
    let best = null;
    let bestDist = Infinity;
    source.forEach((item) => {
      const dx = (Number(item?.x) || 0) - worldPoint.x;
      const dy = (Number(item?.y) || 0) - worldPoint.y;
      const dist = Math.hypot(dx, dy);
      const pickRadius = Math.max(14, resolveDefenderDeploymentRadius(item, 16) * 0.95);
      if (dist < bestDist && dist <= pickRadius) {
        best = item;
        bestDist = dist;
      }
    });
    return best;
  }, [defenderDeployments, resolveDefenderDeploymentRadius]);

  const buildDefaultDefenderPoint = useCallback((excludeDeployId = '') => {
    const minX = defenderZoneMinX;
    const maxX = fieldWidth / 2;
    const source = Array.isArray(defenderDeployments) ? defenderDeployments : [];
    const movingTarget = excludeDeployId ? source.find((item) => item.deployId === excludeDeployId) : null;
    const movingRadius = resolveDefenderDeploymentRadius(movingTarget, 16);
    for (let i = 0; i < 40; i += 1) {
      const point = {
        x: minX + 16 + (Math.random() * Math.max(16, (maxX - minX - 32))),
        y: (-fieldHeight * 0.42) + (Math.random() * fieldHeight * 0.84)
      };
      const overlap = source.some((item) => {
        if (excludeDeployId && item.deployId === excludeDeployId) return false;
        const otherRadius = resolveDefenderDeploymentRadius(item, 16);
        const minDistance = Math.max(
          8,
          ((movingRadius + otherRadius) * DEFENDER_OVERLAP_RATIO) - DEFENDER_OVERLAP_ALLOWANCE
        );
        return Math.hypot((Number(item?.x) || 0) - point.x, (Number(item?.y) || 0) - point.y) < minDistance;
      });
      if (!overlap) return point;
    }
    return {
      x: minX + ((maxX - minX) * 0.55),
      y: 0
    };
  }, [
    defenderDeployments,
    defenderZoneMinX,
    fieldHeight,
    fieldWidth,
    resolveDefenderDeploymentRadius
  ]);

  const persistDefenderDeploymentsNow = useCallback((nextDeployments) => {
    persistBattlefieldLayout(walls, {
      silent: false,
      defenderDeployments: sanitizeDefenderDeployments(nextDeployments)
    });
  }, [persistBattlefieldLayout, walls]);

  const moveDefenderDeployment = useCallback((deployId, worldPoint) => {
    if (!effectiveCanEdit || !deployId) return false;
    const target = (Array.isArray(defenderDeployments) ? defenderDeployments : []).find((item) => item.deployId === deployId);
    if (!target) return false;
    if (worldPoint.x < defenderZoneMinX) {
      setMessage('守军仅可放置在右侧蓝色守方区域');
      return false;
    }
    const nextPoint = {
      x: Math.max(defenderZoneMinX, Math.min(fieldWidth / 2, worldPoint.x)),
      y: Math.max(-fieldHeight / 2, Math.min(fieldHeight / 2, worldPoint.y))
    };
    const nextRotation = normalizeDefenderFacingDeg(
      Number.isFinite(Number(worldPoint?.rotation)) ? Number(worldPoint.rotation) : target?.rotation
    );
    const targetRadius = resolveDefenderDeploymentRadius(target, 16);
    const overlap = (Array.isArray(defenderDeployments) ? defenderDeployments : []).some((item) => (
      item.deployId !== deployId
      && item?.placed !== false
      && Math.hypot((Number(item?.x) || 0) - nextPoint.x, (Number(item?.y) || 0) - nextPoint.y)
        < Math.max(
          8,
          ((targetRadius + resolveDefenderDeploymentRadius(item, 16)) * DEFENDER_OVERLAP_RATIO) - DEFENDER_OVERLAP_ALLOWANCE
        )
    ));
    if (overlap) {
      setMessage('守军部队点位过近，请稍微错开');
      return false;
    }
    const unitLimitMap = new Map(
      Array.from(defenderRosterMap.values()).map((row) => [row.unitTypeId, row.count])
    );
    const currentPlacedCounter = new Map();
    (Array.isArray(defenderDeployments) ? defenderDeployments : []).forEach((item) => {
      if (!item || item.deployId === deployId || item?.placed === false) return;
      normalizeDefenderUnits(item?.units, item?.unitTypeId, item?.count).forEach((entry) => {
        currentPlacedCounter.set(entry.unitTypeId, (currentPlacedCounter.get(entry.unitTypeId) || 0) + entry.count);
      });
    });
    const nextTargetUnits = normalizeDefenderUnits(target?.units, target?.unitTypeId, target?.count);
    for (const entry of nextTargetUnits) {
      const maxCount = unitLimitMap.get(entry.unitTypeId) || 0;
      const nextCount = (currentPlacedCounter.get(entry.unitTypeId) || 0) + entry.count;
      if (nextCount > maxCount) {
        const unitName = defenderRosterMap.get(entry.unitTypeId)?.unitName || entry.unitTypeId;
        setMessage(`兵力不足：${unitName} 可部署 ${maxCount}，当前尝试部署 ${nextCount}`);
        return false;
      }
    }
    const nextDeployments = sanitizeDefenderDeployments(defenderDeployments).map((item) => (
      item.deployId === deployId
        ? { ...item, placed: true, x: nextPoint.x, y: nextPoint.y, rotation: nextRotation }
        : item
    ));
    setDefenderDeployments(nextDeployments);
    if (editMode) {
      setHasDraftChanges(true);
      setMessage('守军部队位置已更新');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage('守军部队位置已更新并保存');
    }
    return true;
  }, [
    defenderDeployments,
    defenderRosterMap,
    defenderZoneMinX,
    editMode,
    effectiveCanEdit,
    fieldHeight,
    fieldWidth,
    persistDefenderDeploymentsNow,
    resolveDefenderDeploymentRadius,
    setDefenderDeployments,
    setHasDraftChanges,
    setMessage
  ]);

  const resolveDefenderMovePreview = useCallback((deployId, worldPoint) => {
    if (!deployId || !worldPoint) return null;
    const source = sanitizeDefenderDeployments(defenderDeployments);
    const target = source.find((item) => item.deployId === deployId);
    if (!target) return null;
    const rawX = Number(worldPoint?.x) || 0;
    const rawY = Number(worldPoint?.y) || 0;
    const nextPoint = {
      x: Math.max(-fieldWidth / 2, Math.min(fieldWidth / 2, rawX)),
      y: Math.max(-fieldHeight / 2, Math.min(fieldHeight / 2, rawY))
    };
    const nextRotation = normalizeDefenderFacingDeg(
      Number.isFinite(Number(worldPoint?.rotation)) ? Number(worldPoint.rotation) : target?.rotation
    );
    const targetRadius = resolveDefenderDeploymentRadius(target, 16);
    const overlap = source.some((item) => (
      item.deployId !== deployId
      && item?.placed !== false
      && Math.hypot((Number(item?.x) || 0) - nextPoint.x, (Number(item?.y) || 0) - nextPoint.y)
        < Math.max(
          8,
          ((targetRadius + resolveDefenderDeploymentRadius(item, 16)) * DEFENDER_OVERLAP_RATIO) - DEFENDER_OVERLAP_ALLOWANCE
        )
    ));
    const outsideZone = rawX < defenderZoneMinX;
    return {
      deployId,
      x: nextPoint.x,
      y: nextPoint.y,
      rotation: nextRotation,
      blocked: outsideZone || overlap,
      reason: outsideZone ? 'zone' : (overlap ? 'overlap' : '')
    };
  }, [
    defenderDeployments,
    defenderZoneMinX,
    fieldHeight,
    fieldWidth,
    resolveDefenderDeploymentRadius
  ]);

  const openDefenderEditor = useCallback(() => {
    if (!effectiveCanEdit) return;
    if (defenderEditorAvailableRows.length <= 0 || defenderEditorAvailableRows.every((row) => row.available <= 0)) {
      setMessage('当前门向尚未配置守军兵力，无法编辑守军部队');
      return;
    }
    const highestSortOrder = defenderDeploymentRows.reduce(
      (max, item) => Math.max(max, Math.max(1, Math.floor(Number(item?.sortOrder) || 1))),
      0
    );
    const nextSortOrder = highestSortOrder + 1;
    setDefenderEditorDraft({
      name: '',
      sortOrder: nextSortOrder,
      units: []
    });
    setDefenderEditingDeployId('');
    setSidebarTab('defender');
    setDefenderEditorOpen(true);
  }, [defenderDeploymentRows, defenderEditorAvailableRows, effectiveCanEdit, setMessage, setSidebarTab]);

  const startEditDefenderDeployment = useCallback((deployId) => {
    const safeDeployId = typeof deployId === 'string' ? deployId.trim() : '';
    if (!effectiveCanEdit || !safeDeployId) return;
    const source = sanitizeDefenderDeployments(defenderDeployments);
    const target = source.find((item) => item.deployId === safeDeployId);
    if (!target) return;
    const wasPlaced = target.placed !== false;
    const nextDeployments = source.map((item) => (
      item.deployId === safeDeployId
        ? { ...item, placed: false }
        : item
    ));
    const draftUnits = normalizeDefenderUnits(target?.units, target?.unitTypeId, target?.count);
    setDefenderDeployments(nextDeployments);
    setSelectedDeploymentId(safeDeployId);
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    setSelectedWallId('');
    cancelGhostPlacement('');
    setDefenderEditingDeployId(safeDeployId);
    setDefenderEditorDraft({
      name: typeof target?.name === 'string' ? target.name : '',
      sortOrder: Math.max(1, Math.floor(Number(target?.sortOrder) || 1)),
      units: draftUnits
    });
    setSidebarTab('defender');
    setDefenderEditorOpen(true);
    if (editMode) {
      setHasDraftChanges(true);
      setMessage(wasPlaced
        ? '已从战场撤回该守军部队，可重新编辑编制'
        : '已打开守军部队编辑');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage(wasPlaced
        ? '已从战场撤回该守军部队并保存，可重新编辑编制'
        : '已打开守军部队编辑');
    }
  }, [
    cancelGhostPlacement,
    defenderDeployments,
    editMode,
    effectiveCanEdit,
    persistDefenderDeploymentsNow,
    setDefenderDeployments,
    setHasDraftChanges,
    setMessage,
    setSelectedWallId,
    setSidebarTab
  ]);

  const closeDefenderEditor = useCallback(() => {
    setDefenderEditorOpen(false);
    setDefenderEditingDeployId('');
    setDefenderQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 0
    });
  }, []);

  const openDefenderQuantityDialog = useCallback((unitTypeId) => {
    const safeUnitTypeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeUnitTypeId) return;
    const available = resolveDefenderAvailableCount(safeUnitTypeId, defenderEditorDraft?.units || []);
    if (available <= 0) {
      setMessage('该兵种可分配数量不足');
      return;
    }
    const current = normalizeDefenderUnits(defenderEditorDraft?.units || [])
      .find((entry) => entry.unitTypeId === safeUnitTypeId)?.count || 0;
    const unitName = defenderRosterMap.get(safeUnitTypeId)?.unitName || safeUnitTypeId;
    setDefenderQuantityDialog({
      open: true,
      unitTypeId: safeUnitTypeId,
      unitName,
      max: Math.max(1, available),
      current: Math.max(1, Math.min(available, current || 1))
    });
  }, [defenderEditorDraft?.units, defenderRosterMap, resolveDefenderAvailableCount, setMessage]);

  const removeDraftUnit = useCallback((unitTypeId) => {
    const safeUnitTypeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeUnitTypeId) return;
    setDefenderEditorDraft((prev) => ({
      ...prev,
      units: normalizeDefenderUnits(prev?.units || []).filter((entry) => entry.unitTypeId !== safeUnitTypeId)
    }));
  }, []);

  const confirmDefenderQuantityDialog = useCallback((qty) => {
    const unitTypeId = typeof defenderQuantityDialog?.unitTypeId === 'string' ? defenderQuantityDialog.unitTypeId.trim() : '';
    if (!unitTypeId) {
      setDefenderQuantityDialog((prev) => ({ ...prev, open: false }));
      return;
    }
    const max = Math.max(1, Math.floor(Number(defenderQuantityDialog?.max) || 1));
    const safeQty = Math.max(1, Math.min(max, Math.floor(Number(qty) || 1)));
    setDefenderEditorDraft((prev) => {
      const nextUnits = normalizeDefenderUnits(prev?.units || []);
      const idx = nextUnits.findIndex((entry) => entry.unitTypeId === unitTypeId);
      if (idx >= 0) {
        nextUnits[idx] = { ...nextUnits[idx], count: safeQty };
      } else {
        nextUnits.push({ unitTypeId, count: safeQty });
      }
      return { ...prev, units: normalizeDefenderUnits(nextUnits) };
    });
    setDefenderQuantityDialog({
      open: false,
      unitTypeId: '',
      unitName: '',
      max: 0,
      current: 0
    });
  }, [defenderQuantityDialog]);

  const saveDefenderEditor = useCallback(() => {
    if (!effectiveCanEdit) return;
    const draftUnits = normalizeDefenderUnits(defenderEditorDraft?.units || []);
    if (draftUnits.length <= 0) {
      setMessage('请至少添加一个兵种后再创建守军部队');
      return;
    }
    const totalCount = draftUnits.reduce((sum, entry) => sum + entry.count, 0);
    if (totalCount <= 0) {
      setMessage('守军部队总兵力必须大于 0');
      return;
    }
    const point = buildDefaultDefenderPoint('');
    const fallbackName = `守军部队${defenderDeploymentRows.length + 1}`;
    const teamName = (typeof defenderEditorDraft?.name === 'string' && defenderEditorDraft.name.trim())
      ? defenderEditorDraft.name.trim()
      : fallbackName;
    const sortOrder = Math.max(1, Math.floor(Number(defenderEditorDraft?.sortOrder) || (defenderDeploymentRows.length + 1)));
    const editingDeployId = typeof defenderEditingDeployId === 'string' ? defenderEditingDeployId.trim() : '';
    if (editingDeployId) {
      const source = sanitizeDefenderDeployments(defenderDeployments);
      const target = source.find((item) => item.deployId === editingDeployId);
      if (target) {
        const nextDeployments = source.map((item) => (
          item.deployId === editingDeployId
            ? {
              ...item,
              name: teamName,
              sortOrder,
              placed: false,
              units: draftUnits,
              unitTypeId: draftUnits[0].unitTypeId,
              count: draftUnits[0].count
            }
            : item
        ));
        setDefenderDeployments(nextDeployments);
        if (editMode) setHasDraftChanges(true);
        else persistDefenderDeploymentsNow(nextDeployments);
        setSelectedDeploymentId(editingDeployId);
        setDefenderEditorOpen(false);
        setDefenderEditingDeployId('');
        setDefenderEditorDraft({
          name: '',
          sortOrder: sortOrder + 1,
          units: []
        });
        setMessage(editMode
          ? `已更新守军部队：${teamName}（${totalCount}）`
          : `已更新守军部队并保存：${teamName}（${totalCount}）`);
        return;
      }
      setDefenderEditingDeployId('');
    }
    const nextDeployment = {
      deployId: `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: teamName,
      sortOrder,
      placed: false,
      rotation: DEFENDER_DEFAULT_FACING_DEG,
      units: draftUnits,
      unitTypeId: draftUnits[0].unitTypeId,
      count: draftUnits[0].count,
      x: point.x,
      y: point.y
    };
    const nextDeployments = [...sanitizeDefenderDeployments(defenderDeployments), nextDeployment];
    setDefenderDeployments(nextDeployments);
    if (editMode) setHasDraftChanges(true);
    else persistDefenderDeploymentsNow(nextDeployments);
    setSelectedDeploymentId(nextDeployment.deployId);
    setDefenderEditorOpen(false);
    setDefenderEditingDeployId('');
    setDefenderEditorDraft({
      name: '',
      sortOrder: sortOrder + 1,
      units: []
    });
    setMessage(editMode
      ? `已创建守军部队：${teamName}（${totalCount}），可拖到地图部署`
      : `已创建守军部队并保存：${teamName}（${totalCount}），可拖到地图部署`);
  }, [
    buildDefaultDefenderPoint,
    defenderDeploymentRows.length,
    defenderDeployments,
    defenderEditingDeployId,
    defenderEditorDraft,
    editMode,
    effectiveCanEdit,
    persistDefenderDeploymentsNow,
    setDefenderDeployments,
    setHasDraftChanges,
    setMessage
  ]);

  const removeDefenderDeployment = useCallback((deployId) => {
    if (!deployId) return;
    const nextDeployments = sanitizeDefenderDeployments(defenderDeployments).filter((item) => item.deployId !== deployId);
    setDefenderDeployments(nextDeployments);
    setSelectedDeploymentId('');
    if (editMode) {
      setHasDraftChanges(true);
      setMessage('守军部队已移除');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage('守军部队已移除并保存');
    }
  }, [
    defenderDeployments,
    editMode,
    persistDefenderDeploymentsNow,
    setDefenderDeployments,
    setHasDraftChanges,
    setMessage
  ]);

  const unplaceDefenderDeployment = useCallback((deployId) => {
    if (!deployId) return;
    const nextDeployments = sanitizeDefenderDeployments(defenderDeployments).map((item) => (
      item.deployId === deployId
        ? { ...item, placed: false }
        : item
    ));
    setDefenderDeployments(nextDeployments);
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    if (editMode) {
      setHasDraftChanges(true);
      setMessage('守军部队已从地图撤下');
    } else {
      persistDefenderDeploymentsNow(nextDeployments);
      setMessage('守军部队已从地图撤下并保存');
    }
  }, [
    defenderDeployments,
    editMode,
    persistDefenderDeploymentsNow,
    setDefenderDeployments,
    setHasDraftChanges,
    setMessage
  ]);

  const handleSelectDeploymentFromSidebar = useCallback((item) => {
    setSelectedDeploymentId(item.deployId);
    setSelectedWallId('');
    cancelGhostPlacement('');
    if (editMode && effectiveCanEdit) {
      const pickupPoint = {
        x: Number(mouseWorldRef.current?.x) || Number(item?.x) || 0,
        y: Number(mouseWorldRef.current?.y) || Number(item?.y) || 0,
        rotation: normalizeDefenderFacingDeg(item?.rotation)
      };
      const nextPreview = resolveDefenderMovePreview(item.deployId, pickupPoint) || {
        deployId: item.deployId,
        x: pickupPoint.x,
        y: pickupPoint.y,
        rotation: pickupPoint.rotation,
        blocked: pickupPoint.x < defenderZoneMinX,
        reason: pickupPoint.x < defenderZoneMinX ? 'zone' : ''
      };
      setActiveDefenderMoveId(item.deployId);
      setDefenderDragPreview(nextPreview);
      setMessage(
        item.placed !== false
          ? `已选中并拾取守军部队：${item.teamName}，鼠标左键在右侧蓝色区域放置`
          : `已拾取守军部队：${item.teamName}，鼠标左键在右侧蓝色区域放置`
      );
      return;
    }
    setActiveDefenderMoveId('');
    setDefenderDragPreview(null);
    setMessage(`已选中守军部队：${item.teamName}。请先点击“布置战场”再进行部署`);
  }, [
    cancelGhostPlacement,
    defenderZoneMinX,
    editMode,
    effectiveCanEdit,
    mouseWorldRef,
    resolveDefenderMovePreview,
    setMessage,
    setSelectedWallId
  ]);

  useEffect(() => {
    if (!selectedDeploymentId) return;
    const exists = (Array.isArray(defenderDeployments) ? defenderDeployments : []).some((item) => item.deployId === selectedDeploymentId);
    if (!exists) setSelectedDeploymentId('');
  }, [defenderDeployments, selectedDeploymentId]);

  useEffect(() => {
    if (!defenderEditorOpen) return;
    setDefenderEditorDraft((prev) => {
      const nextUnits = normalizeDefenderUnits(prev?.units || [])
        .map((entry) => {
          const max = resolveDefenderAvailableCount(entry.unitTypeId, prev?.units || []);
          if (max <= 0) return null;
          return {
            unitTypeId: entry.unitTypeId,
            count: Math.max(1, Math.min(max, entry.count))
          };
        })
        .filter(Boolean);
      return {
        ...prev,
        units: normalizeDefenderUnits(nextUnits)
      };
    });
  }, [defenderEditorOpen, resolveDefenderAvailableCount, defenderStockRows]);

  return {
    selectedDeploymentId,
    setSelectedDeploymentId,
    activeDefenderMoveId,
    setActiveDefenderMoveId,
    defenderDragPreview,
    setDefenderDragPreview,
    defenderEditorOpen,
    setDefenderEditorOpen,
    defenderEditingDeployId,
    setDefenderEditingDeployId,
    defenderEditorDraft,
    setDefenderEditorDraft,
    defenderEditorAvailableRows,
    defenderEditorTotalCount,
    defenderEditorUnits,
    defenderQuantityDialog,
    setDefenderQuantityDialog,
    selectedDefenderDeployment,
    resolveDefenderAvailableCount,
    resolveDefenderDeploymentRadius,
    findDeploymentAtWorld,
    moveDefenderDeployment,
    resolveDefenderMovePreview,
    openDefenderEditor,
    startEditDefenderDeployment,
    closeDefenderEditor,
    openDefenderQuantityDialog,
    removeDraftUnit,
    confirmDefenderQuantityDialog,
    saveDefenderEditor,
    removeDefenderDeployment,
    unplaceDefenderDeployment,
    handleSelectDeploymentFromSidebar
  };
};

export default useDefenderDeployment;
