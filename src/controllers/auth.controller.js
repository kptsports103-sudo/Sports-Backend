const { loginUser, verifyUserOTP } = require('../auth.service');
const bcrypt = require('bcryptjs');
const clerk = require('../config/clerk');
const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const { createActivityLogEntry } = require('../services/activityLog.service');

const logSuccessfulLogin = async (req, user, details = 'Successful login') => {
  if (!user?.id && !user?._id) return;

  try {
    await createActivityLogEntry({
      req,
      user,
      source: 'auth',
      action: 'User Logged In',
      pageName: 'Authentication',
      details,
      method: 'LOGIN',
      route: '/api/v1/auth/login',
      clientPath: req.headers['x-client-path'] || '/login',
      statusCode: 200,
      metadata: {
        loginRole: user.role || '',
      },
    });
  } catch (error) {
    console.error('Failed to record login activity:', error.message);
  }
};

exports.login = async (req, res) => {
  const { email, password, role } = req.body;
  console.log('=== CONTROLLER LOGIN ===');
  console.log('Request body:', req.body);
  console.log('Email:', email);
  console.log('Password provided:', !!password);
  console.log('Role:', role);
  console.log('Content-Type:', req.get('Content-Type'));
  
  try {
    const result = await loginUser(email, password, role);
    console.log('Login result:', result);
    if (result?.token && result?.user) {
      await logSuccessfulLogin(req, result.user, 'Successful direct login');
    }
    res.json(result);
  } catch (error) {
    console.error('=== LOGIN ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(error.statusCode || 400).json({ message: error.message || 'Server error' });
  }
};

exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;
  console.log('=== CONTROLLER VERIFY OTP ===');
  console.log('Request body:', req.body);
  console.log('Email:', email);
  console.log('OTP:', otp);
  console.log('Content-Type:', req.get('Content-Type'));
  
  try {
    const result = await verifyUserOTP(email, otp);
    console.log('Verify OTP result:', result);
    await logSuccessfulLogin(req, result?.user, 'Successful OTP login');
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message || 'Server error' });
  }
};

exports.clerkLogin = async (req, res) => {
  const { token } = req.body;
  try {
    // Verify the Clerk token
    const payload = await clerk.verifyToken(token);
    const clerkUserId = payload.sub;
    const email = payload.email_addresses[0]?.email_address;

    if (!email) {
      return res.status(400).json({ message: 'Email not found in token' });
    }

    // Find or create user
    let user = await User.findOne({ clerkUserId });
    if (!user) {
      // For new users, assign default role as student, or perhaps require role selection
      user = new User({
        clerkUserId,
        email,
        password: '', // No password for OAuth users
        role: 'student', // Default role
        is_verified: true,
      });
      await user.save();
    }

    // Generate JWT
    const jwtToken = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    const authPayload = {
      token: jwtToken,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
        profileImage: user.profileImage,
      },
    };

    await logSuccessfulLogin(req, authPayload.user, 'Successful Clerk login');
    res.json(authPayload);
  } catch (error) {
    console.error('Clerk login error:', error);
    res.status(400).json({ message: 'Invalid token' });
  }
};

// Temporary admin registration
exports.registerAdmin = async (req, res) => {
  const { email, password, name, role } = req.body;
  
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      role,
      clerkUserId: email,
      profileImage: 'https://via.placeholder.com/80',
      is_verified: true
    });
    
    await user.save();
    
    res.status(201).json({ 
      message: 'Admin user created successfully',
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Register admin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
