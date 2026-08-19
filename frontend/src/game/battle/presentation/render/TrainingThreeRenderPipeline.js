import * as THREE from 'three';
import {
  BUILDING_INSTANCE_STRIDE,
  EFFECT_INSTANCE_STRIDE,
  PROJECTILE_INSTANCE_STRIDE,
  UNIT_INSTANCE_STRIDE
} from '../snapshot/BattleSnapshotSchema';
import {
  resolveTrainingDirectionArcLayout,
  sampleTrainingDirectionArc
} from '../../shared/trainingDirectionArc';
import {
  resolveTrainingSelectedUnitRingRadius
} from '../../shared/trainingUnitSelection';
import {
  getSkillPaintRemainingRadius,
  isPointInsideSkillPaintArea
} from '../../shared/skillPaintArea';
import {
  resolveTrainingMapTerrainElevation,
  TRAINING_MAP_WORLD_HEIGHT,
  TRAINING_MAP_WORLD_WIDTH
} from '../../shared/trainingMap';
import { getTrainingMapSpawnRegions } from '../../shared/trainingMapSpawn';
import TrainingChibiUnitRenderer from './TrainingChibiUnitRenderer';
import { resolveTrainingRenderedSquadAnchors } from '../snapshot/BattleRenderedSquadAnchors';

export { resolveTrainingRenderedSquadAnchors } from '../snapshot/BattleRenderedSquadAnchors';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + ((b - a) * t);
const tempMatrix = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();
const tempEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const tempScale = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempWorldFlagCameraForward = new THREE.Vector3();
const tempWorldFlagCameraUp = new THREE.Vector3();

const TEAM_ATTACKER_COLOR = new THREE.Color(0xd95155);
const TEAM_DEFENDER_COLOR = new THREE.Color(0x32b4bd);
const TEAM_NEUTRAL_COLOR = new THREE.Color(0xf4c542);
const TEAM_ATTACKER = 'attacker';
const TEAM_DEFENDER = 'defender';
const TEAM_NEUTRAL = 'neutral';
const SELECTED_COLOR = new THREE.Color(0xf4c542);
const HOVER_COLOR = new THREE.Color(0x9deaff);
const HOVER_FOOTPRINT_COLOR = new THREE.Color(0x91e7ff);
const SKILL_PREVIEW_ARROW_COLOR = 0xffa04d;
const SKILL_PREVIEW_RANGE_COLOR = 0xf59e0b;
const SKILL_PREVIEW_TARGET_COLOR = 0xff4d6d;
const SKILL_PREVIEW_GROUND_Z = 0.26;
const SKILL_PREVIEW_TARGET_Z = 0.34;
const SKILL_PREVIEW_CONE_SEGMENTS = 48;
const TRAINING_MAX_PIXEL_RATIO = 1.25;
const TRAINING_DEPLOY_REGION_HIGHLIGHT_ELEVATION = 0.42;
const TRAINING_DEPLOY_REGION_HIGHLIGHT_COLORS = Object.freeze({
  [TEAM_ATTACKER]: 0xff747d,
  [TEAM_DEFENDER]: 0x62e6ef
});

const resolveTrainingTeamIndex = (team = TEAM_ATTACKER) => {
  if (team === TEAM_DEFENDER) return 1;
  if (team === TEAM_NEUTRAL) return 2;
  return 0;
};

const isTrainingNeutralTeamIndex = (teamIndex = 0) => Number(teamIndex) >= 1.5;

const resolveTrainingTeamColor = (teamIndex = 0) => {
  if (isTrainingNeutralTeamIndex(teamIndex)) return TEAM_NEUTRAL_COLOR;
  return Number(teamIndex) >= 0.5 ? TEAM_DEFENDER_COLOR : TEAM_ATTACKER_COLOR;
};

export const shouldRenderTrainingUnitGroundMarker = (teamIndex = 0) => !isTrainingNeutralTeamIndex(teamIndex);

export const resolveTrainingFlagShowsSkillPoints = (anchor = {}) => (
  anchor?.showSkillPoints !== false && String(anchor?.team || '') !== TEAM_NEUTRAL
);

export const TRAINING_WORLD_FLAG_MAX_PITCH_DEG = 50;
export const TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT = 76;
export const TRAINING_WORLD_FLAG_MIN_SCREEN_SCALE = 0.85;
export const TRAINING_WORLD_FLAG_MAX_SCREEN_SCALE = 8;
export const TRAINING_DIRECTION_ARC_GROUND_ELEVATION = 0.1;

export const resolveTrainingFlagLod = (pitchDeg = 90) => {
  const normalizedPitch = Number.isFinite(Number(pitchDeg)) ? Number(pitchDeg) : 90;
  const worldFlag = normalizedPitch <= TRAINING_WORLD_FLAG_MAX_PITCH_DEG;
  return {
    worldFlag,
    infoLabel: !worldFlag
  };
};

const finiteOr = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const resolveTrainingRenderFrameInterval = () => 0;

const normalizeSkillPreviewVector = (x, y, fallbackX = 1, fallbackY = 0) => {
  const length = Math.hypot(Number(x) || 0, Number(y) || 0);
  if (length <= 1e-5) {
    return { x: fallbackX, y: fallbackY };
  }
  return {
    x: (Number(x) || 0) / length,
    y: (Number(y) || 0) / length
  };
};

const pointToSkillPreviewSegmentDistance = (point = {}, start = {}, end = {}) => {
  const ax = finiteOr(start?.x);
  const ay = finiteOr(start?.y);
  const bx = finiteOr(end?.x);
  const by = finiteOr(end?.y);
  const px = finiteOr(point?.x);
  const py = finiteOr(point?.y);
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSq = (vx * vx) + (vy * vy);
  if (lengthSq <= 1e-5) return Math.hypot(px - ax, py - ay);
  const t = clamp((((px - ax) * vx) + ((py - ay) * vy)) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + (vx * t)), py - (ay + (vy * t)));
};

export const resolveTrainingHoverPresentation = (cameraState = {}) => {
  const distance = Math.max(0, finiteOr(cameraState?.distance, 560));
  const distanceProgress = clamp((distance - 560) / (2200 - 560), 0, 1);
  const overviewProgress = clamp(finiteOr(cameraState?.overviewZoomProgress), 0, 1);
  const rawProgress = Math.max(distanceProgress, overviewProgress);
  const zoomOutProgress = rawProgress * rawProgress * (3 - (2 * rawProgress));
  return {
    zoomOutProgress,
    outerOpacity: lerp(0.2, 0.42, zoomOutProgress),
    innerOpacity: lerp(0.34, 0.64, zoomOutProgress),
    outerColorMix: lerp(0.26, 0.48, zoomOutProgress),
    innerColorMix: lerp(0.48, 0.72, zoomOutProgress)
  };
};

export const resolveTrainingHoverFootprint = (unitSize = 2.6, zoomOutProgress = 0) => {
  const safeUnitSize = clamp(finiteOr(unitSize, 2.6), 2.6, 10.5);
  const safeZoomOutProgress = clamp(finiteOr(zoomOutProgress), 0, 1);
  const distantScale = lerp(1, 1.12, safeZoomOutProgress);
  return {
    outer: {
      width: safeUnitSize * 1.96 * distantScale,
      depth: safeUnitSize * 1.62 * distantScale,
      elevation: 0.078
    },
    inner: {
      width: safeUnitSize * 1.58 * distantScale,
      depth: safeUnitSize * 1.3 * distantScale,
      elevation: 0.092
    }
  };
};

const resolveSkillPreviewTargetMode = (skillConfirmState = {}, profile = {}) => (
  skillConfirmState?.targetMode
    || profile?.targetMode
    || (skillConfirmState?.kind === 'cavalry' ? 'direction' : (
      skillConfirmState?.kind === 'archer' || skillConfirmState?.kind === 'artillery' ? 'ground' : 'self'
    ))
);

const resolveSkillPreviewSquad = (runtime = null, squadId = '') => {
  if (!runtime || !squadId) return null;
  return runtime.getSquadById?.(squadId)
    || (Array.isArray(runtime?.sim?.squads)
      ? runtime.sim.squads.find((squad) => String(squad?.id || '') === String(squadId))
      : null);
};

const resolveSkillPreviewAgents = (runtime = null) => (
  Array.isArray(runtime?.crowd?.allAgents)
    ? runtime.crowd.allAgents.filter((agent) => agent && !agent.dead && (Number(agent.weight) || 0) > 0.001)
    : []
);

const resolveSkillPaintPreviewArea = (skillConfirmState = null, targetPoint = null) => {
  const rawPaintArea = skillConfirmState?.paintArea;
  if (!rawPaintArea || !targetPoint) return null;
  const stamps = Array.isArray(rawPaintArea.stamps)
    ? rawPaintArea.stamps
      .filter((stamp) => Number(stamp?.radius) > 0.001)
      .map((stamp) => ({
        x: finiteOr(stamp?.x),
        y: finiteOr(stamp?.y),
        radius: Math.max(0, finiteOr(stamp?.radius))
      }))
    : [];
  const remainingRadius = getSkillPaintRemainingRadius(rawPaintArea);
  if (remainingRadius > 0.001) {
    stamps.push({
      x: finiteOr(targetPoint.x),
      y: finiteOr(targetPoint.y),
      radius: remainingRadius
    });
  }
  return stamps.length > 0 ? { stamps } : null;
};

export const resolveTrainingSkillPreview = (runtime = null, skillConfirmState = null) => {
  if (!skillConfirmState?.squadId) {
    return {
      active: false,
      targetMode: '',
      source: null,
      targetPoint: null,
      targetAgents: [],
      targetSquadIds: []
    };
  }
  const squadById = new Map(
    (Array.isArray(runtime?.sim?.squads) ? runtime.sim.squads : [])
      .filter((squad) => squad?.id)
      .map((squad) => [String(squad.id), squad])
  );
  const getPreviewSquad = (squadId) => (
    squadById.get(String(squadId || '')) || resolveSkillPreviewSquad(runtime, squadId)
  );
  const sourceSquad = getPreviewSquad(skillConfirmState.squadId);
  if (!sourceSquad) {
    return {
      active: false,
      targetMode: '',
      source: null,
      targetPoint: null,
      targetAgents: [],
      targetSquadIds: []
    };
  }
  const profile = skillConfirmState.profile || {};
  const targetMode = resolveSkillPreviewTargetMode(skillConfirmState, profile);
  const source = {
    x: finiteOr(skillConfirmState?.center?.x, finiteOr(sourceSquad?.x)),
    y: finiteOr(skillConfirmState?.center?.y, finiteOr(sourceSquad?.y))
  };
  const selectedTeam = sourceSquad.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
  const agents = resolveSkillPreviewAgents(runtime).filter((agent) => {
    if (agent.team === selectedTeam) return false;
    const enemySquad = getPreviewSquad(agent.squadId);
    return !(selectedTeam === TEAM_ATTACKER && enemySquad?.hiddenFromAttacker);
  });
  const targetSquadIds = new Set();
  const targetAgents = [];
  const maxRange = Math.max(8, finiteOr(skillConfirmState?.maxRange, finiteOr(profile?.maxRange, 180)));
  const aoeRadius = Math.max(8, finiteOr(skillConfirmState?.aoeRadius, finiteOr(profile?.aoeRadius, 24)));

  if (targetMode === 'direction') {
    const direction = normalizeSkillPreviewVector(
      skillConfirmState?.dir?.x,
      skillConfirmState?.dir?.y,
      finiteOr(sourceSquad?.dirX, selectedTeam === TEAM_DEFENDER ? -1 : 1),
      finiteOr(sourceSquad?.dirY)
    );
    const coneAngleDeg = Math.max(8, Math.min(180, finiteOr(profile?.coneAngleDeg, 90)));
    const minDot = Math.cos((coneAngleDeg * Math.PI / 180) * 0.5);
    const shape = String(profile?.shape || 'cone');
    agents.forEach((agent) => {
      const dx = finiteOr(agent.x) - source.x;
      const dy = finiteOr(agent.y) - source.y;
      const distance = Math.hypot(dx, dy);
      const dot = distance > 1e-5 ? (((dx / distance) * direction.x) + ((dy / distance) * direction.y)) : -1;
      const inShape = shape === 'circle'
        ? distance <= aoeRadius + 3
        : distance <= maxRange + 3 && distance > 1e-5 && dot >= minDot;
      if (!inShape) return;
      targetAgents.push(agent);
      if (agent.squadId) targetSquadIds.add(String(agent.squadId));
    });
    return {
      active: true,
      targetMode,
      source,
      targetPoint: {
        x: source.x + (direction.x * Math.max(0, finiteOr(skillConfirmState?.len, maxRange))),
        y: source.y + (direction.y * Math.max(0, finiteOr(skillConfirmState?.len, maxRange)))
      },
      castStyle: String(profile?.castStyle || ''),
      direction,
      maxRange,
      aoeRadius,
      coneAngleDeg,
      targetAgents,
      targetSquadIds: Array.from(targetSquadIds)
    };
  }

  const targetPoint = targetMode === 'enemy'
    ? (skillConfirmState.targetSquadId
      ? (() => {
          const targetSquad = getPreviewSquad(skillConfirmState.targetSquadId);
          return targetSquad
            ? { x: finiteOr(targetSquad.x), y: finiteOr(targetSquad.y) }
            : null;
        })()
      : skillConfirmState?.hoverPoint
        ? { x: finiteOr(skillConfirmState.hoverPoint.x), y: finiteOr(skillConfirmState.hoverPoint.y) }
        : null)
    : skillConfirmState?.hoverPoint
      ? { x: finiteOr(skillConfirmState.hoverPoint.x), y: finiteOr(skillConfirmState.hoverPoint.y) }
      : { x: source.x, y: source.y };

  if (targetMode === 'ground' && targetPoint) {
    const isMeleeGround = profile?.castStyle === 'melee';
    const paintArea = resolveSkillPaintPreviewArea(skillConfirmState, targetPoint);
    agents.forEach((agent) => {
      const distance = Math.hypot(finiteOr(agent.x) - targetPoint.x, finiteOr(agent.y) - targetPoint.y);
      const agentRadius = Math.max(2.4, Math.min(11, Math.sqrt(Math.max(1, finiteOr(agent.weight, 1))) * 0.82));
      const pathDistance = isMeleeGround
        ? pointToSkillPreviewSegmentDistance(agent, source, targetPoint)
        : Infinity;
      const targetedByPaint = paintArea
        ? isPointInsideSkillPaintArea(agent, paintArea, agentRadius)
        : false;
      if (paintArea && !targetedByPaint) return;
      if (!paintArea && distance > aoeRadius + agentRadius && pathDistance > aoeRadius + agentRadius) return;
      targetAgents.push(agent);
      if (agent.squadId) targetSquadIds.add(String(agent.squadId));
    });
    return {
      active: true,
      targetMode,
      source,
      targetPoint,
      castStyle: String(profile?.castStyle || ''),
      direction: normalizeSkillPreviewVector(
        finiteOr(targetPoint?.x) - source.x,
        finiteOr(targetPoint?.y) - source.y,
        finiteOr(sourceSquad?.dirX, selectedTeam === TEAM_DEFENDER ? -1 : 1),
        finiteOr(sourceSquad?.dirY)
      ),
      maxRange,
      aoeRadius,
      coneAngleDeg: Math.max(8, Math.min(180, finiteOr(profile?.coneAngleDeg, 90))),
      paintArea,
      targetAgents,
      targetSquadIds: Array.from(targetSquadIds)
    };
  } else if (targetMode === 'enemy') {
    const selectedTargetId = String(skillConfirmState.targetSquadId || '').trim();
    agents.forEach((agent) => {
      if (selectedTargetId && String(agent.squadId || '') !== selectedTargetId) return;
      if (!selectedTargetId && targetPoint) {
        const distance = Math.hypot(finiteOr(agent.x) - targetPoint.x, finiteOr(agent.y) - targetPoint.y);
        if (distance > aoeRadius + 3) return;
      }
      targetAgents.push(agent);
      if (agent.squadId) targetSquadIds.add(String(agent.squadId));
    });
  }

  return {
    active: true,
    targetMode,
    source,
    targetPoint,
    castStyle: String(profile?.castStyle || ''),
    direction: normalizeSkillPreviewVector(
      finiteOr(targetPoint?.x) - source.x,
      finiteOr(targetPoint?.y) - source.y,
      finiteOr(sourceSquad?.dirX, selectedTeam === TEAM_DEFENDER ? -1 : 1),
      finiteOr(sourceSquad?.dirY)
    ),
    maxRange,
    aoeRadius,
    coneAngleDeg: Math.max(8, Math.min(180, finiteOr(profile?.coneAngleDeg, 90))),
    targetAgents,
    targetSquadIds: Array.from(targetSquadIds)
  };
};

export const resolveTrainingWorldFlagScreenScale = ({
  clothHeight = 1,
  viewHeight = 0,
  viewportHeight = 0,
  verticalScreenFactor = 1
} = {}) => {
  const safeClothHeight = Math.max(1, finiteOr(clothHeight, 1));
  const safeViewHeight = Math.max(1e-4, finiteOr(viewHeight));
  const safeViewportHeight = Math.max(1, finiteOr(viewportHeight));
  const safeVerticalScreenFactor = clamp(Math.abs(finiteOr(verticalScreenFactor, 1)), 0.35, 1);
  const targetWorldHeight = (
    safeViewHeight
    * (TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT / safeViewportHeight)
  ) / safeVerticalScreenFactor;
  return clamp(
    targetWorldHeight / safeClothHeight,
    TRAINING_WORLD_FLAG_MIN_SCREEN_SCALE,
    TRAINING_WORLD_FLAG_MAX_SCREEN_SCALE
  );
};

const resolveMarkerStrength = (source = null) => {
  const direct = Math.max(0, finiteOr(source?.remain), finiteOr(source?.startCount));
  const unitCount = Object.values(source?.units || {})
    .reduce((sum, value) => sum + Math.max(0, finiteOr(value)), 0);
  return Math.max(direct, unitCount);
};

export const resolveTrainingWorldFlagDimensions = (source = null) => {
  const count = Math.max(1, resolveMarkerStrength(source));
  const radius = Math.max(0, finiteOr(source?.radius));
  const clothHeight = clamp(
    Math.max(17, radius * 0.16, Math.sqrt(count) * 0.33),
    17,
    25
  );
  const clothWidth = clamp(
    Math.max(36, clothHeight * 2.08, radius * 0.28, Math.sqrt(count) * 0.28),
    36,
    54
  );
  const clothBottom = 2.2;
  const poleHeight = clothBottom + clothHeight + 1.05;
  return {
    poleHeight,
    clothHeight,
    clothWidth,
    clothBottom
  };
};

export const resolveTrainingInfoLabelElevation = (source = null) => {
  const count = Math.max(1, resolveMarkerStrength(source));
  const radius = Math.max(0, finiteOr(source?.radius));
  return clamp(Math.max(6, radius * 0.1, 4 + (Math.sqrt(count) * 0.1)), 6, 14);
};

const TRAINING_WORLD_FLAG_CAMERA_FOV_DEG = 48;
const TRAINING_FLAG_CANVAS_WIDTH = 512;
const TRAINING_FLAG_CANVAS_HEIGHT = 232;
const TRAINING_FLAG_CANVAS_HORIZONTAL_INSET = 12;
const TRAINING_FLAG_CANVAS_NOTCH = 62;
const TRAINING_FLAG_CANVAS_TOP_INSET = 34;
const TRAINING_FLAG_CANVAS_BOTTOM_INSET = 86;
const TRAINING_FLAG_CANVAS_VISIBLE_MIN_Z = TRAINING_FLAG_CANVAS_BOTTOM_INSET
  / TRAINING_FLAG_CANVAS_HEIGHT;
const TRAINING_FLAG_CANVAS_VISIBLE_MAX_Z = 1 - (TRAINING_FLAG_CANVAS_TOP_INSET
  / TRAINING_FLAG_CANVAS_HEIGHT);
const TRAINING_FLAG_CANVAS_VISIBLE_HEIGHT_RATIO = TRAINING_FLAG_CANVAS_VISIBLE_MAX_Z
  - TRAINING_FLAG_CANVAS_VISIBLE_MIN_Z;
const TRAINING_WORLD_FLAG_SHAPE_POINTS = Object.freeze([
  {
    x: TRAINING_FLAG_CANVAS_HORIZONTAL_INSET / TRAINING_FLAG_CANVAS_WIDTH,
    z: TRAINING_FLAG_CANVAS_VISIBLE_MIN_Z
  },
  {
    x: 1 - (TRAINING_FLAG_CANVAS_HORIZONTAL_INSET / TRAINING_FLAG_CANVAS_WIDTH),
    z: TRAINING_FLAG_CANVAS_VISIBLE_MIN_Z
  },
  {
    x: 1 - (TRAINING_FLAG_CANVAS_NOTCH / TRAINING_FLAG_CANVAS_WIDTH),
    z: 0.5
  },
  {
    x: 1 - (TRAINING_FLAG_CANVAS_HORIZONTAL_INSET / TRAINING_FLAG_CANVAS_WIDTH),
    z: TRAINING_FLAG_CANVAS_VISIBLE_MAX_Z
  },
  {
    x: TRAINING_FLAG_CANVAS_HORIZONTAL_INSET / TRAINING_FLAG_CANVAS_WIDTH,
    z: TRAINING_FLAG_CANVAS_VISIBLE_MAX_Z
  }
]);

const hasFiniteVector3 = (value) => (
  Array.isArray(value)
  && Number.isFinite(Number(value[0]))
  && Number.isFinite(Number(value[1]))
  && Number.isFinite(Number(value[2]))
);

const normalizeTrainingWorldFlagVector = (vector, fallback = [0, 0, -1]) => {
  const source = hasFiniteVector3(vector) ? vector : fallback;
  const length = Math.hypot(Number(source[0]) || 0, Number(source[1]) || 0, Number(source[2]) || 0);
  if (length <= 1e-6) return [...fallback];
  return [
    (Number(source[0]) || 0) / length,
    (Number(source[1]) || 0) / length,
    (Number(source[2]) || 0) / length
  ];
};

const resolveTrainingWorldFlagCameraPose = (camera = null) => {
  const eye = hasFiniteVector3(camera?.renderEye)
    ? camera.renderEye
    : (hasFiniteVector3(camera?.eye) ? camera.eye : [0, 0, 1]);
  const target = hasFiniteVector3(camera?.renderTarget)
    ? camera.renderTarget
    : (hasFiniteVector3(camera?.target) ? camera.target : [0, 0, 0]);
  const forward = hasFiniteVector3(camera?.renderForward)
    ? normalizeTrainingWorldFlagVector(camera.renderForward)
    : normalizeTrainingWorldFlagVector([
        (Number(target[0]) || 0) - (Number(eye[0]) || 0),
        (Number(target[1]) || 0) - (Number(eye[1]) || 0),
        (Number(target[2]) || 0) - (Number(eye[2]) || 0)
      ]);
  const up = hasFiniteVector3(camera?.renderUp)
    ? normalizeTrainingWorldFlagVector(camera.renderUp, [0, 0, 1])
    : [0, 0, 1];
  return { eye, forward, up };
};

export const resolveTrainingWorldFlagLayout = ({
  anchors = [],
  camera = null,
  project = null,
  viewportWidth = 1,
  viewportHeight = 1,
  viewportCssHeight = viewportHeight,
  pitchDeg = camera?.currentPitch
} = {}) => {
  if (!camera && typeof project !== 'function') return [];
  const safeWidth = Math.max(1, Number(viewportWidth) || 1);
  const safeHeight = Math.max(1, Number(viewportHeight) || 1);
  const safeCssHeight = Math.max(1, Number(viewportCssHeight) || 1);
  const safePitch = Number.isFinite(Number(pitchDeg)) ? Number(pitchDeg) : 90;
  if (!resolveTrainingFlagLod(safePitch).worldFlag) return [];
  const projectWorld = typeof project === 'function'
    ? project
    : (point) => camera?.worldToScreen?.(point, { width: safeWidth, height: safeHeight });
  if (typeof projectWorld !== 'function') return [];

  const { eye, forward, up } = resolveTrainingWorldFlagCameraPose(camera);
  const verticalScreenFactor = clamp(
    hasFiniteVector3(camera?.renderUp)
      ? Math.abs(Number(up[2]) || 0)
      : Math.abs(Math.cos(safePitch * (Math.PI / 180))),
    0.35,
    1
  );
  const safeAnchors = (Array.isArray(anchors) ? anchors : [])
    .filter((anchor) => anchor && String(anchor.id || '').trim());
  const renderInfoById = {};
  safeAnchors.forEach((anchor) => {
    const dimensions = resolveTrainingWorldFlagDimensions(anchor);
    const groundElevation = Math.max(0, finiteOr(anchor?.groundElevation));
    const dx = (Number(anchor?.x) || 0) - (Number(eye[0]) || 0);
    const dy = (Number(anchor?.y) || 0) - (Number(eye[1]) || 0);
    const dz = groundElevation + dimensions.clothBottom - (Number(eye[2]) || 0);
    const cameraDepth = Math.max(1, (dx * forward[0]) + (dy * forward[1]) + (dz * forward[2]));
    const viewHeight = 2 * cameraDepth * Math.tan((TRAINING_WORLD_FLAG_CAMERA_FOV_DEG * Math.PI / 180) * 0.5);
    const worldFlagScale = resolveTrainingWorldFlagScreenScale({
      clothHeight: dimensions.clothHeight,
      viewHeight,
      viewportHeight: safeCssHeight,
      verticalScreenFactor
    });
    renderInfoById[String(anchor.id)] = {
      ...dimensions,
      worldFlagScale,
      stackGapWorld: dimensions.clothHeight
        * worldFlagScale
        * TRAINING_FLAG_CANVAS_VISIBLE_HEIGHT_RATIO,
      scaledPoleHeight: dimensions.clothBottom + ((dimensions.clothHeight + Math.max(0.7, dimensions.poleHeight - dimensions.clothBottom - dimensions.clothHeight)) * worldFlagScale)
    };
  });
  const projectAnchor = (anchor) => {
    const info = renderInfoById[String(anchor?.id || '')] || resolveTrainingWorldFlagDimensions(anchor);
    const groundElevation = Math.max(0, finiteOr(anchor?.groundElevation));
    const point = projectWorld({
      x: Number(anchor?.x) || 0,
      y: Number(anchor?.y) || 0,
      z: groundElevation + info.clothBottom + (info.clothHeight * 0.5)
    });
    const dx = (Number(anchor?.x) || 0) - (Number(eye[0]) || 0);
    const dy = (Number(anchor?.y) || 0) - (Number(eye[1]) || 0);
    const dz = groundElevation + info.clothBottom - (Number(eye[2]) || 0);
    return point
      ? {
          ...point,
          distance: Math.hypot(dx, dy, dz)
        }
      : point;
  };
  const stackLayout = resolveTrainingWorldFlagStackLayout(safeAnchors, projectAnchor);
  return safeAnchors.map((anchor) => {
    const id = String(anchor.id);
    const info = renderInfoById[id];
    if (!info) return null;
    const leaderId = stackLayout.leaderById[id] || id;
    const leaderAnchor = stackLayout.leaderAnchorById[id] || anchor;
    const leaderInfo = renderInfoById[leaderId] || info;
    const stackLevel = Math.max(0, Math.floor(Number(stackLayout.levels[id]) || 0));
    const maxLevel = Math.max(0, Math.floor(Number(stackLayout.maxLevelByLeader[leaderId]) || 0));
    const stackOffset = stackLevel * leaderInfo.stackGapWorld;
    const displayX = Number(leaderAnchor?.x) || 0;
    const displayY = Number(leaderAnchor?.y) || 0;
    const groundElevation = Math.max(0, finiteOr(leaderAnchor?.groundElevation));
    const baseZ = groundElevation + leaderInfo.clothBottom + stackOffset;
    const cameraYaw = Math.atan2(
      (Number(eye[1]) || 0) - displayY,
      (Number(eye[0]) || 0) - displayX
    );
    return {
      id,
      anchor,
      leaderId,
      leaderAnchor,
      isLeader: leaderId === id,
      stackLevel,
      maxLevel,
      displayX,
      displayY,
      groundElevation,
      baseZ,
      cameraYaw,
      clothBottom: leaderInfo.clothBottom,
      clothHeight: leaderInfo.clothHeight,
      clothWidth: leaderInfo.clothWidth,
      worldFlagScale: leaderInfo.worldFlagScale,
      stackGapWorld: leaderInfo.stackGapWorld,
      stackedPoleHeight: leaderInfo.scaledPoleHeight + (maxLevel * leaderInfo.stackGapWorld),
      distance: Math.hypot(
        displayX - (Number(eye[0]) || 0),
        displayY - (Number(eye[1]) || 0),
        baseZ - (Number(eye[2]) || 0)
      )
    };
  });
};

export const resolveTrainingWorldFlagHitRectsFromLayouts = (layouts = [], project = null) => {
  if (typeof project !== 'function') return [];
  return (Array.isArray(layouts) ? layouts : []).map((layout) => {
    if (!layout) return null;
    const width = layout.clothWidth * layout.worldFlagScale;
    const height = layout.clothHeight * layout.worldFlagScale;
    const axisX = Math.cos(layout.cameraYaw + (Math.PI / 2));
    const axisY = Math.sin(layout.cameraYaw + (Math.PI / 2));
    const points = TRAINING_WORLD_FLAG_SHAPE_POINTS.map((point) => project({
      x: layout.displayX + (axisX * point.x * width),
      y: layout.displayY + (axisY * point.x * width),
      z: layout.baseZ + (point.z * height)
    }));
    if (points.some((point) => !point || point.visible === false)) return null;
    const xValues = points.map((point) => Number(point.x));
    const yValues = points.map((point) => Number(point.y));
    if (!xValues.every(Number.isFinite) || !yValues.every(Number.isFinite)) return null;
    return {
      ...layout,
      left: Math.min(...xValues),
      right: Math.max(...xValues),
      top: Math.min(...yValues),
      bottom: Math.max(...yValues),
      points
    };
  }).filter(Boolean);
};

export const resolveTrainingWorldFlagHitRects = (options = {}) => {
  const {
    camera = null,
    project = null,
    viewportWidth = 1,
    viewportHeight = 1
  } = options;
  const safeWidth = Math.max(1, Number(viewportWidth) || 1);
  const safeHeight = Math.max(1, Number(viewportHeight) || 1);
  const projectWorld = typeof project === 'function'
    ? project
    : (point) => camera?.worldToScreen?.(point, { width: safeWidth, height: safeHeight });
  if (typeof projectWorld !== 'function') return [];
  return resolveTrainingWorldFlagHitRectsFromLayouts(
    resolveTrainingWorldFlagLayout(options),
    projectWorld
  );
};

const isPointOnTrainingWorldFlagEdge = (start = {}, end = {}, x = 0, y = 0) => {
  const startX = Number(start.x);
  const startY = Number(start.y);
  const endX = Number(end.x);
  const endY = Number(end.y);
  const cross = ((x - startX) * (endY - startY)) - ((y - startY) * (endX - startX));
  if (Math.abs(cross) > 1e-4) return false;
  const dot = ((x - startX) * (x - endX)) + ((y - startY) * (y - endY));
  return dot <= 1e-4;
};

const isPointInsideTrainingWorldFlag = (points = [], x = 0, y = 0) => {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const start = points[previous];
    const end = points[index];
    const startX = Number(start?.x);
    const startY = Number(start?.y);
    const endX = Number(end?.x);
    const endY = Number(end?.y);
    if (![startX, startY, endX, endY].every(Number.isFinite)) return false;
    if (isPointOnTrainingWorldFlagEdge(start, end, x, y)) return true;
    const crossesRow = (startY > y) !== (endY > y);
    if (!crossesRow) continue;
    const intersectionX = ((endX - startX) * (y - startY) / (endY - startY)) + startX;
    if (x < intersectionX) inside = !inside;
  }
  return inside;
};

export const pickTrainingWorldFlagId = (rects = [], x = 0, y = 0) => {
  const safeX = Number(x);
  const safeY = Number(y);
  if (!Number.isFinite(safeX) || !Number.isFinite(safeY)) return '';
  return (Array.isArray(rects) ? rects : [])
    .filter((rect) => (
      rect
      && safeX >= Number(rect.left)
      && safeX <= Number(rect.right)
      && safeY >= Number(rect.top)
      && safeY <= Number(rect.bottom)
      && (!Array.isArray(rect.points) || isPointInsideTrainingWorldFlag(rect.points, safeX, safeY))
    ))
    .sort((left, right) => (
      (Number(left.distance) || Infinity) - (Number(right.distance) || Infinity)
      || (Number(left.stackLevel) || 0) - (Number(right.stackLevel) || 0)
    ))[0]?.id || '';
};

const SKILL_MARKER_COLORS = Object.freeze({
  infantry: '#f6d45b',
  cavalry: '#fb923c',
  ranged: '#60a5fa',
  artillery: '#c084fc',
  support: '#4ade80'
});

const SKILL_MARKER_SYMBOLS = Object.freeze({
  infantry: '⚔',
  cavalry: '➤',
  ranged: '➶',
  artillery: '✦',
  support: '+'
});

export const resolveTrainingSkillMarkerCategory = (agent = {}, sourceCategory = '') => {
  if (agent?.unitCategory === 'support' || sourceCategory === 'support') return 'support';
  const typeCategory = String(agent?.typeCategory || '').trim().toLowerCase();
  if (typeCategory === 'artillery') return 'artillery';
  if (typeCategory === 'cavalry') return 'cavalry';
  if (typeCategory === 'archer') return 'ranged';
  if (typeCategory === 'infantry') return 'infantry';
  if (sourceCategory === 'ranged') {
    return agent?.unitSubtype === 'defense' ? 'artillery' : 'ranged';
  }
  return 'infantry';
};

const resolveTrainingVisibleAgents = (runtime = null) => (
  Array.isArray(runtime?.crowd?.allAgents)
    ? runtime.crowd.allAgents.filter((agent) => {
      if (!agent || agent.dead || (Number(agent.weight) || 0) <= 0.001) return false;
      const squad = runtime?.getSquadById?.(agent.squadId);
      return !(agent.team === TEAM_DEFENDER && squad?.hiddenFromAttacker);
    })
    : []
);

const EMPTY_SKILL_VISUAL_FOCUS = Object.freeze({
  shadowFlags: null,
  focusFlags: null,
  active: false
});

export const resolveTrainingSkillVisualFocus = (runtime = null, skillConfirmState = null) => {
  const squadId = String(skillConfirmState?.squadId || '');
  if (!squadId) return EMPTY_SKILL_VISUAL_FOCUS;
  const agents = resolveTrainingVisibleAgents(runtime);
  const shadowFlags = agents.map(() => false);
  const focusFlags = agents.map(() => false);
  const sourceCategory = String(
    skillConfirmState?.profile?.sourceCategory
      || skillConfirmState?.sourceCategory
      || 'melee'
  );
  const sourceSquad = runtime?.getSquadById?.(squadId)
    || (Array.isArray(runtime?.sim?.squads)
      ? runtime.sim.squads.find((squad) => String(squad?.id || '') === squadId)
      : null);
  const sameSquad = agents.filter((agent) => String(agent?.squadId || '') === squadId);
  const activeCaster = !!sourceSquad?.activeSkill
    || !!sourceSquad?.meleeAttackOrder
    || sameSquad.some((agent) => agent?.castState);
  if (activeCaster) return { shadowFlags, focusFlags, active: true };
  const casterIds = new Set(
    sameSquad
      .filter((agent) => String(agent?.unitCategory || 'melee') === sourceCategory)
      .map((agent) => agent.id)
  );
  if (casterIds.size <= 0) return { shadowFlags, focusFlags, active: false };
  agents.forEach((agent, index) => {
    if (String(agent?.squadId || '') !== squadId) return;
    focusFlags[index] = casterIds.has(agent.id);
    shadowFlags[index] = !focusFlags[index];
  });
  return { shadowFlags, focusFlags, active: true };
};

const createTrainingSkillMarkerCanvas = (category = 'infantry', phase = 'prepare') => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const color = SKILL_MARKER_COLORS[category] || SKILL_MARKER_COLORS.infantry;
  const symbol = SKILL_MARKER_SYMBOLS[category] || SKILL_MARKER_SYMBOLS.infantry;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(48, 45);
  context.rotate(Math.PI / 4);
  context.beginPath();
  if (typeof context.roundRect === 'function') context.roundRect(-25, -25, 50, 50, 9);
  else context.rect(-25, -25, 50, 50);
  context.fillStyle = phase === 'active' ? color : 'rgba(7, 17, 29, 0.9)';
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = phase === 'active' ? 5 : 4;
  context.setLineDash(phase === 'active' ? [] : [6, 4]);
  context.stroke();
  context.restore();
  context.beginPath();
  context.arc(48, 45, 18, 0, Math.PI * 2);
  context.fillStyle = phase === 'active' ? 'rgba(7, 17, 29, 0.82)' : color;
  context.fill();
  context.strokeStyle = phase === 'active' ? '#f8fafc' : '#07111d';
  context.lineWidth = 3;
  context.stroke();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '900 29px "Segoe UI Symbol", "Noto Sans Symbols", sans-serif';
  context.fillStyle = phase === 'active' ? '#f8fafc' : '#07111d';
  context.fillText(symbol, 48, 46);
  if (phase === 'active') {
    context.beginPath();
    context.arc(48, 45, 37, 0, Math.PI * 2);
    context.strokeStyle = color;
    context.globalAlpha = 0.86;
    context.lineWidth = 3;
    context.stroke();
  }
  return canvas;
};

export const resolveTrainingMeleeAlertRect = (squad = {}, center = null) => {
  const formation = squad?.formationRect && typeof squad.formationRect === 'object'
    ? squad.formationRect
    : {};
  const radius = Math.max(12, finiteOr(squad?.radius, 24));
  const width = Math.max(32, finiteOr(formation?.width, radius * 1.8)) + 32;
  const depth = Math.max(24, finiteOr(formation?.depth, radius * 1.2)) + 32;
  const fallbackYaw = Math.atan2(finiteOr(squad?.dirY), finiteOr(squad?.dirX, squad?.team === TEAM_DEFENDER ? -1 : 1));
  return {
    x: finiteOr(center?.x, finiteOr(squad?.x)),
    y: finiteOr(center?.y, finiteOr(squad?.y)),
    width,
    depth,
    yaw: finiteOr(formation?.facingRad, fallbackYaw)
  };
};

const buildDirectionArcAnchor = (
  source = null,
  team = TEAM_ATTACKER,
  skillPoints = 0,
  hoveredDirectionArcId = '',
  preferFormationFacing = false,
  selectedId = '',
  hoveredFlagId = ''
) => {
  const startCount = Math.max(1, Math.floor(finiteOr(source?.startCount, resolveMarkerStrength(source))));
  const remain = Math.max(0, Math.floor(finiteOr(source?.remain, startCount)));
  const arcLayout = resolveTrainingDirectionArcLayout(source, team, { preferFormationFacing });
  return {
    id: String(source?.id || ''),
    x: finiteOr(source?.centerX, finiteOr(source?.x)),
    y: finiteOr(source?.centerY, finiteOr(source?.y)),
    yaw: arcLayout.directionYaw,
    teamIndex: resolveTrainingTeamIndex(team),
    team,
    name: String(source?.name || '部队'),
    remain,
    startCount,
    ratio: clamp(remain / startCount, 0, 1),
    skillPoints: team === TEAM_NEUTRAL ? 0 : Math.max(0, Math.floor(Number(skillPoints) || 0)),
    showSkillPoints: team !== TEAM_NEUTRAL,
    selected: !!source?.selected || String(source?.id || '') === String(selectedId || ''),
    hovered: String(source?.id || '') === String(hoveredDirectionArcId || ''),
    flagHovered: String(source?.id || '') === String(hoveredFlagId || ''),
    ...resolveTrainingWorldFlagDimensions(source),
    arcLayout
  };
};

export const resolveTrainingWorldFlagStackLayout = (anchors = [], project = () => null, {
  horizontalThreshold = 92,
  verticalThreshold = 58
} = {}) => {
  const entries = (Array.isArray(anchors) ? anchors : [])
    .map((anchor, index) => ({
      id: String(anchor?.id || index),
      anchor,
      point: typeof project === 'function' ? project(anchor) : null
    }))
    .filter((entry) => (
      entry.point?.visible !== false
      && Number.isFinite(Number(entry.point?.x))
      && Number.isFinite(Number(entry.point?.y))
    ));
  const groups = [];
  entries.forEach((entry) => {
    const matches = groups.filter((group) => group.some((member) => (
      Math.abs(Number(member.point.x) - Number(entry.point.x)) <= horizontalThreshold
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

  const levels = {};
  const leaderById = {};
  const maxLevelByLeader = {};
  const leaderAnchorById = {};
  groups.forEach((group) => {
    const leader = [...group].sort((left, right) => (
      ((Number.isFinite(Number(left.point.distance)) ? Number(left.point.distance) : Infinity)
        - (Number.isFinite(Number(right.point.distance)) ? Number(right.point.distance) : Infinity))
      || left.id.localeCompare(right.id)
    ))[0];
    const sorted = [...group].sort((left, right) => (
      (Number(left.point.y) - Number(right.point.y))
      || left.id.localeCompare(right.id)
    ));
    sorted.forEach((entry, index) => {
      levels[entry.id] = sorted.length - 1 - index;
      leaderById[entry.id] = leader.id;
      leaderAnchorById[entry.id] = leader.anchor;
    });
    maxLevelByLeader[leader.id] = sorted.length - 1;
  });
  return { levels, leaderById, maxLevelByLeader, leaderAnchorById };
};

export const resolveTrainingWorldFlagStackLevels = (anchors = [], project = () => null, options = {}) => (
  resolveTrainingWorldFlagStackLayout(anchors, project, options).levels
);

export const resolveTrainingDirectionArcAnchors = (runtime = null, renderedSquadAnchors = null) => {
  const phase = runtime?.getPhase?.() || runtime?.phase || 'deploy';
  const resolveSkillPoints = (source = null) => {
    const pointState = runtime?.getTrainingSquadSkillPointState?.(source?.id);
    if (Number.isFinite(Number(pointState?.points))) return Number(pointState.points);
    if (Number.isFinite(Number(source?.trainingSkillPoints))) return Number(source.trainingSkillPoints);
    return Number(runtime?.getTrainingState?.()?.points) || 0;
  };
  const hoveredDirectionArcId = runtime?.hoveredDeployDirectionArcId || '';
  const hoveredFlagId = phase === 'battle' || phase === 'ended'
    ? (runtime?.hoveredBattleSquadId || '')
    : (runtime?.hoveredDeploySquadId || '');
  if (phase === 'battle' || phase === 'ended') {
    return (Array.isArray(runtime?.sim?.squads) ? runtime.sim.squads : [])
      .filter((squad) => (
        squad
        && finiteOr(squad.remain) > 0
        && !(squad.team === TEAM_DEFENDER && squad.hiddenFromAttacker)
      ))
      .map((squad) => {
        const renderedAnchor = renderedSquadAnchors instanceof Map
          ? renderedSquadAnchors.get(String(squad?.id || ''))
          : null;
        const source = renderedAnchor
          ? {
              ...squad,
              x: finiteOr(renderedAnchor.x, finiteOr(squad?.x)),
              y: finiteOr(renderedAnchor.y, finiteOr(squad?.y)),
              centerX: finiteOr(renderedAnchor.centerX, finiteOr(renderedAnchor.x, finiteOr(squad?.centerX, finiteOr(squad?.x)))),
              centerY: finiteOr(renderedAnchor.centerY, finiteOr(renderedAnchor.y, finiteOr(squad?.centerY, finiteOr(squad?.y))))
            }
          : squad;
        return buildDirectionArcAnchor(
        source,
        squad.team,
        resolveSkillPoints(squad),
        hoveredDirectionArcId,
        false,
        runtime?.selectedBattleSquadId || '',
        hoveredFlagId
        );
      });
  }

  const anchors = [];
  const selectedDeployGroupId = runtime?.selectedDeploySquadId || '';
  const appendTeam = (groups, team) => {
    if (team === TEAM_DEFENDER && runtime?.intelVisible === false) return;
    (Array.isArray(groups) ? groups : [])
      .filter((group) => group && group.placed !== false)
      .forEach((group) => anchors.push(buildDirectionArcAnchor(
        group,
        team,
        resolveSkillPoints(group),
        hoveredDirectionArcId,
        true,
        selectedDeployGroupId,
        hoveredFlagId
      )));
  };
  appendTeam(runtime?.attackerDeployGroups, TEAM_ATTACKER);
  appendTeam(runtime?.defenderDeployGroups, TEAM_DEFENDER);
  return anchors;
};

const disposeResource = (resource, disposedResources = new Set()) => {
  if (!resource || typeof resource.dispose !== 'function' || disposedResources.has(resource)) return false;
  disposedResources.add(resource);
  resource.dispose();
  return true;
};

export const disposeTrainingMaterialCollection = (materials = {}, disposedResources = new Set()) => {
  const entries = Array.isArray(materials)
    ? materials
    : (materials?.isMaterial ? [materials] : Object.values(materials || {}));
  entries.forEach((entry) => {
    const materialList = Array.isArray(entry) ? entry : [entry];
    materialList.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value && value !== material && typeof value.dispose === 'function') {
          disposeResource(value, disposedResources);
        }
      });
      disposeResource(material, disposedResources);
    });
  });
  return disposedResources;
};

const disposeObject = (object, disposedResources = new Set()) => {
  if (!object) return;
  object.traverse?.((child) => {
    disposeResource(child.geometry, disposedResources);
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    disposeTrainingMaterialCollection(materials, disposedResources);
  });
};

const clearGroup = (group) => {
  if (!group) return;
  const disposedResources = new Set();
  while (group.children.length > 0) {
    const child = group.children.pop();
    disposeObject(child, disposedResources);
  }
};

export const prepareInstanceColorGeometry = (geometry) => {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.count <= 0) return geometry;
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(new Float32Array(position.count * 3).fill(1), 3)
  );
  return geometry;
};

const createUnitGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.46, -0.34);
  shape.lineTo(0.18, -0.34);
  shape.lineTo(0.58, 0);
  shape.lineTo(0.18, 0.34);
  shape.lineTo(-0.46, 0.34);
  shape.lineTo(-0.46, -0.34);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelSize: 0.045,
    bevelThickness: 0.035,
    bevelSegments: 1
  });
  geometry.computeVertexNormals();
  return prepareInstanceColorGeometry(geometry);
};

export const updateTrainingDirectionArcGeometry = (geometry, anchors = []) => {
  if (!geometry) return geometry;
  const positions = [];
  const colors = [];
  (Array.isArray(anchors) ? anchors : []).forEach((anchor) => {
    const samples = sampleTrainingDirectionArc(anchor?.arcLayout);
    const color = Array.isArray(anchor?.color) ? anchor.color : [1, 1, 1];
    for (let index = 1; index < samples.length; index += 1) {
      const prev = samples[index - 1];
      const next = samples[index];
      [
        prev.sideA,
        prev.sideB,
        next.sideA,
        next.sideA,
        prev.sideB,
        next.sideB
      ].forEach((point) => {
        positions.push(
          point.x,
          point.y,
          Math.max(0, finiteOr(anchor?.groundElevation)) + TRAINING_DIRECTION_ARC_GROUND_ELEVATION
        );
        colors.push(color[0], color[1], color[2]);
      });
    }
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

export const createTrainingDirectionArcGeometry = (anchors = null) => {
  const geometry = new THREE.BufferGeometry();
  const source = Array.isArray(anchors)
    ? anchors
    : [{
      arcLayout: resolveTrainingDirectionArcLayout({
        formationRect: { width: 60, depth: 18, facingRad: 0, directionOffsetRad: 0 }
      }, TEAM_ATTACKER),
      color: [1, 1, 1]
    }];
  return updateTrainingDirectionArcGeometry(geometry, source);
};

export const createTrainingDirectionArcMaterial = () => new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  transparent: true,
  opacity: 0.94,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: false,
  fog: false
});

export const createTrainingFlagClothGeometry = () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1, 0);
  shape.lineTo(0.82, 0.5);
  shape.lineTo(1, 1);
  shape.lineTo(0, 1);
  shape.lineTo(0, 0);
  const geometry = prepareInstanceColorGeometry(new THREE.ShapeGeometry(shape));
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

const createBandMaterial = (color, roughness = 0.92, options = {}) => new THREE.MeshStandardMaterial({
  color,
  roughness,
  metalness: 0.02,
  polygonOffset: options?.polygonOffset === true,
  polygonOffsetFactor: finiteOr(options?.polygonOffsetFactor),
  polygonOffsetUnits: finiteOr(options?.polygonOffsetUnits)
});

export const resolveTrainingTerrainDepthOptions = (region = {}) => {
  const type = typeof region === 'string'
    ? region
    : String(region?.type || 'grass');
  const overlayLayer = type === 'road'
    ? 2
    : (type === 'sand' || type === 'river' ? 1 : 0);
  return {
    polygonOffset: overlayLayer > 0,
    polygonOffsetFactor: overlayLayer > 0 ? -overlayLayer : 0,
    polygonOffsetUnits: overlayLayer > 0 ? -overlayLayer : 0
  };
};

const TRAINING_TERRAIN_EDGE_PROFILES = Object.freeze({
  grass: { width: 24, opacity: 0.16 },
  sand: { width: 46, opacity: 0.34 },
  road: { width: 15, opacity: 0.48 }
});

const resolveTrainingTerrainEdgeProfile = (region = {}) => {
  const type = String(region?.type || 'grass');
  const profile = TRAINING_TERRAIN_EDGE_PROFILES[type];
  if (!profile) return null;
  return {
    width: Math.max(2, Number(region?.edgeFeatherWidth) || profile.width),
    opacity: clamp(Number(region?.edgeFeatherOpacity) || profile.opacity, 0.04, 0.72)
  };
};

const createTrainingTerrainEdgeMaterial = ({ color, opacity, feather, radial, depthOptions = {} } = {}) => (
  new THREE.ShaderMaterial({
    uniforms: {
      terrainColor: { value: new THREE.Color(color) },
      edgeOpacity: { value: opacity },
      edgeFeather: { value: feather },
      radialEdge: { value: radial ? 1 : 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 terrainColor;
      uniform float edgeOpacity;
      uniform float edgeFeather;
      uniform float radialEdge;
      varying vec2 vUv;
      void main() {
        float edgeDistance = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        if (radialEdge > 0.5) {
          edgeDistance = 0.5 - length(vUv - vec2(0.5));
        }
        float alpha = smoothstep(0.0, max(0.0001, edgeFeather), edgeDistance) * edgeOpacity;
        gl_FragColor = vec4(terrainColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: depthOptions?.polygonOffset === true,
    polygonOffsetFactor: Number(depthOptions?.polygonOffsetFactor) || 0,
    polygonOffsetUnits: Number(depthOptions?.polygonOffsetUnits) || 0
  })
);

export const createTrainingTerrainEdgeMesh = (region = {}, color = 0x2b4330, name = 'terrain-transition') => {
  const profile = resolveTrainingTerrainEdgeProfile(region);
  if (!profile) return null;
  const depthOptions = resolveTrainingTerrainDepthOptions(region);
  const shape = String(region?.shape || 'rect');
  const z = (Number(region?.z) || 0) + 0.002;
  if (shape === 'semicircle') {
    const radius = Math.max(1, Number(region?.radius) || Math.min(Number(region?.width) || 1, Number(region?.height) || 1) * 0.5);
    const expandedRadius = radius + profile.width;
    const feather = clamp(profile.width / Math.max(1, expandedRadius * 2), 0.001, 0.45);
    const startAngle = region?.arcDirection === 'down' ? Math.PI : 0;
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(expandedRadius, 56, startAngle, Math.PI),
      createTrainingTerrainEdgeMaterial({
        color,
        opacity: profile.opacity,
        feather,
        radial: true,
        depthOptions
      })
    );
    mesh.name = name;
    mesh.position.set(Number(region?.x) || 0, Number(region?.y) || 0, z);
    return mesh;
  }
  if (shape !== 'rect') return null;
  const width = Math.max(1, Number(region?.width) || 1);
  const height = Math.max(1, Number(region?.height) || 1);
  const expandedWidth = width + (profile.width * 2);
  const expandedHeight = height + (profile.width * 2);
  const feather = clamp(profile.width / Math.max(1, Math.min(expandedWidth, expandedHeight)), 0.001, 0.45);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(expandedWidth, expandedHeight, 1, 1),
    createTrainingTerrainEdgeMaterial({
      color,
      opacity: profile.opacity,
      feather,
      radial: false,
      depthOptions
    })
  );
  mesh.name = name;
  mesh.position.set(Number(region?.x) || 0, Number(region?.y) || 0, z);
  return mesh;
};

const normalizeTrainingPolygonPoints = (points = []) => {
  const normalizedPoints = [];
  (Array.isArray(points) ? points : []).forEach((point) => {
    const nextPoint = {
      x: finiteOr(point?.x),
      y: finiteOr(point?.y)
    };
    const previousPoint = normalizedPoints[normalizedPoints.length - 1];
    if (previousPoint && Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y) <= 0.001) return;
    normalizedPoints.push(nextPoint);
  });
  return normalizedPoints;
};

const interpolateTrainingPolygonPoint = (from = {}, to = {}, progress = 0) => ({
  x: finiteOr(from?.x) + ((finiteOr(to?.x) - finiteOr(from?.x)) * progress),
  y: finiteOr(from?.y) + ((finiteOr(to?.y) - finiteOr(from?.y)) * progress)
});

const resolveTrainingHighlandRamps = (region = {}, points = []) => {
  const explicitRamps = (Array.isArray(region?.ramps) ? region.ramps : [])
    .map((ramp, index) => ({
      id: String(ramp?.id || `ramp-${index + 1}`),
      vertexIndex: Math.max(0, Math.floor(finiteOr(ramp?.vertexIndex, index))),
      points: normalizeTrainingPolygonPoints(ramp?.points)
    }))
    .filter((ramp) => ramp.points.length === 3);
  if (explicitRamps.length >= points.length) return explicitRamps;
  const inset = clamp(finiteOr(region?.rampInset, 0.22), 0.08, 0.36);
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length] || point;
    const previous = points[(index + points.length - 1) % points.length] || point;
    return {
      id: `ramp-${index + 1}`,
      vertexIndex: index,
      points: [
        point,
        interpolateTrainingPolygonPoint(point, next, inset),
        interpolateTrainingPolygonPoint(point, previous, inset)
      ]
    };
  });
};

const resolveTrainingHighlandTopPolygon = (points = [], ramps = []) => {
  if (points.length !== 3 || ramps.length < 3) return points;
  const topPoints = [];
  points.forEach((point, index) => {
    const nextIndex = (index + 1) % points.length;
    const fromRamp = ramps.find((ramp) => ramp.vertexIndex === index) || ramps[index];
    const toRamp = ramps.find((ramp) => ramp.vertexIndex === nextIndex) || ramps[nextIndex];
    const towardNext = fromRamp?.points?.[1];
    const fromNext = toRamp?.points?.[2];
    if (towardNext) topPoints.push(towardNext);
    if (fromNext) topPoints.push(fromNext);
  });
  return normalizeTrainingPolygonPoints(topPoints).length >= 3
    ? normalizeTrainingPolygonPoints(topPoints)
    : points;
};

const createTrainingHighlandRampMesh = (ramp = {}, elevation = 0, color = 0x2b4330) => {
  const points = normalizeTrainingPolygonPoints(ramp?.points);
  if (points.length !== 3 || elevation <= 0) return null;
  const [groundPoint, topRight, topLeft] = points;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    groundPoint.x, groundPoint.y, 0,
    topRight.x, topRight.y, 0,
    topLeft.x, topLeft.y, 0,
    topRight.x, topRight.y, elevation,
    topLeft.x, topLeft.y, elevation
  ], 3));
  geometry.setIndex([
    0, 3, 4,
    0, 2, 1,
    0, 1, 3,
    0, 4, 2,
    1, 2, 4,
    1, 4, 3
  ]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.78),
      roughness: 0.86,
      metalness: 0.03,
      side: THREE.DoubleSide
    })
  );
  mesh.name = `training-highland-ramp-${ramp?.id || 'ramp'}`;
  return mesh;
};

const createTrainingHighlandRailSegment = (start = {}, end = {}, elevation = 0, index = 0) => {
  const deltaX = finiteOr(end?.x) - finiteOr(start?.x);
  const deltaY = finiteOr(end?.y) - finiteOr(start?.y);
  const length = Math.hypot(deltaX, deltaY);
  if (length <= 0.01 || elevation <= 0) return null;
  const railThickness = clamp(elevation * 0.08, 1.4, 5.5);
  const railHeight = Math.max(6, elevation * 0.3);
  const group = new THREE.Group();
  const midpointX = (finiteOr(start?.x) + finiteOr(end?.x)) * 0.5;
  const midpointY = (finiteOr(start?.y) + finiteOr(end?.y)) * 0.5;
  const rotation = Math.atan2(deltaY, deltaX);
  group.name = `training-highland-rail-${index + 1}`;
  [railHeight * 0.52, railHeight].forEach((height, railIndex) => {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(length, railThickness, railThickness),
      new THREE.MeshStandardMaterial({ color: 0x2d343e, roughness: 0.45, metalness: 0.62 })
    );
    rail.name = `${group.name}-bar-${railIndex + 1}`;
    rail.position.set(midpointX, midpointY, elevation + height);
    rail.rotation.z = rotation;
    group.add(rail);
  });
  const postCount = Math.max(2, Math.ceil(length / Math.max(20, elevation * 0.7)) + 1);
  for (let postIndex = 0; postIndex < postCount; postIndex += 1) {
    const progress = postCount <= 1 ? 0.5 : postIndex / (postCount - 1);
    const position = interpolateTrainingPolygonPoint(start, end, progress);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(railThickness, railThickness, railHeight),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.48, metalness: 0.58 })
    );
    post.name = `${group.name}-post-${postIndex + 1}`;
    post.position.set(position.x, position.y, elevation + (railHeight * 0.5));
    group.add(post);
  }
  return group;
};

export const createTrainingHighlandMesh = (region = {}, color = 0x2b4330) => {
  const points = normalizeTrainingPolygonPoints(region?.points);
  const elevation = Math.max(0, finiteOr(region?.elevation));
  if (points.length < 3 || elevation <= 0) return null;
  const ramps = resolveTrainingHighlandRamps(region, points);
  const topPoints = resolveTrainingHighlandTopPolygon(points, ramps);
  const shape = new THREE.Shape();
  shape.moveTo(topPoints[0].x, topPoints[0].y);
  topPoints.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.translate(0, 0, elevation);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, createBandMaterial(color, 0.74));
  mesh.name = `training-highland-${region?.id || 'region'}`;
  mesh.position.z = finiteOr(region?.z);
  mesh.userData.ramps = ramps;
  ramps.forEach((ramp) => {
    const rampMesh = createTrainingHighlandRampMesh(ramp, elevation, color);
    if (rampMesh) mesh.add(rampMesh);
  });
  const railingEdges = Array.isArray(region?.railingEdges) ? region.railingEdges : [0, 1];
  const inset = clamp(finiteOr(region?.rampInset, 0.22), 0.08, 0.36);
  railingEdges.forEach((rawEdge, index) => {
    const edgeIndex = Math.max(0, Math.floor(finiteOr(rawEdge))) % points.length;
    const start = points[edgeIndex];
    const end = points[(edgeIndex + 1) % points.length];
    const rail = createTrainingHighlandRailSegment(
      interpolateTrainingPolygonPoint(start, end, inset),
      interpolateTrainingPolygonPoint(start, end, 1 - inset),
      elevation,
      index
    );
    if (rail) mesh.add(rail);
  });
  return mesh;
};

export const createTrainingDeployRegionHighlightMesh = (region = {}, mapConfig = null) => {
  const points = normalizeTrainingPolygonPoints(region?.polygon);
  if (points.length < 3) return null;
  const team = region?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    position.setZ(index, resolveTrainingMapTerrainElevation(mapConfig, { x, y }) + TRAINING_DEPLOY_REGION_HIGHLIGHT_ELEVATION);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const color = TRAINING_DEPLOY_REGION_HIGHLIGHT_COLORS[team];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false
  }));
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(
      point.x,
      point.y,
      resolveTrainingMapTerrainElevation(mapConfig, point) + TRAINING_DEPLOY_REGION_HIGHLIGHT_ELEVATION + 0.08
    ))),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.96,
      depthWrite: false
    })
  );
  mesh.name = `training-deploy-region-highlight-${region?.id || team}`;
  mesh.userData = {
    team,
    spawnRegionId: String(region?.id || ''),
    isDeployRegionHighlight: true
  };
  mesh.renderOrder = 3;
  outline.name = `${mesh.name}-outline`;
  outline.renderOrder = 4;
  mesh.add(outline);
  return mesh;
};

export const resolveTrainingDeployHighlightTeams = (runtime = null) => {
  if (runtime?.getPhase?.() !== 'deploy') return [];
  const deployGroups = runtime?.getDeployGroups?.() || {};
  return [TEAM_ATTACKER, TEAM_DEFENDER].filter((team) => (
    (Array.isArray(deployGroups?.[team]) ? deployGroups[team] : []).some((group) => (
      group?.placed === false && group?.placementActive === true
    ))
  ));
};

const normalizeTrainingWallPath = (points = []) => {
  const normalizedPoints = [];
  (Array.isArray(points) ? points : []).forEach((point) => {
    const nextPoint = {
      x: finiteOr(Array.isArray(point) ? point[0] : point?.x),
      y: finiteOr(Array.isArray(point) ? point[1] : point?.y)
    };
    const previousPoint = normalizedPoints[normalizedPoints.length - 1];
    if (previousPoint && Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y) <= 0.001) return;
    normalizedPoints.push(nextPoint);
  });
  return normalizedPoints;
};

const normalizeTrainingWallVector = (x = 0, y = 0) => {
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length } : null;
};

export const resolveTrainingWallPathOutline = (points = [], thickness = 24) => {
  const path = normalizeTrainingWallPath(points);
  if (path.length < 2) return [];
  const halfThickness = Math.max(0.5, finiteOr(thickness, 24) * 0.5);
  const leftPoints = [];
  const rightPoints = [];

  path.forEach((point, index) => {
    const previousPoint = path[index - 1] || point;
    const nextPoint = path[index + 1] || point;
    const incomingDirection = index > 0
      ? normalizeTrainingWallVector(point.x - previousPoint.x, point.y - previousPoint.y)
      : null;
    const outgoingDirection = index < path.length - 1
      ? normalizeTrainingWallVector(nextPoint.x - point.x, nextPoint.y - point.y)
      : null;
    const direction = outgoingDirection || incomingDirection;
    if (!direction) return;
    const incomingNormal = incomingDirection
      ? { x: -incomingDirection.y, y: incomingDirection.x }
      : { x: -direction.y, y: direction.x };
    const outgoingNormal = outgoingDirection
      ? { x: -outgoingDirection.y, y: outgoingDirection.x }
      : { x: -direction.y, y: direction.x };
    const miterNormal = normalizeTrainingWallVector(
      incomingNormal.x + outgoingNormal.x,
      incomingNormal.y + outgoingNormal.y
    ) || outgoingNormal;
    const miterAlignment = Math.abs(
      (miterNormal.x * outgoingNormal.x) + (miterNormal.y * outgoingNormal.y)
    );
    const miterLength = clamp(
      halfThickness / Math.max(0.35, miterAlignment),
      halfThickness,
      halfThickness * 2
    );
    const offsetX = miterNormal.x * miterLength;
    const offsetY = miterNormal.y * miterLength;
    leftPoints.push({ x: point.x + offsetX, y: point.y + offsetY });
    rightPoints.push({ x: point.x - offsetX, y: point.y - offsetY });
  });

  return [...leftPoints, ...rightPoints.reverse()];
};

const resolveTrainingWallCollisionThickness = (wall = {}) => {
  const thicknesses = (Array.isArray(wall?.collider?.parts) ? wall.collider.parts : [])
    .map((part) => finiteOr(part?.d))
    .filter((thickness) => thickness > 0)
    .sort((first, second) => first - second);
  if (thicknesses.length > 0) return Math.max(4, thicknesses[Math.floor(thicknesses.length * 0.5)]);
  const fallbackThickness = Math.min(finiteOr(wall?.width), finiteOr(wall?.depth));
  return Math.max(4, fallbackThickness > 0 ? fallbackThickness : 24);
};

const resolveTrainingWallType = (wall = {}) => {
  const requested = String(wall?.wallType || '').trim();
  if (requested === 'thinBarrier' || requested === 'thickWall') return requested;
  if (wall?.geometryKind === 'highWall' || String(wall?.visualKind || '') === 'crescent') return 'thickWall';
  return 'thinBarrier';
};

export const resolveTrainingWallVisualThickness = (wall = {}) => {
  const requestedThickness = finiteOr(wall?.visualThickness);
  if (requestedThickness > 0) return Math.max(4, requestedThickness);
  const collisionThickness = resolveTrainingWallCollisionThickness(wall);
  if (resolveTrainingWallType(wall) !== 'thinBarrier') return collisionThickness;
  return clamp(collisionThickness * 0.26, 10, 28);
};

const resolveTrainingWallOutline = (wall = {}, thickness = 24) => {
  const explicitOutline = normalizeTrainingWallPath(wall?.visualOutline);
  return explicitOutline.length >= 3
    ? explicitOutline
    : resolveTrainingWallPathOutline(wall?.visualPath, thickness);
};

const createTrainingWallExtrusion = ({
  outline = [],
  height = 0,
  bevelSize = 0,
  material = null,
  name = ''
} = {}) => {
  if (outline.length < 3 || height <= 0 || !material) return null;
  const shape = new THREE.Shape();
  shape.moveTo(outline[0].x, outline[0].y);
  outline.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevelSize > 0,
    bevelSegments: 1,
    bevelSize,
    bevelThickness: Math.min(bevelSize, height * 0.08),
    curveSegments: 1
  });
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
};

const createTrainingThinBarrierMesh = (wall = {}, { namePrefix = 'training-ordinary-wall' } = {}) => {
  const thickness = resolveTrainingWallVisualThickness(wall);
  const outline = resolveTrainingWallOutline(wall, thickness);
  if (outline.length < 3) return null;
  const height = Math.max(8, finiteOr(wall?.height, 34));
  const foundationHeight = Math.min(10, Math.max(4, height * 0.1));
  const capHeight = Math.min(12, Math.max(4, height * 0.12));
  const panelHeight = Math.max(8, height - foundationHeight - capHeight);
  const name = `${namePrefix}-${wall?.objectId || 'wall'}`;
  const group = new THREE.Group();
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x758895,
    roughness: 0.56,
    metalness: 0.08,
    emissive: 0x0c141a,
    emissiveIntensity: 0.2
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xaebdc6,
    roughness: 0.42,
    metalness: 0.14,
    emissive: 0x11181d,
    emissiveIntensity: 0.18
  });
  const bevelSize = Math.min(1.8, Math.max(0.6, thickness * 0.08));
  const foundation = createTrainingWallExtrusion({
    outline,
    height: foundationHeight,
    bevelSize: Math.min(bevelSize, 1.1),
    material: frameMaterial,
    name: `${name}-foundation`
  });
  const panel = createTrainingWallExtrusion({
    outline,
    height: panelHeight,
    bevelSize,
    material: panelMaterial,
    name: `${name}-panel`
  });
  const cap = createTrainingWallExtrusion({
    outline,
    height: capHeight,
    bevelSize: Math.min(bevelSize, 1.1),
    material: frameMaterial,
    name: `${name}-cap`
  });
  if (foundation) group.add(foundation);
  if (panel) {
    panel.position.z = foundationHeight;
    group.add(panel);
  }
  if (cap) {
    cap.position.z = foundationHeight + panelHeight;
    group.add(cap);
  }

  const path = normalizeTrainingWallPath(wall?.visualPath);
  const postCount = Math.min(6, path.length);
  if (postCount > 0) {
    const postGeometry = new THREE.BoxGeometry(1, 1, 1);
    const postWidth = Math.max(4, thickness * 0.68);
    for (let index = 0; index < postCount; index += 1) {
      const pathIndex = postCount <= 1
        ? 0
        : Math.round((index / (postCount - 1)) * (path.length - 1));
      const point = path[pathIndex];
      if (!point) continue;
      const post = new THREE.Mesh(postGeometry, frameMaterial);
      post.name = `${name}-post-${index + 1}`;
      post.position.set(point.x, point.y, height * 0.5);
      post.scale.set(postWidth, postWidth, height);
      group.add(post);
    }
  }

  group.name = name;
  group.position.z = Math.max(0.08, finiteOr(wall?.z));
  group.userData.wallType = 'thinBarrier';
  group.userData.visualThickness = thickness;
  group.userData.collisionThickness = resolveTrainingWallCollisionThickness(wall);
  return group;
};

const createTrainingWallMesh = (wall = {}, { namePrefix = 'training-ordinary-wall', forceWallType = '' } = {}) => {
  const wallType = forceWallType || resolveTrainingWallType(wall);
  const thickWall = wallType === 'thickWall';
  if (!thickWall) return createTrainingThinBarrierMesh(wall, { namePrefix });
  const thickness = resolveTrainingWallVisualThickness(wall);
  const outline = resolveTrainingWallOutline(wall, thickness);
  if (outline.length < 3) return null;
  const height = Math.max(8, finiteOr(wall?.height, 34));
  const bevelSize = Math.min(6, Math.max(1.4, thickness * 0.1));
  const mesh = createTrainingWallExtrusion({
    outline,
    height,
    bevelSize,
    material: new THREE.MeshStandardMaterial({
      color: 0x46525c,
      roughness: 0.62,
      metalness: 0.06,
      emissive: 0x080d12,
      emissiveIntensity: 0.16
    }),
    name: `${namePrefix}-${wall?.objectId || 'wall'}`
  });
  if (!mesh) return null;
  mesh.position.z = Math.max(0.08, finiteOr(wall?.z));
  mesh.userData.wallType = wallType;
  return mesh;
};

export const createTrainingOrdinaryWallMesh = (wall = {}) => {
  const wallType = resolveTrainingWallType(wall);
  return createTrainingWallMesh(wall, {
    namePrefix: wallType === 'thickWall' ? 'training-thick-wall' : 'training-ordinary-wall'
  });
};

export const createTrainingHighWallMesh = (wall = {}) => createTrainingWallMesh(wall, {
  namePrefix: 'training-high-wall',
  forceWallType: 'thickWall'
});

const isTrainingMapStaticPlaceholderCategory = (category = '') => (
  category === 'tower' || category === 'neutralCamp'
);

export const isTrainingMapStaticPlaceholder = (object = {}) => (
  object?.mapStatic === true
  && isTrainingMapStaticPlaceholderCategory(String(object?.category || object?.objectiveType || ''))
);

const createTrainingPlaceholderMaterial = (color, options = {}) => new THREE.MeshStandardMaterial({
  color,
  roughness: finiteOr(options?.roughness, 0.72),
  metalness: finiteOr(options?.metalness, 0.08),
  emissive: options?.emissive || 0x000000,
  emissiveIntensity: finiteOr(options?.emissiveIntensity, 0)
});

const createTrainingVerticalCylinder = (radiusTop, radiusBottom, height, material, radialSegments = 8) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    material
  );
  mesh.geometry.rotateX(Math.PI / 2);
  return mesh;
};

const createTrainingVerticalCone = (radius, height, material, radialSegments = 8) => {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, radialSegments),
    material
  );
  mesh.geometry.rotateX(Math.PI / 2);
  return mesh;
};

const resolveTrainingPlaceholderDimensions = (object = {}) => ({
  width: Math.max(8, finiteOr(object?.width, 58)),
  depth: Math.max(8, finiteOr(object?.depth, 58)),
  height: Math.max(12, finiteOr(object?.height, 64))
});

const createTrainingNeutralCampSentry = ({
  name = 'training-neutral-sentry',
  category = 'melee',
  x = 0,
  y = 0,
  z = 0,
  scale = 1
} = {}) => {
  const sentry = new THREE.Group();
  sentry.name = name;
  sentry.userData.isNeutralCampSentry = true;
  sentry.position.set(x, y, z);
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.78, 10, 8),
    createTrainingPlaceholderMaterial(0xf4c542, {
      roughness: 0.5,
      metalness: 0.12,
      emissive: 0xf4c542,
      emissiveIntensity: 0.06
    })
  );
  body.name = `${name}-body`;
  body.scale.set(scale * 0.9, scale * 0.82, scale);
  body.position.z = scale * 0.7;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 10, 8),
    createTrainingPlaceholderMaterial(0xffe6a3, { roughness: 0.58, metalness: 0.04 })
  );
  head.name = `${name}-head`;
  head.scale.setScalar(scale);
  head.position.z = scale * 1.48;
  sentry.add(body, head);

  if (category === 'ranged') {
    const bow = new THREE.Mesh(
      new THREE.TorusGeometry(scale * 0.5, scale * 0.065, 5, 12, Math.PI * 1.5),
      createTrainingPlaceholderMaterial(0x8b5a2b, { roughness: 0.68, metalness: 0.04 })
    );
    bow.name = `${name}-bow`;
    bow.rotation.x = Math.PI * 0.5;
    bow.position.set(scale * 0.62, 0, scale * 0.92);
    sentry.add(bow);
  } else if (category === 'support') {
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(scale * 0.54, scale * 0.07, 6, 14),
      createTrainingPlaceholderMaterial(0xffd766, {
        roughness: 0.3,
        metalness: 0.38,
        emissive: 0xffc542,
        emissiveIntensity: 0.22
      })
    );
    halo.name = `${name}-halo`;
    halo.position.z = scale * 2.02;
    sentry.add(halo);
  } else {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(scale * 1.12, scale * 0.12, scale * 0.14),
      createTrainingPlaceholderMaterial(0xd9e1e8, { roughness: 0.28, metalness: 0.72 })
    );
    blade.name = `${name}-blade`;
    blade.rotation.z = -Math.PI * 0.3;
    blade.position.set(scale * 0.62, 0, scale * 0.88);
    sentry.add(blade);
  }

  return sentry;
};

const createTrainingNeutralPatrolPreviewArrow = ({
  name = 'training-neutral-patrol-preview',
  directionRad = 0,
  length = 24,
  elevation = 1
} = {}) => {
  const direction = new THREE.Vector3(Math.cos(directionRad), Math.sin(directionRad), 0);
  if (direction.lengthSq() <= 1e-6) return null;
  const arrowLength = Math.max(8, finiteOr(length, 24));
  const headLength = Math.min(Math.max(5, arrowLength * 0.24), arrowLength * 0.46);
  const headWidth = Math.min(Math.max(3, arrowLength * 0.16), arrowLength * 0.32);
  const arrow = new THREE.ArrowHelper(
    direction.normalize(),
    new THREE.Vector3(0, 0, Math.max(0.4, finiteOr(elevation, 1))),
    arrowLength,
    0x67e8f9,
    headLength,
    headWidth
  );
  arrow.name = name;
  arrow.userData.isNeutralPatrolPreview = true;
  arrow.line.material.depthTest = false;
  arrow.line.material.depthWrite = false;
  arrow.line.renderOrder = 5;
  arrow.cone.material.depthTest = false;
  arrow.cone.material.depthWrite = false;
  arrow.cone.renderOrder = 5;
  return arrow;
};

export const createTrainingMapStaticPlaceholderMesh = (object = {}, terrainElevation = 0) => {
  if (!isTrainingMapStaticPlaceholder(object)) return null;
  const category = String(object?.category || object?.objectiveType || '');
  const { width, depth, height } = resolveTrainingPlaceholderDimensions(object);
  const group = new THREE.Group();
  const objectId = String(object?.objectId || object?.id || category || 'placeholder');
  group.name = `training-map-placeholder-${objectId}`;
  group.position.set(
    finiteOr(object?.x),
    finiteOr(object?.y),
    Math.max(0, finiteOr(object?.z)) + Math.max(0, finiteOr(terrainElevation))
  );
  group.userData.mapObjectId = objectId;
  group.userData.category = category;
  group.userData.neutralCampId = String(object?.neutralCampId || '');
  group.userData.maxHp = Math.max(1, finiteOr(object?.maxHp, finiteOr(object?.hp, 1)));
  group.userData.attackRange = Math.max(0, finiteOr(object?.attackRange));

  if (category === 'tower') {
    const team = object?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const primaryColor = team === TEAM_DEFENDER ? 0x16dfe8 : 0xef2020;
    const darkColor = team === TEAM_DEFENDER ? 0x0a4a58 : 0x6b151b;
    const radius = Math.max(7, Math.min(width, depth) * 0.5);
    const baseHeight = Math.max(7, height * 0.17);
    const bodyHeight = Math.max(12, height * 0.58);
    const capHeight = Math.max(8, height - baseHeight - bodyHeight);
    const base = createTrainingVerticalCylinder(
      radius * 0.9,
      radius,
      baseHeight,
      createTrainingPlaceholderMaterial(darkColor, { roughness: 0.68, metalness: 0.16 })
    );
    base.name = `${group.name}-octagon-base`;
    base.position.z = baseHeight * 0.5;
    const body = createTrainingVerticalCylinder(
      radius * 0.58,
      radius * 0.72,
      bodyHeight,
      createTrainingPlaceholderMaterial(primaryColor, { roughness: 0.48, metalness: 0.22 })
    );
    body.name = `${group.name}-octagon-body`;
    body.position.z = baseHeight + (bodyHeight * 0.5);
    const cap = createTrainingVerticalCone(
      radius * 0.62,
      capHeight,
      createTrainingPlaceholderMaterial(primaryColor, {
        roughness: 0.4,
        metalness: 0.28,
        emissive: primaryColor,
        emissiveIntensity: 0.08
      })
    );
    cap.name = `${group.name}-octagon-cap`;
    cap.position.z = baseHeight + bodyHeight + (capHeight * 0.5);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.98, radius * 1.1, 8),
      new THREE.MeshBasicMaterial({
        color: primaryColor,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.name = `${group.name}-range-marker`;
    ring.position.z = 0.16;
    group.add(base, body, cap, ring);
    const attackRange = group.userData.attackRange;
    const rangeWidth = Math.max(1.2, Math.min(5, attackRange * 0.014));
    const innerRadius = Math.max(radius * 1.12, attackRange - rangeWidth);
    if (attackRange > innerRadius + 0.5) {
      const attackRangeMarker = new THREE.Mesh(
        new THREE.RingGeometry(innerRadius, attackRange, 64),
        new THREE.MeshBasicMaterial({
          color: primaryColor,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      attackRangeMarker.name = `${group.name}-attack-range`;
      attackRangeMarker.position.z = 0.12;
      attackRangeMarker.visible = false;
      group.add(attackRangeMarker);
    }
    return group;
  }

  const radius = Math.max(8, Math.min(width, depth) * 0.5);
  const poleHeight = Math.max(12, height * 0.66);
  const flagHeight = Math.max(7, poleHeight * 0.32);
  const campGold = 0xf4c542;
  const campStone = 0x86704a;
  const pole = createTrainingVerticalCylinder(
    Math.max(0.7, radius * 0.025),
    Math.max(0.9, radius * 0.035),
    poleHeight,
    createTrainingPlaceholderMaterial(0x3f3422, { roughness: 0.48, metalness: 0.32 }),
    8
  );
  pole.name = `${group.name}-neutral-flag-pole`;
  pole.position.z = poleHeight * 0.5;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.92, Math.max(0.42, radius * 0.025), flagHeight),
    createTrainingPlaceholderMaterial(campGold, {
      roughness: 0.36,
      metalness: 0.18,
      emissive: campGold,
      emissiveIntensity: 0.12
    })
  );
  banner.name = `${group.name}-neutral-banner`;
  banner.position.set(radius * 0.42, 0, poleHeight * 0.72);
  const campfire = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(1.6, radius * 0.09), 10, 8),
    createTrainingPlaceholderMaterial(0xffbf4d, {
      roughness: 0.3,
      metalness: 0,
      emissive: 0xff9d20,
      emissiveIntensity: 0.3
    })
  );
  campfire.name = `${group.name}-campfire`;
  campfire.position.z = Math.max(1.3, radius * 0.08);
  const stones = Array.from({ length: 3 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 3;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(Math.max(1.8, radius * 0.13), 0),
      createTrainingPlaceholderMaterial(campStone, { roughness: 0.92, metalness: 0.02 })
    );
    stone.name = `${group.name}-camp-stone-${index + 1}`;
    stone.position.set(
      Math.cos(angle) * radius * 0.58,
      Math.sin(angle) * radius * 0.58,
      Math.max(1.2, radius * 0.08)
    );
    return stone;
  });
  const neutralCategories = Array.from(new Set(
    (Array.isArray(object?.neutralComposition) ? object.neutralComposition : [
      { unitCategory: 'melee' },
      { unitCategory: 'ranged' }
    ])
      .map((entry) => String(entry?.unitCategory || '').trim().toLowerCase())
      .filter((category) => category === 'melee' || category === 'ranged' || category === 'support')
  )).slice(0, 3);
  const sentryScale = clamp(radius * 0.045, 1.3, 2.4);
  const neutralFormationFacingRad = finiteOr(object?.neutralFormationFacingRad);
  const sentries = neutralCategories.map((category, index) => {
    const angle = neutralFormationFacingRad
      + (Math.PI * 2 * index) / Math.max(1, neutralCategories.length)
      + (Math.PI / 5);
    return createTrainingNeutralCampSentry({
      name: `${group.name}-neutral-sentry-${category}`,
      category,
      x: Math.cos(angle) * radius * 0.48,
      y: Math.sin(angle) * radius * 0.48,
      z: 0,
      scale: sentryScale
    });
  });
  const patrolPreview = object?.neutralPatrolPreview === true
    ? createTrainingNeutralPatrolPreviewArrow({
      name: `${group.name}-neutral-patrol-preview`,
      directionRad: finiteOr(object?.neutralPatrolDirectionRad, neutralFormationFacingRad),
      length: finiteOr(object?.neutralPatrolPreviewLength, radius * 1.2),
      elevation: Math.max(1.2, radius * 0.12)
    })
    : null;
  group.add(pole, banner, campfire, ...stones, ...sentries);
  if (patrolPreview) group.add(patrolPreview);
  return group;
};

export const applyTrainingMapStaticPlaceholderState = (placeholder = null, building = null) => {
  if (!placeholder) return false;
  const maxHp = Math.max(1, finiteOr(building?.maxHp, finiteOr(placeholder?.userData?.maxHp, 1)));
  const hp = Math.max(0, finiteOr(building?.hp, maxHp));
  const destroyed = building?.destroyed === true || hp <= 0;
  placeholder.visible = !destroyed;
  placeholder.userData.hpRatio = clamp(hp / maxHp, 0, 1);
  return placeholder.visible;
};

const createGroundLabelSprite = (text = '', color = '#f8fafc', scale = 1) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '900 56px "Microsoft YaHei", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 10;
  context.strokeStyle = 'rgba(2, 6, 23, 0.76)';
  context.strokeText(String(text || ''), canvas.width * 0.5, canvas.height * 0.5);
  context.fillStyle = color;
  context.fillText(String(text || ''), canvas.width * 0.5, canvas.height * 0.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true
  }));
  sprite.scale.set(150 * scale, 38 * scale, 1);
  return sprite;
};

const createGroundDirectionArrow = (direction = 1, color = 0xffffff) => {
  const shape = new THREE.Shape();
  const sign = direction >= 0 ? 1 : -1;
  shape.moveTo(-24 * sign, -11);
  shape.lineTo(8 * sign, -11);
  shape.lineTo(8 * sign, -21);
  shape.lineTo(30 * sign, 0);
  shape.lineTo(8 * sign, 21);
  shape.lineTo(8 * sign, 11);
  shape.lineTo(-24 * sign, 11);
  shape.lineTo(-24 * sign, -11);
  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  return new THREE.Mesh(geometry, material);
};

const makeInstancedMesh = (geometry, material, capacity) => {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
};

const createTrainingHoverFootprintMaterial = (opacity) => new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  transparent: true,
  opacity,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: false,
  toneMapped: false,
  fog: false
});

export const TRAINING_FLAG_CANVAS_THEME = {
  attacker: {
    accent: '#f87171',
    soft: 'rgba(153, 27, 27, 0.84)'
  },
  defender: {
    accent: '#7dd3fc',
    soft: 'rgba(14, 116, 144, 0.82)'
  },
  neutral: {
    accent: '#fde68a',
    soft: 'rgba(146, 99, 20, 0.84)'
  }
};

export const resolveTrainingFlagCanvasTheme = (team = TEAM_ATTACKER) => (
  TRAINING_FLAG_CANVAS_THEME[team] || TRAINING_FLAG_CANVAS_THEME.attacker
);

const createTrainingFlagCanvas = () => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = TRAINING_FLAG_CANVAS_WIDTH;
  canvas.height = TRAINING_FLAG_CANVAS_HEIGHT;
  return canvas;
};

const traceTrainingFlagSilhouette = (context, width, height) => {
  context.beginPath();
  context.moveTo(TRAINING_FLAG_CANVAS_HORIZONTAL_INSET, TRAINING_FLAG_CANVAS_TOP_INSET);
  context.lineTo(width - TRAINING_FLAG_CANVAS_HORIZONTAL_INSET, TRAINING_FLAG_CANVAS_TOP_INSET);
  context.lineTo(width - TRAINING_FLAG_CANVAS_NOTCH, height * 0.5);
  context.lineTo(
    width - TRAINING_FLAG_CANVAS_HORIZONTAL_INSET,
    height - TRAINING_FLAG_CANVAS_BOTTOM_INSET
  );
  context.lineTo(TRAINING_FLAG_CANVAS_HORIZONTAL_INSET, height - TRAINING_FLAG_CANVAS_BOTTOM_INSET);
  context.closePath();
};

const drawTrainingFlagCanvas = (canvas, anchor = {}) => {
  const context = canvas?.getContext?.('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const theme = resolveTrainingFlagCanvasTheme(anchor.team);
  const showSkillPoints = resolveTrainingFlagShowsSkillPoints(anchor);
  context.clearRect(0, 0, width, height);
  context.save();
  context.shadowColor = anchor.flagHovered ? theme.accent : 'rgba(2, 6, 23, 0.72)';
  context.shadowBlur = anchor.flagHovered ? 30 : 10;
  context.shadowOffsetY = 4;
  traceTrainingFlagSilhouette(context, width, height);
  const background = context.createLinearGradient(0, 0, width, 0);
  background.addColorStop(0, theme.soft);
  background.addColorStop(0.36, 'rgba(5, 12, 21, 0.96)');
  background.addColorStop(1, 'rgba(5, 12, 21, 0.88)');
  context.fillStyle = background;
  context.fill();
  context.restore();

  context.save();
  traceTrainingFlagSilhouette(context, width, height);
  context.strokeStyle = anchor.flagHovered ? theme.accent : (anchor.selected ? '#fde68a' : theme.accent);
  context.lineWidth = anchor.flagHovered ? 9 : 4;
  context.globalAlpha = anchor.flagHovered ? 1 : 0.88;
  context.stroke();
  context.restore();

  context.fillStyle = theme.accent;
  context.globalAlpha = 0.78;
  context.fillRect(
    16,
    TRAINING_FLAG_CANVAS_TOP_INSET + 4,
    10,
    height - TRAINING_FLAG_CANVAS_TOP_INSET - TRAINING_FLAG_CANVAS_BOTTOM_INSET - 8
  );
  context.globalAlpha = 1;
  context.textBaseline = 'middle';
  context.font = '800 28px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#cbd5e1';
  context.fillText('兵', 44, 67);
  context.font = '900 43px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#f8fafc';
  const remainText = String(Math.max(0, Math.floor(Number(anchor.remain) || 0)));
  context.fillText(remainText, 82, 67);
  const remainWidth = context.measureText(remainText).width;
  context.font = '700 24px "JetBrains Mono", ui-monospace, monospace';
  context.fillStyle = '#94a3b8';
  const startText = `/${Math.max(1, Math.floor(Number(anchor.startCount) || 1))}`;
  const startX = 88 + remainWidth;
  context.fillText(startText, startX, 67);
  if (showSkillPoints) {
    const startWidth = context.measureText(startText).width;
    const pointSeparatorX = Math.min(width - 132, startX + startWidth + 22);
    context.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(pointSeparatorX, 34);
    context.lineTo(pointSeparatorX, 96);
    context.stroke();
    context.font = '800 27px "JetBrains Mono", ui-monospace, monospace';
    context.fillStyle = '#cbd5e1';
    context.fillText('点', pointSeparatorX + 18, 67);
    context.font = '900 39px "JetBrains Mono", ui-monospace, monospace';
    context.fillStyle = '#fde68a';
    context.fillText(String(Math.max(0, Math.floor(Number(anchor.skillPoints) || 0))), pointSeparatorX + 55, 67);
  }

  const barX = 44;
  const barY = 116;
  const barWidth = width - barX - 84;
  const barHeight = 24;
  context.fillStyle = 'rgba(2, 6, 23, 0.84)';
  context.fillRect(barX, barY, barWidth, barHeight);
  context.fillStyle = Number(anchor.ratio) <= 0.25 ? '#fb7185' : (Number(anchor.ratio) <= 0.5 ? '#fbbf24' : '#4ade80');
  const healthWidth = (barWidth - 6) * clamp(Number(anchor.ratio) || 0, 0, 1);
  if (healthWidth > 0) context.fillRect(barX + 3, barY + 3, healthWidth, barHeight - 6);
  context.strokeStyle = 'rgba(226, 232, 240, 0.38)';
  context.lineWidth = 2;
  context.strokeRect(barX, barY, barWidth, barHeight);
};

const trainingFlagTextureSignature = (anchor = {}) => [
  anchor.team,
  anchor.remain,
  anchor.startCount,
  Number(anchor.ratio || 0).toFixed(3),
  resolveTrainingFlagShowsSkillPoints(anchor) ? anchor.skillPoints : 'hidden',
  anchor.selected ? 'selected' : 'normal',
  anchor.flagHovered ? 'hovered' : 'normal'
].join(':');

const getSnapshotCount = (bucket) => Math.max(0, Math.floor(Number(bucket?.count) || 0));

export default class TrainingThreeRenderPipeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false
    });
    this.renderer.setClearColor(0x07111d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.sortObjects = true;
    this.pixelRatio = Math.min(TRAINING_MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.viewportCssHeight = 1;
    this.disposed = false;
    this.lastSnapshotVersion = null;
    this.lastDynamicSnapshotVersion = null;
    this.hasSkillVisualFocus = false;
    this.hasActiveSkillOverlays = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 16, 8000);
    this.camera.up.set(0, 0, 1);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;

    this.groundGroup = new THREE.Group();
    this.groundGroup.name = 'training-three-ground';
    this.scene.add(this.groundGroup);
    this.mapStaticPlaceholderGroup = null;
    this.deployRegionHighlightGroup = null;

    this.skillPreviewGroup = new THREE.Group();
    this.skillPreviewGroup.name = 'training-three-skill-preview';
    this.skillPreviewGroup.renderOrder = 6;
    this.scene.add(this.skillPreviewGroup);

    this.meleeAlertGroup = new THREE.Group();
    this.meleeAlertGroup.name = 'training-three-melee-alert';
    this.meleeAlertGroup.renderOrder = 4;
    this.scene.add(this.meleeAlertGroup);

    this.skillMarkerGroup = new THREE.Group();
    this.skillMarkerGroup.name = 'training-three-skill-markers';
    this.skillMarkerGroup.renderOrder = 9;
    this.scene.add(this.skillMarkerGroup);

    this.unitGroup = new THREE.Group();
    this.unitGroup.name = 'training-three-units';
    this.scene.add(this.unitGroup);

    this.buildingGroup = new THREE.Group();
    this.buildingGroup.name = 'training-three-buildings';
    this.scene.add(this.buildingGroup);

    this.projectileGroup = new THREE.Group();
    this.projectileGroup.name = 'training-three-projectiles';
    this.scene.add(this.projectileGroup);

    this.effectGroup = new THREE.Group();
    this.effectGroup.name = 'training-three-effects';
    this.scene.add(this.effectGroup);

    this.scene.add(new THREE.AmbientLight(0x8ca4c3, 1.45));
    const keyLight = new THREE.DirectionalLight(0xfff2d2, 2.2);
    keyLight.position.set(-340, -520, 840);
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x88c7ff, 0.72);
    rimLight.position.set(520, 240, 420);
    this.scene.add(rimLight);

    this.chibiUnitRenderer = new TrainingChibiUnitRenderer(this.unitGroup);

    this.unitGeometry = createUnitGeometry();
    this.unitMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      fog: false
    });
    this.unitMesh = null;
    this.unitCapacity = 0;

    this.selectedRingGeometry = new THREE.RingGeometry(0.72, 1.0, 40);
    this.selectedRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xf4c542,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false
    });
    this.selectedRingMesh = null;
    this.selectedRingCapacity = 0;

    this.hoverFootprintGeometry = prepareInstanceColorGeometry(new THREE.RingGeometry(0.78, 1, 40));
    this.hoverFootprintOuterMaterial = createTrainingHoverFootprintMaterial(0.18);
    this.hoverFootprintInnerMaterial = createTrainingHoverFootprintMaterial(0.32);
    this.hoverFootprintOuterMesh = null;
    this.hoverFootprintInnerMesh = null;
    this.hoverFootprintCapacity = 0;

    this.skillPreviewRangeGeometry = new THREE.RingGeometry(0.965, 1, 96);
    this.skillPreviewRangeMaterial = new THREE.MeshBasicMaterial({
      color: SKILL_PREVIEW_RANGE_COLOR,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewRangeMesh = new THREE.Mesh(
      this.skillPreviewRangeGeometry,
      this.skillPreviewRangeMaterial
    );
    this.skillPreviewRangeMesh.renderOrder = 6;
    this.skillPreviewGroup.add(this.skillPreviewRangeMesh);

    this.skillPreviewAoeGeometry = new THREE.CircleGeometry(1, 64);
    this.skillPreviewAoeMaterial = new THREE.MeshBasicMaterial({
      color: SKILL_PREVIEW_TARGET_COLOR,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewAoeMesh = new THREE.Mesh(this.skillPreviewAoeGeometry, this.skillPreviewAoeMaterial);
    this.skillPreviewAoeMesh.renderOrder = 6;
    this.skillPreviewGroup.add(this.skillPreviewAoeMesh);

    this.skillPreviewAoeRingGeometry = new THREE.RingGeometry(0.965, 1, 96);
    this.skillPreviewAoeRingMaterial = new THREE.MeshBasicMaterial({
      color: SKILL_PREVIEW_TARGET_COLOR,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewAoeRingMesh = new THREE.Mesh(
      this.skillPreviewAoeRingGeometry,
      this.skillPreviewAoeRingMaterial
    );
    this.skillPreviewAoeRingMesh.renderOrder = 7;
    this.skillPreviewGroup.add(this.skillPreviewAoeRingMesh);

    this.skillPreviewOriginGeometry = new THREE.RingGeometry(0.82, 1, 48);
    this.skillPreviewOriginMaterial = new THREE.MeshBasicMaterial({
      color: SKILL_PREVIEW_ARROW_COLOR,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewOriginMesh = new THREE.Mesh(
      this.skillPreviewOriginGeometry,
      this.skillPreviewOriginMaterial
    );
    this.skillPreviewOriginMesh.renderOrder = 7;
    this.skillPreviewGroup.add(this.skillPreviewOriginMesh);

    this.skillPreviewConeGeometry = new THREE.BufferGeometry();
    this.skillPreviewConeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(SKILL_PREVIEW_CONE_SEGMENTS * 9), 3)
    );
    this.skillPreviewConeMaterial = new THREE.MeshBasicMaterial({
      color: SKILL_PREVIEW_RANGE_COLOR,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewConeMesh = new THREE.Mesh(this.skillPreviewConeGeometry, this.skillPreviewConeMaterial);
    this.skillPreviewConeMesh.renderOrder = 5;
    this.skillPreviewGroup.add(this.skillPreviewConeMesh);

    this.skillPreviewLineGeometry = new THREE.BufferGeometry();
    this.skillPreviewLineGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(6), 3)
    );
    this.skillPreviewLineMaterial = new THREE.LineBasicMaterial({
      color: SKILL_PREVIEW_TARGET_COLOR,
      transparent: true,
      opacity: 0.62,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewLineMesh = new THREE.Line(this.skillPreviewLineGeometry, this.skillPreviewLineMaterial);
    this.skillPreviewLineMesh.renderOrder = 7;
    this.skillPreviewGroup.add(this.skillPreviewLineMesh);

    this.skillPreviewArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      SKILL_PREVIEW_ARROW_COLOR,
      12,
      6
    );
    this.skillPreviewArrow.renderOrder = 8;
    this.skillPreviewArrow.line.material.transparent = true;
    this.skillPreviewArrow.line.material.opacity = 0.96;
    this.skillPreviewArrow.line.material.depthTest = true;
    this.skillPreviewArrow.line.material.depthWrite = false;
    this.skillPreviewArrow.cone.material.transparent = true;
    this.skillPreviewArrow.cone.material.opacity = 0.96;
    this.skillPreviewArrow.cone.material.depthTest = true;
    this.skillPreviewArrow.cone.material.depthWrite = false;
    this.skillPreviewGroup.add(this.skillPreviewArrow);

    this.skillPreviewTargetRingGeometry = new THREE.RingGeometry(0.88, 1.03, 40);
    this.skillPreviewTargetRingMaterial = new THREE.MeshBasicMaterial({
      color: SKILL_PREVIEW_TARGET_COLOR,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewTargetRingMesh = null;
    this.skillPreviewTargetRingCapacity = 0;

    this.skillPreviewTargetDiscGeometry = new THREE.CircleGeometry(0.88, 32);
    this.skillPreviewTargetDiscMaterial = new THREE.MeshBasicMaterial({
      color: SKILL_PREVIEW_TARGET_COLOR,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.skillPreviewTargetDiscMesh = null;
    this.skillPreviewTargetDiscCapacity = 0;
    this.skillPreviewGroup.visible = false;

    this.meleeAlertGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.meleeAlertMaterial = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.meleeAlertMesh = null;
    this.meleeAlertCapacity = 0;

    this.skillMarkerMaterials = {};
    ['prepare', 'active'].forEach((phase) => {
      Object.keys(SKILL_MARKER_COLORS).forEach((category) => {
        const canvas = createTrainingSkillMarkerCanvas(category, phase);
        const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
        if (texture) {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
        }
        this.skillMarkerMaterials[`${phase}:${category}`] = new THREE.SpriteMaterial({
          map: texture,
          color: 0xffffff,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          sizeAttenuation: true
        });
      });
    });
    this.skillMarkerPool = [];

    this.directionArcGeometry = createTrainingDirectionArcGeometry([]);
    this.directionArcMaterial = createTrainingDirectionArcMaterial();
    this.worldFlagPoleGeometry = new THREE.CylinderGeometry(0.32, 0.42, 1, 10);
    this.worldFlagPoleGeometry.rotateX(Math.PI / 2);
    this.worldFlagPoleGeometry.translate(0, 0, 0.5);
    this.worldFlagPoleMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8c7d9,
      roughness: 0.3,
      metalness: 0.68
    });
    this.worldFlagClothGeometry = createTrainingFlagClothGeometry();
    this.worldFlagFinialGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.worldFlagFinialMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5d481,
      roughness: 0.26,
      metalness: 0.72
    });
    this.directionArcMesh = new THREE.Mesh(this.directionArcGeometry, this.directionArcMaterial);
    this.directionArcMesh.frustumCulled = false;
    this.directionArcMesh.renderOrder = 3;
    this.unitGroup.add(this.directionArcMesh);
    this.worldFlagPoleMesh = null;
    this.worldFlagFinialMesh = null;
    this.worldFlagClothPool = [];
    this.worldFlagHitRects = [];
    this.directionMarkerCapacity = 0;

    this.buildingGeometry = prepareInstanceColorGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02
    });
    this.buildingMesh = null;
    this.buildingCapacity = 0;

    this.projectileGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.effectGeometry = new THREE.SphereGeometry(1, 18, 10);
    this.projectileMaterials = {
      attacker: new THREE.MeshBasicMaterial({ color: 0xff8a8a }),
      defender: new THREE.MeshBasicMaterial({ color: 0x8bd9ff }),
      neutral: new THREE.MeshBasicMaterial({ color: 0xf8d66d }),
      shell: new THREE.MeshBasicMaterial({ color: 0xffc267 })
    };
    this.effectMaterials = {
      hit: new THREE.MeshBasicMaterial({ color: 0xfff0b5, transparent: true, opacity: 0.62, depthWrite: false }),
      explosion: new THREE.MeshBasicMaterial({ color: 0xff9d42, transparent: true, opacity: 0.5, depthWrite: false }),
      aura: new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.38, depthWrite: false }),
      debuffAura: new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.42, depthWrite: false }),
      castPulse: new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.44, depthWrite: false }),
      dust: new THREE.MeshBasicMaterial({ color: 0xc9ab75, transparent: true, opacity: 0.34, depthWrite: false }),
      smoke: new THREE.MeshBasicMaterial({ color: 0xa8b0ba, transparent: true, opacity: 0.26, depthWrite: false })
    };
    this.projectilePool = [];
    this.effectPool = [];
    this.groundKey = '';
    this.groundDebugEnabled = null;
    this.gridVisible = true;
  }

  prepareFrame() {
    const canvas = this.canvas;
    if (this.disposed || !canvas) return { width: 0, height: 0 };
    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.parentElement?.clientWidth || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.parentElement?.clientHeight || 1));
    this.viewportCssHeight = height;
    const needResize = canvas.width !== Math.floor(width * this.pixelRatio)
      || canvas.height !== Math.floor(height * this.pixelRatio);
    if (needResize) {
      this.renderer.setSize(width, height, false);
    }
    return { width: canvas.width, height: canvas.height };
  }

  updateCamera(cameraState) {
    if (!cameraState) return;
    this.camera.near = Math.max(1, Number(cameraState.nearPlane) || this.camera.near);
    this.camera.far = Math.max(this.camera.near + 1, Number(cameraState.farPlane) || this.camera.far);
    this.camera.projectionMatrix.fromArray(cameraState.projection || []);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.matrixWorldInverse.fromArray(cameraState.viewWorld || cameraState.view || []);
    this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
    this.camera.matrix.copy(this.camera.matrixWorld);
    this.camera.position.setFromMatrixPosition(this.camera.matrixWorld);
    this.camera.matrixWorldNeedsUpdate = false;
  }

  setGridVisible(visible = true) {
    const nextVisible = visible !== false;
    if (this.gridVisible === nextVisible) return;
    this.gridVisible = nextVisible;
    ['minor-grid', 'major-grid'].forEach((name) => {
      const lines = this.groundGroup.getObjectByName(name);
      if (lines) lines.visible = nextVisible;
    });
  }

  updateTrainingMapStaticPlaceholderStates(runtime = null) {
    const placeholderGroup = this.mapStaticPlaceholderGroup;
    if (!placeholderGroup) return;
    const hideInDeploy = !runtime?.intelVisible && (!runtime?.sim || runtime?.phase === 'deploy');
    if (hideInDeploy) {
      placeholderGroup.children.forEach((placeholder) => {
        placeholder.visible = false;
      });
      return;
    }
    const buildings = Array.isArray(runtime?.sim?.buildings)
      ? runtime.sim.buildings
      : (Array.isArray(runtime?.initialBuildings) ? runtime.initialBuildings : []);
    const buildingsById = new Map(
      buildings
        .filter((building) => building?.id)
        .map((building) => [String(building.id), building])
    );
    const objectivesBySourceId = new Map(
      (Array.isArray(runtime?.sim?.trainingObjectives) ? runtime.sim.trainingObjectives : [])
        .filter((objective) => objective?.sourceObjectId)
        .map((objective) => [String(objective.sourceObjectId), objective])
    );
    const activeNeutralCampIds = new Set(
      (Array.isArray(runtime?.sim?.squads) ? runtime.sim.squads : [])
        .filter((squad) => squad?.team === TEAM_NEUTRAL && (Number(squad?.remain) || 0) > 0)
        .map((squad) => String(squad?.neutralCampId || ''))
        .filter(Boolean)
    );
    const phase = runtime?.getPhase?.() || runtime?.phase || 'deploy';
    const showNeutralPatrolPreview = phase === 'deploy';
    placeholderGroup.children.forEach((placeholder) => {
      const objectId = String(placeholder?.userData?.mapObjectId || '');
      const visible = applyTrainingMapStaticPlaceholderState(placeholder, buildingsById.get(objectId) || null);
      const hasLiveNeutralCamp = activeNeutralCampIds.has(String(placeholder?.userData?.neutralCampId || ''));
      const isNeutralCampPlaceholder = placeholder?.userData?.category === 'neutralCamp';
      placeholder.visible = visible && !(isNeutralCampPlaceholder && phase !== 'deploy');
      placeholder.children.forEach((child) => {
        if (child?.userData?.isNeutralCampSentry === true) child.visible = !hasLiveNeutralCamp;
        if (child?.userData?.isNeutralPatrolPreview === true) child.visible = placeholder.visible && showNeutralPatrolPreview;
      });
      const attackRangeMarker = placeholder.getObjectByName(`${placeholder.name}-attack-range`);
      if (attackRangeMarker) {
        attackRangeMarker.visible = placeholder.visible && !!objectivesBySourceId.get(objectId)?.lockedSquadId;
      }
    });
  }

  updateDeployRegionHighlights(runtime = null) {
    const highlightGroup = this.deployRegionHighlightGroup;
    if (!highlightGroup) return;
    const activeTeams = new Set(resolveTrainingDeployHighlightTeams(runtime));
    highlightGroup.visible = activeTeams.size > 0;
    highlightGroup.children.forEach((mesh) => {
      mesh.visible = activeTeams.has(mesh?.userData?.team);
    });
  }

  updateGround(runtime, { debugEnabled = false, refreshStaticStates = true } = {}) {
    const field = runtime?.getField?.() || {};
    const range = runtime?.getDeployRange?.() || {};
    const mapConfig = runtime?.getTrainingMapConfig?.() || null;
    const hasThreeLaneMap = !!mapConfig?.enabled || String(mapConfig?.mapId || '') === 'training-three-lane';
    const width = Math.max(100, Number(field.width) || TRAINING_MAP_WORLD_WIDTH);
    const height = Math.max(100, Number(field.height) || TRAINING_MAP_WORLD_HEIGHT);
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const attackerMaxX = clamp(Number(range.attackerMaxX) || -10, -halfW, halfW);
    const defenderMinX = clamp(Number(range.defenderMinX) || 10, -halfW, halfW);
    const mapKey = hasThreeLaneMap
      ? `${mapConfig?.mapId || 'training-three-lane'}:${mapConfig?.mapVersion || 1}:${mapConfig?.activePresetId || ''}`
      : 'legacy-flat';
    const key = `${Math.round(width)}:${Math.round(height)}:${Math.round(attackerMaxX)}:${Math.round(defenderMinX)}:${mapKey}:${debugEnabled ? 'debug' : 'normal'}`;
    if (key === this.groundKey) {
      if (refreshStaticStates) this.updateTrainingMapStaticPlaceholderStates(runtime);
      return;
    }
    this.groundKey = key;
    this.mapStaticPlaceholderGroup = null;
    this.deployRegionHighlightGroup = null;
    clearGroup(this.groundGroup);

    const addBand = (x1, x2, color, name) => {
      const bandW = Math.max(1, x2 - x1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(bandW, height, 1, 1),
        createBandMaterial(color)
      );
      mesh.name = name;
      mesh.position.set((x1 + x2) * 0.5, 0, -0.04);
      this.groundGroup.add(mesh);
    };

    const addRectRegion = (region = {}, color = 0x2b4330, name = 'terrain-region', depthOptions = {}) => {
      const regionWidth = Math.max(1, Number(region?.width) || 1);
      const regionHeight = Math.max(1, Number(region?.height) || 1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(regionWidth, regionHeight, 1, 1),
        createBandMaterial(color, 0.92, depthOptions)
      );
      mesh.name = name;
      mesh.position.set(Number(region?.x) || 0, Number(region?.y) || 0, Number(region?.z) || 0);
      this.groundGroup.add(mesh);
    };

    const addSemicircleRegion = (region = {}, color = 0x2b4330, name = 'terrain-semicircle', depthOptions = {}) => {
      const radius = Math.max(1, Number(region?.radius) || Math.min(Number(region?.width) || 1, Number(region?.height) || 1) * 0.5);
      const startAngle = region?.arcDirection === 'down' ? Math.PI : 0;
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 48, startAngle, Math.PI),
        createBandMaterial(color, 0.92, depthOptions)
      );
      mesh.name = name;
      mesh.position.set(Number(region?.x) || 0, Number(region?.y) || 0, Number(region?.z) || 0);
      this.groundGroup.add(mesh);
    };

    const addPolygonRegion = (region = {}, color = 0x2b4330, name = 'terrain-polygon', depthOptions = {}) => {
      const points = Array.isArray(region?.points) ? region.points : [];
      if (points.length < 3) return;
      const highlandMesh = createTrainingHighlandMesh(region, color);
      if (highlandMesh) {
        highlandMesh.name = name;
        this.groundGroup.add(highlandMesh);
        return;
      }
      const shape = new THREE.Shape();
      shape.moveTo(Number(points[0]?.x) || 0, Number(points[0]?.y) || 0);
      points.slice(1).forEach((point) => {
        shape.lineTo(Number(point?.x) || 0, Number(point?.y) || 0);
      });
      shape.closePath();
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        createBandMaterial(color, 0.92, depthOptions)
      );
      mesh.name = name;
      mesh.position.z = Number(region?.z) || 0;
      this.groundGroup.add(mesh);
    };

    const addTerrainRegion = (region = {}, color = 0x2b4330, name = 'terrain-region') => {
      const depthOptions = resolveTrainingTerrainDepthOptions(region);
      if (region?.shape === 'polygon') {
        addPolygonRegion(region, color, name, depthOptions);
      } else if (region?.shape === 'semicircle') {
        addSemicircleRegion(region, color, name, depthOptions);
      } else {
        addRectRegion(region, color, name, depthOptions);
      }
      const edgeMesh = createTrainingTerrainEdgeMesh(
        region,
        color,
        `terrain-transition-${region?.id || String(region?.type || 'region')}`
      );
      if (edgeMesh) this.groundGroup.add(edgeMesh);
    };

    const mapLinePositions = [];
    const pushLine = (bucket, x1, y1, x2, y2, z = 0.05) => {
      bucket.push(x1, y1, z, x2, y2, z);
    };

    if (hasThreeLaneMap) {
      const terrainColors = {
        grass: 0x294533,
        'highland-attacker': 0x58272d,
        'highland-defender': 0x194a52,
        sand: 0xe9d549,
        river: 0xb69056,
        road: 0x655943
      };
      const terrainRegions = Array.isArray(mapConfig?.terrainRegions) ? mapConfig.terrainRegions : [];
      const resolveTerrainElevation = (point = {}) => resolveTrainingMapTerrainElevation(mapConfig, point);
      terrainRegions.forEach((region) => {
        const type = String(region?.type || 'grass');
        addTerrainRegion(region, terrainColors[type] || terrainColors.grass, `terrain-${region?.id || type}`);
      });
      const deployRegionHighlightGroup = new THREE.Group();
      deployRegionHighlightGroup.name = 'training-deploy-region-highlights';
      getTrainingMapSpawnRegions(mapConfig, { field: { width, height } })
        .filter((region) => region.walkable)
        .forEach((region) => {
          const highlight = createTrainingDeployRegionHighlightMesh(region, mapConfig);
          if (highlight) deployRegionHighlightGroup.add(highlight);
        });
      if (deployRegionHighlightGroup.children.length > 0) {
        deployRegionHighlightGroup.visible = false;
        this.deployRegionHighlightGroup = deployRegionHighlightGroup;
        this.groundGroup.add(deployRegionHighlightGroup);
      }
      (Array.isArray(mapConfig?.objects) ? mapConfig.objects : [])
        .filter((wall) => (
          wall?.category === 'wall'
          && wall?.geometryKind !== 'highlandRail'
          && Array.isArray(wall?.visualPath)
          && wall.visualPath.length >= 2
        ))
        .forEach((wall) => {
          const mesh = wall?.geometryKind === 'highWall'
            ? createTrainingHighWallMesh(wall)
            : createTrainingOrdinaryWallMesh(wall);
          if (mesh) this.groundGroup.add(mesh);
        });
      const lanes = Array.isArray(mapConfig?.lanes) ? mapConfig.lanes : [];
      lanes.forEach((lane) => {
        const centerY = Number(lane?.centerY) || 0;
        const laneWidth = Math.max(1, Number(lane?.width) || 150);
        pushLine(mapLinePositions, -halfW, centerY - (laneWidth * 0.5), halfW, centerY - (laneWidth * 0.5), 0.12);
        pushLine(mapLinePositions, -halfW, centerY + (laneWidth * 0.5), halfW, centerY + (laneWidth * 0.5), 0.12);
        if (debugEnabled) {
          const label = createGroundLabelSprite(String(lane?.label || lane?.id || '道路'), '#f8e7b6', 0.72);
          if (label) {
            label.position.set(-halfW + 175, centerY, 0.18);
            this.groundGroup.add(label);
          }
        }
      });
      const teamPresentation = mapConfig?.teamPresentation || {};
      terrainRegions
        .filter((region) => String(region?.type || '').startsWith('highland-'))
        .forEach((region) => {
          const team = String(region?.type || '').endsWith('defender') ? TEAM_DEFENDER : TEAM_ATTACKER;
          const presentation = teamPresentation?.[team] || {};
          const points = Array.isArray(region?.points) ? region.points : [];
          if (points.length <= 0) return;
          const centroid = points.reduce((sum, point) => ({
            x: sum.x + finiteOr(point?.x),
            y: sum.y + finiteOr(point?.y)
          }), { x: 0, y: 0 });
          const center = { x: centroid.x / points.length, y: centroid.y / points.length };
          const topElevation = resolveTerrainElevation(center);
          if (debugEnabled) {
            const sideLabel = String(region?.sourceRegionId || '').includes('bottom') ? '下' : '上';
            const label = createGroundLabelSprite(
              `${String(presentation?.label || (team === TEAM_DEFENDER ? '防守方高地' : '进攻方高地'))}${sideLabel}`,
              String(presentation?.color || (team === TEAM_DEFENDER ? '#16dfe8' : '#ef2020')),
              0.58
            );
            if (label) {
              label.position.set(center.x, center.y, topElevation + 0.28);
              this.groundGroup.add(label);
            }
          }
          const tip = points.reduce((currentTip, point) => {
            if (!currentTip) return point;
            const currentX = finiteOr(currentTip?.x);
            const nextX = finiteOr(point?.x);
            return team === TEAM_DEFENDER
              ? (nextX < currentX ? point : currentTip)
              : (nextX > currentX ? point : currentTip);
          }, null);
          if (!tip) return;
          const connector = createGroundDirectionArrow(
            team === TEAM_DEFENDER ? -1 : 1,
            team === TEAM_DEFENDER ? 0x55d4db : 0xee666a
          );
          connector.scale.set(0.54, 0.54, 1);
          connector.position.set(finiteOr(tip?.x), finiteOr(tip?.y), topElevation + 0.24);
          connector.name = `highland-route-connector-${region?.sourceRegionId || region?.id || team}`;
          this.groundGroup.add(connector);
        });
      const attackerArrow = createGroundDirectionArrow(1, 0xee666a);
      attackerArrow.position.set(-1020, 0, 0.13);
      this.groundGroup.add(attackerArrow);
      const defenderArrow = createGroundDirectionArrow(-1, 0x55d4db);
      defenderArrow.position.set(1020, 0, 0.13);
      this.groundGroup.add(defenderArrow);
      (Array.isArray(mapConfig?.deploySlots) ? mapConfig.deploySlots : []).forEach((slot) => {
        const defender = slot?.team === TEAM_DEFENDER;
        const slotElevation = resolveTerrainElevation(slot);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(8, 12, 28),
          new THREE.MeshBasicMaterial({
            color: defender ? 0x55d4db : 0xee666a,
            transparent: true,
            opacity: 0.86,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        ring.position.set(Number(slot?.x) || 0, Number(slot?.y) || 0, slotElevation + 0.14);
        this.groundGroup.add(ring);
        if (debugEnabled) {
          const slotLabel = createGroundLabelSprite(String(slot?.label || '部署槽'), defender ? '#b8f5f7' : '#ffd0d2', 0.42);
          if (slotLabel) {
            slotLabel.position.set(Number(slot?.x) || 0, (Number(slot?.y) || 0) + 28, slotElevation + 0.17);
            this.groundGroup.add(slotLabel);
          }
        }
      });
      const mapStaticPlaceholderGroup = new THREE.Group();
      mapStaticPlaceholderGroup.name = 'training-map-static-placeholders';
      mapStaticPlaceholderGroup.renderOrder = 2;
      (Array.isArray(mapConfig?.objects) ? mapConfig.objects : [])
        .filter((object) => isTrainingMapStaticPlaceholder(object))
        .forEach((object) => {
          const placeholder = createTrainingMapStaticPlaceholderMesh(
            object,
            resolveTerrainElevation(object)
          );
          if (placeholder) mapStaticPlaceholderGroup.add(placeholder);
        });
      if (mapStaticPlaceholderGroup.children.length > 0) {
        this.mapStaticPlaceholderGroup = mapStaticPlaceholderGroup;
        this.groundGroup.add(mapStaticPlaceholderGroup);
      }
      if (debugEnabled) {
        const referenceImage = mapConfig?.referenceGeometry?.debugOverlay?.referenceImage;
        const referenceImageUrl = String(referenceImage?.url || '');
        if (referenceImageUrl) {
          const texture = new THREE.TextureLoader().load(referenceImageUrl);
          const crop = referenceImage?.crop && typeof referenceImage.crop === 'object' ? referenceImage.crop : {};
          const cropLeft = clamp(Number(crop?.left) || 0, 0, 1);
          const cropTop = clamp(Number(crop?.top) || 0, 0, 1);
          const cropWidth = clamp(Number(crop?.width) || 1, 0.001, 1 - cropLeft);
          const cropHeight = clamp(Number(crop?.height) || 1, 0.001, 1 - cropTop);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.repeat.set(cropWidth, cropHeight);
          texture.offset.set(cropLeft, 1 - cropTop - cropHeight);
          texture.needsUpdate = true;
          const referenceOverlay = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height, 1, 1),
            new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              opacity: 0.28,
              side: THREE.DoubleSide,
              depthTest: false,
              depthWrite: false
            })
          );
          referenceOverlay.name = 'training-reference-overlay';
          referenceOverlay.position.set(0, 0, 0.24);
          referenceOverlay.renderOrder = 10;
          this.groundGroup.add(referenceOverlay);
        }
        const addDebugLine = (points = [], color = 0xffffff, name = 'training-map-debug-line', closed = false) => {
          if (!Array.isArray(points) || points.length < 2) return;
          const positions = [];
          points.forEach((point) => {
            positions.push(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0.3);
          });
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          const material = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.92,
            depthWrite: false
          });
          const line = closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
          line.name = name;
          this.groundGroup.add(line);
        };
        const normalizedToWorld = (point = []) => ({
          x: ((Number(point?.[0]) || 0) - 0.5) * width,
          y: (0.5 - (Number(point?.[1]) || 0)) * height,
          z: 0.3
        });
        (Array.isArray(mapConfig?.spawnRegions) ? mapConfig.spawnRegions : []).forEach((region) => {
          const sourceTerrain = terrainRegions.find((terrain) => terrain?.sourceRegionId === region?.id);
          const debugElevation = Math.max(
            0.3,
            finiteOr(sourceTerrain?.z) + Math.max(0, finiteOr(sourceTerrain?.elevation)) + 0.3
          );
          const points = (Array.isArray(region?.normalizedPolygon) ? region.normalizedPolygon : [])
            .map((point) => ({ ...normalizedToWorld(point), z: debugElevation }));
          addDebugLine(points, region?.team === TEAM_DEFENDER ? 0x16dfe8 : 0xef2020, `debug-spawn-${region?.id || 'region'}`, true);
          const centroid = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
          const label = createGroundLabelSprite(String(region?.id || 'spawn'), '#ffffff', 0.42);
          if (label && points.length > 0) {
            label.position.set(centroid.x / points.length, centroid.y / points.length, debugElevation + 0.06);
            this.groundGroup.add(label);
          }
        });
        lanes.forEach((lane) => {
          const points = Array.isArray(lane?.centerline) ? lane.centerline : [];
          addDebugLine(points.map((point) => ({ ...point, z: 0.31 })), 0xfff0a6, `debug-route-${lane?.id || 'lane'}`);
        });
        const mapObjects = Array.isArray(mapConfig?.objects) ? mapConfig.objects : [];
        mapObjects.filter((entry) => entry?.category === 'wall').forEach((wall) => {
          const wallColor = wall?.geometryKind === 'highWall' ? 0xf87171 : 0xfbbf24;
          const visualPath = Array.isArray(wall?.visualPath) ? wall.visualPath : [];
          const debugWallElevation = Math.max(0.32, finiteOr(wall?.z) + Math.max(0, finiteOr(wall?.height)) + 0.45);
          if (visualPath.length >= 2) {
            addDebugLine(
              visualPath.map((point) => ({ ...point, z: debugWallElevation })),
              wallColor,
              `debug-wall-path-${wall?.objectId || 'wall'}`
            );
          }
          const halfWidth = Math.max(1, Number(wall?.width) || 1) * 0.5;
          const halfDepth = Math.max(1, Number(wall?.depth) || 1) * 0.5;
          const centerX = Number(wall?.x) || 0;
          const centerY = Number(wall?.y) || 0;
          if (visualPath.length < 2) {
            addDebugLine([
              { x: centerX - halfWidth, y: centerY - halfDepth, z: 0.32 },
              { x: centerX + halfWidth, y: centerY - halfDepth, z: 0.32 },
              { x: centerX + halfWidth, y: centerY + halfDepth, z: 0.32 },
              { x: centerX - halfWidth, y: centerY + halfDepth, z: 0.32 }
            ], wallColor, `debug-wall-${wall?.objectId || 'wall'}`, true);
          }
          const colliderParts = Array.isArray(wall?.collider?.parts) ? wall.collider.parts : [];
          colliderParts.forEach((part, partIndex) => {
            const partCenterX = centerX + (Number(part?.cx) || 0);
            const partCenterY = centerY + (Number(part?.cy) || 0);
            const partHalfWidth = Math.max(1, Number(part?.w) || 1) * 0.5;
            const partHalfDepth = Math.max(1, Number(part?.d) || 1) * 0.5;
            const yawRadians = (Number(part?.yawDeg) || 0) * Math.PI / 180;
            const cosine = Math.cos(yawRadians);
            const sine = Math.sin(yawRadians);
            const corners = [
              { x: -partHalfWidth, y: -partHalfDepth },
              { x: partHalfWidth, y: -partHalfDepth },
              { x: partHalfWidth, y: partHalfDepth },
              { x: -partHalfWidth, y: partHalfDepth }
            ].map((corner) => ({
              x: partCenterX + ((corner.x * cosine) - (corner.y * sine)),
              y: partCenterY + ((corner.x * sine) + (corner.y * cosine)),
              z: debugWallElevation
            }));
            addDebugLine(corners, 0x38bdf8, `debug-wall-collider-${wall?.objectId || 'wall'}-${partIndex}`, true);
          });
        });
        const mapObjectsById = new Map(mapObjects.map((entry) => [String(entry?.objectId || ''), entry]));
        (Array.isArray(mapConfig?.objectives) ? mapConfig.objectives : []).forEach((objective) => {
          const source = mapObjectsById.get(String(objective?.sourceObjectId || ''));
          if (!source) return;
          const label = createGroundLabelSprite(String(objective?.objectiveId || 'objective'), objective?.type === 'tower' ? '#ffffff' : '#d9f99d', 0.34);
          if (label) {
            label.position.set(
              Number(source?.x) || 0,
              (Number(source?.y) || 0) + 20,
              resolveTerrainElevation(source) + 0.38
            );
            this.groundGroup.add(label);
          }
        });
      }
    } else {
      addBand(-halfW, attackerMaxX, 0x102b43, 'attacker-deploy-band');
      addBand(attackerMaxX, defenderMinX, 0x2c2a1d, 'center-engagement-band');
      addBand(defenderMinX, halfW, 0x421b1c, 'defender-deploy-band');
    }

    const minorPositions = [];
    const majorPositions = [];
    for (let x = Math.ceil(-halfW / 28) * 28; x <= halfW; x += 28) {
      const bucket = Math.abs(x % 112) <= 0.001 ? majorPositions : minorPositions;
      pushLine(bucket, x, -halfH, x, halfH);
    }
    for (let y = Math.ceil(-halfH / 28) * 28; y <= halfH; y += 28) {
      const bucket = Math.abs(y % 112) <= 0.001 ? majorPositions : minorPositions;
      pushLine(bucket, -halfW, y, halfW, y);
    }

    const addLines = (positions, color, opacity, name) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.name = name;
      lines.visible = name === 'minor-grid' || name === 'major-grid' ? this.gridVisible : true;
      this.groundGroup.add(lines);
    };
    addLines(minorPositions, 0x7fa8bd, 0.16, 'minor-grid');
    addLines(majorPositions, 0xd7e8ef, 0.26, 'major-grid');
    if (mapLinePositions.length > 0) addLines(mapLinePositions, 0xf8e7b6, 0.42, 'training-lane-boundaries');

    const boundaryPositions = [];
    if (!hasThreeLaneMap) {
      pushLine(boundaryPositions, attackerMaxX, -halfH, attackerMaxX, halfH, 0.08);
      pushLine(boundaryPositions, defenderMinX, -halfH, defenderMinX, halfH, 0.08);
    }
    pushLine(boundaryPositions, -halfW, -halfH, halfW, -halfH, 0.08);
    pushLine(boundaryPositions, halfW, -halfH, halfW, halfH, 0.08);
    pushLine(boundaryPositions, halfW, halfH, -halfW, halfH, 0.08);
    pushLine(boundaryPositions, -halfW, halfH, -halfW, -halfH, 0.08);
    addLines(boundaryPositions, 0xffe08a, 0.62, hasThreeLaneMap ? 'map-boundaries' : 'deployment-boundaries');
    this.updateTrainingMapStaticPlaceholderStates(runtime);
  }

  ensureUnitCapacity(count) {
    if (count <= this.unitCapacity && this.unitMesh) return;
    const nextCapacity = Math.max(128, Math.ceil(count * 1.35));
    if (this.unitMesh) this.unitGroup.remove(this.unitMesh);
    this.unitMesh = makeInstancedMesh(this.unitGeometry, this.unitMaterial, nextCapacity);
    this.unitGroup.add(this.unitMesh);
    this.unitCapacity = nextCapacity;
  }

  ensureSelectedRingCapacity(count) {
    if (count <= this.selectedRingCapacity && this.selectedRingMesh) return;
    const nextCapacity = Math.max(32, Math.ceil(count * 1.35));
    if (this.selectedRingMesh) this.unitGroup.remove(this.selectedRingMesh);
    this.selectedRingMesh = makeInstancedMesh(this.selectedRingGeometry, this.selectedRingMaterial, nextCapacity);
    this.selectedRingMesh.renderOrder = 3;
    this.unitGroup.add(this.selectedRingMesh);
    this.selectedRingCapacity = nextCapacity;
  }

  ensureHoverFootprintCapacity(count) {
    if (
      count <= this.hoverFootprintCapacity
      && this.hoverFootprintOuterMesh
      && this.hoverFootprintInnerMesh
    ) return;
    const nextCapacity = Math.max(32, Math.ceil(count * 1.35));
    if (this.hoverFootprintOuterMesh) this.unitGroup.remove(this.hoverFootprintOuterMesh);
    if (this.hoverFootprintInnerMesh) this.unitGroup.remove(this.hoverFootprintInnerMesh);
    this.hoverFootprintOuterMesh = makeInstancedMesh(
      this.hoverFootprintGeometry,
      this.hoverFootprintOuterMaterial,
      nextCapacity
    );
    this.hoverFootprintInnerMesh = makeInstancedMesh(
      this.hoverFootprintGeometry,
      this.hoverFootprintInnerMaterial,
      nextCapacity
    );
    this.hoverFootprintOuterMesh.renderOrder = 1;
    this.hoverFootprintInnerMesh.renderOrder = 2;
    this.unitGroup.add(this.hoverFootprintOuterMesh, this.hoverFootprintInnerMesh);
    this.hoverFootprintCapacity = nextCapacity;
  }

  ensureSkillPreviewTargetCapacity(count) {
    if (
      count <= this.skillPreviewTargetRingCapacity
      && count <= this.skillPreviewTargetDiscCapacity
      && this.skillPreviewTargetRingMesh
      && this.skillPreviewTargetDiscMesh
    ) return;
    const nextCapacity = Math.max(32, Math.ceil(Math.max(1, count) * 1.35));
    if (this.skillPreviewTargetRingMesh) this.skillPreviewGroup.remove(this.skillPreviewTargetRingMesh);
    if (this.skillPreviewTargetDiscMesh) this.skillPreviewGroup.remove(this.skillPreviewTargetDiscMesh);
    this.skillPreviewTargetRingMesh = makeInstancedMesh(
      this.skillPreviewTargetRingGeometry,
      this.skillPreviewTargetRingMaterial,
      nextCapacity
    );
    this.skillPreviewTargetDiscMesh = makeInstancedMesh(
      this.skillPreviewTargetDiscGeometry,
      this.skillPreviewTargetDiscMaterial,
      nextCapacity
    );
    this.skillPreviewTargetRingMesh.renderOrder = 8;
    this.skillPreviewTargetDiscMesh.renderOrder = 7;
    this.skillPreviewGroup.add(this.skillPreviewTargetDiscMesh, this.skillPreviewTargetRingMesh);
    this.skillPreviewTargetRingCapacity = nextCapacity;
    this.skillPreviewTargetDiscCapacity = nextCapacity;
  }

  ensureMeleeAlertCapacity(count) {
    if (count <= this.meleeAlertCapacity && this.meleeAlertMesh) return;
    const nextCapacity = Math.max(8, Math.ceil(Math.max(1, count) * 1.35));
    if (this.meleeAlertMesh) this.meleeAlertGroup.remove(this.meleeAlertMesh);
    this.meleeAlertMesh = makeInstancedMesh(this.meleeAlertGeometry, this.meleeAlertMaterial, nextCapacity);
    this.meleeAlertMesh.renderOrder = 4;
    this.meleeAlertGroup.add(this.meleeAlertMesh);
    this.meleeAlertCapacity = nextCapacity;
  }

  updateMeleeAlertRegions(runtime = null, skillConfirmState = null, preview = null) {
    const regions = [];
    const squads = Array.isArray(runtime?.sim?.squads) ? runtime.sim.squads : [];
    squads.forEach((squad) => {
      const order = squad?.meleeAttackOrder;
      if (!order || order.active === false || !order.alertRect || (Number(squad?.remain) || 0) <= 0) return;
      regions.push({ ...order.alertRect, phase: 'active' });
    });
    if (
      preview?.targetMode === 'ground'
      && preview?.castStyle === 'melee'
      && preview?.targetPoint
      && skillConfirmState?.squadId
    ) {
      const sourceSquad = runtime?.getSquadById?.(skillConfirmState.squadId);
      if (sourceSquad) {
        regions.push({
          ...resolveTrainingMeleeAlertRect(sourceSquad, preview.targetPoint),
          phase: 'prepare'
        });
      }
    }
    this.ensureMeleeAlertCapacity(regions.length);
    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      tempPos.set(finiteOr(region.x), finiteOr(region.y), 0.16);
      tempEuler.set(0, 0, finiteOr(region.yaw));
      tempQuat.setFromEuler(tempEuler);
      tempScale.set(
        Math.max(8, finiteOr(region.width, 64)),
        Math.max(8, finiteOr(region.depth, 48)),
        1
      );
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.meleeAlertMesh.setMatrixAt(index, tempMatrix);
    }
    this.meleeAlertMesh.count = regions.length;
    this.meleeAlertMesh.visible = regions.length > 0;
    this.meleeAlertMesh.instanceMatrix.needsUpdate = true;
  }

  updateSkillMarkers(runtime = null, skillConfirmState = null) {
    const agents = Array.isArray(runtime?.crowd?.allAgents)
      ? runtime.crowd.allAgents.filter((agent) => agent && !agent.dead && (Number(agent.weight) || 0) > 0.001)
      : [];
    const activeIds = new Set();
    const rows = [];
    agents.forEach((agent) => {
      if (!agent.castState) return;
      activeIds.add(agent.id);
      rows.push({
        agent,
        phase: 'active',
        category: resolveTrainingSkillMarkerCategory(agent, agent.unitCategory)
      });
    });
    if (skillConfirmState?.squadId) {
      const sourceCategory = String(skillConfirmState?.profile?.sourceCategory || skillConfirmState?.sourceCategory || 'melee');
      agents.forEach((agent) => {
        if (activeIds.has(agent.id) || String(agent.squadId || '') !== String(skillConfirmState.squadId)) return;
        const category = String(agent.unitCategory || 'melee');
        if (category !== sourceCategory) return;
        rows.push({
          agent,
          phase: 'prepare',
          category: resolveTrainingSkillMarkerCategory(agent, sourceCategory)
        });
      });
    }
    while (this.skillMarkerPool.length < rows.length) {
      const sprite = new THREE.Sprite(this.skillMarkerMaterials['prepare:infantry']);
      sprite.frustumCulled = false;
      sprite.renderOrder = 9;
      this.skillMarkerGroup.add(sprite);
      this.skillMarkerPool.push(sprite);
    }
    rows.forEach((row, index) => {
      const agent = row.agent;
      const material = this.skillMarkerMaterials[`${row.phase}:${row.category}`]
        || this.skillMarkerMaterials[`prepare:infantry`];
      const size = Math.max(4.8, Math.min(10.5, 4.4 + (Math.sqrt(Math.max(1, finiteOr(agent.weight, 1))) * 0.62)));
      this.skillMarkerPool[index].material = material;
      this.skillMarkerPool[index].position.set(
        finiteOr(agent.x),
        finiteOr(agent.y),
        Math.max(8.5, size * 2.1)
      );
      this.skillMarkerPool[index].scale.set(size, size, 1);
      this.skillMarkerPool[index].visible = true;
    });
    for (let index = rows.length; index < this.skillMarkerPool.length; index += 1) {
      this.skillMarkerPool[index].visible = false;
    }
    this.skillMarkerGroup.visible = rows.length > 0;
  }

  updateSkillPreview(runtime = null, skillConfirmState = null, resolvedPreview = null) {
    const preview = resolvedPreview || resolveTrainingSkillPreview(runtime, skillConfirmState);
    if (!preview.active || !preview.source) {
      this.skillPreviewGroup.visible = false;
      if (this.skillPreviewTargetRingMesh) this.skillPreviewTargetRingMesh.count = 0;
      if (this.skillPreviewTargetDiscMesh) this.skillPreviewTargetDiscMesh.count = 0;
      return;
    }

    this.skillPreviewGroup.visible = true;
    const source = preview.source;
    const targetPoint = preview.targetPoint;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const pulse = 0.82 + (Math.sin(now * 0.008) * 0.16);
    this.skillPreviewTargetRingMaterial.opacity = clamp(pulse, 0.58, 1);
    this.skillPreviewTargetDiscMaterial.opacity = clamp(pulse * 0.18, 0.1, 0.24);

    const setGroundTransform = (mesh, x, y, radius, z = SKILL_PREVIEW_GROUND_Z) => {
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(Math.max(0.01, radius));
      mesh.visible = true;
    };
    const hideMesh = (mesh) => {
      mesh.visible = false;
    };

    hideMesh(this.skillPreviewRangeMesh);
    hideMesh(this.skillPreviewAoeMesh);
    hideMesh(this.skillPreviewAoeRingMesh);
    hideMesh(this.skillPreviewOriginMesh);
    hideMesh(this.skillPreviewConeMesh);
    hideMesh(this.skillPreviewLineMesh);
    this.skillPreviewArrow.visible = false;

    if (preview.targetMode === 'direction') {
      const direction = normalizeSkillPreviewVector(preview.direction?.x, preview.direction?.y);
      setGroundTransform(this.skillPreviewRangeMesh, source.x, source.y, preview.maxRange);
      setGroundTransform(this.skillPreviewOriginMesh, source.x, source.y, Math.max(7, preview.aoeRadius * 0.34));
      this.skillPreviewConeMesh.visible = true;
      const conePositions = this.skillPreviewConeGeometry.getAttribute('position').array;
      const halfAngle = (preview.coneAngleDeg * Math.PI / 180) * 0.5;
      const centerAngle = Math.atan2(direction.y, direction.x);
      for (let index = 0; index < SKILL_PREVIEW_CONE_SEGMENTS; index += 1) {
        const startAngle = centerAngle - halfAngle + ((index / SKILL_PREVIEW_CONE_SEGMENTS) * (halfAngle * 2));
        const endAngle = centerAngle - halfAngle + (((index + 1) / SKILL_PREVIEW_CONE_SEGMENTS) * (halfAngle * 2));
        const base = index * 9;
        conePositions[base + 0] = source.x;
        conePositions[base + 1] = source.y;
        conePositions[base + 2] = SKILL_PREVIEW_GROUND_Z - 0.01;
        conePositions[base + 3] = source.x + (Math.cos(startAngle) * preview.maxRange);
        conePositions[base + 4] = source.y + (Math.sin(startAngle) * preview.maxRange);
        conePositions[base + 5] = SKILL_PREVIEW_GROUND_Z - 0.01;
        conePositions[base + 6] = source.x + (Math.cos(endAngle) * preview.maxRange);
        conePositions[base + 7] = source.y + (Math.sin(endAngle) * preview.maxRange);
        conePositions[base + 8] = SKILL_PREVIEW_GROUND_Z - 0.01;
      }
      this.skillPreviewConeGeometry.getAttribute('position').needsUpdate = true;
      this.skillPreviewConeGeometry.computeBoundingSphere();
      const requestedLength = Math.max(10, finiteOr(skillConfirmState?.len, preview.maxRange));
      const arrowStart = Math.min(12, Math.max(4, requestedLength * 0.18));
      const arrowLength = Math.max(8, requestedLength - arrowStart);
      this.skillPreviewArrow.position.set(
        source.x + (direction.x * arrowStart),
        source.y + (direction.y * arrowStart),
        SKILL_PREVIEW_GROUND_Z + 0.08
      );
      this.skillPreviewArrow.setDirection(new THREE.Vector3(direction.x, direction.y, 0));
      this.skillPreviewArrow.setLength(
        arrowLength,
        Math.min(16, Math.max(6, arrowLength * 0.24)),
        Math.min(9, Math.max(3.5, arrowLength * 0.12))
      );
      this.skillPreviewArrow.visible = true;
    } else {
      setGroundTransform(this.skillPreviewRangeMesh, source.x, source.y, preview.maxRange);
      if (targetPoint && !preview.paintArea?.stamps?.length) {
        setGroundTransform(this.skillPreviewAoeMesh, targetPoint.x, targetPoint.y, preview.aoeRadius);
        setGroundTransform(this.skillPreviewAoeRingMesh, targetPoint.x, targetPoint.y, preview.aoeRadius);
        setGroundTransform(this.skillPreviewOriginMesh, source.x, source.y, Math.max(7, preview.aoeRadius * 0.24));
        const linePosition = this.skillPreviewLineGeometry.getAttribute('position').array;
        linePosition[0] = source.x;
        linePosition[1] = source.y;
        linePosition[2] = SKILL_PREVIEW_GROUND_Z + 0.01;
        linePosition[3] = targetPoint.x;
        linePosition[4] = targetPoint.y;
        linePosition[5] = SKILL_PREVIEW_GROUND_Z + 0.01;
        this.skillPreviewLineGeometry.getAttribute('position').needsUpdate = true;
        this.skillPreviewLineGeometry.computeBoundingSphere();
        this.skillPreviewLineMesh.visible = Math.hypot(targetPoint.x - source.x, targetPoint.y - source.y) > 1;
        if (preview.castStyle === 'melee') {
          const direction = normalizeSkillPreviewVector(
            targetPoint.x - source.x,
            targetPoint.y - source.y,
            finiteOr(skillConfirmState?.dir?.x, 1),
            finiteOr(skillConfirmState?.dir?.y)
          );
          const totalLength = Math.max(10, Math.hypot(targetPoint.x - source.x, targetPoint.y - source.y));
          const arrowStart = Math.min(12, Math.max(4, totalLength * 0.18));
          const arrowLength = Math.max(8, totalLength - arrowStart);
          this.skillPreviewArrow.position.set(
            source.x + (direction.x * arrowStart),
            source.y + (direction.y * arrowStart),
            SKILL_PREVIEW_GROUND_Z + 0.08
          );
          this.skillPreviewArrow.setDirection(new THREE.Vector3(direction.x, direction.y, 0));
          this.skillPreviewArrow.setLength(
            arrowLength,
            Math.min(16, Math.max(6, arrowLength * 0.24)),
            Math.min(9, Math.max(3.5, arrowLength * 0.12))
          );
          this.skillPreviewArrow.visible = true;
        }
      }
    }

    const targetAgents = Array.isArray(preview.targetAgents) ? preview.targetAgents : [];
    this.ensureSkillPreviewTargetCapacity(targetAgents.length);
    let targetIndex = 0;
    targetAgents.forEach((agent) => {
      const size = Math.max(2.4, Math.min(11, Math.sqrt(Math.max(1, finiteOr(agent?.weight, 1))) * 0.82));
      const x = finiteOr(agent?.x);
      const y = finiteOr(agent?.y);
      tempPos.set(x, y, SKILL_PREVIEW_TARGET_Z);
      tempQuat.identity();
      tempScale.set(size * 1.74, size * 1.74, 1);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.skillPreviewTargetRingMesh.setMatrixAt(targetIndex, tempMatrix);
      tempScale.set(size * 1.36, size * 1.36, 1);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.skillPreviewTargetDiscMesh.setMatrixAt(targetIndex, tempMatrix);
      targetIndex += 1;
    });
    this.skillPreviewTargetRingMesh.count = targetIndex;
    this.skillPreviewTargetDiscMesh.count = targetIndex;
    this.skillPreviewTargetRingMesh.instanceMatrix.needsUpdate = true;
    this.skillPreviewTargetDiscMesh.instanceMatrix.needsUpdate = true;
  }

  ensureDirectionMarkerCapacity(count) {
    if (
      count <= this.directionMarkerCapacity
      && this.worldFlagPoleMesh
      && this.worldFlagFinialMesh
    ) {
      this.ensureWorldFlagClothPool(count);
      return;
    }
    const nextCapacity = Math.max(32, Math.ceil(count * 1.35));
    if (this.worldFlagPoleMesh) this.unitGroup.remove(this.worldFlagPoleMesh);
    if (this.worldFlagFinialMesh) this.unitGroup.remove(this.worldFlagFinialMesh);
    this.worldFlagPoleMesh = makeInstancedMesh(this.worldFlagPoleGeometry, this.worldFlagPoleMaterial, nextCapacity);
    this.worldFlagFinialMesh = makeInstancedMesh(this.worldFlagFinialGeometry, this.worldFlagFinialMaterial, nextCapacity);
    this.worldFlagPoleMesh.renderOrder = 2;
    this.worldFlagFinialMesh.renderOrder = 4;
    this.unitGroup.add(
      this.worldFlagPoleMesh,
      this.worldFlagFinialMesh
    );
    this.directionMarkerCapacity = nextCapacity;
    this.ensureWorldFlagClothPool(nextCapacity);
  }

  ensureWorldFlagClothPool(count) {
    while (this.worldFlagClothPool.length < count) {
      const canvas = createTrainingFlagCanvas();
      const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
      }
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.04,
        roughness: 0.76,
        metalness: 0.02
      });
      const mesh = new THREE.Mesh(this.worldFlagClothGeometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.unitGroup.add(mesh);
      this.worldFlagClothPool.push({ canvas, texture, material, mesh, signature: '' });
    }
  }

  updateUnits(units, skillStates = null, visualFocus = null, cameraState = {}) {
    const count = getSnapshotCount(units);
    const hoverPresentation = resolveTrainingHoverPresentation(cameraState);
    this.chibiUnitRenderer.update(units, skillStates, {
      ...(visualFocus || {}),
      hoverZoomProgress: hoverPresentation.zoomOutProgress
    });
    this.hoverFootprintOuterMaterial.opacity = hoverPresentation.outerOpacity;
    this.hoverFootprintInnerMaterial.opacity = hoverPresentation.innerOpacity;
    const data = units?.data || [];
    let selectedCount = 0;
    let hoveredCount = 0;
    for (let i = 0; i < count; i += 1) {
      const base = i * UNIT_INSTANCE_STRIDE;
      const showGroundMarker = shouldRenderTrainingUnitGroundMarker(data[base + 5]);
      if (showGroundMarker && Number(data[base + 12]) > 0.5) selectedCount += 1;
      if (showGroundMarker && Number(data[base + 15]) > 0.5) hoveredCount += 1;
    }

    this.ensureSelectedRingCapacity(selectedCount);
    this.ensureHoverFootprintCapacity(hoveredCount);
    let selectedIndex = 0;
    let hoveredEffectIndex = 0;
    for (let i = 0; i < count; i += 1) {
      const base = i * UNIT_INSTANCE_STRIDE;
      const x = Number(data[base + 0]) || 0;
      const y = Number(data[base + 1]) || 0;
      const z = Number(data[base + 2]) || 0;
      const size = Math.max(2.2, Number(data[base + 3]) || 4);
      const selected = Number(data[base + 12]) > 0.5;
      const hovered = Number(data[base + 15]) > 0.5;
      const showGroundMarker = shouldRenderTrainingUnitGroundMarker(data[base + 5]);
      if (selected && showGroundMarker) {
        tempPos.set(x, y, z + 0.14);
        tempQuat.identity();
        const selectionRadius = resolveTrainingSelectedUnitRingRadius(size);
        tempScale.set(selectionRadius, selectionRadius, 1);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.selectedRingMesh.setMatrixAt(selectedIndex, tempMatrix);
        selectedIndex += 1;
      }
      if (hovered && showGroundMarker) {
        const footprint = resolveTrainingHoverFootprint(size, hoverPresentation.zoomOutProgress);
        const yaw = Number(data[base + 4]) || 0;
        tempColor.copy(resolveTrainingTeamColor(data[base + 5]));
        tempColor.lerp(HOVER_FOOTPRINT_COLOR, hoverPresentation.outerColorMix);
        tempEuler.set(0, 0, yaw);
        tempQuat.setFromEuler(tempEuler);
        tempPos.set(x, y, z + footprint.outer.elevation);
        tempScale.set(footprint.outer.width * 0.5, footprint.outer.depth * 0.5, 1);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.hoverFootprintOuterMesh.setMatrixAt(hoveredEffectIndex, tempMatrix);
        this.hoverFootprintOuterMesh.setColorAt(hoveredEffectIndex, tempColor);
        tempColor.copy(resolveTrainingTeamColor(data[base + 5]));
        tempColor.lerp(HOVER_FOOTPRINT_COLOR, hoverPresentation.innerColorMix);
        tempPos.set(x, y, z + footprint.inner.elevation);
        tempScale.set(footprint.inner.width * 0.5, footprint.inner.depth * 0.5, 1);
        tempMatrix.compose(tempPos, tempQuat, tempScale);
        this.hoverFootprintInnerMesh.setMatrixAt(hoveredEffectIndex, tempMatrix);
        this.hoverFootprintInnerMesh.setColorAt(hoveredEffectIndex, tempColor);
        hoveredEffectIndex += 1;
      }
    }
    this.selectedRingMesh.count = selectedCount;
    this.selectedRingMesh.instanceMatrix.needsUpdate = true;
    this.hoverFootprintOuterMesh.count = hoveredEffectIndex;
    this.hoverFootprintInnerMesh.count = hoveredEffectIndex;
    this.hoverFootprintOuterMesh.instanceMatrix.needsUpdate = true;
    this.hoverFootprintInnerMesh.instanceMatrix.needsUpdate = true;
    if (this.hoverFootprintOuterMesh.instanceColor) this.hoverFootprintOuterMesh.instanceColor.needsUpdate = true;
    if (this.hoverFootprintInnerMesh.instanceColor) this.hoverFootprintInnerMesh.instanceColor.needsUpdate = true;
  }

  pickTrainingWorldFlagIdAtScreen(x, y) {
    return pickTrainingWorldFlagId(this.worldFlagHitRects, x, y);
  }

  updateDirectionMarkers(runtime, cameraState = {}, snapshot = null) {
    const mapConfig = runtime?.getTrainingMapConfig?.() || null;
    const renderedSquadAnchors = resolveTrainingRenderedSquadAnchors(runtime, snapshot);
    const anchors = resolveTrainingDirectionArcAnchors(runtime, renderedSquadAnchors).map((anchor) => ({
      ...anchor,
      groundElevation: resolveTrainingMapTerrainElevation(mapConfig, anchor)
    }));
    const markerCount = anchors.length;
    this.ensureDirectionMarkerCapacity(markerCount);
    const arcAnchors = anchors
      .filter((anchor) => shouldRenderTrainingUnitGroundMarker(anchor.teamIndex))
      .map((anchor) => {
        tempColor.copy(resolveTrainingTeamColor(anchor.teamIndex));
        if (anchor.selected) tempColor.lerp(SELECTED_COLOR, 0.4);
        if (anchor.hovered) tempColor.lerp(HOVER_COLOR, 0.72);
        return {
          ...anchor,
          color: [tempColor.r, tempColor.g, tempColor.b]
        };
      });
    updateTrainingDirectionArcGeometry(this.directionArcGeometry, arcAnchors);
    const flagLod = resolveTrainingFlagLod(cameraState?.pitchDeg);
    const viewportHeight = Math.max(
      1,
      finiteOr(this.viewportCssHeight, finiteOr(this.canvas?.clientHeight, 1))
    );
    tempWorldFlagCameraForward.set(0, 0, -1).transformDirection(this.camera.matrixWorld);
    tempWorldFlagCameraUp.set(0, 1, 0).transformDirection(this.camera.matrixWorld);
    const projectWorldFlag = (point) => {
      const projected = new THREE.Vector3(
        Number(point?.x) || 0,
        Number(point?.y) || 0,
        Number(point?.z) || 0
      ).project(this.camera);
      return {
        x: ((projected.x + 1) * 0.5) * Math.max(1, Number(this.canvas?.width) || 1),
        y: ((1 - projected.y) * 0.5) * Math.max(1, Number(this.canvas?.height) || 1),
        visible: projected.z >= -1 && projected.z <= 1
      };
    };
    const flagLayouts = resolveTrainingWorldFlagLayout({
      anchors,
      camera: {
        currentPitch: cameraState?.pitchDeg,
        renderEye: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
        renderForward: [tempWorldFlagCameraForward.x, tempWorldFlagCameraForward.y, tempWorldFlagCameraForward.z],
        renderUp: [tempWorldFlagCameraUp.x, tempWorldFlagCameraUp.y, tempWorldFlagCameraUp.z]
      },
      project: projectWorldFlag,
      viewportWidth: Math.max(1, Number(this.canvas?.width) || 1),
      viewportHeight: Math.max(1, Number(this.canvas?.height) || 1),
      viewportCssHeight: viewportHeight,
      pitchDeg: cameraState?.pitchDeg
    });
    this.worldFlagHitRects = resolveTrainingWorldFlagHitRectsFromLayouts(
      flagLayouts,
      projectWorldFlag
    );
    const flagCount = flagLayouts.length;
    flagLayouts.forEach((layout, index) => {
      const anchor = layout.anchor;
      tempPos.set(layout.displayX, layout.displayY, layout.groundElevation - 0.35);
      tempQuat.identity();
      tempScale.set(
        layout.worldFlagScale,
        layout.worldFlagScale,
        layout.isLeader ? layout.stackedPoleHeight + (0.35 * layout.worldFlagScale) : 0.001
      );
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.worldFlagPoleMesh.setMatrixAt(index, tempMatrix);

      tempEuler.set(0, 0, layout.cameraYaw + (Math.PI / 2));
      tempQuat.setFromEuler(tempEuler);
      tempPos.set(layout.displayX, layout.displayY, layout.baseZ);
      tempScale.set(
        layout.clothWidth * layout.worldFlagScale,
        1,
        layout.clothHeight * layout.worldFlagScale
      );
      const clothEntry = this.worldFlagClothPool[index];
      if (clothEntry) {
        clothEntry.mesh.position.copy(tempPos);
        clothEntry.mesh.quaternion.copy(tempQuat);
        clothEntry.mesh.scale.copy(tempScale);
        clothEntry.mesh.visible = flagCount > 0 && flagLod.worldFlag;
        const textureSignature = trainingFlagTextureSignature(anchor);
        if (textureSignature !== clothEntry.signature) {
          drawTrainingFlagCanvas(clothEntry.canvas, anchor);
          if (clothEntry.texture) clothEntry.texture.needsUpdate = true;
          clothEntry.signature = textureSignature;
        }
      }

      tempPos.set(
        layout.displayX,
        layout.displayY,
        layout.groundElevation + layout.stackedPoleHeight + (0.4 * layout.worldFlagScale)
      );
      tempQuat.identity();
      tempScale.setScalar(layout.isLeader ? 0.64 * layout.worldFlagScale : 0.001);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.worldFlagFinialMesh.setMatrixAt(index, tempMatrix);
    });

    this.directionArcMesh.visible = arcAnchors.length > 0;
    this.worldFlagPoleMesh.visible = flagCount > 0 && flagLod.worldFlag;
    this.worldFlagFinialMesh.visible = flagCount > 0 && flagLod.worldFlag;
    this.worldFlagPoleMesh.count = flagCount;
    this.worldFlagFinialMesh.count = flagCount;
    this.worldFlagPoleMesh.instanceMatrix.needsUpdate = true;
    this.worldFlagFinialMesh.instanceMatrix.needsUpdate = true;
    for (let index = flagCount; index < this.worldFlagClothPool.length; index += 1) {
      this.worldFlagClothPool[index].mesh.visible = false;
    }
  }

  ensureBuildingCapacity(count) {
    if (count <= this.buildingCapacity && this.buildingMesh) return;
    const nextCapacity = Math.max(64, Math.ceil(count * 1.35));
    if (this.buildingMesh) this.buildingGroup.remove(this.buildingMesh);
    this.buildingMesh = makeInstancedMesh(this.buildingGeometry, this.buildingMaterial, nextCapacity);
    this.buildingGroup.add(this.buildingMesh);
    this.buildingCapacity = nextCapacity;
  }

  updateBuildings(buildings) {
    const count = getSnapshotCount(buildings);
    this.ensureBuildingCapacity(count);
    const data = buildings?.data || [];
    for (let i = 0; i < count; i += 1) {
      const base = i * BUILDING_INSTANCE_STRIDE;
      const x = Number(data[base + 0]) || 0;
      const y = Number(data[base + 1]) || 0;
      const z = Number(data[base + 2]) || 0;
      const yaw = Number(data[base + 3]) || 0;
      const width = Math.max(1, Number(data[base + 4]) || 1);
      const depth = Math.max(1, Number(data[base + 5]) || 1);
      const height = Math.max(1, Number(data[base + 6]) || 1);
      const hpRatio = clamp(Number(data[base + 7]) || 0, 0, 1);
      const destroyed = Number(data[base + 8]) > 0.5;
      const foliageOpacity = clamp(Number(data[base + 15]) || 0, 0, 1);

      tempPos.set(x, y, z + (height * 0.5));
      tempEuler.set(0, 0, yaw);
      tempQuat.setFromEuler(tempEuler);
      tempScale.set(width, depth, destroyed ? 0.001 : height);
      tempMatrix.compose(tempPos, tempQuat, tempScale);
      this.buildingMesh.setMatrixAt(i, tempMatrix);

      if (foliageOpacity > 0.001) {
        tempColor.setRGB(
          lerp(0.16, 0.28, hpRatio),
          lerp(0.35, 0.62, hpRatio),
          lerp(0.19, 0.28, hpRatio)
        );
      } else {
        const tr = Number(data[base + 9]) || 0.52;
        const tg = Number(data[base + 10]) || 0.58;
        const tb = Number(data[base + 11]) || 0.66;
        const sr = Number(data[base + 12]) || 0.38;
        const sg = Number(data[base + 13]) || 0.44;
        const sb = Number(data[base + 14]) || 0.52;
        tempColor.setRGB(
          lerp(sr, tr, 0.42) * lerp(0.42, 1, hpRatio),
          lerp(sg, tg, 0.42) * lerp(0.42, 1, hpRatio),
          lerp(sb, tb, 0.42) * lerp(0.42, 1, hpRatio)
        );
      }
      this.buildingMesh.setColorAt(i, tempColor);
    }
    this.buildingMesh.count = count;
    this.buildingMesh.instanceMatrix.needsUpdate = true;
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
  }

  ensureProjectilePool(count) {
    while (this.projectilePool.length < count) {
      const mesh = new THREE.Mesh(this.projectileGeometry, this.projectileMaterials.attacker);
      mesh.frustumCulled = false;
      this.projectilePool.push(mesh);
      this.projectileGroup.add(mesh);
    }
  }

  updateProjectiles(projectiles) {
    const count = getSnapshotCount(projectiles);
    this.ensureProjectilePool(count);
    const data = projectiles?.data || [];
    for (let i = 0; i < this.projectilePool.length; i += 1) {
      const mesh = this.projectilePool[i];
      const visible = i < count;
      mesh.visible = visible;
      if (!visible) continue;
      const base = i * PROJECTILE_INSTANCE_STRIDE;
      const teamIndex = Number(data[base + 4]) || 0;
      const typeIndex = Number(data[base + 5]) || 0;
      const radius = Math.max(0.8, Number(data[base + 3]) || 2.2);
      mesh.material = typeIndex >= 0.5
        ? this.projectileMaterials.shell
        : (teamIndex >= 1.5
          ? this.projectileMaterials.neutral
          : (teamIndex >= 0.5 ? this.projectileMaterials.defender : this.projectileMaterials.attacker));
      mesh.position.set(Number(data[base + 0]) || 0, Number(data[base + 1]) || 0, (Number(data[base + 2]) || 0) + radius);
      mesh.scale.setScalar(radius);
    }
  }

  ensureEffectPool(count) {
    while (this.effectPool.length < count) {
      const mesh = new THREE.Mesh(this.effectGeometry, this.effectMaterials.hit);
      mesh.frustumCulled = false;
      this.effectPool.push(mesh);
      this.effectGroup.add(mesh);
    }
  }

  updateEffects(effects) {
    const count = getSnapshotCount(effects);
    this.ensureEffectPool(count);
    const data = effects?.data || [];
    for (let i = 0; i < this.effectPool.length; i += 1) {
      const mesh = this.effectPool[i];
      const visible = i < count;
      mesh.visible = visible;
      if (!visible) continue;
      const base = i * EFFECT_INSTANCE_STRIDE;
      const typeIndex = Math.round(Number(data[base + 5]) || 0);
      const hideRepeatedAura = typeIndex === 2 || typeIndex === 5 || typeIndex === 6;
      const life01 = clamp(Number(data[base + 6]) || 0, 0, 1);
      const radius = Math.max(0.6, Number(data[base + 3]) || 2.2) * lerp(1.22, 0.62, life01);
      mesh.visible = visible && !hideRepeatedAura;
      if (hideRepeatedAura) continue;
      if (typeIndex === 1) mesh.material = this.effectMaterials.explosion;
      else if (typeIndex === 2) mesh.material = this.effectMaterials.aura;
      else if (typeIndex === 3) mesh.material = this.effectMaterials.dust;
      else if (typeIndex === 4) mesh.material = this.effectMaterials.smoke;
      else if (typeIndex === 5) mesh.material = this.effectMaterials.debuffAura;
      else if (typeIndex === 6) mesh.material = this.effectMaterials.castPulse;
      else mesh.material = this.effectMaterials.hit;
      mesh.position.set(Number(data[base + 0]) || 0, Number(data[base + 1]) || 0, (Number(data[base + 2]) || 0) + radius * 0.42);
      mesh.scale.setScalar(radius);
    }
  }

  render({
    cameraState,
    snapshot,
    snapshotVersion = null,
    dynamicSnapshotVersion = snapshotVersion,
    runtime,
    skillConfirmState = null,
    debugEnabled = false
  }) {
    if (this.disposed || !cameraState || !snapshot) return;
    const hasVersion = snapshotVersion !== null
      && snapshotVersion !== undefined
      && Number.isFinite(Number(snapshotVersion));
    const snapshotChanged = !hasVersion || Number(snapshotVersion) !== this.lastSnapshotVersion;
    const hasDynamicVersion = dynamicSnapshotVersion !== null
      && dynamicSnapshotVersion !== undefined
      && Number.isFinite(Number(dynamicSnapshotVersion));
    const dynamicSnapshotChanged = !hasDynamicVersion
      || Number(dynamicSnapshotVersion) !== this.lastDynamicSnapshotVersion;
    const hasSkillInput = !!skillConfirmState?.squadId;

    this.updateCamera(cameraState);
    const groundNeedsRefresh = snapshotChanged
      || !this.groundKey
      || this.groundDebugEnabled !== debugEnabled;
    if (groundNeedsRefresh) {
      this.updateGround(runtime, { debugEnabled, refreshStaticStates: snapshotChanged });
      this.groundDebugEnabled = debugEnabled;
    }
    this.updateDeployRegionHighlights(runtime);
    if (snapshotChanged) {
      this.updateBuildings(snapshot.buildings);
    }
    if (snapshotChanged || dynamicSnapshotChanged) {
      this.updateProjectiles(snapshot.projectiles);
      this.updateEffects(snapshot.effects);
    }
    const skillVisualFocus = hasSkillInput
      ? resolveTrainingSkillVisualFocus(runtime, skillConfirmState)
      : EMPTY_SKILL_VISUAL_FOCUS;
    if (snapshotChanged || dynamicSnapshotChanged || hasSkillInput || this.hasSkillVisualFocus) {
      this.updateUnits(snapshot.units, snapshot.skillStates, skillVisualFocus, cameraState);
    }
    this.hasSkillVisualFocus = skillVisualFocus.active;
    if (snapshotChanged || hasSkillInput || this.hasActiveSkillOverlays) {
      const skillPreview = resolveTrainingSkillPreview(runtime, skillConfirmState);
      this.updateSkillPreview(runtime, skillConfirmState, skillPreview);
      this.updateMeleeAlertRegions(runtime, skillConfirmState, skillPreview);
      this.updateSkillMarkers(runtime, skillConfirmState);
      this.hasActiveSkillOverlays = hasSkillInput || !!skillPreview?.active;
    }
    this.updateDirectionMarkers(runtime, cameraState, snapshot);
    if (hasVersion) this.lastSnapshotVersion = Number(snapshotVersion);
    if (hasDynamicVersion) this.lastDynamicSnapshotVersion = Number(dynamicSnapshotVersion);
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.chibiUnitRenderer?.dispose?.();
    const disposedResources = new Set();
    disposeObject(this.scene, disposedResources);
    disposeTrainingMaterialCollection(this.skillMarkerMaterials, disposedResources);
    disposeTrainingMaterialCollection(this.projectileMaterials, disposedResources);
    disposeTrainingMaterialCollection(this.effectMaterials, disposedResources);
    this.worldFlagClothPool.forEach((entry) => {
      disposeTrainingMaterialCollection([entry?.material], disposedResources);
      disposeResource(entry?.texture, disposedResources);
    });
    this.renderer.dispose();
    this.unitMesh = null;
    this.selectedRingMesh = null;
    this.hoverFootprintOuterMesh = null;
    this.hoverFootprintInnerMesh = null;
    this.directionArcMesh = null;
    this.worldFlagPoleMesh = null;
    this.worldFlagFinialMesh = null;
    this.worldFlagClothPool = [];
    this.worldFlagHitRects = [];
    this.skillPreviewTargetRingMesh = null;
    this.skillPreviewTargetDiscMesh = null;
    this.meleeAlertMesh = null;
    this.skillMarkerPool = [];
    this.skillMarkerMaterials = {};
    this.buildingMesh = null;
    this.projectilePool = [];
    this.effectPool = [];
    this.projectileMaterials = {};
    this.effectMaterials = {};
    this.mapStaticPlaceholderGroup = null;
    this.groundKey = '';
    this.groundDebugEnabled = null;
  }
}
