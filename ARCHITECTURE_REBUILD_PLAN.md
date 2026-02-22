# NeruoWar 亿级目标改造报告（覆盖版）

更新时间：2026-02-22

## 1. 目标与结论

目标：在不考虑最小改造成本的前提下，把当前已实现功能（标题/释义编辑、攻防驻防、组织管理、公告通知、知识点分发、用户跨标题移动相关状态）改造成可向“百万熵盟 + 亿级用户 + 千万知识域标题”演进的数据组织与消息处理模型。

结论（本轮已完成）：

1. 通知主链路已切到“集合优先”，高扇出场景不再写 `User.notifications`。
2. 熵盟列表/详情/管理员列表已改为分页与聚合统计，移除全量+N+1读取模式。
3. 围城支援广播改为游标分批写通知集合，不再逐用户 `save()`。
4. 知识点分发（预告/结算）移除全体用户扫描，改为定向候选集合。
5. 标题归属熵盟改为 `Node.allianceId` 单一真值，迁移脚本已纳入自动修正与核验。
6. 关键索引已补齐，覆盖新查询路径。

## 2. 本轮落地改造（代码级）

### 2.1 通知系统（用户亿级的第一爆点）

问题：

1. 依赖 `User.notifications` 嵌入数组会导致用户文档膨胀与热点写冲突。
2. 高扇出（熵盟公告、围城支援、分发结果）会触发大量逐用户保存。

改造：

1. `backend/services/notificationStore.js`
   - `NOTIFICATION_COLLECTION_READ` / `NOTIFICATION_DUAL_WRITE` 改为“默认开启，显式可关闭”。
2. 高扇出路径全部改为集合批写（`Notification`）：
   - `backend/routes/alliance.js`（熵盟公告广播）
   - `backend/routes/nodes.js`（围城支援请求广播）
   - `backend/services/KnowledgeDistributionService.js`（分发预告与结果）
3. `.env` 显式开启集合模式：
   - `NOTIFICATION_COLLECTION_READ=true`
   - `NOTIFICATION_DUAL_WRITE=true`

### 2.2 熵盟接口（百万熵盟第一读热点）

问题：

1. `/alliances/list` 为全量返回并对每个熵盟做二次查询（N+1）。
2. `/alliances/:allianceId` 一次返回全成员与全域列表，无法扩展。

改造：

1. `backend/routes/alliance.js`
   - `/list`：分页（`page/pageSize`）+ 批量统计。
   - `/:allianceId`：成员与知识域双分页（`memberPage/memberPageSize/domainPage/domainPageSize`）。
   - `/admin/all`：分页化。
   - `/my/info`：基于聚合计数，避免拉全成员ID。
2. 统计口径统一：
   - 以 `Node.allianceId` 作为知识域归属唯一真值（不再依赖“`allianceId:null + domainMaster` 推断”）。

### 2.3 知识点分发（亿级用户第二爆点）

问题：

1. 预告通知曾扫描全部普通用户。
2. 结算候选曾按位置/旅行状态进行广泛扫描。

改造：

1. `backend/services/KnowledgeDistributionService.js`
   - 预告收件人改为“定向候选”：固定规则用户 + 手动参与用户 + 当前在目标标题的用户（上限可配）。
   - 结算候选改为固定集合（域主/域相/指定/参与者），移除全域 travel 扫描。
   - 结果通知只写 `Notification` 集合，不再嵌入用户文档。

### 2.4 标题攻防状态并发安全（写覆盖风险）

1. `backend/services/domainTitleStateStore.js`
   - `upsertNodeSiegeState` 增加 `expectedUpdatedAt` 条件写入能力，返回 `conflict` 标志，支持后续乐观锁接入。

### 2.5 索引增强（为新查询路径兜底）

1. `backend/models/User.js`
   - 新增：`{ allianceId, createdAt }`
   - 新增：`{ role, location, _id }`
   - 新增：`{ role, travelState.targetNodeId, travelState.status }`
   - 新增：`{ role, travelState.stoppingNearestNodeId, travelState.status }`
2. `backend/models/Node.js`
   - 新增：`{ allianceId, status, createdAt, _id }`
   - 新增：`{ status, name, _id }`
3. `backend/models/EntropyAlliance.js`
   - 新增：`{ createdAt, _id }`
4. `backend/models/Notification.js`
   - 新增：`{ userId, type, status, allianceId, inviteeId, createdAt }`

## 3. 数据迁移与核验（已纳入全量脚本）

`backend/scripts/migrateAllDataAndVerify.js` 已扩展：

1. 新增迁移步骤：`Node.allianceId` 与 `domainMaster -> User.allianceId` 对齐（全量修正）。
2. 新增核验维度：标题熵盟归属一致性（全量统计 + 抽样明细）。

推荐执行：

```bash
npm --prefix backend run rebuild-all-migrated-data
npm --prefix backend run verify-migrated-data
```

若你要直接清空旧嵌入字段并只保留新结构：

```bash
npm --prefix backend run migrate-and-clean-all-legacy
npm --prefix backend run verify-migrated-data
```

## 4. 目前“百万熵盟 + 亿级用户”可行性评估（基于已落地改造）

### 4.1 能显著改善的部分

1. 熵盟列表/详情读取不再随总量线性爆炸。
2. 公告/支援/分发通知不再写用户大文档热点。
3. 分发执行不再做全体用户扫描。
4. 标题归属统计口径统一，迁移可验证。

### 4.2 仍需要的基础设施前提（否则无法真正落地亿级）

1. Mongo 分片与路由策略（按 `userId/nodeId/allianceId`）必须上线。
2. 通知投递与战斗事件建议接入异步队列（Kafka/RabbitMQ/Redis Stream）。
3. API 层需要多实例水平扩展和限流熔断。
4. 热点标题/熵盟需引入读缓存与热点隔离。

## 5. 关键文件清单（本轮）

1. `backend/services/notificationStore.js`
2. `backend/routes/alliance.js`
3. `backend/routes/nodes.js`
4. `backend/services/KnowledgeDistributionService.js`
5. `backend/services/domainTitleStateStore.js`
6. `backend/models/User.js`
7. `backend/models/Node.js`
8. `backend/models/EntropyAlliance.js`
9. `backend/models/Notification.js`
10. `backend/scripts/migrateAllDataAndVerify.js`
11. `backend/.env`

