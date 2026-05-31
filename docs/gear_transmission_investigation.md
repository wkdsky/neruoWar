# 城内工坊齿轮传动系统调研报告

## 1. 问题概述

当前问题集中在“城内工坊 -> 编辑模板模块”的齿轮传动运行预览：左侧活动轴齿轮能够通过齿轮接触图带动右侧固定轴齿轮，但右侧固定轴齿轮在运行态视觉上出现下移，背后的板材也沿不合理方向偏移。

目标行为应是：

- 活动轴齿轮只更新自身自转角度，保持放置时的世界位置，不驱动背后板材整体旋转。
- 固定轴齿轮被传动后，齿轮中心世界坐标保持不变，仅更新自转角度。
- 固定轴齿轮所在板材围绕该固定轴齿轮中心作为 pivot 旋转，板材位置由 pivot 和固定点局部坐标反推。

本次调查只阅读代码并创建本文档，未修改功能源码。

## 2. 相关文件总览

| 文件路径 | 作用 | 与本 bug 的关系 |
|---|---|---|
| `frontend/src/components/game/CityWorkshopPage.js` | 城内工坊页面入口，打开模板编辑器。 | 第 3 行引入 `CityChannelPhaserEditor`，第 33-40 行将模板 `mapData` 交给编辑器。 |
| `frontend/src/components/game/cityChannel/CityChannelPhaserEditor.js` | React 编辑器外壳，维护选中状态、参数面板、Phaser 场景生命周期。 | 第 630-660 行动态加载 Phaser Scene；第 312-325、328-381 行更新齿轮 `axisType`。 |
| `frontend/src/components/game/cityChannel/CityChannelMechanismPanel.js` | 机关/齿轮属性面板。 | 第 121-134 行安装后选择活动轴/固定轴；第 213-230 行属性面板修改 `axisType`。 |
| `frontend/src/components/game/cityChannel/CityChannelEditorChrome.js` | 编辑器选中工具条。 | 第 156-170 行对已选齿轮设置活动轴/固定轴。 |
| `frontend/src/components/game/cityChannel/CityChannelMaterialPalette.js` | 材料/组件库。 | 第 28-34 行组件库只暴露 `gear`，安装到板材五个轴点。 |
| `frontend/src/components/game/cityChannel/cityChannelCatalog.js` | 板材、力源、承动板材预设。 | 第 38-74 行定义 `gearMount` 预设；第 191-284 行定义固定轴齿轮承动板预设；第 339-341 行从 palette 隐藏 actuator 预设。 |
| `frontend/src/components/game/cityChannel/schema/entities.js` | 创建 tile/wall 数据实体。 | 第 34-72、75-115 行将 catalog 的 `gearMounts` 克隆进 tile/wall。 |
| `frontend/src/components/game/cityChannel/schema/normalizeMap.js` | 载入/归一化地图数据。 | 第 96-98、158-160 行保留已有 `gearMounts`，否则使用 catalog 默认值。 |
| `frontend/src/components/game/cityChannel/cityChannelEditorMutations.js` | 编辑操作落盘到 `mapData`。 | 第 152-175 行齿轮安装/删除直接操作宿主 tile/wall 的 `gearMounts`。 |
| `frontend/src/components/game/cityChannel/cityChannelMechanismRuntime.js` | 机械整体、传动端点、固定轴集合构建。 | 第 160-169 行定义五个齿轮固定点局部坐标；第 281-400 行构建 assembly；第 366-380 行收集 `fixedAxes`。 |
| `frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js` | 运行态数学模型：齿轮世界点、固定轴 anchor、旋转快照。 | 第 75-109 行计算齿轮世界位置/固定轴 anchor；第 133-145 行计算板材运行态 placement；第 266-317 行生成 runtime snapshot。 |
| `frontend/src/components/game/cityChannel/phaser/cityChannelEditorInteraction.js` | Phaser 放置交互。 | 第 73-130 行安装齿轮组件，默认 `axisType: 'freeAxis'`。 |
| `frontend/src/components/game/cityChannel/phaser/cityChannelGears.js` | 齿轮安装、命中、啮合图、传动比。 | 第 346-392 行选择最近 socket；第 422-446 行按齿轮中心距建接触图；第 484-528 行传播 `driveRatio`。 |
| `frontend/src/components/game/cityChannel/phaser/cityChannelMechanismPlayback.js` | 机关运行预览和齿轮传动动画。 | 第 60-90 行触发入口；第 321-356 行只更新齿轮相位；第 358-539 行固定轴驱动 assembly。 |
| `frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js` | Phaser 主场景，渲染、坐标转换、运行态应用。 | 第 517-570 行应用板材运行态位置和贴图；第 4203-4268 行重绘齿轮层；第 5057-5125 行齿轮绘制分支，是固定轴下移的高风险位置。 |
| `frontend/src/components/game/cityChannel/phaser/cityChannelPhaserSceneUtils.js` | Phaser 场景常量和几何工具。 | 第 40 行定义五个 socket；第 47-53 行定义齿轮半径；第 188-199 行齿轮自转绘制旋转。 |
| `frontend/src/components/game/cityChannel/phaser/renderer/CityChannelGeometry.js` | 等距投影和板材局部几何。 | 第 28-38 行 `projectCell`；第 163-177 行板材顶面几何不使用 `tileRotation` 旋转顶面，影响运行态视觉解释。 |
| `frontend/src/components/game/cityChannel/cityChannelGeometryUtils.js` | 世界坐标投影工具。 | 第 13-20 行将逻辑世界 x/y 投影到屏幕本地坐标。 |
| `frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.test.js` | 运行态数学测试。 | 第 71-106 行测试固定轴 anchor 理论上保持不动。 |
| `frontend/src/components/game/cityChannel/phaser/cityChannelMechanismPlayback.test.js` | 传动播放测试。 | 第 90-134 行验证活动轴只发 runtime gear phase；第 225-248 行验证固定轴触发 assembly transform。 |
| `docs/city_workshop_mechanism_refactor_plan.md` | 既有设计文档。 | 第 134-136 行定义 `freeAxis`/`fixedAxis` 预期；第 199-203 行曾计划运行预览使用 transient transform、不改静态 `mapData`。 |

## 3. 当前数据模型

### 板材和实体

- `tile` 和 `wall` 是模板中的主要承载实体，由 `createTile` 和 `createWall` 创建，字段包含 `x`、`y`、`z`、`rotation`、`transmissionRotation`、`panelType`、`boardRole`、`transmissionSkeleton`、`gearMounts` 等，见 `frontend/src/components/game/cityChannel/schema/entities.js:34` 和 `frontend/src/components/game/cityChannel/schema/entities.js:75`。
- `gearMounts` 直接存储在宿主 tile/wall 上，不是独立 top-level 实体。创建实体时来自 catalog，归一化时优先保留保存数据中的 `gearMounts`，见 `frontend/src/components/game/cityChannel/schema/normalizeMap.js:96` 和 `frontend/src/components/game/cityChannel/schema/normalizeMap.js:158`。

### 齿轮和轴类型

- 齿轮组件类型是字符串 `gear`，见 `frontend/src/components/game/cityChannel/phaser/cityChannelPhaserSceneUtils.js:35` 和 `frontend/src/components/game/cityChannel/cityChannelAttachedComponents.js:3`。
- 齿轮实例是 `gearMounts[]` 中的 mount 对象，常见字段为 `id`、`componentType`、`position`、`surface`、`axisType`、`followMode`、`followDelaySeconds`、`radius`、`teeth`、`phase`，安装时创建于 `frontend/src/components/game/cityChannel/phaser/cityChannelEditorInteraction.js:88`。
- 活动轴和固定轴通过 `axisType` 区分：`freeAxis` 表示活动轴，`fixedAxis` 表示固定轴。安装新齿轮默认是 `freeAxis`，见 `frontend/src/components/game/cityChannel/phaser/cityChannelEditorInteraction.js:93`。
- UI 层修改 `axisType` 的路径有三处：安装后弹窗 `CityChannelMechanismPanel.js:121`，属性面板 `CityChannelMechanismPanel.js:223`，选中工具条 `CityChannelEditorChrome.js:156`，实际写入逻辑在 `CityChannelPhaserEditor.js:312`、`CityChannelPhaserEditor.js:328`、`CityChannelPhaserEditor.js:362`。

### 固定点/锚点

- 当前固定点不是独立数据结构，而是 `mount.position` 的枚举值。
- 五个点位来自 `GEAR_SOCKET_POSITIONS = ['center', 'corner_ne', 'corner_nw', 'corner_se', 'corner_sw']`，见 `frontend/src/components/game/cityChannel/phaser/cityChannelPhaserSceneUtils.js:40`。
- 点位局部坐标来自 `getGearMountLocalPosition`，见 `frontend/src/components/game/cityChannel/cityChannelMechanismRuntime.js:160`：
  - `center`: `{ x: 0, y: 0, z: 0 }`
  - `corner_ne`: `{ x: 0.32, y: -0.32, z: 0 }`
  - `corner_nw`: `{ x: -0.32, y: -0.32, z: 0 }`
  - `corner_se`: `{ x: 0.32, y: 0.32, z: 0 }`
  - `corner_sw`: `{ x: -0.32, y: 0.32, z: 0 }`
- 当前没有持久化的 `pivotWorld` 或 `mountPointLocal` 字段；`mount.position` 间接表示 mount local，`pivotWorld` 每次由当前 `mapData` 和 `fixedAxis` 推导。

### 连接关系和传动关系

- 板材传动骨架由 `transmissionSkeleton.ports` 表示，catalog 的 `createTransmissionSkeleton` 在 `frontend/src/components/game/cityChannel/cityChannelCatalog.js:33`。
- `buildMechanicalAssemblies` 遍历有 ports 或 `gearMounts` 的组件，建立 `MechanicalAssembly`，见 `frontend/src/components/game/cityChannel/cityChannelMechanismRuntime.js:281`。
- assembly 中的 `gearMounts` 会附加 `componentKey` 和 `cell`，固定轴集合是 `gearMounts.filter(axisType === 'fixedAxis')`，见 `frontend/src/components/game/cityChannel/cityChannelMechanismRuntime.js:366` 和 `frontend/src/components/game/cityChannel/cityChannelMechanismRuntime.js:374`。
- 齿轮啮合由 `buildGearContactGraph` 按 `worldPoint`/`point` 中心距、surface、z 层和半径判断，见 `frontend/src/components/game/cityChannel/phaser/cityChannelGears.js:422`。

## 4. 当前运行流程

### 入口函数

1. 用户在 `CityWorkshopPage` 打开模板，`CityWorkshopPage.js:33` 渲染 `CityChannelPhaserEditor`。
2. `CityChannelPhaserEditor.js:630` 动态加载 Phaser 和 `CityChannelPhaserScene`，`CityChannelPhaserEditor.js:683` 将配置推给 scene。
3. 用户点击齿轮压力板或运行按钮后，Phaser 侧从 `triggerMechanismAtCell` 进入，见 `frontend/src/components/game/cityChannel/phaser/cityChannelMechanismPlayback.js:60`。

### 调用链

当前存在两条运行链：

1. **无齿轮图或普通固定轴驱动链**
   - `triggerMechanismAtCell` 查找 `sourceAssembly`，如果没有可用齿轮链，则调用 `findFixedAxisForTrigger` 和 `playAssemblyRotation`，见 `cityChannelMechanismPlayback.js:71`、`cityChannelMechanismPlayback.js:77`、`cityChannelMechanismPlayback.js:82`。
   - `playAssemblyRotation` 用 `getFixedAxisWorldAnchor(scene.mapData, fixedAxis)` 取 anchor，见 `cityChannelMechanismPlayback.js:125`。
   - tween 每帧调用 `createMechanismRuntimeSnapshot` 和 `scene.applyMechanismRuntimePlacementTransforms`，见 `cityChannelMechanismPlayback.js:161` 和 `cityChannelMechanismPlayback.js:169`。

2. **齿轮传动链**
   - 如果 source assembly 有 `gearMounts`，`triggerMechanismAtCell` 调用 `playAssemblyGearRotation`，见 `cityChannelMechanismPlayback.js:73`。
   - `playAssemblyGearRotation` 先 `resolveDrivenGearNodes`，该函数从 assembly 齿轮、全图齿轮和接触图解析被驱动节点，见 `cityChannelMechanismPlayback.js:358` 和 `cityChannelMechanismPlayback.js:307`。
   - `buildGearContactGraph` 在 `cityChannelGears.js:422` 根据齿轮中心距建立接触边，`resolveDrivenGearNodes` 在 `cityChannelGears.js:484` 传播 `driveRatio`。
   - 若没有被驱动的固定轴，走 `setGearMountPhases`，只更新 runtime gear phase，不转板材，见 `cityChannelMechanismPlayback.js:385` 和 `cityChannelMechanismPlayback.js:401`。
   - 若有固定轴，`fixedNodes` 被转换为 `assemblyEntries`，每个 entry 的 `anchor` 取 `getGearWorldPosition(node.placement, node.mount)`，见 `cityChannelMechanismPlayback.js:363` 和 `cityChannelMechanismPlayback.js:381`。
   - tween 每帧调用 `applyRuntimeState`：先 `createMechanismRuntimeSnapshot`，再 `setGearMountPhases(... publish: false)`，最后对每个固定轴 assembly 调用 `scene.applyMechanismRuntimePlacementTransforms`，见 `cityChannelMechanismPlayback.js:476`、`cityChannelMechanismPlayback.js:486`、`cityChannelMechanismPlayback.js:487`。

### 关键状态字段

- `mechanismRuntimeSnapshot`: Phaser Scene 中的运行态快照，初始化为 `null`，见 `CityChannelPhaserScene.js:232`。
- `mechanismRuntimeSnapshot.placements[componentKey]`: 运行态 tile/wall placement，包含 `x`、`y`、`z`、`rotation`、`runtimeAngle`、`runtimeAxisAnchor`。
- `mechanismRuntimeSnapshot.gears["componentKey:mountId"]`: 运行态齿轮状态，包含 `axisType`、`phase`、`speedRatio`、`torqueRatio`、`teeth`，见 `cityChannelMechanismSimulation.js:295`。
- `mount.phase`: 静态初始相位。运行时不直接修改 `mapData` 中的 mount，测试在 `cityChannelMechanismPlayback.test.js:90` 验证这一点。

### 每步更新对象

- `setGearMountPhases` 不改静态 mount，只发布 runtime gear states，并调用 `redrawMountedGearHostLayers` 重绘齿轮图形，见 `cityChannelMechanismPlayback.js:321`、`cityChannelMechanismPlayback.js:342`、`cityChannelMechanismPlayback.js:352`。
- `applyMechanismRuntimePlacementTransforms` 对每个 assembly component：
  - 计算 `runtimePlacement = getRuntimePlacementAtAngle(placement, anchorWorld, angle)`，见 `CityChannelPhaserScene.js:523`。
  - 对板材图像设置 `setPosition(runtimeProjection.x, runtimeProjection.y)`，见 `CityChannelPhaserScene.js:547`。
  - 用旋转后的 `runtimePlacement.rotation` 替换板材 texture，见 `CityChannelPhaserScene.js:549`。
  - 调用 `redrawMountedGearHostLayers(... runtimePlacement ..., sourcePlacement original)` 重绘齿轮，见 `CityChannelPhaserScene.js:566`。

## 5. 坐标系与 Transform 分析

### 逻辑 world 坐标

- `tile.x/y/z`、`wall.x/y/z` 是地图逻辑世界坐标，通常以格子为单位。
- `getGearWorldPosition` 将 `mount.position` 的局部坐标转换为逻辑世界坐标，见 `cityChannelMechanismSimulation.js:75`。
- `getFixedAxisWorldAnchor` 从当前 `mapData` 和 `fixedAxis` 推导固定轴逻辑世界 anchor，见 `cityChannelMechanismSimulation.js:98`。
- `rotateWorldPointAround` 在逻辑世界 x/y 平面中绕 anchor 旋转，见 `cityChannelMechanismSimulation.js:42`。

### 屏幕/Phaser 本地坐标

- `projectWorldOffset` 将逻辑世界 x/y 投影到等距屏幕偏移，见 `cityChannelGeometryUtils.js:13`。
- `projectCell` 将 cell 世界坐标转换为 `mapLayer` 内的 Phaser 坐标和 depth，见 `CityChannelGeometry.js:28`。
- `worldLayer` 是全局镜头容器，`mapLayer` 是所有地图对象的共享父容器，见 `CityChannelPhaserScene.js:240`、`CityChannelPhaserScene.js:254`。
- 相机平移和缩放只作用在 `worldLayer`，见 `CityChannelPhaserScene.js:967`。

### 局部坐标

- `getGearMountLocalPosition` 的五个点是板材局部坐标，范围大致在 `[-0.32, 0.32]`，见 `cityChannelMechanismRuntime.js:160`。
- 渲染齿轮时，`mapGearLocalPointToSurface` 使用 `getGearSurfaceContext` 返回的板面 polygon、offset 和 rotation，将局部点映射到屏幕本地坐标，见 `CityChannelPhaserScene.js:4423`。
- `getGearMountPoint` 是渲染层的“局部点到屏幕点”入口，见 `CityChannelPhaserScene.js:4470`。

### parent/container

- 当前没有发现“每块板材一个 Phaser Container，齿轮作为该 container 子节点”的实现。
- 板材 image、齿轮 graphics、overlay、label 都是 `mapLayer` 的兄弟对象。齿轮层由 `getOrCreateMountedGearGraphics` 创建并加入 `mapLayer`，见 `CityChannelPhaserScene.js:4140` 和 `CityChannelPhaserScene.js:4147`。
- 因此，“固定轴齿轮被加入板材 container 后随父容器旋转漂移”这一类 bug 在当前代码中没有直接证据。

### 可能重复或混用的 transform

- 没有 per-board container 的双重父子变换，但存在“逻辑运行态旋转 + 贴图再生 + 齿轮单独重绘”的混合路径：
  - 板材：`getRuntimePlacementAtAngle` 修改逻辑 `x/y/rotation`，再 `projectCell` 和换 texture。
  - 齿轮：普通状态用 `getGearMountPoint(runtimePlacement, mount)` 投影到旋转后板面；固定轴运行态则改用 `projectCell(runtimeAxisAnchor)` 并走 `lockedCenter` 分支。
- 这使固定轴齿轮的“世界中心锁定”和“贴在旋转板面上的 2.5D 几何”分离成两套渲染逻辑，是当前视觉下移最可疑的来源。

## 6. 活动轴齿轮实现分析

活动轴当前实现基本符合“只自转、不带动板材”的目标，但仅限于没有固定轴被解析到的齿轮链，或作为中间齿轮传播 `driveRatio` 时。

证据：

- 新安装齿轮默认 `axisType: 'freeAxis'`，见 `cityChannelEditorInteraction.js:88-99`。
- `setGearMountPhases` 对任意齿轮只生成 runtime gear states，不修改 `placement.x/y/rotation`，见 `cityChannelMechanismPlayback.js:321-356`。
- 当齿轮链没有固定轴时，`playAssemblyGearRotation` 每帧只调用 `setGearMountPhases`，不调用 `applyMechanismRuntimePlacementTransforms`，见 `cityChannelMechanismPlayback.js:385-431`。
- 测试 `publishes runtime gear phases without mutating mapData mounts` 验证 `tile.gearMounts[0].phase` 保持原值，只发布 runtime phase，见 `cityChannelMechanismPlayback.test.js:90-134`。

风险：

- 活动轴一旦通过接触图带动固定轴，后续固定轴会触发 assembly transform。这是设计目标本身，不是活动轴问题。
- 接触图只传播 `driveRatio`/相位，没有把接触点当作位置目标，见 `cityChannelGears.js:422-446`。因此“活动轴传动结果直接修改固定轴位置”的证据不足。

## 7. 固定轴齿轮实现分析

### 当前绑定板材逻辑

- 固定轴齿轮不是独立对象，而是宿主 tile/wall 的一个 `gearMount`。
- 安装逻辑先通过 `getGearInstallTarget` 找最近 socket，再在 `applyPlacementOperationsToMap` 中 append 到宿主 `gearMounts`，见 `cityChannelGears.js:346-392` 和 `cityChannelEditorMutations.js:152-175`。
- 固定轴属性仅由 `axisType: 'fixedAxis'` 表示，未持久化 `pivotWorld`。

### 当前固定轴 anchor 逻辑

- `getGearWorldPosition` 对水平板材的公式是：
  - 取 `local = getGearMountLocalPosition(mount.position)`。
  - 取 `rotation = placement.rotation`。
  - `rotated = rotatePoint(local, rotation)`。
  - 返回 `{ x: placement.x + rotated.x, y: placement.y + rotated.y, z }`。
  - 见 `cityChannelMechanismSimulation.js:75-96`。
- `getFixedAxisWorldAnchor` 每次从当前 `mapData` 中的 placement 和 fixedAxis 计算 anchor，见 `cityChannelMechanismSimulation.js:98-109`。
- 在齿轮链固定轴路径中，`assemblyEntries.anchor` 使用传动开始时 `getGearWorldPosition(node.placement, node.mount)` 的结果，见 `cityChannelMechanismPlayback.js:381`。

### 为什么固定轴会在视觉上向下偏移

最可疑位置是固定轴运行态齿轮重绘逻辑：

```js
const point = runtimeGear?.axisType === 'fixedAxis' && placement.runtimeAxisAnchor
  ? projectCell(placement.runtimeAxisAnchor, this.cameraState.yaw, this.mapData)
  : this.getGearMountPoint(placement, mount);

this.drawMountedGearPreview(layer, point, {
  ...
  lockedCenter: runtimeGear?.axisType === 'fixedAxis' && !!placement.runtimeAxisAnchor
});
```

证据位置：`frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js:4242-4262`。

普通齿轮渲染会进入 `drawMountedGearPreview` 的投影几何分支：

```js
const context = this.getGearSurfaceContext(placement, surface);
const extrusion = context?.extrusion || { x: 0, y: -8 };
...
const outline = this.offsetProjectedPoints(baseOutline, extrusion);
```

证据位置：`CityChannelPhaserScene.js:5077-5125`。

固定轴运行态则进入 `lockedCenter` 分支：

```js
if (options.lockedCenter) {
  graphics.fillEllipse(point.x, point.y + 5, 30, 10);
  drawGearShape(graphics, point.x, point.y, 15, 11, GEAR_TOOTH_COUNT, options.angle || 0);
  graphics.fillCircle(point.x, point.y, 5);
  return;
}
```

证据位置：`CityChannelPhaserScene.js:5066-5075`。

这意味着同一个固定轴齿轮在运行前后使用不同视觉中心语义：

- 静态/普通分支：齿轮贴在板面上，按板面投影、多边形和 extrusion 绘制。
- 运行态固定轴分支：直接在 `projectCell(runtimeAxisAnchor)` 的点画一个平面 2D 齿轮，不再使用板面 projection/extrusion。

如果普通分支中的齿轮视觉中心因为 extrusion、板面 polygon 和 `TILE_RENDER_CENTER` 有上抬/偏移，而 locked 分支直接画在 `projectCell` 上，切换时就会出现下移或跳位。该现象与“固定轴齿轮被传动后位置下移”高度吻合。

## 8. 板材旋转实现分析

### 当前板材绕哪个点旋转

逻辑层的板材旋转使用 `getRuntimePlacementAtAngle`：

```js
const point = rotateWorldPointAround(placement, anchor, degrees);
...
return {
  ...placement,
  x: Number(point.x.toFixed(4)),
  y: Number(point.y.toFixed(4)),
  runtimeAngle: degrees,
  runtimeAxisAnchor: anchor,
  rotation: normalizeRotation(baseRotation + degrees)
};
```

证据位置：`frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js:133-145`。

这相当于把“板材原点世界坐标”绕固定轴 anchor 旋转，并把板材自转角度加上 `degrees`。对水平板材且 `placement.x/y` 语义确实是板材局部原点/中心时，它和目标公式：

```text
boardWorldPosition = pivotWorld - Rotate(anchorLocal, boardAngle)
```

在数学上可以等价，因为初始 `pivotWorld = boardWorldPosition + Rotate(anchorLocal, boardInitialRotation)`。

### 视觉层如何应用

`applyMechanismRuntimePlacementTransforms` 将运行态 placement 投影到屏幕，然后：

- `tileObject.setPosition(runtimeProjection.x, runtimeProjection.y)`，见 `CityChannelPhaserScene.js:547`。
- `setBoardTexture(... getTileTexture(... runtimePlacement.rotation ...))`，见 `CityChannelPhaserScene.js:549-554`。
- 齿轮层以 `runtimePlacement` 重绘，见 `CityChannelPhaserScene.js:566`。

板材 image 初始 `origin` 是 `(0.5, 0.57)`，见 `CityChannelPhaserScene.js:653-655`。`getGearSurfaceContext` 也使用 `projection.x - TILE_RENDER_WIDTH * 0.5`、`projection.y - TILE_RENDER_HEIGHT * 0.57` 计算板面 offset，见 `CityChannelPhaserScene.js:4387-4391`。

### 为什么板材会朝诡异方向偏移

最可疑位置是 `applyMechanismRuntimePlacementTransforms` 和 `getRuntimePlacementAtAngle` 的组合：

- `getRuntimePlacementAtAngle` 旋转的是 `placement` 原点本身，见 `cityChannelMechanismSimulation.js:133-145`。
- `applyMechanismRuntimePlacementTransforms` 再将这个运行态原点投影成 image position，见 `CityChannelPhaserScene.js:523-548`。
- 板材视觉旋转不是 Phaser container/pivot 旋转，而是更换一张按 `runtimePlacement.rotation` 生成的贴图，见 `CityChannelPhaserScene.js:549-554`。
- 固定轴 pivot 没有作为持久化 `pivotWorld` 被锁定，而是每次从当前 `mapData` 计算，见 `cityChannelMechanismSimulation.js:98-109` 和 `CityChannelPhaserScene.js:519`。

这套路径在逻辑测试里能保持固定轴局部点不变，测试见 `cityChannelMechanismSimulation.test.js:71-106`；但渲染层需要 `placement.x/y`、texture origin、`TILE_RENDER_CENTER`、板面 polygon 与 logical anchor 完全一致。当前代码中板材顶面几何 `createTileGeometry` 的 `top` 没有应用 `tileRotation`，只在墙体/竖直板相关几何使用 rotation，见 `CityChannelGeometry.js:163-177` 和 `CityChannelGeometry.js:189-201`。这会增加“逻辑旋转正确，但贴图/板面投影感知不围绕同一个点”的风险。

结论：逻辑层不是简单地围绕板材中心旋转；它尝试围绕固定轴 anchor 旋转。但渲染层没有真正以固定轴屏幕点为 Phaser pivot，而是通过“旋转逻辑原点 + 换贴图 + 重绘齿轮层”模拟，因此最容易出现视觉漂移。

## 9. 高风险代码片段

### 片段 1：固定轴运行态齿轮改用 `projectCell(runtimeAxisAnchor)`

- 文件路径：`frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js:4242`
- 函数名/类名：`CityChannelPhaserScene.redrawMountedGearHostLayers`
- 代码片段：

```js
const point = runtimeGear?.axisType === 'fixedAxis' && placement.runtimeAxisAnchor
  ? projectCell(placement.runtimeAxisAnchor, this.cameraState.yaw, this.mapData)
  : this.getGearMountPoint(placement, mount);
```

- 为什么可疑：固定轴运行态不再使用 `getGearMountPoint(placement, mount)` 的板面几何投影，而直接把逻辑 anchor 当 cell 投影。
- 可能造成什么现象：齿轮中心在逻辑世界被锁住，但视觉中心与静态贴面齿轮不一致，表现为固定轴被传动后跳位或下移。

### 片段 2：固定轴运行态强制 `lockedCenter`

- 文件路径：`frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js:4253`
- 函数名/类名：`CityChannelPhaserScene.redrawMountedGearHostLayers`
- 代码片段：

```js
this.drawMountedGearPreview(layer, point, {
  ...
  lockedCenter: runtimeGear?.axisType === 'fixedAxis' && !!placement.runtimeAxisAnchor
});
```

- 为什么可疑：运行态固定轴切换到 `drawMountedGearPreview` 的另一条绘制分支。
- 可能造成什么现象：同一个齿轮运行前后用不同半径、阴影、extrusion 和中心语义绘制，出现视觉位置突变。

### 片段 3：`lockedCenter` 分支不使用板面几何

- 文件路径：`frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js:5066`
- 函数名/类名：`CityChannelPhaserScene.drawMountedGearPreview`
- 代码片段：

```js
if (options.lockedCenter) {
  graphics.fillEllipse(point.x, point.y + 5, 30, 10);
  drawGearShape(graphics, point.x, point.y, 15, 11, GEAR_TOOTH_COUNT, options.angle || 0);
  graphics.fillCircle(point.x, point.y, 5);
  return;
}
```

- 为什么可疑：普通 mounted gear 分支使用 `getProjectedSurfaceGearOutline`、`getProjectedSurfaceCircle`、`extrusion`，而该分支只是平面画齿轮。
- 可能造成什么现象：固定轴运行态视觉不再贴合板材表面，和板材/普通齿轮存在垂直偏差。

### 片段 4：固定轴齿轮运行态角度没有使用 runtime phase

- 文件路径：`frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js:4248`
- 函数名/类名：`CityChannelPhaserScene.redrawMountedGearHostLayers`
- 代码片段：

```js
const gearAngle = runtimeGear?.axisType === 'fixedAxis' && Number.isFinite(placement.runtimeAngle)
  ? (mount.phase ?? 0)
  : (runtimeGear?.phase ?? mount.phase ?? 0);
```

- 为什么可疑：固定轴运行态有 `runtimeGear.phase`，但这里固定轴分支回退到静态 `mount.phase`。
- 可能造成什么现象：固定轴齿轮本应自转，实际视觉可能不自转或相位不同步。它不直接解释下移，但说明固定轴运行态特殊分支同时影响了位置和自转。

### 片段 5：板材运行态旋转原点由 `placement` 直接绕 anchor 得出

- 文件路径：`frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js:133`
- 函数名/类名：`getRuntimePlacementAtAngle`
- 代码片段：

```js
const point = rotateWorldPointAround(placement, anchor, degrees);
...
rotation: normalizeRotation(baseRotation + degrees)
```

- 为什么可疑：没有显式使用 `mountPointLocal` 反推 `boardWorldPosition`，而是依赖 `placement` 原点语义和当前 `anchor` 推导。
- 可能造成什么现象：如果 `placement.x/y` 与渲染 image origin、板面中心或 texture 中心不一致，板材看起来会围绕错误点或沿奇怪方向偏移。

### 片段 6：运行态应用通过换贴图模拟旋转

- 文件路径：`frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js:523`
- 函数名/类名：`CityChannelPhaserScene.applyMechanismRuntimePlacementTransforms`
- 代码片段：

```js
const runtimePlacement = getRuntimePlacementAtAngle(placement, anchorWorld, angle);
const runtimeProjection = projectCell(runtimePlacement, this.cameraState.yaw, this.mapData);
tileObject.setPosition(runtimeProjection.x, runtimeProjection.y);
this.setBoardTexture(tileObject, this.textureCache.getTileTexture(... runtimePlacement.rotation ...));
```

- 为什么可疑：板材没有真实 pivot transform，只是移动 image 并替换旋转 texture。
- 可能造成什么现象：如果 texture 原点、逻辑 placement 原点和齿轮固定点投影之间存在偏差，会表现为板材绕错误点漂移。

### 片段 7：固定轴 anchor 未持久化

- 文件路径：`frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js:98`
- 函数名/类名：`getFixedAxisWorldAnchor`
- 代码片段：

```js
const placement = getPlacementByComponentKey(mapData, fixedAxis.componentKey)
  || (fixedAxis.cell ? getPlacementByComponentKey(mapData, createCellKey(...)) : null);
const anchor = getGearWorldPosition(placement, fixedAxis);
```

- 为什么可疑：固定轴中心不是一个安装时锁定的 `pivotWorld`，而是从当前 `mapData` 重新计算。
- 可能造成什么现象：静态地图不变时问题不明显；如果后续拖动、旋转或运行态链路传入的 fixedAxis 与源 placement 不一致，anchor 可能被错误重算。

## 10. 初步根因判断

### 根因 1：固定轴运行态齿轮切换到 `lockedCenter` 平面绘制分支

证据：

- `redrawMountedGearHostLayers` 对固定轴运行态使用 `projectCell(placement.runtimeAxisAnchor)`，见 `CityChannelPhaserScene.js:4242-4245`。
- 同一处传入 `lockedCenter: true`，见 `CityChannelPhaserScene.js:4261`。
- `drawMountedGearPreview` 的 `lockedCenter` 分支只画平面齿轮，见 `CityChannelPhaserScene.js:5066-5075`；普通分支使用板面 projection/extrusion，见 `CityChannelPhaserScene.js:5077-5125`。

影响：

- 固定轴运行前后齿轮视觉中心、阴影、厚度和投影规则不一致。

为什么会导致固定轴齿轮下移：

- 普通分支的齿轮被 extrusion 和板面几何抬到板面上；locked 分支直接以 `projectCell(anchor)` 作为 2D 中心绘制。两者屏幕 y 基准不同，切换时容易表现为下移。

为什么会导致板材诡异偏移：

- 齿轮中心视觉和板材表面视觉不再使用同一套投影，用户会看到“齿轮像是被锁在另一个点，板材从其背后滑走”。这会放大板材运行态 pivot 的任何视觉误差。

### 根因 2：板材运行态没有真实 pivot/container，而是旋转逻辑原点并替换贴图

证据：

- 没有 per-board container，所有对象同属 `mapLayer`，见 `CityChannelPhaserScene.js:242-254`。
- `applyMechanismRuntimePlacementTransforms` 通过 `setPosition` 和 `getTileTexture(runtimePlacement.rotation)` 表现板材旋转，见 `CityChannelPhaserScene.js:523-554`。
- `getRuntimePlacementAtAngle` 旋转的是 `placement` 原点，见 `cityChannelMechanismSimulation.js:133-145`。
- 板材 image 使用 `origin(0.5, 0.57)`，见 `CityChannelPhaserScene.js:653-655`，板面 offset 也依赖这个 origin，见 `CityChannelPhaserScene.js:4389-4391`。

影响：

- 逻辑层的 pivot 约束依赖多个渲染假设：`placement.x/y` 是板材原点、image origin 对应该原点、texture rotation 与板面局部坐标一致。

为什么会导致固定轴齿轮下移：

- 如果板材贴图 origin 和 `projectCell(anchor)` 的视觉基准不一致，固定轴齿轮 locked 分支会暴露这个偏差。

为什么会导致板材诡异偏移：

- 板材位置由绕 anchor 旋转后的 `placement.x/y` 投影得到，但视觉上没有围绕固定轴的 Phaser pivot 旋转，导致用户感知到板材整体向某个方向漂移。

### 根因 3：固定轴中心没有作为持久化 hard constraint

证据：

- 数据模型中没有 `pivotWorld`，固定轴 mount 只保存 `position` 和 `axisType`，见安装对象 `cityChannelEditorInteraction.js:88-99`。
- `getFixedAxisWorldAnchor` 每次从 `mapData` 中重新计算 anchor，见 `cityChannelMechanismSimulation.js:98-109`。
- 齿轮链路径虽在 `assemblyEntries` 中保存 `anchor`，但 `applyMechanismRuntimePlacementTransforms` 又重新调用 `getFixedAxisWorldAnchor(this.mapData, fixedAxis)`，见 `cityChannelMechanismPlayback.js:381` 和 `CityChannelPhaserScene.js:519`。

影响：

- 目前静态 `mapData` 不被运行态修改，所以多数情况下 anchor 仍一致；但模型没有表达“固定轴齿轮中心世界坐标必须锁定”的硬约束，容易被后续拖动、旋转、多个固定轴同时驱动等场景破坏。

为什么会导致固定轴齿轮下移：

- 该根因单独不一定造成当前下移；更可能是让渲染层绕过同一 anchor 传递，增加运行态和齿轮层不一致的机会。

为什么会导致板材诡异偏移：

- 一旦 anchor 推导和实际安装时视觉中心不同，板材运行态会围绕错误 pivot 计算位置。

## 11. 建议修复方向，但不要实际修改

推荐方案：建立固定轴 pivot 约束，并统一逻辑层和渲染层的坐标语义。

1. **逻辑层和渲染层分离**
   - 逻辑层只产出 `gearAngle`、`boardAngle`、`pivotWorld`、`mountPointLocal`、`boardWorldPosition`。
   - 渲染层只消费这些运行态值，不再在齿轮绘制函数里临时改变固定轴中心计算方式。

2. **齿轮传动只传播角度，不传播位置**
   - `buildGearContactGraph` 和 `resolveDrivenGearNodes` 继续只输出 `driveRatio`。
   - 活动轴齿轮只更新 `runtimeGear.phase`，不触发宿主板材 transform。
   - 固定轴齿轮被驱动时，齿轮中心不参与任何位置求解，只作为 pivot 约束。

3. **固定轴齿轮中心世界坐标作为硬约束**
   - 在运行开始时确定 `pivotWorld = getGearWorldPosition(basePlacement, fixedMount)`。
   - 在同一次 runtime snapshot 内传递并复用这个 `pivotWorld`，避免 `applyMechanismRuntimePlacementTransforms` 再自行从 `mapData` 重算。
   - 可考虑在安装或运行态结构中显式保存 `runtimeAxisAnchor`，并以它作为唯一固定轴中心来源。

4. **用 pivotWorld 和 mountPointLocal 反推板材 world position**
   - 对水平板材，使用目标公式：

```text
boardWorldPosition = pivotWorld - Rotate(anchorLocal, boardAngle)
fixedGearWorldPosition = pivotWorld
fixedGearRotation = fixedGearInitialRotation + transmittedDeltaAngle
boardRotation = boardInitialRotation + transmittedDeltaAngle
```

   - 对当前代码命名，可解释为：
     - `anchorLocal = getGearMountLocalPosition(mount.position)`
     - `pivotWorld = entry.anchor`
     - `boardAngle = baseRotation + transmittedDeltaAngle`
     - `runtimePlacement.x/y = pivotWorld - rotatePoint(anchorLocal, boardAngle)`
   - 墙面/竖直板需要按 `getGearWorldPosition` 中 `edge` 语义单独定义局部轴。

5. **统一固定轴齿轮运行态绘制分支**
   - 避免固定轴运行态从普通 mounted gear 分支切换到 `lockedCenter` 平面分支。
   - 推荐让固定轴也走 `getProjectedSurfaceGearOutline` 和 extrusion 分支，但中心来自 `pivotWorld` 对应的板面局部点或由运行态 placement 反算出的固定 mount 点。
   - 如果必须画 locked center，至少要让 locked 分支复用普通齿轮的投影半径、surface extrusion 和视觉中心偏移。

6. **避免 parent container 与手动 world position 双重变换**
   - 当前没有 per-board container。如果未来改成 container，板材和附着齿轮应作为同一 assembly 容器下的视觉对象，只在容器上应用 pivot transform，子对象不再手动写 world position。
   - 若保持当前重绘方案，则不要再对固定轴齿轮使用独立的 screen point 分支。

7. **活动轴和固定轴分开处理**
   - 活动轴：`worldPosition` 来自安装位置，`rotation/phase` 可变，不驱动宿主板材。
   - 固定轴：`pivotWorld` 固定，`gearAngle` 自转，`boardAngle` 驱动 assembly；渲染层保持齿轮中心与 pivot 一致。

## 12. 后续修复前需要确认的问题

- 外啮合齿轮方向是否永远相反：当前 `buildGearContactGraph` 对接触边使用负 ratio，见 `cityChannelGears.js:441-442`。
- 不同半径/齿数齿轮是否按齿数比传动：当前 `gearRatioRadius` 来自 `teeth`，`getGearRatioRadiusForMount` 见 `cityChannelMechanismPlayback.js:243`，默认齿数见 `cityChannelMechanismSimulation.js:17`。
- 一个板材或同一 assembly 上多个固定轴齿轮同时被驱动时如何处理：当前 `playAssemblyGearRotation` 会为每个 fixed node 建 `assemblyEntries`，但同一 assembly 多 pivot 同时旋转的产品语义需要明确，见 `cityChannelMechanismPlayback.js:363-384`。
- 固定轴齿轮是否允许拖拽改变 pivot：当前移动齿轮只是改变 mount 的 `position`/`surface`，见 `CityChannelPhaserScene.js:3905-4000`；没有持久化 pivot。
- 板材旋转时其他连接件、传动骨骼、压力板机构、label、overlay 是否都必须跟随同一 pivot：当前 `applyMechanismRuntimePlacementTransforms` 处理 tile/wall image、label、mechanism、gear layer、vertical overlay，见 `CityChannelPhaserScene.js:545-567`。
- 固定轴齿轮运行态是否应显示自转：当前 fixedAxis 分支 `gearAngle` 使用 `mount.phase` 而不是 `runtimeGear.phase`，见 `CityChannelPhaserScene.js:4248-4250`，需要确认这是临时视觉锁定还是 bug。
- 板材 texture 的旋转语义是否等于真实几何旋转：`getTileTexture` 使用 rotation 生成贴图，但 `createTileGeometry` 顶面点未按 `tileRotation` 旋转，见 `CityChannelGeometry.js:163-177`；需要确认视觉设计是否允许只旋转纹理不旋转几何。
- 固定轴中心应该锁在逻辑世界 cell 坐标，还是锁在屏幕投影后的板面 attachment 中心：当前代码两者混用，运行态 fixedAxis 用 `projectCell(runtimeAxisAnchor)`，普通 mount 用 `getGearMountPoint`。

## 13. 修复参考资料与关键结论

- Phaser 3 Game Object origin/displayOrigin/rotation 文档：对象旋转围绕自身 origin/display origin 生效，不能把屏幕上某个临时投影点当成稳定的世界 pivot。
- Phaser 3 Container/TransformMatrix 文档：子对象会继承父级 transform，若同时手动写 world position 和父级旋转，容易产生重复变换；当前修复继续保持板材、齿轮层作为 `mapLayer` 兄弟对象，并只投影运行态世界坐标。
- Phaser 3 坐标投影结论：相机 yaw 改变时，屏幕坐标会整体变化，所以固定轴约束必须定义在逻辑世界坐标和板材局部坐标中，再由 `projectCell`/`mapGearLocalPointToSurface` 投影。
- Box2D revolute joint / gear joint 设计结论：固定轴本质是约束两个物体在同一 anchor 上相对转动，gear joint 传播角度比例；不应该把齿轮接触点或当前屏幕中心当作新的位置目标。
- 游戏齿轮传动通用结论：外啮合齿轮相位方向相反，传动图应只传播 phase/ratio；`freeAxis` 不改变宿主板材 transform，`fixedAxis` 用稳定 `pivotWorld` 约束板材旋转。

## 附：潜在 bug 类型逐条排查

| 编号 | 类型 | 判断 | 证据 |
|---|---|---|---|
| 1 | 固定轴齿轮的世界坐标被错误更新 | 部分存在，主要是渲染层视觉坐标 | 逻辑测试能保持 anchor，见 `cityChannelMechanismSimulation.test.js:71-106`；渲染层固定轴运行态改用 `projectCell(runtimeAxisAnchor)` 和 `lockedCenter`，见 `CityChannelPhaserScene.js:4242-4262`。 |
| 2 | 固定轴齿轮被加入板材 container 后，板材旋转导致齿轮位置被动改变 | 未发现 | 只有全局 `worldLayer` 和 `mapLayer`，见 `CityChannelPhaserScene.js:242-254`；齿轮层是 `mapLayer` 兄弟对象，见 `CityChannelPhaserScene.js:4140-4148`。 |
| 3 | 板材旋转时使用错误 pivot | 部分存在 | 逻辑层用 fixed axis anchor，见 `cityChannelMechanismSimulation.js:133-145`；但渲染层不是真实 pivot transform，而是移动原点和换贴图，见 `CityChannelPhaserScene.js:523-554`。 |
| 4 | `gear.rotation` 和 `board.rotation` 使用同一个 transform 层导致叠加错误 | 部分存在 | 没有 Phaser 同层 rotation；但 fixedAxis 的 `gearAngle` 运行态没有使用 `runtimeGear.phase`，见 `CityChannelPhaserScene.js:4248-4250`，板材角度来自 `runtimePlacement.rotation`。 |
| 5 | 同一对象既设置 parent container，又手动设置 world position 导致双重变换 | 未发现 per-board 版本 | 所有对象同属 `mapLayer`，没有板材专属 parent；但全局 `worldLayer` 会统一缩放/平移，见 `CityChannelPhaserScene.js:967-972`。 |
| 6 | 固定点 local 坐标当成 world 坐标使用，或反过来 | 部分存在风险 | 逻辑层 local->world 在 `getGearWorldPosition` 中清晰，见 `cityChannelMechanismSimulation.js:75-96`；渲染层 fixedAxis 运行态把 `runtimeAxisAnchor` 直接 `projectCell`，与普通 `mapGearLocalPointToSurface` 路径不同，见 `CityChannelPhaserScene.js:4242-4245`。 |
| 7 | 更新顺序错误：先旋转板材再根据旋转后的点位更新齿轮位置 | 部分存在视觉风险 | snapshot 先生成 placements/gears，随后 `setGearMountPhases` 和 `applyMechanismRuntimePlacementTransforms` 重绘，见 `cityChannelMechanismPlayback.js:476-493`；固定轴齿轮用 anchor 锁中心，不走旋转后点位，但普通齿轮走 runtimePlacement 点位。 |
| 8 | 活动轴传动结果错误影响固定轴位置，而不是只影响角度 | 未发现直接证据 | 接触图只传播 ratio，见 `cityChannelGears.js:422-446`；固定轴位置变化来自 assembly runtime transform 和 fixedAxis 绘制分支，见 `cityChannelMechanismPlayback.js:487-492`。 |
| 9 | 碰撞/啮合计算把中心距或接触点当成新位置目标 | 未发现 | `buildGearContactGraph` 只用距离判断是否建边和 ratio，见 `cityChannelGears.js:429-442`，未写回 position。 |
| 10 | 缺少“固定轴齿轮中心世界坐标锁定”的约束 | 存在 | 数据模型无 `pivotWorld`，`getFixedAxisWorldAnchor` 每次从 `mapData` 推导，见 `cityChannelMechanismSimulation.js:98-109`；运行态应用又重算 anchor，见 `CityChannelPhaserScene.js:519`。 |
