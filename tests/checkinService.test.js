// tests/checkinService.test.js
const axios = require('axios');
const checkinService = require('../services/checkinService');
const Patient = require('../models/Patient');
const logger = require('../utils/logger');

// Mock dependencies
jest.mock('axios');
jest.mock('../models/Patient');
jest.mock('../utils/logger');

describe('CheckinService', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ingestPatientData', () => {
    
    it('should successfully ingest patient data with new fields', async () => {
      // Arrange
      const mockEpisResponse = {
        data: {
          success: true,
          data: {
            patientId: 'PID123456',
            firstName: 'John',
            middleName: 'Michael',
            lastName: 'Doe',
            dateOfBirth: '1985-06-15',
            gender: 'Male',
            contactNumber: '+1-555-0123',
            email: 'john.doe@example.com',
            multiStageTokens: [
              {
                token: 'TKN-REG-123',
                stage: 1,
                department: 'Registration',
                status: 'pending'
              }
            ],
            activeTokens: [
              {
                token: 'TKN-REG-123',
                stage: 1,
                department: 'Registration',
                status: 'pending'
              }
            ],
            createdBy: 'ePIS-System'
          }
        }
      };

      const mockSavedPatient = {
        ...mockEpisResponse.data.data,
        _id: 'mongo_id_123',
        checkinTimestamp: new Date(),
        status: 'checked-in'
      };

      axios.post.mockResolvedValue(mockEpisResponse);
      Patient.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(mockSavedPatient)
      }));

      // Act
      const result = await checkinService.ingestPatientData();

      // Assert
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/checkin'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Initiating patient check-in'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Patient data stored successfully'));
      expect(result).toBeDefined();
    });

    it('should include middleName in patient data', async () => {
      const mockEpisResponse = {
        data: {
          success: true,
          data: {
            patientId: 'PID789',
            firstName: 'Jane',
            middleName: 'Marie',
            lastName: 'Smith',
            dateOfBirth: '1990-03-20',
            gender: 'Female',
            contactNumber: '+1-555-9876',
            multiStageTokens: [],
            activeTokens: []
          }
        }
      };

      const saveMock = jest.fn().mockResolvedValue(mockEpisResponse.data.data);
      axios.post.mockResolvedValue(mockEpisResponse);
      Patient.mockImplementation(() => ({
        save: saveMock
      }));

      // Act
      await checkinService.ingestPatientData();

      // Assert
      expect(Patient).toHaveBeenCalledWith(expect.objectContaining({
        middleName: 'Marie'
      }));
      expect(saveMock).toHaveBeenCalled();
    });

  });

  describe('getPatientByToken', () => {
    
    it('should retrieve patient by token', async () => {
      const mockPatient = {
        patientId: 'PID123',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          { token: 'TKN-REG-123', stage: 1, department: 'Registration' }
        ]
      };

      Patient.findOne = jest.fn().mockResolvedValue(mockPatient);

      // Act
      const result = await checkinService.getPatientByToken('TKN-REG-123');

      // Assert
      expect(Patient.findOne).toHaveBeenCalledWith({ 'activeTokens.token': 'TKN-REG-123' });
      expect(result).toEqual(mockPatient);
    });

    it('should throw error when token not found', async () => {
      Patient.findOne = jest.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(checkinService.getPatientByToken('INVALID')).rejects.toThrow('Patient not found with token');
    });

  });

  describe('updateTokenStatus', () => {
    
    it('should update token status successfully', async () => {
      const mockPatient = {
        patientId: 'PID123',
        multiStageTokens: [
          { token: 'TKN-REG-123', stage: 1, department: 'Registration', status: 'pending' }
        ],
        activeTokens: [
          { token: 'TKN-REG-123', stage: 1, department: 'Registration', status: 'pending' }
        ],
        save: jest.fn().mockResolvedValue(true)
      };

      Patient.findOne = jest.fn().mockResolvedValue(mockPatient);

      // Act
      await checkinService.updateTokenStatus('PID123', 'TKN-REG-123', 'completed');

      // Assert
      expect(mockPatient.multiStageTokens[0].status).toBe('completed');
      expect(mockPatient.save).toHaveBeenCalled();
    });

  });

});