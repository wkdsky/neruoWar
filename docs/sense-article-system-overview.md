# Sense Article System Overview

## 1. 系统目标与范围

`sense article` 子系统负责把原有“知识域 -> 释义 -> 纯文本 content -> suggestion 审核”的链路，升级为正式的“释义百科页”体系：

- 正文唯一真源是 `SenseArticle.currentRevisionId -> SenseArticleRevision`
- 阅读、编辑、提审、双阶段审核、发布、历史、结构化对比、引用、私有标注、治理面板都围绕 revision 主链展开
- `Node` 继续承担知识域容器、图谱关系容器、权限容器职责
- `NodeSense` 继续承担释义元信息职责，不再作为百科正文真源

### 与旧链路的边界

- `NodeSense.content`
  - 仅作为 legacy backup / 摘要镜像 / 旧页面兼容字段
  - 不再驱动新百科页阅读
- 旧 `/api/senses` suggestion 流
  - 不再承担百科正文修订主链
  - 若仍保留，仅服务非百科兼容场景或只读归档场景
- 正文内引用与图谱关系严格分层
  - `article reference`：阅读跳转、预览、backlinks、索引
  - `graph relation`：`contains / extends / insert`

---

## 2. 核心实体关系

### `Node`

承担：

- 知识域基础信息
- 域主 / 域相权限
- 图谱关系源
- 标题投影与关联关系容器

### `NodeSense`

承担：

- `nodeId + senseId` 释义主键
- 释义标题、排序、状态等元信息
- legacy 摘要镜像

### `SenseArticle`

承担：

- 释义百科页主实体
- `nodeId + senseId` 唯一对应一个百科页
- 当前发布版指针 `currentRevisionId`
- 渲染 / 目录 / 搜索相关版本号

### `SenseArticleRevision`

承担：

- revision 真正内容与审核状态
- `editorSource` 源码真源
- `ast / headingIndex / referenceIndex / plainTextSnapshot`
- 双阶段审核字段
- 发布、驳回、要求修改、superseded 等流转结果
- anchor / section / selection 修订上下文

### `SenseAnnotation`

承担：

- 用户私有高亮与标注
- 仅本人可见
- 锚定到某一 revision，并在发布版变动后尝试重定位

### `Notification`

相关职责：

- revision 提交、审核、要求修改、发布、supersede、引用等通知分发
- 通过结构化 payload 驱动前端跳转，而不是依赖 message 文本解析

---

## 3. 主流程

### 阅读

1. 进入“释义百科页”入口
2. 后端读取 `SenseArticle.currentRevisionId`
3. 加载当前发布版 `SenseArticleRevision`
4. 返回结构化阅读 DTO、权限、当前用户私有标注摘要、引用与 backlinks

### 编辑草稿

1. 从阅读页发起整页 / 小节 / 选段修订
2. 后端创建草稿 revision
3. 编辑页以源码为主、预览为辅
4. 保存草稿只更新 revision，不改动发布版

### 提交审核

1. 草稿 revision 提交后进入待审核状态
2. 进入双阶段审核流

### 域相审核

- 通过：进入域主终审
- 驳回：进入域相驳回终态
- 要求修改：进入要求修改状态，原发起人继续编辑

### 域主发布

- 通过：revision 发布为当前正式版，`SenseArticle.currentRevisionId` 切换
- 驳回：进入域主驳回终态
- 要求修改：进入域主要求修改状态

### 阅读发布版

- 阅读页始终只显示当前发布版
- 历史页可查看所有 revision
- 审阅页对比候选 revision 与基线 revision

### 私有标注

- 用户在阅读页选中文本后创建高亮 / 标注
- 标注不进入发布版正文
- 发布版变化后通过 anchor 重定位服务重新定位

### 引用预览 / backlinks

- 正文内 `sense_reference` 支持 hover / click 预览
- 可查看被哪些其他百科页引用
- 不自动改写图谱关系

### 治理面板处理

治理面板面向域主 / 域相 / 管理员，集中呈现：

- 待我审核 revisions
- 被要求修改 revisions
- 超时未处理 revisions
- 最近发布
- 高频被引用词条
- 标注健康度
- legacy 未迁移残留项

---

## 4. Revision 状态机

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

### 合法迁移

- `draft -> pending_domain_admin_review`
- `pending_domain_admin_review -> pending_domain_master_review`
- `pending_domain_admin_review -> rejected_by_domain_admin`
- `pending_domain_admin_review -> changes_requested_by_domain_admin`
- `pending_domain_master_review -> published`
- `pending_domain_master_review -> rejected_by_domain_master`
- `pending_domain_master_review -> changes_requested_by_domain_master`
- `changes_requested_* -> draft`（继续编辑后重新提审）

### `superseded` 规则

当某个 revision 成功发布后：

- 系统会重新检查同 article、同 `baseRevisionId` 的活动 revision
- 活动态 sibling revisions 会被幂等转为 `superseded`
- 已 `rejected / withdrawn / published` 的 revision 不会被误覆盖

---

## 5. Anchor 与局部修订

anchor 体系服务两个场景：

- 从阅读页选段发起修订
- 私有标注在发布版变化后的重定位

### richer anchor 结构

至少包含：

- `revisionId`
- `headingId`
- `blockId`
- `blockHash`
- `textQuote`
- `selectedTextHash`
- `textPositionStart / textPositionEnd`
- `prefixText / suffixText`

### 重定位优先级

1. exact revision match
2. `blockId / blockHash`
3. `headingId + quote`
4. `textQuote + prefix/suffix` 模糊匹配
5. plain text fallback search

### 重定位结果

- `exact`
- `relocated`
- `uncertain`
- `broken`

---

## 6. Parser / AST / 引用系统

### 内容真源

- 真源：`editorSource`
- 派生：`ast / headingIndex / referenceIndex / plainTextSnapshot`

### AST 语义节点

至少覆盖：

- `document`
- `heading`
- `paragraph`
- `list`
- `list_item`
- `blockquote`
- `code_inline`
- `emphasis`
- `strong`
- `formula_inline`
- `formula_block`
- `symbol`
- `sense_reference`
- `text`

### 引用系统

正文引用采用轻量语法，例如：

- `[[sense:nodeId:senseId|显示文本]]`

解析后沉淀到 `referenceIndex`，并用于：

- 阅读跳转
- hover 预览
- backlinks
- 历史 diff 中的引用变化展示

---

## 7. Structured Diff

结构化 diff 服务按以下顺序生成：

1. 先按 `heading` 进行 section 划分
2. 再在 section 内做源码行级 diff
3. 额外计算引用变化与公式变化

### 当前可表达的变化类型

- `heading_added`
- `heading_removed`
- `heading_renamed`
- `section_added`
- `section_removed`
- `section_modified`
- `references_changed`
- `formulas_changed`

### 使用页面

- `SenseArticleReviewPage`
- `SenseArticleHistoryPage`

---

## 8. 权限矩阵

### 普通用户

- 可读已发布百科页
- 可创建自己的修订草稿
- 可提交修订审核
- 可管理自己的私有标注

### 域相

- 拥有普通用户能力
- 可执行第一阶段审核
- 不自动拥有最终发布权

### 域主

- 拥有普通用户能力
- 可执行终审并发布
- 可继续沿原系统管理图谱关系
- 不应绕过 revision 主链直接改百科正文

### 系统管理员

- 拥有兜底权限
- 可管理异常 revision 与修复流程
- 仅在系统级维护场景保留更高权限入口

---

## 9. Legacy 治理策略

### `NodeSense.content`

- 保留为 legacy backup / 摘要镜像
- 不再作为新阅读链路正文来源
- 只在迁移初始 backfill 或旧页面兼容时保留有限使用

### 旧 suggestion 流

- 与新 revision 主链明确分层
- 不再作为百科正文修改入口
- 可保留为非百科 legacy 功能或只读归档

---

## 10. API 概览

### 阅读

- `GET /api/sense-articles/:nodeId/:senseId`
- `GET /api/sense-articles/:nodeId/:senseId/current`

### revision

- `GET /api/sense-articles/:nodeId/:senseId/revisions`
- `GET /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
- `GET /api/sense-articles/:nodeId/:senseId/revisions/compare?from=...&to=...`

### 编辑与提审

- `POST /api/sense-articles/:nodeId/:senseId/revisions/draft`
- `PUT /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/submit`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/from-selection`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/from-heading`

### 审核

- `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/review/domain-admin`
- `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/review/domain-master`

### 标注 / 搜索 / 引用

- `GET /api/sense-articles/:nodeId/:senseId/annotations/me`
- `POST /api/sense-articles/:nodeId/:senseId/annotations`
- `PUT /api/sense-articles/:nodeId/:senseId/annotations/:annotationId`
- `DELETE /api/sense-articles/:nodeId/:senseId/annotations/:annotationId`
- `GET /api/sense-articles/:nodeId/:senseId/search?q=...`
- `GET /api/sense-articles/:nodeId/:senseId/references`
- `GET /api/sense-articles/:nodeId/:senseId/backlinks`
- `GET /api/sense-articles/reference-targets/search?q=...`
- `GET /api/sense-articles/dashboard?nodeId=...`

---

## 11. 前端页面结构概览

### `SenseArticlePage`

- 阅读页
- 目录、页内搜索、正文阅读、引用预览、backlinks、私有标注

### `SenseArticleEditor`

- 源码编辑 + 预览
- 插入工具栏、引用插入器、语法帮助、范围上下文

### `SenseArticleReviewPage`

- 审阅候选 revision
- 结构化 diff、审核意见、审核动作

### `SenseArticleHistoryPage`

- 查看 revision 历史
- 任意双版本对比
- 跳转编辑 / 审阅

### `SenseArticleDashboardPage`

- 面向治理角色的内容工作台
- 待审、被要求修改、超时、最近发布、引用治理、legacy 残留

---

## 12. 后续建议路线图

仅保留方向，不在当前 RC 版本继续扩散：

1. 更细粒度的结构 diff 可视化
2. 更完善的引用来源定位与来源上下文展示
3. 治理面板统计筛选与批处理能力
4. 释义百科页范围内搜索的更强排序与召回
5. demo seed / sample workspace 的自动化脚本化构造
