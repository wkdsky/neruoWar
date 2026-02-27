const createShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
};

export const createProgram = (gl, vertexSource, fragmentSource) => {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
};

export const createBattleGlContext = (canvas) => {
  if (!canvas) return null;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    premultipliedAlpha: false,
    preserveDrawingBuffer: false
  });
  if (!gl) return null;

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.03, 0.06, 0.09, 1);
  return gl;
};

export const resizeCanvasToDisplaySize = (canvas, gl) => {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const displayWidth = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const displayHeight = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
};

export const createStaticQuadVao = (gl, attrs) => {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const quad = new Float32Array([
    -0.5, 0, 0, 0,
    0.5, 0, 1, 0,
    -0.5, 1, 0, 1,
    0.5, 1, 1, 1
  ]);
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  gl.enableVertexAttribArray(attrs.position);
  gl.vertexAttribPointer(attrs.position, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(attrs.uv);
  gl.vertexAttribPointer(attrs.uv, 2, gl.FLOAT, false, 16, 8);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return { vao, quadBuffer };
};

export const createDynamicInstanceBuffer = (gl, floatCount = 1024) => {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, Math.max(16, floatCount) * 4, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return buffer;
};

export const updateDynamicBuffer = (gl, buffer, array, usedFloatCount) => {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, array.subarray(0, usedFloatCount), gl.DYNAMIC_DRAW);
};
