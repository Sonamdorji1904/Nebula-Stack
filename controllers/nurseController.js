// controllers/nurseController.js
const nurseQueueService = require('../services/nurseQueueService');
const logger = require('../utils/logger');
const {
  logNurseQueueAccess,
  logNurseTokenPrepStatusUpdate
} = require('../utils/securityLogger');

/**
 * Get nurse queue monitoring view
 * @route GET /api/staff/me/queue-monitoring
 * @access Protected - Requires queue:nurse-monitor permission and on-duty status
 */
exports.getNurseQueueMonitoring = async (req, res) => {
  try {
    const staffId = req.user?.id || req.user?.staffId;
    const filters = {};

    // Parse optional query parameters for filtering
    if (req.query.status) {
      filters.status = req.query.status;
    }
    if (req.query.prepStatus) {
      filters.prepStatus = req.query.prepStatus;
    }

    // Get queue monitoring data
    const queueData = await nurseQueueService.getNurseQueueMonitoring(
      staffId,
      filters
    );

    // Log queue access for audit trail
    logNurseQueueAccess({
      staffId,
      nurseEmail: req.user?.email || 'UNKNOWN',
      filtersApplied: Object.keys(filters).length > 0 ? filters : 'none',
      departmentsAccessed: queueData.departments,
      totalTokensViewed: queueData.summary.totalTokens,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    logger.info('NURSE_QUEUE_ACCESSED', {
      staffId,
      departments: queueData.departments,
      totalTokens: queueData.summary.totalTokens,
      waitingCount: queueData.summary.waitingCount,
      inPrepCount: queueData.summary.inPrepCount,
      readyCount: queueData.summary.readyCount,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      data: queueData
    });
  } catch (error) {
    logger.error('NURSE_QUEUE_FETCH_FAILED', {
      staffId: req.user?.id || req.user?.staffId,
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

    if (error.message.includes('access')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to requested department'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch nurse queue monitoring'
    });
  }
};

/**
 * Get department-specific queue for nurse
 * @route GET /api/staff/me/queue-monitoring/:department
 * @access Protected - Requires queue:nurse-monitor permission
 */
exports.getNurseDepartmentQueue = async (req, res) => {
  try {
    const staffId = req.user?.id || req.user?.staffId;
    const { department } = req.params;
    const filters = {};

    // Validate department code format
    if (!department || !/^[A-Z]{2,5}$/.test(department)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department code format'
      });
    }

    // Parse optional query parameters
    if (req.query.status) {
      filters.status = req.query.status;
    }
    if (req.query.prepStatus) {
      filters.prepStatus = req.query.prepStatus;
    }

    // Get department queue
    const queueData = await nurseQueueService.getDepartmentQueueForNurse(
      department,
      filters
    );

    logger.info('NURSE_DEPARTMENT_QUEUE_ACCESSED', {
      staffId,
      department,
      totalTokens: queueData.nextTokens.length + (queueData.currentToken ? 1 : 0),
      waitingCount: queueData.statistics.waitingCount,
      inPrepCount: queueData.statistics.inPrepCount,
      readyCount: queueData.statistics.readyCount,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      data: queueData
    });
  } catch (error) {
    logger.error('NURSE_DEPARTMENT_QUEUE_FETCH_FAILED', {
      staffId: req.user?.id || req.user?.staffId,
      department: req.params?.department,
      error: error.message,
      stack: error.stack
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('access')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to requested department'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch department queue'
    });
  }
};

/**
 * Update token prep status
 * @route POST /api/staff/me/queue-monitoring/tokens/:tokenId/prep-status
 * @access Protected - Requires queue:nurse-monitor permission
 * @body {Object} Request body:
 *   - department (string, required): Department code
 *   - prepStatus (string, required): New prep status (waiting, in-prep, ready, completed)
 *   - notes (string, optional): Additional notes
 */
exports.updateTokenPrepStatus = async (req, res) => {
  try {
    const staffId = req.user?.id || req.user?.staffId;
    const { tokenId } = req.params;
    const { department, prepStatus, notes = '' } = req.body;

    // Validate inputs
    if (!department || !prepStatus) {
      return res.status(400).json({
        success: false,
        message: 'department and prepStatus are required'
      });
    }

    const validStatuses = ['waiting', 'in-prep', 'ready', 'completed'];
    if (!validStatuses.includes(prepStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid prepStatus. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Update prep status
    const result = await nurseQueueService.updateTokenPrepStatus(
      staffId,
      tokenId,
      department,
      prepStatus,
      notes
    );

    // Log prep status update for audit trail
    logNurseTokenPrepStatusUpdate({
      staffId,
      nurseEmail: req.user?.email || 'UNKNOWN',
      tokenId,
      department,
      newStatus: prepStatus,
      patientId: result.patientId,
      notes,
      ipAddress: req.ip
    });

    logger.info('TOKEN_PREP_STATUS_UPDATED', {
      staffId,
      tokenId,
      department,
      newPrepStatus: prepStatus,
      patientId: result.patientId,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('TOKEN_PREP_STATUS_UPDATE_FAILED', {
      staffId: req.user?.id || req.user?.staffId,
      tokenId: req.params?.tokenId,
      error: error.message,
      stack: error.stack
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('access') || error.message.includes('not have access')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to requested department'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update token prep status'
    });
  }
};

/**
 * Get detailed token information
 * @route GET /api/staff/me/queue-monitoring/tokens/:tokenId
 * @access Protected - Requires queue:nurse-monitor permission
 * @query {string} department - Department code (required)
 */
exports.getTokenDetails = async (req, res) => {
  try {
    const staffId = req.user?.id || req.user?.staffId;
    const { tokenId } = req.params;
    const { department } = req.query;

    // Validate inputs
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'department query parameter is required'
      });
    }

    // Fetch token details
    const result = await nurseQueueService.getTokenDetails(
      staffId,
      tokenId,
      department
    );

    logger.info('TOKEN_DETAILS_ACCESSED', {
      staffId,
      tokenId,
      department,
      patientId: result.patient.id,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('TOKEN_DETAILS_FETCH_FAILED', {
      staffId: req.user?.id || req.user?.staffId,
      tokenId: req.params?.tokenId,
      department: req.query?.department,
      error: error.message,
      stack: error.stack
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('access')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to requested department'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch token details'
    });
  }
};
