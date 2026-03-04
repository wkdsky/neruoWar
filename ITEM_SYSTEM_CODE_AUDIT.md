# ITEM_SYSTEM_CODE_AUDIT

> 审计方式：仅基于本地仓库代码静态审计（未联网、未改代码）  
> 仓库：`/home/wkd/neruoWar`  
> 范围：items/props/objects/buildings/battlefield layout/battle runtime/sim/render

---

## 1. 物品系统概览

### 1.1 关键目录/文件树

```text
backend/
  models/
    BattlefieldItem.js              # 战场物品目录（catalog）
    CityBuildingType.js             # 城防建筑目录（catalog）
    DomainDefenseLayout.js          # 战场布局与实例（objects/items/deployments）
    Node.js                         # 旧/兼容城防布局入口（cityDefenseLayout）
    User.js                         # 用户兵力（armyRoster），无 itemInventory
  routes/
    admin.js                        # /api/admin/catalog/items|buildings CRUD
    army.js                         # /api/army/training/init 下发 itemCatalog
    nodes.js                        # /api/nodes/* battlefield-layout/preview/battle-init
  services/
    placeableCatalogService.js      # 目录读取与序列化
    domainTitleStateStore.js        # battlefield 状态归一化、合并、落库
  scripts/
    initCatalogAndUnitData.js       # catalog 初始化（item/building upsert）
  seed/
    bootstrap_catalog_data.json     # 初始 battlefieldItems/cityBuildingTypes

frontend/src/
  components/game/
    BattlefieldPreviewModal.js      # 战场布置核心（选物品/吸附/旋转/堆叠/保存）
    KnowledgeDomainScene.js         # 入口：打开 BattlefieldPreviewModal
    TrainingGroundPanel.js          # 调 /army/training/init
    BattleSceneModal.js             # 战斗主场景，消费 battle-init
  components/admin/
    AdminPanel.js                   # 管理后台 item/building 目录 CRUD
  game/battle/presentation/runtime/
    BattleRuntime.js                # itemCatalog+objects -> buildings obstacle runtime
  game/battle/simulation/crowd/
    crowdPhysics.js                 # OBB/LoS/raycast
    crowdCombat.js                  # 投射物命中墙体、墙体掉血/摧毁
    CrowdSim.js                     # 技能/移动与墙体约束
  game/battle/presentation/render/
    BuildingRenderer.js             # 建筑实例化渲染
    ImpostorRenderer.js             # 单位实例化渲染（texture2DArray）
    ProjectileRenderer.js           # 投射物实例化渲染（texture2DArray）
    EffectRenderer.js               # 特效实例化渲染（texture2DArray）
  game/battle/presentation/ui/
    Minimap.js                      # 小地图绘制旋转矩形建筑
    AimOverlayCanvas.js             # 技能目标叠加层
  components/game/unit/
    ArmyUnitPreviewCanvases.js      # 现有可复用近景3D/战场impostor预览能力（单位）
```

### 1.2 命名体系（本项目真实概念名）

| 概念名 | 在本项目中的真实含义 | 典型位置 |
|---|---|---|
| `item` / `BattlefieldItem` | 战场可放置物品类型目录（木墙、拒马） | `backend/models/BattlefieldItem.js` |
| `building` / `CityBuildingType` | 城内建筑目录（哨塔等，非战场墙体实例） | `backend/models/CityBuildingType.js` |
| `object` / `battlefieldObjects` | 战场物品实例（坐标/旋转/层级），即“已放置对象” | `DomainDefenseLayout.battlefieldObjects` |
| `wall` | 前端/仿真里对战场 object 的运行时称呼（含拒马等） | `BattlefieldPreviewModal.js`, `BattleRuntime.js`, `crowdCombat.js` |
| `obstacle` | 战斗仿真碰撞/LoS 的障碍抽象（由 objects+catalog 组装） | `BattleRuntime.buildObstacleList`, `crowdPhysics.js` |
| `layoutBundle` | 后端下发给前端的战场布局包（layout/itemCatalog/objects/defenderDeployments） | `backend/routes/nodes.js` |
| `prop/props/terrainFeature/structure` | **未形成独立一套数据模型**（代码中无对应 ItemType/Instance 模块） | 全局搜索未见独立实现 |

---

## 2. 数据库：物品目录与物品实例（非常关键）

### 2.1 与物品相关的 Model 文件

1. 物品类型目录
- `backend/models/BattlefieldItem.js`

2. 建筑类型目录（同属 placeable 体系）
- `backend/models/CityBuildingType.js`

3. 物品实例/布局承载
- `backend/models/DomainDefenseLayout.js`  
  说明：没有独立 `ItemInstance` collection，实例嵌在 `battlefieldObjects`。

4. 旧/兼容布局入口
- `backend/models/Node.js` 的 `cityDefenseLayout`（当前 schema 仅城防建筑，不再声明 battlefield* 字段；服务层仍兼容读取旧数据）

5. 用户库存相关
- `backend/models/User.js`：仅 `armyRoster/armyTemplates`，**无** `itemInventory/propsInventory` 字段。

### 2.2 schema 字段清单（必填/默认/索引/上下架）

#### A) `BattlefieldItem`（catalog）

```ts
BattlefieldItem {
  // required
  itemId: string (unique)
  name: string
  width: number [12,360]
  depth: number [12,360]
  height: number [10,360]
  hp: number >=1
  defense: number >=0.1

  // default
  initialCount: number = 0
  style: mixed = {}
  sortOrder: number = 0
  enabled: boolean = true

  // timestamps
  createdAt, updatedAt
}
```

索引：
- `itemId` unique（字段定义）
- `sortOrder + createdAt` 复合索引（`BattlefieldItemSchema.index`）

下架字段：
- 有 `enabled`，`fetchBattlefieldItems({ enabledOnly: true })` 会过滤。

#### B) `CityBuildingType`（catalog）

```ts
CityBuildingType {
  // required
  buildingTypeId: string (unique)
  name: string

  // default
  initialCount: number = 0
  radius: number = 0.17
  level: number = 1
  nextUnitTypeId: string = ''
  upgradeCostKP: number | null = null
  style: mixed = {}
  sortOrder: number = 0
  enabled: boolean = true

  // timestamps
  createdAt, updatedAt
}
```

索引：
- `buildingTypeId` unique（字段定义）
- `sortOrder + createdAt` 复合索引

#### C) `DomainDefenseLayout`（布局+实例）

```ts
DomainDefenseLayout {
  nodeId: ObjectId (required, unique index)

  // 城防（城市内）
  buildings: CityBuilding[]
  intelBuildingId: string
  gateDefense: { cheng: UnitCount[], qi: UnitCount[] }
  gateDefenseViewAdminIds: ObjectId[]

  // 兼容旧字段
  battlefieldLayout: {
    version, fieldWidth, fieldHeight,
    objects[], defenderDeployments[], updatedAt
  }

  // 新战场结构（当前主用）
  battlefieldLayouts: BattlefieldLayoutMeta[]
  battlefieldObjects: BattlefieldObject[]   // 实例：layoutId/objectId/itemId/x/y/z/rotation
  battlefieldDefenderDeployments: BattlefieldDefenderDeployment[]
  battlefieldItems: BattlefieldItemLite[]   // 快照化 itemCatalog（itemId/name/size/hp/defense）

  updatedAt, updatedBy, timestamps
}
```

索引：
- `nodeId` unique
- `updatedAt`  
- `gateDefenseViewAdminIds + updatedAt`

版本/上下架字段：
- 布局有 `version`（state 级）
- catalog 上下架依赖 `BattlefieldItem.enabled` / `CityBuildingType.enabled`

### 2.3 “目录 catalog”与“用户拥有 inventory”的真实存储

结论：
1. **目录（可放置类型）**：Mongo `BattlefieldItem` / `CityBuildingType`。  
2. **实例（具体摆放）**：`DomainDefenseLayout.battlefieldObjects`（按 node + layout 维度）。  
3. **用户拥有数量**：没有独立 item inventory；当前通过 catalog 的 `initialCount` + 保存接口校验来限制每类可放数量（`PUT /api/nodes/:nodeId/battlefield-layout`）。  
4. **训练场特例**：`/api/army/training/init` 把 `itemCatalog.initialCount` 覆盖成 `MAX_TEMPLATE_UNIT_COUNT`，用于无限练习。

用户默认物品数量来源：
- 初始来自 `backend/seed/bootstrap_catalog_data.json`（例如 `wood_wall.initialCount=10`）。
- 后续可由 admin CRUD 新增目录项并设置 `initialCount`。
- 未见“购买道具/掉落入库”链路。

### 2.4 样例文档（按当前 schema/seed 推导）

#### 样例1：`battlefielditems`（catalog）

```json
{
  "itemId": "wood_wall",
  "name": "木墙",
  "initialCount": 10,
  "width": 104,
  "depth": 24,
  "height": 42,
  "hp": 240,
  "defense": 1.1,
  "style": { "color": "#8b6a3f", "material": "wood" },
  "sortOrder": 0,
  "enabled": true,
  "createdAt": "2026-03-03T00:00:00.000Z",
  "updatedAt": "2026-03-03T00:00:00.000Z"
}
```

#### 样例2：`citybuildingtypes`（catalog）

```json
{
  "buildingTypeId": "watch_tower",
  "name": "哨塔",
  "initialCount": 3,
  "radius": 0.17,
  "level": 1,
  "nextUnitTypeId": "",
  "upgradeCostKP": null,
  "style": { "color": "#94a3b8", "icon": "tower" },
  "sortOrder": 0,
  "enabled": true,
  "createdAt": "2026-03-03T00:00:00.000Z",
  "updatedAt": "2026-03-03T00:00:00.000Z"
}
```

#### 样例3：`domaindefenselayouts`（布局+实例）

```json
{
  "nodeId": "65f0c4d4f9d0c2a8d4e11234",
  "battlefieldLayouts": [
    {
      "layoutId": "cheng_default",
      "name": "承门战场",
      "gateKey": "cheng",
      "fieldWidth": 900,
      "fieldHeight": 620,
      "maxItemsPerType": 10,
      "updatedAt": "2026-03-03T00:00:00.000Z"
    }
  ],
  "battlefieldItems": [
    {
      "itemId": "wood_wall",
      "name": "木墙",
      "width": 104,
      "depth": 24,
      "height": 42,
      "hp": 240,
      "defense": 1.1
    }
  ],
  "battlefieldObjects": [
    {
      "layoutId": "cheng_default",
      "objectId": "obj_1",
      "itemId": "wood_wall",
      "x": -120,
      "y": 40,
      "z": 0,
      "rotation": 90
    }
  ],
  "battlefieldDefenderDeployments": [],
  "updatedAt": "2026-03-03T00:00:00.000Z"
}
```

#### 样例4：`users`（说明“无物品库存字段”）

```json
{
  "_id": "65f0c4d4f9d0c2a8d4e15555",
  "username": "demo",
  "armyRoster": [{ "unitTypeId": "infantry_t1", "count": 120 }],
  "armyTemplates": []
}
```

---

## 3. 后端 API：获取/保存/布置/战斗初始化

### 3.1 与物品相关 endpoints（method + path）

#### 目录管理（Admin，需 Bearer + isAdmin）
- `GET /api/admin/catalog/items`
- `POST /api/admin/catalog/items`
- `PUT /api/admin/catalog/items/:itemId`
- `DELETE /api/admin/catalog/items/:itemId`
- `GET /api/admin/catalog/buildings`
- `POST /api/admin/catalog/buildings`
- `PUT /api/admin/catalog/buildings/:buildingTypeId`
- `DELETE /api/admin/catalog/buildings/:buildingTypeId`

#### 运营/战场流程
- `GET /api/army/training/init`（返回 `battlefield.itemCatalog`）
- `GET /api/nodes/:nodeId/defense-layout`（返回 `buildingCatalog` + 城防布局）
- `PUT /api/nodes/:nodeId/defense-layout`（保存城防布局）
- `GET /api/nodes/:nodeId/battlefield-layout`（返回 `layoutBundle`）
- `PUT /api/nodes/:nodeId/battlefield-layout`（保存布局，校验 itemId 与数量）
- `GET /api/nodes/:nodeId/siege/battlefield-preview`（围城预览，隐藏 defenderDeployments）
- `GET /api/nodes/:nodeId/siege/pve/battle-init`（围城战 init，全量 battlefield）

补充：
- `GET /api/army/unit-types` 仅兵种，不下发 itemCatalog。

### 3.2 每个 endpoint 的入参/出参 + 前端调用位置

| Endpoint | 入参关键点 | 出参关键点 | 前端调用 |
|---|---|---|---|
| `GET /api/admin/catalog/items` | Header: `Authorization: Bearer <token>` | `{ success, items[] }` | `frontend/src/components/admin/AdminPanel.js:822` |
| `POST /api/admin/catalog/items` | body: `itemId,name,initialCount,width,depth,height,hp,defense,sortOrder,enabled,style` | `{ success, item }` | `AdminPanel.js:922-933` |
| `PUT /api/admin/catalog/items/:itemId` | body 同上（无 itemId） | `{ success, item }` | `AdminPanel.js:924-933` |
| `DELETE /api/admin/catalog/items/:itemId` | path param | `{ success, message }` | `AdminPanel.js:955` |
| `GET /api/admin/catalog/buildings` | 同 admin auth | `{ success, buildings[] }` | `AdminPanel.js:980` |
| `POST/PUT/DELETE /api/admin/catalog/buildings*` | 类似 buildingType payload | `{ success, building/message }` | `AdminPanel.js:1088+` |
| `GET /api/army/training/init` | Bearer token | `battlefield.itemCatalog`（`initialCount` 被放大为训练上限） | `TrainingGroundPanel.js:33` |
| `GET /api/nodes/:nodeId/defense-layout` | token + nodeId | `buildingCatalog, layout` | `KnowledgeDomainScene.js`（城防管理） |
| `PUT /api/nodes/:nodeId/defense-layout` | `layout.buildings/gateDefense...` | 保存后回 layout+buildingCatalog | `KnowledgeDomainScene.js` |
| `GET /api/nodes/:nodeId/battlefield-layout?gateKey=...` | token + nodeId + gateKey | `layoutBundle{activeLayout,layouts,itemCatalog,objects,defenderDeployments}` | `BattlefieldPreviewModal.js:2391` |
| `PUT /api/nodes/:nodeId/battlefield-layout` | body: `gateKey/layout/itemCatalog/objects/defenderDeployments` | `{ success,message,layoutBundle }` | `BattlefieldPreviewModal.js:2133` |
| `GET /api/nodes/:nodeId/siege/battlefield-preview` | token + nodeId + gateKey | `layoutBundle`（`defenderDeployments=[]`） | `App.js:3138` |
| `GET /api/nodes/:nodeId/siege/pve/battle-init` | token + nodeId + gateKey | `battlefield{itemCatalog,objects,defenderDeployments,...}` | `App.js:3194` |

权限证据：
- Bearer 解析：`backend/middleware/auth.js`
- admin 校验：`backend/middleware/admin.js` (`user.role === 'admin'`)
- admin 路由挂载：`backend/server.js` `app.use('/api/admin', adminRoutes)`

### 3.3 是否存在 registry/assembler

有，但不是 unitRegistry 那种独立 ItemRegistry：
1. `backend/services/placeableCatalogService.js`
- 负责目录读取与序列化（`fetchBattlefieldItems/fetchCityBuildingTypes`）。

2. `backend/services/domainTitleStateStore.js`
- 负责布局状态的 normalize/merge/upsert（`normalizeBattlefieldState`, `upsertNodeBattlefieldState`）。

3. `backend/routes/nodes.js`
- 通过 `serializeBattlefieldStateForGate / mergeBattlefieldStateByGate` 组装 API 读写结构。

---

## 4. 前端：布置战场的交互与算法现状

### 4.1 布置界面位置与交互

入口：
- `KnowledgeDomainScene` -> `BattlefieldPreviewModal`（域主管理）
- `App` -> `BattlefieldPreviewModal`（围城情报只读预览，`canEdit=false`）

核心交互：
- 物品选择：`pickPaletteItem`
- 放置预览（ghost）：`ghost` state + `syncGhostByMouse`
- 旋转：滚轮 `ROTATE_STEP=7.5`，顶部吸附时可锁旋转
- 拖拽移动已有物品：`startMoveWall`
- 堆叠：`z` 层，`MAX_STACK_LEVEL=5`

### 4.2 吸附/叠加/组合/边缘对齐实现

关键函数与参数：
- `getRectContactMetrics` + `isRectOverlap`：SAT 矩形重叠
- `hasCollision`：同 z 层碰撞判定
- `solveMagneticSnap`：
  - 顶部吸附（top stack）
  - 侧边吸附（right/left/front/back）
  - 边界吸附（edge-left/right/top/bottom）
  - `SNAP_EPSILON=1.2`
  - `snapRadius = min(width,depth)*1.4`

组合/连通度：
- `getWallGroupMetrics`：先两两建邻接，再 BFS 分组，复杂度 O(n²)。

当前“特例点”（仅 1~2 种视觉范式）：
- `buildWallMesh` 里仅对 `style.shape === 'cheval_de_frise'`（拒马）走专门几何分支；其余全部退化为通用 box。  
- 即：渲染层面对“复杂可组合构件”还没有通用组件化建模。

### 4.3 Ghost / 碰撞 / 吸附候选搜索

- Ghost：有，且标记 blocked/reason（`collision/out_of_bounds/stack_limit`）。
- 碰撞：OBB/SAT 同层判定 + 越界钳制。
- 吸附候选搜索：当前是遍历 `walls` 的近邻几何判断，**未使用**空间哈希/网格索引（编辑端）。

### 4.4 保存/加载与回显

保存链路：
- `buildLayoutPayload` -> `PUT /api/nodes/:nodeId/battlefield-layout`
- 失败时写本地缓存并标记 `needsSync`

加载链路：
- 优先 server：`GET /api/nodes/:nodeId/battlefield-layout?gateKey=...`
- 回退 localStorage：`battlefield_layout_cache_v2:*`
- 回显：`mapLayoutBundleToWalls` + `mapLayoutBundleToDefenderDeployments`

---

## 5. 战斗/仿真：物品对部队/投射物的交互

### 5.1 物品是否参与碰撞

是。路径：
- `BattleRuntime.buildObstacleList` 把 `battlefield.itemCatalog + objects` 组装为 `sim.buildings`。
- `crowdPhysics.js` 提供旋转矩形碰撞与射线：
  - `isInsideRotatedRect`
  - `lineIntersectsRotatedRect`
  - `raycastObstacles`
  - `hasLineOfSight`

### 5.2 可破坏（hp/armor/伤害）

已实现：
- 墙体属性：`maxHp/hp/defense/destroyed`
- 伤害：`applyDamageToBuilding`
- 投射物扫掠命中墙：`detectWallSweepHit`
- 爆炸 AoE 伤墙：`applyBlastDamageToWalls`
- 摧毁计数：`sim.destroyedBuildings`

### 5.3 交互能力矩阵（草丛/陷阱/弹反/掩体）

| 机制 | 现状 | 代码位置与结论 |
|---|---|---|
| 草丛隐蔽（conceal） | ❌ | 未见物品 `conceal` 字段、隐蔽态状态机或 visibility mask 逻辑 |
| 陷阱触发（trap） | ❌ | 未见 trap item 触发器/触发半径/一次性消耗；仅有通用战斗伤害逻辑 |
| 硬直/打断（stagger） | 🟡 | 已有通用硬直 `triggerSquadStagger`，但由战斗稳定度触发，不是“踩陷阱触发” |
| 弹反/反射投射物（reflect/parry） | ❌ | 未见 projectile 反射路径（改向/反弹）；当前是 hit/detonate |
| 掩体/LoS 阻挡（cover/LoS） | ✅(基础) | `hasLineOfSight` 与 `blockedByWall` 可阻挡射线/范围命中 |

### 5.4 事件系统（enter/exit/hit/destroy）

- 没有统一事件总线（如 `emit('item:hit')/subscribe`）供玩法系统订阅。
- 当前实现模式是“直接改 sim state + effect pool”：
  - 命中 -> 改 `wall.hp/destroyed`
  - 视觉反馈 -> `acquireHitEffect` 写入池

---

## 6. 渲染：战场贴图与近景3D预览

### 6.1 战场渲染（WebGL2）

#### 建筑（物品实例）
- `BuildingRenderer`：instanced 渲染，`BUILDING_INSTANCE_STRIDE=8`
- per-instance attributes：
  - `x, y, width, depth, height, rotation, hpRatio, destroyed`
- 绘制：`drawArraysInstanced` 单批提交

#### 单位/投射物/特效
- 单位 `ImpostorRenderer`：instanced + `sampler2DArray`，每帧 4 层绘制（body/gear/vehicle/silhouette）
- 投射物 `ProjectileRenderer`：instanced + 可选 `sampler2DArray`
- 特效 `EffectRenderer`：instanced + 可选 `sampler2DArray`
- 程序贴图：`createBattleProceduralTextures`，`unitLayerCount=64`

#### 小地图
- `Minimap` 将建筑作为旋转矩形绘制（读 `snapshot.buildings`）

### 6.2 近景预览能力（3D）

现状：
1. 已有“单位”预览能力：
- `ArmyCloseupThreePreview`（Three.js 近景转台）
- `ArmyBattleImpostorPreview`（战场 impostor 风格）

2. “物品”暂无独立近景预览组件：
- 目前仅在 `BattlefieldPreviewModal` 的场景内实时渲染（含 ghost）。

可复用建议（最小改动）：
- 复用 `BattlefieldPreviewModal.buildWallMesh` 的样式分支做 Item Turntable。  
- 或复用 `ArmyCloseupThreePreview` 组件骨架，替换 mesh 生成函数为 item mesh。

---

## 7. 扩展性评估：支持“百余种物品”的最小改动

### 7.1 当前是否已分离“类型库 + 实例库”

是，已具备基础分离：
- 类型库：`BattlefieldItem`（catalog）
- 实例库：`DomainDefenseLayout.battlefieldObjects`

但有两个现实约束：
1. `domainTitleStateStore` 中 `BATTLEFIELD_ITEM_LIMIT=12`（会截断 catalog）。
2. 前端视觉分支目前是“拒马特例 + 其余盒子”，对百种差异化物品不足。

### 7.2 若要支持 sockets（柱子搭板子）

当前状态：
- 没有 `anchor/attach/socket` 数据结构。
- 布置吸附是几何推导，不保存“连接关系”。

最小落点：
1. Schema
- `BattlefieldItem` 增 `sockets[]`（局部坐标、法线、类型）
- `battlefieldObjects` 增 `attachToObjectId/attachToSocketId/localOffset`

2. 放置逻辑
- 在 `solveMagneticSnap` 新增 socket 候选搜索（建议加空间网格，避免 O(n²)）

3. 保存结构
- `buildLayoutPayload` / `mergeBattlefieldStateByGate` / `normalizeBattlefieldObjects` 透传 attach 字段

4. 运行时约束
- `BattleRuntime.buildObstacleList` 将 attach 后 world transform 固化进 obstacle

### 7.3 若要把 interactions（conceal/trap/reflect）组件化

当前缺口：
- item 目录只有几何与耐久字段，无 interaction schema。
- 战斗循环没有 item-interaction processor。

最小可行方案（MVP）：
1. 数据层
- `BattlefieldItem` 增 `interactions: [{ type, params }]`

2. 运行时
- 在 `BattleRuntime.buildObstacleList` 注入 interaction 元数据
- 在 `updateCrowdSim / updateCrowdCombat / stepProjectiles` 按 type 执行：
  - `conceal`: 修改 LoS/可见性判定
  - `trap`: 进入触发半径后一次性伤害+stagger
  - `reflect`: projectile 命中时改向并换队伍

3. 可视层
- `EffectRenderer` 增 trap/reflect 反馈层
- `AimOverlayCanvas` 增 interaction 范围调试绘制

---

## 8. 面向 ChatGPT 的摘要（实施导向）

### 8.1 如果要实现：socket吸附/叠加/组合/破坏/草丛/陷阱/弹反/百种物品持久化，关键改哪些文件？

后端（数据与接口）：
1. `backend/models/BattlefieldItem.js`
- 新增 socket/interactions 字段。

2. `backend/models/DomainDefenseLayout.js`
- `BattlefieldObjectSchema` 增 attach 关系字段。

3. `backend/services/domainTitleStateStore.js`
- `normalizeBattlefieldItems/normalizeBattlefieldObjects` 透传新字段。
- 放宽 `BATTLEFIELD_ITEM_LIMIT`（当前 12）。

4. `backend/routes/admin.js`
- `parseBattlefieldItemPayload` 支持新字段校验。

5. `backend/routes/nodes.js`
- `serialize/merge battlefield state` 透传 attach/interactions。
- 保存时增加 interaction/sockets 级约束校验。

前端（编辑器与战斗）：
1. `frontend/src/components/game/BattlefieldPreviewModal.js`
- `normalizeItemCatalog` 扩展字段白名单。
- `solveMagneticSnap` 增 socket 规则。
- `buildLayoutPayload/mapLayoutBundleToWalls` 透传 attach。

2. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
- `buildObstacleList` 注入 interaction 元数据。

3. `frontend/src/game/battle/simulation/crowd/CrowdSim.js`
- 处理 conceal/trap 的进入判定与状态效果。

4. `frontend/src/game/battle/simulation/crowd/crowdCombat.js`
- 处理 reflect（投射物命中障碍后的反射分支）、trap 触发伤害。

5. `frontend/src/game/battle/presentation/render/BuildingRenderer.js`
- 若百种视觉差异大，考虑 typeId/atlasKey 进实例属性。

### 8.2 现有可复用基础

可直接复用：
1. 几何/碰撞
- OBB 命中、raycast、LoS (`crowdPhysics.js`)。

2. 仿真空间查询
- `buildSpatialHash/querySpatialNearby`（战斗内已有）。

3. 渲染批处理
- 建筑/单位/投射物/特效均有 instancing 方案。

4. 持久化机制
- battle layout 已有 GET/PUT + 本地缓存离线回写机制。

5. 预览能力
- 已有 Three/WebGL2 预览框架（单位预览可改造为物品预览）。

### 8.3 最危险性能风险点

1. 编辑端 O(n²)
- `getWallGroupMetrics` 双循环建图；`solveMagneticSnap` 逐物体候选遍历。
- 百物品+频繁拖动时会出现卡顿。

2. 编辑场景 draw/对象数
- `BattlefieldPreviewModal` 当前为每个物品创建多个 Three mesh（尤其拒马含大量子 mesh），非 instancing。

3. 战斗端“agents x walls”热点
- `CrowdSim` 和 `crowdCombat` 中多处对 `walls` 线性遍历（pushOut、raycast、爆炸伤墙）。

4. 字段白名单丢失
- `normalizeItemCatalog` 未纳入新字段会被前端静默丢弃，导致“配置有值但运行时无效”。

---

## 附录：Search Hits（40条）

| # | 命中 | 说明 |
|---|---|---|
| 1 | `backend/models/BattlefieldItem.js:3` `BattlefieldItemSchema` | 战场物品目录 schema 入口 |
| 2 | `backend/models/BattlefieldItem.js:4` `itemId` | 物品主键（unique） |
| 3 | `backend/models/BattlefieldItem.js:56` `enabled` | 目录上下架字段 |
| 4 | `backend/models/CityBuildingType.js:3` `CityBuildingTypeSchema` | 城防建筑目录 schema 入口 |
| 5 | `backend/models/CityBuildingType.js:4` `buildingTypeId` | 建筑目录主键（unique） |
| 6 | `backend/models/CityBuildingType.js:48` `enabled` | 建筑上下架字段 |
| 7 | `backend/models/DomainDefenseLayout.js:104` `BattlefieldObjectSchema` | 战场物品实例结构 |
| 8 | `backend/models/DomainDefenseLayout.js:146` `BattlefieldDefenderDeploymentSchema` | 战场守军部署结构 |
| 9 | `backend/models/DomainDefenseLayout.js:391` `battlefieldObjects` | 物品实例存储字段 |
|10| `backend/models/DomainDefenseLayout.js:399` `battlefieldItems` | 物品目录快照字段 |
|11| `backend/models/DomainDefenseLayout.js:416` `index({ nodeId:1 }, unique)` | 每 node 一份布局文档 |
|12| `backend/models/User.js:388` `armyRoster` | 用户侧仅兵力库存，无 itemInventory |
|13| `backend/services/placeableCatalogService.js:43` `fetchBattlefieldItems` | 目录读取服务（enabledOnly） |
|14| `backend/services/domainTitleStateStore.js:14` `BATTLEFIELD_ITEM_LIMIT = 12` | catalog 上限硬编码 |
|15| `backend/services/domainTitleStateStore.js:259` `normalizeBattlefieldItems` | item catalog 归一化 |
|16| `backend/services/domainTitleStateStore.js:318` `normalizeBattlefieldObjects` | objects 归一化 |
|17| `backend/services/domainTitleStateStore.js:437` `normalizeBattlefieldState` | 战场状态总归一化 |
|18| `backend/services/domainTitleStateStore.js:939` `upsertNodeBattlefieldState` | 战场状态落库 |
|19| `backend/routes/admin.js:980` `GET /catalog/items` | admin 物品目录查询 |
|20| `backend/routes/admin.js:993` `POST /catalog/items` | admin 物品创建 |
|21| `backend/routes/admin.js:1019` `PUT /catalog/items/:itemId` | admin 物品更新 |
|22| `backend/routes/admin.js:1051` `DELETE /catalog/items/:itemId` | admin 物品删除 |
|23| `backend/routes/nodes.js:7360` `GET /:nodeId/battlefield-layout` | 战场布局读取 |
|24| `backend/routes/nodes.js:7445` `PUT /:nodeId/battlefield-layout` | 战场布局保存 |
|25| `backend/routes/nodes.js:7494` `counter` | 保存时按 itemId 做数量校验 |
|26| `backend/routes/nodes.js:7704` `/siege/battlefield-preview` | 围城只读预览接口 |
|27| `backend/routes/nodes.js:7793` `/siege/pve/battle-init` | 围城战 init 下发 battlefield |
|28| `backend/routes/army.js:332` `/training/init` | 训练场下发 itemCatalog |
|29| `frontend/src/components/game/BattlefieldPreviewModal.js:360` `normalizeItemCatalog` | 前端白名单归一化 |
|30| `frontend/src/components/game/BattlefieldPreviewModal.js:548` `getRectContactMetrics` | SAT 接触/重叠度量 |
|31| `frontend/src/components/game/BattlefieldPreviewModal.js:684` `solveMagneticSnap` | 磁吸/堆叠核心算法 |
|32| `frontend/src/components/game/BattlefieldPreviewModal.js:1016` `getWallGroupMetrics` | 连通分组（O(n²)） |
|33| `frontend/src/components/game/BattlefieldPreviewModal.js:2133` `PUT /api/nodes/.../battlefield-layout` | 前端保存调用 |
|34| `frontend/src/components/game/BattlefieldPreviewModal.js:2391` `GET /api/nodes/.../battlefield-layout` | 前端加载调用 |
|35| `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:50` `SKILL_CLASS_ORDER` | 技能 classTag 仅四类 |
|36| `frontend/src/game/battle/simulation/crowd/CrowdSim.js:1416` `skillKind ... infantry/cavalry/archer/artillery` | 技能分派硬编码四类 |
|37| `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:180` `hasLineOfSight` | 墙体 LoS 阻挡 |
|38| `frontend/src/game/battle/simulation/crowd/crowdCombat.js:412` `applyDamageToBuilding` | 墙体掉血/摧毁 |
|39| `frontend/src/game/battle/presentation/render/BuildingRenderer.js:8` `BUILDING_INSTANCE_STRIDE = 8` | 建筑实例化数据布局 |
|40| `frontend/src/components/game/unit/ArmyUnitPreviewCanvases.js:50` `ArmyCloseupThreePreview` | 可复用近景3D预览能力 |

