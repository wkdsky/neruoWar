# 城内工坊新板材与传动机关系统改造方案

> 设计校准：本方案以两张设计图为准。普通板材、传动板材、齿轮压力板和承动结构都不是互相割裂的旧物件分类，而是“统一建筑石材板体 + 可选背面黄色传动骨骼 + 可选齿轮安装位/轴类型 + 可选力源参数”的组合系统。端点型传动板材也属于传动板材基础形态；齿轮压力板背面采用十字传动骨骼，黑色小齿轮只是类型标记，不等同于真实传动齿轮；承动预设只是带齿轮安装位的组合板材。

## 1. 当前系统可复用能力

当前 `城内工坊 -> 编辑模板` 已经具备可复用的编辑器骨架：

- `CityWorkshopPage` 和 `CityChannelTemplateGallery` 已提供模板选择与编辑器打开流程。
- `CityChannelPhaserEditor` 负责 React 状态、Phaser 场景生命周期、保存、观察、参数面板和 toast。
- `useCityChannelEditorState` 已提供放置、批量绘制、选择、移动、旋转、翻转、删除、撤销、重做和本地保存。
- `CityChannelPhaserScene` 已提供 2.5D 等距投影、命中检测、拖拽绘制、框选、搬运、观察、运行预览入口。
- `CityChannelTextureCache` 已有动态纹理生成，适合改成浅暖灰石材板体、较深石材厚度、黄色传动骨骼、黑色齿轮。
- `cityChannelSchema` 已有 normalize/serialize，可以承载新字段并兼容旧草稿。
- `cityChannelMechanismRuntime` 当前虽简单，但适合作为新机械整体图、齿轮参数、运行预览规则的集中模块。

本次改造保留这些能力，不重写编辑器框架。

## 2. 旧板材库需要废弃的内容

旧板材库中面向旧设定的可见内容需要从 UI 移除：

- `wood_floor`、`stone_floor`、`iron_floor`、`glass_floor`
- `wall`、`glass_wall` 作为用户可见板材项
- `pressure_plate`、`directional_pressure_plate`
- `vertical_push_button`、`horizontal_push_button`、`rotary_button`
- `external_gear_plate`、`internal_gear_plate`、`peg_gear_plate`
- `trapdoor_plate`、`side_pusher_plate`、`spring_plate`

这些 ID 可以作为兼容入口保留在 normalize 映射中，但不再出现在 `CityChannelMaterialPalette`。旧草稿加载时统一映射为新体系中的普通板材、齿轮压力板或承动板材，避免页面崩溃。

## 3. 新板材体系总览

新板材库只展示以下分组：

1. 基础板材
   - 普通板材
2. 传动板材
   - 直线型传动板材
   - 十字型传动板材
   - T 型传动板材
   - L 型传动板材
3. 力源板材
   - 齿轮压力板
4. 承动组合板材 / 齿轮承动预设
   - 中心齿轮承动板
   - 单角齿轮承动板
   - 同侧角齿轮承动板
   - 对侧角齿轮承动板
   - 三角齿轮承动板
   - 四角齿轮承动板

入口/出口作为模板必要结构继续保留在 schema 和模板里，但不作为新板材库主内容暴露。普通板材保持统一浅暖灰石材外观；传动板材在背面/地图辅助层显示黄色传动骨骼和白色端点；承动板材显示黑色真实齿轮，固定轴和活动轴通过轴心颜色区分。

## 4. 数据模型设计

在 `cityChannelSchema.js` 中新增/规范以下字段：

```js
{
  boardSystemVersion: 2,
  mechanismSchemaVersion: 2,
  tiles: {
    "z:x:y": {
      panelType: "basic_plate",
      boardRole: "basic|transmission|power_source|actuator",
      transmissionSkeleton: {
        type: "straight|cross|t|l",
        ports: [
          {
            id: "north",
            direction: "north",
            localPosition: { x: 0, y: -0.5, z: 0 },
            worldDirection: "north"
          }
        ]
      },
      gearMounts: [
        {
          id: "gear_center",
          position: "center",
          axisType: "fixedAxis|freeAxis",
          followMode: "sameDirection|oppositeDirection|none",
          followDelaySeconds: 0
        }
      ],
      gearConfigs: {},
      triggerConfig: {},
      motionConfig: {}
    }
  },
  mechanismParams: {
    "z:x:y": {
      rotationAngle: 90,
      rotationDirection: "right",
      rotationSpeedDegPerSec: 20,
      triggerDelaySeconds: 0,
      autoReturn: false,
      autoReturnDelaySeconds: 0
    }
  }
}
```

`MechanicalAssembly` 不作为主持久化数据，推荐运行时通过 `buildMechanicalAssemblies(mapData)` 重建。保存时保留基础板材、传动骨骼、齿轮安装位和参数，避免持久化过期图。

## 5. 传动骨骼与机械整体规则

新增核心概念：

- `TransmissionSkeleton`
- `TransmissionPort`
- `MechanicalAssembly`
- `MechanicalAssemblyGraph`
- `buildMechanicalAssemblies(mapData)`

构建规则：

1. 扫描所有带 `transmissionSkeleton` 或 `gearMounts` 的 tile。
2. 根据 tile 的 `rotation` 和 `flipped` 计算端口 `worldDirection` 与邻接目标。
3. 只有端口方向相对、目标格存在可传动端口、位置对齐时才连边。
4. 对传动 graph 求 connected components。
5. 每个 connected component 是一个 `MechanicalAssembly`。

普通相邻、视觉接触、边缘接触都不算整体连接。普通板材没有传动骨骼，不参与机械整体传播。

## 6. 齿轮、固定轴与活动轴规则

齿轮分两类：

- 小齿轮标记：用于齿轮压力板的类型提示，不一定参与传动。
- 真实齿轮：存在于 `gearMounts`，有轴类型、转动状态和驱动语义。

`freeAxis` / `activeAxis`：齿轮自己转，板材和整体不转，主要用于传递旋转。实现中统一保存为 `freeAxis`。

`fixedAxis`：齿轮自己转，并驱动所在 tile 所属的 `MechanicalAssembly` 作为运动单位整体旋转。运行预览以固定轴所在位置为旋转中心，视觉上旋转整个 connected component。

## 7. 齿轮压力板设计

齿轮压力板是力源板材。它可平放或竖放，正面触发，背面显示传动结构和小齿轮标记。

参数结构：

```js
{
  rotationAngle: 90,
  rotationDirection: "left|right",
  rotationSpeedDegPerSec: 20,
  triggerDelaySeconds: 0,
  autoReturn: false,
  autoReturnDelaySeconds: 0
}
```

触发逻辑最低实现：

1. 参数面板可编辑并保存。
2. 点击运行后按 `triggerDelaySeconds` 延迟。
3. 查找自身相邻/连接 graph 中最近的 fixedAxis 承动板材。
4. 找到 fixedAxis 所在 `MechanicalAssembly`。
5. 整体围绕 fixedAxis 视觉旋转。
6. `autoReturn` 为 true 时，等待 `autoReturnDelaySeconds` 后复位。

## 8. 承动板材组合设计

承动板材不是单一类型，而是组合板：

- 浅暖灰建筑石材基础板体
- 可选传动骨骼
- 一个或多个真实齿轮安装位
- 每个齿轮独立轴类型和跟随规则

预设通过 catalog 生成统一 `gearMounts`：

- 中心齿轮承动板：`center`
- 单角齿轮承动板：`corner_ne`
- 同侧角齿轮承动板：`corner_nw + corner_sw`
- 对侧角齿轮承动板：`corner_nw + corner_se`
- 三角齿轮承动板：三个角
- 四角齿轮承动板：四个角

每个齿轮支持：

- `axisType`: `fixedAxis` / `freeAxis`
- `followMode`: `sameDirection` / `oppositeDirection` / `none`
- `followDelaySeconds`

## 9. 2.5D 地图渲染设计

继续使用 Phaser。修改 `CityChannelTextureCache`：

- 所有新板材统一浅暖灰石材 top，并带细颗粒/分层纹理。
- 侧边统一较深石材厚度。
- `transmissionSkeleton` 使用黄色线条绘制。
- 端点使用白色圆环/亮点。
- `gearMounts` 使用黑色齿轮，固定轴用青色轴心，活动轴用白色轴心。
- 齿轮压力板使用小齿轮标记和背面传动纹理。

修改 `CityChannelPhaserScene`：

- 运行预览时用 transient container transform 表现 `MechanicalAssembly` 整体旋转。
- 辅助层绘制机械整体 id、连接端点状态和 warning。
- 不改变静态 `mapData` 的坐标和旋转。

## 10. 观察面板与背面结构展示设计

复用 `CityChannelPressurePlateInspect3D.js`，改造成通用板材观察面板：

- 支持普通板材、传动板材、齿轮压力板、承动板材。
- 用 Three.js 显示浅暖灰石材板体、较深厚度、黄色骨骼、黑色齿轮。
- 支持正面/背面观察提示，默认偏背面展示机制。
- 运行预览时根据 `previewState` 同步齿轮/骨骼/整体运动。

若完整同步所有 assembly 复杂，先同步当前观察 tile 的齿轮角度，并保留整体运动扩展点。

## 11. 参数面板设计

`CityChannelPhaserEditor` 的参数面板改为按 tile 类型显示：

- 传动板材：骨骼类型、端点列表、所属整体、显示骨骼/端点。
- 齿轮压力板：转动角度、方向、速度、延迟、自动转回、自动转回延迟。
- 承动板材：齿轮位置、轴类型、跟随模式、跟随延迟、所属整体。

参数保存到 `mechanismParams[cellKey]` 或 tile 内的 `gearMounts`。短期实现优先保存齿轮压力板运动参数和承动板材默认 gearMounts，后续可扩展为逐齿轮编辑。

## 12. 动态运行预览设计

扩展 `triggerMechanismAtCell` / `playMechanismAction`：

1. 如果是齿轮压力板，读取参数。
2. 调用 `buildMechanicalAssemblies(mapData)`。
3. 找到可驱动 fixedAxis。
4. 计算 assembly 成员和轴心屏幕坐标。
5. 对成员 display object 做临时 container-like transform 或逐对象旋转。
6. 按速度计算动画时长：`rotationAngle / rotationSpeedDegPerSec`。
7. 按方向决定正负角度。
8. 自动转回时 yoyo 或补充反向 tween。

运行态保存在 `mechanismRuntimeState` 或 scene 内部 transient map，不写回 `mapData`。

## 13. 拼接合法性校验设计

新增 `validateMechanicalAssemblies(mapData)`：

- 端口相对才连接。
- 普通板材不传动。
- 相邻但无端口连接不归入同一整体。
- fixedAxis 只能驱动所在整体。
- 无 fixedAxis 或力源无法连接时给 warning。
- warning 非阻塞，不影响保存。

UI 上先通过 hover/status/toast 和参数面板显示所属整体与 warning。

## 14. 保存格式与兼容处理

保存格式新增：

- `mechanismSchemaVersion: 2`
- `boardSystemVersion: 2`
- `transmissionSkeleton`
- `gearMounts`
- `gearConfigs`
- `triggerConfig`
- `motionConfig`

兼容策略：

- 旧地板/墙/玻璃板 normalize 为 `basic_plate`。
- 旧压力/按钮 normalize 为 `gear_pressure_plate` 或 `basic_plate`。
- 旧齿轮/执行端 normalize 为对应承动预设。
- 旧模板不崩溃；旧内容不再从新板材库展示。

## 15. 具体文件修改计划

- `docs/city_workshop_mechanism_refactor_plan.md`：记录本方案与实施阶段。
- `cityChannelCatalog.js`：整体替换可见板材库，新增新板材 catalog、默认骨骼、齿轮安装位、兼容映射。
- `cityChannelSchema.js`：新增 tile types、版本字段、normalize 新字段、旧 panelType 兼容映射、createTile 默认新字段。
- `CityChannelMaterialPalette.js`：分组展示新体系，隐藏旧设定文案和旧分类。
- `cityChannelMechanismRuntime.js`：新增 `buildMechanicalAssemblies`、端口旋转/翻转、参数 normalize、fixedAxis 查找、warning。
- `CityChannelTextureCache.js`：绘制蓝/灰板、黄色骨骼、端点、黑齿轮、轴心差异。
- `CityChannelPhaserScene.js`：接入 assembly graph，运行预览整体旋转，显示端点/连接辅助，更新触发/参数 panel 请求。
- `CityChannelPressurePlateInspect3D.js`：通用板材观察，展示新骨骼与齿轮。
- `CityChannelPhaserEditor.js`：参数面板改造、机械整体信息、运行按钮、保存新参数。
- `useCityChannelEditorState.js`：确保移动/删除/旋转/翻转后新字段保留，旧默认板材改为新普通板材。
- `cityChannelTemplates.js`：模板创建改用新普通板材，示例模板可放入传动/承动组件。
- CSS：补充参数面板和观察面板样式。

## 16. 分阶段实施清单

1. 新增方案文档。
2. 替换 catalog 和 schema：新 tile types、新字段、兼容 normalize。
3. 新增 mechanical runtime graph：端口转换、assembly 构建、warning、fixedAxis 选择。
4. 改造板材库 UI：只展示新体系。
5. 改造 Phaser 纹理：新视觉规范。
6. 改造参数面板：齿轮压力板参数、所属整体、承动齿轮信息。
7. 改造运行预览：fixedAxis 驱动 MechanicalAssembly 整体旋转。
8. 改造观察面板：通用板材观察。
9. 更新模板默认数据和兼容保存。
10. 执行 `npm run build` 并修复构建问题。

## 17. 回归测试清单

- 板材库只显示新体系分组。
- 普通板材可放置、选择、旋转、翻转、移动、删除、保存、加载。
- 四种传动板材可放置，旋转/翻转后黄色骨骼方向变化。
- 传动端点相接时属于同一 `MechanicalAssembly`。
- 相邻但端点不相接时不是同一 `MechanicalAssembly`。
- 齿轮压力板参数可编辑、保存、恢复。
- 承动预设显示黑色齿轮，固定轴/活动轴可区分。
- 运行预览能驱动 fixedAxis 所属整体一起旋转。
- 不属于该整体的相邻板材不旋转。
- 自动转回、延迟、速度、方向影响动画。
- 旧草稿/旧模板加载不崩溃，并 normalize 为新体系。
- `npm run build` 通过，或失败原因明确不是本次改动导致。
