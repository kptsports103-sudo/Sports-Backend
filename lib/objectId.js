const crypto = require('crypto');

const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;

const createObjectId = () => crypto.randomBytes(12).toString('hex');

const isValidObjectId = (value) => OBJECT_ID_REGEX.test(String(value || '').trim());

module.exports = {
  createObjectId,
  isValidObjectId,
};
