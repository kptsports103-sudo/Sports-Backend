const express = require('express');
const authController = require('../controllers/auth.controller');

const router = express.Router();

/* LOGIN */
router.post('/login', authController.login);

/* VERIFY OTP */
router.post('/verify-otp', authController.verifyOTP);

/* CLERK LOGIN */
router.post('/clerk-login', authController.clerkLogin);

module.exports = router;
