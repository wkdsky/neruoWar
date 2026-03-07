import { useCallback } from 'react';
import {
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultDeployEditorDraft,
  createDefaultDeployQuantityDialog,
  createDefaultTemplateFillPreview
} from '../screens/battleSceneConstants';
import {
  clamp,
  normalizeDraftUnits,
  normalizeTemplateUnits,
  unitsToMap
} from '../screens/battleSceneUtils';

export default function useBattleDeployEditor({
  runtimeRef,
  pointerWorldRef,
  isTrainingMode = false,
  deployEditingGroupId = '',
  deployEditorDraft,
  deployEditorTeam = TEAM_ATTACKER,
  deployQuantityDialog,
  templateFillPreview,
  setDeployEditorOpen,
  setDeployEditingGroupId,
  setDeployEditorDraft,
  setDeployQuantityDialog,
  setDeployEditorDragUnitId,
  setDeployEditorTeam,
  setDeployNotice,
  setSelectedSquadId,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setCards,
  setMinimapSnapshot,
  setTemplateFillPreview
} = {}) {
  const syncCardsAndMinimap = useCallback((runtime) => {
    if (!runtime) return;
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
  }, [setCards, setMinimapSnapshot]);

  const closeDeployEditor = useCallback(() => {
    setDeployEditorOpen(false);
    setDeployEditingGroupId('');
    setDeployQuantityDialog(createDefaultDeployQuantityDialog());
    setDeployEditorDragUnitId('');
    setDeployEditorTeam(TEAM_ATTACKER);
  }, [
    setDeployEditorDragUnitId,
    setDeployEditorOpen,
    setDeployEditorTeam,
    setDeployEditingGroupId,
    setDeployQuantityDialog
  ]);

  const handleOpenDeployCreator = useCallback((team = TEAM_ATTACKER) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const rows = isTrainingMode
      ? [...runtime.getRosterRows(TEAM_ATTACKER), ...runtime.getRosterRows(TEAM_DEFENDER)]
      : runtime.getRosterRows(safeTeam);
    if (rows.length <= 0 || rows.every((row) => row.total <= 0)) {
      setDeployNotice('当前没有可用兵种库存，无法新建部队');
      return;
    }
    setDeployEditorTeam(safeTeam);
    setDeployEditingGroupId('');
    setDeployEditorDraft(createDefaultDeployEditorDraft());
    setDeployEditorOpen(true);
    setDeployQuantityDialog(createDefaultDeployQuantityDialog());
    setDeployNotice('');
  }, [
    isTrainingMode,
    runtimeRef,
    setDeployEditorDraft,
    setDeployEditorOpen,
    setDeployEditorTeam,
    setDeployEditingGroupId,
    setDeployNotice,
    setDeployQuantityDialog
  ]);

  const handleOpenDeployEditorForGroup = useCallback((groupId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) {
      setDeployNotice('未找到可编辑部队');
      return;
    }
    if (!isTrainingMode && group.team === TEAM_DEFENDER) {
      setDeployNotice('当前模式不可编辑敌方部队');
      return;
    }
    const draftUnits = Object.entries(group.units || {}).map(([unitTypeId, count]) => ({
      unitTypeId,
      count: Math.max(1, Math.floor(Number(count) || 1))
    }));
    setDeployEditorTeam(group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER);
    setDeployEditingGroupId(group.id);
    setDeployEditorDraft({
      name: group.name || '',
      units: normalizeDraftUnits(draftUnits)
    });
    setDeployEditorOpen(true);
    setDeployQuantityDialog(createDefaultDeployQuantityDialog());
    setDeployNotice('');
  }, [
    isTrainingMode,
    runtimeRef,
    setDeployEditorDraft,
    setDeployEditorOpen,
    setDeployEditorTeam,
    setDeployEditingGroupId,
    setDeployNotice,
    setDeployQuantityDialog
  ]);

  const resolveDeployUnitMax = useCallback((unitTypeId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return 0;
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return 0;
    if (isTrainingMode && !deployEditingGroupId) {
      const attackerAvailable = Math.max(
        0,
        Math.floor(Number(runtime.getRosterRows(TEAM_ATTACKER).find((row) => row.unitTypeId === safeId)?.available) || 0)
      );
      const defenderAvailable = Math.max(
        0,
        Math.floor(Number(runtime.getRosterRows(TEAM_DEFENDER).find((row) => row.unitTypeId === safeId)?.available) || 0)
      );
      return Math.max(attackerAvailable, defenderAvailable);
    }
    const rosterRow = runtime.getRosterRows(deployEditorTeam).find((row) => row.unitTypeId === safeId);
    const baseAvailable = Math.max(0, Math.floor(Number(rosterRow?.available) || 0));
    if (!deployEditingGroupId) return baseAvailable;
    const editingGroup = runtime.getDeployGroupById(deployEditingGroupId, deployEditorTeam);
    const existing = Math.max(0, Math.floor(Number(editingGroup?.units?.[safeId]) || 0));
    return baseAvailable + existing;
  }, [deployEditingGroupId, deployEditorTeam, isTrainingMode, runtimeRef]);

  const openDeployQuantityDialog = useCallback((unitTypeId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    const max = resolveDeployUnitMax(safeId);
    if (max <= 0) {
      setDeployNotice('该兵种没有可分配数量');
      return;
    }
    const attackerName = runtime.getRosterRows(TEAM_ATTACKER).find((row) => row.unitTypeId === safeId)?.unitName || '';
    const defenderName = runtime.getRosterRows(TEAM_DEFENDER).find((row) => row.unitTypeId === safeId)?.unitName || '';
    const unitName = attackerName || defenderName || runtime.getRosterRows(deployEditorTeam).find((row) => row.unitTypeId === safeId)?.unitName || safeId;
    const current = normalizeDraftUnits(deployEditorDraft.units).find((entry) => entry.unitTypeId === safeId)?.count || 1;
    setDeployQuantityDialog({
      open: true,
      unitTypeId: safeId,
      unitName,
      max,
      current: clamp(current, 1, max)
    });
  }, [
    deployEditorDraft.units,
    deployEditorTeam,
    resolveDeployUnitMax,
    runtimeRef,
    setDeployNotice,
    setDeployQuantityDialog
  ]);

  const handleDeployEditorDrop = useCallback((event) => {
    event.preventDefault();
    const droppedUnitTypeId = event.dataTransfer?.getData('application/x-deploy-unit-id')
      || event.dataTransfer?.getData('text/plain')
      || '';
    setDeployEditorDragUnitId('');
    openDeployQuantityDialog(droppedUnitTypeId);
  }, [openDeployQuantityDialog, setDeployEditorDragUnitId]);

  const handleConfirmDeployQuantity = useCallback((qty) => {
    const safeId = typeof deployQuantityDialog?.unitTypeId === 'string' ? deployQuantityDialog.unitTypeId.trim() : '';
    if (!safeId) {
      setDeployQuantityDialog(createDefaultDeployQuantityDialog());
      return;
    }
    const max = Math.max(1, Math.floor(Number(deployQuantityDialog.max) || 1));
    const safeQty = clamp(Math.floor(Number(qty) || 1), 1, max);
    setDeployEditorDraft((prev) => {
      const source = normalizeDraftUnits(prev?.units || []);
      const idx = source.findIndex((entry) => entry.unitTypeId === safeId);
      if (idx >= 0) {
        source[idx] = { ...source[idx], count: safeQty };
      } else {
        source.push({ unitTypeId: safeId, count: safeQty });
      }
      return { ...prev, units: normalizeDraftUnits(source) };
    });
    setDeployQuantityDialog(createDefaultDeployQuantityDialog());
  }, [deployQuantityDialog, setDeployEditorDraft, setDeployQuantityDialog]);

  const handleRemoveDraftUnit = useCallback((unitTypeId) => {
    const safeId = typeof unitTypeId === 'string' ? unitTypeId.trim() : '';
    if (!safeId) return;
    setDeployEditorDraft((prev) => ({
      ...prev,
      units: normalizeDraftUnits(prev?.units || []).filter((entry) => entry.unitTypeId !== safeId)
    }));
  }, [setDeployEditorDraft]);

  const handleSaveDeployEditor = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const draftUnits = normalizeDraftUnits(deployEditorDraft.units);
    if (draftUnits.length <= 0) {
      setDeployNotice('请至少添加一个兵种到部队编组');
      return;
    }
    const unitsMap = unitsToMap(draftUnits);
    let targetGroupId = '';
    const safeTeam = deployEditorTeam === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const canCreateForTeam = (team) => {
      const rows = runtime.getRosterRows(team);
      return Object.entries(unitsMap).every(([unitTypeId, count]) => {
        const row = rows.find((item) => item.unitTypeId === unitTypeId);
        const available = Math.max(0, Math.floor(Number(row?.available) || 0));
        return Math.max(0, Math.floor(Number(count) || 0)) <= available;
      });
    };
    const createTeam = (!deployEditingGroupId && isTrainingMode)
      ? (canCreateForTeam(TEAM_ATTACKER) ? TEAM_ATTACKER : TEAM_DEFENDER)
      : safeTeam;
    if (!deployEditingGroupId && isTrainingMode && !canCreateForTeam(TEAM_ATTACKER) && !canCreateForTeam(TEAM_DEFENDER)) {
      setDeployNotice('当前编组在我方与敌方库存都不足，请调整兵种数量');
      return;
    }
    if (deployEditingGroupId) {
      const result = runtime.updateDeployGroup(safeTeam, deployEditingGroupId, {
        name: deployEditorDraft.name,
        units: unitsMap
      });
      if (!result?.ok) {
        setDeployNotice(result?.reason || '编辑部队失败');
        return;
      }
      targetGroupId = deployEditingGroupId;
    } else {
      const result = runtime.createDeployGroup(createTeam, {
        name: deployEditorDraft.name,
        units: unitsMap,
        x: pointerWorldRef.current.x,
        y: pointerWorldRef.current.y,
        placed: false
      });
      if (!result?.ok) {
        setDeployNotice(result?.reason || '新建部队失败');
        return;
      }
      targetGroupId = result.groupId;
    }
    runtime.setSelectedDeployGroup(targetGroupId);
    runtime.setFocusSquad(targetGroupId);
    runtime.setDeployGroupPlaced(createTeam, targetGroupId, false);
    setSelectedSquadId(targetGroupId);
    setDeployDraggingGroup({ groupId: targetGroupId, team: createTeam });
    setDeployActionAnchorMode('');
    syncCardsAndMinimap(runtime);
    setDeployEditorOpen(false);
    setDeployEditingGroupId('');
    setDeployEditorTeam(TEAM_ATTACKER);
    setDeployEditorDraft(createDefaultDeployEditorDraft());
    if (!deployEditingGroupId && isTrainingMode) {
      setDeployNotice('部队已创建，移动鼠标并点击地图放置；左侧归我方，右侧归敌方');
      return;
    }
    setDeployNotice(`部队已创建，移动鼠标并点击地图放置到${createTeam === TEAM_DEFENDER ? '右侧红色' : '左侧蓝色'}部署区`);
  }, [
    deployEditingGroupId,
    deployEditorDraft,
    deployEditorTeam,
    isTrainingMode,
    pointerWorldRef,
    runtimeRef,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployEditorDraft,
    setDeployEditorOpen,
    setDeployEditorTeam,
    setDeployEditingGroupId,
    setDeployNotice,
    setSelectedSquadId,
    syncCardsAndMinimap
  ]);

  const buildTemplateFillSnapshot = useCallback((template, team = TEAM_ATTACKER) => {
    const runtime = runtimeRef.current;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (!runtime) {
      return { rows: [], totalRequested: 0, totalFilled: 0 };
    }
    const rosterRows = runtime.getRosterRows(safeTeam);
    const rosterMap = new Map(
      (Array.isArray(rosterRows) ? rosterRows : []).map((row) => ([
        row.unitTypeId,
        {
          available: Math.max(0, Math.floor(Number(row?.available) || 0)),
          unitName: row?.unitName || row?.unitTypeId || ''
        }
      ]))
    );
    const rows = normalizeTemplateUnits(template?.units || []).map((entry) => {
      const rosterInfo = rosterMap.get(entry.unitTypeId) || { available: 0, unitName: entry.unitTypeId };
      const requested = Math.max(1, Math.floor(Number(entry.count) || 1));
      const filled = Math.max(0, Math.min(requested, rosterInfo.available));
      const fillPercent = requested > 0 ? Math.max(0, Math.min(100, (filled / requested) * 100)) : 0;
      return {
        unitTypeId: entry.unitTypeId,
        unitName: entry.unitName || rosterInfo.unitName || entry.unitTypeId,
        requested,
        available: rosterInfo.available,
        filled,
        fillPercent
      };
    });
    const totalRequested = rows.reduce((sum, row) => sum + row.requested, 0);
    const totalFilled = rows.reduce((sum, row) => sum + row.filled, 0);
    return { rows, totalRequested, totalFilled };
  }, [runtimeRef]);

  const createDeployGroupFromTemplateUnits = useCallback((team, unitsMap, templateName = '') => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return false;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = runtime.createDeployGroup(safeTeam, {
      name: typeof templateName === 'string' ? templateName.trim() : '',
      units: unitsMap,
      x: pointerWorldRef.current.x,
      y: pointerWorldRef.current.y,
      placed: false
    });
    if (!result?.ok) {
      setDeployNotice(result?.reason || '按模板创建部队失败');
      return false;
    }
    const targetGroupId = result.groupId;
    runtime.setSelectedDeployGroup(targetGroupId);
    runtime.setFocusSquad(targetGroupId);
    runtime.setDeployGroupPlaced(safeTeam, targetGroupId, false);
    setSelectedSquadId(targetGroupId);
    setDeployDraggingGroup({ groupId: targetGroupId, team: safeTeam });
    setDeployActionAnchorMode('');
    syncCardsAndMinimap(runtime);
    setDeployNotice(`模板部队已创建，移动鼠标并点击地图放置到${safeTeam === TEAM_DEFENDER ? '右侧红色' : '左侧蓝色'}部署区`);
    return true;
  }, [
    pointerWorldRef,
    runtimeRef,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployNotice,
    setSelectedSquadId,
    syncCardsAndMinimap
  ]);

  const handleCreateTrainingGroupByTemplate = useCallback((template, team = TEAM_ATTACKER) => {
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const snapshot = buildTemplateFillSnapshot(template, safeTeam);
    const unitsMap = {};
    snapshot.rows.forEach((row) => {
      if (row.filled > 0) {
        unitsMap[row.unitTypeId] = row.filled;
      }
    });
    createDeployGroupFromTemplateUnits(safeTeam, unitsMap, template?.name || '');
  }, [buildTemplateFillSnapshot, createDeployGroupFromTemplateUnits]);

  const handleOpenTemplateFillPreview = useCallback((template, team = TEAM_ATTACKER) => {
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const snapshot = buildTemplateFillSnapshot(template, safeTeam);
    setTemplateFillPreview({
      ...createDefaultTemplateFillPreview(),
      open: true,
      team: safeTeam,
      template,
      rows: snapshot.rows,
      totalRequested: snapshot.totalRequested,
      totalFilled: snapshot.totalFilled
    });
  }, [buildTemplateFillSnapshot, setTemplateFillPreview]);

  const handleCloseTemplateFillPreview = useCallback(() => {
    setTemplateFillPreview(createDefaultTemplateFillPreview());
  }, [setTemplateFillPreview]);

  const handleConfirmTemplateFillPreview = useCallback(() => {
    const template = templateFillPreview.template;
    if (!template) return;
    const safeTeam = templateFillPreview.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const snapshot = buildTemplateFillSnapshot(template, safeTeam);
    const unitsMap = {};
    snapshot.rows.forEach((row) => {
      if (row.filled > 0) {
        unitsMap[row.unitTypeId] = row.filled;
      }
    });
    const created = createDeployGroupFromTemplateUnits(safeTeam, unitsMap, template?.name || '');
    if (created) {
      handleCloseTemplateFillPreview();
    }
  }, [
    buildTemplateFillSnapshot,
    createDeployGroupFromTemplateUnits,
    handleCloseTemplateFillPreview,
    templateFillPreview
  ]);

  return {
    closeDeployEditor,
    handleOpenDeployCreator,
    handleOpenDeployEditorForGroup,
    openDeployQuantityDialog,
    handleDeployEditorDrop,
    handleConfirmDeployQuantity,
    handleRemoveDraftUnit,
    handleSaveDeployEditor,
    handleCreateTrainingGroupByTemplate,
    handleOpenTemplateFillPreview,
    handleCloseTemplateFillPreview,
    handleConfirmTemplateFillPreview
  };
}
