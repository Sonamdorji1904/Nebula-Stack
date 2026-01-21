// controllers/checkinController.js
const checkinService = require('../services/checkinService');
const logger = require('../utils/logger');

/**
 * Handles patient registration and data ingestion
 */
exports.registerPatient = async (req, res) => {
  try {
    logger.info('Patient registration initiated');

    const metadata = {
      createdBy: req.body.createdBy || req.user?.username || 'system'
    };

    const patient = await checkinService.ingestPatientData(metadata);

    res.status(201).json({
      success: true,
      message: 'Patient registered successfully',
      data: {
        patientId: patient.patientId,
        firstName: patient.firstName,
        middleName: patient.middleName,
        lastName: patient.lastName,
        checkinTimestamp: patient.checkinTimestamp,
        status: patient.status,
        currentDepartment: patient.currentDepartment,
        activeTokens: patient.activeTokens.map(t => ({
          token: t.token,
          department: t.department
        })),
        tokens: patient.multiStageTokens.map(t => ({
          token: t.token,
          department: t.department,
          stage: t.stage,
          status: t.status,
          createdAt: t.createdAt
        }))
      }
    });

  } catch (err) {
    logger.error('Patient registration failed', { error: err.message });
    
    res.status(500).json({
      success: false,
      message: 'Failed to register patient',
      error: err.message
    });
  }
};

/**
 * Retrieves patient information by ID
 */
exports.getPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const patient = await checkinService.getPatientById(patientId);

    res.status(200).json({
      success: true,
      data: patient
    });

  } catch (err) {
    logger.error('Failed to retrieve patient', { error: err.message });
    
    res.status(404).json({
      success: false,
      message: 'Patient not found',
      error: err.message
    });
  }
};

/**
 * Get patient by token
 */
exports.getPatientByToken = async (req, res) => {
  try {
    const { token } = req.params;
    const patient = await checkinService.getPatientByToken(token);

    res.status(200).json({
      success: true,
      data: patient
    });

  } catch (err) {
    logger.error('Failed to retrieve patient by token', { error: err.message });
    
    res.status(404).json({
      success: false,
      message: 'Patient not found',
      error: err.message
    });
  }
};

/**
 * Update token status
 */
exports.updateTokenStatus = async (req, res) => {
  try {
    const { patientId, token } = req.params;
    const { status, department } = req.body;

    if (!status || !['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: pending, in-progress, completed, or cancelled'
      });
    }

    const patient = await checkinService.updateTokenStatus(patientId, token, department, status);

    res.status(200).json({
      success: true,
      message: 'Token status updated successfully',
      data: {
        patientId: patient.patientId,
        activeTokens: patient.activeTokens,
        lastStageCompletedAt: patient.lastStageCompletedAt
      }
    });

  } catch (err) {
    logger.error('Failed to update token status', { error: err.message });
    
    res.status(500).json({
      success: false,
      message: 'Failed to update token status',
      error: err.message
    });
  }
};

/**
 * Add new stage token
 */
exports.addStageToken = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { department, stage } = req.body;

    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department is required'
      });
    }

    const patient = await checkinService.addStageToken(patientId, { department, stage });

    // Find the newly added token
    const newToken = patient.multiStageTokens[patient.multiStageTokens.length - 1];

    res.status(201).json({
      success: true,
      message: 'Stage token added successfully',
      data: {
        patientId: patient.patientId,
        newToken: {
          token: newToken.token,
          department: newToken.department,
          stage: newToken.stage,
          status: newToken.status,
          createdAt: newToken.createdAt
        }
      }
    });

  } catch (err) {
    logger.error('Failed to add stage token', { error: err.message });
    
    res.status(500).json({
      success: false,
      message: 'Failed to add stage token',
      error: err.message
    });
  }
};

/**
 * Get patients by status
 */
exports.getPatientsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const patients = await checkinService.getPatientsByStatus(status);

    res.status(200).json({
      success: true,
      count: patients.length,
      data: patients
    });

  } catch (err) {
    logger.error('Failed to retrieve patients by status', { error: err.message });
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve patients',
      error: err.message
    });
  }
};