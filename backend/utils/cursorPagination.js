const mongoose = require('mongoose');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const toObjectId = (value) => {
  if (!isValidObjectId(value)) return null;
  return new mongoose.Types.ObjectId(String(value));
};

const encodeTimeCursor = ({ t, id } = {}) => {
  if (!(t instanceof Date) || !Number.isFinite(t.getTime()) || !isValidObjectId(id)) {
    return null;
  }
  const payload = {
    t: t.toISOString(),
    id: String(id)
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

const decodeTimeCursor = (token = '') => {
  if (typeof token !== 'string' || !token.trim()) return null;
  const raw = token.trim();

  // backward compatibility: plain ObjectId cursor
  if (isValidObjectId(raw)) {
    return {
      t: null,
      id: toObjectId(raw),
      legacyIdOnly: true
    };
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const time = new Date(parsed?.t || 0);
    const id = toObjectId(parsed?.id);
    if (!Number.isFinite(time.getTime()) || !id) return null;
    return {
      t: time,
      id,
      legacyIdOnly: false
    };
  } catch (error) {
    return null;
  }
};

const buildTimeCursorQuery = (fieldName, cursor = null) => {
  if (!fieldName || !cursor) return null;
  if (cursor.legacyIdOnly && cursor.id) {
    return { _id: { $lt: cursor.id } };
  }
  if (!(cursor.t instanceof Date) || !cursor.id) return null;

  const eq = {};
  eq[fieldName] = cursor.t;
  return {
    $or: [
      { [fieldName]: { $lt: cursor.t } },
      {
        ...eq,
        _id: { $lt: cursor.id }
      }
    ]
  };
};

module.exports = {
  encodeTimeCursor,
  decodeTimeCursor,
  buildTimeCursorQuery
};
