# PVE Deploy Camera Rotate Audit

## 1) Deploy 阶段右键拖拽旋转事件链路

### 1.1 入口：`mousedown`（右键开始旋转）
- 结论：只在 `deploy` 阶段，`event.button === 2` 时进入旋转态。  
  引用：`frontend/src/components/game/PveBattleModal.js:593-626`（`handleSceneMouseDown`）
- 关键变量：
  - `rotateDragRef.current = { startX, startYaw, moved }`
  - `startYaw` 来自 `cameraRef.current.yawDeg`
- 短摘录：
```js
if (currentPhase === 'deploy' && event.button === 2) {
  rotateDragRef.current = { startX: event.clientX, startYaw: cameraRef.current.yawDeg, moved: false };
  setIsRotating(true);
  event.preventDefault();
  return;
}
```

### 1.2 主循环：`window mousemove`（更新 yaw）
- 结论：旋转在全局 `mousemove` 里执行；仅使用 `dx` 计算 yaw，不使用 `dy`。  
  引用：`frontend/src/components/game/PveBattleModal.js:706-770`（`useEffect` 内 `handleWindowMouseMove`）
- 关键变量：
  - `rotateDragRef.current`
  - `dx = event.clientX - rotate.startX`
  - `visualDx = cameraRef.current.mirrorX ? -dx : dx`
  - `cameraRef.current.yawDeg = nextYaw`
- 短摘录：
```js
const dx = event.clientX - rotate.startX;
const visualDx = cameraRef.current.mirrorX ? -dx : dx;
const nextYaw = ((rotate.startYaw || 0) + (visualDx * CAMERA_ROTATE_SENSITIVITY)) % 360;
cameraRef.current.yawDeg = nextYaw < 0 ? nextYaw + 360 : nextYaw;
```

### 1.3 结束：`mouseup / blur`（退出旋转态）
- 结论：`mouseup` 与 `blur` 都会清理旋转态，避免“卡住旋转”。  
  引用：`frontend/src/components/game/PveBattleModal.js:752-769`（`handleWindowMouseUp` / `handleWindowBlur`）
- 关键变量：
  - `clearRotateDrag()` -> `rotateDragRef.current = null`
  - `setIsRotating(false)`（定义见 `frontend/src/components/game/PveBattleModal.js:572-575`）

### 1.4 事件绑定与作用域
- 结论：旋转链路是 `onMouseDown` + window 级 `mousemove/mouseup`；右键菜单被阻止。  
  引用：
  - `frontend/src/components/game/PveBattleModal.js:762-768`（window listener add/remove）
  - `frontend/src/components/game/PveBattleModal.js:1197-1200`（`onMouseDown`、`onContextMenu`）
- 结论：deploy 专属控制由 `runtime.getPhase() === 'deploy'` 门控，battle 不走该逻辑。  
  引用：`frontend/src/components/game/PveBattleModal.js:604-624`、`frontend/src/components/game/PveBattleModal.js:714-718`

---

## 2) `CameraController.buildMatrices` 计算方式与 `mirrorX` 实现

### 2.1 yaw / pitch / eye / target / up / viewProjection
- 结论：相机使用 orbit/turntable 形式：先由 `yawRad + pitchRad + distance` 求 `eye`，再 `lookAt(target, up=[0,0,1])`。  
  引用：`frontend/src/game/battle_v2/render/CameraController.js:274-297`（`buildMatrices`）
- 短摘录：
```js
const yawEffectiveDeg = this.mirrorX ? (180 - this.yawDeg) : this.yawDeg;
const yawRad = yawEffectiveDeg * DEG2RAD;
const pitchRad = clamp(this.currentPitch, 10, 89.95) * DEG2RAD;

this.target = [this.centerX, this.centerY, 0];
this.eye = [
  this.centerX + Math.cos(yawRad) * horizontal,
  this.centerY + Math.sin(yawRad) * horizontal,
  vertical
];

this.view = mat4LookAt(this.eye, this.target, this.up);
this.viewProjection = mat4Multiply(this.projection, this.view);
```

### 2.2 `mirrorX` 当前实现是否是矩阵反射？
- 结论：**当前不是矩阵反射**；`mirrorX` 通过 `yawEffectiveDeg = 180 - yawDeg` 进入 yaw 计算。  
  引用：`frontend/src/game/battle_v2/render/CameraController.js:278-279`（`buildMatrices`）
- 结论：`viewProjection` 当前为纯 `projection * view`，未左乘镜像矩阵。  
  引用：`frontend/src/game/battle_v2/render/CameraController.js:293`

---

## 3) 为什么“clip-space mirror + yaw orbit”会产生“绕倾斜轴旋转”观感

1. 若在 `projection * view` 之后再做 clip-space 反射，等价于把最终相机空间做镜像，变换不再是单纯的“绕世界 Up 旋转”。
2. yaw 的轨道运动和屏幕空间反射叠加后，视觉上的左右/前后关系会被二次映射，用户会感觉“旋转轴不干净”。
3. 当渲染还依赖 `cameraRight`（如 billboard）或屏幕反投影（`screenToGround`）时，若这些量与镜像后的最终坐标系不完全一致，更容易出现“像绕斜轴拧动”的体感。
4. 这种问题常见于“逻辑相机是右手轨道，显示相机又叠加一次反射”的混合实现。

（概念对照点：`frontend/src/game/battle_v2/render/CameraController.js:274-304`）

---

## 4) 最小修复建议（仅描述，不改代码）

1. 保持 `viewProjection = projection * view`，不要在 clip-space 再做镜像反射；`mirrorX` 只通过 yaw 映射（如 `180 - yawDeg`）处理。  
   关联位置：`frontend/src/game/battle_v2/render/CameraController.js`（`buildMatrices`）
2. deploy 右键旋转只改 `yawDeg`，只读 `dx`，不把 `dy` 映射到 `pitch/roll`。  
   关联位置：`frontend/src/components/game/PveBattleModal.js`（`handleSceneMouseDown`、`handleWindowMouseMove`）
3. 方向修正只在一个点做（`visualDx` 或 yaw 映射二选一为主），避免重复取反造成方向混乱。  
   关联位置：`frontend/src/components/game/PveBattleModal.js:727`、`frontend/src/game/battle_v2/render/CameraController.js:278`
4. 对 deploy 阶段增加一个轻量断言/调试开关：旋转过程中记录 `pitch` 是否变化（应恒定）。
