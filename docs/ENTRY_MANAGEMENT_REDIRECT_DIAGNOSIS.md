# Entry Management Redirect Diagnosis

## 1. 问题复述

当前前端并不是基于 URL 的 React Router 路由，而是由 `frontend/src/App.js` 内部的 `view` 状态做页面分发；`frontend/package.json:5-15` 也未引入 `react-router` 相关依赖。

本次问题现象为：

- 影响角色：`域主`、`域相`、`系统管理员`
- 用户先进入“释义词条/释义百科页”相关界面
- 点击页面里的“词条管理”按钮后
- 预期：进入真正的“词条管理界面”，即 `senseArticleDashboard` 对应的 `SenseArticleDashboardPage`
- 实际：页面回到首页（`home`）

基于当前仓库代码，**最高概率的真实故障链路**不是“按钮权限不足”或“后端 403 后被送回首页”，而是：

- 按钮点击后确实调用了切换视图逻辑，目标视图是 `senseArticleDashboard`
- `App.js` 的页面渲染分支已经支持 `senseArticleDashboard`
- 但 `App.js` 内另一处“已知视图校验”遗漏了 `senseArticleDashboard`
- 导致 `view` 一旦切到 `senseArticleDashboard`，就被当作未知视图，立即 `setView('home')`

这与用户描述的“点击词条管理后跳首页，而不是进入管理界面”高度一致。

---

## 2. 与该问题直接相关的文件清单

### 2.1 按钮组件 / 上游入口

#### `frontend/src/components/senseArticle/SenseArticlePage.js`
- 组件：`SenseArticlePage`
- 作用：释义百科阅读页；最像用户口中的“释义词条”页面
- 谁调用它：`frontend/src/App.js:6539-6555`
- 它调用谁：点击“词条管理”时调用从 `App.js` 传入的 `onOpenDashboard`
- 关键数据：
  - `props.nodeId`
  - `props.senseId`
  - `pageData.permissions`
  - 按钮显示条件：`permissions.canReviewDomainAdmin || permissions.canReviewDomainMaster || permissions.isSystemAdmin`
- 关键证据：`frontend/src/components/senseArticle/SenseArticlePage.js:476-529`

#### `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- 组件：`SenseArticleHistoryPage`
- 作用：历史版本页，也带“词条管理”按钮
- 谁调用它：`frontend/src/App.js:6601-6618`
- 它调用谁：点击“词条管理”时调用 `onOpenDashboard`
- 关键数据：
  - `nodeId`
  - `senseId`
  - `data.permissions`
- 关键证据：`frontend/src/components/senseArticle/SenseArticleHistoryPage.js:17-35`, `frontend/src/components/senseArticle/SenseArticleHistoryPage.js:54-60`, `frontend/src/components/senseArticle/SenseArticleHistoryPage.js:109-118`

#### `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- 组件：`SenseArticleReviewPage`
- 作用：审阅页，也带“词条管理”按钮
- 谁调用它：`frontend/src/App.js:6579-6597`
- 它调用谁：点击“词条管理”时调用 `onOpenDashboard`
- 关键数据：
  - `nodeId`
  - `senseId`
  - `revisionId`
  - `detail.permissions`
- 关键证据：`frontend/src/components/senseArticle/SenseArticleReviewPage.js:48-73`, `frontend/src/components/senseArticle/SenseArticleReviewPage.js:106-114`, `frontend/src/components/senseArticle/SenseArticleReviewPage.js:185-193`

#### `frontend/src/components/senseArticle/SenseArticleEditor.js`
- 组件：`SenseArticleEditor`
- 作用：编辑页，也带“词条管理”按钮
- 谁调用它：`frontend/src/App.js:6558-6574`
- 它调用谁：点击“词条管理”时调用 `onOpenDashboard`
- 关键数据：
  - `nodeId`
  - `senseId`
  - `revisionId`
  - `detail.permissions`
- 关键证据：`frontend/src/components/senseArticle/SenseArticleEditor.js:75-90`, `frontend/src/components/senseArticle/SenseArticleEditor.js:184-188`, `frontend/src/components/senseArticle/SenseArticleEditor.js:523-529`

#### `frontend/src/App.js`
- 模块：主应用 view-switch / sense article 导航中枢
- 作用：
  - 负责“进入释义百科页”
  - 负责“词条管理”点击后的二级视图切换
  - 负责所有 `view` 的合法性校验和回首页逻辑
- 谁调用它：应用根组件
- 它调用谁：`SenseArticlePage` / `SenseArticleHistoryPage` / `SenseArticleReviewPage` / `SenseArticleEditor` / `SenseArticleDashboardPage`
- 关键状态：
  - `view`
  - `senseArticleContext`
  - `currentNodeDetail`
  - `currentTitleDetail`
  - `isAdmin`
- 关键证据：
  - 导航子视图：`frontend/src/App.js:627-629`
  - 打开词条管理：`frontend/src/App.js:5700-5707`
  - 已知视图校验：`frontend/src/App.js:2284-2287`
  - 目标页面渲染：`frontend/src/App.js:6621-6658`

#### `frontend/src/components/modals/NodeInfoModal.js`
- 组件：`NodeInfoModal`
- 作用：节点详情弹窗 / “释义词条详情”弹窗；这里只提供“进入释义百科页”，**不直接提供“词条管理”**
- 谁调用它：`frontend/src/App.js:7152-7163`
- 它调用谁：`onOpenSenseArticle(nodeDetail)`
- 关键 props：`nodeDetail`, `onOpenSenseArticle`, `simpleOnly`
- 关键证据：`frontend/src/components/modals/NodeInfoModal.js:99-153`, `frontend/src/components/modals/NodeInfoModal.js:302-314`

#### `frontend/src/SceneManager.js`
- 模块：WebGL 场景中心节点按钮配置
- 作用：节点详情中的 `i` 按钮入口，触发 `showSenseEntry`
- 谁调用它：`frontend/src/App.js`
- 它调用谁：通过 `button.action = 'showSenseEntry'` 回调给 `App.js`
- 关键证据：`frontend/src/SceneManager.js:168-180`, `frontend/src/SceneManager.js:267-276`

### 2.2 路由入口 / 页面分发逻辑

#### `frontend/package.json`
- 作用：依赖清单
- 结论：未引入 `react-router`；本项目不是标准 React Router 路由实现
- 关键证据：`frontend/package.json:5-15`

#### `frontend/src/App.js`
- 作用：实际的页面入口分发器，基于 `view` 状态决定渲染哪个页面
- 关键证据：
  - `senseArticle` 页：`frontend/src/App.js:6539-6555`
  - `senseArticleEditor` 页：`frontend/src/App.js:6558-6574`
  - `senseArticleReview` 页：`frontend/src/App.js:6579-6597`
  - `senseArticleHistory` 页：`frontend/src/App.js:6601-6618`
  - `senseArticleDashboard` 页：`frontend/src/App.js:6621-6658`

#### `frontend/src/components/senseArticle/senseArticleNavigation.js`
- 作用：构造 `senseArticleContext`，维护 sense article 子页面之间的返回目标和上下文
- 谁调用它：`frontend/src/App.js`
- 它调用谁：纯函数，无外部跳转；只负责组装状态
- 关键数据：`nodeId`, `senseId`, `articleId`, `revisionId`, `returnTarget`, `originView`
- 关键证据：`frontend/src/components/senseArticle/senseArticleNavigation.js:17-36`, `frontend/src/components/senseArticle/senseArticleNavigation.js:44-80`

### 2.3 权限逻辑

#### `backend/services/senseArticlePermissionService.js`
- 作用：统一派生 sense article 权限位
- 谁调用它：`backend/services/senseArticleService.js`
- 它调用谁：`backend/utils/domainAdminPermissions.js`
- 关键字段：
  - `isSystemAdmin`
  - `isDomainMaster`
  - `isDomainAdmin`
  - `canReviewSenseArticle`
  - `canReviewDomainAdmin`
  - `canReviewDomainMaster`
- 关键证据：`backend/services/senseArticlePermissionService.js:5-27`

#### `backend/utils/domainAdminPermissions.js`
- 作用：域相细粒度权限定义与默认值
- 谁调用它：`senseArticlePermissionService.js`, `senseArticleService.js`
- 关键点：`senseArticleReview` 是域相参与百科审核/词条管理的核心权限键
- 风险点：若某域相没有显式权限项，会默认拥有 `senseArticleReview`
- 关键证据：`backend/utils/domainAdminPermissions.js:3-18`, `backend/utils/domainAdminPermissions.js:54-66`

#### `backend/services/senseArticleSerializer.js`
- 作用：把后端权限对象序列化为前端 `permissions`
- 谁调用它：`backend/services/senseArticleService.js`
- 它输出给谁：前端各 sense article 页面
- 关键证据：`backend/services/senseArticleSerializer.js:99-109`

#### `backend/routes/nodes.js`
- 作用：提供 domain-scoped 角色上下文（域主/域相相关知识域）
- 谁调用它：`frontend/src/App.js` 的 `fetchRelatedDomains`
- 它输出给谁：前端右侧相关知识域面板等辅助 UI
- 关键证据：`backend/routes/nodes.js:6209-6226`

#### `backend/routes/auth.js`
- 作用：提供当前用户全局角色 `role`
- 谁调用它：前端登录和资料相关流程
- 关键证据：`backend/routes/auth.js:1240-1258`

#### `backend/routes/admin.js` + `backend/middleware/admin.js`
- 作用：前端 `checkAdminStatus()` 通过访问 `/admin/users` 旁路判断是否系统管理员
- 谁调用它：`frontend/src/App.js:2538-2556`
- 风险点：前端 `isAdmin` 不是直接读取 `/profile.role`，而是通过 admin 接口探测
- 关键证据：`backend/routes/admin.js:570-578`, `backend/middleware/admin.js:3-16`

### 2.4 目标页面

#### `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
- 组件：`SenseArticleDashboardPage`
- 作用：真正的“词条管理界面”
- 谁调用它：`frontend/src/App.js:6621-6658`
- 它调用谁：`senseArticleApi.getDashboard(nodeId)`
- 关键数据：`nodeId`，不是 URL path，也不是 `entryId`
- 错误处理：403/普通错误都渲染状态页并提供“返回”按钮，**没有主动跳首页**
- 关键证据：`frontend/src/components/senseArticle/SenseArticleDashboardPage.js:29-67`

### 2.5 API 层

#### `frontend/src/utils/senseArticleApi.js`
- 作用：前端 sense article 请求封装
- 关键点：
  - `requestJson()` 仅抛错，不做首页跳转
  - dashboard API 为 `getDashboard(nodeId)` -> `/sense-articles/dashboard?nodeId=...`
- 关键证据：`frontend/src/utils/senseArticleApi.js:64-95`, `frontend/src/utils/senseArticleApi.js:164-164`

#### `backend/routes/senseArticles.js`
- 作用：sense article 路由总入口
- 关键点：dashboard 路由是 `GET /sense-articles/dashboard`
- 关键证据：`backend/routes/senseArticles.js:48-56`

#### `backend/services/senseArticleService.js`
- 作用：sense article 业务核心
- 关键点：
  - `getArticleBundle()` 以 `nodeId + senseId` 组装文章上下文
  - `listRevisions()` 用于历史页
  - `getGovernanceDashboard()` 用于词条管理页
  - dashboard 访问权限由 `buildManagedNodeFilter()` / `getGovernanceDashboard()` 控制
- 关键证据：`backend/services/senseArticleService.js:516-522`, `backend/services/senseArticleService.js:605-621`, `backend/services/senseArticleService.js:707-738`, `backend/services/senseArticleService.js:1504-1540`, `backend/services/senseArticleService.js:1592-1602`

### 2.6 后端辅助链路

#### `backend/routes/senses.js`
- 作用：旧释义管理兼容入口
- 风险点：旧释义可编辑权限与新百科/词条管理权限并不完全同一套
- 关键证据：`backend/routes/senses.js:67-83`

---

## 3. 点击到目标页的完整调用链

### 3.1 当前最可能的实际故障链路（高概率）

```text
节点详情/释义入口
  -> openSenseArticleFromNode(node)
  -> getNodeSenseArticleTarget(node, senseId?)
  -> openSenseArticleView(target)
  -> setSenseArticleContext(...)
  -> setView('senseArticle')
  -> App.js 渲染 SenseArticlePage
  -> 页面根据 permissions 显示“词条管理”按钮
  -> 点击后调用 onOpenDashboard
  -> App.handleOpenSenseArticleDashboard()
  -> navigateSenseArticleSubView('senseArticleDashboard', { nodeId, senseId })
  -> setSenseArticleContext(...)
  -> setView('senseArticleDashboard')
  -> App.js useEffect 校验 isKnownView
  -> 因 allowlist 缺少 'senseArticleDashboard'
  -> setView('home')
  -> 回到首页
```

### 3.2 证据化拆解

#### 链路起点：节点详情里的“释义词条”入口

1. WebGL 中心节点 `i` 按钮定义为 `showSenseEntry`
   - `frontend/src/SceneManager.js:172-180`
   - `frontend/src/SceneManager.js:270-276`

2. `App.js` 收到 `showSenseEntry` 后打开 `NodeInfoModal`
   - `frontend/src/App.js:862-881`
   - `frontend/src/App.js:912-928`

3. `NodeInfoModal` 的按钮只负责进入释义百科页，不是直接进词条管理
   - `frontend/src/components/modals/NodeInfoModal.js:145-152`
   - `frontend/src/components/modals/NodeInfoModal.js:309-314`

4. `NodeInfoModal` 的 `onOpenSenseArticle` 实际绑定到 `openSenseArticleFromNode`
   - `frontend/src/App.js:7158-7163`

#### 进入释义百科页

5. `openSenseArticleFromNode()` 先从节点对象提取参数
   - `frontend/src/App.js:167-185`
   - 参数来源：`node._id || node.nodeId` + `requestedSenseId || activeSenseId || synonymSenses[0].senseId`

6. `openSenseArticleView()` 构造 `senseArticleContext` 并设置 `view='senseArticle'`
   - `frontend/src/App.js:5568-5580`
   - `frontend/src/components/senseArticle/senseArticleNavigation.js:44-72`

7. `App.js` 根据 `view === 'senseArticle'` 渲染阅读页
   - `frontend/src/App.js:6539-6555`

#### “词条管理”按钮点击链路

8. 阅读页/历史页/审阅页/编辑页都可能显示“词条管理”按钮
   - 阅读页：`frontend/src/components/senseArticle/SenseArticlePage.js:525-527`
   - 历史页：`frontend/src/components/senseArticle/SenseArticleHistoryPage.js:114-116`
   - 审阅页：`frontend/src/components/senseArticle/SenseArticleReviewPage.js:188-190`
   - 编辑页：`frontend/src/components/senseArticle/SenseArticleEditor.js:524-526`

9. 这些按钮全部由 `App.js` 统一传入 `onOpenDashboard={handleOpenSenseArticleDashboard}`
   - 阅读页绑定：`frontend/src/App.js:6545-6555`
   - 编辑页绑定：`frontend/src/App.js:6564-6573`
   - 审阅页绑定：`frontend/src/App.js:6585-6592`
   - 历史页绑定：`frontend/src/App.js:6607-6613`

10. 统一点击处理函数：
    - `frontend/src/App.js:5700-5707`
    - 实际行为不是 `navigate(...)` / `Link` / `window.location` / `history.push`
    - 实际行为是：`navigateSenseArticleSubView('senseArticleDashboard', { nodeId, senseId })`

11. `navigateSenseArticleSubView()` 再次说明本项目是状态路由，不是 URL 路由
    - `frontend/src/App.js:627-629`
    - 它只做两件事：
      - 更新 `senseArticleContext`
      - `setView(nextView)`

#### 目标页面应当如何进入

12. `App.js` 的渲染分支其实已经支持 `senseArticleDashboard`
    - `frontend/src/App.js:6621-6658`
    - 目标组件：`SenseArticleDashboardPage`

13. Dashboard 页面初始化只依赖 `nodeId`
    - `frontend/src/components/senseArticle/SenseArticleDashboardPage.js:29-39`
    - API：`senseArticleApi.getDashboard(nodeId)`
    - 路由：`GET /sense-articles/dashboard?nodeId=...`

#### 真正把用户送回首页的地方

14. `App.js` 有一处“已知视图校验”遗漏了 `senseArticleDashboard`
    - `frontend/src/App.js:2284-2287`
    - 允许的视图包括：`senseArticle`, `senseArticleEditor`, `senseArticleReview`, `senseArticleHistory`
    - **但没有 `senseArticleDashboard`**

15. 因此一旦点击词条管理，`view` 被设置为 `senseArticleDashboard`，下一轮 effect 就执行：
    - `if (!isKnownView) setView('home')`
    - 直接回首页

### 3.3 其他可进入释义百科页的入口

#### 入口 A：节点详情页 banner
- `frontend/src/App.js:6528-6534`
- 按钮文案：`进入释义百科页`
- 调用：`openSenseArticleFromNode(currentNodeDetail)`

#### 入口 B：释义选择浮层
- `frontend/src/App.js:5747-5879`
- 每个 sense 行右侧按钮调用：`openSenseArticleFromNode(overviewNode, { senseId: sense?.senseId })`

#### 入口 C：通知跳转
- `frontend/src/App.js:5738-5744`
- 调用：`openSenseArticleView(navigation.target, navigation.options)`

> 结论：无论从哪个入口进入，只要最终点击的是 sense article 页面上的“词条管理”，都会汇入同一个 `handleOpenSenseArticleDashboard()`，因此问题根因是共用的，而不是单一入口特有。

---

## 4. 词条管理按钮的显示条件与点击行为

### 4.1 哪些页面有“词条管理”按钮

- `SenseArticlePage`（阅读页）
- `SenseArticleHistoryPage`（历史页）
- `SenseArticleReviewPage`（审阅页）
- `SenseArticleEditor`（编辑页）

### 4.2 谁能看到按钮

#### 阅读页
- 文件：`frontend/src/components/senseArticle/SenseArticlePage.js:525-527`
- 条件：
  - `permissions.canReviewDomainAdmin`
  - 或 `permissions.canReviewDomainMaster`
  - 或 `permissions.isSystemAdmin`

#### 历史页
- 文件：`frontend/src/components/senseArticle/SenseArticleHistoryPage.js:59-60`, `frontend/src/components/senseArticle/SenseArticleHistoryPage.js:114-116`
- 条件：`canOpenDashboard`
- 计算来源：`data.permissions`

#### 审阅页
- 文件：`frontend/src/components/senseArticle/SenseArticleReviewPage.js:112-113`, `frontend/src/components/senseArticle/SenseArticleReviewPage.js:188-190`
- 条件：`canOpenDashboard`
- 计算来源：`detail.permissions`

#### 编辑页
- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js:187-188`, `frontend/src/components/senseArticle/SenseArticleEditor.js:524-526`
- 条件：`canOpenDashboard`
- 计算来源：`detail.permissions`

### 4.3 点击后实际执行了什么

不是：
- 不是 `navigate('/xxx')`
- 不是 `Link to="..."`
- 不是 `history.push(...)`
- 不是 `window.location.href = ...`

而是：
- `handleOpenSenseArticleDashboard()`
- `navigateSenseArticleSubView('senseArticleDashboard', { nodeId, senseId })`
- `setView('senseArticleDashboard')`

关键证据：
- `frontend/src/App.js:5700-5707`
- `frontend/src/App.js:627-629`

### 4.4 目标路径或目标视图是什么

- 目标不是 URL path
- 目标是 App 内部视图：`senseArticleDashboard`
- 对应组件：`frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
- 对应渲染分支：`frontend/src/App.js:6621-6658`

### 4.5 点击行为依赖哪些参数

#### 按钮点击时使用的参数
- `senseArticleContext.nodeId`
- `senseArticleContext.senseId`

#### 这些参数从哪里来
- 阅读页加载成功后由 `onContextPatch()` 写回 context：`frontend/src/components/senseArticle/SenseArticlePage.js:147-160`
- 历史页/审阅页/编辑页也会在数据加载成功后 patch context

#### Dashboard 实际初始化依赖
- 前端页面挂载条件：`senseArticleContext?.nodeId`
- Dashboard API 请求参数：`nodeId`
- 后端 dashboard service 输入：`{ userId, nodeId }`

#### 结论
- `senseId` 会被一并带上，但 dashboard 页面本身并不强依赖 `senseId`
- 当前“点了就回首页”的现象，不像是参数缺失引起的初始化失败，更像是 `view` 层被拦截

---

## 5. 首页重定向/回退逻辑清单

以下按与本问题的相关性排序。

### 5.1 高相关

#### 1) 未知视图统一回首页
- 文件：`frontend/src/App.js:2284-2287`
- 触发条件：`view` 不在 `isKnownView` 白名单中
- 与本问题关系：**直接相关，且与症状完全吻合**
- 关键说明：
  - 白名单里有 `senseArticle` / `senseArticleEditor` / `senseArticleReview` / `senseArticleHistory`
  - **唯独没有 `senseArticleDashboard`**
  - 而“词条管理”按钮点击后的目标恰好就是 `senseArticleDashboard`

#### 2) sense article 返回链路兜底回首页
- 文件：`frontend/src/App.js:5605-5632`
- 触发条件：`handleSenseArticleBack()` 无法解析有效 `returnTarget/originTarget`
- 与本问题关系：中等；只会在点击“返回”或异常回退时触发，不是正常点击“词条管理”后的第一跳

#### 3) 显式导航工具 `navigateToHomeWithDockCollapse()`
- 文件：`frontend/src/App.js:2658-2666`
- 触发条件：被其它逻辑显式调用
- 与本问题关系：中等偏低；它是“回首页工具函数”，但当前词条管理点击链并未直接调用它

### 5.2 中低相关

#### 4) 页面恢复时无法识别目标页 -> 回首页
- 文件：`frontend/src/App.js:2198-2236`
- 触发条件：本地持久化页状态恢复失败或目标视图不受支持
- 与本问题关系：低；更像刷新页面后的恢复逻辑，不像实时点击后的 immediate redirect

#### 5) admin/army/trainingGround 视图守卫失败 -> 回首页
- 文件：`frontend/src/App.js:2290-2296`
- 触发条件：不满足 admin / 非 admin 视图约束
- 与本问题关系：低；与 `senseArticleDashboard` 无直接对应

#### 6) nodeDetail/titleDetail 缺失详情数据 -> 回首页
- 文件：`frontend/src/App.js:2300-2304`
- 触发条件：详情页缺少 `currentNodeDetail` 或 `currentTitleDetail`
- 与本问题关系：低；词条管理页不依赖这两个状态作为渲染条件

### 5.3 低相关 / 明确无关的“回首页”点

#### 7) 登录态恢复后正常进入首页
- 文件：`frontend/src/App.js:523-528`
- 触发条件：已有 token 和 location
- 与本问题关系：无直接关系

#### 8) 登录成功或管理员 location 初始化后进入首页
- 文件：`frontend/src/App.js:1015-1025`
- 触发条件：登录完成后 location 检查
- 与本问题关系：无直接关系

#### 9) 首次选址完成后进入首页
- 文件：`frontend/src/App.js:1078-1080`
- 触发条件：位置选择弹窗完成
- 与本问题关系：无直接关系

#### 10) 视图异常时显示“已为你回退到首页”的提示 UI
- 文件：`frontend/src/App.js:6697-6720`
- 触发条件：当前 `view` 不匹配任何可渲染分支
- 与本问题关系：辅助相关；这是兜底 UI，不是主因，但说明 App 确实把未知视图当异常状态处理

### 5.4 全仓库搜索结果：未发现 URL 级首页跳转

对以下关键词全仓搜索后，**未发现命中**：

- `navigate('/')`
- `router.push('/')`
- `history.push('/')`
- `redirect('/')`
- `window.location.href = '/'`

结论：本问题不是浏览器 URL 重定向导致，而是 **App 内部 `view` 状态回退到 `home`**。

---

## 6. 最可能导致该问题的 Top 10 可疑点

### 1) `senseArticleDashboard` 未加入 `isKnownView` 白名单
- 可疑等级：高
- 文件路径：`frontend/src/App.js`
- 相关函数/组件：未知视图校验 `useEffect`
- 触发条件：`view` 变成 `senseArticleDashboard`
- 为什么会导致“点击词条管理后跳首页”：
  - 点击按钮后 `handleOpenSenseArticleDashboard()` 会 `setView('senseArticleDashboard')`
  - 下一轮 effect 发现它不在白名单中，立即执行 `setView('home')`
- 如何验证：
  - 在 `frontend/src/App.js:2284-2287` 附近打印 `view`
  - 预期可看到：`senseArticle` -> `senseArticleDashboard` -> `home`
  - 同时 Network 面板通常看不到 `/sense-articles/dashboard?nodeId=...` 请求发出

### 2) “跳转目标字符串”与“允许视图列表”分裂维护
- 可疑等级：高
- 文件路径：`frontend/src/App.js`
- 相关函数/组件：`handleOpenSenseArticleDashboard()`、`navigateSenseArticleSubView()`、`isKnownView` 校验
- 触发条件：新增子页面但未同步到白名单
- 为什么会导致该问题：
  - `handleOpenSenseArticleDashboard()` 明确把目标设成 `senseArticleDashboard`
  - 但 `isKnownView` 手写数组没有同步更新
- 如何验证：
  - 搜索 `senseArticleDashboard` 的全部使用点
  - 对照 `frontend/src/App.js:2284` 的白名单，确认遗漏

### 3) 渲染分支支持 dashboard，但守卫分支不支持 dashboard
- 可疑等级：高
- 文件路径：`frontend/src/App.js`
- 相关函数/组件：render view-switch 与 view guard
- 触发条件：点击“词条管理”
- 为什么会导致该问题：
  - `frontend/src/App.js:6621-6658` 明明已经写了 dashboard 页面渲染逻辑
  - 但 `frontend/src/App.js:2284-2287` 先把它视为非法视图
  - 这是同一文件内的“路由配置不一致”
- 如何验证：
  - 在 React DevTools 中观察 `view` 状态切换
  - 若短暂出现 `senseArticleDashboard`，说明 render 分支本可命中，但先被 effect 改写回 `home`

### 4) 本项目是手工 view-switch 路由，缺少统一枚举/中心配置
- 可疑等级：中
- 文件路径：`frontend/src/App.js`, `frontend/src/components/senseArticle/senseArticleUi.js`
- 相关函数/组件：多处字符串字面量 `senseArticle*`
- 触发条件：新增子页、改名、补功能时
- 为什么会导致该问题：
  - 当前项目没有 React Router 的中心路由表
  - 页面名靠多个地方手写字符串同步
  - 极易出现“这里支持、那里没登记”的情况
- 如何验证：
  - 全局搜索 `senseArticleDashboard`
  - 对比所有 `view` 判定分支是否全量覆盖

### 5) 按钮显示条件与 dashboard 后端准入条件虽然相近，但不是完全同名
- 可疑等级：中
- 文件路径：`frontend/src/components/senseArticle/*.js`, `backend/services/senseArticlePermissionService.js`, `backend/services/senseArticleService.js`
- 相关函数/组件：按钮可见条件 / `buildManagedNodeFilter()`
- 触发条件：角色逻辑未来漂移或 DTO 字段变化
- 为什么会导致该问题：
  - 前端按钮判断：`canReviewDomainAdmin || canReviewDomainMaster || isSystemAdmin`
  - 后端 dashboard 判断：`isSystemAdmin || isDomainMaster || canReviewSenseArticle`
  - 当前实现基本等价，但字段命名不完全一致，后续容易漂移
- 如何验证：
  - 在按钮页面打印 `permissions`
  - 在 dashboard API 返回 403 时比对服务端 `roleInfo`

### 6) 域相的 `senseArticleReview` 默认值是“无显式配置也默认拥有”
- 可疑等级：中
- 文件路径：`backend/utils/domainAdminPermissions.js`
- 相关函数/组件：`buildDomainAdminPermissionState()`
- 触发条件：节点存在域相，但未配置显式权限 map
- 为什么会导致该问题：
  - `hasExplicitEntry === false` 时默认授予 `senseArticleReview`
  - 这可能与运营/产品对“域相是否应默认可管词条”的理解不一致
  - 但它更像“按钮是否该显示”的潜在争议，不像本次“跳首页”的直接原因
- 如何验证：
  - 查看问题节点的 `domainAdminPermissions`
  - 比对该域相是否没有显式配置项却仍收到 `canReviewSenseArticle=true`

### 7) 旧释义管理兼容接口与新词条管理权限链并非同一套
- 可疑等级：中
- 文件路径：`backend/routes/senses.js`
- 相关函数/组件：`canManageNodeSenses()`
- 触发条件：工程师把旧“释义可编辑”与新“词条管理可进入”混为一谈时
- 为什么会导致该问题：
  - 旧接口允许“域主/任意域相/系统管理员”管理旧释义
  - 新 dashboard 更依赖 `senseArticleReview` 细粒度权限
  - 两套权限若被混用，容易误判“前端应该能进”
- 如何验证：
  - 对比同一用户在旧 `/senses` 入口和新 `/sense-articles/dashboard` 入口的实际权限

### 8) 系统管理员前端 `isAdmin` 来源是 admin 接口探测，而不是直接读取 `/profile.role`
- 可疑等级：低-中
- 文件路径：`frontend/src/App.js`, `backend/routes/admin.js`, `backend/middleware/admin.js`, `backend/routes/auth.js`
- 相关函数/组件：`checkAdminStatus()`
- 触发条件：`/admin/users` 请求异常、超时或鉴权异常
- 为什么会导致该问题：
  - 可能导致前端 `isAdmin` 与后端真实 `role=admin` 短暂不一致
  - 但 sense article 页面按钮可见性主要仍看后端 `permissions.isSystemAdmin`
  - 因此它不是本次“跳首页”的主因
- 如何验证：
  - 同时打印 `/auth/profile.role` 与 `checkAdminStatus()` 的结果

### 9) 释义入口参数依赖 `activeSenseId` / `synonymSenses[0]`
- 可疑等级：低
- 文件路径：`frontend/src/App.js`
- 相关函数/组件：`getNodeSenseArticleTarget()`
- 触发条件：节点对象缺少 `_id`、`activeSenseId` 和 `synonymSenses`
- 为什么会导致该问题：
  - 若参数缺失，会直接 `alert('当前节点没有可打开的释义百科页')`
  - 不会跳首页，但会阻断后续链路
- 如何验证：
  - 在问题节点点击前打印 `node._id`, `node.activeSenseId`, `node.synonymSenses`

### 10) dashboard 是 node-scoped，按钮却位于 sense-scoped 页面中
- 可疑等级：低
- 文件路径：`frontend/src/App.js`, `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`, `frontend/src/utils/senseArticleApi.js`
- 相关函数/组件：`handleOpenSenseArticleDashboard()`, `getDashboard(nodeId)`
- 触发条件：后续功能扩展时对作用域理解错误
- 为什么会导致该问题：
  - 页面上下文里有 `senseId`，但 dashboard API 只看 `nodeId`
  - 若工程师误以为是“单个 sense 管理页”，容易怀疑参数错误
  - 但当前代码中这不是回首页的根因
- 如何验证：
  - 观察 dashboard 请求 URL，只会出现 `nodeId` 参数

---

## 7. 角色权限一致性检查

### 7.1 角色定义在哪些文件

#### 全局角色
- 文件：`backend/routes/auth.js:1253-1256`
- 字段：`user.role`
- 实际值：当前仓库中系统管理员用 `admin`

#### 前端系统管理员状态
- 文件：`frontend/src/App.js:2538-2556`
- 实现：请求 `/admin/users`，响应成功则 `setIsAdmin(true)`
- 配套后端：
  - `backend/routes/admin.js:570-578`
  - `backend/middleware/admin.js:3-16`

#### domain-scoped 角色
- 文件：`backend/services/senseArticlePermissionService.js:5-26`
- 字段：
  - `isDomainMaster` -> `node.domainMaster`
  - `isDomainAdmin` -> `node.domainAdmins`
  - `canReviewSenseArticle` -> `admin` / `domainMaster` / 具备 `senseArticleReview` 的域相

#### 域相细粒度权限
- 文件：`backend/utils/domainAdminPermissions.js:3-18`, `backend/utils/domainAdminPermissions.js:54-66`
- 核心权限键：`senseArticleReview`

### 7.2 当前用户角色从哪里来

#### 系统管理员 / 普通用户
- 后端真实来源：`User.role`
- 前端辅助状态：`isAdmin`

#### 域主 / 域相
- 后端真实来源：目标节点上的 `domainMaster` / `domainAdmins`
- 非全局角色，而是节点作用域角色

### 7.3 是否存在 global role 与 domain-scoped role 两套逻辑

存在，而且非常明确：

- 全局：`User.role === 'admin'`
- 节点级：`node.domainMaster`, `node.domainAdmins`
- 域相细粒度能力：`node.domainAdminPermissions[userId]` 中的 `senseArticleReview`

### 7.4 按钮显示条件与真正允许进入管理页是否一致

#### 按钮显示
- 前端页面上：
  - `canReviewDomainAdmin`
  - `canReviewDomainMaster`
  - `isSystemAdmin`

#### 目标页准入
- 后端 dashboard：`backend/services/senseArticleService.js:516-522`
- 实际条件：
  - `isSystemAdmin`
  - 或 `isDomainMaster`
  - 或 `canReviewSenseArticle`

#### 一致性结论
- **基本一致**
- 原因：`senseArticlePermissionService` 中：
  - `canReviewDomainAdmin = canReviewSenseArticle`
  - `canReviewDomainMaster = isSystemAdmin || isDomainMaster`
- 因此：
  - 域主：按钮可见，后端可进
  - 有百科审核权限的域相：按钮可见，后端可进
  - 系统管理员：按钮可见，后端可进

### 7.5 是否存在“按钮显示了，但点击后 guard 拒绝进入”

就当前仓库代码而言：

- **存在 guard 拒绝进入的可能性**：如果后台返回 403，DashboardPage 会显示“暂无词条管理权限”
- **但这不会跳首页**：`frontend/src/components/senseArticle/SenseArticleDashboardPage.js:53-54` 明确是状态页 + 返回按钮
- 因此：
  - “按钮显示了，但点击后 guard 拒绝进入”在逻辑上可能
  - **但与当前用户描述的“直接跳首页”不吻合**

### 7.6 角色名称不一致专项

搜索结果显示：

- 前端/后端主干名称：
  - `domainMaster` = 域主
  - `domainAdmins` = 域相
  - `admin` = 系统管理员
- 高相关代码中**未发现**以下命名参与当前链路：
  - `steward`
  - `minister`
  - `sysadmin`
  - `superadmin`
- 存在的术语差异主要是：
  - 产品文案叫“域相”
  - 代码内部叫 `domainAdmin`

### 7.7 系统管理员是否会在 domain 逻辑中被误判

当前 sense article 权限服务里：
- `isSystemAdmin = user.role === 'admin'`
- `canReviewSenseArticle = isSystemAdmin || isDomainMaster || hasDomainAdminPermission(...)`

所以系统管理员在该链路中会被强制放行，不依赖 `domainAdmins` 名单。

结论：**本问题不像“系统管理员被局部 domain 判断误判为无权限”**。

---

## 8. 参数一致性检查

### 8.1 按钮点击传参

#### 从节点进入释义百科页
- 文件：`frontend/src/App.js:167-185`
- 参数：
  - `nodeId = node._id || node.nodeId`
  - `senseId = requestedSenseId || activeSenseId || synonymSenses[0].senseId`
- 若缺失：返回 `null`，上层 `openSenseArticleFromNode()` 会弹窗，不会跳首页

#### 从页面点击“词条管理”
- 文件：`frontend/src/App.js:5700-5707`
- 参数：
  - `nodeId = senseArticleContext.nodeId`
  - `senseId = senseArticleContext.senseId`

### 8.2 路由定义所需参数

这里没有 URL 路由定义，只有内部视图定义：

- 阅读页：需要 `view='senseArticle'` 且 `senseArticleContext.nodeId + senseId`
- 编辑页：需要 `view='senseArticleEditor'` 且 `nodeId + senseId + revisionId`
- 审阅页：需要 `view='senseArticleReview'` 且 `nodeId + senseId + revisionId`
- 历史页：需要 `view='senseArticleHistory'` 且 `nodeId + senseId`
- 词条管理页：需要 `view='senseArticleDashboard'` 且 `nodeId`

关键证据：`frontend/src/App.js:6539-6658`

### 8.3 目标页初始化所需参数

#### Dashboard 页面前端
- 文件：`frontend/src/components/senseArticle/SenseArticleDashboardPage.js:29-39`
- 实际请求：`senseArticleApi.getDashboard(nodeId)`
- 只强依赖：`nodeId`

#### Dashboard API
- 文件：`frontend/src/utils/senseArticleApi.js:164`
- 实际接口：`/sense-articles/dashboard?nodeId=...`

#### 后端 service
- 文件：`backend/routes/senseArticles.js:48-54`
- service：`backend/services/senseArticleService.js:1504-1602`
- 输入：`{ userId, nodeId }`

### 8.4 API 请求所需参数

- 不需要 `entryId`
- 不需要 `articleId`
- 不需要 `revisionId`
- 不需要 `slug`
- 当前 dashboard 只按 `nodeId` 做节点范围治理面板

### 8.5 是否存在参数名混用

在当前高相关链路中，实际使用的是：
- `nodeId`
- `senseId`
- `articleId`
- `revisionId`

未发现当前链路使用：
- `entryId`
- `articleSlug`
- `glossaryId`
- `domainSlug`

### 8.6 是否存在 “node.id 被当成 entry.id” 的迹象

当前词条管理点击链中**未发现**这种问题：

- 从 `SenseArticlePage` 到 `handleOpenSenseArticleDashboard()` 一直传递的是 `nodeId + senseId`
- Dashboard API 本身也只需要 `nodeId`
- 不存在“这里传了 node.id，但目标页要的是 entry.id”这一类直接冲突

### 8.7 结论

- 参数链整体是一致的
- 当前症状更像“view 被错误判定为非法”而非“参数缺失导致初始化失败”
- 一个很强的验证信号是：如果点击后 Network 面板里压根没有 dashboard 请求发出，就更能证明是前端 `view` guard 先拦截了页面

---

## 9. 建议抓取的运行时证据

以下建议用于后续人工定位；本次未改代码，仅列出建议的抓证位置。

### 9.1 点击处理函数日志

#### `frontend/src/App.js:5700-5707`
建议打印：
- 当前 `view`
- `senseArticleContext`
- `targetNodeId`
- `targetSenseId`
- 即将跳转的 `nextView`

建议观测点：
```js
console.debug('[entry-management] open-dashboard click', {
  currentView: view,
  nextView: 'senseArticleDashboard',
  context: senseArticleContext,
  targetNodeId,
  targetSenseId
});
```

### 9.2 子视图导航函数日志

#### `frontend/src/App.js:627-629`
建议打印：
- `nextView`
- 导航前后的 `senseArticleContext`

目的：确认点击后是否真的执行了 `setView('senseArticleDashboard')`

### 9.3 未知视图守卫日志

#### `frontend/src/App.js:2284-2287`
建议打印：
- 当前 `view`
- `isKnownView`
- `authenticated`
- `showLocationModal`

如果这里打印出：
- `view: 'senseArticleDashboard'`
- `isKnownView: false`

那就几乎可以直接坐实本次故障根因。

### 9.4 Dashboard 页面初始化日志

#### `frontend/src/components/senseArticle/SenseArticleDashboardPage.js:29-39`
建议打印：
- `nodeId`
- `articleContext`
- 请求是否真正发出

若点击后此日志完全没有出现，说明页面根本没挂载成功。

### 9.5 Network 面板重点检查

关注请求：
- `GET /sense-articles/dashboard?nodeId=...`

判断方法：
- **如果没有该请求**：问题发生在前端 view 跳转阶段
- **如果有该请求且 403/404**：再看权限/数据层
- **如果有该请求且 200 但仍回首页**：需继续看前端其它 effect 是否又改写了 `view`

### 9.6 当前用户角色 / 目标节点角色信息

建议同时打印：
- `/auth/profile` 返回的 `role`
- 前端 `isAdmin`
- 当前节点的 `domainMaster`
- 当前节点的 `domainAdmins`
- dashboard 前一页 API 返回的 `permissions`

重点核对：
- `permissions.isSystemAdmin`
- `permissions.canReviewDomainAdmin`
- `permissions.canReviewDomainMaster`
- 当前 `userId`

### 9.7 后端 dashboard 准入日志

#### `backend/services/senseArticleService.js:516-522`, `backend/services/senseArticleService.js:1504-1517`
建议打印：
- `userId`
- `nodeId`
- `roleInfo`
- `reviewableNodes`

用于确认：
- 该用户理论上是否真的有 dashboard 准入权限
- 以及 dashboard 是否被打到了后端

---

## 10. 附录：关键代码摘录

> 以下摘录只保留与问题强相关的最小片段；完整上下文请直接打开对应文件定位。

### 摘录 1
- 文件路径：`frontend/src/App.js`
- 起止行号：`5700-5707`
- 代码用途：词条管理按钮统一点击处理
- 与本问题的关系：定义了点击后目标视图就是 `senseArticleDashboard`

```js
const handleOpenSenseArticleDashboard = () => {
    const targetNodeId = normalizeObjectId(senseArticleContext?.nodeId);
    const targetSenseId = typeof senseArticleContext?.senseId === 'string' ? senseArticleContext.senseId.trim() : '';
    if (!targetNodeId) return;
    navigateSenseArticleSubView('senseArticleDashboard', {
        nodeId: targetNodeId,
        senseId: targetSenseId
    });
};
```

### 摘录 2
- 文件路径：`frontend/src/App.js`
- 起止行号：`627-629`
- 代码用途：内部子视图导航
- 与本问题的关系：本项目不是 URL 路由，而是直接 `setView(nextView)`

```js
const navigateSenseArticleSubView = useCallback((nextView, patch = {}, options = {}) => {
    setSenseArticleContext((prev) => buildSenseArticleSubViewContext(prev, view, patch, options));
    setView(nextView);
}, [view]);
```

### 摘录 3
- 文件路径：`frontend/src/App.js`
- 起止行号：`2284-2287`
- 代码用途：已知视图白名单校验
- 与本问题的关系：**直接把 `senseArticleDashboard` 判成未知视图并回首页**

```js
const isKnownView = ['home', 'nodeDetail', 'titleDetail', 'alliance', 'admin', 'profile', 'army', 'equipment', 'trainingGround', 'senseArticle', 'senseArticleEditor', 'senseArticleReview', 'senseArticleHistory'].includes(view);
if (!isKnownView) {
  setView('home');
  return;
}
```

### 摘录 4
- 文件路径：`frontend/src/App.js`
- 起止行号：`6621-6658`
- 代码用途：dashboard 页面渲染分支
- 与本问题的关系：说明目标页面本来就已经接入了 render switch

```js
{view === "senseArticleDashboard" && senseArticleContext?.nodeId && (
    <SenseArticleErrorBoundary ...>
        <SenseArticleDashboardPage
            nodeId={senseArticleContext.nodeId}
            articleContext={senseArticleContext}
            onContextPatch={patchSenseArticleContext}
            onBack={handleSenseArticleBack}
            ...
        />
    </SenseArticleErrorBoundary>
)}
```

### 摘录 5
- 文件路径：`frontend/src/components/senseArticle/SenseArticlePage.js`
- 起止行号：`525-527`
- 代码用途：阅读页“词条管理”按钮显示条件
- 与本问题的关系：按钮只对域主/域相审核者/系统管理员显示

```js
{(permissions.canReviewDomainAdmin || permissions.canReviewDomainMaster || permissions.isSystemAdmin) && onOpenDashboard ? (
  <button type="button" className="btn btn-secondary" onClick={onOpenDashboard}>
    <Sparkles size={16} /> 词条管理
```

### 摘录 6
- 文件路径：`frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
- 起止行号：`29-54`
- 代码用途：dashboard 页面初始化与错误处理
- 与本问题的关系：即便接口 403/失败，也只是显示状态页，不会主动回首页

```js
try {
  const response = await senseArticleApi.getDashboard(nodeId);
  setData(response || {});
} catch (requestError) {
  setError(requestError);
}
...
if (error) return <SenseArticleStateView ... action={<button ... onClick={onBack}>返回</button>} />;
```

### 摘录 7
- 文件路径：`frontend/src/utils/senseArticleApi.js`
- 起止行号：`64-95`, `164-164`
- 代码用途：前端 API 封装
- 与本问题的关系：请求失败只会抛错，不会自动跳首页；dashboard API 只需要 `nodeId`

```js
if (!response.ok) {
  throw buildApiError(response, parsed, '请求失败');
}
...
getDashboard: (nodeId = '', requestOptions = {}) => requestJson(`/sense-articles/dashboard${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`, {}, requestOptions),
```

### 摘录 8
- 文件路径：`backend/routes/senseArticles.js`
- 起止行号：`48-54`
- 代码用途：dashboard API 路由
- 与本问题的关系：词条管理页真正会打到这个接口

```js
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const data = await getGovernanceDashboard({
      userId: req.user.userId,
      nodeId: typeof req.query?.nodeId === 'string' ? req.query.nodeId.trim() : ''
    });
```

### 摘录 9
- 文件路径：`backend/services/senseArticlePermissionService.js`
- 起止行号：`5-26`
- 代码用途：后端角色/权限派生
- 与本问题的关系：定义域主、域相、系统管理员在词条链路中的统一权限位

```js
const isSystemAdmin = user?.role === 'admin';
const isDomainMaster = getIdString(node?.domainMaster) === userIdText;
const isDomainAdmin = (Array.isArray(node?.domainAdmins) ? node.domainAdmins : []).some((item) => getIdString(item) === userIdText);
const canReviewSenseArticle = isSystemAdmin || isDomainMaster || hasDomainAdminPermission({ ... });
...
canReviewDomainAdmin: canReviewSenseArticle,
canReviewDomainMaster: isSystemAdmin || isDomainMaster,
```

### 摘录 10
- 文件路径：`backend/utils/domainAdminPermissions.js`
- 起止行号：`57-60`
- 代码用途：域相默认权限策略
- 与本问题的关系：无显式权限项时，域相默认拥有 `senseArticleReview`

```js
const hasExplicitEntry = Object.prototype.hasOwnProperty.call(permissionMap, normalizedUserId);
const grantedPermissionKeySet = new Set(hasExplicitEntry
  ? permissionMap[normalizedUserId]
  : [DOMAIN_ADMIN_PERMISSION_KEYS.SENSE_ARTICLE_REVIEW]
);
```

### 摘录 11
- 文件路径：`frontend/src/App.js`
- 起止行号：`167-181`
- 代码用途：从节点对象解析释义百科页目标参数
- 与本问题的关系：说明进入释义百科页依赖的是 `nodeId + senseId`，不是 `entryId`

```js
const getNodeSenseArticleTarget = (node, requestedSenseId = '') => {
    const nodeId = normalizeObjectId(node?._id || node?.nodeId);
    if (!nodeId) return null;
    const normalizedSenseId = typeof requestedSenseId === 'string' ? requestedSenseId.trim() : '';
    if (normalizedSenseId) {
        return { nodeId, senseId: normalizedSenseId };
    }
    ...
};
```

### 摘录 12
- 文件路径：`frontend/src/SceneManager.js`
- 起止行号：`172-179`
- 代码用途：节点详情中的 `i` 按钮
- 与本问题的关系：这是“释义词条详情”链路的最上游入口之一

```js
this.renderer.setNodeButtons(centerNodeId, [{
  id: 'sense-entry',
  icon: 'i',
  angle: -Math.PI / 7,
  action: 'showSenseEntry',
  tooltip: '查看释义词条详情',
```

---

## 结论摘要（供后续人工快速判断）

1. 当前仓库的“词条管理界面”不是 URL 路由，而是 `App.js` 的内部视图 `senseArticleDashboard`。
2. “词条管理”按钮已经接到正确的点击处理函数：`handleOpenSenseArticleDashboard()`。
3. 目标页面 `SenseArticleDashboardPage` 也已经存在，并且 `App.js` 渲染分支已经接入。
4. **最关键的不一致点**：`App.js:2284` 的 `isKnownView` 白名单没有包含 `senseArticleDashboard`。
5. 因此，点击按钮后并不是“没跳过去”，而是“刚切到 dashboard 视图，立刻又被未知视图守卫改回 home”。
6. 现有代码没有证据表明本问题主要由 React Router、URL 重定向、参数缺失或 dashboard API 403 触发；这些路径即便出错，现有实现也更倾向于显示错误/返回态，而不是直接回首页。

