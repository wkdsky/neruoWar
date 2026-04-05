const express = require('express');
const mongoose = require('mongoose');

const { authenticateToken } = require('../middleware/auth');
const KnowledgeBrocade = require('../models/KnowledgeBrocade');
const KnowledgeBrocadeNode = require('../models/KnowledgeBrocadeNode');

const router = express.Router();

const MAX_BROCADES_PER_USER = 50;
const MAX_NODES_PER_BROCADE = 300;
const MAX_BROCADE_NAME_LENGTH = 80;
const MAX_CONTENT_LENGTH = 200000;
const MAX_NODE_TITLE_LENGTH = 80;
const DEFAULT_NODE_SHAPE = 'rectangle';
const DEFAULT_SYSTEM_NODE_TITLE = '新建知识点';

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

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(getIdString(value));

const clampNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeName = (value = '', fallback = '未命名知识锦') => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const safe = trimmed || fallback;
  return safe.slice(0, MAX_BROCADE_NAME_LENGTH);
};

const normalizeNodeTitle = (value = '', fallback = '未命名节点') => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const safe = trimmed || fallback;
  return safe.slice(0, MAX_NODE_TITLE_LENGTH);
};

const resolveUniqueSiblingNodeTitle = (existingTitles = [], baseTitle = DEFAULT_SYSTEM_NODE_TITLE) => {
  const normalizedBaseTitle = normalizeNodeTitle(baseTitle, DEFAULT_SYSTEM_NODE_TITLE);
  const usedTitles = new Set(
    (Array.isArray(existingTitles) ? existingTitles : [])
      .map((item) => normalizeNodeTitle(item, ''))
      .filter(Boolean)
  );
  if (!usedTitles.has(normalizedBaseTitle)) {
    return normalizedBaseTitle;
  }
  let duplicateIndex = 2;
  while (usedTitles.has(`${normalizedBaseTitle} (${duplicateIndex})`)) {
    duplicateIndex += 1;
  }
  return `${normalizedBaseTitle} (${duplicateIndex})`;
};

const extractNodeTitle = (contentText = '') => {
  const lines = String(contentText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines[0] || '未命名节点').slice(0, 80);
};

const extractRequestedNodeTitle = (contentText = '') => {
  const lines = String(contentText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] ? normalizeNodeTitle(lines[0], '') : '';
};

const buildCreateNodeContent = (contentText = '', title = DEFAULT_SYSTEM_NODE_TITLE) => {
  const normalized = String(contentText || '').replace(/\r/g, '');
  const trimmed = normalized.trim();
  if (!trimmed) {
    return `${normalizeNodeTitle(title, DEFAULT_SYSTEM_NODE_TITLE)}\n\n`;
  }
  if (extractRequestedNodeTitle(normalized)) {
    return normalized;
  }
  return `${normalizeNodeTitle(title, DEFAULT_SYSTEM_NODE_TITLE)}\n\n${trimmed}`;
};

const extractPreviewText = (contentText = '') => {
  const normalized = String(contentText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (normalized.length < 2) {
    const single = normalized[0] || '';
    return single.slice(0, 180);
  }
  return normalized.slice(1).join(' ').slice(0, 180);
};

const buildDefaultNodeContent = (title = '未命名节点') => `${String(title || '未命名节点').trim() || '未命名节点'}\n\n在这里记录你的知识。`;

const trimPreviewText = (value = '') => String(value || '').trim().slice(0, 240);

const serializeBrocade = (doc = {}) => ({
  _id: getIdString(doc?._id),
  name: doc?.name || '未命名知识锦',
  rootNodeId: getIdString(doc?.rootNodeId),
  nodeCount: Math.max(1, Number(doc?.nodeCount) || 1),
  lastOpenedAt: doc?.lastOpenedAt || null,
  createdAt: doc?.createdAt || null,
  updatedAt: doc?.updatedAt || null
});

const serializeNodeSummary = (doc = {}) => ({
  _id: getIdString(doc?._id),
  brocadeId: getIdString(doc?.brocadeId),
  parentNodeId: getIdString(doc?.parentNodeId),
  isRoot: !!doc?.isRoot,
  isStarred: !!doc?.isStarred,
  title: doc?.title || '未命名节点',
  previewText: doc?.previewText || '',
  contentText: doc?.contentText || '',
  position: {
    x: Math.round(clampNumber(doc?.position?.x, 0)),
    y: Math.round(clampNumber(doc?.position?.y, 0))
  },
  createdAt: doc?.createdAt || null,
  updatedAt: doc?.updatedAt || null
});

const buildGraphPayload = (brocade, nodes = []) => {
  const serializedNodes = nodes.map((item) => serializeNodeSummary(item));
  return {
    brocade: serializeBrocade(brocade),
    nodes: serializedNodes,
    edges: serializedNodes
      .filter((item) => !!item.parentNodeId)
      .map((item) => ({
        id: `${item.parentNodeId}->${item._id}`,
        source: item.parentNodeId,
        target: item._id
      }))
  };
};

const getRequestUserId = (req) => {
  const userId = getIdString(req?.user?.userId);
  return isValidObjectId(userId) ? userId : '';
};

const loadOwnedBrocade = async (brocadeId, ownerUserId) => {
  if (!isValidObjectId(brocadeId) || !isValidObjectId(ownerUserId)) return null;
  return KnowledgeBrocade.findOne({
    _id: new mongoose.Types.ObjectId(brocadeId),
    ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
    archivedAt: null
  });
};

const loadOwnedNode = async (brocadeId, nodeId, ownerUserId) => {
  if (!isValidObjectId(brocadeId) || !isValidObjectId(nodeId) || !isValidObjectId(ownerUserId)) return null;
  return KnowledgeBrocadeNode.findOne({
    _id: new mongoose.Types.ObjectId(nodeId),
    brocadeId: new mongoose.Types.ObjectId(brocadeId),
    ownerUserId: new mongoose.Types.ObjectId(ownerUserId)
  });
};

const collectSubtreeNodeIds = (nodes = [], rootNodeId = '') => {
  const nodeMap = new Map();
  const childrenMap = new Map();
  nodes.forEach((node) => {
    const nodeId = getIdString(node?._id);
    const parentNodeId = getIdString(node?.parentNodeId);
    if (!nodeId) return;
    nodeMap.set(nodeId, node);
    if (!childrenMap.has(parentNodeId)) {
      childrenMap.set(parentNodeId, []);
    }
    childrenMap.get(parentNodeId).push(nodeId);
  });
  if (!nodeMap.has(rootNodeId)) return [];
  const out = [];
  const stack = [rootNodeId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    out.push(current);
    const nextChildren = childrenMap.get(current) || [];
    nextChildren.forEach((childId) => stack.push(childId));
  }
  return out;
};

router.get('/', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const items = await KnowledgeBrocade.find({
      ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
      archivedAt: null
    })
      .sort({ updatedAt: -1, _id: -1 })
      .lean();

    return res.json({
      success: true,
      items: items.map((item) => serializeBrocade(item))
    });
  } catch (error) {
    console.error('获取知识锦列表错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const currentCount = await KnowledgeBrocade.countDocuments({
      ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
      archivedAt: null
    });
    if (currentCount >= MAX_BROCADES_PER_USER) {
      return res.status(400).json({ error: `知识锦数量已达到上限（${MAX_BROCADES_PER_USER}）` });
    }

    const name = normalizeName(req.body?.name, '新的知识锦');
    const rootContentText = buildDefaultNodeContent(name);
    const rootTitle = extractNodeTitle(rootContentText);
    const rootPreviewText = extractPreviewText(rootContentText);

    const brocade = await KnowledgeBrocade.create({
      ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
      name,
      nodeCount: 1
    });
    const rootNode = await KnowledgeBrocadeNode.create({
      brocadeId: brocade._id,
      ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
      parentNodeId: null,
      isRoot: true,
      title: rootTitle,
      shape: DEFAULT_NODE_SHAPE,
      previewText: rootPreviewText,
      contentText: rootContentText,
      position: { x: 0, y: 0 }
    });

    brocade.rootNodeId = rootNode._id;
    await brocade.save();

    return res.status(201).json({
      success: true,
      brocade: serializeBrocade(brocade),
      rootNode: serializeNodeSummary(rootNode)
    });
  } catch (error) {
    console.error('创建知识锦错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.patch('/:brocadeId', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const brocadeId = req.params?.brocadeId;
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const brocade = await loadOwnedBrocade(brocadeId, ownerUserId);
    if (!brocade) return res.status(404).json({ error: '知识锦不存在' });

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      brocade.name = normalizeName(req.body?.name, brocade.name || '未命名知识锦');
    }
    if (req.body?.markOpened) {
      brocade.lastOpenedAt = new Date();
    }

    await brocade.save();
    return res.json({
      success: true,
      brocade: serializeBrocade(brocade)
    });
  } catch (error) {
    console.error('更新知识锦错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/:brocadeId', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const brocadeId = req.params?.brocadeId;
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const brocade = await loadOwnedBrocade(brocadeId, ownerUserId);
    if (!brocade) return res.status(404).json({ error: '知识锦不存在' });

    await KnowledgeBrocadeNode.deleteMany({
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId
    });
    await KnowledgeBrocade.deleteOne({ _id: brocade._id });

    return res.json({
      success: true,
      deletedBrocadeId: getIdString(brocade._id)
    });
  } catch (error) {
    console.error('删除知识锦错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/:brocadeId/graph', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const brocadeId = req.params?.brocadeId;
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const brocade = await loadOwnedBrocade(brocadeId, ownerUserId);
    if (!brocade) return res.status(404).json({ error: '知识锦不存在' });

    brocade.lastOpenedAt = new Date();
    await brocade.save();

    const nodes = await KnowledgeBrocadeNode.find({
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId
    })
      .sort({ isRoot: -1, createdAt: 1, _id: 1 })
      .lean();

    return res.json({
      success: true,
      ...buildGraphPayload(brocade, nodes)
    });
  } catch (error) {
    console.error('获取知识锦图谱错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/:brocadeId/nodes', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const brocadeId = req.params?.brocadeId;
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const brocade = await loadOwnedBrocade(brocadeId, ownerUserId);
    if (!brocade) return res.status(404).json({ error: '知识锦不存在' });
    if ((Number(brocade.nodeCount) || 1) >= MAX_NODES_PER_BROCADE) {
      return res.status(400).json({ error: `节点数量已达到上限（${MAX_NODES_PER_BROCADE}）` });
    }

    const parentNodeId = getIdString(req.body?.parentNodeId);
    if (!isValidObjectId(parentNodeId)) {
      return res.status(400).json({ error: '新增节点必须指定父节点' });
    }

    const parentNode = await loadOwnedNode(brocadeId, parentNodeId, ownerUserId);
    if (!parentNode) {
      return res.status(404).json({ error: '父节点不存在' });
    }

    const siblingNodes = await KnowledgeBrocadeNode.find({
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId,
      parentNodeId: parentNode._id
    })
      .select('title')
      .lean();
    const siblingTitles = siblingNodes.map((item) => item?.title || '');
    const fallbackTitle = resolveUniqueSiblingNodeTitle(siblingTitles, DEFAULT_SYSTEM_NODE_TITLE);
    const requestedContentText = String(req.body?.contentText || '');
    const requestedTitle = extractRequestedNodeTitle(requestedContentText) || normalizeNodeTitle(req.body?.title, '');
    const nextTitle = requestedTitle || fallbackTitle;
    if (requestedTitle && siblingTitles.some((item) => normalizeNodeTitle(item, '') === requestedTitle)) {
      return res.status(400).json({ error: '同级节点中已存在同名节点，请修改第一行标题后再保存' });
    }
    const nextContentText = buildCreateNodeContent(requestedContentText, nextTitle);
    const node = await KnowledgeBrocadeNode.create({
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId,
      parentNodeId: parentNode._id,
      isRoot: false,
      isStarred: !!req.body?.isStarred,
      title: nextTitle,
      shape: DEFAULT_NODE_SHAPE,
      previewText: extractPreviewText(nextContentText),
      contentText: nextContentText,
      position: {
        x: Math.round(clampNumber(req.body?.position?.x, clampNumber(parentNode?.position?.x, 0) + 240)),
        y: Math.round(clampNumber(req.body?.position?.y, clampNumber(parentNode?.position?.y, 0) + 120))
      }
    });

    brocade.nodeCount = Math.max(1, (Number(brocade.nodeCount) || 1) + 1);
    await brocade.save();

    return res.status(201).json({
      success: true,
      node: serializeNodeSummary(node),
      brocade: serializeBrocade(brocade)
    });
  } catch (error) {
    console.error('创建知识锦节点错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/:brocadeId/nodes/:nodeId', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const { brocadeId, nodeId } = req.params || {};
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const node = await loadOwnedNode(brocadeId, nodeId, ownerUserId);
    if (!node) return res.status(404).json({ error: '节点不存在' });

    return res.json({
      success: true,
      node: serializeNodeSummary(node)
    });
  } catch (error) {
    console.error('获取知识锦节点错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.patch('/:brocadeId/nodes/:nodeId', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const { brocadeId, nodeId } = req.params || {};
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const node = await loadOwnedNode(brocadeId, nodeId, ownerUserId);
    if (!node) return res.status(404).json({ error: '节点不存在' });

    if (req.body?.position && typeof req.body.position === 'object') {
      node.position = {
        x: Math.round(clampNumber(req.body.position.x, clampNumber(node.position?.x, 0))),
        y: Math.round(clampNumber(req.body.position.y, clampNumber(node.position?.y, 0)))
      };
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isStarred')) {
      node.isStarred = !!req.body?.isStarred;
    }

    await node.save();
    await KnowledgeBrocade.updateOne(
      {
        _id: node.brocadeId,
        ownerUserId: node.ownerUserId,
        archivedAt: null
      },
      {
        $set: { updatedAt: new Date() }
      }
    );
    return res.json({
      success: true,
      node: serializeNodeSummary(node)
    });
  } catch (error) {
    console.error('更新知识锦节点错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.post('/:brocadeId/nodes/restore', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const { brocadeId } = req.params || {};
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const brocade = await loadOwnedBrocade(brocadeId, ownerUserId);
    if (!brocade) return res.status(404).json({ error: '知识锦不存在' });

    const inputNodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
    if (inputNodes.length < 1) {
      return res.status(400).json({ error: '缺少可恢复的节点数据' });
    }

    const currentNodes = await KnowledgeBrocadeNode.find({
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId
    })
      .select('_id parentNodeId')
      .lean();
    const existingIdSet = new Set(currentNodes.map((item) => getIdString(item?._id)).filter(Boolean));
    const restoreIdSet = new Set();
    const restoreDocs = inputNodes.map((item, index) => {
      const nodeId = getIdString(item?._id);
      if (!isValidObjectId(nodeId)) {
        throw new Error(`第 ${index + 1} 个节点缺少有效 ID`);
      }
      if (existingIdSet.has(nodeId) || restoreIdSet.has(nodeId)) {
        throw new Error('存在重复的恢复节点 ID');
      }
      restoreIdSet.add(nodeId);
      const parentNodeId = getIdString(item?.parentNodeId);
      const contentText = String(item?.contentText || '');
      const fallbackTitle = normalizeNodeTitle(item?.title, '未命名节点');
      const safeContentText = contentText || buildDefaultNodeContent(fallbackTitle);
      const safeTitle = normalizeNodeTitle(item?.title, extractNodeTitle(safeContentText));
      return {
        _id: new mongoose.Types.ObjectId(nodeId),
        brocadeId: brocade._id,
        ownerUserId: brocade.ownerUserId,
        parentNodeId: parentNodeId ? new mongoose.Types.ObjectId(parentNodeId) : null,
        isRoot: !!item?.isRoot,
        isStarred: !!item?.isStarred,
        title: safeTitle,
        previewText: trimPreviewText(item?.previewText || extractPreviewText(safeContentText)),
        contentText: safeContentText,
        position: {
          x: Math.round(clampNumber(item?.position?.x, 0)),
          y: Math.round(clampNumber(item?.position?.y, 0))
        }
      };
    });

    const validParentIds = new Set([
      ...existingIdSet,
      ...restoreDocs.map((item) => getIdString(item?._id)).filter(Boolean)
    ]);
    const hasInvalidParent = restoreDocs.some((item) => {
      const parentNodeId = getIdString(item?.parentNodeId);
      return parentNodeId && !validParentIds.has(parentNodeId);
    });
    if (hasInvalidParent) {
      return res.status(400).json({ error: '恢复失败：存在缺失的父节点' });
    }

    if (((Number(brocade.nodeCount) || currentNodes.length || 1) + restoreDocs.length) > MAX_NODES_PER_BROCADE) {
      return res.status(400).json({ error: `恢复后节点数量将超过上限（${MAX_NODES_PER_BROCADE}）` });
    }

    await KnowledgeBrocadeNode.insertMany(restoreDocs, { ordered: true });

    const nextNodeCount = await KnowledgeBrocadeNode.countDocuments({
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId
    });
    brocade.nodeCount = Math.max(1, nextNodeCount);
    brocade.updatedAt = new Date();
    await brocade.save();

    const restoredNodes = await KnowledgeBrocadeNode.find({
      _id: { $in: restoreDocs.map((item) => item._id) },
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId
    })
      .sort({ isRoot: -1, createdAt: 1, _id: 1 })
      .lean();

    return res.status(201).json({
      success: true,
      brocade: serializeBrocade(brocade),
      nodes: restoredNodes.map((item) => serializeNodeSummary(item))
    });
  } catch (error) {
    console.error('恢复知识锦节点错误:', error);
    const statusCode = (
      String(error?.message || '').includes('缺少')
      || String(error?.message || '').includes('重复')
      || String(error?.message || '').includes('有效 ID')
    ) ? 400 : 500;
    return res.status(statusCode).json({ error: error.message || '服务器错误' });
  }
});

router.put('/:brocadeId/nodes/:nodeId/content', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const { brocadeId, nodeId } = req.params || {};
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const node = await loadOwnedNode(brocadeId, nodeId, ownerUserId);
    if (!node) return res.status(404).json({ error: '节点不存在' });

    const contentText = String(req.body?.contentText || '');
    const requestedTitle = extractRequestedNodeTitle(contentText) || normalizeNodeTitle(req.body?.title, '');
    if (contentText.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({ error: `节点内容过长，不能超过 ${MAX_CONTENT_LENGTH} 个字符` });
    }

    if (requestedTitle) {
      const siblingNodes = await KnowledgeBrocadeNode.find({
        brocadeId: node.brocadeId,
        ownerUserId: node.ownerUserId,
        parentNodeId: node.parentNodeId,
        _id: { $ne: node._id }
      })
        .select('title')
        .lean();
      if (siblingNodes.some((item) => normalizeNodeTitle(item?.title, '') === requestedTitle)) {
        return res.status(400).json({ error: '同级节点中已存在同名节点，请修改第一行标题后再保存' });
      }
    }

    node.contentText = contentText;
    node.title = requestedTitle || (contentText.trim() ? extractNodeTitle(contentText) : normalizeNodeTitle(node.title, '未命名节点'));
    node.previewText = extractPreviewText(contentText);
    await node.save();
    await KnowledgeBrocade.updateOne(
      {
        _id: node.brocadeId,
        ownerUserId: node.ownerUserId,
        archivedAt: null
      },
      {
        $set: { updatedAt: new Date() }
      }
    );

    return res.json({
      success: true,
      node: serializeNodeSummary(node)
    });
  } catch (error) {
    console.error('保存知识锦节点内容错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

router.delete('/:brocadeId/nodes/:nodeId', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = getRequestUserId(req);
    const { brocadeId, nodeId } = req.params || {};
    if (!ownerUserId) return res.status(401).json({ error: '无效的用户身份' });

    const brocade = await loadOwnedBrocade(brocadeId, ownerUserId);
    if (!brocade) return res.status(404).json({ error: '知识锦不存在' });

    const node = await loadOwnedNode(brocadeId, nodeId, ownerUserId);
    if (!node) return res.status(404).json({ error: '节点不存在' });
    if (node.isRoot) {
      return res.status(400).json({ error: '根节点不能删除' });
    }

    const allNodes = await KnowledgeBrocadeNode.find({
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId
    })
      .select('_id parentNodeId')
      .lean();
    const deletedNodeIds = collectSubtreeNodeIds(allNodes, getIdString(node._id));

    if (deletedNodeIds.length < 1) {
      return res.status(400).json({ error: '未找到可删除节点' });
    }

    await KnowledgeBrocadeNode.deleteMany({
      _id: { $in: deletedNodeIds.map((id) => new mongoose.Types.ObjectId(id)) },
      brocadeId: brocade._id,
      ownerUserId: brocade.ownerUserId
    });

    brocade.nodeCount = Math.max(1, (Number(brocade.nodeCount) || 1) - deletedNodeIds.length);
    await brocade.save();

    return res.json({
      success: true,
      deletedNodeIds,
      brocade: serializeBrocade(brocade)
    });
  } catch (error) {
    console.error('删除知识锦节点错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
