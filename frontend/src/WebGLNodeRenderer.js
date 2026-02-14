/**
 * WebGL Node Renderer - 节点WebGL渲染器
 * 负责渲染节点、动画和交互
 */

// 顶点着色器 - 支持变换和动画
const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;

  uniform vec2 u_resolution;
  uniform vec2 u_translation;
  uniform vec2 u_scale;
  uniform float u_rotation;

  varying vec2 v_texCoord;

  void main() {
    // 应用缩放
    vec2 scaledPosition = a_position * u_scale;

    // 应用旋转
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    vec2 rotatedPosition = vec2(
      scaledPosition.x * c - scaledPosition.y * s,
      scaledPosition.x * s + scaledPosition.y * c
    );

    // 应用平移
    vec2 position = rotatedPosition + u_translation;

    // 转换到裁剪空间
    vec2 zeroToOne = position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clipSpace = zeroToTwo - 1.0;

    gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
    v_texCoord = a_texCoord;
  }
`;

// 片段着色器 - 支持渐变和发光效果
const fragmentShaderSource = `
  precision mediump float;

  uniform vec4 u_color;
  uniform vec4 u_glowColor;
  uniform float u_glowIntensity;
  uniform float u_opacity;
  uniform int u_shapeType; // 0: 圆形, 1: 矩形
  uniform vec2 u_size;

  varying vec2 v_texCoord;

  void main() {
    vec2 center = vec2(0.5, 0.5);
    vec2 pos = v_texCoord - center;

    float dist;
    if (u_shapeType == 0) {
      // 圆形
      dist = length(pos) * 2.0;
    } else {
      // 矩形
      vec2 absPos = abs(pos) * 2.0;
      dist = max(absPos.x, absPos.y);
    }

    // 基础颜色
    vec4 baseColor = u_color;

    // 发光效果
    float glow = 1.0 - smoothstep(0.0, 1.0, dist);
    float glowEffect = pow(glow, 2.0) * u_glowIntensity;

    // 边缘平滑
    float alpha = 1.0 - smoothstep(0.9, 1.0, dist);

    // 混合发光
    vec4 finalColor = mix(baseColor, u_glowColor, glowEffect * 0.5);
    finalColor.a = alpha * u_opacity;

    if (finalColor.a < 0.01) discard;

    gl_FragColor = finalColor;
  }
`;

// 连线着色器
const lineVertexShaderSource = `
  attribute vec2 a_position;
  uniform vec2 u_resolution;

  void main() {
    vec2 zeroToOne = a_position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clipSpace = zeroToTwo - 1.0;
    gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
  }
`;

const lineFragmentShaderSource = `
  precision mediump float;
  uniform vec4 u_color;
  uniform float u_opacity;

  void main() {
    gl_FragColor = vec4(u_color.rgb, u_color.a * u_opacity);
  }
`;

// 缓动函数
const Easing = {
  linear: t => t,
  easeInQuad: t => t * t,
  easeOutQuad: t => t * (2 - t),
  easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: t => t * t * t,
  easeOutCubic: t => (--t) * t * t + 1,
  easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeOutBack: t => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: t => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
};

// 节点类型颜色配置
const NodeColors = {
  center: { base: [0.66, 0.33, 0.97, 1], glow: [0.49, 0.23, 0.93, 1] },    // 紫色
  parent: { base: [0.06, 0.73, 0.51, 1], glow: [0.02, 0.59, 0.41, 1] },    // 绿色
  child: { base: [0.98, 0.75, 0.14, 1], glow: [0.96, 0.62, 0.04, 1] },     // 黄色
  root: { base: [0.49, 0.23, 0.93, 1], glow: [0.66, 0.33, 0.97, 1] },      // 深紫
  featured: { base: [0.98, 0.55, 0.23, 1], glow: [0.96, 0.42, 0.13, 1] },  // 橙色
  search: { base: [0.23, 0.51, 0.96, 1], glow: [0.15, 0.40, 0.85, 1] },    // 蓝色
  // 预览模式专用颜色
  preview: { base: [0.56, 0.78, 0.95, 1], glow: [0.40, 0.65, 0.90, 1] },   // 浅蓝色（待插入节点）
  previewAffected: { base: [0.70, 0.70, 0.70, 1], glow: [0.50, 0.50, 0.50, 1] } // 灰色（受影响节点）
};

class WebGLNodeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false
    });

    if (!this.gl) {
      throw new Error('WebGL not supported');
    }

    this.nodes = new Map();
    this.lines = [];
    this.animations = [];
    this.currentLayout = 'home'; // 'home' | 'nodeDetail'
    this.animating = false;
    this.renderingLoop = false; // 标记是否已经在持续渲染循环中
    this.lastTime = 0;

    // 交互状态
    this.hoveredNode = null;
    this.hoveredButton = null;
    this.selectedNode = null;
    this.onClick = null;
    this.onButtonClick = null; // 按钮点击回调

    // 节点操作按钮配置
    this.nodeButtons = new Map(); // nodeId -> [{id, icon, angle, action}]

    // 预览模式状态
    this.previewMode = false;
    this.previewNodes = new Map();   // 预览用的临时节点
    this.previewLines = [];          // 预览用的临时连线
    this.previewPulseTime = 0;       // 脉冲动画时间
    this.savedState = null;          // 保存的原始状态（用于回滚）

    this.init();
  }

  init() {
    const gl = this.gl;

    // 创建着色器程序
    this.nodeProgram = this.createProgram(vertexShaderSource, fragmentShaderSource);
    this.lineProgram = this.createProgram(lineVertexShaderSource, lineFragmentShaderSource);

    // 获取属性和uniform位置
    this.nodeLocations = {
      position: gl.getAttribLocation(this.nodeProgram, 'a_position'),
      texCoord: gl.getAttribLocation(this.nodeProgram, 'a_texCoord'),
      resolution: gl.getUniformLocation(this.nodeProgram, 'u_resolution'),
      translation: gl.getUniformLocation(this.nodeProgram, 'u_translation'),
      scale: gl.getUniformLocation(this.nodeProgram, 'u_scale'),
      rotation: gl.getUniformLocation(this.nodeProgram, 'u_rotation'),
      color: gl.getUniformLocation(this.nodeProgram, 'u_color'),
      glowColor: gl.getUniformLocation(this.nodeProgram, 'u_glowColor'),
      glowIntensity: gl.getUniformLocation(this.nodeProgram, 'u_glowIntensity'),
      opacity: gl.getUniformLocation(this.nodeProgram, 'u_opacity'),
      shapeType: gl.getUniformLocation(this.nodeProgram, 'u_shapeType'),
      size: gl.getUniformLocation(this.nodeProgram, 'u_size')
    };

    this.lineLocations = {
      position: gl.getAttribLocation(this.lineProgram, 'a_position'),
      resolution: gl.getUniformLocation(this.lineProgram, 'u_resolution'),
      color: gl.getUniformLocation(this.lineProgram, 'u_color'),
      opacity: gl.getUniformLocation(this.lineProgram, 'u_opacity')
    };

    // 创建顶点缓冲区
    this.createBuffers();

    // 设置混合模式
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 绑定事件
    this.bindEvents();
  }

  createProgram(vsSource, fsSource) {
    const gl = this.gl;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(fs));
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
    }

    return program;
  }

  createBuffers() {
    const gl = this.gl;

    // 节点四边形顶点 (位置 + 纹理坐标)
    const nodeVertices = new Float32Array([
      -0.5, -0.5,  0, 0,
       0.5, -0.5,  1, 0,
      -0.5,  0.5,  0, 1,
       0.5,  0.5,  1, 1
    ]);

    this.nodeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, nodeVertices, gl.STATIC_DRAW);

    // 线条缓冲区 (动态)
    this.lineBuffer = gl.createBuffer();
  }

  bindEvents() {
    const canvas = this.canvas;

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      const prevHoveredButton = this.hoveredButton;

      // 先检测按钮悬停
      this.hoveredButton = this.hitTestButton(x, y);
      if (this.hoveredButton) {
        this.hoveredNode = null;
        canvas.style.cursor = 'pointer';
      } else {
        this.hoveredNode = this.hitTest(x, y);
        canvas.style.cursor = this.hoveredNode ? 'pointer' : 'default';
      }

      // 如果按钮悬浮状态变化，需要重新渲染
      const buttonHoverChanged = (prevHoveredButton !== this.hoveredButton) ||
        (prevHoveredButton && this.hoveredButton &&
          (prevHoveredButton.nodeId !== this.hoveredButton.nodeId ||
           prevHoveredButton.button.id !== this.hoveredButton.button.id));

      if (buttonHoverChanged && this.nodeButtons.size > 0) {
        this.render();
      }
    });

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      // 先检测按钮点击
      const clickedButton = this.hitTestButton(x, y);
      if (clickedButton && this.onButtonClick) {
        this.onButtonClick(clickedButton.nodeId, clickedButton.button);
        return;
      }

      const clickedNode = this.hitTest(x, y);
      if (clickedNode && this.onClick) {
        this.onClick(clickedNode);
      }
    });
  }

  hitTestButton(x, y) {
    const buttonRadius = 18; // 按钮半径

    for (const [nodeId, buttons] of this.nodeButtons) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.visible || node.opacity < 0.5) continue;

      for (const button of buttons) {
        const btnPos = this.getButtonPosition(node, button.angle);
        const dx = x - btnPos.x;
        const dy = y - btnPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= buttonRadius * node.scale) {
          return { nodeId, button, node };
        }
      }
    }
    return null;
  }

  getButtonPosition(node, angle) {
    // 按钮位置在节点边缘外侧
    const distance = node.radius * node.scale + 25;
    return {
      x: node.x + Math.cos(angle) * distance,
      y: node.y + Math.sin(angle) * distance
    };
  }

  hitTest(x, y) {
    for (const [id, node] of this.nodes) {
      if (!node.visible) continue;

      const dx = x - node.x;
      const dy = y - node.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= node.radius * node.scale) {
        return node;
      }
    }
    return null;
  }

  // 创建或更新节点
  setNode(id, config) {
    const existing = this.nodes.get(id);

    const node = {
      id,
      x: config.x ?? existing?.x ?? 0,
      y: config.y ?? existing?.y ?? 0,
      radius: config.radius ?? existing?.radius ?? 50,
      scale: config.scale ?? existing?.scale ?? 1,
      rotation: config.rotation ?? existing?.rotation ?? 0,
      opacity: config.opacity ?? existing?.opacity ?? 1,
      visible: config.visible ?? existing?.visible ?? true,
      type: config.type ?? existing?.type ?? 'center',
      label: config.label ?? existing?.label ?? '',
      subLabel: config.subLabel ?? existing?.subLabel ?? '',
      data: config.data ?? existing?.data ?? null,
      glowIntensity: config.glowIntensity ?? existing?.glowIntensity ?? 0.5,
      // 知识点动态增长相关
      knowledgePointValue: config.data?.knowledgePoint?.value ?? existing?.knowledgePointValue ?? 0,
      contentScore: config.data?.contentScore ?? existing?.contentScore ?? 1,
      lastUpdateTime: existing?.lastUpdateTime ?? Date.now(),
      isAnimating: existing?.isAnimating ?? false, // 保持原有的动画状态
      // 目标值 (用于动画)
      targetX: config.x ?? existing?.x ?? 0,
      targetY: config.y ?? existing?.y ?? 0,
      targetScale: config.scale ?? existing?.scale ?? 1,
      targetOpacity: config.opacity ?? existing?.opacity ?? 1
    };

    this.nodes.set(id, node);
    return node;
  }

  removeNode(id) {
    this.nodes.delete(id);
  }

  clearNodes() {
    this.nodes.clear();
    this.lines = [];
    this.nodeButtons.clear();
  }

  // 设置连线
  setLines(lines) {
    this.lines = lines; // [{from: nodeId, to: nodeId, color: [r,g,b,a]}]
  }

  // 设置节点操作按钮
  setNodeButtons(nodeId, buttons) {
    // buttons: [{id, icon, angle, action, color}]
    // angle: 弧度，0表示右边，Math.PI/2表示下边
    if (buttons && buttons.length > 0) {
      this.nodeButtons.set(nodeId, buttons);
    } else {
      this.nodeButtons.delete(nodeId);
    }
  }

  // 清除所有按钮
  clearNodeButtons() {
    this.nodeButtons.clear();
  }

  // 动画节点到新位置
  animateNode(id, target, duration = 600, easing = 'easeOutCubic') {
    const node = this.nodes.get(id);
    if (!node) return Promise.resolve();

    // 标记节点正在动画
    node.isAnimating = true;

    // 停止持续渲染循环（动画期间不需要）
    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
      this.renderingLoop = false;
    }

    return new Promise(resolve => {
      const animation = {
        nodeId: id,
        startTime: performance.now(),
        duration,
        easing: Easing[easing] || Easing.linear,
        start: {
          x: node.x,
          y: node.y,
          scale: node.scale,
          opacity: node.opacity,
          rotation: node.rotation
        },
        end: {
          x: target.x ?? node.x,
          y: target.y ?? node.y,
          scale: target.scale ?? node.scale,
          opacity: target.opacity ?? node.opacity,
          rotation: target.rotation ?? node.rotation
        },
        onComplete: () => {
          // 动画完成时取消标记
          const animNode = this.nodes.get(id);
          if (animNode) {
            animNode.isAnimating = false;
          }
          resolve();
        }
      };

      this.animations.push(animation);

      if (!this.animating) {
        this.animating = true;
        this.animate();
      }
    });
  }

  // 批量动画
  animateNodes(configs, duration = 600, easing = 'easeOutCubic') {
    const promises = configs.map(({ id, target }) =>
      this.animateNode(id, target, duration, easing)
    );
    return Promise.all(promises);
  }

  // 动画循环
  animate(currentTime = performance.now()) {
    if (this.animations.length === 0) {
      this.animating = false;
      // 动画结束后，确保重启知识点更新循环
      this.renderingLoop = false;
      this.render();
      return;
    }

    const completedAnimations = [];

    for (const anim of this.animations) {
      const elapsed = currentTime - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);
      const easedProgress = anim.easing(progress);

      const node = this.nodes.get(anim.nodeId);
      if (node) {
        node.x = anim.start.x + (anim.end.x - anim.start.x) * easedProgress;
        node.y = anim.start.y + (anim.end.y - anim.start.y) * easedProgress;
        node.scale = anim.start.scale + (anim.end.scale - anim.start.scale) * easedProgress;
        node.opacity = anim.start.opacity + (anim.end.opacity - anim.start.opacity) * easedProgress;
        node.rotation = anim.start.rotation + (anim.end.rotation - anim.start.rotation) * easedProgress;
      }

      if (progress >= 1) {
        completedAnimations.push(anim);
      }
    }

    // 移除完成的动画
    for (const anim of completedAnimations) {
      const index = this.animations.indexOf(anim);
      if (index > -1) {
        this.animations.splice(index, 1);
        if (anim.onComplete) anim.onComplete();
      }
    }

    this.render();

    if (this.animations.length > 0) {
      requestAnimationFrame((t) => this.animate(t));
    } else {
      this.animating = false;
      // 动画完全结束后，确保重启知识点更新循环
      this.renderingLoop = false;
    }
  }

  // 渲染
  render() {
    const gl = this.gl;
    const canvas = this.canvas;

    console.log('render() called, canvas size:', canvas.width, 'x', canvas.height, ', nodes:', this.nodes.size);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.07, 0.09, 0.15, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 先渲染连线
    this.renderLines();

    // 再渲染节点
    this.renderNodes();

    // 渲染节点操作按钮
    this.renderNodeButtons();

    // 更新并渲染文字标签
    this.updateKnowledgePoints();
    this.renderLabels();

    // 启动持续渲染循环（如果还没有在运行）
    if (!this.animating && !this.renderingLoop && this.nodes.size > 0) {
      this.renderingLoop = true;
      this.startRenderLoop();
    }
  }

  // 持续渲染循环
  startRenderLoop() {
    if (!this.renderingLoop) return;

    // 如果没有节点或者在动画中，停止循环
    if (this.nodes.size === 0 || this.animating) {
      this.renderingLoop = false;
      return;
    }

    // 更新知识点
    this.updateKnowledgePoints();

    // 只重新渲染文字（性能优化）
    this.renderLabels();

    // 继续下一帧
    this.renderLoopId = requestAnimationFrame(() => this.startRenderLoop());
  }

  // 更新知识点值
  updateKnowledgePoints() {
    const now = Date.now();

    for (const [, node] of this.nodes) {
      // 只更新不在动画中的节点
      if (node.isAnimating || !node.visible) continue;

      const deltaTime = (now - node.lastUpdateTime) / 1000; // 转换为秒
      node.lastUpdateTime = now;

      // 根据contentScore增长知识点
      // contentScore范围通常是0-10，我们让每个contentScore点相当于每秒增长0.1知识点
      // 这样contentScore为5时，每秒增长0.5，每分钟增长30知识点
      const growthRate = (node.contentScore || 1) * 0.1;
      const increment = growthRate * deltaTime;
      node.knowledgePointValue += increment;
    }
  }

  renderLines() {
    const gl = this.gl;

    if (this.lines.length === 0) return;

    gl.useProgram(this.lineProgram);
    gl.uniform2f(this.lineLocations.resolution, this.canvas.width, this.canvas.height);

    for (const line of this.lines) {
      const fromNode = this.nodes.get(line.from);
      const toNode = this.nodes.get(line.to);

      if (!fromNode || !toNode || !fromNode.visible || !toNode.visible) continue;

      const vertices = new Float32Array([
        fromNode.x, fromNode.y,
        toNode.x, toNode.y
      ]);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

      gl.enableVertexAttribArray(this.lineLocations.position);
      gl.vertexAttribPointer(this.lineLocations.position, 2, gl.FLOAT, false, 0, 0);

      const color = line.color || [0.66, 0.33, 0.97, 0.6];
      gl.uniform4fv(this.lineLocations.color, color);
      gl.uniform1f(this.lineLocations.opacity, Math.min(fromNode.opacity, toNode.opacity));

      gl.lineWidth(2);
      gl.drawArrays(gl.LINES, 0, 2);
    }
  }

  renderNodes() {
    const gl = this.gl;

    gl.useProgram(this.nodeProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);

    gl.enableVertexAttribArray(this.nodeLocations.position);
    gl.vertexAttribPointer(this.nodeLocations.position, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(this.nodeLocations.texCoord);
    gl.vertexAttribPointer(this.nodeLocations.texCoord, 2, gl.FLOAT, false, 16, 8);

    gl.uniform2f(this.nodeLocations.resolution, this.canvas.width, this.canvas.height);

    // 按opacity排序，先渲染透明的
    const sortedNodes = Array.from(this.nodes.values())
      .filter(n => n.visible && n.opacity > 0)
      .sort((a, b) => a.opacity - b.opacity);

    for (const node of sortedNodes) {
      const colors = NodeColors[node.type] || NodeColors.center;

      const size = node.radius * 2;
      gl.uniform2f(this.nodeLocations.translation, node.x, node.y);
      gl.uniform2f(this.nodeLocations.scale, size * node.scale, size * node.scale);
      gl.uniform1f(this.nodeLocations.rotation, node.rotation);
      gl.uniform4fv(this.nodeLocations.color, colors.base);
      gl.uniform4fv(this.nodeLocations.glowColor, colors.glow);
      gl.uniform1f(this.nodeLocations.glowIntensity,
        this.hoveredNode === node ? 0.8 : node.glowIntensity);
      gl.uniform1f(this.nodeLocations.opacity, node.opacity);
      gl.uniform1i(this.nodeLocations.shapeType, 0); // 圆形
      gl.uniform2f(this.nodeLocations.size, size, size);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  renderNodeButtons() {
    const gl = this.gl;

    if (this.nodeButtons.size === 0) return;

    gl.useProgram(this.nodeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);

    gl.enableVertexAttribArray(this.nodeLocations.position);
    gl.vertexAttribPointer(this.nodeLocations.position, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(this.nodeLocations.texCoord);
    gl.vertexAttribPointer(this.nodeLocations.texCoord, 2, gl.FLOAT, false, 16, 8);

    gl.uniform2f(this.nodeLocations.resolution, this.canvas.width, this.canvas.height);

    for (const [nodeId, buttons] of this.nodeButtons) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.visible || node.opacity < 0.3) continue;

      for (const button of buttons) {
        const btnPos = this.getButtonPosition(node, button.angle);
        const isHovered = this.hoveredButton &&
          this.hoveredButton.nodeId === nodeId &&
          this.hoveredButton.button.id === button.id;

        // 按钮尺寸
        const btnSize = isHovered ? 38 : 32;

        // 按钮颜色 - 使用更柔和的颜色
        const baseColor = button.color || [0.66, 0.33, 0.97, 1];
        const glowColor = [baseColor[0] * 1.2, baseColor[1] * 1.2, baseColor[2] * 1.2, 0.8];

        gl.uniform2f(this.nodeLocations.translation, btnPos.x, btnPos.y);
        gl.uniform2f(this.nodeLocations.scale, btnSize, btnSize);
        gl.uniform1f(this.nodeLocations.rotation, 0);
        gl.uniform4fv(this.nodeLocations.color, baseColor);
        gl.uniform4fv(this.nodeLocations.glowColor, glowColor);
        gl.uniform1f(this.nodeLocations.glowIntensity, isHovered ? 0.5 : 0.3);
        gl.uniform1f(this.nodeLocations.opacity, node.opacity * (isHovered ? 0.95 : 0.8));
        gl.uniform1i(this.nodeLocations.shapeType, 0); // 圆形
        gl.uniform2f(this.nodeLocations.size, btnSize, btnSize);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }

  renderLabels() {
    // 获取或创建叠加的2D canvas
    let labelCanvas = this.labelCanvas;
    if (!labelCanvas) {
      labelCanvas = document.createElement('canvas');
      labelCanvas.style.position = 'absolute';
      labelCanvas.style.top = '0';
      labelCanvas.style.left = '0';
      labelCanvas.style.pointerEvents = 'none';
      labelCanvas.style.zIndex = '1';
      if (this.canvas.parentElement) {
        this.canvas.parentElement.appendChild(labelCanvas);
      }
      this.labelCanvas = labelCanvas;
    }

    // 同步尺寸
    labelCanvas.width = this.canvas.width;
    labelCanvas.height = this.canvas.height;
    labelCanvas.style.width = this.canvas.offsetWidth + 'px';
    labelCanvas.style.height = this.canvas.offsetHeight + 'px';

    const ctx = labelCanvas.getContext('2d');
    ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);

    for (const [, node] of this.nodes) {
      if (!node.visible || node.opacity < 0.3 || !node.label) continue;

      ctx.globalAlpha = node.opacity;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 主标签
      const fontSize = Math.max(12, node.radius * node.scale * 0.35);
      ctx.font = `bold ${fontSize}px sans-serif`;

      // 截断长文本
      let label = node.label;
      const maxWidth = node.radius * node.scale * 1.8;
      while (ctx.measureText(label).width > maxWidth && label.length > 3) {
        label = label.slice(0, -1);
      }
      if (label !== node.label) label += '...';

      ctx.fillText(label, node.x, node.y - fontSize * 0.3);

      // 副标签 (动态知识点)
      if (node.knowledgePointValue > 0) {
        ctx.font = `${fontSize * 0.7}px sans-serif`;
        ctx.fillStyle = '#e9d5ff';
        // 显示动态更新的知识点值
        const dynamicSubLabel = `${node.knowledgePointValue.toFixed(2)} 知识点`;
        ctx.fillText(dynamicSubLabel, node.x, node.y + fontSize * 0.6);
      } else if (node.subLabel) {
        // 回退到静态subLabel（如果没有知识点值）
        ctx.font = `${fontSize * 0.7}px sans-serif`;
        ctx.fillStyle = '#e9d5ff';
        ctx.fillText(node.subLabel, node.x, node.y + fontSize * 0.6);
      }
    }

    // 渲染按钮图标
    this.renderButtonIcons(ctx);

    ctx.globalAlpha = 1;
  }

  renderButtonIcons(ctx) {
    for (const [nodeId, buttons] of this.nodeButtons) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.visible || node.opacity < 0.3) continue;

      for (const button of buttons) {
        const btnPos = this.getButtonPosition(node, button.angle);
        const isHovered = this.hoveredButton &&
          this.hoveredButton.nodeId === nodeId &&
          this.hoveredButton.button.id === button.id;

        ctx.globalAlpha = node.opacity * (isHovered ? 1 : 0.9);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 绘制图标
        const iconSize = isHovered ? 16 : 14;
        ctx.font = `${iconSize}px sans-serif`;
        ctx.fillStyle = '#ffffff';

        // 使用简单的符号作为图标
        const icon = button.icon || '→';
        ctx.fillText(icon, btnPos.x, btnPos.y);

        // 如果悬停，显示tooltip
        if (isHovered && button.tooltip) {
          ctx.font = '12px sans-serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          const tooltipWidth = ctx.measureText(button.tooltip).width + 16;
          const tooltipX = btnPos.x;
          const tooltipY = btnPos.y - 30;

          // tooltip 背景
          ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
          ctx.beginPath();
          ctx.roundRect(tooltipX - tooltipWidth / 2, tooltipY - 12, tooltipWidth, 24, 6);
          ctx.fill();

          // tooltip 边框
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // tooltip 文字
          ctx.fillStyle = '#e9d5ff';
          ctx.fillText(button.tooltip, tooltipX, tooltipY);
        }
      }
    }
  }

  // 调整大小
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.render();
  }

  // ==================== 预览模式方法 ====================

  /**
   * 进入预览模式 - 保存当前状态
   */
  enterPreviewMode() {
    if (this.previewMode) return;

    // 保存当前状态（深拷贝）
    this.savedState = {
      nodes: new Map(),
      lines: [...this.lines]
    };

    for (const [id, node] of this.nodes) {
      this.savedState.nodes.set(id, { ...node });
    }

    this.previewMode = true;
    this.previewNodes.clear();
    this.previewLines = [];
    this.previewPulseTime = 0;

    // 启动预览渲染循环
    this.startPreviewRenderLoop();
  }

  /**
   * 退出预览模式 - 恢复原始状态
   */
  exitPreviewMode() {
    if (!this.previewMode) return;

    // 停止预览渲染循环
    if (this.previewRenderLoopId) {
      cancelAnimationFrame(this.previewRenderLoopId);
      this.previewRenderLoopId = null;
    }

    // 恢复保存的状态
    if (this.savedState) {
      this.nodes.clear();
      for (const [id, node] of this.savedState.nodes) {
        this.nodes.set(id, { ...node });
      }
      this.lines = [...this.savedState.lines];
    }

    this.previewMode = false;
    this.previewNodes.clear();
    this.previewLines = [];
    this.savedState = null;

    // 重新渲染
    this.render();
  }

  /**
   * 设置预览节点（新节点的临时表示）
   */
  setPreviewNode(id, config) {
    const node = {
      id,
      x: config.x ?? 0,
      y: config.y ?? 0,
      radius: config.radius ?? 45,
      scale: config.scale ?? 1,
      rotation: config.rotation ?? 0,
      opacity: config.opacity ?? 0.7,
      visible: config.visible ?? true,
      type: 'preview',
      label: config.label ?? '新节点',
      subLabel: config.subLabel ?? '',
      data: config.data ?? null,
      glowIntensity: config.glowIntensity ?? 0.8,
      isPreview: true,           // 标记为预览节点
      pulsePhase: 0,             // 脉冲相位
      dashOffset: 0              // 虚线偏移
    };

    this.previewNodes.set(id, node);
    return node;
  }

  /**
   * 设置预览连线
   */
  setPreviewLines(lines) {
    // lines格式: [{from: nodeId, to: nodeId, color: [r,g,b,a], isDashed: bool, isNew: bool, isRemoved: bool}]
    this.previewLines = lines.map(line => ({
      ...line,
      dashOffset: 0,
      animProgress: 0
    }));
  }

  /**
   * 修改现有节点位置（用于预览布局调整）
   */
  moveNodeForPreview(id, newX, newY, duration = 400) {
    const node = this.nodes.get(id);
    if (!node) return Promise.resolve();

    return this.animateNode(id, { x: newX, y: newY }, duration, 'easeOutCubic');
  }

  /**
   * 批量移动节点（预览布局）
   */
  async animatePreviewLayout(movements, duration = 500) {
    const promises = movements.map(({ id, x, y }) =>
      this.moveNodeForPreview(id, x, y, duration)
    );
    await Promise.all(promises);
  }

  /**
   * 预览渲染循环（带脉冲动画）
   */
  startPreviewRenderLoop() {
    if (!this.previewMode) return;

    const animate = (timestamp) => {
      if (!this.previewMode) return;

      // 更新脉冲时间
      this.previewPulseTime = timestamp * 0.001; // 转换为秒

      // 更新预览节点的脉冲效果
      for (const [, node] of this.previewNodes) {
        // 脉冲缩放效果 (0.95 - 1.05)
        node.pulsePhase = Math.sin(this.previewPulseTime * 3) * 0.05;
        // 虚线动画
        node.dashOffset = (this.previewPulseTime * 20) % 20;
      }

      // 更新预览连线的虚线动画
      for (const line of this.previewLines) {
        if (line.isDashed || line.isNew) {
          line.dashOffset = (this.previewPulseTime * 30) % 30;
          line.animProgress = Math.min(1, (line.animProgress || 0) + 0.02);
        }
        if (line.isRemoved) {
          line.animProgress = Math.max(0, (line.animProgress ?? 1) - 0.02);
        }
      }

      this.renderPreview();

      this.previewRenderLoopId = requestAnimationFrame(animate);
    };

    this.previewRenderLoopId = requestAnimationFrame(animate);
  }

  /**
   * 预览模式渲染
   */
  renderPreview() {
    const gl = this.gl;
    const canvas = this.canvas;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.07, 0.09, 0.15, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 渲染原有连线（可能变暗/虚化）
    this.renderLinesWithPreview();

    // 渲染预览连线（新连线/移除的连线）
    this.renderPreviewLines();

    // 渲染原有节点
    this.renderNodesWithPreview();

    // 渲染预览节点
    this.renderPreviewNodes();

    // 渲染标签
    this.renderLabelsWithPreview();
  }

  /**
   * 渲染带预览效果的连线
   */
  renderLinesWithPreview() {
    const gl = this.gl;
    if (this.lines.length === 0) return;

    gl.useProgram(this.lineProgram);
    gl.uniform2f(this.lineLocations.resolution, this.canvas.width, this.canvas.height);

    for (const line of this.lines) {
      const fromNode = this.nodes.get(line.from);
      const toNode = this.nodes.get(line.to);

      if (!fromNode || !toNode || !fromNode.visible || !toNode.visible) continue;

      // 检查这条连线是否在预览中被标记为移除
      const isBeingRemoved = this.previewLines.some(
        pl => pl.isRemoved && pl.from === line.from && pl.to === line.to
      );

      const vertices = new Float32Array([
        fromNode.x, fromNode.y,
        toNode.x, toNode.y
      ]);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

      gl.enableVertexAttribArray(this.lineLocations.position);
      gl.vertexAttribPointer(this.lineLocations.position, 2, gl.FLOAT, false, 0, 0);

      let color = line.color || [0.66, 0.33, 0.97, 0.6];
      let opacity = Math.min(fromNode.opacity, toNode.opacity);

      // 被移除的连线变暗并逐渐消失
      if (isBeingRemoved) {
        color = [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5, color[3] * 0.3];
        opacity *= 0.4;
      }

      gl.uniform4fv(this.lineLocations.color, color);
      gl.uniform1f(this.lineLocations.opacity, opacity);

      gl.lineWidth(2);
      gl.drawArrays(gl.LINES, 0, 2);
    }
  }

  /**
   * 渲染预览连线（新增的/虚线）
   */
  renderPreviewLines() {
    const gl = this.gl;
    if (this.previewLines.length === 0) return;

    gl.useProgram(this.lineProgram);
    gl.uniform2f(this.lineLocations.resolution, this.canvas.width, this.canvas.height);

    for (const line of this.previewLines) {
      if (line.isRemoved) continue; // 移除的连线已在上面处理

      // 获取起止节点
      let fromNode = this.nodes.get(line.from) || this.previewNodes.get(line.from);
      let toNode = this.nodes.get(line.to) || this.previewNodes.get(line.to);

      if (!fromNode || !toNode) continue;

      // 新连线使用虚线效果（通过分段绘制模拟）
      if (line.isDashed || line.isNew) {
        this.renderDashedLine(fromNode, toNode, line);
      } else {
        const vertices = new Float32Array([
          fromNode.x, fromNode.y,
          toNode.x, toNode.y
        ]);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

        gl.enableVertexAttribArray(this.lineLocations.position);
        gl.vertexAttribPointer(this.lineLocations.position, 2, gl.FLOAT, false, 0, 0);

        const color = line.color || [0.56, 0.78, 0.95, 0.8];
        gl.uniform4fv(this.lineLocations.color, color);
        gl.uniform1f(this.lineLocations.opacity, line.animProgress || 1);

        gl.lineWidth(2);
        gl.drawArrays(gl.LINES, 0, 2);
      }
    }
  }

  /**
   * 渲染虚线
   */
  renderDashedLine(fromNode, toNode, line) {
    const gl = this.gl;
    const dashLength = 10;
    const gapLength = 8;
    const totalLength = dashLength + gapLength;

    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const segments = Math.ceil(length / totalLength);

    const dirX = dx / length;
    const dirY = dy / length;

    const offset = (line.dashOffset || 0) % totalLength;

    const color = line.color || [0.56, 0.78, 0.95, 0.9];
    gl.uniform4fv(this.lineLocations.color, color);
    gl.uniform1f(this.lineLocations.opacity, (line.animProgress || 1) * 0.9);

    for (let i = 0; i < segments + 1; i++) {
      const startDist = i * totalLength - offset;
      const endDist = startDist + dashLength;

      const clampedStart = Math.max(0, startDist);
      const clampedEnd = Math.min(length, endDist);

      if (clampedStart >= clampedEnd || clampedStart >= length) continue;

      const startX = fromNode.x + dirX * clampedStart;
      const startY = fromNode.y + dirY * clampedStart;
      const endX = fromNode.x + dirX * clampedEnd;
      const endY = fromNode.y + dirY * clampedEnd;

      const vertices = new Float32Array([startX, startY, endX, endY]);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.lineLocations.position);
      gl.vertexAttribPointer(this.lineLocations.position, 2, gl.FLOAT, false, 0, 0);

      gl.lineWidth(2);
      gl.drawArrays(gl.LINES, 0, 2);
    }
  }

  /**
   * 渲染带预览效果的节点
   */
  renderNodesWithPreview() {
    const gl = this.gl;

    gl.useProgram(this.nodeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);

    gl.enableVertexAttribArray(this.nodeLocations.position);
    gl.vertexAttribPointer(this.nodeLocations.position, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(this.nodeLocations.texCoord);
    gl.vertexAttribPointer(this.nodeLocations.texCoord, 2, gl.FLOAT, false, 16, 8);

    gl.uniform2f(this.nodeLocations.resolution, this.canvas.width, this.canvas.height);

    const sortedNodes = Array.from(this.nodes.values())
      .filter(n => n.visible && n.opacity > 0)
      .sort((a, b) => a.opacity - b.opacity);

    for (const node of sortedNodes) {
      const colors = NodeColors[node.type] || NodeColors.center;
      const size = node.radius * 2;

      gl.uniform2f(this.nodeLocations.translation, node.x, node.y);
      gl.uniform2f(this.nodeLocations.scale, size * node.scale, size * node.scale);
      gl.uniform1f(this.nodeLocations.rotation, node.rotation);
      gl.uniform4fv(this.nodeLocations.color, colors.base);
      gl.uniform4fv(this.nodeLocations.glowColor, colors.glow);
      gl.uniform1f(this.nodeLocations.glowIntensity,
        this.hoveredNode === node ? 0.8 : node.glowIntensity);
      gl.uniform1f(this.nodeLocations.opacity, node.opacity);
      gl.uniform1i(this.nodeLocations.shapeType, 0);
      gl.uniform2f(this.nodeLocations.size, size, size);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  /**
   * 渲染预览节点（带脉冲动画）
   */
  renderPreviewNodes() {
    const gl = this.gl;

    if (this.previewNodes.size === 0) return;

    gl.useProgram(this.nodeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);

    gl.enableVertexAttribArray(this.nodeLocations.position);
    gl.vertexAttribPointer(this.nodeLocations.position, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(this.nodeLocations.texCoord);
    gl.vertexAttribPointer(this.nodeLocations.texCoord, 2, gl.FLOAT, false, 16, 8);

    gl.uniform2f(this.nodeLocations.resolution, this.canvas.width, this.canvas.height);

    for (const [, node] of this.previewNodes) {
      if (!node.visible) continue;

      const colors = NodeColors.preview;
      const size = node.radius * 2;
      const pulseScale = 1 + (node.pulsePhase || 0); // 脉冲缩放

      gl.uniform2f(this.nodeLocations.translation, node.x, node.y);
      gl.uniform2f(this.nodeLocations.scale, size * node.scale * pulseScale, size * node.scale * pulseScale);
      gl.uniform1f(this.nodeLocations.rotation, node.rotation);
      gl.uniform4fv(this.nodeLocations.color, colors.base);
      gl.uniform4fv(this.nodeLocations.glowColor, colors.glow);
      gl.uniform1f(this.nodeLocations.glowIntensity, 0.6 + Math.abs(node.pulsePhase || 0) * 4);
      gl.uniform1f(this.nodeLocations.opacity, node.opacity * (0.7 + Math.abs(node.pulsePhase || 0) * 2));
      gl.uniform1i(this.nodeLocations.shapeType, 0);
      gl.uniform2f(this.nodeLocations.size, size, size);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  /**
   * 渲染带预览效果的标签
   */
  renderLabelsWithPreview() {
    let labelCanvas = this.labelCanvas;
    if (!labelCanvas) {
      labelCanvas = document.createElement('canvas');
      labelCanvas.style.position = 'absolute';
      labelCanvas.style.top = '0';
      labelCanvas.style.left = '0';
      labelCanvas.style.pointerEvents = 'none';
      labelCanvas.style.zIndex = '1';
      if (this.canvas.parentElement) {
        this.canvas.parentElement.appendChild(labelCanvas);
      }
      this.labelCanvas = labelCanvas;
    }

    labelCanvas.width = this.canvas.width;
    labelCanvas.height = this.canvas.height;
    labelCanvas.style.width = this.canvas.offsetWidth + 'px';
    labelCanvas.style.height = this.canvas.offsetHeight + 'px';

    const ctx = labelCanvas.getContext('2d');
    ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);

    // 渲染原有节点标签
    for (const [, node] of this.nodes) {
      if (!node.visible || node.opacity < 0.3 || !node.label) continue;
      this.renderNodeLabel(ctx, node);
    }

    // 渲染预览节点标签
    for (const [, node] of this.previewNodes) {
      if (!node.visible || !node.label) continue;
      this.renderNodeLabel(ctx, node, true);
    }

    ctx.globalAlpha = 1;
  }

  /**
   * 渲染单个节点的标签
   */
  renderNodeLabel(ctx, node, isPreview = false) {
    ctx.globalAlpha = node.opacity * (isPreview ? 0.9 : 1);
    ctx.fillStyle = isPreview ? '#a5d8ff' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const fontSize = Math.max(12, node.radius * node.scale * 0.35);
    ctx.font = `bold ${fontSize}px sans-serif`;

    let label = node.label;
    const maxWidth = node.radius * node.scale * 1.8;
    while (ctx.measureText(label).width > maxWidth && label.length > 3) {
      label = label.slice(0, -1);
    }
    if (label !== node.label) label += '...';

    ctx.fillText(label, node.x, node.y - fontSize * 0.3);

    // 副标签
    if (node.subLabel || node.knowledgePointValue > 0) {
      ctx.font = `${fontSize * 0.7}px sans-serif`;
      ctx.fillStyle = isPreview ? '#74c0fc' : '#e9d5ff';
      const subLabel = node.knowledgePointValue > 0
        ? `${node.knowledgePointValue.toFixed(2)} 知识点`
        : node.subLabel;
      ctx.fillText(subLabel, node.x, node.y + fontSize * 0.6);
    }

    // 预览节点添加"待审核"标识
    if (isPreview) {
      ctx.font = `${fontSize * 0.6}px sans-serif`;
      ctx.fillStyle = '#ffd43b';
      ctx.fillText('(待审核)', node.x, node.y + fontSize * 1.3);
    }
  }

  // 销毁
  destroy() {
    // 停止所有渲染循环
    this.renderingLoop = false;
    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }

    // 停止预览渲染循环
    if (this.previewRenderLoopId) {
      cancelAnimationFrame(this.previewRenderLoopId);
      this.previewRenderLoopId = null;
    }

    if (this.labelCanvas) {
      this.labelCanvas.remove();
    }
    this.animations = [];
    this.nodes.clear();
    this.nodeButtons.clear();
    this.previewNodes.clear();
    this.previewLines = [];
    this.savedState = null;
  }
}

export { WebGLNodeRenderer, Easing, NodeColors };
