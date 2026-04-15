const express = require('express');
const router = express.Router();
const {
  getGroupResults,
  createGroupResult,
  updateGroupResult,
  deleteGroupResult,
} = require('../controllers/groupResult.controller');

const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const upload = require('../middlewares/upload.middleware');

router.get('/', getGroupResults);
router.post('/', authMiddleware, roleMiddleware(['creator']), upload.single('image'), createGroupResult);
router.put('/:id', authMiddleware, roleMiddleware(['creator']), upload.single('image'), updateGroupResult);
router.delete('/:id', authMiddleware, roleMiddleware(['admin']), deleteGroupResult);

module.exports = router;
