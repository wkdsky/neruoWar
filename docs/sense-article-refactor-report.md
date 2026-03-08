# Sense Article Refactor Report

## 1. 改了哪些模型

### 保留并兼容扩展
- `backend/models/Node.js`
  - 保持其作为知识域容器、权限容器、图谱关系容器的职责。
- `backend/models/NodeSense.js`
  - 保留 `nodeId + senseId` 作为释义主键。
  - 新增 `legacySummary`。
  - `content` 不再作为百科正文唯一真源，而是兼容镜像字段。
- `backend/models/Notification.js`
  - 扩展百科修订相关通知类型。
  - 新增 `payload` 字段，承载 revision/article/stage 等结构化信息。
- `backend/models/User.js`
  - 内嵌通知结构同步扩展新通知类型与 `payload`。

### 新增核心模型
- `backend/models/SenseArticle.js`
  - 释义百科页主实体。
  - 维护 `currentRevisionId`、`latestDraftRevisionId`、摘要、版本号投影等。
- `backend/models/SenseArticleRevision.js`
  - 正式 revision 模型。
  - 存储 `editorSource`、`ast`、`headingIndex`、`referenceIndex`、`plainTextSnapshot`、双阶段审核状态、发布信息、superseded 关系等。
- `backend/models/SenseAnnotation.js`
  - 用户私有标注模型。
  - 仅本人可见，带 `anchorType + anchor`。

## 2. 改了哪些 API

### 新增 REST 路由
文件：`backend/routes/senseArticles.js`

#### 文章读取
- `GET /api/sense-articles/:nodeId/:senseId`
- `GET /api/sense-articles/:nodeId/:senseId/current`
- `GET /api/sense-articles/:nodeId/:senseId/revisions`
- `GET /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`

#### 编辑与提审
- `POST /api/sense-articles/:nodeId/:senseId/revisions/draft`
- `PUT /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/submit`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/from-selection`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/from-heading`

#### 审核
- `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/review/domain-admin`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/review/domain-master`

#### 私有标注
- `GET /api/sense-articles/:nodeId/:senseId/annotations/me`
- `POST /api/sense-articles/:nodeId/:senseId/annotations`
- `PUT /api/sense-articles/:nodeId/:senseId/annotations/:annotationId`
- `DELETE /api/sense-articles/:nodeId/:senseId/annotations/:annotationId`

#### 搜索 / 引用
- `GET /api/sense-articles/:nodeId/:senseId/search?q=...`
- `GET /api/sense-articles/:nodeId/:senseId/references`
- `GET /api/sense-articles/reference-targets/search?q=...`

### 服务端挂载
- `backend/server.js`
  - 新增 `app.use('/api/sense-articles', senseArticleRoutes);`

## 3. 改了哪些前端页面/组件

### 新增页面
- `frontend/src/components/senseArticle/SenseArticlePage.js`
  - 独立阅读页
  - 标题区、目录、页内搜索、引用跳转、私有标注显示、选段发起修订、编辑整页、查看历史/审核入口
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - 源码编辑 + 实时预览
  - 语法辅助插入、提交说明、保存草稿、提交审核
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
  - base/candidate 审阅
  - 源码 diff
  - 域相 / 域主审核动作
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
  - revision 历史列表
  - 当前发布版标识
  - 继续编辑 / 进入审阅

### 新增基础组件 / 工具
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/utils/senseArticleApi.js`
- `frontend/src/utils/senseArticleSyntax.js`

### 接入点重构
- `frontend/src/App.js`
  - 新增 view：`senseArticle` / `senseArticleEditor` / `senseArticleReview` / `senseArticleHistory`
  - 新增百科页上下文状态与页面切换逻辑
  - 通知点击可直接进入百科审阅/历史/阅读页
  - 节点主视角新增“进入当前释义百科页”入口
  - 释义选择面板新增每个 sense 的“百科页”按钮
- `frontend/src/components/modals/NodeInfoModal.js`
  - 新增“进入百科页”入口
- `frontend/src/App.css`
  - 新增百科入口按钮与释义选择面板按钮样式

## 4. parser 语法设计说明

文件：`backend/services/senseArticleParser.js`

采用路线：
- 真源：`editorSource`
- 派生：`ast` + `headingIndex` + `referenceIndex` + `plainTextSnapshot`

### 支持语法
- `# / ## / ###`：标题层级
- 段落：自然换行聚合
- 列表：`- item` / `1. item`
- 引用块：`> quote`
- 强调：`*text*`、`**text**`
- 行内代码：`` `code` ``
- 行内公式：`$...$`
- 公式块：
  ```text
  $$
  ...
  $$
  ```
- 符号短码：如 `:alpha:`、`:implies:`、`:union:`
- 跨释义引用：
  - `[[nodeId:senseId]]`
  - `[[sense:nodeId:senseId|显示文本]]`

### 解析产物
- `editorSource`
- `ast`
- `headingIndex`
- `referenceIndex`
- `formulaRefs`
- `symbolRefs`
- `plainTextSnapshot`
- `renderSnapshot`

### 设计原则
- 不把 HTML 作为唯一真源。
- 阅读页基于 AST 渲染，不走 `innerHTML`。
- 正文内引用与图谱关系彻底分层；引用只落 `referenceIndex`。

## 5. revision 状态机说明

集中定义：`backend/constants/senseArticle.js`

### 主状态
- `draft`
- `submitted`
- `pending_domain_admin_review`
- `changes_requested_by_domain_admin`
- `rejected_by_domain_admin`
- `pending_domain_master_review`
- `changes_requested_by_domain_master`
- `rejected_by_domain_master`
- `published`
- `superseded`
- `withdrawn`

### 审核阶段
- `domain_admin`
- `domain_master`
- `completed`

### 流程
1. 用户创建 / 保存草稿 -> `draft`
2. 提交后 -> `pending_domain_admin_review`
3. 域相审核：
   - approve -> `pending_domain_master_review`
   - reject -> `rejected_by_domain_admin`
   - request_changes -> `changes_requested_by_domain_admin`
4. 域主终审：
   - approve -> `published`
   - reject -> `rejected_by_domain_master`
   - request_changes -> `changes_requested_by_domain_master`

### Superseded 策略
- 当某个 revision 发布成功后：
  - 同一 `articleId`
  - 同一 `baseRevisionId`
  - 且仍处于活动审核状态的兄弟 revision
- 自动标记为 `superseded`
- 记录 `supersededByRevisionId`
- 发通知给对应 proposer

### 工作流抽象
- `backend/services/senseArticleWorkflow.js`
  - 抽出域相 / 域主审核状态迁移逻辑，便于测试与维护

## 6. 权限矩阵说明

实现文件：`backend/services/senseArticlePermissionService.js`

### 普通用户
- 可读已发布百科页
- 可创建草稿
- 可提交修订
- 可管理自己的私有标注
- 不可审核

### 域相
- 普通用户全部能力
- 可执行第一阶段审核（domain admin review）
- 不自动获得图谱关系编辑权

### 域主
- 普通用户全部能力
- 可终审发布
- 可继续管理原图谱 associations（沿旧逻辑）
- 但新百科正文正常流程必须走 revision 体系

### 系统管理员
- 可兜底读写与审核
- 可处理异常 revision

## 7. 迁移脚本说明

### 迁移脚本
- `backend/scripts/backfillSenseArticles.js`

### 命令
- `cd backend && npm run backfill-sense-articles`

### 行为
1. 遍历现有全部 `NodeSense`
2. 为每个 `nodeId + senseId` 创建 `SenseArticle`（若不存在）
3. 将现有 `NodeSense.content` 转为首个 `published revision`
4. 自动生成：
   - `editorSource`
   - `ast`
   - `headingIndex`
   - `referenceIndex`
   - `plainTextSnapshot`
5. 将 `SenseArticle.currentRevisionId` 指向该首版 revision
6. 回填 `NodeSense.legacySummary`

### 初始化 helper
- `backend/services/senseArticleMigrationService.js`
  - `buildLegacyArticleSeed(...)`
  - 统一 legacy -> 初始 published revision 的映射逻辑

### 兼容策略
- `NodeSense.content` 保留为兼容镜像字段
- 旧 suggestion 未自动迁移为 revision
- 现阶段建议：
  - 旧 suggestion 体系保留只读
  - 后续通过批量清理或人工 review 进入新 revision 体系

## 8. 已完成能力

- 每个释义拥有独立百科页实体与版本实体
- 各个释义节点主视角可进入百科页
- 阅读页具备：目录、页内搜索、引用跳转、私有标注展示
- 自定义百科源码编辑与预览
- 选段发起修订
- 以 heading 发起整节修订
- 草稿保存、提交审核
- 域相审核 / 域主终审双阶段流
- 发布后切换 current revision
- superseded 自动处理
- 通知系统接入 revision 流
- 私有高亮 / 标注 API 与前端交互
- 正文引用与图谱 associations 分层
- migration/backfill 脚本
- 基础解析与审核流测试

## 9. 未完成但建议后续补强的点

- 更精细的结构 diff / section diff，可替代当前源码行 diff
- 引用 hover 卡片可进一步补成富预览，而不仅是 title / 跳转
- 标注锚点漂移目前优先走 heading / 文本搜索，仍可增加 block hash 与 quote matching
- 前端编辑器目前是源码型 textarea，可后续升级为 code editor（Monaco / CodeMirror）
- 旧 `/api/senses` suggestion 与新 revision 流之间可补一个只读桥接页面
- 当前 notification UI 已接入跳转，但还可为百科通知单独做过滤面板与状态聚合
- 页内搜索目前为当前发布版文本搜索，可继续做 heading 聚类与结果高亮导航

## 10. 关键文件清单

### 后端
- `backend/constants/senseArticle.js`
- `backend/models/SenseArticle.js`
- `backend/models/SenseArticleRevision.js`
- `backend/models/SenseAnnotation.js`
- `backend/models/NodeSense.js`
- `backend/models/Notification.js`
- `backend/models/User.js`
- `backend/routes/senseArticles.js`
- `backend/services/senseArticleParser.js`
- `backend/services/senseArticleService.js`
- `backend/services/senseArticleSerializer.js`
- `backend/services/senseArticlePermissionService.js`
- `backend/services/senseArticleNotificationService.js`
- `backend/services/senseArticleAnchorService.js`
- `backend/services/senseArticleDiffService.js`
- `backend/services/senseArticleWorkflow.js`
- `backend/services/senseArticleMigrationService.js`
- `backend/services/notificationStore.js`
- `backend/scripts/backfillSenseArticles.js`
- `backend/tests/senseArticleParser.test.js`
- `backend/tests/senseArticleWorkflow.test.js`
- `backend/server.js`

### 前端
- `frontend/src/App.js`
- `frontend/src/App.css`
- `frontend/src/components/modals/NodeInfoModal.js`
- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/utils/senseArticleApi.js`
- `frontend/src/utils/senseArticleSyntax.js`
