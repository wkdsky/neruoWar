import {
  createProgram,
  createStaticQuadVao,
  createDynamicInstanceBuffer,
  updateDynamicBuffer
} from './WebGL2Context';

export const BUILDING_INSTANCE_STRIDE = 8;

const VS = `#version 300 es
layout(location=0) in vec2 aQuadPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 iData0; // x y width depth
layout(location=3) in vec4 iData1; // height rot hp destroyed

uniform mat4 uViewProj;

out vec2 vUv;
out float vHp;
out float vDestroyed;

void main() {
  float rot = iData1.y;
  vec2 dirX = vec2(cos(rot), sin(rot));
  vec2 dirY = vec2(-sin(rot), cos(rot));
  vec2 local = vec2(aQuadPos.x * iData0.z, (aQuadPos.y - 0.5) * iData0.w);
  vec2 world2 = vec2(iData0.x, iData0.y) + (dirX * local.x) + (dirY * local.y);
  float z = max(2.0, iData1.x);
  gl_Position = uViewProj * vec4(world2.x, world2.y, z, 1.0);
  vUv = aUv;
  vHp = iData1.z;
  vDestroyed = iData1.w;
}
`;

const FS = `#version 300 es
precision highp float;

in vec2 vUv;
in float vHp;
in float vDestroyed;

uniform float uPitchMix;
out vec4 outColor;

float bayer4x4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int idx = x + (y * 4);
  float table[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  return (table[idx] + 0.5) / 16.0;
}

void main() {
  if (vDestroyed > 0.5) discard;
  float roofKeep = 1.0 - (uPitchMix * 0.95);
  float d = bayer4x4(gl_FragCoord.xy + vec2(2.0, 1.0));
  if (roofKeep < d) discard;
  float edge = smoothstep(0.0, 0.04, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
  vec3 base = mix(vec3(0.20, 0.24, 0.30), vec3(0.38, 0.45, 0.55), edge);
  base *= mix(0.38, 1.0, clamp(vHp, 0.0, 1.0));
  outColor = vec4(base, 1.0);
}
`;

export default class BuildingRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, VS, FS);
    this.instanceBuffer = createDynamicInstanceBuffer(gl, BUILDING_INSTANCE_STRIDE * 1024);
    this.capacity = 1024;
    this.instanceData = new Float32Array(this.capacity * BUILDING_INSTANCE_STRIDE);
    this.count = 0;

    this.attrs = { position: 0, uv: 1, iData0: 2, iData1: 3 };
    const quad = createStaticQuadVao(gl, this.attrs);
    this.vao = quad.vao;
    this.quadBuffer = quad.quadBuffer;

    this.uniforms = {
      uViewProj: gl.getUniformLocation(this.program, 'uViewProj'),
      uPitchMix: gl.getUniformLocation(this.program, 'uPitchMix')
    };

    this.bindLayout();
  }

  bindLayout() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = BUILDING_INSTANCE_STRIDE * 4;

    gl.enableVertexAttribArray(this.attrs.iData0);
    gl.vertexAttribPointer(this.attrs.iData0, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(this.attrs.iData0, 1);

    gl.enableVertexAttribArray(this.attrs.iData1);
    gl.vertexAttribPointer(this.attrs.iData1, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(this.attrs.iData1, 1);

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

  render(cameraState, pitchMix = 0) {
    if (this.count <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
    gl.uniform1f(this.uniforms.uPitchMix, Math.max(0, Math.min(1, Number(pitchMix) || 0)));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
    gl.useProgram(null);
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
