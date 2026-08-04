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
  const [minimapSnapshot, setMinimapSnapshot] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setBattleStatus(EMPTY_STATUS);
      setCardRows([]);
      setMinimapSnapshot(null);
      return undefined;
    }
    const sync = () => {
      const runtime = runtimeRef?.current;
      if (!runtime) return;
      const nextBattleStatus = runtime.getBattleStatus?.() || EMPTY_STATUS;
      const nextCardRows = runtime.getCardRows?.() || [];
      const nextMinimapSnapshot = runtime.getMinimapSnapshot?.() || null;
      setBattleStatus((previous) => (
        areJsonValuesEqual(previous, nextBattleStatus) ? previous : nextBattleStatus
      ));
      setCardRows((previous) => (
        areJsonValuesEqual(previous, nextCardRows) ? previous : nextCardRows
      ));
      setMinimapSnapshot((previous) => (
        areJsonValuesEqual(previous, nextMinimapSnapshot) ? previous : nextMinimapSnapshot
      ));
    };
    sync();
    return subscribeToVisibleInterval(sync, Math.max(30, Number(intervalMs) || 120));
  }, [enabled, intervalMs, runtimeRef]);

  return {
    phase: battleStatus?.phase || 'deploy',
    battleStatus,
    cardRows,
    minimapSnapshot,
    setBattleStatus,
    setCardRows,
    setMinimapSnapshot
  };
}
