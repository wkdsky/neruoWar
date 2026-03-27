const test = require('node:test');
const assert = require('node:assert/strict');

const { createSocialService } = require('../services/socialService');
const { createChatService } = require('../services/chatService');
const { buildUserPairKey } = require('../services/socialChatService');

const makeObjectId = (value) => value.toString(16).padStart(24, '0');

const attachSave = (object) => {
  object.save = async () => object;
  return object;
};

const createHarness = () => {
  const state = {
    users: [
      { _id: makeObjectId(1), username: 'alice', avatar: 'a', profession: 'p1', allianceId: '' },
      { _id: makeObjectId(2), username: 'bob', avatar: 'b', profession: 'p2', allianceId: '' },
      { _id: makeObjectId(3), username: 'carol', avatar: 'c', profession: 'p3', allianceId: '' }
    ],
    friendships: [],
    conversations: [],
    members: [],
    messages: [],
    notifications: [],
    nextConversationSeq: 10,
    nextMessageSeq: 100,
    nextFriendshipSeq: 200
  };

  const now = () => new Date();

  const socialRepo = {
    searchUsersByKeyword: async ({ excludeUserId, keywordRegex, limit }) => state.users
      .filter((item) => item._id !== excludeUserId && keywordRegex.test(item.username))
      .slice(0, limit),
    listFriendshipsByParticipantsKeys: async (keys) => state.friendships.filter((item) => keys.includes(item.participantsKey)),
    findAllianceNamesByIds: async () => [],
    findUserById: async (userId) => state.users.find((item) => item._id === userId) || null,
    findUsersByIds: async (ids) => {
      const set = new Set(ids);
      return state.users.filter((item) => set.has(item._id));
    },
    countAcceptedFriendshipsForUser: async (userId) => state.friendships.filter((item) => (
      item.status === 'accepted' && (item.requesterId === userId || item.addresseeId === userId)
    )).length,
    findFriendshipByParticipantsKey: async (participantsKey) => state.friendships.find((item) => item.participantsKey === participantsKey) || null,
    findAcceptedFriendshipByParticipantsKey: async (participantsKey) => state.friendships.find((item) => item.participantsKey === participantsKey && item.status === 'accepted') || null,
    findFriendshipById: async (friendshipId) => state.friendships.find((item) => item._id === friendshipId) || null,
    listPendingFriendshipsForUser: async ({ userId, direction }) => {
      const fieldName = direction === 'received' ? 'addresseeId' : 'requesterId';
      return state.friendships.filter((item) => item.status === 'pending' && item[fieldName] === userId);
    },
    listAcceptedFriendshipsForUser: async (userId) => state.friendships.filter((item) => (
      item.status === 'accepted' && (item.requesterId === userId || item.addresseeId === userId)
    )),
    createFriendship: async (doc) => {
      const friendship = attachSave({
        _id: makeObjectId(state.nextFriendshipSeq++),
        createdAt: now(),
        acceptedAt: null,
        respondedAt: null,
        ...doc
      });
      state.friendships.push(friendship);
      return friendship;
    }
  };

  const chatRepo = {
    listDirectConversationsByKeys: async (keys) => state.conversations.filter((item) => item.type === 'direct' && keys.includes(item.directKey)),
    findDirectConversationByKey: async (directKey) => state.conversations.find((item) => item.type === 'direct' && item.directKey === directKey) || null,
    createConversation: async (doc) => {
      const directExists = state.conversations.find((item) => item.type === 'direct' && item.directKey === doc.directKey);
      if (directExists) {
        const error = new Error('duplicate');
        error.code = 11000;
        throw error;
      }
      const conversation = attachSave({
        _id: makeObjectId(state.nextConversationSeq++),
        createdAt: now(),
        updatedAt: now(),
        messageSeq: 0,
        lastMessagePreview: '',
        lastMessageAt: null,
        isArchived: false,
        ...doc
      });
      state.conversations.push(conversation);
      return conversation;
    },
    findConversationById: async (conversationId) => state.conversations.find((item) => item._id === conversationId) || null,
    listConversationsByIds: async (ids) => {
      const set = new Set(ids.map(String));
      return state.conversations.filter((item) => set.has(item._id));
    },
    allocateNextConversationSeq: async (conversationId) => {
      const conversation = state.conversations.find((item) => item._id === conversationId);
      conversation.messageSeq += 1;
      return { _id: conversation._id, messageSeq: conversation.messageSeq };
    },
    updateConversationLastMessage: async ({ conversationId, messageId, preview, at }) => {
      const conversation = state.conversations.find((item) => item._id === conversationId);
      conversation.lastMessageId = messageId;
      conversation.lastMessagePreview = preview;
      conversation.lastMessageAt = at;
      conversation.updatedAt = at;
      return { acknowledged: true };
    },
    updateConversationMemberCount: async (conversationId, memberCount) => {
      const conversation = state.conversations.find((item) => item._id === conversationId);
      conversation.memberCount = memberCount;
      return { acknowledged: true };
    },
    ensureConversationMember: async ({ conversationId, userId, set = {}, setOnInsert = {} }) => {
      let member = state.members.find((item) => item.conversationId === conversationId && item.userId === userId);
      if (!member) {
        member = {
          _id: makeObjectId(state.nextConversationSeq++),
          conversationId,
          userId,
          role: 'member',
          mute: false,
          pinned: false,
          lastReadSeq: 0,
          unreadCount: 0,
          isVisible: true,
          deletedAt: null,
          clearedBeforeSeq: 0,
          clearedAt: null,
          joinedAt: now(),
          isActive: true,
          updatedAt: now(),
          ...setOnInsert
        };
        state.members.push(member);
      }
      Object.assign(member, set);
      member.updatedAt = set.updatedAt || member.updatedAt || now();
      return member;
    },
    findConversationMember: async ({ conversationId, userId, isActive = true }) => (
      state.members.find((item) => (
        item.conversationId === conversationId
        && item.userId === userId
        && (typeof isActive === 'boolean' ? item.isActive === isActive : true)
      )) || null
    ),
    listConversationMembersByConversationId: async (conversationId, { isActive = true } = {}) => state.members.filter((item) => (
      item.conversationId === conversationId && (typeof isActive === 'boolean' ? item.isActive === isActive : true)
    )),
    listConversationMembersByUser: async ({ userId, isActive = true, isVisible = null }) => state.members.filter((item) => (
      item.userId === userId
      && (typeof isActive === 'boolean' ? item.isActive === isActive : true)
      && (typeof isVisible === 'boolean' ? item.isVisible === isVisible : true)
    )),
    listConversationMembersByConversationIds: async ({ conversationIds, excludeUserId = null, isActive = true }) => {
      const set = new Set(conversationIds.map(String));
      return state.members.filter((item) => (
        set.has(item.conversationId)
        && (excludeUserId ? item.userId !== excludeUserId : true)
        && (typeof isActive === 'boolean' ? item.isActive === isActive : true)
      ));
    },
    updateConversationMember: async ({ conversationId, userId, update }) => {
      const member = state.members.find((item) => item.conversationId === conversationId && item.userId === userId);
      if (!member) return { matchedCount: 0 };
      if (update.$set) Object.assign(member, update.$set);
      if (update.$inc) {
        Object.entries(update.$inc).forEach(([key, value]) => {
          member[key] = (Number(member[key]) || 0) + value;
        });
      }
      return { matchedCount: 1 };
    },
    updateConversationMembers: async ({ conversationId, excludeUserId = null, update, isActive = true }) => {
      const targets = state.members.filter((item) => (
        item.conversationId === conversationId
        && (excludeUserId ? item.userId !== excludeUserId : true)
        && (typeof isActive === 'boolean' ? item.isActive === isActive : true)
      ));
      targets.forEach((member) => {
        if (update.$set) Object.assign(member, update.$set);
        if (update.$inc) {
          Object.entries(update.$inc).forEach(([key, value]) => {
            member[key] = (Number(member[key]) || 0) + value;
          });
        }
      });
      return { matchedCount: targets.length };
    },
    findMessageByClientMessageId: async ({ conversationId, senderId, clientMessageId }) => (
      state.messages.find((item) => item.conversationId === conversationId && item.senderId === senderId && item.clientMessageId === clientMessageId) || null
    ),
    createMessage: async (doc) => {
      const message = {
        _id: makeObjectId(state.nextMessageSeq++),
        createdAt: now(),
        updatedAt: now(),
        editedAt: null,
        recalledAt: null,
        ...doc
      };
      state.messages.push(message);
      return message;
    },
    listMessagesForConversationView: async ({ conversationId, clearedBeforeSeq = 0, beforeSeq = 0, limit = 30 }) => (
      state.messages
        .filter((item) => (
          item.conversationId === conversationId
          && item.seq > clearedBeforeSeq
          && (beforeSeq > 0 ? item.seq < beforeSeq : true)
        ))
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit)
    ),
    findLatestVisibleMessage: async ({ conversationId, clearedBeforeSeq = 0 }) => (
      state.messages
        .filter((item) => item.conversationId === conversationId && item.seq > clearedBeforeSeq)
        .sort((a, b) => b.seq - a.seq)[0] || null
    )
  };

  const notificationSender = async (userId, payload) => {
    state.notifications.push({ userId, ...payload });
    return payload;
  };

  return {
    state,
    socialService: createSocialService({ socialRepo, chatRepo, notificationSender }),
    chatService: createChatService({ socialRepo, chatRepo })
  };
};

test('好友申请通过后仅更新 Friendship，不自动创建 direct conversation', async () => {
  const { state, socialService } = createHarness();
  const aliceId = state.users[0]._id;
  const bobId = state.users[1]._id;

  const requestResult = await socialService.requestFriendship({
    requesterId: aliceId,
    targetUserId: bobId,
    message: 'hello'
  });
  await socialService.respondToFriendRequest({
    userId: bobId,
    friendshipId: requestResult.friendship.friendshipId,
    action: 'accept'
  });

  assert.equal(state.friendships[0].status, 'accepted');
  assert.equal(state.conversations.length, 0);
});

test('主动打开私聊会懒创建 direct conversation，并保证 directKey 幂等', async () => {
  const { state, socialService, chatService } = createHarness();
  const aliceId = state.users[0]._id;
  const bobId = state.users[1]._id;

  const request = await socialService.requestFriendship({ requesterId: aliceId, targetUserId: bobId, message: '' });
  await socialService.respondToFriendRequest({ userId: bobId, friendshipId: request.friendship.friendshipId, action: 'accept' });

  const first = await chatService.ensureDirectConversationForFriends({ requestUserId: aliceId, targetUserId: bobId });
  const second = await chatService.ensureDirectConversationForFriends({ requestUserId: aliceId, targetUserId: bobId });

  assert.equal(state.conversations.length, 1);
  assert.equal(first.conversation.conversationId, second.conversation.conversationId);
  assert.equal(state.conversations[0].directKey, buildUserPairKey(aliceId, bobId));
});

test('发送消息会推进 seq、更新摘要，并增加接收方未读', async () => {
  const { state, socialService, chatService } = createHarness();
  const aliceId = state.users[0]._id;
  const bobId = state.users[1]._id;

  const request = await socialService.requestFriendship({ requesterId: aliceId, targetUserId: bobId, message: '' });
  await socialService.respondToFriendRequest({ userId: bobId, friendshipId: request.friendship.friendshipId, action: 'accept' });
  const direct = await chatService.ensureDirectConversationForFriends({ requestUserId: aliceId, targetUserId: bobId });

  await chatService.sendMessage({
    userId: aliceId,
    conversationId: direct.conversation.conversationId,
    type: 'text',
    content: 'first message',
    clientMessageId: 'm1'
  });

  const conversation = state.conversations[0];
  const bobMember = state.members.find((item) => item.userId === bobId);
  assert.equal(conversation.messageSeq, 1);
  assert.equal(conversation.lastMessagePreview, 'first message');
  assert.equal(bobMember.unreadCount, 1);
  assert.equal(bobMember.isVisible, true);
});

test('单边删除会话只影响当前用户视图，不影响 Friendship/Conversation/Message/对方视图', async () => {
  const { state, socialService, chatService } = createHarness();
  const aliceId = state.users[0]._id;
  const bobId = state.users[1]._id;

  const request = await socialService.requestFriendship({ requesterId: aliceId, targetUserId: bobId, message: '' });
  await socialService.respondToFriendRequest({ userId: bobId, friendshipId: request.friendship.friendshipId, action: 'accept' });
  const direct = await chatService.ensureDirectConversationForFriends({ requestUserId: aliceId, targetUserId: bobId });
  await chatService.sendMessage({ userId: aliceId, conversationId: direct.conversation.conversationId, type: 'text', content: 'hello', clientMessageId: 'm1' });
  await chatService.ensureDirectConversationForFriends({ requestUserId: bobId, targetUserId: aliceId });

  const deleteResult = await chatService.hideConversationForUser({
    userId: bobId,
    conversationId: direct.conversation.conversationId
  });

  const bobMember = state.members.find((item) => item.userId === bobId);
  const aliceMember = state.members.find((item) => item.userId === aliceId);
  assert.equal(deleteResult.friendRelationUnaffected, true);
  assert.equal(state.friendships[0].status, 'accepted');
  assert.equal(state.conversations.length, 1);
  assert.equal(state.messages.length, 1);
  assert.equal(bobMember.isVisible, false);
  assert.equal(aliceMember.isVisible, true);
});

test('删除后重新打开聊天，只能看到 clearedBeforeSeq 之后的消息；若删除时已清到最新则历史为空', async () => {
  const { state, socialService, chatService } = createHarness();
  const aliceId = state.users[0]._id;
  const bobId = state.users[1]._id;

  const request = await socialService.requestFriendship({ requesterId: aliceId, targetUserId: bobId, message: '' });
  await socialService.respondToFriendRequest({ userId: bobId, friendshipId: request.friendship.friendshipId, action: 'accept' });
  const direct = await chatService.ensureDirectConversationForFriends({ requestUserId: aliceId, targetUserId: bobId });
  await chatService.sendMessage({ userId: aliceId, conversationId: direct.conversation.conversationId, type: 'text', content: 'old-msg', clientMessageId: 'm1' });
  await chatService.hideConversationForUser({ userId: bobId, conversationId: direct.conversation.conversationId });
  await chatService.ensureDirectConversationForFriends({ requestUserId: bobId, targetUserId: aliceId });

  const result = await chatService.listMessagesForUserView({
    userId: bobId,
    conversationId: direct.conversation.conversationId,
    limit: 30
  });

  assert.equal(result.rows.length, 0);
  assert.equal(state.members.find((item) => item.userId === bobId).isVisible, true);
});

test('删除后对方发来新消息，会话重新可见且只能看到删除边界之后的新消息', async () => {
  const { state, socialService, chatService } = createHarness();
  const aliceId = state.users[0]._id;
  const bobId = state.users[1]._id;

  const request = await socialService.requestFriendship({ requesterId: aliceId, targetUserId: bobId, message: '' });
  await socialService.respondToFriendRequest({ userId: bobId, friendshipId: request.friendship.friendshipId, action: 'accept' });
  const direct = await chatService.ensureDirectConversationForFriends({ requestUserId: aliceId, targetUserId: bobId });
  await chatService.ensureDirectConversationForFriends({ requestUserId: bobId, targetUserId: aliceId });
  await chatService.sendMessage({ userId: aliceId, conversationId: direct.conversation.conversationId, type: 'text', content: 'old-1', clientMessageId: 'm1' });
  await chatService.hideConversationForUser({ userId: bobId, conversationId: direct.conversation.conversationId });

  await chatService.sendMessage({ userId: aliceId, conversationId: direct.conversation.conversationId, type: 'text', content: 'new-1', clientMessageId: 'm2' });

  const bobVisibleRows = await chatService.listVisibleConversationsForUser({ userId: bobId });
  const bobMessages = await chatService.listMessagesForUserView({
    userId: bobId,
    conversationId: direct.conversation.conversationId,
    limit: 30
  });
  const bobMember = state.members.find((item) => item.userId === bobId);

  assert.equal(bobVisibleRows.rows.length, 1);
  assert.equal(bobVisibleRows.rows[0].lastMessagePreview, 'new-1');
  assert.equal(bobMessages.rows.length, 1);
  assert.equal(bobMessages.rows[0].content, 'new-1');
  assert.equal(bobMember.isVisible, true);
  assert.equal(bobMember.unreadCount, 1);
});

test('好友列表不强依赖 conversationId，没有现成会话时也能正常返回', async () => {
  const { state, socialService } = createHarness();
  const aliceId = state.users[0]._id;
  const bobId = state.users[1]._id;

  const request = await socialService.requestFriendship({ requesterId: aliceId, targetUserId: bobId, message: '' });
  await socialService.respondToFriendRequest({ userId: bobId, friendshipId: request.friendship.friendshipId, action: 'accept' });

  const result = await socialService.listFriends({ userId: aliceId });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].hasConversation, false);
  assert.equal(result.rows[0].conversationId, null);
});
