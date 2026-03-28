import { useEffect } from 'react';
import * as THREE from 'three';
import {
  DEPLOY_ZONE_RATIO,
  WALL_HEIGHT,
  WALL_WIDTH,
  WALL_DEPTH,
  STACK_LAYER_HEIGHT,
  DEFENDER_SOLDIER_VISUAL_SCALE,
  getBushBladeTexture,
  normalizeDeg,
  degToRad,
  resolveFormationBudgetByZoom,
  parseHexColor,
  getWallBaseZ,
  tintHexColor,
  clearThreeGroup,
  normalizeDefenderUnits,
  normalizeDefenderFacingDeg,
  sanitizeDefenderDeployments,
  rotate2D
} from './battlefieldShared';
import {
  getWallFootprintCorners,
  isBushItem,
  resolveSnapHighlightFacePoints,
  resolveWallItemDef
} from './battlefieldPlacementUtils';
import {
  createFormationVisualState,
  reconcileCounts,
  renderFormation,
  getFormationFootprint
} from '../../../game/formation/ArmyFormationRenderer';
import {
  buildWorldColliderParts,
  resolveBattleLayerColors
} from '../../../game/battlefield/items/ItemGeometryRegistry';

const useBattlefieldScene = ({
  open = false,
  threeRef,
  viewport,
  fieldWidth,
  fieldHeight,
  walls,
  ghost,
  ghostBlocked,
  snapState,
  cameraAngle,
  cameraYaw,
  zoom,
  worldScale,
  editMode,
  effectiveCanEdit,
  itemCatalogById,
  defenderUnitTypesForFormation,
  selectedWallId,
  defenderDeployments,
  selectedDeploymentId,
  defenderDragPreview,
  panWorld,
  resolveDefenderDeploymentRadius,
  defenderFormationStateRef
}) => {
  useEffect(() => {
    if (!open || !threeRef.current) return;
    const { renderer, scene, camera, worldGroup } = threeRef.current;
    if (!renderer || !scene || !camera || !worldGroup) return;

    renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));
    renderer.setSize(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)), false);

    clearThreeGroup(worldGroup);

    const fieldMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(fieldWidth, fieldHeight),
      new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.9,
        metalness: 0.04,
        side: THREE.DoubleSide
      })
    );
    fieldMesh.position.set(0, 0, 0);
    worldGroup.add(fieldMesh);

    const fieldTint = new THREE.Mesh(
      new THREE.PlaneGeometry(fieldWidth * 0.98, fieldHeight * 0.98),
      new THREE.MeshBasicMaterial({
        color: 0x334155,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    fieldTint.position.set(0, 0, 0.12);
    worldGroup.add(fieldTint);

    const deployZoneWidth = Math.max(10, fieldWidth * DEPLOY_ZONE_RATIO);
    const deployZoneCenterOffset = (fieldWidth - deployZoneWidth) / 2;
    const deployZoneZ = 0.16;
    const friendlyZone = new THREE.Mesh(
      new THREE.PlaneGeometry(deployZoneWidth, fieldHeight * 0.98),
      new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    friendlyZone.position.set(deployZoneCenterOffset, 0, deployZoneZ);
    worldGroup.add(friendlyZone);

    const enemyZone = new THREE.Mesh(
      new THREE.PlaneGeometry(deployZoneWidth, fieldHeight * 0.98),
      new THREE.MeshBasicMaterial({
        color: 0xf87171,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    enemyZone.position.set(-deployZoneCenterOffset, 0, deployZoneZ);
    worldGroup.add(enemyZone);

    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-fieldWidth / 2, -fieldHeight / 2, 0.4),
      new THREE.Vector3(fieldWidth / 2, -fieldHeight / 2, 0.4),
      new THREE.Vector3(fieldWidth / 2, fieldHeight / 2, 0.4),
      new THREE.Vector3(-fieldWidth / 2, fieldHeight / 2, 0.4)
    ]);
    const borderLine = new THREE.LineLoop(
      borderGeometry,
      new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.72
      })
    );
    worldGroup.add(borderLine);

    const gridPoints = [];
    const gridStep = 70;
    for (let x = -fieldWidth / 2; x <= fieldWidth / 2; x += gridStep) {
      gridPoints.push(new THREE.Vector3(x, -fieldHeight / 2, 0.2));
      gridPoints.push(new THREE.Vector3(x, fieldHeight / 2, 0.2));
    }
    for (let y = -fieldHeight / 2; y <= fieldHeight / 2; y += gridStep) {
      gridPoints.push(new THREE.Vector3(-fieldWidth / 2, y, 0.2));
      gridPoints.push(new THREE.Vector3(fieldWidth / 2, y, 0.2));
    }
    const gridLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gridPoints),
      new THREE.LineBasicMaterial({
        color: 0x64748b,
        transparent: true,
        opacity: 0.28
      })
    );
    worldGroup.add(gridLines);

    const pickableWallMeshes = [];
    const buildWallMesh = (wallLike, options = {}) => {
      const itemDef = resolveWallItemDef(wallLike, itemCatalogById);
      const isBush = isBushItem(itemDef);
      const safeHeight = Math.max(14, Number(wallLike.height) || WALL_HEIGHT);
      const safeWidth = Math.max(20, Number(wallLike.width) || WALL_WIDTH);
      const safeDepth = Math.max(12, Number(wallLike.depth) || WALL_DEPTH);
      const selected = !!options.selected;
      const ghostMode = !!options.ghost;
      const sourceShadow = !!options.sourceShadow;
      const blocked = !!options.blocked;
      const palette = resolveBattleLayerColors(itemDef, { battleTone: true });
      const defaultTop = new THREE.Color(
        Number(palette?.top?.[0]) || 0.52,
        Number(palette?.top?.[1]) || 0.58,
        Number(palette?.top?.[2]) || 0.66
      ).getHex();
      const defaultSide = new THREE.Color(
        Number(palette?.side?.[0]) || 0.38,
        Number(palette?.side?.[1]) || 0.44,
        Number(palette?.side?.[2]) || 0.52
      ).getHex();

      let topHex = defaultTop;
      let sideHex = defaultSide;
      if (selected && !isBush) {
        topHex = 0x60a5fa;
        sideHex = 0x3b82f6;
      } else if (ghostMode && !sourceShadow) {
        topHex = blocked ? 0xb91c1c : 0xf59e0b;
        sideHex = blocked ? 0x7f1d1d : 0xb45309;
      }

      const partRowsRaw = buildWorldColliderParts(
        wallLike,
        itemDef,
        { stackLayerHeight: Math.max(1, Number(wallLike?.height) || Number(itemDef?.height) || STACK_LAYER_HEIGHT) }
      );
      const partRows = partRowsRaw.length > 0
        ? partRowsRaw
        : [{
          cx: Number(wallLike?.x) || 0,
          cy: Number(wallLike?.y) || 0,
          cz: getWallBaseZ(wallLike) + (safeHeight * 0.5),
          w: safeWidth,
          d: safeDepth,
          h: safeHeight,
          yawDeg: normalizeDeg(wallLike?.rotation || 0)
        }];

      partRows.forEach((part, partIndex) => {
        const materials = [
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: topHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.38 : (ghostMode ? 0.54 : 1),
            roughness: sourceShadow ? 0.68 : (ghostMode ? 0.52 : 0.76),
            metalness: sourceShadow ? 0.05 : (ghostMode ? 0.14 : 0.08),
            side: THREE.DoubleSide,
            depthWrite: true
          }),
          new THREE.MeshStandardMaterial({
            color: sideHex,
            transparent: ghostMode || sourceShadow,
            opacity: sourceShadow ? 0.34 : (ghostMode ? 0.48 : 1),
            roughness: sourceShadow ? 0.72 : (ghostMode ? 0.56 : 0.84),
            metalness: sourceShadow ? 0.04 : (ghostMode ? 0.12 : 0.06),
            side: THREE.DoubleSide,
            depthWrite: true
          })
        ];
        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(
            Math.max(1, Number(part?.w) || 1),
            Math.max(1, Number(part?.d) || 1),
            Math.max(1, Number(part?.h) || 1)
          ),
          materials
        );
        if (isBush) {
          const applyOpacity = (mat, opacity) => {
            if (!mat) return;
            mat.transparent = true;
            mat.opacity = opacity;
            mat.depthWrite = false;
            mat.depthTest = false;
          };
          materials.forEach((mat) => applyOpacity(mat, 0));
        }
        wallMesh.position.set(
          Number(part?.cx) || 0,
          Number(part?.cy) || 0,
          Math.max(0.5, Number(part?.cz) || 0.5)
        );
        wallMesh.rotation.set(0, 0, degToRad(part?.yawDeg || 0));
        worldGroup.add(wallMesh);

        if (!ghostMode && !sourceShadow && typeof wallLike.id === 'string') {
          const partHeight = Math.max(1, Number(part?.h) || 1);
          const partCenterZ = Number(part?.cz) || 0;
          wallMesh.userData.wallId = wallLike.id;
          wallMesh.userData.partIndex = partIndex;
          wallMesh.userData.partCenterZ = partCenterZ;
          wallMesh.userData.partMinZ = partCenterZ - (partHeight * 0.5);
          wallMesh.userData.partMaxZ = partCenterZ + (partHeight * 0.5);
          pickableWallMeshes.push(wallMesh);
        }

        if (!isBush) {
          const edgeMesh = new THREE.LineSegments(
            new THREE.EdgesGeometry(wallMesh.geometry),
            new THREE.LineBasicMaterial({
              color: selected ? 0xbfdbfe : 0x0f172a,
              transparent: true,
              opacity: selected ? 0.96 : 0.68
            })
          );
          edgeMesh.position.copy(wallMesh.position);
          edgeMesh.rotation.copy(wallMesh.rotation);
          worldGroup.add(edgeMesh);
        }
      });

      if (isBush) {
        const bushGroup = new THREE.Group();
        const avgCenterZ = partRows.reduce((sum, row) => sum + (Number(row?.cz) || 0), 0) / Math.max(1, partRows.length);
        bushGroup.position.set(
          Number(wallLike?.x) || 0,
          Number(wallLike?.y) || 0,
          Number.isFinite(avgCenterZ) ? avgCenterZ : (getWallBaseZ(wallLike) + (safeHeight * 0.45))
        );
        bushGroup.rotation.set(0, 0, degToRad(wallLike?.rotation || 0));
        worldGroup.add(bushGroup);

        const partW = safeWidth;
        const partD = safeDepth;
        const partH = safeHeight;
        const crownRadius = Math.max(5.5, Math.min(partW, partD) * 0.2);
        const crownHeight = Math.max(8, partH * 0.5);
        const bushTopColor = blocked ? 0xef4444 : (selected ? 0x8ed17f : topHex);
        const bushSideColor = blocked ? 0x991b1b : (selected ? 0x5ea76a : sideHex);

        const buildFoliageMaterial = (hex, opacity = 0.92, roughness = 0.9, metalness = 0.03) => (
          new THREE.MeshStandardMaterial({
            color: hex,
            transparent: ghostMode || sourceShadow || opacity < 1,
            opacity: sourceShadow ? Math.min(opacity, 0.35) : (ghostMode ? Math.min(opacity, 0.56) : opacity),
            roughness,
            metalness,
            side: THREE.DoubleSide,
            depthWrite: !ghostMode && !sourceShadow
          })
        );

        const clumpOffsets = [
          { x: 0, y: 0, s: 1.3, z: 0.56 },
          { x: -partW * 0.18, y: partD * 0.06, s: 1.02, z: 0.46 },
          { x: partW * 0.19, y: partD * 0.04, s: 0.98, z: 0.47 },
          { x: -partW * 0.13, y: -partD * 0.17, s: 0.92, z: 0.37 },
          { x: partW * 0.14, y: -partD * 0.16, s: 0.95, z: 0.37 },
          { x: 0, y: partD * 0.2, s: 0.94, z: 0.42 },
          { x: -partW * 0.24, y: -partD * 0.01, s: 0.86, z: 0.34 },
          { x: partW * 0.24, y: 0, s: 0.87, z: 0.34 },
          { x: -partW * 0.04, y: partD * 0.25, s: 0.83, z: 0.33 },
          { x: partW * 0.05, y: partD * 0.24, s: 0.82, z: 0.33 },
          { x: -partW * 0.08, y: -partD * 0.24, s: 0.78, z: 0.3 },
          { x: partW * 0.08, y: -partD * 0.24, s: 0.79, z: 0.3 }
        ];
        clumpOffsets.forEach((row, idx) => {
          const crown = new THREE.Mesh(
            new THREE.SphereGeometry(crownRadius, 16, 14),
            buildFoliageMaterial(idx % 2 === 0 ? bushTopColor : bushSideColor, 0.94, 0.88, 0.02)
          );
          crown.scale.set(row.s * 1.1, row.s, Math.max(0.72, (crownHeight / crownRadius) * (0.86 + (idx * 0.018))));
          crown.position.set(row.x, row.y, Math.max(2.8, partH * row.z));
          bushGroup.add(crown);
        });

        const bladeCount = 18;
        for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
          const t = bladeIndex / bladeCount;
          const angle = (Math.PI * 2 * t) + ((bladeIndex % 2) * 0.18);
          const radius = Math.max(1.8, crownRadius * (0.26 + ((bladeIndex % 5) * 0.1)));
          const blade = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(0.38, crownRadius * 0.16), Math.max(3.8, partH * 0.44), 5),
            buildFoliageMaterial(bushTopColor, 0.9, 0.84, 0.01)
          );
          blade.position.set(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            Math.max(2.6, partH * (0.25 + ((bladeIndex % 4) * 0.03)))
          );
          blade.rotation.x = Math.PI / 2;
          blade.rotation.y = Math.PI * (0.06 + ((bladeIndex % 4) * 0.03));
          blade.rotation.z = angle;
          bushGroup.add(blade);
        }

        const bladeTexture = getBushBladeTexture();
        if (bladeTexture) {
          const spriteOpacity = sourceShadow ? 0.22 : (ghostMode ? 0.46 : 0.74);
          const spriteMatA = new THREE.SpriteMaterial({
            map: bladeTexture,
            color: bushTopColor,
            transparent: true,
            opacity: spriteOpacity,
            alphaTest: 0.12,
            depthWrite: false
          });
          const spriteMatB = new THREE.SpriteMaterial({
            map: bladeTexture,
            color: bushSideColor,
            transparent: true,
            opacity: spriteOpacity * 0.92,
            alphaTest: 0.12,
            depthWrite: false
          });
          const spriteCount = 26;
          for (let spriteIndex = 0; spriteIndex < spriteCount; spriteIndex += 1) {
            const t = spriteIndex / spriteCount;
            const angle = (Math.PI * 2 * t) + ((spriteIndex % 3) * 0.14);
            const radius = crownRadius * (0.2 + ((spriteIndex % 7) * 0.1));
            const sprite = new THREE.Sprite((spriteIndex % 2 === 0) ? spriteMatA : spriteMatB);
            sprite.center.set(0.5, 0.03);
            const spriteHeight = Math.max(5.8, partH * (0.27 + ((spriteIndex % 5) * 0.03)));
            sprite.scale.set(spriteHeight * 0.42, spriteHeight, 1);
            sprite.position.set(
              Math.cos(angle) * radius,
              Math.sin(angle) * radius,
              Math.max(2.1, partH * (0.19 + ((spriteIndex % 4) * 0.02)))
            );
            bushGroup.add(sprite);
          }
        }
      }

      if (isBush && ghostMode && !sourceShadow) {
        const safeCenterX = Number(wallLike?.x) || 0;
        const safeCenterY = Number(wallLike?.y) || 0;
        const footprintCorners = getWallFootprintCorners(wallLike, itemCatalogById);
        const fallbackRadius = Math.max(6, Math.hypot(safeWidth * 0.5, safeDepth * 0.5));
        const stealthRadius = Math.max(
          fallbackRadius,
          footprintCorners.reduce(
            (max, row) => Math.max(max, Math.hypot((Number(row?.x) || 0) - safeCenterX, (Number(row?.y) || 0) - safeCenterY)),
            0
          )
        );
        const rangeColor = blocked ? 0xef4444 : 0x22c55e;
        const hemiDome = new THREE.Mesh(
          new THREE.SphereGeometry(stealthRadius, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.5),
          new THREE.MeshBasicMaterial({
            color: rangeColor,
            transparent: true,
            opacity: blocked ? 0.14 : 0.17,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        hemiDome.position.set(safeCenterX, safeCenterY, 0);
        hemiDome.rotation.x = Math.PI * 0.5;
        worldGroup.add(hemiDome);

        const groundDisk = new THREE.Mesh(
          new THREE.CircleGeometry(stealthRadius, 64),
          new THREE.MeshBasicMaterial({
            color: rangeColor,
            transparent: true,
            opacity: blocked ? 0.12 : 0.14,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        groundDisk.position.set(safeCenterX, safeCenterY, 0.08);
        worldGroup.add(groundDisk);

        const ring = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(
            Array.from({ length: 64 }, (_, idx) => {
              const angle = (idx / 64) * Math.PI * 2;
              return new THREE.Vector3(
                safeCenterX + (Math.cos(angle) * stealthRadius),
                safeCenterY + (Math.sin(angle) * stealthRadius),
                0.54
              );
            })
          ),
          new THREE.LineBasicMaterial({
            color: blocked ? 0xfca5a5 : 0x86efac,
            transparent: true,
            opacity: 0.95
          })
        );
        worldGroup.add(ring);
      }
    };

    const buildDefenderSquadMesh = (deploymentLike, options = {}) => {
      const deployment = deploymentLike || {};
      const units = normalizeDefenderUnits(deployment?.units, deployment?.unitTypeId, deployment?.count);
      const totalCount = units.reduce((sum, entry) => sum + entry.count, 0);
      if (totalCount <= 0) return;
      const isSelected = !!options.selected;
      const isPreview = !!options.preview;
      const isBlocked = !!options.blocked;
      const squadGroup = new THREE.Group();
      squadGroup.position.set(0, 0, 0.24);
      worldGroup.add(squadGroup);
      const centerX = Number(deployment?.x) || 0;
      const centerY = Number(deployment?.y) || 0;

      const countsByType = {};
      units.forEach((entry) => {
        countsByType[entry.unitTypeId] = (countsByType[entry.unitTypeId] || 0) + entry.count;
      });
      const formationKey = `def_layout_${deployment?.deployId || `${centerX}_${centerY}`}`;
      const deployRotation = normalizeDefenderFacingDeg(deployment?.rotation);
      const cameraState = {
        distance: Math.max(fieldWidth, fieldHeight, 500) * 2.4,
        worldScale,
        renderBudget: resolveFormationBudgetByZoom(zoom),
        shape: 'grid'
      };
      const formationCache = defenderFormationStateRef.current;
      let formationState = formationCache.get(formationKey);
      if (!formationState) {
        formationState = createFormationVisualState({
          teamId: 'defender',
          formationId: formationKey,
          countsByType,
          unitTypes: defenderUnitTypesForFormation,
          cameraState
        });
        formationCache.set(formationKey, formationState);
      } else {
        reconcileCounts(formationState, countsByType, {
          ...cameraState,
          unitTypes: defenderUnitTypesForFormation
        }, Date.now());
      }
      formationState.isHighlighted = isSelected;
      formationState.isGhost = isPreview;

      const infantryBodyGeometry = new THREE.ConeGeometry(1.35 * DEFENDER_SOLDIER_VISUAL_SCALE, 4.7 * DEFENDER_SOLDIER_VISUAL_SCALE, 6);
      const archerBodyGeometry = new THREE.CylinderGeometry(0.7 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.84 * DEFENDER_SOLDIER_VISUAL_SCALE, 2.8 * DEFENDER_SOLDIER_VISUAL_SCALE, 8);
      const cavalryBodyGeometry = new THREE.BoxGeometry(2.2 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.1 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.05 * DEFENDER_SOLDIER_VISUAL_SCALE);
      const cavalryLanceGeometry = new THREE.CylinderGeometry(0.16 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.16 * DEFENDER_SOLDIER_VISUAL_SCALE, 3.2 * DEFENDER_SOLDIER_VISUAL_SCALE, 7);
      const artilleryBodyGeometry = new THREE.BoxGeometry(2.18 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.35 * DEFENDER_SOLDIER_VISUAL_SCALE, 1.4 * DEFENDER_SOLDIER_VISUAL_SCALE);
      const artilleryTubeGeometry = new THREE.CylinderGeometry(0.34 * DEFENDER_SOLDIER_VISUAL_SCALE, 0.42 * DEFENDER_SOLDIER_VISUAL_SCALE, 2.28 * DEFENDER_SOLDIER_VISUAL_SCALE, 8);
      const headGeometry = new THREE.SphereGeometry(0.92 * DEFENDER_SOLDIER_VISUAL_SCALE, 8, 8);
      const shadowGeometry = new THREE.CircleGeometry(Math.max(1.1, 2.16 * DEFENDER_SOLDIER_VISUAL_SCALE), 10);
      const opacity = isPreview ? (isBlocked ? 0.36 : 0.58) : 0.98;
      const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x020617,
        transparent: true,
        opacity: isPreview ? 0.16 : 0.24,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const createLitMaterial = (hexColor, materialOpacity = opacity, emissiveScale = 0.14) => new THREE.MeshStandardMaterial({
        color: hexColor,
        emissive: tintHexColor(hexColor, 0, 1, 0.02),
        emissiveIntensity: isPreview ? (emissiveScale * 0.75) : emissiveScale,
        transparent: isPreview,
        opacity: materialOpacity,
        roughness: 0.46,
        metalness: 0.12
      });
      const rendered = renderFormation(
        formationState,
        {
          kind: 'descriptors',
          center: { x: centerX, y: centerY }
        },
        cameraState,
        0
      );
      const fallbackFootprint = rendered?.footprint || getFormationFootprint(formationState);
      const stableRadius = resolveDefenderDeploymentRadius(deployment, Number(fallbackFootprint?.radius) || 18);
      const clusterRadius = Math.max(8, stableRadius);
      const rawRadius = Math.max(1, Number(fallbackFootprint?.radius) || clusterRadius);
      const clusterScale = Math.max(0.45, Math.min(1.25, clusterRadius / rawRadius));

      (rendered?.instances || []).forEach((instance) => {
        const bodyColor = isBlocked
          ? 0xf87171
          : parseHexColor(instance.bodyColor, 0x60a5fa);
        const accentColor = isBlocked
          ? 0xfee2e2
          : parseHexColor(instance.accentColor, 0xdbeafe);
        const rawX = Number(instance.x) || centerX;
        const rawY = Number(instance.y) || centerY;
        const rotatedOffset = rotate2D(
          (rawX - centerX) * clusterScale,
          (rawY - centerY) * clusterScale,
          deployRotation
        );
        const sx = centerX + rotatedOffset.x;
        const sy = centerY + rotatedOffset.y;
        const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
        shadow.position.set(sx, sy, 0.05);
        shadow.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(shadow);

        if (instance.category === 'cavalry') {
          const mount = new THREE.Mesh(cavalryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
          mount.position.set(sx, sy, 0.98 * DEFENDER_SOLDIER_VISUAL_SCALE);
          squadGroup.add(mount);
          const lance = new THREE.Mesh(cavalryLanceGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.96, 0.1));
          lance.position.set(sx + (1.3 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 2.3 * DEFENDER_SOLDIER_VISUAL_SCALE);
          lance.rotation.set(0, Math.PI / 2, (Math.PI / 12) + degToRad(deployRotation));
          squadGroup.add(lance);
        } else if (instance.category === 'archer') {
          const body = new THREE.Mesh(archerBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
          body.position.set(sx, sy, 1.68 * DEFENDER_SOLDIER_VISUAL_SCALE);
          body.rotation.set(Math.PI / 2, 0, 0);
          squadGroup.add(body);
        } else if (instance.category === 'artillery') {
          const body = new THREE.Mesh(artilleryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.16));
          body.position.set(sx, sy, 1.08 * DEFENDER_SOLDIER_VISUAL_SCALE);
          squadGroup.add(body);
          const tube = new THREE.Mesh(artilleryTubeGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.96, 0.12));
          tube.position.set(sx + (0.9 * DEFENDER_SOLDIER_VISUAL_SCALE), sy, 2.0 * DEFENDER_SOLDIER_VISUAL_SCALE);
          tube.rotation.set(0, Math.PI / 2, (Math.PI / 5) + degToRad(deployRotation));
          squadGroup.add(tube);
        } else {
          const body = new THREE.Mesh(infantryBodyGeometry, createLitMaterial(bodyColor, opacity, 0.18));
          body.position.set(sx, sy, 1.22 * DEFENDER_SOLDIER_VISUAL_SCALE);
          body.rotation.set(Math.PI / 2, 0, 0);
          squadGroup.add(body);
        }

        const head = new THREE.Mesh(headGeometry, createLitMaterial(accentColor, isPreview ? opacity * 0.92 : 0.98, 0.13));
        head.position.set(sx, sy, 3.0 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(head);
      });

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 8.5, 8),
        new THREE.MeshStandardMaterial({
          color: 0xcbd5e1,
          transparent: isPreview,
          opacity: isPreview ? 0.7 : 0.92,
          roughness: 0.35,
          metalness: 0.28
        })
      );
      pole.position.set(centerX, centerY, 5.1);
      squadGroup.add(pole);

      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(4.8, 2.8),
        new THREE.MeshStandardMaterial({
          color: isBlocked ? 0xfca5a5 : 0xbfdbfe,
          transparent: true,
          opacity: isPreview ? 0.38 : 0.5,
          roughness: 0.95,
          metalness: 0,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      banner.position.set(centerX + 2.8, centerY, 8);
      banner.rotation.set(0, Math.PI / 2, 0);
      squadGroup.add(banner);

      const plate = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(5.2, clusterRadius * 0.78), 44),
        new THREE.MeshBasicMaterial({
          color: isBlocked ? 0xfca5a5 : 0x7dd3fc,
          transparent: true,
          opacity: isBlocked ? 0.18 : 0.22,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      plate.position.set(centerX, centerY, 0.08);
      squadGroup.add(plate);

      if (isSelected) {
        const contourRing = new THREE.Mesh(
          new THREE.TorusGeometry(Math.max(4.8, clusterRadius * 0.84), 0.54, 10, 44),
          new THREE.MeshBasicMaterial({
            color: 0xe0f2fe,
            transparent: true,
            opacity: 0.88,
            depthWrite: false
          })
        );
        contourRing.position.set(centerX, centerY, 3.65 * DEFENDER_SOLDIER_VISUAL_SCALE);
        contourRing.rotation.set(Math.PI / 2, 0, 0);
        squadGroup.add(contourRing);

        const contourAura = new THREE.Mesh(
          new THREE.CylinderGeometry(clusterRadius * 0.84, clusterRadius * 0.84, Math.max(2.8, 5.4 * DEFENDER_SOLDIER_VISUAL_SCALE), 30, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0x7dd3fc,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        );
        contourAura.position.set(centerX, centerY, 2.5 * DEFENDER_SOLDIER_VISUAL_SCALE);
        squadGroup.add(contourAura);
      }
    };

    const movingSourceId = ghost?._mode === 'move' && typeof ghost?._sourceId === 'string' ? ghost._sourceId : '';
    walls.forEach((wall) => {
      const isMovingSource = !!movingSourceId && wall.id === movingSourceId;
      const isSelected = editMode && effectiveCanEdit && !ghost && selectedWallId && wall.id === selectedWallId;
      buildWallMesh(wall, isMovingSource ? { sourceShadow: true } : { selected: isSelected });
    });

    if (ghost) {
      buildWallMesh(ghost, { ghost: true, blocked: ghostBlocked });
    }
    const sceneDeployments = sanitizeDefenderDeployments(defenderDeployments);
    const previewDeployId = typeof defenderDragPreview?.deployId === 'string' ? defenderDragPreview.deployId : '';
    const previewDeployment = previewDeployId
      ? sceneDeployments.find((item) => item.deployId === previewDeployId)
      : null;
    const placedDeployments = sceneDeployments.filter((item) => item?.placed !== false);
    const deploymentsForRender = previewDeployment
      ? [
        ...placedDeployments.filter((item) => item.deployId !== previewDeployId),
        {
          ...previewDeployment,
          x: Number(defenderDragPreview?.x),
          y: Number(defenderDragPreview?.y)
        }
      ]
      : placedDeployments;
    deploymentsForRender.forEach((deployment) => {
      buildDefenderSquadMesh(deployment, {
        selected: selectedDeploymentId && deployment.deployId === selectedDeploymentId,
        preview: previewDeployId && deployment.deployId === previewDeployId,
        blocked: !!defenderDragPreview?.blocked
      });
    });
    if (threeRef.current) {
      threeRef.current.pickableWallMeshes = pickableWallMeshes;
    }

    if (snapState?.anchorId) {
      const anchor = walls.find((item) => item.id === snapState.anchorId);
      if (anchor) {
        const highlight = resolveSnapHighlightFacePoints(anchor, snapState, itemCatalogById);
        if (highlight?.points?.length === 4) {
          const pointRows = highlight.points;
          const vertices = new Float32Array(pointRows.flatMap((p) => [p.x, p.y, p.z]));
          const faceGeometry = new THREE.BufferGeometry();
          faceGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          faceGeometry.setIndex([0, 1, 2, 0, 2, 3]);
          faceGeometry.computeVertexNormals();
          const faceMesh = new THREE.Mesh(
            faceGeometry,
            new THREE.MeshBasicMaterial({
              color: 0x38bdf8,
              transparent: true,
              opacity: highlight.kind === 'top' ? 0.12 : 0.16,
              side: THREE.DoubleSide,
              depthWrite: false
            })
          );
          worldGroup.add(faceMesh);
          const edgeLoop = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(pointRows.map((p) => new THREE.Vector3(p.x, p.y, p.z + 0.06))),
            new THREE.LineBasicMaterial({
              color: 0x7dd3fc,
              transparent: true,
              opacity: 0.92
            })
          );
          worldGroup.add(edgeLoop);
        }
      }
    }

    const safeScale = Math.max(0.0001, worldScale || 1);
    const halfW = Math.max(1, viewport.width / (2 * safeScale));
    const halfH = Math.max(1, viewport.height / (2 * safeScale));
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;

    const target = new THREE.Vector3(
      Number(panWorld.x) || 0,
      Number(panWorld.y) || 0,
      0
    );
    const yawRad = degToRad(cameraYaw);
    const tiltRad = degToRad(cameraAngle);
    const distance = Math.max(fieldWidth, fieldHeight, 500) * 2.4;
    const planarDistance = distance * Math.cos(tiltRad);
    const heightDistance = distance * Math.sin(tiltRad);
    camera.position.set(
      target.x - (Math.sin(yawRad) * planarDistance),
      target.y - (Math.cos(yawRad) * planarDistance),
      target.z + heightDistance
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(target);
    camera.near = 1;
    camera.far = Math.max(12000, distance * 5);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    renderer.render(scene, camera);
  }, [
    cameraAngle,
    cameraYaw,
    defenderDeployments,
    defenderDragPreview,
    defenderFormationStateRef,
    defenderUnitTypesForFormation,
    editMode,
    effectiveCanEdit,
    fieldHeight,
    fieldWidth,
    ghost,
    ghostBlocked,
    itemCatalogById,
    open,
    panWorld.x,
    panWorld.y,
    resolveDefenderDeploymentRadius,
    selectedDeploymentId,
    selectedWallId,
    snapState,
    threeRef,
    viewport,
    walls,
    worldScale,
    zoom
  ]);
};

export default useBattlefieldScene;
