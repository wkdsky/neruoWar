import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  areTrainingFlagAnchorsInMapContact,
  resolveTrainingFlagLod,
  resolveTrainingInfoLabelElevation,
  resolveTrainingNeutralPreviewAnchors,
  resolveTrainingWorldFlagDimensions,
  resolveTrainingWorldFlagStackLayout
} from '../render/TrainingThreeRenderPipeline';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const resolveTrainingFlagLabelCameraDepth = (source = {}, elevation = 0, camera = null) => {
  const eye = Array.isArray(camera?.eye) ? camera.eye : [0, 0, 0];
  const configuredForward = Array.isArray(camera?.renderForward) ? camera.renderForward : null;
  const target = Array.isArray(camera?.target) ? camera.target : null;
  const forward = configuredForward || (target
    ? [
        (Number(target[0]) || 0) - (Number(eye[0]) || 0),
        (Number(target[1]) || 0) - (Number(eye[1]) || 0),
        (Number(target[2]) || 0) - (Number(eye[2]) || 0)
      ]
    : null);
  const delta = [
    (Number(source?.x) || 0) - (Number(eye[0]) || 0),
    (Number(source?.y) || 0) - (Number(eye[1]) || 0),
    (Number(elevation) || 0) - (Number(eye[2]) || 0)
  ];
  const forwardLength = forward
    ? Math.hypot(Number(forward[0]) || 0, Number(forward[1]) || 0, Number(forward[2]) || 0)
    : 0;
  if (forwardLength <= 1e-6) return Math.hypot(...delta);
  return Math.max(0, (
    (delta[0] * (Number(forward[0]) || 0))
      + (delta[1] * (Number(forward[1]) || 0))
      + (delta[2] * (Number(forward[2]) || 0))
  ) / forwardLength);
};

const normalizeTrainingFlagTeam = (team = '') => {
  if (team === 'defender') return 'defender';
  if (team === 'neutral') return 'neutral';
  return 'attacker';
};

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

export const resolveTrainingFlagCombatTargetIds = (source = {}) => {
  const underAttack = (Number(source?.underAttackTimer) || 0) > 0.05;
  const minionCombatActive = source?.isMinionWaveUnit !== true
    || String(source?.minionAiState || '') === 'ATTACK_HOLD'
    || String(source?.action || '') === '兵线交战'
    || underAttack;
  return Array.from(new Set([
    minionCombatActive ? source?._combatEngagementTargetId : '',
    underAttack ? source?.lastDamagedBySquadId : ''
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
};

export const areTrainingFlagRowsCombatLinked = (left = {}, right = {}) => {
  const leftId = String(left?.id || '').trim();
  const rightId = String(right?.id || '').trim();
  if (!leftId || !rightId || leftId === rightId) return false;
  const leftTargets = Array.isArray(left?.combatTargetIds)
    ? left.combatTargetIds
    : resolveTrainingFlagCombatTargetIds(left);
  const rightTargets = Array.isArray(right?.combatTargetIds)
    ? right.combatTargetIds
    : resolveTrainingFlagCombatTargetIds(right);
  return leftTargets.some((targetId) => String(targetId || '') === rightId)
    || rightTargets.some((targetId) => String(targetId || '') === leftId);
};

export const buildTrainingFlagRows = (squads = []) => {
  return (Array.isArray(squads) ? squads : [])
    .filter((row) => row && row.placed !== false && (Number(row.remain) || 0) > 0)
    .map((row) => {
      const ratio = resolveTrainingTroopRatio(row);
      const team = normalizeTrainingFlagTeam(row.team);
      const isMinionWaveUnit = row?.isMinionWaveUnit === true;
      return {
        id: String(row.id || ''),
        name: String(row.name || '部队'),
        team,
        remain: Math.max(0, Math.floor(Number(row.remain) || 0)),
        startCount: Math.max(0, Math.floor(Number(row.startCount) || 0)),
        skillPoints: Math.max(0, Math.floor(Number(row?.trainingSkillPoints) || 0)),
        showSkillPoints: !isMinionWaveUnit && team !== 'neutral',
        x: Number.isFinite(Number(row.centerX)) ? Number(row.centerX) : (Number(row.x) || 0),
        y: Number.isFinite(Number(row.centerY)) ? Number(row.centerY) : (Number(row.y) || 0),
        contactX: Number.isFinite(Number(row.centerX)) ? Number(row.centerX) : (Number(row.x) || 0),
        contactY: Number.isFinite(Number(row.centerY)) ? Number(row.centerY) : (Number(row.y) || 0),
        radius: Math.max(0, Number(row.radius) || 0),
        contactRadius: Math.max(0, Number(row.contactRadius) || Number(row.radius) || 0),
        isMinionWaveUnit,
        minionLaneId: String(row?.minionLaneId || '').trim(),
        minionBarracksLane: String(row?.minionBarracksLane || '').trim(),
        minionExitId: String(row?.minionExitId || '').trim(),
        combatTargetIds: resolveTrainingFlagCombatTargetIds(row),
        ratio,
        troopState: resolveTrainingTroopState(ratio),
        selected: !!row.selected
      };
    })
    .filter((row) => row.id);
};

export const buildTrainingFlagRowsWithNeutralPreview = (squads = [], neutralPreview = null) => {
  const sourceRows = Array.isArray(squads) ? squads : [];
  const existingIds = new Set(
    sourceRows.map((row) => String(row?.id || '')).filter(Boolean)
  );
  const neutralAnchors = resolveTrainingNeutralPreviewAnchors(neutralPreview);
  const neutralRows = [];
  (Array.isArray(neutralPreview?.squads) ? neutralPreview.squads : []).forEach((squad) => {
    const id = String(squad?.id || '');
    if (!id || existingIds.has(id)) return;
    const anchor = neutralAnchors.get(id);
    neutralRows.push({
      ...squad,
      id,
      team: 'neutral',
      placed: true,
      x: Number.isFinite(Number(anchor?.x)) ? Number(anchor.x) : (Number(squad?.x) || 0),
      y: Number.isFinite(Number(anchor?.y)) ? Number(anchor.y) : (Number(squad?.y) || 0),
      centerX: Number.isFinite(Number(anchor?.centerX)) ? Number(anchor.centerX) : (Number(squad?.centerX) || Number(squad?.x) || 0),
      centerY: Number.isFinite(Number(anchor?.centerY)) ? Number(anchor.centerY) : (Number(squad?.centerY) || Number(squad?.y) || 0)
    });
    existingIds.add(id);
  });
  return buildTrainingFlagRows([...sourceRows, ...neutralRows]);
};

export const resolveTrainingFlagLiveSource = (runtime = null, phase = '', row = {}) => {
  const squadId = String(row?.id || '');
  if (phase === 'battle' || phase === 'ended') {
    const squad = runtime?.getSquadById?.(squadId) || null;
    const renderedAnchor = runtime?.getRenderedBattleSquadAnchor?.(squadId) || null;
    if (!renderedAnchor) return squad;
    if (!squad) return renderedAnchor;
    return { ...squad, ...renderedAnchor };
  }
  return runtime?.getDeployGroupById?.(squadId, 'any') || null;
};

const TRAINING_FLAG_LABEL_NEAR_DISTANCE = 460;
const TRAINING_FLAG_LABEL_FAR_DISTANCE = 760;

export const resolveTrainingHoveredSquadId = (runtime = null, phase = 'battle') => (
  String(
    (phase === 'deploy' ? runtime?.hoveredDeploySquadId : runtime?.hoveredBattleSquadId)
      || ''
  ).trim()
);

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
    visible: row?.isMinionWaveUnit === true || flagLod.infoLabel
  };
};

export const resolveTrainingFlagLabelStackLayout = (items = [], {
  horizontalThreshold = 118,
  verticalThreshold = 34,
  fallbackHeight = 14,
  columnGap = 6,
  canMerge = areTrainingFlagAnchorsInMapContact
} = {}) => {
  const entries = (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || ''),
      point: item?.point,
      source: item?.source || item,
      height: Math.max(1, Number(item?.height) || fallbackHeight),
      width: Math.max(1, Number(item?.width) || 1),
      team: String((item?.source || item)?.team || ''),
      visible: item?.point?.visible !== false
    }))
    .filter((item) => item.id && item.visible && Number.isFinite(Number(item.point?.x)) && Number.isFinite(Number(item.point?.y)));
  const groups = [];
  const canMergeEntries = typeof canMerge === 'function'
    ? (left, right) => canMerge(left.source, right.source)
    : () => false;
  entries.forEach((entry) => {
    const matches = groups.filter((group) => group.some((member) => (
      canMergeEntries(member, entry)
      && Math.abs(Number(member.point.x) - Number(entry.point.x)) <= horizontalThreshold
      && Math.abs(Number(member.point.y) - Number(entry.point.y)) <= verticalThreshold
    )));
    if (matches.length <= 0) {
      groups.push([entry]);
      return;
    }
    const merged = [entry];
    matches.forEach((group) => merged.push(...group));
    matches.forEach((group) => {
      const index = groups.indexOf(group);
      if (index >= 0) groups.splice(index, 1);
    });
    groups.push(merged);
  });

  const layout = {};
  groups.forEach((group) => {
    const columnsByTeam = new Map();
    group.forEach((item) => {
      const key = item.team || 'unknown';
      if (!columnsByTeam.has(key)) columnsByTeam.set(key, []);
      columnsByTeam.get(key).push(item);
    });
    const teamOrder = { attacker: 0, neutral: 1, defender: 2, unknown: 3 };
    const columns = [...columnsByTeam.entries()]
      .map(([team, columnItems]) => ({
        team,
        items: columnItems,
        width: Math.max(...columnItems.map((item) => item.width)),
        height: columnItems.reduce((sum, item) => sum + item.height, 0),
        anchorX: columnItems.reduce((sum, item) => sum + Number(item.point.x), 0) / columnItems.length,
        anchorY: columnItems.reduce((sum, item) => (
          sum + Number(item.point.y) - (item.height * 0.5)
        ), 0) / columnItems.length
      }))
      .sort((left, right) => (
        (teamOrder[left.team] ?? 4) - (teamOrder[right.team] ?? 4)
        || left.team.localeCompare(right.team)
      ));
    const centerX = columns.reduce((sum, column) => sum + column.anchorX, 0) / columns.length;
    const centerY = columns.reduce((sum, column) => sum + column.anchorY, 0) / columns.length;
    const safeColumnGap = Math.max(0, Number(columnGap) || 0);
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0)
      + (Math.max(0, columns.length - 1) * safeColumnGap);
    let cursorX = centerX - (totalWidth * 0.5);
    columns.forEach((column, columnIndex) => {
      const columnX = cursorX + (column.width * 0.5);
      const sorted = [...column.items].sort((left, right) => (
        (Number(left.point.y) - Number(right.point.y))
        || left.id.localeCompare(right.id)
      ));
      let cursorY = centerY - (column.height * 0.5);
      sorted.forEach((item, index) => {
        cursorY += item.height;
        layout[item.id] = {
          x: columnX,
          y: cursorY,
          width: column.width,
          height: item.height,
          stackIndex: index,
          stackSize: sorted.length,
          clusterSize: group.length,
          clusterCenterX: centerX,
          clusterCenterY: centerY,
          columnIndex,
          columnCount: columns.length
        };
      });
      cursorX += column.width + safeColumnGap;
    });
  });
  return layout;
};

export const resolveTrainingFlagLabelDepthOrder = (items = []) => {
  const order = {};
  (Array.isArray(items) ? items : [])
    .filter((item) => item?.id && Number.isFinite(Number(item?.distance)))
    .slice()
    .sort((left, right) => (
      Number(right.distance) - Number(left.distance)
      || String(left.id).localeCompare(String(right.id))
    ))
    .forEach((item, index) => {
      order[String(item.id)] = index + 1;
    });
  return order;
};

const placeWorldNode = (
  node,
  source,
  worldToDomRef,
  anchor = 'flag',
  cameraDistance = 0,
  cameraPitch = 90,
  projectedPoint = null
) => {
  if (!node) return;
  const project = worldToDomRef?.current;
  if (typeof project !== 'function') {
    node.style.opacity = '0';
    node.style.pointerEvents = 'none';
    return;
  }
  const flagPresentation = anchor === 'flag'
    ? resolveTrainingFlagLabelPresentation(source, cameraDistance, cameraPitch)
    : null;
  if (anchor === 'flag') node.style.display = 'block';
  const point = projectedPoint || project({
    x: Number(source?.x) || 0,
    y: Number(source?.y) || 0,
    z: flagPresentation
      ? flagPresentation.elevation + (flagPresentation.visible ? 0 : 14)
      : Math.max(8, Number(source?.z) || 3)
  });
  if (!point?.visible) {
    node.style.opacity = '0';
    node.style.pointerEvents = 'none';
    return;
  }
  const isWorldHidden = anchor === 'flag' && !flagPresentation.visible;
  node.style.pointerEvents = anchor === 'flag' && !isWorldHidden ? 'auto' : 'none';
  node.style.opacity = isWorldHidden ? '0' : '1';
  if (anchor === 'flag') node.classList.toggle('is-world-hidden', isWorldHidden);
  if (anchor === 'flag') {
    node.style.zIndex = String(Math.max(0, Math.floor(Number(point?.zIndex) || 0)));
    node.style.transform = `translate3d(${Number(point.x).toFixed(2)}px, ${Number(point.y).toFixed(2)}px, 0) translate(-50%, ${isWorldHidden ? '-50%' : '-100%'}) scale(${flagPresentation.scale.toFixed(3)})`;
    return;
  }
  node.style.setProperty('--pve2-world-x', `${Math.round(point.x)}px`);
  node.style.setProperty('--pve2-world-y', `${Math.round(point.y)}px`);
};

const displayDamage = (amount = 0) => Math.max(1, Math.round(Number(amount) || 0));

const TrainingFlagLabels = ({
  squads = [],
  phase = 'deploy',
  runtimeRef,
  worldToDomRef,
  cameraRef,
  onHoverSquad = null,
  onSelectSquad = null,
  onAttackSquadTarget = null
}) => {
  const neutralPreview = phase === 'deploy'
    ? runtimeRef?.current?.getTrainingNeutralPreview?.() || null
    : null;
  const flagRows = useMemo(
    () => buildTrainingFlagRowsWithNeutralPreview(squads, neutralPreview),
    [neutralPreview, squads]
  );
  const flagNodesRef = useRef(new Map());
  const damageNodesRef = useRef(new Map());
  const seenDamageRef = useRef(new Map());
  const removeTimersRef = useRef(new Set());
  const hoveredSquadRef = useRef('');
  const [damageNumbers, setDamageNumbers] = useState([]);
  const [hoveredSquadId, setHoveredSquadId] = useState('');

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
          team: normalizeTrainingFlagTeam(event?.team),
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
      const runtime = runtimeRef?.current;
      const runtimeHoveredSquadId = resolveTrainingHoveredSquadId(runtime, phase);
      if (hoveredSquadRef.current !== runtimeHoveredSquadId) {
        hoveredSquadRef.current = runtimeHoveredSquadId;
        setHoveredSquadId(runtimeHoveredSquadId);
      }
      const liveFlagRows = flagRows.map((row) => {
        const source = resolveTrainingFlagLiveSource(runtime, phase, row);
        if (!source) return row;
        return {
          ...row,
          x: Number.isFinite(Number(source.centerX)) ? Number(source.centerX) : (Number(source.x) || 0),
          y: Number.isFinite(Number(source.centerY)) ? Number(source.centerY) : (Number(source.y) || 0),
          contactX: Number.isFinite(Number(source.centerX)) ? Number(source.centerX) : (Number(source.x) || 0),
          contactY: Number.isFinite(Number(source.centerY)) ? Number(source.centerY) : (Number(source.y) || 0),
          radius: Math.max(0, Number(source.radius) || Number(row.radius) || 0),
          contactRadius: Math.max(
            0,
            Number(source.contactRadius) || Number(source.radius) || Number(row.contactRadius) || Number(row.radius) || 0
          ),
          combatTargetIds: resolveTrainingFlagCombatTargetIds(source)
        };
      });
      const cameraDistance = Number(cameraRef?.current?.distance) || 0;
      const requestedCameraPitch = Number(cameraRef?.current?.currentPitch);
      const cameraPitch = Number.isFinite(requestedCameraPitch) ? requestedCameraPitch : 90;
      const worldFlagBasePoints = {};
      const camera = cameraRef?.current;
      const worldFlagStackLayout = resolveTrainingWorldFlagStackLayout(
        liveFlagRows.filter((row) => row.isMinionWaveUnit !== true),
        (row) => {
          const dimensions = resolveTrainingWorldFlagDimensions(row);
          const point = typeof worldToDomRef?.current === 'function'
            ? worldToDomRef.current({
                x: Number(row.x) || 0,
                y: Number(row.y) || 0,
                z: dimensions.clothBottom
              })
            : null;
          if (point) worldFlagBasePoints[row.id] = point;
          return point
            ? {
                ...point,
                distance: resolveTrainingFlagLabelCameraDepth(row, dimensions.clothBottom, camera)
              }
            : point;
        }
      );
      const projectedFlags = liveFlagRows.map((row) => {
        const presentation = resolveTrainingFlagLabelPresentation(row, cameraDistance, cameraPitch);
        const worldFlagDimensions = resolveTrainingWorldFlagDimensions(row);
        const node = flagNodesRef.current.get(row.id);
        if (node) {
          node.style.width = 'max-content';
          node.classList.remove('is-stacked', 'is-stack-top', 'is-stack-middle', 'is-stack-bottom');
        }
        let point = typeof worldToDomRef?.current === 'function'
          ? worldToDomRef.current({
              x: Number(row.x) || 0,
              y: Number(row.y) || 0,
              z: presentation.visible ? presentation.elevation : worldFlagDimensions.clothBottom
            })
          : null;
        if (point?.visible && !presentation.visible) {
          const leaderId = worldFlagStackLayout.leaderById[row.id] || row.id;
          const leaderPoint = worldFlagBasePoints[leaderId] || point;
          const stackLevel = Math.max(0, Math.floor(Number(worldFlagStackLayout.levels[row.id]) || 0));
          point = {
            ...leaderPoint,
            y: Number(leaderPoint.y) - 38 - (stackLevel * 34)
          };
        }
        return {
          id: row.id,
          point,
          worldFlag: !presentation.visible,
          source: row,
          height: Math.max(1, Number(node?.offsetHeight) || 14) * presentation.scale,
          width: Math.max(1, Number(node?.offsetWidth) || (row.showSkillPoints ? 102 : 86)),
          distance: resolveTrainingFlagLabelCameraDepth(row, presentation.elevation, camera)
        };
      });
      const visibleInfoLabels = projectedFlags.filter((item) => (
        !item.worldFlag && item.point?.visible !== false
      ));
      const stackLayout = resolveTrainingFlagLabelStackLayout(visibleInfoLabels);
      const depthOrder = resolveTrainingFlagLabelDepthOrder(
        visibleInfoLabels
      );
      liveFlagRows.forEach((row) => {
        const sourcePoint = projectedFlags.find((item) => item.id === row.id)?.point;
        const stackedPoint = stackLayout[row.id] || sourcePoint;
        const node = flagNodesRef.current.get(row.id);
        const stackSize = Math.max(1, Math.floor(Number(stackedPoint?.stackSize) || 1));
        const stackIndex = Math.max(0, Math.floor(Number(stackedPoint?.stackIndex) || 0));
        if (node && stackSize > 1) {
          node.style.width = `${Math.max(1, Number(stackedPoint?.width) || 1)}px`;
          node.classList.add('is-stacked');
          node.classList.add(stackIndex === 0
            ? 'is-stack-top'
            : (stackIndex === stackSize - 1 ? 'is-stack-bottom' : 'is-stack-middle'));
        }
        const point = sourcePoint && stackedPoint
          ? {
              ...sourcePoint,
              x: stackedPoint.x,
              y: stackedPoint.y,
              zIndex: depthOrder[row.id] || 0
            }
          : sourcePoint;
        placeWorldNode(
          node,
          row,
          worldToDomRef,
          'flag',
          cameraDistance,
          cameraPitch,
          point
        );
      });
      damageNumbers.forEach((event) => {
        placeWorldNode(damageNodesRef.current.get(event.id), event, worldToDomRef, 'damage');
      });
      frameId = requestFrame(positionNodes);
    };
    positionNodes();
    return () => cancelFrame(frameId);
  }, [cameraRef, damageNumbers, flagRows, phase, runtimeRef, worldToDomRef]);

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
          className={`pve2-training-flag-label is-${row.team} is-${row.troopState} ${row.isMinionWaveUnit ? 'is-minion-wave' : ''} ${row.showSkillPoints ? '' : 'has-no-skill-points'} ${row.selected ? 'is-selected' : ''} ${hoveredSquadId === row.id ? 'is-hovered' : ''}`}
          data-training-flag={row.id}
          data-training-minion={row.isMinionWaveUnit ? 'true' : undefined}
          aria-label={row.showSkillPoints
            ? `${row.name}：兵力 ${row.remain}/${row.startCount}，技能点 ${row.skillPoints}`
            : `${row.name}：兵力 ${row.remain}/${row.startCount}`}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.button !== 2) return;
            event.preventDefault();
            onAttackSquadTarget?.(row.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseEnter={() => {
            hoveredSquadRef.current = row.id;
            setHoveredSquadId(row.id);
            onHoverSquad?.(row.id);
          }}
          onMouseLeave={() => {
            if (hoveredSquadRef.current !== row.id) return;
            hoveredSquadRef.current = '';
            setHoveredSquadId('');
            onHoverSquad?.('');
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelectSquad?.(row.id);
          }}
        >
          {row.isMinionWaveUnit ? (
            <div className="pve2-training-minion-hud">
              <strong>{row.remain}</strong>
              <span className="pve2-training-minion-health" aria-hidden="true">
                <i style={{ width: `${Math.round(row.ratio * 100)}%` }} />
              </span>
            </div>
          ) : (
            <div className="pve2-training-flag-banner">
              <div className="pve2-training-flag-troops">
                <span>兵</span>
                <strong>{row.remain}</strong>
                <em>{`/${row.startCount}`}</em>
              </div>
              <span className="pve2-training-flag-health" aria-hidden="true">
                <i style={{ width: `${Math.round(row.ratio * 100)}%` }} />
              </span>
              {row.showSkillPoints ? (
                <div className="pve2-training-flag-points">
                  <span>点</span>
                  <strong>{row.skillPoints}</strong>
                </div>
              ) : null}
            </div>
          )}
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
