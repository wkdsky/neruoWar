import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useBattleUiSync from './useBattleUiSync';

const BattleUiSyncProbe = ({ runtimeRef }) => {
  const { cardRows, battleFlagRows } = useBattleUiSync({
    runtimeRef,
    intervalMs: 30,
    enabled: true
  });
  return (
    <div
      data-card-rows={cardRows.map((row) => `${row.id}:${row.remain}`).join(',')}
      data-flag-rows={battleFlagRows.map((row) => `${row.id}:${row.remain}`).join(',')}
    />
  );
};

describe('battle UI synchronization', () => {
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  test('refreshes minion flag rows even when ordinary card rows do not change', () => {
    const cardRows = [{ id: 'player-squad', remain: 40 }];
    let battleFlagRows = [
      ...cardRows,
      { id: 'minion-wave-1', remain: 72, isMinionWaveUnit: true }
    ];
    const runtimeRef = {
      current: {
        getBattleStatus: () => ({ phase: 'battle', timerSec: 30, ended: false, endReason: '' }),
        getCardRows: () => cardRows,
        getBattleFlagRows: () => battleFlagRows,
        getMinimapSnapshot: () => null,
        getTrainingState: () => null
      }
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      act(() => {
        root.render(<BattleUiSyncProbe runtimeRef={runtimeRef} />);
      });
      expect(container.firstChild.getAttribute('data-flag-rows'))
        .toBe('player-squad:40,minion-wave-1:72');

      battleFlagRows = [
        ...cardRows,
        { id: 'minion-wave-1', remain: 48, isMinionWaveUnit: true },
        { id: 'minion-wave-2', remain: 72, isMinionWaveUnit: true }
      ];
      act(() => {
        jest.advanceTimersByTime(260);
      });

      expect(container.firstChild.getAttribute('data-card-rows')).toBe('player-squad:40');
      expect(container.firstChild.getAttribute('data-flag-rows'))
        .toBe('player-squad:40,minion-wave-1:48,minion-wave-2:72');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
