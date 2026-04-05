import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Edit3, Plus, RefreshCw, Star, Trash2, X } from 'lucide-react';
import {
  createKnowledgeBrocadeNode,
  deleteKnowledgeBrocadeNode,
  getKnowledgeBrocadeGraph,
  updateKnowledgeBrocadeNode,
  updateKnowledgeBrocadeNodeContent
} from './knowledgeBrocadeApi';
import './KnowledgeBrocadeWorkspacePage.css';

const WORKSPACE_PADDING = 32;
const WORKSPACE_PADDING_MIN = 16;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 122;
const DEFAULT_SYSTEM_NODE_TITLE = '新建知识点';
const ZOOM_MAX = 1.22;
const ZOOM_DEFAULT = 1;
const DRAG_AUTOPAN_THRESHOLD = 84;
const DRAG_AUTOPAN_SPEED = 26;

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
            <h3>新增知识点</h3>
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
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const sliderDragRef = useRef(null);
  const pinchRef = useRef(null);
  const zoomFrameRef = useRef(0);
  const lastAutoCenteredNodeIdRef = useRef('');
  const zoomRef = useRef(ZOOM_DEFAULT);
  const [brocade, setBrocade] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [actionId, setActionId] = useState('');
  const [isPanning, setIsPanning] = useState(false);
  const [createParentNode, setCreateParentNode] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const selectedNode = useMemo(
    () => nodes.find((item) => item?._id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
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
  const zoomPercent = useMemo(
    () => {
      const range = Math.max(0.0001, zoomRange.max - zoomRange.min);
      return ((zoom - zoomRange.min) / range) * 100;
    },
    [zoom, zoomRange.max, zoomRange.min]
  );
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

  const setZoomBySliderClientY = useCallback((clientY) => {
    const sliderTarget = sliderDragRef.current?.target;
    if (!sliderTarget) return;
    const rect = sliderTarget.getBoundingClientRect();
    const ratio = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    applyZoom(zoomRange.min + (zoomRange.max - zoomRange.min) * ratio);
  }, [applyZoom, zoomRange.max, zoomRange.min]);

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
      const sliderCurrent = sliderDragRef.current;
      if (sliderCurrent) {
        event.preventDefault();
        setZoomBySliderClientY(event.clientY);
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
          const autoPanX = localX < DRAG_AUTOPAN_THRESHOLD
            ? -Math.min(DRAG_AUTOPAN_SPEED, DRAG_AUTOPAN_THRESHOLD - localX)
            : (localX > rect.width - DRAG_AUTOPAN_THRESHOLD
                ? Math.min(DRAG_AUTOPAN_SPEED, localX - (rect.width - DRAG_AUTOPAN_THRESHOLD))
                : 0);
          const autoPanY = localY < DRAG_AUTOPAN_THRESHOLD
            ? -Math.min(DRAG_AUTOPAN_SPEED, DRAG_AUTOPAN_THRESHOLD - localY)
            : (localY > rect.height - DRAG_AUTOPAN_THRESHOLD
                ? Math.min(DRAG_AUTOPAN_SPEED, localY - (rect.height - DRAG_AUTOPAN_THRESHOLD))
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
      const sliderCurrent = sliderDragRef.current;
      if (sliderCurrent) {
        if (sliderCurrent.target?.hasPointerCapture?.(sliderCurrent.pointerId)) {
          sliderCurrent.target.releasePointerCapture(sliderCurrent.pointerId);
        }
        sliderDragRef.current = null;
      }

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
      try {
        await updateKnowledgeBrocadeNode(activeBrocadeId, dragCurrent.nodeId, {
          position: movedNode.position
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
    setZoomBySliderClientY,
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
    setSelectedNodeId('');
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originScrollLeft: scrollRef.current.scrollLeft,
      originScrollTop: scrollRef.current.scrollTop,
      container: scrollRef.current
    };
    setIsPanning(true);
    event.preventDefault();
  }, []);

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
    const previousValue = !!node?.isStarred;
    setErrorText('');
    setNodes((prev) => prev.map((item) => (
      item?._id === node._id
        ? { ...item, isStarred: !!nextStarred }
        : item
    )));
    try {
      const data = await updateKnowledgeBrocadeNode(activeBrocadeId, node._id, { isStarred: !!nextStarred });
      const nextNode = data?.node || null;
      if (nextNode?._id) {
        setNodes((prev) => prev.map((item) => (item?._id === nextNode._id ? nextNode : item)));
      }
    } catch (error) {
      setNodes((prev) => prev.map((item) => (
        item?._id === node._id
          ? { ...item, isStarred: previousValue }
          : item
      )));
      setErrorText(error.message || '更新节点星标失败');
    }
  }, [activeBrocadeId]);

  const handleCreateChild = useCallback((node) => {
    if (!node?._id) return;
    setSelectedNodeId(node._id);
    setCreateParentNode(node);
  }, []);

  const submitCreateChild = async ({ contentText, isStarred }) => {
    const parentNode = createParentNode;
    if (!parentNode?._id) return;
    setActionId(`create:${parentNode._id}`);
    setErrorText('');
    try {
      const data = await createKnowledgeBrocadeNode(activeBrocadeId, {
        contentText,
        isStarred: !!isStarred,
        parentNodeId: parentNode._id,
        position: {
          x: (Number(parentNode?.position?.x) || 0) + NODE_WIDTH + 54,
          y: (Number(parentNode?.position?.y) || 0) + Math.round(NODE_HEIGHT * 0.35)
        }
      });
      const nextNode = data?.node || null;
      const nextBrocade = data?.brocade || null;
      if (nextNode?._id) {
        setNodes((prev) => [...prev, nextNode]);
        setSelectedNodeId(nextNode._id);
        setCreateParentNode(null);
      }
      if (nextBrocade?._id) {
        setBrocade(nextBrocade);
        onBrocadeMetaChange?.(nextBrocade);
      }
    } catch (error) {
      setErrorText(error.message || '新增子节点失败');
    } finally {
      setActionId('');
    }
  };

  const handleDeleteNode = async (node) => {
    if (!node?._id || node?.isRoot) return;
    const confirmed = window.confirm(`确认删除节点「${node.title || '未命名节点'}」？这会一并删除它的全部子节点。`);
    if (!confirmed) return;
    setActionId(`delete:${node._id}`);
    setErrorText('');
    try {
      const data = await deleteKnowledgeBrocadeNode(activeBrocadeId, node._id);
      const deletedIds = Array.isArray(data?.deletedNodeIds) ? data.deletedNodeIds : [];
      const nextBrocade = data?.brocade || null;
      setNodes((prev) => prev.filter((item) => !deletedIds.includes(item?._id)));
      setSelectedNodeId((prev) => (prev && !deletedIds.includes(prev) ? prev : ''));
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

  const handleOpenWorkspaceRefresh = useCallback(() => {
    if (!activeBrocadeId) return;
    loadGraph();
  }, [activeBrocadeId, loadGraph]);

  if (!activeBrocadeId) {
    return (
      <div className="jinzhi-workspace-page">
        <div className="jinzhi-workspace-page__empty">
          <h2>尚未选择知识锦</h2>
          <p>从右侧 `知识锦` 抽屉里选择一个知识锦后，就可以开始编辑你的节点图谱。</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>返回首页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="jinzhi-workspace-page">
      <header className="jinzhi-workspace-page__header">
        <div className="jinzhi-workspace-page__title">
          <div className="jinzhi-workspace-page__title-topline">
            <button type="button" className="jinzhi-back-btn" onClick={onBack}>
              <ArrowLeft size={16} />
              返回首页
            </button>
            <div className="jinzhi-workspace-page__eyebrow">Knowledge Brocade</div>
          </div>
          <h1>{initialBrocadeName || brocade?.name || '知识锦工作区'}</h1>
        </div>
        <div className="jinzhi-workspace-page__toolbar">
          <button type="button" className="btn btn-secondary" onClick={handleOpenWorkspaceRefresh}>
            <RefreshCw size={15} />
            刷新
          </button>
        </div>
      </header>

      {errorText ? <div className="jinzhi-workspace-page__error">{errorText}</div> : null}

      <div className="jinzhi-workspace-page__layout">
        <section className="jinzhi-workspace-page__canvas-card">
          <div className="jinzhi-workspace-page__canvas-toolbar">
            <span>{loading ? '正在加载图谱...' : `节点 ${nodes.length}`}</span>
            {selectedNode ? (
              <button
                type="button"
                className="btn btn-small btn-secondary"
                onClick={() => centerNodeInViewport(scrollRef, selectedNode, canvasMetrics, zoomRef.current)}
              >
                定位当前节点
              </button>
            ) : null}
          </div>

	          <div className="jinzhi-zoom-controls" aria-label="地图缩放控制">
	            <div className="jinzhi-zoom-controls__value">{Math.round(zoom * 100)}%</div>
	            <div
              className="jinzhi-zoom-slider"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                sliderDragRef.current = {
                  pointerId: event.pointerId,
                  target: event.currentTarget
                };
                event.currentTarget.setPointerCapture?.(event.pointerId);
                setZoomBySliderClientY(event.clientY);
              }}
            >
              <div className="jinzhi-zoom-slider__track" />
              <div
                className="jinzhi-zoom-slider__fill"
                style={{ height: `calc((100% - 1.6rem) * ${zoomPercent / 100})` }}
              />
	              <div
	                className="jinzhi-zoom-slider__thumb"
	                style={{ top: `calc(0.8rem + (100% - 1.6rem) * ${(100 - zoomPercent) / 100})` }}
	              />
	            </div>
	            <button
	              type="button"
	              className="jinzhi-zoom-controls__reset"
	              onClick={(event) => {
	                event.preventDefault();
	                event.stopPropagation();
	                handleResetZoom();
	              }}
	            >
	              重置
	            </button>
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
                  {edges.map((edge) => {
                    const sourceX = canvasMetrics.originX + (Number(edge.source?.position?.x) || 0) + NODE_WIDTH / 2;
                    const sourceY = canvasMetrics.originY + (Number(edge.source?.position?.y) || 0) + NODE_HEIGHT / 2;
                    const targetX = canvasMetrics.originX + (Number(edge.target?.position?.x) || 0) + NODE_WIDTH / 2;
                    const targetY = canvasMetrics.originY + (Number(edge.target?.position?.y) || 0) + NODE_HEIGHT / 2;
                    const branchWidth = Math.max(
                      1.2,
                      Math.min(4.2, 1.05 + Math.log2((edge.trunkWeight || 1) + 1) * 0.52 - edge.depth * 0.14)
                    );
                    const highlightWidth = Math.max(0.75, branchWidth * 0.42);
                    const branchStartX = sourceX + Math.max(28, Math.min(72, (targetX - sourceX) * 0.2));
                    const branchMidX = sourceX + Math.max(52, Math.min(132, (targetX - sourceX) * 0.46));
                    const branchLift = Math.max(22, Math.min(58, Math.abs(targetY - sourceY) * 0.28));
                    const pathData = [
                      `M ${sourceX} ${sourceY}`,
                      `C ${branchStartX} ${sourceY}, ${branchMidX - 14} ${sourceY}, ${branchMidX} ${sourceY}`,
                      `S ${branchMidX + 14} ${targetY + (targetY >= sourceY ? -branchLift : branchLift)}, ${targetX} ${targetY}`
                    ].join(' ');
                    return (
                      <g key={edge.id}>
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
                  })}
                </svg>

                {nodes.map((node) => {
                  const isSelected = node?._id === selectedNode?._id;
                  const isBusy = actionId === `create:${node?._id}` || actionId === `delete:${node?._id}`;
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
                      onClick={() => setSelectedNodeId(node?._id || '')}
                      onDoubleClick={() => {
                        setSelectedNodeId(node?._id || '');
                        setEditorOpen(true);
                      }}
                    >
                      <div
                        className="jinzhi-node-card__drag"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedNodeId(node?._id || '');
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
                      {node?.isStarred ? (
                        <div className="jinzhi-node-card__star" aria-label="星标节点">
                          <Star size={15} fill="currentColor" />
                        </div>
                      ) : null}
                      <div className="jinzhi-node-card__actions">
                        <button
                          type="button"
                          className={`jinzhi-node-card__mini-btn${node?.isStarred ? ' is-starred' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleToggleNodeStar(node, !node?.isStarred);
                          }}
                          title={node?.isStarred ? '取消星标' : '星标节点'}
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
                          title="新增子节点"
                          disabled={isBusy}
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          type="button"
                          className="jinzhi-node-card__mini-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedNodeId(node?._id || '');
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
          {selectedNode ? (
            <div className="jinzhi-floating-inspector">
              <div className="jinzhi-floating-inspector__header">
                <div>
                  <div className="jinzhi-inspector__eyebrow">Node Inspector</div>
                  <h2>{selectedNode?.title || '未命名节点'}</h2>
                </div>
                <button
                  type="button"
                  className="jinzhi-floating-inspector__close"
                  onClick={() => setSelectedNodeId('')}
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
                  className={`btn ${selectedNode?.isStarred ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => handleToggleNodeStar(selectedNode, !selectedNode?.isStarred)}
                >
                  <Star size={15} fill={selectedNode?.isStarred ? 'currentColor' : 'none'} />
                  {selectedNode?.isStarred ? '取消星标' : '设为星标'}
                </button>
                <button type="button" className="btn btn-primary" onClick={handleOpenEditor}>
                  <Edit3 size={15} />
                  编辑内容
                </button>
                {!selectedNode?.isRoot ? (
                  <button type="button" className="btn btn-danger" onClick={() => handleDeleteNode(selectedNode)}>
                    <Trash2 size={15} />
                    删除节点
                  </button>
                ) : null}
              </div>
              <div className="jinzhi-inspector__tip">移动节点时直接拖拽卡片即可。新增节点和已存在节点都支持单独星标。</div>
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
    </div>
  );
};

export default KnowledgeBrocadeWorkspacePage;
