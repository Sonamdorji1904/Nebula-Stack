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
    
    it('should successfully ingest patient data from Mock ePIS', async () => {
      // Arrange
      const mockEpisResponse = {
        data: {
          success: true,
          data: {
            patientId: 'PID123456',
            firstName: 'John',
            lastName: 'Doe',
            dateOfBirth: '1985-06-15',
            gender: 'Male',
            contactNumber: '+1-555-0123',
            email: 'john.doe@example.com'
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

    it('should throw error when Mock ePIS returns unsuccessful response', async () => {
      // Arrange
      const mockEpisResponse = {
        data: {
          success: false
        }
      };

      axios.post.mockResolvedValue(mockEpisResponse);

      // Act & Assert
      await expect(checkinService.ingestPatientData()).rejects.toThrow('Mock ePIS returned unsuccessful response');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log error when Mock ePIS API call fails', async () => {
      // Arrange
      const error = new Error('Network error');
      axios.post.mockRejectedValue(error);

      // Act & Assert
      await expect(checkinService.ingestPatientData()).rejects.toThrow('Network error');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error during patient data ingestion'),
        expect.any(Object)
      );
    });

    it('should store patient data in MongoDB with correct schema', async () => {
      // Arrange
      const mockEpisResponse = {
        data: {
          success: true,
          data: {
            patientId: 'PID789',
            firstName: 'Jane',
            lastName: 'Smith',
            dateOfBirth: '1990-03-20',
            gender: 'Female',
            contactNumber: '+1-555-9876'
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
      expect(Patient).toHaveBeenCalledWith(mockEpisResponse.data.data);
      expect(saveMock).toHaveBeenCalled();
    });

  });

  describe('getPatientById', () => {
    
    it('should retrieve patient by ID successfully', async () => {
      // Arrange
      const mockPatient = {
        patientId: 'PID123',
        firstName: 'John',
        lastName: 'Doe'
      };

      Patient.findOne = jest.fn().mockResolvedValue(mockPatient);

      // Act
      const result = await checkinService.getPatientById('PID123');

      // Assert
      expect(Patient.findOne).toHaveBeenCalledWith({ patientId: 'PID123' });
      expect(result).toEqual(mockPatient);
    });

    it('should throw error when patient not found', async () => {
      // Arrange
      Patient.findOne = jest.fn().mockResolvedValue(null);

      // Act & Assert
      await expect(checkinService.getPatientById('INVALID_ID')).rejects.toThrow('Patient not found');
    });

  });

});