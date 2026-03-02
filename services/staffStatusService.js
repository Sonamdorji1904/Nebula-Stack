/**
 * Staff Status Service
 * Handles staff availability status updates, transitions, and history tracking
 * Integrates with EWT calculation for real-time queue updates
 */

const Staff = require('../models/staff');
const logger = require('../utils/logger');
const ewtRecalculationService = require('./ewtRecalculationService');

// Valid status transitions state machine
const VALID_TRANSITIONS = {
  offline: ['available', 'on-break'],
  available: ['busy', 'on-break', 'offline'],
  busy: ['available', 'on-break', 'offline'],
  'on-break': ['available', 'offline']
};

class StaffStatusService {
  /**
   * Validate if status transition is allowed
   * Enforces state machine rules
   * @param {string} currentStatus - Current status
   * @param {string} newStatus - Desired new status
   * @returns {Object} Validity and message
   */
  validateStatusTransition(currentStatus, newStatus) {
    const validStatuses = ['available', 'busy', 'on-break', 'offline'];
    
    if (!validStatuses.includes(newStatus)) {
      return {
        isValid: false,
        message: `Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`
      };
    }

    if (currentStatus === newStatus) {
      return {
        isValid: false,
        message: `Staff already in ${newStatus} status`
      };
    }

    if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
      return {
        isValid: false,
        message: `Cannot transition from ${currentStatus} to ${newStatus}`
      };
    }

    return { isValid: true };
  }

  /**
   * Update staff status with validation and history tracking
   * @param {string} staffId - Staff MongoDB ID or staffId field
   * @param {string} newStatus - New status to set
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Updated staff with formatted response
   */
  async updateStatus(staffId, newStatus, options = {}) {
    try {
      // Find staff by ID or staffId field
      const staff = await Staff.findOne({
        $or: [
          { _id: staffId },
          { staffId: staffId }
        ]
      }).populate('role department');

      if (!staff) {
        const error = new Error(`Staff not found: ${staffId}`);
        error.statusCode = 404;
        throw error;
      }

      if (!staff.isActive) {
        const error = new Error('Cannot update status for inactive staff');
        error.statusCode = 400;
        throw error;
      }

      // Validate transition
      const validation = this.validateStatusTransition(staff.currentStatus || 'offline', newStatus);
      if (!validation.isValid) {
        const error = new Error(validation.message);
        error.statusCode = 400;
        throw error;
      }

      // Store previous status
      staff.previousStatus = staff.currentStatus || 'offline';

      // Update status
      staff.currentStatus = newStatus;
      staff.statusUpdatedAt = new Date();

      // Track in history
      staff.statusHistory.push({
        status: newStatus,
        changedAt: new Date(),
        changedBy: options.changedBy || 'system',
        reason: options.reason || null,
        durationMinutes: this.calculateStatusDuration(staff.statusUpdatedAt)
      });

      // Keep history to 100 entries
      if (staff.statusHistory.length > 100) {
        staff.statusHistory = staff.statusHistory.slice(-100);
      }

      await staff.save();

      logger.info('Staff status updated', {
        staffId: staff.staffId,
        department: staff.department?.code,
        previousStatus: staff.previousStatus,
        newStatus: newStatus,
        changedBy: options.changedBy || 'system'
      });

      // Trigger EWT recalculation for the department
      if (staff.department?.code) {
        try {
          await ewtRecalculationService.onStaffStatusChanged(
            staff._id,
            staff.previousStatus,
            newStatus,
            staff.department.code
          );
        } catch (ewtError) {
          logger.error('Failed to trigger EWT recalculation', {
            staffId: staff.staffId,
            error: ewtError.message
          });
          // Don't fail the request if EWT recalculation fails
        }
      }

      return this.formatStatusResponse(staff);
    } catch (error) {
      logger.error('Failed to update staff status', {
        staffId,
        newStatus,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get current status of a staff member
   * @param {string} staffId - Staff MongoDB ID or staffId field
   * @returns {Promise<Object>} Staff status information
   */
  async getStatus(staffId) {
    try {
      const staff = await Staff.findOne({
        $or: [
          { _id: staffId },
          { staffId: staffId }
        ]
      }).select('staffId fullName displayName currentStatus statusUpdatedAt previousStatus department');

      if (!staff) {
        const error = new Error(`Staff not found: ${staffId}`);
        error.statusCode = 404;
        throw error;
      }

      return this.formatStatusResponse(staff);
    } catch (error) {
      logger.error('Failed to fetch staff status', {
        staffId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get available staff count for a department
   * Used in EWT calculation
   * @param {Object} departmentId - Department MongoDB ID
   * @returns {Promise<number>} Count of available staff
   */
  async getAvailableStaffCount(departmentId) {
    try {
      const count = await Staff.countDocuments({
        department: departmentId,
        isActive: true,
        currentStatus: 'available'
      });

      return count;
    } catch (error) {
      logger.error('Failed to count available staff', {
        departmentId,
        error: error.message
      });
      return 0;
    }
  }

  /**
   * Get status of all staff in a department
   * @param {string} departmentId - Department MongoDB ID
   * @returns {Promise<Array>} Array of staff status objects
   */
  async getDepartmentStaffStatus(departmentId) {
    try {
      const staffList = await Staff.find({
        department: departmentId,
        isActive: true
      }).select('staffId fullName displayName currentStatus statusUpdatedAt department');

      return staffList.map(staff => this.formatStatusResponse(staff));
    } catch (error) {
      logger.error('Failed to fetch department staff status', {
        departmentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Set staff to offline on logout
   * @param {string} staffId - Staff MongoDB ID or staffId
   * @returns {Promise<boolean>} Success flag
   */
  async setOfflineForLogout(staffId) {
    try {
      const staff = await Staff.findOne({
        $or: [
          { _id: staffId },
          { staffId: staffId }
        ]
      });

      if (!staff) {
        logger.warn('Staff not found for logout', { staffId });
        return false;
      }

      // Only update if not already offline
      if (staff.currentStatus !== 'offline') {
        staff.previousStatus = staff.currentStatus;
        staff.currentStatus = 'offline';
        staff.statusUpdatedAt = new Date();

        staff.statusHistory.push({
          status: 'offline',
          changedAt: new Date(),
          changedBy: 'system',
          reason: 'Logout'
        });

        if (staff.statusHistory.length > 100) {
          staff.statusHistory = staff.statusHistory.slice(-100);
        }

        await staff.save();

        logger.info('Staff set to offline on logout', {
          staffId: staff.staffId,
          department: staff.department
        });
      }

      return true;
    } catch (error) {
      logger.error('Failed to set staff offline on logout', {
        staffId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get status history for a staff member
   * @param {string} staffId - Staff MongoDB ID or staffId
   * @param {number} limit - Max history entries to return (default 10)
   * @returns {Promise<Array>} Status history entries
   */
  async getStatusHistory(staffId, limit = 10) {
    try {
      const staff = await Staff.findOne({
        $or: [
          { _id: staffId },
          { staffId: staffId }
        ]
      }).select('statusHistory');

      if (!staff) {
        const error = new Error(`Staff not found: ${staffId}`);
        error.statusCode = 404;
        throw error;
      }

      // Return most recent entries (last N)
      return staff.statusHistory.slice(-limit);
    } catch (error) {
      logger.error('Failed to fetch staff status history', {
        staffId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Bulk update status for multiple staff members (admin only)
   * @param {Array} staffIds - Array of staff IDs to update
   * @param {string} newStatus - New status for all
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Result with successful and failed counts
   */
  async bulkUpdateStatus(staffIds, newStatus, options = {}) {
    if (!Array.isArray(staffIds) || staffIds.length === 0) {
      const error = new Error('Invalid staffIds array');
      error.statusCode = 400;
      throw error;
    }

    if (staffIds.length > 100) {
      const error = new Error('Cannot update more than 100 staff at once');
      error.statusCode = 400;
      throw error;
    }

    const result = {
      successful: [],
      failed: [],
      total: staffIds.length
    };

    for (const staffId of staffIds) {
      try {
        const updated = await this.updateStatus(staffId, newStatus, options);
        result.successful.push(updated.staffId);
      } catch (error) {
        result.failed.push({
          staffId,
          error: error.message
        });
      }
    }

    logger.info('Bulk staff status update completed', {
      total: result.total,
      successful: result.successful.length,
      failed: result.failed.length,
      newStatus,
      initiatedBy: options.changedBy || 'system'
    });

    return result;
  }

  /**
   * Format staff status response
   * @param {Object} staff - Staff document
   * @returns {Object} Formatted response
   */
  formatStatusResponse(staff) {
    return {
      staffId: staff._id || staff.staffId,
      staffCode: staff.staffId,
      fullName: staff.fullName,
      displayName: staff.displayName,
      currentStatus: staff.currentStatus || 'offline',
      previousStatus: staff.previousStatus,
      statusUpdatedAt: staff.statusUpdatedAt,
      statusDurationMinutes: this.calculateStatusDuration(staff.statusUpdatedAt),
      department: staff.department?.code || staff.department,
      isActive: staff.isActive,
      isOnDuty: staff.isOnDuty
    };
  }

  /**
   * Calculate how long staff has been in current status
   * @param {Date} statusUpdatedAt - Timestamp of last status update
   * @returns {number} Duration in minutes
   */
  calculateStatusDuration(statusUpdatedAt) {
    if (!statusUpdatedAt) return 0;
    return Math.floor((Date.now() - new Date(statusUpdatedAt)) / (1000 * 60));
  }
}

module.exports = new StaffStatusService();
