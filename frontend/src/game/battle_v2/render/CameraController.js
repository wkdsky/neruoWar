const DEG2RAD = Math.PI / 180;
const CAMERA_IMPL_TAG = 'CAMERA_WORLD_MAP_ALIGN_V4';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - (2 * x));
};

const normalize3 = (v) => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

const subtract3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [
  (a[1] * b[2]) - (a[2] * b[1]),
  (a[2] * b[0]) - (a[0] * b[2]),
  (a[0] * b[1]) - (a[1] * b[0])
];
const dot3 = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);

const mat4Identity = () => ([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]);

const mat4Multiply = (a, b) => {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[(col * 4) + row] = (
        (a[(0 * 4) + row] * b[(col * 4) + 0])
        + (a[(1 * 4) + row] * b[(col * 4) + 1])
        + (a[(2 * 4) + row] * b[(col * 4) + 2])
        + (a[(3 * 4) + row] * b[(col * 4) + 3])
      );
    }
  }
  return out;
};

const mat4Perspective = (fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ];
};

const mat4RotationZ = (rad) => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
};

const mat4Translation = (tx, ty, tz) => ([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  Number(tx) || 0, Number(ty) || 0, Number(tz) || 0, 1
]);

const buildLookAtRhBasis = (eye, target, upWorld = [0, 0, 1]) => {
  const look = subtract3(target, eye);
  let f = normalize3(look);
  let s = cross3(f, upWorld);
  if (Math.hypot(s[0], s[1], s[2]) <= 1e-6) {
    const fallbackUp = Math.abs(f[2]) < 0.99 ? [0, 0, 1] : [0, 1, 0];
    s = cross3(f, fallbackUp);
  }
  s = normalize3(s);
  const u = normalize3(cross3(s, f));
  return { f, s, u };
};

const buildLookAtRhMatrix = (eye, basis) => {
  const { f, s, u } = basis;
  return [
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1
  ];
};

const mat4Invert = (m) => {
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] -
           m[5] * m[11] * m[14] -
           m[9] * m[6] * m[15] +
           m[9] * m[7] * m[14] +
           m[13] * m[6] * m[11] -
           m[13] * m[7] * m[10];

  inv[4] = -m[4] * m[10] * m[15] +
            m[4] * m[11] * m[14] +
            m[8] * m[6] * m[15] -
            m[8] * m[7] * m[14] -
            m[12] * m[6] * m[11] +
            m[12] * m[7] * m[10];

  inv[8] = m[4] * m[9] * m[15] -
           m[4] * m[11] * m[13] -
           m[8] * m[5] * m[15] +
           m[8] * m[7] * m[13] +
           m[12] * m[5] * m[11] -
           m[12] * m[7] * m[9];

  inv[12] = -m[4] * m[9] * m[14] +
             m[4] * m[10] * m[13] +
             m[8] * m[5] * m[14] -
             m[8] * m[6] * m[13] -
             m[12] * m[5] * m[10] +
             m[12] * m[6] * m[9];

  inv[1] = -m[1] * m[10] * m[15] +
            m[1] * m[11] * m[14] +
            m[9] * m[2] * m[15] -
            m[9] * m[3] * m[14] -
            m[13] * m[2] * m[11] +
            m[13] * m[3] * m[10];

  inv[5] = m[0] * m[10] * m[15] -
           m[0] * m[11] * m[14] -
           m[8] * m[2] * m[15] +
           m[8] * m[3] * m[14] +
           m[12] * m[2] * m[11] -
           m[12] * m[3] * m[10];

  inv[9] = -m[0] * m[9] * m[15] +
            m[0] * m[11] * m[13] +
            m[8] * m[1] * m[15] -
            m[8] * m[3] * m[13] -
            m[12] * m[1] * m[11] +
            m[12] * m[3] * m[9];

  inv[13] = m[0] * m[9] * m[14] -
            m[0] * m[10] * m[13] -
            m[8] * m[1] * m[14] +
            m[8] * m[2] * m[13] +
            m[12] * m[1] * m[10] -
            m[12] * m[2] * m[9];

  inv[2] = m[1] * m[6] * m[15] -
           m[1] * m[7] * m[14] -
           m[5] * m[2] * m[15] +
           m[5] * m[3] * m[14] +
           m[13] * m[2] * m[7] -
           m[13] * m[3] * m[6];

  inv[6] = -m[0] * m[6] * m[15] +
            m[0] * m[7] * m[14] +
            m[4] * m[2] * m[15] -
            m[4] * m[3] * m[14] -
            m[12] * m[2] * m[7] +
            m[12] * m[3] * m[6];

  inv[10] = m[0] * m[5] * m[15] -
            m[0] * m[7] * m[13] -
            m[4] * m[1] * m[15] +
            m[4] * m[3] * m[13] +
            m[12] * m[1] * m[7] -
            m[12] * m[3] * m[5];

  inv[14] = -m[0] * m[5] * m[14] +
             m[0] * m[6] * m[13] +
             m[4] * m[1] * m[14] -
             m[4] * m[2] * m[13] -
             m[12] * m[1] * m[6] +
             m[12] * m[2] * m[5];

  inv[3] = -m[1] * m[6] * m[11] +
            m[1] * m[7] * m[10] +
            m[5] * m[2] * m[11] -
            m[5] * m[3] * m[10] -
            m[9] * m[2] * m[7] +
            m[9] * m[3] * m[6];

  inv[7] = m[0] * m[6] * m[11] -
           m[0] * m[7] * m[10] -
           m[4] * m[2] * m[11] +
           m[4] * m[3] * m[10] +
           m[8] * m[2] * m[7] -
           m[8] * m[3] * m[6];

  inv[11] = -m[0] * m[5] * m[11] +
             m[0] * m[7] * m[9] +
             m[4] * m[1] * m[11] -
             m[4] * m[3] * m[9] -
             m[8] * m[1] * m[7] +
             m[8] * m[3] * m[5];

  inv[15] = m[0] * m[5] * m[10] -
            m[0] * m[6] * m[9] -
            m[4] * m[1] * m[10] +
            m[4] * m[2] * m[9] +
            m[8] * m[1] * m[6] -
            m[8] * m[2] * m[5];

  let det = (m[0] * inv[0]) + (m[1] * inv[4]) + (m[2] * inv[8]) + (m[3] * inv[12]);
  if (Math.abs(det) < 1e-9) return mat4Identity();
  det = 1.0 / det;
  for (let i = 0; i < 16; i += 1) {
    inv[i] *= det;
  }
  return inv;
};

const transformVec4 = (m, v) => ([
  (m[0] * v[0]) + (m[4] * v[1]) + (m[8] * v[2]) + (m[12] * v[3]),
  (m[1] * v[0]) + (m[5] * v[1]) + (m[9] * v[2]) + (m[13] * v[3]),
  (m[2] * v[0]) + (m[6] * v[1]) + (m[10] * v[2]) + (m[14] * v[3]),
  (m[3] * v[0]) + (m[7] * v[1]) + (m[11] * v[2]) + (m[15] * v[3])
]);

const toNdc = (value, w) => {
  const safeW = Math.abs(w) <= 1e-9 ? 1 : w;
  return value / safeW;
};

export default class CameraController {
  constructor({ yawDeg = 45, pitchLow = 40, pitchHigh = 90, distance = 560, mirrorX = false } = {}) {
    this.yawDeg = Number.isFinite(Number(yawDeg)) ? Number(yawDeg) : 45;
    this.pitchLow = Number.isFinite(Number(pitchLow)) ? Number(pitchLow) : 40;
    this.pitchHigh = Number.isFinite(Number(pitchHigh)) ? Number(pitchHigh) : 90;
    this.mirrorX = !!mirrorX;
    this.currentPitch = this.pitchLow;
    this.pitchFrom = this.pitchLow;
    this.pitchTo = this.pitchLow;
    this.pitchTweenSec = 0;
    this.pitchTweenDurationSec = 0.32;

    this.distance = Math.max(120, Number(distance) || 560);
    this.centerX = 0;
    this.centerY = 0;
    this.lookAheadScale = 0.28;
    this.lookAheadMax = 78;
    this.lookAheadSpeedEps = 1.8;
    this.worldYawDeg = 0;

    this.eye = [0, 0, 0];
    this.target = [0, 0, 0];
    this.up = [0, 0, 1];

    this.view = mat4Identity();
    this.projection = mat4Identity();
    this.viewProjection = mat4Identity();
    this.inverseViewProjection = mat4Identity();
  }

  togglePitchMode() {
    const nearLow = Math.abs(this.currentPitch - this.pitchLow) <= Math.abs(this.currentPitch - this.pitchHigh);
    this.setPitchMode(nearLow ? 'high' : 'low');
  }

  setPitchMode(mode = 'low') {
    const next = mode === 'high' ? this.pitchHigh : this.pitchLow;
    if (Math.abs(next - this.pitchTo) <= 0.001 && this.pitchTweenSec > 0) return;
    this.pitchFrom = this.currentPitch;
    this.pitchTo = next;
    this.pitchTweenSec = 0;
  }

  getPitchBlend() {
    const denom = Math.max(1e-4, this.pitchHigh - this.pitchLow);
    return clamp((this.currentPitch - this.pitchLow) / denom, 0, 1);
  }

  update(dtSec, anchor = null) {
    const dt = Math.max(0, Number(dtSec) || 0);
    if (this.pitchTweenSec < this.pitchTweenDurationSec) {
      this.pitchTweenSec = Math.min(this.pitchTweenDurationSec, this.pitchTweenSec + dt);
      const t = this.pitchTweenDurationSec <= 1e-4 ? 1 : (this.pitchTweenSec / this.pitchTweenDurationSec);
      this.currentPitch = this.pitchFrom + ((this.pitchTo - this.pitchFrom) * smoothstep(t));
    } else {
      this.currentPitch = this.pitchTo;
    }

    if (anchor && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
      const vx = Number(anchor.vx) || 0;
      const vy = Number(anchor.vy) || 0;
      const speed = Math.hypot(vx, vy);
      const validLookAhead = speed >= this.lookAheadSpeedEps;
      const lookAhead = validLookAhead
        ? Math.min(this.lookAheadMax, speed * this.lookAheadScale)
        : 0;
      const dirX = validLookAhead ? (vx / speed) : 0;
      const dirY = validLookAhead ? (vy / speed) : 0;
      const targetX = (Number(anchor.x) || 0) + (dirX * lookAhead);
      const targetY = (Number(anchor.y) || 0) + (dirY * lookAhead);
      const followLerp = clamp(dt * 6.8, 0, 1);
      this.centerX += (targetX - this.centerX) * followLerp;
      this.centerY += (targetY - this.centerY) * followLerp;
    }
  }

  buildMatrices(width, height) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);

    const yawEffectiveDeg = this.mirrorX ? (180 - this.yawDeg) : this.yawDeg;
    const yawRad = yawEffectiveDeg * DEG2RAD;
    const worldYawRad = (Number(this.worldYawDeg) || 0) * DEG2RAD;
    const pitchRad = clamp(this.currentPitch, 10, 170) * DEG2RAD;
    // Keep left/right world orientation stable even when pitch crosses 90 deg.
    // Without this, cos(pitch) becomes negative and effectively flips yaw by 180 deg.
    const horizontal = Math.abs(Math.cos(pitchRad) * this.distance);
    const vertical = Math.sin(pitchRad) * this.distance;

    this.target = [this.centerX, this.centerY, 0];
    this.eye = [
      this.centerX + (Math.sin(yawRad) * horizontal),
      this.centerY - (Math.cos(yawRad) * horizontal),
      vertical
    ];

    this.projection = mat4Perspective(48 * DEG2RAD, safeWidth / safeHeight, 1, 5000);
    const pivotWorldRotation = mat4Multiply(
      mat4Multiply(
        mat4Translation(this.centerX, this.centerY, 0),
        mat4RotationZ(worldYawRad)
      ),
      mat4Translation(-this.centerX, -this.centerY, 0)
    );
    const applyView = (view) => {
      this.view = view;
      const viewProj = mat4Multiply(this.projection, this.view);
      this.viewProjection = mat4Multiply(viewProj, pivotWorldRotation);
      this.inverseViewProjection = mat4Invert(this.viewProjection);
    };

    let basis = buildLookAtRhBasis(this.eye, this.target, this.up);
    applyView(buildLookAtRhMatrix(this.eye, basis));

    const lookDir = normalize3(subtract3(this.target, this.eye));
    let forwardFromView = normalize3([-this.view[8], -this.view[9], -this.view[10]]);
    let handedness = dot3(cross3(basis.s, basis.u), [-forwardFromView[0], -forwardFromView[1], -forwardFromView[2]]);

    let flipFixApplied = false;
    const eyeZ = Number(this.eye[2]) || 0;
    const needFix = (
      eyeZ <= 1e-3
      || !Number.isFinite(forwardFromView[2])
      || forwardFromView[2] >= -1e-6
      || dot3(forwardFromView, lookDir) < 0
      || handedness < 0
    );
    if (needFix) {
      this.eye[2] = Math.abs(eyeZ) + 1;
      basis = buildLookAtRhBasis(this.eye, this.target, this.up);
      applyView(buildLookAtRhMatrix(this.eye, basis));
      forwardFromView = normalize3([-this.view[8], -this.view[9], -this.view[10]]);
      handedness = dot3(cross3(basis.s, basis.u), [-forwardFromView[0], -forwardFromView[1], -forwardFromView[2]]);
      flipFixApplied = true;
    }

    const rightBase = [Math.cos(yawRad), Math.sin(yawRad), 0];
    const cosWorld = Math.cos(worldYawRad);
    const sinWorld = Math.sin(worldYawRad);
    const right = [
      (rightBase[0] * cosWorld) + (rightBase[1] * sinWorld),
      (-rightBase[0] * sinWorld) + (rightBase[1] * cosWorld),
      0
    ];
    const forward = forwardFromView;
    return {
      view: this.view,
      projection: this.projection,
      viewProjection: this.viewProjection,
      inverseViewProjection: this.inverseViewProjection,
      cameraRight: right,
      right: basis.s,
      up: basis.u,
      forward,
      handedness,
      cameraImplTag: CAMERA_IMPL_TAG,
      worldYawDeg: Number(this.worldYawDeg) || 0,
      forwardZ: Number(forward[2]) || 0,
      flipFixApplied,
      eye: this.eye,
      target: this.target
    };
  }

  worldToScreen(world, viewport) {
    const x = Number(world?.x) || 0;
    const y = Number(world?.y) || 0;
    const z = Number(world?.z) || 0;
    const v = transformVec4(this.viewProjection, [x, y, z, 1]);
    const ndcX = toNdc(v[0], v[3]);
    const ndcY = toNdc(v[1], v[3]);
    const width = Math.max(1, Number(viewport?.width) || 1);
    const height = Math.max(1, Number(viewport?.height) || 1);
    return {
      x: ((ndcX + 1) * 0.5) * width,
      y: ((1 - ndcY) * 0.5) * height,
      visible: v[3] > 0
    };
  }

  screenToGround(screenX, screenY, viewport) {
    const width = Math.max(1, Number(viewport?.width) || 1);
    const height = Math.max(1, Number(viewport?.height) || 1);
    const ndcX = ((Number(screenX) || 0) / width) * 2 - 1;
    const ndcY = 1 - (((Number(screenY) || 0) / height) * 2);

    const near = transformVec4(this.inverseViewProjection, [ndcX, ndcY, -1, 1]);
    const far = transformVec4(this.inverseViewProjection, [ndcX, ndcY, 1, 1]);
    const nearW = Math.abs(near[3]) <= 1e-6 ? 1 : near[3];
    const farW = Math.abs(far[3]) <= 1e-6 ? 1 : far[3];
    const nearP = [near[0] / nearW, near[1] / nearW, near[2] / nearW];
    const farP = [far[0] / farW, far[1] / farW, far[2] / farW];

    const dir = subtract3(farP, nearP);
    const denom = dir[2];
    if (Math.abs(denom) <= 1e-6) {
      return { x: nearP[0], y: nearP[1], valid: false };
    }
    const t = -nearP[2] / denom;
    return {
      x: nearP[0] + (dir[0] * t),
      y: nearP[1] + (dir[1] * t),
      valid: Number.isFinite(t)
    };
  }
}
