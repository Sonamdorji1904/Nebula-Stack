// services/ewtRecalculationService.js
/**
 * EWT Recalculation Service
 * Handles real-time EWT recalculation triggers and event management
 * Provides debouncing and batch processing for efficiency
 */

const Patient = require('../models/Patient');
const ewtCalculationEngine = require('./ewtCalculationEngineService');
const ewtMetricsCollector = require('../utils/ewtMetricsCollector');
const logger = require('../utils/logger');

class EWTRecalculationService {
  constructor() {
    // Trigger event listeners
    this.listeners = [];

    // Debounce configuration
    this.debounceTimers = {};
    this.debounceIntervalMs = 2000; // 2 second debounce

    // Pending recalculations batch
    this.pendingRecalculations = new Set();
    this.batchProcessInterval = null;
  }

  /**
   * Register a trigger listener
   * @param {Function} callback - Callback function when triggers fire
   */
  registerListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
      logger.info('EWT recalculation listener registered');
    }
  }

  /**
   * Notify all listeners of recalculation
   * @param {Object} event - Recalculation event data
   */
  async notifyListeners(event) {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        logger.error('Error in EWT recalculation listener', {
          error: error.message
        });
      }
    }
  }

  /**
   * Trigger: Staff status changed
   * Fire when a staff member changes their availability status
   * @param {string} staffId - Staff member ID
   * @param {string} previousStatus - Previous status
   * @param {string} newStatus - New status
   * @param {string} departmentCode - Department code
   */
  async onStaffStatusChanged(
    staffId,
    previousStatus,
    newStatus,
    departmentCode
  ) {
    try {
      logger.info('EWT Trigger: Staff status changed', {
        staffId,
        previousStatus,
        newStatus,
        department: departmentCode
      });

      // Debounce rapid successive changes
      this.debounceRecalculation(
        `staff_${staffId}`,
        async () => {
          await this.recalculateDepartmentEWT(departmentCode, {
            trigger: 'staff_status_changed',
            staffId,
            previousStatus,
            newStatus
          });
        }
      );
    } catch (error) {
      logger.error('Failed to handle staff status change trigger', {
        staffId,
        error: error.message
      });
    }
  }

  /**
   * Trigger: Token added to queue
   * Fire when a new token is created
   * @param {string} tokenId - New token ID
   * @param {string} departmentCode - Department code
   * @param {Object} tokenData - Token data
   */
  async onTokenAdded(tokenId, departmentCode, tokenData = {}) {
    try {
      logger.info('EWT Trigger: Token added', {
        tokenId,
        department: departmentCode
      });

      // Debounce batch additions
      this.debounceRecalculation(
        `token_added_${departmentCode}`,
        async () => {
          await this.recalculateDepartmentEWT(departmentCode, {
            trigger: 'token_added',
            newTokenId: tokenId,
            tokenData
          });
        }
      );
    } catch (error) {
      logger.error('Failed to handle token added trigger', {
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Trigger: Token completed
   * Fire when a token is marked as completed
   * @param {string} tokenId - Completed token ID
   * @param {string} departmentCode - Department code
   * @param {number} actualServiceTime - Actual service time in minutes
   */
  async onTokenCompleted(
    tokenId,
    departmentCode,
    actualServiceTime
  ) {
    try {
      logger.info('EWT Trigger: Token completed', {
        tokenId,
        department: departmentCode,
        actualServiceTime
      });

      // Record metrics
      ewtMetricsCollector.recordTokenCompletion(
        tokenId,
        departmentCode,
        actualServiceTime
      );

      // Recalculate with higher urgency
      await this.recalculateDepartmentEWT(departmentCode, {
        trigger: 'token_completed',
        completedTokenId: tokenId,
        actualServiceTime,
        priority: 'high'
      });
    } catch (error) {
      logger.error('Failed to handle token completed trigger', {
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Trigger: Token cancelled/skipped
   * Fire when a token is removed from queue
   * @param {string} tokenId - Cancelled token ID
   * @param {string} departmentCode - Department code
   * @param {string} reason - Cancellation reason
   */
  async onTokenCancelled(tokenId, departmentCode, reason = '') {
    try {
      logger.info('EWT Trigger: Token cancelled', {
        tokenId,
        department: departmentCode,
        reason
      });

      // Recalculate immediately
      await this.recalculateDepartmentEWT(departmentCode, {
        trigger: 'token_cancelled',
        cancelledTokenId: tokenId,
        reason,
        priority: 'high'
      });
    } catch (error) {
      logger.error('Failed to handle token cancelled trigger', {
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Trigger: Priority token changed
   * Fire when a token's priority level is updated
   * @param {string} tokenId - Token ID
   * @param {string} departmentCode - Department code
   * @param {string} previousPriority - Previous priority
   * @param {string} newPriority - New priority
   */
  async onPriorityChanged(
    tokenId,
    departmentCode,
    previousPriority,
    newPriority
  ) {
    try {
      logger.info('EWT Trigger: Token priority changed', {
        tokenId,
        department: departmentCode,
        previousPriority,
        newPriority
      });

      // Recalculate immediately due to reordering
      await this.recalculateDepartmentEWT(departmentCode, {
        trigger: 'priority_changed',
        affectedTokenId: tokenId,
        previousPriority,
        newPriority,
        priority: 'high'
      });
    } catch (error) {
      logger.error('Failed to handle priority change trigger', {
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Trigger: Token rescheduled
   * Fire when a token is rescheduled
   * @param {string} tokenId - Token ID
   * @param {string} departmentCode - Department code
   * @param {Date} newScheduledTime - New scheduled time
   */
  async onTokenRescheduled(
    tokenId,
    departmentCode,
    newScheduledTime
  ) {
    try {
      logger.info('EWT Trigger: Token rescheduled', {
        tokenId,
        department: departmentCode,
        newScheduledTime
      });

      // Recalculate for remaining queue
      await this.recalculateDepartmentEWT(departmentCode, {
        trigger: 'token_rescheduled',
        rescheduledTokenId: tokenId,
        newScheduledTime,
        priority: 'medium'
      });
    } catch (error) {
      logger.error('Failed to handle token rescheduled trigger', {
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Debounce recalculation to avoid excessive updates
   * @param {string} key - Debounce key
   * @param {Function} fn - Function to debounce
   */
  debounceRecalculation(key, fn) {
    // Clear existing timer
    if (this.debounceTimers[key]) {
      clearTimeout(this.debounceTimers[key]);
    }

    // Set new debounced timer
    this.debounceTimers[key] = setTimeout(async () => {
      try {
        await fn();
      } catch (error) {
        logger.error('Error in debounced recalculation', {
          key,
          error: error.message
        });
      } finally {
        delete this.debounceTimers[key];
      }
    }, this.debounceIntervalMs);
  }

  /**
   * Recalculate EWT for all tokens in a department
   * @param {string} departmentCode - Department code
   * @param {Object} triggerEvent - Event that triggered recalculation
   * @returns {Promise<Object>} Recalculation results
   */
  async recalculateDepartmentEWT(departmentCode, triggerEvent = {}) {
    const startTime = Date.now();
    let recalculatedCount = 0;
    let errorCount = 0;

    try {
      logger.info('Starting EWT recalculation', {
        department: departmentCode,
        trigger: triggerEvent.trigger
      });

      // Get all active tokens in department
      const patients = await Patient.find({
        'activeTokens.department': departmentCode,
        'activeTokens.status': { $in: ['pending', 'in-progress'] }
      })
        .select('patientId activeTokens')
        .lean();

      const results = {
        department: departmentCode,
        trigger: triggerEvent.trigger,
        recalculated: [],
        errors: [],
        timestamp: new Date()
      };

      // Recalculate EWT for each token
      for (const patient of patients) {
        for (const token of patient.activeTokens) {
          if (
            token.department === departmentCode &&
            ['pending', 'in-progress'].includes(token.status)
          ) {
            try {
              const ewtResult = await ewtCalculationEngine.calculateEWT(
                token.token,
                departmentCode,
                { useCache: false } // Force recalculation
              );

              results.recalculated.push({
                tokenId: token.token,
                newEWT: ewtResult.ewt,
                position: ewtResult.tokenPosition,
                confidence: ewtResult.confidence,
                status: token.status
              });

              recalculatedCount++;

              // Record metrics
              ewtMetricsCollector.recordEWTCalculation(
                token.token,
                departmentCode,
                ewtResult.ewt
              );
            } catch (tokenError) {
              errorCount++;
              results.errors.push({
                tokenId: token.token,
                error: tokenError.message
              });

              logger.error('Failed to recalculate EWT for token', {
                token: token.token,
                error: tokenError.message
              });
            }
          }
        }
      }

      const duration = Date.now() - startTime;

      logger.info('EWT recalculation completed', {
        department: departmentCode,
        trigger: triggerEvent.trigger,
        recalculated: recalculatedCount,
        errors: errorCount,
        duration
      });

      // Notify listeners
      await this.notifyListeners({
        ...triggerEvent,
        results,
        duration
      });

      return results;
    } catch (error) {
      logger.error('Failed to recalculate department EWT', {
        department: departmentCode,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Batch process pending recalculations
   * Called periodically to process accumulated changes
   */
  async processPendingRecalculations() {
    if (this.pendingRecalculations.size === 0) {
      return;
    }

    try {
      logger.info('Processing pending EWT recalculations', {
        count: this.pendingRecalculations.size
      });

      const departments = Array.from(this.pendingRecalculations);
      this.pendingRecalculations.clear();

      for (const departmentCode of departments) {
        try {
          await this.recalculateDepartmentEWT(departmentCode, {
            trigger: 'batch_processing'
          });
        } catch (error) {
          logger.error('Error processing pending recalculation', {
            department: departmentCode,
            error: error.message
          });
        }
      }
    } catch (error) {
      logger.error('Failed to process pending recalculations', {
        error: error.message
      });
    }
  }

  /**
   * Start background batch processing
   * @param {number} intervalSeconds - Interval between batches
   */
  startBatchProcessing(intervalSeconds = 30) {
    if (this.batchProcessInterval) {
      logger.warn(
        'Batch processing already started, call stopBatchProcessing first'
      );
      return;
    }

    logger.info('Starting EWT batch processing', { intervalSeconds });

    this.batchProcessInterval = setInterval(
      () => this.processPendingRecalculations(),
      intervalSeconds * 1000
    );
  }

  /**
   * Stop background batch processing
   */
  stopBatchProcessing() {
    if (this.batchProcessInterval) {
      clearInterval(this.batchProcessInterval);
      this.batchProcessInterval = null;
      logger.info('EWT batch processing stopped');
    }
  }

  /**
   * Add department to pending recalculations
   * @param {string} departmentCode - Department code
   */
  queueDepartmentRecalculation(departmentCode) {
    this.pendingRecalculations.add(departmentCode);
  }

  /**
   * Get current recalculation queue size
   * @returns {number} Size of pending recalculations
   */
  getPendingCount() {
    return this.pendingRecalculations.size;
  }

  /**
   * Clear all pending recalculations
   */
  clearPending() {
    this.pendingRecalculations.clear();
    logger.info('Cleared pending EWT recalculations');
  }

  /**
   * Set debounce interval
   * @param {number} intervalMs - Interval in milliseconds
   */
  setDebounceInterval(intervalMs) {
    if (intervalMs < 100 || intervalMs > 10000) {
      throw new Error('Debounce interval must be between 100ms and 10000ms');
    }
    this.debounceIntervalMs = intervalMs;
    logger.info('EWT debounce interval set', { interval: intervalMs });
  }
}

module.exports = new EWTRecalculationService();
