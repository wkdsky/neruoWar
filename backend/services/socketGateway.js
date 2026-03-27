const { getIdString } = require('./socialChatService');

let socketServer = null;

const getUserSocketRoom = (userId) => `user:${getIdString(userId)}`;

const setSocketServer = (io) => {
  socketServer = io || null;
};

const emitToUser = (userId, eventName, payload = {}) => {
  if (!socketServer || !eventName) return false;
  const roomName = getUserSocketRoom(userId);
  socketServer.to(roomName).emit(eventName, payload);
  return true;
};

const emitToUsers = (userIds = [], eventName, payloadFactory = null) => {
  if (!socketServer || !eventName) return 0;
  const safeUserIds = Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((item) => getIdString(item))
      .filter(Boolean)
  ));

  safeUserIds.forEach((userId) => {
    const payload = typeof payloadFactory === 'function'
      ? payloadFactory(userId)
      : payloadFactory;
    socketServer.to(getUserSocketRoom(userId)).emit(eventName, payload || {});
  });

  return safeUserIds.length;
};

module.exports = {
  emitToUser,
  emitToUsers,
  getUserSocketRoom,
  setSocketServer
};
