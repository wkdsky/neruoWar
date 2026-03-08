import {
  createProgram,
  createDynamicInstanceBuffer,
  updateDynamicBuffer
} from './WebGL2Context';
import { BUILDING_INSTANCE_STRIDE } from '../snapshot/BattleSnapshotSchema';
import { createBushBladeCanvas } from '../../../battlefield/items/ItemGeometryRegistry';

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

const BOX_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 iData0;
layout(location=3) in vec4 iData1;
layout(location=4) in vec4 iData2;
layout(location=5) in vec4 iData3;

uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vTopColor;
out vec3 vSideColor;
out float vHp;
out float vDestroyed;

void main() {
  float yaw = iData0.w;
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

const BOX_FS = `#version 300 es
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

const FOLIAGE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 iData0;
layout(location=4) in vec4 iData1;
layout(location=5) in vec4 iData2;
layout(location=6) in vec4 iData3;

uniform mat4 uViewProj;

out vec3 vNormal;
out vec2 vUv;
out vec3 vTopColor;
out vec3 vSideColor;
out float vHp;
out float vAlpha;
out float vDestroyed;

void main() {
  float yaw = iData0.w;
  mat2 rot = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw));
  vec2 scaled = aPos.xy * vec2(max(1.0, iData1.x), max(1.0, iData1.y));
  vec2 worldXY = vec2(iData0.x, iData0.y) + (rot * scaled);
  float worldZ = iData0.z + (aPos.z * max(1.0, iData1.z));
  vec3 n = normalize(vec3(rot * aNormal.xy, aNormal.z));
  gl_Position = uViewProj * vec4(worldXY.x, worldXY.y, worldZ, 1.0);
  vNormal = n;
  vUv = aUv;
  vTopColor = vec3(iData2.y, iData2.z, iData2.w);
  vSideColor = vec3(iData3.x, iData3.y, iData3.z);
  vHp = clamp(iData1.w, 0.0, 1.0);
  vAlpha = clamp(iData3.w, 0.0, 1.0);
  vDestroyed = iData2.x;
}
`;

const FOLIAGE_FS = `#version 300 es
precision highp float;

uniform sampler2D uBladeTex;

in vec3 vNormal;
in vec2 vUv;
in vec3 vTopColor;
in vec3 vSideColor;
in float vHp;
in float vAlpha;
in float vDestroyed;

out vec4 outColor;

void main() {
  if (vDestroyed > 0.5 || vAlpha <= 0.001) discard;
  vec4 tex = texture(uBladeTex, vUv);
  float alpha = tex.a * vAlpha;
  if (alpha < 0.08) discard;
  vec3 normal = normalize(vNormal + vec3(0.0, 0.0, 0.34));
  vec3 lightDir = normalize(vec3(0.26, -0.42, 0.87));
  float diffuse = max(0.2, dot(normal, lightDir));
  float topMix = clamp((vUv.y * 0.78) + 0.16, 0.0, 1.0);
  vec3 base = mix(vSideColor, vTopColor, topMix);
  float texHighlight = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = mix(base * 0.84, base * 1.16, clamp(texHighlight * 1.2, 0.0, 1.0));
  float hpShade = mix(0.45, 1.0, clamp(vHp, 0.0, 1.0));
  outColor = vec4(color * diffuse * hpShade, alpha);
}
`;

const MASK_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 iData0;
layout(location=3) in vec4 iData1;
layout(location=4) in vec4 iData2;
layout(location=5) in vec4 iData3;

uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vTopColor;
out vec3 vSideColor;
out float vAlpha;

void main() {
  float yaw = iData0.w;
  mat2 rot = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw));
  vec2 worldXY = vec2(iData0.x, iData0.y) + (rot * (aPos.xy * vec2(max(1.0, iData1.x), max(1.0, iData1.y))));
  float worldZ = iData0.z + (aPos.z * max(1.0, iData1.z));
  gl_Position = uViewProj * vec4(worldXY.x, worldXY.y, worldZ, 1.0);
  vNormal = normalize(vec3(rot * aNormal.xy, aNormal.z));
  vTopColor = vec3(iData2.y, iData2.z, iData2.w);
  vSideColor = vec3(iData3.x, iData3.y, iData3.z);
  vAlpha = clamp(iData3.w, 0.0, 1.0);
}
`;

const MASK_FS = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vTopColor;
in vec3 vSideColor;
in float vAlpha;

out vec4 outColor;

void main() {
  if (vAlpha <= 0.001) discard;
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.2, -0.32, 0.93));
  float diffuse = max(0.22, dot(normal, lightDir));
  float domeMix = smoothstep(0.05, 0.95, clamp(normal.z * 0.5 + 0.5, 0.0, 1.0));
  vec3 color = mix(vSideColor, vTopColor, domeMix) * diffuse;
  outColor = vec4(color, vAlpha);
}
`;

const createBoxGeometry = () => {
  const v = [
    -0.5, -0.5, 1, 0, 0, 1,
    0.5, -0.5, 1, 0, 0, 1,
    0.5, 0.5, 1, 0, 0, 1,
    -0.5, -0.5, 1, 0, 0, 1,
    0.5, 0.5, 1, 0, 0, 1,
    -0.5, 0.5, 1, 0, 0, 1,
    -0.5, 0.5, 0, 0, 1, 0,
    0.5, 0.5, 0, 0, 1, 0,
    0.5, 0.5, 1, 0, 1, 0,
    -0.5, 0.5, 0, 0, 1, 0,
    0.5, 0.5, 1, 0, 1, 0,
    -0.5, 0.5, 1, 0, 1, 0,
    0.5, -0.5, 0, 0, -1, 0,
    -0.5, -0.5, 0, 0, -1, 0,
    -0.5, -0.5, 1, 0, -1, 0,
    0.5, -0.5, 0, 0, -1, 0,
    -0.5, -0.5, 1, 0, -1, 0,
    0.5, -0.5, 1, 0, -1, 0,
    -0.5, -0.5, 0, -1, 0, 0,
    -0.5, 0.5, 0, -1, 0, 0,
    -0.5, 0.5, 1, -1, 0, 0,
    -0.5, -0.5, 0, -1, 0, 0,
    -0.5, 0.5, 1, -1, 0, 0,
    -0.5, -0.5, 1, -1, 0, 0,
    0.5, 0.5, 0, 1, 0, 0,
    0.5, -0.5, 0, 1, 0, 0,
    0.5, -0.5, 1, 1, 0, 0,
    0.5, 0.5, 0, 1, 0, 0,
    0.5, -0.5, 1, 1, 0, 0,
    0.5, 0.5, 1, 1, 0, 0,
    -0.5, 0.5, 0, 0, 0, -1,
    0.5, 0.5, 0, 0, 0, -1,
    0.5, -0.5, 0, 0, 0, -1,
    -0.5, 0.5, 0, 0, 0, -1,
    0.5, -0.5, 0, 0, 0, -1,
    -0.5, -0.5, 0, 0, 0, -1
  ];
  return new Float32Array(v);
};

const pushFoliageQuad = (verts, dirX, dirY, widthScale = 1, heightScale = 1, zBase = 0, normalFlip = 1) => {
  const half = 0.5 * widthScale;
  const lx = dirX * half;
  const ly = dirY * half;
  const nx = (-dirY) * normalFlip;
  const ny = dirX * normalFlip;
  const z0 = zBase;
  const z1 = zBase + heightScale;
  verts.push(
    -lx, -ly, z0, nx, ny, 0, 0, 0,
    lx, ly, z0, nx, ny, 0, 1, 0,
    lx, ly, z1, nx, ny, 0, 1, 1,
    -lx, -ly, z0, nx, ny, 0, 0, 0,
    lx, ly, z1, nx, ny, 0, 1, 1,
    -lx, -ly, z1, nx, ny, 0, 0, 1
  );
};

const createFoliageGeometry = () => {
  const verts = [];
  const configs = [
    { angle: 0, width: 1.08, height: 1.0, z: 0.02 },
    { angle: Math.PI / 4, width: 0.98, height: 0.96, z: 0.0 },
    { angle: Math.PI / 2, width: 1.02, height: 0.94, z: 0.01 },
    { angle: Math.PI * 0.75, width: 0.92, height: 0.9, z: 0.0 },
    { angle: Math.PI / 8, width: 0.7, height: 0.68, z: 0.12 },
    { angle: Math.PI * 0.58, width: 0.74, height: 0.72, z: 0.1 }
  ];
  configs.forEach((config, index) => {
    const dirX = Math.cos(config.angle);
    const dirY = Math.sin(config.angle);
    pushFoliageQuad(verts, dirX, dirY, config.width, config.height, config.z, 1);
    if (index < 4) pushFoliageQuad(verts, dirX, dirY, config.width * 0.92, config.height * 0.88, config.z + 0.04, -1);
  });
  return new Float32Array(verts);
};

const createConcealmentMaskGeometry = () => {
  const verts = [];
  const lonSegments = 36;
  const latSegments = 12;
  for (let lat = 0; lat < latSegments; lat += 1) {
    const t0 = (lat / latSegments) * (Math.PI * 0.5);
    const t1 = ((lat + 1) / latSegments) * (Math.PI * 0.5);
    const z0 = Math.sin(t0);
    const z1 = Math.sin(t1);
    const r0 = Math.cos(t0);
    const r1 = Math.cos(t1);
    for (let lon = 0; lon < lonSegments; lon += 1) {
      const p0 = (lon / lonSegments) * Math.PI * 2;
      const p1 = ((lon + 1) / lonSegments) * Math.PI * 2;
      const a = [Math.cos(p0) * r0, Math.sin(p0) * r0, z0];
      const b = [Math.cos(p1) * r0, Math.sin(p1) * r0, z0];
      const c = [Math.cos(p1) * r1, Math.sin(p1) * r1, z1];
      const d = [Math.cos(p0) * r1, Math.sin(p0) * r1, z1];
      verts.push(...a, ...a, ...b, ...b, ...c, ...c, ...a, ...a, ...c, ...c, ...d, ...d);
    }
  }
  for (let lon = 0; lon < lonSegments; lon += 1) {
    const p0 = (lon / lonSegments) * Math.PI * 2;
    const p1 = ((lon + 1) / lonSegments) * Math.PI * 2;
    verts.push(
      0, 0, 0, 0, 0, 1,
      Math.cos(p1), Math.sin(p1), 0, 0, 0, 1,
      Math.cos(p0), Math.sin(p0), 0, 0, 0, 1
    );
  }
  return new Float32Array(verts);
};

const createBushBladeTexture = (gl) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const canvas = createBushBladeCanvas();
  if (canvas) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255])
    );
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
};

export default class BuildingRenderer {
  constructor(gl) {
    this.gl = gl;
    this.solidProgram = createProgram(gl, BOX_VS, BOX_FS);
    this.foliageProgram = createProgram(gl, FOLIAGE_VS, FOLIAGE_FS);
    this.maskProgram = createProgram(gl, MASK_VS, MASK_FS);

    this.solidInstanceBuffer = createDynamicInstanceBuffer(gl, BUILDING_INSTANCE_STRIDE * 1024);
    this.foliageInstanceBuffer = createDynamicInstanceBuffer(gl, BUILDING_INSTANCE_STRIDE * 256);
    this.maskInstanceBuffer = createDynamicInstanceBuffer(gl, BUILDING_INSTANCE_STRIDE * 128);
    this.solidCapacity = 1024;
    this.foliageCapacity = 256;
    this.maskCapacity = 128;
    this.solidInstanceData = new Float32Array(this.solidCapacity * BUILDING_INSTANCE_STRIDE);
    this.foliageInstanceData = new Float32Array(this.foliageCapacity * BUILDING_INSTANCE_STRIDE);
    this.maskInstanceData = new Float32Array(this.maskCapacity * BUILDING_INSTANCE_STRIDE);
    this.solidCount = 0;
    this.foliageCount = 0;
    this.maskCount = 0;
    this.devOrientationChecked = false;

    this.solidUniforms = {
      uViewProj: gl.getUniformLocation(this.solidProgram, 'uViewProj')
    };
    this.foliageUniforms = {
      uViewProj: gl.getUniformLocation(this.foliageProgram, 'uViewProj'),
      uBladeTex: gl.getUniformLocation(this.foliageProgram, 'uBladeTex')
    };
    this.maskUniforms = {
      uViewProj: gl.getUniformLocation(this.maskProgram, 'uViewProj')
    };

    this.solidVao = gl.createVertexArray();
    this.solidVertexBuffer = gl.createBuffer();
    this.solidVertexCount = 36;
    this.bindSolidLayout();

    this.foliageVao = gl.createVertexArray();
    this.foliageVertexBuffer = gl.createBuffer();
    this.foliageVertexCount = 0;
    this.bindFoliageLayout();

    this.maskVao = gl.createVertexArray();
    this.maskVertexBuffer = gl.createBuffer();
    this.maskVertexCount = 0;
    this.bindMaskLayout();

    this.foliageTexture = createBushBladeTexture(gl);
  }

  bindSolidLayout() {
    const gl = this.gl;
    const geometry = createBoxGeometry();
    gl.bindVertexArray(this.solidVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidInstanceBuffer);
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

  bindFoliageLayout() {
    const gl = this.gl;
    const geometry = createFoliageGeometry();
    this.foliageVertexCount = geometry.length / 8;
    gl.bindVertexArray(this.foliageVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.foliageVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.foliageInstanceBuffer);
    const stride = BUILDING_INSTANCE_STRIDE * 4;
    for (let i = 0; i < 4; i += 1) {
      const location = 3 + i;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(location, 1);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  bindMaskLayout() {
    const gl = this.gl;
    const geometry = createConcealmentMaskGeometry();
    this.maskVertexCount = geometry.length / 6;
    gl.bindVertexArray(this.maskVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.maskVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.maskInstanceBuffer);
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

  ensureSolidCapacity(count) {
    if (count <= this.solidCapacity) return;
    this.solidCapacity = Math.max(count, Math.floor(this.solidCapacity * 1.5));
    this.solidInstanceData = new Float32Array(this.solidCapacity * BUILDING_INSTANCE_STRIDE);
    this.gl.deleteBuffer(this.solidInstanceBuffer);
    this.solidInstanceBuffer = createDynamicInstanceBuffer(this.gl, this.solidCapacity * BUILDING_INSTANCE_STRIDE);
    this.bindSolidLayout();
  }

  ensureFoliageCapacity(count) {
    if (count <= this.foliageCapacity) return;
    this.foliageCapacity = Math.max(count, Math.floor(this.foliageCapacity * 1.5));
    this.foliageInstanceData = new Float32Array(this.foliageCapacity * BUILDING_INSTANCE_STRIDE);
    this.gl.deleteBuffer(this.foliageInstanceBuffer);
    this.foliageInstanceBuffer = createDynamicInstanceBuffer(this.gl, this.foliageCapacity * BUILDING_INSTANCE_STRIDE);
    this.bindFoliageLayout();
  }

  ensureMaskCapacity(count) {
    if (count <= this.maskCapacity) return;
    this.maskCapacity = Math.max(count, Math.floor(this.maskCapacity * 1.5));
    this.maskInstanceData = new Float32Array(this.maskCapacity * BUILDING_INSTANCE_STRIDE);
    this.gl.deleteBuffer(this.maskInstanceBuffer);
    this.maskInstanceBuffer = createDynamicInstanceBuffer(this.gl, this.maskCapacity * BUILDING_INSTANCE_STRIDE);
    this.bindMaskLayout();
  }

  runDevOrientationCheck(referenceBuildings = []) {
    if (!DEV_BUILDING_ORIENTATION_CHECK) return false;
    if (this.solidCount <= 0) return false;
    const referenceParts = collectReferenceParts(referenceBuildings).slice(0, ORIENTATION_SAMPLE_LIMIT);
    if (referenceParts.length <= 0) return false;
    referenceParts.forEach((refPart) => {
      const matched = findBestInstance(this.solidInstanceData, this.solidCount, refPart);
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

  updateFromSnapshot(buildings, debugReferenceBuildings = null, sourceBuildings = []) {
    const count = Math.max(0, Number(buildings?.count) || 0);
    if (count <= 0 || !(buildings?.data instanceof Float32Array)) {
      this.solidCount = 0;
      this.foliageCount = 0;
      this.maskCount = 0;
      return;
    }
    this.ensureSolidCapacity(count);
    this.ensureFoliageCapacity(Math.max(4, Math.ceil(count * 0.4)));
    this.ensureMaskCapacity(Math.max(4, Math.ceil((Array.isArray(sourceBuildings) ? sourceBuildings.length : 0) * 0.5)));

    let solidCount = 0;
    let foliageCount = 0;
    for (let i = 0; i < count; i += 1) {
      const base = i * BUILDING_INSTANCE_STRIDE;
      const opacity = Math.max(0, Number(buildings.data[base + 15]) || 0);
      const target = opacity > 0.001 ? this.foliageInstanceData : this.solidInstanceData;
      const targetBase = (opacity > 0.001 ? foliageCount : solidCount) * BUILDING_INSTANCE_STRIDE;
      for (let j = 0; j < BUILDING_INSTANCE_STRIDE; j += 1) {
        target[targetBase + j] = buildings.data[base + j];
      }
      if (opacity > 0.001) foliageCount += 1;
      else solidCount += 1;
    }

    this.solidCount = solidCount;
    this.foliageCount = foliageCount;
    let maskCount = 0;
    (Array.isArray(sourceBuildings) ? sourceBuildings : []).forEach((building) => {
      const alpha = Math.max(0, Number(building?.renderMaskAlpha) || 0);
      const radius = Math.max(0, Number(building?.renderMaskRadius) || 0);
      if (!building || building.destroyed || alpha <= 0.001 || radius <= 0.001) return;
      this.ensureMaskCapacity(maskCount + 1);
      const base = maskCount * BUILDING_INSTANCE_STRIDE;
      this.maskInstanceData[base + 0] = Number(building?.x) || 0;
      this.maskInstanceData[base + 1] = Number(building?.y) || 0;
      this.maskInstanceData[base + 2] = 0;
      this.maskInstanceData[base + 3] = 0;
      this.maskInstanceData[base + 4] = radius;
      this.maskInstanceData[base + 5] = radius;
      this.maskInstanceData[base + 6] = radius * 0.92;
      this.maskInstanceData[base + 7] = 1;
      this.maskInstanceData[base + 8] = 0;
      this.maskInstanceData[base + 9] = 0.13;
      this.maskInstanceData[base + 10] = 0.77;
      this.maskInstanceData[base + 11] = 0.33;
      this.maskInstanceData[base + 12] = 0.09;
      this.maskInstanceData[base + 13] = 0.62;
      this.maskInstanceData[base + 14] = 0.25;
      this.maskInstanceData[base + 15] = alpha;
      maskCount += 1;
    });
    this.maskCount = maskCount;
    updateDynamicBuffer(this.gl, this.solidInstanceBuffer, this.solidInstanceData, solidCount * BUILDING_INSTANCE_STRIDE);
    updateDynamicBuffer(this.gl, this.foliageInstanceBuffer, this.foliageInstanceData, foliageCount * BUILDING_INSTANCE_STRIDE);
    updateDynamicBuffer(this.gl, this.maskInstanceBuffer, this.maskInstanceData, maskCount * BUILDING_INSTANCE_STRIDE);
    if (!this.devOrientationChecked && DEV_BUILDING_ORIENTATION_CHECK && Array.isArray(debugReferenceBuildings)) {
      this.devOrientationChecked = this.runDevOrientationCheck(debugReferenceBuildings);
    }
  }

  render(cameraState) {
    const gl = this.gl;
    if (this.solidCount > 0) {
      gl.useProgram(this.solidProgram);
      gl.bindVertexArray(this.solidVao);
      gl.uniformMatrix4fv(this.solidUniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.solidVertexCount, this.solidCount);
    }

    if (this.foliageCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.foliageProgram);
      gl.bindVertexArray(this.foliageVao);
      gl.uniformMatrix4fv(this.foliageUniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.foliageTexture);
      gl.uniform1i(this.foliageUniforms.uBladeTex, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.foliageVertexCount, this.foliageCount);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    if (this.maskCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.maskProgram);
      gl.bindVertexArray(this.maskVao);
      gl.uniformMatrix4fv(this.maskUniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.maskVertexCount, this.maskCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.bindVertexArray(null);
    gl.useProgram(null);
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.solidProgram) gl.deleteProgram(this.solidProgram);
    if (this.foliageProgram) gl.deleteProgram(this.foliageProgram);
    if (this.maskProgram) gl.deleteProgram(this.maskProgram);
    if (this.solidInstanceBuffer) gl.deleteBuffer(this.solidInstanceBuffer);
    if (this.foliageInstanceBuffer) gl.deleteBuffer(this.foliageInstanceBuffer);
    if (this.maskInstanceBuffer) gl.deleteBuffer(this.maskInstanceBuffer);
    if (this.solidVertexBuffer) gl.deleteBuffer(this.solidVertexBuffer);
    if (this.foliageVertexBuffer) gl.deleteBuffer(this.foliageVertexBuffer);
    if (this.maskVertexBuffer) gl.deleteBuffer(this.maskVertexBuffer);
    if (this.solidVao) gl.deleteVertexArray(this.solidVao);
    if (this.foliageVao) gl.deleteVertexArray(this.foliageVao);
    if (this.maskVao) gl.deleteVertexArray(this.maskVao);
    if (this.foliageTexture) gl.deleteTexture(this.foliageTexture);
  }
}
