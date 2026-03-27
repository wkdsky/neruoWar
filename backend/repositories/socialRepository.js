const mongoose = require('mongoose');

const User = require('../models/User');
const Friendship = require('../models/Friendship');
const EntropyAlliance = require('../models/EntropyAlliance');
const { getIdString, isValidObjectId } = require('../services/socialChatService');

const toObjectId = (value) => new mongoose.Types.ObjectId(getIdString(value));

const searchUsersByKeyword = async ({ excludeUserId, keywordRegex, limit = 20 }) => User.find({
  _id: { $ne: toObjectId(excludeUserId) },
  username: keywordRegex
})
  .select('_id username avatar profession allianceId')
  .sort({ createdAt: -1 })
  .limit(limit)
  .lean();

const findUsersByIds = async (ids = []) => {
  const safeIds = Array.from(new Set(
    (Array.isArray(ids) ? ids : [])
      .map((item) => getIdString(item))
      .filter((item) => isValidObjectId(item))
  ));
  if (safeIds.length === 0) return [];
  return User.find({
    _id: { $in: safeIds.map((item) => toObjectId(item)) }
  })
    .select('_id username avatar profession allianceId notifications')
    .lean();
};

const findUserById = async (userId, select = '_id username avatar profession allianceId notifications') => {
  const safeId = getIdString(userId);
  if (!isValidObjectId(safeId)) return null;
  return User.findById(safeId).select(select);
};

const findAllianceNamesByIds = async (ids = []) => {
  const safeIds = Array.from(new Set(
    (Array.isArray(ids) ? ids : [])
      .map((item) => getIdString(item))
      .filter((item) => isValidObjectId(item))
  ));
  if (safeIds.length === 0) return [];
  return EntropyAlliance.find({
    _id: { $in: safeIds.map((item) => toObjectId(item)) }
  })
    .select('_id name')
    .lean();
};

const countAcceptedFriendshipsForUser = async (userId) => {
  const safeId = getIdString(userId);
  if (!isValidObjectId(safeId)) return 0;
  return Friendship.countDocuments({
    status: 'accepted',
    $or: [
      { requesterId: toObjectId(safeId) },
      { addresseeId: toObjectId(safeId) }
    ]
  });
};

const findFriendshipByParticipantsKey = async (participantsKey) => Friendship.findOne({ participantsKey });

const findAcceptedFriendshipByParticipantsKey = async (participantsKey) => Friendship.findOne({
  participantsKey,
  status: 'accepted'
}).lean();

const findFriendshipById = async (friendshipId) => {
  const safeId = getIdString(friendshipId);
  if (!isValidObjectId(safeId)) return null;
  return Friendship.findById(safeId);
};

const listPendingFriendshipsForUser = async ({ userId, direction }) => {
  const safeId = getIdString(userId);
  if (!isValidObjectId(safeId)) return [];
  const fieldName = direction === 'received' ? 'addresseeId' : 'requesterId';
  return Friendship.find({
    [fieldName]: toObjectId(safeId),
    status: 'pending'
  })
    .sort({ createdAt: -1 })
    .lean();
};

const listAcceptedFriendshipsForUser = async (userId) => {
  const safeId = getIdString(userId);
  if (!isValidObjectId(safeId)) return [];
  return Friendship.find({
    status: 'accepted',
    $or: [
      { requesterId: toObjectId(safeId) },
      { addresseeId: toObjectId(safeId) }
    ]
  })
    .sort({ acceptedAt: -1, createdAt: -1 })
    .lean();
};

const listFriendshipsByParticipantsKeys = async (keys = []) => {
  const safeKeys = Array.from(new Set((Array.isArray(keys) ? keys : []).filter(Boolean)));
  if (safeKeys.length === 0) return [];
  return Friendship.find({ participantsKey: { $in: safeKeys } })
    .select('_id requesterId addresseeId status participantsKey requestMessage createdAt acceptedAt respondedAt')
    .lean();
};

const createFriendship = async (doc) => Friendship.create(doc);

module.exports = {
  countAcceptedFriendshipsForUser,
  createFriendship,
  findAcceptedFriendshipByParticipantsKey,
  findAllianceNamesByIds,
  findFriendshipById,
  findFriendshipByParticipantsKey,
  findUserById,
  findUsersByIds,
  listAcceptedFriendshipsForUser,
  listFriendshipsByParticipantsKeys,
  listPendingFriendshipsForUser,
  searchUsersByKeyword
};
