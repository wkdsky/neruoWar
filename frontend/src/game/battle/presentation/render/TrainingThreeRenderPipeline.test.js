import * as THREE from 'three';
import {
  createTrainingDirectionArcMaterial,
  createTrainingDirectionArcGeometry,
  createTrainingFlagClothGeometry,
  prepareInstanceColorGeometry,
  resolveTrainingDirectionArcAnchors,
  resolveTrainingFlagLod,
  resolveTrainingWorldFlagScreenScale,
  resolveTrainingWorldFlagDimensions,
  TRAINING_WORLD_FLAG_MAX_PITCH_DEG,
  TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT,
  TRAINING_DIRECTION_ARC_GROUND_ELEVATION
} from './TrainingThreeRenderPipeline';

describe('training direction markers', () => {
  test('hard switches between the world flag and the distant information label at 50 degrees', () => {
    expect(resolveTrainingFlagLod(TRAINING_WORLD_FLAG_MAX_PITCH_DEG)).toEqual({
      worldFlag: true,
      infoLabel: false
    });
    expect(resolveTrainingFlagLod(TRAINING_WORLD_FLAG_MAX_PITCH_DEG + 0.01)).toEqual({
      worldFlag: false,
      infoLabel: true
    });
  });

  test('creates one direction arc per visible squad without requiring a flag bearer agent', () => {
    const anchors = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      getTrainingState: () => ({ points: 7 }),
      sim: {
        squads: [
          { id: 'blue', team: 'attacker', remain: 30, x: -140, y: 20, radius: 18, flagBearerAgentId: '' },
          { id: 'red', team: 'defender', remain: 24, x: 160, y: -12, radius: 16, flagBearerAgentId: '' },
          { id: 'hidden', team: 'defender', remain: 24, x: 260, y: 0, hiddenFromAttacker: true }
        ]
      }
    });

    expect(anchors).toHaveLength(2);
    expect(anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: -140, y: 20, teamIndex: 0, remain: 30, startCount: 30, skillPoints: 7 }),
      expect.objectContaining({ x: 160, y: -12, teamIndex: 1 })
    ]));
    expect(anchors.every((anchor) => (
      anchor.arcLayout?.bulgeDepth > 0
      && anchor.poleHeight > anchor.clothHeight
      && anchor.clothBottom > 0
    ))).toBe(true);
  });

  test('aligns the arc forward with the squad movement direction', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      sim: {
        squads: [
          { id: 'northbound', team: 'attacker', remain: 20, x: 0, y: 0, dirX: 0, dirY: 1 }
        ]
      }
    });

    expect(anchor.yaw).toBeCloseTo(Math.PI / 2);
  });

  test('highlights the selected battle direction arc while it is ready to drag', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      selectedBattleSquadId: 'northbound',
      hoveredDeployDirectionArcId: 'northbound',
      sim: {
        squads: [
          {
            id: 'northbound',
            team: 'attacker',
            remain: 20,
            x: 0,
            y: 0,
            formationRect: { width: 60, depth: 16, facingRad: 0, directionOffsetRad: Math.PI / 2 }
          }
        ]
      }
    });

    expect(anchor).toMatchObject({ selected: true, hovered: true });
    expect(anchor.yaw).toBeCloseTo(Math.PI / 2);
  });

  test('uses the edited deployment formation facing before battle starts', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'deploy',
      attackerDeployGroups: [
        {
          id: 'turned-line',
          team: 'attacker',
          placed: true,
          remain: 20,
          x: 0,
          y: 0,
          dirX: 1,
          dirY: 0,
          formationRect: { width: 60, depth: 16, facingRad: Math.PI / 2 }
        }
      ]
    });

    expect(anchor.yaw).toBeCloseTo(Math.PI / 2);
  });

  test('keeps the real flag wide enough for readable battlefield data', () => {
    const dimensions = resolveTrainingWorldFlagDimensions({ remain: 5_408, radius: 126 });

    expect(dimensions.clothHeight).toBeGreaterThanOrEqual(17);
    expect(dimensions.clothWidth).toBeGreaterThanOrEqual(36);
    expect(dimensions.clothWidth / dimensions.clothHeight).toBeLessThan(2.2);
    expect(dimensions.clothBottom).toBeLessThanOrEqual(3);
    expect(dimensions.clothBottom + dimensions.clothHeight).toBeLessThan(dimensions.poleHeight);
  });

  test('keeps the world flag at a stable screen height across camera depths', () => {
    const clothHeight = 20;
    const viewportHeight = 800;
    const nearViewHeight = 240;
    const distantViewHeight = 480;
    const nearScale = resolveTrainingWorldFlagScreenScale({
      clothHeight,
      viewHeight: nearViewHeight,
      viewportHeight
    });
    const distantScale = resolveTrainingWorldFlagScreenScale({
      clothHeight,
      viewHeight: distantViewHeight,
      viewportHeight
    });
    const nearPixels = (clothHeight * nearScale / nearViewHeight) * viewportHeight;
    const distantPixels = (clothHeight * distantScale / distantViewHeight) * viewportHeight;
    const tiltedScale = resolveTrainingWorldFlagScreenScale({
      clothHeight,
      viewHeight: distantViewHeight,
      viewportHeight,
      verticalScreenFactor: 0.65
    });

    expect(distantScale).toBeCloseTo(nearScale * 2, 6);
    expect(distantPixels).toBeCloseTo(nearPixels, 6);
    expect(nearPixels).toBeCloseTo(TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT, 6);
    expect(tiltedScale).toBeGreaterThan(distantScale);
  });
});

describe('prepareInstanceColorGeometry', () => {
  test('provides a white geometry color baseline for instance colors', () => {
    const geometry = prepareInstanceColorGeometry(new THREE.BoxGeometry(1, 1, 1));
    const colors = geometry.getAttribute('color');

    expect(colors.count).toBe(geometry.getAttribute('position').count);
    expect(Array.from(colors.array).every((value) => value === 1)).toBe(true);
  });

  test('creates a curved, vertex-colored direction ribbon instead of an arrow or rectangle marker', () => {
    const geometry = createTrainingDirectionArcGeometry();
    const positions = geometry.getAttribute('position');
    const xValues = Array.from({ length: positions.count }, (_, index) => positions.getX(index));
    const yValues = Array.from({ length: positions.count }, (_, index) => positions.getY(index));

    expect(Math.max(...xValues)).toBeGreaterThan(0.99);
    expect(Math.max(...yValues)).toBeGreaterThan(0.9);
    expect(Math.min(...yValues)).toBeLessThan(-0.9);
    expect(geometry.getAttribute('color').count).toBe(positions.count);
    Array.from({ length: positions.count }, (_, index) => positions.getZ(index))
      .forEach((z) => expect(z).toBeCloseTo(TRAINING_DIRECTION_ARC_GROUND_ELEVATION, 6));
  });

  test('keeps the direction arc on the ground and behind opaque soldiers', () => {
    const material = createTrainingDirectionArcMaterial();

    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    material.dispose();
  });

  test('creates an upright cloth shape fixed to a flagpole edge', () => {
    const geometry = createTrainingFlagClothGeometry();
    const positions = geometry.getAttribute('position');
    const xValues = Array.from({ length: positions.count }, (_, index) => positions.getX(index));
    const yValues = Array.from({ length: positions.count }, (_, index) => positions.getY(index));
    const zValues = Array.from({ length: positions.count }, (_, index) => positions.getZ(index));

    expect(Math.min(...xValues)).toBeCloseTo(0);
    expect(Math.max(...xValues)).toBeCloseTo(1);
    expect(Math.max(...yValues)).toBeCloseTo(0);
    expect(Math.min(...zValues)).toBeCloseTo(0);
    expect(Math.max(...zValues)).toBeCloseTo(1);
  });
});
