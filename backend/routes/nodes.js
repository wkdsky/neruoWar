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
    const { name, description, position, associations, forceCreate } = req.body;

    // 验证必填字段
    if (!name || !description) {
      return res.status(400).json({ error: '标题和简介不能为空' });
    }

    // 检查标题唯一性（只检查已审核通过的节点）
    const existingApprovedNode = await Node.findOne({ name, status: 'approved' });
    if (existingApprovedNode) {
      return res.status(400).json({ error: '该节点标题已被使用（已有同名的审核通过节点）' });
    }

    // 检查用户是否为管理员
    const user = await User.findById(req.user.userId);
    const isUserAdmin = user.role === 'admin';

    // 如果是管理员，检查是否有同名的待审核节点
    if (isUserAdmin && !forceCreate) {
      const pendingNodesWithSameName = await Node.find({ name, status: 'pending' })
        .populate('owner', 'username profession')
        .populate('associations.targetNode', 'name');

      if (pendingNodesWithSameName.length > 0) {
        // 返回待审核节点信息，让管理员选择
        return res.status(409).json({
          error: 'PENDING_NODES_EXIST',
          message: '已有用户提交了同名节点的申请，请先处理这些申请',
          pendingNodes: pendingNodesWithSameName
        });
      }
    }

    // 验证关联关系（普通用户必须至少有一个关联关系）
    if (!isUserAdmin && (!associations || associations.length === 0)) {
      return res.status(400).json({ error: '普通用户创建节点必须至少有一个关联关系' });
    }

    // 验证：检查是否有重复的目标节点（一个节点不能既被包含又被拓展）
    if (associations && associations.length > 0) {
      const targetNodeIds = associations.map(a => a.targetNode.toString());
      const uniqueTargetNodes = new Set(targetNodeIds);
      if (targetNodeIds.length !== uniqueTargetNodes.size) {
        return res.status(400).json({
          error: '关联关系错误：同一个节点只能有一种关联关系（拓展或包含），不能同时存在两种关系。'
        });
      }
    }

    // 填充关联母域和关联子域
    let relatedParentDomains = [];
    let relatedChildDomains = [];

    if (associations && associations.length > 0) {
      // 获取所有关联节点的详细信息
      const targetNodeIds = associations.map(a => a.targetNode);
      const targetNodes = await Node.find({ _id: { $in: targetNodeIds } });

      // 创建节点ID到节点名称的映射
      const nodeMap = {};
      targetNodes.forEach(node => {
        nodeMap[node._id.toString()] = node.name;
      });

      // 根据关联类型分类
      associations.forEach(association => {
        const targetNodeName = nodeMap[association.targetNode.toString()];
        if (targetNodeName) {
          if (association.relationType === 'extends') {
            relatedParentDomains.push(targetNodeName);
          } else if (association.relationType === 'contains') {
            relatedChildDomains.push(targetNodeName);
          }
        }
      });
    }

    const nodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const node = new Node({
      nodeId,
      owner: req.user.userId,
      domainMaster: req.user.userId, // 创建者自动成为域主
      name,
      description,
      position,
      associations: associations || [],
      relatedParentDomains,
      relatedChildDomains,
      status: isUserAdmin ? 'approved' : 'pending',
      contentScore: 1 // 新建节点默认内容分数为1
    });

    await node.save();

    // 双向同步：更新被关联节点的relatedParentDomains和relatedChildDomains
    if (associations && associations.length > 0 && (isUserAdmin || node.status === 'approved')) {
      const targetNodeIds = associations.map(a => a.targetNode);
      const targetNodes = await Node.find({ _id: { $in: targetNodeIds } });

      for (const association of associations) {
        const targetNode = targetNodes.find(n => n._id.toString() === association.targetNode.toString());
        if (targetNode) {
          if (association.relationType === 'contains') {
            // 当前节点包含目标节点 -> 目标节点的relatedParentDomains应加入当前节点
            if (!targetNode.relatedParentDomains.includes(node.name)) {
              targetNode.relatedParentDomains.push(node.name);
              await targetNode.save();
            }
          } else if (association.relationType === 'extends') {
            // 当前节点拓展目标节点 -> 目标节点的relatedChildDomains应加入当前节点
            if (!targetNode.relatedChildDomains.includes(node.name)) {
              targetNode.relatedChildDomains.push(node.name);
              await targetNode.save();
            }
          }
        }
      }
    }

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
      .populate('owner', 'username profession')
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
    const node = await Node.findById(nodeId).populate('associations.targetNode', 'name');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 检查是否已有同名的已审核节点
    const existingApproved = await Node.findOne({ name: node.name, status: 'approved' });
    if (existingApproved) {
      return res.status(400).json({ error: '已存在同名的审核通过节点，无法批准此申请' });
    }

    // 填充关联母域和关联子域
    let relatedParentDomains = [];
    let relatedChildDomains = [];

    if (node.associations && node.associations.length > 0) {
      node.associations.forEach(association => {
        if (association.targetNode && association.targetNode.name) {
          if (association.relationType === 'extends') {
            relatedParentDomains.push(association.targetNode.name);
          } else if (association.relationType === 'contains') {
            relatedChildDomains.push(association.targetNode.name);
          }
        }
      });
    }

    node.status = 'approved';
    node.relatedParentDomains = relatedParentDomains;
    node.relatedChildDomains = relatedChildDomains;
    // 设置默认内容分数为1
    node.contentScore = 1;
    await node.save();

    // 自动拒绝其他同名的待审核节点
    const rejectedNodes = await Node.find({
      name: node.name,
      status: 'pending',
      _id: { $ne: node._id }
    }).populate('owner', 'username');

    const rejectedInfo = [];
    for (const rejectedNode of rejectedNodes) {
      rejectedInfo.push({
        id: rejectedNode._id,
        owner: rejectedNode.owner?.username || '未知用户'
      });
      // 删除被拒绝的节点
      await Node.findByIdAndDelete(rejectedNode._id);
    }

    // 双向同步：更新被关联节点的relatedParentDomains和relatedChildDomains
    if (node.associations && node.associations.length > 0) {
      for (const association of node.associations) {
        const targetNode = await Node.findById(association.targetNode._id || association.targetNode);
        if (targetNode) {
          if (association.relationType === 'contains') {
            // 当前节点包含目标节点 -> 目标节点的relatedParentDomains应加入当前节点
            if (!targetNode.relatedParentDomains.includes(node.name)) {
              targetNode.relatedParentDomains.push(node.name);
              await targetNode.save();
            }
          } else if (association.relationType === 'extends') {
            // 当前节点拓展目标节点 -> 目标节点的relatedChildDomains应加入当前节点
            if (!targetNode.relatedChildDomains.includes(node.name)) {
              targetNode.relatedChildDomains.push(node.name);
              await targetNode.save();
            }
          }
        }
      }
    }

    // 更新用户拥有的节点列表
    await User.findByIdAndUpdate(node.owner, {
      $push: { ownedNodes: node._id }
    });

    res.json({
      ...node.toObject(),
      autoRejectedCount: rejectedInfo.length,
      autoRejectedNodes: rejectedInfo
    });
  } catch (error) {
    console.error('审批节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 拒绝节点（直接删除）
router.post('/reject', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.body;
    
    const node = await Node.findByIdAndDelete(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 从用户拥有的节点列表中移除（如果已添加）
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    res.json({
      success: true,
      message: '节点申请已被拒绝并删除',
      deletedNode: node.name
    });
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
    // 重置内容分数为1（关联节点视为新节点）
    node.contentScore = 1;
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
      .populate('owner', 'username profession')
      .populate('domainMaster', 'username profession')
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
    const { name, description, prosperity, contentScore } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 更新字段
    if (name !== undefined) {
      // 检查名称唯一性（只检查已审核通过的节点，排除当前节点）
      const existingNode = await Node.findOne({
        name,
        status: 'approved',
        _id: { $ne: nodeId }
      });
      if (existingNode) {
        return res.status(400).json({ error: '该名称已被其他审核通过的节点使用' });
      }
      node.name = name;
    }

    if (description !== undefined) {
      node.description = description;
    }

    if (prosperity !== undefined) {
      node.prosperity = prosperity;
    }

    if (contentScore !== undefined) {
      // 验证内容分数至少为1
      if (contentScore < 1) {
        return res.status(400).json({ error: '内容分数至少为1' });
      }
      node.contentScore = contentScore;
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

    // 先获取节点信息（删除前需要知道节点名称）
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    const nodeName = node.name;

    // 清理所有关联：从所有引用了这个节点的节点中移除
    // 1. 移除所有relatedParentDomains中包含此节点名称的记录
    await Node.updateMany(
      { relatedParentDomains: nodeName },
      { $pull: { relatedParentDomains: nodeName } }
    );

    // 2. 移除所有relatedChildDomains中包含此节点名称的记录
    await Node.updateMany(
      { relatedChildDomains: nodeName },
      { $pull: { relatedChildDomains: nodeName } }
    );

    // 3. 移除所有associations中引用此节点的记录
    await Node.updateMany(
      { 'associations.targetNode': nodeId },
      { $pull: { associations: { targetNode: nodeId } } }
    );

    // 删除节点
    await Node.findByIdAndDelete(nodeId);

    // 从用户拥有的节点列表中移除
    await User.findByIdAndUpdate(node.owner, {
      $pull: { ownedNodes: nodeId }
    });

    res.json({
      success: true,
      message: '节点已删除，所有关联已清理',
      deletedNode: nodeName
    });
  } catch (error) {
    console.error('删除节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取单个节点（需要身份验证）
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const node = await Node.updateKnowledgePoint(req.params.id);
    if (!node) {
      return res.status(404).json({ message: '节点不存在' });
    }
    
    // 检查用户是否有权访问此节点
    const user = await User.findById(req.user.userId);
    const isOwner = node.owner.toString() === req.user.userId;
    const isAdmin = user.role === 'admin';
    
    // 只有节点所有者或管理员可以查看未审批节点
    if (node.status !== 'approved' && !isOwner && !isAdmin) {
      return res.status(403).json({ message: '无权访问此节点' });
    }
    
    res.json(node);
  } catch (err) {
    console.error('获取节点错误:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 编辑节点关联关系（管理员专用）
router.put('/:nodeId/associations', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { associations } = req.body; // 新的关联关系数组

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 验证：检查是否有重复的目标节点（一个节点不能既被包含又被拓展）
    if (associations && associations.length > 0) {
      const targetNodeIds = associations.map(a => a.targetNode.toString());
      const uniqueTargetNodes = new Set(targetNodeIds);
      if (targetNodeIds.length !== uniqueTargetNodes.size) {
        return res.status(400).json({
          error: '关联关系错误：同一个节点只能有一种关联关系（拓展或包含），不能同时存在两种关系。'
        });
      }
    }

    const nodeName = node.name;
    const oldAssociations = node.associations || [];

    // 第一步：清理旧的双向关联
    for (const oldAssoc of oldAssociations) {
      const targetNode = await Node.findById(oldAssoc.targetNode);
      if (targetNode) {
        if (oldAssoc.relationType === 'contains') {
          // 从目标节点的relatedParentDomains中移除当前节点
          targetNode.relatedParentDomains = targetNode.relatedParentDomains.filter(
            name => name !== nodeName
          );
          await targetNode.save();
        } else if (oldAssoc.relationType === 'extends') {
          // 从目标节点的relatedChildDomains中移除当前节点
          targetNode.relatedChildDomains = targetNode.relatedChildDomains.filter(
            name => name !== nodeName
          );
          await targetNode.save();
        }
      }
    }

    // 第二步：更新当前节点的关联关系和域列表
    let relatedParentDomains = [];
    let relatedChildDomains = [];

    if (associations && associations.length > 0) {
      const targetNodeIds = associations.map(a => a.targetNode);
      const targetNodes = await Node.find({ _id: { $in: targetNodeIds } });

      const nodeMap = {};
      targetNodes.forEach(n => {
        nodeMap[n._id.toString()] = n.name;
      });

      associations.forEach(association => {
        const targetNodeName = nodeMap[association.targetNode.toString()];
        if (targetNodeName) {
          if (association.relationType === 'extends') {
            relatedParentDomains.push(targetNodeName);
          } else if (association.relationType === 'contains') {
            relatedChildDomains.push(targetNodeName);
          }
        }
      });
    }

    node.associations = associations || [];
    node.relatedParentDomains = relatedParentDomains;
    node.relatedChildDomains = relatedChildDomains;
    await node.save();

    // 第三步：建立新的双向关联
    if (associations && associations.length > 0) {
      for (const association of associations) {
        const targetNode = await Node.findById(association.targetNode);
        if (targetNode) {
          if (association.relationType === 'contains') {
            // 当前节点包含目标节点 -> 目标节点的relatedParentDomains应加入当前节点
            if (!targetNode.relatedParentDomains.includes(nodeName)) {
              targetNode.relatedParentDomains.push(nodeName);
              await targetNode.save();
            }
          } else if (association.relationType === 'extends') {
            // 当前节点拓展目标节点 -> 目标节点的relatedChildDomains应加入当前节点
            if (!targetNode.relatedChildDomains.includes(nodeName)) {
              targetNode.relatedChildDomains.push(nodeName);
              await targetNode.save();
            }
          }
        }
      }
    }

    res.json({
      success: true,
      message: '关联关系已更新',
      node: node
    });
  } catch (error) {
    console.error('编辑节点关联错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 设置/取消热门节点（管理员专用）
router.put('/:nodeId/featured', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { isFeatured, featuredOrder } = req.body;

    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    node.isFeatured = isFeatured !== undefined ? isFeatured : node.isFeatured;
    if (featuredOrder !== undefined) {
      node.featuredOrder = featuredOrder;
    }

    await node.save();

    res.json({
      success: true,
      message: isFeatured ? '已设置为热门节点' : '已取消热门节点',
      node: node
    });
  } catch (error) {
    console.error('设置热门节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取根节点（所有用户可访问）
router.get('/public/root-nodes', async (req, res) => {
  try {
    // 查找所有已批准的节点
    const nodes = await Node.find({ status: 'approved' })
      .populate('owner', 'username profession')
      .select('name description relatedParentDomains relatedChildDomains knowledgePoint contentScore');

    // 过滤出根节点（没有母节点的节点）
    const rootNodes = nodes.filter(node =>
      !node.relatedParentDomains || node.relatedParentDomains.length === 0
    );

    res.json({
      success: true,
      count: rootNodes.length,
      nodes: rootNodes
    });
  } catch (error) {
    console.error('获取根节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取热门节点（所有用户可访问）
router.get('/public/featured-nodes', async (req, res) => {
  try {
    const featuredNodes = await Node.find({
      status: 'approved',
      isFeatured: true
    })
      .populate('owner', 'username profession')
      .sort({ featuredOrder: 1, createdAt: -1 })
      .select('name description relatedParentDomains relatedChildDomains knowledgePoint contentScore isFeatured featuredOrder');

    res.json({
      success: true,
      count: featuredNodes.length,
      nodes: featuredNodes
    });
  } catch (error) {
    console.error('获取热门节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 实时搜索节点（所有用户可访问）
router.get('/public/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === '') {
      return res.json({
        success: true,
        results: []
      });
    }

    // 分割关键词（按空格）
    const keywords = query.trim().split(/\s+/);

    // 查找所有已批准的节点
    const allNodes = await Node.find({ status: 'approved' })
      .populate('owner', 'username profession')
      .select('name description relatedParentDomains relatedChildDomains knowledgePoint contentScore');

    // 计算匹配度
    const searchResults = allNodes.map(node => {
      let matchCount = 0;
      const searchText = `${node.name} ${node.description}`.toLowerCase();

      keywords.forEach(keyword => {
        const lowerKeyword = keyword.toLowerCase();
        if (searchText.includes(lowerKeyword)) {
          matchCount++;
        }
      });

      return {
        node,
        matchCount
      };
    }).filter(item => item.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .map(item => item.node);

    res.json({
      success: true,
      count: searchResults.length,
      results: searchResults
    });
  } catch (error) {
    console.error('搜索节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取节点详细信息（所有用户可访问）
router.get('/public/node-detail/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;

    const node = await Node.findById(nodeId)
      .populate('owner', 'username profession')
      .select('name description owner relatedParentDomains relatedChildDomains knowledgePoint contentScore createdAt status');

    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    if (node.status !== 'approved') {
      return res.status(403).json({ error: '该节点未审批' });
    }

    // 获取关联的母域节点信息（ID和名称）
    const parentNodes = await Node.find({
      name: { $in: node.relatedParentDomains },
      status: 'approved'
    }).select('_id name description knowledgePoint contentScore');

    // 获取关联的子域节点信息（ID和名称）
    const childNodes = await Node.find({
      name: { $in: node.relatedChildDomains },
      status: 'approved'
    }).select('_id name description knowledgePoint contentScore');

    res.json({
      success: true,
      node: {
        ...node.toObject(),
        parentNodesInfo: parentNodes,
        childNodesInfo: childNodes
      }
    });
  } catch (error) {
    console.error('获取节点详情错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 公开接口：获取所有已批准的节点（用于构建导航路径）
router.get('/public/all-nodes', async (req, res) => {
  try {
    const nodes = await Node.find({ status: 'approved' })
      .select('_id name description relatedParentDomains relatedChildDomains')
      .lean();

    res.json({
      success: true,
      nodes: nodes
    });
  } catch (error) {
    console.error('获取所有节点错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：更换节点域主
router.put('/admin/domain-master/:nodeId', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { nodeId } = req.params;
    const { domainMasterId } = req.body;

    // 查找节点
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: '节点不存在' });
    }

    // 如果domainMasterId为空或null，清除域主
    if (!domainMasterId) {
      node.domainMaster = null;
      await node.save();
      return res.json({
        success: true,
        message: '域主已清除',
        node: await Node.findById(nodeId).populate('domainMaster', 'username profession')
      });
    }

    // 查找新域主用户
    const newMaster = await User.findById(domainMasterId);
    if (!newMaster) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 更新域主
    node.domainMaster = domainMasterId;
    await node.save();

    const updatedNode = await Node.findById(nodeId)
      .populate('domainMaster', 'username profession');

    res.json({
      success: true,
      message: '域主更换成功',
      node: updatedNode
    });
  } catch (error) {
    console.error('更换域主错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 管理员：搜索用户（用于选择域主）
router.get('/admin/search-users', authenticateToken, async (req, res) => {
  try {
    // 检查是否是管理员
    const adminUser = await User.findById(req.user.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    const { keyword } = req.query;

    let query = {};
    if (keyword && keyword.trim()) {
      query = {
        username: { $regex: keyword, $options: 'i' }
      };
    }

    const users = await User.find(query)
      .select('_id username level role')
      .limit(20)
      .sort({ username: 1 });

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('搜索用户错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
