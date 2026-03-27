const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const winnerController = require('../controllers/winner.controller');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

router.get('/', winnerController.getWinners);
router.post('/capture-sessions', authMiddleware, roleMiddleware(['creator']), winnerController.createWinnerCaptureSession);
router.get('/capture-sessions/:sessionId', authMiddleware, roleMiddleware(['creator']), winnerController.getWinnerCaptureSession);
router.post('/capture-sessions/:sessionId/photo', upload.single('photo'), winnerController.uploadWinnerCapturePhoto);
router.post('/capture-sessions/:sessionId/claim', authMiddleware, roleMiddleware(['creator']), winnerController.claimWinnerCaptureSession);
router.delete('/capture-sessions/:sessionId', authMiddleware, roleMiddleware(['creator']), winnerController.deleteWinnerCaptureSession);
router.post('/', authMiddleware, roleMiddleware(['creator']), winnerController.createWinner);
router.put('/:id', authMiddleware, roleMiddleware(['creator']), winnerController.updateWinner);
router.delete('/:id', authMiddleware, roleMiddleware(['creator']), winnerController.deleteWinner);

module.exports = router;
