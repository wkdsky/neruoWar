# Battle Math Protocol

- 世界坐标：战场统一使用 `X` 向右为正、`Y` 向上为正、`Z` 向上为正。
- `yawDeg`：以世界 `+X` 轴为 `0°`，逆时针（CCW）为正方向，单位始终是度。
- `yawRad`：仅在需要传入 shader / 三角函数 / 仿真转向时使用，变量名必须显式带 `Rad`。
- `deg <-> rad` 转换统一走 `frontend/src/game/battle/shared/angle.js`，禁止在各文件重复定义 `normalizeDeg/degToRad/radToDeg`。
- Minimap 使用同一世界坐标协议，但 canvas 的 `Y` 轴天然向下；因此绘制旋转矩形时允许在画布层做 `-degToRad(yawDeg)` 修正。
- 屏幕坐标和 DOM 坐标不是世界协议的一部分；所有 `screenToGround/worldToScreen` 只负责协议之间的投影映射，不允许在调用方额外私加 `+90°/-90°` 补丁。
