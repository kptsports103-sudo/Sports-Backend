const User = require('../models/user.model');
const {
  buildAuthUserPayload,
  ensureDashboardRevealName,
  requestSecretKeySetupOTP,
  updateDashboardRevealName,
  verifySecretKeyForSession,
  verifySecretKeySetupOTP,
} = require('../services/accountSecurity.service');

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const safeUser = await ensureDashboardRevealName(user);
    res.json({ user: buildAuthUserPayload(safeUser) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.requestSecretKeyOtp = async (req, res) => {
  try {
    const result = await requestSecretKeySetupOTP(req.user.id);
    res.json(result);
  } catch (error) {
    console.error('Failed to request secret key OTP:', error);
    res.status(error?.statusCode || 500).json({
      code: error?.code || 'SECRET_KEY_OTP_FAILED',
      message: error?.message || 'Failed to send secret key OTP',
    });
  }
};

exports.verifySecretKeyOtp = async (req, res) => {
  try {
    const { otp, secretKey, confirmSecretKey } = req.body || {};
    const result = await verifySecretKeySetupOTP(req.user.id, otp, secretKey, confirmSecretKey);
    res.json(result);
  } catch (error) {
    console.error('Failed to verify secret key OTP:', error);
    res.status(error?.statusCode || 500).json({
      code: error?.code || 'SECRET_KEY_SETUP_FAILED',
      message: error?.message || 'Failed to create secret key',
    });
  }
};

exports.verifySecretKey = async (req, res) => {
  try {
    const { secretKey } = req.body || {};
    const result = await verifySecretKeyForSession(req.user.id, secretKey);
    res.json(result);
  } catch (error) {
    console.error('Failed to verify secret key:', error);
    res.status(error?.statusCode || 500).json({
      code: error?.code || 'SECRET_KEY_VERIFY_FAILED',
      message: error?.message || 'Failed to verify secret key',
    });
  }
};

exports.saveDashboardRevealName = async (req, res) => {
  try {
    const result = await updateDashboardRevealName(req.user.id, req.body?.dashboardRevealName);
    res.json(result);
  } catch (error) {
    console.error('Failed to save dashboard reveal name:', error);
    res.status(error?.statusCode || 500).json({
      code: error?.code || 'DASHBOARD_VALUE_SAVE_FAILED',
      message: error?.message || 'Failed to save dashboard value',
    });
  }
};
