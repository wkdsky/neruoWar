# 知识锦子系统设计

更新时间：2026-03-31

## 1. 目标

在现有右侧工具抽屉中新增一个入口 `知识锦`，为用户提供一个私有的知识整理空间。

这个空间中的基本单位叫做 `知识锦`。每个知识锦：

- 仅属于当前登录用户
- 有且仅有一个根节点
- 以“节点 + 连线”的图谱方式展示
- 允许创建、删除、重命名和编辑节点
- 新增节点时默认作为某个已有节点的子节点
- 根节点不可删除

## 2. 现有代码约束

### 2.1 右侧抽屉现状

当前首页/主视角右侧工具抽屉由 [frontend/src/components/game/RightUtilityDock.js](/home/wkd/neruoWar/frontend/src/components/game/RightUtilityDock.js) 和 [frontend/src/components/layout/AppShellPanels.js](/home/wkd/neruoWar/frontend/src/components/layout/AppShellPanels.js) 统一驱动。

现有 section 结构已经支持：

- `id / label / icon / badge / active / panelWidth / panel / onToggle`
- 桌面端侧滑 panel
- 移动端底部浮出 panel
- 单一 section 独占展开

这意味着 `知识锦` 最适合先作为新的 dock section 接入，而不是单独再造一套入口体系。

### 2.2 星盘现状

现有“星盘”主要是：

- 后端遍历图关系生成 graph 数据
- 前端通过 `SceneManager + WebGLNodeRenderer + starMapForceLayout` 进行展示
- 偏重查看、跳转、中心节点切换

现有链路适合“展示型星盘”，不适合“编辑型图谱”。原因：

- WebGL 节点交互已经较复杂，叠加拖拽、节点局部按钮、删除确认、临时连线会显著增加维护成本
- 当前星盘的数据来自知识域/释义关系图，而 `知识锦` 是用户私有内容图，数据源、权限和编辑频率完全不同
- 用户编辑节点内容时需要与富文本编辑器联动，React/SVG/DOM 层更容易做细粒度交互

结论：`知识锦` 不复用现有 WebGL 星盘编辑，而是采用独立的 React 图谱工作区。

### 2.3 富文本编辑器现状

当前项目已经有完整的 Tiptap 富文本链路：

- 编辑壳：[frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js)
- 阅读渲染：[frontend/src/components/senseArticle/SenseArticleRenderer.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/SenseArticleRenderer.js)

这意味着 `知识锦` 节点内容无需重新发明编辑器协议，可以复用 Tiptap 生态和既有样式/能力，但要做一层“轻量节点编辑器封装”。

## 3. 外部资料结论

本次只参考官方资料，结论如下：

- Tiptap 官方推荐将文档持久化为 JSON，`editor.getJSON()` 读取，`setContent()` 恢复。对 `知识锦` 节点这种富文本内容，JSON 比 HTML 更适合作为数据库主存储格式。
- React Flow 官方文档证明，图编辑场景天然适合“受控 nodes/edges 状态 + 更新变更”的模式，节点/边增删改和拖拽都可直接建模。

但结合当前仓库现状，我不建议第一版直接引入 React Flow：

- 当前前端依赖里没有 `@xyflow/react`
- 现有项目图形展示主栈是 Three/WebGL，不存在 React Flow 的既有封装
- `知识锦` 第一版只需要“根树 + 自由拖拽 + 子节点新增 + 删除 + 编辑”，自定义 SVG/DOM 实现就够用，依赖更少、可控性更高

因此：

- 内容编辑：沿用 Tiptap 思路
- 图谱编辑：第一版使用自定义 React + SVG 画布
- 若后续要支持任意连线、框选、多节点操作，再评估 React Flow

## 4. 产品结构

### 4.1 入口结构

右侧 dock 新增一个 section：

- `label`: `知识锦`
- `icon`: 建议使用 `BookMarked` / `Orbit` / `Network` 之一
- `panel`: `KnowledgeBrocadeDockPanel`

`KnowledgeBrocadeDockPanel` 只承担“库管理入口”，不承担完整图谱编辑。

原因：图谱编辑需要大画布，不适合塞进 520px 侧抽屉。

### 4.2 两层界面

#### A. 抽屉层：知识锦列表

能力：

- 查看我的知识锦列表
- 创建知识锦
- 重命名知识锦
- 删除知识锦
- 打开知识锦工作区

#### B. 主工作区：知识锦编辑页

新增一个独立 view：

- `view === 'jinzhi'`

工作区包含：

- 左侧或顶部：知识锦标题栏
- 中央：图谱画布
- 右侧：节点预览/操作侧栏
- 弹层：节点富文本编辑器

## 5. 核心交互规则

### 5.1 知识锦

创建知识锦时：

- 后端同时创建一个根节点
- 根节点默认标题可为 `未命名根节点`
- 根节点默认内容生成一份最小 Tiptap JSON 文档

知识锦允许：

- 创建
- 重命名
- 删除
- 打开

删除知识锦时：

- 删除知识锦本体
- 级联删除其全部节点

### 5.2 节点

每个节点包含：

- 标题
- 富文本正文
- 父节点关系
- 画布位置
- 是否根节点

显示规则：

- 节点卡片标题取“用户内容第一行标题”
- 若没有标题，则退化为第一段非空文本
- 若仍为空，则显示 `未命名节点`

### 5.3 节点操作

点击节点：

- 选中节点
- 在右侧预览区显示节点摘要和操作按钮

双击节点或点击“编辑”：

- 打开节点编辑器弹窗
- 用户编辑后点击保存

点击节点旁的 `+`：

- 直接创建一个新的子节点
- 自动建立父子关系
- 在父节点附近自动布局
- 自动选中新节点并可直接进入编辑

点击节点的菜单：

- `移动节点`
- `编辑内容`
- `重命名`
- `删除节点`

这里的“移动节点”定义为：

- 移动画布中的节点位置
- 不改变父子关系

第一版不支持“改挂父节点”。因为用户原始描述里只有“新增关联节点自动作为子节点”，没有要求图内重接父子边。

### 5.4 删除规则

- 根节点不可删除
- 非根节点删除时，默认删除整个子树

这是最安全的第一版语义，因为：

- 若只删父节点、保留孩子，会引发孩子重新挂接规则
- 若自动提升子节点，会带来意外结构变更

删除确认文案应明确：

- “删除该节点会一并删除它的全部子节点”

## 6. 数据模型

推荐新增两个集合，而不是把全部节点塞进 `User` 或单文档内嵌。

原因：

- 每个节点有独立富文本 JSON，文档体积增长很快
- 节点编辑频繁，如果整个知识锦是单文档，每次编辑都会重写整份大文档
- 分离后便于做节点级更新、缓存和并发控制

### 6.1 KnowledgeBrocade

建议文件：

- `backend/models/KnowledgeBrocade.js`

建议结构：

```js
{
  _id: ObjectId,
  ownerUserId: ObjectId,
  name: String,
  rootNodeId: ObjectId,
  nodeCount: Number,
  lastOpenedAt: Date | null,
  archivedAt: Date | null
}
```

索引：

- `{ ownerUserId: 1, updatedAt: -1 }`
- `{ ownerUserId: 1, name: 1 }`

### 6.2 KnowledgeBrocadeNode

建议文件：

- `backend/models/KnowledgeBrocadeNode.js`

建议结构：

```js
{
  _id: ObjectId,
  brocadeId: ObjectId,
  ownerUserId: ObjectId,
  parentNodeId: ObjectId | null,
  isRoot: Boolean,
  title: String,
  titleSource: String,
  previewText: String,
  position: {
    x: Number,
    y: Number
  },
  sortOrder: Number,
  contentJson: Mixed,
  contentPlainText: String
}
```

索引：

- `{ brocadeId: 1, parentNodeId: 1, sortOrder: 1 }`
- `{ brocadeId: 1, updatedAt: -1 }`
- `{ ownerUserId: 1, brocadeId: 1 }`

### 6.3 不单独存 edges

第一版不需要独立 edge collection。

父子关系由：

- `parentNodeId`

推导即可，前端在取图时生成 edges：

- `source = parentNodeId`
- `target = _id`

这样可保持：

- 根节点唯一
- 图结构稳定为有根树
- 服务端约束简单

## 7. API 设计

建议新增独立路由：

- `backend/routes/knowledgeBrocades.js`

在 `backend/server.js` 中注册：

- `app.use('/api/knowledge-brocades', knowledgeBrocadeRoutes);`

### 7.1 知识锦列表

#### `GET /api/knowledge-brocades`

返回当前用户的知识锦列表：

```json
{
  "items": [
    {
      "_id": "...",
      "name": "线性代数整理",
      "rootNodeId": "...",
      "nodeCount": 12,
      "updatedAt": "...",
      "lastOpenedAt": "..."
    }
  ]
}
```

#### `POST /api/knowledge-brocades`

请求：

```json
{
  "name": "新的知识锦"
}
```

行为：

- 创建知识锦
- 创建根节点
- 返回知识锦基础信息和根节点

#### `PATCH /api/knowledge-brocades/:brocadeId`

能力：

- 重命名
- 更新 `lastOpenedAt`

#### `DELETE /api/knowledge-brocades/:brocadeId`

行为：

- 只能删除自己的知识锦
- 级联删除全部节点

### 7.2 获取图谱

#### `GET /api/knowledge-brocades/:brocadeId/graph`

返回：

```json
{
  "brocade": {
    "_id": "...",
    "name": "...",
    "rootNodeId": "..."
  },
  "nodes": [
    {
      "_id": "...",
      "parentNodeId": null,
      "isRoot": true,
      "title": "数学",
      "previewText": "这是根节点摘要",
      "position": { "x": 0, "y": 0 },
      "updatedAt": "..."
    }
  ],
  "edges": [
    {
      "id": "parentId->childId",
      "source": "parentId",
      "target": "childId"
    }
  ]
}
```

### 7.3 节点操作

#### `POST /api/knowledge-brocades/:brocadeId/nodes`

请求：

```json
{
  "parentNodeId": "...",
  "position": { "x": 240, "y": 120 }
}
```

行为：

- 创建子节点
- 自动生成默认空正文
- 返回新节点

#### `PATCH /api/knowledge-brocades/:brocadeId/nodes/:nodeId`

支持更新：

- `title`
- `position`
- `sortOrder`

#### `GET /api/knowledge-brocades/:brocadeId/nodes/:nodeId`

返回完整节点内容：

```json
{
  "node": {
    "_id": "...",
    "title": "...",
    "contentJson": { "type": "doc", "content": [...] },
    "contentPlainText": "...",
    "position": { "x": 0, "y": 0 }
  }
}
```

#### `PUT /api/knowledge-brocades/:brocadeId/nodes/:nodeId/content`

请求：

```json
{
  "contentJson": { "type": "doc", "content": [...] }
}
```

服务端保存时同步计算：

- `title`
- `titleSource`
- `previewText`
- `contentPlainText`

#### `DELETE /api/knowledge-brocades/:brocadeId/nodes/:nodeId`

规则：

- 根节点直接拒绝
- 非根节点删除整个子树

返回：

```json
{
  "deletedNodeIds": ["...", "..."]
}
```

## 8. 标题提取规则

节点标题不单独要求用户再填一份，直接从正文提取，避免双写。

建议算法：

1. 优先读取第一条 heading block 的纯文本
2. 没有 heading 时，读取第一条 paragraph 的首行文本
3. 去除空白后截断到 32 个字符
4. 若为空，显示 `未命名节点`

这样能满足“每个节点以用户第一行的标题为显示”。

## 9. 前端实现方案

## 9.1 视图层级

### A. Dock 面板

新增：

- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeDockPanel.js`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeDockPanel.css`

职责：

- 加载知识锦列表
- 创建/删除/重命名知识锦
- 点击进入工作区

### B. 主页面

新增：

- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeWorkspacePage.js`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeWorkspacePage.css`

职责：

- 加载当前知识锦 graph
- 管理当前选中节点
- 打开节点编辑器

### C. 图谱画布

新增：

- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeGraphCanvas.js`

职责：

- 渲染节点和连线
- 支持拖拽移动
- 支持缩放/平移
- 节点按钮和菜单交互

实现建议：

- 节点层：绝对定位 DOM
- 连线层：全屏 SVG
- 平移缩放：对内容层统一 `transform`

这样比 Canvas/WebGL 更容易：

- 处理按钮点击
- 做节点 hover/selected 样式
- 和富文本弹窗配合

### D. 节点编辑器

新增：

- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeNodeEditorModal.js`

职责：

- 用 Tiptap 编辑单节点内容
- 显式保存

建议复用现有富文本链路，但做轻量版本：

- 保留基础文本、标题、列表、强调、链接
- 暂不开放百科里那一整套“引用释义/媒体库/审稿”能力

避免把 `SenseArticle` 的领域逻辑直接拖进来。

### E. 右侧详情区

新增：

- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeNodeInspector.js`

职责：

- 展示选中节点标题/摘要
- 提供 `编辑 / 添加子节点 / 删除 / 居中查看`

## 9.2 建议状态划分

### 列表状态

`useKnowledgeBrocadeLibrary`

- brocade list
- active brocade id
- create/rename/delete loading

### 工作区状态

`useKnowledgeBrocadeWorkspace`

- graph nodes
- edges
- selected node id
- viewport
- dirty flags
- debounced position save

### 编辑器状态

`useKnowledgeBrocadeNodeEditor`

- current node
- content draft
- save pending
- save error

## 10. 图谱交互细节

### 10.1 初始布局

创建知识锦后：

- 根节点放在 `(0, 0)`

新增子节点时：

- 若父节点已有子节点，则按扇形或垂直列偏移
- 若没有子节点，则默认放在父节点右下方

建议第一版采用简单规则，不接入复杂自动布局：

- 位置可预测
- 便于用户手动拖拽微调

### 10.2 拖拽

节点拖拽流程：

- pointer down 进入拖拽
- 实时更新前端位置
- 结束后 debounce 发送位置保存

保存策略：

- 拖拽结束立即提交一次
- 高频拖动不连续打接口

### 10.3 连线

连线由父子关系自动生成：

- 不允许用户手动画任意边
- 不允许同一节点多个父节点

这保证第一版始终是“有根树”，不会出现循环引用。

## 11. 权限与校验

所有接口都要求登录，并且只能操作自己的知识锦。

服务端强校验：

- `brocade.ownerUserId === req.user.userId`
- 节点必须属于指定 `brocadeId`
- 根节点不可删除
- 新建节点必须提供合法父节点
- 删除节点时必须做子树收集

建议增加上限：

- 每用户最多 `50` 个知识锦
- 每知识锦最多 `300` 个节点
- 单节点正文 JSON 序列化后不超过 `200KB`

这样可防止 UI 和 Mongo 文档过重。

## 12. 后端实现切分

建议按下面顺序落地。

### 阶段 1：数据与接口

- 新增 `KnowledgeBrocade` / `KnowledgeBrocadeNode` model
- 新增 `knowledgeBrocades` routes
- 完成列表、创建、重命名、删除
- 完成图谱获取、创建子节点、更新位置、更新内容、删除子树

### 阶段 2：抽屉入口

- 在 utility dock 中新增 `知识锦` section
- 完成 `KnowledgeBrocadeDockPanel`

### 阶段 3：工作区

- 新增 `jinzhi` view
- 完成 `KnowledgeBrocadeWorkspacePage`
- 完成节点选择、加子节点、删除、拖拽

### 阶段 4：编辑器

- 完成 `KnowledgeBrocadeNodeEditorModal`
- 保存内容后自动回填标题/摘要

### 阶段 5：体验完善

- 缩放/平移
- 节点定位到视口中央
- 最近打开记录
- 空状态与错误恢复

## 13. 建议文件清单

### 后端

- `backend/models/KnowledgeBrocade.js`
- `backend/models/KnowledgeBrocadeNode.js`
- `backend/routes/knowledgeBrocades.js`

### 前端

- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeDockPanel.js`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeDockPanel.css`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeWorkspacePage.js`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeWorkspacePage.css`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeGraphCanvas.js`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeNodeEditorModal.js`
- `frontend/src/components/knowledgeBrocade/KnowledgeBrocadeNodeInspector.js`
- `frontend/src/hooks/knowledgeBrocade/useKnowledgeBrocadeLibrary.js`
- `frontend/src/hooks/knowledgeBrocade/useKnowledgeBrocadeWorkspace.js`
- `frontend/src/utils/knowledgeBrocade/titleExtract.js`
- `frontend/src/utils/knowledgeBrocade/defaultContent.js`

### 需要接入的现有文件

- `frontend/src/components/layout/AppShellPanels.js`
- `frontend/src/GameApp.js`
- `frontend/src/hooks/app/useAppPageState.js`
- `frontend/src/app/appShared.js`
- `backend/server.js`

## 14. 测试建议

### 后端

- 创建知识锦时自动带根节点
- 删除知识锦时级联删节点
- 根节点删除被拒绝
- 删除非根节点会删除整棵子树
- 越权访问自己的之外知识锦被拒绝

### 前端

- dock 中可见 `知识锦` 按钮
- 新建知识锦后列表即时刷新
- 打开工作区后可看到根节点
- 点击 `+` 成功新增子节点
- 编辑后节点标题按正文第一行更新
- 拖拽后刷新页面位置仍保留

## 15. 关键决策总结

本设计的核心取舍如下：

- `知识锦` 入口放在右侧抽屉，但编辑工作区放到独立主视图，不把图谱编辑硬塞进窄抽屉
- 图结构第一版限定为“有根树”，不开放任意连边
- 图谱编辑不用现有 WebGL 星盘，而用 React + SVG/DOM 单独实现
- 节点正文采用 Tiptap JSON 存储
- 节点标题由正文第一行自动提取
- 删除节点采用“删除整棵子树”，根节点不可删除

这套方案更贴合你当前描述的产品需求，也更符合这个仓库现有的技术形态。
