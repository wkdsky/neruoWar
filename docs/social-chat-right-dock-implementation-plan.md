# 右侧抽屉社交与聊天系统实施方案

## 目标

在当前系统中新增一套类似 QQ 的基础社交能力，覆盖以下范围：

1. 加好友
2. 好友申请与处理
3. 私聊
4. 建群
5. 邀请入群、退群、踢人
6. 群聊
7. 未读数与消息列表

本次方案明确约束如下：

- UI 只接入右侧抽屉栏。
- 顶栏暂不新增任何社交或聊天相关入口。
- 优先复用现有认证、通知、`socket.io`、右侧抽屉结构。
- 不把聊天消息混入现有系统通知流。

## 当前系统现状与可复用能力

### 已有能力

- 后端已有 `socket.io`，入口在 `backend/server.js`。
- 前端已接入 `socket.io-client`，主入口在 `frontend/src/App.js`。
- 已有用户体系，模型为 `backend/models/User.js`。
- 已有系统通知中心，模型为 `backend/models/Notification.js`，前端状态在 `frontend/src/hooks/useNotificationCenter.js`。
- 已有右侧抽屉栏组件，入口为 `frontend/src/components/game/RightUtilityDock.js`。
- 首页和主壳层已经支持往右侧抽屉追加 section，入口分别在：
  - `frontend/src/components/game/Home.js`
  - `frontend/src/components/layout/AppShellPanels.js`

### 当前约束

- `backend/server.js` 中现有 socket 事件处理是 legacy 风格，并受 `ENABLE_LEGACY_SOCKET_HANDLERS` 开关影响。
- 现有 `Notification` 更适合承载“申请、邀请、审批、系统提醒”，不适合承载高频聊天消息。
- `User` 模型中已有内嵌 `notifications` 历史结构，但对于 IM 来说，消息量和查询模式都不适合继续沿用这种方式。

### 设计结论

社交系统应拆成三层：

1. 关系层：好友、拉黑、群成员关系
2. 会话层：私聊会话、群聊会话、会话成员状态
3. 消息层：消息正文、消息序号、消息未读

其中：

- 好友申请、入群邀请、被踢通知可以复用现有 `Notification`。
- 私聊消息、群聊消息必须单独建模。
- 群聊不复用现有 `Alliance`。

原因是 `Alliance` 是游戏组织，群聊是社交对象，生命周期、权限和交互频率都不同。

## 总体设计

### 设计原则

1. 系统通知与聊天消息分流
2. 私聊与群聊统一走会话模型
3. 未读数按会话成员维度维护，不在查询时临时全表计算
4. 所有消息先落库，再通过 socket 广播
5. 右侧抽屉为唯一 UI 入口

### 功能边界

本方案包含：

- 好友申请
- 好友列表
- 私聊
- 建群
- 群成员管理
- 群聊
- 会话未读数
- 消息已读位置
- 右侧抽屉消息面板

本方案暂不包含：

- 音视频通话
- 文件传输
- 图片上传
- 多端同步冲突解决
- 撤回、编辑、引用回复
- 全文搜索聊天记录
- 顶栏消息入口

## 数据模型设计

建议新增 4 个核心模型，外加 1 个可选扩展模型。

### 1. Friendship

用途：

- 记录好友申请与好友关系
- 支持屏蔽、删除好友、备注

建议字段：

- `_id`
- `requesterId`
- `addresseeId`
- `status`
  - `pending`
  - `accepted`
  - `rejected`
  - `blocked`
- `requestMessage`
- `remarkByRequester`
- `remarkByAddressee`
- `acceptedAt`
- `respondedAt`
- `createdAt`
- `updatedAt`

建议索引：

- `{ requesterId: 1, addresseeId: 1 }` 唯一索引
- `{ addresseeId: 1, status: 1, createdAt: -1 }`
- `{ requesterId: 1, status: 1, createdAt: -1 }`

说明：

- 同一对用户只允许存在一条主关系记录。
- 删除好友不建议物理删除，建议转为 `rejected` 或单独加 `deletedBy` 标记；如果要先快做，也可以直接删除，但后续恢复关系会缺少历史。

### 2. Conversation

用途：

- 表示一个聊天会话
- 统一私聊和群聊

建议字段：

- `_id`
- `type`
  - `direct`
  - `group`
- `title`
- `avatar`
- `ownerId`
- `directKey`
- `lastMessageId`
- `lastMessagePreview`
- `lastMessageAt`
- `messageSeq`
- `isArchived`
- `createdAt`
- `updatedAt`

建议索引：

- `{ type: 1, directKey: 1 }` 唯一索引，且仅对 `direct` 生效
- `{ updatedAt: -1 }`
- `{ lastMessageAt: -1 }`

说明：

- 私聊会话使用 `directKey = min(userIdA,userIdB):max(userIdA,userIdB)`。
- 这样可以保证两个人永远只有一个私聊会话。
- `messageSeq` 用作会话内递增消息序号，便于未读和拉取增量。

### 3. ConversationMember

用途：

- 表示用户是否在某个会话中
- 保存用户在该会话下的本地状态

建议字段：

- `_id`
- `conversationId`
- `userId`
- `role`
  - `owner`
  - `admin`
  - `member`
- `nicknameInGroup`
- `mute`
- `pinned`
- `lastReadSeq`
- `unreadCount`
- `joinedAt`
- `leftAt`
- `isActive`
- `createdAt`
- `updatedAt`

建议索引：

- `{ conversationId: 1, userId: 1 }` 唯一索引
- `{ userId: 1, isActive: 1, lastMessageAt: -1 }` 不直接可建，建议通过聚合或会话表排序解决
- `{ userId: 1, isActive: 1, updatedAt: -1 }`

说明：

- 未读数按成员维度落地，不要每次去 `Message` 动态 count。
- `lastReadSeq` 是最关键字段，后续做已读和增量都依赖它。

### 4. Message

用途：

- 保存消息正文

建议字段：

- `_id`
- `conversationId`
- `seq`
- `senderId`
- `type`
  - `text`
  - `system`
- `content`
- `mentions`
- `clientMessageId`
- `createdAt`
- `editedAt`
- `recalledAt`

建议索引：

- `{ conversationId: 1, seq: -1 }` 唯一索引
- `{ conversationId: 1, createdAt: -1 }`
- `{ senderId: 1, createdAt: -1 }`

说明：

- MVP 阶段仅支持 `text` 和 `system`。
- `clientMessageId` 用于前端幂等，避免重复发送导致 UI 出现两条相同消息。

### 5. GroupProfile（可选）

如果后续群能力会变多，可把群资料从 `Conversation` 中拆出去；如果先做 MVP，不必新增。

可选字段：

- `conversationId`
- `announcement`
- `joinPolicy`
- `memberLimit`
- `inviteConfirmRequired`

本期建议先不拆，直接放在 `Conversation` 即可。

## 与现有 Notification 的关系

以下事件继续走 `Notification`：

- 收到好友申请
- 好友申请被通过/被拒绝
- 收到入群邀请
- 入群邀请被通过/被拒绝
- 被踢出群

以下内容不走 `Notification`：

- 私聊消息
- 群聊消息
- 会话未读

原因：

- 聊天消息频率高
- 列表查询和分页方式与通知不同
- 未读统计粒度是“会话”，不是“通知流”

## 后端接口设计

建议新增两个路由模块：

- `backend/routes/social.js`
- `backend/routes/chat.js`

并在 `backend/server.js` 中挂载：

- `/api/social`
- `/api/chat`

### Social API

#### 1. 搜索用户

`GET /api/social/users/search?keyword=xxx`

用途：

- 加好友前搜索用户
- 拉人入群时搜索候选人

返回字段建议：

- `_id`
- `username`
- `avatar`
- `profession`
- `allianceId`
- `allianceName`
- `friendStatus`

说明：

- 不能返回过多隐私字段。
- 需要排除自己。

#### 2. 发起好友申请

`POST /api/social/friends/request`

请求体：

```json
{
  "targetUserId": "xxx",
  "message": "我是某某"
}
```

逻辑：

- 不能加自己
- 若已是好友则返回现有状态
- 若存在待处理关系则拒绝重复提交
- 写入 `Friendship`
- 给对方写一条 `Notification`

#### 3. 获取好友申请列表

`GET /api/social/friends/requests`

返回：

- `received`
- `sent`

#### 4. 处理好友申请

`POST /api/social/friends/:friendshipId/respond`

请求体：

```json
{
  "action": "accept"
}
```

动作：

- `accept`
- `reject`

如果接受：

- 更新 `Friendship.status`
- 自动创建或获取私聊会话
- 给申请方写处理结果通知

#### 5. 好友列表

`GET /api/social/friends`

返回字段建议：

- `friendUserId`
- `username`
- `avatar`
- `profession`
- `remark`
- `conversationId`
- `lastActiveAt`

#### 6. 删除好友

`POST /api/social/friends/:friendshipId/delete`

MVP 逻辑建议：

- 仅解除好友关系
- 不删除历史私聊会话

### Chat API

#### 1. 获取会话列表

`GET /api/chat/conversations`

返回字段建议：

- `conversationId`
- `type`
- `title`
- `avatar`
- `memberCount`
- `lastMessagePreview`
- `lastMessageAt`
- `unreadCount`
- `pinned`
- `mute`

排序：

- `pinned DESC`
- `lastMessageAt DESC`

#### 2. 获取或创建私聊会话

`POST /api/chat/conversations/direct/:targetUserId`

逻辑：

- 校验是否互为好友
- 按 `directKey` 查找或创建 `Conversation`
- 确保双方都有 `ConversationMember`

#### 3. 创建群聊

`POST /api/chat/groups`

请求体：

```json
{
  "title": "群名称",
  "memberUserIds": ["u1", "u2"]
}
```

逻辑：

- 创建 `Conversation(type=group)`
- 创建创建者 `owner` 成员记录
- 批量写入被邀请成员的 `ConversationMember`
- 给被邀请者写 `Notification`

MVP 建议：

- 允许“先拉入后通知”
- 不做复杂的入群审批

#### 4. 群详情

`GET /api/chat/groups/:conversationId`

返回：

- 群资料
- 当前用户角色
- 成员列表

#### 5. 添加群成员

`POST /api/chat/groups/:conversationId/members`

请求体：

```json
{
  "memberUserIds": ["u3", "u4"]
}
```

权限：

- `owner`
- `admin`

#### 6. 移除群成员

`DELETE /api/chat/groups/:conversationId/members/:userId`

权限：

- `owner` 可移除所有非 owner
- `admin` 可移除 `member`

#### 7. 退群

`POST /api/chat/groups/:conversationId/leave`

逻辑：

- 当前成员 `isActive=false`
- `leftAt=now`

#### 8. 获取消息列表

`GET /api/chat/conversations/:conversationId/messages?beforeSeq=100&limit=30`

说明：

- 使用 `seq` 做分页比纯时间分页更稳
- 按倒序拉取，再前端翻转展示

#### 9. 发送消息

`POST /api/chat/conversations/:conversationId/messages`

请求体：

```json
{
  "clientMessageId": "uuid",
  "type": "text",
  "content": "你好"
}
```

逻辑：

1. 校验用户是活跃成员
2. 原子递增 `Conversation.messageSeq`
3. 写入 `Message`
4. 更新 `Conversation.lastMessage*`
5. 增加其他成员 `unreadCount`
6. 通过 socket 广播

#### 10. 标记会话已读

`POST /api/chat/conversations/:conversationId/read`

请求体：

```json
{
  "lastReadSeq": 128
}
```

逻辑：

- 更新当前成员 `lastReadSeq`
- 重算或直接归零 `unreadCount`

## Socket 设计

聊天实时事件不要继续堆进现有 legacy 事件块，建议抽新模块：

- `backend/socket/registerChatSocket.js`
- `backend/socket/socketAuth.js`

在 `backend/server.js` 中完成统一注册。

### 连接与鉴权

连接后：

1. 客户端携带 token 建立 socket
2. 服务端校验 token
3. 将 socket 绑定到 `socket.userId`
4. 自动加入房间 `user:{userId}`

说明：

- 不建议继续用“连上后再手工 emit authenticate”作为唯一认证方式。
- 更稳的是 socket handshake 就带 token；如果为了兼容当前结构，也可以保留现有前端认证方式，但聊天模块内部仍要做统一封装。

### 房间策略

- 用户个人房间：`user:{userId}`
- 会话房间：`conversation:{conversationId}`

进入会话页时：

- 客户端触发 `chat:conversation:join`
- 服务端校验成员身份后把 socket 加入对应房间

离开会话页时：

- 客户端触发 `chat:conversation:leave`

### 事件设计

客户端发出：

- `chat:conversation:join`
- `chat:conversation:leave`
- `chat:message:send`
- `chat:conversation:read`

服务端推送：

- `chat:ready`
- `chat:message:new`
- `chat:conversation:update`
- `chat:conversation:read`
- `chat:friend:request:new`
- `chat:group:invite:new`

### 服务端广播原则

发送消息成功后：

- 向 `conversation:{conversationId}` 广播 `chat:message:new`
- 向相关成员个人房间广播 `chat:conversation:update`

这样可以区分：

- 正在打开会话的人直接收消息
- 只在会话列表页的人更新未读和最后一条摘要

## 前端 UI 方案

## 总体入口

只接入右侧抽屉栏，不在顶栏新增入口。

建议新增一个 section：

- `id: 'chat'`
- `label: '消息'`
- `icon: MessageCircle`
- `badge: 未读总数`

接入点：

- 首页：`frontend/src/components/game/Home.js`
- 应用主壳：`frontend/src/components/layout/AppShellPanels.js`

这样无论用户在首页还是知识域主视图，都能从右侧打开消息抽屉。

### 抽屉内部布局

建议布局为左右双栏，但整体仍算一个抽屉面板。

左栏：

- 顶部 tab
  - `会话`
  - `好友`
  - `群`
  - `申请`
- 对应列表区域

右栏：

- 默认显示提示态
- 点开会话后显示聊天区
- 顶部显示会话标题、成员数、群操作按钮
- 中部显示消息列表
- 底部显示输入框与发送按钮

### 交互流

#### 1. 加好友

入口建议：

- 消息抽屉内 `好友` tab 顶部按钮“添加好友”
- 用户搜索弹窗

流程：

1. 点击“添加好友”
2. 弹出搜索用户弹层
3. 输入用户名关键字
4. 搜索结果卡片展示用户基本信息与当前关系状态
5. 点击“加好友”
6. 输入验证信息并提交

#### 2. 私聊

入口建议：

- 在好友列表点击某个好友
- 自动打开对应私聊会话

流程：

1. 点击好友
2. 若不存在私聊会话则后端创建
3. 右栏打开聊天窗口
4. 拉取历史消息
5. 进入会话时自动标记已读

#### 3. 建群

入口建议：

- `群` tab 顶部按钮“新建群聊”

流程：

1. 输入群名
2. 从好友列表中多选成员
3. 提交创建
4. 自动进入新群会话

#### 4. 处理申请

申请页统一展示：

- 收到的好友申请
- 收到的入群邀请
- 我发出的好友申请

因为已有 `Notification` 体系，这个页面可以做成：

- 读取 `Notification`
- 只筛出社交相关类型

### 组件拆分建议

建议新增以下前端组件：

- `frontend/src/components/chat/ChatDockPanel.js`
- `frontend/src/components/chat/ChatConversationList.js`
- `frontend/src/components/chat/ChatFriendList.js`
- `frontend/src/components/chat/ChatGroupList.js`
- `frontend/src/components/chat/ChatRequestList.js`
- `frontend/src/components/chat/ChatMessagePane.js`
- `frontend/src/components/chat/ChatComposer.js`
- `frontend/src/components/chat/ChatUserSearchModal.js`
- `frontend/src/components/chat/ChatGroupManageModal.js`

建议新增以下 hooks：

- `frontend/src/hooks/useChatCenter.js`
- `frontend/src/hooks/useChatSocket.js`

### 状态组织建议

`useChatCenter` 建议维护：

- `conversations`
- `activeConversationId`
- `messagesByConversationId`
- `conversationUnreadTotal`
- `friends`
- `groups`
- `socialRequests`
- `isChatPanelExpanded`
- `isLoadingConversations`
- `isSendingMessage`

其中：

- 会话列表首次进入时拉取
- 消息列表在打开会话时拉取
- 新消息通过 socket 增量写入本地状态

## 未读数设计

### 会话未读

来源：

- `ConversationMember.unreadCount`

好处：

- 查询简单
- 会话列表可直接展示
- 右侧抽屉 badge 可直接聚合

### 抽屉总未读

建议：

- 聊天未读与系统通知未读分开维护
- 右侧抽屉按钮 `消息` 显示聊天未读
- `公告` 继续显示公告/通知未读

不要做成一个混合总数，否则用户分不清是消息还是系统公告。

## 权限与规则

### 好友关系

- 私聊仅允许好友之间建立
- 后续如果想放开“陌生人私信”，可以再加隐私设置

### 群权限

MVP 建议仅保留三档：

- `owner`
- `admin`
- `member`

规则建议：

- `owner` 可转让群主、踢人、解散群
- `admin` 可拉人、踢普通成员
- `member` 只能发言、退群

### 安全校验

服务端必须校验：

- 当前用户是否为该会话活跃成员
- 拉人者是否有权限
- 被移除对象是否存在且仍为活跃成员
- 私聊对象是否为好友

不能仅依赖前端隐藏按钮。

## 持久化与性能策略

### 消息分页

建议使用：

- `beforeSeq`
- `limit`

而不是直接用页码。

原因：

- 会话消息是不断增长的
- 页码在实时插入消息后容易漂移

### 最后一条消息摘要

`Conversation.lastMessagePreview` 建议只存：

- 截断后的文本摘要

不要每次列表页都回查最后一条消息。

### 幂等

发送消息时前端传 `clientMessageId`，服务端按“会话 + 发送者 + clientMessageId”判重，可避免弱网重发问题。

### MongoDB 风险点

高频更新点主要有：

- `Conversation.messageSeq`
- `Conversation.lastMessageAt`
- `ConversationMember.unreadCount`

应避免：

- 每次发消息都全表扫成员
- 每次列表页都聚合历史消息

MVP 阶段可以接受对成员做一次 `updateMany`，因为群规模通常不大；如果后续大群很多，再考虑单独优化。

## 文件落点建议

### 后端

建议新增：

- `backend/models/Friendship.js`
- `backend/models/Conversation.js`
- `backend/models/ConversationMember.js`
- `backend/models/Message.js`
- `backend/routes/social.js`
- `backend/routes/chat.js`
- `backend/services/chatService.js`
- `backend/services/socialService.js`
- `backend/socket/registerChatSocket.js`

建议修改：

- `backend/server.js`
- `backend/constants/senseArticle.js`
  - 增补社交通知类型

### 前端

建议新增：

- `frontend/src/components/chat/*`
- `frontend/src/hooks/useChatCenter.js`
- `frontend/src/hooks/useChatSocket.js`

建议修改：

- `frontend/src/components/game/Home.js`
- `frontend/src/components/layout/AppShellPanels.js`
- `frontend/src/components/game/RightUtilityDock.js`
  - 通常不需要改结构，只是传入新的 section
- `frontend/src/App.js`
  - 初始化 chat 状态与 socket 绑定

## 分期实施建议

### Phase 1：社交与私聊 MVP

范围：

- 用户搜索
- 发起好友申请
- 处理好友申请
- 好友列表
- 私聊会话
- 发送文本消息
- 会话列表
- 右侧抽屉消息入口

验收标准：

- 用户 A 可搜索用户 B 并发送好友申请
- 用户 B 可在申请页接受申请
- A/B 自动获得唯一私聊会话
- 双方可在右侧抽屉进行实时私聊
- 未读数可正确增减

### Phase 2：群聊 MVP

范围：

- 建群
- 邀请成员
- 群成员列表
- 退群
- 踢人
- 群系统消息

验收标准：

- 可从好友中创建群
- 成员可进入群聊
- 群主和管理员可拉人/踢人
- 会话列表和未读正确更新

### Phase 3：增强能力

范围：

- 免打扰
- 置顶
- 已读位置同步
- 撤回
- 群公告
- 搜索历史消息

## 关键风险与规避

### 风险 1：把聊天消息继续当通知存

后果：

- 用户文档膨胀
- 通知列表和聊天列表混乱
- 未读模型失控

规避：

- 消息单独建模

### 风险 2：私聊重复建会话

后果：

- 同一对用户出现多个私聊窗口

规避：

- 使用 `directKey` 唯一索引

### 风险 3：未读数靠动态查询现算

后果：

- 会话列表慢
- 高并发下体验差

规避：

- 在 `ConversationMember` 中持久化 `unreadCount` 和 `lastReadSeq`

### 风险 4：继续耦合 legacy socket 代码

后果：

- 维护复杂
- 行为边界不清晰
- 后续扩展困难

规避：

- 单独抽 `registerChatSocket`

### 风险 5：群和联盟概念混用

后果：

- 权限和成员来源混乱
- 后续难以扩展纯社交群

规避：

- 群聊作为独立模型

## 推荐实施顺序

1. 先落后端模型与索引
2. 再做 `social` 和 `chat` REST API
3. 再接 socket 实时事件
4. 再做右侧抽屉 `消息` 面板
5. 最后补申请页、群管理与边缘状态处理

## 超大规模落地补充

上文的方案足以支撑中小规模到中大规模阶段，但如果目标用户量上升到千万级，甚至过亿级，后端落地方式必须进一步分层，不能继续把“用户关系、会话、消息、在线连接、未读统计、推送通知”都压在同一个 Node 服务和一套 Mongo 查询模型里。

这一节描述的是：

- 产品形态不变
- 右侧抽屉 UI 不变
- 但底层架构升级为可支撑超大规模的 IM 体系

### 规模分层建议

建议先明确三档目标：

#### 1. 当前阶段

- 注册用户：10 万到 100 万
- 日活：1 万到 10 万
- 并发在线连接：几千到几万

适合方案：

- 单体后端
- MongoDB 单库或轻分片
- 单 socket 网关
- REST + socket 直连数据库

#### 2. 中规模阶段

- 注册用户：100 万到 3000 万
- 日活：10 万到 300 万
- 并发在线连接：10 万级

必须增加：

- socket 网关层
- Redis 做在线路由和缓存
- 消息异步总线
- 会话与消息存储分离
- 读模型物化

#### 3. 超大规模阶段

- 注册用户：3000 万到 1 亿以上
- 日活：千万级
- 并发在线连接：百万级

必须升级为：

- 多机房或多可用区部署
- 接入层、业务层、消息投递层彻底拆分
- 用户关系、会话索引、消息正文分库分表
- 强依赖异步消息队列
- 群聊按群规模分层处理
- 大量使用最终一致性

### 核心架构拆分

到千万级以上时，建议拆成如下服务：

#### 1. Access Gateway

职责：

- 处理 WebSocket 或长连接接入
- 做 token 校验
- 维护在线连接
- 维护 `userId -> gatewayId / connectionId` 在线路由

说明：

- 网关层不直接写业务数据库
- 网关层只做连接和转发，不承载复杂业务

#### 2. Social Service

职责：

- 好友关系
- 好友申请
- 拉黑
- 用户搜索结果中的关系态

说明：

- 好友关系读写和聊天消息读写完全不是一类负载，建议独立服务

#### 3. Conversation Service

职责：

- 私聊会话创建
- 群会话创建
- 成员管理
- 会话列表索引
- 会话级未读状态

#### 4. Message Service

职责：

- 生成消息 ID
- 分配会话内序号
- 消息持久化
- 写消息事件到消息总线

#### 5. Delivery Service

职责：

- 消费消息事件
- 找到在线目标用户
- 推送到对应 gateway
- 离线场景写入收件箱索引或推送任务

#### 6. Inbox / Timeline Service

职责：

- 维护用户会话列表
- 维护最后一条消息摘要
- 维护未读数
- 给右侧抽屉提供低延迟读模型

说明：

- 这是典型的物化读模型
- 不能指望在用户打开抽屉时动态 join 多张大表实时算出来

#### 7. Notification Service

职责：

- 承载好友申请、入群邀请、系统提醒
- 继续和聊天消息分流

#### 8. Push Service

职责：

- 用户离线时推送移动端或浏览器提醒
- 控制推送频率和聚合策略

### 建议的数据流

#### 私聊发送链路

1. 客户端向网关发送消息
2. 网关做鉴权和基础限流
3. 网关将请求转给 Message Service
4. Message Service 校验成员关系并写消息正文
5. Message Service 产生一条 `message_created` 事件
6. Delivery Service 消费事件并推送在线接收者
7. Inbox Service 更新双方会话索引和未读数
8. 若接收者离线，则进入离线收件箱并触发 Push Service

这里最关键的点是：

- 发送成功的判定以“消息正文落库成功”为准
- 会话列表更新、未读更新、推送可以异步完成

#### 群聊发送链路

小群和大群应分开处理。

小群：

- 可以直接 fanout 到所有成员的会话索引

大群：

- 不适合每发一条都同步更新所有成员未读
- 更适合采用按用户拉取增量 + 局部物化的方式

### 存储策略升级

### 1. 用户关系存储

好友关系数据量虽然大，但写频不算极高，适合独立存储。

建议：

- 按 `userId` 或 `(minUserId,maxUserId)` 做分片
- 每个用户维护一份好友边索引
- 申请流单独存储，不与最终好友边混在一张超大宽表里

### 2. 会话存储

`Conversation` 和 `ConversationMember` 在千万级用户时会非常大，但仍然适合保留。

建议：

- `Conversation` 按 `conversationId` 分片
- `ConversationMember` 按 `userId` 和 `conversationId` 建双向索引
- 右侧抽屉读取会话列表时优先查“用户会话索引表”，而不是现查成员表再回表聚合

换句话说，要增加一类专门面向读取的表：

- `UserConversationInbox`

建议字段：

- `userId`
- `conversationId`
- `conversationType`
- `titleSnapshot`
- `avatarSnapshot`
- `lastMessagePreview`
- `lastMessageAt`
- `lastReadSeq`
- `unreadCount`
- `mute`
- `pinned`
- `updatedAt`

说明：

- 这个表本质上是会话列表读模型
- 超大规模下非常关键

### 3. 消息正文存储

消息量会远大于关系量和会话量。

建议：

- 消息正文独立存储
- 按 `conversationId` 分片
- 大会话可继续按时间或分区号二次分桶

推荐思路：

- 会话级分片键：`hash(conversationId)`
- 分桶键：`month` 或 `partitionNo`

原因：

- 聊天记录最常见的访问模式是“某个会话向前翻页”
- 按会话聚集最符合查询模式

### 4. 通知存储

通知仍然独立，不和聊天消息混存。

在超大规模下，通知还要再拆：

- 系统通知
- 社交通知
- 运营通知

避免一张表承担所有提醒流量。

### 未读数与会话列表策略

超大规模 IM 最忌讳两个错误：

1. 打开会话列表时现算未读数
2. 打开会话列表时现算最后一条消息

必须采用物化读模型。

#### 私聊未读

私聊可采用：

- 发消息时直接增量更新接收方 `UserConversationInbox.unreadCount`
- 发送方会话更新时间同步刷新

这是典型的 fanout on write。

原因：

- 私聊目标只有一个接收者
- 写扩散成本极低

#### 小群未读

小群可以继续 fanout on write，但要有群人数上限。

建议阈值：

- 100 人以内：直接 fanout on write
- 100 到 500 人：可继续 fanout，但要异步批量化
- 500 人以上：不再对每个成员同步精确递增未读

#### 大群未读

大群建议改为：

- 群维度只维护 `maxSeq`
- 用户维度维护 `lastReadSeq`
- 未读数在客户端或读层按 `maxSeq - lastReadSeq` 近似计算

这样能避免每条消息都对几千、几万成员做写放大。

注意：

- 超大群不建议展示“精确到每个人的逐条已读”
- 也不建议做全量成员未读精确写入

### 群聊规模分层

产品虽然统一叫“群”，但后端不能把所有群当成一类。

建议分为四档：

#### 1. 普通群

- 2 到 100 人

策略：

- 强一致会话列表
- fanout on write
- 成员列表可完整返回

#### 2. 中群

- 100 到 500 人

策略：

- 异步更新成员收件箱
- 限制频繁拉全量成员列表

#### 3. 大群

- 500 到 5000 人

策略：

- 会话索引异步化
- 未读采用 `lastReadSeq`
- 群成员接口分页化
- 群内搜索、@ 全体、已读回执全部降级

#### 4. 超级群

- 5000 人以上

策略：

- 更接近频道模型，不再等同 QQ 式普通群
- 只保留基础发言和拉取消息
- 不做逐人未读扇出
- 不做完整在线列表
- 不做全成员实时状态展示

如果产品未来真的要到过亿用户，超级群最好和普通群走不同实现。

### 消息总线与异步化

到千万级以上，必须引入消息队列或日志总线。

可选技术思路：

- Kafka
- Pulsar
- RocketMQ

消息总线承载的事件包括：

- `message_created`
- `conversation_updated`
- `friend_request_created`
- `group_member_added`
- `group_member_removed`
- `notification_created`

这样做的价值是：

- 发送链路和投递链路解耦
- 会话列表更新和消息正文写入解耦
- 出问题时容易补偿和重放

### 在线路由与多网关

在百万级连接时，不可能只有一个 socket 进程。

建议：

- 网关无状态化
- 在线状态放 Redis 或专门的 Presence 服务
- 记录 `userId -> gatewayId -> connectionIds`

发送消息时：

1. Delivery Service 查询接收者在线路由
2. 若在线，则把消息投递到目标 gateway
3. 若不在线，则只写离线索引和推送任务

不要做：

- 业务服务直接持有用户连接对象
- 多业务节点之间互相查进程内 socket 状态

### 多机房与多地区

到过亿用户时，多机房几乎是必选项。

建议：

- 接入层就近接入
- 账号与关系数据保持主副本或多活策略
- 会话消息优先按会话归属区域写入
- 跨区同步采用异步复制

要接受的现实是：

- 消息列表摘要、未读数、在线状态在跨区下会有短暂延迟
- 这些信息可以最终一致，但消息正文顺序要在单会话内保持稳定

### ID 生成与顺序保证

超大规模下不要再依赖数据库自增或弱随机 ID。

建议：

- 全局消息 ID 使用雪花类 ID
- 会话内仍维护单独的 `seq`

原因：

- 全局 ID 便于追踪、去重、排查
- 会话内 `seq` 便于分页、已读、顺序保证

### 热点问题

超大规模 IM 一定会遇到热点会话和热点群。

热点来源包括：

- 超大群爆发式发言
- 明星用户私信洪峰
- 大量用户同时拉取某热门群历史

规避方式：

- 热门会话单独限流
- 历史消息走缓存和分页保护
- 会话列表读模型缓存化
- 输入态和发送态做防抖与频控

### 搜索与索引

用户搜索、群搜索、聊天记录搜索不应混在主库直接模糊查询。

建议：

- 用户搜索使用独立搜索索引
- 群搜索使用独立搜索索引
- 聊天记录搜索采用离线建立倒排，不进入 MVP 主链路

如果先做 MVP：

- 用户搜索可以先走用户名前缀或精确匹配
- 不要一开始就做全文搜索聊天记录

### 反垃圾与风控

用户规模上来后，社交系统最大的实际问题不是技术，而是骚扰和滥用。

至少要预留以下能力：

- 好友申请频控
- 陌生人私信限制
- 单日建群数量限制
- 单日消息发送频率限制
- 拉黑
- 举报
- 关键词风控
- 批量账号行为识别

如果不做这些，用户量一大，社交功能会先变成骚扰系统。

### 数据保留与冷热分层

消息历史越久，访问频率越低。

建议：

- 最近 30 天热数据放在线高性能存储
- 历史数据进入冷分层存储
- 右侧抽屉默认只拉近段历史

这样可避免：

- 所有历史都压在热点库里
- 大量旧消息拖累线上查询

### 监控与补偿

超大规模下，必须从第一天就把链路观测想清楚。

至少要监控：

- 消息发送成功率
- 消息落库延迟
- 投递延迟
- 未读索引更新延迟
- socket 在线连接数
- 会话列表接口 P95/P99
- 单群消息吞吐
- 推送送达率

同时要具备补偿能力：

- 会话摘要重建
- 未读数重算
- 某用户收件箱重放
- 某会话索引修复

### 对当前项目的现实建议

如果你现在的系统还在现有单体 Node + React 阶段，不应该一上来就按“过亿用户”完整搭建全部基础设施，否则开发成本和复杂度都会失控。

更合理的路线是：

#### 第一阶段

- 先按本方案前半部分落地单体版
- 模型设计上预留拆分空间
- 所有核心 ID、状态流、事件名、分页方式先定对

#### 第二阶段

- 当 DAU 和消息量上来后，优先拆：
  - socket gateway
  - message service
  - inbox read model
  - Redis 在线路由

#### 第三阶段

- 当进入千万级用户和百万级连接后，再拆：
  - social service
  - notification service
  - push service
  - 消息总线
  - 多机房部署

也就是说，产品层可以一次设计到位，但工程落地必须分阶段，不要在当前阶段为了未来过度设计。

## 本方案的最终建议

对当前系统，最稳的落地方式是：

- 通知继续做“申请/邀请/系统提醒”
- 聊天单独做“会话/成员/消息”
- UI 统一挂在右侧抽屉
- 顶栏先不动
- 先做“好友 + 私聊”最小闭环，再扩“群聊”
- 在架构上预留未来拆成 `gateway + social + conversation + message + inbox + push` 的演进路径

这样改动面可控，和你现有系统的结构也最兼容。
