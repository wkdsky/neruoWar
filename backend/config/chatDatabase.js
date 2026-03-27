const mongoose = require('mongoose');

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/strategy-game';
const DEFAULT_CHAT_DB_NAME = 'strategy-game-chat';
const VALID_CHAT_DB_MODES = new Set(['shared', 'split']);

let chatConnection = null;
let chatConnectionPromise = null;
let resolvedConfigCache = null;

const getBaseMongoOptions = () => ({
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10) || 80,
  minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE, 10) || 10,
  serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10) || 5000,
  socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 10) || 45000,
  maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME_MS, 10) || 30000
});

const resolvePrimaryMongoUri = () => process.env.MONGODB_URI || DEFAULT_MONGODB_URI;

const maskMongoUri = (uri = '') => {
  const text = String(uri || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    const hasCredentials = parsed.username || parsed.password;
    if (hasCredentials) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return parsed.toString();
  } catch (_error) {
    return text.replace(/\/\/([^@/]+)@/, '//***:***@');
  }
};

const readEnvText = (key) => {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : '';
};

const resolveChatDbConfig = () => {
  if (resolvedConfigCache) return resolvedConfigCache;

  const primaryUri = resolvePrimaryMongoUri();
  const legacyChatUri = readEnvText('CHAT_MONGODB_URI');
  const configuredMode = readEnvText('CHAT_DB_MODE').toLowerCase();
  const configuredDbName = readEnvText('CHAT_DB_NAME') || DEFAULT_CHAT_DB_NAME;

  let mode = configuredMode;
  let deprecationWarning = '';

  if (!mode) {
    if (legacyChatUri) {
      mode = 'split';
      deprecationWarning = '检测到旧配置 CHAT_MONGODB_URI 但未设置 CHAT_DB_MODE；当前按 split 兼容，后续请显式设置 CHAT_DB_MODE。';
    } else {
      mode = 'shared';
    }
  }

  if (!VALID_CHAT_DB_MODES.has(mode)) {
    throw new Error(`无效的 CHAT_DB_MODE: ${configuredMode || '(empty)'}`);
  }

  const config = {
    mode,
    deprecationWarning,
    primaryUri,
    dbName: mode === 'split' ? configuredDbName : '',
    uri: mode === 'split' ? (legacyChatUri || primaryUri) : primaryUri,
    usesDedicatedUri: mode === 'split' && Boolean(legacyChatUri),
    usesPrimaryConnection: mode === 'shared',
    logUri: maskMongoUri(mode === 'split' ? (legacyChatUri || primaryUri) : primaryUri)
  };

  resolvedConfigCache = config;
  return config;
};

const getChatConnection = () => {
  const config = resolveChatDbConfig();

  if (config.mode === 'shared') {
    return mongoose.connection;
  }

  if (!chatConnection) {
    if (config.usesDedicatedUri) {
      chatConnection = mongoose.createConnection(config.uri, {
        ...getBaseMongoOptions(),
        dbName: config.dbName
      });
    } else {
      chatConnection = mongoose.connection.useDb(config.dbName, { useCache: true });
    }
  }

  return chatConnection;
};

const connectChatDB = async () => {
  const config = resolveChatDbConfig();
  if (config.deprecationWarning) {
    console.warn(`[chat-db] ${config.deprecationWarning}`);
  }

  if (config.mode === 'shared') {
    console.log(`[chat-db] mode=shared uri=${config.logUri || '(same as primary)'} db=(same-as-primary)`);
    return mongoose.connection;
  }

  if (chatConnection?.readyState === 1) {
    console.log(`[chat-db] mode=split uri=${config.logUri} db=${config.dbName}`);
    return chatConnection;
  }

  if (!chatConnectionPromise) {
    const connection = getChatConnection();
    console.log(`[chat-db] mode=split uri=${config.logUri} db=${config.dbName}${config.usesDedicatedUri ? '' : ' via primary cluster'}`);
    chatConnectionPromise = connection.asPromise().catch((error) => {
      chatConnectionPromise = null;
      console.error(`[chat-db] connection error: ${error.message}`);
      throw error;
    });
  }

  return chatConnectionPromise;
};

const createChatModel = (name, schema) => {
  const config = resolveChatDbConfig();
  if (config.mode === 'shared') {
    return mongoose.models[name] || mongoose.model(name, schema);
  }

  const connection = getChatConnection();
  return connection.models[name] || connection.model(name, schema);
};

module.exports = {
  connectChatDB,
  createChatModel,
  getChatConnection,
  maskMongoUri,
  resolveChatDbConfig
};
