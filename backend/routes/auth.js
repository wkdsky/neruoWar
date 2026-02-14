const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Node = require('../models/Node');
const GameSetting = require('../models/GameSetting');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const getOrCreateSettings = async () => GameSetting.findOneAndUpdate(
  { key: 'global' },
  { $setOnInsert: { travelUnitSeconds: 60 } },
  { new: true, upsert: true, setDefaultsOnInsert: true }
);

const TRAVEL_STATUS = {
  IDLE: 'idle',
  MOVING: 'moving',
  STOPPING: 'stopping'
};

const getTravelStatus = (travelState) => {
  if (!travelState) return TRAVEL_STATUS.IDLE;
  if (travelState.status) return travelState.status;
  return travelState.isTraveling ? TRAVEL_STATUS.MOVING : TRAVEL_STATUS.IDLE;
};

const resetTravelState = (user, unitDurationSeconds = 60) => {
  const safeDuration = Math.max(1, parseInt(unitDurationSeconds, 10) || 60);
  user.travelState = {
    status: TRAVEL_STATUS.IDLE,
    isTraveling: false,
    path: [],
    startedAt: null,
    unitDurationSeconds: safeDuration,
    targetNodeId: null,
    stoppingNearestNodeId: null,
    stoppingNearestNodeName: '',
    stopStartedAt: null,
    stopDurationSeconds: 0,
    stopFromNode: null,
    queuedTargetNodeId: null,
    queuedTargetNodeName: ''
  };
};

const calculateMovingProgress = (user, now = new Date()) => {
  const travel = user.travelState || {};
  const status = getTravelStatus(travel);
  const path = Array.isArray(travel.path) ? travel.path : [];
  const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);

  if (status !== TRAVEL_STATUS.MOVING || !travel.startedAt || path.length < 2) {
    return {
      status: TRAVEL_STATUS.IDLE,
      isTraveling: false,
      isStopping: false,
      path: [],
      unitDurationSeconds
    };
  }

  const totalSegments = path.length - 1;
  const segmentDurationMs = unitDurationSeconds * 1000;
  const totalDurationMs = totalSegments * segmentDurationMs;
  const elapsedMs = Math.max(0, now.getTime() - new Date(travel.startedAt).getTime());

  if (elapsedMs >= totalDurationMs) {
    return {
      status: TRAVEL_STATUS.MOVING,
      isTraveling: false,
      isStopping: false,
      arrived: true,
      path,
      unitDurationSeconds,
      arrivedNode: path[path.length - 1]
    };
  }

  const completedSegments = Math.floor(elapsedMs / segmentDurationMs);
  const progressInCurrentSegment = (elapsedMs - completedSegments * segmentDurationMs) / segmentDurationMs;
  const completedDistanceUnits = elapsedMs / segmentDurationMs;
  const remainingDistanceUnits = Math.max(0, totalSegments - completedDistanceUnits);

  return {
    status: TRAVEL_STATUS.MOVING,
    isTraveling: true,
    isStopping: false,
    path,
    unitDurationSeconds,
    totalDistanceUnits: totalSegments,
    completedDistanceUnits,
    remainingDistanceUnits,
    elapsedSeconds: elapsedMs / 1000,
    remainingSeconds: Math.max(0, (totalDurationMs - elapsedMs) / 1000),
    progressInCurrentSegment,
    currentSegmentIndex: completedSegments,
    lastReachedNode: path[completedSegments],
    nextNode: path[completedSegments + 1],
    targetNode: path[path.length - 1]
  };
};

const calculateStoppingProgress = (user, now = new Date()) => {
  const travel = user.travelState || {};
  const status = getTravelStatus(travel);
  const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);

  if (
    status !== TRAVEL_STATUS.STOPPING ||
    !travel.stopStartedAt ||
    !travel.stoppingNearestNodeId ||
    !travel.stoppingNearestNodeName
  ) {
    return {
      status: TRAVEL_STATUS.IDLE,
      isTraveling: false,
      isStopping: false,
      unitDurationSeconds
    };
  }

  const stopDurationSeconds = Math.max(0, Number(travel.stopDurationSeconds) || 0);
  const elapsedMs = Math.max(0, now.getTime() - new Date(travel.stopStartedAt).getTime());
  const totalDurationMs = stopDurationSeconds * 1000;

  const stoppingNearestNode = {
    nodeId: travel.stoppingNearestNodeId,
    nodeName: travel.stoppingNearestNodeName
  };
  const stopFromNode = travel.stopFromNode || null;
  const queuedTargetNode = travel.queuedTargetNodeId
    ? {
        nodeId: travel.queuedTargetNodeId,
        nodeName: travel.queuedTargetNodeName || ''
      }
    : null;

  if (totalDurationMs === 0 || elapsedMs >= totalDurationMs) {
    return {
      status: TRAVEL_STATUS.STOPPING,
      isTraveling: false,
      isStopping: true,
      arrived: true,
      unitDurationSeconds,
      stopDurationSeconds,
      elapsedSeconds: stopDurationSeconds,
      remainingSeconds: 0,
      progressInCurrentSegment: 1,
      stoppingNearestNode,
      stopFromNode,
      queuedTargetNode,
      targetNode: stoppingNearestNode,
      nextNode: stoppingNearestNode,
      lastReachedNode: stopFromNode || stoppingNearestNode
    };
  }

  const progress = elapsedMs / totalDurationMs;

  return {
    status: TRAVEL_STATUS.STOPPING,
    isTraveling: true,
    isStopping: true,
    unitDurationSeconds,
    stopDurationSeconds,
    elapsedSeconds: elapsedMs / 1000,
    remainingSeconds: Math.max(0, (totalDurationMs - elapsedMs) / 1000),
    progressInCurrentSegment: progress,
    stoppingNearestNode,
    stopFromNode,
    queuedTargetNode,
    targetNode: stoppingNearestNode,
    nextNode: stoppingNearestNode,
    lastReachedNode: stopFromNode || stoppingNearestNode,
    totalDistanceUnits: 1,
    completedDistanceUnits: progress,
    remainingDistanceUnits: Math.max(0, 1 - progress)
  };
};

const calculateTravelProgress = (user, now = new Date()) => {
  const status = getTravelStatus(user.travelState || {});
  if (status === TRAVEL_STATUS.STOPPING) {
    return calculateStoppingProgress(user, now);
  }
  if (status === TRAVEL_STATUS.MOVING) {
    return calculateMovingProgress(user, now);
  }
  return {
    status: TRAVEL_STATUS.IDLE,
    isTraveling: false,
    isStopping: false
  };
};

const toTravelResponse = (progress) => {
  if (!progress.isTraveling) {
    return {
      isTraveling: false,
      isStopping: false,
      status: progress.status || TRAVEL_STATUS.IDLE
    };
  }

  return {
    isTraveling: true,
    isStopping: !!progress.isStopping,
    status: progress.status || TRAVEL_STATUS.MOVING,
    unitDurationSeconds: progress.unitDurationSeconds,
    totalDistanceUnits: progress.totalDistanceUnits,
    completedDistanceUnits: parseFloat(progress.completedDistanceUnits.toFixed(3)),
    remainingDistanceUnits: parseFloat(progress.remainingDistanceUnits.toFixed(3)),
    elapsedSeconds: parseFloat(progress.elapsedSeconds.toFixed(2)),
    remainingSeconds: parseFloat(progress.remainingSeconds.toFixed(2)),
    progressInCurrentSegment: parseFloat(progress.progressInCurrentSegment.toFixed(4)),
    currentSegmentIndex: progress.currentSegmentIndex,
    lastReachedNode: progress.lastReachedNode,
    nextNode: progress.nextNode,
    targetNode: progress.targetNode,
    path: progress.path,
    stopDurationSeconds: progress.stopDurationSeconds,
    stoppingNearestNode: progress.stoppingNearestNode,
    stopFromNode: progress.stopFromNode,
    queuedTargetNode: progress.queuedTargetNode
  };
};

const buildNodeGraph = (nodes) => {
  const nameToId = new Map();
  const idToNode = new Map();
  const adjacency = new Map();

  nodes.forEach((node) => {
    const id = node._id.toString();
    nameToId.set(node.name, id);
    idToNode.set(id, node);
    adjacency.set(id, new Set());
  });

  const link = (a, b) => {
    if (!a || !b || a === b) return;
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  };

  nodes.forEach((node) => {
    const nodeId = node._id.toString();
    (node.relatedParentDomains || []).forEach((parentName) => {
      link(nodeId, nameToId.get(parentName));
    });
    (node.relatedChildDomains || []).forEach((childName) => {
      link(nodeId, nameToId.get(childName));
    });
  });

  return { nameToId, idToNode, adjacency };
};

const bfsShortestPath = (startId, targetId, adjacency) => {
  if (startId === targetId) return [startId];
  const queue = [startId];
  const visited = new Set([startId]);
  const prev = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();

    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);

      if (next === targetId) {
        const path = [targetId];
        let step = targetId;
        while (prev.has(step)) {
          step = prev.get(step);
          path.push(step);
        }
        return path.reverse();
      }

      queue.push(next);
    }
  }

  return null;
};

const assignMovingTravelState = (user, path, targetNodeId, unitDurationSeconds, startedAt = new Date()) => {
  user.travelState = {
    status: TRAVEL_STATUS.MOVING,
    isTraveling: true,
    path,
    startedAt,
    unitDurationSeconds,
    targetNodeId,
    stoppingNearestNodeId: null,
    stoppingNearestNodeName: '',
    stopStartedAt: null,
    stopDurationSeconds: 0,
    stopFromNode: null,
    queuedTargetNodeId: null,
    queuedTargetNodeName: ''
  };
};

const startTravelFromCurrentLocation = async (user, targetNodeId, options = {}) => {
  if (!user.location || user.location.trim() === '') {
    return { ok: false, statusCode: 400, error: '请先设置当前位置后再移动' };
  }

  const approvedNodes = await Node.find({ status: 'approved' })
    .select('_id name relatedParentDomains relatedChildDomains')
    .lean();
  const { nameToId, idToNode, adjacency } = buildNodeGraph(approvedNodes);

  const startNodeId = nameToId.get(user.location);
  if (!startNodeId) {
    return { ok: false, statusCode: 400, error: '当前位置节点不存在或未审批通过' };
  }

  const targetId = targetNodeId.toString();
  const targetNode = idToNode.get(targetId);
  if (!targetNode) {
    return { ok: false, statusCode: 404, error: '目标节点不存在或未审批通过' };
  }

  if (startNodeId === targetId) {
    return { ok: false, statusCode: 400, error: '目标节点与当前位置相同，无需移动' };
  }

  const shortestPathIds = bfsShortestPath(startNodeId, targetId, adjacency);
  if (!shortestPathIds || shortestPathIds.length < 2) {
    return { ok: false, statusCode: 400, error: '当前位置与目标节点之间不存在可达路径' };
  }

  const settings = await getOrCreateSettings();
  const safeUnitDuration = Math.max(
    1,
    parseInt(options.unitDurationSeconds, 10) || settings.travelUnitSeconds
  );
  const path = shortestPathIds.map((id) => ({
    nodeId: idToNode.get(id)._id,
    nodeName: idToNode.get(id).name
  }));

  assignMovingTravelState(user, path, targetNode._id, safeUnitDuration, options.startedAt || new Date());

  return {
    ok: true,
    path,
    targetNode,
    shortestDistance: shortestPathIds.length - 1
  };
};

const settleTravelState = async (user) => {
  const progress = calculateTravelProgress(user);
  const travel = user.travelState || {};
  const currentStatus = getTravelStatus(travel);

  if (currentStatus === TRAVEL_STATUS.MOVING && progress.arrived) {
    const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);
    user.location = progress.arrivedNode.nodeName;
    resetTravelState(user, unitDurationSeconds);
    await user.save();
    return calculateTravelProgress(user);
  }

  if (currentStatus === TRAVEL_STATUS.STOPPING && progress.arrived) {
    const unitDurationSeconds = Math.max(1, parseInt(travel.unitDurationSeconds, 10) || 60);
    const nearestNodeName = travel.stoppingNearestNodeName || progress.stoppingNearestNode?.nodeName;
    const nearestNodeId = (travel.stoppingNearestNodeId || progress.stoppingNearestNode?.nodeId || '').toString();
    const queuedTargetNodeId = travel.queuedTargetNodeId ? travel.queuedTargetNodeId.toString() : '';

    if (nearestNodeName) {
      user.location = nearestNodeName;
    }

    resetTravelState(user, unitDurationSeconds);

    if (queuedTargetNodeId && queuedTargetNodeId !== nearestNodeId) {
      const queuedStartResult = await startTravelFromCurrentLocation(user, queuedTargetNodeId, {
        unitDurationSeconds
      });
      if (!queuedStartResult.ok) {
        resetTravelState(user, unitDurationSeconds);
      }
    }

    await user.save();
    return calculateTravelProgress(user);
  }

  return progress;
};

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: '用户名至少3个字符' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6个字符' });
    }
    
    // 检查用户是否已存在
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建用户
    const user = new User({ 
      username, 
      password: hashedPassword,
      plainPassword: password,
      role: 'common'
    });
    await user.save();

    // 生成token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({
      token,
      userId: user._id,
      username: user.username,
      role: user.role,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      userId: user._id,
      username: user.username,
      role: user.role,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新用户location
router.put('/location', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { location } = req.body;

    if (!location || location.trim() === '') {
      return res.status(400).json({ error: 'location不能为空' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const travelProgress = await settleTravelState(user);
    if (travelProgress.isTraveling) {
      return res.status(409).json({ error: '移动中无法手动修改位置，请先停止移动' });
    }

    user.location = location;
    await user.save();

    res.json({
      success: true,
      location: user.location
    });
  } catch (error) {
    console.error('更新location错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 找回密码（修改密码）
router.post('/reset-password', async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;

    // 验证输入
    if (!username || !oldPassword || !newPassword) {
      return res.status(400).json({ error: '用户名、原密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6个字符' });
    }

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: '用户名不存在' });
    }

    // 验证原密码
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '原密码错误' });
    }

    // 加密新密码
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    user.password = hashedNewPassword;
    user.plainPassword = newPassword; // 同时更新明文密码（用于管理员查看）
    await user.save();

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('重置密码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取用户个人信息
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      userId: user._id,
      username: user.username,
      role: user.role,
      level: user.level,
      experience: user.experience,
      location: user.location,
      profession: user.profession,
      avatar: user.avatar,
      gender: user.gender,
      ownedNodes: user.ownedNodes,
      allianceId: user.allianceId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改头像
router.put('/profile/avatar', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { avatar } = req.body;

    // 验证头像ID是否为有效的默认头像
    const validAvatars = [
      'default_male_1', 'default_male_2', 'default_male_3',
      'default_female_1', 'default_female_2', 'default_female_3'
    ];

    if (!avatar || !validAvatars.includes(avatar)) {
      return res.status(400).json({ error: '无效的头像选择' });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { avatar },
      { new: true }
    ).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      avatar: user.avatar
    });
  } catch (error) {
    console.error('修改头像错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改密码（已登录状态）
router.put('/profile/password', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { oldPassword, newPassword } = req.body;

    // 验证输入
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '原密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6个字符' });
    }

    // 查找用户
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 验证原密码
    const validPassword = await bcrypt.compare(oldPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: '原密码错误' });
    }

    // 加密新密码
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    user.password = hashedNewPassword;
    user.plainPassword = newPassword;
    await user.save();

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 修改性别
router.put('/profile/gender', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { gender } = req.body;

    // 验证性别值
    const validGenders = ['male', 'female', 'other'];
    if (!gender || !validGenders.includes(gender)) {
      return res.status(400).json({ error: '无效的性别选择' });
    }

    const user = await User.findByIdAndUpdate(
      decoded.userId,
      { gender },
      { new: true }
    ).select('-password -plainPassword');

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      gender: user.gender
    });
  } catch (error) {
    console.error('修改性别错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取当前移动状态
router.get('/travel/status', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const progress = await settleTravelState(user);

    res.json({
      success: true,
      location: user.location,
      travel: toTravelResponse(progress)
    });
  } catch (error) {
    console.error('获取移动状态错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 开始移动（普通用户）
router.post('/travel/start', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: '管理员无需执行移动操作' });
    }

    const { targetNodeId } = req.body;
    if (!targetNodeId) {
      return res.status(400).json({ error: '目标节点不能为空' });
    }

    const settledProgress = await settleTravelState(user);
    const currentStatus = getTravelStatus(user.travelState || {});

    if (currentStatus === TRAVEL_STATUS.MOVING && settledProgress.isTraveling) {
      return res.status(409).json({ error: '正在移动中，请先停止当前移动' });
    }

    if (currentStatus === TRAVEL_STATUS.STOPPING) {
      const targetNode = await Node.findOne({ _id: targetNodeId, status: 'approved' }).select('_id name');
      if (!targetNode) {
        return res.status(404).json({ error: '目标节点不存在或未审批通过' });
      }

      const nearestNodeId = user.travelState?.stoppingNearestNodeId?.toString?.() || '';
      if (nearestNodeId && nearestNodeId === targetNode._id.toString()) {
        return res.status(400).json({ error: '停止移动期间不能把最近节点设为新的目标' });
      }

      user.travelState.queuedTargetNodeId = targetNode._id;
      user.travelState.queuedTargetNodeName = targetNode.name;
      await user.save();

      const stoppingProgress = calculateTravelProgress(user);
      return res.json({
        success: true,
        message: `已记录新的目标节点 ${targetNode.name}，将在停止完成后自动出发`,
        location: user.location,
        travel: toTravelResponse(stoppingProgress)
      });
    }

    const startResult = await startTravelFromCurrentLocation(user, targetNodeId);
    if (!startResult.ok) {
      return res.status(startResult.statusCode || 400).json({ error: startResult.error || '开始移动失败' });
    }

    await user.save();

    const progress = calculateTravelProgress(user);

    res.json({
      success: true,
      message: `已开始前往 ${startResult.targetNode.name}，总距离 ${startResult.shortestDistance} 单位`,
      location: user.location,
      travel: toTravelResponse(progress)
    });
  } catch (error) {
    console.error('开始移动错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 停止移动（按当前进度就近停靠）
router.post('/travel/stop', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '未授权' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: '管理员无需执行移动操作' });
    }

    const progress = await settleTravelState(user);
    const currentStatus = getTravelStatus(user.travelState || {});

    if (currentStatus === TRAVEL_STATUS.IDLE || !progress.isTraveling) {
      return res.status(400).json({ error: '当前不在移动状态' });
    }

    if (currentStatus === TRAVEL_STATUS.STOPPING) {
      return res.json({
        success: true,
        message: '已在停止移动过程中，请等待到达最近节点',
        location: user.location,
        travel: toTravelResponse(progress)
      });
    }

    const nearestIsNext = progress.progressInCurrentSegment >= 0.5;
    const nearestNode = nearestIsNext ? progress.nextNode : progress.lastReachedNode;
    const stopFromNode = nearestIsNext ? progress.lastReachedNode : progress.nextNode;
    if (!nearestNode) {
      return res.status(400).json({ error: '当前移动状态异常，无法停止移动' });
    }
    const unitDurationSeconds = Math.max(1, parseInt(progress.unitDurationSeconds, 10) || 60);
    const stopDurationSeconds = nearestIsNext
      ? (1 - progress.progressInCurrentSegment) * unitDurationSeconds
      : progress.progressInCurrentSegment * unitDurationSeconds;

    user.travelState.status = TRAVEL_STATUS.STOPPING;
    user.travelState.isTraveling = true;
    user.travelState.path = [];
    user.travelState.startedAt = null;
    user.travelState.targetNodeId = null;
    user.travelState.stoppingNearestNodeId = nearestNode.nodeId;
    user.travelState.stoppingNearestNodeName = nearestNode.nodeName;
    user.travelState.stopStartedAt = new Date();
    user.travelState.stopDurationSeconds = parseFloat(stopDurationSeconds.toFixed(3));
    user.travelState.stopFromNode = stopFromNode || null;
    user.travelState.queuedTargetNodeId = null;
    user.travelState.queuedTargetNodeName = '';
    await user.save();

    const stoppingProgress = calculateTravelProgress(user);

    res.json({
      success: true,
      message: `已开始停止移动，将在 ${Math.ceil(stoppingProgress.remainingSeconds || 0)} 秒后到达 ${nearestNode.nodeName}`,
      location: user.location,
      snappedNode: nearestNode,
      travel: toTravelResponse(stoppingProgress)
    });
  } catch (error) {
    console.error('停止移动错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
