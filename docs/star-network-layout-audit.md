# 摘要

- 核心布局入口文件：
  - [App.js](/home/wkd/neruoWar/frontend/src/App.js#L2730)
  - [KnowledgeViewRouter.js](/home/wkd/neruoWar/frontend/src/components/game/KnowledgeViewRouter.js#L90)
  - [NodeDetail.js](/home/wkd/neruoWar/frontend/src/components/game/NodeDetail.js#L294)
  - [SceneManager.js](/home/wkd/neruoWar/frontend/src/SceneManager.js#L219)
  - [LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L445)

- 最可能导致三个问题的关键模块：
  - [starMapForceLayout.js](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L716)
  - [starMapLayoutHelpers.js](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L527)
  - [WebGLNodeRenderer.js](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L852)
  - [starMapTraversalService.js](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L234)
  - [LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L633)

本次审计结论可以先概括为一句话：当前“星盘/知识网络”不是纯力导向，也不是严格环形布局，而是“后端 BFS 截断图 + 前端分层软半径带 + cluster anchor 种子 + 局部力迭代 + 渲染阶段再额外加曲线”的混合实现。三个问题中，前两个主要是布局阶段缺少“换侧/空侧再分配/全局评分”的结果，第三个则同时来自布局与渲染不一致：求解器优化的是直线弹簧，屏幕上真正画出来的是裁剪后的二次曲线。

# 1. 审计范围与目标

本次审计只针对当前仓库中首页进入后的“知识域星盘/知识网络”实现链路，不涉及代码修改，不提供补丁，只说明当前真实实现。

聚焦问题：

1. 节点被放到了中心节点“错误的一侧”，导致连线穿过中心附近或被大节点遮挡。
2. 某一侧已经拥挤，但布局仍继续把节点塞到这一侧，没有切换到更空的一侧。
3. 节点压在线上，或者最终绘制出来的边看起来像穿过节点，影响用户判断连接关系。

不在本次核心链路内但容易混淆的模块：

- [KnowledgeDomainScene.js](/home/wkd/neruoWar/frontend/src/components/game/KnowledgeDomainScene.js#L907) 是知识域经营/城市场景，不是当前星盘渲染器。
- [Home.js](/home/wkd/neruoWar/frontend/src/components/game/Home.js#L190) 首页展示的是 `HexDomainGrid` 六边形总览，不是星盘布局算法本体。

# 2. 相关文件总览

| 文件 | 角色 | 与本次问题的关系 |
| --- | --- | --- |
| [frontend/src/App.js](/home/wkd/neruoWar/frontend/src/App.js#L2715) | 星盘模式状态、接口请求、进入/退出星盘、节点点击后二次居中 | 数据入口、模式切换入口 |
| [frontend/src/components/game/KnowledgeViewRouter.js](/home/wkd/neruoWar/frontend/src/components/game/KnowledgeViewRouter.js#L55) | 把 `home / titleDetail / nodeDetail` 路由到 `Home` 或 `NodeDetail` | 页面入口分发 |
| [frontend/src/components/game/NodeDetail.js](/home/wkd/neruoWar/frontend/src/components/game/NodeDetail.js#L294) | 挂载 WebGL canvas 的详情页容器 | 星盘页面宿主组件 |
| [frontend/src/SceneManager.js](/home/wkd/neruoWar/frontend/src/SceneManager.js#L219) | 调用布局器、应用过渡动画、设置 renderer 数据、根据 bounds 平移镜头 | 布局结果到渲染器的桥梁 |
| [frontend/src/LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L445) | `calculateStarMapLayout()`：把图数据转成布局节点和布局线 | 前端星盘布局总入口 |
| [frontend/src/starMap/starMapHelpers.js](/home/wkd/neruoWar/frontend/src/starMap/starMapHelpers.js#L1) | 标题层/释义层 key、centerKey、levelMap 解析 | 数据键体系 |
| [frontend/src/starMap/starMapLayoutHelpers.js](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L187) | 文本尺寸估算、图元 meta、线样式、stub 样式 | 文本占位与线视觉参数 |
| [frontend/src/starMap/starMapForceLayout.js](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L716) | 真正的节点坐标求解器 | 三个问题的核心来源之一 |
| [frontend/src/WebGLNodeRenderer.js](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1324) | WebGL 节点/线渲染、overlay 曲线、标签层、命中测试、平移 | 连线遮挡与“线穿节点”的核心来源之一 |
| [frontend/src/App.css](/home/wkd/neruoWar/frontend/src/App.css#L2738) | `webgl-node-label-layer` 等层级样式 | 标签、overlay、canvas 的视觉层级 |
| [frontend/src/components/game/NodeDetail.css](/home/wkd/neruoWar/frontend/src/components/game/NodeDetail.css#L73) | 详情页场景容器和 canvas 层级 | 节点/标签/面板的宿主层级 |
| [backend/routes/nodes.js](/home/wkd/neruoWar/backend/routes/nodes.js#L6088) | `title-star-map` / `sense-star-map` HTTP 接口 | 图数据 API 出口 |
| [backend/services/starMapTraversalService.js](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L234) | 标题层与释义层 BFS 遍历、边聚合、boundary stub 生成 | 原始图的形成方式 |
| [backend/services/gameSettingsService.js](/home/wkd/neruoWar/backend/services/gameSettingsService.js#L31) | 星盘节点上限配置 | BFS 截断上限 |

补充说明：

- [frontend/src/components/game/Home.js](/home/wkd/neruoWar/frontend/src/components/game/Home.js#L193) 只负责首页六边形总览入口。
- [frontend/src/components/game/KnowledgeDomainScene.js](/home/wkd/neruoWar/frontend/src/components/game/KnowledgeDomainScene.js#L907) 与本次星盘布局无直接调用关系。

# 3. 当前渲染架构

## 3.1 页面入口与视图切换

顶层 UI 在 [App.js](/home/wkd/neruoWar/frontend/src/App.js#L4365) 渲染 [KnowledgeViewRouter.js](/home/wkd/neruoWar/frontend/src/components/game/KnowledgeViewRouter.js#L7)。

- `view === 'home'` 时，走 [Home.js](/home/wkd/neruoWar/frontend/src/components/game/Home.js#L17)。
- `view === 'titleDetail'` 或 `view === 'nodeDetail'` 时，走 [NodeDetail.js](/home/wkd/neruoWar/frontend/src/components/game/NodeDetail.js#L6)。
- `knowledgeMainViewMode === 'starMap'` 时，`NodeDetail` 仍是宿主组件，但内容切到星盘模式；真正的数据与布局来自 `titleStarMapData / nodeStarMapData`。

## 3.2 星盘模式的状态切换

在 [App.js](/home/wkd/neruoWar/frontend/src/App.js#L3522) 里，鼠标滚轮触发星盘模式切换：

```js
if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.MAIN && deltaY > 0) {
  enterStarMapMode();
}

if (knowledgeMainViewMode === KNOWLEDGE_MAIN_VIEW_MODE.STAR_MAP && deltaY < 0) {
  exitStarMapMode();
}
```

这意味着：

- 星盘模式本身不提供缩放。
- 滚轮被拿来做“进入/退出星盘”。
- 星盘内真正支持的是平移，不是拖节点，不是缩放。

## 3.3 数据流总链路

标题层星盘链路：

1. [App.js `fetchTitleStarMap()`](/home/wkd/neruoWar/frontend/src/App.js#L2730) 请求 [backend/routes/nodes.js `/public/title-star-map/:nodeId`](/home/wkd/neruoWar/backend/routes/nodes.js#L6088)
2. 路由调用 [traverseTitleStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L234)
3. 后端返回 `graph = { centerNode, nodes, edges, levelByNodeId, boundaryStubs, effectiveLimit }`
4. [App.js](/home/wkd/neruoWar/frontend/src/App.js#L2768) 把 `graph` 放入 `titleStarMapData`
5. [App.js useEffect](/home/wkd/neruoWar/frontend/src/App.js#L3502) 调 [SceneManager.showStarMap('titleDetail', titleStarMapData)](/home/wkd/neruoWar/frontend/src/SceneManager.js#L219)
6. [SceneManager.js](/home/wkd/neruoWar/frontend/src/SceneManager.js#L229) 调 [LayoutManager.calculateStarMapLayout()](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L445)
7. [LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L556) 调 [solveStarMapConstellationLayout()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L716)
8. `LayoutManager` 产出 `layout.nodes / layout.lines / layout.bounds`
9. [SceneManager.setLayout()](/home/wkd/neruoWar/frontend/src/SceneManager.js#L384) 把节点与边塞给 [WebGLNodeRenderer](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L342)
10. renderer 再把“世界坐标”通过 `camera.offsetX / offsetY / zoom` 映射到屏幕坐标

释义层星盘链路相同，只是接口与 key 体系换成：

- [App.js `fetchSenseStarMap()`](/home/wkd/neruoWar/frontend/src/App.js#L2801)
- [backend/routes/nodes.js `/public/sense-star-map/:nodeId`](/home/wkd/neruoWar/backend/routes/nodes.js#L6168)
- [traverseSenseStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L339)
- key 从 `nodeId` 变为 `nodeId::senseId`

## 3.4 后端是否参与具体位置计算

不参与。

后端只负责：

- 选出哪些节点与边进入星盘
- 给每个节点一个 BFS level
- 给出被截断的 `boundaryStubs`

后端不负责：

- 左右侧/上下侧
- 角度分配
- 半径带细化
- 碰撞与避让
- 曲线连线

也就是说，用户看到的“节点为什么在这一侧”主要是前端布局器决定的，不是后端 BFS 决定的。

# 4. 当前布局算法详解

## 4.1 图数据的预处理范式

### 标题层

[traverseTitleStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L234) 是典型 BFS：

- `levelByNodeId[center] = 0`
- `frontier` 按层推进
- 每轮只把尚未纳入的邻居加入 `nextFrontier`
- 总节点数达到 `limit` 就不再继续展开

关键代码：

```js
while (frontier.length > 0 && includedNodeIds.length <= limit) {
  ...
  if (includedNodeIds.length < limit && !queuedSet.has(neighborNodeId)) {
    levelByNodeId[neighborNodeId] = currentLevel + 1;
    includedNodeIds.push(neighborNodeId);
    ...
  }
}
```

来源关系：

- 如果启用了 `DomainTitleProjection`，从 projection store 读关系
- 否则退回 `Node.associations`

因此标题层星盘的“图”本质上是：

- 无向聚合边
- BFS level
- 截断后的 boundary stub

### 释义层

[traverseSenseStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L339) 也是 BFS，但顶点不是 node，而是 `nodeId::senseId`：

```js
const centerVertexKey = toVertexKey(safeCenterNodeId, centerSense?.senseId || '');
const levelByVertexKey = { [centerVertexKey]: 0 };
```

释义层还会：

- 对每个 node 选一个 `activeSenseId`
- 用 `assoc.sourceSenseId / targetSenseId` 定位顶点
- 如果关系里没写 senseId，则回退到该 node 的默认 sense

这意味着释义层的图比标题层更细，但同样只返回 BFS 层级，不返回角度或位置建议。

## 4.2 前端布局阶段 1：中心节点固定

[LayoutManager.calculateStarMapLayout()](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L445) 一开始就固定中心点：

```js
const yOffset = 42;
const centerX = this.centerX;
const centerY = this.centerY + yOffset;
```

中心节点半径：

```js
const centerRadius = Math.max(32, Math.min(42, Math.min(this.width, this.height) * 0.04));
```

结论：

- 中心节点不是通过优化求出来的，而是硬固定在视口中心偏下 `42px`。
- 后面的 `applyStarMapFraming()` 只会整体平移 camera，让整个内容框居中；不会改变中心节点在布局坐标系里的相对地位。

## 4.3 前端布局阶段 2：按 BFS level 建软半径带

`levelByKey` 来自后端 BFS，但 [LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L554) 明确写了：

```js
// starMap 不再把 BFS level 直接投影成硬圆环。
// 这里让 level 只作为“软半径带”约束，再用轻量迭代求解把标签盒也纳入碰撞体。
```

具体带宽计算在 [buildBandByLevel()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L165)：

- 起始 `cursor = centerRadius + 28 * spreadFactor`
- 每层的 `bandThickness` 由平均节点半径、平均 label 高度、平均 label 宽度混合决定
- 厚度被 clamp 到 `58 ~ 124`
- 每层的 `min / ideal / max` 都是连续数值，不是死环

所以：

- 一层、二层、多层节点只是“倾向于”落在某一圈带上
- 不是严格环
- 后续力迭代可以在带内左右和前后移动

## 4.4 前端布局阶段 3：节点大小与文本尺寸预估

### 文本测量

[estimateStarMapLabelMetrics()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L187) 没有读取真实 DOM 尺寸，而是自己估算：

- 先按字符类型估算“字宽单位”
- 再通过 `chooseBalancedWrap()` 尝试 1~3 行（标题）和 1~2 行（sense）
- 输出 `widthHint / heightHint / lineCount / titleLines / senseLines`

这是一套启发式估计，不是真实浏览器排版测量。

### 节点视觉半径

[LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L536) 先给基础半径：

- 标题层：`baseNodeRadius = 28`
- 释义层：`baseNodeRadius = 25.5`
- 层级每加一层，最多减 `0.72 * 4`
- 最小不低于 `19`

随后 [starMapForceLayout.js](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L488) 再按 importance 放大：

```js
const scaledRadius = (Number(node.radius) || 12) * importance;
```

importance 由：

- level
- degree
- childCount
- boundaryCount

共同决定。

### 参与碰撞的半径

真正用于避让的不是单纯视觉圆半径，而是：

```js
const collisionRadius = Math.max(
  scaledRadius * 0.94,
  Math.hypot(labelMetrics.widthHint * 0.5, labelMetrics.heightHint * 0.5) * 0.72
);
```

以及更大的 `safetyRadius`。

结论：

- 布局阶段已经把文本 hint 计入碰撞体。
- 但这是“估算尺寸”，不是 DOM 实测。
- 渲染阶段裁剪连线时仍只用视觉圆半径，不用 `collisionRadius` 或 label rect。

## 4.5 前端布局阶段 4：cluster 分配

### cluster root 如何来

[buildClusterAssignments()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L241) 先把一层节点按 degree 排序，每个一层节点自己就是 cluster root。

更深层节点则通过 [pickPrimaryParent()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L229) 选父簇：

```js
const primaryRoot = pickPrimaryParent(parents, clusterRootByKey);
```

规则不是“几何上最适合哪侧”，而是：

- 看它连接到了哪些父节点
- 统计父节点分别属于哪个 cluster root
- 票数高的 root 获胜

也就是说，cluster 是按父链归属感形成的，不是按屏幕空位形成的。

### cluster anchor 如何摆放

[buildClusterAnchors()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L315) 用黄金角分布 + 稳定哈希扰动：

```js
const angle = GOLDEN_ANGLE * index + unit * 0.7;
const radius = minAnchorRadius + (maxAnchorRadius - minAnchorRadius) * radialUnit;
anchors.set(cluster.rootKey, {
  x: center.x + Math.cos(angle) * radius,
  y: center.y + Math.sin(angle) * radius,
  angle,
  radius
});
```

这里非常关键：

- cluster 的初始角度来自 `index` 与稳定哈希
- `index` 来自 cluster 的 `spreadScore` 排序
- 没有任何“右侧太挤则换左侧”的逻辑
- 也没有“该节点在中心另一侧更通顺”的显式判断

后续只做了 22 次 anchor 之间的相互排斥，以免 cluster anchor 自己互相太近，但这仍然只是局部修正。

## 4.6 前端布局阶段 5：seed bodies

[buildSeedBodies()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L390) 是实际种子点生成器。

### 对没有 parentBody 的节点

它们主要沿 cluster anchor 的方向放置，再叠加稳定扰动：

```js
let x = center.x + direction.x * seedDistance + tangent.x * (scatterX * 0.56);
let y = center.y + direction.y * seedDistance + tangent.y * (scatterX * 0.56) + scatterY * 0.12;
```

其中：

- `direction` 来自 cluster anchor 指向
- `scatterX / scatterY` 来自稳定 hash + 黄金角
- `radialBias` 也是稳定 hash 生成

这不是随机数，但属于“确定性的伪随机扰动”。

### 对有 parentBody 的节点

它们会明显继承父节点方向：

```js
x = parentBody.x + parentDirection.x * branchGap + parentTangent.x * (lateralGap + childSpread * 10);
y = parentBody.y + parentDirection.y * branchGap + parentTangent.y * (lateralGap + childSpread * 10);
```

这里体现了当前系统的一个强启发式：

- 子节点优先跟着父节点所在半侧生长
- 同父兄弟只在父切线方向上做左右偏移

这会天然增强“已经在右边的一簇继续往右边长”的趋势。

## 4.7 前端布局阶段 6：选择 primary parent

在 [solveStarMapConstellationLayout()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L738) 里，`primaryParentByKey` 的选法是：

```js
const bestParent = parents
  .map((parentKey) => ({
    parentKey,
    childCount: graphMeta.nextLevelNeighbors.get(parentKey)?.size || 0,
    degree: graphMeta.adjacency.get(parentKey)?.size || 0
  }))
  .sort((left, right) => (
    right.childCount - left.childCount
    || right.degree - left.degree
    || String(left.parentKey).localeCompare(String(right.parentKey))
  ))[0];
```

即：

- 优先 childCount 大的父
- 再看 degree
- 再按 key 排序

这里也没有：

- 线是否会穿中心
- 哪一侧更空
- 哪个父方向更顺

所以子节点“跟谁走”更多是图结构上的局部启发式，不是全局几何最优。

## 4.8 前端布局阶段 7：128 次局部力迭代

求解器核心循环在 [starMapForceLayout.js](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L812)。

它每轮主要做这些事：

1. 把节点拉回自己的 radial band
2. 把节点轻微拉回 seed 位置
3. 同 cluster 节点向 cluster centroid 轻微靠拢
4. 避免压进中心节点和中心 label
5. 按 adjacency 建 spring，保持边长度
6. 做“节点与无关边”避让
7. 做“边与边交叉”避让
8. 做 node-node、label-label、node-label 排斥
9. 加一个 outward spread

### 重要事实 1：这是局部迭代，不是全局换侧搜索

求解器没有任何“试着把这个簇翻到另一边再比较成本”的逻辑。

它只做四次 spread 尝试：

```js
const attempts = [1, 1.18, 1.36, 1.58];
```

然后选 penalty 最低的那次。

这四次尝试改变的是整体带宽/扩散倍率，不是半球翻转或节点换侧。

### 重要事实 2：当前 penalty 也是直线模型

[measureLayoutPenalty()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L613) 测的是：

- label-rect overlap
- node-circle / label-rect 关系
- node-node 距离
- spring 之间的直线段相交

这里的 `spring` 是从节点中心到节点中心的直线段，不是屏幕最终那条二次曲线。

## 4.9 当前实现属于什么布局范式

严格说，它是：

- 后端：BFS 截断分层图
- 前端：自定义 radial-band layout
- cluster anchor：黄金角分散
- 节点落点：parent-inherited seeding
- 优化：轻量局部力迭代

它不是：

- 纯圆环均匀布局
- 纯 d3-force
- dagre / 层次有向图
- 正式的约束优化或 MILP
- 有全局代价搜索的 hemisphere assignment

# 5. 当前连线算法详解

## 5.1 数据层边是怎么生成的

### 标题层

[traverseTitleStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L247) 会把多条关系聚合成一条无向 edge：

- `edgeId = nodeAId|nodeBId`
- 记录 `pairCount / containsCount / extendsCount`

### 释义层

[traverseSenseStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L371) 也聚合成无向 edge：

- `edgeId = minVertex|maxVertex`
- 记录 `pairCount / containsCount / extendsCount`

### 重要点

这些强度信息在布局阶段几乎不用来决定位置，只在视觉样式里使用。

也就是说：

- 强关系不会优先决定角度
- 强关系不会优先决定左右侧
- 强关系主要只影响线颜色、线宽、透明度、curve strength

## 5.2 布局阶段给边附加的视觉参数

[LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L633) 在把 edge 转为 `layout.lines` 时，会调用：

- [buildStarMapEdgeColor()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L320)
- [buildStarMapLineVisual()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L527)

`buildStarMapLineVisual()` 输出：

- `curveOffset`
- `lineOpacity`
- `glowOpacity`
- `lineWidth`
- `glowWidth`
- `drawOrder`
- `lineVariant`

问题在于，这里决定的是“怎么画”，不是“是否换侧重排节点”。

## 5.3 屏幕上实际画的不是单一线制

当前边有两套画法。

### 第一层：WebGL 直线

[render()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1324) 先调 [renderLines()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1419)。

`renderLines()` 画的是 GL 直线段：

```js
const segment = this.getVisibleLineSegment(fromNode, toNode, { insetPx: 2, minLengthPx: 1 });
...
gl.drawArrays(gl.LINES, 0, 2);
```

### 第二层：overlay canvas 上的二次曲线

之后 [renderLabels()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1812) 末尾会调 [renderOverlayCanvas()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1987)，其中 [renderLineGlowTrails()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L2006) 真正给用户看到的是二次曲线：

```js
const geometry = this.getCurvedLineGeometry(segment, line);
ctx.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.end.x, geometry.end.y);
```

结论：

- 底层 core line 是直线
- 上层发光主观感知线是二次 Bezier（准确说是 quadratic curve）
- 命中裁剪与惩罚主要基于直线
- 用户视觉主要看到曲线

这是本系统里最关键的“布局-渲染不一致”点之一。

## 5.4 连线起终点如何取值

[getVisibleLineSegment()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L852) 先把 node center 转为 screen 坐标，再按节点圆半径裁剪：

```js
const fromRadius = this.getNodeScreenRadius(fromNode);
const toRadius = this.getNodeScreenRadius(toNode);
const fromOffset = Math.max(0, Math.min(Math.max(0, fromRadius - insetPx), centerDistance * 0.45));
const toOffset = Math.max(0, Math.min(Math.max(0, toRadius - insetPx), centerDistance * 0.45));
```

注意：

- 这里只知道“圆半径”
- 不知道 label rect
- 不知道第三个节点
- 不知道最终 curve 会往哪边弯

所以裁剪只对“直线端点”有效，不对“弯曲后的真实路径”有效。

## 5.5 曲线控制点如何生成

[getCurvedLineGeometry()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L920) 用 segment 中点 + 法线偏移：

```js
const midX = (segment.start.x + segment.end.x) * 0.5;
const midY = (segment.start.y + segment.end.y) * 0.5;
const normalX = -dy / length;
const normalY = dx / length;
const maxOffset = Math.max(0, length * 0.22);
const curveOffset = Math.max(-maxOffset, Math.min(maxOffset, Number(line?.curveOffset) || 0));
```

这说明：

- curve 是单控制点二次曲线
- 最大偏移量只限制为线段长度的 `22%`
- 但这个偏移并没有反馈回布局求解器重新检查 edge-node overlap

## 5.6 是否避让节点

### 渲染阶段

没有。

渲染阶段只：

- 裁掉 source/target 的端点
- 然后直接画曲线

不会：

- 检测曲线是否穿过中心节点
- 检测曲线是否穿过第三方节点
- 检测曲线是否压到 label box

### 求解阶段

有“直线弹簧”的局部避让，但对象不是最终曲线。

[starMapForceLayout.js](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L907) 注释写得很直接：

```js
// 节点与“无关边”避让：
// 如果节点或它的标签占地压到别人的边上，就同时推开节点和边的端点，
// 尽量减少“节点坐在线上”的读图障碍。
```

但真正计算是：

```js
const segmentDistance = distancePointToSegment(body, start, end);
```

`body` 只提供节点中心 `x / y`，不是 label rect 多边形，也不是最终曲线。

## 5.7 是否根据节点大小做裁剪

只根据 source/target 节点的视觉圆半径裁剪，见 [getVisibleLineSegment()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L852)。

没有根据：

- `collisionRadius`
- `safetyRadius`
- `labelWidthHint / labelHeightHint`
- 真实 DOM label box

做裁剪。

## 5.8 是否有 edge bundling / edge offset / edge layering

有很轻量的“视觉偏移”，没有真正的 bundling。

有的：

- `curveOffset`
- `drawOrder`
- `lineVariant`
- 虚线桥接（cross-cluster / title-bridge）
- opacity / glow / width 差异

没有的：

- edge bundling
- obstacle routing
- orthogonal/polyline pathfinding
- 多边平行偏移通道

## 5.9 渲染顺序与遮挡

### 代码调用顺序

[render()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1336)：

```js
this.renderLines();
this.renderNodes();
this.renderNodeButtons();
this.renderLabels();
```

### 实际视觉顺序

1. WebGL canvas 里的直线
2. WebGL canvas 里的节点 sprite
3. WebGL canvas 里的按钮底片
4. overlay canvas 里的曲线 glow / caps / 按钮图标
5. DOM label layer
6. 页面上的 top panel / 星盘 badge

对应层级：

- [NodeDetail.css](/home/wkd/neruoWar/frontend/src/components/game/NodeDetail.css#L73)：`.webgl-canvas { z-index: 1 }`
- [WebGLNodeRenderer.js](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1778)：overlay canvas `zIndex = 1`
- [App.css](/home/wkd/neruoWar/frontend/src/App.css#L2738)：`.webgl-node-label-layer { z-index: 2 }`
- [NodeDetail.css](/home/wkd/neruoWar/frontend/src/components/game/NodeDetail.css#L64)：top panel `z-index: 3`

结论：

- 直线 core 一定在节点下面。
- overlay 曲线会在 WebGL 节点上面。
- 标签一定在曲线上面。

所以“边被中心节点盖住”和“边像穿过节点”在这个系统里是可能同时发生的，因为两层边的画法并不一致。

# 6. 当前碰撞与避让机制

## 6.1 node-node collision

有。

在 [starMapForceLayout.js](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L1034)：

- 使用 `collisionRadius`
- 叠加 `safetyRadius`
- `distance < nodeGap` 时强推开
- `distance < softField` 时弱推开

这属于节点圆形近似的排斥，不是精确多边形。

## 6.2 label collision

有，但基于估算矩形。

相关函数：

- [buildLabelRect()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L113)
- [measureLayoutPenalty()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L617)
- [force loop label overlap](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L1063)

特点：

- label rect 来自 `labelWidthHint / labelHeightHint`
- 不是浏览器排版后的真实 DOM rect

## 6.3 node-label collision

有。

通过 `circleHitsRect()` 检查节点圆与别人的 label rect：

- [circleHitsRect()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L43)
- 用在 [measureLayoutPenalty()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L632)
- 也用在迭代环的 [1074-1085](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L1074)

## 6.4 edge-node collision

部分有，但只针对“直线弹簧”，不是最终曲线，也不是 label polygon。

见 [starMapForceLayout.js:907-956](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L907)。

缺失点：

- 没有对 quadratic curve 做 intersection
- 没有对 node label rect 与 edge path 做精确检测
- 没有渲染阶段二次检查

## 6.5 edge-edge crossing control

部分有，同样只对直线弹簧生效。

见：

- [computeSegmentIntersection()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L83)
- [edge-edge crossing forces](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L959)
- [measureLayoutPenalty()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L648)

缺失点：

- 不检测最终二次曲线之间是否相交
- 不检测 curved edge 与 curved edge 的真实 crossing

## 6.6 文本测量是否用真实渲染尺寸

没有。

当前是“估算布局尺寸 + 运行时按 fontSize 渲染 DOM label”。

布局用：

- [estimateStarMapLabelMetrics()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L187)

运行时渲染用：

- [renderLabels()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1887)

两者之间并不是同一个测量源。

## 6.7 当前避让机制能覆盖什么，不能覆盖什么

能覆盖的：

- node-node
- label-label
- node-label
- 直线 edge-node
- 直线 edge-edge

不能覆盖的：

- 曲线 edge-node
- 曲线 edge-edge
- label-edge
- 根据空侧做全局再分配
- “把一个 cluster 从右侧整体翻到左侧”这种离散决策

# 7. 三个问题的直接代码成因

## 7.1 问题 1：节点在“错误的一侧”，连线穿中心或被大节点遮挡

### 直接代码原因 A：cluster 初始半侧由黄金角 + 稳定哈希决定，不看中心遮挡

来源：

- [buildClusterAnchors()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L315)

关键代码：

```js
const angle = GOLDEN_ANGLE * index + unit * 0.7;
```

含义：

- cluster 的初始方向是确定性伪随机分散
- 没有任何“该簇如果放左上会挡住中心线，换到右下更合适”的判断

这会直接导致：

- 一个节点或一簇节点明明换到中心另一侧更顺，但仍被稳定地种在当前侧

### 直接代码原因 B：子节点继承父方向，而不是对全局几何重新选侧

来源：

- [buildSeedBodies()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L521)

关键代码：

```js
x = parentBody.x + parentDirection.x * branchGap + parentTangent.x * (...);
y = parentBody.y + parentDirection.y * branchGap + parentTangent.y * (...);
```

含义：

- 子节点主要沿父方向继续外长
- 兄弟节点只做切线散开

结果：

- 如果父簇已经在“错误的一侧”，后代会一起延续到那一侧

### 直接代码原因 C：求解器没有“镜像/换侧”离散搜索

来源：

- [solveStarMapConstellationLayout()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L1124)

关键代码：

```js
const attempts = [1, 1.18, 1.36, 1.58];
```

它只尝试不同 `spreadFactor`，不尝试：

- 左右翻转 cluster
- 把某节点从右侧改派到左侧
- 比较不同半球占位方案的总代价

所以当前系统没有真正的“换侧”逻辑。

### 直接代码原因 D：即便布局结果欠佳，渲染顺序也会放大遮挡

来源：

- [render()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1336)
- [renderNodes() 中中心节点多层 glow](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1567)

当节点被布局到错误一侧时，边更可能靠近中心。此时：

- WebGL 直线先画
- 中心节点后画
- 中心节点还会画比本体更大的 glow/shell

所以中心附近的边更容易被盖住。

### 对应结论

问题 1 不是单一 bug，而是以下组合结果：

1. `buildClusterAnchors()` 的半侧分配不看遮挡
2. `buildSeedBodies()` 的父方向继承强化现有半侧
3. `solveStarMapConstellationLayout()` 没有换侧搜索
4. `render()` 的线下节点上渲染顺序让中心遮挡更明显

## 7.2 问题 2：某一侧已经很挤，系统仍继续往这一侧放

### 直接代码原因 A：cluster 是按父根归属，不按空侧分流

来源：

- [buildClusterAssignments()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L241)

更深层节点会继承 dominant parent root，而不是检查哪边更空。

结果：

- 同 root / 同 parent chain 的节点会持续被吸附在同一 cluster
- 只要这个 cluster anchor 在右侧，后续节点仍会在右侧附近展开

### 直接代码原因 B：求解器有 cluster centroid 吸引，没有左右半区容量控制

来源：

- [force loop cluster centroid attraction](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L844)

关键代码：

```js
force.x += (clusterCentroid.x - body.x) * 0.014;
force.y += (clusterCentroid.y - body.y) * 0.014;
```

这会把 cluster 成员往自己的簇质心拉回。

系统没有类似：

- left/right occupancy score
- hemisphere density penalty
- “空侧优先”再分配

### 直接代码原因 C：`graphMeta` 只记录邻接，不记录边强度权重用于布局

来源：

- [buildStarMapGraphMeta()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L246)

它只构建：

- `adjacency`
- `previousLevelNeighbors`
- `nextLevelNeighbors`
- `sameLevelNeighbors`
- `boundaryCountByKey`

没有把 `pairCount / containsCount / extendsCount` 转成布局权重。

结果：

- 哪怕右侧堆了一堆彼此关联并不强的节点，布局也不会因为“这些边很弱，可以拆散到左侧”而主动重排

### 直接代码原因 D：当前力迭代是连续位移，不是离散分槽

当前所有优化都是：

- 推一点
- 拉一点
- repel 一点

这类连续优化擅长“稍微挪开”，不擅长：

- 从右边整簇搬到左边
- 从一个 cluster 重新分派到另一个半区

### 对应结论

问题 2 的根本原因是：当前系统根本没有“空侧优先”的目标函数。

能找到的只有：

- cluster 归属
- 局部排斥
- 弹簧张力

找不到的有：

- 左右侧 occupancy 统计
- hemisphere capacity
- slot filling / bin packing
- “右侧过载则换左侧”的代码

## 7.3 问题 3：节点压在线上，或者线看起来穿过节点

### 直接代码原因 A：求解器优化的是直线，屏幕上画的是曲线

来源：

- [求解器 springs](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L786)
- [renderLineGlowTrails()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L2006)

求解时：

- edge-node 避让按中心点到直线段距离算
- edge-edge 交叉按直线段相交算

渲染时：

- `curveOffset` 再把直线弯成二次曲线

这会直接造成：

- 直线模型下“不碰撞”
- 最终曲线视觉上却穿过第三方节点或中心区域

### 直接代码原因 B：连线端点裁剪只看 source/target 的圆半径

来源：

- [getVisibleLineSegment()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L852)

它不知道：

- 第三个节点的碰撞体
- source/target 的 label 宽度
- 曲线控制点会把路径拉向哪里

所以裁剪不可能防住“线中段弯进别的节点”。

### 直接代码原因 C：edge-node 避让对 label 只做了宽度近似，没有做 label-edge intersection

来源：

- [starMapForceLayout.js:923-929](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L923)

关键逻辑：

```js
const clearance = Math.max(
  18,
  (body.collisionRadius || body.radius || 18) + Math.min(18, (body.labelWidthHint || 96) * 0.05)
);
const segmentDistance = distancePointToSegment(body, start, end);
```

这里没有把 `body.labelRect` 与 edge 做真正几何求交，只是：

- 用 body center 作为点
- 用一个混合 clearance 近似

这解释了为什么仍然会出现：

- 线压到 label 可读区
- 看起来像穿字或穿节点

### 直接代码原因 D：overlay 曲线画在 WebGL 节点之上

来源：

- [overlay canvas 创建](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1778)
- [App.css label layer](/home/wkd/neruoWar/frontend/src/App.css#L2738)

由于 overlay canvas 在 WebGL canvas 之上，曲线 glow 可以直接覆盖节点面片。

所以视觉上会更容易出现：

- “线穿过节点”
- “线和节点边界纠缠”

尤其当 curveOffset 较大时更明显。

### 直接代码原因 E：edge-node / edge-edge 控制不包含 boundary stub 与真实曲线

`boundaryStubs` 只是后面单独画出来的 stub line：

- [LayoutManager.js boundary stubs](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L672)
- [buildStarMapStubVisual()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L659)

stub line 不参与前面那套 spring 求解，因此它们也没有经过同等级别的避障。

### 对应结论

问题 3 既是布局问题，也是渲染问题，但渲染不一致是更直接的放大器：

1. 布局阶段只对直线做局部避让
2. 渲染阶段再把线弯成曲线
3. 曲线又画在节点之上

# 8. 当前可调参数清单

以下是当前实现里直接影响布局/连线/层级的关键常量与参数。

## 8.1 后端图规模

| 参数 | 默认值 | 位置 | 作用 |
| --- | --- | --- | --- |
| `DEFAULT_STAR_MAP_NODE_LIMIT` | `50` | [gameSettingsService.js:5](/home/wkd/neruoWar/backend/services/gameSettingsService.js#L5) | 星盘默认节点上限 |
| `effectiveLimit` | `10 ~ 150` | [gameSettingsService.js:31-39](/home/wkd/neruoWar/backend/services/gameSettingsService.js#L31) | 单次请求真实上限 |

## 8.2 布局中心与节点半径

| 参数 | 默认值/范围 | 位置 | 作用 |
| --- | --- | --- | --- |
| `yOffset` | `42` | [LayoutManager.js:462](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L462) | 星盘整体中心下移 |
| `centerRadius` | `32 ~ 42` | [LayoutManager.js:484](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L484) | 中心节点半径 |
| `baseNodeRadius` | 标题 `28` / 释义 `25.5` | [LayoutManager.js:536](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L536) | 外围节点基础半径 |
| `level radius decay` | 每层 `0.72`，最多减 4 层 | [LayoutManager.js:537](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L537) | 层越深基础半径越小 |
| `importance` | 标题 `0.96~1.54` / 释义 `0.98~1.62` | [starMapForceLayout.js:199](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L199) | 节点按 degree/childCount/boundaryCount 放大 |

## 8.3 半径带与扩散

| 参数 | 默认值/范围 | 位置 | 作用 |
| --- | --- | --- | --- |
| `cursor start` | `centerRadius + 28 * spreadFactor` | [starMapForceLayout.js:172](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L172) | 第一层 band 起点 |
| `bandThickness` | `58 ~ 124` | [starMapForceLayout.js:179-183](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L179) | 每层 band 厚度 |
| `cursor increment` | `bandThickness * 0.68` | [starMapForceLayout.js:193](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L193) | 下一层 band 推进距离 |
| `attempts` | `[1, 1.18, 1.36, 1.58]` | [starMapForceLayout.js:1124](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L1124) | 四次 spread 尝试 |

## 8.4 cluster anchor

| 参数 | 默认值/范围 | 位置 | 作用 |
| --- | --- | --- | --- |
| `GOLDEN_ANGLE` | `Math.PI * (3 - sqrt(5))` | [starMapForceLayout.js:2](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L2) | cluster anchor 角度种子 |
| `minAnchorRadius` | `min(width,height) * 0.1 * spreadFactor` | [starMapForceLayout.js:324](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L324) | anchor 最小半径 |
| `maxAnchorRadius` | `min(width,height) * 0.26 * spreadFactor` | [starMapForceLayout.js:323](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L323) | anchor 最大半径 |
| `anchor iterations` | `22` | [starMapForceLayout.js:345](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L345) | anchor 相互排斥次数 |
| `anchor minDistance` | `82 + sqrt(spreadScore product) * 14` | [starMapForceLayout.js:360-363](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L360) | anchor 间最小距离 |

## 8.5 力迭代

| 参数 | 默认值 | 位置 | 作用 |
| --- | --- | --- | --- |
| `iterations` | `128` | [starMapForceLayout.js:812](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L812) | 主迭代次数 |
| `velocity damping` | `* 0.76` | [starMapForceLayout.js:1099-1100](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L1099) | 速度阻尼 |
| `stepLimit` | `10 + cooling * 8` | [starMapForceLayout.js:1101](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L1101) | 单步最大位移 |

## 8.6 文本估算

| 参数 | 默认值 | 位置 | 作用 |
| --- | --- | --- | --- |
| 标题 `charPx` | `13.4` | [starMapLayoutHelpers.js:197](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L197) | 标题宽度估算 |
| 标题 `maxLines` | `2` 或 `3` | [starMapLayoutHelpers.js:194-203](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L194) | 标题换行上限 |
| sense `charPx` | `10.1` | [starMapLayoutHelpers.js:209](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L209) | sense 宽度估算 |
| `widthHint` | `94 ~ 164` / `156` | [starMapLayoutHelpers.js:218-222](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L218) | 布局 label 宽度 hint |
| `heightHint` | `22 ~ 46` 或 `30 ~ 58` | [starMapLayoutHelpers.js:224-228](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L224) | 布局 label 高度 hint |

## 8.7 连线视觉

| 参数 | 默认值/范围 | 位置 | 作用 |
| --- | --- | --- | --- |
| `curveOffset` | 由 `buildStarMapLineVisual()` 决定，再 clamp 到 `length * 0.22` | [starMapLayoutHelpers.js:527](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L527), [WebGLNodeRenderer.js:932-935](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L932) | 曲率 |
| `lineOpacity` | `0.08 ~ 0.42` | [starMapLayoutHelpers.js:594-608](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L594) | 主线透明度 |
| `glowOpacity` | 约 `0.08 ~ 0.2` | [starMapLayoutHelpers.js:609](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L609) | 光晕透明度 |
| `lineWidth` | `0.72 ~ 2.1` | [starMapLayoutHelpers.js:610-624](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L610) | 主线宽度 |
| `glowWidth` | `2.2 ~ 6.8` | [starMapLayoutHelpers.js:625-629](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L625) | 光晕宽度 |
| `drawOrder` | 基于 trunk/branch/level/cluster | [starMapLayoutHelpers.js:630-639](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L630) | 边的绘制先后 |
| `stubDistance` | `60 ~ 118` | [LayoutManager.js:706](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L706) | boundary stub 终点距离 |

## 8.8 裁剪、命中与层级

| 参数 | 默认值 | 位置 | 作用 |
| --- | --- | --- | --- |
| `insetPx` | `2` | [WebGLNodeRenderer.js:852](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L852) | 连线起终点往节点内收裁剪 |
| `minLengthPx` | `1` | [WebGLNodeRenderer.js:854](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L854) | 太短线段不画 |
| `hitTestLine threshold` | `10` | [WebGLNodeRenderer.js:966](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L966) | 线点击检测阈值 |
| `.webgl-canvas z-index` | `1` | [NodeDetail.css:73](/home/wkd/neruoWar/frontend/src/components/game/NodeDetail.css#L73) | WebGL 层级 |
| `overlayCanvas zIndex` | `1` | [WebGLNodeRenderer.js:1785](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L1785) | overlay 层级 |
| `.webgl-node-label-layer z-index` | `2` | [App.css:2738](/home/wkd/neruoWar/frontend/src/App.css#L2738) | 标签层级 |

# 9. 最值得关注的技术债

## 9.1 布局模型与最终渲染模型不一致

这是当前最关键的结构性问题。

现状：

- 求解器优化“节点中心之间的直线弹簧”
- 渲染器显示“裁剪后再弯曲的二次曲线”

结果：

- edge-node overlap 与 edge-edge crossing 的判断和用户看到的真实曲线不一致

## 9.2 没有全局换侧/半球分配机制

当前只有：

- cluster anchor 初始分散
- 局部力推拉

没有：

- 全局 occupancy score
- hemisphere assignment
- 离散翻转或重分配

这直接限制了问题 1 和问题 2 的上限。

## 9.3 文本尺寸不是 DOM 实测

布局用的是 [estimateStarMapLabelMetrics()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L187) 的启发式估算，不是渲染后的真实 box。

这会让：

- 碰撞控制与真实视觉占位之间始终存在偏差

## 9.4 连线被分成两层实现

当前一条边同时有：

- WebGL 直线 core
- overlay canvas 曲线 glow

这会引入：

- 遮挡逻辑难统一
- 命中测试难统一
- “到底哪层线代表真实路径”语义模糊

## 9.5 后端 BFS 截断与前端布局耦合较松，但信息不足

后端只给：

- level
- adjacency
- boundary stub

不给：

- 语义权重
- 父链优先级
- 更适合的侧向建议

因此前端布局只能用 degree / childCount / boundaryCount 做非常有限的几何启发式。

## 9.6 存在未使用的布局 helper

[buildStarMapLevelOrdering()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L350) 仍在代码里，但当前 active path 没有调用。

这通常意味着：

- 代码里保留了另一套“角度排序”思路
- 但当前真实运行路径没有显式角度排序阶段

这会增加后续分析成本。

## 9.7 当前没有星盘位置缓存/记忆

当前找不到星盘节点坐标的持久缓存或记忆机制。

实际行为是：

- 每次请求新 graph 重新算
- 每次 resize 重新算
- 结果之所以“稳定”，依赖 `stableUnit()` 哈希扰动，而不是位置记忆

这不是 bug，但意味着：

- 后续若要做“局部微调 + 记忆布局”，现在没有现成层可复用

# 10. 给后续分析者的最小必要信息

## 10.1 当前布局属于什么范式

当前星盘属于：

- BFS 分层图
- 软半径带 radial layout
- cluster anchor 种子布局
- parent-inherited branching
- 局部力迭代优化

不是纯 force graph，也不是严格环形槽位布局。

## 10.2 当前最大缺陷是什么

最大的结构缺陷有两个：

1. 布局求解基于直线弹簧，但最终渲染用曲线；布局和可见结果不一致。
2. 没有“空侧优先/换侧重排”的全局目标函数，只有局部推拉。

## 10.3 最关键的函数

- 后端取图
  - [traverseTitleStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L234)
  - [traverseSenseStarMap()](/home/wkd/neruoWar/backend/services/starMapTraversalService.js#L339)
- 前端布局入口
  - [calculateStarMapLayout()](/home/wkd/neruoWar/frontend/src/LayoutManager.js#L445)
- 前端求解器
  - [solveStarMapConstellationLayout()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L716)
  - [buildClusterAnchors()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L315)
  - [buildSeedBodies()](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js#L390)
- 连线视觉
  - [buildStarMapLineVisual()](/home/wkd/neruoWar/frontend/src/starMap/starMapLayoutHelpers.js#L527)
  - [getVisibleLineSegment()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L852)
  - [getCurvedLineGeometry()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L920)
  - [renderLineGlowTrails()](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js#L2006)

## 10.4 最应该先读哪几个文件

推荐阅读顺序：

1. [frontend/src/starMap/starMapForceLayout.js](/home/wkd/neruoWar/frontend/src/starMap/starMapForceLayout.js)
2. [frontend/src/LayoutManager.js](/home/wkd/neruoWar/frontend/src/LayoutManager.js)
3. [frontend/src/WebGLNodeRenderer.js](/home/wkd/neruoWar/frontend/src/WebGLNodeRenderer.js)
4. [backend/services/starMapTraversalService.js](/home/wkd/neruoWar/backend/services/starMapTraversalService.js)
5. [backend/routes/nodes.js](/home/wkd/neruoWar/backend/routes/nodes.js)
6. [frontend/src/App.js](/home/wkd/neruoWar/frontend/src/App.js)

## 10.5 一句话总结给下一个分析者

当前实现的关键不是“某个半径参数调得不够好”，而是 active layout path 本身没有做全局侧向分配，而且布局避障和最终曲线路径不是同一个几何模型；如果不先把这两个事实区分清楚，后续分析会很容易把问题误判成单纯的碰撞半径或样式层级问题。
