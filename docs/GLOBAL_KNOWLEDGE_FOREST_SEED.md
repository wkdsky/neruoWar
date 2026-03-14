# GLOBAL_KNOWLEDGE_FOREST_SEED

## 目标

本数据集为现有知识域系统注入一套“全球通用百科式多根知识森林”数据，只新增数据文件与独立脚本，不修改业务逻辑、接口语义、前端逻辑或核心模型。

## 审计结论

- 标题容器：现有系统中的标题对应 `Node.name`，节点本体存放在 `backend/models/Node.js`。
- 释义节点：现有系统已存在独立释义集合 `NodeSense`，模型在 `backend/models/NodeSense.js`。
- 关系存储：现有系统的关系集合为 `DomainTitleRelation`，虽然命名为 title relation，但实际带有 `sourceSenseId / targetSenseId`，可承载释义级边，模型在 `backend/models/DomainTitleRelation.js`。
- 兼容读路径：
  - 标题主视角可走 `DomainTitleProjection + DomainTitleRelation`。
  - 节点详情页仍直接读取 `Node.associations`。
- 因此最稳妥的注入方案不是只写集合，也不是只写嵌入字段，而是同时维护：
  - `Node`
  - `Node.synonymSenses`
  - `Node.associations`
  - `NodeSense`
  - `DomainTitleRelation`
  - `DomainTitleProjection`

## 数据建模原则

- 标题只是同名词条容器：数据文件中的 `titles.part*.json` 只维护标题标识与标题名。
- 释义才是知识节点：`senses.part*.json` 中每条释义绑定一个标题，并作为真实知识网络节点。
- 所有边都落在释义层：`sense_relations.part*.json` 只使用 `sourceSenseId / targetSenseId / relationType`。
- 根、叶与深度只看 `contains`。
- 默认单主父：主树使用单一 `contains` 父链。

## 关于 `extends`

当前仓库的浏览逻辑不仅依赖 `DomainTitleRelation`，也依赖 `Node.associations` 中的上游可见性。为保证子节点能在现有界面中看到父向关系，本数据集采用两类 `extends`：

- 镜像 `extends`：每条 `A contains B` 同时写入 `B extends A`，用于兼容当前系统的父向浏览。
- 多义与专题扩展：多义标题和专题锚点附着时，也通过 `extends` 保持现有 UI 的可视上游关系。

这意味着本次数据中的 `extends` 数量会明显高于“纯横向专题扩展”场景，但它不参与树深计算，仍符合现有系统语义。

## 根方向

数据集覆盖以下 14 个根方向：

1. 人物
2. 地理与地点
3. 历史与事件
4. 社会、政治、法律与政府
5. 经济与管理
6. 军事与安全
7. 哲学、宗教与思想
8. 语言与文学
9. 艺术与媒体
10. 教育与心理
11. 数学与逻辑
12. 自然与生命科学
13. 工程、技术与计算
14. 医学、健康、农业、生态、环境、生活、体育与休闲

## 数据文件

目录：`backend/seed/global_knowledge_forest`

- `manifest.json`：总清单与汇总统计
- `roots.json`：14 个根方向
- `titles.part01.json` ~ `titles.part14.json`
- `senses.part01.json` ~ `senses.part14.json`
- `sense_relations.part01.json` ~ `sense_relations.part19.json`
- `stats.json`：统计快照
- `sample_chains.json`：样例链
- `polysemy_titles.json`：多义标题样例

## 导入脚本

- 数据生成：`backend/scripts/generateGlobalKnowledgeForestData.js`
- 数据导入：`backend/scripts/importGlobalKnowledgeForest.js`

## 导入方法

先生成数据分片：

```bash
cd backend
node scripts/generateGlobalKnowledgeForestData.js
```

再导入现有系统：

```bash
cd backend
node scripts/importGlobalKnowledgeForest.js
```

## 幂等与批量写入策略

- 标题使用稳定外部键 `gkf:title:<titleId>` 落入 `Node.nodeId`。
- 重复执行时会对同一批生成节点执行 upsert，不会重复创建同一批 seed 节点。
- `NodeSense / DomainTitleRelation / DomainTitleProjection` 对生成节点采用“先清理生成域，再分批重建”的方式，避免重复关系累积。
- 所有集合写入均按批次执行，并输出批次日志。

## 完整链样例

- 数学与逻辑 -> 数学 -> 分析学 -> 微积分 -> 微分学 -> 导数 -> 链式法则
- 自然与生命科学 -> 物理学 -> 经典物理学 -> 力学 -> 经典力学 -> 动力学 -> 牛顿第二定律
- 工程、技术与计算 -> 信息与通信工程 -> 计算机网络 -> 网络传输机制 -> 拥塞控制 -> BBR -> BBRv2
- 医学、健康、农业、生态、环境、生活、体育与休闲 -> 医学与健康 -> 临床医学 -> 内科学 -> 心血管医学 -> 冠状动脉疾病 -> 冠心病 -> 稳定型心绞痛
- 语言与文学 -> 文学 -> 诗歌 -> 抒情诗 -> 十四行诗 -> 彼特拉克体十四行诗 -> 八行组与六行组

## 国家/文明专属类目为何下沉

本数据集首层骨架追求全球通用百科入口，而不是某一国家、民族或文明的教材目录。国家、地区、文明、宗教传统、民族文化等内容可以出现在更低层专题分支中，但不会占据根方向或全局骨架层，以避免结构先验偏向。

## 风险

- 当前库若已存在非生成的同名已审批节点，导入脚本不会强制合并它们，以避免覆盖用户数据；这种脏库场景下，系统中仍可能残留少量旧标题重复。
- 现有系统并未原生提供“纯释义图”专用集合，导入脚本只能在不改业务代码的前提下，同时维护 `Node.associations` 与 `DomainTitleRelation`。
- 本数据集主要以“全球通用百科骨架”作为第一版，人物、地点与事件中更细粒度的具体实体仍可继续扩展。
