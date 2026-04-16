const express = require('express');
const archiveController = require('../controllers/archive.controller');

const router = express.Router();

router.get('/', archiveController.getArchiveOverview);
router.get('/:year', archiveController.getArchiveByYear);

module.exports = router;
