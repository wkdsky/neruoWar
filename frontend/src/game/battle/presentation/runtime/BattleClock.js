export default class BattleClock {
  constructor({ fixedStep = 1 / 30, maxFrame = 0.05, maxCatchUp = 0.25 } = {}) {
    this.fixedStep = Math.max(1 / 120, Number(fixedStep) || (1 / 30));
    this.maxFrame = Math.max(this.fixedStep, Number(maxFrame) || 0.05);
    this.maxCatchUp = Math.max(this.fixedStep, Number(maxCatchUp) || 0.25);
    this.accumulator = 0;
    this.paused = false;
  }

  setPaused(nextPaused) {
    this.paused = !!nextPaused;
    if (this.paused) {
      this.accumulator = 0;
    }
  }

  reset() {
    this.accumulator = 0;
  }

  tick(deltaSec, stepFn) {
    const dt = Math.max(0, Math.min(this.maxFrame, Number(deltaSec) || 0));
    if (!stepFn || typeof stepFn !== 'function') return 0;
    if (this.paused) return 0;
    this.accumulator = Math.min(this.maxCatchUp, this.accumulator + dt);
    let steps = 0;
    while (this.accumulator >= this.fixedStep) {
      stepFn(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps += 1;
      if (steps > 24) {
        this.accumulator = 0;
        break;
      }
    }
    return steps;
  }
}
