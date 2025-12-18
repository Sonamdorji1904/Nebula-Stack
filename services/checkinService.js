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
   * @param {Object} metadata - Additional metadata (optional)
   * @returns {Object} Created patient record
   */
  async ingestPatientData(metadata = {}) {
    try {
      logger.info('Initiating patient check-in process');

      // Step 1: Call Mock ePIS endpoint
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

      // Step 3: Store patient data in MongoDB
      const patient = new Patient(patientData);
      const savedPatient = await patient.save();

      logger.info(`Patient data stored successfully - Patient ID: ${savedPatient.patientId}`);
      logger.info(`Initial token generated: ${savedPatient.activeTokens[0]?.token}`);

      // Step 4: Log ingestion event
      logger.info('Patient data ingestion completed', {
        patientId: savedPatient.patientId,
        activeTokens: savedPatient.activeTokens.length,
        timestamp: new Date().toISOString()
      });

      return savedPatient;

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
      const patient = await Patient.findOne({ patientId })
        .populate('assignedDoctorId'); // Populate doctor info if available
      
      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }
      return patient;
    } catch (err) {
      logger.error('Error retrieving patient', { patientId, error: err.message });
      throw err;
    }
  }

  /**
   * Get patient by token
   * @param {String} token 
   * @returns {Object} Patient record
   */
  async getPatientByToken(token) {
    try {
      const patient = await Patient.findOne({ 
        'activeTokens.token': token 
      });
      
      if (!patient) {
        throw new Error(`Patient not found with token: ${token}`);
      }
      
      logger.info(`Patient found by token: ${token}`, { patientId: patient.patientId });
      return patient;
    } catch (err) {
      logger.error('Error retrieving patient by token', { token, error: err.message });
      throw err;
    }
  }

  /**
   * Update token status
   * @param {String} patientId 
   * @param {String} token 
   * @param {String} newStatus 
   * @returns {Object} Updated patient
   */
  async updateTokenStatus(patientId, token, newStatus) {
    try {
      const patient = await Patient.findOne({ patientId });
      
      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      // Update in multiStageTokens
      const multiStageToken = patient.multiStageTokens.find(t => t.token === token);
      if (multiStageToken) {
        multiStageToken.status = newStatus;
        if (newStatus === 'completed') {
          multiStageToken.completedAt = new Date();
          patient.lastStageCompletedAt = new Date();
        }
      }

      // Update in activeTokens
      const activeToken = patient.activeTokens.find(t => t.token === token);
      if (activeToken) {
        activeToken.status = newStatus;
        
        // Remove from active if completed or cancelled
        if (newStatus === 'completed' || newStatus === 'cancelled') {
          patient.activeTokens = patient.activeTokens.filter(t => t.token !== token);
        }
      }

      patient.updatedBy = 'system'; // Or pass actual user
      await patient.save();

      logger.info(`Token status updated`, { 
        patientId, 
        token, 
        newStatus,
        activeTokensCount: patient.activeTokens.length 
      });

      return patient;
    } catch (err) {
      logger.error('Error updating token status', { 
        patientId, 
        token, 
        error: err.message 
      });
      throw err;
    }
  }

  /**
   * Add new stage token
   * @param {String} patientId 
   * @param {Object} tokenData 
   * @returns {Object} Updated patient
   */
  async addStageToken(patientId, tokenData) {
    try {
      const patient = await Patient.findOne({ patientId });
      
      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      const newToken = {
        token: tokenData.token || `TKN-${tokenData.department}-${Date.now()}`,
        stage: tokenData.stage,
        department: tokenData.department,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: tokenData.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      patient.multiStageTokens.push(newToken);
      patient.activeTokens.push(newToken);
      patient.updatedBy = tokenData.createdBy || 'system';
      
      await patient.save();

      logger.info(`New stage token added`, { 
        patientId, 
        token: newToken.token,
        stage: newToken.stage,
        department: newToken.department
      });

      return patient;
    } catch (err) {
      logger.error('Error adding stage token', { patientId, error: err.message });
      throw err;
    }
  }

  /**
   * Get all patients by status
   * @param {String} status 
   * @returns {Array} List of patients
   */
  async getPatientsByStatus(status) {
    try {
      const patients = await Patient.find({ status })
        .sort({ checkinTimestamp: -1 });
      
      logger.info(`Retrieved ${patients.length} patients with status: ${status}`);
      return patients;
    } catch (err) {
      logger.error('Error retrieving patients by status', { status, error: err.message });
      throw err;
    }
  }
}

module.exports = new CheckinService();