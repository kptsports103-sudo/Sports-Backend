const express = require('express');
const {
  getRegistrations,
  createRegistration,
  updateRegistration,
  deleteRegistration,
} = require('../controllers/registration.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

const router = express.Router();

router.get('/', getRegistrations);
router.post('/', createRegistration);
router.put('/:id', authMiddleware, roleMiddleware(['creator']), updateRegistration);
router.delete('/:id', authMiddleware, roleMiddleware(['creator']), deleteRegistration);

module.exports = router;
