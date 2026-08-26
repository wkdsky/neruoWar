import { useEffect, useState } from 'react';
import {
  areJsonValuesEqual,
  subscribeToVisibleInterval
} from './../../../hooks/app/visibilityPolling';

const EMPTY_STATUS = { phase: 'deploy', timerSec: 0, ended: false, endReason: '' };

export default function useBattleUiSync({
  runtimeRef,
  intervalMs = 120,
  enabled = false
} = {}) {
  const [battleStatus, setBattleStatus] = useState(EMPTY_STATUS);
  const [cardRows, setCardRows] = useState([]);
  const [battleFlagRows, setBattleFlagRows] = useState([]);
  const [minimapSnapshot, setMinimapSnapshot] = useState(null);
  const [trainingState, setTrainingState] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setBattleStatus(EMPTY_STATUS);
      setCardRows([]);
      setBattleFlagRows([]);
      setMinimapSnapshot(null);
      setTrainingState(null);
      return undefined;
    }
    const sync = () => {
      const runtime = runtimeRef?.current;
      if (!runtime) return;
      const nextBattleStatus = runtime.getBattleStatus?.() || EMPTY_STATUS;
      const nextCardRows = runtime.getCardRows?.() || [];
      const nextBattleFlagRows = runtime.getBattleFlagRows?.() || nextCardRows;
      const nextMinimapSnapshot = runtime.getMinimapSnapshot?.() || null;
      const nextTrainingState = runtime.getTrainingState?.() || null;
      setBattleStatus((previous) => (
        areJsonValuesEqual(previous, nextBattleStatus) ? previous : nextBattleStatus
      ));
      setCardRows((previous) => (
        areJsonValuesEqual(previous, nextCardRows) ? previous : nextCardRows
      ));
      setBattleFlagRows((previous) => (
        areJsonValuesEqual(previous, nextBattleFlagRows) ? previous : nextBattleFlagRows
      ));
      setMinimapSnapshot((previous) => (
        areJsonValuesEqual(previous, nextMinimapSnapshot) ? previous : nextMinimapSnapshot
      ));
      setTrainingState((previous) => (
        areJsonValuesEqual(previous, nextTrainingState) ? previous : nextTrainingState
      ));
    };
    sync();
    return subscribeToVisibleInterval(sync, Math.max(30, Number(intervalMs) || 120));
  }, [enabled, intervalMs, runtimeRef]);

  return {
    phase: battleStatus?.phase || 'deploy',
    battleStatus,
    cardRows,
    battleFlagRows,
    minimapSnapshot,
    trainingState,
    setBattleStatus,
    setCardRows,
    setMinimapSnapshot,
    setTrainingState
  };
}
