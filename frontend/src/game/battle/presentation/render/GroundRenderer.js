import { createProgram } from './WebGL2Context';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uViewProj;
uniform vec2 uField;
out vec2 vWorld;
void main() {
  vec2 world = vec2(aPos.x * uField.x * 0.5, aPos.y * uField.y * 0.5);
  vWorld = world;
  gl_Position = uViewProj * vec4(world.x, world.y, 0.0, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
in vec2 vWorld;
uniform vec2 uField;
uniform vec2 uDeployRange;
out vec4 outColor;

float gridLine(float value, float stepSize, float thickness) {
  float a = abs(fract((value / stepSize) + 0.5) - 0.5);
  return smoothstep(thickness, 0.0, a);
}

void main() {
  vec2 uv = (vWorld / uField) + 0.5;
  float vignette = smoothstep(1.08, 0.18, distance(uv, vec2(0.5)));
  float attackerMask = 1.0 - step(uDeployRange.x, vWorld.x);
  float defenderMask = step(uDeployRange.y, vWorld.x);
  float centerMask = clamp(1.0 - attackerMask - defenderMask, 0.0, 1.0);
  vec3 leftA = vec3(0.05, 0.16, 0.28);
  vec3 leftB = vec3(0.02, 0.10, 0.18);
  vec3 centerA = vec3(0.22, 0.20, 0.14);
  vec3 centerB = vec3(0.14, 0.12, 0.09);
  vec3 rightA = vec3(0.26, 0.10, 0.10);
  vec3 rightB = vec3(0.16, 0.05, 0.07);
  vec3 leftBase = mix(leftB, leftA, clamp(uv.y, 0.0, 1.0));
  vec3 centerBase = mix(centerB, centerA, clamp(uv.y, 0.0, 1.0));
  vec3 rightBase = mix(rightB, rightA, clamp(uv.y, 0.0, 1.0));
  vec3 base = (leftBase * attackerMask) + (centerBase * centerMask) + (rightBase * defenderMask);

  float g1 = max(gridLine(vWorld.x, 28.0, 0.035), gridLine(vWorld.y, 28.0, 0.035));
  float g2 = max(gridLine(vWorld.x, 112.0, 0.02), gridLine(vWorld.y, 112.0, 0.02));
  vec3 leftGrid = vec3(0.10, 0.22, 0.36) * g1 + vec3(0.14, 0.30, 0.48) * g2;
  vec3 centerGrid = vec3(0.34, 0.30, 0.22) * g1 + vec3(0.46, 0.40, 0.28) * g2;
  vec3 rightGrid = vec3(0.36, 0.14, 0.14) * g1 + vec3(0.44, 0.20, 0.18) * g2;
  vec3 grid = (leftGrid * attackerMask) + (centerGrid * centerMask) + (rightGrid * defenderMask);

  float centerBand = centerMask * (1.0 - smoothstep(0.0, 42.0, abs(vWorld.x - ((uDeployRange.x + uDeployRange.y) * 0.5))));
  float attackerDivider = 1.0 - smoothstep(0.0, 6.0, abs(vWorld.x - uDeployRange.x));
  float defenderDivider = 1.0 - smoothstep(0.0, 6.0, abs(vWorld.x - uDeployRange.y));
  float dividerBand = max(attackerDivider, defenderDivider);
  vec3 divider = mix(vec3(0.95, 0.97, 1.0), vec3(1.0, 0.93, 0.78), clamp(centerBand * 1.35, 0.0, 1.0))
    * max(centerBand * 0.42, dividerBand * 0.45);

  vec3 color = (base + grid + divider) * mix(0.72, 1.0, vignette);
  outColor = vec4(color, 1.0);
}
`;

export default class GroundRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, VS, FS);
    this.uniforms = {
      uViewProj: gl.getUniformLocation(this.program, 'uViewProj'),
      uField: gl.getUniformLocation(this.program, 'uField'),
      uDeployRange: gl.getUniformLocation(this.program, 'uDeployRange')
    };

    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.fieldWidth = 1350;
    this.fieldHeight = 744;
    this.deployAttackerMaxX = -10;
    this.deployDefenderMinX = 10;
  }

  setFieldSize(width, height) {
    this.fieldWidth = Math.max(100, Number(width) || 1350);
    this.fieldHeight = Math.max(100, Number(height) || 744);
  }

  setDeployRange(range = null) {
    this.deployAttackerMaxX = Number(range?.attackerMaxX) || -10;
    this.deployDefenderMinX = Number(range?.defenderMinX) || 10;
  }

  render(cameraState) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
    gl.uniform2f(this.uniforms.uField, this.fieldWidth, this.fieldHeight);
    gl.uniform2f(this.uniforms.uDeployRange, this.deployAttackerMaxX, this.deployDefenderMinX);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.useProgram(null);
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
