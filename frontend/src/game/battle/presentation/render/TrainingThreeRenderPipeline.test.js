import * as THREE from 'three';
import CameraController from './CameraController';
import TrainingThreeRenderPipeline from './TrainingThreeRenderPipeline';
import { UNIT_INSTANCE_STRIDE } from '../snapshot/BattleSnapshotSchema';
import {
  createTrainingDirectionArcMaterial,
  createTrainingDirectionArcGeometry,
  disposeTrainingMaterialCollection,
  createTrainingHighlandMesh,
  createTrainingDeployRegionHighlightMesh,
  createTrainingTerrainEdgeMesh,
  createTrainingMapStaticPlaceholderMesh,
  createTrainingFlagClothGeometry,
  prepareInstanceColorGeometry,
  resolveTrainingDirectionArcAnchors,
  resolveTrainingRenderedSquadAnchors,
  resolveTrainingMeleeAlertRect,
  resolveTrainingSkillMarkerCategory,
  resolveTrainingSkillVisualFocus,
  resolveTrainingSkillPreview,
  resolveTrainingHoverPresentation,
  resolveTrainingHoverFootprint,
  resolveTrainingDeployHighlightTeams,
  resolveTrainingTerrainDepthOptions,
  resolveTrainingWorldFlagHitRects,
  pickTrainingWorldFlagId,
  resolveTrainingFlagLod,
  resolveTrainingFlagCanvasTheme,
  resolveTrainingWorldFlagStackLayout,
  resolveTrainingWorldFlagStackLevels,
  resolveTrainingWorldFlagScreenScale,
  resolveTrainingWorldFlagDimensions,
  resolveTrainingFlagShowsSkillPoints,
  shouldRenderTrainingUnitGroundMarker,
  createTrainingOrdinaryWallMesh,
  resolveTrainingWallPathOutline,
  resolveTrainingWallVisualThickness,
  isTrainingMapStaticPlaceholder,
  applyTrainingMapStaticPlaceholderState,
  applyTrainingAttackRangeMarkerState,
  updateTrainingDirectionArcGeometry,
  TRAINING_WORLD_FLAG_MAX_PITCH_DEG,
  TRAINING_WORLD_FLAG_TARGET_SCREEN_HEIGHT,
  TRAINING_DIRECTION_ARC_GROUND_ELEVATION
} from './TrainingThreeRenderPipeline';

describe('training terrain depth composition', () => {
  test('gives sand and roads deterministic offsets above the grass base', () => {
    expect(resolveTrainingTerrainDepthOptions('grass')).toEqual({
      polygonOffset: false,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 0
    });
    expect(resolveTrainingTerrainDepthOptions({ type: 'sand' })).toEqual({
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    expect(resolveTrainingTerrainDepthOptions({ type: 'road' })).toEqual({
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
  });

  test('uses distinct soft-edge widths while retaining separate terrain cores', () => {
    const baseRegion = { shape: 'rect', x: 0, y: 0, width: 120, height: 80 };
    const grass = createTrainingTerrainEdgeMesh({ ...baseRegion, id: 'grass', type: 'grass' }, 0x294533);
    const sand = createTrainingTerrainEdgeMesh({ ...baseRegion, id: 'sand', type: 'sand' }, 0x6b432a);
    const road = createTrainingTerrainEdgeMesh({ ...baseRegion, id: 'road', type: 'road' }, 0x655943);

    expect(sand.geometry.parameters.width).toBeGreaterThan(grass.geometry.parameters.width);
    expect(grass.geometry.parameters.width).toBeGreaterThan(road.geometry.parameters.width);
    expect(sand.material.uniforms.edgeOpacity.value).not.toBe(road.material.uniforms.edgeOpacity.value);

    [grass, sand, road].forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  });
});

describe('training map ordinary wall geometry', () => {
  test('preserves an angled source path as a continuous extruded-wall outline', () => {
    const outline = resolveTrainingWallPathOutline([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }
    ], 20);

    expect(outline).toHaveLength(6);
    expect(outline[0]).toEqual({ x: 0, y: 10 });
    expect(outline[1].x).toBeCloseTo(90);
    expect(outline[1].y).toBeCloseTo(10);
    expect(outline[2]).toEqual({ x: 90, y: 100 });
    expect(outline[3]).toEqual({ x: 110, y: 100 });
    expect(outline[4].x).toBeCloseTo(110);
    expect(outline[4].y).toBeCloseTo(-10);
    expect(outline[5]).toEqual({ x: 0, y: -10 });
  });

  test('keeps thin-barrier display thickness independent from its movement collider', () => {
    expect(resolveTrainingWallVisualThickness({
      wallType: 'thinBarrier',
      width: 180,
      depth: 120,
      collider: { parts: [{ d: 24 }, { d: 28 }, { d: 24 }] }
    })).toBe(10);
    expect(resolveTrainingWallVisualThickness({
      wallType: 'thickWall',
      collider: { parts: [{ d: 24 }, { d: 28 }, { d: 24 }] }
    })).toBe(24);
  });

  test('builds a narrow framed barrier from the ordinary wall source path', () => {
    const mesh = createTrainingOrdinaryWallMesh({
      objectId: 'curved-wall',
      height: 34,
      visualPath: [{ x: -80, y: 0 }, { x: 0, y: 24 }, { x: 80, y: 0 }],
      collider: { parts: [{ d: 24 }, { d: 24 }] }
    });

    expect(mesh.name).toBe('training-ordinary-wall-curved-wall');
    expect(mesh).toBeInstanceOf(THREE.Group);
    expect(mesh.userData.visualThickness).toBeLessThan(mesh.userData.collisionThickness);
    const panel = mesh.getObjectByName('training-ordinary-wall-curved-wall-panel');
    expect(panel.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(panel.material.color.getHex()).not.toBe(0x211b16);
    expect(new THREE.Box3().setFromObject(mesh).max.z).toBeGreaterThan(33);
    const disposedResources = new Set();
    mesh.traverse((child) => {
      if (child.geometry && !disposedResources.has(child.geometry)) {
        disposedResources.add(child.geometry);
        child.geometry.dispose();
      }
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material && !disposedResources.has(material)) {
          disposedResources.add(material);
          material.dispose();
        }
      });
    });
  });

  test('extrudes a filled crescent outline as a vision-blocking thick wall', () => {
    const mesh = createTrainingOrdinaryWallMesh({
      objectId: 'crescent-wall',
      wallType: 'thickWall',
      height: 52,
      visualOutline: [
        { x: -80, y: 0 },
        { x: -52, y: -56 },
        { x: 4, y: -76 },
        { x: 44, y: -42 },
        { x: 16, y: -28 },
        { x: -10, y: 0 },
        { x: 16, y: 28 },
        { x: 44, y: 42 },
        { x: 4, y: 76 },
        { x: -52, y: 56 }
      ],
      collider: { parts: [{ d: 56 }] }
    });

    expect(mesh.name).toBe('training-thick-wall-crescent-wall');
    expect(mesh.userData.wallType).toBe('thickWall');
    expect(mesh.material.color.getHex()).toBe(0x46525c);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox.max.z).toBeGreaterThan(51);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  test('uses smooth bezier curves for reference crescent walls', () => {
    const mesh = createTrainingOrdinaryWallMesh({
      objectId: 'smooth-crescent-wall',
      wallType: 'thickWall',
      height: 52,
      bezierOutline: {
        start: { x: -80, y: 0 },
        segments: [
          {
            controlPoint1: { x: -72, y: -54 },
            controlPoint2: { x: -22, y: -78 },
            end: { x: 28, y: -42 }
          },
          {
            controlPoint1: { x: 42, y: -30 },
            controlPoint2: { x: 54, y: -8 },
            end: { x: 54, y: 0 }
          },
          {
            controlPoint1: { x: 38, y: 12 },
            controlPoint2: { x: 16, y: 24 },
            end: { x: -8, y: 22 }
          },
          {
            controlPoint1: { x: -30, y: 20 },
            controlPoint2: { x: -48, y: 12 },
            end: { x: -80, y: 0 }
          }
        ]
      },
      collider: { parts: [{ d: 40 }] }
    });

    expect(mesh).not.toBeNull();
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox.max.z).toBeGreaterThan(51);
    expect(mesh.geometry.attributes.position.count).toBeGreaterThan(100);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});

describe('training render resource cleanup', () => {
  test('disposes detached material variants and their textures exactly once', () => {
    const sharedTexture = new THREE.Texture();
    const detachedTexture = new THREE.Texture();
    const sharedMaterial = new THREE.SpriteMaterial({ map: sharedTexture });
    const detachedMaterial = new THREE.SpriteMaterial({ map: detachedTexture });
    const sharedTextureDisposed = jest.fn();
    const detachedTextureDisposed = jest.fn();
    const sharedMaterialDisposed = jest.fn();
    const detachedMaterialDisposed = jest.fn();
    sharedTexture.addEventListener('dispose', sharedTextureDisposed);
    detachedTexture.addEventListener('dispose', detachedTextureDisposed);
    sharedMaterial.addEventListener('dispose', sharedMaterialDisposed);
    detachedMaterial.addEventListener('dispose', detachedMaterialDisposed);

    const disposedResources = disposeTrainingMaterialCollection({
      active: sharedMaterial,
      duplicate: sharedMaterial,
      neverAttached: detachedMaterial
    });

    expect(disposedResources.size).toBe(4);
    expect(sharedTextureDisposed).toHaveBeenCalledTimes(1);
    expect(detachedTextureDisposed).toHaveBeenCalledTimes(1);
    expect(sharedMaterialDisposed).toHaveBeenCalledTimes(1);
    expect(detachedMaterialDisposed).toHaveBeenCalledTimes(1);
  });
});

describe('training map highland geometry', () => {
  test('builds an elevated platform with three vertex ramps and diagonal railings', () => {
    const mesh = createTrainingHighlandMesh({
      id: 'attacker-top',
      z: 0.08,
      elevation: 28,
      points: [{ x: -100, y: -100 }, { x: 100, y: 0 }, { x: -100, y: 100 }]
    }, 0x58272d);

    expect(mesh.name).toBe('training-highland-attacker-top');
    expect(mesh.position.z).toBeCloseTo(0.08);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox.max.z).toBeCloseTo(28);
    expect(mesh.getObjectByName('training-highland-ramp-ramp-1')).toBeTruthy();
    expect(mesh.getObjectByName('training-highland-ramp-ramp-2')).toBeTruthy();
    expect(mesh.getObjectByName('training-highland-ramp-ramp-3')).toBeTruthy();
    expect(mesh.getObjectByName('training-highland-rail-1')).toBeTruthy();
    expect(mesh.getObjectByName('training-highland-rail-2')).toBeTruthy();
    mesh.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });

  test('keeps both edge ramps and adds a flared trapezoid across the battle-facing side', () => {
    const mesh = createTrainingHighlandMesh({
      id: 'attacker-front-ramp',
      elevation: 28,
      points: [
        { x: -100, y: 100 },
        { x: -50, y: 100 },
        { x: -60, y: 80 },
        { x: -30, y: 55 },
        { x: 40, y: 85 },
        { x: 40, y: -85 },
        { x: -30, y: -55 },
        { x: -60, y: -80 },
        { x: -50, y: -100 },
        { x: -100, y: -100 }
      ],
      ramps: [
        {
          id: 'upper-outward-road-ramp',
          vertexIndex: 0,
          points: [
            { x: -100, y: 100 },
            { x: -100, y: 80 },
            { x: -60, y: 80 },
            { x: -50, y: 100 }
          ]
        },
        {
          id: 'front-outward-trapezoid-ramp',
          vertexIndex: 1,
          points: [
            { x: 40, y: 85 },
            { x: -30, y: 55 },
            { x: -30, y: -55 },
            { x: 40, y: -85 }
          ]
        },
        {
          id: 'lower-outward-road-ramp',
          vertexIndex: 2,
          points: [
            { x: -100, y: -100 },
            { x: -100, y: -80 },
            { x: -60, y: -80 },
            { x: -50, y: -100 }
          ]
        }
      ],
      topPolygons: [[
        { x: -100, y: 80 },
        { x: -60, y: 80 },
        { x: -30, y: 55 },
        { x: -30, y: -55 },
        { x: -60, y: -80 },
        { x: -100, y: -80 }
      ]],
      railingPaths: [
        [{ x: -60, y: 80 }, { x: -45, y: 70 }, { x: -30, y: 55 }],
        [{ x: -30, y: -55 }, { x: -45, y: -70 }, { x: -60, y: -80 }]
      ]
    }, 0x58272d);

    expect(mesh.userData.ramps).toHaveLength(3);
    mesh.userData.ramps.forEach((ramp) => expect(ramp.points).toHaveLength(4));
    expect(mesh.userData.topPolygons).toHaveLength(1);
    expect(mesh.userData.topPolygons[0]).toEqual([
      { x: -100, y: 80 },
      { x: -60, y: 80 },
      { x: -30, y: 55 },
      { x: -30, y: -55 },
      { x: -60, y: -80 },
      { x: -100, y: -80 }
    ]);
    expect(mesh.getObjectByName('training-highland-rail-1')).toBeTruthy();
    expect(mesh.getObjectByName('training-highland-rail-2')).toBeTruthy();
    const upperSideRampMesh = mesh.getObjectByName('training-highland-ramp-upper-outward-road-ramp');
    const rampMesh = mesh.getObjectByName('training-highland-ramp-front-outward-trapezoid-ramp');
    const lowerSideRampMesh = mesh.getObjectByName('training-highland-ramp-lower-outward-road-ramp');
    expect(upperSideRampMesh).toBeTruthy();
    expect(rampMesh).toBeTruthy();
    expect(lowerSideRampMesh).toBeTruthy();
    const upperSidePositions = upperSideRampMesh.geometry.getAttribute('position');
    const lowerSidePositions = lowerSideRampMesh.geometry.getAttribute('position');
    [upperSidePositions, lowerSidePositions].forEach((positions) => {
      expect(positions.count).toBe(6);
      expect(positions.getZ(0)).toBeCloseTo(0);
      expect(positions.getZ(4)).toBeCloseTo(28);
    });
    expect(upperSidePositions.getY(0)).toBeGreaterThan(upperSidePositions.getY(4));
    expect(lowerSidePositions.getY(0)).toBeLessThan(lowerSidePositions.getY(4));
    const rampPositions = rampMesh.geometry.getAttribute('position');
    expect(rampPositions.count).toBe(6);
    expect(rampPositions.getZ(0)).toBeCloseTo(0);
    expect(rampPositions.getZ(3)).toBeCloseTo(0);
    expect(rampPositions.getZ(4)).toBeCloseTo(28);
    expect(rampPositions.getZ(5)).toBeCloseTo(28);
    expect(rampPositions.getX(0)).toBeGreaterThan(rampPositions.getX(4));
    expect(rampPositions.getX(3)).toBeGreaterThan(rampPositions.getX(5));
    expect(Math.abs(rampPositions.getY(0) - rampPositions.getY(3))).toBeGreaterThan(
      Math.abs(rampPositions.getY(4) - rampPositions.getY(5))
    );
    mesh.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });

  test('curves a railing along the matching highland edge path', () => {
    const railingPath = [
      { x: -56, y: 78 },
      { x: -0.845, y: 55.154 },
      { x: 22, y: 0 },
      { x: -0.845, y: -55.154 },
      { x: -56, y: -78 }
    ];
    const mesh = createTrainingHighlandMesh({
      id: 'attacker-curved-edge',
      elevation: 28,
      points: [{ x: -100, y: 78 }, ...railingPath, { x: -100, y: -78 }],
      topPolygons: [[{ x: -100, y: 78 }, ...railingPath, { x: -100, y: -78 }]],
      railingPaths: [railingPath]
    }, 0x58272d);

    const rail = mesh.getObjectByName('training-highland-rail-1');
    expect(rail).toBeTruthy();
    expect(mesh.getObjectByName('training-highland-rail-2')).toBeFalsy();
    expect(rail.getObjectByName('training-highland-rail-1-bar-1').geometry.type).toBe('TubeGeometry');
    const posts = rail.children.filter((entry) => entry.name.includes('-post-'));
    expect(posts[0].position.x).toBeCloseTo(railingPath[0].x);
    expect(posts[0].position.y).toBeCloseTo(railingPath[0].y);
    expect(posts[posts.length - 1].position.x).toBeCloseTo(railingPath[railingPath.length - 1].x);
    expect(posts[posts.length - 1].position.y).toBeCloseTo(railingPath[railingPath.length - 1].y);
    mesh.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });

  test('raises direction arcs with their highland anchors', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      sim: { squads: [{ id: 'highland-squad', team: 'attacker', remain: 20, x: 0, y: 0 }] }
    });
    const geometry = createTrainingDirectionArcGeometry([]);
    updateTrainingDirectionArcGeometry(geometry, [{ ...anchor, groundElevation: 28, color: [1, 1, 1] }]);

    expect(geometry.getAttribute('position').getZ(0)).toBeCloseTo(28 + TRAINING_DIRECTION_ARC_GROUND_ELEVATION);
    geometry.dispose();
  });

  test('builds a team-colored overlay for a deployable highland region', () => {
    const mapConfig = {
      terrainRegions: [{
        id: 'attacker-highland',
        type: 'highland-attacker',
        shape: 'polygon',
        z: 0.08,
        elevation: 28,
        points: [{ x: -120, y: -120 }, { x: 120, y: 0 }, { x: -120, y: 120 }]
      }]
    };
    const mesh = createTrainingDeployRegionHighlightMesh({
      id: 'attacker-top',
      team: 'attacker',
      polygon: [{ x: -100, y: -100 }, { x: 100, y: 0 }, { x: -100, y: 100 }]
    }, mapConfig);

    expect(mesh.name).toBe('training-deploy-region-highlight-attacker-top');
    expect(mesh.userData).toMatchObject({ team: 'attacker', spawnRegionId: 'attacker-top' });
    expect(mesh.getObjectByName('training-deploy-region-highlight-attacker-top-outline')).toBeTruthy();
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox.min.z).toBeGreaterThan(28);
    mesh.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });

  test('shows only the highland team with an active placement', () => {
    expect(resolveTrainingDeployHighlightTeams({
      getPhase: () => 'deploy',
      getDeployGroups: () => ({
        attacker: [{ id: 'attacker-pending', placed: false, placementActive: true }],
        defender: [{ id: 'defender-staged', placed: false, placementActive: false }]
      })
    })).toEqual(['attacker']);
  });
});

describe('training map static objective placeholders', () => {
  test('renders a team-colored octagonal tower on its terrain surface', () => {
    const tower = createTrainingMapStaticPlaceholderMesh({
      objectId: 'tower-defender-mid',
      mapStatic: true,
      category: 'tower',
      team: 'defender',
      x: 120,
      y: -48,
      width: 64,
      depth: 64,
      height: 96,
      maxHp: 2200,
      attackRange: 188
    }, 28);

    expect(isTrainingMapStaticPlaceholder({ mapStatic: true, category: 'tower' })).toBe(true);
    expect(tower.name).toBe('training-map-placeholder-tower-defender-mid');
    expect(tower.position).toMatchObject({ x: 120, y: -48, z: 28 });
    expect(tower.children).toHaveLength(6);
    expect(tower.getObjectByName('training-map-placeholder-tower-defender-mid-octagon-body').geometry.type).toBe('CylinderGeometry');
    expect(tower.getObjectByName('training-map-placeholder-tower-defender-mid-attack-range').visible).toBe(false);
    const healthBar = tower.getObjectByName('training-map-placeholder-tower-defender-mid-structure-health-bar');
    expect(healthBar.userData).toMatchObject({
      structureHealthBar: true,
      barKind: 'tower-durability',
      team: 'defender'
    });
    expect(applyTrainingMapStaticPlaceholderState(tower, { hp: 1100, maxHp: 2200 })).toBe(true);
    expect(tower.userData.hpRatio).toBeCloseTo(0.5);
    expect(healthBar.userData.signature).toContain('1100:2200');
    expect(applyTrainingMapStaticPlaceholderState(tower, { hp: 0, maxHp: 2200 })).toBe(false);
    expect(tower.visible).toBe(false);
    tower.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });

  test('does not create a static neutral-camp model alongside real troops', () => {
    const camp = createTrainingMapStaticPlaceholderMesh({
      objectId: 'camp-center-north',
      mapStatic: true,
      category: 'neutralCamp',
      x: 0,
      y: 260,
      width: 72,
      depth: 72,
      height: 48,
      neutralPatrolPreview: true,
      neutralPatrolDirectionRad: Math.PI / 2,
      neutralPatrolPreviewLength: 44,
      neutralComposition: [
        { unitCategory: 'melee' },
        { unitCategory: 'ranged' },
        { unitCategory: 'support' }
      ]
    });

    expect(isTrainingMapStaticPlaceholder({ mapStatic: true, category: 'neutralCamp' })).toBe(false);
    expect(camp).toBeNull();
  });

  test('renders a low rectangular highland barracks with a permanent range marker', () => {
    const barracks = createTrainingMapStaticPlaceholderMesh({
      objectId: 'barracks-attacker-top',
      mapStatic: true,
      category: 'barracks',
      team: 'attacker',
      x: -320,
      y: 120,
      width: 84,
      depth: 52,
      height: 18,
      maxHp: 5600,
      attackRange: 630,
      rangeIndicatorColor: '#ef4b55',
      rangeIndicatorMode: 'always'
    }, 28);

    expect(isTrainingMapStaticPlaceholder({ mapStatic: true, category: 'barracks' })).toBe(true);
    expect(barracks.position).toMatchObject({ x: -320, y: 120, z: 28 });
    expect(barracks.getObjectByName('training-map-placeholder-barracks-attacker-top-body')).toBeTruthy();
    expect(barracks.getObjectByName('training-map-placeholder-barracks-attacker-top-arrow-tower')).toBeFalsy();
    expect(barracks.getObjectByName('training-map-placeholder-barracks-attacker-top-catapult-arm')).toBeFalsy();
    expect(barracks.getObjectByName('training-map-placeholder-barracks-attacker-top-attack-range')).toBeTruthy();
    expect(barracks.getObjectByName('training-map-placeholder-barracks-attacker-top-attack-range').visible).toBe(true);
    barracks.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });

  test('keeps a highland outpost range visible without a target lock', () => {
    const tower = createTrainingMapStaticPlaceholderMesh({
      objectId: 'outpost-attacker-top-upper',
      mapStatic: true,
      category: 'tower',
      defenseRole: 'highlandOutpost',
      team: 'attacker',
      width: 48,
      depth: 48,
      height: 82,
      attackRange: 260,
      rangeIndicatorColor: '#53dff0',
      rangeIndicatorMode: 'always'
    });

    expect(tower.getObjectByName('training-map-placeholder-outpost-attacker-top-upper-attack-range').visible).toBe(true);
    tower.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });

  test('uses a ghost range until a regular tower locks an approaching enemy', () => {
    const tower = createTrainingMapStaticPlaceholderMesh({
      objectId: 'tower-attacker-mid',
      mapStatic: true,
      category: 'tower',
      team: 'attacker',
      width: 32,
      depth: 32,
      height: 96,
      attackRange: 188,
      rangeIndicatorMode: 'proximity'
    });
    const attackRange = tower.getObjectByName('training-map-placeholder-tower-attacker-mid-attack-range');
    const rangeContainer = attackRange.parent;
    const ghostOutline = rangeContainer.getObjectByName('training-map-placeholder-tower-attacker-mid-attack-range-ghost-outline');

    expect(rangeContainer.visible).toBe(true);
    expect(rangeContainer.userData.attackRangeActive).toBe(false);
    expect(attackRange.visible).toBe(false);
    expect(ghostOutline.visible).toBe(true);

    expect(applyTrainingAttackRangeMarkerState(rangeContainer, true)).toBe(true);
    expect(rangeContainer.userData.attackRangeActive).toBe(true);
    expect(attackRange.visible).toBe(true);
    expect(ghostOutline.visible).toBe(false);

    tower.traverse((entry) => {
      entry.geometry?.dispose?.();
      entry.material?.dispose?.();
    });
  });
});

describe('training direction markers', () => {
  test('uses red, blue, and yellow themes for attacker, defender, and neutral flags', () => {
    expect(resolveTrainingFlagCanvasTheme('attacker')).toMatchObject({ accent: '#f87171' });
    expect(resolveTrainingFlagCanvasTheme('defender')).toMatchObject({ accent: '#7dd3fc' });
    expect(resolveTrainingFlagCanvasTheme('neutral')).toMatchObject({ accent: '#fde68a' });
  });

  test('keeps neutral flags focused on troops and suppresses their ground markers', () => {
    expect(resolveTrainingFlagShowsSkillPoints({ team: 'attacker' })).toBe(true);
    expect(resolveTrainingFlagShowsSkillPoints({ team: 'attacker', isMinionWaveUnit: true })).toBe(false);
    expect(resolveTrainingFlagShowsSkillPoints({ team: 'neutral', skillPoints: 99 })).toBe(false);
    expect(shouldRenderTrainingUnitGroundMarker(0)).toBe(true);
    expect(shouldRenderTrainingUnitGroundMarker(1)).toBe(true);
    expect(shouldRenderTrainingUnitGroundMarker(2)).toBe(false);
  });

  test('anchors a neutral flag to the same rendered snapshot as its moving soldiers', () => {
    const unitData = new Float32Array(UNIT_INSTANCE_STRIDE * 2);
    unitData[0] = 96;
    unitData[1] = -36;
    unitData[UNIT_INSTANCE_STRIDE] = 144;
    unitData[UNIT_INSTANCE_STRIDE + 1] = -12;
    unitData[UNIT_INSTANCE_STRIDE + 13] = 1;
    const runtime = {
      getPhase: () => 'battle',
      sim: {
        squads: [{
          id: 'neutral-center',
          team: 'neutral',
          remain: 17,
          startCount: 17,
          x: -420,
          y: 260
        }]
      },
      crowd: {
        allAgents: [
          { id: 'neutral-1', squadId: 'neutral-center', team: 'neutral', weight: 1 },
          { id: 'neutral-2', squadId: 'neutral-center', team: 'neutral', weight: 1 }
        ]
      }
    };
    const snapshot = {
      unitSquadIds: ['neutral-center', 'neutral-center'],
      units: { count: 2, data: unitData }
    };

    const renderedSquadAnchors = resolveTrainingRenderedSquadAnchors(runtime, snapshot);
    const [anchor] = resolveTrainingDirectionArcAnchors(runtime, renderedSquadAnchors);

    expect(anchor).toMatchObject({
      id: 'neutral-center',
      team: 'neutral',
      x: 144,
      y: -12
    });
  });

  test('anchors a pre-start neutral flag to its preview flag bearer', () => {
    const anchors = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'deploy',
      getTrainingNeutralPreview: () => ({
        squads: [{
          id: 'neutral_camp_preview',
          team: 'neutral',
          name: '预览守卫',
          remain: 120,
          startCount: 120,
          x: 12,
          y: 18
        }],
        agents: [
          {
            id: 'preview-flag-bearer',
            squadId: 'neutral_camp_preview',
            team: 'neutral',
            weight: 40,
            isFlagBearer: true,
            x: 28,
            y: 34
          },
          {
            id: 'preview-guard',
            squadId: 'neutral_camp_preview',
            team: 'neutral',
            weight: 40,
            x: 8,
            y: 14
          }
        ]
      })
    });

    expect(anchors).toEqual([expect.objectContaining({
      id: 'neutral_camp_preview',
      team: 'neutral',
      x: 28,
      y: 34,
      showSkillPoints: false
    })]);
  });

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

  test('assigns overlapping world flags to descending vertical stack levels', () => {
    const levels = resolveTrainingWorldFlagStackLevels([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 1 },
      { id: 'c', x: 500, y: 0 }
    ], (anchor) => ({
      x: anchor.x,
      y: anchor.y,
      visible: true
    }));

    expect(levels.a).toBe(1);
    expect(levels.b).toBe(0);
    expect(levels.c).toBe(0);
  });

  test('keeps the nearest overlapping flag as the only visible pole owner', () => {
    const layout = resolveTrainingWorldFlagStackLayout([
      { id: 'rear', x: 0, y: 0 },
      { id: 'front', x: 2, y: 1 }
    ], (anchor) => ({
      x: anchor.x,
      y: anchor.y,
      distance: anchor.id === 'front' ? 20 : 80,
      visible: true
    }));

    expect(layout.leaderById.rear).toBe('front');
    expect(layout.leaderById.front).toBe('front');
    expect(layout.maxLevelByLeader.front).toBe(1);
  });

  test('creates one direction arc per visible squad without requiring a flag bearer agent', () => {
    const anchors = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      getTrainingState: () => ({ points: 7 }),
      sim: {
        squads: [
          { id: 'blue', team: 'attacker', remain: 30, x: -140, y: 20, radius: 18, flagBearerAgentId: '' },
          { id: 'red', team: 'defender', remain: 24, x: 160, y: -12, radius: 16, flagBearerAgentId: '' },
          { id: 'neutral', team: 'neutral', remain: 18, x: 0, y: 48, radius: 14, flagBearerAgentId: '' },
          { id: 'hidden', team: 'defender', remain: 24, x: 260, y: 0, hiddenFromAttacker: true }
        ]
      }
    });

    expect(anchors).toHaveLength(3);
    expect(anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: -140, y: 20, teamIndex: 0, remain: 30, startCount: 30, skillPoints: 7 }),
      expect.objectContaining({ x: 160, y: -12, teamIndex: 1 }),
      expect.objectContaining({ x: 0, y: 48, teamIndex: 2, skillPoints: 0, showSkillPoints: false })
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

  test('marks the hovered squad flag independently from the direction arc hover', () => {
    const [anchor] = resolveTrainingDirectionArcAnchors({
      getPhase: () => 'battle',
      hoveredBattleSquadId: 'northbound',
      hoveredDeployDirectionArcId: '',
      sim: {
        squads: [{ id: 'northbound', team: 'attacker', remain: 20, x: 0, y: 0 }]
      }
    });

    expect(anchor).toMatchObject({ flagHovered: true, hovered: false });
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

  test('excludes minion waves from world flags while keeping ordinary squad flags', () => {
    const rects = resolveTrainingWorldFlagHitRects({
      anchors: [
        { id: 'regular', x: 0, y: 0, remain: 72, radius: 26 },
        { id: 'minion', x: 40, y: 0, remain: 72, radius: 26, isMinionWaveUnit: true }
      ],
      camera: {
        currentPitch: 40,
        eye: [0, -560, 360],
        target: [0, 0, 0]
      },
      project: (point) => ({ x: 500 + point.x, y: 420 - point.y - point.z, visible: true }),
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });

    expect(rects.map((rect) => rect.id)).toEqual(['regular']);
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

  test('projects low-angle world flags into independent screen hit rectangles', () => {
    const camera = {
      currentPitch: 40,
      eye: [0, -560, 360],
      target: [0, 0, 0]
    };
    const project = (point) => ({
      x: 500 + (point.x * 2),
      y: 420 - (point.y * 0.8) - (point.z * 2),
      visible: true
    });
    const rects = resolveTrainingWorldFlagHitRects({
      anchors: [
        { id: 'front', x: 0, y: 0, remain: 100, radius: 20 },
        { id: 'rear', x: 0, y: 220, remain: 100, radius: 20 }
      ],
      camera,
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });

    expect(rects).toHaveLength(2);
    const rear = rects.find((rect) => rect.id === 'rear');
    expect(pickTrainingWorldFlagId(rects, (rear.left + rear.right) * 0.5, (rear.top + rear.bottom) * 0.5))
      .toBe('rear');
    expect(resolveTrainingWorldFlagHitRects({
      anchors: [{ id: 'front', x: 0, y: 0, remain: 100, radius: 20 }],
      camera: { ...camera, currentPitch: 60 },
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    })).toEqual([]);
  });

  test('uses the rendered flag silhouette instead of a padded centered hit box', () => {
    const camera = {
      currentPitch: 40,
      eye: [0, -560, 360],
      target: [0, 0, 0]
    };
    const project = (point) => ({
      x: 500 + (point.x * 2),
      y: 420 - (point.y * 0.8) - (point.z * 2),
      visible: true
    });
    const [rect] = resolveTrainingWorldFlagHitRects({
      anchors: [{ id: 'front', x: 0, y: 0, remain: 100, radius: 20 }],
      camera,
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const transparentPoint = project({
      x: rect.displayX + (Math.cos(rect.cameraYaw + (Math.PI / 2))
        * rect.clothWidth * rect.worldFlagScale * 0.5),
      y: rect.displayY + (Math.sin(rect.cameraYaw + (Math.PI / 2))
        * rect.clothWidth * rect.worldFlagScale * 0.5),
      z: rect.baseZ
    });
    const notch = rect.points[2];
    const insidePoint = {
      x: (rect.points[0].x + notch.x) * 0.5,
      y: notch.y
    };

    expect(rect.points).toHaveLength(5);
    expect(pickTrainingWorldFlagId([rect], transparentPoint.x, transparentPoint.y)).toBe('');
    expect(pickTrainingWorldFlagId([rect], insidePoint.x, insidePoint.y)).toBe('front');
    expect(pickTrainingWorldFlagId([rect], rect.right - 1, notch.y)).toBe('');
  });

  test('uses the nearest flag dimensions for every snapped flag', () => {
    const camera = {
      currentPitch: 40,
      eye: [0, -560, 360],
      target: [0, 0, 0]
    };
    const project = (point) => ({
      x: 500 + (point.x * 2),
      y: 420 - (point.y * 0.8) - (point.z * 2),
      visible: true
    });
    const rects = resolveTrainingWorldFlagHitRects({
      anchors: [
        { id: 'front', x: 0, y: 0, remain: 100, radius: 20 },
        { id: 'rear', x: 0, y: 24, remain: 5408, radius: 126 }
      ],
      camera,
      project,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const front = rects.find((rect) => rect.id === 'front');
    const rear = rects.find((rect) => rect.id === 'rear');

    expect(rear.leaderId).toBe('front');
    expect(rear.right - rear.left).toBeCloseTo(front.right - front.left, 6);
    expect(rear.bottom - rear.top).toBeCloseTo(front.bottom - front.top, 6);
    expect(Math.abs(rear.points[0].y - front.points[0].y)).toBeCloseTo(
      front.bottom - front.top,
      6
    );
    expect(rear.points[0].x).toBeCloseTo(front.points[4].x, 6);
    expect(rear.points[0].y).toBeCloseTo(front.points[4].y, 6);
    expect(rear.points[1].x).toBeCloseTo(front.points[3].x, 6);
    expect(rear.points[1].y).toBeCloseTo(front.points[3].y, 6);
  });

  test('matches the rendered flag edge after the camera rotates around the battlefield', () => {
    const camera = new CameraController({ yawDeg: 0, pitchLow: 40, pitchHigh: 90, distance: 560 });
    camera.setPitchImmediate(40);
    camera.worldYawDeg = 75;
    const cameraState = camera.buildMatrices(1000, 500);
    const renderedCamera = new THREE.PerspectiveCamera(48, 2, 1, 8000);
    renderedCamera.matrixAutoUpdate = false;
    renderedCamera.matrixWorldAutoUpdate = false;
    renderedCamera.projectionMatrix.fromArray(cameraState.projection);
    renderedCamera.projectionMatrixInverse.copy(renderedCamera.projectionMatrix).invert();
    renderedCamera.matrixWorldInverse.fromArray(cameraState.viewWorld);
    renderedCamera.matrixWorld.copy(renderedCamera.matrixWorldInverse).invert();
    renderedCamera.position.setFromMatrixPosition(renderedCamera.matrixWorld);

    const anchor = { id: 'rotated', x: 120, y: -80, remain: 100, radius: 20 };
    const [rect] = resolveTrainingWorldFlagHitRects({
      anchors: [anchor],
      camera,
      viewportWidth: 1000,
      viewportHeight: 500,
      viewportCssHeight: 500
    });
    const dimensions = resolveTrainingWorldFlagDimensions(anchor);
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(renderedCamera.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(renderedCamera.matrixWorld);
    const cameraDepth = Math.max(
      1,
      new THREE.Vector3(anchor.x, anchor.y, dimensions.clothBottom)
        .sub(renderedCamera.position)
        .dot(forward)
    );
    const viewHeight = 2 * cameraDepth * Math.tan((48 * Math.PI / 180) * 0.5);
    const scale = resolveTrainingWorldFlagScreenScale({
      clothHeight: dimensions.clothHeight,
      viewHeight,
      viewportHeight: 500,
      verticalScreenFactor: Math.max(0.35, Math.abs(up.z))
    });
    const yaw = Math.atan2(
      renderedCamera.position.y - anchor.y,
      renderedCamera.position.x - anchor.x
    );
    const expectedPoint = new THREE.Vector3(
      anchor.x + (Math.cos(yaw + (Math.PI / 2)) * dimensions.clothWidth * scale * (1 - (12 / 512))),
      anchor.y + (Math.sin(yaw + (Math.PI / 2)) * dimensions.clothWidth * scale * (1 - (12 / 512))),
      dimensions.clothBottom + (dimensions.clothHeight * scale * (86 / 232))
    ).project(renderedCamera);

    expect(rect.points[1].x).toBeCloseTo((expectedPoint.x + 1) * 500, 5);
    expect(rect.points[1].y).toBeCloseTo((1 - expectedPoint.y) * 250, 5);
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

describe('training hover footprint', () => {
  test('raises hover contrast as the camera moves into overview distance', () => {
    const close = resolveTrainingHoverPresentation({ distance: 560, overviewZoomProgress: 0 });
    const distant = resolveTrainingHoverPresentation({ distance: 3_600, overviewZoomProgress: 1 });

    expect(distant.zoomOutProgress).toBeGreaterThan(close.zoomOutProgress);
    expect(distant.outerOpacity).toBeGreaterThan(close.outerOpacity);
    expect(distant.innerColorMix).toBeGreaterThan(close.innerColorMix);
  });

  test('keeps the hover footprint beyond the chibi body without reaching selected-ring size', () => {
    const smallFootprint = resolveTrainingHoverFootprint(2.6);
    const largeFootprint = resolveTrainingHoverFootprint(10.5);

    expect(smallFootprint.outer.width).toBeCloseTo(5.096, 6);
    expect(smallFootprint.outer.depth).toBeCloseTo(4.212, 6);
    expect(smallFootprint.outer.width).toBeGreaterThan(2.6 * 1.36);
    expect(smallFootprint.outer.depth).toBeGreaterThan(2.6 * 1.24);
    expect(smallFootprint.outer.width).toBeLessThan(2.6 * 3.4);
    expect(smallFootprint.inner.width).toBeLessThan(smallFootprint.outer.width);
    expect(smallFootprint.inner.depth).toBeLessThan(smallFootprint.outer.depth);
    expect(largeFootprint.outer.width).toBeCloseTo(20.58, 6);
    expect(smallFootprint.outer.elevation).toBeLessThan(smallFootprint.inner.elevation);
  });
});

describe('training skill preview', () => {
  const runtime = {
    getSquadById: (id) => ({
      attacker: { id: 'attacker', team: 'attacker', x: 0, y: 0, dirX: 1, dirY: 0 },
      defender: { id: 'defender', team: 'defender', x: 60, y: 0 }
    }[id] || null),
    crowd: {
      allAgents: [
        { id: 'front', squadId: 'defender', team: 'defender', x: 30, y: 0, weight: 4 },
        { id: 'side', squadId: 'defender', team: 'defender', x: 30, y: 50, weight: 4 },
        { id: 'far', squadId: 'defender', team: 'defender', x: 190, y: 0, weight: 4 }
      ]
    }
  };

  test('marks only enemies inside a ground target radius', () => {
    const preview = resolveTrainingSkillPreview(runtime, {
      squadId: 'attacker',
      targetMode: 'ground',
      center: { x: 0, y: 0 },
      hoverPoint: { x: 30, y: 0 },
      maxRange: 260,
      aoeRadius: 8,
      profile: { targetMode: 'ground' }
    });

    expect(preview.targetAgents.map((agent) => agent.id)).toEqual(['front']);
    expect(preview.targetSquadIds).toEqual(['defender']);
  });

  test('uses painted stamps instead of the fixed ground radius during training previews', () => {
    const preview = resolveTrainingSkillPreview(runtime, {
      squadId: 'attacker',
      targetMode: 'ground',
      center: { x: 0, y: 0 },
      hoverPoint: { x: 30, y: 0 },
      maxRange: 260,
      aoeRadius: 8,
      paintArea: {
        remainingArea: 0,
        stamps: [{ x: 30, y: 50, radius: 9 }]
      },
      profile: { targetMode: 'ground' }
    });

    expect(preview.paintArea.stamps).toHaveLength(1);
    expect(preview.targetAgents.map((agent) => agent.id)).toEqual(['side']);
  });

  test('uses the ground direction cone for melee previews', () => {
    const preview = resolveTrainingSkillPreview(runtime, {
      squadId: 'attacker',
      targetMode: 'direction',
      center: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      len: 60,
      maxRange: 80,
      aoeRadius: 24,
      profile: { targetMode: 'direction', coneAngleDeg: 90, shape: 'cone' }
    });

    expect(preview.targetAgents.map((agent) => agent.id)).toEqual(['front']);
    expect(preview.direction).toEqual({ x: 1, y: 0 });
  });

  test('re-evaluates possible targets from their current soldier positions', () => {
    const movingRuntime = {
      ...runtime,
      crowd: {
        allAgents: runtime.crowd.allAgents.map((agent) => ({ ...agent }))
      }
    };
    movingRuntime.crowd.allAgents[0].x = 46;
    const preview = resolveTrainingSkillPreview(movingRuntime, {
      squadId: 'attacker',
      targetMode: 'ground',
      center: { x: 0, y: 0 },
      hoverPoint: { x: 30, y: 0 },
      maxRange: 260,
      aoeRadius: 8,
      profile: { targetMode: 'ground' }
    });

    expect(preview.targetAgents).toHaveLength(0);
  });

  test('treats a melee ground target as a charge point and previews the path', () => {
    const preview = resolveTrainingSkillPreview(runtime, {
      squadId: 'attacker',
      targetMode: 'ground',
      center: { x: 0, y: 0 },
      hoverPoint: { x: 30, y: 0 },
      maxRange: 80,
      aoeRadius: 8,
      profile: { targetMode: 'ground', castStyle: 'melee' }
    });

    expect(preview.castStyle).toBe('melee');
    expect(preview.targetAgents.map((agent) => agent.id)).toEqual(['front']);
  });

  test('uses distinct marker categories and an expanded oriented alert rectangle', () => {
    expect(resolveTrainingSkillMarkerCategory({ typeCategory: 'cavalry', unitCategory: 'melee' }, 'melee')).toBe('cavalry');
    expect(resolveTrainingSkillMarkerCategory({ typeCategory: 'infantry', unitCategory: 'support' }, 'support')).toBe('support');
    const rect = resolveTrainingMeleeAlertRect({
      x: 0,
      y: 0,
      radius: 20,
      team: 'attacker',
      formationRect: { width: 60, depth: 24, facingRad: Math.PI / 2 }
    }, { x: 40, y: 12 });
    expect(rect).toMatchObject({ x: 40, y: 12, width: 92, depth: 56, yaw: Math.PI / 2 });
  });

  test('keeps the selected skill category bright and shadows other soldiers while preparing', () => {
    const focus = resolveTrainingSkillVisualFocus({
      getSquadById: () => ({ hiddenFromAttacker: false }),
      crowd: {
        allAgents: [
          { id: 'melee', squadId: 'attacker', team: 'attacker', unitCategory: 'melee', weight: 2 },
          { id: 'ranged', squadId: 'attacker', team: 'attacker', unitCategory: 'ranged', weight: 2 },
          { id: 'enemy', squadId: 'defender', team: 'defender', unitCategory: 'melee', weight: 2 }
        ]
      }
    }, {
      squadId: 'attacker',
      profile: { sourceCategory: 'melee' }
    });

    expect(focus.focusFlags).toEqual([true, false, false]);
    expect(focus.shadowFlags).toEqual([false, true, false]);
  });
});
