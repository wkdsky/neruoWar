import { useCallback } from 'react';
import {
  QUICK_DEPLOY_MAX_TEAM_COUNT,
  QUICK_DEPLOY_MAX_TOTAL,
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultConfirmDeletePos,
  createDefaultDeployDraggingGroup,
  createDefaultDeployEditorDraft,
  createDefaultDeployQuantityDialog
} from '../screens/battleSceneConstants';
import {
  buildRandomGroups,
  buildStandardGroups,
  buildTeamPositions,
  parseQuickDeployNumber
} from '../screens/battleSceneUtils';

const toPositiveInteger = (value) => Math.max(0, Math.floor(Number(value) || 0));

export default function useBattleQuickDeploy({
  runtimeRef,
  isTrainingMode = false,
  quickDeployApplying = false,
  quickDeployRandomForm,
  syncDeployUiFromRuntime,
  setQuickDeployOpen,
  setQuickDeployTab,
  setQuickDeployError,
  setQuickDeployRandomForm,
  setQuickDeployApplying,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setDeployEditorOpen,
  setDeployEditingGroupId,
  setDeployEditorTeam,
  setDeployEditorDraft,
  setDeployEditorDragUnitId,
  setDeployQuantityDialog,
  setConfirmDeleteGroupId,
  setConfirmDeletePos,
  setSelectedPaletteItemId,
  setDeployNotice
} = {}) {
  const handleCloseQuickDeploy = useCallback(() => {
    setQuickDeployOpen(false);
    setQuickDeployApplying(false);
    setQuickDeployError('');
  }, [setQuickDeployApplying, setQuickDeployError, setQuickDeployOpen]);

  const handleQuickDeployTabChange = useCallback((tab) => {
    setQuickDeployTab(tab === 'random' ? 'random' : 'standard');
    setQuickDeployError('');
  }, [setQuickDeployError, setQuickDeployTab]);

  const handleQuickDeployRandomFieldChange = useCallback((key, value) => {
    if (key !== 'attackerTeamCount' && key !== 'defenderTeamCount' && key !== 'attackerTotal' && key !== 'defenderTotal') return;
    setQuickDeployRandomForm((prev) => ({ ...prev, [key]: value }));
  }, [setQuickDeployRandomForm]);

  const validateQuickDeployConfig = useCallback((config, runtime) => {
    const attackerTeamCount = parseQuickDeployNumber(config?.attackerTeamCount);
    const defenderTeamCount = parseQuickDeployNumber(config?.defenderTeamCount);
    const attackerTotal = parseQuickDeployNumber(config?.attackerTotal);
    const defenderTotal = parseQuickDeployNumber(config?.defenderTotal);
    if (!Number.isInteger(attackerTeamCount) || attackerTeamCount < 1 || attackerTeamCount > QUICK_DEPLOY_MAX_TEAM_COUNT) {
      return { ok: false, error: `我方部队数需为 1-${QUICK_DEPLOY_MAX_TEAM_COUNT} 的整数` };
    }
    if (!Number.isInteger(defenderTeamCount) || defenderTeamCount < 1 || defenderTeamCount > QUICK_DEPLOY_MAX_TEAM_COUNT) {
      return { ok: false, error: `敌方部队数需为 1-${QUICK_DEPLOY_MAX_TEAM_COUNT} 的整数` };
    }
    if (!Number.isInteger(attackerTotal) || attackerTotal < 1 || attackerTotal > QUICK_DEPLOY_MAX_TOTAL) {
      return { ok: false, error: `我方总人数需为 1-${QUICK_DEPLOY_MAX_TOTAL} 的整数` };
    }
    if (!Number.isInteger(defenderTotal) || defenderTotal < 1 || defenderTotal > QUICK_DEPLOY_MAX_TOTAL) {
      return { ok: false, error: `敌方总人数需为 1-${QUICK_DEPLOY_MAX_TOTAL} 的整数` };
    }
    if (attackerTotal < attackerTeamCount) {
      return { ok: false, error: '我方总人数不能小于我方部队数（每支至少 1 人）' };
    }
    if (defenderTotal < defenderTeamCount) {
      return { ok: false, error: '敌方总人数不能小于敌方部队数（每支至少 1 人）' };
    }
    const attackerRosterRows = runtime.getRosterRows(TEAM_ATTACKER).filter((row) => toPositiveInteger(row?.total) > 0);
    const defenderRosterRows = runtime.getRosterRows(TEAM_DEFENDER).filter((row) => toPositiveInteger(row?.total) > 0);
    if (attackerRosterRows.length <= 0) return { ok: false, error: '我方没有可用兵种，无法一键布置' };
    if (defenderRosterRows.length <= 0) return { ok: false, error: '敌方没有可用兵种，无法一键布置' };
    const attackerCapacity = attackerRosterRows.reduce((sum, row) => sum + toPositiveInteger(row?.total), 0);
    const defenderCapacity = defenderRosterRows.reduce((sum, row) => sum + toPositiveInteger(row?.total), 0);
    if (attackerTotal > attackerCapacity) return { ok: false, error: `我方总人数超出可用上限（${attackerCapacity}）` };
    if (defenderTotal > defenderCapacity) return { ok: false, error: `敌方总人数超出可用上限（${defenderCapacity}）` };
    return {
      ok: true,
      values: {
        attackerTeamCount,
        defenderTeamCount,
        attackerTotal,
        defenderTotal,
        attackerRosterRows,
        defenderRosterRows
      }
    };
  }, []);

  const applyQuickDeploy = useCallback((mode, config) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') {
      setQuickDeployError('仅部署阶段可使用一键布置');
      return false;
    }
    if (!isTrainingMode) {
      setQuickDeployError('仅训练场可使用一键布置');
      return false;
    }

    const validated = validateQuickDeployConfig(config, runtime);
    if (!validated.ok) {
      setQuickDeployError(validated.error || '配置校验失败');
      return false;
    }

    const {
      attackerTeamCount,
      defenderTeamCount,
      attackerTotal,
      defenderTotal,
      attackerRosterRows,
      defenderRosterRows
    } = validated.values;

    try {
      const field = runtime.getField();
      const deployRange = runtime.getDeployRange();
      const attackerPlans = mode === 'standard'
        ? buildStandardGroups({
            teamLabel: '我方',
            teamCount: attackerTeamCount,
            totalPeople: attackerTotal,
            rosterRows: attackerRosterRows
          })
        : buildRandomGroups({
            teamLabel: '我方',
            teamCount: attackerTeamCount,
            totalPeople: attackerTotal,
            rosterRows: attackerRosterRows
          });
      const defenderPlans = mode === 'standard'
        ? buildStandardGroups({
            teamLabel: '敌方',
            teamCount: defenderTeamCount,
            totalPeople: defenderTotal,
            rosterRows: defenderRosterRows
          })
        : buildRandomGroups({
            teamLabel: '敌方',
            teamCount: defenderTeamCount,
            totalPeople: defenderTotal,
            rosterRows: defenderRosterRows
          });

      const attackerPositions = buildTeamPositions({
        team: TEAM_ATTACKER,
        count: attackerPlans.length,
        field,
        deployRange,
        jitter: mode !== 'standard'
      });
      const defenderPositions = buildTeamPositions({
        team: TEAM_DEFENDER,
        count: defenderPlans.length,
        field,
        deployRange,
        jitter: mode !== 'standard'
      });

      setDeployDraggingGroup(createDefaultDeployDraggingGroup());
      setDeployActionAnchorMode('');
      setDeployEditorOpen(false);
      setDeployEditingGroupId('');
      setDeployEditorTeam(TEAM_ATTACKER);
      setDeployEditorDraft(createDefaultDeployEditorDraft());
      setDeployEditorDragUnitId('');
      setDeployQuantityDialog(createDefaultDeployQuantityDialog());
      setConfirmDeleteGroupId('');
      setConfirmDeletePos(createDefaultConfirmDeletePos());
      setSelectedPaletteItemId('');

      const existing = runtime.getDeployGroups();
      const attackerIds = (existing?.attacker || []).map((group) => String(group?.id || '')).filter(Boolean);
      const defenderIds = (existing?.defender || []).map((group) => String(group?.id || '')).filter(Boolean);
      attackerIds.forEach((groupId) => runtime.removeDeployGroup(TEAM_ATTACKER, groupId));
      defenderIds.forEach((groupId) => runtime.removeDeployGroup(TEAM_DEFENDER, groupId));

      let firstGroupId = '';
      attackerPlans.forEach((plan, idx) => {
        const pos = attackerPositions[idx] || {};
        const result = runtime.createDeployGroup(TEAM_ATTACKER, {
          name: plan.name,
          units: plan.units,
          x: pos.x,
          y: pos.y,
          placed: true
        });
        if (!result?.ok) throw new Error(result?.reason || '创建我方部队失败');
        if (!firstGroupId) firstGroupId = result.groupId || '';
      });
      defenderPlans.forEach((plan, idx) => {
        const pos = defenderPositions[idx] || {};
        const result = runtime.createDeployGroup(TEAM_DEFENDER, {
          name: plan.name,
          units: plan.units,
          x: pos.x,
          y: pos.y,
          placed: true
        });
        if (!result?.ok) throw new Error(result?.reason || '创建敌方部队失败');
      });

      syncDeployUiFromRuntime(runtime, firstGroupId);
      setQuickDeployOpen(false);
      setQuickDeployError('');
      setDeployNotice(
        `${mode === 'standard' ? '标准' : '随机'}配置完成：我方 ${attackerTeamCount} 支 / ${attackerTotal} 人，敌方 ${defenderTeamCount} 支 / ${defenderTotal} 人`
      );
      return true;
    } catch (quickDeployApplyError) {
      setQuickDeployError(quickDeployApplyError?.message || '一键布置失败');
      syncDeployUiFromRuntime(runtime);
      return false;
    }
  }, [
    isTrainingMode,
    runtimeRef,
    setConfirmDeleteGroupId,
    setConfirmDeletePos,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployEditorDraft,
    setDeployEditorDragUnitId,
    setDeployEditorOpen,
    setDeployEditorTeam,
    setDeployEditingGroupId,
    setDeployNotice,
    setDeployQuantityDialog,
    setQuickDeployError,
    setQuickDeployOpen,
    setSelectedPaletteItemId,
    syncDeployUiFromRuntime,
    validateQuickDeployConfig
  ]);

  const handleApplyStandardQuickDeploy = useCallback((preset) => {
    if (!preset || quickDeployApplying) return;
    setQuickDeployApplying(true);
    try {
      applyQuickDeploy('standard', {
        attackerTeamCount: String(preset.attackerTeamCount),
        defenderTeamCount: String(preset.defenderTeamCount),
        attackerTotal: String(preset.attackerTotal),
        defenderTotal: String(preset.defenderTotal)
      });
    } finally {
      setQuickDeployApplying(false);
    }
  }, [applyQuickDeploy, quickDeployApplying, setQuickDeployApplying]);

  const handleApplyRandomQuickDeploy = useCallback(() => {
    if (quickDeployApplying) return;
    setQuickDeployApplying(true);
    try {
      applyQuickDeploy('random', quickDeployRandomForm);
    } finally {
      setQuickDeployApplying(false);
    }
  }, [applyQuickDeploy, quickDeployApplying, quickDeployRandomForm, setQuickDeployApplying]);

  return {
    handleCloseQuickDeploy,
    handleQuickDeployTabChange,
    handleQuickDeployRandomFieldChange,
    handleApplyStandardQuickDeploy,
    handleApplyRandomQuickDeploy
  };
}
