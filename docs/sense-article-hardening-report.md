# Sense Article Hardening Report

## 1. 本轮强化目标

本轮不是新增大功能，而是把已落地的 `sense article` 新架构收口为稳定主链：

- 明确百科正文唯一真源：`SenseArticle.currentRevisionId -> SenseArticleRevision`
- 强化 revision 状态迁移的幂等、竞争保护与 superseded 策略
- 增强 anchor 富锚点与重定位稳定性
- 规范 parser / AST / render contract
- 统一前端 article context、页面头部与通知跳转语义
- 扩大后端核心测试覆盖，覆盖真实风险而非只测 happy path
- 把旧 `NodeSense.content` / suggestion 正文链路彻底降级为兼容路径

---

## 2. 已切断的旧正文链路

### 已切断 / 已拒绝正文直改

1. `backend/routes/senses.js`
   - `POST /api/senses/node/:nodeId/:senseId/suggestions`
     - 若提交 `proposedContent`，直接返回 `409`，错误码 `sense_article_revision_flow_required`
     - 仅保留“题目类 suggestion”兼容能力
   - `POST /api/senses/node/:nodeId/:senseId/suggestions/:suggestionId/review`
     - 若待审 suggestion 含 `proposedContent`，禁止以旧链路审批落地到 `NodeSense.content`
   - `PUT /api/senses/node/:nodeId/:senseId`
     - 若请求试图改 `content`，直接拒绝；仅允许题目元信息兼容更新

2. `backend/routes/nodes.js`
   - `PUT /api/nodes/:nodeId/admin/senses/:senseId/text`
     - 对正文修改返回 `409`，错误码 `sense_article_revision_flow_required`
     - 只保留题目兼容编辑

3. `frontend/src/components/admin/AdminPanel.js`
   - 管理员释义编辑表单中的正文 textarea 改为只读提示
   - 保存按钮语义降级为“保存题目”
   - 若正文被改动，前端直接提示用户走百科修订流

### 已保留但仅做兼容的旧接口

- `POST /api/senses/node/:nodeId`
  - 仍可用于新建 legacy sense 元信息，但会在保存后立即 `bootstrapArticleFromNodeSense(...)`
- `POST /api/nodes/:nodeId/admin/senses`
  - 仍可用于管理员新增 sense 元信息/图谱关系，但会在保存后立即创建对应 article + 初始 revision
- `NodeSense.content`
  - 仅保留为 legacy backup / 摘要镜像 / 旧页面兼容字段
  - 新百科页不再直接从该字段取正式正文

### 已改为 revision-only 的主链

- 新百科阅读页：`GET /api/sense-articles/:nodeId/:senseId/current`
- 新百科版本列表：`GET /api/sense-articles/:nodeId/:senseId/revisions`
- 新百科修订详情：`GET /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
- 新百科编辑/提审/审核：全部走 `/api/sense-articles/.../revisions/*`

---

## 3. revision 幂等与状态保护说明

### 状态机收紧

集中在：

- `backend/services/senseArticleWorkflow.js`
- `backend/constants/senseArticle.js`

本轮将 revision 工作流显式分为：

- `apply`：允许迁移并返回状态补丁
- `noop`：重复操作，视为幂等成功，不重复推进状态
- `invalid`：非法状态迁移，必须拒绝

### 已强化的幂等行为

1. `submit`
   - `draft` / `changes_requested_*` -> `pending_domain_admin_review`
   - 若已是 `pending_domain_admin_review`，返回 `noop`
   - `published` / `superseded` / `withdrawn` / `rejected_*` 不允许再次提交

2. `domain admin review`
   - 仅允许在 `pending_domain_admin_review` 审核
   - 已进入 `pending_domain_master_review` 后，重复 `approve` 返回 `noop`
   - `published` / `superseded` / `withdrawn` 等状态禁止再审

3. `domain master review`
   - 未经域相批准，不允许提前终审
   - 已 `published` 的 revision 再次 `approve` 返回 `noop`
   - `superseded` / `withdrawn` 等状态禁止再审

### 竞争条件与 publish 保护

集中在：`backend/services/senseArticleService.js`

- `submitRevision` 与 `reviewByDomainAdmin` 使用条件更新，避免“先读旧状态后覆盖新状态”
- `reviewByDomainMaster` 发布前对 `SenseArticle.currentRevisionId === baseRevisionId` 做 compare-and-swap
  - 防止同一基线多个 candidate 同时发布
- 发布成功后调用 `supersedeSiblingRevisions(...)`
  - 仅处理 `ACTIVE_SUPERSEDE_STATUSES` 中的活动态 sibling revision
  - 不误伤 `rejected_* / withdrawn / published`
  - 可重复执行，保持幂等

---

## 4. anchor 模型增强说明

### 模型增强

`SenseArticleRevision.selectedRangeAnchor` 与 `SenseAnnotation.anchor` 统一增强为 richer anchor：

- `revisionId`
- `headingId`
- `blockId`
- `textQuote`
- `textPositionStart`
- `textPositionEnd`
- `prefixText`
- `suffixText`
- `blockHash`
- `selectedTextHash`

### block 稳定性增强

- `backend/services/senseArticleParser.js`
  - 为 paragraph / list item / blockquote / formula block / code block 生成稳定 `blockId`
  - 为每个 block 生成 `blockHash`
  - AST block 同时携带 `plainText`

### 重定位策略

集中在：`backend/services/senseArticleAnchorService.js`

优先级为：

1. exact revision match
2. `blockId / blockHash`
3. `headingId + quote`
4. `textQuote + prefix/suffix` 上下文匹配
5. plain text fallback
6. broken

重定位结果显式返回：

- `exact`
- `relocated`
- `uncertain`
- `broken`

### 前端表现

- 阅读页与渲染器新增 `uncertain / broken` 可视提示
- 阅读页选段锚点采集补充：`blockHash / selectedTextHash / prefixText / suffixText`
- 标注卡片显示定位状态，不再静默失败

---

## 5. parser / AST 契约说明

### 合同集中定义

- `backend/constants/senseArticle.js`
- `frontend/src/utils/senseArticleSyntax.js`

### AST 节点类型

统一枚举包括：

- `document`
- `heading`
- `paragraph`
- `list`
- `list_item`
- `blockquote`
- `text`
- `emphasis`
- `strong`
- `code_inline`
- `formula_inline`
- `formula_block`
- `symbol`
- `sense_reference`
- `code_block`

### 派生结构

parser 统一产出：

- `editorSource`
- `ast`
- `headingIndex`
- `referenceIndex`
- `formulaRefs`
- `symbolRefs`
- `plainTextSnapshot`
- `renderSnapshot`
- `parseErrors`

### heading / reference 稳定性

- headingId 使用 slug + 冲突后缀策略，避免重名冲突
- referenceIndex 与 AST inline `sense_reference` 同步生成
- renderSnapshot 作为缓存产物，只从 parser AST 派生，不作为真源

### 结构化错误

parser 错误不再是散乱字符串，统一为：

- `invalid_reference_syntax`
- `unclosed_reference`
- `unclosed_inline_mark`

每条错误携带：

- `code`
- `message`
- `line`
- `column`
- `raw`

---

## 6. 通知 payload schema

### 集中定义

- `backend/constants/senseArticle.js`
- `backend/services/senseArticleNotificationService.js`

### 公共字段

百科 revision 通知 payload 至少带：

- `schemaVersion`
- `nodeId`
- `senseId`
- `articleId`
- `revisionId`
- `stage`
- `action`
- `actorId`

### 扩展字段

按类型补充：

- `sense_article_revision_superseded`
  - `publishedRevisionId`
- `sense_article_referenced`
  - `sourceNodeId`
  - `sourceSenseId`
  - `sourceArticleId`
  - `sourceRevisionId`
  - `referencedNodeId`
  - `referencedNodeName`

### 本轮补强点

- 新增 `sense_article_domain_master_rejected`
- 前端通知跳转不再依赖 message 文本解析，而是依赖结构化 payload：
  - review requested -> review
  - changes requested -> editor
  - published / superseded / master rejected -> history
  - referenced -> reading（尽量保留来源提示）

---

## 7. 前端 page context / 导航统一

### App 主 context

`frontend/src/App.js` 新增统一 article context shape：

- `nodeId`
- `senseId`
- `articleId`
- `currentRevisionId`
- `selectedRevisionId`
- `revisionId`
- `originView`
- `breadcrumb`
- `returnTarget`
- `sourceHint`
- `nodeName`
- `senseTitle`
- `revisionStatus`

### 页面统一头部

新增：

- `frontend/src/components/senseArticle/SenseArticlePageHeader.js`
- `frontend/src/components/senseArticle/senseArticleUi.js`

阅读 / 编辑 / 审阅 / 历史页都统一展示：

- 词条标题
- 释义标题
- 页面类型
- revision 状态 badge
- breadcrumb
- 返回入口

### 阅读体验增强

- 页内搜索支持：
  - 命中总数
  - 上一个 / 下一个
  - 高亮滚动定位
  - 按 heading 粗分组
- TOC 支持：
  - 平滑滚动
  - 当前 heading 高亮
  - “编辑本节”联动
- 引用跳转：
  - 跨释义跳转时保留来源提示 `sourceHint`

---

## 8. 新增测试清单

新增 / 重写：

1. `backend/tests/senseArticleParser.test.js`
   - 混合标题/引用/公式/列表
   - 非法引用语法
   - 重名标题
   - 空文档 / 大文档
   - 结构化 parseErrors

2. `backend/tests/senseArticleWorkflow.test.js`
   - 重复 submit
   - 重复 approve
   - domain master 提前审批非法
   - superseded candidate 选择

3. `backend/tests/senseArticleAnchor.test.js`
   - 插入段落后重定位
   - 标题不变但文本偏移后重定位
   - 文本改写后 uncertain / broken 回退

4. `backend/tests/senseArticlePermission.test.js`
   - 越权矩阵 / 审核权限验证

5. `backend/tests/senseArticleNotification.test.js`
   - payload schema 正向校验
   - payload 缺字段时校验失败

6. `backend/tests/senseArticleMigration.test.js`
   - backfill 规划幂等
   - legacy seed 构造正确

并更新：

- `backend/package.json`
  - `npm run test:sense-articles` 改为执行 `tests/senseArticle*.test.js`

---

## 9. 关键文件清单

### 后端

- `backend/constants/senseArticle.js`
- `backend/routes/senses.js`
- `backend/routes/nodes.js`
- `backend/services/senseArticleService.js`
- `backend/services/senseArticleWorkflow.js`
- `backend/services/senseArticleAnchorService.js`
- `backend/services/senseArticleParser.js`
- `backend/services/senseArticleNotificationService.js`
- `backend/services/senseArticleMigrationService.js`
- `backend/scripts/backfillSenseArticles.js`

### 前端

- `frontend/src/App.js`
- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/SenseArticlePageHeader.js`
- `frontend/src/components/senseArticle/senseArticleUi.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/utils/senseArticleSyntax.js`
- `frontend/src/components/admin/AdminPanel.js`

### 测试

- `backend/tests/senseArticleParser.test.js`
- `backend/tests/senseArticleWorkflow.test.js`
- `backend/tests/senseArticleAnchor.test.js`
- `backend/tests/senseArticlePermission.test.js`
- `backend/tests/senseArticleNotification.test.js`
- `backend/tests/senseArticleMigration.test.js`

---

## 10. 仍待后续增强的点

1. section-aware diff 仍可继续增强
   - 当前已有源码 diff，但可进一步按 heading 分段再做段内 diff

2. 历史页任意两个 revision 对比
   - 本轮主要统一 context 与入口，任意双版本 compare 仍可继续补强

3. 通知中心对百科通知聚合筛选
   - payload 已足够结构化，前端过滤 UI 可继续增强

4. 旧 suggestion 数据治理
   - 当前已阻断其正文主链作用
   - 但历史 suggestion 数据仍建议后续迁移清理或明确只读归档

5. 后端更强事务保护
   - 当前已使用条件更新 / compare-and-swap
   - 若后续引入更高并发审批，可继续补强事务边界与冲突恢复
