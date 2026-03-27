# 社交与私聊后端架构说明

## 核心语义

当前后端语义按 QQ / 微信类产品收敛为以下规则：

- 删除好友 ≠ 删除聊天
- 删除聊天 ≠ 删除好友
- 好友关系独立存在
- 私聊会话独立存在
- 私聊会话支持单边删除
- 单边删除后，对方发来新消息会重新恢复会话可见性
- 用户只能看到自己清空边界之后的消息

## 分层设计

### 1. 社交关系层

负责：

- 好友申请
- 好友接受 / 拒绝
- 好友关系状态
- 好友列表

数据模型：

- `Friendship`

说明：

- 接受好友申请时只更新 `Friendship`
- 不自动创建私聊会话

### 2. 聊天会话层

负责：

- direct 会话主体
- 会话成员视图状态
- 消息历史
- 未读 / 已读
- 单边删除 / 清空边界

数据模型：

- `Conversation`
- `ConversationMember`
- `Message`

说明：

- direct conversation 按 `directKey` 全局唯一
- 会话懒创建
- 会话可单边隐藏

## 数据模型说明

### Friendship

职责：

- 只负责好友关系

关键字段：

- `participantsKey`
- `status`
- `requestMessage`
- `acceptedAt`
- `respondedAt`

索引：

- `participantsKey` 唯一
- `addresseeId + status + createdAt`
- `requesterId + status + createdAt`

### Conversation

职责：

- 会话主体

关键字段：

- `type`
- `directKey`
- `memberCount`
- `messageSeq`
- `lastMessagePreview`
- `lastMessageAt`

索引：

- `type + directKey` 唯一
- `lastMessageAt + updatedAt`
- `type + lastMessageAt`

### ConversationMember

职责：

- 每个成员自己的会话视图

关键字段：

- `isVisible`
- `deletedAt`
- `clearedBeforeSeq`
- `clearedAt`
- `lastReadSeq`
- `unreadCount`
- `isActive`

语义：

- `isVisible=false` 表示当前成员从会话列表中隐藏了该会话
- `clearedBeforeSeq` 表示当前成员看不到该序号及之前的消息
- `deletedAt` / `clearedAt` 记录最近一次单边删除时间

索引：

- `conversationId + userId` 唯一
- `userId + isActive + isVisible + updatedAt`
- `userId + isActive + unreadCount + updatedAt`

### Message

职责：

- 消息正文存储

关键字段：

- `conversationId`
- `seq`
- `senderId`
- `type`
- `content`
- `clientMessageId`

索引：

- `conversationId + seq` 唯一
- `conversationId + seq desc`
- `conversationId + createdAt`
- `senderId + createdAt`

## 数据流

### 1. 好友申请

1. 用户 A 发送好友申请
2. 写入 `Friendship(status=pending)`
3. 给用户 B 写通知

### 2. 接受好友申请

1. 用户 B 接受申请
2. `Friendship.status = accepted`
3. 给用户 A 写结果通知
4. 不创建任何聊天会话

### 3. 主动打开私聊

1. 用户 A 对某好友点击“发消息”
2. 后端检查双方是否已是好友
3. 查 `directKey`
4. 若无会话则创建 `Conversation`
5. 为双方补齐 `ConversationMember`
6. 仅打开者 `isVisible=true`
7. 若打开者之前删过会话，则恢复 `isVisible=true`
8. `clearedBeforeSeq` 保持不变

### 4. 发送消息

1. 校验当前用户为会话成员
2. direct 私聊额外校验双方仍为好友
3. 原子推进 `Conversation.messageSeq`
4. 写入 `Message`
5. 更新 `Conversation.lastMessage*`
6. 发送者：
   - `isVisible=true`
   - `lastReadSeq=当前 seq`
   - `unreadCount=0`
7. 接收者：
   - `isVisible=true`
   - `unreadCount += 1`

### 5. 单边删除会话

1. 只修改当前成员自己的 `ConversationMember`
2. 设置：
   - `isVisible=false`
   - `deletedAt=now`
   - `clearedAt=now`
   - `clearedBeforeSeq=current conversation.messageSeq`
   - `lastReadSeq=max(lastReadSeq, current messageSeq)`
   - `unreadCount=0`
3. 不删除：
   - `Friendship`
   - `Conversation`
   - `Message`
   - 对方 `ConversationMember`

### 6. 删除后恢复可见性

用户删掉会话后：

- 旧消息仍在库里
- 但当前用户只能看到 `seq > clearedBeforeSeq` 的消息

如果对方再发新消息：

- 当前用户 `isVisible` 自动恢复为 `true`
- 会话重新出现在会话列表中
- 只能看到删除边界之后的新消息

## API 语义

### 社交

- `POST /api/social/friends/:friendshipId/respond`
  - 接受好友申请时不自动建私聊

- `GET /api/social/friends`
  - 不强依赖 conversationId
  - 返回：
    - `hasConversation`
    - `conversationId`
    - `conversationVisible`

### 聊天

- `POST /api/chat/conversations/direct/:targetUserId`
  - 获取或懒创建私聊会话
  - 如果当前用户之前删过该会话，则恢复当前用户侧可见性

- `GET /api/chat/conversations`
  - 只返回 `isVisible=true` 的会话

- `GET /api/chat/conversations/:conversationId/messages`
  - 只返回 `seq > clearedBeforeSeq` 的消息

- `POST /api/chat/conversations/:conversationId/messages`
  - 新消息会自动恢复接收者会话可见性

- `DELETE /api/chat/conversations/:conversationId`
  - 只做当前用户侧隐藏与清空边界推进
  - 不做全局删除

## 数据库模式

### 推荐正式模式

- `CHAT_DB_MODE=split`

支持两种 split 形式：

1. 同一 Mongo 集群下独立 db
2. 独立聊天库 URI

相关配置：

- `CHAT_DB_MODE=split|shared`
- `CHAT_DB_NAME=...`
- `CHAT_MONGODB_URI=...`

### fallback 模式

- `CHAT_DB_MODE=shared`

用途：

- 本地开发
- 轻量环境

说明：

- 仅作为兼容模式
- 不作为推荐正式模式

### 旧配置兼容

如果只配置了 `CHAT_MONGODB_URI` 而没有 `CHAT_DB_MODE`：

- 当前会按 `split` 兼容
- 启动时会输出 deprecation warning

## 当前群聊状态

这次重构主要面向“社交 + 私聊”。

群聊相关能力目前只保留了未来可复用的通用模型能力，没有做群聊大重构。
