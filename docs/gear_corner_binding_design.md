# 城内工坊顶角齿轮与连轴板材选择设计文档

## 1. 目标概述

当前“活动轴 / 固定轴”命名已经不足以表达实际产品语义。新的模型应改为：

- 齿轮轴心永远是固定空间点；
- 齿轮默认只自转，不绑定任何板材；
- 用户可以在齿轮选中态下选择“连轴板材”；
- 被绑定的连轴板材，或它通过传动骨骼连接的整体，会围绕齿轮轴心旋转；
- 未绑定的周围板材不跟随；
- 齿轮啮合只传播角度、相位和传动比，不代表板材连接；
- 暂时只实现水平共面顶角齿轮，不实现垂直状态齿轮啮合。

这套语义对应物理引擎里的概念是：齿轮接触近似 gear joint，只约束角速度/相位；连轴板材近似 revolute joint 或 weld/revolute 组合，才决定哪个刚体绕固定 pivot 运动。

## 2. 外部参考结论

| 资料 | 关键结论 | 对本项目的影响 |
|---|---|---|
| [Phaser GameObject Components](https://docs.phaser.io/phaser/concepts/gameobjects/components) | `x/y` 是 GameObject 的本地位置；在 Container 内时位置和 rotation 都相对父 Container；`rotation` 是弧度，`angle` 是角度；旋转围绕 origin 发生 | 本项目逻辑层当前使用角度，Phaser 渲染层需要避免把角度直接写入 `rotation`；如果以后用 Container 装板材和齿轮，不能再手动同时写世界坐标 |
| [Phaser Game Objects](https://docs.phaser.io/phaser/concepts/gameobjects) | GameObject 的 `x/y` 在无 Container 时可视为世界位置，在 Container 内是局部位置；`z` 不是 depth | 当前 mounted gear 用 Graphics 投影绘制，正确方向是由逻辑层 world/local 坐标投影出屏幕点，而不是把齿轮塞进板材 Container 再补偿 |
| [Phaser Container](https://docs.phaser.io/phaser/concepts/gameobjects/container) | Container 的 transform point 固定为本地 `[0,0]`，不能像 Sprite origin 那样改 pivot | 板材绕任意顶角旋转不应依赖 Container origin hack；应继续用纯函数根据 `pivotWorld + anchorLocal` 反推 placement |
| [Box2D Revolute Joint](https://box2d.org/documentation/group__revolute__joint.html) | revolute joint 表示两个刚体共享 anchor、允许相对旋转、没有相对平移 | “连轴板材”才是板材绕齿轮轴心运动的约束；齿轮本身不能隐式拖动所有相邻板 |
| [Box2D Gear Joint](https://box2d.org/doc_version_2_4/classb2_gear_joint.html) | gear joint 约束两个 revolute/prismatic joint 的坐标比例，公式是 `coordinate1 + ratio * coordinate2 = constant`，ratio 可正可负 | 齿轮啮合只传播相位、方向和齿数比；啮合不是刚性连接，不能用于 assembly 分组 |

## 3. 当前代码现状

| 文件路径 | 当前职责 | 与新设计冲突点 |
|---|---|---|
| `frontend/src/components/game/cityChannel/cityChannelMechanismRuntime.js` | 传动骨骼、assembly 构建、齿轮安装点局部坐标 | `getGearMountLocalPosition` 在 160-168 行把角点放在 `±0.32`，不是板材顶角；373 行用 `axisType === 'fixedAxis'` 生成 `fixedAxes` |
| `frontend/src/components/game/cityChannel/phaser/cityChannelPhaserSceneUtils.js` | 齿轮 socket 常量、齿轮半径常量 | 47-52 行用 `GEAR_SOCKET_CORNER_OFFSET = 0.32` 推导统一齿轮半径，顶角改成 `±0.5` 后必须重算 |
| `frontend/src/components/game/cityChannel/phaser/cityChannelGears.js` | 齿轮安装命中、齿轮接触图、同面啮合 | 346-391 行安装点来自宿主板 socket，只检查同一宿主 socket 和遮挡；422-445 行齿轮接触只看同 `surfaceKey` 和 pitch 距离，不连接板材 |
| `frontend/src/components/game/cityChannel/phaser/cityChannelMechanismPlayback.js` | 运行齿轮传动、生成 runtime snapshot、应用板材旋转 | 396 行只把 `axisType === 'fixedAxis'` 当成会带动板材的齿轮；413-416 行 fixed 节点创建 runtime entry，没有连轴板材选择 |
| `frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js` | 齿轮 world position、pivot 公式、运行态 placement | 206-264 行的 `getRuntimePlacementAroundFixedGear` 公式可复用；385-439 行 snapshot 仍按 `fixedMount/fixedAxis` 命名和判断 |
| `frontend/src/components/game/cityChannel/phaser/CityChannelPhaserScene.js` | Phaser 场景、安装/移动齿轮、绘制齿轮、运行态刷新 | 4298-4314 行根据 runtime gear phase 和 host rotation 算视觉角度；5134-5209 行绘制仍用 `axisType` 决定 hub 颜色 |
| `frontend/src/components/game/cityChannel/CityChannelPhaserEditor.js` | React 编辑器状态、齿轮配置更新 | 319-381 行仍校验和写入 `fixedAxis/freeAxis` |
| `frontend/src/components/game/cityChannel/CityChannelMechanismPanel.js` | 参数面板、齿轮配置 UI | 14-15 行和 219-228 行仍展示并编辑“固定轴 / 活动轴” |
| `frontend/src/components/game/cityChannel/cityChannelCatalog.js` | 板材目录、预设齿轮位 | 预设 actuator 板内置多个 `axisType`，后续应迁移为中心齿轮和顶角齿轮能力模板 |
| `frontend/src/components/game/cityChannel/phaser/renderer/CityChannelTextureCache.js` | 板材纹理和预设齿轮安装点绘制 | 角点齿轮半径和颜色依赖 `mount.position` / `axisType` |

结论：当前代码已经有传动骨骼 assembly 和齿轮接触图两套结构，但旧实现把“齿轮是否带动板材”压在 `axisType` 上。新设计不需要重做整个机械系统，核心是把这条判断替换为 `axisBinding`，并把角点坐标、安装合法性、候选绑定交互补齐。

## 4. 当前关键实现链路

### 4.1 齿轮安装点

当前位置定义在 `frontend/src/components/game/cityChannel/cityChannelMechanismRuntime.js:160` 的 `getGearMountLocalPosition`：

```js
center: { x: 0, y: 0, z: 0 },
corner_ne: { x: 0.32, y: -0.32, z: 0 },
corner_nw: { x: -0.32, y: -0.32, z: 0 },
corner_se: { x: 0.32, y: 0.32, z: 0 },
corner_sw: { x: -0.32, y: 0.32, z: 0 }
```

问题：

- 板材局部坐标边界是 `±0.5`；
- 四个角点当前在板材内部，不在顶角；
- fixed pivot 被放进板材内部，旋转扫掠空间和视觉锚点都不符合设计；
- `frontend/src/components/game/cityChannel/phaser/cityChannelPhaserSceneUtils.js:47` 的 `GEAR_SOCKET_CORNER_OFFSET = 0.32` 也暗含“角点在板内”的旧假设。

新目标：

```js
center: { x: 0, y: 0, z: 0 },
corner_ne: { x: 0.5, y: -0.5, z: 0 },
corner_nw: { x: -0.5, y: -0.5, z: 0 },
corner_se: { x: 0.5, y: 0.5, z: 0 },
corner_sw: { x: -0.5, y: 0.5, z: 0 }
```

齿轮大小应统一，中心齿轮和顶角齿轮不应因为位置不同而大小不同。顶角齿轮允许一部分悬在板外，这是设计要求，不应往板内缩。

### 4.2 安装合法性

当前 `frontend/src/components/game/cityChannel/phaser/cityChannelGears.js:346` 的 `getGearInstallTarget`：

- 根据命中板材 surface 计算 pointer local；
- 从 `GEAR_SOCKET_POSITIONS` 选最近 socket；
- 检查同一宿主同一 socket 是否已有齿轮；
- 检查 socket 是否被竖直板遮挡。

缺失：

- 没有判断“某个顶角四周是否至少有一块板材”；
- 没有判断共享顶角上共面齿轮冲突；
- 没有区分顶角齿轮和中心齿轮；
- 没有为顶角齿轮生成候选连轴板材。

新规则：

- 中心齿轮安装在板材表面中心，只属于该板 surface；
- 顶角齿轮安装在共面板材共享顶角的空间点；
- 一个水平共面顶角至少要有一块相邻板材，才能安装顶角齿轮；
- 同一水平共面顶角只能有一个顶角齿轮；
- 暂时不处理垂直共面/异面顶角齿轮啮合；
- 不需要维护全局占用表，安装和移动时做局部扫描即可。

这里的“局部扫描”不是维护常驻世界顶角占用索引，而是在放置、拖动、复制提交前，以目标 `pivotWorld` 为中心扫描附近最多四个水平共面 tile，计算是否已有同点同面顶角齿轮，以及有哪些可选连轴板材。

### 4.3 传动与板材旋转

当前运行态：

- `frontend/src/components/game/cityChannel/phaser/cityChannelGears.js:422` 的 `buildGearContactGraph` 按同 `surfaceKey`、中心距和 pitch radius 建边，边上 ratio 为负数，表达外啮合反向传动；
- `frontend/src/components/game/cityChannel/phaser/cityChannelGears.js:484` 的 `resolveDrivenGearNodes` 沿齿轮接触图传播 `driveRatio`；
- `frontend/src/components/game/cityChannel/phaser/cityChannelMechanismPlayback.js:390` 的 `playAssemblyGearRotation` 从 driven fixedAxis 节点生成 assembly entry；
- `frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js:385` 的 `createMechanismRuntimeSnapshot` 根据 fixedAxis entry 生成 runtime placements；
- `frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js:206` 的 `getRuntimePlacementAroundFixedGear` 用 pivot 反推板材 position。

可保留：

- 齿轮接触图传播 phase / ratio；
- pivotWorld + anchorLocal 反推板材位置；
- runtime snapshot transient transform。

必须改：

- 不再用 `axisType === 'fixedAxis'` 判断是否带动板材；
- 改为判断 `mount.axisBinding` 是否存在；
- 没有 binding 的齿轮，即使被传动，也只更新 phase；
- 有 binding 的齿轮，才带动绑定板材所在传动骨骼整体；
- 齿轮接触不合并 assembly。

### 4.4 旧“整体”判断的实际问题

`buildMechanicalAssemblies` 已经只把有传动骨骼端口的板材纳入 assembly，齿轮接触图本身没有把板材合成一个整体。真正需要防止的是后续实现又把“齿轮啮合可达”误当成“板材刚性连接”。新模型中整体只能来自：

- 传动骨骼端口连接；
- 单个 `axisBinding` 绑定的目标板材；
- 绑定板材所在的传动骨骼 assembly。

齿轮啮合本身只能贡献 `driveRatio` 和 `phase`。

## 5. 新数据模型建议

### 5.1 齿轮 mount

建议字段：

```js
{
  id: 'gear_xxx',
  componentType: 'gear',
  position: 'center' | 'corner_ne' | 'corner_nw' | 'corner_se' | 'corner_sw',
  socketKind: 'center' | 'corner',
  surface: 'front',
  phase: 0,
  teeth: 18,
  axisBinding: null | {
    componentKey: '0:10:12',
    hostKind: 'tile',
    socket: 'corner_sw',
    surface: 'front'
  }
}
```

兼容期：

- 保留读取旧 `axisType`，但不再作为核心判断；
- `axisType === 'fixedAxis'` 可迁移为“如果能推断宿主板且该齿轮位于合法顶角，则生成 axisBinding”；
- `axisType === 'freeAxis'` 迁移为 `axisBinding: null`；
- 新写入不再写 `fixedAxis/freeAxis`。

### 5.2 socket 类型

建议显式区分 `center` 和 `corner`：

```js
const isCornerSocket = (position) => /^corner_/.test(position);
const isCenterSocket = (position) => position === 'center';
```

差异：

- `center` 齿轮安装在板材表面中心，天然依附于该板材表面，但不自动带动该板材绕自身旋转；
- `corner` 齿轮安装在板材顶角空间点，轴心属于共享顶角，不属于某一块板；
- `corner` 齿轮可以选择一个连轴板材，绑定后才带动该板材或它的传动骨骼 assembly；
- `corner` 齿轮和邻近 `center` 齿轮可以啮合，啮合不改变绑定关系。

### 5.3 候选连轴板材

建议运行时结构：

```js
{
  gearHostKey,
  mountId,
  pivotWorld,
  candidates: [
    {
      componentKey,
      hostKind: 'tile',
      socket: 'corner_ne',
      surface: 'front',
      assemblyId,
      screenAnchor,
      screenPath,
      selected: true | false
    }
  ]
}
```

候选只用于编辑态显示和点击，不必持久化。

## 6. 新交互流程

### 6.1 放置齿轮

1. 用户选择齿轮工具；
2. pointer hit 到水平共面板材；
3. 如果靠近板材中心，生成中心齿轮候选；
4. 如果靠近顶角，生成顶角齿轮候选；
5. 顶角候选合法性检查：
   - 该顶角至少关联一块水平共面板材；
   - 同一顶角同一水平面没有已有顶角齿轮；
   - 不与被移动/复制中的齿轮冲突；
6. 放置成功后：
   - 默认 `axisBinding: null`；
   - 显示候选虚线；
   - 齿轮只自转，不绑定板材。

### 6.2 选择连轴板材

1. 用户选中齿轮；
2. 如果齿轮是顶角齿轮，显示四周共面候选板材虚线；
3. 不符合共面条件的板材不显示虚线；
4. 当前绑定的虚线和板材高亮；
5. 点击候选虚线：
   - 未绑定：写入 `axisBinding`；
   - 已绑定同一个候选：清空 `axisBinding`；
   - 绑定其他候选：替换 `axisBinding`；
6. 切换后刷新齿轮视觉、候选线和机制面板。

### 6.3 运行传动

1. 压力板或源齿轮触发；
2. 齿轮接触图传播 phase；
3. 对每个被驱动 gear node：
   - 无 `axisBinding`：只写 runtime gear phase；
   - 有 `axisBinding`：找到绑定板材所属 assembly；
   - 如果绑定板材没有传动骨骼 assembly，则创建单板 runtime entry；
   - 如果有 assembly，则整个 assembly 围绕 pivotWorld 旋转；
4. fixed pivot 永远使用齿轮轴心世界坐标；
5. 板材位置由 `pivotWorld - Rotate(anchorLocal, angle)` 反推；
6. 不修改静态 `mapData` 位置和 phase。

### 6.4 无法转动时的行为

如果绑定板材或绑定 assembly 被遮挡，正确行为是：

- 齿轮仍可按接触图计算自转相位；
- 如果空间不足，板材不应被强行平移；
- 运行态应给出“转动空间不足”的提示；
- fixed pivot 仍保持原世界位置；
- 不允许用平移来绕过旋转碰撞。

也就是说，障碍检测只能限制 `boardAngle`，不能把齿轮中心或板材整体改成某个“避障位置”。

## 7. 几何与坐标设计

### 7.1 水平板局部坐标

板材局部坐标采用：

```text
nw = (-0.5, -0.5)
ne = ( 0.5, -0.5)
se = ( 0.5,  0.5)
sw = (-0.5,  0.5)
center = (0, 0)
```

`rotation` 仍以度为单位。

顶角 world position：

```text
pivotWorld = boardWorldOrigin + Rotate(cornerLocal, boardRotation)
```

中心齿轮 world position：

```text
gearWorld = boardWorldOrigin + Rotate({0,0}, boardRotation)
```

绑定板材旋转：

```text
boardAngle = baseRotation + transmittedDelta
boardWorldPosition = pivotWorld - Rotate(boundSocketLocal, boardAngle)
```

### 7.2 顶角齿轮和中心齿轮啮合

要求：

- 顶角齿轮中心在 `±0.5` 顶角；
- 中心齿轮中心在 `{0,0}`；
- 齿轮统一大小；
- 顶角齿轮要能和邻近板材中心齿轮啮合。

如果统一齿轮半径沿用当前 `GEAR_PITCH_RADIUS_LOCAL = sqrt(2) * 0.32 / 2 ≈ 0.226`，则顶角到相邻板中心的距离约 `sqrt(0.5^2 + 0.5^2) = 0.707`，两个齿轮 pitch 半径和约 `0.452`，不接触。

因此顶角改到 `±0.5` 后，必须重新定义统一齿轮 pitch 半径。为了让“顶角齿轮 ↔ 相邻板中心齿轮”啮合：

```text
pitchRadius ≈ sqrt(0.5^2 + 0.5^2) / 2 ≈ 0.3536
```

建议：

- `GEAR_PITCH_RADIUS_LOCAL = Math.SQRT2 / 4`；
- `GEAR_ROOT_RADIUS_LOCAL = pitch * 0.78`；
- `GEAR_OUTER_RADIUS_LOCAL = pitch * 1.08`；
- 所有齿轮统一使用该半径；
- 屏幕绘制半径从 surface projection 自动推导，不再区分中心/角点大小。

需要同步修改的地方：

- `getGearMountLocalPosition` 的四个角点；
- `GEAR_SOCKET_CORNER_OFFSET` 或直接废弃它；
- `GEAR_PITCH_RADIUS_LOCAL` 和派生半径；
- `getGearInstallTarget` 里 pointer 到 socket 的最近点判断；
- `drawMountedGearPreview` 和 `CityChannelTextureCache` 对齿轮半径、hub 颜色的显示逻辑；
- `buildGearContactGraph` 的 pitch radius 和 contact threshold 测试。

### 7.3 顶角候选的局部几何

水平 tile 的四个角点 world 计算：

```text
cornerWorld = {
  x: tile.x + Rotate(cornerLocal, tile.rotation).x,
  y: tile.y + Rotate(cornerLocal, tile.rotation).y,
  z: tile.z
}
```

局部候选扫描可以用目标 `pivotWorld` 反查附近 tile：

```js
const matchesCorner = distance2D(
  getGearSocketWorldPosition(tile, cornerSocket),
  pivotWorld
) <= EPSILON;
```

`axisBinding.socket` 必须记录“绑定板材的哪个角点与 pivotWorld 重合”。后续旋转时必须使用绑定板材自己的 `socketLocal`，不是齿轮最初被放置时命中的宿主 socket。

### 7.4 旋转公式

绑定板材绕顶角齿轮旋转时：

```text
pivotWorld = fixed gear center world position
anchorLocal = getGearMountLocalPosition(axisBinding.socket)
boardAngle = baseRotation + transmittedDelta
boardPosition = pivotWorld - Rotate(anchorLocal, boardAngle)
gearWorldPosition = pivotWorld
gearPhase = basePhase + transmittedDelta * driveRatio
```

如果绑定的是 assembly：

- 绑定板材用上面的公式，保证绑定角点锁在 pivot；
- assembly 中其他板材应按它们的 base world position 围绕同一 `pivotWorld` 旋转；
- 不能在每帧从 runtime placement 重新计算 pivot；
- 不能把屏幕投影点当成 world pivot。

## 8. 合法性判断设计

### 8.1 顶角候选板材扫描

新增纯函数建议：

```js
getCornerGearBindingCandidates({
  mapData,
  pivotWorld,
  surface: 'floor',
  z
})
```

水平共面候选规则：

- 候选板材必须是 tile；
- `tile.isVertical !== true`；
- `tile.z === pivotWorld.z`；
- 某个角点 world position 与 `pivotWorld` 近似相等；
- 候选 socket 反映该板材使用哪个角与齿轮轴心重合。

示例返回：

```js
[
  { componentKey: '0:0:0', socket: 'corner_ne', surface: 'front' },
  { componentKey: '1:0:0', socket: 'corner_nw', surface: 'front' }
]
```

如果返回为空，顶角齿轮不能安装。这个规则覆盖用户要求的“一个面上某个角四周都没有板材，则齿轮不能安装”。

### 8.2 安装合法性

新增纯函数建议：

```js
validateGearPlacement({
  mapData,
  target,
  ignoreGearKeys = new Set()
})
```

规则：

- `center`：宿主板中心没有齿轮即可；
- `corner_*`：
  - 能找到至少一个共面候选板材；
  - 同一 `pivotWorld + floor z` 没有其他顶角齿轮；
  - 如果已有中心齿轮在可啮合距离内，不是冲突；
  - 如果已有顶角齿轮同点同面，是冲突；
  - 暂时忽略非水平面齿轮。

局部检查即可，不需要维护全局索引。实现上仍可扫描 `mapData.tiles` 和 `mapData.walls`，但只在安装/移动时即时计算。

同一顶角同一平面的冲突判定建议：

```text
samePlane = same surface family and abs(zA - zB) <= EPSILON
sameCorner = distance2D(pivotA, pivotB) <= EPSILON
conflict = samePlane && sameCorner && both are corner gears
```

暂时不支持垂直啮合时，不共面的顶角齿轮可以先不参与冲突，后续做 vertical gear meshing 时再引入 `surfaceNormal`。

### 8.3 移动/复制合法性

移动板材时：

- 预览图中的齿轮也要参与合法性检查；
- 如果移动后顶角齿轮与已有顶角齿轮同点同面冲突，移动无效；
- 如果移动后绑定的 `axisBinding.componentKey` 不存在，应清空 binding 或阻止移动，推荐阻止移动并提示；
- 多选移动时，选中组内部的原有关系可保留。

## 9. 渲染与交互设计

### 9.1 候选虚线层

在 Phaser scene 中新增一个候选绑定层，例如：

```js
this.gearBindingCandidateLayer = this.add.graphics();
```

或复用 `selectionLayer`，但建议独立，避免和板材选择混杂。

显示时机：

- 齿轮刚放下；
- 选中顶角齿轮；
- 选择/取消绑定后短暂刷新；
- 鼠标 hover 候选虚线时高亮。

虚线样式：

- 未绑定候选：黑色虚线；
- hover 候选：橙色虚线；
- 已绑定候选：橙色虚线 + 被绑定板材高亮；
- 无候选：不显示虚线。

### 9.2 点击虚线

需要新增 hit target：

```js
hit.type = 'gearBindingCandidate'
hit.hostKey
hit.mountId
hit.candidate
```

点击行为：

- browse/select 模式下，优先处理候选虚线；
- 如果候选是当前 binding，提交 patch 清空 `axisBinding`；
- 否则提交 patch 设置 `axisBinding`。

### 9.3 面板 UI

旧面板：

- `固定轴 / 活动轴` select；
- `CityChannelGearAxisPrompt`。

新面板：

- 显示“连轴板材：未绑定 / 已绑定 xxx”；
- 提示“选中齿轮后点击虚线切换联动板材”；
- 不再提供 fixed/free 轴切换；
- 兼容期可显示旧 `axisType`，但不允许继续编辑旧字段。

### 9.4 图形语义

建议视觉语义：

- 齿轮颜色不再表示“活动轴/固定轴”；
- 未绑定顶角齿轮显示普通 hub；
- 已绑定顶角齿轮显示连轴标记或高亮环；
- 候选虚线表达“这个齿轮可以绑定哪块板材”；
- 传动骨骼高亮表达“绑定板材会带动哪个 assembly”；
- 小地图或缩略图中的同色整体只能来自传动骨骼 assembly，不能来自齿轮啮合。

## 10. 运行态方案

### 10.1 生成 assembly entry

现有 `createFixedAxisRuntimeEntry` 建议改名：

```js
createAxisBindingRuntimeEntry(scene, gearNode, axisBinding)
```

输入：

- gear node；
- mount；
- axisBinding；
- pivotWorld；
- driveRatio。

逻辑：

- `boundPlacement = mapData.tiles[axisBinding.componentKey]`；
- `boundAssembly = getAssemblyForCell(graph, axisBinding.componentKey)`；
- 如果 `boundAssembly` 存在，旋转整个 assembly；
- 如果不存在，创建单板 assembly：

```js
{
  id: `single_${componentKey}`,
  componentKeys: [componentKey],
  edges: [],
  gearMounts: [],
  fixedAxes: []
}
```

注意：这里不要求 fixed gear 自身所在板材必须属于 `boundAssembly`。齿轮轴心是空间点，`axisBinding` 指向谁，谁才是被驱动板材。

### 10.2 运行态 snapshot 字段

旧字段可逐步替换：

| 旧字段 | 新字段 |
|---|---|
| `runtimeFixedMountId` | `runtimeAxisBindingMountId` |
| `runtimeAxisAnchor` | `runtimePivotWorld` |
| `fixedAxisId` | `axisBindingMountId` |
| `axisType` | `axisBinding ? 'bound' : 'unbound'` 或去掉 |

兼容期可以双写，避免一次性破坏现有测试和渲染。

### 10.3 齿轮自转相位

所有齿轮无论是否绑定板材，都应该按传动图更新 `phase`。

绑定板材只影响 placements：

```text
gear phase: always updated by gear contact graph
board placement: only updated when axisBinding exists
```

`CityChannelPhaserScene.redrawMountedGearHostLayers` 目前在 4298-4304 行会把 fixedAxis 的 `runtimeHostRotation` 从视觉齿轮角度里减掉。迁移后需要重新定义：

- 齿轮自转相位使用 `runtimeGear.phase ?? mount.phase ?? 0`；
- 板材旋转通过 runtime placement 影响投影；
- 如果齿轮被绑定板材携带，视觉上是否需要减去 host rotation，必须以“齿轮齿牙相对世界是否自转”为准统一处理；
- 不能因为以前叫 fixedAxis 就特殊覆盖运行相位。

### 10.4 需要避免的运行态错误

- 不要把齿轮接触图可达节点合并成 board assembly；
- 不要把 `axisBinding` 为空的齿轮生成 board runtime placement；
- 不要每帧从已经旋转过的 runtime placement 重新取 pivot；
- 不要把 `projectCell` 或屏幕点当成 pivot；
- 不要为了避免碰撞把 board position 加 delta 平移；
- 不要在 Phaser Container 里让齿轮跟随板材后再手动设置齿轮世界坐标。

## 11. 要清理的旧逻辑

| 旧逻辑 | 清理方式 |
|---|---|
| `axisType: freeAxis/fixedAxis` 作为核心运行判断 | 改为 `axisBinding` 判断；旧字段仅迁移读取 |
| `CityChannelGearAxisPrompt` | 删除或改成“选择连轴板材”提示 |
| `CityChannelMechanismPanel` 固定轴/活动轴 select | 改成绑定状态说明 |
| `drawMountedGearPreview` hub 颜色依赖 fixed/free | 改成绑定/未绑定颜色，或统一齿轮颜色 |
| `fixedAxes` assembly 字段 | 改名或废弃为 `boundGearMounts` |
| `createFixedAxisRuntimeEntry` / `getFixedAxisWorldAnchor` | 兼容期保留 wrapper，新增 `AxisBinding` 命名函数 |
| actuator 预设里混合 fixed/free | 改成预置齿轮位 + 可选默认 binding，或废弃这些内置固定轴含义 |

更具体的代码落点：

- `CityChannelPhaserEditor.updateSelectedGearAxis` 和 `updatePromptGearAxis` 应被替换为 `updateGearAxisBinding`；
- `CityChannelMechanismPanel` 的 select 应改成绑定状态和操作说明；
- `cityChannelEditorInteraction.js` 新建齿轮时默认写 `axisBinding: null`；
- `cityChannelGears.js` 的 `getGearInstallTarget` 应返回 `socketKind`、`pivotWorld`、`bindingCandidates`、`validityReason`；
- `cityChannelMechanismPlayback.js` 的 `fixedNodes` 过滤应改成 `nodes.filter(node => node.mount?.axisBinding)`；
- `cityChannelMechanismSimulation.js` 的 fixed 命名函数可以先保留 wrapper，内部走 axis binding 公式；
- `CityChannelTextureCache` 中依赖 `axisType` 的颜色应改为绑定状态或统一样式。

## 12. 分阶段实现计划

### 阶段 1：几何修正和纯函数

- 把角点坐标改成 `±0.5`；
- 统一齿轮半径；
- 新增 `isCornerGearSocket`；
- 新增 `getGearSocketWorldPosition`；
- 新增 `getCornerGearBindingCandidates`；
- 新增 `validateGearPlacement`；
- 补纯函数测试。

建议先只覆盖水平 tile，不碰 wall/vertical。已有 wall 逻辑应保留旧行为，后续垂直啮合单独设计。

### 阶段 2：安装和移动合法性

- `getGearInstallTarget` 支持中心齿轮和顶角齿轮区分；
- 顶角齿轮必须至少有一个候选板材；
- 同点同面顶角齿轮冲突；
- `commitGearCarry` 复用同一合法性函数；
- 移动/复制板材时检查携带齿轮是否合法。

### 阶段 3：绑定交互

- 新增候选虚线绘制；
- 新增候选虚线 hitTest；
- 点击候选写入/清空 `axisBinding`；
- 被绑定板材高亮；
- 面板文案改成连轴板材状态。

### 阶段 4：运行态迁移

- `playAssemblyGearRotation` 改为按 `axisBinding` 生成 runtime entry；
- 无 binding 只更新 gear phase；
- 有 binding 旋转绑定板材或绑定 assembly；
- 支持无传动骨骼单板旋转；
- 保留旧 fixedAxis 测试的兼容迁移，新增新模型测试。

这一阶段必须维持验收点：被传动的顶角齿轮世界位置不动；板材只绕该 pivot 旋转；如果转动空间不足则提示，而不是平移。

### 阶段 5：清理旧命名

- 删除 fixed/free 交互入口；
- 删除旧 `axisType` 写入；
- 更新测试命名；
- 更新文档和 UI 文案。

## 13. 测试计划

### 13.1 几何测试

- `corner_ne` 等于 `{ x: 0.5, y: -0.5 }`；
- 顶角齿轮 world position 等于共享顶角；
- 中心齿轮和顶角齿轮统一半径；
- 顶角齿轮与相邻中心齿轮距离满足啮合阈值。

### 13.2 安装合法性测试

- 四周没有任何板材的顶角不能安装齿轮；
- 一个板材角点可安装顶角齿轮；
- 四块共面板共享顶角只能安装一个顶角齿轮；
- 同一板中心齿轮和顶角齿轮不冲突；
- 移动齿轮到冲突顶角失败；
- 移动齿轮到合法顶角成功。

### 13.3 绑定交互测试

- 选中顶角齿轮显示候选虚线；
- 点击候选写入 `axisBinding`；
- 点击已绑定候选清空 `axisBinding`；
- 点击其他候选切换 binding；
- 不共面板材不显示候选。

### 13.4 运行态测试

- 无 binding 齿轮被传动时只更新 phase，不更新 placements；
- 有 binding 且绑定普通板时，单板绕 pivot 旋转；
- 有 binding 且绑定传动 assembly 时，assembly 绕 pivot 旋转；
- 齿轮 pivotWorld 运行前后不变；
- 外啮合方向仍相反；
- 齿数相同情况下 ratio 为 `-1`。

### 13.5 旧语义迁移测试

- 旧 `axisType: freeAxis` 读入后等价于 `axisBinding: null`；
- 旧 `axisType: fixedAxis` 如果在合法顶角且能推断宿主板，可以迁移出 `axisBinding`；
- 新增齿轮不再写 `axisType`；
- 面板不再显示“活动轴/固定轴”切换；
- 传动骨骼 assembly 不因齿轮啮合而合并。

## 14. 仍需确认的问题

- 顶角齿轮默认是否应该绑定某个候选板材，还是严格默认不绑定。根据最新图，建议默认不绑定。
- 旧 actuator 板是否保留为预置组合，还是改成普通板 + 用户手动安装齿轮。
- 中心齿轮是否允许绑定板材。当前理解：中心齿轮安装在板材表面，只作为普通齿轮，不走顶角候选绑定。
- 顶角齿轮与中心齿轮的啮合距离是否完全由统一半径决定，还是允许轻微容差。
- 暂时不做垂直齿轮啮合；后续需要单独设计 surface normal 和相交轴传动方向。
- 多个顶角齿轮同时绑定同一个传动骨骼 assembly 时，是否允许多 pivot 驱动同一 assembly。建议先判冲突并阻止，避免刚体约束过定。
- 绑定板材被删除或移动到不再共享 pivot 后，应该自动清空 binding 还是阻止删除/移动。建议移动时阻止非法状态，删除时清空并提示。

## 15. 推荐结论

推荐采用“固定轴心 + 可选连轴板材绑定”的模型彻底替代“活动轴 / 固定轴”。

最重要的边界是：

- 齿轮永远不连接板材；
- `axisBinding` 才连接板材；
- 传动骨骼连接板材整体；
- 顶角齿轮放在真实顶角；
- 中心齿轮放在板面中心；
- 齿轮统一大小；
- 空间不足时停止板材旋转并提示，不能平移齿轮或板材来伪装运动。
- 默认不绑定；
- 用户通过候选虚线显式选择联动板材。
