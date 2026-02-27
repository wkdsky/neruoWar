import React, { useCallback, useEffect, useRef, useState } from 'react';
import './pveBattle.css';
import BattleRuntime from '../../game/battle_v2/runtime/BattleRuntime';
import BattleClock from '../../game/battle_v2/runtime/BattleClock';
import CameraController from '../../game/battle_v2/render/CameraController';
import {
  createBattleGlContext,
  resizeCanvasToDisplaySize
} from '../../game/battle_v2/render/WebGL2Context';
import ImpostorRenderer from '../../game/battle_v2/render/ImpostorRenderer';
import BuildingRenderer from '../../game/battle_v2/render/BuildingRenderer';
import ProjectileRenderer from '../../game/battle_v2/render/ProjectileRenderer';
import EffectRenderer from '../../game/battle_v2/render/EffectRenderer';
import GroundRenderer from '../../game/battle_v2/render/GroundRenderer';
import BattleHUD from '../../game/battle_v2/ui/BattleHUD';
import SquadCards from '../../game/battle_v2/ui/SquadCards';
import Minimap from '../../game/battle_v2/ui/Minimap';
import AimOverlayCanvas from '../../game/battle_v2/ui/AimOverlayCanvas';
import unitVisualConfig from '../../game/battle_v2/assets/UnitVisualConfig.example.json';

const API_BASE = 'http://localhost:5000';
const TEAM_ATTACKER = 'attacker';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const skillRangeByClass = (classTag) => {
  if (classTag === 'cavalry') return 220;
  if (classTag === 'archer') return 260;
  if (classTag === 'artillery') return 310;
  return 180;
};

const skillAoeRadiusByClass = (classTag) => {
  if (classTag === 'archer') return 72;
  if (classTag === 'artillery') return 126;
  return 24;
};

const toCardsByTeam = (cards = []) => (
  Array.isArray(cards) ? cards : []
);

const buildCompatSummaryPayload = (summary = {}) => ({
  battleId: summary?.battleId || '',
  gateKey: summary?.gateKey || '',
  durationSec: Math.max(0, Math.floor(Number(summary?.durationSec) || 0)),
  attacker: {
    start: Math.max(0, Math.floor(Number(summary?.attacker?.start) || 0)),
    remain: Math.max(0, Math.floor(Number(summary?.attacker?.remain) || 0)),
    kills: Math.max(0, Math.floor(Number(summary?.attacker?.kills) || 0))
  },
  defender: {
    start: Math.max(0, Math.floor(Number(summary?.defender?.start) || 0)),
    remain: Math.max(0, Math.floor(Number(summary?.defender?.remain) || 0)),
    kills: Math.max(0, Math.floor(Number(summary?.defender?.kills) || 0))
  },
  details: summary?.details && typeof summary.details === 'object' ? summary.details : {},
  startedAt: summary?.startedAt || null,
  endedAt: summary?.endedAt || null,
  endReason: summary?.endReason || ''
});

const PveBattleModal = ({
  open = false,
  loading = false,
  error = '',
  battleInitData = null,
  onClose,
  onBattleFinished
}) => {
  const glCanvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const clockRef = useRef(new BattleClock({ fixedStep: 1 / 30 }));
  const cameraRef = useRef(new CameraController({ yawDeg: 45, pitchLow: 40, pitchHigh: 90, distance: 560 }));
  const glRef = useRef(null);
  const renderersRef = useRef({
    ground: null,
    impostor: null,
    building: null,
    projectile: null,
    effect: null
  });
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastUiSyncRef = useRef(0);
  const worldToScreenRef = useRef(null);
  const cameraStateRef = useRef(null);
  const cameraViewRectRef = useRef({ widthWorld: 240, heightWorld: 160 });
  const fpsStateRef = useRef({ windowSec: 0, frames: 0 });
  const reportedRef = useRef(false);

  const [glError, setGlError] = useState('');
  const [phase, setPhase] = useState('deploy');
  const [battleStatus, setBattleStatus] = useState({ timerSec: 0, ended: false, endReason: '' });
  const [cards, setCards] = useState([]);
  const [paused, setPaused] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugStats, setDebugStats] = useState({ fps: 0, simStepMs: 0, renderMs: 0, agentCount: 0, projectileCount: 0, buildingCount: 0 });
  const [aimState, setAimState] = useState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
  const [selectedSquadId, setSelectedSquadId] = useState('');
  const [minimapSnapshot, setMinimapSnapshot] = useState(null);
  const [cameraMiniState, setCameraMiniState] = useState({ center: { x: 0, y: 0 }, viewport: { widthWorld: 220, heightWorld: 150 } });
  const [resultState, setResultState] = useState({ open: false, submitting: false, error: '', summary: null, recorded: false });

  const closeModal = useCallback(() => {
    if (typeof onClose === 'function') onClose();
  }, [onClose]);

  const destroyRenderers = useCallback(() => {
    const renderers = renderersRef.current;
    if (renderers.ground) renderers.ground.dispose();
    if (renderers.impostor) renderers.impostor.dispose();
    if (renderers.building) renderers.building.dispose();
    if (renderers.projectile) renderers.projectile.dispose();
    if (renderers.effect) renderers.effect.dispose();
    renderersRef.current = {
      ground: null,
      impostor: null,
      building: null,
      projectile: null,
      effect: null
    };
    glRef.current = null;
  }, []);

  const setupRuntime = useCallback(() => {
    if (!open || !battleInitData) {
      runtimeRef.current = null;
      return;
    }
    const runtime = new BattleRuntime(battleInitData, {
      repConfig: {
        maxAgentWeight: 50,
        damageExponent: 0.75,
        strictAgentMapping: true
      },
      visualConfig: unitVisualConfig
    });
    runtimeRef.current = runtime;
    const cardsRows = runtime.getCardRows();
    setCards(cardsRows);
    setPhase(runtime.getPhase());
    setBattleStatus(runtime.getBattleStatus());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    const initialSelected = runtime.getDeployGroups()?.selectedId || cardsRows.find((row) => row.team === TEAM_ATTACKER)?.id || '';
    setSelectedSquadId(initialSelected);
    runtime.setFocusSquad(initialSelected);
    const anchor = runtime.getFocusAnchor();
    cameraRef.current.centerX = Number(anchor?.x) || 0;
    cameraRef.current.centerY = Number(anchor?.y) || 0;
    clockRef.current.reset();
    clockRef.current.setPaused(false);
    reportedRef.current = false;
    setPaused(false);
    setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
    setResultState({ open: false, submitting: false, error: '', summary: null, recorded: false });
  }, [open, battleInitData]);

  useEffect(() => {
    if (!open) return;
    setupRuntime();
  }, [open, setupRuntime]);

  useEffect(() => {
    if (!open || !glCanvasRef.current || loading || error || !battleInitData) return;
    try {
      const gl = createBattleGlContext(glCanvasRef.current);
      if (!gl) {
        setGlError('当前环境不支持 WebGL2，无法进入新版战斗场景');
        return;
      }
      glRef.current = gl;
      renderersRef.current.ground = new GroundRenderer(gl);
      renderersRef.current.impostor = new ImpostorRenderer(gl, { maxSlices: 32, textureSize: 64 });
      renderersRef.current.building = new BuildingRenderer(gl);
      renderersRef.current.projectile = new ProjectileRenderer(gl);
      renderersRef.current.effect = new EffectRenderer(gl);
      setGlError('');
    } catch (renderInitError) {
      setGlError(`初始化渲染器失败: ${renderInitError.message}`);
      destroyRenderers();
    }

    return () => {
      destroyRenderers();
    };
  }, [open, loading, error, battleInitData, destroyRenderers]);

  const reportBattleResult = useCallback(async (summary) => {
    if (!battleInitData?.nodeId || !summary) return;
    setResultState((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/api/nodes/${battleInitData.nodeId}/siege/pve/battle-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(buildCompatSummaryPayload(summary))
      });
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok || !parsed?.success) {
        throw new Error(parsed?.error || '上报战斗结果失败');
      }
      setResultState((prev) => ({ ...prev, submitting: false, recorded: true, error: '' }));
      if (typeof onBattleFinished === 'function') {
        onBattleFinished();
      }
    } catch (submitError) {
      setResultState((prev) => ({ ...prev, submitting: false, error: submitError.message || '上报失败' }));
    }
  }, [battleInitData, onBattleFinished]);

  useEffect(() => {
    if (!open || loading || !!error || !!glError) return undefined;
    const runtime = runtimeRef.current;
    const gl = glRef.current;
    const renderers = renderersRef.current;
    if (!runtime || !gl || !renderers?.ground || !renderers?.impostor || !renderers?.building || !renderers?.projectile || !renderers?.effect) return undefined;

    let active = true;

    const frame = (ts) => {
      if (!active) return;
      const last = lastFrameRef.current || ts;
      const deltaSec = clamp((ts - last) / 1000, 0, 0.05);
      lastFrameRef.current = ts;

      const fpsWindow = fpsStateRef.current;
      fpsWindow.windowSec += deltaSec;
      fpsWindow.frames += 1;
      if (fpsWindow.windowSec >= 0.5) {
        const fps = fpsWindow.frames / Math.max(0.0001, fpsWindow.windowSec);
        runtime.setFps(fps);
        fpsWindow.windowSec = 0;
        fpsWindow.frames = 0;
      }

      const sceneCanvas = glCanvasRef.current;
      if (!sceneCanvas) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      resizeCanvasToDisplaySize(sceneCanvas, gl);

      const nowPhase = runtime.getPhase();
      if (nowPhase === 'battle') {
        clockRef.current.tick(deltaSec, (fixedStep) => runtime.step(fixedStep));
      }

      const focusAnchor = runtime.getFocusAnchor();
      cameraRef.current.update(deltaSec, focusAnchor);
      const cameraState = cameraRef.current.buildMatrices(sceneCanvas.width, sceneCanvas.height);
      cameraStateRef.current = cameraState;

      const topLeft = cameraRef.current.screenToGround(0, 0, { width: sceneCanvas.width, height: sceneCanvas.height });
      const bottomRight = cameraRef.current.screenToGround(sceneCanvas.width, sceneCanvas.height, { width: sceneCanvas.width, height: sceneCanvas.height });
      cameraViewRectRef.current = {
        widthWorld: Math.abs((bottomRight.x || 0) - (topLeft.x || 0)),
        heightWorld: Math.abs((bottomRight.y || 0) - (topLeft.y || 0))
      };

      worldToScreenRef.current = (world) => cameraRef.current.worldToScreen(world, { width: sceneCanvas.width, height: sceneCanvas.height });

      const renderStart = performance.now();
      const snapshot = runtime.getRenderSnapshot();
      const field = runtime.getField();
      renderers.ground.setFieldSize(field?.width || 900, field?.height || 620);
      renderers.building.updateFromSnapshot(snapshot.buildings);
      renderers.impostor.updateFromSnapshot(snapshot.units);
      renderers.projectile.updateFromSnapshot(snapshot.projectiles);
      renderers.effect.updateFromSnapshot(snapshot.effects);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const pitchMix = cameraRef.current.getPitchBlend();
      renderers.ground.render(cameraState);
      renderers.building.render(cameraState, pitchMix);
      renderers.impostor.render(cameraState, pitchMix);
      renderers.projectile.render(cameraState);
      renderers.effect.render(cameraState);
      runtime.setRenderMs(performance.now() - renderStart);

      const now = performance.now();
      if ((now - lastUiSyncRef.current) >= 120) {
        lastUiSyncRef.current = now;
        const status = runtime.getBattleStatus();
        const nextCards = runtime.getCardRows();
        setPhase(runtime.getPhase());
        setBattleStatus(status);
        setCards(nextCards);
        setMinimapSnapshot(runtime.getMinimapSnapshot());
        setCameraMiniState({
          center: { x: focusAnchor.x || 0, y: focusAnchor.y || 0 },
          viewport: cameraViewRectRef.current
        });
        if (debugEnabled) {
          setDebugStats(runtime.getDebugStats());
        }

        if (runtime.isEnded() && !reportedRef.current) {
          reportedRef.current = true;
          const summary = runtime.getSummary();
          setResultState({ open: true, submitting: false, error: '', summary, recorded: false });
          reportBattleResult(summary);
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      lastFrameRef.current = 0;
      lastUiSyncRef.current = 0;
      fpsStateRef.current = { windowSec: 0, frames: 0 };
    };
  }, [open, loading, error, glError, reportBattleResult, debugEnabled]);

  const handleTogglePause = useCallback(() => {
    const next = !paused;
    setPaused(next);
    clockRef.current.setPaused(next);
  }, [paused]);

  const handleTogglePitch = useCallback(() => {
    cameraRef.current.togglePitchMode();
  }, []);

  const handleStartBattle = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const result = runtime.startBattle();
    if (!result?.ok) {
      setResultState((prev) => ({ ...prev, open: true, error: result?.reason || '无法开战', summary: null }));
      return;
    }
    const attacker = runtime.getCardRows().find((row) => row.team === TEAM_ATTACKER && row.alive);
    if (attacker) {
      runtime.setFocusSquad(attacker.id);
      runtime.setSelectedBattleSquad(attacker.id);
      setSelectedSquadId(attacker.id);
    }
    setPhase(runtime.getPhase());
    setBattleStatus(runtime.getBattleStatus());
    setCards(runtime.getCardRows());
    setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
  }, []);

  const handleCardFocus = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setFocusSquad(squadId);
  }, []);

  const handleCardSelect = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      runtime.setSelectedDeployGroup(squadId);
      runtime.setFocusSquad(squadId);
      setSelectedSquadId(squadId);
      setCards(runtime.getCardRows());
      return;
    }
    if (runtime.setSelectedBattleSquad(squadId)) {
      setSelectedSquadId(squadId);
      setCards(runtime.getCardRows());
    }
  }, []);

  const handleMapCommand = useCallback((event) => {
    if (event.button !== 0) return;
    const runtime = runtimeRef.current;
    const canvas = glCanvasRef.current;
    if (!runtime || !canvas || !cameraStateRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const world = cameraRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });

    if (runtime.getPhase() === 'deploy') {
      runtime.moveDeployGroup(selectedSquadId, world);
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }

    if (runtime.getPhase() !== 'battle' || paused) return;
    const selected = runtime.getSquadById(selectedSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;

    if (aimState.active && aimState.squadId === selected.id) {
      const maxRange = skillRangeByClass(selected.classTag);
      const aoeRadius = skillAoeRadiusByClass(selected.classTag);
      const dx = world.x - selected.x;
      const dy = world.y - selected.y;
      const dist = Math.hypot(dx, dy) || 1;
      const tx = dist > maxRange ? selected.x + (dx / dist) * maxRange : world.x;
      const ty = dist > maxRange ? selected.y + (dy / dist) * maxRange : world.y;
      runtime.commandSkill(selected.id, {
        kind: 'ground_aoe',
        x: tx,
        y: ty,
        radius: aoeRadius,
        maxRange,
        clipPolygon: [],
        blockedByWall: false
      });
      setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
      return;
    }

    runtime.commandMove(selected.id, world, { append: event.shiftKey });
    setCards(runtime.getCardRows());
  }, [selectedSquadId, paused, aimState]);

  const handleMinimapClick = useCallback((worldPoint) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      runtime.moveDeployGroup(selectedSquadId, worldPoint);
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      return;
    }
    if (runtime.getPhase() !== 'battle') return;
    runtime.commandMove(selectedSquadId, worldPoint, { append: false });
    runtime.setFocusSquad(selectedSquadId);
    setCards(runtime.getCardRows());
  }, [selectedSquadId]);

  const handleToggleSkillAim = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const selected = runtime.getSquadById(selectedSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;
    if (selected.classTag !== 'archer' && selected.classTag !== 'artillery' && selected.classTag !== 'cavalry' && selected.classTag !== 'infantry') return;
    setAimState((prev) => {
      if (prev.active && prev.squadId === selected.id) {
        return { active: false, squadId: '', classTag: '', point: null, radiusPx: 0 };
      }
      return {
        active: true,
        squadId: selected.id,
        classTag: selected.classTag,
        point: null,
        radiusPx: 0
      };
    });
  }, [selectedSquadId]);

  const handlePointerMove = useCallback((event) => {
    if (!aimState.active) return;
    const runtime = runtimeRef.current;
    const canvas = glCanvasRef.current;
    if (!runtime || !canvas) return;
    const selected = runtime.getSquadById(aimState.squadId);
    if (!selected) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    const world = cameraRef.current.screenToGround(px, py, { width: canvas.width, height: canvas.height });
    const center = worldToScreenRef.current ? worldToScreenRef.current({ x: world.x, y: world.y, z: 0 }) : null;
    const edge = worldToScreenRef.current ? worldToScreenRef.current({ x: world.x + skillAoeRadiusByClass(selected.classTag), y: world.y, z: 0 }) : null;
    const radiusPx = center && edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : 22;
    setAimState((prev) => ({ ...prev, point: { x: world.x, y: world.y }, radiusPx }));
  }, [aimState]);

  const handleBehavior = useCallback((behavior) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    runtime.commandBehavior(selectedSquadId, behavior);
    setCards(runtime.getCardRows());
  }, [selectedSquadId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (aimState.active) {
          setAimState({ active: false, squadId: '', classTag: '', point: null, radiusPx: 0 });
          return;
        }
        closeModal();
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (runtimeRef.current?.getPhase() === 'battle') {
          handleTogglePause();
        }
      }
      if (event.key.toLowerCase() === 'v') {
        handleTogglePitch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeModal, aimState.active, handleTogglePause, handleTogglePitch]);

  useEffect(() => {
    if (!open) {
      runtimeRef.current = null;
      destroyRenderers();
      return;
    }
    return () => {
      runtimeRef.current = null;
      destroyRenderers();
    };
  }, [open, destroyRenderers]);

  const selectedSquad = (() => {
    const runtime = runtimeRef.current;
    if (!runtime) return null;
    if (runtime.getPhase() !== 'battle') return null;
    return runtime.getSquadById(selectedSquadId);
  })();

  const selectedWaypoints = selectedSquad && Array.isArray(selectedSquad.waypoints) ? selectedSquad.waypoints : [];

  const pitchLabel = cameraRef.current.getPitchBlend() >= 0.5 ? '90°' : '40°';

  if (!open) return null;

  return (
    <div className="pve2-overlay">
      <div className="pve2-head">
        <div className="pve2-title">
          <strong>{battleInitData?.nodeName || '攻占战'}</strong>
          <span>{battleInitData?.gateLabel || battleInitData?.gateKey || ''}</span>
        </div>
        <div className="pve2-side-info">
          <div className="pve2-side attacker">
            <span>我方</span>
            <strong>{battleInitData?.attacker?.username || '-'}</strong>
            <em>{battleInitData?.attacker?.totalCount || 0}</em>
          </div>
          <div className="pve2-side defender">
            <span>守军</span>
            <strong>{battleInitData?.defender?.username || '-'}</strong>
            <em>{battleInitData?.defender?.totalCount || 0}</em>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="pve2-loading">加载战斗初始化数据...</div>
      ) : null}
      {!loading && error ? (
        <div className="pve2-error">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={closeModal}>关闭</button>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="pve2-main">
          <BattleHUD
            phase={phase}
            status={battleStatus}
            paused={paused}
            onTogglePause={handleTogglePause}
            onTogglePitch={handleTogglePitch}
            onExit={closeModal}
            onStart={handleStartBattle}
            canStart={runtimeRef.current?.canStartBattle?.()}
            debugEnabled={debugEnabled}
            onToggleDebug={() => setDebugEnabled((prev) => !prev)}
            debugStats={debugStats}
            pitchLabel={pitchLabel}
          />

          <div
            className="pve2-scene"
            onPointerDown={handleMapCommand}
            onPointerMove={handlePointerMove}
          >
            <canvas ref={glCanvasRef} className="pve2-gl-canvas" />
            <AimOverlayCanvas
              width={glCanvasRef.current?.width || 1}
              height={glCanvasRef.current?.height || 1}
              worldToScreen={(world) => (worldToScreenRef.current ? worldToScreenRef.current(world) : { x: -9999, y: -9999, visible: false })}
              selectedSquad={selectedSquad}
              aimState={aimState}
              waypoints={selectedWaypoints}
            />

            <SquadCards
              squads={toCardsByTeam(cards)}
              onFocus={handleCardFocus}
              onSelect={handleCardSelect}
            />

            <div className="pve2-action-pad">
              {phase === 'battle' ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('idle')}>待命</button>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('auto')}>自动</button>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('defend')}>防御</button>
                  <button type="button" className="btn btn-secondary" onClick={() => handleBehavior('retreat')}>撤退</button>
                  <button type="button" className={`btn ${aimState.active ? 'btn-warning' : 'btn-primary'}`} onClick={handleToggleSkillAim}>技能瞄准</button>
                </>
              ) : (
                <span className="pve2-hint">部署阶段：点击地图放置我方部队，点击卡片切换焦点</span>
              )}
            </div>

            <Minimap
              snapshot={minimapSnapshot}
              cameraCenter={cameraMiniState.center}
              cameraViewport={cameraMiniState.viewport}
              onMapClick={handleMinimapClick}
            />

            {aimState.active ? (
              <div className="pve2-aim-tip">技能瞄准中：点击地面释放，`Esc` 取消</div>
            ) : null}

            {glError ? (
              <div className="pve2-error-overlay">{glError}</div>
            ) : null}
          </div>

          {resultState.open ? (
            <div className="pve2-result">
              <h3>战斗结算</h3>
              {resultState.summary ? (
                <>
                  <p>{resultState.summary.endReason || '战斗结束'}</p>
                  <div className="pve2-result-grid">
                    <div>
                      <strong>我方</strong>
                      <span>{resultState.summary.attacker?.remain || 0}/{resultState.summary.attacker?.start || 0}</span>
                      <span>击杀 {resultState.summary.attacker?.kills || 0}</span>
                    </div>
                    <div>
                      <strong>守军</strong>
                      <span>{resultState.summary.defender?.remain || 0}/{resultState.summary.defender?.start || 0}</span>
                      <span>击杀 {resultState.summary.defender?.kills || 0}</span>
                    </div>
                  </div>
                </>
              ) : null}
              {resultState.submitting ? <p>正在上报战斗结果...</p> : null}
              {resultState.error ? <p className="error">{resultState.error}</p> : null}
              {resultState.recorded ? <p className="ok">战报已记录</p> : null}
              <div className="pve2-result-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>返回围城</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default PveBattleModal;
