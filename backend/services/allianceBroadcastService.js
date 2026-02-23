const mongoose = require('mongoose');
const EntropyAlliance = require('../models/EntropyAlliance');
const AllianceBroadcastEvent = require('../models/AllianceBroadcastEvent');
const User = require('../models/User');
const { writeNotificationsToCollection } = require('./notificationStore');

const NOTIFICATION_BATCH_SIZE = 1000;
const ALLOW_ALLIANCE_ANNOUNCEMENT_FANOUT = process.env.ALLOW_ALLIANCE_ANNOUNCEMENT_FANOUT === 'true';
const ALLOW_SIEGE_SUPPORT_FANOUT = process.env.ALLOW_SIEGE_SUPPORT_FANOUT === 'true';

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

const createNotificationId = () => new mongoose.Types.ObjectId();

const createEvent = async ({
  allianceId,
  type,
  actorUserId = null,
  actorUsername = '',
  nodeId = null,
  nodeName = '',
  gateKey = '',
  title = '',
  message = '',
  createdAt = new Date(),
  dedupeKey = ''
}) => {
  const safeCreatedAt = createdAt instanceof Date && Number.isFinite(createdAt.getTime())
    ? createdAt
    : new Date();
  const doc = {
    allianceId,
    type,
    actorUserId,
    actorUsername,
    nodeId,
    nodeName,
    gateKey: gateKey === 'cheng' || gateKey === 'qi' ? gateKey : '',
    title,
    message,
    createdAt: safeCreatedAt
  };
  if (typeof dedupeKey === 'string' && dedupeKey.trim()) {
    doc.dedupeKey = dedupeKey.trim();
  }

  try {
    return await AllianceBroadcastEvent.create(doc);
  } catch (error) {
    if (error?.code !== 11000 || !doc.dedupeKey) throw error;
    return AllianceBroadcastEvent.findOne({ dedupeKey: doc.dedupeKey });
  }
};

const fanoutAnnouncementNotificationLegacy = async ({
  allianceId,
  allianceName,
  announcement,
  actorUserId = null
}) => {
  if (!ALLOW_ALLIANCE_ANNOUNCEMENT_FANOUT) return 0;

  const query = { allianceId };
  if (isValidObjectId(actorUserId)) {
    query._id = { $ne: actorUserId };
  }

  let pendingDocs = [];
  let notifiedCount = 0;
  const cursor = User.find(query).select('_id').lean().cursor();

  for await (const member of cursor) {
    const createdAt = new Date();
    pendingDocs.push({
      _id: createNotificationId(),
      userId: member._id,
      type: 'alliance_announcement',
      title: `熵盟「${allianceName}」发布了新公告`,
      message: announcement,
      read: false,
      status: 'info',
      allianceId,
      allianceName,
      createdAt
    });

    if (pendingDocs.length >= NOTIFICATION_BATCH_SIZE) {
      await writeNotificationsToCollection(pendingDocs);
      notifiedCount += pendingDocs.length;
      pendingDocs = [];
    }
  }

  if (pendingDocs.length > 0) {
    await writeNotificationsToCollection(pendingDocs);
    notifiedCount += pendingDocs.length;
  }

  return notifiedCount;
};

const fanoutSiegeSupportNotificationLegacy = async ({
  allianceId,
  actorUserId,
  actorUsername,
  nodeId,
  nodeName,
  message,
  title
}) => {
  if (!ALLOW_SIEGE_SUPPORT_FANOUT) return 0;

  const memberQuery = {
    _id: { $ne: actorUserId },
    role: 'common',
    allianceId
  };
  const memberCursor = User.find(memberQuery).select('_id').lean().cursor();

  let notifiedCount = 0;
  let pendingDocs = [];
  const createdAt = new Date();

  for await (const member of memberCursor) {
    pendingDocs.push({
      _id: createNotificationId(),
      userId: member._id,
      type: 'info',
      title,
      message,
      read: false,
      status: 'info',
      nodeId: nodeId || null,
      nodeName: nodeName || '',
      allianceId: allianceId || null,
      allianceName: '',
      inviterId: actorUserId || null,
      inviterUsername: actorUsername || '',
      inviteeId: member._id,
      inviteeUsername: '',
      createdAt
    });

    if (pendingDocs.length >= NOTIFICATION_BATCH_SIZE) {
      await writeNotificationsToCollection(pendingDocs);
      notifiedCount += pendingDocs.length;
      pendingDocs = [];
    }
  }

  if (pendingDocs.length > 0) {
    await writeNotificationsToCollection(pendingDocs);
    notifiedCount += pendingDocs.length;
  }

  return notifiedCount;
};

const publishAllianceAnnouncement = async ({
  allianceId,
  announcement,
  actorUserId = null,
  actorUsername = '',
  dedupeKey = ''
}) => {
  const safeAllianceId = getIdString(allianceId);
  const normalizedAnnouncement = typeof announcement === 'string' ? announcement.trim() : '';
  if (!isValidObjectId(safeAllianceId) || !normalizedAnnouncement) {
    throw new Error('Invalid alliance announcement payload');
  }

  const alliance = await EntropyAlliance.findById(safeAllianceId).select('_id name');
  if (!alliance) {
    throw new Error('Alliance not found');
  }

  const now = new Date();

  const title = `熵盟「${alliance.name}」发布了新公告`;
  const event = await createEvent({
    allianceId: alliance._id,
    type: 'announcement',
    actorUserId: isValidObjectId(actorUserId) ? new mongoose.Types.ObjectId(getIdString(actorUserId)) : null,
    actorUsername: typeof actorUsername === 'string' ? actorUsername : '',
    title,
    message: normalizedAnnouncement,
    createdAt: now,
    dedupeKey
  });

  const eventAt = event?.createdAt instanceof Date
    ? event.createdAt
    : now;
  await EntropyAlliance.updateOne(
    { _id: alliance._id },
    {
      $set: {
        announcement: normalizedAnnouncement,
        announcementUpdatedAt: eventAt,
        broadcastUpdatedAt: eventAt
      }
    }
  );

  const notifiedCount = await fanoutAnnouncementNotificationLegacy({
    allianceId: alliance._id,
    allianceName: alliance.name,
    announcement: normalizedAnnouncement,
    actorUserId: isValidObjectId(actorUserId) ? new mongoose.Types.ObjectId(getIdString(actorUserId)) : null
  });

  return {
    allianceId: alliance._id,
    allianceName: alliance.name,
    eventId: event?._id || null,
    notifiedCount,
    announcementUpdatedAt: eventAt
  };
};

const publishSiegeSupportRequest = async ({
  allianceId,
  actorUserId,
  actorUsername = '',
  nodeId = null,
  nodeName = '',
  gateKey = '',
  message,
  title,
  dedupeKey = ''
}) => {
  const safeAllianceId = getIdString(allianceId);
  if (!isValidObjectId(safeAllianceId)) {
    throw new Error('Invalid allianceId');
  }

  const safeTitle = typeof title === 'string' ? title.trim() : '';
  const safeMessage = typeof message === 'string' ? message.trim() : '';
  const allianceObjectId = new mongoose.Types.ObjectId(safeAllianceId);
  const actorObjectId = isValidObjectId(actorUserId)
    ? new mongoose.Types.ObjectId(getIdString(actorUserId))
    : null;
  const nodeObjectId = isValidObjectId(nodeId)
    ? new mongoose.Types.ObjectId(getIdString(nodeId))
    : null;

  const event = await createEvent({
    allianceId: allianceObjectId,
    type: 'siege_support_request',
    actorUserId: actorObjectId,
    actorUsername,
    nodeId: nodeObjectId,
    nodeName,
    gateKey,
    title: safeTitle,
    message: safeMessage,
    dedupeKey
  });
  const eventAt = event?.createdAt instanceof Date ? event.createdAt : new Date();
  await EntropyAlliance.updateOne(
    { _id: allianceObjectId },
    {
      $set: {
        broadcastUpdatedAt: eventAt
      }
    }
  );

  const notifiedCount = await fanoutSiegeSupportNotificationLegacy({
    allianceId: allianceObjectId,
    actorUserId: actorObjectId,
    actorUsername,
    nodeId: nodeObjectId,
    nodeName,
    message: safeMessage,
    title: safeTitle
  });

  return {
    eventId: event?._id || null,
    notifiedCount
  };
};

module.exports = {
  ALLOW_ALLIANCE_ANNOUNCEMENT_FANOUT,
  ALLOW_SIEGE_SUPPORT_FANOUT,
  publishAllianceAnnouncement,
  publishSiegeSupportRequest
};
