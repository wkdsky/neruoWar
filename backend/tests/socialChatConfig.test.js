const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG_KEYS = ['MONGODB_URI', 'CHAT_DB_MODE', 'CHAT_DB_NAME', 'CHAT_MONGODB_URI'];

const loadConfig = (env) => {
  const backup = {};
  CONFIG_KEYS.forEach((key) => {
    backup[key] = process.env[key];
    delete process.env[key];
  });
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });

  const modulePath = require.resolve('../config/chatDatabase');
  delete require.cache[modulePath];
  const loaded = require('../config/chatDatabase');
  const resolved = loaded.resolveChatDbConfig();

  CONFIG_KEYS.forEach((key) => {
    if (backup[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = backup[key];
    }
  });

  return resolved;
};

test('shared mode 使用主业务库作为 fallback', () => {
  const config = loadConfig({
    MONGODB_URI: 'mongodb://localhost:27017/strategy-game',
    CHAT_DB_MODE: 'shared'
  });

  assert.equal(config.mode, 'shared');
  assert.equal(config.uri, 'mongodb://localhost:27017/strategy-game');
});

test('split mode 支持同一集群独立 db name', () => {
  const config = loadConfig({
    MONGODB_URI: 'mongodb://localhost:27017/strategy-game',
    CHAT_DB_MODE: 'split',
    CHAT_DB_NAME: 'strategy-game-chat'
  });

  assert.equal(config.mode, 'split');
  assert.equal(config.uri, 'mongodb://localhost:27017/strategy-game');
  assert.equal(config.dbName, 'strategy-game-chat');
  assert.equal(config.usesDedicatedUri, false);
});

test('旧版仅配置 CHAT_MONGODB_URI 时按 split 兼容并给出 warning', () => {
  const config = loadConfig({
    MONGODB_URI: 'mongodb://localhost:27017/strategy-game',
    CHAT_MONGODB_URI: 'mongodb://localhost:27017/strategy-game-chat'
  });

  assert.equal(config.mode, 'split');
  assert.equal(config.usesDedicatedUri, true);
  assert.match(config.deprecationWarning, /CHAT_DB_MODE/);
});
