const express = require('express');
const router = express.Router();
const tokenController = require('../controllers/tokenController');
const postConsultationController = require('../controllers/postConsultationController');
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

/**
 * @route   POST /api/tokens/generate-followup
 * @desc    Manually generate a follow-up token (admin/staff action)
 * @access  Protected - Requires authentication
 * @body    {
 *            parent_token_id: string,
 *            service_type: string,
 *            priority: 'high'|'normal'|'low',
 *            patient_id: string
 *          }
 * @returns {Object} New follow-up token information
 */
router.post(
  '/generate-followup',
  authenticate,
  requirePermission('token:create'),
  postConsultationController.generateFollowupToken
);

/**
 * @route   GET /api/tokens/:tokenId/journey
 * @desc    Get full patient journey - all tokens with parent-child relationships
 * @access  Protected - Requires authentication
 * @params  {string} tokenId - Token ID (e.g., OPD-001)
 * @returns {Object} Complete journey structure with all follow-ups
 */
router.get(
  '/:tokenId/journey',
  authenticate,
  postConsultationController.getTokenJourney
);

/**
 * @route   GET /api/tokens/:parentTokenId/followups
 * @desc    Get all follow-up tokens for a specific parent consultation token
 * @access  Protected - Requires authentication
 * @params  {string} parentTokenId - Parent token ID
 * @returns {Object} List of follow-up tokens with status
 */
router.get(
  '/:parentTokenId/followups',
  authenticate,
  postConsultationController.getFollowupTokens
);

module.exports = router;