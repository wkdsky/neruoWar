# 训练营战争地图完整实现计划

## 1. 任务目标

**将训练营模块当前的空白战争场景，完整替换为：**

- 参考图片：`battlefield-map-reference.png`
- 原始设计文件：`战场图.pdf`
- 建议地图 ID：`training-war-map-v1`

最终目标不是制作一张静态三维背景，而是实现一套可以承载部队出生、移动、寻路、战斗、技能位移、防御塔交互、中立单位生成、训练营部署和未来在线对战的完整战场地图。

**需要特别注意：**

- 当前系统已经存在成熟的部队数据表。
- 部队技能、部队位移、攻击、受击和部分战斗交互已经初步实现。
- 用户调整部队出生位置的逻辑已经存在。
- 本任务重点是补齐战场地图、地图规则、地图寻路、地图目标和地图运行时接入。
- 不要重复实现已有的部队技能系统、部队数据表或出生位置编辑界面。
- 如果现有系统中的接口不够使用，应增加适配层，而不是直接复制一套平行系统。
- 地图中尚未明确的数值、AI 参数和资源细节，由 Codex 检查现有项目后补齐，并通过配置化方式实现。

### 1.1 导航规则覆写（2026-08-16）

用户已明确本地图的移动规则，以下条款优先于本文其余任何“道路优先”或“沿路线中心线推进”的表述：

- 道路只提供视觉、路线归属和地图目标语义，不是部队移动约束，也不降低寻路代价来诱导绕路。
- 草地、沙地、道路和高地等场内地表都是正常可行走地形；中央沙地不得由运行时开关改为阻挡带，地形上的 `walkable: false` 仅保留为标注元数据，不能形成无形障碍。只有地图边界和具有 `blocksMovement` 碰撞体的建筑物会阻挡移动。
- 用户右键移动和 AI 目标移动共用直线优先策略：两点间线段位于地图内且没有建筑碰撞时，路径只能包含目标点；线段穿过建筑物时，才使用最短可行的折线绕行。
- AI 不得为了贴合道路或 `centerline` 人为排队；它应直接朝当前敌方单位、地图目标或后备目标移动，并在目标或阻挡条件变化时重新查询。
- AI 对被建筑完全隔离的目标按地图 `navigationRules` 的失败上限和退避时间有限重试；退避期间跳过该目标并继续朝其他合法目标或对侧后备点移动，不把任意地表标记当作额外障碍。
- 该导航语义及 Phase 8 中立营地合同将 `training-war-map-v1` 的正式 `mapVersion` 提升至 `4`，以淘汰版本 `3` 的旧地形/营地缓存。

---

## 2. 参考图片的地图结构

### 2.1 图片中的整体布局

**参考图是一张左右对称的战争地图：**

- 左侧为进攻方区域。
- 右侧为防守方区域。
- 左右两侧都有上下两个高地。
- 中间有一条贯穿上下方向的黄色沙地区域。
- 地图中存在三条横向道路。
- 左方部队沿道路向右侧推进。
- 右方部队沿道路向左侧推进。
- 两侧绿色区域是草地和野区。
- 黄色区域代表沙地。
- 灰色线条代表道路。
- 黑色尖刺状墙体代表高墙。
- 黑色弧线、半圆和封闭形墙体代表普通墙。
- 红色八边形代表进攻方防御塔。
- 青色八边形代表防守方防御塔。
- 蓝色 `X` 代表中立士兵或中立怪物。
- 左右外侧上下位置的三角形高地标记代表双方高地出生区域。

参考图中的图例是地图实现的语义来源，不能只作为视觉参考。

### 2.2 图例语义

**必须建立以下地图元素类型：**

| 图例 | 地图元素 | 运行时含义 |
|---|---|---|
| 红色八边形 | 进攻方防御塔 | 进攻方建筑、攻击目标、地图推进阻挡 |
| 青色八边形 | 防守方防御塔 | 防守方建筑、攻击目标、地图推进阻挡 |
| 蓝色 X | 中立士兵/怪物 | 中立营地、野怪或地图中立战斗单位 |
| 黄色区域 | 沙地 | 可配置的地形区域，影响视觉和移动规则 |
| 绿色区域 | 草地 | 基础可行走区域和野区地表 |
| 红色箭头路线 | 进攻方进攻路线 | 进攻方兵线和部队默认推进方向 |
| 青色箭头路线 | 防守方进攻路线 | 防守方兵线和部队默认推进方向 |
| 灰色线 | 道路 | 部队优先行进区域和兵线通道 |
| 黑色尖刺墙 | 高墙 | 强阻挡、视线阻挡、投射物阻挡或高地边界 |
| 黑色弧线/半圆/封闭墙体 | 普通墙 | 普通移动阻挡，具体视线和投射物规则配置化 |
| 左侧高地三角区域 | 进攻方高地 | 进攻方部队出生区域 |
| 右侧高地三角区域 | 防守方高地 | 防守方部队出生区域 |

图片中黑色墙体的具体形状应作为地图几何数据录入，不能只用几个矩形碰撞体粗略代替。

---

## 3. 地图的核心空间结构

### 3.1 地图坐标系统

**建立统一坐标转换：**

**参考图片坐标：**

- 原点：图片左上角
- x：从左向右
- y：从上向下

**Three.js 世界坐标：**

- x：地图横向
- y：地形高度
- z：地图纵向

**逻辑地图坐标：**

- 使用二维平面坐标表达移动和寻路
- 使用 height/elevation 表达地形高度

**建议使用归一化坐标作为地图配置的基础：**

```ts
type NormalizedPoint = {
  x: number; // 0 - 1
  y: number; // 0 - 1
};
```

不要把图片像素坐标散落在渲染代码中。

**参考图片尺寸约为：**

- 宽度：1568
- 高度：1090
- 顶部图例区域不是实际战场区域。地图几何提取时需要排除图例，只将下方实际战场区域作为地图内容。

**参考图中实际战场大致位于：**

- x: 44 - 1524
- y: 59 - 1090
- 这些数值只能作为初始标注参考，最终应由 Codex 根据图片实际边界、现有地图尺寸和 Three.js 场景比例生成正式坐标。

### 3.1.1 地图尺度与行军时间标定

地图世界尺寸不能只按屏幕可见范围决定，还必须用部队在地图上的实际行军时间校准。训练地图当前采用 `7200 × 5008` 的正式世界，保持参考图有效战场的宽高比，并相对 `3600 × 2504` 统一放大 `2×`。

以进攻方上方和下方高地的镜像参考部署槽 `deploy-spawn-attacker-top-1`、`deploy-spawn-attacker-bottom-3` 到左中路外塔 `tower-attacker-mid-outer` 作为基准，标定距离随地图扩大为原来的 `2×`；地图合同将标定乘数同步为 `5 × 36 = 180 world/s`，因此预计到达时间仍约为 `8s`。这只是正常行军基准；防御型慢速部队、拥堵、绕障和技能加速应保留自然差异，不能用统一瞬移或强行缩放速度掩盖地图尺度问题。

该标定写入地图合同，并将 `training-war-map-v1` 地图版本提升为 `5` 以淘汰旧尺度缓存；由后端地图校验和前端运行时步进测试保护。任何后续地图尺寸、路线出口或单位速度改动都必须重新计算、递增版本并记录。

### 3.2 三条主要路线

**地图中存在三条横向路线：**

- 上路
- 中路
- 下路
- 三条路线都从左侧延伸到右侧，并且在中央沙地区发生连接或穿越。

路线必须在逻辑层中保持连续，即使视觉上道路颜色被中央沙地打断，也不能因为道路材质变化而把路线拆成互不连接的两条路径。

**每条路线至少需要包含：**

```ts
interface MapRoute {
  id: string;
  type: "top" | "middle" | "bottom";
  attackerDirection: "left-to-right";
  defenderDirection: "right-to-left";
  centerLine: NormalizedPoint[];
  width: number;
  entryPoints: RouteEntryPoint[];
  exitPoints: RouteEntryPoint[];
  connectedRegions: string[];
  preferredFor: string[];
}
```

**路线逻辑需要区分：**

- 视觉道路中心线。
- 部队实际寻路中心线。
- 路线可行走宽度。
- 路线与野区的连接入口。
- 路线与中央沙地的连接关系。
- 路线与高地出生区域的连接关系。
- 受到墙体阻挡时的替代路径。

### 3.3 中央纵向沙地区

参考图中间存在一条从上到下贯穿地图的黄色区域。

中央沙地区是地图中的重要中立争夺空间，不应当仅作为一条黄色装饰带。

**需要根据现有游戏规则判断和配置以下属性：**

- 是否完全可行走。
- 三条道路是否能够穿过中央沙地。
- 中立单位是否可以在其中生成。
- 沙地是否影响移动速度。
- 沙地是否影响视野或技能。
- 沙地区域是否作为双方路线的交战区域。
- 沙地是否存在上下入口。
- 沙地边界是否有不可通行区域。
- 技能位移是否允许进入或穿过沙地。

**建议默认语义：**

- 中央沙地区可行走。
- 三条主要路线在逻辑上贯通中央沙地区。
- 道路经过中央沙地时，仅改变地表材质和区域标签。
- 除非图片或产品需求明确表示存在阻挡，否则不能把中央黄色区域当成整条地图分割墙。
- 本任务已明确中央沙地与其他沙地均可行走；若未来需要新增移动障碍，必须定义带 `blocksMovement` 碰撞体的建筑对象，不能复用沙地颜色、路线区域或 `walkable: false` 地形标注。

### 3.4 双方高地

**参考图中四个外侧三角区域代表高地：**

- 左上：进攻方高地出生区
- 左下：进攻方高地出生区
- 右上：防守方高地出生区
- 右下：防守方高地出生区
- 高地是部队出生点，不要将其简单理解为传统 MOBA 中唯一的基地泉水。

**需要建立四个独立的出生区域：**

```ts
interface HighlandSpawnRegion {
  id: string;
  faction: "attacker" | "defender";
  side: "left" | "right";
  laneAffinity: "top" | "bottom";
  polygon: NormalizedPoint[];
  spawnSlots: SpawnSlot[];
  connectedRoutes: string[];
  elevation: number;
  walkable: boolean;
}
```

**训练营默认行为：**

- 进攻方部队默认在左上、左下两个高地出生区中随机且均衡地分配。
- 防守方部队默认在右上、右下两个高地出生区中随机且均衡地分配。
- 随机分配必须使用比赛随机种子，保证相同种子可复现。
- 用户手动改变出生位置时，继续使用现有的出生位置编辑逻辑。
- 地图模块只需要提供合法出生区域、出生槽位和路线连接信息。
- 不要重新开发已有的位置编辑界面。
- 用户修改出生位置后，地图需要重新计算部队对应的初始路线、朝向和可行走区域。
- 用户配置不能把部队放到墙体内、地图外或不可行走区域。

**如果现有系统已经存在出生位置分配服务，地图通过适配器读取该服务的结果：**

```ts
interface SpawnAllocationAdapter {
  getDefaultAllocation(matchSeed: string, faction: Faction): SpawnAllocation;
  getUserAllocation(): SpawnAllocation;
  validateAllocation(allocation: SpawnAllocation): ValidationResult;
}
```

## 4. 防御塔布局和规则

### 4.1 防御塔识别

图片中的红色和青色八边形表示双方防御塔。

**Codex 必须根据参考图片完整提取：**

- 每一个红色八边形位置。
- 每一个青色八边形位置。
- 每座塔所属路线。
- 每座塔所属阵营。
- 每座塔在路线上的顺序。
- 每座塔是否位于路线中间或路线侧边。
- 每座塔的攻击范围。
- 每座塔是否受到其他建筑或高地保护。
- 不要根据常见 MOBA 地图习惯擅自改成固定的“每路三塔”布局。参考图中不同路线的塔数量可能不同，必须以图片和现有产品设计为准。

**建议数据结构：**

```ts
interface MapTowerDefinition {
  id: string;
  faction: "attacker" | "defender";
  position: NormalizedPoint;
  routeId: "top" | "middle" | "bottom";
  order: number;
  visualType: string;
  collisionRadius: number;
  attackRange: number;
  maxHealth: number;
  targetPolicyId: string;
  destructible: boolean;
}
```

### 4.2 防御塔和部队的交互

防御塔属于地图实体，但伤害计算应尽量复用现有战斗系统。

**地图系统负责：**

- 塔的位置。
- 塔的碰撞。
- 塔的攻击范围。
- 塔的阵营。
- 塔的目标选择入口。
- 塔的摧毁状态。
- 塔的视觉表现。
- 塔与路线推进的关系。

**战斗系统负责：**

- 实际攻击判定。
- 伤害计算。
- 护甲、抗性和减伤。
- 攻击冷却。
- 受击事件。
- 死亡或摧毁事件。

**防御塔至少需要支持：**

- 发现攻击范围内的敌方目标。
- 按目标优先级选择目标。
- 目标死亡后重新选择。
- 被敌方单位攻击时产生仇恨。
- 与部队、召唤物和中立单位区分目标类型。
- 被摧毁后更新路线状态。
- 摧毁状态可保存和恢复。
- 塔的攻击和状态更新由在线模式下的权威端执行。

**目标优先级不要直接硬编码在渲染组件中，使用可配置策略：**

```ts
interface TowerTargetPolicy {
  id: string;
  priorities: Array<
    "attacking-unit"
    | "nearest-enemy"
    | "siege-unit"
    | "summoned-unit"
    | "high-threat-unit"
  >;
  maxTargetDistance: number;
  retargetDelayMs: number;
}
```

## 5. 中立士兵和中立怪物

### 5.1 中立单位标记

参考图中的蓝色 X 表示中立士兵或怪物位置。

**这些标记分布在：**

- 左侧上半部野区。
- 左侧下半部野区。
- 中央沙地区上下位置。
- 右侧上半部野区。
- 右侧下半部野区。
- Codex 必须根据图片建立所有中立营地的空间数据，不要求每一个 X 都使用相同的中立单位类型。

**每个中立标记应转换为一个营地锚点或营地组：**

```ts
interface NeutralCampDefinition {
  id: string;
  position: NormalizedPoint;
  regionId: string;
  campType: string;
  spawnPoints: NormalizedPoint[];
  patrolPoints: NormalizedPoint[];
  leashArea: NormalizedPoint[];
  composition: NeutralUnitComposition[];
  behaviorProfileId: string;
  initialSpawnAtMs: number;
  respawnDelayMs: number;
}
```

中立单位的具体组成应优先从已有部队数据表、已有怪物配置或现有训练营规则中读取。没有现成定义时，Codex 可以根据项目结构补齐最小可运行配置，但必须保持配置化。

### 5.2 中立营地生命周期

**营地状态至少包括：**

- waiting
- spawning
- alive
- alerted
- chasing
- fighting
- leashing
- cleared
- respawning
- disabled

**推荐生命周期：**

- 根据比赛时间判断是否到达初始生成时间。
- 到达生成时间后，在合法出生点创建中立单位。
- 中立单位在营地范围内待机或巡逻。
- 发现敌对单位后进入警戒。
- 按目标优先级选择攻击对象。
- 目标离开营地追击范围后开始拉脱。
- 拉脱时返回营地。
- 返回营地后恢复生命、重置目标或按现有规则处理。
- 营地所有单位死亡后进入重生计时。
- 重生计时以模拟时间计算，不能以渲染帧数计算。
- 页面刷新或在线重连后，根据保存的比赛时间重新推导营地状态。
- 单个营地可以有多个单位、不同单位类型和不同出生点。
- 具体重生时间、巡逻时间和追击距离不要照搬其他游戏的固定数值，由 Codex 读取现有配置并通过训练营体验进行调优。

## 6. 墙体、高墙和地图碰撞

### 6.1 高墙

参考图中的黑色尖刺形状代表高墙。

**高墙至少影响：**

- 部队移动。
- 寻路。
- 近战攻击接近位置。
- 远程投射物。
- 视野。
- 技能位移。
- 中立单位追击和拉脱。
- 相机或鼠标选取时的空间判断。

**建议结构：**

```ts
interface HighWallDefinition {
  id: string;
  polygon: NormalizedPoint[];
  height: number;
  thickness: number;
  blocksMovement: true;
  blocksVision: boolean;
  blocksProjectiles: boolean;
  climbable: false;
  destructible: boolean;
}
```

**高墙不能只使用一个平面 Mesh。至少应有：**

- 可渲染 Mesh。
- 碰撞体。
- 寻路障碍区域。
- 视线检测几何。
- 投射物检测几何。

### 6.2 普通墙

参考图中的黑色弧线、半圆、弯曲封闭线和局部围墙代表普通墙。

其中黑色弧线、半圆和封闭线按薄挡板建模；四个图片来源的黑色月牙轮廓按实心厚墙建模，直接使用轮廓多边形挤出，并拥有更宽的组合 OBB、视线阻挡和独立的 `training_map_thick_wall` 静态对象。中央锯齿高墙继续沿图片中心线生成高墙网格。

**普通墙应保留图片中的曲线形态。可以根据性能采用：**

- 折线碰撞体。
- 简化多边形。
- 多段圆弧。
- 视觉曲线和逻辑碰撞多边形分离。

**建议结构：**

```ts
interface NormalWallDefinition {
  id: string;
  visualPath: NormalizedPoint[];
  collisionPolygon: NormalizedPoint[];
  height: number;
  thickness: number;
  blocksMovement: boolean;
  blocksVision: boolean;
  blocksProjectiles: boolean;
}
```

视觉路径和逻辑碰撞边界不要求完全相同，但误差必须在可接受范围内，不能导致单位明显穿墙或被无形墙卡住。

### 6.3 墙体与路线

路线生成时必须把高墙和普通墙作为障碍加入导航系统。

**需要验证：**

- 上路部队不会穿过上半部野区墙体。
- 中路部队不会穿过不应进入的野区封闭墙体。
- 下路部队不会穿过下半部野区墙体。
- 部队受到技能位移后不会被送入墙体内部。
- 部队被击退、拉扯、冲锋或瞬移时会执行合法位置校验。
- 中立单位追击到边界时不会无限贴墙抖动。
- 路线受阻时，部队可以停止、绕行或重新选择目标。
- AI 不会因为目标点位于墙后而反复尝试直线移动。

## 7. 地形和视觉实现

### 7.1 草地

绿色区域是地图基础草地。

**实现要求：**

- 作为主要可行走地面。
- 作为野区和路线外区域的基础材质。
- 支持地图边界。
- 支持阴影和环境光。
- 支持低端设备降级材质。
- 不使用一张巨型高分辨率贴图覆盖全部地图。
- 优先使用可平铺材质、程序化几何或低分辨率基础纹理。

### 7.2 沙地

**黄色区域包括：**

- 中央纵向沙地区。
- 图片顶部和底部靠近中央区域的黄色半圆区域。
- 双方野区中的黄色矩形区域。

**黄色矩形和黄色半圆不能仅按颜色判断为同一个对象。Codex 需要根据其空间位置判断是：**

- 沙地块。
- 沙地营地。
- 地形装饰。
- 可行走区域。
- 中立单位相关区域。
- 如果实际产品没有进一步规则，可先统一归入 sand 地形，再通过配置添加特殊区域行为。

### 7.3 道路

灰色横向道路对应三条主要进攻路线。

**道路实现需要包括：**

- 道路中心线。
- 道路宽度。
- 道路边界。
- 路线入口和出口。
- 路线方向。
- 部队默认移动速度或移动偏好。
- 道路和野区之间的连接点。
- 道路不参与部队路径偏好。所有部队都可以在草地、沙地和道路间走最短直线，仅受地图边界和建筑碰撞校验约束。

### 7.4 高地外观

**高地需要体现：**

- 明确的区域边界。
- 与普通地面的高度差。
- 出生区域标识。
- 阵营颜色或阵营标识。
- 与主路线的合法连接。
- 必要的坡道、台阶或入口。
- 不要只把高地画成一个三角形平面。高地必须能在三维场景中体现空间高度，同时不会破坏单位导航。

## 8. 地图数据组织

**建议建立独立的静态地图定义：**

```text
public/
  maps/
    training-war-map-v1/
      manifest.json
      geometry.json
      navigation.json
      objectives.json
      neutral-camps.json
      rules.json
      reference/
        battlefield-map-reference.png
```

**如果项目使用 src 内置数据，也可以放在现有数据目录中，但必须保持以下逻辑分离：**

- 地图静态定义
- 地图导航数据
- 地图视觉资源
- 地图目标配置
- 地图规则配置
- 比赛运行时状态

### 8.1 地图定义

```ts
interface WarMapDefinition {
  id: string;
  version: number;
  sourceReference: {
    fileName: string;
    width: number;
    height: number;
    hash?: string;
  };
  coordinateSystem: CoordinateSystem;
  regions: MapRegionDefinition[];
  routes: MapRouteDefinition[];
  spawnRegions: HighlandSpawnRegion[];
  towers: MapTowerDefinition[];
  walls: WallDefinition[];
  neutralCamps: NeutralCampDefinition[];
  landmarks: MapLandmarkDefinition[];
  rules: WarMapRules;
}
```

### 8.2 区域定义

```ts
interface MapRegionDefinition {
  id: string;
  kind:
    | "grass"
    | "sand"
    | "road"
    | "highland"
    | "spawn"
    | "blocked"
    | "neutral";
  polygon: NormalizedPoint[];
  elevation: number;
  walkable: boolean;
  movementModifier?: {
    speedMultiplier?: number;
    turnRateMultiplier?: number;
    visionMultiplier?: number;
  };
  connectedRoutes: string[];
}
```

### 8.3 地图规则

```ts
interface WarMapRules {
  simulationTickRate: number;
  defaultSpawnPolicy: "balanced-random";
  allowUserSpawnAllocation: boolean;
  routePolicy: "lane-first";
  neutralCampPolicy: string;
  towerPolicy: string;
  movementPolicy: string;
  onlineReady: boolean;
}
```

具体数值优先读取现有系统配置。地图配置只保存地图相关规则，不复制部队属性。

## 9. 与现有部队系统的接入原则

### 9.1 现有系统优先

**Codex 首先搜索并理解：**

```bash
rg -n "unit|troop|army|hero|skill|ability|combat|damage|attack|move|spawn|position|training|battle|map|path|nav|tower|monster|camp" .
```

**重点确认：**

- 部队实体的唯一 ID。
- 部队数据表的读取方式。
- 部队运行时状态。
- 部队阵营字段。
- 部队出生接口。
- 部队移动接口。
- 技能释放接口。
- 位移接口。
- 攻击和伤害接口。
- 死亡和销毁接口。
- 当前 AI 控制入口。
- 现有出生位置编辑状态。
- 部队模型和资源加载机制。
- 当前模拟时钟。
- 是否已有客户端/服务端状态同步机制。

### 9.2 不重复实现的内容

**以下功能若已存在，不得重新创建第二套实现：**

- 部队属性。
- 部队类型。
- 部队技能。
- 技能冷却。
- 技能伤害。
- 部队位移。
- 部队死亡。
- 部队数据编辑。
- 用户调整出生位置的操作界面。
- 已有的战斗事件系统。
- 已有的资源加载器。
- 已有的在线状态同步框架。

**地图模块应该提供：**

- 合法出生区域。
- 出生槽位。
- 路线入口。
- 导航查询。
- 地形查询。
- 碰撞查询。
- 塔和营地位置。
- 地图目标状态。
- 地图事件。

### 9.3 地图适配接口

**建议增加类似接口：**

```ts
interface BattlefieldMapAdapter {
  getSpawnRegions(faction: Faction): HighlandSpawnRegion[];
  validateSpawnPosition(position: WorldPoint): boolean;
  getRoute(routeId: string): MapRouteDefinition;
  findPath(request: PathRequest): PathResult;
  isWalkable(position: WorldPoint, unitContext: UnitContext): boolean;
  getTerrainAt(position: WorldPoint): TerrainSample;
  queryTargets(area: AreaQuery): TargetableEntity[];
  getTower(id: string): TowerRuntimeState | undefined;
  getNeutralCamp(id: string): NeutralCampRuntimeState | undefined;
}
```

## 10. AI 部队行为和寻路细化

当前网页系统中的 AI 部队行为较简单，不能寻路或进行复杂操作。本阶段需要在不破坏现有部队技能和战斗系统的前提下，补齐地图相关的基础 AI。

重点不是制作复杂的英雄 AI，而是让部队能够在这张地图上可靠地移动、交战和选择目标。

### 10.1 寻路技术方案

**优先采用成熟的导航方案：**

- 如果项目已有 NavMesh，优先适配现有 NavMesh。
- 如果没有，使用地图几何生成导航图或 NavMesh。
- 如果项目技术栈允许，可评估 recast-navigation-js、Recast/Detour 或现有 three-pathfinding 方案。
- 服务端和客户端需要使用兼容的导航数据。
- 在线模式下，最终路径和移动结果必须由权威端决定。
- Recast/Detour 类方案适合处理多边形导航、障碍和路径查询；Three.js 只负责显示，不应承担完整的游戏规则寻路。[1][2][3]

**建议采用以下组合：**

**静态地图：**

- NavMesh 或分区导航图

**路线推进：**

- 三条路线的 waypoint graph

**局部避让：**

- 单位半径、队列、局部转向和拥挤处理

**战术目标：**

- 有限状态机或 Utility AI

**在线模式：**

- 服务端计算最终路径和移动状态

### 10.2 直线优先寻路

普通兵线单位默认不应该每帧使用全地图自由寻路。

**推荐流程：**

- 出生点可保留路线归属作为战术标签，但不得把归属转换为中心线强制队列。
- 对用户右键目标、敌方单位、地图目标和后备目标先检测直线段；草地、沙地和道路均按可行走地面处理。
- 直线可走时只保留目标点；只有墙体、塔等建筑碰撞或地图边界阻挡时，才触发局部 A* 并输出最短绕行折线。
- 敌方目标死亡、目标切换或绕行失败时，重新对当前目标做一次直线优先查询，不返回道路中心线。
- 目标丢失时不能在原地持续抖动或重复寻找同一目标。

### 10.3 AI 状态机

**至少实现以下基础状态：**

- Spawn
- Forming
- Advance
- ApproachTarget
- Attack
- UseAbility
- Retreat
- RejoinLane
- Chase
- ReturnToCamp
- Dead
- Disabled

**状态切换必须带：**

- 进入条件。
- 退出条件。
- 最大持续时间。
- 目标失效处理。
- 路径失败处理。
- 重试次数。
- 冷却时间。
- 事件日志。

**示例：**

```ts
interface AIState {
  id: string;
  enter(context: AIContext): void;
  update(context: AIContext, deltaMs: number): AITransition | void;
  exit(context: AIContext): void;
}
```

### 10.4 目标选择

AI 不应只选择最近单位。

**目标评分可以综合：**

- 阵营关系
- 距离
- 是否在当前路线
- 是否正在攻击己方单位
- 单位类型
- 目标威胁
- 目标生命值
- 目标是否在攻击范围
- 目标是否在塔或营地保护范围内
- 目标是否值得离开路线追击

**建议使用可配置评分函数：**

```ts
interface TargetScoreContext {
  distance: number;
  sameRoute: boolean;
  attackingAlly: boolean;
  targetType: string;
  healthRatio: number;
  threat: number;
  insidePreferredArea: boolean;
}
```

所有 AI 目标选择都必须经过地图查询接口，避免 AI 自己读取 Three.js 对象位置。

### 10.5 防止 AI 卡死

**必须专门处理以下问题：**

- 单位被墙体卡住。
- 单位被其他单位堵住。
- 多个单位同时争夺一个目标点。
- 单位在目标两侧来回切换。
- 单位反复绕墙。
- 目标在高墙另一侧。
- 技能位移后进入不可行走区域。
- 部队离开路线后无法回到路线。
- 中立怪物追击超出营地范围。
- 目标死亡后仍继续攻击旧目标。
- 路径查询失败。
- 单位与塔碰撞后重叠。
- 大批单位在同一位置堆叠。

**至少加入：**

- 路径失败计数
- 局部重规划冷却
- 最近合法位置回退
- 目标锁定时间
- 路线重新接入
- 拥挤分离
- 卡死检测
- 最大追击时间
- 最大离线距离

**卡死检测可以基于：**

- 一段时间内实际位移低于阈值
- 但单位仍处于移动状态
- 且目标点距离没有明显缩短

**触发后按顺序尝试：**

- 重新查询当前区域路径。
- 查询最近路线点。
- 查询最近合法位置。
- 暂停并等待路线空间释放。
- 回退到上一个安全位置。
- 记录错误并避免无限重试。

### 10.6 技能 AI 接入

**现有技能系统继续负责技能执行。地图 AI 只负责决定：**

- 是否释放技能。
- 技能目标。
- 技能目标点。
- 技能释放时机。
- 技能是否允许离开路线。
- 技能是否需要躲避墙体或高地边界。

**技能释放前必须经过：**

- 目标合法性检查
- 范围检查
- 路线/区域检查
- 障碍检查
- 冷却检查
- 资源检查
- 友军/敌军关系检查
- AI 不要直接修改技能状态。应调用现有技能命令接口。

## 11. 地图模拟和在线对战准备

虽然当前主要是训练营，但后续要支持在线对战，因此地图实现从第一天就必须与渲染层解耦。

### 11.1 模拟状态是唯一事实来源

Three.js 中的对象不是游戏状态。

**正确关系：**

```text
MapDefinition
    ↓
MapSimulation
    ↓
RuntimeState
    ↓
Three.js Render Projection
错误关系：
Three.js Object3D 直接作为部队状态
Three.js 对象只负责：
```

位置显示。
朝向显示。
动画显示。
特效显示。
选中显示。
不能从 Mesh 是否存在来判断单位是否活着，不能从 Mesh 的位置作为在线同步的最终结果。

### 11.2 固定时间步

**地图模拟采用固定时间步：**

```text
simulation tick
    ↓
地图事件
    ↓
单位 AI
    ↓
寻路和移动
    ↓
技能与战斗命令
    ↓
塔和营地
    ↓
生成事件/死亡事件/路线事件
    ↓
输出运行时状态
渲染帧率只负责画面插值，不决定部队生成、攻击和重生时间。
```

### 11.3 权威端设计

**在线模式建议：**

**服务端：**

- 比赛时钟
- 地图规则
- 部队生成
- AI
- 寻路结果
- 技能命令校验
- 伤害结算
- 防御塔
- 中立营地
- 胜负状态
- 持久化

**客户端：**

- 发送用户操作
- 接收快照和事件
- 本地渲染
- 预测显示
- 插值
- 断线重连
- 客户端不能成为最终规则判定端。

### 11.4 网络协议兼容

即使本阶段还没有完整在线服务，也应避免把接口设计成只能本地运行。

**建议区分：**

```ts
interface ClientCommand {
  commandId: string;
  clientTick?: number;
  actorId: string;
  type: string;
  payload: unknown;
}
```

```ts
interface MapEvent {
  eventId: string;
  matchId: string;
  serverTick: number;
  type: string;
  entityId?: string;
  payload: unknown;
}
```

```ts
interface MatchSnapshot {
  matchId: string;
  mapId: string;
  mapVersion: number;
  serverTick: number;
  simulationTimeMs: number;
  units: UnitNetworkState[];
  towers: TowerNetworkState[];
  neutralCamps: NeutralCampNetworkState[];
}
```

**需要支持：**

- 命令 ID 去重。
- 事件序号。
- 快照版本。
- 客户端重连。
- 地图版本校验。
- 随机种子。
- 服务器时间。
- 增量事件。
- 完整快照恢复。
- 不要同步每个 Three.js 对象的完整状态。同步逻辑实体状态即可。

### 11.5 随机性

**所有地图相关随机行为必须可复现：**

- 默认出生高地分配。
- 中立营地生成顺序。
- 部队编队扰动。
- AI 在同分目标中的选择。
- 特殊地图事件。
- 使用比赛随机种子和独立的随机流，不要直接调用无法复现的全局 Math.random()。

## 12. 资源加载和网页流畅度

### 12.1 资源原则

**运行时资源优先使用本地资源：**

- 不依赖外部图片地址。
- 不依赖第三方模型 CDN。
- 不依赖运行时跨域字体或纹理。
- 不使用在线服务才能显示基础地图。
- 所有地图基础资源都应能离线加载。
- 如果现有项目已经有统一资源管理系统，复用它。

### 12.2 地图资源分级

**资源分为三类：**

**关键资源：**

- 地图几何定义
- 地形基础材质
- 导航数据
- 出生区域
- 路线数据
- 防御塔基础占位模型

**近场资源：**

- 当前视野内的塔
- 当前视野内的中立营地
- 当前活动部队资源
- 近距离特效

**远场资源：**

- 远距离野区装饰
- 非当前路线特效
- 高细节模型
- 非关键音效

**首屏必须优先完成：**

- 地图基本几何。
- 地形颜色。
- 三条路线。
- 四个高地出生区。
- 防御塔占位。
- 当前部队。
- 高细节模型、特效和装饰不得阻塞地图首次可交互。

### 12.3 Three.js 资源处理

**如果现有工程允许，使用：**

- GLTFLoader 加载本地 glTF/GLB。
- Draco、Meshopt 或其他网格压缩。
- KTX2/Basis 纹理压缩。
- LoadingManager 统一管理加载进度和错误。
- InstancedMesh 或对象池渲染大量重复单位。
- LOD 降低远距离模型开销。
- 纹理复用和材质复用。
- 地图实例销毁时释放 GPU 资源。
- Three.js 的 GLTFLoader 支持加载 glTF/GLB，并可以配置 Draco、KTX2 和 Meshopt 解码器。[4] glTF 的设计目标之一就是降低 Web 端三维资源的传输和运行时处理成本。[5] Three.js 的 LOD 可以根据相机距离切换不同细节等级。[6]

### 12.4 地图几何的实现顺序

**先按以下顺序实现：**

- 程序化地面。
- 程序化道路。
- 程序化沙地。
- 程序化墙体。
- 程序化高地。
- 防御塔占位几何。
- 中立营地占位几何。
- 部队接入。
- 真实模型替换。
- 特效和环境装饰。
- 不要在导航和规则尚未正确前先投入大量高模资源。

### 12.5 性能要求

**至少测试以下场景：**

- 20 个部队。
- 50 个部队。
- 100 个部队。
- 200 个部队。
- 部队同时移动和攻击。
- 多个营地同时战斗。
- 多座防御塔同时攻击。
- 大量技能特效同时存在。
- 地图切换后重新进入。
- 页面刷新后恢复比赛状态。

**需要记录：**

- 首次可交互时间。
- 地图资源总大小。
- 请求数量。
- GPU 纹理占用。
- JavaScript 堆占用。
- 模拟帧耗时。
- 渲染帧耗时。
- 寻路耗时。
- AI 决策耗时。
- 场景卸载后的内存变化。

## 13. 数据持久化

### 13.1 静态地图和运行时状态分离

**静态地图数据：**

- MapDefinition
- NavigationData
- TowerDefinition
- NeutralCampDefinition
- TerrainDefinition

**运行时状态：**

- MatchState
- UnitRuntimeState
- TowerRuntimeState
- NeutralCampRuntimeState
- SpawnAllocation
- PendingWave
- SimulationClock

**不要持久化以下内容：**

- Three.js Object3D
- Mesh
- Geometry
- Material
- Texture
- 动画实例
- DOM 节点
- 临时路径缓存
- 临时渲染对象

### 13.2 训练营状态

**建议结构：**

```ts
interface TrainingBattlefieldSnapshot {
  schemaVersion: number;
  mapId: string;
  mapVersion: number;
  matchId: string;
  randomSeed: string;
  simulationTimeMs: number;
  status: "running" | "paused" | "finished";
  spawnAllocation: SpawnAllocation;
  units: UnitSnapshot[];
  towers: TowerSnapshot[];
  neutralCamps: NeutralCampSnapshot[];
  pendingWaves: PendingWaveSnapshot[];
  updatedAt: string;
}
```

**部队快照中只保存：**

- 部队 ID。
- 部队数据表引用。
- 阵营。
- 当前坐标。
- 当前朝向。
- 当前生命值。
- 当前状态效果。
- 当前目标 ID。
- 当前 AI 状态。
- 当前路线 ID。
- 当前路径索引。
- 技能冷却。
- 是否死亡。
- 是否由用户控制。
- 当前生成波次 ID。

### 13.3 在线模式状态

在线模式的比赛状态应以服务端为准。

**训练营可以使用：**

- IndexedDB。
- 现有后端接口。
- 本地快照适配器。

**在线模式应接入：**

- 服务端比赛存储。
- 比赛 ID。
- 地图版本。
- 玩家 ID。
- 服务器时间。
- 断线重连快照。
- 事件序号。
- 快照校验。

**建议设计适配器：**

```ts
interface BattlefieldPersistenceAdapter {
  load(matchId: string): Promise<BattlefieldSnapshot | null>;
  save(snapshot: BattlefieldSnapshot): Promise<void>;
  delete(matchId: string): Promise<void>;
}
```

优先复用现有项目的存储层，不要未经检查直接引入新的数据库或状态管理方案。

## 14. 推荐代码结构

**实际路径应以现有项目结构为准。可以参考以下分层：**

```text
map/
  domain/
    WarMapDefinition
    MapRegion
    MapRoute
    MapWall
    MapTower
    NeutralCamp
    SpawnRegion
```

  simulation/
    BattlefieldSimulation
    RouteSimulation
    TowerSimulation
    NeutralCampSimulation
    WaveSimulation

  navigation/
    NavigationAdapter
    LaneWaypointGraph
    NavMeshAdapter
    LocalSteering
    StuckDetector

  ai/
    UnitAIController
    LaneBehavior
    NeutralBehavior
    TowerTargetSelector
    TargetScorer

  rendering/
    WarMapScene
    TerrainRenderer
    RouteRenderer
    WallRenderer
    HighlandRenderer
    TowerRenderer
    NeutralCampRenderer
    UnitProjection
    MapDebugOverlay

  persistence/
    BattlefieldSnapshot
    BattlefieldPersistenceAdapter
    SnapshotMigration

  assets/
    MapAssetManifest
    MapAssetLoader
不要把 AI、寻路、战斗、地图渲染和持久化全部塞进一个 Three.js 场景文件。

## 15. 分阶段执行任务

### Phase 1：现有系统审计

Codex 先完成代码库检查，不立即重写代码。

**需要确认：**

- Three.js 场景入口。
- 训练营模块入口。
- 当前空白地图的实现位置。
- 部队数据表。
- 部队运行时实体。
- 部队出生和位置分配。
- 部队技能和位移。
- 战斗系统。
- AI 控制入口。
- 寻路和碰撞能力。
- 资源加载方式。
- 状态管理。
- 持久化。
- 后端和在线通信能力。

**输出：**

- docs/architecture/war-map-existing-system-audit.md

**验收要求：**

- 列出实际文件路径。
- 列出现有可复用接口。
- 列出缺失接口。
- 列出不能直接复用的旧地图假设。
- 不破坏现有功能。

### Phase 2：图片几何标注

将参考图片作为地图空间的主要来源。

**需要提取：**

- 实际战场边界。
- 四个高地出生区。
- 三条路线。
- 中央沙地区。
- 黄色矩形区域。
- 黄色半圆区域。
- 所有红色防御塔。
- 所有青色防御塔。
- 所有蓝色中立单位/怪物标记。
- 所有高墙。
- 所有普通墙。
- 道路入口和路线连接。
- 地图外不可行走区域。

**创建：**

- geometry.json
- navigation.json
- objectives.json
- neutral-camps.json

**同时创建一个开发调试层，显示：**

- 坐标。
- 区域 ID。
- 路线 ID。
- 塔 ID。
- 营地 ID。
- 墙体 ID。
- 出生槽位 ID。

**验收要求：**

- 图片中的所有有意义符号都有结构化对象。
- 左右阵营布局与图片一致。
- 上、中、下三条路线位置与图片一致。
- 四个高地被识别为出生区域。
- 中央沙地区没有被错误地省略。
- 视觉几何和碰撞几何能够分别查看。

### Phase 3：基础地图渲染

**实现一个不依赖真实部队的地图场景：**

- 草地。
- 沙地。
- 道路。
- 高地。
- 墙体。
- 地图边界。
- 防御塔占位。
- 中立营地占位。
- 出生区域标识。
- 优先使用程序化几何和简单本地材质验证地图空间。

**验收要求：**

- Three.js 场景可正常加载。
- 地图没有明显拉伸、错位或镜像错误。
- 相机能完整看到四个高地和中央沙地。
- 三条路线位置与图片大致重合。
- 墙体方向、数量和相对位置正确。
- 进攻方和防守方颜色方向正确。
- 不依赖远程资源即可显示基础地图。

### Phase 4：导航、碰撞和地形查询

**实现：**

- 地图边界碰撞。
- 高墙碰撞。
- 普通墙碰撞。
- 高地高度。
- 道路导航。
- 野区导航。
- 中央沙地区导航。
- 高地与路线之间的连接。
- 最近合法位置查询。
- 技能位移合法性检查。
- 路径失败处理。
- 卡死检测。
- 优先接入现有寻路系统。

**如果现有系统没有足够的寻路能力：**

- 先实现路线 waypoint graph。
- 再实现墙体和区域的导航障碍。
- 再增加 A* 或 NavMesh 查询。
- 最后增加局部避让和拥挤处理。

**如果采用第三方导航库，需要检查：**

- 浏览器是否可用。
- 服务端是否可用。
- 是否可以生成并缓存静态 NavMesh。
- 客户端和服务端是否使用兼容的导航数据。
- 构建体积和 WASM 加载成本。
- 许可证是否适合项目。

**验收要求：**

- 部队不能穿墙。
- 部队不会跑出地图。
- 部队不会进入未连接的高地。
- 部队经过中央沙地时路径连续。
- 技能位移不会把单位送入墙体。
- 单位被阻挡时可以重新规划或进入合理等待状态。
- 中立怪物不会永久追击到地图另一侧。

### Phase 5：四个高地出生系统接入

不要重新实现用户操作出生位置的 UI。

**需要完成：**

- 将左上、左下标记为进攻方出生区域。
- 将右上、右下标记为防守方出生区域。
- 为每个高地创建出生槽位。
- 接入现有默认随机均衡分配逻辑。
- 接入现有用户手动调整出生位置逻辑。
- 对用户提交的出生位置做地图合法性校验。
- 根据出生高地推导初始路线。
- 根据路线设置部队初始朝向。
- 支持部队出生在高地内部的稳定位置。
- 防止多个部队出生重叠。
- 防止出生位置与墙体、塔或不可行走区域重叠。

**验收要求：**

- 进攻方只会在左侧两个高地出生。
- 防守方只会在右侧两个高地出生。
- 默认分配随机且均衡。
- 同一随机种子可以复现相同分配。
- 用户已有的出生位置编辑操作仍然有效。
- 用户调整后的部队能够从新出生点进入合法路线。
- 地图重载后出生位置配置保持一致。

### Phase 6：路线推进和部队移动

**实现三条路线的地图运行时逻辑：**

- 上路。
- 中路。
- 下路。

**部队行为：**

- 从高地出生。
- 绑定路线。
- 形成初始编队。
- 沿路线推进。
- 遇到敌方单位时进入战斗。
- 当前目标死亡后继续推进。
- 遇到防御塔时进入塔交互。
- 部队受到位移后重新接入路线。
- 路线拥堵时进行局部避让。
- 路线受阻时等待或重新规划。
- 目标离开路线后根据部队类型决定是否追击。
- 追击超时后回到路线。

**需要避免：**

- 部队每帧重新计算全图路径。
- 多个单位永远争抢同一个路点。
- 近战单位无法接近目标。
- 远程单位站在墙体后攻击。
- 单位死亡后仍占用路线空间。
- 目标消失后 AI 继续追踪旧 ID。
- 部队在路线边缘来回抖动。
- 部队在中央沙地区迷路。

### Phase 7：防御塔和地图目标

**接入现有战斗系统，实现：**

- 所有塔的渲染。
- 所有塔的碰撞。
- 所有塔的攻击范围。
- 所有塔的目标选择。
- 塔受到部队攻击。
- 塔攻击敌方单位。
- 塔受损状态。
- 塔摧毁状态。
- 塔摧毁后的路线变化。
- 塔状态持久化。
- 在线模式下的服务端判定。
- 具体攻击力、攻速、生命值和目标优先级优先从现有项目中查找；没有定义时再新增配置。

**塔的逻辑实体和视觉实体分离：**

```ts
interface TowerRuntimeState {
  id: string;
  definitionId: string;
  faction: Faction;
  health: number;
  maxHealth: number;
  active: boolean;
  destroyedAt?: number;
  currentTargetId?: string;
}
```

### Phase 8：中立营地和中立单位

实现图片中所有中立单位/怪物标记对应的营地。

**每个营地应支持：**

- 初始生成。
- 多个出生点。
- 待机。
- 巡逻。
- 感知。
- 警戒。
- 追击。
- 攻击。
- 拉脱。
- 返回。
- 清空。
- 重生。
- 禁用。
- 训练营重置。

**中立单位 AI 不需要实现复杂的全局战略，但必须可靠完成：**

- 不穿墙。
- 不无限追击。
- 不离开营地过远。
- 能选择附近合法目标。
- 目标死亡后重新选择。
- 被位移后能够返回正常行为。
- 营地被清空后进入准确的重生计时。

### Phase 9：AI 行为补齐

在现有 AI 入口上增加地图相关行为。

**建议使用：**

```text
基础状态机
+
路线行为
+
目标评分
+
有限范围寻路
+
局部避让
+
卡死检测
```

**暂时不要求实现复杂的全局战术 AI，但必须支持以下地图行为：**

- 普通路线部队
- 出生后前往对应路线。
- 沿路线推进。
- 对路线上的敌人进行交战。
- 对防御塔进行攻击。
- 不因为一个目标离开路线太远而无限追击。
- 战斗结束后重新加入路线。
- 近战部队
- 选择可接近的敌方目标。
- 查询攻击距离内的合法站位。
- 避免所有单位堆叠在同一个点。
- 目标死亡后重新选择。
- 远程部队
- 保持合理攻击距离。
- 尽量避免站在墙体后。
- 目标不可见或不可达时更换目标。
- 不直接穿过高墙寻找目标。
- 中立单位
- 只在营地附近活动。
- 按感知范围获取目标。
- 追击距离受限。
- 超出范围后拉脱。
- 返回营地后重置行为。
- AI 的失败恢复

**AI 必须处理：**

- 无路径。
- 路径点失效。
- 目标失效。
- 目标被墙体隔离。
- 当前位置非法。
- 出生点被占用。
- 路线拥堵。
- 单位卡死。
- 服务器重连后状态恢复。

### Phase 10：地图资源和加载

#### 10.1 资源策略

基础地图应尽量使用本地资源和程序化几何。

**推荐资源结构：**

- public/maps/training-war-map-v1/
- manifest.json
- geometry.json
- navigation.json
- objectives.json
- neutral-camps.json
- rules.json
- terrain/
- walls/
- towers/
- camps/
- effects/

**资源加载顺序：**

1. 地图配置
2. 导航数据
3. 基础地面
4. 道路、沙地、高地和墙体
5. 防御塔占位
6. 当前部队模型
7. 中立营地模型
8. 高质量建筑模型
9. 特效和环境装饰
- 基础地图必须在高质量模型没有加载完成时仍可使用。

#### 10.2 资源技术要求

如果项目已有资源加载器，复用现有实现。

**如果需要新增，统一封装：**

- 加载进度。
- 加载失败。
- 缓存。
- 重复资源复用。
- 资源释放。
- 低模降级。
- 设备能力检测。

**可以评估使用：**

- GLTFLoader
- Draco
- Meshopt
- KTX2/Basis
- InstancedMesh
- LOD
- 对象池
- Three.js 官方 GLTFLoader 支持 glTF/GLB 及 Draco、KTX2、Meshopt 扩展接入。[4] glTF 是适合 Web 三维资源交付的格式。[5] Three.js 还提供了按相机距离切换模型细节的 LOD 能力。[6]

#### 10.3 不使用图片作为最终地图

**参考图片只用于：**

- 几何标注。
- 视觉比对。
- 开发调试覆盖。
- 自动化截图验收。

**最终运行时不应只渲染一张图片平面，因为：**

- 图片无法承担碰撞。
- 图片无法承担寻路。
- 图片无法表达高地高度。
- 图片无法表达防御塔范围。
- 图片无法支持在线状态同步。
- 图片无法支持动态单位和地图事件。

#### 10.4 可复现性能基准流程（2026-08-17）

性能记录必须通过运行时侧的有界采样器完成，不能由调试面板或 Three.js Mesh 保存状态。采样器只记录耗时和场景上下文，不参与寻路、战斗、地形可走性或 AI 决策。

- 在训练场 HUD 打开“调试”，输入明确场景标签，例如 `20-unit-pathing`、`50-unit-combat`、`100-unit-mixed`、`200-unit-full-map`。
- 部署相同地图预设、相同单位规模和相同行为后，先预热至少 `5s`；点击“开始性能采样”，维持标准 `30s`，再停止并导出 JSON。
- 每份报告必须包含地图 ID/版本/预设、视口和 DPR、阶段、部队/代表单位/渲染单位、建筑/塔、投射物、地图目标和营地计数，以及模拟耗时、渲染耗时和 FPS 的 `count`、`min`、`average`、`p50`、`p95`、`max`。
- 单项采样窗口上限为 `2048` 条，足以保存标准 `30s` 的 `60fps` 渲染数据；超出后只保留最新窗口，并在报告中显示丢弃计数。
- 同一轮对比须关闭非必要调试叠层，记录浏览器和设备差异；真实设备数据未采集前，不以自动化单测结果宣称达到帧率目标。

### Phase 11：在线对战兼容设计

当前可以先实现训练营单机模拟，但所有地图状态必须保持在线对战兼容。

#### 11.1 模拟和渲染分离

```text
地图定义
    ↓
地图模拟
    ↓
运行时实体状态
    ↓
Three.js 显示投影
Three.js 不负责决定：
```

单位是否死亡。
单位是否命中。
防御塔是否摧毁。
野怪是否重生。
单位是否拥有合法路径。
比赛时间。
随机结果。

#### 11.2 权威端原则

**未来在线对战中，权威端负责：**

- 比赛时钟。
- 地图规则。
- 单位出生。
- AI。
- 路径结果。
- 技能合法性。
- 伤害结算。
- 防御塔。
- 中立营地。
- 胜负状态。

**客户端负责：**

- 发送用户操作。
- 接收地图事件。
- 接收状态快照。
- 渲染部队和地图。
- 插值显示。
- 断线重连。
- 处理本地输入反馈。

#### 11.3 网络状态设计

**建议区分：**

```ts
interface BattlefieldCommand {
  commandId: string;
  actorId: string;
  type: string;
  payload: unknown;
  clientTick?: number;
}
```

```ts
interface BattlefieldEvent {
  eventId: string;
  serverTick: number;
  type: string;
  entityId?: string;
  payload: unknown;
}
```

```ts
interface BattlefieldSnapshot {
  matchId: string;
  mapId: string;
  mapVersion: number;
  serverTick: number;
  simulationTimeMs: number;
  units: UnitNetworkState[];
  towers: TowerNetworkState[];
  camps: NeutralCampNetworkState[];
}
```

**必须预留：**

- 事件序号。
- 命令去重。
- 地图版本校验。
- 快照恢复。
- 断线重连。
- 服务端时间。
- 随机种子。
- 增量更新。
- 不要同步 Three.js Object3D，只同步逻辑实体状态。

### Phase 12：持久化

#### 12.1 静态数据

**静态地图数据包含：**

- 地形区域。
- 路线。
- 高地。
- 墙体。
- 防御塔。
- 中立营地。
- 导航数据。
- 地图规则。

#### 12.2 动态数据

**动态比赛状态包含：**

- 比赛 ID。
- 地图 ID。
- 地图版本。
- 随机种子。
- 模拟时间。
- 出生位置分配。
- 活跃部队。
- 部队坐标。
- 部队生命值。
- 部队目标。
- 部队 AI 状态。
- 技能冷却。
- 防御塔生命值。
- 防御塔摧毁状态。
- 中立营地状态。
- 待生成波次。
- 地图事件序号。

**建议类型：**

```ts
interface BattlefieldSnapshot {
  schemaVersion: number;
  mapId: string;
  mapVersion: number;
  matchId: string;
  randomSeed: string;
  simulationTimeMs: number;
  spawnAllocation: SpawnAllocation;
  units: UnitSnapshot[];
  towers: TowerSnapshot[];
  neutralCamps: NeutralCampSnapshot[];
  pendingSpawns: PendingSpawnSnapshot[];
  updatedAt: string;
}
```

**保存策略：**

- 训练营优先接入现有持久化机制。
- 没有后端时使用 IndexedDB。
- localStorage 只保存小型索引。
- 不要每帧写入。
- 在暂停、页面隐藏、地图退出和关键事件后自动保存。
- 在线模式使用服务端存档。
- 所有快照带 schemaVersion 和 mapVersion。
- 地图升级时提供迁移函数。
- 无法迁移时明确提示，不要静默覆盖旧存档。

## 16. 地图重置和训练营行为

**训练营需要支持：**

- 重新开始地图。
- 清除所有部队。
- 重置所有防御塔。
- 重置所有中立营地。
- 重置路线。
- 重置出生位置分配。
- 使用新的随机种子。
- 使用固定随机种子复现测试。
- 暂停和继续。
- 单步推进。
- 保存当前状态。
- 从保存状态恢复。
- 已有训练营控制逻辑应优先复用。

## 17. 地图调试工具

开发环境增加地图调试模式。

**至少支持显示：**

- 参考图片透明覆盖层。
- PDF 归一化坐标。
- Three.js 世界坐标。
- 三条路线中心线。
- 路线宽度。
- 路线方向箭头。
- NavMesh 或导航图。
- 可行走区域。
- 高墙碰撞体。
- 普通墙碰撞体。
- 防御塔 ID 和攻击范围。
- 中立营地 ID 和拉脱范围。
- 高地出生区域。
- 出生槽位。
- 单位当前 AI 状态。
- 单位当前路径。
- 单位当前目标。
- 当前模拟时间。
- 当前地图版本。
- 当前随机种子。
- 当前网络 tick。

**调试工具必须能导出：**

- 当前地图几何
- 当前导航数据
- 当前比赛快照
- 当前 AI 状态
- 当前事件日志

## 18. 测试计划

### 18.1 地图数据测试

**测试：**

- 所有区域多边形合法。
- 所有区域没有明显越界。
- 所有墙体碰撞多边形合法。
- 所有高地出生区域合法。
- 所有防御塔位置位于地图内。
- 所有中立营地位置位于合法区域。
- 三条路线可以连接左右两侧。
- 路线不会穿过禁止区域。
- 路线和塔的顺序正确。
- 地图版本和源图片哈希存在。

### 18.2 导航测试

**测试：**

- 起点到路线入口有路径。
- 路线入口到敌方目标有路径。
- 单位不能穿过高墙。
- 单位不能穿过普通墙。
- 单位不能跑出地图边界。
- 单位不能出现在塔内部。
- 单位不能出生在墙体内部。
- 技能位移不能落入非法区域。
- 追击失败后可以返回路线或营地。
- 大量单位存在时寻路耗时可接受。

### 18.3 AI 测试

**测试：**

- 出生后能够进入路线。
- 路线推进不会永久卡死。
- 目标死亡后可以切换目标。
- 目标超出追击范围后可以回退。
- 墙后目标不会导致无限寻路。
- 路线拥堵时可以等待或局部避让。
- 中立单位不会永久离开营地。
- 防御塔可以正确选择目标。
- AI 在固定随机种子下结果可复现。

### 18.4 部队系统集成测试

**测试：**

- 新地图不破坏现有部队数据表。
- 新地图不破坏现有技能。
- 位移遵守地图碰撞。
- 攻击和受击仍由现有战斗系统处理。
- 部队死亡后视觉对象正确清理。
- 部队重新出生后 ID 和状态正确。
- 用户已有的出生位置调整逻辑仍然有效。

### 18.5 持久化测试

**测试：**

- 刷新页面后恢复。
- 暂停后恢复。
- 重新进入训练营后恢复。
- 防御塔生命值恢复。
- 防御塔摧毁状态恢复。
- 中立营地重生时间恢复。
- 部队目标和技能冷却恢复。
- 待生成波次恢复。
- 地图版本变化后触发迁移。
- 损坏存档不会导致页面白屏。

### 18.6 在线模式准备测试

**即使当前尚未上线，也应测试：**

- 地图定义可以在服务端加载。
- 地图导航数据可以在服务端加载。
- 逻辑状态不依赖 DOM 或 Three.js。
- 同样的随机种子可以复现相同出生分配。
- 服务端快照可以重新生成客户端场景。
- 客户端不需要保存最终战斗结果。
- 地图版本不一致时客户端能够拒绝连接或请求正确版本。

## 19. 性能验收

**至少记录以下性能数据：**

- 首次打开训练营到显示基础地图的时间。
- 首次打开训练营到可操作的时间。
- 地图资源压缩前后大小。
- 首屏请求数量。
- 首屏 GPU 纹理内存。
- 地图切换前后 JS 堆变化。
- 20、50、100、200 个单位时的平均 FPS。
- 大量单位同时寻路时的单帧模拟耗时。
- 大量单位同时战斗时的单帧模拟耗时。
- 多个营地同时重生时的模拟耗时。
- 多个防御塔同时攻击时的模拟耗时。
- 页面退出地图后的资源释放情况。

**优化优先级：**

- 避免每个单位每帧全图寻路。
- 使用路线 waypoint 和局部重规划。
- 使用空间索引查询附近目标。
- 使用对象池。
- 复用 Geometry、Material 和 Texture。
- 使用 InstancedMesh 处理重复模型。
- 使用 LOD 处理远距离对象。
- 使用分帧 AI 更新。
- 将远距离单位降级为低频更新。
- 让高质量特效异步加载。
- 避免每帧创建临时数组、向量和事件对象。
- 地图静态数据只解析一次并缓存。

## 20. 代码实施纪律

**Codex 每完成一个阶段，必须提供：**

- 实际修改文件列表。
- 使用的现有系统接口。
- 新增的地图数据文件。
- 运行的测试命令。
- 测试结果。
- 地图截图或调试截图。
- 发现的问题。
- 尚未确定的假设。
- 下一阶段准备内容。

**必须遵守：**

- 先读取现有代码，再设计接口。
- 先复用已有部队和训练营逻辑。
- 不把地图规则写进 React/Vue/UI 组件。
- 不把地图状态写进 Three.js Mesh。
- 不把所有坐标硬编码到渲染文件。
- 不直接覆盖用户已有修改。
- 不引入没有必要的新框架。
- 不用远程资源作为基础地图依赖。
- 不为了视觉效果牺牲地图碰撞和寻路正确性。
- 不以“看起来像地图”作为完成标准。

## 21. 需要 Codex 自行判断和补齐的内容

**以下内容当前需求没有给出最终数值，由 Codex 结合项目现有系统补齐：**

- 地图世界尺寸。
- Three.js 单位比例。
- 高地实际高度。
- 道路实际宽度。
- 沙地移动效果。
- 防御塔生命值和攻击参数。
- 中立营地具体单位组成。
- 中立单位重生时间。
- 中立单位巡逻范围。
- 中立单位追击范围。
- AI 决策频率。
- AI 目标评分权重。
- 单位局部避让参数。
- 训练营默认波次间隔。
- 在线服务器 tick 频率。
- 客户端快照频率。
- 资源压缩格式。
- 高模和低模切换距离。
- 具体存储实现。
- 具体导航库。

**处理原则：**

- 优先查找现有系统是否已有配置。
- 优先使用当前游戏的单位和战斗参数。
- 缺失时增加地图专属配置。
- 所有新增数值必须集中管理。
- 不要将临时调试参数散落在组件中。
- 参数确定后写入地图文档和测试。
- 对会影响在线同步的参数记录版本。

## 22. 完成标准

**以下条件全部满足后，才算地图模块完成：**

- 参考图中的左右阵营结构正确。
- 四个高地被实现为双方部队出生区域。
- 默认出生位置能够随机且均衡分配。
- 用户已有出生位置编辑功能继续工作。
- 三条横向路线完整贯通。
- 中央纵向沙地区正确呈现并具有明确地图语义。
- 道路、草地和沙地在视觉层存在。
- 道路、草地和沙地在逻辑层可查询。
- 所有防御塔位置、阵营和路线归属正确。
- 所有中立单位/怪物标记均有对应营地或中立实体配置。
- 高墙和普通墙具有碰撞和导航阻挡。
- 部队可以从出生区进入路线。
- 部队能够沿路线推进。
- 部队能够绕过或处理合法障碍。
- AI 不再依赖简单直线移动。
- AI 具备基础目标选择、寻路、追击、回退和卡死恢复。
- 已有部队技能、位移和战斗系统没有被破坏。
- 防御塔能够攻击部队，也能够被部队攻击。
- 中立单位能够生成、巡逻、战斗、拉脱和重生。
- 地图状态可以保存和恢复。
- 逻辑状态与 Three.js 渲染对象分离。
- 代码结构能够支持未来服务端权威模拟。
- 基础地图不依赖远程资源。
- 大量单位下页面仍保持可用流畅。
- 地图资源和运行时对象能够正确释放。
- 具备地图调试覆盖层。
- 具备自动化测试。
- 具备旧地图回退或 feature flag。
- 参考图和实际 Three.js 截图完成叠加验收。

## 23. 参考资料

- [1] Recast Navigation JS
  https://github.com/isaac-mason/recast-navigation-js

- [2] Recast Navigation JS 示例
  https://codesandbox.io/p/github/eriksachse/recast-navigation-js

- [3] three-pathfinding
  https://www.npmjs.com/package/three-pathfinding

- [4] Three.js GLTFLoader
  https://threejs.org/docs/pages/GLTFLoader.html

- [5] Khronos glTF
  https://github.com/KhronosGroup/glTF

- [6] Three.js LOD
  https://threejs.org/docs/pages/LOD.html

- [7] MOBA 兵线和地图目标机制参考
  https://www.pulpcode.cn/2017/07/22/what-is-moba-line-of-soldiers/

- [8] 防御塔机制参考
  https://leagueoflegends.fandom.com/zh/wiki/防御塔

## 24. 最终执行顺序

**必须按照以下顺序执行：**

1. 审计现有代码
2. 确认图片和现有地图尺寸
3. 标注地图几何
4. 创建地图静态数据
5. 实现基础地形和墙体
6. 实现导航和碰撞
7. 接入四个高地出生区
8. 接入三条路线
9. 接入防御塔
10. 接入中立营地
11. 接入部队 AI 寻路和路线行为
12. 接入现有技能和战斗系统
13. 接入持久化
14. 接入资源加载和性能优化
15. 完成在线对战兼容改造
16. 完成测试和图片叠加验收

如果某个阶段发现参考图、现有代码或产品规则之间存在冲突，必须先记录冲突和实际判断依据，再继续实现。不能用默认 MOBA 地图规则替换参考图中的地图结构。
