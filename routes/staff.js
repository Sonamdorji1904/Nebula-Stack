const router = require('express').Router();
const controller = require('../controllers/staffController');
const staffStatusController = require('../controllers/staffStatusController');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');

// Authentication
router.post('/login', controller.login);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.getCurrentStaff);

// Staff Status Management
router.post('/status', authenticate, staffStatusController.updateStatus);
router.get('/status/:staffId', authenticate, staffStatusController.getStatus);
router.get('/status-history/:staffId', authenticate, staffStatusController.getStatusHistory);
router.get('/department/:department/status', authenticate, staffStatusController.getDepartmentStaffStatus);
router.post('/bulk-status', authenticate, requirePermission('staff:manage'), staffStatusController.bulkUpdateStatus);
router.get('/department/:department/ewt-recalculation', authenticate, requirePermission('queue:view'), staffStatusController.getEWTDetails);

module.exports = router;
