# Explain Page Freeze Diagnosis

## 1. 问题复述

当前仓库中，“释义百科页”对应的实现不是单独的路由文件，而是由 `frontend/src/App.js` 里的 `view === 'senseArticle' / 'senseArticleEditor' / 'senseArticleReview' / 'senseArticleHistory'` 这一组前端视图状态驱动。

结合代码，用户描述的“在释义百科页执行更新释义时，编辑文本过程中随机页面卡住，随后无法操作并崩溃”，最接近的真实业务链路是：

- 从节点详情或“标题 + 释义选择浮层”进入 `SenseArticlePage`
- 点击“更新释义”按钮
- 进入 `SenseArticleEditor`
- 在大文本 `textarea` 中输入 `source` 或 `scopedText`
- 编辑页本地状态变化后，会触发：局部范围重建、全文源码拼装、全文语法解析、全文预览渲染、局部差异计算
- 保存或提交时，再进入后端“重新解析 + 解析引用 + 生成 diff + 持久化 + 返回完整 revision”的重路径

从静态代码看，这个问题**更像是“输入热路径中的高成本计算 + 大对象渲染/序列化 + 保存阶段重请求/重响应”叠加**，而不是单一的死循环 `useEffect` 或 modal 遮罩问题。

最可能的主战场是：

- 前端编辑页：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 前端解析器：`frontend/src/utils/senseArticleSyntax.js`
- 前端局部修订与差异：`frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- 前端预览渲染：`frontend/src/components/senseArticle/SenseArticleRenderer.js`
- 后端更新草稿服务：`backend/services/senseArticleService.js`
- 后端 diff：`backend/services/senseArticleDiffService.js`

---

## 2. 与该问题直接相关的文件清单

### 2.1 前端页面 / 路由 / 状态提升

- `frontend/src/index.js`
  - 模块：应用入口
  - 作用：挂载 `<App />`，并启用 `React.StrictMode`（`71-75` 行）
  - 调用关系：浏览器入口 -> `App`
  - 关键点：严格模式会在开发环境放大 effect 双调用问题；全局没有 ErrorBoundary

- `frontend/src/App.js`
  - 模块：`App`
  - 作用：实际的“路由容器 + 业务状态中心”；维护 `view`、`senseArticleContext`、标题+释义选择浮层、打开阅读页/编辑页/历史页/审阅页的全部入口
  - 被谁调用：`frontend/src/index.js`
  - 调用谁：`SenseArticlePage`、`SenseArticleEditor`、`SenseArticleHistoryPage`、`SenseArticleReviewPage`、`SenseArticleDashboardPage`、`senseArticleApi`
  - 关键 state / callback：
    - `senseArticleContext`（`618-629` 行）
    - `senseArticleEntryStatusMap`（`616` 行）
    - `openSenseArticleView`（`5565-5580` 行）
    - `handleOpenSenseArticleEditor`（`5634-5689` 行）
    - `handleOpenSenseArticleHistory`（`5692-5695` 行）
    - `handleOpenSenseArticleReview`（`5702-5728` 行）
  - 备注：`App` 本身很大，但**编辑输入时并不会直接把热路径 state 提升到 App**；热路径主要仍在 `SenseArticleEditor`

- `frontend/src/components/game/NodeDetail.js`
  - 模块：`NodeDetail`
  - 作用：节点详情展示；不是“更新释义”按钮的最终实现位置，但属于释义百科页的上游入口视图
  - 调用关系：由 `App` 在 `view === 'nodeDetail'` 时渲染
  - 关键 props：当前节点、父子节点、搜索结果点击等
  - 备注：真正的“进入释义百科页”按钮放在 `App.js:6520-6527`

### 2.2 前端释义百科页 / 编辑页 / 展示组件

- `frontend/src/components/senseArticle/SenseArticlePage.js`
  - 模块：`SenseArticlePage`
  - 作用：释义百科阅读页；展示发布版、目录、页内搜索、引用、backlinks，并暴露“更新释义”入口
  - 被谁调用：`App.js:6531-6542`
  - 调用谁：`senseArticleApi.getCurrent/getReferences/getBacklinks/getRevisions/searchWithinArticle/createAnnotation`、`SenseArticleRenderer`
  - 关键 state / effect：
    - `pageData / referenceData / backlinkData / loading / error`（`107-111` 行）
    - `searchQuery / searchData / activeSearchIndex`（`112-114` 行）
    - `selectionAnchor / annotationDraft / annotationSaving`（`116-119` 行）
    - `loadCurrent()`（`124-141` 行）
    - `页内搜索防抖请求`（`208-225` 行）
    - `滚动目录同步`（`242-255` 行）
  - 关键入口：`更新释义` 按钮在 `461-464` 行

- `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - 模块：`SenseArticleEditor`
  - 作用：核心编辑页；维护正文源码、局部修订文本、标题、备注、预览、保存草稿、提交审核
  - 被谁调用：`App.js:6544-6557`
  - 调用谁：`senseArticleApi.getRevisionDetail/updateMetadata/updateDraft/submitRevision/searchReferenceTargets`、`parseSenseArticleSource`、`buildScopedRevisionState`、`buildTrackedChangeTokens`、`SenseArticleRenderer`
  - 关键 state / ref / effect / memo：
    - `source / scopedText / note / senseTitle`（`57-60` 行）
    - `saving / submitting / error`（`62-64` 行）
    - `referenceQuery / referenceResults`（`67-69` 行）
    - `debouncedPreviewSource / debouncedTrackedTokens`（`70-71` 行）
    - `lastSavedState`（`72` 行）
    - `textareaRef`（`73` 行）
    - 加载 revision 详情（`76-109` 行）
    - `scopedState` 派生状态（`137-145` 行）
    - `effectiveSource` + 预览防抖（`147-153` 行）
    - `previewRevision` 解析（`155-165` 行）
    - 局部差异防抖（`201-210` 行）
    - `saveDraft()`（`278-292` 行）
    - `submit()`（`295-310` 行）
  - 结论：这是本次前端卡死问题的**最高相关文件**

- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
  - 模块：`SenseArticleRenderer`
  - 作用：把 AST 渲染成整页 React 树；编辑页预览和阅读页正文都复用它
  - 被谁调用：`SenseArticlePage`、`SenseArticleEditor`
  - 调用谁：内部 `InlineNodes` / `renderBlock`
  - 关键点：
    - 每次 render 都会重建 `referenceMap`、`annotationsByBlock`、`annotationsByHeading`（`177-187` 行）
    - 每次 render 都会遍历全部 `blocks` 输出整棵树（`189-203` 行）

- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
  - 模块：`SenseArticleHistoryPage`
  - 作用：查看已发布历史、按需对比当前发布版
  - 被谁调用：`App.js:6575-6587`
  - 调用谁：`senseArticleApi.getRevisions/compareRevisions`
  - 关键 state：`compareByRevisionId`（`73` 行）
  - 备注：不是输入卡死主因，但与“提交后跳转/刷新”有关

- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
  - 模块：`SenseArticleReviewPage`
  - 作用：审阅页；显示结构化对比、投票信息、审核意见
  - 被谁调用：`App.js:6559-6573`
  - 调用谁：`senseArticleApi.getRevisionDetail/reviewRevision`、`useSenseArticleCompare`
  - 关键点：会再次加载完整 revision 与 baseRevision，使用结构化 compare

- `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
  - 模块：`SenseArticleDashboardPage`
  - 作用：治理面板；查看待审、已发布、引用治理
  - 被谁调用：`App.js:6589-6608`
  - 备注：非输入热路径，但属于同一业务域

- `frontend/src/components/senseArticle/SenseArticleComparePanel.js`
  - 模块：`SenseArticleComparePanel`
  - 作用：结构化 diff 展示
  - 被谁调用：`SenseArticleReviewPage`
  - 关键 state：`expandedKeys`（`37-44` 行）
  - 备注：不是编辑输入卡死主因，但与 diff 负担相关

- `frontend/src/components/senseArticle/SenseArticlePageHeader.js`
  - 模块：`SenseArticlePageHeader`
  - 作用：阅读/编辑/历史/审阅页统一头部
  - 被谁调用：上述各 page

### 2.3 前端编辑器 / 语法 / 局部修订工具

- `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
  - 模块：局部修订工具集
  - 作用：根据整页源码计算“本节修订/选段修订”的范围、生成合成源码、构建 tracked change token
  - 被谁调用：`SenseArticleEditor`、`SenseArticleReviewPage`
  - 关键函数：
    - `extractSectionRange()`（`40-97` 行）
    - `locateSelectionRange()`（`119-133` 行）
    - `buildScopedRevisionState()`（`135-233` 行）
    - `buildTrackedChangeTokens()`（`257-298` 行）
  - 备注：是“局部编辑时高 CPU”的核心来源之一

- `frontend/src/utils/senseArticleSyntax.js`
  - 模块：前端语法解析器
  - 作用：把源码解析为 AST / headingIndex / referenceIndex / parseErrors / plainTextSnapshot
  - 被谁调用：`SenseArticleEditor`
  - 关键函数：`parseSenseArticleSource()`（`171-299` 行）
  - 备注：当前是**自研 parser**，不是第三方编辑器

- `frontend/src/components/senseArticle/useSenseArticleCompare.js`
  - 模块：compare hook
  - 作用：拉取对比结果
  - 被谁调用：`SenseArticleReviewPage`
  - 关键 effect：`9-30` 行

### 2.4 前端 API 层

- `frontend/src/utils/senseArticleApi.js`
  - 模块：`senseArticleApi`
  - 作用：所有百科相关请求封装
  - 被谁调用：`App` 与各个 `senseArticle` 页面
  - 关键函数：
    - `requestJson()`（`33-46` 行）
    - `getRevisionDetail()`（`59` 行）
    - `updateMetadata()`（`60` 行）
    - `createDraft()/createFromSelection()/createFromHeading()`（`62-64` 行）
    - `updateDraft()`（`65` 行）
    - `submitRevision()`（`66` 行）
  - 关键风险：没有 `AbortController` / timeout；所有响应先 `response.text()` 再 `JSON.parse()`

### 2.5 后端路由 / controller / service / model

- `backend/server.js`
  - 模块：Express 注册入口
  - 作用：注册 `/api/sense-articles` 与 `/api/senses`
  - 关键路由注册：`91-92` 行

- `backend/routes/senseArticles.js`
  - 模块：百科正文新路由
  - 作用：实际的 controller 层；把前端请求转到 `senseArticleService`
  - 调用关系：`frontend/src/utils/senseArticleApi.js` -> 这里 -> `backend/services/senseArticleService.js`
  - 关键路由：
    - `GET /:nodeId/:senseId/current`（`73-84` 行）
    - `GET /:nodeId/:senseId/revisions/:revisionId`（`117-129` 行）
    - `PUT /:nodeId/:senseId/metadata`（`160-172` 行）
    - `PUT /:nodeId/:senseId/revisions/:revisionId`（`145-158` 行）
    - `POST /:nodeId/:senseId/revisions/:revisionId/submit`（`174-185` 行）
    - `POST /from-selection`（`188-203` 行）
    - `POST /from-heading`（`205-220` 行）

- `backend/services/senseArticleService.js`
  - 模块：百科正文主服务
  - 作用：查询 bundle、创建 draft、更新 draft、提交、审阅、解析引用、回填旧字段、返回 DTO
  - 被谁调用：`backend/routes/senseArticles.js`
  - 调用谁：`senseArticleParser`、`senseArticleDiffService`、`senseArticleSerializer`、`nodeSenseStore`、Mongoose models
  - 关键函数：
    - `getArticleBundle()`（`494-537` 行）
    - `getCurrentArticle()`（`569-588` 行）
    - `getRevisionDetail()`（`619-635` 行）
    - `updateSenseMetadata()`（`638-693` 行）
    - `createDraftRevision()`（`695-757` 行）
    - `updateDraftRevision()`（`759-801` 行）
    - `submitRevision()`（`820-878` 行）
    - `searchReferenceTargets()`（`1260-1306` 行）
    - `listBacklinks()`（`1346-1373` 行）
  - 备注：这里包含一个明确可见的 bug：`resolveReferenceTargets()` 使用了未定义变量 `reviewableNodes`（`294-324` 行里的 `307` 行）

- `backend/services/senseArticleDiffService.js`
  - 模块：结构化 diff / 行 diff
  - 作用：在保存和 compare 时生成 diff
  - 关键函数：
    - `buildLineDiff()`（`5-56` 行）
    - `buildStructuredDiff()`（`285-347` 行）
  - 备注：存在明显的二维 DP / LCS 型复杂度

- `backend/services/senseArticleParser.js`
  - 模块：后端解析器
  - 作用：保存时重新把源码转成 AST / headingIndex / referenceIndex / plainTextSnapshot
  - 关键函数：`parseSenseArticleSource()`（`272` 行起）
  - 备注：保存时并不直接信任前端解析结果，而是后端再做一次完整解析

- `backend/services/senseArticleSerializer.js`
  - 模块：DTO 序列化
  - 作用：决定前端拿到的数据体大小
  - 关键函数：`serializeRevisionDetail()`（`56-68` 行）
  - 关键风险：把 `editorSource + ast + referenceIndex + formulaRefs + symbolRefs + plainTextSnapshot + renderSnapshot + diffFromBase` 全量返回

- `backend/services/senseArticlePermissionService.js`
  - 模块：权限服务
  - 作用：创建/审阅权限判定
  - 关键点：`canCreateRevision` 直接恒为 `true`（`21-27` 行）

- `backend/services/nodeSenseStore.js`
  - 模块：NodeSense 单一真值源读写
  - 作用：`updateSenseMetadata()` 最终走这里更新 `NodeSense` 集合与 `Node.synonymSenses` embedded 副本
  - 关键函数：
    - `hydrateNodeSensesForNodes()`（`109-134` 行）
    - `saveNodeSenses()`（`272-354` 行）

- `backend/routes/nodes.js`
  - 模块：节点详情与 admin 兼容路由
  - 作用：
    - `GET /public/node-detail/:nodeId` 给前端“标题+释义选择浮层”与节点详情使用（`5834-6013` 行）
    - admin 旧释义编辑路径仍在，但百科正文直改已被禁用

- `backend/routes/senses.js`
  - 模块：旧释义路由
  - 作用：仍负责 sense 元信息兼容操作，但**正文编辑已明确被迁移到 revision 流**
  - 关键证据：`132-145`、`248-272` 行

### 2.6 后端模型

- `backend/models/SenseArticle.js`
  - 模型：当前发布 revision / latestDraftRevisionId / summary
  - 风险点：文章 summary 和 revision 指针本身不大，主要是关联 revision

- `backend/models/SenseArticleRevision.js`
  - 模型：revision 主体
  - 风险点：字段非常重，直接存 `editorSource`、`ast`、`headingIndex`、`referenceIndex`、`formulaRefs`、`symbolRefs`、`plainTextSnapshot`、`renderSnapshot`、`diffFromBase`（`152-193` 行）
  - 结论：这是“保存重、响应重、前端接收后重渲染”的核心模型

- `backend/models/NodeSense.js`
  - 模型：sense 元信息 / 旧正文镜像
  - 风险点：`content` 仍保留正文镜像（`19-23` 行），发布后还会同步回写

### 2.7 关键词搜索结果摘要

#### 高相关命中（已展开分析）

- `frontend/src/App.js`
- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
- `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- `frontend/src/components/senseArticle/useSenseArticleCompare.js`
- `frontend/src/utils/senseArticleApi.js`
- `frontend/src/utils/senseArticleSyntax.js`
- `backend/routes/senseArticles.js`
- `backend/routes/nodes.js`
- `backend/routes/senses.js`
- `backend/services/senseArticleService.js`
- `backend/services/senseArticleParser.js`
- `backend/services/senseArticleDiffService.js`
- `backend/services/senseArticleSerializer.js`
- `backend/services/nodeSenseStore.js`
- `backend/models/SenseArticle.js`
- `backend/models/SenseArticleRevision.js`
- `backend/models/NodeSense.js`

#### 低相关命中（路径保留，未作为主链路展开）

- `frontend/src/components/admin/AdminPanel.js`
- `frontend/src/components/modals/CreateNodeModal.js`
- `frontend/src/components/game/KnowledgeDomainScene.js`
- `backend/tests/senseArticleWorkflow.test.js`
- `backend/tests/senseArticleDiff.test.js`
- `backend/tests/senseArticleParser.test.js`
- `docs/sense-article-system-overview.md`
- `docs/sense-article-demo-walkthrough.md`

---

## 3. 业务调用链

### 3.1 页面入口链路

1. 应用入口
   - `frontend/src/index.js` -> `<App />`

2. 页面状态入口
   - `frontend/src/App.js`
   - `view === 'nodeDetail'` 时展示节点详情
   - `App.js:6520-6527` 提供“进入释义百科页”按钮
   - `App.js:5740-5888` 还提供“标题 + 释义选择浮层”入口

3. 打开阅读页
   - `openSenseArticleFromNode()` -> `openSenseArticleView()`（`App.js:5582-5589`, `5565-5580`）
   - `setSenseArticleContext(...)` + `setView('senseArticle')`
   - `App.js:6531-6542` 渲染 `SenseArticlePage`

### 3.2 点击“更新释义” -> 打开编辑页

- `frontend/src/components/senseArticle/SenseArticlePage.js:461-464`
  - “更新释义”按钮点击 -> `onOpenEditor({ mode: 'full' })`
- `frontend/src/App.js:5634-5689`
  - `handleOpenSenseArticleEditor()`
  - 先调用 `resolveEditableSenseArticleRevision()` 看是否已有可编辑 draft
  - 若无 draft：
    - 整页编辑 -> `senseArticleApi.createDraft()`
    - 选段编辑 -> `senseArticleApi.createFromSelection()`
    - 小节编辑 -> `senseArticleApi.createFromHeading()`
  - 再 `navigateSenseArticleSubView('senseArticleEditor', ...)`
- `frontend/src/App.js:6544-6557`
  - 挂载 `SenseArticleEditor`

### 3.3 编辑器加载链路

- `SenseArticleEditor` mount
- `SenseArticleEditor.js:76-109`
  - `senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId)`
- `frontend/src/utils/senseArticleApi.js:59`
  - `GET /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
- `backend/routes/senseArticles.js:117-129`
  - 路由 handler（controller）
- `backend/services/senseArticleService.js:619-635`
  - `getRevisionDetail()`
  - 读取 article / revision / baseRevision / permissions / reviewSummary
- `backend/services/senseArticleSerializer.js:56-68`
  - 返回完整 revision detail DTO

### 3.4 输入文本的数据流

#### 整页编辑模式

- `textarea(onChange)` -> `setSource(event.target.value)`（`SenseArticleEditor.js:433`）
- `scopedState` `useMemo` 重算（`137-145` 行；即使整页模式也会进入）
- `effectiveSource = source`（`147` 行）
- 180ms 后 `setDebouncedPreviewSource(effectiveSource)`（`148-153` 行）
- `previewRevision = parseSenseArticleSource(debouncedPreviewSource)`（`155-165` 行）
- `<SenseArticleRenderer revision={previewRevision} />` 全量重渲染（`447-449` 行）

#### 局部修订模式（更重）

- `textarea(onChange)` -> `setScopedText(event.target.value)`（`430` 行）
- `buildScopedRevisionState(...)` 每次 render 重新计算局部范围（`137-145` 行）
- `effectiveSource = scopedState.composeSource(scopedText)`（`147` 行）
- 180ms 后全文再次 parse（`148-165` 行）
- 同时 120ms 后 `buildTrackedChangeTokens(originalText, currentText)`（`201-210` 行）
- 再渲染“修订痕迹” token 列表（`427-430` 行）和全文预览（`447-449` 行）

### 3.5 保存草稿链路

- `SenseArticleEditor.js:350-352` 点击“保存草稿”
- `SenseArticleEditor.js:278-292` `saveDraft()`
- 前端顺序调用：
  1. `syncSenseMetadata()`
     - `senseArticleApi.updateMetadata()` -> `PUT /api/sense-articles/:nodeId/:senseId/metadata`
     - `backend/routes/senseArticles.js:160-172`
     - `backend/services/senseArticleService.js:638-693`
     - `backend/services/nodeSenseStore.js:272-354`
     - 数据库：`NodeSense` / `Node` 写入 + title projection 同步
  2. `senseArticleApi.updateDraft()`
     - `PUT /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
     - `backend/routes/senseArticles.js:145-158`
     - `backend/services/senseArticleService.js:759-801`
     - 数据库：`SenseArticleRevision` 更新、`SenseArticle.latestDraftRevisionId` 更新
- 保存成功后前端行为：
  - `setDetail(...)`
  - `setSource(nextSource)`
  - `setLastSavedState(...)`
  - `onContextPatch(...)`
- **没有立即 refetch 整页数据**
- **没有 optimistic update 到全局 store**
- **没有整棵树 refresh**

### 3.6 提交审核链路

- `SenseArticleEditor.js:353-354` 点击“提交审核”
- `SenseArticleEditor.js:295-310` `submit()`
- 前端顺序调用：
  1. `updateMetadata`
  2. `updateDraft`
  3. `submitRevision`
- `submitRevision` API
  - `frontend/src/utils/senseArticleApi.js:66`
  - `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/submit`
  - `backend/routes/senseArticles.js:174-185`
  - `backend/services/senseArticleService.js:820-878`
- 提交成功后前端行为：
  - `onSubmitted(data.revision)`
  - `App.js:6553-6556` 直接切到 `senseArticleHistory`
  - 同时调用 `fetchNotifications(true)`
- `SenseArticleHistoryPage` 再发请求：
  - `senseArticleApi.getRevisions(nodeId, senseId, { status: 'published', pageSize: 50 })`（`76-90` 行）

### 3.7 发布后的数据回写链路

当 revision 最终在 review 流被 approve 并发布时：

- `backend/services/senseArticleService.js:929-1153`
  - `reviewRevision()` 内部将 `SenseArticle.currentRevisionId` 切到新 revision（`1060-1071` 行）
  - 更新 revision 状态为 `published`（`1094-1110` 行）
  - supersede 兄弟修订（`1130-1134` 行）
  - `syncLegacySenseMirror()` 回写 `NodeSense.content` / `legacySummary`（`1136-1143` 行，函数定义在 `453-469` 行）

### 3.8 是否存在输入期间也请求后端？

存在，但不是正文 `source` 的输入热路径：

- 阅读页页内搜索：`SenseArticlePage.js:208-225`
- 编辑页引用插入器搜索：`SenseArticleEditor.js:183-197`

正文主输入区本身：

- `source` / `scopedText` 的 `onChange` **只改本地 state，不直接请求后端**
- 但它会触发本地**全文解析 + 全量预览渲染 + 局部 diff 计算**

---

## 4. 输入阶段的重渲染与高频计算风险

下面只列“有代码证据”的结论。

### 4.1 已确认存在的高风险点

1. **输入会触发高频本地 `setState`，并重渲染整个编辑页子树**
   - 证据：`SenseArticleEditor.js:430`, `433`, `437`, `419`
   - 说明：
     - 正文输入：`setScopedText` / `setSource`
     - 备注输入：`setNote`
     - 标题输入：`setSenseTitle`
   - 影响：虽然没有把 state 提升到 `App`，但会让整个 `SenseArticleEditor` 函数组件重跑，进而重建预览相关派生状态

2. **局部修订模式下，每次输入都会重建 derived state，并可能重新扫描整页源码**
   - 证据：`SenseArticleEditor.js:137-145` 调 `buildScopedRevisionState()`；`senseArticleScopedRevision.js:135-233`
   - 风险解释：
     - `buildScopedRevisionState()` 内部会做 `normalizeSource()`、`extractSectionRange()`、`locateSelectionRange()`、字符串切片拼装
     - 局部修订每次改一个字，都会重新定位 section/selection 范围，并重建 `composeSource`
   - 结论：属于“输入热路径上的派生状态重建”

3. **输入暂停 180ms 后会重新解析整篇正文，而不是只解析改动片段**
   - 证据：`SenseArticleEditor.js:147-165`；`senseArticleSyntax.js:171-299`
   - 风险解释：
     - `effectiveSource` 是整页源码
     - `parseSenseArticleSource()` 会从头扫描行、生成 AST、目录、引用索引、公式索引、纯文本快照、parseErrors
     - 没有增量解析、没有 worker、没有分块
   - 结论：这是最像“输入一段时间后突然卡住”的直接原因之一

4. **全文预览会在解析后整页重渲染，没有做块级 memo 或虚拟化**
   - 证据：`SenseArticleEditor.js:447-449`；`SenseArticleRenderer.js:177-203`
   - 风险解释：
     - 每次新的 `previewRevision` 都会让 `SenseArticleRenderer` 遍历全部 `blocks`
     - `referenceMap`、`annotationsByBlock`、`annotationsByHeading` 每次 render 现建
     - 全文越长，React reconciliation 越重
   - 结论：解析成本 + 渲染成本叠加

5. **局部修订的“修订痕迹”算法是二维 DP / LCS 型复杂度**
   - 证据：`SenseArticleEditor.js:201-210`；`senseArticleScopedRevision.js:257-298`
   - 风险解释：
     - `buildTrackedChangeTokens()` 构建 `rows x cols` 的二维矩阵（`265` 行）
     - 即使做了 `wordA.length * wordB.length > 40000` 时退化到 line 模式（`260-262` 行），仍然是 DP
     - 随后还会把 token 渲染成很多 `<span>`（`48-53` 行；`427-430` 行）
   - 结论：在“本节修订 / 选段修订”下风险显著高于整页修订

6. **输入热路径确实没有 debounce 的是本地 render；有 debounce 的是解析和 tracked diff，但仍是重计算**
   - 证据：
     - 预览 debounce：`SenseArticleEditor.js:148-153`
     - tracked diff debounce：`SenseArticleEditor.js:206-208`
   - 风险解释：
     - debounce 只能减少频率，不能降低单次计算成本
     - 对于大文本，180ms/120ms 后的单次任务仍可能足够重，造成主线程卡顿

### 4.2 已检查但暂未发现的点

7. **未发现正文输入时直接触发父组件 state 更新 / 接口请求 / store 更新 / 路由更新**
   - 证据：`SenseArticleEditor.js:419`, `430`, `433`, `437`
   - 结论：正文输入区 `onChange` 只改本地 state；输入热路径没有直接打 API，也没有直接改 `App` 的 `view` 或全局 store

8. **未发现 `useEffect` 依赖错误导致的明显无限循环**
   - 观察范围：`SenseArticleEditor.js`, `SenseArticlePage.js`, `useSenseArticleCompare.js`
   - 结论：目前更像“高成本计算造成卡顿”，不是“effect 死循环”

9. **未发现不稳定 key 导致编辑器反复卸载重建**
   - 证据：编辑页 `textarea` 没有动态 key；`App.js:6544-6557` 也没有给 `SenseArticleEditor` 设置变化中的 `key`
   - 结论：这不是当前主因

10. **未发现第三方富文本编辑器性能陷阱**
   - 证据：仓库中这里使用的是原生 `textarea` + 自研 parser/render，不是 ReactQuill/Draft/Slate/Lexical/Monaco
   - 结论：问题根因更可能在“自研预览管线”

11. **未发现 contenteditable 光标同步 / composition 递归更新**
   - 证据：编辑区是 `textarea`，没有 `contenteditable`，也没有 `compositionstart/compositionend` 逻辑
   - 结论：中文输入法兼容风险低于 contenteditable 方案

12. **未发现 modal/drawer/portal 焦点锁导致的编辑假死**
   - 证据：编辑页是独立页面布局；没有 modal/drawer/portal/focus-lock 组件
   - 结论：编辑过程“卡住”更像主线程阻塞，不像遮罩层挡住

---

## 5. 保存阶段的阻塞/假死/崩溃风险

### 5.1 已确认存在的高风险点

1. **保存和提交都是串行请求，期间按钮 disabled，后端慢时会表现成“像卡死”**
   - 证据：`SenseArticleEditor.js:278-309`, `350-354`
   - 风险解释：
     - 保存：`updateMetadata` -> `updateDraft`
     - 提交：`updateMetadata` -> `updateDraft` -> `submitRevision`
     - 期间 `saving/submitting` 为真，按钮不可点击
     - 如果请求长时间不返回，用户会看到页面一直“保存中/提交中”

2. **前端 API 层没有 timeout / AbortController，等待中的请求不会被主动取消**
   - 证据：`frontend/src/utils/senseArticleApi.js:33-46`
   - 风险解释：
     - `fetch` 没超时
     - 组件卸载时也不 cancel
     - 网络慢 / 后端慢 / 连接悬挂时，前端会一直挂住在 pending promise

3. **浏览器端会先把整个响应读成 text，再 JSON.parse，重 payload 时内存峰值会放大**
   - 证据：`frontend/src/utils/senseArticleApi.js:3-10`, `33-45`
   - 风险解释：
     - 大 revision 响应会先占一份字符串内存，再占一份对象内存
     - 对 `getRevisionDetail` / `updateDraft` 这类大响应尤其不利

4. **后端更新 draft 时会重新解析整篇源码、解析引用、生成结构化 diff，再保存整个 revision**
   - 证据：`backend/services/senseArticleService.js:759-801`, `435-450`
   - 风险解释：
     - `materializeRevisionPayload()` 内部先 `parseSenseArticleSource(editorSource)`
     - 再 `resolveReferenceTargets(parsed.referenceIndex)`
     - 再 `buildRevisionComparePayload({ fromRevision, toRevision })`
   - 结论：这是明显的“保存重路径”

5. **后端 diff 本身是高复杂度算法**
   - 证据：`backend/services/senseArticleDiffService.js:5-18`, `285-347`
   - 风险解释：
     - `buildLineDiff()` 使用二维 DP
     - `buildStructuredDiff()` 还会构建 section、做 pair、再生成 lineDiff
   - 结论：大文档保存时服务端 CPU / 响应时长会明显上升

6. **后端返回体本身很重，保存成功后前端还要接收完整 revision detail**
   - 证据：`backend/services/senseArticleSerializer.js:56-68`; `backend/services/senseArticleService.js:796-800`
   - 风险解释：
     - `serializeRevisionDetail()` 返回：`editorSource + ast + headingIndex + referenceIndex + formulaRefs + symbolRefs + plainTextSnapshot + renderSnapshot + diffFromBase + scopedChange`
     - `updateDraftRevision()` 成功后直接把这个大对象返回前端
   - 结论：即使保存成功，回包也可能造成一次大对象接收与 React state 更新

7. **保存路径中存在一个明确的后端 bug：`reviewableNodes` 未定义**
   - 证据：`backend/services/senseArticleService.js:294-324`，具体是 `307` 行
   - 风险解释：
     - `resolveReferenceTargets()` 查询得到 `[nodes, nodeSenses, articles]`
     - 但后面写成 `new Map(reviewableNodes.map(...))`
     - `reviewableNodes` 在该作用域根本不存在
   - 触发条件：当 `referenceIndex` 非空，即正文中出现引用 token 时，保存/创建 draft 很可能直接在后端抛错
   - 结论：这是一个会把“随机崩溃”放大的明确故障点

8. **更新释义名称也不是轻操作，会触发 NodeSense + Node 双写及 projection 同步**
   - 证据：`backend/services/senseArticleService.js:638-693`; `backend/services/nodeSenseStore.js:272-354`
   - 风险解释：
     - `saveNodeSenses()` 会 bulkWrite `NodeSense`
     - 然后更新 `Node.synonymSenses` embedded 副本与 `senseVersion`
     - `updateSenseMetadata()` 后又会 `syncDomainTitleProjectionFromNode(freshNode)`
   - 结论：保存时如果同时改正文和标题，负担更重

### 5.2 已检查但暂未发现的点

9. **未发现编辑页存在全屏 loading mask 忘记释放**
   - 证据：`saving/submitting` 都在 `finally` 里释放（`290-291`, `308-309` 行）
   - 结论：代码层面没有明显“忘记 set false”

10. **未发现保存成功后又自动 refresh 整页数据并形成前端死循环**
   - 证据：
     - `saveDraft()` 只本地 `setDetail / setSource / setLastSavedState`
     - `submit()` 成功后跳历史页，历史页重新拉 `published` 列表
   - 结论：保存阶段没有前端自触发的明显 refetch 死循环

11. **未发现 websocket / store subscribe 在 sense article 页里累积监听器**
   - 证据：相关页面没有 `socket.on` / `subscribe` / `event bus` 使用
   - 结论：监听器泄漏不是当前主嫌疑

12. **未发现 ErrorBoundary**
   - 证据：全仓库前端没有 `componentDidCatch` / `getDerivedStateFromError` / `ErrorBoundary`
   - 结论：任何未处理的 render/runtime 异常都可能直接炸掉整页

---

## 6. 最可能导致随机卡死的 Top 10 可疑点

### 1. 全文重新解析 + 全文预览整页重渲染

- 可疑等级：高
- 文件路径：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/utils/senseArticleSyntax.js`
  - `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- 相关函数/组件：`SenseArticleEditor`, `parseSenseArticleSource`, `SenseArticleRenderer`
- 触发条件：长正文、频繁输入、输入后停顿约 180ms
- 为什么会导致“随机卡住后崩溃”：
  - 每次停顿都会把整篇文章重新 parse 成 AST
  - parse 完又整页渲染 preview
  - 文本越长、块越多、引用/公式越多，主线程停顿越明显
  - “随机”通常对应“文本长度/结构达到阈值后，某次暂停触发重任务”
- 建议如何验证：
  - React DevTools Profiler 记录 `SenseArticleEditor` / `SenseArticleRenderer`
  - Performance 面板记录按键后 500ms 的主线程 flame chart
  - 打印 `editorSource.length`、`blocks.length`、`parse 耗时`

### 2. 局部修订模式下 tracked diff 的二维 DP

- 可疑等级：高
- 文件路径：
  - `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
- 相关函数/组件：`buildTrackedChangeTokens`, `SenseArticleEditor`
- 触发条件：从“选段修订/编辑本节”进入、编辑内容稍长、`originalText/currentText` token 数上升
- 为什么会导致“随机卡住后崩溃”：
  - `rows x cols` 二维矩阵可能快速变大
  - 之后还要渲染大量 token span
  - 局部修订比整页修订更容易出现“打一段后突然抖一下/卡一下”
- 建议如何验证：
  - 打日志：`wordA.length`, `wordB.length`, `mode`, `diff 耗时`, `token 数`
  - 对比整页修订与小节修订的性能差异

### 3. 局部修订状态在每次按键时都重建并合成全文

- 可疑等级：高
- 文件路径：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- 相关函数/组件：`buildScopedRevisionState`, `composeSource`
- 触发条件：section / selection 模式下任意输入
- 为什么会导致“随机卡住后崩溃”：
  - 并不是只改局部 `textarea`，而是每次都重新算局部边界和整页源码拼接
  - 如果源码很长，字符串切片与范围定位成本会持续叠加
- 建议如何验证：
  - 对 `buildScopedRevisionState()` 加 duration log
  - 记录 `baseSource.length`, `currentSource.length`, `scopedText.length`

### 4. 保存 draft 时后端重新解析 + 构建 diff 的重路径

- 可疑等级：高
- 文件路径：
  - `backend/services/senseArticleService.js`
  - `backend/services/senseArticleDiffService.js`
  - `backend/services/senseArticleParser.js`
- 相关函数/组件：`updateDraftRevision`, `materializeRevisionPayload`, `buildStructuredDiff`, `parseSenseArticleSource`
- 触发条件：点击保存/提交，且正文较大
- 为什么会导致“随机卡住后崩溃”：
  - 保存按钮 disabled 后，用户只能等后端做完整重计算
  - 如果请求被拖很久，前端表现就是“页面僵住、无操作反馈”
- 建议如何验证：
  - 后端给 `updateDraftRevision` 分阶段打点：parse / resolve refs / build diff / save / serialize
  - Network 记录 `PUT revisions/:revisionId` 的 duration

### 5. 含引用正文触发 `reviewableNodes` 未定义 bug

- 可疑等级：高
- 文件路径：`backend/services/senseArticleService.js`
- 相关函数/组件：`resolveReferenceTargets`
- 触发条件：正文里含 `[[sense:nodeId:senseId|...]]` 引用，且发生 create/update draft
- 为什么会导致“随机卡住后崩溃”：
  - 不是所有文本都会触发，只有解析出引用时才进入这个分支
  - 触发后后端直接抛异常，前端保存/创建 draft 会失败
  - 这类“只在某些内容结构下触发”的 bug 很符合“随机”表象
- 建议如何验证：
  - 用一段不含引用的正文保存，再用一段含引用 token 的正文保存，比较结果
  - 后端直接观察 500 日志/堆栈

### 6. 大 revision 响应体 + `response.text()` + `JSON.parse()` 双份占用

- 可疑等级：中高
- 文件路径：
  - `frontend/src/utils/senseArticleApi.js`
  - `backend/services/senseArticleSerializer.js`
- 相关函数/组件：`requestJson`, `serializeRevisionDetail`
- 触发条件：`getRevisionDetail`、`updateDraft`、`review` 返回大 revision detail 时
- 为什么会导致“随机卡住后崩溃”：
  - 浏览器端先拿到整块文本，再转对象
  - 对于 `editorSource + ast + diffFromBase + renderSnapshot` 同时存在的响应，内存峰值会明显上升
- 建议如何验证：
  - 在 Network 面板看响应大小
  - 在 Memory 面板观察保存前后的 heap
  - 打印 `JSON.stringify(data).length` 的近似大小（在线下临时打点，不是现在修复）

### 7. 预览渲染没有块级 memo，整棵渲染树每次都走

- 可疑等级：中高
- 文件路径：`frontend/src/components/senseArticle/SenseArticleRenderer.js`
- 相关函数/组件：`SenseArticleRenderer`, `InlineNodes`, `renderBlock`
- 触发条件：每次 `previewRevision` 更新
- 为什么会导致“随机卡住后崩溃”：
  - 大正文 AST block 多时，React diff 成本会上升
  - 不是单个 textarea 卡，而是右侧预览整页都一起重算
- 建议如何验证：
  - React Profiler 看 `SenseArticleRenderer` commit time
  - 统计 `blocks.length` 与 render time 的关系

### 8. 引用插入器搜索在输入时会持续打后端，而且后端实现偏重

- 可疑等级：中
- 文件路径：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `backend/services/senseArticleService.js`
- 相关函数/组件：`searchReferenceTargets`
- 触发条件：打开“引用插入器”后输入搜索词
- 为什么会导致“随机卡住后崩溃”：
  - 前端 180ms debounce 后就请求
  - 后端 `searchReferenceTargets()` 里有 `SenseArticle.find({}).limit(200)` 这种宽查询（`1275` 行）
  - 如果用户误把“正文卡顿”与“引用搜索卡顿”混在一起，会表现成编辑页整体很慢
- 建议如何验证：
  - 单独在引用插入器里输入，观察 Network waterfall
  - 对比关闭引用插入器时的输入体验

### 9. 开发环境 StrictMode 会放大加载 effect 和竞态

- 可疑等级：中
- 文件路径：
  - `frontend/src/index.js`
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
  - `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- 相关函数/组件：`React.StrictMode`, `load()` effects
- 触发条件：开发构建 / 本地调试环境
- 为什么会导致“随机卡住后崩溃”：
  - StrictMode 会放大副作用双执行
  - 这些页面的加载请求没有 abort/cancel 保护
- 建议如何验证：
  - 对比 dev build 与 production build 行为
  - 记录 mount 次数、请求次数

### 10. 缺少 ErrorBoundary，任何未处理渲染异常都会直接炸整页

- 可疑等级：中
- 文件路径：`frontend/src/index.js`（全局入口），全前端仓库未发现 ErrorBoundary
- 相关函数/组件：全局
- 触发条件：parser/render/compare 任一处抛异常
- 为什么会导致“随机卡住后崩溃”：
  - 一旦某次输入触发边界情况，页面没有兜底恢复
  - 用户会感知为“先卡住，随后整个页面挂掉”
- 建议如何验证：
  - 先看浏览器 Console 是否存在未捕获异常
  - 再看 React DevTools 是否有 render error

---

## 7. 建议抓取的运行时证据

### 7.1 建议加 render / duration log 的组件

- `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - 记录：render 次数、`source.length`、`scopedText.length`、`effectiveSource.length`

- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
  - 记录：render 次数、`blocks.length`、`referenceIndex.length`

- `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
  - 记录：
    - `buildScopedRevisionState()` 耗时
    - `buildTrackedChangeTokens()` 耗时
    - `wordA.length`, `wordB.length`, `mode`, `tokens.length`

- `frontend/src/utils/senseArticleSyntax.js`
  - 记录：`parseSenseArticleSource()` 耗时、`blocks.length`、`parseErrors.length`

### 7.2 建议重点看的 Network 请求

- `GET /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
  - 看首次打开编辑页的响应大小与耗时

- `PUT /api/sense-articles/:nodeId/:senseId/metadata`
  - 看改标题时是否单独很慢

- `PUT /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
  - 看保存草稿时的耗时、响应体大小、是否 500

- `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/submit`
  - 看提交阶段是否叠加慢请求

- `GET /api/sense-articles/:nodeId/:senseId/revisions?status=published&pageSize=50`
  - 看提交后跳历史页是否又触发额外加载

- `GET /api/sense-articles/reference-targets/search?q=...`
  - 只在引用插入器场景观察

### 7.3 建议重点做的 Performance profiling

- 浏览器 Performance：
  - 从按键开始录 3~5 秒
  - 关注 `Scripting` 峰值是否集中在 parse / React render / layout

- React DevTools Profiler：
  - 重点看 `SenseArticleEditor` 与 `SenseArticleRenderer`
  - 记录每次 commit 的耗时和频率

- Memory：
  - 记录打开编辑页前后
  - 长文本输入 30 秒后
  - 保存一次前后
  - 观察 heap 是否持续上升或保存时瞬时拉高

### 7.4 建议采集的业务侧指标

- 当前 revision：
  - `editorSource.length`
  - `headingIndex.length`
  - `referenceIndex.length`
  - `ast.blocks.length`
  - `plainTextSnapshot.length`

- 局部修订：
  - `originalText.length`
  - `currentText.length`
  - `trackedTokens.length`

- 后端保存：
  - parse 用时
  - resolve refs 用时
  - diff 用时
  - DB save 用时
  - serialize 用时
  - 响应体大小

### 7.5 建议优先看的 Console / 错误线索

- 浏览器 Console：
  - 是否有 `RangeError`、`Maximum call stack size exceeded`、`Out of memory`、React render error

- 后端日志：
  - 是否出现 `reviewableNodes is not defined`
  - 是否出现保存接口 500
  - 是否出现 parse/diff 超时或长时间无响应

---

## 8. 附录：关键代码摘录

### 摘录 1

- 文件路径：`frontend/src/components/senseArticle/SenseArticlePage.js`
- 起止行号：`461-464`
- 代码用途：阅读页“更新释义”按钮入口
- 与卡死/崩溃的关系：明确定位用户操作从哪一步进入编辑页

```js
<button type="button" className="btn btn-primary" onClick={() => onOpenEditor && onOpenEditor({ mode: 'full' })}>
  <PenSquare size={16} /> 更新释义
</button>
```

### 摘录 2

- 文件路径：`frontend/src/App.js`
- 起止行号：`5634-5679`
- 代码用途：打开编辑页时决定“复用已有 draft”还是“创建新 revision”
- 与卡死/崩溃的关系：这是点击“更新释义”后的实际业务分发点

```js
const handleOpenSenseArticleEditor = async ({ mode = 'full', anchor = null, headingId = '', preferExisting = false, revisionId = '' } = {}) => {
  ...
  const existing = await resolveEditableSenseArticleRevision(targetNodeId, targetSenseId);
  if (existing?.revision?._id) {
    navigateSenseArticleSubView('senseArticleEditor', { ... });
    return;
  }
  if (mode === 'selection') {
    data = await senseArticleApi.createFromSelection(...);
  } else if (mode === 'heading') {
    data = await senseArticleApi.createFromHeading(...);
  } else {
    data = await senseArticleApi.createDraft(...);
  }
  navigateSenseArticleSubView('senseArticleEditor', { ... });
};
```

### 摘录 3

- 文件路径：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 起止行号：`137-165`
- 代码用途：构建局部修订状态、合成全文源码、对预览做 180ms 防抖、再执行全文解析
- 与卡死/崩溃的关系：这是输入热路径上的核心计算链

```js
const scopedState = useMemo(() => buildScopedRevisionState({ ... }), [...]);
const effectiveSource = scopedState.isScoped ? scopedState.composeSource(scopedText) : source;
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedPreviewSource(effectiveSource || '');
  }, 180);
  return () => clearTimeout(timer);
}, [effectiveSource]);

const previewRevision = useMemo(() => {
  const parsed = parseSenseArticleSource(debouncedPreviewSource || '');
  return { ast: parsed.ast, ... };
}, [debouncedPreviewSource, revisionId]);
```

### 摘录 4

- 文件路径：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 起止行号：`201-210`
- 代码用途：局部修订模式下，120ms 后重算 tracked change token
- 与卡死/崩溃的关系：局部修订模式会额外叠加一次高成本 diff

```js
useEffect(() => {
  if (!scopedState.isScoped) {
    setDebouncedTrackedTokens([]);
    return undefined;
  }
  const timer = setTimeout(() => {
    setDebouncedTrackedTokens(buildTrackedChangeTokens(scopedState.originalText || '', scopedState.currentText || ''));
  }, 120);
  return () => clearTimeout(timer);
}, [scopedState.isScoped, scopedState.originalText, scopedState.currentText]);
```

### 摘录 5

- 文件路径：`frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- 起止行号：`257-298`
- 代码用途：tracked change 的核心 diff 实现
- 与卡死/崩溃的关系：明确存在二维 DP 矩阵

```js
const rows = a.length + 1;
const cols = b.length + 1;
const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

for (let indexA = a.length - 1; indexA >= 0; indexA -= 1) {
  for (let indexB = b.length - 1; indexB >= 0; indexB -= 1) {
    if (a[indexA] === b[indexB]) dp[indexA][indexB] = dp[indexA + 1][indexB + 1] + 1;
    else dp[indexA][indexB] = Math.max(dp[indexA + 1][indexB], dp[indexA][indexB + 1]);
  }
}
```

### 摘录 6

- 文件路径：`frontend/src/utils/senseArticleSyntax.js`
- 起止行号：`171-299`
- 代码用途：前端全文 parser
- 与卡死/崩溃的关系：每次预览都会重新从源码生成整套结构

```js
export const parseSenseArticleSource = (source = '') => {
  const normalized = String(source || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks = [];
  const headingIndex = [];
  const referenceIndex = [];
  ...
  while (lineIndex < lines.length) {
    ...
    finalizeBlock(...);
  }
  return { ast: { type: AST_NODE_TYPES.DOCUMENT, blocks }, headingIndex, referenceIndex, ... };
};
```

### 摘录 7

- 文件路径：`frontend/src/components/senseArticle/SenseArticleRenderer.js`
- 起止行号：`177-203`
- 代码用途：整页 AST 渲染
- 与卡死/崩溃的关系：每次 previewRevision 更新都会全量遍历 blocks

```js
const blocks = Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : [];
const referenceMap = new Map((Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : []).map((item) => [item.referenceId, item]));
...
return (
  <div className="sense-article-renderer">
    {blocks.map((block) => renderBlock({ block, ... }))}
  </div>
);
```

### 摘录 8

- 文件路径：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 起止行号：`278-303`
- 代码用途：保存草稿 / 提交审核
- 与卡死/崩溃的关系：保存阶段是串行请求，且提交会额外多一次请求

```js
const saveDraft = async () => {
  setSaving(true);
  try {
    const savedNodeSense = await syncSenseMetadata();
    const { payload, nextSource } = buildDraftPayload();
    const data = await senseArticleApi.updateDraft(nodeId, senseId, revisionId, payload);
    ...
  } finally {
    setSaving(false);
  }
};

const submit = async () => {
  setSubmitting(true);
  try {
    const savedNodeSense = await syncSenseMetadata();
    const { payload, nextSource } = buildDraftPayload();
    await senseArticleApi.updateDraft(nodeId, senseId, revisionId, payload);
    const data = await senseArticleApi.submitRevision(nodeId, senseId, revisionId);
    ...
  } finally {
    setSubmitting(false);
  }
};
```

### 摘录 9

- 文件路径：`frontend/src/utils/senseArticleApi.js`
- 起止行号：`3-10`, `33-45`
- 代码用途：统一请求与响应解析
- 与卡死/崩溃的关系：所有响应先读取全文 text，再 JSON.parse；且无 abort/timeout

```js
export const parseApiResponse = async (response) => {
  const text = await response.text();
  if (!text) return { data: null, raw: null };
  try {
    return { data: JSON.parse(text), raw: text };
  } catch (error) {
    return { data: null, raw: text };
  }
};
```

### 摘录 10

- 文件路径：`backend/services/senseArticleService.js`
- 起止行号：`294-307`
- 代码用途：解析引用目标
- 与卡死/崩溃的关系：存在确定性 bug，可能在某些引用内容下直接把保存/创建流程打崩

```js
const [nodes, nodeSenses, articles] = await Promise.all([
  Node.find({ _id: { $in: nodeIds } }).select('_id name').lean(),
  NodeSense.find({ nodeId: { $in: nodeIds } }).select('nodeId senseId title').lean(),
  SenseArticle.find({ nodeId: { $in: nodeIds } }).select('_id nodeId senseId currentRevisionId').lean()
]);
const nodeNameMap = new Map(reviewableNodes.map((item) => [String(item._id), item.name || '']));
```

### 摘录 11

- 文件路径：`backend/services/senseArticleService.js`
- 起止行号：`759-801`
- 代码用途：更新 draft revision
- 与卡死/崩溃的关系：保存时服务端会重新 materialize 整个 revision

```js
const editorSource = typeof payload.editorSource === 'string' ? payload.editorSource : revision.editorSource;
const materialized = await materializeRevisionPayload({ editorSource, baseRevision });
revision.editorSource = materialized.editorSource;
revision.ast = materialized.ast;
revision.headingIndex = materialized.headingIndex;
revision.referenceIndex = materialized.referenceIndex;
revision.formulaRefs = materialized.formulaRefs;
revision.symbolRefs = materialized.symbolRefs;
revision.parseErrors = materialized.parseErrors;
revision.plainTextSnapshot = materialized.plainTextSnapshot;
revision.renderSnapshot = materialized.renderSnapshot;
revision.diffFromBase = materialized.diffFromBase;
await revision.save();
```

### 摘录 12

- 文件路径：`backend/services/senseArticleDiffService.js`
- 起止行号：`5-18`, `285-347`
- 代码用途：行 diff + 结构化 diff
- 与卡死/崩溃的关系：保存/compare 的重 CPU 来源

```js
const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
for (let i = left.length - 1; i >= 0; i -= 1) {
  for (let j = right.length - 1; j >= 0; j -= 1) {
    ...
  }
}
```

### 摘录 13

- 文件路径：`backend/services/senseArticleSerializer.js`
- 起止行号：`56-68`
- 代码用途：revision detail DTO
- 与卡死/崩溃的关系：直接决定前端收到的大对象内容

```js
const serializeRevisionDetail = (revision = {}) => ({
  ...serializeRevisionSummary(revision),
  editorSource: revision?.editorSource || '',
  ast: revision?.ast || null,
  headingIndex: Array.isArray(revision?.headingIndex) ? revision.headingIndex : [],
  referenceIndex: Array.isArray(revision?.referenceIndex) ? revision.referenceIndex : [],
  formulaRefs: Array.isArray(revision?.formulaRefs) ? revision.formulaRefs : [],
  symbolRefs: Array.isArray(revision?.symbolRefs) ? revision.symbolRefs : [],
  plainTextSnapshot: revision?.plainTextSnapshot || '',
  renderSnapshot: revision?.renderSnapshot || null,
  diffFromBase: revision?.diffFromBase || null,
  scopedChange: revision?.scopedChange || null
});
```

### 摘录 14

- 文件路径：`frontend/src/index.js`
- 起止行号：`71-75`
- 代码用途：根组件渲染
- 与卡死/崩溃的关系：开发环境下 StrictMode 会放大副作用与竞态问题

```js
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## 结论摘要

从当前代码静态分析看，**最像随机卡死根因的不是某个单独的 setState 死循环，而是以下链路叠加**：

1. 编辑输入 -> `buildScopedRevisionState` / `effectiveSource` 重建
2. 180ms 后全文 `parseSenseArticleSource`
3. parse 完后 `SenseArticleRenderer` 全量渲染预览
4. 若是局部修订，再叠加 `buildTrackedChangeTokens` 的二维 DP
5. 保存时后端再完整 parse + diff + serialize
6. 若正文包含引用，还可能踩到 `reviewableNodes is not defined` 的明确 bug

因此，最优先的后续人工定位动作应聚焦在：

- `SenseArticleEditor` 输入阶段的 CPU/渲染 profile
- `parseSenseArticleSource` 与 `buildTrackedChangeTokens` 的耗时
- `updateDraftRevision` 的服务端分阶段耗时
- `PUT revisions/:revisionId` 的响应大小
- 含引用文本时是否直接触发 500

