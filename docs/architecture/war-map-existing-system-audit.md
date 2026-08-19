# 训练营战争地图现有系统审计

> 审计日期：2026-08-16  
> 审计范围：训练营进入链路、地图数据、部队运行时、部署与移动、战斗与技能、AI/碰撞、渲染、持久化和通信边界。  
> 本文是 Phase 1 的实现依据，不把当前工作区中的未提交地图改动视为已完成的参考图验收。

## 结论

训练营已经具备可复用的完整浏览器端战斗运行时：后端负责提供初始数据和保存训练部队，前端 `BattleRuntime`、`CrowdSim`、`BattleClock` 与 Three.js 渲染管线负责本地模拟和展示。地图改造应向现有运行时提供版本化静态定义和查询适配，不应新建第二套单位、技能、战斗、部署或渲染系统。

当前工作区还存在一套正在接入的 `training-three-lane` 地图合同。其后端入口、前端归一化、导航、目标系统和测试均已可被审计，但它仍是代码内的简化三路线配置，尚不能作为参考图 `战场图.png` 的几何、墙体、营地和高地验收证据。

## 实际调用链

```text
TrainingGroundPanel
  -> GET /army/training/init
  -> backend/routes/army.js
  -> trainingMapService + 单位注册表 + 用户 trainingArmies
  -> BattleSceneModal / BattleSceneContainer
  -> useBattleRuntime -> BattleRuntime
  -> useBattleLoop(BattleClock 固定步长) -> CrowdSim / Combat / Objectives
  -> BattleSnapshotBuilder
  -> TrainingThreeRenderPipeline + HUD / Minimap
```

### 进入、初始化与资源数据

| 职责 | 实际入口 | 审计结果 |
|---|---|---|
| 训练营页面 | `frontend/src/components/game/TrainingGroundPanel.js` | 登录后请求训练初始化数据，并以 `mode="training"` 打开战斗弹窗。 |
| 前端战斗容器 | `frontend/src/game/battle/screens/BattleSceneContainer.js` | 组合运行时、部署编辑、输入、固定步长循环、Three.js 管线、HUD 和小地图。 |
| 训练初始化接口 | `backend/routes/army.js` 的 `GET /training/init` | 经认证读取启用单位、可用战场物件、用户训练部队；可用 `mapPreset` 查询参数请求预设，`legacy-flat` 保持显式回退。 |
| 单位数据表 | `backend/services/unitRegistryService.js`、`backend/services/unitTypeDtoService.js`、`frontend/src/game/unit/normalizeUnitTypes.js` | 后端输出启用单位 DTO，前端在创建 `BattleRuntime` 前归一化。地图层只能引用 `unitTypeId` 与运行时统计，不能复制单位定义。 |
| 物件目录 | `backend/services/placeableCatalogService.js`、`frontend/src/game/battlefield/items/ItemGeometryRegistry.js` | 现有物件已统一为几何、碰撞体、渲染配置、交互和材质色。地图静态物件应继续通过该目录进入运行时。 |

### 地图、部署与移动

| 职责 | 实际入口 | 可复用方式 |
|---|---|---|
| 训练地图合同 | `backend/services/trainingMapService.js` | 当前生成 `training-three-lane`、地图预设、静态物件、目标、道路和部署槽，并合并进训练初始化响应。Phase 2 应替换其内嵌简化几何的数据来源，而不是替换响应合同。 |
| 前端地图归一化 | `frontend/src/game/battle/shared/trainingMap.js` | `normalizeTrainingMapConfig`、预设过滤、部署槽和路线归属查询已隔离了 `legacy-flat` 兼容分支。 |
| 运行时地图接入 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js` | 构造时读取 `battlefield.map`，创建静态建筑、地图导航器和目标定义；重置与预设切换会重新生成地图物件。 |
| 部署编辑 | `frontend/src/game/battle/hooks/useBattleDeployEditor.js`、`frontend/src/game/battle/presentation/runtime/BattleRuntime.js` | 现有创建、拖拽、队形、朝向和手工位置编辑 API 必须保留；训练地图可通过 `getTrainingMapDeploySlots` 提供默认推荐槽。 |
| 玩家路径命令 | `frontend/src/game/battle/input/BattleInputController.js`、`frontend/src/game/battle/presentation/runtime/BattleRuntime.js` | 运行时已经将移动和攻击移动转换为 `waypoints` / `order.pathPoints`，并在训练地图中调用 `planTrainingMapRoute`。 |
| 地图导航 | `frontend/src/game/battle/simulation/navigation/TrainingMapNavigator.js` | 已有按静态阻挡物的网格 A*、路线简化和被挤开后的冷却重规划入口；后续应让它消费正式边界、多边形墙和地形数据。 |

### 模拟、战斗、技能与 AI

| 职责 | 实际入口 | 可复用方式 |
|---|---|---|
| 固定模拟时间 | `frontend/src/game/battle/hooks/useBattleLoop.js`、`frontend/src/game/battle/presentation/runtime/BattleClock.js` | 以默认 `1/30` 秒固定步推进 `BattleRuntime.step`；地图事件、塔和营地应继续在此路径运行。 |
| 部队运行时 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js` | 维护部署组、运行中 `sim`、快照、选择、训练重置、技能点和地图预设。 |
| 群集移动与 AI | `frontend/src/game/battle/simulation/crowd/CrowdSim.js` | 已负责队形、转向、避让、体力、目标选择、普通攻击、技能运动和卡住后的局部重新寻路。现有 AI 是通用行为规划，不是地图状态机。 |
| 攻击、伤害与死亡 | `frontend/src/game/battle/simulation/crowd/crowdCombat.js`、`frontend/src/game/battle/simulation/effects/CombatEffects.js` | 塔、营地和地图单位必须复用 `applyDamageToAgent`、效果池和现有死亡处理，不能单独维护 HP/伤害事件系统。 |
| 技能和位移 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`、`frontend/src/game/battle/simulation/crowd/CrowdSim.js` | 现有 `triggerCrowdSkill` 和技能画区已覆盖施法与位移；Phase 4 只应在落点前增加地图合法性查询。 |
| 塔和中立目标 | `frontend/src/game/battle/simulation/objectives/TrainingObjectiveSystem.js` | 已有地图目标定义、攻击、受伤、摧毁、营地重生、目标锁定和训练统计的接入点。它应接收正式的塔/营地定义。 |

### 碰撞、渲染、持久化与通信

| 职责 | 实际入口 | 审计结果 |
|---|---|---|
| 碰撞与视线 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js`、`frontend/src/game/battle/simulation/items/itemObstacleUtils.js` | 支持矩形、组合 OBB 和多边形碰撞；移动阻挡与视线阻挡可独立配置，适合承载高墙与普通墙。 |
| Three.js 训练渲染 | `frontend/src/game/battle/hooks/useBattleRenderPipeline.js`、`frontend/src/game/battle/presentation/render/TrainingThreeRenderPipeline.js` | 训练模式使用独立 Three.js 管线，已按 `terrainRegions`、`lanes`、建筑快照渲染程序化地面和静态物件。 |
| 快照与 UI | `frontend/src/game/battle/presentation/snapshot/BattleSnapshotBuilder.js`、`frontend/src/game/battle/presentation/ui/Minimap.js`、`frontend/src/game/battle/presentation/ui/BattleHUD.js` | 地图状态通过运行时快照投影给小地图和 HUD；渲染层不拥有模拟真相。 |
| 训练部队持久化 | `backend/models/User.js`、`backend/routes/army.js`、`frontend/src/game/battle/data/BattleDataService.js` | 仅 `trainingArmies` 会通过 `/army/training/armies` 写入用户文档；地图运行时、塔、营地、时钟和随机种子尚未保存。 |
| 在线通信 | `backend/server.js` | 已有 Socket.IO 基础连接和其他领域事件，但没有训练战场命令、事件序列、权威快照或断线恢复协议。当前训练模拟是浏览器本地权威。 |

## 已验证的可复用接口

- `buildTrainingBattlefield` / `buildLegacyTrainingBattlefield`：训练初始化的地图响应边界与兼容回退。
- `normalizeTrainingMapConfig`、`cloneTrainingMapElementsForPreset`、`getTrainingMapDeploySlots`：前端地图合同、预设和部署槽入口。
- `BattleRuntime.buildInitialBuildingsForTrainingMap`、`setTrainingMapPreset`、`resetTraining`：将静态定义投影为运行时物件的唯一入口。
- `TrainingMapNavigator.planRoute`：玩家命令与拥挤恢复共用的路径查询入口。
- `crowdPhysics`、`itemObstacleUtils`、`ItemGeometryRegistry`：墙体、边界、视线和物件渲染的统一几何能力。
- `TrainingObjectiveSystem`：防御塔/营地与既有伤害、效果、死亡和训练统计的接入点。
- `BattleClock` 和 `BattleSnapshotBuilder`：固定步模拟与“模拟到渲染”的单向投影边界。

## 缺失接口与旧地图假设

### 必须补齐的地图接口

1. `BattlefieldMapAdapter` 或等价模块：集中提供 `isWalkable`、最近合法点、地形采样、出生区校验、路径查询、目标查询和墙体查询；当前调用仍分散在 `BattleRuntime`、导航器和 `CrowdSim`。
2. 参考图数据资产：尚无 `geometry.json`、`navigation.json`、`objectives.json`、`neutral-camps.json`，也没有图片文件哈希、有效战场裁剪、图片到世界坐标换算或透明叠加调试层。
3. 坐标换算：训练渲染器实际以 `x/y` 放置地面、以 `z` 表示高度；`worldToMinimap` 将世界正 `y` 映射到画面上方。Phase 2 已据此确定正式地图使用 `x-right-y-up-z-up`，同时记录旧简化配置把上路设为负 `y` 的冲突。
4. 正式地图边界：现有导航只以矩形 field 和静态障碍物判断通行，缺少“地图外不可走”、高地入口和墙内最近合法点的统一定义。
5. 地形采样：当前导航仅依据道路与名为 `river` 的矩形区域设置代价；需要按参考图改为草地、沙地、道路和高地的结构化区域与规则。
6. 出生区域：当前每个阵营有六个边侧部署推荐槽，仍不是参考图的左上/左下/右上/右下四个三角高地、入口和稳定槽位模型。
7. 地图持久化和在线边界：尚无地图版本、随机种子、事件序号、命令去重、运行时快照、迁移或恢复合同。

### 不能直接沿用的简化假设

- `legacy-flat`、固定 `2700 × 1488` 矩形战场和两侧通用部署区只能作为兼容回退，不能决定正式图片几何。
- 当前 `trainingMapService` 把中央区域命名为 `river`、两边高地建模为整条矩形带；这与参考图的中央纵向沙地和四个三角高地不一致。
- Phase 1 时的内嵌简化配置只含少量对称矩形墙、两座塔/路线/阵营和四个中立营地；Phase 2 已以参考图数据替换默认合同。后续验收仍必须依据透明叠加和运行时碰撞，而不是按数据数量推定视觉完成。
- 当前程序化渲染支持矩形区域，但没有参考图裁剪叠加、曲线墙视觉路径或黄矩形/半圆地标的独立语义。
- 当前通用 AI 会追敌、警戒和避让，但没有 Spawn、Advance、RejoinLane、ReturnToCamp 等地图状态机，也没有路线推进目标链。

## 不破坏现有行为的接入策略

1. 保留 `/army/training/init` 响应外形、`mapId`、`mapVersion` 和 `legacy-flat` 查询回退；正式数据只替换 `training-three-lane` 的定义来源。
2. 将参考图静态数据放在版本化地图目录，并由 `trainingMapService` 校验后构造现有 `battlefield.map`；前端继续经 `trainingMap.js` 归一化。
3. 先让新地图适配层包装现有导航、碰撞和目标系统，再逐步将 `BattleRuntime` / `CrowdSim` 的直接查询迁移过去。
4. 保留现有部署编辑 UI 和用户训练部队持久化；地图只提供合法出生区、默认槽和编辑后的校验结果。
5. 所有塔、营地和未来中立单位通过现有模拟固定步、伤害、效果和快照路径运行；不将规则放入 Three.js 渲染器。
6. 在地图版本、快照和命令协议准备完成前，不把本地训练状态标记为在线权威状态。

## 验证证据

本次审计没有修改运行时代码。以下现有针对性测试在审计时通过：

```bash
node --check backend/services/trainingMapService.js
node --test backend/tests/trainingMapService.test.js
cd frontend && CI=true npm test -- --watchAll=false --runInBand \
  src/game/battle/simulation/navigation/TrainingMapNavigator.test.js \
  src/game/battle/simulation/objectives/TrainingObjectiveSystem.test.js \
  src/game/battle/presentation/runtime/BattleRuntime.training.test.js
```

- 后端：3 个子测试通过。
- 前端：3 个测试套件、40 个测试通过。

## Phase 2 的直接起点

以 `战场图.png` 的有效战场裁剪（排除顶部图例）为唯一空间来源，已通过 `worldToMinimap` 确认“图片顶部 → 世界正 `y`”的换算，并建立图片像素、归一化坐标和世界坐标之间的转换。随后输出版本化几何、导航、目标、营地和调试覆盖数据，并让 `trainingMapService` 消费这些数据。完成透明叠加、对象数量和镜像方向校验前，不得把当前简化 `training-three-lane` 配置标记为参考图实现完成。
