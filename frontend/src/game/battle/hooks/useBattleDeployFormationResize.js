import { useCallback } from 'react';
import { TEAM_ATTACKER, TEAM_DEFENDER } from '../screens/battleSceneConstants';
import { buildDeployFormationFootprint } from '../screens/battleSceneUtils';

export default function useBattleDeployFormationResize({
  runtimeRef,
  deployRectDragRef,
  deployDraggingGroupId = '',
  setDeployActionAnchorMode
} = {}) {
  const beginDeployRectResize = useCallback((event, group, sideSign = 1) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    if (!group || group.placed === false || deployDraggingGroupId) return;
    const footprint = buildDeployFormationFootprint(group);
    if (!footprint) return;
    deployRectDragRef.current = {
      groupId: String(group.id || ''),
      team: group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER,
      centerX: Number(group.x) || 0,
      centerY: Number(group.y) || 0,
      axisX: Number(footprint.sideAxis.x) || 0,
      axisY: Number(footprint.sideAxis.y) || 0,
      sideSign: sideSign >= 0 ? 1 : -1
    };
    setDeployActionAnchorMode('world');
    event.preventDefault();
    event.stopPropagation();
  }, [deployDraggingGroupId, deployRectDragRef, runtimeRef, setDeployActionAnchorMode]);

  return { beginDeployRectResize };
}
