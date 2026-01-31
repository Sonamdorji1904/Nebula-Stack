// routes/queue.js
const express = require('express');
const router = express.Router();
const queueController = require('../controllers/queueController');
const {
  authenticate,
  requirePermission,
  requireOnDuty
} = require('../middleware/authMiddleware');

/**
 * @route   GET /api/queues/:department
 * @desc    Get live queue for a department (current token + next tokens + EWT)
 * @access  Protected - Requires authentication, queue:view permission, and on-duty status
 */
router.get(
  '/:department',
  authenticate,
  requirePermission('queue:view'),
  requireOnDuty,
  queueController.getDepartmentLiveQueue
);

/**
 * @route   GET /api/queues/:department/stats
 * @desc    Get queue statistics for a department
 * @access  Protected - Requires authentication and queue:view permission
 */
router.get(
  '/:department/stats',
  authenticate,
  requirePermission('queue:view'),
  queueController.getDepartmentQueueStats
);

/**
 * @route   POST /api/queue/serve
 * @desc    Mark a token as served and advance the queue
 * @access  Protected - Requires queue:serve permission
 */
router.post(
  '/serve',
  authenticate,
  requirePermission('queue:serve'),
  queueController.serveToken
);

/**
 * @route   POST /api/queue/update-status
 * @desc    Update token status (skip, reschedule, reactivate)
 * @access  Protected - Requires queue:manage permission
 * @body {Object} Request body:
 *   - action (string, required): 'skip', 'reschedule', or 'reactivate'
 *   - tokenId (string, required): The token to update
 *   - department (string, required): Department code
 *   - reason (string, required for skip/reschedule): Reason for action
 *   - notes (string, optional): Additional notes
 *   - rescheduledTime (ISO 8601 date string, required for reschedule): New scheduled time
 */
router.post(
  '/update-status',
  authenticate,
  requirePermission('queue:manage'),
  queueController.updateTokenStatus
);

/**
 * @route   GET /api/queue/:tokenId/audit
 * @desc    Get audit history for a token
 * @access  Protected - Requires queue:view permission
 * @query {string} department - Department code (required)
 */
router.get(
  '/:tokenId/audit',
  authenticate,
  requirePermission('queue:view'),
  queueController.getTokenAuditHistory
);

module.exports = router;