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
  search: { base: [0.23, 0.51, 0.96, 1], glow: [0.15, 0.40, 0.85, 1] }     // 蓝色
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
    this.lastTime = 0;

    // 交互状态
    this.hoveredNode = null;
    this.selectedNode = null;
    this.onClick = null;

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

      this.hoveredNode = this.hitTest(x, y);
      canvas.style.cursor = this.hoveredNode ? 'pointer' : 'default';
    });

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      const clickedNode = this.hitTest(x, y);
      if (clickedNode && this.onClick) {
        this.onClick(clickedNode);
      }
    });
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
  }

  // 设置连线
  setLines(lines) {
    this.lines = lines; // [{from: nodeId, to: nodeId, color: [r,g,b,a]}]
  }

  // 动画节点到新位置
  animateNode(id, target, duration = 600, easing = 'easeOutCubic') {
    const node = this.nodes.get(id);
    if (!node) return Promise.resolve();

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
        onComplete: resolve
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

    // 最后渲染文字 (使用2D Canvas叠加)
    this.renderLabels();
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

      // 副标签 (知识点等)
      if (node.subLabel) {
        ctx.font = `${fontSize * 0.7}px sans-serif`;
        ctx.fillStyle = '#e9d5ff';
        ctx.fillText(node.subLabel, node.x, node.y + fontSize * 0.6);
      }
    }

    ctx.globalAlpha = 1;
  }

  // 调整大小
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.render();
  }

  // 销毁
  destroy() {
    if (this.labelCanvas) {
      this.labelCanvas.remove();
    }
    this.animations = [];
    this.nodes.clear();
  }
}

export { WebGLNodeRenderer, Easing, NodeColors };
