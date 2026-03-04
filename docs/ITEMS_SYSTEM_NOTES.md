# 战场设置物系统说明（实现笔记）

本文档仅说明战场设置物（items/props），不包含城内建筑。

## 1. 为什么选 composite OBB

选择 `compositeObb` 的原因：
- 和当前仿真/寻路/LoS/投射物的二维平面检测最兼容，改造量最小。
- 比单一旋转矩形更贴近外观，可表达弧形/缺口/刺状结构。
- 比全栅格/SDF成本低，且可直接用于 `instanced` 低模块渲染拆分。

当前也保留 `polygon` 分支（放置与物理层均可处理），但主路径是 `compositeObb`。

## 2. 一致性原则：同一份几何定义驱动四个系统

核心入口：`frontend/src/game/battlefield/items/itemGeometryRegistry.js`

同一份 `itemType` 定义（`collider/renderProfile/sockets/interactions`）同时用于：
- 近景预览：`createPreviewMesh`（Three.js）
- 战场渲染：`BattleRuntime -> buildRenderableBuildingParts -> BuildingRenderer`
- 编辑器放置/碰撞：`collidersOverlap2D`, `pointInsideCollider2D`, socket snap
- 仿真阻挡/LoS/投射物命中：`crowdPhysics` 的 collider-aware API

结果：不再出现“显示形状和碰撞形状不一致”的历史问题。

## 3. 关键改造点

### 3.1 渲染（40°/90°可见）
- 文件：`frontend/src/game/battle/presentation/render/BuildingRenderer.js`
- 方案：由旧 billboard+dither 改为 instanced cuboid（顶面+侧面明确定义）
- 效果：顶视角（90°）仍能看到清晰顶面，不会因 roof dither discard 消失。

### 3.2 运行时快照
- 文件：`frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
- 新增：
  - item catalog 带入 `collider/renderProfile/interactions/sockets`
  - obstacle 在运行时预计算 `colliderParts`
  - snapshot buildings 由“对象级”改为“collider part级”实例数据

### 3.3 编辑器放置与吸附
- 文件：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 新增：
  - `collider-aware` 碰撞检测（替换旧 rect overlap）
  - socket-aware 吸附（优先 socket，无 socket 回退磁吸边缘）
  - 持久化 `attach` 与 `groupId`

### 3.4 仿真碰撞/LoS/投射物
- 文件：`frontend/src/game/battle/simulation/crowd/crowdPhysics.js`
- 变更：统一对外 API 保持不变，内部切换为 collider-aware（rect/compositeObb/polygon）。

### 3.5 交互系统（事件驱动）
- 文件：`frontend/src/game/battle/simulation/items/itemInteractionSystem.js`
- 机制：
  - 为带交互物体建 obstacle spatial hash
  - squad 邻域查询 + contact state（enter/tick/exit）
  - 避免单位×物体全场笛卡尔扫描
- 支持：
  - `concealment`（草丛隐身 + 近距破隐）
  - `trapStagger`（微伤 + poise/stagger 高硬直）
  - `contactDot`（进入扣一次 + 持续接触按 interval 扣血，离开停止）
  - `spotterAura`（基础视野增益）
- selector 维度：`rpsType` + `classTag` + `tags(tagsAny/tagsAll/tagsExclude)`

### 3.6 主循环接入顺序
- 文件：`frontend/src/game/battle/simulation/crowd/CrowdSim.js`
- 顺序：`buildSpatialHash` 后、`updateCrowdCombat` 前执行 `itemInteractionSystem.step(...)`。

## 4. 可见性与目标选择

- `BattleRuntime` 渲染快照会过滤隐藏敌方小队（当前视角为攻方时过滤 defender hidden）。
- `crowdCombat` 目标挑选与局部敌人查询已过滤隐藏小队，投射物命中也做了隐藏过滤。

## 5. 数据层与库存

### 5.1 数据结构扩展（向后兼容）
- `backend/models/BattlefieldItem.js`
  - 新增：`collider`, `renderProfile`, `interactions`, `sockets`, `maxStack`, `requiresSupport`, `snapPriority`, `description`
- `backend/models/DomainDefenseLayout.js`
  - `BattlefieldObjectSchema` 新增：`attach`, `groupId`

### 5.2 库存（普通用户默认每种5个）
- `backend/models/User.js`：`battlefieldItemInventory`
- `backend/services/battlefieldInventoryService.js`：
  - 注册/登录/布局读写时懒初始化补齐缺失项
  - 默认 `count=5`
- `backend/routes/nodes.js`：保存布局按用户库存校验数量
- `backend/routes/army.js`：训练场继续使用无限（`MAX_TEMPLATE_UNIT_COUNT`）

## 6. catalog 截断

- `backend/services/domainTitleStateStore.js`
  - `BATTLEFIELD_ITEM_LIMIT` 已从 `12` 提升到 `240`，满足 >=200 的需求。

## 7. 取消弹反

- 新增 10 个物品未定义任何 reflect 类 interaction。
- 交互系统仅实现 concealment/trapStagger/contactDot/spotterAura。

## 8. 10个新物品入口

- seed：`backend/seed/bootstrap_catalog_data.json`
- 前端统一几何解析：`frontend/src/game/battlefield/items/itemGeometryRegistry.js`
- 近景预览：`frontend/src/components/game/item/ArmyBattlefieldItemPreviewCanvases.js`
- 编辑器与战斗仿真自动复用同一份定义。
