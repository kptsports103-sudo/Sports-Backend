const express = require('express');
const { getPlayerProfile } = require('../controllers/player.controller');

const router = express.Router();

router.get('/:playerId', getPlayerProfile);

module.exports = router;
