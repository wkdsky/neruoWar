const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const Node = require('../models/Node');
const EntropyAlliance = require('../models/EntropyAlliance');
const DistributionResult = require('../models/DistributionResult');
const { authenticateToken } = require('../middleware/auth');
const { encodeTimeCursor, decodeTimeCursor, buildTimeCursorQuery } = require('../utils/cursorPagination');

const DISTRIBUTION_RESULT_PAGE_SIZE_MAX = 200;

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

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(getIdString(id));

const round2 = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
};

const parseCursor = (value = '') => {
  if (typeof value !== 'string') return null;
  return decodeTimeCursor(value);
};

router.get('/me/distribution-results', authenticateToken, async (req, res) => {
  try {
    const requestUserId = getIdString(req?.user?.userId);
    if (!isValidObjectId(requestUserId)) {
      return res.status(401).json({ error: '无效的用户身份' });
    }

    const user = await User.findById(requestUserId).select('_id allianceId').lean();
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const limit = Math.max(1, Math.min(DISTRIBUTION_RESULT_PAGE_SIZE_MAX, parseInt(req.query?.limit, 10) || 50));
    const rawCursor = typeof req.query?.cursor === 'string' ? req.query.cursor.trim() : '';
    const cursor = parseCursor(rawCursor);

    const query = {
      userId: new mongoose.Types.ObjectId(requestUserId)
    };
    const cursorQuery = buildTimeCursorQuery('createdAt', cursor);
    if (cursorQuery) {
      Object.assign(query, cursorQuery);
    }

    const rows = await DistributionResult.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .select('_id nodeId executeAt userId amount createdAt')
      .lean();

    const tail = rows.length > 0 ? rows[rows.length - 1] : null;
    const nextCursor = rows.length >= limit
      ? encodeTimeCursor({
        t: new Date(tail?.createdAt || 0),
        id: tail?._id
      })
      : null;

    const nodeIds = Array.from(new Set(
      rows
        .map((item) => getIdString(item?.nodeId))
        .filter((id) => isValidObjectId(id))
    )).map((id) => new mongoose.Types.ObjectId(id));

    const nodes = nodeIds.length > 0
      ? await Node.find({ _id: { $in: nodeIds } }).select('_id name allianceId').lean()
      : [];
    const nodeMap = new Map(nodes.map((item) => [getIdString(item?._id), item]));

    const allianceIds = Array.from(new Set(
      nodes
        .map((item) => getIdString(item?.allianceId))
        .filter((id) => isValidObjectId(id))
    )).map((id) => new mongoose.Types.ObjectId(id));

    const alliances = allianceIds.length > 0
      ? await EntropyAlliance.find({ _id: { $in: allianceIds } }).select('_id name').lean()
      : [];
    const allianceMap = new Map(alliances.map((item) => [getIdString(item?._id), item?.name || '']));

    return res.json({
      success: true,
      limit,
      cursor: rawCursor || null,
      nextCursor,
      rows: rows.map((item) => {
        const nodeId = getIdString(item?.nodeId);
        const node = nodeMap.get(nodeId) || null;
        const allianceId = getIdString(node?.allianceId);
        return {
          _id: getIdString(item?._id),
          nodeId,
          nodeName: node?.name || '',
          allianceId,
          allianceName: allianceMap.get(allianceId) || '',
          executeAt: item?.executeAt || null,
          amount: round2(Math.max(0, Number(item?.amount) || 0)),
          createdAt: item?.createdAt || null
        };
      })
    });
  } catch (error) {
    console.error('获取当前用户分发结果错误:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
