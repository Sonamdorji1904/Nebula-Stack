const checkinService = require('../services/checkinService');
const tokenDetailService = require('../services/tokenDetailService');
const logger = require('../utils/logger');
const securityLogger = require('../utils/securityLogger');

/**
 * Issue new token for a patient in a department
 */
exports.issueToken = async (req, res) => {
  try {
    const { patientId, department } = req.body;
    if (!patientId || !department) {
      return res.status(400).json({ success: false, message: 'patientId and department are required' });
    }

    const patient = await checkinService.addStageToken(patientId, { department });

    // Calculate initial EWT
    const ewt = await checkinService.calculateEWT(department);

    res.status(201).json({
      success: true,
      message: 'Token issued successfully',
      data: {
        token: patient.activeTokens[patient.activeTokens.length - 1],
        ewtMinutes: ewt
      }
    });

  } catch (err) {
    logger.error('Failed to issue token', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to issue token', error: err.message });
  }
};

/**
 * Call token (mark as in-progress)
 */
exports.callToken = async (req, res) => {
  try {
    const { patientId, token, department } = req.body;
    if (!patientId || !token || !department) {
      return res.status(400).json({ success: false, message: 'patientId, token, department required' });
    }

    const patient = await checkinService.updateTokenStatus(patientId, token, department, 'in-progress');

    res.status(200).json({
      success: true,
      message: 'Token called successfully',
      data: patient
    });
  } catch (err) {
    logger.error('Failed to call token', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to call token', error: err.message });
  }
};

/**
 * Complete token
 */
exports.completeToken = async (req, res) => {
  try {
    const { patientId, token, department } = req.body;
    if (!patientId || !token || !department) {
      return res.status(400).json({ success: false, message: 'patientId, token, department required' });
    }

    const patient = await checkinService.updateTokenStatus(patientId, token, department, 'completed');

    res.status(200).json({
      success: true,
      message: 'Token completed successfully',
      data: patient
    });
  } catch (err) {
    logger.error('Failed to complete token', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to complete token', error: err.message });
  }
};

/**
 * Get queue for department with EWT calculation
 */
exports.getDepartmentQueue = async (req, res) => {
  try {
    const { department } = req.params;
    if (!department) {
      return res.status(400).json({ success: false, message: 'department required' });
    }

    const queue = await checkinService.getQueueWithEWT(department);

    res.status(200).json({
      success: true,
      data: queue
    });
  } catch (err) {
    logger.error('Failed to get department queue', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to get queue', error: err.message });
  }
};

/**
 * Get token detail with history and EWT
 * @route GET /api/tokens/:tokenId
 * @access Protected - Requires authentication
 */
exports.getTokenDetail = async (req, res) => {
  try {
    const { tokenId } = req.params;

    // Validate token ID format
    if (!tokenId || typeof tokenId !== 'string' || tokenId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Invalid token ID format'
      });
    }

    // Fetch token detail with RBAC validation
    const tokenDetail = await tokenDetailService.getTokenDetail(tokenId, req.user);

    // Log the access for audit trail
    securityLogger.logTokenDetailAccess(
      tokenId,
      req.user?.staffId || req.user?.patientId || 'UNKNOWN',
      req.user?.role?.name || 'UNKNOWN',
      'view',
      tokenDetail.department,
      req.ip
    );

    return res.status(200).json({
      success: true,
      data: tokenDetail
    });
  } catch (error) {
    logger.error('TOKEN_DETAIL_FETCH_FAILED', {
      tokenId: req.params.tokenId,
      userId: req.user?.staffId || req.user?.patientId,
      error: error.message,
      stack: error.stack
    });

    // Handle specific error cases
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('Access denied')) {
      securityLogger.logAccessViolation(
        req.user?.staffId || req.user?.patientId,
        req.user?.email || 'UNKNOWN',
        `/api/tokens/${req.params.tokenId}`,
        'token:view',
        req.ip,
        req.get('user-agent')
      );

      return res.status(403).json({
        success: false,
        message: 'Access denied: Insufficient permissions to view this token'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch token detail'
    });
  }
};
