import { useCallback } from 'react';
import {
  BATTLE_UI_MODE_GUARD,
  BATTLE_UI_MODE_SPACING_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  BATTLE_UI_MODE_SKILL_PICK,
  SPEED_MODE_AUTO,
  SPEED_MODE_B,
  SPEED_MODE_CYCLE
} from '../screens/battleSceneConstants';
import { clamp, skillAoeRadiusByClass, skillRangeByClass } from '../screens/battleSceneUtils';
import {
  getSkillCastProfile,
  skillNeedsTargetSelection,
  SKILL_TARGET_MODE
} from '../../../components/game/skillTree/skillCastProfiles';
import {
  createSkillPaintArea,
  resolveSkillPaintCasterModelCount
} from '../shared/skillPaintArea';

export default function useBattleActions({
  runtimeRef,
  cameraRef,
  glCanvasRef,
  worldToDomRef,
  isTrainingMode = false,
  selectedSquadId = '',
  paused = false,
  battleUiMode = BATTLE_UI_MODE_NONE,
  pendingPathPoints = [],
  setCards,
  setSelectedSquadId,
  setWorldActionsVisibleForSquadId,
  setSkillConfirmState,
  setBattleUiMode,
  setClockPaused,
  setPendingPathPoints,
  setPlanningHoverPoint,
  setSpacingPickOpen,
  setSpacingPopupPos,
  setSkillPopupPos,
  setSkillPopupSquadId
} = {}) {
  const resolvePopupPos = useCallback((payload, fallbackWorld = null) => {
    const canvas = glCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) {
      return { x: 120, y: 120 };
    }
    let x = Number(payload?.clientX) - rect.left;
    let y = Number(payload?.clientY) - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (fallbackWorld && worldToDomRef.current) {
        const dom = worldToDomRef.current({ x: fallbackWorld.x, y: fallbackWorld.y, z: 0 });
        if (dom?.visible) {
          x = Number(dom.x);
          y = Number(dom.y);
        }
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = rect.width * 0.5;
      y = rect.height * 0.5;
    }
    return {
      x: clamp(x, 16, Math.max(16, rect.width - 16)),
      y: clamp(y, 16, Math.max(16, rect.height - 16))
    };
  }, [glCanvasRef, worldToDomRef]);

  const syncBattleCards = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setCards(runtime.getCardRows());
  }, [runtimeRef, setCards]);

  const attackBattleSquadTarget = useCallback((targetSquadId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle' || battleUiMode !== BATTLE_UI_MODE_NONE) return false;
    const selected = runtime.getSquadById?.(selectedSquadId);
    const target = runtime.getSquadById?.(String(targetSquadId || '').trim());
    if (
      !selected
      || !target
      || (Number(selected.remain) || 0) <= 0
      || (Number(target.remain) || 0) <= 0
      || !runtime.canControlSquad?.(selected)
      || String(selected.team || '') === String(target.team || '')
    ) return false;
    if (!runtime.commandAttackTarget?.(selected.id, { targetSquadId: target.id })) return false;
    syncBattleCards();
    return true;
  }, [battleUiMode, runtimeRef, selectedSquadId, syncBattleCards]);

  const selectBattleSquad = useCallback((squadId, showActions = true) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return false;
    const nextId = String(squadId || '');
    const previousId = String(runtime.selectedBattleSquadId || '');
    if (previousId !== nextId && cameraRef.current?.isFollowing?.()) {
      cameraRef.current.clearFollow?.();
    }
    if (!runtime.setSelectedBattleSquad(squadId)) return false;
    const squad = runtime.getSquadById(squadId);
    const canControl = runtime.canControlSquad?.(squad);
    runtime.setFocusSquad(squadId);
    setSelectedSquadId(squadId);
    if (showActions && canControl && !isTrainingMode) {
      setWorldActionsVisibleForSquadId(squadId);
    } else {
      setWorldActionsVisibleForSquadId('');
    }
    syncBattleCards();
    return true;
  }, [cameraRef, isTrainingMode, runtimeRef, setSelectedSquadId, setWorldActionsVisibleForSquadId, syncBattleCards]);

  const followBattleSquad = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return false;
    if (!selectBattleSquad(squadId, true)) return false;
    const squad = runtime.getSquadById?.(squadId);
    if (!squad) return false;
    const anchor = runtime.getSquadCameraAnchor?.(squadId) || {
      x: Number(squad.x) || 0,
      y: Number(squad.y) || 0,
      vx: Number(squad.vx) || 0,
      vy: Number(squad.vy) || 0,
      squadId: String(squad.id || squadId),
      team: squad.team || ''
    };
    if (typeof cameraRef.current?.startFollowing !== 'function') return false;
    return cameraRef.current.startFollowing(anchor) !== false;
  }, [cameraRef, runtimeRef, selectBattleSquad]);

  const closeSkillConfirm = useCallback((resumeBattle = true) => {
    setSkillConfirmState(null);
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    if (resumeBattle) setClockPaused(false);
  }, [setBattleUiMode, setClockPaused, setSkillConfirmState]);

  const closeSkillPick = useCallback(() => {
    if (battleUiMode === BATTLE_UI_MODE_SKILL_PICK) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
    }
    setSkillPopupSquadId('');
  }, [battleUiMode, setBattleUiMode, setSkillPopupSquadId]);

  const commitPathPlanning = useCallback((commit = true) => {
    const runtime = runtimeRef.current;
    if (runtime && commit && selectedSquadId) {
      runtime.commandSetWaypoints(selectedSquadId, pendingPathPoints, { inputType: 'path_planning' });
      syncBattleCards();
    }
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setClockPaused(false);
  }, [
    pendingPathPoints,
    runtimeRef,
    selectedSquadId,
    setBattleUiMode,
    setClockPaused,
    setPendingPathPoints,
    setPlanningHoverPoint,
    syncBattleCards
  ]);

  const closeSpacingPick = useCallback(() => {
    setSpacingPickOpen(false);
    if (battleUiMode === BATTLE_UI_MODE_SPACING_PICK) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setClockPaused(false);
    }
  }, [battleUiMode, setBattleUiMode, setClockPaused, setSpacingPickOpen]);

  const executeBattleAction = useCallback((squadId, actionId, payload = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    if (actionId === 'follow') {
      followBattleSquad(squadId);
      return;
    }
    if (!selectBattleSquad(squadId, true)) return;
    const squad = runtime.getSquadById(squadId);
    if (!squad) return;
    if (!runtime.canControlSquad?.(squad)) return;
    const popupPos = resolvePopupPos(payload, { x: Number(squad.x) || 0, y: Number(squad.y) || 0 });

    if (actionId !== 'formationSpacing') {
      closeSpacingPick();
    }
    if (actionId !== 'skills') {
      closeSkillPick();
    }

    if (actionId === 'planPath') {
      setPendingPathPoints([]);
      setPlanningHoverPoint(null);
      setBattleUiMode(BATTLE_UI_MODE_PATH);
      setClockPaused(true);
      return;
    }
    if (actionId === 'formationSpacing') {
      setBattleUiMode(BATTLE_UI_MODE_SPACING_PICK);
      setSpacingPickOpen(true);
      setSpacingPopupPos(popupPos);
      setClockPaused(true);
      return;
    }
    if (actionId === 'freeAttack') {
      runtime.commandGuard(squadId, {
        centerX: Number(squad.x) || 0,
        centerY: Number(squad.y) || 0,
        radius: Math.max(42, Number(squad.radius) || 24)
      });
      setBattleUiMode(BATTLE_UI_MODE_GUARD);
      setTimeout(() => setBattleUiMode(BATTLE_UI_MODE_NONE), 0);
      syncBattleCards();
      return;
    }
    if (actionId === 'skills') {
      setSkillPopupPos(popupPos);
      setSkillPopupSquadId(squadId);
      setBattleUiMode(BATTLE_UI_MODE_SKILL_PICK);
      setSkillConfirmState(null);
      return;
    }
    if (actionId === 'standby') {
      runtime.commandBehavior(squadId, 'standby');
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      syncBattleCards();
      return;
    }
    if (actionId === 'retreat') {
      runtime.commandBehavior(squadId, 'retreat');
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      syncBattleCards();
    }
  }, [
    closeSpacingPick,
    closeSkillPick,
    followBattleSquad,
    resolvePopupPos,
    runtimeRef,
    selectBattleSquad,
    setBattleUiMode,
    setClockPaused,
    setSpacingPickOpen,
    setSpacingPopupPos,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setSkillConfirmState,
    setSkillPopupPos,
    setSkillPopupSquadId,
    syncBattleCards
  ]);

  const handleSetSpeedMode = useCallback((mode) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const selected = runtime.getSquadById(selectedSquadId);
    if (!selected || !runtime.canControlSquad?.(selected)) return;
    runtime.commandSpeedMode([selected.id], mode, 'USER');
    setCards(runtime.getCardRows());
  }, [runtimeRef, selectedSquadId, setCards]);

  const handleCycleSpeedMode = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const row = runtime.getCardRows().find((item) => item.id === selectedSquadId);
    const current = row
      ? (row.speedModeAuthority === 'USER' ? (row.speedMode || SPEED_MODE_B) : SPEED_MODE_AUTO)
      : SPEED_MODE_B;
    const idx = Math.max(0, SPEED_MODE_CYCLE.indexOf(current));
    const next = SPEED_MODE_CYCLE[(idx + 1) % SPEED_MODE_CYCLE.length];
    handleSetSpeedMode(next);
  }, [handleSetSpeedMode, runtimeRef, selectedSquadId]);

  const handleBattleActionClick = useCallback((squadId, actionId, payload = null) => {
    executeBattleAction(squadId, actionId, payload);
  }, [executeBattleAction]);

  const handleSkillPick = useCallback((skill, meta = {}) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const candidateSquadId = typeof meta?.squadId === 'string' && meta.squadId
      ? meta.squadId
      : selectedSquadId;
    const selected = runtime.getSquadById(candidateSquadId);
    if (!selected || !runtime.canControlSquad?.(selected)) return;
    if (selected.id !== selectedSquadId) {
      selectBattleSquad(selected.id, true);
    }
    if (!skill?.available) return;
    closeSkillPick();
    const fallbackTreeCategory = skill?.treeCategory
      || (skill?.kind === 'archer' || skill?.kind === 'artillery' ? 'ranged' : (skill?.kind === 'support' ? 'support' : 'melee'));
    const profile = skill?.castProfile && typeof skill.castProfile === 'object'
      ? skill.castProfile
      : getSkillCastProfile(skill, fallbackTreeCategory);
    const sourceCategory = profile?.sourceCategory
      || (skill?.treeCategory === 'ranged' ? 'ranged' : (skill?.treeCategory === 'support' ? 'support' : 'melee'));
    const kind = (skill.kind === 'infantry' || skill.kind === 'cavalry' || skill.kind === 'archer' || skill.kind === 'artillery')
      ? skill.kind
      : (selected.classTag || 'infantry');
    const center = skill?.anchor && Number.isFinite(Number(skill.anchor.x)) && Number.isFinite(Number(skill.anchor.y))
      ? { x: Number(skill.anchor.x), y: Number(skill.anchor.y) }
      : (
        selected?.skillCenters?.[sourceCategory]
          ? {
              x: Number(selected.skillCenters[sourceCategory].x) || Number(selected.x) || 0,
              y: Number(selected.skillCenters[sourceCategory].y) || Number(selected.y) || 0
            }
          : selected?.classCenters?.[kind]
          ? {
              x: Number(selected.classCenters[kind].x) || Number(selected.x) || 0,
              y: Number(selected.classCenters[kind].y) || Number(selected.y) || 0
            }
          : { x: Number(selected.x) || 0, y: Number(selected.y) || 0 }
      );
    const commitSkill = (targetSpec = {}) => {
      const slotIndex = Number.isFinite(Number(skill?.slotIndex)) ? Number(skill.slotIndex) : null;
      const payload = {
        ...targetSpec,
        sourceCategory,
        skillId: skill?.skillId || skill?.id || '',
        treeCategory: skill?.treeCategory || '',
        castProfile: profile,
        kind
      };
      const result = slotIndex === null
        ? runtime.commandSkill(selected.id, payload)
        : runtime.commandSkillSlot(selected.id, slotIndex, payload);
      if (!result?.ok) return false;
      setSkillConfirmState(null);
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setClockPaused(paused);
      syncBattleCards();
      return true;
    };

    if (!skillNeedsTargetSelection(profile) || profile?.targetMode === SKILL_TARGET_MODE.SELF) {
      commitSkill({ x: center.x, y: center.y });
      return;
    }
    const dirX = Number(selected.dirX) || 1;
    const dirY = Number(selected.dirY) || 0;
    const defaultDistance = Math.max(
      Number(profile?.minRange) || 0,
      Number(profile?.dashDistance) || Math.min(64, Number(profile?.maxRange) || 180)
    );
    const maxRange = Math.max(8, Number(profile?.maxRange) || skillRangeByClass(kind));
    const aoeRadius = Math.max(8, Number(profile?.aoeRadius) || skillAoeRadiusByClass(kind));
    const casterModelCount = resolveSkillPaintCasterModelCount(
      runtime?.crowd?.agentsBySquad?.get?.(selected.id),
      selected.id,
      sourceCategory
    );
    const paintArea = isTrainingMode && profile?.targetMode === SKILL_TARGET_MODE.GROUND
      ? createSkillPaintArea({
          casterModelCount,
          aoeRadius,
          maxRange
        })
      : null;
    const initialDirection = {
      x: dirX,
      y: dirY
    };
    const initialHoverPoint = paintArea
      ? { x: center.x, y: center.y }
      : profile?.castStyle === 'melee'
      ? {
          x: center.x + (dirX * defaultDistance),
          y: center.y + (dirY * defaultDistance)
        }
      : (profile?.targetMode === SKILL_TARGET_MODE.GROUND ? { x: center.x, y: center.y } : null);
    setSkillConfirmState({
      squadId: selected.id,
      slotIndex: Number.isFinite(Number(skill?.slotIndex)) ? Number(skill.slotIndex) : null,
      skillId: skill?.skillId || skill?.id || '',
      treeCategory: skill?.treeCategory || '',
      sourceCategory,
      kind,
      targetMode: profile?.targetMode || SKILL_TARGET_MODE.GROUND,
      profile,
      center,
      dir: initialDirection,
      len: defaultDistance,
      maxRange,
      aoeRadius,
      paintArea,
      targetSquadId: '',
      hoverPoint: initialHoverPoint,
      resumeOnConfirm: !paused
    });
    setBattleUiMode(BATTLE_UI_MODE_SKILL_CONFIRM);
    setClockPaused(true);
  }, [
    closeSkillPick,
    isTrainingMode,
    runtimeRef,
    paused,
    selectBattleSquad,
    selectedSquadId,
    setBattleUiMode,
    setClockPaused,
    setSkillConfirmState,
    syncBattleCards
  ]);

  const handleFinishPathPlanning = useCallback(() => {
    commitPathPlanning(true);
  }, [commitPathPlanning]);

  const handlePickFormationSpacing = useCallback((spacing, squadId = selectedSquadId) => {
    const runtime = runtimeRef.current;
    const targetSquadId = String(squadId || selectedSquadId || '').trim();
    if (!runtime || runtime.getPhase() !== 'battle' || !targetSquadId) return;
    runtime.commandFormationSpacing(targetSquadId, spacing);
    syncBattleCards();
    closeSpacingPick();
  }, [closeSpacingPick, runtimeRef, selectedSquadId, syncBattleCards]);

  return {
    syncBattleCards,
    attackBattleSquadTarget,
    selectBattleSquad,
    followBattleSquad,
    closeSkillConfirm,
    closeSkillPick,
    commitPathPlanning,
    closeSpacingPick,
    executeBattleAction,
    handleSetSpeedMode,
    handleCycleSpeedMode,
    handleBattleActionClick,
    handleSkillPick,
    handleFinishPathPlanning,
    handlePickFormationSpacing
  };
}
