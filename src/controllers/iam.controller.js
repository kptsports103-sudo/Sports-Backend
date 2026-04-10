const User = require('../models/user.model');
const bcrypt = require('bcryptjs');
const otpService = require('../services/otp.service');
const { normalizeRole } = require('../utils/roleMapper');
const emailService = require('../services/email.service');
const smsService = require('../services/sms.service');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const { normalizeRole: normalizeAccessRole } = require('../utils/roles');
const { storeDataUri } = require('../services/hybridStorage.service');

// In-memory token store for onboarding (in production, use database)
const onboardingTokens = {};
const onboardingOTPs = {};
const onboardingVerifications = {};

const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  CREATOR: 'creator',
  VIEWER: 'viewer',
};

const CREATABLE_ROLES = [ROLES.ADMIN, ROLES.CREATOR];
const ONBOARDING_VERIFICATION_TTL_MS = 15 * 60 * 1000;
const ONBOARDING_ALLOWED_AUTH_ROLES = [ROLES.SUPERADMIN, ROLES.ADMIN];

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const getOnboardingStateKey = (email, token) => `${normalizeEmail(email)}::${String(token || '').trim()}`;

const getInvitationTokenData = (token) => {
  const safeToken = String(token || '').trim();
  if (!safeToken) return null;

  const tokenData = onboardingTokens[safeToken];
  if (!tokenData || tokenData.used || tokenData.expires < Date.now()) {
    return null;
  }

  return tokenData;
};

const resolveOnboardingAccess = (req, token) => {
  const requesterRole = getRequesterRoleFromAuthHeader(req);
  const tokenData = getInvitationTokenData(token);
  const hasPrivilegedAuth = ONBOARDING_ALLOWED_AUTH_ROLES.includes(requesterRole);

  return {
    requesterRole,
    tokenData,
    hasValidInvitationToken: Boolean(tokenData),
    hasPrivilegedAuth,
  };
};

const requireOnboardingAccess = (req, res, token) => {
  const access = resolveOnboardingAccess(req, token);

  if (access.hasPrivilegedAuth || access.hasValidInvitationToken) {
    return access;
  }

  res.status(403).json({
    message: 'Authenticated admin access or a valid invitation token is required.',
  });
  return null;
};

const getVerifiedOnboardingRecord = (email, token) => {
  const key = getOnboardingStateKey(email, token);
  const record = onboardingVerifications[key];

  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    delete onboardingVerifications[key];
    return null;
  }

  return record;
};

const canDeleteUser = (currentUser, targetUser) => {
  const currentRole = normalizeAccessRole(currentUser?.role);
  const targetRole = normalizeAccessRole(targetUser?.role);

  // Superadmin can delete admin/creator/viewer, but never superadmin.
  if (currentRole === ROLES.SUPERADMIN) {
    return targetRole !== ROLES.SUPERADMIN;
  }

  // Admin can delete only creator.
  if (currentRole === ROLES.ADMIN) {
    return targetRole === ROLES.CREATOR;
  }

  // Creator and others cannot delete.
  return false;
};

const getUsers = async (req, res) => {
  try {
    const requesterRole = normalizeAccessRole(req.user?.role);
    const requesterId = req.user?.id;
    let query = {};

    if (requesterRole === ROLES.ADMIN) {
      query = { role: { $in: [ROLES.ADMIN, ROLES.CREATOR] } };
    } else if (requesterRole === ROLES.CREATOR) {
      query = requesterId ? { _id: requesterId } : { _id: null };
    } else if (requesterRole !== ROLES.SUPERADMIN) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const users = await User.find(query).select('-password -otp -otp_expires_at');
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const getRequesterRoleFromAuthHeader = (req) => {
  const authHeader = String(req.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ') || !process.env.JWT_SECRET) {
    return null;
  }

  try {
    const token = authHeader.slice(7).trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return normalizeAccessRole(decoded?.role);
  } catch (error) {
    console.warn('Unable to resolve requester role for IAM onboarding:', error.message);
    return null;
  }
};

const canCreateOnboardingRole = ({ requesterRole, targetRole, hasValidInvitationToken }) => {
  if (hasValidInvitationToken) {
    return CREATABLE_ROLES.includes(targetRole);
  }

  if (requesterRole === ROLES.SUPERADMIN) {
    return CREATABLE_ROLES.includes(targetRole);
  }

  if (requesterRole === ROLES.ADMIN) {
    return CREATABLE_ROLES.includes(targetRole);
  }

  return targetRole === ROLES.CREATOR;
};

const createUser = async (req, res) => {
  const { email, password, name, phone, role } = req.body;

  try {
    // Normalize role to valid enum values
    const normalizedRole = normalizeRole(role);
    console.log('CreateUser: Role normalized from', role, 'to', normalizedRole);

    if (!CREATABLE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ message: 'Only admin and creator roles can be created.' });
    }

    // Validate mobile number format (basic validation for Indian numbers)
    const phoneRegex = /^[5-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number starting with 5-9' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase(), role: normalizedRole });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email and role already exists' });
    }

    // Removed phone number uniqueness check to allow multiple users with same phone

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user (verified by default - no SMS verification)
    const newUser = new User({
      name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: normalizedRole,
      is_verified: true, // Auto-verified since we're removing SMS
    });

    await newUser.save();

    res.json({
      message: 'User created successfully.',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        is_verified: true,
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    
    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      // Extract the duplicate field from the error message
      const duplicateField = Object.keys(error.keyValue)[0];
      const duplicateValue = error.keyValue[duplicateField];
      
      return res.status(409).json({ 
        message: `User with this ${duplicateField} already exists`,
        field: duplicateField,
        value: duplicateValue
      });
    }
    
    // Handle other specific errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: validationErrors 
      });
    }
    
    // Generic error
    res.status(500).json({ 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const verifyOTP = async (req, res) => {
  const { userId, otp } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ message: 'User is already verified' });
    }

    if (!user.otp || !user.otp_expires_at) {
      return res.status(400).json({ message: 'No OTP found for this user' });
    }

    if (new Date() > user.otp_expires_at) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Verify the user
    await User.findByIdAndUpdate(userId, {
      is_verified: true,
      otp: null,
      otp_expires_at: null,
    });

    res.json({
      message: 'Mobile number verified successfully. Account is now active.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        is_verified: true,
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(400).json({ message: error.message || 'Failed to verify OTP' });
  }
};

const resendOTP = async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ message: 'User is already verified' });
    }

    // Generate new OTP
    const otp = otpService.generateOTP();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Update user with new OTP
    await User.findByIdAndUpdate(userId, {
      otp,
      otp_expires_at: otpExpiresAt,
    });

    // Send OTP via SMS
    await smsService.sendOTP(user.phone, otp);

    res.json({
      message: 'OTP resent successfully to mobile number.',
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(400).json({ message: error.message || 'Failed to resend OTP' });
  }
};

const deleteUser = async (req, res) => {
  const { userId } = req.params;

  try {
    const requesterId = String(req.user?.id || '');
    const requesterRole = normalizeAccessRole(req.user?.role);
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetId = String(user._id);
    if (requesterId && requesterId === targetId) {
      return res.status(403).json({ message: 'Self-deletion is not allowed' });
    }

    if (!canDeleteUser({ role: requesterRole }, user)) {
      return res.status(403).json({ message: 'Permission denied' });
    }

    await User.findByIdAndDelete(userId);

    res.json({
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(400).json({ message: error.message || 'Failed to delete user' });
  }
};

// === TOKEN-BASED ONBOARDING SYSTEM ===

const createToken = async (req, res) => {
  const { phone, role = "Creator", source = "admin" } = req.body;

  try {
    // Normalize role before storing
    const normalizedRole = normalizeRole(role);
    console.log('CreateToken: Role normalized from', role, 'to', normalizedRole);

    if (!CREATABLE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ message: 'Only admin and creator roles can be invited.' });
    }

    const token = randomUUID();
    onboardingTokens[token] = {
      phone: phone || null,
      role: normalizedRole,
      source,
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      used: false,
      createdAt: new Date()
    };

    const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/iam/users?token=${token}`;

    res.json({
      message: 'Invitation token created successfully',
      token,
      link: inviteLink,
      expiresIn: '24 hours'
    });
  } catch (error) {
    console.error('Create token error:', error);
    res.status(500).json({ message: 'Failed to create invitation token' });
  }
};

const resolveToken = async (req, res) => {
  const { token } = req.query;

  try {
    const tokenData = onboardingTokens[token];

    if (!tokenData || tokenData.used || tokenData.expires < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    res.json({
      phone: tokenData.phone,
      role: tokenData.role,
      source: tokenData.source
    });
  } catch (error) {
    console.error('Resolve token error:', error);
    res.status(500).json({ message: 'Failed to resolve token' });
  }
};

const sendOTPOnboarding = async (req, res) => {
  const { email, token } = req.body;

  try {
    const access = requireOnboardingAccess(req, res, token);
    if (!access) return;

    const normalizedEmail = normalizeEmail(email);

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    // Generate OTP
    const otp = otpService.generateOTP();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP
    onboardingOTPs[getOnboardingStateKey(normalizedEmail, access.hasValidInvitationToken ? token : null)] = {
      otp,
      expiresAt: otpExpiresAt
    };

    // Send OTP via Email
    await emailService.sendOTP(normalizedEmail, otp);

    res.json({
      message: 'OTP sent successfully to email address',
      expiresIn: '5 minutes'
    });
  } catch (error) {
    console.error('Send OTP onboarding error:', error);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
};

const verifyOTPOnboarding = async (req, res) => {
  const { email, otp, token } = req.body;

  try {
    const access = requireOnboardingAccess(req, res, token);
    if (!access) return;

    const normalizedEmail = normalizeEmail(email);
    const stateKey = getOnboardingStateKey(normalizedEmail, access.hasValidInvitationToken ? token : null);
    const otpData = onboardingOTPs[stateKey];

    if (!otpData) {
      return res.status(400).json({ message: 'No OTP found for this email' });
    }

    if (new Date() > otpData.expiresAt) {
      delete onboardingOTPs[stateKey];
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (otpData.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Clear OTP after successful verification
    delete onboardingOTPs[stateKey];
    onboardingVerifications[stateKey] = {
      email: normalizedEmail,
      token: access.hasValidInvitationToken ? String(token).trim() : null,
      verifiedAt: Date.now(),
      expiresAt: Date.now() + ONBOARDING_VERIFICATION_TTL_MS,
    };

    res.json({
      message: 'Email verified successfully',
      verified: true
    });
  } catch (error) {
    console.error('Verify OTP onboarding error:', error);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
};

const verifyPhoneOTP = async (req, res) => {
  const { userId, otp } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ message: 'User is already verified' });
    }

    if (!user.otp || !user.otp_expires_at) {
      return res.status(400).json({ message: 'No OTP found for this user' });
    }

    if (new Date() > user.otp_expires_at) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Verify the user
    await User.findByIdAndUpdate(userId, {
      is_verified: true,
      otp: null,
      otp_expires_at: null,
    });

    res.json({
      message: 'Phone number verified successfully. Account is now active.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        is_verified: true,
      }
    });
  } catch (error) {
    console.error('Phone OTP verification error:', error);
    res.status(400).json({ message: error.message || 'Failed to verify OTP' });
  }
};

const verifyPhoneOTPWithLogin = async (req, res) => {
  const { userId, otp } = req.body;

  console.log('=== PHONE OTP VERIFICATION BACKEND DEBUG ===');
  console.log('Request body:', { userId, otp });

  try {
    const user = await User.findById(userId);
    console.log('Found user:', user ? 'YES' : 'NO');
    if (user) {
      console.log('User details:', { id: user._id, email: user.email, role: user.role, is_verified: user.is_verified });
    }
    
    if (!user) {
      console.log('ERROR: User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.is_verified) {
      console.log('ERROR: User already verified');
      return res.status(400).json({ message: 'User is already verified' });
    }

    if (!user.otp || !user.otp_expires_at) {
      console.log('ERROR: No OTP found');
      return res.status(400).json({ message: 'No OTP found for this user' });
    }

    console.log('Stored OTP:', user.otp);
    console.log('Provided OTP:', otp);
    console.log('OTP expires at:', user.otp_expires_at);
    console.log('Current time:', new Date());

    if (new Date() > user.otp_expires_at) {
      console.log('ERROR: OTP expired');
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (user.otp !== otp) {
      console.log('ERROR: Invalid OTP');
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    console.log('OTP verification successful, updating user...');

    // Verify the user and clear OTP
    await User.findByIdAndUpdate(userId, {
      is_verified: true,
      otp: null,
      otp_expires_at: null,
    });

    console.log('User updated successfully');

    // Generate JWT token for auto-login
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('JWT token generated');

    const responseData = {
      message: 'Phone number verified successfully. Account is now active.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profileImage: user.profileImage,
        is_verified: true,
      }
    };

    console.log('Sending response:', responseData);

    res.json(responseData);
  } catch (error) {
    console.error('=== PHONE OTP VERIFICATION ERROR ===');
    console.error('Error:', error);
    res.status(400).json({ message: error.message || 'Failed to verify OTP' });
  }
};

const createUserOnboarding = async (req, res) => {
  const { name, phone, email, password, role, token, profileImage } = req.body;

  console.log('Create user request:', { name, phone, email, role, hasToken: !!token });

  try {
    const access = requireOnboardingAccess(req, res, token);
    if (!access) return;

    // Check if token is provided (invitation-based) or direct onboarding
    let userRole = role; // Default to provided role
    const hasValidInvitationToken = access.hasValidInvitationToken;

    if (hasValidInvitationToken) {
      console.log('Validating token:', token);
      userRole = access.tokenData.role; // Use role from token
      console.log('Token validated, role:', userRole);

      const verifiedRecord = getVerifiedOnboardingRecord(email, token);
      if (!verifiedRecord) {
        return res.status(403).json({
          message: 'Email verification is required before creating an account from an invitation.',
        });
      }
    } else {
      console.log('Direct onboarding, using role:', role);
    }

    // Normalize role to valid enum values
    const normalizedRole = normalizeRole(userRole);
    console.log('Role normalized from', userRole, 'to', normalizedRole);

    const requesterRole = access.requesterRole;
    if (!canCreateOnboardingRole({ requesterRole, targetRole: normalizedRole, hasValidInvitationToken })) {
      return res.status(403).json({
        message: 'You do not have permission to create this role.'
      });
    }

    // Validate mobile number format (Indian numbers starting with 6-9)
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number starting with 6-9' });
    }

    // Check if user already exists (same email + role combination)
    const existingUser = await User.findOne({
      email: email.toLowerCase(),
      role: normalizedRole
    });

    if (existingUser) {
      console.log('User already exists with same email and role:', existingUser.email, existingUser.role);
      return res.status(400).json({
        message: `An account with this email already exists for the role "${normalizedRole}". Please use a different email or select a different role.`
      });
    }

    // Removed phone number uniqueness check to allow multiple users with same phone

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Upload profile image using hybrid storage if provided
    let profileImageUrl = null;
    if (profileImage) {
      try {
        console.log('Uploading profile image using hybrid storage...');
        const uploadResult = await storeDataUri({
          req,
          dataUri: profileImage,
          originalName: `user-${normalizeEmail(email)}-${Date.now()}.png`,
          folder: 'user-profiles',
          cloudinaryOptions: {
            folder: 'user-profiles',
            public_id: `user-${normalizeEmail(email)}-${Date.now()}`,
            transformation: [
              { width: 200, height: 200, crop: 'fill' },
              { quality: 'auto' }
            ]
          }
        });
        profileImageUrl = uploadResult.url;
        console.log('✅ Profile image uploaded to Cloudinary:', profileImageUrl);
      } catch (uploadError) {
        console.error('❌ Cloudinary upload error:', uploadError.message);
        console.error('Full error:', uploadError);
        // Return error instead of continuing without image
        return res.status(500).json({
          message: `Profile image upload failed: ${uploadError.message}. Please check Cloudinary configuration.`
        });
      }
    } else {
      console.log('No profile image provided');
    }

    // Create new user (verified by default - no SMS verification)
    const newUser = new User({
      name,
      email: normalizeEmail(email),
      phone,
      password: hashedPassword,
      role: normalizedRole,
      profileImage: profileImageUrl,
      is_verified: true, // Auto-verified since we're removing SMS
      createdAt: new Date()
    });

    await newUser.save();

    // Mark token as used if it was provided
    if (token) {
      const tokenData = onboardingTokens[token];
      if (tokenData) {
        tokenData.used = true;
      }
      delete onboardingVerifications[getOnboardingStateKey(email, token)];
    }

    res.json({
      message: 'Account created successfully.',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        profileImage: newUser.profileImage,
        is_verified: true
      }
    });
  } catch (error) {
    console.error('Create user onboarding error:', error);

    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyValue)[0];
      const duplicateValue = error.keyValue[duplicateField];

      return res.status(409).json({
        message: `User with this ${duplicateField} already exists`,
        field: duplicateField,
        value: duplicateValue
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    res.status(500).json({
      message: 'Failed to create account',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export all functions for CommonJS
module.exports = {
  getUsers,
  createUser,
  verifyOTP,
  resendOTP,
  deleteUser,
  createToken,
  resolveToken,
  sendOTPOnboarding,
  verifyOTPOnboarding,
  createUserOnboarding,
  verifyPhoneOTP,
  verifyPhoneOTPWithLogin
};
