# BATTLEFIELD_PREVIEW_EDITOR_AUDIT

## 1. Scope & Baseline Requirements

本审计仅覆盖“承门/启门战场预览/编辑”相关前后端代码路径，并以你给出的需求为唯一基准。

### Baseline requirements（原样对照 + 打勾/打叉）

- ⚠️ UI：承门/启门布防按钮旁有“战场预览”，弹出战场浮窗；风格一致；战场可拖拽平移；预览角 45°；编辑角 75°；切换应平滑。
- ❌ 默认：每个知识域（每个 gate）默认 10 个木墙。
- ⚠️ 放置：编辑模式下可进入放置；ghost 半透明跟鼠标；左键确认放置；右键取消；滚轮旋转水平 yaw。
- ⚠️ 碰撞+吸附：重叠时触发吸附而非重叠放置；上方堆叠（鼠标落在 footprint 内）+ 前后左右吸附（靠近边界/侧面）+ 边缘吸附；堆叠最高 5；吸附时的滚轮规则（堆叠锁 yaw；侧面吸附需“像磁铁一样就近找最方便贴合的面”）。
- ⚠️ 数值：物品有 hp/def/尺寸；放置后头顶显示 HP/DEF；组合体聚合显示：HP 求和；DEF=单体×1.1（只乘一次）。
- ⚠️ 持久化：按 nodeId + gateKey 保存/读取布局（优先 API，其次 localStorage）；刷新可恢复。

判定说明：`⚠️` = 部分满足。UI 入口（按钮+弹窗）已存在，但同一条需求内的平滑切换、平移/放置手感、整体交互一致性未达标，因此整体判定为“部分满足”。
补充说明：持久化已具备 API 保存/读取并可在 API 正常时恢复；缺口是 API 失败时缺少 localStorage 本地回退与离线保存策略。
补充说明：碰撞与吸附类型（top/side/edge）已存在；缺口是侧吸附 yaw 对齐与磁铁贴面体验不足，且超限/非法状态提示不完整。

---

## 2. Code Discovery (Search hits & key files)

### 审计动作（已执行）

- `rg -n "battle|battlefield|战场|preview|deploy|布防|gate|承门|启门|wall|wood|ghost|snap|collision|stack|isometric|camera|yaw" frontend backend --glob '!frontend/build/**'`
- `rg -l "battle|battlefield|战场|preview|deploy|布防|gate|承门|启门|wall|wood|ghost|snap|collision|stack|isometric|camera|yaw" frontend backend --glob '!frontend/build/**' | sort`

### 关键文件（按重要度排序）

1. `frontend/src/components/game/BattlefieldPreviewModal.js`
- 战场预览/编辑主实现（Canvas 绘制、ghost、吸附、碰撞、拖拽、缩放、保存加载）。

2. `frontend/src/components/game/KnowledgeDomainScene.js`
- 承/启门布防面板中的“战场预览”入口、弹窗挂载、`nodeId/gateKey` 参数链路。

3. `backend/routes/nodes.js`
- 战场布局 `GET/PUT /api/nodes/:nodeId/battlefield-layout`，含 gate 维度序列化与合并写入。

4. `backend/services/domainTitleStateStore.js`
- 战场状态标准化、默认值、旧结构兼容、集合读写。

5. `backend/models/DomainDefenseLayout.js`
- `battlefieldLayouts/battlefieldItems/battlefieldObjects` schema 与 legacy `battlefieldLayout` 镜像字段。

6. `backend/scripts/migrateDomainTitleStatesToCollection.js`
- 标题层状态迁移（旧 `battlefieldLayout` -> 新结构）。

7. `frontend/src/components/game/BattlefieldPreviewModal.css`
- 战场弹窗结构样式（顶栏、侧栏、画布、底栏）。

8. `frontend/src/components/game/KnowledgeDomainScene.css`
- 主场景层与战场弹窗叠放关系。

---

## 3. Current UI Entry Points

### 入口位置与参数链路

1. 承/启门布防面板内“战场预览”按钮
- `frontend/src/components/game/KnowledgeDomainScene.js:3642-3648`
- `frontend/src/components/game/KnowledgeDomainScene.js:3668-3675`
- `frontend/src/components/game/KnowledgeDomainScene.js:3683-3690`

2. 打开/关闭状态
- `openBattlefieldPreview`：`frontend/src/components/game/KnowledgeDomainScene.js:1070-1076`
- `closeBattlefieldPreview`：`frontend/src/components/game/KnowledgeDomainScene.js:1078-1083`

3. 弹窗挂载与参数
- `frontend/src/components/game/KnowledgeDomainScene.js:4345-4353`
- 传入 `open/nodeId/gateKey/gateLabel/canEdit/onClose`。

### 弹窗形态与关闭逻辑

- Modal：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 关闭：遮罩点击 `onClick={onClose}`（`BattlefieldPreviewModal.js:1172-1175`）+ 右上角按钮（`BattlefieldPreviewModal.js:1208-1210`）

### UI 结论

- UI 入口存在且可打开弹窗。
- 同一需求链路内仍有关键缺口：视角切换瞬切、放置态与平移态冲突、侧吸附手感不足。
- 因此 UI 总项判定为“部分满足（⚠️）”，与 Baseline/Gap Matrix 保持一致。

---

## 4. Rendering / Camera / Controls

### 渲染技术栈

- 当前为 **Canvas 2D + 手工投影（伪 3D）**，不是 three.js/WebGL。
- 证据：`canvas.getContext('2d')` + `projectWorld/unprojectScreen`，见 `frontend/src/components/game/BattlefieldPreviewModal.js:240-257`, `frontend/src/components/game/BattlefieldPreviewModal.js:852-861`。

### 相机/投影实现

- `cameraAngle` 仅控制 `getGroundYScale` 与堆叠投影高度：`frontend/src/components/game/BattlefieldPreviewModal.js:48-56`, `frontend/src/components/game/BattlefieldPreviewModal.js:243-249`。
- 45/75 是“俯仰压缩系数”语义，不是完整相机姿态（无 yaw 轴旋转）。

### 平移/缩放

- 左键按住平移：`frontend/src/components/game/BattlefieldPreviewModal.js:1071-1076`, `frontend/src/components/game/BattlefieldPreviewModal.js:1098-1113`。
- 缩放：无 ghost 时滚轮缩放 75%-150%，默认 100%：`frontend/src/components/game/BattlefieldPreviewModal.js:16-20`, `frontend/src/components/game/BattlefieldPreviewModal.js:1131-1140`, `frontend/src/components/game/BattlefieldPreviewModal.js:646-651`。

### Camera Model Clarification: pseudo-3D vs RTS isometric

- 结论 1：当前不是“真等距 RTS 相机”，而是 2D 画布上的 y 轴压缩 + z 高度偏移模拟。
- 结论 2：当前不具备“yaw=45° + tilt=45° + 正交相机”的语义；没有 yaw 旋转矩阵，也没有正交相机参数。
- 结论 3：因此视觉与交互会表现为“俯仰变化存在，但朝向语义弱、吸附方向感偏僵硬”。

达到目标体验的两条可执行路径（方案，不改代码）：

- 路径 A（保留 Canvas 体系）
1. 将 `world -> screen` 统一到同一变换链：`Rz(yaw) * Rx(tilt) * S(scale) + T(pan)`。
2. `projectWorld/unprojectScreen` 同时接受 `yaw/tilt`，并保证逆变换可用于鼠标落点。
3. 吸附/碰撞统一在 world 坐标求解，渲染仅消费求解结果。
4. 45/75 切换使用 `requestAnimationFrame` 插值 yaw/tilt，避免瞬切。

- 路径 B（切换 three.js/WebGL）
1. 使用 `OrthographicCamera`（或严格约束的 `PerspectiveCamera`），将 `azimuth(yaw)` 与 `polar(tilt)` 分离。
2. 控制器使用 `OrbitControls`，锁定 `minAzimuthAngle=maxAzimuthAngle`（预览固定 yaw），编辑时仅允许指定范围。
3. 地图拾取用 `Raycaster` 打到战场 plane，得到世界坐标后进入同一套放置解算。
4. 视角切换用 camera tween（200-250ms），并保持 pan/zoom 连续。

---

## 5. Placement System (ghost / rotation / collision / snapping / stacking)

### ghost 与放置输入

- 左侧物品栏选择后创建 ghost：`frontend/src/components/game/BattlefieldPreviewModal.js:671-699`。
- ghost 跟随鼠标：`frontend/src/components/game/BattlefieldPreviewModal.js:657-669`。
- 左键确认放置：`frontend/src/components/game/BattlefieldPreviewModal.js:1043-1068`。
- 右键取消：`frontend/src/components/game/BattlefieldPreviewModal.js:1029-1037`。
- 滚轮旋转 yaw：`frontend/src/components/game/BattlefieldPreviewModal.js:1155-1159`。

### 碰撞

- 使用 OBB 2D SAT：`getRectCorners + isRectOverlap`，见 `frontend/src/components/game/BattlefieldPreviewModal.js:259-314`。
- 阻塞仅检测同 z：`frontend/src/components/game/BattlefieldPreviewModal.js:485-487`。

### 吸附

- top 吸附：鼠标落入 footprint 且 `z < 4`，见 `frontend/src/components/game/BattlefieldPreviewModal.js:387-399`。
- 侧吸附：`left/right/front/back` 局部最近边 + 简化 yaw 对齐，见 `frontend/src/components/game/BattlefieldPreviewModal.js:403-450`。
- 边缘吸附：近边后 clamp，见 `frontend/src/components/game/BattlefieldPreviewModal.js:453-476`。
- 堆叠上限：`MAX_STACK_LEVEL = 5`，见 `frontend/src/components/game/BattlefieldPreviewModal.js:8`。

### 放置手感关键偏差

- ghost 存在时，`mousemove` 优先驱动 ghost 更新并 `return`，平移手势无法并存。
- 侧吸附 yaw 候选只有 `anchorYaw` 与 `anchorYaw+90` 两种，达不到“磁铁式就近最优贴面”。
- 堆叠超限没有明确 UI 提示文案。

---

## 6. Stats Overlay & Cluster Aggregation

### 数值字段

- 前端默认：`BASE_HP/BASE_DEFENSE/WALL_WIDTH/DEPTH/HEIGHT`，见 `frontend/src/components/game/BattlefieldPreviewModal.js:9-13`。
- 后端物品定义：`battlefieldItems`，见 `backend/models/DomainDefenseLayout.js:193-233`。

### 标签渲染

- 头顶 `HP/DEF` 在 Canvas 上绘制（非 DOM overlay）：`frontend/src/components/game/BattlefieldPreviewModal.js:964-987`。

### 组合体聚合规则

- 聚合入口：`getWallGroupMetrics`，见 `frontend/src/components/game/BattlefieldPreviewModal.js:500-571`。
- HP：求和，见 `frontend/src/components/game/BattlefieldPreviewModal.js:549`。
- DEF：组内数量 > 1 时只乘一次 1.1，见 `frontend/src/components/game/BattlefieldPreviewModal.js:550-552`。

### 偏差结论

- 当前并组使用“重叠或距离阈值”混合条件，不是严格“物理接触”定义，存在误并组。

---

## 7. Persistence (API / DB / localStorage)

### 后端

- Schema：`battlefieldLayouts/battlefieldItems/battlefieldObjects` + legacy `battlefieldLayout`，见 `backend/models/DomainDefenseLayout.js:235-322`。
- API：
  - `GET /api/nodes/:nodeId/battlefield-layout`：`backend/routes/nodes.js:6989-7034`
  - `PUT /api/nodes/:nodeId/battlefield-layout`：`backend/routes/nodes.js:7042-7091`
- gate 维度序列化：`serializeBattlefieldStateForGate` 仅返回 active layout objects，见 `backend/routes/nodes.js:2152-2163`。

### 前端

- 读取：弹窗打开时 GET，见 `frontend/src/components/game/BattlefieldPreviewModal.js:767-769`。
- 保存：放置后触发 PUT，见 `frontend/src/components/game/BattlefieldPreviewModal.js:701-721`, `frontend/src/components/game/BattlefieldPreviewModal.js:1061-1062`。
- localStorage 仅用于 token，不含布局缓存键/读写逻辑，见 `frontend/src/components/game/BattlefieldPreviewModal.js:704`, `frontend/src/components/game/BattlefieldPreviewModal.js:742`。

### 刷新恢复结论

- API 正常时：可恢复。
- 无 token 或 API 失败时：直接退空布局，不存在 localStorage 回退恢复。

### Default 10 Walls: Initialization Causal Chain (Why it doesn't stick)

时间线因果链（确定结论）：

1. 初始化阶段（后端默认）
- 默认状态不含默认木墙对象：`objects: []`。
- 证据：`backend/services/domainTitleStateStore.js:93-99`，`backend/models/DomainDefenseLayout.js:315-318`。

2. 加载阶段（前端读 API）
- 前端读取后不会对“空对象”做 seed；空就是最终值。
- 无 token/API 失败时也回退 `fallbackWalls = []`。
- 证据：`frontend/src/components/game/BattlefieldPreviewModal.js:747-751`, `frontend/src/components/game/BattlefieldPreviewModal.js:773-774`, `frontend/src/components/game/BattlefieldPreviewModal.js:811-812`。

3. 覆盖阶段（旧默认布局清空）
- 命中 `isLegacyDefaultDeployment` 后执行 `setWalls([])`，再通过 `pendingPersistRef` 持久化空对象，覆盖原数据。
- 证据：`frontend/src/components/game/BattlefieldPreviewModal.js:792-794`, `frontend/src/components/game/BattlefieldPreviewModal.js:806-809`, `frontend/src/components/game/BattlefieldPreviewModal.js:846-850`。

4. 合并保存阶段（按 gate replace 当前 layout 对象）
- PUT 合并时，目标 layout 直接采用传入对象列表；传空即保存空。
- 证据：`backend/routes/nodes.js:2211-2226`, `backend/routes/nodes.js:2227-2233`。

5. 迁移/兼容阶段
- 迁移脚本与 normalize 默认都继承 `createDefaultBattlefieldState()`，其 `objects` 仍为空，不会补 10 墙。
- 证据：`backend/scripts/migrateDomainTitleStatesToCollection.js:66-74`, `backend/services/domainTitleStateStore.js:93-99`。

最小修复点（建议，不改代码）：
- 在后端 `normalizeBattlefieldState` 或 `serializeBattlefieldStateForGate` 对空 gate 执行 `seedGateDefaultWallsIfEmpty`。
- 前端移除“旧默认10墙 -> 清空”分支，改为“旧结构迁移 -> 标准化后保留对象”。
- `mergeBattlefieldStateByGate` 增加“空对象且为首次初始化时自动补 seed”分支，避免 replace 成空。

### P0/P1关键代码片段（10~20行，A-E）

#### A) 默认 10 木墙初始化/清空/覆盖

文件：`backend/services/domainTitleStateStore.js`（L81-L99）
说明：后端默认战场状态仅初始化 layout/item，不初始化对象实例（`objects: []`）。

```js
const createDefaultBattlefieldItems = () => ([
  {
    itemType: BATTLEFIELD_OBJECT_DEFAULTS.itemType,
    name: '木墙',
    width: BATTLEFIELD_OBJECT_DEFAULTS.width,
    depth: BATTLEFIELD_OBJECT_DEFAULTS.depth,
    height: BATTLEFIELD_OBJECT_DEFAULTS.height,
    hp: BATTLEFIELD_OBJECT_DEFAULTS.hp,
    defense: BATTLEFIELD_OBJECT_DEFAULTS.defense
  }
]);

const createDefaultBattlefieldState = () => ({
  version: BATTLEFIELD_VERSION,
  layouts: createDefaultBattlefieldLayouts(),
  items: createDefaultBattlefieldItems(),
  objects: [],
  updatedAt: new Date()
});
```

文件：`frontend/src/components/game/BattlefieldPreviewModal.js`（L789-L808）
说明：前端会把“旧默认10墙”识别后直接清空，并准备回写，导致默认墙不保留。

```js
const layoutBundle = (data?.layoutBundle && typeof data.layoutBundle === 'object') ? data.layoutBundle : {};
const nextCatalog = normalizeItemCatalog(layoutBundle.itemCatalog);
const loadedWalls = mapLayoutBundleToWalls(layoutBundle);
const shouldConvertLegacyDefault = isLegacyDefaultDeployment(loadedWalls);
setWalls(shouldConvertLegacyDefault ? [] : loadedWalls);
setItemCatalog(nextCatalog);
setActiveLayoutMeta({
  layoutId: typeof layoutBundle?.activeLayout?.layoutId === 'string' ? layoutBundle.activeLayout.layoutId : `${gateKey || 'cheng'}_default`,
  name: typeof layoutBundle?.activeLayout?.name === 'string' ? layoutBundle.activeLayout.name : '',
  fieldWidth: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldWidth)) ? Number(layoutBundle.activeLayout.fieldWidth) : FIELD_WIDTH,
  fieldHeight: Number.isFinite(Number(layoutBundle?.activeLayout?.fieldHeight)) ? Number(layoutBundle.activeLayout.fieldHeight) : FIELD_HEIGHT,
  maxItemsPerType: Number.isFinite(Number(layoutBundle?.activeLayout?.maxItemsPerType))
    ? Number(layoutBundle.activeLayout.maxItemsPerType)
    : TOTAL_WOOD_WALL_STOCK
});
setServerCanEdit(!!data.canEdit);
if (shouldConvertLegacyDefault && !!data.canEdit) {
  pendingPersistRef.current = true;
}
```

#### B) API save/load 与 localStorage fallback 缺失

文件：`frontend/src/components/game/BattlefieldPreviewModal.js`（L701-L717）
说明：保存流程只依赖 token + API PUT，没有本地布局写入分支。

```js
const persistBattlefieldLayout = useCallback(async (nextWalls = [], options = {}) => {
  if (!open || !nodeId || !effectiveCanEdit) return { ok: false };
  const silent = options?.silent !== false;
  const token = localStorage.getItem('token');
  if (!token) return { ok: false };

  if (!silent) setSavingLayout(true);
  try {
    const response = await fetch(`${API_BASE}/api/nodes/${nodeId}/battlefield-layout`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(buildLayoutPayload({
        walls: nextWalls,
```

文件：`frontend/src/components/game/BattlefieldPreviewModal.js`（L742-L760）
说明：读取失败路径直接回退空布局，也没有本地缓存读取。

```js
const token = localStorage.getItem('token');
const loadLayout = async () => {
  setLoadingLayout(true);
  setLayoutReady(false);
  setErrorText('');
  const fallbackWalls = [];
  if (!token) {
    if (!cancelled) {
      setWalls(fallbackWalls);
      setItemCatalog(normalizeItemCatalog([]));
      setActiveLayoutMeta({
        layoutId: `${gateKey || 'cheng'}_default`,
        name: '',
        fieldWidth: FIELD_WIDTH,
        fieldHeight: FIELD_HEIGHT,
        maxItemsPerType: TOTAL_WOOD_WALL_STOCK
      });
      setServerCanEdit(false);
```

#### C) ghost 放置态与平移事件冲突

文件：`frontend/src/components/game/BattlefieldPreviewModal.js`（L1043-L1062）
说明：有 ghost 时左键逻辑直接进入放置分支并 `return`，不会进入平移起始分支。

```js
if (ghost) {
  const evaluated = evaluateGhostPlacement({ ...ghost, x: world.x, y: world.y }, walls, world, fieldWidth, fieldHeight);
  if (evaluated.blocked) {
    setMessage('当前位置已被占用，无法放置');
    setGhost(evaluated.ghost);
    setGhostBlocked(true);
    setSnapState(evaluated.snap);
    return;
  }
  if (!effectiveCanEdit) {
    setMessage('当前仅可预览，不可编辑战场');
    return;
  }
  if (wallStockRemaining <= 0) {
    setMessage('木墙库存不足，无法放置');
    return;
  }
  const nextWall = createWallFromLike(evaluated.ghost);
  pendingPersistRef.current = true;
  setWalls((prev) => [...prev, nextWall]);
```

文件：`frontend/src/components/game/BattlefieldPreviewModal.js`（L1089-L1098）
说明：鼠标移动时 ghost 分支优先返回，阻断平移态并存。

```js
const world = unprojectScreen(point.x, point.y, viewport, cameraAngle, worldScale);
mouseWorldRef.current = world;

if (ghost) {
  syncGhostByMouse(ghost);
  return;
}
};

useEffect(() => {
```

#### D) 侧吸附 yaw 候选过窄（仅 0/90 族）

文件：`frontend/src/components/game/BattlefieldPreviewModal.js`（L423-L437）
说明：侧吸附旋转只在 `anchorYaw` 与 `anchorYaw+90` 里选最近，缺乏磁铁式最优接触面搜索。

```js
const anchor = bestSide.wall;
const baseRotation = normalizeDeg(anchor.rotation);
const rotationAligned = getNearestRotation(nextGhost.rotation, [baseRotation, baseRotation + 90]);
let offsetLocalX = 0;
let offsetLocalY = 0;
if (bestSide.side === 'right') {
  offsetLocalX = (anchor.width / 2) + (nextGhost.width / 2);
} else if (bestSide.side === 'left') {
  offsetLocalX = -((anchor.width / 2) + (nextGhost.width / 2));
} else if (bestSide.side === 'front') {
  offsetLocalY = (anchor.depth / 2) + (nextGhost.depth / 2);
} else {
  offsetLocalY = -((anchor.depth / 2) + (nextGhost.depth / 2));
}
const rad = degToRad(anchor.rotation);
```

#### E) 组合体并组判定导致误并组

文件：`frontend/src/components/game/BattlefieldPreviewModal.js`（L506-L517）
说明：同层并组允许“距离阈值”成立，不要求真实接触面，导致近距误并组。

```js
const isConnected = (a, b) => {
  const zDelta = Math.abs((a.z || 0) - (b.z || 0));
  if (zDelta > 1) return false;
  if (zDelta === 1) {
    const overlap2D = isRectOverlap(a, b, 0.2);
    return overlap2D;
  }

  if (isRectOverlap(a, b, -2)) return true;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  return dist <= ((Math.max(a.width, a.depth) + Math.max(b.width, b.depth)) * 0.55);
};
```

---

## 8. Gap Matrix (Requirement-by-requirement)

| 需求点 | 当前实现(是/否/部分) | 证据(文件+函数) | 差距描述 | 建议修复方案 |
|---|---|---|---|---|
| UI 总项（按钮+弹窗+风格+平移+45/75+平滑切换） | 部分 | `KnowledgeDomainScene.js:3642-3648/4345-4353`, `BattlefieldPreviewModal.js:4-5/1071-1076/1196-1199` | 入口存在，但切换瞬切、交互手感未达标 | 对应 P1-1/P1-2 |
| 承/启门布防旁有“战场预览”按钮 | 是 | `frontend/src/components/game/KnowledgeDomainScene.js:3642-3648`, `frontend/src/components/game/KnowledgeDomainScene.js:3668-3675`, `frontend/src/components/game/KnowledgeDomainScene.js:3683-3690` | 已实现 | 保持 |
| 点击后弹出战场浮窗 | 是 | `frontend/src/components/game/KnowledgeDomainScene.js:4345-4353` | 已实现 | 保持 |
| 视角 45°/75° | 部分 | `frontend/src/components/game/BattlefieldPreviewModal.js:4-5`, `frontend/src/components/game/BattlefieldPreviewModal.js:1196-1199`, `BATTLEFIELD_PREVIEW_EDITOR_AUDIT.md#L102` | 仅有 cameraAngle/tilt 参数，不具备 yaw=45° 的等距相机语义，观感与交互仍偏僵硬（见 Camera Model Clarification） | 对应 P1-1 + Camera Model Clarification |
| 视角切换平滑 | 否 | `frontend/src/components/game/BattlefieldPreviewModal.js:1196-1199` | 直接 set 状态，无 tween | 对应 P1-1 |
| 每个 gate 默认 10 木墙 | 否 | `backend/services/domainTitleStateStore.js:93-99`, `frontend/src/components/game/BattlefieldPreviewModal.js:792-794` | 默认对象为空，且前端有清空分支 | 对应 P0-1 |
| ghost 跟随 + 左键放置 + 右键取消 + 滚轮 yaw | 部分 | `frontend/src/components/game/BattlefieldPreviewModal.js:657-669`, `frontend/src/components/game/BattlefieldPreviewModal.js:1029-1037`, `frontend/src/components/game/BattlefieldPreviewModal.js:1043-1068`, `frontend/src/components/game/BattlefieldPreviewModal.js:1155-1159` | 核心有，但缺 ESC 取消与放置/平移并存机制 | 对应 P1-2/P1-3 |
| 碰撞+吸附（重叠转吸附） | 部分 | `frontend/src/components/game/BattlefieldPreviewModal.js:374-497` | 有 top/side/edge，但侧吸附求解简化 | 对应 P0-3 |
| 堆叠最高 5 | 是 | `frontend/src/components/game/BattlefieldPreviewModal.js:8`, `frontend/src/components/game/BattlefieldPreviewModal.js:390` | 上限生效 | 对应 P1-3（提示补齐） |
| 侧吸附磁铁感（就近最优贴合） | 否 | `frontend/src/components/game/BattlefieldPreviewModal.js:425` | 候选 yaw 过少，缺少评价函数与最小旋转代价 | 对应 P0-3 + 伪代码 |
| HP/DEF 头顶显示 | 是 | `frontend/src/components/game/BattlefieldPreviewModal.js:964-987` | 已实现 | 保持 |
| 聚合：HP 求和 / DEF×1.1 一次 | 是 | `frontend/src/components/game/BattlefieldPreviewModal.js:549-552` | 已实现 | 保持 |
| 聚合连接定义=真实接触 | 否 | `frontend/src/components/game/BattlefieldPreviewModal.js:514-516` | 距离阈值导致误并组 | 对应 P0-4 |
| 按 nodeId+gateKey API 保存读取 | 是 | `frontend/src/components/game/BattlefieldPreviewModal.js:709-721`, `frontend/src/components/game/BattlefieldPreviewModal.js:767-769`, `backend/routes/nodes.js:6989-7091` | API链路完整 | 保持 |
| API优先 + localStorage回退 | 否 | `frontend/src/components/game/BattlefieldPreviewModal.js:704`, `frontend/src/components/game/BattlefieldPreviewModal.js:742-760` | localStorage 仅 token | 对应 P0-2 |
| 刷新恢复 | 部分 | `frontend/src/components/game/BattlefieldPreviewModal.js:767-803` | API正常可恢复；离线不可恢复 | 对应 P0-2 |

---

## 9. TODO Roadmap (P0/P1/P2)

### P0（核心玩法正确性 / 数据可靠性）

1. **默认 10 木墙做成后端真实默认（按 gate）**
- 建议修改文件：
  - `backend/services/domainTitleStateStore.js`
  - `backend/models/DomainDefenseLayout.js`
  - `backend/routes/nodes.js`
- 建议新增函数/模块：
  - `createDefaultBattlefieldObjectsByGate(layouts, itemCatalog)`
  - `seedGateDefaultWallsIfEmpty(state, gateKey)`
- 预期行为：任何新知识域、空 gate、旧结构迁移后 gate，都有 10 墙初始对象。
- 验收方式：新建节点 + 刷新 + 切 gate，均保留 10 墙。

2. **持久化回退链路：API 优先 + localStorage 兜底**
- 建议修改文件：
  - `frontend/src/components/game/BattlefieldPreviewModal.js`
- 建议新增函数/模块：
  - `getBattlefieldCacheKey(nodeId, gateKey, layoutId)`
  - `readBattlefieldCache()`
  - `writeBattlefieldCache()`
  - `loadBattlefieldWithFallback()`
- 预期行为：GET/PUT失败时读写本地缓存；网络恢复后自动回写 API。
- 验收方式：保存后断网刷新仍恢复；恢复网络后 server 状态追平。

3. **侧吸附“磁铁感”落地：候选 yaw + 评分函数 + 约束求解**
- 建议修改文件：
  - `frontend/src/components/game/BattlefieldPreviewModal.js`
- 建议新增函数/模块：
  - `buildYawCandidatesFromGhost(ghostYaw)`
  - `buildYawCandidatesFromTarget(targetYaw)`
  - `scoreSnapCandidate(candidate)`
  - `solveMagneticSnap(...)`
- 规则约束：
  - 堆叠吸附时：`snappedYaw = anchorYaw`（滚轮失效）。
  - 侧面/边缘吸附时：滚轮只改变 `ghostYaw`（玩家意图），并在每次输入后重新执行 `solveMagneticSnap`。
  - 评分采用“法向对齐优先过滤 + 最小旋转代价优先 tie-break”，保证贴面平行同时尽量减少跳变。
  - 若滚轮后所有候选均越界或碰撞，则本帧判定 `valid=false` 并显示 invalid（红色），不提交放置。
- 候选 yaw 生成（两套可选并可合并）：
  - 方案1（基于 ghost 当前角）：`{yaw, yaw±90, yaw±180}`
  - 方案2（基于 target 角）：`{targetYaw + k*90, k∈Z}`
- 评价函数 `score`：
  - 法向对齐误差（越平行越低分）
  - 旋转代价（`|Δyaw|` 越小越低分）
  - 鼠标接近度（接触点距离越小越低分）
  - 硬约束：越界/碰撞直接淘汰

伪代码（10~25 行，可直接落实现有求解器）：

```text
function solveMagneticSnap(ghostYaw, targetYaw, mousePos, targetOBB, battleBounds):
  if mousePos in targetOBB.topFootprint and targetOBB.stackLevel < 5:
    return { snappedPos: targetOBB.topCenter, snappedYaw: targetYaw, snapType: "top", valid: true }

  c1 = {ghostYaw, ghostYaw+90, ghostYaw-90, ghostYaw+180}
  c2 = {targetYaw, targetYaw+90, targetYaw+180, targetYaw+270}
  candidatesYaw = unique(normalizeAll(c1 union c2))

  best = null
  for yaw in candidatesYaw:
    pose = projectGhostToNearestSideOrEdge(yaw, mousePos, targetOBB, battleBounds)
    if pose == null: continue
    if outOfBounds(pose, battleBounds): continue
    if collidesAny(pose): continue

    alignErr = 1 - abs(dot(pose.faceNormal, negate(targetOBB.faceNormal)))
    if alignErr > 0.20: continue
    rotateCost = angleDistance(yaw, ghostYaw) / 180
    mouseCost = distance(mousePos, pose.contactPoint) / referenceLength
    score = 0.45*alignErr + 0.40*rotateCost + 0.15*mouseCost

    if best == null
       or rotateCost < best.rotateCost - 1e-6
       or (abs(rotateCost - best.rotateCost) <= 1e-6 and score < best.score):
      best = { pose, yaw, rotateCost, score, snapType: pose.snapType }

  if best == null: return { snappedPos: null, snappedYaw: ghostYaw, snapType: "none", valid: false }
  return { snappedPos: best.pose.center, snappedYaw: best.yaw, snapType: best.snapType, valid: true }
```

- 验收方式：任意 yaw 贴近目标时都能稳定给出“最顺手贴合面”，且不越界不穿模。

4. **组合体聚合改为真实连接定义**
- 建议修改文件：
  - `frontend/src/components/game/BattlefieldPreviewModal.js`
- 建议新增函数：
  - `isPhysicallyConnected(a, b)`（共享边/面/竖向接触）
- 预期行为：只对真实接触对象做 HP/DEF 聚合，不再“近距离误并组”。
- 验收方式：两墙相距很近但不接触时，显示两个独立标签。

### P1（手感 / 交互一致性）

1. **45° ↔ 75° 视角平滑切换**
- 建议修改文件：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 建议新增函数：`animateCameraAngle(targetAngle, durationMs = 220)`
- 预期行为：切换编辑态时 200~250ms 平滑，不瞬切。
- 验收方式：连续切换编辑/预览，角度过渡连贯。

2. **放置态与平移态并存（解除冲突）**
- 建议修改文件：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 建议新增函数：`isPanModifierPressed(event)`（示例：`Space + LMB` 平移）
- 预期行为：有 ghost 时也能临时平移视图，松开后继续放置。
- 验收方式：选中 ghost 后按住空格拖拽可平移，不触发放置。

3. **补齐 ESC 取消与堆叠上限提示**
- 建议修改文件：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 建议新增函数：`handleKeyDownForPlacement`、`emitStackLimitMessage`
- 预期行为：ESC 取消 ghost；超 5 层时显示明确提示。
- 验收方式：堆叠到 5 层后继续放置，出现“已达上限”提示。

### P2（表现与可维护性）

1. **吸附可视化高亮**
- 文件：`frontend/src/components/game/BattlefieldPreviewModal.js`, `frontend/src/components/game/BattlefieldPreviewModal.css`
- 新函数：`drawSnapGuide(ctx, snapState, ghost)`

2. **保存防抖与批量提交**
- 文件：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 新函数：`schedulePersistLayoutDebounced`

3. **模块拆分提升可测性**
- 文件：`frontend/src/components/game/BattlefieldPreviewModal.js`
- 新模块：
  - `frontend/src/components/game/battlefield/placementMath.js`
  - `frontend/src/components/game/battlefield/render2d.js`
  - `frontend/src/components/game/battlefield/persistence.js`

---

## 10. Quick Manual QA Checklist

1. 打开知识域承门/启门布防面板，确认“战场预览”按钮存在并可点击。
2. 点击“战场预览”，确认弹出浮窗且不触发底层场景拖拽。
3. 验证预览态显示 45°，编辑态显示 75°。
4. 验证视角切换当前为瞬切（记录为缺口，P1-1）。
5. 无 ghost 时左键按住拖拽战场，松开后停止。
6. 编辑态从左侧栏选择木墙，确认 ghost 跟随鼠标。
7. 右键取消 ghost；滚轮旋转 yaw；顶层吸附时滚轮不改变 yaw。
8. 侧吸附验证：将 ghost 旋转到非 0/90 角后靠近墙体，记录是否出现“最优贴面”失败（当前缺口，P0-3）。
9. 堆叠到 5 层后再尝试放置，确认当前缺少明确上限提示（P1-3）。
10. 放置后观察头顶 `HP/DEF` 标签；将两墙近距离但不接触，确认当前会出现误并组风险（P0-4）。
11. 刷新页面验证 API 正常时恢复。
12. 关闭后端或移除 token 刷新，确认当前无 localStorage 布局回退（P0-2）。
