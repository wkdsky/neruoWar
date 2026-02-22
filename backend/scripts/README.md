# backend/scripts 归档注释

这些脚本均为**人工执行的运维/迁移工具**，不是 `backend/server.js` 运行时依赖。

## 保留脚本（当前可用）

- `createAdmin.js`：创建或修复管理员账户（`admin`）。
- `initUserDomainPreferences.js`：补齐用户知识域偏好字段（历史数据修复）。
- `initUserLevels.js`：补齐/修正用户等级字段（历史数据修复）。
- `migrateAllDataAndVerify.js`：全量迁移与核验主脚本（推荐入口）。
- `migrateDistributionParticipants.js`：分发参与者迁移脚本。
- `migrateDomainTitleProjection.js`：标题投影迁移脚本。
- `migrateDomainTitleStatesToCollection.js`：标题层状态迁移脚本。
- `migrateNodeSensesToCollection.js`：释义集合迁移脚本。
- `migrateNotificationsToCollection.js`：通知迁移脚本。
- `syncUserIntelSnapshots.js`：用户情报快照结构同步脚本。

## 已归档删除（2026-02-22）

- `resetAllDataAndBootstrapAdmin.js`
  - 作用：清空数据库并重建管理员。
  - 处理：已删除，并从 `backend/package.json` 移除 `reset-all-data-bootstrap-admin` 命令。
- `migrateProfession.js`
  - 作用：早期职业字段一次性迁移。
  - 处理：已删除。
- `removeNameUniqueIndex.js`
  - 作用：早期移除 `Node.name` 唯一索引。
  - 处理：已删除。

## 说明

- 未来如需继续清理，建议优先评估：
  - 是否仍有历史库需要迁移；
  - 是否仍需“运维应急脚本”（例如批量修复、补齐字段）。
