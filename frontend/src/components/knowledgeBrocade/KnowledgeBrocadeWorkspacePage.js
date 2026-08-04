import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Edit3, FileText, Keyboard, Moon, Network, Plus, RotateCcw, RotateCw, Search, Star, Sun, Trash2, X } from 'lucide-react';
import {
  createKnowledgeBrocadeNode,
  deleteKnowledgeBrocadeNode,
  getKnowledgeBrocadeGraph,
  restoreKnowledgeBrocadeNodes,
  updateKnowledgeBrocade,
  updateKnowledgeBrocadeNode,
  updateKnowledgeBrocadeNodeContent
} from './knowledgeBrocadeApi';
import './KnowledgeBrocadeWorkspacePage.css';
import KnowledgeBrocadeMiniMap from './KnowledgeBrocadeMiniMap';
import KnowledgeBrocadeSearchModal from './KnowledgeBrocadeSearchModal';
import KnowledgeBrocadeShortcutsModal from './KnowledgeBrocadeShortcutsModal';
import { markdownToRichHtml } from '../senseArticle/editor/paste/markdownToRichContent';

const WORKSPACE_PADDING_X = 144;
const WORKSPACE_PADDING_Y = 240;
const WORKSPACE_PADDING_X_MIN = 84;
const WORKSPACE_PADDING_Y_MIN = 132;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 122;
const NODE_SIZE_LIMITS = {
  minWidth: 168,
  maxWidth: 420,
  minHeight: 88,
  maxHeight: 320
};
const NODE_SHAPES = ['rounded', 'rectangle', 'pill'];
const NODE_RESIZE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];
const LEGACY_NODE_CONTENT_PLACEHOLDER = '在这里记录你的知识。';
const ZOOM_MAX = 1.22;
const ZOOM_DEFAULT = 1;
const DRAG_AUTOPAN_THRESHOLD = 84;
const DRAG_AUTOPAN_SPEED = 14;
const HISTORY_LIMIT = 60;
const EDITOR_AUTOSAVE_DELAY_MS = 900;
const CREATE_NODE_BASE_OFFSET_X = NODE_WIDTH + 54;
const CREATE_NODE_BASE_OFFSET_Y = Math.round(NODE_HEIGHT * 0.35);
const CREATE_NODE_STEP_X = Math.ceil(NODE_WIDTH * 0.62);
const CREATE_NODE_STEP_Y = Math.ceil(NODE_HEIGHT * 0.72);
const CREATE_NODE_MAX_OVERLAP_AREA = NODE_WIDTH * NODE_HEIGHT * 0.5;
const REPARENT_NODE_BASE_GAP_Y = 24;
const REPARENT_NODE_STEP_Y = NODE_HEIGHT + 28;
const REPARENT_NODE_STEP_X = 34;
const REPARENT_NODE_MAX_OVERLAP_AREA = NODE_WIDTH * NODE_HEIGHT * 0.18;
const THEME_STORAGE_KEY = 'knowledge-brocade-theme';
const EDGE_VIEW_MODE = {
  MERGED: 'merged',
  STRAIGHT: 'straight'
};
const VIEW_MODE = {
  TREE: 'tree',
  OUTLINE: 'outline'
};
const CANVAS_THEME = {
  DAY: 'day',
  NIGHT: 'night'
};

const MARKDOWN_HEADING_PREFIX_PATTERN = /^\s{0,3}#{1,6}\s+/;

const stripMarkdownHeadingPrefix = (value) => String(value || '').replace(MARKDOWN_HEADING_PREFIX_PATTERN, '').trim();

const normalizeNodeTitle = (value, fallback = '') => {
  const trimmed = stripMarkdownHeadingPrefix(value);
  return (trimmed || fallback).slice(0, 80);
};

const buildNodeEditorPreviewSource = (value = '') => {
  const normalized = String(value || '').replace(/\r/g, '');
  const lines = normalized.split('\n');
  const firstContentLineIndex = lines.findIndex((line) => line.trim());
  if (firstContentLineIndex < 0) return normalized;
  const titleText = stripMarkdownHeadingPrefix(lines[firstContentLineIndex]);
  if (!titleText) return normalized;
  lines[firstContentLineIndex] = `# ${titleText}`;
  return lines.join('\n');
};

const getNodeBodyContentText = (node = {}) => {
  const contentText = String(node?.contentText || '').replace(/\r/g, '');
  if (!contentText.trim()) return '';
  const titleText = String(node?.title || '').trim();
  const lines = contentText.split('\n');
  const titleLineIndex = lines.findIndex((line) => line.trim());
  const firstContentTitle = titleLineIndex >= 0 ? normalizeNodeTitle(lines[titleLineIndex], '') : '';
  if (titleText && firstContentTitle === normalizeNodeTitle(titleText, '')) {
    const bodyText = lines.slice(titleLineIndex + 1).join('\n');
    return bodyText.trim() === LEGACY_NODE_CONTENT_PLACEHOLDER ? '' : bodyText;
  }
  return contentText.trim() === LEGACY_NODE_CONTENT_PLACEHOLDER ? '' : contentText;
};

const buildNodeContentWithTitle = (node = {}, nextTitle = '') => {
  const normalizedContentText = String(node?.contentText || '').replace(/\r/g, '');
  if (!normalizedContentText.trim()) return `${nextTitle}\n\n`;
  const lines = normalizedContentText.split('\n');
  const firstContentLineIndex = lines.findIndex((line) => line.trim());
  if (firstContentLineIndex < 0) return `${nextTitle}\n\n`;
  lines[firstContentLineIndex] = nextTitle;
  return lines.join('\n');
};

const getTouchDistance = (touchA, touchB) => {
  if (!touchA || !touchB) return 0;
  return Math.hypot(touchA.clientX - touchB.clientX, touchA.clientY - touchB.clientY);
};

const getTouchMidpoint = (touchA, touchB, rect) => ({
  x: ((touchA.clientX + touchB.clientX) / 2) - rect.left,
  y: ((touchA.clientY + touchB.clientY) / 2) - rect.top
});

const getDragAutopanDelta = (distanceToEdge = 0) => {
  const clampedDistance = Math.max(0, Math.min(DRAG_AUTOPAN_THRESHOLD, distanceToEdge));
  if (clampedDistance <= 0) return 0;
  const strength = clampedDistance / DRAG_AUTOPAN_THRESHOLD;
  return Math.round(DRAG_AUTOPAN_SPEED * strength * strength);
};

const getStageShellMetrics = (canvasMetrics, viewportSize, zoomValue) => {
  const stageDisplayWidth = canvasMetrics.width * zoomValue;
  const stageDisplayHeight = canvasMetrics.height * zoomValue;
  const shellWidth = Math.max(viewportSize.width || 0, stageDisplayWidth);
  const shellHeight = Math.max(viewportSize.height || 0, stageDisplayHeight);
  return {
    stageDisplayWidth,
    stageDisplayHeight,
    shellWidth,
    shellHeight,
    stageOffsetX: Math.max(0, (shellWidth - stageDisplayWidth) / 2),
    stageOffsetY: Math.max(0, (shellHeight - stageDisplayHeight) / 2)
  };
};

const clampNodeDimension = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback)));
};

const getNodeSize = (node = {}) => ({
  width: clampNodeDimension(node?.size?.width, NODE_WIDTH, NODE_SIZE_LIMITS.minWidth, NODE_SIZE_LIMITS.maxWidth),
  height: clampNodeDimension(node?.size?.height, NODE_HEIGHT, NODE_SIZE_LIMITS.minHeight, NODE_SIZE_LIMITS.maxHeight)
});

const normalizeNodeShape = (value = '') => (
  NODE_SHAPES.includes(String(value || '').trim()) ? String(value || '').trim() : 'rounded'
);

const getNodeCenterPoint = (node, originX, originY) => ({
  x: originX + (Number(node?.position?.x) || 0) + getNodeSize(node).width / 2,
  y: originY + (Number(node?.position?.y) || 0) + getNodeSize(node).height / 2
});

const cloneNodePosition = (position = {}) => ({
  x: Math.round(Number(position?.x) || 0),
  y: Math.round(Number(position?.y) || 0)
});

const arePositionsEqual = (left, right) => (
  (Number(left?.x) || 0) === (Number(right?.x) || 0)
  && (Number(left?.y) || 0) === (Number(right?.y) || 0)
);

const snapshotNodeForHistory = (node = {}) => ({
  _id: node?._id || '',
  parentNodeId: node?.parentNodeId || '',
  isRoot: !!node?.isRoot,
  isStarred: !!node?.isStarred,
  title: node?.title || '',
  previewText: node?.previewText || '',
  contentText: node?.contentText || '',
  shape: normalizeNodeShape(node?.shape),
  size: getNodeSize(node),
  position: cloneNodePosition(node?.position)
});

const collectNodeSubtreeSnapshots = (nodes = [], rootNodeId = '') => {
  const childrenMap = new Map();
  const nodeMap = new Map();
  nodes.forEach((node) => {
    const nodeId = node?._id || '';
    const parentNodeId = node?.parentNodeId || '';
    if (!nodeId) return;
    nodeMap.set(nodeId, node);
    if (!childrenMap.has(parentNodeId)) {
      childrenMap.set(parentNodeId, []);
    }
    childrenMap.get(parentNodeId).push(nodeId);
  });
  if (!nodeMap.has(rootNodeId)) return [];
  const orderedIds = [];
  const queue = [rootNodeId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || !nodeMap.has(currentId)) continue;
    orderedIds.push(currentId);
    (childrenMap.get(currentId) || []).forEach((childId) => queue.push(childId));
  }
  return orderedIds
    .map((nodeId) => snapshotNodeForHistory(nodeMap.get(nodeId)))
    .filter((node) => !!node?._id);
};

const getNodeOverlapArea = (candidatePosition = {}, node = {}) => {
  const nodeSize = getNodeSize(node);
  const candidateLeft = Number(candidatePosition?.x) || 0;
  const candidateTop = Number(candidatePosition?.y) || 0;
  const candidateRight = candidateLeft + NODE_WIDTH;
  const candidateBottom = candidateTop + NODE_HEIGHT;
  const nodeLeft = Number(node?.position?.x) || 0;
  const nodeTop = Number(node?.position?.y) || 0;
  const nodeRight = nodeLeft + nodeSize.width;
  const nodeBottom = nodeTop + nodeSize.height;
  const overlapWidth = Math.max(0, Math.min(candidateRight, nodeRight) - Math.max(candidateLeft, nodeLeft));
  const overlapHeight = Math.max(0, Math.min(candidateBottom, nodeBottom) - Math.max(candidateTop, nodeTop));
  return overlapWidth * overlapHeight;
};

const buildCreateNodeRowOffsets = (count = 10) => {
  const offsets = [0];
  for (let index = 1; index <= count; index += 1) {
    offsets.push(index, -index);
  }
  return offsets;
};

const resolveCreateNodePosition = (parentNode, nodes = []) => {
  const parentX = Number(parentNode?.position?.x) || 0;
  const parentY = Number(parentNode?.position?.y) || 0;
  const rowOffsets = buildCreateNodeRowOffsets(10);
  let bestPosition = {
    x: parentX + CREATE_NODE_BASE_OFFSET_X,
    y: parentY + CREATE_NODE_BASE_OFFSET_Y
  };
  let bestWorstOverlap = Number.POSITIVE_INFINITY;
  let bestTotalOverlap = Number.POSITIVE_INFINITY;

  const evaluateCandidate = (position) => {
    const overlaps = nodes.map((node) => getNodeOverlapArea(position, node));
    const worstOverlap = overlaps.reduce((max, area) => Math.max(max, area), 0);
    const totalOverlap = overlaps.reduce((sum, area) => sum + area, 0);
    if (
      worstOverlap < bestWorstOverlap
      || (worstOverlap === bestWorstOverlap && totalOverlap < bestTotalOverlap)
    ) {
      bestPosition = position;
      bestWorstOverlap = worstOverlap;
      bestTotalOverlap = totalOverlap;
    }
    return worstOverlap <= CREATE_NODE_MAX_OVERLAP_AREA;
  };

  for (let columnIndex = 0; columnIndex <= 10; columnIndex += 1) {
    const rightX = parentX + CREATE_NODE_BASE_OFFSET_X + columnIndex * CREATE_NODE_STEP_X;
    for (const rowOffset of rowOffsets) {
      const candidate = {
        x: rightX,
        y: parentY + CREATE_NODE_BASE_OFFSET_Y + rowOffset * CREATE_NODE_STEP_Y
      };
      if (evaluateCandidate(candidate)) {
        return cloneNodePosition(candidate);
      }
    }
  }

  for (let columnIndex = 0; columnIndex <= 6; columnIndex += 1) {
    const leftX = parentX - CREATE_NODE_BASE_OFFSET_X - columnIndex * CREATE_NODE_STEP_X;
    for (const rowOffset of rowOffsets) {
      const candidate = {
        x: leftX,
        y: parentY + rowOffset * CREATE_NODE_STEP_Y
      };
      if (evaluateCandidate(candidate)) {
        return cloneNodePosition(candidate);
      }
    }
  }

  return cloneNodePosition(bestPosition);
};

const resolveReparentNodePosition = (parentNode, draggedNodeId = '', nodes = []) => {
  const parentX = Number(parentNode?.position?.x) || 0;
  const parentY = Number(parentNode?.position?.y) || 0;
  const parentSize = getNodeSize(parentNode);
  const blockedNodes = nodes.filter((node) => node?._id && node._id !== draggedNodeId);
  const siblingNodes = blockedNodes.filter((node) => node?.parentNodeId === parentNode?._id);
  const siblingBottomY = siblingNodes.reduce((maxY, node) => (
    Math.max(maxY, (Number(node?.position?.y) || 0) + getNodeSize(node).height)
  ), parentY + parentSize.height);
  const startY = Math.max(parentY + parentSize.height + REPARENT_NODE_BASE_GAP_Y, siblingBottomY + REPARENT_NODE_BASE_GAP_Y);
  const xOffsets = [0, -1, 1, -2, 2, -3, 3];
  let bestPosition = { x: parentX, y: startY };
  let bestWorstOverlap = Number.POSITIVE_INFINITY;
  let bestTotalOverlap = Number.POSITIVE_INFINITY;

  const evaluateCandidate = (position) => {
    const overlaps = blockedNodes.map((node) => getNodeOverlapArea(position, node));
    const worstOverlap = overlaps.reduce((max, area) => Math.max(max, area), 0);
    const totalOverlap = overlaps.reduce((sum, area) => sum + area, 0);
    if (
      worstOverlap < bestWorstOverlap
      || (worstOverlap === bestWorstOverlap && totalOverlap < bestTotalOverlap)
    ) {
      bestPosition = position;
      bestWorstOverlap = worstOverlap;
      bestTotalOverlap = totalOverlap;
    }
    return worstOverlap <= REPARENT_NODE_MAX_OVERLAP_AREA;
  };

  for (let rowIndex = 0; rowIndex <= 10; rowIndex += 1) {
    for (const xOffset of xOffsets) {
      const candidate = {
        x: parentX + xOffset * REPARENT_NODE_STEP_X,
        y: startY + rowIndex * REPARENT_NODE_STEP_Y
      };
      if (evaluateCandidate(candidate)) {
        return cloneNodePosition(candidate);
      }
    }
  }

  return cloneNodePosition(bestPosition);
};

const renderEdgeStrokeGroup = (key, pathData, branchWidth, highlightWidth, options = {}) => {
  const previewClassName = options?.isPreview ? ' is-preview' : '';
  return (
    <g key={key}>
      <path
        d={pathData}
        className={`jinzhi-graph-edge jinzhi-graph-edge--shadow${previewClassName}`}
        style={{ strokeWidth: branchWidth + 1.2 }}
      />
      <path
        d={pathData}
        className={`jinzhi-graph-edge jinzhi-graph-edge--wood${previewClassName}`}
        style={{ strokeWidth: branchWidth }}
      />
      <path
        d={pathData}
        className={`jinzhi-graph-edge jinzhi-graph-edge--highlight${previewClassName}`}
        style={{ strokeWidth: highlightWidth }}
      />
    </g>
  );
};

const buildTreeMetrics = (nodes = []) => {
  const byId = new Map(nodes.map((node) => [node?._id, node]));
  const childrenMap = new Map();
  nodes.forEach((node) => {
    const parentId = node?.parentNodeId || '';
    if (!parentId) return;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId).push(node._id);
  });

  const depthMap = new Map();
  const roots = nodes.filter((node) => node?.isRoot || !node?.parentNodeId);
  const queue = roots.map((node) => ({ id: node._id, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current?.id || depthMap.has(current.id)) continue;
    depthMap.set(current.id, current.depth);
    (childrenMap.get(current.id) || []).forEach((childId) => {
      if (byId.has(childId)) {
        queue.push({ id: childId, depth: current.depth + 1 });
      }
    });
  }

  const subtreeSizeMap = new Map();
  const countSubtree = (nodeId) => {
    if (!nodeId || subtreeSizeMap.has(nodeId)) {
      return subtreeSizeMap.get(nodeId) || 1;
    }
    const size = 1 + (childrenMap.get(nodeId) || []).reduce((sum, childId) => sum + countSubtree(childId), 0);
    subtreeSizeMap.set(nodeId, size);
    return size;
  };
  nodes.forEach((node) => countSubtree(node?._id));

  return { depthMap, subtreeSizeMap };
};

const isNodeDescendantOf = (nodes = [], nodeId = '', ancestorNodeId = '') => {
  if (!nodeId || !ancestorNodeId || nodeId === ancestorNodeId) return nodeId === ancestorNodeId;
  const parentById = new Map(nodes.map((node) => [node?._id, node?.parentNodeId || '']));
  const visited = new Set();
  let currentId = nodeId;
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorNodeId) return true;
    visited.add(currentId);
    currentId = parentById.get(currentId) || '';
  }
  return false;
};

const canPreviewBrocadeReparent = (nodes = [], draggedNodeId = '', targetNodeId = '') => {
  if (!draggedNodeId || !targetNodeId || draggedNodeId === targetNodeId) return false;
  const nodesById = new Map(nodes.map((node) => [node?._id, node]));
  const draggedNode = nodesById.get(draggedNodeId);
  const targetNode = nodesById.get(targetNodeId);
  if (!draggedNode || !targetNode || draggedNode?.isRoot) return false;
  if ((draggedNode?.parentNodeId || '') === targetNodeId) return false;
  return !isNodeDescendantOf(nodes, targetNodeId, draggedNodeId);
};

const canMoveBrocadeNodeToParent = (nodes = [], draggedNodeId = '', nextParentNodeId = '') => {
  if (!draggedNodeId || !nextParentNodeId || draggedNodeId === nextParentNodeId) return false;
  const nodesById = new Map(nodes.map((node) => [node?._id, node]));
  const draggedNode = nodesById.get(draggedNodeId);
  const nextParentNode = nodesById.get(nextParentNodeId);
  if (!draggedNode || !nextParentNode || draggedNode?.isRoot) return false;
  if ((draggedNode?.parentNodeId || '') === nextParentNodeId) return true;
  return !isNodeDescendantOf(nodes, nextParentNodeId, draggedNodeId);
};

const resolveOutlineSiblingDropPosition = (nodes = [], draggedNodeId = '', targetNode = null, placement = 'after') => {
  if (!targetNode?._id || !['before', 'after'].includes(placement)) return null;
  const targetX = Number(targetNode?.position?.x) || 0;
  const targetY = Number(targetNode?.position?.y) || 0;
  const targetHeight = getNodeSize(targetNode).height;
  const direction = placement === 'before' ? -1 : 1;
  const xOffsets = [0, -1, 1, -2, 2, -3, 3];
  const blockedNodes = nodes.filter((node) => node?._id && node?._id !== draggedNodeId);
  let bestPosition = {
    x: targetX,
    y: targetY + direction * (targetHeight + REPARENT_NODE_BASE_GAP_Y)
  };
  let bestWorstOverlap = Number.POSITIVE_INFINITY;
  let bestTotalOverlap = Number.POSITIVE_INFINITY;

  const evaluateCandidate = (position) => {
    const overlaps = blockedNodes.map((node) => getNodeOverlapArea(position, node));
    const worstOverlap = overlaps.reduce((max, area) => Math.max(max, area), 0);
    const totalOverlap = overlaps.reduce((sum, area) => sum + area, 0);
    if (
      worstOverlap < bestWorstOverlap
      || (worstOverlap === bestWorstOverlap && totalOverlap < bestTotalOverlap)
    ) {
      bestPosition = position;
      bestWorstOverlap = worstOverlap;
      bestTotalOverlap = totalOverlap;
    }
    return worstOverlap <= REPARENT_NODE_MAX_OVERLAP_AREA;
  };

  for (let rowIndex = 0; rowIndex <= 10; rowIndex += 1) {
    for (const xOffset of xOffsets) {
      const distance = targetHeight + REPARENT_NODE_BASE_GAP_Y + rowIndex * REPARENT_NODE_STEP_Y;
      const candidate = {
        x: targetX + xOffset * REPARENT_NODE_STEP_X,
        y: targetY + direction * distance
      };
      if (evaluateCandidate(candidate)) {
        return cloneNodePosition(candidate);
      }
    }
  }

  return cloneNodePosition(bestPosition);
};

const getCanvasPointFromClientPoint = (
  clientX,
  clientY,
  container,
  stageOffsetX,
  stageOffsetY,
  zoomValue
) => {
  if (!container) return null;
  const rect = container.getBoundingClientRect();
  const zoomScale = zoomValue || ZOOM_DEFAULT;
  return {
    x: (container.scrollLeft + clientX - rect.left - stageOffsetX) / zoomScale,
    y: (container.scrollTop + clientY - rect.top - stageOffsetY) / zoomScale
  };
};

const resolveDragReparentTargetId = ({
  nodes = [],
  hitTestNodes = nodes,
  draggedNodeId = '',
  clientX = 0,
  clientY = 0,
  container = null,
  canvasMetrics = {},
  stageOffsetX = 0,
  stageOffsetY = 0,
  zoomValue = ZOOM_DEFAULT
}) => {
  if (!draggedNodeId || !container) return '';
  const point = getCanvasPointFromClientPoint(clientX, clientY, container, stageOffsetX, stageOffsetY, zoomValue);
  if (!point) return '';
  for (let index = hitTestNodes.length - 1; index >= 0; index -= 1) {
    const node = hitTestNodes[index];
    const nodeId = node?._id || '';
    if (!nodeId || nodeId === draggedNodeId) continue;
    const left = (Number(canvasMetrics.originX) || 0) + (Number(node?.position?.x) || 0);
    const top = (Number(canvasMetrics.originY) || 0) + (Number(node?.position?.y) || 0);
    const isInside = (
      point.x >= left
      && point.x <= left + getNodeSize(node).width
      && point.y >= top
      && point.y <= top + getNodeSize(node).height
    );
    if (isInside && canPreviewBrocadeReparent(nodes, draggedNodeId, nodeId)) {
      return nodeId;
    }
  }
  return '';
};

const buildBrocadeOutlineTree = (nodes = []) => {
  const nodesById = new Map();
  const childrenMap = new Map();
  const sortNodes = (items = []) => [...items].sort((left, right) => (
    (Number(left?.position?.y) || 0) - (Number(right?.position?.y) || 0)
    || (Number(left?.position?.x) || 0) - (Number(right?.position?.x) || 0)
    || String(left?._id || '').localeCompare(String(right?._id || ''))
  ));

  nodes.forEach((node) => {
    const nodeId = node?._id || '';
    if (!nodeId) return;
    nodesById.set(nodeId, node);
  });

  nodes.forEach((node) => {
    const nodeId = node?._id || '';
    const parentNodeId = node?.parentNodeId || '';
    if (!nodeId || !parentNodeId || !nodesById.has(parentNodeId)) return;
    if (!childrenMap.has(parentNodeId)) {
      childrenMap.set(parentNodeId, []);
    }
    childrenMap.get(parentNodeId).push(node);
  });

  const buildNode = (node, depth = 0) => ({
    node,
    depth,
    children: sortNodes(childrenMap.get(node?._id) || []).map((childNode) => buildNode(childNode, depth + 1))
  });

  return sortNodes(
    nodes.filter((node) => {
      const parentNodeId = node?.parentNodeId || '';
      return node?.isRoot || !parentNodeId || !nodesById.has(parentNodeId);
    })
  ).map((node) => buildNode(node));
};

const sortBrocadeNodesByPosition = (nodes = []) => [...nodes].sort((left, right) => (
  (Number(left?.position?.y) || 0) - (Number(right?.position?.y) || 0)
  || (Number(left?.position?.x) || 0) - (Number(right?.position?.x) || 0)
  || String(left?._id || '').localeCompare(String(right?._id || ''))
));

const resolveOutlineSiblingInsertion = (siblingNode, nodes = []) => {
  const parentNodeId = siblingNode?.parentNodeId || '';
  const siblingNodes = sortBrocadeNodesByPosition(
    nodes.filter((node) => (node?.parentNodeId || '') === parentNodeId)
  );
  const siblingIndex = siblingNodes.findIndex((node) => node?._id === siblingNode?._id);
  const siblingSize = getNodeSize(siblingNode);
  const position = {
    x: Number(siblingNode?.position?.x) || 0,
    y: (Number(siblingNode?.position?.y) || 0) + siblingSize.height + REPARENT_NODE_BASE_GAP_Y
  };
  if (siblingIndex < 0) return { position, moves: [] };

  const moves = [];
  let previousBottomY = position.y + NODE_HEIGHT;
  siblingNodes.slice(siblingIndex + 1).forEach((node) => {
    const currentPosition = cloneNodePosition(node?.position);
    const nextY = Math.max(
      Number(node?.position?.y) || 0,
      previousBottomY + REPARENT_NODE_BASE_GAP_Y
    );
    const nextPosition = cloneNodePosition({
      x: Number(node?.position?.x) || position.x,
      y: nextY
    });
    if (!arePositionsEqual(currentPosition, nextPosition)) {
      moves.push({
        nodeId: node?._id,
        beforePosition: currentPosition,
        afterPosition: nextPosition,
        beforeParentNodeId: node?.parentNodeId || '',
        afterParentNodeId: node?.parentNodeId || ''
      });
    }
    previousBottomY = nextY + getNodeSize(node).height;
  });

  return { position, moves };
};

const getOutlineSelectionRoots = (nodes = [], selectedIds = []) => {
  const selectedIdSet = new Set(selectedIds.filter(Boolean));
  return nodes.filter((node) => {
    if (!selectedIdSet.has(node?._id) || node?.isRoot) return selectedIdSet.has(node?._id);
    return !Array.from(selectedIdSet).some((ancestorId) => (
      ancestorId !== node?._id && isNodeDescendantOf(nodes, node?._id, ancestorId)
    ));
  });
};

const collectBrocadeOutlineExpandableIds = (branches = []) => {
  const ids = [];
  branches.forEach((branch) => {
    const nodeId = branch?.node?._id || '';
    if (nodeId && Array.isArray(branch?.children) && branch.children.length > 0) {
      ids.push(nodeId);
      ids.push(...collectBrocadeOutlineExpandableIds(branch.children));
    }
  });
  return ids;
};

const formatBrocadeTextPreviewBranch = (branch, depth = 0) => {
  const node = branch?.node || {};
  if (!node?._id) return [];
  const indent = '  '.repeat(depth);
  const bodyIndent = '  '.repeat(depth + 2);
  const title = normalizeNodeTitle(node?.title, '').replace(/\s+/g, ' ');
  const bodyText = getNodeBodyContentText(node).trim();
  const lines = [`${indent}- ${title}`];
  if (bodyText) {
    lines.push(`${indent}  内容：`);
    bodyText.split('\n').forEach((line) => {
      lines.push(`${bodyIndent}${line}`);
    });
  }
  (branch?.children || []).forEach((childBranch) => {
    lines.push(...formatBrocadeTextPreviewBranch(childBranch, depth + 1));
  });
  return lines;
};

const buildBrocadeTextPreview = (nodes = []) => {
  const outlineTree = buildBrocadeOutlineTree(nodes);
  return outlineTree
    .flatMap((branch) => formatBrocadeTextPreviewBranch(branch, 0))
    .filter(Boolean)
    .join('\n');
};

const BrocadeOutlineTreeBranch = ({
  branch,
  activeNodeId = '',
  selectedNodeIds,
  expandedIds,
  onToggle,
  onSelect,
  editingNodeId = '',
  editingTitle = '',
  onStartTitleEdit,
  onChangeTitle,
  onCommitTitle,
  onCancelTitle,
  onConfirmTitleAndCreateSibling,
  onNavigateFromTitle,
  draggedNodeId = '',
  dropTargetNodeId = '',
  dropPlacement = '',
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  setRowRef,
  setItemRef,
  setTitleInputRef
}) => {
  const currentNode = branch?.node || null;
  const hasChildren = Array.isArray(branch?.children) && branch.children.length > 0;
  const isExpanded = hasChildren ? expandedIds.has(currentNode?._id) : false;
  const isActive = currentNode?._id === activeNodeId;
  const isSelected = selectedNodeIds.has(currentNode?._id);
  const isEditingTitle = editingNodeId === currentNode?._id;
  const isDragging = draggedNodeId === currentNode?._id;
  const isDropTarget = dropTargetNodeId === currentNode?._id;
  if (!currentNode?._id) return null;
  return (
    <div className="jinzhi-outline-view__branch">
      <div
        ref={(element) => setRowRef(currentNode._id, element)}
        className="jinzhi-outline-view__row"
        style={{ '--jinzhi-outline-depth': branch.depth || 0 }}
        data-node-id={currentNode._id}
      >
        {hasChildren ? (
          <button
            type="button"
            className="jinzhi-outline-view__toggle"
            aria-label={isExpanded ? '收起下级节点' : '展开下级节点'}
            aria-expanded={isExpanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(currentNode._id);
            }}
          >
            {isExpanded ? '−' : '+'}
          </button>
        ) : (
          <span className="jinzhi-outline-view__toggle-placeholder" aria-hidden="true" />
        )}
        <div
          ref={(element) => setItemRef(currentNode._id, element)}
          className={`jinzhi-outline-view__item${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${currentNode?.isRoot ? ' is-root' : ''}${isDragging ? ' is-dragging' : ''}${isDropTarget ? ` is-drop-target is-drop-${dropPlacement}` : ''}`}
          role="treeitem"
          tabIndex={0}
          aria-selected={isSelected}
          onClick={(event) => onSelect(currentNode._id, event)}
          onDragOver={(event) => onDragOver(currentNode._id, event)}
          onDrop={(event) => onDrop(currentNode._id, event)}
        >
          {isEditingTitle ? (
            <input
              ref={(element) => setTitleInputRef(currentNode._id, element)}
              type="text"
              className="jinzhi-outline-view__title-input"
              value={editingTitle}
              maxLength={80}
              placeholder="未命名节点"
              aria-label="编辑节点标题"
              autoFocus
              onChange={(event) => onChangeTitle(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  event.stopPropagation();
                  onNavigateFromTitle(currentNode._id, event.currentTarget.value, event.key);
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  const nextTitle = event.currentTarget.value;
                  const isNewUntitledNode = !String(currentNode?.title || '').trim();
                  if (isNewUntitledNode) {
                    onConfirmTitleAndCreateSibling(currentNode._id, nextTitle);
                    return;
                  }
                  onCommitTitle(currentNode._id, nextTitle);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onCancelTitle();
                }
              }}
              onBlur={(event) => onCommitTitle(currentNode._id, event.currentTarget.value)}
            />
          ) : (
            <span
              className="jinzhi-outline-view__title"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(currentNode._id, event);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onStartTitleEdit(currentNode._id);
              }}
              title="双击修改标题"
            >
              {normalizeNodeTitle(currentNode?.title, '未命名节点')}
            </span>
          )}
          {currentNode?.isStarred ? <span className="jinzhi-outline-view__tag">星标</span> : null}
          <button
            type="button"
            className="jinzhi-outline-view__drag-handle"
            draggable={!currentNode?.isRoot}
            aria-label={currentNode?.isRoot ? '根节点不可移动' : '拖拽移动节点'}
            title={currentNode?.isRoot ? '根节点不可移动' : '拖拽到上下位置或其他节点下'}
            disabled={currentNode?.isRoot}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(currentNode._id, event);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(currentNode._id, event);
            }}
            onDragStart={(event) => onDragStart(currentNode._id, event)}
            onDragEnd={onDragEnd}
          >
            ↕
          </button>
        </div>
      </div>
      {hasChildren && isExpanded ? (
        <div className="jinzhi-outline-view__children">
          {branch.children.map((childBranch) => (
            <BrocadeOutlineTreeBranch
              key={childBranch?.node?._id || `${currentNode._id}-child`}
              branch={childBranch}
              activeNodeId={activeNodeId}
              selectedNodeIds={selectedNodeIds}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              editingNodeId={editingNodeId}
              editingTitle={editingTitle}
              onStartTitleEdit={onStartTitleEdit}
              onChangeTitle={onChangeTitle}
              onCommitTitle={onCommitTitle}
              onCancelTitle={onCancelTitle}
              onConfirmTitleAndCreateSibling={onConfirmTitleAndCreateSibling}
              onNavigateFromTitle={onNavigateFromTitle}
              draggedNodeId={draggedNodeId}
              dropTargetNodeId={dropTargetNodeId}
              dropPlacement={dropPlacement}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              setRowRef={setRowRef}
              setItemRef={setItemRef}
              setTitleInputRef={setTitleInputRef}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const BrocadeOutlineTreeView = ({
  nodes = [],
  activeNodeId = '',
  selectedNodeIds = new Set(),
  onSelect,
  onLassoSelect,
  editingNodeId = '',
  editingTitle = '',
  onStartTitleEdit,
  onChangeTitle,
  onCommitTitle,
  onCancelTitle,
  onConfirmTitleAndCreateSibling,
  onNavigateFromTitle,
  onNavigate,
  onCreateSibling,
  onRequestDelete,
  onMoveNode
}) => {
  const outlineTree = useMemo(() => buildBrocadeOutlineTree(nodes), [nodes]);
  const [expandedIds, setExpandedIds] = useState([]);
  const [lassoRect, setLassoRect] = useState(null);
  const rowRefs = useRef(new Map());
  const itemRefs = useRef(new Map());
  const titleInputRefs = useRef(new Map());
  const treeRef = useRef(null);
  const pointerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [pointerPosition, setPointerPosition] = useState(null);
  const [dragState, setDragState] = useState(null);
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const visibleOutlineNodes = useMemo(() => {
    const visibleNodes = [];
    const appendBranches = (branches = []) => {
      branches.forEach((branch) => {
        if (!branch?.node?._id) return;
        visibleNodes.push(branch.node);
        if (expandedIdSet.has(branch.node._id)) {
          appendBranches(branch.children || []);
        }
      });
    };
    appendBranches(outlineTree);
    return visibleNodes;
  }, [expandedIdSet, outlineTree]);
  const selectedOutlineNodes = useMemo(() => (
    nodes.filter((node) => node?._id && selectedNodeIds.has(node._id))
  ), [nodes, selectedNodeIds]);
  const deletableSelectedNodes = useMemo(() => (
    selectedOutlineNodes.filter((node) => !node.isRoot)
  ), [selectedOutlineNodes]);
  const deleteActionAnchor = useMemo(() => {
    if (
      selectedNodeIds.size < 2
      || deletableSelectedNodes.length !== selectedOutlineNodes.length
      || !pointerPosition
    ) return null;
    let closest = null;
    deletableSelectedNodes.forEach((node) => {
      const item = itemRefs.current.get(node._id);
      if (!item) return;
      const rect = item.getBoundingClientRect();
      const distance = Math.hypot(
        pointerPosition.x - (rect.left + rect.width / 2),
        pointerPosition.y - (rect.top + rect.height / 2)
      );
      if (!closest || distance < closest.distance) {
        closest = { nodeId: node._id, distance, rect };
      }
    });
    if (!closest) return null;
    return {
      nodeId: closest.nodeId,
      left: closest.rect.left + closest.rect.width / 2,
      top: Math.max(8, closest.rect.top - 40)
    };
  }, [deletableSelectedNodes, pointerPosition, selectedNodeIds.size, selectedOutlineNodes.length]);

  const resolveDropState = useCallback((targetNodeId, event) => {
    const draggedNodeId = dragState?.nodeId || event.dataTransfer?.getData('text/plain') || '';
    if (!draggedNodeId || draggedNodeId === targetNodeId) return null;
    const targetNode = nodes.find((node) => node?._id === targetNodeId);
    if (!targetNode?._id) return null;
    const targetRect = event.currentTarget.getBoundingClientRect();
    const relativeY = (event.clientY - targetRect.top) / Math.max(1, targetRect.height);
    const placement = relativeY < 0.25 ? 'before' : (relativeY > 0.75 ? 'after' : 'child');
    const nextParentNodeId = placement === 'child'
      ? targetNodeId
      : targetNode.parentNodeId || '';
    if (!canMoveBrocadeNodeToParent(nodes, draggedNodeId, nextParentNodeId)) return null;
    return { nodeId: draggedNodeId, targetNodeId, placement };
  }, [dragState?.nodeId, nodes]);

  const handleDragStart = useCallback((nodeId, event) => {
    if (!nodeId || nodes.find((node) => node?._id === nodeId)?.isRoot) return;
    event.stopPropagation();
    event.dataTransfer?.setData('text/plain', nodeId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    setDragState({ nodeId, targetNodeId: '', placement: '' });
    onSelect(nodeId, event);
  }, [nodes, onSelect]);

  const handleDragOver = useCallback((targetNodeId, event) => {
    const nextDropState = resolveDropState(targetNodeId, event);
    if (!nextDropState) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDragState((prev) => (
      prev?.nodeId === nextDropState.nodeId
      && prev?.targetNodeId === nextDropState.targetNodeId
      && prev?.placement === nextDropState.placement
        ? prev
        : nextDropState
    ));
  }, [resolveDropState]);

  const handleDrop = useCallback((targetNodeId, event) => {
    const nextDropState = resolveDropState(targetNodeId, event);
    if (!nextDropState) return;
    event.preventDefault();
    event.stopPropagation();
    setDragState(null);
    onMoveNode(nextDropState);
  }, [onMoveNode, resolveDropState]);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
  }, []);

  const getAdjacentNode = useCallback((nodeId, key) => {
    const currentIndex = visibleOutlineNodes.findIndex((node) => node?._id === nodeId);
    const nextIndex = currentIndex < 0
      ? (key === 'ArrowDown' ? 0 : visibleOutlineNodes.length - 1)
      : currentIndex + (key === 'ArrowDown' ? 1 : -1);
    return visibleOutlineNodes[nextIndex] || null;
  }, [visibleOutlineNodes]);

  const handleNavigate = useCallback((event) => {
    if (event.target?.closest?.('input, textarea')) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    const nextNode = getAdjacentNode(activeNodeId, event.key);
    if (nextNode?._id) onNavigate(nextNode._id, event);
  }, [activeNodeId, getAdjacentNode, onNavigate]);

  const handleWindowKeyDown = useCallback((event) => {
    if (event.defaultPrevented || editingNodeId) return;
    if (event.target?.closest?.('input, textarea, button, [contenteditable="true"]')) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && !(event.key === 'Enter' && !event.shiftKey)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') {
      onCreateSibling(activeNodeId);
      return;
    }
    const nextNode = getAdjacentNode(activeNodeId, event.key);
    if (nextNode?._id) onNavigate(nextNode._id, event);
  }, [activeNodeId, editingNodeId, getAdjacentNode, onCreateSibling, onNavigate]);

  const handleNavigateFromTitle = useCallback((nodeId, draft, key) => {
    const nextNode = getAdjacentNode(nodeId, key);
    const draftText = String(draft || '');
    Promise.resolve(onCommitTitle(nodeId, draftText)).then((didCommit) => {
      if (didCommit === false && draftText.trim()) return;
      onCancelTitle(nodeId);
      if (nextNode?._id) onNavigate(nextNode._id);
    }).catch(() => undefined);
  }, [getAdjacentNode, onCancelTitle, onCommitTitle, onNavigate]);

  useEffect(() => {
    setExpandedIds(collectBrocadeOutlineExpandableIds(outlineTree));
  }, [outlineTree]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [handleWindowKeyDown]);

  const setRowRef = useCallback((nodeId, element) => {
    if (!nodeId) return;
    if (element) {
      rowRefs.current.set(nodeId, element);
    } else {
      rowRefs.current.delete(nodeId);
    }
  }, []);

  const setItemRef = useCallback((nodeId, element) => {
    if (!nodeId) return;
    if (element) {
      itemRefs.current.set(nodeId, element);
    } else {
      itemRefs.current.delete(nodeId);
    }
  }, []);

  const setTitleInputRef = useCallback((nodeId, element) => {
    if (!nodeId) return;
    if (element) {
      titleInputRefs.current.set(nodeId, element);
    } else {
      titleInputRefs.current.delete(nodeId);
    }
  }, []);

  useEffect(() => {
    if (!activeNodeId) return;
    const row = rowRefs.current.get(activeNodeId);
    row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeNodeId, expandedIdSet, visibleOutlineNodes.length]);

  useEffect(() => {
    if (editingNodeId) {
      const input = titleInputRefs.current.get(editingNodeId);
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    const focusActiveItem = () => {
      const item = activeNodeId ? itemRefs.current.get(activeNodeId) : null;
      if (item) {
        item.focus({ preventScroll: true });
        return;
      }
      treeRef.current?.focus({ preventScroll: true });
    };
    if (typeof window === 'undefined') {
      focusActiveItem();
      return undefined;
    }
    const frame = window.requestAnimationFrame(focusActiveItem);
    return () => window.cancelAnimationFrame(frame);
  }, [activeNodeId, editingNodeId, expandedIdSet, visibleOutlineNodes.length]);

  const getLassoSelection = useCallback((rect) => {
    const selectedIds = [];
    rowRefs.current.forEach((element, nodeId) => {
      const rowRect = element.getBoundingClientRect();
      const intersects = (
        rowRect.left <= rect.right
        && rowRect.right >= rect.left
        && rowRect.top <= rect.bottom
        && rowRect.bottom >= rect.top
      );
      if (intersects) selectedIds.push(nodeId);
    });
    return selectedIds;
  }, []);

  const getLassoRect = useCallback((startX, startY, endX, endY) => ({
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY)
  }), []);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 || event.target?.closest?.('.jinzhi-outline-view__toggle')) return;
    setPointerPosition({ x: event.clientX, y: event.clientY });
    const pointerState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      selectionIds: [],
      activeNodeId: '',
      timer: window.setTimeout(() => {
        if (pointerRef.current?.pointerId === event.pointerId) {
          pointerRef.current.active = true;
          treeRef.current?.setPointerCapture?.(event.pointerId);
        }
      }, 220)
    };
    pointerRef.current = pointerState;
  }, []);

  const handlePointerMove = useCallback((event) => {
    setPointerPosition({ x: event.clientX, y: event.clientY });
    const pointerState = pointerRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId || !pointerState.active) return;
    event.preventDefault();
    const nextRect = getLassoRect(pointerState.startX, pointerState.startY, event.clientX, event.clientY);
    pointerState.selectionIds = getLassoSelection(nextRect);
    const hoveredNode = Array.from(rowRefs.current.entries()).find(([, element]) => {
      const rect = element.getBoundingClientRect();
      return event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
    });
    pointerState.activeNodeId = hoveredNode?.[0] || pointerState.selectionIds[0] || '';
    setLassoRect(nextRect);
  }, [getLassoRect, getLassoSelection]);

  const handlePointerUp = useCallback((event) => {
    setPointerPosition({ x: event.clientX, y: event.clientY });
    const pointerState = pointerRef.current;
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;
    window.clearTimeout(pointerState.timer);
    const didMove = Math.hypot(
      event.clientX - pointerState.startX,
      event.clientY - pointerState.startY
    ) > 8;
    if (pointerState.active && didMove) {
      event.preventDefault();
      suppressClickRef.current = true;
      onLassoSelect(pointerState.selectionIds, pointerState.activeNodeId);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 80);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
    setLassoRect(null);
  }, [onLassoSelect]);

  const handleToggle = useCallback((nodeId) => {
    if (!nodeId) return;
    setExpandedIds((prev) => (
      prev.includes(nodeId)
        ? prev.filter((item) => item !== nodeId)
        : [...prev, nodeId]
    ));
  }, []);

  return (
    <div
      ref={treeRef}
      className="jinzhi-outline-view__tree"
      tabIndex={0}
      role="tree"
      aria-label="知识锦大纲"
      onKeyDown={handleNavigate}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {outlineTree.length > 0 ? outlineTree.map((branch) => (
        <BrocadeOutlineTreeBranch
          key={branch?.node?._id || 'outline-root'}
          branch={branch}
          activeNodeId={activeNodeId}
          selectedNodeIds={selectedNodeIds}
          expandedIds={expandedIdSet}
          onToggle={handleToggle}
          onSelect={onSelect}
          editingNodeId={editingNodeId}
          editingTitle={editingTitle}
          onStartTitleEdit={onStartTitleEdit}
          onChangeTitle={onChangeTitle}
          onCommitTitle={onCommitTitle}
          onCancelTitle={onCancelTitle}
          onConfirmTitleAndCreateSibling={onConfirmTitleAndCreateSibling}
          onNavigateFromTitle={handleNavigateFromTitle}
          draggedNodeId={dragState?.nodeId || ''}
          dropTargetNodeId={dragState?.targetNodeId || ''}
          dropPlacement={dragState?.placement || ''}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          setRowRef={setRowRef}
          setItemRef={setItemRef}
          setTitleInputRef={setTitleInputRef}
        />
      )) : (
        <div className="jinzhi-outline-view__empty">当前知识锦还没有可展示的节点。</div>
      )}
      {lassoRect ? (
        <div
          className="jinzhi-outline-view__lasso"
          style={{
            left: `${lassoRect.left}px`,
            top: `${lassoRect.top}px`,
            width: `${lassoRect.width}px`,
            height: `${lassoRect.height}px`
          }}
        />
      ) : null}
      {deleteActionAnchor ? (
        <button
          type="button"
          className="jinzhi-outline-view__multi-delete"
          style={{
            left: `${deleteActionAnchor.left}px`,
            top: `${deleteActionAnchor.top}px`
          }}
          aria-label="删除选中的节点"
          title="删除选中的节点"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestDelete?.(Array.from(selectedNodeIds));
          }}
        >
          <Trash2 size={15} />
        </button>
      ) : null}
    </div>
  );
};

const BrocadeOutlineContentPanel = ({
  node = null,
  selectedCount = 0,
  childCount = 0,
  onDelete
}) => {
  const bodyText = getNodeBodyContentText(node || {}).trim();
  const bodyHtml = useMemo(() => markdownToRichHtml(bodyText), [bodyText]);

  if (!node) {
    return (
      <section className="jinzhi-outline-view__content-panel jinzhi-outline-view__content-panel--empty">
        <div className="jinzhi-outline-view__content-empty">从左侧大纲选择一个节点，查看或编辑它的独立内容。</div>
      </section>
    );
  }

  return (
    <section className="jinzhi-outline-view__content-panel">
      <div className="jinzhi-outline-view__content-header">
        <div>
          <div className="jinzhi-outline-view__eyebrow">节点内容</div>
          <h2>{normalizeNodeTitle(node.title, '未命名节点')}</h2>
        </div>
        <div className="jinzhi-outline-view__selection-count">
          {selectedCount > 1 ? `已选 ${selectedCount} 个` : '当前节点'}
        </div>
      </div>
      <div className="jinzhi-outline-view__content-actions">
        <button
          type="button"
          className="btn btn-small btn-danger"
          onClick={onDelete}
          disabled={node.isRoot}
          title={node.isRoot ? '根节点不可删除' : '删除当前节点'}
        >
          <Trash2 size={14} />
          {node.isRoot ? '根节点不可删除' : '删除'}
        </button>
      </div>
      <div className="jinzhi-outline-view__content-meta">
        <span>{node.isRoot ? '根节点' : '普通节点'}</span>
        <span>下级节点 {childCount}</span>
        {node.updatedAt ? <span>{new Date(node.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span> : null}
      </div>
      <div className="jinzhi-outline-view__content-box">
        {bodyText ? (
          <div className="jinzhi-outline-view__markdown" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <div className="jinzhi-outline-view__content-placeholder">当前节点还没有正文内容。按 E 打开编辑器。</div>
        )}
      </div>
      <div className="jinzhi-outline-view__content-tip">单击左侧标题可直接改名；按 E 可编辑正文。</div>
    </section>
  );
};

const BrocadeOutlineDeleteConfirmModal = ({
  open = false,
  nodes = [],
  saving = false,
  onClose,
  onConfirm
}) => {
  if (!open) return null;

  return (
    <div
      className="jinzhi-outline-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="jinzhi-outline-modal jinzhi-outline-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jinzhi-outline-delete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="jinzhi-outline-modal__header">
          <div>
            <div className="jinzhi-outline-modal__eyebrow">Delete Selected Nodes</div>
            <h3 id="jinzhi-outline-delete-title">确认删除选中的节点？</h3>
          </div>
          <button
            type="button"
            className="jinzhi-outline-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭删除确认"
          >
            <X size={16} />
          </button>
        </div>
        <div className="jinzhi-outline-modal__meta">
          以下共选中 {nodes.length} 个节点，删除后将同时删除这些节点的全部子节点。
        </div>
        <div className="jinzhi-outline-delete-modal__body">
          <ul className="jinzhi-outline-delete-modal__list">
            {nodes.map((node) => (
              <li key={node?._id || node?.title} className="jinzhi-outline-delete-modal__item">
                {normalizeNodeTitle(node?.title, '未命名节点')}
              </li>
            ))}
          </ul>
        </div>
        <div className="jinzhi-outline-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={saving || nodes.length < 1}>
            <Trash2 size={14} />
            {saving ? '删除中...' : `删除 ${nodes.length} 个节点`}
          </button>
        </div>
      </div>
    </div>
  );
};

const BrocadeTextPreviewModal = ({
  open = false,
  brocadeName = '',
  nodes = [],
  onClose
}) => {
  const textareaRef = useRef(null);
  const [copyState, setCopyState] = useState('idle');
  const previewText = useMemo(() => buildBrocadeTextPreview(nodes), [nodes]);

  useEffect(() => {
    if (open) {
      setCopyState('idle');
    }
  }, [open, previewText]);

  const handleCopy = useCallback(async () => {
    if (!previewText) return;
    try {
      await navigator.clipboard.writeText(previewText);
      setCopyState('copied');
    } catch (_error) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setCopyState('manual');
    }
  }, [previewText]);

  if (!open) return null;

  return (
    <div className="jinzhi-text-preview-modal-backdrop" onClick={onClose}>
      <div className="jinzhi-text-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="jinzhi-text-preview-modal__header">
          <div>
            <div className="jinzhi-text-preview-modal__eyebrow">Text Preview</div>
            <h3>{brocadeName || '知识锦文本预览'}</h3>
          </div>
          <button type="button" className="jinzhi-outline-modal__close" onClick={onClose} aria-label="关闭文本预览">
            <X size={16} />
          </button>
        </div>
        <div className="jinzhi-text-preview-modal__toolbar">
          <span>Markdown 层级 · {nodes.length} 个节点 · 只读</span>
          <button
            type="button"
            className="jinzhi-canvas-toolbar-btn"
            onClick={handleCopy}
            disabled={!previewText}
          >
            <Copy size={14} />
            {copyState === 'copied' ? '已复制' : (copyState === 'manual' ? '请手动复制' : '复制全文')}
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="jinzhi-text-preview-modal__textarea"
          value={previewText || '当前知识锦还没有可预览的文本内容。'}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
    </div>
  );
};

const computeCanvasMetrics = (nodes = []) => {
  const bounds = nodes.reduce((acc, node) => {
    const x = Number(node?.position?.x) || 0;
    const y = Number(node?.position?.y) || 0;
    const nodeSize = getNodeSize(node);
    return {
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x + nodeSize.width),
      maxY: Math.max(acc.maxY, y + nodeSize.height)
    };
  }, {
    minX: 0,
    minY: 0,
    maxX: NODE_WIDTH,
    maxY: NODE_HEIGHT
  });

  const contentWidth = Math.max(NODE_WIDTH, Math.ceil(bounds.maxX - bounds.minX));
  const contentHeight = Math.max(NODE_HEIGHT, Math.ceil(bounds.maxY - bounds.minY));
  const paddingX = Math.max(
    WORKSPACE_PADDING_X_MIN,
    Math.min(WORKSPACE_PADDING_X, Math.round(contentWidth * 0.18))
  );
  const paddingY = Math.max(
    WORKSPACE_PADDING_Y_MIN,
    Math.min(WORKSPACE_PADDING_Y, Math.round(contentHeight * 0.34))
  );
  const originX = paddingX - bounds.minX;
  const originY = paddingY - bounds.minY;
  const width = Math.ceil(contentWidth + paddingX * 2);
  const height = Math.ceil(contentHeight + paddingY * 2);

  return {
    width,
    height,
    originX,
    originY,
    contentWidth,
    contentHeight
  };
};

const centerNodeInViewport = (scrollRef, node, metrics, zoom = ZOOM_DEFAULT) => {
  if (!scrollRef?.current || !node) return;
  const nodeSize = getNodeSize(node);
  const targetLeft = (metrics.originX + (Number(node?.position?.x) || 0) + nodeSize.width / 2) * zoom - scrollRef.current.clientWidth / 2;
  const targetTop = (metrics.originY + (Number(node?.position?.y) || 0) + nodeSize.height / 2) * zoom - scrollRef.current.clientHeight / 2;
  scrollRef.current.scrollTo({
    left: Math.max(0, targetLeft),
    top: Math.max(0, targetTop),
    behavior: 'smooth'
  });
};

const centerCanvasInViewport = (scrollRef, node = null, metrics = null, zoom = ZOOM_DEFAULT) => {
  if (node && metrics) {
    centerNodeInViewport(scrollRef, node, metrics, zoom);
    return;
  }
  const container = scrollRef?.current;
  if (!container) return;
  container.scrollTo({
    left: Math.max(0, (container.scrollWidth - container.clientWidth) / 2),
    top: Math.max(0, (container.scrollHeight - container.clientHeight) / 2),
    behavior: 'smooth'
  });
};

const getInspectorPositionStyle = (containerRect, anchorPoint) => {
  if (!containerRect || !anchorPoint) return null;
  const desktopOnly = containerRect.width > 720;
  if (!desktopOnly) return null;

  const margin = 16;
  const preferredWidth = 340;
  const minWidth = 280;
  const popupWidth = Math.max(minWidth, Math.min(preferredWidth, containerRect.width - margin * 2));
  const estimatedHeight = Math.min(420, Math.max(280, containerRect.height - margin * 2));
  const anchorX = Math.max(margin, Math.min(containerRect.width - margin, anchorPoint.x));
  const anchorY = Math.max(margin, Math.min(containerRect.height - margin, anchorPoint.y));
  const maxLeft = Math.max(margin, containerRect.width - popupWidth - margin);
  const maxTop = Math.max(margin, containerRect.height - estimatedHeight - margin);

  let left = anchorX <= (containerRect.width / 2)
    ? maxLeft
    : margin;
  let top = anchorY <= (containerRect.height / 2)
    ? maxTop
    : margin;

  left = Math.max(margin, Math.min(maxLeft, left));
  top = Math.max(margin, Math.min(maxTop, top));

  return {
    left: `${left}px`,
    top: `${top}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${popupWidth}px`,
    maxHeight: `${Math.max(260, containerRect.height - top - margin)}px`
  };
};

const NodeEditorModal = ({
  open,
  node,
  saving = false,
  onAutoSave,
  onClose,
  onSave
}) => {
  const [draft, setDraft] = useState('');
  const [autoSaveState, setAutoSaveState] = useState('idle');
  const [isClosing, setIsClosing] = useState(false);
  const editingNodeIdRef = useRef('');
  const lastSavedDraftRef = useRef('');
  const autoSaveTimerRef = useRef(0);
  const previewSource = useMemo(() => buildNodeEditorPreviewSource(draft), [draft]);
  const previewHtml = useMemo(() => markdownToRichHtml(previewSource), [previewSource]);

  useEffect(() => {
    if (!open) {
      editingNodeIdRef.current = '';
      lastSavedDraftRef.current = '';
      setDraft('');
      setAutoSaveState('idle');
      setIsClosing(false);
      return;
    }
    const nodeId = node?._id || '';
    if (!nodeId || editingNodeIdRef.current === nodeId) return;
    const savedContentText = String(node?.contentText || '').replace(/\r/g, '');
    const initialDraft = savedContentText;
    editingNodeIdRef.current = nodeId;
    lastSavedDraftRef.current = initialDraft;
    setDraft(initialDraft);
    setAutoSaveState('saved');
    setIsClosing(false);
  }, [node?._id, node?.contentText, node?.title, open]);

  const flushAutoSave = useCallback(async (nextDraft = draft) => {
    if (!node?._id || typeof onAutoSave !== 'function') return;
    if (nextDraft === lastSavedDraftRef.current) {
      setAutoSaveState('saved');
      return;
    }
    setAutoSaveState('saving');
    const result = await onAutoSave(nextDraft);
    if (result?.stale) return;
    lastSavedDraftRef.current = nextDraft;
    setAutoSaveState('saved');
  }, [draft, node?._id, onAutoSave]);

  useEffect(() => {
    if (!open || !node?._id || typeof onAutoSave !== 'function') return undefined;
    if (draft === lastSavedDraftRef.current) {
      if (draft) setAutoSaveState('saved');
      return undefined;
    }
    setAutoSaveState('pending');
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = 0;
      flushAutoSave(draft).catch(() => {
        setAutoSaveState('error');
      });
    }, EDITOR_AUTOSAVE_DELAY_MS);
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = 0;
      }
    };
  }, [draft, flushAutoSave, node?._id, onAutoSave, open]);

  const handleClose = useCallback(async () => {
    if (isClosing) return;
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = 0;
    }
    setIsClosing(true);
    try {
      await flushAutoSave(draft);
      onClose();
    } catch (_error) {
      setAutoSaveState('error');
    } finally {
      setIsClosing(false);
    }
  }, [draft, flushAutoSave, isClosing, onClose]);

  const autoSaveLabel = {
    idle: '自动保存已启用',
    pending: '即将自动保存',
    saving: '正在自动保存...',
    saved: '已自动保存',
    error: '自动保存失败，请重试'
  }[autoSaveState] || '自动保存已启用';

  if (!open || !node) return null;

  return (
    <div className="jinzhi-editor-modal-backdrop">
      <div className="jinzhi-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="jinzhi-editor-modal__header">
          <div>
            <div className="jinzhi-editor-modal__eyebrow">Node Editor</div>
            <h3>{normalizeNodeTitle(node?.title, '')}</h3>
          </div>
          <button
            type="button"
            className="btn btn-small btn-secondary"
            onClick={handleClose}
            disabled={saving || isClosing || autoSaveState === 'saving'}
          >
            {isClosing ? '保存中...' : '关闭'}
          </button>
        </div>
        <div className="jinzhi-editor-modal__workspace">
          <div className="jinzhi-editor-modal__pane">
            <div className="jinzhi-editor-modal__pane-label">Markdown 原文</div>
            <textarea
              value={draft}
              maxLength={200000}
              className="jinzhi-editor-modal__textarea"
              placeholder={'第一行作为卡片标题。\n\n使用 ## 子标题、### 小标题组织内容。'}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
          </div>
          <div className="jinzhi-editor-modal__pane">
            <div className="jinzhi-editor-modal__pane-label">格式预览</div>
            <div
              className="jinzhi-editor-modal__markdown-preview"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
        <div className="jinzhi-editor-modal__footer">
          <div className={`jinzhi-editor-modal__autosave is-${autoSaveState}`}>
            {autoSaveLabel}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
            disabled={saving || isClosing || autoSaveState === 'saving'}
          >
            {isClosing ? '保存中...' : '关闭'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave(draft)?.catch?.(() => setAutoSaveState('error'));
            }}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存并关闭'}
          </button>
        </div>
      </div>
    </div>
  );
};

const NodeCreateModal = ({
  open,
  parentNode,
  saving = false,
  onClose,
  onSubmit
}) => {
  const [contentText, setContentText] = useState('');
  const [isStarred, setIsStarred] = useState(false);

  useEffect(() => {
    if (!open) return;
    setContentText('');
    setIsStarred(false);
  }, [open]);

  if (!open || !parentNode) return null;

  const effectiveContentText = String(contentText || '').replace(/\r/g, '');

  return (
    <div className="jinzhi-create-modal-backdrop" onClick={onClose}>
      <div className="jinzhi-create-modal" onClick={(event) => event.stopPropagation()}>
        <div className="jinzhi-create-modal__header">
          <div>
            <div className="jinzhi-create-modal__eyebrow">Create Knowledge Node</div>
            <h3>创建节点</h3>
          </div>
          <button type="button" className="btn btn-small btn-secondary" onClick={onClose} disabled={saving}>关闭</button>
        </div>

        <div className="jinzhi-create-modal__body">
          <button
            type="button"
            className={`jinzhi-star-toggle${isStarred ? ' is-active' : ''}`}
            onClick={() => setIsStarred((prev) => !prev)}
          >
            <Star size={15} fill={isStarred ? 'currentColor' : 'none'} />
            {isStarred ? '已星标' : '设为星标节点'}
          </button>
          <textarea
            value={contentText}
            maxLength={200000}
            className="jinzhi-create-modal__textarea"
            placeholder={'第一行可填写标题。\n\n在这里继续填写这个知识点的内容。'}
            onChange={(event) => setContentText(event.target.value)}
          />
        </div>

        <div className="jinzhi-create-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSubmit({
              contentText: effectiveContentText,
              isStarred
            })}
            disabled={saving}
          >
            {saving ? '创建中...' : '创建节点'}
          </button>
        </div>
      </div>
    </div>
  );
};

const KnowledgeBrocadeWorkspacePage = ({
  activeBrocadeId = '',
  initialBrocadeName = '',
  onBack,
  onBrocadeMetaChange
}) => {
  const canvasCardRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const panRef = useRef(null);
  const pinchRef = useRef(null);
  const zoomFrameRef = useRef(0);
  const lastAutoCenteredNodeIdRef = useRef('');
  const zoomRef = useRef(ZOOM_DEFAULT);
  const suppressInspectorOpenUntilRef = useRef(0);
  const brocadeTitleEditorRef = useRef(null);
  const brocadeTitleCommitRef = useRef(false);
  const starRequestVersionRef = useRef(new Map());
  const contentSaveRequestVersionRef = useRef(new Map());
  const outlineTitleCommitRef = useRef(false);
  const toastTimerRef = useRef(0);
  const [brocade, setBrocade] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [toastText, setToastText] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [actionId, setActionId] = useState('');
  const [starPendingNodeIds, setStarPendingNodeIds] = useState(() => new Set());
  const [historyState, setHistoryState] = useState(() => ({ undoStack: [], redoStack: [] }));
  const [historyActionId, setHistoryActionId] = useState('');
  const [edgeViewMode, setEdgeViewMode] = useState(EDGE_VIEW_MODE.MERGED);
  const [viewMode, setViewMode] = useState(VIEW_MODE.TREE);
  const [canvasTheme, setCanvasTheme] = useState(() => {
    if (typeof window === 'undefined') return CANVAS_THEME.NIGHT;
    const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedValue === CANVAS_THEME.DAY ? CANVAS_THEME.DAY : CANVAS_THEME.NIGHT;
  });
  const [isPanning, setIsPanning] = useState(false);
  const [createParentNode, setCreateParentNode] = useState(null);
  const [outlineSelectedNodeIds, setOutlineSelectedNodeIds] = useState(() => new Set());
  const [editingOutlineNodeId, setEditingOutlineNodeId] = useState('');
  const [outlineTitleDraft, setOutlineTitleDraft] = useState('');
  const [outlineDeleteDialog, setOutlineDeleteDialog] = useState(null);
  const [textPreviewOpen, setTextPreviewOpen] = useState(false);
  const [inspectorAnchor, setInspectorAnchor] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isEditingBrocadeTitle, setIsEditingBrocadeTitle] = useState(false);
  const [brocadeTitleDraft, setBrocadeTitleDraft] = useState('');
  const [savingBrocadeTitle, setSavingBrocadeTitle] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState('');
  const [dragReparentPreview, setDragReparentPreview] = useState(null);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const showWorkspaceToast = useCallback((message) => {
    if (!message) return;
    if (toastTimerRef.current && typeof window !== 'undefined') {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastText(message);
    if (typeof window !== 'undefined') {
      toastTimerRef.current = window.setTimeout(() => {
        setToastText('');
        toastTimerRef.current = 0;
      }, 2200);
    }
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current && typeof window !== 'undefined') {
      window.clearTimeout(toastTimerRef.current);
    }
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((item) => item?._id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const rootNode = useMemo(
    () => nodes.find((item) => item?.isRoot) || nodes.find((item) => !item?.parentNodeId) || null,
    [nodes]
  );
  const isHistoryLocked = !!historyActionId || !!actionId || loading || savingContent;
  const canUndo = historyState.undoStack.length > 0 && !isHistoryLocked;
  const canRedo = historyState.redoStack.length > 0 && !isHistoryLocked;
  const inspectorStyle = (() => {
    if (!selectedNode || !canvasCardRef.current || !inspectorAnchor) return null;
    const rect = canvasCardRef.current.getBoundingClientRect();
    return getInspectorPositionStyle(
      { width: rect.width, height: rect.height },
      inspectorAnchor
    );
  })();
  const nodesById = useMemo(() => new Map(nodes.map((item) => [item?._id, item])), [nodes]);
  const outlineDeleteDialogNodes = useMemo(() => (
    (outlineDeleteDialog?.nodeIds || [])
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node) => node?._id && !node.isRoot)
  ), [nodesById, outlineDeleteDialog]);
  const childCountByNodeId = useMemo(() => {
    const counts = new Map();
    nodes.forEach((node) => {
      const parentNodeId = node?.parentNodeId || '';
      if (!parentNodeId) return;
      counts.set(parentNodeId, (counts.get(parentNodeId) || 0) + 1);
    });
    return counts;
  }, [nodes]);
  const visibleNodes = useMemo(() => {
    const hiddenIds = new Set();
    const childrenMap = new Map();
    nodes.forEach((node) => {
      const parentNodeId = node?.parentNodeId || '';
      if (!parentNodeId) return;
      if (!childrenMap.has(parentNodeId)) childrenMap.set(parentNodeId, []);
      childrenMap.get(parentNodeId).push(node?._id || '');
    });
    const hideBranch = (nodeId) => {
      (childrenMap.get(nodeId) || []).forEach((childId) => {
        if (!childId || hiddenIds.has(childId)) return;
        hiddenIds.add(childId);
        hideBranch(childId);
      });
    };
    collapsedNodeIds.forEach((nodeId) => hideBranch(nodeId));
    if (draggingNodeId) hiddenIds.delete(draggingNodeId);
    return nodes.filter((node) => !hiddenIds.has(node?._id));
  }, [collapsedNodeIds, draggingNodeId, nodes]);
  const graphNodes = useMemo(() => {
    const previewNodeId = dragReparentPreview?.nodeId || '';
    const previewParentNodeId = dragReparentPreview?.parentNodeId || '';
    if (!previewNodeId || !previewParentNodeId) return visibleNodes;
    const previewParentNode = nodesById.get(previewParentNodeId);
    const previewPosition = previewParentNode
      ? resolveReparentNodePosition(previewParentNode, previewNodeId, nodes)
      : null;
    return visibleNodes.map((item) => (
      item?._id === previewNodeId
        ? {
          ...item,
          parentNodeId: previewParentNodeId,
          ...(previewPosition ? { position: previewPosition } : {})
        }
        : item
    ));
  }, [dragReparentPreview, nodes, nodesById, visibleNodes]);
  const canvasMetrics = useMemo(() => computeCanvasMetrics(graphNodes), [graphNodes]);
  const graphNodesById = useMemo(() => new Map(graphNodes.map((item) => [item?._id, item])), [graphNodes]);
  const treeMetrics = useMemo(() => buildTreeMetrics(graphNodes), [graphNodes]);
  const edges = useMemo(() => (
    graphNodes
      .filter((item) => item?.parentNodeId && graphNodesById.has(item.parentNodeId))
      .map((item) => ({
        id: `${item.parentNodeId}->${item._id}`,
        source: graphNodesById.get(item.parentNodeId),
        target: item,
        depth: treeMetrics.depthMap.get(item?._id) || 1,
        branchWeight: treeMetrics.subtreeSizeMap.get(item?._id) || 1,
        trunkWeight: treeMetrics.subtreeSizeMap.get(item?.parentNodeId) || 1,
        isPreview: (
          item?._id === dragReparentPreview?.nodeId
          && item?.parentNodeId === dragReparentPreview?.parentNodeId
        )
      }))
  ), [dragReparentPreview?.nodeId, dragReparentPreview?.parentNodeId, graphNodes, graphNodesById, treeMetrics.depthMap, treeMetrics.subtreeSizeMap]);
  const previewEdges = useMemo(
    () => edges.filter((edge) => edge?.isPreview),
    [edges]
  );
  const stableEdges = useMemo(
    () => edges.filter((edge) => !edge?.isPreview),
    [edges]
  );
  const groupedEdges = useMemo(() => {
    const groups = new Map();
    stableEdges.forEach((edge) => {
      const sourceId = edge.source?._id;
      if (!sourceId) return;
      const current = groups.get(sourceId) || {
        source: edge.source,
        edges: []
      };
      current.edges.push(edge);
      groups.set(sourceId, current);
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      edges: [...group.edges].sort(
        (left, right) => (Number(left.target?.position?.y) || 0) - (Number(right.target?.position?.y) || 0)
      )
    }));
  }, [stableEdges]);
  const pushHistoryEntry = useCallback((entry) => {
    if (!entry) return;
    setHistoryState((prev) => ({
      undoStack: [...prev.undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: []
    }));
  }, []);

  const mergeNodesIntoState = useCallback((incomingNodes = []) => {
    setNodes((prev) => {
      const nextMap = new Map(prev.map((item) => [item?._id, item]));
      incomingNodes.forEach((item) => {
        if (item?._id) {
          nextMap.set(item._id, item);
        }
      });
      return Array.from(nextMap.values());
    });
  }, []);

  const restoreNodeSnapshots = useCallback(async (nodeSnapshots = []) => {
    if (!activeBrocadeId || nodeSnapshots.length < 1) return [];
    const data = await restoreKnowledgeBrocadeNodes(activeBrocadeId, { nodes: nodeSnapshots });
    const restoredNodes = Array.isArray(data?.nodes) ? data.nodes : [];
    const nextBrocade = data?.brocade || null;
    if (restoredNodes.length > 0) {
      mergeNodesIntoState(restoredNodes);
    }
    if (nextBrocade?._id) {
      setBrocade(nextBrocade);
      onBrocadeMetaChange?.(nextBrocade);
    }
    return restoredNodes;
  }, [activeBrocadeId, mergeNodesIntoState, onBrocadeMetaChange]);
  const zoomRange = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return {
        min: ZOOM_DEFAULT,
        max: ZOOM_MAX
      };
    }
    const fitZoom = Math.min(
      viewportSize.width / Math.max(1, canvasMetrics.width),
      viewportSize.height / Math.max(1, canvasMetrics.height)
    );
    const minZoom = Math.min(ZOOM_DEFAULT, fitZoom);
    return {
      min: Math.max(0.05, minZoom),
      max: Math.max(minZoom, ZOOM_MAX)
    };
  }, [canvasMetrics.height, canvasMetrics.width, viewportSize.height, viewportSize.width]);
  const stageShellMetrics = useMemo(
    () => getStageShellMetrics(canvasMetrics, viewportSize, zoom),
    [canvasMetrics, viewportSize, zoom]
  );
  const {
    shellWidth,
    shellHeight,
    stageOffsetX,
    stageOffsetY
  } = stageShellMetrics;
  const textCounterScale = useMemo(
    () => Math.min(1.34, Math.max(1, 1 / Math.max(zoom, 0.0001))),
    [zoom]
  );
  const previewCounterScale = useMemo(
    () => Math.min(1.2, Math.max(1, 1 / Math.max(zoom, 0.0001))),
    [zoom]
  );
  const zoomFillPercent = useMemo(() => {
    const range = Math.max(0.0001, zoomRange.max - zoomRange.min);
    return `${((zoom - zoomRange.min) / range) * 100}%`;
  }, [zoom, zoomRange.max, zoomRange.min]);

  const clampScrollIntoBounds = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollLeft = Math.min(maxLeft, Math.max(0, container.scrollLeft));
    container.scrollTop = Math.min(maxTop, Math.max(0, container.scrollTop));
  }, []);

  const clampZoomValue = useCallback((nextZoom) => (
    Math.min(zoomRange.max, Math.max(zoomRange.min, Number(nextZoom) || ZOOM_DEFAULT))
  ), [zoomRange.max, zoomRange.min]);

  const applyZoom = useCallback((nextZoom, anchor = null) => {
    const container = scrollRef.current;
    const previousZoom = zoomRef.current;
    const clampedZoom = clampZoomValue(nextZoom);
    if (!container || Math.abs(clampedZoom - previousZoom) < 0.001) {
      setZoom(clampedZoom);
      zoomRef.current = clampedZoom;
      return;
    }

    const anchorX = anchor?.x ?? (container.clientWidth / 2);
    const anchorY = anchor?.y ?? (container.clientHeight / 2);
    const previousShellMetrics = getStageShellMetrics(canvasMetrics, viewportSize, previousZoom);
    const nextShellMetrics = getStageShellMetrics(canvasMetrics, viewportSize, clampedZoom);
    const contentX = (container.scrollLeft + anchorX - previousShellMetrics.stageOffsetX) / previousZoom;
    const contentY = (container.scrollTop + anchorY - previousShellMetrics.stageOffsetY) / previousZoom;

    zoomRef.current = clampedZoom;
    setZoom(clampedZoom);

    if (zoomFrameRef.current) {
      window.cancelAnimationFrame(zoomFrameRef.current);
    }

    zoomFrameRef.current = window.requestAnimationFrame(() => {
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollLeft = Math.min(
        maxLeft,
        Math.max(0, contentX * clampedZoom + nextShellMetrics.stageOffsetX - anchorX)
      );
      container.scrollTop = Math.min(
        maxTop,
        Math.max(0, contentY * clampedZoom + nextShellMetrics.stageOffsetY - anchorY)
      );
      zoomFrameRef.current = 0;
    });
  }, [canvasMetrics, clampZoomValue, viewportSize]);

  const loadGraph = useCallback(async () => {
    if (!activeBrocadeId) return;
    setLoading(true);
    setErrorText('');
    try {
      const data = await getKnowledgeBrocadeGraph(activeBrocadeId);
      const nextBrocade = data?.brocade || null;
      const nextNodes = Array.isArray(data?.nodes) ? data.nodes : [];
      setBrocade(nextBrocade);
      setNodes(nextNodes);
      setSelectedNodeId((prev) => (prev && nextNodes.some((item) => item?._id === prev) ? prev : ''));
      setHistoryState({ undoStack: [], redoStack: [] });
      setHistoryActionId('');
      onBrocadeMetaChange?.(nextBrocade);
    } catch (error) {
      setErrorText(error.message || '加载知识锦失败');
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, [activeBrocadeId, onBrocadeMetaChange]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THEME_STORAGE_KEY, canvasTheme);
  }, [canvasTheme]);

  useEffect(() => {
    if (isEditingBrocadeTitle) return;
    setBrocadeTitleDraft(brocade?.name || initialBrocadeName || '知识锦');
  }, [brocade?.name, initialBrocadeName, isEditingBrocadeTitle]);

  const openNodeInspector = useCallback((nodeId, event = null) => {
    if (Date.now() < suppressInspectorOpenUntilRef.current) {
      return;
    }
    setSelectedNodeId(nodeId || '');
    if (!nodeId || !event || !canvasCardRef.current) {
      setInspectorAnchor(null);
      return;
    }
    const rect = canvasCardRef.current.getBoundingClientRect();
    setInspectorAnchor({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  }, []);

  const openNodeEditor = useCallback((nodeId) => {
    if (!nodeId) return;
    setSelectedNodeId(nodeId);
    setInspectorAnchor(null);
    setEditorOpen(true);
  }, []);

  const closeNodeInspector = useCallback(() => {
    setSelectedNodeId('');
    setInspectorAnchor(null);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    const updateViewportSize = () => {
      setViewportSize({
        width: container.clientWidth,
        height: container.clientHeight
      });
    };

    updateViewportSize();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => updateViewportSize());
      observer.observe(container);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, [activeBrocadeId]);

  // 监听滚动位置变化
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      setScrollLeft(container.scrollLeft);
      setScrollTop(container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // 初始化

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [scrollRef]);

  useEffect(() => {
    const nextZoom = clampZoomValue(zoomRef.current);
    if (Math.abs(nextZoom - zoomRef.current) > 0.001) {
      applyZoom(nextZoom);
      return;
    }
    clampScrollIntoBounds();
  }, [applyZoom, clampScrollIntoBounds, clampZoomValue, canvasMetrics.height, canvasMetrics.width, viewportSize.height, viewportSize.width]);

  useEffect(() => () => {
    if (zoomFrameRef.current) {
      window.cancelAnimationFrame(zoomFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNodeId && lastAutoCenteredNodeIdRef.current === selectedNodeId) return;
    const timer = window.setTimeout(() => {
      centerNodeInViewport(scrollRef, selectedNode, canvasMetrics, zoomRef.current);
      lastAutoCenteredNodeIdRef.current = selectedNodeId || '';
    }, 90);
    return () => window.clearTimeout(timer);
  }, [canvasMetrics, selectedNode, selectedNodeId]);

  useEffect(() => {
    const handleMove = (event) => {
      const resizeCurrent = resizeRef.current;
      if (resizeCurrent) {
        event.preventDefault();
        const zoomScale = zoomRef.current || ZOOM_DEFAULT;
        const dx = (event.clientX - resizeCurrent.startX) / zoomScale;
        const dy = (event.clientY - resizeCurrent.startY) / zoomScale;
        const direction = resizeCurrent.direction || 'se';
        let nextWidth = resizeCurrent.originWidth;
        let nextHeight = resizeCurrent.originHeight;
        let nextX = resizeCurrent.originX;
        let nextY = resizeCurrent.originY;

        if (direction.includes('e')) {
          nextWidth = clampNodeDimension(
            resizeCurrent.originWidth + dx,
            resizeCurrent.originWidth,
            NODE_SIZE_LIMITS.minWidth,
            NODE_SIZE_LIMITS.maxWidth
          );
        } else if (direction.includes('w')) {
          nextWidth = clampNodeDimension(
            resizeCurrent.originWidth - dx,
            resizeCurrent.originWidth,
            NODE_SIZE_LIMITS.minWidth,
            NODE_SIZE_LIMITS.maxWidth
          );
          nextX = resizeCurrent.originX + (resizeCurrent.originWidth - nextWidth);
        }

        if (direction.includes('s')) {
          nextHeight = clampNodeDimension(
            resizeCurrent.originHeight + dy,
            resizeCurrent.originHeight,
            NODE_SIZE_LIMITS.minHeight,
            NODE_SIZE_LIMITS.maxHeight
          );
        } else if (direction.includes('n')) {
          nextHeight = clampNodeDimension(
            resizeCurrent.originHeight - dy,
            resizeCurrent.originHeight,
            NODE_SIZE_LIMITS.minHeight,
            NODE_SIZE_LIMITS.maxHeight
          );
          nextY = resizeCurrent.originY + (resizeCurrent.originHeight - nextHeight);
        }

        const nextSize = { width: nextWidth, height: nextHeight };
        const nextPosition = cloneNodePosition({ x: nextX, y: nextY });
        resizeCurrent.nextSize = nextSize;
        resizeCurrent.nextPosition = nextPosition;
        setNodes((prev) => prev.map((item) => (
          item?._id === resizeCurrent.nodeId
            ? { ...item, size: nextSize, position: nextPosition }
            : item
        )));
        return;
      }

      const dragCurrent = dragRef.current;
      if (dragCurrent) {
        event.preventDefault();
        const container = scrollRef.current;
        let nextScrollLeft = dragCurrent.lastScrollLeft ?? dragCurrent.originScrollLeft;
        let nextScrollTop = dragCurrent.lastScrollTop ?? dragCurrent.originScrollTop;
        if (container) {
          const rect = container.getBoundingClientRect();
          const localX = event.clientX - rect.left;
          const localY = event.clientY - rect.top;
          const autoPanX = localX < 0
            ? -getDragAutopanDelta(-localX)
            : (localX > rect.width
                ? getDragAutopanDelta(localX - rect.width)
                : 0);
          const autoPanY = localY < 0
            ? -getDragAutopanDelta(-localY)
            : (localY > rect.height
                ? getDragAutopanDelta(localY - rect.height)
                : 0);
          const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
          const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
          nextScrollLeft = Math.min(maxLeft, Math.max(0, container.scrollLeft + autoPanX));
          nextScrollTop = Math.min(maxTop, Math.max(0, container.scrollTop + autoPanY));
          container.scrollLeft = nextScrollLeft;
          container.scrollTop = nextScrollTop;
          nextScrollLeft = container.scrollLeft;
          nextScrollTop = container.scrollTop;
        }
        dragCurrent.lastScrollLeft = nextScrollLeft;
        dragCurrent.lastScrollTop = nextScrollTop;
        const dx = event.clientX - dragCurrent.startX + (nextScrollLeft - dragCurrent.originScrollLeft);
        const dy = event.clientY - dragCurrent.startY + (nextScrollTop - dragCurrent.originScrollTop);
        const zoomScale = zoomRef.current || ZOOM_DEFAULT;
        const pointerCanvasPoint = getCanvasPointFromClientPoint(
          event.clientX,
          event.clientY,
          container,
          stageOffsetX,
          stageOffsetY,
          zoomScale
        );
        const nextPosition = pointerCanvasPoint
          ? {
            x: pointerCanvasPoint.x - (Number(canvasMetrics.originX) || 0) - (dragCurrent.pointerOffsetX || 0),
            y: pointerCanvasPoint.y - (Number(canvasMetrics.originY) || 0) - (dragCurrent.pointerOffsetY || 0)
          }
          : {
            x: dragCurrent.originX + dx / zoomScale,
            y: dragCurrent.originY + dy / zoomScale
          };
        const nextPreviewParentNodeId = resolveDragReparentTargetId({
          nodes,
          hitTestNodes: visibleNodes,
          draggedNodeId: dragCurrent.nodeId,
          clientX: event.clientX,
          clientY: event.clientY,
          container,
          canvasMetrics,
          stageOffsetX,
          stageOffsetY,
          zoomValue: zoomScale
        });
        dragCurrent.previewParentNodeId = nextPreviewParentNodeId;
        setDragReparentPreview((prev) => (
          nextPreviewParentNodeId
            ? (
              prev?.nodeId === dragCurrent.nodeId && prev?.parentNodeId === nextPreviewParentNodeId
                ? prev
                : { nodeId: dragCurrent.nodeId, parentNodeId: nextPreviewParentNodeId }
            )
            : (prev ? null : prev)
        ));
        setNodes((prev) => prev.map((item) => (
          item?._id === dragCurrent.nodeId
            ? {
              ...item,
              position: cloneNodePosition(nextPosition)
            }
            : item
        )));
        return;
      }

      const panCurrent = panRef.current;
      if (!panCurrent?.container) return;
      event.preventDefault();
      const dx = event.clientX - panCurrent.startX;
      const dy = event.clientY - panCurrent.startY;
      panCurrent.container.scrollLeft = panCurrent.originScrollLeft - dx;
      panCurrent.container.scrollTop = panCurrent.originScrollTop - dy;
    };

    const handleUp = async (event) => {
      const panCurrent = panRef.current;
      if (panCurrent) {
        panRef.current = null;
        setIsPanning(false);
      }

      const dragCurrent = dragRef.current;
      const resizeCurrent = resizeRef.current;
      if (resizeCurrent) {
        if (resizeCurrent.target?.hasPointerCapture?.(resizeCurrent.pointerId)) {
          resizeCurrent.target.releasePointerCapture(resizeCurrent.pointerId);
        }
        resizeRef.current = null;
        const nextSize = resizeCurrent.nextSize || {
          width: resizeCurrent.originWidth,
          height: resizeCurrent.originHeight
        };
        const previousPosition = cloneNodePosition({
          x: resizeCurrent.originX,
          y: resizeCurrent.originY
        });
        const nextPosition = resizeCurrent.nextPosition || previousPosition;
        if (
          nextSize.width === resizeCurrent.originWidth
          && nextSize.height === resizeCurrent.originHeight
          && arePositionsEqual(nextPosition, previousPosition)
        ) {
          return;
        }
        try {
          const data = await updateKnowledgeBrocadeNode(activeBrocadeId, resizeCurrent.nodeId, {
            size: nextSize,
            position: nextPosition
          });
          const nextNode = data?.node || null;
          if (nextNode?._id) {
            setNodes((prev) => prev.map((item) => (
              item?._id === nextNode._id
                ? {
                  ...item,
                  ...nextNode,
                  size: nextNode?.size ? getNodeSize(nextNode) : nextSize,
                  position: nextNode?.position ? cloneNodePosition(nextNode.position) : nextPosition
                }
                : item
            )));
          }
        } catch (error) {
          setErrorText(error.message || '保存节点尺寸失败');
          loadGraph();
        }
        return;
      }

      if (!dragCurrent) return;
      if (dragCurrent.target?.hasPointerCapture?.(dragCurrent.pointerId)) {
        dragCurrent.target.releasePointerCapture(dragCurrent.pointerId);
      }
      const container = scrollRef.current;
      const previewParentNodeId = event.type === 'pointercancel'
        ? ''
        : resolveDragReparentTargetId({
          nodes,
          hitTestNodes: visibleNodes,
          draggedNodeId: dragCurrent.nodeId,
          clientX: event.clientX,
          clientY: event.clientY,
          container,
          canvasMetrics,
          stageOffsetX,
          stageOffsetY,
          zoomValue: zoomRef.current || ZOOM_DEFAULT
        });
      setDragReparentPreview(null);
      setDraggingNodeId('');
      dragRef.current = null;
      const movedNode = nodesById.get(dragCurrent.nodeId);
      if (!movedNode) return;
      const previousPosition = cloneNodePosition({
        x: dragCurrent.originX,
        y: dragCurrent.originY
      });
      const nextPosition = cloneNodePosition(movedNode.position);
      const previousParentNodeId = dragCurrent.originParentNodeId || '';
      const nextParentNodeId = canPreviewBrocadeReparent(nodes, dragCurrent.nodeId, previewParentNodeId)
        ? previewParentNodeId
        : previousParentNodeId;
      const didMovePosition = !arePositionsEqual(previousPosition, nextPosition);
      const didReparent = nextParentNodeId !== previousParentNodeId;
      const targetParentNode = didReparent ? nodesById.get(nextParentNodeId) : null;
      const resolvedNextPosition = didReparent && targetParentNode
        ? resolveReparentNodePosition(targetParentNode, dragCurrent.nodeId, nodes)
        : nextPosition;
      if (!didMovePosition && !didReparent) return;
      suppressInspectorOpenUntilRef.current = Date.now() + 240;
      try {
        setNodes((prev) => prev.map((item) => (
          item?._id === dragCurrent.nodeId
            ? {
              ...item,
              parentNodeId: nextParentNodeId,
              position: resolvedNextPosition
            }
            : item
        )));
        const updatePayload = {
          position: resolvedNextPosition,
          ...(didReparent ? { parentNodeId: nextParentNodeId } : {})
        };
        const data = await updateKnowledgeBrocadeNode(activeBrocadeId, dragCurrent.nodeId, updatePayload);
        const nextNode = data?.node || null;
        if (nextNode?._id) {
          setNodes((prev) => prev.map((item) => (item?._id === nextNode._id ? nextNode : item)));
        }
        pushHistoryEntry({
          kind: 'move',
          nodeId: dragCurrent.nodeId,
          beforePosition: previousPosition,
          afterPosition: resolvedNextPosition,
          ...(didReparent
            ? {
              beforeParentNodeId: previousParentNodeId,
              afterParentNodeId: nextParentNodeId
            }
            : {})
        });
      } catch (error) {
        setErrorText(error.message || '保存节点位置失败');
        loadGraph();
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [
    activeBrocadeId,
    canvasMetrics,
    loadGraph,
    nodes,
    nodesById,
    pushHistoryEntry,
    stageOffsetX,
    stageOffsetY,
    visibleNodes,
    viewportSize.height,
    viewportSize.width
  ]);

  const handleGraphWheel = useCallback((event) => {
    if (!scrollRef.current) return;
    event.preventDefault();
    const rect = scrollRef.current.getBoundingClientRect();
    applyZoom(
      zoomRef.current * Math.exp(-event.deltaY * 0.0015),
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      }
    );
  }, [applyZoom]);

  const handleGraphTouchStart = useCallback((event) => {
    if (event.touches.length < 2 || !scrollRef.current) {
      if (event.touches.length < 2) {
        pinchRef.current = null;
      }
      return;
    }

    const [touchA, touchB] = event.touches;
    const rect = scrollRef.current.getBoundingClientRect();
    if (dragRef.current?.target?.hasPointerCapture?.(dragRef.current.pointerId)) {
      dragRef.current.target.releasePointerCapture(dragRef.current.pointerId);
    }
    dragRef.current = null;
    setDraggingNodeId('');
    setDragReparentPreview(null);
    panRef.current = null;
    setIsPanning(false);
    pinchRef.current = {
      startDistance: getTouchDistance(touchA, touchB),
      startZoom: zoomRef.current
    };
    applyZoom(zoomRef.current, getTouchMidpoint(touchA, touchB, rect));
    event.preventDefault();
  }, [applyZoom]);

  const handleGraphTouchMove = useCallback((event) => {
    if (event.touches.length < 2 || !scrollRef.current) return;
    const [touchA, touchB] = event.touches;
    const pinchCurrent = pinchRef.current;
    if (!pinchCurrent?.startDistance) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const nextDistance = getTouchDistance(touchA, touchB);
    applyZoom(
      pinchCurrent.startZoom * (nextDistance / pinchCurrent.startDistance),
      getTouchMidpoint(touchA, touchB, rect)
    );
    event.preventDefault();
  }, [applyZoom]);

  const handleGraphTouchEnd = useCallback((event) => {
    if (event.touches.length < 2) {
      pinchRef.current = null;
    }
  }, []);

  const handleResetZoom = useCallback(() => {
    const container = scrollRef.current;
    applyZoom(
      ZOOM_DEFAULT,
      container
        ? {
          x: container.clientWidth / 2,
          y: container.clientHeight / 2
        }
        : null
    );
  }, [applyZoom]);

  const handleZoomStep = useCallback((delta) => {
    const container = scrollRef.current;
    applyZoom(
      zoomRef.current + delta,
      container
        ? {
          x: container.clientWidth / 2,
          y: container.clientHeight / 2
        }
        : null
    );
  }, [applyZoom]);

  const handleCanvasPointerDown = useCallback((event) => {
    if (event.button !== 0 || !scrollRef.current || dragRef.current) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('.jinzhi-node-card, button, textarea, input, select, a')) return;
    if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && String(selection).trim()) {
        selection.removeAllRanges();
      }
    }
    closeNodeInspector();
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originScrollLeft: scrollRef.current.scrollLeft,
      originScrollTop: scrollRef.current.scrollTop,
      container: scrollRef.current
    };
    setIsPanning(true);
    event.preventDefault();
  }, [closeNodeInspector]);

  const startNodeDrag = useCallback((event, node) => {
    if (event.button !== 0 || !node?._id || !scrollRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    }
    const container = scrollRef.current;
    const zoomScale = zoomRef.current || ZOOM_DEFAULT;
    const pointerCanvasPoint = getCanvasPointFromClientPoint(
      event.clientX,
      event.clientY,
      container,
      stageOffsetX,
      stageOffsetY,
      zoomScale
    );
    const originX = Number(node?.position?.x) || 0;
    const originY = Number(node?.position?.y) || 0;
    dragRef.current = {
      nodeId: node._id,
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
      pointerOffsetX: pointerCanvasPoint
        ? pointerCanvasPoint.x - (Number(canvasMetrics.originX) || 0) - originX
        : 0,
      pointerOffsetY: pointerCanvasPoint
        ? pointerCanvasPoint.y - (Number(canvasMetrics.originY) || 0) - originY
        : 0,
      originParentNodeId: node?.parentNodeId || '',
      previewParentNodeId: '',
      originScrollLeft: container.scrollLeft || 0,
      originScrollTop: container.scrollTop || 0,
      lastScrollLeft: container.scrollLeft || 0,
      lastScrollTop: container.scrollTop || 0,
      pointerId: event.pointerId,
      target: event.currentTarget
    };
    setDraggingNodeId(node._id);
    setDragReparentPreview(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [canvasMetrics.originX, canvasMetrics.originY, stageOffsetX, stageOffsetY]);

  const startNodeResize = useCallback((event, node, nodeSize, direction) => {
    if (node?._id !== selectedNodeId) {
      startNodeDrag(event, node);
      return;
    }
    if (event.button !== 0 || !node?._id) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      nodeId: node._id,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      originX: Number(node?.position?.x) || 0,
      originY: Number(node?.position?.y) || 0,
      originWidth: nodeSize.width,
      originHeight: nodeSize.height,
      nextSize: nodeSize,
      nextPosition: cloneNodePosition(node?.position),
      pointerId: event.pointerId,
      target: event.currentTarget
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [selectedNodeId, startNodeDrag]);

  const handleOpenEditor = useCallback(() => {
    if (!selectedNode?._id) return;
    openNodeEditor(selectedNode._id);
  }, [openNodeEditor, selectedNode?._id]);

  const persistNodeContent = useCallback(async (nodeId, contentText, options = {}) => {
    if (!nodeId || !activeBrocadeId) return null;
    const requestVersion = (contentSaveRequestVersionRef.current.get(nodeId) || 0) + 1;
    const shouldTrackBusy = !!options.trackBusy;
    contentSaveRequestVersionRef.current.set(nodeId, requestVersion);
    if (shouldTrackBusy) {
      setSavingContent(true);
    }
    setErrorText('');
    try {
      const data = await updateKnowledgeBrocadeNodeContent(activeBrocadeId, nodeId, { contentText });
      if (contentSaveRequestVersionRef.current.get(nodeId) !== requestVersion) {
        return { stale: true };
      }
      const nextNode = data?.node || null;
      const nextBrocade = data?.brocade || null;
      if (nextNode?._id) {
        setNodes((prev) => prev.map((item) => (item?._id === nextNode._id ? nextNode : item)));
      }
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        setBrocadeTitleDraft(nextBrocade.name || '');
        onBrocadeMetaChange?.(nextBrocade);
      }
      if (options.closeAfterSave) {
        setEditorOpen(false);
      }
      return { stale: false, node: nextNode, brocade: nextBrocade };
    } catch (error) {
      if (contentSaveRequestVersionRef.current.get(nodeId) === requestVersion) {
        setErrorText(error.message || '保存节点内容失败');
      }
      throw error;
    } finally {
      if (shouldTrackBusy && contentSaveRequestVersionRef.current.get(nodeId) === requestVersion) {
        setSavingContent(false);
      }
    }
  }, [activeBrocadeId, onBrocadeMetaChange]);

  const handleAutoSaveContent = useCallback(async (contentText) => {
    if (!selectedNode?._id) return null;
    return persistNodeContent(selectedNode._id, contentText, { closeAfterSave: false, trackBusy: false });
  }, [persistNodeContent, selectedNode?._id]);

  const handleSaveContent = useCallback(async (contentText) => {
    if (!selectedNode?._id) return null;
    return persistNodeContent(selectedNode._id, contentText, { closeAfterSave: true, trackBusy: true });
  }, [persistNodeContent, selectedNode?._id]);

  const handleToggleNodeStar = useCallback(async (node, nextStarred) => {
    if (!node?._id) return;
    const nodeId = node._id;
    const previousValue = !!node?.isStarred;
    const requestVersion = (starRequestVersionRef.current.get(nodeId) || 0) + 1;
    starRequestVersionRef.current.set(nodeId, requestVersion);
    setErrorText('');
    setStarPendingNodeIds((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    setNodes((prev) => prev.map((item) => (
      item?._id === nodeId
        ? { ...item, isStarred: !!nextStarred }
        : item
    )));
    try {
      const data = await updateKnowledgeBrocadeNode(activeBrocadeId, nodeId, { isStarred: !!nextStarred });
      if (starRequestVersionRef.current.get(nodeId) !== requestVersion) {
        return;
      }
      const nextNode = data?.node || null;
      if (nextNode?._id) {
        setNodes((prev) => prev.map((item) => (
          item?._id === nextNode._id
            ? {
              ...item,
              ...nextNode,
              isStarred: Object.prototype.hasOwnProperty.call(nextNode, 'isStarred')
                ? !!nextNode.isStarred
                : !!nextStarred
            }
            : item
        )));
      }
    } catch (error) {
      if (starRequestVersionRef.current.get(nodeId) !== requestVersion) {
        return;
      }
      setNodes((prev) => prev.map((item) => (
        item?._id === nodeId
          ? { ...item, isStarred: previousValue }
          : item
      )));
      setErrorText(error.message || '更新节点星标失败');
    } finally {
      if (starRequestVersionRef.current.get(nodeId) === requestVersion) {
        setStarPendingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }
    }
  }, [activeBrocadeId]);

  const handleCreateChild = useCallback((node) => {
    if (!node?._id) return;
    setSelectedNodeId(node._id);
    setCreateParentNode(node);
  }, []);

  const handleStartOutlineTitleEdit = useCallback((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node?._id) return;
    setSelectedNodeId(node._id);
    setOutlineSelectedNodeIds(new Set([node._id]));
    setEditingOutlineNodeId(node._id);
    setOutlineTitleDraft(normalizeNodeTitle(node.title, ''));
    setInspectorAnchor(null);
  }, [nodesById]);

  const handleCancelOutlineTitleEdit = useCallback((nodeId = '') => {
    setEditingOutlineNodeId((currentEditingNodeId) => {
      if (nodeId && currentEditingNodeId !== nodeId) return currentEditingNodeId;
      setOutlineTitleDraft('');
      return '';
    });
  }, []);

  const handleCommitOutlineTitle = useCallback(async (nodeId = editingOutlineNodeId, draft = outlineTitleDraft) => {
    if (!nodeId || !activeBrocadeId || outlineTitleCommitRef.current) return false;
    const node = nodesById.get(nodeId);
    if (!node?._id) {
      handleCancelOutlineTitleEdit(nodeId);
      return false;
    }
    const nextTitle = normalizeNodeTitle(draft, '').trim();
    if (!nextTitle) {
      handleCancelOutlineTitleEdit(nodeId);
      return false;
    }
    const currentTitle = normalizeNodeTitle(node.title, '').trim();
    if (nextTitle === currentTitle) {
      handleCancelOutlineTitleEdit(nodeId);
      return true;
    }

    outlineTitleCommitRef.current = true;
    setActionId(`rename:${nodeId}`);
    setErrorText('');
    try {
      const data = await updateKnowledgeBrocadeNodeContent(activeBrocadeId, nodeId, {
        contentText: buildNodeContentWithTitle(node, nextTitle)
      });
      const nextNode = data?.node || null;
      const nextBrocade = data?.brocade || null;
      if (nextNode?._id) {
        setNodes((prev) => prev.map((item) => (item?._id === nextNode._id ? nextNode : item)));
      }
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        setBrocadeTitleDraft(nextBrocade.name || '');
        onBrocadeMetaChange?.(nextBrocade);
      }
      setEditingOutlineNodeId((currentEditingNodeId) => {
        if (currentEditingNodeId !== nodeId) return currentEditingNodeId;
        setOutlineTitleDraft('');
        return '';
      });
      return true;
    } catch (error) {
      setErrorText(error.message || '更新节点标题失败');
      return false;
    } finally {
      setActionId('');
      outlineTitleCommitRef.current = false;
    }
  }, [activeBrocadeId, editingOutlineNodeId, handleCancelOutlineTitleEdit, nodesById, onBrocadeMetaChange, outlineTitleDraft]);

  const handleMoveOutlineNode = useCallback(async ({ nodeId = '', targetNodeId = '', placement = '' } = {}) => {
    const draggedNode = nodesById.get(nodeId);
    const targetNode = nodesById.get(targetNodeId);
    if (!draggedNode?._id || !targetNode?._id || draggedNode.isRoot || draggedNode._id === targetNode._id) return;

    const nextParentNodeId = placement === 'child'
      ? targetNode._id
      : targetNode.parentNodeId || '';
    if (!canMoveBrocadeNodeToParent(nodes, draggedNode._id, nextParentNodeId)) return;
    const nextPosition = placement === 'child'
      ? resolveReparentNodePosition(targetNode, draggedNode._id, nodes)
      : resolveOutlineSiblingDropPosition(nodes, draggedNode._id, targetNode, placement);
    if (!nextPosition) return;

    const previousPosition = cloneNodePosition(draggedNode.position);
    const previousParentNodeId = draggedNode.parentNodeId || '';
    const didMovePosition = !arePositionsEqual(previousPosition, nextPosition);
    const didReparent = previousParentNodeId !== nextParentNodeId;
    if (!didMovePosition && !didReparent) return;

    setSelectedNodeId(draggedNode._id);
    setOutlineSelectedNodeIds(new Set([draggedNode._id]));
    setActionId(`outline-move:${draggedNode._id}`);
    setErrorText('');
    setNodes((prev) => prev.map((item) => (
      item?._id === draggedNode._id
        ? { ...item, parentNodeId: nextParentNodeId, position: nextPosition }
        : item
    )));
    try {
      const data = await updateKnowledgeBrocadeNode(activeBrocadeId, draggedNode._id, {
        position: nextPosition,
        ...(didReparent ? { parentNodeId: nextParentNodeId } : {})
      });
      const nextNode = data?.node || null;
      if (nextNode?._id) {
        setNodes((prev) => prev.map((item) => (item?._id === nextNode._id ? nextNode : item)));
      }
      pushHistoryEntry({
        kind: 'move',
        nodeId: draggedNode._id,
        beforePosition: previousPosition,
        afterPosition: nextPosition,
        beforeParentNodeId: previousParentNodeId,
        afterParentNodeId: nextParentNodeId
      });
    } catch (error) {
      setErrorText(error.message || '保存大纲节点位置失败');
      loadGraph();
    } finally {
      setActionId('');
    }
  }, [activeBrocadeId, loadGraph, nodes, nodesById, pushHistoryEntry]);

  const handleCreateOutlineSibling = useCallback(async (sourceNodeId = '') => {
    const siblingNode = (sourceNodeId ? nodesById.get(sourceNodeId) : null) || selectedNode;
    if (!siblingNode?._id) return;
    if (!siblingNode.parentNodeId) {
      setErrorText('');
      showWorkspaceToast('根节点没有兄弟节点');
      return;
    }
    const parentNode = nodesById.get(siblingNode.parentNodeId);
    if (!parentNode?._id) return;
    const siblingInsertion = resolveOutlineSiblingInsertion(siblingNode, nodes);
    setActionId(`outline-create:${siblingNode._id}`);
    setErrorText('');
    try {
      const data = await createKnowledgeBrocadeNode(activeBrocadeId, {
        contentText: '',
        parentNodeId: parentNode._id,
        position: siblingInsertion.position
      });
      const nextNode = data?.node || null;
      const nextBrocade = data?.brocade || null;
      if (nextNode?._id) {
        setNodes((prev) => [
          ...prev.map((item) => {
            const move = siblingInsertion.moves.find((entry) => entry.nodeId === item?._id);
            return move ? { ...item, position: move.afterPosition } : item;
          }),
          nextNode
        ]);
        if (siblingInsertion.moves.length > 0) {
          const movedResponses = await Promise.all(
            siblingInsertion.moves.map((move) => updateKnowledgeBrocadeNode(activeBrocadeId, move.nodeId, {
              position: move.afterPosition
            }))
          );
          const savedMovedNodes = movedResponses.map((response) => response?.node).filter((node) => node?._id);
          if (savedMovedNodes.length > 0) {
            setNodes((prev) => prev.map((item) => savedMovedNodes.find((node) => node._id === item?._id) || item));
          }
        }
        setSelectedNodeId(nextNode._id);
        setOutlineSelectedNodeIds(new Set([nextNode._id]));
        setViewMode(VIEW_MODE.OUTLINE);
        setEditingOutlineNodeId(nextNode._id);
        setOutlineTitleDraft(normalizeNodeTitle(nextNode.title, ''));
        pushHistoryEntry({
          kind: 'create',
          nodeSnapshot: snapshotNodeForHistory(nextNode)
        });
        if (siblingInsertion.moves.length > 0) {
          pushHistoryEntry({
            kind: 'move',
            moves: siblingInsertion.moves
          });
        }
      }
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        onBrocadeMetaChange?.(nextBrocade);
      }
    } catch (error) {
      setErrorText(error.message || '创建兄弟节点失败');
    } finally {
      setActionId('');
    }
  }, [activeBrocadeId, nodes, nodesById, onBrocadeMetaChange, pushHistoryEntry, selectedNode, showWorkspaceToast]);

  const handleConfirmOutlineTitleAndCreateSibling = useCallback(async (nodeId, draft) => {
    const node = nodesById.get(nodeId);
    if (!node?._id) return;
    const nextTitle = normalizeNodeTitle(draft, '').trim();
    if (nextTitle) {
      const didCommit = await handleCommitOutlineTitle(nodeId, nextTitle);
      if (didCommit === false) return;
    } else {
      handleCancelOutlineTitleEdit(nodeId);
    }
    await handleCreateOutlineSibling(nodeId);
  }, [handleCancelOutlineTitleEdit, handleCommitOutlineTitle, handleCreateOutlineSibling, nodesById]);

  const handleOutlineLevelChange = useCallback(async (direction) => {
    const selectedIds = outlineSelectedNodeIds.size > 0
      ? Array.from(outlineSelectedNodeIds)
      : (selectedNodeId ? [selectedNodeId] : []);
    const selectedRoots = getOutlineSelectionRoots(nodes, selectedIds)
      .filter((node) => node?._id && !node?.isRoot);
    if (selectedRoots.length < 1) return;

    const parentIds = new Set(selectedRoots.map((node) => node?.parentNodeId || ''));
    if (parentIds.size !== 1) {
      setErrorText('批量调整层级时，请先选择同级节点');
      return;
    }
    const currentParentId = selectedRoots[0]?.parentNodeId || '';
    const siblingNodes = sortBrocadeNodesByPosition(
      nodes.filter((node) => (node?.parentNodeId || '') === currentParentId)
    );
    const selectedRootIds = new Set(selectedRoots.map((node) => node._id));
    let targetParentId = '';
    if (direction === 'indent') {
      const firstSelectedIndex = siblingNodes.findIndex((node) => selectedRootIds.has(node?._id));
      const previousSibling = siblingNodes
        .slice(0, firstSelectedIndex)
        .reverse()
        .find((node) => !selectedRootIds.has(node?._id));
      if (!previousSibling?._id) {
        setErrorText('当前节点已经是同级最前面，无法向下缩进');
        return;
      }
      targetParentId = previousSibling._id;
    } else {
      const currentParent = nodesById.get(currentParentId);
      targetParentId = currentParent?.parentNodeId || '';
      if (!targetParentId) {
        setErrorText('当前节点已在根节点下，无法继续提升层级');
        return;
      }
    }

    const targetParent = nodesById.get(targetParentId);
    if (!targetParent?._id || selectedRootIds.has(targetParentId)) return;
    const orderedRoots = selectedRoots.sort((left, right) => (
      (Number(left?.position?.y) || 0) - (Number(right?.position?.y) || 0)
      || (Number(left?.position?.x) || 0) - (Number(right?.position?.x) || 0)
    ));
    const workingNodes = [...nodes];
    const moves = [];
    orderedRoots.forEach((node) => {
      if (!canPreviewBrocadeReparent(workingNodes, node._id, targetParentId)) return;
      const nextPosition = resolveReparentNodePosition(targetParent, node._id, workingNodes);
      moves.push({
        nodeId: node._id,
        beforePosition: cloneNodePosition(node.position),
        afterPosition: nextPosition,
        beforeParentNodeId: node.parentNodeId || '',
        afterParentNodeId: targetParentId
      });
      const index = workingNodes.findIndex((item) => item?._id === node._id);
      if (index >= 0) {
        workingNodes[index] = {
          ...workingNodes[index],
          parentNodeId: targetParentId,
          position: nextPosition
        };
      }
    });
    if (moves.length < 1) return;

    setActionId(`outline-level:${direction}`);
    setErrorText('');
    setNodes((prev) => prev.map((item) => {
      const move = moves.find((entry) => entry.nodeId === item?._id);
      return move
        ? { ...item, parentNodeId: move.afterParentNodeId, position: move.afterPosition }
        : item;
    }));
    try {
      const responses = await Promise.all(
        moves.map((move) => updateKnowledgeBrocadeNode(activeBrocadeId, move.nodeId, {
          parentNodeId: move.afterParentNodeId,
          position: move.afterPosition
        }))
      );
      const savedNodes = responses.map((response) => response?.node).filter((node) => node?._id);
      if (savedNodes.length > 0) {
        setNodes((prev) => prev.map((item) => savedNodes.find((node) => node._id === item?._id) || item));
      }
      pushHistoryEntry({ kind: 'move', moves });
    } catch (error) {
      setErrorText(error.message || '调整节点层级失败');
      loadGraph();
    } finally {
      setActionId('');
    }
  }, [activeBrocadeId, loadGraph, nodes, nodesById, outlineSelectedNodeIds, pushHistoryEntry, selectedNodeId]);

  const handleToggleNodeCollapse = useCallback((nodeId) => {
    if (!nodeId) return;
    setCollapsedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const commitBrocadeTitle = useCallback(async () => {
    if (!activeBrocadeId || savingBrocadeTitle || brocadeTitleCommitRef.current) return;
    const nextName = String(brocadeTitleDraft || '').trim();
    const fallbackName = brocade?.name || initialBrocadeName || '知识锦';
    const resolvedName = (nextName || fallbackName).slice(0, 80);
    brocadeTitleCommitRef.current = true;
    setIsEditingBrocadeTitle(false);
    setBrocadeTitleDraft(resolvedName);
    if (!resolvedName || resolvedName === (brocade?.name || '')) {
      brocadeTitleCommitRef.current = false;
      return;
    }
    setSavingBrocadeTitle(true);
    setErrorText('');
    try {
      const data = await updateKnowledgeBrocade(activeBrocadeId, { name: resolvedName });
      const nextBrocade = data?.brocade || null;
      const nextRootNode = data?.rootNode || null;
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        setBrocadeTitleDraft(nextBrocade.name || resolvedName);
        onBrocadeMetaChange?.(nextBrocade);
      }
      if (nextRootNode?._id) {
        setNodes((prev) => prev.map((item) => (item?._id === nextRootNode._id ? nextRootNode : item)));
      }
    } catch (error) {
      setBrocadeTitleDraft(fallbackName);
      setErrorText(error.message || '更新知识锦标题失败');
    } finally {
      setSavingBrocadeTitle(false);
      brocadeTitleCommitRef.current = false;
    }
  }, [activeBrocadeId, brocade?.name, brocadeTitleDraft, initialBrocadeName, onBrocadeMetaChange, savingBrocadeTitle]);

  useEffect(() => {
    if (!isEditingBrocadeTitle || typeof document === 'undefined') return undefined;
    const handlePointerDownOutside = (event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (brocadeTitleEditorRef.current?.contains(target)) return;
      void commitBrocadeTitle();
    };
    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
    };
  }, [commitBrocadeTitle, isEditingBrocadeTitle]);

  const handleSelectOutlineNode = useCallback((nodeId, event = null) => {
    if (!nodeId || !nodesById.has(nodeId)) return;
    if (editingOutlineNodeId && editingOutlineNodeId !== nodeId) {
      handleCancelOutlineTitleEdit(editingOutlineNodeId);
    }
    const isToggleSelection = !!(event?.metaKey || event?.ctrlKey);
    if (isToggleSelection && outlineSelectedNodeIds.has(nodeId) && outlineSelectedNodeIds.size > 1) {
      const nextActiveNodeId = Array.from(outlineSelectedNodeIds).find((item) => item !== nodeId) || nodeId;
      setSelectedNodeId(nextActiveNodeId);
      setOutlineSelectedNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    } else if (isToggleSelection) {
      setSelectedNodeId(nodeId);
      setOutlineSelectedNodeIds((prev) => new Set([...prev, nodeId]));
    } else {
      setSelectedNodeId(nodeId);
      setOutlineSelectedNodeIds(new Set([nodeId]));
    }
    setInspectorAnchor(null);
  }, [editingOutlineNodeId, handleCancelOutlineTitleEdit, nodesById, outlineSelectedNodeIds]);

  const handleLassoOutlineSelection = useCallback((nodeIds = [], activeNodeId = '') => {
    const validIds = nodeIds.filter((nodeId) => nodesById.has(nodeId));
    if (validIds.length < 1) return;
    const nextActiveNodeId = nodesById.has(activeNodeId) ? activeNodeId : validIds[0];
    if (editingOutlineNodeId && editingOutlineNodeId !== nextActiveNodeId) {
      handleCancelOutlineTitleEdit(editingOutlineNodeId);
    }
    setOutlineSelectedNodeIds(new Set(validIds));
    setSelectedNodeId(nextActiveNodeId);
    setInspectorAnchor(null);
  }, [editingOutlineNodeId, handleCancelOutlineTitleEdit, nodesById]);

  const handleOpenOutlineDeleteDialog = useCallback((nodeIds = []) => {
    const selectedNodes = Array.from(new Set(nodeIds))
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node) => node?._id);
    const deletableNodes = selectedNodes.filter((node) => !node.isRoot);
    if (deletableNodes.length < 2 || deletableNodes.length !== selectedNodes.length) return;
    setOutlineDeleteDialog({
      nodeIds: deletableNodes.map((node) => node._id)
    });
    setEditingOutlineNodeId('');
    setOutlineTitleDraft('');
    setInspectorAnchor(null);
  }, [nodesById]);

  const handleConfirmOutlineDelete = useCallback(async () => {
    const selectedIds = outlineDeleteDialog?.nodeIds || [];
    if (!activeBrocadeId || selectedIds.length < 1 || actionId) return;
    const deleteRoots = getOutlineSelectionRoots(nodes, selectedIds)
      .filter((node) => node?._id && !node.isRoot);
    if (deleteRoots.length < 1) {
      setOutlineDeleteDialog(null);
      return;
    }

    const deletedSnapshots = [];
    const deletedSnapshotIds = new Set();
    deleteRoots.forEach((node) => {
      collectNodeSubtreeSnapshots(nodes, node._id).forEach((snapshot) => {
        if (!deletedSnapshotIds.has(snapshot._id)) {
          deletedSnapshotIds.add(snapshot._id);
          deletedSnapshots.push(snapshot);
        }
      });
    });

    setOutlineDeleteDialog(null);
    setActionId('delete:outline');
    setErrorText('');
    try {
      const deletedNodeIds = new Set();
      let nextBrocade = null;
      for (const node of deleteRoots) {
        const data = await deleteKnowledgeBrocadeNode(activeBrocadeId, node._id);
        (Array.isArray(data?.deletedNodeIds) ? data.deletedNodeIds : []).forEach((nodeId) => {
          deletedNodeIds.add(nodeId);
        });
        if (data?.brocade?._id) nextBrocade = data.brocade;
      }
      setNodes((prev) => prev.filter((item) => !deletedNodeIds.has(item?._id)));
      setSelectedNodeId((prev) => (prev && !deletedNodeIds.has(prev) ? prev : ''));
      setOutlineSelectedNodeIds((prev) => new Set(Array.from(prev).filter((nodeId) => !deletedNodeIds.has(nodeId))));
      if (editingOutlineNodeId && deletedNodeIds.has(editingOutlineNodeId)) {
        handleCancelOutlineTitleEdit();
      }
      if (deletedSnapshots.length > 0) {
        const rootNodeIds = deleteRoots.map((node) => node._id);
        pushHistoryEntry({
          kind: 'delete',
          rootNodeId: rootNodeIds[0] || '',
          rootNodeIds,
          deletedSnapshots
        });
      }
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        onBrocadeMetaChange?.(nextBrocade);
      }
    } catch (error) {
      setErrorText(error.message || '删除选中的节点失败');
      loadGraph();
    } finally {
      setActionId('');
    }
  }, [actionId, activeBrocadeId, editingOutlineNodeId, handleCancelOutlineTitleEdit, loadGraph, nodes, onBrocadeMetaChange, outlineDeleteDialog, pushHistoryEntry]);

  const handleSetViewMode = useCallback((nextViewMode) => {
    setViewMode(nextViewMode);
    setInspectorAnchor(null);
    setEditingOutlineNodeId('');
    setOutlineTitleDraft('');
    setOutlineDeleteDialog(null);
    if (nextViewMode === VIEW_MODE.OUTLINE) {
      const nextNodeId = selectedNodeId || rootNode?._id || nodes[0]?._id || '';
      if (nextNodeId) {
        setSelectedNodeId(nextNodeId);
        setOutlineSelectedNodeIds(new Set([nextNodeId]));
      }
    } else {
      setOutlineSelectedNodeIds(new Set());
    }
  }, [nodes, rootNode?._id, selectedNodeId]);

  const handleJumpToNode = useCallback((nodeId) => {
    const targetNode = nodesById.get(nodeId);
    if (!targetNode) return;
    setOutlineSelectedNodeIds(viewMode === VIEW_MODE.OUTLINE ? new Set([nodeId]) : new Set());
    setSelectedNodeId(nodeId);
    if (viewMode === VIEW_MODE.TREE) {
      centerNodeInViewport(scrollRef, targetNode, canvasMetrics, zoomRef.current);
      lastAutoCenteredNodeIdRef.current = nodeId;
    }
  }, [canvasMetrics, nodesById, viewMode]);

  const submitCreateChild = async ({ contentText, isStarred }) => {
    const parentNode = createParentNode;
    if (!parentNode?._id) return;
    setActionId(`create:${parentNode._id}`);
    setErrorText('');
    try {
      const createPosition = resolveCreateNodePosition(parentNode, nodes);
      const data = await createKnowledgeBrocadeNode(activeBrocadeId, {
        contentText,
        isStarred: !!isStarred,
        parentNodeId: parentNode._id,
        position: createPosition
      });
      const nextNode = data?.node || null;
      const nextBrocade = data?.brocade || null;
      if (nextNode?._id) {
        setNodes((prev) => [...prev, nextNode]);
        setSelectedNodeId(nextNode._id);
        setOutlineSelectedNodeIds(viewMode === VIEW_MODE.OUTLINE ? new Set([nextNode._id]) : new Set());
        setCreateParentNode(null);
        pushHistoryEntry({
          kind: 'create',
          nodeSnapshot: snapshotNodeForHistory(nextNode)
        });
      }
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        onBrocadeMetaChange?.(nextBrocade);
      }
    } catch (error) {
      setErrorText(error.message || '创建子节点失败');
    } finally {
      setActionId('');
    }
  };

  const handleDeleteNode = useCallback(async (node) => {
    if (!node?._id || node?.isRoot) return;
    const confirmed = window.confirm(`确认删除节点「${String(node.title || '').trim() || '该节点'}」？这会一并删除它的全部子节点。`);
    if (!confirmed) return;
    const deletedSnapshots = collectNodeSubtreeSnapshots(nodes, node._id);
    setActionId(`delete:${node._id}`);
    setErrorText('');
    try {
      const data = await deleteKnowledgeBrocadeNode(activeBrocadeId, node._id);
      const deletedIds = Array.isArray(data?.deletedNodeIds) ? data.deletedNodeIds : [];
      const nextBrocade = data?.brocade || null;
      setNodes((prev) => prev.filter((item) => !deletedIds.includes(item?._id)));
      setSelectedNodeId((prev) => (prev && !deletedIds.includes(prev) ? prev : ''));
      setOutlineSelectedNodeIds((prev) => new Set(Array.from(prev).filter((nodeId) => !deletedIds.includes(nodeId))));
      if (deletedIds.includes(editingOutlineNodeId)) {
        handleCancelOutlineTitleEdit();
      }
      if (deletedSnapshots.length > 0) {
        pushHistoryEntry({
          kind: 'delete',
          rootNodeId: node._id,
          deletedSnapshots
        });
      }
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        onBrocadeMetaChange?.(nextBrocade);
      }
    } catch (error) {
      setErrorText(error.message || '删除节点失败');
    } finally {
      setActionId('');
    }
  }, [activeBrocadeId, editingOutlineNodeId, handleCancelOutlineTitleEdit, nodes, onBrocadeMetaChange, pushHistoryEntry]);

  const handleUndo = useCallback(async () => {
    const entry = historyState.undoStack[historyState.undoStack.length - 1];
    if (!entry || historyActionId) return;
    setHistoryActionId(`undo:${entry.kind}`);
    setErrorText('');
    try {
      if (entry.kind === 'move') {
        const moveEntries = Array.isArray(entry.moves) && entry.moves.length > 0 ? entry.moves : [entry];
        setNodes((prev) => prev.map((item) => (
          moveEntries.reduce((currentItem, move) => (
            currentItem?._id === move.nodeId
              ? {
                ...currentItem,
                position: cloneNodePosition(move.beforePosition),
                parentNodeId: Object.prototype.hasOwnProperty.call(move, 'beforeParentNodeId')
                  ? (move.beforeParentNodeId || '')
                  : (currentItem?.parentNodeId || '')
              }
              : currentItem
          ), item)
        )));
        await Promise.all(moveEntries.map((move) => updateKnowledgeBrocadeNode(activeBrocadeId, move.nodeId, {
          position: cloneNodePosition(move.beforePosition),
          ...(Object.prototype.hasOwnProperty.call(move, 'beforeParentNodeId')
            ? { parentNodeId: move.beforeParentNodeId || '' }
            : {})
        })));
      } else if (entry.kind === 'create') {
        const data = await deleteKnowledgeBrocadeNode(activeBrocadeId, entry.nodeSnapshot._id);
        setNodes((prev) => prev.filter((item) => item?._id !== entry.nodeSnapshot._id));
        setSelectedNodeId((prev) => (prev === entry.nodeSnapshot._id ? '' : prev));
        if (data?.brocade?._id) {
          setBrocade(data.brocade);
          onBrocadeMetaChange?.(data.brocade);
        }
      } else if (entry.kind === 'delete') {
        await restoreNodeSnapshots(entry.deletedSnapshots);
        const restoredRootIds = Array.isArray(entry.rootNodeIds) && entry.rootNodeIds.length > 0
          ? entry.rootNodeIds
          : [entry.rootNodeId].filter(Boolean);
        setSelectedNodeId(restoredRootIds[0] || '');
        setOutlineSelectedNodeIds(new Set(restoredRootIds));
      }
      setHistoryState((prev) => ({
        undoStack: prev.undoStack.slice(0, -1),
        redoStack: [...prev.redoStack, entry].slice(-HISTORY_LIMIT)
      }));
    } catch (error) {
      setErrorText(error.message || '撤销失败');
      loadGraph();
    } finally {
      setHistoryActionId('');
    }
  }, [activeBrocadeId, historyActionId, historyState.undoStack, loadGraph, onBrocadeMetaChange, restoreNodeSnapshots]);

  const handleRedo = useCallback(async () => {
    const entry = historyState.redoStack[historyState.redoStack.length - 1];
    if (!entry || historyActionId) return;
    setHistoryActionId(`redo:${entry.kind}`);
    setErrorText('');
    try {
      if (entry.kind === 'move') {
        const moveEntries = Array.isArray(entry.moves) && entry.moves.length > 0 ? entry.moves : [entry];
        setNodes((prev) => prev.map((item) => (
          moveEntries.reduce((currentItem, move) => (
            currentItem?._id === move.nodeId
              ? {
                ...currentItem,
                position: cloneNodePosition(move.afterPosition),
                parentNodeId: Object.prototype.hasOwnProperty.call(move, 'afterParentNodeId')
                  ? (move.afterParentNodeId || '')
                  : (currentItem?.parentNodeId || '')
              }
              : currentItem
          ), item)
        )));
        await Promise.all(moveEntries.map((move) => updateKnowledgeBrocadeNode(activeBrocadeId, move.nodeId, {
          position: cloneNodePosition(move.afterPosition),
          ...(Object.prototype.hasOwnProperty.call(move, 'afterParentNodeId')
            ? { parentNodeId: move.afterParentNodeId || '' }
            : {})
        })));
      } else if (entry.kind === 'create') {
        await restoreNodeSnapshots([entry.nodeSnapshot]);
        setSelectedNodeId(entry.nodeSnapshot._id || '');
      } else if (entry.kind === 'delete') {
        const deleteRootIds = Array.isArray(entry.rootNodeIds) && entry.rootNodeIds.length > 0
          ? entry.rootNodeIds
          : [entry.rootNodeId].filter(Boolean);
        const deletedIdSet = new Set(entry.deletedSnapshots.map((item) => item?._id).filter(Boolean));
        let nextBrocade = null;
        for (const rootNodeId of deleteRootIds) {
          const data = await deleteKnowledgeBrocadeNode(activeBrocadeId, rootNodeId);
          if (data?.brocade?._id) nextBrocade = data.brocade;
        }
        setNodes((prev) => prev.filter((item) => !deletedIdSet.has(item?._id)));
        setSelectedNodeId((prev) => (prev && !deletedIdSet.has(prev) ? prev : ''));
        setOutlineSelectedNodeIds((prev) => new Set(Array.from(prev).filter((nodeId) => !deletedIdSet.has(nodeId))));
        if (nextBrocade?._id) {
          setBrocade(nextBrocade);
          onBrocadeMetaChange?.(nextBrocade);
        }
      }
      setHistoryState((prev) => ({
        undoStack: [...prev.undoStack, entry].slice(-HISTORY_LIMIT),
        redoStack: prev.redoStack.slice(0, -1)
      }));
    } catch (error) {
      setErrorText(error.message || '重做失败');
      loadGraph();
    } finally {
      setHistoryActionId('');
    }
  }, [activeBrocadeId, historyActionId, historyState.redoStack, loadGraph, onBrocadeMetaChange, restoreNodeSnapshots]);

  const handleOutlineKeyDown = useCallback((event) => {
    if (viewMode !== VIEW_MODE.OUTLINE || editorOpen || createParentNode) return;
    if (event.target?.closest?.('input, textarea')) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void handleCreateOutlineSibling();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      void handleOutlineLevelChange(event.shiftKey ? 'outdent' : 'indent');
      return;
    }
    if (event.key === 'e' || event.key === 'E') {
      event.preventDefault();
      event.stopPropagation();
      openNodeEditor(selectedNodeId);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedNode && !selectedNode.isRoot) {
        event.preventDefault();
        event.stopPropagation();
        void handleDeleteNode(selectedNode);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleSetViewMode(VIEW_MODE.TREE);
    }
  }, [createParentNode, editorOpen, handleCreateOutlineSibling, handleDeleteNode, handleOutlineLevelChange, handleSetViewMode, openNodeEditor, selectedNode, selectedNodeId, viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleKeyDown = (event) => {
      if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') {
        return;
      }
      if (viewMode === VIEW_MODE.OUTLINE) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? event.metaKey : event.ctrlKey;
      if (cmdKey && event.key === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (cmdKey && !event.shiftKey && event.key === 'z') {
        event.preventDefault();
        if (canUndo) handleUndo();
        return;
      }
      if ((cmdKey && event.shiftKey && event.key === 'z') || (cmdKey && event.key === 'y')) {
        event.preventDefault();
        if (canRedo) handleRedo();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        if (selectedNodeId && !createParentNode) {
          event.preventDefault();
          const nodeToAddChild = nodesById.get(selectedNodeId);
          if (nodeToAddChild) setCreateParentNode(nodeToAddChild);
        }
        return;
      }
      if (event.key === 'e' || event.key === 'E') {
        if (selectedNodeId && !editorOpen) {
          event.preventDefault();
          setEditorOpen(true);
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeId && selectedNode && !selectedNode.isRoot) {
          event.preventDefault();
          void handleDeleteNode(selectedNode);
        }
        return;
      }
      if (event.key === ' ') {
        if (selectedNodeId && childCountByNodeId.get(selectedNodeId) > 0) {
          event.preventDefault();
          setCollapsedNodeIds((prev) => {
            const next = new Set(prev);
            if (next.has(selectedNodeId)) next.delete(selectedNodeId);
            else next.add(selectedNodeId);
            return next;
          });
        }
        return;
      }
      if (event.key === 'Escape') {
        if (searchOpen) { setSearchOpen(false); return; }
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (editorOpen) { setEditorOpen(false); return; }
        if (textPreviewOpen) { setTextPreviewOpen(false); return; }
        if (createParentNode) { setCreateParentNode(null); return; }
        if (selectedNodeId) { setSelectedNodeId(''); return; }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRedo, canUndo, childCountByNodeId, createParentNode, editorOpen, handleDeleteNode, handleRedo, handleUndo, nodesById, searchOpen, selectedNode, selectedNodeId, shortcutsOpen, textPreviewOpen, viewMode]);

  if (!activeBrocadeId) {
    return (
      <div className="jinzhi-workspace-page">
        <div className="jinzhi-workspace-page__empty">
          <h2>尚未选择知识锦</h2>
          <p>从右侧 `知识锦` 抽屉里选择一个知识锦后，就可以开始编辑你的节点图谱。</p>
          <button type="button" className="jinzhi-back-btn" onClick={onBack}>返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`jinzhi-workspace-page theme-${canvasTheme}`}>
      {toastText ? (
        <div className="jinzhi-workspace-page__toast" role="status" aria-live="polite">
          {toastText}
        </div>
      ) : null}
      <header className="jinzhi-workspace-page__header">
        <div className="jinzhi-workspace-page__title">
          <button type="button" className="jinzhi-back-btn" onClick={onBack}>
            <ArrowLeft size={15} />
            返回
          </button>
        </div>
        <div className="jinzhi-workspace-page__toolbar">
          <div className="jinzhi-toolbar-group jinzhi-toolbar-group--segment" aria-label="连线模式">
            <button
              type="button"
              className={`jinzhi-toolbar-btn jinzhi-toolbar-btn--segment ${edgeViewMode === EDGE_VIEW_MODE.MERGED ? 'is-active' : ''}`}
              onClick={() => setEdgeViewMode(EDGE_VIEW_MODE.MERGED)}
            >
              合并连线
            </button>
            <button
              type="button"
              className={`jinzhi-toolbar-btn jinzhi-toolbar-btn--segment ${edgeViewMode === EDGE_VIEW_MODE.STRAIGHT ? 'is-active' : ''}`}
              onClick={() => setEdgeViewMode(EDGE_VIEW_MODE.STRAIGHT)}
            >
              直线连线
            </button>
          </div>
          <div className="jinzhi-toolbar-group jinzhi-toolbar-group--ops" aria-label="历史操作">
            <button
              type="button"
              className="jinzhi-toolbar-btn jinzhi-toolbar-btn--icon"
              onClick={handleUndo}
              disabled={!canUndo}
              title="撤销"
              aria-label="撤销"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="jinzhi-toolbar-btn jinzhi-toolbar-btn--icon"
              onClick={handleRedo}
              disabled={!canRedo}
              title="重做"
              aria-label="重做"
            >
              <RotateCw size={14} />
            </button>
          </div>
          <div className="jinzhi-toolbar-group jinzhi-toolbar-group--ops" aria-label="搜索与帮助">
            <button
              type="button"
              className="jinzhi-toolbar-btn jinzhi-toolbar-btn--icon"
              onClick={() => setSearchOpen(true)}
              title="搜索节点 (Ctrl+F)"
              aria-label="搜索节点"
            >
              <Search size={14} />
            </button>
            <button
              type="button"
              className={`jinzhi-toolbar-btn jinzhi-toolbar-btn--icon${showMiniMap ? ' is-active' : ''}`}
              onClick={() => setShowMiniMap((prev) => !prev)}
              title={showMiniMap ? '隐藏缩略图' : '显示缩略图'}
              aria-label={showMiniMap ? '隐藏缩略图' : '显示缩略图'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" />
                <line x1="16" y1="6" x2="16" y2="22" />
              </svg>
            </button>
            <button
              type="button"
              className="jinzhi-toolbar-btn jinzhi-toolbar-btn--icon"
              onClick={() => setShortcutsOpen(true)}
              title="快捷键帮助"
              aria-label="快捷键帮助"
            >
              <Keyboard size={14} />
            </button>
          </div>
          <div className="jinzhi-toolbar-group jinzhi-toolbar-group--theme" aria-label="主题切换">
            <button
              type="button"
              className={`jinzhi-toolbar-btn jinzhi-toolbar-btn--theme ${canvasTheme === CANVAS_THEME.DAY ? 'is-active' : ''}`}
              onClick={() => setCanvasTheme(CANVAS_THEME.DAY)}
              title="白天主题"
            >
              <Sun size={14} />
              <span className="jinzhi-toolbar-btn__label jinzhi-toolbar-btn__label--collapse-sm">白天</span>
            </button>
            <button
              type="button"
              className={`jinzhi-toolbar-btn jinzhi-toolbar-btn--theme ${canvasTheme === CANVAS_THEME.NIGHT ? 'is-active' : ''}`}
              onClick={() => setCanvasTheme(CANVAS_THEME.NIGHT)}
              title="黑夜主题"
            >
              <Moon size={14} />
              <span className="jinzhi-toolbar-btn__label jinzhi-toolbar-btn__label--collapse-sm">黑夜</span>
            </button>
          </div>
          <div className="jinzhi-toolbar-group jinzhi-toolbar-group--zoom" aria-label="缩放控制">
            <button
              type="button"
              className="jinzhi-toolbar-btn jinzhi-toolbar-btn--icon"
              onClick={() => handleZoomStep(-0.12)}
              title="缩小"
              aria-label="缩小"
            >
              -
            </button>
            <input
              type="range"
              className="jinzhi-toolbar-slider"
              min={zoomRange.min}
              max={zoomRange.max}
              step="0.01"
              value={zoom}
              style={{ '--jinzhi-slider-fill': zoomFillPercent }}
              aria-label="缩放滑块"
              onChange={(event) => {
                const container = scrollRef.current;
                applyZoom(
                  Number(event.target.value),
                  container
                    ? {
                      x: container.clientWidth / 2,
                      y: container.clientHeight / 2
                    }
                    : null
                );
              }}
            />
            <div className="jinzhi-toolbar-zoom-value">{Math.round(zoom * 100)}%</div>
            <button
              type="button"
              className="jinzhi-toolbar-btn jinzhi-toolbar-btn--icon"
              onClick={() => handleZoomStep(0.12)}
              title="放大"
              aria-label="放大"
            >
              +
            </button>
            <button type="button" className="jinzhi-toolbar-btn jinzhi-toolbar-btn--subtle" onClick={handleResetZoom}>
              <span className="jinzhi-toolbar-btn__label jinzhi-toolbar-btn__label--collapse-md">重置缩放</span>
              <span className="jinzhi-toolbar-btn__label jinzhi-toolbar-btn__label--only-compact">重置</span>
            </button>
            <button
              type="button"
              className="jinzhi-toolbar-btn jinzhi-toolbar-btn--subtle"
              onClick={() => centerCanvasInViewport(scrollRef, rootNode, canvasMetrics, zoomRef.current)}
              disabled={loading}
            >
              <span className="jinzhi-toolbar-btn__label jinzhi-toolbar-btn__label--collapse-md">定位到中心</span>
              <span className="jinzhi-toolbar-btn__label jinzhi-toolbar-btn__label--only-compact">中心</span>
            </button>
          </div>
        </div>
      </header>

      {errorText ? <div className="jinzhi-workspace-page__error">{errorText}</div> : null}

      <div className="jinzhi-workspace-page__layout">
        <section ref={canvasCardRef} className="jinzhi-workspace-page__canvas-card">
          <div className="jinzhi-workspace-page__canvas-toolbar">
            <div ref={brocadeTitleEditorRef} className="jinzhi-workspace-page__canvas-toolbar-title-shell">
              {isEditingBrocadeTitle ? (
                <input
                  type="text"
                  value={brocadeTitleDraft}
                  maxLength={80}
                  className="jinzhi-workspace-page__canvas-toolbar-title-input"
                  onChange={(event) => setBrocadeTitleDraft(event.target.value)}
                  onBlur={() => {
                    void commitBrocadeTitle();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      brocadeTitleCommitRef.current = false;
                      setIsEditingBrocadeTitle(false);
                      setBrocadeTitleDraft(brocade?.name || initialBrocadeName || '知识锦');
                    }
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="jinzhi-workspace-page__canvas-toolbar-title-btn"
                  onClick={() => {
                    setBrocadeTitleDraft(brocade?.name || initialBrocadeName || '知识锦');
                    setIsEditingBrocadeTitle(true);
                  }}
                  disabled={savingBrocadeTitle}
                  title={savingBrocadeTitle ? '正在保存标题' : '点击修改标题'}
                >
                  {brocade?.name || initialBrocadeName || '知识锦'}
                </button>
              )}
            </div>
            <div className="jinzhi-workspace-page__canvas-toolbar-actions">
              <div className="jinzhi-view-mode-switch" role="group" aria-label="知识锦视图模式">
                <button
                  type="button"
                  className={`jinzhi-canvas-toolbar-btn${viewMode === VIEW_MODE.TREE ? ' is-active' : ''}`}
                  onClick={() => handleSetViewMode(VIEW_MODE.TREE)}
                >
                  <Network size={14} />
                  树视图
                </button>
                <button
                  type="button"
                  className={`jinzhi-canvas-toolbar-btn${viewMode === VIEW_MODE.OUTLINE ? ' is-active' : ''}`}
                  onClick={() => handleSetViewMode(VIEW_MODE.OUTLINE)}
                >
                  <FileText size={14} />
                  大纲视图
                </button>
              </div>
              <button
                type="button"
                className="jinzhi-canvas-toolbar-btn"
                onClick={() => setTextPreviewOpen(true)}
              >
                <FileText size={14} />
                文本预览
              </button>
              <div className="jinzhi-workspace-page__canvas-toolbar-count">
                {loading ? '正在加载图谱...' : `节点 ${nodes.length}`}
              </div>
            </div>
          </div>

          {viewMode === VIEW_MODE.OUTLINE ? (
            <div className="jinzhi-outline-view" onKeyDown={handleOutlineKeyDown}>
              <section className="jinzhi-outline-view__tree-panel">
                <div className="jinzhi-outline-view__panel-header">
                  <div>
                    <div className="jinzhi-outline-view__eyebrow">Outline</div>
                    <h2>节点大纲</h2>
                  </div>
                  <div className="jinzhi-outline-view__panel-count">{nodes.length} 个节点</div>
                </div>
                <div className="jinzhi-outline-view__hint">单击切换选中 · 单击标题改名 · ↑ / ↓ 切换节点 · 拖拽右侧手柄移动或改归属 · Enter 新建兄弟</div>
                <BrocadeOutlineTreeView
                  nodes={nodes}
                  activeNodeId={selectedNodeId}
                  selectedNodeIds={outlineSelectedNodeIds}
                  onSelect={handleSelectOutlineNode}
                  onLassoSelect={handleLassoOutlineSelection}
                  editingNodeId={editingOutlineNodeId}
                  editingTitle={outlineTitleDraft}
                  onStartTitleEdit={handleStartOutlineTitleEdit}
                  onChangeTitle={setOutlineTitleDraft}
                  onCommitTitle={handleCommitOutlineTitle}
                  onCancelTitle={handleCancelOutlineTitleEdit}
                  onConfirmTitleAndCreateSibling={handleConfirmOutlineTitleAndCreateSibling}
                  onNavigate={handleSelectOutlineNode}
                  onCreateSibling={handleCreateOutlineSibling}
                  onRequestDelete={handleOpenOutlineDeleteDialog}
                  onMoveNode={handleMoveOutlineNode}
                />
              </section>
              <BrocadeOutlineContentPanel
                node={selectedNode}
                selectedCount={outlineSelectedNodeIds.size}
                childCount={selectedNode ? (childCountByNodeId.get(selectedNode._id) || 0) : 0}
                onDelete={() => handleDeleteNode(selectedNode)}
              />
            </div>
          ) : (
            <>
            <div
              ref={scrollRef}
              className={`jinzhi-graph-scroll${isPanning ? ' is-panning' : ''}`}
              onPointerDown={handleCanvasPointerDown}
              onWheel={handleGraphWheel}
              onTouchStart={handleGraphTouchStart}
              onTouchMove={handleGraphTouchMove}
              onTouchEnd={handleGraphTouchEnd}
              onTouchCancel={handleGraphTouchEnd}
            >
            <div
              className="jinzhi-graph-stage-shell"
              style={{
                width: `${shellWidth}px`,
                height: `${shellHeight}px`
              }}
            >
              <div
                className="jinzhi-graph-stage"
                style={{
                  width: `${canvasMetrics.width}px`,
                  height: `${canvasMetrics.height}px`,
                  left: `${stageOffsetX}px`,
                  top: `${stageOffsetY}px`,
                  transform: `scale(${zoom})`
                }}
              >
                <svg className="jinzhi-graph-edges" width={canvasMetrics.width} height={canvasMetrics.height}>
                  {edgeViewMode === EDGE_VIEW_MODE.STRAIGHT ? stableEdges.map((edge) => {
                    const sourcePoint = getNodeCenterPoint(edge.source, canvasMetrics.originX, canvasMetrics.originY);
                    const targetPoint = getNodeCenterPoint(edge.target, canvasMetrics.originX, canvasMetrics.originY);
                    const branchWidth = Math.max(
                      1.15,
                      Math.min(3.4, 1 + Math.log2((edge.branchWeight || 1) + 1) * 0.28 - edge.depth * 0.08)
                    );
                    const highlightWidth = Math.max(0.68, branchWidth * 0.42);
                    const pathData = `M ${sourcePoint.x} ${sourcePoint.y} L ${targetPoint.x} ${targetPoint.y}`;
                    return renderEdgeStrokeGroup(edge.id, pathData, branchWidth, highlightWidth);
                  }) : groupedEdges.flatMap((group) => {
                    const sourcePoint = getNodeCenterPoint(group.source, canvasMetrics.originX, canvasMetrics.originY);
                    if (group.edges.length < 2) {
                      const edge = group.edges[0];
                      const targetPoint = getNodeCenterPoint(edge.target, canvasMetrics.originX, canvasMetrics.originY);
                      const branchWidth = Math.max(
                        1.2,
                        Math.min(4.2, 1.05 + Math.log2((edge.trunkWeight || 1) + 1) * 0.52 - edge.depth * 0.14)
                      );
                      const highlightWidth = Math.max(0.75, branchWidth * 0.42);
                      const direction = targetPoint.x >= sourcePoint.x ? 1 : -1;
                      const gapY = Math.max(24, Math.abs(targetPoint.y - sourcePoint.y));
                      const branchStartY = sourcePoint.y + (targetPoint.y >= sourcePoint.y ? 1 : -1) * Math.max(18, Math.min(74, gapY * 0.35));
                      const branchTargetY = targetPoint.y - (targetPoint.y >= sourcePoint.y ? 1 : -1) * Math.max(18, Math.min(74, gapY * 0.35));
                      const pathData = [
                        `M ${sourcePoint.x} ${sourcePoint.y}`,
                        `C ${sourcePoint.x} ${branchStartY}, ${targetPoint.x - direction * 18} ${branchTargetY}, ${targetPoint.x} ${targetPoint.y}`
                      ].join(' ');
                      return renderEdgeStrokeGroup(edge.id, pathData, branchWidth, highlightWidth);
                    }

                    const targetCenters = group.edges.map((edge) => ({
                      edge,
                      center: getNodeCenterPoint(edge.target, canvasMetrics.originX, canvasMetrics.originY)
                    }));
                    const averageTargetX = targetCenters.reduce((sum, item) => sum + item.center.x, 0) / targetCenters.length;
                    const direction = averageTargetX >= sourcePoint.x ? 1 : -1;
                    const shortestDeltaX = Math.min(...targetCenters.map((item) => Math.abs(item.center.x - sourcePoint.x)));
                    const trunkOffset = Math.max(40, Math.min(88, shortestDeltaX * 0.24));
                    const trunkX = sourcePoint.x + direction * trunkOffset;
                    const trunkStartY = sourcePoint.y + 18;
                    const trunkTopY = Math.min(trunkStartY, ...targetCenters.map((item) => item.center.y));
                    const trunkBottomY = Math.max(trunkStartY, ...targetCenters.map((item) => item.center.y));
                    const trunkWidth = Math.max(...group.edges.map((edge) => (
                      Math.max(1.35, Math.min(4.6, 1.15 + Math.log2((edge.trunkWeight || 1) + 1) * 0.56 - edge.depth * 0.1))
                    )));
                    const trunkHighlightWidth = Math.max(0.85, trunkWidth * 0.42);
                    const trunkConnectorPath = [
                      `M ${sourcePoint.x} ${sourcePoint.y}`,
                      `C ${sourcePoint.x} ${sourcePoint.y + 16}, ${trunkX} ${sourcePoint.y + 8}, ${trunkX} ${trunkStartY}`,
                    ].join(' ');
                    const trunkVerticalPath = [
                      `M ${trunkX} ${trunkTopY}`,
                      `L ${trunkX} ${trunkBottomY}`
                    ].join(' ');

                    const branchPaths = targetCenters.map(({ edge, center }) => {
                      const branchWidth = Math.max(
                        1.1,
                        Math.min(3.8, 0.98 + Math.log2((edge.branchWeight || 1) + 1) * 0.34 - edge.depth * 0.12)
                      );
                      const highlightWidth = Math.max(0.7, branchWidth * 0.42);
                      const branchTargetOffset = Math.max(30, Math.min(86, Math.abs(center.x - trunkX) * 0.42));
                      const pathData = [
                        `M ${trunkX} ${center.y}`,
                        `C ${trunkX + direction * 18} ${center.y}, ${center.x - direction * branchTargetOffset} ${center.y}, ${center.x} ${center.y}`
                      ].join(' ');
                      return renderEdgeStrokeGroup(edge.id, pathData, branchWidth, highlightWidth);
                    });

                    return [
                      renderEdgeStrokeGroup(`${group.source?._id}-trunk-connector`, trunkConnectorPath, trunkWidth, trunkHighlightWidth),
                      renderEdgeStrokeGroup(`${group.source?._id}-trunk-vertical`, trunkVerticalPath, trunkWidth, trunkHighlightWidth),
                      ...branchPaths
                    ];
                  })}
                  {previewEdges.map((edge) => {
                    const sourcePoint = getNodeCenterPoint(edge.source, canvasMetrics.originX, canvasMetrics.originY);
                    const targetPoint = getNodeCenterPoint(edge.target, canvasMetrics.originX, canvasMetrics.originY);
                    const branchWidth = Math.max(
                      1.7,
                      Math.min(4.2, 1.35 + Math.log2((edge.trunkWeight || 1) + 1) * 0.38)
                    );
                    const highlightWidth = Math.max(0.9, branchWidth * 0.48);
                    const gapY = Math.max(24, targetPoint.y - sourcePoint.y);
                    const controlOffsetY = Math.max(18, Math.min(78, gapY * 0.42));
                    const pathData = [
                      `M ${sourcePoint.x} ${sourcePoint.y}`,
                      `C ${sourcePoint.x} ${sourcePoint.y + controlOffsetY}, ${targetPoint.x} ${targetPoint.y - controlOffsetY}, ${targetPoint.x} ${targetPoint.y}`
                    ].join(' ');
                    return renderEdgeStrokeGroup(
                      `${edge.id}-preview-parent-slot`,
                      pathData,
                      branchWidth,
                      highlightWidth,
                      { isPreview: true }
                    );
                  })}
                </svg>

                {graphNodes.map((node) => {
                  const isSelected = node?._id === selectedNode?._id;
                  const isBusy = actionId === `create:${node?._id}` || actionId === `delete:${node?._id}`;
                  const isStarPending = starPendingNodeIds.has(node?._id);
                  const isDragging = draggingNodeId === node?._id;
                  const isReparentTarget = dragReparentPreview?.parentNodeId === node?._id;
                  const nodeSize = getNodeSize(node);
                  const nodeShape = normalizeNodeShape(node?.shape);
                  const childCount = childCountByNodeId.get(node?._id) || 0;
                  const isCollapsed = collapsedNodeIds.has(node?._id);
                  const nodeTitleText = normalizeNodeTitle(node?.title, '');
                  const nodeBodyText = getNodeBodyContentText(node);
                  return (
                    <article
                      key={node?._id}
                      className={`jinzhi-node-card${isSelected ? ' is-selected' : ''}${node?.isRoot ? ' is-root' : ''}${isDragging ? ' is-dragging' : ''}${isReparentTarget ? ' is-reparent-target' : ''} shape-${nodeShape}`}
                      style={{
                        left: `${canvasMetrics.originX + (Number(node?.position?.x) || 0)}px`,
                        top: `${canvasMetrics.originY + (Number(node?.position?.y) || 0)}px`,
                        width: `${nodeSize.width}px`,
                        height: `${nodeSize.height}px`
                      }}
                      onClick={(event) => {
                        if (Date.now() < suppressInspectorOpenUntilRef.current) return;
                        setOutlineSelectedNodeIds(new Set());
                        openNodeInspector(node?._id || '', event);
                        if (node?._id && node?._id !== selectedNodeId) {
                          centerNodeInViewport(scrollRef, node, canvasMetrics, zoomRef.current);
                          lastAutoCenteredNodeIdRef.current = node?._id;
                        }
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openNodeEditor(node?._id || '');
                      }}
                    >
                      <div
                        className="jinzhi-node-card__drag"
                        onPointerDown={(event) => startNodeDrag(event, node)}
                      >
                        {nodeTitleText ? (
                          <div
                            className="jinzhi-node-card__title"
                            style={{
                              fontSize: `${Math.min(1.52, textCounterScale * 1.1)}rem`,
                              lineHeight: 1.18
                            }}
                          >
                            {nodeTitleText}
                          </div>
                        ) : null}
                        {nodeBodyText.trim() ? (
                          <div
                            className="jinzhi-node-card__preview"
                            style={{
                              fontSize: `${0.84 * previewCounterScale}rem`
                            }}
                          >
                            {nodeBodyText}
                          </div>
                        ) : null}
                      </div>
                      <div className="jinzhi-node-card__actions">
                        {/* 底部工具栏 - hover 时显示 */}
                        <div className="jinzhi-node-card__toolbar">
                          <button
                            type="button"
                            className={`jinzhi-node-card__tool-btn${node?.isStarred ? ' is-starred' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleNodeStar(node, !node?.isStarred);
                            }}
                            title={node?.isStarred ? '取消星标' : '星标'}
                            aria-label={node?.isStarred ? '取消星标' : '星标'}
                            disabled={isStarPending}
                          >
                            <Star size={13} fill={node?.isStarred ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            type="button"
                            className="jinzhi-node-card__tool-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCreateChild(node);
                            }}
                            title="添加子节点"
                            disabled={isBusy}
                          >
                            <Plus size={13} />
                          </button>
                          {!node?.isRoot ? (
                            <button
                              type="button"
                              className="jinzhi-node-card__tool-btn is-delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteNode(node);
                              }}
                              title="删除"
                              disabled={isBusy}
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : null}
                        </div>
                        {/* 收起/展开按钮 - 始终显示在右侧 */}
                        {childCount > 0 ? (
                          <button
                            type="button"
                            className="jinzhi-node-card__mini-btn jinzhi-node-card__mini-btn--collapse"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleNodeCollapse(node?._id);
                            }}
                            title={isCollapsed ? `展开 ${childCount} 个子节点` : `收起 ${childCount} 个子节点`}
                            aria-label={isCollapsed ? '展开子节点' : '收起子节点'}
                            aria-expanded={isCollapsed ? 'false' : 'true'}
                          >
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                        ) : null}
                      </div>
                      {NODE_RESIZE_DIRECTIONS.map((direction) => (
                        <button
                          type="button"
                          key={`${node?._id || 'node'}-${direction}`}
                          className={`jinzhi-node-card__resize-zone jinzhi-node-card__resize-zone--${direction}${isSelected ? '' : ' is-move-zone'}`}
                          tabIndex={-1}
                          aria-label={isSelected ? '拖拽调整卡片大小' : '拖拽移动卡片'}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => startNodeResize(event, node, nodeSize, direction)}
                        />
                      ))}
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
          <KnowledgeBrocadeMiniMap
            nodes={graphNodes}
            edges={edges}
            canvasMetrics={canvasMetrics}
            zoom={zoom}
            scrollLeft={scrollLeft}
            scrollTop={scrollTop}
            viewportWidth={viewportSize.width}
            viewportHeight={viewportSize.height}
            visible={showMiniMap}
            onToggleVisibility={() => setShowMiniMap(false)}
            scrollContainerRef={scrollRef}
          />
          {selectedNode && inspectorStyle ? (
            <div className="jinzhi-floating-inspector" style={inspectorStyle || undefined}>
              <div className="jinzhi-floating-inspector__header">
                <div>
                  <div className="jinzhi-inspector__eyebrow">Node Inspector</div>
                  <h2>{normalizeNodeTitle(selectedNode?.title, '')}</h2>
                </div>
                <button
                  type="button"
                  className="jinzhi-floating-inspector__close"
                  onClick={closeNodeInspector}
                  aria-label="关闭节点详情"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="jinzhi-inspector__meta">
                <span>{selectedNode?.isRoot ? '根节点' : '普通节点'}</span>
                <span>{selectedNode?.updatedAt ? new Date(selectedNode.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未保存'}</span>
              </div>
              <div className="jinzhi-inspector__actions">
                <button
                  type="button"
                  className={`btn btn-small jinzhi-inspector__action-btn ${selectedNode?.isStarred ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => handleToggleNodeStar(selectedNode, !selectedNode?.isStarred)}
                  disabled={starPendingNodeIds.has(selectedNode?._id)}
                >
                  <Star size={15} fill={selectedNode?.isStarred ? 'currentColor' : 'none'} />
                  {selectedNode?.isStarred ? '取消星标' : '设为星标'}
                </button>
                <button type="button" className="btn btn-small btn-primary jinzhi-inspector__action-btn" onClick={handleOpenEditor}>
                  <Edit3 size={15} />
                  编辑内容
                </button>
                {!selectedNode?.isRoot ? (
                  <button type="button" className="btn btn-small btn-danger jinzhi-inspector__action-btn" onClick={() => handleDeleteNode(selectedNode)}>
                    <Trash2 size={15} />
                    删除节点
                  </button>
                ) : null}
              </div>
              <div className="jinzhi-inspector__tip">移动节点时直接拖拽卡片即可。创建的节点和已有节点都支持单独星标。</div>
              <div className="jinzhi-inspector__content">
                {getNodeBodyContentText(selectedNode) || null}
              </div>
            </div>
          ) : null}
          </>
          )}
        </section>
      </div>

      <NodeEditorModal
        open={editorOpen}
        node={selectedNode}
        saving={savingContent}
        onAutoSave={handleAutoSaveContent}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveContent}
      />
      <NodeCreateModal
        open={Boolean(createParentNode)}
        parentNode={createParentNode}
        saving={Boolean(createParentNode?._id) && actionId === `create:${createParentNode._id}`}
        onClose={() => setCreateParentNode(null)}
        onSubmit={submitCreateChild}
      />
      <BrocadeOutlineDeleteConfirmModal
        open={Boolean(outlineDeleteDialog)}
        nodes={outlineDeleteDialogNodes}
        saving={actionId === 'delete:outline'}
        onClose={() => setOutlineDeleteDialog(null)}
        onConfirm={handleConfirmOutlineDelete}
      />
      <BrocadeTextPreviewModal
        open={textPreviewOpen}
        brocadeName={brocade?.name || initialBrocadeName || '知识锦文本预览'}
        nodes={nodes}
        onClose={() => setTextPreviewOpen(false)}
      />
      <KnowledgeBrocadeSearchModal
        open={searchOpen}
        nodes={nodes}
        onJump={handleJumpToNode}
        onClose={() => setSearchOpen(false)}
      />
      <KnowledgeBrocadeShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
};

export default KnowledgeBrocadeWorkspacePage;
