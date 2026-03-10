const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const connectDB = require('./config/database');
const authRoutes = require('./routes/auth');
const User = require('./models/User');
const Node = require('./models/Node');
const Army = require('./models/Army');
const Technology = require('./models/Technology');
const GameService = require('./services/GameService');
const KnowledgeDistributionService = require('./services/KnowledgeDistributionService');
const schedulerService = require('./services/schedulerService');
const { processExpiredDomainAdminResignRequests } = require('./services/domainAdminResignService');
const adminRoutes = require('./routes/admin');
const nodeRoutes = require('./routes/nodes');
const allianceRoutes = require('./routes/alliance');
const armyRoutes = require('./routes/army');
const senseRoutes = require('./routes/senses');
const senseArticleRoutes = require('./routes/senseArticles');
const usersRoutes = require('./routes/users');
// 初始化Express
const app = express();
const server = http.createServer(app);
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';

const parseOriginList = (...inputs) => {
  const merged = inputs
    .filter((item) => typeof item === 'string')
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(merged));
  return unique.length > 0 ? unique : [DEFAULT_FRONTEND_ORIGIN];
};

const isOriginAllowed = (origin, allowList = []) => {
  if (!origin) return true;
  if (allowList.includes('*')) return true;
  return allowList.includes(origin);
};

const createCorsOriginValidator = (allowList = []) => (origin, callback) => {
  if (isOriginAllowed(origin, allowList)) {
    callback(null, true);
    return;
  }
  callback(new Error(`CORS origin not allowed: ${origin}`));
};

const corsOrigins = parseOriginList(
  process.env.CORS_ORIGINS,
  process.env.FRONTEND_ORIGIN,
  DEFAULT_FRONTEND_ORIGIN
);
const socketCorsOrigins = parseOriginList(
  process.env.SOCKET_CORS_ORIGINS,
  process.env.CORS_ORIGINS,
  process.env.FRONTEND_ORIGIN,
  DEFAULT_FRONTEND_ORIGIN
);

// 初始化Socket.IO
const io = socketIo(server, {
  cors: {
    origin: createCorsOriginValidator(socketCorsOrigins),
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // 添加这行
  allowEIO3: true, // 添加这行，兼容旧版本
  pingTimeout: 60000, // 添加这行
  pingInterval: 25000 // 添加这行
});

// 中间件
app.use(cors({
  origin: createCorsOriginValidator(corsOrigins),
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/alliances', allianceRoutes);
app.use('/api/army', armyRoutes);
app.use('/api/senses', senseRoutes);
app.use('/api/sense-articles', senseArticleRoutes);
app.use('/api/users', usersRoutes);

// 错误处理中间件 - 必须放在所有路由之后
app.use((err, req, res, next) => {
  // 处理 413 Payload Too Large 错误
  if (err.status === 413 || err.type === 'entity.too.large') {
    console.error('Payload too large error:', {
      path: req.path,
      method: req.method,
      contentLength: req.get('content-length'),
      errorType: err.type
    });
    return res.status(413).json({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body too large',
      limit: '10mb'
    });
  }

  // 其他错误继续传递
  next(err);
});

// 连接数据库
connectDB();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ENABLE_LEGACY_SOCKET_HANDLERS = process.env.ENABLE_LEGACY_SOCKET_HANDLERS === 'true';
const ENABLE_LEGACY_RESOURCE_TICK = process.env.ENABLE_LEGACY_RESOURCE_TICK === 'true';
const ENABLE_LEGACY_KNOWLEDGEPOINT_TICKS = process.env.ENABLE_LEGACY_KNOWLEDGEPOINT_TICKS === 'true';
const ENABLE_LEGACY_ADMIN_RESIGN_TICK = process.env.ENABLE_LEGACY_ADMIN_RESIGN_TICK === 'true';
const ENABLE_LEGACY_DISTRIBUTION_TICK = process.env.ENABLE_LEGACY_DISTRIBUTION_TICK === 'true';
const ENABLE_SCHEDULED_TASK_ENQUEUE = process.env.ENABLE_SCHEDULED_TASK_ENQUEUE !== 'false';
const ENABLE_MAINTENANCE_CLEANUP = process.env.ENABLE_MAINTENANCE_CLEANUP !== 'false';
const MAINTENANCE_CLEANUP_HOUR = Math.max(0, Math.min(23, parseInt(process.env.MAINTENANCE_CLEANUP_HOUR, 10) || 3));
const MAINTENANCE_CLEANUP_MINUTE = Math.max(0, Math.min(59, parseInt(process.env.MAINTENANCE_CLEANUP_MINUTE, 10) || 30));
const SCHEDULED_TASK_ENQUEUE_INTERVAL_MS = Math.max(
  10 * 1000,
  parseInt(process.env.SCHEDULED_TASK_ENQUEUE_INTERVAL_MS, 10) || 60 * 1000
);

const getTaskMinuteBucket = (date = new Date()) => {
  const safeDate = date instanceof Date ? date : new Date(date);
  return safeDate.toISOString().slice(0, 16);
};

const pad2 = (value) => String(value).padStart(2, '0');
const getLocalDateBucket = (date = new Date()) => {
  const safeDate = date instanceof Date ? date : new Date(date);
  return `${safeDate.getFullYear()}-${pad2(safeDate.getMonth() + 1)}-${pad2(safeDate.getDate())}`;
};

const shouldEnqueueMaintenanceCleanup = (date = new Date()) => {
  const safeDate = date instanceof Date ? date : new Date(date);
  const scheduledAt = new Date(safeDate);
  scheduledAt.setHours(MAINTENANCE_CLEANUP_HOUR, MAINTENANCE_CLEANUP_MINUTE, 0, 0);
  return safeDate.getTime() >= scheduledAt.getTime();
};

const enqueueCoreScheduledTasks = async (baseTime = new Date()) => {
  const runAt = baseTime instanceof Date ? baseTime : new Date(baseTime);
  const minuteBucket = getTaskMinuteBucket(runAt);
  const enqueueTasks = [
    schedulerService.enqueue({
      type: 'domain_admin_resign_timeout_tick',
      runAt,
      payload: {},
      dedupeKey: `domain_admin_resign_timeout_tick:${minuteBucket}`
    }),
    schedulerService.enqueue({
      type: 'knowledge_distribution_tick',
      runAt,
      payload: {},
      dedupeKey: `knowledge_distribution_tick:${minuteBucket}`
    })
  ];

  if (ENABLE_MAINTENANCE_CLEANUP && shouldEnqueueMaintenanceCleanup(runAt)) {
    const dateBucket = getLocalDateBucket(runAt);
    enqueueTasks.push(
      schedulerService.enqueue({
        type: 'maintenance_cleanup_tick',
        runAt,
        payload: {
          dateBucket
        },
        dedupeKey: `maintenance_cleanup:${dateBucket}`
      })
    );
  }

  await Promise.all(enqueueTasks);
};

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// WebSocket连接处理
io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  if (!ENABLE_LEGACY_SOCKET_HANDLERS) {
    socket.emit('server-mode', {
      legacySocketHandlers: false
    });
    return;
  }
  
  socket.on('disconnect', (reason) => {
    console.log('用户断开连接:', socket.id, '原因:', reason);
  });
  
  socket.on('error', (error) => {
    console.error('Socket 错误:', error);
  });

  // 用户认证
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      const user = await User.findById(decoded.userId).select('role');
      socket.userRole = user?.role || 'common';

      if (socket.userRole === 'admin') {
        socket.join('admin-room');
        io.to('admin-room').emit('admin-sync-pending', {
          triggeredBy: decoded.userId,
          timestamp: new Date().toISOString()
        });
      }

      socket.emit('authenticated', {
        userId: decoded.userId,
        role: socket.userRole
      });
      console.log(`用户认证成功: ${decoded.userId}`);
    } catch (error) {
      socket.emit('auth_error', { error: '认证失败' });
      console.error('认证错误:', error.message);
    }
  });

  // 创建节点
  socket.on('createNode', async (data) => {
    try {
      if (!socket.userId) {
        return socket.emit('error', { message: '未认证' });
      }

      const nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const node = new Node({
        nodeId,
        owner: socket.userId,
        name: data.name || '新节点',
        position: data.position
      });

      await node.save();

      await User.findByIdAndUpdate(socket.userId, {
        $push: { ownedNodes: node._id }
      });

      const populatedNode = await Node.findById(node._id).populate('owner', 'username');

      io.emit('nodeCreated', populatedNode);
      socket.emit('createNodeSuccess', populatedNode);
      
      console.log(`节点创建成功: ${nodeId}`);
    } catch (error) {
      console.error('创建节点错误:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 连接节点
  socket.on('connectNodes', async (data) => {
    try {
      const { nodeId1, nodeId2 } = data;

      const node1 = await Node.findOne({ nodeId: nodeId1 });
      const node2 = await Node.findOne({ nodeId: nodeId2 });

      if (!node1 || !node2) {
        return socket.emit('error', { message: '节点不存在' });
      }

      await Node.findByIdAndUpdate(node1._id, {
        $addToSet: { connectedNodes: node2._id }
      });

      await Node.findByIdAndUpdate(node2._id, {
        $addToSet: { connectedNodes: node1._id }
      });

      io.emit('nodesConnected', { nodeId1, nodeId2 });
      console.log(`节点连接成功: ${nodeId1} <-> ${nodeId2}`);
    } catch (error) {
      console.error('连接节点错误:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 生产军队
  socket.on('produceArmy', async (data) => {
    try {
      const { nodeId, type, count } = data;
      
      if (!socket.userId) {
        return socket.emit('error', { message: '未认证' });
      }

      const node = await Node.findOne({ nodeId });

      if (!node) {
        return socket.emit('error', { message: '节点不存在' });
      }

      if (node.owner.toString() !== socket.userId) {
        return socket.emit('error', { message: '无权操作此节点' });
      }

      // 获取军队属性和成本
      const armyData = GameService.getArmyStats(type, 1);
      const totalCost = {
        food: armyData.cost.food * count,
        metal: armyData.cost.metal * count,
        energy: armyData.cost.energy * count
      };

      // 检查资源
      if (!GameService.hasEnoughResources(node, totalCost)) {
        return socket.emit('error', { message: '资源不足' });
      }

      // 扣除资源
      await GameService.deductResources(node, totalCost);

      // 创建或更新军队
      let army = await Army.findOne({ nodeId: node._id, type });

      if (army) {
        army.count += count;
        await army.save();
      } else {
        army = new Army({
          nodeId: node._id,
          type,
          count,
          level: 1,
          attack: armyData.attack,
          defense: armyData.defense,
          speed: armyData.speed
        });
        await army.save();
      }

      io.emit('armyProduced', { nodeId, type, count, army });
      console.log(`军队生产成功: ${type} x${count} at ${nodeId}`);
    } catch (error) {
      console.error('生产军队错误:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 升级科技
  socket.on('upgradeTech', async (data) => {
    try {
      if (!socket.userId) {
        return socket.emit('error', { message: '未认证' });
      }

      const { techId } = data;
      const tech = await GameService.upgradeTechnology(socket.userId, techId);
      
      socket.emit('techUpgraded', tech);
      io.emit('playerTechUpdate', { userId: socket.userId, tech });
      
      console.log(`科技升级成功: ${techId} for user ${socket.userId}`);
    } catch (error) {
      console.error('升级科技错误:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 获取游戏状态
  socket.on('getGameState', async () => {
    try {
      const nodes = await Node.find().populate('owner', 'username');
      const armies = await Army.find();
      const technologies = socket.userId 
        ? await Technology.find({ userId: socket.userId })
        : [];
      
      socket.emit('gameState', { nodes, armies, technologies });
    } catch (error) {
      console.error('获取游戏状态错误:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
  });
});

if (ENABLE_LEGACY_RESOURCE_TICK) {
  // 定时任务：资源生产（旧模式）
  setInterval(async () => {
    try {
      const nodes = await Node.find();
      for (const node of nodes) {
        await GameService.produceResources(node);
      }
      io.emit('resourcesUpdated');
    } catch (error) {
      console.error('资源生产错误:', error);
    }
  }, 60000); // 每分钟执行一次
}

if (ENABLE_LEGACY_KNOWLEDGEPOINT_TICKS) {
  // 定时任务：知识点更新（旧模式）
  setInterval(async () => {
    try {
      await GameService.updateKnowledgePoints();
    } catch (error) {
      console.error('知识点更新错误:', error);
    }
  }, 60000); // 每分钟执行一次

  // 定时任务：每秒更新节点知识点并广播（旧模式）
  setInterval(async () => {
    try {
      const updatedNodes = await GameService.updateAllNodesPerSecond();
      if (updatedNodes) {
        io.emit('knowledgePointUpdated', updatedNodes);
      }
    } catch (error) {
      console.error('每秒更新知识点错误:', error);
    }
  }, 1000);
}

if (ENABLE_LEGACY_ADMIN_RESIGN_TICK) {
  // 旧模式：自动处理超时的管理员卸任申请（默认关闭）
  setInterval(async () => {
    try {
      await processExpiredDomainAdminResignRequests();
    } catch (error) {
      console.error('自动处理卸任申请错误:', error);
    }
  }, 60 * 1000);
}

if (ENABLE_LEGACY_DISTRIBUTION_TICK) {
  // 旧模式：知识点分发公告与执行（默认关闭）
  setInterval(async () => {
    try {
      await KnowledgeDistributionService.processTick();
    } catch (error) {
      console.error('知识点分发调度错误:', error);
    }
  }, 60 * 1000);
}

if (!ENABLE_LEGACY_ADMIN_RESIGN_TICK && !ENABLE_LEGACY_DISTRIBUTION_TICK && ENABLE_SCHEDULED_TASK_ENQUEUE) {
  // 新模式：API 进程仅负责 enqueue，真正执行由 worker 处理
  const enqueueWithLog = async () => {
    try {
      await enqueueCoreScheduledTasks(new Date());
    } catch (error) {
      console.error('ScheduledTask enqueue 错误:', error);
    }
  };
  enqueueWithLog();
  setInterval(enqueueWithLog, SCHEDULED_TASK_ENQUEUE_INTERVAL_MS);
}

// 启动服务��
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`HTTP CORS 来源: ${corsOrigins.join(', ')}`);
  console.log(`Socket CORS 来源: ${socketCorsOrigins.join(', ')}`);
  console.log(`========================================`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
