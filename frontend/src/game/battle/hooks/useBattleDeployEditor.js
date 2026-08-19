import { useCallback } from 'react';
import {
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultTemplateFillPreview
} from '../screens/battleSceneConstants';
import {
  clamp,
  allocateTemplateUnits,
  normalizeTemplatePercentages
} from '../screens/battleSceneUtils';
import { limitNameByDisplayWidth } from '../shared/nameLimits';

const MAX_TEMPLATE_FORMATIONS = 9;
const TRAINING_MAX_GROUP_TOTAL = 10000;
const EMPTY_TEMPLATE_FILL_STATS = Object.freeze({
  totalCount: 0,
  totalHp: 0,
  totalAtk: 0,
  totalDef: 0,
  cohesiveSpeed: 0,
  attackRange: { min: 0, max: 0 },
  range: 0
});

const getTemplateFormationId = (formation = null, index = 0) => {
  const explicitId = String(formation?.formationId || formation?.id || '').trim();
  return explicitId || `formation_${index}`;
};

const normalizeLegalTemplateFormations = (formations = []) => (
  Array.isArray(formations) ? formations : []
)
  .filter((formation) => formation && formation.legal !== false && Array.isArray(formation.placements) && formation.placements.length > 0)
  .slice(0, MAX_TEMPLATE_FORMATIONS)
  .map((formation, index) => ({
    ...formation,
    formationId: getTemplateFormationId(formation, index)
  }));

const getGroupTotal = (units = {}) => Object.values(units || {})
  .reduce((sum, count) => sum + Math.max(0, Math.floor(Number(count) || 0)), 0);

export default function useBattleDeployEditor({
  runtimeRef,
  pointerWorldRef,
  isTrainingMode = false,
  templateFillPreview,
  setDeployNotice,
  setSelectedSquadId,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setCards,
  setMinimapSnapshot,
  setTemplateFillPreview,
  onDeployGroupFormationsChange
} = {}) {
  const syncCardsAndMinimap = useCallback((runtime) => {
    if (!runtime) return;
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
  }, [setCards, setMinimapSnapshot]);

  const buildTemplateFillSnapshot = useCallback((template, team = TEAM_ATTACKER, totalCount = null, editingGroupId = '') => {
    const runtime = runtimeRef.current;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (!runtime) {
      return { rows: [], totalRequested: 0, totalFilled: 0, maxTotal: 0, stats: EMPTY_TEMPLATE_FILL_STATS };
    }
    const percentages = normalizeTemplatePercentages(template?.units || []);
    if (percentages.length <= 0) {
      return { rows: [], totalRequested: 0, totalFilled: 0, maxTotal: 0, stats: EMPTY_TEMPLATE_FILL_STATS };
    }
    const editingGroup = editingGroupId
      ? runtime.getDeployGroupById?.(editingGroupId, safeTeam)
      : null;
    const editingUnits = editingGroup?.units || {};
    const rosterRows = runtime.getRosterRows(safeTeam);
    const rosterMap = new Map(
      (Array.isArray(rosterRows) ? rosterRows : []).map((row) => {
        const unitTypeId = row.unitTypeId;
        const available = Math.max(0, Math.floor(Number(row?.available) || 0));
        const retained = Math.max(0, Math.floor(Number(editingUnits?.[unitTypeId]) || 0));
        return [unitTypeId, {
          available: available + retained,
          unitName: row?.unitName || unitTypeId || ''
        }];
      })
    );
    const capacityByTemplate = percentages.reduce((maxTotal, entry) => {
      const available = rosterMap.get(entry.unitTypeId)?.available || 0;
      if (entry.count <= 0) return maxTotal;
      return Math.min(maxTotal, Math.floor((available * 100) / entry.count));
    }, Number.POSITIVE_INFINITY);
    const trainingLimit = Math.max(
      1,
      Math.floor(Number(runtime.maxDeployGroupTotal) || TRAINING_MAX_GROUP_TOTAL)
    );
    const maxTotal = Math.max(0, Math.min(
      isTrainingMode ? trainingLimit : Math.max(0, Math.floor(capacityByTemplate)),
      Math.max(0, Math.floor(capacityByTemplate))
    ));
    const selectedTotal = maxTotal <= 0
      ? 0
      : clamp(
        totalCount === null || totalCount === undefined ? 0 : Math.floor(Number(totalCount) || 0),
        0,
        maxTotal
      );
    const allocatedByUnitTypeId = new Map(
      allocateTemplateUnits(percentages, selectedTotal)
        .map((entry) => [entry.unitTypeId, Math.max(0, Math.floor(Number(entry.count) || 0))])
    );
    const rows = percentages.map((entry) => {
      const rosterInfo = rosterMap.get(entry.unitTypeId) || { available: 0, unitName: entry.unitTypeId };
      const requested = allocatedByUnitTypeId.get(entry.unitTypeId) || 0;
      const filled = Math.max(0, Math.min(requested, rosterInfo.available));
      const fillPercent = requested > 0 ? Math.max(0, Math.min(100, (filled / requested) * 100)) : 0;
      return {
        unitTypeId: entry.unitTypeId,
        unitName: entry.unitName || rosterInfo.unitName || entry.unitTypeId,
        percent: entry.count || 0,
        requested,
        available: rosterInfo.available,
        filled,
        fillPercent
      };
    });
    const totalRequested = rows.reduce((sum, row) => sum + row.requested, 0);
    const totalFilled = rows.reduce((sum, row) => sum + row.filled, 0);
    const requestedUnits = rows.reduce((result, row) => {
      if (row.requested > 0) result[row.unitTypeId] = row.requested;
      return result;
    }, {});
    const stats = runtime.getCompositionMetrics?.(requestedUnits) || EMPTY_TEMPLATE_FILL_STATS;
    return { rows, totalRequested, totalFilled, maxTotal, stats };
  }, [isTrainingMode, runtimeRef]);

  const stageDeployGroupForPlacement = useCallback((runtime, groupId, team) => {
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    runtime.setSelectedDeployGroup(groupId);
    runtime.setFocusSquad(groupId);
    runtime.setDeployGroupPlaced(safeTeam, groupId, false);
    setSelectedSquadId(groupId);
    setDeployDraggingGroup({ groupId, team: safeTeam });
    setDeployActionAnchorMode('');
    syncCardsAndMinimap(runtime);
  }, [setDeployActionAnchorMode, setDeployDraggingGroup, setSelectedSquadId, syncCardsAndMinimap]);

  const createDeployGroupFromTemplateUnits = useCallback((team, unitsMap, template = null, name = '', controlMode = '') => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return false;
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = runtime.createDeployGroup(safeTeam, {
      name: typeof name === 'string' ? limitNameByDisplayWidth(name.trim()) : '',
      units: unitsMap,
      controlMode: controlMode === 'AI' || controlMode === 'USER'
        ? controlMode
        : (safeTeam === TEAM_DEFENDER ? 'AI' : 'USER'),
      templateId: typeof template?.templateId === 'string' ? template.templateId.trim() : '',
      templateName: typeof template?.name === 'string' ? limitNameByDisplayWidth(template.name.trim()) : '',
      templateFormations: normalizeLegalTemplateFormations(template?.formations),
      x: pointerWorldRef.current.x,
      y: pointerWorldRef.current.y,
      placed: false
    });
    if (!result?.ok) {
      setDeployNotice(result?.reason || '按模板创建部队失败');
      return false;
    }
    const targetGroupId = result.groupId;
    const legalFormations = normalizeLegalTemplateFormations(template?.formations);
    const defaultFormation = legalFormations[0] || null;
    let activeFormationId = '';
    if (defaultFormation) {
      const formationResult = runtime.setDeployGroupFormation(targetGroupId, defaultFormation, safeTeam);
      if (formationResult?.ok) {
        activeFormationId = getTemplateFormationId(defaultFormation, 0);
      }
    }
    onDeployGroupFormationsChange?.(targetGroupId, legalFormations, activeFormationId);
    stageDeployGroupForPlacement(runtime, targetGroupId, safeTeam);
    setDeployNotice(defaultFormation
      ? `模板部队已创建，默认阵型为「${defaultFormation.name || '阵型1'}」，移动鼠标并点击地图放置`
      : `模板部队已创建，移动鼠标并点击地图放置到${safeTeam === TEAM_DEFENDER ? '右侧红色' : '左侧蓝色'}部署区`);
    return true;
  }, [onDeployGroupFormationsChange, pointerWorldRef, runtimeRef, setDeployNotice, stageDeployGroupForPlacement]);

  const handleOpenTemplateFillPreview = useCallback((template, team = TEAM_ATTACKER) => {
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const snapshot = buildTemplateFillSnapshot(template, safeTeam);
    setTemplateFillPreview({
      ...createDefaultTemplateFillPreview(),
      open: true,
      mode: 'create',
      team: safeTeam,
      controlMode: safeTeam === TEAM_DEFENDER ? 'AI' : 'USER',
      template,
      name: String(template?.name || '').trim(),
      rows: snapshot.rows,
      totalRequested: snapshot.totalRequested,
      totalFilled: snapshot.totalFilled,
      maxTotal: snapshot.maxTotal,
      stats: snapshot.stats
    });
  }, [buildTemplateFillSnapshot, setTemplateFillPreview]);

  const handleOpenTemplateFillEditor = useCallback((groupId) => {
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
    const safeTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const rosterNames = new Map(runtime.getRosterRows(safeTeam).map((row) => [row.unitTypeId, row.unitName]));
    const units = Object.entries(group.units || {})
      .map(([unitTypeId, count]) => ({
        unitTypeId: String(unitTypeId || '').trim(),
        unitName: rosterNames.get(unitTypeId) || unitTypeId,
        count: Math.max(0, Math.floor(Number(count) || 0))
      }))
      .filter((entry) => entry.unitTypeId && entry.count > 0);
    if (units.length <= 0) {
      setDeployNotice('当前部队没有可编辑兵力');
      return;
    }
    const template = {
      templateId: String(group.templateId || '').trim(),
      name: String(group.templateName || group.name || '').trim(),
      units,
      formations: Array.isArray(group.templateFormations) ? group.templateFormations : []
    };
    const snapshot = buildTemplateFillSnapshot(template, safeTeam, getGroupTotal(group.units), group.id);
    setTemplateFillPreview({
      ...createDefaultTemplateFillPreview(),
      open: true,
      mode: 'edit',
      editingGroupId: group.id,
      team: safeTeam,
      template,
      name: String(group.name || '').trim(),
      rows: snapshot.rows,
      totalRequested: snapshot.totalRequested,
      totalFilled: snapshot.totalFilled,
      maxTotal: snapshot.maxTotal,
      stats: snapshot.stats
    });
  }, [buildTemplateFillSnapshot, isTrainingMode, runtimeRef, setDeployNotice, setTemplateFillPreview]);

  const handleChangeTemplateFillTotal = useCallback((totalCount) => {
    setTemplateFillPreview((previous) => {
      if (!previous?.template) return previous;
      const snapshot = buildTemplateFillSnapshot(
        previous.template,
        previous.team,
        totalCount,
        previous.mode === 'edit' ? previous.editingGroupId : ''
      );
      return {
        ...previous,
        rows: snapshot.rows,
        totalRequested: snapshot.totalRequested,
        totalFilled: snapshot.totalFilled,
        maxTotal: snapshot.maxTotal,
        stats: snapshot.stats
      };
    });
  }, [buildTemplateFillSnapshot, setTemplateFillPreview]);

  const handleChangeTemplateFillTeam = useCallback((team) => {
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    setTemplateFillPreview((previous) => {
      if (!previous?.template || previous.mode === 'edit') return previous;
      const snapshot = buildTemplateFillSnapshot(previous.template, safeTeam, previous.totalRequested);
      return {
        ...previous,
        team: safeTeam,
        controlMode: safeTeam === TEAM_DEFENDER ? 'AI' : 'USER',
        rows: snapshot.rows,
        totalRequested: snapshot.totalRequested,
        totalFilled: snapshot.totalFilled,
        maxTotal: snapshot.maxTotal,
        stats: snapshot.stats
      };
    });
  }, [buildTemplateFillSnapshot, setTemplateFillPreview]);

  const handleChangeTemplateFillName = useCallback((name) => {
    const safeName = typeof name === 'string' ? limitNameByDisplayWidth(name) : '';
    setTemplateFillPreview((previous) => ({ ...previous, name: safeName }));
  }, [setTemplateFillPreview]);

  const handleChangeTemplateFillControlMode = useCallback((controlMode) => {
    setTemplateFillPreview((previous) => ({
      ...previous,
      controlMode: controlMode === 'AI' ? 'AI' : 'USER'
    }));
  }, [setTemplateFillPreview]);

  const handleCloseTemplateFillPreview = useCallback(() => {
    setTemplateFillPreview(createDefaultTemplateFillPreview());
  }, [setTemplateFillPreview]);

  const handleConfirmTemplateFillPreview = useCallback(() => {
    const template = templateFillPreview.template;
    if (!template) return;
    const safeTeam = templateFillPreview.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const isEditing = templateFillPreview.mode === 'edit' && !!templateFillPreview.editingGroupId;
    const snapshot = buildTemplateFillSnapshot(
      template,
      safeTeam,
      templateFillPreview.totalRequested,
      isEditing ? templateFillPreview.editingGroupId : ''
    );
    if (snapshot.totalRequested <= 0 || snapshot.totalFilled !== snapshot.totalRequested) {
      setDeployNotice('当前库存不足以按模板创建部队');
      return;
    }
    const unitsMap = snapshot.rows.reduce((result, row) => {
      if (row.filled > 0) result[row.unitTypeId] = row.filled;
      return result;
    }, {});
    if (isEditing) {
      const runtime = runtimeRef.current;
      const result = runtime?.updateDeployGroup(safeTeam, templateFillPreview.editingGroupId, {
        name: String(templateFillPreview.name || '').trim(),
        units: unitsMap
      });
      if (!result?.ok) {
        setDeployNotice(result?.reason || '编辑部队失败');
        return;
      }
      stageDeployGroupForPlacement(runtime, templateFillPreview.editingGroupId, safeTeam);
      handleCloseTemplateFillPreview();
      setDeployNotice('部队已更新，移动鼠标并点击地图重新放置');
      return;
    }
    const created = createDeployGroupFromTemplateUnits(
      safeTeam,
      unitsMap,
      template,
      templateFillPreview.name,
      templateFillPreview.controlMode
    );
    if (created) handleCloseTemplateFillPreview();
  }, [
    buildTemplateFillSnapshot,
    createDeployGroupFromTemplateUnits,
    handleCloseTemplateFillPreview,
    runtimeRef,
    setDeployNotice,
    stageDeployGroupForPlacement,
    templateFillPreview
  ]);

  const handleRecallDeployDraggingGroup = useCallback((groupId = '', team = TEAM_ATTACKER) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') {
      return { ok: false, reason: '当前不在部署阶段' };
    }
    const safeGroupId = typeof groupId === 'string' ? groupId.trim() : '';
    const safeTeam = team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (!safeGroupId) {
      setDeployNotice('未找到待放置部队，无法撤回');
      return { ok: false, reason: '未找到待放置部队' };
    }
    const group = runtime.getDeployGroupById(safeGroupId, safeTeam) || runtime.getDeployGroupById(safeGroupId, 'any');
    if (!group) {
      setDeployNotice('未找到待放置部队，无法撤回');
      return { ok: false, reason: '未找到待放置部队' };
    }
    const resolvedTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = typeof runtime.cancelDeployGroupPlacement === 'function'
      ? runtime.cancelDeployGroupPlacement(resolvedTeam, group.id)
      : { ok: runtime.setDeployGroupPlaced(resolvedTeam, group.id, false) };
    if (result === false || result?.ok === false) {
      setDeployNotice(result?.reason || '取消放置失败');
      return { ok: false, reason: result?.reason || '取消放置失败' };
    }
    runtime.clearSelection?.();
    setSelectedSquadId('');
    setDeployDraggingGroup({ groupId: '', team: TEAM_ATTACKER });
    setDeployActionAnchorMode('');
    syncCardsAndMinimap(runtime);
    setDeployNotice('已取消鼠标吸附，部队保留在卡片中，可通过移动按钮再次放置');
    return { ok: true, groupId: group.id, team: resolvedTeam };
  }, [
    runtimeRef,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployNotice,
    setSelectedSquadId,
    syncCardsAndMinimap
  ]);

  return {
    handleOpenTemplateFillPreview,
    handleOpenTemplateFillEditor,
    handleChangeTemplateFillTotal,
    handleChangeTemplateFillTeam,
    handleChangeTemplateFillName,
    handleChangeTemplateFillControlMode,
    handleCloseTemplateFillPreview,
    handleConfirmTemplateFillPreview,
    handleRecallDeployDraggingGroup
  };
}
