# 星盘布局重构实施计划

## 目标

将当前星盘布局的核心求解逻辑重构为一套更稳定的分阶段算法，重点解决以下问题：

1. 分支及其后代压到其他簇的上方，形成明显重叠。
2. 节点与直线连线之间发生穿插，导致关系阅读困难。
3. 同层或跨层节点在局部区域过密，未能向更空的方向自然扩展。
4. 现有布局虽有全局惩罚，但缺少“主树骨架 + 簇级占位 + 子树递进摆放 + 全局修复”的明确阶段边界。

本次改造明确排除以下内容：

- 不修改连线渲染样式。
- 不修改 `+N` / boundary badge 的视觉样式与交互语义。
- 几何判定时统一把边视为直线段。

## 当前系统约束

- 布局入口仍为 `frontend/src/LayoutManager.js` 中的 `calculateStarMapLayout()`。
- 核心求解器仍为 `frontend/src/starMap/starMapForceLayout.js` 中的 `solveStarMapConstellationLayout()`。
- 输出结构不变，继续返回：
  - `bodyByKey`
  - `badgeBodyByStubId`
  - `bounds`
  - `debug`
- 前端渲染层、线条样式、`buildStarMapLineVisual()` 保持兼容。

## 总体算法

新的算法分为四个阶段：

1. 主树提取
2. 簇级扇区分配
3. 簇内前缀冻结布局
4. 全局修复

### 1. 主树提取

目的：

- 从原始图中抽出一棵稳定骨架，作为节点主位置的依据。
- 其余边保留为关联边，只参与评分，不直接决定主位置。

规则：

- 中心节点作为根。
- 每个非中心节点只选择一个 `primaryParent`。
- 优先从 `previousLevelNeighbors` 中选择。
- 选择顺序：
  1. 已经形成较稳定簇归属的父节点优先。
  2. 子树容量更大的父节点优先。
  3. 度更高的父节点优先。
  4. key 稳定排序兜底。

产出：

- `primaryParentByKey`
- `childrenByParent`
- `subtreeNodeCountByKey`
- `subtreeDemandByKey`

### 2. 簇级扇区分配

目的：

- 先解决一级簇之间的整体占位，避免大簇直接骑到别的簇头上。

簇定义：

- 所有 level=1 节点各自作为 `clusterRoot`。
- 某个节点归属其主树路径上的一级根簇。

每个簇的需求量包括：

- 可见节点数量
- 标签总面积
- 最大深度
- 外部关联边数量
- 外部关联方向
- boundary badge 数量

扇区分配目标：

- 大簇给更大的角宽。
- 关联强的簇尽量相邻。
- 同向关联尽量集中，减少跨中心穿越。
- 左右/上下整体尽量均衡。

产出：

- `clusterRootByKey`
- `clusterMetaByRoot`
- `sectorPlan`
  - `centerAngle`
  - `span`
  - `padding`
  - `preferredAngle`
  - `reservedCorridorPressure`

### 3. 簇内前缀冻结布局

目的：

- 把“树干节点 -> A -> B -> C，逐级固定前缀，再摆动后缀”明确化。
- 当某个非中心节点的子树需求突然膨胀时，允许其向上申请更多局部空间，而不是原地硬塞。

核心原则：

- 摆某个节点时，它到根的主树前缀节点全部视为冻结。
- 只允许移动当前子树还未冻结的部分。
- 候选位置在：
  - 本层 band
  - 本簇 wedge
  - 父节点局部展开扇面
  三者交集内搜索。

位置选择采用离散候选点评分，不采用单纯连续力迭代。

候选点评分包含：

- 节点与已有节点重叠罚分
- 直线边穿过已有节点罚分
- 直线边交叉罚分
- 偏离父节点主方向罚分
- 偏离簇扇区中心罚分
- 子树拉伸过长罚分
- 和跨簇关联目标方向偏离罚分

#### 3.1 子树空间需求上冒

每个节点除常规 `subtreeDemand` 外，还要额外计算：

- `requiredSpanByKey`
- `requiredRadiusByKey`

含义：

- `requiredSpanByKey`：该节点整棵子树在当前层级语义下最少需要的角宽。
- `requiredRadiusByKey`：该节点整棵子树若不想严重重叠，至少需要扩展到的半径。

计算方式：

- 叶子节点：由自身节点盒、标签盒、安全间距给出最小需求。
- 非叶子节点：综合
  - 自身盒占位
  - 子节点总 span
  - 子节点之间的最小 sibling gap
  - 子树的局部扩展深度

如果某节点的 `requiredSpanByKey > 当前 scope.span`，则认为该子树发生了 `overflow`。

#### 3.2 兄弟树让位

当某个节点发生 `overflow` 时，不立即重排整图，而是按以下顺序处理：

1. 先尝试压缩同级兄弟的局部 span。
2. 若仍不够，则将兄弟树作为刚体整体向两侧旋转让位。
3. 若仍不够，则把当前节点所在子树整体外推，提高局部半径。
4. 若父节点层面仍无法吸收，则继续向上冒泡。

兄弟树让位时，必须保持：

- 兄弟树内部相对位置不变。
- 只改变该树整体的 `centerAngle / scope.span / radialOffset`。
- 不允许打散已经冻结的主树前缀。

#### 3.3 一级簇让位

如果 `overflow` 一路冒泡到一级簇：

- 则允许相邻一级簇小幅压缩角宽。
- 允许一级簇整体向两侧旋转。
- 必要时对低耦合簇整体压到另一侧。

这一步的目标不是重新求全局最优，而是：

- 在保持一级簇相对稳定顺序的前提下，
- 给“爆量子树”让出一条足够宽的展开走廊。

无解时的升级策略：

1. 提高当前节点所在子树的半径
2. 放宽当前节点所在子树的局部角宽
3. 将整棵局部子树整体外推
4. 必要时触发相邻簇小幅让位

### 4. 全局修复

目的：

- 在局部合法的基础上做低扰动全局修正。

允许的修复动作：

1. 整个簇小角度旋转
2. 整个簇沿半径方向外推
3. 某个子树整体平移
4. 两个一级簇交换或局部挪位

禁止：

- 打散已经冻结的主树前缀关系
- 大幅改变一级簇顺序导致心智地图重置

## 需要准备的数据结构

### 基础图结构

- `primaryParentByKey`
- `childrenByParent`
- `depthByKey`
- `levelByKey`
- `crossEdges`

### 子树统计

- `subtreeNodeCountByKey`
- `subtreeLabelAreaByKey`
- `subtreeDemandByKey`
- `subtreeMaxDepthByKey`
- `requiredSpanByKey`
- `requiredRadiusByKey`
- `overflowByKey`

### 簇统计

- `clusterRootByKey`
- `clusterMembersByRoot`
- `clusterMetaByRoot`
- `clusterAdjacency`

### 几何辅助

- `bodyByKey`
- `segmentRecords`
- `occupiedRects`
- `occupiedCircles`
- `collisionGrid`
- `scopeByKey`
- `radialOffsetByKey`

## 代码实施顺序

### 阶段 A：计划与骨架

- 新建本计划文档。
- 保持 `LayoutManager` 输出结构不变。
- 在 `starMapForceLayout.js` 内引入新的分阶段求解函数。

### 阶段 B：主树与簇元数据

- 重写 `primaryParent` 选择逻辑。
- 明确构建 `childrenByParent`、`clusterRootByKey`、`subtreeDemandByKey`。
- 保留现有 `graphMeta`，但增加新的结构化元信息。

### 阶段 C：簇级扇区分配

- 基于簇需求和簇间耦合构建新的 `sectorPlan`。
- 输出更稳定的 wedge 中心角和角宽。

### 阶段 D：簇内前缀冻结布局

- 用新的递归/层级布局替换当前以连续力迭代为核心的种子摆放。
- badge 继续跟随 source node，但不改变视觉逻辑。
- 在正式摆放前增加 `requiredSpan` 计算与 scope 重排。
- 为 `overflow` 子树触发兄弟树让位和局部外推。

### 阶段 E：全局修复

- 在全部节点初摆结束后统一扫描：
  - 节点重叠
  - 线穿节点
  - 线线交叉
  - 簇侵入
- 做有限轮全局微调。

### 阶段 F：验证与收尾

- 确认 `LayoutManager` 和 renderer 接口未破坏。
- 运行前端构建或至少完成静态检查。
- 在 debug 中暴露新布局阶段信息，便于后续继续调权重。

## 验证标准

### 功能正确性

- 星盘仍能正常进入和渲染。
- 标题层、释义层都能产出布局。
- 节点点击、hover、原有线条视觉不被破坏。

### 布局质量

- 一级簇之间明显重叠显著减少。
- 主树分支不再轻易骑到其他簇的核心区域。
- 节点落在线段上的情况显著减少。
- 同一簇内部主干方向更稳定。

### 稳定性

- 相同输入下布局结果稳定。
- 小幅数据变化时，不出现整图大翻转。

## 风险点

- 现有代码大量依赖 `clusterRoot / primaryParent / sectorPlan`，替换时必须保留兼容字段。
- 完全移除连续力学迭代风险较高，因此本次更适合改为“离散布局为主 + 小幅修复”为辅。
- 释义层图比标题层更稠密，跨簇关联较多，需要对 `crossEdges` 降低硬约束权重。
- 如果 `requiredSpan` 估计过大，会导致整图被过度撑开；因此需要限制单次让位幅度和总冒泡层数。

## 本次实施边界

- 先完成新布局框架接入与可运行版本。
- 优先解决“分支跨簇压盖”和“节点/直线段明显几何冲突”。
- 渲染表现、曲线细节、badge 视觉不纳入本次变更。
