import { useCallback, useEffect } from 'react';
import * as THREE from 'three';
import {
  WALL_HEIGHT,
  WALL_ACTION_ICON_RISE,
  WALL_ACTION_ICON_GAP,
  WALL_ACTION_ICON_RADIUS,
  getDeploymentTotalCount,
  normalizeDefenderUnits,
  getWallTopZ,
  projectWorld
} from './battlefieldShared';
import {
  getPlacementReasonText,
  resolveSnapHighlightFacePoints
} from './battlefieldPlacementUtils';

const useBattlefieldOverlay = ({
  open = false,
  canvasRef,
  threeRef,
  wallActionButtonsRef,
  defenderActionButtonsRef,
  viewport,
  cameraAngle,
  cameraYaw,
  worldScale,
  walls,
  defenderDeployments,
  selectedDeploymentId,
  ghost,
  snapState,
  wallGroups,
  invalidReason,
  editMode,
  effectiveCanEdit,
  selectedWallId,
  itemCatalogById
}) => {
  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    wallActionButtonsRef.current = [];
    defenderActionButtonsRef.current = [];

    const drawPolygon = (points, fill, stroke) => {
      if (!points || points.length === 0) return;
      ctx.beginPath();
      points.forEach((p, index) => {
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const projectOverlayPoint = (x, y, z = 0) => {
      const camera = threeRef.current?.camera;
      if (camera) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        return {
          x: ((p.x + 1) * 0.5) * canvas.width,
          y: ((1 - p.y) * 0.5) * canvas.height,
          depth: p.z
        };
      }
      return projectWorld(x, y, z, viewport, cameraAngle, cameraYaw, worldScale);
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (snapState?.anchorId) {
      const anchor = walls.find((item) => item.id === snapState.anchorId);
      if (anchor) {
        const highlight = resolveSnapHighlightFacePoints(anchor, snapState, itemCatalogById);
        if (highlight?.points?.length === 4) {
          const projected = highlight.points.map((point) => projectOverlayPoint(point.x, point.y, point.z));
          drawPolygon(
            projected,
            highlight.kind === 'top' ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.11)',
            'rgba(56, 189, 248, 0.82)'
          );
        }
      }
    }

    wallGroups.forEach((group) => {
      const pos = projectOverlayPoint(group.center.x, group.center.y, group.center.z);
      const label = `${group.hp} / ${group.defense}`;
      ctx.font = '12px sans-serif';
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.lineWidth = 1;
      const boxX = pos.x - (textWidth / 2) - 8;
      const boxY = pos.y - 15;
      const boxW = textWidth + 16;
      const boxH = 18;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 8);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(label, pos.x - textWidth / 2, pos.y - 2);
    });

    (Array.isArray(defenderDeployments) ? defenderDeployments : [])
      .filter((deployment) => deployment?.placed !== false)
      .forEach((deployment) => {
        const units = normalizeDefenderUnits(deployment?.units, deployment?.unitTypeId, deployment?.count);
        if (units.length <= 0) return;
        const pos = projectOverlayPoint(Number(deployment?.x) || 0, Number(deployment?.y) || 0, 12);
        const totalCount = getDeploymentTotalCount(deployment);
        const labelName = (typeof deployment?.name === 'string' && deployment.name.trim()) ? deployment.name.trim() : '守军部队';
        const label = `${labelName} x${Math.max(1, totalCount)}`;

        ctx.font = '11px sans-serif';
        const textWidth = ctx.measureText(label).width;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(pos.x - (textWidth / 2) - 6, pos.y - 24, textWidth + 12, 16, 7);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
          ctx.fillRect(pos.x - (textWidth / 2) - 6, pos.y - 24, textWidth + 12, 16);
        }
        ctx.fillStyle = '#dbeafe';
        ctx.fillText(label, pos.x - (textWidth / 2), pos.y - 12);
      });

    const drawActionButton = (button) => {
      ctx.beginPath();
      ctx.arc(button.cx, button.cy, button.radius, 0, Math.PI * 2);
      ctx.fillStyle = button.type === 'move' ? 'rgba(30, 64, 175, 0.92)' : 'rgba(153, 27, 27, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(button.type === 'move' ? '✥' : '✕', button.cx, button.cy + 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    };

    if (editMode && effectiveCanEdit && !ghost && selectedWallId) {
      const selectedWall = walls.find((item) => item.id === selectedWallId);
      if (selectedWall) {
        const anchor = projectOverlayPoint(
          selectedWall.x,
          selectedWall.y,
          getWallTopZ(selectedWall) + (WALL_HEIGHT * 0.45)
        );
        const centerY = anchor.y - WALL_ACTION_ICON_RISE;
        const buttons = [
          {
            type: 'move',
            wallId: selectedWall.id,
            cx: anchor.x - (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS
          },
          {
            type: 'remove',
            wallId: selectedWall.id,
            cx: anchor.x + (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS
          }
        ];
        wallActionButtonsRef.current = buttons;

        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y - 4);
        ctx.lineTo(anchor.x, centerY + WALL_ACTION_ICON_RADIUS + 4);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();

        buttons.forEach(drawActionButton);
      }
    }

    if (editMode && effectiveCanEdit && !ghost && selectedDeploymentId) {
      const selectedDeployment = (Array.isArray(defenderDeployments) ? defenderDeployments : [])
        .find((item) => item.deployId === selectedDeploymentId && item?.placed !== false);
      if (selectedDeployment) {
        const anchor = projectOverlayPoint(
          Number(selectedDeployment?.x) || 0,
          Number(selectedDeployment?.y) || 0,
          16
        );
        const centerY = anchor.y - WALL_ACTION_ICON_RISE;
        const buttons = [
          {
            type: 'move',
            deployId: selectedDeployment.deployId,
            cx: anchor.x - (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS + 2
          },
          {
            type: 'remove',
            deployId: selectedDeployment.deployId,
            cx: anchor.x + (WALL_ACTION_ICON_GAP / 2),
            cy: centerY,
            radius: WALL_ACTION_ICON_RADIUS + 2
          }
        ];
        defenderActionButtonsRef.current = buttons;

        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y - 3);
        ctx.lineTo(anchor.x, centerY + WALL_ACTION_ICON_RADIUS + 4);
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();

        buttons.forEach(drawActionButton);
      }
    }

    if (snapState?.type) {
      const tip = snapState.type === 'top'
        ? '吸附: 上方堆叠'
        : `吸附: ${snapState.type}`;
      ctx.font = '12px sans-serif';
      const w = ctx.measureText(tip).width;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
      ctx.fillRect(14, 14, w + 14, 20);
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(tip, 21, 28);
    }
    if (invalidReason) {
      const text = `不可放置: ${getPlacementReasonText(invalidReason) || invalidReason}`;
      ctx.font = '12px sans-serif';
      const w = ctx.measureText(text).width;
      const y = 40;
      ctx.fillStyle = 'rgba(127, 29, 29, 0.8)';
      ctx.fillRect(14, y, w + 14, 20);
      ctx.fillStyle = '#fecaca';
      ctx.fillText(text, 21, y + 14);
    }
  }, [
    cameraAngle,
    cameraYaw,
    canvasRef,
    defenderActionButtonsRef,
    defenderDeployments,
    editMode,
    effectiveCanEdit,
    ghost,
    invalidReason,
    itemCatalogById,
    open,
    selectedDeploymentId,
    selectedWallId,
    snapState,
    threeRef,
    viewport,
    wallActionButtonsRef,
    wallGroups,
    walls,
    worldScale
  ]);

  const findWallActionButton = useCallback((sx, sy) => {
    const buttons = Array.isArray(wallActionButtonsRef.current) ? wallActionButtonsRef.current : [];
    for (const button of buttons) {
      const dx = sx - button.cx;
      const dy = sy - button.cy;
      if (Math.hypot(dx, dy) <= (button.radius + 2)) {
        return button;
      }
    }
    return null;
  }, [wallActionButtonsRef]);

  const findDefenderActionButton = useCallback((sx, sy) => {
    const buttons = Array.isArray(defenderActionButtonsRef.current) ? defenderActionButtonsRef.current : [];
    for (const button of buttons) {
      const dx = sx - button.cx;
      const dy = sy - button.cy;
      if (Math.hypot(dx, dy) <= (button.radius + 8)) {
        return button;
      }
    }
    return null;
  }, [defenderActionButtonsRef]);

  return {
    findWallActionButton,
    findDefenderActionButton
  };
};

export default useBattlefieldOverlay;
