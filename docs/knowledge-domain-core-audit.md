# 知识域核心功能改造前置分析

> 结论先行：当前仓库里，最接近“词条/释义”能力的真实落点不是单独的百科页，而是 `Node` + `NodeSense` 这一组数据结构，以及前端 `nodeDetail` / `titleDetail` 双主视角、`App.js` 内的“标题+释义选择浮层”、`CreateNodeModal` / `AdminPanel` 中的释义与关联编辑流程。项目已经具备“一个知识域下多个释义”“释义级关联”“释义修改建议”“域主/域相权限”“通知集合化存储”这些基础，但还没有真正的“释义百科页”“版本化内容模型”“双人审核状态机”“个人私有标注/高亮”“段落级编辑提交”能力。

# 1. 审计范围与阅读路径

本次审计只做阅读、梳理、归纳。以下为**实际阅读过**且与本需求直接相关的关键文件。

## 1.1 前端

- `frontend/package.json`
  - 确认前端技术栈仅为 React + `socket.io-client` + `three`，没有 `react-router`、Redux、Zustand、富文本编辑器依赖。
- `frontend/src/index.js`
  - 确认应用为单入口挂载 `App`，无路由容器。
- `frontend/src/App.js`
  - 前端知识域主调度文件；负责 `home` / `nodeDetail` / `titleDetail` / `admin` 等视图切换、搜索、通知、释义选择浮层、节点详情加载。
- `frontend/src/components/game/Home.js`
  - 首页搜索入口、公告栏、当前位置知识域侧栏；展示当前释义标题与内容摘要。
- `frontend/src/components/game/NodeDetail.js`
  - “节点主视角/释义主视角”的页面壳；承载搜索栏、导航路径、主场景容器。
- `frontend/src/components/game/KnowledgeDomainScene.js`
  - 进入知识域后的域内主场景；包含域管理、域相管理、分发规则、城防/战场等面板，是“域管理后台”现有落点。
- `frontend/src/components/modals/NodeInfoModal.js`
  - 当前“词条详情/知识域详细信息”弹层；展示概述、当前释义、创建者、域主/域相，并可触发域主申请。
- `frontend/src/components/modals/CreateNodeModal.js`
  - 创建知识域弹窗；支持一次创建多个释义，并为每个释义配置关联关系，是现有“释义录入”最完整的前端实现。
- `frontend/src/components/modals/AssociationModal.js`
  - 只展示母域/子域文本列表的旧式关联弹层；更像标题关系摘要，不是释义百科页。
- `frontend/src/components/shared/AssociationAddFlowEditor.js`
  - 释义关联编辑向导 UI，支持选择目标释义、关系类型、插入关系预览。
- `frontend/src/components/shared/associationFlowShared.js`
  - 关联编辑流程常量，确认现有关系类型为 `extends` / `contains` / `insert`。
- `frontend/src/components/admin/AdminPanel.js`
  - 系统管理员后台；现有节点审批、域主更换、释义新增/改文/删除预览/删除、释义关联编辑、域主申请审批等能力都在这里。
- `frontend/src/SceneManager.js`
  - 统一的首页/节点主视角/标题主视角场景管理器；定义中心节点按钮、节点点击行为。
- `frontend/src/LayoutManager.js`
  - 定义 `nodeDetail` 和 `titleDetail` 的图布局，确认“节点主视角”的图结构是中心节点 + 父/子节点。
- `frontend/src/WebGLNodeRenderer.js`
  - 节点标签渲染器，已支持在节点标签里同时显示标题与释义题目，说明“标题 + 释义”是当前主视觉的一部分。

## 1.2 后端路由 / API

- `backend/server.js`
  - 后端入口；确认 API 挂载在 `/api` 下，含 `nodes` / `senses` / `auth` / `users` 路由，并初始化 Socket.IO。
- `backend/routes/nodes.js`
  - 本仓库最核心的知识域路由；包含创建知识域、公开标题主视角、公开释义主视角、管理员审批、释义管理、域主/域相管理、收藏、最近访问等。
- `backend/routes/senses.js`
  - 释义相关专用路由；包含释义列表、建议提交、建议审核、评论、收藏。可视为“释义协作流”的现有后端入口。
- `backend/routes/auth.js`
  - 通知列表、已读、响应通知动作都在这里；域主申请、域相邀请/卸任等流程的消费入口在此。
- `backend/routes/users.js`
  - 当前用户分发结果等用户维度接口；与百科页需求关联较弱，但用于判断现有分页与接口风格。

## 1.3 数据模型

- `backend/models/Node.js`
  - 当前“知识域”主实体；同时承载标题、概述、嵌入式释义、域主/域相、关联关系、状态等。
- `backend/models/NodeSense.js`
  - 当前“释义”集合模型；已是释义单独集合化存储的真实基础。
- `backend/models/NodeSenseComment.js`
  - 释义评论模型；说明现有系统已经把“释义”当成一个可互动对象。
- `backend/models/NodeSenseEditSuggestion.js`
  - 释义修改建议模型；是“版本提审”最接近的现成模块，但只有单 reviewer。
- `backend/models/NodeSenseFavorite.js`
  - 释义收藏模型；说明用户行为已可精确到 `nodeId + senseId`。
- `backend/models/DomainTitleProjection.js`
  - 标题级投影模型；服务于标题主视角，不是释义百科页存储。
- `backend/models/DomainTitleRelation.js`
  - 标题关系投影模型；保留 `sourceSenseId` / `targetSenseId`，说明底层仍以释义关系为源。
- `backend/models/User.js`
  - 用户主模型；确认全局角色只有 `admin/common`，域主/域相并非全局角色，而是挂在 `Node` 上。
- `backend/models/Notification.js`
  - 站内通知集合模型；当前通知流的主读模型。
- `backend/models/UserInboxState.js`
  - 未读数状态模型；说明通知未读数已独立维护。
- `backend/models/DistributionParticipant.js`
  - 分发参与者集合模型；用于观察仓库对“事件/结果”的集合化思路。
- `backend/models/DistributionResult.js`
  - 分发结果集合模型；用于判断项目是否已有版本/结果持久化范式。
- `backend/models/ScheduledTask.js`
  - Worker 任务队列模型；当前异步通知/修复任务依赖此表。

## 1.4 服务层 / 存储层

- `backend/services/nodeSenseStore.js`
  - 释义真实读写抽象；明确 `NodeSense` 是 SoT（single source of truth），`Node.synonymSenses` 只是兼容缓存。
- `backend/services/domainTitleProjectionStore.js`
  - 标题投影与标题关系同步服务；说明标题主视角是由 `Node` 物化投影而来。
- `backend/services/domainGraphTraversalService.js`
  - 基于标题名的图遍历服务；用于移动/导航，不服务百科正文。
- `backend/services/notificationStore.js`
  - 通知集合读写层；维护 `Notification` 与 `UserInboxState`，是后续通知扩展首选复用点。
- `backend/services/domainAdminResignService.js`
  - 现有“申请 -> 审核/超时 -> 通知”服务样例，可用于审核流设计借鉴。
- `backend/services/KnowledgeDistributionService.js`
  - 已有公告/分发任务与通知写入逻辑，说明系统已有异步批量通知经验。
- `backend/services/allianceBroadcastService.js`
  - 另一个通过 worker + 通知集合发布消息的样例。
- `backend/services/schedulerService.js`
  - 任务入队 / claim / fail / complete；后续若要做异步渲染 AST、索引、批量通知，可直接复用。
- `backend/worker.js`
  - 当前 worker 执行入口；已处理 `node_sense_materialize_job`、`node_sense_backfill_job` 等任务。

## 1.5 中间件 / 权限入口

- `backend/middleware/auth.js`
  - JWT Bearer 鉴权中间件。
- `backend/middleware/admin.js`
  - 系统管理员权限校验；仅认 `user.role === 'admin'`。

## 1.6 文档与需求线索

- `readme.md`
  - 明确写出“标题+释义选择浮层”这一交互目标，并补充了“域主 + 域相”“公告通知”等业务语义。

## 1.7 页面入口 / 状态管理 / 实时通信分类总结

### 页面入口
- 首页入口：`frontend/src/components/game/Home.js`
- 节点主视角入口：`frontend/src/App.js` 中 `fetchNodeDetail`
- 标题主视角入口：`frontend/src/App.js` 中 `fetchTitleDetail`
- 释义详情弹层入口：`frontend/src/components/modals/NodeInfoModal.js`
- 创建 / 关联编辑入口：`frontend/src/components/modals/CreateNodeModal.js`
- 系统审批入口：`frontend/src/components/admin/AdminPanel.js`
- 域管理入口：`frontend/src/components/game/KnowledgeDomainScene.js`

### 状态管理
- 全局状态中心：`frontend/src/App.js`
- 局部状态：各组件内部 `useState`
- 持久化：`localStorage`（如最近页面状态、token）
- 无：Redux / Zustand / Context 统一 store

### API
- 公开详情 API：`backend/routes/nodes.js`
- 释义协作 API：`backend/routes/senses.js`
- 通知 API：`backend/routes/auth.js`
- 用户结果 API：`backend/routes/users.js`

### 实时通信
- Socket 服务端：`backend/server.js`
- Socket 客户端：`frontend/src/App.js`
- 实际使用：管理员 `admin-sync-pending` 同步提醒；通知列表本体仍以前端轮询拉取为主。

# 2. 现有“知识域 / 词条 / 释义 / 节点”概念梳理

## 2.1 总体判断

当前项目里，**“知识域”是真实主实体**；“词条”没有单独后端实体；“释义”已经有独立数据结构；“节点”基本就是知识域节点；“标题主视角”与“释义主视角”是两套围绕同一 `Node` 的不同展示方式。

## 2.2 概念映射

### 概念：知识域
- 对应代码位置
  - 模型：`backend/models/Node.js`
  - 标题投影：`backend/models/DomainTitleProjection.js`
  - 页面：`frontend/src/components/game/Home.js`、`frontend/src/components/game/NodeDetail.js`、`frontend/src/components/game/KnowledgeDomainScene.js`
  - 公开 API：`backend/routes/nodes.js` 中 `/public/node-detail/:nodeId`、`/public/title-detail/:nodeId`
- 当前作用
  - `Node` 承载知识域名称、概述、释义列表、域主/域相、关联关系、状态等全部主数据。
  - 公开详情与主视角都围绕 `Node` 展开。
- 与目标需求差距
  - 目标 A 说“一个知识域类似一个词条，一个词条下面有多个释义”；当前实现基本符合，但“词条”只是 `Node.name` 层面的概念，不是单独实体。
  - 缺少独立的“释义百科页”载体，当前只有释义字符串挂在节点详情中。

### 概念：词条
- 对应代码位置
  - 前端文案：`frontend/src/components/modals/NodeInfoModal.js` 中 simpleOnly 模式标题写“词条详情”
  - 交互：`frontend/src/App.js` 的标题+释义选择浮层将 `Node.name` 作为标题、`synonymSenses` 作为释义列表
  - 标题主视角：`backend/routes/nodes.js` 的 `/public/title-detail/:nodeId`
- 当前作用
  - 词条更像“标题级展示层”，对应 `Node.name` 或 `DomainTitleProjection.name`。
  - 标题主视角聚合同一节点及邻接标题关系。
- 与目标需求差距
  - 后端没有 `Entry` / `Article` / `WikiPage` 之类独立实体。
  - 词条没有独立正文，正文实际还是每个 `sense.content`。
  - 因此当前更准确的结构是：`Node(知识域/词条标题) -> NodeSense(多个释义)`。

### 概念：释义
- 对应代码位置
  - 嵌入式结构：`backend/models/Node.js` 的 `synonymSenses`
  - 集合结构：`backend/models/NodeSense.js`
  - 读写抽象：`backend/services/nodeSenseStore.js`
  - 释义 API：`backend/routes/senses.js`
  - 节点详情展示：`backend/routes/nodes.js` 的 `pickNodeSenseById` / `/public/node-detail/:nodeId`
  - 前端选择浮层：`frontend/src/App.js` 的 `renderSenseSelectorPanel`
- 当前作用
  - 一个知识域下有多个 `senseId/title/content`。
  - 已支持按 `senseId` 切换当前主视角释义。
  - 已支持释义评论、收藏、建议修改。
- 与目标需求差距
  - 释义正文只有纯字符串 `content`，没有百科页结构。
  - 没有 heading、目录、公式、私有标注、版本树、段落锚点。

### 概念：节点
- 对应代码位置
  - 模型：`backend/models/Node.js`
  - 主视角布局：`frontend/src/LayoutManager.js` 的 `calculateNodeDetailLayout`
  - 渲染：`frontend/src/SceneManager.js` / `frontend/src/WebGLNodeRenderer.js`
- 当前作用
  - 视觉层面，节点就是图谱中的圆形点位。
  - 数据层面，节点就是知识域主实体。
- 与目标需求差距
  - “节点”与“知识域”在当前系统中高度重合，尚未拆出“节点视图”和“百科页实体”。

## 2.3 “标题+释义选择浮层”在哪里实现

- 代码位置
  - 浮层状态：`frontend/src/App.js` 中 `senseSelectorSourceNode`、`senseSelectorAnchor`、`isSenseSelectorVisible`
  - 浮层渲染：`frontend/src/App.js` 中 `renderSenseSelectorPanel`
  - 视角切换：`frontend/src/App.js` 中 `handleSwitchTitleView`、`handleSwitchSenseView`
  - 浮层触发：`frontend/src/App.js` 中场景节点点击逻辑；`SceneManager` 中中心节点按钮 `showSenseEntry`
- 当前作用
  - 在首页或主视角点击中心节点时，展示“标题按钮 + 释义列表 + 域主/域相 + 包含/扩展关系摘要”。
  - 可以在标题主视角和释义主视角之间切换。
- 与目标需求差距
  - 这里只有“选择/切换”，没有“释义百科页入口”按钮，也没有全文正文展示能力。

## 2.4 节点主视角是什么

- 对应代码位置
  - 前端视图状态：`frontend/src/App.js` 中 `view === 'nodeDetail'`
  - 页面组件：`frontend/src/components/game/NodeDetail.js`
  - 布局：`frontend/src/LayoutManager.js` 的 `calculateNodeDetailLayout`
  - 场景管理：`frontend/src/SceneManager.js` 切换到 `nodeDetail`
  - 数据接口：`backend/routes/nodes.js` 的 `/public/node-detail/:nodeId`
- 当前作用
  - 中心节点代表当前知识域的“当前释义主视角”；上方/下方为父/子知识域节点。
  - 当前释义由 `activeSenseId/activeSenseTitle/activeSenseContent` 标识。
- 与目标需求差距
  - 节点主视角只承载图谱关系和少量摘要，不是百科正文页。
  - 如果要把“百科页入口放在各个释义节点的主视角上”，当前中心节点按钮是最佳挂载点，但正文承载区尚不存在。

## 2.5 当前从“节点”进入详情内容的路径

- 路径 1：首页节点点击 -> 释义选择浮层 -> 切到 `nodeDetail`
  - `frontend/src/App.js` 节点点击后调用 `fetchNodeDetail`
  - `fetchNodeDetail` 请求 `GET /api/nodes/public/node-detail/:nodeId?senseId=...`
- 路径 2：标题主视角 -> 释义选择浮层 -> 切到 `nodeDetail`
- 路径 3：节点主视角中心按钮 `showSenseEntry` -> `NodeInfoModal`
  - 这里只打开信息弹层，不进入独立页面
- 路径 4：搜索结果点击 -> 直接带 `senseId` 进入 `nodeDetail`
  - 搜索结果来自 `GET /api/nodes/public/search`

## 2.6 如果没有真正的释义百科页，缺口在哪里

**明确缺口：当前没有“释义百科页”实体、页面、路由、存储模型。**

- 现有正文只存在于：
  - `Node.synonymSenses[].content`
  - `NodeSense.content`
- 现有展示只存在于：
  - `nodeDetail` 中的 `activeSenseContent`
  - `Home` / `NodeInfoModal` 中的摘要文本
- 不存在：
  - `MeaningArticle` / `SenseArticle` / `EntryPage` 等单独模型
  - `/sense-article/:id` 之类页面或 `view === 'senseArticle'`
  - 富文本 AST / block / markdown-like 文档结构
  - 标题目录、页内锚点、跨释义引用渲染器

## 2.7 关系图（按代码关系）

- `Node`
  - 内含 `name` / `description`
  - 内含 `synonymSenses[]`
  - 内含 `associations[]`
  - 内含 `domainMaster` / `domainAdmins`
- `NodeSense`
  - 用 `nodeId + senseId` 对应 `Node` 内某个释义
  - 由 `nodeSenseStore.saveNodeSenses()` 与 `Node.synonymSenses` 双写/物化
- `DomainTitleProjection`
  - 由 `Node` 投影而来，服务标题主视角
- `DomainTitleRelation`
  - 由 `Node.associations` 投影而来，保留 `sourceSenseId/targetSenseId`
- `NodeSenseEditSuggestion`
  - 指向 `nodeId + senseId`
  - 提交后由域主/域相/管理员单人审核
- `NodeSenseComment` / `NodeSenseFavorite`
  - 也都是围绕 `nodeId + senseId`

## 2.8 深挖补充：当前“释义入口”与“释义详情”的真实落点

### 概念：节点主视角上的“释义入口按钮”
- 对应代码位置：`frontend/src/SceneManager.js` 的 `setupCenterNodeButtons()` / `setupSenseDetailButton()`，按钮 `action` 固定为 `showSenseEntry`
- 当前作用：在中心节点上渲染一个 `i` 按钮，tooltip 为“查看释义词条详情”
- 与目标需求差距：按钮名虽然像“词条详情入口”，但 `frontend/src/App.js` 中 `onButtonClick` 的真实处理是 `setNodeInfoModalTarget(currentNodeDetail); setShowNodeInfoModal(true);`，即仅打开 `NodeInfoModal`，并不会进入独立正文页

### 概念：标题+释义选择浮层
- 对应代码位置：`frontend/src/App.js` 的 `renderSenseSelectorPanel()`
- 当前作用：
  - 展示 `overviewNode.synonymSenses`
  - 点击标题触发 `handleSwitchTitleView`
  - 点击某个释义触发 `handleSwitchSenseView(senseId)`
  - 在 `nodeDetail` 下额外展示当前释义的 `包含/扩展` 关系标签
- 与目标需求差距：
  - 它是“切换视角/切换当前释义”的浮层，不是“进入某个释义百科页”的入口页
  - 浮层只展示概述、域主/域相、标签化关系，不展示长文正文、目录、锚点、版本信息

### 概念：释义详情弹层
- 对应代码位置：`frontend/src/components/modals/NodeInfoModal.js` + `frontend/src/App.js` 的 `showNodeInfoModal`
- 当前作用：展示知识域基础信息、当前释义标题/内容摘要、域主/域相信息，并承接域主申请等动作
- 与目标需求差距：
  - 弹层内容仍然是“信息卡片”，不是“正文阅读页”
  - 交互设计偏短信息操作，不适合承载目录、页内搜索、私有标注、版本审阅

### 概念：从节点进入详情内容的真实路径
- 对应代码位置：`frontend/src/App.js`、`frontend/src/SceneManager.js`
- 当前作用：当前仓库实际上有两条内容路径：
  1. `handleSwitchSenseView(senseId)` / 搜索命中 `senseId` -> `fetchNodeDetail()` -> `view = 'nodeDetail'`
  2. `showSenseEntry` -> `NodeInfoModal`
- 与目标需求差距：
  - 两条路径都没有落到“释义页正文模型”上
  - `nodeDetail` 仍是图谱主视角；`NodeInfoModal` 仍是资料卡弹窗

### 概念：canonical 详情响应
- 对应代码位置：`backend/routes/nodes.js` 的 `loadCanonicalNodeResponseById()`
- 当前作用：先 `hydrateNodeSensesForNodes([node])`，再 `normalizeNodeSenseList(node)` 回填 `nodeObj.synonymSenses`，最后调用 `Node.applyKnowledgePointProjection()`
- 与目标需求差距：
  - 当前公开详情响应仍以 `Node` 为核心封装单位，而不是 `NodeSenseArticle`
  - 如果后续新增百科页实体，必须先决定：是继续在 `Node` canonical response 中内嵌 article 摘要，还是单独新增释义页 API

### 深层判断
- 当前“释义”在数据层已独立（`NodeSense`），但在页面层仍是 `Node` 的一个子视角。
- 因此，后续改造若要最小侵入，应把“百科页”视为**以 `nodeId + senseId` 寻址的新页面能力**，而不是继续给 `NodeInfoModal` 或 `nodeDetail` 堆功能。

# 3. 前端现状盘点：释义入口、详情页、弹层、路由、状态

## 3.1 现有知识域相关页面/组件/弹层

### 首页与图谱入口
- `frontend/src/components/game/Home.js`
  - 首页搜索、公告栏、当前位置知识域侧栏。
  - 已展示当前释义标题/内容摘要，但不支持深入编辑或长文阅读。
- `frontend/src/App.js`
  - 通过 `view` 状态管理页面：`home` / `nodeDetail` / `titleDetail` / `admin` / `profile` / `army` 等。
  - 没有 React Router，所有“页面”本质上都是条件渲染。
- `frontend/src/SceneManager.js`
  - 管理点击节点后的跳转和中心按钮。
  - `setupCenterNodeButtons()` 已有 `showSenseEntry` 动作，是新增“百科页入口”的自然挂点。

### 节点/标题主视角
- `frontend/src/components/game/NodeDetail.js`
  - 当前释义主视角页面壳。
  - 已承接搜索、导航路径、场景画布，但未承接正文阅读区。
- `frontend/src/components/game/KnowledgeDomainScene.js`
  - 进入知识域后的域内场景，不是释义详情页，但它承担“域管理后台”的现有角色。
- `frontend/src/App.js` + `backend/routes/nodes.js` 的 `titleDetail`
  - 标题主视角，用于看标题间图谱关系，不适合承载百科正文。

### 弹层/面板
- `frontend/src/components/modals/NodeInfoModal.js`
  - 当前最像“词条详情”的弹层，但只有概述 + 当前释义 + 管理者信息。
- `frontend/src/components/modals/CreateNodeModal.js`
  - 当前最完整的释义录入界面；支持多个释义卡片、每个释义建立关联。
- `frontend/src/components/modals/AssociationModal.js`
  - 只展示父域/子域列表，信息维度很浅。
- `frontend/src/components/admin/AdminPanel.js`
  - 管理员专用大面板，已支持：待审节点、域主申请审批、节点编辑、释义新增/改文/删除、关联编辑。

## 3.2 哪些组件最适合承载“释义百科页入口”

### 最小侵入接入点
1. `frontend/src/App.js` 的 `renderSenseSelectorPanel`
   - 已经列出某个标题下的所有释义。
   - 可直接在每个 `sense-selector-item` 旁追加“进入百科页”入口。
2. `frontend/src/SceneManager.js` 的中心节点按钮 `showSenseEntry`
   - 当前只打开 `NodeInfoModal`。
   - 可升级为“打开释义百科页/百科抽屉”。
3. `frontend/src/components/modals/NodeInfoModal.js`
   - 现有信息弹层底部已有“进入知识域”按钮。
   - 可以再加“查看百科页”按钮，作为低风险过渡方案。

### 长期合理接入点
1. 新增 `App.js` 顶层视图，例如 `view === 'senseArticle'`
   - 与 `home` / `nodeDetail` / `titleDetail` 并列。
   - 更适合承载长文、目录、页内搜索、版本侧栏、审稿侧栏。
2. 在 `nodeDetail` 内新增右侧正文区
   - 复用现有主视角上下文，但会与当前图谱/搜索布局争抢空间。
3. 在 `KnowledgeDomainScene` 增加“内容管理/版本审核”侧栏
   - 更适合编辑与审核，不适合公开阅读主页面。

## 3.3 当前有没有路由系统？百科页更适合哪种模式？

### 当前是否有路由系统
- **没有。**
- 代码依据：
  - `frontend/package.json` 无 `react-router-dom`
  - `frontend/src/index.js` 直接渲染 `App`
  - `frontend/src/App.js` 通过 `const [view, setView] = useState('login')` 管理“页面”

### 四种模式判断

#### 1）弹层模式
- 兼容性：高
- 原因：当前项目已有大量 `modal-backdrop` 弹层体系。
- 问题：百科页是重内容页面，长文、目录、搜索、评论、版本、审核侧栏会让 modal 迅速失控。

#### 2）侧边抽屉模式
- 兼容性：中
- 原因：当前虽然没有统一 Drawer 组件，但已有侧栏/右 dock/管理侧面板实践。
- 问题：正文太长时可读性仍差，且会与 `NodeDetail` / `KnowledgeDomainScene` 的浮层体系冲突。

#### 3）独立路由页模式
- 兼容性：中偏低（当前） / 长期最佳（改造后）
- 原因：当前没有 Router，需要新增新的页面状态或正式引入路由。
- 优点：最适合百科页、版本比较、审核工作台、全文搜索与标注。

#### 4）节点主视角内嵌模式
- 兼容性：中
- 原因：最贴近“释义节点主视角有百科入口”的感觉。
- 问题：现有 `nodeDetail` 是图谱页壳，不是文档页壳；内嵌正文容易和 WebGL 画布、搜索栏、导航路径互相挤压。

### 本次判断
- **最小侵入接入点**：先做“`nodeDetail` 中心节点 -> 打开百科抽屉/全屏覆盖层”。
- **长期合理接入点**：做新的顶层页面状态（等价于独立路由页），例如 `senseArticle`。
- **不建议长期停留在纯 modal 模式。**

## 3.4 现有全局状态管理方式

- 主方式：`frontend/src/App.js` 中大量 `useState` / `useRef`
- 组件内局部状态：`Home.js`、`KnowledgeDomainScene.js`、`CreateNodeModal.js`、`AdminPanel.js`
- 场景状态：`SceneManager` / `LayoutManager` / `WebGLNodeRenderer`
- 本地持久化：`localStorage`
- 不存在：Context 全局 store、Redux、Zustand

### 影响
- 做百科页时，短期新增一个 `view` 和几组状态是可行的。
- 但如果继续叠加目录、搜索、标注、版本、审核，多状态散落在 `App.js` 和大型组件中，维护成本会快速升高。

## 3.5 搜索、高亮、选区、键盘快捷键、文本渲染能力现状

### 搜索
- 已有全局节点/释义搜索：
  - 前端：`Home.js`、`NodeDetail.js`
  - 后端：`GET /api/nodes/public/search`
- 搜索粒度：标题 + 释义题目 + 部分内容召回
- 缺口：没有“页内搜索”，没有对单篇正文建立章节索引

### 高亮
- 已有关键词高亮：
  - `Home.js` / `NodeDetail.js` 里的 `renderKeywordHighlight()`，用 `<mark>` 渲染搜索命中
- 缺口：没有用户私有高亮、没有持久化高亮区间

### 选区
- 没读到 `window.getSelection()`、`Range`、文本锚点模型等实现
- 结论：**当前没有“选中一段文本发起编辑/标注”的基础设施**

### 键盘快捷键
- 已有少量 `Enter` 触发搜索/提交
- 没有统一热键系统

### 文本渲染
- 当前几乎都是纯文本直接渲染
- 未见 Markdown 解析、AST 渲染、富文本渲染器

## 3.6 是否已有可复用的 Modal / Drawer / Tabs / Toast / Notification / Rich text 基础

### 可复用
- Modal：有，大量组件采用 `modal-backdrop` / `modal-content`
- Tabs：有，但都是业务内手写，如 `KnowledgeDomainScene.js` 的 `activeTab`
- Toast：有局部实现，如 `KnowledgeDomainScene.js` 的 `distributionToast`
- Notification：有全局通知中心，`App.js` + `/api/notifications`

### 不足
- Drawer：没有明确的通用抽屉组件
- Rich text：没有
- Markdown renderer：没有
- 文本选择/注解 UI：没有

## 3.7 组件树层面的判断

- `App`
  - `Home`
  - `NodeDetail`
  - `KnowledgeDomainScene`
  - `AdminPanel`
  - `NodeInfoModal`
  - `CreateNodeModal`
  - `AssociationModal`

### 对百科页的启示
- 公共阅读入口最适合加在 `App` 这一层，因为它已掌控主视图切换。
- 释义内容编辑入口最适合先挂在 `AdminPanel` 和 `KnowledgeDomainScene` 的管理区域。
- 审核页入口更适合挂在 `KnowledgeDomainScene` 的管理 tab 或新建“工作台”视图，而不是塞进 `NodeInfoModal`。

## 3.8 潜在冲突

- `App.js` 视图切换已很重，再叠加百科页、审核页可能继续膨胀。
- `nodeDetail` 当前依赖 WebGL 场景与浮动搜索，内嵌长文会挤占画布空间。
- 现有弹窗体系偏“轻操作”，不适合“百科长文 + 目录 + 版本审核”的重界面。
- 没有 Router，浏览器级 URL 与分享能力暂时缺失。

## 3.9 深挖补充：现有后台已经存在“预览 -> 决策 -> 执行”的复杂交互范式

### 3.9.1 管理员待审批页不是简单列表，而是“多候选对比 + 多释义切换”界面

- 关键代码：`frontend/src/components/admin/AdminPanel.js`
  - `fetchPendingNodes()` -> `GET /api/nodes/pending`
  - `fetchPendingMasterApplications()` -> `GET /api/notifications` 后前端过滤 `type === 'domain_master_apply' && status === 'pending'`
  - `approveNode()` -> `POST /api/nodes/approve`
  - `rejectNode()` -> `POST /api/nodes/reject`
  - `reviewMasterApplication()` -> `POST /api/notifications/:notificationId/respond`
- 关键 UI 行为：
  - `groupedPendingNodes` 会把**同名待审知识域**分组，UI 直接显示“同名申请竞争”
  - 单个待审知识域卡片内，会把 `synonymSenses` 渲染成 chip 列表
  - 选中某个 chip 后，会展示该释义正文摘要和该释义关联关系列表
- 对本次需求的启发：
  - 后续“释义版本审核页”完全可以沿用这套“版本列表 -> 选择一个版本 -> 查看其正文/差异/关系影响”的交互思路
  - 当前后台已经习惯把“多个候选方案”放在一个管理视图里对比，而不是只做单条审批弹窗

### 3.9.2 管理员删除释义 UI 已经是“关系影响审阅页”

- 关键代码：`frontend/src/components/admin/AdminPanel.js`
  - `fetchDeleteSensePreview()` -> `POST /api/nodes/:nodeId/admin/senses/:senseId/delete-preview`
  - `confirmDeleteSense()` -> `DELETE /api/nodes/:nodeId/admin/senses/:senseId`
  - 相关状态：`deleteSensePreviewData`、`deleteSenseBridgeDecisions`、`showDeleteSenseDecisionModal`
- 关键 UI 行为：
  - 删除前先展示“删除前关联总数 / 删除后关联总数”
  - 中间区块展示 `beforeRelations` 与 `reconnectLines`
  - 若存在 `lostBridgePairs`，界面会把待处理桥接关系单独列出
  - 点击某条待处理关系后，会打开二级 modal，强制用户在“保留承接(reconnect)”与“断开独立(disconnect)”中二选一
  - 未处理完全部桥接关系前，确认删除按钮不会点亮
- 对本次需求的启发：
  - 这套交互非常适合迁移到“正文局部改写导致目录锚点/跨释义引用失效”的预审过程
  - 当前前端已接受“先预览影响，再确认变更”的工作流，后续无需另起一套完全不同的审阅语言

### 3.9.3 关联编辑 UI 也依赖后端 preview，而不是本地直接保存

- 关键代码：`frontend/src/components/admin/AdminPanel.js`
  - `previewAssociationEdit()` -> `POST /api/nodes/:nodeId/associations/preview`
  - `saveAssociationEdit()` -> `PUT /api/nodes/:nodeId/associations`
- 关键行为：
  - 保存前先请求 preview
  - 若返回 `bridgeDecisionItems`，前端会补齐默认 `disconnect`
  - 若 `unresolvedBridgeDecisionCount > 0`，直接拒绝保存
  - 另有 `applyUpperReassignPlan()` 用于“删除主关联后，再把下级改接到新的上级”
- 对本次需求的启发：
  - 当前仓库对“结构变更”的默认设计不是乐观直存，而是**先让后端算影响面，再由前端承接决策**
  - 后续百科页如果有“按小标题范围提交修订”，这套 preview 范式很值得复用

### 3.9.4 最小侵入接入点与长期合理接入点补充判断

- 最小侵入接入点：
  - `SceneManager.js` 的 `showSenseEntry`
  - `App.js` 的 `renderSenseSelectorPanel()`
  - 理由：当前所有“从图谱到释义”的用户心智都已经经过这两个入口
- 长期合理接入点：
  - `App.js` 新增 `view === 'senseArticle'` 或同类独立视图
  - `KnowledgeDomainScene.js` / `AdminPanel.js` 新增审核工作区
  - 理由：阅读页与管理/审核页都已超出当前弹层载荷
- 明确冲突：
  - 若把百科页直接塞进 `NodeInfoModal`，会与当前轻弹窗形态冲突
  - 若把百科页直接塞进 `nodeDetail`，会与 WebGL 画布主导布局冲突
  - 因此前端结构上最稳妥的是“保留现有入口，但把真正阅读页提升为新的 view”

# 4. 后端现状盘点：模型、接口、权限、审核、通知

## 4.1 模型 / 接口 / 中间件 / 服务映射

| 类型 | 位置 | 现有能力 | 可复用性 | 主要缺口 |
|---|---|---|---|---|
| 模型 | `backend/models/Node.js` | 知识域主实体，含标题、概述、释义缓存、关系、域主/域相、状态 | 高 | 没有百科页正文结构、没有版本表、没有段落锚点 |
| 模型 | `backend/models/NodeSense.js` | 释义集合化存储，`nodeId + senseId` 唯一 | 很高 | 只有 `title/content/order/status`，无 articleId / source / AST / version |
| 模型 | `backend/models/NodeSenseEditSuggestion.js` | 释义修改建议、单 reviewer 审核 | 很高 | 单 reviewer；不是正式版本记录；无 diff / reviewers[] |
| 模型 | `backend/models/NodeSenseComment.js` | 释义评论 | 中 | 仅评论，不是标注 |
| 模型 | `backend/models/NodeSenseFavorite.js` | 释义收藏 | 中 | 只能收藏，不能高亮/私注 |
| 模型 | `backend/models/DomainTitleProjection.js` | 标题级投影，服务标题主视角 | 中 | 不是正文页模型 |
| 模型 | `backend/models/DomainTitleRelation.js` | 标题关系投影，保留 sense 级字段 | 中高 | 不支持正文内部引用锚点 |
| 模型 | `backend/models/User.js` | 用户、全局角色、收藏、最近访问、嵌入式旧通知 | 高 | 无独立 Role 模型；无审核工作台字段 |
| 模型 | `backend/models/Notification.js` | 站内通知集合 | 很高 | 通知类型暂不含“释义版本审核” |
| 模型 | `backend/models/UserInboxState.js` | 未读数、最近通知时间 | 高 | 无分类未读细分 |
| 服务 | `backend/services/nodeSenseStore.js` | 释义 SoT、collection/embedded 双写与修复 | 很高 | 只管文本，不管版本/审稿 |
| 服务 | `backend/services/notificationStore.js` | 通知写库、已读、未读数 | 很高 | 缺少审核类通知模板 |
| 服务 | `backend/services/schedulerService.js` | 简单任务队列 | 高 | 无审核 SLA / reminder 专用任务 |
| 服务 | `backend/worker.js` | 异步执行 materialize / backfill / broadcast 等 | 高 | 暂无审核提醒任务 |
| 路由 | `backend/routes/nodes.js` | 创建知识域、公开详情、管理员审批、释义管理、域主/域相管理 | 很高 | 文件过大；新能力继续堆这里会恶化 |
| 路由 | `backend/routes/senses.js` | 释义建议、审核、评论、收藏 | 很高 | 审核能力过于轻量 |
| 路由 | `backend/routes/auth.js` | 通知读取、已读、响应动作 | 高 | 审核通知类型需扩展 |
| 中间件 | `backend/middleware/auth.js` | JWT 鉴权 | 高 | 仅做认证，不做细粒度资源授权 |
| 中间件 | `backend/middleware/admin.js` | 系统管理员判断 | 中 | 仅系统级，域级角色仍靠业务代码判断 |

## 4.2 现有与需求最相关的后端能力

### 知识域 / 节点
- 主体模型为 `Node`
- 创建入口：`POST /api/nodes/create`
- 公开详情：
  - `GET /api/nodes/public/title-detail/:nodeId`
  - `GET /api/nodes/public/node-detail/:nodeId`

### 释义
- 释义模型：`NodeSense`
- 读写抽象：`saveNodeSenses()` / `resolveNodeSensesForNode()`
- 管理员释义接口：
  - `POST /api/nodes/:nodeId/admin/senses`
  - `PUT /api/nodes/:nodeId/admin/senses/:senseId/text`
  - `POST /api/nodes/:nodeId/admin/senses/:senseId/delete-preview`
  - `DELETE /api/nodes/:nodeId/admin/senses/:senseId`
- 轻量释义接口：`backend/routes/senses.js`
  - 列表、建议、评论、收藏

### 审核
- 已有 3 类审核/审批链路：
  1. 知识域创建审批：管理员在 `POST /api/nodes/approve`、`POST /api/nodes/reject`
  2. 域主申请审批：管理员通过通知 `POST /api/notifications/:notificationId/respond`
  3. 释义修改建议审批：域主/域相/管理员通过 `POST /api/senses/node/:nodeId/:senseId/suggestions/:suggestionId/review`
- 这说明“提交流 + 单步审批 + 通知回执”范式已经存在

### 通知
- 读取：`GET /api/notifications`
- 全部已读：`POST /api/notifications/read-all`
- 单条已读：`POST /api/notifications/:notificationId/read`
- 响应型通知：`POST /api/notifications/:notificationId/respond`
- 存储：`Notification` + `UserInboxState`
- 兼容旧结构：`User.notifications`

## 4.2.1 深挖补充：释义关联不是轻量标签，而是带预览、重连和互反同步的事务流程

### 关联编辑权限口径
- 关键代码：`backend/routes/nodes.js` 的 `validateAssociationMutationPermission()`
- 已确认事实：只有**系统管理员**或**该知识域域主**可以编辑 `Node.associations`
- 与其它权限的冲突：
  - `backend/routes/senses.js` 的 `canManageNodeSenses()` 允许域主、域相、管理员审核释义建议
  - 但真正 `PUT /api/nodes/:nodeId/associations` 不接受域相直接修改
- 对需求的影响：
  - 如果将来“释义百科页版本”包含跨释义引用修改，必须先明确：这属于“正文引用编辑”还是“图谱关联编辑”
  - 若直接复用现有关联，将自动落入“域主/管理员可改、域相不可改”的权限口径

### `insert` 关系不是最终存储形态
- 关键代码：`backend/routes/nodes.js` 的 `resolveAssociationsWithInsertPlans()`
- 已确认事实：
  - `relationType === 'insert'` 只是输入草稿语义
  - 落库存储前会被展开成两条真实关系：
    - 当前释义 `extends` 上级释义
    - 当前释义 `contains` 下级释义
  - 同时生成 `insertPlans[]`，后续供 `applyInsertAssociationRewire()` 重写原有链路
- 对需求的影响：
  - 若未来正文中出现“把某释义插入另一条链条中”的百科语法，后端现有逻辑可复用其**关系重写规则**
  - 但这也说明正文层的“引用/插入”并非纯展示能力，而会改动图谱结构

### 删除/改关联前会先做桥接对预览
- 关键代码：
  - `computeLostBridgePairs()`
  - `resolveReconnectPairsByDecisions()`
  - `buildAssociationMutationSummary()`
  - `buildAssociationMutationPreviewData()`
- 已确认事实：
  - 系统会比较 `oldAssociations` 与 `nextAssociations`
  - 找出删除某条关系或某个释义后消失的“上级 -> 当前 -> 下级”桥接链
  - 对每个桥接链生成 `pairKey`
  - 由 `bridgeDecisions` 决定该链删除后是 `reconnect` 还是 `disconnect`
  - preview summary 会返回：
    - `beforeRelations`
    - `afterRelations`
    - `removed`
    - `added`
    - `lostBridgePairs`
    - `reconnectLines`
    - `insertPlanNarratives`
- 对需求的影响：
  - 现有系统已经有“结构变更影响分析器”雏形
  - 后续正文版本提交如果涉及标题锚点、跨释义引用失效，也可沿用“先出 summary，再确认”的技术路线

### 删除释义不是简单删文本，而是带图谱修复的事务
- 关键接口：
  - `POST /api/nodes/:nodeId/admin/senses/:senseId/delete-preview`
  - `DELETE /api/nodes/:nodeId/admin/senses/:senseId`
- 已确认事实：
  - 删除前统一走 `buildAssociationMutationPreviewData()`
  - 若存在 `lostBridgePairs` 且还有未决策项，接口直接拒绝执行
  - 删除成功后还会继续执行：
    - `saveNodeSenses(...)`
    - `syncDomainTitleProjectionFromNode(node)`
    - `applyReconnectPairs(...)`（如有）
    - `syncReciprocalAssociationsForNode(...)`
- 对需求的影响：
  - 当前“释义”已不是可任意删改的自由文本，而是图谱拓扑节点
  - 未来百科页若引入“跨释义引用锚点”，要谨慎区分：哪些引用只是正文内链接，哪些会影响知识域关系图

### 互反关系会被自动同步
- 关键代码：`backend/routes/nodes.js` 的 `syncReciprocalAssociationsForNode()`
- 已确认事实：
  - A `contains` B 时，对端自动补 B `extends` A
  - A `extends` B 时，对端自动补 B `contains` A
  - 若对端已经存在相反方向冲突关系，还会先删再补
  - 同步结束后会 `rebuildRelatedDomainNamesForNodes(dirtyNodes)` 并更新标题投影
- 对需求的影响：
  - 这是一条非常强的系统约束
  - 因此**正文中的跨释义引用不建议直接等同于 `contains/extends/insert`**，否则会无意触发双向图谱副作用

## 4.2.2 深挖补充：权限口径当前并不一致

- `POST /api/nodes/:nodeId/admin/senses`、`PUT /api/nodes/:nodeId/admin/senses/:senseId/text`、`DELETE /api/nodes/:nodeId/admin/senses/:senseId`
  - 路由守卫：`authenticateToken, isAdmin`
  - 含义：新增释义、直接改释义正文、删除释义，目前是**系统管理员专属能力**
- `POST /api/senses/node/:nodeId/:senseId/suggestions/:suggestionId/review`
  - 权限：域主 / 域相 / 系统管理员
  - 含义：释义修改建议审核可以下放给域主/域相
- `PUT /api/nodes/:nodeId/associations`
  - 权限：系统管理员 / 域主
  - 含义：图谱关联编辑不向域相开放

### 结论
- 当前仓库已经形成三条不同权限带：
  1. **系统管理员直改释义**
  2. **域主/域相/管理员审核释义建议**
  3. **域主/管理员编辑图谱关联**
- 这对后续“释义百科页版本提审”是关键前置信息：
  - 若正文版本包含关系引用变更，权限口径会立刻发生冲突
  - 改造前必须先定义“正文内跨释义引用”究竟算正文内容还是算图谱结构

## 4.3 当前是否已有审核流、提交流、公告流、消息通知流、站内信、待办、未读数

### 已有
- 提交流：有
  - 节点创建申请
  - 域主申请
  - 域相卸任申请
  - 释义修改建议提交
- 审核流：有，但分散
  - 管理员审批知识域创建
  - 域主/域相/管理员审核释义建议
  - 管理员审批域主申请
- 公告流：有
  - 知识点分发公告、熵盟公告
- 消息通知流：有
  - `Notification` + `/api/notifications`
- 未读数：有
  - `UserInboxState.unreadCount`

### 没有或不足
- 统一“待办中心”：没有独立工作台页面
- 释义版本审核页：没有
- 双人确认审核状态机：没有
- 审核评论历史 / 审核步骤日志：没有成体系表结构

## 4.4 当前权限体系如何表达

### 全局角色
- `User.role` 只有 `admin` / `common`
- 代码位置：`backend/models/User.js`

### 域级角色
- 域主：`Node.domainMaster`
- 域相：`Node.domainAdmins[]`
- 代码中的判断方式：
  - `isDomainMaster(node, userId)`
  - `isDomainAdmin(node, userId)`
  - `canManageNodeSenses()`

### 结论
- “普通用户、域主、域相、管理员”并非统一角色系统，而是：
  - 普通/管理员：全局角色
  - 域主/域相：节点级关联身份

### 与需求差距
- 需求里的“域主 + 域相审核确认”必须先明确：
  - “域相”是任意一个 `domainAdmins`？
  - 还是要指定一个唯一“域相主审”？
  - 当前代码没有唯一 `primeDomainAdmin` / `reviewAdminId` 字段，**这一点待确认**。

## 4.5 当前接口风格

### 风格判断
- 整体是 **REST-ish**，但夹杂大量动作型 endpoint
- 示例：
  - REST 风格：`GET /api/nodes/public/node-detail/:nodeId`
  - 动作风格：`POST /api/nodes/approve`、`POST /api/nodes/:nodeId/domain-admins/invite`

### 字段命名
- JSON 基本使用 camelCase
- 如：`domainMaster`、`domainAdmins`、`senseId`、`reviewComment`

### 分页方式
- 混合型
  - `page/pageSize`：释义建议、释义评论
  - `cursor`：`/users/me/distribution-results`、`/nodes/public/all-nodes`
  - `limit`：搜索和部分列表

### 鉴权中间件
- JWT Bearer：`backend/middleware/auth.js`
- 管理员校验：`backend/middleware/admin.js`
- 域级授权：多在路由函数里手写判断

## 4.6 如果将来要增加“释义页版本提审”，最接近可复用的后端模块是什么

### 首选：`NodeSenseEditSuggestion`
- 原因
  - 已经直接绑定 `nodeId + senseId`
  - 已有 `proposedTitle / proposedContent / reason / status / reviewerId / reviewComment`
  - 已有查询和审核接口
- 复用方式
  - 可扩为“版本提交记录”的简化版
  - 或作为新 `MeaningArticleVersion` 模型的前身/迁移参考
- 主要缺陷
  - 只有单 reviewer
  - 没有正式版本号
  - 没有正文结构快照
  - 没有多阶段审核状态

### 次选：节点创建审批流
- 原因
  - 已有“提交 -> 管理员审核 -> 自动通知 -> 自动驳回同名申请”完整链路
- 主要缺陷
  - 审核粒度是整节点，不是释义正文版本

## 4.7 双人确认是否已支持

**不支持。**

- 代码依据
  - `NodeSenseEditSuggestion` 只有 `reviewerId` 单字段
  - `status` 只有 `pending/approved/rejected`
  - `senses.js` 的 review 接口一次请求直接把建议改为最终状态
- 差距
  - 没有 `reviewers[]`
  - 没有 `masterDecision` / `adminDecision`
  - 没有 `pending_second_review` 之类中间态

## 4.8 通知机制是同步写库、异步 worker、轮询还是 websocket/socket.io

### 实际情况
- 写入方式：**同步写库为主**
  - 大量业务路由直接调用 `writeNotificationsToCollection()` / `upsertNotificationsToCollection()`
- 异步 worker：**存在，但主要用于计划任务和广播任务**
  - `worker.js` 处理公告广播、释义 materialize/backfill 等
- 前端接收：**轮询为主**
  - `App.js` 每 8 秒拉一次 `/api/notifications`
- websocket/socket.io：**只做少量提醒**
  - 当前主要是管理员 `admin-sync-pending`，不是完整通知总线

### 结论
- 后续“释义页版本提审”通知可以先沿用**同步写 `Notification` + 前端轮询**。
- 如果后面数量变大，再补 worker/提醒任务即可。

# 5. 数据结构逆向分析

> 以下 schema 为基于代码的逆向总结；字段后标注 `已确认 / 推测 / 待确认`。

## 5.1 KnowledgeDomain（当前更接近 `Node`）

```js
{
  _id: ObjectId, // 已确认
  nodeId: string, // 已确认
  owner: ObjectId, // 已确认
  domainMaster: ObjectId | null, // 已确认
  domainAdmins: ObjectId[], // 已确认
  allianceId: ObjectId | null, // 已确认

  name: string, // 已确认，承担“词条标题”
  description: string, // 已确认，概述/简介

  synonymSenses: [ // 已确认，embedded 缓存
    {
      senseId: string, // 已确认
      title: string, // 已确认
      content: string // 已确认，当前仅纯文本
    }
  ],
  senseVersion: number, // 已确认
  senseWatermark: string, // 已确认
  senseCollectionUpdatedAt: Date | null, // 已确认
  senseEmbeddedUpdatedAt: Date | null, // 已确认
  senseMaterializedAt: Date | null, // 已确认
  synonymSensesCount: number, // 已确认

  associations: [
    {
      targetNode: ObjectId, // 已确认
      sourceSenseId: string, // 已确认
      targetSenseId: string, // 已确认
      relationType: 'contains' | 'extends' | 'insert', // 已确认
      insertSide: '' | 'left' | 'right', // 已确认
      insertGroupId: string // 已确认
    }
  ],

  relatedParentDomains: string[], // 已确认，标题摘要关系
  relatedChildDomains: string[], // 已确认

  status: 'pending' | 'approved' | 'rejected', // 已确认
  isFeatured: boolean, // 已确认
  featuredOrder: number, // 已确认
  contentScore: number, // 已确认
  createdAt: Date, // 已确认
  lastUpdate: Date // 已确认
}
```

### 能直接复用到“百科释义页”的字段
- `name`
- `domainMaster`
- `domainAdmins`
- `associations.sourceSenseId/targetSenseId`
- `senseVersion`
- `status`

### 关键缺失字段
- `articleId` // 缺失
- `meaningId`（可由 `senseId` 复用） // 部分可复用
- `editorSource` // 缺失
- `ast` / `blocks` // 缺失
- `headingIndex` // 缺失
- `crossReferenceTargets` // 缺失
- `privateAnnotations` // 缺失
- `selectedRangeAnchor` // 缺失
- `versionStatus` // 缺失
- `reviewers` // 缺失

## 5.2 Meaning（当前更接近 `NodeSense`）

```js
{
  _id: ObjectId, // 已确认
  nodeId: ObjectId, // 已确认
  senseId: string, // 已确认，可视为 meaningId
  title: string, // 已确认
  content: string, // 已确认
  order: number, // 已确认
  status: 'active' | 'archived', // 已确认
  watermark: string, // 已确认
  createdBy: ObjectId | null, // 已确认
  updatedBy: ObjectId | null, // 已确认
  createdAt: Date, // 已确认
  updatedAt: Date // 已确认
}
```

### 可直接复用
- `nodeId + senseId` 作为“释义页主键”
- `title`
- `order`
- `createdBy/updatedBy`

### 关键缺失
- `articleSource` // 缺失
- `articleAst` // 缺失
- `renderedHtml` // 缺失
- `headingIndex` // 缺失
- `crossReferenceTargets` // 缺失
- `formulaRefs` // 缺失
- `symbolRefs` // 缺失
- `fullTextIndexVersion` // 缺失

## 5.3 User / Role

```js
{
  _id: ObjectId, // 已确认
  username: string, // 已确认
  role: 'admin' | 'common', // 已确认
  profession: string, // 已确认
  allianceId: ObjectId | null, // 已确认
  favoriteDomains: ObjectId[], // 已确认
  recentVisitedDomains: [
    {
      nodeId: ObjectId, // 已确认
      visitMode: 'title' | 'sense', // 已确认
      senseId: string, // 已确认
      visitedAt: Date // 已确认
    }
  ],
  notifications: [...], // 已确认，旧结构兼容
}
```

### 结论
- 当前不存在独立 `Role` 模型。
- “域主/域相”不是用户角色字段，而是 `Node` 上的外键关系。

## 5.4 Notification

```js
{
  _id: ObjectId, // 已确认
  userId: ObjectId, // 已确认
  type: string, // 已确认
  title: string, // 已确认
  message: string, // 已确认
  read: boolean, // 已确认
  status: 'pending' | 'accepted' | 'rejected' | 'info', // 已确认
  nodeId: ObjectId | null, // 已确认
  nodeName: string, // 已确认
  inviterId: ObjectId | null, // 已确认
  inviterUsername: string, // 已确认
  inviteeId: ObjectId | null, // 已确认
  inviteeUsername: string, // 已确认
  applicationReason: string, // 已确认
  respondedAt: Date | null, // 已确认
  createdAt: Date // 已确认
}
```

### 当前通知类型（与本需求相关）
- `domain_admin_invite`
- `domain_admin_invite_result`
- `domain_admin_resign_request`
- `domain_admin_resign_result`
- `domain_master_apply`
- `domain_master_apply_result`
- `domain_distribution_announcement`
- `info`

### 缺失通知类型
- `sense_article_version_submitted`
- `sense_article_review_requested`
- `sense_article_review_approved`
- `sense_article_review_rejected`
- `sense_article_revision_requested`
- `sense_article_referenced`

## 5.5 Review / Version（现状只能用 Suggestion 近似）

```js
{
  _id: ObjectId, // 已确认
  nodeId: ObjectId, // 已确认
  senseId: string, // 已确认
  proposerId: ObjectId, // 已确认
  proposedTitle: string, // 已确认
  proposedContent: string, // 已确认
  reason: string, // 已确认
  status: 'pending' | 'approved' | 'rejected', // 已确认
  reviewerId: ObjectId | null, // 已确认
  reviewComment: string, // 已确认
  reviewedAt: Date | null, // 已确认
  createdAt: Date, // 已确认
  updatedAt: Date // 已确认
}
```

### 判断
- 这是“修改建议”，不是严格意义上的“版本”。
- 它缺少：
  - `baseVersionId` // 缺失
  - `versionNumber` // 缺失
  - `finalContentSnapshot` // 缺失
  - `reviewers[]` // 缺失
  - `decisionTrail[]` // 缺失

## 5.6 深挖补充：与版本/搜索/通知最相关的现有字段实锤

### `NodeSense`

```js
{
  nodeId: ObjectId, // 已确认
  senseId: string, // 已确认
  title: string, // 已确认
  content: string, // 已确认
  order: number, // 已确认
  status: 'active' | 'archived', // 已确认
  watermark: string, // 已确认
  createdBy: ObjectId | null, // 已确认
  updatedBy: ObjectId | null // 已确认
}
```

- 额外已确认信息：
  - 有索引：`{ nodeId: 1, senseId: 1 }` 唯一
  - 有索引：`{ nodeId: 1, order: 1, senseId: 1 }`
  - 有文本索引：`{ title: 'text', content: 'text' }`
- 对本次需求的含义：
  - 当前已经具备“以纯文本做全文检索”的最基础土壤
  - 但它仍是**整条释义级**索引，没有 `headingIndex`、没有锚点级检索、没有个人标注定位字段

### `Notification`

```js
{
  userId: ObjectId, // 已确认
  type: 'domain_admin_invite' | 'domain_admin_invite_result' | 'domain_admin_resign_request' | 'domain_admin_resign_result' | 'domain_master_apply' | 'domain_master_apply_result' | 'alliance_join_apply' | 'alliance_join_apply_result' | 'domain_distribution_announcement' | 'alliance_announcement' | 'domain_distribution_result' | 'info', // 已确认
  title: string, // 已确认
  message: string, // 已确认
  read: boolean, // 已确认
  status: 'pending' | 'accepted' | 'rejected' | 'info', // 已确认
  nodeId: ObjectId | null, // 已确认
  nodeName: string, // 已确认
  inviterId: ObjectId | null, // 已确认
  inviteeId: ObjectId | null, // 已确认
  applicationReason: string, // 已确认
  requiresArrival: boolean, // 已确认
  respondedAt: Date | null, // 已确认
  createdAt: Date // 已确认
}
```

- 对本次需求的含义：
  - 现有通知已经支持“可响应”的待办项（`status: pending`）
  - 但没有 `payload` / `entityType` / `entityVersionId` 一类通用扩展字段
  - 若要做“释义版本审核通知”，短期可直接新增 type；长期可能需要更通用的通知 payload 结构

### `UserInboxState`

```js
{
  userId: ObjectId, // 已确认
  unreadCount: number, // 已确认
  lastNotificationAt: Date | null // 已确认
}
```

- 对本次需求的含义：
  - 当前只有**总未读数**，没有“审核待办未读”“引用提醒未读”等分类计数
  - 若审核页需要 badge 分栏，后续可能要新增分类统计或前端二次聚合

# 6. 释义百科页能力拆解与现有系统映射

## 6.1 释义节点主视角入口
- 当前是否已有基础：**有**
- 对应代码：`frontend/src/App.js` 的 `renderSenseSelectorPanel`、`SceneManager.js` 的 `showSenseEntry`
- 最推荐复用点：中心节点按钮 + 释义选择浮层
- 最大障碍：当前入口只负责切换视角/开信息弹层，没有真正正文页
- 必须先确认的问题：百科页入口是每个释义单独按钮，还是点击释义名即进入？

## 6.2 百科页展示布局
- 当前是否已有基础：**部分有**
- 对应代码：`NodeDetail.js` 页面壳、`NodeInfoModal.js` 信息弹层
- 最推荐复用点：新增 `view === 'senseArticle'`，复用 `App.js` 的页面切换方式
- 最大障碍：没有现成文档页布局组件
- 必须先确认的问题：是否要浏览器级 URL 路由

## 6.3 目录索引跳转
- 当前是否已有基础：**无**
- 对应代码：未读到 heading parser / anchor renderer
- 最推荐复用点：无，需新建
- 最大障碍：正文现在是纯字符串，没有 heading 结构
- 必须先确认的问题：目录基于源码解析还是存储时物化

## 6.4 页内搜索
- 当前是否已有基础：**部分有**
- 对应代码：全局搜索在 `Home.js` / `NodeDetail.js` / `/api/nodes/public/search`
- 最推荐复用点：沿用前端高亮模式 `<mark>`，新增页内检索状态
- 最大障碍：没有单篇正文结构与章节索引
- 必须先确认的问题：页内搜索只搜当前可见文本，还是搜 AST / 索引

## 6.5 文本高亮与个人私有标注
- 当前是否已有基础：**无**
- 对应代码：仅关键词高亮；未见标注模型
- 最推荐复用点：`NodeSenseFavorite` 只能借鉴“按 `nodeId+senseId+userId` 建表”的思路
- 最大障碍：没有选区锚点、没有注解表、没有渲染层
- 必须先确认的问题：私有标注是否仅自己可见、是否要跟版本漂移

## 6.6 按段落/按标题范围发起编辑
- 当前是否已有基础：**无**
- 对应代码：`NodeSenseEditSuggestion` 只能提交整条 title/content 建议
- 最推荐复用点：扩展 `NodeSenseEditSuggestion`
- 最大障碍：没有段落 ID / heading ID / selectedRangeAnchor
- 必须先确认的问题：编辑粒度是文本片段、块、还是标题整节

## 6.7 版本提交
- 当前是否已有基础：**部分有**
- 对应代码：`NodeSenseEditSuggestion`
- 最推荐复用点：基于 suggestion 流改造成 version submission
- 最大障碍：没有正式版本实体，没有 base version 关系
- 必须先确认的问题：版本是全释义一版，还是正文局部 patch 一版

## 6.8 域主/域相审核确认
- 当前是否已有基础：**部分有**
- 对应代码：`backend/routes/senses.js` 的 review 接口、`canManageNodeSenses()`、`Node.domainMaster/domainAdmins`
- 最推荐复用点：`NodeSenseEditSuggestion` + 通知流
- 最大障碍：只有单 reviewer，没有双确认状态机
- 必须先确认的问题：域相是任意一个还是唯一指定一个，若没有域相时怎么办

## 6.9 通知提醒
- 当前是否已有基础：**有**
- 对应代码：`Notification`、`notificationStore`、`/api/notifications`、`App.js`
- 最推荐复用点：通知集合 + 未读数
- 最大障碍：缺少百科版本相关通知类型与模板
- 必须先确认的问题：是否需要催审提醒 / 超时升级

## 6.10 跨释义引用
- 当前是否已有基础：**部分有**
- 对应代码：`Node.associations`、`DomainTitleRelation`、`CreateNodeModal` / `AdminPanel` 的关联编辑
- 最推荐复用点：复用 `sourceSenseId -> targetNode + targetSenseId` 作为语义链接基础
- 最大障碍：当前关联是图谱关系，不是正文内 inline 引用
- 必须先确认的问题：百科文内引用是否就是现有 `contains/extends/insert`，还是需要新的 `cite/ref` 类型

## 6.11 标题层级、公式、符号插入
- 当前是否已有基础：**无**
- 对应代码：未见结构化正文或公式渲染
- 最推荐复用点：无
- 最大障碍：内容仅为纯字符串
- 必须先确认的问题：公式是否允许 LaTeX 子集，符号是文本替换还是语法节点

## 6.12 自定义百科编辑语法或数据结构
- 当前是否已有基础：**部分有**
- 对应代码：所有正文目前都是 string，可天然承接“源码文本”；`nodeSenseStore` 已有统一读写口
- 最推荐复用点：`NodeSense.content` / `NodeSenseEditSuggestion.proposedContent` / `saveNodeSenses()`
- 最大障碍：现有所有渲染、审核、搜索都按纯文本理解 `content`
- 必须先确认的问题：要不要同时存 `editorSource + derivedAst`

## 6.13 深挖补充：几个最容易误判的能力边界

### 6.13.1 “跨释义引用”与“图谱关联”不能直接画等号
- 当前是否已有基础：**部分有，但语义不等价**
- 对应代码：`backend/routes/nodes.js` 的 `resolveAssociationsWithInsertPlans()`、`applyInsertAssociationRewire()`、`syncReciprocalAssociationsForNode()`
- 最推荐复用点：可复用 `nodeId + senseId` 作为引用目标标识
- 最大障碍：当前 `contains/extends/insert` 一旦保存，就会触发双向同步、标题关系投影与删除门控
- 必须先确认的问题：
  - 正文 `[[引用]]` 是否仅做阅读跳转
  - 还是也要改变知识域上下级关系
  - 若二者混在一起，后续会非常难控

### 6.13.2 “版本提交”与“直接编辑”当前是两套口径
- 当前是否已有基础：**部分有，但分裂**
- 对应代码：
  - 直接改：`POST /api/nodes/:nodeId/admin/senses`、`PUT /api/nodes/:nodeId/admin/senses/:senseId/text`、`DELETE /api/nodes/:nodeId/admin/senses/:senseId`
  - 提建议：`backend/routes/senses.js` suggestion 系列
- 最推荐复用点：以 suggestion 流承接普通用户提交，以 admin 直改流承接系统修复/兜底操作
- 最大障碍：当前 suggestion 审核通过后会**直接覆写正式内容**，没有中间版本表
- 必须先确认的问题：百科页版本生效是否还允许管理员跳过审核直接改正式版

### 6.13.3 “审核确认”不能只看 suggestion，要连带看通知与竞争处理模式
- 当前是否已有基础：**部分有**
- 对应代码：`backend/routes/auth.js` 的 `handleDomainMasterApplyDecision()`、`POST /api/notifications/:notificationId/respond`
- 最推荐复用点：复用通知待办 + 审核动作回写模式
- 最大障碍：当前多候选审批（如域主申请竞争、同名节点竞争）采用的是“一个通过、其余自动拒绝”的单终态逻辑，不是双人并行共识模型
- 必须先确认的问题：释义版本审核是否允许多个待审版本并存；若并存，是否也要“通过一个时自动驳回其他同基线版本”

# 7. 文本编辑器与内容存储方案调研（仅基于当前项目适配性）

## 7.1 A. 纯 markdown 文本 + 自定义扩展语法

### 适配性
- **最高。**
- 原因
  - 当前 `NodeSense.content`、`description`、`NodeSenseEditSuggestion.proposedContent` 都是纯字符串。
  - 前后端接口、审核建议、通知文案都天然适合先传输文本源。
  - 不引入大型编辑器库的前提下，最容易先用现有 `textarea` 起步。

### 对需求支持度
- 标题：自然支持
- 目录：可由标题解析生成
- 跨释义引用：可通过自定义语法扩展，如 `[[nodeId:senseId]]` 或 `@{senseRef}`
- 公式：可通过约定块/内联语法扩展
- 符号：可通过短码或命令插入
- 高亮/私注：需要额外锚点模型，不会天然得到
- 局部修订：需要把源码分段或解析成 AST 后再做
- 版本 diff：文本 diff 最自然
- 审核：文本审阅最容易先落地

### 风险
- 如果后期非常强调 WYSIWYG 体验，纯文本编辑体验会较弱。
- 段落级锚点、私有高亮最终仍需要衍生结构，不可能只靠原始 markdown 字符串。

## 7.2 B. block-based JSON 文档模型

### 适配性
- **中。**
- 原因
  - 对目录、块级编辑、段落级修订、局部评论更友好。
  - 但当前仓库完全没有 JSON 文档渲染器，也没有块编辑 UI。

### 对需求支持度
- 标题/目录：强
- 局部修订：强
- 私有标注：较强
- diff：需要自定义 block diff
- 审核：可做块级审核，但实现成本高

### 风险
- 对当前代码组织过于跳跃，需要从 0 建立 renderer / serializer / preview / diff。
- 与现有 suggestion/string 接口不兼容，改动面大。

## 7.3 C. 富文本 AST（类 ProseMirror / Slate 的思路，但不引库）

### 适配性
- **中偏低。**
- 原因
  - 从能力上最完整，但当前仓库没有对应基础设施。
  - 手写 AST 编辑器成本很高，不符合“先从项目可承受性判断”。

### 对需求支持度
- 标题、目录、公式、引用、标注：理论上最好
- 但以本仓库现状落地成本最大

### 风险
- 会把这次改造变成“先造编辑器框架”项目。

## 7.4 D. HTML 直存

### 适配性
- **低。**
- 原因
  - 当前项目没有 HTML 正文渲染/清洗体系。
  - 直接存 HTML 虽省事，但 diff、审核、结构化目录、跨释义引用解析都会变差。

### 对需求支持度
- 展示快，治理差。

### 风险
- XSS、结构不稳定、编辑器耦合、难做局部修订与引用分析。

## 7.5 当前项目最兼容哪种内容模型

**推荐：A. 纯 markdown 文本 + 自定义扩展语法，同时配套派生 AST/索引。**

### 原因
- 最贴合当前 `string content` 现实。
- 可复用 `NodeSense` / `NodeSenseEditSuggestion` / `saveNodeSenses()`。
- 可先用普通 `textarea + 预览` 起步，不必立刻引入庞大编辑器库。
- 还能满足目标 D：不是照搬维基编辑器，而是基于项目风格设计自定义语法。

## 7.6 如果只能推荐一个方向

### 推荐方向
**“源码文本 + 自定义语法 + 派生 AST/目录/引用索引” 双层模型。**

### 具体含义
- 存储主字段：`editorSource`（字符串）
- 派生字段：`ast`、`headingIndex`、`crossReferenceTargets`
- 渲染时：优先用 AST；编辑时：编辑源码
- 审核时：比较源码 diff + 结构 diff

### 这样做对各层意味着什么

#### 前端
- 初期可直接用 `textarea` + 预览面板
- 后续逐步补：目录、页内搜索、选段编辑、引用跳转、公式预览

#### 后端
- 新增 parser/validator/service
- 新增版本模型，而不是继续把正式正文塞在 `NodeSense.content` 一个字段里
- `saveNodeSenses()` 可保留给基础释义元信息，百科正文建议拆出去或扩展结构

#### 数据库
- 最小改造：在释义版本模型里存 `editorSource`
- 中期改造：补 `ast`、`headingIndex`、`crossReferenceTargets`
- 不建议只存 HTML

# 8. 审核流与通知流可落地性分析

## 8.1 当前系统里谁能代表域主与域相，代码如何识别

### 域主
- 来源：`Node.domainMaster`
- 识别：`isDomainMaster(node, userId)` 或直接比较 `node.domainMaster`

### 域相
- 来源：`Node.domainAdmins[]`
- 识别：`isDomainAdmin(node, userId)` 或在数组中查找

### 关键问题
- 当前是“多个域相”模型，不是唯一域相。
- 因此需求 G 的“域主 + 域相审核确认”要落地，必须先回答：
  - 是“域主 + 任一域相”即可？
  - 还是“域主 + 指定域相”必须都确认？
  - 还是“域主 + 全体域相中至少一人”？
- **此处待确认。**

## 8.2 现有通知体系能否支持以下场景

### 新提交待审核
- 结论：**能**
- 方式：复用 `Notification`，新增通知类型即可

### 审核通过
- 结论：**能**
- 方式：参考域主申请结果、域相邀请结果通知

### 审核驳回
- 结论：**能**
- 方式：同上

### 请求补充修改
- 结论：**能，但需新增状态和值班文案**
- 原因：当前 `Notification.status` 没有“needs_revision”之类状态

### 有人引用了你的释义
- 结论：**能，但当前未实现**
- 方式：在保存引用关系后写通知

## 8.3 若当前没有专门通知体系，最接近可复用的模块是什么

- 首选：`backend/services/notificationStore.js`
- 读模型：`backend/models/Notification.js`
- 未读聚合：`backend/models/UserInboxState.js`
- 前端消费：`frontend/src/App.js` 的通知轮询与未读数展示

## 8.4 审核页更适合放在哪里

### 方案判断
- 域管理后台：**最适合**
  - 现有位置：`frontend/src/components/game/KnowledgeDomainScene.js` 的 manage 体系
  - 优点：天然带域主/域相上下文
- 个人工作台：当前没有现成页面，需新建
- 消息中心：适合做入口，不适合做复杂审核主界面
- 释义页内侧边栏：适合轻审阅，但会挤压正文

### 结论
- **主审核页建议放“域管理后台”**
- **通知中心只作为待办入口**

## 8.5 两种可行审核流形态

### 形态 A：串行双确认（先域相后域主）
- 流程
  1. 用户提交释义新版本
  2. 指定域相先审
  3. 通过后流转给域主终审
  4. 通过即生效，驳回则退回
- 优点
  - 容易沿用当前单 reviewer 逻辑扩展为多阶段状态
  - 审核责任清晰
- 缺点
  - 域相卡住会阻塞流程
  - 若存在多个 `domainAdmins`，要先定义由谁首审

### 形态 B：并行双确认（域主与域相都要同意）
- 流程
  1. 用户提交新版本
  2. 同时通知域主和域相
  3. 两人都同意才通过
  4. 任意一人驳回则退回
- 优点
  - 符合“域主 + 域相共同确认”的直观理解
  - 不依赖固定前后顺序
- 缺点
  - 当前模型完全不支持多 reviewer 状态聚合
  - 多个域相时规则会变复杂

### 形态 C：单人确认 + 另一人复核
- 流程
  1. 任一域相或域主先通过
  2. 另一方在限定时间内复核
- 优点
  - 可以提高效率
- 缺点
  - 容易引入“已发布后复核”的复杂时序
  - 不如前两者直观

## 8.6 结合当前代码，最适合本项目的一种

**推荐：形态 A，串行双确认。**

### 推荐原因
- 最接近当前 `NodeSenseEditSuggestion` 的单 reviewer 审核模式，改造量最小。
- 可在版本记录中新增：
  - `reviewStage: 'domainAdmin' | 'domainMaster' | 'done'`
  - `domainAdminDecision`
  - `domainMasterDecision`
- 通知也容易分阶段投递。

### 前置前提
- 必须先明确“哪个域相负责首审”。
- 若不指定唯一域相，建议先定义：
  - `reviewAdminId` // 待新增字段
  - 或“任一域相先抢单” // 待确认业务规则

## 8.7 深挖补充：现有通知/审批代码能提供什么现成模式

### 模式 1：通知型审批的“竞争收敛”
- 对应代码：`backend/routes/auth.js` 的 `handleDomainMasterApplyDecision()`
- 已确认事实：
  - 当某个域主申请被接受时，会把同一知识域下其他待处理 `domain_master_apply` 通知统一改为 `rejected`
  - 同时给申请人写入 `domain_master_apply_result` 通知
- 对释义版本审核的启发：
  - 如果后续允许多个用户同时提交同一释义的新版本，可以参考这种“通过一个版本后，自动收敛同基线竞争版本”的处理方式
  - 但是否适合正文版本，仍待确认

### 模式 2：通知响应并不等于完整工作台
- 对应代码：`backend/routes/auth.js` 的 `POST /api/notifications/:notificationId/respond` + `frontend/src/App.js` 通知面板
- 已确认事实：
  - 当前通知中心适合“接受/拒绝”这类轻动作
  - 复杂审批内容（多释义比对、桥接决策）仍然放在 `AdminPanel` 这类专门页面完成
- 对释义版本审核的启发：
  - 通知中心更适合作“待办入口”
  - 真正的审核主界面仍应放在域管理后台或新建工作台

### 模式 3：实时通信目前只做管理员同步提醒，不是完整通知总线
- 对应代码：
  - `backend/server.js` 的 `io.to('admin-room').emit('admin-sync-pending', ...)`
  - `frontend/src/App.js` 的 `socket.on('admin-sync-pending', ...)`
  - `frontend/src/App.js` 的通知轮询 `setInterval(..., 8000)`
- 已确认事实：
  - Socket.IO 当前只在管理员认证后推一个“刷新待审批数据”的事件
  - 普通通知主路径仍然是前端轮询 `GET /api/notifications`
- 对释义版本审核的启发：
  - 第一阶段不需要为审核流单独上 websocket
  - 继续用“同步写通知 + 8 秒轮询 + 必要时管理员同步事件”即可落地

# 9. 需要补充阅读的关键代码清单

> 以下文件我已部分阅读，但若进入真正改造阶段，仍建议继续深挖。

- `backend/routes/nodes.js`
  - 为什么关键：它不仅是路由文件，还内嵌了大量释义关系校验、删除预览、互反关系同步逻辑。
  - 下一步重点：`normalizeAssociationDraftList`、`validateAssociationRuleSet`、`buildAssociationMutationPreviewData`、`resolveAssociationsWithInsertPlans`、`computeLostBridgePairs`、`resolveReconnectPairsByDecisions`、`syncReciprocalAssociationsForNode`
- `frontend/src/components/admin/AdminPanel.js`
  - 为什么关键：当前所有“管理员级释义编辑/删除/审批”的完整交互都在这里。
  - 下一步重点：新增释义、编辑释义文本、删除释义预览、`previewAssociationEdit()`、`saveAssociationEdit()`、待审批节点渲染逻辑
- `frontend/src/components/game/KnowledgeDomainScene.js`
  - 为什么关键：这是最现实的“域主/域相工作区”入口。
  - 下一步重点：manage tab、域相管理区、侧板切换模式，判断审核页最合适的挂载位
- `backend/routes/auth.js`
  - 为什么关键：通知响应动作集中于此，域主申请/域相邀请/卸任都依赖它，且已包含竞争申请收敛逻辑。
  - 下一步重点：`handleDomainMasterApplyDecision()`、`POST /api/notifications/:notificationId/respond`、多管理员同步改状态逻辑
- `backend/services/notificationStore.js`
  - 为什么关键：后续所有审核通知、引用通知、催审通知都会经过这里。
  - 下一步重点：通知类型扩展策略、未读数维护方式
- `backend/services/nodeSenseStore.js`
  - 为什么关键：若后续新增百科正文/版本实体，必须决定是扩展此 store 还是新建 article store。
  - 下一步重点：`saveNodeSenses` 的职责边界，是否继续承担正文保存
- `frontend/src/App.js`
  - 为什么关键：新页面状态、浮层入口、通知入口、视图切换都在这里。
  - 下一步重点：`view` 体系、`renderSenseSelectorPanel`、`fetchNodeDetail`、`fetchTitleDetail`
- `frontend/src/SceneManager.js`
  - 为什么关键：中心节点按钮和节点点击是“百科入口”最小侵入点。
  - 下一步重点：`setupCenterNodeButtons()`、`setupSenseDetailButton()`
- `backend/routes/senses.js`
  - 为什么关键：这是当前最接近“释义版本提审”的已有骨架。
  - 下一步重点：`canManageNodeSenses()`、suggestion 提交/列表/review 三组接口，以及 `persistNodeSenses()` 的调用边界

# 10. 面向后续改造的结论

## 10.1 当前项目最适合从哪里切入做“释义百科页”

**最适合的切入点是：以 `NodeSense (nodeId + senseId)` 为释义页主键，在前端 `App.js` 新增一个独立的释义百科视图状态，并从现有“释义选择浮层 / 中心节点按钮”进入。**

原因：
- 后端已经天然有 `nodeId + senseId` 这对标识。
- 前端已经能按 `senseId` 切换主视角。
- `NodeSenseEditSuggestion` 已能承接后续“版本提审”的第一阶段落地。

## 10.2 现阶段最大技术风险

1. **概念耦合风险**
   - `Node` 同时承担知识域、词条标题、概述、释义缓存、权限容器、关系容器，继续往里塞百科页正文会加重耦合。
2. **内容模型缺失风险**
   - 目前只有纯字符串 `content`，没有结构化正文，目录/引用/公式/局部修订都无从谈起。
3. **审核角色定义风险**
   - 当前“域相”是数组 `domainAdmins[]`，需求中的“域主 + 域相双确认”在角色层面并未唯一化。
4. **前端承载方式风险**
   - 现有 `App.js` 和大型组件已很重，若没有新视图边界，百科页会继续堆在老组件里。
5. **引用语义混淆风险**
   - 当前 `associations` 带有互反同步、桥接重连、标题投影副作用；若把正文引用直接复用为 `contains/extends/insert`，会把阅读层改造变成图谱层改造。

## 10.3 最值得复用的 3~5 个现有模块

- `backend/services/nodeSenseStore.js`
  - 现有释义统一读写核心，最值得复用
- `backend/models/NodeSenseEditSuggestion.js` + `backend/routes/senses.js`
  - 最接近“版本提审”的现成审核骨架
- `backend/services/notificationStore.js`
  - 审核通知与未读数首选复用点
- `backend/routes/nodes.js` 的关联 preview / 重连决策链
  - 现有“结构变更先预览再执行”的后端骨架
- `frontend/src/App.js` 的 `renderSenseSelectorPanel` / `fetchNodeDetail`
  - 现有释义入口与视图切换核心
- `frontend/src/components/admin/AdminPanel.js`
  - 现有释义管理与审批交互可作为后台编辑/审核界面参考

## 10.4 为了进入真正改造阶段，还缺哪些信息

- “域相审核”中的域相是否唯一，如果不唯一，审核链如何指定
- 释义百科页是否需要独立 URL，可否接受先用 `view` 状态模拟页面
- 旧的 `NodeSense.content` 是否要继续保留为摘要，还是直接升级成新正文源
- 私有高亮/标注是否要求跨版本迁移
- 跨释义引用是否复用现有 `contains/extends/insert`，还是新增纯引用语义
- 若新增纯引用语义，它与现有 `DomainTitleRelation` / 标题图谱是否需要联动
- 公式/符号语法范围需要多大
- 管理员是否保留“绕过审核直接发布正式释义正文”的特权

## 10.5 建议后续改造拆分子任务（只列任务名）

- 释义百科页数据模型定稿
- 释义百科页前端主视图接入
- 自定义百科语法与解析器
- 释义正文渲染与目录索引
- 释义版本模型与提交接口
- 域主/域相双阶段审核流
- 审核页与待办入口
- 审核通知与引用通知扩展
- 私有高亮/标注模型与渲染
- 页内搜索与章节锚点

# 附录 A：与本次需求最相关的文件优先级清单

## P0
- `backend/models/Node.js`
- `backend/models/NodeSense.js`
- `backend/models/NodeSenseEditSuggestion.js`
- `backend/routes/nodes.js`
- `backend/routes/senses.js`
- `backend/services/nodeSenseStore.js`
- `frontend/src/App.js`
- `frontend/src/components/game/NodeDetail.js`
- `frontend/src/components/modals/CreateNodeModal.js`
- `frontend/src/components/admin/AdminPanel.js`

## P1
- `backend/models/Notification.js`
- `backend/models/UserInboxState.js`
- `backend/routes/auth.js`
- `backend/services/notificationStore.js`
- `backend/models/DomainTitleProjection.js`
- `backend/models/DomainTitleRelation.js`
- `backend/services/domainTitleProjectionStore.js`
- `frontend/src/components/modals/NodeInfoModal.js`
- `frontend/src/components/game/KnowledgeDomainScene.js`
- `frontend/src/SceneManager.js`
- `frontend/src/LayoutManager.js`
- `frontend/src/WebGLNodeRenderer.js`

## P2
- `backend/routes/users.js`
- `backend/services/domainAdminResignService.js`
- `backend/services/KnowledgeDistributionService.js`
- `backend/services/schedulerService.js`
- `backend/worker.js`
- `frontend/src/components/modals/AssociationModal.js`
- `frontend/src/components/shared/AssociationAddFlowEditor.js`
- `frontend/src/components/shared/associationFlowShared.js`
- `readme.md`

# 附录 B：我建议 ChatGPT 下一轮继续读取的最重要信息

- `NodeSense` 已经是释义集合化存储 SoT，`Node.synonymSenses` 只是兼容缓存
- 当前“词条”没有独立模型，`Node.name` + `titleDetail` 只是标题层展示
- 当前“释义主视角”是 `nodeDetail`，但它不是百科页，只是图谱 + 摘要
- “标题+释义选择浮层”在 `frontend/src/App.js`，是百科入口最小侵入点
- `NodeSenseEditSuggestion` 是“版本提审”最接近可复用的后端模块，但只支持单 reviewer
- 域主/域相权限依赖 `Node.domainMaster` / `Node.domainAdmins[]`，不存在统一角色模型
- 双人审核当前不支持；需求落地前必须先确认“域相”在多管理员场景下的唯一性规则
- 通知体系已可复用：`Notification` + `UserInboxState` + `notificationStore` + 前端轮询
- 前端无 React Router，若做百科页独立页面，短期更可能是新增 `view` 而不是正式路由
- 当前没有正文结构、目录、页内搜索、私有标注、选区锚点、公式/符号、版本 diff 基础
