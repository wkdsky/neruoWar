import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveTrainingFlagLod,
  resolveTrainingInfoLabelElevation
} from '../render/TrainingThreeRenderPipeline';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const requestFrame = (callback) => {
  if (typeof window === 'undefined') return 0;
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(callback, 16);
};

const cancelFrame = (frameId) => {
  if (!frameId || typeof window === 'undefined') return;
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
  }
  window.clearTimeout(frameId);
};

export const resolveTrainingTroopRatio = (row = {}) => {
  const start = Math.max(1, Number(row?.startCount) || 1);
  return clamp((Number(row?.remain) || 0) / start, 0, 1);
};

export const resolveTrainingTroopState = (ratio = 1) => {
  if (ratio <= 0.25) return 'critical';
  if (ratio <= 0.5) return 'warning';
  return 'healthy';
};

export const buildTrainingFlagRows = (squads = [], trainingState = null) => {
  const skillPoints = Math.max(0, Math.floor(Number(trainingState?.points) || 0));
  return (Array.isArray(squads) ? squads : [])
    .filter((row) => row && row.placed !== false && (Number(row.remain) || 0) > 0)
    .map((row) => {
      const ratio = resolveTrainingTroopRatio(row);
      return {
        id: String(row.id || ''),
        name: String(row.name || '部队'),
        team: row.team === 'defender' ? 'defender' : 'attacker',
        remain: Math.max(0, Math.floor(Number(row.remain) || 0)),
        startCount: Math.max(0, Math.floor(Number(row.startCount) || 0)),
        skillPoints,
        x: Number.isFinite(Number(row.centerX)) ? Number(row.centerX) : (Number(row.x) || 0),
        y: Number.isFinite(Number(row.centerY)) ? Number(row.centerY) : (Number(row.y) || 0),
        radius: Math.max(0, Number(row.radius) || 0),
        ratio,
        troopState: resolveTrainingTroopState(ratio),
        selected: !!row.selected
      };
    })
    .filter((row) => row.id);
};

const TRAINING_FLAG_LABEL_NEAR_DISTANCE = 460;
const TRAINING_FLAG_LABEL_FAR_DISTANCE = 760;

export const resolveTrainingFlagLabelPresentation = (row = {}, cameraDistance = 0, cameraPitch = 90) => {
  const zoomProgress = clamp(
    (Math.max(0, Number(cameraDistance) || 0) - TRAINING_FLAG_LABEL_NEAR_DISTANCE)
      / (TRAINING_FLAG_LABEL_FAR_DISTANCE - TRAINING_FLAG_LABEL_NEAR_DISTANCE),
    0,
    1
  );
  const flagLod = resolveTrainingFlagLod(cameraPitch);
  return {
    elevation: resolveTrainingInfoLabelElevation(row),
    scale: 1 + (zoomProgress * 0.2),
    visible: flagLod.infoLabel
  };
};

const placeWorldNode = (node, source, worldToDomRef, anchor = 'flag', cameraDistance = 0, cameraPitch = 90) => {
  if (!node) return;
  const project = worldToDomRef?.current;
  if (typeof project !== 'function') {
    node.style.opacity = '0';
    return;
  }
  const flagPresentation = anchor === 'flag'
    ? resolveTrainingFlagLabelPresentation(source, cameraDistance, cameraPitch)
    : null;
  if (anchor === 'flag' && !flagPresentation.visible) {
    node.style.display = 'none';
    return;
  }
  if (anchor === 'flag') node.style.display = 'block';
  const point = project({
    x: Number(source?.x) || 0,
    y: Number(source?.y) || 0,
    z: flagPresentation?.elevation ?? Math.max(8, Number(source?.z) || 3)
  });
  if (!point?.visible) {
    node.style.opacity = '0';
    return;
  }
  node.style.opacity = '1';
  if (anchor === 'flag') {
    node.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0) translate(-50%, -100%) scale(${flagPresentation.scale.toFixed(3)})`;
    return;
  }
  node.style.setProperty('--pve2-world-x', `${Math.round(point.x)}px`);
  node.style.setProperty('--pve2-world-y', `${Math.round(point.y)}px`);
};

const displayDamage = (amount = 0) => Math.max(1, Math.round(Number(amount) || 0));

const TrainingFlagLabels = ({
  squads = [],
  trainingState = null,
  phase = 'deploy',
  runtimeRef,
  worldToDomRef,
  cameraRef
}) => {
  const flagRows = useMemo(
    () => buildTrainingFlagRows(squads, trainingState),
    [squads, trainingState]
  );
  const flagNodesRef = useRef(new Map());
  const damageNodesRef = useRef(new Map());
  const seenDamageRef = useRef(new Map());
  const removeTimersRef = useRef(new Set());
  const [damageNumbers, setDamageNumbers] = useState([]);

  useEffect(() => {
    if (phase !== 'battle') {
      seenDamageRef.current.clear();
      setDamageNumbers([]);
      return undefined;
    }
    let frameId = 0;
    const readDamageNumbers = () => {
      const live = Array.isArray(runtimeRef?.current?.sim?.damageNumbers)
        ? runtimeRef.current.sim.damageNumbers
        : [];
      live.forEach((event) => {
        const id = String(event?.id || '');
        const revision = Math.max(1, Math.floor(Number(event?.revision) || 1));
        const knownRevision = seenDamageRef.current.get(id);
        if (!id || knownRevision === revision) return;
        seenDamageRef.current.set(id, revision);
        const entry = {
          id,
          team: event?.team === 'defender' ? 'defender' : 'attacker',
          x: Number(event?.x) || 0,
          y: Number(event?.y) || 0,
          z: Number(event?.z) || 3,
          amount: Math.max(0, Number(event?.amount) || 0)
        };
        if (knownRevision !== undefined) {
          setDamageNumbers((current) => current.map((item) => (
            item.id === id ? entry : item
          )));
          return;
        }
        setDamageNumbers((current) => [...current.slice(-23), entry]);
        const timerId = window.setTimeout(() => {
          removeTimersRef.current.delete(timerId);
          setDamageNumbers((current) => current.filter((item) => item.id !== id));
          seenDamageRef.current.delete(id);
        }, 920);
        removeTimersRef.current.add(timerId);
      });
      frameId = requestFrame(readDamageNumbers);
    };
    readDamageNumbers();
    return () => cancelFrame(frameId);
  }, [phase, runtimeRef]);

  useEffect(() => {
    let frameId = 0;
    const positionNodes = () => {
      const cameraDistance = Number(cameraRef?.current?.distance) || 0;
      const requestedCameraPitch = Number(cameraRef?.current?.currentPitch);
      const cameraPitch = Number.isFinite(requestedCameraPitch) ? requestedCameraPitch : 90;
      flagRows.forEach((row) => {
        placeWorldNode(flagNodesRef.current.get(row.id), row, worldToDomRef, 'flag', cameraDistance, cameraPitch);
      });
      damageNumbers.forEach((event) => {
        placeWorldNode(damageNodesRef.current.get(event.id), event, worldToDomRef, 'damage');
      });
      frameId = requestFrame(positionNodes);
    };
    positionNodes();
    return () => cancelFrame(frameId);
  }, [cameraRef, damageNumbers, flagRows, worldToDomRef]);

  useEffect(() => () => {
    removeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    removeTimersRef.current.clear();
  }, []);

  return (
    <div className="pve2-training-flag-layer" aria-live="polite">
      {flagRows.map((row) => (
        <div
          key={row.id}
          ref={(node) => {
            if (node) flagNodesRef.current.set(row.id, node);
            else flagNodesRef.current.delete(row.id);
          }}
          className={`pve2-training-flag-label is-${row.team} is-${row.troopState} ${row.selected ? 'is-selected' : ''}`}
          data-training-flag={row.id}
          aria-label={`${row.name}：兵力 ${row.remain}/${row.startCount}，技能点 ${row.skillPoints}`}
        >
          <div className="pve2-training-flag-banner">
            <div className="pve2-training-flag-troops">
              <span>兵</span>
              <strong>{row.remain}</strong>
              <em>{`/${row.startCount}`}</em>
            </div>
            <span className="pve2-training-flag-health" aria-hidden="true">
              <i style={{ width: `${Math.round(row.ratio * 100)}%` }} />
            </span>
            <div className="pve2-training-flag-points">
              <span>点</span>
              <strong>{row.skillPoints}</strong>
            </div>
          </div>
        </div>
      ))}
      {damageNumbers.map((event) => (
        <span
          key={event.id}
          ref={(node) => {
            if (node) damageNodesRef.current.set(event.id, node);
            else damageNodesRef.current.delete(event.id);
          }}
          className={`pve2-training-damage-number is-${event.team}`}
          aria-hidden="true"
        >
          {`-${displayDamage(event.amount)}`}
        </span>
      ))}
    </div>
  );
};

export default TrainingFlagLabels;
