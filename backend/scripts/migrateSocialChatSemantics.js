require('dotenv').config();

const connectDB = require('../config/database');
const { connectChatDB } = require('../config/chatDatabase');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');

const run = async () => {
  await connectDB();
  await connectChatDB();

  const steps = [];

  steps.push(await ConversationMember.updateMany(
    { isVisible: { $exists: false } },
    { $set: { isVisible: true } }
  ));
  steps.push(await ConversationMember.updateMany(
    { deletedAt: { $exists: false } },
    { $set: { deletedAt: null } }
  ));
  steps.push(await ConversationMember.updateMany(
    { clearedBeforeSeq: { $exists: false } },
    { $set: { clearedBeforeSeq: 0 } }
  ));
  steps.push(await ConversationMember.updateMany(
    { clearedAt: { $exists: false } },
    { $set: { clearedAt: null } }
  ));

  const conversationRows = await Conversation.find({})
    .select('_id')
    .lean();

  let updatedConversationCount = 0;
  for (const row of conversationRows) {
    const memberCount = await ConversationMember.countDocuments({
      conversationId: row._id,
      isActive: true
    });
    await Conversation.updateOne(
      { _id: row._id },
      { $set: { memberCount } }
    );
    updatedConversationCount += 1;
  }

  const summary = {
    memberFieldsBackfilled: steps.reduce((sum, item) => sum + (Number(item?.modifiedCount) || 0), 0),
    conversationsUpdated: updatedConversationCount
  };

  console.log('[social-chat-migration] completed', summary);
  process.exit(0);
};

run().catch((error) => {
  console.error('[social-chat-migration] failed', error);
  process.exit(1);
});
