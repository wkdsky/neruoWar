const mongoose = require('mongoose');
const ScheduledTask = require('../models/ScheduledTask');

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const text = String(value);
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : null;
};

const normalizeRunAt = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date();
  return date;
};

const normalizeError = (err) => {
  if (!err) return '';
  if (typeof err === 'string') return err.slice(0, 1000);
  if (err instanceof Error) return (err.stack || err.message || String(err)).slice(0, 1000);
  try {
    return JSON.stringify(err).slice(0, 1000);
  } catch (jsonErr) {
    return String(err).slice(0, 1000);
  }
};

const enqueue = async ({ type, runAt = new Date(), payload = {}, dedupeKey } = {}) => {
  if (!type || typeof type !== 'string') {
    throw new Error('enqueue type is required');
  }

  const doc = {
    type: type.trim(),
    runAt: normalizeRunAt(runAt),
    status: 'ready',
    payload: payload && typeof payload === 'object' ? payload : {},
    lockOwner: '',
    lockedUntil: null,
    lastError: ''
  };
  if (dedupeKey && typeof dedupeKey === 'string') {
    doc.dedupeKey = dedupeKey.trim();
  }

  try {
    const created = await ScheduledTask.create(doc);
    return {
      task: created,
      created: true
    };
  } catch (error) {
    if (error?.code !== 11000 || !doc.dedupeKey) {
      throw error;
    }
    const existed = await ScheduledTask.findOne({ dedupeKey: doc.dedupeKey });
    return {
      task: existed,
      created: false
    };
  }
};

const claimOne = async ({ types, lockMs = 60 * 1000, ownerId = 'worker' } = {}) => {
  const now = new Date();
  const safeLockMs = Math.max(1000, parseInt(lockMs, 10) || 60 * 1000);
  const query = {
    status: 'ready',
    runAt: { $lte: now }
  };

  if (Array.isArray(types) && types.length > 0) {
    const normalizedTypes = types
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    if (normalizedTypes.length > 0) {
      query.type = { $in: normalizedTypes };
    }
  }

  return ScheduledTask.findOneAndUpdate(
    query,
    {
      $set: {
        status: 'running',
        lockOwner: ownerId,
        lockedUntil: new Date(now.getTime() + safeLockMs)
      },
      $inc: { attempts: 1 }
    },
    {
      sort: { runAt: 1, _id: 1 },
      new: true
    }
  );
};

const claimNext = async ({ types, limit = 1, lockMs = 60 * 1000, ownerId = 'worker' } = {}) => {
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 1));
  const tasks = [];
  for (let i = 0; i < safeLimit; i += 1) {
    const task = await claimOne({ types, lockMs, ownerId });
    if (!task) break;
    tasks.push(task);
  }
  return tasks;
};

const extendLock = async ({ taskId, ownerId = 'worker', lockMs = 60 * 1000 } = {}) => {
  const safeTaskId = toObjectId(taskId);
  if (!safeTaskId) {
    return { matchedCount: 0, modifiedCount: 0 };
  }
  const safeOwnerId = typeof ownerId === 'string' ? ownerId.trim() : '';
  if (!safeOwnerId) {
    return { matchedCount: 0, modifiedCount: 0 };
  }
  const safeLockMs = Math.max(10 * 1000, parseInt(lockMs, 10) || 60 * 1000);
  const now = Date.now();
  return ScheduledTask.updateOne(
    {
      _id: safeTaskId,
      status: 'running',
      lockOwner: safeOwnerId
    },
    {
      $set: {
        lockedUntil: new Date(now + safeLockMs)
      }
    }
  );
};

const complete = async (taskId) => {
  const safeTaskId = toObjectId(taskId);
  if (!safeTaskId) return { matchedCount: 0, modifiedCount: 0 };
  return ScheduledTask.updateOne(
    { _id: safeTaskId },
    {
      $set: {
        status: 'done',
        lockOwner: '',
        lockedUntil: null,
        lastError: ''
      }
    }
  );
};

const fail = async (taskId, err, { retry = true, backoffMs = 2000 } = {}) => {
  const safeTaskId = toObjectId(taskId);
  if (!safeTaskId) return { matchedCount: 0, modifiedCount: 0 };

  const row = await ScheduledTask.findById(safeTaskId).select('_id attempts');
  if (!row) return { matchedCount: 0, modifiedCount: 0 };

  const attempts = Math.max(1, parseInt(row.attempts, 10) || 1);
  const safeBackoffMs = Math.max(500, parseInt(backoffMs, 10) || 2000);
  const exponentialBackoffMs = Math.min(15 * 60 * 1000, safeBackoffMs * (2 ** Math.max(0, attempts - 1)));

  if (retry) {
    return ScheduledTask.updateOne(
      { _id: safeTaskId },
      {
        $set: {
          status: 'ready',
          runAt: new Date(Date.now() + exponentialBackoffMs),
          lockOwner: '',
          lockedUntil: null,
          lastError: normalizeError(err)
        }
      }
    );
  }

  return ScheduledTask.updateOne(
    { _id: safeTaskId },
    {
      $set: {
        status: 'failed',
        lockOwner: '',
        lockedUntil: null,
        lastError: normalizeError(err)
      }
    }
  );
};

const recoverExpiredLocks = async ({ now = new Date() } = {}) => {
  const safeNow = now instanceof Date ? now : new Date(now);
  return ScheduledTask.updateMany(
    {
      status: 'running',
      lockedUntil: { $lte: safeNow }
    },
    {
      $set: {
        status: 'ready',
        lockOwner: '',
        lockedUntil: null
      }
    }
  );
};

module.exports = {
  enqueue,
  claimNext,
  extendLock,
  complete,
  fail,
  recoverExpiredLocks
};
