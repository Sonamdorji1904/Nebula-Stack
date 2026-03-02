// services/postConsultationService.js
const Patient = require('../models/Patient');
const followupServiceMappingService = require('./followupServiceMappingService');
const followupTokenGenerationService = require('./followupTokenGenerationService');
const followupEventLogger = require('../utils/followupEventLogger');
const logger = require('../utils/logger');

/**
 * Post-Consultation Service
 * Handles incoming ePIS post-consultation triggers
 * Validates requests and orchestrates follow-up token generation
 */
class PostConsultationService {
  /**
   * Process incoming post-consultation trigger from ePIS
   * Main entry point for the workflow
   *
   * @param {Object} triggerData - Post-consultation trigger data
   * @returns {Promise<Object>} Trigger processing result
   */
  async processPostConsultationTrigger(triggerData) {
    const correlationId = followupEventLogger.generateCorrelationId();
    const startTime = Date.now();

    try {
      // Log incoming trigger
      followupEventLogger.logPostConsultationTrigger({
        patient_id: triggerData.patient_id,
        consultation_token_id: triggerData.consultation_token_id,
        required_next_services: triggerData.required_next_services,
        triggerId: correlationId,
        source: 'ePIS'
      });

      logger.info('Post-consultation trigger received', {
        patient_id: triggerData.patient_id,
        consultation_token: triggerData.consultation_token_id,
        services_count: triggerData.required_next_services?.length || 0,
        correlation_id: correlationId
      });

      // Step 1: Validate trigger data
      const validation = await this.validateTriggerData(triggerData);
      followupEventLogger.logTriggerValidation(triggerData, validation.isValid, validation.errors);

      if (!validation.isValid) {
        logger.warn('Trigger validation failed', {
          patient_id: triggerData.patient_id,
          errors: validation.errors,
          correlation_id: correlationId
        });

        return {
          success: false,
          status: 'validation_failed',
          errors: validation.errors,
          correlation_id: correlationId,
          timestamp: new Date().toISOString()
        };
      }

      // Step 2: Retrieve patient and validate consultation token
      const patient = await Patient.findOne({ patientId: triggerData.patient_id });
      if (!patient) {
        const error = `Patient not found: ${triggerData.patient_id}`;
        logger.error(error);
        throw new Error(error);
      }

      const consultationToken = patient.multiStageTokens.find(
        t => t.token === triggerData.consultation_token_id
      );
      if (!consultationToken) {
        const error = `Consultation token not found: ${triggerData.consultation_token_id}`;
        logger.error(error);
        throw new Error(error);
      }

      logger.debug('Retrieved patient and consultation token', {
        patient_id: triggerData.patient_id,
        consultation_token: triggerData.consultation_token_id,
        correlation_id: correlationId
      });

      // Step 3: Generate follow-up tokens via DWE
      const dweResult = await followupTokenGenerationService.generateFollowupTokens(
        triggerData.consultation_token_id,
        triggerData.required_next_services,
        { patientId: triggerData.patient_id },
        { correlationId }
      );

      logger.info('Follow-up tokens generated successfully', {
        patient_id: triggerData.patient_id,
        consultation_token: triggerData.consultation_token_id,
        created: dweResult.successTokens.length,
        failed: dweResult.failedServices.length,
        correlation_id: correlationId
      });

      // Step 4: Log trigger completion
      const processingTime = Date.now() - startTime;
      followupEventLogger.logTriggerProcessingComplete({
        consultation_token_id: triggerData.consultation_token_id,
        patient_id: triggerData.patient_id,
        created_count: dweResult.successTokens.length,
        failed_count: dweResult.failedServices.length,
        total_requested: triggerData.required_next_services.length,
        processing_time_ms: processingTime,
        status: dweResult.status,
        correlation_id: correlationId
      });

      // Step 5: Log partial failures if any
      if (dweResult.failedServices.length > 0) {
        followupEventLogger.logPartialFailure({
          consultation_token_id: triggerData.consultation_token_id,
          patient_id: triggerData.patient_id,
          successful_tokens: dweResult.successTokens.map(t => t.token),
          failed_services: dweResult.failedServices,
          correlation_id: correlationId
        });
      }

      // Build response
      const response = {
        success: true,
        status: dweResult.status,
        message:
          dweResult.status === 'success'
            ? 'Post-consultation trigger processed successfully'
            : 'Post-consultation trigger processed with partial failures',
        data: {
          trigger_id: correlationId,
          consultation_token: triggerData.consultation_token_id,
          patient_id: triggerData.patient_id,
          followup_tokens_created: dweResult.successTokens.length,
          followup_tokens_failed: dweResult.failedServices.length,
          followup_tokens: dweResult.successTokens.map(token => ({
            token_id: token.token,
            service_type: token.service_type,
            department: token.department,
            priority: token.priority,
            initial_ewt_minutes: token.initial_ewt,
            queue_position: token.queue_position,
            created_at: token.created_at
          })),
          failed_services: dweResult.failedServices,
          processing_time_ms: processingTime,
          timestamp: new Date().toISOString()
        },
        correlation_id: correlationId
      };

      logger.info('Post-consultation trigger processing completed', {
        patient_id: triggerData.patient_id,
        status: response.status,
        created: dweResult.successTokens.length,
        processing_time_ms: processingTime,
        correlation_id: correlationId
      });

      return response;
    } catch (error) {
      logger.error('Failed to process post-consultation trigger', {
        patient_id: triggerData.patient_id,
        consultation_token: triggerData.consultation_token_id,
        error: error.message,
        stack: error.stack,
        correlation_id: correlationId
      });

      followupEventLogger.logDWEError(
        {
          parent_token_id: triggerData.consultation_token_id,
          patient_id: triggerData.patient_id,
          correlation_id: correlationId
        },
        error
      );

      throw error;
    }
  }

  /**
   * Validate post-consultation trigger data structure
   *
   * @param {Object} data - Trigger data to validate
   * @returns {Promise<Object>} { isValid: boolean, errors: [] }
   */
  async validateTriggerData(data) {
    const errors = [];

    // Check required fields
    if (!data.patient_id || typeof data.patient_id !== 'string') {
      errors.push({
        field: 'patient_id',
        reason: 'patient_id is required and must be a string'
      });
    }

    if (!data.consultation_token_id || typeof data.consultation_token_id !== 'string') {
      errors.push({
        field: 'consultation_token_id',
        reason: 'consultation_token_id is required and must be a string'
      });
    }

    // Check required_next_services
    if (!Array.isArray(data.required_next_services)) {
      errors.push({
        field: 'required_next_services',
        reason: 'required_next_services must be an array'
      });
      return { isValid: false, errors };
    }

    if (data.required_next_services.length === 0) {
      errors.push({
        field: 'required_next_services',
        reason: 'required_next_services must contain at least one service'
      });
    }

    // Validate each service in the array
    for (let i = 0; i < data.required_next_services.length; i++) {
      const service = data.required_next_services[i];

      // Check service_type
      if (!service.service_type || typeof service.service_type !== 'string') {
        errors.push({
          field: `required_next_services[${i}].service_type`,
          reason: 'service_type is required and must be a string'
        });
        continue;
      }

      // Validate service type exists
      const isValidService = await followupServiceMappingService.validateServiceType(
        service.service_type
      );
      if (!isValidService) {
        errors.push({
          field: `required_next_services[${i}].service_type`,
          reason: `Unknown service type: "${service.service_type}"`
        });
      }

      // Validate priority if provided
      if (service.priority) {
        if (!['high', 'normal', 'low'].includes(service.priority)) {
          errors.push({
            field: `required_next_services[${i}].priority`,
            reason: 'Priority must be one of: high, normal, low'
          });
        }
      }

      // Validate estimated_duration if provided
      if (service.estimated_duration) {
        if (typeof service.estimated_duration !== 'number' || service.estimated_duration <= 0) {
          errors.push({
            field: `required_next_services[${i}].estimated_duration`,
            reason: 'estimated_duration must be a positive number'
          });
        }
      }

      // notes is optional, just validate if string
      if (service.notes && typeof service.notes !== 'string') {
        errors.push({
          field: `required_next_services[${i}].notes`,
          reason: 'notes must be a string'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get full patient journey - all tokens with their follow-ups
   *
   * @param {string} patientId - Patient ID
   * @returns {Promise<Object>} Journey information
   */
  async getPatientJourney(patientId) {
    try {
      const patient = await Patient.findOne({ patientId });

      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      const journey = patient.getPatientJourney();

      followupEventLogger.logJourneyTrace({
        patient_id: patientId,
        consultation_token: journey[0]?.token,
        followup_tokens: journey.flatMap(node => node.followups || []),
        status: 'retrieved',
        correlation_id: followupEventLogger.generateCorrelationId()
      });

      return {
        patient_id: patientId,
        journey,
        total_tokens: patient.multiStageTokens.length,
        total_followups: journey.reduce((sum, node) => sum + (node.followups?.length || 0), 0)
      };
    } catch (error) {
      logger.error('Failed to get patient journey', {
        patient_id: patientId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Retrieve follow-up tokens for a specific parent token
   *
   * @param {string} patientId - Patient ID
   * @param {string} parentTokenId - Parent token ID
   * @returns {Promise<Array>} Follow-up tokens
   */
  async getFollowupTokens(patientId, parentTokenId) {
    try {
      const patient = await Patient.findOne({ patientId });

      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      const followups = patient.getFollowupTokens(parentTokenId);

      logger.info('Retrieved follow-up tokens', {
        patient_id: patientId,
        parent_token: parentTokenId,
        followup_count: followups.length
      });

      return followups.map(token => ({
        token: token.token,
        department: token.department,
        status: token.status,
        service_type: token.followup_service_type,
        priority: token.followup_priority,
        initial_ewt: token.initial_ewt,
        created_at: token.followup_triggered_at,
        issued_at: token.issuedAt
      }));
    } catch (error) {
      logger.error('Failed to get follow-up tokens', {
        patient_id: patientId,
        parent_token: parentTokenId,
        error: error.message
      });

      throw error;
    }
  }
}

// Export singleton instance
module.exports = new PostConsultationService();
