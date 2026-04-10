const express = require('express');
const {
  createUser,
  getUsers,
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
} = require('../controllers/iam.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

const router = express.Router();

// GET /api/iam/users - Role-based filtered list (superadmin/admin/creator)
router.get('/users', authMiddleware, getUsers);

// POST /api/iam/users - Create new user (superadmin only)
router.post('/users', authMiddleware, roleMiddleware(['superadmin']), createUser);

// DELETE /api/iam/users/:userId - RBAC enforced in controller
router.delete('/users/:userId', authMiddleware, deleteUser);

// POST /api/iam/verify-otp - Verify OTP for user activation
router.post('/verify-otp', authMiddleware, roleMiddleware(['superadmin']), verifyOTP);

// POST /api/iam/resend-otp - Resend OTP to user
router.post('/resend-otp', authMiddleware, roleMiddleware(['superadmin']), resendOTP);

// === TOKEN-BASED ONBOARDING SYSTEM ===

// POST /api/iam/create-token - Create invite token (superadmin only)
router.post('/create-token', authMiddleware, roleMiddleware(['superadmin']), createToken);

// GET /api/iam/resolve-token - Resolve token to get phone/role (public)
router.get('/resolve-token', resolveToken);

// POST /api/iam/send-otp - Send OTP for onboarding (admin auth or valid token)
router.post('/send-otp', sendOTPOnboarding);

// POST /api/iam/verify-otp - Verify OTP for onboarding (admin auth or valid token)
router.post('/verify-otp-onboarding', verifyOTPOnboarding);

// POST /api/iam/create-user - Create user from onboarding (admin auth or verified token flow)
router.post('/create-user', createUserOnboarding);

// POST /api/iam/verify-phone-otp - Verify phone OTP for onboarding (public)
router.post('/verify-phone-otp', verifyPhoneOTP);

// POST /api/iam/verify-phone-otp-login - Verify phone OTP with login (public)
router.post('/verify-phone-otp-login', verifyPhoneOTPWithLogin);

module.exports = router;
