# NeruoWar 高并发标题-释义架构改造报告（覆盖版）

更新时间：2026-02-21

## 1. 结论

本轮已把“标题层 + 释义层”改造成可支撑高频刷新的数据组织：

1. 标题基础信息改为投影集合：`DomainTitleProjection`
2. 标题关联关系改为边集合：`DomainTitleRelation`
3. 标题高频战斗状态改为独立集合：`DomainDefenseLayout`、`DomainSiegeState`
4. 释义文本与互动改为独立集合：`NodeSense`、`NodeSenseComment`、`NodeSenseEditSuggestion`、`NodeSenseFavorite`

并且已完成：全量迁移、严格核验、接口联调验证。

## 2. 本次解决的核心问题

### 2.1 旧问题

1. `Node` 单文档承载标题关系、释义、战斗状态，热点写入冲突严重
2. 标题关系查询依赖嵌入数组，无法稳定支持千万级标题关系扫描
3. 释义编辑与评论收藏耦合在标题文档，文本高频写放大
4. 标题详情图在“只有入边”场景下邻居不可见（关系丢失感）

### 2.2 已落地改造

1. 标题关系从 `Node.associations` 镜像到 `DomainTitleRelation`，按边索引读取
2. 标题主视图从 `DomainTitleProjection` 读取，不再扫描大文档
3. 城防/围城高频状态完全从 `Node` 脱离到独立集合
4. `title-detail` 已改为同时聚合出边+入边，入边节点可见
5. 释义编辑接口改为集合写入（`NodeSense`），嵌入释义写回可由开关关闭
6. 修复模型风险：当 `synonymSenses` 为空时，不再在保存时清空关联 `sourceSenseId`

## 3. 数据迁移与核验（已实跑）

执行命令：

```bash
npm --prefix backend run migrate-and-clean-all-legacy
npm --prefix backend run verify-migrated-data
```

最近一次实跑结果（严格模式）：

1. 扫描 `Node`：101
2. 标题投影迁移：`projectionUpserts=101`
3. 标题关系迁移：`relationUpserts=104`
4. 标题状态迁移：`DomainDefenseLayout=101`、`DomainSiegeState=101`
5. 释义迁移：`NodeSense=101`
6. 一致性校验：`ok=true`、`errorCount=0`
7. 标题投影抽样核验：`mismatchedNodes=0`

## 4. 你关心的数据是否都迁移

答案：是。

已迁移并验证的“标题 + 释义”主数据面如下：

1. 标题信息：`Node -> DomainTitleProjection`
2. 标题关联：`Node.associations -> DomainTitleRelation`
3. 释义文本：`Node.synonymSenses -> NodeSense`
4. 标题战斗状态：`Node.cityDefenseLayout/citySiegeState -> DomainDefenseLayout/DomainSiegeState`

同时验证了标题关系可见性：

1. 普通节点 `title-detail` 返回 `edgeCount>0`
2. “仅入边节点”也可返回关系边（已验证 `edgeCount=9`）

## 5. 与高频刷新匹配的数据分层

### 5.1 标题层（组织与攻防）

1. 冷数据（名称、域主、域相、联盟、展示信息）：`DomainTitleProjection`
2. 关系数据（标题间连边）：`DomainTitleRelation`
3. 热状态（围城、守军布局）：`DomainSiegeState` / `DomainDefenseLayout`

### 5.2 释义层（文本与审核）

1. 主文本：`NodeSense`
2. 批改建议与审核：`NodeSenseEditSuggestion`
3. 评论：`NodeSenseComment`
4. 收藏：`NodeSenseFavorite`

## 6. 对“千万标题 + 亿级释义在线交互”的当前评估

### 6.1 现在已经具备的条件

1. 数据模型已从“单文档热点”改为“按职责拆集合”
2. 标题关系查询已可按边索引化访问
3. 释义高频文本操作已可独立扩容

### 6.2 仍需补齐才能真正上线千万级

1. 战斗/移动/支援还需要命令队列化与单标题串行执行器
2. 聊天与实时推送需要跨实例总线（Redis Adapter / MQ）
3. Mongo 需分片策略（按 `nodeId` / `userId`）与冷热分层
4. 必须做混合压测（攻防+编辑+评论+群聊）并形成容量曲线

结论：

1. 架构方向已正确，迁移与核验闭环已打通
2. 在补齐实时与调度层前，不应承诺“现状即可稳定承载千万级并发在线”

## 7. 本次关键改动文件

1. `backend/routes/nodes.js`
2. `backend/routes/senses.js`
3. `backend/models/Node.js`
4. `backend/models/DomainTitleProjection.js`
5. `backend/models/DomainTitleRelation.js`
6. `backend/models/DomainDefenseLayout.js`
7. `backend/models/DomainSiegeState.js`
8. `backend/services/domainTitleProjectionStore.js`
9. `backend/services/domainTitleStateStore.js`
10. `backend/services/nodeSenseStore.js`
11. `backend/scripts/migrateAllDataAndVerify.js`
12. `backend/scripts/migrateDomainTitleProjection.js`

