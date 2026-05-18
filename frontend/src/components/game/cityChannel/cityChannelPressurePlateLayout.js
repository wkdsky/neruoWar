export const PRESSURE_PLATE_LAYOUT = {
  base: { width: 3.2, depth: 2.4, height: 0.28 },
  chamber: { width: 2.58, depth: 1.82, height: 0.16, y: -0.18 },
  cap: { width: 2.92, depth: 2.12, height: 0.16, y: 0.18 },
  center: { x: 0, y: -0.02, z: 0 },
  centerPlunger: { radius: 0.18, height: 0.72 },
  verticalPost: { radius: 0.14, height: 0.86, travel: 0.44 },
  horizontalPost: { width: 0.32, height: 0.24, length: 1.15, travel: 0.52 },
  gear: { radius: 0.44, thickness: 0.16, teeth: 12 },
  springOffsets: [
    { x: -0.68, z: -0.48 },
    { x: 0.68, z: -0.48 },
    { x: -0.68, z: 0.48 },
    { x: 0.68, z: 0.48 }
  ],
  outputPorts: {
    signal: { x: 0, y: -0.02, z: 1.28 },
    directional: { x: 1.48, y: -0.02, z: 0 }
  }
};

export const mapLayoutToScreen = ({ x = 0, z = 0 }) => ({
  x: x * 44,
  y: z * 25
});

export const layoutColor = {
  base: 0x111827,
  chamber: 0x020617,
  cap: 0x64748b,
  frame: 0x263241,
  spring: 0x93c5fd,
  plunger: 0x8b5cf6,
  rod: 0xcbd5e1,
  gear: 0xf59e0b,
  port: 0xfacc15
};
