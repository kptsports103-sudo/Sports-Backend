const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/user.model');
const otpService = require('./services/otp.service');
const emailService = require('./services/email.service');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeOtp = (value) => String(value || '').replace(/\D/g, '').trim();
const normalizeRole = (value) => String(value || '').trim().toLowerCase();
const isPasswordHash = (value) => /^\$2[aby]?\$/.test(String(value || ''));

const loginUser = async (email, password, role) => {
  const requestId = Math.random().toString(36).substr(2, 9);
  try {
    console.log('=== LOGIN ATTEMPT ===', requestId);
    console.log('Request ID:', requestId);
    console.log('Email:', normalizeEmail(email));
    console.log('Requested role:', role);
    console.log('Password provided:', !!password);
    console.log('Password length:', password ? password.length : 'N/A');
    console.log('Password chars:', password ? password.split('').map(c => `${c}(${c.charCodeAt(0)})`).join(' ') : 'N/A');
    
    // Normalize email
    const normalizedEmail = normalizeEmail(email);
    const normalizedRequestedRole = normalizeRole(role);
    console.log('Normalized email:', normalizedEmail);
    
    const users = await User.find({ email: normalizedEmail });
    console.log('Users found by email:', users.length);

    if (!users.length) {
      console.log('ERROR: User not found with email:', normalizedEmail);
      throw new Error('User not found');
    }

    const roleMatchedUsers = normalizedRequestedRole
      ? users.filter((candidate) => normalizeRole(candidate.role) === normalizedRequestedRole)
      : users;

    if (normalizedRequestedRole && !roleMatchedUsers.length) {
      console.log('ERROR: Role mismatch - no user found for requested role:', role);
      throw new Error(`Invalid role. No ${role} account found for ${normalizedEmail}.`);
    }

    const passwordCapableUsers = roleMatchedUsers.filter((candidate) => isPasswordHash(candidate.password));
    if (!passwordCapableUsers.length) {
      console.log('ERROR: Account does not have a valid password hash');
      throw new Error('This account does not support password login');
    }

    let user = null;
    for (const candidate of passwordCapableUsers) {
      const candidateMatch = await bcrypt.compare(password, candidate.password);
      console.log('Password match check for role:', candidate.role, '=>', candidateMatch);
      if (candidateMatch) {
        if (user) {
          console.log('ERROR: Multiple accounts matched the provided password');
          throw new Error('Multiple accounts found for this email. Please sign in with a specific role.');
        }
        user = candidate;
      }
    }

    if (!user) {
      console.log('ERROR: Password does not match');
      throw new Error('Invalid credentials');
    }

    console.log('User found - Email:', user.email, 'Role:', user.role, 'ID:', user._id);
    
    // Validate role only if explicitly provided by the client.
    const normalizedUserRole = normalizeRole(user.role);

    if (normalizedRequestedRole && normalizedUserRole !== normalizedRequestedRole) {
      console.log('ERROR: Role mismatch - DB role:', user.role, 'Requested role:', role);
      throw new Error(`Invalid role. User role is ${user.role}, but ${role} was requested.`);
    }

    if (['superadmin', 'admin', 'creator'].includes(normalizedUserRole)) {
      await generateOTPForUser(user, normalizedEmail);
      return { 
        message: 'OTP sent to your email',
        user: {
          email: normalizedEmail,
          role: user.role,
          name: user.name
        }
      };
    } else {
      // Direct login for other roles like coach
      const token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      return {
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          name: user.name,
          profileImage: user.profileImage,
        },
      };
    }
  } catch (error) {
    throw error;
  }
};

async function generateOTPForUser(user, email) {
  try {
    const otp = otpService.generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await User.findOneAndUpdate({ _id: user._id }, { otp, otp_expires_at: expiresAt });
    console.log(`OTP for ${email}: ${otp}`);
    // Send OTP via email
    await emailService.sendOTP(email, otp);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error in generateOTPForUser:', error);
    const wrappedError = new Error('Failed to generate and send OTP: ' + error.message);
    wrappedError.statusCode = 500;
    throw wrappedError;
  }
}

const verifyUserOTP = async (email, otp) => {
  try {
    const normalizedEmail = normalizeEmail(email);
    const normalizedOtp = normalizeOtp(otp);

    if (!normalizedEmail || normalizedOtp.length !== 6) {
      throw new Error('Invalid or expired OTP');
    }

    const users = await User.find({ email: normalizedEmail });
    const user = users.find((candidate) => String(candidate?.otp || '') === normalizedOtp);

    if (!user || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      throw new Error('Invalid or expired OTP');
    }
    // Clear OTP
    await User.findByIdAndUpdate(user._id, { otp: null, otp_expires_at: null, is_verified: true });
    // Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    return {
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
        profileImage: user.profileImage,
      },
    };
  } catch (error) {
    throw error;
  }
};

module.exports = { loginUser, verifyUserOTP };
