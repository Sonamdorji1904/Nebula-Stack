// controllers/queueController.js
const queueService = require('../services/queueService');
const logger = require('../utils/logger');

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