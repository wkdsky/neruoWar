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
  uniform float u_shapeMorph;
  uniform int u_shapeType; // 0: 圆形, 1: 矩形, 2: 六边形
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
    float circleDist = length(pos) * 2.0;
    vec2 absHexPos = abs(pos * 2.0);
    float hexDist = max(dot(absHexPos, normalize(vec2(1.0, 1.7320508))), absHexPos.x);

    float dist;
    if (u_shapeType == 0) {
      // 圆形
      dist = circleDist;
    } else if (u_shapeType == 2) {
      dist = mix(hexDist, circleDist, clamp(u_shapeMorph, 0.0, 1.0));
    } else {
      // 矩形
      vec2 absPos = abs(pos) * 2.0;
      dist = max(absPos.x, absPos.y);
    }

    float edgeSoftness = mix(0.028, 0.07, clamp(u_shapeMorph, 0.0, 1.0));
    float sphereMask = 1.0 - smoothstep(0.94 - edgeSoftness, 1.0, dist);
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

const HOME_ROOT_HEX_STYLE = {
  primaryColor: '#6ba8dc',
  secondaryColor: '#11283d',
  glowColor: '#8fe7ff',
  rimColor: '#f5fbff',
  textColor: '#eef6ff',
  patternType: 'grid'
};

const HOME_FEATURED_HEX_STYLE = {
  primaryColor: '#d5a35d',
  secondaryColor: '#3b2719',
  glowColor: '#ffd38d',
  rimColor: '#fff4d8',
  textColor: '#fff6e8',
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

const mixVec4 = (colorA = [1, 1, 1, 1], colorB = [1, 1, 1, 1], ratio = 0.5) => {
  const t = Math.max(0, Math.min(1, ratio));
  return [
    colorA[0] * (1 - t) + colorB[0] * t,
    colorA[1] * (1 - t) + colorB[1] * t,
    colorA[2] * (1 - t) + colorB[2] * t,
    colorA[3] * (1 - t) + colorB[3] * t
  ];
};

const ROLE_ACCENT_MAP = {
  center: {
    glow: hexToVec4('#8fe7ff', 1),
    rim: hexToVec4('#f3fbff', 1),
    patternType: PATTERN_TYPE_MAP.rings,
    opacityFactor: 1,
    subTextColor: '#d8f7ff'
  },
  parent: {
    glow: hexToVec4('#6df5c0', 1),
    rim: hexToVec4('#dcfff3', 1),
    patternType: PATTERN_TYPE_MAP.grid,
    opacityFactor: 0.92,
    subTextColor: '#c4ffeb'
  },
  child: {
    glow: hexToVec4('#ffd875', 1),
    rim: hexToVec4('#fff6d5', 1),
    patternType: PATTERN_TYPE_MAP.dots,
    opacityFactor: 0.9,
    subTextColor: '#fff0b4'
  },
  title: {
    glow: hexToVec4('#91caff', 1),
    rim: hexToVec4('#e5f2ff', 1),
    patternType: PATTERN_TYPE_MAP.rings,
    opacityFactor: 0.88,
    subTextColor: '#d5e8ff'
  },
  search: {
    glow: hexToVec4('#6ab4ff', 1),
    rim: hexToVec4('#e0efff', 1),
    patternType: PATTERN_TYPE_MAP.diagonal,
    opacityFactor: 0.9,
    subTextColor: '#d6e9ff'
  }
};

const applyRoleAccent = (style, type = '') => {
  const accent = ROLE_ACCENT_MAP[type];
  if (!accent) return style;
  return {
    ...style,
    glow: mixVec4(style.glow, accent.glow, 0.6),
    rim: mixVec4(style.rim, accent.rim, 0.72),
    patternType: accent.patternType ?? style.patternType,
    opacityFactor: accent.opacityFactor ?? style.opacityFactor,
    subTextColor: accent.subTextColor || style.subTextColor
  };
};

const readMapDebugFlag = () => {
  if (typeof window === 'undefined') return false;
  const value = new URLSearchParams(window.location.search).get('mapDebug');
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
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
    this.sceneType = 'home'; // 'home' | 'nodeDetail' | 'titleDetail'
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
    this.onLineClick = null; // 连线点击回调
    this.hoveredLine = null;
    this.hoverFocusState = this.createHoverFocusState();

    // 相机状态（仅平移 + 缩放，禁用旋转）
    this.camera = {
      offsetX: 0,
      offsetY: 0,
      zoom: 1
    };
    this.cameraPanEnabled = true;
    this.mapDebugEnabled = readMapDebugFlag();
    this._lastDebugState = '';

    // 拖拽平移状态
    this.dragState = {
      active: false,
      pointerId: null,
      mode: 'idle',
      targetType: 'blank',
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
    this.nodeRevealState = {
      nodeId: '',
      progress: 1
    };
    this.layoutDebugData = null;

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

  debugLog(message, payload = undefined) {
    if (!this.mapDebugEnabled) return;
    if (payload !== undefined) {
      console.info(`[MapDebug] ${message}`, payload);
      return;
    }
    console.info(`[MapDebug] ${message}`);
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
      shapeMorph: gl.getUniformLocation(this.nodeProgram, 'u_shapeMorph'),
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

  setSceneType(sceneType = 'home') {
    const normalized = sceneType === 'titleDetail'
      ? 'titleDetail'
      : (sceneType === 'nodeDetail' ? 'nodeDetail' : 'home');
    if (this.sceneType === normalized) return;
    this.sceneType = normalized;
    if (!this.previewMode) {
      this.render();
    }
  }

  setCameraPanEnabled(enabled = true) {
    this.cameraPanEnabled = enabled !== false;
    if (!this.cameraPanEnabled) {
      this.dragState.active = false;
      this.dragState.pointerId = null;
      this.dragState.mode = 'idle';
      this.dragState.targetType = 'blank';
      this.dragState.moved = false;
      this.canvas.style.cursor = 'default';
    }
  }

  shouldRenderUserMarkerOverlay() {
    return this.sceneType === 'titleDetail';
  }

  setCameraOffset(offsetX, offsetY) {
    this.camera.offsetX = offsetX;
    this.camera.offsetY = offsetY;
    this.render();
  }

  // 让真实中心节点在跨层 ghost 落场时延迟提亮，避免硬重影。
  setNodeRevealProgress(nodeId = '', progress = 1) {
    this.nodeRevealState = {
      nodeId: typeof nodeId === 'string' ? nodeId : '',
      progress: Math.max(0, Math.min(1, Number(progress) || 0))
    };
    this.render();
  }

  createHoverFocusState() {
    return {
      active: false,
      primaryNodeId: '',
      nodeIds: new Set(),
      relatedNodeIds: new Set(),
      lineIds: new Set()
    };
  }

  isStarMapHoverFocusCandidate(node) {
    return !!node?.data?.starMapLayer
      && node.type !== 'stub-anchor'
      && node.type !== 'stub-badge';
  }

  getLineKey(line = {}) {
    const id = String(line?.id || '').trim();
    if (id) return id;
    return `${String(line?.from || '')}|${String(line?.to || '')}|${line?.isStub ? 'stub' : 'line'}`;
  }

  buildHoverFocusState() {
    const primaryNode = this.isStarMapHoverFocusCandidate(this.hoveredNode)
      ? this.hoveredNode
      : (this.isStarMapHoverFocusCandidate(this.hoveredButton?.node) ? this.hoveredButton.node : null);

    if (!primaryNode) {
      return this.createHoverFocusState();
    }

    const state = this.createHoverFocusState();
    state.active = true;
    state.primaryNodeId = primaryNode.id;
    state.nodeIds.add(primaryNode.id);

    for (const line of Array.isArray(this.lines) ? this.lines : []) {
      if (!line || line.isStub) continue;
      if (line.from !== primaryNode.id && line.to !== primaryNode.id) continue;

      state.lineIds.add(this.getLineKey(line));
      const otherId = line.from === primaryNode.id ? line.to : line.from;
      const otherNode = this.nodes.get(otherId);
      if (!this.isStarMapHoverFocusCandidate(otherNode)) continue;
      state.nodeIds.add(otherId);
      state.relatedNodeIds.add(otherId);
    }

    return state;
  }

  getHoverFocusSignature(state = this.hoverFocusState) {
    if (!state?.active) return 'inactive';
    return [
      state.primaryNodeId || '',
      [...state.nodeIds].sort().join(','),
      [...state.lineIds].sort().join(',')
    ].join('|');
  }

  getNodeHoverState(node) {
    if (!node) return 'normal';
    if (!this.hoverFocusState?.active) {
      return this.hoveredNode === node ? 'primary' : 'normal';
    }
    if (this.hoverFocusState.primaryNodeId === node.id) return 'primary';
    if (this.hoverFocusState.nodeIds.has(node.id)) return 'related';
    return 'dim';
  }

  getLineHoverState(line) {
    if (!line) return 'normal';
    if (this.hoverFocusState?.active) {
      return this.hoverFocusState.lineIds.has(this.getLineKey(line)) ? 'focus' : 'dim';
    }
    return this.hoveredLine?.line === line ? 'hovered' : 'normal';
  }

  getNodeRenderPriority(node) {
    const hoverState = this.getNodeHoverState(node);
    if (hoverState === 'primary') return 3;
    if (hoverState === 'related') return 2;
    if (hoverState === 'dim') return 0;
    return 1;
  }

  getLineRenderPriority(line) {
    const hoverState = this.getLineHoverState(line);
    if (hoverState === 'focus') return 3;
    if (hoverState === 'hovered') return 2;
    if (hoverState === 'dim') return 0;
    return 1;
  }

  getOrderedRenderableNodes() {
    return Array.from(this.nodes.values())
      .filter((node) => node.visible && node.opacity > 0)
      .sort((left, right) => {
        const leftPriority = this.getNodeRenderPriority(left);
        const rightPriority = this.getNodeRenderPriority(right);
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        const leftOrder = Number(left?.drawOrder) || 0;
        const rightOrder = Number(right?.drawOrder) || 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        if (left.opacity !== right.opacity) return left.opacity - right.opacity;
        return String(left?.id || '').localeCompare(String(right?.id || ''));
      });
  }

  clearHoverState() {
    const prevHoveredNodeId = this.hoveredNode?.id || '';
    const prevHoveredLineKey = this.hoveredLine?.line ? this.getLineKey(this.hoveredLine.line) : '';
    const prevHoveredButtonKey = this.hoveredButton
      ? `${this.hoveredButton.nodeId}:${this.hoveredButton.button?.id || ''}`
      : '';
    const prevFocusSignature = this.getHoverFocusSignature();

    this.hoveredNode = null;
    this.hoveredLine = null;
    this.hoveredButton = null;
    this.hoverFocusState = this.createHoverFocusState();
    this.canvas.style.cursor = this.cameraPanEnabled ? 'grab' : 'default';

    const nextHoveredButtonKey = '';
    const nextFocusSignature = this.getHoverFocusSignature();
    if (
      prevHoveredNodeId
      || prevHoveredLineKey
      || prevHoveredButtonKey !== nextHoveredButtonKey
      || prevFocusSignature !== nextFocusSignature
    ) {
      this.render();
    }
  }

  updateHoverState(x, y) {
    const prevHoveredNodeId = this.hoveredNode?.id || '';
    const prevHoveredLineKey = this.hoveredLine?.line ? this.getLineKey(this.hoveredLine.line) : '';
    const prevHoveredButton = this.hoveredButton;
    const prevFocusSignature = this.getHoverFocusSignature();
    this.hoveredButton = this.hitTestButton(x, y, { includeDisabled: true });
    if (this.hoveredButton) {
      this.hoveredNode = null;
      this.hoveredLine = null;
      this.canvas.style.cursor = this.hoveredButton.button?.disabled ? 'not-allowed' : 'pointer';
    } else {
      this.hoveredNode = this.hitTest(x, y);
      if (this.hoveredNode) {
        this.hoveredLine = null;
        this.canvas.style.cursor = 'pointer';
      } else {
        this.hoveredLine = this.hitTestLine(x, y);
        if (this.hoveredLine) {
          this.canvas.style.cursor = 'pointer';
        } else {
          this.canvas.style.cursor = this.cameraPanEnabled ? 'grab' : 'default';
        }
      }
    }

    this.hoverFocusState = this.buildHoverFocusState();

    const buttonHoverChanged = (prevHoveredButton !== this.hoveredButton) ||
      (prevHoveredButton && this.hoveredButton &&
        (prevHoveredButton.nodeId !== this.hoveredButton.nodeId ||
         prevHoveredButton.button.id !== this.hoveredButton.button.id));
    const nodeHoverChanged = prevHoveredNodeId !== (this.hoveredNode?.id || '');
    const lineHoverChanged = prevHoveredLineKey !== (this.hoveredLine?.line ? this.getLineKey(this.hoveredLine.line) : '');
    const focusChanged = prevFocusSignature !== this.getHoverFocusSignature();

    if (buttonHoverChanged || nodeHoverChanged || lineHoverChanged || focusChanged) {
      this.render();
    }
  }

  bindEvents() {
    const canvas = this.canvas;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const pos = this.getCanvasPositionFromEvent(event);
      const clickedButton = this.hitTestButton(pos.x, pos.y, { includeDisabled: true });
      const clickedNode = clickedButton ? null : this.hitTest(pos.x, pos.y);

      if (!this.cameraPanEnabled) {
        this.updateHoverState(pos.x, pos.y);
        return;
      }

      this.dragState.active = true;
      this.dragState.pointerId = event.pointerId;
      this.dragState.mode = clickedButton || clickedNode ? 'observe' : 'pan';
      this.dragState.targetType = clickedButton ? 'button' : (clickedNode ? 'node' : 'blank');
      this.dragState.startX = pos.x;
      this.dragState.startY = pos.y;
      this.dragState.startOffsetX = this.camera.offsetX;
      this.dragState.startOffsetY = this.camera.offsetY;
      this.dragState.moved = false;
      canvas.style.cursor = this.dragState.mode === 'pan' ? 'grabbing' : 'pointer';
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
      const pos = this.getCanvasPositionFromEvent(event);
      const draggingSamePointer = this.dragState.active && this.dragState.pointerId === event.pointerId;

      if (draggingSamePointer) {
        const dx = pos.x - this.dragState.startX;
        const dy = pos.y - this.dragState.startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          this.dragState.moved = true;
        }
        if (this.dragState.mode === 'pan') {
          this.camera.offsetX = this.dragState.startOffsetX + dx;
          this.camera.offsetY = this.dragState.startOffsetY + dy;
          this.render();
        }
        return;
      }

      this.updateHoverState(pos.x, pos.y);
    });

    canvas.addEventListener('pointerup', (event) => {
      if (!this.dragState.active || this.dragState.pointerId !== event.pointerId) return;

      canvas.releasePointerCapture(event.pointerId);
      this.dragState.active = false;
      this.dragState.pointerId = null;
      this.dragState.mode = 'idle';
      this.dragState.targetType = 'blank';
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
      this.dragState.mode = 'idle';
      this.dragState.targetType = 'blank';
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      canvas.style.cursor = this.cameraPanEnabled ? 'grab' : 'default';
    });

    canvas.addEventListener('pointerleave', () => {
      if (this.dragState.active) return;
      this.clearHoverState();
    });

    canvas.addEventListener('click', (event) => {
      if (this.dragState.suppressClick) return;
      const pos = this.getCanvasPositionFromEvent(event);

      // 先检测按钮点击
      const clickedButton = this.hitTestButton(pos.x, pos.y, { includeDisabled: true });
      if (clickedButton) {
        if (!clickedButton.button?.disabled && this.onButtonClick) {
          this.onButtonClick(clickedButton.nodeId, clickedButton.button);
        }
        return;
      }

      const clickedNode = this.hitTest(pos.x, pos.y);
      if (clickedNode && this.onClick) {
        this.onClick(clickedNode);
        return;
      }

      const clickedLine = this.hitTestLine(pos.x, pos.y);
      if (clickedLine && this.onLineClick) {
        this.onLineClick(clickedLine);
      }
    });

    canvas.addEventListener('dblclick', (event) => {
      if (this.dragState.suppressClick) return;
      const pos = this.getCanvasPositionFromEvent(event);
      const clickedButton = this.hitTestButton(pos.x, pos.y, { includeDisabled: true });
      if (clickedButton) return;
      const clickedNode = this.hitTest(pos.x, pos.y);
      if (clickedNode && this.onDoubleClick) {
        this.onDoubleClick(clickedNode);
      }
    });
  }

  hitTestButton(x, y, options = {}) {
    const includeDisabled = !!options.includeDisabled;
    const buttonRadius = 18; // 按钮半径

    for (const [nodeId, buttons] of this.nodeButtons) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.visible || node.opacity < 0.5) continue;

      for (const button of buttons) {
        if (button.disabled && !includeDisabled) continue;
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
    const orderedNodes = this.getOrderedRenderableNodes().slice().reverse();

    for (const node of orderedNodes) {
      if (!node.visible) continue;

      const dx = worldPos.x - node.x;
      const dy = worldPos.y - node.y;
      const nodeRadius = node.radius * node.scale;
      const isMostlyHex = (node.type === 'root' || node.type === 'featured') && (Number(node.shapeMorph) || 0) < 0.45;

      if (isMostlyHex) {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const verticalLimit = 0.88 * nodeRadius;
        const diagonalLimit = Math.sqrt(3) * nodeRadius * 0.98;
        if (absX <= nodeRadius && absY <= verticalLimit && ((Math.sqrt(3) * absX) + absY) <= diagonalLimit) {
          return node;
        }
        continue;
      }

      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= nodeRadius) {
        return node;
      }
    }
    return null;
  }

  distancePointToSegment(point, segmentStart, segmentEnd) {
    const px = point.x;
    const py = point.y;
    const x1 = segmentStart.x;
    const y1 = segmentStart.y;
    const x2 = segmentEnd.x;
    const y2 = segmentEnd.y;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0) {
      const ddx = px - x1;
      const ddy = py - y1;
      return Math.sqrt(ddx * ddx + ddy * ddy);
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const distX = px - projX;
    const distY = py - projY;
    return Math.sqrt(distX * distX + distY * distY);
  }

  getNodeScreenRadius(node) {
    const radius = Number(node?.radius) || 0;
    const scale = Number(node?.scale) || 1;
    return Math.max(0, radius * scale * this.camera.zoom);
  }

  getVisibleLineSegment(fromNode, toNode, options = {}) {
    const insetPx = Number.isFinite(options.insetPx) ? options.insetPx : 2;
    const minLengthPx = Number.isFinite(options.minLengthPx) ? options.minLengthPx : 1;
    const fromPos = this.worldToScreen(fromNode.x, fromNode.y);
    const toPos = this.worldToScreen(toNode.x, toNode.y);
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const centerDistance = Math.sqrt(dx * dx + dy * dy);
    if (centerDistance <= 0.001) return null;

    const dirX = dx / centerDistance;
    const dirY = dy / centerDistance;
    const fromRadius = this.getNodeScreenRadius(fromNode);
    const toRadius = this.getNodeScreenRadius(toNode);
    const fromOffset = Math.max(0, Math.min(Math.max(0, fromRadius - insetPx), centerDistance * 0.45));
    const toOffset = Math.max(0, Math.min(Math.max(0, toRadius - insetPx), centerDistance * 0.45));

    const start = {
      x: fromPos.x + dirX * fromOffset,
      y: fromPos.y + dirY * fromOffset
    };
    const end = {
      x: toPos.x - dirX * toOffset,
      y: toPos.y - dirY * toOffset
    };

    const visibleDx = end.x - start.x;
    const visibleDy = end.y - start.y;
    const visibleLength = Math.sqrt(visibleDx * visibleDx + visibleDy * visibleDy);
    if (visibleLength <= minLengthPx) return null;

    return {
      start,
      end,
      fromPos,
      toPos,
      length: visibleLength
    };
  }

  toCssRgba(color = [1, 1, 1, 1], alphaScale = 1) {
    const r = Math.round(Math.max(0, Math.min(1, Number(color?.[0]) || 0)) * 255);
    const g = Math.round(Math.max(0, Math.min(1, Number(color?.[1]) || 0)) * 255);
    const b = Math.round(Math.max(0, Math.min(1, Number(color?.[2]) || 0)) * 255);
    const a = Math.max(0, Math.min(1, (Number(color?.[3]) || 1) * alphaScale));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  getOrderedRenderableLines(options = {}) {
    const includeStubs = options.includeStubs !== false;
    const includeNormal = options.includeNormal !== false;
    return (Array.isArray(this.lines) ? this.lines : [])
      .filter((line) => (
        (includeStubs || !line?.isStub)
        && (includeNormal || !!line?.isStub)
      ))
      .slice()
      .sort((left, right) => {
        const leftPriority = this.getLineRenderPriority(left);
        const rightPriority = this.getLineRenderPriority(right);
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        const leftOrder = Number(left?.drawOrder) || 0;
        const rightOrder = Number(right?.drawOrder) || 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        const leftStub = left?.isStub ? 1 : 0;
        const rightStub = right?.isStub ? 1 : 0;
        if (leftStub !== rightStub) return leftStub - rightStub;
        return String(left?.id || '').localeCompare(String(right?.id || ''));
      });
  }

  getCurvedLineGeometry(segment, line = {}) {
    if (!segment) return null;

    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0.001) return null;

    const midX = (segment.start.x + segment.end.x) * 0.5;
    const midY = (segment.start.y + segment.end.y) * 0.5;
    const normalX = -dy / length;
    const normalY = dx / length;
    const maxOffset = Math.max(0, length * 0.22);
    const curveOffset = Math.max(-maxOffset, Math.min(maxOffset, Number(line?.curveOffset) || 0));
    const controlX = midX + normalX * curveOffset;
    const controlY = midY + normalY * curveOffset;

    return {
      start: segment.start,
      end: segment.end,
      control: { x: controlX, y: controlY },
      length
    };
  }

  buildLineGradient(ctx, geometry, color, alpha) {
    const gradient = ctx.createLinearGradient(
      geometry.start.x,
      geometry.start.y,
      geometry.end.x,
      geometry.end.y
    );
    gradient.addColorStop(0, this.toCssRgba(color, alpha * 0.54));
    gradient.addColorStop(0.5, this.toCssRgba(color, alpha));
    gradient.addColorStop(1, this.toCssRgba(color, alpha * 0.54));
    return gradient;
  }

  traceCurvedLine(ctx, geometry) {
    ctx.beginPath();
    ctx.moveTo(geometry.start.x, geometry.start.y);
    ctx.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.end.x, geometry.end.y);
  }

  hitTestLine(x, y) {
    if (!Array.isArray(this.lines) || this.lines.length === 0) return null;
    const threshold = 10;
    let best = null;

    for (const line of this.getOrderedRenderableLines({ includeStubs: false }).slice().reverse()) {
      if (!line?.clickable) continue;
      const fromNode = this.nodes.get(line.from);
      const toNode = this.nodes.get(line.to);
      if (!fromNode || !toNode || !fromNode.visible || !toNode.visible) continue;

      const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
      if (!segment) continue;
      const distance = this.distancePointToSegment({ x, y }, segment.start, segment.end);
      if (distance > threshold) continue;

      if (!best || distance < best.distance) {
        best = {
          line,
          fromNode,
          toNode,
          distance
        };
      }
    }

    return best;
  }

  // 创建或更新节点
  setNode(id, config) {
    const existing = this.nodes.get(id);
    const resolveDefaultShapeMorph = (type = '') => (
      type === 'root' || type === 'featured' ? 0 : 1
    );
    const nextType = config.type ?? existing?.type ?? 'center';

    const node = {
      id,
      x: config.x ?? existing?.x ?? 0,
      y: config.y ?? existing?.y ?? 0,
      radius: config.radius ?? existing?.radius ?? 50,
      scale: config.scale ?? existing?.scale ?? 1,
      rotation: config.rotation ?? existing?.rotation ?? 0,
      opacity: config.opacity ?? existing?.opacity ?? 1,
      visible: config.visible ?? existing?.visible ?? true,
      type: nextType,
      label: config.label ?? existing?.label ?? '',
      labelPlacement: config.labelPlacement ?? existing?.labelPlacement ?? 'center',
      labelOffsetX: config.labelOffsetX ?? existing?.labelOffsetX ?? 0,
      labelOffsetY: config.labelOffsetY ?? existing?.labelOffsetY ?? 0,
      labelVisible: config.labelVisible ?? existing?.labelVisible ?? true,
      drawOrder: config.drawOrder ?? existing?.drawOrder ?? 0,
      labelMaxWidthStrategy: config.labelMaxWidthStrategy ?? existing?.labelMaxWidthStrategy ?? 'default',
      labelWidthHint: config.labelWidthHint ?? existing?.labelWidthHint ?? null,
      labelHeightHint: config.labelHeightHint ?? existing?.labelHeightHint ?? null,
      labelLineClamp: config.labelLineClamp ?? existing?.labelLineClamp ?? 2,
      labelSenseLineClamp: config.labelSenseLineClamp ?? existing?.labelSenseLineClamp ?? 1,
      labelTitleLines: config.labelTitleLines ?? existing?.labelTitleLines ?? null,
      labelSenseLines: config.labelSenseLines ?? existing?.labelSenseLines ?? null,
      labelTitleWidthHint: config.labelTitleWidthHint ?? existing?.labelTitleWidthHint ?? null,
      labelSenseWidthHint: config.labelSenseWidthHint ?? existing?.labelSenseWidthHint ?? null,
      data: config.data ?? existing?.data ?? null,
      visualStyle: config.visualStyle ?? existing?.visualStyle ?? config.data?.visualStyle ?? existing?.data?.visualStyle ?? null,
      labelColor: config.labelColor ?? existing?.labelColor ?? config.visualStyle?.textColor ?? config.data?.visualStyle?.textColor ?? existing?.labelColor ?? '',
      glowIntensity: config.glowIntensity ?? existing?.glowIntensity ?? 0.5,
      shapeMorph: config.shapeMorph ?? existing?.shapeMorph ?? resolveDefaultShapeMorph(nextType),
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
    if (node?.type === 'root' || node?.type === 'featured') {
      const preset = node.type === 'root' ? HOME_ROOT_HEX_STYLE : HOME_FEATURED_HEX_STYLE;
      const primary = normalizeHexColor(visualStyle?.primaryColor, preset.primaryColor);
      const secondary = normalizeHexColor(visualStyle?.secondaryColor, preset.secondaryColor);
      const glow = normalizeHexColor(visualStyle?.glowColor, preset.glowColor);
      const rim = normalizeHexColor(visualStyle?.rimColor, preset.rimColor);
      const textColor = normalizeHexColor(visualStyle?.textColor, preset.textColor);
      const patternType = typeof visualStyle?.patternType === 'string'
        ? visualStyle.patternType.trim().toLowerCase()
        : preset.patternType;
      return {
        base: hexToVec4(primary, 1),
        secondary: hexToVec4(secondary, 1),
        rim: hexToVec4(rim, 1),
        glow: hexToVec4(glow, 1),
        patternType: PATTERN_TYPE_MAP[patternType] ?? PATTERN_TYPE_MAP.grid,
        textColor,
        subTextColor: blendHexColors(textColor, node.type === 'root' ? '#bfe6ff' : '#ffe0b0', 0.42),
        opacityFactor: node.type === 'root' ? 0.95 : 0.92
      };
    }

    if (visualStyle) {
      const primary = normalizeHexColor(visualStyle.primaryColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.primaryColor);
      const secondary = normalizeHexColor(visualStyle.secondaryColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.secondaryColor);
      const glow = normalizeHexColor(visualStyle.glowColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.glowColor);
      const rim = normalizeHexColor(visualStyle.rimColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.rimColor);
      const textColor = normalizeHexColor(visualStyle.textColor, DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.textColor);
      const patternType = typeof visualStyle.patternType === 'string'
        ? visualStyle.patternType.trim().toLowerCase()
        : DEFAULT_ALLIANCE_NODE_VISUAL_STYLE.patternType;
      return applyRoleAccent({
        base: hexToVec4(primary, 1),
        secondary: hexToVec4(secondary, 1),
        rim: hexToVec4(rim, 1),
        glow: hexToVec4(glow, 1),
        patternType: PATTERN_TYPE_MAP[patternType] ?? PATTERN_TYPE_MAP.diagonal,
        textColor,
        subTextColor: blendHexColors(textColor, '#cbd5e1', 0.45),
        opacityFactor: 1
      }, node?.type);
    }

    const isKnowledgeDomainNode = ['root', 'featured', 'center', 'parent', 'child', 'search', 'title', 'sense'].includes(node?.type);
    if (isKnowledgeDomainNode) {
      return applyRoleAccent({
        base: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.primaryColor, 1),
        secondary: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.secondaryColor, 1),
        rim: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.rimColor, 1),
        glow: hexToVec4(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.glowColor, 1),
        patternType: PATTERN_TYPE_MAP[DEFAULT_UNALLIED_NODE_VISUAL_STYLE.patternType],
        textColor: DEFAULT_UNALLIED_NODE_VISUAL_STYLE.textColor,
        subTextColor: blendHexColors(DEFAULT_UNALLIED_NODE_VISUAL_STYLE.textColor, '#bfdbfe', 0.45),
        opacityFactor: 0.78
      }, node?.type);
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
      subTextColor: '#dbeafe',
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
    this.nodeRevealState = { nodeId: '', progress: 1 };
    this.hoveredNode = null;
    this.hoveredLine = null;
    this.hoveredButton = null;
    this.hoverFocusState = this.createHoverFocusState();
    this.layoutDebugData = null;
  }

  // 设置连线
  setLines(lines) {
    this.lines = lines; // [{from: nodeId, to: nodeId, color: [r,g,b,a]}]
    this.hoverFocusState = this.buildHoverFocusState();
  }

  setLayoutDebugData(debugData) {
    this.layoutDebugData = debugData || null;
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
    this.render();
  }

  // 清除所有按钮
  clearNodeButtons() {
    this.nodeButtons.clear();
    this.hoveredButton = null;
    this.render();
  }

  // 动画节点到新位置
  animateNode(id, target, duration = 600, easing = 'easeOutCubic') {
    const node = this.nodes.get(id);
    if (!node) return Promise.resolve();
    const resolveDefaultShapeMorph = (type = '') => (
      type === 'root' || type === 'featured' ? 0 : 1
    );

    // 先同步非数值动画字段，避免样式和文案在动画后才生效
    const staticKeys = [
      'type',
      'label',
      'data',
      'visualStyle',
      'labelColor',
      'visible',
      'labelPlacement',
      'labelOffsetX',
      'labelOffsetY',
      'labelVisible',
      'labelMaxWidthStrategy',
      'labelWidthHint',
      'labelHeightHint',
      'labelLineClamp',
      'labelSenseLineClamp',
      'labelTitleLines',
      'labelSenseLines',
      'labelTitleWidthHint',
      'labelSenseWidthHint'
    ];
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
          rotation: node.rotation,
          shapeMorph: Number.isFinite(node.shapeMorph) ? node.shapeMorph : resolveDefaultShapeMorph(node.type)
        },
        end: {
          x: target.x ?? node.x,
          y: target.y ?? node.y,
          radius: target.radius ?? node.radius,
          scale: target.scale ?? node.scale,
          opacity: target.opacity ?? node.opacity,
          rotation: target.rotation ?? node.rotation,
          shapeMorph: target.shapeMorph ?? resolveDefaultShapeMorph(target.type ?? node.type)
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
        node.shapeMorph = anim.start.shapeMorph + (anim.end.shapeMorph - anim.start.shapeMorph) * easedProgress;
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

    if (this.mapDebugEnabled && this.nodes.size === 0) {
      this.renderEmptyStateBackdrop();
    }

    // 先渲染连线
    this.renderLines();

    // 再渲染节点
    this.renderNodes();

    // 渲染节点操作按钮
    this.renderNodeButtons();

    // 渲染标签与2D overlay
    this.renderLabels();

    if (this.mapDebugEnabled) {
      const debugState = `${canvas.width}x${canvas.height}|nodes:${this.nodes.size}|lines:${this.lines.length}`;
      if (debugState !== this._lastDebugState) {
        this._lastDebugState = debugState;
        this.debugLog('render-state', {
          width: canvas.width,
          height: canvas.height,
          nodes: this.nodes.size,
          lines: this.lines.length,
          renderingLoop: this.renderingLoop,
          animating: this.animating
        });
      }
    }

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

  getRevealProgressForNode(nodeId = '') {
    if (!nodeId || this.nodeRevealState.nodeId !== nodeId) return 1;
    return Math.max(0, Math.min(1, Number(this.nodeRevealState.progress) || 0));
  }

  getDetailNodeLayerProfile(node) {
    const isStarMapNode = !!node?.data?.starMapLayer;
    if (isStarMapNode && node?.type === 'center') {
      return { glowScale: 1.34, shellScale: 1.08, faceScale: 0.94, coreScale: 0.66, glowOpacity: 0.22 };
    }
    if (isStarMapNode) {
      return { glowScale: 1.08, shellScale: 0.98, faceScale: 0.88, coreScale: 0.56, glowOpacity: 0.11 };
    }
    if (node?.type === 'center') {
      return { glowScale: 1.34, shellScale: 1.12, faceScale: 1, coreScale: 0.72, glowOpacity: 0.22 };
    }
    if (node?.type === 'parent') {
      return { glowScale: 1.24, shellScale: 1.08, faceScale: 0.98, coreScale: 0.76, glowOpacity: 0.18 };
    }
    if (node?.type === 'child') {
      return { glowScale: 1.18, shellScale: 1.05, faceScale: 0.96, coreScale: 0.74, glowOpacity: 0.16 };
    }
    if (node?.type === 'title') {
      return { glowScale: 1.16, shellScale: 1.04, faceScale: 0.95, coreScale: 0.7, glowOpacity: 0.14 };
    }
    return { glowScale: 1.14, shellScale: 1.04, faceScale: 0.96, coreScale: 0.72, glowOpacity: 0.14 };
  }

  renderLines() {
    const gl = this.gl;

    if (this.lines.length === 0) return;

    gl.useProgram(this.lineProgram);
    gl.uniform2f(this.lineLocations.resolution, this.canvas.width, this.canvas.height);

    for (const line of this.getOrderedRenderableLines({ includeStubs: false })) {
      if (line?.isStub) continue;
      const fromNode = this.nodes.get(line.from);
      const toNode = this.nodes.get(line.to);

      if (!fromNode || !toNode || !fromNode.visible || !toNode.visible) continue;
      const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
      if (!segment) continue;

      const vertices = new Float32Array([
        segment.start.x, segment.start.y,
        segment.end.x, segment.end.y
      ]);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

      gl.enableVertexAttribArray(this.lineLocations.position);
      gl.vertexAttribPointer(this.lineLocations.position, 2, gl.FLOAT, false, 0, 0);

      const color = line.color || [0.66, 0.33, 0.97, 0.6];
      const revealProgress = Math.min(
        this.getRevealProgressForNode(fromNode.id),
        this.getRevealProgressForNode(toNode.id)
      );
      const lineHoverState = this.getLineHoverState(line);
      const hoverBoost = lineHoverState === 'focus'
        ? 1.72
        : (lineHoverState === 'hovered' ? 1.18 : (lineHoverState === 'dim' ? 0.22 : 1));
      gl.uniform4fv(this.lineLocations.color, color);
      gl.uniform1f(
        this.lineLocations.opacity,
        Math.min(fromNode.opacity, toNode.opacity)
          * Math.max(0.12, revealProgress)
          * (Number(line?.lineOpacity) || 0.22)
          * hoverBoost
      );

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
    const sortedNodes = this.getOrderedRenderableNodes();

    for (const node of sortedNodes) {
      const nodeHoverState = this.getNodeHoverState(node);
      const isFocusPrimary = nodeHoverState === 'primary';
      const isFocusRelated = nodeHoverState === 'related';
      const isDimmed = nodeHoverState === 'dim';
      const isHovered = isFocusPrimary;
      const focusOpacity = isDimmed ? 0.18 : 1;
      const focusGlowBoost = isFocusPrimary ? 1.24 : (isFocusRelated ? 1.12 : (isDimmed ? 0.68 : 1));
      const focusScale = isFocusPrimary ? 1.07 : (isFocusRelated ? 1.035 : 1);
      const style = this.resolveNodeRenderStyle(node);
      const size = node.radius * 2 * this.camera.zoom * focusScale;
      const nodePos = this.worldToScreen(node.x, node.y);
      const isHoneycombNode = this.sceneType === 'home' && (node.type === 'root' || node.type === 'featured');
      const shapeMorph = Number.isFinite(node.shapeMorph) ? node.shapeMorph : (isHoneycombNode ? 0 : 1);
      const revealProgress = this.getRevealProgressForNode(node.id);
      const revealOpacity = 0.16 + revealProgress * 0.84;
      const revealScale = 0.94 + revealProgress * 0.06;

      if (isHoneycombNode) {
        const glowScale = node.type === 'root' ? 1.22 : 1.18;
        const rimScale = node.type === 'root' ? 1.06 : 1.04;
        const faceScale = node.type === 'root' ? 0.96 : 0.94;
        this.drawNodeSprite({
          nodePos,
          size,
          node,
          color: style.glow,
          secondaryColor: style.base,
          rimColor: style.rim,
          glowColor: style.glow,
          glowIntensity: (isHovered ? 1.12 : Math.max(0.44, node.glowIntensity)) * focusGlowBoost,
          opacity: node.opacity * 0.22 * focusOpacity,
          shapeType: 2,
          patternType: PATTERN_TYPE_MAP.none,
          sizeScale: glowScale,
          shapeMorph
        });
        this.drawNodeSprite({
          nodePos,
          size,
          node,
          color: style.secondary,
          secondaryColor: style.base,
          rimColor: style.rim,
          glowColor: style.glow,
          glowIntensity: (isHovered ? 0.9 : Math.max(0.36, node.glowIntensity * 0.8)) * focusGlowBoost,
          opacity: node.opacity * 0.9 * focusOpacity,
          shapeType: 2,
          patternType: PATTERN_TYPE_MAP.none,
          sizeScale: rimScale,
          shapeMorph
        });
        this.drawNodeSprite({
          nodePos,
          size,
          node,
          color: style.base,
          secondaryColor: style.secondary,
          rimColor: style.rim,
          glowColor: style.glow,
          glowIntensity: (isHovered ? 0.82 : node.glowIntensity) * focusGlowBoost,
          opacity: node.opacity * (style.opacityFactor ?? 1) * focusOpacity,
          shapeType: 2,
          patternType: style.patternType ?? PATTERN_TYPE_MAP.none,
          sizeScale: faceScale,
          shapeMorph
        });
        this.drawNodeSprite({
          nodePos,
          size,
          node,
          color: style.rim,
          secondaryColor: style.base,
          rimColor: style.rim,
          glowColor: style.glow,
          glowIntensity: 0.08,
          opacity: node.opacity * 0.12 * focusOpacity,
          shapeType: 2,
          patternType: PATTERN_TYPE_MAP.none,
          sizeScale: faceScale * 0.84,
          shapeMorph
        });
        continue;
      }

      const profile = this.getDetailNodeLayerProfile(node);
      const hoverBoost = isFocusPrimary ? 1.18 : (isFocusRelated ? 1.08 : 1);
      const hoverScale = isFocusPrimary ? 1.05 : (isFocusRelated ? 1.02 : 1);
      const isStarMapCenter = !!node?.data?.starMapLayer && node.type === 'center';
      if (isStarMapCenter) {
        const pulse = 1 + Math.sin(performance.now() * 0.0046) * 0.06;
        this.drawNodeSprite({
          nodePos,
          size,
          node,
          color: [0.48, 0.84, 1, 1],
          secondaryColor: [0.18, 0.42, 0.74, 1],
          rimColor: [0.86, 0.98, 1, 1],
          glowColor: [0.55, 0.9, 1, 1],
          glowIntensity: 0.38,
          opacity: node.opacity * 0.12 * revealOpacity * focusOpacity,
          shapeType: 2,
          patternType: PATTERN_TYPE_MAP.none,
          sizeScale: 1.88 * pulse * revealScale,
          shapeMorph
        });
        this.drawNodeSprite({
          nodePos,
          size,
          node,
          color: [0.55, 0.9, 1, 1],
          secondaryColor: [0.26, 0.6, 0.82, 1],
          rimColor: [0.88, 0.98, 1, 1],
          glowColor: [0.55, 0.9, 1, 1],
          glowIntensity: 0.32,
          opacity: node.opacity * 0.22 * revealOpacity * focusOpacity,
          shapeType: 2,
          patternType: PATTERN_TYPE_MAP.none,
          sizeScale: 1.58 * pulse * revealScale,
          shapeMorph
        });
        this.drawNodeSprite({
          nodePos,
          size,
          node,
          color: [0.92, 0.99, 1, 1],
          secondaryColor: [0.4, 0.74, 0.92, 1],
          rimColor: [1, 1, 1, 1],
          glowColor: [0.78, 0.95, 1, 1],
          glowIntensity: 0.12,
          opacity: node.opacity * 0.2 * revealOpacity * focusOpacity,
          shapeType: 2,
          patternType: PATTERN_TYPE_MAP.none,
          sizeScale: 1.12 * revealScale,
          shapeMorph
        });
      }
      this.drawNodeSprite({
        nodePos,
        size,
        node,
        color: style.glow,
        secondaryColor: style.base,
        rimColor: style.rim,
        glowColor: style.glow,
        glowIntensity: ((isHovered ? 1.1 : Math.max(0.52, node.glowIntensity + 0.18)) * focusGlowBoost) * (1.1 - revealProgress * 0.22),
        opacity: node.opacity * profile.glowOpacity * revealOpacity * focusOpacity,
        shapeType: 2,
        patternType: PATTERN_TYPE_MAP.none,
        sizeScale: profile.glowScale * hoverBoost * revealScale,
        shapeMorph
      });
      this.drawNodeSprite({
        nodePos,
        size,
        node,
        color: style.secondary,
        secondaryColor: style.base,
        rimColor: style.rim,
        glowColor: style.glow,
        glowIntensity: (isHovered ? 0.98 : Math.max(0.46, node.glowIntensity * 0.9)) * focusGlowBoost,
        opacity: node.opacity * 0.88 * revealOpacity * focusOpacity,
        shapeType: 2,
        patternType: PATTERN_TYPE_MAP.none,
        sizeScale: profile.shellScale * revealScale * hoverScale,
        shapeMorph
      });
      this.drawNodeSprite({
        nodePos,
        size,
        node,
        color: style.base,
        secondaryColor: style.secondary,
        rimColor: style.rim,
        glowColor: style.glow,
        glowIntensity: ((isHovered ? 0.94 : Math.max(0.42, node.glowIntensity)) * hoverBoost) * focusGlowBoost,
        opacity: node.opacity * (style.opacityFactor ?? 1) * revealOpacity * focusOpacity,
        shapeType: 2,
        patternType: style.patternType ?? PATTERN_TYPE_MAP.none,
        sizeScale: profile.faceScale * revealScale * hoverScale,
        shapeMorph
      });
      this.drawNodeSprite({
        nodePos,
        size,
        node,
        color: style.rim,
        secondaryColor: style.base,
        rimColor: style.rim,
        glowColor: style.glow,
        glowIntensity: 0.1,
        opacity: node.opacity * 0.18 * revealOpacity * focusOpacity,
        shapeType: 2,
        patternType: PATTERN_TYPE_MAP.none,
        sizeScale: profile.coreScale * revealScale * hoverScale,
        shapeMorph
      });
    }
  }

  drawNodeSprite({
    nodePos,
    size,
    node,
    color,
    secondaryColor,
    rimColor,
    glowColor,
    glowIntensity,
    opacity,
    shapeType = 0,
    patternType = PATTERN_TYPE_MAP.none,
    sizeScale = 1,
    shapeMorph = 1
  }) {
    const gl = this.gl;
    gl.uniform2f(this.nodeLocations.translation, nodePos.x, nodePos.y);
    gl.uniform2f(this.nodeLocations.scale, size * node.scale * sizeScale, size * node.scale * sizeScale);
    gl.uniform1f(this.nodeLocations.rotation, node.rotation);
    gl.uniform4fv(this.nodeLocations.color, color);
    gl.uniform4fv(this.nodeLocations.secondaryColor, secondaryColor);
    gl.uniform4fv(this.nodeLocations.rimColor, rimColor);
    gl.uniform4fv(this.nodeLocations.glowColor, glowColor);
    gl.uniform1f(this.nodeLocations.glowIntensity, glowIntensity);
    gl.uniform1f(this.nodeLocations.opacity, opacity);
    gl.uniform1f(this.nodeLocations.shapeMorph, shapeMorph);
    gl.uniform1i(this.nodeLocations.shapeType, shapeType);
    gl.uniform1i(this.nodeLocations.patternType, patternType);
    gl.uniform2f(this.nodeLocations.size, size * sizeScale, size * sizeScale);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
      const revealProgress = this.getRevealProgressForNode(node.id);
      if (revealProgress < 0.48) continue;
      const nodeHoverState = this.getNodeHoverState(node);
      const buttonOpacityFactor = nodeHoverState === 'dim' ? 0.22 : 1;
      const buttonScaleFactor = nodeHoverState === 'primary' ? 1.06 : (nodeHoverState === 'related' ? 1.02 : 1);

      for (const button of buttons) {
        const btnPos = this.getButtonPosition(node, button.angle);
        const isHovered = this.hoveredButton &&
          this.hoveredButton.nodeId === nodeId &&
          this.hoveredButton.button.id === button.id;
        const isDisabled = !!button.disabled;

        // 按钮尺寸
        const btnSize = (isHovered && !isDisabled ? 38 : 32) * buttonScaleFactor;

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
        gl.uniform1f(this.nodeLocations.opacity, node.opacity * (isDisabled ? 0.45 : 0.8) * revealProgress * buttonOpacityFactor);
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
      node.visible
      && (node.opacity > 0.3 || (!!node?.data?.starMapLayer && node.opacity > 0.06))
      && node.label
    ));
    const previewNodes = includePreview
      ? Array.from(this.previewNodes.values()).filter((node) => node.visible && node.label)
      : [];

    const labelOverlay = this.ensureLabelOverlay();
    const liveKeys = new Set();
    const applyLabelContent = (labelEl, node) => {
      const label = node?.label || '';
      const normalized = String(label || '').trim();
      const [titlePart = '', ...senseParts] = normalized.split('\n');
      const title = titlePart.trim();
      const senseTitle = senseParts.join('\n').trim();
      const titleLines = Array.isArray(node?.labelTitleLines) && node.labelTitleLines.length > 0
        ? node.labelTitleLines
        : (title ? [title] : []);
      const senseLines = Array.isArray(node?.labelSenseLines) && node.labelSenseLines.length > 0
        ? node.labelSenseLines
        : (senseTitle ? [senseTitle] : []);
      const signature = `${normalized}|t:${titleLines.join(' / ')}|s:${senseLines.join(' / ')}`;
      if (labelEl.dataset.rawLabel === signature) return;
      labelEl.dataset.rawLabel = signature;
      labelEl.replaceChildren();

      if (titleLines.length > 0) {
        const titleEl = document.createElement('span');
        titleEl.className = 'node-label-title';
        titleLines.forEach((line) => {
          const lineEl = document.createElement('span');
          lineEl.className = 'node-label-line';
          lineEl.textContent = line;
          titleEl.appendChild(lineEl);
        });
        labelEl.appendChild(titleEl);
      }

      if (senseLines.length > 0) {
        const senseEl = document.createElement('span');
        senseEl.className = 'node-label-sense';
        senseLines.forEach((line) => {
          const lineEl = document.createElement('span');
          lineEl.className = 'node-label-line';
          lineEl.textContent = line;
          senseEl.appendChild(lineEl);
        });
        labelEl.appendChild(senseEl);
      }

      if (titleLines.length < 1 && senseLines.length < 1) {
        const fallbackEl = document.createElement('span');
        fallbackEl.className = 'node-label-title';
        const lineEl = document.createElement('span');
        lineEl.className = 'node-label-line';
        lineEl.textContent = '未命名知识域';
        fallbackEl.appendChild(lineEl);
        labelEl.appendChild(fallbackEl);
      }
    };

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
      const screenRadius = Math.max(10, node.radius * node.scale * this.camera.zoom);
      const isHomeHexNode = this.sceneType === 'home' && (node.type === 'root' || node.type === 'featured');
      const isStarMapNode = !!node?.data?.starMapLayer && !isPreview;
      const isStarMapCenter = isStarMapNode && node.type === 'center';
      const revealProgress = this.getRevealProgressForNode(node.id);
      const nodeHoverState = this.getNodeHoverState(node);
      const isFocusPrimary = nodeHoverState === 'primary';
      const isFocusRelated = nodeHoverState === 'related';
      const isDimmed = nodeHoverState === 'dim';
      const shouldDisplayLabel = node.labelVisible !== false || node.type === 'center' || isFocusPrimary || isFocusRelated;
      const placement = typeof node.labelPlacement === 'string' ? node.labelPlacement : 'center';
      const isStarMapInside = isStarMapNode && placement !== 'below' && placement !== 'above';
      const sidebarButtonFontPx = 14.4;
      const baseFontSize = isHomeHexNode
        ? Math.max(8, Math.min(18, screenRadius * 0.22))
        : isStarMapNode
          ? (isStarMapInside
            ? Math.max(13.6, Math.min(15.2, sidebarButtonFontPx + (screenRadius - 28) * 0.028))
            : Math.max(10, Math.min(15, 11.4 + screenRadius * 0.08)))
          : Math.max(10, Math.min(24, screenRadius * (node.type === 'center' ? 0.28 : 0.3)));
      const labelLength = Math.max(1, String(node.label || '').trim().length);
      const fitByLength = isStarMapNode
        ? (isStarMapInside ? Math.max(11, (screenRadius * 1.94) / (labelLength * 0.38)) : Number.POSITIVE_INFINITY)
        : ((isHomeHexNode ? screenRadius * 1.1 : screenRadius * 1.5)) / (labelLength * 0.56);
      const fontSize = isStarMapInside
        ? Math.max(12.8, Math.min(baseFontSize, fitByLength))
        : Math.max(8, Math.min(baseFontSize, fitByLength));
      const labelOpacity = isHomeHexNode
        ? Math.max(0, Math.min(1, node.opacity))
        : Math.max(0, Math.min(1, node.opacity * Math.max(0, Math.min(1, (revealProgress - 0.24) / 0.76))));
      const offsetX = Number(node.labelOffsetX) || 0;
      const offsetY = Number(node.labelOffsetY) || 0;
      let anchorX = nodePos.x + offsetX;
      let anchorY = nodePos.y + offsetY;
      let transform = 'translate(-50%, -50%)';
      if (placement === 'below') {
        anchorX = nodePos.x + offsetX;
        anchorY = nodePos.y + screenRadius + offsetY;
        transform = 'translate(-50%, 0)';
      } else if (placement === 'above') {
        anchorX = nodePos.x + offsetX;
        anchorY = nodePos.y - screenRadius - offsetY;
        transform = 'translate(-50%, -100%)';
      }
      let maxWidth = Number(node.labelWidthHint) || (
        isHomeHexNode
          ? Math.max(72, screenRadius * 1.15)
          : Math.max(96, screenRadius * (node.type === 'center' ? 2.1 : 1.9))
      );
      if (node.labelMaxWidthStrategy === 'tight') {
        maxWidth *= 0.72;
      } else if (node.labelMaxWidthStrategy === 'compact') {
        maxWidth *= 0.84;
      } else if (node.labelMaxWidthStrategy === 'wide') {
        maxWidth *= 1.12;
      }

      applyLabelContent(labelEl, node);
      labelEl.classList.toggle('is-home-hex', isHomeHexNode);
      labelEl.classList.toggle('is-center', node.type === 'center');
      labelEl.classList.toggle('is-parent', node.type === 'parent');
      labelEl.classList.toggle('is-child', node.type === 'child');
      labelEl.classList.toggle('is-title', node.type === 'title');
      labelEl.classList.toggle('is-sense', node.type === 'sense');
      labelEl.classList.toggle('is-star-map-label', isStarMapNode);
      labelEl.classList.toggle('is-star-map-center', isStarMapCenter);
      labelEl.classList.toggle('is-inside-node', isStarMapInside);
      labelEl.classList.toggle('is-below', placement === 'below');
      labelEl.classList.toggle('is-above', placement === 'above');
      labelEl.classList.toggle('is-hidden-by-lod', !shouldDisplayLabel);
      labelEl.classList.toggle('is-hover-focus-primary', isFocusPrimary);
      labelEl.classList.toggle('is-hover-focus-related', isFocusRelated);
      labelEl.classList.toggle('is-hover-dimmed', isDimmed);
      labelEl.style.display = shouldDisplayLabel ? 'flex' : 'none';
      labelEl.style.left = `${anchorX}px`;
      labelEl.style.top = `${anchorY}px`;
      labelEl.style.transform = `${transform}${isFocusPrimary ? ' translateY(-8px) scale(1.05)' : (isFocusRelated ? ' translateY(-4px) scale(1.02)' : '')}`;
      labelEl.style.fontSize = `${fontSize}px`;
      labelEl.style.lineHeight = `${Math.max(1, fontSize * (isStarMapNode ? 1.18 : 1.12))}px`;
      labelEl.style.maxWidth = `${maxWidth}px`;
      labelEl.style.width = isStarMapInside ? `${Math.round(maxWidth)}px` : 'auto';
      labelEl.style.minHeight = isStarMapInside && Number(node.labelHeightHint) > 0
        ? `${Math.round(Number(node.labelHeightHint))}px`
        : '';
      labelEl.style.minWidth = isStarMapNode ? '0' : '';
      labelEl.style.setProperty('--label-line-clamp', `${Math.max(1, Number(node.labelLineClamp) || 2)}`);
      labelEl.style.setProperty('--label-sense-line-clamp', `${Math.max(1, Number(node.labelSenseLineClamp) || 1)}`);
      labelEl.style.setProperty('--label-width-hint', `${Math.round(maxWidth)}px`);
      labelEl.style.setProperty('--label-title-width-hint', `${Math.round(Number(node.labelTitleWidthHint) || maxWidth)}px`);
      labelEl.style.setProperty('--label-sense-width-hint', `${Math.round(Number(node.labelSenseWidthHint) || maxWidth)}px`);
      labelEl.style.opacity = shouldDisplayLabel
        ? `${labelOpacity * (isDimmed ? 0.14 : (isFocusRelated ? 0.96 : 1))}`
        : '0';
      labelEl.style.zIndex = isFocusPrimary ? '4' : (isFocusRelated ? '3' : '1');
      labelEl.style.filter = isDimmed
        ? 'saturate(0.45) brightness(0.52)'
        : (isFocusRelated ? 'brightness(1.08)' : '');
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

  getMeasuredStarMapLabelBoxes() {
    if (!this.canvas || this.labelElements.size < 1) return [];
    const canvasRect = this.canvas.getBoundingClientRect();
    if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return [];
    const scaleX = this.canvas.width / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    const boxes = [];

    for (const node of this.nodes.values()) {
      if (!node?.data?.starMapLayer || !node.label || !node.visible) continue;
      const labelEl = this.labelElements.get(`node:${node.id}`);
      if (!labelEl) continue;
      const rect = labelEl.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const display = window.getComputedStyle(labelEl).display;
      if (display === 'none') continue;
      const leftScreen = (rect.left - canvasRect.left) * scaleX;
      const rightScreen = (rect.right - canvasRect.left) * scaleX;
      const topScreen = (rect.top - canvasRect.top) * scaleY;
      const bottomScreen = (rect.bottom - canvasRect.top) * scaleY;
      const topLeft = this.screenToWorld(leftScreen, topScreen);
      const bottomRight = this.screenToWorld(rightScreen, bottomScreen);
      boxes.push({
        nodeId: node.id,
        left: Math.min(topLeft.x, bottomRight.x),
        right: Math.max(topLeft.x, bottomRight.x),
        top: Math.min(topLeft.y, bottomRight.y),
        bottom: Math.max(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y)
      });
    }

    return boxes;
  }

  renderOverlayCanvas() {
    const overlayCanvas = this.ensureOverlayCanvas();
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    this.renderLineGlowTrails(ctx);
    this.renderLineConnectionCaps(ctx);
    this.renderStubBadges(ctx);
    this.renderButtonIcons(ctx);
    if (this.shouldRenderUserMarkerOverlay()) {
      this.renderUserTravelDot(ctx);
      this.renderUserConeMarker(ctx);
    }
    if (this.mapDebugEnabled && this.nodes.size === 0) {
      this.renderEmptyStateOverlay(ctx);
    }
    if (this.mapDebugEnabled && this.layoutDebugData) {
      this.renderStarMapDebugOverlay(ctx);
    }

    ctx.globalAlpha = 1;
  }

  renderStubBadges(ctx) {
    const badgeNodes = Array.from(this.nodes.values()).filter((node) => (
      node?.type === 'stub-badge'
      && node.visible
      && node.label
      && node.data?.sourceNodeId
    ));
    if (badgeNodes.length < 1) return;
    const starMapCenter = Array.from(this.nodes.values()).find((node) => node?.type === 'center' && node?.data?.starMapLayer);
    const canvasRect = this.canvas?.getBoundingClientRect?.();
    const scaleX = canvasRect?.width ? (this.canvas.width / canvasRect.width) : 1;
    const scaleY = canvasRect?.height ? (this.canvas.height / canvasRect.height) : 1;
    const rectsOverlap = (left, right) => (
      left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top
    );
    const toScreenRect = (rect) => ({
      left: (rect.left - canvasRect.left) * scaleX,
      right: (rect.right - canvasRect.left) * scaleX,
      top: (rect.top - canvasRect.top) * scaleY,
      bottom: (rect.bottom - canvasRect.top) * scaleY
    });
    const getActualTextRect = (labelEl) => {
      if (!labelEl || !canvasRect) return null;
      if (window.getComputedStyle(labelEl).display === 'none') return null;

      const textLineEls = Array.from(labelEl.querySelectorAll('.node-label-line'));
      const textRects = textLineEls
        .map((lineEl) => {
          const textNode = Array.from(lineEl.childNodes).find((node) => (
            node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim()
          ));
          if (!textNode) return null;
          const range = document.createRange();
          range.selectNodeContents(textNode);
          const rect = range.getBoundingClientRect();
          range.detach?.();
          if (!rect || rect.width <= 0 || rect.height <= 0) return null;
          return toScreenRect(rect);
        })
        .filter(Boolean);

      if (textRects.length > 0) {
        return textRects.reduce((acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          right: Math.max(acc.right, rect.right),
          top: Math.min(acc.top, rect.top),
          bottom: Math.max(acc.bottom, rect.bottom)
        }));
      }

      const fallbackRect = labelEl.getBoundingClientRect();
      if (!fallbackRect || fallbackRect.width <= 0 || fallbackRect.height <= 0) return null;
      const screenRect = toScreenRect(fallbackRect);
      const insetX = Math.min(14, (screenRect.right - screenRect.left) * 0.16);
      const insetY = Math.min(8, (screenRect.bottom - screenRect.top) * 0.18);
      return {
        left: screenRect.left + insetX,
        right: screenRect.right - insetX,
        top: screenRect.top + insetY,
        bottom: screenRect.bottom - insetY
      };
    };

    badgeNodes.forEach((badgeNode) => {
      const sourceNode = this.nodes.get(badgeNode.data.sourceNodeId);
      if (!sourceNode || !sourceNode.visible) return;
      const badgeOpacityFactor = this.hoverFocusState.active ? 0.12 : 1;

      const sourcePos = this.worldToScreen(sourceNode.x, sourceNode.y);
      const screenRadius = Math.max(10, sourceNode.radius * sourceNode.scale * this.camera.zoom);
      const normalizeVec = (x, y, fallback = { x: 1, y: -1 }) => {
        const length = Math.hypot(x, y);
        if (length <= 0.0001) return { ...fallback };
        return { x: x / length, y: y / length };
      };
      const radial = normalizeVec(
        sourceNode.x - (starMapCenter?.x || 0),
        sourceNode.y - (starMapCenter?.y || 0),
        { x: 1, y: -1 }
      );
      const tangentSign = radial.y <= 0 ? 1 : -1;
      const corner = normalizeVec(
        radial.x + (-radial.y) * 0.72 * tangentSign,
        radial.y + radial.x * 0.72 * tangentSign,
        { x: 0.76, y: -0.64 }
      );
      const badgeX = sourcePos.x + corner.x * (screenRadius * 0.62);
      const badgeY = sourcePos.y + corner.y * (screenRadius * 0.62);

      ctx.save();
      ctx.globalAlpha = badgeOpacityFactor;
      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pillText = String(badgeNode.label || '').trim();
      const textWidth = ctx.measureText(pillText).width;
      const pillWidth = textWidth + 10;
      const pillHeight = 18;
      const sourceLabelEl = this.labelElements.get(`node:${sourceNode.id}`);
      const sourceLabelRect = getActualTextRect(sourceLabelEl);
      let resolvedBadgeX = badgeX;
      let resolvedBadgeY = badgeY;
      if (sourceLabelRect) {
        const step = Math.max(4, screenRadius * 0.14);
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const badgeRect = {
            left: resolvedBadgeX - pillWidth * 0.5 - 2,
            right: resolvedBadgeX + pillWidth * 0.5 + 2,
            top: resolvedBadgeY - pillHeight * 0.5 - 2,
            bottom: resolvedBadgeY + pillHeight * 0.5 + 2
          };
          if (!rectsOverlap(badgeRect, sourceLabelRect)) break;
          resolvedBadgeX += corner.x * step;
          resolvedBadgeY += corner.y * step;
        }
      }
      ctx.fillStyle = 'rgba(7, 13, 24, 0.92)';
      ctx.beginPath();
      ctx.roundRect(resolvedBadgeX - pillWidth / 2, resolvedBadgeY - pillHeight / 2, pillWidth, pillHeight, 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(147, 197, 253, 0.82)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#dbeafe';
      ctx.fillText(pillText, resolvedBadgeX, resolvedBadgeY + 0.5);
      ctx.restore();
    });
  }

  renderStarMapDebugOverlay(ctx) {
    const sectorPlan = this.layoutDebugData?.sectorPlan;
    if (!sectorPlan || !Array.isArray(sectorPlan.sectors) || sectorPlan.sectors.length < 1) return;
    const centerNode = Array.from(this.nodes.values()).find((node) => node?.type === 'center' && node?.data?.starMapLayer);
    if (!centerNode) return;
    const centerPos = this.worldToScreen(centerNode.x, centerNode.y);
    const debugRadius = Math.max(this.canvas.width, this.canvas.height) * 0.42;
    ctx.save();
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.18)';
    ctx.lineWidth = 1;
    sectorPlan.sectors.forEach((sector) => {
      const angle = Number(sector?.angle) || 0;
      const endX = centerPos.x + Math.cos(angle) * debugRadius;
      const endY = centerPos.y + Math.sin(angle) * debugRadius;
      ctx.beginPath();
      ctx.moveTo(centerPos.x, centerPos.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(191, 219, 254, 0.72)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${sector.sectorIndex}:${Math.round((sector.area + sector.labelArea) / 100)}`,
        centerPos.x + Math.cos(angle) * (debugRadius * 0.62),
        centerPos.y + Math.sin(angle) * (debugRadius * 0.62)
      );
    });

    const measured = this.layoutDebugData?.measuredLabelRefinement;
    if (measured?.before && measured?.after) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(12, 12, 310, 54);
      ctx.fillStyle = '#dbeafe';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `label-pass total ${measured.before.total.toFixed(1)} -> ${measured.after.total.toFixed(1)}`,
        20,
        32
      );
      ctx.fillText(
        `edgeLabel ${measured.before.edgeNearLabel.toFixed(1)} -> ${measured.after.edgeNearLabel.toFixed(1)}`,
        20,
        50
      );
    }
    ctx.restore();
  }

  renderLineGlowTrails(ctx) {
    if (!Array.isArray(this.lines) || this.lines.length === 0) return;

    for (const line of this.getOrderedRenderableLines()) {
      const fromNode = this.nodes.get(line?.from);
      const toNode = this.nodes.get(line?.to);
      if (!fromNode || !toNode || !fromNode.visible || !toNode.visible) continue;

      const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
      if (!segment) continue;

      if (line?.isStub) {
        this.renderStubLine(ctx, line, fromNode, toNode, segment);
        continue;
      }

      const revealProgress = Math.min(
        this.getRevealProgressForNode(fromNode.id),
        this.getRevealProgressForNode(toNode.id)
      );
      if (revealProgress <= 0.02) continue;

      const baseColor = line?.color || [0.66, 0.33, 0.97, 0.6];
      const lineHoverState = this.getLineHoverState(line);
      const isFocused = lineHoverState === 'focus';
      const isHovered = lineHoverState === 'hovered';
      const isDimmed = lineHoverState === 'dim';
      const geometry = this.getCurvedLineGeometry(segment, line);
      if (!geometry) continue;
      const lineVariant = String(line?.lineVariant || '');
      const isSenseTrunk = lineVariant === 'sense-trunk';
      const isSenseCross = lineVariant === 'sense-cross';
      const isDashedBridge = isSenseCross || lineVariant === 'cross-cluster' || lineVariant === 'title-bridge';
      const alphaScale = Math.min(fromNode.opacity, toNode.opacity)
        * (Number(line?.glowOpacity) || ((isFocused || isHovered) ? 0.34 : 0.22))
        * revealProgress
        * (isFocused ? 1.72 : (isHovered ? 1.18 : (isDimmed ? 0.12 : 1)))
        * (isSenseTrunk ? 1.2 : isSenseCross ? 0.82 : 1);
      const glowStroke = this.buildLineGradient(ctx, geometry, baseColor, alphaScale);
      const glowWidth = (Number(line?.glowWidth) || 6) * (isFocused ? 1.22 : (isHovered ? 1.14 : 1)) * (isSenseTrunk ? 1.12 : isSenseCross ? 0.88 : 1);
      const coreWidth = Math.max(0.8, (Number(line?.lineWidth) || 1.5) * (isFocused ? 1.2 : (isHovered ? 1.12 : 1)) * (isSenseTrunk ? 1.12 : isSenseCross ? 0.86 : 1));

      ctx.save();
      ctx.setLineDash(isDashedBridge ? (isSenseCross ? [5, 8] : [7, 6]) : []);
      ctx.strokeStyle = glowStroke;
      ctx.lineWidth = glowWidth;
      ctx.lineCap = 'round';
      ctx.shadowBlur = glowWidth * (isSenseTrunk ? 2.35 : 2.1);
      ctx.shadowColor = this.toCssRgba(baseColor, alphaScale * (isSenseTrunk ? 0.98 : 0.86));
      this.traceCurvedLine(ctx, geometry);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.lineWidth = coreWidth;
      ctx.strokeStyle = this.toCssRgba(
        baseColor,
        (Number(line?.lineOpacity) || 0.28)
          * revealProgress
          * (isFocused ? 1.72 : (isHovered ? 1.18 : (isDimmed ? 0.12 : 1)))
          * (isSenseTrunk ? 1.08 : isSenseCross ? 0.78 : 1)
      );
      this.traceCurvedLine(ctx, geometry);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(0.7, coreWidth * (isSenseTrunk ? 0.46 : 0.38));
      ctx.strokeStyle = this.toCssRgba([1, 1, 1, 1], alphaScale * (isSenseTrunk ? 0.32 : 0.2));
      this.traceCurvedLine(ctx, geometry);
      ctx.stroke();

      if (isSenseTrunk) {
        ctx.lineWidth = Math.max(0.8, coreWidth * 0.26);
        ctx.strokeStyle = this.toCssRgba([0.98, 0.99, 1, 1], alphaScale * 0.5);
        this.traceCurvedLine(ctx, geometry);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  renderEmptyStateBackdrop() {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    gl.useProgram(this.lineProgram);
    gl.uniform2f(this.lineLocations.resolution, width, height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(this.lineLocations.position);
    gl.vertexAttribPointer(this.lineLocations.position, 2, gl.FLOAT, false, 0, 0);

    const drawSegment = (x1, y1, x2, y2, color, opacity = 1) => {
      const vertices = new Float32Array([x1, y1, x2, y2]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.uniform4fv(this.lineLocations.color, color);
      gl.uniform1f(this.lineLocations.opacity, opacity);
      gl.drawArrays(gl.LINES, 0, 2);
    };

    const step = Math.max(40, Math.floor(Math.min(width, height) / 10));
    for (let x = 0; x <= width; x += step) {
      drawSegment(x, 0, x, height, [0.32, 0.39, 0.53, 0.35], 1);
    }
    for (let y = 0; y <= height; y += step) {
      drawSegment(0, y, width, y, [0.32, 0.39, 0.53, 0.35], 1);
    }

    const centerX = width * 0.5;
    const centerY = height * 0.5;
    drawSegment(centerX, 0, centerX, height, [0.23, 0.74, 0.96, 0.95], 1);
    drawSegment(0, centerY, width, centerY, [0.96, 0.38, 0.28, 0.95], 1);
  }

  renderEmptyStateOverlay(ctx) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width <= 0 || height <= 0) return;

    const panelWidth = Math.max(260, Math.min(460, width * 0.5));
    const panelHeight = 72;
    const x = (width - panelWidth) * 0.5;
    const y = Math.max(24, height * 0.08);

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(x, y, panelWidth, panelHeight);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, panelWidth, panelHeight);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('地图暂无节点数据，已显示调试网格占位', x + panelWidth * 0.5, y + panelHeight * 0.42);

    if (this.mapDebugEnabled) {
      ctx.fillStyle = '#93c5fd';
      ctx.font = '12px monospace';
      ctx.fillText(`canvas=${width}x${height} nodes=${this.nodes.size} lines=${this.lines.length}`, x + panelWidth * 0.5, y + panelHeight * 0.74);
    }
    ctx.restore();
  }

  renderButtonIcons(ctx) {
    for (const [nodeId, buttons] of this.nodeButtons) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.visible || node.opacity < 0.3) continue;
      const revealProgress = this.getRevealProgressForNode(node.id);
      if (revealProgress < 0.48) continue;

      for (const button of buttons) {
        const btnPos = this.getButtonPosition(node, button.angle);
        const isHovered = this.hoveredButton &&
          this.hoveredButton.nodeId === nodeId &&
          this.hoveredButton.button.id === button.id;
        const isDisabled = !!button.disabled;

        const nodeHoverState = this.getNodeHoverState(node);
        const buttonOpacityFactor = nodeHoverState === 'dim' ? 0.22 : 1;
        ctx.globalAlpha = node.opacity * (isDisabled ? 0.55 : 0.9) * revealProgress * buttonOpacityFactor;
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
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.34)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // tooltip 文字
          ctx.fillStyle = '#eef8ff';
          ctx.fillText(button.tooltip, tooltipX, tooltipY);
        }
      }
    }
  }

  renderLineConnectionCaps(ctx) {
    if (!Array.isArray(this.lines) || this.lines.length === 0) return;

    let capCount = 0;
    const capLimit = 700;

    for (const line of this.getOrderedRenderableLines({ includeStubs: false })) {
      if (capCount >= capLimit) break;
      if (line?.noCaps || line?.isStub) continue;
      const fromNode = this.nodes.get(line?.from);
      const toNode = this.nodes.get(line?.to);
      if (!fromNode || !toNode || !fromNode.visible || !toNode.visible) continue;

      const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
      if (!segment) continue;
      const minOpacity = Math.max(0, Math.min(1, Math.min(fromNode.opacity, toNode.opacity)));
      if (minOpacity <= 0.08) continue;

      const color = line?.color || [0.66, 0.33, 0.97, 0.6];
      const lineHoverState = this.getLineHoverState(line);
      const isFocused = lineHoverState === 'focus';
      const isHovered = lineHoverState === 'hovered';
      const isDimmed = lineHoverState === 'dim';
      const lineVariant = String(line?.lineVariant || '');
      const isSenseTrunk = lineVariant === 'sense-trunk';
      const capRadius = Math.max(2, Math.min(5.5, Math.min(
        this.getNodeScreenRadius(fromNode),
        this.getNodeScreenRadius(toNode)
      ) * (isFocused ? 0.128 : (isHovered ? 0.12 : isSenseTrunk ? 0.115 : 0.1))));

      const drawCap = (point) => {
        const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, capRadius * 2.6);
        glow.addColorStop(0, this.toCssRgba(color, minOpacity * (isFocused ? 1.12 : (isHovered ? 0.96 : (isDimmed ? 0.16 : 0.78)))));
        glow.addColorStop(1, this.toCssRgba(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(point.x, point.y, capRadius * 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.toCssRgba([1, 1, 1, 1], minOpacity * (isDimmed ? 0.08 : 0.28));
        ctx.beginPath();
        ctx.arc(point.x, point.y, capRadius * 0.55, 0, Math.PI * 2);
        ctx.fill();
      };

      drawCap(segment.start);
      drawCap(segment.end);
      capCount += 2;
    }
  }

  renderStubLine(ctx, line, fromNode, _toNode, segment) {
    const revealProgress = this.getRevealProgressForNode(fromNode.id);
    if (revealProgress <= 0.02) return;

    const baseColor = line?.color || [0.76, 0.84, 0.96, 0.4];
    const geometry = this.getCurvedLineGeometry(segment, line);
    if (!geometry) return;
    const lineHoverState = this.getLineHoverState(line);
    const lineOpacityFactor = lineHoverState === 'dim' ? 0.12 : (lineHoverState === 'focus' ? 1.18 : 1);
    const alphaScale = Math.max(
      0.1,
      Math.min(1, fromNode.opacity * (Number(line?.glowOpacity) || 0.16) * revealProgress * 1.2 * lineOpacityFactor)
    );
    const gradient = ctx.createLinearGradient(geometry.start.x, geometry.start.y, geometry.end.x, geometry.end.y);
    gradient.addColorStop(0, this.toCssRgba(baseColor, alphaScale));
    gradient.addColorStop(0.58, this.toCssRgba(baseColor, alphaScale * 0.34));
    gradient.addColorStop(1, this.toCssRgba(baseColor, 0));

    ctx.save();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = Math.max(0.9, Number(line?.glowWidth) || 3.4);
    ctx.lineCap = 'round';
    ctx.shadowBlur = Math.max(8, (Number(line?.glowWidth) || 3.4) * 1.9);
    ctx.shadowColor = this.toCssRgba(baseColor, alphaScale * 0.42);
    this.traceCurvedLine(ctx, geometry);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(0.7, Number(line?.lineWidth) || 1.2);
    ctx.strokeStyle = this.toCssRgba(baseColor, (Number(line?.lineOpacity) || 0.18) * revealProgress * 1.08 * lineOpacityFactor);
    this.traceCurvedLine(ctx, geometry);
    ctx.stroke();
    ctx.restore();

    const stubCount = Math.max(0, Number(line?.stubCount) || 0);
    if (stubCount <= 0) return;

    const badgeNode = line?.badgeNodeId ? this.nodes.get(line.badgeNodeId) : null;
    const dx = geometry.end.x - geometry.control.x;
    const dy = geometry.end.y - geometry.control.y;
    const length = Math.hypot(dx, dy) || 1;
    const labelX = badgeNode
      ? this.worldToScreen(badgeNode.x, badgeNode.y).x
      : (geometry.end.x - (dx / length) * 18);
    const labelY = badgeNode
      ? this.worldToScreen(badgeNode.x, badgeNode.y).y
      : (geometry.end.y - (dy / length) * 18);

    ctx.save();
    ctx.globalAlpha = lineOpacityFactor;
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pillText = `+${stubCount}`;
    const textWidth = ctx.measureText(pillText).width;
    const pillWidth = textWidth + 10;
    const pillHeight = 18;
    ctx.fillStyle = 'rgba(7, 13, 24, 0.78)';
    ctx.beginPath();
    ctx.roundRect(labelX - pillWidth / 2, labelY - pillHeight / 2, pillWidth, pillHeight, 9);
    ctx.fill();
    ctx.strokeStyle = this.toCssRgba(baseColor, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#dbeafe';
    ctx.fillText(pillText, labelX, labelY + 0.5);
    ctx.restore();
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
    if (!this.shouldRenderUserMarkerOverlay()) return false;
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
    if (!this.shouldRenderUserMarkerOverlay()) return;
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
      const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
      if (!segment) continue;

      const vertices = new Float32Array([
        segment.start.x, segment.start.y,
        segment.end.x, segment.end.y
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
        const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
        if (!segment) continue;
        const vertices = new Float32Array([
          segment.start.x, segment.start.y,
          segment.end.x, segment.end.y
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

    const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
    if (!segment) return;
    const fromPos = segment.start;
    const toPos = segment.end;
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length <= 0.001) return;
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
    this.nodeRevealState = { nodeId: '', progress: 1 };
    this.previewNodes.clear();
    this.previewLines = [];
    this.savedState = null;
  }
}

export { WebGLNodeRenderer, Easing, NodeColors };
