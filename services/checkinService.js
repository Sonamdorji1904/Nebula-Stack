// services/checkinService.js
const axios = require('axios');
const Patient = require('../models/Patient');
const logger = require('../utils/logger');

// Import DWE token service
const { issueCheckinToken } = require('./checkinToken.service');
const { getNextTokenCounter } = require('./tokenCounter.service');
const { generateToken } = require('../utils/tokenGenerator');

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

      // NEW STEP 4: Generate initial DWE token using department counter
      const department = patientData.currentDepartment || 'Registration';
      try {
        const counter = await getNextTokenCounter(department);
        const tokenStr = generateToken(department, counter);
        if (typeof patient.issueToken === 'function') {
          patient.issueToken(department, tokenStr, counter);
        }
      } catch (err) {
        logger.warn('Failed to generate initial token', { error: err.message });
      }

      // Step 5: Save patient (activeTokens auto-syncs)
      await patient.save();

      logger.info(`Patient data stored successfully - Patient ID: ${patient.patientId}`);
      logger.info(`Initial token generated: ${patient.activeTokens[0]?.token}`);

      // Step 6: Log ingestion event
      logger.info('Patient data ingestion completed', {
        patientId: patient.patientId,
        activeTokens: patient.activeTokens.length,
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
  async updateTokenStatus(patientId, token, department, newStatus) {
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

      // If completed, notify patient instance helper
      if (newStatus === 'completed' && typeof patient.completeToken === 'function') {
        try {
          patient.completeToken(token, department);
        } catch (err) {
          logger.warn('completeToken handler failed', { error: err.message });
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
   * @param {Object|String} tokenDataOrDepartment - tokenData object or department string
   * @returns {Object} Updated patient
   */
  async addStageToken(patientId, tokenDataOrDepartment) {
    try {
      const patient = await Patient.findOne({ patientId });
      
      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      // Accept either a department string or a tokenData object
      let department;
      let stage = 1;
      const tokenData = tokenDataOrDepartment;
      if (typeof tokenDataOrDepartment === 'string') {
        department = tokenDataOrDepartment;
      } else if (tokenDataOrDepartment && typeof tokenDataOrDepartment === 'object') {
        department = tokenDataOrDepartment.department;
        stage = tokenDataOrDepartment.stage || 1;
      }

      if (!department || typeof department !== 'string') {
        throw new Error('Stage and department are required');
      }

      // If there is already a non-completed token for this department, skip creating a new one
      const existing = patient.multiStageTokens.find(t => t.department === department && t.status !== 'completed');
      if (existing) {
        logger.info('Existing non-completed token for department found; skipping new token', { patientId, department });
        return patient;
      }

      // Use department counter + token generator to create a token
      const counter = await getNextTokenCounter(department);
      const tokenStr = generateToken(department, counter);

      const newToken = {
        token: tokenStr,
        stage: 1,
        department,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      // Let patient helper manage issuance if available
      if (typeof patient.issueToken === 'function') {
        try {
          patient.issueToken(department, tokenStr, counter);
        } catch (err) {
          logger.warn('patient.issueToken failed', { error: err.message });
        }
      }

      // Only push token if patient instance didn't already add it (avoid duplicates)
      const alreadyHasToken = patient.multiStageTokens.some(t => t.token === tokenStr || t.department === department);
      if (!alreadyHasToken) {
        patient.multiStageTokens.push(newToken);
        patient.activeTokens.push(newToken);
      }

      patient.updatedBy = 'system';

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

  /**
   * Calculate EWT for a department dynamically
   * EWT = avgServiceTime * pendingTokens + buffer
   */
  async calculateEWT(department) {
    try {
      // Historical avg service time (calculated from last month's completed tokens)
      const completedTokens = await Patient.aggregate([
        { $unwind: '$multiStageTokens' },
        { $match: { 'multiStageTokens.department': department, 'multiStageTokens.status': 'completed' } },
        { $project: { durationMinutes: { $divide: [ { $subtract: ['$multiStageTokens.completedAt', '$multiStageTokens.createdAt'] }, 1000 * 60 ] } } },
        { $group: { _id: null, avgServiceTime: { $avg: '$durationMinutes' } } }
      ]);

      const avgServiceTime = completedTokens[0]?.avgServiceTime || 5; // default 5 mins

      // Count pending tokens
      const pendingCount = await Patient.countDocuments({
        'multiStageTokens': { $elemMatch: { department, status: 'pending' } }
      });

      // Buffer for staff availability/delays
      const staffBuffer = 2; // minutes (example, can be dynamic)

      const ewt = Math.round(avgServiceTime * pendingCount + staffBuffer);

      return ewt;

    } catch (err) {
      logger.error('Failed to calculate EWT', { department, error: err.message });
      return 5; // fallback
    }
  }

  /**
   * Get queue for a department with EWT per patient
   */
  async getQueueWithEWT(department) {
    const patients = await Patient.find({
      'multiStageTokens': { $elemMatch: { department, status: 'pending' } }
    }).sort({ 'multiStageTokens.createdAt': 1 });

    let cumulativeTime = 0;
    const queue = [];
    for (const patient of patients) {
      const token = patient.multiStageTokens.find(t => t.department === department && t.status === 'pending');
      const avgServiceTime = await this.calculateEWT(department); // reuse calculation
      cumulativeTime += avgServiceTime;
      queue.push({
        patientId: patient.patientId,
        token: token.token,
        ewtMinutes: cumulativeTime
      });
    }

    return queue;
  }
}

module.exports = new CheckinService();
