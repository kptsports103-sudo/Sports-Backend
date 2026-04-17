const express = require('express');
const auth = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const {
  getPlayerDirectory,
  getPlayerProfile,
  getPlayerApprovalRequests,
  getPlayerApprovalRequest,
  approvePlayerApprovalRequest,
  rejectPlayerApprovalRequest,
} = require('../controllers/player.controller');

const router = express.Router();

router.get('/approval-requests', auth, roleMiddleware(['creator']), getPlayerApprovalRequests);
router.get('/approval-requests/:requestId', auth, roleMiddleware(['creator']), getPlayerApprovalRequest);
router.patch('/approval-requests/:requestId/approve', auth, roleMiddleware(['admin']), approvePlayerApprovalRequest);
router.patch('/approval-requests/:requestId/reject', auth, roleMiddleware(['admin']), rejectPlayerApprovalRequest);
router.get('/', getPlayerDirectory);
router.get('/:playerId', getPlayerProfile);

module.exports = router;
