const router = require('express').Router();
const controller = require('../controllers/staffController');
const staffStatusController = require('../controllers/staffStatusController');
const nurseController = require('../controllers/nurseController');
const { authenticate, requirePermission, requireOnDuty } = require('../middleware/authMiddleware');

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

/**
 * @route   GET /api/staff/me/queue-monitoring
 * @desc    Get nurse queue monitoring view with prep status
 * @access  Protected - Requires queue:nurse-monitor permission and on-duty status
 * @query {string} status - Optional: filter by token status (pending, in-progress)
 * @query {string} prepStatus - Optional: filter by prep status (waiting, in-prep, ready, completed)
 */
router.get(
  '/me/queue-monitoring',
  authenticate,
  requirePermission('queue:nurse-monitor'),
  requireOnDuty,
  nurseController.getNurseQueueMonitoring
);

/**
 * @route   GET /api/staff/me/queue-monitoring/:department
 * @desc    Get department-specific queue for nurse with prep status
 * @access  Protected - Requires queue:nurse-monitor permission
 * @query {string} status - Optional: filter by token status
 * @query {string} prepStatus - Optional: filter by prep status
 */
router.get(
  '/me/queue-monitoring/:department',
  authenticate,
  requirePermission('queue:nurse-monitor'),
  nurseController.getNurseDepartmentQueue
);

/**
 * @route   GET /api/staff/me/queue-monitoring/tokens/:tokenId
 * @desc    Get detailed token information including audit history
 * @access  Protected - Requires queue:nurse-monitor permission
 * @query {string} department - Department code (required)
 */
router.get(
  '/me/queue-monitoring/tokens/:tokenId',
  authenticate,
  requirePermission('queue:nurse-monitor'),
  nurseController.getTokenDetails
);

/**
 * @route   POST /api/staff/me/queue-monitoring/tokens/:tokenId/prep-status
 * @desc    Update token prep status (waiting, in-prep, ready, completed)
 * @access  Protected - Requires queue:nurse-monitor permission
 * @body {Object} Request body:
 *   - department (string, required): Department code
 *   - prepStatus (string, required): New prep status
 *   - notes (string, optional): Additional notes for audit trail
 */
router.post(
  '/me/queue-monitoring/tokens/:tokenId/prep-status',
  authenticate,
  requirePermission('queue:nurse-monitor'),
  nurseController.updateTokenPrepStatus
);

module.exports = router;
