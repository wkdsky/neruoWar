# BATTLE_SCENE_OBJECTS_IMPLEMENTATION_AUDIT

> 审计范围说明：本报告中的“物品”指**战场设置物（items/props）**，不含城建系统；但代码里大量沿用 `building/wall` 命名，本文会明确指出映射关系。

## 结论摘要（先答核心问题）

### 当前系统能否支持目标需求？
- **部分支持**：已具备放置、旋转、叠加（最多5层）、基础吸附、战斗阻挡、LoS 阻挡、投射物与障碍碰撞、近景3D预览。
- **关键不满足**：
  1. 碰撞/阻挡/命中仍以**旋转矩形**为核心，无法表达“外观即碰撞”的非矩形结构。
  2. 战场设置物渲染管线过于简化（当前是 instanced 单四边形屋顶），缺少按物品类型区分的顶面/侧面材质与形状。
  3. 缺少组合结构持久化（socket/anchor/link）与破坏级联链路。
  4. 缺少设置物交互事件层（enter/exit/contact-tick），草丛/陷阱/拒马持续接触伤害暂无法直接挂接。
  5. 后端状态归一化有 `BATTLEFIELD_ITEM_LIMIT=12`，会卡“百余物品目录”。

### 最小改造落点（总体）
- **数据层**：给 `BattlefieldItem` 增加 `collider/render/interaction/sockets` 元数据；给布局对象增加可选 `attachLinks`（或单独 links 表）。
- **仿真层**：把 `crowdPhysics` 从“单 OBB 矩形”升级为“复合碰撞体（OBB+Polygon）分发器”，并新增设置物接触事件系统（基于空间哈希）。
- **渲染层**：为战场设置物引入“简化 mesh 的 instancing 批渲染”（优先），补齐 type/material 索引。
- **编辑层**：`BattlefieldPreviewModal` 从矩形接触逻辑扩展到 collider-aware 吸附/碰撞；保存结构支持 attach link。

---

## 1. 战场渲染与视角系统（40°/90°）

### 1.1 战场视角切换实现（40°/90°）
- 40/90 常量：`frontend/src/game/battle/screens/BattleSceneContainer.js:42-43` (`BATTLE_PITCH_LOW_DEG=40`, `BATTLE_PITCH_HIGH_DEG=90`)。
- 切换入口：`handleTogglePitch` 在 `frontend/src/game/battle/screens/BattleSceneContainer.js:1125`。
- 相机切换核心：
  - `togglePitchMode`：`frontend/src/game/battle/presentation/render/CameraController.js:267`
  - `setPitchMode`：`.../CameraController.js:272`
  - `getPitchBlend`：`.../CameraController.js:280`

### 1.2 相机参数与投影；切换是否影响 picking/raycast
- 相机参数：构造函数含 `yawDeg/pitchLow/pitchHigh/distance`：`CameraController.js:233-236`。
- `distance` 即缩放半径（zoom）；在场景中可被滚轮与双指手势更新：
  - 滚轮缩放：`BattleSceneContainer.js:1749-1750`
  - 双指缩放：`BattleSceneContainer.js:1693`
  - 进入部署时会重设 overview 距离：`BattleSceneContainer.js:639`
- 投影矩阵：固定透视投影 `mat4Perspective(48°)`：`CameraController.js:358` 附近。
- 视图矩阵与修正：`buildMatrices`：`CameraController.js:337`；含 pitch 接近 90° 时的 flip 修正逻辑。
- picking/raycast：`screenToGround` 用逆 VP 矩阵射线求与 `z=0` 平面交点：`CameraController.js:441`。
- UI 点击世界坐标：`resolveEventWorldPoint` 调 `screenToGround`：`BattleSceneContainer.js:1222-1228`。
- 结论：**会随相机切换同步影响 picking**（同一矩阵源），不是独立旧坐标系。

### 1.3 顶视（90°）可见性机制
- **单位**：是 impostor（非真实 mesh），并有“正视/俯视”混合：
  - `worldV/worldT` 混合：`ImpostorRenderer.js:73`
  - `uTopBlend`：`ImpostorRenderer.js:31,116`
  - 顶层贴图切片：`vSliceTop` + `sampler2DArray`：`ImpostorRenderer.js:102,156`
- **设置物**：当前是 BuildingRenderer 的 instanced quad（非体块 mesh），实例字段只有 x/y/宽/深/高/旋转/hp/销毁：`BuildingRenderer.js:8,12-13`；`BattleRuntime.js:2224-2232`。
- 顶视可见风险：`BuildingRenderer` 在高 pitch 下做 dither 丢弃：
  - `roofKeep = 1 - uPitchMix*0.95`：`BuildingRenderer.js:61`
  - `if (roofKeep < d) discard`：`BuildingRenderer.js:63`
  - 当 `pitchMix≈1` 时仅约 5% 片元保留，设置物会非常淡/破碎。

### 1.4 战场物品渲染管线与实例属性
- 专用渲染器：`frontend/src/game/battle/presentation/render/BuildingRenderer.js`。
- 批渲染：`drawArraysInstanced`：`BuildingRenderer.js:140`。
- per-instance 仅 8 浮点：
  - `iData0: x y width depth`（`BuildingRenderer.js:12`）
  - `iData1: height rot hp destroyed`（`BuildingRenderer.js:13`）
- **缺失**：`typeId/layer/topTex/sideTex/materialId` 等类型化外观字段。

### 1.5 顶面/侧面外观支持性
- BuildingRenderer FS 无 `sampler2DArray`/atlas 采样，仅内置颜色与 hp 衰减：`BuildingRenderer.js:43-67`。
- 单位渲染才有 `sampler2DArray`（`ImpostorRenderer.js:102,117`）。
- 结论：当前设置物管线**不支持**按物品区分顶面/侧面贴图，不支持“同类型不同材质层”。

### 1.6 最小可行方案判断（A/B/C）
- 结论：推荐 **B) 设置物引入简化 mesh（仍批渲染）**。
- 理由：
  1. 现有 BuildingRenderer 已是实例化批渲染，升级为“低模 instanced mesh”成本可控。
  2. 需求要求“顶面+侧面可辨识”，单 impostor 多面片方案会继续和碰撞形状脱节。
  3. 目标物品上限（当前对象上限 600）可承受低模实例批渲染。
- 改造入口：
  - 渲染：`frontend/src/game/battle/presentation/render/BuildingRenderer.js`
  - 快照打包：`frontend/src/game/battle/presentation/runtime/BattleRuntime.js:2141,2224-2232`
  - 物品渲染参数来源：`BattleRuntime.js:224-271`（`buildObstacleList/buildItemCatalog`）

---

## 2. 物品/建筑碰撞与阻隔（非矩形能力）

### 2.1 当前放置碰撞检测形状
- 预览编辑端使用**旋转矩形 SAT**：
  - `getRectContactMetrics`：`BattlefieldPreviewModal.js:548`
  - `isRectOverlap`：`BattlefieldPreviewModal.js:569`
  - `hasCollision`：`BattlefieldPreviewModal.js:658`
- 且 `hasCollision` 只检测同层 `z`：`BattlefieldPreviewModal.js:662`。

### 2.2 当前战斗阻挡（pathing）与 LoS 形状；是否同一套
- 仿真核心碰撞函数均在 `crowdPhysics.js`，形状是旋转矩形：
  - `isInsideRotatedRect`：`:22`
  - `pushOutOfRect`：`:33`
  - `lineIntersectsRotatedRect`：`:118`
  - `hasLineOfSight`：`:180`
- `CrowdSim` 移动避障使用 `sim.buildings` + `pushOutOfRect`：`CrowdSim.js:1930`。
- `engagement.js` LoS 评分同用 `hasLineOfSight`：`engagement.js:213,374,417`。
- 结论：pathing 与 LoS 在 XY 平面上**基本同一套矩形障碍定义**。

### 2.3 当前投射物命中障碍形状
- `crowdCombat.js`：
  - 射线扫墙：`detectWallSweepHit` + `raycastObstacles`：`:476,481`
  - 包含点命中：`isInsideRotatedRect`：`:498`
  - 扣墙血：`applyDamageToBuilding`：`:412`
- 结论：投射物对设置物命中也基于同一矩形障碍模型。

### 2.4 支持“外观形状=碰撞体”时，最易扩展形式与最小落点

#### 扩展形式评估
- `多边形(2D polygon)`：可行，LoS/raycast/placement 都可统一到 2D 几何。
- `复合碰撞体(多个 OBB/Polygon)`：**最推荐最小落地**，可复用现有 OBB 逻辑并渐进引入 polygon。
- `SDF/栅格`：实现快但代价大（内存/分辨率/旋转精度/多系统一致性），不推荐作为主路径。

#### 最小改造点
- 数据结构：
  - `backend/models/BattlefieldItem.js`：新增 `collider`（如 `kind/parts`）、`interaction`、`sockets`。
  - `backend/services/placeableCatalogService.js`：序列化透传新字段（当前只透传 `style` 与尺寸）。
  - `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`：`buildObstacleList` 挂接 `collider` 到运行时对象。
- 碰撞函数：
  - `frontend/src/game/battle/simulation/crowd/crowdPhysics.js`：新增 `isInsideCollider / raycastCollider / losBlockedByCollider / pushOutOfCollider` 分发器。
  - `CrowdSim.js`、`engagement.js`、`crowdCombat.js` 全部从 rect API 切到 collider API。
- 索引结构：
  - 当前只有 agent 空间哈希（`buildSpatialHash/querySpatialNearby`：`crowdPhysics.js:215,228`）。
  - 需新增 obstacle/collider 空间哈希（按 part AABB 入桶），用于 LoS 与接触类查询优化。

### 2.5 一致性检查（放置 vs 战斗 vs LoS）
- **不一致 1（z 维）**：
  - 放置碰撞仅同层：`BattlefieldPreviewModal.js:662`
  - 战斗/LoS/投射物完全忽略 `z`（所有 crowdPhysics 矩形函数只用 x/y）。
- **不一致 2（外观 vs 碰撞）**：
  - 编辑渲染有 `cheval_de_frise` 特殊外观分支：`BattlefieldPreviewModal.js:2740`
  - 但碰撞仍是矩形（`hasCollision/isRectOverlap`）。
- **不一致 3（近景预览形状命名）**：
  - 近景预览识别 `stakes`：`ArmyBattlefieldItemPreviewCanvases.js:68`
  - 战场编辑识别 `cheval_de_frise`：`BattlefieldPreviewModal.js:2740`
  - 目录种子是 `cheval_de_frise`：`backend/seed/bootstrap_catalog_data.json:35`

---

## 3. 物品组合/吸附/叠加：现状与缺口

### 3.1 布置端吸附、旋转、叠加实现位置
- 主实现：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 关键函数：
  - 旋转步进：`ROTATE_STEP=7.5`（`:28`）
  - 叠加上限：`MAX_STACK_LEVEL=5`（`:21`）
  - 吸附求解：`solveMagneticSnap`（`:684`）
  - 碰撞判定：`hasCollision`（`:658`）

### 3.2 吸附方式与是否硬编码
- 当前是矩形边缘/顶面吸附（top + side + edge），核心依赖矩形法线、角点与 yaw 候选。
- 不是“某两个物品 ID 写死吸附”，但**几何模型写死为矩形**。
- 硬编码点在外观层存在：`cheval_de_frise` 仅视觉分支（`BattlefieldPreviewModal.js:2740`）。

### 3.3 布置保存的 layout 数据结构
- 保存载荷 `buildLayoutPayload`：`BattlefieldPreviewModal.js:423`
- 对象字段仅：`objectId/itemId/x/y/z/rotation`（`:446-452`）
- **没有** `parent-child / socket / attachLinks`。

### 3.4 若支持“柱子搭板子”并可持久化
- 是否必须引入 sockets/anchors/attachLinks：**是（最小可维护方案）**。
- sockets 放置建议：
  - `ItemType`（catalog）定义标准 socket 拓扑（类型级复用）。
  - `Instance` 只存占用关系与实例偏移。
- layout link 存储建议：
  - `parentObjectId + parentSocketId + childObjectId + childSocketId + localOffset/localRot`。
- 破坏级联：
  - 当前仅有 `wall.destroyed=true` 与 `sim.destroyedBuildings++`（`crowdCombat.js:412-418`），无结构事件链。
  - 若要级联掉落/断裂，需新增“对象依赖图 + destroy 事件传播”。

### 3.5 叠加最大 5 层限制位置与差异化
- 前端：`BattlefieldPreviewModal.js:21`（`MAX_STACK_LEVEL`）+ 多处 clamp。
- 后端：`domainTitleStateStore.js:12`（`BATTLEFIELD_MAX_STACK_LEVEL`）和归一化 clamp（`:361`）。
- Schema：`DomainDefenseLayout.js:136`（`z <= BATTLEFIELD_MAX_STACK_LEVEL-1`）。
- 差异化建议：
  - 给 `BattlefieldItem` 增 `maxStack` / `requiresSupport` / `stackGroup`。
  - 在 `solveMagneticSnap` 与后端 normalize/校验同时落规则。

---

## 4. 物品数据：DB/接口/下发链路

### 4.1 物品类型（catalog）Model/Schema 字段
- `backend/models/BattlefieldItem.js`
- 现有字段：`itemId,name,initialCount,width,depth,height,hp,defense,style,sortOrder,enabled,createdAt,updatedAt`。
- 当前缺失：专用 `renderProfile/collider/interaction/sockets/description` 字段。

### 4.2 物品实例（layout objects）存储位置与结构
- 主集合结构：`backend/models/DomainDefenseLayout.js`
  - `battlefieldObjects`（扁平）使用 `BattlefieldObjectSchema`：`layoutId/objectId/itemId/x/y/z/rotation`。
  - 兼容旧嵌入：`battlefieldLayout.objects`（带 width/depth/height/hp/defense 默认项）。
- 归一化入口：`backend/services/domainTitleStateStore.js` 的 `normalizeBattlefieldObjects`。

### 4.3 后端接口链路（catalog / 保存 layout / battle init 下发）
- 目录管理（管理员）：
  - `GET/POST /api/admin/catalog/items`：`backend/routes/admin.js:980,993`
  - `PUT/DELETE /api/admin/catalog/items/:itemId`：`:1019,1051`
- 布局读取/保存：
  - `GET /api/nodes/:nodeId/battlefield-layout`：`backend/routes/nodes.js:7361`
  - `PUT /api/nodes/:nodeId/battlefield-layout`：`:7446`
- 关键入参/出参：
  - `GET battlefield-layout` 入参：`gateKey/layoutId`（query）；出参：`layoutBundle{activeLayout,layouts,itemCatalog,objects,defenderDeployments}`（`nodes.js:7436`）。
  - `PUT battlefield-layout` 入参：`gateKey/layoutId/layout/itemCatalog/objects/defenderDeployments`（由 `mergeBattlefieldStateByGate` 合并，`nodes.js:7446+`）；会按 `initialCount` 做每物品数量校验（`nodes.js:7496-7513`）；出参为更新后的 `layoutBundle`（`nodes.js:7602`）。
- 战斗初始化下发：
  - `GET /api/nodes/:nodeId/siege/pve/battle-init`：`:7794`
  - 入参：`gateKey`（query）；返回 `battlefield{layoutMeta,layouts,itemCatalog,objects,defenderDeployments}`（`:7872-7876`）。
- 训练场初始化：
  - `GET /army/training/init`：`backend/routes/army.js:336`
  - 下发 `battlefield.itemCatalog/objects`（objects 为空）并将 `initialCount` 覆盖为超大值。

### 4.4 前端 catalog 截断上限
- 前端未发现固定 `limit=12` 截断。
- 后端归一化硬限制：`BATTLEFIELD_ITEM_LIMIT=12`（`domainTitleStateStore.js:14`），`normalizeBattlefieldItems` 在 `:282` 截断。
- 影响：即便 DB/管理端有百余物品，进入该状态归一化链路后会被截断到 12。

### 4.5 “普通用户默认每种物品=5”落点
- 现状：**未发现按用户维度的设置物库存模型**（`User` 仅见 `armyRoster`）。
- 当前物品数量语义是“布局可放置上限（catalog.initialCount）”，不是用户背包。
- 训练场还会把 `initialCount` 置为 `MAX_TEMPLATE_UNIT_COUNT=999999999`：`backend/routes/army.js:70,362`。
- 结论：该需求当前无落点，需要新增用户库存字段与初始化流程（注册/迁移脚本）。

---

## 5. 交互系统接入点（草丛/陷阱/拒马）

> 先说明现状事件机制：目前没有独立“设置物 enter/exit/hit/destroy 事件总线”。
> 已有可复用钩子：`updateCrowdSim` 主循环、agent 空间哈希、`applyDamageToAgent`、`applySquadStabilityHit`、`applyDamageToBuilding`。

### 5.1 草丛：完全隐身（近距破隐）
- 最合适接入点：
  - 判定层：`updateCrowdSim`（`CrowdSim.js:1645` 起，已拿到 `walls` + `crowd.spatial`）。
  - LoS 层：`hasLineOfSight` 调用处（`engagement.js` 与 `crowdCombat.js`）。
  - 渲染层：`BattleRuntime.getRenderSnapshot` 打包单位实例时加可见性标记（目前 `visibilityMask` 固定 null：`BattleRuntime.js:2358`）。
- 现有能力匹配：
  - LoS 有（矩形障碍）。
  - 命中率路径有（`crowdCombat.js` 命中概率与 blockedByWall 分支）。
  - 逐单位可见性掩码**缺失**（需新增）。

### 5.2 陷阱：微伤害 + 高硬直/打断
- 最合适接入点：
  - 伤害：`applyDamageToAgent`（`crowdCombat.js:267`）
  - 硬直：`applySquadStabilityHit`（`:132`）/ `triggerSquadStagger`（`:116`）
- 说明：已有 poise/硬直系统，可通过高 `poiseDamageMul` + 陷阱配置实现“低HP伤害但高打断”。

### 5.3 拒马/毒刺：接触一次扣血 + 持续接触每N秒 tick
- 最合适接入点：
  - 在 `updateCrowdSim` 中新增 `updateObjectInteractions(sim, crowd, dt)`，位置建议在 `crowd.spatial` 构建后、`updateCrowdCombat` 前。
  - 伤害调用 `applyDamageToAgent`。
- 性能策略（避免全场 N×M 扫描）：
  - 复用 `buildSpatialHash/querySpatialNearby`（`crowdPhysics.js:215,228`）。
  - 对“有交互的设置物”建立对象空间桶（新增）。
  - 维护 `contactStateMap(objectId:agentId)`：
    - 首次进入触发一次性伤害（enter）。
    - 持续接触按 `nextTickAt` 周期触发（tick）。
    - 离开清理（exit）。

---

## 6. 近景3D模型预览（兵营/面板）

### 6.1 是否已有 Three.js 近景预览
- 有。
- 设置物预览：`frontend/src/components/game/item/ArmyBattlefieldItemPreviewCanvases.js`
  - `ArmyBattlefieldItemCloseupPreview`：`:149`
  - `ArmyBattlefieldItemBattlePreview`：`:218`
  - `buildBattlefieldItemMesh`：`:34`
- 单位预览也已有：`frontend/src/components/game/unit/ArmyUnitPreviewCanvases.js`。

### 6.2 物品预览占位与复用建议
- 已有面板接入：`ArmyPanel.js:1322,1346`。
- 无需新造 canvas 框架，直接复用 `ArmyBattlefieldItemPreviewCanvases` 最合适。

### 6.3 近景模型与战场模型一致性落点
- 现状不一致：
  - 近景使用 `style.shape === 'stakes'`（`ArmyBattlefieldItemPreviewCanvases.js:68`）
  - 战场编辑使用 `style.shape === 'cheval_de_frise'`（`BattlefieldPreviewModal.js:2740`）
  - 实战 BuildingRenderer 不识别 shape/type。
- 建议最小落点：提取统一的 `itemGeometry + itemCollider` 生成模块（前端共享），由同一份类型参数驱动：
  1. 近景 Three 模型
  2. 战场渲染简模
  3. 物理碰撞体

---

## 7. 面向实现的关键入口点清单

### 7.1 实现“10个新物品（近景+战场贴图+非矩形碰撞+部分可组合）”最关键改动文件
1. `backend/models/BattlefieldItem.js`（新增 collider/render/interaction/sockets 字段）
2. `backend/services/placeableCatalogService.js`（序列化新字段）
3. `backend/routes/admin.js`（catalog 字段校验/CRUD）
4. `backend/services/domainTitleStateStore.js`（去 12 限制；normalize 新字段）
5. `backend/models/DomainDefenseLayout.js`（对象 attachLinks/关系持久化）
6. `backend/routes/nodes.js`（layout 读写、battle-init 下发字段）
7. `frontend/src/components/game/BattlefieldPreviewModal.js`（放置碰撞/吸附/保存结构升级）
8. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`（对象构建、快照字段）
9. `frontend/src/game/battle/presentation/render/BuildingRenderer.js`（升级为可辨识简化mesh批渲染）
10. `frontend/src/game/battle/simulation/crowd/crowdPhysics.js`（通用 collider 几何库）
11. `frontend/src/game/battle/simulation/crowd/CrowdSim.js`（对象交互 enter/exit/tick）
12. `frontend/src/game/battle/simulation/crowd/crowdCombat.js`（陷阱伤害/硬直/投射物碰撞统一）
13. `frontend/src/components/game/item/ArmyBattlefieldItemPreviewCanvases.js`（复用统一 geometry/collider）

### 7.2 已具备可复用基础
- 相机 40/90 切换与 pitch blend 已完整。
- 设置物实例化批渲染骨架已存在（需扩展字段）。
- agent 空间哈希已存在（可用于交互系统性能优化）。
- poise/stagger 机制已存在（可直接给陷阱/拒马接入）。
- 编辑器已有吸附/叠加交互框架（需改为 collider-aware）。

### 7.3 硬缺口（必须新增）
- 物品非矩形碰撞数据模型与统一碰撞分发器。
- 组合结构持久化（socket/link）与破坏级联机制。
- 设置物交互事件层（enter/exit/contact tick）。
- 设置物渲染类型化参数（顶面/侧面材质、typeId）。
- 目录上限 12 的后端限制调整。

---

## 附录：Search Hits（50条关键命中）

| # | 命中（文件:行号） | 关键词 | 用途说明 |
|---|---|---|---|
| 1 | `frontend/src/game/battle/presentation/render/CameraController.js:233` | `pitchLow/pitchHigh` | 40/90 俯仰参数源 |
| 2 | `frontend/src/game/battle/presentation/render/CameraController.js:267` | `togglePitchMode` | 视角切换核心函数 |
| 3 | `frontend/src/game/battle/presentation/render/CameraController.js:272` | `setPitchMode` | 切换到 high/low |
| 4 | `frontend/src/game/battle/presentation/render/CameraController.js:280` | `getPitchBlend` | 渲染混合系数来源 |
| 5 | `frontend/src/game/battle/presentation/render/CameraController.js:337` | `buildMatrices` | 相机矩阵构建 |
| 6 | `frontend/src/game/battle/presentation/render/CameraController.js:441` | `screenToGround` | 屏幕点到地面拾取 |
| 7 | `frontend/src/game/battle/screens/BattleSceneContainer.js:42` | `BATTLE_PITCH_LOW_DEG` | 低俯角常量 40° |
| 8 | `frontend/src/game/battle/screens/BattleSceneContainer.js:43` | `BATTLE_PITCH_HIGH_DEG` | 高俯角常量 90° |
| 9 | `frontend/src/game/battle/screens/BattleSceneContainer.js:994` | `pitchMix` | 当前 pitch 混合值 |
| 10 | `frontend/src/game/battle/screens/BattleSceneContainer.js:996` | `renderers.building.render` | 设置物渲染调用点 |
| 11 | `frontend/src/game/battle/screens/BattleSceneContainer.js:997` | `renderers.impostor.render` | 单位渲染调用点 |
| 12 | `frontend/src/game/battle/screens/BattleSceneContainer.js:1125` | `handleTogglePitch` | UI切换视角入口 |
| 13 | `frontend/src/game/battle/screens/BattleSceneContainer.js:1222` | `resolveEventWorldPoint` | 鼠标事件世界坐标 |
| 14 | `frontend/src/game/battle/presentation/render/BuildingRenderer.js:8` | `BUILDING_INSTANCE_STRIDE` | 设置物实例步长=8 |
| 15 | `frontend/src/game/battle/presentation/render/BuildingRenderer.js:12` | `iData0` | 实例属性 x/y/width/depth |
| 16 | `frontend/src/game/battle/presentation/render/BuildingRenderer.js:13` | `iData1` | 实例属性 height/rot/hp/destroyed |
| 17 | `frontend/src/game/battle/presentation/render/BuildingRenderer.js:43` | `uPitchMix` | 顶视混合 uniform |
| 18 | `frontend/src/game/battle/presentation/render/BuildingRenderer.js:61` | `roofKeep` | 顶视可见性 dither 参数 |
| 19 | `frontend/src/game/battle/presentation/render/BuildingRenderer.js:63` | `discard` | 顶视片元丢弃 |
| 20 | `frontend/src/game/battle/presentation/render/BuildingRenderer.js:140` | `drawArraysInstanced` | 设置物实例化绘制 |
| 21 | `frontend/src/game/battle/presentation/render/ImpostorRenderer.js:16` | `UNIT_INSTANCE_STRIDE` | 单位实例步长 |
| 22 | `frontend/src/game/battle/presentation/render/ImpostorRenderer.js:31` | `uTopBlend` | 单位俯视混合 |
| 23 | `frontend/src/game/battle/presentation/render/ImpostorRenderer.js:73` | `mix(worldV, worldT` | 单位正视/俯视位置混合 |
| 24 | `frontend/src/game/battle/presentation/render/ImpostorRenderer.js:102` | `sampler2DArray` | 单位纹理数组支持 |
| 25 | `frontend/src/game/battle/presentation/render/ImpostorRenderer.js:156` | `topMix` | 顶层贴图混合 |
| 26 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:224` | `buildObstacleList` | battlefield.objects -> sim.buildings |
| 27 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:960` | `initialBuildings` | 初始化障碍物列表 |
| 28 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:1468` | `buildings: cloneObstacleList` | 开战把设置物喂入仿真 |
| 29 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:2141` | `getRenderSnapshot` | 渲染快照总入口 |
| 30 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:2224` | `buildings.data[base+0]` | 设置物实例数据打包起点 |
| 31 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:2232` | `destroyed ? 1 : 0` | 销毁状态下发 |
| 32 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:2358` | `visibilityMask: null` | 无单位可见性掩码 |
| 33 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:22` | `isInsideRotatedRect` | 点-旋转矩形判定 |
| 34 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:33` | `pushOutOfRect` | 单位挤出障碍 |
| 35 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:118` | `lineIntersectsRotatedRect` | LoS 矩形相交 |
| 36 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:163` | `raycastObstacles` | 射线对障碍检测 |
| 37 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:180` | `hasLineOfSight` | LoS 阻挡判定 |
| 38 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:215` | `buildSpatialHash` | agent 空间哈希 |
| 39 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:228` | `querySpatialNearby` | 邻域查询 |
| 40 | `frontend/src/game/battle/simulation/crowd/CrowdSim.js:1653` | `buildSpatialHash(crowd.allAgents` | 每帧构建空间哈希 |
| 41 | `frontend/src/game/battle/simulation/crowd/CrowdSim.js:1930` | `pushOutOfRect` | 移动阶段墙体推离 |
| 42 | `frontend/src/game/battle/simulation/crowd/crowdCombat.js:116` | `triggerSquadStagger` | 硬直/打断机制入口 |
| 43 | `frontend/src/game/battle/simulation/crowd/crowdCombat.js:132` | `applySquadStabilityHit` | poise/硬直伤害结算 |
| 44 | `frontend/src/game/battle/simulation/crowd/crowdCombat.js:267` | `applyDamageToAgent` | 通用单位扣血入口 |
| 45 | `backend/models/BattlefieldItem.js:3` | `BattlefieldItemSchema` | 设置物类型 Schema 定义起点 |
| 46 | `backend/models/DomainDefenseLayout.js:104` | `BattlefieldObjectSchema` | 布局实例对象结构 |
| 47 | `backend/services/domainTitleStateStore.js:14` | `BATTLEFIELD_ITEM_LIMIT = 12` | 目录数量截断上限 |
| 48 | `backend/routes/nodes.js:7361` | `GET /:nodeId/battlefield-layout` | 布局读取接口 |
| 49 | `backend/routes/nodes.js:7446` | `PUT /:nodeId/battlefield-layout` | 布局保存接口 |
| 50 | `backend/routes/nodes.js:7794` | `GET /:nodeId/siege/pve/battle-init` | 战斗初始化下发接口 |

---

## 审计补充说明
- 本次严格只读分析，未修改业务代码。
- 结论基于当前仓库实际实现，不依赖外网信息。
