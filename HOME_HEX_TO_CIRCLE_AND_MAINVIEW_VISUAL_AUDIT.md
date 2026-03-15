# HOME_HEX_TO_CIRCLE_AND_MAINVIEW_VISUAL_AUDIT

## 1. 目标问题定义

本次审计只做“现状摸底 + 改造边界确认”，不改正式功能代码。目标是为后续两个任务收集足够的真实代码证据：

1. 任务1：实现“首页六边形节点点击后，进入知识域/释义主视角时，触发六边形 -> 圆形的连续过渡动画”。
2. 任务2：在不改逻辑的前提下，系统性提升主视角（标题主视角/释义主视角）的视觉完成度与动画质感。

本审计特别关注以下硬约束：

- 不改业务逻辑
- 不改现有视图切换规则
- 不改知识域/释义数据结构
- 不改 SceneManager 的场景职责划分
- 不改已成立的 `home` / `titleDetail` / `nodeDetail` 切换逻辑语义

审计方法：

- 仅基于仓库当前真实代码阅读
- 对每个判断给出对应文件、函数、状态或样式证据
- 发现不确定项时明确标注“未确认”

---

## 2. 当前首页与主视角的渲染架构总览

### 2.1 结论摘要

当前架构不是“首页和主视角同一渲染层换皮”，而是**明显的混合渲染架构**：

- 首页可点击六边形：`React DOM + CSS`
- 首页 WebGL：只做背景氛围层，不承载真实点击节点
- 主视角节点：`WebGLNodeRenderer` 绘制节点本体 + DOM label overlay + DOM 顶部 UI / 弹层

最关键的约束有两个：

1. 首页可见可点击节点不是 WebGL 节点。
2. `App.js` 会在 `view` 变化时销毁并重建 `SceneManager`，导致跨 view 不能延续同一个 renderer 的当前布局状态。

这两个点一起决定了：**“首页六边形 -> 主视角圆形”当前本质上是跨层、跨实例的过渡问题。**

### 2.2 首页架构

证据：

- `frontend/src/components/game/Home.js`
- `frontend/src/components/game/HexDomainGrid.js`
- `frontend/src/components/game/HexDomainCard.js`
- `frontend/src/components/game/Home.css`
- `frontend/src/App.js:2939-2940`

首页 JSX 结构核心：

```jsx
<div className="home-background-layer">
  <canvas ref={webglCanvasRef} className="webgl-canvas home-atmosphere-canvas" />
</div>

<KnowledgeTopPanel ... />
<HexDomainGrid ... onActivate={onHomeDomainActivate} />
```

而 `App.js` 首页 WebGL 更新逻辑明确写了：

```js
// 首页主入口改为 HTML/SVG 六边形层，WebGL 在首页只承担背景氛围层。
sceneManagerRef.current.showHome([], [], []);
```

这里的注释与实际调用一致：`showHome([], [], [])` 让首页 WebGL 场景没有真实业务节点。

### 2.3 主视角架构

证据：

- `frontend/src/components/game/KnowledgeViewRouter.js`
- `frontend/src/components/game/NodeDetail.js`
- `frontend/src/SceneManager.js`
- `frontend/src/WebGLNodeRenderer.js`

主视角由以下几层组成：

- WebGL 画布：`NodeDetail.js` 里的 `<canvas ref={webglCanvasRef} className="webgl-canvas" />`
- WebGL 节点渲染器：`SceneManager -> WebGLNodeRenderer`
- DOM 标签层：`WebGLNodeRenderer.ensureLabelOverlay()` 动态插入 `.webgl-node-label-layer`
- 2D overlay canvas：`WebGLNodeRenderer.ensureOverlayCanvas()`，绘制按钮图标、连线端点光点、用户标记
- DOM 顶部信息/搜索区：`KnowledgeTopPanel`
- DOM 弹层：`SenseSelectorPanel`、`TitleRelationInfoPanel`、`sense-article-entry-banner`、`AppOverlays` 各类 modal

### 2.4 SceneManager 生命周期

证据：

- `frontend/src/App.js:522-641`

`App.js` 初始化 WebGL 的 effect 依赖是 `[view]`，并且明确在 view 变化时销毁并重建：

```js
// 每次view变化时，清理并重新创建场景管理器
if (sceneManagerRef.current) {
  setIsWebGLReady(false);
  sceneManagerRef.current.destroy();
  sceneManagerRef.current = null;
}
```

这意味着：

- `SceneManager.currentScene`
- `SceneManager.currentLayout`
- `WebGLNodeRenderer.nodes`

都不会跨 `home -> titleDetail/nodeDetail` 保留。

这对后续任务的影响非常大：现有 `clickTransition` 虽然存在，但**当前首页进入主视角时实际上没有 renderer 连续态可接**。

---

## 3. 首页六边形节点实现审计

### 3.1 首页节点由什么渲染

结论：**DOM + CSS；不是 WebGL 节点。**

证据：

- `frontend/src/components/game/HexDomainCard.js`
- `frontend/src/components/game/HexDomainGrid.js`
- `frontend/src/components/game/Home.js`

首页实际点击节点是：

- `HexDomainGrid`
- `HexSection`
- `HexDomainCard`

而首页 WebGL canvas 只在 `home-background-layer` 下作为背景氛围。

### 3.2 真正对应组件/文件

核心文件：

- `frontend/src/components/game/Home.js`
- `frontend/src/components/game/HexDomainGrid.js`
- `frontend/src/components/game/HexDomainCard.js`
- `frontend/src/components/game/HexDomainGrid.css`
- `frontend/src/components/game/HexDomainCard.css`
- `frontend/src/components/game/hexUtils.js`

不是由下列文件直接承载首页业务点击节点：

- `frontend/src/SceneManager.js`
- `frontend/src/WebGLNodeRenderer.js`

### 3.3 六边形形状怎么做

结论：**CSS `clip-path: polygon(...)`。**

证据：

- `frontend/src/components/game/HexDomainCard.css`

关键样式：

```css
.hex-domain-card {
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
```

并且 `::before`、`::after` 也分别用更内层的 hex `clip-path` 叠出：

- 内面
- 亮边
- 高光层

所以首页六边形不是 SVG path，也不是 shader；是纯 CSS 裁切。

### 3.4 DOM 结构 / className / style / ref / data 属性 / 点击绑定 / 文本渲染

证据：

- `frontend/src/components/game/HexDomainCard.js`

结构：

```jsx
<button
  ref={buttonRef}
  className={`hex-domain-card hex-domain-card--${variant} ...`}
  style={buttonStyle}
  onClick={() => onActivate(node, buttonRef.current)}
>
  <div className="hex-domain-card__content">
    <div className="hex-domain-card__eyebrow">...</div>
    <div className="hex-domain-card__title">{title}</div>
    <div className="hex-domain-card__sense">{senseTitle}</div>
    <div className="hex-domain-card__summary">{summary}</div>
  </div>
</button>
```

结论：

- DOM 根节点：`button`
- ref：`buttonRef`
- 内联 style：`left/top/width/height` 和 `--hex-enter-delay`
- `data-*` 属性：**未发现**
- 点击绑定位置：`HexDomainCard` 的 `onClick`
- 点击透传参数：`onActivate(node, buttonRef.current)`
- 文本渲染：纯 DOM 文本，不是 canvas / WebGL label

### 3.5 标签文本渲染方式

证据：

- `HexDomainCard.js`
- `hexUtils.js`

字段来源：

- 标题：`getNodeDisplayName(node)`
- 释义标题：`getNodeSenseTitle(node)`
- 概述：`getNodeSenseSummary(node)`

当前首页六边形文本层级是：

1. eyebrow（根知识域 / 热门知识域）
2. title
3. sense
4. summary

### 3.6 hover / active / disabled 样式

证据：

- `frontend/src/components/game/HexDomainCard.css`

关键 class：

- `.hex-domain-card:hover`
- `.hex-domain-card:focus-visible`
- `.hex-domain-card.is-active`
- `.hex-domain-card.is-disabled`

表现包括：

- `transform: perspective(...) translate3d(...) scale(...)`
- `brightness/saturate`
- 更强 drop-shadow
- `z-index` 提升
- `::before` / `::after` 高光与内边框增强

结论：首页节点的精致度很大一部分来自 DOM/CSS 多层叠片，不是单一几何体。

### 3.7 首页节点空间数据来源

证据：

- `frontend/src/components/game/HexDomainGrid.js`
- `frontend/src/components/game/hexUtils.js`

来源链：

1. `HexDomainGrid` 通过 `useElementWidth()` 读取容器宽度
2. `HexSection` 调用 `buildHoneycombLayout(nodes, width, options)`
3. `buildHoneycombLayout()` 计算每张卡的 `x/y/width/height`
4. 再把这些值转成 `positionStyle` 注入 `HexDomainCard`

`buildHoneycombLayout()` 产出字段：

- `x`
- `y`
- `width`
- `height`
- `row`
- `column`
- `enterDelayMs`

坐标语义：

- 不是世界坐标
- 不是 canvas 坐标
- 是 **所在 section stage 内的 DOM 绝对定位像素坐标**

算法要点：

- 真正蜂窝偏移来自奇偶行 `rowOffset`
- `hexHeight = hexWidth * (2 / Math.sqrt(3))`
- `verticalStep = hexHeight * 0.75`

### 3.8 首页节点与背景/搜索/浮层层级关系

证据：

- `frontend/src/components/game/Home.js`
- `frontend/src/components/game/Home.css`

`Home.css` 中明确定义了层级变量：

- `--home-layer-background`
- `--home-layer-atmosphere`
- `--home-layer-hub`
- `--home-layer-nav`
- `--home-layer-search`
- `--home-layer-docks`
- `--home-layer-results`

层级关系总结：

- 背景渐变 / 星点 / 氛围 WebGL：最底层
- 首页主体内容 `home-main-layer`：中层
- 左侧导航、顶部 panel、右侧 dock：更高层
- 搜索结果、sense selector 等浮层：最高层

首页可点击 hex 节点所在层：

- 位于 `home-content-body -> home-hero-panel -> home-hex-safe-zone -> HexDomainGrid`
- 本质是 DOM 层，不在 WebGL 层里

---

## 4. 首页点击进入主视角的调用链审计

### 4.1 首页点击后的第一入口

首页点击链起点：

- `HexDomainCard.js` `onClick`
- `HexDomainGrid.js` `onActivate`
- `Home.js` `onHomeDomainActivate`
- `App.js` `handleHomeDomainActivate`

证据：

- `frontend/src/components/game/HexDomainCard.js`
- `frontend/src/components/game/HexDomainGrid.js`
- `frontend/src/components/game/Home.js`
- `frontend/src/App.js:2478`

调用实链：

```txt
HexDomainCard button.onClick
-> onActivate(node, buttonRef.current)
-> Home.onHomeDomainActivate
-> App.handleHomeDomainActivate(node, anchorElement)
```

### 4.2 首页点击后是否先弹标题/释义选择层

结论：**是，先弹 `SenseSelectorPanel`，不会直接进入主视角。**

证据：

- `frontend/src/App.js:2478-2486`

`handleHomeDomainActivate` 做的事：

- `setTitleRelationInfo(null)`
- `setSenseSelectorSourceNode(node)`
- `setSenseSelectorSourceSceneNodeId('')`
- `updateSenseSelectorAnchorByElement(anchorElement)`
- `setIsSenseSelectorVisible(true)`

没有直接调用：

- `fetchTitleDetail`
- `fetchNodeDetail`

### 4.3 选择标题后进入 `titleDetail` 的完整链路

核心文件：

- `frontend/src/components/layout/AppShellPanels.js`
- `frontend/src/components/senseArticle/hooks/useSenseArticleNavigation.js`
- `frontend/src/App.js`

链路：

```txt
SenseSelectorPanel
-> 点击标题按钮
-> handleSwitchTitleView
-> buildClickedNodeFromScene(nodeId)
-> fetchTitleDetail(nodeId, clickedNode, { relationHint: 'jump' })
-> setCurrentTitleDetail(centerNode)
-> setTitleGraphData(graph)
-> setView('titleDetail')
-> useEffect(view === 'titleDetail')
-> sceneManager.showTitleDetail(..., clickedNodeForTransition, ...)
```

证据：

- `AppShellPanels.js:1227-1356`
- `useSenseArticleNavigation.js:40-59`
- `App.js:2178-2303`
- `App.js:2971-2987`

### 4.4 选择释义后进入 `nodeDetail` 的完整链路

链路：

```txt
SenseSelectorPanel
-> 点击某个释义按钮
-> handleSwitchSenseView(senseId)
-> buildClickedNodeFromScene(nodeId)
-> fetchNodeDetail(nodeId, clickedNode, { activeSenseId })
-> setCurrentNodeDetail(data.node)
-> setView('nodeDetail')
-> useEffect(view === 'nodeDetail')
-> sceneManager.showNodeDetail(..., clickedNodeForTransition, { senseDetailOnly: true })
```

证据：

- `useSenseArticleNavigation.js:62-84`
- `App.js:2305-2438`
- `App.js:2951-2967`

### 4.5 `clickedNode / sourceNode / anchorNode / transition source` 分别在哪里构建

#### A. 首页 DOM 锚点

来源：

- `HexDomainCard` 的 `buttonRef.current`
- `App.js` `updateSenseSelectorAnchorByElement(element)`

字段：

- `x`
- `y`
- `visible`

用途：

- 仅用于 `SenseSelectorPanel` 的定位
- **不是 SceneManager transition source**

#### B. 场景节点 clickedNode

来源：

- `App.js` `buildClickedNodeFromScene(targetNodeId)`

返回字段：

```js
{
  id: matched.id,
  data: matched.data,
  type: matched.type
}
```

它依赖：

- `sceneManagerRef.current.currentLayout.nodes`

#### C. WebGL 场景 anchor

来源：

- `App.js` `updateSenseSelectorAnchorBySceneNode(sceneNode)`

它使用：

- `renderer.worldToScreen(sceneNode.x, sceneNode.y)`
- `canvas.getBoundingClientRect()`

用途：

- 也是给 `SenseSelectorPanel` 定位

### 4.6 这些对象如何一路传给 `SceneManager.showNodeDetail/showTitleDetail`

传递链：

- `fetchTitleDetail/fetchNodeDetail` 中：
  - 有 clickedNode 就 `setClickedNodeForTransition(clickedNode)`
  - 无则设 `null`
- `useEffect` 监听 `view/currentTitleDetail/currentNodeDetail/clickedNodeForTransition`
- 调 `sceneManagerRef.current.showNodeDetail(...)` 或 `showTitleDetail(...)`
- 传入 `clickedNodeForTransition`

证据：

- `App.js:2219-2223`
- `App.js:2355-2359`
- `App.js:2958-2962`
- `App.js:2978-2983`

### 4.7 最终如何触发 `clickTransition`

证据：

- `frontend/src/SceneManager.js:86-134`
- `frontend/src/SceneManager.js:138-174`

触发条件：

```js
if (this.currentScene === 'home' && clickedNode) {
  await this.clickTransition(clickedNode, newLayout);
}
```

### 4.8 当前代码里，哪些状态决定“这是从首页进入，因此要走特殊过渡动画”

决定条件只有两个：

1. `SceneManager.currentScene === 'home'`
2. `clickedNode` 非空

但当前首页场景下，这两个条件在实际运行里几乎不成立，原因如下。

### 4.9 关键实际结论：当前首页进入主视角，`clickTransition` 基本不会真正生效

这是本次审计最重要的现状判断之一。

#### 原因1：首页 WebGL 不承载业务节点

证据：

- `App.js:2939-2940`

首页只调用：

```js
sceneManagerRef.current.showHome([], [], []);
```

因此 `sceneManager.currentLayout.nodes` 在首页是空的或只有空布局，没有真实 root/featured 节点。

#### 原因2：首页从 selector 进入时，`buildClickedNodeFromScene(nodeId)` 拿不到首页 DOM 节点

证据：

- `App.js:2440-2447`

它只查 `sceneManager.currentLayout.nodes`，不会读 DOM hex 卡片。

因此首页选择标题/释义时，大概率得到：

- `clickedNode = null`

#### 原因3：view 切换时 `SceneManager` 会被销毁重建

证据：

- `App.js:531-539`

即使上一步有 clickedNode，`home -> titleDetail/nodeDetail` 过程中旧 manager 也会消失，新 manager 的：

- `currentScene === null`
- `currentLayout.nodes.length === 0`

而 `showNodeDetail/showTitleDetail` 在这两种情况下直接 `setLayout(newLayout)`，不会进 `clickTransition`。

#### 结论

当前仓库虽然有：

- `LayoutManager.calculateClickTransition`
- `SceneManager.clickTransition`
- `WebGLNodeRenderer.shapeMorph`

但**首页真实点击进入主视角时，这套能力目前并没有接通到实际用户路径。**

---

## 5. 主视角节点渲染与布局审计

### 5.1 核心文件职责分工

#### `frontend/src/SceneManager.js`

职责：

- 管理 scene 类型：`home | nodeDetail | titleDetail`
- 计算布局切换
- 调用 renderer 设置节点/连线
- 管理过渡动画：
  - `transitionTo`
  - `fadeTransition`
  - `clickTransition`
  - `nodeToNodeTransition`

#### `frontend/src/LayoutManager.js`

职责：

- 计算各场景布局
- 计算过渡起止状态

核心函数：

- `calculateHomeLayout`
- `calculateNodeDetailLayout`
- `calculateTitleDetailLayout`
- `calculateTransition`
- `calculateClickTransition`

#### `frontend/src/WebGLNodeRenderer.js`

职责：

- WebGL 节点渲染
- label overlay / overlay canvas
- hitTest
- animateNode
- camera offset / zoom

#### `frontend/src/components/game/NodeDetail.js`

职责：

- 主视角页面壳层
- WebGL canvas 容器
- `KnowledgeTopPanel`
- 左侧导航 sidebar

### 5.2 主视角节点是否统一由 WebGLNodeRenderer 绘制

结论：**主视角节点本体是统一由 `WebGLNodeRenderer` 绘制。**

证据：

- `SceneManager.setLayout()`
- `SceneManager.showNodeDetail()`
- `SceneManager.showTitleDetail()`

`setLayout(layout)` 里直接：

```js
this.renderer.clearNodes();
for (const nodeConfig of layout.nodes) {
  this.renderer.setNode(nodeConfig.id, nodeConfig);
}
this.renderer.setLines(layout.lines);
```

注意：

- 节点本体是 WebGL
- 标签不是 WebGL，而是 DOM overlay

### 5.3 各 node type 定义

证据：

- `LayoutManager.js`
- `WebGLNodeRenderer.js`

当前审计到的主要 type：

- `root`：首页根知识域
- `featured`：首页热门知识域
- `center`：主视角中心节点
- `parent`：释义主视角上层知识域
- `child`：释义主视角下层知识域
- `title`：标题主视角环形节点
- `search`：搜索跳转伪 clickedNode 类型
- `preview`：关联预览专用
- `home-divider-anchor`：首页分割线锚点，非业务节点

用户问题里提到的 `preview` 已确认存在；`anchorNode/sourceNode` 不是 renderer 内标准 type。

### 5.4 `calculateNodeDetailLayout` 的语义

证据：

- `LayoutManager.js:171-259`

布局语义：

- 中心节点固定在 `centerX, centerY + 60`
- parent 节点在上半圆
- child 节点在下半圆
- 每个节点连中心

产出字段包括：

- `id`
- `x`
- `y`
- `radius`
- `scale`
- `opacity`
- `type`
- `label`
- `visualStyle`
- `labelColor`
- `data`
- `visible`

### 5.5 `calculateTitleDetailLayout` 的语义

证据：

- `LayoutManager.js:265-423`

布局语义：

- 中心节点在画布中央偏下
- 其他标题节点按 `levelByNodeId` 分层为同心环
- 当前只给“中心与环节点”的 edge 画线
- line 上附带 `edgeMeta` 且 `clickable: true`

### 5.6 `setNode / setLayout / clickTransition / fadeTransition / nodeToNodeTransition / calculateClickTransition` 的职责

#### `renderer.setNode(id, config)`

职责：

- 将 layout node config 归一化为 renderer node
- 补默认值
- 决定默认 `shapeMorph`

关键逻辑：

```js
const resolveDefaultShapeMorph = (type = '') => (
  type === 'root' || type === 'featured' ? 0 : 1
);
```

#### `SceneManager.setLayout(layout)`

职责：

- 无动画直接落布局

#### `SceneManager.fadeTransition(newLayout)`

职责：

- 整场 fade out / fade in

#### `SceneManager.clickTransition(clickedNode, newLayout)`

职责：

- 预期用于“从首页点击节点到详情页”的特殊动画
- 先退其他节点，再让被点击节点去中心，再让新节点依次进入

#### `SceneManager.nodeToNodeTransition(clickedNode, newLayout)`

职责：

- 当前详情场景内点击父/子/标题节点后，切换到新的详情场景

#### `LayoutManager.calculateClickTransition(clickedNode, fromLayout, toLayout)`

职责：

- 只负责算 transition 数据，不负责 render
- 假设 `clickedNode.id` 能在 `fromLayout.nodes` 里找到 source node

### 5.7 `x / y / radius / scale / opacity / rotation / shapeMorph / glow / label / type / visualStyle` 的定义与消费

#### 逻辑层/布局层定义

来源：

- `LayoutManager.calculate*Layout`
- `SceneManager.clickTransition/nodeToNodeTransition`

字段：

- `x / y`
- `radius`
- `scale`
- `opacity`
- `type`
- `label`
- `visualStyle`
- `data`
- `visible`

#### 表现层/renderer 层定义

来源：

- `WebGLNodeRenderer.setNode`
- `WebGLNodeRenderer.animateNode`

附加字段：

- `rotation`
- `glowIntensity`
- `shapeMorph`

#### 消费位置

证据：

- `WebGLNodeRenderer.renderNodes()`
- `WebGLNodeRenderer.drawNodeSprite()`
- `WebGLNodeRenderer.renderLabels()`

结论：

- `type`、`data`、主布局 `x/y/radius` 更偏逻辑/结构层
- `shapeMorph`、`glowIntensity`、`rotation`、颜色/pattern 更偏表现层
- `label` 介于两者之间：文案属于逻辑结果，排版/字体/显示属于表现层

---

## 6. 现有过渡动画能力审计

### 6.1 已存在的过渡能力

当前代码里已存在 4 组主要动画能力：

1. `transitionTo`
2. `fadeTransition`
3. `clickTransition`
4. `nodeToNodeTransition`

以及底层插值：

- `WebGLNodeRenderer.animateNode`

### 6.2 `animateNode` 支持插值哪些字段

证据：

- `WebGLNodeRenderer.js:1003-1124`

数值插值字段：

- `x`
- `y`
- `radius`
- `scale`
- `opacity`
- `rotation`
- `shapeMorph`

这说明：

- 位置变化：已支持
- 缩放：已支持
- 透明度：已支持
- 形状插值：已支持

### 6.3 `clickTransition` 当前节奏

证据：

- `SceneManager.js:407-462`

分三段：

1. 其他节点淡出
2. 被点击节点移动到中心并放大
3. 新节点依次出现

当前缺点：

- 只有节点级别过渡，没有首页 DOM 卡片接力
- label 没有专门 staged motion
- edge 没有独立 staged reveal
- 进入节点 from 状态用了随机散点：
  - `x: targetCenterNode.x + (Math.random() - 0.5) * 100`
  - `y: targetCenterNode.y + (Math.random() - 0.5) * 100`

这会让观感更像“随机散开/聚合”，而不是“从点击源连续落场”。

### 6.4 `nodeToNodeTransition` 当前节奏

证据：

- `SceneManager.js:471-579`

节奏：

1. 被点击 node 去中心
2. 其他 node 向外飞并 fade
3. 新节点从中心散出

优点：

- 逻辑完整
- 中心接管语义明确

不足：

- 缺镜头语言
- 缺 label / line / glow 分阶段编排
- 其他节点退出方向是随机角度，风格不稳定

### 6.5 `fadeTransition` 当前节奏

证据：

- `SceneManager.js:370-405`

它基本是：

- 旧节点统一淡出缩小
- 新节点统一淡入放大

结论：功能型足够，质感型不足。

---

## 7. shapeMorph / hex / circle 能力审计

### 7.1 `shapeMorph` 当前的真实视觉语义

结论：**是真正的图形插值，不是简单样式切换。**

证据：

- `WebGLNodeRenderer.js` fragment shader

关键 shader 逻辑：

```glsl
float circleDist = length(pos) * 2.0;
float hexDist = max(dot(absHexPos, normalize(vec2(1.0, 1.7320508))), absHexPos.x);
dist = mix(hexDist, circleDist, clamp(u_shapeMorph, 0.0, 1.0));
```

这说明：

- `shapeMorph = 0` 更接近六边形
- `shapeMorph = 1` 更接近圆形

### 7.2 哪些节点默认更偏六边形

证据：

- `WebGLNodeRenderer.setNode`

默认值逻辑：

```js
type === 'root' || type === 'featured' ? 0 : 1
```

结论：

- `root`
- `featured`

默认偏 hex。

### 7.3 哪些节点默认更偏圆形

默认偏 circle：

- `center`
- `parent`
- `child`
- `title`
- `search`

### 7.4 这个 morph 是真正图形插值，还是粗略样式切换

结论：**节点主体轮廓是几何级插值；不是纯 CSS 类切换。**

但要注意：

- renderer 在 `renderNodes()` 里主节点仍统一 `shapeType: 2`
- 只有按钮/预览节点等会直接 `shapeType: 0`

所以当前主节点系统的“圆形”其实是“hex shader 通过 `shapeMorph=1` 收敛到 circle”。

### 7.5 hitTest 是否考虑 hex/circle 差异

结论：**考虑了，但只对首页 root/featured 型节点特殊处理。**

证据：

- `WebGLNodeRenderer.hitTest()`

关键逻辑：

```js
const isMostlyHex = (node.type === 'root' || node.type === 'featured')
  && (Number(node.shapeMorph) || 0) < 0.45;
```

若 `isMostlyHex`：

- 用六边形近似边界判定

否则：

- 用圆形半径命中

### 7.6 当前最接近“hex -> circle”可复用的基础

可复用基础确实存在，但只存在于 renderer 层：

1. `shapeMorph` 真图形插值
2. `animateNode` 可插值 `shapeMorph/x/y/scale/opacity`
3. `worldToScreen/screenToWorld`
4. `calculateClickTransition`

证据：

- `WebGLNodeRenderer.animateNode`
- `WebGLNodeRenderer.worldToScreen`
- `LayoutManager.calculateClickTransition`

### 7.7 现阶段缺的基础设施是什么

当前最缺的不是 shader，而是**跨层接力基础设施**：

1. 首页 DOM 节点的过渡源对象
2. 首页点击源到主视角目标中心的统一坐标接管
3. 首页 DOM 文本层与主视角 WebGL/DOM label 的接力机制
4. 一个不依赖旧 `SceneManager` 持活的 transition ghost / proxy 载体
5. 跨 view 切换期间保留 transition context 的容器

不是最缺的：

- hex/circle 的图形能力

---

## 8. 坐标系统与位置对齐方式

### 8.1 首页坐标系

证据：

- `hexUtils.buildHoneycombLayout`
- `HexDomainCard.js`
- `HexDomainGrid.js`

首页六边形使用：

- DOM stage 内绝对定位像素
- `left/top/width/height`

点击锚点采集使用：

- `button.getBoundingClientRect()`
- 最终得到 **viewport 坐标**

### 8.2 主视角坐标系

证据：

- `LayoutManager.js`
- `WebGLNodeRenderer.worldToScreen/screenToWorld`

主视角 layout 的 `x/y` 是 renderer 的 world 坐标，但当前 camera 设置基本让它与 canvas 像素坐标重合：

- `camera.zoom = 1`
- `offsetX = 0`
- `offsetY = 0`
- 详情场景都 `setCameraPanEnabled(false)` 且 `resetCameraToLayoutCenter()`

因此主视角常态下：

- world 坐标近似就是 canvas 内像素坐标

### 8.3 DOM 页坐标到主视角目标位置的转换现有能力

已存在能力：

- `renderer.worldToScreen(x, y)`：world -> canvas screen
- `canvas.getBoundingClientRect()`：canvas -> viewport

`App.js` 已经这样做过 selector anchor：

```js
const screenPos = renderer.worldToScreen(sceneNode.x, sceneNode.y);
const rect = canvas.getBoundingClientRect();
const next = {
  x: rect.left + screenPos.x,
  y: rect.top + screenPos.y
}
```

结论：

- 主视角目标位置对齐能力已具备一半
- 首页源位置也能通过 DOM rect 得到
- 缺的是中间过渡载体

### 8.4 当前坐标系统的实际边界

首页来源：

- 页面 viewport 坐标

主视角目标：

- WebGL canvas 内 screen 坐标 + canvas rect 转换到 viewport

所以“首页 -> 主视角”的最佳桥接坐标系应该是：

- **统一使用 viewport/screen space**

---

## 9. 是否属于跨层动画问题

### 9.1 判断

结论：**最符合当前仓库实际的是 “DOM/HTML overlay -> WebGL world space 的跨层接力问题”。**

在用户给出的选项里，更准确对应：

- `2. DOM/SVG -> WebGL 跨层接力`
- 同时也带有 `3. HTML overlay -> WebGL world space 接力` 的特征

### 9.2 为什么

原因有三层：

1. 首页可见节点是 DOM/CSS 卡片
2. 主视角节点本体是 WebGL
3. SceneManager 在 view 切换时重建，旧场景不连续

所以它既不是：

- 同一渲染层内完成

也不是：

- 首页和主视角已经是同一 renderer 只差样式

### 9.3 证据文件

- 首页 DOM 节点：`Home.js` / `HexDomainGrid.js` / `HexDomainCard.js`
- 首页 WebGL 只是背景：`App.js:2939-2940`
- 主视角 WebGL：`SceneManager.js` / `WebGLNodeRenderer.js`
- 跨 view 销毁重建：`App.js:522-641`

### 9.4 当前代码里有没有现成的 screen/world 转换

有：

- `WebGLNodeRenderer.worldToScreen`
- `WebGLNodeRenderer.screenToWorld`

### 9.5 当前代码里有没有现成的 ghost/proxy/占位节点/截图 clone 机制

#### 已发现

- `previewMode`
- `setPreviewNode`
- `setPreviewLines`

但它们是：

- 关联预览专用
- 不服务首页 -> 主视角切换
- 预览节点绘制时直接用圆形，不复用 hex morph 落场语义

#### 未发现

在当前知识域首页/主视角相关代码中，未发现以下基础设施：

- DOM clone 过渡节点
- screenshot / html2canvas 机制
- 专门的 transition ghost 管理器
- 首页 DOM 节点到主视角 renderer 节点的一次性代理桥

补充说明：

- 全仓库搜到的 `ghost` 基本在战场/编队预览体系，不在知识域首页/主视角体系内

### 9.6 缺失基础设施类型

缺的是：

- **跨层 transition ghost 基础设施**
- **首页 DOM 源节点快照/抽象**
- **跨 view transition context 保持**

---

## 10. 主视角视觉表现审计（不动逻辑）

以下审计严格限定在“可只改表现，不改逻辑”的范围。

### 10.1 节点本体视觉

证据：

- `WebGLNodeRenderer.renderNodes`
- `WebGLNodeRenderer.resolveNodeRenderStyle`
- fragment shader

现状：

- 非首页节点多数走同一套 `DEFAULT_UNALLIED_NODE_VISUAL_STYLE`
- 主视角中心/父/子/标题节点最终都偏同类球体质感
- hover 主要只加 `glowIntensity`
- 没有 center/parent/child/title 的明显材质层级分化

当前主视角节点的优点：

- shader 里有 diffuse/specular/rim/glow/pattern
- 基础体积感是存在的

当前不足：

- 材质语言过于统一
- 发光层单薄
- 内外边框层次不如首页 DOM 六边形
- hover 与 active 的差异主要靠发光，不够“精致”
- 中心节点虽更大，但材质叙事不够强

首页更精致的来源对比：

- 首页 hex 卡片有 3 层以上 DOM/CSS 表皮
- 首页 hover 有明确 3D 卡片感和阴影抬升
- 主视角节点更多是“单 shader 球”

### 10.2 标签与文字系统

证据：

- `WebGLNodeRenderer.renderLabels`
- `App.css:2548-2599`

现状：

- label 是 DOM overlay，绝对定位在节点中心
- 标题和释义标题拆成 `.node-label-title` / `.node-label-sense`
- 主视角 label 没有额外底板/边框/微光牌匾
- main view label `maxWidth` 只对首页 hex 特判，主视角无特定宽度限制

问题：

- 字号主要靠 node 半径推导，排版较机械
- 主视角标签与节点之间缺“粘附关系”的视觉强化
- 没有 label reveal timing
- 没有多行精致控制，只有基础换行
- label 和 WebGL 本体分属不同层，易有“球很重，字很轻”的分离感

首页更精致的来源：

- DOM 卡片里文字有明确留白盒子
- summary/sense/title 是同一材质面板上的排版
- 文字与节点边界天然一体

### 10.3 连线与关系表达

证据：

- `WebGLNodeRenderer.renderLines`
- `WebGLNodeRenderer.renderLineConnectionCaps`
- `LayoutManager.calculateNodeDetailLayout`
- `LayoutManager.calculateTitleDetailLayout`

现状：

- 线是单段 `gl.LINES`
- 宽度固定 `2`
- 颜色由 line.color 给定
- 额外仅有 overlay canvas 画的 connection caps

问题：

- 线条偏硬、偏平
- 没有流向感、渐变感、粗细衰减
- 没有强弱区分
- 标题主视角线虽然可点击，但视觉上仍然很“功能线”

不改逻辑能做的纯视觉增强：

- 多层线：底辉光 + 中线芯 + 端点 bloom
- hover line 高亮
- 父/子/标题关系用不同辉光和透明节奏
- 线条显隐分阶段延后于节点

### 10.4 动画编排

证据：

- `SceneManager.clickTransition`
- `SceneManager.fadeTransition`
- `SceneManager.nodeToNodeTransition`

现状问题：

- 大多是“位移 + 缩放 + 透明度”
- 节奏偏直给
- 缺 staged motion
- 缺 overshoot / settle
- label 没有单独 delay
- line 没有延迟追随
- glow 没有 bloom 波峰

结论：

- 逻辑完整
- 观感仍偏“工程动画”，而非“精心编排的叙事动画”

### 10.5 相机与空间感

证据：

- `WebGLNodeRenderer.camera`
- `SceneManager.resetCameraToLayoutCenter`
- `SceneManager.showNodeDetail/showTitleDetail`

现状：

- camera 只有 `offsetX/offsetY/zoom`
- 主视角默认固定在中心
- 进入详情时没有镜头推进/停稳/余振
- `setCameraPanEnabled(false)` 让场景稳定，但也取消了镜头层表达

可优化空间：

- 不改布局逻辑，只加 camera 的表现层 easing
- 进入时先微缩放再 settle
- line/label 在 camera settle 后再补亮

### 10.6 背景与氛围层

证据：

- 首页：`Home.css`
- 主视角：`NodeDetail.css` + `WebGLNodeRenderer.render clearColor`

首页为什么更完整：

- 固定背景层
- 渐变
- grid
- stars
- 氛围 WebGL
- 大容器玻璃感 shell

主视角现状：

- canvas 清屏色较纯
- 外层容器虽有边框和阴影，但 canvas 内部氛围弱
- 没有像首页那样的环境层叠

结论：

- 主视角不是逻辑差，而是环境层和材质层不够饱满

### 10.7 主视角 UI 附着物

主要附着物：

- 顶部 `KnowledgeTopPanel`
- 左侧 navigation sidebar
- `SenseSelectorPanel`
- `TitleRelationInfoPanel`
- `sense-article-entry-banner`
- `AppOverlays` 各类 modal
- WebGL 按钮图标（2D canvas）

问题：

- `KnowledgeTopPanel` 是新版精致风格
- 左侧 sidebar、右下 banner、部分 App.css 老样式仍偏旧
- `webgl-node-label-layer` 被强行隐藏以配合 selector：
  - `.sense-selector-open .webgl-node-label-layer { display: none !important; }`
- 这会带来层间切换割裂

### 10.8 首页 vs 主视角质感差异的直接来源

不是逻辑差异，而是表现层差异：

- 首页：DOM 材质面更丰富
- 主视角：shader 有基础，但编排、层次、附着 UI 一致性不足

---

## 11. 首页与主视角风格落差来源拆解

### 11.1 造型语言差异

- 首页：pointy-top 六边形，带卡片边框和内外片层
- 主视角：圆球/近圆球体

### 11.2 明暗差异

- 首页：更亮的边缘高光、更明确的暗面、drop-shadow 更重
- 主视角：统一球体 shading，局部高光存在但层差不足

### 11.3 细节密度差异

- 首页：背景层、卡面层、文字层、hover 层都很密
- 主视角：节点本体还可以，线和 label 细节密度不足

### 11.4 动画节奏差异

- 首页：入场 `hex-domain-card-enter` + hover 抬升更“卡片化”
- 主视角：切换动画偏功能性

### 11.5 标签排版差异

- 首页：文字嵌在卡片内部，有真实留白和边界
- 主视角：label 悬浮在球体中心，没有载体感

### 11.6 边缘处理差异

- 首页：clip-path + before/after 形成硬边、亮边、软光
- 主视角：边缘主要靠 shader rim

### 11.7 空间层次差异

- 首页：大背景 + 中景面板 + 前景 hex + dock
- 主视角：大多是前景节点 + 简单容器，缺中后景

### 11.8 UI overlay 融合度差异

- 首页：顶部 panel 与内容面板是一体设计
- 主视角：顶部 panel 已统一，但 sidebar / entry banner / relation popup / modal 风格还不完全一致

---

## 12. 纯视觉升级项分层清单（按风险与优先级）

> 说明：本节只评估“是否不改逻辑可做”。不写实现代码。

### 12.1 CSS-only 改善

| 项目 | 不改逻辑可做 | 影响范围 | 风险 | 需改数据结构 | 需改交互语义 | 优先级 |
|---|---|---|---|---|---|---|
| `KnowledgeTopPanel` 与主视角侧边栏/弹层统一材质语言 | 是 | CSS | 低 | 否 | 否 | P0 |
| `sense-article-entry-banner` 改为更贴合主视角的悬浮卡 | 是 | CSS | 低 | 否 | 否 | P1 |
| `TitleRelationInfoPanel` 提升玻璃感/层次/标题排版 | 是 | CSS | 低 | 否 | 否 | P1 |
| `SenseSelectorPanel` 开关时不直接硬隐藏所有 label，而改柔和过渡 | 是 | CSS | 低 | 否 | 否 | P0 |
| 左侧 `navigation-sidebar` 视觉现代化 | 是 | CSS | 低 | 否 | 否 | P1 |
| 清理/收敛旧 `App.css` 重复视觉定义，减少样式冲突 | 是 | CSS | 中 | 否 | 否 | P1 |

### 12.2 Shader-only 改善

| 项目 | 不改逻辑可做 | 影响范围 | 风险 | 需改数据结构 | 需改交互语义 | 优先级 |
|---|---|---|---|---|---|---|
| 中心/父/子/标题节点更强的 rim / fresnel / bloom 区分 | 是 | shader | 中 | 否 | 否 | P0 |
| 节点内部渐变与 pattern 层次增强 | 是 | shader | 中 | 否 | 否 | P1 |
| 标题主视角节点按 graph level 变化材质强度 | 是 | shader | 中 | 否 | 否 | P1 |
| 背景氛围 shader 或噪声层 | 是 | shader | 中 | 否 | 否 | P1 |

### 12.3 Renderer 参数级改善

| 项目 | 不改逻辑可做 | 影响范围 | 风险 | 需改数据结构 | 需改交互语义 | 优先级 |
|---|---|---|---|---|---|---|
| 调整不同 node type 的 `glowIntensity` / `opacityFactor` / `patternType` | 是 | renderer params | 低 | 否 | 否 | P0 |
| 增强 hover 时 scale/rim 而非只加 glow | 是 | renderer params | 低 | 否 | 否 | P0 |
| 连线端点光点增强、line hover 高亮 | 是 | renderer params + overlay canvas | 低 | 否 | 否 | P1 |
| 标签字号曲线、最大宽度、透明度阈值优化 | 是 | renderer params + CSS | 低 | 否 | 否 | P0 |

### 12.4 动画时序级改善

| 项目 | 不改逻辑可做 | 影响范围 | 风险 | 需改数据结构 | 需改交互语义 | 优先级 |
|---|---|---|---|---|---|---|
| `clickTransition` 加 staged motion：node -> glow -> label -> edge | 是 | scene orchestration | 中 | 否 | 否 | P0 |
| `nodeToNodeTransition` 加 overshoot / settle / edge delay | 是 | scene orchestration | 中 | 否 | 否 | P0 |
| `fadeTransition` 改成前后景分层 fade | 是 | scene orchestration | 中 | 否 | 否 | P1 |
| `KnowledgeTopPanel` 与场景切换加微延时/微位移 | 是 | CSS + orchestration | 低 | 否 | 否 | P1 |

### 12.5 主视角 overlay/UI 视觉统一改善

| 项目 | 不改逻辑可做 | 影响范围 | 风险 | 需改数据结构 | 需改交互语义 | 优先级 |
|---|---|---|---|---|---|---|
| `SenseSelectorPanel` / `TitleRelationInfoPanel` / 顶栏 panel 统一设计 token | 是 | CSS | 低 | 否 | 否 | P0 |
| DOM label 与 WebGL 节点关系感增强 | 是 | CSS + renderer params | 中 | 否 | 否 | P0 |
| 右下角 sense article 入口与中心节点视觉联动 | 是 | CSS + orchestration | 中 | 否 | 否 | P1 |

### 12.6 首页 -> 主视角过渡接力改善

| 项目 | 不改逻辑可做 | 影响范围 | 风险 | 需改数据结构 | 需改交互语义 | 优先级 |
|---|---|---|---|---|---|---|
| DOM ghost 节点从首页卡片接到主视角中心 | 是 | overlay UI + scene orchestration | 中 | 否 | 否 | P0 |
| 统一 label handoff | 是 | overlay UI + renderer params | 中 | 否 | 否 | P0 |
| 首页节点光晕/透明度与主视角中心节点 bloom 同步 | 是 | CSS + shader + orchestration | 中 | 否 | 否 | P1 |

### 12.7 需要新过渡基础设施但不改业务逻辑的改善

| 项目 | 不改逻辑可做 | 影响范围 | 风险 | 需改数据结构 | 需改交互语义 | 优先级 |
|---|---|---|---|---|---|---|
| 持久化 `transitionContext`（源 rect、标题、目标类型） | 是 | scene orchestration | 中 | 否 | 否 | P0 |
| 跨 view 的 transition host / portal | 是 | overlay UI | 中 | 否 | 否 | P0 |
| 主视角目标中心 ready 信号，用于 ghost 落场 | 是 | scene orchestration | 中 | 否 | 否 | P0 |
| 保留旧 SceneManager 直到过渡完成 | 否，已触及现有视图切换实现 | scene lifecycle | 高 | 否 | 否 | P2 |

---

## 13. 三种过渡实现路线的约束分析（不写代码）

### 路线1：把首页六边形节点也统一到 WebGL 渲染体系中，然后复用现有 `clickTransition + shapeMorph`

#### 契合度

低。

#### 原因

- 当前首页主入口已经明确迁移到 DOM hex 层
- 首页 WebGL 现在只做氛围层
- 首页精致质感依赖 DOM/CSS 多层卡面，不是现有 WebGL 首页节点
- `App.js` 当前还在首页只调用 `showHome([], [], [])`

#### 需要补的基础设施

- 首页业务节点重新回到 WebGL
- 或首页做 DOM/WebGL 双绘制同步
- 还要处理 SceneManager 跨 view 重建问题

#### 风险点

- 侵入现有首页结构
- 易破坏已完成的首页排版/搜索/hover 精致度
- 需要重做可点击 hitTest 与 DOM 搜索结果/浮层的关系

#### 对逻辑侵入程度

高。

#### 可维护性

理论上长期统一，但当前改造成本最高。

#### 结论

不推荐作为第一落地路线。

### 路线2：保留首页当前实现，点击时创建屏幕坐标系下的临时 ghost/overlay 节点，让它做 hex -> circle + move + scale + label 接力，然后在主视角 WebGL 节点就位后完成落场

#### 契合度

最高。

#### 原因

- 当前首页真实节点就是 DOM
- 当前已有 DOM 源元素 `buttonRef.current`
- 当前已有目标位置换算能力：
  - `renderer.worldToScreen`
  - `canvas.getBoundingClientRect()`
- 不依赖保留旧 SceneManager

#### 需要补的基础设施

- transition context：
  - 源 rect
  - 源文本
  - 目标模式（title/sense）
- 全局 transition host / portal
- 主视角中心 ready 回调或可查询目标点
- 真实中心节点出现前的可见性/opacity 接力

#### 风险点

- DOM ghost 的 hex -> circle 需要自己做 morph
- 需要处理 label handoff 和 z-index
- 需要避免 ghost 与新场景中心节点重影

#### 对逻辑侵入程度

低到中。

不会改变：

- 页面路由
- 数据流
- 进入谁/进入什么的语义

#### 可维护性

好。

因为它承认当前真实架构就是双层，不强行统一。

#### 结论

**最推荐。**

### 路线3：保持双层结构，首页节点淡出，主视角里生成一个从首页点击位置出发的代理 WebGL 节点，它执行 move + shapeMorph，最后替换成真实主视角节点**

#### 契合度

中等。

#### 原因

- 可利用现有 WebGL `shapeMorph`
- 可在新场景 manager 里做 proxy 节点动画

#### 需要补的基础设施

- 首页点击源的屏幕坐标采集并传入新 view
- 代理 node 的初始 screen/world 映射
- 中心真实 node 与 proxy node 的替换机制

#### 风险点

- 代理 WebGL 节点的外观很难完全匹配当前 DOM 首页卡片
- label 接力仍然要单做
- 新 manager 初始化时机与 proxy 启动时机要精确同步

#### 对逻辑侵入程度

中等。

#### 可维护性

中等。

会比 Route2 更依赖 renderer 的内部实现。

#### 结论

可做，但优先级次于 Route2。

### 综合推荐

推荐顺序：

1. **路线2**
2. 路线3
3. 路线1

推荐 Route2 的根本原因：

- 它最尊重当前仓库已成型的真实架构
- 它不要求回退首页 DOM 方案
- 它也不要求保留旧 SceneManager 实例
- 它能最大程度复用当前首页现有精致卡面

---

## 14. 相关文件清单（附原因）

### 必查核心

- `frontend/src/App.js`
  - view 切换、SceneManager 生命周期、fetchTitleDetail/fetchNodeDetail、selector 状态、clickedNodeForTransition
- `frontend/src/SceneManager.js`
  - scene orchestration、动画链、按钮、知识域进入动画
- `frontend/src/LayoutManager.js`
  - home/nodeDetail/titleDetail 布局语义、clickTransition 数据生成
- `frontend/src/WebGLNodeRenderer.js`
  - shader、shapeMorph、hitTest、label overlay、world/screen 转换
- `frontend/src/components/game/Home.js`
  - 首页真实渲染层与层级结构
- `frontend/src/components/game/Home.css`
  - 首页背景层、sticky 区、层级变量
- `frontend/src/components/game/HexDomainGrid.js`
  - 首页节点布局容器
- `frontend/src/components/game/HexDomainGrid.css`
  - 首页卡片舞台与 section 层次
- `frontend/src/components/game/HexDomainCard.js`
  - 首页节点 DOM/点击/ref
- `frontend/src/components/game/HexDomainCard.css`
  - 六边形本体样式与 hover/active 质感
- `frontend/src/components/game/hexUtils.js`
  - 首页蜂窝几何计算与安全边距
- `frontend/src/components/game/KnowledgeViewRouter.js`
  - home/titleDetail/nodeDetail 视图装配关系
- `frontend/src/components/game/NodeDetail.js`
  - 主视角容器、顶部 panel、旧 2D canvas 残留
- `frontend/src/components/game/NodeDetail.css`
  - 主视角 shell 与导航样式
- `frontend/src/components/game/KnowledgeTopPanel.js`
  - 首页/主视角共用顶部 panel 与搜索结果
- `frontend/src/components/game/KnowledgeTopPanel.css`
  - 共用顶部 panel 样式
- `frontend/src/components/layout/AppShellPanels.js`
  - `SenseSelectorPanel`、`TitleRelationInfoPanel`
- `frontend/src/components/senseArticle/hooks/useSenseArticleNavigation.js`
  - `handleSwitchTitleView` / `handleSwitchSenseView` 真入口
- `frontend/src/components/layout/AppOverlays.js`
  - 主视角周边 modal 与附着 UI
- `frontend/src/components/game/KnowledgeDomainScene.js`
  - 独立知识域 3D 场景；与任务1/2非同一视图，但会影响顶部粘性与 transition 上下文
- `frontend/src/components/game/KnowledgeDomainScene.css`
  - 知识域场景固定层与拖拽视觉
- `backend/routes/nodes.js`
  - `/public/title-detail/:nodeId` 数据结构来源

### 次级相关

- `frontend/src/App.css`
  - label overlay、sense selector、title relation popup、旧 node-detail/search 样式残留
- `frontend/src/app/appShared.js`
  - navigation relation helper
- `frontend/src/components/game/RightUtilityDock.js`
  - 首页/主视角右侧 dock 外层壳

---

## 15. 关键状态 / 函数 / 数据结构清单

### 15.1 关键 React state / refs

#### `App.js`

- `view`
- `currentNodeDetail`
- `currentTitleDetail`
- `titleGraphData`
- `clickedNodeForTransition`
- `senseSelectorSourceNode`
- `senseSelectorSourceSceneNodeId`
- `senseSelectorAnchor`
- `isSenseSelectorVisible`
- `webglCanvasRef`
- `sceneManagerRef`
- `knowledgeHeaderOffset`

### 15.2 关键函数

#### 首页点击/selector

- `handleHomeDomainActivate`
- `updateSenseSelectorAnchorByElement`
- `updateSenseSelectorAnchorBySceneNode`

#### 详情获取/导航

- `fetchTitleDetail`
- `fetchNodeDetail`
- `buildClickedNodeFromScene`
- `handleSwitchTitleView`
- `handleSwitchSenseView`

#### 场景更新

- `sceneManager.showHome`
- `sceneManager.showNodeDetail`
- `sceneManager.showTitleDetail`
- `SceneManager.clickTransition`
- `SceneManager.nodeToNodeTransition`
- `SceneManager.fadeTransition`

#### 坐标转换

- `renderer.worldToScreen`
- `renderer.screenToWorld`

### 15.3 关键数据结构

#### 首页 DOM 卡片布局对象

来自 `buildHoneycombLayout()`：

- `item`
- `x`
- `y`
- `width`
- `height`
- `enterDelayMs`

#### renderer node config

来自 `LayoutManager.calculate*Layout()` / `setNode()`：

- `id`
- `x`
- `y`
- `radius`
- `scale`
- `rotation`
- `opacity`
- `visible`
- `type`
- `label`
- `data`
- `visualStyle`
- `labelColor`
- `glowIntensity`
- `shapeMorph`

#### titleDetail graph

来自 `GET /nodes/public/title-detail/:nodeId`

- `graph.centerNode`
- `graph.nodes`
- `graph.edges`
- `graph.levelByNodeId`
- `graph.nodeCount`
- `graph.edgeCount`

#### sense selector 锚点

- `x`
- `y`
- `visible`

#### clickedNode 过渡对象

由 `buildClickedNodeFromScene()` 构造：

- `id`
- `data`
- `type`

### 15.4 关键 CSS 选择器

#### 首页

- `.home-shell`
- `.home-background-layer`
- `.home-sticky-overview`
- `.home-content-body`
- `.hex-domain-grid-shell`
- `.hex-domain-card`
- `.hex-domain-card::before`
- `.hex-domain-card::after`
- `.hex-domain-card__title`
- `.hex-domain-card__sense`
- `.hex-domain-card__summary`

#### 主视角

- `.node-detail-container`
- `.node-detail-scene-container`
- `.node-detail-top-panel`
- `.webgl-node-label-layer`
- `.webgl-node-label`
- `.node-label-title`
- `.node-label-sense`

#### 选择/关系/UI 浮层

- `.sense-selector-panel`
- `.sense-selector-item`
- `.title-relation-popup`
- `.sense-article-entry-banner`

---

## 16. 后续正式改代码前仍缺失的信息

### 已确认但仍需在正式实现前细化的项

1. **过渡目标节点 ready 时机**
   - 当前可在 `showNodeDetail/showTitleDetail` 后通过 renderer 拿中心节点，但正式实现前需要决定：
   - 是在 scene 完成首帧后再取目标点，还是在 layout 计算后立即取

2. **Route2 的 ghost 形变载体选型**
   - 当前仓库没有现成实现
   - 正式实现前需决定用：
   - 纯 DOM + CSS
   - DOM + SVG mask
   - 还是单独过渡 canvas

3. **主视角中心节点的落场接管方式**
   - 需要确定 ghost 消失时，真实中心节点是：
   - 先隐藏再显
   - 还是低 opacity 等 ghost 落场后补亮

4. **label 接力方案**
   - 首页节点 label 现在是卡片内 DOM 文本
   - 主视角 label 是 overlay DOM 文本
   - 正式实现前要决定：
   - ghost 自带文本一路过渡
   - 还是 ghost 只过渡形体，label 单独 crossfade

5. **旧样式清理边界**
   - `NodeDetail.js` 存在未挂载的 `detailCanvasRef` 与大段旧注释
   - `App.css` 与 `NodeDetail.css` 有重复的 `.node-detail-container` / `.navigation-sidebar` 等旧样式
   - 正式实现前应先判断这些残留是否会影响最终样式优先级

### 未确认项

1. **是否还有其他未被当前审计触达的知识域过渡辅助 util**
   - 本次已对首页/主视角相关文件和全仓库关键词做过扫描，未发现专门 transition ghost 基础设施
   - 若正式实现前仍不放心，可继续查：
   - `frontend/src/utils`
   - `frontend/src/hooks`
   - 是否有其他独立 animation helper

2. **KnowledgeDomainScene 与主视角切换时是否有额外全局滚动/布局副作用**
   - 本次审计重点不在“滚动 bug”复盘
   - 如果后续正式实现会同时碰知识域 3D 场景切换，建议再单查：
   - `KnowledgeDomainScene.js` 里 scene pan / pointer capture / fixed layer 与页面滚动的关系

3. **标题主视角 edges 是否未来会扩展为非中心互连**
   - 当前 `calculateTitleDetailLayout()` 只绘制中心相关 edge
   - 如果后续视觉升级要做更完整关系图，需先确认这是否属于逻辑变更

---

## 补充结论

本次审计后的核心边界可以压缩成 5 句话：

1. 首页真实点击节点是 DOM 六边形卡片，不是 WebGL 节点。
2. 主视角真实节点本体是 WebGL，标签和部分 UI 是 DOM overlay。
3. `shapeMorph` 已经具备真实 hex -> circle 图形插值能力。
4. 但当前首页进入主视角时，这套 renderer 过渡并没有真正接上，因为首页没有业务 WebGL node，而且 `SceneManager` 会随 `view` 重建。
5. 因此后续最合适的实现方向是：在不改逻辑的前提下，补一个跨层 transition ghost/overlay 接力层，并对主视角做表现层统一升级。
