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
  uniform vec4 u_secondaryColor;
  uniform vec4 u_rimColor;
  uniform vec4 u_glowColor;
  uniform float u_glowIntensity;
  uniform float u_opacity;
  uniform int u_shapeType; // 0: 圆形, 1: 矩形
  uniform int u_patternType; // 0:none 1:dots 2:grid 3:diagonal 4:rings 5:noise
  uniform vec2 u_size;

  varying vec2 v_texCoord;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float getPattern(vec2 uv, vec2 pos) {
    if (u_patternType == 1) {
      vec2 g = fract(uv * 10.0);
      return step(length(g - 0.5), 0.18);
    }
    if (u_patternType == 2) {
      vec2 g = abs(fract(uv * 8.0) - 0.5);
      return step(min(g.x, g.y), 0.06);
    }
    if (u_patternType == 3) {
      float d = fract((uv.x + uv.y) * 9.0);
      return step(d, 0.18);
    }
    if (u_patternType == 4) {
      float r = length(pos) * 14.0;
      return step(fract(r), 0.13);
    }
    if (u_patternType == 5) {
      return step(0.72, hash(floor(uv * 36.0)));
    }
    return 0.0;
  }

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

    float sphereMask = 1.0 - smoothstep(0.93, 1.0, dist);
    if (sphereMask <= 0.01) discard;

    float d = min(dist, 0.999);
    float z = sqrt(max(0.0, 1.0 - d * d));
    vec3 normal = normalize(vec3(pos * 1.15, z));
    vec3 lightDir = normalize(vec3(-0.55, -0.60, 1.0));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float ambient = 0.25;
    float shade = ambient + diffuse * 0.75;
    vec4 baseColor = mix(u_secondaryColor, u_color, shade);

    // 镜面高光
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 22.0);
    baseColor.rgb += spec * 0.28;

    // 边缘高光
    float rim = pow(1.0 - z, 1.8);
    baseColor = mix(baseColor, u_rimColor, rim * 0.55);

    // 底纹
    float pattern = getPattern(v_texCoord, pos);
    baseColor.rgb = mix(baseColor.rgb, u_rimColor.rgb, pattern * 0.16);

    // 发光效果
    float glow = 1.0 - smoothstep(0.0, 1.0, dist);
    float glowEffect = pow(glow, 2.0) * u_glowIntensity;

    // 混合发光
    vec4 finalColor = mix(baseColor, u_glowColor, glowEffect * 0.38);
    finalColor.a = sphereMask * u_opacity;

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

const DEFAULT_UNALLIED_NODE_VISUAL_STYLE = {
  primaryColor: '#6f8fb1',
  secondaryColor: '#2f3f52',
  glowColor: '#b6d7ff',
  rimColor: '#e2ecff',
  textColor: '#f1f5f9',
  patternType: 'noise'
};

const DEFAULT_ALLIANCE_NODE_VISUAL_STYLE = {
  primaryColor: '#7c3aed',
  secondaryColor: '#312e81',
  glowColor: '#c084fc',
  rimColor: '#f5d0fe',
  textColor: '#ffffff',
  patternType: 'diagonal'
};

const PATTERN_TYPE_MAP = {
  none: 0,
  dots: 1,
  grid: 2,
  diagonal: 3,
  rings: 4,
  noise: 5
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const normalizeHexColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
};

const hexToVec4 = (hex, alpha = 1) => {
  const normalized = normalizeHexColor(hex, '#ffffff').slice(1);
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  return [r, g, b, alpha];
};

const blendHexColors = (hexA, hexB, ratio = 0.5) => {
  const colorA = hexToVec4(hexA, 1);
  const colorB = hexToVec4(hexB, 1);
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round((colorA[0] * (1 - t) + colorB[0] * t) * 255).toString(16).padStart(2, '0');
  const g = Math.round((colorA[1] * (1 - t) + colorB[1] * t) * 255).toString(16).padStart(2, '0');
  const b = Math.round((colorA[2] * (1 - t) + colorB[2] * t) * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
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
    this.onDoubleClick = null;
    this.onButtonClick = null; // 按钮点击回调

    // 相机状态（仅平移 + 缩放，禁用旋转）
    this.camera = {
      offsetX: 0,
      offsetY: 0,
      zoom: 1
    };

    // 拖拽平移状态
    this.dragState = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      startOffsetX: 0,
      startOffsetY: 0,
      moved: false,
      suppressClick: false
    };

    // 用户位置与移动动画状态
    this.userState = {
      locationName: '',
      travelStatus: null,
      syncedAt: 0
    };

    // DOM 标签缓存
    this.labelElements = new Map();

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
      secondaryColor: gl.getUniformLocation(this.nodeProgram, 'u_secondaryColor'),
      rimColor: gl.getUniformLocation(this.nodeProgram, 'u_rimColor'),
      glowColor: gl.getUniformLocation(this.nodeProgram, 'u_glowColor'),
      glowIntensity: gl.getUniformLocation(this.nodeProgram, 'u_glowIntensity'),
      opacity: gl.getUniformLocation(this.nodeProgram, 'u_opacity'),
      shapeType: gl.getUniformLocation(this.nodeProgram, 'u_shapeType'),
      patternType: gl.getUniformLocation(this.nodeProgram, 'u_patternType'),
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

  getCanvasPositionFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (event.clientY - rect.top) * (this.canvas.height / rect.height)
    };
  }

  worldToScreen(x, y) {
    return {
      x: x * this.camera.zoom + this.camera.offsetX,
      y: y * this.camera.zoom + this.camera.offsetY
    };
  }

  screenToWorld(x, y) {
    return {
      x: (x - this.camera.offsetX) / this.camera.zoom,
      y: (y - this.camera.offsetY) / this.camera.zoom
    };
  }

  setUserState({ locationName = '', travelStatus = null } = {}) {
    this.userState = {
      locationName: locationName || '',
      travelStatus: travelStatus && typeof travelStatus === 'object' ? { ...travelStatus } : null,
      syncedAt: performance.now()
    };

    if (!this.previewMode) {
      this.render();
    }
  }

  setCameraOffset(offsetX, offsetY) {
    this.camera.offsetX = offsetX;
    this.camera.offsetY = offsetY;
    this.render();
  }

  updateHoverState(x, y) {
    const prevHoveredButton = this.hoveredButton;
    this.hoveredButton = this.hitTestButton(x, y);
    if (this.hoveredButton) {
      this.hoveredNode = null;
      this.canvas.style.cursor = 'pointer';
    } else {
      this.hoveredNode = this.hitTest(x, y);
      this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'default';
    }

    const buttonHoverChanged = (prevHoveredButton !== this.hoveredButton) ||
      (prevHoveredButton && this.hoveredButton &&
        (prevHoveredButton.nodeId !== this.hoveredButton.nodeId ||
         prevHoveredButton.button.id !== this.hoveredButton.button.id));

    if (buttonHoverChanged && this.nodeButtons.size > 0) {
      this.render();
    }
  }

  bindEvents() {
    const canvas = this.canvas;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const pos = this.getCanvasPositionFromEvent(event);
      this.dragState.active = true;
      this.dragState.pointerId = event.pointerId;
      this.dragState.startX = pos.x;
      this.dragState.startY = pos.y;
      this.dragState.startOffsetX = this.camera.offsetX;
      this.dragState.startOffsetY = this.camera.offsetY;
      this.dragState.moved = false;
      canvas.style.cursor = 'grabbing';
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
      const pos = this.getCanvasPositionFromEvent(event);
      const draggingSamePointer = this.dragState.active && this.dragState.pointerId === event.pointerId;

      if (draggingSamePointer) {
        const dx = pos.x - this.dragState.startX;
        const dy = pos.y - this.dragState.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          this.dragState.moved = true;
        }
        this.camera.offsetX = this.dragState.startOffsetX + dx;
        this.camera.offsetY = this.dragState.startOffsetY + dy;
        this.render();
        return;
      }

      this.updateHoverState(pos.x, pos.y);
    });

    canvas.addEventListener('pointerup', (event) => {
      if (!this.dragState.active || this.dragState.pointerId !== event.pointerId) return;

      canvas.releasePointerCapture(event.pointerId);
      this.dragState.active = false;
      this.dragState.pointerId = null;
      if (this.dragState.moved) {
        this.dragState.suppressClick = true;
        setTimeout(() => {
          this.dragState.suppressClick = false;
        }, 0);
      }

      const pos = this.getCanvasPositionFromEvent(event);
      this.updateHoverState(pos.x, pos.y);
    });

    canvas.addEventListener('pointercancel', (event) => {
      if (!this.dragState.active || this.dragState.pointerId !== event.pointerId) return;
      this.dragState.active = false;
      this.dragState.pointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      canvas.style.cursor = 'default';
    });

    canvas.addEventListener('click', (event) => {
      if (this.dragState.suppressClick) return;
      const pos = this.getCanvasPositionFromEvent(event);

      // 先检测按钮点击
      const clickedButton = this.hitTestButton(pos.x, pos.y);
      if (clickedButton && this.onButtonClick) {
        this.onButtonClick(clickedButton.nodeId, clickedButton.button);
        return;
      }

      const clickedNode = this.hitTest(pos.x, pos.y);
      if (clickedNode && this.onClick) {
        this.onClick(clickedNode);
      }
    });

    canvas.addEventListener('dblclick', (event) => {
      if (this.dragState.suppressClick) return;
      const pos = this.getCanvasPositionFromEvent(event);
      const clickedNode = this.hitTest(pos.x, pos.y);
      if (clickedNode && this.onDoubleClick) {
        this.onDoubleClick(clickedNode);
      }
    });
  }

  hitTestButton(x, y) {
    const buttonRadius = 18; // 按钮半径

    for (const [nodeId, buttons] of this.nodeButtons) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.visible || node.opacity < 0.5) continue;

      for (const button of buttons) {
        if (button.disabled) continue;
        const btnPos = this.getButtonPosition(node, button.angle);
        const dx = x - btnPos.x;
        const dy = y - btnPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= buttonRadius * node.scale * this.camera.zoom) {
          return { nodeId, button, node };
        }
      }
    }
    return null;
  }

  getButtonWorldPosition(node, angle) {
    // 按钮位置在节点边缘外侧
    const distance = node.radius * node.scale + 25;
    return {
      x: node.x + Math.cos(angle) * distance,
      y: node.y + Math.sin(angle) * distance
    };
  }

  getButtonPosition(node, angle) {
    const worldPos = this.getButtonWorldPosition(node, angle);
    return this.worldToScreen(worldPos.x, worldPos.y);
  }

  hitTest(x, y) {
    const worldPos = this.screenToWorld(x, y);

    for (const [, node] of this.nodes) {
      if (!node.visible) continue;

      const dx = worldPos.x - node.x;
      const dy = worldPos.y - node.y;
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
      data: config.data ?? existing?.data ?? null,
      visualStyle: config.visualStyle ?? existing?.visualStyle ?? config.data?.visualStyle ?? existing?.data?.visualStyle ?? null,
      labelColor: config.labelColor ?? existing?.labelColor ?? config.visualStyle?.textColor ?? config.data?.visualStyle?.textColor ?? existing?.labelColor ?? '',
      glowIntensity: config.glowIntensity ?? existing?.glowIntensity ?? 0.5,
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

  resolveNodeRenderStyle(node) {
    if (node?.type === 'preview') {
      const previewColors = NodeColors.preview;
      return {
        base: previewColors.base,
        secondary: [0.20, 0.39, 0.63, 1],
        rim: [0.90, 0.97, 1, 1],
        glow: previewColors.glow,
        patternType: PATTERN_TYPE_MAP.none,
        textColor: '#a5d8ff',
        subTextColor: '#74c0fc',
        opacityFactor: 1
      };
    }

    const visualStyle = node?.visualStyle || node?.data?.visualStyle || null;
    if (visualStyle) {
      const primary = normalizeHexColor(visualStyle.primaryColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.primaryColor);
      const secondary = normalizeHexColor(visualStyle.secondaryColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.secondaryColor);
      const glow = normalizeHexColor(visualStyle.glowColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.glowColor);
      const rim = normalizeHexColor(visualStyle.rimColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.rimColor);
      const textColor = normalizeHexColor(visualStyle.textColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.textColor);
      const patternType = typeof visualStyle.patternType === 'string'
        ? visualStyle.patternType.trim().toLowerCase()
        : DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.patternType;
      return {
        base: hexToVec4(primary, 1),
        secondary: hexToVec4(secondary, 1),
        rim: hexToVec4(rim, 1),
        glow: hexToVec4(glow, 1),
        patternType: PATTERN_TYPE_MAP[patternType] ?? PATTERN_TYPE_MAP.diagonal,
        textColor,
        subTextColor: blendHexColors(textColor, '#cbd5e1', 0.45),
        opacityFactor: 1
      };
    }

    const isKnowledgeDomainNode = ['root', 'featured', 'center', 'parent', 'child', 'search'].includes(node?.type);
    if (isKnowledgeDomainNode) {
      return {
        base: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.primaryColor, 1),
        secondary: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.secondaryColor, 1),
        rim: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.rimColor, 1),
        glow: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.glowColor, 1),
        patternType: PATTERN_TYPE_MAP[DEFAULT_UNALLIED_NODE_VISUAL_STYLE.patternType],
        textColor: DEFAULT_UNALLIED_NODE_VISUAL_STYLE.textColor,
        subTextColor: blendHexColors(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.textColor, '#bfdbfe', 0.45),
        opacityFactor: 0.78
      };
    }

    const fallback = NodeColors[node?.type] || NodeColors.center;
    return {
      base: fallback.base,
      secondary: [
        Math.max(0, fallback.base[0] * 0.42),
        Math.max(0, fallback.base[1] * 0.42),
        Math.max(0, fallback.base[2] * 0.42),
        1
      ],
      rim: [
        Math.min(1, fallback.base[0] * 1.22),
        Math.min(1, fallback.base[1] * 1.22),
        Math.min(1, fallback.base[2] * 1.22),
        1
      ],
      glow: fallback.glow,
      patternType: PATTERN_TYPE_MAP.none,
      textColor: node?.labelColor || '#ffffff',
      subTextColor: '#e9d5ff',
      opacityFactor: 1
    };
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

    // 先同步非数值动画字段，避免样式和文案在动画后才生效
    const staticKeys = ['type', 'label', 'data', 'visualStyle', 'labelColor', 'visible'];
    staticKeys.forEach((key) => {
      if (target[key] !== undefined) {
        node[key] = target[key];
      }
    });

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
          radius: node.radius,
          scale: node.scale,
          opacity: node.opacity,
          rotation: node.rotation
        },
        end: {
          x: target.x ?? node.x,
          y: target.y ?? node.y,
          radius: target.radius ?? node.radius,
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
        node.radius = anim.start.radius + (anim.end.radius - anim.start.radius) * easedProgress;
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

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.07, 0.09, 0.15, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 先渲染连线
    this.renderLines();

    // 再渲染节点
    this.renderNodes();

    // 渲染节点操作按钮
    this.renderNodeButtons();

    // 渲染标签与2D overlay
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
    if (this.previewMode) {
      this.renderingLoop = false;
      return;
    }

    // 如果没有节点或者在动画中，停止循环
    if (this.nodes.size === 0 || this.animating) {
      this.renderingLoop = false;
      return;
    }

    // 每帧刷新overlay动画（按钮图标、用户标记、移动亮点）
    this.renderOverlayCanvas();

    // 继续下一帧
    this.renderLoopId = requestAnimationFrame(() => this.startRenderLoop());
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
      const fromPos = this.worldToScreen(fromNode.x, fromNode.y);
      const toPos = this.worldToScreen(toNode.x, toNode.y);

      const vertices = new Float32Array([
        fromPos.x, fromPos.y,
        toPos.x, toPos.y
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
      const style = this.resolveNodeRenderStyle(node);

      const size = node.radius * 2 * this.camera.zoom;
      const nodePos = this.worldToScreen(node.x, node.y);
      gl.uniform2f(this.nodeLocations.translation, nodePos.x, nodePos.y);
      gl.uniform2f(this.nodeLocations.scale, size * node.scale, size * node.scale);
      gl.uniform1f(this.nodeLocations.rotation, node.rotation);
      gl.uniform4fv(this.nodeLocations.color, style.base);
      gl.uniform4fv(this.nodeLocations.secondaryColor, style.secondary);
      gl.uniform4fv(this.nodeLocations.rimColor, style.rim);
      gl.uniform4fv(this.nodeLocations.glowColor, style.glow);
      gl.uniform1f(this.nodeLocations.glowIntensity,
        this.hoveredNode === node ? 0.8 : node.glowIntensity);
      gl.uniform1f(this.nodeLocations.opacity, node.opacity * (style.opacityFactor ?? 1));
      gl.uniform1i(this.nodeLocations.shapeType, 0); // 圆形
      gl.uniform1i(this.nodeLocations.patternType, style.patternType ?? PATTERN_TYPE_MAP.none);
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
        const isDisabled = !!button.disabled;

        // 按钮尺寸
        const btnSize = isHovered && !isDisabled ? 38 : 32;

        // 按钮颜色 - 使用更柔和的颜色
        const baseColor = button.color || [0.66, 0.33, 0.97, 1];
        const glowColor = isDisabled
          ? [baseColor[0], baseColor[1], baseColor[2], 0.35]
          : [baseColor[0] * 1.2, baseColor[1] * 1.2, baseColor[2] * 1.2, 0.8];

        gl.uniform2f(this.nodeLocations.translation, btnPos.x, btnPos.y);
        gl.uniform2f(this.nodeLocations.scale, btnSize * this.camera.zoom, btnSize * this.camera.zoom);
        gl.uniform1f(this.nodeLocations.rotation, 0);
        gl.uniform4fv(this.nodeLocations.color, baseColor);
        gl.uniform4fv(this.nodeLocations.secondaryColor, [
          Math.max(0, baseColor[0] * 0.45),
          Math.max(0, baseColor[1] * 0.45),
          Math.max(0, baseColor[2] * 0.45),
          baseColor[3] || 1
        ]);
        gl.uniform4fv(this.nodeLocations.rimColor, [
          Math.min(1, baseColor[0] * 1.2),
          Math.min(1, baseColor[1] * 1.2),
          Math.min(1, baseColor[2] * 1.2),
          1
        ]);
        gl.uniform4fv(this.nodeLocations.glowColor, glowColor);
        gl.uniform1f(this.nodeLocations.glowIntensity, isDisabled ? 0.05 : 0.3);
        gl.uniform1f(this.nodeLocations.opacity, node.opacity * (isDisabled ? 0.45 : 0.8));
        gl.uniform1i(this.nodeLocations.shapeType, 0); // 圆形
        gl.uniform1i(this.nodeLocations.patternType, PATTERN_TYPE_MAP.none);
        gl.uniform2f(this.nodeLocations.size, btnSize, btnSize);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }

  ensureOverlayCanvas() {
    let overlayCanvas = this.overlayCanvas;
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.top = '0';
      overlayCanvas.style.left = '0';
      overlayCanvas.style.pointerEvents = 'none';
      overlayCanvas.style.zIndex = '1';
      if (this.canvas.parentElement) {
        this.canvas.parentElement.appendChild(overlayCanvas);
      }
      this.overlayCanvas = overlayCanvas;
    }

    overlayCanvas.width = this.canvas.width;
    overlayCanvas.height = this.canvas.height;
    overlayCanvas.style.width = `${this.canvas.offsetWidth}px`;
    overlayCanvas.style.height = `${this.canvas.offsetHeight}px`;
    return overlayCanvas;
  }

  ensureLabelOverlay() {
    let labelOverlay = this.labelOverlay;
    if (!labelOverlay) {
      labelOverlay = document.createElement('div');
      labelOverlay.className = 'webgl-node-label-layer';
      if (this.canvas.parentElement) {
        this.canvas.parentElement.appendChild(labelOverlay);
      }
      this.labelOverlay = labelOverlay;
    }
    return labelOverlay;
  }

  renderLabels(includePreview = false) {
    const normalNodes = Array.from(this.nodes.values()).filter((node) => (
      node.visible && node.opacity > 0.3 && node.label
    ));
    const previewNodes = includePreview
      ? Array.from(this.previewNodes.values()).filter((node) => node.visible && node.label)
      : [];

    const labelOverlay = this.ensureLabelOverlay();
    const liveKeys = new Set();

    const syncLabel = (node, isPreview) => {
      const key = `${isPreview ? 'preview:' : 'node:'}${node.id}`;
      liveKeys.add(key);
      let labelEl = this.labelElements.get(key);
      if (!labelEl) {
        labelEl = document.createElement('div');
        labelEl.className = `webgl-node-label${isPreview ? ' is-preview' : ''}`;
        labelOverlay.appendChild(labelEl);
        this.labelElements.set(key, labelEl);
      }

      const nodePos = this.worldToScreen(node.x, node.y);
      const maxWidth = Math.max(80, node.radius * node.scale * this.camera.zoom * 1.7);

      labelEl.textContent = node.label;
      labelEl.style.left = `${nodePos.x}px`;
      labelEl.style.top = `${nodePos.y}px`;
      labelEl.style.maxWidth = `${maxWidth}px`;
      labelEl.style.opacity = `${Math.max(0, Math.min(1, node.opacity))}`;
    };

    normalNodes.forEach((node) => syncLabel(node, false));
    previewNodes.forEach((node) => syncLabel(node, true));

    for (const [key, labelEl] of this.labelElements) {
      if (liveKeys.has(key)) continue;
      labelEl.remove();
      this.labelElements.delete(key);
    }

    this.renderOverlayCanvas();
  }

  renderOverlayCanvas() {
    const overlayCanvas = this.ensureOverlayCanvas();
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    this.renderButtonIcons(ctx);
    this.renderUserTravelDot(ctx);
    this.renderUserConeMarker(ctx);

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
        const isDisabled = !!button.disabled;

        ctx.globalAlpha = node.opacity * (isDisabled ? 0.55 : 0.9);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 绘制图标
        const iconSize = isHovered && !isDisabled ? 16 : 14;
        ctx.font = `${iconSize}px sans-serif`;
        ctx.fillStyle = isDisabled ? '#cbd5e1' : '#ffffff';

        // 使用简单的符号作为图标
        const icon = button.icon || '→';
        ctx.fillText(icon, btnPos.x, btnPos.y);

        // 如果悬停，显示tooltip（禁用按钮同样提示）
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

  findVisibleNodeByName(nodeName) {
    if (!nodeName) return null;
    const target = String(nodeName).trim();
    if (!target) return null;

    for (const [, node] of this.nodes) {
      if (!node.visible) continue;
      const name = node?.data?.name || node.label || '';
      if (name === target) {
        return node;
      }
    }
    return null;
  }

  resolveTravelSegment(nowMs) {
    const travel = this.userState.travelStatus;
    if (!travel?.isTraveling) return null;

    const elapsed = Math.max(0, (nowMs - (this.userState.syncedAt || nowMs)) / 1000);
    const baseProgress = Math.max(0, Math.min(1, Number(travel.progressInCurrentSegment) || 0));

    if (travel.isStopping) {
      const duration = Math.max(0.001, Number(travel.stopDurationSeconds) || Number(travel.unitDurationSeconds) || 1);
      const progress = Math.max(0, Math.min(1, baseProgress + elapsed / duration));
      return {
        progress,
        fromName: travel?.lastReachedNode?.nodeName || travel?.stopFromNode?.nodeName || '',
        toName: travel?.nextNode?.nodeName || travel?.targetNode?.nodeName || ''
      };
    }

    const unitDuration = Math.max(0.001, Number(travel.unitDurationSeconds) || 1);
    const path = Array.isArray(travel.path) ? travel.path : [];
    if (path.length >= 2) {
      const totalSegments = path.length - 1;
      const startSegment = Math.max(0, Number(travel.currentSegmentIndex) || 0);
      const globalProgress = startSegment + baseProgress + elapsed / unitDuration;
      const clampedGlobal = Math.max(0, Math.min(totalSegments, globalProgress));
      const segmentIndex = Math.min(totalSegments - 1, Math.floor(clampedGlobal));
      const segmentProgress = Math.max(0, Math.min(1, clampedGlobal - segmentIndex));

      return {
        progress: segmentProgress,
        fromName: path[segmentIndex]?.nodeName || '',
        toName: path[segmentIndex + 1]?.nodeName || ''
      };
    }

    const fallbackProgress = Math.max(0, Math.min(1, baseProgress + elapsed / unitDuration));
    return {
      progress: fallbackProgress,
      fromName: travel?.lastReachedNode?.nodeName || '',
      toName: travel?.nextNode?.nodeName || ''
    };
  }

  renderUserTravelDot(ctx) {
    const segment = this.resolveTravelSegment(performance.now());
    if (!segment) return false;

    const fromNode = this.findVisibleNodeByName(segment.fromName);
    const toNode = this.findVisibleNodeByName(segment.toName);
    if (!fromNode || !toNode) return false;

    const px = fromNode.x + (toNode.x - fromNode.x) * segment.progress;
    const py = fromNode.y + (toNode.y - fromNode.y) * segment.progress;

    const fromPos = this.worldToScreen(fromNode.x, fromNode.y);
    const toPos = this.worldToScreen(toNode.x, toNode.y);
    const dotPos = this.worldToScreen(px, py);

    const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.12;
    const radius = 4.5 * pulse;

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fromPos.x, fromPos.y);
    ctx.lineTo(toPos.x, toPos.y);
    ctx.stroke();

    const glow = ctx.createRadialGradient(dotPos.x, dotPos.y, 0, dotPos.x, dotPos.y, radius * 5);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    glow.addColorStop(0.35, 'rgba(56, 189, 248, 0.9)');
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(dotPos.x, dotPos.y, radius * 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(dotPos.x, dotPos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return true;
  }

  renderUserConeMarker(ctx) {
    if (this.userState?.travelStatus?.isTraveling) return;

    const node = this.findVisibleNodeByName(this.userState.locationName);
    if (!node) return;

    const nodePos = this.worldToScreen(node.x, node.y);
    const bob = Math.sin(performance.now() * 0.006) * 3.5;
    const pulse = 1 + Math.sin(performance.now() * 0.01) * 0.09;
    const baseY = nodePos.y - node.radius * node.scale * this.camera.zoom - 10 + bob;
    const coneHeight = 16 * pulse;
    const coneWidth = 10 * pulse;

    ctx.save();
    const glow = ctx.createRadialGradient(nodePos.x, baseY, 0, nodePos.x, baseY, 26);
    glow.addColorStop(0, 'rgba(34, 211, 238, 0.85)');
    glow.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(nodePos.x, baseY, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(99, 102, 241, 0.92)';
    ctx.beginPath();
    ctx.moveTo(nodePos.x, baseY - coneHeight);
    ctx.lineTo(nodePos.x - coneWidth, baseY + coneHeight * 0.12);
    ctx.lineTo(nodePos.x + coneWidth, baseY + coneHeight * 0.12);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(186, 230, 253, 0.95)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
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

    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }
    this.renderingLoop = false;

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
    this.renderLabels(true);
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
      const fromPos = this.worldToScreen(fromNode.x, fromNode.y);
      const toPos = this.worldToScreen(toNode.x, toNode.y);

      const vertices = new Float32Array([
        fromPos.x, fromPos.y,
        toPos.x, toPos.y
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
        const fromPos = this.worldToScreen(fromNode.x, fromNode.y);
        const toPos = this.worldToScreen(toNode.x, toNode.y);
        const vertices = new Float32Array([
          fromPos.x, fromPos.y,
          toPos.x, toPos.y
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

    const fromPos = this.worldToScreen(fromNode.x, fromNode.y);
    const toPos = this.worldToScreen(toNode.x, toNode.y);
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
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

      const startX = fromPos.x + dirX * clampedStart;
      const startY = fromPos.y + dirY * clampedStart;
      const endX = fromPos.x + dirX * clampedEnd;
      const endY = fromPos.y + dirY * clampedEnd;

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
      const style = this.resolveNodeRenderStyle(node);
      const size = node.radius * 2 * this.camera.zoom;
      const nodePos = this.worldToScreen(node.x, node.y);

      gl.uniform2f(this.nodeLocations.translation, nodePos.x, nodePos.y);
      gl.uniform2f(this.nodeLocations.scale, size * node.scale, size * node.scale);
      gl.uniform1f(this.nodeLocations.rotation, node.rotation);
      gl.uniform4fv(this.nodeLocations.color, style.base);
      gl.uniform4fv(this.nodeLocations.secondaryColor, style.secondary);
      gl.uniform4fv(this.nodeLocations.rimColor, style.rim);
      gl.uniform4fv(this.nodeLocations.glowColor, style.glow);
      gl.uniform1f(this.nodeLocations.glowIntensity,
        this.hoveredNode === node ? 0.8 : node.glowIntensity);
      gl.uniform1f(this.nodeLocations.opacity, node.opacity * (style.opacityFactor ?? 1));
      gl.uniform1i(this.nodeLocations.shapeType, 0);
      gl.uniform1i(this.nodeLocations.patternType, style.patternType ?? PATTERN_TYPE_MAP.none);
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
      const size = node.radius * 2 * this.camera.zoom;
      const pulseScale = 1 + (node.pulsePhase || 0); // 脉冲缩放
      const nodePos = this.worldToScreen(node.x, node.y);

      gl.uniform2f(this.nodeLocations.translation, nodePos.x, nodePos.y);
      gl.uniform2f(this.nodeLocations.scale, size * node.scale * pulseScale, size * node.scale * pulseScale);
      gl.uniform1f(this.nodeLocations.rotation, node.rotation);
      gl.uniform4fv(this.nodeLocations.color, colors.base);
      gl.uniform4fv(this.nodeLocations.secondaryColor, [0.19, 0.38, 0.62, 1]);
      gl.uniform4fv(this.nodeLocations.rimColor, [0.89, 0.96, 1, 1]);
      gl.uniform4fv(this.nodeLocations.glowColor, colors.glow);
      gl.uniform1f(this.nodeLocations.glowIntensity, 0.6 + Math.abs(node.pulsePhase || 0) * 4);
      gl.uniform1f(this.nodeLocations.opacity, node.opacity * (0.7 + Math.abs(node.pulsePhase || 0) * 2));
      gl.uniform1i(this.nodeLocations.shapeType, 0);
      gl.uniform1i(this.nodeLocations.patternType, PATTERN_TYPE_MAP.none);
      gl.uniform2f(this.nodeLocations.size, size, size);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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

    if (this.overlayCanvas) {
      this.overlayCanvas.remove();
    }
    if (this.labelOverlay) {
      this.labelOverlay.remove();
    }
    this.labelElements.clear();
    this.animations = [];
    this.nodes.clear();
    this.nodeButtons.clear();
    this.previewNodes.clear();
    this.previewLines = [];
    this.savedState = null;
  }
}

export { WebGLNodeRenderer, Easing, NodeColors };
