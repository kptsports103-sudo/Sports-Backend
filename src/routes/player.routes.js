const express = require('express');
const { getPlayerDirectory, getPlayerProfile } = require('../controllers/player.controller');

const router = express.Router();

router.get('/', getPlayerDirectory);
router.get('/:playerId', getPlayerProfile);

module.exports = router;
