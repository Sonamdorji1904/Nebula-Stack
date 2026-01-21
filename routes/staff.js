const router = require('express').Router();
const controller = require('../controllers/staffController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/login', controller.login);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.getCurrentStaff);

module.exports = router;
