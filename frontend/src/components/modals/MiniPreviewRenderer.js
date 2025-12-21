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
   */
  setPreviewScene(config) {
    const { nodeA, nodeB, relationType, newNodeName, insertDirection } = config;

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    const radius = 35;
    const distance = 100;

    this.nodes = [];
    this.lines = [];

    if (relationType === 'insert' && nodeB) {
      // 插入模式：三个节点
      this.setupInsertPreview(centerX, centerY, radius, distance, nodeA, nodeB, newNodeName, insertDirection);
    } else {
      // 简单模式：两个节点
      this.setupSimplePreview(centerX, centerY, radius, distance, nodeA, newNodeName, relationType);
    }

    this.startAnimation();
  }

  /**
   * 设置简单关联预览（母域/子域）
   */
  setupSimplePreview(centerX, centerY, radius, distance, nodeA, newNodeName, relationType) {
    const isExtends = relationType === 'extends';

    // Node A 在中心
    this.nodes.push({
      id: 'nodeA',
      x: centerX,
      y: centerY + (isExtends ? 40 : -40),
      radius: radius,
      label: nodeA?.name || 'Node A',
      color: '#8b5cf6',
      glowColor: 'rgba(139, 92, 246, 0.3)',
      isExisting: true
    });

    // 新节点
    this.previewNode = {
      id: 'newNode',
      x: centerX,
      y: centerY + (isExtends ? -60 : 60),
      targetX: centerX,
      targetY: centerY + (isExtends ? -60 : 60),
      radius: radius,
      label: newNodeName || '新节点',
      color: '#38bdf8',
      glowColor: 'rgba(56, 189, 248, 0.4)',
      isPreview: true,
      opacity: 0,
      scale: 0.5
    };

    // 连线
    this.lines.push({
      from: 'nodeA',
      to: 'newNode',
      color: isExtends ? '#22c55e' : '#facc15',
      isDashed: true,
      opacity: 0,
      label: isExtends ? '母域' : '子域'
    });
  }

  /**
   * 设置插入预览（三节点）
   */
  setupInsertPreview(centerX, centerY, radius, distance, nodeA, nodeB, newNodeName, insertDirection) {
    const isAtoB = insertDirection === 'aToB';

    // Node A（上方或下方）
    this.nodes.push({
      id: 'nodeA',
      x: centerX,
      y: centerY - 70,
      radius: radius * 0.9,
      label: nodeA?.name || 'Node A',
      color: '#8b5cf6',
      glowColor: 'rgba(139, 92, 246, 0.3)',
      isExisting: true
    });

    // Node B（下方或上方）
    this.nodes.push({
      id: 'nodeB',
      x: centerX,
      y: centerY + 70,
      radius: radius * 0.9,
      label: nodeB?.name || 'Node B',
      color: '#8b5cf6',
      glowColor: 'rgba(139, 92, 246, 0.3)',
      isExisting: true
    });

    // 原有连线（将被移除）
    this.lines.push({
      from: 'nodeA',
      to: 'nodeB',
      color: '#64748b',
      isDashed: false,
      opacity: 1,
      isRemoving: true
    });

    // 新节点
    this.previewNode = {
      id: 'newNode',
      x: centerX + 80,
      y: centerY,
      targetX: centerX,
      targetY: centerY,
      radius: radius,
      label: newNodeName || '新节点',
      color: '#38bdf8',
      glowColor: 'rgba(56, 189, 248, 0.4)',
      isPreview: true,
      opacity: 0,
      scale: 0.5
    };

    // 新连线 1：nodeA 到 newNode
    this.lines.push({
      from: 'nodeA',
      to: 'newNode',
      color: isAtoB ? '#facc15' : '#22c55e',
      isDashed: true,
      opacity: 0,
      isNew: true
    });

    // 新连线 2：newNode 到 nodeB
    this.lines.push({
      from: 'newNode',
      to: 'nodeB',
      color: isAtoB ? '#22c55e' : '#facc15',
      isDashed: true,
      opacity: 0,
      isNew: true
    });
  }

  /**
   * 开始动画
   */
  startAnimation() {
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

    // 绘制连线
    this.renderLines();

    // 绘制现有节点
    this.nodes.forEach(node => this.renderNode(node));

    // 绘制预览节点
    if (this.previewNode) {
      this.renderPreviewNode(this.previewNode);
    }
  }

  /**
   * 渲染连线
   */
  renderLines() {
    const ctx = this.ctx;

    this.lines.forEach(line => {
      const fromNode = this.nodes.find(n => n.id === line.from) ||
                       (this.previewNode?.id === line.from ? this.previewNode : null);
      const toNode = this.nodes.find(n => n.id === line.to) ||
                     (this.previewNode?.id === line.to ? this.previewNode : null);

      if (!fromNode || !toNode) return;
      if (line.opacity <= 0) return;

      ctx.save();
      ctx.globalAlpha = line.opacity;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;

      if (line.isDashed) {
        // 动态虚线
        const dashOffset = this.animationPhase * 20;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -dashOffset;
      } else {
        ctx.setLineDash([]);
      }

      // 计算连线起止点（从节点边缘开始）
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;

      const fromRadius = fromNode.radius * (fromNode.scale || 1);
      const toRadius = toNode.radius * (toNode.scale || 1);

      const startX = fromNode.x + nx * fromRadius;
      const startY = fromNode.y + ny * fromRadius;
      const endX = toNode.x - nx * toRadius;
      const endY = toNode.y - ny * toRadius;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // 绘制箭头
      this.drawArrow(ctx, endX, endY, Math.atan2(dy, dx), line.color);

      ctx.restore();
    });
  }

  /**
   * 绘制箭头
   */
  drawArrow(ctx, x, y, angle, color) {
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

    let displayLabel = label;
    if (ctx.measureText(label).width > radius * 1.6) {
      displayLabel = label.substring(0, 4) + '...';
    }
    ctx.fillText(displayLabel, x, y);

    ctx.restore();
  }

  /**
   * 渲染预览节点（带动画效果）
   */
  renderPreviewNode(node) {
    const ctx = this.ctx;
    const { x, y, radius, label, color, glowColor, opacity, scale, pulseScale = 1, pulseGlow = 0.4 } = node;

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

    let displayLabel = label;
    if (ctx.measureText(label).width > finalRadius * 1.6) {
      displayLabel = label.substring(0, 4) + '...';
    }
    ctx.fillText(displayLabel, x, y - 2);

    // "待审核"标签
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#fcd34d';
    ctx.fillText('待审核', x, y + 12);

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
