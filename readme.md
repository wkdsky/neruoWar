pm2 status
pm2 stop
pm2 delete backend frontends
cd /home/wkd/neruoWar/backend
pm2 start server.js --name backend

cd /home/wkd/neruoWar/frontend
pm2 start npm --name frontend -- start

47.121.137.149:38088

游戏性设计启发：将常见的会让玩家明显带来收益或明显具有习惯性动作的操作可以绑定到一起

用户职业系统：
求知：普通职业，一注册就给
卫道：域主和武斗官
问道：
秩序：管理员专属职业

用户（非秩序）所在地及移动

域主+域相

域主拥有建设知识域的完全权限：它决定了知识点的生产力
盟主拥有分配知识域资源的完全权限：它决定了知识点资源分配给哪些用户


用户从知识域吸收知识点的功能：
域主首先公布一个知识点分发公告（这个在管理知识域模块中），这个公告是告诉所有用户，当前知识域会在某年某月某日某时（目前仅设置到整数小时位置）把知识域目前积累的知识点全部或部分地分发出去。分发为按规则的一次性分发，规则由域主设立，以下是详细描述：
固定的规则是：
     1）域主获得的百分比X%（默认为10%）
     2）域相总共可获得的百分比Y%（每个人具体多少可以由域主单独设置）
     3）贡献给域主所属熵盟（如果有）的百分比Z%（由盟主在熵盟管理中设置，创建时默认为10%）
     4）与域主所在熵盟（如果有）处于敌对状态的熵盟成员（系统自动设置，优先级最高）不可获取（固定为0%）
可自定义的允许获得知识点的用户：
     1）域主搜索一个用户，然后指定其获得的百分比B%；
     2）与域主所在熵盟（如果有）不敌对的熵盟的成员总共可获得的百分比D%
     3）指定熵盟的成员总共可获得的百分比E%
     4）没有熵盟的用户总共可获得的百分比F%
可自定义的不允许获得知识点的用户：
     1）域主的黑名单用户（域主改变时黑名单自动更换）
     2）域主的黑名单熵盟（域主改变时黑名单自动更换）
最后，固定和自定义规则的分配加起来不能超过100%，如上面示例中 X+Y+Z+B+D+E+F<=100%，如果<100%，则剩下的部分不分配，累计到下一次分配的总知识点中。

域主可以设置一周内分配知识点的时刻（每周最少一次，例如每周三16点），设置后，公告将提前24小时（这个时间由系统管理员设置，记得加到管理员面版中）发布到首页的公告栏中（发布到公告栏后，当前的规则就不能变了，如果域主这个时候修改规则，则只能在下一次分发时才能生效。每个公告针对不同的用户给出一个他预计最多可以获得多少知识点的数，这个数你要结合两个部分计算，一个是，在分发的那个时刻，那个知识域能够分配的总的知识点有多少，然后是对应该用户的身份，根据域主制定的分发规则，他能分配到多少，最后计算出来。如果用户没点开的公告，用new! 作为提示。

然后，用户需在域主分配知识点那个时刻之前到达对应的知识域，除固定规则外，自定义规则中的用户都只针对到达了该要分发知识点的知识域的用户，也就是如果一个规则中，针对一类群体，但是最后符合这类群体的只有一个用户到达了，那么他能吃下属于该类群体规则的总百分比的知识点，如果没有用户，则该部分不分发，累计到下一次。

用户收到分发的知识点后，存入其个人账户中。

------------------------------
脚本归档说明（2026-02-22）
------------------------------

本项目 backend/scripts 下的脚本属于人工执行的运维/迁移工具，不是后端服务运行时依赖。

已归档删除：
1) backend/scripts/resetAllDataAndBootstrapAdmin.js
   - 作用：清空数据库并重建管理员
   - 处理：已删除，同时移除了 backend/package.json 中的 reset-all-data-bootstrap-admin 命令
2) backend/scripts/migrateProfession.js
   - 作用：历史职业字段一次性迁移
   - 处理：已删除
3) backend/scripts/removeNameUniqueIndex.js
   - 作用：历史移除 Node.name 唯一索引
   - 处理：已删除

当前保留脚本用途见：
backend/scripts/README.md

codex --sandbox workspace-write \
  --ask-for-approval never \
  -c sandbox_workspace_write.network_access=true \
  -c features.use_linux_sandbox_bwrap=true

codex支持：
sandbox_mode = "workspace-write"   # 允许在当前项目内写文件/改代码
# sandbox_mode = "read-only"       # 如果你只想让它读，不想改文件

[sandbox_workspace_write]
network_access = false             # 需要联网再改成 true

[features]
use_linux_sandbox_bwrap = false

同时在~/.bashrc 加入：
export codez=""

------------------------------
pm2命令：
------------------------------
  - 普通启动：bash ./start.sh
  - 强制重置管理员后启动：./start.sh --force-reset-admin
  - 清空知识域后启动：./start.sh --clear-domains
  - 两者同时：./start.sh --clear-domains --force-reset-admin

pm2 restart neurowar-backend neurowar-frontend

git remote set-url origin https://github.com/wkdsky/neruoWar.git
git config --global --unset http.proxy
git config --global --unset https.proxy



------------------------------
PVE攻占部署流程（当前实现约束）
------------------------------

1. 兵种不等于部队
- 兵种是 `unitType`（如词刃卒、句锋骑等）
- 部队是一个可编组对象，部队内可包含多个兵种及其数量

2. 部署初始状态
- 进入攻占战斗时，攻击方默认没有任何已创建部队卡片
- 未创建并放置至少一个攻击方部队时，不允许开战

3. 新建部队流程（编辑期）
- 点击“新建部队”打开部队编组弹窗
- 弹窗使用数量输入（数字输入框）配置每个兵种数量
- 点击“确定编组”后才生成部队卡片

4. 新建后放置流程
- 新建成功后，该部队会进入“吸附鼠标”状态
- 用户移动鼠标可预览位置，点击地图完成放置
- 放置完成后该部队状态变为可参战

5. 部队操作按钮（仅编辑部队阶段）
- 点击上方部队卡片：在卡片下方显示“移动 / 编辑 / 删除”
- 点击地图上的部队：在旗手头顶附近显示“移动 / 编辑 / 删除”
- 移动：部队重新吸附鼠标，可再次放置
- 编辑：重新打开部队编组弹窗，按部队维度编辑兵种数量
- 删除：删除该部队及其部队卡片

## 兵种内容运营与扩展（UnitType Workflow）

### 0. TL;DR（给运营/开发的快速选择）
- 开发期批量导入（本地/测试）：用 `seed-init`（`cd backend && npm run init:catalog`）。
- 正常运营期线上增量：用 `admin API`（`/api/admin/army/unit-types` + `/api/admin/unit-components`）。
- 紧急排障/临时验证：用 `DB直写`（直接写 Mongo 集合，事后补回正规流程）。
- 一句话风险提示：
  - `seed-init` 是 replace 模式，会 `deleteMany + insertMany`，可覆盖线上人工改动（`backend/scripts/initCatalogAndUnitData.js`）。
  - 运行时 `registry` 有“数量不足自动重建”逻辑（`typedCount >= 36 && enabledCount >= 36`），低于阈值会触发重置（`backend/services/unitRegistryService.js`）。
  - 现有 Admin 前端兵种表单字段偏旧，不含 `rpsType/enabled/tier`，可能“页面创建失败但 API 可用”（`frontend/src/components/admin/AdminPanel.js` + `backend/routes/admin.js`）。

### 1. 术语与数据流（本项目真实链路）

术语与存储：
- MongoDB 主数据：
  - `ArmyUnitType`：兵种目录（`backend/models/ArmyUnitType.js`）。
  - `User.armyRoster`：用户拥有兵力（`backend/models/User.js`）。
  - `UnitComponent`：组件库（`backend/models/UnitComponent.js`）。
- 后端 registry：
  - `fetchUnitTypesWithComponents()`（`backend/services/unitRegistryService.js`）。
  - 该服务会把组件引用展开到 `unitTypes[].components`。

下发端点（都下发 `unitTypes`）：
- `GET /api/army/unit-types`（兵营）：`backend/routes/army.js`。
- `GET /api/army/training/init`（训练营）：`backend/routes/army.js`，响应里显式包含 `unitTypes`。
- `GET /api/nodes/:nodeId/siege/pve/battle-init`（PVE 初始化）：`backend/routes/nodes.js`，响应里显式包含 `unitTypes`。

前端消费点：
- 兵营：`frontend/src/components/game/ArmyPanel.js`（调用 `/api/army/unit-types`）。
- 训练营：`frontend/src/components/game/TrainingGroundPanel.js`（调用 `/api/army/training/init`）。
- 围城战斗：`frontend/src/App.js`（调用 `/api/nodes/:nodeId/siege/pve/battle-init`）+ `BattleSceneModal`。
- 归一化入口：`normalizeUnitTypes`（`frontend/src/game/unit/normalizeUnitTypes.js`）。

关键事实（代码证据）：
- `admin API` 存在且要求 `Bearer token + isAdmin`：
  - Bearer 解析：`backend/middleware/auth.js`（`Authorization` 取 token）。
  - 管理员校验：`backend/middleware/admin.js`（`user.role === 'admin'`）。
  - 路由：`backend/routes/admin.js`（`/army/unit-types`、`/unit-components`）。
- `enabled` 用于上下架过滤：
  - 后端查询条件：`enabledOnly ? { enabled: true } : {}`（`backend/services/unitRegistryService.js`、`backend/services/armyUnitTypeService.js`）。
  - 前端也会按 `enabled` 过滤（`frontend/src/game/unit/normalizeUnitTypes.js`）。
- `seed/init` 覆盖风险：
  - `init:catalog` replace 逻辑在 `backend/scripts/initCatalogAndUnitData.js`，`replace=true` 时会 `deleteMany` 后 `insertMany`。
  - `unitTypesPatch.unitTypes / removeUnitTypeIds` 在 `backend/seed/unitCatalogFactory.js` 生效。
- 前端 `normalizeUnitTypes` 是白名单归一化：
  - 仅返回固定字段（`id/unitTypeId/name/.../components`），未知字段不会透传（`frontend/src/game/unit/normalizeUnitTypes.js`）。
- 战斗技能/行为对 `classTag` 有固定四类硬编码：
  - `infantry/cavalry/archer/artillery`（`frontend/src/game/battle/presentation/runtime/BattleRuntime.js`、`frontend/src/game/battle/screens/BattleSceneContainer.js`、`frontend/src/game/battle/simulation/crowd/CrowdSim.js`）。

新增/更新后如何生效：
- 兵营：重新进入兵营页（重新请求 `/api/army/unit-types`）。
- 训练营：重新进入训练营（重新请求 `/api/army/training/init`）。
- 围城战场：重新发起 `battle-init`（重新请求 `/api/nodes/:nodeId/siege/pve/battle-init`）。

### 2. 必填字段与推荐字段（新增一个兵种的最小集）

`ArmyUnitType` 最小字段（建议统一带齐）：
- `unitTypeId, name, roleTag, speed, hp, atk, def, range, costKP, enabled`

推荐字段（提升可用性/运营能力）：
- `rpsType, tier/level, professionId, rarity, sortOrder, description, tags`

组件化字段（`UnitComponent + 引用`）：
- `bodyId / weaponIds / vehicleId / abilityIds / behaviorProfileId / stabilityProfileId / visuals`

常见坑：
- `enabled` 缺失或为 `false`，在默认链路会被过滤，看起来像“新增失败”。
- Admin 创建接口强校验 `rpsType`（`backend/routes/admin.js` 的 `parseUnitTypePayload(create=true)`）。
- 组件引用 ID 不存在时，展开后会得到 `null` 或 `[]`（`toComponentRef` + `filter(Boolean)`，`backend/services/unitRegistryService.js`）。

### 3. 路径一：运营推荐（Admin API 增量新增/更新）

适用场景：
- 线上运营增量发布、灰度、可审计、尽量不影响既有数据。

前置条件：
- 管理员账号登录，拿到 JWT token。
- 请求头带 `Authorization: Bearer <token>`，且账号 `role=admin`。

可用 endpoints：
- `GET /api/admin/army/unit-types`
- `POST /api/admin/army/unit-types`
- `PUT /api/admin/army/unit-types/:unitTypeId`
- `DELETE /api/admin/army/unit-types/:unitTypeId`
- `GET /api/admin/unit-components`
- `POST /api/admin/unit-components`
- `PUT /api/admin/unit-components/:componentId`
- `DELETE /api/admin/unit-components/:componentId`

步骤：
1. 先建/改组件（如有）：`/api/admin/unit-components`。
2. 再建/改兵种：`/api/admin/army/unit-types`。
3. 上下架优先用 `PUT enabled=false/true`，不要先删数据。
4. 发布后做三段验证（兵营、训练营、battle-init）。

最小字段清单（Admin 创建建议）：
- `unitTypeId, name, roleTag, speed, hp, atk, def, range, costKP, rpsType, enabled`

示例（新增 unitType）：
```bash
curl -X POST http://localhost:5000/api/admin/army/unit-types \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "unitTypeId": "u_custom_demo_t1",
    "name": "测试兵种T1",
    "roleTag": "近战",
    "speed": 2.2,
    "hp": 180,
    "atk": 26,
    "def": 14,
    "range": 1,
    "costKP": 18,
    "rpsType": "mobility",
    "tier": 1,
    "enabled": true,
    "sortOrder": 999
  }'
```

示例（软下线）：
```bash
curl -X PUT http://localhost:5000/api/admin/army/unit-types/u_custom_demo_t1 \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

生效验证：
1. 兵营端点：
```bash
curl http://localhost:5000/api/army/unit-types
```
2. 训练营端点（需 token）：
```bash
curl http://localhost:5000/api/army/training/init \
  -H "Authorization: Bearer <USER_TOKEN>"
```
3. 围城 PVE 初始化（需 token + 有效 nodeId + gateKey）：
```bash
curl "http://localhost:5000/api/nodes/<nodeId>/siege/pve/battle-init?gateKey=cheng" \
  -H "Authorization: Bearer <USER_TOKEN>"
```

风险点：
- 直接 `DELETE` 会让历史引用变“悬空”：`users.armyRoster[].unitTypeId` 还在，但新目录里已无该 ID（`backend/models/User.js`、`backend/routes/army.js`/`nodes.js` 的 roster normalize 依赖目录映射）。
- 当前 Admin 前端表单不含 `rpsType/enabled/tier`，可能导致创建失败；优先用 API/curl（`frontend/src/components/admin/AdminPanel.js` vs `backend/routes/admin.js`）。

回滚策略：
- 首选 `PUT enabled=false`（软回滚）。
- 字段误改：`PUT` 回滚为上个版本字段值。
- 如果误删：优先用原 `unitTypeId` 重建；必要时批量清理/迁移 `users.armyRoster[].unitTypeId`。

### 4. 路径二：开发批量导入（seed/init 脚本）

适用场景：
- 本地/测试库一次性导入或重建大批兵种（例如 36 兵种基线 + patch）。

关键文件：
- `backend/seed/bootstrap_catalog_data.json`
- `backend/seed/unitCatalogFactory.js`（`unitTypesPatch.unitTypes`、`removeUnitTypeIds`）

步骤：
1. 修改 `bootstrap_catalog_data.json`（必要时加 patch）。
2. 进入后端目录执行初始化：
```bash
cd backend
npm run init:catalog
```
3. 用三个业务端点验证（同第 3 节）。

最小字段清单（`unitTypesPatch.unitTypes[]`）：
- `unitTypeId, name, roleTag, speed, hp, atk, def, range, costKP, enabled`
- 建议同时带 `rpsType, tier/level, sortOrder`。

`unitTypesPatch` 示例：
```json
{
  "unitTypesPatch": {
    "unitTypes": [
      {
        "unitTypeId": "u_custom_demo_t1",
        "name": "测试兵种T1",
        "roleTag": "近战",
        "speed": 2.2,
        "hp": 180,
        "atk": 26,
        "def": 14,
        "range": 1,
        "costKP": 18,
        "enabled": true,
        "rpsType": "mobility",
        "tier": 1
      }
    ],
    "removeUnitTypeIds": ["u_old_demo_t1"]
  }
}
```

幂等性与覆盖风险：
- 幂等：重复执行不会无限重复插入同 ID。
- 覆盖：`init:catalog` 对 `ArmyUnitType/UnitComponent` 是 replace，执行时会清空再写入（`deleteMany + insertMany`）。
- 运行时重置风险：`fetchUnitTypesWithComponents()` 会检查 `typedCount>=36 && enabledCount>=36`，不满足可能触发自动重建（`backend/services/unitRegistryService.js`）。

建议规范：
- replace 仅用于开发/测试数据库。
- 线上增量发布用 admin API，不用 `init:catalog` 覆盖。

回滚策略：
- 非线上库：恢复上一版 `bootstrap_catalog_data.json`，再执行一次 `npm run init:catalog`。
- 线上库：不要用该路径回滚，改走 admin API 字段回滚/软下线。

### 5. 路径三：紧急/调试（直接写 MongoDB）

适用场景：
- 临时插入测试兵种、线上故障排查、API 链路定位。

操作要点：
- 主要集合：
  - `armyunittypes`（兵种）
  - `unitcomponents`（可选）
  - `users`（若要让某用户立刻可部署，需要改 `armyRoster`）
- 兵种记录至少保证：
  - `unitTypeId/name/roleTag/speed/hp/atk/def/range/costKP/enabled`
  - `enabled=true` 才会在默认链路里出现。
- “立刻可参战”常见附加字段：
  - 攻方自有兵力：`users.armyRoster[].unitTypeId/count`。
  - 城门防守快照：`DomainDefenseLayout.gateDefense.cheng|qi[].unitTypeId/count`（`backend/models/DomainDefenseLayout.js`）。
  - 战场布防：`DomainDefenseLayout.battlefieldDefenderDeployments[].units[].unitTypeId/count`。

示例（mongosh）：
```javascript
db.armyunittypes.updateOne(
  { unitTypeId: "u_custom_demo_t1" },
  {
    $set: {
      unitTypeId: "u_custom_demo_t1",
      name: "测试兵种T1",
      roleTag: "近战",
      speed: 2.2,
      hp: 180,
      atk: 26,
      def: 14,
      range: 1,
      costKP: 18,
      enabled: true,
      rpsType: "mobility",
      tier: 1,
      level: 1
    }
  },
  { upsert: true }
);
```

生效验证：
- 同第 3 节三段验证（兵营/训练营/battle-init）。

风险点：
- 绕过后端校验，字段缺失时可能“不崩但功能缺失”。
- 容易产生脏引用（组件 ID 不存在、roster 指向不存在兵种）。
- 不适合长期运营，后续要回归 admin API 或 seed 规范化。

回滚策略：
- 新增错误：`enabled=false` 或按 `unitTypeId` 删除。
- 字段错误：按备份恢复原值。
- 若已写入 `users.armyRoster`/布防字段，同步回滚这些引用。

### 6. “新增字段/新职业范式”什么时候必须改代码？

结论：满足“仅数据变更”才可只改内容；触发“新机制”就必须改代码。

必须改代码的典型情况：
- 新增字段要在前端 UI/战斗使用：
  - `normalizeUnitTypes` 是白名单，未纳入字段不会透传（`frontend/src/game/unit/normalizeUnitTypes.js`）。
- 新职业/新技能属于第五类（非 infantry/cavalry/archer/artillery）：
  - 战斗 runtime/sim/UI 多处按四类硬编码，需要扩展分支（`BattleRuntime.js`、`BattleSceneModal.js`、`CrowdSim.js`）。
- 渲染层容量策略变化：
  - 目前程序纹理层是固定层数方案（如 `unitLayerCount=64`，layer 取模 64），大量新增视觉资源要评估 atlas/分页（`frontend/src/game/battle/presentation/assets/ProceduralTextures.js`、`backend/seed/unitCatalogFactory.js`）。

如何判断“新增数据 vs 新机制”：
- 仅改现有字段数值/文案/引用 ID：新增数据。
- 需要新增战斗判定分支、技能类型、渲染通道：新机制（要改代码）。

### 7. 上线与回滚建议（运营规程）

推荐流程：
1. 先发布组件（`unit-components`）再发布 `unitType` 引用，避免空引用。
2. 先给小范围测试账号写入 `users.armyRoster`（或通过正常征召流程），验证三段端点和实战表现。
3. 扩量发布时只做增量更新，不覆盖全表；上下架优先 `enabled` 软开关。
4. `unitTypeId` 一旦上线不要改名；只更新字段值，保持历史引用稳定。

回滚建议：
- 一级回滚：`enabled=false`。
- 二级回滚：字段回写到上一版本。
- 误删回滚：用原 `unitTypeId` 重建并修复 roster 引用。
- `replacedBy` 字段当前仓库未实现（建议未来加到迁移策略中）。

### 8. FAQ / Troubleshooting

Q1: 新兵种看不到？
- 先查 `enabled`、`sortOrder`、`unitTypeId` 是否合法。
- 重新进入兵营/训练营，重新触发 battle-init。
- 检查是否被 `normalizeUnitTypes(..., { enabledOnly: true })` 过滤。

Q2: 训练营看得到，战场看不到？
- 核对 `/api/nodes/:nodeId/siege/pve/battle-init` 返回的 `unitTypes`。
- 检查围城上下文是否有效（`gateKey`、参战状态、该用户有无对应 roster/参战数据）。

Q3: Admin 页面创建失败，但 API 可用？
- 常见是前端表单没提供后端创建所需字段（尤其 `rpsType`）。
- 先用 curl/Postman 调 `/api/admin/army/unit-types` 验证，再回填后台 UI。

Q4: 技能/行为不生效？
- 确认是否落在现有四类 `classTag` 分支内。
- 确认组件引用存在（`abilityIds/behaviorProfileId/stabilityProfileId`）且能在 registry 展开。

Q5: 下线后历史数据怎么处理？
- 不建议直接删；先 `enabled=false`。
- 如必须删，需制定 `users.armyRoster` 和围城布防字段的清理/迁移脚本。
