# Entry Management Redirect Fix Report

## 1. 问题根因

本次问题的点击链路本身并没有错：

- `SenseArticlePage` / `SenseArticleHistoryPage` / `SenseArticleReviewPage` / `SenseArticleEditor` 上的“词条管理”按钮都会调用 `onOpenDashboard`
- `frontend/src/App.js` 中的 `handleOpenSenseArticleDashboard()` 会执行：
  - `navigateSenseArticleSubView('senseArticleDashboard', { nodeId, senseId })`
  - 最终 `setView('senseArticleDashboard')`
- `frontend/src/App.js` 也已经存在 `view === 'senseArticleDashboard'` 的渲染分支，目标页面就是 `SenseArticleDashboardPage`

真正根因是：

- `frontend/src/App.js` 内部另一处 `isKnownView` 白名单漏掉了 `senseArticleDashboard`
- 导致点击后虽然短暂切换到了 `senseArticleDashboard`
- 但立刻被未知视图守卫执行 `setView('home')`
- 最终表现为“点击词条管理后跳回首页”

## 2. 修改文件清单

- `frontend/src/App.js`
- `docs/ENTRY_MANAGEMENT_REDIRECT_FIX_REPORT.md`

## 3. 每个文件改了什么

### `frontend/src/App.js`

#### 改动位置 1：增加局部 sense article 子视图常量
- 位置：`frontend/src/App.js:79-88`
- 改动内容：新增
  - `isDevEnvironment`
  - `SENSE_ARTICLE_SUB_VIEWS`
  - `isSenseArticleSubView()`
- 为什么这样改：
  - 只在本问题相关范围内收敛 `senseArticle` 子视图列表
  - 避免再次出现“render 支持了，但 guard 白名单忘了加”的不一致
  - 没有扩散到整个 App 的全部 view，保持最小改动

#### 改动位置 2：修复未知视图守卫白名单
- 位置：`frontend/src/App.js:2289-2300`
- 改动内容：
  - 把 `isKnownView` 改为“基础视图白名单 + `isSenseArticleSubView(view)`”
  - 使 `senseArticleDashboard` 被视为合法页面
- 为什么这样改：
  - 这是本次主问题的直接修复点
  - 能保证点击“词条管理”后不会再被误判为 unknown view

#### 改动位置 3：补开发态未知视图日志
- 位置：`frontend/src/App.js:2295-2298`
- 改动内容：仅在开发环境下输出简短 `console.debug`
- 为什么这样改：
  - 便于后续如果再出现新增 view 漏登记时快速定位
  - 生产环境不输出，不污染线上日志

#### 改动位置 4：补开发态“打开词条管理”日志
- 位置：`frontend/src/App.js:5713-5725`
- 改动内容：在 `handleOpenSenseArticleDashboard()` 里增加开发态日志，输出：
  - `currentView`
  - `nextView`
  - `nodeId`
  - `senseId`
- 为什么这样改：
  - 方便直接确认点击后是否真的进入 dashboard 切换链路
  - 只做开发态辅助，不改变业务语义

#### 改动位置 5：修正同类 fallback 判断的一致性
- 位置：`frontend/src/App.js:6718-6727`
- 改动内容：将底部异常页面兜底中的多处 `senseArticle*` 手写判断改为 `!isSenseArticleSubView(view)`
- 为什么这样改：
  - 这是与主问题同类的“render/guard/fallback 不一致”风险点
  - 本次顺手统一，避免下次再漏 `senseArticleDashboard`
  - 仍属于本问题局部范围内的最小一致性修复，不涉及架构重构

### `docs/ENTRY_MANAGEMENT_REDIRECT_FIX_REPORT.md`

- 新增修复报告
- 记录根因、修改点、验证方式和风险边界，方便后续交接

## 4. 如何验证

### 4.1 基础验证

1. 启动前端与后端
2. 使用以下任一角色登录：
   - 域主
   - 拥有百科审核权限的域相
   - 系统管理员
3. 进入任一可打开的释义百科页
4. 点击“词条管理”按钮
5. 预期结果：
   - 页面进入 `SenseArticleDashboardPage`
   - 不再跳回首页

### 4.2 阅读页验证

1. 从节点详情或“进入释义百科页”入口进入阅读页
2. 在 `SenseArticlePage` 点击“词条管理”
3. 预期：进入 dashboard 页面

### 4.3 历史页验证

1. 进入阅读页
2. 点击“历史版本”进入 `SenseArticleHistoryPage`
3. 点击“词条管理”
4. 预期：进入 dashboard 页面

### 4.4 审阅页验证

1. 以可审阅角色进入某个修订审阅页 `SenseArticleReviewPage`
2. 点击“词条管理”
3. 预期：进入 dashboard 页面

### 4.5 编辑页验证

1. 进入 `SenseArticleEditor`
2. 点击“词条管理”
3. 预期：进入 dashboard 页面

### 4.6 返回逻辑验证

1. 成功进入 dashboard 页面后点击“返回”
2. 预期：仍按既有 `handleSenseArticleBack()` 逻辑返回上一层页面，而不是异常回首页

### 4.7 开发态日志验证

在开发环境中打开浏览器控制台，点击“词条管理”时应看到类似日志：

```js
[sense-article] open dashboard { currentView, nextView, nodeId, senseId }
```

若未来再次出现未知视图问题，应看到：

```js
[view-guard] fallback to home: unknown view { view, reason: 'unknown_view' }
```

本次修复后，正常点击“词条管理”不应再出现 `senseArticleDashboard` 被 unknown 的日志。

### 4.8 本次最小回归检查结果

已完成以下静态/构建级回归确认：

- `senseArticleDashboard` 已进入合法视图判断
- dashboard 渲染分支仍保留不变
- `handleOpenSenseArticleDashboard()` 业务语义未变
- `senseArticleContext` 结构未改
- `handleSenseArticleBack()` 未改
- `SenseArticleDashboardPage` API 逻辑未改
- 生产构建通过：`frontend` 下 `npm run build`

说明：构建过程中存在仓库已有 ESLint warnings，但与本次修复无直接关系，本次未扩散处理。

## 5. 一致性加固说明

本次新增了一个仅限 `App.js` 使用的小型局部常量：

- `SENSE_ARTICLE_SUB_VIEWS`

包含：
- `senseArticle`
- `senseArticleEditor`
- `senseArticleReview`
- `senseArticleHistory`
- `senseArticleDashboard`

它的作用是：

- 让 sense article 子视图在 guard/fallback 里复用同一份定义
- 避免再次发生“渲染分支加了新页面，但合法性判断没同步”的遗漏
- 只收敛本问题相关范围，没有对整个 App 的 view 系统做大规模重构

## 6. 风险与剩余问题

### 本次已解决
- 解决“点击词条管理后立即跳首页”的问题
- 根因级修复点是：`senseArticleDashboard` 被漏判为非法视图

### 本次未涉及
- 未改造为 React Router
- 未修改 API 路径
- 未调整 `senseArticleContext` 结构
- 未修改 dashboard 页面接口和权限逻辑
- 未重构整个 `App.js` 的 view 架构

### 剩余说明
- 当前项目仍是字符串驱动的 view-switch 体系，后续若再新增 `senseArticle*` 子页面，仍需同步到相关 render/guard/fallback 判断
- 本次通过局部常量已经降低了这一类遗漏在 sense article 范围内再次发生的概率，但没有扩大到整个 App 级路由系统
