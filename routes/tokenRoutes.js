const express = require('express');
const router = express.Router();
const tokenController = require('../controllers/tokenController');
const { authenticate, requirePermission } = require('../middleware/authMiddleware');

// Issue a new token
router.post('/issue', tokenController.issueToken);

// Call a token (mark as in-progress)
router.put('/call', tokenController.callToken);

// Complete a token
router.put('/complete', tokenController.completeToken);

// Get queue for a department (for kiosk/display)
router.get('/queue/:department', tokenController.getDepartmentQueue);

/**
 * @route   GET /api/tokens/:tokenId
 * @desc    Get token detail with full history and current status
 * @access  Protected - Requires authentication
 * @params  {string} tokenId - Token ID (e.g., REG-001)
 * @returns {Object} Token detail with history, current stage, EWT
 */
router.get(
  '/:tokenId',
  authenticate,
  tokenController.getTokenDetail
);

module.exports = router;
