import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import {
  CITY_CHANNEL_LAYER_LABELS,
  CITY_CHANNEL_TILE_TYPES,
  createCellKey,
  createWallKey
} from './cityChannelSchema';
import {
  TILE_RENDER_HEIGHT,
  TILE_RENDER_WIDTH,
  createEdgeWallGeometry,
  createPortalGeometry,
  createTileGeometry,
  projectCell
} from './cityChannelIsoGeometry';
import {
  buildThumbnailAssemblyColorMap,
  getCityChannelThumbnailClassName,
  isCityChannelThumbnailInteractionLocked,
  isPointerNearThumbnail
} from './cityChannelThumbnailUi';

const THUMBNAIL_PADDING = 22;
const THUMBNAIL_WIDTH = 236;
const THUMBNAIL_HEIGHT = 180;
const THUMBNAIL_LAYER_COLORS = [
  { top: '#d9b36c', side: '#8b5f2f', edge: '#fff4c7' },
  { top: '#70c1b3', side: '#257c75', edge: '#d7fff7' },
  { top: '#8fa8ff', side: '#3e5aa8', edge: '#e0e7ff' },
  { top: '#f08aa7', side: '#9a3d5a', edge: '#ffe1ea' },
  { top: '#9ee37d', side: '#3f8f42', edge: '#eaffdc' }
];
const THUMBNAIL_ASSEMBLY_COLORS = [
  { top: '#22d3ee', side: '#155e75', edge: '#ecfeff' },
  { top: '#f472b6', side: '#9d174d', edge: '#fdf2f8' },
  { top: '#34d399', side: '#065f46', edge: '#ecfdf5' },
  { top: '#fbbf24', side: '#92400e', edge: '#fffbeb' },
  { top: '#8b5cf6', side: '#4c1d95', edge: '#f5f3ff' },
  { top: '#ef4444', side: '#7f1d1d', edge: '#fff1f2' }
];
const THUMBNAIL_NEIGHBOR_OFFSETS = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 }
};

const stopThumbnailPointerEvent = (event) => {
  event.stopPropagation();
};

const polygonPoints = (points = []) => (
  points.map((point) => `${point.x},${point.y}`).join(' ')
);

const isFlatPlaneTile = (tile) => !!tile && !tile.isVertical;

export const getCityChannelLayerLabel = (z) => CITY_CHANNEL_LAYER_LABELS[z] || `${z + 1}层`;

export const getThumbnailYawForThreeCamera = (cameraYaw = 0) => (
  ((Number(cameraYaw) || 0) - 45 + 360) % 360
);

const getThumbnailLayerColor = (z = 0) => (
  THUMBNAIL_LAYER_COLORS[Math.abs(Number(z) || 0) % THUMBNAIL_LAYER_COLORS.length]
);

const getThumbnailAdjacentComponentKeys = (item) => {
  if (!item?.cell) return [];
  const { x, y, z } = item.cell;
  if (item.kind === 'wall') {
    const offset = THUMBNAIL_NEIGHBOR_OFFSETS[item.wall?.edge] || THUMBNAIL_NEIGHBOR_OFFSETS.north;
    return [
      createCellKey(x, y, z),
      createCellKey(x + offset.x, y + offset.y, z),
      createWallKey(x, y, z - 1, item.wall?.edge),
      createWallKey(x, y, z + 1, item.wall?.edge)
    ];
  }
  return Object.entries(THUMBNAIL_NEIGHBOR_OFFSETS).flatMap(([edge, offset]) => [
    createCellKey(x + offset.x, y + offset.y, z),
    createWallKey(x, y, z, edge),
    createWallKey(x + offset.x, y + offset.y, z, edge === 'north' ? 'south' : edge === 'south' ? 'north' : edge === 'east' ? 'west' : 'east')
  ]);
};

export const getCityChannelMapPlaneLevels = (mapData = {}) => {
  const levels = new Set([0]);
  Object.values(mapData.tiles || {}).forEach((tile) => {
    levels.add(Number(tile.z) || 0);
  });
  Object.values(mapData.walls || {}).forEach((wall) => {
    levels.add(Number(wall.z) || 0);
  });
  Object.values(mapData.racks || {}).forEach((rack) => {
    levels.add(Number(rack.z) || 0);
    levels.add(Number(rack.start?.z) || 0);
    levels.add(Number(rack.end?.z) || 0);
  });
  return Array.from(levels).sort((a, b) => a - b);
};

export const getNextCityChannelPlaneLevelAbove = (levels = [], z = 0) => (
  levels.find((level) => level > z) ?? null
);

const isVerticalAttachment = (item = {}) => (
  item.kind === 'wall' || !!item.tile?.isVertical
);

const isVisibleInLayerCut = ({ item, cutoff, nextPlaneLevel }) => {
  if (cutoff === null) return true;
  const z = Number(item?.cell?.z) || 0;
  if (z <= cutoff) return true;
  return isVerticalAttachment(item) && nextPlaneLevel !== null && z < nextPlaneLevel;
};

const getThumbnailBounds = (items = []) => {
  if (items.length === 0) {
    return {
      left: -TILE_RENDER_WIDTH / 2,
      right: TILE_RENDER_WIDTH / 2,
      top: -TILE_RENDER_HEIGHT / 2,
      bottom: TILE_RENDER_HEIGHT / 2
    };
  }
  return items.reduce((bounds, item) => ({
    left: Math.min(bounds.left, item.projection.x - (TILE_RENDER_WIDTH * 0.5)),
    right: Math.max(bounds.right, item.projection.x + (TILE_RENDER_WIDTH * 0.5)),
    top: Math.min(bounds.top, item.projection.y - (TILE_RENDER_HEIGHT * 0.62)),
    bottom: Math.max(bounds.bottom, item.projection.y + (TILE_RENDER_HEIGHT * 0.46))
  }), {
    left: Infinity,
    right: -Infinity,
    top: Infinity,
    bottom: -Infinity
  });
};

const createThumbnailItems = (mapData = {}, thumbnailYaw = 0) => {
  const tileItems = Object.values(mapData.tiles || {}).map((tile) => ({
    componentKey: createCellKey(tile.x, tile.y, tile.z),
    id: `tile:${createCellKey(tile.x, tile.y, tile.z)}`,
    kind: 'tile',
    cell: { x: tile.x, y: tile.y, z: tile.z },
    tile,
    projection: projectCell(tile, thumbnailYaw, mapData)
  }));
  const wallItems = Object.values(mapData.walls || {}).map((wall) => ({
    componentKey: createWallKey(wall.x, wall.y, wall.z, wall.edge),
    id: `wall:${createWallKey(wall.x, wall.y, wall.z, wall.edge)}`,
    kind: 'wall',
    cell: { x: wall.x, y: wall.y, z: wall.z },
    wall,
    projection: projectCell(wall, thumbnailYaw, mapData)
  }));
  return [...tileItems, ...wallItems].sort((a, b) => (
    ((a.cell.z || 0) - (b.cell.z || 0))
    || ((a.projection.y || 0) - (b.projection.y || 0))
    || String(a.id).localeCompare(String(b.id))
  ));
};

const applyRuntimeThumbnailSnapshot = (items = [], runtimeSnapshot = null) => {
  const placements = runtimeSnapshot?.placements || {};
  if (!runtimeSnapshot || Object.keys(placements).length <= 0) return items;
  return items.map((item) => {
    const runtimePlacement = placements[item.componentKey];
    if (!runtimePlacement) return item;
    return {
      ...item,
      cell: {
        x: runtimePlacement.x,
        y: runtimePlacement.y,
        z: runtimePlacement.z
      },
      tile: item.tile ? { ...item.tile, ...runtimePlacement } : item.tile,
      wall: item.wall ? { ...item.wall, ...runtimePlacement } : item.wall
    };
  });
};

const CityChannelThumbnail = ({
  mapData,
  assemblyGraph,
  cameraYaw = 0,
  activeTool,
  activeTileType,
  activeComponentType,
  carryActive,
  runtimeSnapshot,
  visibleLayerCutoff,
  onVisibleLayerCutoffChange,
  onSwitchLayer
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [hoverLayer, setHoverLayer] = useState(null);
  const [isNearCursor, setIsNearCursor] = useState(false);
  const thumbnailRef = useRef(null);
  const thumbnailYaw = getThumbnailYawForThreeCamera(cameraYaw);
  const isInteractionLocked = useMemo(() => (
    isCityChannelThumbnailInteractionLocked({
      activeTool,
      activeTileType,
      activeComponentType,
      carryActive
    })
  ), [activeTool, activeTileType, activeComponentType, carryActive]);
  const planeLevels = useMemo(() => getCityChannelMapPlaneLevels(mapData), [mapData]);
  const highestPlaneLevel = planeLevels[planeLevels.length - 1] ?? 0;
  const effectiveVisibleLayerCutoff = visibleLayerCutoff === null
    ? highestPlaneLevel
    : Math.max(0, Math.min(visibleLayerCutoff, highestPlaneLevel));
  const nextHiddenPlaneLevel = visibleLayerCutoff === null
    ? null
    : getNextCityChannelPlaneLevelAbove(planeLevels, effectiveVisibleLayerCutoff);
  const thumbnailItems = useMemo(() => (
    applyRuntimeThumbnailSnapshot(createThumbnailItems(mapData, thumbnailYaw), runtimeSnapshot)
      .map((item) => ({
        ...item,
        projection: projectCell(item.tile || item.wall || item.cell, thumbnailYaw, mapData)
      }))
      .sort((a, b) => (
        ((a.cell.z || 0) - (b.cell.z || 0))
        || ((a.projection.y || 0) - (b.projection.y || 0))
        || String(a.id).localeCompare(String(b.id))
      ))
  ), [mapData, runtimeSnapshot, thumbnailYaw]);
  const thumbnailAssemblyColorMap = useMemo(() => {
    const componentKeys = thumbnailItems.map((item) => item.componentKey).filter(Boolean);
    const componentKeySet = new Set(componentKeys);
    const adjacentPairs = [];
    thumbnailItems.forEach((item) => {
      getThumbnailAdjacentComponentKeys(item).forEach((adjacentKey) => {
        if (!componentKeySet.has(adjacentKey)) return;
        adjacentPairs.push([item.componentKey, adjacentKey]);
      });
    });
    return buildThumbnailAssemblyColorMap({
      assemblyGraph,
      componentKeys,
      adjacentPairs,
      palette: THUMBNAIL_ASSEMBLY_COLORS
    });
  }, [assemblyGraph, thumbnailItems]);

  useEffect(() => {
    if (!isInteractionLocked) {
      setIsNearCursor(false);
      return undefined;
    }
    const handlePointerMove = (event) => {
      const rect = thumbnailRef.current?.getBoundingClientRect();
      setIsNearCursor(isPointerNearThumbnail(event.clientX, event.clientY, rect));
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [isInteractionLocked]);

  const handleLayerClick = useCallback((z) => {
    onVisibleLayerCutoffChange?.(z);
    onSwitchLayer?.(z);
  }, [onSwitchLayer, onVisibleLayerCutoffChange]);

  const renderThumbnailItem = (item) => {
    const z = Number(item.cell?.z) || 0;
    const isHoveredLayer = hoverLayer !== null && hoverLayer === z;
    const isHiddenByCutoff = !isVisibleInLayerCut({
      item,
      cutoff: visibleLayerCutoff,
      nextPlaneLevel: nextHiddenPlaneLevel
    });
    const isCutoffLayer = visibleLayerCutoff !== null && z === effectiveVisibleLayerCutoff;
    const assemblyId = assemblyGraph?.assemblyByComponentKey?.[item.componentKey];
    const layerColor = thumbnailAssemblyColorMap[assemblyId] || getThumbnailLayerColor(z);
    const commonClass = [
      'city-channel-thumbnail-item',
      assemblyId ? 'is-mechanical-assembly' : '',
      isHoveredLayer ? 'is-hovered-layer' : '',
      isHiddenByCutoff ? 'is-above-cutoff' : '',
      isCutoffLayer ? 'is-cutoff-layer' : ''
    ].filter(Boolean).join(' ');
    const commonStyle = {
      left: `${item.projection.x}px`,
      top: `${item.projection.y}px`,
      zIndex: 1000 + (z * 100) + Math.round(item.projection.y || 0),
      '--thumbnail-top': layerColor.top,
      '--thumbnail-side': layerColor.side,
      '--thumbnail-edge': layerColor.edge
    };

    if (item.kind === 'tile' && (item.tile?.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE || item.tile?.panelType === CITY_CHANNEL_TILE_TYPES.EXIT)) {
      const portal = createPortalGeometry(thumbnailYaw, item.tile.rotation || 0);
      const geometry = createTileGeometry(thumbnailYaw, item.tile.rotation || 0);
      const isEntrance = item.tile.panelType === CITY_CHANNEL_TILE_TYPES.ENTRANCE;
      return (
        <div
          key={`thumb:${item.id}`}
          className={`${commonClass} is-portal-outline ${isEntrance ? 'is-entrance' : 'is-exit'}`}
          style={commonStyle}
          aria-hidden="true"
        >
          <svg className="city-channel-thumbnail-item__svg" viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}>
            {geometry.sides.map((points, index) => (
              <polygon key={`side-${index}`} className="city-channel-thumbnail-surface is-side" points={polygonPoints(points)} />
            ))}
            <polygon className="city-channel-thumbnail-surface is-top" points={polygonPoints(geometry.top)} />
            <polygon className="city-channel-thumbnail-surface is-attachment" points={polygonPoints(portal.threshold.top)} />
            <polygon className="city-channel-thumbnail-surface is-attachment" points={polygonPoints(portal.leftPillar.top)} />
            <polygon className="city-channel-thumbnail-surface is-attachment" points={polygonPoints(portal.rightPillar.top)} />
            <polygon className="city-channel-thumbnail-surface is-attachment" points={polygonPoints(portal.lintel.top)} />
            <polygon className="city-channel-thumbnail-surface is-portal-accent" points={polygonPoints(isEntrance ? portal.arrow : portal.reverseArrow)} />
          </svg>
        </div>
      );
    }

    if (item.kind === 'tile' && item.tile?.isVertical) {
      const geometry = createTileGeometry(thumbnailYaw, item.tile.rotation || 0);
      return (
        <div key={`thumb:${item.id}`} className={`${commonClass} is-wall-outline`} style={commonStyle} aria-hidden="true">
          <svg className="city-channel-thumbnail-item__svg" viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}>
            <polygon className="city-channel-thumbnail-surface is-wall" points={polygonPoints(geometry.wall)} />
            <polygon className="city-channel-thumbnail-surface is-wall-side" points={polygonPoints(geometry.wallSideStart)} />
            <polygon className="city-channel-thumbnail-surface is-wall-side" points={polygonPoints(geometry.wallSideEnd)} />
            <polygon className="city-channel-thumbnail-surface is-wall-cap" points={polygonPoints(geometry.wallCap)} />
          </svg>
        </div>
      );
    }

    if (item.kind === 'tile' && isFlatPlaneTile(item.tile)) {
      const geometry = createTileGeometry(thumbnailYaw, item.tile.rotation || 0);
      const planeSvg = (
        <svg className="city-channel-thumbnail-item__svg" viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`} aria-hidden="true">
          {geometry.sides.map((points, index) => (
            <polygon key={`side-${index}`} className="city-channel-thumbnail-surface is-side" points={polygonPoints(points)} />
          ))}
          <polygon className="city-channel-thumbnail-surface is-top" points={polygonPoints(geometry.top)} />
        </svg>
      );
      if (isInteractionLocked) {
        return (
          <div
            key={`thumb:${item.id}`}
            className={`${commonClass} is-plane`}
            style={commonStyle}
            aria-hidden="true"
          >
            {planeSvg}
          </div>
        );
      }
      return (
        <button
          key={`thumb:${item.id}`}
          type="button"
          className={`${commonClass} is-plane`}
          style={commonStyle}
          onPointerEnter={() => setHoverLayer(z)}
          onFocus={() => setHoverLayer(z)}
          onClick={(event) => {
            event.stopPropagation();
            handleLayerClick(z);
          }}
          title={getCityChannelLayerLabel(z)}
          aria-label={`缩略图${getCityChannelLayerLabel(z)}`}
        >
          {planeSvg}
        </button>
      );
    }

    if (item.kind === 'wall') {
      const geometry = createEdgeWallGeometry(thumbnailYaw, item.wall.edge);
      return (
        <div key={`thumb:${item.id}`} className={`${commonClass} is-wall-outline`} style={commonStyle} aria-hidden="true">
          <svg className="city-channel-thumbnail-item__svg" viewBox={`0 0 ${TILE_RENDER_WIDTH} ${TILE_RENDER_HEIGHT}`}>
            <polygon className="city-channel-thumbnail-surface is-wall" points={polygonPoints(geometry.wall)} />
            <polygon className="city-channel-thumbnail-surface is-wall-side" points={polygonPoints(geometry.wallSideStart)} />
            <polygon className="city-channel-thumbnail-surface is-wall-side" points={polygonPoints(geometry.wallSideEnd)} />
            <polygon className="city-channel-thumbnail-surface is-wall-cap" points={polygonPoints(geometry.wallCap)} />
          </svg>
        </div>
      );
    }

    return null;
  };

  const bounds = getThumbnailBounds(thumbnailItems);
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
  const scale = Math.min(
    0.36,
    (THUMBNAIL_WIDTH - (THUMBNAIL_PADDING * 2)) / boundsWidth,
    (THUMBNAIL_HEIGHT - (THUMBNAIL_PADDING * 2)) / boundsHeight
  );
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const stageTransform = `translate(${THUMBNAIL_WIDTH / 2}px, ${THUMBNAIL_HEIGHT / 2}px) scale(${scale}) translate(${-centerX}px, ${-centerY}px)`;

  return (
    <div
      ref={thumbnailRef}
      className={getCityChannelThumbnailClassName({
        isOpen,
        isLocked: isInteractionLocked,
        isNearCursor
      })}
      onPointerDown={isInteractionLocked ? undefined : stopThumbnailPointerEvent}
    >
      {isOpen ? (
        <div className="city-channel-thumbnail__panel">
          <div
            className="city-channel-thumbnail__stage"
            style={{
              width: `${THUMBNAIL_WIDTH}px`,
              height: `${THUMBNAIL_HEIGHT}px`
            }}
            onPointerLeave={() => setHoverLayer(null)}
          >
            <div className="city-channel-thumbnail__world" style={{ transform: stageTransform }}>
              {thumbnailItems.map(renderThumbnailItem)}
            </div>
          </div>
          {visibleLayerCutoff !== null && !isInteractionLocked ? (
            <button
              type="button"
              className="city-channel-thumbnail__restore"
              onClick={() => onVisibleLayerCutoffChange?.(null)}
            >
              恢复全部
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="city-channel-thumbnail__toggle"
        disabled={isInteractionLocked}
        onClick={() => {
          if (isInteractionLocked) return;
          setIsOpen((current) => !current);
        }}
        title={isOpen ? '收起缩略图' : '展开缩略图'}
        aria-label={isOpen ? '收起缩略图' : '展开缩略图'}
      >
        <Layers size={16} />
      </button>
    </div>
  );
};

export default CityChannelThumbnail;
