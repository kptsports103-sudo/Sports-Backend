const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/user.model');
const otpService = require('./otp.service');
const emailService = require('./email.service');
const { hashPassword } = require('../utils/password.util');
const { normalizeRole } = require('../utils/roles');

const OTP_TTL_MS = 5 * 60 * 1000;
const SECRET_KEY_MIN_LENGTH = 4;
const SECRET_KEY_MAX_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 6;
const DASHBOARD_REVEAL_NAME_MAX_LENGTH = 80;
const parsedSecretKeySessionTtl = Number(process.env.SECRET_KEY_SESSION_TTL_SECONDS || 15 * 60);
const SECRET_KEY_JWT_TTL = Number.isFinite(parsedSecretKeySessionTtl) ? parsedSecretKeySessionTtl : 15 * 60;
const SECRET_KEY_JWT_SECRET = process.env.SECRET_KEY_SESSION_SECRET || process.env.JWT_SECRET;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeOtp = (value) => String(value || '').replace(/\D/g, '').slice(0, 6);
const normalizeSecretKey = (value) => String(value || '').trim();
const isPasswordHash = (value) => /^\$2[aby]?\$/.test(String(value || ''));

const createSecurityError = (message, statusCode = 400, code = 'SECURITY_ERROR') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const ensureSecretKeyJwtSecret = () => {
  if (!SECRET_KEY_JWT_SECRET) {
    throw createSecurityError('Secret key session is not configured', 500, 'SECRET_KEY_CONFIG_MISSING');
  }
};

const ensureDashboardRevealName = async (user) => {
  if (!user?._id) {
    return user;
  }

  if (String(user.dashboardRevealName || '').trim()) {
    return user;
  }

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { dashboardRevealName: 'Darya' },
    { new: true }
  );

  return updatedUser || user;
};

const buildAuthUserPayload = (user) => ({
  id: user?._id,
  email: user?.email || '',
  role: user?.role || 'viewer',
  name: user?.name || '',
  profileImage: user?.profileImage || '',
  hasSecretKey: Boolean(user?.secretKeyHash),
  dashboardRevealName: String(user?.dashboardRevealName || 'Darya').trim() || 'Darya',
});

const findSingleUserByEmail = async (email, role) => {
  const normalizedEmail = normalizeEmail(email);
  const requestedRole = normalizeRole(role);

  if (!normalizedEmail) {
    throw createSecurityError('Email is required', 400, 'EMAIL_REQUIRED');
  }

  const users = await User.find({ email: normalizedEmail });

  if (!users.length) {
    return null;
  }

  const matchedUsers = role
    ? users.filter((candidate) => normalizeRole(candidate.role) === requestedRole)
    : users;

  if (!matchedUsers.length) {
    throw createSecurityError(`No ${role} account found for ${normalizedEmail}.`, 404, 'ROLE_MISMATCH');
  }

  if (matchedUsers.length > 1) {
    throw createSecurityError(
      'Multiple accounts are linked to this email. Please select the correct role.',
      400,
      'MULTIPLE_ACCOUNTS'
    );
  }

  return matchedUsers[0];
};

const createSecretKeySessionToken = (user) => {
  ensureSecretKeyJwtSecret();

  return jwt.sign(
    {
      sub: String(user?._id || ''),
      role: normalizeRole(user?.role),
      purpose: 'secret-key-session',
    },
    SECRET_KEY_JWT_SECRET,
    { expiresIn: SECRET_KEY_JWT_TTL }
  );
};

const verifySecretKeySessionToken = (token, userId) => {
  ensureSecretKeyJwtSecret();

  const payload = jwt.verify(String(token || '').trim(), SECRET_KEY_JWT_SECRET);
  if (payload?.purpose !== 'secret-key-session' || String(payload?.sub || '') !== String(userId || '')) {
    throw createSecurityError('Secret key verification is invalid. Please verify again.', 403, 'INVALID_SECRET_KEY');
  }

  return payload;
};

const validateSecretKeyInput = (secretKey, confirmSecretKey) => {
  const normalizedSecretKey = normalizeSecretKey(secretKey);
  const normalizedConfirmSecretKey = normalizeSecretKey(confirmSecretKey);

  if (
    normalizedSecretKey.length < SECRET_KEY_MIN_LENGTH ||
    normalizedSecretKey.length > SECRET_KEY_MAX_LENGTH
  ) {
    throw createSecurityError(
      `Secret key must be between ${SECRET_KEY_MIN_LENGTH} and ${SECRET_KEY_MAX_LENGTH} characters.`,
      400,
      'INVALID_SECRET_KEY_LENGTH'
    );
  }

  if (normalizedSecretKey !== normalizedConfirmSecretKey) {
    throw createSecurityError('Secret key and confirm secret key must match.', 400, 'SECRET_KEY_MISMATCH');
  }

  return normalizedSecretKey;
};

const requestSecretKeySetupOTP = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw createSecurityError('User not found', 404, 'USER_NOT_FOUND');
  }

  const otp = otpService.generateOTP();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await User.findByIdAndUpdate(user._id, {
    secretKeyOtp: otp,
    secretKeyOtpExpiresAt: expiresAt,
  });

  await emailService.sendOTP(user.email, otp);

  return {
    message: `OTP sent to ${user.email}`,
  };
};

const verifySecretKeySetupOTP = async (userId, otp, secretKey, confirmSecretKey) => {
  const user = await User.findById(userId);

  if (!user) {
    throw createSecurityError('User not found', 404, 'USER_NOT_FOUND');
  }

  const normalizedOtp = normalizeOtp(otp);
  if (!normalizedOtp || normalizedOtp.length !== 6) {
    throw createSecurityError('Please enter a valid 6-digit OTP.', 400, 'INVALID_OTP');
  }

  if (
    String(user.secretKeyOtp || '') !== normalizedOtp ||
    !user.secretKeyOtpExpiresAt ||
    new Date(user.secretKeyOtpExpiresAt) < new Date()
  ) {
    throw createSecurityError('Invalid or expired OTP.', 400, 'INVALID_OTP');
  }

  const normalizedSecretKey = validateSecretKeyInput(secretKey, confirmSecretKey);
  const secretKeyHash = await bcrypt.hash(normalizedSecretKey, 10);

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    {
      secretKeyHash,
      secretKeyOtp: null,
      secretKeyOtpExpiresAt: null,
      secretKeyUpdatedAt: new Date().toISOString(),
    },
    { new: true }
  );

  return {
    message: 'Secret key created successfully.',
    secretKeyToken: createSecretKeySessionToken(updatedUser),
    user: buildAuthUserPayload(updatedUser),
  };
};

const verifySecretKeyForSession = async (userId, secretKey) => {
  const user = await User.findById(userId);

  if (!user) {
    throw createSecurityError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (!user.secretKeyHash) {
    throw createSecurityError(
      'Create your secret key first before editing dashboard content.',
      428,
      'SECRET_KEY_SETUP_REQUIRED'
    );
  }

  const normalizedSecretKey = normalizeSecretKey(secretKey);
  if (!normalizedSecretKey) {
    throw createSecurityError('Secret key is required.', 400, 'SECRET_KEY_REQUIRED');
  }

  const isValid = await bcrypt.compare(normalizedSecretKey, user.secretKeyHash);
  if (!isValid) {
    throw createSecurityError('Secret key is incorrect.', 403, 'INVALID_SECRET_KEY');
  }

  return {
    message: 'Secret key verified.',
    secretKeyToken: createSecretKeySessionToken(user),
    user: buildAuthUserPayload(user),
  };
};

const requestPasswordResetOTP = async (email, role) => {
  const user = await findSingleUserByEmail(email, role);

  if (!user) {
    return {
      message: 'If an account exists, an OTP has been sent to your email.',
    };
  }

  if (!isPasswordHash(user.password)) {
    throw createSecurityError('This account does not support password reset.', 400, 'PASSWORD_RESET_UNAVAILABLE');
  }

  const otp = otpService.generateOTP();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await User.findByIdAndUpdate(user._id, {
    passwordResetOtp: otp,
    passwordResetOtpExpiresAt: expiresAt,
  });

  await emailService.sendOTP(user.email, otp);

  return {
    message: `OTP sent to ${user.email}`,
  };
};

const resetPasswordWithOTP = async ({ email, otp, newPassword, role }) => {
  const user = await findSingleUserByEmail(email, role);

  if (!user) {
    throw createSecurityError('User not found', 404, 'USER_NOT_FOUND');
  }

  const normalizedOtp = normalizeOtp(otp);
  if (!normalizedOtp || normalizedOtp.length !== 6) {
    throw createSecurityError('Please enter a valid 6-digit OTP.', 400, 'INVALID_OTP');
  }

  if (
    String(user.passwordResetOtp || '') !== normalizedOtp ||
    !user.passwordResetOtpExpiresAt ||
    new Date(user.passwordResetOtpExpiresAt) < new Date()
  ) {
    throw createSecurityError('Invalid or expired OTP.', 400, 'INVALID_OTP');
  }

  const safePassword = String(newPassword || '');
  if (safePassword.length < PASSWORD_MIN_LENGTH) {
    throw createSecurityError(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
      400,
      'INVALID_PASSWORD_LENGTH'
    );
  }

  const password = await hashPassword(safePassword);

  await User.findByIdAndUpdate(user._id, {
    password,
    passwordResetOtp: null,
    passwordResetOtpExpiresAt: null,
    otp: null,
    otp_expires_at: null,
  });

  return {
    message: 'Password reset successful. Please log in with your new password.',
  };
};

const updateDashboardRevealName = async (userId, value) => {
  const user = await User.findById(userId);

  if (!user) {
    throw createSecurityError('User not found', 404, 'USER_NOT_FOUND');
  }

  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    throw createSecurityError('Enter a value to store for this admin.', 400, 'DASHBOARD_VALUE_REQUIRED');
  }

  if (normalizedValue.length > DASHBOARD_REVEAL_NAME_MAX_LENGTH) {
    throw createSecurityError(
      `Dashboard value must be ${DASHBOARD_REVEAL_NAME_MAX_LENGTH} characters or less.`,
      400,
      'DASHBOARD_VALUE_TOO_LONG'
    );
  }

  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    { dashboardRevealName: normalizedValue },
    { new: true }
  );

  return {
    message: 'Admin dashboard value saved successfully.',
    user: buildAuthUserPayload(updatedUser || user),
  };
};

module.exports = {
  ensureDashboardRevealName,
  buildAuthUserPayload,
  createSecurityError,
  createSecretKeySessionToken,
  normalizeEmail,
  requestPasswordResetOTP,
  requestSecretKeySetupOTP,
  resetPasswordWithOTP,
  updateDashboardRevealName,
  verifySecretKeyForSession,
  verifySecretKeySessionToken,
  verifySecretKeySetupOTP,
};
