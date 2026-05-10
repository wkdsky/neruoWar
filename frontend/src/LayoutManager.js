/**
 * LayoutManager - 布局管理器
 * 负责计算不同场景下节点的位置
 */

import {
  STAR_MAP_LAYER,
  getStarMapCenterKey,
  getStarMapNodeKey
} from './starMap/starMapHelpers';
import {
  buildStarMapGraphMeta,
  buildStarMapEdgeColor,
  buildStarMapLineVisual,
  buildStarMapStubVisual,
  buildStarMapShortestHopLevels,
  estimateStarMapLabelMetrics
} from './starMap/starMapLayoutHelpers';
import {
  refineStarMapLayoutWithMeasuredLabels
} from './starMap/starMapForceLayout';
import {
  radialDagLayout
} from './starMap/starMapRadialDagLayout';

const HEX_AXIAL_X_FACTOR = Math.sqrt(3);

const clampLayoutValue = (value, min, max) => Math.max(min, Math.min(max, value));

const TITLE_DETAIL_HEX_SLOT_PREFERENCE = [
  { axialQ: 1, axialR: 0 },
  { axialQ: 1, axialR: -1 },
  { axialQ: 0, axialR: 1 },
  { axialQ: 0, axialR: -1 },
  { axialQ: -1, axialR: 1 },
  { axialQ: -1, axialR: 0 },
  { axialQ: 2, axialR: 0 },
  { axialQ: 2, axialR: -1 },
  { axialQ: 1, axialR: 1 },
  { axialQ: 1, axialR: -2 },
  { axialQ: 0, axialR: 2 },
  { axialQ: 0, axialR: -2 },
  { axialQ: -1, axialR: 2 },
  { axialQ: -1, axialR: -1 },
  { axialQ: -2, axialR: 2 },
  { axialQ: -2, axialR: 1 },
  { axialQ: -2, axialR: 0 },
  { axialQ: 2, axialR: -2 }
];

class LayoutManager {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.centerX = width / 2;
    this.centerY = height / 2;
    this.viewportInsets = {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    };
  }

  resolveNodeLabel(node = {}, options = {}) {
    const includeSense = options?.includeSense !== false;
    const title = typeof node?.name === 'string' ? node.name.trim() : '';
    const senseTitle = this.resolveActiveSenseTitle(node);
    if (includeSense && title && senseTitle) {
      return `${title}\n${senseTitle}`;
    }
    return title || '未命名知识域';
  }

  resolveActiveSenseTitle(node = {}) {
    const activeSenseId = typeof node?.activeSenseId === 'string'
      ? node.activeSenseId.trim()
      : '';
    const senses = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
    if (activeSenseId) {
      const matchedSense = senses.find((item) => String(item?.senseId || '').trim() === activeSenseId);
      const matchedTitle = typeof matchedSense?.title === 'string' ? matchedSense.title.trim() : '';
      if (matchedTitle) return matchedTitle;
    }
    const activeSenseTitle = typeof node?.activeSenseTitle === 'string'
      ? node.activeSenseTitle.trim()
      : '';
    if (activeSenseTitle) return activeSenseTitle;
    const fallbackSense = senses.find((item) => typeof item?.title === 'string' && item.title.trim());
    return typeof fallbackSense?.title === 'string' ? fallbackSense.title.trim() : '';
  }

  resolveSenseFocusLabel(node = {}) {
    const title = typeof node?.name === 'string' ? node.name.trim() : '';
    const senseTitle = this.resolveActiveSenseTitle(node);
    if (senseTitle && title) {
      return `${senseTitle}\n${title}`;
    }
    return senseTitle || title || '未命名释义';
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.centerX = width / 2;
    this.centerY = height / 2;
  }

  setViewportInsets(insets = {}) {
    const maxHorizontalInset = Math.max(0, this.width - 1);
    const maxVerticalInset = Math.max(0, this.height - 1);
    this.viewportInsets = {
      top: Math.max(0, Math.min(maxVerticalInset, Number(insets.top) || 0)),
      right: Math.max(0, Math.min(maxHorizontalInset, Number(insets.right) || 0)),
      bottom: Math.max(0, Math.min(maxVerticalInset, Number(insets.bottom) || 0)),
      left: Math.max(0, Math.min(maxHorizontalInset, Number(insets.left) || 0))
    };
  }

  getViewportFocusCenter() {
    const left = this.viewportInsets.left || 0;
    const right = this.viewportInsets.right || 0;
    const top = this.viewportInsets.top || 0;
    const bottom = this.viewportInsets.bottom || 0;
    const availableWidth = Math.max(1, this.width - left - right);
    const availableHeight = Math.max(1, this.height - top - bottom);
    return {
      centerX: left + availableWidth / 2,
      centerY: top + availableHeight / 2
    };
  }

  getViewportContentMetrics() {
    const left = this.viewportInsets.left || 0;
    const right = this.viewportInsets.right || 0;
    const top = this.viewportInsets.top || 0;
    const bottom = this.viewportInsets.bottom || 0;
    const availableWidth = Math.max(1, this.width - left - right);
    const availableHeight = Math.max(1, this.height - top - bottom);
    const focusCenter = this.getViewportFocusCenter();
    return {
      ...focusCenter,
      left,
      right,
      top,
      bottom,
      availableWidth,
      availableHeight
    };
  }

  resolveAxialHexPosition(centerX, centerY, hexStep, slot = {}) {
    const axialQ = Number(slot.axialQ) || 0;
    const axialR = Number(slot.axialR) || 0;
    return {
      x: centerX + HEX_AXIAL_X_FACTOR * hexStep * (axialQ + axialR / 2),
      y: centerY + 1.5 * hexStep * axialR
    };
  }

  resolveFlatTopHexPosition(centerX, centerY, hexStep, slot = {}) {
    const axialQ = Number(slot.axialQ) || 0;
    const axialR = Number(slot.axialR) || 0;
    return {
      x: centerX + 1.5 * hexStep * axialQ,
      y: centerY + HEX_AXIAL_X_FACTOR * hexStep * (axialR + axialQ / 2)
    };
  }

  buildDetailHexSlots(preferredSlots = [], wantedCount = 0, verticalDirection = 1) {
    const count = Math.max(0, Number(wantedCount) || 0);
    const slots = [];
    const seen = new Set();
    const addSlot = (slot) => {
      const axialQ = Number(slot?.axialQ) || 0;
      const axialR = Number(slot?.axialR) || 0;
      const key = `${axialQ}:${axialR}`;
      if (seen.has(key)) return;
      seen.add(key);
      slots.push({ axialQ, axialR });
    };

    preferredSlots.forEach((slot) => {
      if (slots.length < count) addSlot(slot);
    });

    for (let ringIndex = 2; slots.length < count && ringIndex <= 8; ringIndex += 1) {
      for (let axialQ = -ringIndex; axialQ <= ringIndex; axialQ += 1) {
        for (let axialR = -ringIndex; axialR <= ringIndex; axialR += 1) {
          const axialS = -axialQ - axialR;
          const axialDistance = Math.max(Math.abs(axialQ), Math.abs(axialR), Math.abs(axialS));
          if (axialDistance !== ringIndex) continue;
          const verticalUnit = 1.5 * axialR;
          if (verticalDirection < 0 && verticalUnit > 0.25) continue;
          if (verticalDirection > 0 && verticalUnit < -0.25) continue;
          addSlot({ axialQ, axialR });
          if (slots.length >= count) break;
        }
        if (slots.length >= count) break;
      }
    }

    return slots.slice(0, count);
  }

  buildDetailProjectionPositions(centerX, centerY, count = 0, verticalDirection = 1, options = {}) {
    const wantedCount = Math.max(0, Number(count) || 0);
    const positions = [];
    const hexStep = Math.max(1, Number(options?.hexStep) || 76);
    const firstDistance = Math.max(hexStep * 1.42, Number(options?.firstDistance) || 0);
    const rowGap = Math.max(hexStep * 1.26, Number(options?.rowGap) || 0);
    const columnGap = Math.max(hexStep * 1.58, Number(options?.columnGap) || 0);
    const direction = verticalDirection < 0 ? -1 : 1;
    let remaining = wantedCount;
    let rowIndex = 0;

    while (remaining > 0) {
      const targetRowSize = rowIndex % 2 === 0 ? 2 : 3;
      const rowSize = Math.min(remaining, targetRowSize);
      const xOffsets = rowSize === 1
        ? [0]
        : Array.from({ length: rowSize }, (_, index) => (index - (rowSize - 1) / 2) * columnGap);
      const currentRowIndex = rowIndex;
      const y = centerY + direction * (firstDistance + rowIndex * rowGap);
      xOffsets.forEach((offsetX) => {
        positions.push({
          x: centerX + offsetX,
          y,
          rowIndex: currentRowIndex,
          rowSize
        });
      });
      remaining -= rowSize;
      rowIndex += 1;
    }

    return positions.slice(0, wantedCount);
  }

  normalizeTitleSenseList(node = {}) {
    const sourceSenses = Array.isArray(node?.synonymSenses) ? node.synonymSenses : [];
    const seenSenseIds = new Set();
    const senses = [];

    sourceSenses.forEach((sense, index) => {
      const rawSenseId = typeof sense?.senseId === 'string' ? sense.senseId.trim() : '';
      const senseId = rawSenseId || `sense_${index + 1}`;
      const title = typeof sense?.title === 'string' ? sense.title.trim() : '';
      if (!senseId || !title || seenSenseIds.has(senseId)) return;
      seenSenseIds.add(senseId);
      senses.push({
        ...sense,
        senseId,
        title,
        content: typeof sense?.content === 'string' ? sense.content : ''
      });
    });

    const activeSenseId = typeof node?.activeSenseId === 'string' ? node.activeSenseId.trim() : '';
    const activeSenseTitle = typeof node?.activeSenseTitle === 'string' ? node.activeSenseTitle.trim() : '';
    if (senses.length < 1 && activeSenseTitle) {
      senses.push({
        senseId: activeSenseId || 'sense_1',
        title: activeSenseTitle,
        content: typeof node?.activeSenseContent === 'string' ? node.activeSenseContent : ''
      });
    }

    return senses;
  }

  buildTitleDetailHexSlots(wantedCount = 0, options = {}) {
    const count = Math.max(0, Number(wantedCount) || 0);
    const slots = [];
    const seen = new Set();
    const reserveRect = options?.reserveRect || null;
    const centerX = Number(options?.centerX) || 0;
    const centerY = Number(options?.centerY) || 0;
    const hexStep = Math.max(1, Number(options?.hexStep) || 1);
    const nodeRadius = Math.max(1, Number(options?.nodeRadius) || 1);
    const isReserved = (slot) => {
      if (!reserveRect) return false;
      const point = this.resolveFlatTopHexPosition(centerX, centerY, hexStep, slot);
      return (
        point.x > reserveRect.left - nodeRadius
        && point.x < reserveRect.right + nodeRadius
        && point.y > reserveRect.top - nodeRadius
        && point.y < reserveRect.bottom + nodeRadius
      );
    };
    const addSlot = (slot, allowReserved = false) => {
      const axialQ = Number(slot?.axialQ) || 0;
      const axialR = Number(slot?.axialR) || 0;
      if (axialQ === 0 && axialR === 0) return;
      const key = `${axialQ}:${axialR}`;
      if (seen.has(key)) return;
      if (!allowReserved && isReserved({ axialQ, axialR })) return;
      seen.add(key);
      slots.push({ axialQ, axialR });
    };

    TITLE_DETAIL_HEX_SLOT_PREFERENCE.forEach((slot) => {
      if (slots.length < count) addSlot(slot);
    });

    for (let ringIndex = 1; slots.length < count && ringIndex <= 9; ringIndex += 1) {
      const ringSlots = [];
      for (let axialQ = -ringIndex; axialQ <= ringIndex; axialQ += 1) {
        for (let axialR = -ringIndex; axialR <= ringIndex; axialR += 1) {
          const axialS = -axialQ - axialR;
          const axialDistance = Math.max(Math.abs(axialQ), Math.abs(axialR), Math.abs(axialS));
          if (axialDistance !== ringIndex) continue;
          const point = this.resolveFlatTopHexPosition(0, 0, 1, { axialQ, axialR });
          const angle = Math.atan2(point.y, point.x);
          const upperLeftPenalty = point.x < -0.1 && point.y < -0.1 ? 10 : 0;
          const startRightScore = Math.abs(angle);
          ringSlots.push({
            axialQ,
            axialR,
            sortScore: upperLeftPenalty + startRightScore
          });
        }
      }
      ringSlots
        .sort((a, b) => a.sortScore - b.sortScore || a.axialR - b.axialR || a.axialQ - b.axialQ)
        .forEach((slot) => {
          if (slots.length < count) addSlot(slot);
        });
    }

    for (let ringIndex = 1; slots.length < count && ringIndex <= 9; ringIndex += 1) {
      for (let axialQ = -ringIndex; axialQ <= ringIndex; axialQ += 1) {
        for (let axialR = -ringIndex; axialR <= ringIndex; axialR += 1) {
          const axialS = -axialQ - axialR;
          const axialDistance = Math.max(Math.abs(axialQ), Math.abs(axialR), Math.abs(axialS));
          if (axialDistance === ringIndex && slots.length < count) {
            addSlot({ axialQ, axialR }, true);
          }
        }
      }
    }

    return slots.slice(0, count);
  }

  resolveTitleAnchorPosition(metrics, anchorRadius) {
    const horizontalOffset = clampLayoutValue(metrics.availableWidth * 0.19, 180, 230);
    const verticalOffset = clampLayoutValue(metrics.availableHeight * 0.012, 0, 20);
    const minX = metrics.left + anchorRadius + 24;
    const maxX = this.width - metrics.right - anchorRadius - 24;
    const minY = metrics.top + anchorRadius + 24;
    const maxY = this.height - metrics.bottom - anchorRadius - 24;
    return {
      x: clampLayoutValue(metrics.centerX - horizontalOffset, minX, maxX),
      y: clampLayoutValue(metrics.centerY - verticalOffset, minY, maxY)
    };
  }

  buildStarMapLayoutKey(graph = {}, layer = STAR_MAP_LAYER.TITLE) {
    const centerKey = getStarMapCenterKey(graph, layer);
    const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
    const boundaryStubs = Array.isArray(graph?.boundaryStubs) ? graph.boundaryStubs : [];
    const nodeSignature = graphNodes
      .map((node) => getStarMapNodeKey(node, layer))
      .filter(Boolean)
      .sort()
      .join(',');
    const edgeSignature = graphEdges
      .map((edge) => String(edge?.edgeId || ''))
      .filter(Boolean)
      .sort()
      .join(',');
    const stubSignature = boundaryStubs
      .map((stub) => String(stub?.stubId || ''))
      .filter(Boolean)
      .sort()
      .join(',');
    return [
      layer,
      centerKey,
      this.width,
      this.height,
      Math.round(this.viewportInsets.left || 0),
      Math.round(this.viewportInsets.top || 0),
      Math.round(this.viewportInsets.right || 0),
      Math.round(this.viewportInsets.bottom || 0),
      graphNodes.length,
      graphEdges.length,
      nodeSignature,
      edgeSignature,
      stubSignature
    ].join('|');
  }

  calculateHoneycombSectionLayout(nodes = [], options = {}) {
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const centerX = Number.isFinite(options.centerX) ? options.centerX : this.centerX;
    const topY = Number.isFinite(options.topY) ? options.topY : 0;
    const availableWidth = Math.max(140, Number.isFinite(options.availableWidth) ? options.availableWidth : this.width);
    const radius = Math.max(18, Number.isFinite(options.radius) ? options.radius : 56);
    const type = options.type || 'root';
    const minColumns = Math.max(1, Number.isFinite(options.minColumns) ? options.minColumns : 1);
    const maxColumns = Math.max(minColumns, Number.isFinite(options.maxColumns) ? options.maxColumns : 4);

    if (nodeList.length < 1) {
      return {
        nodes: [],
        rows: 0,
        bottomY: topY
      };
    }

    const minSpacing = radius * 2.42;
    const computedColumns = Math.floor((availableWidth + minSpacing * 0.5) / minSpacing);
    const columns = Math.max(minColumns, Math.min(maxColumns, nodeList.length, computedColumns || 1));
    const xSpacing = Math.max(radius * 2.42, Math.min(radius * 2.74, availableWidth / Math.max(1, columns - 0.15)));
    const ySpacing = radius * 2.08;
    const rows = Math.ceil(nodeList.length / columns);
    const sectionNodes = [];

    for (let row = 0; row < rows; row += 1) {
      const startIndex = row * columns;
      const rowNodes = nodeList.slice(startIndex, startIndex + columns);
      const rowOffset = row % 2 === 1 ? xSpacing * 0.5 : 0;
      const rowWidth = rowNodes.length > 0
        ? ((rowNodes.length - 1) * xSpacing + rowOffset)
        : 0;
      const rowStartX = centerX - rowWidth * 0.5;

      rowNodes.forEach((node, columnIndex) => {
        sectionNodes.push({
          id: `${type}-${node._id}`,
          x: rowStartX + columnIndex * xSpacing + rowOffset,
          y: topY + radius + row * ySpacing,
          radius,
          scale: 1,
          opacity: 1,
          type,
          label: this.resolveNodeLabel(node, { includeSense: false }),
          visualStyle: node.visualStyle || null,
          labelColor: node.visualStyle?.textColor || '',
          data: node,
          visible: true
        });
      });
    }

    return {
      nodes: sectionNodes,
      rows,
      bottomY: topY + radius * 2 + Math.max(0, rows - 1) * ySpacing
    };
  }

  /**
   * 首页布局
   * 包括：根节点区、分割线、热门节点区
   */
  calculateHomeLayout(rootNodes, featuredNodes, searchResults = []) {
    const layout = {
      nodes: [],
      lines: []
    };

    const isSearching = searchResults.length > 0;

    if (isSearching) {
      // 搜索结果模式：长方体条目列表布局
      // 注意：搜索结果使用HTML渲染，不在WebGL中显示
      // 这里返回空的节点列表，搜索结果由React组件处理
      return layout;
    }

    const leftInset = this.width < 900 ? 56 : 112;
    const rightInset = this.width < 900 ? 56 : 112;
    const sectionWidth = Math.max(220, this.width - leftInset - rightInset);
    const topInset = Math.max(182, this.height * 0.22);
    const bottomInset = Math.max(72, this.height * 0.08);
    const dividerGap = this.height < 820 ? 92 : 124;
    const availableVertical = Math.max(260, this.height - topInset - bottomInset - dividerGap);
    const defaultRootHeight = 232;
    const defaultFeaturedHeight = 184;
    const verticalScale = Math.min(1, availableVertical / (defaultRootHeight + defaultFeaturedHeight));
    const rootRadius = Math.max(38, Math.min(60, 60 * verticalScale));
    const featuredRadius = Math.max(30, Math.min(46, 46 * verticalScale));

    const rootSection = this.calculateHoneycombSectionLayout(rootNodes, {
      centerX: this.centerX,
      topY: topInset,
      availableWidth: sectionWidth,
      radius: rootRadius,
      type: 'root',
      minColumns: 1,
      maxColumns: this.width < 900 ? 3 : 5
    });
    layout.nodes.push(...rootSection.nodes);

    const featuredTopY = rootSection.bottomY + dividerGap;
    const featuredSection = this.calculateHoneycombSectionLayout(featuredNodes, {
      centerX: this.centerX,
      topY: featuredTopY,
      availableWidth: sectionWidth * 0.92,
      radius: featuredRadius,
      type: 'featured',
      minColumns: 1,
      maxColumns: this.width < 900 ? 3 : 4
    });
    layout.nodes.push(...featuredSection.nodes);

    if (rootSection.nodes.length > 0 && featuredSection.nodes.length > 0) {
      const dividerY = rootSection.bottomY + dividerGap * 0.5;
      const dividerInsetLeft = Math.max(72, leftInset + sectionWidth * 0.08);
      const dividerInsetRight = Math.max(72, rightInset + sectionWidth * 0.08);
      const dividerOffsets = [
        { suffix: 'top', offsetY: -7, color: [0.45, 0.77, 0.96, 0.22] },
        { suffix: 'mid', offsetY: 0, color: [0.92, 0.95, 1.0, 0.62] },
        { suffix: 'bottom', offsetY: 7, color: [0.98, 0.75, 0.31, 0.18] }
      ];

      dividerOffsets.forEach((item) => {
        const leftId = `home-divider-anchor-left-${item.suffix}`;
        const rightId = `home-divider-anchor-right-${item.suffix}`;
        layout.nodes.push({
          id: leftId,
          x: dividerInsetLeft,
          y: dividerY + item.offsetY,
          radius: 0,
          scale: 1,
          opacity: 1,
          type: 'home-divider-anchor',
          label: '',
          data: null,
          visible: true
        });
        layout.nodes.push({
          id: rightId,
          x: this.width - dividerInsetRight,
          y: dividerY + item.offsetY,
          radius: 0,
          scale: 1,
          opacity: 1,
          type: 'home-divider-anchor',
          label: '',
          data: null,
          visible: true
        });
        layout.lines.push({
          id: `home-root-featured-divider-${item.suffix}`,
          from: leftId,
          to: rightId,
          color: item.color,
          noCaps: true
        });
      });
    }

    return layout;
  }

  /**
   * 节点详情布局
   * 中心节点 + 母域节点(上半圆) + 子域节点(下半圆)
   */
  calculateNodeDetailLayout(centerNode, parentNodes = [], childNodes = []) {
    const layout = {
      nodes: [],
      lines: []
    };

    const metrics = this.getViewportContentMetrics();
    const { centerX, centerY } = metrics;
    const minContentSide = Math.max(320, Math.min(metrics.availableWidth, metrics.availableHeight));
    const centerRadius = clampLayoutValue(minContentSide * 0.105, 62, 82);
    const relationRadius = clampLayoutValue(centerRadius * 0.62, 34, 52);
    const hexStep = clampLayoutValue(centerRadius * 1.02, 66, 86);
    const anchorRadius = clampLayoutValue(centerRadius * 0.54, 32, 44);
    const titleAnchorPosition = this.resolveTitleAnchorPosition(metrics, anchorRadius);
    const centerLayoutId = `center-${centerNode._id}`;
    const titleAnchorId = `title-anchor-${centerNode._id}`;
    const centerFocusLabel = this.resolveSenseFocusLabel(centerNode);
    const [centerFocusTitleLine = '', ...centerFocusSenseLineParts] = centerFocusLabel.split('\n');
    const centerFocusSenseLine = centerFocusSenseLineParts.join('\n').trim();

    // 中心节点
    layout.nodes.push({
      id: centerLayoutId,
      x: centerX,
      y: centerY,
      radius: centerRadius,
      scale: 1,
      opacity: 1,
      type: 'center',
      label: centerFocusLabel,
      visualStyle: centerNode.visualStyle || null,
      labelColor: centerNode.visualStyle?.textColor || '',
      data: {
        ...centerNode,
        detailRole: 'sense-focus'
      },
      labelMaxWidthStrategy: 'wide',
      labelTitleLines: centerFocusTitleLine ? [centerFocusTitleLine] : null,
      labelSenseLines: centerFocusSenseLine ? [centerFocusSenseLine] : null,
      labelLineClamp: 1,
      labelSenseLineClamp: 1,
      shapeMorph: 0,
      drawOrder: 8,
      visible: true
    });

    layout.nodes.push({
      id: titleAnchorId,
      x: titleAnchorPosition.x,
      y: titleAnchorPosition.y,
      radius: anchorRadius,
      scale: 1,
      opacity: 0.96,
      type: 'title-anchor',
      label: `${this.resolveNodeLabel(centerNode, { includeSense: false })}\n上级知识域`,
      visualStyle: centerNode.visualStyle || null,
      labelColor: centerNode.visualStyle?.textColor || '',
      data: {
        ...centerNode,
        detailRole: 'title-anchor'
      },
      labelMaxWidthStrategy: 'wide',
      labelWidthHint: Math.max(54, anchorRadius * 1.62),
      labelTitleWidthHint: Math.max(52, anchorRadius * 1.48),
      labelSenseWidthHint: Math.max(48, anchorRadius * 1.42),
      labelTitleLines: [this.resolveNodeLabel(centerNode, { includeSense: false })],
      labelSenseLines: ['上级知识域'],
      labelLineClamp: 2,
      labelSenseLineClamp: 1,
      shapeMorph: 0,
      drawOrder: 7,
      visible: true
    });

      layout.lines.push({
        id: `domain-anchor-beam-${centerNode._id}`,
        from: titleAnchorId,
        to: centerLayoutId,
        color: [0.76, 0.85, 0.94, 0.68],
        beamColor: [0.66, 0.80, 0.94, 1],
        lineVariant: 'domain-anchor-beam',
        glowOpacity: 0.42,
        lineOpacity: 0.3,
        innerGlowOpacity: 0.2,
        glowWidth: 9,
        lineWidth: 1.8,
        beamFillOpacity: 0.22,
        beamSpreadPx: 11,
        beamCoreWidth: 4.8,
        beamBlurPx: 22,
        railWidth: 1.1,
        railOpacity: 0.32,
        curveOffset: 0,
        curveBias: 0.5,
        capStrength: 0.9,
        drawOrder: -2
    });

    // 母域节点：中心向上按 2 / 3 / 2 交替展开，单行最多三个。
    const parentRadius = relationRadius;
    const parentPositions = this.buildDetailProjectionPositions(centerX, centerY, parentNodes.length, -1, {
      hexStep,
      firstDistance: hexStep * 1.48,
      rowGap: hexStep * 1.42,
      columnGap: hexStep * 1.62
    });

    parentNodes.forEach((node, index) => {
      const slotPosition = parentPositions[index] || { x: centerX, y: centerY - hexStep * 1.48 };

      const nodeId = `parent-${node._id}`;

      layout.nodes.push({
        id: nodeId,
        x: slotPosition.x,
        y: slotPosition.y,
        radius: parentRadius,
        scale: 1,
        opacity: 1,
        type: 'parent',
        label: this.resolveNodeLabel(node),
        visualStyle: node.visualStyle || null,
        labelColor: node.visualStyle?.textColor || '',
        data: node,
        labelMaxWidthStrategy: 'compact',
        shapeMorph: 0,
        drawOrder: 4,
        visible: true
      });

      // 添加连线
      layout.lines.push({
        id: `sense-parent-${centerNode._id}-${node._id}`,
        from: centerLayoutId,
        to: nodeId,
        color: [0.70, 0.80, 0.90, 0.48],
        lineVariant: 'center-parent-route',
        glowOpacity: 0.18,
        lineOpacity: 0.22,
        innerGlowOpacity: 0.1,
        glowWidth: 4.4,
        lineWidth: 1.2,
        drawOrder: -1
      });
    });

    // 子域节点：中心向下按 2 / 3 / 2 交替展开，单行最多三个。
    const childRadius = clampLayoutValue(relationRadius * 0.9, 32, 46);
    const childPositions = this.buildDetailProjectionPositions(centerX, centerY, childNodes.length, 1, {
      hexStep,
      firstDistance: hexStep * 1.48,
      rowGap: hexStep * 1.42,
      columnGap: hexStep * 1.62
    });

    childNodes.forEach((node, index) => {
      const slotPosition = childPositions[index] || { x: centerX, y: centerY + hexStep * 1.48 };

      const nodeId = `child-${node._id}`;

      layout.nodes.push({
        id: nodeId,
        x: slotPosition.x,
        y: slotPosition.y,
        radius: childRadius,
        scale: 1,
        opacity: 1,
        type: 'child',
        label: this.resolveNodeLabel(node),
        visualStyle: node.visualStyle || null,
        labelColor: node.visualStyle?.textColor || '',
        data: node,
        labelMaxWidthStrategy: 'compact',
        shapeMorph: 0,
        drawOrder: 3,
        visible: true
      });

      // 添加连线
      layout.lines.push({
        id: `sense-child-${centerNode._id}-${node._id}`,
        from: centerLayoutId,
        to: nodeId,
        color: [0.68, 0.78, 0.88, 0.44],
        lineVariant: 'center-child-route',
        glowOpacity: 0.16,
        lineOpacity: 0.2,
        innerGlowOpacity: 0.09,
        glowWidth: 4,
        lineWidth: 1.1,
        drawOrder: -1
      });
    });

    return layout;
  }

  /**
   * 标题主视角布局
   * 中央标题 + 父/子标题蜂窝 + 右侧所属释义投影簇
   */
  calculateTitleDetailLayout(centerNode, graphNodes = [], graphEdges = [], levelByNodeId = {}) {
    const layout = {
      nodes: [],
      lines: []
    };
    if (!centerNode?._id) return layout;

    const metrics = this.getViewportContentMetrics();
    const { centerX, centerY } = metrics;
    const centerId = String(centerNode._id);
    const centerLayoutId = `center-${centerId}`;
    const ringNodes = (Array.isArray(graphNodes) ? graphNodes : [])
      .filter((item) => String(item?._id || '') !== centerId);

    const minContentSide = Math.max(320, Math.min(metrics.availableWidth, metrics.availableHeight));
    const centerRadius = clampLayoutValue(minContentSide * 0.105, 62, 82);
    const relationRadius = clampLayoutValue(centerRadius * 0.62, 34, 52);
    const hexStep = clampLayoutValue(centerRadius * 1.02, 66, 86);
    const titleSenses = this.normalizeTitleSenseList(centerNode);
    const maxSenseChainHeight = Math.max(116, metrics.availableHeight * 0.46);
    const senseRadiusByCount = titleSenses.length > 1
      ? maxSenseChainHeight / (2 + (titleSenses.length - 1) * 1.48)
      : centerRadius * 0.52;
    const senseRadius = clampLayoutValue(
      Math.min(centerRadius * 0.5, senseRadiusByCount),
      23,
      40
    );
    const senseStepY = senseRadius * 1.48;
    const senseStepX = Math.min(14, senseRadius * 0.26);
    const senseChainHeight = Math.max(0, titleSenses.length - 1) * senseStepY;
    const senseChainWidth = Math.max(0, titleSenses.length - 1) * senseStepX;
    const senseHorizontalOffset = Math.min(360, Math.max(190, metrics.availableWidth * 0.26));
    const senseVerticalOffset = Math.min(24, Math.max(0, metrics.availableHeight * 0.014));
    const senseMinX = metrics.left + senseRadius + 22;
    const senseMaxX = Math.max(
      senseMinX,
      this.width - metrics.right - senseRadius - 22 - senseChainWidth
    );
    const senseMinY = metrics.top + senseRadius + 22 + senseChainHeight / 2;
    const senseMaxY = Math.max(
      senseMinY,
      this.height - metrics.bottom - senseRadius - 22 - senseChainHeight / 2
    );
    const senseClusterX = clampLayoutValue(
      centerX + senseHorizontalOffset,
      senseMinX,
      senseMaxX
    );
    const senseClusterY = clampLayoutValue(
      centerY - senseVerticalOffset,
      senseMinY,
      senseMaxY
    );
    const senseStartX = senseClusterX - senseChainWidth / 2;
    const senseStartY = senseClusterY - senseChainHeight / 2;
    const directRelationByNodeId = new Map();
    const addRelationScore = (nodeId, role, edge, score = 1) => {
      if (!nodeId || nodeId === centerId) return;
      const entry = directRelationByNodeId.get(nodeId) || {
        parentScore: 0,
        childScore: 0,
        edge: null
      };
      if (role === 'parent') {
        entry.parentScore += Math.max(1, Number(score) || 1);
      } else if (role === 'child') {
        entry.childScore += Math.max(1, Number(score) || 1);
      }
      if (edge && !entry.edge) {
        entry.edge = edge;
      }
      directRelationByNodeId.set(nodeId, entry);
    };

    (Array.isArray(graphEdges) ? graphEdges : []).forEach((edge) => {
      const nodeAId = String(edge?.nodeAId || '');
      const nodeBId = String(edge?.nodeBId || '');
      const directNeighborId = nodeAId === centerId
        ? nodeBId
        : (nodeBId === centerId ? nodeAId : '');
      if (!directNeighborId) return;

      let scoredFromPairs = false;
      (Array.isArray(edge?.pairs) ? edge.pairs : []).forEach((pair) => {
        const sourceNodeId = String(pair?.sourceNodeId || '');
        const targetNodeId = String(pair?.targetNodeId || '');
        const relationType = String(pair?.relationType || '');
        let neighborId = '';
        let role = '';

        if (sourceNodeId === centerId && targetNodeId) {
          neighborId = targetNodeId;
          role = relationType === 'extends'
            ? 'parent'
            : (relationType === 'contains' ? 'child' : '');
        } else if (targetNodeId === centerId && sourceNodeId) {
          neighborId = sourceNodeId;
          role = relationType === 'contains'
            ? 'parent'
            : (relationType === 'extends' ? 'child' : '');
        }

        if (neighborId && neighborId === directNeighborId && role) {
          scoredFromPairs = true;
          addRelationScore(neighborId, role, edge, 1);
        }
      });

      if (!scoredFromPairs) {
        addRelationScore(
          directNeighborId,
          'child',
          edge,
          Number(edge?.pairCount) || Number(edge?.containsCount) || Number(edge?.extendsCount) || 1
        );
      }
    });

    const parentEntries = [];
    const childEntries = [];

    ringNodes.forEach((node) => {
      const nodeId = String(node?._id || '');
      if (!nodeId) return;
      const relationEntry = directRelationByNodeId.get(nodeId) || null;
      const rawLevel = Number(levelByNodeId?.[nodeId]);
      const resolvedLevel = Number.isFinite(rawLevel) && rawLevel > 0 ? Math.floor(rawLevel) : 1;
      const entry = {
        node,
        edge: relationEntry?.edge || null,
        level: resolvedLevel,
        score: Math.max(relationEntry?.parentScore || 0, relationEntry?.childScore || 0)
      };
      if (relationEntry && relationEntry.parentScore > relationEntry.childScore) {
        parentEntries.push(entry);
      } else {
        childEntries.push(entry);
      }
    });

    const sortTitleEntries = (left, right) => (
      right.score - left.score
      || left.level - right.level
      || String(left.node?.name || '').localeCompare(String(right.node?.name || ''), 'zh-Hans-CN')
    );
    parentEntries.sort(sortTitleEntries);
    childEntries.sort(sortTitleEntries);
    const centerTitleLabel = this.resolveNodeLabel(centerNode, { includeSense: false });

    layout.nodes.push({
      id: centerLayoutId,
      x: centerX,
      y: centerY,
      radius: centerRadius,
      scale: 1,
      opacity: 1,
      type: 'center',
      label: centerTitleLabel,
      visualStyle: centerNode.visualStyle || null,
      labelColor: centerNode.visualStyle?.textColor || '',
      data: {
        ...centerNode,
        graphLevel: 0
      },
      labelTitleLines: centerTitleLabel ? [centerTitleLabel] : null,
      labelSenseLines: null,
      labelLineClamp: 1,
      labelSenseLineClamp: 1,
      shapeMorph: 0,
      drawOrder: 8,
      visible: true
    });

    const parentPositions = this.buildDetailProjectionPositions(centerX, centerY, parentEntries.length, -1, {
      hexStep,
      firstDistance: hexStep * 1.48,
      rowGap: hexStep * 1.42,
      columnGap: hexStep * 1.62
    });
    parentEntries.forEach((entry, index) => {
      const node = entry.node;
      const slotPosition = parentPositions[index] || { x: centerX, y: centerY - hexStep * 1.48 };
      const nodeId = String(node?._id || '');
      const layoutId = `parent-${nodeId}`;

      layout.nodes.push({
        id: layoutId,
        x: slotPosition.x,
        y: slotPosition.y,
        radius: relationRadius,
        scale: 1,
        opacity: 1,
        type: 'parent',
        label: this.resolveNodeLabel(node, { includeSense: false }),
        visualStyle: node.visualStyle || null,
        labelColor: node.visualStyle?.textColor || '',
        data: {
          ...node,
          graphLevel: entry.level,
          titleRelationRole: 'parent'
        },
        labelMaxWidthStrategy: 'compact',
        labelLineClamp: 1,
        labelSenseLineClamp: 1,
        shapeMorph: 0,
        drawOrder: 4,
        visible: true
      });

      layout.lines.push({
        id: `title-parent-${centerId}-${nodeId}`,
        from: centerLayoutId,
        to: layoutId,
        color: [0.70, 0.80, 0.90, 0.48],
        lineVariant: 'center-parent-route',
        glowOpacity: 0.18,
        lineOpacity: 0.22,
        innerGlowOpacity: 0.1,
        glowWidth: 4.4,
        lineWidth: 1.2,
        drawOrder: -1,
        clickable: !!entry.edge,
        edgeMeta: entry.edge || null
      });
    });

    const childRadius = clampLayoutValue(relationRadius * 0.9, 32, 46);
    const childPositions = this.buildDetailProjectionPositions(centerX, centerY, childEntries.length, 1, {
      hexStep,
      firstDistance: hexStep * 1.48,
      rowGap: hexStep * 1.42,
      columnGap: hexStep * 1.62
    });
    childEntries.forEach((entry, index) => {
      const node = entry.node;
      const slotPosition = childPositions[index] || { x: centerX, y: centerY + hexStep * 1.48 };
      const nodeId = String(node?._id || '');
      const layoutId = `child-${nodeId}`;

      layout.nodes.push({
        id: layoutId,
        x: slotPosition.x,
        y: slotPosition.y,
        radius: childRadius,
        scale: 1,
        opacity: 1,
        type: 'child',
        label: this.resolveNodeLabel(node, { includeSense: false }),
        visualStyle: node.visualStyle || null,
        labelColor: node.visualStyle?.textColor || '',
        data: {
          ...node,
          graphLevel: entry.level,
          titleRelationRole: 'child'
        },
        labelMaxWidthStrategy: 'compact',
        labelLineClamp: 1,
        labelSenseLineClamp: 1,
        shapeMorph: 0,
        drawOrder: 3,
        visible: true
      });

      layout.lines.push({
        id: `title-child-${centerId}-${nodeId}`,
        from: centerLayoutId,
        to: layoutId,
        color: [0.68, 0.78, 0.88, 0.44],
        lineVariant: 'center-child-route',
        glowOpacity: 0.16,
        lineOpacity: 0.2,
        innerGlowOpacity: 0.09,
        glowWidth: 4,
        lineWidth: 1.1,
        drawOrder: -1,
        clickable: !!entry.edge,
        edgeMeta: entry.edge || null
      });
    });

    const titleSenseNodeIds = [];
    titleSenses.forEach((sense, index) => {
      const senseNodeId = `title-sense-${centerId}-${sense.senseId}`;
      titleSenseNodeIds.push(senseNodeId);
      const senseX = senseStartX + index * senseStepX;
      const senseY = senseStartY + index * senseStepY;
      const senseData = {
        ...centerNode,
        activeSenseId: sense.senseId,
        activeSenseTitle: sense.title,
        activeSenseContent: sense.content || '',
        displayName: `${centerNode.name || ''}-${sense.title}`,
        detailRole: 'title-sense',
        senseChainIndex: index
      };
      layout.nodes.push({
        id: senseNodeId,
        x: senseX,
        y: senseY,
        radius: senseRadius,
        scale: 1,
        opacity: 0.96,
        type: 'sense',
        label: `${sense.title}\n所属释义`,
        visualStyle: centerNode.visualStyle || null,
        labelColor: centerNode.visualStyle?.textColor || '',
        data: senseData,
        labelMaxWidthStrategy: 'wide',
        labelWidthHint: Math.max(118, Math.min(metrics.availableWidth * 0.28, senseRadius * 4.7)),
        labelTitleLines: [sense.title],
        labelSenseLines: ['所属释义'],
        labelLineClamp: 2,
        labelSenseLineClamp: 1,
        shapeMorph: 0,
        drawOrder: 7,
        visible: true
      });
    });

    if (titleSenseNodeIds.length > 0) {
      const middleSenseNodeId = titleSenseNodeIds[Math.floor((titleSenseNodeIds.length - 1) / 2)];
      layout.lines.push({
        id: `title-sense-projection-${centerId}`,
        from: centerLayoutId,
        to: middleSenseNodeId,
        color: [0.76, 0.86, 0.96, 0.64],
        beamColor: [0.62, 0.78, 0.94, 1],
        lineVariant: 'sense-anchor-beam',
        beamTargetNodeIds: titleSenseNodeIds,
        glowOpacity: 0.38,
        lineOpacity: 0.28,
        innerGlowOpacity: 0.18,
        glowWidth: 8,
        lineWidth: 1.6,
        beamSpreadPx: Math.max(12, senseRadius * 0.48),
        beamFillOpacity: 0.2,
        beamCoreWidth: 4.8,
        beamBlurPx: 22,
        railWidth: 1.1,
        railOpacity: 0.3,
        curveOffset: 0,
        curveBias: 0.5,
        capStrength: 0.8,
        drawOrder: -2
      });
    }

    return layout;
  }

  /**
   * 星盘模式布局
   * 这里单独抽一层，而不是篡改普通 detail layout，避免主视图语义被污染。
   */
  calculateStarMapLayout(graph = {}, options = {}) {
    const layer = options?.layer === STAR_MAP_LAYER.SENSE ? STAR_MAP_LAYER.SENSE : STAR_MAP_LAYER.TITLE;
    const centerNode = graph?.centerNode || null;
    const centerKey = getStarMapCenterKey(graph, layer);
    if (!centerNode || !centerKey) {
      return { nodes: [], lines: [] };
    }

    const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
    const boundaryStubs = Array.isArray(graph?.boundaryStubs) ? graph.boundaryStubs : [];
    const layoutLevelByKey = buildStarMapShortestHopLevels(graph, layer);

    const layout = {
      nodes: [],
      lines: []
    };
    const { centerX, centerY } = this.getViewportFocusCenter();
    const nodeLayoutIdByKey = new Map();
    const layoutNodeByKey = new Map();
    const labelMetricsByKey = new Map();
    const levelGroups = new Map();
    const graphMeta = buildStarMapGraphMeta(graph, layer, layoutLevelByKey);
    const sortedGraphNodes = graphNodes.slice().sort((left, right) => {
      const leftLevel = Number(layoutLevelByKey?.[getStarMapNodeKey(left, layer)] || 0);
      const rightLevel = Number(layoutLevelByKey?.[getStarMapNodeKey(right, layer)] || 0);
      return (
        leftLevel - rightLevel
        || String(left?.displayName || left?.name || '').localeCompare(String(right?.displayName || right?.name || ''), 'zh-Hans-CN')
      );
    });

    const centerLayoutId = `center-${centerKey}`;
    const centerLabelMetrics = estimateStarMapLabelMetrics(
      this.resolveNodeLabel(centerNode, { includeSense: layer !== STAR_MAP_LAYER.TITLE })
    );
    labelMetricsByKey.set(centerKey, centerLabelMetrics);
    const centerRadius = Math.max(32, Math.min(42, Math.min(this.width, this.height) * 0.04));
    sortedGraphNodes.forEach((node) => {
      const key = getStarMapNodeKey(node, layer);
      if (!key || key === centerKey) return;
      const nodeLabel = this.resolveNodeLabel(node, { includeSense: layer !== STAR_MAP_LAYER.TITLE });
      const labelMetrics = estimateStarMapLabelMetrics(nodeLabel);
      labelMetricsByKey.set(key, labelMetrics);
      const rawLevel = Number(layoutLevelByKey?.[key] || 1);
      const level = Number.isFinite(rawLevel) && rawLevel > 0 ? Math.floor(rawLevel) : 1;
      const group = levelGroups.get(level) || [];
      const baseNodeRadius = layer === STAR_MAP_LAYER.TITLE ? 28 : 25.5;
      const nodeRadius = Math.max(19, baseNodeRadius - Math.min(4, level - 1) * 0.72);
      const labelOffsetY = 0;
      const nodeType = layer === STAR_MAP_LAYER.TITLE ? 'title' : 'sense';
      group.push({
        key,
        level,
        rawNode: node,
        label: nodeLabel,
        labelMetrics,
        radius: nodeRadius,
        labelOffsetY,
        labelPlacement: 'center',
        nodeType
      });
      levelGroups.set(level, group);
    });

    const levels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
    // 星盘节点改为 rooted DAG radial layered layout：
    // 先做 shortest-hop 分层，再做层内降交叉排序，最后映射到同心层并做局部去重叠。
    const layoutKey = this.buildStarMapLayoutKey(graph, layer);
    const { levelByKey, bodyByKey, badgeBodyByStubId, bounds, debug } = radialDagLayout({
      width: this.width,
      height: this.height,
      center: {
        x: centerX,
        y: centerY,
        radius: centerRadius,
        width: this.width,
        height: this.height,
        labelWidthHint: centerLabelMetrics.widthHint,
        labelHeightHint: centerLabelMetrics.heightHint,
        labelMetrics: centerLabelMetrics,
        rawNode: centerNode,
        labelOffsetY: 0,
        labelPlacement: 'center'
      },
      centerKey,
      layer,
      levels,
      nodesByLevel: levelGroups,
      graphEdges,
      graphMeta,
      labelMetricsByKey,
      boundaryStubs
    });
    const positionedCenterBody = bodyByKey.get(centerKey);
    const centerRing = Number(levelByKey?.[centerKey] || positionedCenterBody?.level || 0);
    const centerConfig = {
      id: centerLayoutId,
      x: positionedCenterBody?.x ?? centerX,
      y: positionedCenterBody?.y ?? centerY,
      radius: centerRadius,
      scale: 1,
      opacity: 1,
      type: 'center',
      label: this.resolveNodeLabel(centerNode, { includeSense: layer !== STAR_MAP_LAYER.TITLE }),
      visualStyle: centerNode.visualStyle || null,
      labelColor: centerNode.visualStyle?.textColor || '',
      labelPlacement: 'center',
      labelOffsetY: positionedCenterBody?.labelOffsetY ?? 0,
      labelVisible: true,
      labelMaxWidthStrategy: 'default',
      labelWidthHint: centerLabelMetrics.widthHint,
      labelHeightHint: centerLabelMetrics.heightHint,
      labelLineClamp: centerLabelMetrics.titleLineClamp || 2,
      labelSenseLineClamp: centerLabelMetrics.senseLineClamp || 1,
      labelTitleLines: centerLabelMetrics.titleLines || [],
      labelSenseLines: centerLabelMetrics.senseLines || [],
      labelTitleWidthHint: centerLabelMetrics.titleWidthHint || centerLabelMetrics.widthHint,
      labelSenseWidthHint: centerLabelMetrics.senseWidthHint || 0,
      data: {
        ...centerNode,
        starMapLayer: layer,
        starMapLevel: centerRing,
        starMapAngle: positionedCenterBody?.angle,
        starMapSubtreeWeight: positionedCenterBody?.subtreeWeight,
        starMapClusterSignature: positionedCenterBody?.clusterSignature || centerKey,
        starMapImportance: positionedCenterBody?.importance || 1.28
      },
      visible: true
    };
    layout.nodes.push(centerConfig);
    nodeLayoutIdByKey.set(centerKey, centerLayoutId);
    layoutNodeByKey.set(centerKey, {
      ...centerConfig,
      angle: positionedCenterBody?.angle,
      nodeKey: centerKey,
      starMapLevel: centerRing,
      clusterSignature: positionedCenterBody?.clusterSignature || centerKey,
      primaryParentKey: positionedCenterBody?.primaryParentKey || '',
      childCount: positionedCenterBody?.childCount || 0,
      degree: positionedCenterBody?.degree || graphMeta?.adjacency?.get?.(centerKey)?.size || 0,
      importance: positionedCenterBody?.importance || 1.28,
      siblingIndex: positionedCenterBody?.siblingIndex || 0,
      siblingCount: positionedCenterBody?.siblingCount || 0
    });
    levels.forEach((level) => {
      const nodes = levelGroups.get(level) || [];
      nodes.forEach((node) => {
        const positionedBody = bodyByKey.get(node.key);
        if (!positionedBody) return;
        const resolvedLevel = Number(levelByKey?.[node.key] || positionedBody.level || level);
        const layoutId = `${layer}-${node.key}`;
        const config = {
          id: layoutId,
          x: positionedBody.x,
          y: positionedBody.y,
          radius: positionedBody.radius,
          scale: 1,
          opacity: 1,
          type: node.nodeType,
          label: node.label,
          visualStyle: node.rawNode.visualStyle || null,
          labelColor: node.rawNode.visualStyle?.textColor || '',
          labelPlacement: 'center',
          labelOffsetY: positionedBody.labelOffsetY,
          labelVisible: true,
          labelMaxWidthStrategy: 'default',
          labelWidthHint: positionedBody.labelMetrics.widthHint,
          labelHeightHint: positionedBody.labelMetrics.heightHint,
          labelLineClamp: positionedBody.labelMetrics.titleLineClamp || 2,
          labelSenseLineClamp: positionedBody.labelMetrics.senseLineClamp || 1,
          labelTitleLines: positionedBody.labelMetrics.titleLines || [],
          labelSenseLines: positionedBody.labelMetrics.senseLines || [],
          labelTitleWidthHint: positionedBody.labelMetrics.titleWidthHint || positionedBody.labelMetrics.widthHint,
          labelSenseWidthHint: positionedBody.labelMetrics.senseWidthHint || 0,
          data: {
            ...node.rawNode,
            starMapLayer: layer,
            starMapLevel: resolvedLevel,
            starMapAngle: positionedBody.angle,
            starMapSubtreeWeight: positionedBody.subtreeWeight,
            starMapClusterSignature: positionedBody.clusterSignature,
            starMapImportance: positionedBody.importance
          },
          visible: true
        };
        layout.nodes.push(config);
        nodeLayoutIdByKey.set(node.key, layoutId);
        layoutNodeByKey.set(node.key, {
          ...config,
          angle: positionedBody.angle,
          starMapLevel: resolvedLevel,
          clusterSignature: positionedBody.clusterSignature,
          nodeKey: positionedBody.nodeKey || node.key,
          primaryParentKey: positionedBody.primaryParentKey || '',
          childCount: positionedBody.childCount || 0,
          degree: positionedBody.degree || 0,
          importance: positionedBody.importance || 1,
          siblingIndex: positionedBody.siblingIndex || 0,
          siblingCount: positionedBody.siblingCount || 0
        });
      });
    });

    graphEdges.forEach((edge) => {
      const fromKey = layer === STAR_MAP_LAYER.SENSE
        ? String(edge?.fromVertexKey || '')
        : String(edge?.nodeAId || '');
      const toKey = layer === STAR_MAP_LAYER.SENSE
        ? String(edge?.toVertexKey || '')
        : String(edge?.nodeBId || '');
      const from = nodeLayoutIdByKey.get(fromKey);
      const to = nodeLayoutIdByKey.get(toKey);
      if (!from || !to) return;
      const fromNode = layoutNodeByKey.get(fromKey);
      const toNode = layoutNodeByKey.get(toKey);
      const dominantColor = buildStarMapEdgeColor({
        layer,
        fromNode,
        toNode,
        edge
      });
      const lineVisual = buildStarMapLineVisual({
        line: edge,
        fromNode,
        toNode,
        fromLevel: Number(levelByKey?.[fromKey] || 0),
        toLevel: Number(levelByKey?.[toKey] || 0),
        centerX,
        centerY,
        layer
      });
      layout.lines.push({
        id: edge?.edgeId || `${fromKey}|${toKey}`,
        from,
        to,
        color: dominantColor,
        edgeMeta: edge,
        clickable: false,
        ...lineVisual
      });
    });

    boundaryStubs.forEach((stub, index) => {
      const sourceKey = layer === STAR_MAP_LAYER.SENSE
        ? String(stub?.sourceVertexKey || '')
        : String(stub?.sourceNodeId || '');
      const sourceNode = layoutNodeByKey.get(sourceKey);
      const sourceLayoutId = nodeLayoutIdByKey.get(sourceKey);
      if (!sourceNode || !sourceLayoutId) return;
      const stubId = String(stub?.stubId || `${sourceKey}:${index}`);
      const badgeBody = badgeBodyByStubId?.get?.(stubId);
      const hiddenCount = Math.max(0, Number(stub?.hiddenNeighborCount) || 0);
      if (badgeBody && hiddenCount > 0) {
        const badgeLayoutId = `stub-badge-${stubId}`;
        layout.nodes.push({
          id: badgeLayoutId,
          x: sourceNode.x,
          y: sourceNode.y,
          radius: Math.max(0, Number(badgeBody.radius) || 0),
          scale: 1,
          opacity: 0,
          type: 'stub-badge',
          label: badgeBody.label || `+${hiddenCount}`,
          labelPlacement: 'center',
          labelOffsetY: 0,
          labelVisible: false,
          labelWidthHint: badgeBody.labelWidthHint || 24,
          labelHeightHint: badgeBody.labelHeightHint || 18,
          data: {
            starMapLayer: layer,
            isStubBadge: true,
            stubId,
            sourceNodeId: sourceLayoutId,
            sourceNodeKey: sourceKey
          },
          visible: true
        });
        return;
      }

      let dirX = sourceNode.x - centerX;
      let dirY = sourceNode.y - centerY;
      const neighborKeys = Array.from(graphMeta.adjacency.get(sourceKey) || []);
      if (neighborKeys.length > 0) {
        const averageNeighbor = neighborKeys.reduce((accumulator, key) => {
          const node = layoutNodeByKey.get(key);
          if (!node) return accumulator;
          accumulator.x += sourceNode.x - node.x;
          accumulator.y += sourceNode.y - node.y;
          return accumulator;
        }, { x: 0, y: 0 });
        if (Math.hypot(averageNeighbor.x, averageNeighbor.y) > 0.001) {
          dirX = averageNeighbor.x;
          dirY = averageNeighbor.y;
        }
      }
      const length = Math.hypot(dirX, dirY);
      if (length <= 0.001) {
        const angle = -Math.PI / 2 + index * (Math.PI / Math.max(1, boundaryStubs.length));
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      } else {
        dirX /= length;
        dirY /= length;
      }

      const stubDistance = Math.max(60, Math.min(118, 68 + hiddenCount * 6));
      const anchorId = `stub-anchor-${sourceKey}-${index}`;
      const stubVisual = buildStarMapStubVisual({
        hiddenNeighborCount: hiddenCount,
        sourceLevel: Number(stub?.sourceLevel || 0)
      });
      layout.nodes.push({
        id: anchorId,
        x: sourceNode.x + dirX * stubDistance,
        y: sourceNode.y + dirY * stubDistance,
        radius: 0,
        scale: 1,
        opacity: 0,
        type: 'stub-anchor',
        label: '',
        labelVisible: false,
        data: {
          starMapLayer: layer,
          isStubAnchor: true
        },
        visible: true
      });
      layout.lines.push({
        id: String(stub?.stubId || `${sourceKey}-stub`),
        from: sourceLayoutId,
        to: anchorId,
        color: layer === STAR_MAP_LAYER.TITLE ? [0.66, 0.83, 0.99, 0.42] : [0.73, 0.84, 1, 0.42],
        isStub: true,
        noCaps: true,
        stubCount: hiddenCount,
        stubMeta: stub,
        ...stubVisual
      });
    });

    layout.bounds = bounds;
    layout.meta = {
      type: 'starMap',
      layer,
      layoutKey,
      centerKey,
      nodeCount: layout.nodes.length,
      lineCount: layout.lines.length
    };
    layout.debug = {
      graphMeta: {
        centerKey,
        layer,
        levelCount: levels.length
      },
      sectorPlan: debug?.sectorPlan || null
    };

    return layout;
  }

  refineStarMapLayoutWithMeasuredLabels(layout = {}, measuredLabelBoxes = []) {
    return refineStarMapLayoutWithMeasuredLabels({
      layout,
      measuredLabelBoxes
    });
  }

  /**
   * 计算过渡动画：从当前布局到新布局
   * 处理节点的进入、退出、移动
   */
  calculateTransition(currentLayout, newLayout) {
    const transitions = {
      enter: [],      // 新出现的节点 (淡入 + 缩放)
      exit: [],       // 要消失的节点 (淡出 + 缩小)
      move: [],       // 移动的节点 (位置变化)
      stay: []        // 保持的节点
    };

    const currentIds = new Set(currentLayout.nodes.map(n => n.id));
    const newIds = new Set(newLayout.nodes.map(n => n.id));

    // 查找退出的节点
    for (const node of currentLayout.nodes) {
      if (!newIds.has(node.id)) {
        transitions.exit.push({
          id: node.id,
          from: { ...node },
          to: { ...node, scale: 0, opacity: 0 }
        });
      }
    }

    // 查找进入和移动的节点
    for (const node of newLayout.nodes) {
      if (!currentIds.has(node.id)) {
        // 新节点：从缩小+透明状态进入
        transitions.enter.push({
          id: node.id,
          from: { ...node, scale: 0, opacity: 0 },
          to: { ...node }
        });
      } else {
        // 已存在的节点：检查是否移动
        const currentNode = currentLayout.nodes.find(n => n.id === node.id);
        const styleChanged = JSON.stringify(currentNode.visualStyle || null) !== JSON.stringify(node.visualStyle || null)
          || (currentNode.labelColor || '') !== (node.labelColor || '')
          || (currentNode.label || '') !== (node.label || '')
          || (Number(currentNode.shapeMorph) || 0) !== (Number(node.shapeMorph) || 0)
          || (Number(currentNode.drawOrder) || 0) !== (Number(node.drawOrder) || 0);
        const moved = currentNode.x !== node.x || currentNode.y !== node.y ||
                     currentNode.scale !== node.scale || currentNode.radius !== node.radius ||
                     styleChanged;

        if (moved) {
          transitions.move.push({
            id: node.id,
            from: { ...currentNode },
            to: { ...node }
          });
        } else {
          transitions.stay.push({
            id: node.id,
            config: { ...node }
          });
        }
      }
    }

    return transitions;
  }

  /**
   * 特殊过渡：点击节点放大到中心
   * 用于从首页点击节点到节点详情页
   */
  calculateClickTransition(clickedNode, fromLayout, toLayout) {
    // 找到被点击的节点
    const sourceNode = fromLayout.nodes.find(n => n.id === clickedNode.id);
    const targetCenterNode = toLayout.nodes.find(n => n.type === 'center');

    if (!sourceNode || !targetCenterNode) {
      return this.calculateTransition(fromLayout, toLayout);
    }

    const transitions = {
      enter: [],
      exit: [],
      move: [],
      stay: [],
      special: null  // 被点击节点的特殊动画
    };

    // 被点击的节点：特殊处理
    transitions.special = {
      id: sourceNode.id,
      from: { ...sourceNode },
      to: {
        ...targetCenterNode,
        id: sourceNode.id  // 保持ID，后续会重命名
      }
    };

    // 其他节点全部淡出
    for (const node of fromLayout.nodes) {
      if (node.id !== sourceNode.id) {
        transitions.exit.push({
          id: node.id,
          from: { ...node },
          to: { ...node, opacity: 0, scale: node.scale * 0.5 }
        });
      }
    }

    // 新布局的其他节点延迟淡入
    for (const node of toLayout.nodes) {
      if (node.id !== targetCenterNode.id) {
        transitions.enter.push({
          id: node.id,
          from: {
            ...node,
            x: targetCenterNode.x + (Math.random() - 0.5) * 100,
            y: targetCenterNode.y + (Math.random() - 0.5) * 100,
            scale: 0,
            opacity: 0
          },
          to: { ...node }
        });
      }
    }

    return transitions;
  }

  // ==================== 关联关系预览布局计算 ====================

  /**
   * 计算关联关系预览布局
   * @param {Object} newNodeData - 新节点数据 {name, description}
   * @param {Object} nodeA - 第一个关联节点（包含 parentNodesInfo, childNodesInfo）
   * @param {string} relationType - 'extends' | 'contains' | 'insert'
   * @param {Object} nodeB - 第二个关联节点（仅 insert 模式，包含 node 和 direction）
   * @param {Object} currentLayout - 当前布局
   * @returns {Object} 预览布局配置
   */
  calculateAssociationPreviewLayout(newNodeData, nodeA, relationType, nodeB, currentLayout) {
    const { centerX, centerY } = this.getViewportFocusCenter();

    // 找到 nodeA 在当前布局中的位置
    const nodeAInLayout = currentLayout.nodes.find(
      n => n.data && n.data._id === nodeA._id
    );

    // 如果找不到 nodeA，使用中心位置
    const nodeAPosition = nodeAInLayout
      ? { x: nodeAInLayout.x, y: nodeAInLayout.y }
      : { x: centerX, y: centerY };

    // 根据关系类型计算预览布局
    if (relationType === 'insert' && nodeB) {
      return this.calculateInsertPreviewLayout(newNodeData, nodeA, nodeB, currentLayout, nodeAPosition);
    } else {
      return this.calculateSimplePreviewLayout(newNodeData, nodeA, relationType, currentLayout, nodeAPosition);
    }
  }

  /**
   * 计算简单关联预览布局（新节点直接作为 nodeA 的母域或子域）
   */
  calculateSimplePreviewLayout(newNodeData, nodeA, relationType, currentLayout, nodeAPosition) {
    const result = {
      movements: [],
      previewNode: null,
      previewLines: []
    };

    const distance = 150;
    const previewRadius = 45;

    // 确定新节点位置
    let previewX, previewY;
    let lineColor;

    if (relationType === 'extends') {
      // 新节点作为 nodeA 的母域（上方）
      // 需要检查 nodeA 已有的母域节点数量来确定位置
      const existingParentCount = nodeA.parentNodesInfo?.length || 0;
      const angle = Math.PI + (Math.PI / (existingParentCount + 2)) * (existingParentCount + 1);

      previewX = nodeAPosition.x + Math.cos(angle) * distance;
      previewY = nodeAPosition.y + Math.sin(angle) * distance;
      lineColor = [0.06, 0.73, 0.51, 0.8]; // 绿色（母域连线）

      // 如果有现有母域节点，需要移动它们以腾出空间
      if (existingParentCount > 0 && currentLayout.nodes) {
        const parentNodes = currentLayout.nodes.filter(n => n.type === 'parent');
        const totalParents = existingParentCount + 1;

        parentNodes.forEach((node, index) => {
          const newAngle = Math.PI + (Math.PI / (totalParents + 1)) * (index + 1);
          const newX = nodeAPosition.x + Math.cos(newAngle) * distance;
          const newY = nodeAPosition.y + Math.sin(newAngle) * distance;

          if (Math.abs(node.x - newX) > 5 || Math.abs(node.y - newY) > 5) {
            result.movements.push({
              id: node.id,
              x: newX,
              y: newY
            });
          }
        });
      }
    } else {
      // 新节点作为 nodeA 的子域（下方）
      const existingChildCount = nodeA.childNodesInfo?.length || 0;
      const angle = (Math.PI / (existingChildCount + 2)) * (existingChildCount + 1);

      previewX = nodeAPosition.x + Math.cos(angle) * distance;
      previewY = nodeAPosition.y + Math.sin(angle) * distance;
      lineColor = [0.98, 0.75, 0.14, 0.8]; // 黄色（子域连线）

      // 如果有现有子域节点，需要移动它们以腾出空间
      if (existingChildCount > 0 && currentLayout.nodes) {
        const childNodes = currentLayout.nodes.filter(n => n.type === 'child');
        const totalChildren = existingChildCount + 1;

        childNodes.forEach((node, index) => {
          const newAngle = (Math.PI / (totalChildren + 1)) * (index + 1);
          const newX = nodeAPosition.x + Math.cos(newAngle) * distance;
          const newY = nodeAPosition.y + Math.sin(newAngle) * distance;

          if (Math.abs(node.x - newX) > 5 || Math.abs(node.y - newY) > 5) {
            result.movements.push({
              id: node.id,
              x: newX,
              y: newY
            });
          }
        });
      }
    }

    // 设置预览节点
    result.previewNode = {
      x: previewX,
      y: previewY,
      radius: previewRadius,
      scale: 1,
      opacity: 0.75,
      label: newNodeData.name || '新节点',
      visible: true
    };

    // 设置预览连线（从 nodeA 到新节点）
    const nodeAId = currentLayout.nodes.find(n => n.data && n.data._id === nodeA._id)?.id;
    if (nodeAId) {
      result.previewLines.push({
        from: nodeAId,
        to: 'preview-new-node',
        color: lineColor,
        isDashed: true,
        isNew: true
      });
    }

    return result;
  }

  /**
   * 计算插入预览布局（新节点插入到 A 和 B 之间）
   */
  calculateInsertPreviewLayout(newNodeData, nodeA, nodeBConfig, currentLayout, nodeAPosition) {
    const nodeB = nodeBConfig.node;
    const direction = nodeBConfig.direction; // 'aToB' 或 'bToA'

    const result = {
      movements: [],
      previewNode: null,
      previewLines: []
    };

    // 找到 nodeB 在当前布局中的位置
    const nodeBInLayout = currentLayout.nodes.find(
      n => n.data && n.data._id === nodeB._id
    );

    if (!nodeBInLayout) {
      // 如果找不到 nodeB，回退到简单布局
      return this.calculateSimplePreviewLayout(
        newNodeData,
        nodeA,
        direction === 'aToB' ? 'contains' : 'extends',
        currentLayout,
        nodeAPosition
      );
    }

    const nodeBPosition = { x: nodeBInLayout.x, y: nodeBInLayout.y };

    // 计算新节点位置（在 A 和 B 中间）
    const midX = (nodeAPosition.x + nodeBPosition.x) / 2;
    const midY = (nodeAPosition.y + nodeBPosition.y) / 2;

    // 稍微偏移以避免完全重叠
    const dx = nodeBPosition.x - nodeAPosition.x;
    const dy = nodeBPosition.y - nodeAPosition.y;
    const perpX = -dy * 0.15; // 垂直偏移
    const perpY = dx * 0.15;

    const previewX = midX + perpX;
    const previewY = midY + perpY;

    // 设置预览节点
    result.previewNode = {
      x: previewX,
      y: previewY,
      radius: 45,
      scale: 1,
      opacity: 0.75,
      label: newNodeData.name || '新节点',
      visible: true
    };

    // 获取节点 ID
    const nodeALayoutNode = currentLayout.nodes.find(n => n.data && n.data._id === nodeA._id);
    const nodeAId = nodeALayoutNode?.id;
    const nodeBId = nodeBInLayout.id;

    if (!nodeAId || !nodeBId) {
      return result;
    }

    // 确定连线方向和颜色
    // aToB: 新节点是 A 的子域，B 的母域
    // bToA: 新节点是 B 的子域，A 的母域
    const parentLineColor = [0.06, 0.73, 0.51, 0.8]; // 绿色
    const childLineColor = [0.98, 0.75, 0.14, 0.8];  // 黄色

    if (direction === 'aToB') {
      // 新节点是 A 的子域 -> A 到新节点用黄线
      // 新节点是 B 的母域 -> 新节点到 B 用绿线
      result.previewLines.push({
        from: nodeAId,
        to: 'preview-new-node',
        color: childLineColor,
        isDashed: true,
        isNew: true
      });
      result.previewLines.push({
        from: 'preview-new-node',
        to: nodeBId,
        color: parentLineColor,
        isDashed: true,
        isNew: true
      });
    } else {
      // 新节点是 B 的子域 -> B 到新节点用黄线
      // 新节点是 A 的母域 -> 新节点到 A 用绿线
      result.previewLines.push({
        from: nodeBId,
        to: 'preview-new-node',
        color: childLineColor,
        isDashed: true,
        isNew: true
      });
      result.previewLines.push({
        from: 'preview-new-node',
        to: nodeAId,
        color: parentLineColor,
        isDashed: true,
        isNew: true
      });
    }

    // 标记原有的 A-B 连线为移除状态
    const existingLine = currentLayout.lines.find(
      l => (l.from === nodeAId && l.to === nodeBId) || (l.from === nodeBId && l.to === nodeAId)
    );

    if (existingLine) {
      result.previewLines.push({
        from: existingLine.from,
        to: existingLine.to,
        color: existingLine.color,
        isRemoved: true
      });
    }

    // 计算需要移动的节点（为新节点腾出空间）
    // 将中间区域的节点稍微外移
    const pushDistance = 30;
    for (const node of currentLayout.nodes) {
      if (node.id === nodeAId || node.id === nodeBId) continue;
      if (!node.visible) continue;

      const distToPreview = Math.sqrt(
        Math.pow(node.x - previewX, 2) + Math.pow(node.y - previewY, 2)
      );

      // 如果节点太靠近预览位置，将其推开
      if (distToPreview < 100) {
        const angle = Math.atan2(node.y - previewY, node.x - previewX);
        result.movements.push({
          id: node.id,
          x: node.x + Math.cos(angle) * pushDistance,
          y: node.y + Math.sin(angle) * pushDistance
        });
      }
    }

    return result;
  }

  /**
   * 获取节点的候选关联节点（用于插入选择）
   * @param {Object} nodeA - 选中的节点A
   * @returns {Object} { parents: [], children: [] }
   */
  getCandidateNodesForInsertion(nodeA) {
    // 返回 nodeA 的母域和子域节点
    return {
      parents: nodeA.parentNodesInfo || [],
      children: nodeA.childNodesInfo || []
    };
  }
}

export default LayoutManager;
