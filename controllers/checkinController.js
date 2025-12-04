// controllers/checkinController.js
const checkinService = require('../services/checkinService');
const logger = require('../utils/logger');

/**
 * Handles patient registration and data ingestion
 */
exports.registerPatient = async (req, res) => {
  try {
    logger.info('Patient registration initiated');

    // Ingest patient data from Mock ePIS
    const patient = await checkinService.ingestPatientData();

    res.status(201).json({
      success: true,
      message: 'Patient registered successfully',
      data: {
        patientId: patient.patientId,
        firstName: patient.firstName,
        lastName: patient.lastName,
        checkinTimestamp: patient.checkinTimestamp,
        status: patient.status
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