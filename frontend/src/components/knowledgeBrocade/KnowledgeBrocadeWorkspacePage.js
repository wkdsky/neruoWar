import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Edit3, Moon, Network, Plus, RotateCcw, RotateCw, Star, Sun, Trash2, X } from 'lucide-react';
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

const WORKSPACE_PADDING = 96;
const WORKSPACE_PADDING_MIN = 56;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 122;
const DEFAULT_SYSTEM_NODE_TITLE = '新建知识点';
const ZOOM_MAX = 1.22;
const ZOOM_DEFAULT = 1;
const DRAG_AUTOPAN_THRESHOLD = 84;
const DRAG_AUTOPAN_SPEED = 14;
const HISTORY_LIMIT = 60;
const CREATE_NODE_BASE_OFFSET_X = NODE_WIDTH + 54;
const CREATE_NODE_BASE_OFFSET_Y = Math.round(NODE_HEIGHT * 0.35);
const CREATE_NODE_STEP_X = Math.ceil(NODE_WIDTH * 0.62);
const CREATE_NODE_STEP_Y = Math.ceil(NODE_HEIGHT * 0.72);
const CREATE_NODE_MAX_OVERLAP_AREA = NODE_WIDTH * NODE_HEIGHT * 0.5;
const THEME_STORAGE_KEY = 'knowledge-brocade-theme';
const EDGE_VIEW_MODE = {
  MERGED: 'merged',
  STRAIGHT: 'straight'
};
const CANVAS_THEME = {
  DAY: 'day',
  NIGHT: 'night'
};

const normalizeNodeTitle = (value, fallback = DEFAULT_SYSTEM_NODE_TITLE) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return (trimmed || fallback).slice(0, 80);
};

const resolveUniqueSiblingNodeTitle = (existingTitles = [], baseTitle = DEFAULT_SYSTEM_NODE_TITLE) => {
  const normalizedBaseTitle = normalizeNodeTitle(baseTitle, DEFAULT_SYSTEM_NODE_TITLE);
  const usedTitles = new Set(
    (Array.isArray(existingTitles) ? existingTitles : [])
      .map((item) => normalizeNodeTitle(item, ''))
      .filter(Boolean)
  );
  if (!usedTitles.has(normalizedBaseTitle)) {
    return normalizedBaseTitle;
  }
  let duplicateIndex = 2;
  while (usedTitles.has(`${normalizedBaseTitle} (${duplicateIndex})`)) {
    duplicateIndex += 1;
  }
  return `${normalizedBaseTitle} (${duplicateIndex})`;
};

const buildCreateDraftContent = (contentText, fallbackTitle = DEFAULT_SYSTEM_NODE_TITLE) => {
  const normalized = String(contentText || '').replace(/\r/g, '');
  const trimmed = normalized.trim();
  if (!trimmed) {
    return `${normalizeNodeTitle(fallbackTitle, DEFAULT_SYSTEM_NODE_TITLE)}\n\n`;
  }
  const firstLine = normalized.split('\n')[0]?.trim() || '';
  if (firstLine) {
    return normalized;
  }
  return `${normalizeNodeTitle(fallbackTitle, DEFAULT_SYSTEM_NODE_TITLE)}\n\n${trimmed}`;
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

const getNodeCenterPoint = (node, originX, originY) => ({
  x: originX + (Number(node?.position?.x) || 0) + NODE_WIDTH / 2,
  y: originY + (Number(node?.position?.y) || 0) + NODE_HEIGHT / 2
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
  title: node?.title || '未命名节点',
  previewText: node?.previewText || '',
  contentText: node?.contentText || '',
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
  const candidateLeft = Number(candidatePosition?.x) || 0;
  const candidateTop = Number(candidatePosition?.y) || 0;
  const candidateRight = candidateLeft + NODE_WIDTH;
  const candidateBottom = candidateTop + NODE_HEIGHT;
  const nodeLeft = Number(node?.position?.x) || 0;
  const nodeTop = Number(node?.position?.y) || 0;
  const nodeRight = nodeLeft + NODE_WIDTH;
  const nodeBottom = nodeTop + NODE_HEIGHT;
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

const renderEdgeStrokeGroup = (key, pathData, branchWidth, highlightWidth) => (
  <g key={key}>
    <path
      d={pathData}
      className="jinzhi-graph-edge jinzhi-graph-edge--shadow"
      style={{ strokeWidth: branchWidth + 1.2 }}
    />
    <path
      d={pathData}
      className="jinzhi-graph-edge jinzhi-graph-edge--wood"
      style={{ strokeWidth: branchWidth }}
    />
    <path
      d={pathData}
      className="jinzhi-graph-edge jinzhi-graph-edge--highlight"
      style={{ strokeWidth: highlightWidth }}
    />
  </g>
);

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

const BrocadeOutlineBranch = ({
  branch,
  activeNodeId = '',
  expandedIds,
  onToggle,
  onJump
}) => {
  const currentNode = branch?.node || null;
  const hasChildren = Array.isArray(branch?.children) && branch.children.length > 0;
  const isExpanded = hasChildren ? expandedIds.has(currentNode?._id) : false;
  if (!currentNode?._id) return null;
  return (
    <div className="jinzhi-outline-tree__branch">
      <div className="jinzhi-outline-tree__row" style={{ '--jinzhi-outline-depth': branch.depth || 0 }}>
        {hasChildren ? (
          <button
            type="button"
            className="jinzhi-outline-tree__toggle"
            aria-label={isExpanded ? '收起下级节点' : '展开下级节点'}
            aria-expanded={isExpanded}
            onClick={() => onToggle(currentNode._id)}
          >
            {isExpanded ? '−' : '+'}
          </button>
        ) : (
          <span className="jinzhi-outline-tree__toggle-placeholder" aria-hidden="true" />
        )}
        <button
          type="button"
          className={`jinzhi-outline-tree__item${currentNode._id === activeNodeId ? ' is-active' : ''}${currentNode?.isRoot ? ' is-root' : ''}`}
          onClick={() => onJump(currentNode._id)}
        >
          <span className="jinzhi-outline-tree__title">{currentNode?.title || '未命名节点'}</span>
          {currentNode?.isStarred ? <span className="jinzhi-outline-tree__tag">星标</span> : null}
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <div
          className="jinzhi-outline-tree__children"
          style={{ '--jinzhi-outline-depth': (branch.depth || 0) + 1 }}
        >
          {branch.children.map((childBranch) => (
            <BrocadeOutlineBranch
              key={childBranch?.node?._id || `${currentNode._id}-child`}
              branch={childBranch}
              activeNodeId={activeNodeId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onJump={onJump}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const BrocadeOutlineModal = ({
  open = false,
  brocadeName = '',
  nodes = [],
  activeNodeId = '',
  onClose,
  onJump
}) => {
  const outlineTree = useMemo(() => buildBrocadeOutlineTree(nodes), [nodes]);
  const [expandedIds, setExpandedIds] = useState([]);
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);

  useEffect(() => {
    if (!open) return;
    setExpandedIds(collectBrocadeOutlineExpandableIds(outlineTree));
  }, [open, outlineTree]);

  const handleToggle = useCallback((nodeId) => {
    if (!nodeId) return;
    setExpandedIds((prev) => (
      prev.includes(nodeId)
        ? prev.filter((item) => item !== nodeId)
        : [...prev, nodeId]
    ));
  }, []);

  if (!open) return null;

  return (
    <div className="jinzhi-outline-modal-backdrop" onClick={onClose}>
      <div className="jinzhi-outline-modal" onClick={(event) => event.stopPropagation()}>
        <div className="jinzhi-outline-modal__header">
          <div>
            <div className="jinzhi-outline-modal__eyebrow">Brocade Outline</div>
            <h3>{brocadeName || '知识锦大纲'}</h3>
          </div>
          <button type="button" className="jinzhi-outline-modal__close" onClick={onClose} aria-label="关闭大纲视图">
            <X size={16} />
          </button>
        </div>
        <div className="jinzhi-outline-modal__meta">节点 {nodes.length}</div>
        <div className="jinzhi-outline-modal__body">
          {outlineTree.length > 0 ? (
            <div className="jinzhi-outline-tree">
              {outlineTree.map((branch) => (
                <BrocadeOutlineBranch
                  key={branch?.node?._id || 'outline-root'}
                  branch={branch}
                  activeNodeId={activeNodeId}
                  expandedIds={expandedIdSet}
                  onToggle={handleToggle}
                  onJump={onJump}
                />
              ))}
            </div>
          ) : (
            <div className="jinzhi-outline-modal__empty">当前知识锦还没有可展示的节点。</div>
          )}
        </div>
      </div>
    </div>
  );
};

const computeCanvasMetrics = (nodes = []) => {
  const bounds = nodes.reduce((acc, node) => {
    const x = Number(node?.position?.x) || 0;
    const y = Number(node?.position?.y) || 0;
    return {
      minX: Math.min(acc.minX, x),
      minY: Math.min(acc.minY, y),
      maxX: Math.max(acc.maxX, x + NODE_WIDTH),
      maxY: Math.max(acc.maxY, y + NODE_HEIGHT)
    };
  }, {
    minX: 0,
    minY: 0,
    maxX: NODE_WIDTH,
    maxY: NODE_HEIGHT
  });

  const contentWidth = Math.max(NODE_WIDTH, Math.ceil(bounds.maxX - bounds.minX));
  const contentHeight = Math.max(NODE_HEIGHT, Math.ceil(bounds.maxY - bounds.minY));
  const paddingX = Math.max(WORKSPACE_PADDING_MIN, Math.min(WORKSPACE_PADDING, Math.round(contentWidth * 0.12)));
  const paddingY = Math.max(WORKSPACE_PADDING_MIN, Math.min(WORKSPACE_PADDING, Math.round(contentHeight * 0.14)));
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
  const targetLeft = (metrics.originX + (Number(node?.position?.x) || 0) + NODE_WIDTH / 2) * zoom - scrollRef.current.clientWidth / 2;
  const targetTop = (metrics.originY + (Number(node?.position?.y) || 0) + NODE_HEIGHT / 2) * zoom - scrollRef.current.clientHeight / 2;
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
  onClose,
  onSave
}) => {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(node?.contentText || '');
  }, [node, open]);

  if (!open || !node) return null;

  return (
    <div className="jinzhi-editor-modal-backdrop" onClick={onClose}>
      <div className="jinzhi-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="jinzhi-editor-modal__header">
          <div>
            <div className="jinzhi-editor-modal__eyebrow">Node Editor</div>
            <h3>{node?.title || '未命名节点'}</h3>
          </div>
          <button type="button" className="btn btn-small btn-secondary" onClick={onClose}>关闭</button>
        </div>
        <div className="jinzhi-editor-modal__hint">第一行仍可作为标题使用；如果内容留空，会保留当前节点名称。</div>
        <textarea
          value={draft}
          maxLength={200000}
          className="jinzhi-editor-modal__textarea"
          placeholder={'在这里编辑节点内容。\n\n建议第一行写标题。'}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="jinzhi-editor-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(draft)} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

const NodeCreateModal = ({
  open,
  parentNode,
  nodes = [],
  saving = false,
  onClose,
  onSubmit
}) => {
  const [contentText, setContentText] = useState('');
  const [isStarred, setIsStarred] = useState(false);

  const siblingTitles = useMemo(() => (
    nodes
      .filter((item) => item?.parentNodeId === parentNode?._id)
      .map((item) => item?.title || '')
  ), [nodes, parentNode?._id]);
  const suggestedSystemTitle = useMemo(
    () => resolveUniqueSiblingNodeTitle(siblingTitles, DEFAULT_SYSTEM_NODE_TITLE),
    [siblingTitles]
  );

  useEffect(() => {
    if (!open) return;
    setContentText(`${suggestedSystemTitle}\n\n`);
    setIsStarred(false);
  }, [open, suggestedSystemTitle]);

  if (!open || !parentNode) return null;

  const effectiveContentText = buildCreateDraftContent(contentText, suggestedSystemTitle);

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
          <div className="jinzhi-create-modal__hint">第一行就是节点名称，默认已按同级节点自动去重；下面直接填写正文内容即可。</div>
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
            placeholder={`${suggestedSystemTitle}\n\n在这里继续填写这个知识点的内容。`}
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
  const panRef = useRef(null);
  const pinchRef = useRef(null);
  const zoomFrameRef = useRef(0);
  const lastAutoCenteredNodeIdRef = useRef('');
  const zoomRef = useRef(ZOOM_DEFAULT);
  const suppressInspectorOpenUntilRef = useRef(0);
  const brocadeTitleEditorRef = useRef(null);
  const brocadeTitleCommitRef = useRef(false);
  const starRequestVersionRef = useRef(new Map());
  const [brocade, setBrocade] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [actionId, setActionId] = useState('');
  const [starPendingNodeIds, setStarPendingNodeIds] = useState(() => new Set());
  const [historyState, setHistoryState] = useState(() => ({ undoStack: [], redoStack: [] }));
  const [historyActionId, setHistoryActionId] = useState('');
  const [edgeViewMode, setEdgeViewMode] = useState(EDGE_VIEW_MODE.MERGED);
  const [canvasTheme, setCanvasTheme] = useState(() => {
    if (typeof window === 'undefined') return CANVAS_THEME.NIGHT;
    const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedValue === CANVAS_THEME.DAY ? CANVAS_THEME.DAY : CANVAS_THEME.NIGHT;
  });
  const [isPanning, setIsPanning] = useState(false);
  const [createParentNode, setCreateParentNode] = useState(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [inspectorAnchor, setInspectorAnchor] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isEditingBrocadeTitle, setIsEditingBrocadeTitle] = useState(false);
  const [brocadeTitleDraft, setBrocadeTitleDraft] = useState('');
  const [savingBrocadeTitle, setSavingBrocadeTitle] = useState(false);

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
  const canvasMetrics = useMemo(() => computeCanvasMetrics(nodes), [nodes]);
  const nodesById = useMemo(() => new Map(nodes.map((item) => [item?._id, item])), [nodes]);
  const treeMetrics = useMemo(() => buildTreeMetrics(nodes), [nodes]);
  const edges = useMemo(() => (
    nodes
      .filter((item) => item?.parentNodeId && nodesById.has(item.parentNodeId))
      .map((item) => ({
        id: `${item.parentNodeId}->${item._id}`,
        source: nodesById.get(item.parentNodeId),
        target: item,
        depth: treeMetrics.depthMap.get(item?._id) || 1,
        branchWeight: treeMetrics.subtreeSizeMap.get(item?._id) || 1,
        trunkWeight: treeMetrics.subtreeSizeMap.get(item?.parentNodeId) || 1
      }))
  ), [nodes, nodesById, treeMetrics.depthMap, treeMetrics.subtreeSizeMap]);
  const groupedEdges = useMemo(() => {
    const groups = new Map();
    edges.forEach((edge) => {
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
  }, [edges]);
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

  const applyNodePositionLocally = useCallback((nodeId, position) => {
    if (!nodeId) return;
    const nextPosition = cloneNodePosition(position);
    setNodes((prev) => prev.map((item) => (
      item?._id === nodeId
        ? { ...item, position: nextPosition }
        : item
    )));
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
  const previewLineClamp = zoom < 0.82 ? 2 : 3;
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
          const autoPanX = localX < DRAG_AUTOPAN_THRESHOLD
            ? -getDragAutopanDelta(DRAG_AUTOPAN_THRESHOLD - localX)
            : (localX > rect.width - DRAG_AUTOPAN_THRESHOLD
                ? getDragAutopanDelta(localX - (rect.width - DRAG_AUTOPAN_THRESHOLD))
                : 0);
          const autoPanY = localY < DRAG_AUTOPAN_THRESHOLD
            ? -getDragAutopanDelta(DRAG_AUTOPAN_THRESHOLD - localY)
            : (localY > rect.height - DRAG_AUTOPAN_THRESHOLD
                ? getDragAutopanDelta(localY - (rect.height - DRAG_AUTOPAN_THRESHOLD))
                : 0);
          const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
          const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
          nextScrollLeft = Math.min(maxLeft, Math.max(0, container.scrollLeft + autoPanX));
          nextScrollTop = Math.min(maxTop, Math.max(0, container.scrollTop + autoPanY));
          container.scrollLeft = nextScrollLeft;
          container.scrollTop = nextScrollTop;
        }
        dragCurrent.lastScrollLeft = nextScrollLeft;
        dragCurrent.lastScrollTop = nextScrollTop;
        const dx = event.clientX - dragCurrent.startX + (nextScrollLeft - dragCurrent.originScrollLeft);
        const dy = event.clientY - dragCurrent.startY + (nextScrollTop - dragCurrent.originScrollTop);
        const zoomScale = zoomRef.current || ZOOM_DEFAULT;
        const visibleContentLeft = Math.max(0, (nextScrollLeft - stageOffsetX) / zoomScale);
        const visibleContentTop = Math.max(0, (nextScrollTop - stageOffsetY) / zoomScale);
        const visibleContentRight = Math.min(
          canvasMetrics.width,
          (nextScrollLeft + (container?.clientWidth || viewportSize.width) - stageOffsetX) / zoomScale
        );
        const visibleContentBottom = Math.min(
          canvasMetrics.height,
          (nextScrollTop + (container?.clientHeight || viewportSize.height) - stageOffsetY) / zoomScale
        );
        const minNodeX = visibleContentLeft - canvasMetrics.originX;
        const maxNodeX = visibleContentRight - canvasMetrics.originX - NODE_WIDTH;
        const minNodeY = visibleContentTop - canvasMetrics.originY;
        const maxNodeY = visibleContentBottom - canvasMetrics.originY - NODE_HEIGHT;
        setNodes((prev) => prev.map((item) => (
          item?._id === dragCurrent.nodeId
            ? {
              ...item,
              position: {
                x: Math.round(
                  Math.min(
                    Math.max(minNodeX, dragCurrent.originX + dx / zoomScale),
                    Math.max(minNodeX, maxNodeX)
                  )
                ),
                y: Math.round(
                  Math.min(
                    Math.max(minNodeY, dragCurrent.originY + dy / zoomScale),
                    Math.max(minNodeY, maxNodeY)
                  )
                )
              }
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
      if (!dragCurrent) return;
      if (dragCurrent.target?.hasPointerCapture?.(dragCurrent.pointerId)) {
        dragCurrent.target.releasePointerCapture(dragCurrent.pointerId);
      }
      dragRef.current = null;
      const movedNode = nodesById.get(dragCurrent.nodeId);
      if (!movedNode) return;
      const previousPosition = cloneNodePosition({
        x: dragCurrent.originX,
        y: dragCurrent.originY
      });
      const nextPosition = cloneNodePosition(movedNode.position);
      if (arePositionsEqual(previousPosition, nextPosition)) return;
      suppressInspectorOpenUntilRef.current = Date.now() + 240;
      try {
        await updateKnowledgeBrocadeNode(activeBrocadeId, dragCurrent.nodeId, {
          position: nextPosition
        });
        pushHistoryEntry({
          kind: 'move',
          nodeId: dragCurrent.nodeId,
          beforePosition: previousPosition,
          afterPosition: nextPosition
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
    canvasMetrics.height,
    canvasMetrics.originX,
    canvasMetrics.originY,
    canvasMetrics.width,
    loadGraph,
    nodesById,
    pushHistoryEntry,
    stageOffsetX,
    stageOffsetY,
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

  const handleOpenEditor = useCallback(() => {
    if (!selectedNode) return;
    setEditorOpen(true);
  }, [selectedNode]);

  const handleSaveContent = async (contentText) => {
    if (!selectedNode?._id) return;
    setSavingContent(true);
    setErrorText('');
    try {
      const data = await updateKnowledgeBrocadeNodeContent(activeBrocadeId, selectedNode._id, { contentText });
      const nextNode = data?.node || null;
      if (nextNode?._id) {
        setNodes((prev) => prev.map((item) => (item?._id === nextNode._id ? nextNode : item)));
      }
      setEditorOpen(false);
    } catch (error) {
      setErrorText(error.message || '保存节点内容失败');
    } finally {
      setSavingContent(false);
    }
  };

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
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        setBrocadeTitleDraft(nextBrocade.name || resolvedName);
        onBrocadeMetaChange?.(nextBrocade);
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

  const handleJumpToOutlineNode = useCallback((nodeId) => {
    const targetNode = nodesById.get(nodeId);
    if (!targetNode) return;
    setOutlineOpen(false);
    setInspectorAnchor(null);
    setSelectedNodeId(nodeId);
    centerNodeInViewport(scrollRef, targetNode, canvasMetrics, zoomRef.current);
    lastAutoCenteredNodeIdRef.current = nodeId;
  }, [canvasMetrics, nodesById]);

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

  const handleDeleteNode = async (node) => {
    if (!node?._id || node?.isRoot) return;
    const confirmed = window.confirm(`确认删除节点「${node.title || '未命名节点'}」？这会一并删除它的全部子节点。`);
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
  };

  const handleUndo = useCallback(async () => {
    const entry = historyState.undoStack[historyState.undoStack.length - 1];
    if (!entry || historyActionId) return;
    setHistoryActionId(`undo:${entry.kind}`);
    setErrorText('');
    try {
      if (entry.kind === 'move') {
        applyNodePositionLocally(entry.nodeId, entry.beforePosition);
        await updateKnowledgeBrocadeNode(activeBrocadeId, entry.nodeId, {
          position: cloneNodePosition(entry.beforePosition)
        });
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
        setSelectedNodeId(entry.rootNodeId || '');
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
  }, [activeBrocadeId, applyNodePositionLocally, historyActionId, historyState.undoStack, loadGraph, onBrocadeMetaChange, restoreNodeSnapshots]);

  const handleRedo = useCallback(async () => {
    const entry = historyState.redoStack[historyState.redoStack.length - 1];
    if (!entry || historyActionId) return;
    setHistoryActionId(`redo:${entry.kind}`);
    setErrorText('');
    try {
      if (entry.kind === 'move') {
        applyNodePositionLocally(entry.nodeId, entry.afterPosition);
        await updateKnowledgeBrocadeNode(activeBrocadeId, entry.nodeId, {
          position: cloneNodePosition(entry.afterPosition)
        });
      } else if (entry.kind === 'create') {
        await restoreNodeSnapshots([entry.nodeSnapshot]);
        setSelectedNodeId(entry.nodeSnapshot._id || '');
      } else if (entry.kind === 'delete') {
        const data = await deleteKnowledgeBrocadeNode(activeBrocadeId, entry.rootNodeId);
        const deletedIdSet = new Set(entry.deletedSnapshots.map((item) => item?._id).filter(Boolean));
        setNodes((prev) => prev.filter((item) => !deletedIdSet.has(item?._id)));
        setSelectedNodeId((prev) => (prev && !deletedIdSet.has(prev) ? prev : ''));
        if (data?.brocade?._id) {
          setBrocade(data.brocade);
          onBrocadeMetaChange?.(data.brocade);
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
  }, [activeBrocadeId, applyNodePositionLocally, historyActionId, historyState.redoStack, loadGraph, onBrocadeMetaChange, restoreNodeSnapshots]);

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
              <button
                type="button"
                className="jinzhi-canvas-toolbar-btn"
                onClick={() => setOutlineOpen(true)}
              >
                <Network size={14} />
                大纲视图
              </button>
              <div className="jinzhi-workspace-page__canvas-toolbar-count">
                {loading ? '正在加载图谱...' : `节点 ${nodes.length}`}
              </div>
            </div>
          </div>

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
                  {edgeViewMode === EDGE_VIEW_MODE.STRAIGHT ? edges.map((edge) => {
                    const sourceCenter = getNodeCenterPoint(edge.source, canvasMetrics.originX, canvasMetrics.originY);
                    const targetCenter = getNodeCenterPoint(edge.target, canvasMetrics.originX, canvasMetrics.originY);
                    const branchWidth = Math.max(
                      1.15,
                      Math.min(3.4, 1 + Math.log2((edge.branchWeight || 1) + 1) * 0.28 - edge.depth * 0.08)
                    );
                    const highlightWidth = Math.max(0.68, branchWidth * 0.42);
                    const pathData = `M ${sourceCenter.x} ${sourceCenter.y} L ${targetCenter.x} ${targetCenter.y}`;
                    return renderEdgeStrokeGroup(edge.id, pathData, branchWidth, highlightWidth);
                  }) : groupedEdges.flatMap((group) => {
                    const sourceCenter = getNodeCenterPoint(group.source, canvasMetrics.originX, canvasMetrics.originY);
                    if (group.edges.length < 2) {
                      const edge = group.edges[0];
                      const targetCenter = getNodeCenterPoint(edge.target, canvasMetrics.originX, canvasMetrics.originY);
                      const branchWidth = Math.max(
                        1.2,
                        Math.min(4.2, 1.05 + Math.log2((edge.trunkWeight || 1) + 1) * 0.52 - edge.depth * 0.14)
                      );
                      const highlightWidth = Math.max(0.75, branchWidth * 0.42);
                      const direction = targetCenter.x >= sourceCenter.x ? 1 : -1;
                      const branchStartX = sourceCenter.x + direction * Math.max(28, Math.min(72, Math.abs(targetCenter.x - sourceCenter.x) * 0.2));
                      const branchMidX = sourceCenter.x + direction * Math.max(52, Math.min(132, Math.abs(targetCenter.x - sourceCenter.x) * 0.46));
                      const branchLift = Math.max(22, Math.min(58, Math.abs(targetCenter.y - sourceCenter.y) * 0.28));
                      const pathData = [
                        `M ${sourceCenter.x} ${sourceCenter.y}`,
                        `C ${branchStartX} ${sourceCenter.y}, ${branchMidX - (14 * direction)} ${sourceCenter.y}, ${branchMidX} ${sourceCenter.y}`,
                        `S ${branchMidX + (14 * direction)} ${targetCenter.y + (targetCenter.y >= sourceCenter.y ? -branchLift : branchLift)}, ${targetCenter.x} ${targetCenter.y}`
                      ].join(' ');
                      return renderEdgeStrokeGroup(edge.id, pathData, branchWidth, highlightWidth);
                    }

                    const targetCenters = group.edges.map((edge) => ({
                      edge,
                      center: getNodeCenterPoint(edge.target, canvasMetrics.originX, canvasMetrics.originY)
                    }));
                    const averageTargetX = targetCenters.reduce((sum, item) => sum + item.center.x, 0) / targetCenters.length;
                    const direction = averageTargetX >= sourceCenter.x ? 1 : -1;
                    const shortestDeltaX = Math.min(...targetCenters.map((item) => Math.abs(item.center.x - sourceCenter.x)));
                    const trunkOffset = Math.max(40, Math.min(88, shortestDeltaX * 0.24));
                    const trunkX = sourceCenter.x + direction * trunkOffset;
                    const trunkTopY = Math.min(sourceCenter.y, ...targetCenters.map((item) => item.center.y));
                    const trunkBottomY = Math.max(sourceCenter.y, ...targetCenters.map((item) => item.center.y));
                    const trunkWidth = Math.max(...group.edges.map((edge) => (
                      Math.max(1.35, Math.min(4.6, 1.15 + Math.log2((edge.trunkWeight || 1) + 1) * 0.56 - edge.depth * 0.1))
                    )));
                    const trunkHighlightWidth = Math.max(0.85, trunkWidth * 0.42);
                    const trunkConnectorPath = [
                      `M ${sourceCenter.x} ${sourceCenter.y}`,
                      `C ${sourceCenter.x + direction * Math.max(18, trunkOffset * 0.42)} ${sourceCenter.y}, ${trunkX} ${sourceCenter.y}, ${trunkX} ${sourceCenter.y}`,
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
                </svg>

                {nodes.map((node) => {
                  const isSelected = node?._id === selectedNode?._id;
                  const isBusy = actionId === `create:${node?._id}` || actionId === `delete:${node?._id}`;
                  const isStarPending = starPendingNodeIds.has(node?._id);
                  return (
                    <article
                      key={node?._id}
                      className={`jinzhi-node-card${isSelected ? ' is-selected' : ''}${node?.isRoot ? ' is-root' : ''}`}
                      style={{
                        left: `${canvasMetrics.originX + (Number(node?.position?.x) || 0)}px`,
                        top: `${canvasMetrics.originY + (Number(node?.position?.y) || 0)}px`,
                        width: `${NODE_WIDTH}px`,
                        minHeight: `${NODE_HEIGHT}px`
                      }}
                      onClick={(event) => openNodeInspector(node?._id || '', event)}
                      onDoubleClick={(event) => {
                        openNodeInspector(node?._id || '', event);
                        setEditorOpen(true);
                      }}
                    >
                      <div
                        className="jinzhi-node-card__drag"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.stopPropagation();
                          if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
                            const selection = window.getSelection();
                            if (selection && selection.rangeCount > 0) {
                              selection.removeAllRanges();
                            }
                          }
                          dragRef.current = {
                            nodeId: node?._id,
                            startX: event.clientX,
                            startY: event.clientY,
                            originX: Number(node?.position?.x) || 0,
                            originY: Number(node?.position?.y) || 0,
                            originScrollLeft: scrollRef.current?.scrollLeft || 0,
                            originScrollTop: scrollRef.current?.scrollTop || 0,
                            lastScrollLeft: scrollRef.current?.scrollLeft || 0,
                            lastScrollTop: scrollRef.current?.scrollTop || 0,
                            pointerId: event.pointerId,
                            target: event.currentTarget
                          };
                          event.currentTarget.setPointerCapture?.(event.pointerId);
                        }}
                      >
                        <div
                          className="jinzhi-node-card__title"
                          style={{
                            fontSize: `${Math.min(1.52, textCounterScale * 1.1)}rem`,
                            lineHeight: 1.18
                          }}
                        >
                          {node?.title || '未命名节点'}
                        </div>
                        <div
                          className="jinzhi-node-card__preview"
                          style={{
                            fontSize: `${0.84 * previewCounterScale}rem`,
                            WebkitLineClamp: previewLineClamp
                          }}
                        >
                          {node?.previewText || '点击编辑，写下你的知识内容。'}
                        </div>
                      </div>
                      <div className="jinzhi-node-card__actions">
                        <button
                          type="button"
                          className={`jinzhi-node-card__mini-btn jinzhi-node-card__mini-btn--star${node?.isStarred ? ' is-starred' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleToggleNodeStar(node, !node?.isStarred);
                          }}
                          title={node?.isStarred ? '取消星标' : '星标节点'}
                          aria-label={node?.isStarred ? '取消星标' : '设为星标'}
                          aria-pressed={node?.isStarred ? 'true' : 'false'}
                          disabled={isStarPending}
                        >
                          <Star size={14} fill={node?.isStarred ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          className="jinzhi-node-card__mini-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCreateChild(node);
                          }}
                          title="创建子节点"
                          disabled={isBusy}
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          type="button"
                          className="jinzhi-node-card__mini-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            openNodeInspector(node?._id || '', event);
                            setEditorOpen(true);
                          }}
                          title="编辑节点"
                        >
                          <Edit3 size={14} />
                        </button>
                        {!node?.isRoot ? (
                          <button
                            type="button"
                            className="jinzhi-node-card__mini-btn is-danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteNode(node);
                            }}
                            title="删除节点"
                            disabled={isBusy}
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
          {selectedNode && inspectorStyle ? (
            <div className="jinzhi-floating-inspector" style={inspectorStyle || undefined}>
              <div className="jinzhi-floating-inspector__header">
                <div>
                  <div className="jinzhi-inspector__eyebrow">Node Inspector</div>
                  <h2>{selectedNode?.title || '未命名节点'}</h2>
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
                {selectedNode?.contentText || '当前节点还没有内容。'}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <NodeEditorModal
        open={editorOpen}
        node={selectedNode}
        saving={savingContent}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveContent}
      />
      <NodeCreateModal
        open={Boolean(createParentNode)}
        parentNode={createParentNode}
        nodes={nodes}
        saving={Boolean(createParentNode?._id) && actionId === `create:${createParentNode._id}`}
        onClose={() => setCreateParentNode(null)}
        onSubmit={submitCreateChild}
      />
      <BrocadeOutlineModal
        open={outlineOpen}
        brocadeName={brocade?.name || initialBrocadeName || '知识锦大纲'}
        nodes={nodes}
        activeNodeId={selectedNodeId}
        onClose={() => setOutlineOpen(false)}
        onJump={handleJumpToOutlineNode}
      />
    </div>
  );
};

export default KnowledgeBrocadeWorkspacePage;
