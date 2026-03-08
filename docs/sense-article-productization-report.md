# Sense Article Productization Report

## 1. 本轮产品化目标

在不破坏既有 revision 主链的前提下，将已稳定的百科释义系统从“架构正确、主链可跑”推进到“更适合真实使用”的产品化阶段：

- 审阅：从纯源码 diff 升级到 section-aware 结构化对比
- 编辑：从基础源码编辑升级到更适合百科写作的辅助工作台
- 引用：从可跳转升级到可预览、可反查、可索引
- 治理：为域主 / 域相 / 管理员提供轻量但实用的内容治理看板
- 搜索：让页内搜索、引用查找和历史对比更适合真实内容运营

---

## 2. section-aware diff 设计

### 服务层设计

新增 / 增强：

- `backend/services/senseArticleDiffService.js`
- `backend/services/senseArticleService.js`
- `backend/routes/senseArticles.js`

新增结构化对比接口：

- `GET /api/sense-articles/:nodeId/:senseId/revisions/compare?from=...&to=...`

### diff 结构

对比不再只返回纯行 diff，而是返回：

- `summary`
  - 新增小节数
  - 删除小节数
  - 正文变更小节数
  - 标题变更数
  - 引用变化数
  - 公式变化小节数
- `sections`
  - 每个 section 的标题、级别、before/after 摘要
  - `changeTypes`
  - section 内 line diff
  - 引用变化详情
  - 公式变化详情
- `lineDiff`
  - 作为兜底保留，兼容原始源码差异查看

### 可表达的变化类型

当前结构化 diff 至少可表达：

- `heading_added`
- `heading_removed`
- `heading_renamed`
- `section_added`
- `section_removed`
- `section_modified`
- `references_changed`
- `formulas_changed`

### 前端接入

- `frontend/src/components/senseArticle/SenseArticleComparePanel.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`

审阅页与历史页都统一接入结构化对比面板：

- 先看 summary
- 再按 section 展开查看具体变化
- 引用变化与公式变化单独标记

---

## 3. 引用预览 / backlinks 设计

### 引用预览

后端：

- `backend/services/senseArticleService.js`
  - `hydrateReferencePreviewEntries(...)`
  - `listCurrentReferences(...)`

前端：

- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`

阅读页正文中的 `sense_reference` 现在支持：

- hover preview card
- 预览目标词条名 / 释义标题 / 摘要
- 显示目标状态：`published / unpublished / missing`

### backlinks

新增接口：

- `GET /api/sense-articles/:nodeId/:senseId/backlinks`

返回当前释义被哪些“当前发布版”百科页引用，包括：

- 来源 `nodeId / senseId`
- 来源名称
- 来源 revision 编号
- 引用次数
- 引用所处 heading / position

### 分层原则继续保持

本轮依旧严格保持：

- `article reference` 只服务阅读、预览、索引、backlinks
- `graph relation` 仍单独服务 `contains / extends / insert`
- 不发生正文引用自动改写图谱关系的混用

---

## 4. 编辑器辅助能力说明

### 保持源码为主

本轮没有引入重型 WYSIWYG，仍坚持：

- 左侧源码编辑
- 右侧结构化预览

### 新增辅助能力

编辑页新增：

- 标题插入
- 无序列表插入
- 有序列表插入
- 引用块插入
- 公式插入
- symbol 插入
- 引用插入器
- 语法帮助面板
- 未保存提示

### 引用插入器

编辑器可搜索目标词条 / 释义：

- 搜索结果显示标题与摘要
- 选中后自动插入 `[[sense:nodeId:senseId|显示文本]]`
- 可自定义显示文本

### 范围编辑上下文

对于：

- `section` 修订
- `selection` 修订

编辑页会额外展示：

- 当前修订模式
- 目标 heading
- 选段锚定原文
- 小节上下文摘要

让用户明确知道“这次修改基于什么范围发起”。

---

## 5. 内容治理视图说明

### 新增治理页

新增：

- `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
- `GET /api/sense-articles/dashboard?nodeId=...`

当前治理页优先满足真实运维场景，包括：

1. 待我审核 revisions
2. 我发起且被要求修改的 revisions
3. 长时间未处理的 revisions
4. recently published revisions
5. 标注健康度统计
   - exact
   - relocated
   - uncertain
   - broken
6. 高频被引用的释义页
7. legacy 未迁移残留 sense

### 访问方式

在阅读 / 编辑 / 审阅 / 历史页中，具备治理权限的用户可通过“治理面板”按钮进入。

### 当前定位

这是一个实用型工作台，不是 BI 系统：

- 优先高频任务
- 优先能快速跳转到 review/history/article
- 暂不追求复杂图表化

---

## 6. 搜索增强说明

### 页内搜索增强

后端：

- `buildArticleSearchResult(...)`

搜索结果结构增强为：

- `blockId`
- `blockHash`
- `headingId`
- `headingTitle`
- `snippet`
- `position`
- `matchLength`

### 前端阅读页体验

- 按 heading 分组
- 显示命中总数
- 支持上一个 / 下一个
- 点击结果滚动定位
- 对当前命中结果高亮

### 引用查找 / 词条搜索

- `searchReferenceTargets(...)` 现在返回更丰富结果：
  - `articleId`
  - `currentRevisionId`
  - `summary`
  - `displayLabel`

主要服务于：

- 引用插入器
- 内容查找
- 后续可扩展的百科内搜索

---

## 7. legacy 治理策略

### 旧 suggestion

当前策略：

- 旧 suggestion 正文编辑链路已被阻断，不再进入百科正文主链
- suggestion 可保留为历史兼容记录
- 对正文修改场景统一提示走 revision 流

### NodeSense.content 镜像

当前明确策略：

- `SenseArticle.currentRevisionId -> SenseArticleRevision` 是正文唯一主链
- `NodeSense.content` 仅作为：
  - legacy backup
  - 迁移兼容
  - 摘要镜像来源之一
- 新页面不再把它当阅读真源

### 历史状态展示

历史页对以下状态已做清晰区分：

- `published`
- `draft`
- `changes_requested_*`
- `rejected_*`
- `superseded`

---

## 8. 测试清单

本轮新增测试：

1. `backend/tests/senseArticleDiff.test.js`
   - 新增 heading
   - 删除 heading
   - heading 标题变更
   - section 文本修改
   - 引用变化
   - 公式变化

2. `backend/tests/senseArticleBacklinks.test.js`
   - backlinks 汇总结构与计数

3. `backend/tests/senseArticleSearch.test.js`
   - search result shape
   - heading 分组

保留并继续通过的既有测试包括：

- parser fixtures
- workflow 幂等
- anchor relocation
- permission
- notification payload
- migration/backfill 幂等

---

## 9. 仍建议后续继续增强的方向

1. 更强的 section rename / move 检测
   - 当前已能识别大多数常见标题变更，但仍可继续增强跨位置重排语义

2. 历史页任意双版本差异缓存
   - 当前按需请求 compare API
   - 后续可增加 compare cache 提升大文章体验

3. 引用预览的悬浮交互细节
   - 当前以轻量 preview card 为主
   - 后续可增加固定侧栏预览 / pin 功能

4. 更强的治理筛选
   - 例如按状态、时间、来源人、知识域批量筛选

5. legacy suggestion 归档页
   - 当前策略以主链隔离为主
   - 后续可提供专门只读档案页做历史治理
