import {
  BATTLE_PITCH_HIGH_DEG,
  BATTLE_PITCH_LOW_DEG,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_PICK,
  SPEED_MODE_AUTO,
  SPEED_MODE_B,
  TEAM_ATTACKER,
  TEAM_DEFENDER
} from '../screens/battleSceneConstants';
import {
  buildDeployFormationFootprint,
  buildDomLineStyle,
  normalizeDraftUnits,
  parseQuickDeployNumber,
  unitsToSummary
} from '../screens/battleSceneUtils';

const useBattleSceneDerivedState = ({
  runtimeRef,
  phase,
  cards,
  selectedSquadId,
  battleUiMode,
  skillPopupSquadId,
  cameraRef,
  isTrainingMode,
  deployEditingGroupId,
  deployEditorTeam,
  deployEditorDraft,
  deployDraggingGroupId,
  worldToDomRef,
  deployActionAnchorMode,
  worldActionsVisibleForSquadId,
  pendingPathPoints,
  confirmDeleteGroupId,
  quickDeployRandomForm,
  debugEnabled,
  showMidlineDebug,
  debugStats
}) => {
  const runtime = runtimeRef.current;
  const worldToDom = worldToDomRef.current;

  const selectedSquad = (() => {
    if (!runtime) return null;
    if (runtime.getPhase() !== 'battle') return null;
    return runtime.getSquadById(selectedSquadId);
  })();

  const selectedCardRow = cards.find((row) => row.id === selectedSquadId) || null;
  const skillPopupTargetSquadId = (battleUiMode === BATTLE_UI_MODE_SKILL_PICK && skillPopupSquadId)
    ? skillPopupSquadId
    : '';
  const skillPopupMeta = (phase === 'battle' && runtime && skillPopupTargetSquadId)
    ? runtime.getSkillMetaForSquad(skillPopupTargetSquadId)
    : { skills: [], cooldownRemain: 0 };
  const selectedSpeedModeUi = selectedCardRow
    ? (selectedCardRow.speedModeAuthority === 'USER'
      ? (selectedCardRow.speedMode || SPEED_MODE_B)
      : SPEED_MODE_AUTO)
    : SPEED_MODE_B;
  const selectedWaypoints = selectedSquad && Array.isArray(selectedSquad.waypoints) ? selectedSquad.waypoints : [];

  const pitchLabel = cameraRef.current.getPitchBlend() >= 0.5
    ? `${Math.round(Number(cameraRef.current.pitchHigh) || BATTLE_PITCH_HIGH_DEG)}°`
    : `${Math.round(Number(cameraRef.current.pitchLow) || BATTLE_PITCH_LOW_DEG)}°`;

  const deployEditorIsTeamAuto = isTrainingMode && !deployEditingGroupId;
  const deployRosterRows = (() => {
    if (!runtime) return [];
    if (!deployEditorIsTeamAuto) return runtime.getRosterRows(deployEditorTeam);
    const byUnitType = new Map();
    runtime.getRosterRows(TEAM_ATTACKER).forEach((row) => {
      byUnitType.set(row.unitTypeId, {
        ...row,
        available: Math.max(0, Math.floor(Number(row?.available) || 0))
      });
    });
    runtime.getRosterRows(TEAM_DEFENDER).forEach((row) => {
      const safeAvailable = Math.max(0, Math.floor(Number(row?.available) || 0));
      const prev = byUnitType.get(row.unitTypeId);
      if (!prev) {
        byUnitType.set(row.unitTypeId, { ...row, available: safeAvailable });
        return;
      }
      byUnitType.set(row.unitTypeId, {
        ...prev,
        unitName: prev.unitName || row.unitName || row.unitTypeId,
        available: Math.max(prev.available, safeAvailable)
      });
    });
    return Array.from(byUnitType.values());
  })();

  const deployEditingGroup = deployEditingGroupId ? runtime?.getDeployGroupById?.(deployEditingGroupId, deployEditorTeam) : null;
  const deployEditingBaseUnits = deployEditingGroup?.units || {};
  const deployEditorAvailableRows = deployRosterRows
    .map((row) => ({
      ...row,
      availableForDraft: Math.max(0, row.available + Math.max(0, Number(deployEditingBaseUnits[row.unitTypeId]) || 0))
    }))
    .sort((a, b) => a.unitName.localeCompare(b.unitName, 'zh-Hans-CN'));
  const deployEditorDraftSummary = unitsToSummary(
    deployEditorDraft.units,
    new Map(deployRosterRows.map((row) => [row.unitTypeId, row.unitName]))
  );
  const deployEditorTeamLabel = deployEditorIsTeamAuto
    ? '落点决定阵营'
    : (deployEditorTeam === TEAM_DEFENDER ? '敌方' : '我方');
  const deployEditorTotal = normalizeDraftUnits(deployEditorDraft.units).reduce((sum, entry) => sum + entry.count, 0);

  const selectedDeployGroup = phase === 'deploy' ? runtime?.getDeployGroupById?.(selectedSquadId) : null;
  const selectedDeployFormation = (
    phase === 'deploy'
    && selectedDeployGroup
    && selectedDeployGroup.placed !== false
    && !deployDraggingGroupId
  ) ? buildDeployFormationFootprint(selectedDeployGroup) : null;
  const selectedDeployFormationCornerDom = (
    selectedDeployFormation
    && worldToDom
  ) ? selectedDeployFormation.corners.map((corner) => worldToDom({ x: corner.x, y: corner.y, z: 0 })) : [];
  const selectedDeployFormationLines = selectedDeployFormationCornerDom.length === 4
    ? [0, 1, 2, 3]
      .map((idx) => {
        const a = selectedDeployFormationCornerDom[idx];
        const b = selectedDeployFormationCornerDom[(idx + 1) % 4];
        if (!a || !b || a.visible === false || b.visible === false) return null;
        return buildDomLineStyle(a, b);
      })
      .filter(Boolean)
    : [];
  const selectedDeployHandleLeftDom = (
    selectedDeployFormation
    && worldToDom
  ) ? worldToDom({ x: selectedDeployFormation.leftHandle.x, y: selectedDeployFormation.leftHandle.y, z: 0 }) : null;
  const selectedDeployHandleRightDom = (
    selectedDeployFormation
    && worldToDom
  ) ? worldToDom({ x: selectedDeployFormation.rightHandle.x, y: selectedDeployFormation.rightHandle.y, z: 0 }) : null;

  const worldActionGroupId = selectedDeployGroup?.id || '';
  const worldActionPos = (
    phase === 'deploy'
    && deployActionAnchorMode === 'world'
    && worldActionGroupId
    && worldToDom
  )
    ? worldToDom({ x: selectedDeployGroup.x, y: selectedDeployGroup.y, z: 0 })
    : null;

  const selectedBattleActionSquad = (
    phase === 'battle'
    && runtime
    && worldActionsVisibleForSquadId
  ) ? runtime.getSquadById(worldActionsVisibleForSquadId) : null;

  const pathPlanningTailPoint = (
    phase === 'battle'
    && battleUiMode === BATTLE_UI_MODE_PATH
    && Array.isArray(pendingPathPoints)
    && pendingPathPoints.length > 0
  ) ? pendingPathPoints[pendingPathPoints.length - 1] : null;
  const pathPlanningTailDom = (
    pathPlanningTailPoint
    && worldToDom
  ) ? worldToDom({
    x: Number(pathPlanningTailPoint.x) || 0,
    y: Number(pathPlanningTailPoint.y) || 0,
    z: 0
  }) : null;

  const confirmDeleteGroup = (
    phase === 'deploy'
    && confirmDeleteGroupId
    && runtime
  )
    ? runtime.getDeployGroupById(confirmDeleteGroupId)
    : null;

  const quickParsedAttackerTeams = parseQuickDeployNumber(quickDeployRandomForm.attackerTeamCount);
  const quickParsedDefenderTeams = parseQuickDeployNumber(quickDeployRandomForm.defenderTeamCount);
  const quickParsedAttackerTotal = parseQuickDeployNumber(quickDeployRandomForm.attackerTotal);
  const quickParsedDefenderTotal = parseQuickDeployNumber(quickDeployRandomForm.defenderTotal);

  const currentField = runtime?.getField?.() || { width: 2700, height: 1488 };
  const canDrawMidlineDebug = debugEnabled && showMidlineDebug && !!worldToDom;
  const midlineTop = canDrawMidlineDebug ? worldToDom({ x: 0, y: (Number(currentField?.height) || 1488) * 0.5, z: 0 }) : null;
  const midlineBottom = canDrawMidlineDebug ? worldToDom({ x: 0, y: -(Number(currentField?.height) || 1488) * 0.5, z: 0 }) : null;
  const midlineLineStyle = (midlineTop?.visible !== false && midlineBottom?.visible !== false)
    ? buildDomLineStyle(midlineTop, midlineBottom)
    : null;

  const teamMinX = Number(debugStats?.clampAllowedMinX);
  const teamMaxX = Number(debugStats?.clampAllowedMaxX);
  const teamMinTop = canDrawMidlineDebug && Number.isFinite(teamMinX)
    ? worldToDom({ x: teamMinX, y: (Number(currentField?.height) || 1488) * 0.5, z: 0 })
    : null;
  const teamMinBottom = canDrawMidlineDebug && Number.isFinite(teamMinX)
    ? worldToDom({ x: teamMinX, y: -(Number(currentField?.height) || 1488) * 0.5, z: 0 })
    : null;
  const teamMaxTop = canDrawMidlineDebug && Number.isFinite(teamMaxX)
    ? worldToDom({ x: teamMaxX, y: (Number(currentField?.height) || 1488) * 0.5, z: 0 })
    : null;
  const teamMaxBottom = canDrawMidlineDebug && Number.isFinite(teamMaxX)
    ? worldToDom({ x: teamMaxX, y: -(Number(currentField?.height) || 1488) * 0.5, z: 0 })
    : null;
  const teamMinLineStyle = (teamMinTop?.visible !== false && teamMinBottom?.visible !== false)
    ? buildDomLineStyle(teamMinTop, teamMinBottom)
    : null;
  const teamMaxLineStyle = (teamMaxTop?.visible !== false && teamMaxBottom?.visible !== false)
    ? buildDomLineStyle(teamMaxTop, teamMaxBottom)
    : null;

  return {
    selectedSquad,
    selectedCardRow,
    skillPopupTargetSquadId,
    skillPopupMeta,
    selectedSpeedModeUi,
    selectedWaypoints,
    pitchLabel,
    deployEditorAvailableRows,
    deployEditorDraftSummary,
    deployEditorTeamLabel,
    deployEditorTotal,
    selectedDeployGroup,
    selectedDeployFormation,
    selectedDeployFormationLines,
    selectedDeployHandleLeftDom,
    selectedDeployHandleRightDom,
    worldActionGroupId,
    worldActionPos,
    selectedBattleActionSquad,
    pathPlanningTailDom,
    confirmDeleteGroup,
    quickParsedAttackerTeams,
    quickParsedDefenderTeams,
    quickParsedAttackerTotal,
    quickParsedDefenderTotal,
    canDrawMidlineDebug,
    midlineLineStyle,
    teamMinLineStyle,
    teamMaxLineStyle
  };
};

export default useBattleSceneDerivedState;
