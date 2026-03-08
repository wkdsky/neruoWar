const mongoose = require('mongoose');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!isValidObjectId(value)) return null;
  return new mongoose.Types.ObjectId(String(value));
};

const getIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id && value._id !== value) return getIdString(value._id);
  if (typeof value === 'object' && typeof value.id === 'string' && value.id) return value.id;
  if (typeof value?.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : text;
  }
  return '';
};

module.exports = {
  getIdString,
  isValidObjectId,
  toObjectIdOrNull
};
