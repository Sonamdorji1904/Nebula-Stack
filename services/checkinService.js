// services/checkinService.js
const axios = require('axios');
const Patient = require('../models/Patient');
const logger = require('../utils/logger');
const { getNextTokenCounter } = require('./tokenCounter.service');
const { generateToken } = require('../utils/tokenGenerator');

class CheckinService {
  constructor() {
    this.mockEpisUrl = process.env.MOCK_EPIS_URL || 'http://localhost:3000/api/mock-epis/checkin';
  }

  /**
   * Ingests patient data from Mock ePIS at check-in
   */
  async ingestPatientData(metadata = {}) {
    try {
      logger.info('Initiating patient check-in process');

      // Step 1: Call Mock ePIS endpoint for patient demographics
      logger.info(`Calling Mock ePIS endpoint: ${this.mockEpisUrl}`);
      const response = await axios.post(this.mockEpisUrl);

      if (!response.data.success) {
        throw new Error('Mock ePIS returned unsuccessful response');
      }

      const patientData = response.data.data;
      logger.info(`Received patient data for: ${patientData.firstName} ${patientData.middleName || ''} ${patientData.lastName}`);

      // Step 2: Enhance patient data with metadata
      if (metadata.createdBy) {
        patientData.createdBy = metadata.createdBy;
      }

      // Step 3: Create patient instance (NO tokens yet)
      const patient = new Patient(patientData);

      // Step 4: Generate DWE token for initial department
      const department = patientData.currentDepartment || 'Registration';
      const counter = await getNextTokenCounter(department);
      const tokenStr = generateToken(department, counter);
      
      // Issue token using patient method (adds to multiStageTokens)
      patient.issueToken(department, tokenStr, 1);
      
      logger.info(`Generated token: ${tokenStr} for ${department}`);

      // Step 5: Save patient (activeTokens auto-syncs via pre-save hook)
      await patient.save();

      logger.info(`Patient data stored successfully - Patient ID: ${patient.patientId}`);
      logger.info(`Token: ${patient.activeTokens[0]?.token}`);

      // Step 6: Log ingestion event
      logger.info('Patient data ingestion completed', {
        patientId: patient.patientId,
        tokenCount: patient.activeTokens.length,
        timestamp: new Date().toISOString()
      });

      return patient;

    } catch (err) {
      logger.error('Error during patient data ingestion', {
        error: err.message,
        stack: err.stack
      });
      throw err;
    }
  }

  // ... rest of your methods stay the same
}

module.exports = new CheckinService(); 