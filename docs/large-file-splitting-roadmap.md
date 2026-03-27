# 大单文件拆分路线图

## 1. 目标

这份文档用于指导当前仓库中的“大单文件”拆分工作，目标是：

- 降低单文件认知负担
- 降低改动冲突概率
- 提升测试和回归验证效率
- 让路由、服务、页面容器、样式、算法核心各自收敛到更稳定的边界

本次统计已排除以下非目标内容：

- `node_modules`
- `frontend/build`
- `.git`
- 常见构建输出目录：`dist`、`build`、`coverage`、`.next`、`out`、`target`
- `*.min.*`

## 2. 统计口径

按源码文件统计，包含：

- 逻辑源码：`js`、`jsx`、`ts`、`tsx`、`mjs`、`cjs`、`sh` 等
- 样式源码：`css`、`scss`、`sass`、`less`

统计结果：

- 大文件阈值按 `1000` 行计算时，共 `34` 个
- 其中逻辑源码 `27` 个，样式源码 `7` 个
- 严格阈值按 `1500` 行计算时，共 `23` 个
- 其中逻辑源码 `18` 个，样式源码 `5` 个

建议将优先治理区定义为：

- `P0`: `1500+` 行且明显多职责混杂
- `P1`: `1000+` 行且是核心入口/高频修改文件
- `P2`: 很长但高内聚，先不急拆

## 3. 优先级总览

### P0：第一批必须拆

1. `backend/routes/nodes.js` `10888` 行
2. `frontend/src/components/admin/AdminPanel.js` `8160` 行
3. `frontend/src/App.js` `4751` 行
4. `frontend/src/components/game/BattlefieldPreviewModal.js` `5939` 行
5. `frontend/src/components/game/KnowledgeDomainScene.js` `5312` 行
6. `backend/services/senseArticleService.js` `2677` 行
7. `frontend/src/App.css` `5405` 行
8. `frontend/src/components/senseArticle/SenseArticle.css` `5394` 行
9. `frontend/src/components/admin/Admin.css` `3105` 行

### P1：第二批建议拆

1. `backend/routes/auth.js` `2021` 行
2. `backend/routes/alliance.js` `1828` 行
3. `frontend/src/components/layout/AppShellPanels.js` `1609` 行
4. `frontend/src/components/modals/CreateNodeModal.js` `1589` 行
5. `frontend/src/components/modals/CreateNodeModal.css` `1194` 行
6. `frontend/src/game/battle/screens/BattleSceneContainer.js` `1324` 行
7. `frontend/src/components/game/KnowledgeDomainScene.css` `2095` 行
8. `frontend/src/game/battle/presentation/ui/Battle.css` `1794` 行

### P2：先观察，后续再拆

1. `frontend/src/starMap/starMapForceLayout.js` `4163` 行
2. `frontend/src/WebGLNodeRenderer.js` `3375` 行
3. `frontend/src/starMap/starMapRadialDagLayout.js` `2985` 行
4. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js` `2554` 行

这些文件虽然很长，但当前更像算法核心、渲染内核或运行时内核。它们确实可以拆，但优先级低于多职责 UI/路由/服务文件。

## 4. 拆分原则

### 4.1 后端

- 路由文件只保留路由装配、鉴权、中间件拼接
- 参数解析、校验、业务编排下沉到 controller/service
- 重复的 `getIdString`、通知构造、分页、ObjectId 处理收敛到公共 helper
- 一个路由模块对应一个明确业务域，不要再做“大而全路由桶”

### 4.2 前端逻辑

- 页面容器只负责数据编排、导航、全局态衔接
- 业务分区拆为 hooks、panels、modals、view models、utils
- 复杂编辑器/场景逻辑优先抽出纯函数和状态 hook
- 同一个文件里同时出现“渲染 + 网络请求 + 状态机 + 几类弹窗”时，默认需要拆

### 4.3 样式

- 样式按业务区域拆，不按“视觉类型”拆
- 每个大型组件应有自己的局部样式文件
- 公共 token、布局基元、动画、面板通用样式抽出 shared 层
- 避免继续向 `App.css` 一类总入口样式堆积

## 5. 分阶段路线

## 阶段 A：先拆最危险的聚合入口

目标：

- 先降低最容易引发冲突和回归的大文件
- 先拆“职责混杂最严重”的入口，不先拆算法核心

建议顺序：

1. `backend/routes/nodes.js`
2. `frontend/src/App.js`
3. `frontend/src/components/admin/AdminPanel.js`
4. `backend/services/senseArticleService.js`

完成标准：

- 单文件行数先降到 `1500` 行以下
- 新增子模块命名稳定
- 原有 API/页面行为不变

## 阶段 B：拆场景型巨型组件

建议顺序：

1. `frontend/src/components/game/BattlefieldPreviewModal.js`
2. `frontend/src/components/game/KnowledgeDomainScene.js`
3. `frontend/src/components/modals/CreateNodeModal.js`
4. `frontend/src/game/battle/screens/BattleSceneContainer.js`

完成标准：

- 组件主体只保留容器逻辑和顶层 JSX
- 复杂交互转移到 hooks、services、render helpers

## 阶段 C：拆样式总文件

建议顺序：

1. `frontend/src/App.css`
2. `frontend/src/components/senseArticle/SenseArticle.css`
3. `frontend/src/components/admin/Admin.css`
4. `frontend/src/components/game/KnowledgeDomainScene.css`
5. `frontend/src/game/battle/presentation/ui/Battle.css`

完成标准：

- 样式文件按业务区域归属明确
- 不再依赖一个超大总样式文件兜底

## 阶段 D：再处理高内聚内核文件

建议顺序：

1. `frontend/src/starMap/starMapForceLayout.js`
2. `frontend/src/WebGLNodeRenderer.js`
3. `frontend/src/starMap/starMapRadialDagLayout.js`
4. `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`

完成标准：

- 不破坏性能关键路径
- 拆分后模块边界是数学模型、几何工具、渲染阶段、调度阶段，而不是机械按行数切

## 6. 重点文件拆分建议

## 6.1 `backend/routes/nodes.js`

现状特征：

- 超过 `1` 万行
- 约 `68` 个路由 handler
- 混合了节点 CRUD、义项、公开查询、管理员管理、攻城、布防、知识分发等多个子域

建议目录结构：

```text
backend/routes/nodes/
  index.js
  publicRoutes.js
  adminRoutes.js
  sensesRoutes.js
  relationsRoutes.js
  favoritesRoutes.js
  domainAdminsRoutes.js
  siegeRoutes.js
  defenseLayoutRoutes.js
  battlefieldLayoutRoutes.js
  distributionRoutes.js
  shared.js
```

建议拆法：

- `index.js` 只负责组合子路由
- 公共查询与鉴权查询分开
- 攻城、布防、分发配置必须独立成子路由文件
- 把重复的通知写入、ObjectId 校验、响应序列化移到 `shared.js` 或 service/helper

预期收益：

- 路由冲突显著下降
- 功能定位更快
- 后续迁移到 controller 层更容易

## 6.2 `frontend/src/App.js`

现状特征：

- 应用入口承担了导航、socket、全局状态、弹层调度、知识域切换、文章视图切换
- `useState` / `useEffect` 数量很高

建议目录结构：

```text
frontend/src/app/
  AppRoot.js
  AppProviders.js
  AppSocketBridge.js
  AppNavigationController.js
  AppSceneController.js
  AppDialogController.js
  AppDataBootstrap.js
```

建议拆法：

- `App.js` 改成薄入口，只负责拼装
- socket 生命周期单独抽到 `AppSocketBridge`
- 页面/场景切换逻辑抽到 `AppNavigationController`
- 弹窗和 overlay 状态抽到 `AppDialogController`
- 启动期数据拉取抽到 `AppDataBootstrap`

预期目标：

- `App.js` 控制在 `500-800` 行以内

## 6.3 `frontend/src/components/admin/AdminPanel.js`

现状特征：

- 典型“后台超聚合组件”
- 表单、列表、弹窗、搜索、目录管理混在一个文件
- 状态数量极高

建议目录结构：

```text
frontend/src/components/admin/
  AdminPanel.js
  hooks/
    useAdminUsers.js
    useAdminDomains.js
    useAdminCatalog.js
    useAdminAlliances.js
  panels/
    AdminUsersPanel.js
    AdminDomainsPanel.js
    AdminCatalogPanel.js
    AdminAlliancesPanel.js
  forms/
    UnitTypeForm.js
    BattlefieldItemForm.js
    CityBuildingTypeForm.js
  shared/
    adminMappers.js
    adminValidators.js
```

建议拆法：

- 按后台子域拆 panel
- 按复用表单拆 forms
- 搜索、分页、校验、mapping 下沉到 hooks/shared

预期目标：

- 顶层 `AdminPanel.js` 只保留页签切换和大区块拼装

## 6.4 `backend/services/senseArticleService.js`

现状特征：

- 一个 service 同时承担工作流、修订、通知、媒体、查询、迁移支撑

建议目录结构：

```text
backend/services/senseArticle/
  index.js
  articleQueryService.js
  articleRevisionService.js
  articleWorkflowService.js
  articleMediaOrchestrator.js
  articleNotificationOrchestrator.js
  articleBootstrapService.js
  articleGuards.js
```

建议拆法：

- 保留 `index.js` 作为外观层
- 查询和 mutation 分开
- 工作流决策与副作用通知拆开
- 媒体和修订内容不要继续混写

## 6.5 `frontend/src/components/game/BattlefieldPreviewModal.js`

现状特征：

- 同时包含 `three.js` 渲染、相机控制、碰撞、布局编辑、缓存、交互 UI

建议目录结构：

```text
frontend/src/components/game/battlefieldPreview/
  BattlefieldPreviewModal.js
  hooks/
    useBattlefieldCamera.js
    useBattlefieldSelection.js
    useBattlefieldLayoutCache.js
    useBattlefieldEditing.js
  render/
    previewSceneFactory.js
    previewMeshFactory.js
    previewHitTest.js
  utils/
    battlefieldPreviewMath.js
    battlefieldPreviewConstants.js
```

建议拆法：

- 先抽常量、数学计算、缓存
- 再抽相机和编辑逻辑 hook
- 最后把渲染细节从 React 组件主体里拿出去

## 6.6 `frontend/src/components/game/KnowledgeDomainScene.js`

现状特征：

- 场景渲染、知识域信息、分发规则、用户交互、模态切换强耦合

建议目录结构：

```text
frontend/src/components/game/knowledgeDomain/
  KnowledgeDomainScene.js
  hooks/
    useKnowledgeDomainData.js
    useKnowledgeDistributionRules.js
    useKnowledgeDomainUiState.js
  panels/
    DomainInfoPanel.js
    DistributionRulesPanel.js
    DomainActorsPanel.js
  utils/
    knowledgeDomainMappers.js
    knowledgeDomainFormatters.js
```

建议拆法：

- 先把分发规则编辑逻辑拆出去
- 再把侧边面板和场景主区拆开
- 最后把 API 数据归一化搬到 hooks/utils

## 6.7 `backend/routes/auth.js`

建议拆成：

```text
backend/routes/auth/
  index.js
  sessionRoutes.js
  profileRoutes.js
  notificationRoutes.js
  travelRoutes.js
```

原因：

- 认证、资料、通知、旅行状态不是同一职责

## 6.8 `backend/routes/alliance.js`

建议拆成：

```text
backend/routes/alliance/
  index.js
  publicRoutes.js
  memberRoutes.js
  leaderRoutes.js
  adminRoutes.js
  broadcastRoutes.js
```

原因：

- 公开查询、联盟成员动作、leader 管理、admin 管理、广播流都适合独立

## 6.9 `frontend/src/components/layout/AppShellPanels.js`

现状特征：

- 一个文件内直接导出多个面板组件

建议拆成：

```text
frontend/src/components/layout/
  GameHeader.js
  RelatedDomainsPanel.js
  UnifiedRightDock.js
  DistributionParticipationPanel.js
  AppShellChrome.js
  NotificationsPanel.js
  SenseSelectorPanel.js
  TitleRelationInfoPanel.js
```

原因：

- 这是天然的按组件切分场景，性价比高，风险低

## 6.10 样式文件拆分建议

### `frontend/src/App.css`

建议拆成：

```text
frontend/src/styles/
  app-shell.css
  app-overlays.css
  app-navigation.css
  app-panels.css
  app-utilities.css
```

### `frontend/src/components/senseArticle/SenseArticle.css`

建议拆成：

```text
frontend/src/components/senseArticle/styles/
  page.css
  editor.css
  renderer.css
  compare.css
  dashboard.css
  history.css
```

### `frontend/src/components/admin/Admin.css`

建议拆成：

```text
frontend/src/components/admin/styles/
  layout.css
  users.css
  domains.css
  catalog.css
  forms.css
```

## 7. 推荐执行顺序

推荐按下面顺序推进，避免一次性全仓库重构：

1. `backend/routes/nodes.js`
2. `frontend/src/App.js`
3. `frontend/src/components/admin/AdminPanel.js`
4. `backend/services/senseArticleService.js`
5. `frontend/src/components/layout/AppShellPanels.js`
6. `backend/routes/auth.js`
7. `backend/routes/alliance.js`
8. `frontend/src/components/game/BattlefieldPreviewModal.js`
9. `frontend/src/components/game/KnowledgeDomainScene.js`
10. 样式文件批量拆分
11. 算法/渲染/运行时内核文件

## 8. 每次拆分的控制策略

每个拆分任务都建议遵守以下约束：

- 一次只处理一个大文件
- 第一轮只做“搬家式拆分”，不顺手改业务逻辑
- 先保持导出接口不变，再做内部收敛
- 每轮拆分后都跑对应模块最小验证
- 路由拆分优先保证 API 路径、鉴权、中间件顺序不变
- 前端拆分优先保证 props 契约和视觉行为不变

## 9. 风险提示

高风险拆分点：

- `backend/routes/nodes.js`
  因为它同时覆盖多条核心业务链
- `frontend/src/App.js`
  因为它承担全局状态与导航编排
- `frontend/src/components/game/BattlefieldPreviewModal.js`
  因为交互、渲染、命中检测高度耦合
- `frontend/src/components/game/KnowledgeDomainScene.js`
  因为 UI 状态和业务规则混在一起

中风险拆分点：

- `backend/services/senseArticleService.js`
- `backend/routes/auth.js`
- `backend/routes/alliance.js`
- `frontend/src/components/modals/CreateNodeModal.js`

低风险高收益拆分点：

- `frontend/src/components/layout/AppShellPanels.js`
- 大型样式文件

## 10. 建议的完成标准

可以把拆分完成定义为：

- 路由类文件控制在 `400-800` 行
- 页面容器控制在 `600-1000` 行
- 普通面板组件控制在 `200-500` 行
- 样式文件尽量控制在 `300-800` 行
- 算法/渲染核心允许更高，但需要显式的子模块边界

## 11. 下一步建议

最合理的起手式不是直接“全面拆分”，而是先做一轮低风险高收益组合：

1. 先拆 `frontend/src/components/layout/AppShellPanels.js`
2. 再拆 `backend/routes/auth.js`
3. 然后开始处理 `backend/routes/nodes.js`

这样可以先建立拆分模式、命名规范和目录结构，再进入高风险核心文件。
