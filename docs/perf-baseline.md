# 性能基线模板

采集日期：
采集环境：
采集人：
数据规模（用户/标题/释义）：

## 1. API 指标

| API | QPS | P50(ms) | P95(ms) | P99(ms) | 错误率 |
| --- | --- | --- | --- | --- | --- |
| GET /api/notifications |  |  |  |  |  |
| GET /api/nodes/search |  |  |  |  |  |
| GET /api/nodes/public/search |  |  |  |  |  |
| POST /api/nodes/:id/siege/support |  |  |  |  |  |
| POST /api/nodes/:id/distribution-participation/join |  |  |  |  |  |

## 2. 数据库指标

### 2.1 慢查询 Top 20

| 排名 | 集合 | 查询摘要 | 平均耗时(ms) | 次数 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |

### 2.2 资源占用

- Mongo 主库 CPU：
- Mongo 主库内存：
- 连接数峰值：
- 锁等待情况：

## 3. 应用指标

- Node 进程 CPU：
- Node 进程内存：
- GC 停顿：
- Socket 连接数峰值：

## 4. 关键问题归因

1.
2.
3.

## 5. 本次改造后复测对比

| 指标 | 改造前 | 改造后 | 变化 |
| --- | --- | --- | --- |
| GET /api/notifications P95 |  |  |  |
| GET /api/nodes/public/search P95 |  |  |  |
| 慢查询总量 |  |  |  |

