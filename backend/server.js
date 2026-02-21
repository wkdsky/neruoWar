const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const connectDB = require('./config/database');
const authRoutes = require('./routes/auth');
const User = require('./models/User');
const Node = require('./models/Node');
const Notification = require('./models/Notification');
const Army = require('./models/Army');
const Technology = require('./models/Technology');
const GameService = require('./services/GameService');
const KnowledgeDistributionService = require('./services/KnowledgeDistributionService');
const adminRoutes = require('./routes/admin');
const nodeRoutes = require('./routes/nodes');
const allianceRoutes = require('./routes/alliance');
const armyRoutes = require('./routes/army');
const senseRoutes = require('./routes/senses');
const {
  isNotificationCollectionReadEnabled,
  upsertNotificationsToCollection,
  writeNotificationsToCollection
} = require('./services/notificationStore');
// 初始化Express
const app = express();
const server = http.createServer(app);

// 初始化Socket.IO
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000"],
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
  origin: ["http://localhost:3000"],
  credentials: true
}));
app.use(express.json());

app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/alliances', allianceRoutes);
app.use('/api/army', armyRoutes);
app.use('/api/senses', senseRoutes);
// 连接数据库
connectDB();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const RESIGN_REQUEST_EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;
const ENABLE_LEGACY_SOCKET_HANDLERS = process.env.ENABLE_LEGACY_SOCKET_HANDLERS === 'true';
const ENABLE_LEGACY_RESOURCE_TICK = process.env.ENABLE_LEGACY_RESOURCE_TICK === 'true';
const ENABLE_LEGACY_KNOWLEDGEPOINT_TICKS = process.env.ENABLE_LEGACY_KNOWLEDGEPOINT_TICKS === 'true';

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

const toCollectionNotificationDoc = (userId, notification = {}) => {
  const source = typeof notification?.toObject === 'function' ? notification.toObject() : notification;
  return {
    ...source,
    _id: source?._id,
    userId
  };
};

const pushNotificationToUser = (user, payload = {}) => {
  if (!user) return null;
  const notification = {
    ...payload,
    _id: payload?._id && mongoose.Types.ObjectId.isValid(String(payload._id))
      ? new mongoose.Types.ObjectId(String(payload._id))
      : new mongoose.Types.ObjectId(),
    createdAt: payload?.createdAt ? new Date(payload.createdAt) : new Date()
  };
  user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
  user.notifications.unshift(notification);
  return notification;
};

const processExpiredDomainAdminResignRequests = async () => {
  const deadline = new Date(Date.now() - RESIGN_REQUEST_EXPIRE_MS);
  if (isNotificationCollectionReadEnabled()) {
    const expiredRows = await Notification.find({
      type: 'domain_admin_resign_request',
      status: 'pending',
      createdAt: { $lte: deadline }
    }).select('_id userId nodeId nodeName inviteeId').lean();

    for (const row of expiredRows) {
      const domainMasterId = getIdString(row?.userId);
      const requesterId = getIdString(row?.inviteeId);
      const nowDate = new Date();
      let node = null;
      let requester = null;

      if (isValidObjectId(getIdString(row?.nodeId))) {
        node = await Node.findById(row.nodeId).select('name status domainMaster domainAdmins');
      }
      if (isValidObjectId(requesterId)) {
        requester = await User.findById(requesterId).select('_id username');
      }

      if (
        node &&
        node.status === 'approved' &&
        getIdString(node.domainMaster) === domainMasterId
      ) {
        const before = (node.domainAdmins || []).length;
        node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requesterId);
        if (node.domainAdmins.length !== before) {
          await node.save();
        }
      }

      await Notification.updateOne(
        { _id: row._id, status: 'pending' },
        {
          $set: {
            status: 'accepted',
            read: true,
            respondedAt: nowDate
          }
        }
      );

      if (requester) {
        const requesterNotification = {
          _id: new mongoose.Types.ObjectId(),
          userId: requester._id,
          type: 'domain_admin_resign_result',
          title: `卸任申请结果：${row?.nodeName || node?.name || '知识域'}`,
          message: '你的卸任申请已超时自动同意',
          read: false,
          status: 'accepted',
          nodeId: node?._id || row?.nodeId || null,
          nodeName: node?.name || row?.nodeName || '',
          inviterId: row?.userId || null,
          inviterUsername: '',
          inviteeId: requester._id,
          inviteeUsername: requester.username || '',
          respondedAt: nowDate,
          createdAt: nowDate
        };
        await writeNotificationsToCollection([requesterNotification]);
      }
    }
    return;
  }

  const candidates = await User.find({
    notifications: {
      $elemMatch: {
        type: 'domain_admin_resign_request',
        status: 'pending',
        createdAt: { $lte: deadline }
      }
    }
  });

  for (const domainMaster of candidates) {
    let changed = false;
    const changedMasterNotificationDocs = [];

    for (const notification of domainMaster.notifications || []) {
      if (
        notification.type !== 'domain_admin_resign_request' ||
        notification.status !== 'pending' ||
        new Date(notification.createdAt || 0).getTime() > deadline.getTime()
      ) {
        continue;
      }

      const nodeId = getIdString(notification.nodeId);
      const requesterId = getIdString(notification.inviteeId);
      const nowDate = new Date();
      let node = null;
      let requester = null;

      if (nodeId) {
        node = await Node.findById(nodeId).select('name status domainMaster domainAdmins');
      }
      if (requesterId) {
        requester = await User.findById(requesterId);
      }

      if (node && node.status === 'approved' && getIdString(node.domainMaster) === getIdString(domainMaster._id)) {
        const before = (node.domainAdmins || []).length;
        node.domainAdmins = (node.domainAdmins || []).filter((adminId) => getIdString(adminId) !== requesterId);
        if (node.domainAdmins.length !== before) {
          await node.save();
        }
      }

      notification.status = 'accepted';
      notification.read = true;
      notification.respondedAt = nowDate;
      changed = true;
      changedMasterNotificationDocs.push(toCollectionNotificationDoc(domainMaster._id, notification));

      if (requester) {
        const requesterNotification = pushNotificationToUser(requester, {
          type: 'domain_admin_resign_result',
          title: `卸任申请结果：${notification.nodeName || node?.name || '知识域'}`,
          message: '你的卸任申请已超时自动同意',
          read: false,
          status: 'accepted',
          nodeId: node?._id || notification.nodeId || null,
          nodeName: node?.name || notification.nodeName || '',
          inviterId: domainMaster._id,
          inviterUsername: domainMaster.username,
          inviteeId: requester._id,
          inviteeUsername: requester.username,
          respondedAt: nowDate,
          createdAt: nowDate
        });
        await requester.save();
        await writeNotificationsToCollection([
          toCollectionNotificationDoc(requester._id, requesterNotification)
        ]);
      }
    }

    if (changed) {
      await domainMaster.save();
      if (changedMasterNotificationDocs.length > 0) {
        await upsertNotificationsToCollection(changedMasterNotificationDocs);
      }
    }
  }
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

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

// 定时任务：自动处理超时的管理员卸任申请（3天）
setInterval(async () => {
  try {
    await processExpiredDomainAdminResignRequests();
  } catch (error) {
    console.error('自动处理卸任申请错误:', error);
  }
}, 60 * 1000);

// 定时任务：知识点分发公告与执行
setInterval(async () => {
  try {
    await KnowledgeDistributionService.processTick();
  } catch (error) {
    console.error('知识点分发调度错误:', error);
  }
}, 60 * 1000);

// 启动服务��
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
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
