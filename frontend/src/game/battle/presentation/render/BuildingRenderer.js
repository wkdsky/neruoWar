import {
  createProgram,
  createDynamicInstanceBuffer,
  updateDynamicBuffer
} from './WebGL2Context';

export const BUILDING_INSTANCE_STRIDE = 16;

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
  mat2 rot = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw));
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

  updateFromSnapshot(buildings) {
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
