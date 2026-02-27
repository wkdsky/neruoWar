import {
  createProgram,
  createStaticQuadVao,
  createDynamicInstanceBuffer,
  updateDynamicBuffer
} from './WebGL2Context';

export const UNIT_INSTANCE_STRIDE = 12;

const VS = `#version 300 es
layout(location=0) in vec2 aQuadPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 iData0; // x y z size
layout(location=3) in vec4 iData1; // yaw team hp body
layout(location=4) in vec4 iData2; // gear vehicle selected flag

uniform mat4 uViewProj;
uniform vec3 uCameraRight;
uniform float uLayer;

out vec2 vUv;
out float vTeam;
out float vHp;
out float vSlice;
out float vSelected;
out float vFlag;

void main() {
  vec3 base = vec3(iData0.x, iData0.y, iData0.z);
  float size = max(1.0, iData0.w);
  vec3 right = normalize(vec3(uCameraRight.x, uCameraRight.y, 0.0));
  vec3 up = vec3(0.0, 0.0, 1.0);

  vec3 world = base;
  world += right * (aQuadPos.x * size);
  world += up * (aQuadPos.y * size * 1.92);

  vUv = aUv;
  vTeam = iData1.y;
  vHp = iData1.z;
  vSelected = iData2.z;
  vFlag = iData2.w;
  if (uLayer < 0.5) {
    vSlice = iData1.w;
  } else if (uLayer < 1.5) {
    vSlice = iData2.x;
  } else {
    vSlice = iData2.y;
  }

  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
precision highp int;
precision mediump sampler2DArray;

in vec2 vUv;
in float vTeam;
in float vHp;
in float vSlice;
in float vSelected;
in float vFlag;

uniform sampler2DArray uAlbedo40;
uniform sampler2DArray uAlbedo90;
uniform sampler2DArray uNormal40;
uniform sampler2DArray uNormal90;
uniform vec3 uLightDir;
uniform float uPitchMix;
uniform float uLayer;

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

vec4 sampleAlbedo(sampler2DArray tex40, sampler2DArray tex90, vec3 uvw) {
  vec4 c40 = texture(tex40, uvw);
  vec4 c90 = texture(tex90, uvw);
  float t = bayer4x4(gl_FragCoord.xy);
  return (uPitchMix > t) ? c90 : c40;
}

vec3 sampleNormal(sampler2DArray tex40, sampler2DArray tex90, vec3 uvw) {
  vec3 n40 = texture(tex40, uvw).xyz * 2.0 - 1.0;
  vec3 n90 = texture(tex90, uvw).xyz * 2.0 - 1.0;
  float t = bayer4x4(gl_FragCoord.xy + vec2(1.0, 3.0));
  vec3 n = (uPitchMix > t) ? n90 : n40;
  return normalize(n);
}

void main() {
  vec3 uvw = vec3(vUv, max(0.0, vSlice));
  vec4 albedo = sampleAlbedo(uAlbedo40, uAlbedo90, uvw);
  if (albedo.a < 0.38) discard;

  vec3 normal = sampleNormal(uNormal40, uNormal90, uvw);
  vec3 lightDir = normalize(uLightDir);
  float lambert = max(0.0, dot(normal, lightDir));
  float ambient = 0.38;
  float lit = ambient + (lambert * 0.72);

  vec3 teamTint = (vTeam < 0.5) ? vec3(0.55, 0.76, 1.0) : vec3(1.0, 0.58, 0.58);
  vec3 color = albedo.rgb;
  color *= mix(vec3(0.86), teamTint, 0.28 + 0.1 * uLayer);
  color *= lit;
  color *= mix(0.5, 1.0, clamp(vHp, 0.0, 1.0));
  if (vSelected > 0.5) {
    color = mix(color, vec3(1.0, 0.95, 0.5), 0.22);
  }
  if (vFlag > 0.5) {
    color = mix(color, vec3(1.0, 1.0, 1.0), 0.12);
  }

  outColor = vec4(color, 1.0);
}
`;

const SHAPE_BODY = 0;
const SHAPE_GEAR = 1;
const SHAPE_VEHICLE = 2;

const fillTextureLayer = (size, layerIndex, totalLayers, angleMode, shapeMode, normalMode = false) => {
  const data = new Uint8Array(size * size * 4);
  const hue = (layerIndex % Math.max(1, totalLayers)) / Math.max(1, totalLayers);
  const baseR = 80 + Math.floor(120 * Math.abs(Math.sin((hue * Math.PI * 2) + 0.2)));
  const baseG = 70 + Math.floor(120 * Math.abs(Math.sin((hue * Math.PI * 2) + 2.4)));
  const baseB = 70 + Math.floor(120 * Math.abs(Math.sin((hue * Math.PI * 2) + 4.1)));

  const cx = (size - 1) * 0.5;
  const cy = (size - 1) * 0.5;
  const stretchY = angleMode === 'pitch90' ? 0.55 : 1;
  const stretchX = shapeMode === SHAPE_VEHICLE ? 1.35 : 1;
  const radiusBase = shapeMode === SHAPE_BODY ? 0.38 : (shapeMode === SHAPE_GEAR ? 0.28 : 0.42);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const nx = ((x - cx) / size) / stretchX;
      const ny = ((y - cy) / size) / stretchY;
      const rr = Math.hypot(nx, ny);
      const ellipse = rr <= radiusBase;
      const trimBottom = shapeMode === SHAPE_GEAR ? (y > (size * 0.8)) : false;
      const trimTop = shapeMode === SHAPE_VEHICLE ? (y < (size * 0.36)) : false;
      const alpha = ellipse && !trimBottom && !trimTop ? 255 : 0;
      if (alpha <= 0) {
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }
      if (normalMode) {
        const dz = Math.sqrt(Math.max(0, 1 - Math.min(1, rr / Math.max(0.001, radiusBase))));
        const nnx = clampToByte(((nx * 0.72) + 1) * 0.5 * 255);
        const nny = clampToByte(((-ny * 0.72) + 1) * 0.5 * 255);
        const nnz = clampToByte(((dz * 0.9) + 0.1) * 255);
        data[idx + 0] = nnx;
        data[idx + 1] = nny;
        data[idx + 2] = nnz;
        data[idx + 3] = 255;
      } else {
        const shade = 0.72 + (0.28 * (1 - rr / radiusBase));
        data[idx + 0] = clampToByte(baseR * shade);
        data[idx + 1] = clampToByte(baseG * shade);
        data[idx + 2] = clampToByte(baseB * shade);
        data[idx + 3] = alpha;
      }
    }
  }

  return data;
};

const clampToByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

const createTextureArray = (gl, slices, size, angleMode, shapeMode, normalMode = false) => {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    gl.RGBA8,
    size,
    size,
    slices,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  for (let i = 0; i < slices; i += 1) {
    const layer = fillTextureLayer(size, i, slices, angleMode, shapeMode, normalMode);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      i,
      size,
      size,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      layer
    );
  }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return tex;
};

const bindTextureUnit = (gl, unit, texture) => {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
};

export default class ImpostorRenderer {
  constructor(gl, options = {}) {
    this.gl = gl;
    this.maxSlices = Math.max(8, Number(options.maxSlices) || 32);
    this.textureSize = Math.max(16, Number(options.textureSize) || 64);
    this.instanceBuffer = createDynamicInstanceBuffer(gl, 4096 * UNIT_INSTANCE_STRIDE);
    this.instanceCapacity = 4096;

    this.program = createProgram(gl, VS, FS);
    this.attrs = {
      position: 0,
      uv: 1,
      iData0: 2,
      iData1: 3,
      iData2: 4
    };
    const quad = createStaticQuadVao(gl, this.attrs);
    this.vao = quad.vao;
    this.quadBuffer = quad.quadBuffer;

    this.uniforms = {
      uViewProj: gl.getUniformLocation(this.program, 'uViewProj'),
      uCameraRight: gl.getUniformLocation(this.program, 'uCameraRight'),
      uLayer: gl.getUniformLocation(this.program, 'uLayer'),
      uLightDir: gl.getUniformLocation(this.program, 'uLightDir'),
      uPitchMix: gl.getUniformLocation(this.program, 'uPitchMix'),
      uAlbedo40: gl.getUniformLocation(this.program, 'uAlbedo40'),
      uAlbedo90: gl.getUniformLocation(this.program, 'uAlbedo90'),
      uNormal40: gl.getUniformLocation(this.program, 'uNormal40'),
      uNormal90: gl.getUniformLocation(this.program, 'uNormal90')
    };

    this.layerTextures = [
      this.createLayerTextureSet(SHAPE_BODY),
      this.createLayerTextureSet(SHAPE_GEAR),
      this.createLayerTextureSet(SHAPE_VEHICLE)
    ];

    this.instanceData = new Float32Array(UNIT_INSTANCE_STRIDE * this.instanceCapacity);
    this.instanceCount = 0;
    this.bindInstanceLayout();
  }

  createLayerTextureSet(shapeMode) {
    const gl = this.gl;
    return {
      albedo40: createTextureArray(gl, this.maxSlices, this.textureSize, 'pitch40', shapeMode, false),
      albedo90: createTextureArray(gl, this.maxSlices, this.textureSize, 'pitch90', shapeMode, false),
      normal40: createTextureArray(gl, this.maxSlices, this.textureSize, 'pitch40', shapeMode, true),
      normal90: createTextureArray(gl, this.maxSlices, this.textureSize, 'pitch90', shapeMode, true)
    };
  }

  ensureCapacity(count) {
    if (count <= this.instanceCapacity) return;
    const gl = this.gl;
    this.instanceCapacity = Math.max(count, Math.floor(this.instanceCapacity * 1.5));
    this.instanceData = new Float32Array(this.instanceCapacity * UNIT_INSTANCE_STRIDE);
    gl.deleteBuffer(this.instanceBuffer);
    this.instanceBuffer = createDynamicInstanceBuffer(gl, this.instanceCapacity * UNIT_INSTANCE_STRIDE);
    this.bindInstanceLayout();
  }

  bindInstanceLayout() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const strideBytes = UNIT_INSTANCE_STRIDE * 4;

    gl.enableVertexAttribArray(this.attrs.iData0);
    gl.vertexAttribPointer(this.attrs.iData0, 4, gl.FLOAT, false, strideBytes, 0);
    gl.vertexAttribDivisor(this.attrs.iData0, 1);

    gl.enableVertexAttribArray(this.attrs.iData1);
    gl.vertexAttribPointer(this.attrs.iData1, 4, gl.FLOAT, false, strideBytes, 16);
    gl.vertexAttribDivisor(this.attrs.iData1, 1);

    gl.enableVertexAttribArray(this.attrs.iData2);
    gl.vertexAttribPointer(this.attrs.iData2, 4, gl.FLOAT, false, strideBytes, 32);
    gl.vertexAttribDivisor(this.attrs.iData2, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  updateFromSnapshot(snapshotUnits) {
    const count = Math.max(0, Number(snapshotUnits?.count) || 0);
    this.ensureCapacity(count);
    if (count <= 0) {
      this.instanceCount = 0;
      return;
    }
    const source = snapshotUnits?.data;
    if (!(source instanceof Float32Array)) {
      this.instanceCount = 0;
      return;
    }
    const needed = count * UNIT_INSTANCE_STRIDE;
    this.instanceData.set(source.subarray(0, needed), 0);
    this.instanceCount = count;
    updateDynamicBuffer(this.gl, this.instanceBuffer, this.instanceData, needed);
  }

  render(cameraState, pitchMix = 0) {
    if (this.instanceCount <= 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, new Float32Array(cameraState.viewProjection));
    gl.uniform3fv(this.uniforms.uCameraRight, new Float32Array(cameraState.cameraRight));
    gl.uniform3f(this.uniforms.uLightDir, -0.24, -0.35, 0.91);
    gl.uniform1f(this.uniforms.uPitchMix, Math.max(0, Math.min(1, Number(pitchMix) || 0)));

    for (let layer = 0; layer < 3; layer += 1) {
      const texSet = this.layerTextures[layer];
      bindTextureUnit(gl, 0, texSet.albedo40);
      bindTextureUnit(gl, 1, texSet.albedo90);
      bindTextureUnit(gl, 2, texSet.normal40);
      bindTextureUnit(gl, 3, texSet.normal90);
      gl.uniform1i(this.uniforms.uAlbedo40, 0);
      gl.uniform1i(this.uniforms.uAlbedo90, 1);
      gl.uniform1i(this.uniforms.uNormal40, 2);
      gl.uniform1i(this.uniforms.uNormal90, 3);
      gl.uniform1f(this.uniforms.uLayer, layer);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
    }

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
    (this.layerTextures || []).forEach((set) => {
      if (!set) return;
      ['albedo40', 'albedo90', 'normal40', 'normal90'].forEach((key) => {
        if (set[key]) gl.deleteTexture(set[key]);
      });
    });
  }
}
