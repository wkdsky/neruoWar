# 1. Repo 概览（单位系统相关）

## 1.1 关键目录/文件树（frontend/backend/common/assets）

### 前端（单位页面 + 战斗模块）
- `frontend/src/App.js`（页面入口与 view 状态路由）
- `frontend/src/components/game/ArmyPanel.js`（兵营）
- `frontend/src/components/game/TrainingGroundPanel.js`（训练营入口）
- `frontend/src/game/battle/screens/BattleSceneContainer.js`（战斗场景核心 React 入口）
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`（战斗运行时）
- `frontend/src/game/battle/simulation/crowd/CrowdSim.js`
- `frontend/src/game/battle/simulation/crowd/crowdCombat.js`
- `frontend/src/game/battle/simulation/crowd/crowdPhysics.js`
- `frontend/src/game/battle/presentation/render/*Renderer.js`（WebGL2 渲染层）
- `frontend/src/game/battle/presentation/ui/AimOverlayCanvas.js`
- `frontend/src/game/battle/presentation/ui/Minimap.js`
- `frontend/src/game/battle/presentation/assets/ProceduralTextures.js`
- `frontend/src/game/battle/presentation/assets/UnitVisualConfig.example.json`
- `frontend/src/components/game/BattlefieldPreviewModal.js`（Three.js 战场预览/编辑）
- `frontend/src/runtimeConfig.js`（后端 API 地址解析）

### 后端（单位目录 + 用户兵力 + 战斗初始化）
- `backend/server.js`（Express 入口，路由挂载）
- `backend/config/database.js`（MongoDB 连接）
- `backend/routes/army.js`（兵种列表/兵营/模板/训练营初始化）
- `backend/routes/nodes.js`（围城 PVE battle-init/result）
- `backend/routes/admin.js`（兵种目录 CRUD）
- `backend/services/armyUnitTypeService.js`（兵种序列化）
- `backend/models/ArmyUnitType.js`（兵种目录 schema）
- `backend/models/User.js`（用户 roster/template 持久化）
- `backend/models/DomainDefenseLayout.js`（战场布局持久化）
- `backend/models/SiegeBattleRecord.js`（战斗结果记录）
- `backend/seed/bootstrap_catalog_data.json`（兵种/物品种子）
- `backend/scripts/initCatalogAndUnitData.js`（目录初始化）

### common/assets 现状
- `common/` 目录在仓库中不存在（`rg --files frontend backend common` 报 `common: No such file or directory`）。
- 资产主要分布在 `frontend/src/game/battle/presentation/assets`、`frontend/src/assets`、`backend/seed`。

### 实现状态
- 页面/战斗/后端链路文件可定位：✅
- 独立 `common` 共享单位 schema 层：❌

## 1.2 启动方式与构建方式（package.json scripts，dev server，backend server）

- 前端：`frontend/package.json`
  - `npm start` -> `react-scripts start`
  - `npm run build`
- 后端：`backend/package.json`
  - `npm run dev` -> `nodemon server.js`
  - `npm start` -> `node server.js`
- 一键脚本：仓库根 `start.sh`
  - 启动 MongoDB（systemd 或 PM2 fallback）
  - 执行目录初始化脚本（空库时）
  - 启动前后端服务

### 实现状态
- 前后端分离启动脚本完整：✅
- CI/自动化迁移流水线（单位系统专项）可见度一般：🟡

## 1.3 是否已有数据库/持久化（sqlite/postgres/mysql/lowdb/json文件等）：位置与配置

- 数据库：MongoDB + Mongoose。
- 连接配置：`backend/config/database.js`，默认 URI `mongodb://localhost:27017/strategy-game`。
- 核心持久化位置：
  - 兵种目录：`ArmyUnitType` 集合
  - 用户兵力与模板：`User.armyRoster[]`、`User.armyTemplates[]`
  - 战场布局：`DomainDefenseLayout`
  - 战斗记录：`SiegeBattleRecord`
- 前端还存在少量 `localStorage`（页面状态、token、战场预览缓存），不是单位主数据源。

### 实现状态
- DB 持久化已存在：✅
- 单位系统“统一可扩展 schema（技能/武器/载具/资产）”：❌

### 关键代码片段（数据库连接）
```js
// backend/config/database.js:3-23
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game',
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10) || 80,
        minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE, 10) || 10,
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10) || 5000,
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 10) || 45000,
        maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME_MS, 10) || 30000,
      }
    );

    console.log(`MongoDB 连接成功: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB 连接错误: ${error.message}`);
    process.exit(1);
  }
};
```

---

# 2. 页面与路由：兵营 / 训练营 / 战场

## 2.1 路由入口：哪些 path 对应兵营、训练营、战场（文件路径 + 路由表）

### 路由机制现状
- 不是 `react-router` path 路由；是 `App.js` 内 `view` 状态切换。
- 入口按钮：`setView('army')`、`setView('trainingGround')`。
- 战场：
  - 训练场路径：`TrainingGroundPanel -> BattleSceneModal`
  - 围城路径：`App.handleOpenSiegePveBattle -> /api/nodes/:nodeId/siege/pve/battle-init -> BattleSceneModal`

### 实现状态
- 兵营/训练营/战场入口链路：✅
- URL path 级别可分享路由：❌（依赖内部状态）

### 关键代码片段（页面切换）
```jsx
// frontend/src/App.js:5954-5977, 6188-6193
{showMilitaryMenu && (
  <div className="military-menu-panel">
    <button
      type="button"
      className="military-menu-item"
      onClick={async () => {
        setShowMilitaryMenu(false);
        await prepareForPrimaryNavigation();
        setView('army');
      }}
    >
      兵营
    </button>
    <button
      type="button"
      className="military-menu-item"
      onClick={async () => {
        setShowMilitaryMenu(false);
        await prepareForPrimaryNavigation();
        setView('trainingGround');
      }}
    >
      训练场
    </button>
  </div>
)}

{view === "army" && !isAdmin && (
  <ArmyPanel />
)}
{view === "trainingGround" && !isAdmin && (
  <TrainingGroundPanel onExit={navigateToHomeWithDockCollapse} />
)}
```

## 2.2 兵营页面：组件结构、数据加载方式、渲染内容（属性展示、列表、详情、预览）

### 文件与关键组件
- 文件：`frontend/src/components/game/ArmyPanel.js`
- 核心函数/状态：
  - `fetchArmyData`（并行拉取 unit-types/me/templates）
  - `unitsWithCount`（目录 + 个人库存合并）
  - `beginDetailRotationDrag` / `updateDetailRotationDrag`（详情旋转拖拽）
  - 模板编辑器（拖拽 + 数字输入 + 数字键盘）

### 数据来源
- `GET /api/army/unit-types`
- `GET /api/army/me`
- `GET /api/army/templates`
- 征召结算：`POST /api/army/recruit/checkout`

### 渲染内容
- 兵种卡片：数值、库存、征召
- 兵种详情：速度/生命/攻击/防御/射程/单价/库存/升级目标 + 简介
- 两个“可旋转预留区块”：
  - 近距离 3D 模型+贴图（占位）
  - 战场小人模型+贴图（占位）

### 实现状态
- 兵营基础展示与征召：✅
- 模板系统（创建/编辑/删除）：✅
- 近景真实 3D 模型加载与材质：❌（仅 DOM 占位）

### 关键代码片段（兵营数据加载）
```js
// frontend/src/components/game/ArmyPanel.js:181-233
const fetchArmyData = useCallback(async () => {
  if (!token) {
    setLoading(false);
    setError('未登录，无法加载军团数据');
    return;
  }

  setLoading(true);
  setError('');

  try {
    const [unitTypesResponse, meResponse, templatesResponse] = await Promise.all([
      fetch(`${API_BASE}/army/unit-types`),
      fetch(`${API_BASE}/army/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }),
      fetch(`${API_BASE}/army/templates`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
    ]);

    const unitTypesParsed = await parseApiResponse(unitTypesResponse);
    const meParsed = await parseApiResponse(meResponse);
    const templatesParsed = await parseApiResponse(templatesResponse);

    if (!unitTypesResponse.ok) {
      setError(getApiErrorMessage(unitTypesParsed, '加载兵种列表失败'));
      setLoading(false);
      return;
    }

    if (!meResponse.ok) {
      setError(getApiErrorMessage(meParsed, '加载军团信息失败'));
      setLoading(false);
      return;
    }

    if (!templatesResponse.ok) {
      setError(getApiErrorMessage(templatesParsed, '加载模板失败'));
      setLoading(false);
      return;
    }

    const nextUnitTypes = Array.isArray(unitTypesParsed.data?.unitTypes) ? unitTypesParsed.data.unitTypes : [];
    const nextRoster = Array.isArray(meParsed.data?.roster) ? meParsed.data.roster : [];
    const nextBalance = Number.isFinite(meParsed.data?.knowledgeBalance) ? meParsed.data.knowledgeBalance : 0;
```

### 关键代码片段（兵种详情“3D预留”）
```jsx
// frontend/src/components/game/ArmyPanel.js:886-935
<div className="army-unit-detail-visuals">
  <section className="army-unit-visual-card">
    <header>
      <strong>近距离3D模型 + 贴图</strong>
      <span>预留（可旋转）</span>
    </header>
    <div
      className={`army-unit-visual-stage ${detailDragTarget === 'closeup' ? 'is-dragging' : ''}`}
      onPointerDown={(event) => beginDetailRotationDrag('closeup', event)}
      onPointerMove={(event) => updateDetailRotationDrag('closeup', event)}
      onPointerUp={stopDetailRotationDrag}
      onPointerCancel={stopDetailRotationDrag}
    >
      <div className="army-unit-turntable">
        <div className="army-unit-turntable-shadow" />
        <div className="army-unit-turntable-disc" />
        <div
          className="army-unit-visual-dummy"
          style={{ transform: `translateZ(20px) rotateY(${detailRotation.closeup}deg)` }}
        >
          3D
        </div>
      </div>
    </div>
  </section>

  <section className="army-unit-visual-card">
    <header>
      <strong>战场形象（小人模型 + 贴图）</strong>
      <span>预留（可旋转）</span>
    </header>
```

## 2.3 训练营页面：功能（训练/生成/测试/放置？），与单位数据的关系

### 文件与功能
- 文件：`frontend/src/components/game/TrainingGroundPanel.js`
- 功能本质：拉取训练专用 `battleInitData`，然后直接进入 `BattleSceneModal`（`mode="training"`）。
- 当前“训练营”不是异步训练队列；是即时战场沙盘。

### 与单位数据关系
- 后端 `GET /api/army/training/init` 返回 `unitTypes` + `attacker/defender rosterUnits`，并把 `count` 设为超大值（近似无限）。
- 前端再在部署阶段按部队编辑器/模板生成 squad。

### 实现状态
- 训练营接入战斗流程：✅
- 训练队列/训练完成时长/解锁进度系统：❌

### 关键代码片段（训练营入口）
```jsx
// frontend/src/components/game/TrainingGroundPanel.js:20-69
const TrainingGroundPanel = ({ onExit }) => {
  const [state, setState] = useState(() => createTrainingState());

  const fetchTrainingInit = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setState({ loading: false, error: '未登录，无法进入训练场', data: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: '' }));

    try {
      const response = await fetch(`${API_BASE}/army/training/init`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const parsed = await parseApiResponse(response);
      if (!response.ok || !parsed) {
        setState({
          loading: false,
          error: parsed?.error || parsed?.message || '加载训练场失败',
          data: null
        });
        return;
      }
      setState({ loading: false, error: '', data: parsed });
    } catch (error) {
      setState({ loading: false, error: `加载训练场失败: ${error.message}`, data: null });
    }
  }, []);

  return (
    <BattleSceneModal
      open
      loading={state.loading}
      error={state.error}
      battleInitData={state.data}
      mode="training"
      startLabel="开始训练"
      requireResultReport={false}
```

## 2.4 战场入口：如何选择兵种并生成部队/小人实例（从UI到BattleRuntime的链路）

### 调用链路
1. `App.js` 拉取 battle init（训练或围城）
2. `BattleSceneModal` 创建 `new BattleRuntime(battleInitData, ...)`
3. 部署阶段在 `BattleSceneModal` 内通过“新建部队/模板”配置 `deployGroups`
4. `runtime.startBattle()` 将 deploy group -> squad
5. `createCrowdSim(sim)` 将 squad -> agents（可见代表体）
6. 帧循环中 `runtime.getRenderSnapshot()` 输出 instancing buffer
7. 各 renderer 上传实例数据后绘制

### 实现状态
- UI->runtime->sim->render 全链路：✅
- “单位定义统一接口层（装配 + 校验 + 版本化）”：❌

### 关键代码片段（战斗帧主链路）
```js
// frontend/src/game/battle/screens/BattleSceneContainer.js:845-905
if (nowPhase === 'battle') {
  clockRef.current.tick(deltaSec, (fixedStep) => runtime.step(fixedStep));
}

const focusAnchor = runtime.getFocusAnchor();
const followAnchor = nowPhase === 'battle'
  ? {
      x: Number(focusAnchor?.x) || 0,
      y: Number(focusAnchor?.y) || 0,
      vx: Number(focusAnchor?.vx) || 0,
      vy: Number(focusAnchor?.vy) || 0,
      squadId: followTargetSquadId
    }
  : null;
cameraRef.current.update(deltaSec, followAnchor);
const cameraState = cameraRef.current.buildMatrices(sceneCanvas.width, sceneCanvas.height);

const snapshot = runtime.getRenderSnapshot();
const field = runtime.getField();
renderers.ground.setFieldSize(field?.width || 900, field?.height || 620);
renderers.ground.setDeployRange(runtime.getDeployRange());
renderers.building.updateFromSnapshot(snapshot.buildings);
renderers.impostor.updateFromSnapshot(snapshot.units);
renderers.projectile.updateFromSnapshot(snapshot.projectiles);
renderers.effect.updateFromSnapshot(snapshot.effects);
```

---

# 3. “单位/兵种”现状数据模型（非常关键）

## 3.1 当前有哪些概念：unit / troop / squad / agent / classTag / weapon / skill / building / item

### 已存在概念
- `unitType`（目录定义，DB）
- `armyRoster entry`（用户拥有数量）
- `armyTemplate`（模板编组）
- `deployGroup`（部署阶段 UI 编组）
- `squad`（战斗阶段战术单位）
- `agent`（crowd 仿真的可见/受击代表体）
- `classTag`（`infantry/cavalry/archer/artillery`）
- `skill`（按 classTag 映射，支持 cd + 目标确认 + 生效）
- `building/item`（战场物件）

### 缺失/弱化概念
- `weapon`（独立武器实体）❌
- `vehicle/mount`（只在视觉层 `vehicleIndex`，玩法未独立）🟡
- `unit body/weapon/vehicle` 三段装配式 gameplay schema ❌

## 3.2 当前单位数据从哪里来

### 前端本地常量/JSON
- `frontend/src/game/battle/presentation/assets/UnitVisualConfig.example.json`
  - 只定义视觉贴图层索引（`bodyIndex/gearIndex/vehicleIndex`）
- 兵种技能元信息（名字、icon、cd 常量）硬编码在 `BattleRuntime.js` / `CrowdSim.js`

### 后端 API
- `GET /api/army/unit-types`
- `GET /api/army/me`
- `GET /api/army/templates`
- `GET /api/army/training/init`
- `GET /api/nodes/:nodeId/siege/pve/battle-init`

### DB/文件
- DB：`ArmyUnitType`, `User.armyRoster`, `User.armyTemplates`
- 种子：`backend/seed/bootstrap_catalog_data.json`

### 实现状态
- API/DB 驱动基础单位数据：✅
- 技能/武器/资产元数据统一由 DB 下发：❌

## 3.3 当前单位 schema（提炼结构体）

### ArmyUnitType（目录）
```ts
type ArmyUnitType = {
  unitTypeId: string
  name: string
  roleTag: '近战' | '远程'
  speed: number
  hp: number
  atk: number
  def: number
  range: number
  costKP: number
  level: number
  nextUnitTypeId: string | null
  upgradeCostKP: number | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}
```

### User 兵力与模板
```ts
type ArmyRosterEntry = {
  unitTypeId: string
  count: number
  level: number
  nextUnitTypeId: string | null
  upgradeCostKP: number | null
}

type ArmyTemplate = {
  templateId: string
  name: string
  units: Array<{ unitTypeId: string; count: number }>
  createdAt: Date
  updatedAt: Date
}
```

### 战斗态 squad（BattleRuntime.createSquad + CrowdSim 扩展）
- 核心字段：
  - 几何/运动：`x,y,vx,vy,yaw,radius,waypoints,rallyPoint`
  - 兵力：`startCount,remain,health,maxHealth,units,remainUnits`
  - 战斗：`stats{atk/def/range/speed/hpAvg},targetSquadId,attackCooldown`
  - 行为：`behavior,order,speedMode,speedPolicy,marchMode,guard`
  - 技能：`skillCooldowns,activeSkill,skillRush,effectBuff,classCenters`
  - UI/调试：`action,debugTargetScore,lastMoveMarker`

### 贴图/atlas字段
- 单位目录中没有 `atlasKey/textureLayer/animSetId` 字段 ❌
- 战斗渲染使用运行时 `visualConfig` 映射到 `bodyIndex/gearIndex/vehicleIndex`（来源是本地 json）🟡

### 技能定义字段
- 技能参数大多硬编码在仿真文件：
  - `GROUND_SKILL_CONFIG`（箭雨/炮击）
  - `SKILL_COOLDOWN_BY_CLASS`
  - 骑兵冲锋常量
- DB 中无技能字段 ❌

### 实现状态
- 基础数值 schema（hp/atk/def/speed/range...）：✅
- 技能/投射物/命中模型可配置 schema：❌
- 资产层 schema（近景模型/战场小人贴图）：❌

### 关键代码片段（兵种目录 schema）
```js
// backend/models/ArmyUnitType.js:3-70
const ArmyUnitTypeSchema = new mongoose.Schema({
  unitTypeId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  roleTag: {
    type: String,
    enum: ['近战', '远程'],
    required: true
  },
  speed: { type: Number, required: true, min: 0 },
  hp: { type: Number, required: true, min: 1 },
  atk: { type: Number, required: true, min: 0 },
  def: { type: Number, required: true, min: 0 },
  range: { type: Number, required: true, min: 1 },
  costKP: { type: Number, required: true, min: 1 },
  level: { type: Number, default: 1, min: 1 },
  nextUnitTypeId: { type: String, default: null },
  upgradeCostKP: { type: Number, default: null, min: 0 },
  sortOrder: { type: Number, default: 0 }
}, {
  timestamps: true
});
```

### 关键代码片段（squad 技能元信息按“部队内兵种构成”生成）
```js
// frontend/src/game/battle/presentation/runtime/BattleRuntime.js:282-340
const buildSkillMetaFromSquad = (squad = null, unitTypeMap = new Map()) => {
  if (!squad || squad.team !== TEAM_ATTACKER || squad.remain <= 0) {
    return { cooldownRemain: 0, skills: [] };
  }
  const classCounts = { infantry: 0, cavalry: 0, archer: 0, artillery: 0 };
  const sourceUnits = squad.remainUnits && Object.keys(squad.remainUnits).length > 0
    ? squad.remainUnits
    : (squad.units || {});
  Object.entries(sourceUnits || {}).forEach(([unitTypeId, rawCount]) => {
    const count = Math.max(0, Number(rawCount) || 0);
    if (count <= 0) return;
    const classTag = inferClassFromUnitType(unitTypeMap.get(unitTypeId) || {});
    classCounts[classTag] = (classCounts[classTag] || 0) + count;
  });
  const cooldownMap = squad.skillCooldowns && typeof squad.skillCooldowns === 'object'
    ? squad.skillCooldowns
    : {};
  const skills = [];
  SKILL_CLASS_ORDER.forEach((classTag) => {
    const count = Math.max(0, Number(classCounts[classTag]) || 0);
    if (count <= 0) return;
    const skillMeta = SKILL_META_BY_CLASS[classTag] || SKILL_META_BY_CLASS.infantry;
    const cooldownRemain = Math.max(
      0,
      Number.isFinite(Number(cooldownMap[classTag])) ? Number(cooldownMap[classTag]) : fallbackCooldown
    );
    const center = squad.classCenters && squad.classCenters[classTag] ? squad.classCenters[classTag] : null;
    skills.push({
      id: skillMeta.id,
      name: skillMeta.name,
      kind: classTag,
      classTag,
      count: Math.round(count),
      description: SKILL_DESC_BY_CLASS[classTag] || '',
      icon: skillMeta.icon,
      cooldownTotal,
      cooldownRemain,
      anchor: center ? { x: Number(center.x) || Number(squad.x) || 0, y: Number(center.y) || Number(squad.y) || 0 } : { x: Number(squad.x) || 0, y: Number(squad.y) || 0 },
      available: cooldownRemain <= 0.01 && (Number(squad.morale) || 0) > 0
    });
  });
```

## 3.4 “兵种组合”的现状：是否存在 body/weapon/vehicle 组合思想？如果没有，指出缺口

### 现状判断
- 视觉层存在“3槽位”组合思想：`bodyIndex/gearIndex/vehicleIndex`。
- 玩法层没有 `weapon` / `vehicle` 独立实体与装配规则（射程/伤害/弹道仍由 unit/squad 常量推导）。
- 目录 DB 仅兵种平面字段，无“兵种 = 士兵体 + 武器 + 载具”建模。

### 实现状态
- 视觉组合（索引级）：🟡
- 数据/玩法组合（可持久化 + 标准化读取）：❌

---

# 4. 后端与数据库（如果存在；如果不存在也要明确）

## 4.1 后端框架与入口（Express/Koa/Next API 等）

- 框架：Express + Socket.IO + Mongoose
- 入口：`backend/server.js`
- 路由挂载：`/api/army`, `/api/nodes`, `/api/admin` 等

### 实现状态
- REST API + 持久化后端完整：✅

### 关键代码片段（server 路由挂载）
```js
// backend/server.js:85-93
app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/alliances', allianceRoutes);
app.use('/api/army', armyRoutes);
app.use('/api/senses', senseRoutes);
app.use('/api/users', usersRoutes);
// 连接数据库
connectDB();
```

## 4.2 现有 API 列表（重点与 units/barracks/training/battle 相关）

### Army 相关 API（`backend/routes/army.js`）
- `GET /api/army/unit-types`
  - 出参：`{ unitTypes: ArmyUnitType[] }`
  - 调用端：`ArmyPanel.fetchArmyData`
- `GET /api/army/me`（需 token）
  - 出参：`{ knowledgeBalance, roster }`
  - 调用端：`ArmyPanel.fetchArmyData`
- `GET /api/army/templates`（需 token）
  - 出参：`{ success, templates }`
  - 调用端：`ArmyPanel`, `BattleSceneModal`
- `POST /api/army/templates` / `PUT /api/army/templates/:templateId` / `DELETE /api/army/templates/:templateId`
- `POST /api/army/recruit` / `POST /api/army/recruit/checkout`
- `GET /api/army/training/init`（需 token）
  - 返回训练场 battleInitData（含 unitTypes + 无限 roster）
  - 调用端：`TrainingGroundPanel`

### 围城战斗 API（`backend/routes/nodes.js`）
- `GET /api/nodes/:nodeId/siege/pve/battle-init?gateKey=cheng|qi`
  - 返回围城 `battleInitData`
  - 调用端：`App.handleOpenSiegePveBattle`
- `POST /api/nodes/:nodeId/siege/pve/battle-result`
  - 记录结果到 `SiegeBattleRecord`
  - 调用端：`BattleSceneContainer.reportBattleResult`

### Admin 兵种目录 API（`backend/routes/admin.js`）
- `GET /api/admin/army/unit-types`
- `POST /api/admin/army/unit-types`
- `PUT /api/admin/army/unit-types/:unitTypeId`
- `DELETE /api/admin/army/unit-types/:unitTypeId`

### 实现状态
- 单位目录/兵营/训练营/战斗初始化 API：✅
- “统一单位接口 API（registry/assembler）”单独抽象：❌

### 关键代码片段（训练营初始化 API）
```js
// backend/routes/army.js:327-390
router.get('/training/init', authenticateToken, async (req, res) => {
  try {
    const [unitTypes, itemCatalog, user] = await Promise.all([
      fetchArmyUnitTypes(),
      fetchBattlefieldItems({ enabledOnly: true }),
      User.findById(req.user.userId).select('username')
    ]);

    const unlimitedUnits = (Array.isArray(unitTypes) ? unitTypes : [])
      .map((unit) => {
        const unitTypeId = getUnitTypeId(unit);
        if (!unitTypeId) return null;
        return {
          unitTypeId,
          unitName: unit?.name || unitTypeId,
          count: MAX_TEMPLATE_UNIT_COUNT
        };
      })
      .filter(Boolean);

    return res.json({
      mode: 'training',
      battleId: `training_${Date.now()}`,
      gateKey: 'training',
      gateLabel: '训练场',
      nodeName: '训练场',
      timeLimitSec: 240,
      unitsPerSoldier: 10,
      attacker: { username: user.username || '我方', totalCount: 0, units: unlimitedUnits, rosterUnits: unlimitedUnits },
      defender: { username: '敌方', totalCount: 0, units: [], rosterUnits: unlimitedUnits, deployUnits: [] },
      unitTypes: Array.isArray(unitTypes) ? unitTypes : [],
      battlefield: {
        intelVisible: true,
        layoutMeta: { fieldWidth: 900, fieldHeight: 620, maxItemsPerType: 999999 },
        itemCatalog: unlimitedItems,
        objects: [],
        defenderDeployments: []
      }
    });
```

## 4.3 DB 连接方式与 ORM/SQL（若有）

- ORM/驱动：Mongoose（非 SQL）
- 关键 schema/migrations/seeds：
  - Schema：`backend/models/*.js`
  - Seed：`backend/seed/bootstrap_catalog_data.json`
  - 初始化脚本：`backend/scripts/initCatalogAndUnitData.js`
- 单位相关表（集合）
  - `ArmyUnitType`
  - `User`（内嵌 `armyRoster`,`armyTemplates`）
  - `DomainDefenseLayout`（战场对象/守军布置）
  - `SiegeBattleRecord`（结果）

### 实现状态
- 目录与用户兵力有持久化：✅
- 单位复杂对象（技能、武器、载具、贴图引用）有结构化存储：❌

## 4.4 如果目前无 DB：当前是如何持久化的；影响点

- 本项目已有 DB，不适用“无 DB”分支。
- 但前端有 `localStorage` 用于 UI 状态和少量缓存，不是单位主数据。

### “引入更强 DB 持久化”影响最大模块
- `backend/models/ArmyUnitType.js`
- `backend/services/armyUnitTypeService.js`
- `backend/routes/army.js`
- `backend/routes/admin.js`
- `backend/routes/nodes.js`（battle init payload）
- `frontend/src/components/game/ArmyPanel.js`
- `frontend/src/game/battle/screens/BattleSceneContainer.js`
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`

---

# 5. 资产与渲染：战场小人 vs 兵营3D近景预览

## 5.1 战场渲染链路（WebGL2 instancing）

### 渲染模块
- `WebGL2Context.js`：shader/program/vao/buffer 基础工具
- `ImpostorRenderer.js`：单位实例化 billboard（`UNIT_INSTANCE_STRIDE=12`）
- `BuildingRenderer.js`：建筑/物件
- `ProjectileRenderer.js`：投射物实例渲染
- `EffectRenderer.js`：特效实例渲染

### per-instance attributes（单位）
- `iData0`: `x,y,z,size`
- `iData1`: `yaw,team,hp,bodySlice`
- `iData2`: `gearSlice,vehicleSlice,selected,flag`

### 贴图与 texture array 现状
- FS 使用 `sampler2DArray`，支持 `uUseTexArray` 开关。
- 纹理来源可由 `ProceduralTextures.js` 动态生成并上传。

### 动画系统现状
- 不是骨骼动画；主要是 impostor + 光照伪体积 + 生命周期参数。
- 无显式 `animSetId`/动作帧表。

### 实现状态
- WebGL2 instancing 主链路：✅
- 真正模型骨骼动画系统：❌

### 关键代码片段（Impostor shader + texture array）
```glsl
// frontend/src/game/battle/presentation/render/ImpostorRenderer.js:55-109
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUv;
in float vTeam;
in float vHp;
in float vSlice;
in float vSelected;
in float vFlag;

uniform vec3 uLightDir;
uniform float uPitchMix;
uniform sampler2DArray uTexArray;
uniform float uUseTexArray;
uniform float uLayer;

out vec4 outColor;

void main() {
  vec2 p = (vUv - vec2(0.5)) * vec2(1.0, 1.85);
  float rr = dot(p, p);
  if (rr > 0.95) discard;

  vec3 color = palette * mix(vec3(0.84), teamTint, 0.34 + 0.09 * uLayer);
  if (uUseTexArray > 0.5) {
    float layer = floor(mod(vSlice, 8.0) + 0.5);
    vec4 texel = texture(uTexArray, vec3(vUv, layer));
    color = mix(color, texel.rgb, clamp(texel.a, 0.0, 1.0) * 0.72);
  }

  outColor = vec4(color, 1.0);
}
`;
```

## 5.2 训练营/兵营是否已有“3D旋转预览”

### 兵营近景预览
- `ArmyPanel` 中当前是 DOM/CSS 转台占位（可拖拽旋转角度），没有真实 3D 渲染器。

### 仓库中可复用 3D 能力
- `BattlefieldPreviewModal.js` 使用 Three.js 构建 3D 场景、相机、raycast、mesh。
- 若要做兵营近景真实模型预览，可复用该 Three.js 管线（拆轻量 preview renderer）或复用战场 WebGL2 管线单独 canvas。

### 实现状态
- 兵营真实 3D 近景预览：❌
- 仓库内已有可复用 Three.js 实战代码：✅

## 5.3 贴图与素材组织现状

- 战斗程序化纹理：`frontend/src/game/battle/presentation/assets/ProceduralTextures.js`
- 单位视觉映射配置样例：`UnitVisualConfig.example.json`
- 未发现 atlas 打包脚本（如 texture packer pipeline）
- 未见统一材质参数 DB 配置（多为 shader 常量/代码内定义）

### 实现状态
- 运行时 texture array 支持：✅
- 标准资产管线（模型文件 + 贴图 + manifest + 版本）：❌

## 5.4 “Q版战场小人”与“近景高细节模型”的现状差异点

- 当前战场更接近：billboard/impostor（不是高模 mesh 骨骼）。
- 近景高细节模型：兵营未接入。
- 两套 LOD/mesh/material 同时管理：未形成统一系统。

### 实现状态
- 战场低成本小人渲染：✅
- 近景高细节模型渲染：❌
- 双管线 LOD 统一调度：❌

---

# 6. 战斗/训练生成单位的关键接口点

## 6.1 BattleSceneModal / BattleRuntime：单位实例是怎么创建/销毁的

### 创建链路
- `BattleSceneContainer.setupRuntime()` -> `new BattleRuntime(battleInitData, ...)`
- `runtime.startBattle()`：deployGroup -> squad
- `createCrowdSim(sim)`：squad -> `agentsBySquad/allAgents`

### 销毁链路
- squad/agent 死亡：`crowdCombat.applyDamageToAgent` 置 dead，`updateCrowdSim` 回收过滤
- 战斗结束：`runtime.step` 将 phase 置 `ended`
- modal 关闭：销毁 renderer，清空 runtime 引用

### 实现状态
- 生命周期基础流程：✅
- 独立 unit factory/assembler 接口层：❌

### 关键代码片段（startBattle）
```js
// frontend/src/game/battle/presentation/runtime/BattleRuntime.js:1044-1103
startBattle() {
  if (!this.canStartBattle()) return { ok: false, reason: '双方至少需要一支部队' };
  const attackerSquads = this.attackerDeployGroups
    .filter((group) => group?.placed !== false)
    .map((group, index) => createSquad({
      group,
      index,
      team: TEAM_ATTACKER,
      unitTypeMap: this.unitTypeMap,
      unitsPerSoldier: this.unitsPerSoldier,
      fieldWidth: this.field.width,
      fieldHeight: this.field.height,
      allowCrossMidline: this.rules.allowCrossMidline
    }))
    .filter((row) => row.startCount > 0);

  const defenderSquads = this.defenderDeployGroups
    .filter((group) => group?.placed !== false)
    .map((group, index) => createSquad({
      group,
      index,
      team: TEAM_DEFENDER,
      unitTypeMap: this.unitTypeMap,
      unitsPerSoldier: this.unitsPerSoldier,
      fieldWidth: this.field.width,
      fieldHeight: this.field.height,
      allowCrossMidline: this.rules.allowCrossMidline
    }))
    .filter((row) => row.startCount > 0);

  const simBase = {
    battleId: this.initData?.battleId || '',
    field: this.field,
    squads: [...attackerSquads, ...defenderSquads],
    buildings: cloneObstacleList(this.initialBuildings),
    effects: [],
    projectiles: [],
    hitEffects: [],
    ended: false
  };

  this.sim = withRepConfig(simBase, this.repConfig);
  this.crowd = createCrowdSim(this.sim, { unitTypeMap: this.unitTypeMap });
  this.sim.crowd = this.crowd;
  this.phase = 'battle';
}
```

## 6.2 CrowdSim/crowdCombat：单位职业/武器/技能是怎么影响战斗的

### 职业影响
- `classTag` 决定攻距、弹道类型、技能分支、目标选择偏好。
- 远程/炮兵走投射物流程，近战走接敌+伤害流程。

### 技能影响
- `triggerCrowdSkill`：
  - infantry -> buff
  - cavalry -> `skillRush`
  - archer/artillery -> `activeSkill` + ground aoe waves
- CD 存在 `squad.skillCooldowns`

### 目标与命中
- `scoreEnemyTargetValue` 用于 guard 目标重评估（0.15s）
- 远程移动惩罚：`MOVING_FIRE_MAX_SPREAD / MOVING_FIRE_MIN_HIT`

### 实现状态
- classTag 驱动战斗差异：✅
- 武器实体化（刀/弓/枪）参数层：❌

### 关键代码片段（移动射击惩罚）
```js
// frontend/src/game/battle/simulation/crowd/crowdCombat.js:206-225
const spawnRangedProjectiles = (sim, crowd, attackerSquad, sourceAgent, targetAgent, category, baseDamage, options = {}) => {
  const speed = projectileSpeedByCategory(category);
  const gravity = category === 'artillery' ? 95 : 70;
  const speedRatio = clamp(Number(options?.speedRatio) || 0, 0, 1);
  const movingPenaltyEnabled = !!options?.movingPenalty && !options?.forceAccurate;
  const spreadRadius = movingPenaltyEnabled ? (2 + (MOVING_FIRE_MAX_SPREAD * speedRatio)) : 0;
  const hitChance = movingPenaltyEnabled ? Math.max(MOVING_FIRE_MIN_HIT, 1 - (0.45 * speedRatio)) : 1;
  for (let i = 0; i < count; i += 1) {
    if (Math.random() > hitChance && (i + 1) < count) continue;
    const randR = movingPenaltyEnabled ? (Math.random() * spreadRadius) : 0;
    const randA = movingPenaltyEnabled ? (Math.random() * Math.PI * 2) : 0;
    const spreadX = randR * Math.cos(randA);
    const spreadY = randR * Math.sin(randA);
    const dir = normalizeVec(
      (targetAgent.x - sourceAgent.x) + spreadX + ...,
      (targetAgent.y - sourceAgent.y) + spreadY + ...
    );
```

## 6.3 训练营里是否复用 battle runtime，还是单独逻辑

- 训练营复用同一个 `BattleSceneModal + BattleRuntime + CrowdSim + renderer`。
- 仅初始化 payload 与模式参数不同（`mode="training"`, `requireResultReport=false`）。

### 实现状态
- 训练/战斗共用 runtime：✅

## 6.4 需要新增的“统一兵种接口”最合适的落点

### 现有雏形判断
- 未发现 `UnitRegistry / UnitAssembler / UnitDBAdapter` 专门模块。
- 现有可切入的最合适位置：
  - 后端：`armyUnitTypeService.js`（序列化入口）
  - 前端战斗：`BattleRuntime.buildUnitTypeMap`（runtime 归一化入口）
  - 前端页面：`ArmyPanel.getUnitId + unitTypeMap`（展示层适配）

### 推荐落点（按职责）
- `backend/services/unitRegistryService.js`（新）
- `backend/models/UnitDefinition.js`（新，支持 body/weapon/vehicle/skill/asset）
- `frontend/src/game/unit/UnitRegistryClient.js`（新）
- `frontend/src/game/unit/UnitAssembler.js`（新，unit->squad->agent）
- `BattleRuntime` 仅消费统一 DTO，不再自行推断 class/skill 常量

### 实现状态
- 统一接口雏形：❌

---

# 7. 为“8个全新兵种”落地所需的信息缺口清单

## 缺口列表（含最可能代码入口）

1. 兵种列表展示字段（兵营卡片）
- 缺口：需要明确新增字段集合（如阵营标签、稀有度、定位、可用武器/载具、是否可训练/可解锁）。
- 当前入口：`frontend/src/components/game/ArmyPanel.js`、`backend/services/armyUnitTypeService.js`
- 状态：🟡（现有字段仅基础数值）

2. 兵种详情字段（技能、行为模式、韧性/打断条）
- 缺口：DB schema 中无 `skills[]`、`behaviorProfile`、`poise/stagger`。
- 当前入口：`backend/models/ArmyUnitType.js`
- 状态：❌

3. 资产字段（战场小人贴图、近景模型贴图、旋转预览）
- 缺口：缺少 `battleVisual`/`previewModel`/`material`/`lod` 字段与资源路径规范。
- 当前入口：`backend/models/ArmyUnitType.js`、`frontend/src/game/battle/presentation/assets/UnitVisualConfig.example.json`
- 状态：❌

4. DB 表结构与 API 契约
- 缺口：需要统一定义 `UnitDefinition` API（版本、兼容策略、默认值）并替代多处硬编码。
- 当前入口：`backend/routes/army.js`, `backend/routes/nodes.js`, `backend/routes/admin.js`
- 状态：❌

5. unit -> squad -> agent 的映射策略
- 缺口：目前主要基于 classTag 推断；缺少可配置 weapon/vehicle 对 agent 行为的精确映射。
- 当前入口：`frontend/src/game/battle/presentation/runtime/BattleRuntime.js:createSquad`, `CrowdSim.createCrowdSim`
- 状态：🟡

6. 技能定义来源统一化
- 缺口：技能配置硬编码在前端 runtime/sim；未由后端目录下发。
- 当前入口：`BattleRuntime.js (SKILL_*)`, `CrowdSim.js (GROUND_SKILL_CONFIG)`
- 状态：❌

7. 训练/解锁逻辑
- 缺口：当前为“征召直接加库存 + 训练场即时沙盘”；无训练队列/解锁树。
- 当前入口：`backend/routes/army.js`（可扩展 `training queue` API）
- 状态：❌

8. 近景 3D 预览渲染器
- 缺口：兵营详情区目前只有 DOM 占位，未接真实模型和贴图。
- 当前入口：`ArmyPanel.js`（详情弹窗）+ 可复用 `BattlefieldPreviewModal.js` 的 Three.js 管线
- 状态：❌

---

# 8. “实现计划草案”（只写计划，不要改代码）

## Phase 1：引入统一单位 schema + registry（不破坏现有）

### 目标
- 在不改现有接口返回结构前提下，引入 `UnitDefinition` 标准结构与兼容转换器。

### 关键修改文件
- 新增：`backend/models/UnitDefinition.js`
- 新增：`backend/services/unitRegistryService.js`
- 修改：`backend/services/armyUnitTypeService.js`（旧字段 -> 新 DTO）
- 修改：`frontend/src/game/battle/presentation/runtime/BattleRuntime.js`（消费统一 DTO）

### 风险点
- 兼容旧 `ArmyUnitType` 数据时可能出现字段缺失。
- classTag 推断逻辑切换时要保持战斗平衡一致。

## Phase 2：DB 持久化（表结构、seed、API）

### 目标
- 新增单位定义持久化与 admin 管理 API。

### 关键修改文件
- `backend/models/UnitDefinition.js`（新）
- `backend/routes/admin.js`（新增单位定义 CRUD）
- `backend/routes/army.js`（对外读取统一单位定义）
- `backend/seed/bootstrap_catalog_data.json`（扩展为新 schema）
- `backend/scripts/initCatalogAndUnitData.js`（seed 兼容）

### 风险点
- 老数据迁移（`ArmyUnitType` -> `UnitDefinition`）需要幂等脚本。
- 训练营与围城 battle-init 要保持返回兼容。

## Phase 3：兵营页面展示（属性+技能+3D预览）

### 目标
- 兵营详情页展示完整单位定义字段 + 真实旋转 3D 预览。

### 关键修改文件
- `frontend/src/components/game/ArmyPanel.js`
- 新增：`frontend/src/components/game/unit-preview/UnitPreviewCanvas3D.js`（可复用 Three.js）
- `frontend/src/components/game/ArmyPanel.css`

### 风险点
- UI 性能与资源加载失败降级策略。
- 模型资源缺失时需 fallback 占位材质。

## Phase 4：训练营与战场接入（放置、训练、生成）

### 目标
- 训练营/战场基于统一 schema 生成 squad/agent，技能从数据驱动。

### 关键修改文件
- `frontend/src/components/game/TrainingGroundPanel.js`
- `frontend/src/game/battle/screens/BattleSceneContainer.js`
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
- `frontend/src/game/battle/simulation/crowd/CrowdSim.js`
- `frontend/src/game/battle/simulation/crowd/crowdCombat.js`

### 风险点
- 大规模仿真稳定性（2万单位）受新增动态配置影响。
- 客户端/服务端单位定义版本不一致导致战斗初始化失败。

## Phase 5：8个新兵种的数据落库与资产接入

### 目标
- 8 个新兵种全量接入（目录、技能、贴图、预览、战斗表现）。

### 关键修改文件
- `backend/seed/bootstrap_catalog_data.json`
- `backend/scripts/initCatalogAndUnitData.js`
- `frontend/src/game/battle/presentation/assets/UnitVisualConfig.example.json`（或替换为真实 registry 驱动）
- 新增资源清单与加载器（前端）

### 风险点
- 平衡性与技能参数过多导致调优成本上升。
- 资产体积变大造成首屏加载和 GPU 内存压力。

---

## 关键入口点清单（“8个新兵种 + DB持久化 + 统一接口”）

- `backend/models/ArmyUnitType.js`（现有单位 schema，需升级或迁移）
- `backend/services/armyUnitTypeService.js:serializeArmyUnitType`（标准化输出入口）
- `backend/routes/army.js:/unit-types,/training/init,/me`（前台单位读取入口）
- `backend/routes/nodes.js:/:nodeId/siege/pve/battle-init`（战场单位 payload 入口）
- `backend/routes/admin.js:/army/unit-types*`（后台管理入口）
- `frontend/src/components/game/ArmyPanel.js:fetchArmyData`（兵营消费入口）
- `frontend/src/components/game/TrainingGroundPanel.js:fetchTrainingInit`（训练营入口）
- `frontend/src/game/battle/screens/BattleSceneContainer.js:setupRuntime/frame`（战斗 UI->runtime 桥接）
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:buildUnitTypeMap/createSquad/startBattle`（战斗单位装配核心）
- `frontend/src/game/battle/simulation/crowd/CrowdSim.js:createCrowdSim/triggerCrowdSkill/updateCrowdSim`（仿真核心）
- `frontend/src/game/battle/simulation/crowd/crowdCombat.js:updateCrowdCombat`（伤害/命中/投射物）
- `frontend/src/game/battle/presentation/assets/UnitVisualConfig.example.json`（视觉索引映射）

---

# 附录：Search Hits

以下为本次审计中最关键的 30 条检索命中（`路径:行号 + 关键词 + 说明`）：

1. `frontend/src/App.js:5962` | `setView('army')` | 军事菜单进入兵营
2. `frontend/src/App.js:5973` | `setView('trainingGround')` | 军事菜单进入训练营
3. `frontend/src/App.js:6188` | `view === "army"` | 兵营页面挂载点
4. `frontend/src/App.js:6191` | `view === "trainingGround"` | 训练营页面挂载点
5. `frontend/src/App.js:3145` | `handleOpenSiegePveBattle` | 围城战斗入口函数
6. `frontend/src/App.js:3165` | `siege/pve/battle-init` | 围城战斗初始化 API 调用
7. `frontend/src/App.js:6616` | `BattleSceneModal` | 战斗 modal 挂载
8. `frontend/src/components/game/TrainingGroundPanel.js:33` | `/api/army/training/init` | 训练营初始化 API
9. `frontend/src/components/game/TrainingGroundPanel.js:58` | `BattleSceneModal` | 训练营复用战斗场景
10. `frontend/src/components/game/ArmyPanel.js:181` | `fetchArmyData` | 兵营数据聚合入口
11. `frontend/src/components/game/ArmyPanel.js:193` | `/army/unit-types` | 兵种目录拉取
12. `frontend/src/components/game/ArmyPanel.js:194` | `/army/me` | 用户 roster 拉取
13. `frontend/src/components/game/ArmyPanel.js:199` | `/army/templates` | 用户模板拉取
14. `frontend/src/components/game/ArmyPanel.js:266` | `beginDetailRotationDrag` | 详情拖拽旋转
15. `frontend/src/game/battle/screens/BattleSceneContainer.js:539` | `new BattleRuntime` | 战斗运行时创建
16. `frontend/src/game/battle/screens/BattleSceneContainer.js:375` | `new BattleClock` | 固定步长时钟
17. `frontend/src/game/battle/screens/BattleSceneContainer.js:376` | `new CameraController` | 相机控制器创建
18. `frontend/src/game/battle/screens/BattleSceneContainer.js:845` | `clockRef.current.tick` | 固定步长驱动 runtime.step
19. `frontend/src/game/battle/screens/BattleSceneContainer.js:898` | `getRenderSnapshot` | 仿真到渲染快照桥接
20. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:1044` | `startBattle` | deploy->battle 转换入口
21. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:1134` | `pickSquadAtPoint` | 地图选中 squad
22. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:1307` | `commandMove` | 右键移动命令
23. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js:1466` | `commandSkill` | 技能下发 runtime 入口
24. `frontend/src/game/battle/simulation/crowd/CrowdSim.js:1268` | `createCrowdSim` | squad->agent 仿真初始化
25. `frontend/src/game/battle/simulation/crowd/CrowdSim.js:1340` | `triggerCrowdSkill` | 技能核心逻辑
26. `frontend/src/game/battle/simulation/crowd/crowdCombat.js:67` | `scoreEnemyTargetValue` | guard 目标评分
27. `frontend/src/game/battle/simulation/crowd/crowdCombat.js:206` | `spawnRangedProjectiles` | 远程投射物生成
28. `frontend/src/game/battle/simulation/crowd/crowdPhysics.js:215` | `buildSpatialHash` | 空间哈希
29. `backend/routes/army.js:327` | `/training/init` | 训练场战斗初始化后端
30. `backend/routes/nodes.js:7726` | `/siege/pve/battle-init` | 围城战斗初始化后端
