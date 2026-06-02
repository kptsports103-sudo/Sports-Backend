const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/user.model');
const otpService = require('./services/otp.service');
const { sendOTPWithFallback } = require('./services/otpDelivery.service');
const { buildAuthUserPayload, ensureDashboardRevealName } = require('./services/accountSecurity.service');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeOtp = (value) => String(value || '').replace(/\D/g, '').trim();
const normalizeRole = (value) => String(value || '').trim().toLowerCase();
const isPasswordHash = (value) => /^\$2[aby]?\$/.test(String(value || ''));
const createAuthError = (message, statusCode = 400, code = 'AUTH_ERROR') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const loginUser = async (email, password, role) => {
  const requestId = Math.random().toString(36).slice(2, 11);
  const normalizedEmail = normalizeEmail(email);
  const normalizedRequestedRole = normalizeRole(role);

  console.log(`[auth] login attempt requestId=${requestId} email=${normalizedEmail} role=${normalizedRequestedRole || 'auto'}`);

  const users = await User.find({ email: normalizedEmail });
  console.log(`[auth] matched users requestId=${requestId} count=${users.length}`);

  if (!users.length) {
    throw createAuthError('User not found', 404, 'USER_NOT_FOUND');
  }

  const roleMatchedUsers = normalizedRequestedRole
    ? users.filter((candidate) => normalizeRole(candidate.role) === normalizedRequestedRole)
    : users;

  if (normalizedRequestedRole && !roleMatchedUsers.length) {
    throw createAuthError(`Invalid role. No ${role} account found for ${normalizedEmail}.`, 400, 'ROLE_MISMATCH');
  }

  const passwordCapableUsers = roleMatchedUsers.filter((candidate) => isPasswordHash(candidate.password));
  if (!passwordCapableUsers.length) {
    throw createAuthError('This account does not support password login', 400, 'PASSWORD_LOGIN_UNAVAILABLE');
  }

  let user = null;
  for (const candidate of passwordCapableUsers) {
    const candidateMatch = await bcrypt.compare(password, candidate.password);
    console.log(`[auth] password check requestId=${requestId} role=${candidate.role} matched=${candidateMatch}`);
    if (candidateMatch) {
      if (user) {
        throw createAuthError(
          'Multiple accounts found for this email. Please sign in with a specific role.',
          400,
          'MULTIPLE_ROLE_MATCH'
        );
      }
      user = candidate;
    }
  }

  if (!user) {
    throw createAuthError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const normalizedUserRole = normalizeRole(user.role);

  if (normalizedRequestedRole && normalizedUserRole !== normalizedRequestedRole) {
    throw createAuthError(
      `Invalid role. User role is ${user.role}, but ${role} was requested.`,
      400,
      'ROLE_MISMATCH'
    );
  }

  user = await ensureDashboardRevealName(user);

  if (['superadmin', 'admin', 'creator'].includes(normalizedUserRole)) {
    const delivery = await generateOTPForUser(user, normalizedEmail);
    return {
      requiresOTP: true,
      message: delivery.channel === 'sms' ? 'OTP sent via SMS.' : 'OTP sent to your email.',
      deliveryChannel: delivery.channel,
      user: buildAuthUserPayload(user),
    };
  }

  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  return {
    token,
    user: buildAuthUserPayload(user),
  };
};

async function generateOTPForUser(user, email) {
  const otp = otpService.generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  const hasPhone = Boolean(String(user?.phone || '').trim());

  await User.findOneAndUpdate({ _id: user._id }, { otp, otp_expires_at: expiresAt });
  console.log(`[auth] OTP created for email=${email} userId=${user._id}`);

  try {
    const delivery = await sendOTPWithFallback({
      email,
      phone: hasPhone ? user.phone : undefined,
      otp,
      allowSmsFallback: hasPhone,
      fallbackMessage: 'OTP delivery is temporarily unavailable. Please try again in a minute.',
    });
    console.log(`[auth] OTP delivery confirmed for email=${email} channel=${delivery.channel}`);
    return delivery;
  } catch (error) {
    console.error('[auth] OTP generation/delivery failed:', {
      code: error?.code || null,
      statusCode: error?.statusCode || null,
      message: error?.message || 'Unknown auth error',
    });

    try {
      await User.findByIdAndUpdate(user._id, { otp: null, otp_expires_at: null });
    } catch (cleanupError) {
      console.warn('[auth] Failed to clear undelivered OTP:', cleanupError.message);
    }

    const wrappedError = new Error(error?.message || 'Failed to generate and send OTP');
    wrappedError.statusCode = error?.statusCode || 503;
    wrappedError.code = error?.code || 'OTP_DELIVERY_FAILED';
    wrappedError.retryAfter = error?.retryAfter || 30;
    throw wrappedError;
  }
}

const verifyUserOTP = async (email, otp, role) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedOtp = normalizeOtp(otp);
  const normalizedRequestedRole = normalizeRole(role);

  if (!normalizedEmail || normalizedOtp.length !== 6) {
    throw createAuthError('Invalid or expired OTP', 400, 'INVALID_OTP');
  }

  const users = await User.find({ email: normalizedEmail });
  const roleMatchedUsers = normalizedRequestedRole
    ? users.filter((candidate) => normalizeRole(candidate.role) === normalizedRequestedRole)
    : users;

  if (normalizedRequestedRole && !roleMatchedUsers.length) {
    throw createAuthError(
      `Invalid role. No ${role} account found for ${normalizedEmail}.`,
      400,
      'ROLE_MISMATCH'
    );
  }

  const matchedUsers = roleMatchedUsers.filter((candidate) => String(candidate?.otp || '') === normalizedOtp);

  if (!matchedUsers.length) {
    throw createAuthError('Invalid or expired OTP', 400, 'INVALID_OTP');
  }

  if (matchedUsers.length > 1) {
    throw createAuthError(
      'Multiple accounts matched this OTP. Please sign in again.',
      400,
      'MULTIPLE_ROLE_MATCH'
    );
  }

  const matchedUser = matchedUsers[0];

  if (!matchedUser.otp_expires_at || new Date(matchedUser.otp_expires_at) < new Date()) {
    throw createAuthError('Invalid or expired OTP', 400, 'INVALID_OTP');
  }

  await User.findByIdAndUpdate(matchedUser._id, { otp: null, otp_expires_at: null, is_verified: true });
  const user = await ensureDashboardRevealName(matchedUser);

  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  return {
    token,
    user: buildAuthUserPayload(user),
  };
};

module.exports = { loginUser, verifyUserOTP };
