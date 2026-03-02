// services/followupTokenGenerationService.js
const Patient = require('../models/Patient');
const Department = require('../models/Department');
const followupServiceMappingService = require('./followupServiceMappingService');
const followupEventLogger = require('../utils/followupEventLogger');
const logger = require('../utils/logger');
const { getNextTokenCounter } = require('./tokenCounter.service');
const { generateToken } = require('../utils/tokenGenerator');
const queueService = require('./queueService');
const staffStatusService = require('./staffStatusService');

/**
 * Followup Token Generation Service
 * Core DWE (Dynamic Workflow Engine) logic for creating follow-up tokens
 * Handles:
 * - Token generation with atomic counters
 * - Parent-child linking
 * - EWT calculation with priority consideration
 * - Queue assignment
 * - Transactional integrity
 */
class FollowupTokenGenerationService {
  /**
   * Generate multiple follow-up tokens atomically
   * Main DWE entry point from post-consultation trigger
   *
   * @param {string} parentTokenId - Token from completed consultation
   * @param {Array} requiredServices - Array of required followup services
   * @param {Object} patientData - Patient information
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} { successTokens: [], failedServices: [] }
   * @throws {Error} If transaction fails
   */
  async generateFollowupTokens(parentTokenId, requiredServices, patientData, options = {}) {
    const startTime = Date.now();
    const correlationId = followupEventLogger.generateCorrelationId();

    try {
      logger.info(`Starting follow-up token generation for parent: ${parentTokenId}`, {
        service_count: requiredServices.length,
        correlation_id: correlationId
      });

      followupEventLogger.logDWEProcessingStart({
        parent_token_id: parentTokenId,
        patient_id: patientData.patientId,
        services: requiredServices,
        correlation_id: correlationId
      });

      // Validate parent token exists
      const patient = await Patient.findOne({ patientId: patientData.patientId });
      if (!patient) {
        throw new Error(`Patient not found: ${patientData.patientId}`);
      }

      const parentToken = patient.multiStageTokens.find(t => t.token === parentTokenId);
      if (!parentToken) {
        throw new Error(`Parent token not found: ${parentTokenId}`);
      }

      const successTokens = [];
      const failedServices = [];

      // Process each required service
      for (const service of requiredServices) {
        try {
          const generatedToken = await this.createFollowupToken(
            parentTokenId,
            service,
            patientData,
            { correlationId, ...options }
          );

          successTokens.push(generatedToken);

          // Re-fetch patient to get latest state
          const updatedPatient = await Patient.findOne({ patientId: patientData.patientId });
          patient.multiStageTokens = updatedPatient.multiStageTokens;
        } catch (error) {
          logger.error(`Failed to create followup token for service: ${service.service_type}`, {
            error: error.message,
            parent_token: parentTokenId,
            patient_id: patientData.patientId,
            correlation_id: correlationId
          });

          failedServices.push({
            service_type: service.service_type,
            error: error.message,
            timestamp: new Date().toISOString()
          });

          followupEventLogger.logFollowupTokenCreationFailed(
            {
              parent_token_id: parentTokenId,
              patient_id: patientData.patientId,
              service_type: service.service_type,
              correlation_id: correlationId
            },
            error
          );
        }
      }

      // Log completion
      const processingTime = Date.now() - startTime;
      followupEventLogger.logDWEProcessingEnd({
        parent_token_id: parentTokenId,
        patient_id: patientData.patientId,
        created_tokens: successTokens.map(t => t.token),
        duration_ms: processingTime,
        status: failedServices.length === 0 ? 'success' : 'partial_success',
        correlation_id: correlationId
      });

      logger.info(`Follow-up token generation completed for parent: ${parentTokenId}`, {
        created: successTokens.length,
        failed: failedServices.length,
        processing_time_ms: processingTime,
        correlation_id: correlationId
      });

      return {
        successTokens,
        failedServices,
        processingTime,
        correlationId,
        status: failedServices.length === 0 ? 'success' : 'partial_success'
      };
    } catch (error) {
      logger.error('Failed to generate followup tokens', {
        parent_token: parentTokenId,
        patient_id: patientData.patientId,
        error: error.message,
        stack: error.stack,
        correlation_id: correlationId
      });

      followupEventLogger.logDWEError(
        {
          parent_token_id: parentTokenId,
          patient_id: patientData.patientId,
          correlation_id: correlationId
        },
        error
      );

      throw error;
    }
  }

  /**
   * Create a single follow-up token
   * Handles service mapping, token generation, EWT calculation, and linking
   *
   * @param {string} parentTokenId - Parent token ID
   * @param {Object} service - Service configuration
   * @param {Object} patientData - Patient information
   * @param {Object} options - Additional options (correlationId, etc.)
   * @returns {Promise<Object>} Generated token information
   */
  async createFollowupToken(parentTokenId, service, patientData, options = {}) {
    const correlationId = options.correlationId || followupEventLogger.generateCorrelationId();

    try {
      // Step 1: Map service type to department
      const mapping = await followupServiceMappingService.getMappingByServiceType(
        service.service_type
      );

      followupEventLogger.logServiceMappingLookup(service.service_type, !!mapping);

      const departmentCode = mapping.target_department;

      // Step 2: Validate department exists
      const department = await Department.findOne({ code: departmentCode });
      if (!department) {
        throw new Error(`Target department not found: ${departmentCode}`);
      }

      // Step 3: Generate unique token
      const counter = await getNextTokenCounter(departmentCode);
      const tokenStr = generateToken(departmentCode, counter);

      logger.debug(`Generated token: ${tokenStr}`, {
        parent_token: parentTokenId,
        department: departmentCode,
        correlation_id: correlationId
      });

      // Step 4: Calculate EWT for this follow-up
      const ewtData = await this.calculateFollowupEWT(
        departmentCode,
        service.priority || mapping.default_priority,
        {
          estimatedDuration: service.estimated_duration || mapping.estimated_duration,
          patientId: patientData.patientId
        }
      );

      // Step 5: Get queue position
      const queuePosition = await this.getQueuePosition(
        departmentCode,
        service.priority || mapping.default_priority
      );

      // Step 6: Create token in database via Patient model
      const patient = await Patient.findOne({ patientId: patientData.patientId });
      if (!patient) {
        throw new Error(`Patient not found: ${patientData.patientId}`);
      }

      // Issue the token using Patient model method
      patient.issueToken(
        departmentCode,
        tokenStr,
        1 // stage
      );

      // Step 7: Link to parent token
      patient.linkFollowupToken(tokenStr, parentTokenId, {
        service_type: service.service_type,
        priority: service.priority || mapping.default_priority,
        initial_ewt: ewtData.ewt_minutes
      });

      // Save patient to persist all changes atomically
      await patient.save();

      followupEventLogger.logParentChildLinking({
        parent_token_id: parentTokenId,
        followup_token_id: tokenStr,
        patient_id: patientData.patientId,
        service_type: service.service_type,
        correlation_id: correlationId
      });

      // Log token creation
      followupEventLogger.logFollowupTokenCreated({
        token: tokenStr,
        parent_token_id: parentTokenId,
        patient_id: patientData.patientId,
        service_type: service.service_type,
        department: departmentCode,
        priority: service.priority || mapping.default_priority,
        initial_ewt: ewtData.ewt_minutes,
        queue_position: queuePosition,
        correlation_id: correlationId
      });

      // Log queue assignment
      followupEventLogger.logQueueAssignment({
        token: tokenStr,
        department: departmentCode,
        service_type: service.service_type,
        priority: service.priority || mapping.default_priority,
        queue_position: queuePosition,
        ewt_minutes: ewtData.ewt_minutes,
        correlation_id: correlationId
      });

      logger.info(`Follow-up token created successfully: ${tokenStr}`, {
        parent_token: parentTokenId,
        department: departmentCode,
        service_type: service.service_type,
        ewt: ewtData.ewt_minutes,
        correlation_id: correlationId
      });

      return {
        token: tokenStr,
        parent_token_id: parentTokenId,
        department: departmentCode,
        service_type: service.service_type,
        priority: service.priority || mapping.default_priority,
        initial_ewt: ewtData.ewt_minutes,
        queue_position: queuePosition,
        created_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to create single followup token', {
        parent_token: parentTokenId,
        service_type: service.service_type,
        error: error.message,
        correlation_id: correlationId
      });

      throw error;
    }
  }

  /**
   * Calculate EWT for a follow-up token
   * Considers:
   * - Current queue state
   * - Service priority
   * - Available staff
   * - Estimated service duration
   *
   * @param {string} departmentCode - Target department
   * @param {string} priority - Service priority (high, normal, low)
   * @param {Object} serviceConfig - Service configuration
   * @returns {Promise<Object>} { ewt_minutes, factors: {} }
   */
  async calculateFollowupEWT(departmentCode, priority, serviceConfig = {}) {
    try {
      // Get base EWT from existing service
      const avgServiceTime = await queueService.calculateAverageServiceTime(departmentCode);

      // Get available staff
      const department = await Department.findOne({ code: departmentCode });
      let availableStaff = 1;
      if (department) {
        try {
          availableStaff = await staffStatusService.getAvailableStaffCount(department._id);
        } catch (err) {
          logger.warn('Failed to get available staff count', {
            department: departmentCode,
            error: err.message
          });
        }
      }

      // Get current queue count
      const patients = await Patient.find({
        'multiStageTokens.department': departmentCode,
        'multiStageTokens.status': { $in: ['pending', 'in-progress'] }
      })
        .select('multiStageTokens')
        .lean();

      let pendingCount = 0;
      for (const patient of patients) {
        for (const token of patient.multiStageTokens) {
          if (
            token.department === departmentCode &&
            token.status === 'pending'
          ) {
            pendingCount++;
          }
        }
      }

      // Priority multipliers
      const priorityMultipliers = {
        high: 0.5, // High priority shortens wait time
        normal: 1.0,
        low: 1.5 // Low priority increases wait time
      };

      const multiplier = priorityMultipliers[priority] || 1.0;

      // Calculate EWT with priority adjustment
      const baseEWT = pendingCount * avgServiceTime.averageServiceTime;
      const priorityAdjustedEWT = baseEWT * multiplier;

      // Adjust by staff availability
      const staffAdjustment = Math.max(availableStaff, 1);
      const adjustedEWT = priorityAdjustedEWT / staffAdjustment;

      // Add estimated service duration for this specific service
      const estimatedDuration = serviceConfig.estimatedDuration || avgServiceTime.averageServiceTime;
      const finalEWT = Math.ceil(adjustedEWT + (estimatedDuration / 3)); // Add 1/3 of service duration

      return {
        ewt_minutes: Math.max(finalEWT, 5), // Minimum 5 minutes
        factors: {
          base_ewt: Math.ceil(baseEWT),
          priority: priority,
          priority_multiplier: multiplier,
          available_staff: staffAdjustment,
          pending_tokens: pendingCount,
          average_service_time: avgServiceTime.averageServiceTime,
          estimated_service_duration: estimatedDuration,
          staff_adjustment_factor: staffAdjustment
        }
      };
    } catch (error) {
      logger.error('Failed to calculate followup EWT', {
        department: departmentCode,
        priority,
        error: error.message
      });

      // Return default EWT on error
      return {
        ewt_minutes: 15,
        factors: {
          error: error.message,
          default_fallback: true
        }
      };
    }
  }

  /**
   * Get queue position for a token in a department
   * Considers priority level
   *
   * @param {string} departmentCode - Department code
   * @param {string} priority - Priority level
   * @returns {Promise<number>} Queue position
   */
  async getQueuePosition(departmentCode, priority) {
    try {
      // Get all pending tokens in department
      const patients = await Patient.find({
        'multiStageTokens.department': departmentCode,
        'multiStageTokens.status': 'pending'
      })
        .select('multiStageTokens')
        .lean();

      let queueCount = 0;
      for (const patient of patients) {
        for (const token of patient.multiStageTokens) {
          if (
            token.department === departmentCode &&
            token.status === 'pending'
          ) {
            queueCount++;
          }
        }
      }

      // Position is current count + 1 (this token will be added)
      // Priority doesn't change position calculation, just affects EWT
      return queueCount + 1;
    } catch (error) {
      logger.error('Failed to get queue position', {
        department: departmentCode,
        error: error.message
      });

      // Return safe default
      return 1;
    }
  }

  /**
   * Process follow-ups triggered on service completion
   * Called by DWE when a consultation is completed
   *
   * @param {string} completedTokenId - Token that was just completed
   * @param {string} patientId - Patient ID
   * @param {Array} followupServices - Services required after completion
   * @returns {Promise<Object>} Follow-up processing results
   */
  async processServiceCompletionFollowups(completedTokenId, patientId, followupServices) {
    try {
      const correlationId = followupEventLogger.generateCorrelationId();

      logger.info('Processing automatic follow-ups on service completion', {
        completed_token: completedTokenId,
        patient_id: patientId,
        followup_count: followupServices?.length || 0,
        correlation_id: correlationId
      });

      if (!followupServices || followupServices.length === 0) {
        logger.debug('No follow-up services to process');
        return { created: [], failed: [] };
      }

      const patient = await Patient.findOne({ patientId });
      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      // Generate follow-ups
      const result = await this.generateFollowupTokens(
        completedTokenId,
        followupServices,
        { patientId },
        { correlationId }
      );

      followupEventLogger.logServiceCompletionWithFollowups({
        token: completedTokenId,
        patient_id: patientId,
        followup_services: followupServices,
        correlation_id: correlationId
      });

      return result;
    } catch (error) {
      logger.error('Failed to process service completion follow-ups', {
        completed_token: completedTokenId,
        patient_id: patientId,
        error: error.message
      });

      throw error;
    }
  }
}

// Export singleton instance
module.exports = new FollowupTokenGenerationService();
