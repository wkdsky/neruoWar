import React, { useCallback, useMemo, useRef, useState } from 'react';

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 120;
const MINIMAP_PADDING = 6;
const MINIMAP_EDGE_COLOR = 'rgba(120, 73, 39, 0.4)';

const KnowledgeBrocadeMiniMap = ({
  nodes = [],
  edges = [],
  canvasMetrics = {},
  zoom = 1,
  scrollLeft = 0,
  scrollTop = 0,
  viewportWidth = 800,
  viewportHeight = 600,
  visible = true,
  onToggleVisibility,
  scrollContainerRef
}) => {
  const contentWidth = canvasMetrics.width || 1000;
  const contentHeight = canvasMetrics.height || 600;
  const originX = canvasMetrics.originX || 0;
  const originY = canvasMetrics.originY || 0;

  const availableWidth = MINIMAP_WIDTH - MINIMAP_PADDING * 2;
  const availableHeight = MINIMAP_HEIGHT - MINIMAP_PADDING * 2;

  const viewportRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // 节点在 minimap 中的位置
  const minimapNodes = useMemo(() => {
    return nodes.map((node) => {
      // 节点在"内容坐标系"中的绝对位置
      const nodeAbsX = originX + (node?.position?.x || 0);
      const nodeAbsY = originY + (node?.position?.y || 0);

      // 映射到 minimap 像素坐标
      const x = (nodeAbsX / contentWidth) * availableWidth + MINIMAP_PADDING;
      const y = (nodeAbsY / contentHeight) * availableHeight + MINIMAP_PADDING;

      const w = Math.max(4, ((node?.size?.width || 220) / contentWidth) * availableWidth);
      const h = Math.max(3, ((node?.size?.height || 122) / contentHeight) * availableHeight);

      return {
        ...node,
        minimapX: x,
        minimapY: y,
        minimapW: w,
        minimapH: h,
        centerX: x + w / 2,
        centerY: y + h / 2
      };
    });
  }, [nodes, originX, originY, contentWidth, contentHeight, availableWidth, availableHeight]);

  // 用于画连线
  const nodeCenterMap = useMemo(() => {
    const map = new Map();
    minimapNodes.forEach((node) => map.set(node._id, { x: node.centerX, y: node.centerY }));
    return map;
  }, [minimapNodes]);

  const minimapEdges = useMemo(() => {
    return edges
      .filter((e) => e?.source && e?.target)
      .map((edge) => {
        const src = nodeCenterMap.get(edge.source?._id);
        const tgt = nodeCenterMap.get(edge.target?._id);
        if (!src || !tgt) return null;
        return { ...edge, x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y };
      })
      .filter(Boolean);
  }, [edges, nodeCenterMap]);

  // 视口指示器
  const viewportRect = useMemo(() => {
    if (!zoom || zoom <= 0 || !viewportWidth || !viewportHeight) return null;

    // 当前可视区域在"内容坐标系"中的位置
    const stageDisplayW = contentWidth * zoom;
    const stageDisplayH = contentHeight * zoom;
    const shellW = Math.max(viewportWidth, stageDisplayW);
    const shellH = Math.max(viewportHeight, stageDisplayH);
    const stageOffsetX = Math.max(0, (shellW - stageDisplayW) / 2);
    const stageOffsetY = Math.max(0, (shellH - stageDisplayH) / 2);

    // 内容坐标系原点 (0,0) 在 shell 中的位置
    // 内容坐标 cx, cy 映射到 shell 坐标: shellX = cx * zoom + stageOffsetX
    // 反过来: cx = (shellX - stageOffsetX) / zoom
    const viewContentLeft = (scrollLeft - stageOffsetX) / zoom;
    const viewContentTop = (scrollTop - stageOffsetY) / zoom;
    const viewContentW = viewportWidth / zoom;
    const viewContentH = viewportHeight / zoom;

    // 映射到 minimap
    const mmX = (viewContentLeft / contentWidth) * availableWidth + MINIMAP_PADDING;
    const mmY = (viewContentTop / contentHeight) * availableHeight + MINIMAP_PADDING;
    const mmW = Math.max(12, (viewContentW / contentWidth) * availableWidth);
    const mmH = Math.max(10, (viewContentH / contentHeight) * availableHeight);

    return {
      x: mmX,
      y: mmY,
      w: Math.min(mmW, MINIMAP_WIDTH - MINIMAP_PADDING * 2),
      h: Math.min(mmH, MINIMAP_HEIGHT - MINIMAP_PADDING * 2)
    };
  }, [scrollLeft, scrollTop, zoom, viewportWidth, viewportHeight, contentWidth, contentHeight, availableWidth, availableHeight]);

  // minimap 坐标转内容坐标
  const mmToContent = useCallback((mmX, mmY) => {
    const cx = ((mmX - MINIMAP_PADDING) / availableWidth) * contentWidth;
    const cy = ((mmY - MINIMAP_PADDING) / availableHeight) * contentHeight;
    return { cx, cy };
  }, [availableWidth, availableHeight, contentWidth, contentHeight]);

  // 跳转到 minimap 指定位置
  const jumpTo = useCallback((mmX, mmY) => {
    if (!scrollContainerRef?.current || !zoom) return;
    const container = scrollContainerRef.current;

    const { cx, cy } = mmToContent(mmX, mmY);

    const stageDisplayW = contentWidth * zoom;
    const stageDisplayH = contentHeight * zoom;
    const shellW = Math.max(viewportWidth, stageDisplayW);
    const shellH = Math.max(viewportHeight, stageDisplayH);
    const stageOffsetX = Math.max(0, (shellW - stageDisplayW) / 2);
    const stageOffsetY = Math.max(0, (shellH - stageDisplayH) / 2);

    // 内容坐标转 shell 滚动位置
    const targetScrollLeft = cx * zoom + stageOffsetX - viewportWidth / 2;
    const targetScrollTop = cy * zoom + stageOffsetY - viewportHeight / 2;

    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);

    container.scrollLeft = Math.min(maxLeft, Math.max(0, targetScrollLeft));
    container.scrollTop = Math.min(maxTop, Math.max(0, targetScrollTop));
  }, [scrollContainerRef, zoom, contentWidth, contentHeight, viewportWidth, viewportHeight, mmToContent]);

  // 点击 minimap 任意位置跳转
  const handleClick = useCallback((e) => {
    if (isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    jumpTo(e.clientX - rect.left, e.clientY - rect.top);
  }, [isDragging, jumpTo]);

  // 拖动视口
  const handlePointerDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, scrollLeft, scrollTop };
    viewportRef.current?.setPointerCapture(e.pointerId);
  }, [scrollLeft, scrollTop]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    // minimap 像素 -> 内容像素
    const dContentX = (dx / availableWidth) * contentWidth;
    const dContentY = (dy / availableHeight) * contentHeight;

    if (scrollContainerRef?.current) {
      const container = scrollContainerRef.current;
      const targetScrollLeft = dragStartRef.current.scrollLeft + dContentX;
      const targetScrollTop = dragStartRef.current.scrollTop + dContentY;

      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);

      container.scrollLeft = Math.min(maxLeft, Math.max(0, targetScrollLeft));
      container.scrollTop = Math.min(maxTop, Math.max(0, targetScrollTop));
    }
  }, [isDragging, availableWidth, availableHeight, contentWidth, contentHeight, scrollContainerRef]);

  const handlePointerUp = useCallback((e) => {
    setIsDragging(false);
    viewportRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  if (!visible) return null;

  return (
    <div className="jinzhi-minimap" onClick={handleClick}>
      <svg className="jinzhi-minimap__edges" width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT}>
        {minimapEdges.map((edge, i) => (
          <line key={edge.id || i} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
            stroke={MINIMAP_EDGE_COLOR} strokeWidth={1} />
        ))}
      </svg>

      {minimapNodes.map((node) => (
        <div
          key={node._id}
          className={`jinzhi-minimap__node${node.isRoot ? ' is-root' : ''}`}
          style={{ left: node.minimapX, top: node.minimapY, width: node.minimapW, height: node.minimapH }}
        />
      ))}

      {viewportRect && (
        <div
          ref={viewportRef}
          className={`jinzhi-minimap__viewport${isDragging ? ' is-dragging' : ''}`}
          style={{ left: viewportRect.x, top: viewportRect.y, width: viewportRect.w, height: viewportRect.h }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      )}

      <button type="button" className="jinzhi-minimap__toggle" onClick={onToggleVisibility} title="隐藏缩略图">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

export default KnowledgeBrocadeMiniMap;
