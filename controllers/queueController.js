// controllers/queueController.js
const queueService = require('../services/queueService');
const logger = require('../utils/logger');
const securityLogger = require('../utils/securityLogger');

/**
 * Get live queue for a department
 * @route GET /api/queues/:department
 * @access Protected - Requires queue:view permission and on-duty status
 */
exports.getDepartmentLiveQueue = async (req, res) => {
  try {
    const { department } = req.params;
    
    // Validate department code format
    if (!department || !/^[A-Z]{2,5}$/.test(department)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department code format'
      });
    }

    const queue = await queueService.getLiveQueue(department);

    // Log queue access for traceability
    logger.info('QUEUE_ACCESSED', {
      department,
      staffId: req.user?.staffId || 'UNKNOWN',
      role: req.user?.role?.name || 'UNKNOWN',
      ip: req.ip,
      currentToken: queue.currentToken?.token || null,
      pendingCount: queue.nextTokens.length,
      totalActive: queue.totalPending + (queue.currentToken ? 1 : 0),
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      data: queue
    });

  } catch (error) {
    logger.error('QUEUE_FETCH_FAILED', {
      department: req.params.department,
      staffId: req.user?.staffId,
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

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch department queue'
    });
  }
};

/**
 * Get queue statistics for a department
 * @route GET /api/queues/:department/stats
 * @access Protected - Requires queue:view permission
 */
exports.getDepartmentQueueStats = async (req, res) => {
  try {
    const { department } = req.params;

    if (!department || !/^[A-Z]{2,5}$/.test(department)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department code format'
      });
    }

    const stats = await queueService.getQueueStats(department);

    logger.info('QUEUE_STATS_ACCESSED', {
      department,
      staffId: req.user?.staffId,
      stats
    });

    return res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('QUEUE_STATS_FETCH_FAILED', {
      department: req.params.department,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch queue statistics'
    });
  }
};

/**
 * Mark a token as served and advance the queue
 * @route POST /api/queues/serve
 * @access Protected - Requires queue:serve permission
 */
exports.serveToken = async (req, res) => {
  try {
    const { tokenId, staffId, notes } = req.body;

    if (!tokenId || !staffId) {
      return res.status(400).json({
        success: false,
        message: 'tokenId and staffId are required'
      });
    }

    const result = await queueService.serveToken(tokenId, staffId, { notes, actedBy: req.user?.staffId });

    logger.info('TOKEN_SERVED', {
      tokenId,
      servedBy: req.user?.staffId || staffId,
      department: result?.department || 'UNKNOWN',
      newCurrentToken: result?.currentToken || null,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('TOKEN_SERVE_FAILED', {
      tokenId: req.body?.tokenId,
      staffId: req.body?.staffId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to serve token'
    });
  }
};

/**
 * Update token status (skip, reschedule, reactivate)
 * @route POST /api/queue/update-status
 * @access Protected - Requires queue:manage permission
 */
exports.updateTokenStatus = async (req, res) => {
  try {
    const { action, tokenId, department, reason, notes, rescheduledTime, rescheduledPriority } = req.body;
    const staffId = req.user?.staffId;

    // Validate required fields
    if (!action || !tokenId || !department) {
      return res.status(400).json({
        success: false,
        message: 'action, tokenId, and department are required'
      });
    }

    // Validate action type
    const validActions = ['skip', 'reschedule', 'reactivate'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }

    // Validate department format
    if (!/^[A-Z]{2,5}$/.test(department)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department code format'
      });
    }

    let result;

    switch (action) {
      case 'skip': {
        // Validate skip-specific fields
        if (!reason) {
          return res.status(400).json({
            success: false,
            message: 'reason is required for skip action'
          });
        }

        result = await queueService.skipToken(tokenId, department, reason, staffId, notes);

        // Log audit event
        securityLogger.logTokenSkipped(tokenId, department, reason, staffId, notes);

        logger.info('QUEUE_TOKEN_SKIPPED', {
          tokenId,
          department,
          reason,
          staffId,
          timestamp: new Date().toISOString()
        });

        break;
      }

      case 'reschedule': {
        // Validate reschedule-specific fields
        if (!rescheduledTime) {
          return res.status(400).json({
            success: false,
            message: 'rescheduledTime is required for reschedule action'
          });
        }

        const scheduledDate = new Date(rescheduledTime);
        if (isNaN(scheduledDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid rescheduledTime format. Must be valid ISO 8601 date'
          });
        }

        result = await queueService.rescheduleToken(
          tokenId,
          department,
          scheduledDate,
          staffId,
          reason || 'No reason specified',
          notes
        );

        // Log audit event
        securityLogger.logTokenRescheduled(tokenId, department, scheduledDate, staffId, notes);

        logger.info('QUEUE_TOKEN_RESCHEDULED', {
          tokenId,
          department,
          rescheduledTime: scheduledDate.toISOString(),
          staffId,
          timestamp: new Date().toISOString()
        });

        break;
      }

      case 'reactivate': {
        result = await queueService.reactivateToken(tokenId, department, staffId, notes);

        // Log audit event
        securityLogger.logTokenReactivated(tokenId, department, staffId, notes);

        logger.info('QUEUE_TOKEN_REACTIVATED', {
          tokenId,
          department,
          staffId,
          timestamp: new Date().toISOString()
        });

        break;
      }
    }

    const messageMap = {
      skip: 'skipped',
      reschedule: 'rescheduled',
      reactivate: 'reactivated'
    };

    return res.status(200).json({
      success: true,
      message: `Token ${messageMap[action] || action} successfully`,
      data: result
    });

  } catch (error) {
    logger.error('TOKEN_STATUS_UPDATE_FAILED', {
      action: req.body?.action,
      tokenId: req.body?.tokenId,
      department: req.body?.department,
      staffId: req.user?.staffId,
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

    if (error.message.includes('required') || error.message.includes('invalid') || error.message.includes('cannot')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update token status'
    });
  }
};

/**
 * Get token audit history
 * @route GET /api/queue/:tokenId/audit
 * @access Protected - Requires queue:view permission
 */
exports.getTokenAuditHistory = async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { department } = req.query;

    if (!tokenId || !department) {
      return res.status(400).json({
        success: false,
        message: 'tokenId and department query parameter are required'
      });
    }

    // Validate department format
    if (!/^[A-Z]{2,5}$/.test(department)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department code format'
      });
    }

    const auditHistory = await queueService.getTokenAuditHistory(tokenId, department);

    logger.info('AUDIT_HISTORY_ACCESSED', {
      tokenId,
      department,
      staffId: req.user?.staffId,
      auditEntryCount: auditHistory.length,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      data: {
        tokenId,
        department,
        auditHistory
      }
    });

  } catch (error) {
    logger.error('AUDIT_HISTORY_FETCH_FAILED', {
      tokenId: req.params?.tokenId,
      department: req.query?.department,
      error: error.message
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch audit history'
    });
  }
};