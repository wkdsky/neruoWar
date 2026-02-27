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
out vec4 outColor;

float gridLine(float value, float stepSize, float thickness) {
  float a = abs(fract((value / stepSize) + 0.5) - 0.5);
  return smoothstep(thickness, 0.0, a);
}

void main() {
  vec2 uv = (vWorld / uField) + 0.5;
  float vignette = smoothstep(1.0, 0.2, distance(uv, vec2(0.5)));
  vec3 baseA = vec3(0.07, 0.12, 0.16);
  vec3 baseB = vec3(0.03, 0.08, 0.11);
  vec3 base = mix(baseB, baseA, clamp(uv.y, 0.0, 1.0));

  float g1 = max(gridLine(vWorld.x, 30.0, 0.035), gridLine(vWorld.y, 30.0, 0.035));
  float g2 = max(gridLine(vWorld.x, 120.0, 0.02), gridLine(vWorld.y, 120.0, 0.02));
  vec3 grid = vec3(0.12, 0.2, 0.25) * g1 + vec3(0.18, 0.3, 0.36) * g2;

  vec3 color = (base + grid) * mix(0.68, 1.0, vignette);
  outColor = vec4(color, 1.0);
}
`;

export default class GroundRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, VS, FS);
    this.uniforms = {
      uViewProj: gl.getUniformLocation(this.program, 'uViewProj'),
      uField: gl.getUniformLocation(this.program, 'uField')
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

    this.fieldWidth = 900;
    this.fieldHeight = 620;
  }

  setFieldSize(width, height) {
    this.fieldWidth = Math.max(100, Number(width) || 900);
    this.fieldHeight = Math.max(100, Number(height) || 620);
  }

  render(cameraState) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
    gl.uniform2f(this.uniforms.uField, this.fieldWidth, this.fieldHeight);
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
