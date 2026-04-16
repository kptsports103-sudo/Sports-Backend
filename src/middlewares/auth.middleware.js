const jwt = require('jsonwebtoken');
const { attachAutomaticActivityLogger } = require('../services/activityLog.service');
const User = require('../models/user.model');
const { normalizeRole } = require('../utils/roles');
const { verifySecretKeySessionToken } = require('../services/accountSecurity.service');

const EDIT_PROTECTED_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);
const SECRET_KEY_ELIGIBLE_ROLES = new Set(['creator', 'admin', 'superadmin']);

const validateSecretKeyAccess = async (req, res) => {
  if (!SECRET_KEY_ELIGIBLE_ROLES.has(req.user?.role)) {
    return true;
  }

  const currentUser = await User.findById(req.user.id);

  if (!currentUser) {
    res.status(401).json({ message: 'User not found' });
    return false;
  }

  if (!currentUser.secretKeyHash) {
    res.status(428).json({
      code: 'SECRET_KEY_SETUP_REQUIRED',
      message: 'Create your secret key first before opening Darya pages or editing dashboard content.',
    });
    return false;
  }

  const secretKeyToken = req.header('X-Secret-Key-Token');
  if (!secretKeyToken) {
    res.status(403).json({
      code: 'SECRET_KEY_REQUIRED',
      message: 'Verify your secret key first before opening this protected admin page.',
    });
    return false;
  }

  try {
    verifySecretKeySessionToken(secretKeyToken, req.user.id);
  } catch (error) {
    res.status(error?.statusCode || 403).json({
      code: error?.code || 'INVALID_SECRET_KEY',
      message: error?.message || 'Secret key verification failed.',
    });
    return false;
  }

  return true;
};

const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);

    req.user = {
      ...decoded,
      role: normalizeRole(decoded?.role),
    };

    const method = String(req.method || '').toUpperCase();
    if (EDIT_PROTECTED_METHODS.has(method)) {
      const isAllowed = await validateSecretKeyAccess(req, res);
      if (!isAllowed) {
        return;
      }
    }

    attachAutomaticActivityLogger(req, res);
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const requireSecretKeyVerification = async (req, res, next) => {
  const isAllowed = await validateSecretKeyAccess(req, res);
  if (!isAllowed) {
    return;
  }

  next();
};

module.exports = authMiddleware;
module.exports.requireSecretKeyVerification = requireSecretKeyVerification;
