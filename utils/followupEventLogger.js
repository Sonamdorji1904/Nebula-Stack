// utils/followupEventLogger.js
const logger = require('./logger');

/**
 * Followup Event Logger
 * Centralized logging for all DWE follow-up token events
 * Provides traceability across the entire followup lifecycle
 */
class FollowupEventLogger {
  /**
   * Log incoming post-consultation trigger
   */
  logPostConsultationTrigger(data) {
    logger.info('POST_CONSULTATION_TRIGGER_RECEIVED', {
      event: 'POST_CONSULTATION_TRIGGER_RECEIVED',
      patient_id: data.patient_id,
      consultation_token: data.consultation_token_id,
      services_count: data.required_next_services?.length || 0,
      service_types: data.required_next_services?.map(s => s.service_type) || [],
      timestamp: new Date().toISOString(),
      triggerId: data.triggerId,
      source: data.source || 'ePIS'
    });
  }

  /**
   * Log trigger validation
   */
  logTriggerValidation(data, isValid, errors = []) {
    if (isValid) {
      logger.debug('TRIGGER_VALIDATION_PASSED', {
        event: 'TRIGGER_VALIDATION_PASSED',
        patient_id: data.patient_id,
        consultation_token: data.consultation_token_id,
        timestamp: new Date().toISOString()
      });
    } else {
      logger.warn('TRIGGER_VALIDATION_FAILED', {
        event: 'TRIGGER_VALIDATION_FAILED',
        patient_id: data.patient_id,
        consultation_token: data.consultation_token_id,
        errors,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Log follow-up token creation - SUCCESS
   */
  logFollowupTokenCreated(data) {
    logger.info('FOLLOWUP_TOKEN_CREATED', {
      event: 'FOLLOWUP_TOKEN_CREATED',
      followup_token: data.token,
      parent_token: data.parent_token_id,
      patient_id: data.patient_id,
      service_type: data.service_type,
      department: data.department,
      priority: data.priority,
      initial_ewt_minutes: data.initial_ewt,
      queue_position: data.queue_position,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log follow-up token creation - FAILURE
   */
  logFollowupTokenCreationFailed(data, error) {
    logger.error('FOLLOWUP_TOKEN_CREATION_FAILED', {
      event: 'FOLLOWUP_TOKEN_CREATION_FAILED',
      parent_token: data.parent_token_id,
      patient_id: data.patient_id,
      service_type: data.service_type,
      error_message: error.message,
      error_code: error.code,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log parent-child token linking
   */
  logParentChildLinking(data) {
    logger.info('TOKEN_LINKING_CREATED', {
      event: 'TOKEN_LINKING_CREATED',
      parent_token: data.parent_token_id,
      followup_token: data.followup_token_id,
      patient_id: data.patient_id,
      relationship_type: 'parent-child',
      service_type: data.service_type,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log token linking failure
   */
  logTokenLinkingFailed(data, error) {
    logger.error('TOKEN_LINKING_FAILED', {
      event: 'TOKEN_LINKING_FAILED',
      parent_token: data.parent_token_id,
      followup_token: data.followup_token_id,
      error_message: error.message,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log service mapping lookup
   */
  logServiceMappingLookup(serviceType, found = true) {
    const level = found ? 'debug' : 'warn';
    logger[level]('SERVICE_MAPPING_LOOKUP', {
      event: 'SERVICE_MAPPING_LOOKUP',
      service_type: serviceType,
      found,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log EWT calculation for follow-up token
   */
  logEWTCalculation(data) {
    logger.debug('EWT_CALCULATION', {
      event: 'EWT_CALCULATION',
      followup_token: data.token,
      department: data.department,
      priority: data.priority,
      calculated_ewt_minutes: data.ewt_minutes,
      queue_position: data.queue_position,
      calculation_factors: data.factors,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log queue assignment for follow-up token
   */
  logQueueAssignment(data) {
    logger.info('QUEUE_ASSIGNMENT', {
      event: 'QUEUE_ASSIGNMENT',
      followup_token: data.token,
      department: data.department,
      service_type: data.service_type,
      priority: data.priority,
      queue_position: data.queue_position,
      ewt_minutes: data.ewt_minutes,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log post-consultation trigger completion (all follow-ups processed)
   */
  logTriggerProcessingComplete(data) {
    logger.info('TRIGGER_PROCESSING_COMPLETE', {
      event: 'TRIGGER_PROCESSING_COMPLETE',
      consultation_token: data.consultation_token_id,
      patient_id: data.patient_id,
      followup_tokens_created: data.created_count,
      followup_tokens_failed: data.failed_count,
      total_requested: data.total_requested,
      processing_time_ms: data.processing_time_ms,
      status: data.status,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log partial failure scenario
   */
  logPartialFailure(data) {
    logger.warn('TRIGGER_PARTIAL_FAILURE', {
      event: 'TRIGGER_PARTIAL_FAILURE',
      consultation_token: data.consultation_token_id,
      patient_id: data.patient_id,
      succeeded: data.successful_tokens || [],
      failed: data.failed_services || [],
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log full journey trace - for debugging/auditing
   */
  logJourneyTrace(data) {
    logger.info('PATIENT_JOURNEY_TRACE', {
      event: 'PATIENT_JOURNEY_TRACE',
      patient_id: data.patient_id,
      consultation_token: data.consultation_token_id,
      followup_count: data.followup_tokens?.length || 0,
      followup_tokens: data.followup_tokens || [],
      journey_status: data.status,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log service completion that triggers follow-ups
   */
  logServiceCompletionWithFollowups(data) {
    logger.info('SERVICE_COMPLETION_TRIGGERED_FOLLOWUPS', {
      event: 'SERVICE_COMPLETION_TRIGGERED_FOLLOWUPS',
      parent_token: data.token,
      department: data.department,
      patient_id: data.patient_id,
      followup_services: data.followup_services || [],
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log DWE processing start
   */
  logDWEProcessingStart(data) {
    logger.info('DWE_PROCESSING_START', {
      event: 'DWE_PROCESSING_START',
      parent_token: data.parent_token_id,
      patient_id: data.patient_id,
      services_to_process: data.services?.length || 0,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log DWE processing end
   */
  logDWEProcessingEnd(data) {
    logger.info('DWE_PROCESSING_END', {
      event: 'DWE_PROCESSING_END',
      parent_token: data.parent_token_id,
      patient_id: data.patient_id,
      tokens_created: data.created_tokens || [],
      processing_duration_ms: data.duration_ms,
      status: data.status,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Log any DWE error
   */
  logDWEError(data, error) {
    logger.error('DWE_ERROR', {
      event: 'DWE_ERROR',
      parent_token: data.parent_token_id,
      patient_id: data.patient_id,
      error_message: error.message,
      error_stack: error.stack,
      error_code: error.code,
      timestamp: new Date().toISOString(),
      correlation_id: data.correlation_id
    });
  }

  /**
   * Generate and return a correlation ID for tracking
   */
  generateCorrelationId() {
    return `FOLLOWUP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
  }

  /**
   * Log metrics snapshot for monitoring
   */
  logMetricsSnapshot(data) {
    logger.info('FOLLOWUP_METRICS_SNAPSHOT', {
      event: 'FOLLOWUP_METRICS_SNAPSHOT',
      metric_type: data.metric_type,
      total_triggers_received: data.total_triggers_received,
      total_tokens_created: data.total_tokens_created,
      success_rate: data.success_rate,
      average_processing_time_ms: data.average_processing_time_ms,
      timestamp: new Date().toISOString()
    });
  }
}

// Export singleton instance
module.exports = new FollowupEventLogger();
