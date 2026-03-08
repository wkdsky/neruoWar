# CHANGELOG_PVE_BATTLE_UPGRADE

## 变更范围
本次仅改造“攻占知识域 PVE 战斗链路”：
- `App -> BattleSceneModal`
- `BattleRuntime / CrowdSim / engagement / ImpostorRenderer`
- 后端 unitTypes 下发序列化（DTO v1）

未改动布防编辑链路的接口行为（`/battlefield-layout`、`/siege/battlefield-preview`）与 `BattlefieldPreviewModal` 业务逻辑。

## Phase 0-1：注释、调试开关、UnitTypeDTO v1 标准化

### 新增文件
- `backend/services/unitTypeDtoService.js`

### 修改文件
- `backend/services/unitRegistryService.js`
- `backend/routes/army.js`
- `backend/routes/nodes.js`
- `frontend/src/game/unit/normalizeUnitTypes.js`
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
- `frontend/src/game/battle/presentation/render/ImpostorRenderer.js`
- `frontend/src/game/battle/screens/BattleSceneContainer.js`
- `frontend/src/game/battle/presentation/ui/Battle.css`

### 主要变更
1. 后端引入 `UnitTypeDTO v1`
- 统一口径：`schemaVersion=1`、`unitTypeId` 为权威 ID。
- 兼容字段：`id`（deprecated，恒等于 `unitTypeId`）、`level`（deprecated，恒等于 `tier`）。
- 收敛字段：`classTag` 在后端生成（`infantry/cavalry/archer/artillery`）。
- 修正 `classTag` 推断短路问题（缺失时按名称/role/range 推断，而不是过早回退为 `infantry`）。
- 组件结构包含：ID 引用 + 展开组件对象（`body/weapon/vehicle/ability/...`）。

2. unitTypes 下发接口挂 DTO 版本号
- `GET /api/army/unit-types`
- `GET /api/army/training/init`
- `GET /api/nodes/:nodeId/siege/pve/battle-init`
- 新增顶层字段：`unitTypeDtoVersion: 1`

3. 前端 normalize 收敛为 DTO 优先消费
- 优先使用 `unitTypeId`，`id` 仅兼容输入。
- `tier` 成为等级主字段，`level=tier` 仅兼容输出。
- `classTag` 优先使用后端 DTO，缺失才本地推断。
- 新增 `visuals.battle.spriteFrontLayer/spriteTopLayer` 透传。

4. 增加轻量 runtime 调试开关
- 通过 `window.__BATTLE_DEBUG__` 启用（默认关闭）。
- 场景右下角显示：`phase`、`pitchMix`、选中部队 `formationRect(width/depth/area)`。
- 可选：`window.__BATTLE_DEBUG__ = { enabled: true, steeringWeights: {...} }`。

## Phase 2：表现层升级（球体特征 + 顶视可读性）

### 修改文件
- `frontend/src/components/game/unit/ArmyUnitPreviewCanvases.js`
- `frontend/src/game/battle/presentation/assets/ProceduralTextures.js`
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
- `frontend/src/game/battle/presentation/render/ImpostorRenderer.js`

### 主要变更
1. 近景预览改为“球体 + 少量特征”
- 身体：`SphereGeometry`
- 特征：头盔半球、武器短棍、条纹环
- 资源缓存：geometry/material 缓存复用，避免重复创建

2. 程序化贴图支持 Front/Top 双层
- 新增导出：
  - `IMPOSTOR_LAYER_COUNT_FRONT`
  - `IMPOSTOR_LAYER_OFFSET_TOP`
  - `IMPOSTOR_LAYER_COUNT_TOTAL`
  - `resolveTopLayer(frontLayer)`
- 纹理数组从 `N` 扩展到 `2N`（前视层 + 顶视层）

3. ImpostorRenderer 支持姿态与贴图双重 top blend
- `UNIT_INSTANCE_STRIDE` 从 `16 -> 20`
- 新增实例属性 `iData4`（4 个 top layer）
- 新增 uniform `uTopBlend`（由 `pitchMix` smoothstep 计算）
- Vertex：竖直 billboard 与水平贴地 quad 混合
- Fragment：front/top layer 采样混合（无 top 时自动回退 front）

4. BattleRuntime 写入 top-layer 实例字段
- 在单位实例中写入 `bodyTop/gearTop/vehicleTop/silhouetteTop`
- 支持 `visuals.battle.spriteTopLayer` 显式覆盖
- 修正实例布局偏移：
  - `iData3 = [selected, flag, ghost, reserved]`
  - `iData4 = [bodyTop, gearTop, vehicleTop, silhouetteTop]`
  - 避免 top-layer 与 ghost 位错读导致的渲染异常

## Phase 3：移动/战斗稳定化

### 修改文件
- `frontend/src/game/battle/simulation/crowd/engagement.js`
- `frontend/src/game/battle/simulation/crowd/CrowdSim.js`

### 主要变更
1. detour waypoint 加滞回与冷却
- 新增参数：`detourTriggerSec`、`detourHoldSec`、`detourCooldownSec`、`detourReachRadius`
- 仅连续阻塞到阈值才触发 detour
- hold 窗口内不重复覆盖 waypoint（除非已到达/失效）

2. leader 转向稳定
- 新增方向低通：`smoothedDir`
- 保留并增强最大角速度约束（可配 `maxTurnRate`）

3. steering 权重可调
- 新增权重：`slot/separation/avoidance/anchor/pressure/leaderAvoidance/turnHz/maxTurnRate`
- 来源支持 `window.__BATTLE_DEBUG__.steeringWeights`

4. pushOut 硬推后做法向速度阻尼
- 发生推离时，对速度法向分量做衰减（保留约 20%）
- 缓解贴墙反复碰撞抖动

## Phase 4：部署展开与矩形 reshape（面积固定）

### 修改文件
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
- `frontend/src/game/battle/simulation/crowd/CrowdSim.js`
- `frontend/src/game/battle/screens/BattleSceneContainer.js`
- `frontend/src/game/battle/presentation/ui/Battle.css`

### 主要变更
1. deployGroup 新增权威阵型状态
- `formationRect: { area, width, depth, spacing, facingRad, slotCount }`
- `deploySlots: [{side, front, row, col}]`
- 新增 API：
  - `setDeployGroupRect(groupId, { width/... })`（面积锁定）
  - `getDeployGroupSlots(groupId)`

2. 部署阶段渲染“展开单位”
- `BattleRuntime.getRenderSnapshot()` 在 deploy 阶段按 `deploySlots` 输出 ghost 单位实例
- 不再只渲染 group 点

3. BattleSceneModal 阵型 footprint + 手柄交互
- 选中且已放置部队时，绘制矩形 footprint
- 左右手柄拖拽调宽，depth 自动按 `area / width` 更新
- 交互实时调用 `runtime.setDeployGroupRect(...)`

4. 开战第一帧与部署可视阵型对齐
- `CrowdSim.createAgentsForSquad()` 优先读取 `squad.deploySlots` 生成初始 agent 位置

## 新增/扩展字段清单

### 后端 DTO
- `schemaVersion`
- `classTag`
- `visuals.battle.spriteFrontLayer`
- `visuals.battle.spriteTopLayer`
- `components` 内 ID + 展开对象
- 顶层响应：`unitTypeDtoVersion`

### 前端 runtime
- `deployGroup.formationRect`
- `deployGroup.deploySlots`
- 单位实例 buffer 扩展：`UNIT_INSTANCE_STRIDE = 20`
  - 额外字段：4 个 top layers + ghost 标记

## 手动验证步骤（回归清单）

1. 攻占入口与 API
- 从 `App` 点击攻占进入 PVE。
- 检查 `battle-init` 返回：
  - `unitTypeDtoVersion === 1`
  - `unitTypes[*].schemaVersion === 1`
  - `id === unitTypeId`
  - `level === tier`

2. 顶视可读性
- 战斗内按 `V` 切换高俯仰。
- 观察小人：应由竖直 impostor 平滑过渡到顶视圆盘，不再“一条线”。

3. 部署展开与 reshape
- 部署阶段创建并放置部队后，确认已显示展开队形（多个 ghost 单位）。
- 拖拽阵型左右手柄：宽度变化，深度自动反向变化，面积保持基本恒定。

4. 开战一致性
- 部署后直接开战。
- 观察开战第一帧队形与部署时 footprint/slots 基本一致。

5. 行为稳定性
- 让部队经过窄道/贴墙移动。
- 观察抖动明显减少，leader 不再高频左右抖头。

6. 布防编辑器不受影响
- 打开 `BattlefieldPreviewModal`（布防编辑链路）验证：可编辑、保存、预览行为保持原样。

## 本地构建验证
- `node --check` 已通过：
  - `backend/services/unitTypeDtoService.js`
  - `backend/services/unitRegistryService.js`
  - `backend/routes/army.js`
  - `backend/routes/nodes.js`
- `frontend` 执行 `npm run build` 成功（存在仓库原有 eslint warnings，非本次新增阻断错误）。
