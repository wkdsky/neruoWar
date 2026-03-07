import {
  createProgram,
  createDynamicInstanceBuffer,
  updateDynamicBuffer
} from './WebGL2Context';
import { BUILDING_INSTANCE_STRIDE } from '../snapshot/BattleSnapshotSchema';

export { BUILDING_INSTANCE_STRIDE };
const DEV_BUILDING_ORIENTATION_CHECK = process.env.NODE_ENV !== 'production';
const ORIENTATION_DIM_EPS = 1.5;
const ORIENTATION_POS_EPS = 1.6;
const ORIENTATION_WARN_TARGET_DEG = 90;
const ORIENTATION_WARN_TOLERANCE_DEG = 9;
const ORIENTATION_SAMPLE_LIMIT = 3;

const normalizeDegSigned = (deg) => {
  const raw = Number(deg) || 0;
  const wrapped = ((raw + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
};

const radToDeg = (rad) => (Number(rad) || 0) * (180 / Math.PI);

const angleDeltaDeg = (a, b) => normalizeDegSigned((Number(a) || 0) - (Number(b) || 0));

const buildRectCorners = (cx, cy, width, depth, ux, uy) => {
  const hw = Math.max(0.5, Number(width) || 1) * 0.5;
  const hd = Math.max(0.5, Number(depth) || 1) * 0.5;
  const signs = [
    { su: -1, sv: -1 },
    { su: 1, sv: -1 },
    { su: 1, sv: 1 },
    { su: -1, sv: 1 }
  ];
  return signs.map(({ su, sv }) => ({
    x: (Number(cx) || 0) + (ux.x * hw * su) + (uy.x * hd * sv),
    y: (Number(cy) || 0) + (ux.y * hw * su) + (uy.y * hd * sv)
  }));
};

const resolveLongAxisAngleDeg = (width, depth, ux, uy) => (
  Math.max(1, Number(width) || 1) >= Math.max(1, Number(depth) || 1)
    ? radToDeg(Math.atan2(ux.y, ux.x))
    : radToDeg(Math.atan2(uy.y, uy.x))
);

const buildExpectedPartInfo = (part = {}, itemId = '') => {
  const yawDeg = Number(part?.yawDeg) || 0;
  const rad = (yawDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const width = Math.max(1, Number(part?.w) || 1);
  const depth = Math.max(1, Number(part?.d) || 1);
  const ux = { x: cos, y: sin };
  const uy = { x: -sin, y: cos };
  return {
    itemId,
    cx: Number(part?.cx) || 0,
    cy: Number(part?.cy) || 0,
    yawDeg,
    width,
    depth,
    ux,
    uy,
    corners: buildRectCorners(part?.cx, part?.cy, width, depth, ux, uy),
    longAxisDeg: resolveLongAxisAngleDeg(width, depth, ux, uy)
  };
};

const buildRendererPartInfo = (row = {}) => {
  const yaw = Number(row?.yawRad) || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Keep this basis consistent with the vertex shader rot mat2 definition.
  const ux = { x: cos, y: sin };
  const uy = { x: -sin, y: cos };
  const width = Math.max(1, Number(row?.width) || 1);
  const depth = Math.max(1, Number(row?.depth) || 1);
  return {
    x: Number(row?.x) || 0,
    y: Number(row?.y) || 0,
    yawDeg: radToDeg(yaw),
    width,
    depth,
    ux,
    uy,
    corners: buildRectCorners(row?.x, row?.y, width, depth, ux, uy),
    longAxisDeg: resolveLongAxisAngleDeg(width, depth, ux, uy)
  };
};

const collectReferenceParts = (buildings = []) => {
  const out = [];
  (Array.isArray(buildings) ? buildings : []).forEach((building) => {
    if (!building) return;
    const itemId = typeof building?.itemId === 'string' ? building.itemId : '';
    const sourceParts = Array.isArray(building?.colliderParts) && building.colliderParts.length > 0
      ? building.colliderParts
      : [{
        cx: building?.x,
        cy: building?.y,
        w: building?.width,
        d: building?.depth,
        yawDeg: building?.rotation
      }];
    sourceParts.forEach((part) => {
      const width = Math.max(1, Number(part?.w) || 1);
      const depth = Math.max(1, Number(part?.d) || 1);
      if (Math.abs(width - depth) < ORIENTATION_DIM_EPS) return;
      out.push(buildExpectedPartInfo(part, itemId));
    });
  });
  return out;
};

const readBuildingInstance = (buffer, index) => {
  const base = index * BUILDING_INSTANCE_STRIDE;
  return {
    index,
    x: Number(buffer[base + 0]) || 0,
    y: Number(buffer[base + 1]) || 0,
    yawRad: Number(buffer[base + 3]) || 0,
    width: Math.max(1, Number(buffer[base + 4]) || 1),
    depth: Math.max(1, Number(buffer[base + 5]) || 1)
  };
};

const findBestInstance = (buffer, count, refPart) => {
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const row = readBuildingInstance(buffer, i);
    const posErr = Math.hypot(row.x - refPart.cx, row.y - refPart.cy);
    if (posErr > ORIENTATION_POS_EPS) continue;
    const dimErr = Math.abs(row.width - refPart.width) + Math.abs(row.depth - refPart.depth);
    const score = (posErr * 2) + dimErr;
    if (!best || score < best.score) best = { row, score };
  }
  return best?.row || null;
};

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 iData0; // x y z yaw
layout(location=3) in vec4 iData1; // width depth height hp
layout(location=4) in vec4 iData2; // destroyed topRGB
layout(location=5) in vec4 iData3; // sideRGB aux

uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vTopColor;
out vec3 vSideColor;
out float vHp;
out float vDestroyed;

void main() {
  float yaw = iData0.w;
  // CCW yaw from +X axis: ux=(cos,sin), uy=(-sin,cos)
  mat2 rot = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw));
  vec2 scaled = aPos.xy * vec2(max(1.0, iData1.x), max(1.0, iData1.y));
  vec2 worldXY = vec2(iData0.x, iData0.y) + (rot * scaled);
  float worldZ = iData0.z + (aPos.z * max(1.0, iData1.z));
  vec3 n = normalize(vec3(rot * aNormal.xy, aNormal.z));
  gl_Position = uViewProj * vec4(worldXY.x, worldXY.y, worldZ, 1.0);
  vNormal = n;
  vTopColor = vec3(iData2.y, iData2.z, iData2.w);
  vSideColor = vec3(iData3.x, iData3.y, iData3.z);
  vHp = clamp(iData1.w, 0.0, 1.0);
  vDestroyed = iData2.x;
}
`;

const FS = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vTopColor;
in vec3 vSideColor;
in float vHp;
in float vDestroyed;

out vec4 outColor;

void main() {
  if (vDestroyed > 0.5) discard;
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.28, -0.44, 0.86));
  float diffuse = max(0.15, dot(normal, lightDir));
  float topMask = smoothstep(0.42, 0.92, normal.z);
  vec3 base = mix(vSideColor, vTopColor, topMask);
  float hpShade = mix(0.35, 1.0, clamp(vHp, 0.0, 1.0));
  vec3 color = base * diffuse * hpShade;
  outColor = vec4(color, 1.0);
}
`;

const createBoxGeometry = () => {
  // aPos.xy in [-0.5, 0.5], aPos.z in [0, 1]
  const v = [
    // top
    -0.5, -0.5, 1, 0, 0, 1,
    0.5, -0.5, 1, 0, 0, 1,
    0.5, 0.5, 1, 0, 0, 1,
    -0.5, -0.5, 1, 0, 0, 1,
    0.5, 0.5, 1, 0, 0, 1,
    -0.5, 0.5, 1, 0, 0, 1,
    // front
    -0.5, 0.5, 0, 0, 1, 0,
    0.5, 0.5, 0, 0, 1, 0,
    0.5, 0.5, 1, 0, 1, 0,
    -0.5, 0.5, 0, 0, 1, 0,
    0.5, 0.5, 1, 0, 1, 0,
    -0.5, 0.5, 1, 0, 1, 0,
    // back
    0.5, -0.5, 0, 0, -1, 0,
    -0.5, -0.5, 0, 0, -1, 0,
    -0.5, -0.5, 1, 0, -1, 0,
    0.5, -0.5, 0, 0, -1, 0,
    -0.5, -0.5, 1, 0, -1, 0,
    0.5, -0.5, 1, 0, -1, 0,
    // left
    -0.5, -0.5, 0, -1, 0, 0,
    -0.5, 0.5, 0, -1, 0, 0,
    -0.5, 0.5, 1, -1, 0, 0,
    -0.5, -0.5, 0, -1, 0, 0,
    -0.5, 0.5, 1, -1, 0, 0,
    -0.5, -0.5, 1, -1, 0, 0,
    // right
    0.5, 0.5, 0, 1, 0, 0,
    0.5, -0.5, 0, 1, 0, 0,
    0.5, -0.5, 1, 1, 0, 0,
    0.5, 0.5, 0, 1, 0, 0,
    0.5, -0.5, 1, 1, 0, 0,
    0.5, 0.5, 1, 1, 0, 0,
    // bottom
    -0.5, 0.5, 0, 0, 0, -1,
    0.5, 0.5, 0, 0, 0, -1,
    0.5, -0.5, 0, 0, 0, -1,
    -0.5, 0.5, 0, 0, 0, -1,
    0.5, -0.5, 0, 0, 0, -1,
    -0.5, -0.5, 0, 0, 0, -1
  ];
  return new Float32Array(v);
};

export default class BuildingRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, VS, FS);
    this.instanceBuffer = createDynamicInstanceBuffer(gl, BUILDING_INSTANCE_STRIDE * 1024);
    this.capacity = 1024;
    this.instanceData = new Float32Array(this.capacity * BUILDING_INSTANCE_STRIDE);
    this.count = 0;
    this.devOrientationChecked = false;

    this.uniforms = {
      uViewProj: gl.getUniformLocation(this.program, 'uViewProj')
    };

    this.vao = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    this.vertexCount = 36;
    this.bindLayout();
  }

  bindLayout() {
    const gl = this.gl;
    const geometry = createBoxGeometry();
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = BUILDING_INSTANCE_STRIDE * 4;
    for (let i = 0; i < 4; i += 1) {
      const location = 2 + i;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(location, 1);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  ensureCapacity(count) {
    if (count <= this.capacity) return;
    this.capacity = Math.max(count, Math.floor(this.capacity * 1.5));
    this.instanceData = new Float32Array(this.capacity * BUILDING_INSTANCE_STRIDE);
    this.gl.deleteBuffer(this.instanceBuffer);
    this.instanceBuffer = createDynamicInstanceBuffer(this.gl, this.capacity * BUILDING_INSTANCE_STRIDE);
    this.bindLayout();
  }

  runDevOrientationCheck(referenceBuildings = []) {
    if (!DEV_BUILDING_ORIENTATION_CHECK) return false;
    if (this.count <= 0) return false;
    const referenceParts = collectReferenceParts(referenceBuildings).slice(0, ORIENTATION_SAMPLE_LIMIT);
    if (referenceParts.length <= 0) return false;
    referenceParts.forEach((refPart) => {
      const matched = findBestInstance(this.instanceData, this.count, refPart);
      if (!matched) return;
      const dimErr = Math.abs(matched.width - refPart.width) + Math.abs(matched.depth - refPart.depth);
      if (dimErr > (ORIENTATION_DIM_EPS * 2)) return;
      const renderPart = buildRendererPartInfo(matched);
      const expectedLong = refPart.longAxisDeg;
      const renderLong = renderPart.longAxisDeg;
      const delta = angleDeltaDeg(renderLong, expectedLong);
      if (Math.abs(Math.abs(delta) - ORIENTATION_WARN_TARGET_DEG) <= ORIENTATION_WARN_TOLERANCE_DEG) {
        console.warn(
          `[BuildingRenderer][DEV] Orientation mismatch near 90deg: itemId=${refPart.itemId || '(unknown)'} ` +
          `rotationDeg=${refPart.yawDeg.toFixed(2)} renderYawDeg=${renderPart.yawDeg.toFixed(2)} ` +
          `size=${refPart.width.toFixed(2)}x${refPart.depth.toFixed(2)} biasDeg=${delta.toFixed(2)}`,
          {
            expectedCorners: refPart.corners,
            rendererCorners: renderPart.corners
          }
        );
      }
    });
    return true;
  }

  updateFromSnapshot(buildings, debugReferenceBuildings = null) {
    const count = Math.max(0, Number(buildings?.count) || 0);
    this.ensureCapacity(count);
    if (count <= 0 || !(buildings?.data instanceof Float32Array)) {
      this.count = 0;
      return;
    }
    const floats = count * BUILDING_INSTANCE_STRIDE;
    this.instanceData.set(buildings.data.subarray(0, floats), 0);
    this.count = count;
    updateDynamicBuffer(this.gl, this.instanceBuffer, this.instanceData, floats);
    if (!this.devOrientationChecked && DEV_BUILDING_ORIENTATION_CHECK && Array.isArray(debugReferenceBuildings)) {
      this.devOrientationChecked = this.runDevOrientationCheck(debugReferenceBuildings);
    }
  }

  render(cameraState) {
    if (this.count <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertexCount, this.count);
    gl.bindVertexArray(null);
    gl.useProgram(null);
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
