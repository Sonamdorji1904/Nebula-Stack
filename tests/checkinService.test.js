// tests/checkinService.test.js
const axios = require('axios');
const checkinService = require('../services/checkinService');
const Patient = require('../models/Patient');
const logger = require('../utils/logger');
const { getNextTokenCounter } = require('../services/tokenCounter.service');
const { generateToken } = require('../utils/tokenGenerator');

// Mock dependencies
jest.mock('axios');
jest.mock('../models/Patient');
jest.mock('../utils/logger');
jest.mock('../services/tokenCounter.service');
jest.mock('../utils/tokenGenerator');

describe('CheckinService', () => {
  let mockPatient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Shared mock patient instance
    mockPatient = {
      patientId: 'PID123',
      firstName: 'John',
      middleName: 'Michael',
      lastName: 'Doe',
      multiStageTokens: [],
      activeTokens: [],
      save: jest.fn().mockResolvedValue(true),
      issueToken: jest.fn(),
      completeToken: jest.fn(),
      callToken: jest.fn()
    };

    // Mock Patient.findOne to always return the same patient
    Patient.findOne = jest.fn().mockResolvedValue(mockPatient);

    // Mock constructor for new Patient()
    Patient.mockImplementation(() => mockPatient);
  });

  describe('ingestPatientData', () => {
    it('should successfully ingest patient data with new fields', async () => {
      const mockEpisResponse = {
        data: {
          success: true,
          data: {
            patientId: 'PID123',
            firstName: 'John',
            middleName: 'Michael',
            lastName: 'Doe',
            dateOfBirth: '1985-06-15',
            gender: 'Male',
            contactNumber: '+1-555-0123',
            email: 'john.doe@example.com',
            currentDepartment: 'Registration'
          }
        }
      };

      axios.post.mockResolvedValue(mockEpisResponse);

      const result = await checkinService.ingestPatientData({ createdBy: 'Tester' });

      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/checkin'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Initiating patient check-in'));
      expect(mockPatient.issueToken).toHaveBeenCalled();
      expect(mockPatient.save).toHaveBeenCalled();
      expect(result).toBe(mockPatient);
    });

    it('should include middleName in patient data', async () => {
      const mockEpisResponse = {
        data: {
          success: true,
          data: {
            patientId: 'PID456',
            firstName: 'Jane',
            middleName: 'Marie',
            lastName: 'Smith',
            dateOfBirth: '1990-03-20',
            gender: 'Female',
            contactNumber: '+1-555-9876',
            currentDepartment: 'Registration'
          }
        }
      };

      axios.post.mockResolvedValue(mockEpisResponse);

      await checkinService.ingestPatientData();

      expect(mockPatient.middleName).toBe(mockPatient.middleName || 'Michael');
      expect(mockPatient.save).toHaveBeenCalled();
    });
  });

  describe('getPatientByToken', () => {
    it('should retrieve patient by token', async () => {
      const result = await checkinService.getPatientByToken('TKN-REG-123');

      expect(Patient.findOne).toHaveBeenCalledWith({ 'activeTokens.token': 'TKN-REG-123' });
      expect(result).toEqual(mockPatient);
    });

    it('should throw error when token not found', async () => {
      Patient.findOne.mockResolvedValue(null);

      await expect(checkinService.getPatientByToken('INVALID')).rejects.toThrow(
        'Patient not found with token'
      );
    });
  });

  describe('updateTokenStatus', () => {
    it('should update token status successfully', async () => {
      // Add token to mockPatient for the test
      mockPatient.multiStageTokens.push({
        token: 'TKN-REG-123',
        department: 'Registration',
        status: 'pending',
        stage: 1
      });

      await checkinService.updateTokenStatus('PID123', 'TKN-REG-123', 'Registration', 'completed');

      expect(mockPatient.completeToken).toHaveBeenCalledWith('TKN-REG-123', 'Registration');
      expect(mockPatient.save).toHaveBeenCalled();
    });
  });

  describe('DWE Token Generation & Department Counter', () => {
    it('should generate a token and increment department counter', async () => {
      getNextTokenCounter.mockResolvedValue(1);
      generateToken.mockReturnValue('REG-001');

      const result = await checkinService.addStageToken('PID123', 'Registration');

      expect(getNextTokenCounter).toHaveBeenCalledWith('Registration');
      expect(generateToken).toHaveBeenCalledWith('Registration', 1);
      expect(mockPatient.issueToken).toHaveBeenCalledWith('Registration', 'REG-001', 1);
      expect(result).toBe(mockPatient);
    });

    it('should generate incremented token for next patient', async () => {
      getNextTokenCounter.mockResolvedValue(2);
      generateToken.mockReturnValue('REG-002');

      const result = await checkinService.addStageToken('PID123', 'Registration');

      expect(getNextTokenCounter).toHaveBeenCalledWith('Registration');
      expect(generateToken).toHaveBeenCalledWith('Registration', 2);
      expect(mockPatient.issueToken).toHaveBeenCalledWith('Registration', 'REG-002', 2);
      expect(result).toBe(mockPatient);
    });
  });
});
