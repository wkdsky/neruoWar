# 社交与私聊语义迁移说明

## 迁移目标

把旧的“好友接受即自动创建私聊、删除私聊即全局删除”的语义，迁移为新的单边语义：

- 接受好友申请不自动创建私聊
- 删除聊天不影响好友关系
- 删除聊天不物理删除消息
- 删除聊天只影响当前用户视图

## 旧语义与新语义差异

### 旧语义

- 接受好友申请后自动创建 direct conversation
- `DELETE /api/chat/conversations/:conversationId` 会删除：
  - 整个 `Conversation`
  - 全部 `Message`
  - 全部 `ConversationMember`

### 新语义

- 接受好友申请后只更新 `Friendship`
- 私聊按需懒创建
- 删除聊天只会：
  - 隐藏当前成员视图
  - 推进当前成员 `clearedBeforeSeq`

## 兼容性策略

### 1. 已存在的自动创建 direct conversation

这些旧会话不会被清掉，继续可用。

原因：

- 旧数据本身并不非法
- 只是以后不再自动创建

### 2. 旧 ConversationMember 补字段

新增字段：

- `isVisible`
- `deletedAt`
- `clearedBeforeSeq`
- `clearedAt`

旧数据默认回填为：

- `isVisible=true`
- `deletedAt=null`
- `clearedBeforeSeq=0`
- `clearedAt=null`

### 3. 删除接口语义切换

从现在起：

- 删除私聊不再做物理删除
- 旧接口路径不变
- 但行为彻底改为单边隐藏

## 迁移脚本

脚本文件：

- [migrateSocialChatSemantics.js](/home/wkd/neruoWar/backend/scripts/migrateSocialChatSemantics.js)

package script：

- `npm run migrate-social-chat`

## 执行方式

在 `backend/` 目录执行：

```bash
npm run migrate-social-chat
```

## 脚本会做什么

1. 连接主业务库
2. 连接聊天库
3. 给 `ConversationMember` 回填新字段默认值
4. 重新计算每个 `Conversation.memberCount`

## 不会做什么

迁移脚本不会：

- 删除现有好友关系
- 删除现有私聊会话
- 删除现有消息
- 自动把旧会话隐藏

## 前端契约变更

前端需要同步注意：

### 1. 好友列表

不能再假设每个好友都有 `conversationId`。

应该优先依赖：

- `hasConversation`
- `conversationVisible`

需要打开聊天时，调用：

- `POST /api/chat/conversations/direct/:targetUserId`

### 2. 删除私聊

删除私聊后的提示语义应改成：

- “仅删除你这边的聊天记录与会话入口”
- “不会删除好友关系”

### 3. 删除后恢复

前端需要接受这个语义：

- 用户删除会话后，如果对方再发新消息，会话会重新出现

## 建议执行顺序

1. 部署新后端代码
2. 执行 `npm run migrate-social-chat`
3. 再接入新前端契约
4. 最后联调删除 / 恢复 / 未读逻辑
