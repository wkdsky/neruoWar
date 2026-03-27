# 社交与聊天系统当前实现说明

## 当前结论

当前已经完成的是：

- 右侧抽屉社交 / 私聊前端入口
- 好友申请
- 好友列表
- 右侧抽屉好友搜索与发起申请
- 右侧抽屉好友申请处理
- 右侧抽屉会话列表
- 右侧抽屉私聊消息面板
- 私聊会话懒创建
- 私聊消息持久化
- 会话未读与已读
- 私聊单边删除与单边清空边界

当前还没有完成：

- socket 实时聊天
- 群聊接口与群管理
- 群上限约束的实际执行

## 数据持久化

### 当前落库方式

聊天和社交数据已经明确走后端 MongoDB 持久化，不依赖前端本地存储。

当前配置为：

- 主业务库：`MONGODB_URI=mongodb://localhost:27017/strategy-game`
- 聊天库：`CHAT_MONGODB_URI=mongodb://localhost:27017/strategy-game-chat`

配置位置：

- [backend/.env](/home/wkd/neruoWar/backend/.env)

数据库连接实现：

- [chatDatabase.js](/home/wkd/neruoWar/backend/config/chatDatabase.js)

### 当前持久化模式

当前实现支持两种模式，但正式推荐模式已经收敛为 `split`：

1. `shared`
2. `split`

当前本地环境已经配置为：

- `CHAT_DB_MODE=split`
- `CHAT_DB_NAME=strategy-game-chat`
- `CHAT_MONGODB_URI=mongodb://localhost:27017/strategy-game-chat`

### 清理前端存储是否会丢数据

不会。

前端清理 cookie 或 `localStorage` 只会导致：

- 本地登录态丢失
- 前端缓存状态丢失

不会导致：

- 好友关系删除
- 私聊会话删除
- 私聊消息删除

这些数据都在后端 MongoDB 中。

## 当前已实现的数据模型

以下模型已经新增：

- [Friendship.js](/home/wkd/neruoWar/backend/models/Friendship.js)
- [Conversation.js](/home/wkd/neruoWar/backend/models/Conversation.js)
- [ConversationMember.js](/home/wkd/neruoWar/backend/models/ConversationMember.js)
- [Message.js](/home/wkd/neruoWar/backend/models/Message.js)

### Friendship

用途：

- 好友申请
- 好友关系状态

核心字段：

- `requesterId`
- `addresseeId`
- `participantsKey`
- `status`

### Conversation

用途：

- 聊天会话主体

当前主要用于：

- 私聊会话

核心字段：

- `type`
- `directKey`
- `memberCount`
- `lastMessagePreview`
- `lastMessageAt`
- `messageSeq`

### ConversationMember

用途：

- 会话成员关系
- 用户在该会话下的未读与已读状态

核心字段：

- `conversationId`
- `userId`
- `role`
- `lastReadSeq`
- `unreadCount`
- `isActive`

### Message

用途：

- 私聊消息正文存储

当前支持：

- `text`
- `system`

当前实际发送接口只开放了文本消息。

## 当前已实现的常量与约束

常量文件：

- [socialChat.js](/home/wkd/neruoWar/backend/constants/socialChat.js)

当前已经落地的约束：

- 每个用户最多 `200` 个好友
- 私聊消息最大长度 `2000`
- 私聊数量当前不设上限

当前仅做了常量预埋、尚未落地执行的约束：

- 每个用户最多创建或加入 `10` 个群

原因：

- 群聊接口和成员管理尚未开始实现

## 当前已实现的通知类型

已经补入现有通知枚举：

- `friend_request`
- `friend_request_result`
- `group_invite`
- `group_invite_result`
- `group_member_removed`

位置：

- [senseArticle.js](/home/wkd/neruoWar/backend/constants/senseArticle.js)

当前实际用到的通知类型：

- `friend_request`
- `friend_request_result`

群相关通知类型目前只是预埋，还未进入实际业务流。

## 当前已实现的后端接口

### Social API

路由文件：

- [social.js](/home/wkd/neruoWar/backend/routes/social.js)

已挂载前缀：

- `/api/social`

当前已实现接口：

1. `GET /api/social/users/search`
   - 搜索用户
   - 返回基础资料和当前好友关系态

2. `POST /api/social/friends/request`
   - 发起好友申请
   - 会检查不能加自己
   - 会检查好友上限
   - 会写入好友申请通知

3. `GET /api/social/friends/requests`
   - 获取收到的和发出的好友申请

4. `POST /api/social/friends/:friendshipId/respond`
   - 接受或拒绝好友申请
   - 接受时只更新 Friendship
   - 不自动创建私聊会话
   - 会写入好友申请结果通知

5. `GET /api/social/friends`
   - 获取好友列表
   - 不强依赖私聊会话存在
   - 返回 `hasConversation / conversationId / conversationVisible`

### Chat API

路由文件：

- [chat.js](/home/wkd/neruoWar/backend/routes/chat.js)

已挂载前缀：

- `/api/chat`

当前已实现接口：

1. `GET /api/chat/conversations`
   - 获取当前用户的会话列表

2. `POST /api/chat/conversations/direct/:targetUserId`
   - 获取或懒创建与某好友的私聊会话
   - 当前只允许好友之间发起私聊
   - 若当前用户此前删除过该会话，则恢复当前用户侧可见性

3. `GET /api/chat/conversations/:conversationId/messages`
   - 拉取某个会话的历史消息
   - 使用 `beforeSeq` 分页
   - 只返回 `seq > clearedBeforeSeq` 的消息

4. `POST /api/chat/conversations/:conversationId/messages`
   - 发送文本消息
   - 会写入消息表
   - 会更新会话摘要
   - 会更新未读数
   - 若接收者此前删除过该会话，则自动恢复可见性

5. `POST /api/chat/conversations/:conversationId/read`
   - 标记会话已读
   - 更新 `lastReadSeq` 和 `unreadCount`

6. `DELETE /api/chat/conversations/:conversationId`
   - 单边删除私聊会话
   - 当前语义是：
     - 仅隐藏当前用户侧会话
     - 仅推进当前用户 `clearedBeforeSeq`

## 当前已实现的前端入口

本阶段已经把“社交 + 私聊”接入现有右侧抽屉栏。

接入位置：

- [App.js](/home/wkd/neruoWar/frontend/src/App.js)
- [AppShellPanels.js](/home/wkd/neruoWar/frontend/src/components/layout/AppShellPanels.js)
- [useChatCenter.js](/home/wkd/neruoWar/frontend/src/hooks/useChatCenter.js)
- [ChatDockPanel.js](/home/wkd/neruoWar/frontend/src/components/chat/ChatDockPanel.js)
- [ChatDockPanel.css](/home/wkd/neruoWar/frontend/src/components/chat/ChatDockPanel.css)

当前前端已经支持：

- 在右侧抽屉显示“社交”入口与未读/待处理 badge
- 查看当前可见私聊列表
- 查看好友列表
- 搜索用户并发起好友申请
- 查看收到/发出的好友申请
- 接受或拒绝好友申请
- 从好友列表主动打开私聊
- 会话懒创建后进入聊天
- 查看消息历史
- 发送文本消息
- 单边删除聊天，并通过确认弹窗明确说明“不删好友、只删我这边记录”

当前前端未完成：

- socket 实时推送
- 新消息无刷新即时到达
- 群聊 UI
     - 不删除 Friendship
     - 不删除 Conversation
     - 不删除 Message
     - 不影响对方视图

## 当前已实现的服务层

公共服务文件：

- [socialChatService.js](/home/wkd/neruoWar/backend/services/socialChatService.js)

当前已实现能力：

- 统一 ID 处理
- 私聊 `directKey` 生成
- 私聊会话自动创建
- 用户摘要序列化
- 会话列表项序列化
- 消息序列化
- 社交通知写入辅助

## 当前服务端接入点

服务端已经挂载新路由，并在启动时连接聊天数据库。

位置：

- [server.js](/home/wkd/neruoWar/backend/server.js)

当前新增内容包括：

- 挂载 `/api/social`
- 挂载 `/api/chat`
- 启动时执行 `connectChatDB()`

## 当前私聊删除语义

当前“删除私聊”已经改为单边行为：

- 只隐藏当前用户会话视图
- 只清空当前用户可见历史边界
- 不删除好友关系
- 不删除会话主体
- 不删除消息正文
- 对方继续保留原有视图

如果对方再发新消息：

- 当前用户会话会重新出现
- 但仍然只能看到 `clearedBeforeSeq` 之后的新消息

## 当前未完成项

### 前端

还没有开始：

- 右侧抽屉 `消息` section
- 好友列表 UI
- 会话列表 UI
- 私聊消息面板
- 删除私聊确认弹窗

### 实时能力

还没有开始：

- 聊天 socket 独立模块
- 进入会话房间
- 新消息实时推送
- 未读数实时同步

### 群聊

还没有开始：

- 创建群
- 加人
- 退群
- 踢人
- 群消息
- 群上限校验

## 当前风险点

### 1. 前端还没接新语义

当前后端已经是单边删除语义，但前端还未接入相应的确认文案和交互提示。

### 2. 还没有前端接入

现在接口存在，但用户还不能从 UI 使用。

### 3. 还没有实时推送

现在消息是 HTTP 持久化可用，但不是实时聊天体验。

### 4. 群聊约束还没进入业务执行

`10` 个群上限目前只是常量预留。

## 当前验证情况

已经完成的基础验证：

- 新增文件 `node --check`
- 模块 `require` 加载检查
- 服务端路由挂载检查

当前还没有完成的验证：

- 真实数据库写入回归验证
- 前后端联调
- socket 联调

## 下一步建议

下一步最合理的是继续做前端接入，而不是再扩后端范围。

建议顺序：

1. 接右侧抽屉 `消息` 入口
2. 接好友申请列表
3. 接会话列表与消息面板
4. 接删除私聊确认交互
5. 再补 socket 实时能力

## 相关文档

- 总体方案文档：
  - [social-chat-right-dock-implementation-plan.md](/home/wkd/neruoWar/docs/social-chat-right-dock-implementation-plan.md)
- 当前执行 TODO：
  - [social-chat-implementation-todo.md](/home/wkd/neruoWar/docs/social-chat-implementation-todo.md)
