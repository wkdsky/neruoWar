import {
  createProgram,
  createStaticQuadVao,
  createDynamicInstanceBuffer,
  updateDynamicBuffer
} from './WebGL2Context';

export const PROJECTILE_INSTANCE_STRIDE = 8;

const VS = `#version 300 es
layout(location=0) in vec2 aQuadPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 iData0; // x y z radius
layout(location=3) in vec4 iData1; // team type ttl age

uniform mat4 uViewProj;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;

out vec2 vUv;
out float vTeam;
out float vType;
out float vLife;

void main() {
  float size = max(0.6, iData0.w);
  vec3 right = normalize(uCameraRight) * size;
  vec3 up = normalize(uCameraUp) * size;
  vec3 pos = vec3(iData0.xyz) + (right * aQuadPos.x) + (up * (aQuadPos.y - 0.5));
  gl_Position = uViewProj * vec4(pos, 1.0);
  vUv = aUv;
  vTeam = iData1.x;
  vType = iData1.y;
  vLife = iData1.z;
}
`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUv;
in float vTeam;
in float vType;
in float vLife;

uniform sampler2DArray uTexArray;
uniform float uUseTexArray;

out vec4 outColor;

void main() {
  vec2 p = (vUv * 2.0) - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float alpha = smoothstep(1.0, 0.0, d) * clamp(vLife, 0.25, 1.0);
  vec3 color = (vTeam < 0.5) ? vec3(0.45, 0.74, 1.0) : vec3(1.0, 0.56, 0.46);
  if (vType > 0.5) {
    color = mix(color, vec3(1.0, 0.86, 0.42), 0.45);
  }
  if (uUseTexArray > 0.5) {
    float layer = floor(mod(vType, 4.0) + 0.5);
    vec4 texel = texture(uTexArray, vec3(vUv, layer));
    color = mix(color, texel.rgb, texel.a * 0.75);
    alpha *= max(0.2, texel.a);
  }
  outColor = vec4(color, alpha);
}
`;

export default class ProjectileRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, VS, FS);
    this.buffer = createDynamicInstanceBuffer(gl, PROJECTILE_INSTANCE_STRIDE * 4096);
    this.capacity = 4096;
    this.count = 0;
    this.data = new Float32Array(this.capacity * PROJECTILE_INSTANCE_STRIDE);

    this.attrs = { position: 0, uv: 1, iData0: 2, iData1: 3 };
    const quad = createStaticQuadVao(gl, this.attrs);
    this.vao = quad.vao;
    this.quadBuffer = quad.quadBuffer;

    this.uniforms = {
      uViewProj: gl.getUniformLocation(this.program, 'uViewProj'),
      uCameraRight: gl.getUniformLocation(this.program, 'uCameraRight'),
      uCameraUp: gl.getUniformLocation(this.program, 'uCameraUp'),
      uTexArray: gl.getUniformLocation(this.program, 'uTexArray'),
      uUseTexArray: gl.getUniformLocation(this.program, 'uUseTexArray')
    };
    this.textureArray = null;

    this.bindLayout();
  }

  setTextureArray(texture) {
    this.textureArray = texture || null;
  }

  bindLayout() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = PROJECTILE_INSTANCE_STRIDE * 4;
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
    this.data = new Float32Array(this.capacity * PROJECTILE_INSTANCE_STRIDE);
    this.gl.deleteBuffer(this.buffer);
    this.buffer = createDynamicInstanceBuffer(this.gl, this.capacity * PROJECTILE_INSTANCE_STRIDE);
    this.bindLayout();
  }

  updateFromSnapshot(projectiles) {
    const count = Math.max(0, Number(projectiles?.count) || 0);
    this.ensureCapacity(count);
    if (count <= 0 || !(projectiles?.data instanceof Float32Array)) {
      this.count = 0;
      return;
    }
    const len = count * PROJECTILE_INSTANCE_STRIDE;
    this.data.set(projectiles.data.subarray(0, len), 0);
    this.count = count;
    updateDynamicBuffer(this.gl, this.buffer, this.data, len);
  }

  render(cameraState) {
    if (this.count <= 0) return;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
    gl.uniform3fv(this.uniforms.uCameraRight, new Float32Array(cameraState.cameraRight));
    gl.uniform3f(this.uniforms.uCameraUp, 0, 0, 1);
    if (this.textureArray) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray);
      gl.uniform1i(this.uniforms.uTexArray, 0);
      gl.uniform1f(this.uniforms.uUseTexArray, 1);
    } else {
      gl.uniform1f(this.uniforms.uUseTexArray, 0);
    }
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.useProgram(null);
    gl.disable(gl.BLEND);
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
