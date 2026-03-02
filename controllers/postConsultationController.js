// controllers/postConsultationController.js
const postConsultationService = require('../services/postConsultationService');
const logger = require('../utils/logger');
const securityLogger = require('../utils/securityLogger');

/**
 * Post-Consultation Controller
 * Handles HTTP endpoints for post-consultation triggers
 */

/**
 * POST /api/mock-epis/post-consultation-trigger
 * Receive post-consultation trigger from ePIS system
 */
exports.postConsultationTrigger = async (req, res) => {
  try {
    const { patient_id, consultation_token_id, required_next_services } = req.body;

    logger.info('Post-consultation trigger request received', {
      patient_id,
      consultation_token: consultation_token_id,
      services_count: required_next_services?.length || 0,
      source: 'ePIS'
    });

    // Validate required fields
    if (!patient_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: patient_id',
        errors: [{ field: 'patient_id', reason: 'patient_id is required' }]
      });
    }

    if (!consultation_token_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: consultation_token_id',
        errors: [{ field: 'consultation_token_id', reason: 'consultation_token_id is required' }]
      });
    }

    if (!required_next_services) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: required_next_services',
        errors: [
          { field: 'required_next_services', reason: 'required_next_services is required' }
        ]
      });
    }

    // Process the trigger
    const result = await postConsultationService.processPostConsultationTrigger({
      patient_id,
      consultation_token_id,
      required_next_services
    });

    // Return appropriate status code based on result
    const statusCode =
      result.status === 'validation_failed' ? 400 : result.success ? 201 : 500;

    res.status(statusCode).json(result);
  } catch (error) {
    logger.error('Failed to process post-consultation trigger', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to process post-consultation trigger',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * POST /api/tokens/generate-followup
 * Manually generate a follow-up token (not typically called from ePIS)
 */
exports.generateFollowupToken = async (req, res) => {
  try {
    const { parent_token_id, service_type, priority, patient_id } = req.body;

    logger.info('Manual follow-up token generation request', {
      parent_token: parent_token_id,
      service_type,
      patient_id,
      user: req.user?.staffId
    });

    // Validate required fields
    if (!parent_token_id || !service_type || !patient_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: parent_token_id, service_type, patient_id',
        errors: [
          parent_token_id
            ? null
            : { field: 'parent_token_id', reason: 'Required' },
          service_type || null
            ? null
            : { field: 'service_type', reason: 'Required' },
          patient_id || null
            ? null
            : { field: 'patient_id', reason: 'Required' }
        ].filter(e => e !== null)
      });
    }

    // Generate the follow-up token
    const followupTokenGenerationService = require('../services/followupTokenGenerationService');

    const token = await followupTokenGenerationService.createFollowupToken(
      parent_token_id,
      {
        service_type,
        priority: priority || 'normal'
      },
      { patientId: patient_id }
    );

    res.status(201).json({
      success: true,
      message: 'Follow-up token generated successfully',
      data: {
        new_token_id: token.token,
        parent_token_id: token.parent_token_id,
        service_type: token.service_type,
        department: token.department,
        priority: token.priority,
        initial_ewt_minutes: token.initial_ewt,
        queue_position: token.queue_position,
        created_at: token.created_at
      }
    });
  } catch (error) {
    logger.error('Failed to generate follow-up token', {
      error: error.message,
      stack: error.stack,
      user: req.user?.staffId
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to generate follow-up token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/tokens/:tokenId/journey
 * Get full patient journey showing token hierarchy
 */
exports.getTokenJourney = async (req, res) => {
  try {
    const { tokenId } = req.params;

    logger.info('Token journey request', {
      token_id: tokenId,
      user: req.user?.staffId
    });

    // Find patient containing this token
    const Patient = require('../models/Patient');
    const patient = await Patient.findOne({
      'multiStageTokens.token': tokenId
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: `Token not found: ${tokenId}`
      });
    }

    // Get full journey
    const journey = await postConsultationService.getPatientJourney(patient.patientId);

    res.status(200).json({
      success: true,
      data: journey
    });
  } catch (error) {
    logger.error('Failed to get token journey', {
      error: error.message,
      stack: error.stack,
      user: req.user?.staffId
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get token journey',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/patients/:patientId/journey
 * Get full patient journey by patient ID
 */
exports.getPatientJourney = async (req, res) => {
  try {
    const { patientId } = req.params;

    logger.info('Patient journey request', {
      patient_id: patientId,
      user: req.user?.staffId
    });

    const journey = await postConsultationService.getPatientJourney(patientId);

    res.status(200).json({
      success: true,
      data: journey
    });
  } catch (error) {
    logger.error('Failed to get patient journey', {
      error: error.message,
      patient_id: req.params.patientId,
      user: req.user?.staffId
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to get patient journey',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/tokens/:parentTokenId/followups
 * Get all follow-up tokens for a specific parent token
 */
exports.getFollowupTokens = async (req, res) => {
  try {
    const { parentTokenId } = req.params;

    logger.info('Get follow-up tokens request', {
      parent_token: parentTokenId,
      user: req.user?.staffId
    });

    // Find patient containing parent token
    const Patient = require('../models/Patient');
    const patient = await Patient.findOne({
      'multiStageTokens.token': parentTokenId
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: `Parent token not found: ${parentTokenId}`
      });
    }

    // Get follow-up tokens
    const followups = await postConsultationService.getFollowupTokens(
      patient.patientId,
      parentTokenId
    );

    res.status(200).json({
      success: true,
      data: {
        parent_token_id: parentTokenId,
        followup_tokens: followups,
        count: followups.length
      }
    });
  } catch (error) {
    logger.error('Failed to get follow-up tokens', {
      error: error.message,
      parent_token: req.params.parentTokenId,
      user: req.user?.staffId
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to get follow-up tokens',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
