# PVE_BATTLE_SYSTEM_DOSSIER

## 1. Executive Summary

本项目的“攻占知识域 PVE 战斗”当前是**前端主导仿真 + 后端记录结果**架构，而不是服务器权威战斗回放架构。

关键结论（对应你关心的 5 点）：

1. 兵种数据链路已打通，但标准化仍有明显断点。
- 权威存储在 `ArmyUnitType`（`backend/models/ArmyUnitType.js:45-189`），通过 `unitRegistryService.fetchUnitTypesWithComponents()`输出（`backend/services/unitRegistryService.js:122-150`），再经前端 `normalizeUnitTypes()`（`frontend/src/game/unit/normalizeUnitTypes.js:91-103`）和 `BattleRuntime.buildUnitTypeMap()`（`frontend/src/game/battle/presentation/runtime/BattleRuntime.js:74-124`）进入仿真。
- 断点包括：`id/unitTypeId`双命名、`tier/level`双字段、`classTag`靠推断、默认值散落三层、战斗字段与展示字段混杂、无 unit schema version。

2. 表现层粗糙问题真实存在，且切入点明确。
- 近景模型：`ArmyCloseupThreePreview`用 `Capsule/Box/Cylinder`拼装（`frontend/src/components/game/unit/ArmyUnitPreviewCanvases.js:19-47`）。
- 战场小人：`ImpostorRenderer` billboard + texture2DArray（`frontend/src/game/battle/presentation/render/ImpostorRenderer.js:10-69, 343-369`）。
- 要换“球体+少量特征”最小切口：先改 `ImpostorRenderer` 的实例属性解释和 shader 混色/图层语义，再扩 `ArmyUnitType.visuals.battle`映射（`BattleRuntime.js:698-730, 1972-1986`）。

3. 顶视可读性“变一条线”根因可定位。
- 目前单位面片始终使用 `right + world up`构建，缺少 top sprite 分支（`ImpostorRenderer.js:34-35, 47-50`）。
- `uPitchMix`仅用于颜色混合，不做贴图选择（`ImpostorRenderer.js:84, 122, 343-355`）。
- 可行改造是：按 `CameraController.getPitchBlend()`（`frontend/src/game/battle/presentation/render/CameraController.js:280-283`）在 `ImpostorRenderer.render()`切换 front/top atlas layer。

4. 行为逻辑集中在 CrowdSim/CrowdCombat，分层清楚但有抖动风险点。
- 固定步长驱动：`BattleClock.tick()`（`frontend/src/game/battle/presentation/runtime/BattleClock.js:21-37`）+ `runtime.step()`（`BattleSceneModal.js:867`）。
- 移动/避障/群体：`updateCrowdSim()`（`CrowdSim.js:1533-1854`）+ `crowdPhysics`空间哈希/LOS/推离（`crowdPhysics.js:163-243`）。
- 攻击/射弹/命中：`updateCrowdCombat()`（`crowdCombat.js:589-816`）+ `stepProjectiles()`（`crowdCombat.js:546-587`）。
- 主要风险：多次目标重选、避障推离与分离力耦合、随机散布与CD抖动、战斗与渲染同步窗口差。

5. 部队放置目前是“组中心点”而非“展开 slot 编辑”；矩形 reshape 机制尚不存在。
- 部署阶段只维护 `deployGroup{x,y,units,placed}`（`BattleRuntime.js:894-955, 1039-1076`）。
- 开战后才扩成 agents（`createAgentsForSquad`，`CrowdSim.js:862-931`）。
- 想做“面积固定矩形 reshape”：UI 需新增拖拽手柄，状态层新增 `formationRect{width,depth,areaLocked}`，sim 层用固定面积公式重新分配 slot。

必须区分两套流程（避免误改）：
- **布防编辑/预览**：`BattlefieldPreviewModal` + `/api/nodes/:nodeId/battlefield-layout` + `/api/nodes/:nodeId/siege/battlefield-preview`。
- **攻占 PVE 战斗**：`PveBattleModal/BattleSceneModal` + `/api/nodes/:nodeId/siege/pve/battle-init` + `/api/nodes/:nodeId/siege/pve/battle-result`。

---

## 2. Repo Battle-Relevant Map（目录树 + 关键文件表）

### 2.1 关键目录树（按“攻占战斗”相关性）

```text
backend/
  models/
    ArmyUnitType.js
    UnitComponent.js
    User.js
    DomainSiegeState.js
    SiegeParticipant.js
    SiegeBattleRecord.js
    DomainDefenseLayout.js
    BattlefieldItem.js
    Node.js
  routes/
    army.js
    nodes.js
    admin.js
  services/
    unitRegistryService.js
    armyUnitTypeService.js
    placeableCatalogService.js
    domainTitleStateStore.js
    siegeParticipantStore.js

frontend/src/
  App.js
  components/game/
    PveBattleModal.js
    BattleSceneModal.js
    BattlefieldPreviewModal.js
    KnowledgeDomainScene.js
    ArmyPanel.js
    unit/ArmyUnitPreviewCanvases.js
  game/battle/
    presentation/runtime/
      BattleRuntime.js
      BattleClock.js
      BattleSummary.js
    presentation/render/
      CameraController.js
      GroundRenderer.js
      BuildingRenderer.js
      ImpostorRenderer.js
      ProjectileRenderer.js
      EffectRenderer.js
      WebGL2Context.js
    presentation/ui/
      Minimap.js
      BattleSkillBar.js
      BattleActionButtons.js
      DeployActionButtons.js
    presentation/assets/
      ProceduralTextures.js
    simulation/crowd/
      CrowdSim.js
      crowdCombat.js
      crowdPhysics.js
      engagement.js
    simulation/effects/
      CombatEffects.js
  game/unit/
    normalizeUnitTypes.js
  game/formation/
    ArmyFormationRenderer.js
```

### 2.2 Top 30 关键文件（按改造价值排序）

| Rank | 文件 | 角色与职责 |
|---|---|---|
| 1 | `backend/routes/nodes.js` | 围城状态、战场布局、PVE battle-init/battle-result 主路由与校验中心。 |
| 2 | `frontend/src/components/game/BattleSceneModal.js` | PVE 战斗前端主入口：runtime 初始化、RAF loop、结果上报。 |
| 3 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js` | 战斗运行时聚合层：部署组→squad、snapshot 输出、命令入口。 |
| 4 | `frontend/src/game/battle/simulation/crowd/CrowdSim.js` | agent 级移动/群集/技能触发总循环。 |
| 5 | `frontend/src/game/battle/simulation/crowd/crowdCombat.js` | 目标选择、普通攻击、射弹、命中、建筑受伤/摧毁。 |
| 6 | `frontend/src/game/battle/presentation/render/ImpostorRenderer.js` | 小人 billboard/impostor 渲染核心，顶视读不清问题源头。 |
| 7 | `frontend/src/game/unit/normalizeUnitTypes.js` | 前端单位白名单归一化，标准化与字段丢失的关键点。 |
| 8 | `backend/models/ArmyUnitType.js` | 单位目录权威 schema。 |
| 9 | `backend/services/unitRegistryService.js` | 单位+组件 registry 组装与目录保障逻辑。 |
| 10 | `backend/services/armyUnitTypeService.js` | 单位序列化输出（含 id/unitTypeId 双字段）。 |
| 11 | `backend/routes/army.js` | `/api/army/unit-types`、`/training/init` 下发单位数据。 |
| 12 | `frontend/src/App.js` | “进攻”按钮、battle-init 拉取、modal 装配。 |
| 13 | `frontend/src/components/game/PveBattleModal.js` | PVE 对 `BattleSceneModal` 的轻封装。 |
| 14 | `frontend/src/components/game/BattlefieldPreviewModal.js` | 布防编辑器（非战斗），物体吸附/旋转/保存。 |
| 15 | `frontend/src/components/game/KnowledgeDomainScene.js` | 域主打开布防编辑器入口。 |
| 16 | `backend/models/DomainDefenseLayout.js` | 战场布局/守军部署持久化结构。 |
| 17 | `backend/models/SiegeBattleRecord.js` | PVE 结果记录模型（非权威回放）。 |
| 18 | `backend/models/DomainSiegeState.js` | 围城门状态（cheng/qi）与攻方参与信息。 |
| 19 | `backend/models/SiegeParticipant.js` | 围城参与者集合化存储。 |
| 20 | `backend/services/domainTitleStateStore.js` | Node 嵌入态与集合态的桥接/兼容。 |
| 21 | `frontend/src/game/battle/presentation/render/CameraController.js` | 战场相机矩阵、pitch blend。 |
| 22 | `frontend/src/game/battle/presentation/ui/Minimap.js` | 顶视小地图与相机框。 |
| 23 | `frontend/src/game/battle/presentation/runtime/BattleClock.js` | fixed-step 仿真时钟。 |
| 24 | `frontend/src/game/battle/simulation/crowd/engagement.js` | 近战交战锚点系统（lane/band/pair）。 |
| 25 | `frontend/src/game/battle/simulation/crowd/crowdPhysics.js` | OBB/LOS/raycast/空间哈希基础。 |
| 26 | `frontend/src/game/battle/simulation/effects/CombatEffects.js` | 射弹/特效对象池。 |
| 27 | `frontend/src/game/battle/presentation/assets/ProceduralTextures.js` | 程序化 texture2DArray 资源。 |
| 28 | `frontend/src/components/game/unit/ArmyUnitPreviewCanvases.js` | 近景三维预览 + 战场 impostor 预览。 |
| 29 | `backend/services/placeableCatalogService.js` | 战场物品目录加载（障碍参数来源）。 |
| 30 | `frontend/src/game/formation/ArmyFormationRenderer.js` | 仅用于可视化 formation slot，不是 battle 运行时站位真源。 |

---

## 3. End-to-End Flow: UI → API → Simulation → Rendering → Settlement

### 3.1 两条链路必须分开看

1. 布防编辑/预览链路（非战斗）
- 前端入口：`KnowledgeDomainScene.openBattlefieldPreview()`（`frontend/src/components/game/KnowledgeDomainScene.js:1091-1097`，渲染在 `4552-4560`）。
- 读：`GET /api/nodes/:nodeId/battlefield-layout`（`backend/routes/nodes.js:7360-7441`）。
- 写：`PUT /api/nodes/:nodeId/battlefield-layout`（`backend/routes/nodes.js:7445-7603`；前端发起在 `BattlefieldPreviewModal.js:2133-2146`）。
- 情报预览：`GET /api/nodes/:nodeId/siege/battlefield-preview`（`backend/routes/nodes.js:7704-7785`，会清空 defenderDeployments 返回）。

2. 攻占 PVE 战斗链路（你要改造的主链）
- 前端入口：`App` 进攻按钮（`frontend/src/App.js:6620-6628`）→ `handleOpenSiegePveBattle()` 拉 `battle-init`（`3174-3218`）→ `PveBattleModal`（`6645-6652`）→ `BattleSceneModal`（`PveBattleModal.js:4-10`）。
- 后端 init：`GET /api/nodes/:nodeId/siege/pve/battle-init`（`backend/routes/nodes.js:7793-7877`）。
- 前端仿真：`BattleRuntime + CrowdSim + renderers`（见 3.3）。
- 后端结果：`POST /api/nodes/:nodeId/siege/pve/battle-result`（`backend/routes/nodes.js:7888-7963`）。

### 3.2 从点击到结算的完整链路

```mermaid
flowchart TD
  A[App 进攻按钮] --> B[GET /api/nodes/:nodeId/siege/pve/battle-init]
  B --> C[PveBattleModal -> BattleSceneModal]
  C --> D[normalizeUnitTypes]
  D --> E[BattleRuntime(start deploy)]
  E --> F[BattleClock fixed-step]
  F --> G[updateCrowdSim]
  G --> H[updateCrowdCombat + stepProjectiles]
  H --> I[BattleRuntime.getRenderSnapshot]
  I --> J[Ground/Building/Impostor/Projectile/Effect Renderer]
  J --> K{runtime.isEnded?}
  K -- yes --> L[buildBattleSummary]
  L --> M[POST /api/nodes/:nodeId/siege/pve/battle-result]
  M --> N[SiegeBattleRecord.create]
  N --> O[App.handlePveBattleFinished -> fetchSiegeStatus]
```

### 3.3 关键证据点

- battle-init 拉取：`frontend/src/App.js:3194-3199`。
- runtime 启动前 normalize：`frontend/src/components/game/BattleSceneModal.js:551-557`。
- runtime 构造：`BattleSceneModal.js:558-567`。
- 固定步长推进：`BattleClock.js:21-37` + `BattleSceneModal.js:867`。
- 主循环（RAF + render order）：`BattleSceneModal.js:841-935`。
- 战斗结束判断与上报：`BattleSceneModal.js:1011-1016, 811-818`。
- summary 构造：`BattleRuntime.js:1810-1816` + `BattleSummary.js:9-40`。
- 后端结果处理：`battle-result`只做 sanitize + 幂等插入 `SiegeBattleRecord`（`nodes.js:7908-7942`），未重算战斗过程。

### 3.4 结算权威在哪

结论：**胜负/伤亡是前端仿真结果，后端只做记录与基础校验**。

证据：
- 前端调用 `runtime.getSummary()`后直接 POST（`BattleSceneModal.js:1013-1016, 811-818`）。
- 后端 `normalizeBattleResultSide`/`sanitizeBattleResultDetails` 后写库（`nodes.js:3110-3138, 7930-7942`）。
- `battle-result`没有回放重算、没有基于 server sim 的一致性验证。

---

## 4. Unit Types & Normalization (Schema / Mapping / Problems)

### 4.1 权威来源：后端 `ArmyUnitType` schema

文件：`backend/models/ArmyUnitType.js:45-189`

核心字段（含默认/约束）：

- 标识与展示
  - `unitTypeId` (required, unique)
  - `name` (required)
  - `roleTag` (required, enum: `近战/远程`)
  - `description` (default `''`)
  - `tags` (default `[]`)

- 战斗基础数值
  - `speed` (required, min 0)
  - `hp` (required, min 1)
  - `atk` (required, min 0)
  - `def` (required, min 0)
  - `range` (required, min 1)
  - `costKP` (required, min 1)

- 进阶/运营
  - `level` (default 1)
  - `tier` (default 1, min1,max4)
  - `nextUnitTypeId` (default null)
  - `upgradeCostKP` (default null)
  - `sortOrder` (default 0)
  - `enabled` (default true)
  - `rpsType` (default `mobility`)
  - `professionId` (default `''`)
  - `rarity` (default `common`)

- 组件化引用
  - `bodyId`, `weaponIds[]`, `vehicleId`, `abilityIds[]`, `behaviorProfileId`, `stabilityProfileId`

- 表现字段
  - `visuals.battle`：`bodyLayer/gearLayer/vehicleLayer/tint/silhouetteLayer`
  - `visuals.preview`：`style + palette`

- 钩子
  - `pre('validate')`强制 `tier` 与 `level`同步（`ArmyUnitType.js:182-187`）。

### 4.2 前端 normalize 发生点与行为

文件：`frontend/src/game/unit/normalizeUnitTypes.js:46-103`

何时执行：
- 战斗 init 后，`BattleSceneModal.setupRuntime` 先做 normalize（`BattleSceneModal.js:551-557`）。

做了什么：
- 合并 `unitTypeId/id`（`normalizeUnitType`:47-58）。
- 补齐默认、裁剪范围（`speed/hp/atk/def/range/costKP`，`67-77`）。
- 归一 `tier/level`（`48,64-66`）。
- 规范 `visuals/components` 子结构（`11-44, 86-88`）。
- 默认 `enabledOnly=true` 过滤（`91-97`）。

### 4.3 DB → 仿真映射（字段影响）

1. 移动
- `speed`进入 `BattleRuntime.unitTypeMap`（`BattleRuntime.js:87`）→ `CrowdSim.resolveUnitTypeSpeed/computeHarmonicGroupSpeed`（`CrowdSim.js:253-273`）→ leader/agent 速度上限（`CrowdSim.js:951-953, 1756`）。

2. 近战/远程攻击
- `range`用于 `attackRangeBySquad`与 `resolveAttackRange`（`crowdCombat.js:43-51`, `CrowdSim.js:205-212`）。
- `atk`进入伤害基值（`crowdCombat.js:739, 787`）。
- `rpsType`进入三角克制乘子（`crowdCombat.js:27-36, 107-114`）。

3. 防御/HP
- `hp`在 `createSquad`换算 `maxHealth`（`BattleRuntime.js:584-586, 611-613`）。
- `def`参与目标价值与伤害效果（`crowdCombat.js:167-175`，实际减伤偏轻，更多由状态机制和权重驱动）。

4. 表现层
- `visuals.battle.*Layer/tint`映射到实例 buffer（`BattleRuntime.js:712-719, 1982-1987`）。
- `isFlying`从 `components.vehicle.data.isFlying`派生（`BattleRuntime.js:120`），影响 z（`1973,1977`）。

### 4.4 不标准化问题定位（至少 6 条）

1. `id` 与 `unitTypeId`双命名并存
- 后端序列化同时返回（`armyUnitTypeService.js:9-11`）。
- 路由/前端大量兜底 `id || unitTypeId`（`nodes.js:2331-2335`, `normalizeUnitTypes.js:47`）。

2. `tier` 与 `level`双字段并存
- schema 两者都存在并强制同步（`ArmyUnitType.js:92-128, 182-187`）。
- 前后端再次双写（`armyUnitTypeService.js:19-20`, `normalizeUnitTypes.js:48,64-66`）。

3. `classTag`不是权威字段，靠名称/数值推断
- `inferClassFromUnitType`用正则+速度+射程推断（`BattleRuntime.js:126-135`）。
- sim 侧同类推断逻辑重复（`CrowdSim.js:163-173`）。

4. 默认值散落三层
- 后端 serialize 默认（`armyUnitTypeService.js:13-52`）。
- 前端 normalize 默认（`normalizeUnitTypes.js:67-88`）。
- runtime 再补默认（`BattleRuntime.js:87-119`）。

5. 单位 schema 混合“战斗机制 + 展示/目录”
- `ArmyUnitType`同时承载基础战斗值、稀有度、描述、preview 调色、battle 图层（`ArmyUnitType.js:45-175`）。

6. 无单位 schema version / migration 机制
- `ArmyUnitType`没有 `version` 字段（`ArmyUnitType.js`全文件）。
- `UnitComponent`有 `version`（`UnitComponent.js:39-43`），但 unit 本体没有。

7. 类别体系硬编码为四类
- `infantry/cavalry/archer/artillery`贯穿 runtime/sim/UI（`BattleRuntime.js:44-62`, `CrowdSim.js:96-101, 1416-1420`, `BattleSceneModal.js:66-76`）。

8. 战场布局中部署旋转字段前后不一致
- 前端保存 defender deployment 带 `rotation`（`BattlefieldPreviewModal.js:453-467`）。
- 后端 serialize 与 merge 未保留 rotation（`nodes.js:2185-2204, 2299-2316`）。
- 持久化 schema也无该字段（`DomainDefenseLayout.js:146-208`）。

---

## 5. Rendering & Impostors (Why vertical view breaks + how to add top-view sprite)

### 5.1 当前战斗渲染栈

- 技术栈：React + 自研 WebGL2 renderer（非 Three.js 主战斗）。
- 初始化位置：`BattleSceneModal` 创建 `Ground/Building/Impostor/Projectile/Effect`（`BattleSceneModal.js:738-755`）。
- 数据输入：`BattleRuntime.getRenderSnapshot()`输出四类 instance buffer（`BattleRuntime.js:1899-2035`）。
- draw 顺序：ground → building → impostor → projectile → effect（`BattleSceneModal.js:931-935`）。

### 5.2 “垂直视角变线”原因

根因不是贴图资源缺失，而是**几何朝向策略**：

1. `ImpostorRenderer` VS 中面片上方向固定世界 `up=(0,0,1)`，左右方向取 `cameraRight`（`ImpostorRenderer.js:34-35`）。
2. 这会让面片始终竖直站立；当相机接近俯视，看到的是“薄侧面”。
3. `uPitchMix`只在 FS 做颜色增亮（`ImpostorRenderer.js:122`），不切换 top sprite，也不改变 billboard 法向。

### 5.3 增加 top-view sprite 的最小改造切入点（情报级）

1. 资源组织
- 现状：程序化 texture2DArray（`ProceduralTextures.js:86-125`）+ `ImpostorRenderer`采样 layer（`ImpostorRenderer.js:85-89, 116-121`）。
- 最小扩展：在 unit appearance 增加 `spriteFrontLayer/spriteTopLayer` 或 `atlasId + uvTop`。

2. 选择逻辑
- 可复用 `CameraController.getPitchBlend()`（`CameraController.js:280-283`）。
- 在 `BattleSceneModal`已拿到 `pitchMix`并传给 renderer（`BattleSceneModal.js:930-934`）。
- 建议阈值：`pitchMix >= 0.7`切 top；`0.55~0.7`做 front/top blend（避免跳变）。

3. 修改入口
- `ImpostorRenderer.render(cameraState, pitchMix, options)`（`ImpostorRenderer.js:343`）新增 `uViewMode` 或 `uTopBlend`。
- `ImpostorRenderer`实例数据第 14/15 位当前保留（`BattleRuntime.js:1989-1990`）可复用为 topLayer/flags。
- `BattleRuntime.getRenderSnapshot()`写入 appearance 参数（`BattleRuntime.js:1972-1990`）。

4. schema 增量字段建议
- `ArmyUnitType.visuals.battle`增加：
  - `spriteFrontLayer`
  - `spriteTopLayer`
  - `spriteSideLayer`（可选）
  - `spriteMode`（`impostor_array` / `atlas_uv`）
- 对应 normalize 加入白名单（`normalizeUnitTypes.js`）。

### 5.4 minimap 与顶视能力复用

- 已有 minimap 顶视投影（`Minimap.js:25-29`），并绘制建筑矩形旋转（`57-68`）与相机框（`85-92`）。
- 若先做“顶视可读性补丁”，可先在 minimap 或 battle high-pitch 模式引入 top-layer，不必一次重做 3D 模型。

### 5.5 “圆球 + 少量特征”替换切口

你提的目标（sphere + helmet/weapon/color stripe）可从两层落地：

1. 近景（ArmyPanel）
- 当前 closeup 就是 Three.js 几何拼装（`ArmyUnitPreviewCanvases.js:19-47`），直接把 `Capsule`替换为 `Sphere`+头盔/武器 mesh 成本最低。

2. 战场（Impostor）
- 当前用 4 层 body/gear/vehicle/silhouette（`ImpostorRenderer.js:57-65, 366-369`），可把“helmet/weapon/stripe”映射为 layer 语义，不改 draw call 数。

---

## 6. Simulation: Crowd Movement & Combat (Update loop + modules)

### 6.1 Tick 更新入口

- 驱动：`requestAnimationFrame`（`BattleSceneModal.js:841-1023`）。
- 仿真时间步：固定步长 `1/30`（`BattleClock.js:2-5`），`tick`中 accumulator 消耗固定 step（`21-37`）。
- 实际调用：`clock.tick(deltaSec, (fixedStep)=>runtime.step(fixedStep))`（`BattleSceneModal.js:867`）。

### 6.2 Crowd 移动/避障/群集

主函数：`updateCrowdSim(crowd, sim, dt)`（`CrowdSim.js:1533-1854`）。

关键子层：
- 空间哈希：`buildSpatialHash/querySpatialNearby`（`crowdPhysics.js:215-243`）。
- 同队/敌队分离：`computeTeamAwareSeparation`（`CrowdSim.js:325-352`）。
- 领导者移动：`leaderMoveStep`（`CrowdSim.js:933-980`）。
- 障碍规避：`computeAvoidanceDirection + raycastObstacles`（`CrowdSim.js:302-318`, `crowdPhysics.js:163-178`）。
- OBB 推离：`pushOutOfRect`（`crowdPhysics.js:33-58`，应用于 `CrowdSim.js:1813-1817`）。

### 6.3 目标选择与交战

- 近战交战对齐：`syncMeleeEngagement()`每 `updateHz`刷新 pair/lane/anchor（`engagement.js:18-44, 436-550`）。
- 战斗主循环：`updateCrowdCombat()`（`crowdCombat.js:589-816`）。
- 选敌：`pickEnemySquadTarget`（`crowdCombat.js:184-221`）+ agent 层邻域搜索（`242-245`）。
- 近战进入判定：攻击距离 + lane/anchor 约束（`crowdCombat.js:771-784`）。

### 6.4 远程/射弹：仿真与渲染的对应

- 仿真有真实 projectile 实体（不是纯特效）：`acquireProjectile`（`CombatEffects.js:69-78`）。
- 射弹运动与命中：`stepProjectiles`（`crowdCombat.js:546-587`）。
- 爆炸范围与墙体伤害：`detonateProjectile/applyBlastDamageToWalls`（`510-535`, `424-435`）。
- 渲染取 `sim.projectiles`实例缓冲（`BattleRuntime.js:2013-2029`）并由 `ProjectileRenderer` instanced draw（`ProjectileRenderer.js:125-157`）。

### 6.5 冷却/技能命令链

- UI 技能条：`BattleSkillBar`（`frontend/src/game/battle/presentation/ui/BattleSkillBar.js`，由 `BattleSceneModal`调用）。
- 命令入口：`BattleRuntime.commandSkill()`（`BattleRuntime.js:1640-1647`）。
- 真实执行：`triggerCrowdSkill()`（`CrowdSim.js:1408-1531`），维护 `skillCooldowns`四类 CD（`1368-1406`）。

### 6.6 “抽搐/卡住”潜在触发点（代码结构推断）

1. 目标重选频率与 waypoint 注入震荡
- `engagement`会在 blocked ratio 条件下注入 detour waypoint（`engagement.js:518-545`）。
- 与 `updateSquadBehaviorPlan/leaderMoveStep`并行，可能导致方向反复切换。

2. 分离力 + 避障 + 锚点 steering 叠加
- `desiredV = toDesired + sep + avoid + anchorSteer`（`CrowdSim.js:1769-1788`）。
- 多力场叠加在窄道极易产生抖动。

3. 几何推离与速度积分耦合
- 先积分到 `nx/ny`，再 `pushOutOfRect`硬推回（`CrowdSim.js:1811-1817`），会有“贴墙抖”。

4. 攻击与移动状态切换频繁
- `attackCd`、`state`在 agent 层高频跳转（`crowdCombat.js:756-812`），配合 order/guard 可能造成观感 jitter。

5. 随机扩散与冷却随机项
- 远程 `spread/jitter/cooldown`都有随机（`crowdCombat.js:327-336, 811`），稳定性调参难度上升。

---

## 7. Formation & Deployment (Current behavior + reshape feasibility)

### 7.1 当前“创建/部署”行为

- 部署阶段不是展开 soldier slots，而是操作 `deployGroup`中心点与兵力映射。
- `createDeployGroup`存 `{id,name,units,x,y,placed}`（`BattleRuntime.js:894-955`）。
- 开战 `startBattle`才将 group 转 squad（`1186-1246`），再由 `createAgentsForSquad`扩 agent（`CrowdSim.js:862-931`）。

### 7.2 formation 模块输入输出（现状）

`ArmyFormationRenderer`（`frontend/src/game/formation/ArmyFormationRenderer.js`）更多是可视化工具：
- 输入：`countsByType` + `cameraState(renderBudget/shape/facing)`（`339-383, 706-731`）。
- 输出：`instances + footprint`（`1003-1066`）。
- 它可生成 slots 与 footprint，但**战斗 runtime 并未直接使用其 slots 作为权威站位**。

### 7.3 是否支持 width/depth reshape

当前不支持。

缺口分层：
- UI 层：没有“矩形控制柄”交互，只能拖组中心（`BattleSceneModal.js:1396-1426`）。
- 状态层：`deployGroup`无 `width/depth/area`字段（`BattleRuntime.js:944-951`）。
- sim 层：agent slots 由 `createAgentsForSquad`按列数自动生成（`CrowdSim.js:882-907`），不接受外部矩形约束。

### 7.4 面积固定 reshape 公式与落点

建议公式（你给的目标可直接采用）：

- 固定面积 `A = W0 * D0`
- 用户拖拽新宽 `W`，则 `D = A / W`
- 约束：
  - `Wmin <= W <= Wmax`
  - `Dmin <= D <= Dmax`
  - `ratioMin <= W/D <= ratioMax`

slot 重新分配策略（最小可行）：
- 按 `rows = ceil(sqrt(N * D/W))`, `cols = ceil(N/rows)` 生成网格。
- 以 group 中心为锚，保持 `front`方向不变（沿当前朝向）。
- 如果要“前线密度优先”，可对前2行加权分配重装类型。

最合适落地位置：
1. `BattleRuntime.deployGroup`结构新增 `formationRect`（状态真源）。
2. `CrowdSim.createAgentsForSquad()`读取 `formationRect`决定初始 slot offset。
3. `BattleSceneModal`部署 UI 增加 reshape 手柄和约束校验。
4. `ArmyFormationRenderer`用于预览 footprint 与 slots（可复用，不做权威状态）。

---

## 8. Gaps vs. Desired Improvements

### 8.1 改进点 1：兵种数据标准化

- 现状
  - DB/registry/normalize/runtime链路都在，但字段统一性不足。
- 相关代码
  - `ArmyUnitType.js:45-189`
  - `unitRegistryService.js:122-150`
  - `normalizeUnitTypes.js:46-103`
  - `BattleRuntime.js:74-124`
- 缺口
  - 双命名、双等级字段、classTag推断、默认值散落、无 schema version。
- 最小切入点
  - 定义 `UnitTypeDTO v1`（单一 `unitTypeId`、单一 `tier`），在 backend serializer 和 frontend normalize 同步收敛。

### 8.2 改进点 2：表现层替换为“球体+特征”

- 现状
  - 近景：简单几何拼装；战场：billboard impostor。
- 相关代码
  - `ArmyUnitPreviewCanvases.js:19-47, 136-186`
  - `ImpostorRenderer.js:10-69, 343-369`
  - `BattleRuntime.js:698-730, 1972-1990`
- 缺口
  - appearance 参数表达能力有限（仅 4 layer + tint）。
- 最小切入点
  - 扩 `visuals.battle`字段，复用现有 instancing buffer 的保留位传“头盔/武器/条纹”层索引。

### 8.3 改进点 3：顶视可读性（顶部贴图）

- 现状
  - pitch 高时仍是竖向面片，读起来像线。
- 相关代码
  - `ImpostorRenderer.js:34-35, 47-50, 122`
  - `CameraController.js:280-283`
- 缺口
  - 无 top-view sprite 选择逻辑。
- 最小切入点
  - 在 `ImpostorRenderer.render()`按 `pitchMix`切 layer；新增 `spriteTopLayer`。

### 8.4 改进点 4：移动与战斗逻辑优化

- 现状
  - 分层清晰：CrowdSim（移动）/crowdCombat（交战）/engagement（近战对齐）。
- 相关代码
  - `CrowdSim.js:1533-1854`
  - `crowdCombat.js:589-816`
  - `engagement.js:436-550`
- 缺口
  - 多力场叠加、重选目标频率、窄道推离抖动、随机性噪声。
- 最小切入点
  - 先做“调参与观测层”：把分离力/避障/锚点 steer 权重可配置化，再做单因子回归。

### 8.5 改进点 5：部署与阵型 reshape（面积不变）

- 现状
  - 部署阶段只移 group center；agent 展开在开战时才发生。
- 相关代码
  - `BattleRuntime.js:894-955, 1186-1246`
  - `CrowdSim.js:862-931`
  - `BattleSceneModal.js:1396-1426`
- 缺口
  - 缺少宽深参数、手柄交互、slot 重分配策略。
- 最小切入点
  - 给 deployGroup 新增 `formationRect`，在 `createAgentsForSquad`读取并展开。

---

## 9. Appendix

### A) 搜索命令与关键命中

#### A.1 本次勘探命令

```bash
rg -n "siege|battle|pve|combat|attack|projectile|crowd|formation|unit|deploy|occupy|capture|domain" backend frontend docs --glob '!**/build/**'
rg -n "DomainSiege|SiegeBattle|SiegeParticipant|ArmyUnitType|UnitComponent" backend
rg -n "Impostor|billboard|sprite|atlas|texture|top-view|minimap|camera" frontend/src
```

#### A.2 命中规模（来自本地扫描文件）

- `/tmp/pve_rg_cmd1.txt`: 20336 行
- `/tmp/pve_rg_cmd2.txt`: 166 行
- `/tmp/pve_rg_cmd3.txt`: 400 行
- `/tmp/pve_top80_filtered.txt`: 80 行

#### A.3 命中最多文件（节选）

- `backend/routes/nodes.js`（619）
- `frontend/src/components/game/BattleSceneModal.js`（529）
- `frontend/src/App.js`（382）
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`（315）
- `frontend/src/components/game/BattlefieldPreviewModal.js`（290）
- `frontend/src/components/game/KnowledgeDomainScene.js`（246）
- `frontend/src/game/battle/simulation/crowd/CrowdSim.js`（124）
- `backend/routes/army.js`（119）
- `frontend/src/game/battle/simulation/crowd/crowdCombat.js`（110）
- `backend/services/domainTitleStateStore.js`（110）

#### A.4 代表性命中（证明关键路径）

- `frontend/src/App.js:3194` -> GET `/nodes/:nodeId/siege/pve/battle-init`
- `backend/routes/nodes.js:7793` -> `router.get('/:nodeId/siege/pve/battle-init'...)`
- `backend/routes/nodes.js:7888` -> `router.post('/:nodeId/siege/pve/battle-result'...)`
- `frontend/src/components/game/BattleSceneModal.js:553` -> `normalizeUnitTypes(...)`
- `frontend/src/game/battle/presentation/render/ImpostorRenderer.js:34` -> billboard `right`
- `frontend/src/game/battle/presentation/render/ImpostorRenderer.js:122` -> `uPitchMix`仅颜色混合

---

### B) 重要数据结构/接口代码摘录（每段 <= 40 行）

#### B.1 PVE 战斗 init 路由（后端）

```js
// backend/routes/nodes.js:7793-7828
router.get('/:nodeId/siege/pve/battle-init', authenticateToken, async (req, res) => {
  // ...省略校验
  const {
    node,
    user,
    unitTypes,
    unitTypeMap,
    gateSummary
  } = await resolveSiegePveBattleContext({ nodeId, requestUserId, gateKey });

  const battlefieldItemCatalog = await fetchBattlefieldItems({ enabledOnly: true });
  const battlefieldState = resolveNodeBattlefieldLayout(node, {});
  const mergedBattlefieldState = {
    ...battlefieldState,
    items: battlefieldItemCatalog
  };
  const layoutBundle = serializeBattlefieldStateForGate(mergedBattlefieldState, gateKey, '');
  const defenderDeployments = Array.isArray(layoutBundle?.defenderDeployments) ? layoutBundle.defenderDeployments : [];
  // ...下文继续组装 attacker/defender/battlefield
});
```

#### B.2 PVE 战斗结果记录（后端）

```js
// backend/routes/nodes.js:7920-7942
const existing = await SiegeBattleRecord.findOne({ battleId }).select('_id battleId').lean();
if (existing) {
  return res.json({
    success: true,
    battleId: existing.battleId,
    recorded: true,
    duplicate: true
  });
}

await SiegeBattleRecord.create({
  nodeId: node._id,
  gateKey,
  battleId,
  attackerUserId: requestUserId,
  attackerAllianceId: user?.allianceId || null,
  startedAt,
  endedAt,
  durationSec,
  attacker,
  defender,
  details
});
```

#### B.3 单位 schema（后端权威）

```js
// backend/models/ArmyUnitType.js:45-75
const ArmyUnitTypeSchema = new mongoose.Schema({
  unitTypeId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  roleTag: { type: String, enum: ['近战', '远程'], required: true },
  speed: { type: Number, required: true, min: 0 },
  hp: { type: Number, required: true, min: 1 },
  atk: { type: Number, required: true, min: 0 },
  def: { type: Number, required: true, min: 0 },
  range: { type: Number, required: true, min: 1 },
  costKP: { type: Number, required: true, min: 1 },
  level: { type: Number, default: 1, min: 1 },
  // ...
});
```

#### B.4 前端单位 normalize（白名单）

```js
// frontend/src/game/unit/normalizeUnitTypes.js:46-66
export const normalizeUnitType = (unit = {}) => {
  const unitTypeId = toStringId(unit?.unitTypeId || unit?.id);
  const tier = Math.max(1, toInt(unit?.tier ?? unit?.level, 1, 1, 4));
  const range = clampNumber(unit?.range, 1, 1, 9999);
  const roleTag = normalizeRoleTag(unit?.roleTag, range);
  const enabled = unit?.enabled !== false;
  return {
    id: unitTypeId,
    unitTypeId,
    name: toStringId(unit?.name) || unitTypeId || '未知兵种',
    enabled,
    roleTag,
    rpsType: normalizeRpsType(unit?.rpsType),
    professionId: toStringId(unit?.professionId),
    tier,
    level: tier,
    // ...
  };
};
```

#### B.5 战斗循环（固定步长 + 渲染）

```js
// frontend/src/components/game/BattleSceneModal.js:865-935
const nowPhase = runtime.getPhase();
if (nowPhase === 'battle') {
  clockRef.current.tick(deltaSec, (fixedStep) => runtime.step(fixedStep));
}

cameraRef.current.update(deltaSec, followAnchor);
const cameraState = cameraRef.current.buildMatrices(sceneCanvas.width, sceneCanvas.height);

const snapshot = runtime.getRenderSnapshot();
renderers.ground.setFieldSize(field?.width || 900, field?.height || 620);
renderers.ground.setDeployRange(runtime.getDeployRange());
renderers.building.updateFromSnapshot(snapshot.buildings);
renderers.impostor.updateFromSnapshot(snapshot.units);
renderers.projectile.updateFromSnapshot(snapshot.projectiles);
renderers.effect.updateFromSnapshot(snapshot.effects);

gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
const pitchMix = cameraRef.current.getPitchBlend();
renderers.ground.render(cameraState);
renderers.building.render(cameraState, pitchMix);
renderers.impostor.render(cameraState, pitchMix);
renderers.projectile.render(cameraState);
renderers.effect.render(cameraState);
```

#### B.6 Billboard 顶视问题根因

```glsl
// frontend/src/game/battle/presentation/render/ImpostorRenderer.js:34-50
vec3 right = normalize(vec3(uCameraRight.x, uCameraRight.y, 0.0));
vec3 up = vec3(0.0, 0.0, 1.0);

vec2 quad = aQuadPos;
if (uApplyYaw > 0.5) {
  float c = cos(iData1.x);
  float s = sin(iData1.x);
  quad = vec2(
    (aQuadPos.x * c) - (aQuadPos.y * s),
    (aQuadPos.x * s) + (aQuadPos.y * c)
  );
}

vec3 world = base;
world += right * (quad.x * size);
world += up * (quad.y * size * 1.92);
```

#### B.7 `uPitchMix`仅颜色混合

```glsl
// frontend/src/game/battle/presentation/render/ImpostorRenderer.js:116-123
if (uUseTexArray > 0.5) {
  float layer = floor(vSlice + 0.5);
  layer = clamp(layer, 0.0, max(0.0, uTexLayerCount - 1.0));
  vec4 texel = texture(uTexArray, vec3(vUv, layer));
  color = mix(color, texel.rgb, clamp(texel.a, 0.0, 1.0) * 0.72);
}
color = mix(color, color * 1.18, clamp(uPitchMix, 0.0, 1.0) * 0.18);
```

#### B.8 CrowdSim 主更新入口

```js
// frontend/src/game/battle/simulation/crowd/CrowdSim.js:1533-1550
export const updateCrowdSim = (crowd, sim, dt) => {
  if (!crowd || !sim || sim.ended) return;
  const safeDt = Math.max(0.001, Number(dt) || 0.016);
  sim.timeElapsed = Math.max(0, Number(sim?.timeElapsed) || 0) + safeDt;
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((w) => !w?.destroyed) : [];

  crowd.allAgents = [];
  crowd.agentsBySquad.forEach((agents, squadId) => {
    const filtered = (Array.isArray(agents) ? agents : []).filter((agent) => agent && !agent.dead && (agent.weight || 0) > 0.001);
    crowd.agentsBySquad.set(squadId, filtered);
    crowd.allAgents.push(...filtered);
  });
  const spatial = buildSpatialHash(crowd.allAgents, 14);
  crowd.spatial = spatial;
  syncMeleeEngagement(crowd, sim, walls, safeDt, Number(sim?.timeElapsed) || 0);
  // ...
};
```

#### B.9 Combat + projectile + building damage

```js
// frontend/src/game/battle/simulation/crowd/crowdCombat.js:589-606
export const updateCrowdCombat = (sim, crowd, dt) => {
  const safeDt = Math.max(0, Number(dt) || 0);
  const damageExponent = Math.max(0.2, Math.min(1.25, Number(sim?.repConfig?.damageExponent) || 0.75));
  const squads = Array.isArray(sim?.squads) ? sim.squads : [];
  // ...
  const walls = Array.isArray(sim?.buildings) ? sim.buildings.filter((wall) => wall && !wall.destroyed) : [];
  const engagementEnabled = crowd?.engagement ? !!crowd.engagement.enabled : isMeleeEngagementEnabled();
  const engagementCfg = crowd?.engagement?.config || getMeleeEngagementConfig();
  // ...
  stepProjectiles(sim, crowd, safeDt);
};
```

```js
// frontend/src/game/battle/simulation/crowd/crowdCombat.js:412-421
const applyDamageToBuilding = (sim, wall, damage = 0) => {
  if (!wall || wall.destroyed) return false;
  const actual = Math.max(0.6, Number(damage) || 0);
  wall.hp = Math.max(0, (Number(wall.hp) || 0) - actual);
  if (wall.hp <= 0 && !wall.destroyed) {
    wall.destroyed = true;
    sim.destroyedBuildings = Math.max(0, Number(sim.destroyedBuildings) || 0) + 1;
    return true;
  }
  return false;
};
```

#### B.10 Defender deployment rotation 丢失点

```js
// backend/routes/nodes.js:2189-2204
const units = normalizeDefenderDeploymentUnits(item);
return {
  id: typeof item?.deployId === 'string' ? item.deployId : '',
  deployId: typeof item?.deployId === 'string' ? item.deployId : '',
  layoutId: typeof item?.layoutId === 'string' ? item.layoutId : '',
  name: typeof item?.name === 'string' ? item.name : '',
  sortOrder: Math.max(0, Math.floor(Number(item?.sortOrder) || 0)),
  placed: item?.placed !== false,
  units,
  unitTypeId: primary.unitTypeId,
  count: primary.count,
  x: round3(item?.x, 0),
  y: round3(item?.y, 0)
};
```

```js
// frontend/src/components/game/BattlefieldPreviewModal.js:453-467
defenderDeployments: sanitizeDefenderDeployments(defenderDeployments).map((item) => ({
  deployId: item.deployId,
  // ...
  x: roundTo(item.x, 3),
  y: roundTo(item.y, 3),
  rotation: roundTo(normalizeDefenderFacingDeg(item?.rotation), 3)
}))
```

---

### C) API 列表（method/path/request/response）

| Method | Path | 主要请求字段 | 主要响应字段 | 前端调用方 |
|---|---|---|---|---|
| GET | `/api/nodes/:nodeId/siege` | `gate/participants`相关 query | 围城状态、可参战门、参与者分页 | `App` 围城状态刷新（`frontend/src/App.js`） |
| GET | `/api/nodes/:nodeId/siege/battlefield-preview` | `gateKey` | `layoutBundle`（隐藏 defenderDeployments） | `App.handleOpenSiegeBattlefieldPreview` (`App.js:3118-3163`) |
| GET | `/api/nodes/:nodeId/siege/pve/battle-init` | `gateKey` | `battleId,nodeId,unitTypes,attacker,defender,battlefield` | `App.handleOpenSiegePveBattle` (`App.js:3174-3218`) |
| POST | `/api/nodes/:nodeId/siege/pve/battle-result` | `battleId,gateKey,durationSec,attacker,defender,details,startedAt,endedAt` | `success,battleId,recorded,duplicate?` | `BattleSceneModal.reportBattleResult` (`BattleSceneModal.js:801-830`) |
| GET | `/api/nodes/:nodeId/battlefield-layout` | `gateKey,layoutId` | `layoutBundle,defenderRoster,canEdit/canView` | `BattlefieldPreviewModal` (`2391-2429`) |
| PUT | `/api/nodes/:nodeId/battlefield-layout` | `gateKey,layout,itemCatalog,objects,defenderDeployments` | `layoutBundle` | `BattlefieldPreviewModal.persistBattlefieldLayout` (`2103-2203`) |
| GET | `/api/army/unit-types` | 无 | `unitTypes[]` | `ArmyPanel` (`frontend/src/components/game/ArmyPanel.js:205`) |
| GET | `/api/army/training/init` | Bearer token | 训练模式 battle init（含 `unitTypes` 与无限库存） | 训练相关入口（`backend/routes/army.js:332-395`） |
| GET | `/api/army/me` | Bearer token | `knowledgeBalance, roster` | `KnowledgeDomainScene`等 |
| GET/POST/PUT/DELETE | `/api/admin/army/unit-types` | unitType CRUD payload | 管理端 unitType 结果 | 管理后台/脚本 |
| GET/POST/PUT/DELETE | `/api/admin/unit-components` | component CRUD payload | 管理端 component 结果 | 管理后台/脚本 |

---

## 附：本次审计中的“攻占战斗 vs 布防编辑”边界定义

- **攻占战斗（改造目标）**：
  - UI: `PveBattleModal` / `BattleSceneModal`
  - API: `/siege/pve/battle-init`, `/siege/pve/battle-result`
  - Runtime: `BattleRuntime + CrowdSim + crowdCombat + renderers`

- **布防编辑（容易误改）**：
  - UI: `BattlefieldPreviewModal`（Three.js + 2D overlay）
  - API: `/battlefield-layout`, `/siege/battlefield-preview`
  - 作用：编辑障碍与守军部署，不执行 PVE 仿真结算

