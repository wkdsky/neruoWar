import { useCallback } from 'react';
import {
  BATTLE_FOLLOW_MIRROR_X,
  BATTLE_FOLLOW_WORLD_YAW_DEG,
  BATTLE_FOLLOW_YAW_DEG,
  BATTLE_PITCH_HIGH_DEG,
  BATTLE_PITCH_LOW_DEG,
  BATTLE_UI_MODE_SPACING_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultAimState,
  createDefaultDeployDraggingGroup,
  createDefaultPopupPos
} from '../screens/battleSceneConstants';

export const focusDeployZoneIfOffscreen = ({
  runtime,
  camera,
  cameraViewRectRef,
  team = TEAM_ATTACKER
} = {}) => {
  if (team !== TEAM_DEFENDER || !runtime || !camera) return false;
  const deployRange = runtime.getDeployRange?.() || {};
  const zoneMinX = Number(deployRange.defenderMinX);
  const zoneMaxX = Number(deployRange.maxX);
  if (!Number.isFinite(zoneMinX) || !Number.isFinite(zoneMaxX) || zoneMaxX < zoneMinX) return false;

  const viewportWidth = Number(cameraViewRectRef?.current?.widthWorld);
  if (Number.isFinite(viewportWidth) && viewportWidth > 0) {
    const halfViewportWidth = viewportWidth * 0.5;
    const viewMinX = (Number(camera.centerX) || 0) - halfViewportWidth;
    const viewMaxX = (Number(camera.centerX) || 0) + halfViewportWidth;
    if (viewMaxX >= zoneMinX && viewMinX <= zoneMaxX) return false;
  }

  camera.centerX = (zoneMinX + zoneMaxX) * 0.5;
  camera.centerY = 0;
  return true;
};

export const activateUnplacedTrainingGroup = ({
  runtime,
  squadId,
  camera,
  cameraViewRectRef,
  setSelectedSquadId,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setCards,
  setMinimapSnapshot
} = {}) => {
  const group = runtime?.getDeployGroupById?.(squadId, 'any');
  if (!group || group.placed !== false) return false;
  const team = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
  runtime.setSelectedDeployGroup(squadId);
  runtime.setFocusSquad(squadId);
  runtime.setDeployGroupPlaced(team, squadId, false);
  setSelectedSquadId?.(squadId);
  focusDeployZoneIfOffscreen({ runtime, camera, cameraViewRectRef, team });
  setDeployDraggingGroup?.({ groupId: squadId, team });
  setDeployActionAnchorMode?.('');
  setCards?.(runtime.getCardRows?.() || []);
  setMinimapSnapshot?.(runtime.getMinimapSnapshot?.() || null);
  return true;
};

export default function useBattleSceneSelection({
  runtimeRef,
  cameraRef,
  cameraViewRectRef,
  startBattle,
  isTrainingMode = false,
  setPhase,
  setBattleStatus,
  setCards,
  setSelectedSquadId,
  setResultState,
  setAimState,
  setBattleUiMode,
  setWorldActionsVisibleForSquadId,
  setHoverSquadIdOnCard,
  setPendingPathPoints,
  setPlanningHoverPoint,
  setSkillConfirmState,
  setSpacingPickOpen,
  setSpacingPopupPos,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setSelectedPaletteItemId,
  setQuickDeployOpen,
  setQuickDeployApplying,
  setQuickDeployError,
  setDeployNotice,
  setMinimapSnapshot
} = {}) {
  const handleStartBattle = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const result = startBattle();
    if (!result?.ok) {
      setResultState((prev) => ({ ...prev, open: true, error: result?.reason || '无法开战', summary: null }));
      return;
    }
    const anchor = runtime.getFocusAnchor();
    const focusedSquadId = String(anchor?.squadId || '');
    const focusedSquad = focusedSquadId ? runtime.getSquadById?.(focusedSquadId) : null;
    const canControlFocusedSquad = !!focusedSquad && runtime.canControlSquad?.(focusedSquad);
    if (focusedSquadId) {
      setSelectedSquadId(focusedSquadId);
      cameraRef.current.centerX = Number(anchor?.x) || 0;
      cameraRef.current.centerY = Number(anchor?.y) || 0;
      cameraRef.current.yawDeg = BATTLE_FOLLOW_YAW_DEG;
      cameraRef.current.worldYawDeg = BATTLE_FOLLOW_WORLD_YAW_DEG;
      cameraRef.current.mirrorX = BATTLE_FOLLOW_MIRROR_X;
      cameraRef.current.pitchLow = BATTLE_PITCH_LOW_DEG;
      cameraRef.current.pitchHigh = BATTLE_PITCH_HIGH_DEG;
      cameraRef.current.currentPitch = cameraRef.current.pitchLow;
      cameraRef.current.pitchFrom = cameraRef.current.pitchLow;
      cameraRef.current.pitchTo = cameraRef.current.pitchLow;
      cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
    } else {
      cameraRef.current.clearFollow?.();
      setSelectedSquadId('');
    }
    setPhase(runtime.getPhase());
    setBattleStatus(runtime.getBattleStatus());
    setCards(runtime.getCardRows());
    setAimState(createDefaultAimState());
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setWorldActionsVisibleForSquadId(!isTrainingMode && canControlFocusedSquad ? focusedSquadId : '');
    setHoverSquadIdOnCard('');
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setSkillConfirmState(null);
    setSpacingPickOpen(false);
    setSpacingPopupPos(createDefaultPopupPos());
    setDeployDraggingGroup(createDefaultDeployDraggingGroup());
    setDeployActionAnchorMode('');
    setSelectedPaletteItemId('');
    setQuickDeployOpen(false);
    setQuickDeployApplying(false);
    setQuickDeployError('');
    setDeployNotice?.('');
  }, [
    cameraRef,
    runtimeRef,
    setAimState,
    setBattleStatus,
    setBattleUiMode,
    setCards,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setHoverSquadIdOnCard,
    setSpacingPickOpen,
    setSpacingPopupPos,
    setPendingPathPoints,
    setPhase,
    setPlanningHoverPoint,
    setQuickDeployApplying,
    setQuickDeployError,
    setQuickDeployOpen,
    setResultState,
    setDeployNotice,
    setSelectedPaletteItemId,
    setSelectedSquadId,
    setSkillConfirmState,
    setWorldActionsVisibleForSquadId,
    isTrainingMode,
    startBattle
  ]);

  const handleCardFocus = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy' && !isTrainingMode) {
      const row = runtime.getCardRows().find((item) => item.id === squadId);
      if (row?.team === TEAM_DEFENDER) return;
    }
    runtime.setFocusSquad(squadId);
    if (runtime.getPhase() === 'deploy') {
      setDeployActionAnchorMode('card');
    } else {
      const squad = runtime.getSquadById?.(squadId);
      setWorldActionsVisibleForSquadId(
        !isTrainingMode && runtime.canControlSquad?.(squad) ? String(squadId || '') : ''
      );
    }
  }, [isTrainingMode, runtimeRef, setDeployActionAnchorMode, setWorldActionsVisibleForSquadId]);

  const handleCardSelect = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      const row = runtime.getCardRows().find((item) => item.id === squadId);
      if (!isTrainingMode && row?.team === TEAM_DEFENDER) return;
      if (isTrainingMode && activateUnplacedTrainingGroup({
        runtime,
        squadId,
        camera: cameraRef.current,
        cameraViewRectRef,
        setSelectedSquadId,
        setDeployDraggingGroup,
        setDeployActionAnchorMode,
        setCards,
        setMinimapSnapshot
      })) {
        return;
      }
      runtime.setSelectedDeployGroup(squadId);
      runtime.setFocusSquad(squadId);
      setSelectedSquadId(squadId);
      setCards(runtime.getCardRows());
      setDeployActionAnchorMode('card');
      return;
    }
    const squad = runtime.getSquadById?.(squadId);
    const canControl = runtime.canControlSquad?.(squad);
    if (!squad || !runtime.setSelectedBattleSquad?.(squadId)) return;

    runtime.setFocusSquad(squadId);
    const anchor = runtime.getFocusAnchor();
    cameraRef.current.beginFocusTransition(anchor);
    setSelectedSquadId(squadId);
    setWorldActionsVisibleForSquadId(!isTrainingMode && canControl ? squadId : '');
    setBattleUiMode((prev) => (
      prev === BATTLE_UI_MODE_PATH || prev === BATTLE_UI_MODE_SKILL_CONFIRM || prev === BATTLE_UI_MODE_SPACING_PICK
        ? prev
        : BATTLE_UI_MODE_NONE
    ));
    setCards(runtime.getCardRows());
  }, [
    cameraRef,
    cameraViewRectRef,
    isTrainingMode,
    runtimeRef,
    setBattleUiMode,
    setCards,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setMinimapSnapshot,
    setSelectedSquadId,
    setWorldActionsVisibleForSquadId
  ]);

  const isPointInsideBattleField = useCallback((point) => {
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    const field = runtime.getField?.();
    const halfW = Math.max(10, Number(field?.width) || 2700) * 0.5;
    const halfH = Math.max(10, Number(field?.height) || 1488) * 0.5;
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x >= -halfW && x <= halfW && y >= -halfH && y <= halfH;
  }, [runtimeRef]);

  const isPathPointBlocked = useCallback((point) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return true;
    if (!isPointInsideBattleField(point)) return true;
    const hit = runtime.pickBuilding(point, 8);
    return !!hit;
  }, [isPointInsideBattleField, runtimeRef]);

  return {
    handleStartBattle,
    handleCardFocus,
    handleCardSelect,
    isPathPointBlocked
  };
}
