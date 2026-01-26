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

module.exports = router;