// services/queueService.js
const Patient = require('../models/Patient');
const Department = require('../models/Department');
const logger = require('../utils/logger');

class QueueService {
  /**
   * Fetch active tokens for a department with full patient details
   * @param {string} departmentCode - Department code (e.g., 'REG', 'OPD')
   * @returns {Promise<Array>} Array of token objects with patient info
   */
  async getActiveTokensByDepartment(departmentCode) {
    try {
      // Verify department exists
      const department = await Department.findOne({ code: departmentCode });
      if (!department) {
        throw new Error(`Department ${departmentCode} not found`);
      }

      // Find all patients with active tokens in this department
      const patients = await Patient.find({
        'activeTokens.department': departmentCode,
        'activeTokens.status': { $in: ['pending', 'in-progress'] }
      })
        .select('patientId firstName lastName activeTokens')
        .lean();

      const tokens = [];

      // Extract and format tokens
      for (const patient of patients) {
        for (const token of patient.activeTokens) {
          if (
            token.department === departmentCode &&
            ['pending', 'in-progress'].includes(token.status)
          ) {
            tokens.push({
              token: token.token,
              status: token.status,
              patientId: patient.patientId,
              patientName: `${patient.firstName} ${patient.lastName}`,
              createdAt: token.createdAt,
              issuedAt: token.issuedAt
            });
          }
        }
      }

      // Sort by creation time (FIFO)
      tokens.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      return tokens;
    } catch (error) {
      logger.error('Failed to fetch active tokens by department', {
        department: departmentCode,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Calculate EWT for a department based on historical data and staff availability
   * Takes into account how many available staff are working in the department
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Average service time and staff availability info
   */
  async calculateAverageServiceTime(departmentCode) {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Find completed tokens in the last 30 days
      const patients = await Patient.find({
        'activeTokens.department': departmentCode,
        'activeTokens.status': 'completed',
        'activeTokens.completedAt': { $gte: thirtyDaysAgo }
      })
        .select('activeTokens')
        .lean();

      const serviceTimes = [];

      for (const patient of patients) {
        for (const token of patient.activeTokens) {
          if (
            token.department === departmentCode &&
            token.status === 'completed' &&
            token.issuedAt &&
            token.completedAt
          ) {
            const serviceTime = 
              (new Date(token.completedAt) - new Date(token.issuedAt)) / 
              (1000 * 60); // Convert to minutes
            
            if (serviceTime > 0 && serviceTime < 120) { // Sanity check: 0-120 mins
              serviceTimes.push(serviceTime);
            }
          }
        }
      }

      if (serviceTimes.length === 0) {
        // Default fallback: 5 minutes
        return {
          averageServiceTime: 5,
          basedOnSamples: 0
        };
      }

      // Calculate average
      const avgTime = serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length;
      return {
        averageServiceTime: Math.round(avgTime),
        basedOnSamples: serviceTimes.length
      };
    } catch (error) {
      logger.error('Failed to calculate average service time', {
        department: departmentCode,
        error: error.message
      });
      return {
        averageServiceTime: 5,
        basedOnSamples: 0
      };
    }
  }

  /**
   * Get live queue with current token, next tokens, and EWT
   * Integrates staff availability for accurate EWT calculation
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Queue object with current/next tokens and EWT
   */
  async getLiveQueue(departmentCode) {
    try {
      const activeTokens = await this.getActiveTokensByDepartment(departmentCode);
      const serviceTimeData = await this.calculateAverageServiceTime(departmentCode);
      const avgServiceTime = serviceTimeData.averageServiceTime;

      // Get available staff count for this department
      const department = await Department.findOne({ code: departmentCode });
      const availableStaffCount = department 
        ? await (require('./staffStatusService').getAvailableStaffCount(department._id))
        : 1; // Default to 1 if cannot determine

      // Calculate adjusted EWT based on available staff
      // Formula: EWT = (pending_tokens * avg_service_time) / available_staff_count
      const staffAdjustmentFactor = Math.max(availableStaffCount, 1); // At least 1

      let currentToken = null;
      const nextTokens = [];
      let cumulativeEWT = 0;

      for (const token of activeTokens) {
        if (token.status === 'in-progress' && !currentToken) {
          // First in-progress token is the current one
          currentToken = { 
            ...token, 
            ewtMinutes: 0,
            estimatedCompletionTime: null,
            staffServing: availableStaffCount > 0 ? 1 : 0 // One staff serving current token
          };
        } else if (token.status === 'pending') {
          // Calculate cumulative EWT for pending tokens
          // Adjusted by number of available staff
          cumulativeEWT += (avgServiceTime / staffAdjustmentFactor);
          
          const estimatedCompletionTime = new Date();
          estimatedCompletionTime.setMinutes(
            estimatedCompletionTime.getMinutes() + Math.ceil(cumulativeEWT)
          );

          nextTokens.push({ 
            ...token, 
            ewtMinutes: Math.ceil(cumulativeEWT),
            estimatedCompletionTime
          });
        }
      }

      return {
        department: departmentCode,
        currentToken,
        nextTokens,
        totalPending: nextTokens.length,
        averageServiceTimeMinutes: avgServiceTime,
        availableStaffCount,
        staffAdjustmentFactor,
        ewtCalculationNote: availableStaffCount > 0 
          ? `EWT adjusted based on ${availableStaffCount} available staff`
          : 'WARNING: No staff available - EWT may be inaccurate',
        generatedAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to get live queue', {
        department: departmentCode,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get queue statistics for a department
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Queue statistics
   */
  async getQueueStats(departmentCode) {
    try {
      const activeTokens = await this.getActiveTokensByDepartment(departmentCode);
      
      const stats = {
        totalActive: activeTokens.length,
        inProgress: activeTokens.filter(t => t.status === 'in-progress').length,
        pending: activeTokens.filter(t => t.status === 'pending').length,
        oldestTokenAge: null
      };

      if (activeTokens.length > 0) {
        const oldestToken = activeTokens[0];
        const ageMinutes = Math.floor(
          (new Date() - new Date(oldestToken.createdAt)) / (1000 * 60)
        );
        stats.oldestTokenAge = ageMinutes;
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get queue stats', {
        department: departmentCode,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Serve a token and advance the queue. Delegates to checkinToken service if implemented.
   * @param {String} tokenId
   * @param {String} staffId
   * @param {Object} options
   */
  async serveToken(tokenId, staffId, options = {}) {
    // Attempt to reuse checkinToken service if it exposes a serve-like method
    try {
      const checkinTokenService = require('./checkinToken.service');
      if (typeof checkinTokenService.serveToken === 'function') {
        return await checkinTokenService.serveToken(tokenId, staffId, options);
      }
    } catch (err) {
      // ignore missing module and fallthrough to error
    }

    // If no implementation is found, throw informative error so controller returns 500 with message logged
    throw new Error('serveToken not implemented in services/queueService or checkinToken.service');
  }

  /**
   * Skip a token (temporarily remove from queue)
   * @param {string} tokenId - The token to skip
   * @param {string} department - Department code
   * @param {string} reason - Reason for skipping (e.g., 'patient-not-present', 'medical-reason')
   * @param {string} staffId - Staff ID performing the action
   * @param {string} notes - Additional notes
   * @returns {Promise<Object>} Updated queue information
   */
  async skipToken(tokenId, department, reason, staffId, notes = '') {
    try {
      // Validate inputs
      if (!tokenId || !department || !reason || !staffId) {
        throw new Error('tokenId, department, reason, and staffId are required');
      }

      // Find patient with this token
      const patient = await Patient.findOne({
        'multiStageTokens.token': tokenId,
        'multiStageTokens.department': department
      });

      if (!patient) {
        throw new Error(`Token ${tokenId} not found for department ${department}`);
      }

      // Skip the token
      patient.skipToken(tokenId, department, reason, staffId, notes);

      // Save patient
      await patient.save();

      logger.info('TOKEN_SKIPPED', {
        tokenId,
        department,
        patientId: patient.patientId,
        reason,
        staffId,
        notes,
        timestamp: new Date().toISOString()
      });

      // Return updated queue
      return await this.getLiveQueue(department);
    } catch (error) {
      logger.error('Failed to skip token', {
        tokenId,
        department,
        staffId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Reschedule a token with adjusted time
   * @param {string} tokenId - The token to reschedule
   * @param {string} department - Department code
   * @param {Date} rescheduledTime - New scheduled time for the token
   * @param {string} staffId - Staff ID performing the action
   * @param {string} reason - Reason for rescheduling
   * @param {string} notes - Additional notes
   * @returns {Promise<Object>} Updated queue information
   */
  async rescheduleToken(tokenId, department, rescheduledTime, staffId, reason, notes = '') {
    try {
      // Validate inputs
      if (!tokenId || !department || !rescheduledTime || !staffId) {
        throw new Error('tokenId, department, rescheduledTime, and staffId are required');
      }

      // Validate rescheduled time is in the future
      if (new Date(rescheduledTime) <= new Date()) {
        throw new Error('Rescheduled time must be in the future');
      }

      // Find patient with this token
      const patient = await Patient.findOne({
        'multiStageTokens.token': tokenId,
        'multiStageTokens.department': department
      });

      if (!patient) {
        throw new Error(`Token ${tokenId} not found for department ${department}`);
      }

      // Reschedule the token
      patient.rescheduleToken(tokenId, department, rescheduledTime, staffId, reason, notes);

      // Save patient
      await patient.save();

      logger.info('TOKEN_RESCHEDULED', {
        tokenId,
        department,
        patientId: patient.patientId,
        rescheduledTime,
        reason,
        staffId,
        notes,
        timestamp: new Date().toISOString()
      });

      // Return updated queue
      return await this.getLiveQueue(department);
    } catch (error) {
      logger.error('Failed to reschedule token', {
        tokenId,
        department,
        staffId,
        rescheduledTime: rescheduledTime?.toISOString?.() || rescheduledTime,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Reactivate a skipped or rescheduled token (put it back in queue)
   * @param {string} tokenId - The token to reactivate
   * @param {string} department - Department code
   * @param {string} staffId - Staff ID performing the action
   * @param {string} notes - Additional notes
   * @returns {Promise<Object>} Updated queue information
   */
  async reactivateToken(tokenId, department, staffId, notes = '') {
    try {
      // Validate inputs
      if (!tokenId || !department || !staffId) {
        throw new Error('tokenId, department, and staffId are required');
      }

      // Find patient with this token
      const patient = await Patient.findOne({
        'multiStageTokens.token': tokenId,
        'multiStageTokens.department': department
      });

      if (!patient) {
        throw new Error(`Token ${tokenId} not found for department ${department}`);
      }

      // Reactivate the token
      patient.reactivateToken(tokenId, department, staffId, notes);

      // Save patient
      await patient.save();

      logger.info('TOKEN_REACTIVATED', {
        tokenId,
        department,
        patientId: patient.patientId,
        staffId,
        notes,
        timestamp: new Date().toISOString()
      });

      // Return updated queue
      return await this.getLiveQueue(department);
    } catch (error) {
      logger.error('Failed to reactivate token', {
        tokenId,
        department,
        staffId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Recalculate EWT for a department after staff status changes
   * Used when staff becomes available or unavailable
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Updated queue with new EWT values
   */
  async recalculateEWT(departmentCode) {
    try {
      const queue = await this.getLiveQueue(departmentCode);
      
      logger.info('EWT recalculated for department', {
        department: departmentCode,
        availableStaff: queue.availableStaffCount,
        pendingTokens: queue.totalPending,
        avgServiceTime: queue.averageServiceTimeMinutes
      });

      return {
        department: departmentCode,
        availableStaffCount: queue.availableStaffCount,
        pendingTokens: queue.totalPending,
        averageServiceTimeMinutes: queue.averageServiceTimeMinutes,
        staffAdjustmentFactor: queue.staffAdjustmentFactor,
        firstPendingEWT: queue.nextTokens.length > 0 ? queue.nextTokens[0].ewtMinutes : 0,
        recalculatedAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to recalculate EWT', {
        department: departmentCode,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get affected tokens when staff availability changes
   * Returns pending tokens that will be impacted by the change
   * @param {string} departmentCode - Department code
   * @returns {Promise<Array>} Array of affected token objects
   */
  async getAffectedTokens(departmentCode) {
    try {
      const queue = await this.getLiveQueue(departmentCode);
      
      return queue.nextTokens.map((token, index) => ({
        token: token.token,
        status: token.status,
        patientId: token.patientId,
        patientName: token.patientName,
        position: index + 1,
        newEwt: token.ewtMinutes,
        estimatedCompletionTime: token.estimatedCompletionTime
      }));
    } catch (error) {
      logger.error('Failed to get affected tokens', {
        department: departmentCode,
        error: error.message
      });
      return [];
    }
  }
}

module.exports = new QueueService();