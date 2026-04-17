const express = require('express');
const { getHome, updateHome, uploadBanner, getAboutTimeline, updateAboutTimeline, getStudentParticipation, getPlayers, getKpmPoolStatus, savePlayers } = require('../controllers/home.controller');
const auth = require('../middlewares/auth.middleware');
const { requireSecretKeyVerification } = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

const router = express.Router();

router.get('/', getHome);
router.put('/', auth, roleMiddleware(['admin']), updateHome);
router.post('/upload-banner', auth, roleMiddleware(['creator']), uploadBanner);
router.get('/about-timeline', getAboutTimeline);
router.put('/about-timeline', auth, roleMiddleware(['admin']), updateAboutTimeline);
router.get('/student-participation', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, getStudentParticipation);
router.get('/players', getPlayers);
router.get('/pool-status', auth, roleMiddleware(['creator', 'admin']), getKpmPoolStatus);
router.post('/players', auth, roleMiddleware(['creator']), requireSecretKeyVerification, savePlayers);

module.exports = router;
