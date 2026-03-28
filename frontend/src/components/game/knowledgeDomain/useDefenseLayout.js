import { useCallback, useState } from 'react';
import { API_BASE } from '../../../runtimeConfig';
import { getApiError, parseApiResponse } from './api';
import {
  CITY_BUILDING_CANDIDATE_POSITIONS,
  CITY_BUILDING_DEFAULT_RADIUS,
  CITY_BUILDING_LIMIT,
  CITY_GATE_KEYS,
  clampPositionInsideCity,
  cloneDefenseLayout,
  createDefaultDefenseLayoutState,
  createDefaultGateDeployState,
  defenseLayoutToPayload,
  getDeployedCountByUnitType,
  getGateDefenseEntries,
  isValidPlacement,
  normalizeBuildingCatalogFromApi,
  normalizeDefenseLayoutFromApi
} from './shared';

const createDefaultGateDeployDialogState = () => ({
  open: false,
  gateKey: '',
  unitTypeId: '',
  unitName: '',
  max: 1
});

const useDefenseLayout = ({
  nodeId,
  buildingDragRef
}) => {
  const [defenseLayoutState, setDefenseLayoutState] = useState(createDefaultDefenseLayoutState);
  const [gateDeployState, setGateDeployState] = useState(createDefaultGateDeployState);
  const [gateDeployDialogState, setGateDeployDialogState] = useState(createDefaultGateDeployDialogState);
  const [draggingBuildingTypeId, setDraggingBuildingTypeId] = useState('');

  const closeGateDeployDialog = useCallback(() => {
    setGateDeployDialogState(createDefaultGateDeployDialogState());
  }, []);

  const resetDefenseState = useCallback(() => {
    setDefenseLayoutState(createDefaultDefenseLayoutState());
    setGateDeployState(createDefaultGateDeployState());
    setGateDeployDialogState(createDefaultGateDeployDialogState());
    setDraggingBuildingTypeId('');
    if (buildingDragRef) {
      buildingDragRef.current = null;
    }
  }, [buildingDragRef]);

  const fetchDefenseLayout = useCallback(async (silent = true) => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return;

    if (!silent) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        loading: true,
        error: '',
        feedback: ''
      }));
    }

    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/defense-layout`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        setDefenseLayoutState((prev) => ({
          ...prev,
          loading: false,
          canViewGateDefense: false,
          buildingCatalog: [],
          selectedBuildingTypeId: '',
          error: getApiError(parsed, '获取城防配置失败'),
          feedback: ''
        }));
        return;
      }

      const layout = normalizeDefenseLayoutFromApi(data.layout || {});
      const buildingCatalog = normalizeBuildingCatalogFromApi(data.buildingCatalog);
      const fallbackBuildingTypeId = buildingCatalog[0]?.buildingTypeId || '';
      if (fallbackBuildingTypeId && Array.isArray(layout.buildings) && layout.buildings.length > 0) {
        layout.buildings = layout.buildings.map((building) => {
          if (building?.buildingTypeId) return building;
          const fallbackType = buildingCatalog.find((item) => (
            item.name && building?.name && item.name === building.name
          ));
          const buildingTypeId = fallbackType?.buildingTypeId || fallbackBuildingTypeId;
          const typeDef = buildingCatalog.find((item) => item.buildingTypeId === buildingTypeId) || null;
          return {
            ...building,
            buildingTypeId,
            name: typeDef?.name || building.name,
            radius: typeDef?.radius || building.radius,
            level: typeDef?.level || building.level,
            nextUnitTypeId: typeDef?.nextUnitTypeId || building.nextUnitTypeId,
            upgradeCostKP: typeDef?.upgradeCostKP ?? building.upgradeCostKP
          };
        });
      }
      setDefenseLayoutState((prev) => ({
        ...prev,
        loading: false,
        saving: false,
        error: '',
        feedback: '',
        canEdit: !!data.canEdit,
        canViewGateDefense: !!data.canViewGateDefense || !!data.canEdit,
        maxBuildings: Number.isFinite(Number(data.maxBuildings)) ? Math.max(0, Number(data.maxBuildings)) : CITY_BUILDING_LIMIT,
        minBuildings: Number.isFinite(Number(data.minBuildings)) ? Math.max(0, Number(data.minBuildings)) : 0,
        buildingCatalog,
        selectedBuildingTypeId: prev.selectedBuildingTypeId || fallbackBuildingTypeId,
        buildMode: false,
        isDirty: false,
        selectedBuildingId: '',
        draggingBuildingId: '',
        savedLayout: cloneDefenseLayout(layout),
        draftLayout: cloneDefenseLayout(layout)
      }));
      if (buildingDragRef) {
        buildingDragRef.current = null;
      }
      setGateDeployState((prev) => ({
        ...prev,
        activeGateKey: '',
        draggingUnitTypeId: '',
        editMode: false
      }));
      closeGateDeployDialog();
    } catch (error) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        loading: false,
        canViewGateDefense: false,
        buildingCatalog: [],
        selectedBuildingTypeId: '',
        error: `获取城防配置失败: ${error.message}`,
        feedback: ''
      }));
    }
  }, [buildingDragRef, closeGateDeployDialog, nodeId]);

  const fetchGateDeployArmyData = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return;
    setGateDeployState((prev) => ({
      ...prev,
      loading: true,
      error: ''
    }));
    try {
      const [unitTypeResponse, meResponse] = await Promise.all([
        fetch(`${API_BASE}/army/unit-types`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_BASE}/army/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      const [unitTypeParsed, meParsed] = await Promise.all([
        parseApiResponse(unitTypeResponse),
        parseApiResponse(meResponse)
      ]);
      if (!unitTypeResponse.ok || !unitTypeParsed?.data || !meResponse.ok || !meParsed?.data) {
        setGateDeployState((prev) => ({
          ...prev,
          loading: false,
          error: getApiError(unitTypeParsed, getApiError(meParsed, '加载兵力配置失败'))
        }));
        return;
      }
      setGateDeployState((prev) => ({
        ...prev,
        loading: false,
        error: '',
        unitTypes: Array.isArray(unitTypeParsed.data.unitTypes) ? unitTypeParsed.data.unitTypes : [],
        roster: Array.isArray(meParsed.data.roster) ? meParsed.data.roster : []
      }));
    } catch (error) {
      setGateDeployState((prev) => ({
        ...prev,
        loading: false,
        error: `加载兵力配置失败: ${error.message}`
      }));
    }
  }, [nodeId]);

  const openGateDeployPanel = useCallback((gateKey) => {
    const canOpen = defenseLayoutState.canEdit || defenseLayoutState.canViewGateDefense;
    if (!canOpen) return;
    if (!CITY_GATE_KEYS.includes(gateKey)) return;
    if (defenseLayoutState.canEdit && defenseLayoutState.buildMode) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        feedback: '请先退出建造模式，再点击承口/启口进行布防',
        error: ''
      }));
      return;
    }
    closeGateDeployDialog();
    setGateDeployState((prev) => ({
      ...prev,
      activeGateKey: gateKey,
      draggingUnitTypeId: '',
      error: '',
      editMode: defenseLayoutState.canEdit ? prev.editMode : false
    }));
    const needsArmyData = (gateDeployState.unitTypes || []).length === 0 || (gateDeployState.roster || []).length === 0;
    if (defenseLayoutState.canEdit && needsArmyData && !gateDeployState.loading) {
      fetchGateDeployArmyData();
    }
  }, [closeGateDeployDialog, defenseLayoutState, fetchGateDeployArmyData, gateDeployState]);

  const closeGateDeployPanel = useCallback(() => {
    if (
      defenseLayoutState.canEdit
      && gateDeployState.editMode
      && defenseLayoutState.isDirty
      && !defenseLayoutState.buildMode
    ) {
      const shouldDiscard = window.confirm('当前有未保存的布防改动，关闭后将丢失，是否继续？');
      if (!shouldDiscard) return;
      setDefenseLayoutState((prev) => ({
        ...prev,
        isDirty: false,
        error: '',
        feedback: '',
        draftLayout: cloneDefenseLayout(prev.savedLayout)
      }));
    }
    closeGateDeployDialog();
    setGateDeployState((prev) => ({
      ...prev,
      activeGateKey: '',
      draggingUnitTypeId: '',
      error: '',
      editMode: false
    }));
  }, [closeGateDeployDialog, defenseLayoutState, gateDeployState.editMode]);

  const startGateDeployEdit = useCallback(() => {
    if (!defenseLayoutState.canEdit || defenseLayoutState.buildMode || !gateDeployState.activeGateKey) return;
    closeGateDeployDialog();
    setGateDeployState((prev) => ({
      ...prev,
      error: '',
      editMode: true
    }));
    setDefenseLayoutState((prev) => ({
      ...prev,
      error: '',
      feedback: '',
      draftLayout: prev.isDirty ? cloneDefenseLayout(prev.draftLayout) : cloneDefenseLayout(prev.savedLayout)
    }));
    const needsArmyData = (gateDeployState.unitTypes || []).length === 0 || (gateDeployState.roster || []).length === 0;
    if (needsArmyData && !gateDeployState.loading) {
      fetchGateDeployArmyData();
    }
  }, [closeGateDeployDialog, defenseLayoutState, fetchGateDeployArmyData, gateDeployState]);

  const cancelGateDeployEdit = useCallback(() => {
    if (!gateDeployState.editMode) return;
    if (defenseLayoutState.canEdit && defenseLayoutState.isDirty && !defenseLayoutState.buildMode) {
      const shouldDiscard = window.confirm('当前有未保存的布防改动，取消后将丢失，是否继续？');
      if (!shouldDiscard) return;
      setDefenseLayoutState((prev) => ({
        ...prev,
        isDirty: false,
        error: '',
        feedback: '',
        draftLayout: cloneDefenseLayout(prev.savedLayout)
      }));
    }
    closeGateDeployDialog();
    setGateDeployState((prev) => ({
      ...prev,
      editMode: false,
      draggingUnitTypeId: '',
      error: ''
    }));
  }, [closeGateDeployDialog, defenseLayoutState, gateDeployState.editMode]);

  const updateGateDefenseEntries = useCallback((gateKey, updater) => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit) return prev;
      if (!CITY_GATE_KEYS.includes(gateKey)) return prev;
      const nextDraft = cloneDefenseLayout(prev.draftLayout);
      const currentEntries = getGateDefenseEntries(nextDraft, gateKey);
      const nextEntries = typeof updater === 'function'
        ? updater(currentEntries)
        : currentEntries;
      nextDraft.gateDefense = {
        ...(nextDraft.gateDefense || { cheng: [], qi: [] }),
        [gateKey]: Array.isArray(nextEntries) ? nextEntries.filter((entry) => entry.unitTypeId && entry.count > 0) : []
      };
      return {
        ...prev,
        draftLayout: nextDraft,
        isDirty: true,
        error: '',
        feedback: ''
      };
    });
  }, []);

  const removeGateDefenseUnit = useCallback((gateKey, unitTypeId) => {
    if (!unitTypeId) return;
    updateGateDefenseEntries(gateKey, (entries) => entries.filter((entry) => entry.unitTypeId !== unitTypeId));
  }, [updateGateDefenseEntries]);

  const handleGateDeployDrop = useCallback((gateKey, unitTypeId) => {
    if (!defenseLayoutState.canEdit) return;
    if (!gateKey || !unitTypeId) return;

    const rosterMap = new Map(
      (Array.isArray(gateDeployState.roster) ? gateDeployState.roster : [])
        .map((entry) => [
          typeof entry?.unitTypeId === 'string' ? entry.unitTypeId : '',
          Math.max(0, Math.floor(Number(entry?.count) || 0))
        ])
        .filter(([id]) => !!id)
    );
    const rosterCount = rosterMap.get(unitTypeId) || 0;
    if (rosterCount <= 0) {
      setGateDeployState((prev) => ({
        ...prev,
        error: '该兵种当前可用兵力为 0'
      }));
      return;
    }

    const currentLayout = cloneDefenseLayout(defenseLayoutState.draftLayout);
    const deployedCounter = getDeployedCountByUnitType(currentLayout);
    const deployedTotal = deployedCounter.get(unitTypeId) || 0;
    const available = Math.max(0, rosterCount - deployedTotal);
    if (available <= 0) {
      setGateDeployState((prev) => ({
        ...prev,
        error: '该兵种已全部用于布防，无法继续派遣'
      }));
      return;
    }

    const unitTypeMap = new Map(
      (Array.isArray(gateDeployState.unitTypes) ? gateDeployState.unitTypes : [])
        .map((unitType) => [unitType?.id || unitType?.unitTypeId, unitType])
        .filter(([id]) => !!id)
    );
    const unitName = unitTypeMap.get(unitTypeId)?.name || unitTypeId;
    setGateDeployState((prev) => ({ ...prev, error: '' }));
    setGateDeployDialogState({
      open: true,
      gateKey,
      unitTypeId,
      unitName,
      max: available
    });
  }, [defenseLayoutState, gateDeployState]);

  const confirmGateDeployQuantity = useCallback((qty) => {
    const gateKey = gateDeployDialogState.gateKey;
    const unitTypeId = gateDeployDialogState.unitTypeId;
    const max = Math.max(1, Math.floor(Number(gateDeployDialogState.max) || 1));
    const safeQty = Math.max(1, Math.floor(Number(qty) || 1));
    if (!gateKey || !unitTypeId) {
      closeGateDeployDialog();
      return;
    }
    if (safeQty > max) {
      setGateDeployState((prev) => ({
        ...prev,
        error: `超出可用兵力，最多可派遣 ${max}`
      }));
      closeGateDeployDialog();
      return;
    }
    updateGateDefenseEntries(gateKey, (entries) => {
      const nextEntries = [...entries];
      const index = nextEntries.findIndex((entry) => entry.unitTypeId === unitTypeId);
      if (index >= 0) {
        nextEntries[index] = {
          ...nextEntries[index],
          count: nextEntries[index].count + safeQty
        };
      } else {
        nextEntries.push({ unitTypeId, count: safeQty });
      }
      return nextEntries;
    });
    closeGateDeployDialog();
  }, [closeGateDeployDialog, gateDeployDialogState, updateGateDefenseEntries]);

  const toggleBuildMode = useCallback(() => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit) return prev;
      if (prev.buildMode) {
        if (prev.isDirty) {
          const shouldDiscard = window.confirm('当前有未保存的建造配置，退出建造模式会丢失改动，是否继续？');
          if (!shouldDiscard) return prev;
        }
        return {
          ...prev,
          buildMode: false,
          isDirty: false,
          selectedBuildingId: '',
          selectedBuildingTypeId: prev.selectedBuildingTypeId || (prev.buildingCatalog[0]?.buildingTypeId || ''),
          draggingBuildingId: '',
          error: '',
          feedback: '',
          draftLayout: cloneDefenseLayout(prev.savedLayout)
        };
      }
      if (prev.isDirty) {
        const shouldDiscard = window.confirm('当前有未保存的布防改动，进入建造模式将丢失这些改动，是否继续？');
        if (!shouldDiscard) return prev;
      }
      return {
        ...prev,
        buildMode: true,
        isDirty: false,
        selectedBuildingId: '',
        selectedBuildingTypeId: prev.selectedBuildingTypeId || (prev.buildingCatalog[0]?.buildingTypeId || ''),
        draggingBuildingId: '',
        error: '',
        feedback: '',
        draftLayout: cloneDefenseLayout(prev.savedLayout)
      };
    });
    if (buildingDragRef) {
      buildingDragRef.current = null;
    }
    setGateDeployState((prev) => ({
      ...prev,
      activeGateKey: '',
      draggingUnitTypeId: '',
      editMode: false
    }));
    closeGateDeployDialog();
    setDraggingBuildingTypeId('');
  }, [buildingDragRef, closeGateDeployDialog]);

  const addDefenseBuilding = useCallback(() => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode) return prev;
      const currentBuildings = prev.draftLayout?.buildings || [];
      const buildingCatalog = Array.isArray(prev.buildingCatalog) ? prev.buildingCatalog : [];
      if (currentBuildings.length >= prev.maxBuildings) {
        return {
          ...prev,
          feedback: `建筑上限为 ${prev.maxBuildings} 个`,
          error: ''
        };
      }
      if (buildingCatalog.length === 0) {
        return {
          ...prev,
          feedback: '当前未配置可用建筑类型，请先到管理员面板配置建筑目录',
          error: ''
        };
      }

      const selectedType = buildingCatalog.find((item) => item.buildingTypeId === prev.selectedBuildingTypeId)
        || buildingCatalog[0];
      if (!selectedType?.buildingTypeId) {
        return {
          ...prev,
          feedback: '建筑类型配置无效，请检查建筑目录',
          error: ''
        };
      }

      const selectedTypeId = selectedType.buildingTypeId;
      const typeLimit = Math.max(0, Number(selectedType.initialCount) || 0);
      const typeUsedCount = currentBuildings.filter((item) => item.buildingTypeId === selectedTypeId).length;
      if (typeUsedCount >= typeLimit) {
        return {
          ...prev,
          feedback: `建筑类型「${selectedType.name}」库存不足`,
          error: ''
        };
      }

      const newId = `building_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const foundPosition = CITY_BUILDING_CANDIDATE_POSITIONS.find((candidate) => (
        isValidPlacement(candidate, currentBuildings, newId)
      ));
      if (!foundPosition) {
        return {
          ...prev,
          feedback: '没有可用空位，请先调整现有建筑位置',
          error: ''
        };
      }

      const nextLayout = cloneDefenseLayout(prev.draftLayout);
      nextLayout.buildings.push({
        buildingId: newId,
        buildingTypeId: selectedTypeId,
        name: selectedType.name || `建筑${nextLayout.buildings.length + 1}`,
        x: foundPosition.x,
        y: foundPosition.y,
        radius: Number.isFinite(Number(selectedType.radius))
          ? Math.max(0.1, Math.min(0.24, Number(selectedType.radius)))
          : CITY_BUILDING_DEFAULT_RADIUS,
        level: Math.max(1, Math.floor(Number(selectedType.level) || 1)),
        nextUnitTypeId: selectedType.nextUnitTypeId || '',
        upgradeCostKP: Number.isFinite(Number(selectedType.upgradeCostKP)) ? Number(selectedType.upgradeCostKP) : null
      });
      return {
        ...prev,
        draftLayout: nextLayout,
        selectedBuildingTypeId: selectedTypeId,
        isDirty: true,
        selectedBuildingId: newId,
        feedback: '',
        error: ''
      };
    });
  }, []);

  const updateSelectedBuildingType = useCallback((nextBuildingTypeId) => {
    const safeTypeId = typeof nextBuildingTypeId === 'string' ? nextBuildingTypeId.trim() : '';
    setDefenseLayoutState((prev) => {
      const catalog = Array.isArray(prev.buildingCatalog) ? prev.buildingCatalog : [];
      const targetType = catalog.find((item) => item.buildingTypeId === safeTypeId) || null;
      if (!targetType) {
        return {
          ...prev,
          selectedBuildingTypeId: ''
        };
      }

      if (!prev.buildMode || !prev.selectedBuildingId) {
        return {
          ...prev,
          selectedBuildingTypeId: targetType.buildingTypeId,
          feedback: '',
          error: ''
        };
      }

      const currentBuildings = Array.isArray(prev.draftLayout?.buildings) ? prev.draftLayout.buildings : [];
      const targetBuilding = currentBuildings.find((item) => item.buildingId === prev.selectedBuildingId);
      if (!targetBuilding) {
        return {
          ...prev,
          selectedBuildingTypeId: targetType.buildingTypeId
        };
      }

      const usedCount = currentBuildings.filter((item) => (
        item.buildingTypeId === targetType.buildingTypeId && item.buildingId !== prev.selectedBuildingId
      )).length;
      const typeLimit = Math.max(0, Math.floor(Number(targetType.initialCount) || 0));
      if (usedCount >= typeLimit) {
        return {
          ...prev,
          selectedBuildingTypeId: targetType.buildingTypeId,
          feedback: `建筑类型「${targetType.name}」库存不足`,
          error: ''
        };
      }

      const nextDraft = cloneDefenseLayout(prev.draftLayout);
      nextDraft.buildings = nextDraft.buildings.map((item) => {
        if (item.buildingId !== prev.selectedBuildingId) return item;
        return {
          ...item,
          buildingTypeId: targetType.buildingTypeId,
          name: targetType.name || item.name,
          radius: Number.isFinite(Number(targetType.radius))
            ? Math.max(0.1, Math.min(0.24, Number(targetType.radius)))
            : item.radius,
          level: Math.max(1, Math.floor(Number(targetType.level) || item.level || 1)),
          nextUnitTypeId: targetType.nextUnitTypeId || '',
          upgradeCostKP: Number.isFinite(Number(targetType.upgradeCostKP))
            ? Number(targetType.upgradeCostKP)
            : null
        };
      });

      return {
        ...prev,
        draftLayout: nextDraft,
        selectedBuildingTypeId: targetType.buildingTypeId,
        isDirty: true,
        feedback: '',
        error: ''
      };
    });
  }, []);

  const handleBuildingPaletteDragStart = useCallback((event, buildingTypeId) => {
    const safeTypeId = typeof buildingTypeId === 'string' ? buildingTypeId.trim() : '';
    if (!safeTypeId) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('application/x-city-building-type', safeTypeId);
    event.dataTransfer.setData('text/plain', safeTypeId);
    event.dataTransfer.effectAllowed = 'copy';
    setDraggingBuildingTypeId(safeTypeId);
    updateSelectedBuildingType(safeTypeId);
  }, [updateSelectedBuildingType]);

  const handleBuildingPaletteDragEnd = useCallback(() => {
    setDraggingBuildingTypeId('');
  }, []);

  const handleCityBuildDragOver = useCallback((event) => {
    if (!defenseLayoutState.canEdit || !defenseLayoutState.buildMode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [defenseLayoutState.buildMode, defenseLayoutState.canEdit]);

  const handleCityBuildDrop = useCallback((event, getPointerNormPosition) => {
    if (!defenseLayoutState.canEdit || !defenseLayoutState.buildMode) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingBuildingTypeId('');
    const droppedBuildingTypeId = (
      event.dataTransfer.getData('application/x-city-building-type')
      || event.dataTransfer.getData('text/plain')
      || ''
    ).trim();
    if (!droppedBuildingTypeId) return;
    const nextPosition = typeof getPointerNormPosition === 'function'
      ? getPointerNormPosition(event.clientX, event.clientY)
      : null;
    if (!nextPosition) return;

    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode) return prev;
      const currentBuildings = Array.isArray(prev.draftLayout?.buildings) ? prev.draftLayout.buildings : [];
      const buildingCatalog = Array.isArray(prev.buildingCatalog) ? prev.buildingCatalog : [];
      if (currentBuildings.length >= prev.maxBuildings) {
        return {
          ...prev,
          feedback: `建筑上限为 ${prev.maxBuildings} 个`,
          error: ''
        };
      }
      const targetType = buildingCatalog.find((item) => item.buildingTypeId === droppedBuildingTypeId) || null;
      if (!targetType?.buildingTypeId) {
        return {
          ...prev,
          feedback: '未找到对应建筑类型，请刷新后重试',
          error: ''
        };
      }
      const typeLimit = Math.max(0, Math.floor(Number(targetType.initialCount) || 0));
      const typeUsedCount = currentBuildings.filter((item) => item.buildingTypeId === targetType.buildingTypeId).length;
      if (typeUsedCount >= typeLimit) {
        return {
          ...prev,
          feedback: `建筑类型「${targetType.name}」库存不足`,
          error: ''
        };
      }
      const clampedPosition = clampPositionInsideCity(nextPosition);
      const newId = `building_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (!isValidPlacement(clampedPosition, currentBuildings, newId)) {
        return {
          ...prev,
          feedback: '当前位置无法放置，请与其他建筑保持间距',
          error: ''
        };
      }
      const nextLayout = cloneDefenseLayout(prev.draftLayout);
      nextLayout.buildings.push({
        buildingId: newId,
        buildingTypeId: targetType.buildingTypeId,
        name: targetType.name || `建筑${nextLayout.buildings.length + 1}`,
        x: clampedPosition.x,
        y: clampedPosition.y,
        radius: Number.isFinite(Number(targetType.radius))
          ? Math.max(0.1, Math.min(0.24, Number(targetType.radius)))
          : CITY_BUILDING_DEFAULT_RADIUS,
        level: Math.max(1, Math.floor(Number(targetType.level) || 1)),
        nextUnitTypeId: targetType.nextUnitTypeId || '',
        upgradeCostKP: Number.isFinite(Number(targetType.upgradeCostKP)) ? Number(targetType.upgradeCostKP) : null
      });
      return {
        ...prev,
        draftLayout: nextLayout,
        selectedBuildingId: newId,
        selectedBuildingTypeId: targetType.buildingTypeId,
        isDirty: true,
        feedback: '',
        error: ''
      };
    });
  }, [defenseLayoutState.buildMode, defenseLayoutState.canEdit]);

  const setIntelOnSelectedBuilding = useCallback(() => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode || !prev.selectedBuildingId) return prev;
      if (!(prev.draftLayout?.buildings || []).some((item) => item.buildingId === prev.selectedBuildingId)) {
        return prev;
      }
      if (prev.draftLayout.intelBuildingId === prev.selectedBuildingId) {
        return {
          ...prev,
          feedback: '当前建筑已存放情报文件',
          error: ''
        };
      }
      return {
        ...prev,
        draftLayout: {
          ...cloneDefenseLayout(prev.draftLayout),
          intelBuildingId: prev.selectedBuildingId
        },
        isDirty: true,
        feedback: '',
        error: ''
      };
    });
  }, []);

  const removeSelectedDefenseBuilding = useCallback(() => {
    setDefenseLayoutState((prev) => {
      if (!prev.canEdit || !prev.buildMode || !prev.selectedBuildingId) return prev;
      const currentBuildings = prev.draftLayout?.buildings || [];
      if (currentBuildings.length <= prev.minBuildings) {
        return {
          ...prev,
          feedback: `至少保留 ${prev.minBuildings} 个建筑`,
          error: ''
        };
      }
      const nextBuildings = currentBuildings.filter((item) => item.buildingId !== prev.selectedBuildingId);
      if (nextBuildings.length === currentBuildings.length) return prev;
      const nextIntelBuildingId = prev.draftLayout.intelBuildingId === prev.selectedBuildingId
        ? nextBuildings[0]?.buildingId || ''
        : prev.draftLayout.intelBuildingId;
      const nextSelectedBuildingId = nextBuildings[0]?.buildingId || '';
      const nextSelectedBuildingTypeId = nextBuildings.find((item) => item.buildingId === nextSelectedBuildingId)?.buildingTypeId
        || prev.selectedBuildingTypeId
        || (Array.isArray(prev.buildingCatalog) ? prev.buildingCatalog[0]?.buildingTypeId : '')
        || '';
      return {
        ...prev,
        draftLayout: {
          ...cloneDefenseLayout(prev.draftLayout),
          buildings: nextBuildings,
          intelBuildingId: nextIntelBuildingId
        },
        isDirty: true,
        selectedBuildingId: nextSelectedBuildingId,
        selectedBuildingTypeId: nextSelectedBuildingTypeId,
        feedback: '',
        error: ''
      };
    });
  }, []);

  const saveDefenseLayout = useCallback(async (options = {}) => {
    const keepBuildModeOnSuccess = options?.keepBuildModeOnSuccess === true;
    const keepGatePanelOnSuccess = options?.keepGatePanelOnSuccess === true;
    const successFallbackMessage = typeof options?.successMessage === 'string' && options.successMessage.trim()
      ? options.successMessage.trim()
      : '城防配置已保存';
    const token = localStorage.getItem('token');
    if (!token || !nodeId) return { ok: false };

    const snapshot = defenseLayoutState;
    if (!snapshot.canEdit) return { ok: false };
    if (!snapshot.isDirty) {
      setDefenseLayoutState((prev) => ({
        ...prev,
        feedback: '当前没有需要保存的改动',
        error: ''
      }));
      return { ok: false, noChanges: true, message: '当前没有需要保存的改动' };
    }

    setDefenseLayoutState((prev) => ({
      ...prev,
      saving: true,
      feedback: '',
      error: ''
    }));
    try {
      const response = await fetch(`${API_BASE}/nodes/${nodeId}/defense-layout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          layout: defenseLayoutToPayload(snapshot.draftLayout)
        })
      });
      const parsed = await parseApiResponse(response);
      const data = parsed.data;
      if (!response.ok || !data) {
        const errorMessage = getApiError(parsed, '保存城防配置失败');
        setDefenseLayoutState((prev) => ({
          ...prev,
          saving: false,
          error: errorMessage
        }));
        return { ok: false, message: errorMessage };
      }
      const layout = normalizeDefenseLayoutFromApi(data.layout || snapshot.draftLayout);
      const latestBuildingCatalog = normalizeBuildingCatalogFromApi(
        Array.isArray(data.buildingCatalog) ? data.buildingCatalog : snapshot.buildingCatalog
      );
      const fallbackBuildingTypeId = latestBuildingCatalog[0]?.buildingTypeId || '';
      setDefenseLayoutState((prev) => ({
        ...prev,
        saving: false,
        buildMode: keepBuildModeOnSuccess ? prev.buildMode : false,
        isDirty: false,
        selectedBuildingId: '',
        selectedBuildingTypeId: prev.selectedBuildingTypeId || fallbackBuildingTypeId,
        draggingBuildingId: '',
        buildingCatalog: latestBuildingCatalog,
        error: '',
        feedback: data.message || successFallbackMessage,
        savedLayout: cloneDefenseLayout(layout),
        draftLayout: cloneDefenseLayout(layout)
      }));
      if (buildingDragRef) {
        buildingDragRef.current = null;
      }
      if (keepGatePanelOnSuccess) {
        setGateDeployState((prev) => ({
          ...prev,
          draggingUnitTypeId: '',
          error: '',
          editMode: false
        }));
      } else {
        setGateDeployState((prev) => ({
          ...prev,
          activeGateKey: '',
          draggingUnitTypeId: '',
          error: '',
          editMode: false
        }));
        closeGateDeployDialog();
      }
      return { ok: true, message: data.message || successFallbackMessage };
    } catch (error) {
      const errorMessage = `保存城防配置失败: ${error.message}`;
      setDefenseLayoutState((prev) => ({
        ...prev,
        saving: false,
        error: errorMessage
      }));
      return { ok: false, message: errorMessage };
    }
  }, [buildingDragRef, closeGateDeployDialog, defenseLayoutState, nodeId]);

  const saveGateDeployment = useCallback(async () => {
    if (!defenseLayoutState.canEdit) return;
    const result = await saveDefenseLayout({
      keepBuildModeOnSuccess: defenseLayoutState.buildMode,
      keepGatePanelOnSuccess: true,
      successMessage: '承口/启口布防已保存'
    });
    if (!result?.ok) {
      if (result?.message) {
        setGateDeployState((prev) => ({ ...prev, error: result.message }));
      }
      return;
    }
    setGateDeployState((prev) => ({ ...prev, error: '', editMode: false }));
  }, [defenseLayoutState, saveDefenseLayout]);

  const handleDefenseBuildingPointerDown = useCallback((event, buildingId) => {
    if (!defenseLayoutState.canEdit || !defenseLayoutState.buildMode) return;
    event.preventDefault();
    event.stopPropagation();
    if (buildingDragRef) {
      buildingDragRef.current = { buildingId };
    }
    setDefenseLayoutState((prev) => ({
      ...prev,
      selectedBuildingId: buildingId,
      selectedBuildingTypeId: (
        (Array.isArray(prev.draftLayout?.buildings) ? prev.draftLayout.buildings : [])
          .find((item) => item.buildingId === buildingId)?.buildingTypeId
          || prev.selectedBuildingTypeId
      ),
      draggingBuildingId: buildingId,
      feedback: '',
      error: ''
    }));
  }, [buildingDragRef, defenseLayoutState.buildMode, defenseLayoutState.canEdit]);

  return {
    defenseLayoutState,
    setDefenseLayoutState,
    gateDeployState,
    setGateDeployState,
    gateDeployDialogState,
    setGateDeployDialogState,
    draggingBuildingTypeId,
    setDraggingBuildingTypeId,
    closeGateDeployDialog,
    resetDefenseState,
    fetchDefenseLayout,
    fetchGateDeployArmyData,
    openGateDeployPanel,
    closeGateDeployPanel,
    startGateDeployEdit,
    cancelGateDeployEdit,
    updateGateDefenseEntries,
    removeGateDefenseUnit,
    handleGateDeployDrop,
    confirmGateDeployQuantity,
    toggleBuildMode,
    addDefenseBuilding,
    handleBuildingPaletteDragStart,
    handleBuildingPaletteDragEnd,
    handleCityBuildDragOver,
    handleCityBuildDrop,
    updateSelectedBuildingType,
    setIntelOnSelectedBuilding,
    removeSelectedDefenseBuilding,
    saveDefenseLayout,
    saveGateDeployment,
    handleDefenseBuildingPointerDown
  };
};

export default useDefenseLayout;
