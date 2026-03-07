import { useCallback, useEffect, useRef, useState } from 'react';
import BattleClock from '../presentation/runtime/BattleClock';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function useBattleLoop({
  enabled = false,
  canvasRef,
  runtimeRef,
  pipelineRef,
  cameraControllerRef,
  clockConfig = {},
  debugEnabled = false,
  callbacks = {},
  constants = {}
} = {}) {
  const clockRef = useRef(new BattleClock({ fixedStep: 1 / 30, ...clockConfig }));
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const fpsStateRef = useRef({ windowSec: 0, frames: 0 });
  const lastHudRef = useRef(0);
  const reportedRef = useRef(false);
  const worldToScreenRef = useRef(null);
  const worldToDomRef = useRef(null);
  const cameraViewRectRef = useRef({ widthWorld: 240, heightWorld: 160 });
  const [stats, setStats] = useState({ fps: 0, frameTime: 0, simSteps: 0 });
  const frameMetricsRef = useRef({ simSteps: 0, frameTime: 0 });
  const [cameraMiniState, setCameraMiniState] = useState({ center: { x: 0, y: 0 }, viewport: { widthWorld: 220, heightWorld: 150 } });
  const [cameraAssert, setCameraAssert] = useState(null);
  const [runtimeDebugOverlay, setRuntimeDebugOverlay] = useState({
    enabled: false,
    phase: 'deploy',
    pitchMix: 0,
    formationRect: null,
    steeringWeights: null
  });

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    lastFrameRef.current = 0;
    lastHudRef.current = 0;
    fpsStateRef.current = { windowSec: 0, frames: 0 };
  }, []);

  const setPaused = useCallback((nextPaused) => {
    clockRef.current.setPaused(!!nextPaused);
  }, []);

  const resetClock = useCallback(() => {
    clockRef.current.reset();
  }, []);

  const frameRef = useRef(null);
  frameRef.current = (ts) => {
    const runtime = runtimeRef?.current;
    const pipeline = pipelineRef?.current;
    const camera = cameraControllerRef?.current;
    const canvas = canvasRef?.current;
    if (!runtime || !pipeline || !camera || !canvas) {
      rafRef.current = requestAnimationFrame(frameRef.current);
      return;
    }
    const last = lastFrameRef.current || ts;
    const deltaSec = clamp((ts - last) / 1000, 0, 0.05);
    lastFrameRef.current = ts;

    const fpsWindow = fpsStateRef.current;
    fpsWindow.windowSec += deltaSec;
    fpsWindow.frames += 1;
    if (fpsWindow.windowSec >= 0.5) {
      const fps = fpsWindow.frames / Math.max(0.0001, fpsWindow.windowSec);
      runtime.setFps?.(fps);
      fpsWindow.windowSec = 0;
      fpsWindow.frames = 0;
    }

    const viewport = pipeline.prepareFrame?.() || { width: canvas.width, height: canvas.height };
    const safeWidth = Math.max(1, Number(viewport?.width) || canvas.width || 1);
    const safeHeight = Math.max(1, Number(viewport?.height) || canvas.height || 1);
    const nowPhase = runtime.getPhase?.() || 'deploy';
    if (nowPhase === 'battle') {
      frameMetricsRef.current.simSteps = clockRef.current.tick(deltaSec, (fixedStep) => runtime.step?.(fixedStep));
    } else {
      frameMetricsRef.current.simSteps = 0;
    }
    if (nowPhase === 'deploy') {
      camera.yawDeg = Number(constants.DEPLOY_DEFAULT_YAW_DEG) || 0;
      camera.mirrorX = false;
      camera.currentPitch = Number(constants.DEPLOY_PITCH_DEG) || 30;
      camera.pitchFrom = camera.currentPitch;
      camera.pitchTo = camera.currentPitch;
      camera.pitchTweenSec = camera.pitchTweenDurationSec;
    } else {
      camera.yawDeg = Number(constants.BATTLE_FOLLOW_YAW_DEG) || 0;
      if (!Number.isFinite(Number(camera.worldYawDeg))) {
        camera.worldYawDeg = Number(constants.BATTLE_FOLLOW_WORLD_YAW_DEG) || 0;
      }
      camera.mirrorX = !!constants.BATTLE_FOLLOW_MIRROR_X;
    }

    const focusAnchor = runtime.getFocusAnchor?.() || null;
    const focusTargetSquadId = String(focusAnchor?.squadId || '');
    const followTargetSquadId = nowPhase === 'battle' ? focusTargetSquadId : '';
    const followAnchor = nowPhase === 'battle'
      ? {
          x: Number(focusAnchor?.x) || 0,
          y: Number(focusAnchor?.y) || 0,
          vx: Number(focusAnchor?.vx) || 0,
          vy: Number(focusAnchor?.vy) || 0,
          squadId: followTargetSquadId
        }
      : null;
    camera.update(deltaSec, followAnchor);
    const cameraState = camera.buildMatrices(safeWidth, safeHeight);

    const topLeft = camera.screenToGround(0, 0, { width: safeWidth, height: safeHeight });
    const bottomRight = camera.screenToGround(safeWidth, safeHeight, { width: safeWidth, height: safeHeight });
    cameraViewRectRef.current = {
      widthWorld: Math.abs((Number(bottomRight?.x) || 0) - (Number(topLeft?.x) || 0)),
      heightWorld: Math.abs((Number(bottomRight?.y) || 0) - (Number(topLeft?.y) || 0))
    };

    worldToScreenRef.current = (world) => camera.worldToScreen(world, { width: safeWidth, height: safeHeight });
    const cssRect = canvas.getBoundingClientRect();
    const scaleX = safeWidth / Math.max(1, cssRect.width || 1);
    const scaleY = safeHeight / Math.max(1, cssRect.height || 1);
    worldToDomRef.current = (world) => {
      const p = camera.worldToScreen(world, { width: safeWidth, height: safeHeight });
      return {
        x: p.x / Math.max(1e-6, scaleX),
        y: p.y / Math.max(1e-6, scaleY),
        visible: p.visible
      };
    };

    const renderStart = performance.now();
    const snapshot = runtime.getRenderSnapshot?.();
    runtime.cameraPitchMix = camera.getPitchBlend?.() || 0;
    pipeline.render?.({
      cameraState,
      snapshot,
      runtime
    });
    frameMetricsRef.current.frameTime = performance.now() - renderStart;
    runtime.setRenderMs?.(frameMetricsRef.current.frameTime);

    const now = performance.now();
    if ((now - lastHudRef.current) >= 120) {
      lastHudRef.current = now;
      callbacks.onPhaseChange?.(nowPhase);
      const field = runtime.getField?.();
      const followedSquad = followTargetSquadId ? runtime.getSquadById?.(followTargetSquadId) : null;
      const followedDeployGroup = (nowPhase === 'deploy' && focusTargetSquadId)
        ? runtime.getDeployGroupById?.(focusTargetSquadId)
        : null;
      const lockAnchor = nowPhase === 'battle'
        ? followAnchor
        : {
            x: Number(focusAnchor?.x) || 0,
            y: Number(focusAnchor?.y) || 0,
            squadId: focusTargetSquadId
          };
      setCameraMiniState({
        center: {
          x: nowPhase === 'battle' ? (followAnchor?.x || 0) : camera.centerX,
          y: nowPhase === 'battle' ? (followAnchor?.y || 0) : camera.centerY
        },
        viewport: cameraViewRectRef.current
      });
      setCameraAssert({
        cameraImplTag: cameraState?.cameraImplTag || '',
        phase: nowPhase,
        yawDeg: Number(camera.yawDeg) || 0,
        worldYawDeg: Number(cameraState?.worldYawDeg) || 0,
        currentPitch: Number(camera.currentPitch) || 0,
        pitchLow: Number(camera.pitchLow) || 0,
        pitchHigh: Number(camera.pitchHigh) || 0,
        distance: Number(camera.distance) || 0,
        mirrorX: !!camera.mirrorX,
        handedness: Number(cameraState?.handedness) || 0,
        centerX: Number(camera.centerX) || 0,
        centerY: Number(camera.centerY) || 0,
        eyeX: Number(cameraState?.eye?.[0]) || 0,
        eyeY: Number(cameraState?.eye?.[1]) || 0,
        eyeZ: Number(cameraState?.eye?.[2]) || 0,
        forwardZ: Number(cameraState?.forwardZ) || 0,
        flipFixApplied: !!cameraState?.flipFixApplied,
        targetX: Number(cameraState?.target?.[0]) || 0,
        targetY: Number(cameraState?.target?.[1]) || 0,
        targetZ: Number(cameraState?.target?.[2]) || 0,
        cameraRightX: Number(cameraState?.cameraRight?.[0]) || 0,
        cameraRightY: Number(cameraState?.cameraRight?.[1]) || 0,
        cameraRightZ: Number(cameraState?.cameraRight?.[2]) || 0,
        fieldWidth: Number(field?.width) || 0,
        fieldHeight: Number(field?.height) || 0,
        deployAttackerMaxX: Number(runtime.getDeployRange?.()?.attackerMaxX) || 0,
        deployDefenderMinX: Number(runtime.getDeployRange?.()?.defenderMinX) || 0,
        pointerX: Number(callbacks.pointerWorldRef?.current?.x) || 0,
        pointerY: Number(callbacks.pointerWorldRef?.current?.y) || 0,
        pointerValid: callbacks.pointerWorldRef?.current?.valid !== false,
        isPanning: !!callbacks.panDragRef?.current,
        panStartDistance: Number(callbacks.panDragRef?.current?.startDistance) || 0,
        panStartPitch: Number(callbacks.panDragRef?.current?.startPitch) || 0,
        followTargetX: Number(lockAnchor?.x) || 0,
        followTargetY: Number(lockAnchor?.y) || 0,
        followTargetSquadId: String(lockAnchor?.squadId || followTargetSquadId || ''),
        focusActualX: Number((followedSquad || followedDeployGroup)?.x) || 0,
        focusActualY: Number((followedSquad || followedDeployGroup)?.y) || 0,
        focusActualSquadId: String((followedSquad || followedDeployGroup)?.id || ''),
        focusActualResolved: !!(followedSquad || followedDeployGroup)
      });
      const debugSwitch = typeof callbacks.resolveBattleDebugSwitch === 'function'
        ? callbacks.resolveBattleDebugSwitch()
        : { enabled: false, steeringWeights: null };
      if (debugSwitch.enabled) {
        const selectedDeployId = runtime.getDeployGroups?.()?.selectedId || '';
        const selectedDeploy = runtime.getDeployGroupById?.(selectedDeployId, 'any');
        const formationRect = selectedDeploy?.formationRect
          ? {
              width: Number(selectedDeploy.formationRect.width) || 0,
              depth: Number(selectedDeploy.formationRect.depth) || 0,
              area: Number(selectedDeploy.formationRect.area) || 0
            }
          : null;
        setRuntimeDebugOverlay({
          enabled: true,
          phase: nowPhase,
          pitchMix: Number(runtime.cameraPitchMix || 0),
          formationRect,
          steeringWeights: debugSwitch.steeringWeights
        });
      } else {
        setRuntimeDebugOverlay((prev) => (prev.enabled ? { ...prev, enabled: false } : prev));
      }
      if (debugEnabled) {
        const debugStats = runtime.getDebugStats?.() || {};
        setStats((prev) => ({
          ...prev,
          fps: Number(debugStats.fps) || prev.fps || 0,
          frameTime: Number(debugStats.renderMs) || frameMetricsRef.current.frameTime || 0,
          simSteps: frameMetricsRef.current.simSteps || 0,
          ...debugStats
        }));
      } else {
        setStats((prev) => ({
          ...prev,
          frameTime: frameMetricsRef.current.frameTime || 0,
          simSteps: frameMetricsRef.current.simSteps || 0
        }));
      }
    }

    if (runtime.isEnded?.() && !reportedRef.current) {
      reportedRef.current = true;
      callbacks.onBattleEnded?.(runtime.getSummary?.());
    }
    rafRef.current = requestAnimationFrame(frameRef.current);
  };
  useEffect(() => {
    if (!enabled) {
      stop();
      return undefined;
    }
    reportedRef.current = false;
    rafRef.current = requestAnimationFrame(frameRef.current);
    return () => {
      stop();
    };
  }, [enabled, stop]);

  useEffect(() => () => stop(), [stop]);

  return {
    stats,
    setPaused,
    resetClock,
    worldToScreenRef,
    worldToDomRef,
    cameraViewRectRef,
    cameraMiniState,
    cameraAssert,
    runtimeDebugOverlay
  };
}
