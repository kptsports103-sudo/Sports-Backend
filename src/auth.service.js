const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/user.model');
const otpService = require('./services/otp.service');
const emailService = require('./services/email.service');
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
    await generateOTPForUser(user, normalizedEmail);
    return {
      message: 'OTP sent to your email',
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
  try {
    const otp = otpService.generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await User.findOneAndUpdate({ _id: user._id }, { otp, otp_expires_at: expiresAt });
    console.log(`[auth] OTP created for email=${email} userId=${user._id}`);
    await emailService.sendOTP(email, otp);
    console.log(`[auth] OTP delivery confirmed for email=${email}`);
  } catch (error) {
    console.error('[auth] OTP generation/delivery failed:', {
      code: error?.code || null,
      statusCode: error?.statusCode || null,
      message: error?.message || 'Unknown auth error',
    });
    const wrappedError = new Error(error?.message || 'Failed to generate and send OTP');
    wrappedError.statusCode = error?.statusCode || 503;
    wrappedError.code = error?.code || 'OTP_DELIVERY_FAILED';
    throw wrappedError;
  }
}

const verifyUserOTP = async (email, otp) => {
  try {
    const normalizedEmail = normalizeEmail(email);
    const normalizedOtp = normalizeOtp(otp);

    if (!normalizedEmail || normalizedOtp.length !== 6) {
      throw createAuthError('Invalid or expired OTP', 400, 'INVALID_OTP');
    }

    const users = await User.find({ email: normalizedEmail });
    const matchedUser = users.find((candidate) => String(candidate?.otp || '') === normalizedOtp);

    if (!matchedUser || !matchedUser.otp_expires_at || new Date(matchedUser.otp_expires_at) < new Date()) {
      throw createAuthError('Invalid or expired OTP', 400, 'INVALID_OTP');
    }
    // Clear OTP
    await User.findByIdAndUpdate(matchedUser._id, { otp: null, otp_expires_at: null, is_verified: true });
    const user = await ensureDashboardRevealName(matchedUser);
    // Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    return {
      token,
      user: buildAuthUserPayload(user),
    };
  } catch (error) {
    throw error;
  }
};

module.exports = { loginUser, verifyUserOTP };
