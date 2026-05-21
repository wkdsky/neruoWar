# 城内工坊齿轮组件化重构方案

> 范围：城内工坊 -> 编辑模板。目标是废弃“齿轮承动预设板材”，改为“板材层 + 组件层 + 齿轮约束网络”的编辑和运行模型，为后续更真实的齿轮物理/状态传播打底。

## 1. 外部参考与设计结论

- Box2D 的 GearJoint 不是把齿轮做成一种地块，而是把两个已有 revolute/prismatic joint 通过 ratio 约束绑定起来；因此我们的齿轮也应先成为安装在轴点上的组件，再由传动网络推导运动。
  - 参考：https://box2d.org/doc_version_2_4/structb2_gear_joint_def.html
  - 参考：https://box2d.org/documentation/md_simulation.html
- Box2D 支持一个 body 挂多个 shape 形成 compound body。对应到本编辑器，板材是 host body，齿轮是附着组件；板材移动/旋转时，齿轮应作为附着组件跟随。
  - 参考：https://box2d.org/documentation/md_simulation.html#autotoc_md-shapes
- Tiled 将 Tile Layer 和 Object Layer 分开：tile 存网格材料，object 存可单独选择、移动和带属性的对象。城内工坊也应把“板材库”和“组件库”拆开。
  - 参考：https://doc.mapeditor.org/en/stable/manual/layers/
- Phaser 支持自定义 hit area / callback，适合把板材命中、齿轮命中、socket ghost 命中分开，而不是继续把所有东西塞进 tile hit。
  - 参考：https://photonstorm.github.io/phaser3-docs/Phaser.GameObjects.GameObject.html#setInteractive__anchor
- 齿轮传动规则上，相邻外齿轮反向；惰轮不改变总传动比，只改变方向；同轴齿轮同向。后续运行时应按 gear graph/constraint graph 解算。
  - 参考：https://docs.revrobotics.com/duo-build/motion/gears/gears-advanced

## 2. 核心原则

1. 板材和齿轮不再是同一类对象。
2. “齿轮承动预设”从板材库移除。
3. 板材库只负责放置/编辑板材；组件库只负责安装/编辑组件。
4. 齿轮是安装在板材上的组件，不能独立悬浮存在。
5. 齿轮跟随宿主板材移动、旋转、删除。
6. 大地图选择上下文互斥：先选板材则本轮只选板材；先选齿轮则本轮只选齿轮。
7. 齿轮安装位置由 socket validator 决定，不由板材类型决定。
8. 后续真实运行时以 gear graph/constraint graph 为准，不以视觉预设板材为准。

## 3. 目标 UI

### 3.1 左侧库

左侧库改成两个选项卡：

- 板材库
  - 普通板材
  - 直线型传动板材
  - 十字型传动板材
  - T 型传动板材
  - L 型传动板材
  - 端点型传动板材
  - 齿轮压力板
- 组件库
  - 齿轮

移除可见类别：

- 齿轮承动预设
- 中心齿轮承动板
- 单角齿轮承动板
- 同侧角齿轮承动板
- 对侧角齿轮承动板
- 三角齿轮承动板
- 四角齿轮承动板

兼容层可以继续识别旧 ID，但旧 ID 不再出现在新建模板的板材库中。

### 3.2 齿轮组件 ghost

选择组件库 -> 齿轮后，进入齿轮安装模式：

- 鼠标悬停到板材可安装面时，显示齿轮 ghost。
- ghost 吸附到最近合法 socket。
- 不合法 socket 显示红色 ghost 或不显示吸附确认。
- 鼠标不在板材可安装面时不显示 ghost。

## 4. 数据模型

长期目标推荐拆出独立组件层：

```js
{
  tiles: {
    "z:x:y": {
      panelType: "basic_plate",
      rotation: 0,
      flipped: false,
      transmissionSkeleton: {}
    }
  },
  components: {
    "cmp_...": {
      type: "gear",
      hostKey: "z:x:y",
      surface: "front|back",
      socket: "center|corner_ne|corner_nw|corner_se|corner_sw",
      axisType: "freeAxis|fixedAxis",
      radius: 1,
      teeth: 12,
      phase: 0
    }
  }
}
```

当前仓库已有 `gearMounts` 贯穿 schema、渲染、观察和 mechanical runtime。为了降低一次性重构风险，第一阶段使用兼容存储：

```js
tile.gearMounts = [
  {
    id: "gear_...",
    componentType: "gear",
    position: "center|corner_ne|corner_nw|corner_se|corner_sw",
    surface: "front|back",
    axisType: "freeAxis|fixedAxis",
    radius: 1,
    teeth: 12,
    phase: 0
  }
]
```

第二阶段再迁移到 `mapData.components`，并让 `gearMounts` 成为 normalize 时的兼容派生字段。

## 5. 齿轮 socket 规则

每块板材每一面有 5 个 socket：

- `center`
- `corner_ne`
- `corner_nw`
- `corner_se`
- `corner_sw`

每个 socket 可以安装一个齿轮。齿轮可安装在正面或背面，`surface` 由鼠标命中的面决定。

### 5.1 竖直遮挡限制

如果板材某一边有竖直遮挡物，则靠近该边的两个角不能安装齿轮：

- north 遮挡：禁用 `corner_ne`、`corner_nw`
- east 遮挡：禁用 `corner_ne`、`corner_se`
- south 遮挡：禁用 `corner_se`、`corner_sw`
- west 遮挡：禁用 `corner_nw`、`corner_sw`

遮挡来源：

- 当前格边缘已有 wall。
- 相邻格对应反向边已有 wall。
- 后续可扩展为竖直板材、门框、凸起组件。

### 5.2 齿轮反向约束墙

如果板材某一边已经有齿轮占用了靠该边的角，则该边不能再安装竖直板材。大地图 ghost 应显示红色，提交时应拒绝。

### 5.3 齿轮尺寸

五个 socket 的齿轮大小一致。当前阶段使用统一视觉半径；后续 physical graph 中齿轮 ratio 默认 1:1。齿轮中心与相邻 socket 的间距视作标准啮合距离。

## 6. 选择模式

### 6.1 板材选择上下文

第一次点击板材后进入 board selection context：

- 只能选板材/墙。
- 齿轮不可选。
- 框选、多选只收集板材/墙。
- 板材移动时携带其 `gearMounts`。

### 6.2 齿轮选择上下文

第一次点击齿轮后进入 component selection context：

- 只能选齿轮。
- 板材变灰色不透明。
- 齿轮变亮色。
- 框选、多选只收集齿轮。
- 齿轮面板只展示轴类型：活动轴/固定轴。
- “齿轮跟随与否”暂不展示。

### 6.3 退出上下文

- Esc 清空选择和上下文。
- 点击空白清空选择和上下文。
- 切换板材库/组件库清空当前选择和上下文。

## 7. 观察模式

双击任意板材都可以放大观察，不再只限压力板。

观察模型必须读取：

- 板材材质/厚度。
- 板材正面/背面。
- 传动骨骼。
- 当前板材安装的齿轮。
- 齿轮 socket 和轴类型。

第一阶段复用现有 Three.js 观察器，将 `gearMounts` 作为模型输入。第二阶段再改名为通用 `CityChannelBoardInspect3D`。

## 8. 后续物理运行时

运行时不要直接依赖 UI 预设，应构建机械图：

```js
GearNode {
  id,
  hostKey,
  socket,
  surface,
  axisType,
  radius,
  teeth,
  angularVelocity,
  angle
}

GearEdge {
  type: "mesh|same_axis|transmission_skeleton",
  from,
  to,
  ratio,
  directionSign
}
```

求解规则：

- 同一 host 的相邻 socket 齿轮可形成 `mesh` 边。
- 外齿轮啮合 `directionSign = -1`。
- 同轴/固定连接 `directionSign = 1`。
- 当前全部齿轮同半径同齿数，`ratio = 1`。
- 如果未来允许不同齿数，`ratio = teethA / teethB`。
- 如果图中出现互相矛盾的约束，运行前报错，不执行。

## 9. 实施阶段

### 阶段 1：库与安装路径

- 新增左侧 tab：板材库 / 组件库。
- 从板材库移除齿轮承动预设类别。
- 组件库新增齿轮。
- 新增 `PLACE_COMPONENT` 工具状态。
- 齿轮 ghost 吸附到板材 socket。
- 点击合法 socket 写入 `tile.gearMounts`。

### 阶段 2：遮挡与墙约束

- socket validator 支持四边竖直遮挡。
- 靠遮挡边的两个角不可安装。
- 已有齿轮占边时，竖直墙 ghost 报红并拒绝提交。

### 阶段 3：选择上下文

- 增加 `selectionScope: board|component|null`。
- 齿轮命中独立于板材命中。
- 齿轮选择时板材灰色不透明、齿轮高亮。
- 框选/多选按上下文过滤。

### 阶段 4：齿轮配置面板

- 选择齿轮后只展示轴类型。
- 每个齿轮可独立设为活动轴或固定轴。
- 移除跟随方式配置。

### 阶段 5：通用观察模型

- 双击任意板材进入观察。
- 观察器显示该板材的齿轮安装状态。
- 齿轮正/背面安装效果可见。

### 阶段 6：机械图运行时

- 从 `gearMounts/components` 构建 GearGraph。
- 齿轮压力板触发时把输入角速度传播到 GearGraph。
- 根据 fixedAxis 约束驱动板材整体或活动轴自转。

## 10. 回归检查

- 板材库不再出现“齿轮承动预设”。
- 组件库只出现“齿轮”。
- 选择齿轮后能看到 ghost。
- 齿轮只能吸附到板材五个 socket。
- 有 north 墙时，北侧两个角不可吸附。
- 有 east 墙时，东侧两个角不可吸附。
- 中心 socket 不受边缘墙影响。
- 已有齿轮占边时，该边不能放墙。
- 板材移动/删除时齿轮跟随/删除。
- 双击普通板材也能观察。
- 观察模型能显示已安装齿轮。
- `npm run build` 通过。
