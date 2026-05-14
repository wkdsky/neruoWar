# 城内工坊 / 地下城闯关 Phaser 编辑器重构方案（性能前置版）

## 0. 方案结论

本方案的核心目标不是“把 React/SVG 画布原样搬到 Phaser”，而是把城内工坊升级为一套可长期承载 **地图编辑 + 地下城闯关运行时** 的网页游戏渲染管线。

当前 React DOM/SVG 方案在几十个建造物后出现拖动、连续创建、移动预览、视角旋转卡顿，根因不是单个函数写得慢，而是整体架构不适合游戏级编辑器：

- 每个建造物拆成大量 DOM/SVG 节点。
- polygon、mask、filter、drop-shadow 等 SVG 效果在大量对象下成本高。
- 高频鼠标移动、hover、拖拽、相机变化与 React state 更新耦合。
- 命中测试、排序、几何计算容易退化为全量遍历。
- 后续还需要支持玩家进入地图、机关触发、动画、多人状态同步，DOM/SVG 不适合作为主运行时。

因此，推荐采用：

```text
React：外层 UI、物料面板、状态栏、保存、验证、弹窗、撤销重做入口
Phaser：主画布、相机、渲染、输入、hover、ghost、selection、运行时动画
mapData：唯一持久化真源
Phaser runtime cache：高频编辑与渲染缓存
transaction commit：低频回写 React/editor state
```

最重要的改动是：

> **静态地图对象不应长期使用大量 Phaser Graphics 直接绘制。Graphics 只用于贴图生成、ghost、hover、selection、debug overlay。正式地图对象应优先使用 Sprite / Image / TilemapLayer / RenderTexture / chunk cache。**

否则只是把卡顿从 React/SVG 转移到 Phaser Graphics。

---

## 1. 目标与非目标

### 1.1 目标

1. 支持网页内地下城地图建造。
2. 在 1000+ 放置物件下保持可接受的编辑交互性能。
3. 地图编辑与后续地下城闯关运行共用底层地图数据和渲染管线。
4. React 不再参与高频画布交互。
5. 保留现有 schema、模板、保存、验证、撤销重做逻辑。
6. 支持后续扩展：
   - 玩家进入地下城。
   - 机关触发与动画。
   - 机关状态同步。
   - 多人闯关。
   - 地图分享与服务端存储。

### 1.2 性能目标

建议以如下目标作为验收标准：

| 场景 | 目标 |
|---|---|
| 1000 个普通 tile/wall/mechanism 混合物件 | 平移、缩放、hover、单选无明显卡顿 |
| 连续拖拽创建 100+ 格 | 不丢格，不重复提交 React state |
| 移动 1 / 10 / 100 个选中物件 | ghost 预览流畅，确认时一次提交 |
| 视角旋转 | 不重建显示对象，只更新 depth / transform |
| 保存 | 保持原有 validate + serialize 逻辑 |
| 运行时 | 只同步玩家位置与机关状态，不同步渲染帧 |

### 1.3 非目标

第一版不做：

- 完整多人同步。
- 完整机关传动系统。
- 复杂物理引擎。
- 大规模怪物 AI。
- 高规格美术资源管线。
- 服务端地图审核与分享系统。

第一版只要证明：

1. 地图能流畅编辑。
2. 地图能保存和验证。
3. 地图能被最小游玩模式读取。
4. Phaser 管线不会阻塞后续闯关。

---

## 2. 总体架构

### 2.1 模块分层

```text
CityWorkshopPage
  ├── React UI Shell
  │     ├── Topbar
  │     ├── MaterialPalette
  │     ├── Hotbar
  │     ├── StatusFooter
  │     ├── SettingsPanel
  │     ├── SelectionToolbar
  │     └── Toast / Modal
  │
  ├── Editor State / Schema Layer
  │     ├── mapData
  │     ├── activeTool
  │     ├── activeMaterial
  │     ├── selectedPlacements
  │     ├── validationResult
  │     ├── undoStack / redoStack
  │     └── dirty / saved state
  │
  └── Phaser Canvas Runtime
        ├── Scene
        ├── Renderer
        ├── TextureCache
        ├── RuntimeIndex
        ├── InputController
        ├── HitTest
        ├── CameraController
        ├── OverlayRenderer
        └── PlayRuntime facade
```

### 2.2 React 职责

React 继续负责低频 UI 与业务状态：

- 模板入口。
- 草稿和用户模板读取。
- 物料面板。
- 顶部保存、退出、撤销、重做。
- 状态栏。
- toast。
- 设置面板。
- 选择操作条。
- validateSafeRoute。
- serializeCityChannelMap。
- localStorage 或未来服务端保存。
- undo/redo 栈。

React 不负责：

- 每帧相机变化。
- 每帧 hover。
- 每帧 ghost 移动。
- pointer move。
- 拖拽中间态。
- 大量物件命中测试。
- 大量物件重绘。

### 2.3 Phaser 职责

Phaser 负责主画布和高频运行时：

- WebGL canvas 初始化与销毁。
- 地图分层渲染。
- texture cache。
- object pool。
- camera pan / zoom / yaw。
- pointer / wheel / keyboard 输入。
- hover target。
- ghost preview。
- selection overlay。
- box select overlay。
- route highlight overlay。
- 后续玩家、机关、动画运行。
- runtime state 可视化。

### 2.4 mapData 是唯一持久化真源

必须保持：

```text
mapData
  ├── version
  ├── name
  ├── templateMeta
  ├── width
  ├── height
  ├── layers
  ├── tiles
  ├── walls
  ├── entrances
  ├── exits
  ├── safeRoute
  ├── mechanisms
  └── testState
```

规则：

- 现有 `normalizeCityChannelMap` 仍是输入与保存前的规范化入口。
- 现有 `serializeCityChannelMap(mapData)` 仍是持久化出口。
- Phaser 内部允许使用 mutable runtime cache，但不能直接替代 mapData。
- 所有编辑操作最终通过 transaction commit 回写 React/editor state。
- undo/redo 不记录每一帧，只记录一次编辑事务。

---

## 3. 推荐文件结构

建议新增：

```text
frontend/src/components/game/cityChannel/
  CityChannelPhaserEditor.js

frontend/src/components/game/cityChannel/phaser/
  CityChannelPhaserScene.js
  CityChannelPhaserBridge.js

  renderer/
    CityChannelRenderer.js
    CityChannelLayerManager.js
    CityChannelTextureCache.js
    CityChannelChunkRenderer.js
    CityChannelDepth.js
    CityChannelGeometry.js
    CityChannelOverlayRenderer.js

  input/
    CityChannelInputController.js
    CityChannelCameraController.js
    CityChannelHitTest.js
    CityChannelPointerState.js
    CityChannelKeyboardShortcuts.js

  runtime/
    CityChannelRuntimeIndex.js
    CityChannelRenderObjectPool.js
    CityChannelEditorSession.js
    CityChannelPlayRuntime.js
    CityChannelMechanismRuntime.js

  types/
    cityChannelPhaserTypes.js
```

继续保留：

```text
cityChannelSchema.js
cityChannelCatalog.js
cityChannelDomainModel.js
cityChannelRenderModel.js
cityChannelValidation.js
cityChannelTemplates.js
CityChannelMaterialPalette.js
CityWorkshopPage.js
CityChannelTemplateGallery.js
```

逐步废弃：

```text
CityChannelImmersiveEditor.js 中的 SVG 主画布
CityChannelImmersiveEditor.css 中与 SVG polygon / mask / filter 绑定的画布视觉
```

---

## 4. 渲染管线设计

### 4.1 不要把 Phaser 当成 SVG 替代品

错误方向：

```text
每个 placement 一个 Container
每个 Container 内多个 Graphics
每个 Graphics 画 polygon / line / alpha / glow
每次视角变化重绘或重建
```

这种方式在物件少时能跑，但 1000+ 复杂物件后仍可能卡。

正确方向：

```text
Graphics 只负责：
  1. 生成静态 texture
  2. 画 hover / selection / ghost / debug overlay
  3. 少量动态机关的临时视觉

正式地图对象使用：
  1. Image / Sprite
  2. TilemapLayer
  3. RenderTexture
  4. chunk cache
  5. object pool
```

### 4.2 渲染层划分

建议 Scene 内至少分为以下层：

```text
rootContainer
  ├── groundLayer             # 地板、基础可走区域
  ├── groundAttachmentLayer   # 压力板、地面按钮等低矮物件
  ├── wallLayer               # 墙体、竖立面板、门框
  ├── mechanismStaticLayer    # 静态机关外观
  ├── mechanismDynamicLayer   # 动态机关部件、动画状态
  ├── entityLayer             # 玩家、怪物、投射物
  ├── routeLayer              # 白通路、高亮路径
  ├── selectionLayer          # 选中 aura、框选
  ├── ghostLayer              # 放置预览、移动预览
  ├── helperLayer             # 网格、坐标
  └── debugLayer              # 性能调试、hit area 可视化
```

要求：

- 静态层尽量不每帧变。
- ghost / selection / route 使用少量 Graphics。
- entity / mechanismDynamic 才使用帧动画。
- 图层内部依靠 depth 控制遮挡。
- 平移、缩放不更新 depth。
- 只有 yaw、对象新增删除、对象移动时标记 depth dirty。

### 4.3 TextureCache

建立 `CityChannelTextureCache`：

```text
getTileTexture(panelType, rotation, flipped, visualState)
getWallTexture(panelType, edge, rotation, flipped, wallViewMode)
getPortalTexture(type, rotation, wallViewMode)
getMechanismTexture(panelType, rotation, flipped)
getConnectorTexture(connectorType, state)
```

texture key 示例：

```text
tile:wood_floor:rot0:flip0:normal
tile:stone_floor:rot90:flip0:normal
wall:wall:north:semi:flip0
wall:glass_wall:east:perspective:flip0
portal:entrance:rot0:semi
portal:exit:rot180:semi
mech:pressure_plate:rot0:idle
mech:external_gear_plate:rot90:idle
```

实现原则：

1. 第一次请求 texture 时，用 Graphics 或 CanvasTexture 生成。
2. 生成后放入 Phaser texture manager。
3. 后续地图对象只创建 Image/Sprite。
4. hover / selected / invalid 不建议为每个物件生成新贴图，优先用 overlay。
5. wall view mode 切换时，优先切换 texture key 或 alpha，不要重建 mapData。

### 4.4 地板层策略

地板数量通常最多，建议优先优化。

可选方案：

#### 方案 A：TilemapLayer

适合：

- 地板是规则格子。
- 材质组合不太复杂。
- 后续不要求每块地板都单独复杂变形。

优点：

- Phaser 原生支持。
- 渲染效率较好。
- 与地图数据天然匹配。

缺点：

- 你的墙体、门框、机关、connector 不适合全部塞进 Tilemap。
- 等距投影和自定义多边形视觉可能需要适配。

#### 方案 B：Chunk RenderTexture

适合：

- 想保留当前等距多边形视觉。
- 地板静态区域多。
- 大地图可能继续扩大。

建议 chunk 大小：

```text
16 x 16 cells 或 32 x 32 cells
```

每个 chunk：

```text
chunkKey = z:chunkX:chunkY
dirty = true / false
renderTexture = cached static image
containedCells = tile keys
```

当一个 tile 改变时：

```text
markChunkDirty(tile.x, tile.y, tile.z)
next render tick rebuild dirty chunks only
```

优点：

- 静态地板变成少量大图。
- 平移缩放时成本低。
- 适合 1000+ / 5000+ tile。

缺点：

- 单个 tile hover/selection 不能依赖 tile image，需要 overlay。
- chunk 更新逻辑比普通 Sprite 复杂。

推荐第一版：

```text
1000 物件目标：先用 Sprite/Image + object pool
后续大地图目标：地板层升级为 chunk RenderTexture
```

### 4.5 墙体与竖立物件

墙体不能完全 Tilemap 化，因为存在：

- edge wall。
- cell vertical panel。
- base 命中与 outline 穿透。
- 半透视 / 透视 / 不透视。
- 与地板和 portal 的遮挡关系。
- rotation / flipped。

墙体建议使用：

```text
wallLayer 上的 Sprite/Image
每个 wall 一个 render object
texture 由 wall panelType + edge + viewMode 决定
hit test 由 RuntimeIndex + polygon data 决定
```

注意：

- 视觉对象和命中对象分离。
- 点击 base 才命中墙体。
- 点击 outline 可穿透到后方物件。
- wall view mode 切换不提交 mapData，只更新渲染状态。

### 4.6 机关渲染

机关分两类：

#### 静态机关

例如：

- 压力板。
- 方向压力板。
- 普通按钮外观。
- 齿轮底座。
- 翻板静止态。

渲染方式：

```text
Sprite/Image + texture cache
```

#### 动态机关

例如：

- 齿轮旋转。
- 弹簧弹起。
- 侧推柱伸缩。
- 门开启。
- 陷阱翻转。

渲染方式：

```text
静态底座 Sprite
动态部件 Sprite / Container / Tween
状态来自 PlayRuntimeState
```

编辑模式默认不跑完整 simulation，只显示静态外观和连接点。游玩模式才启用 mechanism tick。

---

## 5. RuntimeIndex 与命中测试

### 5.1 不要给每个物件 setInteractive

不要让每个 tile、wall、mechanism 都成为 Phaser interactive object。

推荐只有 canvas / scene 接收 pointer 事件，然后自定义命中测试：

```text
pointer screen position
  -> inverse camera transform
  -> world position
  -> grid coordinate
  -> candidate cells / edges
  -> RuntimeIndex 查询候选物件
  -> precise hit test
  -> hover target
```

### 5.2 RuntimeIndex 结构

建议维护：

```js
runtimeIndex = {
  cellIndex: Map<cellKey, PlacementId[]>,
  edgeIndex: Map<wallKey, PlacementId[]>,
  connectorIndex: Map<connectorKey, ConnectorHitInfo>,
  placementIndex: Map<placementId, PlacementRuntimeInfo>,
  chunkIndex: Map<chunkKey, PlacementId[]>
}
```

其中：

```js
PlacementRuntimeInfo = {
  placementId,
  kind, // tile | wall | portal | mechanism | connector
  cellKey,
  wallKey,
  x,
  y,
  z,
  edge,
  panelType,
  rotation,
  flipped,
  depth,
  bounds,
  hitPolygons,
  renderObjectId
}
```

### 5.3 hover 命中流程

```text
1. pointer screen -> world
2. world -> approximate grid cell
3. 收集候选：
   - 当前 cell
   - 相邻 4 或 8 个 cell
   - 当前 cell 的四条 edge wall
   - 邻接 cell 的 edge wall
   - 当前 cell 附近 connector
4. 按 depth 从前到后排序候选
5. 对候选做精确命中：
   - floor top polygon
   - wall base polygon
   - portal body
   - connector circle
6. 若命中 wall outline 但未命中 base：
   - 允许穿透
7. 输出 hover target
```

复杂度目标：

```text
O(k)，k 是鼠标附近候选对象数量
不要 O(n) 遍历全图
```

### 5.4 框选

框选不要逐像素命中。

流程：

```text
screen selection rect
  -> 遍历可见 chunk 或空间 bucket
  -> bounding box 相交测试
  -> 必要时 polygon 粗判
  -> 输出 selected placement ids
```

如果地图只有 1000 物件，框选时遍历全部 placement 也能接受；但要把它限定在 mouse up 或节流 tick，不要每帧做复杂 polygon 测试。

---

## 6. 相机与等距旋转

### 6.1 相机状态

Phaser 内部维护：

```js
cameraState = {
  offsetX,
  offsetY,
  zoom,
  yaw,
  minZoom: 0.55,
  maxZoom: 1.8,
  isPanning,
  isRotating
}
```

React 只需要低频知道：

```text
onCameraChange({ zoom, yaw })
```

该事件要节流，例如 100ms 一次。

### 6.2 transform 策略

推荐：

- 使用一个 `worldContainer` 承载地图对象。
- pan / zoom 可以用 Phaser camera 或 container transform。
- yaw 属于等距投影参数，改变 yaw 时需要更新对象屏幕位置和 depth。
- 平移和缩放不应该重算 geometry。
- yaw 改变时：
  - 更新 placement screen position。
  - 更新 depth。
  - 不重建 texture。
  - 不 destroy/recreate display object。

### 6.3 depth 更新策略

触发 depth dirty 的事件：

- yaw 改变。
- placement 新增。
- placement 删除。
- placement 移动。
- rotation 改变并影响遮挡。
- z/layer 改变。
- wall view mode 若影响 visible layer。

不触发 depth dirty：

- hover 改变。
- selection 改变。
- ghost 移动。
- pan。
- zoom。
- status 更新。
- toast。

---

## 7. 编辑操作模型

### 7.1 操作必须事务化

拖拽过程不应每格都提交 React state。

推荐：

```text
pointerdown:
  beginTransaction("paint stroke")

pointermove:
  update ghost
  append pending operation
  update local runtime preview

pointerup:
  commitTransaction(pending operations)
  React applyMapMutation once
  Phaser receive committed mapData or patch
```

### 7.2 Operation 类型

建议定义统一操作：

```js
Operation =
  | { type: "placeTile", tile }
  | { type: "removeTile", cellKey }
  | { type: "placeWall", wall }
  | { type: "removeWall", wallKey }
  | { type: "movePlacements", ids, dx, dy, dz }
  | { type: "rotatePlacements", ids, delta }
  | { type: "flipPlacements", ids }
  | { type: "setEntrance", tile }
  | { type: "setExit", tile }
```

### 7.3 Transaction

```js
Transaction = {
  id,
  label,
  startedAt,
  operations,
  affectedKeys,
  beforeSelection,
  afterSelection
}
```

原则：

- 一次拖拽创建 = 一个 undo step。
- 一次移动确认 = 一个 undo step。
- 一次批量删除 = 一个 undo step。
- 一次多选旋转 = 一个 undo step。
- hover / ghost / camera 不进入 undo。

### 7.4 Phaser -> React

Phaser 只在确认编辑结果时发：

```js
onCommitOperations(operations, {
  label: "paint tiles",
  selectionAfter,
  requestValidation: false
})
```

React 执行：

```text
applyMapMutation(currentMapData, operations)
normalizeCityChannelMap(nextMapData)
push undo snapshot
set dirty
send patched mapData 或 full mapData 给 Phaser
```

---

## 8. 输入状态机

### 8.1 模式

建议明确五种输入模式：

```text
browse
select
place
erase
carry
```

另有临时子状态：

```text
painting
boxSelecting
panning
rotatingCamera
longPressPending
```

### 8.2 浏览模式

行为：

- 左键拖拽：平移。
- 左键双击并按住：旋转视角。
- 滚轮：缩放。
- WASD：平移。
- Q/E：旋转。
- 单击物件：可进入选择。

### 8.3 放置模式

行为：

- 移动鼠标：更新 ghost。
- 左键点击：放置。
- 左键拖拽：连续创建或擦除。
- 起点已有同类：本次 stroke 为 erase intent。
- 起点为空或不同类：本次 stroke 为 place intent。
- 同一 stroke 内同一 cell/edge 只处理一次。
- 墙体吸附最近 edge。
- 墙体要求有 floor 支撑。
- 入口/出口保持单实例。

### 8.4 选择模式

行为：

- 单击：选择。
- Shift 单击：追加/取消。
- 空白拖拽：框选。
- 点击墙体：只有 base 命中才选中。
- 点击 wall outline：穿透。
- Delete/Backspace：删除。
- Space：翻转。
- 滚轮：旋转选中。
- M：进入 carry。
- 长按约 260ms：进入 carry。

### 8.5 移动模式

行为：

- 以第一个选中物件为 anchor。
- 鼠标移动显示 ghost preview。
- valid / invalid 样式区分。
- 左键确认。
- Esc / 右键取消。
- 冲突检测包括：
  - 越界。
  - tile overlap。
  - wall overlap。
  - 目标已有非移动中的 tile/wall。
  - wall 缺少 floor support。
  - 入口/出口规则冲突。

---

## 9. 数据与运行时边界

### 9.1 三类状态必须分离

```text
MapDefinition
  静态地图定义
  可编辑、可保存、可分享
  来源：mapData

EditorSessionState
  编辑器临时状态
  hover、ghost、camera、selection、drag state
  不持久化

PlayRuntimeState
  闯关运行状态
  玩家、机关、门、陷阱、信号、冷却
  每次进入地下城时初始化
```

### 9.2 MapDefinition

沿用现有 mapData：

```js
MapDefinition = {
  version,
  name,
  templateMeta,
  width,
  height,
  layers,
  tiles,
  walls,
  entrances,
  exits,
  safeRoute,
  mechanisms,
  testState
}
```

### 9.3 EditorSessionState

Phaser 内部维护：

```js
EditorSessionState = {
  activeTool,
  activeMaterial,
  activeRotation,
  wallViewMode,
  cameraState,
  hoverTarget,
  selection,
  ghostState,
  dragState,
  carryState,
  boxSelectState,
  pendingTransaction
}
```

### 9.4 PlayRuntimeState

后续闯关模式维护：

```js
PlayRuntimeState = {
  mapId,
  mapVersion,
  mapHash,

  players: {
    [playerId]: {
      x,
      y,
      z,
      facing,
      hp,
      status
    }
  },

  mechanisms: {
    [mechanismId]: {
      state,
      signalValue,
      cooldownUntil,
      phase,
      lastTriggeredAt
    }
  },

  doors: {
    [doorId]: {
      open,
      locked,
      progress
    }
  },

  events: []
}
```

### 9.5 后续多人同步原则

多人模式不应同步：

- 每帧渲染对象。
- 每帧动画状态。
- hover。
- camera。
- ghost。
- selection。

只同步：

- 玩家输入或玩家位置。
- 机关触发事件。
- 机关状态变化。
- 门/陷阱状态。
- 地图版本/hash。
- 必要的时间戳或 tick id。

---

## 10. 分阶段实施计划

### 阶段 0：性能基线与压力模板

目标：明确旧方案瓶颈，避免迁移后没有对比标准。

任务：

- 增加 debug 模板生成器：
  - 100 物件。
  - 500 物件。
  - 1000 物件。
  - tile/wall/mechanism 混合。
- 记录旧 SVG 编辑器：
  - DOM/SVG 节点数量。
  - React commit 次数。
  - hover 延迟。
  - pan/zoom 主观流畅度。
  - 连续创建是否丢格。
  - 视角旋转是否卡顿。
- 建立验收脚本或人工 checklist。

验收：

- 能一键打开压力测试地图。
- 能对比旧编辑器与新 Phaser 编辑器表现。

---

### 阶段 1：Phaser 空壳与动态加载

目标：React 页面中加载 Phaser canvas，但不替换业务逻辑。

任务：

- 安装 Phaser。
- 新建 `CityChannelPhaserEditor.js`。
- 只在进入编辑器时 dynamic import Phaser。
- 创建/销毁 Phaser.Game。
- Scene 只显示背景、FPS debug、简单网格。
- 保留旧 SVG 编辑器 feature flag。

验收：

- 进入编辑器时 Phaser canvas 正常挂载。
- 退出后没有残留 canvas、WebGL context、事件监听。
- 主页面未进入编辑器时不加载 Phaser。

---

### 阶段 2：TextureCache 与基础几何

目标：先搭建最终性能管线，而不是先用 Graphics 复刻全部 SVG。

任务：

- 建立 `CityChannelTextureCache`。
- 为基础材料生成 texture：
  - wood_floor。
  - stone_floor。
  - iron_floor。
  - glass_floor。
  - wall。
  - glass_wall。
  - entrance。
  - exit。
  - pressure_plate。
- 使用 Graphics 只生成 texture，不作为正式对象长期存在。
- 建立 texture key 规范。
- 建立 geometry projection module。
- 建立 depth 计算 module。

验收：

- 可以生成并复用 tile/wall/portal/mechanism texture。
- 同一材质重复放置不会重复创建 texture。
- 清理 scene 时 texture 生命周期可控。

---

### 阶段 3：静态地图渲染

目标：用 Phaser 渲染 mapData，但暂不做复杂交互。

任务：

- 读取 mapData。
- 建立 RuntimeIndex。
- 建立 RenderObjectPool。
- 渲染：
  - floor。
  - edge wall。
  - cell vertical wall。
  - entrance/exit。
  - mechanism。
  - connector。
- 所有正式对象优先用 Image/Sprite。
- 设置 depth。
- 支持 wall view mode 三态。

验收：

- 官方模板、草稿模板可以显示。
- 所有材料大体可见。
- 1000 物件压力地图能渲染。
- 切换 wall view mode 不重建 mapData。

---

### 阶段 4：相机控制

目标：Phaser 接管 pan / zoom / yaw。

任务：

- 左键拖拽平移。
- 滚轮缩放。
- WASD 平移。
- Q/E 旋转。
- 双击按住旋转。
- camera state 只在必要时节流通知 React。
- yaw 改变时更新 position/depth，不重建 texture。

验收：

- 1000 物件下平移、缩放无明显卡顿。
- yaw 旋转时遮挡关系基本正确。
- React 不因相机每帧变化而重渲染。

---

### 阶段 5：自定义命中测试与 hover

目标：替换 SVG/DOM hit test。

任务：

- 实现 screen -> world。
- 实现 world -> approximate grid cell。
- RuntimeIndex 查询附近候选。
- 精确 polygon/circle hit test。
- 实现 wall base 命中。
- 实现 wall outline 穿透。
- hover overlay 由 Phaser 绘制。
- hover status 节流同步 React。

验收：

- 鼠标移动不触发 React 每帧更新。
- 1000 物件下 hover 稳定。
- 墙体 base/outline 规则正确。

---

### 阶段 6：放置、擦除与连续创建

目标：解决当前最核心的建造卡顿。

任务：

- 选中物料后进入 place mode。
- 显示 ghost。
- valid / invalid 样式。
- 左键单次放置。
- 左键拖拽连续创建。
- 起点同类则本次 stroke 为擦除。
- 同一 stroke 内去重。
- 拖拽中只更新 Phaser runtime preview。
- pointerup 时一次 transaction commit。
- 入口/出口保持单实例。

验收：

- 连续刷 100+ tile 不明显卡顿。
- 连续刷 wall 不丢 edge。
- undo 一次撤销整条 stroke。
- React 不在拖拽中每格重渲染。

---

### 阶段 7：选择、框选、删除、旋转、翻转

目标：复刻选择系统。

任务：

- 单击选择。
- Shift 追加/取消。
- 空白拖拽框选。
- selection overlay。
- React selection toolbar 显示数量。
- Delete/Backspace 删除。
- Space 翻转。
- 滚轮旋转选中。
- 操作后局部更新 RenderObjectPool 和 RuntimeIndex。

验收：

- 选择集合与旧版一致。
- 框选 1000 物件仍可接受。
- 删除/旋转/翻转不会全量重建 scene。

---

### 阶段 8：移动预览与冲突检测

目标：复刻 carry/move。

任务：

- M 进入移动。
- 长按 260ms 进入移动。
- anchor 取第一个选中物件。
- ghost preview 跟随 hover cell。
- 冲突检测：
  - 越界。
  - tile overlap。
  - wall overlap。
  - floor support。
  - entrance/exit 规则。
- 左键确认后一次 transaction commit。
- Esc/右键取消。

验收：

- 移动 1 / 10 / 100 个对象都不卡。
- invalid 位置不能提交。
- 移动后 selection 更新到新位置。
- undo 一次回退整次移动。

---

### 阶段 9：保存、验证、撤销重做闭环

目标：React 业务逻辑与 Phaser runtime 完整闭环。

任务：

- 保存仍调用 validateSafeRoute。
- 验证失败 toast，不保存。
- 验证成功 serialize + localStorage / future API。
- undo/redo 后同步 mapData patch/full mapData 给 Phaser。
- route highlight 在 Phaser routeLayer 显示。
- 状态栏显示：
  - 当前工具。
  - hover target。
  - zoom。
  - yaw。
  - render object count。
  - validation state。

验收：

- 保存结果与旧编辑器一致。
- 白通路验证一致。
- undo/redo 后 Phaser 画面正确。
- route highlight 正确显示。

---

### 阶段 10：最小闯关运行模式

目标：证明编辑器产出的地图可以被游戏流程消费。

第一版只做最小闭环：

- 玩家从入口出生。
- 玩家可在 walkable tile 上移动。
- 墙阻挡移动。
- 到达出口后通关。
- 压力板可触发一个简单状态。
- 一个门/陷阱可根据状态切换视觉。
- 编辑模式和游玩模式共用渲染底层，但输入模式不同。

验收：

- 从编辑器保存的地图可以进入游玩。
- 入口、出口、墙阻挡有效。
- 至少一个机关可以触发。
- PlayRuntimeState 不污染 mapData。

---

### 阶段 11：替换旧 SVG 编辑器

目标：Phaser 编辑器达到功能等价后替换旧画布。

任务：

- 默认启用 Phaser 编辑器。
- 保留旧编辑器 feature flag 一段时间。
- 压力测试通过后删除旧 SVG 主画布。
- 清理无用 CSS。
- 更新开发文档。

验收：

- 所有现有模板可打开、编辑、保存。
- 所有材料可放置、选择、移动、删除。
- 1000 物件压力地图通过。
- 最小游玩模式可读取地图。

---

## 11. 关键技术决策

### 11.1 为什么选 Phaser

Phaser 相比继续优化 React/SVG，更适合本项目，因为它提供：

- WebGL/canvas 渲染循环。
- Scene 生命周期。
- Input 系统。
- Camera。
- Texture cache。
- Animation / Tween。
- 后续玩家、机关、触发器运行时扩展能力。

### 11.2 为什么不是纯 PixiJS

PixiJS 更轻，更像 2D/WebGL 渲染引擎；如果项目只做高性能编辑器，PixiJS 也合适。

但当前目标不仅是编辑器，还包括：

- 后续地下城闯关。
- 玩家控制。
- 机关动画。
- 运行时 scene。
- 输入状态机。
- 可能的游戏 loop。

因此 Phaser 的完整游戏运行时价值更高。

### 11.3 为什么不能只用 Phaser Tilemap

Phaser Tilemap 对地板层有价值，但不能完整覆盖当前需求：

- 你的墙体依附 cell edge。
- 墙体有 base/outline 命中差异。
- 有入口/出口通行轴。
- 有竖立物件和遮挡排序。
- 有机关 connector。
- 有半透视/透视/不透视三态。
- 有复杂 selection/carry/ghost 规则。

因此推荐：

```text
floor base：TilemapLayer 或 chunk RenderTexture
walls / portals / mechanisms：自定义 Sprite/Image
hover / selection / ghost：Graphics overlay
logic：mapData + RuntimeIndex
```

### 11.4 为什么不能继续 React/SVG

React/SVG 适合中小规模结构化界面，不适合大量动态游戏对象：

- DOM 节点太多。
- SVG filter/mask 成本高。
- 高频 pointer event 与 React 更新耦合。
- 游戏运行时动画和交互会进一步放大问题。
- 后续多人地下城不应依赖 DOM 节点作为实体。

---

## 12. 风险与处理

### 风险 1：Phaser Graphics 也可能卡

处理：

- Graphics 不作为正式静态对象。
- 优先 texture cache。
- 静态地板可 chunk cache。
- overlay Graphics 数量保持少量。

### 风险 2：等距 depth 排序复杂

处理：

- 保留原有 render order 语义。
- depth dirty 才更新。
- pan/zoom 不更新 depth。
- yaw 改变只更新 depth 和 position，不重建对象。
- 必要时按 chunk/layer 局部排序。

### 风险 3：React 与 Phaser 状态双写

处理：

- mapData 是唯一持久化真源。
- Phaser runtime 是缓存。
- 只有 transaction commit 回写 React。
- React props 改变时，通过 bridge 同步 Phaser。
- 禁止拖拽中每格 setState。

### 风险 4：行为迁移不一致

处理：

- 保留旧 SVG fallback。
- 每阶段做验收。
- 用同一批模板做回归测试。
- 先追求操作语义一致，再追求视觉完全一致。

### 风险 5：后续游玩模式和编辑模式耦合

处理：

- 提前定义 MapDefinition / EditorSessionState / PlayRuntimeState。
- 编辑状态不进入 mapData。
- 运行状态不污染模板。
- 只通过 mapVersion/mapHash 关联地图与运行实例。

---

## 13. 第一版最小可交付范围

第一版建议做到：

- Phaser 动态加载。
- 静态地图渲染。
- texture cache。
- pan / zoom / yaw。
- 自定义 hit test。
- hover。
- 放置。
- 连续创建。
- 擦除。
- 选择。
- 删除。
- 移动 ghost。
- 移动确认。
- 撤销/重做。
- 保存/验证。
- 1000 物件压力测试。

第一版不做：

- 完整多人。
- 完整机关传动。
- 复杂 AI。
- 大量美术 atlas。
- 服务端同步。
- 全量商业级动画效果。

---

## 14. 最终验收清单

### 基础

- [ ] 打开空白模板正常。
- [ ] 打开官方模板正常。
- [ ] 打开本地草稿正常。
- [ ] 退出编辑器正常销毁 Phaser。
- [ ] 主页面不加载 Phaser。

### 渲染

- [ ] 所有地板材质可见。
- [ ] 所有墙体材质可见。
- [ ] 入口/出口可见。
- [ ] 机关外观可见。
- [ ] connector 可见。
- [ ] wall view mode 三态可切换。
- [ ] 1000 物件可渲染。
- [ ] 平移缩放不卡。
- [ ] yaw 旋转遮挡基本正确。

### 命中

- [ ] hover tile 正确。
- [ ] hover wall 正确。
- [ ] wall base 可选。
- [ ] wall outline 穿透。
- [ ] connector 可命中。
- [ ] hover 不触发 React 每帧重渲染。

### 编辑

- [ ] 所有材料可放置。
- [ ] 地板连续创建不卡。
- [ ] 墙体吸附 edge 正确。
- [ ] 入口/出口保持单实例。
- [ ] 擦除正确。
- [ ] 一次拖拽对应一个 undo step。
- [ ] ghost valid/invalid 正确。

### 选择与移动

- [ ] 点击选择。
- [ ] Shift 追加/取消。
- [ ] 框选。
- [ ] Delete 删除。
- [ ] Space 翻转。
- [ ] 滚轮旋转选中。
- [ ] M 移动。
- [ ] 长按移动。
- [ ] 移动冲突检测正确。
- [ ] 移动确认一次提交。
- [ ] 移动 undo 正确。

### 保存与验证

- [ ] validateSafeRoute 结果一致。
- [ ] 保存前验证一致。
- [ ] serializeCityChannelMap 输出兼容旧结构。
- [ ] undo/redo 后画面正确。
- [ ] route highlight 正确显示。

### 最小游玩

- [ ] 玩家从入口出生。
- [ ] 墙体阻挡移动。
- [ ] 可走 tile 正确。
- [ ] 到达出口通关。
- [ ] 至少一个机关可触发。
- [ ] PlayRuntimeState 不污染 mapData。

---

## 15. 推荐落地原则

最终工程判断可以压缩成五句话：

1. **Phaser 不是用来复刻 SVG 的，而是用来建立游戏运行时。**
2. **静态物件必须贴图化，Graphics 只能作为生成器和 overlay。**
3. **hover、ghost、camera、drag 不进 React state。**
4. **命中测试必须自定义空间索引，不能依赖每个对象 interactive。**
5. **mapData、EditorSessionState、PlayRuntimeState 必须三层分离。**

只要这五条守住，这个方案不仅能解决当前建造卡顿，也能顺利承接后续地下城闯关流程。
