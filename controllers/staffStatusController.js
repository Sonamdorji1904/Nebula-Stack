/**
 * Staff Status Controller
 * Handles HTTP requests for staff status management
 * Enforces authorization, EWT recalculation, and real-time updates
 */

const staffStatusService = require('../services/staffStatusService');
const queueService = require('../services/queueService');
const queueSocketHandler = require('../utils/queueSocketHandler');
const securityLogger = require('../utils/securityLogger');

/**
 * POST /api/staff/status
 * Update staff status (own or admin override)
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { staffId } = req.params;
    const requesterId = req.user._id;
    const requesterRole = req.user.role;

    // Validate status provided
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // Authorization: staff can update own, admins can override
    const targetStaffId = staffId || requesterId;
    const isOwnUpdate = targetStaffId.toString() === requesterId.toString();
    const isAdmin = requesterRole.permissions?.includes('staff:manage');

    if (!isOwnUpdate && !isAdmin) {
      securityLogger.logUnauthorizedStatusUpdateAttempt({
        requesterId: req.user.staffId,
        targetStaffId,
        reason: 'insufficient_permissions'
      });

      return res.status(403).json({
        success: false,
        message: 'Unauthorized to update other staff status'
      });
    }

    // Update status
    const updated = await staffStatusService.updateStatus(targetStaffId, status, {
      changedBy: isOwnUpdate ? 'self' : `admin:${req.user.staffId}`,
      reason: req.body.reason || null
    });

    // Get department for EWT recalculation
    const staff = await require('../models/staff').findById(targetStaffId).populate('department');
    if (staff?.department?.code) {
      try {
        // Trigger EWT recalculation
        await queueService.recalculateEWT(staff.department.code);

        // Get affected tokens
        const affectedTokens = await queueService.getAffectedTokens(staff.department.code);

        // Emit real-time updates via WebSocket
        queueSocketHandler.emitStaffStatusChange(staff.department.code, {
          staffId: staff.staffId,
          displayName: staff.displayName,
          previousStatus: updated.previousStatus,
          newStatus: status,
          affectedTokens: affectedTokens.length,
          availableStaffCount: await staffStatusService.getAvailableStaffCount(staff.department._id)
        });

        // Log status change with EWT impact
        securityLogger.logStaffStatusChange({
          staffId: staff.staffId,
          department: staff.department.code,
          previousStatus: updated.previousStatus,
          newStatus: status,
          changedBy: updated.changedBy,
          affectedTokens: affectedTokens.length
        });
      } catch (ewtError) {
        // Log but don't fail the request if EWT recalculation fails
        require('../utils/logger').error('EWT recalculation failed after status update', {
          staffId: staff.staffId,
          department: staff.department.code,
          error: ewtError.message
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Staff status updated successfully',
      data: updated
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to update staff status'
    });
  }
};

/**
 * GET /api/staff/status/:staffId
 * Get current status of a staff member
 */
exports.getStatus = async (req, res) => {
  try {
    const { staffId } = req.params;
    const requesterId = req.user._id;

    // Authorization: can view own, admins can view any
    const isOwnStatus = staffId === requesterId.toString() || staffId === req.user.staffId;
    const isAdmin = req.user.role.permissions?.includes('staff:manage');

    if (!isOwnStatus && !isAdmin && !req.user.role.permissions?.includes('queue:view')) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to view this staff status'
      });
    }

    const status = await staffStatusService.getStatus(staffId);

    return res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch staff status'
    });
  }
};

/**
 * GET /api/staff/status-history/:staffId
 * Get status history for a staff member
 */
exports.getStatusHistory = async (req, res) => {
  try {
    const { staffId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);

    const history = await staffStatusService.getStatusHistory(staffId, limit);

    return res.status(200).json({
      success: true,
      data: {
        staffId,
        limit,
        history
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch status history'
    });
  }
};

/**
 * GET /api/staff/department/:department/status
 * Get all staff status for a department
 */
exports.getDepartmentStaffStatus = async (req, res) => {
  try {
    const { department } = req.params;

    // Get department
    const dept = await require('../models/Department').findOne({ code: department });
    if (!dept) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    const staffStatuses = await staffStatusService.getDepartmentStaffStatus(dept._id);

    return res.status(200).json({
      success: true,
      data: {
        department,
        staffCount: staffStatuses.length,
        staff: staffStatuses
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch department staff status'
    });
  }
};

/**
 * POST /api/staff/bulk-status
 * Bulk update staff status (admin only)
 */
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { staffIds, status } = req.body;

    // Authorization: admin only
    if (!req.user.role.permissions?.includes('staff:manage')) {
      securityLogger.logUnauthorizedStatusUpdateAttempt({
        requesterId: req.user.staffId,
        reason: 'bulk_update_non_admin'
      });

      return res.status(403).json({
        success: false,
        message: 'Only admins can perform bulk status updates'
      });
    }

    // Validate input
    if (!Array.isArray(staffIds) || staffIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'staffIds must be a non-empty array'
      });
    }

    if (staffIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update more than 100 staff at once'
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // Perform bulk update
    const result = await staffStatusService.bulkUpdateStatus(staffIds, status, {
      changedBy: `admin:${req.user.staffId}`,
      reason: req.body.reason || null
    });

    // Log bulk operation
    securityLogger.logBulkStaffStatusUpdate({
      adminId: req.user.staffId,
      newStatus: status,
      successCount: result.successful.length,
      failureCount: result.failed.length,
      totalAttempted: result.total
    });

    return res.status(200).json({
      success: true,
      message: 'Bulk status update completed',
      data: {
        successCount: result.successful.length,
        failureCount: result.failed.length,
        successful: result.successful,
        failed: result.failed
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to perform bulk status update'
    });
  }
};

/**
 * GET /api/staff/department/:department/ewt-recalculation
 * Get EWT recalculation details for a department
 */
exports.getEWTDetails = async (req, res) => {
  try {
    const { department } = req.params;

    // Get department
    const dept = await require('../models/Department').findOne({ code: department });
    if (!dept) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    // Get EWT details
    const ewtDetails = await queueService.recalculateEWT(department);
    const affectedTokens = await queueService.getAffectedTokens(department);

    return res.status(200).json({
      success: true,
      data: {
        department,
        ...ewtDetails,
        affectedTokens: {
          count: affectedTokens.length,
          tokens: affectedTokens
        }
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to calculate EWT details'
    });
  }
};
