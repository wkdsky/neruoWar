const express = require('express');
const router = express.Router();
const Node = require('../models/Node');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

// 搜索节点
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.status(400).json({ error: '搜索关键词不能为空' });
    }

    const nodes = await Node.find({
      $or: [
        { name: { $regex: keyword, $options: 'i' } },
        { description: { $regex: keyword, $options: 'i' } }
      ],
      status: 'approved'
    }).select('name description _id');

    res.json(nodes);
  } catch (error) {
    console.error('搜索节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 创建节点（普通用户需要申请，管理员直接创建）
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, description, position, associations } = req.body;
    
    // 验证必填字段
    if (!name || !description) {
      return res.status(400).json({ error: '标题和简介不能为空' });
    }

    // 检查标题唯一性
    const existingNode = await Node.findOne({ name });
    if (existingNode) {
      return res.status(400).json({ error: '节点标题必须唯一' });
    }

    // 检查用户是否为管理员
    const user = await User.findById(req.user.userId);
    const isUserAdmin = user.role === 'admin';

    // 验证关联关系（普通用户必须至少有一个关联关系）
    if (!isUserAdmin && (!associations || associations.length === 0)) {
      return res.status(400).json({ error: '普通用户创建节点必须至少有一个关联关系' });
    }

    const nodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const node = new Node({
      nodeId,
      owner: req.user.userId,
      name,
      description,
      position,
      associations: associations || [],
      status: isUserAdmin ? 'approved' : 'pending'
    });

    await node.save();
    
    // 如果是管理员直接创建，更新用户拥有的节点列表
    if (isUserAdmin) {
      await User.findByIdAndUpdate(req.user.userId, {
        $push: { ownedNodes: node._id }
      });
    }

    res.status(201).json(node);
  } catch (error) {
    console.error('创建节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取待审批节点列表
router.get('/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const nodes = await Node.find({ status: 'pending' })
      .populate('owner', 'username')
      .populate('associations.targetNode', 'name description');
    res.json(nodes);
  } catch (error) {
    console.error('获取待审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 审批节点
router.post('/approve', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    node.status = 'approved';
    await node.save();

    // 更新用户拥有的节点列表
    await User.findByIdAndUpdate(node.owner, {
      $push: { ownedNodes: node._id }
    });

    res.json(node);
  } catch (error) {
    console.error('审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 拒绝节点
router.post('/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    node.status = 'rejected';
    await node.save();

    res.json(node);
  } catch (error) {
    console.error('拒绝节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 关联节点
router.post('/associate', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (node.owner.toString() === req.user.userId) {
      return res.status(400).json({ error: '不能关联自己创建的节点' });
    }
    node.status = 'pending';
    await node.save();
    res.status(200).json(node);
  } catch (error) {
    console.error('关联节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 审批节点关联
router.post('/approve-association', authenticateToken, async (req, res) => {
  try {
    const { nodeId, isParent } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    if (isParent) {
      node.parentNode = req.user.userId;
    } else {
      node.childNodes.push(req.user.userId);
    }
    node.status = 'approved';
    await node.save();
    res.status(200).json(node);
  } catch (error) {
    console.error('审批节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 拒绝节点关联
router.post('/reject-association', authenticateToken, async (req, res) => {
  try {
    const { nodeId } = req.body;
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }
    node.status = 'rejected';
    await node.save();
    res.status(200).json(node);
  } catch (error) {
    console.error('拒绝节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取所有节点（管理员专用）
router.get('/', authenticateToken, isAdmin, async (req, res) => {
  try {
    const nodes = await Node.find()
      .populate('owner', 'username')
      .populate('associations.targetNode', 'name description')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: nodes.length,
      nodes: nodes
    });
  } catch (error) {
    console.error('获取节点列表错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 更新节点信息（管理员专用）
router.put('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { name, description, prosperity, resources, productionRates } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 更新字段
    if (name !== undefined) {
      // 检查名称唯一性（排除当前节点）
      const existingNode = await Node.findOne({ 
        name, 
        _id: { $ne: nodeId } 
      });
      if (existingNode) {
        return res.status(400).json({ error: '节点名称必须唯一' });
      }
      node.name = name;
    }

    if (description !== undefined) {
      node.description = description;
    }

    if (prosperity !== undefined) {
      node.prosperity = prosperity;
    }

    if (resources !== undefined) {
      node.resources = resources;
    }

    if (productionRates !== undefined) {
      node.productionRates = productionRates;
    }

    await node.save();

    res.json({
      success: true,
      message: '节点信息已更新',
      node: node
    });
  } catch (error) {
    console.error('更新节点信息错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 删除节点（管理员专用）
router.delete('/:nodeId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const node = await Node.findByIdAndDelete(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 从用户拥有的节点列表中移除
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    res.json({
      success: true,
      message: '节点已删除',
      deletedNode: node.name
    });
  } catch (error) {
    console.error('删除节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
