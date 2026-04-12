const test = require('node:test');
const assert = require('node:assert/strict');

const chatRepo = require('../repositories/chatRepository');
const ChatSequence = require('../models/ChatSequence');
const { GROUP_NO_SEQUENCE_START } = require('../constants/socialChat');

const makeLeanQuery = (value) => ({
  lean: async () => value
});

test('allocateNextGroupNo 在序列表不存在时会初始化后再分配', async () => {
  const originalFindOneAndUpdate = ChatSequence.findOneAndUpdate;
  const originalCreate = ChatSequence.create;
  let callCount = 0;

  ChatSequence.findOneAndUpdate = (...args) => {
    callCount += 1;
    if (callCount === 1) {
      return makeLeanQuery(null);
    }
    assert.equal(args[0]?.key, 'chat:group-no');
    assert.deepEqual(args[1], { $inc: { value: 1 } });
    return makeLeanQuery({ key: 'chat:group-no', value: GROUP_NO_SEQUENCE_START + 1 });
  };
  ChatSequence.create = async (doc) => {
    assert.deepEqual(doc, {
      key: 'chat:group-no',
      value: GROUP_NO_SEQUENCE_START
    });
    return doc;
  };

  try {
    const value = await chatRepo.allocateNextGroupNo();
    assert.equal(value, GROUP_NO_SEQUENCE_START + 1);
    assert.equal(callCount, 2);
  } finally {
    ChatSequence.findOneAndUpdate = originalFindOneAndUpdate;
    ChatSequence.create = originalCreate;
  }
});

test('allocateNextGroupNo 在并发初始化冲突时会重试分配', async () => {
  const originalFindOneAndUpdate = ChatSequence.findOneAndUpdate;
  const originalCreate = ChatSequence.create;
  let callCount = 0;

  ChatSequence.findOneAndUpdate = () => {
    callCount += 1;
    if (callCount === 1) {
      return makeLeanQuery(null);
    }
    return makeLeanQuery({ key: 'chat:group-no', value: GROUP_NO_SEQUENCE_START + 3 });
  };
  ChatSequence.create = async () => {
    const error = new Error('duplicate key');
    error.code = 11000;
    throw error;
  };

  try {
    const value = await chatRepo.allocateNextGroupNo();
    assert.equal(value, GROUP_NO_SEQUENCE_START + 3);
    assert.equal(callCount, 2);
  } finally {
    ChatSequence.findOneAndUpdate = originalFindOneAndUpdate;
    ChatSequence.create = originalCreate;
  }
});
