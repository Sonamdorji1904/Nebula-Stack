// services/checkinService.js
const axios = require('axios');
const Patient = require('../models/Patient');
const logger = require('../utils/logger');

class CheckinService {
  constructor() {
    this.mockEpisUrl = process.env.MOCK_EPIS_URL || 'http://localhost:3000/api/mock-epis/checkin';
  }

  /**
   * Ingests patient data from Mock ePIS at check-in
   * @returns {Object} Created patient record
   */
  async ingestPatientData() {
    try {
      logger.info('Initiating patient check-in process');

      // Step 1: Call Mock ePIS endpoint
      logger.info(`Calling Mock ePIS endpoint: ${this.mockEpisUrl}`);
      const response = await axios.post(this.mockEpisUrl);

      if (!response.data.success) {
        throw new Error('Mock ePIS returned unsuccessful response');
      }

      const patientData = response.data.data;
      logger.info(`Received patient data for: ${patientData.firstName} ${patientData.lastName}`);

      // Step 2: Store patient data in MongoDB
      const patient = new Patient(patientData);
      await patient.save();

      logger.info(`Patient data stored successfully - Patient ID: ${patient.patientId}`);

      // Step 3: Log ingestion event
      logger.info('Patient data ingestion completed', {
        patientId: patient.patientId,
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

  /**
   * Retrieves patient by ID
   * @param {String} patientId 
   * @returns {Object} Patient record
   */
  async getPatientById(patientId) {
    try {
      const patient = await Patient.findOne({ patientId });
      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }
      return patient;
    } catch (err) {
      logger.error('Error retrieving patient', { patientId, error: err.message });
      throw err;
    }
  }
}

module.exports = new CheckinService();