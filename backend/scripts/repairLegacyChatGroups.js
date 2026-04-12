const fs = require('fs');
const path = require('path');
const { randomInt } = require('crypto');
const dotenv = require('dotenv');

[
  process.env.BACKEND_ENV_FILE,
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env')
]
  .filter((item, index, array) => item && array.indexOf(item) === index)
  .some((envPath) => {
    if (!fs.existsSync(envPath)) {
      return false;
    }
    dotenv.config({ path: envPath });
    return true;
  });

const mongoose = require('mongoose');

const connectDB = require('../config/database');
const { connectChatDB } = require('../config/chatDatabase');
const chatRepo = require('../repositories/chatRepository');
const Conversation = require('../models/Conversation');
const {
  DEFAULT_GROUP_AVATAR,
  GROUP_NO_LENGTH
} = require('../constants/socialChat');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const GROUP_NO_RANDOM_MIN = 10 ** Math.max(0, GROUP_NO_LENGTH - 1);
const GROUP_NO_RANDOM_MAX = 10 ** GROUP_NO_LENGTH;
const MAX_GROUP_NO_GENERATION_ATTEMPTS = 12;

const formatGroupNo = (value) => {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new Error(`invalid group sequence value: ${value}`);
  }

  const groupNo = String(numericValue).padStart(GROUP_NO_LENGTH, '0');
  if (groupNo.length > GROUP_NO_LENGTH) {
    throw new Error(`group number exhausted: ${groupNo}`);
  }
  return groupNo;
};

const buildLegacyGroupQuery = () => ({
  type: 'group',
  $or: [
    { groupNo: { $exists: false } },
    { groupNo: '' },
    { avatar: { $exists: false } },
    { avatar: '' },
    { creatorId: { $exists: false } },
    { creatorId: null }
  ]
});

const allocateUniqueRandomGroupNo = async () => {
  for (let attempt = 0; attempt < MAX_GROUP_NO_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = formatGroupNo(randomInt(GROUP_NO_RANDOM_MIN, GROUP_NO_RANDOM_MAX));
    const existingConversation = await chatRepo.findGroupConversationByGroupNo(candidate, '_id');
    if (!existingConversation?._id) {
      return candidate;
    }
  }

  throw new Error('group number allocation failed');
};

const repairLegacyChatGroups = async () => {
  await connectDB();
  await connectChatDB();

  const legacyGroups = await Conversation.find(buildLegacyGroupQuery())
    .sort({ createdAt: 1, _id: 1 })
    .select('_id title ownerId creatorId avatar groupNo isArchived')
    .lean();

  const metrics = {
    scanned: legacyGroups.length,
    updated: 0,
    groupNoPatched: 0,
    avatarPatched: 0,
    creatorPatched: 0
  };

  for (const conversation of legacyGroups) {
    const updateSet = {};
    const currentGroupNo = String(conversation?.groupNo || '').trim();
    const currentAvatar = String(conversation?.avatar || '').trim();
    const ownerId = String(conversation?.ownerId || '').trim();
    const creatorId = String(conversation?.creatorId || '').trim();

    if (!currentAvatar) {
      updateSet.avatar = DEFAULT_GROUP_AVATAR;
      metrics.avatarPatched += 1;
    }
    if (!isValidObjectId(creatorId) && isValidObjectId(ownerId)) {
      updateSet.creatorId = ownerId;
      metrics.creatorPatched += 1;
    }

    if (Object.keys(updateSet).length === 0) {
      continue;
    }

    let patched = false;
    for (let attempt = 0; attempt < MAX_GROUP_NO_GENERATION_ATTEMPTS; attempt += 1) {
      const nextUpdateSet = {
        ...updateSet,
        ...(currentGroupNo ? {} : { groupNo: await allocateUniqueRandomGroupNo() }),
        updatedAt: new Date()
      };

      try {
        await Conversation.updateOne({ _id: conversation._id }, { $set: nextUpdateSet });
        metrics.updated += 1;

        if (nextUpdateSet.groupNo) {
          metrics.groupNoPatched += 1;
        }

        const patchedSummary = [
          nextUpdateSet.groupNo ? `groupNo=${nextUpdateSet.groupNo}` : '',
          nextUpdateSet.avatar ? `avatar=${nextUpdateSet.avatar}` : '',
          nextUpdateSet.creatorId ? `creatorId=${nextUpdateSet.creatorId}` : ''
        ].filter(Boolean).join(' ');
        console.log(`[repair-legacy-chat-groups] patched ${conversation.title || conversation._id} ${patchedSummary}`);
        patched = true;
        break;
      } catch (error) {
        if (!currentGroupNo && error?.code === 11000) {
          continue;
        }
        throw error;
      }
    }
    if (!patched) {
      throw new Error(`failed to patch legacy group ${conversation._id}`);
    }
  }

  console.log('[repair-legacy-chat-groups] done', {
    ...metrics
  });
};

repairLegacyChatGroups()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('[repair-legacy-chat-groups] failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
