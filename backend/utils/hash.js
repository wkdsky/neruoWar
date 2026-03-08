const crypto = require('crypto');

const stableHash = (value = '') => crypto
  .createHash('sha1')
  .update(String(value || ''), 'utf8')
  .digest('hex');

const shortHash = (value = '', length = 12) => stableHash(value).slice(0, Math.max(4, Number(length) || 12));

module.exports = {
  stableHash,
  shortHash
};
