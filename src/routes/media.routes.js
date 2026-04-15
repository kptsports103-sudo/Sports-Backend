const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const {
  createMediaItem,
  deleteMediaItem,
  getCloudinaryUsage,
  getCloudinaryStats,
  getMediaItems,
  logMediaActivity,
  predictMediaUsage,
  getMediaHeatmap,
  updateMediaItem,
} = require('../controllers/media.controller');

const router = express.Router();

router.post('/log', logMediaActivity);
router.post('/track', logMediaActivity);
router.get('/predict', authMiddleware, predictMediaUsage);
router.get('/usage', authMiddleware, roleMiddleware(['superadmin']), getCloudinaryUsage);
router.get('/stats', authMiddleware, roleMiddleware(['superadmin']), getCloudinaryStats);
router.get('/heatmap', authMiddleware, roleMiddleware(['superadmin']), getMediaHeatmap);
router.get('/', authMiddleware, roleMiddleware(['creator', 'admin', 'superadmin']), getMediaItems);
router.post('/', authMiddleware, roleMiddleware(['creator', 'admin', 'superadmin']), createMediaItem);
router.put('/:id', authMiddleware, roleMiddleware(['creator', 'admin', 'superadmin']), updateMediaItem);
router.delete('/:id', authMiddleware, roleMiddleware(['creator', 'admin', 'superadmin']), deleteMediaItem);

module.exports = router;
