# UNIT_ADD_UPDATE_VALIDATION

## Executive Summary
结论：**可以新增/更新兵种并自动流转到兵营、训练营、PVE 战场初始化**，但当前实现是“**数据可扩展，行为半硬编码**”。

- 已具备 DB 模型、seed/init、admin API（含 CRUD）与组件模型（`UnitComponent` + registry 展开）。
- 新兵种数据会通过 `/api/army/unit-types`、`/api/army/training/init`、`/api/nodes/:nodeId/siege/pve/battle-init` 下发到前端并进入 `BattleRuntime`。
- 关键限制：战斗技能/行为/UI 图标大量依赖固定四类 `infantry/cavalry/archer/artillery`；未知扩展字段在前端 normalize 时会被丢弃；渲染层存在 64 layer 上限。
- 运维风险：目录初始化与 registry “兜底生成”包含全量替换/重置逻辑，不是纯增量迁移。

## Capability Matrix (A1~C3)
| ID | 结论 | 证据路径 |
|---|---|---|
| A1 | YES | `backend/models/ArmyUnitType.js:45-177`（主 Schema）；`backend/models/ArmyUnitType.js:110`（`enabled`）；`backend/models/ArmyUnitType.js:142-175`（组件引用+visuals 扩展字段） |
| A2 | YES | `backend/scripts/initCatalogAndUnitData.js:59-91`（`upsertByKey`）；`backend/scripts/initCatalogAndUnitData.js:67-70`（`replace` 时 delete+insert，重复执行不重复） |
| A3 | YES | `backend/routes/admin.js:790-892`（unit type CRUD）；`backend/server.js:86`（挂载 `/api/admin`）；`backend/routes/admin.js:803-860`（新增/更新入参出参） |
| A4 | NO | 有 `enabled`（`backend/models/ArmyUnitType.js:110`）与组件 `version`（`backend/models/UnitComponent.js:39`），但无 unitType 版本链/迁移机制；且存在物理删除（`backend/routes/admin.js:879`） |
| B1 | YES | `frontend/src/components/game/ArmyPanel.js:204-243`（`/army/unit-types` + `normalizeUnitTypes`） |
| B2 | YES | `backend/routes/army.js:332-395`（training init 返回 `unitTypes`）；`frontend/src/components/game/TrainingGroundPanel.js:33-63`（消费 init） |
| B3 | YES | `backend/routes/nodes.js:3141-3203`（battle context 拉 `fetchEnabledUnitTypes`）；`backend/routes/nodes.js:7793-7854`（battle-init 返回 `unitTypes`）；`frontend/src/App.js:3165-3189`（拉取 battle-init） |
| B4 | YES | `frontend/src/game/unit/normalizeUnitTypes.js:56-88`（白名单返回结构）；`frontend/src/game/unit/types.js:25-35`（未知 `rps/rarity` 回退默认） |
| B5 | YES | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:50-62`（固定技能类）；`.../BattleRuntime.js:126-134`（class 推断仅四类）；`frontend/src/game/battle/simulation/crowd/CrowdSim.js:1416-1420`（技能 kind 限四类） |
| C1 | YES | `backend/models/UnitComponent.js:14-44` |
| C2 | YES | `backend/services/unitRegistryService.js:94-106`（组装 `components`）；`backend/services/unitRegistryService.js:122-150`（registry DTO） |
| C3 | YES | `backend/routes/army.js:14-17` + `322-325`（`/api/army/unit-types` 走 registry）；`backend/services/unitRegistryService.js:133-138`（每个 unit 带 `components`） |

## 0) 核查目标逐条结论（YES/NO）
### 目标 A：DB 持久化新增/更新兵种
- A1 YES：有 `ArmyUnitType` 模型，字段覆盖统计、成长、上架状态、组件引用、视觉配置。
  - 证据：`backend/models/ArmyUnitType.js:45-177`
- A2 YES：有 seed/init 脚本，重复执行不会重复插入同 key。
  - 证据：`backend/scripts/initCatalogAndUnitData.js:59-91`
  - 备注：unit 采用 `replace: true`，属于“幂等但覆盖式”。
- A3 YES：有 admin API CRUD；有前端 admin 页调用这些 API。
  - 证据：`backend/routes/admin.js:790-892`，`frontend/src/components/admin/AdminPanel.js:639-783`
- A4 NO：仅具备 `enabled` 开关与组件 version；缺少 unitType 版本化/迁移保留链路。
  - 证据：`backend/models/ArmyUnitType.js:110`，`backend/models/UnitComponent.js:39`，`backend/routes/admin.js:867-883`

### 目标 B：新增/更新后前端与战斗系统自动识别
- B1 YES：兵营来源是 API，不是前端常量。
  - 证据：`frontend/src/components/game/ArmyPanel.js:204-243`
- B2 YES：训练营 init 含后端下发 `unitTypes`。
  - 证据：`backend/routes/army.js:332-395`
- B3 YES：围城 PVE battle-init 含后端下发 `unitTypes`。
  - 证据：`backend/routes/nodes.js:7793-7854`
- B4 YES（存在限制）：前端 normalize 是白名单，未知扩展字段会被丢弃/降级，不会直接报错。
  - 证据：`frontend/src/game/unit/normalizeUnitTypes.js:56-88`
- B5 YES（存在限制）：战斗仿真与 UI/技能存在固定四类 hardcode，阻碍“任意新兵种范式”。
  - 证据：`frontend/src/game/battle/presentation/runtime/BattleRuntime.js:50-62,126-134`；`frontend/src/game/battle/simulation/crowd/CrowdSim.js:1416-1420`；`frontend/src/game/battle/presentation/ui/SquadCards.js:5-10`

### 目标 C：组件化新增路线
- C1 YES：存在 `UnitComponent` 模型。
- C2 YES：存在 `unitRegistryService` 组装 DTO。
- C3 YES：`/api/army/unit-types` 返回 unit + 展开 components。
- 现状判定：**“单表兵种 + 组件引用增强”的混合模式**；并非全链路组件驱动（技能/行为仍有硬编码）。

## 1) 调研范围覆盖结果
### backend/models
- `ArmyUnitType`：兵种主数据 + 生命周期 + 视觉 + 组件引用。`backend/models/ArmyUnitType.js`
- `User`：`armyRoster/armyTemplates` 持久化引用 `unitTypeId`，支持新兵种进入玩家编组。`backend/models/User.js:122-146,388-395`
- Catalog 相关：`BattlefieldItem`、`CityBuildingType` 由训练/战场使用。`backend/models/BattlefieldItem.js`、`backend/models/CityBuildingType.js`
- 组件模型：`UnitComponent`。`backend/models/UnitComponent.js`

### backend/routes
- `/api/army/unit-types`：公开兵种列表。`backend/routes/army.js:322-325`
- `/api/army/training/init`：训练初始化（含 unitTypes）。`backend/routes/army.js:332-395`
- `/api/nodes/:nodeId/siege/pve/battle-init`：PVE 开战初始化（含 unitTypes）。`backend/routes/nodes.js:7793-7854`
- `/api/admin/*`：兵种/组件/目录 CRUD。`backend/routes/admin.js:790-978`

### backend/scripts / backend/seed
- 目录初始化：`backend/scripts/initCatalogAndUnitData.js`
- 兵种工厂与 patch：`backend/seed/unitCatalogFactory.js`
- patch 数据入口：`backend/seed/bootstrap_catalog_data.json`
- npm 命令：`backend/package.json` 中 `init:catalog`

### frontend/components
- 兵营：`frontend/src/components/game/ArmyPanel.js`
- 训练营：`frontend/src/components/game/TrainingGroundPanel.js`
- 战场：`frontend/src/components/game/BattleSceneModal.js` + `PveBattleModal.js` + `App.js`

### frontend unitTypes 获取方式
- 兵营：直接 fetch `/army/unit-types`，本地 state 缓存。`ArmyPanel.js:73,204-243`
- 训练：每次打开 fetch `/army/training/init`。`TrainingGroundPanel.js:23-47`
- 围城战斗：打开时 fetch `/nodes/.../battle-init`。`App.js:3145-3189`
- 防守布置面板（域场景）：按需 fetch `/army/unit-types` + `/army/me`。`KnowledgeDomainScene.js:1442-1477`

### 战斗仿真/渲染对 unitTypes 的使用
- `BattleRuntime`：按 unitTypes 构建 map，读取 `speed/hp/atk/def/range`，并读取 `components.behaviorProfile/stabilityProfile`。`BattleRuntime.js:74-124,543-583`
- `CrowdSim/crowdCombat/engagement`：行为和技能主要按 `classTag` 四类分支。`CrowdSim.js`、`crowdCombat.js`、`engagement.js`
- `ImpostorRenderer/ProceduralTextures`：纹理数组层数固定（64）。`BattleSceneModal.js:743-747`，`ProceduralTextures.js:88-105`

## Current Data Flow
```text
MongoDB
  ├─ ArmyUnitType (+ UnitComponent 可选)
  └─ User.armyRoster / defense layout refs
      ↓
backend/services/unitRegistryService.fetchUnitTypesWithComponents()
  - ensureGeneratedCatalog() (可能触发重置)
  - expand components
      ↓
API
  - GET /api/army/unit-types
  - GET /api/army/training/init
  - GET /api/nodes/:nodeId/siege/pve/battle-init
      ↓
Frontend
  - ArmyPanel / TrainingGroundPanel / App(PveBattleModal)
  - normalizeUnitTypes (白名单归一化)
      ↓
Battle
  - BattleRuntime(unitTypeMap)
  - CrowdSim / crowdCombat / engagement
  - ImpostorRenderer + ProceduralTextures
```

## 2) “新增一个兵种”的三条可执行流程
### 路径 1：纯 DB 方式（可行）
可行性：**可行**。

1. 写入集合：
- 必需：`armyunittypes`（`ArmyUnitType`）
- 可选：`unitcomponents`（若要组件化行为/外观）
- 若要“马上能参战”：更新 `users.armyRoster`（给新 `unitTypeId` 数量）或对应守军布置数据。

2. `ArmyUnitType` 最小字段（建议）：
- `unitTypeId`, `name`, `roleTag`, `speed`, `hp`, `atk`, `def`, `range`, `costKP`, `enabled`
- 建议同时给：`rpsType`, `tier/level`, `sortOrder`, `professionId`, `rarity`

3. 缺字段风险：
- 缺 `enabled:true`（尤其绕过 Mongoose 默认直接插入）会被 `enabled` 过滤挡掉。
- `roleTag/rpsType` 异常时前端/战斗会回退默认，表现可能不符合预期。
- 组件引用 ID 不存在时不会直接崩，但会拿到 `null/[]` 组件。

4. 是否能被 API 读出：
- 能，走 `fetchUnitTypesWithComponents({ enabledOnly: true })`。
  - 证据：`backend/routes/army.js:14-17,322-325`

5. 新增后可见页面：
- 兵营：重新打开兵营或触发 `fetchArmyData`。
- 训练营：重新进入训练场（会重新请求 init）。
- 战场：重新发起 battle-init。

### 路径 2：seed/init 脚本方式（可行，需谨慎）
可行性：**可行，但有覆盖风险**。

1. 修改文件：
- `backend/seed/bootstrap_catalog_data.json`
  - `unitComponents`（新增组件）
  - `unitTypesPatch.unitTypes`（新增/覆盖 unit）
  - `unitTypesPatch.removeUnitTypeIds`（移除）
- 证据：`backend/seed/unitCatalogFactory.js:541-563`

2. 运行脚本：
- `cd backend && npm run init:catalog`
- 证据：`backend/package.json`、`backend/scripts/initCatalogAndUnitData.js`

3. 幂等性：
- 重复执行不会重复插入（会重建同一结果）。
- 证据：`initCatalogAndUnitData.js:67-70,105-106`

4. 覆盖风险：
- `replace: true` 会 `deleteMany({}) + insertMany(...)`，会覆盖现有兵种/组件目录。
- 线上已有手工修改/运营变更可能被抹平。

5. 新增后可见页面：
- 同路径 1（兵营/训练营/战场重新拉取即可）。

### 路径 3：admin API 方式（可行）
可行性：**API 可行；后台页面可编辑但创建表单字段与后端要求不完全对齐**。

1. endpoints：
- `GET /api/admin/army/unit-types`
- `POST /api/admin/army/unit-types`
- `PUT /api/admin/army/unit-types/:unitTypeId`
- `DELETE /api/admin/army/unit-types/:unitTypeId`
- `GET/POST/PUT/DELETE /api/admin/unit-components/:componentId?`

2. 鉴权：
- 需要 `Authorization: Bearer <token>` 且 `isAdmin`。
- 证据：`backend/routes/admin.js:790,803,830,867`（均挂 `authenticateToken, isAdmin`）

3. `POST` 示例请求体（满足后端 create 校验）：
```json
{
  "unitTypeId": "u_custom_demo_t1",
  "name": "自定义演示兵",
  "roleTag": "近战",
  "speed": 2.2,
  "hp": 180,
  "atk": 28,
  "def": 12,
  "range": 1,
  "costKP": 18,
  "rpsType": "mobility",
  "tier": 1,
  "enabled": true,
  "sortOrder": 999
}
```

4. 返回体：
- `{ success: true, unitType: { ... } }`
- 证据：`backend/routes/admin.js:820-823,857-860`

5. 前台页面可见性：
- API 写入后，兵营/训练/战场按各自 init 请求刷新即可。
- 注：当前 `AdminPanel` 的 unitType 表单未提供 `rpsType/enabled/components` 等字段，且 create payload 未带 `rpsType`，可能导致“页面新增失败但 API 可用”。
  - 证据：`AdminPanel.js:684-704` + `admin.js:159-161`

## 3) Gaps & Minimal Patch Plan（建议，不改代码）
1. 缺口：catalog 自动兜底会触发“重置式覆盖”
- 描述：`fetchUnitTypesWithComponents` 调用 `ensureGeneratedCatalog`，当统计不达阈值时会删除并重建目录。
- 建议修改：
  - `backend/services/unitRegistryService.js`
  - 函数：`ensureGeneratedCatalog`, `resetToGeneratedCatalog`, `isNewCatalogReady`
  - 建议：改为一次性 migration 标记，不在运行时自动 delete+insert。
- 风险：影响目录初始化流程，需处理首次部署。

2. 缺口：admin 页面创建兵种与后端校验不一致
- 描述：后端创建要求 `rpsType`，页面 payload 未提交该字段。
- 建议修改：
  - `frontend/src/components/admin/AdminPanel.js`
  - 函数：`createEmptyUnitTypeForm`, `buildUnitTypePayload`, `validateUnitTypeForm`, unitTypes 表单 UI
  - 建议：补 `rpsType/enabled/tier/professionId/rarity/component refs/visuals` 字段。
- 风险：需与现有接口字段兼容验证。

3. 缺口：缺少 unitType 版本化与软下线优先策略
- 描述：存在 physical delete，缺少 unitType 版本链与历史兼容策略。
- 建议修改：
  - `backend/models/ArmyUnitType.js`（新增 `version/status/replacedBy`）
  - `backend/routes/admin.js`（删除改为软下线）
  - `backend/routes/army.js`, `backend/routes/nodes.js`（按状态过滤）
- 风险：涉及历史 roster 与战报回放兼容。

4. 缺口：前端 normalize 白名单会吞掉扩展字段
- 描述：未知字段不会传入战斗侧。
- 建议修改：
  - `frontend/src/game/unit/normalizeUnitTypes.js`
  - 建议：保留 `extra` 字段透传，或引入 schema-versioned passthrough。
- 风险：增大前端数据面，需控制不可信字段。

5. 缺口：战斗技能/行为强依赖四类 classTag
- 描述：新增“全新兵种范式”仍会被映射到 infantry/cavalry/archer/artillery。
- 建议修改：
  - `BattleRuntime.js`, `CrowdSim.js`, `crowdCombat.js`, `engagement.js`, `SquadCards.js`, `AimOverlayCanvas.js`
  - 建议：用 `unitType/ability component` 驱动技能与行为，减少 `if classTag===...` 分支。
- 风险：战斗平衡与表现回归范围大。

6. 缺口：渲染纹理层数硬上限
- 描述：程序纹理和 impostor layer 当前按 64 固定。
- 建议修改：
  - `frontend/src/components/game/BattleSceneModal.js`
  - `frontend/src/game/battle/presentation/assets/ProceduralTextures.js`
  - `frontend/src/game/battle/presentation/render/ImpostorRenderer.js`
  - 建议：根据 catalog 动态分配 layer 或建立 atlas/分页策略。
- 风险：显存占用与低端设备兼容性。

7. 缺口：部分节点路由仍走 `fetchArmyUnitTypes`（不含组件展开）
- 描述：战斗 init 已走 registry，但其他围城/布防路径存在非展开读取，数据能力不一致。
- 建议修改：
  - `backend/routes/nodes.js` 内多处 `fetchArmyUnitTypes()` 调用点
  - 建议：统一走 `fetchEnabledUnitTypes()` 或增加明确 DTO 层。
- 风险：响应体变更需联调前端。

## 4) 综合结论
- **能新增/更新并自动生效到兵营/训练营/战场初始化（YES）**。
- **不等于完整“组件化内容系统”**：当前更接近“可配置目录 + 四类战斗内核”。
- 若目标是“持续新增新职业/新技能/新交互规则且无需改战斗代码”，仍有关键缺口（B4/B5 与补丁建议 4/5）。

## Search Hits（关键 30 条）
| # | file:line | hit | 用途 |
|---|---|---|---|
| 1 | `backend/models/ArmyUnitType.js:45` | `new mongoose.Schema` | 兵种主模型存在 |
| 2 | `backend/models/ArmyUnitType.js:110` | `enabled` | 上下架字段 |
| 3 | `backend/models/ArmyUnitType.js:142` | `bodyId` | 组件引用字段 |
| 4 | `backend/models/ArmyUnitType.js:166` | `visuals` | 战斗/预览视觉扩展 |
| 5 | `backend/models/UnitComponent.js:14` | `UnitComponentSchema` | 组件化模型存在 |
| 6 | `backend/models/UnitComponent.js:39` | `version` | 组件版本字段 |
| 7 | `backend/services/unitRegistryService.js:94` | `buildExpandedComponents` | 组装组件 DTO |
| 8 | `backend/services/unitRegistryService.js:122` | `fetchUnitTypesWithComponents` | 统一 registry 出口 |
| 9 | `backend/services/unitRegistryService.js:42` | `deleteMany({})` | 运行时重置风险 |
| 10 | `backend/scripts/initCatalogAndUnitData.js:59` | `upsertByKey` | init 幂等实现 |
| 11 | `backend/scripts/initCatalogAndUnitData.js:67` | `replace` | 覆盖式导入逻辑 |
| 12 | `backend/scripts/initCatalogAndUnitData.js:105` | `replace: true` | unitTypes 全量替换 |
| 13 | `backend/seed/unitCatalogFactory.js:541` | `applyUnitPatch` | seed patch 合并入口 |
| 14 | `backend/seed/unitCatalogFactory.js:560` | `removeUnitTypeIds` | seed 删除策略 |
| 15 | `backend/server.js:89` | `app.use('/api/army', armyRoutes)` | 路由挂载 |
| 16 | `backend/routes/army.js:322` | `router.get('/unit-types'` | 兵种 API |
| 17 | `backend/routes/army.js:332` | `router.get('/training/init'` | 训练 init API |
| 18 | `backend/routes/nodes.js:3141` | `resolveSiegePveBattleContext` | PVE 上下文构建 |
| 19 | `backend/routes/nodes.js:3157` | `fetchEnabledUnitTypes()` | battle-init 使用启用兵种 |
| 20 | `backend/routes/nodes.js:7793` | `battle-init` | 围城 PVE 初始化 |
| 21 | `backend/routes/admin.js:790` | `GET /army/unit-types` | admin 读取兵种 |
| 22 | `backend/routes/admin.js:803` | `POST /army/unit-types` | admin 新增兵种 |
| 23 | `backend/routes/admin.js:830` | `PUT /army/unit-types/:unitTypeId` | admin 更新兵种 |
| 24 | `backend/routes/admin.js:867` | `DELETE /army/unit-types/:unitTypeId` | admin 删除兵种 |
| 25 | `backend/routes/admin.js:159` | `缺少字段：rpsType` | 创建校验要求 |
| 26 | `frontend/src/components/game/ArmyPanel.js:205` | `fetch('/army/unit-types')` | 兵营数据来源 |
| 27 | `frontend/src/components/game/TrainingGroundPanel.js:33` | `fetch('/army/training/init')` | 训练营数据来源 |
| 28 | `frontend/src/App.js:3165` | `fetch('/nodes/.../battle-init')` | 战场数据来源 |
| 29 | `frontend/src/game/unit/normalizeUnitTypes.js:56` | `return { ... }` | 白名单 normalize |
| 30 | `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:50` | `SKILL_CLASS_ORDER` | 固定四类技能内核 |
