import BattlePerformanceCollector from './BattlePerformanceCollector';

describe('BattlePerformanceCollector', () => {
  test('keeps a bounded rolling window and reports percentile statistics', () => {
    const collector = new BattlePerformanceCollector({ sampleLimit: 4 });
    collector.start({ scenario: '100-unit-pathing', context: { mapId: 'training-war-map-v1' }, nowMs: 1000 });

    [1, 2, 3, 4, 5].forEach((value) => collector.record('simulationMs', value));
    [10, 20, 30, 40].forEach((value) => collector.record('renderMs', value));
    [50, 55, 60, 65].forEach((value) => collector.record('fps', value));

    const report = collector.getReport({ context: { squadCount: 12 }, nowMs: 2000 });

    expect(report.capture).toMatchObject({
      active: true,
      scenario: '100-unit-pathing',
      sampleLimit: 4,
      durationMs: 1000,
      sampleCounts: { simulationMs: 4, renderMs: 4, fps: 4 }
    });
    expect(report.context).toEqual({
      start: { mapId: 'training-war-map-v1' },
      end: { squadCount: 12 }
    });
    expect(report.metrics.simulationMs).toMatchObject({
      count: 4,
      totalCount: 5,
      discardedCount: 1,
      min: 2,
      average: 3.5,
      p50: 3.5,
      p95: 4.85,
      max: 5
    });
    expect(report.metrics.renderMs).toMatchObject({ min: 10, p50: 25, p95: 38.5, max: 40 });
  });

  test('records only active, finite samples and preserves a completed capture', () => {
    const collector = new BattlePerformanceCollector({ sampleLimit: 2 });

    expect(collector.record('renderMs', 10)).toBe(false);
    collector.start({ scenario: '20-unit-combat', nowMs: 100 });
    expect(collector.record('renderMs', Number.NaN)).toBe(false);
    expect(collector.record('fps', 0)).toBe(false);
    expect(collector.record('renderMs', 6)).toBe(true);
    collector.stop({ nowMs: 350 });
    expect(collector.record('renderMs', 9)).toBe(false);

    const report = collector.getReport({ nowMs: 900 });
    expect(report.capture).toMatchObject({
      active: false,
      scenario: '20-unit-combat',
      startedAtMs: 100,
      endedAtMs: 350,
      durationMs: 250
    });
    expect(report.metrics.renderMs).toMatchObject({ count: 1, min: 6, average: 6, p95: 6 });
  });

  test('throttles debug percentile recomputation without hiding live capture status', () => {
    const collector = new BattlePerformanceCollector({ sampleLimit: 8 });
    collector.start({ scenario: '50-unit-moving', nowMs: 0 });
    collector.record('simulationMs', 4);

    const initial = collector.getDebugSummary({ nowMs: 0 });
    collector.record('simulationMs', 12);
    const throttled = collector.getDebugSummary({ nowMs: 100 });
    const refreshed = collector.getDebugSummary({ nowMs: 1000 });

    expect(initial.metrics.simulationMs.average).toBe(4);
    expect(throttled.sampleCounts.simulationMs).toBe(2);
    expect(throttled.metrics.simulationMs.average).toBe(4);
    expect(refreshed.metrics.simulationMs.average).toBe(8);
  });
});
