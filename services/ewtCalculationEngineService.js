// services/ewtCalculationEngineService.js
/**
 * EWT Calculation Engine Service
 * Advanced estimations wait time calculations with multiple factors
 * Uses historical data, queue position, staff availability, and time patterns
 */

const Patient = require('../models/Patient');
const Staff = require('../models/staff');
const Department = require('../models/Department');
const HistoricalServiceTime = require('../models/HistoricalServiceTime');
const historicalDataCollectionService = require('./historicalDataCollectionService');
const logger = require('../utils/logger');

class EWTCalculationEngineService {
  constructor() {
    // Algorithm weights - can be tuned via configuration
    this.weights = {
      queue_position: 0.4, // Most important factor
      staff_availability: 0.25, // Fewer staff = longer wait
      historical_avg: 0.2, // Based on historical patterns
      current_load: 0.1, // Current departmental load
      time_pattern: 0.05 // Time-of-day variations
    };

    // Performance cache
    this.estimateCache = new Map();
    this.cacheValidityMs = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Main EWT calculation method
   * @param {string} tokenId - Token to calculate EWT for
   * @param {string} departmentCode - Department code
   * @param {Object} options - Calculation options
   * @returns {Promise<Object>} EWT data with confidence and ranges
   */
  async calculateEWT(tokenId, departmentCode, options = {}) {
    const {
      percentile = 90,
      useCache = true,
      returnRanges = true,
      calculationMode = 'balanced' // 'optimistic', 'pessimistic', 'balanced'
    } = options;

    try {
      // Check cache
      const cacheKey = `${tokenId}_${departmentCode}`;
      if (useCache) {
        const cached = this.estimateCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheValidityMs) {
          logger.debug('Using cached EWT estimate', { tokenId, cacheHit: true });
          return cached.data;
        }
      }

      // Validate inputs
      const patient = await Patient.findOne({
        'activeTokens.token': tokenId
      });
      if (!patient) {
        throw new Error(`Token not found: ${tokenId}`);
      }

      const token = patient.activeTokens.find((t) => t.token === tokenId);
      if (!token) {
        throw new Error(`Token not in active tokens: ${tokenId}`);
      }

      // Get department info
      const department = await Department.findOne({ code: departmentCode });
      if (!department) {
        throw new Error(`Department not found: ${departmentCode}`);
      }

      // Calculate components
      const queueData = await this.getQueueData(departmentCode);
      const staffData = await this.getStaffData(department._id);
      const historicalData = await this.getHistoricalData(departmentCode);
      const timePattern = this.getTimePattern();

      // Get token position
      const tokenPosition = await this.getTokenPosition(
        tokenId,
        departmentCode
      );

      // Calculate EWT
      const result = this.applyAlgorithm({
        tokenPosition,
        queueData,
        staffData,
        historicalData,
        timePattern,
        calculationMode,
        percentile,
        returnRanges,
        token
      });

      // Cache result
      this.estimateCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      logger.error('Failed to calculate EWT', {
        tokenId,
        department: departmentCode,
        error: error.message
      });

      // Return fallback with high uncertainty
      return this.getFallbackEWT(tokenId, departmentCode);
    }
  }

  /**
   * Get queue statistics for a department
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Queue data
   */
  async getQueueData(departmentCode) {
    try {
      const patients = await Patient.find({
        'activeTokens.department': departmentCode,
        'activeTokens.status': { $in: ['pending', 'in-progress'] }
      })
        .select('activeTokens')
        .lean();

      let pendingCount = 0;
      let inProgressCount = 0;
      let currentTokenOnly = null;

      for (const patient of patients) {
        for (const token of patient.activeTokens) {
          if (token.department === departmentCode) {
            if (token.status === 'pending') {
              pendingCount++;
            } else if (token.status === 'in-progress') {
              inProgressCount++;
              if (!currentTokenOnly) {
                currentTokenOnly = {
                  token: token.token,
                  issuedAt: token.issuedAt,
                  elapsedMinutes: (Date.now() - new Date(token.issuedAt)) / 60000
                };
              }
            }
          }
        }
      }

      // Calculate queue pressure (0-1)
      const queuePressure = Math.min(1, (pendingCount + inProgressCount) / 20); // Normalize to 20 tokens

      return {
        pendingCount,
        inProgressCount,
        totalActive: pendingCount + inProgressCount,
        queuePressure,
        currentToken: currentTokenOnly
      };
    } catch (error) {
      logger.error('Failed to get queue data', {
        department: departmentCode,
        error: error.message
      });
      return {
        pendingCount: 0,
        inProgressCount: 0,
        totalActive: 0,
        queuePressure: 0,
        currentToken: null
      };
    }
  }

  /**
   * Get staff availability data
   * @param {string} departmentId - Department MongoDB ID
   * @returns {Promise<Object>} Staff data
   */
  async getStaffData(departmentId) {
    try {
      const staffMembers = await Staff.find({
        department: departmentId,
        isActive: true,
        isOnDuty: true
      }).select('currentStatus staffId');

      const statusCounts = {
        available: 0,
        busy: 0,
        onBreak: 0,
        offline: 0
      };

      for (const staff of staffMembers) {
        switch (staff.currentStatus) {
          case 'available':
            statusCounts.available++;
            break;
          case 'busy':
            statusCounts.busy++;
            break;
          case 'on-break':
            statusCounts.onBreak++;
            break;
          case 'offline':
            statusCounts.offline++;
            break;
        }
      }

      const totalStaff = staffMembers.length;
      const availableStaff = statusCounts.available;
      const effectiveStaff = availableStaff + statusCounts.busy * 0.5; // Busy staff are partially effective

      return {
        totalStaff,
        availableStaff,
        busyStaff: statusCounts.busy,
        onBreakStaff: statusCounts.onBreak,
        offlineStaff: statusCounts.offline,
        effectiveStaff: Math.max(0.5, effectiveStaff), // At least 0.5
        staffUtilization: totalStaff > 0 ? statusCounts.busy / totalStaff : 0
      };
    } catch (error) {
      logger.error('Failed to get staff data', {
        department: departmentId,
        error: error.message
      });
      return {
        totalStaff: 1,
        availableStaff: 1,
        busyStaff: 0,
        onBreakStaff: 0,
        offlineStaff: 0,
        effectiveStaff: 1,
        staffUtilization: 0
      };
    }
  }

  /**
   * Get historical service time data
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Historical data
   */
  async getHistoricalData(departmentCode) {
    try {
      const estimate = await historicalDataCollectionService.getBestEstimate(
        departmentCode,
        'General',
        { useTimeOfDay: true, percentile: 90 }
      );

      return {
        mean: estimate.baseEstimate,
        percentile90: estimate.estimate,
        confidence: estimate.confidence,
        sampleCount: estimate.sampleCount,
        source: estimate.source
      };
    } catch (error) {
      logger.error('Failed to get historical data', {
        department: departmentCode,
        error: error.message
      });
      return {
        mean: 5,
        percentile90: 8,
        confidence: 0.2,
        sampleCount: 0,
        source: 'default_error'
      };
    }
  }

  /**
   * Get time-of-day adjustment factor
   * Accounts for peak vs off-peak hours
   * @returns {Object} Time pattern data
   */
  getTimePattern() {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    // Peak hours: 9-11am, 2-4pm typically busier
    let peakFactor = 1.0;
    if ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 16)) {
      peakFactor = 1.3; // 30% longer during peak
    } else if ((hour >= 6 && hour < 9) || (hour >= 4 && hour < 6)) {
      peakFactor = 1.15; // 15% longer during shoulder hours
    } else if (hour >= 18 || hour < 6) {
      peakFactor = 0.7; // 30% shorter during off-hours
    }

    // Weekend factor (typically less busy)
    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.85 : 1.0;

    return {
      hour,
      dayOfWeek,
      peakFactor,
      weekendFactor,
      combinedFactor: peakFactor * weekendFactor
    };
  }

  /**
   * Get this token's position in queue
   * @param {string} tokenId - Token ID
   * @param {string} departmentCode - Department code
   * @returns {Promise<number>} Queue position (1-indexed)
   */
  async getTokenPosition(tokenId, departmentCode) {
    try {
      const patients = await Patient.find({
        'activeTokens.department': departmentCode,
        'activeTokens.status': { $in: ['pending', 'in-progress'] }
      })
        .select('activeTokens')
        .lean();

      const tokens = [];
      for (const patient of patients) {
        for (const token of patient.activeTokens) {
          if (
            token.department === departmentCode &&
            ['pending', 'in-progress'].includes(token.status)
          ) {
            tokens.push({
              token: token.token,
              createdAt: token.createdAt,
              status: token.status,
              priority: token.followup_priority || 'normal'
            });
          }
        }
      }

      // Sort by creation time (FIFO) but consider priority
      tokens.sort((a, b) => {
        if (a.status !== b.status) {
          // In-progress comes first
          return a.status === 'in-progress' ? -1 : 1;
        }

        // Within same status, sort by priority then by time
        const priorityMap = { high: 0, normal: 1, low: 2 };
        const priorityDiff =
          priorityMap[a.priority] - priorityMap[b.priority];
        if (priorityDiff !== 0) return priorityDiff;

        return new Date(a.createdAt) - new Date(b.createdAt);
      });

      const position = tokens.findIndex((t) => t.token === tokenId) + 1;

      return Math.max(1, position); // At least position 1
    } catch (error) {
      logger.error('Failed to get token position', {
        tokenId,
        department: departmentCode,
        error: error.message
      });
      return 1;
    }
  }

  /**
   * Apply weighted algorithm to calculate EWT
   * @param {Object} components - All calculation components
   * @returns {Object} EWT calculation result
   */
  applyAlgorithm(components) {
    const {
      tokenPosition,
      queueData,
      staffData,
      historicalData,
      timePattern,
      calculationMode,
      percentile,
      returnRanges,
      token
    } = components;

    // Base calculation: tokens ahead * avg service time
    let baseEWT = 0;

    if (tokenPosition === 1 && queueData.inProgressCount === 0) {
      // First in queue with no current service
      baseEWT = 0;
    } else if (tokenPosition === 1 && queueData.currentToken) {
      // Current token being served
      const remainingMinutes = Math.max(
        0,
        historicalData.percentile90 - queueData.currentToken.elapsedMinutes
      );
      baseEWT = Math.ceil(remainingMinutes);
    } else {
      // Tokens ahead need to be served
      const tokensAhead = tokenPosition - 1; // Subtract self
      baseEWT =
        tokensAhead *
        historicalData.percentile90;

      // Add time for current token if being served
      if (queueData.currentToken) {
        const remainingMinutes = Math.max(
          0,
          historicalData.percentile90 -
            queueData.currentToken.elapsedMinutes
        );
        baseEWT += Math.ceil(remainingMinutes);
      }
    }

    // Staff availability adjustment
    const staffFactor = Math.max(0.3, 1 / staffData.effectiveStaff);

    // Queue pressure adjustment
    const pressureFactor = 1 + queueData.queuePressure * 0.5;

    // Time pattern adjustment
    const timeAdjustment = timePattern.combinedFactor;

    // Confidence-based adjustment
    const confidenceAdjustment = 0.8 + historicalData.confidence * 0.2;

    // Calculate final EWT
    let ewt = baseEWT * staffFactor * pressureFactor * timeAdjustment;

    // Apply calculation mode
    switch (calculationMode) {
      case 'optimistic':
        ewt = Math.ceil(ewt * 0.8); // 20% reduction
        break;
      case 'pessimistic':
        ewt = Math.ceil(ewt * 1.2); // 20% increase
        break;
      case 'balanced':
      default:
        ewt = Math.ceil(ewt);
    }

    // Ensure minimum of 1 minute if there's a queue
    if (queueData.totalActive > 0 && ewt === 0) {
      ewt = 1;
    }

    // Cap at reasonable maximum (480 minutes = 8 hours)
    ewt = Math.min(ewt, 480);

    // Calculate confidence range if requested
    let uncertaintyRange = null;
    if (returnRanges) {
      const variance =
        historicalData.confidence < 0.5
          ? 0.4
          : (1 - historicalData.confidence) * 0.6;
      const lowerBound = Math.max(0, Math.ceil(ewt * (1 - variance)));
      const upperBound = Math.ceil(ewt * (1 + variance));

      uncertaintyRange = {
        lower: lowerBound,
        upper: upperBound,
        confidence: historicalData.confidence
      };
    }

    // Calculate detailed breakdown for logging
    const breakdown = {
      baseEWT: Math.ceil(baseEWT),
      staffFactor: Math.round(staffFactor * 100) / 100,
      pressureFactor: Math.round(pressureFactor * 100) / 100,
      timeAdjustment: Math.round(timeAdjustment * 100) / 100,
      confidenceAdjustment: Math.round(confidenceAdjustment * 100) / 100
    };

    return {
      ewt: Math.max(0, ewt),
      tokenPosition,
      confidence: historicalData.confidence,
      uncertaintyRange,
      breakdown,
      calculatedAt: new Date(),
      baseEstimate: historicalData.percentile90,
      historicalSamples: historicalData.sampleCount,
      queueStats: {
        pending: queueData.pendingCount,
        inProgress: queueData.inProgressCount,
        pressure: Math.round(queueData.queuePressure * 100)
      },
      staffStats: {
        available: staffData.availableStaff,
        total: staffData.totalStaff,
        utilization: Math.round(staffData.staffUtilization * 100)
      },
      timeInfo: {
        hour: timePattern.hour,
        dayOfWeek: timePattern.dayOfWeek,
        isPeakHour: timePattern.peakFactor > 1.1,
        isMaintenance: false
      }
    };
  }

  /**
   * Get fallback EWT for error conditions
   * @param {string} tokenId - Token ID
   * @param {string} departmentCode - Department code
   * @returns {Object} Fallback EWT data
   */
  getFallbackEWT(tokenId, departmentCode) {
    return {
      ewt: 10, // 10 minute default
      tokenPosition: -1,
      confidence: 0.1,
      uncertaintyRange: {
        lower: 5,
        upper: 20,
        confidence: 0.1
      },
      breakdown: {
        baseEWT: 10,
        staffFactor: 1,
        pressureFactor: 1,
        timeAdjustment: 1,
        confidenceAdjustment: 0.1
      },
      calculatedAt: new Date(),
      baseEstimate: 10,
      historicalSamples: 0,
      queueStats: {
        pending: -1,
        inProgress: -1,
        pressure: 0
      },
      staffStats: {
        available: -1,
        total: -1,
        utilization: 0
      },
      timeInfo: {
        hour: new Date().getHours(),
        dayOfWeek: new Date().getDay(),
        isPeakHour: false,
        isMaintenance: false
      },
      error: 'Fallback calculation due to error',
      tokenId,
      department: departmentCode
    };
  }

  /**
   * Clear the cache
   * Useful for testing or forcing recalculation
   */
  clearCache() {
    this.estimateCache.clear();
    logger.info('EWT calculation cache cleared');
  }

  /**
   * Set algorithm weights
   * @param {Object} weights - New weights object
   */
  setWeights(weights) {
    if (
      !weights ||
      typeof weights !== 'object'
    ) {
      throw new Error('Invalid weights object');
    }

    this.weights = { ...this.weights, ...weights };
    logger.info('EWT algorithm weights updated', { weights: this.weights });
  }
}

module.exports = new EWTCalculationEngineService();
