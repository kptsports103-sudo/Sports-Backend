const express = require('express');
const router = express.Router();
const meController = require('../controllers/me.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

router.get('/', authMiddleware, meController.getMe);
router.post(
  '/secret-key/request-otp',
  authMiddleware,
  roleMiddleware(['creator', 'admin', 'superadmin']),
  meController.requestSecretKeyOtp
);
router.post(
  '/secret-key/verify-otp',
  authMiddleware,
  roleMiddleware(['creator', 'admin', 'superadmin']),
  meController.verifySecretKeyOtp
);
router.post(
  '/secret-key/verify',
  authMiddleware,
  roleMiddleware(['creator', 'admin', 'superadmin']),
  meController.verifySecretKey
);
router.patch(
  '/dashboard-reveal-name',
  authMiddleware,
  roleMiddleware(['creator', 'admin', 'superadmin']),
  meController.saveDashboardRevealName
);

module.exports = router;
