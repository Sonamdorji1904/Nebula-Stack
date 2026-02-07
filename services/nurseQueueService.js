// services/nurseQueueService.js
const Patient = require('../models/Patient');
const Staff = require('../models/staff');
const Department = require('../models/Department');
const logger = require('../utils/logger');

class NurseQueueService {
  /**
   * Get nurse's department assignments
   * @param {string} staffId - Staff ObjectId
   * @returns {Promise<Array>} Array of department codes assigned to nurse
   */
  async getNurseDepartments(staffId) {
    try {
      const nurse = await Staff.findById(staffId)
        .populate('department', 'code name')
        .lean();
      
      if (!nurse) {
        throw new Error(`Nurse with ID ${staffId} not found`);
      }

      // For now, based on the current schema, a nurse has one assigned department
      // This can be extended to support multiple departments in the future
      const departments = nurse.department ? [nurse.department.code] : [];
      
      return departments;
    } catch (error) {
      logger.error('Failed to fetch nurse departments', {
        staffId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get queue items visible to a nurse with prep status
   * @param {string} staffId - Staff ObjectId
   * @param {Object} filters - Optional filters { status, prepStatus }
   * @returns {Promise<Object>} Queue data with tokens and prep status
   */
  async getNurseQueueMonitoring(staffId, filters = {}) {
    try {
      // Get nurse's accessible departments
      const departments = await this.getNurseDepartments(staffId);

      if (departments.length === 0) {
        return {
          success: true,
          nurse: {
            staffId
          },
          departments: [],
          queues: [],
          summary: {
            totalTokens: 0,
            waitingCount: 0,
            inPrepCount: 0,
            readyCount: 0
          }
        };
      }

      // Fetch queue data for each assigned department
      const queues = [];
      const summary = {
        totalTokens: 0,
        waitingCount: 0,
        inPrepCount: 0,
        readyCount: 0
      };

      for (const departmentCode of departments) {
        const queueData = await this.getDepartmentQueueForNurse(
          departmentCode,
          filters
        );
        
        queues.push(queueData);
        
        // Update summary
        summary.totalTokens += queueData.tokens.length;
        summary.waitingCount += queueData.tokens.filter(t => t.prepStatus === 'waiting').length;
        summary.inPrepCount += queueData.tokens.filter(t => t.prepStatus === 'in-prep').length;
        summary.readyCount += queueData.tokens.filter(t => t.prepStatus === 'ready').length;
      }

      return {
        success: true,
        nurse: {
          staffId,
          timestamp: new Date().toISOString()
        },
        departments: departments,
        queues,
        summary
      };
    } catch (error) {
      logger.error('Failed to fetch nurse queue monitoring', {
        staffId,
        filters,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get queue items for a specific department visible to nurse
   * @param {string} departmentCode - Department code (e.g., 'REG', 'OPD')
   * @param {Object} filters - Optional filters { status, prepStatus }
   * @returns {Promise<Object>} Department queue with tokens and detailed prep status
   */
  async getDepartmentQueueForNurse(departmentCode, filters = {}) {
    try {
      // Verify department exists
      const department = await Department.findOne({ code: departmentCode });
      if (!department) {
        throw new Error(`Department ${departmentCode} not found`);
      }

      // Get all patients with active tokens in this department
      const patients = await Patient.find({
        'multiStageTokens.department': departmentCode,
        'multiStageTokens.status': { $in: ['pending', 'in-progress'] }
      })
        .select('patientId firstName lastName multiStageTokens')
        .lean();

      const tokens = [];
      const currentToken = null;
      const nextTokens = [];

      // Extract and format tokens with prep status
      for (const patient of patients) {
        for (const token of patient.multiStageTokens) {
          if (
            token.department === departmentCode &&
            ['pending', 'in-progress'].includes(token.status)
          ) {
            // Apply status filter if specified
            if (filters.status && token.status !== filters.status) {
              continue;
            }

            // Apply prep status filter if specified
            if (filters.prepStatus && token.prepStatus !== filters.prepStatus) {
              continue;
            }

            const tokenData = {
              token: token.token,
              status: token.status,
              prepStatus: token.prepStatus,
              patientId: patient.patientId,
              patientName: `${patient.firstName} ${patient.lastName}`,
              createdAt: token.createdAt,
              issuedAt: token.issuedAt,
              prepStartedAt: token.prepStartedAt,
              prepReadyAt: token.prepReadyAt,
              stage: token.stage,
              auditHistoryCount: token.auditHistory ? token.auditHistory.length : 0
            };

            tokens.push(tokenData);
          }
        }
      }

      // Sort by creation time (FIFO) - pending tokens first, then in-progress
      tokens.sort((a, b) => {
        if (a.status === b.status) {
          return new Date(a.createdAt) - new Date(b.createdAt);
        }
        return a.status === 'in-progress' ? -1 : 1;
      });

      // Split into current and next tokens
      let current = null;
      const next = [];

      for (const token of tokens) {
        if (token.status === 'in-progress' && !current) {
          current = token;
        } else {
          next.push(token);
        }
      }

      // Calculate average service time for EWT
      const avgServiceTime = await this.calculateAverageServiceTimeForDepartment(departmentCode);

      // Calculate estimated wait times with prep status consideration
      let cumulativeEWT = 0;
      const tokensWithEWT = next.map((token, index) => {
        cumulativeEWT += avgServiceTime;
        
        const estimatedCompletionTime = new Date();
        estimatedCompletionTime.setMinutes(
          estimatedCompletionTime.getMinutes() + cumulativeEWT
        );

        return {
          ...token,
          position: index + 1,
          estimatedWaitMinutes: cumulativeEWT,
          estimatedCompletionTime: estimatedCompletionTime.toISOString()
        };
      });

      return {
        department: {
          code: departmentCode,
          name: department.name
        },
        currentToken: current ? {
          ...current,
          estimatedWaitMinutes: 0,
          estimatedCompletionTime: null
        } : null,
        nextTokens: tokensWithEWT,
        totalPending: tokensWithEWT.length,
        totalInProgress: current ? 1 : 0,
        averageServiceTimeMinutes: avgServiceTime,
        statistics: {
          waitingCount: tokensWithEWT.filter(t => t.prepStatus === 'waiting').length,
          inPrepCount: tokensWithEWT.filter(t => t.prepStatus === 'in-prep').length,
          readyCount: tokensWithEWT.filter(t => t.prepStatus === 'ready').length
        }
      };
    } catch (error) {
      logger.error('Failed to fetch department queue for nurse', {
        departmentCode,
        filters,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Calculate average service time for a department
   * @param {string} departmentCode - Department code
   * @returns {Promise<number>} Average service time in minutes
   */
  async calculateAverageServiceTimeForDepartment(departmentCode) {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Find completed tokens in the last 30 days
      const patients = await Patient.find({
        'multiStageTokens.department': departmentCode,
        'multiStageTokens.status': 'completed',
        'multiStageTokens.completedAt': { $gte: thirtyDaysAgo }
      })
        .select('multiStageTokens')
        .lean();

      const serviceTimes = [];

      for (const patient of patients) {
        for (const token of patient.multiStageTokens) {
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
      const avgTime = serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length;
      return Math.round(avgTime);
    } catch (error) {
      logger.error('Failed to calculate average service time for department', {
        departmentCode,
        error: error.message
      });
      return 5; // Default fallback
    }
  }

  /**
   * Update token prep status for a nurse
   * @param {string} staffId - Staff ObjectId
   * @param {string} tokenId - Token string
   * @param {string} departmentCode - Department code
   * @param {string} newPrepStatus - New prep status (waiting, in-prep, ready, completed)
   * @param {string} notes - Optional notes
   * @returns {Promise<Object>} Updated token data
   */
  async updateTokenPrepStatus(
    staffId,
    tokenId,
    departmentCode,
    newPrepStatus,
    notes = ''
  ) {
    try {
      // Verify nurse has access to this department
      const departments = await this.getNurseDepartments(staffId);
      if (!departments.includes(departmentCode)) {
        throw new Error(
          `Nurse does not have access to department ${departmentCode}`
        );
      }

      // Find patient with this token
      const patient = await Patient.findOne({
        'multiStageTokens.token': tokenId,
        'multiStageTokens.department': departmentCode
      });

      if (!patient) {
        throw new Error(
          `Token ${tokenId} not found in department ${departmentCode}`
        );
      }

      // Update prep status using the model method
      patient.updatePrepStatus(tokenId, departmentCode, newPrepStatus, staffId, notes);
      await patient.save();

      // Fetch and return updated token data
      const tokenEntry = patient.multiStageTokens.find(
        t => t.token === tokenId && t.department === departmentCode
      );

      return {
        success: true,
        token: tokenId,
        department: departmentCode,
        prepStatus: tokenEntry.prepStatus,
        status: tokenEntry.status,
        patientId: patient.patientId,
        patientName: `${patient.firstName} ${patient.lastName}`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to update token prep status', {
        staffId,
        tokenId,
        departmentCode,
        newPrepStatus,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get detailed token information for nurse
   * @param {string} staffId - Staff ObjectId
   * @param {string} tokenId - Token string
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Detailed token information including audit history
   */
  async getTokenDetails(staffId, tokenId, departmentCode) {
    try {
      // Verify nurse has access to this department
      const departments = await this.getNurseDepartments(staffId);
      if (!departments.includes(departmentCode)) {
        throw new Error(
          `Nurse does not have access to department ${departmentCode}`
        );
      }

      // Find patient with this token
      const patient = await Patient.findOne({
        'multiStageTokens.token': tokenId,
        'multiStageTokens.department': departmentCode
      }).lean();

      if (!patient) {
        throw new Error(
          `Token ${tokenId} not found in department ${departmentCode}`
        );
      }

      const tokenEntry = patient.multiStageTokens.find(
        t => t.token === tokenId && t.department === departmentCode
      );

      return {
        success: true,
        token: {
          token: tokenEntry.token,
          department: tokenEntry.department,
          status: tokenEntry.status,
          prepStatus: tokenEntry.prepStatus,
          stage: tokenEntry.stage,
          createdAt: tokenEntry.createdAt,
          issuedAt: tokenEntry.issuedAt,
          prepStartedAt: tokenEntry.prepStartedAt,
          prepReadyAt: tokenEntry.prepReadyAt,
          completedAt: tokenEntry.completedAt,
          auditHistory: tokenEntry.auditHistory || []
        },
        patient: {
          id: patient.patientId,
          name: `${patient.firstName} ${patient.lastName}`,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
          contactNumber: patient.contactNumber
        }
      };
    } catch (error) {
      logger.error('Failed to fetch token details', {
        staffId,
        tokenId,
        departmentCode,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new NurseQueueService();
