const express = require('express');
const router = express.Router();
const resultController = require('../controllers/result.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const upload = require('../middlewares/upload.middleware');

router.get('/', resultController.getResults);
router.get('/board', resultController.getResultsBoard);
router.post('/', authMiddleware, roleMiddleware(['creator']), upload.single('image'), resultController.createResult);
router.put('/:id', authMiddleware, roleMiddleware(['creator']), upload.single('image'), resultController.updateResult);
router.delete('/:id', authMiddleware, roleMiddleware(['admin']), resultController.deleteResult);
router.post('/reorder', authMiddleware, roleMiddleware(['admin']), resultController.reorderResults);

module.exports = router;
