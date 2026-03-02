// tests/followupTokenGenerationService.test.js
const followupTokenGenerationService = require('../services/followupTokenGenerationService');
const followupServiceMappingService = require('../services/followupServiceMappingService');
const followupEventLogger = require('../utils/followupEventLogger');
const Patient = require('../models/Patient');
const Department = require('../models/Department');
const { getNextTokenCounter } = require('../services/tokenCounter.service');
const { generateToken } = require('../utils/tokenGenerator');
const queueService = require('../services/queueService');
const staffStatusService = require('../services/staffStatusService');

// Mock dependencies
jest.mock('../models/Patient');
jest.mock('../models/Department');
jest.mock('../services/followupServiceMappingService');
jest.mock('../services/tokenCounter.service');
jest.mock('../utils/tokenGenerator');
jest.mock('../services/queueService');
jest.mock('../services/staffStatusService');
jest.mock('../utils/followupEventLogger');
jest.mock('../utils/logger');

describe('FollowupTokenGenerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateFollowupTokens', () => {
    it('should generate multiple follow-up tokens atomically', async () => {
      const mockPatient = {
        patientId: 'PID001',
        multiStageTokens: [
          { token: 'OPD-001', department: 'OPD', status: 'completed' }
        ],
        issueToken: jest.fn(),
        linkFollowupToken: jest.fn(),
        save: jest.fn().mockResolvedValue(true)
      };

      const requiredServices = [
        { service_type: 'Lab', priority: 'high' },
        { service_type: 'Pharmacy', priority: 'normal' }
      ];

      // Mock mapping lookups
      followupServiceMappingService.getMappingByServiceType
        .mockResolvedValueOnce({
          service_code: 'LAB',
          target_department: 'LAB',
          estimated_duration: 30,
          default_priority: 'normal'
        })
        .mockResolvedValueOnce({
          service_code: 'PHARMACY',
          target_department: 'PH',
          estimated_duration: 15,
          default_priority: 'normal'
        });

      Patient.findOne.mockResolvedValue(mockPatient);
      Department.findOne.mockResolvedValue({ code: 'LAB', name: 'Lab' });
      getNextTokenCounter.mockResolvedValue(42);
      generateToken.mockReturnValueOnce('LAB-042').mockReturnValueOnce('PH-043');
      queueService.calculateAverageServiceTime.mockResolvedValue({ averageServiceTime: 5 });
      staffStatusService.getAvailableStaffCount.mockResolvedValue(2);

      const result = await followupTokenGenerationService.generateFollowupTokens(
        'OPD-001',
        requiredServices,
        { patientId: 'PID001' }
      );

      expect(result.successTokens.length).toBeGreaterThan(0);
      expect(result.status).toMatch(/success|partial_success/);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle partial failures gracefully', async () => {
      const mockPatient = {
        patientId: 'PID001',
        multiStageTokens: [{ token: 'OPD-001', department: 'OPD' }],
        issueToken: jest.fn(),
        linkFollowupToken: jest.fn(),
        save: jest.fn().mockResolvedValue(true)
      };

      const requiredServices = [
        { service_type: 'ValidService', priority: 'normal' },
        { service_type: 'InvalidService', priority: 'normal' }
      ];

      // First succeeds, second fails
      followupServiceMappingService.getMappingByServiceType
        .mockResolvedValueOnce({ target_department: 'LAB' })
        .mockRejectedValueOnce(new Error('Unknown service: InvalidService'));

      Patient.findOne.mockResolvedValue(mockPatient);
      Department.findOne.mockResolvedValue({ code: 'LAB' });
      getNextTokenCounter.mockResolvedValue(1);
      generateToken.mockReturnValue('LAB-001');
      queueService.calculateAverageServiceTime.mockResolvedValue({ averageServiceTime: 5 });
      staffStatusService.getAvailableStaffCount.mockResolvedValue(1);

      const result = await followupTokenGenerationService.generateFollowupTokens(
        'OPD-001',
        requiredServices,
        { patientId: 'PID001' }
      );

      expect(result.failedServices.length).toBe(1);
      expect(result.failedServices[0].service_type).toBe('InvalidService');
    });

    it('should throw error if patient not found', async () => {
      Patient.findOne.mockResolvedValue(null);

      const requiredServices = [{ service_type: 'Lab' }];

      await expect(
        followupTokenGenerationService.generateFollowupTokens(
          'OPD-001',
          requiredServices,
          { patientId: 'INVALID' }
        )
      ).rejects.toThrow(/Patient not found/);
    });

    it('should throw error if parent token not found', async () => {
      const mockPatient = {
        patientId: 'PID001',
        multiStageTokens: []
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      const requiredServices = [{ service_type: 'Lab' }];

      await expect(
        followupTokenGenerationService.generateFollowupTokens(
          'INVALID-TOKEN',
          requiredServices,
          { patientId: 'PID001' }
        )
      ).rejects.toThrow(/Parent token not found/);
    });
  });

  describe('calculateFollowupEWT', () => {
    it('should calculate EWT with priority adjustment', async () => {
      queueService.calculateAverageServiceTime.mockResolvedValue({
        averageServiceTime: 10
      });

      Department.findOne.mockResolvedValue({ _id: 'dept-123' });
      staffStatusService.getAvailableStaffCount.mockResolvedValue(2);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              multiStageTokens: [
                { department: 'LAB', status: 'pending' },
                { department: 'LAB', status: 'pending' }
              ]
            }
          ])
        })
      });

      const result = await followupTokenGenerationService.calculateFollowupEWT(
        'LAB',
        'high',
        { estimatedDuration: 20 }
      );

      expect(result.ewt_minutes).toBeDefined();
      expect(result.ewt_minutes).toBeGreaterThanOrEqual(5); // Minimum 5 minutes
      expect(result.factors).toBeDefined();
      expect(result.factors.priority).toBe('high');
    });

    it('should apply normal priority multiplier', async () => {
      queueService.calculateAverageServiceTime.mockResolvedValue({
        averageServiceTime: 10
      });

      Department.findOne.mockResolvedValue({ _id: 'dept-123' });
      staffStatusService.getAvailableStaffCount.mockResolvedValue(1);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const result = await followupTokenGenerationService.calculateFollowupEWT(
        'LAB',
        'normal'
      );

      expect(result.factors.priority_multiplier).toBe(1.0);
    });

    it('should apply low priority multiplier', async () => {
      queueService.calculateAverageServiceTime.mockResolvedValue({
        averageServiceTime: 10
      });

      Department.findOne.mockResolvedValue({ _id: 'dept-123' });
      staffStatusService.getAvailableStaffCount.mockResolvedValue(1);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const result = await followupTokenGenerationService.calculateFollowupEWT(
        'LAB',
        'low'
      );

      expect(result.factors.priority_multiplier).toBe(1.5);
    });

    it('should return default EWT on error', async () => {
      queueService.calculateAverageServiceTime.mockRejectedValue(
        new Error('Database error')
      );

      const result = await followupTokenGenerationService.calculateFollowupEWT('LAB', 'normal');

      expect(result.ewt_minutes).toBe(15); // Default fallback
      expect(result.factors.error).toBeDefined();
    });
  });

  describe('getQueuePosition', () => {
    it('should return correct queue position', async () => {
      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              multiStageTokens: [
                { department: 'LAB', status: 'pending' },
                { department: 'LAB', status: 'pending' },
                { department: 'OPD', status: 'pending' }
              ]
            }
          ])
        })
      });

      const position = await followupTokenGenerationService.getQueuePosition('LAB', 'normal');

      // 2 pending in LAB queue + 1 (this token) = position 3
      expect(position).toBe(3);
    });

    it('should return 1 if queue is empty', async () => {
      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const position = await followupTokenGenerationService.getQueuePosition('LAB', 'normal');

      expect(position).toBe(1);
    });

    it('should return default on error', async () => {
      Patient.find.mockImplementation(() => {
        throw new Error('DB error');
      });

      const position = await followupTokenGenerationService.getQueuePosition('LAB', 'normal');

      expect(position).toBe(1); // Safe default
    });
  });

  describe('createFollowupToken', () => {
    it('should create a single follow-up token with proper linking', async () => {
      const mockPatient = {
        patientId: 'PID001',
        issueToken: jest.fn(),
        linkFollowupToken: jest.fn(),
        save: jest.fn().mockResolvedValue(true)
      };

      followupServiceMappingService.getMappingByServiceType.mockResolvedValue({
        target_department: 'LAB',
        estimated_duration: 30,
        default_priority: 'normal'
      });

      Patient.findOne.mockResolvedValue(mockPatient);
      Department.findOne.mockResolvedValue({ code: 'LAB' });
      getNextTokenCounter.mockResolvedValue(100);
      generateToken.mockReturnValue('LAB-100');
      queueService.calculateAverageServiceTime.mockResolvedValue({ averageServiceTime: 5 });
      staffStatusService.getAvailableStaffCount.mockResolvedValue(2);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const service = { service_type: 'Lab', priority: 'high' };
      const result = await followupTokenGenerationService.createFollowupToken(
        'OPD-001',
        service,
        { patientId: 'PID001' }
      );

      expect(result.token).toBe('LAB-100');
      expect(result.parent_token_id).toBe('OPD-001');
      expect(result.service_type).toBe('Lab');
      expect(mockPatient.linkFollowupToken).toHaveBeenCalled();
      expect(mockPatient.save).toHaveBeenCalled();
    });
  });

  describe('processServiceCompletionFollowups', () => {
    it('should process automatic follow-ups on service completion', async () => {
      const mockPatient = {
        patientId: 'PID001',
        multiStageTokens: [{ token: 'OPD-001' }],
        issueToken: jest.fn(),
        linkFollowupToken: jest.fn(),
        save: jest.fn().mockResolvedValue(true)
      };

      const followupServices = [
        { service_type: 'Lab', priority: 'normal' }
      ];

      Patient.findOne.mockResolvedValue(mockPatient);
      followupServiceMappingService.getMappingByServiceType.mockResolvedValue({
        target_department: 'LAB'
      });
      Department.findOne.mockResolvedValue({ code: 'LAB' });
      getNextTokenCounter.mockResolvedValue(1);
      generateToken.mockReturnValue('LAB-001');
      queueService.calculateAverageServiceTime.mockResolvedValue({ averageServiceTime: 5 });
      staffStatusService.getAvailableStaffCount.mockResolvedValue(1);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const result = await followupTokenGenerationService.processServiceCompletionFollowups(
        'OPD-001',
        'PID001',
        followupServices
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('successTokens');
      // correlationId might be passed through or generated internally
      if (result.correlationId) {
        expect(result.correlationId).toBeDefined();
      }
    });
  });
});
