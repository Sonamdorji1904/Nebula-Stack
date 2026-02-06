// services/tokenDetailService.js
const Patient = require('../models/Patient');
const Department = require('../models/Department');
const logger = require('../utils/logger');

class TokenDetailService {
  /**
   * Fetch token detail by token ID with full history and EWT
   * @param {string} tokenId - The token string (e.g., 'REG-001')
   * @param {Object} user - Authenticated user object with role and department
   * @returns {Promise<Object>} Token detail with history and EWT
   */
  async getTokenDetail(tokenId, user) {
    try {
      // Validate token format
      if (!tokenId || typeof tokenId !== 'string') {
        throw new Error('Invalid token ID format');
      }

      // Find patient with this token
      const patient = await Patient.findOne({
        'activeTokens.token': tokenId
      });

      if (!patient) {
        throw new Error(`Token not found: ${tokenId}`);
      }

      // Find the specific token in activeTokens
      const token = patient.activeTokens.find(t => t.token === tokenId);
      if (!token) {
        throw new Error(`Token not found in active tokens: ${tokenId}`);
      }

      // Get department info for validation
      const department = await Department.findOne({ code: token.department });
      if (!department) {
        throw new Error(`Department not found: ${token.department}`);
      }

      // Apply role-based access control
      await this.validateTokenAccess(user, token, patient);

      // Calculate EWT based on current queue state
      const ewtMinutes = await this.calculateEWTForToken(token.department);

      // Build comprehensive token detail response
      const tokenDetail = {
        token: token.token,
        department: token.department,
        status: token.status,
        stage: token.stage,
        issuedAt: token.issuedAt,
        currentStage: token.stage,
        ewtMinutes,
        completedAt: token.completedAt || null,
        skippedAt: token.skippedAt || null,
        rescheduledAt: token.rescheduledAt || null,
        patientName: `${patient.firstName} ${patient.lastName}`,
        patientId: patient.patientId,
        history: this.formatAuditHistory(token.auditHistory || [])
      };

      logger.info('Token detail retrieved successfully', {
        tokenId,
        department: token.department,
        status: token.status,
        patientId: patient.patientId
      });

      return tokenDetail;
    } catch (error) {
      logger.error('Failed to fetch token detail', {
        tokenId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Validate if user has permission to access this token
   * @param {Object} user - Authenticated user
   * @param {Object} token - Token object
   * @param {Object} patient - Patient object
   * @throws {Error} If user cannot access this token
   */
  async validateTokenAccess(user, token, patient) {
    // Admin or staff with queue:view permission can access all tokens
    if (user.role.permissions.includes('queue:view')) {
      // If user has department constraint, check if token is in their department
      if (user.department && user.department.code !== token.department) {
        throw new Error('Access denied: Token is not in your department');
      }
      return;
    }

    // Patients can only view their own tokens
    if (user.role.name === 'patient') {
      if (patient.patientId !== user.patientId) {
        throw new Error('Access denied: Cannot view other patients\' tokens');
      }
      return;
    }

    throw new Error('Insufficient permissions to access token details');
  }

  /**
   * Calculate EWT (Estimated Wait Time) for a specific department
   * Uses the same algorithm as queueService
   * @param {string} departmentCode - Department code
   * @returns {Promise<number>} EWT in minutes
   */
  async calculateEWTForToken(departmentCode) {
    try {
      const avgServiceTime = await this.calculateAverageServiceTime(departmentCode);

      // Get current queue count for this department
      const patients = await Patient.find({
        'activeTokens.department': departmentCode,
        'activeTokens.status': { $in: ['pending', 'in-progress'] }
      })
        .select('activeTokens')
        .lean();

      let pendingCount = 0;
      let hasInProgress = false;

      for (const patient of patients) {
        for (const token of patient.activeTokens) {
          if (token.department === departmentCode) {
            if (token.status === 'pending') {
              pendingCount++;
            } else if (token.status === 'in-progress') {
              hasInProgress = true;
            }
          }
        }
      }

      // EWT = (tokens in queue) * average service time
      // If there's a token being served, add remaining time estimate
      let ewtMinutes = pendingCount * avgServiceTime;

      // Add buffer for current service
      if (hasInProgress) {
        ewtMinutes += Math.ceil(avgServiceTime / 2);
      }

      return Math.max(0, ewtMinutes);
    } catch (error) {
      logger.error('Failed to calculate EWT for token', {
        department: departmentCode,
        error: error.message
      });
      return 5; // Default fallback
    }
  }

  /**
   * Calculate average service time from historical data
   * Reuses logic from queueService for consistency
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

            if (serviceTime > 0 && serviceTime < 120) {
              // Sanity check: 0-120 mins
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
      const avgTime =
        serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length;
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
   * Format audit history for response
   * @param {Array} auditHistory - Raw audit history array
   * @returns {Array} Formatted audit history
   */
  formatAuditHistory(auditHistory) {
    return auditHistory.map(entry => ({
      action: entry.action,
      timestamp: entry.timestamp,
      staffId: entry.staffId || null,
      reason: entry.reason || null,
      notes: entry.notes || null,
      previousStatus: entry.previousStatus || null,
      newStatus: entry.newStatus || null,
      rescheduledTime: entry.rescheduledTime || null
    }));
  }

  /**
   * Get token history only (without full detail)
   * @param {string} tokenId - Token ID
   * @param {Object} user - Authenticated user
   * @returns {Promise<Array>} Audit history
   */
  async getTokenHistory(tokenId, user) {
    try {
      const patient = await Patient.findOne({
        'activeTokens.token': tokenId
      });

      if (!patient) {
        throw new Error(`Token not found: ${tokenId}`);
      }

      const token = patient.activeTokens.find(t => t.token === tokenId);
      if (!token) {
        throw new Error(`Token not found in active tokens: ${tokenId}`);
      }

      // Validate access
      await this.validateTokenAccess(user, token, patient);

      return this.formatAuditHistory(token.auditHistory || []);
    } catch (error) {
      logger.error('Failed to fetch token history', {
        tokenId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get token stage/status only
   * @param {string} tokenId - Token ID
   * @param {Object} user - Authenticated user
   * @returns {Promise<Object>} Stage and status info
   */
  async getTokenStageInfo(tokenId, user) {
    try {
      const patient = await Patient.findOne({
        'activeTokens.token': tokenId
      });

      if (!patient) {
        throw new Error(`Token not found: ${tokenId}`);
      }

      const token = patient.activeTokens.find(t => t.token === tokenId);
      if (!token) {
        throw new Error(`Token not found in active tokens: ${tokenId}`);
      }

      // Validate access
      await this.validateTokenAccess(user, token, patient);

      return {
        token: token.token,
        status: token.status,
        stage: token.stage,
        department: token.department
      };
    } catch (error) {
      logger.error('Failed to fetch token stage info', {
        tokenId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new TokenDetailService();
