/**
 * MiniPreviewRenderer - 迷你预览渲染器
 * 用于在 CreateNodeModal 浮窗内展示关联关系预览动画
 */

class MiniPreviewRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.animationId = null;
    this.startTime = 0;

    // 节点配置
    this.nodes = [];
    this.lines = [];
    this.previewNode = null;

    // 动画状态
    this.animationPhase = 0;
    this.isAnimating = false;
  }

  /**
   * 设置预览场景
   * @param {Object} config - 预览配置
   * @param {Object} config.nodeA - 关联节点 A
   * @param {Object} config.nodeB - 关联节点 B（仅插入模式）
   * @param {string} config.relationType - 关系类型 'extends' | 'contains' | 'insert'
   * @param {string} config.newNodeName - 新节点名称
   * @param {string} config.insertDirection - 插入方向 'aToB' | 'bToA'
   * @param {string} config.nodeALabel - 节点 A 标签（可传标题-释义）
   * @param {string} config.nodeBLabel - 节点 B 标签（可传标题-释义）
   * @param {string} config.newNodeLabel - 当前节点标签（可传标题-释义）
   * @param {boolean} config.showPendingTag - 是否显示“待审核”字样
   */
  setPreviewScene(config) {
    const {
      nodeA,
      nodeB,
      relationType,
      newNodeName,
      insertDirection,
      nodeALabel,
      nodeBLabel,
      newNodeLabel,
      showPendingTag = true
    } = config;

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    const minSize = Math.min(this.canvas.width, this.canvas.height);
    const radius = Math.max(24, Math.floor(minSize * 0.125));
    const distance = Math.max(88, Math.floor(minSize * 0.48));

    this.nodes = [];
    this.lines = [];
    this.previewNode = null;

    if (relationType === 'insert' && nodeB) {
      // 插入模式：三个节点
      this.setupInsertPreview(
        centerX,
        centerY,
        radius,
        distance,
        nodeA,
        nodeB,
        newNodeName,
        insertDirection,
        { nodeALabel, nodeBLabel, newNodeLabel, showPendingTag }
      );
    } else {
      // 简单模式：两个节点
      this.setupSimplePreview(
        centerX,
        centerY,
        radius,
        distance,
        nodeA,
        newNodeName,
        relationType,
        { nodeALabel, newNodeLabel, showPendingTag }
      );
    }

    this.startAnimation();
  }

  /**
   * 设置简单关联预览（母域/子域）
   */
  setupSimplePreview(centerX, centerY, radius, distance, nodeA, newNodeName, relationType, labels = {}) {
    const isExtends = relationType === 'extends';
    const verticalOffset = Math.max(radius + 12, Math.floor(distance * 0.45));
    const nodeAY = centerY + (isExtends ? verticalOffset : -verticalOffset);
    const newNodeY = centerY + (isExtends ? -verticalOffset : verticalOffset);
    const relationFrom = isExtends ? 'newNode' : 'nodeA';
    const relationTo = isExtends ? 'nodeA' : 'newNode';

    // Node A 在中心
    this.nodes.push({
      id: 'nodeA',
      x: centerX,
      y: nodeAY,
      radius: radius,
      label: labels.nodeALabel || nodeA?.name || 'Node A',
      color: '#8b5cf6',
      glowColor: 'rgba(139, 92, 246, 0.3)',
      isExisting: true,
      isBottomLevel: isExtends
    });

    // 新节点
    this.previewNode = {
      id: 'newNode',
      x: centerX,
      y: newNodeY,
      targetX: centerX,
      targetY: newNodeY,
      radius: radius,
      label: labels.newNodeLabel || newNodeName || '新节点',
      color: '#38bdf8',
      glowColor: 'rgba(56, 189, 248, 0.4)',
      isPreview: true,
      opacity: 0,
      scale: 0.5,
      showPendingTag: labels.showPendingTag !== false,
      isBottomLevel: !isExtends
    };

    // 连线：始终从“包含者(上方)”指向“被包含者(下方)”
    this.lines.push({
      from: relationFrom,
      to: relationTo,
      color: isExtends ? '#22c55e' : '#facc15',
      isDashed: true,
      opacity: 0,
      label: isExtends ? '⊇' : '⊆'
    });
  }

  /**
   * 设置插入预览（三节点）
   */
  setupInsertPreview(centerX, centerY, radius, distance, nodeA, nodeB, newNodeName, insertDirection, labels = {}) {
    const isAtoB = insertDirection === 'aToB';
    const verticalOffset = Math.max(radius + 54, Math.floor(distance * 0.82));
    const topNodeId = isAtoB ? 'nodeA' : 'nodeB';
    const bottomNodeId = isAtoB ? 'nodeB' : 'nodeA';

    this.nodes.push({
      id: topNodeId,
      x: centerX,
      y: centerY - verticalOffset,
      radius: radius * 0.9,
      label: isAtoB
        ? (labels.nodeALabel || nodeA?.name || 'Node A')
        : (labels.nodeBLabel || nodeB?.name || 'Node B'),
      color: '#8b5cf6',
      glowColor: 'rgba(139, 92, 246, 0.3)',
      isExisting: true,
      isBottomLevel: false
    });

    this.nodes.push({
      id: bottomNodeId,
      x: centerX,
      y: centerY + verticalOffset,
      radius: radius * 0.9,
      label: isAtoB
        ? (labels.nodeBLabel || nodeB?.name || 'Node B')
        : (labels.nodeALabel || nodeA?.name || 'Node A'),
      color: '#8b5cf6',
      glowColor: 'rgba(139, 92, 246, 0.3)',
      isExisting: true,
      isBottomLevel: true
    });

    // 原有连线（将被移除）
    this.lines.push({
      from: topNodeId,
      to: bottomNodeId,
      color: '#64748b',
      isDashed: false,
      opacity: 1,
      isRemoving: true
    });

    // 新节点
    this.previewNode = {
      id: 'newNode',
      x: centerX + Math.max(70, Math.floor(distance * 0.55)),
      y: centerY,
      targetX: centerX,
      targetY: centerY,
      radius: radius,
      label: labels.newNodeLabel || newNodeName || '新节点',
      color: '#38bdf8',
      glowColor: 'rgba(56, 189, 248, 0.4)',
      isPreview: true,
      opacity: 0,
      scale: 0.5,
      showPendingTag: labels.showPendingTag !== false,
      isBottomLevel: false
    };

    // 新连线 1：上级节点到当前节点
    this.lines.push({
      from: topNodeId,
      to: 'newNode',
      color: '#facc15',
      isDashed: true,
      opacity: 0,
      isNew: true
    });

    // 新连线 2：当前节点到下级节点
    this.lines.push({
      from: 'newNode',
      to: bottomNodeId,
      color: '#22c55e',
      isDashed: true,
      opacity: 0,
      isNew: true
    });
  }

  /**
   * 开始动画
   */
  startAnimation() {
    this.stopAnimation();
    this.isAnimating = true;
    this.startTime = performance.now();
    this.animate();
  }

  /**
   * 停止动画
   */
  stopAnimation() {
    this.isAnimating = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 动画循环
   */
  animate() {
    if (!this.isAnimating) return;

    const elapsed = (performance.now() - this.startTime) / 1000;
    this.animationPhase = elapsed;

    this.updateAnimation(elapsed);
    this.render();

    this.animationId = requestAnimationFrame(() => this.animate());
  }

  /**
   * 更新动画状态
   */
  updateAnimation(elapsed) {
    if (!this.previewNode) return;

    // 新节点入场动画（0-0.8秒）
    const enterProgress = Math.min(1, elapsed / 0.8);
    const easeOut = 1 - Math.pow(1 - enterProgress, 3);

    this.previewNode.opacity = easeOut;
    this.previewNode.scale = 0.5 + 0.5 * easeOut;

    // 位置插值
    const startX = this.previewNode.x;
    const targetX = this.previewNode.targetX;
    this.previewNode.x = startX + (targetX - startX) * easeOut * 0.1;

    // 新连线淡入（0.3-1秒）
    const lineEnterProgress = Math.max(0, Math.min(1, (elapsed - 0.3) / 0.7));
    this.lines.forEach(line => {
      if (line.isNew || line.isDashed) {
        line.opacity = lineEnterProgress;
      }
      if (line.isRemoving) {
        line.opacity = Math.max(0.2, 1 - lineEnterProgress * 0.8);
      }
    });

    // 脉冲效果（持续）
    const pulse = Math.sin(elapsed * 3) * 0.08;
    this.previewNode.pulseScale = 1 + pulse;
    this.previewNode.pulseGlow = 0.4 + Math.abs(pulse) * 2;
  }

  /**
   * 渲染
   */
  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 绘制背景
    const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width/2);
    gradient.addColorStop(0, 'rgba(30, 41, 59, 0.95)');
    gradient.addColorStop(1, 'rgba(15, 23, 42, 0.98)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 先渲染光锥层，保证节点和文字都压在光锥之上
    this.renderHierarchyBeams();

    // 绘制现有节点
    this.nodes.forEach(node => this.renderNode(node));

    // 绘制预览节点
    if (this.previewNode) {
      this.renderPreviewNode(this.previewNode);
    }
  }

  renderHierarchyBeams() {
    const beamNodes = [
      ...this.nodes,
      ...(this.previewNode ? [this.previewNode] : [])
    ]
      .filter((node) => !!node && !node.isBottomLevel)
      .sort((a, b) => (a.y || 0) - (b.y || 0));

    beamNodes.forEach((node) => {
      const scale = node?.scale || 1;
      const radius = (node?.radius || 0) * scale;
      if (!Number.isFinite(radius) || radius <= 0) return;
      const baseOpacity = node?.isPreview ? 0.62 : 0.54;
      const nodeOpacity = node?.isPreview ? Math.max(0, Math.min(1, Number(node?.opacity) || 0)) : 1;
      const finalOpacity = baseOpacity * nodeOpacity;
      if (finalOpacity <= 0) return;
      this.renderHierarchyBeam(node.x, node.y, radius, node.color, finalOpacity);
    });
  }

  /**
   * 渲染连线
   */
  renderLines() {
    this.lines.forEach(line => {
      const fromNode = this.nodes.find(n => n.id === line.from) ||
                       (this.previewNode?.id === line.from ? this.previewNode : null);
      const toNode = this.nodes.find(n => n.id === line.to) ||
                     (this.previewNode?.id === line.to ? this.previewNode : null);

      if (!fromNode || !toNode) return;
      if (line.opacity <= 0) return;
      if (
        !Number.isFinite(fromNode.x) || !Number.isFinite(fromNode.y)
        || !Number.isFinite(toNode.x) || !Number.isFinite(toNode.y)
      ) return;

      // 计算连线起止点（从节点边缘开始）
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!Number.isFinite(dist) || dist < 0.0001) {
        return;
      }
      const nx = dx / dist;
      const ny = dy / dist;

      const fromRadius = fromNode.radius * (fromNode.scale || 1);
      const toRadius = toNode.radius * (toNode.scale || 1);

      const startX = fromNode.x + nx * fromRadius;
      const startY = fromNode.y + ny * fromRadius;
      const endX = toNode.x - nx * toRadius;
      const endY = toNode.y - ny * toRadius;

      this.renderTriangularConnection({
        startX,
        startY,
        endX,
        endY,
        color: line.color,
        opacity: line.opacity,
        isRemoving: !!line.isRemoving,
        isNew: !!line.isNew,
        isDashed: !!line.isDashed
      });
    });
  }

  /**
   * 绘制箭头
   */
  drawArrow(ctx, x, y, angle, color) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(angle)) return;
    const arrowSize = 8;
    ctx.save();
    ctx.fillStyle = color;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-arrowSize, -arrowSize / 2);
    ctx.lineTo(-arrowSize, arrowSize / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  renderTriangularConnection({
    startX,
    startY,
    endX,
    endY,
    color = '#38bdf8',
    opacity = 1,
    isRemoving = false,
    isNew = false,
    isDashed = false
  }) {
    const ctx = this.ctx;
    if (
      !Number.isFinite(startX) || !Number.isFinite(startY)
      || !Number.isFinite(endX) || !Number.isFinite(endY)
      || opacity <= 0
    ) return;

    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(dist) || dist < 0.0001) return;

    const nx = dx / dist;
    const ny = dy / dist;
    const px = -ny;
    const py = nx;

    const pulse = 1 + Math.sin(this.animationPhase * 4.5) * 0.08;
    const baseWidth = (isRemoving ? 5 : 8) * pulse;
    const tipWidth = (isRemoving ? 11 : 18) * pulse;
    const midX = startX + dx * 0.74;
    const midY = startY + dy * 0.74;

    const p1x = startX + px * (baseWidth * 0.5);
    const p1y = startY + py * (baseWidth * 0.5);
    const p2x = startX - px * (baseWidth * 0.5);
    const p2y = startY - py * (baseWidth * 0.5);
    const p3x = midX + px * (tipWidth * 0.5);
    const p3y = midY + py * (tipWidth * 0.5);
    const p4x = endX;
    const p4y = endY;
    const p5x = midX - px * (tipWidth * 0.5);
    const p5y = midY - py * (tipWidth * 0.5);

    const animatedStrength = isDashed || isNew
      ? (0.9 + Math.sin(this.animationPhase * 8) * 0.1)
      : 1;
    const alpha = Math.max(0.06, Math.min(1, opacity * animatedStrength));
    const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
    gradient.addColorStop(0, this.colorToRgba(color, alpha * (isRemoving ? 0.35 : 0.68)));
    gradient.addColorStop(0.68, this.colorToRgba(color, alpha * (isRemoving ? 0.24 : 0.46)));
    gradient.addColorStop(1, this.colorToRgba(color, alpha * 0.02));

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.shadowColor = this.colorToRgba(color, isRemoving ? 0.26 : 0.62);
    ctx.shadowBlur = isRemoving ? 8 : 16;

    ctx.beginPath();
    ctx.moveTo(p1x, p1y);
    ctx.lineTo(p3x, p3y);
    ctx.lineTo(p4x, p4y);
    ctx.lineTo(p5x, p5y);
    ctx.lineTo(p2x, p2y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  colorToRgba(color, alpha = 1) {
    const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
    const hex = String(color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const value = parseInt(hex.slice(1), 16);
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
    return `rgba(56, 189, 248, ${safeAlpha})`;
  }

  renderHierarchyBeam(x, y, radius, color, opacity = 0.35) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) return;
    const ctx = this.ctx;
    const topHalfWidth = Math.max(20, radius * 0.8);
    const touchY = y + Math.sqrt(Math.max(25, radius * radius - topHalfWidth * topHalfWidth));
    const topLeftX = x - topHalfWidth;
    const topRightX = x + topHalfWidth;
    const maxEndY = this.canvas.height - 4;
    const beamBottomY = Math.min(maxEndY, touchY + radius * 3.45);
    if (!Number.isFinite(beamBottomY) || beamBottomY <= touchY) return;
    const bottomHalfWidth = Math.max(22, radius * 1.9);
    const gradient = ctx.createLinearGradient(x, touchY, x, beamBottomY);
    gradient.addColorStop(0, this.colorToRgba(color, opacity * 1.0));
    gradient.addColorStop(0.48, this.colorToRgba(color, opacity * 0.62));
    gradient.addColorStop(1, this.colorToRgba(color, opacity * 0.08));

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.shadowColor = this.colorToRgba(color, opacity * 0.85);
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(topLeftX, touchY);
    ctx.lineTo(topRightX, touchY);
    ctx.lineTo(x + bottomHalfWidth, beamBottomY);
    ctx.lineTo(x - bottomHalfWidth, beamBottomY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * 渲染现有节点
   */
  renderNode(node) {
    const ctx = this.ctx;
    const { x, y, radius, label, color, glowColor } = node;

    ctx.save();

    // 发光效果
    const glow = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 1.5);
    glow.addColorStop(0, glowColor);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius * 2, y - radius * 2, radius * 4, radius * 4);

    // 节点圆形
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);

    const nodeGradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
    nodeGradient.addColorStop(0, this.lightenColor(color, 30));
    nodeGradient.addColorStop(1, color);
    ctx.fillStyle = nodeGradient;
    ctx.fill();

    // 边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 标签
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const { nodePart, sensePart } = this.splitNodeSenseLabel(label);
    let displayLabel = sensePart || nodePart || label;
    displayLabel = this.truncateLabel(displayLabel, 6);
    ctx.fillText(displayLabel, x, y);

    this.renderLabelTag(x, y + radius + 12, label, {
      bg: 'rgba(15, 23, 42, 0.88)',
      border: 'rgba(148, 163, 184, 0.55)',
      text: '#e2e8f0'
    });

    ctx.restore();
  }

  /**
   * 渲染预览节点（带动画效果）
   */
  renderPreviewNode(node) {
    const ctx = this.ctx;
    const { x, y, radius, label, color, opacity, scale, pulseScale = 1, pulseGlow = 0.4, showPendingTag = true } = node;

    if (opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = opacity;

    const finalScale = scale * pulseScale;
    const finalRadius = radius * finalScale;

    // 脉冲发光
    const glow = ctx.createRadialGradient(x, y, finalRadius * 0.3, x, y, finalRadius * 2);
    glow.addColorStop(0, `rgba(56, 189, 248, ${pulseGlow})`);
    glow.addColorStop(0.5, `rgba(56, 189, 248, ${pulseGlow * 0.3})`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(x - finalRadius * 3, y - finalRadius * 3, finalRadius * 6, finalRadius * 6);

    // 节点圆形（虚线边框表示待审核）
    ctx.beginPath();
    ctx.arc(x, y, finalRadius, 0, Math.PI * 2);

    const nodeGradient = ctx.createRadialGradient(x - finalRadius * 0.3, y - finalRadius * 0.3, 0, x, y, finalRadius);
    nodeGradient.addColorStop(0, this.lightenColor(color, 40));
    nodeGradient.addColorStop(1, color);
    ctx.fillStyle = nodeGradient;
    ctx.fill();

    // 虚线边框
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.animationPhase * 15;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 标签
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const { nodePart, sensePart } = this.splitNodeSenseLabel(label);
    let displayLabel = sensePart || nodePart || label;
    displayLabel = this.truncateLabel(displayLabel, 6);
    ctx.fillText(displayLabel, x, y - 2);

    if (showPendingTag) {
      // "待审核"标签（仅普通用户创建节点流程显示）
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#fcd34d';
      ctx.fillText('待审核', x, y + 12);
    }

    this.renderLabelTag(x, y + finalRadius + 14, label, {
      bg: 'rgba(3, 105, 161, 0.28)',
      border: 'rgba(56, 189, 248, 0.65)',
      text: '#e0f2fe'
    });

    ctx.restore();
  }

  splitNodeSenseLabel(label = '') {
    const text = String(label || '').trim();
    if (!text) return { nodePart: '', sensePart: '' };
    const index = text.indexOf('-');
    if (index <= 0 || index >= text.length - 1) {
      return { nodePart: text, sensePart: '' };
    }
    return {
      nodePart: text.slice(0, index),
      sensePart: text.slice(index + 1)
    };
  }

  truncateLabel(text = '', maxChars = 12) {
    const source = String(text || '').trim();
    if (!source) return '';
    if (source.length <= maxChars) return source;
    return `${source.slice(0, Math.max(1, maxChars - 1))}…`;
  }

  renderLabelTag(x, y, text, style = {}) {
    const ctx = this.ctx;
    const safeText = this.truncateLabel(text, 18);
    if (!safeText) return;

    ctx.save();
    ctx.font = '10px sans-serif';
    const paddingX = 6;
    const radius = 5;
    const width = Math.max(36, ctx.measureText(safeText).width + paddingX * 2);
    const height = 16;
    const left = x - width / 2;
    const minY = height / 2 + 2;
    const maxY = this.canvas.height - height / 2 - 2;
    const clampedY = Math.min(maxY, Math.max(minY, y));
    const top = clampedY - height / 2;

    ctx.fillStyle = style.bg || 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = style.border || 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(left + radius, top);
    ctx.lineTo(left + width - radius, top);
    ctx.quadraticCurveTo(left + width, top, left + width, top + radius);
    ctx.lineTo(left + width, top + height - radius);
    ctx.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
    ctx.lineTo(left + radius, top + height);
    ctx.quadraticCurveTo(left, top + height, left, top + height - radius);
    ctx.lineTo(left, top + radius);
    ctx.quadraticCurveTo(left, top, left + radius, top);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = style.text || '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(safeText, x, clampedY + 0.2);
    ctx.restore();
  }

  /**
   * 颜色变亮
   */
  lightenColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `rgb(${R}, ${G}, ${B})`;
  }

  /**
   * 清理
   */
  destroy() {
    this.stopAnimation();
    this.nodes = [];
    this.lines = [];
    this.previewNode = null;
  }
}

export default MiniPreviewRenderer;
