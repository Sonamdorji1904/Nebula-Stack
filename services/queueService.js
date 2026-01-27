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
   * Calculate EWT for a department based on historical data
   * @param {string} departmentCode - Department code
   * @returns {Promise<number>} Average service time in minutes
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
        return 5;
      }

      // Calculate average
      const avgTime = serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length;
      return Math.round(avgTime);
    } catch (error) {
      logger.error('Failed to calculate average service time', {
        department: departmentCode,
        error: error.message
      });
      return 5; // Default fallback
    }
  }

  /**
   * Get live queue with current token, next tokens, and EWT
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Queue object with current/next tokens and EWT
   */
  async getLiveQueue(departmentCode) {
    try {
      const activeTokens = await this.getActiveTokensByDepartment(departmentCode);
      const avgServiceTime = await this.calculateAverageServiceTime(departmentCode);

      let currentToken = null;
      const nextTokens = [];
      let cumulativeEWT = 0;

      for (const token of activeTokens) {
        if (token.status === 'in-progress' && !currentToken) {
          // First in-progress token is the current one
          currentToken = { 
            ...token, 
            ewtMinutes: 0,
            estimatedCompletionTime: null // Already being served
          };
        } else if (token.status === 'pending') {
          // Calculate cumulative EWT for pending tokens
          cumulativeEWT += avgServiceTime;
          
          const estimatedCompletionTime = new Date();
          estimatedCompletionTime.setMinutes(
            estimatedCompletionTime.getMinutes() + cumulativeEWT
          );

          nextTokens.push({ 
            ...token, 
            ewtMinutes: cumulativeEWT,
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
}

module.exports = new QueueService();